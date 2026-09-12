# Isolates the supplied logo files from their backdrops (no redrawing: pixels are kept, only the
# backdrop is made transparent and edge pixels un-blended). Run from this directory.
from PIL import Image
import numpy as np
def knockout(src, out, bg, lo, hi, crop=None, pad=6):
    im = Image.open(src).convert('RGB')
    if crop: im = im.crop(crop)
    a = np.array(im).astype(float); L = a.mean(axis=2)
    alpha = np.clip((hi - L) / (hi - lo), 0, 1)
    rgb = np.where(alpha[..., None] > 0, (a - (1 - alpha[..., None]) * bg) / np.maximum(alpha[..., None], 1e-6), a)
    o = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')
    b = o.getbbox(); o = o.crop((max(0, b[0] - pad), max(0, b[1] - pad), min(o.width, b[2] + pad), min(o.height, b[3] + pad)))
    o.save(out)
knockout('src/wardsynq.jpg', 'img/wardsynq.png', bg=242, lo=70, hi=228, crop=(120, 220, 1300, 540))  # crop excludes the sparkle watermark
knockout('src/stewardmd.png', 'img/stewardmd.png', bg=250, lo=140, hi=245)                          # baked-in checkerboard
m = Image.open('../../../maik-wordmark-color.png').convert('RGBA'); m = m.crop(m.getbbox()); m.save('img/maik.png')
cols = (np.array(m)[..., 3] > 20).sum(axis=0); gaps = [x for x in range(500, 760) if cols[x] == 0]
inf = m.crop((0, 0, gaps[0] + (gaps[-1] - gaps[0]) // 2, m.height)); inf.crop(inf.getbbox()).save('img/infinity.png')
Image.open('src/qr.png').convert('RGBA').save('img/qr.png')
