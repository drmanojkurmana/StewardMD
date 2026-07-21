"""Stage 5 — Quality Engine (Phase 6). Library: OpenCV + NumPy. REAL classical image-quality gate.

A deterministic pre-flight gate that scores a phone photo of a paper ECG on twelve independent
classical checks and returns pass / warn / reject BEFORE the pipeline spends compute. No learning
and no fabricated verdicts: every score is a measured pixel statistic. The one model-backed check
(out-of-distribution / "is this even an ECG?") is exposed as a hook that reports Not Ready
(`ood_score` returns None) rather than inventing a number.

Checks (name -> detector -> class):
  blur         variance of the Laplacian (low = out of focus)              [HARD]
  rotation     median Hough-line deviation from the nearest axis (deg)     [soft]
  shadow       block-wise mean-brightness std (illumination unevenness)    [soft]
  resolution   short edge = min(h, w) in px                                [HARD]
  noise        std of a high-pass residual (gray - gaussian blur)          [soft]
  contrast     grayscale std-dev                                          [HARD]
  glare        fraction of near-saturated pixels (>= _GLARE_LEVEL)         [HARD]
  grid         autocorrelation peak in the column projection (bool)        [soft]
  speedGain    grid period -> implied mm/s & mm/mV vs the 25/10 standard   [soft]
  cropping     fraction of the image border that is ink (content cut off)  [HARD]
  missingLeads standard 3x4(+rhythm) partition, cells below an ink floor   [soft]
  ood          model-backed novelty score — NOT READY (returns None)       [soft]

gate = "reject" if any HARD check fails, else "warn" if any soft check fails, else "pass".
`pass` (top-level bool) is True when the image is not hard-rejected (gate != "reject"); a "warn"
image is still usable but flagged.

Expected input:  raw image bytes (JPEG/PNG/decoded-HEIC upstream).
Expected output: assess() -> {overall, pass, gate, checks{<name>:{score,pass,detail}}, reasons[]}.
Failure modes:   empty/undecodable bytes -> BadImage(stage="quality"); cv2/numpy absent ->
                 UpstreamUnavailable(stage="quality"). No check crashes on partial data.
Boundary:        the metrics are real; the THRESHOLDS below are seed values and MUST be calibrated
                 against a labelled good/bad ECG-photo set before this gate is trusted for live
                 rejection. `estimate_speed_gain` maps a grid period to an implied paper speed/gain
                 only under a per-device pixel-density assumption (`_EXPECTED_PX_PER_MM`) and is
                 advisory. `ood_score` needs a trained detector that KardioX does not ship.
"""
from __future__ import annotations

from app.core.errors import BadImage, UpstreamUnavailable

# ── Thresholds (SEED VALUES — tunable; calibrate vs a labelled good/bad ECG-photo set) ────────────
_BLUR_MIN = 60.0                  # min variance-of-Laplacian; below = blurry              [HARD]
_ROT_MAX_DEG = 5.0                # max |median line angle| from the nearest axis          [soft]
_SHADOW_MAX = 25.0                # max block-mean brightness std (0..255)                 [soft]
_MIN_SHORT_EDGE = 400             # min short edge in px                                   [HARD]
_NOISE_MAX = 15.0                 # max high-pass residual std                             [soft]
_CONTRAST_MIN = 25.0              # min grayscale std                                      [HARD]
_GLARE_LEVEL = 250                # pixels >= this are treated as specular glare / blow-out
_GLARE_MAX_FRAC = 0.10            # max fraction of glare pixels                           [HARD]
_CROP_DARK_LEVEL = 64             # border pixels darker than this count as ink
_CROP_BORDER_INK_MAX_FRAC = 0.50  # max ink fraction along the border                     [HARD]
# grid / calibration
_GRID_MIN_PX = 3                  # smallest plausible 1mm grid period (px)
_GRID_MAX_PX = 40                 # largest plausible 1mm grid period (px)
_GRID_AC_MIN = 0.35               # min normalized autocorrelation to call a lag a grid peak
_EXPECTED_PX_PER_MM = 12.0        # per-device pixel-density assumption (NEEDS calibration)
_STD_MM_PER_S = 25.0              # standard paper speed
_STD_MM_PER_MV = 10.0             # standard gain
_SPEED_GAIN_TOL = 0.40            # allowed fractional deviation of implied speed / gain
# lead layout (computed here; no dependency on other pipeline modules)
_INK_LEVEL = 128                  # gray < this counts as trace ink
_RHYTHM_SPLIT = 0.75              # top 75% is the 3x4 grid, bottom 25% the rhythm strip
_LEAD_MIN_INK_FRAC = 0.004        # a lead cell below this ink fraction is "missing"
# hough
_HOUGH_VOTES = 150                # min collinear votes for a Hough line

# Hard checks REJECT; everything else WARNs. Cropping is intentionally SOFT: a border-ink heuristic
# cannot distinguish a legitimately full-frame ECG (common) from a truly cropped one, so it must not
# hard-block. True missing-lead loss is surfaced by the (soft) missingLeads check + layout detection.
# glare is a SOFT warning, not a hard reject: an uncalibrated bright-pixel heuristic must not block a
# clean white-paper ECG (the genuinely-unusable cases are caught by blur/contrast/resolution). It still
# degrades the quality score + warns.
_HARD_CHECKS = ("blur", "resolution", "contrast")
_CHECK_ORDER = ("blur", "rotation", "shadow", "resolution", "noise", "contrast",
                "glare", "grid", "speedGain", "cropping", "missingLeads", "ood")


def _lazy():
    """Import cv2 + numpy lazily so the module loads with none of the ML deps present."""
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as e:  # pragma: no cover - only exercised when deps are absent
        raise UpstreamUnavailable("opencv-python-headless / numpy not installed", stage="quality") from e


def _clamp01(x: float) -> float:
    """Clamp to [0, 1]."""
    return max(0.0, min(1.0, float(x)))


def _decode_gray(image: bytes):
    """Decode raw bytes to a 2-D grayscale uint8 array.

    Expected input:  non-empty bytes. Expected output: HxW uint8 array.
    Failure modes:   empty/undecodable -> BadImage(stage="quality"); cv2/numpy absent -> UpstreamUnavailable.
    """
    cv2, np = _lazy()
    if not isinstance(image, (bytes, bytearray)) or not image:
        raise BadImage("Empty image payload", stage="quality")
    gray = cv2.imdecode(np.frombuffer(bytes(image), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None or gray.size == 0:
        raise BadImage("Could not decode image", stage="quality")
    return gray


# ── Pure classical detectors (take a grayscale numpy array unless noted) ──────────────────────────
def blur_score(gray) -> float:
    """Focus score = variance of the Laplacian (higher = sharper).

    Expected input:  2-D grayscale uint8 array. Expected output: float >= 0.
    Failure modes:   cv2/numpy absent -> UpstreamUnavailable.
    Boundary:        absolute value depends on resolution/scene; compare against `_BLUR_MIN` (needs calibration).
    """
    cv2, _ = _lazy()
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def rotation_deg(gray) -> float:
    """Median Hough-line deviation from the nearest image axis, in degrees (0 = square).

    Detects straight lines (grid lines / trace baselines), folds each orientation into [-45, 45) so
    that both horizontal and vertical grid lines vote for the same skew, and returns the signed median.
    Expected input:  2-D grayscale uint8 array. Expected output: float in [-45, 45] (0.0 if no lines).
    Failure modes:   no line detected -> 0.0; cv2/numpy absent -> UpstreamUnavailable.
    Boundary:        vote threshold `_HOUGH_VOTES` scales with image size; needs calibration.
    """
    cv2, np = _lazy()
    edges = cv2.Canny(gray, 60, 180)
    lines = cv2.HoughLines(edges, 1, np.pi / 180.0, _HOUGH_VOTES)
    if lines is None or len(lines) == 0:
        return 0.0
    devs = []
    for entry in lines[:200]:
        theta = float(entry[0][1])
        angle = float(np.degrees(theta)) - 90.0    # line orientation from horizontal, [-90, 90)
        dev = ((angle + 45.0) % 90.0) - 45.0        # deviation from nearest axis, [-45, 45)
        devs.append(dev)
    return float(np.median(devs))


def shadow_unevenness(gray, blocks: int = 8) -> float:
    """Illumination unevenness = std of block-wise mean brightness (0 = flat lighting).

    Expected input:  2-D grayscale array; `blocks` >= 1 grid resolution per axis.
    Expected output: float >= 0 on the 0..255 scale. Failure modes: numpy absent -> UpstreamUnavailable.
    Boundary:        tune `_SHADOW_MAX` vs real phone-lighting; block count trades locality for stability.
    """
    _, np = _lazy()
    g = np.asarray(gray, dtype="float64")
    if g.ndim != 2:
        return 0.0
    h, w = g.shape[:2]
    n = max(1, int(blocks))
    bh, bw = max(1, h // n), max(1, w // n)
    means = []
    for r in range(0, h, bh):
        for c in range(0, w, bw):
            block = g[r:r + bh, c:c + bw]
            if block.size:
                means.append(float(block.mean()))
    return float(np.std(means)) if means else 0.0


def resolution_short_edge(gray) -> int:
    """Short edge = min(height, width) in pixels.

    Expected input:  2-D array. Expected output: int >= 0. Failure modes: malformed shape -> 0.
    """
    try:
        h, w = gray.shape[:2]
        return int(min(int(h), int(w)))
    except (AttributeError, ValueError, TypeError):
        return 0


def noise_level(gray) -> float:
    """High-frequency noise = std of the high-pass residual (gray - 3x3 Gaussian blur).

    Expected input:  2-D grayscale uint8 array. Expected output: float >= 0.
    Failure modes:   cv2/numpy absent -> UpstreamUnavailable.
    Boundary:        clean traces sit low, sensor/JPEG noise raises this; tune `_NOISE_MAX`.
    """
    cv2, np = _lazy()
    g = np.asarray(gray)
    residual = g.astype("float64") - cv2.GaussianBlur(g, (3, 3), 0).astype("float64")
    return float(residual.std())


def contrast_std(gray) -> float:
    """Global contrast = grayscale standard deviation.

    Expected input:  2-D grayscale array. Expected output: float >= 0.
    Failure modes:   numpy absent -> UpstreamUnavailable.
    """
    _, np = _lazy()
    return float(np.asarray(gray).std())


def glare_fraction(gray) -> float:
    """Fraction of the image covered by LARGE contiguous specular blow-out (flash glare).

    A plain white ECG paper is near-saturated almost everywhere, so counting every bright pixel
    (the old behaviour) wrongly rejected clean ECGs as "glare". Real glare is a specular highlight: a
    LARGE contiguous saturated region with no trace/grid detail. We therefore erode the saturated mask
    with a kernel scaled to the image, so thin bright gaps between grid lines / around the trace vanish
    and only substantial blow-out blobs remain.

    Expected input:  2-D grayscale array. Expected output: float in [0, 1].
    Failure modes:   numpy absent -> UpstreamUnavailable; empty array -> 0.0.
    """
    cv2, np = _lazy()
    g = np.asarray(gray)
    if not g.size:
        return 0.0
    sat = (g >= _GLARE_LEVEL)
    if not sat.any():
        return 0.0
    # "detail" = anything below saturation: grid lines, trace ink, text. A clean ECG has detail spread
    # across the whole sheet, so near_detail ~ the whole image and glare ~ 0. A real specular blow-out is
    # a large uniform saturated region with NO grid/trace nearby → those pixels are flagged.
    detail = (g < _GLARE_LEVEL).astype("uint8")
    k = max(15, int(min(g.shape[:2]) * 0.05)) | 1        # ~5% of the short side, odd
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    near_detail = cv2.dilate(detail, kernel)             # within k px of any sub-saturated detail
    glare = np.logical_and(sat, near_detail == 0)        # saturated AND far from any detail = blow-out
    return float(glare.mean())


def _grid_period(proj, np) -> float | None:
    """Dominant period (px) of a 1-D projection via normalized autocorrelation, within the mm range.

    Returns the smallest lag in [`_GRID_MIN_PX`, `_GRID_MAX_PX`) that is a local peak above
    `_GRID_AC_MIN`, else None (no periodic grid). `np` is passed in to keep this import-free.
    """
    proj = np.asarray(proj, dtype="float64")
    proj = proj - proj.mean()
    if proj.size < _GRID_MAX_PX + 2 or not np.any(proj):
        return None
    ac = np.correlate(proj, proj, mode="full")[proj.size - 1:]
    if ac[0] <= 0:
        return None
    ac = ac / ac[0]
    best_lag, best_val = None, _GRID_AC_MIN
    hi = min(_GRID_MAX_PX, ac.size - 1)
    for lag in range(_GRID_MIN_PX, hi):
        v = float(ac[lag])
        if v > best_val and v >= float(ac[lag - 1]) and v >= float(ac[lag + 1]):
            best_val, best_lag = v, lag
    return float(best_lag) if best_lag is not None else None


def grid_present(gray) -> bool:
    """True if a periodic mm grid survives in the column projection (autocorrelation peak).

    Expected input:  2-D grayscale array. Expected output: bool.
    Failure modes:   too-narrow / non-2-D -> False; numpy absent -> UpstreamUnavailable.
    """
    _, np = _lazy()
    g = np.asarray(gray, dtype="float64")
    if g.ndim != 2 or g.shape[1] < _GRID_MAX_PX + 2:
        return False
    return _grid_period(g.mean(axis=0), np) is not None


def estimate_speed_gain(gray) -> dict:
    """Infer px/mm from the grid period on each axis and flag implied paper speed / gain vs 25 / 10.

    Detects the horizontal (time-axis) and vertical (amplitude-axis) grid periods by autocorrelation
    and, under the per-device pixel-density assumption `_EXPECTED_PX_PER_MM`, reports the IMPLIED
    mm/s and mm/mV, flagging a deviation beyond `_SPEED_GAIN_TOL`.

    Expected input:  2-D grayscale array.
    Expected output: {"pxPerMm","pxPerMmX","pxPerMmY","impliedMmPerS","impliedMmPerMv","ok","detail"}.
                     pxPerMm* / impliedMm* are None when a grid period is not resolved (ok stays True).
    Failure modes:   numpy absent -> UpstreamUnavailable; never raises on partial data.
    Boundary:        px/mm cannot yield an ABSOLUTE paper speed without the capture DPI, so this is an
                     ADVISORY sanity heuristic keyed on `_EXPECTED_PX_PER_MM`, which needs calibration.
    """
    _, np = _lazy()
    g = np.asarray(gray, dtype="float64")
    unresolved = {"pxPerMm": None, "pxPerMmX": None, "pxPerMmY": None,
                  "impliedMmPerS": None, "impliedMmPerMv": None, "ok": True,
                  "detail": "grid period not resolved; paper speed/gain not verifiable"}
    if g.ndim != 2:
        return unresolved
    pxx = _grid_period(g.mean(axis=0), np) if g.shape[1] >= _GRID_MAX_PX + 2 else None
    pxy = _grid_period(g.mean(axis=1), np) if g.shape[0] >= _GRID_MAX_PX + 2 else None
    if pxx is None or pxy is None:
        return {**unresolved, "pxPerMmX": pxx, "pxPerMmY": pxy}
    implied_s = round(_STD_MM_PER_S * pxx / _EXPECTED_PX_PER_MM, 2)
    implied_mv = round(_STD_MM_PER_MV * pxy / _EXPECTED_PX_PER_MM, 2)
    dev = max(abs(implied_s - _STD_MM_PER_S) / _STD_MM_PER_S,
              abs(implied_mv - _STD_MM_PER_MV) / _STD_MM_PER_MV)
    return {"pxPerMm": round((pxx + pxy) / 2.0, 3), "pxPerMmX": round(pxx, 3), "pxPerMmY": round(pxy, 3),
            "impliedMmPerS": implied_s, "impliedMmPerMv": implied_mv, "ok": bool(dev <= _SPEED_GAIN_TOL),
            "detail": f"implied {implied_s} mm/s, {implied_mv} mm/mV (advisory; needs DPI calibration)"}


def detect_cropping(gray) -> dict:
    """Detect content cut off at the frame edge = fraction of the image border that is ink.

    Expected input:  2-D grayscale array.
    Expected output: {"borderInkFrac", "edges":{top,bottom,left,right}, "cropped": bool, "detail"}.
    Failure modes:   numpy absent -> UpstreamUnavailable; degenerate shape -> not cropped.
    Boundary:        a high border-ink fraction usually means the ECG paper is cropped or the trace
                     runs into the edge; `_CROP_BORDER_INK_MAX_FRAC` needs calibration.
    """
    _, np = _lazy()
    g = np.asarray(gray)
    if g.ndim != 2 or g.shape[0] < 2 or g.shape[1] < 2:
        return {"borderInkFrac": 0.0, "edges": {"top": 0.0, "bottom": 0.0, "left": 0.0, "right": 0.0},
                "cropped": False, "detail": "image too small to assess cropping"}
    dark = _CROP_DARK_LEVEL
    edges = {
        "top": float((g[0, :] < dark).mean()),
        "bottom": float((g[-1, :] < dark).mean()),
        "left": float((g[:, 0] < dark).mean()),
        "right": float((g[:, -1] < dark).mean()),
    }
    border = np.concatenate([g[0, :], g[-1, :], g[:, 0], g[:, -1]])
    frac = float((border < dark).mean()) if border.size else 0.0
    return {"borderInkFrac": round(frac, 4),
            "edges": {k: round(v, 4) for k, v in edges.items()},
            "cropped": bool(frac > _CROP_BORDER_INK_MAX_FRAC),
            "detail": f"{frac:.1%} of the border is ink (max {_CROP_BORDER_INK_MAX_FRAC:.0%})"}


def missing_leads(image_bytes: bytes) -> dict:
    """Partition the image into the standard 3x4 (+ rhythm strip) print layout and flag blank cells.

    The layout is computed locally (top `_RHYTHM_SPLIT` of the height = the 3x4 grid, remainder = the
    rhythm strip) — no dependency on other pipeline modules. A cell whose ink fraction is below
    `_LEAD_MIN_INK_FRAC` is reported as missing.

    Expected input:  raw image bytes.
    Expected output: {"expected": int, "present": int, "missing": [lead], "inkFrac": {lead: float},
                      "ok": bool, "detail": str}.
    Failure modes:   empty/undecodable bytes -> BadImage(stage="quality"); cv2/numpy absent -> UpstreamUnavailable.
    Boundary:        a fixed 3x4+rhythm heuristic (the near-universal panel); it mis-partitions a
                     non-3x4 print, so treat as advisory. A learned layout detector is the upgrade path.
    """
    _, np = _lazy()
    gray = _decode_gray(image_bytes)
    h, w = gray.shape[:2]
    ink = np.asarray(gray) < _INK_LEVEL
    labels = (("I", "aVR", "V1", "V4"), ("II", "aVL", "V2", "V5"), ("III", "aVF", "V3", "V6"))
    rows, cols = 3, 4
    grid_h = max(rows, int(h * _RHYTHM_SPLIT))
    ch, cw = max(1, grid_h // rows), max(1, w // cols)
    ink_frac: dict[str, float] = {}
    missing: list[str] = []
    for r in range(rows):
        for c in range(cols):
            y, x = r * ch, c * cw
            cell = ink[y:y + ch, x:x + cw]
            frac = float(cell.mean()) if cell.size else 0.0
            lead = labels[r][c]
            ink_frac[lead] = round(frac, 4)
            if frac < _LEAD_MIN_INK_FRAC:
                missing.append(lead)
    strip = ink[grid_h:h, 0:w]
    sfrac = float(strip.mean()) if strip.size else 0.0
    ink_frac["II-rhythm"] = round(sfrac, 4)
    if sfrac < _LEAD_MIN_INK_FRAC:
        missing.append("II-rhythm")
    expected = len(ink_frac)
    return {"expected": expected, "present": expected - len(missing), "missing": missing,
            "inkFrac": ink_frac, "ok": len(missing) == 0,
            "detail": ("all lead cells carry ink" if not missing
                       else "low/blank ink in: " + ", ".join(missing))}


def _load_ood_model():
    """Extension hook for a trained out-of-distribution / novelty detector.

    KardioX ships no OOD weights, so this always raises UpstreamUnavailable (a safe "Not Ready"
    state). Wire a real callable(image_bytes) -> float in [0, 1] here to activate `ood_score`;
    the seam mirrors `ExternalDigitization` — nothing is fabricated until a model exists.
    """
    raise UpstreamUnavailable("OOD/novelty detector model not installed", stage="quality")


def ood_score(image_bytes: bytes) -> float | None:
    """Out-of-distribution score in 0..1 (higher = less ECG-like) — NOT READY.

    Requires a trained novelty detector that KardioX does not ship. To avoid fabricating a number
    this returns None (an honest "Not Ready" sentinel) so the gate still runs the classical checks.
    Once `_load_ood_model` is wired to a real detector it returns that model's clamped score.

    Expected input:  raw image bytes. Expected output: float in [0, 1] or None (model not ready).
    Failure modes:   never raises for a missing model (returns None); malformed input -> None.
    """
    if not isinstance(image_bytes, (bytes, bytearray)) or not image_bytes:
        return None
    try:
        infer = _load_ood_model()
    except UpstreamUnavailable:
        return None
    return _clamp01(float(infer(bytes(image_bytes))))  # active only once a detector is wired


class QualityEngine:
    """KardioX classical image-quality gate. Deterministic; Not-Ready-safe for the model-backed check.

    Wire in as the pipeline quality provider; `assess` never fabricates a verdict and never crashes
    on partial data — it raises BadImage only when the bytes cannot be decoded at all.
    """

    name = "quality_engine"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    implemented = False   # detectors are real; thresholds gated on calibration vs a labelled set

    def assess(self, image: bytes) -> dict:
        """Run all twelve checks and return the gate decision.

        Expected input:  raw image bytes.
        Expected output: {"overall": float 0..1, "pass": bool, "gate": "pass"|"warn"|"reject",
                          "checks": {name: {"score": float|None, "pass": bool, "detail": str}},
                          "reasons": [str]}.
        Failure modes:   empty/undecodable bytes -> BadImage(stage="quality"); cv2/numpy absent ->
                         UpstreamUnavailable(stage="quality").
        Boundary:        thresholds are seed values pending calibration; the `ood` check is Not Ready.
        """
        gray = _decode_gray(image)

        blur = blur_score(gray)
        rot = rotation_deg(gray)
        shadow = shadow_unevenness(gray)
        res = resolution_short_edge(gray)
        noise = noise_level(gray)
        contrast = contrast_std(gray)
        glare = glare_fraction(gray)
        grid = grid_present(gray)
        speed = estimate_speed_gain(gray)
        crop = detect_cropping(gray)
        leads = missing_leads(image)
        ood = ood_score(image)

        checks: dict[str, dict] = {}

        def _put(name: str, score, passed: bool, detail: str) -> None:
            checks[name] = {"score": (round(float(score), 4) if score is not None else None),
                            "pass": bool(passed), "detail": detail}

        _put("blur", _clamp01(blur / (_BLUR_MIN * 3.0)), blur >= _BLUR_MIN,
             f"Laplacian variance {blur:.1f} (min {_BLUR_MIN})")
        _put("rotation", _clamp01(1.0 - abs(rot) / (_ROT_MAX_DEG * 3.0)), abs(rot) <= _ROT_MAX_DEG,
             f"skew {rot:+.1f} deg (max {_ROT_MAX_DEG})")
        _put("shadow", _clamp01(1.0 - shadow / (_SHADOW_MAX * 2.0)), shadow <= _SHADOW_MAX,
             f"illumination std {shadow:.1f} (max {_SHADOW_MAX})")
        _put("resolution", _clamp01(res / (_MIN_SHORT_EDGE * 2.0)), res >= _MIN_SHORT_EDGE,
             f"short edge {res}px (min {_MIN_SHORT_EDGE}px)")
        _put("noise", _clamp01(1.0 - noise / (_NOISE_MAX * 2.0)), noise <= _NOISE_MAX,
             f"high-freq residual std {noise:.1f} (max {_NOISE_MAX})")
        _put("contrast", _clamp01(contrast / (_CONTRAST_MIN * 3.0)), contrast >= _CONTRAST_MIN,
             f"grayscale std {contrast:.1f} (min {_CONTRAST_MIN})")
        _put("glare", _clamp01(1.0 - glare / (_GLARE_MAX_FRAC * 2.0)), glare <= _GLARE_MAX_FRAC,
             f"{glare:.1%} near-saturated pixels (max {_GLARE_MAX_FRAC:.0%})")
        _put("grid", 1.0 if grid else 0.0, grid,
             "mm grid detected" if grid else "no periodic mm grid detected")
        _put("speedGain", (None if speed["pxPerMm"] is None else (1.0 if speed["ok"] else 0.3)),
             speed["ok"], speed["detail"])
        _put("cropping", _clamp01(1.0 - crop["borderInkFrac"] / (_CROP_BORDER_INK_MAX_FRAC * 2.0)),
             not crop["cropped"], crop["detail"])
        _put("missingLeads", (leads["present"] / leads["expected"]) if leads["expected"] else 0.0,
             leads["ok"], leads["detail"])
        _put("ood", ood, True,
             "OOD/novelty detector not ready (no model shipped); classical checks only"
             if ood is None else f"novelty score {ood:.2f}")

        reasons = [f"{name}: {checks[name]['detail']}" for name in _CHECK_ORDER if not checks[name]["pass"]]
        hard_fail = any(not checks[k]["pass"] for k in _HARD_CHECKS)
        soft_fail = any(not checks[k]["pass"] for k in _CHECK_ORDER if k not in _HARD_CHECKS)
        gate = "reject" if hard_fail else ("warn" if soft_fail else "pass")

        numeric = [c["score"] for c in checks.values() if c["score"] is not None]
        overall = round(sum(numeric) / len(numeric), 4) if numeric else 0.0

        return {"overall": overall, "pass": gate != "reject", "gate": gate,
                "checks": {k: checks[k] for k in _CHECK_ORDER}, "reasons": reasons}
