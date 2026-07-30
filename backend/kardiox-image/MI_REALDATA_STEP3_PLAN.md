# Step 3 — layout-crop preprocessor + the corrected phone-photo plan

_Follows Step 1 (v2 measured on real data) + Step 2 (real-data MI fine-tune → clean 0.996, phone
photos 0.448→0.602). Step 2 hypothesised the phone-photo gap was "waveform crop / layout
normalisation + whole-image 320² squash." Step 3 built + tested that preprocessor — and the image
evidence corrected the hypothesis._

## What we built (shipped, this branch)
`layout_crop.py` → `crop_ecg(pil) -> pil`: detects the ECG paper by its **pink grid** (the
ECG-specific signal, robust to arbitrary photo backgrounds), deskews it (minAreaRect), and crops to
the waveform region. Deterministic, CPU-only (OpenCV). **Fail-safe** — any low-confidence detection
returns the ORIGINAL, so it can never be worse than today's full-image squash. Wired (fail-safe
import) into serving (`main.py`), `predict_photo.py`, and the train/eval transforms
(`train_v2.py`, `eval_both.py`). Dockerfile adds `libglib2.0-0` + copies `layout_crop.py`.

## What the image evidence showed (the correction)
Looked at the actual SSMCH set + clean exports:
- **SSMCH phone photos are FULL-FRAME, fairly standard multi-lead ECGs** (grid fills the frame; the
  extras are header text, a handwritten name margin, slight skew, glare). There is almost nothing to
  "crop out" → `crop_ecg` correctly **passes them through unchanged**.
- Therefore **the crop will NOT move the SSMCH benchmark (0.60).** That gap is a **capture-DOMAIN**
  problem (paper texture / lighting / JPEG) + **small n (~43 MI photos in train)** — not clutter or
  layout, as Step 2 had assumed.
- The crop's real value is the **actual app deployment condition**: a clinician snapping an ECG with
  desk/hand around it, where the ECG *is* a sub-region. Validated: on a simulated desk capture
  (ECG shrunk + rotated on a background) `crop_ecg` **isolated and deskewed** the ECG cleanly.

So: keep the crop for **deployment robustness** (it helps real captures, is a no-op on tidy ones),
but do NOT expect it to fix the benchmark.

## Corrected Step 3 — what will actually move the phone-photo number
1. **More phone-photo MI data (the #1 lever).** ~43 SSMCH MI images in train is the bottleneck; you
   cannot learn a hard domain from that. Source more phone-photo MIs (SSMCH-style + Mendeley +
   any new sets), curate labels, add to the corpus (same schema as Step 1 §3).
2. **A "cluttered-capture" augmentation** (new): during training, with some probability paste the
   synthetic/clean render onto a random photographic background + rotate/perspective, THEN apply
   `crop_ecg` — so the model actually learns the crop+deskew deployment pipeline (today the crop is a
   no-op on the clean renders, so training never exercises it). This is the synergy that makes the
   preprocessor pay off in training, not just serving.
3. **Retrain** (`train/master_run_v2.sh` on the VM) with (1)+(2), keeping the **hard no-regression
   gate** on the synthetic-distorted + clean-image MI (Step 2 held 0.845/0.996). Re-measure on the
   SACRED SSMCH + Mendeley held-out (never trained on) + the cross-source test.
4. **Gate to deploy:** beat v2 on the sacred within-source AND cross-source tests AND hold the
   clean/synthetic MI. Stage no-traffic → smoke → human flip. Never auto-flip. (Unchanged discipline.)

## Honest expectation
The crop alone leaves the SSMCH benchmark ~unchanged (it's full-frame). Steps (1)+(2) are what move
it; with meaningfully more phone-photo MI data the 0.60 should climb toward the 0.85+ the clean
images already reach. Small n + single-read (not troponin/cath-confirmed) labels still cap any
clinical claim — this remains experimental, screening-only, human-gated.

## Cost / state
Preprocessor + wiring: $0 (local, CPU). No VM spend yet. Total GCP still ≈ $19 of $50. Production
untouched (serving picks up the crop only on the next deploy of this image; fail-safe if OpenCV
absent). When you're ready to add data + run the retrain, say so and I'll execute §3 on the VM.
