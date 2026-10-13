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

## Remaining (highest exam weight first)

- Community medicine: `cm-case-control`, `cm-cohort`, `cm-experimental`,
  `cm-bias-causation`, `cm-descriptive-epi`, `cm-measures`,
  `cm-vital-statistics`, `cm-outbreak-surveillance` (have flow/table/compare
  visuals; need topic figures: epidemic curve, population pyramid, rates tree).
- Then biochemistry (56), pathology (44), pharmacology (32), physiology:
  pathway and mechanism diagrams.
