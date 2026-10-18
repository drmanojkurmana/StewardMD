/* Wernicke Korsakoff scene: thiamine supply, PDH and transketolase, vulnerable brain areas, triad and memory. */
const layers = { cause: $("causeG"), path: $("pathG"), brain: $("brainG"), clin: $("clinG"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- cause icons ---- */
(function () {
  mk("rect", { class: "wk-bottle", x: 68, y: 118, width: 14, height: 18, rx: 3 }, layers.cause);
  mk("rect", { class: "wk-bottle", x: 58, y: 134, width: 34, height: 46, rx: 7 }, layers.cause);
  mk("rect", { class: "wk-bottle2", x: 63, y: 146, width: 24, height: 16, rx: 3 }, layers.cause);
  mk("ellipse", { class: "wk-plate", cx: 190, cy: 158, rx: 36, ry: 13 }, layers.cause);
  mk("ellipse", { class: "wk-plate2", cx: 190, cy: 156, rx: 21, ry: 7 }, layers.cause);
  mk("circle", { class: "wk-bottle2", cx: 182, cy: 154, r: 3 }, layers.cause);
  mk("circle", { class: "wk-bottle2", cx: 197, cy: 157, r: 2.4 }, layers.cause);
})();
/* ---- metabolism nodes ---- */
const enz1 = mk("g", {}, layers.path), enz2 = mk("g", {}, layers.path);
mk("circle", { class: "wk-gluN", cx: 62, cy: 285, r: 15 }, layers.path);
mk("circle", { class: "wk-gluN", cx: 62, cy: 375, r: 13 }, layers.path);
mk("path", { class: "wk-arrow", d: "M79 285L104 285M79 375L104 375M156 285L181 285M156 375L172 375" }, layers.path);
mk("polygon", { class: "wk-enz", points: "0,-24 24,0 0,24 -24,0" }, enz1);
mk("polygon", { class: "wk-enz", points: "0,-23 22,0 0,23 -22,0" }, enz2);
place(enz1, 130, 285, 0, 1); place(enz2, 130, 375, 0, 1);
mk("circle", { class: "wk-tca", cx: 205, cy: 285, r: 21 }, layers.path);
mk("path", { class: "wk-arrow", d: "M193 276A15 15 0 1 1 217 276" }, layers.path);
mk("rect", { class: "wk-box", x: 176, y: 358, width: 58, height: 34, rx: 8 }, layers.path);
mk("circle", { class: "wk-atp", cx: 248, cy: 285, r: 8 }, layers.path);
const gluX = mk("g", { opacity: "0" }, layers.path);
mk("path", { class: "wk-x", d: "M118 273l24 24M142 273l-24 24" }, gluX);
/* ---- brain areas ---- */
mk("ellipse", { class: "wk-brain", cx: 466, cy: 258, rx: 138, ry: 108 }, layers.brain);
mk("ellipse", { class: "wk-brain2", cx: 430, cy: 222, rx: 88, ry: 60 }, layers.brain);
const haloT = mk("circle", { class: "wk-halo", cx: 435, cy: 215, r: 48 }, layers.brain);
const haloP = mk("circle", { class: "wk-halo", cx: 505, cy: 245, r: 30 }, layers.brain);
const haloM = mk("circle", { class: "wk-halo", cx: 430, cy: 318, r: 30 }, layers.brain);
mk("ellipse", { class: "wk-node", cx: 435, cy: 215, rx: 36, ry: 22 }, layers.brain);
mk("circle", { class: "wk-pag", cx: 505, cy: 245, r: 17 }, layers.brain);
mk("circle", { class: "wk-aq", cx: 505, cy: 245, r: 6 }, layers.brain);
mk("circle", { class: "wk-mam", cx: 418, cy: 318, r: 11 }, layers.brain);
mk("circle", { class: "wk-mam", cx: 443, cy: 318, r: 11 }, layers.brain);
/* ---- clinical features ---- */
const confG = mk("g", {}, layers.clin), eyeG = mk("g", {}, layers.clin), gaitG = mk("g", {}, layers.clin), memG = mk("g", {}, layers.clin);
mk("circle", { class: "wk-cloud", cx: 704, cy: 150, r: 14 }, confG);
mk("circle", { class: "wk-cloud", cx: 724, cy: 140, r: 18 }, confG);
mk("circle", { class: "wk-cloud", cx: 744, cy: 150, r: 14 }, confG);
mk("ellipse", { class: "wk-cloud", cx: 724, cy: 154, rx: 28, ry: 10 }, confG);
mk("ellipse", { class: "wk-eyeW", cx: 720, cy: 215, rx: 31, ry: 16 }, eyeG);
const iris = mk("circle", { class: "wk-iris", cx: 720, cy: 215, r: 8 }, eyeG);
const pupil = mk("circle", { class: "wk-pupil", cx: 720, cy: 215, r: 3.4 }, eyeG);
const gaitInner = mk("g", {}, gaitG);
mk("circle", { class: "wk-head", cx: 712, cy: 258, r: 8 }, gaitInner);
mk("path", { class: "wk-fig", d: "M712 266L718 290L705 312M718 290L733 306M712 274L696 287M712 274L731 280M688 318C706 312 724 324 748 317" }, gaitInner);
mk("rect", { class: "wk-book", x: 694, y: 338, width: 52, height: 34, rx: 4 }, memG);
mk("rect", { class: "wk-book2", x: 718, y: 342, width: 24, height: 26, rx: 2 }, memG);
mk("path", { class: "wk-fig", d: "M720 342L720 368" }, memG);
const memX = mk("g", { opacity: "0" }, memG);
mk("path", { class: "wk-x", d: "M702 344l36 24M738 344l-36 24" }, memX);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const thiP = pool(18, function () { return mk("circle", { class: "sc-p p-thi", r: 2.7 }, layers.parts); });
const gluP = pool(18, function () { return mk("circle", { class: "sc-p p-gluP", r: 2.5 }, layers.parts); });
const atpP = pool(12, function () { return mk("circle", { class: "sc-p p-atp", r: 2.4 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const thiTargets = [[435, 215], [505, 245], [430, 318]];
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["thi", "Thiamine", "g-thi", "Thiamine stores and supply. Alcohol use and poor intake deplete them, and glucose use consumes the active cofactor."], ["enz", "Enzymes", "g-enz", "Thiamine dependent enzymes: pyruvate dehydrogenase for the TCA cycle and transketolase for the pentose phosphate pathway."], ["atp", "Energy", "g-atp", "Energy made by brain cells. It falls when the thiamine dependent steps fail."], ["dmg", "Injury", "g-dmg", "Injury to mammillary bodies, thalamus and periaqueductal grey. It grows when deficiency is severe or glucose is given alone."], ["tri", "Triad", "g-tri", "The Wernicke triad: confusion, ataxia and ophthalmoplegia. The full triad is often incomplete."], ["mem", "Memory", "g-mem", "Ability to form new memories. In Korsakoff syndrome this stays severely impaired even when thiamine is restored."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Alcohol", 75, 118, 75, 108, "Alcohol use: a major route to thiamine deficiency, through poor intake, poor absorption and poor storage.");
  pill(ox, "Poor diet", 190, 145, 190, 108, "Poor diet and vomiting: thiamine stores are small and run out quickly when intake is low.");
  pill(ox, "Thiamine cofactor", 130, 261, 150, 245, "Thiamine pyrophosphate is the cofactor that lets pyruvate dehydrogenase and transketolase work. Without it both pathways slow.");
  pill(ox, "Glucose", 62, 270, 62, 332, "Glucose is the fuel entering both pathways. Giving glucose alone consumes remaining thiamine and can worsen the deficiency state.");
  pill(ox, "TCA cycle", 205, 264, 205, 332, "The TCA cycle, fed by pyruvate dehydrogenase. It makes most of the energy from glucose.");
  pill(ox, "Pentose pathway", 205, 392, 160, 414, "The pentose phosphate pathway, through transketolase. It makes NADPH and building blocks and also needs thiamine.");
  pill(ox, "Thalamus", 435, 193, 365, 118, "The thalamus, especially its dorsomedial part near the third ventricle. Injury here links to confusion and memory failure.");
  pill(ox, "Periaqueductal", 505, 228, 575, 118, "Periaqueductal grey around the aqueduct in the midbrain. Injury here links to eye movement failure.");
  pill(ox, "Mammillary bodies", 430, 329, 400, 408, "Mammillary bodies at the base of the brain. They are part of the memory circuit and are characteristically injured.");
  pill(ox, "Confusion", 748, 150, 845, 140, "Confusion: inattention and disorientation, often the earliest and most prominent Wernicke feature.");
  pill(ox, "Ophthalmoplegia", 751, 215, 845, 210, "Ophthalmoplegia: weak eye movements, often sideways gaze failure and nystagmus.");
  pill(ox, "Ataxia", 733, 300, 845, 280, "Ataxia: a broad based, unsteady gait, mainly from midline cerebellar and vestibular involvement.");
  pill(ox, "Memory loss", 746, 355, 845, 350, "Memory loss: in Korsakoff syndrome, severe failure to form new memories, sometimes filled in by confabulation.");
  const r1 = pill(ox, "Thiamine first", 466, 366, 545, 408, "Intravenous thiamine first restores the cofactor before glucose can consume what is left."); r1.setAttribute("id", "rx-thi");
  const r2 = pill(ox, "Glucose alone", 466, 366, 545, 408, "Glucose alone can worsen the state by consuming the last thiamine cofactor."); r2.setAttribute("id", "rx-glu");
  const r3 = pill(ox, "Supportive", 466, 366, 545, 408, "Supportive care only: fluids, nutrition and monitoring without replacing thiamine."); r3.setAttribute("id", "rx-sup");
}
const sm = { Th: 0.4, En: 0.4, ATP: 0.4, Dmg: 0.4, Tri: 0.4, Mem: 0.6, thi: 0, glu: 0, sup: 0 };
const acc = { thi: 0, glu: 0, atp: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k1 = Math.min(1, dt * 1.1);
  sm.Th = lerp(sm.Th, m.Th, k); sm.En = lerp(sm.En, m.En, k); sm.ATP = lerp(sm.ATP, m.ATP, k); sm.Dmg = lerp(sm.Dmg, m.Dmg, k); sm.Tri = lerp(sm.Tri, m.Tri, k); sm.Mem = lerp(sm.Mem, m.Mem, k);
  sm.thi = lerp(sm.thi, m.thi, k1); sm.glu = lerp(sm.glu, m.glu, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  /* brain injury halos and clinical signs */
  const pulse = 1 + 0.08 * Math.sin(tm / 320);
  haloT.setAttribute("opacity", (sm.Dmg * 0.55).toFixed(2)); haloP.setAttribute("opacity", (sm.Dmg * 0.55).toFixed(2)); haloM.setAttribute("opacity", (sm.Dmg * 0.55).toFixed(2));
  haloT.setAttribute("r", f1(48 * pulse)); haloP.setAttribute("r", f1(30 * pulse)); haloM.setAttribute("r", f1(30 * pulse));
  confG.style.opacity = (0.3 + 0.7 * sm.Tri).toFixed(2); eyeG.style.opacity = (0.3 + 0.7 * sm.Tri).toFixed(2); gaitG.style.opacity = (0.3 + 0.7 * sm.Tri).toFixed(2); memG.style.opacity = (0.35 + 0.65 * (1 - sm.Mem)).toFixed(2);
  memX.setAttribute("opacity", clamp(1 - sm.Mem).toFixed(2));
  const irisX = 720 + Math.sin(tm / 700) * 9 * (1 - sm.Tri * 0.85);
  iris.setAttribute("cx", f1(irisX)); pupil.setAttribute("cx", f1(irisX));
  gaitInner.setAttribute("transform", "rotate(" + f1(Math.sin(tm / 420) * 7 * sm.Tri) + " 720 290)");
  place(enz1, 130, 285, 0, 0.7 + 0.3 * sm.En); place(enz2, 130, 375, 0, 0.7 + 0.3 * sm.En);
  gluX.setAttribute("opacity", sm.glu.toFixed(2));
  $("rx-thi").style.opacity = sm.thi.toFixed(2); $("rx-glu").style.opacity = sm.glu.toFixed(2); $("rx-sup").style.opacity = sm.sup.toFixed(2);
  /* thiamine particles enter the brain and head for the vulnerable areas */
  acc.thi += dt * (0.6 + 7 * sm.Th); while (acc.thi >= 1) { acc.thi--; const p = freeP(thiP); if (p) emit(p, 338, 300, 0, 0, Math.floor(rnd(0, 3))); }
  thiP.forEach(function (p) { if (!p.on) return; const tg = thiTargets[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 58 * dt; p.y += (dy / d) * 58 * dt; p.x = clamp(p.x, 300, 640); p.y = clamp(p.y, 90, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 14) kill(p); });
  /* glucose particles queue at the enzyme gate when enzymes fail */
  acc.glu += dt * (3 + 3 * sm.glu + 2 * sm.En); while (acc.glu >= 1) { acc.glu--; const p = freeP(gluP); if (p) emit(p, 62, Math.random() < 0.55 ? 285 : 375, rnd(26, 40), 0, 0); }
  gluP.forEach(function (p) { if (!p.on) return; p.t += dt; const gate = p.y < 330 ? 106 : 108, past = p.x > gate + 24; p.x += p.vx * dt * (past ? 0.4 + 0.6 * sm.En : 1); if (!past && sm.En < 0.45) p.x = Math.min(p.x, gate + rnd(0, 2)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t / 2.2).toFixed(2)); if (p.x > 196 || p.t > 2.6) kill(p); });
  /* energy sparks leave the TCA cycle */
  acc.atp += dt * (1 + 8 * sm.ATP); while (acc.atp >= 1) { acc.atp--; const p = freeP(atpP); if (p) emit(p, 214, 278, rnd(8, 22), rnd(-20, -8), 0); }
  atpP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1 || p.x > 262 || p.y < 238) kill(p); });
  /* gauges */
  gg.thi.set(sm.Th, wordOf(sm.Th, 0.35, 0.65, ["low", "reduced", "ok"])); gg.enz.set(sm.En, wordOf(sm.En, 0.35, 0.65, ["slow", "reduced", "working"])); gg.atp.set(sm.ATP, wordOf(sm.ATP, 0.35, 0.65, ["low", "reduced", "ok"]));
  gg.dmg.set(sm.Dmg, wordOf(sm.Dmg, 0.3, 0.6, ["little", "active", "severe"])); gg.tri.set(sm.Tri, wordOf(sm.Tri, 0.3, 0.6, ["absent", "partial", "full"])); gg.mem.set(sm.Mem, wordOf(sm.Mem, 0.35, 0.65, ["lost", "impaired", "preserved"]));
}
run({ init: init, step: step });
