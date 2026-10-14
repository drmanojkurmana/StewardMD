"""Original lesson diagram generator. Palette: ink #071318, teal #0B6B5B, tint #E3F3EF, amber #B7791F, grey #3D5A54.
Every figure: white ground, <title>/<desc>, text only in system-ui. No em or en dashes anywhere."""
import math, html, re

INK, TEAL, TINT, AMBER, GREY, RED, LINE, MID = "#071318", "#0B6B5B", "#E3F3EF", "#B7791F", "#3D5A54", "#B3382C", "#9DB5AE", "#C9DDD7"
FONT = "system-ui,sans-serif"
WARN = []
CUR = [""]

def esc(s): return html.escape(str(s), quote=True)
def tw(s, size, bold=False): return len(s) * size * (0.58 if bold else 0.54)

def wrap(t, size, bold, maxw):
    out = []
    for ln in t.split("\n"):
        cur = ""
        for w in ln.split(" "):
            nxt = (cur + " " + w).strip()
            if tw(nxt, size, bold) <= maxw or not cur: cur = nxt
            else: out.append(cur); cur = w
        out.append(cur)
    return out

class F:
    def __init__(s, name, title, desc, w=800, h=520, sub=None):
        s.name, s.title, s.desc, s.w, s.h = name, title, desc, w, h
        s.b = []
        s.text(w / 2, 32, title, 20, 700, INK, "middle")
        if sub: s.text(w / 2, 54, sub, 12.5, 400, GREY, "middle")
    def add(s, x): s.b.append(x)
    def text(s, x, y, t, size=13, weight=400, fill=INK, anchor="start", maxw=None):
        if "\n" in t:
            for i, ln in enumerate(t.split("\n")): s.text(x, y + i * size * 1.22, ln, size, weight, fill, anchor, maxw)
            return
        w = tw(t, size, weight >= 600)
        lim = maxw or s.w
        ex = x - w / 2 if anchor == "middle" else x - w if anchor == "end" else x
        if ex < 2 or ex + w > s.w - 2: WARN.append(f"{CUR[0]}: text clips '{t}' x={ex:.0f} w={w:.0f}")
        if maxw and w > maxw: WARN.append(f"{CUR[0]}: text wider than box '{t}' {w:.0f}>{maxw:.0f}")
        s.add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}" font-family="{FONT}">{esc(t)}</text>')
    def rect(s, x, y, w, h, fill="none", stroke=INK, sw=1.6, rx=8, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        s.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')
    def line(s, x1, y1, x2, y2, stroke=INK, sw=2, dash=None, cap="round"):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        s.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="{cap}"{d}/>')
    def circle(s, x, y, r, fill="none", stroke=INK, sw=1.6):
        s.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    def ellipse(s, x, y, rx, ry, fill="none", stroke=INK, sw=1.6, rot=0):
        t = f' transform="rotate({rot} {x:.1f} {y:.1f})"' if rot else ""
        s.add(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{t}/>')
    def path(s, d, fill="none", stroke=INK, sw=2, dash=None, cap="round"):
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        s.add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="{cap}" stroke-linejoin="round"{dd}/>')
    def arrow(s, x1, y1, x2, y2, stroke=INK, sw=2, head=9, dash=None):
        a = math.atan2(y2 - y1, x2 - x1)
        bx, by = x2 - head * 0.8 * math.cos(a), y2 - head * 0.8 * math.sin(a)
        s.line(x1, y1, bx, by, stroke, sw, dash)
        p1 = (x2 - head * math.cos(a - 0.4), y2 - head * math.sin(a - 0.4)); p2 = (x2 - head * math.cos(a + 0.4), y2 - head * math.sin(a + 0.4))
        s.add(f'<path d="M{x2:.1f} {y2:.1f} L{p1[0]:.1f} {p1[1]:.1f} L{p2[0]:.1f} {p2[1]:.1f} Z" fill="{stroke}"/>')
    def box(s, x, y, w, h, t, fill=TINT, stroke=TEAL, size=13, weight=600, color=INK, rx=8, dash=None):
        s.rect(x, y, w, h, fill, stroke, 1.6, rx, dash)
        lines = wrap(t, size, weight >= 600, w - 14); lh = size * 1.22
        y0 = y + h / 2 - (len(lines) - 1) * lh / 2 + size * 0.35
        for i, ln in enumerate(lines):
            if tw(ln, size, weight >= 600) > w - 8: WARN.append(f"{CUR[0]}: box text too wide '{ln}' {tw(ln,size,weight>=600):.0f}>{w-8:.0f}")
            s.text(x + w / 2, y0 + i * lh, ln, size, weight, color, "middle")
        if len(lines) * lh > h: WARN.append(f"{CUR[0]}: box text too tall '{t}'")
    def label(s, x, y, t, tx, ty, size=12.5, anchor=None, color=INK, weight=500):
        """Text at (tx,ty) with a leader line to (x,y)."""
        s.line(x, y, tx, ty + (-4 if ty > y else 4) if False else ty - size * 0.3, GREY, 1.1)
        s.circle(x, y, 2.6, INK, INK, 0)
        a = anchor or ("start" if tx >= x else "end")
        s.text(tx + (5 if a == "start" else -5), ty, t, size, weight, color, a)
    def legend(s, items, x, y, size=12):
        for i, (c, t) in enumerate(items):
            s.rect(x, y + i * 20 - 10, 18, 5, c, c, 0, 2); s.text(x + 26, y + i * 20 - 3, t, size, 400, INK)
    def build(s):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.w} {s.h}" role="img" aria-labelledby="t d">'
                f'<title id="t">{esc(s.title)}</title><desc id="d">{esc(s.desc)}</desc><rect width="{s.w}" height="{s.h}" fill="#FFFFFF"/>' + "".join(s.b) + "</svg>")

def graph(name, title, desc, rows, edges=(), sub=None, w=800, cw=None, rh=56, gap=44, top=84, nodestyle=None, notes=None, colw=None):
    """rows: list of rows; each row is a list of (id, text) or None. edges: (a,b[,label[,'dash']]). Returns F."""
    nrows = len(rows); ncols = max(len(r) for r in rows)
    cw = cw or (w - 60 - (ncols - 1) * 24) / ncols
    cw = min(cw, 340)
    h = top + nrows * rh + (nrows - 1) * gap + 40 + (30 * len(notes) if notes else 0)
    f = F(name, title, desc, w, h, sub)
    pos = {}
    for ri, r in enumerate(rows):
        n = len(r); tot = n * cw + (n - 1) * 24; x0 = (w - tot) / 2
        for ci, c in enumerate(r):
            if c is None: continue
            nid, t = c[0], c[1]; st = (c[2] if len(c) > 2 else None) or (nodestyle or {}).get(nid) or {}
            x = x0 + ci * (cw + 24); y = top + ri * (rh + gap)
            pos[nid] = (x, y, cw, rh)
            f.box(x, y, cw, rh, t, st.get("fill", TINT), st.get("stroke", TEAL), st.get("size", 13), 600, st.get("color", INK), dash=st.get("dash"))
    for e in edges:
        a, b = pos[e[0]], pos[e[1]]; lab = e[2] if len(e) > 2 else ""; dash = "5 4" if len(e) > 3 else None
        ax, ay = a[0] + a[2] / 2, a[1] + a[3] / 2; bx, by = b[0] + b[2] / 2, b[1] + b[3] / 2
        if abs(ay - by) < 1:  # same row
            s1 = 1 if bx > ax else -1
            x1, y1, x2, y2 = ax + s1 * a[2] / 2, ay, bx - s1 * b[2] / 2, by
        elif by > ay:
            x1, y1, x2, y2 = ax, a[1] + a[3], bx, b[1]
        else:
            x1, y1, x2, y2 = ax, a[1], bx, b[1] + b[3]
        f.arrow(x1, y1, x2, y2, GREY, 1.8, 9, dash)
        if lab: f.text((x1 + x2) / 2 + (8 if abs(x1 - x2) < 3 else 0), (y1 + y2) / 2 - (6 if abs(y1 - y2) < 3 else -4), lab, 11.5, 500, AMBER, "start" if abs(x1 - x2) < 3 else "middle")
    if notes:
        for i, t in enumerate(notes): f.text(w / 2, h - 18 - 30 * (len(notes) - 1 - i), t, 12.5, 500, GREY, "middle")
    return f

def smooth(pts):
    """Catmull-Rom to cubic path through pts."""
    if len(pts) < 3: return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    d = f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i else pts[i]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[i + 2] if i + 2 < len(pts) else pts[i + 1]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6); c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d

class Plot(F):
    """Axes box with data coords. P.X(x), P.Y(y) map data to pixels."""
    def __init__(s, name, title, desc, xr, yr, xl, yl, w=800, h=520, sub=None, xt=None, yt=None, l=92, r=40, t=84, b=84, xfmt=None, yfmt=None, grid=False):
        super().__init__(name, title, desc, w, h, sub)
        s.xr, s.yr, s.L, s.R, s.T, s.B = xr, yr, l, w - r, t, h - b
        s.line(s.L, s.B, s.R, s.B, INK, 2); s.line(s.L, s.B, s.L, s.T, INK, 2)
        for v in (xt or []):
            x = s.X(v); s.line(x, s.B, x, s.B + 6, INK, 1.4); s.text(x, s.B + 22, (xfmt or str)(v), 12, 400, GREY, "middle")
            if grid: s.line(x, s.B, x, s.T, MID, 0.8)
        for v in (yt or []):
            y = s.Y(v); s.line(s.L - 6, y, s.L, y, INK, 1.4); s.text(s.L - 10, y + 4, (yfmt or str)(v), 12, 400, GREY, "end")
            if grid: s.line(s.L, y, s.R, y, MID, 0.8)
        s.text((s.L + s.R) / 2, h - 28, xl, 13.5, 600, INK, "middle")
        cx, cy = 26, (s.T + s.B) / 2
        s.add(f'<text x="{cx}" y="{cy}" font-size="13.5" font-weight="600" text-anchor="middle" fill="{INK}" font-family="{FONT}" transform="rotate(-90 {cx} {cy})">{esc(yl)}</text>')
    def X(s, x): return s.L + (x - s.xr[0]) / (s.xr[1] - s.xr[0]) * (s.R - s.L)
    def Y(s, y): return s.B - (y - s.yr[0]) / (s.yr[1] - s.yr[0]) * (s.B - s.T)
    def curve(s, fn_or_pts, color=TEAL, sw=3, dash=None, n=120, xs=None):
        if callable(fn_or_pts):
            a, b = xs or s.xr
            pts = [(s.X(a + (b - a) * i / n), s.Y(fn_or_pts(a + (b - a) * i / n))) for i in range(n + 1)]
            s.path("M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts), "none", color, sw, dash)
        else:
            s.path(smooth([(s.X(x), s.Y(y)) for x, y in fn_or_pts]), "none", color, sw, dash)
    def poly(s, pts, color=TEAL, sw=3, dash=None, fill="none"):
        s.path("M" + " L".join(f"{s.X(x):.1f} {s.Y(y):.1f}" for x, y in pts), fill, color, sw, dash)
    def hline(s, y, color=GREY, dash="6 4", label=None, side="right"):
        s.line(s.L, s.Y(y), s.R, s.Y(y), color, 1.4, dash)
        if label: s.text(s.R - 4 if side == "right" else s.L + 6, s.Y(y) - 6, label, 12, 500, color, "end" if side == "right" else "start")
    def vline(s, x, color=GREY, dash="6 4", label=None, ly=None):
        s.line(s.X(x), s.B, s.X(x), s.T, color, 1.4, dash)
        if label: s.text(s.X(x) + 5, ly if ly is not None else s.T + 14, label, 12, 500, color)
    def dot(s, x, y, label=None, dx=10, dy=-10, anchor="start", color=AMBER, size=12.5):
        s.circle(s.X(x), s.Y(y), 5.5, color, "#FFFFFF", 1.5)
        if label: s.text(s.X(x) + dx, s.Y(y) + dy, label, size, 600, INK, anchor)
    def tag(s, x, y, t, color=INK, size=12.5, anchor="middle", weight=600):
        s.text(s.X(x), s.Y(y), t, size, weight, color, anchor)
    def shade(s, x1, x2, color=TINT, label=None):
        s.rect(s.X(x1), s.T, s.X(x2) - s.X(x1), s.B - s.T, color, "none", 0, 0)
        if label: s.text((s.X(x1) + s.X(x2)) / 2, s.T + 16, label, 12, 600, GREY, "middle")

def save(f, outdir):
    open(f"{outdir}/{f.name}.svg", "w").write(f.build())
    return f.name, f.w / f.h

def pathways(name, title, desc, heads, rows, sub=None, w=800, rh=44, gap=14, widths=None, top=96):
    """Columns of boxes joined by arrows. heads: column headings; rows: tuples of cell text. Row height grows to fit wrapped text."""
    n = len(heads); widths = widths or [(w - 60 - (n - 1) * 36) / n] * n
    hs = []
    for r in rows:
        m = max(len(wrap(c, 12.5, True, widths[i] - 14)) for i, c in enumerate(r) if c)
        hs.append(max(rh, m * 12.5 * 1.22 + 18))
    h = top + sum(hs) + gap * len(rows) + 20
    f = F(name, title, desc, w, h, sub)
    tot = sum(widths) + (n - 1) * 36; x0 = (w - tot) / 2
    xs = []; x = x0
    for cw in widths: xs.append(x); x += cw + 36
    for i, hd in enumerate(heads): f.text(xs[i] + widths[i] / 2, top - 14, hd, 13, 700, TEAL, "middle")
    y = top
    for ri, r in enumerate(rows):
        rh_ = hs[ri]
        for ci, c in enumerate(r):
            if c is None: continue
            f.box(xs[ci], y, widths[ci], rh_, c, TINT if ci == 1 else "#FFFFFF", TEAL if ci == 1 else LINE, 12.5, 600 if ci == 1 else 500)
            if ci + 1 < n and ci + 1 < len(r) and r[ci + 1] is not None:
                f.arrow(xs[ci] + widths[ci] + 3, y + rh_ / 2, xs[ci + 1] - 3, y + rh_ / 2, GREY, 1.8, 8)
        y += rh_ + gap
    return f

def clip_ellipse(f, cid, cx, cy, rx, ry):
    f.add(f'<clipPath id="{cid}"><ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}"/></clipPath>')

def thick(f, pts, color=TEAL, w=9, dash=None):
    f.path(smooth(pts), "none", color, w, dash)
