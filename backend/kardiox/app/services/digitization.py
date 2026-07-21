"""Stage 3 — Digitization (Phase 5B). Library: OpenCV + NumPy.

Converts the preprocessed (clean, de-gridded) ECG image into per-lead pixel traces + calibration.

REAL classical baseline (`ClassicalDigitization`): standard 3x4 (+ rhythm strip) layout detection
(`detect_lead_regions`) → per-column ink centre-line extraction per cell → grid/geometry-based px/mm
calibration. Deterministic; no learning.

Honest boundary: a single column-scan struggles with overlapping/low-contrast traces, and because 5A
removes the (colored) grid, px/mm is estimated from a **grid-FFT when a grid is still present, else from
the standard cell geometry** (2.5 s cell / 10 s rhythm strip at 25 mm/s) — an approximation. Production
accuracy needs a **learned digitizer** (train via PhysioNet `ecg-image-kit`); the `DigitizationProvider`
seam lets one drop in with no pipeline/route/iOS change. See docs/RESEARCH.md §5B.

Expected input:  processed PNG bytes (from stage 2).
Expected output: {"leads": {"II":[y_px,...], ...}, "calibration": {"mmPerS":25,"mmPerMv":10,"pxPerMm":N},
                  "layout": "twelveLead3x4", "method": "classical"}
Failure modes:   fewer than 3 leads carry ink -> LayoutUndetected (422).
"""
from __future__ import annotations

from app.core.errors import LayoutUndetected
from app.services.base import DigitizationProvider
from app.services.preprocessing import detect_lead_regions

_MM_PER_S = 25.0
_MM_PER_MV = 10.0
_CELL_SECONDS = 2.5          # a 3x4 cell shows 2.5 s
_STRIP_SECONDS = 10.0        # the rhythm strip shows 10 s
_MIN_INK_FRAC = 0.004        # a cell below this is treated as blank
_MIN_LEADS = 3               # fewer usable leads than this -> not a readable panel


def _lazy():
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as e:  # pragma: no cover
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("opencv-python-headless / numpy not installed", stage="digitization") from e


def _extract_trace(ink_cell, np):
    """Per-column ink centre-line (row centroid). NaN columns are linearly interpolated. None if blank."""
    h, w = ink_cell.shape[:2]
    ys = np.full(w, np.nan, dtype="float64")
    for j in range(w):
        rows = np.where(ink_cell[:, j])[0]
        if rows.size:
            ys[j] = float(rows.mean())
    valid = ~np.isnan(ys)
    if valid.sum() < max(2, w // 10):
        return None
    idx = np.arange(w)
    ys[~valid] = np.interp(idx[~valid], idx[valid], ys[valid])
    return ys


def estimate_px_per_mm(gray, np) -> float | None:
    """Grid period via autocorrelation of the column projection. Returns px/mm if a periodic grid
    survives, else None (caller falls back to geometry). Works only when a grid is still present."""
    try:
        proj = gray.mean(axis=0).astype("float64")
        proj -= proj.mean()
        ac = np.correlate(proj, proj, mode="full")[proj.size - 1:]
        if ac[0] <= 0:
            return None
        ac = ac / ac[0]
        # smallest lag with a strong peak in the plausible 1mm range (3..40 px)
        for lag in range(3, min(40, ac.size)):
            if ac[lag] > 0.5 and ac[lag] >= ac[lag - 1] and ac[lag] >= ac[min(lag + 1, ac.size - 1)]:
                return float(lag)
        return None
    except Exception:
        return None


def digitize_bytes(image: bytes, layout_hint: str | None = None) -> dict:
    cv2, np = _lazy()
    buf = np.frombuffer(image, dtype=np.uint8)
    gray = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    if gray is None or gray.size == 0:
        raise LayoutUndetected("Could not decode image for digitization", stage="digitization")
    H, W = gray.shape[:2]
    ink = gray < 128

    regions = detect_lead_regions(image)
    leads: dict = {}
    strip_w = None
    for reg in regions:
        if reg["inkFrac"] < _MIN_INK_FRAC:
            continue
        y, x, h, w = reg["y"], reg["x"], reg["h"], reg["w"]
        trace = _extract_trace(ink[y:y + h, x:x + w], np)
        if trace is None:
            continue
        leads[reg["lead"]] = [round(float(v), 2) for v in trace]
        if reg["lead"] == "II-rhythm":
            strip_w = w

    if len(leads) < _MIN_LEADS:
        raise LayoutUndetected(f"Only {len(leads)} readable leads; panel not detected", stage="digitization")

    # calibration: prefer grid-FFT (if a grid survived), else standard geometry.
    px_per_mm = estimate_px_per_mm(gray, np)
    calib_method = "grid"
    if not px_per_mm:
        if strip_w:
            px_per_mm = strip_w / (_STRIP_SECONDS * _MM_PER_S)      # 10 s strip
        else:
            cell_w = max((len(v) for v in leads.values()), default=W // 4)
            px_per_mm = cell_w / (_CELL_SECONDS * _MM_PER_S)        # 2.5 s cell
        calib_method = "geometry"

    return {
        "leads": leads,
        "calibration": {"mmPerS": _MM_PER_S, "mmPerMv": _MM_PER_MV,
                        "pxPerMm": round(float(px_per_mm), 3), "method": calib_method},
        "layout": "twelveLead3x4",
        "method": "classical",
    }


# ── Automatic multi-layout digitization (standard hospital print layouts) ──────────────────────────
# Detects the print layout from the image, digitizes each lead cell, and emits the reconstruction-layer
# format {leads:{name:{mv,fs}}, rhythmLead, layoutHint, calibration} that SMD_KARDIOX_RECONSTRUCT consumes
# (which then places each lead at its true column time-offset, masks the unprinted portion, and gates a
# dense signal to full-coverage only). Reuses the classical column-scan primitives; no learned model.
_STD12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
_LAYOUT_GRID = {
    "3x4": [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]],
    "6x2": [["I", "V1"], ["II", "V2"], ["III", "V3"], ["aVR", "V4"], ["aVL", "V5"], ["aVF", "V6"]],
    "12x1": [[l] for l in _STD12],
}
_LAYOUT_CELL_S = {"3x4": 2.5, "6x2": 5.0, "12x1": 10.0}


def detect_print_layout(image: bytes) -> dict:
    """Auto-detect the print layout from ink row/column structure: count contiguous horizontal trace
    bands (rows) + a full-width bottom band (rhythm strip). 3 rows->3x4, 6->6x2, >=10->12x1."""
    cv2, np = _lazy()
    gray = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise LayoutUndetected("Could not decode image for layout detection", stage="digitization")
    H, W = gray.shape[:2]
    ink = gray < 128
    rowink = ink.mean(axis=1)
    thr = max(float(rowink.mean()) * 0.5, 0.002)
    bands, inb, s = [], False, 0
    for y in range(H):
        if rowink[y] > thr and not inb:
            inb, s = True, y
        elif rowink[y] <= thr and inb:
            inb = False
            if (y - s) > H * 0.02:
                bands.append((s, y))
    if inb:
        bands.append((s, H))
    nb = len(bands)
    has_strip = False
    if bands:
        s, e = bands[-1]
        colcov = float((ink[s:e].mean(axis=0) > 0.01).mean())
        has_strip = bool(colcov > 0.85 and nb in (4, 7, 13))
    trace_rows = int(nb - (1 if has_strip else 0))
    if trace_rows >= 10:
        layout = "12x1"
    elif trace_rows == 6:
        layout = "6x2"
    elif trace_rows == 3:
        layout = "3x4"
    else:
        layout = "12x1" if trace_rows > 6 else ("6x2" if trace_rows >= 5 else "3x4")
    return {"layout": layout, "rows": trace_rows, "hasRhythmStrip": has_strip}


def digitize_auto(image: bytes, layout_hint: str | None = None) -> dict:
    """Layout-aware digitization -> reconstruction-layer format (per-lead mV windows + a rhythm strip).
    Auto-detects the layout unless `layout_hint` is given. Calibrated via grid-FFT (else geometry)."""
    cv2, np = _lazy()
    det = {"layout": layout_hint, "hasRhythmStrip": layout_hint == "3x4"} if layout_hint in _LAYOUT_GRID else detect_print_layout(image)
    layout, has_strip = det["layout"], det.get("hasRhythmStrip", False)
    gray = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    H, W = gray.shape[:2]
    ink = gray < 128
    px_per_mm = estimate_px_per_mm(gray, np)
    calib_method = "grid" if px_per_mm else "geometry"
    grid = _LAYOUT_GRID[layout]
    nrows, ncols = len(grid), len(grid[0])
    cell_s = _LAYOUT_CELL_S[layout]
    band_h = int(H * (0.78 if (layout == "3x4" and has_strip) else 1.0)) // nrows
    cell_w = W // ncols
    if not px_per_mm:
        px_per_mm = cell_w / (cell_s * _MM_PER_S)                     # geometry: cell columns == cell_s seconds
    fs = 500
    leads: dict = {}

    def cell_to_mv(sub, n_samples):
        trace = _extract_trace(sub, np)
        if trace is None:
            return None
        baseline = float(np.median(trace))
        mv = (baseline - trace) / (px_per_mm * _MM_PER_MV)            # px -> mV (invert: image y grows down)
        xs = np.linspace(0, len(mv) - 1, n_samples)
        return [round(float(v), 4) for v in np.interp(xs, np.arange(len(mv)), mv)]

    for r in range(nrows):
        for c in range(ncols):
            lead = grid[r][c]
            y, x = r * band_h, c * cell_w
            mv = cell_to_mv(ink[y:y + band_h, x:x + cell_w], int(round(cell_s * fs)))
            if mv is not None:
                leads[lead] = {"mv": mv, "fs": fs}
    rhythm = None
    if has_strip and layout == "3x4":
        y = int(H * 0.78)
        mv = cell_to_mv(ink[y:H, 0:W], int(round(10.0 * fs)))
        if mv is not None:
            leads["II"] = {"mv": mv, "fs": fs}
            rhythm = "II"
    if len(leads) < _MIN_LEADS:
        raise LayoutUndetected(f"Only {len(leads)} readable leads in {layout} layout", stage="digitization")
    return {
        "leads": leads, "rhythmLead": rhythm, "layoutHint": layout, "layout": layout,
        "calibration": {"mmPerS": _MM_PER_S, "mmPerMv": _MM_PER_MV, "pxPerMm": round(float(px_per_mm), 3), "method": calib_method},
        "method": "classical-multilayout",
    }


class ReconstructionDigitization(DigitizationProvider):
    """Layout-aware digitiser (default for hospital printouts). Auto-detects the layout, digitises each
    lead cell to calibrated mV via digitize_auto, and emits a pre-digitised passthrough `signal` block
    (so wfdb.to_signal returns it directly — no pixel round-trip). CRUCIALLY it does NOT stitch the
    discontinuous 2.5 s cells into a fake continuous 12-lead: for 3x4 the rhythm strip is lead "II"
    (continuous 10 s) so rhythm is assessed from it, and `full` is True only for a genuine 12x1
    full-disclosure. The orchestrator uses `layout`/`full` to run the 12-lead ensemble only when a real
    continuous 12-lead exists, and to defer (mark unavailable) otherwise."""

    name = "reconstruction"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    implemented = True

    async def digitize(self, image: bytes) -> dict:
        d = digitize_auto(image)                          # {leads:{name:{mv,fs}}, rhythmLead, layout, calibration}
        leads = d.get("leads", {}) or {}
        layout = d.get("layout", "12x1")
        got12 = sum(1 for n in _STD12 if n in leads and leads[n].get("mv"))
        full = (layout == "12x1" and got12 >= 12)
        fs0 = next((v.get("fs", 500) for v in leads.values()), 500)
        dur = max((len(v.get("mv", [])) / (v.get("fs") or fs0) for v in leads.values()), default=0.0)
        return {
            "signal": {"leads": leads, "duration_s": round(dur, 3)},   # to_signal passthrough (calibrated mV)
            "layout": layout, "full": bool(full), "rhythmLead": d.get("rhythmLead"),
            "calibration": d.get("calibration"), "method": d.get("method", "classical-multilayout"),
            # The classical column-scan recovers TIMING well (rate/rhythm) but NOT calibrated amplitudes
            # (baseline/gain error) — so amplitude-dependent diagnosis (ST/ischemia, axis, LVH, ML
            # classifiers) is NOT reliable from it. A learned/external digitiser sets this True.
            "amplitudeReliable": False,
        }


class NoneDigitization(DigitizationProvider):
    name = "none"

    async def digitize(self, image: bytes) -> dict:
        self._ni()


class ClassicalDigitization(DigitizationProvider):
    """REAL classical column-scan digitizer (Phase 5B). Activate via KARDIOX_PROVIDER_DIGITIZATION=classical."""

    name = "classical"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    implemented = False   # real baseline; accuracy gated on validation + the learned upgrade

    async def digitize(self, image: bytes) -> dict:
        return digitize_bytes(image)


# Back-compat alias: the registry / config referred to "opencv"; keep it pointing at the real baseline.
class OpenCVDigitization(ClassicalDigitization):
    name = "opencv"


def _completeness(traces: dict) -> float:
    """Fraction of the 12 standard leads the digitizer recovered (rhythm strip not counted)."""
    leads = (traces or {}).get("leads", {}) or {}
    std = {"I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"}
    got = sum(1 for k in leads if k in std and leads[k])
    return round(got / 12.0, 3)


def _trace_corr(a, b, np) -> float | None:
    """Pearson correlation of two pixel traces after length-alignment + z-score. None if degenerate."""
    xa = np.asarray(a, dtype="float64")
    xb = np.asarray(b, dtype="float64")
    n = min(xa.size, xb.size)
    if n < 8:
        return None
    xa, xb = xa[:n], xb[:n]
    sa, sb = xa.std(), xb.std()
    if sa < 1e-9 or sb < 1e-9:
        return None
    xa = (xa - xa.mean()) / sa
    xb = (xb - xb.mean()) / sb
    return float(np.clip(np.mean(xa * xb), -1.0, 1.0))


def _agreement(results: list[tuple[str, dict]], np) -> float | None:
    """Mean |correlation| over ALL member pairs across the leads they share. None if <2 members / no overlap."""
    if len(results) < 2:
        return None
    corrs = []
    for i in range(len(results)):
        la = results[i][1].get("leads", {}) or {}
        for j in range(i + 1, len(results)):
            lb = results[j][1].get("leads", {}) or {}
            for lead in set(la) & set(lb):
                c = _trace_corr(la[lead], lb[lead], np)
                if c is not None:
                    corrs.append(abs(c))
    return round(float(sum(corrs) / len(corrs)), 3) if corrs else None


def _pick_best(results: list[tuple[str, dict]]) -> tuple[str, dict]:
    """Choose the most complete digitization (most standard leads recovered)."""
    return max(results, key=lambda nr: _completeness(nr[1]))


class ConsensusDigitization(DigitizationProvider):
    """Run several digitizers and reconcile them (Phase 7). Members come from
    KARDIOX_DIGITIZER_CONSENSUS_MEMBERS (classical, external). Members that are Not Ready (e.g. no learned
    digitizer configured) are skipped; a single available member still yields a result (single-source,
    lower confidence). Attaches a `consensus` block: per-member lead counts, inter-member agreement,
    disagreement flag, chosen member, and a confidence from completeness + agreement.

    Failure modes: no member produces traces -> LayoutUndetected(422). Never fabricates traces."""

    name = "consensus"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    _DISAGREE_BELOW = 0.6   # mean inter-member correlation below this flags disagreement

    async def digitize(self, image: bytes) -> dict:
        _, np = _lazy()
        from app.core.config import get_settings
        registry = {"classical": ClassicalDigitization, "opencv": OpenCVDigitization,
                    "external": ExternalDigitization}
        results: list[tuple[str, dict]] = []
        members_meta: list[dict] = []
        for member in get_settings().consensus_members_list:
            provider = registry.get(member)
            if provider is None:
                members_meta.append({"name": member, "ok": False, "error": "unknown member"})
                continue
            try:
                traces = await provider().digitize(image)
                results.append((member, traces))
                members_meta.append({"name": member, "ok": True, "leads": len(traces.get("leads", {}))})
            except Exception as e:  # noqa: BLE001 — a Not-Ready / failing member is skipped, not fatal
                members_meta.append({"name": member, "ok": False, "error": type(e).__name__})

        if not results:
            raise LayoutUndetected("No digitizer produced traces (all members unavailable)", stage="digitization")

        chosen_name, chosen = _pick_best(results)
        agreement = _agreement(results, np)
        disagreement = bool(agreement is not None and agreement < self._DISAGREE_BELOW)
        completeness = _completeness(chosen)
        # single member -> confidence = completeness; multi -> blend completeness with agreement
        confidence = round(completeness if agreement is None else 0.5 * completeness + 0.5 * agreement, 3)

        out = dict(chosen)
        out["consensus"] = {"members": members_meta, "chosen": chosen_name, "agreement": agreement,
                            "disagreement": disagreement, "confidence": confidence}
        return out


class ExternalDigitization(DigitizationProvider):
    """Plug in a learned digitizer (e.g. the PhysioNet-2024-winning ECG-Digitiser, BSD-2) WITHOUT changing
    the backend: set KARDIOX_DIGITIZER_ENTRYPOINT="module:function" to a callable(image_bytes)->traces
    dict ({"leads":{lead:[px...]}, "calibration":{...}}). Ships nothing itself; raises UpstreamUnavailable
    until an entrypoint is configured (never fabricates traces)."""

    name = "external"
    version = "0.1.0"

    def validate_config(self) -> list[str]:
        from app.core.config import get_settings
        return [] if get_settings().digitizer_entrypoint else ["KARDIOX_DIGITIZER_ENTRYPOINT not set"]

    async def digitize(self, image: bytes) -> dict:
        import asyncio

        from app.core.config import get_settings
        from app.core.errors import UpstreamUnavailable
        from app.services.models import resolve_entrypoint
        ep = get_settings().digitizer_entrypoint
        if not ep:
            raise UpstreamUnavailable(
                "No external digitizer configured (KARDIOX_DIGITIZER_ENTRYPOINT=module:function, e.g. an "
                "ECG-Digitiser wrapper). KardioX ships no learned digitizer weights.", stage="digitization")
        fn = resolve_entrypoint(ep)
        result = await asyncio.to_thread(fn, image)
        if not isinstance(result, dict) or "leads" not in result:
            raise UpstreamUnavailable("external digitizer returned an unexpected shape", stage="digitization")
        return result
