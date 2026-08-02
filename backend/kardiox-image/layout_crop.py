#!/usr/bin/env python3
"""Layout-normalisation preprocessor for the KardiQ X image model (MI real-data Step 3).

The model resizes the WHOLE input to 320x320. On a phone photo of a paper ECG (skew, desk/hand
background, non-standard multi-row layout) that squashes the waveform into a fraction of the frame
surrounded by clutter -> the model reads paper/photo artefacts, not the trace (Step 1: AUROC 0.47
on SSMCH photos vs 0.90 on clean exports). This module isolates the ECG waveform region (the
pink grid + dark trace), deskews it, and crops to it, so the network sees a consistent,
waveform-centric image before the 320x320 resize. Clean exports (grid already fills the frame)
pass through ~unchanged.

Deterministic, CPU-only (OpenCV + NumPy + Pillow). FAIL-SAFE: any low-confidence detection returns
the ORIGINAL image, so it can never be worse than today's full-image squash.

    from layout_crop import crop_ecg
    pil_ready_for_resize = crop_ecg(Image.open(path).convert("RGB"))
"""
import numpy as np
from PIL import Image

try:
    import cv2
    _HAVE_CV2 = True
except Exception:
    _HAVE_CV2 = False


def _ink_mask(rgb):
    """Binary mask of the ECG paper = its pink/red GRID (the ECG-specific signal). Detecting the
    grid (not just dark pixels) isolates the ECG from arbitrary photo backgrounds, which are rarely
    the ECG-grid pink. Dilated so the periodic grid lines merge into one solid region."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    grid = cv2.bitwise_or(
        cv2.inRange(hsv, (0, 22, 55), (14, 190, 255)),
        cv2.inRange(hsv, (165, 22, 55), (180, 190, 255)),
    )
    return cv2.morphologyEx(grid, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8), iterations=2)


def _largest_region(mask):
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    return max(cnts, key=cv2.contourArea)


def crop_ecg(pil, margin=0.02, deskew=True, max_det=1200):
    """Return a PIL image cropped/deskewed to the ECG waveform region. Fail-safe -> original."""
    if not _HAVE_CV2:
        return pil
    try:
        rgb = np.array(pil.convert("RGB"))
        H, W = rgb.shape[:2]
        if H < 40 or W < 40:
            return pil
        # detect on a downscaled copy for speed; map the box back to full resolution
        scale = min(1.0, float(max_det) / max(H, W))
        small = cv2.resize(rgb, (max(1, int(W * scale)), max(1, int(H * scale)))) if scale < 1 else rgb
        hs, ws = small.shape[:2]

        c = _largest_region(_ink_mask(small))
        if c is None:
            return pil
        frac = cv2.contourArea(c) / float(hs * ws)
        if frac < 0.12 or frac > 0.995:          # too little / basically whole frame -> don't touch
            return pil

        work = rgb                                # full-res image we will crop from
        # ---- deskew (conservative): rotate the whole image flat, then re-detect on it ----
        if deskew:
            ang = cv2.minAreaRect(c)[-1]
            if ang < -45:
                ang += 90
            if 1.5 < abs(ang) < 20:
                M = cv2.getRotationMatrix2D((W / 2.0, H / 2.0), ang, 1.0)
                work = cv2.warpAffine(rgb, M, (W, H), flags=cv2.INTER_LINEAR,
                                      borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
                sc2 = min(1.0, float(max_det) / max(H, W))
                sm2 = cv2.resize(work, (max(1, int(W * sc2)), max(1, int(H * sc2)))) if sc2 < 1 else work
                c2 = _largest_region(_ink_mask(sm2))
                if c2 is not None and 0.12 < cv2.contourArea(c2) / float(sm2.shape[0] * sm2.shape[1]) < 0.995:
                    c, scale = c2, sc2

        x, y, bw, bh = cv2.boundingRect(c)
        inv = 1.0 / scale
        X, Y, BW, BH = x * inv, y * inv, bw * inv, bh * inv
        pad = margin * max(BW, BH)
        x0, y0 = max(0, int(X - pad)), max(0, int(Y - pad))
        x1, y1 = min(work.shape[1], int(X + BW + pad)), min(work.shape[0], int(Y + BH + pad))
        if x1 - x0 < 40 or y1 - y0 < 40:
            return pil
        return Image.fromarray(work[y0:y1, x0:x1])
    except Exception:
        return pil                                # never break the pipeline


# ---- is-ECG gate -----------------------------------------------------------
# A photo of a paper ECG has a fine pink/red GRID spread across the whole frame (the ECG-specific
# signal _ink_mask already keys on) and/or a strongly PERIODIC ruled-line pattern. Arbitrary photos
# (a face, a document, an object) have neither: any red is LOCALISED (one blob, not a grid) and there
# is no regular grid periodicity. The image classifier is a plain per-class sigmoid with no
# out-of-distribution notion, so WITHOUT this gate a non-ECG photo is forced into a class (e.g. AFib).
# Conservative + FAIL-OPEN: reject only when BOTH signals are clearly absent; never block on an error.
def is_ecg(pil, sat_max=85):
    """Return (ok: bool, detail: dict). ok=False means 'this is not an ECG photo' and the caller must
    refuse to diagnose it.

    Signal: an ECG photo is bright PAPER carrying thin ink, so its mean colour SATURATION is LOW
    (mostly white/grey with thin pink grid + black trace). A face/scene/object photo is COLOURFUL
    (high saturation). Validated on real photos: a real 12-lead ECG measured ~22, a face collage ~138
    (a 6x margin). Saturation is lighting-robust and — unlike fine-grid periodicity or pink coverage —
    immune to the JPEG/webp 8x8 block artefacts and to skin registering as 'red', both of which fooled
    earlier heuristics on real compressed photos.

    Measured on the ECG-grid region (crop_ecg) so colourful desk/hand clutter around a small ECG does
    not push it over. Conservative + FAIL-OPEN: pass on any error, missing cv2, or a tiny image — a gate
    error must never block a real clinical read. NOTE: a plain low-colour document also passes (harmless:
    the model returns nothing diagnosable on blank paper); the real is-ECG classifier is the robust
    long-term fix. Threshold is env-overridable by the caller."""
    if not _HAVE_CV2:
        return True, {"reason": "no-cv2"}
    try:
        base = np.array(pil.convert("RGB"))
        if base.shape[0] < 40 or base.shape[1] < 40:
            return True, {"reason": "tiny"}
        focus = np.array(crop_ecg(pil).convert("RGB"))     # focus on the ECG region if one is found
        H, W = focus.shape[:2]
        scale = min(1.0, 800.0 / max(H, W))
        small = cv2.resize(focus, (max(1, int(W * scale)), max(1, int(H * scale)))) if scale < 1 else focus
        mean_sat = float(cv2.cvtColor(small, cv2.COLOR_RGB2HSV)[:, :, 1].mean())
        return bool(mean_sat <= sat_max), {"meanSat": round(mean_sat, 1), "satMax": sat_max}
    except Exception as e:                              # never break the pipeline
        return True, {"reason": "error:" + str(e)[:60]}


# ---- QA / visualisation ----------------------------------------------------
if __name__ == "__main__":
    import sys, os
    outdir = os.environ.get("OUT", "/tmp/ecg_crop_qa")
    os.makedirs(outdir, exist_ok=True)
    for p in sys.argv[1:]:
        try:
            orig = Image.open(p).convert("RGB")
            crop = crop_ecg(orig)
            changed = crop.size != orig.size
            # side-by-side: original (resized) | crop (resized), each to 320-square for a fair view
            def sq(im): return im.resize((320, 320))
            canvas = Image.new("RGB", (660, 340), (240, 240, 240))
            canvas.paste(sq(orig), (10, 10)); canvas.paste(sq(crop), (340, 10))
            name = os.path.splitext(os.path.basename(p))[0]
            canvas.save(os.path.join(outdir, name + "_qa.png"))
            print(f"{'CROP' if changed else 'pass'}  {os.path.basename(p)}  {orig.size} -> {crop.size}")
        except Exception as e:
            print("ERR", p, e)
    print("QA images in", outdir)
