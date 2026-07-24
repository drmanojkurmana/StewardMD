# Step 1 Results — production v2 measured on real ECGs (no training)
_1,777 real images (Mendeley clean exports + SSMCH phone photos). MI-any score = max(P_AMI,P_IMI,P_ASMI). AUROC = threshold-free._

## Headline
**v2 works on clean real ECGs, and completely fails on real phone photos. The problem is capture/layout domain shift — NOT the pathology.**

| Test | AUROC | Read |
|---|---|---|
| MI-any vs Normal — **Mendeley (clean digital exports)** | **0.90** | v2 genuinely detects MI on clean real ECGs — first proof it transfers to real data at all |
| MI-any vs Normal — **SSMCH (real phone photos)** | **0.47** | **below chance** — v2 cannot read phone-photographed / oddly-laid-out ECGs |
| Acute STEMI vs Normal — SSMCH (explicit STEMI label) | 0.48 (vs SSMCH-normal) / 0.57 (vs all-normal) | no real STEMI discrimination on photos |
| MI-any vs Normal — pooled | 0.77 | misleading average of the two regimes |
| _(reference: v2 on synthetic distorted)_ | _0.876_ | |

## Why (score separation by group, mean MI-any)
- Mendeley MI **0.872** vs Mendeley Normal **0.465** → clean separation ⇒ AUROC 0.90.
- SSMCH STEMI **0.625** vs SSMCH Normal **0.656** → *inverted / no separation* ⇒ AUROC < 0.5. On phone photos the model is responding to layout/paper/photo artifacts, not the infarct.
- Confusion @0.5 on SSMCH: specificity **0.21** (fires "MI" on almost everything) — useless on photos. On Mendeley: sens 0.92 / ppv 0.79 / spec 0.65 — usable.

## Interpretation (honest)
1. **Good news:** v2 did learn real MI morphology — it holds up on *clean* real ECG images (0.90), which we had never verified. On clean digital ECGs the current production model is legitimately useful.
2. **The gap:** it breaks entirely on **real phone photos of paper printouts with a non-standard layout** (SSMCH). This is the exact deployment condition (a user snapping an ECG with a phone), and it's the sim-to-real + layout gap — not a pathology-learning failure.
3. **This is highly fixable** because we now have the phone-photo data (SSMCH) that exposes it. Fine-tuning/adapting on real phone photos + their layout is precisely the fix, and it's what Step 2 does.

## Verdict on Step 2
**Warranted.** Step 1's whole purpose was to decide this: the gap is real, localized (phone-photo/layout, not pathology), and fixable with data in hand. Recommend proceeding to Step 2 (fine-tune with real phone-photo augmentation + SSMCH layout; no-regression gate on the clean-image and synthetic MI performance; sacred held-out real test incl. cross-source).

## Cost / state
- Step 1 added ~$0.10 (e2-standard-8, ~15 min). Total GCP ≈ $17 of $50. VM stopped. Production untouched.
