/* Anaphylaxis scene: allergen and IgE on a mast cell, mediator release, a lung whose
 * bronchiole narrows, laryngeal swelling, a heart pumping into a dilated leaky vessel,
 * and each treatment visibly acting on the drawing. */
const WW = SC.W;
const MAST = { x: 175, y: 240 }, RING = { x: 505, y: 245 }, LX = { x: 765, y: 178 }, VY = 366, VESL = 700, VESR = 928;
const MAST_ABS = [[225.2, 211], [225.2, 269]];
const layers = { allerg: $("allerg"), mastg: $("mastg"), lungSlot: $("lungSlot"), heartSlot: $("heartSlot"), airwayg: $("airwayg"), larynxg: $("larynxg"), vesselg: $("vesselg"), parts: $("parts"), over: $("over"), panel: $("panel"), flush: $("flush"), lumenV: $("lumenV") };
/* ---- recognisable organs; vessels and particles anchor to their ports ---- */
let lungO = null, heartO = null;
function initOrgans() {
  lungO = organ(layers.lungSlot, "lung", 492, 228, 200, {});
  heartO = organ(layers.heartSlot, "heart", 656, 366, 112, {});
}
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
  [[50.2, -29], [50.2, 29]].forEach(([x, y]) => mk("circle", { class: "rc-dot", cx: f1(x), cy: f1(y), r: 2.4 }, mastG));
}
/* ---- bronchiole cross-section sitting inside the lung, fed by the bronchus stub ---- */
let lumenA = null, muscleA = null, epiA = null, mucusG = null;
const airDots = [];
const AIR_ADR = [[551, 245], [482, 205.2]];
const AIR_AH = [[459, 245], [528, 284.8], [528, 205.2]];
function initAirway() {
  const g = layers.airwayg;
  mk("circle", { class: "aw-outer", cx: RING.x, cy: RING.y, r: 58 }, g);
  muscleA = mk("circle", { class: "aw-muscle", cx: RING.x, cy: RING.y, r: 46, "stroke-width": 14 }, g);
  epiA = mk("circle", { class: "aw-epi", cx: RING.x, cy: RING.y, r: 39 }, g);
  lumenA = mk("circle", { class: "aw-lumen", cx: RING.x, cy: RING.y, r: 34 }, g);
  mucusG = mk("g", { class: "aw-mucus", opacity: "0.2" }, g);
  [[-16, -11, 9], [15, -15, 7], [-5, 16, 8], [17, 11, 6]].forEach(([dx, dy, r]) => mk("ellipse", { class: "aw-muc", cx: RING.x + dx, cy: RING.y + dy, rx: r, ry: f1(r * 0.62) }, mucusG));
  AIR_ADR.concat(AIR_AH).forEach(([x, y]) => mk("circle", { class: "rc-dot", cx: f1(x), cy: f1(y), r: 2.4 }, g));
  for (let i = 0; i < 5; i++) { const d = mk("circle", { class: "air-dot", r: 3, cx: RING.x, cy: RING.y }, g); airDots.push(d); }
}
/* ---- larynx: a vertical tube whose folds swell inward ---- */
let foldL = null, foldR = null, foldLcx = 738, foldRcx = 792;
const lxDots = [];
function initLarynx() {
  const g = layers.larynxg;
  mk("rect", { class: "lx-wall", x: 714, y: 118, width: 16, height: 120, rx: 8 }, g);
  mk("rect", { class: "lx-wall", x: 800, y: 118, width: 16, height: 120, rx: 8 }, g);
  foldL = mk("ellipse", { class: "lx-fold", cx: 738, cy: LX.y, rx: 10, ry: 13 }, g);
  foldR = mk("ellipse", { class: "lx-fold", cx: 792, cy: LX.y, rx: 10, ry: 13 }, g);
  for (let i = 0; i < 6; i++) lxDots.push({ e: mk("circle", { class: "air-dot", r: 2.6, cx: LX.x, cy: 124 + i * 19 }, g), y: 124 + i * 19, ph: i * 1.3 });
}
/* ---- red cells pumped from the heart through the vessel ---- */
const vrbc = [];
function initVessel() { for (let i = 0; i < 9; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vesselg); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); vrbc.push({ g, x: rnd(706, 925), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, slot: 0, tb: null, tr: 0, tt: 0, ty: 0 }; }); }
const hist = pool(42, () => mk("circle", { class: "sc-p p-hist", r: 2.5 }, layers.parts));
const med2 = pool(20, () => mk("rect", { class: "sc-p p-med2", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const drops = pool(26, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const adr = pool(14, () => mk("path", { class: "sc-p p-adr", d: "M0 -4.2 L3.8 3 L-3.8 3 Z" }, layers.parts));
const ah = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "sc-p p-ah", x: -3.2, y: -3.2, width: 6.4, height: 6.4, rx: 1.6 }, g); mk("circle", { class: "cl-h", r: 1.2 }, g); return g; });
const iv = pool(14, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.tr = 0; p.tt = 0; p.tb = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* docked antihistamine blockers, rebuilt on every tick for the trapping check */
const dockedAh = [];
function hitBlocker(x, y) {
  for (let i = 0; i < dockedAh.length; i++) { const b = dockedAh[i], dx = x - b.x, dy = y - b.y; if (dx * dx + dy * dy < 484) return b; }
  return null;
}
/* ---- plain-language caption in the stage, following drug and severity ---- */
let capEl = null, capDrug = -1, capLevel = -1;
function capText(d, l) {
  const sev = ["Mild reaction. ", "Moderate reaction. ", "Severe reaction. "][l];
  if (d === 1) return sev + "Adrenaline docks on vessels and airways. Vessels tighten and breathing eases.";
  if (d === 2) return sev + "Antihistamine sits on histamine docking points. Swelling eases slowly.";
  if (d === 3) return sev + "Fluids refill the leaky circulation. Pressure steadies.";
  return sev + "No treatment. Airways narrow and pressure falls.";
}
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
  pill(ox, "Lung", 560, 150, 628, 112, "Lung: the bronchiole in the middle is a small airway. Mediators reaching it make its muscle squeeze shut.");
  pill(ox, "Bronchiole", 505, 187, 505, 96, "Bronchiole in cross section inside the lung. The ring is smooth muscle around the air passage in the middle.");
  pill(ox, "Narrowed airway", 505, 245, 505, 372, "Bronchospasm: airway smooth muscle contracts and mucus collects, so air struggles to move, especially out. This causes wheeze.");
  pill(ox, "Larynx", 765, 122, 765, 94, "Larynx: the voice-box at the top of the windpipe. Air passes between the folds to reach the lungs.");
  pill(ox, "Swollen folds", 800, 178, 880, 176, "Laryngeal oedema: mediator-driven fluid swells the laryngeal folds. The opening shrinks, causing hoarseness and stridor, and it can obstruct completely.");
  pill(ox, "Heart", 630, 400, 606, 290, "Heart: it pumps blood into the vessel. When vessels widen and leak, less blood returns and pressure falls.");
  pill(ox, "Blood vessel", 810, 344, 810, 300, "A blood vessel leaving the heart. Mediators relax its muscle so it widens, and loosen its lining so plasma leaks out.");
  pill(ox, "Dilated vessel", 800, 384, 800, 428, "Vasodilation plus leak: the vessel widens and loses plasma. Less volume returning to the heart means falling blood pressure and shock.");
  pill(ox, "Treatment", 300, 360, 318, 404, "Treatment enters from here. Adrenaline docks on vessel and airway docking points, antihistamine covers histamine docking points, and fluids refill the vessel.");
  capEl = mk("text", { class: "an-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { a: 0.4, M: 0.3, Air: 0.2, Lar: 0.15, Vaso: 0.2, BP: 0.8, Breath: 0.2, adr: 0, ahs: 0, flu: 0 };
const acc = { hist: 0, drop: 0, adr: 0, ah: 0, iv: 0 };
const targets = [[RING.x, RING.y], [LX.x, LX.y], [810, VY]];
function init() { initOrgans(); initAllergens(); initMast(); initAirway(); initLarynx(); initVessel(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.a = lerp(sm.a, m.a, k2); sm.M = lerp(sm.M, m.M, k2); sm.Air = lerp(sm.Air, m.Air, k1); sm.Lar = lerp(sm.Lar, m.Lar, k1); sm.Vaso = lerp(sm.Vaso, m.Vaso, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.Breath = lerp(sm.Breath, m.Breath, k2);
  sm.adr = lerp(sm.adr, m.adr, k1); sm.ahs = lerp(sm.ahs, m.ahs, k1); sm.flu = lerp(sm.flu, m.flu, k1);
  layers.flush.setAttribute("opacity", (sm.M * 0.13).toFixed(2));
  /* allergens drift toward the mast cell; more are active when the reaction is bigger */
  const want = Math.round(sm.a * allergens.length);
  allergens.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt + (MAST.x - b.x) * dt * 0.08; b.y += Math.sin(b.a) * 9 * dt + (MAST.y - b.y) * dt * 0.08;
    if (Math.hypot(MAST.x - b.x, MAST.y - b.y) < 62) { b.x = rnd(36, 220); b.y = rnd(96, 170); }
    b.x = clamp(b.x, 30, 330); b.y = clamp(b.y, 92, 300); place(b.g, b.x, b.y, 0, Math.max(0.05, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* mast cell shimmers as it releases; docked adrenaline rides its rim */
  place(mastG, MAST.x + Math.sin(tm / 1500) * 1.5, MAST.y + Math.cos(tm / 1800) * 1.2, Math.sin(tm / 2600) * 2, 1 + 0.05 * sm.M * Math.sin(tm / 280));
  ige.forEach((d, j) => { d.style.opacity = (0.4 + 0.6 * sm.M * (0.5 + 0.5 * Math.sin(tm / 240 + j))).toFixed(2); });
  grans.forEach((gr, j) => { gr.style.opacity = (0.45 + 0.5 * Math.sin(tm / 320 + j * 1.4) * sm.M).toFixed(2); });
  /* mediators stream from the mast cell to the lung, the larynx and the vessel */
  acc.hist += dt * sm.M * 13; while (acc.hist >= 1) { acc.hist--; const two = Math.random() < 0.35, p = free(two ? med2 : hist); if (p) emit(p, MAST.x + rnd(30, 52), MAST.y + rnd(-24, 24), 0, 0, Math.floor(Math.random() * 3)); }
  const moveMed = (pl) => pl.forEach((p) => {
    if (!p.on) return;
    if (p.tr) { p.tt += dt; const b = p.tb; p.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.tt / 0.45).toFixed(2)); if (p.tt > 0.45) { p.tr = 0; kill(p); } return; }
    const tg = targets[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 95 * dt + Math.sin(tm / 380 + p.y) * 0.25; p.y += (dy / d) * 95 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (sm.ahs > 0.4) { const b = hitBlocker(p.x, p.y); if (b) { p.tr = 1; p.tb = b; p.tt = 0; return; } }
    if (d < 16) kill(p);
  });
  /* bronchiole narrows inside the lung, muscle thickens, mucus gathers */
  const lr = 34 - 20 * sm.Air;
  lumenA.setAttribute("r", f1(lr)); epiA.setAttribute("r", f1(lr + 5)); muscleA.setAttribute("stroke-width", f1(10 + 11 * sm.Air));
  mucusG.setAttribute("opacity", (0.12 + 0.6 * sm.Air).toFixed(2));
  mucusG.setAttribute("transform", "translate(" + f1(RING.x) + " " + f1(RING.y) + ") scale(" + (0.55 + 0.45 * sm.Air).toFixed(2) + ") translate(" + f1(-RING.x) + " " + f1(-RING.y) + ")");
  airDots.forEach((d, i) => { const ph = (tm / 1400 + i / airDots.length) % 1, rr = lr * 0.72 * Math.sin(ph * 3.14); d.setAttribute("cx", f1(RING.x + Math.cos(i * 2.4) * rr * 0.5)); d.setAttribute("cy", f1(RING.y + Math.sin(i * 2.4) * rr * 0.5)); d.setAttribute("opacity", (0.25 + 0.65 * (1 - sm.Air)).toFixed(2)); });
  /* laryngeal folds swell inward and the air stream thins */
  const frx = 9 + 20 * sm.Lar;
  foldL.setAttribute("rx", f1(frx)); foldL.setAttribute("ry", f1(12 + 8 * sm.Lar)); foldL.setAttribute("cx", f1(730 + frx * 0.55));
  foldR.setAttribute("rx", f1(frx)); foldR.setAttribute("ry", f1(12 + 8 * sm.Lar)); foldR.setAttribute("cx", f1(800 - frx * 0.55));
  foldLcx = 730 + frx * 0.55; foldRcx = 800 - frx * 0.55;
  lxDots.forEach((d) => { d.y += dt * 46 * (1 - 0.68 * sm.Lar); if (d.y > 234) d.y = 122; d.e.setAttribute("cy", f1(d.y)); d.e.setAttribute("cx", f1(LX.x + Math.sin(tm / 500 + d.ph) * (4 + 10 * (1 - sm.Lar)))); d.e.setAttribute("opacity", (0.25 + 0.6 * (1 - sm.Lar)).toFixed(2)); });
  /* vessel dilates, red cells slow as pressure falls, plasma leaks upward */
  const hh = 24 + 14 * sm.Vaso;
  layers.lumenV.setAttribute("y", f1(VY - hh)); layers.lumenV.setAttribute("height", f1(hh * 2));
  const flow = clamp(0.22 + 0.85 * sm.BP);
  vrbc.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > VESR) { r.x = 706; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, VY + r.y * (hh - 10), Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.drop += dt * sm.Vaso * 7; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(712, 925), VY - hh + 3, rnd(-3, 3), -rnd(13, 20), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (VY - hh - p.y) / 55).toFixed(2)); if (p.y < VY - hh - 55) kill(p); });
  /* adrenaline triangles fly in and sit on vessel, airway and mast docking points */
  const adrSlots = [MAST_ABS[0], MAST_ABS[1], AIR_ADR[0], AIR_ADR[1], [750, VY - hh + 3], [810, VY - hh + 3], [870, VY - hh + 3]];
  acc.adr += dt * sm.adr * 4; while (acc.adr >= 1) { acc.adr--; const p = free(adr); if (p) { emit(p, rnd(40, 110), rnd(415, 428), 0, 0, 0); p.slot = Math.floor(Math.random() * adrSlots.length); } }
  adr.forEach((p) => {
    if (!p.on) return;
    const s = adrSlots[p.slot];
    if (p.st === 0) { p.t += dt; p.x += (s[0] - p.x) * Math.min(1, dt * 2.4); p.y += (s[1] - p.y) * Math.min(1, dt * 2.4) - 8 * dt; place(p.e, p.x, p.y, p.t * 120, 1);
      if (Math.hypot(s[0] - p.x, s[1] - p.y) < 7) p.st = 1; }
    else { p.t += dt; place(p.e, s[0] + Math.sin(tm / 300 + p.slot * 2) * 1.5, s[1] + Math.cos(tm / 360 + p.slot) * 1.5, 12 * p.slot, 1); p.e.setAttribute("opacity", clamp(sm.adr * 1.6).toFixed(2)); if (sm.adr < 0.06) kill(p); }
  });
  /* antihistamine squares cover histamine docking points and trap passing mediators */
  const ahSlots = [AIR_AH[0], AIR_AH[1], AIR_AH[2], [770, VY - hh + 3], [830, VY - hh + 3], [890, VY - hh + 3], [foldLcx - 4, LX.y - 12], [foldRcx + 4, LX.y + 12]];
  dockedAh.length = 0;
  acc.ah += dt * sm.ahs * 3; while (acc.ah >= 1) { acc.ah--; const p = free(ah); if (p) { emit(p, rnd(150, 220), rnd(418, 430), 0, 0, 0); p.slot = Math.floor(Math.random() * ahSlots.length); } }
  ah.forEach((p) => {
    if (!p.on) return;
    const s = ahSlots[p.slot];
    if (p.st === 0) { p.t += dt; p.x += (s[0] - p.x) * Math.min(1, dt * 2.2); p.y += (s[1] - p.y) * Math.min(1, dt * 2.2) - 8 * dt; place(p.e, p.x, p.y, p.t * 90, 1);
      if (Math.hypot(s[0] - p.x, s[1] - p.y) < 7) p.st = 1; }
    else { p.t += dt; place(p.e, s[0] + Math.sin(tm / 320 + p.slot * 2.2) * 1.5, s[1] + Math.cos(tm / 380 + p.slot) * 1.5, 45, 1); p.e.setAttribute("opacity", clamp(sm.ahs * 1.6).toFixed(2)); if (sm.ahs < 0.06) kill(p); else dockedAh.push({ x: s[0], y: s[1] }); }
  });
  moveMed(hist); moveMed(med2);
  /* fluid droplets stream into the vessel and join the circulation */
  acc.iv += dt * sm.flu * 7; while (acc.iv >= 1) { acc.iv--; const p = free(iv); if (p) { emit(p, rnd(VESL, VESL + 50), rnd(434, 440), 0, -46, 0); p.ty = VY + rnd(-12, 12); } }
  iv.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (VESL + 16 - p.x) * Math.min(1, dt * 1.5); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y <= p.ty) kill(p); });
  /* gauges and the in-stage caption */
  gg.med.set(sm.M, wordOf(sm.M, 0.32, 0.62, ["low", "raised", "high"])); gg.air.set(sm.Air, wordOf(sm.Air, 0.3, 0.6, ["open", "narrowed", "very narrowed"])); gg.lar.set(sm.Lar, wordOf(sm.Lar, 0.3, 0.65, ["clear", "swollen", "blocked"]));
  gg.vaso.set(sm.Vaso, wordOf(sm.Vaso, 0.3, 0.6, ["tight", "dilated", "very dilated"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.62, ["low", "borderline", "ok"])); gg.br.set(sm.Breath, wordOf(sm.Breath, 0.3, 0.6, ["easy", "hard", "very hard"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
