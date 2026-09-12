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
# Dark-ground variants for the back face: alpha (shape) unchanged, fill colour only.
w = np.array(Image.open('img/wardsynq.png').convert('RGBA')); w[..., :3] = 255; Image.fromarray(w, 'RGBA').save('img/wardsynq-white.png')
s = np.array(Image.open('img/stewardmd.png').convert('RGBA')).astype(int)
green = (s[..., 1] - s[..., 0] > 25) & (s[..., 3] > 0)
mint = green & (np.arange(s.shape[1])[None, :] > s.shape[1] * 0.3)   # the "MD" letters, not the mark
o = s.copy(); o[..., :3] = 255; o[mint, 0], o[mint, 1], o[mint, 2] = 95, 211, 179
Image.fromarray(o.astype(np.uint8), 'RGBA').save('img/stewardmd-dark.png')
# QR with a small centre infinity on a white tile; modules outside the tile untouched. Decodes at 150 dpi.
from PIL import ImageDraw
q = Image.open('img/qr.png').convert('RGBA'); W = q.width; inf = Image.open('img/infinity.png').convert('RGBA')
tile = int(W * 0.19); iw = int(W * 0.14); inf2 = inf.resize((iw, int(inf.height * iw / inf.width)), Image.LANCZOS)
c = q.copy(); x0 = (W - tile) // 2
ImageDraw.Draw(c).rounded_rectangle((x0, x0, x0 + tile, x0 + tile), radius=tile // 6, fill=(255, 255, 255, 255))
c.paste(inf2, ((W - inf2.width) // 2, (W - inf2.height) // 2), inf2); c.save('img/qr-icon.png')
