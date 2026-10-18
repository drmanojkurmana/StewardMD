/* Renal tubular acidosis scene: bicarbonate reclaim, acid secretion, aldosterone, stones, potassium and gauges. */
const layers = { cells: $("cells"), stones: $("stones"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- cells along the tubule walls (every cell body has a visible fill via the cell helper) ---- */
function initCells() {
  for (let i = 0; i < 9; i++) { const top = cell(layers.cells, { cls: "prox", r: 13, nuc: 0.34, seed: i + 1, wob: 0.08 }); place(top, 76 + i * 40, 184, 0, 1);
    const bot = cell(layers.cells, { cls: "prox", r: 13, nuc: 0.34, seed: i + 20, wob: 0.08 }); place(bot, 76 + i * 40, 264, 0, 1); }
  for (let i = 0; i < 10; i++) { const top = cell(layers.cells, { cls: "prin", r: 12, nuc: 0.3, seed: i + 40, wob: 0.08 }); place(top, 522 + i * 40, 184, 0, 1);
    const bot = cell(layers.cells, { cls: "prin", r: 12, nuc: 0.3, seed: i + 60, wob: 0.08 }); place(bot, 522 + i * 40, 264, 0, 1); }
  const alpha = cell(layers.cells, { cls: "alpha", r: 23, nuc: 0.4, seed: 7, wob: 0.1 }); place(alpha, 680, 172, 0, 1);
  const prin = cell(layers.cells, { cls: "prin", r: 19, nuc: 0.36, seed: 9, wob: 0.1 }); place(prin, 792, 176, 0, 1);
  const aldoNode = cell(layers.cells, { cls: "aldo", r: 16, nuc: 0.38, seed: 4, wob: 0.1 }); place(aldoNode, 825, 142, 0, 1);
}
/* ---- stones in the distal lumen ---- */
const stoneGroups = [[724, 226], [792, 234], [856, 222]].map(([x, y], i) => { const g = mk("g", {}, layers.stones);
  mk("path", { class: "rt-stone", d: "M-11 4L-4 -9L7 -7L12 3L4 10L-7 10Z" }, g);
  mk("path", { class: "rt-stone", d: "M-4 0L3 -5L8 2L2 6L-4 5Z" }, g);
  place(g, x, y, i * 24, 0.2); return { g, x, y, i }; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0 }; }); }
const hco3 = pool(26, () => mk("circle", { class: "sc-p p-hco3", r: 3 }, layers.parts));
const hplus = pool(18, () => mk("path", { class: "sc-p p-hplus", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const aldoDots = pool(10, () => mk("circle", { class: "sc-p p-aldo", r: 2.6 }, layers.parts));
const bicTx = pool(10, () => mk("rect", { class: "sc-p p-hco3", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, layers.parts));
const potBlood = [];
function initPot() { for (let i = 0; i < 18; i++) { const e = mk("circle", { class: "sc-p p-pot", r: 3 }, layers.parts); potBlood.push({ e, x: rnd(60, 900), y: rnd(352, 376), v: rnd(0.7, 1.2) }); } }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function resetHco3(p, atLeft) { p.on = true; p.x = atLeft ? 56 : rnd(56, 880); p.y = rnd(212, 238); p.k = Math.random() < sm.reabs ? 1 : 0; p.tx = rnd(150, 400); p.t = 0; p.e.setAttribute("opacity", "1"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Blood and urine";
  [["reabs", "Bicarb reclaim", "g-hco3", "How much filtered bicarbonate the proximal tubule reclaims into the blood. In proximal type 2 this fails and bicarbonate is wasted in urine."],
    ["hsec", "Acid secretion", "g-hplus", "Hydrogen ions secreted by alpha-intercalated cells in the distal tubule and collecting duct. In distal type 1 this fails."],
    ["uph", "Urine pH", "g-hplus", "How acidic the urine can become. If acid cannot be secreted, urine pH stays high (alkaline)."],
    ["stone", "Stones", "g-stone", "Calcium stones favoured by alkaline urine and low citrate in distal type 1 disease."],
    ["pot", "Potassium", "g-pot", "Blood potassium. Low in proximal and distal disease from urinary losses; high in type 4 because aldosterone action is missing."],
    ["chlor", "Chloride", "g-chlor", "Blood chloride rises as bicarbonate falls, keeping the anion gap normal. This is a hyperchloraemic acidosis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bicarbonate", 110, 224, 110, 152, "Bicarbonate in the filtrate. The proximal tubule normally reclaims most of it into the blood; in type 2 it is wasted in the urine.");
  pill(ox, "Proximal cell", 210, 182, 210, 118, "Proximal tubule cell. It reclaims filtered bicarbonate, sodium, glucose and phosphate. Failure here is proximal type 2 acidosis, sometimes as part of Fanconi syndrome.");
  pill(ox, "Alpha cell", 680, 178, 680, 108, "Alpha-intercalated cell of the distal tubule and collecting duct. It secretes hydrogen ions into the urine. Failure here is distal type 1 acidosis.");
  pill(ox, "Aldosterone", 825, 142, 825, 92, "Aldosterone, the salt hormone from the adrenal gland. It supports sodium uptake, potassium excretion and acid handling. Lacking or resisted aldosterone gives type 4 acidosis with high potassium.");
  pill(ox, "Stone", 792, 230, 760, 285, "Calcium stone forming in alkaline urine, a feature of distal type 1 disease.");
  pill(ox, "Potassium", 850, 364, 800, 312, "Potassium in the blood. It rises in type 4 disease and falls from urinary losses in proximal and distal disease.");
  pill(ox, "Urine", 906, 224, 900, 152, "Urine leaving the collecting duct. Its pH shows whether the distal tubule could secrete acid.");
  const bt = pill(ox, "Bicarbonate given", 180, 356, 180, 312, "Bicarbonate treatment enters the blood and replaces bicarbonate that was wasted or not regenerated."); bt.setAttribute("id", "bic-pill");
}
const sm = { reabs: 0.2, hsec: 0.8, acid: 0.7, pot: 0.3, uph: 0.5, stone: 0.1, chlor: 0.8, aldo: 0.8, bic: 0 };
const acc = { h: 0, a: 0, b: 0 };
function init() { initCells(); initPot(); initPanel(); hco3.forEach((p) => resetHco3(p, false)); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.reabs = lerp(sm.reabs, m.reabs, k2); sm.hsec = lerp(sm.hsec, m.hsec, k2); sm.acid = lerp(sm.acid, m.acid, k2); sm.pot = lerp(sm.pot, m.pot, k2);
  sm.uph = lerp(sm.uph, m.uph, k2); sm.stone = lerp(sm.stone, m.stone, k2); sm.chlor = lerp(sm.chlor, m.chlor, k2); sm.aldo = lerp(sm.aldo, m.aldo, k1); sm.bic = lerp(sm.bic, m.bic, k1);
  /* bicarbonate: reclaimed down to blood in the proximal segment, otherwise wasted to urine */
  hco3.forEach((p) => { if (!p.on) resetHco3(p, true);
    if (p.k === 1 && p.x >= p.tx && p.y < 330) { p.y += 52 * dt; p.x += 8 * dt; }
    else if (p.y >= 330) { resetHco3(p, true); return; }
    else p.x += 58 * dt;
    if (p.x > 908) resetHco3(p, true);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* acid secreted by the alpha cell into the distal lumen, then carried to urine */
  acc.h += dt * sm.hsec * 9; while (acc.h >= 1) { acc.h--; const p = freeP(hplus); if (p) emit(p, 680 + rnd(-8, 8), 198, rnd(34, 52), rnd(4, 12), 0); }
  hplus.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 250) p.y = 250; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 908) killP(p); });
  /* aldosterone signal from the adrenal node to the collecting duct cells */
  acc.a += dt * sm.aldo * 5; while (acc.a >= 1) { acc.a--; const p = freeP(aldoDots); if (p) emit(p, 818, 154, 0, 0, 0); }
  aldoDots.forEach((p) => { if (!p.on) return; p.t += dt; const tx = 796, ty = 182, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 44 * dt; p.y += (dy / d) * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8 || p.t > 3) killP(p); });
  /* bicarbonate treatment particles in the blood */
  acc.b += dt * sm.bic * 6; while (acc.b >= 1) { acc.b--; const p = freeP(bicTx); if (p) emit(p, 54, rnd(352, 376), rnd(70, 95), 0, 0); }
  bicTx.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 906) killP(p); });
  /* potassium dots in the blood: visible count follows the potassium level */
  potBlood.forEach((r, i) => { r.x += r.v * 42 * dt; if (r.x > 906) r.x = 54; r.e.setAttribute("transform", "translate(" + f1(r.x) + " " + f1(r.y) + ")"); r.e.setAttribute("opacity", i < Math.round(sm.pot * potBlood.length) ? "1" : "0"); });
  /* stones grow in distal type 1 */
  stoneGroups.forEach((s) => { const sc = 0.15 + 0.95 * sm.stone; place(s.g, s.x, s.y, s.i * 24, sc); s.g.style.opacity = sm.stone > 0.08 ? 1 : 0; });
  const bp = $("bic-pill"); if (bp) bp.style.opacity = sm.bic.toFixed(2);
  /* gauges */
  gg.reabs.set(sm.reabs, wordOf(sm.reabs, 0.35, 0.65, ["failed", "reduced", "working"]));
  gg.hsec.set(sm.hsec, wordOf(sm.hsec, 0.35, 0.65, ["failed", "reduced", "working"]));
  gg.uph.set(sm.uph, wordOf(sm.uph, 0.35, 0.65, ["acidic", "partly acidic", "alkaline"]));
  gg.stone.set(sm.stone, wordOf(sm.stone, 0.3, 0.6, ["none", "some", "forming"]));
  gg.pot.set(sm.pot, wordOf(sm.pot, 0.35, 0.65, ["low", "normal", "high"]));
  gg.chlor.set(sm.chlor, wordOf(sm.chlor, 0.35, 0.7, ["normal", "raised", "high"]));
}
run({ init, step });
