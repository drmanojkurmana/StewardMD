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
  independent parse-and-assert pass (`/tmp/verify_epi_figs.py`); two label
  gaps it caught (unprinted 174 totals, abbreviated ENVIRONMENT) were fixed
  before wiring. No external images, still no third-party attribution.
- **Wired** into the remaining 8 community-medicine epi/stats lessons (9
  steps): `cm-descriptive-epi` x2 (one compare replaced where the curve
  teaches the same point-source content, one empty step), `cm-measures`,
  `cm-vital-statistics`, `cm-outbreak-surveillance`, `cm-case-control`,
  `cm-cohort`, `cm-experimental`, `cm-bias-causation` (empty steps only).
  Every edited lesson passes the reader's own `checkLesson`.

## Remaining (highest exam weight first)

- Then biochemistry (56), pathology (44), pharmacology (32), physiology:
  pathway and mechanism diagrams.
