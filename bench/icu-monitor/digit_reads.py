"""Digit reader over benchmark OCR boxes (Mac, Core ML, one small process).
  python digit_reads.py <DigitReader.mlpackage> <boxes.json from run.mjs --dump-digit-boxes> <out reads.json> [scripts dir]
Crops each box from the ORIGINAL image padded 10% of its height, preprocesses exactly as training (common.py),
runs Core ML, greedy-CTC decodes. Output {img: [{x,y,w,h,text,conf}]} for run.mjs --digits."""
import json, sys, os
import numpy as np
from PIL import Image

model_path, boxes_path, out_path = sys.argv[1:4]
sys.path.insert(0, sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(model_path), "scripts"))
from common import preprocess, decode  # noqa: E402
import coremltools as ct  # noqa: E402

m = ct.models.MLModel(model_path, compute_units=ct.ComputeUnit.CPU_AND_NE)
boxes = json.load(open(boxes_path))
out, n = {}, 0
for img, bs in boxes.items():
    if not bs or not os.path.exists(img):
        continue
    im = Image.open(img).convert("RGB")
    W, H = im.size
    arr = np.asarray(im)
    reads = []
    for b in bs:
        pad = 0.10 * b["h"] * H
        x0, y0 = int(max(0, b["x"] * W - pad)), int(max(0, b["y"] * H - pad))
        x1, y1 = int(min(W, (b["x"] + b["w"]) * W + pad)), int(min(H, (b["y"] + b["h"]) * H + pad))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        x = preprocess(arr[y0:y1, x0:x1])[None, None].astype(np.float32)
        logits = list(m.predict({"image": x}).values())[0][0]
        text, conf, _ = decode(np.asarray(logits, np.float32))
        reads.append(dict(b, text=text, conf=conf)); n += 1
    out[img] = reads
    del im, arr
json.dump(out, open(out_path, "w"))
print("reads", n, "images", len(out))
