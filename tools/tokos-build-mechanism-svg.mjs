// Builds the eight original mechanism-of-labour frames (no text inside the SVG; labels are data in
// tokos-models/explorer-mechanism.js, and every named part carries a data-part attribute).
// Run: node tools/tokos-build-mechanism-svg.mjs   (writes tokos/explorer/mechanism/NN-<id>.svg)
// Left panel: side view of the pelvis (mother's front on the left). Right panel: the view from below
// (front of the mother at the top, mother's left on the viewer's right).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 640, H = 320;
const C = {
  bg: "#f5f0e6", divider: "#d6cdbb", bone: "#dccfb4", boneLine: "#7a6a4f", ref: "#6b7785",
  head: "#eab8a2", headLine: "#5b3a2e", trunk: "#f1d0bf", mark: "#b3261e", fon: "#6b4a3d",
  soft: "#dca79c", softLine: "#8f5b52", arrow: "#1d5fa6", shoulder: "#8db4d1", shoulderLine: "#35566e",
  canal: "#fbf8f2", canalLine: "#b7ab94",
};
const r1 = (n) => Math.round(n * 10) / 10;
const rad = (d) => (d * Math.PI) / 180;

/* ---------- side view geometry: the axis of the birth canal (x, y, tangent angle in screen degrees) ---------- */
const AX = [[186, -120, 76], [182, -50, 78], [176, 20, 80], [170, 88, 96], [154, 152, 114], [126, 200, 136], [96, 240, 146], [66, 272, 148], [40, 300, 150]];
function axis(s) { // s = 0 at the top of the pelvic canal; negative s runs up into the abdomen
  const k = s + 2, i = Math.max(0, Math.min(AX.length - 2, Math.floor(k))), f = k - i, a = AX[i], b = AX[i + 1];
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, ang: a[2] + (b[2] - a[2]) * f };
}
function off(s, d) { // point at distance d from the axis toward the mother's back (negative: toward her front)
  const p = axis(s), t = rad(p.ang);
  return [p.x + Math.sin(t) * d, p.y - Math.cos(t) * d];
}
const pt = (p) => r1(p[0]) + " " + r1(p[1]);

function ribbon(s0, s1, d0, d1, n = 12) { // filled band along the axis between two offsets
  const a = [], b = [];
  for (let k = 0; k <= n; k++) { const s = s0 + ((s1 - s0) * k) / n; a.push(off(s, d0)); b.push(off(s, d1)); }
  return "M" + a.map(pt).join("L") + "L" + b.reverse().map(pt).join("L") + "Z";
}

/* ---------- the fetal head, drawn fully flexed with the trunk going up (away from the outlet) ---------- */
function head(ghost) {
  const f = ghost ? ' stroke-dasharray="5 4" opacity="0.85"' : "";
  const fill = ghost ? "none" : C.head;
  const face = "M12 -4C24 -2 36 -4 44 -12C49 -17 46 -20 40 -20C42 -26 42 -30 38 -36C34 -44 24 -44 12 -36Z";
  const shapes = `<ellipse cx="0" cy="0" rx="32" ry="30"/><path d="${face}"/>`;
  return `<g data-part="head"><g fill="${fill}" stroke="${C.headLine}" stroke-width="2.6" stroke-linejoin="round"${f}>${shapes}</g>` +
    (ghost ? "" : `<g fill="${fill}" stroke="none">${shapes}</g>` +
      `<path d="M-2 22Q4 26 10 22" fill="none" stroke="${C.fon}" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="-13" cy="23" r="3.2" fill="${C.fon}"/><path d="M12 22l3 -5l3 5l-3 5z" fill="${C.fon}"/>` +
      `<circle data-part="occiput" cx="-28" cy="8" r="6" fill="${C.mark}" stroke="#fff" stroke-width="1.4"/>` +
      `<path data-part="chin" d="M34 -38l4 -3l3 4l-4 3z" fill="${C.headLine}"/>`) + `</g>`;
}
function trunkPath(s) { // the fetal body follows the canal upward from the neck
  const pts = [];
  for (let k = s - 0.42; k >= -1.9; k -= 0.3) { const p = axis(k); pts.push(pt([p.x, p.y])); }
  const d = "M" + pts.join("L");
  return `<path d="${d}" fill="none" stroke="${C.headLine}" stroke-width="53" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${C.trunk}" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function fetusSide(s, ext, opts = {}) { // head centre at canal position s, extension ext (deg, clockwise from full flexion)
  const p = axis(s), rot = p.ang - 90, ghost = !!opts.ghost;
  const trunk = ghost || opts.noTrunk ? "" : trunkPath(s);
  return trunk + `<g transform="translate(${r1(p.x)} ${r1(p.y)}) rotate(${r1(rot)})"><g transform="rotate(${ext} 4 -28)">${head(ghost)}</g></g>`;
}
const arrowDef = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9Z" fill="${C.arrow}"/></marker></defs>`;
const arrow = (d) => `<path d="${d}" fill="none" stroke="${C.arrow}" stroke-width="3.2" stroke-linecap="round" marker-end="url(#ah)"/>`;

function pelvisSide(opt = {}) {
  const bulge = opt.bulge || 0;
  const sacrum = ribbon(0.35, 4.05, 44, 78);
  const symph = ribbon(1.9, 3.5, -44, -72, 8);
  const inlet = `<line data-part="inlet" x1="${pt(off(0.55, 44)).split(" ")[0]}" y1="${pt(off(0.55, 44)).split(" ")[1]}" x2="${pt(off(1.62, -44)).split(" ")[0]}" y2="${pt(off(1.62, -44)).split(" ")[1]}" stroke="${C.ref}" stroke-width="2" stroke-dasharray="6 5"/>`;
  const sp0 = off(2.6, -44), sp1 = off(2.6, 44);
  const spines = `<line data-part="spines" x1="${pt(sp0).split(" ")[0]}" y1="${pt(sp0).split(" ")[1]}" x2="${pt(sp1).split(" ")[0]}" y2="${pt(sp1).split(" ")[1]}" stroke="${C.ref}" stroke-width="2" stroke-dasharray="6 5"/>` +
    `<path d="M${pt(off(2.6, 44))}l-12 -7l0 14z" fill="${C.boneLine}"/>`;
  const open = opt.open || 20, tip = off(4.05, 44), pl = off(4.75, open), al = off(4.75, -open);
  const floor = `<path data-part="perineum" d="M${pt(tip)}Q${r1(tip[0] - 8)} ${r1(tip[1] + 26)} ${r1(pl[0])} ${r1(pl[1] + (opt.bulge || 0))}" fill="none" stroke="${C.soft}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="M${pt(off(3.5, -58))}Q${r1(off(4.1, -62)[0])} ${r1(off(4.1, -62)[1] + 4)} ${r1(al[0])} ${r1(al[1])}" fill="none" stroke="${C.soft}" stroke-width="10" stroke-linecap="round"/>`;
  return `<g stroke-linejoin="round">` +
    `<path data-part="sacrum" d="${sacrum}" fill="${C.bone}" stroke="${C.boneLine}" stroke-width="2.4"/>` +
    `<path data-part="symphysis" d="${symph}" fill="${C.bone}" stroke="${C.boneLine}" stroke-width="2.4"/>` +
    inlet + spines + floor + `</g>`;
}

/* ---------- view from below ---------- */
function u(theta) { const t = rad(theta); return [Math.sin(t), -Math.cos(t)]; } // occiput direction; theta from the front, toward the mother's left
function headAxial(cx, cy, theta, o = {}) {
  const [ux, uy] = u(theta), a = (Math.atan2(uy, ux) * 180) / Math.PI;
  const ghost = !!o.ghost, sc = o.scale || 1;
  const fill = ghost ? "none" : C.head, dash = ghost ? ' stroke-dasharray="5 4" opacity="0.85"' : "";
  const body = `<ellipse cx="0" cy="0" rx="${44 * sc}" ry="${34 * sc}" fill="${fill}" stroke="${C.headLine}" stroke-width="2.6"${dash}/>`;
  const marks = ghost ? "" :
    `<line x1="${-36 * sc}" y1="0" x2="${36 * sc}" y2="0" stroke="${C.fon}" stroke-width="2"/>` +
    `<path d="M${30 * sc} 0l${-7 * sc} ${-5 * sc}m${7 * sc} ${5 * sc}l${-7 * sc} ${5 * sc}" fill="none" stroke="${C.fon}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M${-30 * sc} ${-5 * sc}l${-6 * sc} ${5 * sc}l${6 * sc} ${5 * sc}l${6 * sc} ${-5 * sc}z" fill="${C.fon}" transform="translate(${52 * sc} 0)"/>` +
    `<circle data-part="occiput" cx="${34 * sc}" cy="0" r="${6 * sc}" fill="${C.mark}" stroke="#fff" stroke-width="1.4"/>`;
  return `<g data-part="head" transform="translate(${r1(cx)} ${r1(cy)}) rotate(${r1(a)})">${body}${marks}</g>`;
}
function pelvisAxial(shape) {
  const inlet = shape === "inlet";
  const rx = inlet ? 92 : 68, ry = inlet ? 70 : 90;
  return `<ellipse cx="160" cy="152" rx="${rx + 26}" ry="${ry + 24}" fill="${C.bone}" stroke="${C.boneLine}" stroke-width="2.4" opacity="0.55"/>` +
    `<ellipse data-part="${inlet ? "inlet" : "outlet"}" cx="160" cy="152" rx="${rx}" ry="${ry}" fill="${C.canal}" stroke="${C.canalLine}" stroke-width="2.4"/>` +
    `<path data-part="symphysis" d="M${160 - 26} ${152 - ry - 20}Q160 ${152 - ry - 34} ${160 + 26} ${152 - ry - 20}L${160 + 22} ${152 - ry - 4}Q160 ${152 - ry - 14} ${160 - 22} ${152 - ry - 4}Z" fill="${C.bone}" stroke="${C.boneLine}" stroke-width="2.4"/>` +
    `<path data-part="sacrum" d="M${160 - 30} ${152 + ry + 6}Q160 ${152 + ry + 44} ${160 + 30} ${152 + ry + 6}L${160 + 22} ${152 + ry - 6}Q160 ${152 + ry + 12} ${160 - 22} ${152 + ry - 6}Z" fill="${C.bone}" stroke="${C.boneLine}" stroke-width="2.4"/>` +
    `<path data-part="spines" d="M${160 - rx - 2} ${152 + 22}l14 -8l0 16zM${160 + rx + 2} ${152 + 22}l-14 -8l0 16z" fill="${C.boneLine}"/>`;
}
function shoulders(cx, cy, theta, shift = 0) { // bar whose long axis points along direction theta (same convention as u)
  const [ux, uy] = u(theta), a = (Math.atan2(uy, ux) * 180) / Math.PI;
  return `<g data-part="shoulders" transform="translate(${r1(cx)} ${r1(cy)}) rotate(${r1(a)})"><rect x="${-46 + shift}" y="-12" width="92" height="24" rx="12" fill="${C.shoulder}" stroke="${C.shoulderLine}" stroke-width="2.4"/></g>`;
}
const arc = (cx, cy, r, a0, a1) => { // arrow along a circle from bearing a0 to a1 (theta convention)
  const p0 = u(a0), p1 = u(a1), sweep = a1 > a0 ? 1 : 0, large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return arrow(`M${r1(cx + p0[0] * r)} ${r1(cy + p0[1] * r)}A${r} ${r} 0 ${large} ${sweep} ${r1(cx + p1[0] * r)} ${r1(cy + p1[1] * r)}`);
};

/* ---------- the eight frames ---------- */
// side: s = position along the canal axis, ext = extension of the head (deg), ghost = earlier pose
// below: shape of the opening, theta = occiput direction (0 front, 90 mother's left, 180 back, 270 mother's right)
export const FRAMES = [
  { id: "engagement", side: { s: 1.5, ext: 32, arrow: "M232 44L232 84" }, below: { shape: "inlet", theta: 90, y: 152 } },
  { id: "descent", side: { s: 2.5, ext: 32, ghost: { s: 1.5, ext: 32 }, arrow: "M232 84L232 124" }, below: { shape: "inlet", theta: 90, y: 172, ghost: { theta: 90, y: 140 } } },
  { id: "flexion", side: { s: 2.6, ext: 0, ghost: { s: 2.6, ext: 32 }, arrow: "curve" }, below: { shape: "inlet", theta: 90, y: 172 } },
  { id: "internal-rotation", side: { s: 3.2, ext: 0 }, below: { shape: "outlet", theta: 0, y: 156, ghost: { theta: 90, y: 156 }, turn: [90, 8] } },
  { id: "extension", side: { s: 4.0, ext: 62, ghost: { s: 3.7, ext: 0 }, arrow: "curve2", open: 30 }, below: { shape: "outlet", theta: 0, y: 176 } },
  { id: "restitution", side: { s: 5.05, ext: 100, open: 36 }, below: { shape: "outlet", theta: 45, out: true, shoulders: 135, ghost: { theta: 0 }, turn: [0, 45] } },
  { id: "external-rotation", side: { s: 5.05, ext: 100, shoulderSide: 3.6, open: 36 }, below: { shape: "outlet", theta: 90, out: true, shoulders: 180, ghost: { theta: 45 }, turn: [45, 90] } },
  { id: "expulsion", side: { s: 5.3, ext: 100, shoulderSide: 4.35, bulge: 12, open: 44 }, below: { shape: "outlet", theta: 90, out: true, shoulders: 180, up: true } },
];
export const ORDER = FRAMES.map((f) => f.id);

function sidePanel(f) {
  const sd = f.side, p = axis(sd.s);
  let g = pelvisSide({ bulge: sd.bulge, open: sd.open });
  if (sd.ghost) g += fetusSide(sd.ghost.s, sd.ghost.ext, { ghost: true });
  if (sd.shoulderSide) { // shoulder girdle seen edge-on: a long oval between the front and back of the pelvis
    const a = off(sd.shoulderSide, -34), b = off(sd.shoulderSide, 34);
    g += `<g data-part="shoulders"><path d="M${pt(a)}L${pt(b)}" stroke="${C.shoulderLine}" stroke-width="30" stroke-linecap="round"/><path d="M${pt(a)}L${pt(b)}" stroke="${C.shoulder}" stroke-width="25" stroke-linecap="round"/></g>`;
  }
  g += fetusSide(sd.s, sd.ext, { noTrunk: !!sd.shoulderSide });
  if (sd.arrow === "curve") g += arrow(`M${r1(p.x + 70)} ${r1(p.y - 58)}Q${r1(p.x + 92)} ${r1(p.y - 20)} ${r1(p.x + 62)} ${r1(p.y + 6)}`);
  else if (sd.arrow === "curve2") g += arrow(`M${r1(p.x - 62)} ${r1(p.y - 44)}Q${r1(p.x - 96)} ${r1(p.y + 4)} ${r1(p.x - 58)} ${r1(p.y + 44)}`);
  else if (sd.arrow) g += arrow(sd.arrow);
  return g;
}
function belowPanel(f) {
  const b = f.below, cx = 160;
  let g = pelvisAxial(b.shape);
  if (b.shoulders !== undefined) g += shoulders(cx, b.up ? 120 : 152, b.shoulders);
  if (b.ghost) g += headAxial(cx, b.ghost.y || (b.out ? 212 : b.y), b.ghost.theta, { ghost: true, scale: b.out ? 0.85 : 1 });
  const hy = b.out ? 212 : b.y;
  g += headAxial(cx, hy, b.theta, { scale: b.out ? 0.85 : 1 });
  if (b.turn) g += arc(cx, hy, b.out ? 56 : 62, b.turn[0], b.turn[1]);
  else if (f.id === "descent") g += arrow("M262 150L262 196");
  return g;
}

export function render(f) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" data-frame="${f.id}">${arrowDef}` +
    `<rect width="${W}" height="${H}" rx="14" fill="${C.bg}"/><line x1="320" y1="18" x2="320" y2="302" stroke="${C.divider}" stroke-width="2"/>` +
    `<g data-view="side"><clipPath id="cs"><rect x="0" y="0" width="320" height="${H}" rx="14"/></clipPath><g clip-path="url(#cs)">${sidePanel(f)}</g></g>` +
    `<g data-view="below" transform="translate(320 0)">${belowPanel(f)}</g></svg>\n`;
}
export const file = (f) => String(FRAMES.indexOf(f) + 1).padStart(2, "0") + "-" + f.id + ".svg";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "tokos", "explorer", "mechanism");
  mkdirSync(out, { recursive: true });
  for (const f of FRAMES) writeFileSync(join(out, file(f)), render(f));
  console.log("wrote " + FRAMES.length + " frames to " + out);
}
