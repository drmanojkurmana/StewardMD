/* Tetanus and botulism scene: wound toxin, cord brake signal, junction go signal, muscle tone, breathing and gauges. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
const ids = ["skinSlot", "spores", "cut1", "cut2", "bandage", "woundGlow", "axonTet", "bloodBot", "driveGlow", "lungSlotL", "lungSlotR", "airway", "lungGlow", "muscleSlot", "spasmTint", "flopTint", "ventG", "ventTube"];
const EL = {};
ids.forEach((id) => { EL[id] = $(id); });
let skinO = null, lungL = null, lungR = null, muscO = null;
let trkTet = null, trkBot = null, trkVent = null;
const VENT_PTS = [[860, 380], [905, 340], [918, 280], [905, 230], [860, 205], [810, 193]];
const SPORE_OFF = [[-30, -12], [-5, -20], [20, -8], [-15, 12], [10, 18], [32, 10]];
const AB_OFF = [[110, -45], [160, -5], [210, -45], [130, 25], [190, 25], [240, -5], [90, -5], [260, -45]];
function initOrgans() {
  skinO = organ(EL.skinSlot, "skin", 120, 295, 160, {});
  lungL = organ(EL.lungSlotL, "lung", 700, 150, 85, {});
  lungR = organ(EL.lungSlotR, "lung", 775, 150, 85, { flip: true });
  muscO = organ(EL.muscleSlot, "muscle", 795, 315, 230, {});
  const D = skinO.ports.dermis || [115, 303];
  const d0 = f1(D[0]) + " " + f1(D[1]);
  EL.axonTet.setAttribute("d", "M" + d0 + " C260 240 310 200 380 172");
  EL.bloodBot.setAttribute("d", "M" + d0 + " C280 330 420 342 520 336 C580 332 620 326 650 319");
  trkTet = track([[D[0], D[1]], [250, 240], [320, 195], [380, 172]]);
  trkBot = track([[D[0], D[1]], [300, 335], [480, 340], [600, 330], [650, 319]]);
  trkVent = track(VENT_PTS);
  EL.ventTube.setAttribute("d", "M" + VENT_PTS.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"));
  const tL = lungL.ports.trachea, tR = lungR.ports.trachea, tx = (tL[0] + tR[0]) / 2;
  EL.airway.setAttribute("d", "M" + f1(tx) + " 66L" + f1(tx) + " 98L" + f1(tL[0]) + " " + f1(tL[1]) + "M" + f1(tx) + " 98L" + f1(tR[0]) + " " + f1(tR[1]));
  EL.cut1.setAttribute("d", "M" + f1(D[0] - 25) + " " + f1(D[1] - 30) + "L" + f1(D[0] - 10) + " " + f1(D[1]) + "L" + f1(D[0] - 22) + " " + f1(D[1] + 30));
  EL.cut2.setAttribute("d", "M" + f1(D[0] + 8) + " " + f1(D[1] - 28) + "L" + f1(D[0] + 22) + " " + f1(D[1] + 2) + "L" + f1(D[0] + 10) + " " + f1(D[1] + 30));
  const spores = EL.spores.querySelectorAll("ellipse");
  spores.forEach((e, i) => { const o = SPORE_OFF[i % SPORE_OFF.length]; e.setAttribute("cx", f1(D[0] + o[0])); e.setAttribute("cy", f1(D[1] + o[1])); });
  EL.bandage.setAttribute("x", f1(D[0] - 75)); EL.bandage.setAttribute("y", f1(D[1] - 28));
  bactHome = [D[0] - 30, D[1] + 18];
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, (_, i) => { const e = build(); e.setAttribute("opacity", "0"); return { e, u: (i + 0.5) / n, ph: i * 1.7 }; }); }
const toxP = pool(18, () => mk("circle", { class: "sc-p p-tox", r: 3 }, layers.parts));
const trapP = pool(10, () => mk("circle", { class: "sc-p p-toxhit", r: 3.6 }, layers.parts));
const inhP = pool(10, () => mk("circle", { class: "sc-p p-inh", r: 2.4 }, layers.parts));
const achP = pool(12, () => mk("circle", { class: "sc-p p-ach", r: 2.4 }, layers.parts));
const abP = pool(8, () => mk("path", { class: "p-ab", d: "M0 0L0 -7M0 -7L-4.5 -12M0 -7L4.5 -12" }, layers.parts));
const airP = pool(8, () => mk("circle", { class: "sc-p p-air", r: 2.6 }, layers.parts));
/* ---- gauges, cells, labels ---- */
const gg = {};
let bactG = null, motorG = null, capEl = null, capKey = "", bactHome = [85, 321];
const siteTet = [], siteBot = [];
function capText(d, tet) {
  if (d === 1) return "Antitoxin traps free toxin. More signal gets through and muscles ease.";
  if (d === 2) return "Wound care removes the germ source. Less new toxin is made.";
  if (d === 3) return "A ventilator breathes for the patient while the nerves recover.";
  if (tet) return "No treatment. Toxin stops the brake signal, so muscles lock rigid.";
  return "No treatment. Toxin blocks the muscle signal, so muscles go weak.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [160, 360, 560, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["tox", "Toxin", "g-tox", "Free toxin still able to reach nerves. Antitoxin traps it; wound care removes its source."], ["blk", "Target block", "g-blk", "How much toxin has blocked its target: the brake signal in the cord in tetanus, the go signal at the junction in botulism."], ["eff", "Muscle effect", "g-eff", "The result in muscle: rigidity and spasm in tetanus, weakness and floppiness in botulism."], ["br", "Breathing", "g-br", "Breathing when spasm or weakness reaches the chest muscles. A ventilator supports it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Wound", 150, 300, 110, 190, "A dirty wound lets germs grow and release toxin. Cleaning it removes the source.");
  pill(ox, "Toxin", 285, 215, 285, 150, "Free toxin travels to nerves. Antitoxin traps it while it is still free.");
  pill(ox, "Spinal cord", 470, 140, 470, 88, "Relay in the backbone. In tetanus, toxin acts here to switch off braking.");
  pill(ox, "Brake signal", 469, 160, 470, 245, "Brake signal that calms the motor nerve. Tetanus toxin stops it, so muscle locks.");
  pill(ox, "Junction", 655, 318, 610, 255, "Where nerve meets muscle. Botulinum toxin acts here and blocks the go signal.");
  pill(ox, "Muscle", 753, 313, 795, 225, "Jaw and body muscle. Rigid in tetanus, floppy and weak in botulism.");
  pill(ox, "Lungs", 685, 160, 640, 60, "Breathing can fail in both diseases. A ventilator can breathe for the patient.");
  capEl = mk("text", { class: "tn-cap", x: 30, y: 425 }, ox); capEl.textContent = capText(0, 1);
}
function initCells() {
  bactG = cell(layers.cells, { cls: "bact", r: 19, nuc: 0.35, seed: 3, wob: 0.12, x: bactHome[0], y: bactHome[1] });
  cell(layers.cells, { cls: "inhib", r: 16, nuc: 0.4, seed: 5, wob: 0.1, x: 430, y: 160 });
  motorG = cell(layers.cells, { cls: "motor", r: 18, nuc: 0.42, seed: 7, wob: 0.1, x: 510, y: 160 });
  cell(layers.cells, { cls: "bouton", r: 13, nuc: 0.3, seed: 9, wob: 0.1, x: 655, y: 318 });
  [[412, 148], [430, 140], [448, 148], [414, 170], [446, 170]].forEach(([x, y]) => siteTet.push(mk("circle", { class: "sc-p p-tox", r: 3, cx: x, cy: y, opacity: "0" }, layers.parts)));
  [[642, 308], [655, 302], [668, 308], [644, 326], [666, 326]].forEach(([x, y]) => siteBot.push(mk("circle", { class: "sc-p p-tox", r: 2.6, cx: x, cy: y, opacity: "0" }, layers.parts)));
}
const sm = { Free: 0.9, Block: 0.85, Effect: 0.85, Breath: 0.8, tet: 1, anti: 0, wound: 0, vent: 0 };
function init() { initOrgans(); initCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.Free = lerp(sm.Free, m.Free, k); sm.Block = lerp(sm.Block, m.Block, k); sm.Effect = lerp(sm.Effect, m.Effect, k); sm.Breath = lerp(sm.Breath, m.Breath, k);
  sm.tet = lerp(sm.tet, m.tet, k); sm.anti = lerp(sm.anti, m.anti, k); sm.wound = lerp(sm.wound, m.wound, k); sm.vent = lerp(sm.vent, m.vent, k);
  const tet = sm.tet > 0.5 ? 1 : 0;
  EL.bandage.setAttribute("opacity", (sm.wound * 0.95).toFixed(2));
  EL.ventG.setAttribute("opacity", sm.vent.toFixed(2));
  EL.spores.setAttribute("opacity", (1 - 0.85 * sm.wound).toFixed(2));
  EL.woundGlow.setAttribute("opacity", ((0.15 + 0.55 * sm.Free) * (1 - 0.65 * sm.wound)).toFixed(2));
  EL.driveGlow.setAttribute("opacity", (0.55 * sm.tet * sm.Effect).toFixed(2));
  EL.spasmTint.setAttribute("opacity", (0.8 * sm.tet * sm.Effect).toFixed(2));
  EL.flopTint.setAttribute("opacity", (0.65 * (1 - sm.tet) * sm.Effect).toFixed(2));
  EL.lungGlow.setAttribute("opacity", (0.5 * sm.Breath).toFixed(2));
  EL.axonTet.setAttribute("opacity", (0.25 + 0.75 * sm.tet).toFixed(2));
  EL.bloodBot.setAttribute("opacity", (0.25 + 0.75 * (1 - sm.tet)).toFixed(2));
  siteTet.forEach((e) => e.setAttribute("opacity", (sm.tet * sm.Block).toFixed(2)));
  siteBot.forEach((e) => e.setAttribute("opacity", ((1 - sm.tet) * sm.Block).toFixed(2)));
  /* free toxin flows along the active track and thins out with treatment */
  const trk = tet ? trkTet : trkBot;
  const toxOp = (0.1 + 0.9 * sm.Free) * (1 - 0.55 * sm.anti);
  toxP.forEach((p) => { p.u += dt * 0.12 * (0.3 + sm.Free); if (p.u > 1) p.u -= 1; const q = trk.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", toxOp.toFixed(2)); });
  /* antitoxin antibodies hold trapped toxin dots around the wound and nerve */
  const D = skinO.ports.dermis || [115, 303];
  abP.forEach((p, i) => { const o = AB_OFF[i % AB_OFF.length]; const x = D[0] + o[0] + Math.sin(tm / 800 + p.ph) * 5, y = D[1] + o[1] + Math.cos(tm / 950 + p.ph) * 5;
    p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(Math.sin(tm / 1100 + p.ph) * 12) + ")"); p.e.setAttribute("opacity", sm.anti.toFixed(2)); });
  trapP.forEach((p, i) => { const o = AB_OFF[(i + 3) % AB_OFF.length]; const a = tm / 700 + p.ph; const x = D[0] + o[0] + Math.cos(a) * 11, y = D[1] + o[1] + Math.sin(a) * 9;
    p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", (sm.anti * 0.95).toFixed(2)); });
  /* brake signal: interneuron to motor neuron, lost in tetanus */
  const inhRate = tet ? 1 - sm.Block : 0.95;
  inhP.forEach((p, i) => { p.u += dt * 0.55; if (p.u > 1) p.u -= 1; const x = lerp(434, 474, p.u); p.e.setAttribute("transform", "translate(" + f1(x) + " 160)"); p.e.setAttribute("opacity", i < inhRate * 10 ? "1" : "0"); });
  /* go signal: bouton into the muscle belly, blocked in botulism */
  const achRate = tet ? clamp(0.35 + sm.Effect) : 1 - sm.Block;
  achP.forEach((p, i) => { p.u += dt * 0.7; if (p.u > 1) p.u -= 1; const x = lerp(668, 752, p.u), y = 315 + Math.sin(p.u * 6 + i) * 7; p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", i < achRate * 12 ? "1" : "0"); });
  /* ventilator air along the tube into the lung */
  airP.forEach((p) => { p.u += dt * 0.5; if (p.u > 1) p.u -= 1; const q = trkVent.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", sm.vent.toFixed(2)); });
  /* muscle: shake when rigid, sag when floppy */
  const shake = sm.tet * sm.Effect, sag = (1 - sm.tet) * sm.Effect;
  const mx = Math.sin(tm / 55) * 2.6 * shake, my = sag * 7 - shake * Math.abs(Math.sin(tm / 55)) * 1.5;
  EL.muscleSlot.setAttribute("transform", "translate(" + f1(mx) + " " + f1(my) + ")");
  /* lungs: shallow fast when failing, deep slow on the ventilator */
  const amp = sm.vent > 0.5 ? 0.055 : 0.02, fr = sm.vent > 0.5 ? 700 : 420;
  const sL = 1 + amp * Math.sin(tm / fr), sR = 1 + amp * Math.sin(tm / fr + 0.5);
  EL.lungSlotL.setAttribute("transform", "translate(700 150) scale(" + sL.toFixed(3) + ") translate(-700 -150)");
  EL.lungSlotR.setAttribute("transform", "translate(775 150) scale(" + sR.toFixed(3) + ") translate(-775 -150)");
  place(bactG, bactHome[0], bactHome[1], Math.sin(tm / 700) * 6, 1 - 0.45 * sm.wound);
  bactG.style.opacity = (1 - 0.4 * sm.wound).toFixed(2);
  place(motorG, 510, 160, 0, 1 + 0.1 * sm.tet * sm.Effect * Math.sin(tm / 160));
  /* gauges */
  gg.tox.set(sm.Free, wordOf(sm.Free, 0.3, 0.65, ["low", "present", "high"]));
  gg.blk.set(sm.Block, wordOf(sm.Block, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.eff.set(sm.Effect, tet ? wordOf(sm.Effect, 0.3, 0.65, ["relaxed", "stiff", "rigid"]) : wordOf(sm.Effect, 0.3, 0.65, ["normal", "weak", "floppy"]));
  gg.br.set(1 - sm.Breath, wordOf(sm.Breath, 0.35, 0.65, ["comfortable", "strained", "failing"]));
  const key = drug + ":" + m.tet;
  if (key !== capKey) { capKey = key; const t = capText(drug, m.tet); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
