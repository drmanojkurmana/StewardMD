# KardiQ X — MI/STEMI/NSTEMI Fine-Tune Report
_Autonomous overnight run • 2026-07-23/24 • budget-capped at $50_

## Bottom line
**The new MI-focused model did NOT clearly beat production. Production (v2 + v3 safety guards) is kept unchanged. Nothing was deployed.**

- New TEST distorted **MI-macro AUROC (AMI/IMI/ASMI) = 0.8724** vs production **v2 = 0.8756** → **−0.0032** (a tie, marginally worse).
- Promotion gate required **≥ +0.005 with no per-MI regression and no non-MI regression > 0.02**. It failed on all three: no gain, **IMI** regressed, and **1AVB** (non-MI) regressed.
- Decision (per your spec "if no model clearly beats production, keep the existing model"): **KEEP PRODUCTION. `safe_to_replace_production = false`.**

## Important honesty note — STEMI / NSTEMI are not in the data
The training data (synthetic renders of PTB-XL) has **no STEMI vs NSTEMI labels**. PTB-XL's MI labels are *location patterns* — **AMI** (anterior), **IMI** (inferior), **ASMI** (anteroseptal) — plus **ISC_** (ischaemia). A true STEMI/NSTEMI classifier **cannot** be trained from this data without inventing labels. This run optimized the MI-pattern classes that actually exist. **Getting real, acute-MI/occlusion-labeled ECG data is the #1 requirement for genuine STEMI/NSTEMI detection** (roadmap below).

## What was done (exactly per your requirements)
- **Fine-tuned FROM production v2** (not from scratch) so the model starts at v2's behavior and only moves MI.
- **Removed aggressive augmentation** — no blur, JPEG, perspective warp, or elastic distortion. Light only (small rotation/affine/color).
- **Class-balanced sampling** oversampling MI-containing images (AMI rarest → highest weight).
- **Higher loss weight on MI only** (AMI/IMI/ASMI = full; ISC_ = 0.7; all others damped to 0.35 so they stay ~unchanged).
- **Best checkpoint only**, selected on distorted (real-photo-proxy) MI-AUROC; **early-stopped** after 4 epochs when MI stopped improving (best = epoch 1).
- **Evaluated head-to-head vs production** on the identical 1,701-record distorted test set (same seeded distortion for both models → apples-to-apples).

## MI metrics: new vs production (distorted = real-photo proxy; AUROC is threshold-free & the fair metric)

| Class | v2 (prod) | New | Δ | Verdict |
|---|---|---|---|---|
| AMI (anterior MI) | 0.8461 | 0.8505 | **+0.0044** | marginally better |
| IMI (inferior MI) | 0.8576 | 0.8486 | **−0.0090** | regressed |
| ASMI (anteroseptal MI) | 0.9230 | 0.9180 | **−0.0049** | ~tie, slightly worse |
| ISC_ (ischaemia) | 0.8952 | 0.8822 | **−0.0130** | regressed |
| **MI-macro (AMI/IMI/ASMI)** | **0.8756** | **0.8724** | **−0.0032** | **no improvement** |

_(Clean-image MI-macro was high — new 0.9274 — but clean is not the real-world condition; distorted is the metric that matters.)_

## Confusion matrices & false-positives/negatives (distorted test)
Thresholds differ (new = Youden-optimal per class; v2 = its serving 0.5), so treat sensitivity/PPV as directional; **AUROC above is the fair head-to-head.**

**AMI** (31 positives): New tp=21 fp=333 fn=10 tn=1337 → sens 0.68, PPV 0.06 · v2@0.5 tp=16 fp=152 fn=15 tn=1518 → sens 0.52, PPV 0.10
→ new catches more AMI (10 vs 15 missed) but with far more false alarms (333 vs 152).

**IMI** (223 pos): New tp=174 fp=385 fn=49 → sens 0.78, PPV 0.31 · v2@0.5 tp=161 fp=296 fn=62 → sens 0.72, PPV 0.35

**ASMI** (187 pos): New tp=166 fp=306 fn=21 → sens 0.89, PPV 0.35 · v2@0.5 tp=160 fp=301 fn=27 → sens 0.86, PPV 0.35

**ISC_** (199 pos): New tp=146 fp=234 fn=53 → sens 0.73, PPV 0.38 · v2@0.5 tp=150 fp=188 fn=49 → sens 0.75, PPV 0.44

## Non-MI check
Only **1AVB** regressed beyond the 0.02 tolerance (0.7954 → 0.7716, −0.0238). Most other classes moved <0.015. **STTC improved dramatically (0.45 → 0.84)** — an incidental side effect: this run trained on the *real* STTC labels present in the dataset, whereas v2's STTC head was trained on all-zero labels. Not the MI goal, but it confirms the STTC label-fix hypothesis.

## Why it didn't beat production, and what actually would
Two independent retrains now agree that **v2 is at the ceiling of this synthetic data for MI**: the earlier heavier-aug v4 regressed MI badly, and this MI-focused, MI-weighted, light-aug fine-tune landed on a tie. MI emphasis traded a tiny AMI gain for small IMI/ASMI/ISC_ losses. The lever is **not** more synthetic training. Ranked next steps for a *materially* better MI model:
1. **Real ECG-photo data** (clinician-labeled phone photos + PhysioNet ECG-Image-Database). This is the dominant limitation — every number here is on synthetic renders/distortion proxy, never a real phone snap. **Highest impact.**
2. **Acute-MI/occlusion-labeled data** to build the actual STEMI/NSTEMI capability the tool currently disclaims (NOT_ASSESSED). This is the real clinical prize.
3. **Better checkpoint selection** — selecting on a noisy 1,200-image distorted-val subset picked epoch 1, which didn't translate to a test gain. A full-val, per-class MI selection would be more reliable.
4. **Calibrate v2** (per-class temperature + thresholds) — cheap trust win; doesn't change AUROC ranking but makes shown probabilities honest.

## Separate: STTC "v2.1" ship-review outcome (from the adversarial review)
The earlier STTC splice (staged Cloud Run revision, 0% traffic) is **GO-with-conditions, NOT shipped**. The review caught a real bug: un-suppressed STTC is verdict-eligible and could outrank a present MI, flipping the headline to "ST-T changes" (under-triage). Before that ever ships it needs: (a) STTC made finding/differential-only (never the headline verdict), and (b) the fail-open guard fixed (if the STTC head is missing, stay suppressed, don't serve v2's broken head). That revision stays parked.

## Cost, state, housekeeping
- **Total GCP spend ≈ $16 of the $50 budget.** Training VM (`kardiox-train3`) **stopped** (not deleted — dataset + best checkpoint `~/image_model_mi.pt` preserved on its disk).
- Production Cloud Run **unchanged** — live v3 at 100% traffic throughout; no traffic was ever redirected.
- Best checkpoint (only the best was kept, per spec): `~/image_model_mi.pt` on the VM; metrics at `metrics_mi.json` (pulled locally).
- **No git push** — working tree has uncommitted edits (the parked v2.1 STTC change + MI artifacts). Commit when you decide what to keep.

## If you want to proceed (your call — nothing was auto-deployed)
- To pursue real improvement: greenlight acquiring a real ECG-photo eval/finetune set (roadmap #1). I can scaffold the ingestion + re-eval of v2/v4/new against it.
- The MI checkpoint from tonight is preserved if you want to inspect it, but I do not recommend deploying it — it does not beat production.
