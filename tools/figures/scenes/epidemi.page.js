/* Screening tests scene: overlapping distributions, a moving cut-off, person dots, the 2 by 2 table and the gauges. */
const layers = { graph: $("Lgraph"), strips: $("Lstrips"), table: $("Ltable"), parts: $("Lparts"), over: $("Lover"), panel: $("Lpanel") };
const AX0 = 78, AX1 = 520, BASE = 292, PEAK = 164, CA = 215, CP = 365, SD = 68;
function gauss(x, c) { const z = (x - c) / SD; return Math.exp(-0.5 * z * z); }
function curveD(c) { let d = ""; for (let i = 0; i <= 44; i++) { const x = AX0 + (i / 44) * (AX1 - AX0), y = BASE - PEAK * gauss(x, c); d += (i ? "L" : "M") + f1(x) + " " + f1(y); } return d; }
function areaD(c, xa, xb) { let d = "M" + f1(xa) + " " + BASE; const n = Math.max(2, Math.round((xb - xa) / 10)); for (let i = 0; i <= n; i++) { const x = xa + (i / n) * (xb - xa); d += "L" + f1(x) + " " + f1(BASE - PEAK * gauss(x, c)); } return d + "L" + f1(xb) + " " + BASE + "Z"; }
/* ---- graph elements: shaded cell areas under the curves, the curves, the cut-off and the confirmatory gate ---- */
const gEls = {};
function initGraph() {
  const G = layers.graph;
  gEls.tn = mk("path", { class: "ep-area-tn", opacity: "0.30" }, G);
  gEls.fp = mk("path", { class: "ep-area-fp", opacity: "0.38" }, G);
  gEls.fn = mk("path", { class: "ep-area-fn", opacity: "0.32" }, G);
  gEls.tp = mk("path", { class: "ep-area-tp", opacity: "0.38" }, G);
  mk("path", { class: "ep-curve-a", d: curveD(CA) }, G);
  mk("path", { class: "ep-curve-p", d: curveD(CP) }, G);
  gEls.conf = mk("path", { class: "ep-conf", d: "", opacity: "0" }, G);
  gEls.cut = mk("path", { class: "ep-cut", d: "" }, G);
}
/* ---- person dots in the two disease rows, spread like the distributions above them ---- */
const stripDots = { pres: [], abs: [] };
function spreadDot(c) { const u = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; return clamp(c + u * 118, AX0 + 8, AX1 - 8); }
function initStrips() {
  for (let i = 0; i < 26; i++) { const e = mk("circle", { class: "ep-dot ep-d-tp", r: 5 }, layers.strips); stripDots.pres.push({ e, x: spreadDot(CP), y: 382 + rnd(-3, 3) }); }
  for (let i = 0; i < 26; i++) { const e = mk("circle", { class: "ep-dot ep-d-tn", r: 5 }, layers.strips); stripDots.abs.push({ e, x: spreadDot(CA), y: 422 + rnd(-3, 3) }); }
}
/* ---- mini dots inside each table cell: ten per cell, the lit share follows the row proportion ---- */
const cellDots = { TP: [], FN: [], FP: [], TN: [] };
const CELLXY = { TP: [640, 110], FN: [778, 110], FP: [640, 236], TN: [778, 236] };
function initTable() {
  for (const key in CELLXY) { const cx = CELLXY[key][0], cy = CELLXY[key][1];
    for (let i = 0; i < 10; i++) { const e = mk("circle", { class: "ep-mini ep-m-" + key.toLowerCase(), r: 4, cx: cx + 30 + (i % 5) * 18, cy: cy + 84 + Math.floor(i / 5) * 14 }, layers.table); cellDots[key].push(e); } }
}
/* ---- particle pool: people travelling along the result axis, kept inside the left panel ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const flows = pool(16, () => mk("circle", { class: "ep-flow", r: 3.2 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let cutPill = null, confPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [170, 390, 610, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "How the test performs";
  [["sens", "Sensitivity", "g-good", "Sensitivity: of people who truly have the disease, the share whose test is positive. Read it inside the disease present row only: true positives over all with disease."], ["spec", "Specificity", "g-good", "Specificity: of people who truly do not have the disease, the share whose test is negative. Read it inside the disease absent row only: true negatives over all without disease."], ["ppv", "Predictive +", "g-cyt", "Positive predictive value: of everyone who tests positive, the share who truly have the disease. It mixes both rows, so it rises when the disease is more common."], ["npv", "Predictive -", "g-cyt", "Negative predictive value: of everyone who tests negative, the share who truly do not have the disease. It falls when the disease is more common."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h + 4, 20, cls, name, tip); });
  const O = layers.over;
  pill(O, "Disease absent", CA, BASE - PEAK - 4, 150, 96, "People without the disease. Most have low test results, but the tail of this group crosses the cut-off and gives false positives.");
  cutPill = pill(O, "Cut-off", 285, 118, 285, 96, "The cut-off: the result value that separates test negative (left) from test positive (right). Moving it trades sensitivity against specificity.");
  pill(O, "Disease present", CP, BASE - PEAK - 4, 410, 96, "People with the disease. Most have high test results, but the tail of this group falls below the cut-off and gives false negatives.");
  pill(O, "Test negative", 170, BASE, 150, 336, "Results below the cut-off are called test negative. This side holds true negatives and false negatives.");
  pill(O, "Test positive", 400, BASE, 410, 336, "Results at or above the cut-off are called test positive. This side holds true positives and false positives.");
  pill(O, "TP", 706, 148, 706, 128, "True positive: disease present and the test is positive. These people are correctly picked up by the test.");
  pill(O, "FN", 844, 148, 844, 128, "False negative: disease present but the test is negative. These cases are missed, and they grow when the cut-off is raised.");
  pill(O, "FP", 706, 274, 706, 254, "False positive: no disease but the test is positive. These false alarms grow when the cut-off is lowered and shrink with a confirmatory test.");
  pill(O, "TN", 844, 274, 844, 254, "True negative: no disease and the test is negative. These people are correctly reassured by the test.");
  confPill = pill(O, "Confirmatory test", 772, 346, 706, 422, "A second, different test applied only to people who test positive. Most false positives fail it and drop out, so specificity and the positive predictive value rise, while a few true positives are also lost.");
  pill(O, "Prevalence", 910, 378, 852, 422, "Prevalence: how common the disease is in the people being tested. It sets the mix of the two rows, so it moves the predictive values without changing sensitivity or specificity.");
}
const sm = { sens: 0.7, spec: 0.7, ppv: 0.5, npv: 0.8, prev: 0.35, cut: 285, confirm: 0 };
const acc = { flow: 0 };
function init() { initGraph(); initStrips(); initTable(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.sens = lerp(sm.sens, m.sens, k2); sm.spec = lerp(sm.spec, m.spec, k2); sm.ppv = lerp(sm.ppv, m.ppv, k2); sm.npv = lerp(sm.npv, m.npv, k2);
  sm.prev = lerp(sm.prev, m.prev, k2); sm.cut = lerp(sm.cut, m.cutX, k1); sm.confirm = lerp(sm.confirm, m.confirm, k1);
  const cut = clamp(sm.cut, AX0 + 6, AX1 - 6);
  /* shaded areas and the moving cut-off */
  gEls.tn.setAttribute("d", areaD(CA, AX0, cut)); gEls.fp.setAttribute("d", areaD(CA, cut, AX1));
  gEls.fn.setAttribute("d", areaD(CP, AX0, cut)); gEls.tp.setAttribute("d", areaD(CP, cut, AX1));
  gEls.cut.setAttribute("d", "M" + f1(cut) + " 112V" + BASE);
  const confX = clamp(cut + 72, AX0 + 6, AX1 - 6);
  gEls.conf.setAttribute("d", "M" + f1(confX) + " 150V" + BASE); gEls.conf.setAttribute("opacity", sm.confirm.toFixed(2));
  if (cutPill) { const leader = cutPill.querySelector("path"), dot = cutPill.querySelector("circle"); if (leader) leader.setAttribute("d", "M" + f1(cut) + " 118L285 104"); if (dot) { dot.setAttribute("cx", f1(cut)); dot.setAttribute("cy", "118"); } }
  if (confPill) confPill.style.opacity = sm.confirm.toFixed(2);
  /* person dots change sides as the cut-off passes them */
  stripDots.pres.forEach((d) => { d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y + Math.sin(tm / 700 + d.x) * 1.2)); d.e.setAttribute("class", "ep-dot " + (d.x >= cut ? "ep-d-tp" : "ep-d-fn")); });
  stripDots.abs.forEach((d) => { d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y + Math.cos(tm / 800 + d.x) * 1.2)); d.e.setAttribute("class", "ep-dot " + (d.x >= cut ? "ep-d-fp" : "ep-d-tn")); });
  /* travellers along the axis, recoloured once they cross the cut-off */
  acc.flow += dt * 3.2; while (acc.flow >= 1) { acc.flow--; const p = freeP(flows); if (p) emit(p, AX0 + 4, BASE - 7, rnd(34, 48), 0, 0); }
  flows.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.x = clamp(p.x, AX0 + 2, AX1 - 2); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("class", p.x >= cut ? "ep-flow ep-flow-pos" : "ep-flow"); if (sm.confirm > 0.5 && p.x > confX && Math.random() < 0.012) kill(p); if (p.x >= AX1 - 3 || p.t > 14) kill(p); });
  /* table cells: fill strength follows the share of all tested people, mini dots follow the row share */
  const cells = { TP: $("cellTP"), FN: $("cellFN"), FP: $("cellFP"), TN: $("cellTN") };
  const fr = { TP: m.TP, FN: m.FN, FP: m.FP, TN: m.TN };
  for (const key in cells) if (cells[key]) cells[key].setAttribute("fill-opacity", (0.14 + 0.62 * clamp(fr[key] / 0.55)).toFixed(2));
  const lit = { TP: Math.round(sm.sens * 10), FN: Math.round((1 - sm.sens) * 10), FP: Math.round((1 - sm.spec) * 10), TN: Math.round(sm.spec * 10) };
  for (const key in cellDots) cellDots[key].forEach((e, i) => e.setAttribute("opacity", i < lit[key] ? "1" : "0.12"));
  const pop = $("popD"); if (pop) pop.setAttribute("width", f1(270 * sm.prev));
  /* gauges */
  gg.sens.set(sm.sens, wordOf(sm.sens, 0.6, 0.85, ["low", "moderate", "high"])); gg.spec.set(sm.spec, wordOf(sm.spec, 0.6, 0.85, ["low", "moderate", "high"]));
  gg.ppv.set(sm.ppv, wordOf(sm.ppv, 0.35, 0.65, ["low", "moderate", "high"])); gg.npv.set(sm.npv, wordOf(sm.npv, 0.65, 0.9, ["low", "moderate", "high"]));
}
run({ init, step });
