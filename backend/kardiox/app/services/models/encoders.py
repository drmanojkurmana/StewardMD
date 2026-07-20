"""Foundation ECG encoders (ECG-FM / DeepECG-SSL / HeartGPT) — feature extractors, not classifiers.

These are self-supervised backbones with commercially-licensed public weights (MIT / Apache-2.0). They
produce EMBEDDINGS, not diagnoses. KardioX integrates them two ways, both by config (no code change):
  1. Feature extraction: `encode(signal) -> embedding` (for linear-probe / similarity / research).
  2. Fine-tuning base: attach + train a head via `app.training.finetune.FineTuningPipeline`, export the
     (encoder+head) to ONNX, register it, and serve it through the ONNX model seam like any classifier.

Loading reuses the verified `ModelBackend` seam via each encoder's EXPORTED checkpoint (ONNX/TorchScript),
so KardioX does not re-implement fairseq-signals / nnU-Net / GPT loaders — you export the encoder once
(see docs) and point config at it. Multiple encoders can run simultaneously (ensemble embeddings).

HONESTY: KardioX ships NO weights. An encoder is Not Ready (raises UpstreamUnavailable) until its
checkpoint is configured AND the runtime is installed. It NEVER fabricates an embedding. The per-encoder
input specs + export path are documented and must be confirmed against each checkpoint's model card.

Registry (KARDIOX_ENCODERS_JSON): {"ecg-fm": {"path": "/models/ecgfm.onnx", "kind": "onnx"}, ...}
"""
from __future__ import annotations

from app.core.errors import UpstreamUnavailable
from app.services.base import module_available


class FoundationEncoder:
    """Base foundation encoder. Subclasses set metadata + the default input spec; loading/inference reuse
    the ModelBackend seam on the encoder's exported checkpoint."""

    name: str = "encoder"
    source: str = ""
    license: str = "unknown"
    input_spec: str = ""          # a name in app.services.models.adapters.INPUT_SPECS
    default_kind: str = "onnx"    # exported artifact format
    embed_note: str = ""

    def __init__(self, path: str | None = None, kind: str | None = None):
        self._path = path
        self._kind = kind

    # -- config ------------------------------------------------------------------------------------
    def _cfg(self) -> dict:
        from app.core.config import get_settings
        cfg = get_settings().encoders_config.get(self.name, {})
        return cfg if isinstance(cfg, dict) else {}

    def path(self) -> str | None:
        return self._path or self._cfg().get("path")

    def kind(self) -> str:
        return self._kind or self._cfg().get("kind") or self.default_kind

    @property
    def implemented(self) -> bool:
        return bool(self.path())

    def dependencies(self) -> list[dict]:
        mod = {"onnx": "onnxruntime", "torchscript": "torch", "torch_statedict": "torch",
               "tensorflow": "tensorflow"}.get(self.kind(), "onnxruntime")
        return [{"module": mod, "available": module_available(mod)}]

    def validate_config(self) -> list[str]:
        import os
        p = self.path()
        if not p:
            return [f"encoder '{self.name}' has no checkpoint (KARDIOX_ENCODERS_JSON[{self.name}].path); "
                    "export it per docs/ENCODERS.md — KardioX ships no weights"]
        if "://" not in p and not os.path.exists(p):
            return [f"encoder '{self.name}' checkpoint not found: {p}"]
        return []

    # -- inference ---------------------------------------------------------------------------------
    def encode(self, signal: dict):
        """signal dict -> a numpy embedding vector. Not-Ready-safe; never fabricates."""
        p = self.path()
        if not p:
            raise UpstreamUnavailable(f"encoder '{self.name}' NOT READY: no checkpoint configured",
                                      stage="encoder")
        from app.services.models.adapters import adapt_signal, get_input_spec
        from app.services.models.backends import load_backend
        spec = get_input_spec(self.input_spec)
        x = adapt_signal(signal, spec) if spec else None
        if x is None:
            raise UpstreamUnavailable(f"encoder '{self.name}' has no input spec {self.input_spec!r}",
                                      stage="encoder")
        backend = load_backend(self.kind(), p)
        raw = backend.raw(x)                        # exported encoder forward (no softmax)
        import numpy as np
        return np.asarray(raw, dtype="float32").ravel()

    async def health(self) -> dict:
        deps = self.dependencies()
        issues = self.validate_config()
        ready = bool(self.implemented and all(d["available"] for d in deps) and not issues)
        return {"stage": "encoder", "name": self.name, "source": self.source, "license": self.license,
                "inputSpec": self.input_spec, "implemented": self.implemented, "ready": ready,
                "dependencies": deps, "configIssues": issues}

    def describe(self) -> dict:
        return {"name": self.name, "source": self.source, "license": self.license,
                "inputSpec": self.input_spec, "kind": self.kind(), "note": self.embed_note}


class ECGFMEncoder(FoundationEncoder):
    name = "ecg-fm"
    source = "bowang-lab/ECG-FM (HF wanglab/ecg-fm)"
    license = "MIT"
    input_spec = "ecgfm_500hz_5s"
    embed_note = "wav2vec2 SSL encoder (fairseq-signals); export to ONNX/TorchScript first (see docs)."


class DeepECGSSLEncoder(FoundationEncoder):
    name = "deepecg-ssl"
    source = "HeartWise-AI/DeepECG (HF heartwise)"
    license = "Apache-2.0"        # confirm the bare encoder card in writing (see MODEL_LANDSCAPE.md)
    input_spec = "deepecg_250hz_10s"
    embed_note = "contrastive/masked-lead SSL encoder; export to TorchScript/ONNX first."


class HeartGPTEncoder(FoundationEncoder):
    name = "heartgpt"
    source = "harryjdavies/HeartGPT"
    license = "MIT"
    input_spec = "heartgpt_leadii"
    embed_note = "decoder-only transformer over a tokenized single lead; confirm tokenization vs the repo."


_ENCODERS = {"ecg-fm": ECGFMEncoder, "deepecg-ssl": DeepECGSSLEncoder, "heartgpt": HeartGPTEncoder}


def build_encoders(settings=None) -> list[FoundationEncoder]:
    """One FoundationEncoder per standard encoder + any extra named in KARDIOX_ENCODERS_JSON."""
    from app.core.config import get_settings
    settings = settings or get_settings()
    names = list(dict.fromkeys(list(_ENCODERS) + list(settings.encoders_config.keys())))
    out: list[FoundationEncoder] = []
    for n in names:
        cls = _ENCODERS.get(n, FoundationEncoder)
        enc = cls() if n in _ENCODERS else FoundationEncoder()
        if enc.name == "encoder":
            enc.name = n
        out.append(enc)
    return out


def get_encoder(name: str) -> FoundationEncoder:
    cls = _ENCODERS.get(name)
    if not cls:
        raise KeyError(f"unknown encoder '{name}' (have: {sorted(_ENCODERS)})")
    return cls()
