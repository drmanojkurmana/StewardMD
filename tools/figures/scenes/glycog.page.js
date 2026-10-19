/* Glucose homeostasis scene: gut food, liver store and new making, blood band. */
const WW = SC.W;
const layers = { hep: $("hep"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen"), vesselMeal: $("vesselMeal"), vesselBypass: $("vesselBypass"), vesselOut: $("vesselOut") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: Math.random(), sp: rnd(0.7, 1.3) }; }); }
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts);
const flows = [];
function flow(n, build, pts, key, speed) { const f = { tr: track(pts), ps: pool(n, build), key, speed }; flows.push(f); return f; }
/* ---- organs and anchors (set in initOrgans) ---- */
let gutO = null, liverO = null, pancO = null;
let granC = [555, 182], hub = [480, 232], mitoC = [410, 277], exitPt = [467, 312], recPt = [425, 212], livTop = [470, 132];
let g6pHub = null, crist = null, blockX = null;
const docked = [], granules = [];
let capEl = null, capKey = "";
function capText(level, drug) {
  if (level === 3) {
    if (drug === 2) return "Frequent feeds bypass the blocked step. Blood glucose holds.";
    if (drug === 1) return "Glucagon docks but the final step stays blocked. No glucose gets out.";
    return "No treatment. The final step is blocked. Glucose is trapped and lactate rises.";
  }
  if (level === 2) {
    if (drug === 2) return "Frequent feeds supply glucose from outside. Blood glucose runs high.";
    if (drug === 1) return "Glucagon pushes new glucose making. Output rises.";
    return "Long fast. Glycogen is empty. New glucose is made from scraps.";
  }
  if (level === 1) {
    if (drug === 2) return "Feeds top up blood glucose from the gut. It runs high.";
    if (drug === 1) return "Glucagon speeds glycogen breakdown. Output rises.";
    return "Early fast. Glycogen breaks down to feed the blood.";
  }
  if (drug === 2) return "Extra feeds on top of a meal. Blood glucose runs high.";
  if (drug === 1) return "Glucagon signals release, but the meal still fills the store.";
  return "After a meal. Insulin packs glucose away as glycogen.";
}
function initOrgans() {
  gutO = organ($("gutSlot"), "intestine", 128, 232, 150, {});
  liverO = organ($("liverSlot"), "liver", 480, 222, 250, {});
  pancO = organ($("pancSlot"), "pancreas", 405, 86, 130, {});
  const LP = liverO.ports, GP = gutO.ports, PP = pancO.ports;
  const gutOut = GP.out, livPorta = LP.porta, livExit = LP.in, livTopP = LP.out, rec = LP.lobe;
  granC = [Math.round(liverO.x + 75), Math.round(liverO.y - 40)];
  hub = [Math.round(liverO.x), Math.round(liverO.y + 10)];
  mitoC = [Math.round(liverO.x - 70), Math.round(liverO.y + 55)];
  exitPt = [livExit[0], livExit[1]]; recPt = [rec[0], rec[1]]; livTop = [livTopP[0], livTopP[1]];
  layers.vesselMeal.setAttribute("d", "M" + f1(gutOut[0]) + " " + f1(gutOut[1]) + " C" + f1(gutOut[0] + 60) + " " + f1(gutOut[1]) + " " + f1(livPorta[0] - 70) + " " + f1(livPorta[1]) + " " + f1(livPorta[0]) + " " + f1(livPorta[1]));
  layers.vesselBypass.setAttribute("d", "M" + f1(gutOut[0]) + " " + f1(gutOut[1]) + " C" + f1(gutOut[0] + 45) + " " + f1(gutOut[1] + 55) + " 250 386 310 396");
  layers.vesselOut.setAttribute("d", "M" + f1(exitPt[0]) + " " + f1(exitPt[1]) + " L" + f1(exitPt[0]) + " 380 C" + f1(exitPt[0] + 90) + " 392 720 396 850 396");
  /* mitochondrion with inner folds */
  const mx = mitoC[0], my = mitoC[1];
  mk("rect", { class: "gy-mito", x: f1(mx - 70), y: f1(my - 24), width: 140, height: 48, rx: 24 }, layers.hep);
  crist = mk("path", { class: "gy-crist", d: "M" + f1(mx - 56) + " " + f1(my) + " q12 -10 24 0 t24 0 t24 0 t24 0" }, layers.hep);
  /* shared hub and enzyme marks */
  g6pHub = mk("circle", { class: "sc-p p-g6p", cx: f1(hub[0]), cy: f1(hub[1]), r: 15 }, layers.hep);
  const gk = [lerp(gutOut[0], livPorta[0], 0.82), lerp(gutOut[1], livPorta[1], 0.82)];
  mk("circle", { class: "gy-node", cx: f1(gk[0]), cy: f1(gk[1]), r: 9 }, layers.hep);
  mk("circle", { class: "gy-node", cx: f1(mx + 20), cy: f1(my - 24), r: 8 }, layers.hep);
  mk("path", { class: "gy-enz", d: "M" + f1(exitPt[0]) + " " + f1(exitPt[1] - 8) + "L" + f1(exitPt[0] + 8) + " " + f1(exitPt[1]) + "L" + f1(exitPt[0]) + " " + f1(exitPt[1] + 8) + "L" + f1(exitPt[0] - 8) + " " + f1(exitPt[1]) + "Z" }, layers.hep);
  /* glucagon receptor and docked copies */
  mk("circle", { class: "gy-rec", cx: f1(recPt[0]), cy: f1(recPt[1]), r: 7 }, layers.hep);
  [[-11, 1], [0, -3], [11, 2]].forEach(([dx, dy]) => {
    const e = mk("path", { class: "sc-p p-gcg", d: "M0 -4.5L4 0L0 4.5L-4 0Z", transform: "translate(" + f1(recPt[0] + dx) + " " + f1(recPt[1] + dy) + ")" }, layers.marks);
    e.setAttribute("opacity", "0"); docked.push({ e, dx, dy });
  });
  /* glycogen granules */
  [[0, 0], [-16, -10], [15, -12], [-14, 11], [16, 9], [0, -18], [-24, 2], [24, -2], [0, 18], [-8, -4], [9, 3], [-2, 10]].forEach(([dx, dy]) => {
    granules.push(mk("circle", { class: "gy-gran", cx: f1(granC[0] + dx), cy: f1(granC[1] + dy), r: 7 }, layers.hep));
  });
  /* blocked-step mark at the liver exit */
  blockX = mk("g", { opacity: "0" }, layers.marks);
  mk("circle", { class: "gy-blockfill", cx: f1(exitPt[0]), cy: f1(exitPt[1] + 7), r: 16 }, blockX);
  mk("path", { class: "gy-block", d: "M" + f1(exitPt[0] - 10) + " " + f1(exitPt[1] - 3) + "L" + f1(exitPt[0] + 10) + " " + f1(exitPt[1] + 17) + "M" + f1(exitPt[0] + 10) + " " + f1(exitPt[1] - 3) + "L" + f1(exitPt[0] - 10) + " " + f1(exitPt[1] + 17) }, blockX);
  /* ---- particle tracks, all anchored on organ ports ---- */
  const mid = [(gutOut[0] + livPorta[0]) / 2, (gutOut[1] + livPorta[1]) / 2 - 8];
  flow(14, dot("p-gluc", 3.1), [gutOut, mid, livPorta], "meal", 46);
  flow(12, dot("p-gluc", 3.1), [gutOut, [gutOut[0] + 50, gutOut[1] + 55], [310, 396]], "bypass", 60);
  flow(10, dot("p-gluc", 3.1), [hub, granC], "syn", 52);
  flow(10, dia("p-g6p"), [granC, hub], "lys", 52);
  flow(10, dot("p-g6p", 2.8), [hub, [mx + 20, my - 24]], "gly", 44);
  flow(8, dot("p-lac", 2.9), [[250, 396], [270, 340], [330, 300], [mx - 30, my]], "subLac", 40);
  flow(8, dot("p-aa", 2.9), [[350, 396], [360, 350], [375, 315], [mx - 10, my + 6]], "subAA", 38);
  flow(8, dot("p-gly", 2.9), [[450, 396], [452, 350], [455, 315], [mx + 30, my + 8]], "subGly", 38);
  flow(10, dot("p-g6p", 2.9), [[mx + 55, my], hub], "pepck", 46);
  flow(12, dot("p-gluc", 3.2), [exitPt, [exitPt[0], 380], [700, 396], [850, 396]], "out", 55);
  flow(9, dot("p-lac", 3), [hub, [380, 300], [280, 350], [205, 396]], "lacOut", 44);
  flow(7, dot("p-ins", 2.8), [PP.body, livTop], "ins", 34);
  flow(7, dia("p-gcg"), [PP.head, recPt], "gcg", 42);
}
/* ---- blood band dots ---- */
const bloodGl = Array.from({ length: 26 }, () => ({ e: dot("p-gluc", 3)(), x: rnd(30, 930), r: rnd(-0.75, 0.75) }));
const bloodLac = Array.from({ length: 14 }, () => ({ e: dot("p-lac", 3)(), x: rnd(30, 930), r: rnd(-0.75, 0.75) }));
const gg = {};
const sm = { BG: 0.6, store: 0.7, gly: 0.6, gng: 0.1, la: 0.2, syn: 0.7, lys: 0.1, out: 0.1, ins: 0.8, gcg: 0.2, def: 0, feed: 0, gtx: 0, g6p: 0.2, mealR: 0.8, pepck: 0.2, lacOut: 0.1 };
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 440, 610, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gl", "Glucose", "g-gluc", "Blood glucose: kept up by meals, glycogen breakdown and new glucose production, and lowered when the final liver step is blocked."], ["st", "Glycogen", "g-store", "The liver glycogen store: built in the fed state, used in an early fast, empty after a prolonged fast and overfilled when release is blocked."], ["gy", "Glycolysis", "g-gly", "Glucose broken down for energy in the cell: active in the fed state under insulin."], ["gn", "New glucose", "g-gng", "Gluconeogenesis: new glucose made from lactate, amino acids and glycerol, mainly in prolonged fasting."], ["la", "Lactate", "g-lac", "Lactate: rises when glucose-6-phosphate cannot leave as glucose and is diverted down glycolysis to lactate."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Food", gutO.x, gutO.y, 120, 66, "Food glucose enters through the gut and travels in portal blood to the liver.");
  pill(ox, "Hormones", pancO.x, pancO.y, 510, 62, "Insulin after meals stores glucose. Glucagon in fasting releases it. Both come from the pancreas.");
  pill(ox, "Liver", liverO.x - 100, liverO.y, 300, 118, "The liver stores glucose as glycogen, breaks it back down, and makes new glucose.");
  pill(ox, "Glycogen", granC[0], granC[1], 640, 70, "Glycogen store. Full after meals, used in an early fast, overfilled when release is blocked.");
  pill(ox, "New glucose", mitoC[0] + 40, mitoC[1], 600, 348, "New glucose made from blood scraps near the mitochondrion. Strong in a long fast.");
  pill(ox, "Final step", exitPt[0], exitPt[1], 360, 348, "The final step that frees glucose into blood. Missing in this storage defect, so glucose is trapped.");
  pill(ox, "Blood glucose", 700, 396, 760, 348, "Blood glucose for the body. Fed by meals, the liver, or frequent feeds.");
  pill(ox, "Lactate", 205, 396, 140, 348, "Lactate leaving the liver. Rises when trapped glucose is forced down to lactate.");
  capEl = mk("text", { class: "gy-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 0);
}
function init() { initOrgans(); initPanel(); }
function rates() {
  return { meal: clamp(sm.mealR), bypass: clamp(sm.feed), syn: clamp(sm.syn), lys: clamp(sm.lys), gly: clamp(sm.gly), subLac: clamp(sm.gng), subAA: clamp(sm.gng), subGly: clamp(sm.gng * 0.8), pepck: clamp(sm.pepck * sm.gng * 1.6), out: clamp(sm.out), lacOut: clamp(sm.lacOut), ins: clamp(sm.ins), gcg: clamp(sm.gcg) };
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.BG = lerp(sm.BG, m.BG, k2); sm.store = lerp(sm.store, m.store, k2); sm.gly = lerp(sm.gly, m.gly, k2); sm.gng = lerp(sm.gng, m.gng, k2); sm.la = lerp(sm.la, m.la, k2);
  sm.syn = lerp(sm.syn, m.syn, k2); sm.lys = lerp(sm.lys, m.lys, k2); sm.out = lerp(sm.out, m.out, k2); sm.ins = lerp(sm.ins, m.ins, k1); sm.gcg = lerp(sm.gcg, m.gcg, k1);
  sm.def = lerp(sm.def, m.def, k1); sm.feed = lerp(sm.feed, m.feed, k1); sm.gtx = lerp(sm.gtx, m.gtx, k1); sm.g6p = lerp(sm.g6p, m.g6p, k2); sm.pepck = lerp(sm.pepck, m.pepck, k2);
  sm.mealR = lerp(sm.mealR, clamp(m.meal + m.feed * 0.9), k2); sm.lacOut = lerp(sm.lacOut, clamp(m.def * (m.lys + m.gng) * 0.7 + 0.04), k2);
  const R = rates();
  flows.forEach((f) => { const rate = R[f.key] || 0, want = Math.round(rate * f.ps.length);
    f.ps.forEach((p, i) => { const on = i < want; if (on) { p.u += dt * f.speed * p.sp / f.tr.len; if (p.u > 1) p.u -= 1; const a = f.tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); } p.e.setAttribute("opacity", on ? "1" : "0"); }); });
  const wbg = Math.round(sm.BG * bloodGl.length), wla = Math.round(clamp(sm.lacOut) * bloodLac.length);
  bloodGl.forEach((p, i) => { p.x += 52 * dt; if (p.x > 940) { p.x = 22; p.r = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(396 + p.r * 15) + ")"); p.e.setAttribute("opacity", i < wbg ? "1" : "0"); });
  bloodLac.forEach((p, i) => { p.x += 52 * dt; if (p.x > 940) { p.x = 22; p.r = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(396 + p.r * 15) + ")"); p.e.setAttribute("opacity", i < wla ? "1" : "0"); });
  granules.forEach((g, i) => { const on = i < Math.round(sm.store * granules.length); g.setAttribute("opacity", on ? "1" : "0.12"); g.setAttribute("r", f1(5 + 3 * sm.store)); });
  g6pHub.setAttribute("r", f1(13 + 7 * sm.g6p)); g6pHub.setAttribute("opacity", (0.65 + 0.35 * sm.g6p).toFixed(2));
  blockX.setAttribute("opacity", sm.def.toFixed(2));
  crist.setAttribute("opacity", (0.25 + 0.7 * clamp(sm.gng)).toFixed(2));
  docked.forEach((d, i) => { d.e.setAttribute("opacity", (clamp(sm.gtx * 1.2 - i * 0.2)).toFixed(2)); d.e.setAttribute("transform", "translate(" + f1(recPt[0] + d.dx) + " " + f1(recPt[1] + d.dy + Math.sin(tm / 500 + i * 2) * 1.5) + ")"); });
  layers.vesselMeal.setAttribute("opacity", (0.25 + 0.65 * clamp(sm.mealR)).toFixed(2));
  layers.vesselBypass.setAttribute("opacity", (0.08 + 0.85 * clamp(sm.feed)).toFixed(2));
  layers.vesselBypass.setAttribute("stroke-width", f1(3 + 8 * clamp(sm.feed)));
  layers.vesselOut.setAttribute("opacity", (0.2 + 0.7 * clamp(sm.out + sm.def * 0.1)).toFixed(2));
  gg.gl.set(sm.BG, wordOf(sm.BG, 0.45, 0.72, ["low", "maintained", "high"])); gg.st.set(sm.store, wordOf(sm.store, 0.25, 0.7, ["empty", "partly full", "full"]));
  gg.gy.set(sm.gly, wordOf(sm.gly, 0.3, 0.6, ["low", "some", "high"])); gg.gn.set(sm.gng, wordOf(sm.gng, 0.25, 0.55, ["off", "some", "high"])); gg.la.set(sm.la, wordOf(sm.la, 0.35, 0.6, ["normal", "raised", "high"]));
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
