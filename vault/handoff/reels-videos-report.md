# Handoff: PrepReels real YouTube videos (reels-videos)

184 verified official-channel YouTube cards now in the PrepReels feed; PrepReels
ON by default (parent + YouTube), off switches kept.

## What was built

- Cards: 184 `kind: "video"` cards in `prep-medigram.js` (real `CANDIDATES` live
  there, not in `prep-medigram-data.js`), exact existing shape, real titles,
  `durationSec` <= 360, `youtube_embed` + approved clinical-review object with
  owner-spot-check-pending role. Placeholder Rick Astley card removed.
- Defaults: `prep-loader.js` `mgOn()` default ON (`!== "0"`, still requires
  `enabled()`); `prep-medigram-data.js` `resolveFlags()` parent + youtube default
  true. `?medigram=0` / `smd_prep_medigram="0"` still turn it off. Default mode
  (study) serves videos via the existing `eligible`/`buildFeed` path; no mode
  redesign.
- Pins: loader token `prep163` in `prep-loader.js`, `index.html`,
  `test/run-prep-play-ui.mjs`, `test/run-prep-tools-ui.mjs` (was stale at prep118).
- Verification: live oEmbed re-check for every ID (200 + title + author_name);
  output in `vault/handoff/reels-videos-verified.json`. Method + scripts in
  `reels-scratch/`; full notes + full video list in `NOTES-reels-videos.md`.

## Files changed (shared files touched with smallest hooks)

- `prep-medigram.js` (cards; delete placeholder + add cards)
- `prep-loader.js` (1-line `mgOn()` + comment + V bump)
- `prep-medigram-data.js` (2 defaults + comment)
- `prep-medigram-media.js` (1 stale comment)
- `index.html` (1 version pin)
- `test/prep-medigram.test.mjs`, `test/prep-app.test.mjs`,
  `test/run-prep-play-ui.mjs`, `test/run-prep-tools-ui.mjs`
- New: `NOTES-reels-videos.md`, `vault/handoff/reels-videos-verified.json`,
  `reels-scratch/` scripts.

## Tests

`node --test test/prep-medigram.test.mjs test/prep-app.test.mjs` -> 52/52 pass,
including the new validateCard test and the new loader default-ON test.
No network in tests; no paid API touched.

## OPEN items

- Clinical spot-check by a human (cards marked owner-spot-check-pending).
- Forensic shortfall: 1 item (brain death, Osmosis from Elsevier), dermatology 5,
  vs the 6-per-subject target - official channels only ship this content long-form
  or off-channel; needs owner decision (see NOTES for options).
- YouTube embeddability/licensing not legally reviewed.
- No real-device test of the 184-card feed.

UI compliance: no visual design changed (data + flag defaults only). Existing
`prep-medigram.css` untouched: tokens, 52px option targets, reduced-motion,
no gradients/backdrops all unchanged and still covered by tests.
