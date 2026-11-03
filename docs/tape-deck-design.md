# Tape Deck — design

A way to explore music without the usual crutches. The user turns an album or an artist into a **cassette**, loads it into a **tape deck**, and listens blind: no track names, no time remaining, no skipping. Alongside the deck sits a **journal** with one page per album and one slot per song. Writing something in every slot finishes the tape, moves it to a second shelf, and reveals what was on it.

## Decisions
| Topic | Decision |
|---|---|
| Storage | Server (DynamoDB), so tapes and notes sync between phone and iPad |
| Artist cassette order | Chronological: album year, then disc and track number |
| Duplicates | One cassette per album or artist (deterministic id) |
| Deck controls | Play, pause, rewind (restart the current song), eject (progress is saved) |
| Journal gating | Any slot, any time (honor system) |
| Finish rule | Every slot has non-empty text |
| Reveal | Finished tapes show song titles in the colourful heading font (Modak) |
| Delivery | Phased, below |

## Cassette data structure
Stored in the existing single table. IDs are deterministic so "one per album/artist" is enforced by a conditional write.

```
CASSETTE  sk = "album:<albumId>" | "artist:<sha1(artist name)>"
  kind          "album" | "artist"
  label         text sharpied on the spine (album or artist name)
  trackIds[]    frozen at creation (path-hash ids are stable across re-ingests)
  slots[]       [{ trackId, albumId }] derived from trackIds, used to group journal pages
  progress      { index, positionSec, updatedAt }
  status        "shelf" | "finished"
  createdAt, finishedAt

ENTRY     pk = "ENTRY", sk = "<cassetteId>#<slot zero-padded>"
  text          max 280 characters
  updatedAt
```

Entries are separate items so a 300-track artist tape never nears DynamoDB's 400 KB item limit and two devices never overwrite each other's notes. A tape is finished when every slot has an entry; the server decides this on each entry write (the client never sets `status`).

## API
New Lambda `CassetteFunction` with read/write on the table. The existing library function stays read-only.

| Route | Purpose |
|---|---|
| `GET /api/cassettes` | all cassettes and all entries |
| `POST /api/cassettes` `{kind, sourceId}` | server builds `trackIds` from TRACK/ALBUM items; 409 if it exists |
| `PUT /api/cassettes/{id}/progress` `{index, positionSec}` | resume point |
| `PUT /api/cassettes/{id}/entries/{slot}` `{text}` | save a note; empty text clears it; recomputes finished state |

All routes sit behind the existing Cognito JWT authorizer. The server validates ids, slot range and text length.

## Blind playback
`PlayerProvider` gets a tape mode. In tape mode:
- Lock-screen metadata is generic ("Cassette"), with no title, artist, art or `positionState`.
- `nexttrack`, `previoustrack`, `seekto`, `seekbackward` and `seekforward` handlers are unset.
- `PlayerBar` and `NowPlaying` render nothing; the deck has its own UI that never reads `current` or `duration`.
- A song ending advances to the next. End of tape stops with the deck idle.
- Starting normal playback ejects the tape (progress is saved first).
- Progress is saved every ~15 s, on pause, eject, track change and when the page is hidden. Loading a tape seeks to its saved point.

This is a UX boundary, not a security one: the audio URLs are visible in browser dev tools. That is acceptable for a single-user honor system.

## UI
- **Tape deck tab** next to Albums, Tracks and Playlists.
- **Making a cassette:** a "Make cassette" button on every album page, and a picker in the tab with an Albums / Artists toggle and search. Artists are grouped from `albumArtist`; there is no separate Artists tab.
- **Shelf:** cassettes stand on their spines like books. Spine colour and height vary deterministically per tape. The label is written in a marker font (bundled via `@fontsource`, no external requests). Two shelves: to listen / in progress, and finished.
- **Deck:** an old tape deck drawn in SVG/CSS. Tapping a spine animates the cassette from the shelf into the deck, the door closes, the hubs spin while playing. Insert sound is synthesised with Web Audio (no audio asset or licence). Honors `prefers-reduced-motion`; a mute toggle is stored locally.
- **Journal:** beside the deck on iPad landscape (floating notebook); a full-screen sheet on iPhone. One page per album, one numbered slot per song, text in the marker font, saved automatically with a visible saved / retrying state. Song titles are hidden until the tape is finished. The currently playing slot number is highlighted.
- **Finished:** tape animates to the finished shelf; journal pages show titles in Modak next to the notes.

## Phases
1. **Backend:** table entities, `CassetteFunction`, IAM, `template.yaml`, request validation. Deploy with `sam deploy`.
2. **Blind player mode:** tape mode in `PlayerProvider`, `MediaSession` lockdown, progress save and resume.
3. **Shelf and creation:** tab, picker, "Make cassette" button, cassette spine rendering.
4. **Deck:** SVG deck, load and eject animation, synthesised sounds, deck controls.
5. **Journal:** pages and slots, autosave, finish logic, finished shelf, title reveal.
6. **Polish:** accessibility, reduced motion, offline and failure states, README update.

## Open questions (defaults in bold)
1. After a tape is finished, can it be replayed? **Yes, as a normal tape, with titles shown.**
2. Rewind restarts the current song only; it never goes back to the previous one. **Yes.**
3. Can a tape be deleted (and made again)? **Not in v1.**
4. Offline: notes need a connection. **Show a failed-to-save state, keep a local draft, retry when back online.**
5. Artist tapes with very large catalogs. **No cap in v1; revisit if one becomes unwieldy.**
