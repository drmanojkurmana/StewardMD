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

/* ---------------- world ---------------- */
const BASE = { x: -200, y: -74, w: 500, d: 150, r: 10 };
const CAB = { x: 196, y: -62, w: 96, d: 126, r: 6 }, CAB_H = 84;
const ARM = { x: -200, y: -20, w: 78, d: 40, r: 16 }, ARM_H = 18;
const PUMP = { x: -108, y: -30, w: 58, d: 60, r: 6 }, PUMP_H = 14, ROTOR = [-79, 0], ROTOR_R = 17, ROTOR_Z = PUMP_H + 3;
const HEP = { x: -96, y: 38, w: 70, d: 26, r: 4 }, HEP_H = 14;
const DZ = 36, DX0 = -28, DX1 = 132, DR = 14;               // dialyser axis height, ends, radius
const CH = [166, 0];
const JF = { x: 150, y: 40, w: 26, d: 20, r: 4 }, JU = { x: 10, y: 48, w: 26, d: 20, r: 4 }, JUG_H = 30;   // fresh and used dialysate containers
const POLE = [-172, -58];                                      // saline stand                                          // drip chamber centre
const P = k.fitProjection([...k.boxCorners(BASE, -12, 0), [CAB.x + CAB.w, CAB.y + CAB.d, CAB_H + 34], [ARM.x, ARM.y, 30], [POLE[0], POLE[1], 92]], W, H - INSET_H, { pad: 8, azimuth: 66, elevation: 27 });
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
const hot = (info, inner) => `<g class="hot" tabindex="0" data-info="${esc(info)}">${inner}</g>`;

/* ---- floor ---- */
const floor = `<path class="iso-halo" d="${k.haloOf(BASE, -12, 12, P)}"/>` + S(k.slabOf(BASE, -12, 12, P, 8, 1.2), { tone: "lo" }) + L(k.planOutline(k.insetPlan(BASE, 6), 0, P), { tone: "faint" }) +
  D(k.corners(BASE, 10).map(([x, y]) => at([x, y, 0])), { size: 0.5 });
put([0, 0, -12], floor, -1e3);

/* ---- feet of the cabinet and of the stands ---- */
const stand = (plan, z0, z1, tone = "mid") => S(k.slabOf(plan, z0, z1 - z0, P, 4, 0.6), { tone });

/* ---- the patient's arm with an arteriovenous fistula ---- */
{
  let s = S(k.slabOf(ARM, 0, ARM_H, P, 10, 1.4), { tone: "hi" });
  s += L(k.planOutline(k.insetPlan(ARM, 4), ARM_H, P, 8), { tone: "faint" });
  // hand end: four finger pads
  for (let i = 0; i < 4; i++) s += S(k.slabOf({ x: ARM.x - 12 + i * 0.6, y: ARM.y + 6 + i * 7.2, w: 14, d: 5, r: 2.4 }, 0, 8, P, 4, 0.4), { tone: "hi", crease: "lo" });
  // the fistula: a vein swollen by arterial pressure, drawn as a bulge on the forearm
  s += S(k.slabOf({ x: -168, y: -9, w: 38, d: 18, r: 8 }, ARM_H, 5, P, 8, 0.8), { tone: "mid" });
  s += L(k.lineOnTop([-164, 0], [-134, 0], ARM_H + 5, P), { tone: "faint" });
  put([-160, 0, 10], hot("Arm with an arteriovenous (AV) fistula: a surgical join between an artery and a vein. The vein enlarges and thickens, so two needles can be placed for months or years and blood can be taken out and returned at a high flow.", s), 2);
}

/* ---- pipes ---- */
function route(points, r, opts = {}) {
  const smooth = opts.sharp ? points : G.fillet(points, Math.max(3, r * 2.6), 7, { P, tube: r });
  const pieces = T.tubePieces(smooth, r, P, { maxLength: opts.maxLength || 14, caps: true });
  return { smooth, pieces, screen: smooth.map((p) => at(p)) };
}
const arcPts = (cx, cy, R, z, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const t = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180; return [cx + R * Math.cos(t), cy + R * Math.sin(t), z]; });
const ART_ARC = arcPts(ROTOR[0], ROTOR[1], ROTOR_R + 5, ROTOR_Z + 1.5, 168, 12, 16);
const ART = route([[-140, -7, ARM_H + 6], [-130, -7, 28], ...G.fillet([[-130, -7, 28], [-118, -7, 28], [-112, 4, ROTOR_Z + 1.5], ART_ARC[0]], 6, 6, { P, tube: 2.6 }), ...ART_ARC, [-50, 4, ROTOR_Z + 1.5], [-42, 0, DZ - 4], [DX0 - 6, 0, DZ]], 2.6, { sharp: true });
const VEN = route([[DX1 + 6, 0, DZ], [CH[0] - 12, 0, DZ], [CH[0] - 12, 0, 60], [CH[0] - 12, 12, 62], [-110, 14, 62], [-126, 10, 40], [-136, 7, ARM_H + 6]], 2.6);
const DIA_IN = route([[JF.x + JF.w * 0.3, JF.y + JF.d / 2, JUG_H + 5], [JF.x + JF.w * 0.3, JF.y + JF.d / 2, 74], [DX1 - 14, JF.y + JF.d / 2, 74], [DX1 - 14, -2, 74], [DX1 - 14, 0, DZ + DR + 2]], 2.2);
const DIA_OUT = route([[DX0 + 12, 0, DZ + DR + 2], [DX0 + 12, 0, 82], [DX0 + 12, 46, 82], [JU.x + JU.w * 0.3, 46, 82], [JU.x + JU.w * 0.3, JU.y + JU.d / 2, JUG_H + 5]], 2.2);
const SAL = route([[POLE[0], POLE[1] + 1, 50], [POLE[0], POLE[1] + 1, 40], [-150, -30, 34], [-130, -7, 28]], 1.7);
const pushRoute = (R, centreBias = 0) => R.pieces.forEach((pc) => put(pc.mid, T.tubeSvg(pc, { tone: "mid" }), centreBias));

/* ---- blood pump (peristaltic roller pump) ---- */
{
  let s = S(k.slabOf(PUMP, 0, PUMP_H, P, 5, 0.8), { tone: "mid" });
  s += L(k.planOutline(k.insetPlan(PUMP, 3), PUMP_H, P, 5), { tone: "faint" });
  s += D(k.corners(PUMP, 5).map(([x, y]) => at([x, y, PUMP_H])), { size: 0.45 });
  // the raceway: the tube is squeezed against it by the rollers
  s += S(k.cylinder(ROTOR[0], ROTOR[1], ROTOR_R + 6, PUMP_H, 3, P, 60), { tone: "lo" });
  put([ROTOR[0], ROTOR[1], 4], hot("Blood pump (a roller pump). Rollers squeeze the soft tube against a curved track and push the blood along, like pressing toothpaste out of a tube. The pump sets the blood flow rate.", s), 0);
}

/* ---- heparin syringe pump ---- */
{
  let s = S(k.slabOf(HEP, 0, HEP_H, P, 4, 0.7), { tone: "mid" });
  s += L(k.planOutline(k.insetPlan(HEP, 3), HEP_H, P, 4), { tone: "faint" });
  const F = G.frameAlong([HEP.x + 8, HEP.y + 13, HEP_H + 6], [1, 0, 0]);
  s += S(G.solidOf([[0, 5.2], [38, 5.2], [38, 3.4], [44, 3.4]], F, P), { tone: "hi" });
  s += L(G.arcOf(F, 12, 5.2, P) + G.arcOf(F, 24, 5.2, P), { tone: "faint" });
  s += S(k.slabOf({ x: HEP.x + 4, y: HEP.y + 8, w: 5, d: 10, r: 1 }, HEP_H, 12, P, 2, 0.4), { tone: "lo" });
  put([HEP.x + 30, HEP.y + 13, 12], hot("Heparin syringe pump. Blood clots when it meets the plastic of the circuit, so a slow, steady drip of heparin (an anticoagulant) is added to the blood before the dialyser.", s), 1);
}

/* ---- dialyser ---- */
{
  const F = G.frameAlong([DX0, 0, DZ], [1, 0, 0]);
  const len = DX1 - DX0;
  const profile = [[0, 5], [3, 5], [3, 9], [8, DR - 1, 1], [12, DR], [len - 12, DR], [len - 8, DR - 1, 1], [len - 3, 9], [len - 3, 5], [len, 5]];
  let s = "";
  [14, len - 16].forEach((xo) => { s += S(k.slabOf({ x: DX0 + xo - 5, y: -9, w: 10, d: 18, r: 3 }, 0, DZ - 8, P, 3, 0.5), { tone: "lo" }); });
  s += S(G.solidOf(profile, F, P), { tone: "hi" });
  s += L(G.arcOf(F, 12, DR, P) + G.arcOf(F, len - 12, DR, P) + G.arcOf(F, 28, DR, P) + G.arcOf(F, len - 28, DR, P), { tone: "faint" });
  // a window strip showing the fibre bundle along the top
  for (let i = -5; i <= 5; i++) s += L(k.lineOnTop([DX0 + 34, i * 1.15], [DX1 - 34, i * 1.15], DZ + DR - 0.4 + (5 - Math.abs(i)) * 0.06, P), { tone: i % 2 ? "faint" : "lo" });
  // dialysate ports on top, blood ports on the end caps
  [[DX1 - 14, 74], [DX0 + 12, 80]].forEach(([x, top]) => { s += S(k.cylinder(x, 0, 3.6, DZ + DR - 1, 5, P, 20), { tone: "mid" }); s += L(k.knurl(x, 0, 3.6, DZ + DR - 1, DZ + DR + 4, 12, P), { tone: "lo" }); });
  [DX0 - 7, DX1 + 7].forEach((x) => { const Fe = G.frameAlong([x, 0, DZ], [x < 0 ? -1 : 1, 0, 0]); s += S(G.disc(0, 4, 6.4, Fe, P), { tone: "mid" }); });
  put([(DX0 + DX1) / 2, 0, DZ], hot("Hollow-fibre dialyser (the artificial kidney). Thousands of hair-thin tubes run side by side. Blood flows inside the tubes and dialysate flows around them, in the opposite direction. The tube walls are a thin semipermeable membrane.", s), 0);
}

/* ---- venous drip chamber with air detector ---- */
{
  const F = G.frameAlong([CH[0] - 12, 0, 54], [0, 0, 1]);
  let s = S(G.solidOf([[0, 4.4], [2, 7], [26, 7], [28, 4.4]], F, P), { tone: "hi" });
  s += L(G.arcOf(F, 8, 7, P) + G.arcOf(F, 19, 7, P), { tone: "faint" });
  s += S(k.slabOf({ x: CH[0] - 12 - 11, y: -4, w: 22, d: 8, r: 2 }, 62, 10, P, 3, 0.5), { tone: "lo" });
  put([CH[0] - 12, 0, 66], hot("Venous drip chamber and air detector. The returning blood passes through a small trap where bubbles rise out. A sensor stops the pump and clamps the line if any air is detected, because air in a vein can cause an air embolism.", s), 3);
}

/* ---- the machine cabinet ---- */
{
  let s = "";
  [[CAB.x + 10, CAB.y + 10], [CAB.x + CAB.w - 10, CAB.y + 10], [CAB.x + 10, CAB.y + CAB.d - 10], [CAB.x + CAB.w - 10, CAB.y + CAB.d - 10]].forEach(([x, y]) => { s += S(k.cylinder(x, y, 5, 0, 3, P, 20), { tone: "lo" }); });
  s += S(k.slabOf(CAB, 3, CAB_H - 3, P, 6, 1), { tone: "mid" });
  s += L(k.planOutline(k.insetPlan(CAB, 3), CAB_H, P, 6), { tone: "faint" });
  // top: proportioning pumps, two concentrate tanks, the conductivity cell
  const tankF = (x, y) => G.frameAlong([x, y, CAB_H], [0, 0, 1]);
  s += S(G.solidOf([[0, 9], [16, 9], [18, 7], [26, 7]], tankF(CAB.x + 24, CAB.y + 96), P), { tone: "hi" });
  s += S(G.solidOf([[0, 9], [16, 9], [18, 7], [26, 7]], tankF(CAB.x + 56, CAB.y + 96), P), { tone: "hi" });
  s += S(k.cylinder(CAB.x + 24, CAB.y + 96, 3.2, CAB_H + 26, 3, P, 18), { tone: "lo" });
  s += S(k.cylinder(CAB.x + 56, CAB.y + 96, 3.2, CAB_H + 26, 3, P, 18), { tone: "lo" });
  [[CAB.x + 22, CAB.y + 32], [CAB.x + 50, CAB.y + 32], [CAB.x + 78, CAB.y + 32]].forEach(([x, y]) => { s += S(k.cylinder(x, y, 7, CAB_H, 5, P, 28), { tone: "mid" }); s += L(k.knurl(x, y, 7, CAB_H, CAB_H + 5, 24, P), { tone: "lo" }); s += L(k.lineOnTop([x, y], [x + 6, y], CAB_H + 5, P), { tone: "hi" }); });
  put([CAB.x + CAB.w / 2, CAB.y + CAB.d / 2, CAB_H / 2], hot("Dialysis machine (the delivery system). It mixes purified water with concentrate to make dialysate of the right composition, warms it, pumps it through the dialyser, and watches pressures, flow, temperature and air for safety.", s), 0);
}


/* ---- cabinet face: a monitor with live bars, and vents ---- */
const faceY = CAB.y + CAB.d;
const faceMatrix = (x, z, w, h) => {
  const a = at([x, faceY, z]), b = at([x + w, faceY, z]), c = at([x, faceY, z + h]);
  return `matrix(${[b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]].map((v) => +v.toFixed(4)).join(" ")})`;
};
{
  const sc = { x: CAB.x + 10, z: 20, w: 76, h: 46 };
  let s = `<g transform="${faceMatrix(sc.x, sc.z, sc.w, sc.h)}"><rect class="dr-scr" x="0" y="0" width="1" height="1" rx="0.05"/>`;
  [[0.08, "bp"], [0.38, "dp"], [0.68, "cd"]].forEach(([x, id]) => { s += `<rect class="dr-scr-bar" x="${x}" y="0.2" width="0.22" height="0.6" rx="0.03"/><rect class="dr-scr-fill" id="scr-${id}" x="${x}" y="0.8" width="0.22" height="0.0" rx="0.03"/>`; });
  s += `<rect class="dr-scr-led" id="scr-led" x="0.86" y="0.07" width="0.08" height="0.1" rx="0.04"/></g>`;
  put([CAB.x + CAB.w / 2, faceY, 44], hot("Machine monitor. It shows the blood pump, the dialysate pump and the safety checks. Each bar is a live reading (arterial pressure, dialysate pressure, conductivity). The light turns amber when something is off.", s), 7);
  let f = "";
  [[CAB.x + 14, 8], [CAB.x + 28, 8]].forEach(([x, z]) => { const q = at([x, faceY, z]); f += `<circle class="dr-vent" cx="${f1(q[0])}" cy="${f1(q[1])}" r="3.2"/>`; });
  put([CAB.x + 20, faceY, 8], f, 7);
}

/* ---- fresh and used dialysate containers, each with a level window ---- */
const faceAt = (fy, x, z, w, h) => { const a = at([x, fy, z]), b = at([x + w, fy, z]), c = at([x, fy, z + h]);
  return `matrix(${[b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]].map((v) => +v.toFixed(4)).join(" ")})`; };
const jug = (J, id, info) => {
  let s = S(k.slabOf(J, 0, JUG_H, P, 3, 0.6), { tone: "hi" });
  s += S(k.cylinder(J.x + J.w * 0.3, J.y + J.d / 2, 4, JUG_H, 4, P, 20), { tone: "mid" });
  s += S(k.slabOf({ x: J.x + J.w * 0.6, y: J.y + 3, w: 9, d: J.d - 6, r: 2 }, JUG_H, 3, P, 2, 0.4), { tone: "lo" });
  s += `<g transform="${faceAt(J.y + J.d, J.x + 4, 4, J.w - 8, JUG_H - 10)}"><rect class="dr-jwin" x="0" y="0" width="1" height="1" rx="0.08"/><rect class="dr-jfill dr-j-${id}" id="jf-${id}" x="0" y="0.5" width="1" height="0.5" rx="0.08"/></g>`;
  put([J.x + J.w / 2, J.y + J.d / 2, JUG_H / 2], hot(info, s), 0.4);
};
jug(JF, "fresh", "Fresh dialysate container (standing for the machine's own mixing of purified water and concentrate). The level falls as dialysate is pumped to the dialyser.");
jug(JU, "used", "Used dialysate container (standing for the drain). It fills with the waste the blood gave up: urea, potassium and extra water.");

/* ---- saline stand: a bag on a pole, running into the arterial line ---- */
{
  let s = S(k.cylinder(POLE[0], POLE[1], 7, 0, 3, P, 24), { tone: "lo" });
  s += S(k.cylinder(POLE[0], POLE[1], 1.4, 88, 3, P, 14), { tone: "mid" });
  s += S(k.slabOf({ x: POLE[0] - 10, y: POLE[1] - 1.5, w: 20, d: 3, r: 1 }, 84, 3, P, 1, 0.3), { tone: "mid" });
  s += S(k.slabOf({ x: POLE[0] - 8, y: POLE[1] - 2.5, w: 16, d: 5, r: 2.2 }, 50, 30, P, 3, 0.5), { tone: "hi" });
  put([POLE[0], POLE[1], 64], hot("Saline bag on its stand. Salt solution runs into the arterial line to prime the circuit before dialysis starts, and can be given to top up blood volume if the pressure drops.", s), 0.5);
}

/* ---- three pressure dials: arterial (before the pump), inflow (dialysate) and venous (return) ---- */
const DIAL = [
  { id: "art", name: "Arterial pressure", a: [-42, 0, DZ - 4], off: [-6, -88], info: "Arterial pressure monitor. The pump pulls blood from the fistula, so this reading sits below zero. If it drops too far the access is not giving enough blood." },
  { id: "dia", name: "Inflow pressure", a: [DX1 - 14, 24, 74], off: [-92, 46], info: "Dialysate inflow pressure monitor. It confirms dialysate is reaching the dialyser at a steady pressure." },
  { id: "ven", name: "Venous pressure", a: [100, 13, 62], off: [56, -64], info: "Venous pressure monitor, on the line that returns blood. A rise warns of a clot or a kinked line; a sudden fall warns that the needle may have come out." },
].map((d) => { const q = at(d.a); return { ...d, x: q[0] + d.off[0], y: q[1] + d.off[1], ax: q[0], ay: q[1] }; });
const dials = DIAL.map((d) => {
  let s = `<g class="hot dr-dial" tabindex="0" data-info="${esc(d.info)}"><path class="dr-leader" d="M${f1(d.ax)} ${f1(d.ay)}L${f1(d.x)} ${f1(d.y)}"/><circle class="dr-dot" cx="${f1(d.ax)}" cy="${f1(d.ay)}" r="1.6"/><circle class="dr-bez" cx="${f1(d.x)}" cy="${f1(d.y)}" r="15"/><circle class="dr-face" cx="${f1(d.x)}" cy="${f1(d.y)}" r="12"/>`;
  s += `<path class="dr-ok" d="${arcD(d.x, d.y, 9.6, -22, 22)}"/>`;
  for (let a = -60; a <= 60; a += 20) { const r = a * Math.PI / 180; s += `<path class="dr-tick" d="M${f1(d.x + 10.4 * Math.sin(r))} ${f1(d.y - 10.4 * Math.cos(r))}L${f1(d.x + 12 * Math.sin(r))} ${f1(d.y - 12 * Math.cos(r))}"/>`; }
  s += `<g id="nd-${d.id}" transform="rotate(0 ${f1(d.x)} ${f1(d.y)})"><path class="dr-needle" d="M${f1(d.x)} ${f1(d.y + 2)}L${f1(d.x)} ${f1(d.y - 10.5)}"/></g><circle class="dr-hub" cx="${f1(d.x)}" cy="${f1(d.y)}" r="1.7"/>`;
  const lw = d.name.length * 5.9 + 12; s += `<rect class="dr-lab-r" x="${f1(d.x - lw / 2)}" y="${f1(d.y + 17)}" width="${f1(lw)}" height="15" rx="7.5"/><text class="dr-dl" x="${f1(d.x)}" y="${f1(d.y + 27.5)}" text-anchor="middle">${esc(d.name)}</text></g>`;
  return s;
}).join("");
const ISO = { origin: P.origin, scale: P.scale, azimuth: P.azimuth, elevation: P.elevation };
const wrapRoute = (R, cls, bias) => R.pieces.forEach((pc) => items.push({ key: G.dot3(pc.mid, V) + bias, svg: `<g class="${cls}">${T.tubeSvg(pc, { tone: "mid" })}</g>` }));
wrapRoute(ART, "t-art", 1.5); wrapRoute(VEN, "t-ven", 1.5); wrapRoute(DIA_IN, "t-dia", 1.5); wrapRoute(DIA_OUT, "t-dia t-out", 1.5); wrapRoute(SAL, "t-sal", 1.5);
items.push({ key: G.dot3([ROTOR[0], ROTOR[1], ROTOR_Z], V) + 0.6, svg: `<g id="rotor"></g>` });
items.push({ key: G.dot3([HEP.x + 40, HEP.y + 13, HEP_H + 8], V) + 1.2, svg: `<g id="plunger"></g>` });
items.push({ key: G.dot3([CH[0] - 12, 0, 66], V) + 3.5, svg: `<g id="chamber"></g>` });
items.sort((a, b) => a.key - b.key);
const art = items.map((i) => i.svg).join("");

/* ---- labels: small pills tied to a part by a short leader ---- */
const LAB = [
  ["Arterial line", [-110, -7, 28], [-6, -30], "Arterial line: blood from the arm to the dialyser. It is called arterial because blood leaves the patient, not because of the vessel it comes from."],
  ["Venous line", [20, 13, 62], [0, -30], "Venous line: cleaned blood going back to the patient's vein. Pressure here is watched, because a rise can mean a clot or a kinked line."],
  ["Blood pump", [ROTOR[0], ROTOR[1] - 20, PUMP_H], [-4, 34], "Blood pump. It sets how fast blood goes through the circuit."],
  ["Heparin", [HEP.x + 38, HEP.y + 26, HEP_H + 12], [10, 24], "Heparin syringe pump: a slow drip of anticoagulant into the circuit."],
  ["Dialyser", [60, 0, DZ + DR], [0, 22], "Hollow-fibre dialyser: where blood and dialysate meet across the membrane."],
    ["Air trap", [CH[0] - 12, 0, 70], [26, -22], "Air trap and air detector on the venous line."],
  ["Fresh dialysate", [JF.x + JF.w / 2, JF.y + JF.d, JUG_H - 6], [6, 26], "Fresh dialysate: clean, warm fluid with the right salts, on its way to the dialyser."],
  ["Used dialysate", [JU.x + JU.w / 2, JU.y + JU.d, JUG_H - 6], [6, 26], "Used dialysate: the same fluid after it has collected waste from the blood."],
  ["Saline", [POLE[0], POLE[1], 82], [28, -4], "Saline bag: primes the circuit and can top up blood volume."],
  ["Fistula", [-150, 0, ARM_H + 4], [-4, 40], "The AV fistula: the access to the blood."],
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
const zoom = (() => { const c = at([(DX0 + DX1) / 2, 0, DZ + DR]); return `<path class="dr-beam" d="M${f1(c[0] - 20)} ${f1(c[1] - 8)}L${IN.x + 30} ${IN.y + IN.h}M${f1(c[0] + 20)} ${f1(c[1] - 8)}L${IN.x + IN.w - 30} ${IN.y + IN.h}"/><ellipse class="dr-beam-c" cx="${f1(c[0])}" cy="${f1(c[1] - 8)}" rx="24" ry="9"/>`; })();
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
const SCENE = { ISO, ART: ART.screen, VEN: VEN.screen, DIN: DIA_IN.screen, DOUT: DIA_OUT.screen, SAL: SAL.screen, DIALS: DIAL.map((d) => ({ id: d.id, x: +d.x.toFixed(1), y: +d.y.toFixed(1) })), ROTOR: [ROTOR[0], ROTOR[1], ROTOR_Z + 0.5], ROTOR_R, HEP: [HEP.x + 8, HEP.y + 13, HEP_H + 6], CH: [CH[0] - 12, 0, 54], IN, FIB, PT, S: { level: MD.level, settings: MD.settings, drugNames: MD.drugNames, status: MD.status } };
const framed = k.plateHtml({ fig: "Fig 1", title: "Haemodialysis: a working machine", hint: "tap a part · space: pause", readout: modelOf(MD, 1, 0).readout, caption: "Schematic, not to scale. Flow, clearance and fluid removal are qualitative and illustrative; no flow rate, dose or treatment time is shown or implied.", body: `<div class="dr-svg">${SVG}</div>` });
const controls = `
<div class="dr-controls">
  <label class="dr-range"><span>${esc(MD.level.label)}</span><input id="level" type="range" min="0" max="2" step="1" value="1" aria-valuetext="${esc(MD.level.names[1])}"><span class="dr-ticks">${MD.level.ticks.map((t) => `<i>${esc(t)}</i>`).join("")}</span></label>
  <label class="dr-range"><span>${esc(MD.drugLabel)}</span><select id="drug" data-without="Without dialysis" data-with="With dialysis">${MD.settings.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")}</select></label>
  <button id="pause" type="button" aria-pressed="false">Pause motion</button>
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
  const html = k.pageHtml({ title: "Haemodialysis: a working machine", theme: light ? "light" : "dark", width: W + 40, body: `<style>${BIO_CSS}${CSS}</style>${framed}${controls}${sources}`, script });
  writeFileSync(join(ROOT, "prep/figures", "hemodialysis" + (light ? "-light" : "") + ".html"), html);
  console.log("wrote prep/figures/hemodialysis" + (light ? "-light" : "") + ".html " + html.length);
}
