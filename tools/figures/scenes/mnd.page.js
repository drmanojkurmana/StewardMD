/* Motor neuron disease scene: brain to cord to muscle, tongue, diaphragm and lungs; treatments act visibly. */
const layers = { tracts: $("tracts"), organs: $("organs"), cellsL: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- organs, tracts and treatment props ---- */
let brainO = null, lungO = null, eyeO = null, capEl = null, capDrug = -1;
let trArm = null, trBulb = null, trResp = null, trAir = null;
let tractEl = null, muscleG = null, diaphG = null, tongueG = null;
let glowEl = null, shieldEl = null, bglowEl = null, maskG = null, flowA = null, flowB = null;
let haloM = null, haloT = null, haloD = null;
const badges = [];
const LMNP = [377, 210];
function initOrgans() {
  const O = layers.organs, T = layers.tracts, V = layers.over;
  brainO = organ($("brainSlot"), "brain", 150, 170, 190, {});
  lungO = organ($("lungSlot"), "lung", 790, 250, 170, {});
  eyeO = organ($("eyeSlot"), "eye", 620, 345, 90, {});
  const BP = brainO.ports, LP = lungO.ports, stem = BP.stem;
  glowEl = mk("ellipse", { class: "mn-glow", cx: 377, cy: 210, rx: 95, ry: 80, opacity: "0" }, O);
  mk("rect", { class: "mn-cord", x: 350, y: 90, width: 55, height: 290, rx: 27 }, O);
  tractEl = mk("path", { class: "mn-tract", d: "M" + f1(stem[0]) + " " + f1(stem[1]) + " C250 230 300 180 340 130 C355 112 366 106 377 105" }, T);
  mk("path", { class: "mn-axon", d: "M388 108 C425 100 448 104 466 111" }, T);
  mk("path", { class: "mn-axon", d: "M405 210 C435 214 452 222 470 229" }, T);
  mk("path", { class: "mn-axon", d: "M405 330 C500 335 600 345 690 358" }, T);
  mk("path", { class: "mn-sens", d: "M398 290 L398 372" }, T);
  tongueG = mk("g", {}, O);
  mk("ellipse", { class: "mn-tongue", cx: 500, cy: 115, rx: 45, ry: 18 }, tongueG);
  muscleG = mk("g", {}, O);
  mk("rect", { class: "mn-muscle", x: 470, y: 200, width: 200, height: 64, rx: 14 }, muscleG);
  [214, 232, 250].forEach((y) => mk("path", { class: "mn-fibre", d: "M482 " + y + " C540 " + (y - 6) + " 600 " + (y + 6) + " 658 " + y }, muscleG));
  diaphG = mk("g", {}, O);
  mk("path", { class: "mn-diaph", d: "M690 368 Q790 322 890 368 L890 388 Q790 352 690 388 Z" }, diaphG);
  bglowEl = mk("ellipse", { class: "mn-bglow", cx: 790, cy: 250, rx: 60, ry: 85, opacity: "0" }, O);
  const M = mk("g", {}, O);
  mk("path", { class: "mn-dna", d: "M600 78 C630 92 600 108 630 124" }, M);
  mk("path", { class: "mn-dna2", d: "M630 78 C600 92 630 108 600 124" }, M);
  [86, 101, 116].forEach((y) => mk("path", { class: "mn-rung", d: "M606 " + y + " L624 " + y }, M));
  haloM = mk("rect", { class: "mn-halo", x: 460, y: 190, width: 220, height: 84, rx: 18, opacity: "0" }, V);
  haloT = mk("ellipse", { class: "mn-halo", cx: 500, cy: 115, rx: 55, ry: 28, opacity: "0" }, V);
  haloD = mk("rect", { class: "mn-halo", x: 682, y: 332, width: 216, height: 64, rx: 20, opacity: "0" }, V);
  [[682, 196], [548, 142], [898, 330]].forEach(([x, y], i) => {
    const g = mk("g", { opacity: "0" }, V);
    mk("circle", { class: "mn-help", cx: x, cy: y, r: 8 }, g);
    mk("path", { class: "mn-check", d: "M" + (x - 4) + " " + y + "h8M" + x + " " + (y - 4) + "v8" }, g);
    badges.push({ g, x, y, i });
  });
  maskG = mk("g", { opacity: "0" }, V);
  mk("path", { class: "mn-mask", d: "M850 112 q26 14 0 32 M850 118 L830 110 M850 138 L830 146" }, maskG);
  flowA = mk("path", { class: "mn-flow", d: "M848 122 C828 124 806 130 " + f1(LP.trachea[0]) + " " + f1(LP.trachea[1]), opacity: "0" }, V);
  flowB = mk("path", { class: "mn-flow", d: "M852 134 C832 136 810 140 " + f1(LP.trachea[0] + 4) + " " + f1(LP.trachea[1] + 6), opacity: "0" }, V);
  trArm = track([stem, [260, 225], [330, 170], [365, 120], [377, 160], [377, 210], [440, 222], [480, 232], [570, 238]]);
  trBulb = track([[388, 108], [425, 102], [452, 108], [472, 112]]);
  trResp = track([[377, 225], [377, 330], [500, 345], [640, 352], [740, 356]]);
  trAir = track([[862, 128], [824, 130], LP.trachea, [787, 190], [785, 250]]);
}
function capText(d) {
  if (d === 1) return "Riluzole concept calms nerve overdrive. Blockers sit on the cells and fewer attack signals get through.";
  if (d === 2) return "Support team helps speech, eating and movement. Daily tasks get easier.";
  if (d === 3) return "Ventilatory support pushes air into the lungs. Breathing recovers even late.";
  return "No treatment. Nerve cells die, muscles waste and breathing fails.";
}
/* tracks are built in initOrgans from the brain and lung ports (see above) */
/* ---- neuron cells ---- */
const umnC = { g: null, x: 135, y: 150 };
const bulbC = { g: null, x: 377, y: 112 };
const lmnC = { g: null, x: 377, y: 210 };
const respC = { g: null, x: 377, y: 330 };
const sensC = { g: null, x: 390, y: 272 };
const demoC = { g: null, x: 700, y: 95 };
function initCells() {
  umnC.g = cell(layers.cellsL, { cls: "umn", r: 19, nuc: 0.4, seed: 3, wob: 0.12 }); place(umnC.g, umnC.x, umnC.y, 0, 1);
  bulbC.g = cell(layers.cellsL, { cls: "bulb", r: 11, nuc: 0.4, seed: 5, wob: 0.12 }); place(bulbC.g, bulbC.x, bulbC.y, 0, 1);
  lmnC.g = cell(layers.cellsL, { cls: "lmn", r: 15, nuc: 0.4, seed: 7, wob: 0.12 }); place(lmnC.g, lmnC.x, lmnC.y, 0, 1);
  shieldEl = mk("circle", { class: "mn-shield", cx: 377, cy: 210, r: 27, opacity: "0" }, layers.cellsL);
  respC.g = cell(layers.cellsL, { cls: "lmn", r: 15, nuc: 0.4, seed: 9, wob: 0.12 }); place(respC.g, respC.x, respC.y, 0, 1);
  sensC.g = cell(layers.cellsL, { cls: "sens", r: 10, nuc: 0.4, seed: 11, wob: 0.1 }); place(sensC.g, sensC.x, sensC.y, 0, 1);
  demoC.g = cell(layers.cellsL, { cls: "lmn", r: 14, nuc: 0.4, seed: 13, wob: 0.12 }); place(demoC.g, demoC.x, demoC.y, 0, 1);
  const ap = brainO.ports.parenchyma;
  aggSpots = [[ap[0], ap[1]], [377, 210], [377, 112], [377, 330], [700, 95]];
  agg.forEach((p, i) => { const c = aggSpots[i % aggSpots.length]; p.x = c[0] + rnd(-13, 13); p.y = c[1] + rnd(-10, 10); });
}
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, st: 0, a: 0 }; }); }
const sig = pool(26, () => mk("circle", { class: "sc-p p-sig", r: 3 }, layers.parts));
let aggSpots = [[135, 158], [377, 210], [377, 112], [377, 330], [700, 95]];
const agg = pool(28, () => mk("rect", { class: "sc-p p-agg", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
const glu = pool(14, () => mk("circle", { class: "sc-p p-glu", r: 2.4 }, layers.parts));
const odrv = pool(8, () => mk("path", { class: "mn-spark", d: "M-5 0L0 -5L5 0" }, layers.parts));
const sparks = pool(10, () => mk("path", { class: "mn-spark", d: "M-5 0L0 -5L5 0" }, layers.parts));
const air = pool(16, () => mk("circle", { class: "sc-p p-air", r: 3.2 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "mn-capb", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "mn-capb2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [80, 200, 320, 440, 560, 680, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["neur", "Motor neurons", "g-neur", "Motor neurons still alive and able to fire. Upper and lower motor neurons are lost together in the common form."], ["wast", "Wasting", "g-wast", "Muscle wasting (atrophy) when lower motor neurons die and muscle loses its nerve supply."], ["fasc", "Fasciculations", "g-fasc", "Visible twitching of small muscle bundles as sick lower motor neurons fire on their own. They fade when those neurons die."], ["spast", "Spasticity", "g-spast", "Stiffness and brisk reflexes when upper motor neuron control is lost."], ["bulb", "Bulbar signs", "g-bulb", "Weak speech and swallowing when brainstem (bulbar) motor neurons are involved."], ["breath", "Breathing", "g-good", "Breathing as the diaphragm weakens. Ventilatory support assists the breathing muscles."], ["daily", "Daily life", "g-daily", "Coping with speech, eating and movement. Support and easier breathing lift it without changing neuron loss."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Brain", 110, 110, 110, 64, "Brain: the motor cortex. Upper nerve cells here send orders down the cord.");
  pill(ox, "Nerve path", 265, 196, 300, 64, "Nerve path: the bundle carrying orders from the brain to the spinal cells.");
  pill(ox, "Spinal cells", 377, 330, 300, 400, "Spinal cells: lower nerve cells in the cord. When they die, muscles waste and twitch.");
  pill(ox, "Protein clumps", 700, 95, 745, 152, "Protein clumps: TDP-43 protein piling up inside sick cells. Some forms run in families.");
  pill(ox, "Weak muscle", 570, 232, 570, 290, "Weak muscle: wasting with twitches as its nerve supply dies.");
  pill(ox, "Speech", 500, 115, 470, 64, "Speech: tongue and swallowing muscles weaken when bulbar cells fail.");
  pill(ox, "Breathing", 790, 360, 790, 398, "Breathing: the diaphragm and lungs fail late, so breathing needs support.");
  pill(ox, "Spared senses", 620, 345, 480, 352, "Spared senses: sight and feeling stay, which helps tell this disease apart.");
  capEl = mk("text", { class: "mn-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { D: 0.4, Drive: 0.5, Agg: 0.4, UMN: 0.4, LMN: 0.4, Wast: 0.3, Spast: 0.3, Fasc: 0.3, Bulb: 0.3, Breath: 0.7, Func: 0.6, Neur: 0.6, ril: 0, sup: 0, vent: 0 };
const acc = { sig: 0, glu: 0, air: 0, cap: 0, spark: 0, odrv: 0 };
function init() { initOrgans(); initCells(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.D = lerp(sm.D, m.D, k2); sm.Drive = lerp(sm.Drive, m.Drive, k2); sm.Agg = lerp(sm.Agg, m.Agg, k2); sm.UMN = lerp(sm.UMN, m.UMN, k2); sm.LMN = lerp(sm.LMN, m.LMN, k2);
  sm.Wast = lerp(sm.Wast, m.Wast, k2); sm.Spast = lerp(sm.Spast, m.Spast, k2); sm.Fasc = lerp(sm.Fasc, m.Fasc, k2); sm.Bulb = lerp(sm.Bulb, m.Bulb, k2);
  sm.Breath = lerp(sm.Breath, m.Breath, k1); sm.Func = lerp(sm.Func, m.Func, k2); sm.Neur = lerp(sm.Neur, m.Neur, k2); sm.ril = lerp(sm.ril, m.ril, k1); sm.sup = lerp(sm.sup, m.sup, k1); sm.vent = lerp(sm.vent, m.vent, k1);
  /* neuron survival: cells shrink and fade as they are lost, sensory cell stays bright */
  const setCell = (c, loss) => { place(c.g, c.x, c.y, 0, 1 - 0.38 * loss); c.g.style.opacity = (1 - 0.5 * loss).toFixed(2); };
  setCell(umnC, sm.UMN); setCell(lmnC, sm.LMN); setCell(respC, sm.LMN); setCell(bulbC, sm.Bulb);
  place(sensC.g, sensC.x, sensC.y, 0, 1);
  place(demoC.g, demoC.x, demoC.y, 0, 1 - 0.2 * sm.Agg); demoC.g.style.opacity = (1 - 0.45 * sm.Agg).toFixed(2);
  if (tractEl) tractEl.setAttribute("stroke-width", (3 + 2.5 * sm.Spast).toFixed(2));
  /* excitotoxic glow around the cord fades as the riluzole concept calms drive; shield ring sits on the lower cell */
  glowEl.setAttribute("opacity", ((1 - sm.ril) * sm.Drive * 0.4).toFixed(2));
  shieldEl.setAttribute("opacity", sm.ril.toFixed(2));
  /* muscle wasting and twitch, tongue wasting, diaphragm breathing, lung inflation */
  const twitch = sm.Fasc > 0.25 ? Math.sin(tm / 90) * 2 * sm.Fasc : 0;
  muscleG.setAttribute("transform", "translate(" + f1(570 + twitch) + " 232) scale(1 " + (1 - 0.32 * sm.Wast).toFixed(3) + ") translate(-570 -232)");
  tongueG.setAttribute("transform", "translate(500 115) scale(" + (1 - 0.25 * sm.Bulb).toFixed(3) + ") translate(-500 -115)");
  diaphG.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 700) * (1.5 + 4.5 * sm.Breath)) + ")");
  lungO.g.setAttribute("transform", "translate(790 250) scale(" + (1 + 0.07 * sm.vent + 0.02 * Math.sin(tm / 700) * (0.4 + 0.6 * sm.Breath)).toFixed(3) + ")");
  bglowEl.setAttribute("opacity", (0.06 + 0.3 * sm.vent).toFixed(2));
  maskG.setAttribute("opacity", sm.vent.toFixed(2));
  flowA.setAttribute("opacity", (sm.vent * 0.8).toFixed(2));
  flowB.setAttribute("opacity", (sm.vent * 0.6).toFixed(2));
  haloM.setAttribute("opacity", (sm.sup * 0.55).toFixed(2));
  haloT.setAttribute("opacity", (sm.sup * 0.55).toFixed(2));
  haloD.setAttribute("opacity", (sm.sup * 0.55).toFixed(2));
  badges.forEach((b) => { b.g.setAttribute("opacity", sm.sup.toFixed(2)); b.g.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 800 + b.i * 2) * 3) + ")"); });
  /* aggregates appear inside neurons as burden rises */
  const aggN = Math.round(sm.Agg * agg.length);
  agg.forEach((p, i) => { const on = i < aggN; p.e.setAttribute("opacity", on ? "1" : "0"); if (on) p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 500 + i) * 1.2) + " " + f1(p.y) + ") scale(" + (0.8 + 0.3 * Math.sin(tm / 400 + i)).toFixed(2) + ")"); });
  /* signals travel the motor pathways, fewer as neurons are lost */
  acc.sig += dt * (2 + 9 * sm.Neur); while (acc.sig >= 1) { acc.sig--; const p = freeP(sig); if (p) { const ti = Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2; emit(p, 0, 0, 0, 0, ti); } }
  sig.forEach((p) => { if (!p.on) return; p.u += dt * (0.14 + 0.2 * sm.Neur); const tr = p.k === 0 ? trArm : p.k === 1 ? trBulb : trResp, pos = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")"); if (p.u >= 1) kill(p); });
  /* glutamate dots swarm the lower motor neuron, calmed by the riluzole concept */
  acc.glu += dt * (6 - 4.8 * sm.ril); while (acc.glu >= 1) { acc.glu--; const p = freeP(glu); if (p) emit(p, 377 + rnd(-24, 24), 210 + rnd(-20, 20), rnd(-7, 7), rnd(-7, 7), 0); }
  glu.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 354, 400); p.y = clamp(p.y, 188, 232); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", ((1 - p.t / 2.2) * (1 - 0.4 * sm.ril)).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* overdrive flashes crackle along the cord, fading as blockers sit on the cells */
  acc.odrv += dt * sm.Drive * (1 - sm.ril) * 9; while (acc.odrv >= 1) { acc.odrv--; const p = freeP(odrv); if (p) emit(p, rnd(335, 420), rnd(95, 350), 0, 0, 0); }
  odrv.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.7 + p.t * 2).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.55).toFixed(2)); if (p.t > 0.55) kill(p); });
  /* fasciculation sparks on the muscle surface */
  acc.spark += dt * sm.Fasc * 7; while (acc.spark >= 1) { acc.spark--; const p = freeP(sparks); if (p) emit(p, rnd(480, 660), rnd(206, 258), 0, 0, 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.7 + p.t).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.7).toFixed(2)); if (p.t > 0.7) kill(p); });
  /* riluzole blockers drift to the lower motor neuron and sit on it */
  acc.cap += dt * sm.ril * 2.4; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emit(p, 360 + rnd(-14, 14), 120 + rnd(-8, 8), 0, 0, 0); }
  caps.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.st === 0) {
      p.x += (LMNP[0] - p.x) * dt * 1.4 + 8 * dt; p.y += (LMNP[1] - p.y) * dt * 1.4;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")");
      if (Math.hypot(LMNP[0] - p.x, LMNP[1] - p.y) < 20) { p.st = 1; p.a = Math.atan2(p.y - LMNP[1], p.x - LMNP[0]); }
    } else {
      p.a += dt * 0.9; p.x = LMNP[0] + Math.cos(p.a) * 24; p.y = LMNP[1] + Math.sin(p.a) * 24;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.a * 57.3) + ")");
      p.e.setAttribute("opacity", clamp(sm.ril * 2).toFixed(2));
      if (sm.ril < 0.04) kill(p);
    }
    if (p.st === 0) p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2));
    if (p.t > 4.7 && p.st === 0) kill(p);
  });
  /* ventilatory air flow into the lung */
  acc.air += dt * sm.vent * 9; while (acc.air >= 1) { acc.air--; const p = freeP(air); if (p) emit(p, 0, 0, 0, 0, 0); }
  air.forEach((p) => {
    if (!p.on) return;
    if (p.st === 0) { p.u += dt * 0.5; const q = trAir.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { p.st = 1; p.t = 0; p.vx = rnd(-10, 10); p.vy = rnd(6, 18); } }
    else { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 735, 845); p.y = clamp(p.y, 155, 330); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) kill(p); }
  });
  /* gauges */
  gg.neur.set(sm.Neur, wordOf(sm.Neur, 0.35, 0.7, ["few left", "reduced", "many left"])); gg.wast.set(sm.Wast, wordOf(sm.Wast, 0.3, 0.62, ["preserved", "wasting", "severe"]));
  gg.fasc.set(sm.Fasc, wordOf(sm.Fasc, 0.3, 0.6, ["none", "some", "frequent"])); gg.spast.set(sm.Spast, wordOf(sm.Spast, 0.3, 0.62, ["supple", "stiff", "very stiff"]));
  gg.bulb.set(sm.Bulb, wordOf(sm.Bulb, 0.3, 0.62, ["clear", "slurred", "severe"])); gg.breath.set(sm.Breath, wordOf(sm.Breath, 0.4, 0.68, ["failing", "strained", "supported"]));
  gg.daily.set(sm.Func, wordOf(sm.Func, 0.35, 0.7, ["a struggle", "limited", "steady"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
