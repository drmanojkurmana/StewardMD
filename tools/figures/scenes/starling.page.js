/* Starling scene: a real heart organ fills from venous return and ejects into the aorta, a small kidney passes
 * urine, and the operating point travels on a family of Frank Starling curves. A capsule docks where each
 * treatment acts: inotrope sparks strengthen the squeeze, a water pill raises urine flow, a vasodilator widens the aorta. */
const L = { vessels: $("vessels"), cells: $("cells"), sparks: $("sparks"), marks: $("marks"), point: $("point"), over: $("over"), panel: $("panel") };
const HC = SC.HC, KC = SC.KC, GX0 = SC.GX0, GY0 = SC.GY0, GX1 = SC.GX1, GY1 = SC.GY1;
let heartO = null, kidneyO = null;
let veinRect = null, aortaPath = null, aortaGlow = null, sqzGlow = null, kidGlow = null, puddle = null;
const bands = [];
let heartCap = null, kidneyCap = null, aortaCap = null;
let capEl = null, capDrug = -1;
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", HC[0], HC[1], 160, {});
  kidneyO = organ($("kidneySlot"), "kidney", KC[0], KC[1], 60, {});
}
function capsule(x, y, rot) {
  const g = mk("g", { opacity: "0", transform: "translate(" + f1(x) + " " + f1(y) + ") rotate(" + rot + ")" }, L.marks);
  mk("rect", { class: "st-drug", x: -9, y: -4.5, width: 18, height: 9, rx: 4.5 }, g);
  mk("path", { class: "st-drug2", d: "M0 -4.5L-4.5 -4.5A4.5 4.5 0 0 0 -4.5 4.5L0 4.5Z" }, g);
  return g;
}
function initVessels() {
  sqzGlow = mk("ellipse", { class: "st-sqz", cx: HC[0], cy: HC[1], rx: 95, ry: 88, opacity: "0" }, L.vessels);
  kidGlow = mk("ellipse", { class: "st-kgl", cx: KC[0], cy: KC[1], rx: 46, ry: 52, opacity: "0" }, L.vessels);
  veinRect = mk("rect", { class: "st-vein", x: 28, y: 270, width: 76, height: 28, rx: 14 }, L.vessels);
  aortaGlow = mk("ellipse", { class: "st-flow", cx: 282, cy: 129, rx: 56, ry: 38, opacity: "0" }, L.vessels);
  aortaPath = mk("path", { class: "st-aorta", d: "M185 210C200 165 225 132 258 129L322 129", "stroke-width": 20 }, L.vessels);
  [252, 268, 284, 300, 314].forEach((x) => bands.push(mk("line", { class: "st-band", x1: x, y1: 109, x2: x, y2: 149, opacity: "0.85" }, L.vessels)));
  const ku = kidneyO.ports.out;
  puddle = mk("ellipse", { class: "st-pud", cx: f1(ku[0]), cy: f1(ku[1] + 14), rx: 6, ry: 3, opacity: "0" }, L.vessels);
  heartCap = capsule(HC[0] + 86, 208, 30);
  kidneyCap = capsule(320, 352, -20);
  aortaCap = capsule(308, 106, 0);
}
/* ---- operating point and its dashed guides ---- */
const dashX = mk("line", { class: "st-dash", x1: GX0, y1: GY0, x2: GX0, y2: GY0 }, L.point);
const dashY = mk("line", { class: "st-dash", x1: GX0, y1: GY0, x2: GX0, y2: GY0 }, L.point);
const pointG = mk("g", { class: "hot", tabindex: "0", "data-info": "Operating point: the filling and stroke volume the ventricle is working at right now. Move preload or change treatment and watch it travel along a curve, or jump to another curve." }, L.point);
mk("circle", { class: "st-halo", r: 17 }, pointG);
mk("circle", { class: "st-point", r: 9 }, pointG);
const curveBoost = svg.querySelector(".st-curve-boost"), curveNorm = svg.querySelector(".st-curve-norm"), curveFail = svg.querySelector(".st-curve-fail");
/* ---- red cells travelling vein to ventricle to aorta ---- */
const cellTrack = track([[38, 284], [104, 284], [128, 272], [150, 252], [165, 225], [180, 195], [200, 160], [230, 135], [262, 129], [322, 129]]);
const rbcs = [];
function initCells() { for (let i = 0; i < 14; i++) { const g = cell(L.cells, { cls: "rbc", r: 8, seed: i + 3, wob: 0.1 }); rbcs.push({ g, u: i / 14, v: rnd(0.85, 1.15) }); } }
/* ---- particle pools: inotrope sparks, kidney urine, aortic spurts ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sparks = pool(10, () => mk("path", { class: "sc-p p-spark", d: "M0 -3.5L2.6 0L0 3.5L-2.6 0Z" }, L.sparks));
const urine = pool(12, () => mk("path", { class: "sc-p p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.sparks));
const spurts = pool(6, () => mk("circle", { class: "sc-p p-spurt", r: 2.6 }, L.sparks));
function capText(d) {
  if (d === 1) return "Inotrope. Each squeeze strengthens, so the same filling ejects more blood.";
  if (d === 2) return "Water pill. Kidneys pass more urine, so filling falls and the point moves left.";
  if (d === 3) return "Vasodilator. Vessels relax and widen, so the heart ejects more easily.";
  return "No treatment. More filling stretches the heart and each beat ejects more.";
}
/* ---- labels, caption and gauges ---- */
const gg = {};
function initPanel() {
  const ox = L.over;
  pill(ox, "Veins", 60, 284, 58, 336, "Veins: blood returning to the heart. More return fills and stretches the ventricle.");
  pill(ox, "Heart", 140, 262, 175, 392, "Ventricle: the main pumping chamber. It fills and stretches, then squeezes blood out.");
  pill(ox, "Aorta", 282, 129, 282, 88, "Aorta and arteries: the load each beat pushes against. A vasodilator relaxes them.");
  pill(ox, "Kidney", 280, 370, 200, 428, "Kidney: passes salt and water as urine. A water pill makes it pass more.");
  pill(ox, "Filling", 895, 375, 850, 408, "Filling: how full the ventricle is before it squeezes. Read it along the bottom.");
  pill(ox, "Stroke volume", 420, 230, 415, 98, "Stroke volume: blood ejected in one beat. Read it up the side.");
  pill(ox, "Curves", 705, 225, 700, 98, "Curves: how filling becomes ejected blood. A weak heart runs lower. An inotrope lifts the curve.");
  capEl = mk("text", { class: "st-cap", x: 360, y: 433 }, ox); capEl.textContent = capText(0);
  const P = L.panel, y0 = 478, h = 52, xs = [60, 200, 340, 480, 620];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The circulation";
  [["fill", "Filling", "g-fl", "Preload: how full the ventricle is at the end of filling. A water pill lowers it."], ["contr", "Contractility", "g-cyt", "Contractility: how strongly the muscle squeezes. A positive inotrope raises it."], ["after", "Afterload", "g-bad", "Afterload: the load against ejection. A vasodilator lowers it, so ejection is easier."], ["sv", "Stroke volume", "g-good", "Blood out in one beat, read from the curve at the current filling."], ["co", "Output", "g-good", "Cardiac output: stroke volume times heart rate, the flow delivered each minute."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 110, y0 + 2, h, 18, cls, name, tip); });
}
const sm = { effPre: 0.6, contr: 0.5, after: 0.58, sv: 0.5, hr: 0.65, co: 0.55, ino: 0, diu: 0, vaso: 0 };
const acc = { sp: 0, ur: 0, sq: 0 };
let beatPh = 0, curS = 1;
function init() { initOrgans(); initVessels(); initCells(); initPanel(); }
function step(dt, m) {
  const kD = Math.min(1, dt * 3), k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.8);
  sm.effPre = lerp(sm.effPre, m.effPre, k1); sm.contr = lerp(sm.contr, m.contr, k1); sm.after = lerp(sm.after, m.after, k1);
  sm.sv = lerp(sm.sv, m.sv, k2); sm.hr = lerp(sm.hr, m.hr, k2); sm.co = lerp(sm.co, m.co, k2);
  sm.ino = lerp(sm.ino, m.ino, kD); sm.diu = lerp(sm.diu, m.diu, kD); sm.vaso = lerp(sm.vaso, m.vaso, kD);
  /* heart: filling sets the diastolic size, stroke volume sets the squeeze, heart rate sets the tempo */
  beatPh += dt * (0.55 + 0.85 * sm.hr);
  const cyc = beatPh % 1, squeeze = cyc < 0.42 ? Math.sin((cyc / 0.42) * 3.1416) : 0;
  const ef = 0.1 + 0.3 * sm.sv;
  curS = (0.8 + 0.28 * sm.effPre) * (1 - ef * squeeze);
  heartO.g.setAttribute("transform", "translate(" + HC[0] + " " + HC[1] + ") scale(" + curS.toFixed(3) + ")");
  heartCap.setAttribute("transform", "translate(" + f1(HC[0] + 80 * curS + 6) + " 208) rotate(30)");
  heartCap.setAttribute("opacity", sm.ino.toFixed(2));
  kidneyCap.setAttribute("opacity", sm.diu.toFixed(2));
  aortaCap.setAttribute("opacity", sm.vaso.toFixed(2));
  /* treatment glows: squeeze halo on the heart, working kidney halo, eased flow halo on the aorta */
  sqzGlow.setAttribute("opacity", ((0.26 + 0.1 * squeeze) * sm.ino).toFixed(2));
  kidGlow.setAttribute("opacity", (0.28 * sm.diu).toFixed(2));
  aortaGlow.setAttribute("opacity", (0.3 * sm.vaso).toFixed(2));
  /* vein thins as filling falls, aorta widens as afterload falls, grip bands loosen */
  const vh = 14 + 22 * sm.effPre;
  veinRect.setAttribute("height", f1(vh)); veinRect.setAttribute("y", f1(284 - vh / 2));
  aortaPath.setAttribute("stroke-width", f1(38 - 32 * sm.after));
  bands.forEach((b) => b.setAttribute("opacity", (0.85 - 0.77 * sm.vaso).toFixed(2)));
  /* kidney puddle grows with urine flow */
  puddle.setAttribute("rx", f1(6 + 28 * sm.diu)); puddle.setAttribute("opacity", (0.45 * sm.diu).toFixed(2));
  /* red cells: faster and denser looking flow when output is high, paler when filling is low */
  rbcs.forEach((r, i) => { r.u = (r.u + dt * (0.03 + 0.11 * sm.co) * r.v) % 1; const q = cellTrack.at(r.u); place(r.g, q.x, q.y, q.a + Math.sin(tm / 500 + i) * 12, 0.85 + 0.3 * sm.co); r.g.style.opacity = (0.45 + 0.55 * sm.effPre).toFixed(2); });
  /* inotrope sparks fly to the heart muscle and sink in */
  acc.sp += dt * 8 * sm.ino;
  while (acc.sp >= 1) { acc.sp--; const p = free(sparks); if (p) { const sx = rnd(85, 125), sy = rnd(118, 155), tx = HC[0] - 25 + rnd(-20, 20), ty = HC[1] - 70 + rnd(-15, 25), dx = tx - sx, dy = ty - sy, dd = Math.hypot(dx, dy) || 1; emit(p, sx, sy, dx / dd * 150, dy / dd * 150); p.k = dd / 150; } }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp((p.k - p.t) / 0.2).toFixed(2)); if (p.t >= p.k) kill(p); });
  /* urine leaves the kidney only when the water pill acts */
  const ku = kidneyO.ports.out;
  acc.ur += dt * 9 * sm.diu;
  while (acc.ur >= 1) { acc.ur--; const p = free(urine); if (p) emit(p, ku[0] + rnd(-5, 5), ku[1], rnd(-4, 4), rnd(55, 75)); }
  urine.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - ku[1]) / 26).toFixed(2)); if (p.y > ku[1] + 30) kill(p); });
  /* aortic spurts show eased fast flow when the vasodilator acts */
  acc.sq += dt * 5 * sm.vaso;
  while (acc.sq >= 1) { acc.sq--; const p = free(spurts); if (p) { emit(p, rnd(230, 260), 129 + rnd(-8, 8), rnd(90, 130), rnd(-6, 6)); p.k = 0.7; } }
  spurts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("cx", f1(p.x)); p.e.setAttribute("cy", f1(p.y)); p.e.setAttribute("opacity", clamp(1 - p.t / p.k).toFixed(2)); if (p.t >= p.k || p.x > 326) kill(p); });
  /* operating point on the graph, with guides to both axes */
  const px = GX0 + sm.effPre * (GX1 - GX0), py = GY0 - sm.sv * (GY0 - GY1);
  pointG.setAttribute("transform", "translate(" + f1(px) + " " + f1(py) + ")");
  dashX.setAttribute("x1", f1(px)); dashX.setAttribute("x2", f1(px)); dashX.setAttribute("y1", f1(py)); dashX.setAttribute("y2", f1(GY0));
  dashY.setAttribute("x1", f1(GX0)); dashY.setAttribute("x2", f1(px)); dashY.setAttribute("y1", f1(py)); dashY.setAttribute("y2", f1(py));
  curveBoost.style.opacity = m.ino ? "1" : "0.5"; curveNorm.style.opacity = m.ino ? "0.35" : "0.95"; curveFail.style.opacity = "0.55";
  curveBoost.style.strokeWidth = m.ino ? "3.6" : "2.6"; curveNorm.style.strokeWidth = m.ino ? "2.6" : "3.4";
  /* gauges */
  gg.fill.set(sm.effPre, wordOf(sm.effPre, 0.4, 0.7, ["low", "normal", "high"]));
  gg.contr.set(sm.contr, wordOf(sm.contr, 0.4, 0.7, ["low", "normal", "raised"]));
  gg.after.set(sm.after, wordOf(sm.after, 0.4, 0.7, ["low", "normal", "high"]));
  gg.sv.set(sm.sv, wordOf(sm.sv, 0.4, 0.68, ["low", "moderate", "high"]));
  gg.co.set(sm.co, wordOf(sm.co, 0.4, 0.6, ["low", "moderate", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
