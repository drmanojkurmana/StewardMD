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
  current load. Content is still ai_drafted, but the per-screen "To be verified · draft" mark and every
  Beta / AI-drafted / awaiting-review note were removed (owner decision 2026-09-28). No
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
- **Tests (10x, superseded by the Learn tab section below):** `test/ophthalmos-module.test.mjs` (35 checks) and `test/run-ophthalmos-10x-ui.mjs` (real app,
  16 checks: registries, hub, R2 image, Ask MaiK, bank deck, notes, both simulators, tools, no errors).
  The module repo has 71 unit tests and a 19-step headless UI test.
- **General retina clinic (RFMiD 2.0, CC BY 4.0):** 438 images in 12 classes (normal, chorioretinitis,
  retinal traction, media haze, disc cupping, exudation, CSR, RD, macular scar, CME, myopia, tilted disc),
  `ophthalmos/decks/rfmid.json`, images on R2 (450 keys verified). Module repo PR #13.
- **Clinical review first:** simulator constants (e.g. sixth-nerve deviation sizes) are uncalibrated;
  MedMCQA answer keys have known noise; notes list their own review items in the module PR #11.

## Learn tab (2026-09-28)
Owner: Learn | Test tabs, picked on first open (with the language), then the last tab is remembered
(`smd_ophthalmos_prefs`). Synced byte-identical from module repo `feat/learn` a22a8cd (PR #17).
- **Files:** `ophthalmos-learn.js` + `ophthalmos-learn.css`, loaded last (after `ophthalmos-tools.js`);
  logic helpers (`validateLesson`, `nextLesson`, `mediaCredit`, `scopeSvg`) are in `ophthalmos-data.js`.
  Every Ophthalmós tag in `index.html` uses `?v=oph6`.
- **Data:** `ophthalmos/learn/`: `index.json` (units; MBBS and Resident), `glossary.json`,
  `lessons/<id>.json` (14, English + Hindi, `review: "ai_drafted"`), `diagrams/*.svg` (5, original),
  `media/` (17 photos, 17 illustrations, 8 animations, `credits.json` with licence and source per item).
  Lessons fetch from `SMD_OPHTHALMOS_BASE + "learn/..."` (animations are fetched and inlined); `see.img`
  deck images come from R2. `scripts/build-www.sh` copies the whole folder (README.md excluded).
- **Hosting:** in the repo and the native bundle, not R2: 65 files, 1.9 MB; Pages upload about 15,400 of
  20,000 files. The web middleware 404s `/ophthalmos/` by design (native-only).
- **Access:** MBBS lessons free; Resident lessons Pro with one trial (`learn.resident`); Resident question-bank
  sets gated by `mcq.resident`. At MBBS level the Test hub drops Notes and Tools: they live under Learn >
  Reference (with the glossary). MBBS Today's plan is lesson-first (Lesson, Images, Questions).
- **Tests:** `test/ophthalmos-module.test.mjs` also checks every lesson in the index, diagrams, every media
  file credited, load order and one shared `?v=`; `test/run-ophthalmos-10x-ui.mjs` (25 checks) walks the
  first-run choice, Test hub, Learn Reference, a lesson picture, a hotspot, a "More pictures" media figure
  with its credit, and Hindi.


## Learn units, Explore and lazy lessons (oph7, 2026-09-28)
Synced byte-identical from module repo `feat/learn-units` (PR #23 there, integrating #18 to #22).
- **Units:** 19 units, 107 lessons (was 3 and 14): Start here, then nine subjects, each an MBBS unit and a
  Resident unit: retina, cornea and external eye, uveitis, neuro-ophthalmology, optics and refraction,
  children's eyes and squint, lids, tear duct and orbit, glaucoma, lens and cataract. 267 glossary terms.
  All `review: "ai_drafted"`; English and Hindi. Lessons with `test.sim` offer "Try the simulator".
- **Explore:** `ophthalmos-explore.js` + `ophthalmos-explore.css`, loaded right after the Learn files: five
  explorers on the Learn home (eye anatomy with a find-the-part quiz, how the eye focuses on the retinoscopy
  optics model, visual pathway with a pure field model, pupil pathway on the neuro pupil model, guided fundus
  and OCT tours). Progress in `store.explore`.
- **Lessons load on open:** opening Ophthalmós fetches `learn/glossary.json`, `learn/media/credits.json` and
  `learn/index.json` only. `index.json` carries a summary per lesson (`lessons: {id: {title, minutes, idea,
  see, test?}}`, written by the module repo's `dev/learn-index.mjs`, never by hand); `lessons/<id>.json` is
  fetched when the lesson opens and cached in memory. A spent Resident trial goes to the paywall without a fetch.
- **Cache-bust:** every Ophthalmós tag in `index.html` is `?v=oph7` (the section above says oph6; superseded).
- **Hosting:** `ophthalmos/learn/` now about 230 files in the bundle; `build-www.sh` already copies the folder
  and the root `*.js` / `*.css` globs carry the Explore files.
- **Sync check:** `test/ophthalmos-sync.json` holds the module commit and the sha256 of all 257 synced files;
  `test/ophthalmos-module.test.mjs` fails on any drifted copy or any Ophthalmós file the module does not ship.
  Regenerate it from the module repo after each sync.
- **Tests:** `test/ophthalmos-module.test.mjs` (643 checks) adds byte identity, Explore wiring, the oph7 token,
  index summaries and the build globs; `test/run-ophthalmos-10x-ui.mjs` (30 checks) adds all 19 units listed,
  no lesson file fetched on open, every lesson file bundled and valid, a new-unit lesson opening, and the
  visual pathway explorer rendering. Module repo: 130 unit tests, 41 headless UI steps.
- **Owner items:** ophthalmologist and Hindi review lists are in module PR #23; the Learn home is now long
  (107 rows, Explore below the units), see that PR.

## Learn home: collapsible units (oph8, 2026-09-28)
Synced byte-identical from module repo `feat/learn-collapsible-units` (PR #24 there), fixing the "Learn home
is long" item above. `ophthalmos-learn.js` + `ophthalmos-learn.css` only; every Ophthalmós tag in `index.html`
bumped to `?v=oph8`.
- Each unit is a `<details>`/`<summary>` disclosure (title, level, "{d} of {n} done" progress, chevron) around
  the existing lesson rows; native keyboard and expanded/collapsed semantics, no new markup pattern elsewhere.
  All units collapse by default except the one holding the learner's next lesson (the first unit for a new
  learner); the learner's own opens/closes persist in `smd_ophthalmos_prefs.units`, alongside the tab and
  language choice. No new i18n strings (reuses the MBBS/Resident and "{d} of {n} done" chrome strings).
- Module repo: 130 unit tests, 42 headless UI steps (one new step covers default state, toggling, keyboard
  activation, persistence and Hindi). `test/ophthalmos-sync.json` regenerated at module commit `0850e21`.

## White theme (oph10, 2026-09-28)
Owner asked for a white background, no white-on-white text, and every diagram to work on it. Edited here
directly (like the 2026-09-28 open-content edit) and `test/ophthalmos-sync.json` hashes regenerated, so
**port the same change to the module repo** before the next sync or it will be overwritten.
- `--op-*` tokens in `ophthalmos.css` are now light (`--op-bg #fff`, text `#15171c`, muted `#575c66`; every
  text token is at least 4.5:1 on `--op-bg`/`--op-s1`). `color-scheme: light`.
- **Photos keep a black plate** (`.oph-stage`, `.ln-banner`, `.ln-pic-b`, `.ln-mpic`, `.ln-anim`, `.oph-fig-b`,
  explore tours/photos): clinical images are drawn/read on black. Simulator canvases (retinoscopy, neuro) paint
  their own black stage.
- **Line diagrams sit on white:** `.diagram` / `.ln-zdiag` containers are white; the 73 `ophthalmos/learn/diagrams/*.svg`
  were recoloured (light strokes to dark ink, faint white washes to faint ink washes, cream cells and beams darkened).
  Media illustrations/animations were drawn with their own backgrounds and are unchanged. Explore ray, pathway and
  field models recoloured in `ophthalmos-explore.css`.
- Status bar: `ophthalmos.js` sets dark status-bar icons on open and hands back to `SMD_THEME_REVEAL.syncSystemUI()`
  on close (a dark-mode host would otherwise show a white clock on the white overlay).
- Cache token `?v=oph10`.

## Follows the app's light / dark mode (oph11, 2026-09-29)
Owner: "white or black should be linked to system, just like dark mode and light mode". The app's mode is `body.dark`
(theme-sync.js ties it to the phone's setting). Light = the oph10 white tokens (default). Dark = the pre-oph10
reading-room palette, restored by **`oph-theme-dark.css`** (StewardMD-side, `body.dark .oph-overlay ...`; named
`oph-*` so the sync test's `ophthalmos*.css` = module-file rule does not claim it, and a module re-sync never
overwrites it). In dark mode the 73 Learn line diagrams keep their white card (drawn for white); photos are on black in
both modes. Switching mode while Ophthalmos is open follows at once (pure CSS).
- `ophthalmos.js` `statusBar()`: on a dark host it hands the status bar to `SMD_THEME_REVEAL.syncSystemUI()` instead of
  forcing dark icons over a black overlay. Edited here, sha updated in `test/ophthalmos-sync.json`: **port to the
  module repo** with the oph10 change.
- All 22 Ophthalmos tags moved to `?v=oph11` (test expects one shared token).
- Test: `test/run-ophthalmos-theme-ui.mjs` (both modes, live switch, contrast audit of every visible text on welcome,
  test hub, simulator, stats, learn home, lesson; diagram card white; photo stage black; status bar).

## Realistic lesson images (oph12, 2026-10-01)
- 45 lessons now open on a realistic AI-generated image (`ophthalmos/learn/media/real/<name>.webp`) instead of our
  own SVG diagram; the SVG stays as a second picture under More pictures (`see.more`). Photos and open-licence media
  were not touched. Module repo PR #25 (merge 1c8a12b).
- Credit "Created with MaiK (StewardMD AI)", licence "Original, StewardMD"; single StewardMD badge bottom-right;
  every lesson carries `review.verify` for clinical sign-off of anatomy and label positions.
- Renderer: `picUrl()` in `ophthalmos-learn.js` loads `learn/media/...` from the bundle; deck images still use the
  image host. Synced with a 3-way merge so the StewardMD-only edits (oph10 white background, oph11 light/dark mode)
  were kept: those edits still need **porting back to the module repo**.
- All 22 Ophthalmós tags moved to `?v=oph12`.

## Clinical + code review: retinoscopy and neuro-ophthalmology (oph13, 2026-10-02)
- Three consultant-plus-engineer reviews and an independent verification before the real clinical review.
  Module PR #26 (merge 25fcda9). Highlights: neuro gaze solver side asymmetry (one-and-a-half 143 PD on
  one side), pupil-sparing third nerve now "image anyway", three wrong realistic images removed (lessons back
  on diagrams), retinoscopy working-distance error labels and residual cylinder, GCA and ONTT guidance.
- Explorer colours now match the neuro-pathway lesson: blue = left half of vision. StewardMD's own colours
  (light `ophthalmos-explore.css`, dark `oph-theme-dark.css`) were swapped too (`?v=ophdark2`).
- Synced by a 3-way merge again; the StewardMD-only oph10/oph11 edits still need porting to the module.

## Content rules (oph14, 2026-10-08)
Owner, after the neuro-pathway lesson said "the right brain sees the left half of the world" and showed "LGN" with
no full form: rules R1 to R9 for ALL Ophthalmós text (lessons, notes, glossary, explorers, simulators, tools,
quizzes; English and Hindi). Full text with examples: `ophthalmos/CONTENT-RULES.md`.
- **R1** medical term first, plain meaning in brackets at first use: "the left half of the visual field (the left
  side of everything you see)". Never "world" for visual field, "picture" for retinal image, "relay knot" for LGN.
- **R2** analogies only in the "Think of it like this" block (or a marked "like ..."), medical term kept beside them.
- **R3** abbreviations written out at first use per lesson/screen. Glossary acronyms carry `"abbr": true` and
  `"full": {en, hi}`; `D.glossFull()` renders the first `[[term]]` of a lesson as "lateral geniculate nucleus (LGN)"
  (a full form that already holds its short form, e.g. "optical coherence tomography (OCT) scan", is used as written),
  later links show the short form (`D.glossAbbr()`), and the glossary sheet title is always the full form.
- **R4** Hindi: plain Hindi with the English term in brackets; full forms may stay in English letters:
  "लैटरल जेनिकुलेट न्यूक्लियस (lateral geniculate nucleus, LGN)". No em or en dashes anywhere.
- **R5** field defects are shown: a lesson's optional `fields` block (`{intro?, items: [{id, label, le, re, where?,
  lesion?}]}`, patterns and sites in `D.FIELD_PATTERNS` / `D.FIELD_SITES`, validated by `validateLesson`) adds a
  "What the patient sees" step after Why it happens: left eye, right eye and both eyes open drawn on one CC0 street
  scene (`learn/media/fields/street-mysore.webp`, media id `fields-scene`, Christopher J. Fynn, Wikimedia Commons),
  "Normal" first, dark or blurred loss (remembered in prefs as `fstyle`). Patterns come from `D.fieldAlpha()` (patient's
  view: temporal = outer half of that eye) and `D.fieldBoth()` (centre lost only where both eyes lose it; the outer 10%
  crescent belongs to that side's eye). A "See it" hotspot named after a pathway site offers "See what the patient sees"
  when an item has that `lesion`.
- **R6** short sentences, facts unchanged, everything stays `ai_drafted`.
- **R7** anatomically complete ("each optic nerve carries both the nasal and the temporal fibres of its own eye").
- **R8** precise names at first use (Meyer loop = inferior fibres of the optic radiation in the temporal lobe;
  pretectal and Edinger-Westphal nuclei; short ciliary nerves).
- **R9** no vague counts where a name exists (macular sparing: posterior cerebral artery and middle cerebral artery).
- **Lint:** `test/ophthalmos-content-rules.test.mjs` checks R1, R3 (listed non-glossary abbreviations, first use per
  lesson / note / track / glossary entry), R4, R5, R9 phrases, glossary full forms, `[[term]]` links and the field
  model. **UI:** `test/run-ophthalmos-fields-ui.mjs` (fixture lesson: render, switch, both eyes, blur, Hindi, dark,
  390 no overflow, 44 px targets, LGN first-use expansion). The image could not be generated (Codex CLI's image tool
  is not available in `codex exec` on this account; `agy` needed a Google sign-in), so the scene is a CC0 photo.
- Explorer, neuro simulator and tools strings were rewritten to R1 to R9 here; **port to the module repo**, along
  with the renderer, glossary and test, before the next sync. Cache token `?v=oph14`.
