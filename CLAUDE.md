# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It reads Tilt hydrometers, read only, from the Tilt Pi app through its local
HTTP API (after michaelheyman/tilt-pi, MIT).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `test` and
`npm audit` on Node 22 and 24, and builds the Docker image: run them before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        TiltPiApp: due time, pause, devices, states, status, test
src/tiltpi.js                     GET /macid/all, error kinds, strict bounded parsing
src/fields.js                     readings -> values in core units, devices, states (pure)
src/store.js                      pace, pause, Tilts met, persisted in /data
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults), address, normalization
src/http.js                       fetch with timeout, no redirection, bounded body
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
.github/scripts/cover.mjs         draws cover.png with Node alone
```

## Rules

- **Read only.** Only `GET /macid/all` on the Tilt Pi; nothing that writes.
  **No Bluetooth**: the Tilt Pi listens to the Tilts on its Raspberry Pi.
- **Readings are told apart by their raw key** (`timeStamp` of the Tilt Pi,
  else a digest of Temp, SG, mac and timeStamp; kept under `/data`) and
  handed to Gladys once; with a `Date` header on the age alone (current up
  to 3 minutes, dated up to 15), an undated one only once a change proves
  the Tilt alive. `Temp` is always °F. A changed MAC fingerprint (8 hex)
  holds a colour back until read twice in a row; a replaced one coming
  back within 24 h locks it (in `/data`) until one is read alone for 24 h.
  A silent Tilt sends nothing and is never shown alive.
- **Pace.** Never read before the last request + the interval (test button,
  reconnection, saved configuration, Discovery, restart); the instant of a
  request is written to `/data` before it leaves, at most once per minute.
  Delays in memory run on the monotonic clock (`mono`), capped at each use;
  the wall clock is only for `/data`. A generation is checked after every
  await: a late answer publishes nothing and sets no status.
- **External ids are forever**: `tilt:<colour>` (the eight lower-case Tilt
  colours), then `gravity` and `temperature`. The same goes for every key
  users store: manifest `config_schema`, `actions`.
- **Units of the core only** (`DEVICE_FEATURE_UNITS_BY_CATEGORY`): the core
  has no density category, so the gravity is `unknown` without unit. Never
  drop a feature of a created device from the Discovery list.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never a MAC address there (an 8-hex fingerprint only).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (the first version, 0.1.0, was set by hand once, see TODO.md).
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never reach beyond the loopback interface.
