"""Trained ONNX ensemble — real 12-lead classifiers (EcgLib 7 heads + ECG-Diagnosis + HeartGPT).

Faithful Python port of the validated frontend engine (kardiox-engines.js + kardiox-fusion.js) that
scored 5/6 on real CPSC/PTB-XL in the JS pipeline. Runs each model via onnxruntime, fuses positives with
log-odds consensus, and returns diagnoses in the rules-engine format so the orchestrator/_assemble use
them as the verdict + differentials.

KEY property: every engine z-normalises each lead before inference, so the ensemble is robust to the
classical digitiser's amplitude/baseline error (unlike amplitude-based ST/LVH rules) — this is why it may
run on a digitised 12x1 while the amplitude rules are deferred.

Ships NO weights. Models load from KARDIOX_ENSEMBLE_MODELS_DIR (ecglib_*.onnx at the root; ecg_diagnosis
.onnx / heartgpt_afib.onnx at the root or under engines/). Absent -> Not Ready, classify() returns [].
"""
from __future__ import annotations

import math
import os

_STD12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]

_LABEL = {
    "AFIB": ("Atrial fibrillation", "urgent", "rhythm"), "AF": ("Atrial fibrillation", "urgent", "rhythm"),
    "STACH": ("Sinus tachycardia", "warn", "rhythm"), "SBRAD": ("Sinus bradycardia", "warn", "rhythm"),
    "SNR": ("Sinus rhythm", "info", "rhythm"),
    "1AVB": ("First-degree AV block", "info", "conduction"), "IAVB": ("First-degree AV block", "info", "conduction"),
    "CRBBB": ("Complete RBBB", "warn", "conduction"), "RBBB": ("Right bundle branch block", "warn", "conduction"),
    "IRBBB": ("Incomplete RBBB", "info", "conduction"), "LBBB": ("Left bundle branch block", "warn", "conduction"),
    "PVC": ("Premature ventricular complex", "warn", "morphology"),
    "PAC": ("Premature atrial complex", "info", "morphology"),
    "STD": ("ST depression", "urgent", "ischemia"), "STE": ("ST elevation (STEMI pattern)", "critical", "ischemia"),
}

_ENGINES = [
    {"name": "ecglib", "weight": 0.6, "heads": ["AFIB", "1AVB", "SBRAD", "STACH", "PVC", "CRBBB", "IRBBB"],
     "spec": {"samples": 5000}, "act": "sigmoid"},
    {"name": "ecg-diagnosis", "weight": 0.55, "file": "ecg_diagnosis.onnx",
     "codes": ["SNR", "AF", "IAVB", "LBBB", "RBBB", "PAC", "PVC", "STD", "STE"],
     "spec": {"samples": 2500, "sourceSamples": 15000, "downsample": 6}, "act": "sigmoid"},
    {"name": "heartgpt", "weight": 0.5, "file": "heartgpt_afib.onnx", "codes": ["AFIB"],
     "spec": {"kind": "tokens", "lead": 1, "downsample": 5, "tokens": 500}, "input": "tokens", "act": "prob"},
]
_SEV_RANK = {"critical": 4, "urgent": 3, "warn": 2, "info": 0}


def _lazy():
    try:
        import numpy as np
        import onnxruntime as ort
        return np, ort
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("onnxruntime/numpy not installed", stage="rhythm") from e


def _sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x)) if x >= 0 else (lambda z: z / (1.0 + z))(math.exp(x))


def _models_dir():
    try:
        from app.core.config import get_settings
        d = get_settings().ensemble_models_dir
    except Exception:
        d = os.environ.get("KARDIOX_ENSEMBLE_MODELS_DIR", "")
    return d or None


def _resolve(d, fname):
    for p in (os.path.join(d, fname), os.path.join(d, "engines", fname)):
        if os.path.exists(p):
            return p
    return None


_SESSIONS = {}


def _session(path):
    _, ort = _lazy()
    if path not in _SESSIONS:
        _SESSIONS[path] = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return _SESSIONS[path]


def ready():
    d = _models_dir()
    return bool(d and _resolve(d, "ecglib_AFIB.onnx"))


def _leads_array(signal, np):
    leads = (signal or {}).get("leads", {}) or {}
    n = max((len(v.get("mv", [])) for v in leads.values()), default=0)
    out = np.zeros((12, n), dtype="float64")
    for i, name in enumerate(_STD12):
        mv = (leads.get(name) or {}).get("mv")
        if mv:
            m = min(len(mv), n)
            out[i, :m] = np.asarray(mv[:m], dtype="float64")
    return out


def _prep_float(x, spec, np):
    N = spec["samples"]; ds = spec.get("downsample", 1); src = spec.get("sourceSamples", N)
    out = np.zeros((12, N), dtype="float32")
    for c in range(12):
        lead = x[c]; n = min(lead.shape[0], src)
        seg = np.zeros(src, dtype="float64")
        if n > 0:
            seg[src - n:] = lead[lead.shape[0] - n:]
        idx = np.arange(N) * ds
        samp = np.where(idx < src, seg[np.clip(idx, 0, src - 1)], 0.0)
        mean = samp.mean(); sd = samp.std() or 1e-6
        out[c] = (samp - mean) / sd
    return out[np.newaxis, :, :]


def _build_tokens(x, spec, np):
    li = spec.get("lead", 1)
    lead = x[li] if x.shape[0] > li else x[0]
    ds = spec.get("downsample", 1); T = spec.get("tokens", 500)
    s = lead[::ds][-T:]
    if s.size == 0:
        return np.zeros((1, T), dtype="int64")
    mn = float(s.min()); rng = float(s.max() - mn) or 1.0
    tok = np.clip(np.round((s - mn) / rng * 100.0), 0, 100).astype("int64")
    pad = T - tok.shape[0]
    if pad > 0:
        tok = np.concatenate([np.zeros(pad, dtype="int64"), tok])
    return tok[np.newaxis, :]


def _run_engine(engine, x, np, d):
    spec = engine["spec"]
    if spec.get("kind") == "tokens":
        path = _resolve(d, engine["file"])
        if not path:
            return []
        out = _session(path).run(None, {engine.get("input", "tokens"): _build_tokens(x, spec, np)})[0].ravel()
        return [(engine["codes"][i], float(out[i])) for i in range(len(engine["codes"]))]
    xt = _prep_float(x, spec, np)
    if engine.get("heads"):
        res = []
        for code in engine["heads"]:
            path = _resolve(d, f"ecglib_{code}.onnx")
            if not path:
                continue
            logit = float(_session(path).run(None, {"ecg": xt})[0].ravel()[0])
            res.append((code, _sigmoid(logit)))
        return res
    path = _resolve(d, engine["file"])
    if not path:
        return []
    arr = _session(path).run(None, {"ecg": xt})[0].ravel()
    return [(engine["codes"][i], _sigmoid(float(arr[i]))) for i in range(len(engine["codes"]))]


def _fuse_logodds(probs):
    lo = 0.0
    for p in probs:
        p = min(max(p, 1e-4), 1 - 1e-4)
        lo += math.log(p / (1 - p))
    return 1.0 / (1.0 + math.exp(-lo))


def classify(signal, threshold=0.5):
    """Run the ready engines on a continuous 12-lead signal -> diagnoses (rules-engine format), sorted by
    severity then fused confidence. Returns [] if the models are not configured (Not Ready)."""
    d = _models_dir()
    if not d or not ready():
        return []
    np, _ = _lazy()
    x = _leads_array(signal, np)
    if x.shape[1] < 100:
        return []
    by_code = {}
    for engine in _ENGINES:
        for code, prob in _run_engine(engine, x, np, d):
            if prob >= threshold:
                by_code.setdefault(code, []).append((engine["name"], prob))
    diagnoses = []
    seen = set()
    for code in by_code:
        label, severity, group = _LABEL.get(code, (code, "info", "morphology"))
        if label in seen:
            continue
        seen.add(label)
        probs = [p for c, cs in by_code.items() if _LABEL.get(c, (c,))[0] == label for (_, p) in cs]
        supporting = sorted({eng for c, cs in by_code.items() if _LABEL.get(c, (c,))[0] == label for (eng, _) in cs})
        conf = _fuse_logodds(probs)
        diagnoses.append({
            "id": f"DX-ENS-{code}", "label": label, "severity": severity, "group": group,
            "confidence": round(conf, 2),
            "differentials": [{"label": label, "probability": round(conf, 2)}],
            "criteria": [{"id": "ENS-" + s, "description": f"{s} ONNX classifier", "measuredValue": "", "weight": 0.0, "matched": True} for s in supporting],
            "whatToVerify": f"ML ensemble ({', '.join(supporting)}); correlate with the full trace and clinical context.",
            "supportingModels": supporting,
        })
    diagnoses.sort(key=lambda dd: (-_SEV_RANK.get(dd["severity"], 0), -dd["confidence"]))
    return diagnoses
