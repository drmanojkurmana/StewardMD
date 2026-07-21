"""Robustness stress test: take the SAME rendered 12x1 ECG images, apply realistic capture
degradations (JPEG compression q=55 + Gaussian sensor noise), then re-run the PROJECT digitiser and
recompute fidelity. Honestly bounds the classical digitiser's envelope. (Rotation/perspective are the
learned nnU-Net digitiser's job and are OOM-blocked in an 8 GiB sandbox — documented separately.)
Writes e2e_input_degraded.json for the same Node inference stage. No mock data.

Run (after render_and_digitize.py):  D=/path/to/workspace python degrade_and_digitize.py
"""
import os, json, time
import numpy as np, cv2
from render_and_digitize import digitize_and_reconstruct, corr, NS   # reuses the REAL digitiser path

D = os.environ["D"]

def degrade(png_path):
    img = cv2.imread(png_path, cv2.IMREAD_GRAYSCALE)
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 55])   # lossy compression
    img = cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
    rng = np.random.default_rng(0)
    noise = rng.normal(0, 6.0, img.shape)                                  # sensor noise (sigma=6/255)
    img = np.clip(img.astype("float64") + noise, 0, 255).astype("uint8")
    ok, enc = cv2.imencode(".png", img)
    return enc.tobytes()

def main():
    base = json.load(open(os.path.join(D, "cpsc_engine_signals.json")))
    truth = {r["record"]: r for r in base}
    prev = json.load(open(os.path.join(D, "e2e_input.json")))["records"]
    out = []
    for rec in prev:
        sig = np.array(truth[rec["record"]]["signal"], dtype="float64")
        if sig.shape[1] < NS: sig = np.pad(sig, ((0, 0), (0, NS - sig.shape[1])))
        sig = sig[:, :NS]
        png = degrade(rec["imagePath"])
        t = time.time(); recovered, calib = digitize_and_reconstruct(png); dms = (time.time() - t) * 1000
        fids = [c for c in (corr(recovered[i], sig[i]) for i in range(12)) if c is not None]
        mean_fid = round(float(np.mean(fids)), 4) if fids else None
        print(f"{rec['record']} [{','.join(rec['labels'])}] DEGRADED fidelity={mean_fid} digitize={dms:.0f}ms")
        out.append({**rec, "digitized": recovered.tolist(), "fidelityPerLead": [round(c, 4) for c in fids],
                    "fidelityMean": mean_fid, "calibration": calib, "digitizeMs": round(dms, 1)})
    json.dump({"records": out}, open(os.path.join(D, "e2e_input_degraded.json"), "w"))
    print(f"\nwrote e2e_input_degraded.json ({len(out)} records)")

if __name__ == "__main__":
    main()
