"""Specialist model classifiers (Phase 7 multi-model AI). Each is a config-activated `ModelClassifier`
on the Phase-6F ModelBackend seam: MI, rare-disease, conduction, morphology, beat — and any custom task
added to the KARDIOX_SPECIALISTS registry with NO code change.

HONESTY: KardioX ships NO weights. A specialist is NOT READY (raises UpstreamUnavailable) until a
validated checkpoint is configured for its task. Its output is a CANDIDATE for the evidence-fusion /
consensus engine — the deterministic Rule Engine still validates every finding; a model never diagnoses
unchecked. Each specialist is independently replaceable (swap the checkpoint in the registry).

Registry entry (per task): {"path": ..., "kind": "onnx"|"torchscript"|..., "labels": "a,b,c",
                            "inputSpec": "ptbxl_500hz_10s", "labelMap": "ptbxl_superclass"}

Expected input:  a signal dict {"leads": {lead: {"mv":[...], "fs":int}}, ...}.
Expected output: classify(signal) -> {"task","source","label","confidence"}; raises UpstreamUnavailable
                 when Not Ready or on any model/runtime error.
"""
from __future__ import annotations

from app.core.errors import UpstreamUnavailable
from app.core.logging import get_logger
from app.services.base import Provider

log = get_logger("specialists")

# The standard specialist tasks the platform always exposes (each Not Ready until configured).
STANDARD_SPECIALISTS = ["mi", "rareDisease", "conduction", "morphology", "beat"]


class ModelClassifier(Provider):
    """A single specialist classifier bound to one task, driven entirely by the KARDIOX_SPECIALISTS
    registry. Not Ready (raises) until its task has a validated checkpoint configured."""

    version = "0.1.0"
    timeout_s = 60.0
    max_retries = 1

    def __init__(self, task: str, config: dict | None = None):
        self.task = task
        self.name = f"{task}-model"
        self.stage = f"specialist:{task}"
        self._config = config

    def _cfg(self) -> dict:
        if self._config is not None:
            return self._config
        from app.core.config import get_settings
        cfg = get_settings().specialists_config.get(self.task, {})
        return cfg if isinstance(cfg, dict) else {}

    @property
    def implemented(self) -> bool:  # type: ignore[override]
        # "implemented" here means a checkpoint is WIRED for this task (an operator only wires a
        # validated model). Unconfigured => Not Ready. Clinical validation remains an external gate.
        return bool(self._cfg().get("path"))

    def dependencies(self) -> list[dict]:
        from app.services.base import module_available
        # runtime dep depends on the configured backend kind (default onnx)
        kind = (self._cfg().get("kind") or "onnx").lower()
        mod = {"onnx": "onnxruntime", "torchscript": "torch", "torch_statedict": "torch",
               "tensorflow": "tensorflow"}.get(kind, "onnxruntime")
        return [{"module": mod, "available": module_available(mod)}]

    def validate_config(self) -> list[str]:
        import os
        cfg = self._cfg()
        path = cfg.get("path")
        if not path:
            return [f"specialist '{self.task}' has no checkpoint (KARDIOX_SPECIALISTS[{self.task}].path); "
                    "KardioX ships no weights"]
        if "://" not in path and not os.path.exists(path):   # local path must exist (URLs pass through)
            return [f"specialist '{self.task}' checkpoint not found: {path}"]
        return []

    async def classify(self, signal: dict) -> dict:
        import asyncio

        from app.services.models import (adapt_signal, get_input_spec, get_label_map, load_backend,
                                         signal_tensor)
        cfg = self._cfg()
        path = cfg.get("path")
        if not path:
            raise UpstreamUnavailable(
                f"specialist '{self.task}' NOT READY: no validated checkpoint configured (KardioX ships none)",
                stage=self.stage)
        labels = [s.strip() for s in str(cfg.get("labels", "")).split(",") if s.strip()]
        backend = load_backend(cfg.get("kind", "onnx"), path, labels=labels)
        spec = get_input_spec(cfg.get("inputSpec", ""))
        x = adapt_signal(signal, spec) if spec else signal_tensor(signal)
        pred = await asyncio.to_thread(backend.predict, x)
        label = pred["label"]
        lmap = get_label_map(cfg.get("labelMap", ""))
        if lmap:
            label = lmap.translate(label)
        return {"task": self.task, "source": self.name, "label": label,
                "confidence": float(pred["confidence"])}


def build_specialists(settings=None) -> list[ModelClassifier]:
    """One ModelClassifier per standard task + any extra task named in the registry."""
    from app.core.config import get_settings
    settings = settings or get_settings()
    cfg = settings.specialists_config
    tasks = list(dict.fromkeys(STANDARD_SPECIALISTS + list(cfg.keys())))
    return [ModelClassifier(t) for t in tasks]


async def run_specialists(signal: dict, specialists: list[ModelClassifier]) -> list[dict]:
    """Run every specialist; Not-Ready / erroring ones are ISOLATED (skipped). Returns fusion candidates.

    A specialist failure never affects the pipeline — the deterministic path stands on its own. Each
    classify() is bounded by the specialist's own timeout so a slow/hung model cannot stall the pipeline.
    """
    import asyncio

    candidates: list[dict] = []
    for sp in specialists or []:
        try:
            result = await asyncio.wait_for(sp.classify(signal), timeout=getattr(sp, "timeout_s", 60.0))
            if result:
                candidates.append(result)
        except UpstreamUnavailable:
            continue  # Not Ready — expected until a checkpoint is configured
        except (TimeoutError, asyncio.TimeoutError):
            log.info("specialist.timeout", task=getattr(sp, "task", "?"))
            continue
        except Exception as e:  # noqa: BLE001 — isolate a misbehaving model
            log.info("specialist.isolated", task=getattr(sp, "task", "?"), reason=type(e).__name__)
            continue
    return candidates
