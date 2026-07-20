"""Stage 4 — Signal extraction (Phase 5C). Libraries: NumPy (+ WFDB for PhysioNet interop).

REAL: converts per-lead pixel traces + grid calibration into calibrated mV/ms signals, resampled to a
uniform sampling rate. Deterministic — no learning.

Calibration model (standard ECG paper): 25 mm/s sweep, 10 mm/mV gain, and `pxPerMm` from the digitizer's
grid detection. x-column -> seconds via (px / pxPerMm / mmPerS); y-pixel deviation from the lead baseline
-> mV via ((baseline - y) / pxPerMm / mmPerMv). Then linear-resample onto a uniform grid.

Expected input:  {"leads": {"II": [y_px,...], ...}, "calibration": {"mmPerS":25,"mmPerMv":10,"pxPerMm":N}}
Expected output: {"leads": {"II": {"mv":[...], "fs":500}, ...}, "duration_s": float}
Failure modes:   missing/invalid pxPerMm -> KardioXError(bad_calibration, 422); empty leads -> empty output.

Boundary: fully real given calibrated traces; end-to-end fidelity depends on the 5B digitizer's trace +
calibration accuracy, which needs validation against reference signals (e.g. PTB-XL via WFDB).
"""
from __future__ import annotations

from app.core.errors import KardioXError, LayoutUndetected
from app.services.base import WfdbProvider

DEFAULT_FS = 500


def _lazy_np():
    try:
        import numpy as np
        return np
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("numpy not installed", stage="signalExtraction") from e


def traces_to_signal(traces: dict, fs: int = DEFAULT_FS) -> dict:
    np = _lazy_np()
    traces = traces or {}
    cal = traces.get("calibration", {}) or {}
    mm_per_s = float(cal.get("mmPerS") or 25)
    mm_per_mv = float(cal.get("mmPerMv") or 10)
    px_per_mm = cal.get("pxPerMm")
    if not px_per_mm or float(px_per_mm) <= 0:
        raise LayoutUndetected("Missing/invalid pxPerMm calibration; cannot scale pixels to mV",
                               stage="signalExtraction")
    px_per_mm = float(px_per_mm)

    leads_out: dict = {}
    max_t = 0.0
    for lead, ypx in (traces.get("leads") or {}).items():
        arr = np.asarray(ypx, dtype="float64")
        if arr.size < 2:
            continue
        t = np.arange(arr.size) / px_per_mm / mm_per_s          # column -> seconds
        baseline = float(np.nanmedian(arr))
        mv = (baseline - arr) / px_per_mm / mm_per_mv           # pixel (y down) -> mV (up +)
        dur = float(t[-1])
        if dur <= 0:
            continue
        n = max(2, int(round(dur * fs)))
        mvv = np.interp(np.linspace(0.0, dur, n), t, mv)        # uniform resample
        leads_out[lead] = {"mv": [round(float(v), 5) for v in mvv], "fs": int(fs)}
        max_t = max(max_t, dur)

    return {"leads": leads_out, "duration_s": round(max_t, 3)}


def write_wfdb_record(signal: dict, record_name: str, out_dir: str) -> str:
    """Optional: persist a signal as a WFDB record for PhysioNet interop / offline validation.

    Returns the record base path. Used for dataset round-tripping + measurement validation, not in the
    hot request path.
    """
    try:
        import numpy as np
        import wfdb
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("wfdb/numpy not installed", stage="signalExtraction") from e
    leads = signal.get("leads", {})
    names = list(leads.keys())
    if not names:
        raise KardioXError("No leads to write", stage="signalExtraction")
    fs = int(leads[names[0]].get("fs", DEFAULT_FS))
    length = min(len(leads[n]["mv"]) for n in names)
    sig = np.column_stack([np.asarray(leads[n]["mv"][:length], dtype="float64") for n in names])
    wfdb.wrsamp(record_name, fs=fs, units=["mV"] * len(names), sig_name=names,
                p_signal=sig, write_dir=out_dir)
    return f"{out_dir}/{record_name}"


class NoneWfdb(WfdbProvider):
    name = "none"

    async def to_signal(self, traces: dict) -> dict:
        self._ni()


class WfdbSignal(WfdbProvider):
    """REAL calibrated pixel->mV/ms conversion (Phase 5C). Activate via KARDIOX_PROVIDER_WFDB=wfdb."""

    name = "wfdb"
    version = "1.0.0"
    requires = ("numpy",)   # wfdb only needed for the optional record writer
    implemented = False   # code is real; gated on validation against reference signals

    async def to_signal(self, traces: dict) -> dict:
        return traces_to_signal(traces)
