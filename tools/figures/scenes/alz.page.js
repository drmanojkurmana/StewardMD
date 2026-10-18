/* Alzheimer scene: plaques, tau tangles, synapse loss, cholinergic axon, glutamate spill, atrophy and gauges. */
const layers = { axons: $("axons"), plaquesG: $("plaquesG"), neurons: $("neurons"), syns: $("syns"), brainG: $("brainG"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- axons (drawn first, under somas) ---- */
function axonPath(d, cls) { return mk("path", { class: "axon" + (cls ? " " + cls : ""), d: d }, layers.axons); }
axonPath("M186 198C250 172 318 176 362 180");
axonPath("M382 206C366 258 326 292 302 314");
axonPath("M128 352C180 300 250 255 320 220C338 211 350 202 360 192", "axon-chol");
/* ---- neurons with dendrites and tau tangles ---- */
function neuron(x, y, r, cls, seed) {
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
const neurons = [neuron(165, 205, 22, "neuron", 1), neuron(390, 185, 22, "neuron", 4), neuron(280, 335, 20, "neuron", 7)];
const cholNeuron = neuron(110, 362, 17, "chol", 10);
/* ---- synapse boutons and acetylcholinesterase near the first synapse ---- */
const synPts = [[365, 182], [300, 317]];
const synEls = synPts.map(function (p) { const c = mk("circle", { class: "syn-b", cx: p[0], cy: p[1], r: 7 }, layers.syns); return c; });
[[352, 168], [378, 172], [365, 196]].forEach(function (p) { mk("rect", { class: "ache-b", x: p[0] - 3, y: p[1] - 3, width: 6, height: 6, rx: 1.5 }, layers.syns); });
const acheX = mk("g", { opacity: "0" }, layers.syns);
mk("path", { class: "mk-x", d: "M356 162l18 18M374 162l-18 18" }, acheX);
const nmdaX = mk("g", { opacity: "0" }, layers.syns);
mk("path", { class: "mk-x", d: "M382 188l14 14M396 188l-14 14" }, nmdaX);
/* ---- plaques ---- */
const plaquePts = [[275, 160, 15], [465, 255, 17], [235, 325, 13], [320, 242, 12], [150, 285, 11], [440, 130, 11]];
const plaques = plaquePts.map(function (p, i) {
  const g = mk("g", {}, layers.plaqueG || layers.plaquesG);
  mk("path", { class: "plaque-b", d: blobD(p[2], i * 2 + 1, 0.34, 8) }, g);
  mk("circle", { class: "plaque-d", cx: -3, cy: -2, r: 2.2 }, g); mk("circle", { class: "plaque-d", cx: 4, cy: 3, r: 1.8 }, g);
  place(g, p[0], p[1], i * 24, 0.2);
  return { g: g, x: p[0], y: p[1] };
});
/* ---- brain regions: cortex, ventricle, hippocampus ---- */
const cortexG = mk("g", {}, layers.brainG); mk("path", { class: "brain-cx", d: blobD(84, 3, 0.07, 10) }, cortexG);
const ventG = mk("g", {}, layers.brainG); mk("path", { class: "brain-vt", d: blobD(26, 5, 0.12, 8) }, ventG);
const hippoG = mk("g", {}, layers.brainG); mk("path", { class: "brain-hp", d: blobD(20, 8, 0.14, 8) }, hippoG);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const achP = pool(18, function () { return mk("circle", { class: "sc-p p-ach", r: 2.6 }, layers.parts); });
const gluP = pool(16, function () { return mk("path", { class: "sc-p p-glu", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cholTrack = track([[128, 352], [180, 300], [250, 255], [320, 220], [358, 196]]);
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What changes";
  [["amy", "Amyloid", "g-amy", "Amyloid plaques: clumps of amyloid beta peptide between neurons."], ["tau", "Tau", "g-tau", "Tau tangles: twisted tau protein inside neurons, linked to cell failure."], ["syn", "Synapses", "g-syn", "Working synapses: the connections where neurons pass signals. These are lost as disease advances."], ["ach", "ACh signal", "g-ach", "Acetylcholine signal at synapses, supplied by cholinergic neurons. A cholinesterase inhibitor slows its breakdown."], ["glu", "Glutamate", "g-glu", "Excess glutamate spill around synapses. An NMDA blocker damps signalling through NMDA receptors."], ["mem", "Memory", "g-mem", "A stand-in for memory and thinking, which worsen as synapses and neurons are lost."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Neuron", 165, 205, 95, 135, "A cortical neuron. Dendrites receive signals and the cell body holds the nucleus. Neurons shrink and die as tangles build up.");
  pill(ox, "Amyloid plaque", 275, 160, 270, 120, "Amyloid plaque: a clump of amyloid beta peptide outside neurons. Plaques collect between cells and around synapses.");
  pill(ox, "Tau tangle", 390, 185, 455, 130, "Tau tangle: twisted threads of tau protein inside a neuron. They disrupt transport inside the cell and mark failing neurons.");
  pill(ox, "Synapse", 300, 317, 380, 290, "A synapse: a tiny gap where one neuron signals to the next. Synapse loss tracks memory loss closely.");
  pill(ox, "Glutamate spill", 365, 182, 510, 235, "Excess glutamate around an overactive synapse. Signalling through NMDA receptors can add to neuron stress. An NMDA blocker damps this.");
  pill(ox, "Acetylcholine", 250, 255, 165, 275, "Acetylcholine released by a cholinergic axon at a synapse. It is broken down by acetylcholinesterase. A cholinesterase inhibitor slows that breakdown.");
  pill(ox, "Cholinergic neuron", 110, 362, 195, 400, "A basal forebrain cholinergic neuron. These neurons supply acetylcholine to cortex and hippocampus and are lost early.");
  pill(ox, "Cortex", 770, 150, 775, 110, "The cerebral cortex, the outer thinking layer. It thins later in disease as neurons and synapses are lost.");
  pill(ox, "Hippocampus", 725, 292, 740, 365, "The hippocampus, needed to form new memories. It shrinks early, which fits early forgetfulness for recent events.");
  pill(ox, "Ventricle", 770, 215, 855, 320, "A ventricle: a fluid filled space inside the brain. It enlarges as surrounding tissue shrinks.");
  const c1 = pill(ox, "AChE blocked", 365, 175, 455, 165, "Acetylcholinesterase blocked: acetylcholine lasts longer in the synapse."); c1.setAttribute("id", "chei-pill");
  const c2 = pill(ox, "NMDA blocked", 389, 195, 455, 198, "NMDA receptor blocked: excess glutamate signalling is damped."); c2.setAttribute("id", "nmda-pill");
}
const sm = { A: 0.4, T: 0.4, Syn: 0.6, ACh: 0.4, Glu: 0.4, Mem: 0.5, Hatr: 0.4, Catr: 0.2, Nloss: 0.3, chei: 0, nmda: 0 };
const acc = { ach: 0, glu: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.A = lerp(sm.A, m.A, k); sm.T = lerp(sm.T, m.T, k); sm.Syn = lerp(sm.Syn, m.Syn, k); sm.ACh = lerp(sm.ACh, m.ACh, k); sm.Glu = lerp(sm.Glu, m.Glu, k); sm.Mem = lerp(sm.Mem, m.Mem, k); sm.Hatr = lerp(sm.Hatr, m.Hatr, k); sm.Catr = lerp(sm.Catr, m.Catr, k); sm.Nloss = lerp(sm.Nloss, m.Nloss, k); sm.chei = lerp(sm.chei, m.chei, k); sm.nmda = lerp(sm.nmda, m.nmda, k);
  /* plaques grow, tangles build, neurons fade */
  plaques.forEach(function (p, i) { const s = 0.15 + 0.95 * sm.A * (1 - i * 0.06); place(p.g, p.x, p.y, i * 24 + tm / 9000, Math.max(0.05, s)); p.g.style.opacity = sm.A > 0.06 ? 1 : 0; });
  neurons.forEach(function (n, i) { const fade = 1 - sm.Nloss * (0.25 + i * 0.22); n.g.style.opacity = clamp(fade + 0.18).toFixed(2); const s = 1 - 0.16 * sm.Nloss * (0.5 + i * 0.3); place(n.g, n.x + Math.sin(tm / 1600 + i * 2) * 1.5, n.y, Math.sin(tm / 2400 + i) * 4, s); n.tau.style.opacity = clamp(sm.T * 1.2 - i * 0.08).toFixed(2); });
  cholNeuron.g.style.opacity = clamp(1 - sm.Nloss * 0.85).toFixed(2); place(cholNeuron.g, cholNeuron.x, cholNeuron.y, 0, 1 - 0.2 * sm.Nloss); cholNeuron.tau.style.opacity = clamp(sm.T).toFixed(2);
  synEls.forEach(function (c, i) { const r = 3 + 5 * sm.Syn * (1 + 0.12 * Math.sin(tm / 300 + i * 2)); c.setAttribute("r", f1(r)); c.style.opacity = clamp(0.25 + 0.75 * sm.Syn).toFixed(2); });
  acheX.setAttribute("opacity", sm.chei.toFixed(2)); nmdaX.setAttribute("opacity", sm.nmda.toFixed(2));
  $("chei-pill").style.opacity = sm.chei.toFixed(2); $("nmda-pill").style.opacity = sm.nmda.toFixed(2);
  /* acetylcholine travels along the cholinergic axon to the synapse */
  acc.ach += dt * (1 + 7 * sm.ACh); while (acc.ach >= 1) { acc.ach--; const p = freeP(achP); if (p) { emit(p, 128, 352, 0, 0); } }
  achP.forEach(function (p) { if (!p.on) return; p.t += dt; p.u += dt * (0.16 + 0.1 * sm.ACh); const pt = cholTrack.at(Math.min(1, p.u)); p.x = pt.x; p.y = pt.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); const life = sm.chei > 0.5 ? 7 : 5; if (p.u >= 1 || p.t > life) kill(p); });
  /* glutamate spill around the first synapse */
  acc.glu += dt * sm.Glu * 7; while (acc.glu >= 1) { acc.glu--; const p = freeP(gluP); if (p) emit(p, 365 + rnd(-8, 8), 182 + rnd(-8, 8), rnd(-16, 16), rnd(-14, 14)); }
  gluP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* brain regions: hippocampus shrinks early, cortex thins later, ventricle enlarges */
  place(cortexG, 770, 205, 0, 1 - 0.16 * sm.Catr); cortexG.style.opacity = (1 - 0.25 * sm.Catr).toFixed(2);
  place(ventG, 770, 210, 0, 0.55 + 0.95 * Math.max(sm.Hatr, sm.Catr)); 
  place(hippoG, 725, 292, -18, Math.max(0.35, 1 - 0.5 * sm.Hatr)); hippoG.setAttribute("transform", hippoG.getAttribute("transform") + " scale(1.35 0.65)"); hippoG.style.opacity = clamp(1 - 0.3 * sm.Hatr).toFixed(2);
  /* gauges */
  gg.amy.set(sm.A, wordOf(sm.A, 0.35, 0.7, ["few", "some", "many"])); gg.tau.set(sm.T, wordOf(sm.T, 0.35, 0.7, ["few", "some", "many"])); gg.syn.set(sm.Syn, wordOf(sm.Syn, 0.35, 0.65, ["lost", "reduced", "intact"]));
  gg.ach.set(sm.ACh, wordOf(sm.ACh, 0.3, 0.6, ["low", "reduced", "ok"])); gg.glu.set(sm.Glu, wordOf(sm.Glu, 0.3, 0.6, ["low", "raised", "high"])); gg.mem.set(sm.Mem, wordOf(sm.Mem, 0.3, 0.6, ["poor", "impaired", "preserved"]));
}
run({ init: init, step: step });
