# Lesson UI + images progress (2026-10-13)

## Done

- **Audit**: `.fleet-reports/LESSON-IMAGE-AUDIT.md` — 1,041 lessons, 1,005 with
  zero images (96.5%); count per subject.
- **Figures**: 16 original SVGs in `prep/lessons/media/stats-*.svg` (skew,
  normal 68-95-99.7, SD vs SE, box plot, histogram vs bar, scatter r = +1/0/-1,
  2x2 sens/spec/PPV/NPV, ROC, CI forest, type I/II errors, study designs,
  evidence pyramid, sampling, Kaplan-Meier, funnel, risk/NNT). Accessible
  (`<title>`/`<desc>` + lesson alt text), white ground for the figure stage,
  palette #071318 / #3D5A54 / #0B6B5B / #B7791F. All printed numbers recomputed
  and asserted (see `prep/lessons/media/ATTRIBUTION.md`). No external images,
  so no third-party attribution is needed.
- **Wired** into 18 biostatistics / community-medicine lessons (28 steps):
  all 6 least `ss-biostatistics` lessons, `mstat-accuracy`, `mstat-ebm`,
  `mstat-risk`, `mstat-testing`, `sgm-statistical-tests`, `phe-biostatistics`,
  `phe-epidemiology`, `cm-central-tendency`, `cm-data-presentation`,
  `cm-sampling`, `cm-significance-tests`, `cm-screening`. Steps with no visual
  were preferred; six flow/table/compare visuals were replaced only where the
  figure teaches the same content (normal-curve flow, survival flow, forest
  table, 2x2 table, hierarchy compare, correlation compare). Every edited
  lesson passes the reader's own `checkLesson`.

## Done (2026-10-14 session)

- **Figures**: 9 more original SVGs in `prep/lessons/media/epi-*.svg`
  (point-source vs propagated epidemic curves with 65/72-case counts,
  ecological correlation vs individuals, prevalence bathtub, population
  pyramid with 174/174 millions and dependency ratio 58%, agent-host
  triad, recall-bias odds-ratio distortion 1.0 to 6.0, person-years
  timelines summing to 30 plus the 750 example, intention-to-treat
  100-vs-100 against per-protocol 88-vs-92, CHD web of causation).
  Accessible (`<title>`/`<desc>` + lesson alt text), same stage, fonts and
  palette as the stats set. Every printed number recomputed by an
  independent parse-and-assert pass; two label gaps it caught (unprinted
  174 totals, abbreviated ENVIRONMENT) were fixed before wiring. No
  external images, still no third-party attribution.
- **Wired** into the remaining 8 community-medicine epi/stats lessons (9
  steps): `cm-descriptive-epi` x2 (one compare replaced where the curve
  teaches the same point-source content, one empty step), `cm-measures`,
  `cm-vital-statistics`, `cm-outbreak-surveillance`, `cm-case-control`,
  `cm-cohort`, `cm-experimental`, `cm-bias-causation` (empty steps only).
  Every edited lesson passes the reader's own `checkLesson`.

## Remaining (highest exam weight first)

- Then biochemistry (56), pathology (44), pharmacology (32), physiology:
  pathway and mechanism diagrams.

## Update 2026-10-14 (branch lessonui-1013)

- **A/B verified, no code change**: shared `PREP_ACTION` action row (lessons,
  pearls, MCQs) already reuses bottom-bar tokens; Report sheet already asks
  why (7 reasons, Other-requires-note, 500 max, queue + retry, backward
  compatible `/api/prep/flag`). Unit + CI browser coverage green.
- **C**: 5 more null-visual steps wired from the existing bank (no new files):
  mstat-sampling x2 (stats-errors, stats-ci-forest), mstat-regression
  (stats-scatter), mstat-design (epi-bias), cm-infectious-epi (epi-curve).
  Audit addendum in `.fleet-reports/LESSON-IMAGE-AUDIT.md` (1449 lessons).

## Update 2026-10-14 (Medical SVGs: Pharma, Micro, Path, Biochem)

- **Lead Note 15:05**: Anatomy and Physiology were temporarily owned by a separate subagent and were skipped in this pass.
- **12 New Original Medical SVGs**: Authored in `prep/lessons/media/` following project palette (#071318 / #0D1D23 / #42CDB5 / #0B6B5B / #B7791F / #B42318), viewBox 800x520 (ar = 1.538462), accessible `<title>`/`<desc>` + step alt text & captions, clean SVG geometry, all numbers verified by recomputation:
  - Pharmacology: `pharma-dose-response.svg`, `pharma-therapeutic-index.svg`, `pharma-elimination-kinetics.svg`
  - Microbiology: `micro-cell-wall.svg`, `micro-growth-curve.svg`, `micro-antibody-response.svg`
  - Pathology: `path-extravasation.svg`, `path-apoptosis-pathways.svg`, `path-granuloma.svg`
  - Biochemistry: `bio-lineweaver-burk.svg`, `bio-glycolysis-tca.svg`, `bio-purine-pathway.svg`
- **Wired into 11 target lessons (12 steps)**:
  - `phm-pharmacodynamics` (step 4)
  - `phm-pharmacokinetics` (step 3 & step 5)
  - `mic-antibodies-complement` (step 2)
  - `mic-history-morphology` (step 2)
  - `mic-culture-identification` (step 2)
  - `pat-acute-inflammation` (step 2)
  - `pat-apoptosis` (step 2)
  - `pat-chronic-granulomatous` (step 4)
  - `bio-enzymes-kinetics` (step 3)
  - `bio-glycolysis-tca` (step 2)
  - `bio-purine-pyrimidine` (step 4)
- **Validation**: All 11 lessons pass `P.checkLesson(l)` cleanly (0 errors).
- **Attribution**: Updated `prep/lessons/media/ATTRIBUTION.md`.

## Update 2026-10-14 (Anatomy & Physiology Diagrams, Lead Note 16:00)

- **Lead Note 16:00 Compliance**: The Claude subagent for Anatomy and Physiology was stopped. Anatomy and Physiology returned to our ownership.
- **Integrated Work**: Inspected `/private/tmp/claude-img-wt` (`claude-img-1014`), cherry-picked all 5 commits (`5c662ccfe`, `29ea042c8`, `51d6c9ec8`, `92aef44a9`, `7297732a1`), including text-legibility width patch (`cw = min(cw, 560)`). Safely removed `/private/tmp/claude-img-wt`.
- **Anatomy**: 74 of 80 lessons now wired with clean, labelled SVGs (batches 1 & 2: 169 SVGs across 123 lessons).
- **Physiology**: 45 of 49 lessons wired with custom curves, axes, Wiggers, Frank-Starling, and pathway figures (batches 1 & 2).
- **Audit Update**: Total 1,449 lessons, 161 now carry verified diagrams (1,288 imageless across all 60 subjects). Detailed inventory written to `.fleet-reports/LESSON-IMAGE-AUDIT.md`.

## Update 2026-10-14 (Upper Controls Unification, Section A Owner Correction)

- **Design Reference**: Bottom player bar untouched; tokens, fills, radii, heights, typography, and press states adopted by all upper controls.
- **Header Controls**: Back circle (`.pn-ib`), share circle (`.pi-sb`), and "Auto" pill (`.pn-lsn-auto`) styled with `var(--pn-s1)` fill, `var(--pn-r-pill)`/50% radius, 44px min touch target, shadowless surface, and `scale(.95)` press feedback.
- **ID Metadata**: Single quiet line with centered `.pn-act-meta` and tap-to-copy pill `.pn-act-chip.pi-chip` (44px min height, 14px padding, `scale(.97)` press).
- **Action Buttons**: Uniform icon+label filled pills in `prep-action-row.css` matching player bar language.
- **Test Passes**: `run-prep-ids-ui.mjs` (ALL PASS), `run-prep-lessons-ui.mjs` (ALL PASS), `run-prep-ui.mjs` (ALL PASS), unit suites (action-row, lessons, prep-server 100% PASS).


