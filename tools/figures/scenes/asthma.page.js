/* Asthma scene: allergen, dendritic and Th2 cells, B cell IgE, mast cell degranulation, eosinophils, mucus, smooth muscle, remodelling and gauges. */
const L = { lumen: $("lumen"), arrows: $("arrows"), mucus: $("mucus"), epi: $("epi"), base: $("base"), glands: $("glands"), vessel: $("vessel"), muscle: $("muscle"), parts: $("parts"), immune: $("immune"), marks: $("marks"), over: $("over"), panel: $("panel") };
const W = SC.W, WB = 195, MY = 370, VY = 422, EPI_N = 22, EW = 932 / EPI_N;
let wallY = WB;
/* ---- epithelium: ciliated cells, every fifth a goblet cell ---- */
const epi = [];
function initEpi() {
  for (let i = 0; i < EPI_N; i++) { const gob = i % 5 === 2, x = 14 + (i + 0.5) * EW, g = mk("g", {}, L.epi);
    cell(g, { cls: gob ? "gob" : "epi", r: gob ? 19 : 16, nuc: gob ? 0 : 0.3, seed: i, wob: 0.05, n: 8 });
    const gr = []; if (gob) for (let j = 0; j < 7; j++) gr.push(mk("circle", { class: "mg", r: 2.4, cx: f1(Math.cos(j * 0.9) * 9), cy: f1(Math.sin(j * 1.7) * 7) }, g));
    const ci = gob ? null : mk("path", { class: "cilia" }, g);
    epi.push({ g, x, gob, ci, gr, i }); }
}
const plugs = [];
function initMucus() { epi.filter((e) => e.gob).forEach((e) => { for (let j = 0; j < 2; j++) plugs.push({ e: mk("ellipse", { class: "mucus", rx: 12, ry: 6.5 }, L.mucus), x: e.x + (j - 0.5) * 15, k: j }); }); }
/* ---- basement membrane and submucosal glands and collagen (remodelling) ---- */
let baseRect = null; const colls = [], glandG = [];
function initBase() {
  baseRect = mk("rect", { class: "basem", x: 14, y: WB + 20, width: W - 28, height: 3, rx: 1.5 }, L.base);
  [[185, 300], [320, 300], [480, 300], [650, 300], [790, 300], [240, 338], [385, 338], [503, 338], [595, 338], [755, 338]].forEach(([cx, cy]) => colls.push(mk("circle", { class: "coll", r: 2.2, cx: cx, cy: cy }, L.base)));
  [[190, 300], [800, 300]].forEach(([gx, gy]) => { const g = mk("g", {}, L.glands);
    mk("circle", { class: "gland-b", r: 9, cx: 0, cy: 0 }, g);
    for (let j = 0; j < 5; j++) mk("circle", { class: "gland-b", r: 6, cx: f1(Math.cos(j * 1.26) * 11), cy: f1(Math.sin(j * 1.26) * 10) }, g);
    place(g, gx, gy, 0, 1); glandG.push(g); });
}
/* ---- smooth muscle band ---- */
const sm = [];
function initMuscle() { for (let i = 0; i < 17; i++) { const g = mk("g", {}, L.muscle); mk("ellipse", { class: "sm-c", rx: 30, ry: 9 }, g); mk("ellipse", { class: "sm-n", rx: 8, ry: 3.2 }, g); sm.push({ g, x: 40 + i * 54, y: MY + (i % 2 ? 6 : -6) }); } }
/* ---- blood vessel ---- */
function initVessel() { mk("rect", { class: "ven", x: 380, y: VY - 18, width: 500, height: 36, rx: 18 }, L.vessel);
  [0, 1, 2, 3, 4, 5, 6].forEach((i) => { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g); place(g, 410 + i * 66, VY + (i % 2 ? 4 : -4), 0, 1); }); }
/* ---- fixed immune cells ---- */
const POS = { dc: [110, 250], th2: [250, 265], b: [370, 235], m1: [530, 240], m2: [650, 275] };
const fix = {}, granules = [], ige = [];
function addFix(key, o) { const g = mk("g", {}, L.immune), c = cell(g, o); fix[key] = { g, c, x: POS[key][0], y: POS[key][1], ph: Math.random() * 6 }; return fix[key]; }
function initImmune() {
  const dc = addFix("dc", { cls: "dc", r: 17, nuc: 0.4, seed: 3, wob: 0.16 });
  for (let j = 0; j < 7; j++) { const t = j * 0.9 + 0.3; mk("path", { class: "dend", d: "M" + f1(Math.cos(t) * 14) + " " + f1(Math.sin(t) * 14) + "L" + f1(Math.cos(t) * 28) + " " + f1(Math.sin(t) * 28) }, dc.g); }
  addFix("th2", { cls: "th2", r: 13, nuc: 0.6, seed: 6 }); addFix("b", { cls: "bcell", r: 14, nuc: 0.5, seed: 7 });
  ["m1", "m2"].forEach((k, mi) => { const f = addFix(k, { cls: "mast", r: 21, nuc: 0, seed: 9 + mi, wob: 0.1 });
    for (let j = 0; j < 9; j++) granules.push({ e: mk("circle", { class: "gran", r: 2.6, cx: f1(Math.cos(j * 0.7 + mi) * 10), cy: f1(Math.sin(j * 1.9 + mi) * 9) }, f.g), mi });
    for (let j = 0; j < 6; j++) { const t = j * 1.05 + mi, y = mk("path", { class: "ige-y", d: "M0 0L0 -5M-3 -9L0 -5L3 -9", transform: "translate(" + f1(Math.cos(t) * 24) + " " + f1(Math.sin(t) * 24) + ") rotate(" + f1(t * 57.3 + 90) + ")" }, f.g); ige.push({ e: y, mi }); } });
}
/* ---- eosinophils recruited from the vessel ---- */
const mob = [];
function initMobile() { for (let i = 0; i < 7; i++) mob.push({ g: cell(L.immune, { cls: "eos", r: 11.5, nuc: 0.55, nucCls: "multi", seed: 30 + i, wob: 0.1 }), hx: 500 + i * 30 + rnd(-7, 7), hy: 285 + (i % 3) * 10, st: 0, x: 0, y: 0, i });
  mob.forEach((m) => { m.g.style.opacity = 0; place(m.g, -40, VY, 0, 0.1); }); }
/* ---- mediator flows ---- */
const T = { dc2th: [[128, 242], [190, 256], [236, 262]], il4: [[264, 258], [318, 246], [356, 238]], ige: [[384, 234], [455, 236], [508, 240]], il13: [[258, 250], [285, 215], [315, 198]], il5: [[264, 274], [400, 302], [520, 310]], hist1: [[530, 262], [530, 338]], hist2: [[650, 296], [650, 338]] };
const FLOWS = [["dc2th", "p-il4", "T2", 1.6], ["il4", "p-il4", "T2", 2.4], ["ige", "p-ige", "Ig", 3], ["il13", "p-il13", "muc", 3.2], ["il5", "p-il5", "eos", 4], ["hist1", "p-hist", "mast", 5], ["hist2", "p-hist", "mast", 4]]
  .map(([k, cls, src, rate]) => ({ k, cls, src, rate, tr: track(T[k]), acc: 0 }));
function chev(parent, a, b) { const t = Math.atan2(b[1] - a[1], b[0] - a[0]), p = (d, o) => f1(b[0] - Math.cos(t + o) * d) + " " + f1(b[1] - Math.sin(t + o) * d); return mk("path", { class: "arh", d: "M" + p(7, 0.5) + "L" + f1(b[0]) + " " + f1(b[1]) + "L" + p(7, -0.5) }, parent); }
function initArrows() { for (const k in T) { const pts = T[k]; mk("path", { class: "ar", d: "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L") }, L.arrows); chev(L.arrows, pts[pts.length - 2], pts[pts.length - 1]); } }
/* ---- particles ---- */
const parts = Array.from({ length: 130 }, () => ({ e: mk("circle", { r: 2.2, opacity: 0 }, L.parts), on: false, u: 0, f: null }));
function emitP(f) { const p = parts.find((q) => !q.on); if (!p) return; p.on = true; p.f = f; p.u = 0; p.e.setAttribute("class", "sc-p " + f.cls); p.e.setAttribute("r", f.k === "ige" ? 3 : 2.3); p.e.setAttribute("opacity", "1"); }
const trig = Array.from({ length: 20 }, () => { const e = mk("path", { opacity: 0 }, L.parts); return { e, on: false, x: 0, y: 0, vx: 0 }; });
const star = "M0 -5L1.4 -1.4L5 0L1.4 1.4L0 5L-1.4 1.4L-5 0L-1.4 -1.4Z";
/* ---- treatment marks ---- */
const MARKS = { 1: [], 2: [[250, 252], [540, 228], [332, 200]], 3: [[250, 252], [540, 228], [332, 200]], 4: [[455, 236], [530, 216]] };
const mk2 = {};
function initMarks() {
  for (const d in MARKS) { const g = mk("g", { opacity: 0 }, L.marks); mk2[d] = g;
    MARKS[d].forEach(([x, y]) => { mk("circle", { class: "blk-c", cx: x, cy: y, r: 7.5 }, g); mk("path", { class: "blk-x", d: "M" + (x - 3.6) + " " + (y - 3.6) + "l7.2 7.2M" + (x + 3.6) + " " + (y - 3.6) + "l-7.2 7.2" }, g); });
    if (+d === 1 || +d === 3) [300, 560, 820].forEach((x) => { mk("path", { class: "bd-a", d: "M" + x + " " + (MY - 26) + "l0 -10l-5 5M" + x + " " + (MY - 36) + "l5 5" }, g); mk("path", { class: "bd-a", d: "M" + (x + 14) + " " + (MY + 26) + "l0 10l-5 -5M" + (x + 14) + " " + (MY + 36) + "l5 -5" }, g); });
    if (+d === 4) mk("path", { class: "blk-y", d: "M470 250l0 -7M465 238l5 5l5 -5" }, g); }
}
/* ---- labels and gauges ---- */
const gg = {}, dpills = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The airway";
  [["eos", "Eosinophils", "g-eos", "Eosinophils in the airway wall, called in by IL-5 from Th2 cells. Their granule proteins damage the lining and keep inflammation going."], ["mast", "Mast cell", "g-mast", "Mast cell activation. IgE on the surface is cross-linked by allergen and the cell releases histamine and other mediators."], ["muc", "Mucus", "g-mucus", "Mucus from goblet cells and submucosal glands. It becomes thick in asthma and can plug the lumen."], ["bron", "Tightening", "g-bad", "Bronchoconstriction: how much the airway smooth muscle is tightening and narrowing the lumen."], ["remod", "Remodelling", "g-remod", "Remodelling of the wall with repeated inflammation: thicker basement membrane, larger muscle and glands. It reverses slowly, if at all."], ["air", "Airflow", "g-air", "How open the airway is. A reliever raises this fast but does not change the inflammation underneath."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Allergen", 620, 72, 660, 64, "Inhaled allergen such as pollen or house dust mite. It reaches the airway lining and, on re-exposure, cross-links IgE on mast cells.");
  pill(ox, "Epithelium", 140, 168, 180, 96, "The airway lining. It senses allergen and other triggers, and its cilia sweep mucus out. Eosinophil proteins can injure it.");
  pill(ox, "Goblet cell", 332, 168, 385, 96, "Goblet cells in the lining make mucus. IL-13 from Th2 cells turns them up and increases their number.");
  pill(ox, "Mucus plug", 544, 148, 570, 110, "Thick mucus sitting in the lumen. When it plugs a small airway, air cannot pass and airflow falls.");
  pill(ox, "Remodelled wall", 420, 182, 825, 96, "With repeated inflammation the wall remodels: the basement membrane thickens, smooth muscle and submucosal glands enlarge, and narrowing becomes harder to reverse fully.");
  pill(ox, "Dendritic cell", 110, 233, 110, 298, "Dendritic cell: picks up allergen at the lining and presents it to helper T cells, starting the Th2 pattern.");
  pill(ox, "Th2 cell", 250, 252, 250, 312, "Th2 helper T cell. It makes IL-4, IL-5 and IL-13, the cytokines that drive allergic airway inflammation.");
  pill(ox, "B cell", 370, 221, 385, 288, "B cell. IL-4 tells it to switch to making IgE antibody, which then arms mast cells.");
  pill(ox, "Mast cell", 548, 258, 585, 318, "Mast cell armed with IgE. Allergen cross-links the IgE and the cell degranulates, releasing histamine and other mediators that tighten muscle and swell the wall.");
  pill(ox, "Eosinophils", 640, 300, 720, 312, "Eosinophils leave the blood vessel and gather in the wall, called in by IL-5. Their granules damage the lining.");
  pill(ox, "Airway smooth muscle", 110, MY, 150, 405, "Smooth muscle around the airway. Histamine and other mediators, and IL-13, make it tighten too easily and too much, which narrows the lumen.");
  pill(ox, "Blood vessel", 410, VY, 320, 425, "Vessel that supplies the wall. Eosinophils leave from here and travel into the tissue.");
  pill(ox, "Submucosal gland", 800, 292, 875, 338, "Submucosal glands make mucus. In remodelling they enlarge and add to plugging.");
  [["il13", "IL-13", 275, 228, 190, 338, "IL-13 from Th2 cells: more mucus, more goblet cells and twitchy smooth muscle."], ["il4", "IL-4", 315, 246, 305, 338, "IL-4 from Th2 cells: pushes B cells to make IgE and helps Th2 cells grow."], ["ige", "IgE", 455, 236, 465, 338, "IgE antibody made by B cells. It sits on mast cells and waits for allergen."], ["il5", "IL-5", 430, 300, 545, 338, "IL-5 from Th2 cells: calls eosinophils in from the blood and keeps them alive."], ["hist", "Histamine", 545, 300, 660, 338, "Histamine and other mast cell mediators. They tighten smooth muscle, widen and leak small vessels, and increase mucus."]]
    .forEach(([k, n, x, y, tx, ty, tip]) => { pill(ox, n, x, y, tx, ty, tip); });
  [[1, "Reliever: muscle relaxes", 560, MY, 510, 64, "A reliever bronchodilator relaxes airway smooth muscle and opens the airway quickly. It does not treat the inflammation underneath."], [2, "Steroid: calms wall", 300, 220, 500, 64, "An inhaled corticosteroid switches off many inflammatory genes in lining, immune and mast cells, so eosinophils, mucus and twitchiness fall over time."], [3, "Steroid plus reliever", 560, MY, 505, 64, "Inhaled steroid for the inflammation plus a reliever for quick muscle relaxation: control of the cause with fast relief."], [4, "Anti-IgE: IgE mopped up", 500, 226, 510, 64, "An anti-IgE biologic binds IgE so mast cells are less well armed and degranulate less on allergen exposure."]]
    .forEach(([d, n, x, y, tx, ty, tip]) => { dpills[d] = pill(ox, n, x, y, tx, ty, tip); dpills[d].style.opacity = 0; });
}
const acc = { allergen: 0 };
const s = { T2: 0.5, Ig: 0.5, mast: 0.5, eos: 0.5, muc: 0.5, remod: 0.3, bron: 0.5, air: 0.5 }, dw = [1, 0, 0, 0, 0];
function init() { initArrows(); initVessel(); initMuscle(); initBase(); initEpi(); initMucus(); initImmune(); initMobile(); initMarks(); initPanel(); }
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 1.2);
  for (const q of ["T2", "Ig", "mast", "eos", "muc", "remod", "bron", "air"]) s[q] = lerp(s[q], m[q], q === "bron" || q === "air" ? k1 : k2);
  dw.forEach((_, d) => { dw[d] = lerp(dw[d], m.drug === d ? 1 : 0, k1); });
  wallY = WB - 46 * s.bron - 10 * s.remod + 2 * Math.sin(tm / 1100);
  L.lumen.setAttribute("height", f1(wallY - 44));
  epi.forEach((e) => { place(e.g, e.x, wallY + 6 + Math.sin(tm / 900 + e.i) * 0.6, 0, 1); if (e.ci) { let d = ""; for (const o of [-6, 0, 6]) d += "M" + f1(o) + " -9q" + f1(Math.sin(tm / 260 + e.i + o) * 3) + " -5 " + f1(Math.sin(tm / 300 + o) * 3) + " -10"; e.ci.setAttribute("d", d); }
    else e.gr.forEach((g, j) => g.setAttribute("opacity", (0.25 + 0.75 * clamp(s.muc * 1.4 - j * 0.1)).toFixed(2))); });
  if (baseRect) { baseRect.setAttribute("y", f1(wallY + 20)); baseRect.setAttribute("height", f1(2 + 7 * s.remod)); }
  colls.forEach((c) => c.setAttribute("opacity", (0.15 + 0.85 * s.remod).toFixed(2)));
  glandG.forEach((g, i) => place(g, i === 0 ? 190 : 800, 300, 0, 0.7 + 0.5 * s.remod + 0.15 * s.muc));
  plugs.forEach((p) => { const v = clamp(s.muc * 1.5 - p.k * 0.35); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(wallY - 15 - p.k * 3) + ") scale(" + (0.15 + 0.85 * v).toFixed(2) + ")"); p.e.setAttribute("opacity", v > 0.05 ? "1" : "0"); });
  sm.forEach((c) => { const sx = (1 - 0.28 * s.bron) * (1 + 0.15 * s.remod), sy = (1 + 0.3 * s.bron) * (1 + 0.12 * s.remod); c.g.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y) + ") scale(" + sx.toFixed(2) + " " + sy.toFixed(2) + ")"); });
  for (const k in fix) { const f = fix[k], act = k === "m1" || k === "m2" ? s.mast : k === "b" ? s.Ig : s.T2; place(f.g, f.x + Math.sin(tm / 1500 + f.ph) * 2.5, f.y + Math.cos(tm / 1700 + f.ph) * 2.2, Math.sin(tm / 2400 + f.ph) * 5, 1 + 0.05 * act * Math.sin(tm / 320 + f.ph)); f.g.style.opacity = (0.55 + 0.45 * clamp(act * 1.3)).toFixed(2); }
  granules.forEach((g) => g.e.setAttribute("opacity", (1 - 0.7 * s.mast).toFixed(2)));
  ige.forEach((y) => { const a = clamp((1 - 0.85 * dw[4]) * (0.3 + 0.7 * s.T2)); y.e.style.opacity = a.toFixed(2); });
  const ne = Math.round(s.eos * 7);
  mob.forEach((o) => { const want = o.i < ne, op = parseFloat(o.g.style.opacity || 0);
    if (o.st === 0) { if (want) { o.st = 1; o.x = o.hx + rnd(-26, 26); o.y = VY - 10; o.g.style.opacity = 1; } }
    else if (o.st === 1) { o.y -= 46 * dt; o.x += (o.hx - o.x) * dt * 0.8; place(o.g, o.x, o.y, 0, 1); if (o.y <= o.hy) o.st = 2; if (!want) o.st = 3; }
    else if (o.st === 2) { place(o.g, o.hx + Math.sin(tm / 700 + o.i) * 7, o.hy + Math.cos(tm / 900 + o.i * 2) * 5, Math.sin(tm / 500 + o.i) * 14, 1); if (!want) o.st = 3; }
    else { o.g.style.opacity = Math.max(0, op - dt * 0.7); if (op < 0.06) { o.st = 0; o.g.style.opacity = 0; } } });
  const rate = { T2: s.T2, Ig: s.Ig * (1 - 0.7 * dw[4]), eos: s.eos * (1 - 0.5 * dw[2]) * (1 - 0.5 * dw[3]), mast: s.mast, muc: s.muc * s.T2 };
  FLOWS.forEach((f) => { let r = f.rate * (rate[f.src] || 0); if (f.k === "ige") r *= 1 - 0.6 * dw[4]; if (f.k === "hist1" || f.k === "hist2") r *= 1 - 0.65 * dw[4]; r *= 1 - 0.45 * dw[2] - 0.45 * dw[3]; f.acc += dt * r; while (f.acc >= 1) { f.acc--; emitP(f); } });
  parts.forEach((p) => { if (!p.on) return; p.u += dt * 0.45; const a = p.f.tr.at(p.u); p.e.setAttribute("cx", f1(a.x + Math.sin(tm / 300 + p.u * 9) * 1.2)); p.e.setAttribute("cy", f1(a.y)); if (p.u > 1) { p.on = false; p.e.setAttribute("opacity", "0"); } else p.e.setAttribute("opacity", f1(Math.min(1, p.u * 6, (1 - p.u) * 6))); });
  acc.allergen += dt * 2.6 * (0.3 + m.a);
  while (acc.allergen >= 1) { acc.allergen--; const p = trig.find((q) => !q.on); if (p) { p.on = true; p.x = rnd(280, 780); p.y = 52; p.vx = rnd(-6, 6); p.e.setAttribute("d", star); p.e.setAttribute("class", "p-allergen"); } }
  trig.forEach((p) => { if (!p.on) return; p.y += 30 * dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.y * 3) + ")"); p.e.setAttribute("opacity", "1"); if (p.y > wallY - 16) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  for (const d in mk2) mk2[d].setAttribute("opacity", dw[d].toFixed(2)); for (const d in dpills) dpills[d].style.opacity = dw[d].toFixed(2);
  gg.eos.set(s.eos, wordOf(s.eos, 0.28, 0.58, ["low", "raised", "high"])); gg.mast.set(s.mast, wordOf(s.mast, 0.28, 0.58, ["quiet", "primed", "firing"])); gg.muc.set(s.muc, wordOf(s.muc, 0.3, 0.62, ["thin", "thick", "plugging"]));
  gg.bron.set(s.bron, wordOf(s.bron, 0.3, 0.58, ["relaxed", "narrowed", "tight"])); gg.remod.set(s.remod, wordOf(s.remod, 0.3, 0.58, ["little", "some", "marked"])); gg.air.set(s.air, wordOf(s.air, 0.32, 0.62, ["low", "reduced", "open"]));
}
run({ init, step });
