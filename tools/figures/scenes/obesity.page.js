/* Obesity scene: energy surplus, fat cells, leptin, macrophages, fatty acids and downstream organs. */
const WW = SC.W;
const layers = { nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
const BRAIN = { x: 700, y: 115 }, ADIP = { x: 380, y: 185 };
const adipOff = [[-58, -28], [0, -48], [58, -28], [-36, 28], [36, 28]];
let adips = [], macs = [], brainG = null, liverG = null, muscleG = null, vesselG = null, intakeG = null, actG = null;
function initNodes() {
  intakeG = cell(layers.nodes, { cls: "food", r: 25, nuc: 0.35, seed: 3, wob: 0.12 }); place(intakeG, 105, 135, 0, 1);
  actG = cell(layers.nodes, { cls: "act", r: 23, nuc: 0.35, seed: 5, wob: 0.12 }); place(actG, 105, 285, 0, 1);
  adips = adipOff.map(function (o, i) { const g = cell(layers.nodes, { cls: "adip", r: 30, nuc: 0.22, seed: i * 2 + 1, wob: 0.08 }); place(g, ADIP.x + o[0], ADIP.y + o[1], 0, 0.7); return { g: g, x: ADIP.x + o[0], y: ADIP.y + o[1] }; });
  macs = [[282, 262], [478, 258], [380, 282]].map(function (p, i) { const g = cell(layers.nodes, { cls: "mac", r: 14, nuc: 0.45, seed: i * 3 + 7, wob: 0.14 }); place(g, p[0], p[1], 0, 0.4); return { g: g, x: p[0], y: p[1] }; });
  brainG = cell(layers.nodes, { cls: "brain", r: 29, nuc: 0.4, seed: 11, wob: 0.16 }); place(brainG, BRAIN.x, BRAIN.y, 0, 1);
  liverG = cell(layers.nodes, { cls: "liver", r: 29, nuc: 0.3, seed: 13, wob: 0.1 }); place(liverG, 300, 372, 0, 1);
  muscleG = cell(layers.nodes, { cls: "mus", r: 29, nuc: 0.3, seed: 17, wob: 0.1 }); place(muscleG, 510, 372, 0, 1);
  vesselG = mk("g", {}, layers.nodes);
  mk("rect", { class: "ob-vessel", x: 662, y: 354, width: 116, height: 36, rx: 18 }, vesselG);
  mk("ellipse", { class: "ob-rbc", cx: 690, cy: 372, rx: 9, ry: 5 }, vesselG);
  mk("ellipse", { class: "ob-rbc", cx: 720, cy: 372, rx: 9, ry: 5 }, vesselG);
  mk("ellipse", { class: "ob-rbc", cx: 750, cy: 372, rx: 9, ry: 5 }, vesselG);
}
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, sx: 0, sy: 0 }; }); }
const food = pool(16, function () { return mk("circle", { class: "sc-p p-food", r: 3 }, layers.parts); });
const lep = pool(18, function () { return mk("circle", { class: "sc-p p-lep", r: 2.6 }, layers.parts); });
const ffa = pool(26, function () { return mk("circle", { class: "sc-p p-ffa", r: 2.4 }, layers.parts); });
const cyt = pool(20, function () { return mk("circle", { class: "sc-p p-cyt", r: 2.3 }, layers.parts); });
const treat = pool(12, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-treat", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); return g; });
const free = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.sx = x; p.sy = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Whole body effects";
  [["fat", "Fat store", "g-fat", "Stored fat in adipose tissue. Fat cells enlarge first and can increase in number over time."], ["lepR", "Leptin resist.", "g-lepr", "Leptin from fat should curb appetite at the hypothalamus, but the brain responds less as fat rises, so the signal is resisted."], ["inf", "Inflam.", "g-cyt", "Enlarged fat cells attract macrophages. Their signals and adipokines keep adipose tissue inflamed."], ["ins", "Insulin act.", "g-ins", "How well muscle and other tissues respond to insulin. Free fatty acids and inflammation reduce this action."], ["liv", "Liver fat", "g-liv", "Fat delivered to the liver builds up there, giving fatty liver."], ["lip", "Lipids and BP", "g-lip", "Blood lipids and blood pressure tend to rise together as metabolic syndrome develops."]]
    .forEach(function (d, i) { gg[d[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, d[2], d[1], d[3]); });
  const ox = layers.over;
  pill(ox, "Intake", 105, 112, 105, 86, "Energy taken in as food and drink. When intake stays above expenditure, the surplus is stored as fat.");
  pill(ox, "Activity", 105, 262, 105, 236, "Energy expenditure through activity and body processes. Lifestyle treatment raises activity and reduces intake.");
  pill(ox, "Fat cells", 380, 128, 380, 88, "Adipocytes in adipose tissue. With a sustained energy surplus they enlarge (hypertrophy) and store more fat.");
  pill(ox, "Leptin", 545, 128, 545, 100, "Leptin is a peptide hormone from fat cells. It signals fat stores to hypothalamic and brainstem neurons, but in obesity that signal is resisted.");
  pill(ox, "Brain control", 700, 88, 700, 62, "Hypothalamus and brainstem neurons weigh leptin and other hormonal and neural signals to regulate appetite and energy balance.");
  pill(ox, "Macrophage", 282, 262, 250, 300, "Macrophages move into enlarged adipose tissue and release inflammatory signals that disturb insulin action.");
  pill(ox, "Fatty acids", 430, 278, 565, 300, "Free fatty acids and changed adipokines leave fat tissue and reach liver, muscle and blood vessels.");
  pill(ox, "Liver fat", 300, 344, 300, 325, "The liver stores extra fat arriving from adipose tissue, leading to fatty liver.");
  pill(ox, "Muscle", 510, 344, 510, 325, "Muscle responds less to insulin when fatty acids and inflammation are high, so glucose uptake falls.");
  pill(ox, "Blood lipids", 720, 344, 720, 325, "Dyslipidaemia and raised blood pressure cluster with insulin resistance in metabolic syndrome.");
}
const sm = { F: 0.4, LepR: 0.2, Inf: 0.2, Ins: 0.7, Liv: 0.2, Lip: 0.2, BP: 0.3, Intake: 0.5 };
const acc = { food: 0, lep: 0, ffa: 0, cyt: 0, treat: 0 };
function init() { initNodes(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.F = lerp(sm.F, m.F, k); sm.LepR = lerp(sm.LepR, m.LepR, k); sm.Inf = lerp(sm.Inf, m.Inf, k); sm.Ins = lerp(sm.Ins, m.Ins, k); sm.Liv = lerp(sm.Liv, m.Liv, k); sm.Lip = lerp(sm.Lip, m.Lip, k); sm.BP = lerp(sm.BP, m.BP, k); sm.Intake = lerp(sm.Intake, m.Intake, k);
  const as = 0.55 + 0.8 * sm.F;
  adips.forEach(function (a, i) { place(a.g, a.x + Math.sin(tm / 1600 + i) * 2, a.y + Math.cos(tm / 1800 + i) * 2, Math.sin(tm / 2400 + i) * 5, as); });
  macs.forEach(function (mm, i) { const s = 0.25 + 0.85 * sm.Inf; place(mm.g, mm.x + Math.sin(tm / 1300 + i * 2) * 3, mm.y + Math.cos(tm / 1500 + i) * 2, 0, s); mm.g.style.opacity = sm.Inf > 0.08 ? 1 : 0; });
  place(brainG, BRAIN.x, BRAIN.y, Math.sin(tm / 2600) * 4, 1 + 0.05 * Math.sin(tm / 500));
  brainG.style.opacity = 1;
  place(liverG, 300, 372, 0, 0.75 + 0.45 * sm.Liv);
  place(muscleG, 510, 372, 0, 0.8 + 0.3 * (1 - sm.Ins));
  if (vesselG) vesselG.style.opacity = 0.65 + 0.35 * sm.Lip;
  if (intakeG) intakeG.style.opacity = 1;
  if (actG) actG.style.opacity = 1;
  acc.food += dt * sm.Intake * 7; while (acc.food >= 1) { acc.food--; const p = free(food); if (p) emit(p, 132, 135 + rnd(-8, 8), rnd(28, 42), rnd(-4, 8), 0); }
  food.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 300) kill(p); });
  acc.lep += dt * (0.3 + sm.F) * 6; while (acc.lep >= 1) { acc.lep--; const p = free(lep); if (p) emit(p, ADIP.x + rnd(30, 70), ADIP.y - rnd(30, 55), 0, 0, 0); }
  lep.forEach(function (p) { if (!p.on) return; p.t += dt * (0.35 - 0.18 * sm.LepR); const u = clamp(p.t, 0, 1); p.x = lerp(p.sx, BRAIN.x - 18, u); p.y = lerp(p.sy, BRAIN.y + 6, u) - Math.sin(u * 3.14) * 18; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", u > 0.92 && sm.LepR > 0.55 ? "0.25" : "1"); if (p.t >= 1) kill(p); });
  acc.cyt += dt * sm.Inf * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt), mm = pick(macs); if (p && mm) emit(p, mm.x + rnd(-8, 8), mm.y + rnd(-6, 6), rnd(-14, 14), rnd(10, 24), 0); }
  cyt.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 335) kill(p); });
  const targets = [[300, 344], [510, 344], [700, 350]];
  acc.ffa += dt * (0.15 + m.FFA) * 8; while (acc.ffa >= 1) { acc.ffa--; const p = free(ffa); if (p) emit(p, ADIP.x + rnd(-50, 50), ADIP.y + rnd(45, 65), 0, 0, Math.floor(Math.random() * 3)); }
  ffa.forEach(function (p) { if (!p.on) return; p.t += dt * 0.45; const tg = targets[p.k], u = clamp(p.t, 0, 1); p.x = lerp(p.sx, tg[0], u); p.y = lerp(p.sy, tg[1], u); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t >= 1) kill(p); });
  const tr = m.drug > 0 ? 1 : 0;
  acc.treat += dt * tr * (2 + m.drug); while (acc.treat >= 1) { acc.treat--; const p = free(treat); if (p) emit(p, 30, m.drug === 3 ? 372 : 150, 55, 0, m.drug); }
  treat.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.y += ((p.k === 1 ? 260 : p.k === 2 ? 120 : 330) - p.y) * dt * 0.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (p.x > 330) kill(p); });
  gg.fat.set(sm.F, wordOf(sm.F, 0.35, 0.65, ["normal", "raised", "high"]));
  gg.lepR.set(sm.LepR, wordOf(sm.LepR, 0.3, 0.6, ["low", "some", "high"]));
  gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["low", "raised", "high"]));
  gg.ins.set(sm.Ins, wordOf(sm.Ins, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.liv.set(sm.Liv, wordOf(sm.Liv, 0.3, 0.6, ["little", "some", "much"]));
  gg.lip.set(clamp((sm.Lip + sm.BP) / 2), wordOf((sm.Lip + sm.BP) / 2, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init: init, step: step });
