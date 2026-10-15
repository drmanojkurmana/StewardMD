# Lesson footer buttons, Report reason, biostatistics images: DONE (2026-10-13)

Branch `lessonui-1013`. Bottom player bar untouched throughout; it is the token source.

## A. Upper controls now match the bottom bar

- One shared component, `prep-action-row.js` + `prep-action-row.css`
  (`window.PREP_ACTION`), renders Report / Share / Bookmark as soft filled
  pills: no border, no shadow, `var(--pn-r-pill)` radius, 52px height (the play
  pill), 8px gaps, `var(--pn-s1)` fill, gold `var(--pn-fill)` for the saved
  bookmark (the play pill's on state), press `scale(.97)` on the 120ms token
  ease, 44px minimum on quiet chips. Used by pearl footers, every lesson foot
  (replacing the lone ID row), and the MCQ report flow; KB surfaces can render
  the same `actionRowHtml`/sheet from the same module.
- IDs are one quiet metadata line: filled pill chip, tap to copy, single
  "Copied" live region (`prep-action-row` meta chips and the restyled
  `.pi-chip`, now `var(--pn-s1)` filled at 44px).
- Header: back and share circles already are the bottom bar's `.pn-ib`; the
  "Auto" pill is now borderless `var(--pn-s1)` like the 1x pill, with the same
  press scale. States covered: default, pressed, focus-visible, disabled,
  loading (`aria-busy` on Send), success (Saved fill, report confirmation),
  error (inline sheet error). Light, dark and reduced motion handled by tokens
  and media queries.

## B. Report asks why

- Bottom sheet "What is wrong?": seven single-choice reasons, optional note
  (required for Other, 500 max with counter), Send/Cancel, success
  confirmation, focus trap, Escape to close, focus restored.
- Payload `{itemId, itemType, subject, module, reason, text, appVersion}`
  posts to the existing `/api/prep/flag` with the same Bearer auth prep.js
  used. Server accepts the new fields optionally (old payloads unchanged),
  whitelists reasons/types, caps and strips the note. Offline reports queue
  in localStorage and retry on `online`/`flushQueue()`.
- Tests: `test/prep-action-row.test.mjs` (payload, legacy codes, queue,
  sheet markup), new flag cases in `test/prep-server.test.mjs`, MCQ and
  MaiK-module browser tests updated to the sheet flow
  (`test/run-prep-ui.mjs`, `test/run-prep-qgen-ui.mjs`).

## C. Images

- Audit: `.fleet-reports/LESSON-IMAGE-AUDIT.md` (1,005 of 1,041 lessons had
  zero images; per-subject counts).
- 16 original SVG diagrams in `prep/lessons/media/stats-*.svg`, wired into
  18 biostatistics and community-medicine lessons (28 steps), all passing
  `checkLesson`. Numbers verified by recomputation; attribution in
  `prep/lessons/media/ATTRIBUTION.md`. Remaining queue in
  `.fleet-reports/LESSON-UI-IMAGES-PROGRESS.md`.

## Verification

- Unit/guard: prep action row, pearl, lessons, lessons-100, pearl figs and
  prep-server suites pass (55/56; the one failure, `bank: medcov overlays`,
  fails identically on untouched `origin/main`).
- Browser: the sandbox blocks local servers and headless Chrome, so the
  updated browser tests and 390px light/dark screenshots could not be run
  here. They are ready to run with `node test/run-prep-ui.mjs` and
  `node test/run-prep-lessons-ui.mjs` (SHOTS=dir) on a machine with Chrome.

## Addendum 2026-10-14 (epi figures + sheet a11y, atop #1575)

- 9 more original SVGs (`prep/lessons/media/epi-*.svg`) wired into the
  last 8 imageless community-medicine epi/stats lessons (9 steps); every
  edited lesson passes `checkLesson`. Numbers re-asserted by an
  independent parse-and-assert pass that caught and fixed two label gaps
  before wiring. Queue update in `LESSON-UI-IMAGES-PROGRESS.md`.
- Report sheet accessibility: options grouped as `radiogroup` labelled by
  the title; validation error takes focus with a visible outline.
- Unit/guard re-run: action-row 8/8, lessons 23/23, ids/pearl batch 49/50;
  the single failure (`prep-ids` live-cache count `>1700` lessons vs 1041
  cached) reads an external cache outside the repo and is environmental.
- Compliance pass (web-design-guidelines + accessibility + taste
  preflight): labelled controls, 44px+ targets, focus-visible everywhere,
  no `transition: all`, reduced-motion off switch, lazy width/height
  images, `…` endings. No new UI library (repo already uses its own
  tokens).
- Branch merged up to current `origin/main` (the MCQ gate failures were
  branch staleness: #1575 had already landed the same A/B work). Browser
  gate re-run on `lessonui-browser-run`; PR and squash merge wait on green.

## Addendum 2026-10-14 (branch lessonui-1013)

- Wired 5 remaining null-visual stats/epi steps (mstat-sampling x2,
  mstat-regression, mstat-design, cm-infectious-epi); figure numbers
  re-verified; guards green (34 tests); browser gate lessonui-browser.yml.
- Deliberately left: mstat-audit (visuals on every step), single-concept bias
  glossary steps with no fitting bank figure. Next queue by exam weight:
  community-medicine 42, physiology 41, medicine 113, pathology 73,
  pharmacology 72.

## Addendum 2026-10-14 (Medical SVGs: Pharma, Micro, Path, Biochem)

- **Lead Note 15:05 Compliance**: Anatomy and Physiology are owned by a separate subagent and were skipped in this pass. Focus directed to the top non-anatomy basic sciences: Pharmacology, Microbiology, Pathology, and Biochemistry.
- **12 Original SVG Diagrams Created**:
  - `prep/lessons/media/pharma-dose-response.svg` (Dose-response, EC50, competitive right-shift vs non-competitive Emax depression, partial agonist)
  - `prep/lessons/media/pharma-therapeutic-index.svg` (Therapeutic index: ED50 vs TD50, narrow therapeutic margin)
  - `prep/lessons/media/pharma-elimination-kinetics.svg` (First-order exponential t1/2=2h vs zero-order linear clearance)
  - `prep/lessons/media/micro-cell-wall.svg` (Gram-positive thick peptidoglycan/teichoic vs Gram-negative outer membrane/LPS/periplasm)
  - `prep/lessons/media/micro-growth-curve.svg` (Bacterial batch growth curve: lag, log/exponential, stationary, decline phases)
  - `prep/lessons/media/micro-antibody-response.svg` (Primary IgM/IgG kinetics vs secondary memory response, affinity maturation)
  - `prep/lessons/media/path-extravasation.svg` (Leukocyte extravasation sequence: margination, selectin rolling, integrin adhesion, PECAM-1 diapedesis, chemotaxis)
  - `prep/lessons/media/path-apoptosis-pathways.svg` (Intrinsic mitochondrial Bax/Bak/Caspase 9 vs extrinsic FasL/Caspase 8 converging on Caspase 3)
  - `prep/lessons/media/path-granuloma.svg` (Concentric caseating granuloma architecture: central necrosis, Langhans giant cells, epithelioid cuff)
  - `prep/lessons/media/bio-lineweaver-burk.svg` (Lineweaver-Burk double reciprocal: competitive same 1/Vmax vs non-competitive depressed Vmax)
  - `prep/lessons/media/bio-glycolysis-tca.svg` (Cellular respiration hub: glycolysis, PDH, Krebs TCA cycle, oxidative phosphorylation ~30-32 ATP)
  - `prep/lessons/media/bio-purine-pathway.svg` (Purine metabolism: HGPRT salvage vs Xanthine Oxidase catabolism to uric acid)
- **11 Target Lessons Wired (12 Steps)**:
  - `phm-pharmacodynamics` (step 4 -> `pharma-dose-response.svg`)
  - `phm-pharmacokinetics` (step 3 -> `pharma-elimination-kinetics.svg`, step 5 -> `pharma-therapeutic-index.svg`)
  - `mic-antibodies-complement` (step 2 -> `micro-antibody-response.svg`)
  - `mic-history-morphology` (step 2 -> `micro-cell-wall.svg`)
  - `mic-culture-identification` (step 2 -> `micro-growth-curve.svg`)
  - `pat-acute-inflammation` (step 2 -> `path-extravasation.svg`)
  - `pat-apoptosis` (step 2 -> `path-apoptosis-pathways.svg`)
  - `pat-chronic-granulomatous` (step 4 -> `path-granuloma.svg`)
  - `bio-enzymes-kinetics` (step 3 -> `bio-lineweaver-burk.svg`)
  - `bio-glycolysis-tca` (step 2 -> `bio-glycolysis-tca.svg`)
  - `bio-purine-pyrimidine` (step 4 -> `bio-purine-pathway.svg`)
- **Attribution & Scientific Verification**: All 12 diagrams catalogued in `prep/lessons/media/ATTRIBUTION.md`; values, kinetics, equations, and morphological labels re-verified by independent check.
- **Verification & Gates**:
  - `P.checkLesson(l)` passes for all 11 lessons with 0 errors.
  - Unit test suite: 47/47 passing (0 failed).
  - Browser CDP test suites: `test/run-prep-lessons-ui.mjs` (ALL PASS) and `test/run-prep-ui.mjs` (ALL PASS).

## Addendum 2026-10-14 (Anatomy & Physiology Diagrams, Lead Note 16:00)

- **Ownership Handover**: Following Lead Note 16:00, the Claude subagent work for Anatomy and Physiology was retrieved from `/private/tmp/claude-img-wt` (`claude-img-1014`). All 5 commits were cherry-picked into `lessonui-1013`, incorporating text legibility fixes (`cw = min(cw, 560)`). The temporary worktree was subsequently removed.
- **Diagram Inventory**:
  - Anatomy: 74 of 80 lessons covered with 169 custom SVG diagrams (batches 1 & 2).
  - Physiology: 45 of 49 lessons covered with custom curve, axis, Wiggers, Frank-Starling, and pathway figures.
- **Audit Update**: 161 total lessons with images out of 1,449 lessons (1,288 imageless across 60 subjects). Detailed inventory generated in `.fleet-reports/LESSON-IMAGE-AUDIT.md`.

## Addendum 2026-10-14 (Upper Controls Unification, Section A Owner Correction)

- **Visual Reference**: The bottom player bar is the pristine visual design reference and remains untouched.
- **Upper Controls Styling**:
  - Restyled header back circle (`.pn-ib`), share circle (`.pi-sb`), and "Auto" pill (`.pn-lsn-auto`) to share the bottom bar's fills (`var(--pn-s1)`), radii (`var(--pn-r-pill)`/50%), 44px min height/touch targets, quiet shadow-less surfaces, and `scale(.95)` press feedback.
  - Centered ID metadata line `.pn-act-meta` with tap-to-copy pill `.pn-act-chip.pi-chip` (44px min height, 14px padding, `scale(.97)` press).
  - Uniform icon+label filled pill buttons across Report, Share, and Bookmark.
- **Testing & Compliance**:
  - Web design guidelines compliance pass: 44px touch targets, focus-visible outlines, reduced-motion overrides, light & dark theme compatibility via CSS variables.
  - Browser test suites verified: `test/run-prep-ids-ui.mjs` (ALL PASS), `test/run-prep-lessons-ui.mjs` (ALL PASS), `test/run-prep-ui.mjs` (ALL PASS).

## Addendum 2026-10-14 (Wave 2 Medical SVGs: Anatomy & Physiology 100% Complete + Basic Sciences)

- **100% Completion of Anatomy (80/80) & Physiology (49/49)**:
  - Addressed all remaining 6 imageless Anatomy lessons and all 4 remaining imageless Physiology lessons with custom, verified SVGs.
  - Anatomy is now 80/80 (100% complete).
  - Physiology is now 49/49 (100% complete).
- **15 New Original Medical SVGs**:
  - Anatomy (6):
    - `ana-trilaminar-disc.svg` -> `ana-germ-layers` (gastrulation, trilaminar germ disc derivatives)
    - `ana-epiploic-foramen.svg` -> `ana-peritoneum` (boundaries of foramen of Winslow)
    - `ana-thyroid-relations.svg` -> `ana-thyroid-root` (thyroid bed relations, RLN, SLN, parathyroids)
    - `ana-carotid-branches.svg` -> `ana-vessels-lymphatics` (ECA 8 branches vs ICA)
    - `ana-twinning-timing.svg` -> `ana-twinning-teratology` (monozygotic cleavage timing: Di-Di, Mono-Di, Mono-Mono, conjoined)
    - `ana-allens-test.svg` -> `ana-mixed` (Allen test collateral circulation)
  - Physiology (4):
    - `phy-acid-base-map.svg` -> `phy-acid-base` (Davenport acid-base nomogram)
    - `phy-fluid-compartments.svg` -> `phy-body-fluids` (60-40-20 fluid distribution)
    - `phy-appetite-nuclei.svg` -> `phy-hypothalamus-limbic` (hypothalamic hunger vs satiety centers)
    - `phy-stretch-reflex.svg` -> `phy-motor-reflexes` (monosynaptic stretch reflex and reciprocal inhibition)
  - Pharmacology (2):
    - `pharma-nephron-diuretics.svg` -> `phm-diuretics` (tubular segments, transport proteins, diuretic action sites)
    - `pharma-raas-pathway.svg` -> `phm-raas` (RAAS cascade and pharmacologic targets)
  - Pathology (1):
    - `path-necrosis-patterns.svg` -> `pat-cell-injury-necrosis` (6 morphologic patterns of necrosis)
  - Biochemistry (1):
    - `bio-etc-complexes.svg` -> `bio-etc-oxphos` (mitochondrial ETC complexes I-IV, ATP synthase, inhibitors)
  - Microbiology (1):
    - `micro-viral-structure.svg` -> `mic-general-virology` (enveloped vs naked, helical vs icosahedral architecture)
- **Scientific Re-verification**: All numbers, labels, physiological constants, and days re-asserted and recorded in `prep/lessons/media/ATTRIBUTION.md`.
- **Validation**:
  - All 15 wired lessons pass `checkLesson` with 0 errors.
  - `node scripts/lesson-diagrams/check.mjs` passes across all 126 lessons, 198 figures with 0 problems.
  - Overall inventory: 1,466 total lessons, 176 with images, 1,290 zero images.

## Addendum 2026-10-14 (Batch 3: Pharma/Micro/Bio/Path SVGs)

- **8 original SVGs** (`pharma-insulin-profiles`, `pharma-vaughan-williams`,
  `micro-hepb-serology`, `micro-hiv-cycle`, `bio-urea-cycle`,
  `bio-beta-oxidation`, `path-thrombus-fates`, `path-type3-immune-complex`)
  wired into 8 null-visual steps (`phm-insulin`, `phm-antiarrhythmics`,
  `mic-hepatitis-viruses`, `mic-hiv`, `bio-urea-cycle`,
  `bio-fatty-acid-oxidation`, `pat-thrombosis-embolism`, `pat-hypersensitivity`).
  Bank figure format kept (white stage, 800x520, `<title>`/`<desc>`, alt +
  caption, no em/en dashes). Numbers second-passed by independent
  parse-and-assert (insulin bar geometry within 1.5px, urea 4-bond cost,
  palmitate 16/2 = 8, turns 7).
- **Attribution**: 8 CC BY 4.0 StewardMD-original rows in
  `prep/lessons/media/ATTRIBUTION.md`; still zero third-party images.
- **Gates**: 8/8 `checkLesson` clean; full 1466-lesson sweep shows only the 6
  pre-existing med/mphar/sur failures (identical on clean tree); lesson unit
  suites 26/26 pass. Inventory now 184 with images, 1,282 zero.



## Addendum 2026-10-15 (Batch 4: prodrug/fever/type-IV/cold-sterilisation/shock-organs/nephritic-nephrotic/rifampicin/ZN SVGs)

- **8 original SVGs** wired into 8 null-visual steps only (no replacements):
  `phm-absorption-routes` s3 (prodrug map), `pat-mediators` s4 (fever
  pathway), `mic-immune-response` s4 (type IV 48-72h timeline),
  `mic-sterilisation` s3 (cold methods), `pat-shock` s4 (organ injury map),
  `pat-glomerular` s0 (nephritic vs nephrotic fork), `phm-antitubercular` s3
  (rifampicin panel), `mic-tuberculosis` s0 (ZN sequence + wall inset).
  Figure facts drawn from the step text itself; standard adjuncts
  (0.22 micrometre pores, endoscope/plasma use, muddy-brown casts, hyaline
  membranes, zone 3, watershed gut, LFT monitoring) are textbook-stable.
- **Validation**: parse-and-assert second pass (palette, 11px floor, ASCII,
  title/desc, key strings); 8/8 `checkLesson` clean; diagram checker 0
  problems; audit lists reconciled (1274 lines = 1274 zero-image lessons).
- Inventory now 192 with images, 1274 zero of 1466.
