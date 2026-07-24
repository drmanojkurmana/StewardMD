# KardiQ X serving fix — honest MI screen (staged, 0% traffic)
_Root cause found + fixed at the serving layer. No retrain. Staged as Cloud Run revision `kardiox-image-00009-bej` (tag `miscreen`), 0% traffic — production unchanged until you flip._

## What was broken (proven on 16 real ECGs against the LIVE model)
The live v3 model **confidently mislabels almost everything on real ECGs**: 5/8 real MIs and 5/8 real normals were called "sinus bradycardia" at 0.97–0.99; a normal got a false "URGENT anteroseptal MI" at 0.92; it **never once deferred** and **never said "Normal."** Root cause: scores are uncalibrated/inflated on the real-image domain, so one runaway class wins the top-1 verdict. (The model *ranks* MI-vs-normal fine — AUROC 0.90 — but the served *verdict* is garbage.) Calibration confirmed the model is well-behaved on synthetic (SBRAD mean 0.12) — it's a real-image domain problem, not fixable by calibration, and per-class real labels don't exist.

## The fix (serving rewrite, `main.py` → mi-screen mode, apiVersion 3.0)
- **Headline = MI screen** on the reliable signal (`max(AMI,IMI,ASMI)`), thresholds tuned on real data: ≥0.75 "Possible MI — urgent, confirm 12-lead"; ≥0.55 "Possible ischaemia/MI — review"; else if NORM strong "No acute MI pattern (not a full read)"; else "Inconclusive — physician review."
- **Proven-unreliable rhythm/conduction outputs are demoted** to "possible, UNVERIFIED, confirm on 12-lead" — they can never be the headline verdict.
- **Always flags physician review** unless a confident clean-normal; honest experimental/screening framing throughout; all safety disclaimers kept.

## Before / after (same 16 real ECGs)
| | OLD (live) | NEW (staged) |
|---|---|---|
| 8 real MIs correctly flagged | 2/8 | **8/8** |
| "sinus bradycardia" false headlines | 10/16 | **0** |
| normals confidently mis-verdicted | 8/8 | 0 (5 defer, 3 cautious "possible MI") |
| defers to human when unsure | never | **always** |

## Honest limits (kept)
- **Residual false positives:** ~3/8 normals still get a "possible MI" flag (framed cautiously, review-required) — the model genuinely over-scores MI on some real normals; serving can't fully fix that. It's now a *sensitive, defer-heavy screen*, not a diagnostic reader.
- **Phone photos** remain weak (Step-1: AUROC 0.47) — the screen is most reliable on clean/exported ECGs.
- The real cure for the false positives + phone-photo gap is the **real-data model** (Step-2 direction: more phone-photo MI data). This serving fix makes the *shipped behavior* honest and safe in the meantime.

## Go live (your call — nothing auto-flipped)
```
gcloud run services update-traffic kardiox-image --region us-central1 --to-latest
```
Rollback:
```
gcloud run services update-traffic kardiox-image --region us-central1 --to-revisions kardiox-image-00003-rqx=100
```
Thresholds (MI_URGENT/MI_POSSIBLE in main.py) are a sensitivity↔specificity knob — raise them to cut false positives, lower to catch more. Total GCP ~$20/$50. Not git-pushed.
