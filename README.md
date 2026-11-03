# Charybdis

Personal, single-user music streaming on AWS, built for iOS Safari (home-screen web app).

**Status:** live. Library loaded: 2,642 tracks (77 GB), 39 playlists.

## Principles
1. Security first — private storage, no public buckets, no long-lived secrets in the repo.
2. Standardization and reproducibility — everything in AWS is defined in code in this repo.
3. Serverless and cheap — nothing runs when nobody is listening; target well under $10/month.

## Decisions
- **IaC:** AWS SAM / CloudFormation, region `us-east-1`.
- **Playback:** native ALAC/MP3/AAC in Safari via `<audio>`, no transcoding. Media Session API for lock-screen controls.
- **Storage:** private bucket `charybdis-assets` (CloudFront Origin Access Control only).
  - `music/` — Glacier Instant Retrieval (~$0.004/GB-month, $0.03/GB retrieved).
  - `art/`, index files — Standard (small objects; GIR bills a 128 KB minimum).
  - Never bulk-read `music/` from S3 (a full read of ~195 GB is ~$5.85). Tag and index from local disk.
- **Delivery:** one CloudFront distribution — `/` web app (public shell from `web/`), `/music/*`, `/art/*`, `/index/*` from S3 (signed cookies required), `/api/*` API Gateway + Lambda. Served at your own domain (Route 53 domain + hosted zone, ACM certificate, all in `template.yaml`); the default `cloudfront.net` URL still works.
- **Auth:** Cognito user pool (admin-created single user), password or passkey sign-in, JWT authorizer on the API. Passkeys are bound to your domain (the WebAuthn relying-party ID) and only work on that domain; they can never move to another domain. Refresh tokens last 10 years and are revoked on sign-out, so you stay signed in until you choose to sign out. Private paths are protected by CloudFront signed cookies issued after login; the private signing key is in SSM `/charybdis/cloudfront/private-key`.
- **Library data:** DynamoDB on-demand (tracks, albums, playlists). Search runs client-side over a compressed index.
- **Ingest:** local Python script (Anaconda, `mutagen`) reads tags, extracts art, uploads, loads the index. Idempotent: tracks already in DynamoDB are never re-uploaded.
- **Avoid (cost):** OpenSearch, WAF, NAT gateways.

## Library
- Local library on disk: ~195 GB of `.m4a` / `.mp3` files (an iTunes library, set via `CHARYBDIS_LIBRARY_ROOT` or `--root`, e.g. `<path-to-itunes>\iTunes Media\Music`). Only part of it is uploaded so far: every track in a playlist plus every file modified in the last 90 days.
- Playlists are imported from a JSON export made by `scripts/export-itunes-playlists.ps1` (iTunes COM interface; written to `scratch/`, gitignored). Smart playlists with no local files are skipped.

## Layout
- `template.yaml` — SAM/CloudFormation stack (`charybdis`): bucket, CloudFront, signing keys, Cognito, DynamoDB table `charybdis-library`, HTTP API + Lambda, certificate and DNS records (when `DomainName` is set).
- `samconfig.example.toml` — template for the gitignored `samconfig.toml` (deploy and build settings plus account-specific parameters: public signing key, domain, hosted zone ID). Lambda builds in a container (`python3.14`).
- `api/` — Lambda (`app.py`): `POST /api/session` issues the CloudFront signed cookies; `GET /api/library` returns tracks, albums and playlists. Protected by a Cognito JWT authorizer.
- `web/` — React + Vite + TypeScript PWA: password or passkey sign-in, albums / tracks / playlists views, search, shuffle, a full-screen Now Playing view (tap the player bar), and lock-screen controls. Search (`web/src/search.ts`) runs in the browser over the library already downloaded: multi-word, case- and accent-insensitive, no backend or extra cost. Layout is responsive from iPhone to iPad landscape. Bubble-graffiti headings use the bundled `@fontsource/modak` font; the page backdrop is one CSS variable, `--backdrop` in `web/src/styles.css` (currently dots plus `web/public/bg.svg`), so artwork can be swapped in one place. `web/src/config.ts` reads the Cognito pool/client IDs and passkey domain from `web/.env.local` (gitignored; template in `web/.env.example`).
- `scripts/deploy-web.ps1` — builds `web/` and syncs it to `s3://<bucket>/web/` (touches nothing else).
- `scripts/export-itunes-playlists.ps1` — read-only export of iTunes user playlists (via COM) to `scratch/` (gitignored).
- `scripts/ingest.py` — uploads tracks (`music/` as Glacier IR, `art/` as Standard) and keeps DynamoDB in sync. Subcommands: `playlists`, `recent`, `reset`.

## Data model (single DynamoDB table)
`pk` is the entity type, `sk` the id: `TRACK` (tags, codec, S3 key), `ALBUM` (trackIds, art key; rebuilt from tracks on every ingest), `PLAYLIST` (name, ordered trackIds, `source`). IDs are SHA-1 of the file or folder path relative to the library root, using on-disk casing.

## Setup (fresh clone)
- Copy `samconfig.example.toml` to `samconfig.toml` and fill in the signing public key, domain and hosted zone ID (or leave domain and zone empty for the default `cloudfront.net` URL).
- After the first `sam deploy`, copy `web/.env.example` to `web/.env.local` and fill in the user pool ID, client ID and domain from the stack. Both files are gitignored; keep account IDs, zone IDs and similar details out of the repo.

## Deploy
- Infra: `sam validate --lint`, `sam build`, `sam deploy` (needs Docker running).
- Web: `scripts\deploy-web.ps1`.
- Playlists: `scripts\export-itunes-playlists.ps1`, then `python scripts\ingest.py playlists --export scratch\itunes-export.json` (re-run to refresh; playlists removed from iTunes are removed here).
- New files: `python scripts\ingest.py recent --days 90`. Add `--dry-run` to either to preview.
