"""FineTuningPipeline — transfer-learning a pretrained ECG encoder onto a KardioX dataset.

This module COMPOSES ``app.training.pipeline.TrainingPipeline`` — it does NOT re-implement the
epoch / early-stop / ONNX-export / registry-logging loop. Its job is to prepare a *pretrained* backend
for transfer learning and then hand the streaming training loop to the shared TrainingPipeline.

It adopts the ExChanGeAI (MIT) transfer-learning recipe: AdamW + ExponentialLR(gamma) with an
automatic LR-finder, 80/20 stratified split, early stopping on the WEIGHTED validation loss with a
best checkpoint, ONNX-first export + registry logging (all owned by TrainingPipeline), plus two
fine-tune MODES selected by ``config.mode``:

  * ``full``       — adapt the head, then train encoder + head end-to-end.
  * ``head_only``  — ``backend.freeze_encoder()`` and train ONLY the newly adapted head (fast,
                     low-data-robust; ExChanGeAI's "adapt the classification head" path).

Two ExChanGeAI practices are always applied for a pretrained base:
  * AUTOMATIC CLASSIFICATION-HEAD ADAPTATION to the target label count —
    ``backend.adapt_head(len(provider.label_space()))``.
  * Z-SCORE input normalization — a pretrained foundation encoder was trained on z-scored signal, so
    feeding un-normalized input silently degrades transfer; ``normalize="none"`` is upgraded to
    ``"zscore"`` for the fine-tune (the de-novo "none" path lives in TrainingPipeline, not here).

The deep-learning step is an INJECTABLE backend (a duck-typed ``FineTuneBackend``). This module itself
calls only ``load_base`` / ``adapt_head`` / ``freeze_encoder`` and delegates the epoch loop to
TrainingPipeline, so the whole orchestration is unit-testable with a STUB backend + STUB trainer and no
torch. A real torch backend implements the same protocol; see ``docs/TRAINING.md``.

Designed foundation encoders (all permissively licensed) are catalogued in ``FOUNDATION_ENCODERS`` —
ECG-FM (MIT, wav2vec2, 500 Hz / 5 s), DeepECG-SSL (Apache-2.0, 250 Hz / 10 s) and HeartGPT
(MIT, single-lead GPT). Confirm every field against the specific checkpoint's model card before use;
this module makes NO performance claim and ships NO weights.
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.data.base import DatasetProvider, DatasetUnavailable
from app.training.config import HyperparameterConfig
from app.training.experiment import ExperimentTracker
from app.training.model_registry import ModelRegistry


# ── foundation-encoder catalogue ────────────────────────────────────────────────────────────────
# TEMPLATES from each project's published conventions — CONFIRM against the checkpoint's model card
# before wiring. ``inputSpec`` names an app.services.models.INPUT_SPECS preset when one matches
# exactly, else None (register a matching ModelInputSpec: the listed fs / seconds / leads must hold,
# because a pretrained encoder is sensitive to sample rate, length and channel count).
FOUNDATION_ENCODERS: dict[str, dict] = {
    "ecg-fm": {
        "source": "bowang-lab/ECG-FM (fairseq-signals)",
        "license": "MIT",
        "arch": "wav2vec2 self-supervised encoder + linear classification head",
        "fs": 500,
        "seconds": 5.0,          # ~2500 samples per lead
        "leads": 12,
        "inputSpec": None,       # register a 500 Hz / 2500-sample / 12-lead ModelInputSpec
        "notes": "SSL-pretrained on large ECG corpora (e.g. MIMIC-IV-ECG); fine-tune a linear head "
                 "on the pooled encoder output — head_only for small datasets, full otherwise.",
    },
    "deepecg-ssl": {
        "source": "DeepECG-SSL",
        "license": "Apache-2.0",
        "arch": "self-supervised transformer encoder + classification head",
        "fs": 250,
        "seconds": 10.0,         # ~2500 samples per lead
        "leads": 12,
        "inputSpec": None,       # register a 250 Hz / 2500-sample / 12-lead ModelInputSpec
        "notes": "SSL-pretrained transformer; z-score input, adapt the head to the target labels, "
                 "then head_only or full fine-tune.",
    },
    "heartgpt": {
        "source": "HeartGPT (Davies et al.)",
        "license": "MIT",
        "arch": "GPT-style autoregressive transformer (single-lead) + classification head",
        "fs": 500,
        "seconds": 10.0,
        "leads": 1,              # single-lead (lead II) foundation model
        "inputSpec": "lead_ii_500hz_10s",
        "notes": "Single-lead generative encoder; attach a classification head on the final/pooled "
                 "token state. Use the single-lead input spec; multi-lead datasets are reduced to II.",
    },
}


def describe_encoder(name: str) -> dict | None:
    """Return the FOUNDATION_ENCODERS template for `name` (case-insensitive), or None if unknown."""
    return FOUNDATION_ENCODERS.get((name or "").strip().lower())


# ── injectable seams (duck-typed; no torch needed to satisfy them) ────────────────────────────────
@runtime_checkable
class FineTuneBackend(Protocol):
    """The deep-learning backend a fine-tune drives. Extends the training backend with the three
    transfer-learning hooks this pipeline calls directly (load_base / adapt_head / freeze_encoder);
    the remaining methods are consumed by TrainingPipeline while streaming batches. A backend NEVER
    fabricates output — a real one raises when its runtime/checkpoint is unavailable."""

    def load_base(self, ref: Any) -> None:
        """Load pretrained weights from `ref` (a checkpoint path str, or the {kind,path,labels,
        inputSpec} dict resolved from a ModelRegistry name)."""

    def adapt_head(self, n_classes: int) -> None:
        """Replace/resize the classification head to `n_classes` outputs (the target label count)."""

    def freeze_encoder(self) -> None:
        """Freeze encoder parameters so only the adapted head trains (head_only mode)."""

    def fit_epoch(self, batches: Any) -> float:
        """Train one epoch over streamed (B,C,T)+multi-hot batches; return the mean training loss."""

    def evaluate(self, batches: Any) -> dict:
        """Evaluate over streamed batches; return metrics including a weighted validation 'loss'."""

    def export_onnx(self, path: str) -> str:
        """Export the trained model to ONNX at `path`; return the written path."""


@runtime_checkable
class EpochRunner(Protocol):
    """The subset of TrainingPipeline this pipeline composes. `provenance` is folded by the trainer
    into the run params + the exported model's ModelCard so the fine-tune is fully auditable."""

    def run(self, provider: Any, backend: Any, run_id: str, spec_name: str,
            *, provenance: dict | None = None) -> dict: ...


# ── the pipeline ──────────────────────────────────────────────────────────────────────────────────
class FineTuningPipeline:
    """Transfer-learn a pretrained ECG encoder onto a KardioX DatasetProvider.

    Construction: ``FineTuningPipeline(config, tracker=None, registry=None, trainer=None)``. `trainer`
    is an optional injection seam (an EpochRunner) used for tests / custom trainers; when omitted a real
    ``TrainingPipeline`` is built lazily from the effective config so this module stays importable and
    pure at the top level (TrainingPipeline lazy-imports torch itself).
    """

    def __init__(self, config: HyperparameterConfig, tracker: ExperimentTracker | None = None,
                 registry: ModelRegistry | None = None, trainer: EpochRunner | None = None) -> None:
        self.config = config
        self.tracker = tracker
        self.registry = registry
        self._trainer = trainer

    def run(self, provider: DatasetProvider, backend: FineTuneBackend, base_model: str,
            run_id: str, spec_name: str) -> dict:
        """Fine-tune `backend` (initialised from `base_model`) on `provider` and log/export via the
        composed TrainingPipeline.

        Expected input:
          provider   — a DatasetProvider whose ``label_space()`` is the fine-tune target (non-empty)
                       and whose data root is present (streamed, never loaded whole).
          backend    — a FineTuneBackend (torch backend in prod, stub in tests).
          base_model — a ModelRegistry name (resolved via ``registry.to_backend``) OR a checkpoint path.
          run_id     — id for the ExperimentTracker run + the registered model.
          spec_name  — an ``app.services.models.INPUT_SPECS`` preset naming the encoder's exact input
                       (fs / length / leads / normalization); used by TrainingPipeline when batching.

        Expected output:
          The TrainingPipeline run summary dict, with a ``"finetune"`` provenance block added (base
          model + source/license, mode, whether the encoder was frozen, adapted head size, label space,
          effective normalization, input spec).

        Failure modes:
          DatasetUnavailable — the provider's data root is missing/incomplete, or its label space is
                               empty (no classification target). No samples are ever fabricated.
          ValueError         — the HyperparameterConfig fails ``validate()``, or `base_model` is not a
                               non-empty string.
          KeyError           — `base_model` names a model absent from the registry (via to_backend).
        """
        labels = list(provider.label_space())
        if not labels:
            raise DatasetUnavailable(
                f"{getattr(provider, 'name', 'provider')}: empty label_space() — fine-tuning needs a "
                "classification target (report-only / unlabeled corpora cannot be fine-tuned here)."
            )
        # Fail fast on missing data BEFORE loading a large base model (the ABSOLUTE rule: never fabricate).
        if not provider.describe().get("available", False):
            raise DatasetUnavailable(
                f"{getattr(provider, 'name', 'provider')}: data not available at "
                f"root={getattr(provider, 'root', None)!r}; obtain it per its licence and set its root."
            )

        n_classes = len(labels)
        cfg = self._prepared_config()
        base_ref, provenance = self._resolve_base(base_model)

        # ExChanGeAI transfer recipe: load pretrained weights → adapt the head to the new label count →
        # (head_only) freeze the encoder so only the head trains.
        backend.load_base(base_ref)
        backend.adapt_head(n_classes)
        frozen = cfg.mode == "head_only"
        if frozen:
            backend.freeze_encoder()

        provenance.update({
            "finetune": True,
            "mode": cfg.mode,
            "frozenEncoder": frozen,
            "adaptedHeadClasses": n_classes,
            "labelSpace": labels,
            "normalize": cfg.normalize,
            "inputSpec": spec_name,
        })

        trainer = self._make_trainer(cfg)
        result = trainer.run(provider, backend, run_id, spec_name, provenance=provenance)
        if isinstance(result, dict):
            merged = dict(result)
            merged.setdefault("finetune", provenance)
            return merged
        return {"result": result, "finetune": provenance}

    # ── internals ─────────────────────────────────────────────────────────────────────────────────
    def _prepared_config(self) -> HyperparameterConfig:
        """Return a validated COPY of the config with pretrained-appropriate normalization.

        Raises ValueError if the config is invalid. Upgrades ``normalize="none"`` to ``"zscore"`` (a
        pretrained encoder expects z-scored input); ``zscore`` / ``minmax`` are respected as given.
        The caller's config object is never mutated.
        """
        issues = self.config.validate()
        if issues:
            raise ValueError("invalid HyperparameterConfig: " + "; ".join(issues))
        cfg = HyperparameterConfig.from_dict(self.config.to_dict())
        if cfg.normalize == "none":
            cfg.normalize = "zscore"
        return cfg

    def _resolve_base(self, base_model: str) -> tuple[Any, dict]:
        """Resolve `base_model` to a backend reference + a provenance dict.

        A registered ModelRegistry name resolves via ``registry.to_backend`` (and carries the base
        card's source/license/labels into provenance); anything else is treated as a checkpoint path.
        Raises ValueError if `base_model` is not a non-empty string.
        """
        if not base_model or not isinstance(base_model, str):
            raise ValueError("base_model must be a non-empty ModelRegistry name or a checkpoint path")
        card = self.registry.get(base_model) if self.registry is not None else None
        if card is not None:
            ref = self.registry.to_backend(base_model)   # {kind, path, labels, inputSpec}
            return ref, {
                "baseModel": base_model,
                "baseKind": card.fmt,
                "basePath": card.path,
                "baseSource": card.source,
                "baseLicense": card.license,
                "baseInputSpec": card.inputSpec,
                "baseLabels": list(card.labels),
            }
        return base_model, {
            "baseModel": base_model,
            "baseKind": "path",
            "basePath": base_model,
            "baseSource": base_model,
            "baseLicense": "unknown",
        }

    def _make_trainer(self, config: HyperparameterConfig) -> EpochRunner:
        """Return the injected trainer, or lazily build a TrainingPipeline with the effective config.

        The import is deliberately lazy: it keeps this module importable with only stdlib +
        app.data.base + the pure app.training.config/experiment/model_registry modules at the top level
        (TrainingPipeline pulls torch lazily inside its own backend calls).
        """
        if self._trainer is not None:
            return self._trainer
        from app.training.pipeline import TrainingPipeline
        return TrainingPipeline(config, tracker=self.tracker, registry=self.registry)
