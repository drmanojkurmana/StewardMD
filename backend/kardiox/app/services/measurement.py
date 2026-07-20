"""Stages 8 + 10 — Measurement + ST (Phase 5C). Libraries: NeuroKit2 + NumPy.

REAL delineation-based measurement:
  measure(signal) -> heart rate, PR, QRS, QT, QTc (Bazett + Fridericia), axis (from net QRS in I/aVF),
                     per-lead R/S amplitudes, signal quality, beat locations, sourceLead.
  st(signal)      -> per-lead J-point (+40 ms) ST deviation vs the PR-segment baseline + territory.

Method: NeuroKit2 cleans each lead, detects R-peaks, and delineates P/QRS/T fiducials (DWT). Intervals are
the median across beats (NaN-robust). Axis uses net QRS deflection in leads I and aVF via the hexaxial
reference (deg = atan2(net_aVF, net_I)) — a standard estimate. All computation is deterministic given a
signal; no diagnosis is produced here (that is the Rule Engine's job).

Expected input:  {"leads": {"II": {"mv":[...], "fs":500}, ...}, "duration_s": float}
Expected output: measure -> {heartRate, prMs, qrsMs, qtMs, qtcMs, qtcFridericiaMs, axisDeg, perLead, beats,
                             quality, sourceLead}; st -> {perLead:{lead:mV}, territory}
Failure modes:   too-short/too-noisy lead -> fields fall back to None (never crashes); no usable lead ->
                 all-None result with a quality flag.

Boundary: real given a signal; clinical measurement ACCURACY (and axis validity from digitized paper)
needs validation against annotated references (e.g. PTB-XL). implemented stays False until then.
"""
from __future__ import annotations

import math

from app.services.base import MeasurementProvider

ANTERIOR = ("V1", "V2", "V3", "V4")
INFERIOR = ("II", "III", "aVF")
LATERAL = ("I", "aVL", "V5", "V6")
_ST_THRESH_MV = 0.1   # >= 1 mm elevation in >=2 contiguous leads flags a territory


def _lazy():
    try:
        import neurokit2 as nk
        import numpy as np
        return nk, np
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("neurokit2/numpy not installed", stage="measurement") from e


def _pick_rhythm_lead(signal: dict):
    """Prefer lead II / rhythm strip for global rhythm + intervals; else the first usable lead."""
    leads = signal.get("leads", {}) or {}
    for k in ("II", "II-rhythm", "I", "V2", "V1"):
        if k in leads and leads[k].get("mv"):
            return k, leads[k]
    for k, v in leads.items():
        if v.get("mv"):
            return k, v
    return None, None


def _rpeaks(mv, fs, nk, np):
    x = np.asarray(mv, dtype="float64")
    cleaned = nk.ecg_clean(x, sampling_rate=fs)
    _, info = nk.ecg_peaks(cleaned, sampling_rate=fs)
    r = np.asarray(info.get("ECG_R_Peaks", []), dtype="float64")
    r = r[~np.isnan(r)].astype(int)
    return cleaned, r


def _lead_amps(lead: dict, nk, np):
    """Median R amplitude, S amplitude, and net QRS deflection (mV) relative to the lead baseline."""
    mv, fs = lead.get("mv"), int(lead.get("fs", 500))
    if not mv or len(mv) < fs // 2:
        return None
    try:
        cleaned, r = _rpeaks(mv, fs, nk, np)
    except Exception:
        return None
    if r.size == 0:
        return None
    base = float(np.median(cleaned))
    r_amp = float(np.median(cleaned[r] - base))
    w = int(0.06 * fs)
    s_vals = [float(cleaned[rp:min(rp + w, cleaned.size)].min()) - base for rp in r if rp < cleaned.size]
    s_amp = float(np.median(s_vals)) if s_vals else 0.0
    return {"rAmpMv": round(r_amp, 3), "sAmpMv": round(s_amp, 3), "netMv": round(r_amp + s_amp, 3)}


def measure_signal(signal: dict) -> dict:
    nk, np = _lazy()
    lead_name, lead = _pick_rhythm_lead(signal)
    out = {"heartRate": None, "prMs": None, "qrsMs": None, "qtMs": None, "qtcMs": None,
           "qtcFridericiaMs": None, "axisDeg": None, "perLead": {}, "beats": [], "quality": None,
           "sourceLead": lead_name}
    if lead is None:
        out["quality"] = "no_signal"
        return out
    fs = int(lead.get("fs", 500))

    try:
        cleaned, r = _rpeaks(lead["mv"], fs, nk, np)
    except Exception:
        out["quality"] = "unreadable"
        return out

    rr_med = None
    if r.size >= 2:
        rr = np.diff(r) / fs
        rr_med = float(np.median(rr))
        out["heartRate"] = round(60.0 / rr_med, 1)
        out["beats"] = [round(float(t), 3) for t in (r / fs)]

    try:
        _, waves = nk.ecg_delineate(cleaned, rpeaks=r.tolist(), sampling_rate=fs, method="dwt")
    except Exception:
        waves = {}

    def _med_ms(end_key, start_key):
        a = np.asarray(waves.get(end_key, []), dtype="float64")
        b = np.asarray(waves.get(start_key, []), dtype="float64")
        n = min(a.size, b.size)
        if n == 0:
            return None
        d = a[:n] - b[:n]
        d = d[~np.isnan(d)]
        return round(float(np.median(d)) * 1000.0 / fs, 1) if d.size else None

    out["prMs"] = _med_ms("ECG_R_Onsets", "ECG_P_Onsets")
    out["qrsMs"] = _med_ms("ECG_R_Offsets", "ECG_R_Onsets")
    out["qtMs"] = _med_ms("ECG_T_Offsets", "ECG_R_Onsets")
    if out["qtMs"] and rr_med and rr_med > 0:
        qt_s = out["qtMs"] / 1000.0
        out["qtcMs"] = round(qt_s / math.sqrt(rr_med) * 1000.0, 1)           # Bazett
        out["qtcFridericiaMs"] = round(qt_s / (rr_med ** (1 / 3)) * 1000.0, 1)  # Fridericia

    per = {}
    for lname, ld in (signal.get("leads") or {}).items():
        amp = _lead_amps(ld, nk, np)
        if amp:
            per[lname] = amp
    out["perLead"] = per

    net_i = per.get("I", {}).get("netMv")
    net_avf = per.get("aVF", {}).get("netMv")
    if net_i is not None and net_avf is not None and (net_i or net_avf):
        out["axisDeg"] = round(math.degrees(math.atan2(net_avf, net_i)))

    try:
        q = np.asarray(nk.ecg_quality(cleaned, sampling_rate=fs), dtype="float64")
        out["quality"] = round(float(np.nanmean(q)), 3)
    except Exception:
        pass
    return out


def _lead_st(lead: dict, nk, np):
    """Median J+40ms ST deviation (mV) vs the PR-segment baseline for one lead."""
    mv, fs = lead.get("mv"), int(lead.get("fs", 500))
    if not mv or len(mv) < fs // 2:
        return None
    try:
        cleaned, r = _rpeaks(mv, fs, nk, np)
        _, waves = nk.ecg_delineate(cleaned, rpeaks=r.tolist(), sampling_rate=fs, method="dwt")
        r_off = np.asarray(waves.get("ECG_R_Offsets", []), dtype="float64")
        r_on = np.asarray(waves.get("ECG_R_Onsets", []), dtype="float64")
    except Exception:
        return None
    j40 = int(0.04 * fs)
    pr_win = int(0.02 * fs)
    devs = []
    for jo, on in zip(r_off, r_on):
        if np.isnan(jo) or np.isnan(on):
            continue
        jo, on = int(jo), int(on)
        j_pt = jo + j40
        if j_pt >= cleaned.size or on < 1:
            continue
        base = float(np.median(cleaned[max(0, on - pr_win):on + 1]))
        devs.append(float(cleaned[j_pt]) - base)
    return float(np.median(devs)) if devs else None


def _territory(per: dict):
    def elevated(group):
        vals = [per[l] for l in group if l in per and per[l] is not None]
        return len(vals) >= 2 and sum(1 for v in vals if v >= _ST_THRESH_MV) >= 2
    if elevated(ANTERIOR):
        return "anterior"
    if elevated(INFERIOR):
        return "inferior"
    if elevated(LATERAL):
        return "lateral"
    return None


def st_signal(signal: dict) -> dict:
    nk, np = _lazy()
    per = {}
    for lname, ld in (signal.get("leads") or {}).items():
        val = _lead_st(ld, nk, np)
        if val is not None:
            per[lname] = round(val, 3)
    return {"perLead": per, "territory": _territory(per)}


class NoneMeasurement(MeasurementProvider):
    name = "none"

    async def measure(self, signal: dict) -> dict:
        self._ni()

    async def st(self, signal: dict) -> dict:
        self._ni()


class NeuroKitMeasurement(MeasurementProvider):
    """REAL delineation-based measurement + ST (Phase 5C). Activate via KARDIOX_PROVIDER_MEASUREMENT=neurokit2."""

    name = "neurokit2"
    version = "1.0.0"
    requires = ("neurokit2", "numpy")
    implemented = False   # code is real; gated on validation vs annotated references

    async def measure(self, signal: dict) -> dict:
        return measure_signal(signal)

    async def st(self, signal: dict) -> dict:
        return st_signal(signal)
