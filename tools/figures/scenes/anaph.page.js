/* Anaphylaxis scene: allergen and IgE on a mast cell, mediator release, bronchospasm, laryngeal swelling, dilated leaky vessel and gauges. */
const WW = SC.W;
const MAST = { x: 175, y: 240 }, AW = { x: 475, y: 225 }, LX = { x: 765, y: 178 }, VY = 365;
const layers = { allerg: $("allerg"), mastg: $("mastg"), airwayg: $("airwayg"), larynxg: $("larynxg"), vesselg: $("vesselg"), parts: $("parts"), over: $("over"), panel: $("panel"), flush: $("flush"), lumenV: $("lumenV") };
/* ---- allergen dots drifting in from the top left ---- */
const allergens = [];
function initAllergens() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl" }, layers.allerg); mk("circle", { class: "sc-p p-allergen", r: 4.2 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1.2, cy: -1.2 }, g); allergens.push({ g, x: rnd(36, 300), y: rnd(96, 210), a: rnd(0, 6.28), s: 0 }); } }
/* ---- mast cell with IgE on its rim and granules inside ---- */
const ige = [], grans = [];
let mastG = null;
function initMast() {
  mastG = mk("g", {}, layers.mastg);
  const c = cell(mastG, { cls: "mast", r: 56, nuc: 0.4, seed: 3, wob: 0.12 });
  for (let j = 0; j < 12; j++) { const t = j / 12 * 6.28, gr = mk("circle", { class: "sc-p p-gran", r: 3.6 + (j % 3), cx: f1(Math.cos(t * 2.3) * 30), cy: f1(Math.sin(t * 1.7) * 28) }, mastG); grans.push(gr); }
  for (let j = 0; j < 10; j++) { const t = j / 10 * 6.28 + 0.3, d = mk("g", { class: "ige", transform: "translate(" + f1(Math.cos(t) * 58) + " " + f1(Math.sin(t) * 58) + ") rotate(" + f1(t * 57.3 + 90) + ")" }, mastG);
    mk("path", { class: "ige-p", d: "M0 5L0 -1M-3.4 -5L0 -1L3.4 -5" }, d);
    if (j % 2 === 0) mk("circle", { class: "ige-b", r: 2.6, cx: 0, cy: -7 }, d);
    ige.push(d); }
  place(c, 0, 0, 0, 1);
}
/* ---- bronchiole cross-section ---- */
let lumenA = null, muscleA = null, epiA = null, mucusG = null;
const airDots = [];
function initAirway() {
  const g = layers.airwayg;
  mk("circle", { class: "aw-outer", cx: AW.x, cy: AW.y, r: 106 }, g);
  muscleA = mk("circle", { class: "aw-muscle", cx: AW.x, cy: AW.y, r: 88, "stroke-width": 14 }, g);
  epiA = mk("circle", { class: "aw-epi", cx: AW.x, cy: AW.y, r: 74 }, g);
  lumenA = mk("circle", { class: "aw-lumen", cx: AW.x, cy: AW.y, r: 68 }, g);
  mucusG = mk("g", { class: "aw-mucus", opacity: "0.2" }, g);
  [[-26, -18, 15], [24, -24, 12], [-8, 26, 13], [28, 18, 10]].forEach(([dx, dy, r]) => mk("ellipse", { cx: AW.x + dx, cy: AW.y + dy, rx: r, ry: r * 0.62 }, mucusG));
  for (let i = 0; i < 5; i++) { const d = mk("circle", { class: "air-dot", r: 3, cx: AW.x, cy: AW.y }, g); airDots.push(d); }
}
/* ---- larynx: a vertical tube whose folds swell inward ---- */
let foldL = null, foldR = null;
const lxDots = [];
function initLarynx() {
  const g = layers.larynxg;
  mk("rect", { class: "lx-wall", x: 714, y: 118, width: 16, height: 120, rx: 8 }, g);
  mk("rect", { class: "lx-wall", x: 800, y: 118, width: 16, height: 120, rx: 8 }, g);
  foldL = mk("ellipse", { class: "lx-fold", cx: 738, cy: LX.y, rx: 10, ry: 13 }, g);
  foldR = mk("ellipse", { class: "lx-fold", cx: 792, cy: LX.y, rx: 10, ry: 13 }, g);
  for (let i = 0; i < 6; i++) lxDots.push({ e: mk("circle", { class: "air-dot", r: 2.6, cx: LX.x, cy: 124 + i * 19 }, g), y: 124 + i * 19, ph: i * 1.3 });
}
/* ---- vessel red cells ---- */
const vrbc = [];
function initVessel() { for (let i = 0; i < 9; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vesselg); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); vrbc.push({ g, x: rnd(645, 925), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const hist = pool(42, () => mk("circle", { class: "sc-p p-hist", r: 2.5 }, layers.parts));
const med2 = pool(20, () => mk("rect", { class: "sc-p p-med2", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const drops = pool(26, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const caps = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["med", "Mediators", "g-hist", "Histamine and other mediators released when allergen cross-links IgE on mast cells."], ["air", "Airway", "g-bad", "How narrow the bronchiole is. Mediators contract its smooth muscle and add mucus: bronchospasm."], ["lar", "Larynx", "g-bad", "Swelling of the laryngeal folds (laryngeal oedema). It narrows the upper airway and can block it."], ["vaso", "Vessels", "g-fl", "Blood vessels dilate and leak plasma, so circulating volume and blood pressure fall."], ["bp", "Pressure", "g-good", "Blood pressure. It falls as vessels dilate and leak, and rises again with adrenaline or fluids."], ["br", "Breathing", "g-bad", "Breathing difficulty from the narrowed bronchiole plus the swollen larynx together."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Allergen", 92, 138, 92, 94, "Allergen: the trigger (for example a food, drug or sting venom). In a sensitised person it meets IgE already fixed on mast cells.");
  pill(ox, "IgE on mast cell", 208, 200, 258, 150, "IgE antibodies sit on high-affinity receptors on the mast cell surface. When allergen cross-links two neighbouring IgE molecules, the cell is switched on.");
  pill(ox, "Mast cell", 145, 268, 108, 332, "Mast cell: a tissue sentinel packed with granules of histamine and other mediators. Cross-linked IgE makes it degranulate within minutes.");
  pill(ox, "Mediators", 282, 252, 332, 286, "Histamine, prostaglandins, leukotrienes and other mediators. They travel to airways, larynx, skin and blood vessels and act within minutes.");
  pill(ox, "Bronchiole", AW.x, 128, AW.x, 96, "Bronchiole: a small airway. The ring is smooth muscle around the air passage in the middle.");
  pill(ox, "Narrowed airway", AW.x, AW.y, AW.x, 368, "Bronchospasm: airway smooth muscle contracts, the wall swells and mucus collects, so air struggles to move, especially out. This causes wheeze.");
  pill(ox, "Larynx", LX.x, 122, LX.x, 94, "Larynx: the voice-box at the top of the windpipe. Air passes between the folds to reach the lungs.");
  pill(ox, "Swollen folds", 796, LX.y, 880, 176, "Laryngeal oedema: mediator-driven fluid swells the laryngeal folds. The opening shrinks, causing hoarseness and stridor, and it can obstruct completely.");
  pill(ox, "Blood vessel", 786, 342, 786, 300, "A blood vessel in the tissues. Mediators relax its muscle so it widens, and loosen its lining so plasma leaks out.");
  pill(ox, "Dilated vessel", 690, 388, 662, 424, "Vasodilation plus leak: the vessel widens and loses plasma. Less volume returning to the heart means falling blood pressure and shock.");
  pill(ox, "Treatment", 300, 360, 318, 416, "Adrenaline reverses the mediator effects (vessel tightening, airway relaxation, less further release). Antihistamine and steroid are slower adjuncts. Fluids refill the dilated, leaky circulation.");
}
const sm = { a: 0.4, M: 0.3, Air: 0.2, Lar: 0.15, Vaso: 0.2, BP: 0.8, Breath: 0.2, drug: 0 };
const acc = { hist: 0, drop: 0, cap: 0 };
const targets = [[AW.x, AW.y], [LX.x, LX.y], [786, VY]];
function init() { initAllergens(); initMast(); initAirway(); initLarynx(); initVessel(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.a = lerp(sm.a, m.a, k2); sm.M = lerp(sm.M, m.M, k2); sm.Air = lerp(sm.Air, m.Air, k1); sm.Lar = lerp(sm.Lar, m.Lar, k1); sm.Vaso = lerp(sm.Vaso, m.Vaso, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.Breath = lerp(sm.Breath, m.Breath, k2); sm.drug = lerp(sm.drug, m.adr || m.ahs || m.flu ? 1 : 0, k1);
  layers.flush.setAttribute("opacity", (sm.M * 0.13).toFixed(2));
  /* allergens drift toward the mast cell; more are active when the reaction is bigger */
  const want = Math.round(sm.a * allergens.length);
  allergens.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt + (MAST.x - b.x) * dt * 0.08; b.y += Math.sin(b.a) * 9 * dt + (MAST.y - b.y) * dt * 0.08;
    if (Math.hypot(MAST.x - b.x, MAST.y - b.y) < 62) { b.x = rnd(36, 220); b.y = rnd(96, 170); }
    b.x = clamp(b.x, 30, 330); b.y = clamp(b.y, 92, 300); place(b.g, b.x, b.y, 0, Math.max(0.05, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* mast cell pulses and flashes its IgE as it releases */
  place(mastG, MAST.x + Math.sin(tm / 1500) * 2.5, MAST.y + Math.cos(tm / 1800) * 2, Math.sin(tm / 2600) * 5, 1 + 0.05 * sm.M * Math.sin(tm / 280));
  ige.forEach((d, j) => { d.style.opacity = (0.4 + 0.6 * sm.M * (0.5 + 0.5 * Math.sin(tm / 240 + j))).toFixed(2); });
  grans.forEach((gr, j) => { gr.style.opacity = (0.45 + 0.5 * Math.sin(tm / 320 + j * 1.4) * sm.M).toFixed(2); });
  /* mediators stream from the mast cell to airway, larynx and vessel */
  acc.hist += dt * sm.M * 13; while (acc.hist >= 1) { acc.hist--; const two = Math.random() < 0.35, p = free(two ? med2 : hist); if (p) emit(p, MAST.x + rnd(30, 52), MAST.y + rnd(-24, 24), 0, 0, Math.floor(Math.random() * 3)); }
  [hist, med2].forEach((pl) => pl.forEach((p) => { if (!p.on) return; const tg = targets[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 95 * dt + Math.sin(tm / 380 + p.y) * 0.25; p.y += (dy / d) * 95 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 16) kill(p); }));
  /* bronchiole narrows, muscle thickens, mucus gathers */
  const lr = 68 - 40 * sm.Air;
  lumenA.setAttribute("r", f1(lr)); epiA.setAttribute("r", f1(lr + 6)); muscleA.setAttribute("stroke-width", f1(13 + 17 * sm.Air));
  mucusG.setAttribute("opacity", (0.12 + 0.6 * sm.Air).toFixed(2));
  mucusG.setAttribute("transform", "translate(" + f1(AW.x) + " " + f1(AW.y) + ") scale(" + (0.55 + 0.45 * sm.Air).toFixed(2) + ") translate(" + f1(-AW.x) + " " + f1(-AW.y) + ")");
  airDots.forEach((d, i) => { const ph = (tm / 1400 + i / airDots.length) % 1, rr = lr * 0.72 * Math.sin(ph * 3.14); d.setAttribute("cx", f1(AW.x + Math.cos(i * 2.4) * rr * 0.5)); d.setAttribute("cy", f1(AW.y + Math.sin(i * 2.4) * rr * 0.5)); d.setAttribute("opacity", (0.25 + 0.65 * (1 - sm.Air)).toFixed(2)); });
  /* laryngeal folds swell inward and the air stream thins */
  const frx = 9 + 20 * sm.Lar;
  foldL.setAttribute("rx", f1(frx)); foldL.setAttribute("ry", f1(12 + 8 * sm.Lar)); foldL.setAttribute("cx", f1(730 + frx * 0.55));
  foldR.setAttribute("rx", f1(frx)); foldR.setAttribute("ry", f1(12 + 8 * sm.Lar)); foldR.setAttribute("cx", f1(800 - frx * 0.55));
  lxDots.forEach((d) => { d.y += dt * 46 * (1 - 0.68 * sm.Lar); if (d.y > 234) d.y = 122; d.e.setAttribute("cy", f1(d.y)); d.e.setAttribute("cx", f1(LX.x + Math.sin(tm / 500 + d.ph) * (4 + 10 * (1 - sm.Lar)))); d.e.setAttribute("opacity", (0.25 + 0.6 * (1 - sm.Lar)).toFixed(2)); });
  /* vessel dilates, red cells slow as pressure falls, plasma leaks upward */
  const hh = 27 + 16 * sm.Vaso;
  layers.lumenV.setAttribute("y", f1(VY - hh)); layers.lumenV.setAttribute("height", f1(hh * 2));
  const flow = clamp(0.22 + 0.85 * sm.BP);
  vrbc.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > 928) { r.x = 646; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, VY + r.y * (hh - 10), Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.drop += dt * sm.Vaso * 7; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(655, 920), VY - hh + 3, rnd(-3, 3), -rnd(13, 20), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (VY - hh - p.y) / 55).toFixed(2)); if (p.y < VY - hh - 55) kill(p); });
  /* treatment capsules travel to the mast cell while a treatment is chosen */
  acc.cap += dt * sm.drug * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(30, 90), 408, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (MAST.x - p.x) * dt * 0.55 + 14 * dt; p.y += (MAST.y - p.y) * dt * 0.65; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* gauges */
  gg.med.set(sm.M, wordOf(sm.M, 0.32, 0.62, ["low", "raised", "high"])); gg.air.set(sm.Air, wordOf(sm.Air, 0.3, 0.6, ["open", "narrowed", "very narrowed"])); gg.lar.set(sm.Lar, wordOf(sm.Lar, 0.3, 0.65, ["clear", "swollen", "blocked"]));
  gg.vaso.set(sm.Vaso, wordOf(sm.Vaso, 0.3, 0.6, ["tight", "dilated", "very dilated"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.62, ["low", "borderline", "ok"])); gg.br.set(sm.Breath, wordOf(sm.Breath, 0.3, 0.6, ["easy", "hard", "very hard"]));
}
run({ init, step });
