/* Alzheimer scene: plaques, tau tangles, synapse loss, cholinergic signal boost, NMDA blockade, brain atrophy and gauges. */
const layers = { axons: $("axons"), glow: $("glow"), plaquesG: $("plaquesG"), neurons: $("neurons"), syns: $("syns"), brainSlot: $("brainSlot"), markers: $("markers"), parts: $("parts"), over: $("over"), panel: $("panel") };
let brainO = null, hippoM = null, ventM = null, achGlow = null, gluGlow = null, synHalo = null, gluRing = null, axonChol = null;
let neurons = [], cholNeuron = null, plaques = [], synEls = [], acheRects = [], acheBlocks = null, acheX = null, nmdaRec = null, nmdaCap = null, nmdaX = null;
let capEl = null, capDrug = -1, cholTrack = null, brainDot = [752, 193], hippoDot = [745, 256];
function capText(d) {
  if (d === 1) return "Inhibitor blocks the enzyme. More signal gets through. Memory holds up better.";
  if (d === 2) return "Blocker sits on the receptor. Excess glutamate matters less. Memory holds up better.";
  return "No treatment. Plaques grow, tangles spread and signals fade.";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, st: 0 }; }); }
const achP = pool(30, function () { return mk("circle", { class: "sc-p p-ach", r: 2.6 }, layers.parts); });
const gluP = pool(20, function () { return mk("path", { class: "sc-p p-glu", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts); });
function freeP(pl) { return pl.find(function (p) { return !p.on; }); }
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- network cells, synapses and drug targets ---- */
function makeNeuron(x, y, r, cls, seed) {
  const g = mk("g", {}, layers.neurons);
  const dend = [[-34, -18], [-26, 22], [-6, -36], [30, -24], [34, 14], [10, 34], [-30, -2]];
  dend.forEach(function (d) { mk("path", { class: "dend", d: "M0 0C" + f1(d[0] * 0.5) + " " + f1(d[1] * 0.3) + " " + f1(d[0] * 0.8) + " " + f1(d[1] * 0.8) + " " + d[0] + " " + d[1] }, g); });
  cell(g, { cls: cls, r: r, nuc: 0.4, seed: seed, wob: 0.1 });
  const tau = mk("g", { class: "tau-g" }, g);
  mk("path", { class: "tau-p", d: "M-8 5C-5 -6 3 -7 8 1C4 8 -3 8 -6 2" }, tau);
  mk("path", { class: "tau-p", d: "M-7 -3C-2 4 4 4 7 -2" }, tau);
  place(g, x, y, 0, 1);
  return { g: g, tau: tau, x: x, y: y };
}
function initCells() {
  mk("path", { class: "axon", d: "M186 198C250 172 318 176 362 180" }, layers.axons);
  mk("path", { class: "axon", d: "M382 206C366 258 326 292 302 314" }, layers.axons);
  axonChol = mk("path", { class: "axon axon-chol", d: "M128 352C180 300 250 255 320 220C338 211 350 202 360 192" }, layers.axons);
  neurons = [makeNeuron(165, 205, 22, "neuron", 1), makeNeuron(390, 185, 22, "neuron", 4), makeNeuron(280, 335, 20, "neuron", 7)];
  cholNeuron = makeNeuron(110, 362, 17, "chol", 10);
  achGlow = mk("ellipse", { class: "ach-glow", cx: 290, cy: 255, rx: 130, ry: 110, opacity: "0.05" }, layers.glow);
  gluGlow = mk("ellipse", { class: "glu-glow", cx: 365, cy: 182, rx: 60, ry: 50, opacity: "0.2" }, layers.glow);
  synHalo = mk("circle", { class: "syn-halo", cx: 365, cy: 182, r: 20, opacity: "0.12" }, layers.glow);
  const pts = [[275, 160, 15], [465, 255, 17], [235, 325, 13], [320, 242, 12], [150, 285, 11], [440, 130, 11]];
  plaques = pts.map(function (p, i) {
    const g = mk("g", {}, layers.plaquesG);
    mk("path", { class: "plaque-b", d: blobD(p[2], i * 2 + 1, 0.34, 8) }, g);
    mk("circle", { class: "plaque-d", cx: -3, cy: -2, r: 2.2 }, g);
    mk("circle", { class: "plaque-d", cx: 4, cy: 3, r: 1.8 }, g);
    place(g, p[0], p[1], i * 24, 0.2);
    return { g: g, x: p[0], y: p[1] };
  });
  synEls = [[365, 182], [300, 317]].map(function (p) { return mk("circle", { class: "syn-b", cx: p[0], cy: p[1], r: 7 }, layers.syns); });
  gluRing = mk("circle", { class: "glu-ring", cx: 365, cy: 182, r: 14, opacity: "0.5" }, layers.syns);
  acheRects = [[352, 168], [378, 172], [365, 196]].map(function (p) { return mk("rect", { class: "ache-b", x: p[0] - 3, y: p[1] - 3, width: 6, height: 6, rx: 1.5 }, layers.syns); });
  acheBlocks = mk("g", { opacity: "0" }, layers.syns);
  [[352, 168], [378, 172], [365, 196]].forEach(function (p) { mk("circle", { class: "ache-block", cx: p[0], cy: p[1], r: 4.5 }, acheBlocks); });
  acheX = mk("g", { opacity: "0" }, layers.syns);
  [[352, 168], [378, 172], [365, 196]].forEach(function (p) { mk("path", { class: "mk-x", d: "M" + (p[0] - 5) + " " + (p[1] - 5) + "l10 10M" + (p[0] + 5) + " " + (p[1] - 5) + "l-10 10" }, acheX); });
  nmdaRec = mk("rect", { class: "nmda-rec", x: 375, y: 186.5, width: 12, height: 7, rx: 2 }, layers.syns);
  nmdaCap = mk("rect", { class: "nmda-cap", x: 375, y: 186.5, width: 12, height: 7, rx: 2, opacity: "0" }, layers.syns);
  nmdaX = mk("g", { opacity: "0" }, layers.syns);
  mk("path", { class: "mk-x", d: "M376 187l10 6M386 187l-10 6" }, nmdaX);
  cholTrack = track([[128, 352], [180, 300], [250, 255], [320, 220], [358, 196]]);
}
/* ---- brain organ with atrophy markers anchored to it ---- */
function initBrain() {
  brainO = organ(layers.brainSlot, "brain", 770, 208, 230, {});
  const BP = brainO.ports;
  brainDot = [BP.parenchyma[0], BP.parenchyma[1]];
  hippoDot = [brainO.x - 25, brainO.y + 48];
  hippoM = mk("ellipse", { class: "brain-hp", cx: f1(hippoDot[0]), cy: f1(hippoDot[1]), rx: 26, ry: 13 }, layers.markers);
  ventM = mk("ellipse", { class: "brain-vt", cx: f1(brainO.x + 28), cy: f1(brainO.y + 2), rx: 8, ry: 20 }, layers.markers);
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What changes";
  [["amy", "Amyloid", "g-amy", "Amyloid plaques: clumps of amyloid beta peptide between neurons."], ["tau", "Tau", "g-tau", "Tau tangles: twisted tau protein inside neurons, linked to cell failure."], ["syn", "Synapses", "g-syn", "Working synapses: the connections where neurons pass signals. These are lost as disease advances."], ["ach", "ACh signal", "g-ach", "Acetylcholine signal at synapses, supplied by cholinergic neurons. A cholinesterase inhibitor slows its breakdown."], ["glu", "Glutamate", "g-glu", "Excess glutamate spill around synapses. An NMDA blocker damps signalling through NMDA receptors."], ["mem", "Memory", "g-mem", "A stand in for memory and thinking, which worsen as synapses and neurons are lost."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Neuron", 165, 205, 95, 135, "A brain cell. Branches receive signals. Cells shrink and die as tangles build.");
  pill(ox, "Plaque", 275, 160, 270, 120, "Sticky clumps between cells. They collect around synapses and disturb signalling.");
  pill(ox, "Tangle", 390, 185, 500, 140, "Twisted strands inside the cell. They block transport and the cell fails.");
  pill(ox, "Synapse", 300, 317, 380, 290, "The gap where one cell signals to the next. Fewer working synapses means weaker memory.");
  pill(ox, "ACh signal", 250, 255, 250, 300, "A chemical signal for attention and memory. An enzyme breaks it down. The inhibitor blocks that enzyme so more signal gets through.");
  pill(ox, "Glutamate", 365, 182, 515, 228, "The main excitatory signal. Too much overexcites cells. The NMDA blocker sits on the receptor and damps it.");
  pill(ox, "Brain", brainDot[0], brainDot[1], 775, 90, "The whole brain. Tissue is lost as cells die, and fluid spaces widen.");
  pill(ox, "Hippocampus", hippoDot[0], hippoDot[1], 740, 365, "Forms new memories. Shrinks early, so recent events fade first.");
  capEl = mk("text", { class: "alz-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { A: 0.4, T: 0.4, Syn: 0.6, Ach: 0.4, Glu: 0.4, Mem: 0.5, Hatr: 0.4, Catr: 0.2, Nloss: 0.3, chei: 0, nmda: 0 };
const acc = { ach: 0, glu: 0 };
function init() { initCells(); initBrain(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), kf = Math.min(1, dt * 2.2);
  sm.A = lerp(sm.A, m.A, k); sm.T = lerp(sm.T, m.T, k); sm.Syn = lerp(sm.Syn, m.Syn, k); sm.Ach = lerp(sm.Ach, m.Ach, k); sm.Glu = lerp(sm.Glu, m.Glu, k); sm.Mem = lerp(sm.Mem, m.Mem, k); sm.Hatr = lerp(sm.Hatr, m.Hatr, k); sm.Catr = lerp(sm.Catr, m.Catr, k); sm.Nloss = lerp(sm.Nloss, m.Nloss, k); sm.chei = lerp(sm.chei, m.chei, kf); sm.nmda = lerp(sm.nmda, m.nmda, kf);
  plaques.forEach(function (p, i) { const s = 0.15 + 0.95 * sm.A * (1 - i * 0.06); place(p.g, p.x, p.y, i * 24 + tm / 9000, Math.max(0.05, s)); p.g.style.opacity = sm.A > 0.06 ? 1 : 0; });
  neurons.forEach(function (n, i) { const fade = 1 - sm.Nloss * (0.25 + i * 0.22); n.g.style.opacity = clamp(fade + 0.18).toFixed(2); const s = 1 - 0.16 * sm.Nloss * (0.5 + i * 0.3); place(n.g, n.x + Math.sin(tm / 1600 + i * 2) * 1.5, n.y, Math.sin(tm / 2400 + i) * 4, s); n.tau.style.opacity = clamp(sm.T * 1.2 - i * 0.08).toFixed(2); });
  cholNeuron.g.style.opacity = clamp(1 - sm.Nloss * 0.85).toFixed(2); place(cholNeuron.g, cholNeuron.x, cholNeuron.y, 0, 1 - 0.2 * sm.Nloss); cholNeuron.tau.style.opacity = clamp(sm.T).toFixed(2);
  synEls.forEach(function (c, i) { const r = 3 + 5 * sm.Syn + (i === 0 ? 2.5 * sm.chei : 0); c.setAttribute("r", f1(r * (1 + 0.12 * Math.sin(tm / 300 + i * 2)))); c.style.opacity = clamp(0.25 + 0.75 * sm.Syn).toFixed(2); });
  acheRects.forEach(function (r) { r.setAttribute("opacity", (0.85 - 0.5 * sm.chei).toFixed(2)); });
  acheBlocks.setAttribute("opacity", sm.chei.toFixed(2)); acheX.setAttribute("opacity", sm.chei.toFixed(2));
  nmdaCap.setAttribute("opacity", sm.nmda.toFixed(2)); nmdaX.setAttribute("opacity", sm.nmda.toFixed(2));
  axonChol.setAttribute("stroke-width", f1(1.8 + 2.2 * sm.chei));
  axonChol.setAttribute("opacity", (0.65 + 0.35 * sm.chei).toFixed(2));
  achGlow.setAttribute("opacity", (0.03 + 0.1 * sm.Ach + 0.25 * sm.chei).toFixed(2));
  gluGlow.setAttribute("opacity", (0.3 * sm.Glu).toFixed(2));
  synHalo.setAttribute("r", f1(18 + 22 * sm.Ach));
  synHalo.setAttribute("opacity", (0.1 + 0.25 * sm.Ach).toFixed(2));
  gluRing.setAttribute("opacity", (0.12 + 0.6 * sm.Glu * (1 - 0.5 * sm.nmda)).toFixed(2));
  gluRing.setAttribute("r", f1(13 + 2 * Math.sin(tm / 400) + 3 * sm.Glu));
  acc.ach += dt * (1 + 9 * sm.Ach); while (acc.ach >= 1) { acc.ach--; const p = freeP(achP); if (p) { emit(p, 128, 352, 0, 0); } }
  achP.forEach(function (p) {
    if (!p.on) return;
    if (p.st === 0) { p.t += dt; p.u += dt * (0.16 + 0.1 * sm.Ach); const pt = cholTrack.at(Math.min(1, p.u)); p.x = pt.x; p.y = pt.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (p.u >= 1) { if (sm.chei > 0.5) { p.st = 1; p.t = 0; p.x = 365 + rnd(-10, 10); p.y = 182 + rnd(-10, 10); p.vx = rnd(-7, 7); p.vy = rnd(-6, 6); } else kill(p); }
      else if (p.t > 8) kill(p); }
    else { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.t - 2.5) / 1.5).toFixed(2)); if (p.t > 4) kill(p); }
  });
  acc.glu += dt * sm.Glu * 8; while (acc.glu >= 1) { acc.glu--; const p = freeP(gluP); if (p) emit(p, 365 + rnd(-8, 8), 182 + rnd(-8, 8), rnd(-16, 16), rnd(-14, 14)); }
  const gsc = 1 - 0.55 * sm.nmda, glife = 1.6 - 0.7 * sm.nmda;
  gluP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, tm / 6, gsc); p.e.setAttribute("opacity", clamp(1 - p.t / glife).toFixed(2)); if (p.t > glife) kill(p); });
  place(hippoM, hippoDot[0], hippoDot[1], 0, Math.max(0.35, 1 - 0.5 * sm.Hatr)); hippoM.style.opacity = clamp(1 - 0.3 * sm.Hatr).toFixed(2);
  const atr = Math.max(sm.Hatr, sm.Catr);
  place(ventM, brainO.x + 28, brainO.y + 2, 0, 0.55 + 0.95 * atr);
  gg.amy.set(sm.A, wordOf(sm.A, 0.35, 0.7, ["few", "some", "many"])); gg.tau.set(sm.T, wordOf(sm.T, 0.35, 0.7, ["few", "some", "many"])); gg.syn.set(sm.Syn, wordOf(sm.Syn, 0.35, 0.65, ["lost", "reduced", "intact"]));
  gg.ach.set(sm.Ach, wordOf(sm.Ach, 0.3, 0.6, ["low", "reduced", "ok"])); gg.glu.set(sm.Glu, wordOf(sm.Glu, 0.3, 0.6, ["low", "raised", "high"])); gg.mem.set(sm.Mem, wordOf(sm.Mem, 0.3, 0.6, ["poor", "impaired", "preserved"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
