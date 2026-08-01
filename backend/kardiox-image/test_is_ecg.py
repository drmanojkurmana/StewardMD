#!/usr/bin/env python3
"""Guard for the is-ECG gate (layout_crop.is_ecg) that stops a NON-ECG photo being 'diagnosed'.

Root cause it defends: the image classifier is a plain per-class sigmoid with no out-of-distribution
notion, so before the gate a face photo was forced into a class and returned "Atrial fibrillation".

Signal: an ECG photo is bright, LOW-saturation paper; a face/scene/object photo is COLOURFUL (high
saturation). Validated on REAL photos during development:
    real Philips 12-lead ECG  -> meanSat ~23  -> PASS
    real face collage         -> meanSat ~138 -> REJECT   (6x margin; threshold 85)
These synthetic cases lock in that behaviour deterministically (no real images committed).

Run:  python test_is_ecg.py     (needs opencv-python-headless, numpy, pillow — in requirements.txt)
"""
import numpy as np
from PIL import Image
from layout_crop import is_ecg

def paper_with_grid(w=900, h=650):
    """Bright white 'paper' + a thin pink/red ruled grid + a dark trace = an ECG-like low-sat image."""
    img = np.full((h, w, 3), 255, np.uint8)
    for x in range(0, w, 8):  img[:, x] = (255, 190, 200)
    for y in range(0, h, 8):  img[y, :] = (255, 190, 200)
    yc = h // 2
    for x in range(w):
        yv = int(yc + 30 * np.sin(x / 9.0)); img[max(0, yv - 1):yv + 2, x] = (20, 20, 20)
    return Image.fromarray(img)

def colourful(w=800, h=800):
    """A saturated colour photo stand-in (skin/scene) — high mean saturation."""
    return Image.fromarray(np.full((h, w, 3), (232, 90, 60), np.uint8))

def colour_noise(w=800, h=800):
    return Image.fromarray(np.random.default_rng(7).integers(0, 255, (h, w, 3), np.uint8))

def tiny(): return Image.fromarray(np.full((20, 20, 3), (200, 40, 40), np.uint8))

def main():
    cases = [
        ("ECG-like low-sat paper -> PASS", paper_with_grid(), True),
        ("saturated colour fill -> REJECT", colourful(), False),
        ("colour noise -> REJECT", colour_noise(), False),
        ("tiny image -> PASS (fail-open)", tiny(), True),
    ]
    ok_all = True
    for name, im, want in cases:
        got, detail = is_ecg(im)
        flag = "ok" if got == want else "FAIL"
        if got != want:
            ok_all = False
        print(f"[{flag}] {name:38} is_ecg={got!s:5} {detail}")
    # fail-open contract: any exception path must return True (never block a real read)
    assert is_ecg(None)[0] is True, "is_ecg(None) must fail-open to True"
    print("[ok] is_ecg(None) fails open -> True")
    assert ok_all, "one or more is_ecg cases did not match the expected verdict"
    print("\nALL is_ecg TESTS PASSED")

if __name__ == "__main__":
    main()
