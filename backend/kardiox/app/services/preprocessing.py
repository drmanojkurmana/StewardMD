"""Stage 2 — Image preprocessing (Phase 5A). Library: OpenCV (opencv-python-headless) + NumPy.

REAL classical CV — no learning required. The pipeline is:
  decode → (auto-crop + perspective-correct the paper) → deskew → color-based gridline removal →
  grayscale → glare reduction (inpaint) → CLAHE contrast → denoise → adaptive threshold →
  small-speckle removal → re-encode PNG.

Returns the processed (clean, high-contrast, de-gridded) ECG image as PNG bytes — the input to
digitization. `detect_lead_regions` locates the 12 lead cells (standard 3x4 + rhythm strip layout).

Boundary: the algorithms are real + unit-tested on synthetic images. Accuracy on real phone photos of
paper ECGs (glare, curl, skew, lighting) still needs a labelled image set to tune + validate, so
`implemented` stays False (activate per env once validated). Each optional step degrades gracefully
(a failing crop/deskew falls back to the prior image) so a hard photo never crashes the stage.

Expected input:  raw image bytes (JPEG/PNG/HEIC-decoded upstream).
Expected output:  PNG bytes, trace ~black on white, grid removed.
Failure modes:    undecodable bytes -> BadImage; empty/1px image -> BadImage.
"""
from __future__ import annotations

from app.core.errors import BadImage
from app.services.base import PreprocessingProvider

# ── Algorithm parameters (tuned defaults; not secrets) ────────────────────────────────────────────
_CLAHE_CLIP = 2.0
_CLAHE_TILE = (8, 8)
_ADAPTIVE_BLOCK = 21          # odd; local window for adaptive threshold
_ADAPTIVE_C = 10              # subtracted constant
_GLARE_LEVEL = 245           # >= this 8-bit value is treated as glare/specular
_MIN_SPECKLE_PX = 6          # connected components smaller than this are noise
_MAX_DESKEW_DEG = 15.0       # never rotate more than this (avoids catastrophic over-rotation)
_MIN_PAPER_AREA_FRAC = 0.20  # a detected quad must cover >= this fraction to be treated as the sheet


def _lazy_cv():
    """Import cv2 + numpy lazily so the module (and the rest of the app) loads without the ML deps."""
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as e:  # pragma: no cover - exercised only when deps are absent
        from app.core.errors import UpstreamUnavailable
        raise UpstreamUnavailable("opencv-python-headless / numpy not installed", stage="enhancement") from e


def _decode(image: bytes):
    cv2, np = _lazy_cv()
    if not image:
        raise BadImage("Empty image payload", stage="enhancement")
    buf = np.frombuffer(image, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None or img.size == 0 or min(img.shape[:2]) < 8:
        raise BadImage("Could not decode image or image too small", stage="enhancement")
    return img


def _order_quad(pts):
    """Order 4 points as [top-left, top-right, bottom-right, bottom-left]."""
    _, np = _lazy_cv()
    pts = pts.reshape(4, 2).astype("float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], dtype="float32")


def _find_paper_quad(gray):
    """Largest 4-point contour that plausibly bounds the ECG sheet, else None."""
    cv2, np = _lazy_cv()
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    area_img = gray.shape[0] * gray.shape[1]
    for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:5]:
        if cv2.contourArea(c) < _MIN_PAPER_AREA_FRAC * area_img:
            break
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return _order_quad(approx)
    return None


def perspective_correct(img):
    """Auto-crop + perspective-warp the ECG sheet to a top-down rectangle. Falls back to the input."""
    try:
        cv2, np = _lazy_cv()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        quad = _find_paper_quad(gray)
        if quad is None:
            return img
        (tl, tr, br, bl) = quad
        w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        if w < 32 or h < 32:
            return img
        dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype="float32")
        M = cv2.getPerspectiveTransform(quad, dst)
        return cv2.warpPerspective(img, M, (w, h))
    except BadImage:
        raise
    except Exception:  # any CV failure -> degrade to original
        return img


def deskew(gray):
    """Estimate + correct small in-plane rotation from the ink's minAreaRect. Clamped to +/-15 deg."""
    try:
        cv2, np = _lazy_cv()
        ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        coords = np.column_stack(np.where(ink > 0))
        if coords.shape[0] < 50:
            return gray
        angle = cv2.minAreaRect(coords[:, ::-1].astype("float32"))[-1]
        if angle > 45:
            angle -= 90
        if abs(angle) < 0.2 or abs(angle) > _MAX_DESKEW_DEG:
            return gray
        h, w = gray.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    except Exception:
        return gray


def remove_grid_color(img):
    """Remove the (red/orange) mm grid by masking reddish pixels to white. Falls back to the input."""
    try:
        cv2, np = _lazy_cv()
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        # red/orange wraps the hue circle; require moderate saturation so we don't touch the black trace
        lo1 = cv2.inRange(hsv, np.array([0, 40, 40]), np.array([18, 255, 255]))
        lo2 = cv2.inRange(hsv, np.array([160, 40, 40]), np.array([180, 255, 255]))
        grid = cv2.dilate(cv2.bitwise_or(lo1, lo2), np.ones((2, 2), np.uint8), iterations=1)
        out = img.copy()
        out[grid > 0] = (255, 255, 255)
        return out
    except Exception:
        return img


def reduce_glare(gray):
    """Inpaint near-saturated specular highlights so glare doesn't read as signal."""
    try:
        cv2, np = _lazy_cv()
        mask = (gray >= _GLARE_LEVEL).astype(np.uint8) * 255
        if int(mask.sum()) == 0:
            return gray
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
        return cv2.inpaint(gray, mask, 3, cv2.INPAINT_TELEA)
    except Exception:
        return gray


def _clahe(gray):
    cv2, _ = _lazy_cv()
    return cv2.createCLAHE(clipLimit=_CLAHE_CLIP, tileGridSize=_CLAHE_TILE).apply(gray)


def _adaptive_binary(gray):
    """Adaptive threshold -> trace as black(0) on white(255). Robust to uneven lighting."""
    cv2, _ = _lazy_cv()
    den = cv2.medianBlur(gray, 3)
    ink = cv2.adaptiveThreshold(den, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY_INV, _ADAPTIVE_BLOCK, _ADAPTIVE_C)
    return ink  # ink=255 where trace is


def _drop_speckle(ink):
    """Remove connected components smaller than _MIN_SPECKLE_PX (salt noise)."""
    try:
        cv2, np = _lazy_cv()
        n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
        keep = np.zeros_like(ink)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= _MIN_SPECKLE_PX:
                keep[labels == i] = 255
        return keep
    except Exception:
        return ink


def detect_lead_regions(processed_png: bytes, rows: int = 3, cols: int = 4, rhythm_strip: bool = True) -> list[dict]:
    """Locate the lead cells in a standard 3x4 (+ rhythm strip) print layout.

    Returns [{lead, x, y, w, h, inkFrac}]. inkFrac lets the caller reject blank cells. This is a
    layout heuristic (the near-universal 3x4 panel); a learned detector is the documented upgrade path.
    """
    cv2, np = _lazy_cv()
    buf = np.frombuffer(processed_png, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise BadImage("Could not decode processed image for lead detection", stage="digitization")
    H, W = img.shape[:2]
    ink = (img < 128)
    labels = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]]
    grid_h = int(H * (0.75 if rhythm_strip else 1.0))
    ch, cw = grid_h // rows, W // cols
    regions: list[dict] = []
    for r in range(rows):
        for c in range(cols):
            x, y = c * cw, r * ch
            cell = ink[y:y + ch, x:x + cw]
            frac = float(cell.mean()) if cell.size else 0.0
            lead = labels[r][c] if r < len(labels) and c < len(labels[r]) else f"r{r}c{c}"
            regions.append({"lead": lead, "x": x, "y": y, "w": cw, "h": ch, "inkFrac": round(frac, 4)})
    if rhythm_strip:
        y = grid_h
        cell = ink[y:H, 0:W]
        regions.append({"lead": "II-rhythm", "x": 0, "y": y, "w": W, "h": H - y,
                        "inkFrac": round(float(cell.mean()) if cell.size else 0.0, 4)})
    return regions


def preprocess_bytes(image: bytes) -> bytes:
    """The full 5A pipeline as a pure function (so it is unit-testable without the async provider)."""
    cv2, _ = _lazy_cv()
    img = _decode(image)                 # BadImage on failure
    img = perspective_correct(img)       # auto-crop + perspective (graceful fallback)
    img = remove_grid_color(img)         # color-based gridline removal
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = deskew(gray)                  # small-angle rotation correction
    gray = reduce_glare(gray)            # inpaint specular highlights
    gray = _clahe(gray)                  # local contrast
    ink = _adaptive_binary(gray)         # adaptive threshold (trace=255)
    ink = _drop_speckle(ink)             # remove salt noise
    out = 255 - ink                      # trace black on white (viewable processed image)
    ok, enc = cv2.imencode(".png", out)
    if not ok:
        raise BadImage("Failed to encode processed image", stage="enhancement")
    return enc.tobytes()


class NonePreprocessing(PreprocessingProvider):
    name = "none"

    async def enhance(self, image: bytes) -> bytes:
        self._ni()


class OpenCVPreprocessing(PreprocessingProvider):
    """REAL classical preprocessing (Phase 5A). Activate via KARDIOX_PROVIDER_PREPROCESSING=opencv."""

    name = "opencv"
    version = "1.0.0"
    requires = ("cv2", "numpy")
    implemented = False   # code is real; flip True after validation on a labelled real-photo set

    async def enhance(self, image: bytes) -> bytes:
        return preprocess_bytes(image)
