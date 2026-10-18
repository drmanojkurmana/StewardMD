/* Gastrointestinal hormones scene: brain and vagus, stomach acid, duodenal signals, pancreas outputs, drug block. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), ducts: $("ducts"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0, st: 0, bx: 0, by: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
const onCount = (pl) => pl.reduce((n, p) => n + (p.on ? 1 : 0), 0);
function emit(p, x, y, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.tx = tx; p.ty = ty; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const atP = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
function moveP(p, dt, speed) { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * dt; p.y += (dy / d) * speed * dt; p.x = clamp(p.x, 22, WW - 22); p.y = clamp(p.y, 52, 438); atP(p); if (d < 9) killP(p); }

/* ---- fixed micro anatomy (cells are signals, organs carry the shapes) ---- */
const VAG = [170, 150], PAR = [225, 250], ECL = [196, 218], DCELL = [345, 200], GCELL = [325, 252];
const ICELL = [468, 140], KCELL = [468, 250], SCELL = [562, 250], LCELL = [592, 145];
const ACIN = [690, 258], DUCT = [758, 258], BETA = [812, 252], GB = [880, 124];
const DUOD = [528, 182];

let brainO = null, stomachO = null, intestO = null, pancO = null;
let gbBody = null, acidPoolEl = null, bicPoolEl = null, capEl = null, capL = -1, capD = -1;
let foodTr = null;

function capText(l, d) {
  if (d === 1) return "PPI plugs the acid pump. Acid falls and gastrin rises.";
  if (d === 2) return "Somatostatin analogue brakes every gut signal. All outputs fall.";
  if (l === 0) return "No treatment. The sight of food wakes the vagus first.";
  if (l === 2) return "No treatment. The gut releases CCK, bicarbonate and insulin.";
  return "No treatment. Gastrin and histamine switch stomach acid on.";
}

function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 100, 115, 120, {});
  stomachO = organ($("stomachSlot"), "stomach", 270, 200, 190, {});
  intestO = organ($("intestSlot"), "intestine", 510, 200, 180, {});
  pancO = organ($("pancSlot"), "pancreas", 740, 220, 200, {});
  const stem = brainO.ports.stem, duo = intestO.ports.duodenum, din = intestO.ports.in;
  DUOD[0] = Math.round(duo[0]); DUOD[1] = Math.round(duo[1]);
  const sin = stomachO.ports.in, ant = stomachO.ports.antrum, pyl = stomachO.ports.pylorus;
  mk("path", { class: "gi-vagus", d: "M" + f1(stem[0]) + " " + f1(stem[1]) + " C130 158 150 155 " + VAG[0] + " " + VAG[1] }, layers.ducts);
  mk("path", { class: "gi-vagus", d: "M" + VAG[0] + " " + VAG[1] + " C190 175 205 215 " + PAR[0] + " " + PAR[1] }, layers.ducts);
  const food = [[sin[0], sin[1]], [(sin[0] + ant[0]) / 2, (sin[1] + ant[1]) / 2], ant, pyl, [(pyl[0] + din[0]) / 2, (pyl[1] + din[1]) / 2 + 4], din];
  foodTr = track(food);
  mk("path", { class: "gi-tube", d: "M" + food.map((q) => f1(q[0]) + " " + f1(q[1])).join("L") }, layers.ducts);
  mk("path", { class: "gi-duct", d: "M868 142 C770 148 620 168 " + DUOD[0] + " " + DUOD[1] }, layers.ducts);
  mk("path", { class: "gi-duct", d: "M" + ACIN[0] + " " + ACIN[1] + " C630 245 575 215 " + DUOD[0] + " " + DUOD[1] }, layers.ducts);
  acidPoolEl = $("acidPool"); bicPoolEl = $("bicPool");
}

function initCells() {
  cell(layers.cells, { cls: "vagus", r: 14, nuc: 0.36, seed: 3, wob: 0.12, x: VAG[0], y: VAG[1] });
  cell(layers.cells, { cls: "par", r: 16, nuc: 0.34, seed: 5, wob: 0.10, x: PAR[0], y: PAR[1] });
  cell(layers.cells, { cls: "ecl", r: 11, nuc: 0.34, seed: 8, wob: 0.12, x: ECL[0], y: ECL[1] });
  cell(layers.cells, { cls: "dcell", r: 11, nuc: 0.34, seed: 12, wob: 0.12, x: DCELL[0], y: DCELL[1] });
  cell(layers.cells, { cls: "gcell", r: 15, nuc: 0.36, seed: 15, wob: 0.11, x: GCELL[0], y: GCELL[1] });
  cell(layers.cells, { cls: "icell", r: 14, nuc: 0.36, seed: 18, wob: 0.11, x: ICELL[0], y: ICELL[1] });
  cell(layers.cells, { cls: "kcell", r: 12, nuc: 0.36, seed: 21, wob: 0.12, x: KCELL[0], y: KCELL[1] });
  cell(layers.cells, { cls: "scell", r: 13, nuc: 0.36, seed: 24, wob: 0.11, x: SCELL[0], y: SCELL[1] });
  cell(layers.cells, { cls: "lcell", r: 12, nuc: 0.36, seed: 27, wob: 0.12, x: LCELL[0], y: LCELL[1] });
  cell(layers.cells, { cls: "acinar", r: 15, nuc: 0.34, seed: 30, wob: 0.10, x: ACIN[0], y: ACIN[1] });
  cell(layers.cells, { cls: "ductc", r: 14, nuc: 0.34, seed: 33, wob: 0.11, x: DUCT[0], y: DUCT[1] });
  cell(layers.cells, { cls: "beta", r: 16, nuc: 0.38, seed: 36, wob: 0.10, x: BETA[0], y: BETA[1] });
  mk("path", { class: "gi-gbneck", d: "M870 140 L858 152" }, layers.cells);
  gbBody = mk("ellipse", { class: "gi-gb", cx: GB[0], cy: GB[1], rx: 15, ry: 18 }, layers.cells);
}

/* ---- treatment block marks ---- */
let ppiMark = null, somaMark = null;
function xMark(parent, x, y, s) {
  const g = mk("g", { opacity: "0", transform: "translate(" + x + " " + y + ")" }, parent);
  mk("path", { class: "gi-block", d: "M" + -s + " " + -s + "L" + s + " " + s + "M" + s + " " + -s + "L" + -s + " " + s }, g);
  return g;
}
function initMarks() {
  ppiMark = xMark(layers.marks, PAR[0], PAR[1], 24);
  somaMark = mk("g", { opacity: "0" }, layers.marks);
  [[GCELL[0], GCELL[1], 21], [ICELL[0], ICELL[1], 20], [SCELL[0], SCELL[1], 19], [KCELL[0], KCELL[1], 18], [LCELL[0], LCELL[1], 18]].forEach(([x, y, s]) => {
    mk("path", { class: "gi-block", d: "M" + (x - s) + " " + (y - s) + "L" + (x + s) + " " + (y + s) + "M" + (x + s) + " " + (y - s) + "L" + (x - s) + " " + (y + s) }, somaMark);
  });
}

/* ---- particle pools ---- */
const vagP = pool(8, dot("p-vag", 2.6));
const histP = pool(8, dot("p-hist", 2.4));
const gasP = pool(14, dot("p-gas", 2.8));
const acidP = pool(16, dot("p-acid", 2.6));
const cckP = pool(12, dot("p-cck", 2.7));
const secP = pool(10, dot("p-sec", 2.6));
const bicP = pool(12, dot("p-bic", 2.6));
const enzP = pool(12, dot("p-enz", 2.8));
const bileP = pool(8, dot("p-bile", 2.8));
const incrP = pool(12, dot("p-incr", 2.7));
const insP = pool(10, dot("p-ins", 2.8));
const somaP = pool(8, dot("p-soma", 2.6));
const ppiB = pool(10, dot("p-ppi", 3));
const sdB = pool(14, dot("p-somad", 3));
const foodDots = Array.from({ length: 12 }, (_, i) => ({ e: dot("p-food", 3.4)(), u: i / 12 }));
const bloodGas = Array.from({ length: 16 }, () => ({ e: dot("p-gas", 2.6)(), x: rnd(30, 930), r: rnd(-0.7, 0.7) }));
const bloodIns = Array.from({ length: 14 }, () => ({ e: dot("p-ins", 2.6)(), x: rnd(30, 930), r: rnd(-0.7, 0.7) }));
const SDT = [GCELL, ICELL, SCELL, KCELL, LCELL];

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Hormones and outputs";
  [["gas", "Gastrin", "g-gas", "Gastrin from stomach G cells. It drives parietal acid, in blood and locally. It rises when a PPI removes acid feedback."], ["acid", "Acid", "g-acid", "Stomach acid from parietal cells, driven by gastrin, histamine and the vagus acting on the acid pump. A PPI plugs that pump."], ["enz", "Enzymes", "g-enz", "Pancreatic enzymes driven by CCK from duodenal I cells, released into the duodenum to digest food."], ["bic", "Bicarbonate", "g-bic", "Bicarbonate from pancreatic duct cells, driven by secretin from S cells. It neutralises acid chyme from the stomach."], ["ins", "Insulin", "g-ins", "Insulin from pancreatic beta cells. Gut incretin hormones boost its release when food arrives."], ["soma", "Somatostatin", "g-soma", "Somatostatin from D cells: the brake. It holds back gastrin, acid and most gut hormone release. An analogue brakes everything at once."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 105 + i * 155, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Vagus", VAG[0], VAG[1], 205, 64, "Vagus nerve: in the cephalic phase, the sight and smell of food send signals down the vagus that prime stomach acid before food arrives.");
  pill(ox, "Stomach", 247, 124, 310, 64, "Stomach: food stretch and peptides switch on G cells, and parietal cells pump acid into it.");
  pill(ox, "Gallbladder", GB[0], GB[1], 868, 64, "Gallbladder: the gut hormone CCK squeezes it, pushing bile down its duct to meet fat.");
  pill(ox, "Acid pump", PAR[0], PAR[1], 200, 312, "Acid pump: on the parietal cell. Gastrin, histamine and vagal signals switch it on. A PPI plugs it shut.");
  pill(ox, "G cell", GCELL[0], GCELL[1], 350, 312, "G cell: in the stomach wall. Food switches it on to release gastrin. Acid and somatostatin switch it off.");
  pill(ox, "Duodenum", 510, 250, 540, 312, "Duodenum: acid and fat arriving here switch on CCK, secretin and incretin signals.");
  pill(ox, "Pancreas", 740, 207, 700, 312, "Pancreas: CCK drives enzymes from acinar cells and secretin drives bicarbonate from duct cells.");
  pill(ox, "Beta cell", BETA[0], BETA[1], 830, 312, "Beta cell: in the pancreas. Gut incretin hormones boost its insulin release when food arrives.");
  capEl = mk("text", { class: "dr-pt", x: 30, y: 428 }, ox); capEl.textContent = capText(1, 0);
}
/* drug particles travel in blood, then sit on their target while the drug is on */
function drugEmit(pl, tgt) {
  const p = freeP(pl); if (!p) return;
  const i = pl.indexOf(p);
  let tx, ty;
  if (tgt === PAR) { const a = i * 0.628; tx = tgt[0] + Math.cos(a) * 27; ty = tgt[1] + Math.sin(a) * 27; }
  else { const nd = SDT[i % SDT.length], a = Math.floor(i / SDT.length) * 2.2 + (i % SDT.length) * 0.3; tx = nd[0] + Math.cos(a) * 23; ty = nd[1] + Math.sin(a) * 23; }
  emit(p, rnd(60, 900), CY + rnd(-10, 10), tx, ty, 0);
}
function drugStep(pl, dt, smV, speed) {
  pl.forEach((p, idx) => {
    if (!p.on) return;
    if (p.st === 0) {
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * speed * dt; p.y += (dy / d) * speed * dt; atP(p);
      if (d < 8) { p.st = 1; p.bx = p.tx; p.by = p.ty; }
    } else if (p.st === 1) {
      if (smV < 0.25) { p.st = 2; p.vy = 46; }
      else { p.x = p.bx + Math.sin(tm / 300 + idx * 1.7) * 2.5; p.y = p.by + Math.cos(tm / 340 + idx) * 2.5; atP(p); }
    } else {
      p.y += p.vy * dt; p.x += Math.sin(tm / 400 + idx) * 8 * dt; atP(p);
      p.e.setAttribute("opacity", clamp(1 - (p.y - 330) / 38).toFixed(2));
      if (p.y > 368) killP(p);
    }
  });
}
const sm = { V: 0.4, Hist: 0.3, Gas: 0.4, Acid: 0.3, CCK: 0.2, Sec: 0.2, Incr: 0.2, Enz: 0.2, Bic: 0.2, GB: 0.2, Ins: 0.2, Soma: 0.3, ppi: 0, somaD: 0 };
const acc = { vag: 0, hist: 0, gas: 0, acid: 0, cck: 0, sec: 0, bic: 0, enz: 0, bile: 0, incr: 0, ins: 0, soma: 0, ppi: 0, sd: 0 };
function init() { initOrgans(); initCells(); initMarks(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.V = lerp(sm.V, m.V, k2); sm.Hist = lerp(sm.Hist, m.Hist, k2); sm.Gas = lerp(sm.Gas, m.Gas, k2); sm.Acid = lerp(sm.Acid, m.Acid, k1); sm.CCK = lerp(sm.CCK, m.CCK, k2); sm.Sec = lerp(sm.Sec, m.Sec, k2); sm.Incr = lerp(sm.Incr, m.Incr, k2); sm.Enz = lerp(sm.Enz, m.Enz, k2); sm.Bic = lerp(sm.Bic, m.Bic, k2); sm.GB = lerp(sm.GB, m.GB, k2); sm.Ins = lerp(sm.Ins, m.Ins, k2); sm.Soma = lerp(sm.Soma, m.Soma, k2); sm.ppi = lerp(sm.ppi, m.ppi, k1); sm.somaD = lerp(sm.somaD, m.somaD, k1);
  ppiMark.setAttribute("opacity", sm.ppi.toFixed(2));
  somaMark.setAttribute("opacity", sm.somaD.toFixed(2));
  gbBody.setAttribute("rx", f1(15 - 6 * sm.GB * (0.6 + 0.4 * Math.sin(tm / 360))));
  if (acidPoolEl) { acidPoolEl.setAttribute("opacity", (0.12 + 0.62 * sm.Acid).toFixed(2)); acidPoolEl.setAttribute("rx", f1(52 * (0.75 + 0.35 * sm.Acid))); }
  if (bicPoolEl) bicPoolEl.setAttribute("opacity", (0.08 + 0.55 * sm.Bic).toFixed(2));
  /* vagus to parietal and G cells */
  acc.vag += dt * sm.V * 3.2; while (acc.vag >= 1) { acc.vag--; const p = freeP(vagP); if (p) emit(p, VAG[0], VAG[1], Math.random() < 0.6 ? PAR[0] : GCELL[0], Math.random() < 0.6 ? PAR[1] : GCELL[1], 0); }
  vagP.forEach((p) => moveP(p, dt, 62));
  /* histamine ECL to parietal */
  acc.hist += dt * sm.Hist * 4; while (acc.hist >= 1) { acc.hist--; const p = freeP(histP); if (p) emit(p, ECL[0], ECL[1], PAR[0], PAR[1], 0); }
  histP.forEach((p) => moveP(p, dt, 52));
  /* gastrin G cell to parietal and to blood */
  acc.gas += dt * sm.Gas * 4.2; while (acc.gas >= 1) { acc.gas--; const p = freeP(gasP); if (p) { const toBlood = Math.random() < 0.45; emit(p, GCELL[0], GCELL[1], toBlood ? GCELL[0] + rnd(-8, 8) : PAR[0], toBlood ? CY - 4 : PAR[1], 0); } }
  gasP.forEach((p) => moveP(p, dt, 58));
  /* acid parietal into the stomach */
  acc.acid += dt * sm.Acid * 7; while (acc.acid >= 1) { acc.acid--; const p = freeP(acidP); if (p) emit(p, PAR[0] + 6, PAR[1] - 8, 270 + rnd(-38, 38), 195 + rnd(-24, 24), 0); }
  acidP.forEach((p) => moveP(p, dt, 46));
  /* somatostatin D cell to G and parietal cells */
  acc.soma += dt * sm.Soma * 3; while (acc.soma >= 1) { acc.soma--; const p = freeP(somaP); if (p) emit(p, DCELL[0], DCELL[1], Math.random() < 0.5 ? GCELL[0] : PAR[0], Math.random() < 0.5 ? GCELL[1] : PAR[1], 0); }
  somaP.forEach((p) => moveP(p, dt, 50));
  /* CCK I cell to acinar cells and gallbladder */
  acc.cck += dt * sm.CCK * 4.2; while (acc.cck >= 1) { acc.cck--; const p = freeP(cckP); if (p) { const toGb = Math.random() < 0.4; emit(p, ICELL[0] + 6, ICELL[1], toGb ? GB[0] - 8 : ACIN[0], toGb ? GB[1] : ACIN[1], 0); } }
  cckP.forEach((p) => moveP(p, dt, 66));
  /* secretin S cell to duct cells */
  acc.sec += dt * sm.Sec * 4; while (acc.sec >= 1) { acc.sec--; const p = freeP(secP); if (p) emit(p, SCELL[0], SCELL[1], DUCT[0], DUCT[1], 0); }
  secP.forEach((p) => moveP(p, dt, 60));
  /* bicarbonate duct to duodenum */
  acc.bic += dt * sm.Bic * 5; while (acc.bic >= 1) { acc.bic--; const p = freeP(bicP); if (p) emit(p, DUCT[0] - 10, DUCT[1] - 8, DUOD[0] + rnd(-24, 24), DUOD[1] + rnd(-14, 14), 0); }
  bicP.forEach((p) => moveP(p, dt, 62));
  /* enzymes acinar to duodenum */
  acc.enz += dt * sm.Enz * 5; while (acc.enz >= 1) { acc.enz--; const p = freeP(enzP); if (p) emit(p, ACIN[0] - 8, ACIN[1] - 8, DUOD[0] + rnd(-24, 24), DUOD[1] + rnd(-14, 14), 0); }
  enzP.forEach((p) => moveP(p, dt, 62));
  /* bile gallbladder to duodenum */
  acc.bile += dt * sm.GB * 3.4; while (acc.bile >= 1) { acc.bile--; const p = freeP(bileP); if (p) emit(p, 866, 144, DUOD[0] + rnd(-18, 18), DUOD[1] + rnd(-12, 12), 0); }
  bileP.forEach((p) => moveP(p, dt, 64));
  /* incretins K and L cells to beta cell */
  acc.incr += dt * sm.Incr * 4.4; while (acc.incr >= 1) { acc.incr--; const p = freeP(incrP); if (p) { const fromL = Math.random() < 0.5; emit(p, fromL ? LCELL[0] : KCELL[0], fromL ? LCELL[1] : KCELL[1], BETA[0], BETA[1], 0); } }
  incrP.forEach((p) => moveP(p, dt, 62));
  /* insulin beta cell to blood */
  acc.ins += dt * sm.Ins * 4; while (acc.ins >= 1) { acc.ins--; const p = freeP(insP); if (p) emit(p, BETA[0], BETA[1] + 10, BETA[0], CY - 4, 0); }
  insP.forEach((p) => moveP(p, dt, 56));
  /* drug particles ride the blood, then sit on their targets */
  acc.ppi += dt * sm.ppi * 5; while (acc.ppi >= 1) { acc.ppi--; if (onCount(ppiB) < 10) drugEmit(ppiB, PAR); }
  drugStep(ppiB, dt, sm.ppi, 70);
  acc.sd += dt * sm.somaD * 6; while (acc.sd >= 1) { acc.sd--; if (onCount(sdB) < 14) drugEmit(sdB, null); }
  drugStep(sdB, dt, sm.somaD, 70);
  /* food and chyme along stomach to duodenum, faster in the intestinal phase */
  const foodSpeed = 0.018 + 0.050 * sm.CCK + 0.020 * sm.Gas;
  const foodWant = m.ph === 0 ? 4 : m.ph === 1 ? 10 : 12;
  foodDots.forEach((d, i) => { d.u = (d.u + dt * foodSpeed) % 1; const a = foodTr.at(d.u); d.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); d.e.setAttribute("opacity", i < foodWant ? "1" : "0"); });
  /* blood flow carrying gastrin and insulin */
  const wg = Math.round(sm.Gas * bloodGas.length), wi = Math.round(sm.Ins * bloodIns.length);
  [[bloodGas, wg], [bloodIns, wi]].forEach(([arr, want]) => arr.forEach((p, i) => { p.x += 54 * dt; if (p.x > 938) { p.x = 22; p.r = rnd(-0.7, 0.7); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * 18) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); }));
  gg.gas.set(sm.Gas, wordOf(sm.Gas, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.acid.set(sm.Acid, wordOf(sm.Acid, 0.25, 0.6, ["low", "moderate", "high"]));
  gg.enz.set(sm.Enz, wordOf(sm.Enz, 0.25, 0.6, ["low", "some", "high"]));
  gg.bic.set(sm.Bic, wordOf(sm.Bic, 0.25, 0.6, ["low", "some", "high"]));
  gg.ins.set(sm.Ins, wordOf(sm.Ins, 0.25, 0.6, ["low", "some", "high"]));
  gg.soma.set(sm.Soma, wordOf(sm.Soma, 0.3, 0.65, ["low", "moderate", "high"]));
  if (level !== capL || drug !== capD) { capL = level; capD = drug; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
