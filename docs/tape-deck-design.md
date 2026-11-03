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
  title         optional custom name; shown instead of label everywhere (spine, cassette, lock screen)
  style         optional: "generated" (default) | "cover" | "executive" | "clear"
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
| `PUT /api/cassettes/{id}/settings` `{title?, style?}` | custom title (max 40 characters; `null` or blank goes back to the album or artist name) and cassette style (`generated` \| `cover` \| `executive` \| `clear`) |
| `PUT /api/cassettes/{id}/entries/{slot}` `{text}` | save a note; empty text clears it; recomputes finished state |
| `DELETE /api/cassettes/{id}` | deletes the cassette and all of its notes (notes first, so a failure part-way can be retried); succeeds if it is already gone |

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
Status: phases 1 to 5 done (phase 5 not deployed yet). Phase 6 (polish) is not started.

1. **Backend (done):** table entities, `CassetteFunction`, IAM, `template.yaml`, request validation, tests in `tests/`. Deploy with `sam deploy`.
2. **Blind player mode (done):** tape mode in `PlayerProvider` (`loadTape`, `rewind`, `eject`; `current` stays null), generic lock-screen title (`<album> cassette` / `<artist> mixtape`), no skip or seek actions, progress saved every 15 s and on pause, hide and eject. A tape loads paused so the deck's play button satisfies iOS's tap-to-play rule. Unit tests in `web/src/player.test.tsx`. Needs a check on a real iPhone and iPad: iOS may still draw its own scrubber from the audio element, in which case the fallback is a different playback path.
3. **Shelf and creation (done):** Tape deck tab, Albums/Artists picker, "Make cassette" button on album pages, spines on a two-shelf bookcase (to listen / finished) in a bundled marker font (`@fontsource/permanent-marker`). Tapping a spine loads the tape; a stand-in tape bar (play/pause, rewind, eject, "Song n of N") replaces the full deck until phase 4. A tape whose songs are no longer in the library refuses to load.
4. **Deck (done):** `web/src/Deck.tsx` and `web/src/CassetteArt.tsx`: an old-style deck with a smoked-glass door and a realistic cassette drawn in SVG (ribbed shell whose colour matches its spine, pill-shaped reel window with turning hubs, the four holes and trapezoid along the bottom, "SIDE A"). Also a green LCD showing the song number (`--` when empty, `END` at the end of the tape), a red LED, and rewind / play-pause / eject keys. Tapping a spine slides the cassette in and the door latches; eject pops it out. Sounds are synthesised with Web Audio in `deckSound.ts` (no audio files): a clunk timed to the animation, an eject spring, key ticks, a rewind whirr. There is deliberately no mute button; on iPhone the silent switch mutes them. Reduced-motion users get no animation but keep the sounds. While the Tape deck tab is open the deck is the only control; on other tabs the compact tape bar stays. The deck scrolls into view when you pick a tape.
   **Customize (done):** a "Customize this cassette" panel under the deck, for the loaded tape. A custom title (max 40 characters) replaces the album or artist name on the spine, the cassette and the lock screen. Four styles, each shown as a live thumbnail of the tape itself:
   - *Generated* (default): a colourful abstract cover, the same every time for the same tape.
   - *Album art*: the cover on the label (an artist mixtape shows a strip of up to four covers); falls back to the generated cover if there is no art or it fails to load.
   - *Executive*: a blue-label blank modelled on a classic cassette: three writing lines with the title on the first, the tape length (`C-46`, `C-60`, `C-90`, `C-120`) computed from the real running time, `SIDE A`, "QUALITY CASSETTE", "HIGH ENERGY MASTERING", and an original diamond mark. It deliberately does not reproduce another company's logo, name or phone number; the wording lives in `CassetteArt.tsx`.
   - *Clear*: a see-through shell with no label (the title is written on the plastic) showing the tape moving from the left reel to the right as the whole tape plays. The film follows exact tangents (`web/src/tapeGeometry.ts`): it peels off the left spool's lower left, wraps the left guide roller, runs flat along the bottom, wraps the right roller and winds onto the right spool's lower right, at every point through the tape (tested). The tape is conserved as area, so the two packs always hold the same total. It is the one place progress is visible, and it is whole-tape progress, not time left in the song; the lock screen stays blind either way.
   Idea for phase 5: the reference cassette prints a track list down the left of the label; ours could show numbered blank lines that fill in with the user's own marker notes as they write them.
5. **Journal (done):** `web/src/Journal.tsx` (the notebook) and `web/src/journalSave.ts` (autosave, wired into `useTapes`). One page per album with a pager, one numbered line per song (the numbers match the deck's LCD), notes in the marker font on cream lined paper, the playing song highlighted, and the notebook opening at (and following) the playing page. Wide screens (min-width 1000px, iPad landscape) keep it docked beside the deck as a sticky panel; everywhere else a "Journal" button opens it as a full-screen sheet. Until the tape is finished the pages show only numbers (an artist tape's pages say "Page n", never the album name). Autosave: edits show at once and are sent 800 ms after typing pauses, on leaving a field, when the page is hidden (`keepalive`) and when the browser comes back online; one request at a time, so the server's "every slot filled" check cannot race; a failed save keeps the text and retries after 2, 5, 10, 20 then 30 s; a 4xx refusal (other than 401/403/408/429) is shown on the line and not retried. Reloading the shelf never overwrites unsaved text. The server decides when the tape is finished (every slot has text) and the reply moves it to the Finished shelf; once finished, each line shows the song title in Modak next to the note, and the page heading becomes the album title. Clearing a note reopens the tape and hides the titles again. The finish count is a consistent DynamoDB read so the last slot always counts. Tests: `web/src/journal.test.tsx`, `tests/test_cassettes.py`.
   Not done: the idea above of filling the cassette label with the user's notes.
6. **Polish (in progress):** done so far: durable journal drafts (above); quiet failure handling: network errors become one plain "Can’t reach Charybdis" message (`reach` and `isRetryable` in `api.ts`), the place on the tape is saved by `progressSave.ts` (newest place per tape, retried after 5, 15, 30, then 60 s and when the connection returns, never shown), a failed shelf load retries when the browser comes back online, and the deck shows an offline note while `navigator.onLine` is false; deleting a tape (above). Still to do: accessibility pass (journal sheet focus, live-region noise, contrast, touch targets), reduced motion check, README.

## Open questions (defaults in bold)
1. After a tape is finished, can it be replayed? **Yes, as a normal tape, with titles shown.**
2. Rewind: **changed after v1: like a CD player's skip-back. The first press restarts the current song; a press within the first 3 seconds (`REWIND_RESTART_AFTER_S` in `player.tsx`) goes back to the previous song, so repeated presses keep walking back, stopping at song 1. Nothing goes forward, and the lock screen still has no skip. Rewind plays a synthesised tape whirr (longer when it changes song) and spins the reels backwards for its length.**
3. Can a tape be deleted (and made again)? **Yes (added after v1): "Delete this cassette…" at the bottom of the Customize panel, with a confirmation that says how many notes go with it. It removes the tape and its notes; making the same album or artist again starts blank.**
4. Offline: notes need a connection. **Show a failed-to-save state, keep a local draft, retry when back online. Done: unsaved notes are mirrored to `localStorage` (`charybdis.journal.drafts`) until the server confirms them, restored and re-sent on the next launch, and dropped if their tape no longer exists.**
5. Artist tapes with very large catalogs. **No cap in v1; revisit if one becomes unwieldy.**
