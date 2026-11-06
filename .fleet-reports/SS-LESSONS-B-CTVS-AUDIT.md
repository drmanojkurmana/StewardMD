# Lane B ss-ctvs audit (stage 1, blueprint still todo) — 2026-11-06

Scope: existing CTVS lessons while the blueprint is `todo` (lane A writes it).
PR #2008 (branch `ss-lessons-B-ctvs-audit`, tip e93989f15) already covers
`sct-coronary-valve` (steps 2, 8: CABG graft anatomy + CPB cannulation figures)
and `sct-thoracic` (step 1: thoracic-procedures panel). Green 9/9, MERGEABLE/CLEAN,
held only for the blind fact-check (UNCHECKED muse writer, FLAGS rows present).

## This run: `sur-thoracic` verdict — KEEP, no swap

All four code-drawn visuals are meaningful and exam-useful; none is wrong or
decorative, so none is removed (image-typo rule: nothing to repaint either):

| Step | Point | Visual | Verdict |
|---|---|---|---|
| 1 | NSCLC histology + PFT resectability cut-offs | table (ppoFEV1/ppoDLCO 40/30, VO2, RCRI) | KEEP: cut-off numbers live only in this table + tx |
| 2 | VATS lobectomy pathway | flow (nodule -> PET/EBUS -> stage -> VATS) | KEEP: pathway logic; image would drop the sequence |
| 3 | Pneumothorax surgical indications | table (2nd ipsilateral, air leak >3d, tension, high-risk job) | KEEP: indication rows are the step's exam core |
| 4 | Empyema phases -> decortication | compare (exudative vs organizing) | KEEP: phase criteria (pH 7.2, glucose 40) |

`checkLesson []`, tx 65-73 words, say 27-32 words. Narration-gate flag already in
LESSONS-GARBLED.md (1 sentence, audit-only, not rewritten in this job).

## Suitable KB figures identified for the stage-2 rewrite (all HTTP 200, viewed)

- `v1/kb/media/lung-cancer-fig1.webp` — central hilar mass, peripheral
  adenocarcinoma, Pancoast tumour, mediastinal nodes, pleural invasion.
  Fits step 1. Labels clean, no typos.
- `v1/kb/media/disorders-of-the-pleura-fig1.webp` — normal lung vs tension
  pneumothorax, mediastinal shift, needle decompression. Fits step 3's
  tension row. Labels clean, no typos.
- `v1/kb/media/fibrothorax-fig1.webp` — fibrothorax CT (calcified rind, trapped
  lung) + decortication with lung re-expansion. Fits step 4. Labels clean.
- `v1/kb/media/sct-thoracic-lung-trauma-fig1.webp` (VATS lobectomy panel) already
  used in `sct-thoracic` step 1 on the audit branch; NOT duplicated here to avoid
  cross-lesson duplication. Revisit at stage 2 when sct/sur overlap is merged.

No IMAGE-NEEDS rows: suitable images exist, steps just have no null-vis slot.
No IMAGES-REMOVED rows: nothing removed. Stage-2 rewrite (after lane A blueprint)
should place the three figures above and keep the cut-off/indication tables'
numbers in tx.
