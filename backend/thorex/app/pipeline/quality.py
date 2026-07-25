import numpy as np
from app.models.schemas import QualityReport


def assess(img: np.ndarray) -> QualityReport:
    issues: list[str] = []
    # normalize to 0..1 for heuristics
    a = (img - img.min()) / (np.ptp(img) + 1e-6)
    contrast = float(a.std())
    if contrast < 0.05:
        issues.append("low-contrast")
    mean = float(a.mean())
    if mean < 0.15:
        issues.append("under-exposed")
    elif mean > 0.85:
        issues.append("over-exposed")
    # rotation: left/right half mean asymmetry
    lh, rh = a[:, :112].mean(), a[:, 112:].mean()
    if abs(lh - rh) > 0.25:
        issues.append("rotated")
    # cropping: strong border energy suggests collimation/crop
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    if border.mean() > 0.6:
        issues.append("cropped")
    adequate = not any(i in issues for i in ("low-contrast", "under-exposed", "over-exposed"))
    return QualityReport(view="unknown", adequate=adequate, issues=issues)
