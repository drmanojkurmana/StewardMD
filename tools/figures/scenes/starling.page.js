/* Starling scene: a filling and ejecting ventricle on the left, and the operating point moving on a family of Frank Starling curves on the right. */
const L = { vessels: $("vessels"), heart: $("heart"), cells: $("cells"), point: $("point"), over: $("over"), panel: $("panel") };
const HC = SC.HC, GX0 = SC.GX0, GY0 = SC.GY0, GX1 = SC.GX1, GY1 = SC.GY1;
/* ---- vessels (visible filled tubes) ---- */
const veinRect = mk("rect", { class: "st-vein", x: 28, y: 270, width: 100, height: 28, rx: 14 }, L.vessels);
mk("path", { d: "M196 196C198 152 218 130 252 128", fill: "none", stroke: "var(--c-rbc)", "stroke-width": 21, "stroke-linecap": "round", opacity: 0.6 }, L.vessels);
const aortaRect = mk("rect", { class: "st-aorta", x: 238, y: 116, width: 82, height: 26, rx: 13 }, L.vessels);
/* ---- the heart ---- */
const wallEl = mk("ellipse", { class: "st-wall", cx: HC[0], cy: HC[1] + 10 }, L.heart);
const chamberEl = mk("ellipse", { class: "st-chamber", cx: HC[0], cy: HC[1] + 10 }, L.heart);
const atriumL = mk("ellipse", { class: "st-atrium", cx: HC[0] - 44, cy: HC[1] - 72, rx: 24, ry: 18 }, L.heart);
const atriumR = mk("ellipse", { class: "st-atrium", cx: HC[0] + 36, cy: HC[1] - 84, rx: 26, ry: 19 }, L.heart);
/* ---- operating point and its dashed guides ---- */
const dashX = mk("line", { class: "st-dash", x1: GX0, y1: GY0, x2: GX0, y2: GY0 }, L.point);
const dashY = mk("line", { class: "st-dash", x1: GX0, y1: GY0, x2: GX0, y2: GY0 }, L.point);
const pointG = mk("g", { class: "hot", tabindex: "0", "data-info": "Operating point: the filling and stroke volume the ventricle is working at right now. Move preload or change treatment and watch it travel along a curve, or jump to another curve." }, L.point);
mk("circle", { class: "st-halo", r: 17 }, pointG);
mk("circle", { class: "st-point", r: 9 }, pointG);
const curveBoost = svg.querySelector(".st-curve-boost"), curveNorm = svg.querySelector(".st-curve-norm"), curveFail = svg.querySelector(".st-curve-fail");
/* ---- red cells travelling vein to ventricle to aorta ---- */
const cellTrack = track([[38, 284], [112, 284], [158, 258], [192, 196], [226, 140], [312, 129]]);
const rbcs = [];
function initCells() { for (let i = 0; i < 14; i++) { const g = cell(L.cells, { cls: "rbc", r: 8, seed: i + 3, wob: 0.1 }); rbcs.push({ g, u: i / 14, v: rnd(0.85, 1.15) }); } }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  pill(L.over, "Venous return", 60, 284, 70, 340, "Venous return: blood returning to the heart. It sets how much the ventricle fills, which is preload.");
  pill(L.over, "Ventricle", HC[0], HC[1] + 10, 175, 368, "The ventricle. It fills in diastole, stretches, then ejects in systole. How much it ejects in one beat is stroke volume.");
  pill(L.over, "Afterload", 276, 129, 262, 98, "Afterload: the load the ventricle ejects against, set mainly by resistance in the arteries. The aorta here stands for that arterial load.");
  pill(L.over, "Stroke volume", GX0, 240, 415, 98, "Stroke volume: blood ejected in one beat. It is read off the vertical axis of the graph.");
  pill(L.over, "Failing curve", 620, 295, 545, 98, "Failing ventricle: a lower, flatter curve. The same filling produces a smaller stroke volume, and extra filling adds little.");
  pill(L.over, "Normal curve", 700, 246, 665, 98, "Normal ventricle: stroke volume rises with filling, then the curve flattens as filling gets high.");
  pill(L.over, "Inotrope curve", 760, 177, 800, 98, "Positive inotrope: stronger contractility shifts the curve up and left, so the same filling gives a larger stroke volume.");
  pill(L.over, "Preload", 660, GY0, 660, 412, "Preload: end diastolic filling, read off the horizontal axis. More venous return or more circulating volume moves the point right; a diuretic moves it left.");
  const P = L.panel, y0 = 478, h = 52, xs = [60, 200, 340, 480, 620];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The circulation";
  [["fill", "Filling", "g-fl", "Preload: how full the ventricle is at the end of filling. A diuretic lowers it."], ["contr", "Contractility", "g-cyt", "How strongly the muscle squeezes for a given filling. A positive inotrope raises it."], ["after", "Afterload", "g-bad", "The load against ejection. A vasodilator lowers it, so ejection is easier."], ["sv", "Stroke volume", "g-good", "Blood out in one beat, from the Frank Starling curve at the current filling."], ["co", "Output", "g-good", "Cardiac output: stroke volume times heart rate, the flow delivered each minute."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 110, y0 + 2, h, 18, cls, name, tip); });
}
const sm = { effPre: 0.6, contr: 0.5, after: 0.58, sv: 0.5, hr: 0.65, co: 0.55 };
let beatPh = 0;
function init() { initCells(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.8);
  sm.effPre = lerp(sm.effPre, m.effPre, k1); sm.contr = lerp(sm.contr, m.contr, k1); sm.after = lerp(sm.after, m.after, k1);
  sm.sv = lerp(sm.sv, m.sv, k2); sm.hr = lerp(sm.hr, m.hr, k2); sm.co = lerp(sm.co, m.co, k2);
  /* heart: filling sets the diastolic size, stroke volume sets the squeeze, heart rate sets the tempo */
  beatPh += dt * (0.55 + 0.85 * sm.hr);
  const cyc = beatPh % 1, squeeze = cyc < 0.42 ? Math.sin((cyc / 0.42) * 3.1416) : 0;
  const ef = 0.1 + 0.36 * sm.sv, rx0 = 36 + 20 * sm.effPre, ry0 = 50 + 22 * sm.effPre, th = 13;
  const rx = rx0 * (1 - ef * squeeze), ry = ry0 * (1 - ef * squeeze);
  chamberEl.setAttribute("rx", f1(rx)); chamberEl.setAttribute("ry", f1(ry));
  wallEl.setAttribute("rx", f1(rx + th)); wallEl.setAttribute("ry", f1(ry + th));
  atriumL.setAttribute("cy", f1(HC[1] + 10 - ry - th - 2)); atriumR.setAttribute("cy", f1(HC[1] + 10 - ry - th - 14));
  veinRect.setAttribute("height", f1(20 + 14 * sm.effPre)); veinRect.setAttribute("y", f1(284 - (20 + 14 * sm.effPre) / 2));
  const ah = 30 - 11 * sm.after; aortaRect.setAttribute("height", f1(ah)); aortaRect.setAttribute("y", f1(129 - ah / 2));
  /* red cells: faster and denser looking flow when output is high; all stay on the vein to aorta path inside the left stage */
  rbcs.forEach((r, i) => { r.u = (r.u + dt * (0.03 + 0.11 * sm.co) * r.v) % 1; const q = cellTrack.at(r.u); place(r.g, q.x, q.y, q.a + Math.sin(tm / 500 + i) * 12, 0.85 + 0.3 * sm.co); });
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
  gg.sv.set(sm.sv, wordOf(sm.sv, 0.4, 0.6, ["low", "moderate", "high"]));
  gg.co.set(sm.co, wordOf(sm.co, 0.4, 0.6, ["low", "moderate", "high"]));
}
run({ init, step });
