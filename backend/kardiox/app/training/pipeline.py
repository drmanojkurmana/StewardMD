"""Supervised training pipeline (de-novo + generic fine-tuning) for KardioX.

This is the ORCHESTRATION layer. It adopts the validated practices of the ExChanGeAI (MIT) platform —
AdamW + ExponentialLR(gamma) with an automatic learning-rate finder, an 80/20 stratified split, early
stopping on WEIGHTED validation loss with best-checkpoint retention, head-only vs full fine-tuning, and
ONNX-first export into the ModelRegistry — but keeps every one of those steps CONFIG/CODE-driven and,
crucially, the deep-learning work behind an INJECTABLE backend.

Why an injectable backend? The parts that must be *correct* and *tested* — streaming the dataset without
loading it into memory, encoding multi-label targets, splitting reproducibly, running the epoch loop,
early-stopping, tracking the best epoch, logging, exporting + registering — are ordinary Python and live
here. The parts that genuinely need PyTorch (the forward/backward pass, the LR finder, the ONNX trace)
are delegated to a duck-typed `TrainingBackend`. A `StubBackend` (no torch) makes the whole orchestration
unit-testable; a real torch backend implementing the same protocol is documented in `TrainingBackend`.

Data path (memory-safe, never materialized):
    provider.iter_samples()  ->  Sample.to_signal()  ->  adapt_signal(spec)  ->  (B, C, T) float32
    provider.label_space()   ->  LabelEncoder.multi_hot(sample.labels)       ->  (B, K) multi-hot

Top-level imports are stdlib + the pure training modules only, so importing this module never drags in the
FastAPI / serving stack. numpy and `app.services.models` (adapt_signal / INPUT_SPECS) are imported lazily
inside the functions that need them.
"""
from __future__ import annotations

import math
import os
import random
import tempfile
from collections.abc import Iterable, Iterator, Sequence
from typing import Any, Protocol, runtime_checkable

from app.data.base import DatasetProvider, DatasetUnavailable, Sample
from app.training.config import HyperparameterConfig
from app.training.experiment import ExperimentTracker
from app.training.model_registry import ModelCard, ModelRegistry

__all__ = ["LabelEncoder", "TrainingBackend", "build_batches", "TrainingPipeline"]

# A single training batch: X = numpy (B, C, T) float32, y = numpy (B, K) multi-hot float32.
Batch = tuple[Any, Any]


# ── multi-label target encoding ──────────────────────────────────────────────────────────────────
class LabelEncoder:
    """Order-stable multi-hot encoder over a provider's fixed label space.

    Expected input:  a label space (list[str], typically ``provider.label_space()``); the order defines
                     the column index of each label and MUST be reused for decoding a model's output.
    Expected output: ``multi_hot(labels)`` -> list[int] of 0/1 with length == len(label_space);
                     ``decode(vec)`` -> the labels whose score meets ``threshold`` (default 0.5), in
                     label-space order.
    Failure modes:   labels absent from the space are ignored (never raises); a vector longer than the
                     space is truncated to the known columns; a shorter one decodes only its entries.
    """

    def __init__(self, label_space: Sequence[str]):
        self.labels: list[str] = list(label_space or [])
        self._index: dict[str, int] = {name: i for i, name in enumerate(self.labels)}

    def __len__(self) -> int:
        return len(self.labels)

    def multi_hot(self, labels: Iterable[str] | None) -> list[int]:
        """Encode a record's labels into a multi-hot 0/1 vector over the label space."""
        vec = [0] * len(self.labels)
        for name in labels or []:
            i = self._index.get(name)
            if i is not None:
                vec[i] = 1
        return vec

    def decode(self, vec: Sequence[float], threshold: float = 0.5) -> list[str]:
        """Decode a score/probability vector back to labels at/above ``threshold`` (label-space order)."""
        out: list[str] = []
        for i, name in enumerate(self.labels):
            if i < len(vec) and float(vec[i]) >= threshold:
                out.append(name)
        return out


# ── the deep-learning seam (injected) ──────────────────────────────────────────────────────────────
@runtime_checkable
class TrainingBackend(Protocol):
    """Duck-typed contract the pipeline delegates every torch-dependent step to.

    A real PyTorch backend implements this over an nn.Module + AdamW + ExponentialLR(gamma) and consumes
    the streamed batches directly (each batch is a ``(X, y)`` pair of numpy arrays shaped ``(B, C, T)`` /
    ``(B, K)``). The stub used in tests implements the same three required methods with plain Python and
    no torch, which is what makes this pipeline's orchestration fully unit-testable.

    Required methods
        fit_epoch(batches)  -> float : run ONE training epoch over the streamed batches; return mean loss.
        evaluate(batches)   -> dict  : run validation; MUST include the WEIGHTED validation loss under the
                                       key ``"loss"`` (lower is better — the early-stopping signal). May
                                       also carry richer metrics (weighted/macro F1, accuracy, ...).
        export_onnx(path)   -> None  : write the trained model to ``path`` as ONNX (ONNX-first export).

    Optional methods (called only when present; ``hasattr`` guarded)
        find_lr(batches)    -> float : learning-rate finder; run when ``config.lr is None``. A real
                                       implementation both RETURNS the suggested LR and APPLIES it to its
                                       optimizer. Required (must be present) only when ``config.lr`` is None.
        checkpoint()        -> None  : snapshot the current weights as the best-so-far (called on each
                                       validation improvement) so the export reflects the best epoch.
        restore_best()      -> None  : restore the snapshotted best weights (called once before export).
    """

    def fit_epoch(self, batches: Iterable[Batch]) -> float: ...
    def evaluate(self, batches: Iterable[Batch]) -> dict: ...
    def export_onnx(self, path: str) -> None: ...


# ── streaming batch builder ─────────────────────────────────────────────────────────────────────
def build_batches(
    provider: DatasetProvider,
    config: HyperparameterConfig,
    split: str | None,
    spec_name: str = "ptbxl_500hz_10s",
    limit: int | None = None,
    ids: set[str] | None = None,
) -> Iterator[Batch]:
    """Stream ``(X, y)`` mini-batches from a provider WITHOUT materializing the dataset.

    Each Sample is adapted independently and released before the next is read, so memory stays bounded to
    one batch regardless of corpus size. ``adapt_signal`` and ``INPUT_SPECS`` are imported lazily so this
    module stays importable without the serving stack; numpy is imported lazily for stacking.

    Expected input:  a streaming ``DatasetProvider``; a ``HyperparameterConfig`` (uses ``batch_size``); a
                     ``split`` (``None`` = all splits) passed straight to ``provider.iter_samples``; a
                     ``spec_name`` naming an entry in ``app.services.models.INPUT_SPECS`` (default
                     ``"ptbxl_500hz_10s"``); optional ``limit`` (cap on records pulled from the provider,
                     applied before ``ids`` filtering); optional ``ids`` (keep only Samples whose ``id`` is
                     in this set — used to stream a train/val subset without re-splitting).
    Expected output: a generator yielding ``(X, y)`` where ``X`` is numpy float32 ``(B, C, T)`` (adapted
                     per the input spec) and ``y`` is numpy float32 ``(B, K)`` multi-hot over
                     ``provider.label_space()``. A final short batch is yielded if records remain.
    Failure modes:   unknown ``spec_name`` -> ValueError; missing/incomplete data -> DatasetUnavailable
                     (raised by ``provider.iter_samples`` / ``_require``); Samples with no usable waveform
                     (empty ``to_signal`` leads, e.g. image-only or report-only rows) are SKIPPED, not
                     fabricated.
    """
    import numpy as np  # lazy: heavy dep, kept out of the module import path

    from app.services.models import INPUT_SPECS, adapt_signal  # lazy: pulls the serving stack

    spec = INPUT_SPECS.get(spec_name)
    if spec is None:
        raise ValueError(f"unknown spec_name {spec_name!r} (have: {sorted(INPUT_SPECS)})")

    encoder = LabelEncoder(provider.label_space())
    batch_size = max(1, int(config.batch_size))

    xs: list[Any] = []
    ys: list[list[int]] = []
    for sample in provider.iter_samples(split=split, limit=limit):
        if ids is not None and sample.id not in ids:
            continue
        signal = sample.to_signal()
        if not signal.get("leads"):
            continue  # no waveform to train on for this record — skip (never fabricate)
        arr = adapt_signal(signal, spec)          # -> (1, C, T)
        xs.append(np.asarray(arr, dtype="float32")[0])
        ys.append(encoder.multi_hot(sample.labels))
        if len(xs) >= batch_size:
            yield (np.stack(xs, axis=0), np.asarray(ys, dtype="float32"))
            xs, ys = [], []
    if xs:
        yield (np.stack(xs, axis=0), np.asarray(ys, dtype="float32"))


# ── orchestration ──────────────────────────────────────────────────────────────────────────────
class TrainingPipeline:
    """De-novo / generic supervised training with a stratified split, early stopping and ONNX export.

    The pipeline owns the reproducible, torch-free orchestration; the ``TrainingBackend`` owns the actual
    learning. This split keeps the whole control flow (splitting, LR-finder gating, the epoch loop, early
    stopping, best-epoch tracking, experiment logging, export + registration) unit-testable with a stub.

    Expected input:  a ``HyperparameterConfig`` (must pass ``validate()``); optional ``ExperimentTracker``
                     (per-epoch + summary logging) and ``ModelRegistry`` (ONNX-first registration).
    Expected output: ``run(...)`` returns a summary dict — see ``run`` for its shape.
    Failure modes:   invalid config -> ValueError; empty label space -> ValueError; no usable samples ->
                     ValueError; missing data -> DatasetUnavailable; ``config.lr is None`` with no
                     ``find_lr`` on the backend -> ValueError.
    """

    def __init__(
        self,
        config: HyperparameterConfig,
        tracker: ExperimentTracker | None = None,
        registry: ModelRegistry | None = None,
    ):
        self.config = config
        self.tracker = tracker
        self.registry = registry

    # -- public API --------------------------------------------------------------------------------
    def run(
        self,
        provider: DatasetProvider,
        backend: TrainingBackend,
        run_id: str,
        spec_name: str = "ptbxl_500hz_10s",
        name: str | None = None,
        task: str | None = None,
        limit: int | None = None,
        provenance: dict | None = None,
    ) -> dict:
        """Train ``backend`` on ``provider`` and return a run summary.

        Steps: validate config -> stream a lightweight (id, labels) index -> reproducible stratified 80/20
        split of the sample ids -> optional LR-finder when ``config.lr is None`` -> up to
        ``config.max_epochs`` of ``fit_epoch`` + ``evaluate`` with EARLY STOP after
        ``config.early_stop_patience`` epochs without improvement of the weighted validation ``"loss"``,
        retaining the best epoch -> ONNX export (best weights if the backend supports ``restore_best``) ->
        register a ``ModelCard`` (if a registry was given). Each epoch and the final summary are logged to
        the tracker (if given). Train/val batches are re-streamed each epoch — the dataset is never held
        in memory.

        Expected input:  a streaming ``DatasetProvider`` with a non-empty ``label_space()``; a
                         ``TrainingBackend`` (see its docstring); a ``run_id`` (unique run/model key); a
                         ``spec_name`` in ``INPUT_SPECS``; optional ``name`` (run/model label, default
                         ``run_id``); optional ``task`` (ModelCard task, default from ``provider.tasks``);
                         optional ``limit`` (cap on records considered — for smoke runs).
        Expected output: ``{"runId", "bestEpoch", "bestLoss", "epochs", "artifact", "labels", "trainSize",
                         "valSize", "modelCard"}``. ``bestLoss`` is ``None`` if validation never produced a
                         finite loss; ``artifact`` is the exported ONNX path; ``modelCard`` is the
                         registered model name or ``None``.
        Failure modes:   invalid config -> ValueError; empty label space / no usable samples -> ValueError;
                         missing data -> DatasetUnavailable; ``config.lr is None`` with no ``find_lr`` ->
                         ValueError. On any exception the run is marked ``failed`` in the tracker and the
                         error re-raised.
        """
        issues = self.config.validate()
        if issues:
            raise ValueError(f"invalid HyperparameterConfig: {'; '.join(issues)}")
        label_space = provider.label_space()
        if not label_space:
            raise ValueError(f"provider {provider.name!r} has an empty label space — nothing to classify")

        run_name = name or run_id
        if self.tracker is not None:
            params = {**self.config.to_dict(), "provider": provider.name,
                      "spec": spec_name, "labels": len(label_space), "provenance": provenance or {}}
            self.tracker.start_run(run_id, run_name, params)

        try:
            train_ids, val_ids = self._split_ids(provider, limit)

            def make_train() -> Iterator[Batch]:
                return build_batches(provider, self.config, None, spec_name, limit, train_ids)

            def make_val() -> Iterator[Batch]:
                return build_batches(provider, self.config, None, spec_name, limit, val_ids)

            self._lr_finder(backend, make_train, run_id)
            best_epoch, best_loss, epochs_run = self._train_loop(backend, make_train, make_val, run_id)
            artifact = self._export(backend, run_id)
            card_name = self._register(
                provider, run_id, run_name, task, spec_name, artifact,
                best_epoch, best_loss, epochs_run, label_space, provenance,
            )

            summary = {
                "runId": run_id,
                "bestEpoch": best_epoch,
                "bestLoss": (best_loss if math.isfinite(best_loss) else None),
                "epochs": epochs_run,
                "artifact": artifact,
                "labels": len(label_space),
                "trainSize": len(train_ids),
                "valSize": len(val_ids),
                "modelCard": card_name,
            }
            if self.tracker is not None:
                self.tracker.finish_run(run_id, "completed", summary)
            return summary
        except Exception as exc:  # mark the run failed, then surface the original error
            if self.tracker is not None:
                self.tracker.finish_run(run_id, "failed", {"error": f"{type(exc).__name__}: {exc}"})
            raise

    # -- internals ---------------------------------------------------------------------------------
    def _split_ids(self, provider: DatasetProvider, limit: int | None) -> tuple[set[str], set[str]]:
        """Stream a lightweight (id, labels) index and make a reproducible stratified train/val split.

        Only ids + label lists are retained (waveforms are released as the generator advances), so this
        stays memory-safe even for very large corpora. Raises ValueError if no usable sample is found.
        """
        index: list[tuple[str, list[str]]] = []
        for sample in provider.iter_samples(split=None, limit=limit):
            index.append((sample.id, list(sample.labels or [])))
        if not index:
            raise ValueError(f"provider {provider.name!r} yielded no samples — cannot train")
        train, val = _stratified_split(index, self.config.val_fraction, self.config.stratified,
                                       self.config.seed)
        if not train:
            raise ValueError("stratified split produced an empty training set")
        if not val:
            raise ValueError("stratified split produced an empty validation set")
        return train, val

    def _lr_finder(self, backend: TrainingBackend, make_train, run_id: str) -> None:
        """Run the LR finder when ``config.lr is None`` (ExChanGeAI's automatic-LR step)."""
        if self.config.lr is not None:
            return
        finder = getattr(backend, "find_lr", None)
        if not callable(finder):
            raise ValueError("config.lr is None but backend has no find_lr(batches) -> float")
        found = float(finder(make_train()))
        if self.tracker is not None:
            self.tracker.log_metric(run_id, "lr_found", found)

    def _train_loop(self, backend: TrainingBackend, make_train, make_val, run_id: str) -> tuple[int, float, int]:
        """Epoch loop with early stopping on the weighted validation loss and best-epoch retention.

        Returns ``(best_epoch, best_loss, epochs_run)``. ``best_epoch`` is 0 (and ``best_loss`` +inf) only
        if validation never produced a finite loss.
        """
        best_loss = math.inf
        best_epoch = 0
        epochs_run = 0
        no_improve = 0
        for epoch in range(1, int(self.config.max_epochs) + 1):
            epochs_run = epoch
            train_loss = float(backend.fit_epoch(make_train()))
            val_metrics = backend.evaluate(make_val())
            if "loss" not in val_metrics:
                raise ValueError("backend.evaluate(...) must return a dict containing the key 'loss'")
            val_loss = float(val_metrics["loss"])

            self._log_epoch(run_id, epoch, train_loss, val_loss, val_metrics)

            improved = math.isfinite(val_loss) and val_loss < best_loss - 1e-9
            if improved:
                best_loss = val_loss
                best_epoch = epoch
                no_improve = 0
                snapshot = getattr(backend, "checkpoint", None)
                if callable(snapshot):
                    snapshot()  # keep this epoch as best-so-far
            else:
                no_improve += 1
                if no_improve >= int(self.config.early_stop_patience):
                    break
        return best_epoch, best_loss, epochs_run

    def _log_epoch(self, run_id: str, epoch: int, train_loss: float, val_loss: float,
                   val_metrics: dict) -> None:
        """Log train/val loss plus any scalar validation metrics for the epoch (if a tracker is set)."""
        if self.tracker is None:
            return
        row: dict[str, float] = {"trainLoss": train_loss, "valLoss": val_loss}
        for key, value in val_metrics.items():
            if key == "loss":
                continue
            if isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                row[f"val_{key}"] = float(value)
        self.tracker.log_epoch(run_id, epoch, row)

    def _export(self, backend: TrainingBackend, run_id: str) -> str:
        """ONNX-first export of the (best) weights; persists into the run's artifacts when a tracker is set.

        Returns the path to the exported ONNX file. If a tracker is present the file is copied into the
        run directory via ``log_artifact`` and that persisted path is returned; otherwise the export lives
        in a temp directory the caller should relocate.
        """
        restore = getattr(backend, "restore_best", None)
        if callable(restore):
            restore()  # export the best epoch, not merely the last
        work_dir = tempfile.mkdtemp(prefix=f"kardiox-{run_id}-")
        onnx_path = os.path.join(work_dir, f"{run_id}.onnx")
        backend.export_onnx(onnx_path)
        if self.tracker is not None:
            return self.tracker.log_artifact(run_id, onnx_path)
        return onnx_path

    def _register(self, provider: DatasetProvider, run_id: str, run_name: str, task: str | None,
                  spec_name: str, artifact: str, best_epoch: int, best_loss: float, epochs_run: int,
                  label_space: list[str], provenance: dict | None = None) -> str | None:
        """Register the exported ONNX model in the registry (if one was given). Returns the card name."""
        if self.registry is None:
            return None
        resolved_task = task or (provider.tasks[0] if provider.tasks else "classification")
        metrics = {
            "bestValLoss": (best_loss if math.isfinite(best_loss) else None),
            "bestEpoch": best_epoch,
            "epochs": epochs_run,
            "numLabels": len(label_space),
            "dataset": provider.name,
        }
        if provenance:   # fine-tuning provenance (base model, source, license) for auditability
            metrics["provenance"] = provenance
        card = ModelCard(
            name=run_name,
            task=resolved_task,
            fmt="onnx",
            path=artifact,
            source=f"kardiox:{provider.name}",
            license=provider.license,
            inputSpec=spec_name,
            labels=list(label_space),
            metrics=metrics,
            notes=(f"Trained by TrainingPipeline run {run_id!r} "
                   f"({self.config.mode}, optimizer={self.config.optimizer})."),
        )
        self.registry.register(card)
        return card.name


def _stratified_split(
    index: Sequence[tuple[str, list[str]]],
    val_fraction: float,
    stratified: bool,
    seed: int,
) -> tuple[set[str], set[str]]:
    """Reproducible 80/20 (``val_fraction``) split of sample ids, stratified by label combination.

    Multi-label stratification groups ids by their exact label-set signature (a stable, order-independent
    key) and splits each group by ``val_fraction``, keeping at least one id in each side for groups of two
    or more (singleton groups go to train). With ``stratified=False`` all ids form one group. The RNG is
    seeded (``config.seed``) and groups are iterated in sorted order, so the split is deterministic.

    Expected input:  a list of ``(id, labels)`` pairs; the target validation fraction (0,1); the
                     stratify flag; an integer seed.
    Expected output: ``(train_ids, val_ids)`` as disjoint sets.
    Failure modes:   never raises here; empty inputs yield empty sets (the caller validates non-emptiness).
    """
    rng = random.Random(seed)
    groups: dict[str, list[str]] = {}
    for sid, labels in index:
        key = "__all__" if not stratified else ("|".join(sorted(labels)) if labels else "__none__")
        groups.setdefault(key, []).append(sid)

    train: list[str] = []
    val: list[str] = []
    for key in sorted(groups):
        ids = sorted(groups[key])
        rng.shuffle(ids)
        n = len(ids)
        n_val = int(round(n * val_fraction))
        if n >= 2:
            n_val = min(max(n_val, 1), n - 1)  # keep both sides non-empty within a multi-id group
        else:
            n_val = 0                           # a class seen once stays in train
        val.extend(ids[:n_val])
        train.extend(ids[n_val:])

    # Global safety net: with >= 2 ids total, guarantee both sides are non-empty (e.g. all-singleton case).
    if len(index) >= 2:
        if not val and train:
            val.append(train.pop())
        if not train and val:
            train.append(val.pop())
    return set(train), set(val)
