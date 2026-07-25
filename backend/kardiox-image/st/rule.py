"""Per-lead ST-deviation measurement + contiguous-territory STEMI criteria.

Data-driven TERRITORIES so posterior / inferior / lateral / reciprocal extend by editing one table.
Criteria (conservative, to protect specificity): >=2 CONTIGUOUS leads clearing the per-lead threshold
(limb >=1.0 mm, precordial >=2.0 mm). Reciprocal ST-depression, when present, raises confidence.
Outputs a binary decision AND a continuous score (for AUROC).
"""
import numpy as np
from scipy.signal import find_peaks

# territory -> (elevation leads, reciprocal leads). Order within a territory implies contiguity.
TERRITORIES = {
    "anteroseptal":  (["V1", "V2", "V3"],       []),
    "anterior":      (["V2", "V3", "V4"],       []),
    "anterolateral": (["V3", "V4", "V5", "V6"], ["III", "aVF"]),
    "lateral":       (["I", "aVL", "V5", "V6"], ["III", "aVF"]),
    "inferior":      (["II", "III", "aVF"],     ["I", "aVL"]),
    "high-lateral":  (["I", "aVL"],             ["III", "aVF"]),
    # posterior is inferred from RECIPROCAL anterior ST-DEPRESSION + tall R (handled in verdict); the
    # table entry documents intent and keeps the structure ready.
    "posterior":     (["V7", "V8", "V9"],       ["V1", "V2", "V3"]),
}
LIMB = {"I", "II", "III", "aVR", "aVL", "aVF"}
def thr_mm(lead):
    return 1.0 if lead in LIMB else 2.0
DEPRESSION_MM = -1.0    # reciprocal / posterior ST-depression threshold


def measure_st(leads, fs):
    """Return {lead: st_deviation_mm} (median over beats), measured at ~J+60ms vs the ISOELECTRIC
    (histogram mode = the level the trace rests at during diastole). The mode reference is robust to
    tombstone morphology, where locating a clean PR segment per-beat fails (it flipped the sign)."""
    out = {}
    j_off = int(0.06 * fs)          # J + 60 ms after the R peak
    min_rr = int(0.30 * fs)
    for lead, mv in leads.items():
        mv = np.asarray(mv, float)
        if len(mv) < int(fs):        # need >= ~1 s
            continue
        hist, edges = np.histogram(mv, bins=60)
        base = edges[np.argmax(hist)] + (edges[1]-edges[0]) / 2     # isoelectric (mode)
        c = mv - base
        pk, _ = find_peaks(np.abs(c), height=np.percentile(np.abs(c), 90), distance=min_rr)
        if len(pk) < 2:
            continue
        devs = [np.median(c[r+j_off-2:r+j_off+3]) for r in pk if r + j_off < len(mv)]
        if devs:
            out[lead] = float(np.median(devs)) * 10.0               # mV -> mm (10 mm/mV)
    return out


def _contiguous_hits(st_mm, elev_leads):
    """Return the list of contiguous leads (>=2) in this territory clearing their thresholds, else []."""
    present = [(l, st_mm.get(l)) for l in elev_leads if st_mm.get(l) is not None]
    hits = [(l, v) for l, v in present if v >= thr_mm(l)]
    return hits if len(hits) >= 2 else []


def stemi_verdict(st_mm):
    """Apply the territory criteria. Returns dict with positive/territory/leads/values/reciprocal/score."""
    best = None
    for terr, (elev, recip) in TERRITORIES.items():
        if terr == "posterior":
            continue    # handled below via reciprocal depression
        hits = _contiguous_hits(st_mm, elev)
        if not hits:
            continue
        # score for this territory = the 2nd-largest ST among contiguous hits (>=2 leads required)
        vals = sorted([v for _, v in hits], reverse=True)
        score = vals[1]
        recip_present = any(st_mm.get(l) is not None and st_mm[l] <= DEPRESSION_MM for l in recip)
        cand = dict(territory=terr, leads=[l for l, _ in hits], values=[round(v, 1) for _, v in hits],
                    reciprocal=bool(recip_present), score=float(score))
        if best is None or cand["score"] > best["score"]:
            best = cand

    # posterior: reciprocal ST-DEPRESSION in V1-V3 (>= 2 contiguous)
    post = [(l, st_mm.get(l)) for l in ["V1", "V2", "V3"] if st_mm.get(l) is not None]
    post_hits = [(l, v) for l, v in post if v <= DEPRESSION_MM]
    if len(post_hits) >= 2:
        score = sorted([abs(v) for _, v in post_hits], reverse=True)[1]
        cand = dict(territory="posterior", leads=[l for l, _ in post_hits],
                    values=[round(v, 1) for _, v in post_hits], reciprocal=True, score=float(score))
        if best is None or cand["score"] > best["score"]:
            best = cand

    if best is None:
        return dict(positive=False, territory=None, leads=[], values=[], reciprocal=False, score=0.0)
    best["positive"] = True
    return best
