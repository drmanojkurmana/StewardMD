"""Stages 6-7-9 — Rhythm, beats, morphology (Phase 5D). Libraries: NeuroKit2/NumPy + TorchECG (optional).

Two modular, decoupled providers:

  DeterministicRhythm (name="deterministic") — REAL, model-free. From the signal's R-peaks it computes
    ventricular rate + regularity (RR coefficient of variation) and detects P-wave presence via
    delineation. It emits a **descriptive, NON-diagnostic** rhythm label — it never asserts a diagnosis
    (e.g. "atrial fibrillation"). Diagnoses are the Rule Engine's job (5F). This makes the pipeline
    genuinely end-to-end without any trained model. Beat *detection* is real; per-beat *type*
    classification (PVC/PAC/paced) is flagged as requiring a model.

  TorchECGRhythm (name="torchecg") — REAL integration for a learned classifier. Loads a checkpoint from
    config and runs inference through a stable interface. It ships **NO weights**: with no checkpoint it
    raises UpstreamUnavailable — it NEVER fabricates a label. Boundary: a trustworthy rhythm/beat
    classifier requires training on labelled datasets (PTB-XL / MIT-BIH), GPU serving, and clinical
    validation (see docs/RESEARCH.md §5D). Activate with KARDIOX_PROVIDER_RHYTHM=torchecg +
    KARDIOX_RHYTHM_MODEL_PATH once a validated checkpoint exists.
"""
from __future__ import annotations

from app.core.errors import UpstreamUnavailable
from app.services.base import RhythmProvider

_IRREGULAR_COV = 0.12   # RR coefficient of variation above this reads as irregular


def _lazy():
    try:
        import neurokit2 as nk
        import numpy as np
        return nk, np
    except ImportError as e:  # pragma: no cover
        raise UpstreamUnavailable("neurokit2/numpy not installed", stage="rhythm") from e


def _pick(signal: dict):
    leads = signal.get("leads", {}) or {}
    for k in ("II", "II-rhythm", "I", "V2", "V1"):
        if k in leads and leads[k].get("mv"):
            return k, leads[k]
    for k, v in leads.items():
        if v.get("mv"):
            return k, v
    return None, None


def _peaks(ld, nk, np):
    fs = int(ld.get("fs", 500))
    cleaned = nk.ecg_clean(np.asarray(ld["mv"], dtype="float64"), sampling_rate=fs)
    _, info = nk.ecg_peaks(cleaned, sampling_rate=fs)
    r = np.asarray(info.get("ECG_R_Peaks", []), dtype="float64")
    return cleaned, r[~np.isnan(r)].astype(int), fs


def rhythm_from_signal(signal: dict) -> dict:
    nk, np = _lazy()
    name, ld = _pick(signal)
    out = {"label": "undetermined rhythm", "rateBpm": None, "regularity": None,
           "confidence": 0.0, "sourceLead": name, "method": "deterministic"}
    if ld is None:
        return out
    try:
        _, r, fs = _peaks(ld, nk, np)
    except Exception:
        return out
    if r.size < 2:
        return out
    rr = np.diff(r) / fs
    rate = float(60.0 / np.median(rr))
    cov = float(np.std(rr) / np.mean(rr)) if np.mean(rr) > 0 else 0.0
    regular = cov < _IRREGULAR_COV
    band = "tachycardia" if rate > 100 else "bradycardia" if rate < 60 else "normal rate"
    out["rateBpm"] = round(rate)
    out["regularity"] = "regular" if regular else "irregular"
    out["rrCov"] = round(cov, 3)
    # descriptive only — NOT a diagnosis (the Rule Engine decides AF/flutter/etc.)
    out["label"] = f"{'regular' if regular else 'irregular'} rhythm, {band} (~{round(rate)} bpm)"
    out["confidence"] = round(min(0.6, r.size / 40.0), 2)
    return out


def beats_from_signal(signal: dict) -> dict:
    nk, np = _lazy()
    name, ld = _pick(signal)
    if ld is None:
        return {"beats": [], "classified": False}
    try:
        _, r, fs = _peaks(ld, nk, np)
    except Exception:
        return {"beats": [], "classified": False}
    return {
        "beats": [{"t": round(float(t / fs), 3), "label": "qrs"} for t in r],
        "classified": False,
        "note": "beat-type classification (PVC/PAC/paced) requires a trained model",
    }


def morphology_from_signal(signal: dict) -> dict:
    nk, np = _lazy()
    name, ld = _pick(signal)
    out = {"pWaves": "uncertain", "fWaves": None, "bbb": None, "hypertrophy": None,
           "tWaves": None, "method": "deterministic"}
    if ld is None:
        return out
    try:
        cleaned, r, fs = _peaks(ld, nk, np)
        _, waves = nk.ecg_delineate(cleaned, rpeaks=r.tolist(), sampling_rate=fs, method="dwt")
        p = np.asarray(waves.get("ECG_P_Peaks", []), dtype="float64")
        p = p[~np.isnan(p)]
    except Exception:
        return out
    if r.size > 0:
        ratio = p.size / float(r.size)
        out["pWaves"] = "present" if ratio >= 0.6 else "absent" if ratio <= 0.25 else "uncertain"
    # fWaves / BBB / hypertrophy / T-wave abnormality are diagnoses -> Rule Engine (5E/5F) or a model.
    return out


class NoneRhythm(RhythmProvider):
    name = "none"

    async def rhythm(self, signal: dict) -> dict:
        self._ni()

    async def beats(self, signal: dict) -> dict:
        self._ni()

    async def morphology(self, signal: dict) -> dict:
        self._ni()


class DeterministicRhythm(RhythmProvider):
    """REAL model-free rate/regularity/P-wave analysis (Phase 5D). Emits NO diagnosis."""

    name = "deterministic"
    implemented = False   # code is real; gated on end-to-end validation

    async def rhythm(self, signal: dict) -> dict:
        return rhythm_from_signal(signal)

    async def beats(self, signal: dict) -> dict:
        return beats_from_signal(signal)

    async def morphology(self, signal: dict) -> dict:
        return morphology_from_signal(signal)


class TorchECGRhythm(RhythmProvider):
    """REAL learned-classifier integration (TorchECG). Ships no weights; requires a validated checkpoint."""

    name = "torchecg"
    implemented = False

    def _load(self):
        from app.core.config import get_settings
        s = get_settings()
        if not s.rhythm_model_path:
            raise UpstreamUnavailable(
                "No rhythm model checkpoint (set KARDIOX_RHYTHM_MODEL_PATH). A TorchECG model trained + "
                "validated on labelled datasets (PTB-XL/MIT-BIH) is required; KardioX ships no weights.",
                stage="rhythm")
        try:
            import torch
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("torch not installed", stage="rhythm") from e
        try:
            model = torch.jit.load(s.rhythm_model_path, map_location="cpu")
            model.eval()
            return torch, model, s
        except Exception as e:
            raise UpstreamUnavailable(f"Failed to load rhythm model: {type(e).__name__}", stage="rhythm") from e

    def _prepare(self, torch, signal: dict):
        """Signal -> normalized (1, C, T) tensor. Real preprocessing; the exact channel order/length
        must match the checkpoint (documented alongside the model)."""
        import numpy as np
        leads = signal.get("leads", {}) or {}
        order = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
        chans = []
        for name in order:
            mv = leads.get(name, {}).get("mv")
            if mv:
                x = np.asarray(mv, dtype="float32")
                x = (x - x.mean()) / (x.std() + 1e-6)
                chans.append(x)
        if not chans:
            raise UpstreamUnavailable("No leads to classify", stage="rhythm")
        length = min(len(c) for c in chans)
        arr = np.stack([c[:length] for c in chans], axis=0)[None, :, :]
        return torch.from_numpy(arr)

    async def _infer(self, signal: dict):
        torch, model, s = self._load()
        x = self._prepare(torch, signal)
        with torch.no_grad():
            logits = model(x)
        probs = torch.softmax(logits, dim=-1).squeeze(0)
        labels = s.rhythm_labels_list or [f"class_{i}" for i in range(probs.numel())]
        idx = int(torch.argmax(probs).item())
        return (labels[idx] if idx < len(labels) else f"class_{idx}"), float(probs[idx].item())

    async def rhythm(self, signal: dict) -> dict:
        label, conf = await self._infer(signal)
        det = rhythm_from_signal(signal)  # rate/regularity remain deterministic + trustworthy
        return {"label": label, "confidence": round(conf, 3), "rateBpm": det.get("rateBpm"),
                "regularity": det.get("regularity"), "method": "torchecg"}

    async def beats(self, signal: dict) -> dict:
        # a beat-level model has a different head; without it, fall back to real beat detection.
        return beats_from_signal(signal)

    async def morphology(self, signal: dict) -> dict:
        label, conf = await self._infer(signal)
        return {"model": {"label": label, "confidence": round(conf, 3)}, "method": "torchecg"}
