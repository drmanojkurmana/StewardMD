"""Stage 4 — Layout + grid detection (Phase 5B support). Library: OpenCV + NumPy.

Classical, deterministic analysis of a (preprocessed, de-gridded or raw) ECG panel image:

  detect_layout(image) — decides the print layout (standard 3x4, 3x4 + rhythm strip, 6x2, single, or
    unknown) by projecting ink density onto the row/column axes and matching the regular block structure
    against the known layouts. When a 4-row structure with a wide full-width bottom band is present it
    resolves to the near-universal 3x4 + rhythm-strip layout, mapping the standard label grid
    [[I,aVR,V1,V4],[II,aVL,V2,V5],[III,aVF,V3,V6]] + "II-rhythm". Emits per-cell regions with ink fraction.

  detect_grid(image) — estimates the mm-grid pixel period by autocorrelation of the column projection
    (fundamental peak lag in a plausible 3..40 px range) -> px/mm. If no periodic grid survives (e.g. the
    grid was removed in preprocessing) it falls back to cell **geometry** (a 2.5 s cell at 25 mm/s), else
    method "none". It NEVER fabricates a confident value: confidence is low when the evidence is weak.

Both are pure heuristics over pixel statistics — no learning, no diagnosis. A learned layout/grid detector
is the documented upgrade path (see docs/RESEARCH.md §5B); it drops in behind these signatures unchanged.

Expected input:  raw or preprocessed image bytes (PNG/JPEG).
Expected output: detect_layout -> {"layout","rows","cols","hasRhythmStrip","confidence","regions":[...]};
                 detect_grid   -> {"pxPerMm","mmPerS":25.0,"mmPerMv":10.0,"confidence","method"}.
Failure modes:   undecodable bytes -> BadImage(stage="digitization"); a blank/near-empty panel returns a
                 safe "unknown"/"none" result with low confidence (never crashes); missing cv2/numpy ->
                 UpstreamUnavailable(stage="digitization").
Boundary:        thresholds are real + tunable; accuracy on real phone photos wants validation against a
                 labelled panel set before these gate anything live.
"""
from __future__ import annotations

from app.core.errors import BadImage, KardioXError

_MM_PER_S = 25.0
_MM_PER_MV = 10.0
_CELL_SECONDS = 2.5           # a standard 3x4 cell shows 2.5 s of signal
_RHYTHM_TOP_FRAC = 0.75       # the 3x4 grid occupies the top ~75%; the rhythm strip the bottom ~25%
_MIN_INK_FRAC = 5e-4          # panels with less ink than this are treated as blank -> "unknown"
_BAND_REL = 0.2               # a density-profile band is where the (smoothed) profile >= 20% of its peak
_MIN_BAND_LEN = 2             # ignore bands thinner than this many pixels (speckle)
_WIDE_FRAC = 0.55             # a band whose ink spans >= this fraction of the width is "full-width"
_LAYOUT_MIN_SCORE = 0.35      # below this best-candidate match -> report "unknown"
_GRID_LAG_LO = 3              # smallest plausible grid period (px) for the autocorrelation search
_GRID_LAG_HI = 40             # largest plausible grid period (px)
_GRID_PEAK_MIN = 0.5          # normalized autocorrelation peak required to trust a grid period

# Standard label grids keyed by (rows, cols). Order matches the printed panel top-to-bottom, left-to-right.
_LABELS: dict[tuple[int, int], list[list[str]]] = {
    (3, 4): [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]],
    (6, 2): [["I", "V1"], ["II", "V2"], ["III", "V3"], ["aVR", "V4"], ["aVL", "V5"], ["aVF", "V6"]],
    (1, 1): [["II"]],
}

# Candidate layouts: (label, rows, cols, hasRhythmStrip, expected_row_bands, expected_col_bands).
_CANDIDATES: tuple[tuple[str, int, int, bool, int, int], ...] = (
    ("twelveLead3x4_rhythm", 3, 4, True, 4, 4),
    ("twelveLead3x4", 3, 4, False, 3, 4),
    ("sixByTwo", 6, 2, False, 6, 2),
    ("single", 1, 1, False, 1, 1),
)


def _lazy():
    """Import cv2 + numpy lazily so this module loads without the ML deps installed."""
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as e:  # pragma: no cover - exercised only when deps are absent
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("opencv-python-headless / numpy not installed", stage="digitization") from e


def _decode_gray(image: bytes):
    """Decode bytes to a grayscale ndarray. Raises BadImage(stage='digitization') on any decode failure."""
    cv2, np = _lazy()
    if not image:
        raise BadImage("Empty image payload", stage="digitization")
    gray = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None or gray.size == 0 or min(gray.shape[:2]) < 4:
        raise BadImage("Could not decode image or image too small", stage="digitization")
    return gray


def _bands(profile, np) -> list[tuple[int, int]]:
    """Contiguous [start, end) runs where the smoothed 1-D density profile exceeds _BAND_REL of its peak.

    Expected input:  a non-negative 1-D density profile (ink fraction per row or per column).
    Expected output: a list of (start, end) index runs, each at least _MIN_BAND_LEN long.
    Failure modes:   an all-zero profile returns []. Never raises.
    """
    prof = profile.astype("float64")
    k = max(1, prof.size // 100)
    if k > 1 and prof.size > k:
        prof = np.convolve(prof, np.ones(k) / k, mode="same")
    peak = float(prof.max()) if prof.size else 0.0
    if peak <= 0:
        return []
    above = prof >= _BAND_REL * peak
    bands: list[tuple[int, int]] = []
    i, n = 0, prof.size
    while i < n:
        if above[i]:
            j = i
            while j < n and above[j]:
                j += 1
            if j - i >= _MIN_BAND_LEN:
                bands.append((i, j))
            i = j
        else:
            i += 1
    return bands


def _band_width_frac(ink, band: tuple[int, int]) -> float:
    """Fraction of columns that carry any ink within a horizontal row-band (1.0 = full-width strip)."""
    start, end = band
    sub = ink[start:end, :]
    if sub.size == 0:
        return 0.0
    return float(sub.any(axis=0).mean())


def _regularity(bands: list[tuple[int, int]], np) -> float:
    """How evenly spaced the band centres are, in [0, 1] (1.0 = perfectly regular). <3 bands -> neutral."""
    if len(bands) < 3:
        return 1.0 if bands else 0.0
    centres = np.array([(a + b) / 2.0 for a, b in bands], dtype="float64")
    gaps = np.diff(centres)
    mean = float(gaps.mean())
    if mean <= 0:
        return 0.0
    return float(max(0.0, 1.0 - gaps.std() / mean))


def _count_score(obs: int, exp: int) -> float:
    """1.0 when obs == exp, decaying linearly to 0.0 as the counts diverge."""
    return max(0.0, 1.0 - abs(obs - exp) / float(max(1, exp)))


def _regions(ink, height: int, width: int, rows: int, cols: int, has_rhythm: bool, np) -> list[dict]:
    """Geometric lead cells for the chosen layout, each with its ink fraction. Returns [] for rows/cols<1."""
    if rows < 1 or cols < 1:
        return []
    grid = _LABELS.get((rows, cols))
    grid_h = int(height * _RHYTHM_TOP_FRAC) if has_rhythm else height
    ch, cw = max(1, grid_h // rows), max(1, width // cols)
    regions: list[dict] = []
    for r in range(rows):
        for c in range(cols):
            x, y = c * cw, r * ch
            cell = ink[y:y + ch, x:x + cw]
            frac = float(cell.mean()) if cell.size else 0.0
            lead = grid[r][c] if grid and r < len(grid) and c < len(grid[r]) else f"r{r}c{c}"
            regions.append({"lead": lead, "x": x, "y": y, "w": cw, "h": ch, "inkFrac": round(frac, 4)})
    if has_rhythm:
        y = grid_h
        strip = ink[y:height, 0:width]
        regions.append({"lead": "II-rhythm", "x": 0, "y": y, "w": width, "h": height - y,
                        "inkFrac": round(float(strip.mean()) if strip.size else 0.0, 4)})
    return regions


def detect_layout(image: bytes) -> dict:
    """Detect the ECG print layout by matching ink-density block structure against the known layouts.

    Expected input:  raw or preprocessed image bytes (PNG/JPEG).
    Expected output: {"layout": "twelveLead3x4"|"twelveLead3x4_rhythm"|"sixByTwo"|"single"|"unknown",
                      "rows": int, "cols": int, "hasRhythmStrip": bool, "confidence": float in [0,1],
                      "regions": [{"lead","x","y","w","h","inkFrac"}]}. Regions carry the standard label
                      grid for the chosen layout; [] when the layout is "unknown".
    Failure modes:   undecodable bytes -> BadImage(stage="digitization"); a near-blank panel returns
                      "unknown" with confidence 0.0 and no regions (never raises on sparse data); missing
                      cv2/numpy -> UpstreamUnavailable(stage="digitization").
    Boundary:        a layout heuristic, not a learned detector; confidence reflects how cleanly the
                      density profile matches the winning layout, so treat low-confidence results as advisory.
    """
    cv2, np = _lazy()
    gray = _decode_gray(image)
    height, width = gray.shape[:2]
    ink = gray < 128

    unknown = {"layout": "unknown", "rows": 0, "cols": 0, "hasRhythmStrip": False,
               "confidence": 0.0, "regions": []}
    if float(ink.mean()) < _MIN_INK_FRAC:
        return unknown

    row_bands = _bands(ink.mean(axis=1), np)
    if not row_bands:
        return unknown

    # A rhythm strip reads as a >=4th row-band whose ink spans (nearly) the full width.
    observed_rhythm = len(row_bands) >= 4 and _band_width_frac(ink, row_bands[-1]) >= _WIDE_FRAC
    grid_end = row_bands[-1][0] if observed_rhythm else height
    col_bands = _bands(ink[0:grid_end, :].mean(axis=0), np)
    n_row, n_col = len(row_bands), len(col_bands)

    best = None
    best_score = -1.0
    for label, rows, cols, rhythm, exp_row, exp_col in _CANDIDATES:
        score = 0.5 * _count_score(n_row, exp_row) + 0.5 * _count_score(n_col, exp_col)
        if rhythm != observed_rhythm:
            score *= 0.6   # penalise a layout whose rhythm-strip expectation disagrees with the evidence
        if score > best_score:
            best, best_score = (label, rows, cols, rhythm), score

    label, rows, cols, rhythm = best
    confidence = round(max(0.0, min(1.0, best_score * (0.5 + 0.5 * _regularity(row_bands, np)))), 3)
    if best_score < _LAYOUT_MIN_SCORE:
        out = dict(unknown)
        out["confidence"] = confidence
        return out

    return {
        "layout": label,
        "rows": rows,
        "cols": cols,
        "hasRhythmStrip": rhythm,
        "confidence": confidence,
        "regions": _regions(ink, height, width, rows, cols, rhythm, np),
    }


def _autocorr_period(gray, np) -> tuple[int | None, float]:
    """Fundamental grid period (px) from the column projection's normalized autocorrelation.

    Returns (lag, strength) for the smallest lag in [_GRID_LAG_LO, _GRID_LAG_HI] that is a local peak
    with strength >= _GRID_PEAK_MIN, else (None, 0.0). No periodic grid -> (None, 0.0). Never raises.
    """
    proj = gray.mean(axis=0).astype("float64")
    if proj.size < _GRID_LAG_LO * 2:
        return None, 0.0
    proj -= proj.mean()
    ac = np.correlate(proj, proj, mode="full")[proj.size - 1:]
    if ac[0] <= 0:
        return None, 0.0
    ac = ac / ac[0]
    hi = min(_GRID_LAG_HI, ac.size - 2)
    for lag in range(_GRID_LAG_LO, hi + 1):
        if ac[lag] >= _GRID_PEAK_MIN and ac[lag] >= ac[lag - 1] and ac[lag] >= ac[lag + 1]:
            return lag, float(ac[lag])
    return None, 0.0


def detect_grid(image: bytes) -> dict:
    """Estimate the mm-grid pixel scale via grid autocorrelation, falling back to cell geometry.

    Expected input:  raw or preprocessed image bytes (PNG/JPEG).
    Expected output: {"pxPerMm": float|None, "mmPerS": 25.0, "mmPerMv": 10.0, "confidence": float in [0,1],
                      "method": "autocorr"|"geometry"|"none"}. "autocorr" when a periodic grid is found;
                      "geometry" when px/mm is inferred from the detected cell width (2.5 s at 25 mm/s);
                      "none" (pxPerMm None, confidence 0.0) when neither is available.
    Failure modes:   undecodable bytes -> BadImage(stage="digitization"); a blank image yields
                      method "none" with confidence 0.0 (never fabricates a confident scale); missing
                      cv2/numpy -> UpstreamUnavailable(stage="digitization").
    Boundary:        px/mm from geometry is an approximation (paper often has its grid removed upstream);
                      trust it only at low confidence until validated.
    """
    cv2, np = _lazy()
    gray = _decode_gray(image)

    lag, strength = _autocorr_period(gray, np)
    if lag is not None:
        return {"pxPerMm": round(float(lag), 3), "mmPerS": _MM_PER_S, "mmPerMv": _MM_PER_MV,
                "confidence": round(min(1.0, strength), 3), "method": "autocorr"}

    # No periodic grid survived — infer px/mm from the standard cell geometry, if a layout is readable.
    try:
        layout = detect_layout(image)
    except KardioXError:
        layout = None
    regions = layout.get("regions", []) if layout else []
    cell_widths = [r["w"] for r in regions if r.get("lead") != "II-rhythm" and r.get("w")]
    if cell_widths:
        cell_w = float(np.median(np.array(cell_widths, dtype="float64")))
        px_per_mm = cell_w / (_CELL_SECONDS * _MM_PER_S)
        confidence = round(0.4 * float(layout.get("confidence", 0.0)), 3)
        return {"pxPerMm": round(px_per_mm, 3), "mmPerS": _MM_PER_S, "mmPerMv": _MM_PER_MV,
                "confidence": confidence, "method": "geometry"}

    return {"pxPerMm": None, "mmPerS": _MM_PER_S, "mmPerMv": _MM_PER_MV,
            "confidence": 0.0, "method": "none"}
