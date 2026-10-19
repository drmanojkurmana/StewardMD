/* Respiratory failure scene: brain drive, airway, two real lungs, diaphragm pump,
 * magnified air sac and capillary, arterial blood, treatment apparatus and gauges. */
const layers = { app: $("apparatus"), alv: $("alvG"), zoom: $("zoomG"), art: $("artG"), parts: $("parts"), over: $("over"), panel: $("panel"), diaph: $("diaph") };
let brainO = null, lungL = null, lungR = null, memb = null, capEl = null, capKey = "";
let trAirL = null, trAirR = null, trSig = null, bel = null;
const ALV = [];
const zrbc = [];
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 105, 165, 150, {});
  lungL = organ($("lungSlotL"), "lung", 345, 255, 175, { flip: true });
  lungR = organ($("lungSlotR"), "lung", 535, 255, 175, {});
  const hilL = [lungL.x + lungL.w * 0.42, lungL.y + 8], hilR = [lungR.x - lungR.w * 0.42, lungR.y + 8];
  $("bronch").setAttribute("d", "M440 168L" + f1(hilL[0]) + " " + f1(hilL[1]) + "M440 168L" + f1(hilR[0]) + " " + f1(hilR[1]));
  const stem = brainO.ports.stem || brainO.ports.in;
  $("signal").setAttribute("d", "M" + f1(stem[0]) + " " + f1(stem[1]) + "L220 300L320 348L440 358");
  trSig = track([stem, [220, 300], [320, 348], [440, 358]]);
  trAirL = track([[440, 84], [440, 168], hilL]);
  trAirR = track([[440, 84], [440, 168], hilR]);
  const grid = [0.30, 0.5, 0.70];
  [["L", lungL], ["R", lungR]].forEach(([side, L]) => {
    grid.forEach((fx, ix) => {
      [0.32, 0.62].forEach((fy, iy) => {
        const i = ALV.length;
        const e = mk("circle", { class: i % 3 === 2 ? "rf-alv-bad" : "rf-alv", r: 12 }, layers.alv);
        ALV.push({ e, side, fx, fy, bad: i % 3 === 2, x: 0, y: 0 });
      });
    });
  });
  placeAlv(0);
}
function placeAlv(br) {
  ALV.forEach((a) => {
    const L = a.side === "L" ? lungL : lungR;
    a.x = L.x + (a.fx - 0.5) * L.w * 0.62;
    a.y = L.y + (a.fy - 0.5) * L.h * 0.62;
    a.e.setAttribute("cx", f1(a.x)); a.e.setAttribute("cy", f1(a.y));
  });
}
/* lookup lives in a function, keyed by drug then level */
function capText(d, l) {
  if (d === 1 && l === 0) return "Oxygen enriches each breath. Blood oxygen rises.";
  if (d === 1 && l === 1) return "Oxygen lifts blood oxygen but the pump still cannot clear CO2.";
  if (d === 1) return "Oxygen lifts blood oxygen but CO2 stays high until air moves.";
  if (d === 2 && l === 0) return "The mask boosts each breath. Blood oxygen rises.";
  if (d === 2 && l === 1) return "The mask boosts each breath. CO2 falls and oxygen recovers.";
  if (d === 2) return "The mask boosts each breath. CO2 falls and oxygen rises.";
  if (d === 3 && l === 0) return "The ventilator takes over. Air moves fully and oxygen recovers.";
  if (d === 3 && l === 1) return "The ventilator takes over. CO2 is blown off and oxygen recovers.";
  if (d === 3) return "The ventilator takes over. CO2 falls and oxygen keeps rising.";
  if (l === 0) return "No treatment. Air sacs fail, so oxygen in blood stays low.";
  if (l === 1) return "No treatment. Weak pump, so CO2 builds up and blood turns acidic.";
  return "No treatment. Bad air sacs plus weak pump. Oxygen low, CO2 high.";
}
/* ---- magnified air sac and capillary ---- */
function initZoom() {
  mk("circle", { class: "rf-bigalv", cx: 790, cy: 160, r: 52 }, layers.zoom);
  memb = mk("circle", { id: "memb", class: "rf-memb", cx: 790, cy: 160, r: 59, "stroke-width": 3 }, layers.zoom);
  const cap = mk("rect", { class: "rf-capv hot", x: 680, y: 230, width: 220, height: 26, rx: 13, tabindex: "0", "data-info": "Capillary past the air sac. It picks up oxygen and drops off carbon dioxide. A thick wall slows oxygen down." }, layers.zoom);
  cap.setAttribute("id", "capRect");
  for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.zoom); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); zrbc.push({ g, x: 690 + i * 36, v: rnd(0.8, 1.2) }); }
}
/* ---- arterial red cells ---- */
const arbc = [];
function initArt() { for (let i = 0; i < 5; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.art); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); arbc.push({ g, x: 690 + i * 46, v: rnd(0.8, 1.2) }); } }
/* ---- treatment apparatus ---- */
let oxyG = null, nivG = null, invG = null, belBox = null;
function initApp() {
  oxyG = mk("g", { opacity: "0" }, layers.app);
  const cyl = mk("rect", { class: "rf-cyl hot", x: 474, y: 52, width: 30, height: 58, rx: 9, tabindex: "0", "data-info": "Oxygen supply. It enriches each breath so more oxygen crosses into blood. It does not move CO2 out." }, oxyG);
  cyl.setAttribute("id", "cylRect");
  mk("rect", { class: "rf-cyl", x: 481, y: 44, width: 16, height: 10, rx: 3 }, oxyG);
  mk("path", { class: "rf-bronch", d: "M482 82L452 100" }, oxyG);
  nivG = mk("g", { opacity: "0" }, layers.app);
  const mask = mk("ellipse", { class: "rf-mask hot", cx: 440, cy: 70, rx: 40, ry: 18, tabindex: "0", "data-info": "Mask ventilation. The mask pushes air in to boost each breath, so CO2 falls and effort eases." }, nivG);
  mask.setAttribute("id", "maskEl");
  mk("path", { class: "rf-bronch", d: "M400 66L372 52M480 66L508 52" }, nivG);
  invG = mk("g", { opacity: "0" }, layers.app);
  const tube = mk("rect", { class: "rf-vtube hot", x: 434, y: 50, width: 12, height: 122, rx: 5, tabindex: "0", "data-info": "Ventilator tube. It sits in the airway so the machine can take over breathing fully." }, invG);
  tube.setAttribute("id", "tubeRect");
  mk("rect", { class: "rf-vtube", x: 428, y: 42, width: 24, height: 13, rx: 4 }, invG);
  mk("path", { class: "rf-hose", d: "M220 380C300 378 350 300 430 210" }, invG);
  belBox = mk("g", { opacity: "0" }, layers.app);
  const box = mk("rect", { class: "rf-box hot", x: 36, y: 336, width: 184, height: 88, rx: 14, tabindex: "0", "data-info": "Ventilator. Its bellows squeeze on a timer, pushing full breaths in and letting CO2 wash out." }, belBox);
  box.setAttribute("id", "belBoxRect");
  bel = mk("rect", { class: "rf-bel", x: 52, y: 352, width: 120, height: 56, rx: 10 }, belBox);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, fate: 0 }; }); }
const air = pool(20, () => mk("circle", { class: "sc-p p-air", r: 3 }, layers.parts));
const oxair = pool(16, () => mk("circle", { class: "sc-p p-o2", r: 3 }, layers.parts));
const puff = pool(12, () => mk("circle", { class: "sc-p p-co2", r: 3 }, layers.parts));
const sig = pool(10, () => mk("circle", { class: "sc-p p-sig", r: 2.6 }, layers.parts));
const o2z = pool(24, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
const co2z = pool(20, () => mk("circle", { class: "sc-p p-co2", r: 2.6 }, layers.parts));
const acid = pool(12, () => mk("circle", { class: "sc-p p-acid", r: 2.8 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vent", "Ventilation", "g-vent", "Alveolar ventilation: how much fresh air reaches the air sacs each minute. Set by the drive, muscles and airways."],
    ["exch", "Exchange", "g-exch", "Gas exchange across the air sac wall. Lost with mismatch, shunt and thick walls."],
    ["o2", "Oxygen", "g-o2", "Arterial oxygen. Falls in type 1 failure and when ventilation is too low to bring oxygen in."],
    ["co2", "CO2", "g-co2g", "Arterial carbon dioxide. Cleared only by alveolar ventilation, so it rises when the pump fails."],
    ["ph", "pH", "g-ph", "Blood pH. Retained carbon dioxide makes it fall: respiratory acidosis."],
    ["eff", "Effort", "g-eff", "Work of breathing. High when the air sacs are stiff or the pump is weak; support unloads it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  const bTop = brainO.y - brainO.h / 2;
  pill(ox, "Drive", brainO.x, bTop + 6, brainO.x, bTop - 34, "Brain drive. The brainstem fires the signal to breathe. A weak signal starts type 2 failure.");
  pill(ox, "Airway", 440, 112, 340, 70, "Airway into the lungs. Air, added oxygen and machine breaths all travel down it.");
  pill(ox, "Lung", 275, 240, 205, 150, "Lung. Air sacs inside swap oxygen and carbon dioxide with the blood.");
  pill(ox, "Air sacs", 758, 122, 700, 80, "Magnified air sac. Oxygen crosses its wall into the capillary; a thick swollen wall blocks oxygen.");
  pill(ox, "Blood", 800, 385, 862, 420, "Arterial blood leaving the lung. Redder means more oxygen; bubbles mean acid from retained CO2.");
  pill(ox, "Pump", 540, 378, 606, 420, "Breathing pump. The diaphragm flattens to draw air in. Weak muscles cause type 2 failure.");
  const op = pill(ox, "Oxygen", 489, 80, 566, 64, "Added oxygen enriches inspired air. It helps mismatch and thick walls, less so true shunt, and does not clear carbon dioxide."); op.setAttribute("id", "oxy-pill");
  const np = pill(ox, "Mask", 440, 52, 566, 102, "Mask ventilation: air pushed in through a mask boosts each breath, so carbon dioxide falls."); np.setAttribute("id", "niv-pill");
  const ip = pill(ox, "Ventilator", 440, 56, 566, 102, "Invasive ventilation: a tube in the airway lets the machine take over the work of breathing."); ip.setAttribute("id", "inv-pill");
  capEl = mk("text", { class: "rf-cap", x: 30, y: 436 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { G: 0.8, Pf: 0.2, V: 0.7, E: 0.3, O: 0.3, C: 0.4, P: 0.5, Ef: 0.5, Cross: 0.3, ox: 0, niv: 0, inv: 0, vent: 0 };
const acc = { air: 0, ox: 0, ex: 0, sg: 0, o2: 0, co2: 0, acid: 0 };
let bph = 0;
function init() { initOrgans(); initZoom(); initArt(); initApp(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.G = lerp(sm.G, m.G, k2); sm.Pf = lerp(sm.Pf, m.Pf, k2); sm.V = lerp(sm.V, m.V, k1); sm.E = lerp(sm.E, m.E, k2); sm.O = lerp(sm.O, m.O, k1); sm.C = lerp(sm.C, m.C, k1); sm.P = lerp(sm.P, m.P, k1); sm.Ef = lerp(sm.Ef, m.Ef, k2); sm.Cross = lerp(sm.Cross, m.Cross, k1);
  sm.ox = lerp(sm.ox, m.ox, k1); sm.niv = lerp(sm.niv, m.niv, k1); sm.inv = lerp(sm.inv, m.inv, k1); sm.vent = lerp(sm.vent, m.vent, k1);
  /* breathing: rate and depth follow alveolar ventilation */
  bph += dt * (1.1 + 2.4 * sm.V);
  const br = Math.sin(bph), off = br * (3 + 13 * sm.V);
  layers.diaph.setAttribute("d", "M268 " + f1(386 + off * 0.4) + "Q440 " + f1(348 + off) + " 612 " + f1(386 + off * 0.4));
  const ls = 1 + 0.035 * br * (0.35 + sm.V);
  place(lungL.g, lungL.x, lungL.y, 0, ls);
  place(lungR.g, lungR.x, lungR.y, 0, ls);
  placeAlv(br);
  ALV.forEach((a) => { const shrink = a.bad ? 1 - 0.38 * sm.G : 1 - 0.1 * sm.G; a.e.setAttribute("r", f1(12 * shrink * (1 + 0.08 * br * sm.V))); a.e.setAttribute("class", a.bad && sm.G > 0.45 ? "rf-alv-bad" : "rf-alv"); });
  /* dusky lungs when blood oxygen is low, oxygen wash while oxygen flows */
  $("duskL").setAttribute("opacity", clamp(0.62 - 0.75 * sm.O).toFixed(2));
  $("duskR").setAttribute("opacity", clamp(0.62 - 0.75 * sm.O).toFixed(2));
  $("washL").setAttribute("opacity", (sm.ox * 0.30).toFixed(2));
  $("washR").setAttribute("opacity", (sm.ox * 0.30).toFixed(2));
  /* magnified membrane thickens with the gas exchange defect, eased a little by support */
  memb.setAttribute("stroke-width", f1(2 + 9 * sm.G * (1 - 0.25 * sm.vent)));
  /* wide support flow down the airway while mask or ventilator work */
  $("airflow").setAttribute("opacity", (sm.vent * 0.55).toFixed(2));
  $("airflow").setAttribute("stroke-width", f1(10 + 14 * sm.vent));
  /* treatment apparatus */
  oxyG.setAttribute("opacity", sm.ox.toFixed(2)); nivG.setAttribute("opacity", sm.niv.toFixed(2)); invG.setAttribute("opacity", sm.inv.toFixed(2)); belBox.setAttribute("opacity", sm.inv.toFixed(2));
  $("oxy-pill").style.opacity = sm.ox.toFixed(2); $("niv-pill").style.opacity = sm.niv.toFixed(2); $("inv-pill").style.opacity = sm.inv.toFixed(2);
  const infl = 0.5 + 0.5 * br;
  bel.setAttribute("width", f1(40 + 100 * (1 - infl * (0.4 + 0.6 * sm.V))));
  /* inspired air down the airway to the air sacs */
  acc.air += dt * (2 + 9 * sm.V); while (acc.air >= 1) { acc.air--; const p = freeP(air); if (p) { const left = Math.random() < 0.5; emit(p, 440, 84, 0, 46, left ? 0 : 1); p.tr = left ? trAirL : trAirR; p.u = 0; } }
  air.forEach((p) => { if (!p.on) return; p.u += dt * (46 + 60 * sm.V) / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) killP(p); });
  /* added oxygen streams down the same path, denser and brighter */
  acc.ox += dt * 9 * sm.ox; while (acc.ox >= 1) { acc.ox--; const p = freeP(oxair); if (p) { const left = Math.random() < 0.5; emit(p, 440, 84, 0, 46, 0); p.tr = left ? trAirL : trAirR; p.u = 0; } }
  oxair.forEach((p) => { if (!p.on) return; p.u += dt * 110 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) killP(p); });
  /* breathed out CO2 puffs leave the top of the airway */
  acc.ex += dt * (1 + 8 * sm.V); while (acc.ex >= 1) { acc.ex--; const p = freeP(puff); if (p) emit(p, 440 + rnd(-6, 6), 76, rnd(-8, 8), rnd(-34, -22), 0); }
  puff.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) killP(p); });
  /* brain drive signal runs to the pump, weaker when the pump fails */
  acc.sg += dt * (0.6 + 5 * (1 - sm.Pf)); while (acc.sg >= 1) { acc.sg--; const p = freeP(sig); if (p) { emit(p, 0, 0, 0, 0, 0); p.tr = trSig; p.u = 0; } }
  sig.forEach((p) => { if (!p.on) return; p.u += dt * 130 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (1 - 0.6 * sm.Pf).toFixed(2)); if (p.u >= 1) killP(p); });
  /* oxygen in the magnified air sac: some crosses, some is turned back */
  acc.o2 += dt * (3 + 8 * sm.V + 5 * sm.ox); while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2z); if (p) emit(p, 790 + rnd(-30, 30), 150 + rnd(-24, 24), rnd(-7, 7), rnd(14, 24), Math.random() < sm.Cross ? 1 : 0); }
  o2z.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 1) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 243) killP(p); } else { p.x += p.vx * dt; p.y += (p.y > 198 ? -Math.abs(p.vy) : p.vy) * dt; if (p.t > 2.4) killP(p); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* carbon dioxide leaves the blood for the air sac */
  acc.co2 += dt * (2 + 7 * sm.C); while (acc.co2 >= 1) { acc.co2--; const p = freeP(co2z); if (p) emit(p, rnd(700, 880), 243, rnd(-5, 5), -rnd(18, 28), 0); }
  co2z.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 118 || p.t > 3.4) killP(p); });
  /* acid particles collect in arterial blood when pH falls; redness follows oxygen */
  acc.acid += dt * 8 * clamp(1 - sm.P); while (acc.acid >= 1) { acc.acid--; const p = freeP(acid); if (p) emit(p, rnd(680, 900), rnd(378, 392), rnd(7, 14), 0, 0); }
  acid.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; if (p.x > 906) p.x = 674; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3) / 1.5).toFixed(2)); if (p.t > 4.5) killP(p); });
  $("artRed").setAttribute("opacity", (0.10 + 0.45 * sm.O).toFixed(2));
  /* red cells through the capillary and the arterial vessel */
  zrbc.forEach((r) => { r.x += r.v * 44 * dt; if (r.x > 906) r.x = 674; place(r.g, r.x, 243, 0, 1); });
  arbc.forEach((r) => { r.x += r.v * 40 * dt; if (r.x > 908) r.x = 672; place(r.g, r.x, 385, 0, 1); });
  /* gauges */
  gg.vent.set(sm.V, wordOf(sm.V, 0.35, 0.65, ["low", "reduced", "good"])); gg.exch.set(sm.E, wordOf(sm.E, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.o2.set(sm.O, wordOf(sm.O, 0.38, 0.68, ["low", "reduced", "normal"])); gg.co2.set(sm.C, wordOf(sm.C, 0.38, 0.58, ["low", "normal", "high"]));
  gg.ph.set(sm.P, wordOf(sm.P, 0.4, 0.6, ["acidosis", "near normal", "alkalosis"])); gg.eff.set(sm.Ef, wordOf(sm.Ef, 0.35, 0.65, ["low", "raised", "high"]));
  const key = drug + "x" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
