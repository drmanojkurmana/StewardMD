# Step 2 Results — real-data MI-detector fine-tune (binary MI-any)
_Fine-tuned from v2 backbone on real (Mendeley+SSMCH) + synthetic, phone-photo aug. Matched head-to-head vs v2 on a SACRED held-out real test (444 imgs, never trained on) + synthetic no-regression. MI-any AUROC._

## Result table (new model vs production v2, same held-out images)
| Test slice | n (pos) | **v2** | **new** | Δ |
|---|---|---|---|---|
| **Mendeley — clean exports** | 232 (103) | 0.851 | **0.996** | **+0.145** |
| **SSMCH — real phone photos** | 212 (35) | 0.448 | **0.602** | **+0.154** |
| Pooled real | 444 (138) | 0.743 | **0.927** | +0.184 |
| Synthetic distorted (no-regression) | 1701 | 0.846 | 0.845 | −0.001 ✓ |

## Honest verdict
**Fine-tuning on real data clearly helped, with zero regression on synthetic — but the phone-photo problem is improved, not solved.**

- ✅ **Clean real ECGs: essentially solved** — 0.851 → **0.996**. On digital ECG exports / screenshots the new detector is near-perfect.
- ⚠️ **Phone photos (SSMCH): improved but still weak** — 0.448 (worse-than-chance) → **0.602**. That's a real +0.15 gain and it's no longer broken, but **AUROC 0.60 is not a reliable detector** — not good enough to lean on clinically.
- ✅ **No regression** on the synthetic distorted MI (0.845 vs 0.846) — anti-forgetting worked.

## Why phone photos are still weak (and it's expected)
- **Tiny phone-photo MI training set:** only ~43 SSMCH MI images in the train split (71 total × 0.6). You cannot learn a hard new domain (unusual continuous multi-row layout + real capture noise) from ~43 positives.
- **SSMCH test n_pos = 35** → the 0.60 estimate has wide confidence intervals; treat as directional.
- **Layout shift:** SSMCH's photographed layout differs a lot from the 3×4 the model mostly saw; whole-image squashing to 320² hurts.

## Deploy decision: NOT yet (recommend hold + more data)
- The new model is a **binary MI-any head** — deploying it changes serving semantics and needs integration (it doesn't replace the 18-class output the app uses). That alone makes it a human-gated change.
- More importantly, 0.60 on the actual deployment condition (phone photos) doesn't justify shipping a phone-photo MI detector yet.
- **The clean-image gain (→0.996) is genuinely strong** and could be folded into a future v2.2 if clean-image MI detection is a priority — but that's a separate decision.

## Highest-value next step
**More phone-photo MI data + layout handling**, then re-train. Specifically: (a) more SSMCH-style phone photos of MI (the current ~43 is the bottleneck), (b) a waveform-region crop / layout-normalization preprocessing step, (c) ideally troponin/cath-confirmed acute-MI labels for a real STEMI claim. With those, the phone-photo number should move from 0.60 toward the 0.85+ the clean images already reach.

## Cost / state
- Step 2 ≈ $0.60 (e2-standard-16, ~1 h). **Total GCP ≈ $19 of $50.** VM stopped. Production untouched. Best checkpoint: `image_model_mireal.pt` (local + on VM). No git push.
