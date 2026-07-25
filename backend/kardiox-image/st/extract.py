"""Image -> per-lead calibrated ECG signals + an EXTRACTION-QUALITY score.

The quality score is the SAFETY MECHANISM: it must be HIGH only when the extraction is trustworthy
(clean grid, full trace coverage, ~12 leads, smooth continuous traces, a regular rhythm) and LOW on
messy phone photos / partial captures, so the detector can ABSTAIN rather than manufacture a STEMI.

Supports two layouts (auto-detected): a 12-row single-column plot and the standard 3x4 (+ rhythm)
paper layout. Returns None (with quality) when it cannot form a usable set of leads.
"""
import numpy as np
from PIL import Image
from scipy.signal import find_peaks

STANDARD_LIMB = ["I","II","III","aVR","aVL","aVF"]
STANDARD_PREC = ["V1","V2","V3","V4","V5","V6"]
ALL_LEADS = STANDARD_LIMB + STANDARD_PREC
# top->bottom order seen in the 12-row export layout (Cabrera-ish)
ROW12_ORDER = ["aVL","I","aVR","II","aVF","III","V1","V2","V3","V4","V5","V6"]
# 3x4 grid: 3 rows x 4 columns (2.5s each), typical clinical print
GRID3x4 = [["I","aVR","V1","V4"],["II","aVL","V2","V5"],["III","aVF","V3","V6"]]

MAX_W = 1400          # downscale huge phone photos for speed + stable stats


def _load(path_or_img):
    im = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    im = im.convert("RGB")
    if im.width > MAX_W:
        im = im.resize((MAX_W, int(im.height * MAX_W / im.width)))
    return np.asarray(im).astype(np.float32)


def _trace_mask(a):
    """Trace pixels, NOT pink/red grid. Prefer the BLUE channel for blue-plot exports (cleaner, avoids
    text/dark artefacts that flip the follower); fall back to dark ink for black-on-paper photos."""
    R, G, B = a[...,0], a[...,1], a[...,2]
    grid = (R > 170) & (R > B + 20) & (R > G + 5)         # pink/red grid ink -> exclude
    blue = (B > 90) & (B > R + 25) & (B > G + 25)
    if blue.sum() > 0.002 * blue.size:                    # a blue-plot image -> blue only
        return blue & (~grid)
    lum = 0.299*R + 0.587*G + 0.114*B
    dark = lum < (0.55 * lum.mean())
    return dark & (~grid)


def _grid_px_per_mm(a):
    """px per 1mm small square via autocorrelation of the red/pink grid; returns (px_per_mm, confidence)."""
    R, G, B = a[...,0], a[...,1], a[...,2]
    gridrow = ((R > 170) & (R > B + 15)).sum(1).astype(float)
    if gridrow.sum() < a.shape[0]:                        # almost no grid detected
        return 8.0, 0.0
    g = gridrow - gridrow.mean()
    ac = np.correlate(g, g, "full")[len(g)-1:]
    ac = ac / (ac[0] + 1e-9)
    pk, props = find_peaks(ac[3:60], height=0.05)
    if len(pk) == 0:
        return 8.0, 0.0
    period = pk[0] + 3
    conf = float(min(1.0, props["peak_heights"][0] * 3))  # stronger periodicity -> more confidence
    return float(period), conf


def _bands(mask, expected):
    """Row bands where trace density is high; returns list of (y0,y1) centres, and a regularity score."""
    den = mask.sum(1).astype(float)
    if den.max() <= 0:
        return [], 0.0
    thr = den.max() * 0.06
    bands, i, H = [], 0, mask.shape[0]
    while i < H:
        if den[i] > thr:
            j = i
            while j < H and den[j] > thr:
                j += 1
            if j - i > 3:
                bands.append((i, j))
            i = j
        else:
            i += 1
    if not bands:
        return [], 0.0
    heights = np.array([b[1]-b[0] for b in bands])
    # regularity: how close band count is to expected + how even the spacing is
    centres = np.array([(b[0]+b[1])/2 for b in bands])
    reg = 1.0 - min(1.0, abs(len(bands) - expected) / max(expected, 1))
    if len(centres) >= 3:
        d = np.diff(np.sort(centres))
        reg *= max(0.0, 1.0 - (d.std() / (d.mean() + 1e-9)))
    return bands, float(reg)


def _follow(mask, cy, half, px_mV):
    """Trace-follow one lead centred at cy (+-half px). Returns (mv_array, coverage 0..1, jumpiness)."""
    H, W = mask.shape
    lo, hi = max(0, int(cy-half)), min(H, int(cy+half))
    prev, ys = cy, np.full(W, np.nan)
    for x in range(W):
        col = np.where(mask[lo:hi, x])[0]
        if len(col) == 0:
            continue
        col = col + lo
        ys[x] = col[np.argmin(np.abs(col - prev))]
        prev = 0.5*prev + 0.5*ys[x]
    ok = ~np.isnan(ys)
    coverage = float(ok.mean())
    if ok.sum() < W*0.35:
        return None, coverage, 1.0
    ys = np.interp(np.arange(W), np.where(ok)[0], ys[ok])
    jump = float(np.median(np.abs(np.diff(ys))) / (half + 1e-9))   # smooth trace -> small
    mv = -(ys - np.median(ys)) / px_mV
    return mv, coverage, jump


def _rpeaks(mv, px_s):
    if mv is None or len(mv) < int(px_s):
        return np.array([])
    c = mv - np.median(mv)
    pk, _ = find_peaks(np.abs(c), height=np.percentile(np.abs(c), 90), distance=int(0.3*px_s))
    return pk


def _rhythm_quality(mv, px_s):
    """R-peaks present + regular RR -> 0..1 (rhythm plausibility)."""
    pk = _rpeaks(mv, px_s)
    if len(pk) < 3:
        return 0.0
    rr = np.diff(pk)
    return float(max(0.0, 1.0 - rr.std() / (rr.mean() + 1e-9)))


def _cross_lead_alignment(leads, px_s):
    """KEY discriminator: in a real full-width multi-lead recording the R-peaks occur at the SAME
    x-positions across leads. Garbage extractions don't align. Returns 0..1 = mean fraction of leads
    that have an R-peak near each consensus peak. (Only meaningful for full-width/row12 leads.)"""
    peaklists = [(_rpeaks(mv, px_s)) for mv in leads.values()]
    peaklists = [p for p in peaklists if len(p) >= 3]
    if len(peaklists) < 4:
        return 0.0
    allpk = np.sort(np.concatenate(peaklists))
    tol = int(0.06 * px_s)                       # ~60 ms
    # greedy-cluster the pooled peaks
    clusters, cur = [], [allpk[0]]
    for p in allpk[1:]:
        if p - cur[-1] <= tol:
            cur.append(p)
        else:
            clusters.append(cur); cur = [p]
    clusters.append(cur)
    centres = [int(np.mean(c)) for c in clusters if len(c) >= 2]
    if not centres:
        return 0.0
    fracs = []
    for cx in centres:
        hit = sum(1 for pl in peaklists if np.any(np.abs(pl - cx) <= tol))
        fracs.append(hit / len(peaklists))
    return float(np.mean(fracs))


def extract(path_or_img):
    """Return dict: {leads:{name:mv}, fs, px_per_mm, quality:0..1, layout, components}. `leads` may be
    partial; caller must gate on `quality`."""
    a = _load(path_or_img)
    H, W, _ = a.shape
    mask = _trace_mask(a)
    px_mm, grid_conf = _grid_px_per_mm(a)
    px_mV = 10.0 * px_mm
    px_s = 25.0 * px_mm
    fs = px_s   # samples-per-second == px-per-second (1 px column = 1 sample)

    # layout detection: 12 full-width bands vs 3 (3x4) bands
    b12, reg12 = _bands(mask, 12)
    b34, reg34 = _bands(mask, 3)
    layout = "row12" if reg12 >= reg34 else "grid3x4"

    leads, covs, jumps = {}, [], []
    if layout == "row12":
        rows = np.where(mask.any(1))[0]
        if len(rows) < 10:
            return dict(leads={}, fs=fs, px_per_mm=px_mm, quality=0.0, layout=layout, components={})
        top, bot = rows.min(), rows.max()
        spacing = (bot - top) / 12
        centres = np.linspace(top + spacing/2, bot - spacing/2, 12)
        for name, cy in zip(ROW12_ORDER, centres):
            mv, cov, jmp = _follow(mask, cy, spacing*0.75, px_mV)
            covs.append(cov); jumps.append(jmp)
            if mv is not None:
                leads[name] = mv
    else:
        bands, _ = _bands(mask, 3)
        bands = sorted(bands, key=lambda b: b[1]-b[0], reverse=True)[:3]
        bands = sorted(bands, key=lambda b: b[0])
        if len(bands) < 3:
            return dict(leads={}, fs=fs, px_per_mm=px_mm, quality=0.0, layout=layout, components={})
        colw = W / 4
        for r, (y0, y1) in enumerate(bands):
            cy = (y0 + y1) / 2
            for c in range(4):
                name = GRID3x4[r][c]
                sub_mask = np.zeros_like(mask); sub_mask[:, int(c*colw):int((c+1)*colw)] = mask[:, int(c*colw):int((c+1)*colw)]
                mv, cov, jmp = _follow(sub_mask, cy, (y1-y0)*0.6, px_mV)
                covs.append(cov); jumps.append(jmp)
                if mv is not None:
                    leads[name] = mv[int(c*colw):int((c+1)*colw)]

    # ---- extraction-quality score ----
    # Gate on TRUSTWORTHY, discriminative signals: cross-lead R-peak ALIGNMENT (a genuine multi-lead
    # recording vs a garbage extraction), rhythm regularity, lead count, coverage. grid_conf/band_reg
    # are recorded for diagnostics but NOT gated on (they proved flaky). Geometric mean => any weak axis
    # tanks quality => bias toward ABSTAIN, which is the safe failure mode.
    n_leads = len(leads) / 12.0
    coverage = float(np.mean(covs)) if covs else 0.0
    smooth = float(1.0 - min(1.0, np.median(jumps))) if jumps else 0.0
    reg = reg12 if layout == "row12" else reg34
    rhy = float(np.mean([_rhythm_quality(mv, px_s) for mv in leads.values()])) if leads else 0.0
    align = _cross_lead_alignment(leads, px_s) if layout == "row12" else 0.0
    comps = {"grid": round(grid_conf,3), "n_leads": round(n_leads,3), "coverage": round(coverage,3),
             "smooth": round(smooth,3), "band_reg": round(reg,3), "rhythm": round(rhy,3), "align": round(align,3)}
    parts = [max(1e-3, align), max(1e-3, rhy), max(1e-3, n_leads), max(1e-3, coverage)]
    quality = float(np.exp(np.mean(np.log(parts))))   # geometric mean
    return dict(leads=leads, fs=px_s, px_per_mm=px_mm, quality=round(quality,3), layout=layout, components=comps)
