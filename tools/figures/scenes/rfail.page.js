/* Respiratory failure scene: the pump chain, two lungs, a magnified alveolus and capillary, arterial blood and the gauges. */
const layers = { app: $("apparatus"), alv: $("alvG"), zoom: $("zoomG"), art: $("artG"), parts: $("parts"), over: $("over"), panel: $("panel"), diaph: $("diaph") };
const nodePump = [$("c-drive"), $("c-muscle"), $("c-chest"), $("c-airway")];
const nodeLung = $("c-lung");
/* ---- alveoli in the two lungs ---- */
const ALV = [[318, 208], [356, 224], [298, 252], [338, 272], [374, 258], [318, 306], [362, 318], [512, 208], [552, 228], [492, 254], [534, 276], [568, 262], [508, 308], [552, 318]]
  .map(([x, y], i) => { const e = mk("circle", { class: i % 3 === 2 ? "rf-alv-bad" : "rf-alv", cx: x, cy: y, r: 13 }, layers.alv); return { e, x, y, r: 13, bad: i % 3 === 2 }; });
/* ---- magnified alveolus and capillary ---- */
let memb = null;
const zrbc = [];
function initZoom() {
  mk("circle", { class: "rf-bigalv", cx: 790, cy: 160, r: 52 }, layers.zoom);
  memb = mk("circle", { class: "rf-memb", cx: 790, cy: 160, r: 59, "stroke-width": 3 }, layers.zoom);
  mk("rect", { class: "rf-cap", x: 680, y: 230, width: 220, height: 26, rx: 13 }, layers.zoom);
  const t1 = mk("text", { class: "rf-small", x: 680, y: 276 }, layers.zoom); t1.textContent = "blood in";
  const t2 = mk("text", { class: "rf-small", x: 858, y: 276 }, layers.zoom); t2.textContent = "blood out";
  mk("circle", { class: "sc-p p-o2", cx: 690, cy: 300, r: 4 }, layers.zoom);
  const t3 = mk("text", { class: "rf-small", x: 700, y: 304 }, layers.zoom); t3.textContent = "oxygen";
  mk("circle", { class: "sc-p p-co2", cx: 772, cy: 300, r: 4 }, layers.zoom);
  const t4 = mk("text", { class: "rf-small", x: 782, y: 304 }, layers.zoom); t4.textContent = "carbon dioxide";
  for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.zoom); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); zrbc.push({ g, x: 690 + i * 36, v: rnd(0.8, 1.2) }); }
}
/* ---- arterial red cells ---- */
const arbc = [];
function initArt() { for (let i = 0; i < 5; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.art); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); arbc.push({ g, x: 690 + i * 46, v: rnd(0.8, 1.2) }); } }
/* ---- treatment apparatus ---- */
let oxyG = null, nivG = null, invG = null;
function initApp() {
  oxyG = mk("g", { opacity: "0" }, layers.app);
  mk("rect", { class: "rf-cyl", x: 472, y: 62, width: 26, height: 46, rx: 8 }, oxyG);
  mk("rect", { class: "rf-cyl", x: 480, y: 54, width: 10, height: 10, rx: 3 }, oxyG);
  mk("path", { class: "rf-arrow", d: "M478 84L452 96" }, oxyG);
  nivG = mk("g", { opacity: "0" }, layers.app);
  mk("ellipse", { class: "rf-mask", cx: 440, cy: 70, rx: 36, ry: 17 }, nivG);
  mk("path", { class: "rf-arrow", d: "M404 66L380 54M476 66L502 54" }, nivG);
  invG = mk("g", { opacity: "0" }, layers.app);
  mk("rect", { class: "rf-tube", x: 434, y: 50, width: 12, height: 122, rx: 5 }, invG);
  mk("rect", { class: "rf-tube", x: 428, y: 42, width: 24, height: 13, rx: 4 }, invG);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const air = pool(20, () => mk("circle", { class: "sc-p p-air", r: 3 }, layers.parts));
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
  [["vent", "Ventilation", "g-vent", "Alveolar ventilation: how much fresh air reaches the alveoli each minute. Set by the drive, muscles, chest wall and airways."],
    ["exch", "Exchange", "g-exch", "Gas exchange across the alveolar capillary membrane. Lost with mismatch, shunt and diffusion defects."],
    ["o2", "Oxygen", "g-o2", "Arterial oxygen. Falls in type 1 failure and when ventilation is too low to bring oxygen in."],
    ["co2", "CO2", "g-co2g", "Arterial carbon dioxide. Cleared only by alveolar ventilation, so it rises when the pump fails."],
    ["ph", "pH", "g-ph", "Blood pH. Retained carbon dioxide makes it fall: respiratory acidosis."],
    ["eff", "Effort", "g-eff", "Work of breathing. High when the lung is stiff, flooded or obstructed, or the pump is weak; support unloads it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Chest wall", 285, 167, 285, 128, "Chest wall and pleura around the lungs. Stiffness, deformity or fluid limits expansion and lowers ventilation.");
  pill(ox, "Airway", 440, 110, 372, 96, "Trachea and bronchi. Narrowing or obstruction limits airflow so the alveoli are underventilated.");
  pill(ox, "Alveoli", 758, 132, 700, 96, "Magnified alveolus. Air fills it on each breath; oxygen and carbon dioxide cross its wall into the capillary.");
  pill(ox, "Capillary", 790, 244, 866, 202, "Capillary carrying blood past the alveolus. It picks up oxygen and gives up carbon dioxide.");
  pill(ox, "Diaphragm", 440, 370, 440, 422, "Diaphragm: the main breathing muscle. It flattens to draw air in. Weakness or fatigue causes type 2 failure.");
  const op = pill(ox, "Oxygen", 485, 84, 560, 68, "Added oxygen raises the oxygen in inspired air. It helps mismatch and diffusion defects, less so true shunt, and does not clear carbon dioxide."); op.setAttribute("id", "oxy-pill");
  const np = pill(ox, "NIV mask", 468, 72, 560, 105, "Non-invasive ventilation: a tight mask supports each breath, raising alveolar ventilation so carbon dioxide falls."); np.setAttribute("id", "niv-pill");
  const ip = pill(ox, "Ventilator", 446, 58, 560, 105, "Invasive ventilation: a tube in the airway connected to a ventilator takes over the work of breathing."); ip.setAttribute("id", "inv-pill");
}
const sm = { G: 0.8, Pf: 0.2, V: 0.7, E: 0.3, O: 0.3, C: 0.4, P: 0.5, Ef: 0.5, Cross: 0.3, ox: 0, niv: 0, inv: 0 };
const acc = { air: 0, o2: 0, co2: 0, acid: 0 };
let bph = 0;
function init() { initZoom(); initArt(); initApp(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.G = lerp(sm.G, m.G, k2); sm.Pf = lerp(sm.Pf, m.Pf, k2); sm.V = lerp(sm.V, m.V, k1); sm.E = lerp(sm.E, m.E, k2); sm.O = lerp(sm.O, m.O, k1); sm.C = lerp(sm.C, m.C, k1); sm.P = lerp(sm.P, m.P, k1); sm.Ef = lerp(sm.Ef, m.Ef, k2); sm.Cross = lerp(sm.Cross, m.Cross, k1);
  sm.ox = lerp(sm.ox, m.ox, k1); sm.niv = lerp(sm.niv, m.niv, k1); sm.inv = lerp(sm.inv, m.inv, k1);
  /* breathing: rate and depth follow alveolar ventilation */
  bph += dt * (1.1 + 2.4 * sm.V);
  const br = Math.sin(bph), off = br * (3 + 13 * sm.V);
  layers.diaph.setAttribute("d", "M268 " + f1(386 + off * 0.4) + "Q440 " + f1(348 + off) + " 612 " + f1(386 + off * 0.4));
  const ls = 1 + 0.03 * br * (0.35 + sm.V);
  $("lungL").setAttribute("transform", "translate(345 258) scale(" + ls.toFixed(3) + ") translate(-345 -258)");
  $("lungR").setAttribute("transform", "translate(535 258) scale(" + ls.toFixed(3) + ") translate(-535 -258)");
  ALV.forEach((a) => { const shrink = a.bad ? 1 - 0.38 * sm.G : 1 - 0.1 * sm.G; a.e.setAttribute("r", f1(a.r * shrink * (1 + 0.1 * br * sm.V))); a.e.setAttribute("class", a.bad && sm.G > 0.45 ? "rf-alv-bad" : "rf-alv"); });
  /* cause nodes: the pump chain lights up in type 2, the lung in type 1 */
  nodePump.forEach((e) => { e.style.setProperty("stroke-width", (1.2 + 2.6 * sm.Pf).toFixed(2)); e.style.opacity = (0.62 + 0.38 * sm.Pf).toFixed(2); });
  nodeLung.style.setProperty("stroke-width", (1.2 + 2.6 * sm.G).toFixed(2)); nodeLung.style.opacity = (0.62 + 0.38 * sm.G).toFixed(2);
  /* magnified membrane thickens with the gas exchange defect */
  memb.setAttribute("stroke-width", f1(2 + 9 * sm.G));
  /* treatment apparatus */
  oxyG.setAttribute("opacity", sm.ox.toFixed(2)); nivG.setAttribute("opacity", sm.niv.toFixed(2)); invG.setAttribute("opacity", sm.inv.toFixed(2));
  $("oxy-pill").style.opacity = sm.ox.toFixed(2); $("niv-pill").style.opacity = sm.niv.toFixed(2); $("inv-pill").style.opacity = sm.inv.toFixed(2);
  /* inspired air down the airway to the alveoli */
  acc.air += dt * (2 + 9 * sm.V); while (acc.air >= 1) { acc.air--; const p = freeP(air); if (p) emit(p, 440 + rnd(-5, 5), 84, 0, 46, Math.floor(Math.random() * ALV.length)); }
  air.forEach((p) => { if (!p.on) return; const a = ALV[p.k]; if (p.y < 164) { p.y += p.vy * dt; } else { const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; if (d < 9) killP(p); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* oxygen in the magnified alveolus: some crosses, some is turned back */
  acc.o2 += dt * (3 + 8 * sm.V + 5 * sm.ox); while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2z); if (p) emit(p, 790 + rnd(-30, 30), 150 + rnd(-24, 24), rnd(-7, 7), rnd(14, 24), Math.random() < sm.Cross ? 1 : 0); }
  o2z.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 1) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 243) killP(p); } else { p.x += p.vx * dt; p.y += (p.y > 198 ? -Math.abs(p.vy) : p.vy) * dt; if (p.t > 2.4) killP(p); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* carbon dioxide leaves the blood for the alveolus */
  acc.co2 += dt * (2 + 7 * sm.C); while (acc.co2 >= 1) { acc.co2--; const p = freeP(co2z); if (p) emit(p, rnd(700, 880), 243, rnd(-5, 5), -rnd(18, 28), 0); }
  co2z.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 118 || p.t > 3.4) killP(p); });
  /* acid particles collect in arterial blood when pH falls */
  acc.acid += dt * 8 * clamp(1 - sm.P); while (acc.acid >= 1) { acc.acid--; const p = freeP(acid); if (p) emit(p, rnd(680, 900), rnd(378, 392), rnd(7, 14), 0, 0); }
  acid.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; if (p.x > 906) p.x = 674; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3) / 1.5).toFixed(2)); if (p.t > 4.5) killP(p); });
  /* red cells through the capillary and the arterial vessel */
  zrbc.forEach((r) => { r.x += r.v * 44 * dt; if (r.x > 906) r.x = 674; place(r.g, r.x, 243, 0, 1); });
  arbc.forEach((r) => { r.x += r.v * 40 * dt; if (r.x > 908) r.x = 672; place(r.g, r.x, 385, 0, 1); });
  /* gauges */
  gg.vent.set(sm.V, wordOf(sm.V, 0.35, 0.65, ["low", "reduced", "good"])); gg.exch.set(sm.E, wordOf(sm.E, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.o2.set(sm.O, wordOf(sm.O, 0.38, 0.68, ["low", "reduced", "normal"])); gg.co2.set(sm.C, wordOf(sm.C, 0.38, 0.58, ["low", "normal", "high"]));
  gg.ph.set(sm.P, wordOf(sm.P, 0.4, 0.6, ["acidosis", "near normal", "alkalosis"])); gg.eff.set(sm.Ef, wordOf(sm.Ef, 0.35, 0.65, ["low", "raised", "high"]));
}
run({ init, step });
