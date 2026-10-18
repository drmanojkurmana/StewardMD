/* Diabetes scene: beta cells under autoimmune attack or strain, insulin and glucose in the blood, liver output and uptake by muscle and fat. */
const L = { rbcs: $("rbcs"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
const VY = 309;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const insP = pool(30, () => mk("circle", { class: "sc-p p-ins", r: 3 }, L.parts));
const gluP = pool(38, () => mk("circle", { class: "sc-p p-glu", r: 3.2 }, L.parts));
/* red cells in the bloodstream */
const rbcs = [];
for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); rbcs.push({ g, x: rnd(20, 940), y: rnd(292, 326), v: rnd(0.8, 1.2) }); }
/* beta cells inside the islet */
const betaPos = [[171, 187], [148, 168], [194, 168], [148, 206], [194, 206], [171, 158], [171, 216], [132, 187], [210, 187], [158, 187], [184, 196], [164, 172]];
const betas = betaPos.map(([x, y], i) => { const g = cell(L.cells, { cls: "bcell", r: 10, nuc: 0.35, seed: i + 3, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
/* immune T cells around the islet */
const tcells = [[106, 138], [236, 138], [106, 236], [236, 236]].map(([x, y], i) => { const g = cell(L.cells, { cls: "lymph", r: 13, nuc: 0.5, seed: i + 30, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y, ph: i * 1.7 }; });
/* resistance crosses over muscle and fat */
const resG = mk("g", {}, L.over);
[[640, 399], [850, 399]].forEach(([x, y]) => { mk("path", { class: "res-x", d: "M" + (x - 7) + " " + (y - 7) + "l14 14M" + (x + 7) + " " + (y - 7) + "l-14 14" }, resG); });
const gg = {};
let rxIns, rxMet, rxInc;
function initPanel() {
  const P = L.panel, y0 = 478, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What is happening";
  [["beta", "Beta cells", "g-beta", "Working beta cells in the pancreas islet. Destroyed in type 1, strained then tired in type 2."], ["ins", "Insulin", "g-ins", "Insulin reaching the blood: made by beta cells, replaced by insulin treatment, boosted by incretin-based therapy when beta cells remain."], ["res", "Resistance", "g-res", "Insulin resistance in muscle, fat and liver. High in type 2, near normal in type 1."], ["liv", "Liver output", "g-glu", "Glucose released by the liver. Insulin and metformin switch it down; it stays high when insulin is missing or resisted."], ["upt", "Uptake", "g-good", "Glucose taken up by muscle and fat. Needs insulin and insulin sensitivity."], ["glu", "Blood glucose", "g-bad", "Blood glucose: raised by liver output, lowered by uptake into muscle and fat."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, 52, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Pancreas islet", 171, 129, 171, 84, "Pancreatic islet: a cluster of hormone cells in the pancreas. Its beta cells make insulin.");
  pill(o, "Beta cells", 200, 180, 365, 120, "Beta cells make and release insulin. In type 1 they are destroyed; in type 2 they first overwork, then tire.");
  pill(o, "Autoimmune attack", 118, 148, 365, 170, "In type 1 diabetes, immune cells attack and destroy beta cells. There is little attack in type 2.");
  pill(o, "Insulin", 480, 282, 480, 235, "Insulin in the blood: it switches off liver glucose output and lets muscle and fat take up glucose.");
  pill(o, "Liver", 755, 118, 755, 84, "The liver stores glucose and releases it into the blood. Insulin switches this release off.");
  pill(o, "Blood glucose", 480, 336, 480, 368, "Glucose carried in the blood. It rises when liver output is high and uptake is low.");
  pill(o, "Muscle and fat", 700, 370, 755, 352, "Muscle and fat take up glucose when insulin acts on them. In type 2 they resist insulin, so uptake falls.");
  rxIns = pill(o, "Insulin given", 360, 282, 200, 368, "Insulin treatment replaces missing insulin: it switches off liver output and restores uptake in every type.");
  rxMet = pill(o, "Metformin", 648, 180, 565, 120, "Metformin mainly lowers liver glucose output and modestly improves insulin sensitivity. It cannot replace missing insulin.");
  rxInc = pill(o, "Incretin", 228, 150, 480, 120, "Incretin-based therapy boosts insulin release when glucose is high and lowers glucagon. It needs surviving beta cells, so it helps most in early type 2.");
}
const sm = { B: 0.6, A: 0, R: 0.5, I: 0.5, H: 0.5, U: 0.3, G: 0.6, ins: 0, met: 0, inc: 0 };
const acc = { ins: 0, glu: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.B = lerp(sm.B, m.B, k); sm.A = lerp(sm.A, m.A, k); sm.R = lerp(sm.R, m.R, k); sm.I = lerp(sm.I, m.I, k); sm.H = lerp(sm.H, m.H, k); sm.U = lerp(sm.U, m.U, k); sm.G = lerp(sm.G, m.G, k); sm.ins = lerp(sm.ins, m.ins, k); sm.met = lerp(sm.met, m.met, k); sm.inc = lerp(sm.inc, m.inc, k);
  betas.forEach((b, i) => { const s = 0.25 + 0.75 * sm.B; place(b.g, b.x, b.y, 0, s); b.g.style.opacity = (0.25 + 0.75 * sm.B).toFixed(2); });
  tcells.forEach((c) => { const pull = sm.A * 16; place(c.g, c.x + Math.sin(tm / 700 + c.ph) * 3 + (171 - c.x) / 60 * pull, c.y + Math.cos(tm / 800 + c.ph) * 3 + (187 - c.y) / 60 * pull, 0, 0.4 + 0.6 * sm.A); c.g.style.opacity = (0.08 + 0.92 * sm.A).toFixed(2); });
  resG.setAttribute("opacity", (sm.R * 0.9).toFixed(2));
  if (rxIns) rxIns.style.opacity = sm.ins.toFixed(2);
  if (rxMet) rxMet.style.opacity = sm.met.toFixed(2);
  if (rxInc) rxInc.style.opacity = sm.inc.toFixed(2);
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 950) r.x = 12; place(r.g, r.x, r.y, Math.sin(tm / 600 + r.x) * 8, 1); });
  /* insulin: from the islet down to the blood, then along it; replaced insulin enters the blood directly */
  acc.ins += dt * sm.I * 9; while (acc.ins >= 1) { acc.ins--; const p = free(insP); if (p) { if (sm.ins > 0.4 && Math.random() < 0.6) emit(p, rnd(330, 430), 282, 0, 26, 2); else emit(p, 171 + rnd(-18, 18), 248, rnd(-4, 4), 30, 0); } }
  insP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y >= VY) { p.k = 1; p.y = VY; } }
    else if (p.k === 2) { p.y += p.vy * dt; if (p.y >= VY) { p.k = 1; p.y = VY; } }
    else { p.x += 62 * dt; p.y = VY + Math.sin(tm / 300 + p.x / 40) * 6; if (p.x > 900 || p.t > 9) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 18, 942)) + " " + f1(clamp(p.y, 56, 428)) + ")"); });
  /* glucose: out of the liver into the blood, along it, and down into muscle and fat when uptake allows */
  acc.glu += dt * (0.25 + sm.H * 8 + sm.G * 2); while (acc.glu >= 1) { acc.glu--; const p = free(gluP); if (p) emit(p, 755 + rnd(-24, 24), 242, rnd(-4, 4), 26, 0); }
  gluP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y >= VY) { p.k = 1; p.y = VY; } }
    else if (p.k === 1) { p.x -= 58 * dt; p.y = VY + Math.cos(tm / 340 + p.x / 50) * 6; const inTissue = (p.x > 610 && p.x < 740) || (p.x > 780 && p.x < 920); if (inTissue && Math.random() < dt * sm.U * 1.6) p.k = 2; if (p.x < 24 || p.t > 11) kill(p); }
    else { p.y += 34 * dt; if (p.y > 366) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 18, 942)) + " " + f1(clamp(p.y, 56, 428)) + ")"); });
  gg.beta.set(sm.B, wordOf(sm.B, 0.25, 0.6, ["few left", "reduced", "working"])); gg.ins.set(sm.I, wordOf(sm.I, 0.25, 0.6, ["low", "reduced", "high"]));
  gg.res.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["low", "raised", "high"])); gg.liv.set(sm.H, wordOf(sm.H, 0.3, 0.6, ["low", "raised", "high"]));
  gg.upt.set(sm.U, wordOf(sm.U, 0.3, 0.55, ["low", "reduced", "good"])); gg.glu.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["controlled", "raised", "high"]));
}
run({ init, step });
