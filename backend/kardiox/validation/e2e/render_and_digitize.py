"""Stages 1-3 of the KardioX end-to-end pipeline, on REAL ECG signals (no mock data).

  (1) real ECG -> render a genuine 12x1 full-disclosure ECG IMAGE (pixels only; matplotlib)
  (2) run the PROJECT digitiser (this backend's app/services/digitization.py primitives:
      detect_lead_regions + _extract_trace + estimate_px_per_mm) on the image bytes -> pixel centre-lines
  (3) pixels -> waveform signal (baseline = per-lead median isoelectric; resample band-width -> 5000
      samples = 10 s @ 500 Hz), and measure digitiser FIDELITY = Pearson corr(recovered, true) per lead.

The digitiser sees ONLY the rendered pixels. We keep BOTH the true signal (model-quality upper bound)
and the digitised signal (full image->signal) so e2e_diagnose.cjs can separate digitiser error from model
error. 12x1 full-disclosure is the layout the reconstruction validation proved gives EcgLib a valid
10 s x 12 input (a 3x4 print gives only 2.5 s/lead + one 10 s rhythm lead).

Environment:
  D          workspace dir holding cpsc_engine_signals.json (real 12-lead signals + labels) — required.
             Outputs (e2e_input.json, e2e_images/) are written here too.
  KARDIOX_BACKEND  path to this backend (default: derived from this file's location).

Run:  D=/path/to/workspace python render_and_digitize.py
"""
import os, sys, json, time, types, importlib.util
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

D = os.environ["D"]
SMBK = os.environ.get("KARDIOX_BACKEND",
                      os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
LEAD_ORDER = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
FS, NS = 500, 5000            # 10 s @ 500 Hz — EcgLib's native input length
MM_PER_S, MM_PER_MV = 25.0, 10.0

# ---- load the REAL project digitiser functions with light stubs for the FastAPI-bound infra modules ----
def _install_stubs():
    err = types.ModuleType("app.core.errors")
    class KardioXError(Exception):
        def __init__(self, msg="", stage=None, **k):
            super().__init__(msg); self.stage = stage
    err.KardioXError = KardioXError
    for nm in ["BadImage", "LayoutUndetected", "UpstreamUnavailable", "StageNotImplemented"]:
        setattr(err, nm, type(nm, (KardioXError,), {}))
    from abc import ABC
    base = types.ModuleType("app.services.base")
    class Provider(ABC):
        def _ni(self, *a, **k): raise err.StageNotImplemented("not implemented")
    base.Provider = Provider
    for nm in ["PreprocessingProvider", "DigitizationProvider", "QualityProvider"]:
        setattr(base, nm, type(nm, (Provider,), {}))
    for pkg in ["app", "app.core", "app.services"]:
        sys.modules.setdefault(pkg, types.ModuleType(pkg))
    sys.modules["app.core.errors"] = err
    sys.modules["app.services.base"] = base

def _load(name, relpath):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SMBK, relpath))
    mod = importlib.util.module_from_spec(spec); sys.modules[name] = mod
    spec.loader.exec_module(mod); return mod

_install_stubs()
PRE = _load("app.services.preprocessing", "app/services/preprocessing.py")
DIG = _load("app.services.digitization", "app/services/digitization.py")
print("loaded REAL project digitiser:", DIG.__file__)

# ---- (1) render a real 12x1 full-disclosure ECG image (pixels only) ----
def render_image(sig12, path):
    """sig12: (12, NS) real mV. One lead per row, full 10 s, faint pink grid + black trace."""
    n = sig12.shape[1]
    t = np.linspace(0, n / FS, n)
    fig, axes = plt.subplots(12, 1, figsize=(18, 24), dpi=100)
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0, hspace=0, wspace=0)
    for i, ax in enumerate(axes):
        y = sig12[i]
        lo, hi = float(np.min(y)), float(np.max(y))
        pad = max((hi - lo) * 0.12, 0.05)
        ax.set_facecolor("white")
        for gx in np.arange(0, t[-1] + 1e-6, 0.2):   # minor grid (light pink -> grayscale > 128)
            ax.axvline(gx, color=(0.98, 0.86, 0.86), lw=0.5, zorder=0)
        for gx in np.arange(0, t[-1] + 1e-6, 1.0):   # major grid
            ax.axvline(gx, color=(0.96, 0.72, 0.72), lw=0.8, zorder=0)
        ax.plot(t, y, color="black", lw=1.0, zorder=3)
        ax.set_xlim(0, t[-1]); ax.set_ylim(lo - pad, hi + pad); ax.axis("off")
    fig.savefig(path, dpi=100)
    plt.close(fig)
    with open(path, "rb") as f:
        return f.read()

# ---- (2)+(3) digitise the image with the PROJECT primitives, then pixels -> signal ----
def digitize_and_reconstruct(png_bytes):
    """Real detect_lead_regions (driven for a 12x1 layout) + _extract_trace + estimate_px_per_mm.
    Returns (sig12_recovered (12,NS) in units proportional to mV, calib dict)."""
    regions = PRE.detect_lead_regions(png_bytes, rows=12, cols=1, rhythm_strip=False)   # REAL function
    buf = np.frombuffer(png_bytes, dtype=np.uint8)
    import cv2
    gray = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    ink = gray < 128
    px_per_mm = DIG.estimate_px_per_mm(gray, np)     # REAL grid-FFT calibration (may be None -> geometry)
    out = np.zeros((12, NS), dtype="float64")
    band_w = None
    for i, reg in enumerate(regions[:12]):
        y, x, h, w = reg["y"], reg["x"], reg["h"], reg["w"]
        band_w = w
        trace = DIG._extract_trace(ink[y:y + h, x:x + w], np)   # REAL per-column ink centre-line
        if trace is None:
            out[i] = 0.0; continue
        baseline = float(np.median(trace))              # isoelectric estimate (robust)
        mv_like = (baseline - trace)                    # image y grows downward -> invert
        xs = np.linspace(0, len(mv_like) - 1, NS)       # band columns (== 10 s) -> 500 Hz
        out[i] = np.interp(xs, np.arange(len(mv_like)), mv_like)
    if not px_per_mm:
        px_per_mm = band_w / (10.0 * MM_PER_S) if band_w else None    # geometry: 10 s strip
        calib_method = "geometry"
    else:
        calib_method = "grid"
    if px_per_mm:
        out = out / (px_per_mm * MM_PER_MV)             # -> mV (downstream z-norms, so scale is cosmetic)
    return out, {"pxPerMm": round(float(px_per_mm), 3) if px_per_mm else None, "method": calib_method}

def corr(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    n = min(len(a), len(b)); a, b = a[:n], b[:n]
    if a.std() < 1e-9 or b.std() < 1e-9: return None
    return float(np.clip(np.corrcoef(a, b)[0, 1], -1, 1))

def main():
    records = json.load(open(os.path.join(D, "cpsc_engine_signals.json")))
    imgdir = os.path.join(D, "e2e_images"); os.makedirs(imgdir, exist_ok=True)
    out_records = []
    for rec in records:
        sig = np.array(rec["signal"], dtype="float64")        # (12, N) REAL signal
        if sig.shape[1] < NS:
            sig = np.pad(sig, ((0, 0), (0, NS - sig.shape[1])))
        sig = sig[:, :NS]
        img_path = os.path.join(imgdir, f"{rec['record']}.png")
        t0 = time.time(); png = render_image(sig, img_path); render_ms = (time.time() - t0) * 1000
        t1 = time.time()
        recovered, calib = digitize_and_reconstruct(png); digitize_ms = (time.time() - t1) * 1000
        fids = [c for c in (corr(recovered[i], sig[i]) for i in range(12)) if c is not None]
        mean_fid = round(float(np.mean(fids)), 4) if fids else None
        print(f"{rec['record']} [{','.join(rec['labels'])}] img={os.path.getsize(img_path)//1024}KB "
              f"calib={calib['method']}({calib['pxPerMm']}) fidelity(mean|corr|)={mean_fid} "
              f"render={render_ms:.0f}ms digitize={digitize_ms:.0f}ms")
        out_records.append({
            "record": rec["record"], "labels": rec["labels"], "fs": FS,
            "true": sig.tolist(), "digitized": recovered.tolist(),
            "fidelityPerLead": [round(c, 4) for c in fids], "fidelityMean": mean_fid,
            "calibration": calib, "imagePath": img_path,
            "imageBytes": int(os.path.getsize(img_path)),
            "renderMs": round(render_ms, 1), "digitizeMs": round(digitize_ms, 1),
        })
    json.dump({"records": out_records}, open(os.path.join(D, "e2e_input.json"), "w"))
    print(f"\nwrote e2e_input.json ({len(out_records)} records)")

if __name__ == "__main__":
    main()
