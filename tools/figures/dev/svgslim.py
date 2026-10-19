#!/usr/bin/env python3
"""Slim NIH BioArt organ SVGs for inlining in figure pages.

What it does, per file:
  - drops <metadata> (kills the ~470KB Illustrator PGF blob), comments,
    <title>/<desc> and editor namespaces
  - drops raster <image> data-URIs (base64 PNG shading) and any <use> of them,
    plus filters/masks left empty by that removal, so the file stays vector-only
  - inlines <style> class rules as presentation attributes (no cross-organ
    .cls-N collisions when several arts share one page)
  - prefixes surviving ids per organ and rewrites url(#..)/href refs
  - rounds geometry to 1 decimal and simplifies dense paths (RDP epsilon,
    default 0.5 user units, invisible at the ~0.5 px/unit display scale)

Usage:
  python3 tools/figures/dev/svgslim.py                 # slim all known organs
  python3 tools/figures/dev/svgslim.py heart-1          # one file (no .svg)
  python3 tools/figures/dev/svgslim.py --eps 0 --check  # no simplification

Writes tools/figures/assets/organs/slim/<name>.svg and prints sizes.
"""
import argparse
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ORGANS = os.path.join(HERE, "..", "assets", "organs")
SLIM = os.path.join(ORGANS, "slim")

# kind -> source file basename (stomach/intestine share BIOART-212 bytes)
SOURCES = {
    "liver": "liver-1", "heart": "heart-1", "kidney": "kidney-1",
    "lung": "lung-1", "stomach": "stomach-1", "intestine": "intestine-1",
    "brain": "brain-1", "pancreas": "pancreas-1", "spleen": "spleen-1",
}

SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)

PRESENT = {
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity",
    "stroke-width", "stroke-miterlimit", "stroke-linecap", "stroke-linejoin",
    "stroke-dasharray", "stroke-dashoffset", "opacity", "filter", "mask",
    "clip-path",
}


def local(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def strip_ns(root):
    for el in root.iter():
        el.tag = local(el.tag)
        for k in list(el.attrib):
            if "}" in k:
                v = el.attrib.pop(k)
                el.set(k.rsplit("}", 1)[-1], v)
        # drop xmlns:* leftovers stored as attributes (plain ET keeps them only
        # as xmlns, but be safe with odd files)
        for k in list(el.attrib):
            if k.startswith("xmlns:"):
                el.attrib.pop(k)


def remove_comments(root):
    for parent in list(root.iter()):
        for child in list(parent):
            if child.tag is ET.Comment or local(str(child.tag)) == "Comment":
                parent.remove(child)
            elif callable(getattr(child, "tag", None)):
                pass
    # ET stores comments with tag == ET.Comment function; second pass by identity
    for parent in list(root.iter()):
        for child in list(parent):
            if child.tag is ET.Comment:
                parent.remove(child)


def find_all(root, names):
    return [el for el in root.iter() if local(el.tag) in names]


def drop_metadata(root):
    for parent in list(root.iter()):
        for child in list(parent):
            if local(child.tag) in ("metadata", "title", "desc"):
                parent.remove(child)


def refs_of(root, include_style=True):
    """All #ids referenced via url(#..) or href="#.."."""
    out = set()
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        if include_style and local(el.tag) == "style":
            for m in re.finditer(r"url\(#([^)]+)\)", el.text or ""):
                out.add(m.group(1))
        for v in el.attrib.values():
            for m in re.finditer(r"url\(#([^)]+)\)", v):
                out.add(m.group(1))
            if isinstance(v, str) and v.startswith("#") and el.get("href", el.get("xlink:href", "")) == v:
                out.add(v[1:])
        href = el.get("href") or el.get("xlink:href")
        if href and href.startswith("#"):
            out.add(href[1:])
    return out


def drop_raster(root):
    """Remove <image> (base64 PNG shading) and <use> of removed ids. Any
    filter/mask whose subtree held an image (or a use of one) is tainted and
    removed, so no group is left behind an emptied mask; vector-only filters,
    masks, gradients and clipPaths are kept."""
    # map child -> parent for ancestor lookup
    parent_of = {}
    for parent in root.iter():
        for child in list(parent):
            parent_of[child] = parent
    tainted = set()

    def taint_ancestors(el):
        p = parent_of.get(el)
        while p is not None:
            t = local(p.tag) if isinstance(p.tag, str) else ""
            if t in ("filter", "mask") and p.get("id"):
                tainted.add(p.get("id"))
            p = parent_of.get(p)

    img_ids = set()
    for el in list(root.iter()):
        if isinstance(el.tag, str) and local(el.tag) == "image":
            taint_ancestors(el)
            if el.get("id"):
                img_ids.add(el.get("id"))
            p = parent_of.get(el)
            if p is not None:
                p.remove(el)
    for el in list(root.iter()):
        if isinstance(el.tag, str) and local(el.tag) == "use":
            href = el.get("href") or el.get("xlink:href") or ""
            if href.startswith("#") and (href[1:] in img_ids or href[1:].startswith("image")):
                taint_ancestors(el)
                p = parent_of.get(el)
                if p is not None:
                    p.remove(el)
    dropped = set(img_ids)
    # remove tainted filters/masks
    for el in list(root.iter()):
        if isinstance(el.tag, str) and local(el.tag) in ("filter", "mask"):
            if el.get("id") in tainted:
                dropped.add(el.get("id"))
                p = parent_of.get(el)
                if p is not None:
                    p.remove(el)
    # drop filters/masks/clipPaths left with no element children
    for parent in list(root.iter()):
        for child in list(parent):
            t = local(child.tag) if isinstance(child.tag, str) else ""
            if t in ("filter", "mask", "clipPath") and len(list(child)) == 0:
                if child.get("id"):
                    dropped.add(child.get("id"))
                parent.remove(child)
    # sweep filters/masks no longer referenced anywhere (style refs count)
    for _ in range(3):
        refs = refs_of(root, include_style=True)
        gone = False
        for parent in list(root.iter()):
            for child in list(parent):
                t = local(child.tag) if isinstance(child.tag, str) else ""
                cid = child.get("id")
                if t in ("filter", "mask") and cid and cid not in refs:
                    dropped.add(cid)
                    parent.remove(child)
                    gone = True
        if not gone:
            break
    return dropped


def parse_css(text):
    rules = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text or ""):
        sels = [s.strip() for s in m.group(1).split(",")]
        props = {}
        for part in m.group(2).split(";"):
            if ":" in part:
                k, v = part.split(":", 1)
                props[k.strip()] = v.strip()
        if props:
            rules.append((sels, props))
    return rules


def inline_classes(root, dropped):
    rules = []
    for parent in list(root.iter()):
        for child in list(parent):
            if local(child.tag) == "style":
                rules.extend(parse_css(child.text or ""))
                parent.remove(child)
    if not rules:
        return []
    unresolved = set()
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        cls = el.get("class")
        if not cls:
            continue
        names = cls.split()
    # apply in stylesheet order; later rules win like CSS
        eff = {}
        for sels, props in rules:
            for s in sels:
                s = s.strip()
                if s.startswith(".") and s[1:] in names and re.fullmatch(r"\.[A-Za-z0-9_-]+", s):
                    eff.update(props)
        for n in names:
            if not any(s.strip() == "." + n for sels, _ in rules for s in sels):
                unresolved.add(n)
        style_extra = []
        for k, v in eff.items():
            # strip refs to dropped raster plumbing
            m = re.search(r"url\(#([^)]+)\)", v)
            if m and m.group(1) in dropped:
                continue
            if k in PRESENT:
                el.set(k, v)
            else:
                style_extra.append("%s:%s" % (k, v))
        if style_extra:
            prev = el.get("style", "")
            el.set("style", (prev + ";" if prev else "") + ";".join(style_extra))
        if not any(n in unresolved for n in names):
            del el.attrib["class"]
    return sorted(unresolved)


def prefix_ids(root, pfx):
    mapping = {}
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        cid = el.get("id")
        if cid:
            mapping[cid] = "%s-%s" % (pfx, cid)
            el.set("id", mapping[cid])
    if not mapping:
        return
    def sub(v):
        for old, new in mapping.items():
            v = v.replace("url(#%s)" % old, "url(#%s)" % new)
            if v == "#%s" % old:
                v = "#%s" % new
        return v
    for el in root.iter():
        if not isnumeric_tag(el):
            continue
        for k in list(el.attrib):
            v = el.attrib[k]
            if isinstance(v, str) and ("url(#" in v or v.startswith("#")):
                el.set(k, sub(v))


def isnumeric_tag(el):
    return isinstance(el.tag, str)


# ---------------- path minify + simplify ----------------

NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
CMD = set("MmLlHhVvCcSsQqTtAaZz")
NARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def tokenize(d):
    return re.findall(r"%s|[A-Za-z]" % NUM, d)


def parse_path(d):
    """-> list of subpaths; each is (closed:bool, segs) with segs as
    (cmd, [floats]) in absolute coords (arcs kept verbatim)."""
    toks = tokenize(d)
    subs = []
    cur = []
    x = y = 0.0
    sx = sy = 0.0
    idx = 0
    n = len(toks)
    cmd = None
    while idx < n:
        t = toks[idx]
        if t in CMD:
            cmd = t
            idx += 1
            explicit = True
            if cmd in "Zz":
                if cur:
                    cur.append(("Z", []))
                x, y = sx, sy
                continue
        else:
            explicit = False
            if cmd is None or cmd in "Zz":
                idx += 1
                continue
        u = cmd.upper()
        if u == "M" and not explicit:
            u = "L"  # implicit moveto pairs after M are lineto
            cmd = "L" if cmd == "M" else "l"
        need = NARGS[u]
        vals = []
        ok = True
        for _ in range(need):
            if idx < n and toks[idx] not in CMD:
                try:
                    vals.append(float(toks[idx]))
                except ValueError:
                    ok = False
                    break
                idx += 1
            else:
                ok = False
                break
        if not ok:
            cmd = None
            continue
        rel = cmd.islower()
        if u == "M":
            if cur:
                subs.append(cur)
            x, y = (x + vals[0], y + vals[1]) if rel else (vals[0], vals[1])
            sx, sy = x, y
            cur = [("M", [x, y])]
            cmd = "L" if cmd == "M" else "l"  # later implicit pairs are lineto
        elif u == "L":
            x, y = (x + vals[0], y + vals[1]) if rel else (vals[0], vals[1])
            cur.append(("L", [x, y]))
        elif u == "H":
            x = x + vals[0] if rel else vals[0]
            cur.append(("L", [x, y]))
        elif u == "V":
            y = y + vals[0] if rel else vals[0]
            cur.append(("L", [x, y]))
        elif u == "C":
            pts = vals if not rel else [vals[0] + x, vals[1] + y, vals[2] + x, vals[3] + y, vals[4] + x, vals[5] + y]
            cur.append(("C", pts))
            x, y = pts[4], pts[5]
        elif u == "S":
            pts = vals if not rel else [vals[0] + x, vals[1] + y, vals[2] + x, vals[3] + y]
            # need reflection of previous control; approximate: treat as line-ish cubic
            cur.append(("S", pts))
            x, y = pts[2], pts[3]
        elif u == "Q":
            pts = vals if not rel else [vals[0] + x, vals[1] + y, vals[2] + x, vals[3] + y]
            cur.append(("Q", pts))
            x, y = pts[2], pts[3]
        elif u == "T":
            x, y = (x + vals[0], y + vals[1]) if rel else (vals[0], vals[1])
            cur.append(("T", [x, y]))
        elif u == "A":
            # keep arcs verbatim (rounded later); track endpoint
            ex, ey = vals[5], vals[6]
            if rel:
                ex, ey = ex + x, ey + y
            cur.append(("A", vals if not rel else [vals[0], vals[1], vals[2], vals[3], vals[4], ex, ey]))
            x, y = ex, ey
    if cur:
        subs.append(cur)
    return subs


def cubic(p0, p1, p2, p3, n):
    out = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        out.append((
            mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0],
            mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1],
        ))
    return out


def quad(p0, p1, p2, n):
    out = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        out.append((
            mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
            mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
        ))
    return out


def flatten(sub):
    pts = []
    px = py = None
    prev_c = None
    prev_q = None
    for cmd, v in sub:
        if cmd == "M":
            px, py = v[0], v[1]
            pts.append((px, py))
            prev_c = prev_q = None
        elif cmd == "L":
            px, py = v[0], v[1]
            pts.append((px, py))
            prev_c = prev_q = None
        elif cmd == "C":
            for p in cubic((px, py), (v[0], v[1]), (v[2], v[3]), (v[4], v[5]), 10):
                pts.append(p)
            prev_c = (v[2], v[3])
            prev_q = None
            px, py = v[4], v[5]
        elif cmd == "S":
            c1 = (2 * px - prev_c[0], 2 * py - prev_c[1]) if prev_c else (px, py)
            for p in cubic((px, py), c1, (v[0], v[1]), (v[2], v[3]), 10):
                pts.append(p)
            prev_c = (v[0], v[1])
            prev_q = None
            px, py = v[2], v[3]
        elif cmd == "Q":
            for p in quad((px, py), (v[0], v[1]), (v[2], v[3]), 8):
                pts.append(p)
            prev_q = (v[0], v[1])
            prev_c = None
            px, py = v[2], v[3]
        elif cmd == "T":
            q1 = (2 * px - prev_q[0], 2 * py - prev_q[1]) if prev_q else (px, py)
            for p in quad((px, py), q1, (v[0], v[1]), 8):
                pts.append(p)
            prev_q = q1
            prev_c = None
            px, py = v[0], v[1]
        # Z / A handled by caller
    return pts


def rdp(pts, eps):
    if len(pts) < 3 or eps <= 0:
        return list(pts)
    # degenerate anchors (closed loop ending where it started) would keep
    # only the endpoints; split closed rings at their widest point instead.
    if math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 0.05 and len(pts) > 8:
        ring = pts[:-1]
        k = max(range(1, len(ring)),
                key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
        if (ring[k][0] - ring[0][0]) ** 2 + (ring[k][1] - ring[0][1]) ** 2 < 0.0025:
            return [pts[0]]  # all points coincide; the ring is a dot
        first = rdp(ring[:k + 1], eps)
        second = rdp(ring[k:] + ring[:1], eps)
        return first + second[1:-1]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        denom = math.hypot(dx, dy) or 1e-9
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / denom
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def fmt(n):
    r = round(float(n), 1)
    if r == 0:
        r = 0.0
    s = ("%.1f" % r).rstrip("0").rstrip(".")
    if s.startswith("0.") :
        s = s[1:]
    if s.startswith("-0."):
        s = "-" + s[2:]
    return s


def minjoin(nums):
    """Join rounded numbers with the fewest separators SVG allows.

    A sign always starts a new number, so nothing is needed before "-".
    A "." starts a new number only when the number in progress already has
    one ("5.3.3" is 5.3 then .3, but "5"+".3" would read as 5.3), so a space
    is needed before "." unless the trailing token already holds a dot.
    """
    out = ""
    for s in nums:
        if not out:
            out = s
            continue
        if s.startswith("-") or s.startswith("+"):
            out += s  # sign always breaks the number (we emit no exponents)
        elif s.startswith("."):
            m = re.search(r"[0-9]*\.[0-9]*$", out)
            out += s if m else " " + s
        elif out[-1].isalpha():
            out += s  # command letter already separates
        else:
            out += " " + s
    return out


def safejoin(nums):
    return " ".join(nums)


def emit_sub(pts, closed, joiner):
    if not pts:
        return ""
    # drop consecutive near-duplicates
    clean = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - clean[-1][0]) > 0.049 or abs(p[1] - clean[-1][1]) > 0.049:
            clean.append(p)
    if len(clean) == 1:
        return "M" + joiner([fmt(clean[0][0]), fmt(clean[0][1])]) + ("Z" if closed else "")
    parts = ["M" + joiner([fmt(clean[0][0]), fmt(clean[0][1])])]
    deltas = []
    px, py = clean[0]
    for x, y in clean[1:]:
        deltas.append(fmt(x - px))
        deltas.append(fmt(y - py))
        px, py = x, y
    parts.append("l" + joiner(deltas))
    if closed:
        parts.append("Z")
    return "".join(parts)


def _bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def slim_path(d, eps):
    try:
        subs = parse_path(d)
    except Exception:
        return round_numbers(d)
    out = []
    for sub in subs:
        closed = any(c == "Z" for c, _ in sub)
        has_arc = any(c == "A" for c, _ in sub)
        if has_arc:
            out.append(round_numbers(d if len(subs) == 1 else _reserialize(sub)))
            continue
        pts = flatten(sub)
        if len(pts) > 6000 and eps > 0:
            # dense shading blob: pre-decimate to keep RDP fast
            pts = pts[::2]
        pts = rdp(pts, eps)
        s = emit_sub(pts, closed, minjoin)
        # round-trip guard: reparse what we emitted; on mismatch fall back
        # to plain space-joined numbers so art can never corrupt silently.
        try:
            rt = []
            for rsub in parse_path(s):
                rt += flatten(rsub)
            want = _bbox(pts)
            got = _bbox(rt) if rt else want
            if any(abs(a - b) > 0.15 for a, b in zip(want, got)):
                s = emit_sub(pts, closed, safejoin)
        except Exception:
            s = emit_sub(pts, closed, safejoin)
        out.append(s)
    return "".join(s for s in out if s)


def _reserialize(sub):
    parts = []
    for cmd, v in sub:
        if cmd == "Z":
            parts.append("Z")
        elif cmd == "A":
            parts.append("A" + " ".join(fmt(x) for x in v))
        else:
            parts.append(cmd + " ".join(fmt(x) for x in v))
    return "".join(parts)


def round_numbers(s):
    def rep(m):
        try:
            return fmt(float(m.group(0)))
        except ValueError:
            return m.group(0)
    # round decimals but leave integers and huge precision-safe ints alone
    return re.sub(r"[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?", rep, s)


GEOM_ATTRS = {
    "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
    "x1", "y1", "x2", "y2", "dx", "dy", "offset", "stroke-width",
    "stroke-miterlimit", "stroke-dashoffset", "font-size",
}


def round_attrs(root):
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        for k in list(el.attrib):
            if k in ("d",):
                continue
            v = el.attrib[k]
            if not isinstance(v, str):
                continue
            lk = local(k)
            if lk in GEOM_ATTRS or lk == "transform" or lk == "viewBox" or "url(" not in v and re.search(r"\d+\.\d", v):
                if lk in ("filter", "mask", "clip-path", "fill", "stroke", "href", "style", "id", "class"):
                    continue
                el.set(k, round_numbers(v))
        # stroke-dasharray may mix numbers
        da = el.get("stroke-dasharray")
        if da:
            el.set("stroke-dasharray", round_numbers(da))


def slim_paths(root, eps):
    for el in root.iter():
        if isinstance(el.tag, str) and local(el.tag) == "path":
            d = el.get("d")
            if d:
                el.set("d", slim_path(d, eps))


def drop_empty_defs(root):
    for parent in list(root.iter()):
        for child in list(parent):
            t = local(child.tag) if isinstance(child.tag, str) else ""
            if t == "defs" and len(list(child)) == 0:
                parent.remove(child)
            elif t == "g" and len(list(child)) == 0 and not child.get("id"):
                parent.remove(child)


def clean_tree(root):
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        el.text = None
        el.tail = None


def slim_one(name, eps):
    src = os.path.join(ORGANS, name + ".svg")
    with open(src, "r", encoding="utf-8") as f:
        text = f.read()
    # strip XML prolog / doctype so ET sees plain SVG
    text = re.sub(r"<\?.*?\?>", "", text, count=1).strip()
    text = re.sub(r"<!DOCTYPE[^>]*>", "", text, count=1).strip()
    root = ET.fromstring(text)
    strip_ns(root)
    remove_comments(root)
    drop_metadata(root)
    dropped = drop_raster(root)
    dropped |= set()  # ids already gone
    # collect ids that vanished (images etc.) so class refs to them are stripped
    unresolved = inline_classes(root, dropped)
    # sweep defs orphaned by the drops above (style is gone; attribute refs only)
    for _ in range(3):
        refs = refs_of(root, include_style=False)
        gone = False
        for parent in list(root.iter()):
            for child in list(parent):
                t = local(child.tag) if isinstance(child.tag, str) else ""
                cid = child.get("id")
                if t in ("filter", "mask", "linearGradient", "radialGradient", "clipPath") and cid and cid not in refs:
                    dropped.add(cid)
                    parent.remove(child)
                    gone = True
        if not gone:
            break
    # prefix surviving ids
    pfx = "oa" + re.sub(r"[^a-z0-9]", "", name.split("-")[0].lower())[:3]
    prefix_ids(root, pfx)
    round_attrs(root)
    # viewBox on root may carry the svg namespace tag already stripped
    slim_paths(root, eps)
    drop_empty_defs(root)
    clean_tree(root)
    # root: keep viewBox + xmlns only
    vb = root.get("viewBox", "")
    root.attrib.clear()
    root.set("xmlns", SVG_NS)
    if vb:
        root.set("viewBox", round_numbers(vb))
    os.makedirs(SLIM, exist_ok=True)
    out = os.path.join(SLIM, name + ".svg")
    data = ET.tostring(root, encoding="unicode")
    with open(out, "w", encoding="utf-8") as f:
        f.write(data)
    return out, len(data), unresolved, pfx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="basenames without .svg (default: all known)")
    ap.add_argument("--eps", type=float, default=0.5)
    ap.add_argument("--check", action="store_true", help="report only, still writes")
    args = ap.parse_args()
    names = args.names or sorted(set(SOURCES.values()))
    total = 0
    for name in names:
        src = os.path.join(ORGANS, name + ".svg")
        before = os.path.getsize(src)
        out, after, unresolved, pfx = slim_one(name, args.eps)
        total += after
        flag = "" if after < 70 * 1024 else "  OVER 70KB"
        print("%-15s %7.1fKB -> %6.1fKB  pfx=%s%s%s" % (
            name + ".svg", before / 1024, after / 1024, pfx, flag,
            ("  UNRESOLVED:" + ",".join(unresolved)) if unresolved else ""))
    print("slim total %.1fKB" % (total / 1024,))


if __name__ == "__main__":
    main()
