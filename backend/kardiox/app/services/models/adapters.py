"""Model adapters (integration layer). Map a THIRD-PARTY model's specific I/O conventions onto KardioX's
contracts so a downloaded/trained model plugs in with NO change to the backend, orchestrator, or iOS app.

Two adapters + a resolver:
  • ModelInputSpec + adapt_signal — turn the pipeline's signal dict into EXACTLY the array a given model
    expects (sampling rate, sample count, lead order/count, normalization). Third-party ECG models differ
    on all of these (e.g. PTB-XL models at 100 vs 500 Hz; torch_ecg at ~4000-5000 samples), and getting
    them wrong silently degrades accuracy — this makes the contract explicit + configurable.
  • LabelMap — translate a model's native class labels (e.g. PTB-XL SCP superclasses) into KardioX's
    vocabulary, so model output feeds the Rule Engine consistently. (Models PROPOSE; the deterministic
    Rule Engine still validates — a model never bypasses it.)
  • resolve_entrypoint — dynamically import a "module:function" so an external digitizer/model wrapper
    (e.g. an ECG-Digitiser adapter) plugs in by config.

The presets below are TEMPLATES derived from published dataset/model conventions — they MUST be confirmed
against the specific checkpoint's model card before use. This module makes NO performance claim.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.core.errors import UpstreamUnavailable

STANDARD_12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]


@dataclass
class ModelInputSpec:
    """The exact array a model expects. `num_samples=None` keeps the native (min) length."""
    fs: int = 500
    num_samples: int | None = 5000
    leads: list[str] = field(default_factory=lambda: list(STANDARD_12))
    normalize: str = "zscore"      # zscore (per-channel) | global_zscore | minmax | none
    fill_missing: bool = True      # missing leads → zeros so channel count stays fixed


def _resample(x, src_fs: int, dst_fs: int):
    import numpy as np
    if src_fs == dst_fs or x.size < 2:
        return x
    n = max(1, int(round(x.size * dst_fs / float(src_fs))))
    return np.interp(np.linspace(0, x.size - 1, n), np.arange(x.size), x).astype("float32")


def _fit_length(x, n: int):
    import numpy as np
    if x.size == n:
        return x
    if x.size > n:                                    # center-crop
        start = (x.size - n) // 2
        return x[start:start + n]
    out = np.zeros(n, dtype="float32")                # center-pad with zeros
    start = (n - x.size) // 2
    out[start:start + x.size] = x
    return out


def _normalize(arr, mode: str):
    import numpy as np
    if mode == "none":
        return arr
    if mode == "global_zscore":
        return (arr - arr.mean()) / (arr.std() + 1e-6)
    if mode == "minmax":
        lo = arr.min(axis=1, keepdims=True)
        hi = arr.max(axis=1, keepdims=True)
        return 2.0 * (arr - lo) / (hi - lo + 1e-6) - 1.0
    # default: per-channel z-score
    mu = arr.mean(axis=1, keepdims=True)
    sd = arr.std(axis=1, keepdims=True)
    return (arr - mu) / (sd + 1e-6)


def adapt_signal(signal: dict, spec: ModelInputSpec):
    """signal dict → numpy (1, C, T) exactly per `spec`. Raises UpstreamUnavailable if a required lead is
    missing and fill_missing is False, or if there is no signal at all."""
    import numpy as np
    leads = signal.get("leads", {}) or {}
    chans = []
    target_n = spec.num_samples
    for name in spec.leads:
        ld = leads.get(name)
        if ld and ld.get("mv"):
            x = np.asarray(ld["mv"], dtype="float32")
            x = _resample(x, int(ld.get("fs", spec.fs)), spec.fs)
        elif spec.fill_missing:
            x = np.zeros(target_n or 1, dtype="float32")
        else:
            raise UpstreamUnavailable(f"model requires lead '{name}' which is absent", stage="rhythm")
        chans.append(x)
    if not chans:
        raise UpstreamUnavailable("no leads to adapt", stage="rhythm")
    if target_n:
        chans = [_fit_length(c, target_n) for c in chans]
    else:
        L = min(len(c) for c in chans)
        chans = [c[:L] for c in chans]
    arr = _normalize(np.stack(chans, axis=0), spec.normalize)
    return arr[None, :, :].astype("float32")


# Named input presets — TEMPLATES from published conventions; confirm against the model card.
INPUT_SPECS: dict[str, ModelInputSpec] = {
    "ptbxl_500hz_10s": ModelInputSpec(fs=500, num_samples=5000, leads=list(STANDARD_12)),
    "ptbxl_100hz_10s": ModelInputSpec(fs=100, num_samples=1000, leads=list(STANDARD_12)),
    "torch_ecg_12lead": ModelInputSpec(fs=500, num_samples=5000, leads=list(STANDARD_12)),
    "lead_ii_500hz_10s": ModelInputSpec(fs=500, num_samples=5000, leads=["II"]),
}


def get_input_spec(name: str) -> ModelInputSpec | None:
    return INPUT_SPECS.get(name) if name else None


class LabelMap:
    """Translate a model's native labels into KardioX vocabulary (case-insensitive)."""

    def __init__(self, mapping: dict[str, str], default: str | None = None):
        self.mapping = {k.lower(): v for k, v in (mapping or {}).items()}
        self.default = default

    def translate(self, label: str) -> str:
        return self.mapping.get((label or "").lower(), self.default if self.default is not None else label)


# PTB-XL diagnostic SUPERCLASSES → descriptive KardioX terms. A model label is a CANDIDATE that still
# routes through the Rule Engine; this only normalizes vocabulary.
LABEL_MAPS: dict[str, LabelMap] = {
    "ptbxl_superclass": LabelMap({
        "NORM": "sinus rhythm",
        "MI": "myocardial infarction (model candidate)",
        "STTC": "ST/T change (model candidate)",
        "CD": "conduction disturbance (model candidate)",
        "HYP": "hypertrophy (model candidate)",
    }),
}


def get_label_map(name: str) -> LabelMap | None:
    return LABEL_MAPS.get(name) if name else None


def resolve_entrypoint(spec: str):
    """Dynamically import a 'module:function' callable (e.g. an external digitizer/model wrapper)."""
    import importlib
    if not spec or ":" not in spec:
        raise UpstreamUnavailable(f"bad entrypoint '{spec}' (want 'module:function')", stage="digitization")
    mod_name, fn_name = spec.split(":", 1)
    try:
        module = importlib.import_module(mod_name)
        fn = getattr(module, fn_name)
    except (ImportError, AttributeError) as e:
        raise UpstreamUnavailable(f"cannot resolve entrypoint '{spec}': {type(e).__name__}", stage="digitization") from e
    if not callable(fn):
        raise UpstreamUnavailable(f"entrypoint '{spec}' is not callable", stage="digitization")
    return fn
