# Ophthalmós

Eye-imaging clinic trainer. A clinic encounter shows a real clinical image, asks for an
impression, then signs off with the reference answer, the defining signs, what the other
picks would have shown, and the plan. FSRS-6 spaced repetition brings each image back
just before it would be forgotten. Interaction modelled the same way as [[RadioAnatome]].

- **Entry points:** Home tile `ophthalmos` (flag-gated, see below) · `OPHTHALMOS.open()`
- **FundX AI inside Ophthalmós (owner, 2026-09-27):** the hub's "Your own images" row opens
  [[FundX]] through the same Experimental Access gate as the Home tile
  (`SMD_XACCESS.gate("fundx", …)`: one code, one device, server-verified). Ophthalmós closes
  first, so leaving FundX returns Home. The row only renders when `FUNDX` and `SMD_XACCESS` exist.
- **Files:** `ophthalmos-core.js` (FSRS-6, ported from ts-fsrs 5.4.2, sessions, stats),
  `ophthalmos-data.js` (levels, access, persistence: localStorage `smd_ophthalmos_v1`),
  `ophthalmos-stage.js` (image stage: pinch, double-tap, wheel zoom), `ophthalmos.js`
  (shell: open, close, layered back, stats, sources), `ophthalmos-screens.js` (clinic
  encounter layout: hub, encounter, summary, case conference), `ophthalmos.css`
- **Flag + default:** `smd_ophthalmos`, default **ON** for all users (owner decision
  2026-09-27). Kill switch: `localStorage.smd_ophthalmos = "0"` or `?ophthalmos=0` for the
  current load. Content is still ai_drafted, so every screen carries a 4px "To be verified ·
  draft" mark (owner-specified) and the hub keeps the readable Beta note. No
  client flag registry file exists for this module, same as `atlas` (RadioAnatome): the
  gating lives inline in `home.js`'s `eligible()`, not in a `*-flags.js` registry.
- **Data:** `ophthalmos/tracks.json` (levels, access, sources/credits) and
  `ophthalmos/decks/{oct,disc,dr,rop,cases}.json`: five clinics: Retina/OCT (2,064
  scans), Glaucoma/optic disc (705), Diabetic eye screening/DR grading (1,392), ROP
  screening (2,020), Case conference (60 multimodal cases, 10 questions each).
  `scripts/build-www.sh` copies `ophthalmos/tracks.json` and `ophthalmos/decks/*.json`
  (JSON only) into `www/`, mirroring the atlas data-dir block.
- **Load order:** `ophthalmos-core.js`, `ophthalmos-data.js`, `ophthalmos-stage.js`,
  `ophthalmos.js`, `ophthalmos-screens.js`, then `OPHTHALMOS.open()`: wired in
  `index.html` right after the atlas scripts.
- **Host globals used (all optional):** `ICONS`, `SMD_hideHome`, `SMD_showHome`, `toast`,
  `SMD_HAPTICS`, `SMD_PRO`, `SMD_PRO_NOTICE`.
- **Tests:** `test/ophthalmos-module.test.mjs`: deck JSON parses with the expected item
  counts, `tracks.json` has no em-dash, `index.html` load order, `home.js` tile + action,
  `scripts/build-www.sh` copies `ophthalmos/`.

## Gotchas

- **Source of truth is a separate repo**: `github.com/drmanojkurmana/ophthalmos`
  (branch `feat/mvp`). Edit there, then re-sync the shipped files
  (`ophthalmos-core.js`, `ophthalmos-data.js`, `ophthalmos-stage.js`, `ophthalmos.js`,
  `ophthalmos-screens.js`, `ophthalmos.css`, `ophthalmos/tracks.json`,
  `ophthalmos/decks/*.json`) into this repo. This integration does **not** become the
  source of truth: do not hand-edit the copied files here and expect them to survive
  the next sync.
- **Images are not in this repo.** 6,241 WebP fundus/OCT/disc images (134 MB) are not
  bundled: Cloudflare Pages caps a deploy at 20,000 files and StewardMD is already at
  ~19,400, so adding thousands more images is not possible here. They need an R2 bucket
  with `window.SMD_OPHTHALMOS_IMG` pointed at its URL (default path is
  `/ophthalmos-img/`) before `smd_ophthalmos` can go ON for real users: same reasoning
  RadioAnatome (`atlas.js` `imgUrl()`) already uses for its own slice images on native.
- **Teaching points and plans are ai_drafted**, pending ophthalmologist sign-off: same
  status class as CliniX/SURGX content before R1 review. Do not present this content as
  clinically approved.

## Image hosting (done 2026-09-27)
- R2 bucket `stewardmd-ophthalmos-img` (location APAC), custom domain `https://ophthalmos-img.stewardmd.in` (zone stewardmd.in, min TLS 1.2).
- 6,266 WebP objects (6,241 images + 25 thumbnails, 134 MB), `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`. Paths are immutable: a changed image gets a new key, never rewritten bytes (same rule as RadioAnatome).
- `ophthalmos.js` defaults to this domain (`IMG_DEFAULT`); `window.SMD_OPHTHALMOS_IMG` overrides it. `_headers` report-only CSP `img-src` lists the domain.
- Re-upload after a pipeline change: `wrangler r2 object put stewardmd-ophthalmos-img/<key> --file <webp> --content-type image/webp --cache-control "public, max-age=31536000, immutable" --remote` per new file (no bulk command in wrangler 4.141).

## 10x build (2026-09-28)
Owner asked for Ophthalmós to be "10x better" than ophthalmo-daily. Built in the module repo on
`feat/10x` (stacked PRs #3 to #11 there) and synced here byte-identical. Every feature registers itself
in a registry on `OPHTHALMOS` (`_sims`, `_banks`, `_tools`, `_reads`), so the hub renders sections only
for what loaded.
- **Hub:** Today's plan (image reviews topped up with new referrals, questions, one graded simulator
  patient rotating by day), then Clinics, Questions, Notes, Simulators, Tools, Your own images (FundX).
- **Question bank** (`ophthalmos-mcq.js/.css`, `ophthalmos/decks/mcq.json` 2.5 MB, lazy-loaded):
  3,035 MedMCQA ophthalmology items (MIT), ten subspecialties, study sets, timed exam (Pro), search,
  flags for doubtful keys (MedMCQA keys are crowd-sourced), FSRS deck key `mcq`.
- **Notes** (`ophthalmos-notes.js/.css`, `ophthalmos/notes.json`): 30 notes illustrated with deck images,
  cited to current guidelines (AAO PPP 2024/2025 editions etc.), `review: "ai_drafted"`.
- **Simulators:** retinoscopy (`ophthalmos-retino-model.js` + `ophthalmos-retino.js/.css`: one dioptric
  matrix optics model, graded patients, named errors) and neuro-ophthalmology (`ophthalmos-neuro.js/.css`:
  muscle, nerve and pupil model, nine-gaze deviation, Hess, cover test, pupil lab with drops).
- **Tools** (`ophthalmos-tools-model.js` + `ophthalmos-tools.js/.css`): refraction, VA, SRK/T (matches
  the OpenEyes reference to 0.0001 D), ETROP, ICDR with AAO PPP 2024 follow-up, AJCC 8th uveal melanoma T.
- **Stats:** predicted recall per clinic (FSRS), 7-day forecast, 12-week heatmap, weak spots with a Drill.
- **Ask MaiK:** encounter, case answer and question explanation offer "Ask MaiK" (`SMD_askMaik` types the
  question into the sheet; the learner sends it, so engine choice, quota and local-only policy apply).
  `swipe-back.js` skips the full-screen-module step while `body.maik-open` so back closes MaiK first.
- **Tests:** `test/ophthalmos-module.test.mjs` (35 checks) and `test/run-ophthalmos-10x-ui.mjs` (real app,
  16 checks: registries, hub, R2 image, Ask MaiK, bank deck, notes, both simulators, tools, no errors).
  The module repo has 71 unit tests and a 19-step headless UI test.
- **Not synced yet:** the RFMiD 2.0 general retina clinic (438 images, CC BY 4.0, uploaded to R2) sits
  on the module repo's local `feat/rfmid-clinic`; its push was blocked by the permission check and
  waits for the owner.
- **Clinical review first:** simulator constants (e.g. sixth-nerve deviation sizes) are uncalibrated;
  MedMCQA answer keys have known noise; notes list their own review items in the module PR #11.
