/* Haemodialysis, built as a working machine (Anatomy kit for the solids, tubes and round parts; Anima for the page shell).
 *   ANATOMY_DIR=/path/to/anatomy node tools/figures/scenes/dialysis.mjs [--register]
 * Static art is built here; the particles, pump, syringe and gauges move in the page script. Qualitative: no flow rates, no doses. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const AN = process.env.ANATOMY_DIR || "/home/user/wheresryan22/anatomy";
const k = await import(pathToFileURL(join(AN, "kit/iso-kit.mjs")));
const G = await import(pathToFileURL(join(AN, "kit/lathe.mjs")));
const T = await import(pathToFileURL(join(AN, "kit/tube.mjs")));
const { BIO_CSS } = await import(pathToFileURL(join(process.env.ANIMA_DIR || "/home/user/garinmckayl/anima", "kit/blob.mjs")));

const W = 960, H = 640, INSET_H = 226;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------- world: a dialysis chair and a machine beside it ---------------- */
const BASE = { x: -92, y: -64, w: 262, d: 186, r: 10 };
const MC = { x: 20, y: -50, w: 76, d: 60, r: 6 }, MH = 106;      // machine body; front face is the plane y = YF
const YF = MC.y + MC.d;
const ROTOR = [44, YF + 3, 45], ROTOR_R = 12;                       // blood pump, on the machine's front face
const HEPC = [36, YF + 5, 24];                                       // heparin syringe, on the front face
const DLY = { x: 120, y: -18, z0: 18, z1: 80, R: 10 };               // dialyser, standing upright on the machine's side
const CH = [142, -18, 34];                                           // venous drip chamber (base centre)
const POLE = [10, -34];                                              // drip pole with the saline bag
const CY = 22;                                                      // gap between the machine and the chair, for the lines to cross
const NEEDLE_A = [27, 41 + CY, 53], NEEDLE_V = [47, 41 + CY, 53];
const P = k.fitProjection([...k.boxCorners(BASE, -12, 0), [MC.x + MC.w, MC.y + MC.d, MH + 6], [POLE[0], POLE[1], 124], [-84, 92, 66], [160, -18, 100]], W, H - INSET_H, { pad: 8, azimuth: 62, elevation: 28 });
P.origin[1] += INSET_H - 6;
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const V = G.viewOf(P);
const items = [];
const put = (centre, svg, bias = 0) => items.push({ key: G.dot3(centre, V) + bias, svg });
const f1 = (v) => +v.toFixed(1);
const arcD = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 0 1 ${f1(x1)} ${f1(y1)}`; };
const C = (cls, svg) => `<g class="${cls}">${svg}</g>`;
const hot = (info, inner) => `<g class="hot" tabindex="0" data-info="${esc(info)}">${inner}</g>`;
const faceAt = (fy, x, z, w, h) => { const a = at([x, fy, z]), b = at([x + w, fy, z]), c = at([x, fy, z + h]);
  return `matrix(${[b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]].map((v) => +v.toFixed(4)).join(" ")})`; };
const ball = (c, r, tone) => { const F = G.frameAlong([c[0], c[1], c[2] - r], [0, 0, 1]); const pr = []; for (let i = 0; i <= 16; i++) { const t = (i / 16) * 2 * r; pr.push([t, Math.max(0.4, Math.sqrt(Math.max(0, r * r - (t - r) * (t - r))))]); } return S(G.solidOf(pr, F, P), { tone }); };

/* ---- the unit's floor ---- */
const floor = `<path class="iso-halo" d="${k.haloOf(BASE, -12, 12, P)}"/>` + S(k.slabOf(BASE, -12, 12, P, 8, 1.2), { tone: "lo" }) + L(k.planOutline(k.insetPlan(BASE, 6), 0, P), { tone: "faint" }) +
  D(k.corners(BASE, 10).map(([x, y]) => at([x, y, 0])), { size: 0.5 });
put([0, 0, -12], floor, -1e3);

/* ---- the dialysis chair, with the patient reclining and the access arm on the armrest ---- */
{
  let s = "";
  [[-68, 40], [70, 40], [-68, 90], [70, 90]].forEach(([x, y]) => { s += S(k.cylinder(x, y + CY, 4, 0, 8, P, 16), { tone: "lo" }); });
  s += C("c-chair2", S(k.slabOf({ x: -74, y: 36 + CY, w: 152, d: 62, r: 10 }, 8, 14, P, 6, 0.8), { tone: "mid" }));
  s += C("c-chair", S(k.slabOf({ x: -68, y: 40 + CY, w: 138, d: 54, r: 12 }, 22, 11, P, 8, 1), { tone: "hi" }));
  s += C("c-chair", S(k.slabOf({ x: -80, y: 38 + CY, w: 22, d: 58, r: 10 }, 22, 46, P, 8, 1), { tone: "hi" }));
  s += C("c-chair2", S(k.slabOf({ x: -24, y: 30 + CY, w: 96, d: 11, r: 4 }, 33, 6, P, 3, 0.6), { tone: "mid" }));
  s += S(k.slabOf({ x: 14, y: 34 + CY, w: 7, d: 4, r: 1 }, 8, 25, P, 2, 0.3), { tone: "lo" });
  put([2, 66 + CY, 22], hot("Dialysis chair. The patient reclines for several hours, with the access arm resting on the armrest beside the machine.", s), -0.2);
}
{
  let s = "";
  s += C("c-gown", S(k.slabOf({ x: -50, y: 52 + CY, w: 74, d: 38, r: 15 }, 33, 20, P, 10, 1.2), { tone: "hi" }));
  s += C("c-blanket", S(k.slabOf({ x: 16, y: 54 + CY, w: 62, d: 32, r: 13 }, 33, 13, P, 8, 1), { tone: "mid" }));
  s += C("c-skin", S(k.slabOf({ x: -76, y: 60 + CY, w: 22, d: 20, r: 9 }, 50, 22, P, 8, 1), { tone: "hi" }));
  put([-10, 70 + CY, 44], hot("The patient. Haemodialysis usually takes a few hours, three times a week, so people sit or recline in a chair like this while the machine works.", s), 0.3);
}
{
  let s = C("c-skin", S(k.slabOf({ x: -14, y: 36 + CY, w: 78, d: 12, r: 5 }, 40, 10, P, 5, 0.8), { tone: "hi" }));
  s += L(k.planOutline(k.insetPlan({ x: -14, y: 36 + CY, w: 78, d: 12, r: 5 }, 3), 50, P, 4), { tone: "faint" });
  for (let i = 0; i < 4; i++) s += C("c-skin", S(k.slabOf({ x: 62, y: 37 + i * 2.6, w: 12, d: 2.8, r: 1.2 }, 41, 6, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  // the fistula: the forearm vein, swollen by arterial pressure, with the two needle sites
  s += C("c-vein", S(k.slabOf({ x: 18, y: 39 + CY, w: 40, d: 7, r: 3.4 }, 50, 3.4, P, 3, 0.5), { tone: "mid" }));
  [NEEDLE_A, NEEDLE_V].forEach((n) => { s += S(k.cylinder(n[0], n[1], 2.4, 50, 3, P, 14), { tone: "lo" }); });
  put([30, 41 + CY, 44], hot("Arm with an arteriovenous (AV) fistula: a surgical join between an artery and a vein. The vein enlarges and thickens, so two needles can be placed for months or years and blood can be taken out and returned at a high flow.", s), 0.8);
}

/* ---- the machine ---- */
{
  let s = "";
  [[MC.x + 9, MC.y + 9], [MC.x + MC.w - 9, MC.y + 9], [MC.x + 9, MC.y + MC.d - 9], [MC.x + MC.w - 9, MC.y + MC.d - 9]].forEach(([x, y]) => { s += S(k.cylinder(x, y, 5, 0, 7, P, 18), { tone: "lo" }); });
  s += C("c-mach", S(k.slabOf(MC, 7, MH - 7, P, 6, 1), { tone: "mid" }));
  s += L(k.planOutline(k.insetPlan(MC, 3), MH, P, 6), { tone: "faint" });
  s += C("c-mach2", S(k.slabOf({ x: MC.x + 4, y: MC.y + 4, w: MC.w - 8, d: 14, r: 3 }, MH, 5, P, 3, 0.5), { tone: "hi" }));
  // pump door: a darker, slightly proud panel behind the rotor
  s += C("c-door", S(k.slabOf({ x: MC.x + 6, y: YF - 1, w: 52, d: 4, r: 4 }, 29, 33, P, 3, 0.5), { tone: "lo" }));
  // concentrate wands on top
  s += S(k.cylinder(MC.x + 16, MC.y + 36, 3, MH + 5, 3, P, 14), { tone: "lo" });
  s += S(k.cylinder(MC.x + 26, MC.y + 36, 3, MH + 5, 3, P, 14), { tone: "lo" });
  // dialyser holder: an arm from the machine's side with two clips
  s += S(k.slabOf({ x: MC.x + MC.w, y: DLY.y - 4, w: DLY.x - DLY.R - (MC.x + MC.w) + 3, d: 8, r: 2 }, 44, 6, P, 2, 0.5), { tone: "mid" });
  [DLY.z0 + 12, DLY.z1 - 12].forEach((z) => { s += S(k.slabOf({ x: DLY.x - DLY.R - 1.5, y: DLY.y - 5, w: 3, d: 10, r: 1 }, z, 5, P, 1.5, 0.3), { tone: "lo" }); });
  put([MC.x + MC.w / 2, MC.y + MC.d / 2, MH / 2], hot("Dialysis machine. It pumps the blood, adds heparin, mixes dialysate from purified water and concentrate, warms it, pumps it past the dialyser, and watches pressures, flow, temperature and air for safety.", s), 0);
}
const faceMatrix = (x, z, w, h) => faceAt(YF, x, z, w, h);
{
  const sc = { x: MC.x + 6, z: 70, w: 64, h: 30 };
  let s = `<g transform="${faceMatrix(sc.x, sc.z, sc.w, sc.h)}"><rect class="dr-scr" x="0" y="0" width="1" height="1" rx="0.05"/>`;
  [[0.08, "bp"], [0.38, "dp"], [0.68, "cd"]].forEach(([x, id]) => { s += `<rect class="dr-scr-bar" x="${x}" y="0.2" width="0.22" height="0.6" rx="0.03"/><rect class="dr-scr-fill" id="scr-${id}" x="${x}" y="0.8" width="0.22" height="0.0" rx="0.03"/>`; });
  s += `<rect class="dr-scr-led" id="scr-led" x="0.86" y="0.07" width="0.08" height="0.1" rx="0.04"/></g>`;
  put([MC.x + MC.w / 2, YF, 85], hot("Machine monitor. It shows the blood pump, the dialysate pump and the safety checks. Each bar is a live reading (arterial pressure, dialysate pressure, conductivity). The light turns amber when something is off.", s), 7);
}

/* ---- heparin syringe pump on the machine's front ---- */
{
  let s = S(k.slabOf({ x: MC.x + 8, y: YF, w: 56, d: 5, r: 2 }, 16, 16, P, 2, 0.5), { tone: "mid" });
  const F = G.frameAlong(HEPC, [1, 0, 0]);
  s += S(G.solidOf([[0, 4], [36, 4], [36, 2.6], [42, 2.6]], F, P), { tone: "hi" });
  s += L(G.arcOf(F, 12, 4, P) + G.arcOf(F, 24, 4, P), { tone: "faint" });
  put([HEPC[0] + 20, HEPC[1], HEPC[2]], hot("Heparin syringe pump. Blood clots when it meets the plastic of the circuit, so a slow, steady drip of heparin (an anticoagulant) is added to the blood before the dialyser.", s), 6);
}

/* ---- dialyser, upright: blood in at the bottom, out at the top ---- */
{
  const len = DLY.z1 - DLY.z0, F = G.frameAlong([DLY.x, DLY.y, DLY.z0], [0, 0, 1]), R = DLY.R;
  const profile = [[0, 5], [3, 5], [3, 9], [8, R - 1, 1], [12, R], [len - 12, R], [len - 8, R - 1, 1], [len - 3, 9], [len - 3, 5], [len, 5]];
  let s = C("c-mach2", S(G.solidOf(profile, F, P), { tone: "hi" }));
  s += L(G.arcOf(F, 12, R, P) + G.arcOf(F, len - 12, R, P) + G.arcOf(F, 22, R, P) + G.arcOf(F, len - 22, R, P) + G.arcOf(F, len / 2, R, P), { tone: "faint" });
  // dialysate ports on the side facing us, near the two ends
  [[DLY.z0 + 8], [DLY.z1 - 8]].forEach(([z]) => { const Fp = G.frameAlong([DLY.x, DLY.y + R - 2, z], [0, 1, 0]); s += S(G.solidOf([[0, 3.2], [7, 3.2]], Fp, P), { tone: "mid" }); s += S(G.disc(7, 4.2, 3.2, Fp, P), { tone: "mid" }); });
  [[DLY.z0, -1], [DLY.z1, 1]].forEach(([z, d]) => { const Fe = G.frameAlong([DLY.x, DLY.y, z], [0, 0, d]); s += S(G.disc(0, 4, 6.4, Fe, P), { tone: "mid" }); });
  put([DLY.x, DLY.y, (DLY.z0 + DLY.z1) / 2], hot("Hollow-fibre dialyser (the artificial kidney), standing upright. Thousands of hair-thin tubes run side by side. Blood flows up inside the tubes and dialysate flows down around them, in the opposite direction. The tube walls are a thin semipermeable membrane.", s), 0);
}

/* ---- venous drip chamber with air detector ---- */
{
  const F = G.frameAlong([CH[0], CH[1], CH[2]], [0, 0, 1]);
  let s = S(k.slabOf({ x: CH[0] - 3, y: CH[1] - 4, w: 6, d: 8, r: 2 }, 0, 0, P, 2, 0.3), { tone: "lo" });
  s = C("c-mach2", S(G.solidOf([[0, 4.4], [2, 7], [26, 7], [28, 4.4]], F, P), { tone: "hi" }));
  s += L(G.arcOf(F, 8, 7, P) + G.arcOf(F, 19, 7, P), { tone: "faint" });
  s += S(k.slabOf({ x: CH[0] - 11, y: CH[1] - 4, w: 22, d: 8, r: 2 }, CH[2] + 30, 8, P, 3, 0.5), { tone: "lo" });
  s += S(k.slabOf({ x: MC.x + MC.w, y: CH[1] - 3, w: CH[0] - 11 - (MC.x + MC.w) - (DLY.x + DLY.R - (MC.x + MC.w)) + 16, d: 6, r: 1 }, 0, 0, P, 1, 0.2), { tone: "lo" });
  put([CH[0], CH[1], CH[2] + 14], hot("Venous drip chamber and air detector. The returning blood passes through a small trap where bubbles rise out. A sensor stops the pump and clamps the line if any air is detected, because air in a vein can cause an air embolism.", s), 3);
}

/* ---- saline stand ---- */
{
  let s = S(k.cylinder(POLE[0], POLE[1], 7, 0, 3, P, 24), { tone: "lo" });
  s += S(k.cylinder(POLE[0], POLE[1], 1.5, 118, 3, P, 14), { tone: "mid" });
  s += S(k.slabOf({ x: POLE[0] - 10, y: POLE[1] - 1.5, w: 20, d: 3, r: 1 }, 114, 3, P, 1, 0.3), { tone: "mid" });
  s += S(k.slabOf({ x: POLE[0] - 8, y: POLE[1] - 2.5, w: 16, d: 5, r: 2.2 }, 84, 30, P, 3, 0.5), { tone: "hi" });
  put([POLE[0], POLE[1], 98], hot("Saline bag on the drip pole. Salt solution runs into the arterial line to prime the circuit before dialysis starts, and can be given to top up blood volume if the pressure drops.", s), 0.5);
}

/* ---- pipes ---- */
function route(points, r, opts = {}) {
  const smooth = opts.sharp ? points : G.fillet(points, Math.max(3, r * 2.6), 7, { P, tube: r });
  const pieces = T.tubePieces(smooth, r, P, { maxLength: opts.maxLength || 14, caps: true });
  return { smooth, pieces, screen: smooth.map((p) => at(p)) };
}
const arcPts = (cx, y, cz, R, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const t = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180; return [cx + R * Math.cos(t), y, cz + R * Math.sin(t)]; });
const ARC = arcPts(ROTOR[0], YF + 2.2, ROTOR[2], ROTOR_R + 4.4, 180, 0);
const ART = route([NEEDLE_A, [25, 40, 60], ...G.fillet([[25, 40, 60], [24, YF + 6, 56], [26, YF + 3, 48], ARC[0]], 5, 6, { P, tube: 2.6 }), ...ARC, [ROTOR[0] + ROTOR_R + 8, YF + 2.2, 36], [100, YF + 4, 30], [112, 16, 12], [DLY.x, 8, 9], [DLY.x, DLY.y, 9], [DLY.x, DLY.y, DLY.z0 - 2]], 2.6, { sharp: true });
const VEN = route([[DLY.x, DLY.y, DLY.z1 + 2], [DLY.x, DLY.y, DLY.z1 + 12], [CH[0], CH[1], DLY.z1 + 12], [CH[0], CH[1], CH[2] + 30], [CH[0], CH[1], CH[2] - 2], [CH[0], CH[1], 22], [CH[0], 14, 14], [92, 40, 16], [62, 48, 40], [50, 58, 50], NEEDLE_V], 2.6);
const DIA_IN = route([[MC.x + MC.w - 8, YF + 1, 66], [100, YF + 5, 66], [112, 4, 68], [DLY.x, DLY.y + DLY.R + 5, DLY.z1 - 8]], 2.0);
const DIA_OUT = route([[DLY.x, DLY.y + DLY.R + 5, DLY.z0 + 8], [112, 8, 22], [100, YF + 5, 22], [MC.x + MC.w - 8, YF + 1, 22]], 2.0);
const SAL = route([[POLE[0], POLE[1] + 1, 84], [POLE[0], POLE[1] + 1, 74], [12, YF + 8, 64], [22, YF + 5, 52]], 1.7);
const ISO = { origin: P.origin, scale: P.scale, azimuth: P.azimuth, elevation: P.elevation };
const wrapRoute = (R, cls, bias) => R.pieces.forEach((pc) => items.push({ key: G.dot3(pc.mid, V) + bias, svg: `<g class="${cls}">${T.tubeSvg(pc, { tone: "mid" })}</g>` }));
wrapRoute(ART, "t-art", 1.5); wrapRoute(VEN, "t-ven", 1.5); wrapRoute(DIA_IN, "t-dia", 1.5); wrapRoute(DIA_OUT, "t-dia t-out", 1.5); wrapRoute(SAL, "t-sal", 1.5);
items.push({ key: G.dot3([ROTOR[0], ROTOR[1], ROTOR[2]], V) + 0.6, svg: `<g id="rotor"></g>` });
items.push({ key: G.dot3([HEPC[0] + 20, HEPC[1], HEPC[2]], V) + 6.2, svg: `<g id="plunger"></g>` });
items.push({ key: G.dot3([CH[0], CH[1], CH[2] + 14], V) + 3.5, svg: `<g id="chamber"></g>` });

/* ---- three pressure dials: arterial (before the pump), inflow (dialysate) and venous (return) ---- */
const DIAL = [
  { id: "art", name: "Arterial pressure", a: [24, YF + 6, 56], off: [-62, -40], info: "Arterial pressure monitor. The pump pulls blood from the fistula, so this reading sits below zero. If it drops too far the access is not giving enough blood." },
  { id: "dia", name: "Inflow pressure", a: [104, YF + 5, 66], off: [-10, -64], info: "Dialysate inflow pressure monitor. It confirms dialysate is reaching the dialyser at a steady pressure." },
  { id: "ven", name: "Venous pressure", a: [CH[0], CH[1], CH[2] + 44], off: [60, -64], info: "Venous pressure monitor, on the line that returns blood. A rise warns of a clot or a kinked line; a sudden fall warns that the needle may have come out." },
].map((d) => { const q = at(d.a); return { ...d, x: q[0] + d.off[0], y: q[1] + d.off[1], ax: q[0], ay: q[1] }; });
const dials = DIAL.map((d) => {
  let s = `<g class="hot dr-dial" tabindex="0" data-info="${esc(d.info)}"><path class="dr-leader" d="M${f1(d.ax)} ${f1(d.ay)}L${f1(d.x)} ${f1(d.y)}"/><circle class="dr-dot" cx="${f1(d.ax)}" cy="${f1(d.ay)}" r="1.6"/><circle class="dr-bez" cx="${f1(d.x)}" cy="${f1(d.y)}" r="15"/><circle class="dr-face" cx="${f1(d.x)}" cy="${f1(d.y)}" r="12"/>`;
  s += `<path class="dr-ok" d="${arcD(d.x, d.y, 9.6, -22, 22)}"/>`;
  for (let a = -60; a <= 60; a += 20) { const r = a * Math.PI / 180; s += `<path class="dr-tick" d="M${f1(d.x + 10.4 * Math.sin(r))} ${f1(d.y - 10.4 * Math.cos(r))}L${f1(d.x + 12 * Math.sin(r))} ${f1(d.y - 12 * Math.cos(r))}"/>`; }
  s += `<g id="nd-${d.id}" transform="rotate(0 ${f1(d.x)} ${f1(d.y)})"><path class="dr-needle" d="M${f1(d.x)} ${f1(d.y + 2)}L${f1(d.x)} ${f1(d.y - 10.5)}"/></g><circle class="dr-hub" cx="${f1(d.x)}" cy="${f1(d.y)}" r="1.7"/>`;
  const lw = d.name.length * 5.9 + 12; s += `<rect class="dr-lab-r" x="${f1(d.x - lw / 2)}" y="${f1(d.y + 17)}" width="${f1(lw)}" height="15" rx="7.5"/><text class="dr-dl" x="${f1(d.x)}" y="${f1(d.y + 27.5)}" text-anchor="middle">${esc(d.name)}</text></g>`;
  return s;
}).join("");
items.sort((a, b) => a.key - b.key);
const art = items.map((i) => i.svg).join("");

/* ---- labels: small pills tied to a part by a short leader ---- */
const LAB = [
  ["Arterial line", [24, 40, 60], [-58, -6], "Arterial line: blood from the arm to the dialyser. It is called arterial because blood leaves the patient, not because of the vessel it comes from."],
  ["Venous line", [92, 40, 16], [0, 26], "Venous line: cleaned blood going back to the patient's vein. Pressure here is watched, because a rise can mean a clot or a kinked line."],
  ["Blood pump", [ROTOR[0], ROTOR[1], ROTOR[2] - 12], [0, 36], "Blood pump. It sets how fast blood goes through the circuit."],
  ["Heparin", [HEPC[0] + 36, HEPC[1], HEPC[2]], [-46, 34], "Heparin syringe pump: a slow drip of anticoagulant into the circuit."],
  ["Dialyser", [DLY.x + DLY.R, DLY.y, 50], [40, 0], "Hollow-fibre dialyser: where blood and dialysate meet across the membrane."],
  ["Air trap", [CH[0], CH[1], CH[2] + 32], [32, -14], "Air trap and air detector on the venous line."],
  ["Saline", [POLE[0], POLE[1], 98], [30, -4], "Saline bag: primes the circuit and can top up blood volume."],
  ["Fistula", [NEEDLE_A[0] + 10, NEEDLE_A[1] + 2, 52], [-12, 34], "The AV fistula: the access to the blood."],
  ["Dialysate out", [112, 8, 22], [64, 30], "Used dialysate, carrying urea, potassium and extra water, back to the machine and on to drain."],
];
let labels = "";
LAB.forEach(([t, w, off, info]) => {
  const [x, y] = at(w), lw = t.length * 6.4 + 14, tx = x + off[0], ty = y + off[1];
  labels += `<g class="hot dr-lab" tabindex="0" data-info="${esc(info)}"><path class="dr-leader" d="M${f1(x)} ${f1(y)}L${f1(tx)} ${f1(ty + 8)}"/><circle class="dr-dot" cx="${f1(x)}" cy="${f1(y)}" r="1.6"/><rect class="dr-lab-r" x="${f1(tx - lw / 2)}" y="${f1(ty - 8)}" width="${f1(lw)}" height="17" rx="8.5"/><text class="dr-lab-t" x="${f1(tx)}" y="${f1(ty + 4)}" text-anchor="middle">${esc(t)}</text></g>`;
});

/* ---- the cut-away: one fibre, enlarged ---- */
const IN = { x: 244, y: 12, w: 500, h: 204 };
const FIB = { x0: 268, x1: 722, topWall: 100, botWall: 156, lumTop: 104, lumBot: 152 };
const inset = (() => {
  let s = `<rect class="dr-panel" x="${IN.x}" y="${IN.y}" width="${IN.w}" height="${IN.h}" rx="14"/>`;
  s += `<text class="dr-pt" x="${IN.x + 16}" y="${IN.y + 24}">Inside one hollow fibre</text><text class="dr-ps" x="${IN.x + IN.w - 16}" y="${IN.y + 24}" text-anchor="end">enlarged many times</text>`;
  s += `<rect class="dr-dband" x="${FIB.x0}" y="${IN.y + 38}" width="${FIB.x1 - FIB.x0}" height="${FIB.topWall - IN.y - 38}" rx="6"/><rect class="dr-dband" x="${FIB.x0}" y="${FIB.botWall + 6}" width="${FIB.x1 - FIB.x0}" height="${IN.y + IN.h - 34 - FIB.botWall - 6}" rx="6"/>`;
  s += `<rect class="dr-lumen" x="${FIB.x0}" y="${FIB.lumTop}" width="${FIB.x1 - FIB.x0}" height="${FIB.lumBot - FIB.lumTop}"/>`;
  const wall = (y) => { let d = "", parts = ""; for (let x = FIB.x0; x < FIB.x1; x += 14) { d += `M${x} ${y}h9`; parts += `<circle class="dr-pore" cx="${x + 11.5}" cy="${y}" r="1.8"/>`; } return `<path class="dr-wall" d="${d}"/>${parts}`; };
  s += wall(FIB.topWall) + wall(FIB.botWall);
  s += `<g class="hot" tabindex="0" data-info="Semipermeable membrane: a wall full of tiny pores. Small molecules (urea, potassium, creatinine) pass through them; blood cells and large proteins such as albumin cannot. Water follows pressure through the same pores."><rect x="${FIB.x0}" y="${FIB.topWall - 6}" width="${FIB.x1 - FIB.x0}" height="12" fill="transparent"/><rect x="${FIB.x0}" y="${FIB.botWall - 6}" width="${FIB.x1 - FIB.x0}" height="12" fill="transparent"/></g>`;
  s += `<text class="dr-pt2" x="${FIB.x0 + 4}" y="${FIB.topWall - 5}">membrane</text>`;
  s += `<text class="dr-pt2" x="${FIB.x1 - 4}" y="${IN.y + 52}" text-anchor="end" id="dtxt"></text>`;
  s += `<text class="dr-pt2" x="${FIB.x0 + 4}" y="${FIB.lumBot - 4}" id="btxt">blood flows this way</text>`;
  s += `<g id="fibre-live"></g>`;
  const chip = (x, id, label) => `<g transform="translate(${x} ${IN.y + IN.h - 14})"><g id="lg-${id}"></g><text class="dr-pt2" x="12" y="3">${label}</text></g>`;
  s += chip(IN.x + 18, "rbc", "red cell") + chip(IN.x + 92, "alb", "albumin") + chip(IN.x + 166, "ure", "urea") + chip(IN.x + 224, "pot", "potassium") + chip(IN.x + 310, "bic", "bicarbonate") + chip(IN.x + 410, "wat", "water");
  return s;
})();
const zoom = (() => { const c = at([DLY.x, DLY.y + DLY.R, (DLY.z0 + DLY.z1) / 2]); return `<path class="dr-beam" d="M${f1(c[0] - 20)} ${f1(c[1] - 8)}L${IN.x + 30} ${IN.y + IN.h}M${f1(c[0] + 20)} ${f1(c[1] - 8)}L${IN.x + IN.w - 30} ${IN.y + IN.h}"/><ellipse class="dr-beam-c" cx="${f1(c[0])}" cy="${f1(c[1] - 8)}" rx="24" ry="9"/>`; })();
const PT = { x: 758, y: 12, w: 192, h: 204 };
const gauges = (() => {
  let s = `<rect class="dr-panel" x="${PT.x}" y="${PT.y}" width="${PT.w}" height="${PT.h}" rx="14"/><text class="dr-pt" x="${PT.x + 16}" y="${PT.y + 24}">The patient</text>`;
  [["urea", "Urea", PT.x + 36, "Urea is a waste product of protein breakdown that healthy kidneys remove. It builds up in kidney failure."], ["pot", "Potassium", PT.x + 96, "Potassium builds up when the kidneys fail and can stop the heart. Dialysis lowers it quickly."], ["flu", "Fluid", PT.x + 156, "Fluid: failing kidneys cannot pass urine, so water builds up (swelling, high blood pressure, breathlessness). Ultrafiltration removes it."]].forEach(([id, lab, x, info]) => {
    s += `<g class="hot" tabindex="0" data-info="${esc(info)}"><rect class="dr-g-tr" x="${x - 10}" y="${PT.y + 40}" width="20" height="124" rx="10"/><rect class="dr-g-fill" id="g-${id}" x="${x - 10}" y="${PT.y + 164}" width="20" height="0" rx="10"/><text class="dr-pt2" x="${x}" y="${PT.y + 182}" text-anchor="middle">${lab}</text><text class="dr-g-v" id="gv-${id}" x="${x}" y="${PT.y + 196}" text-anchor="middle"></text></g>`;
  });
  return s;
})();
const bodySvg = `<ellipse class="dr-halo" cx="480" cy="${H - 6}" rx="440" ry="12"/>${art}${dials}${labels}${zoom}${inset}${gauges}<g id="line-live"></g>`;
const SVG = k.figureSvg({ width: W, height: H, label: "A haemodialysis machine: blood from an arm fistula goes through a roller pump into a hollow-fibre dialyser, where it exchanges small molecules and water with dialysate across a membrane, then back through an air trap to the arm. Dialysate flows the opposite way and goes to drain. Three gauges show urea, potassium and fluid in the patient.", body: bodySvg, className: "dr-fig" });

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Blood flow", a: [0.6, 0.8, 1], names: ["low", "usual", "high"], ticks: ["low", "usual", "high"], start: 1 },
  drugLabel: "Dialysis setting",
  settings: [
    { label: "no dialysis", eff: 0, uf: 0, counter: true },
    { label: "haemodialysis, dialysate against the blood (counter-current)", eff: 1, uf: 0.15, counter: true },
    { label: "dialysate with the blood (co-current), less efficient", eff: 0.62, uf: 0.15, counter: false },
    { label: "haemodialysis with fluid removal (higher ultrafiltration)", eff: 1, uf: 1, counter: true },
  ],
  status: "Blood flow: {level} · {drug} ·",
  drugNames: ["no dialysis", "haemodialysis", "co-current dialysis", "haemodialysis with fluid removal"],
};
function modelOf(MD, level, drug) {
  const qb = MD.level.a[level], st = MD.settings[drug], eff = st.eff * qb;
  const U = 0.88 - 0.75 * eff, K = 0.86 - 0.66 * eff, F = 0.82 - st.uf * 0.55 * qb * (st.eff ? 1 : 0) - 0.1 * eff;
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(U, 0.35, 0.6, ["falling well", "falling slowly", "rising"]), w(K, 0.35, 0.6, ["falling well", "falling slowly", "rising"]), w(F, 0.45, 0.78, ["removed", "little change", "building up"])];
  return { U, K, F, eff, qb, st, words, readout: "urea " + words[0] + " · potassium " + words[1] + " · fluid " + words[2] };
}
if (process.argv.includes("--print-model")) { for (let l = 0; l < 3; l++) for (let d = 0; d < MD.settings.length; d++) console.log(JSON.stringify([l, d, modelOf(MD, l, d).readout])); process.exit(0); }
const TESTS = [[1, 0, "urea rising · potassium rising · fluid building up"], [1, 1, "urea falling well · potassium falling well · fluid little change"], [1, 2, "urea falling slowly · potassium falling slowly · fluid little change"], [1, 3, "urea falling well · potassium falling well · fluid removed"]];
TESTS.forEach(([l, d, t]) => { const r = modelOf(MD, l, d).readout; if (r !== t) throw new Error(`hemodialysis: model readout "${r}" != "${t}" at level ${l}, drug ${d}`); });

/* ---------------- page ---------------- */
const SCENE = { PLANE: "xz", ISO, ART: ART.screen, VEN: VEN.screen, DIN: DIA_IN.screen, DOUT: DIA_OUT.screen, SAL: SAL.screen, DIALS: DIAL.map((d) => ({ id: d.id, x: +d.x.toFixed(1), y: +d.y.toFixed(1) })), ROTOR, ROTOR_R, HEP: HEPC, CH, IN, FIB, PT, S: { level: MD.level, settings: MD.settings, drugNames: MD.drugNames, status: MD.status } };
const framed = k.plateHtml({ fig: "Fig 1", title: "Haemodialysis: a working machine", hint: "tap a part · space: pause", readout: modelOf(MD, 1, 0).readout, caption: "Schematic, not to scale. Flow, clearance and fluid removal are qualitative and illustrative; no flow rate, dose or treatment time is shown or implied.", body: `<div class="dr-svg">${SVG}</div>` });
const controls = `
<div class="dr-controls">
  <label class="dr-range"><span>${esc(MD.level.label)}</span><input id="level" type="range" min="0" max="2" step="1" value="1" aria-valuetext="${esc(MD.level.names[1])}"><span class="dr-ticks">${MD.level.ticks.map((t) => `<i>${esc(t)}</i>`).join("")}</span></label>
  <label class="dr-range"><span>${esc(MD.drugLabel)}</span><select id="drug" data-without="Without dialysis" data-with="With dialysis">${MD.settings.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")}</select></label>
  <button id="pause" type="button" aria-pressed="false">Pause motion</button>
  <button id="altview" type="button" data-href="%%ALT%%">Show simple bench view</button>
</div>
<p id="status" class="dr-status" aria-live="polite"></p>
<p id="info" class="dr-info" aria-live="polite">Hover or focus a labelled part for a one-line explanation.</p>`;
const sources = `<footer class="bio-sources">
<h2>What the figure shows, and how sure we are</h2>
<ul>
<li><strong>How haemodialysis works.</strong> Blood is pumped out of a fistula, passes through a dialyser where small solutes move across a semipermeable membrane by diffusion and water moves by pressure (ultrafiltration), and returns to the patient. Heparin stops the circuit clotting. Dialysate flows opposite to blood (counter-current) to keep the concentration gradient steep. Air detection and pressure monitoring protect the patient. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.</li>
</ul>
<p><strong>What was simplified.</strong> Convective therapies (haemofiltration, haemodiafiltration), peritoneal dialysis, catheter access, dialysate composition and temperature, bicarbonate buffering details, dialysis adequacy measures, session length and frequency, complications (hypotension, cramps, disequilibrium) and anticoagulation choices are left out. Gauge levels and the speed of change are illustrative. The setting choices are teaching toggles: no flow rates, doses or schedules are shown, and the figure does not say who should have dialysis.</p>
<p>Interactive figure built with the <a href="https://github.com/wheresryan22/anatomy">Anatomy</a> and <a href="https://github.com/Garinmckayl/anima">Anima</a> kits (MIT licence).</p>
<p>For education only; this figure is not medical advice and says nothing about any person's treatment or any medicine.</p>
</footer>`;
const script = `const SC = ${JSON.stringify(SCENE)};\nconst modelOf = ${modelOf.toString()};\n` + readFileSync(join(HERE, "dialysis.page.js"), "utf8");
const CSS = readFileSync(join(HERE, "../figure.css"), "utf8") + readFileSync(join(HERE, "dialysis.css"), "utf8");
for (const light of [false, true]) {
  const html = k.pageHtml({ title: "Haemodialysis: a working machine", theme: light ? "light" : "dark", width: W + 40, body: `<style>${BIO_CSS}${CSS}</style>${framed}${controls.replace('%%ALT%%', 'hemodialysis-simple' + (light ? '-light' : '') + '.html')}${sources}`, script });
  writeFileSync(join(ROOT, "prep/figures", "hemodialysis" + (light ? "-light" : "") + ".html"), html);
  console.log("wrote prep/figures/hemodialysis" + (light ? "-light" : "") + ".html " + html.length);
}
