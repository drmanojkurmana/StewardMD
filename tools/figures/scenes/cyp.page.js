/* CYP scene: parent drug oxidised by CYP enzymes in a liver cell; inducers add enzyme, inhibitors block it. */
const WW = SC.W;
const layers = { cyp: $("cypnodes"), parts: $("parts"), rbcs: $("rbcs"), over: $("over"), panel: $("panel") };
/* ---- CYP enzyme nodes on the endoplasmic reticulum ---- */
const cypPos = [[300, 195], [390, 182], [480, 198], [570, 180]];
const cypNodes = cypPos.map(function (p, i) {
  const g = mk("g", {}, layers.cyp);
  mk("circle", { class: "cy-cyp", r: 18, cx: 0, cy: 0 }, g);
  mk("circle", { class: "cy-cypin", r: 8, cx: -3, cy: -3 }, g);
  const plug = mk("g", { opacity: "0" }, g);
  mk("rect", { class: "cy-inh", x: -13, y: -5, width: 26, height: 10, rx: 5 }, plug);
  return { g: g, plug: plug, x: p[0], y: p[1], i: i };
});
/* ---- red cells in the bloodstream ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g: g, x: rnd(0, WW), y: rnd(368, 402), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const parents = pool(20, function () { return mk("circle", { class: "sc-p p-parent", r: 5 }, layers.parts); });
const mets = pool(20, function () { return mk("path", { class: "sc-p p-met", d: "M0 -5L5 0L0 5L-5 0Z" }, layers.parts); });
const inds = pool(12, function () { return mk("path", { class: "sc-p p-ind", d: "M0 -5L5 4L-5 4Z" }, layers.parts); });
const inhs = pool(10, function () { return mk("rect", { class: "sc-p p-inh", x: -5, y: -3, width: 10, height: 6, rx: 3 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["enz", "Enzyme", "g-enz", "Cytochrome P450 enzyme activity in the liver cell. Inducers raise it, inhibitors block it."], ["clr", "Clearance", "g-clr", "How fast the parent drug is oxidised and removed. Faster clearance lowers drug levels."], ["lev", "Drug level", "g-lev", "Level of the parent drug, for example a narrow therapeutic index drug such as warfarin."], ["eff", "Effect", "g-eff", "Effect of the parent drug. It falls when an inducer lowers the level and rises when an inhibitor raises it."], ["tox", "Toxicity", "g-tox", "Risk of harm from too high a drug level. Inhibitors raise this risk."], ["pro", "Prodrug", "g-pro", "Activation of a prodrug, which needs CYP oxidation to become active. Inhibitors reduce activation, inducers increase it."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Liver cell", 220, 132, 140, 85, "Liver cell (hepatocyte). Most CYP drug oxidation happens here.");
  pill(ox, "CYP enzymes", 390, 182, 390, 85, "Cytochrome P450 enzymes on the endoplasmic reticulum. They oxidise the parent drug.");
  pill(ox, "Inducer", 648, 138, 760, 85, "An inducer, such as rifampicin, carbamazepine or phenytoin, makes the liver produce more CYP enzyme. Clearance speeds up.");
  pill(ox, "Inhibitor", 700, 205, 880, 85, "An inhibitor, such as a macrolide, an azole antifungal or grapefruit, blocks CYP enzyme. Clearance slows down.");
  pill(ox, "Parent drug", 55, 210, 75, 255, "Parent drug arriving at the liver cell, for example a narrow therapeutic index drug such as warfarin.");
  pill(ox, "Metabolite", 520, 330, 640, 320, "Metabolite: the oxidised product. It usually leaves in the blood for removal. For a prodrug, the metabolite is the active form.");
  pill(ox, "Blood vessel", 880, 355, 880, 330, "Bloodstream. Parent drug arrives and metabolite leaves in the blood.");
}
const sm = { E: 0.5, Clear: 0.5, Lev: 0.52, Tox: 0.18, Prod: 0.48, ind: 0, inh: 0 };
const acc = { par: 0, ind: 0, inh: 0 };
function init() { initRbc(); initPanel(); cypNodes.forEach(function (c) { place(c.g, c.x, c.y, 0, 1); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k2); sm.Clear = lerp(sm.Clear, m.Clear, k2); sm.Lev = lerp(sm.Lev, m.Lev, k1); sm.Tox = lerp(sm.Tox, m.Tox, k2); sm.Prod = lerp(sm.Prod, m.Prod, k2); sm.ind = lerp(sm.ind, m.ind, k1); sm.inh = lerp(sm.inh, m.inh, k1);
  /* CYP nodes grow with enzyme activity, plugs appear with inhibitor */
  cypNodes.forEach(function (c, i) { const s = 0.65 + 0.6 * sm.E + 0.05 * Math.sin(tm / 400 + i); place(c.g, c.x, c.y, Math.sin(tm / 900 + i) * 5, s); c.plug.setAttribute("opacity", sm.inh.toFixed(2)); });
  /* red cells flow in the vessel */
  rbcs.forEach(function (r) { r.x += r.v * 55 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(368, 402); } place(r.g, r.x, r.y, r.rot, 1); });
  /* parent drug enters from the left and crosses the liver cell */
  acc.par += dt * 1.6; while (acc.par >= 1) { acc.par--; const p = freeP(parents); if (p) emit(p, 24, rnd(185, 255), rnd(52, 68), 0, 0); }
  parents.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += Math.sin(tm / 500 + p.t) * 4 * dt; p.y = clamp(p.y, 130, 320);
    if (!p.k && p.x > 280 && Math.random() < dt * sm.Clear * 2.2) { p.k = 1; const q = freeP(mets); if (q) emit(q, p.x, p.y, rnd(18, 30), rnd(34, 48), 0); kill(p); return; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW - 20) kill(p); });
  /* metabolites drift down to the vessel, then flow away */
  mets.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 382) { p.y = 382; p.vy = 0; p.vx = 70; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > WW - 16 || p.t > 9) kill(p); });
  /* inducer signals travel from the nucleus to the CYP nodes */
  acc.ind += dt * sm.ind * 4; while (acc.ind >= 1) { acc.ind--; const p = freeP(inds); if (p) emit(p, 630 + rnd(-18, 18), 272 + rnd(-12, 12), 0, 0, Math.floor(Math.random() * cypNodes.length)); }
  inds.forEach(function (p) { if (!p.on) return; const c = cypNodes[p.k], dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 55 * dt; p.y += (dy / d) * 55 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 16) kill(p); });
  /* inhibitor plugs travel from the vessel up to the CYP nodes */
  acc.inh += dt * sm.inh * 3; while (acc.inh >= 1) { acc.inh--; const p = freeP(inhs); if (p) emit(p, rnd(300, 620), 360, 0, 0, Math.floor(Math.random() * cypNodes.length)); }
  inhs.forEach(function (p) { if (!p.on) return; const c = cypNodes[p.k], dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 50 * dt; p.y += (dy / d) * 50 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 14) kill(p); });
  /* gauges */
  gg.enz.set(sm.E, wordOf(sm.E, 0.3, 0.65, ["blocked", "usual", "high"])); gg.clr.set(sm.Clear, wordOf(sm.Clear, 0.3, 0.65, ["slow", "usual", "fast"])); gg.lev.set(sm.Lev, wordOf(sm.Lev, 0.3, 0.65, ["low", "usual", "high"]));
  gg.eff.set(sm.Lev, wordOf(sm.Lev, 0.3, 0.65, ["reduced", "usual", "excessive"])); gg.tox.set(sm.Tox, wordOf(sm.Tox, 0.3, 0.6, ["low", "some", "high"])); gg.pro.set(sm.Prod, wordOf(sm.Prod, 0.3, 0.65, ["low", "usual", "high"]));
}
run({ init: init, step: step });
