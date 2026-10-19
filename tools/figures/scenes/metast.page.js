/* Metastasis scene: invasion, lymphatic and blood spread, arrival in the liver and colonisation. */
const WW = SC.W;
const layers = { tracks: $("tracks"), vessel: $("vessel"), tum: $("tum"), nodeg: $("nodeg"), colony: $("colony"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel") };
let liverO = null, nodeO = null, colMass = null, capEl = null, capDrug = -1;
let bloodTrack = null, lymphTrack = null;
/* ---- primary tumour and invading cells ---- */
const primOff = [[0, 0], [-22, -12], [20, -16], [-14, 16], [24, 10], [-34, 4], [36, -4], [-6, -28], [10, 26], [-28, 24], [30, -26], [4, -12], [-18, -22], [18, 20], [-38, -14], [42, 16]];
const prim = primOff.map(([dx, dy], i) => { const g = cell(layers.tum, { cls: "tum", r: 11 + (i % 3) * 2, nuc: 0.45, seed: i * 1.7 + 1, wob: 0.16 }); return { g, dx, dy, i }; });
const invOff = [[165, 0], [182, 0], [198, 0], [176, 0], [208, 0]];
const invaders = invOff.map(([x], i) => { const g = cell(layers.tum, { cls: "tum", r: 8, nuc: 0.45, seed: i * 2 + 9, wob: 0.18 }); return { g, x, i }; });
/* ---- node and colony cells ---- */
const nodeOff = [[0, 0], [-24, -10], [22, -12], [-12, 14], [18, 12], [-30, 8], [30, -2]];
const nodeCells = nodeOff.map(([dx, dy], i) => { const g = cell(layers.nodeg, { cls: "tum", r: 9 + (i % 2) * 2, nuc: 0.45, seed: i * 2.3 + 4, wob: 0.16 }); return { g, dx, dy, i }; });
const colOff = [[0, 0], [-21, -11], [19, -14], [-13, 13], [18, 11], [-29, 2], [30, -5], [-5, -21], [6, 21], [-22, 19], [27, 18], [0, -6]];
const colony = colOff.map(([dx, dy], i) => { const g = cell(layers.colony, { cls: "tum", r: 10 + (i % 3) * 2, nuc: 0.45, seed: i * 1.9 + 7, wob: 0.16 }); return { g, dx, dy, i }; });
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vessel); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(300, 690), y: rnd(314, 350), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, x: 0, y: 0, vx: 0 }; }); }
const ctcs = pool(20, () => { const g = mk("g", {}, layers.parts); const c = cell(g, { cls: "tum", r: 6, nuc: 0.45, seed: Math.random() * 9, wob: 0.18 }); return g; });
const lymphCells = pool(12, () => { const g = mk("g", {}, layers.parts); const c = cell(g, { cls: "tum", r: 5.5, nuc: 0.45, seed: Math.random() * 9, wob: 0.18 }); return g; });
const drugs = pool(16, () => mk("path", { class: "p-drug", d: "M-4 0H4M0 -4V4" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, u) { p.on = true; p.u = u; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d) {
  if (d === 1) return "Surgery removes the first tumour. The liver colony remains.";
  if (d === 2) return "Radiotherapy shrinks the first tumour. It does not reach the liver colony.";
  if (d === 3) return "Systemic therapy travels in the blood. It kills travelling cells and shrinks the liver colony.";
  return "No treatment. Cells leave the first tumour, travel in blood and lymph, and seed a colony in the liver.";
}
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [120, 280, 440, 600, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cancer";
  [["pri", "Primary", "g-tum", "The first tumour where the cancer started. Surgery and radiotherapy act here."], ["inv", "Invasion", "g-tum", "Tumour cells pushing through the basement membrane and into nearby tissue."], ["nod", "Nodes", "g-node", "Tumour in nearby lymph nodes, reached through lymph channels."], ["cir", "Circulating", "g-tum", "Circulating tumour cells travelling in the blood. Most die; a few survive."], ["dis", "Distant", "g-dist", "A new colony growing in the liver after leaving the vessel."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over, midL = lymphTrack.at(0.45);
  pill(ox, "First tumour", 150, 168, 150, 92, "First tumour: the original growth. Its cells can detach and invade nearby tissue.");
  pill(ox, "Invasion", 200, 242, 140, 398, "Invasion: tumour cells push through the basement membrane into nearby tissue and vessels.");
  pill(ox, "Lymph spread", midL.x, midL.y, 330, 58, "Lymph spread: tumour cells travel in lymph channels to nearby lymph nodes, often before blood spread.");
  pill(ox, "Lymph node", nodeO.x + 20, nodeO.y - 10, 600, 60, "A nearby lymph node. Tumour cells arriving in lymph can settle and grow here.");
  pill(ox, "Blood spread", 500, 330, 500, 398, "Blood spread: circulating tumour cells travel in the blood. Most are lost; some survive and reach the liver.");
  pill(ox, "Liver", liverO.x, liverO.y - 0.3 * liverO.h, 810, 88, "The liver, a distant organ reached through the blood. Its tissue can suit the tumour cell (seed and soil).");
  pill(ox, "New colony", liverO.ports.lobe[0], liverO.ports.lobe[1], 882, 330, "A new colony: a surviving cell grows into a tumour in the liver. Many settled cells never grow.");
  capEl = mk("text", { class: "mt-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
function initStatic() {
  /* basement membrane and healthy surface layer */
  mk("line", { class: "mt-bm", x1: 40, y1: 235, x2: 260, y2: 235 }, layers.tracks);
  for (let i = 0; i < 7; i++) cell(layers.tracks, { cls: "norm", r: 11, nuc: 0.35, seed: i * 1.4 + 2, wob: 0.08, x: 55 + i * 32, y: 128 });
  /* blood vessel */
  mk("rect", { class: "mt-vessel", x: 285, y: 302, width: 415, height: 60, rx: 30 }, layers.vessel);
  /* surgery marks: dashed cut around the tumour bed plus suture ticks */
  mk("ellipse", { id: "cut", class: "mt-cut", cx: 150, cy: 185, rx: 62, ry: 52, opacity: "0" }, layers.treat);
  const sut = mk("g", { id: "sutures", opacity: "0" }, layers.treat);
  mk("path", { class: "mt-suture", d: "M112 208l14 12M126 208l-14 12M158 212l14 12M172 212l-14 12" }, sut);
  /* radiotherapy marks: beams plus a glow on the tumour */
  mk("ellipse", { id: "radGlow", class: "mt-glow", cx: 150, cy: 185, rx: 58, ry: 48, opacity: "0" }, layers.treat);
  const beams = mk("g", { id: "beams", opacity: "0" }, layers.treat);
  mk("path", { class: "mt-beam", d: "M232 78L168 172M252 96L176 178M242 64L160 160" }, beams);
}
function initOrgans() {
  nodeO = organ($("nodeSlot"), "lymphnode", 525, 115, 120, {});
  liverO = organ($("liverSlot"), "liver", 825, 195, 180, {});
  const NP = nodeO.ports.in, LP = liverO.ports.porta;
  $("lymphPath").setAttribute("d", "M205 160C290 95 380 82 " + f1(NP[0]) + " " + f1(NP[1]));
  $("lymphPathIn").setAttribute("d", "M205 160C290 95 380 82 " + f1(NP[0]) + " " + f1(NP[1]));
  $("arrPath").setAttribute("d", "M700 332C725 322 738 308 " + f1(LP[0]) + " " + f1(LP[1]));
  bloodTrack = track([[310, 332], [480, 332], [640, 332], [702, 328], [740, 310], LP]);
  lymphTrack = track([[205, 160], [290, 98], [375, 84], NP]);
  const LB = liverO.ports.lobe;
  colMass = mk("ellipse", { cx: f1(LB[0]), cy: f1(LB[1]), rx: 36, ry: 30 }, layers.colony);
  colMass.setAttribute("style", "fill:var(--c-tum)");
  colMass.setAttribute("opacity", "0.3");
}
const sm = { P: 0.9, I: 0.5, L: 0, C: 0, D: 0, surg: 0, sys: 0, rad: 0 };
const acc = { ctc: 0, lymph: 0, drug: 0 };
function init() { initOrgans(); initStatic(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.P = lerp(sm.P, m.P, k); sm.I = lerp(sm.I, m.I, k); sm.L = lerp(sm.L, m.L, k); sm.C = lerp(sm.C, m.C, k); sm.D = lerp(sm.D, m.D, k); sm.surg = lerp(sm.surg, m.surg, k); sm.sys = lerp(sm.sys, m.sys, k); sm.rad = lerp(sm.rad, m.rad, k);
  prim.forEach((c) => place(c.g, 150 + c.dx, 185 + c.dy + Math.sin(tm / 700 + c.i) * 1.5, Math.sin(tm / 900 + c.i) * 8, Math.max(0.05, sm.P)));
  invaders.forEach((c) => { const y = lerp(214, 256, clamp(sm.I * 1.1 - c.i * 0.07)); place(c.g, c.x, y, Math.sin(tm / 500 + c.i) * 10, Math.max(0.05, sm.I)); c.g.style.opacity = sm.I > 0.08 ? 1 : 0; });
  nodeCells.forEach((c) => place(c.g, nodeO.x + c.dx, nodeO.y + c.dy, 0, Math.max(0.04, sm.L)));
  const LB = liverO.ports.lobe;
  colMass.setAttribute("opacity", (0.3 * sm.D).toFixed(2));
  colony.forEach((c) => place(c.g, LB[0] + c.dx, LB[1] + c.dy + Math.sin(tm / 800 + c.i) * 1.2, 0, Math.max(0.04, sm.D)));
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 695) r.x = 295; place(r.g, r.x, r.y, r.rot, 1); });
  /* lymph channel runs dry as nodes clear */
  $("lymphPath").setAttribute("opacity", (0.15 + 0.55 * sm.L).toFixed(2));
  $("lymphPathIn").setAttribute("opacity", (0.25 + 0.55 * sm.L).toFixed(2));
  /* circulating tumour cells along the blood route; systemic therapy kills them on the way */
  acc.ctc += dt * sm.C * 3.2; while (acc.ctc >= 1) { acc.ctc--; const p = freeP(ctcs); if (p) emitP(p, 0); }
  ctcs.forEach((p) => { if (!p.on) return; p.u += dt * 0.11; if (p.u >= 1) { killP(p); return; } const pt = bloodTrack.at(p.u); place(p.e, pt.x, pt.y, pt.a, Math.max(0.05, 1 - 0.85 * sm.sys * p.u)); p.e.setAttribute("opacity", (1 - 0.9 * sm.sys * p.u).toFixed(2)); });
  /* lymphatic cells to the node; systemic therapy thins them too */
  acc.lymph += dt * sm.L * 2.6; while (acc.lymph >= 1) { acc.lymph--; const p = freeP(lymphCells); if (p) emitP(p, 0); }
  lymphCells.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; if (p.u >= 1) { killP(p); return; } const pt = lymphTrack.at(p.u); place(p.e, pt.x, pt.y, pt.a, Math.max(0.05, 1 - 0.6 * sm.sys * p.u)); p.e.setAttribute("opacity", (1 - 0.7 * sm.sys * p.u).toFixed(2)); });
  /* systemic therapy particles streaming in the vessel */
  acc.drug += dt * sm.sys * 7; while (acc.drug >= 1) { acc.drug--; const p = freeP(drugs); if (p) { p.on = true; p.x = 292; p.y = rnd(314, 350); p.e.setAttribute("opacity", "1"); } }
  drugs.forEach((p) => { if (!p.on) return; p.x += 85 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 4) + ")"); if (p.x > 698) killP(p); });
  /* treatment marks */
  $("cut").setAttribute("opacity", sm.surg.toFixed(2)); $("sutures").setAttribute("opacity", sm.surg.toFixed(2));
  $("beams").setAttribute("opacity", (sm.rad * (0.55 + 0.45 * Math.sin(tm / 90))).toFixed(2));
  $("radGlow").setAttribute("opacity", (sm.rad * (0.18 + 0.12 * Math.sin(tm / 130))).toFixed(2));
  gg.pri.set(sm.P, wordOf(sm.P, 0.2, 0.6, ["low", "reduced", "present"])); gg.inv.set(sm.I, wordOf(sm.I, 0.3, 0.65, ["none", "early", "active"]));
  gg.nod.set(sm.L, wordOf(sm.L, 0.2, 0.6, ["clear", "some", "involved"])); gg.cir.set(sm.C, wordOf(sm.C, 0.2, 0.6, ["none", "few", "many"])); gg.dis.set(sm.D, wordOf(sm.D, 0.15, 0.5, ["none", "seeded", "established"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
