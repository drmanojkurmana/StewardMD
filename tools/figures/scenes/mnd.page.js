/* Motor neuron disease scene: cortex, tract, cord, bulbar and respiratory neurons, muscle, diaphragm, spared systems and gauges. */
const layers = { tracts: $("tracts"), organs: $("organs"), cellsL: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- static organs and tracts ---- */
let tractEl = null, muscleG = null, diaphG = null, tongueG = null, helpG = null, ventG = null;
function initOrgans() {
  const O = layers.organs;
  mk("ellipse", { class: "mn-cortex", cx: 150, cy: 122, rx: 118, ry: 54 }, O);
  mk("rect", { class: "mn-stem", x: 374, y: 68, width: 82, height: 52, rx: 20 }, O);
  mk("rect", { class: "mn-cord", x: 382, y: 82, width: 66, height: 328, rx: 33 }, O);
  const T = layers.tracts;
  tractEl = mk("path", { class: "mn-tract", d: "M172 138C260 152 330 118 396 106L412 160L412 335" }, T);
  mk("path", { class: "mn-axon", d: "M432 182C500 178 560 195 624 205" }, T);
  mk("path", { class: "mn-axon", d: "M402 106C340 150 290 200 272 238" }, T);
  mk("path", { class: "mn-axon", d: "M432 340C510 345 560 355 624 360" }, T);
  mk("path", { class: "mn-sens", d: "M398 398C394 340 394 300 402 268" }, T);
  tongueG = mk("g", {}, O);
  mk("ellipse", { class: "mn-tongue", cx: 232, cy: 252, rx: 48, ry: 20 }, tongueG);
  muscleG = mk("g", {}, O);
  mk("rect", { class: "mn-muscle", x: 624, y: 178, width: 256, height: 72, rx: 16 }, muscleG);
  [196, 214, 232].forEach((y) => mk("path", { class: "mn-fibre", d: "M638 " + y + "C700 " + (y - 6) + " 800 " + (y + 6) + " 866 " + y }, muscleG));
  diaphG = mk("g", {}, O);
  mk("path", { class: "mn-diaph", d: "M624 372Q752 318 880 372L880 392Q752 348 624 392Z" }, diaphG);
  const B = mk("g", {}, O);
  mk("rect", { class: "mn-spared", x: 478, y: 290, width: 148, height: 112, rx: 14 }, B);
  mk("ellipse", { class: "mn-eye", cx: 520, cy: 326, rx: 20, ry: 11 }, B);
  mk("circle", { class: "mn-iris", cx: 520, cy: 326, r: 5 }, B);
  mk("path", { class: "mn-check", d: "M566 326l10 10l18 -20" }, B);
  const M = mk("g", {}, O);
  mk("path", { class: "mn-dna", d: "M600 78C630 92 600 108 630 124" }, M);
  mk("path", { class: "mn-dna2", d: "M630 78C600 92 630 108 600 124" }, M);
  [86, 101, 116].forEach((y) => mk("path", { class: "mn-rung", d: "M606 " + y + "L624 " + y }, M));
  for (let i = 0; i < 7; i++) mk("circle", { class: "sc-p p-agg", cx: 812 + (i % 3) * 14, cy: 88 + Math.floor(i / 3) * 14, r: 4.5 }, M);
  helpG = mk("g", { opacity: "0" }, layers.over);
  [[610, 265], [300, 282], [606, 386]].forEach(([x, y]) => { mk("circle", { class: "mn-help", cx: x, cy: y, r: 8 }, helpG); mk("path", { class: "mn-check", d: "M" + (x - 4) + " " + y + "h8M" + x + " " + (y - 4) + "v8" }, helpG); });
  ventG = mk("g", { opacity: "0" }, layers.over);
  mk("path", { class: "mn-mask", d: "M832 332q34 24 0 48M832 340q-12 16 0 32" }, ventG);
}
/* ---- neuron cells ---- */
const umnC = { g: null, x: 150, y: 122 };
const bulbC = { g: null, x: 415, y: 94 };
const lmnC = { g: null, x: 415, y: 182 };
const respC = { g: null, x: 415, y: 340 };
const sensC = { g: null, x: 415, y: 262 };
function initCells() {
  umnC.g = cell(layers.cellsL, { cls: "umn", r: 23, nuc: 0.4, seed: 3, wob: 0.12 }); place(umnC.g, umnC.x, umnC.y, 0, 1);
  bulbC.g = cell(layers.cellsL, { cls: "bulb", r: 12, nuc: 0.4, seed: 5, wob: 0.12 }); place(bulbC.g, bulbC.x, bulbC.y, 0, 1);
  lmnC.g = cell(layers.cellsL, { cls: "lmn", r: 16, nuc: 0.4, seed: 7, wob: 0.12 }); place(lmnC.g, lmnC.x, lmnC.y, 0, 1);
  respC.g = cell(layers.cellsL, { cls: "lmn", r: 16, nuc: 0.4, seed: 9, wob: 0.12 }); place(respC.g, respC.x, respC.y, 0, 1);
  sensC.g = cell(layers.cellsL, { cls: "sens", r: 11, nuc: 0.4, seed: 11, wob: 0.1 }); place(sensC.g, sensC.x, sensC.y, 0, 1);
  const mech = cell(layers.cellsL, { cls: "lmn", r: 16, nuc: 0.4, seed: 13, wob: 0.12 }); place(mech, 735, 102, 0, 1);
}
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const sigTracks = [
  track([[150, 122], [260, 148], [396, 106], [412, 182], [500, 186], [624, 206], [740, 214]]),
  track([[415, 94], [340, 150], [285, 205], [240, 240]]),
  track([[412, 200], [412, 340], [520, 350], [624, 362], [750, 366]]),
];
const sig = pool(26, () => mk("circle", { class: "sc-p p-sig", r: 3 }, layers.parts));
const aggCentres = [[150, 122], [415, 182], [415, 94], [415, 340], [735, 102]];
const agg = pool(28, () => mk("rect", { class: "sc-p p-agg", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
agg.forEach((p, i) => { const c = aggCentres[i % aggCentres.length]; p.x = c[0] + rnd(-13, 13); p.y = c[1] + rnd(-10, 10); p.k = i; });
const glu = pool(12, () => mk("circle", { class: "sc-p p-glu", r: 2.4 }, layers.parts));
const sparks = pool(10, () => mk("path", { class: "mn-spark", d: "M-5 0L0 -5L5 0" }, layers.parts));
const air = pool(16, () => mk("circle", { class: "sc-p p-air", r: 3 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["neur", "Motor neurons", "g-neur", "Motor neurons still alive and able to fire. Upper and lower motor neurons are lost together in the common form."], ["wast", "Wasting", "g-wast", "Muscle wasting (atrophy) when lower motor neurons die and muscle loses its nerve supply."], ["fasc", "Fasciculations", "g-fasc", "Visible twitching of small muscle bundles as sick lower motor neurons fire on their own. They fade when those neurons die."], ["spast", "Spasticity", "g-spast", "Stiffness and brisk reflexes when upper motor neuron control is lost."], ["bulb", "Bulbar signs", "g-bulb", "Weak speech and swallowing when brainstem (bulbar) motor neurons are involved."], ["breath", "Breathing", "g-good", "Breathing as the diaphragm weakens. Ventilatory support assists the breathing muscles."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Upper motor neuron", 150, 99, 150, 198, "Upper motor neuron in the motor cortex. Its loss gives spasticity, stiffness and brisk reflexes.");
  pill(ox, "Lower motor neuron", 431, 170, 516, 160, "Lower motor neuron in the spinal cord. Its loss gives wasting, weakness and fasciculations.");
  pill(ox, "Bulbar neuron", 403, 84, 302, 162, "Bulbar motor neuron in the brainstem. It drives the tongue and the muscles of speech and swallowing.");
  pill(ox, "Tongue and speech", 232, 232, 138, 292, "Tongue and speech muscles. Bulbar involvement makes speech slurred and swallowing unsafe.");
  pill(ox, "Mutant genes", 615, 126, 632, 162, "Inherited forms: mutant genes, including an expanded intronic repeat in C9orf72. Most cases are sporadic, with no family history.");
  pill(ox, "TDP-43 protein", 825, 126, 842, 162, "TDP-43 protein clumps as aggregates inside dying motor neurons. Faulty protein handling is part of the disease group.");
  pill(ox, "Fasciculations", 630, 220, 548, 232, "Fasciculations: small visible twitches as sick lower motor neurons fire by themselves.");
  pill(ox, "Limb muscle", 752, 178, 752, 276, "Limb muscle. It wastes when its lower motor neuron dies, and it becomes stiff when upper motor neuron control is lost.");
  pill(ox, "Diaphragm", 752, 352, 752, 312, "Diaphragm, the main breathing muscle. Its weakness leads toward respiratory failure in advanced disease.");
  pill(ox, "Spared systems", 520, 315, 552, 428, "Sensation and eye movements are spared, because sensory pathways and eye movement control are largely untouched.");
}
const sm = { D: 0.4, Agg: 0.4, UMN: 0.4, LMN: 0.4, Wast: 0.3, Spast: 0.3, Fasc: 0.3, Bulb: 0.3, Breath: 0.7, Neur: 0.6, ril: 0, sup: 0, vent: 0 };
const acc = { sig: 0, glu: 0, air: 0, cap: 0, spark: 0 };
function init() { initOrgans(); initCells(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.D = lerp(sm.D, m.D, k2); sm.Agg = lerp(sm.Agg, m.Agg, k2); sm.UMN = lerp(sm.UMN, m.UMN, k2); sm.LMN = lerp(sm.LMN, m.LMN, k2);
  sm.Wast = lerp(sm.Wast, m.Wast, k2); sm.Spast = lerp(sm.Spast, m.Spast, k2); sm.Fasc = lerp(sm.Fasc, m.Fasc, k2); sm.Bulb = lerp(sm.Bulb, m.Bulb, k2);
  sm.Breath = lerp(sm.Breath, m.Breath, k1); sm.Neur = lerp(sm.Neur, m.Neur, k2); sm.ril = lerp(sm.ril, m.ril, k1); sm.sup = lerp(sm.sup, m.sup, k1); sm.vent = lerp(sm.vent, m.vent, k1);
  /* neuron survival: cells shrink and fade as they are lost, sensory cell stays bright */
  const setCell = (c, loss) => { place(c.g, c.x, c.y, 0, 1 - 0.38 * loss); c.g.style.opacity = (1 - 0.5 * loss).toFixed(2); };
  setCell(umnC, sm.UMN); setCell(lmnC, sm.LMN); setCell(respC, sm.LMN); setCell(bulbC, sm.Bulb);
  place(sensC.g, sensC.x, sensC.y, 0, 1);
  if (tractEl) tractEl.setAttribute("stroke-width", (3 + 2.5 * sm.Spast).toFixed(2));
  /* muscle wasting and twitch, tongue wasting, diaphragm breathing */
  const twitch = sm.Fasc > 0.25 ? Math.sin(tm / 90) * 2 * sm.Fasc : 0;
  muscleG.setAttribute("transform", "translate(" + f1(752 + twitch) + " 214) scale(1 " + (1 - 0.32 * sm.Wast).toFixed(3) + ") translate(-752 -214)");
  tongueG.setAttribute("transform", "translate(232 252) scale(" + (1 - 0.25 * sm.Bulb).toFixed(3) + ") translate(-232 -252)");
  diaphG.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 700) * (1.5 + 4.5 * sm.Breath)) + ")");
  helpG.setAttribute("opacity", sm.sup.toFixed(2));
  ventG.setAttribute("opacity", sm.vent.toFixed(2));
  /* aggregates appear inside neurons as burden rises */
  const aggN = Math.round(sm.Agg * agg.length);
  agg.forEach((p, i) => { const on = i < aggN; p.e.setAttribute("opacity", on ? "1" : "0"); if (on) p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 500 + i) * 1.2) + " " + f1(p.y) + ") scale(" + (0.8 + 0.3 * Math.sin(tm / 400 + i)).toFixed(2) + ")"); });
  /* signals travel the motor pathways, fewer as neurons are lost */
  acc.sig += dt * (2 + 9 * sm.Neur); while (acc.sig >= 1) { acc.sig--; const p = freeP(sig); if (p) { const ti = Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2; emit(p, 0, 0, 0, 0, ti); } }
  sig.forEach((p) => { if (!p.on) return; p.u += dt * (0.14 + 0.2 * sm.Neur); const tr = sigTracks[p.k], pos = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")"); if (p.u >= 1) kill(p); });
  /* glutamate dots at the lower motor neuron, calmed by the riluzole concept */
  acc.glu += dt * (5 - 2.5 * sm.ril); while (acc.glu >= 1) { acc.glu--; const p = freeP(glu); if (p) emit(p, 415 + rnd(-24, 24), 182 + rnd(-20, 20), rnd(-7, 7), rnd(-7, 7), 0); }
  glu.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 392, 446); p.y = clamp(p.y, 158, 208); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* fasciculation sparks on the muscle surface */
  acc.spark += dt * sm.Fasc * 7; while (acc.spark >= 1) { acc.spark--; const p = freeP(sparks); if (p) emit(p, rnd(650, 855), rnd(190, 240), 0, 0, 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.7 + p.t).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.7).toFixed(2)); if (p.t > 0.7) kill(p); });
  /* riluzole capsules drift toward the lower motor neuron */
  acc.cap += dt * sm.ril * 2.2; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emit(p, rnd(360, 390), 120, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (415 - p.x) * dt * 0.6 + 8 * dt; p.y += (182 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2)); if (p.t > 4.7) kill(p); });
  /* ventilatory air flow toward the diaphragm */
  acc.air += dt * sm.vent * 9; while (acc.air >= 1) { acc.air--; const p = freeP(air); if (p) emit(p, 898, 356 + rnd(-8, 8), -85, 0, 0); }
  air.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 4 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 700) kill(p); });
  /* gauges */
  gg.neur.set(sm.Neur, wordOf(sm.Neur, 0.35, 0.7, ["few left", "reduced", "many left"])); gg.wast.set(sm.Wast, wordOf(sm.Wast, 0.3, 0.62, ["preserved", "wasting", "severe"]));
  gg.fasc.set(sm.Fasc, wordOf(sm.Fasc, 0.3, 0.6, ["none", "some", "frequent"])); gg.spast.set(sm.Spast, wordOf(sm.Spast, 0.3, 0.62, ["supple", "stiff", "very stiff"]));
  gg.bulb.set(sm.Bulb, wordOf(sm.Bulb, 0.3, 0.62, ["clear", "slurred", "severe"])); gg.breath.set(sm.Breath, wordOf(sm.Breath, 0.4, 0.68, ["failing", "strained", "supported"]));
}
run({ init, step });
