/* Glucose homeostasis scene: substrates flow through cytosol and mitochondrion enzyme steps in a liver cell. */
const WW = SC.W;
const layers = { sources: $("sources"), hep: $("hep"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, u: Math.random(), sp: rnd(0.7, 1.3) }; }); }
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts);
function flow(n, build, pts, key, speed) { const f = { tr: track(pts), ps: pool(n, build), key, speed }; flows.push(f); return f; }
const flows = [];
/* tracks: meal in, glycogen build and break, glycolysis, substrates in, PEPCK out, glucose out, lactate out */
flow(14, dot("p-gluc", 3.1), [[120, 100], [235, 110], [325, 125], [405, 165], [490, 205]], "meal", 46);
flow(10, dot("p-gluc", 3.1), [[490, 205], [562, 160], [645, 118]], "syn", 52);
flow(10, dia("p-g6p"), [[645, 118], [562, 160], [490, 205]], "lys", 52);
flow(10, dot("p-g6p", 2.8), [[490, 205], [420, 250], [350, 288], [455, 292], [530, 292]], "gly", 40);
flow(9, dot("p-lac", 2.9), [[120, 180], [235, 190], [340, 238], [455, 280], [530, 292]], "gng", 38);
flow(9, dot("p-aa", 2.9), [[120, 250], [235, 230], [340, 258], [455, 285], [530, 292]], "gng", 36);
flow(9, dot("p-gly", 2.9), [[120, 320], [255, 300], [400, 242], [490, 205]], "glyIn", 38);
flow(10, dot("p-g6p", 2.9), [[530, 292], [582, 292], [632, 268], [562, 226], [490, 205]], "pepck", 44);
flow(12, dot("p-gluc", 3.2), [[490, 205], [490, 300], [490, 360], [490, 396], [700, 396], [850, 396], [850, 190]], "out", 55);
flow(9, dot("p-lac", 3), [[490, 205], [350, 288], [252, 332], [185, 396], [320, 396]], "lacOut", 42);
flow(7, dot("p-ins", 2.8), [[365, 92], [355, 110], [325, 125]], "ins", 30);
flow(7, dia("p-gcg"), [[475, 92], [540, 128], [645, 118]], "gcg", 40);
/* ---- source and liver shapes ---- */
const mealSrc = cell(layers.sources, { cls: "src", r: 22, nuc: 0.35, seed: 2, wob: 0.12, x: 120, y: 100 });
const lacSrc = cell(layers.sources, { cls: "src", r: 20, nuc: 0.35, seed: 4, wob: 0.12, x: 120, y: 180 });
const aaSrc = cell(layers.sources, { cls: "src", r: 20, nuc: 0.35, seed: 6, wob: 0.12, x: 120, y: 250 });
const glyFat = cell(layers.sources, { cls: "fat2", r: 22, seed: 8, wob: 0.08, x: 120, y: 320 });
mk("circle", { class: "gly-node", cx: 325, cy: 125, r: 13 }, layers.hep);
mk("path", { class: "gly-enz", d: "M405 157L413 165L405 173L397 165Z" }, layers.hep);
const g6pHub = mk("circle", { class: "sc-p p-g6p", cx: 490, cy: 205, r: 15 }, layers.hep);
mk("circle", { class: "gly-node", cx: 350, cy: 288, r: 11 }, layers.hep);
mk("circle", { class: "gly-node", cx: 530, cy: 292, r: 10 }, layers.hep);
mk("path", { class: "gly-enz", d: "M582 284L590 292L582 300L574 292Z" }, layers.hep);
mk("path", { class: "gly-enz", d: "M570 154L578 162L570 170L562 162Z" }, layers.hep);
mk("path", { class: "gly-enz", d: "M490 352L498 360L490 368L482 360Z" }, layers.hep);
mk("circle", { class: "sc-p p-ins", cx: 365, cy: 92, r: 5 }, layers.hep);
mk("path", { class: "sc-p p-gcg", d: "M475 86L478 92L475 98L472 92Z" }, layers.hep);
const granules = [[0, 0], [-16, -10], [15, -12], [-14, 11], [16, 9], [0, -18], [-24, 2], [24, -2], [0, 18], [-8, -4], [9, 3], [-2, 10]].map(([dx, dy]) => mk("circle", { class: "gly-gran", cx: 645 + dx, cy: 118 + dy, r: 7 }, layers.hep));
const tissueBox = mk("rect", { class: "gly-tissue", x: 788, y: 108, width: 124, height: 82, rx: 14 }, layers.hep);
[0, 1, 2].forEach((i) => mk("path", { class: "gly-stri", d: "M" + (806 + i * 34) + " 120L" + (806 + i * 34) + " 178" }, layers.hep));
const blockX = mk("g", { opacity: "0" }, layers.marks);
mk("path", { class: "gly-block", d: "M478 348L502 372M502 348L478 372" }, blockX);
mk("circle", { class: "gly-block", cx: 490, cy: 360, r: 17 }, blockX);
const bloodGl = Array.from({ length: 26 }, () => ({ e: dot("p-gluc", 3)(), x: rnd(30, 930), r: rnd(-0.75, 0.75) }));
const gg = {};
const sm = { BG: 0.6, store: 0.7, gly: 0.6, gng: 0.1, la: 0.2, syn: 0.7, lys: 0.1, out: 0.1, ins: 0.8, gcg: 0.2, def: 0, feed: 0, g6p: 0.2, mealR: 0.8, pepck: 0.2, lacOut: 0.1, glyIn: 0.1 };
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 440, 610, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gl", "Glucose", "g-gluc", "Blood glucose: kept up by meals, glycogen breakdown and new glucose production, and lowered when the final liver step is blocked."], ["st", "Glycogen", "g-store", "The liver glycogen store: built in the fed state, used in an early fast, empty after a prolonged fast and overfilled when release is blocked."], ["gy", "Glycolysis", "g-gly", "Glucose broken down for energy in the cell: active in the fed state under insulin."], ["gn", "New glucose", "g-gng", "Gluconeogenesis: new glucose made from lactate, amino acids and glycerol, mainly in prolonged fasting."], ["la", "Lactate", "g-lac", "Lactate: rises when glucose-6-phosphate cannot leave as glucose and is diverted down glycolysis to lactate."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Meal glucose", 120, 100, 120, 62, "Glucose from a meal (or from frequent feeds). In the fed state insulin stores much of it as glycogen and uses it in glycolysis.");
  pill(ox, "Lactate", 120, 180, 120, 142, "Lactate from muscle and red cells. In fasting it is a gluconeogenesis substrate; in the storage defect it builds up instead.");
  pill(ox, "Amino acids", 120, 250, 120, 212, "Glucogenic amino acids from muscle protein: a gluconeogenesis substrate in prolonged fasting.");
  pill(ox, "Glycerol", 120, 320, 120, 282, "Glycerol from fat breakdown: a gluconeogenesis substrate that enters in the cytosol.");
  pill(ox, "Insulin", 365, 92, 365, 72, "Insulin (fed state): drives glycogen synthesis and glycolysis and switches off glycogen breakdown and gluconeogenesis.");
  pill(ox, "Glucagon", 475, 92, 475, 72, "Glucagon (fasting): drives glycogen breakdown and gluconeogenesis. It cannot release glucose if glucose-6-phosphatase is missing or glycogen is gone.");
  pill(ox, "Glycogen", 645, 118, 640, 72, "Liver glycogen store: built from glucose-6-phosphate when fed, broken back down to glucose-6-phosphate in an early fast.");
  pill(ox, "Glucose-6-P", 490, 205, 490, 162, "Glucose-6-phosphate: the shared hub. It can build glycogen, run down glycolysis, arrive from gluconeogenesis, or leave as free glucose.");
  pill(ox, "PEPCK", 582, 292, 575, 262, "PEPCK (phosphoenolpyruvate carboxykinase): a key gluconeogenesis step in and near the mitochondrion, switched on in fasting.");
  pill(ox, "G6Pase", 490, 360, 365, 345, "Glucose-6-phosphatase (G6Pase): the final step that frees glucose into blood, shared by glycogen breakdown and gluconeogenesis. Missing in von Gierke disease.");
  pill(ox, "Blood glucose", 700, 396, 820, 396, "Glucose released into blood for other tissues. Frequent feeds add glucose here from outside the liver.");
  pill(ox, "Body tissues", 850, 140, 850, 88, "Body tissues such as brain and muscle that depend on blood glucose, especially in fasting.");
}
function init() { initPanel(); }
function rates(m) {
  return { meal: clamp(sm.mealR), syn: clamp(sm.syn), lys: clamp(sm.lys), gly: clamp(sm.gly), gng: clamp(sm.gng), glyIn: clamp(sm.gng * 0.8), pepck: clamp(sm.pepck * sm.gng * 1.6), out: clamp(sm.out), lacOut: clamp(sm.lacOut), ins: clamp(sm.ins), gcg: clamp(sm.gcg) };
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.BG = lerp(sm.BG, m.BG, k2); sm.store = lerp(sm.store, m.store, k2); sm.gly = lerp(sm.gly, m.gly, k2); sm.gng = lerp(sm.gng, m.gng, k2); sm.la = lerp(sm.la, m.la, k2);
  sm.syn = lerp(sm.syn, m.syn, k2); sm.lys = lerp(sm.lys, m.lys, k2); sm.out = lerp(sm.out, m.out, k2); sm.ins = lerp(sm.ins, m.ins, k1); sm.gcg = lerp(sm.gcg, m.gcg, k1);
  sm.def = lerp(sm.def, m.def, k1); sm.feed = lerp(sm.feed, m.feed, k1); sm.g6p = lerp(sm.g6p, m.g6p, k2); sm.pepck = lerp(sm.pepck, m.pepck, k2);
  sm.mealR = lerp(sm.mealR, clamp(m.meal + m.feed * 0.9), k2); sm.lacOut = lerp(sm.lacOut, clamp(m.def * (m.lys + m.gng) * 0.7 + 0.04), k2);
  const R = rates(m);
  flows.forEach((f) => { const rate = R[f.key] || 0, want = Math.round(rate * f.ps.length);
    f.ps.forEach((p, i) => { const on = i < want; if (on) { p.u += dt * f.speed * p.sp / f.tr.len; if (p.u > 1) p.u -= 1; const a = f.tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); } p.e.setAttribute("opacity", on ? "1" : "0"); }); });
  const wbg = Math.round(sm.BG * bloodGl.length);
  bloodGl.forEach((p, i) => { p.x += 52 * dt; if (p.x > 940) { p.x = 22; p.r = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(396 + p.r * 15) + ")"); p.e.setAttribute("opacity", i < wbg ? "1" : "0"); });
  granules.forEach((g, i) => { const on = i < Math.round(sm.store * granules.length); g.setAttribute("opacity", on ? "1" : "0.12"); g.setAttribute("r", f1(5 + 3 * sm.store)); });
  g6pHub.setAttribute("r", f1(13 + 7 * sm.g6p)); g6pHub.setAttribute("opacity", (0.65 + 0.35 * sm.g6p).toFixed(2));
  blockX.setAttribute("opacity", sm.def.toFixed(2));
  [mealSrc, lacSrc, aaSrc].forEach((c, i) => place(c, [120, 120, 120][i], [100, 180, 250][i] + Math.sin(tm / 1600 + i) * 2, 0, 1));
  place(glyFat, 120, 320 + Math.sin(tm / 1800) * 2, 0, 1);
  gg.gl.set(sm.BG, wordOf(sm.BG, 0.45, 0.72, ["low", "maintained", "high"])); gg.st.set(sm.store, wordOf(sm.store, 0.25, 0.7, ["empty", "partly full", "full"]));
  gg.gy.set(sm.gly, wordOf(sm.gly, 0.3, 0.6, ["low", "some", "high"])); gg.gn.set(sm.gng, wordOf(sm.gng, 0.25, 0.55, ["off", "some", "high"])); gg.la.set(sm.la, wordOf(sm.la, 0.35, 0.6, ["normal", "raised", "high"]));
}
run({ init, step });
