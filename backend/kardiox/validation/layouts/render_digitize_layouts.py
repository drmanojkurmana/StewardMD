"""Goal 2 — multi-layout support. Render REAL ECG signals as standard hospital PRINT layouts
(3x4 + rhythm strip, 6x2, 12x1), then run a LAYOUT-AWARE digitiser that AUTO-DETECTS the layout from the
image (ink row/column structure), digitises each lead cell (reusing the project column-scan primitives),
and emits the reconstruction-layer format {leads:{name:{mv,fs}}, rhythmLead, layoutHint, calibration}.

Fixed 10 mm/mV gain + real mm grid so the digitiser recovers CALIBRATED mV (needed by the STEMI rule).
Writes layouts_input.json for the Node inference stage. No mock data.
"""
import os, sys, json, time, types, importlib.util
import numpy as np, cv2
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

D = os.environ["D"]; SMBK = os.environ.get("KARDIOX_BACKEND", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FS, NS = 500, 5000
STD12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
MM_PER_S, MM_PER_MV, PX_PER_MM = 25.0, 10.0, 6.0    # fixed calibration for the render

# 3x4 + rhythm layout (standard): row-major lead grid; each cell = a 2.5s time window.
GRID_3x4 = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]]
GRID_6x2 = [["I", "V1"], ["II", "V2"], ["III", "V3"], ["aVR", "V4"], ["aVL", "V5"], ["aVF", "V6"]]  # display grid
# reconstruction column (time window) per lead:
COL_3x4 = {"I": 0, "II": 0, "III": 0, "aVR": 1, "aVL": 1, "aVF": 1, "V1": 2, "V2": 2, "V3": 2, "V4": 3, "V5": 3, "V6": 3}
COL_6x2 = {"I": 0, "II": 0, "III": 0, "aVR": 0, "aVL": 0, "aVF": 0, "V1": 1, "V2": 1, "V3": 1, "V4": 1, "V5": 1, "V6": 1}

# ---- load the REAL project digitiser primitives (light stubs for the FastAPI infra) ----
def _stubs():
    err = types.ModuleType("app.core.errors")
    class KardioXError(Exception):
        def __init__(self, m="", stage=None, **k): super().__init__(m); self.stage = stage
    err.KardioXError = KardioXError
    for nm in ["BadImage", "LayoutUndetected", "UpstreamUnavailable", "StageNotImplemented"]: setattr(err, nm, type(nm, (KardioXError,), {}))
    from abc import ABC
    base = types.ModuleType("app.services.base")
    class Provider(ABC):
        def _ni(self, *a, **k): raise err.StageNotImplemented()
    base.Provider = Provider
    for nm in ["PreprocessingProvider", "DigitizationProvider", "QualityProvider"]: setattr(base, nm, type(nm, (Provider,), {}))
    for p in ["app", "app.core", "app.services"]: sys.modules.setdefault(p, types.ModuleType(p))
    sys.modules["app.core.errors"] = err; sys.modules["app.services.base"] = base
def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SMBK, rel)); mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod; spec.loader.exec_module(mod); return mod
_stubs(); PRE = _load("app.services.preprocessing", "app/services/preprocessing.py"); DIG = _load("app.services.digitization", "app/services/digitization.py")

# ---- RENDER (fixed 10mm/mV, mm grid, black trace) ----
def _grid(ax, secs, mv_span):
    for gx in np.arange(0, secs + 1e-6, 0.04): ax.axvline(gx, color=(0.98, 0.88, 0.88), lw=0.3, zorder=0)   # 1mm
    for gx in np.arange(0, secs + 1e-6, 0.2): ax.axvline(gx, color=(0.95, 0.7, 0.7), lw=0.6, zorder=0)      # 5mm
    for gy in np.arange(-mv_span, mv_span + 1e-6, 0.1): ax.axhline(gy, color=(0.98, 0.88, 0.88), lw=0.3, zorder=0)
    for gy in np.arange(-mv_span, mv_span + 1e-6, 0.5): ax.axhline(gy, color=(0.95, 0.7, 0.7), lw=0.6, zorder=0)

def render(sig12, layout, path):
    """sig12 (12,NS) mV. Renders the given print layout to a fixed-gain image (pixels only)."""
    mv_span = 1.5
    if layout == "12x1":
        rows, secs = 12, 10.0
        fig, axes = plt.subplots(12, 1, figsize=(20, 24), dpi=100); fig.subplots_adjust(0, 0, 1, 1, 0, 0)
        for i, ax in enumerate(axes):
            t = np.linspace(0, 10, NS); _grid(ax, 10, mv_span)
            ax.plot(t, np.clip(sig12[i], -mv_span, mv_span), "k", lw=1.0, zorder=3)
            ax.set_xlim(0, 10); ax.set_ylim(-mv_span, mv_span); ax.axis("off")
    elif layout in ("3x4", "6x2"):
        grid = GRID_3x4 if layout == "3x4" else GRID_6x2
        col_win = COL_3x4 if layout == "3x4" else COL_6x2
        cell_s = 2.5 if layout == "3x4" else 5.0
        nrows, ncols = len(grid), len(grid[0])
        extra = 1 if layout == "3x4" else 0                              # 3x4 has a rhythm strip row
        fig, axes = plt.subplots(nrows + extra, ncols, figsize=(20, 26), dpi=100); fig.subplots_adjust(0, 0, 1, 1, 0, 0)
        axg = np.atleast_2d(axes)
        for r in range(nrows):
            for c in range(ncols):
                ax = axg[r][c]; lead = grid[r][c]; col = col_win[lead]
                seg = sig12[STD12.index(lead)][int(col * cell_s * FS):int((col + 1) * cell_s * FS)]
                t = np.linspace(0, cell_s, len(seg)); _grid(ax, cell_s, mv_span)
                ax.plot(t, np.clip(seg, -mv_span, mv_span), "k", lw=1.0, zorder=3)
                ax.set_xlim(0, cell_s); ax.set_ylim(-mv_span, mv_span); ax.axis("off")
        if extra:                                                        # rhythm strip = lead II full 10s, spanning all cols
            gs = axg[nrows][0].get_gridspec()
            for c in range(ncols): axg[nrows][c].remove()
            axr = fig.add_subplot(gs[nrows, :]); t = np.linspace(0, 10, NS); _grid(axr, 10, mv_span)
            axr.plot(t, np.clip(sig12[1], -mv_span, mv_span), "k", lw=1.0, zorder=3)
            axr.set_xlim(0, 10); axr.set_ylim(-mv_span, mv_span); axr.axis("off")
    fig.savefig(path, dpi=100); plt.close(fig)
    with open(path, "rb") as f: return f.read()

# ---- AUTO LAYOUT DETECTION from the image (ink row/column structure) ----
def detect_layout(png):
    gray = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    H, W = gray.shape; ink = gray < 128
    rowink = ink.mean(axis=1)                                            # ink per row
    thr = max(rowink.mean() * 0.5, 0.002)
    bands, inb, s = [], False, 0                                         # contiguous ink bands (rows of traces)
    for y in range(H):
        if rowink[y] > thr and not inb: inb, s = True, y
        elif rowink[y] <= thr and inb: inb = False; (bands.append((s, y)) if (y - s) > H * 0.02 else None)
    if inb: bands.append((s, H))
    nb = len(bands)
    # a wide bottom band spanning most of the width with continuous ink => rhythm strip
    has_strip = False
    if bands:
        s, e = bands[-1]; colcov = (ink[s:e].mean(axis=0) > 0.01).mean(); has_strip = colcov > 0.85 and nb in (4, 7, 13)
    has_strip = bool(has_strip)
    trace_rows = int(nb - (1 if has_strip else 0))
    if trace_rows >= 10: layout = "12x1"
    elif trace_rows == 6: layout = "6x2"
    elif trace_rows == 3: layout = "3x4"
    else: layout = "12x1" if trace_rows > 6 else ("6x2" if trace_rows >= 5 else "3x4")
    return {"layout": layout, "nbands": int(nb), "hasRhythmStrip": has_strip, "traceRows": trace_rows}

# ---- DIGITISE each lead cell (project column-scan primitive) -> reconstruction format ----
def digitize(png, layout, has_strip):
    gray = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    H, W = gray.shape; ink = gray < 128
    grid = GRID_3x4 if layout == "3x4" else (GRID_6x2 if layout == "6x2" else [[l] for l in STD12])
    nrows, ncols = len(grid), len(grid[0]); cell_s = {"3x4": 2.5, "6x2": 5.0, "12x1": 10.0}[layout]
    band_h = int(H * (0.78 if (layout == "3x4" and has_strip) else 1.0)) // nrows
    cell_w = W // ncols
    leads = {}
    for r in range(nrows):
        for c in range(ncols):
            lead = grid[r][c]; y, x = r * band_h, c * cell_w
            trace = DIG._extract_trace(ink[y:y + band_h, x:x + cell_w], np)     # REAL primitive
            if trace is None: continue
            baseline = float(np.median(trace)); mv = (baseline - trace) / (PX_PER_MM * MM_PER_MV)
            n = int(round(cell_s * FS)); xs = np.linspace(0, len(mv) - 1, n)
            leads[lead] = {"mv": np.round(np.interp(xs, np.arange(len(mv)), mv), 4).tolist(), "fs": FS}
    rhythm = None
    if has_strip and layout == "3x4":
        y = int(H * 0.78); trace = DIG._extract_trace(ink[y:H, 0:W], np)
        if trace is not None:
            baseline = float(np.median(trace)); mv = (baseline - trace) / (PX_PER_MM * MM_PER_MV)
            xs = np.linspace(0, len(mv) - 1, NS); leads["II"] = {"mv": np.round(np.interp(xs, np.arange(len(mv)), mv), 4).tolist(), "fs": FS}; rhythm = "II"
    return {"leads": leads, "rhythmLead": rhythm, "layoutHint": layout,
            "calibration": {"mmPerS": MM_PER_S, "mmPerMv": MM_PER_MV, "pxPerMm": PX_PER_MM, "method": "grid"}, "method": "classical"}

def main():
    recs = json.load(open(os.path.join(D, "cpsc_engine_signals.json")))
    imgdir = os.path.join(D, "layout_images"); os.makedirs(imgdir, exist_ok=True)
    out = []
    for rec in recs:
        sig = np.array(rec["signal"], float)
        if sig.shape[1] < NS: sig = np.pad(sig, ((0, 0), (0, NS - sig.shape[1])))
        sig = sig[:, :NS]
        for layout in ["12x1", "3x4", "6x2"]:
            p = os.path.join(imgdir, f"{rec['record']}_{layout}.png")
            t0 = time.time(); png = render(sig, layout, p); rms = (time.time() - t0) * 1000
            det = DIG.detect_print_layout(png)                        # PRODUCT function
            t1 = time.time(); digi = DIG.digitize_auto(png); dms = (time.time() - t1) * 1000   # PRODUCT function (auto-detects)
            out.append({"record": rec["record"], "labels": rec["labels"], "trueLayout": layout,
                        "detected": {"layout": det["layout"], "traceRows": det["rows"], "hasRhythmStrip": det["hasRhythmStrip"]},
                        "digitized": digi, "true": sig.tolist(),
                        "renderMs": round(rms, 1), "digitizeMs": round(dms, 1)})
            print(f"{rec['record']} render={layout:4s} -> detected={det['layout']:4s} "
                  f"(rows={det['rows']} strip={det['hasRhythmStrip']}) leads={len(digi['leads'])} "
                  f"{'OK' if det['layout']==layout else 'MISDETECT'} r={rms:.0f} d={dms:.0f}ms")
    json.dump({"records": out}, open(os.path.join(D, "layouts_input.json"), "w"))
    ok = sum(1 for o in out if o["detected"]["layout"] == o["trueLayout"])
    print(f"\nlayout auto-detection: {ok}/{len(out)} correct")
    print("wrote layouts_input.json")

if __name__ == "__main__":
    main()
