/* Renal tubular acidosis scene: kidney tubule handling, with a visible treatment effect for every option. */
const layers = { cells: $("cells"), stones: $("stones"), parts: $("parts"), over: $("over"), panel: $("panel"), filt: $("filtVessel"), urine: $("urineVessel"), proxW: $("proxWash"), distW: $("distWash"), bloodWbic: $("bloodWbic"), bloodWktx: $("bloodWktx"), kidneyW: $("kidneyWash") };
let kidneyO = null, bladderO = null, capEl = null, capDrug = -1, aldoG = null;
let bladIn = [814, 186], filtStart = [150, 208];
const PRINC = [736, 172], ALPHA = [650, 168], ALDON = [792, 122];
function initOrgans() {
  kidneyO = organ($("kidneySlot"), "kidney", 128, 212, 168, {});
  bladderO = organ($("bladderSlot"), "bladder", 868, 232, 104, {});
  const P = kidneyO.ports, cand = [P.cortex, P.pelvis, P.hilum, P.out].filter(Boolean);
  let pv = cand[0] || [150, 208];
  cand.forEach((c) => { if (Math.hypot(c[0] - 246, c[1] - 224) < Math.hypot(pv[0] - 246, pv[1] - 224)) pv = c; });
  filtStart = pv;
  bladIn = bladderO.ports.in;
  layers.filt.setAttribute("d", "M" + f1(pv[0]) + " " + f1(pv[1]) + " L246 224");
  layers.urine.setAttribute("d", "M770 224 L" + f1(bladIn[0]) + " " + f1(bladIn[1]));
}
/* ---- cells along the tubule walls (every cell body has a visible fill via the cell helper) ---- */
function initCells() {
  for (let i = 0; i < 6; i++) { const top = cell(layers.cells, { cls: "prox", r: 12, nuc: 0.34, seed: i + 1, wob: 0.08 }); place(top, 272 + i * 40, 182, 0, 1);
    const bot = cell(layers.cells, { cls: "prox", r: 12, nuc: 0.34, seed: i + 20, wob: 0.08 }); place(bot, 272 + i * 40, 264, 0, 1); }
  [554, 594].forEach((x, i) => { const t = cell(layers.cells, { cls: "prin", r: 11, nuc: 0.3, seed: i + 40, wob: 0.08 }); place(t, x, 182, 0, 1); });
  for (let i = 0; i < 6; i++) { const b = cell(layers.cells, { cls: "prin", r: 11, nuc: 0.3, seed: i + 60, wob: 0.08 }); place(b, 552 + i * 40, 264, 0, 1); }
  const alpha = cell(layers.cells, { cls: "alpha", r: 22, nuc: 0.4, seed: 7, wob: 0.1 }); place(alpha, ALPHA[0], ALPHA[1], 0, 1);
  const prin = cell(layers.cells, { cls: "prin", r: 18, nuc: 0.36, seed: 9, wob: 0.1 }); place(prin, PRINC[0], PRINC[1], 0, 1);
  aldoG = cell(layers.cells, { cls: "aldo", r: 14, nuc: 0.38, seed: 4, wob: 0.1 }); place(aldoG, ALDON[0], ALDON[1], 0, 1);
}
/* ---- stones in the distal lumen ---- */
const stoneGroups = [[640, 232], [700, 238], [748, 230]].map(([x, y], i) => { const g = mk("g", {}, layers.stones);
  mk("path", { class: "rt-stone", d: "M-11 4L-4 -9L7 -7L12 3L4 10L-7 10Z" }, g);
  mk("path", { class: "rt-stone", d: "M-4 0L3 -5L8 2L2 6L-4 5Z" }, g);
  place(g, x, y, i * 24, 0.2); return { g, x, y, i }; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, st: 0, ang: 0, life: 0 }; }); }
const hco3 = pool(26, () => mk("circle", { class: "sc-p p-hco3", r: 3 }, layers.parts));
const hplus = pool(18, () => mk("path", { class: "sc-p p-hplus", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const aldoDots = pool(12, () => mk("circle", { class: "sc-p p-aldo", r: 2.6 }, layers.parts));
const kOut = pool(12, () => mk("circle", { class: "sc-p p-pot", r: 2.8 }, layers.parts));
const bicTx = pool(10, () => mk("rect", { class: "sc-p p-hco3", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, layers.parts));
const ktxIn = pool(10, () => mk("circle", { class: "sc-p p-pot", r: 3 }, layers.parts));
const potBlood = [];
function initPot() { for (let i = 0; i < 18; i++) { const e = mk("circle", { class: "sc-p p-pot", r: 3 }, layers.parts); potBlood.push({ e, x: rnd(60, 900), y: rnd(352, 376), v: rnd(0.7, 1.2) }); } }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.life = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function resetHco3(p) { p.on = true; p.st = 0; p.x = filtStart[0] + rnd(-4, 4); p.y = filtStart[1] + rnd(-6, 6); p.k = Math.random() < sm.reabs ? 1 : 0; p.tx = rnd(280, 480); p.e.setAttribute("opacity", "1"); }
function toBladder(p, dt, sp) { const dx = bladIn[0] - p.x, dy = bladIn[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; return d; }
/* ---- caption text per treatment ---- */
function capText(d) {
  if (d === 3) return "Bicarbonate replaces the lost alkali. Blood acid falls and stones slow.";
  if (d === 1) return "Potassium replaces urinary losses. It helps only when potassium is low.";
  if (d === 2) return "Mineralocorticoid adds aldosterone action. It helps most when aldosterone is missing.";
  return "No treatment. The tubule wastes what the blood needs, and the blood stays acidic.";
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Blood and urine";
  [["reabs", "Bicarb reclaim", "g-hco3", "How much filtered bicarbonate the proximal tubule reclaims into the blood. In proximal type 2 this fails and bicarbonate is wasted in urine."],
    ["hsec", "Acid secretion", "g-hplus", "Hydrogen ions secreted by alpha cells in the distal tubule and collecting duct. In distal type 1 this fails."],
    ["uph", "Urine pH", "g-hplus", "How acidic the urine can become. If acid cannot be secreted, urine pH stays high (alkaline)."],
    ["stone", "Stones", "g-stone", "Calcium stones favoured by alkaline urine and low citrate in distal type 1 disease. Bicarbonate slows them."],
    ["pot", "Potassium", "g-pot", "Blood potassium. Low in proximal and distal disease from urinary losses; high in type 4 because aldosterone action is missing."],
    ["chlor", "Chloride", "g-chlor", "Blood chloride rises as bicarbonate falls, keeping the anion gap normal. This is a hyperchloraemic acidosis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 196, 206, 150, 116, "Kidney: blood is filtered here. The tubule beside it is shown magnified, much larger than life.");
  pill(ox, "Bicarbonate", 360, 222, 360, 148, "Bicarbonate in the tubule fluid. The proximal tubule normally reclaims it into the blood. In type 2 it is lost in the urine.");
  pill(ox, "Proximal cell", 312, 182, 252, 116, "Proximal tubule cell. It reclaims filtered bicarbonate into the blood. Failure here is proximal type 2 disease.");
  pill(ox, "Acid pump", 650, 166, 650, 104, "Acid pump on the alpha cell. It pushes acid into the urine. Failure here is distal type 1 disease.");
  pill(ox, "Aldosterone", 792, 122, 800, 82, "Aldosterone signal. This salt hormone tells the collecting duct to waste potassium and keep acid moving out. Without it, potassium rises.");
  pill(ox, "Blood", 430, 364, 430, 308, "Blood: bicarbonate, potassium and chloride sampled for the gauges below. Treatment washes tint it.");
  pill(ox, "Stone", 700, 236, 700, 298, "Stone forming in alkaline urine, seen in distal type 1 disease.");
  pill(ox, "Urine", 868, 232, 886, 146, "Urine leaving for the bladder. Its acidity shows whether acid secretion worked.");
  capEl = mk("text", { class: "rt-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { reabs: 0.2, hsec: 0.8, acid: 0.7, pot: 0.3, uph: 0.5, stone: 0.1, chlor: 0.8, aldo: 0.85, bic: 0, ktx: 0, min: 0 };
const acc = { h: 0, a: 0, k: 0, b: 0, k2: 0 };
function init() { initOrgans(); initCells(); initPot(); initPanel(); hco3.forEach((p) => resetHco3(p)); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.reabs = lerp(sm.reabs, m.reabs, k2); sm.hsec = lerp(sm.hsec, m.hsec, k2); sm.acid = lerp(sm.acid, m.acid, k2); sm.pot = lerp(sm.pot, m.pot, k2);
  sm.uph = lerp(sm.uph, m.uph, k2); sm.stone = lerp(sm.stone, m.stone, k2); sm.chlor = lerp(sm.chlor, m.chlor, k2); sm.aldo = lerp(sm.aldo, m.aldo, k1);
  sm.bic = lerp(sm.bic, m.bic, k1); sm.ktx = lerp(sm.ktx, m.ktx, k1); sm.min = lerp(sm.min, m.min, k1);
  /* treatment washes: large tinted areas so every option visibly acts on the drawing */
  layers.proxW.setAttribute("opacity", (0.06 + 0.5 * sm.bic).toFixed(2));
  layers.distW.setAttribute("opacity", (0.05 + 0.32 * sm.bic + 0.5 * sm.min).toFixed(2));
  layers.bloodWbic.setAttribute("opacity", (0.05 + 0.45 * sm.bic).toFixed(2));
  layers.bloodWktx.setAttribute("opacity", (0.05 + 0.45 * sm.ktx).toFixed(2));
  layers.kidneyW.setAttribute("opacity", (0.04 + 0.36 * sm.min).toFixed(2));
  place(aldoG, ALDON[0], ALDON[1], Math.sin(tm / 900) * 8, 1 + 0.18 * sm.min);
  /* bicarbonate: reclaimed down to blood in the proximal segment, otherwise wasted to the bladder */
  hco3.forEach((p) => { if (!p.on) { resetHco3(p); return; }
    if (p.st === 0) { p.x += 60 * dt; p.y += (224 - p.y) * Math.min(1, dt * 3);
      if (p.k === 1 && p.x >= p.tx && p.x < 498) p.st = 1;
      else if (p.x > 766) p.st = 2; }
    else if (p.st === 1) { p.y += 60 * dt; p.x += 8 * dt;
      if (p.y > 330) p.e.setAttribute("opacity", clamp(1 - (p.y - 330) / 28).toFixed(2));
      if (p.y > 358) { resetHco3(p); return; } }
    else { if (toBladder(p, dt, 70) < 10) { resetHco3(p); return; } }
    place(p.e, p.x, p.y, 0, 1); });
  /* acid secreted by the alpha cell into the distal lumen, then carried to the bladder */
  acc.h += dt * (0.5 + 9 * sm.hsec); while (acc.h >= 1) { acc.h--; const p = freeP(hplus); if (p) emit(p, ALPHA[0] + rnd(-8, 8), 192, rnd(34, 52), rnd(4, 12), 0); }
  hplus.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 248) p.y = 248;
    if (p.x > 766) { if (toBladder(p, dt, 70) < 10) { killP(p); return; } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); });
  /* aldosterone signal: dots travel to the principal cell and sit on its surface, then fade */
  acc.a += dt * (0.3 + 5 * sm.aldo); while (acc.a >= 1) { acc.a--; const p = freeP(aldoDots); if (p) { emit(p, ALDON[0], ALDON[1] + 12, 0, 0, 0); p.ang = rnd(3.6, 5.8); p.st = 1; } }
  aldoDots.forEach((p) => { if (!p.on) return;
    if (p.st === 1) { const tx = PRINC[0] + Math.cos(p.ang) * 20, ty = PRINC[1] + Math.sin(p.ang) * 18, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt;
      if (d < 6) { if (Math.random() < 0.55) { p.st = 2; p.life = rnd(3, 5.5); } else { killP(p); return; } } }
    else { p.ang += dt * 0.9; p.life -= dt; p.x = PRINC[0] + Math.cos(p.ang) * 21; p.y = PRINC[1] + Math.sin(p.ang) * 19;
      if (p.life < 1) p.e.setAttribute("opacity", clamp(p.life).toFixed(2));
      if (p.life <= 0) { killP(p); return; } }
    place(p.e, p.x, p.y, 0, 1); });
  /* potassium excreted by the principal cell: strong with aldosterone, a trickle without */
  acc.k += dt * (0.2 + 5.5 * sm.aldo); while (acc.k >= 1) { acc.k--; const p = freeP(kOut); if (p) emit(p, PRINC[0] + rnd(-10, 10), 192, rnd(30, 50), rnd(6, 14), 0); }
  kOut.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 246) p.y = 246;
    if (p.x > 766) { if (toBladder(p, dt, 70) < 10) { killP(p); return; } }
    place(p.e, p.x, p.y, 0, 1); });
  /* bicarbonate treatment floods the blood */
  acc.b += dt * 7 * sm.bic; while (acc.b >= 1) { acc.b--; const p = freeP(bicTx); if (p) emit(p, 54, rnd(352, 376), rnd(70, 95), 0, 0); }
  bicTx.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 906) killP(p); });
  /* potassium treatment feeds the blood */
  acc.k2 += dt * 7 * sm.ktx; while (acc.k2 >= 1) { acc.k2--; const p = freeP(ktxIn); if (p) emit(p, 54, rnd(352, 376), rnd(60, 90), 0, 0); }
  ktxIn.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 906) killP(p); });
  /* potassium dots in the blood: visible count follows the potassium level */
  potBlood.forEach((r, i) => { r.x += r.v * 42 * dt; if (r.x > 906) r.x = 54; r.e.setAttribute("transform", "translate(" + f1(r.x) + " " + f1(r.y) + ")"); r.e.setAttribute("opacity", i < Math.round(sm.pot * potBlood.length) ? "1" : "0"); });
  /* stones grow in distal type 1 */
  stoneGroups.forEach((s) => { const sc = 0.15 + 0.95 * sm.stone; place(s.g, s.x, s.y, s.i * 24, sc); s.g.style.opacity = sm.stone > 0.08 ? 1 : 0; });
  /* gauges */
  gg.reabs.set(sm.reabs, wordOf(sm.reabs, 0.35, 0.65, ["failed", "reduced", "working"]));
  gg.hsec.set(sm.hsec, wordOf(sm.hsec, 0.35, 0.65, ["failed", "reduced", "working"]));
  gg.uph.set(sm.uph, wordOf(sm.uph, 0.35, 0.65, ["acidic", "partly acidic", "alkaline"]));
  gg.stone.set(sm.stone, wordOf(sm.stone, 0.3, 0.6, ["none", "some", "forming"]));
  gg.pot.set(sm.pot, wordOf(sm.pot, 0.35, 0.65, ["low", "normal", "high"]));
  gg.chlor.set(sm.chlor, wordOf(sm.chlor, 0.35, 0.7, ["normal", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
