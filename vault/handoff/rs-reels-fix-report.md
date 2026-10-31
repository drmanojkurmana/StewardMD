# rs-reels-fix report: PrepReels headless UI harness — root cause and fix

## Root cause (harness bug, no product bug)

`node test/run-prep-medigram-ui.mjs` asserted the `prep-medigram.js` network fetch and the
`PREP_MEDIGRAM` / `PREP_MG_DATA` globals **before** calling `PREP.open()`. But
[prep-loader.js](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/prep-loader.js) fetches
everything — PrepReels included — lazily inside `load()`, which only runs on the first
`PREP.open()` (same lazy pattern the Play harness in `test/run-prep-play-ui.mjs` uses:
navigate, boot, `PREP.open()`, *then* assert). The feed therefore never loaded and every
downstream check failed as a cascade (14+ of the checks, starting with the two named in the job).

Product code is correct as-is and was **not** changed:

- `mgOn()` returns true for `?medigram=1` and honors `smd_prep` + `smd_prep_medigram`
  otherwise; `load()` appends `MG_JS` only when it is on, so with all flags off no medigram
  file is fetched.
- `prep.js` forwards `mg-*` actions and renders the home row only when `G.PREP_MEDIGRAM`
  exists; `back()`/`leave()` are guarded. Byte-for-byte behaviour with flags off is unchanged.
- `prep-sound.js` defines `PREP_SOUND` only when `?sound=1` or `smd_prep_sound` is on
  (plus its core/web/provider deps); the loader lists the Sound files unconditionally but they
  are inert without the flag.

## What was built

- [test/run-prep-medigram-ui.mjs](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/test/run-prep-medigram-ui.mjs):
  moved `PREP.open()` above the fetch/globals/home-row assertions (messages unchanged, none
  weakened or deleted) with a comment naming the root cause; appended two new sweeps —
  `?sound=1` asserts the Sound UI path loads (`PREP_SOUND` defined after open), and
  `?prep=1&medigram=0&sound=0` (explicit `=0` beats the harness-seeded localStorage) asserts
  the loader fetches **no** `prep-medigram*` file and the home shows no PrepReels row.
- [vault/handoff/rs-reels-report.md](/Volumes/WD BLACK SN7100 1TB Media/wt-prep-reels-sound/vault/handoff/rs-reels-report.md):
  appended a "Correction 2026-10-31 (rs-reels-fix)" section only — `test/prep-cards.test.mjs`
  never existed (see below), the harness had a real order bug, and the fixed harness is still
  unexecuted here.

No shared product files touched. No UI the user sees was changed, so the standing UI-skills
block does not apply (harness-only edit); the UI skill files named in the standing block live
under `/Users/diwakarkumar/...` and are not present in this environment.

## Files

Changed: `test/run-prep-medigram-ui.mjs` (harness fix + 2 new sweeps).
Corrected: `vault/handoff/rs-reels-report.md` (appended correction section only).
New: this report (`vault/handoff/rs-reels-fix-report.md`).

## Tests run + exact results

Repo convention is `node --experimental-test-module-mocks --experimental-sqlite` (package.json
`test` script, CI). All with those flags, this session:

| suite | pass | fail |
|---|---|---|
| test/prep-medigram.test.mjs | 13 | 0 |
| test/prep-sound-core.test.mjs | 8 | 0 |
| test/prep-sound-providers.test.mjs | 4 | 0 |
| test/prep-sound-web.test.mjs | 2 | 0 |
| test/prep-sound-spotify.test.mjs | 12 | 0 |
| test/prep-sound.test.mjs | 6 | 0 |
| test/prep-app.test.mjs | 33 | 0 |
| test/prep-play.test.mjs | 8 | 0 |
| test/prep-decks.test.mjs | 9 | 0 |
| test/prep-flash.test.mjs | 16 | 0 |
| test/prep-layerc-e2e.test.mjs | 13 | 0 |
| **total** | **124** | **0** |

Notes: `test/prep-cards.test.mjs` (named in the job) does not exist in this worktree and never
did — ran `prep-decks` + `prep-flash` + `prep-layerc-e2e` as the nearest card/deck equivalents
instead. `prep-decks` and `prep-layerc-e2e` fail under plain `node --test` with
`mock.module is not a function` on this checkout's Node v26.11.1 (pre-existing, environmental,
unrelated to this change — this edit touches only the medigram harness, which neither file
loads); both pass with the repo's documented `--experimental-test-module-mocks` flag, as counted above.
`node --check` passes on the edited harness and all four PrepReels product files.
`graphify-out/graph.json` does not exist in this worktree, so no graph query was possible;
reused code was located with repo search instead.

## OPEN (needs a normal checkout, humans, or devices)

- The fixed harness was NOT executed here: this sandbox refuses local listen sockets
  (`Error: listen EPERM: operation not permitted 127.0.0.1`), so `test/serve.mjs` cannot bind
  and headless Chrome has nothing to load. Run `node test/run-prep-medigram-ui.mjs` in a normal
  checkout (Chrome at `/Applications/Google Chrome.app`) and paste the result into this report.
- Clinical review of any real micro-lesson, Hindi/Telugu reviewer sign-off, YouTube API policy
  and legal review before `smd_prep_medigram_youtube` is enabled for anyone, real-device
  background/audio-focus/offline tests, the 30-learner pilot, store/rights checks for commissioned
  media, Spotify approval request (do NOT send yet — owner decision). None faked or claimed done.
- No paid API calls, no paid media, no model training; no listening history collected.
