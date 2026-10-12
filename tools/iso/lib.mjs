// Build-time helpers shared by the figure scripts in tools/iso/figures/. Node only; nothing here ships.
// The drawing primitives are the vendored Anatomy kit (./kit, MIT, see ./kit/LICENSE); this file adds what the
// app needs on top: a painter's list, the projection basis the ES5 runtime moves parts with, and morph keyframes.
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import * as T from "./kit/tube.mjs";
export { k, G, T };

const NUM = /(-?\d*\.?\d+(?:e[-+]?\d+)?)/;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// The screen origin and the screen vector of one world unit along x, y and z. iso() is linear, so the runtime can
// project any world point (and move any group) with these four vectors and no kit code.
export function basisOf(P) {
  const o = k.iso([0, 0, 0], P);
  const at = (p) => { const q = k.iso(p, P); return [r4(q[0] - o[0]), r4(q[1] - o[1])]; };
  return { o: [r4(o[0]), r4(o[1])], x: at([1, 0, 0]), y: at([0, 1, 0]), z: at([0, 0, 1]) };
}

// Painter's list: items are painted back to front by the depth of a world anchor point (plus a bias).
export function painter(P) {
  const items = [];
  return {
    add(at, svg, bias = 0) { items.push({ key: k.depthOf(at, P) + bias, svg, n: items.length }); return svg; },
    svg() { return items.sort((a, b) => a.key - b.key || a.n - b.n).map((i) => i.svg).join(""); },
  };
}

// A part the runtime moves: <g data-iso-part=name> around markup.
export const part = (name, markup, extra = "") => `<g data-iso-part="${name}"${extra}>${markup}</g>`;

// Morph keyframes for a part whose shape changes (a bag filling, a column rising). fn(f) returns markup for f in
// [0, 1]; keyframes with the same text skeleton are blended number by number at run time. Returns the data the
// runtime reads and the markup at rest (rest = the fraction drawn into the static SVG).
export function morph(fn, frames = [0, 1], rest = frames[0]) {
  const texts = [], keys = [];
  for (const f of frames) {
    const parts = fn(f).split(NUM), t = [], n = [];
    parts.forEach((p, i) => (i % 2 ? n : t).push(p));
    const sig = JSON.stringify(t);
    let ti = texts.findIndex((x) => JSON.stringify(x) === sig);
    if (ti < 0) { texts.push(t); ti = texts.length - 1; }
    keys.push({ t: ti, n });
  }
  return { data: { f: frames, t: texts, k: keys }, markup: fn(rest), blends: keys.filter((x, i) => i && x.t === keys[i - 1].t).length };
}
export const range = (n) => Array.from({ length: n + 1 }, (_, i) => Math.round((i / n) * 1000) / 1000);

// Frequently used shorthands bound to one projection.
export function tools(P) {
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const at = (p) => k.iso(p, P);
  return { S, L, D, at };
}

// A hose or tube along a 3D route, chunked so each chunk paints at its own depth. Returns the chunks as
// { mid, svg } so a figure can add them to its painter.
export function hose(points, radius, P, { tone = "hi", rings = null, maxLength = 18, bend = 2.6, gaps = [], caps = true } = {}) {
  const route = points.length > 2 ? G.fillet(points, radius * bend) : points;
  return T.tubePieces(route, radius, P, { maxLength, rings, gaps, caps }).map((piece) => ({ mid: piece.mid, svg: T.tubeSvg(piece, { tone }) }));
}

// A soft body hanging down a vertical axis from (cx, cy, z0): a bag, a test lung, a cuff bladder end-on. profile is
// [[depth below z0, radius], ...] from the neck down. Every call with the same profile length and n draws the same
// path skeleton, so a morph between two radii blends smoothly (the kit's lathe re-meshes per radius and does not).
// Shaded as the kit shades a curved body: a body tone, a darker band on the side away from the light, a highlight.
export function balloon(cx, cy, z0, profile, P, { n = 10 } = {}) {
  const A = ((P.azimuth ?? 45) * Math.PI) / 180;
  const right = A - Math.PI / 2, left = A + Math.PI / 2;
  const pt = (r, th, z) => k.iso([cx + r * Math.cos(th), cy + r * Math.sin(th), z], P);
  const rings = profile.map(([dz, r]) => ({ z: z0 - dz, r: Math.max(0.05, r) }));
  const side = (th) => rings.map(({ z, r }) => pt(r, th, z));
  const arc = (ring, from, to) => Array.from({ length: n + 1 }, (_, i) => pt(ring.r, from + ((to - from) * i) / n, ring.z));
  const last = rings[rings.length - 1], first = rings[0];
  const outline = [...side(right), ...arc(last, right, right + Math.PI).slice(1), ...side(left).reverse().slice(1), ...arc(first, left, left + Math.PI).slice(1, -1)];
  const band = (from, to) => [...side(from), ...side(to).reverse()];
  const d = (pts) => k.pathOf(pts, true);
  return {
    fill: d(outline), outline: d(outline), crease: "", top: d(band(left - 0.95, left - 0.62)),
    shades: [d(band(right, right + 0.55)), d(band(right + 0.55, right + 1.05)), "", ""],
  };
}
