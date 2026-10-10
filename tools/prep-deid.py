#!/usr/bin/env python3
"""PrepNucleus de-identification of real clinical images (owner rule 2026-10-10: no real scan may keep a name, ID,
date, hospital, scanner brand, viewer overlay, publisher credit, figure/panel label or right/left marker; only the
clean image). Dev-only. Private images and every output stay outside git, in a work dir (default ~/prep-data/rad/deid).

Stages (each reads and writes files in the work dir; reruns skip finished images):
  ocr      Apple Vision text boxes (fast level, 2x, plus 3x corner crops) + tesseract psm 11 -> ocr.jsonl
  detect   Gemini vision pass, strict JSON schema: kind, real, panels, elements [{text, category, box_2d, on_anatomy}]
           -> detect.jsonl (Vertex, cheapest model; --dry prints the estimate and makes no call)
  plan     merge OCR + Gemini, apply the removal policy, choose crop or inpaint per element -> plan.json
  clean    apply plan.json to orig/ -> clean/<file>.png (lossless) and clean.json (geometry per file)
  verify   OCR the cleaned files again + Gemini compare (original vs cleaned: residual text? clinical content changed?)
           -> verify.jsonl
  sheet    before/after contact sheets at 2x (sheets/*.jpg) for the human check
  selftest synthetic image with a fake name, date and R marker: plan + clean must remove all three; schema checks.

  python3 tools/prep-deid.py <stage> [--dir DIR] [--model gemini-3.1-flash-lite] [--only f1,f2]

Inputs in the work dir: orig/<flat name> (bank path with "/" -> "__"), inventory.json (refs per bank path: lesson,
bank, overlay, pyq; written by the enumerator), optional classes.json { file: "scan"|"drawing"|... } from another pass.
Needs Pillow, numpy and OpenCV (pip: opencv-python-headless); ocrmac for the ocr stage (macOS only).
"""
import json, os, re, sys, math, subprocess, tempfile

# ---------------------------------------------------------------- policy (pure, tested by selftest)
KINDS = ["xray", "ct", "mri", "ultrasound", "nuclear", "angiography", "fluoroscopy", "mammography", "clinical_photo",
         "endoscopy", "histology", "specimen", "fundus", "ecg", "drawing", "chart", "mixed", "other"]
CATS = ["patient_identifier", "date_time", "institution", "device_brand", "viewer_overlay", "publisher_credit",
        "figure_label", "laterality", "orientation", "scale_bar", "teaching_arrow", "teaching_label", "diagnosis_text",
        "other_text"]
# Always removed (identifiers, brands, overlays, credits, book labels, side and orientation letters).
REMOVE = {"patient_identifier", "date_time", "institution", "device_brand", "viewer_overlay", "publisher_credit",
          "figure_label", "laterality", "orientation", "other_text_rm", "fragment"}
# Removed only where the image is a question (bank, overlay, PYQ): text naming the answer, stray text.
REMOVE_QUIZ = {"diagnosis_text", "other_text"}
# markers whose pixels are hard to separate (lead letters on bone, logos): paint the whole box (boxes are size-capped)
RAD_KINDS = {"xray", "ct", "mri", "ultrasound", "nuclear", "angiography", "fluoroscopy", "mammography", "mixed"}
WHOLE_CATS = {"laterality", "figure_label", "orientation", "publisher_credit", "device_brand", "patient_identifier", "date_time", "institution"}
KEEP = {"scale_bar", "teaching_arrow", "teaching_label"}
BRANDS = r"\b(ge|g\.e\.|siemens|philips|canon|toshiba|fuji(film)?|carestream|hologic|agfa|kodak|konica|hitachi|samsung|" \
         r"esaote|mindray|medison|aloka|shimadzu|gehc|healthineers|voluson|logiq|somatom|aquilion|ingenuity|brilliance|" \
         r"signa|magnetom|achieva|ingenia|discovery|optima|revolution|vitrea|osirix|horos|radiant|centricity|synapse|" \
         r"carestream|infinitt|sectra|merge|ecg|lunit|qure)\b"
OVERLAY = r"\b(kv|kvp|mas|ma|w[:/]?\s*\d|l[:/]?\s*\d|wl|ww|c\s*\d+|se[:#]?\s*\d|im[:#]?\s*\d|ser|img|slice|thk|sl|fov|" \
          r"zoom|acq|ex[:#]|tr|te|ti|nex|mm|cm/s|hz|db|gain|frq|mhz|dr|map|pwr|fps|dfov|tilt|kernel|recon|series|image)\b"
CREDIT = r"(©|\(c\)|copyright|courtesy|www\.|http|\.com|\.org|radiopaedia|elsevier|springer|wiley|thieme|lippincott|" \
         r"wolters|mcgraw|saunders|mosby|jaypee|crack\s*the\s*core|prometheus|lionhart|marrow|prepladder|dams|" \
         r"bhatia|cerebellum|aiims|pgi|jipmer|all rights)"
DATE = r"(\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b|\b\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}\b|\b\d{1,2}:\d{2}(:\d{2})?\b|" \
       r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{2,4}\b)"


def check_detection(j):
    """Schema check of one Gemini detection. Returns a list of problems (empty = valid)."""
    bad = []
    if not isinstance(j, dict): return ["not an object"]
    if j.get("kind") not in KINDS: bad.append("kind")
    if not isinstance(j.get("real"), bool): bad.append("real")
    els = j.get("elements")
    if not isinstance(els, list): return bad + ["elements"]
    for i, e in enumerate(els):
        if not isinstance(e, dict): bad.append(f"el{i}"); continue
        if e.get("category") not in CATS: bad.append(f"el{i}.category")
        b = e.get("box_2d")
        if not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)
                and 0 <= b[0] < b[2] <= 1000 and 0 <= b[1] < b[3] <= 1000):
            bad.append(f"el{i}.box_2d")
        if not isinstance(e.get("on_anatomy"), bool): bad.append(f"el{i}.on_anatomy")
    return bad


def box_of(e):
    """Gemini box_2d [ymin, xmin, ymax, xmax] 0..1000 -> [x0, y0, x1, y1] 0..1."""
    y0, x0, y1, x1 = e["box_2d"]
    return [x0 / 1000, y0 / 1000, x1 / 1000, y1 / 1000]


def inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def area(a): return max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])


def union(a, b): return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def ocr_category(t, box):
    """Category for OCR text that no Gemini element covers, or None (left for review)."""
    s = t.strip(); low = s.lower()
    near = min(box[0], box[1], 1 - box[2], 1 - box[3]) < 0.14
    if re.search(DATE, low): return "date_time"
    if re.search(CREDIT, low): return "publisher_credit"
    if re.search(BRANDS, low) and len(s) > 1: return "device_brand"
    if re.fullmatch(r"(r|l|rt|lt|right|left|rght|lft)\.?", low): return "laterality" if near else None
    edge = min(box[0], box[1], 1 - box[2], 1 - box[3]) < 0.05
    if edge and re.fullmatch(r"[apsihf]", low): return "orientation"
    if re.search(OVERLAY, low) and re.search(r"\d", low): return "viewer_overlay"
    if re.fullmatch(r"[a-z]{0,3}\d{5,}", low): return "patient_identifier"
    if re.fullmatch(r"\d{1,3}\s*(y|yr|yrs|years?)\s*/?\s*[mf]?|[mf]\s*/?\s*\d{1,3}\s*y?", low): return "patient_identifier"
    return None


def plan_image(det, ocr, ctx, w, h):
    """Decide what to remove. det: Gemini detection (or None), ocr: list of {t, c, box, eng}, ctx: "quiz" or "lesson".
    Returns {"remove": [{cat, text, box, src, on_anatomy}], "keep": [...], "review": [...]}."""
    remove, keep, review = [], [], []
    els = []
    for e in (det or {}).get("elements", []):
        if check_detection({"kind": "other", "real": True, "elements": [e]}): continue
        els.append({"cat": e["category"], "text": e.get("text", ""), "box": box_of(e), "src": "gemini", "on_anatomy": e["on_anatomy"]})
    words = [x for x in ocr if (x["eng"] == "vision" and x["c"] >= 0.5) or (x["eng"] == "tess" and x["c"] >= 0.6)]
    used = set()
    for el in els:  # snap Gemini boxes to the OCR words they cover (Gemini boxes are loose)
        for i, wd in enumerate(words):
            if area(wd["box"]) > 0 and inter(wd["box"], el["box"]) >= 0.4 * area(wd["box"]):
                used.add(i)
                # Vision word boxes are tight; a box much larger than the element is a merged line, not this element
                if el["cat"] not in KEEP and wd["eng"] == "vision" and area(wd["box"]) <= 3 * max(area(el["box"]), 1e-6):
                    el["box"] = union(el["box"], wd["box"])
    for i, wd in enumerate(words):
        if i in used: continue
        # a word already overlapping an element (e.g. text inside a kept label) is that element's
        if any(inter(wd["box"], el["box"]) > 0.2 * area(wd["box"]) for el in els): continue
        cat = ocr_category(wd["t"], wd["box"])
        el = {"cat": cat or "ocr_unmatched", "text": wd["t"], "box": wd["box"], "src": "ocr:" + wd["eng"], "on_anatomy": None}
        if cat: els.append(el)
        else: review.append(el)
    def oversize(el):
        a = area(el["box"])
        if a > 0.03 or (el["box"][2] - el["box"][0] > 0.16 and el["box"][3] - el["box"][1] > 0.16): return True
        if el["cat"] == "orientation" and (el["on_anatomy"] or a > 0.004): return True  # real ones sit small, at an edge
        if el["on_anatomy"] and a > 0.01: return True  # over the body only small marks are text; a big box is a misread
        if len((el["text"] or "").strip()) <= 2 and a > 0.012: return True  # one letter in a big box is a bad box
        return False
    big = [el for el in els if el["cat"] not in KEEP and oversize(el)]
    for el in big:  # a text or marker box this large is a bad box, never something to paint over: a human looks
        els.remove(el); review.append(dict(el, cat="oversize:" + el["cat"]))
    for el in els:
        el["cat"] = refine(el["cat"], el["text"], ctx)
    # single-letter structure labels (R = radius, L = lunate next to U, C, H...): a lone R or L over the anatomy, away
    # from the edges, in a figure that labels other structures with single letters, is a label, not a side marker
    letters = [el for el in els if el["cat"] in ("teaching_label", "teaching_arrow") and re.fullmatch(r"[A-Za-z]{1,2}", (el["text"] or "").strip())]
    for el in els:
        b = el["box"]; cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if (el["cat"] == "laterality" and re.fullmatch(r"[RLrl]", (el["text"] or "").strip()) and el["on_anatomy"]
                and min(cx, cy, 1 - cx, 1 - cy) > 0.12 and letters):
            el["cat"] = "teaching_label"
    # short marks deep inside the picture, over the body, are more often anatomy the model misread (a ring, a vessel)
    # than a marker: a human looks at them instead of the cleaner painting over them
    for el in list(els):
        b = el["box"]; cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2; t = (el["text"] or "").strip()
        if (el["cat"] in REMOVE and (el["cat"] != "figure_label" or (det or {}).get("panels", 1) <= 1)
                and (el["on_anatomy"] or (el["cat"] in ("orientation", "laterality") and (det or {}).get("panels", 1) <= 1)) and min(cx, cy, 1 - cx, 1 - cy) > 0.15 and len(t) <= 2
                and el["src"] == "gemini"):
            els.remove(el); review.append(dict(el, cat="inner:" + el["cat"]))
        (remove if el["cat"] in REMOVE or (ctx == "quiz" and el["cat"] in REMOVE_QUIZ) else keep).append(el)
    return {"remove": remove, "keep": keep, "review": review}


# side markers: the abbreviations anywhere in a label ("RT CCA", "Lt kidney", "R"), or a label that is only the side word.
# Anatomical names that contain the word ("Left Hepatic Artery") are structure labels, not side markers.
SIDE = re.compile(r"((^|[^a-z])(rt|lt|r|l|rght|lft)([^a-z]|$)|^\W*(right|left)(\s+side)?\W*$)", re.I)


SEQ = re.compile(r"\s*((t1|t2|pd)(\s*[+-]?\s*(c|gd|fs|w|weighted|flair|post|pre|contrast)?)*|flair|dwi|adc|swi|gre|stir|"
                 r"mra|mrv|cta|ctv|ct|mri|us|usg|pet|pet[- /]?ct|spect|nect|cect|ap|pa|lateral|lat|axial|coronal|sagittal|oblique|"
                 r"(arterial|venous|portal|delayed|early|late)( phase)?|bone window|lung window|soft tissue)\s*[+]?\s*", re.I)


def refine(cat, text, ctx):
    """Category after the house rules: side words in any label are laterality; other text goes from question images,
    and from lesson figures only when it reads as an identifier (date, brand, overlay, credit, ID)."""
    t = (text or "").strip()
    if cat == "viewer_overlay" and (not re.search(r"[A-Za-z0-9]", t) or
                                    (re.search(r"caliper|cursor|crosshair|cross|line|marker", t, re.I) and not re.search(r"\d", t))):
        return "teaching_arrow"  # calipers, cursors and reference lines carry no identifier; on anatomy they stay
    if cat == "laterality" and len(t) > 2 and not SIDE.search(t):
        return "teaching_label"  # "Left Hepatic Artery": a structure name the model called a side marker
    if cat in ("teaching_label", "diagnosis_text", "other_text", "figure_label", "scale_bar") and SIDE.search(t):
        return "laterality"
    if ctx != "quiz" and cat in ("viewer_overlay", "other_text", "orientation") and SEQ.fullmatch(t):
        return "teaching_label"  # a sequence or view name on a lesson figure is teaching, not an identifier
    if cat == "other_text":
        # keep figure words (ECG lead names, device readings, view names) unless they read as an identifier; text that
        # names the answer is diagnosis_text (removed from question images)
        return ocr_category(t, [0.5, 0.5, 0.5, 0.5]) or "other_text"
    return cat


def pad_box(b, w, h, k=0.25, minpx=3):
    px = max(minpx / w, (b[2] - b[0]) * k, 2.5 / w); py = max(minpx / h, (b[3] - b[1]) * k, 2.5 / h)
    return [max(0.0, b[0] - px), max(0.0, b[1] - py), min(1.0, b[2] + px), min(1.0, b[3] + py)]


def crop_sides(box, lim=0.22):
    """Edge bands a crop could drop to remove this box: [(side, cut fraction)]."""
    out = []
    if box[3] <= lim: out.append(("top", box[3]))
    if box[1] >= 1 - lim: out.append(("bottom", 1 - box[1]))
    if box[2] <= lim: out.append(("left", box[2]))
    if box[0] >= 1 - lim: out.append(("right", 1 - box[0]))
    return sorted(out, key=lambda s: s[1])


# ---------------------------------------------------------------- pixels
def _np():
    import numpy as np, cv2
    return np, cv2


def band_rect(side, cut):
    return {"top": [0, 0, 1, cut], "bottom": [0, 1 - cut, 1, 1], "left": [0, 0, cut, 1], "right": [1 - cut, 0, 1, 1]}[side]


def content_frac(arr, rect, holes):
    """Share of pixels in rect (minus holes) that differ from the band's median by > 28 levels: 0 = empty background."""
    np, _ = _np()
    H, W = arr.shape[:2]
    x0, y0, x1, y1 = int(rect[0] * W), int(rect[1] * H), int(math.ceil(rect[2] * W)), int(math.ceil(rect[3] * H))
    g = arr[y0:y1, x0:x1].astype(np.int16)
    if g.size == 0: return 0.0
    gray = g.mean(axis=2) if g.ndim == 3 else g
    m = np.ones(gray.shape, bool)
    for hb in holes:
        hx0, hy0 = max(0, int(hb[0] * W) - x0), max(0, int(hb[1] * H) - y0)
        hx1, hy1 = min(x1 - x0, int(math.ceil(hb[2] * W)) - x0), min(y1 - y0, int(math.ceil(hb[3] * H)) - y0)
        if hx1 > hx0 and hy1 > hy0: m[hy0:hy1, hx0:hx1] = False
    v = gray[m]
    if v.size < 20: return 0.0
    med = np.median(v)
    return float((np.abs(v - med) > 28).mean())


def decide(arr, plan):
    """Crop or inpaint per removed element. Returns {"crop": [x0,y0,x1,y1], "inpaint": [boxes], "why": [...]}."""
    H, W = arr.shape[:2]
    rem = [dict(e, pbox=pad_box(e["box"], W, H)) for e in plan["remove"]]
    keepb = [k["box"] for k in plan["keep"]]
    crop = [0.0, 0.0, 1.0, 1.0]; ip = []; why = []
    holes = [e["pbox"] for e in rem]
    for e in rem:
        done = False
        for side, cut in crop_sides(e["pbox"]):
            cut = min(1.0, cut + 2 / (H if side in ("top", "bottom") else W))
            nc = list(crop)
            if side == "top": nc[1] = max(nc[1], cut)
            if side == "bottom": nc[3] = min(nc[3], 1 - cut)
            if side == "left": nc[0] = max(nc[0], cut)
            if side == "right": nc[2] = min(nc[2], 1 - cut)
            if nc[2] - nc[0] < 0.78 or nc[3] - nc[1] < 0.78: continue
            band = band_rect(side, cut)
            if any(inter(k, band) > 0 for k in keepb): continue
            cf = content_frac(arr, band, holes)
            if cf <= 0.03:
                crop = nc; done = True; why.append(f"crop {side} {cut:.3f} for {e['cat']} ({cf:.3f})"); break
        if not done: ip.append(e)
    # anything the final crop does not fully drop is inpainted
    final_ip = [e for e in rem if not (e["pbox"][2] <= crop[0] or e["pbox"][0] >= crop[2] or e["pbox"][3] <= crop[1] or e["pbox"][1] >= crop[3])]
    return {"crop": crop, "inpaint": final_ip, "why": why}


def stroke_mask(arr, tight, padded, keep=(), whole=False):
    """Pixels of the element itself, found as connected components that are ENCLOSED by the padded box (a glyph, a
    marker or a label plate sits inside its box; anatomy runs out of it) and touch the tight box. Candidates come from
    a top-hat and a black-hat (thin bright / dark strokes on any background), an Otsu split of the box (plates, big
    letters), and coloured pixels on a grey image. An edge of the box on the image border does not count as touching.
    Returns ((X0, Y0, X1, Y1), mask uint8, found)."""
    np, cv2 = _np()
    H, W = arr.shape[:2]
    X0, Y0, X1, Y1 = int(padded[0] * W), int(padded[1] * H), int(math.ceil(padded[2] * W)), int(math.ceil(padded[3] * H))
    x0, y0, x1, y1 = int(tight[0] * W), int(tight[1] * H), int(math.ceil(tight[2] * W)), int(math.ceil(tight[3] * H))
    x0, y0, x1, y1 = max(x0, X0), max(y0, Y0), min(x1, X1), min(y1, Y1)
    reg = arr[Y0:Y1, X0:X1]
    if reg.size == 0: return (X0, Y0, X1, Y1), np.zeros((max(0, Y1 - Y0), max(0, X1 - X0)), np.uint8), False
    lum = cv2.cvtColor(reg, cv2.COLOR_RGB2GRAY)
    h, w = lum.shape
    k = int(max(5, min(31, 0.6 * max(4, min(y1 - y0, x1 - x0)) + 3))) | 1
    ker = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    top = cv2.morphologyEx(lum, cv2.MORPH_TOPHAT, ker); blk = cv2.morphologyEx(lum, cv2.MORPH_BLACKHAT, ker)
    _, ot = cv2.threshold(lum, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    rr = reg.astype(np.int16); chroma = rr.max(axis=2) - rr.min(axis=2)
    sm = arr[::4, ::4].astype(np.int16)
    gray_img = float((sm.max(axis=2) - sm.min(axis=2)).mean()) < 10
    cands = [top > 35, blk > 35, ot > 0, ot == 0]
    if gray_img: cands.append(chroma > 35)
    # the padded box's sides that lie on the image border do not count as "touching" (text at an image edge)
    open_l, open_t, open_r, open_b = X0 <= 0, Y0 <= 0, X1 >= W, Y1 >= H
    tb = (max(0, x0 - X0 - 1), max(0, y0 - Y0 - 1), min(w, x1 - X0 + 1), min(h, y1 - Y0 + 1))
    mask = np.zeros((h, w), np.uint8)
    for c in cands:
        n, lab, st, _ = cv2.connectedComponentsWithStats(c.astype(np.uint8), 8)
        for i in range(1, n):
            cx, cy, cw, ch, ca = st[i]
            if ca < 3 or ca > 0.55 * h * w: continue
            if (cx == 0 and not open_l) or (cy == 0 and not open_t) or (cx + cw >= w and not open_r) or (cy + ch >= h and not open_b):
                continue
            if cx + cw <= tb[0] or cx >= tb[2] or cy + ch <= tb[1] or cy >= tb[3]: continue
            mask[lab == i] = 255
    for kb in keep:  # never take a kept arrow or label that shares the box
        kx0, ky0 = max(0, int(kb[0] * W) - X0), max(0, int(kb[1] * H) - Y0)
        kx1, ky1 = min(w, int(math.ceil(kb[2] * W)) - X0), min(h, int(math.ceil(kb[3] * H)) - Y0)
        if kx1 > kx0 and ky1 > ky0 and not (kb[0] <= tight[0] and kb[1] <= tight[1] and kb[2] >= tight[2] and kb[3] >= tight[3]):
            mask[ky0:ky1, kx0:kx1] = 0
    found = bool(mask.any())
    # a label plate (solid disc or box behind the glyph) goes with it: most of the box's other pixels share one value
    # that differs from the surroundings
    inner = np.zeros((h, w), bool); inner[tb[1]:tb[3], tb[0]:tb[2]] = True
    rest = lum[inner & (mask == 0)].astype(np.int16)
    ring = lum[~inner].astype(np.int16)
    if found and rest.size > 30 and ring.size > 30:
        hist = np.bincount((rest // 8).clip(0, 31), minlength=32); mode = int(hist.argmax()) * 8 + 4
        share = float((np.abs(rest - mode) <= 20).mean())
        if share >= 0.6 and abs(mode - float(np.median(ring))) > 25:
            mask[inner & (np.abs(lum.astype(np.int16) - mode) <= 24)] = 255
    if whole:  # a label off the anatomy (corner letter, marker, overlay text): its whole box, plate and all, with a margin
        gx, gy = max(2, int(0.15 * (tb[2] - tb[0]))), max(2, int(0.15 * (tb[3] - tb[1])))
        mask[max(0, tb[1] - gy):min(h, tb[3] + gy), max(0, tb[0] - gx):min(w, tb[2] + gx)] = 255
    if not found:  # accurate box, ink not separable (touches a gutter or anatomy): the whole tight box
        mask[tb[1]:tb[3], tb[0]:tb[2]] = 255
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
    return (X0, Y0, X1, Y1), mask, found


def grow_plate(out, mm, win, box):
    """A text box drawn on a solid label plate (white box with "T2", black square with "A"): when the pixels right
    around the mask share one flat colour, flood that colour outwards; if the flood stays enclosed (a plate, at most
    6x the text box) the plate joins the mask. Returns the mask, or ((x0, y0, x1, y1), mask) for a wider window."""
    np, cv2 = _np()
    H, W = out.shape[:2]
    bw, bh = (box[2] - box[0]) * W, (box[3] - box[1]) * H
    ex0, ey0 = max(0, int(box[0] * W - 1.2 * bw - 8)), max(0, int(box[1] * H - 1.2 * bh - 8))
    ex1, ey1 = min(W, int(box[2] * W + 1.2 * bw + 8)), min(H, int(box[3] * H + 1.2 * bh + 8))
    lum = cv2.cvtColor(out[ey0:ey1, ex0:ex1], cv2.COLOR_RGB2GRAY).astype(np.int16)
    big = np.zeros(lum.shape, np.uint8)
    ax0, ay0, ax1, ay1 = win
    ox0, oy0 = max(ax0, ex0), max(ay0, ey0); ox1, oy1 = min(ax1, ex1), min(ay1, ey1)
    big[oy0 - ey0:oy1 - ey0, ox0 - ex0:ox1 - ex0] = mm[oy0 - ay0:oy1 - ay0, ox0 - ax0:ox1 - ax0]
    ring = (cv2.dilate(big, np.ones((5, 5), np.uint8)) > 0) & (big == 0)
    rv = lum[ring]
    if rv.size < 20: return mm
    col = float(np.median(rv))
    if float(np.median(np.abs(rv - col))) > 6: return mm
    same = (np.abs(lum - col) <= 14).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(same, 4)
    hit = np.unique(lab[ring & (same > 0)]); hit = hit[hit > 0]
    add = np.zeros(lum.shape, bool)
    h, w = lum.shape
    for i in hit:
        x, y, cw, ch, ca = st[i]
        touches = (x == 0 and ex0 > 0) or (y == 0 and ey0 > 0) or (x + cw >= w and ex1 < W) or (y + ch >= h and ey1 < H)
        if touches or ca > 6 * max(1.0, bw * bh): continue
        add |= lab == i
    if not add.any(): return mm
    full = ((big > 0) | add).astype(np.uint8) * 255
    full = cv2.dilate(full, np.ones((3, 3), np.uint8), iterations=1)
    nx0, ny0 = min(ax0, ex0), min(ay0, ey0); nx1, ny1 = max(ax1, ex1), max(ay1, ey1)
    nm = np.zeros((ny1 - ny0, nx1 - nx0), np.uint8)
    nm[ay0 - ny0:ay1 - ny0, ax0 - nx0:ax1 - nx0] = mm
    nm[ey0 - ny0:ey1 - ny0, ex0 - nx0:ex1 - nx0] |= full
    if (nx0, ny0, nx1, ny1) == tuple(win): return nm
    return ((nx0, ny0, nx1, ny1), nm)


def apply(arr, d):
    """Inpaint every element's own pixels (OpenCV Telea from the surrounding image), then crop. Elements whose ink could
    not be separated get their whole tight box inpainted and are listed in d["unresolved"] for the human check."""
    np, cv2 = _np()
    out = arr.copy(); H, W = arr.shape[:2]; d["unresolved"] = []
    for e in d["inpaint"]:
        (X0, Y0, X1, Y1), m, found = stroke_mask(out, e["box"], e["pbox"], d.get("keep", ()), whole=e.get("whole") or (e.get("on_anatomy") is False and area(e["box"]) < 0.004)
                                                 or e["cat"] in WHOLE_CATS)
        if not found: d["unresolved"].append(e)
        pad = 16
        ax0, ay0, ax1, ay1 = max(0, X0 - pad), max(0, Y0 - pad), min(W, X1 + pad), min(H, Y1 + pad)
        big = out[ay0:ay1, ax0:ax1].copy(); mm = np.zeros(big.shape[:2], np.uint8)
        mm[Y0 - ay0:Y1 - ay0, X0 - ax0:X1 - ax0] = m
        mm = grow_plate(out, mm, (ax0, ay0, ax1, ay1), e["box"])
        if isinstance(mm, tuple):  # the plate reached past the window: redo the window around it
            (ax0, ay0, ax1, ay1), mm = mm
            big = out[ay0:ay1, ax0:ax1].copy()
        ringm = cv2.dilate(mm, np.ones((9, 9), np.uint8)) > 0
        ringm &= mm == 0
        rv = big[ringm].astype(np.float32)
        if rv.shape[0] > 30:
            med = np.median(rv, axis=0); mad = float(np.median(np.abs(rv - med)))
        else:
            mad = 99
        if mad <= 8 and not e.get("telea"):  # flat surround (black corner, white page): its own colour with its own grain
            noise = np.random.default_rng(0).normal(0, max(0.5, 1.4826 * mad), big.shape[:2])[..., None]
            fill = np.clip(med + noise, 0, 255).astype(np.uint8)
            big[mm > 0] = fill[mm > 0]
            out[ay0:ay1, ax0:ax1] = big
        else:
            out[ay0:ay1, ax0:ax1] = cv2.inpaint(big, mm, 5, cv2.INPAINT_TELEA)
    c = d["crop"]
    x0, y0, x1, y1 = int(round(c[0] * W)), int(round(c[1] * H)), int(round(c[2] * W)), int(round(c[3] * H))
    return out[y0:y1, x0:x1]


def load(path):
    np, _ = _np()
    from PIL import Image
    return np.array(Image.open(path).convert("RGB"))


def save_webp(arr, path, q=90):
    """Re-encode with no metadata (Pillow writes no EXIF/XMP/ICC unless given)."""
    from PIL import Image
    Image.fromarray(arr).save(path, "WEBP", quality=q, method=6)


def webp_chunks(path):
    b = open(path, "rb").read(); i = 12; out = []
    while i + 8 <= len(b):
        t = b[i:i + 4].decode("latin1"); n = int.from_bytes(b[i + 4:i + 8], "little"); out.append(t); i += 8 + n + (n & 1)
    return out


# ---------------------------------------------------------------- OCR
def ocr_image(path):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    words = []
    try:
        from ocrmac import ocrmac
        def vision(img, scale, ox=0, oy=0, fw=1, fh=1):
            big = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
            r = []
            for t, c, (x, y, w, h) in ocrmac.OCR(big, recognition_level="fast", language_preference=["en-US"]).recognize():
                y1 = 1 - y; y0 = y1 - h
                r.append({"t": t, "c": round(c, 2), "box": [ox + x * fw, oy + y0 * fh, ox + (x + w) * fw, oy + y1 * fh], "eng": "vision"})
            return r
        words += vision(im, 2 if max(im.size) < 1600 else 1)
        cw, ch = int(im.width * 0.34), int(im.height * 0.34)
        for ox, oy in [(0, 0), (im.width - cw, 0), (0, im.height - ch), (im.width - cw, im.height - ch)]:
            words += vision(im.crop((ox, oy, ox + cw, oy + ch)), 3, ox / im.width, oy / im.height, cw / im.width, ch / im.height)
    except ImportError:
        pass
    big = im.convert("L").resize((im.width * 2, im.height * 2), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "x.png"); big.save(p)
        txt = subprocess.run(["tesseract", p, "stdout", "--psm", "11", "tsv"], capture_output=True, text=True).stdout
    W, H = big.size
    for line in txt.splitlines()[1:]:
        c = line.split("\t")
        if len(c) < 12 or not c[11].strip() or not any(ch.isalnum() for ch in c[11]): continue
        if float(c[10]) < 60: continue
        x, y, w, h = map(int, c[6:10])
        words.append({"t": c[11], "c": round(float(c[10]) / 100, 2), "box": [x / W, y / H, (x + w) / W, (y + h) / H], "eng": "tess"})
    return {"w": im.width, "h": im.height, "words": words}


# ---------------------------------------------------------------- Gemini (Vertex)
PROJECT = os.environ.get("PREP_VERTEX_PROJECT", "project-6074a703-e86c-40a5-848")
PRICE = {"gemini-2.5-flash-lite": (0.10e-6, 0.40e-6), "gemini-3.1-flash-lite": (0.25e-6, 1.50e-6)}
SCHEMA = {"type": "OBJECT", "properties": {
    "kind": {"type": "STRING", "enum": KINDS}, "real": {"type": "BOOLEAN"}, "panels": {"type": "INTEGER"},
    "elements": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "text": {"type": "STRING"}, "category": {"type": "STRING", "enum": CATS},
        "box_2d": {"type": "ARRAY", "items": {"type": "INTEGER"}}, "on_anatomy": {"type": "BOOLEAN"}},
        "required": ["text", "category", "box_2d", "on_anatomy"]}}},
    "required": ["kind", "real", "panels", "elements"]}
DETECT_PROMPT = """You audit a medical teaching image before publication. Return JSON only.
kind: the image type. real: true if it is a real acquired image (X-ray, CT, MRI, ultrasound, nuclear, angiogram, fluoroscopy, mammogram, clinical photograph, endoscopy, histology/micrograph, gross specimen, fundus photo, ECG trace); false for drawings, diagrams, illustrations, charts, tables. "mixed" = real image panels plus drawn panels. panels: number of separate image panels.
elements: list EVERY piece of text, letter, number, logo, watermark, symbol marker and drawn annotation visible anywhere on the image, especially small text in corners and along the edges (DICOM/viewer overlays), with box_2d = [ymin, xmin, ymax, xmax] on a 0-1000 scale, tight around that element. One element per separate text block or marker. Categories:
- patient_identifier: names, initials, patient/accession/MRN/ID numbers, age or sex text (e.g. "45 Y M")
- date_time: dates, times
- institution: hospital, department, clinic, city names
- device_brand: scanner/vendor/model/software names or logos (GE, Siemens, Philips, Canon, Toshiba, Fujifilm, Carestream, Hologic...)
- viewer_overlay: acquisition or viewer text (kVp, mAs, mA, WL/WW, W/L, slice/series/image numbers, thickness, FOV, zoom, TR/TE, "Im", "Se", "Acq", ruler readouts, crosshair lines, cursor marks)
- publisher_credit: copyright, "Courtesy of", URLs, journal/book/website names or logos, watermarks
- figure_label: figure numbers and panel letters (A, B, C, 1.2) that label a panel as a whole
- laterality: R, L, RT, LT, Right, Left markers (lead markers or text), including mirrored or boxed letters
- orientation: single orientation letters A, P, S, I, H, F at image edges, "SUP", "ANT", "AX", "COR", "SAG" labels
- scale_bar: a ruler or scale bar (put its text in text)
- teaching_arrow: arrows, arrowheads, asterisks, circles, outlines, numbered pointers, single-letter pointers drawn to point at a finding
- teaching_label: words naming an anatomical structure placed as a label
- diagnosis_text: words naming the disease, sign or finding (e.g. "Measles", "Target sign", "Acute SDH")
- other_text: any other text
on_anatomy: true if the element lies over the body/organ/tissue content rather than the empty background or border.
Do not skip anything small or faint. If there is no text or marker at all, return an empty elements list."""
VERIFY_SCHEMA = {"type": "OBJECT", "properties": {
    "residual": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "text": {"type": "STRING"}, "category": {"type": "STRING", "enum": CATS},
        "box_2d": {"type": "ARRAY", "items": {"type": "INTEGER"}}}, "required": ["text", "category", "box_2d"]}},
    "content_same": {"type": "BOOLEAN"}, "damage": {"type": "STRING"}},
    "required": ["residual", "content_same", "damage"]}
VERIFY_PROMPT = """Image 1 is an original medical teaching image; image 2 is the same image after identifiers were removed (it may be cropped at an edge).
residual: list every text, letter, number, logo, watermark or marker still visible in image 2 (same categories and box_2d [ymin,xmin,ymax,xmax] 0-1000 on image 2), including arrows and labels. Empty list if none.
content_same: true if the clinical content (anatomy, lesion, finding, every teaching arrow) is unchanged apart from the removed text/markers and a border crop; false if any part of the finding, anatomy or a teaching arrow was cut, smeared or altered.
damage: one short sentence on what changed in the clinical content, or "" if nothing."""


_tok = [None, 0]


def vertex(model, parts, gen, log=None):
    import urllib.request, base64, time
    if not _tok[0] or time.time() - _tok[1] > 1500:
        _tok[0] = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip(); _tok[1] = time.time()
    url = f"https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/global/publishers/google/models/{model}:generateContent"
    body = json.dumps({"contents": [{"role": "user", "parts": parts}], "generationConfig": gen}).encode()
    for a in range(8):
        try:
            req = urllib.request.Request(url, body, {"Authorization": "Bearer " + _tok[0], "x-goog-user-project": PROJECT, "Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=240)); break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and a < 7: time.sleep(10 * (a + 1)); continue
            raise
    u = r.get("usageMetadata", {}); pi, po = PRICE.get(model, (0, 0))
    cost = u.get("promptTokenCount", 0) * pi + (u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)) * po
    if log:
        with open(log, "a") as f: f.write(f"{time.strftime('%H:%M:%S')}\t{model}\t{u.get('promptTokenCount')}\t{u.get('candidatesTokenCount')}\t{cost:.6f}\n")
    txt = "".join(p.get("text", "") for c in r.get("candidates", [])[:1] for p in c.get("content", {}).get("parts", []) if not p.get("thought"))
    return txt, cost


def img_part(path):
    import base64, io
    from PIL import Image
    b = open(path, "rb").read()
    mt = "image/webp" if path.endswith(".webp") else "image/png"
    if path.endswith(".png"):  # send lossless intermediates as webp q95 to keep requests small
        bio = io.BytesIO(); Image.open(path).convert("RGB").save(bio, "WEBP", quality=95); b = bio.getvalue(); mt = "image/webp"
    return {"inlineData": {"mimeType": mt, "data": base64.b64encode(b).decode()}}


# ---------------------------------------------------------------- stages
def jl(path):
    return [json.loads(l) for l in open(path)] if os.path.exists(path) else []


def ctx_of(inv, f):
    refs = inv.get(f.replace("__", "/"), {}).get("refs", [])
    return "quiz" if any(r["kind"] in ("bank", "overlay", "pyq") for r in refs) else "lesson"


def stage_plan(W, only):
    inv = json.load(open(W + "/inventory.json"))["images"]
    det = {j["f"]: j for j in jl(W + "/detect.jsonl")}
    # a stronger model's boxes (detect-boxes.jsonl, e.g. gemini-3.5-flash on the images that need cleaning) win
    for j in jl(W + "/detect-boxes.jsonl"):
        if not check_detection(j): det[j["f"]] = j
    ocr = {j["f"]: j for j in jl(W + "/ocr.jsonl")}
    classes = json.load(open(W + "/classes.json")) if os.path.exists(W + "/classes.json") else {}
    manual = json.load(open(W + "/manual.json")) if os.path.exists(W + "/manual.json") else {}
    out = {}
    for f in sorted(os.listdir(W + "/orig")):
        if only and f not in only: continue
        cls = classes.get(f) or (det.get(f) or {}).get("kind")
        if cls in ("drawing", "chart") or f not in det: out[f] = {"skip": cls or "no-detection"}; continue
        o = ocr.get(f) or {"w": 1, "h": 1, "words": []}
        p = plan_image(det[f], o["words"], ctx_of(inv, f), o["w"], o["h"])
        mf = manual.get(f) or {}
        if mf.get("drop"):  # human: these detections are not identifiers (or not there)
            p["remove"] = [e for e in p["remove"] if e["text"] not in mf["drop"]]
        for t in mf.get("force", []):  # human: these kept or held detections ARE identifiers
            for lst in (p["keep"], p["review"]):
                for e in [e for e in lst if e["text"] == t or (t and e["text"].startswith(t))]:
                    lst.remove(e); p["remove"].append(dict(e, cat="manual:" + e["cat"].replace("oversize:", "")))
        for a in mf.get("add", []):  # human boxes [x0, y0, x1, y1] 0..1 for what the models boxed badly or missed
            p["remove"].append({"cat": a.get("cat", "manual"), "text": a.get("text", ""), "box": a["box"], "src": "manual",
                                "on_anatomy": a.get("on_anatomy", False), "whole": a.get("whole", False),
                                "telea": a.get("telea", False)})
        if mf.get("exclude"): p["exclude"] = mf["exclude"]
        p["kind"] = det[f].get("kind"); p["real"] = det[f].get("real"); p["ctx"] = ctx_of(inv, f)
        if p["kind"] not in RAD_KINDS:  # orientation letters exist only on radiology images; elsewhere they are misreads
            hold = [e for e in p["remove"] if e["cat"] == "orientation" and len((e["text"] or "").strip()) <= 3]
            p["remove"] = [e for e in p["remove"] if e not in hold]; p["review"] += [dict(e, cat="nonrad:" + e["cat"]) for e in hold]
        if p["kind"] == "ecg":  # lead names, calibration and speed marks are the ECG itself; only identifiers go
            hold = [e for e in p["remove"] if e["cat"] not in ("patient_identifier", "date_time", "institution", "device_brand", "publisher_credit")]
            p["remove"] = [e for e in p["remove"] if e not in hold]; p["keep"] += hold
        if p["remove"]:
            arr = load(W + "/orig/" + f)
            d = decide(arr, p); p["crop"] = d["crop"]; p["why"] = d["why"]
            ip = [e["pbox"] for e in d["inpaint"]]
            for e in p["remove"]:
                e["pbox"] = pad_box(e["box"], arr.shape[1], arr.shape[0]); e["act"] = "inpaint" if e["pbox"] in ip else "crop"
        out[f] = p
    json.dump(out, open(W + "/plan.json", "w"), indent=0)
    n = sum(1 for p in out.values() if p.get("remove"))
    print(json.dumps({"planned": len(out), "to_clean": n, "skipped": sum(1 for p in out.values() if "skip" in p)}))


def stage_clean(W, only):
    plan = json.load(open(W + "/plan.json"))
    os.makedirs(W + "/clean", exist_ok=True); geo = {}; unres = {}
    for f, p in plan.items():
        if only and f not in only: continue
        if not p.get("remove"): continue
        arr = load(W + "/orig/" + f)
        H, Wd = arr.shape[:2]
        d = {"crop": p["crop"], "inpaint": [e for e in p["remove"] if e.get("act") == "inpaint"], "keep": [k["box"] for k in p.get("keep", [])]}
        out = apply(arr, d)
        if d["unresolved"]: unres[f] = [e["cat"] + ":" + e["text"] for e in d["unresolved"]]
        from PIL import Image
        Image.fromarray(out).save(W + "/clean/" + f.rsplit(".", 1)[0] + ".png")
        geo[f] = {"w": Wd, "h": H, "crop": p["crop"], "nw": out.shape[1], "nh": out.shape[0]}
    old = json.load(open(W + "/clean.json")) if os.path.exists(W + "/clean.json") else {}
    old.update(geo); json.dump(old, open(W + "/clean.json", "w"), indent=0)
    json.dump(unres, open(W + "/unresolved.json", "w"), indent=0)
    print(json.dumps({"cleaned": len(geo), "unresolved": len(unres)}))


def gemini_json(model, parts, schema, log):
    gen = {"temperature": 0, "responseMimeType": "application/json", "responseSchema": schema, "maxOutputTokens": 12000}
    if "2.5" in model: gen["thinkingConfig"] = {"thinkingBudget": 0}
    txt, cost = vertex(model, parts, gen, log)
    t = txt.strip()
    if t.startswith("```"): t = t.split("\n", 1)[1].rsplit("```", 1)[0]
    try: return json.loads(t), cost
    except Exception: return {"error": txt[:300]}, cost


def pool_map(fn, xs, n=12):
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(n) as ex: yield from ex.map(fn, xs)


def stage_detect(W, only, model, dry):
    done = {j["f"] for j in jl(W + "/detect.jsonl")}
    fs = [f for f in sorted(os.listdir(W + "/orig")) if f not in done and (not only or f in only)]
    if dry:
        pi, po = PRICE[model]
        print(json.dumps({"model": model, "images": len(fs), "est_usd": round(len(fs) * (1900 * pi + 450 * po), 2)})); return 0
    def one(f):
        j, c = gemini_json(model, [img_part(W + "/orig/" + f), {"text": DETECT_PROMPT}], SCHEMA, W + "/cost.tsv")
        j.update(f=f, cost=c, model=model); return j
    with open(W + "/detect.jsonl", "a") as fo:
        for j in pool_map(one, fs): fo.write(json.dumps(j) + "\n"); fo.flush()
    return 0


def stage_verify(W, only, model, dry):
    """Second OCR on the cleaned file (identifier regexes must find nothing) + Gemini compare of original and cleaned."""
    plan = json.load(open(W + "/plan.json"))
    done = {j["f"] for j in jl(W + "/verify.jsonl")}
    fs = [f for f, p in sorted(plan.items()) if p.get("remove") and f not in done and (not only or f in only)
          and os.path.exists(W + "/clean/" + f.rsplit(".", 1)[0] + ".png")]
    if dry:
        pi, po = PRICE[model]
        print(json.dumps({"model": model, "images": len(fs), "est_usd": round(len(fs) * (3600 * pi + 300 * po), 2)})); return 0
    def one(f):
        c = W + "/clean/" + f.rsplit(".", 1)[0] + ".png"
        o = ocr_image(c)
        hits = [w for w in o["words"] if ((w["eng"] == "vision" and w["c"] >= 0.5) or (w["eng"] == "tess" and w["c"] >= 0.6))
                and ocr_category(w["t"], w["box"])]
        j, cost = gemini_json(model, [img_part(W + "/orig/" + f), img_part(c), {"text": VERIFY_PROMPT}], VERIFY_SCHEMA, W + "/cost.tsv")
        res = [r for r in j.get("residual", []) if r.get("category") in REMOVE]
        return {"f": f, "ocr_hits": hits, "gem": j, "residual_ids": res, "cost": cost,
                "pass": not hits and not res and j.get("content_same") is True}
    with open(W + "/verify.jsonl", "a") as fo:
        for j in pool_map(one, fs): fo.write(json.dumps(j) + "\n"); fo.flush()
    return 0


def selftest():
    """Synthetic scan: a dark body ellipse with a fake name + date top left, an R marker top right, an arrow on the
    body. After plan + clean, OCR must find none of the three; the arrow pixels and the body stay."""
    import numpy as np, cv2
    from PIL import Image, ImageDraw, ImageFont
    probs = []
    assert check_detection({"kind": "ct", "real": True, "elements": []}) == []
    assert "kind" in check_detection({"kind": "cat", "real": True, "elements": []})
    assert check_detection({"kind": "ct", "real": True, "elements": [{"text": "x", "category": "laterality", "box_2d": [10, 10, 5, 20], "on_anatomy": False}]})
    assert ocr_category("12/03/2019", [0.1, 0.1, 0.2, 0.12]) == "date_time"
    assert ocr_category("R", [0.9, 0.05, 0.95, 0.1]) == "laterality"
    assert ocr_category("R", [0.5, 0.5, 0.52, 0.52]) is None
    assert ocr_category("SIEMENS", [0.4, 0.9, 0.6, 0.95]) == "device_brand"
    assert ocr_category("kVp 120", [0.0, 0.9, 0.1, 0.95]) == "viewer_overlay"
    assert ocr_category("Courtesy of Dr X", [0.0, 0.9, 0.3, 0.95]) == "publisher_credit"
    W, H = 640, 520
    im = Image.new("RGB", (W, H), (0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((140, 110, 500, 440), fill=(150, 150, 150)); d.ellipse((290, 240, 350, 300), fill=(225, 225, 225))
    d.polygon([(250, 190), (284, 236), (262, 236)], fill=(255, 255, 0))  # teaching arrowhead
    try: font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 22)
    except Exception: font = ImageFont.load_default()
    d.text((12, 10), "DOE JOHN", fill=(255, 255, 255), font=font)
    d.text((12, 38), "12/03/2019", fill=(255, 255, 255), font=font)
    d.text((598, 12), "R", fill=(255, 255, 255), font=font)
    arr = np.array(im)
    det = {"kind": "ct", "real": True, "panels": 1, "elements": [
        {"text": "DOE JOHN", "category": "patient_identifier", "box_2d": [15, 15, 75, 190], "on_anatomy": False},
        {"text": "12/03/2019", "category": "date_time", "box_2d": [70, 15, 130, 200], "on_anatomy": False},
        {"text": "R", "category": "laterality", "box_2d": [18, 930, 75, 970], "on_anatomy": False},
        {"text": "", "category": "teaching_arrow", "box_2d": [360, 385, 460, 450], "on_anatomy": True}]}
    assert check_detection(det) == []
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "s.png"); im.save(src)
        o = ocr_image(src)
        p = plan_image(det, o["words"], "quiz", W, H)
        cats = sorted(e["cat"] for e in p["remove"])
        if not {"patient_identifier", "date_time", "laterality"} <= set(cats): probs.append("plan misses " + str(cats))
        if any(e["cat"] == "teaching_arrow" for e in p["remove"]): probs.append("arrow removed")
        dd = decide(arr, p); out = apply(arr, dd)
        dst = os.path.join(td, "c.webp"); save_webp(out, dst)
        if set(webp_chunks(dst)) - {"VP8 ", "VP8L", "VP8X", "ALPH"}: probs.append("metadata chunk " + str(webp_chunks(dst)))
        left = " ".join(w["t"] for w in ocr_image(dst)["words"]).upper()
        for bad in ["DOE", "JOHN", "2019", "12/03"]:
            if bad in left: probs.append("residual " + bad)
        if re.search(r"(^|\s)R(\s|$)", left): probs.append("residual R")
        c = dd["crop"]; ox, oy = int(round(c[0] * W)), int(round(c[1] * H))
        if out[275 - oy, 320 - ox].mean() < 200: probs.append("lesion changed")
        if not (out[228 - oy, 268 - ox][0] > 200 and out[228 - oy, 268 - ox][2] < 80): probs.append("arrow changed")
    print(json.dumps({"ok": not probs, "problems": probs}))
    return 0 if not probs else 1


def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return 2
    st = a[0]
    W = os.path.expanduser(a[a.index("--dir") + 1]) if "--dir" in a else os.path.expanduser("~/prep-data/rad/deid")
    only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
    if st == "selftest": return selftest()
    if st == "plan": return stage_plan(W, only)
    if st == "clean": return stage_clean(W, only)
    model = a[a.index("--model") + 1] if "--model" in a else "gemini-3.1-flash-lite"
    if st == "detect": return stage_detect(W, only, model, "--dry" in a)
    if st == "verify": return stage_verify(W, only, model, "--dry" in a)
    if st == "ocr":
        done = {j["f"] for j in jl(W + "/ocr.jsonl")}
        with open(W + "/ocr.jsonl", "a") as fo:
            for f in sorted(os.listdir(W + "/orig")):
                if f in done or (only and f not in only): continue
                fo.write(json.dumps(dict(ocr_image(W + "/orig/" + f), f=f)) + "\n")
        return 0
    print("stage not here: detect/verify/sheet run from the job scripts listed in the vault note"); return 2


if __name__ == "__main__":
    sys.exit(main() or 0)
