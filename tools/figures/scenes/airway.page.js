/* Airway scene: epithelium, goblet cells, immune cells, mediator flows, block marks for each drug, smooth muscle and gauges. */
const L = { lumen: $("lumen"), arrows: $("arrows"), vessel: $("vessel"), muscle: $("muscle"), mucus: $("mucus"), epi: $("epi"), parts: $("parts"), immune: $("immune"), marks: $("marks"), over: $("over"), panel: $("panel") };
const W = SC.W, WB = 172, EPI_N = 22, EW = 932 / EPI_N;
let wallY = WB;
/* ---- epithelium: cells with cilia; every fifth is a goblet cell that fills with mucus ---- */
const epi = [];
function initEpi() {
  for (let i = 0; i < EPI_N; i++) { const gob = i % 5 === 2, x = 14 + (i + 0.5) * EW, g = mk("g", {}, L.epi);
    const body = cell(g, { cls: gob ? "gob" : "epi", r: gob ? 19 : 16, nuc: gob ? 0.0 : 0.3, seed: i, wob: 0.05, n: 8 });
    const gr = []; if (gob) for (let j = 0; j < 7; j++) gr.push(mk("circle", { class: "mg", r: 2.4, cx: f1(Math.cos(j * 0.9) * 9), cy: f1(Math.sin(j * 1.7) * 7) }, g));
    const ci = gob ? null : mk("path", { class: "cilia" }, g);
    epi.push({ g, x, gob, ci, gr, i }); }
}
const gobs = () => epi.filter((e) => e.gob);
const plugs = [];
function initMucus() { gobs().forEach((e) => { for (let j = 0; j < 3; j++) plugs.push({ e: mk("ellipse", { class: "mucus", rx: 11, ry: 6 }, L.mucus), x: e.x + (j - 1) * 13, k: j }); }); }
/* ---- smooth muscle band ---- */
const MY = 354, sm = [];
function initMuscle() { mk("rect", { class: "sc-sm-bg", x: 14, y: MY - 22, width: W - 28, height: 44, rx: 10, opacity: 0.0 }, L.muscle);
  for (let i = 0; i < 17; i++) { const g = mk("g", {}, L.muscle); mk("ellipse", { class: "sm-c", rx: 30, ry: 10 }, g); mk("ellipse", { class: "sm-n", rx: 8, ry: 3.6 }, g); sm.push({ g, x: 40 + i * 54, y: MY + (i % 2 ? 6 : -6) }); } }
/* ---- blood vessel the eosinophils and neutrophils come from ---- */
const VY = 412;
function initVessel() { mk("rect", { class: "ven", x: 380, y: VY - 18, width: 500, height: 36, rx: 18 }, L.vessel);
  [0, 1, 2, 3, 4, 5, 6].forEach((i) => { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g); place(g, 410 + i * 66, VY + (i % 2 ? 4 : -4), 0, 1); }); }
/* ---- fixed immune cells ---- */
const POS = { dc: [110, 228], ilc: [232, 218], th2: [332, 262], b: [438, 226], m1: [548, 218], m2: [648, 258], th17: [764, 226] };
const fix = {};
function addFix(key, o) { const g = mk("g", {}, L.immune), c = cell(g, o); fix[key] = { g, c, x: POS[key][0], y: POS[key][1], ph: Math.random() * 6 }; return fix[key]; }
const granules = [], ige = [];
function initImmune() {
  const dc = addFix("dc", { cls: "dc", r: 17, nuc: 0.4, seed: 3, wob: 0.16 });
  for (let j = 0; j < 7; j++) { const t = j * 0.9 + 0.3; mk("path", { class: "dend", d: "M" + f1(Math.cos(t) * 14) + " " + f1(Math.sin(t) * 14) + "L" + f1(Math.cos(t) * 28) + " " + f1(Math.sin(t) * 28) }, dc.g); }
  addFix("ilc", { cls: "lymph", r: 12, nuc: 0.6, seed: 5 }); addFix("th2", { cls: "th2", r: 13, nuc: 0.6, seed: 6 });
  addFix("b", { cls: "bcell", r: 14, nuc: 0.5, seed: 7 }); addFix("th17", { cls: "th17", r: 13, nuc: 0.6, seed: 8 });
  ["m1", "m2"].forEach((k, mi) => { const f = addFix(k, { cls: "mast", r: 21, nuc: 0.0, seed: 9 + mi, wob: 0.1 });
    for (let j = 0; j < 9; j++) granules.push({ e: mk("circle", { class: "gran", r: 2.6, cx: f1(Math.cos(j * 0.7 + mi) * 10), cy: f1(Math.sin(j * 1.9 + mi) * 9) }, f.g), mi });
    for (let j = 0; j < 6; j++) { const t = j * 1.05 + mi, y = mk("path", { class: "ige-y", d: "M0 0L0 -5M-3 -9L0 -5L3 -9", transform: "translate(" + f1(Math.cos(t) * 24) + " " + f1(Math.sin(t) * 24) + ") rotate(" + f1(t * 57.3 + 90) + ")" }, f.g); ige.push({ e: y, mi }); } });
}
/* ---- eosinophils and neutrophils: recruited from the vessel, then wander near the wall ---- */
const mob = [];
function initMobile() {
  for (let i = 0; i < 7; i++) mob.push({ kind: "eos", g: cell(L.immune, { cls: "eos", r: 11.5, nuc: 0.55, nucCls: "multi", seed: 30 + i, wob: 0.1 }), hx: 430 + i * 38 + rnd(-8, 8), hy: 268 + (i % 3) * 18, st: 0, x: 0, y: 0, i });
  for (let i = 0; i < 6; i++) mob.push({ kind: "neu", g: cell(L.immune, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: 50 + i, wob: 0.14 }), hx: 720 + i * 32 + rnd(-8, 8), hy: 280 + (i % 3) * 16, st: 0, x: 0, y: 0, i });
  mob.forEach((m) => { m.g.style.opacity = 0; place(m.g, -40, VY, 0, 0.1); });
}
/* ---- mediator flows: paths between cells ---- */
const T = {
  alarmILC: [[210, 180], [226, 206]], alarmDC: [[132, 180], [116, 212]], dc2th: [[124, 238], [220, 256], [318, 262]],
  il5: [[346, 268], [440, 296], [540, 306]], il5b: [[244, 226], [380, 300], [520, 312]], il4: [[346, 254], [424, 232]], ige: [[452, 224], [528, 218]],
  il13: [[332, 248], [332, 196]], hist1: [[548, 236], [548, 336]], hist2: [[648, 276], [648, 336]], il17: [[764, 212], [758, 188]], il8: [[800, 188], [830, 292]],
};
const FLOWS = [["alarmILC", "p-alarm", "t2", 3], ["alarmDC", "p-alarm", "t2", 1.5], ["dc2th", "p-il4", "t2", 1.5], ["il5", "p-il5", "eos", 4], ["il5b", "p-il5", "eos", 2.5], ["il4", "p-il4", "T2", 2.5], ["ige", "p-ige", "mast", 3], ["il13", "p-il13", "muc", 3.5], ["hist1", "p-hist", "mast", 5], ["hist2", "p-hist", "mast", 4], ["il17", "p-il17", "nt", 4], ["il8", "p-il8", "neu", 5]]
  .map(([k, cls, src, rate]) => ({ k, cls, src, rate, tr: track(T[k]), acc: 0 }));
function chev(parent, a, b) { const t = Math.atan2(b[1] - a[1], b[0] - a[0]), p = (d, o) => f1(b[0] - Math.cos(t + o) * d) + " " + f1(b[1] - Math.sin(t + o) * d); return mk("path", { class: "arh", d: "M" + p(7, 0.5) + "L" + f1(b[0]) + " " + f1(b[1]) + "L" + p(7, -0.5) }, parent); }
function initArrows() { for (const k in T) { const pts = T[k]; mk("path", { class: "ar", d: "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L") }, L.arrows); chev(L.arrows, pts[pts.length - 2], pts[pts.length - 1]); } }
/* ---- particles: one shared pool, restyled on emit ---- */
const parts = Array.from({ length: 150 }, () => ({ e: mk("circle", { r: 2.2, opacity: 0 }, L.parts), on: false, u: 0, f: null, x: 0, y: 0, vx: 0, vy: 0, t: 0 }));
function emitP(f) { const p = parts.find((q) => !q.on); if (!p) return; p.on = true; p.f = f; p.u = 0; p.t = 0; p.e.setAttribute("class", "sc-p " + f.cls); p.e.setAttribute("r", f.k.indexOf("ige") === 0 ? 3 : 2.3); p.e.setAttribute("opacity", "1"); }
const trig = Array.from({ length: 22 }, () => { const e = mk("path", { opacity: 0 }, L.parts); return { e, on: false, x: 0, y: 0, kind: 0, vx: 0 }; });
const star = "M0 -5L1.4 -1.4L5 0L1.4 1.4L0 5L-1.4 1.4L-5 0L-1.4 -1.4Z", puff = "M-4 1A3.4 3.4 0 0 1 -1 -3A4 4 0 0 1 5 -1A3 3 0 0 1 4 4L-3 4A3 3 0 0 1 -4 1Z";
/* ---- block marks for each drug ---- */
const MARKS = { 1: [[236, 196, "ICS"], [350, 244, "ICS"], [782, 210, "ICS"]], 2: [[566, 206, "Y"]], 3: [[440, 296, "Y"]], 4: [[386, 238, "Y"], [332, 222, "Y"]], 5: [[217, 193, "Y"]], 6: [] };
const mk2 = {};
function initMarks() {
  for (const d in MARKS) { const g = mk("g", { opacity: 0 }, L.marks); mk2[d] = g;
    MARKS[d].forEach(([x, y, kind]) => { mk("circle", { class: "blk-c", cx: x, cy: y, r: 7.5 }, g); mk("path", { class: "blk-x", d: "M" + (x - 3.6) + " " + (y - 3.6) + "l7.2 7.2M" + (x + 3.6) + " " + (y - 3.6) + "l-7.2 7.2" }, g);
      if (kind === "Y") mk("path", { class: "blk-y", d: "M" + (x + 11) + " " + (y + 5) + "l0 -6M" + (x + 7) + " " + (y - 5) + "l4 4l4 -4" }, g); });
    if (+d === 6) [260, 560, 860].forEach((x) => { mk("path", { class: "bd-a", d: "M" + x + " " + (MY - 30) + "l0 -10l-5 5M" + x + " " + (MY - 40) + "l5 5" }, g); mk("path", { class: "bd-a", d: "M" + (x + 14) + " " + (MY + 30) + "l0 10l-5 -5M" + (x + 14) + " " + (MY + 40) + "l5 -5" }, g); }); }
}
/* ---- labels and gauges ---- */
const gg = {}, dpills = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [96, 210, 324, 438, 552, 666];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The airway";
  [["eos", "Eosinophils", "g-eos", "Eosinophils in the airway wall. They follow IL-5 and release proteins that damage the lining and inflame the wall."], ["neu", "Neutrophils", "g-neu", "Neutrophils in the airway wall. They follow IL-17 and IL-8, typically with smoke or infection."], ["muc", "Mucus", "g-mucus", "Mucus from goblet cells. IL-13 drives it in the type-2 pattern, IL-17 in the neutrophilic pattern. It can plug small airways."], ["mast", "Mast cells", "g-mast", "Mast cell activation: IgE on the surface, cross-linked by allergen, releases histamine and leukotrienes."], ["bc", "Tightening", "g-bad", "How much the airway muscle is tightening and the wall swelling, which narrows the lumen."], ["air", "Airflow", "g-air", "How open the airway is. A bronchodilator raises this fast but does not change the inflammation underneath."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Epithelium", 150, 180, 250, 82, "The airway lining. It senses triggers and releases alarmins (type-2) or IL-17 signals (non-type-2). Cilia sweep mucus out.");
  pill(ox, "Goblet cell", 332, 184, 400, 82, "Goblet cells make mucus. IL-13 turns them up and increases their number, so mucus becomes thick and can plug the airway.");
  pill(ox, "Allergen", 600, 80, 600, 64, "Allergens such as pollen or dust mite, the usual trigger in the type-2 pattern.");
  pill(ox, "Smoke or infection", 840, 90, 840, 64, "Smoke, pollution and infection, a usual trigger in the neutrophilic pattern.");
  pill(ox, "Dendritic cell", POS.dc[0], POS.dc[1] + 18, 80, 288, "Dendritic cell: picks up allergen at the lining and presents it to T cells.");
  pill(ox, "ILC2", POS.ilc[0] - 8, POS.ilc[1] - 12, 164, 214, "ILC2: innate lymphoid cell. Alarmins make it release IL-5 and IL-13 fast, without needing an allergen.");
  pill(ox, "Th2 cell", POS.th2[0], POS.th2[1] + 14, 316, 316, "Th2 cell: a helper T cell that makes IL-4, IL-5 and IL-13.");
  pill(ox, "B cell", POS.b[0], POS.b[1] - 16, 430, 186, "B cell. IL-4 tells it to switch to making IgE antibody.");
  pill(ox, "Mast cell", POS.m1[0] + 16, POS.m1[1] - 14, 614, 190, "Mast cell armed with IgE. Allergen cross-links the IgE and the cell releases histamine and leukotrienes, which tighten the airway muscle and swell the wall.");
  pill(ox, "Eosinophils", 560, 306, 610, 336, "Eosinophils come from blood, called in by IL-5. Their granule proteins damage the lining and keep the wall inflamed.");
  pill(ox, "Th17 cell", POS.th17[0], POS.th17[1] - 14, 700, 186, "Th17 cell: makes IL-17, which makes the lining release IL-8 and call in neutrophils.");
  pill(ox, "Neutrophils", 840, 300, 880, 336, "Neutrophils, called in by IL-8. They release enzymes and oxygen radicals and often do not respond to steroid.");
  pill(ox, "Airway smooth muscle", 110, MY, 130, 392, "Smooth muscle around the airway. Histamine, leukotrienes and IL-13 make it tighten, and it narrows the lumen.");
  pill(ox, "Blood vessel", 400, VY + 6, 346, 430, "Vessel that supplies the wall. Eosinophils and neutrophils leave from here.");
  [["alarm", "Alarmins", 214, 196, 270, 160, "Alarmins (TSLP, IL-33, IL-25) from the epithelium. They wake ILC2 and Th2 cells."], ["il5", "IL-5", 480, 302, 470, 320, "IL-5: calls eosinophils in from blood and keeps them alive."], ["il4", "IL-4", 386, 246, 380, 206, "IL-4: pushes B cells to make IgE and Th2 cells to grow."], ["ige", "IgE", 490, 222, 492, 190, "IgE antibody made by B cells; it sits on mast cells."], ["il13", "IL-13", 332, 224, 292, 196, "IL-13: more mucus, goblet cell growth and twitchy muscle."], ["il17", "IL-17", 760, 200, 800, 160, "IL-17 from Th17 cells, calling for neutrophils."]]
    .forEach(([k, n, x, y, tx, ty, tip]) => { pill(ox, n, x, y, tx, ty, tip); });
  [[1, "Steroid: many genes off", 300, 214, 300, 236, "Inhaled corticosteroid: switches off many inflammatory genes in many cells, so type-2 and some neutrophilic signals fall."], [2, "Anti-IgE", 566, 206, 700, 158, "Anti-IgE antibody: mops up IgE so mast cells are no longer armed."], [3, "Anti-IL-5", 420, 276, 420, 262, "Anti-IL-5 antibody (or receptor blocker): cuts the eosinophil signal."], [4, "Anti-IL-4R alpha", 366, 214, 340, 304, "Blocks the receptor shared by IL-4 and IL-13: less IgE, mucus and twitchy muscle."], [5, "Anti-TSLP", 217, 193, 140, 174, "Anti-TSLP antibody: blocks an upstream alarmin, so the whole type-2 pathway quietens."], [6, "Bronchodilator", 700, 336, 770, 318, "A beta-2 agonist relaxes the airway muscle and opens the airway quickly. It does not treat the inflammation."]]
    .forEach(([d, n, x, y, tx, ty, tip]) => { dpills[d] = pill(ox, n, x, y, tx, ty, tip); dpills[d].style.opacity = 0; });
}
const acc = { allergen: 0, smoke: 0 };
const s = { t2: 1, nt: 0.1, T2: 1, eos: 0.8, mast: 0.8, neu: 0.1, muc: 0.7, bc: 0.7 }, dw = [1, 0, 0, 0, 0, 0, 0];
function init() { initArrows(); initVessel(); initMuscle(); initEpi(); initMucus(); initImmune(); initMobile(); initMarks(); initPanel(); }
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 1.2);
  for (const q of ["t2", "nt", "T2", "eos", "mast", "neu", "muc", "bc"]) s[q] = lerp(s[q], m[q], q === "bc" ? k1 : k2);
  dw.forEach((_, d) => { dw[d] = lerp(dw[d], m.drug === d ? 1 : 0, k1); });
  wallY = WB - 66 * s.bc + 2 * Math.sin(tm / 1100);
  L.lumen.setAttribute("height", f1(wallY - 44));
  /* epithelium */
  epi.forEach((e) => { place(e.g, e.x, wallY + 6 + Math.sin(tm / 900 + e.i) * 0.6, 0, 1); if (e.ci) { let d = ""; for (const o of [-6, 0, 6]) d += "M" + f1(o) + " -9q" + f1(Math.sin(tm / 260 + e.i + o) * 3) + " -5 " + f1(Math.sin(tm / 300 + o) * 3) + " -10"; e.ci.setAttribute("d", d); }
    else e.gr.forEach((g, j) => g.setAttribute("opacity", (0.25 + 0.75 * clamp(s.muc * 1.4 - j * 0.1)).toFixed(2))); });
  plugs.forEach((p, i) => { const v = clamp(s.muc * 1.5 - p.k * 0.35); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(wallY - 16 - p.k * 3) + ") scale(" + (0.15 + 0.85 * v).toFixed(2) + " " + (0.15 + 0.85 * v).toFixed(2) + ")"); p.e.setAttribute("opacity", v > 0.05 ? "1" : "0"); });
  /* muscle: shortens and thickens as it tightens */
  sm.forEach((c, i) => place(c.g, c.x, c.y, 0, 1)), sm.forEach((c) => c.g.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y) + ") scale(" + (1 - 0.3 * s.bc).toFixed(2) + " " + (1 + 0.5 * s.bc).toFixed(2) + ")"));
  /* fixed cells: bob and glow */
  for (const k in fix) { const f = fix[k], act = k === "th17" ? s.nt : k === "m1" || k === "m2" ? s.mast : s.t2; place(f.g, f.x + Math.sin(tm / 1500 + f.ph) * 2.5, f.y + Math.cos(tm / 1700 + f.ph) * 2.2, Math.sin(tm / 2400 + f.ph) * 5, 1 + 0.05 * act * Math.sin(tm / 320 + f.ph)); f.g.style.opacity = (0.55 + 0.45 * clamp(act * 1.3)).toFixed(2); }
  granules.forEach((g) => { g.e.setAttribute("opacity", (1 - 0.7 * s.mast).toFixed(2)); });
  ige.forEach((y) => { const a = clamp((1 - 0.85 * dw[2]) * (0.3 + 0.7 * s.t2)); y.e.style.opacity = a.toFixed(2); });
  /* recruited cells */
  const ne = Math.round(s.eos * 7), nn = Math.round(s.neu * 6), cnt = { eos: 0, neu: 0 };
  mob.forEach((o) => { const want = o.kind === "eos" ? o.i < ne : o.i < nn; const op = parseFloat(o.g.style.opacity);
    if (o.st === 0) { if (want) { o.st = 1; o.x = o.hx + rnd(-30, 30); o.y = VY - 10; o.g.style.opacity = 1; } }
    else if (o.st === 1) { o.y -= 46 * dt; o.x += (o.hx - o.x) * dt * 0.8; place(o.g, o.x, o.y, 0, 1); if (o.y <= o.hy) o.st = 2; if (!want) o.st = 3; }
    else if (o.st === 2) { place(o.g, o.hx + Math.sin(tm / 700 + o.i) * 7, o.hy + Math.cos(tm / 900 + o.i * 2) * 5, Math.sin(tm / 500 + o.i) * 14, 1); if (!want) o.st = 3; }
    else { o.g.style.opacity = Math.max(0, op - dt * 0.7); if (op < 0.06) { o.st = 0; o.g.style.opacity = 0; } } });
  /* mediator flows */
  const rate = { t2: s.t2 * 0.9 + 0.05, T2: s.T2, eos: s.eos * (1 - 0.9 * dw[3]) , mast: s.mast, muc: s.muc * s.T2, nt: s.nt, neu: s.neu };
  FLOWS.forEach((f) => { let r = f.rate * rate[f.src];
    if (f.k === "alarmILC" || f.k === "alarmDC") r *= 1 - 0.8 * dw[5]; if (f.k === "il5" || f.k === "il5b") r *= 1 - 0.85 * dw[3]; if (f.k === "ige") r *= 1 - 0.7 * dw[2] - 0.4 * dw[4]; if (f.k === "il4" || f.k === "il13") r *= 1 - 0.8 * dw[4]; if (f.k === "hist1" || f.k === "hist2") r *= 1 - 0.7 * dw[2];
    r *= 1 - 0.5 * dw[1]; f.acc += dt * r; while (f.acc >= 1) { f.acc--; emitP(f); } });
  parts.forEach((p) => { if (!p.on) return; p.u += dt * 0.45 * (p.f.k.indexOf("il5") === 0 ? 0.8 : 1); const a = p.f.tr.at(p.u); p.e.setAttribute("cx", f1(a.x + Math.sin(tm / 300 + p.u * 9) * 1.2)); p.e.setAttribute("cy", f1(a.y)); if (p.u > 1) { p.on = false; p.e.setAttribute("opacity", "0"); } else p.e.setAttribute("opacity", f1(Math.min(1, p.u * 6, (1 - p.u) * 6))); });
  /* triggers fall from the lumen onto the lining */
  acc.allergen += dt * 2.6 * m.t2; acc.smoke += dt * 2.6 * m.nt;
  [["allergen", 0], ["smoke", 1]].forEach(([k, kind]) => { while (acc[k] >= 1) { acc[k]--; const p = trig.find((q) => !q.on); if (p) { p.on = true; p.kind = kind; p.x = kind ? rnd(640, 930) : rnd(300, 760); p.y = 52; p.vx = rnd(-6, 6); p.e.setAttribute("d", kind ? puff : star); p.e.setAttribute("class", kind ? "p-smoke" : "p-allergen"); } } });
  trig.forEach((p) => { if (!p.on) return; p.y += (p.kind ? 20 : 30) * dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.y * 3) + ")"); p.e.setAttribute("opacity", "1"); if (p.y > wallY - 16) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  /* marks and drug labels */
  for (const d in mk2) mk2[d].setAttribute("opacity", dw[d].toFixed(2)); for (const d in dpills) dpills[d].style.opacity = dw[d].toFixed(2);
  /* gauges */
  gg.eos.set(s.eos, wordOf(s.eos, 0.25, 0.55, ["low", "raised", "high"])); gg.neu.set(s.neu, wordOf(s.neu, 0.25, 0.55, ["low", "raised", "high"])); gg.muc.set(s.muc, wordOf(s.muc, 0.3, 0.55, ["thin", "thick", "plugging"]));
  gg.mast.set(s.mast, wordOf(s.mast, 0.25, 0.55, ["quiet", "primed", "firing"])); gg.bc.set(s.bc, wordOf(s.bc, 0.3, 0.55, ["relaxed", "tightening", "tight"])); gg.air.set(1 - s.bc, wordOf(1 - s.bc, 0.45, 0.7, ["tight", "narrowed", "open"]));
}
run({ init, step });
