"""BenchmarkPipeline — model evaluation + cross-dataset external validation (KardioX training layer).

Adopts the ExChanGeAI (MIT) benchmark practice: a trained/exported ECG model is scored on a HELD-OUT split
with a rich metric panel (weighted F1, macro/micro F1, accuracy, precision, recall, Brier, ECE, per-class,
confusion matrix, Fmax per-class thresholds, bootstrapped 95 % CI for the headline metric) plus a
computational panel (per-call inference latency mean/SD). `cross_validate` runs the SAME model against a
set of datasets and reports per-dataset metrics + the average/median across datasets — ExChanGeAI's
cross-dataset external-validation view that exposes generalization gaps.

The model under test is a plain callable `model_fn(signal_dict) -> {label: prob}` (or a probability vector
aligned to the label space). That keeps this pipeline decoupled from torch/onnx: a real backend wraps its
`predict` as this callable, and unit tests pass a STUB `model_fn` + a synthetic `DatasetProvider` — no heavy
dependency needed to exercise the orchestration. The split is STREAMED through the provider one Sample at a
time (memory-safe); only the small per-sample label/probability rows are accumulated for scoring.

Metrics are computed with lazily-imported numpy. scikit-learn is OPTIONAL: when present it adds AUROC/AUPRC;
when absent those are reported as null with a note and every other metric is still computed from numpy.

Expected input:  a `DatasetProvider` (streams `Sample`s whose `.labels` are the ground truth) and a
                 `model_fn` mapping `Sample.to_signal()` -> {label: prob} or a prob vector over the label
                 space; optional `label_space` override, `split`, and `limit`.
Expected output: `evaluate` -> a JSON-serialisable metrics dict (see keys above); `cross_validate` ->
                 {"perDataset", "average", "median", "evaluated", "n", ...}.
Failure modes:   empty label space -> ValueError; a `model_fn` output whose length != label count or of an
                 unsupported type -> ValueError; a provider whose split yields no samples, or whose data is
                 absent -> DatasetUnavailable (never fabricated); missing numpy -> RuntimeError. In
                 `cross_validate`, a dataset that is unavailable/invalid is recorded as
                 {"available": False, ...} and simply excluded from the aggregate rather than aborting the run.
Boundary:        this module ORCHESTRATES + SCORES honestly; it makes no accuracy claim of its own — numbers
                 are only as good as the operator-supplied labels and the injected `model_fn`.
"""
from __future__ import annotations

import statistics
import time
from collections.abc import Mapping
from typing import Any, Callable

from app.data.base import DatasetProvider, DatasetUnavailable

# signal dict -> {label: prob} mapping OR a probability vector aligned to the label space.
ModelFn = Callable[[dict], Any]

DEFAULT_THRESHOLD = 0.5      # decision threshold for the multi-hot precision/recall/F1/accuracy panel
DEFAULT_N_BOOT = 1000        # bootstrap resamples for the headline-metric 95 % CI
DEFAULT_ECE_BINS = 15        # reliability-diagram bins for expected calibration error
DEFAULT_FMAX_GRID = 101      # threshold grid points (inclusive 0..1) for Fmax search
DEFAULT_SEED = 42            # deterministic bootstrap RNG seed


# ── lazy dependency seams (heavy libs never imported at module load) ─────────────────────────────
def _lazy_numpy():
    """Import numpy lazily. Failure mode: RuntimeError if numpy is not installed."""
    try:
        import numpy as np
        return np
    except ImportError as e:  # pragma: no cover - only when numpy is absent
        raise RuntimeError("benchmark metrics require numpy (pip install numpy)") from e


def _lazy_sklearn():
    """Import sklearn.metrics lazily; return None when unavailable so scoring degrades gracefully."""
    try:
        import sklearn.metrics as skm
        return skm
    except Exception:  # pragma: no cover - only when sklearn is absent
        return None


# ── encoding helpers ─────────────────────────────────────────────────────────────────────────────
def _encode_multihot(labels: list[str] | None, index: dict[str, int], np) -> Any:
    """Ground-truth labels -> multi-hot row over the label space (unknown labels ignored)."""
    row = np.zeros(len(index), dtype="float64")
    for lab in labels or []:
        j = index.get(lab)
        if j is not None:
            row[j] = 1.0
    return row


def _to_prob_row(pred: Any, label_space: list[str], index: dict[str, int], np) -> Any:
    """Normalise a model_fn return into a clipped probability row aligned to `label_space`.

    Accepts a {label: prob} mapping (missing labels -> 0) or a 1-D probability sequence/array of length K.
    NaN/inf are coerced to safe values and everything is clipped to [0, 1]. Failure mode: ValueError on a
    length mismatch or an un-arrayable type."""
    k = len(label_space)
    if isinstance(pred, Mapping):
        row = np.zeros(k, dtype="float64")
        for lab, val in pred.items():
            j = index.get(lab)
            if j is not None:
                row[j] = float(val)
    else:
        try:
            row = np.asarray(pred, dtype="float64").ravel()
        except (TypeError, ValueError) as e:
            raise ValueError(f"model_fn returned an unsupported type {type(pred).__name__}") from e
        if row.size != k:
            raise ValueError(f"model_fn returned {row.size} probabilities but the label space has {k} classes")
    row = np.nan_to_num(row, nan=0.0, posinf=1.0, neginf=0.0)
    return np.clip(row, 0.0, 1.0)


# ── metric primitives (pure numpy; work without sklearn) ─────────────────────────────────────────
def _prf_at(yt, yp, thr: float, np):
    """Per-class tp/fp/fn/tn/support/precision/recall/f1 at a decision threshold (arrays of length K)."""
    pred = (yp >= thr).astype("float64")
    tp = (pred * yt).sum(axis=0)
    fp = (pred * (1.0 - yt)).sum(axis=0)
    fn = ((1.0 - pred) * yt).sum(axis=0)
    tn = ((1.0 - pred) * (1.0 - yt)).sum(axis=0)
    support = yt.sum(axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        prec = np.where((tp + fp) > 0, tp / (tp + fp), 0.0)
        rec = np.where((tp + fn) > 0, tp / (tp + fn), 0.0)
        f1 = np.where((prec + rec) > 0, 2.0 * prec * rec / (prec + rec), 0.0)
    return tp, fp, fn, tn, support, prec, rec, f1


def _weighted_f1(yt, yp, thr: float, np) -> float:
    _, _, _, _, support, _, _, f1 = _prf_at(yt, yp, thr, np)
    tot = support.sum()
    return float((f1 * support).sum() / tot) if tot > 0 else 0.0


def _macro_f1(yt, yp, thr: float, np) -> float:
    _, _, _, _, _, _, _, f1 = _prf_at(yt, yp, thr, np)
    return float(f1.mean()) if f1.size else 0.0


def _exact_match(yt, yp, thr: float, np) -> float:
    pred = (yp >= thr).astype("float64")
    return float((pred == yt).all(axis=1).mean()) if yt.shape[0] else 0.0


def _ece(yt, yp, np, n_bins: int) -> float:
    """Expected calibration error over flattened label cells (reliability-diagram, equal-width bins)."""
    p = yp.ravel()
    y = yt.ravel()
    n = p.size
    if n == 0:
        return 0.0
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p <= hi) if i == n_bins - 1 else (p >= lo) & (p < hi)
        cnt = int(mask.sum())
        if cnt == 0:
            continue
        ece += (cnt / n) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return float(ece)


def _confusion_top1(yt, yp, np) -> list[list[int]]:
    """Top-1 (argmax) K×K confusion matrix over samples that carry at least one true label."""
    k = yt.shape[1]
    cm = np.zeros((k, k), dtype="int64")
    has = yt.sum(axis=1) > 0
    if not bool(has.any()):
        return cm.tolist()
    t = yt[has].argmax(axis=1)
    p = yp[has].argmax(axis=1)
    for ti, pi in zip(t.tolist(), p.tolist()):
        cm[ti, pi] += 1
    return cm.tolist()


def _fmax(yt, yp, labels: list[str], grid, np) -> dict:
    """Per-class Fmax threshold suggestions + a global (micro) Fmax over a shared threshold grid."""
    per_class = []
    for j, name in enumerate(labels):
        col_t = yt[:, j]
        col_p = yp[:, j]
        best_f1, best_thr = 0.0, float(grid[0])
        for thr in grid:
            pred = col_p >= thr
            tp = float(np.logical_and(pred, col_t == 1).sum())
            fp = float(np.logical_and(pred, col_t == 0).sum())
            fn = float(np.logical_and(~pred, col_t == 1).sum())
            denom = 2.0 * tp + fp + fn
            f1 = (2.0 * tp / denom) if denom > 0 else 0.0
            if f1 > best_f1:
                best_f1, best_thr = f1, float(thr)
        per_class.append({"label": name, "threshold": round(best_thr, 6),
                          "f1": round(best_f1, 6), "support": int(col_t.sum())})
    g_best_f1, g_best_thr = 0.0, float(grid[0])
    for thr in grid:
        pred = yp >= thr
        tp = float(np.logical_and(pred, yt == 1).sum())
        fp = float(np.logical_and(pred, yt == 0).sum())
        fn = float(np.logical_and(~pred, yt == 1).sum())
        denom = 2.0 * tp + fp + fn
        f1 = (2.0 * tp / denom) if denom > 0 else 0.0
        if f1 > g_best_f1:
            g_best_f1, g_best_thr = f1, float(thr)
    return {"global": {"threshold": round(g_best_thr, 6), "microF1": round(g_best_f1, 6)},
            "perClass": per_class}


def _bootstrap_ci(yt, yp, headline_fn, thr: float, np, n_boot: int, seed: int) -> dict:
    """Percentile bootstrap 95 % CI for a headline metric (deterministic given `seed`)."""
    n = yt.shape[0]
    point = float(headline_fn(yt, yp, thr))
    if n < 2 or n_boot < 1:
        return {"point": round(point, 6), "lo": round(point, 6), "hi": round(point, 6),
                "nBoot": 0, "note": "insufficient samples for bootstrap"}
    rng = np.random.default_rng(seed)
    vals = np.empty(n_boot, dtype="float64")
    for b in range(n_boot):
        idx = rng.integers(0, n, size=n)
        vals[b] = headline_fn(yt[idx], yp[idx], thr)
    return {"point": round(point, 6), "lo": round(float(np.percentile(vals, 2.5)), 6),
            "hi": round(float(np.percentile(vals, 97.5)), 6), "nBoot": int(n_boot)}


# ── pipeline ───────────────────────────────────────────────────────────────────────────────────────
class BenchmarkPipeline:
    """Evaluate a `model_fn` against a streamed dataset split and across multiple datasets.

    Expected input:  construction knobs (decision threshold, bootstrap count, ECE bins, Fmax grid, seed);
                     then a `DatasetProvider` + `model_fn` per `evaluate`/`cross_validate` call.
    Expected output: JSON-serialisable metrics dicts (see module docstring).
    Failure modes:   see `evaluate`/`cross_validate`.
    """

    def __init__(self, *, threshold: float = DEFAULT_THRESHOLD, n_boot: int = DEFAULT_N_BOOT,
                 ece_bins: int = DEFAULT_ECE_BINS, fmax_grid: int = DEFAULT_FMAX_GRID,
                 seed: int = DEFAULT_SEED):
        self.threshold = float(threshold)
        self.n_boot = int(n_boot)
        self.ece_bins = int(ece_bins)
        self.fmax_grid = max(2, int(fmax_grid))
        self.seed = int(seed)

    # ── single-dataset evaluation ────────────────────────────────────────────────────────────────
    def evaluate(self, provider: DatasetProvider, model_fn: ModelFn, split: str | None = "test",
                 limit: int | None = None, label_space: list[str] | None = None, *,
                 threshold: float | None = None, headline: str = "weightedF1") -> dict:
        """Stream a split, score `model_fn`, and return the full metric panel.

        Expected input:  a `DatasetProvider` yielding `Sample`s with ground-truth `.labels`; a
                         `model_fn(signal_dict) -> {label: prob} | prob-vector`; optional `label_space`
                         override (defaults to `provider.label_space()`); `split`/`limit`; `threshold`
                         override; `headline` in {"weightedF1","macroF1","accuracy"} for the CI metric.
        Expected output: a dict with weightedF1/macroF1/microF1, accuracy/exactMatch/hammingAccuracy,
                         precision/recall (+ macro/micro variants), brier, ece, perClass, confusionTop1,
                         fmax, ci95, latency, plus n/labelSpace/split/dataset/threshold and (if sklearn is
                         installed) auroc/auprc; `notes` records anything that could not be computed.
        Failure modes:   empty label space -> ValueError; bad `model_fn` output -> ValueError; no samples
                         streamed / data absent -> DatasetUnavailable; numpy missing -> RuntimeError.
        """
        np = _lazy_numpy()
        labels = list(label_space) if label_space is not None else list(provider.label_space() or [])
        if not labels:
            name = getattr(provider, "name", "?")
            raise ValueError(
                f"benchmark requires a non-empty label space (provider '{name}' exposes none; pass label_space=)")
        index = {lab: i for i, lab in enumerate(labels)}
        thr = self.threshold if threshold is None else float(threshold)

        yt_rows: list[Any] = []
        yp_rows: list[Any] = []
        latencies_ms: list[float] = []
        n = 0
        for sample in provider.iter_samples(split=split, limit=limit):
            signal = sample.to_signal()
            t0 = time.perf_counter()
            pred = model_fn(signal)
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)
            yt_rows.append(_encode_multihot(sample.labels, index, np))
            yp_rows.append(_to_prob_row(pred, labels, index, np))
            n += 1

        if n == 0:
            name = getattr(provider, "name", "?")
            raise DatasetUnavailable(f"{name}: no samples streamed for split={split!r}")

        yt = np.vstack(yt_rows)
        yp = np.vstack(yp_rows)
        result = self._compute(yt, yp, labels, np, thr, headline)
        result.update({"n": n, "labelSpace": labels, "split": split, "threshold": thr,
                       "dataset": getattr(provider, "name", None), "latency": _latency_stats(latencies_ms)})
        return result

    def _compute(self, yt, yp, labels: list[str], np, thr: float, headline: str) -> dict:
        """Assemble the metric dict from accumulated multi-hot truth `yt` and probabilities `yp`."""
        tp, fp, fn, tn, support, prec, rec, f1 = _prf_at(yt, yp, thr, np)
        tot = float(support.sum())
        w_f1 = float((f1 * support).sum() / tot) if tot > 0 else 0.0
        w_prec = float((prec * support).sum() / tot) if tot > 0 else 0.0
        w_rec = float((rec * support).sum() / tot) if tot > 0 else 0.0
        tp_t, fp_t, fn_t = float(tp.sum()), float(fp.sum()), float(fn.sum())
        micro_prec = tp_t / (tp_t + fp_t) if (tp_t + fp_t) > 0 else 0.0
        micro_rec = tp_t / (tp_t + fn_t) if (tp_t + fn_t) > 0 else 0.0
        micro_f1 = (2 * micro_prec * micro_rec / (micro_prec + micro_rec)
                    ) if (micro_prec + micro_rec) > 0 else 0.0

        per_class = [{"label": labels[j], "precision": round(float(prec[j]), 6),
                      "recall": round(float(rec[j]), 6), "f1": round(float(f1[j]), 6),
                      "support": int(support[j]), "tp": int(tp[j]), "fp": int(fp[j]),
                      "fn": int(fn[j]), "tn": int(tn[j])} for j in range(len(labels))]

        headline_fns = {"weightedF1": _weighted_f1, "macroF1": _macro_f1, "accuracy": _exact_match}
        headline_key = headline if headline in headline_fns else "weightedF1"

        def _hfn(a, b, t):
            return headline_fns[headline_key](a, b, t, np)

        ci = _bootstrap_ci(yt, yp, _hfn, thr, np, self.n_boot, self.seed)
        ci["metric"] = headline_key

        result: dict[str, Any] = {
            "weightedF1": round(w_f1, 6), "macroF1": round(_macro_f1(yt, yp, thr, np), 6),
            "microF1": round(micro_f1, 6),
            "accuracy": round(_exact_match(yt, yp, thr, np), 6),
            "exactMatch": round(_exact_match(yt, yp, thr, np), 6),
            "hammingAccuracy": round(float(((yp >= thr).astype("float64") == yt).mean()), 6),
            "precision": round(w_prec, 6), "recall": round(w_rec, 6),
            "macroPrecision": round(float(prec.mean()) if prec.size else 0.0, 6),
            "macroRecall": round(float(rec.mean()) if rec.size else 0.0, 6),
            "microPrecision": round(micro_prec, 6), "microRecall": round(micro_rec, 6),
            "brier": round(float(((yp - yt) ** 2).mean()), 6),
            "ece": round(_ece(yt, yp, np, self.ece_bins), 6),
            "perClass": per_class,
            "confusionTop1": _confusion_top1(yt, yp, np),
            "fmax": _fmax(yt, yp, labels, np.linspace(0.0, 1.0, self.fmax_grid), np),
            "ci95": ci,
            "notes": [],
        }
        self._add_sklearn_metrics(result, yt, yp, np)
        return result

    @staticmethod
    def _add_sklearn_metrics(result: dict, yt, yp, np) -> None:
        """Add AUROC/AUPRC when scikit-learn is installed; otherwise record a note (graceful degradation)."""
        skm = _lazy_sklearn()
        if skm is None:
            result["auroc"] = None
            result["auprc"] = None
            result["notes"].append("AUROC/AUPRC not computed: scikit-learn is not installed")
            return
        auroc: dict[str, float] = {}
        for avg in ("macro", "weighted", "micro"):
            try:
                auroc[avg] = round(float(skm.roc_auc_score(yt, yp, average=avg)), 6)
            except Exception as e:  # a class with only one outcome, degenerate input, etc.
                result["notes"].append(f"AUROC[{avg}] unavailable: {type(e).__name__}")
        auprc: dict[str, float] = {}
        for avg in ("macro", "weighted", "micro"):
            try:
                auprc[avg] = round(float(skm.average_precision_score(yt, yp, average=avg)), 6)
            except Exception as e:
                result["notes"].append(f"AUPRC[{avg}] unavailable: {type(e).__name__}")
        result["auroc"] = auroc or None
        result["auprc"] = auprc or None

    # ── cross-dataset external validation ──────────────────────────────────────────────────────────
    def cross_validate(self, providers: dict[str, DatasetProvider], model_fn: ModelFn,
                        split: str | None = "test", limit: int | None = None,
                        label_space: list[str] | None = None, *, threshold: float | None = None,
                        headline: str = "weightedF1") -> dict:
        """Run the SAME `model_fn` against several datasets and aggregate across them (ExChanGeAI view).

        Expected input:  `providers` mapping name -> `DatasetProvider`; the shared `model_fn`; the same
                         optional knobs as `evaluate`. A single `label_space` may be forced across all
                         datasets (external validation on a common vocabulary) or left None to use each
                         provider's own.
        Expected output: {"perDataset": {name: metrics-or-{available:False,...}}, "datasets": [...],
                         "evaluated": [names that scored], "n": count, "average": {...}, "median": {...}}
                         where average/median span the scalar headline metrics over the scored datasets.
        Failure modes:   an unavailable dataset (DatasetUnavailable) or an invalid one (ValueError) is
                         recorded as {"available": False, ...} and excluded from the aggregate — the run
                         continues. Truly unexpected errors are NOT swallowed.
        """
        per: dict[str, dict] = {}
        evaluated: list[str] = []
        for name, provider in providers.items():
            try:
                metrics = self.evaluate(provider, model_fn, split=split, limit=limit,
                                        label_space=label_space, threshold=threshold, headline=headline)
                metrics["available"] = True
                per[name] = metrics
                evaluated.append(name)
            except DatasetUnavailable as e:
                per[name] = {"available": False, "reason": "unavailable", "error": str(e)}
            except ValueError as e:
                per[name] = {"available": False, "reason": "invalid", "error": str(e)}

        agg_keys = ("weightedF1", "macroF1", "microF1", "accuracy", "exactMatch", "hammingAccuracy",
                    "precision", "recall", "brier", "ece")
        average: dict[str, float] = {}
        median: dict[str, float] = {}
        for key in agg_keys:
            vals = [per[n][key] for n in evaluated if isinstance(per[n].get(key), (int, float))]
            if vals:
                average[key] = round(statistics.fmean(vals), 6)
                median[key] = round(statistics.median(vals), 6)
        return {"perDataset": per, "datasets": list(providers.keys()), "evaluated": evaluated,
                "n": len(evaluated), "average": average, "median": median}


def _latency_stats(latencies_ms: list[float]) -> dict:
    """Inference-latency panel (ms): count, mean, SD, p50, p95, total. Empty list -> null fields."""
    if not latencies_ms:
        return {"count": 0, "meanMs": None, "sdMs": None, "p50Ms": None, "p95Ms": None, "totalMs": 0.0}
    ordered = sorted(latencies_ms)

    def _pct(p: float) -> float:
        k = int(round((p / 100.0) * (len(ordered) - 1)))
        return ordered[min(max(k, 0), len(ordered) - 1)]

    sd = statistics.pstdev(latencies_ms) if len(latencies_ms) > 1 else 0.0
    return {"count": len(latencies_ms), "meanMs": round(statistics.fmean(latencies_ms), 4),
            "sdMs": round(sd, 4), "p50Ms": round(_pct(50), 4), "p95Ms": round(_pct(95), 4),
            "totalMs": round(sum(latencies_ms), 4)}
