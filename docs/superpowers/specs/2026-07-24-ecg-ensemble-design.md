# KardiQ X — Hierarchical Ensemble ECG Inference Engine (Design Spec)
_Date: 2026-07-24 · Status: approved design, pre-implementation · Owner: StewardMD / KardiQ X_

## 1. Purpose & Scope

Build an **offline benchmark harness** that runs every existing ECG engine independently on the real datasets, fuses their predictions with a **hierarchical, disease-specialist, reliability-weighted** scheme, and produces a rigorous comparison of **ensemble vs. KardiQ X v2 alone**. Keep v2 the primary/served engine; recommend promoting the ensemble **only if benchmarking proves it is demonstrably better**, and never let it underperform v2 on any class.

**In scope:** offline harness, the fusion engine (modular, plugin-based), the 12-lead digitiser→ECGFounder branch (new), an OCR branch (new), a quality-assessment module (new), learned thresholds, and the benchmark report.
**Out of scope (this round):** production Cloud Run serving of the ensemble (a later, gated step if the harness wins), UI changes, retraining any model.

**Non-goals:** no blind averaging; no permanent hard-coded benching of engines; no replacing v2 without proof.

## 2. Guiding Principles (from requirements)

1. **Every engine executes independently on every ECG** and emits prediction + confidence + quality; **all outputs are logged** even when their fusion influence is ~0 (for benchmarking + future model improvement).
2. **Trust is earned, not fixed:** fusion weight = f(benchmark-derived per-class reliability, input quality, calibrated confidence).
3. **Poor branches get negligible/zero influence, never zero execution or logging.**
4. **V2-floor invariant:** no ensemble prediction replaces v2 for a class unless benchmarking proves the ensemble is at least as good for that class.
5. **Thresholds learned from calibration data** wherever possible, not hard-coded.
6. **Modular:** new engines plug into the fusion layer via a fixed interface with no architectural changes.

## 3. Architecture

Offline harness at `ecgf/ensemble/`, runs locally (CPU, ~$0). Nothing touches production.

```
real image ─► QualityAssessor ─► q, type-tag
           ─► for each Branch in REGISTRY (independent, always run, always logged):
                 branch.predict(image) → {canonical_probs, coverage, confidence, quality, raw}
                        │  (persist every raw+canonical output to the branch-output log)
                        ▼
           FusionEngine (hierarchical, per-class, reliability-weighted, V2-floor)
                        ▼
           Calibration (temperature + per-class thresholds) → v3.1 verdict/defer/normal
                        ▼
           BenchmarkHarness → per-class/per-source AUROC (v2 | each branch | ensemble) → go/no-go
```

**Run-once, fuse-many:** all branch outputs are cached to disk keyed on `(image_hash, branch_version)`. Heavy models run once; fusion/threshold tuning re-runs in seconds off the cache.

## 4. Branch Interface (modularity)

```python
class Branch(Protocol):
    name: str
    version: str
    coverage: set[str]                      # canonical classes this branch votes on
    def predict(self, image, ctx) -> BranchOutput
# BranchOutput = {
#   canonical_probs: dict[class -> float],  # mapped into the canonical space
#   confidence:      dict[class -> float],  # per-input certainty (calibrated margin)
#   quality:         float,                 # branch-specific applicability 0..1
#   ok:              bool,                  # did the branch run successfully
#   raw:             Any,                   # full native output, logged verbatim
#   meta:            dict }                 # digitize-SNR, text-found, etc.
```
A `REGISTRY: list[Branch]` drives everything. Fusion, logging, and benchmarking iterate the registry generically. **Adding an engine = implement `Branch` + register; no fusion/harness changes.**

## 5. Canonical Class Space & Mappings

Shared vocabulary (chosen because these are labelable on the real data):
`MI-any, acute-STEMI, AFIB, STACH, SBRAD, ISC, NDT, LVH, NORMAL`.

| Branch | Coverage | Mapping notes |
|---|---|---|
| **KardiQ X v2** (EfficientNet-B3, 19-cls) | all | AMI/IMI/ASMI → MI-any (max); rest direct; NORM direct |
| **MI-specialist** (mireal, binary) | MI-any | direct |
| **Digitiser→ECGFounder 1-lead** (150-cls) | AFIB, STACH, SBRAD, MI-any (weak) | ATRIAL FIBRILLATION→AFIB, SINUS TACHY→STACH, SINUS BRADY→SBRAD, infarct labels→MI-any |
| **Digitiser→ECGFounder 12-lead** (150-cls) [NEW] | all rhythm + MI-any + acute-STEMI | same map; 12-lead reconstruction (see §6) — MI benefits from precordial leads |
| **OCR** [NEW] | all (when text present) | keyword/regex on the machine's printed dx → canonical (reuse SSMCH free-text parser) |

Uncovered class → branch abstains (contributes nothing, still logged).

## 6. New Components

- **12-lead reconstruction:** use `digitiser.onnx` lead segmentation → for each of the 12 leads extract the centre-line waveform, **amplitude-calibrate** (10 mm/mV) and **time-calibrate** (25 mm/s), assemble a `(12, N)` array. Honor the **2.5 s-per-lead limit** of a 3×4 layout (rhythm strip is the only 10 s lead); pad/handle per ECGFounder's expected input. Falls back to 1-lead if reconstruction fails.
- **OCR branch:** lightweight OCR (e.g., Tesseract or a small OCR model) reads the printed interpretation region; text → canonical via the existing parser; `quality` = text-detection confidence; abstains if no text.
- **QualityAssessor:** sharpness (Laplacian variance), grid detectability, glare/exposure, layout/aspect, digitize/reconstruct success → scalar `q` + type-tag (clean / photo / unreadable).

## 7. Fusion Logic

**Per-branch weight:** `w(branch, class, image) = R(branch,class) · Q(branch,image) · g(C(branch,class))`
- `R` = benchmark-derived per-class reliability (calibration AUROC), continuous.
- `Q` = branch-specific input-quality gate (0 if branch inapplicable — e.g., digitize failed, no OCR text).
- `g(C)` = gentle confidence factor from the branch's calibrated prob margin.
- **Zero influence (not zero execution)** when `R` is statistically indistinguishable from chance, or `Q`/`C` below the learned operating point.

**Per canonical class `c`, in priority order:**
1. **OCR override** — confident printed text asserting `c` (or NORMAL) → dominant weight. Capped: if every model strongly contradicts → **conflict → defer**.
2. **Weighted fusion** of surviving branches: `p_c = Σ wᵢ·pᵢ,c / Σ wᵢ`.
3. **No survivor** → v2's prob.

**V2-floor invariant:** final served prob for `c` = ensemble's fused prob **iff** `R_ens(c) ≥ R(v2,c)` (measured on calibration); else v2's prob. Ensemble can only *add*, never *drag v2 down*. Verified empirically in the harness.

**Post-fusion:** calibration (temperature + per-class thresholds) → existing v3.1 verdict/defer/normal/physician-review. Branch conflict → widen uncertainty → defer.

## 8. Learned Thresholds

Learned from the calibration folds, not hard-coded:
- **Reliability gate:** a branch contributes to class `c` only if the **lower 95% CI bound of its calibration AUROC for `c` > 0.5** (statistically above chance). This replaces a fixed `R_floor`.
- **`Q`/`C` operating points:** chosen by optimizing fused validation performance on calibration folds (grid/Bayesian search), per branch.
- **v3.1 verdict/defer thresholds:** per-class, from calibration (Youden / precision-targeted).
All learned values are recorded in the run artifact for auditability. (Sensible priors are used only as search seeds.)

## 9. Benchmark Harness

- **Corpus:** Mendeley (928 clean) + SSMCH (849 photos) = 1,777, canonical labels from folders + SSMCH free-text parser.
- **Evaluation:** **k-fold cross-validation** (data is scarce for some classes) — per fold, fit `R`/thresholds/calibration on train folds, evaluate ensemble on held-out fold; aggregate. No image in both roles within a fold.
- **Metrics per class + macro:** AUROC (primary); at operating point: sensitivity, specificity, PPV, F1, confusion (TP/FP/FN/TN). Computed for **v2-alone, each branch alone, and the ensemble.** Reported **pooled + per source (clean vs photo).**
- **Transparency:** digitize/reconstruct success rate, OCR text-found rate, per-branch nonzero-weight frequency, per-branch + end-to-end latency, RAM.
- **Statistical honesty:** per-class n; bootstrap 95% CIs; classes with n < ~30 (AFib 15, SBRAD 17, LVH 19) flagged "directional, wide CI."

**Success criterion — "demonstrably better than v2"** (all three, on held-out folds):
1. Macro-AUROC(ensemble) ≥ Macro-AUROC(v2) **+0.02**, **and**
2. **no class regresses vs v2 by >0.01** (V2-floor should guarantee; verified), **and**
3. ≥1 of {MI-any, acute-STEMI, AFIB} improves by **≥0.03**.
Met → recommend **staged** promotion (no-traffic → human flip; never auto). Not met → **keep v2**, report which branches helped/didn't and why.

## 10. Error Handling / Graceful Degradation

Branch throws/times out → caught, weight 0, logged, fusion continues. Digitize fails → ECGFounder branch abstains (12-lead → 1-lead fallback; then abstain). No printed text → OCR abstains. All branches skip a class → v2 floor. Unreadable input → defer. Deterministic seeds; cache invalidation on branch-version bump.

## 11. Testing

- **Unit:** each branch's canonical mapping (fixtures → expected vector); QualityAssessor monotonicity (clean > blurred); fusion math (weights normalize; zero-influence below learned gate); **V2-floor invariant property test** (ensemble per-class AUROC ≥ v2 by construction).
- **Sanity:** clean synthetic ECG with known label → sensible per-branch + fused output.
- **Reproducibility:** same inputs → same cached outputs → same metrics.
- **Integration:** the ensemble-vs-v2 CV comparison is the deliverable/integration test.

## 12. Deliverables

- `ecgf/ensemble/` — QualityAssessor, Branch implementations, registry, FusionEngine, harness.
- Per-image **branch-output log** (jsonl/parquet) — every branch's raw + canonical output, for benchmarking + future model improvement.
- `ENSEMBLE_BENCHMARK.md` + `metrics_ensemble.json` — reliability table, per-class/per-source AUROC (v2 | each branch | ensemble), learned thresholds, branch-weight usage, latency/RAM, go/no-go verdict, promotion recommendation (or honest "v2 stays").

## 13. Risks & Open Questions

- **12-lead path may still be near-chance** (single-lead already was) — the harness will settle it; if so its branch gets ~0 learned weight (still logged). Acceptable — that's the point.
- **Tiny per-class n** (AFib 15, etc.) → wide CIs; conclusions on those classes are directional, stated as such.
- **OCR depends on a printed read being present** and legible; abstains otherwise.
- **Domain gap on phone photos** is unlikely to be fully closed by fusion — expected to remain the hard case; ensemble should at least *defer honestly* there.
- **Compute:** local CPU; 12-lead reconstruction + ECGFounder over ~1,777 images is the slow part (~minutes–hours); cached so tuning is cheap.
