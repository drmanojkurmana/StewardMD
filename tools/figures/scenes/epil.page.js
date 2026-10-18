/* Epilepsy scene: cortical network, glutamate and GABA particles, ion channel inset, EEG trace and gauges. */
const layers = { edges: $("edges"), neu: $("neurons"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* neuron grid: columns 110, 240, 370, 500; rows 150, 230, 310 (radius about 22, so field spans y 128 to 332) */
const COLS = [110, 240, 370, 500], ROWS = [150, 230, 310];
const neurons = [];
COLS.forEach((x) => ROWS.forEach((y) => neurons.push({ x, y, focal: (x === 240 || x === 370) && (y === 150 || y === 230), ph: rnd(0, 6.28) })));
const inter = [{ x: 175, y: 190 }, { x: 435, y: 190 }, { x: 305, y: 270 }];
const edges = [];
neurons.forEach((n, i) => neurons.forEach((m, j) => { if (j > i && Math.abs(n.x - m.x) + Math.abs(n.y - m.y) === 130) edges.push([i, j]); }));
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const glu = pool(36, () => mk("circle", { class: "sc-p p-glu", r: 2.6 }, layers.parts));
const gab = pool(26, () => mk("circle", { class: "sc-p p-gaba", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The network";
  [["exc", "Excitation", "g-exc", "Glutamate drive from excitatory neurons onto their neighbours. More excitation pushes the network toward firing together."], ["inh", "Inhibition", "g-inh", "GABA released by inhibitory cells. It steadies neurons and holds firing down."], ["hyp", "Hyperexcitable", "g-hyp", "How ready neurons are to fire fast and together: high when excitation outruns inhibition, or when sodium channels are too ready to open."], ["spr", "Spread", "g-spr", "How far firing recruits beyond the starting cluster: local in a focal seizure, widespread when generalised."], ["fir", "Firing", "g-fir", "How fast and how together the network is firing. Fast, synchronised firing is the seizure itself."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Excitatory neuron", 110, 150, 110, 112, "Excitatory (pyramidal) neuron. It releases glutamate, which excites the neurons it connects to. Sodium currents drive its rapid firing.");
  pill(ox, "Inhibitory cell", 435, 190, 480, 112, "Inhibitory interneuron. It releases GABA, which opens chloride channels on nearby neurons and holds their firing down.");
  pill(ox, "Ion channels", 856, 140, 800, 112, "Ion channels set excitability: sodium channels drive firing, GABA receptors let chloride in and calm the cell, and glutamate receptors pass the excitatory signal.");
  pill(ox, "Glutamate excites", 175, 230, 150, 368, "Glutamate is the main excitatory transmitter. It opens glutamate receptors and makes the next neuron more likely to fire.");
  pill(ox, "Seizure focus", 240, 230, 305, 368, "The starting cluster. In a focal seizure a small group of hyperexcitable neurons fires first and may recruit its neighbours.");
  pill(ox, "GABA inhibits", 305, 270, 470, 368, "GABA is the main inhibitory transmitter. Weak or overwhelmed inhibition lets excitation run unchecked.");
  pill(ox, "Wider spread", 500, 310, 580, 368, "Spread: firing recruits distant cortex. When it engages the whole network the seizure is generalised, with loss of awareness and convulsions.");
  pill(ox, "Brain wave trace", 796, 404, 796, 345, "The EEG sums the activity of many neurons. Calm activity is small and irregular; a seizure shows large, regular spikes as neurons fire together.");
}
const sm = { E: 0.5, I: 0.5, H: 0.4, Sp: 0.2, F: 0.3, d1: 0, d2: 0, d3: 0 };
const acc = { glu: 0, gab: 0 };
let eegEl = null;
function init() {
  edges.forEach(([i, j]) => mk("path", { class: "edge", d: "M" + neurons[i].x + " " + neurons[i].y + "L" + neurons[j].x + " " + neurons[j].y }, layers.edges));
  inter.forEach((c) => mk("path", { class: "edge-inh", d: "M" + c.x + " " + c.y + "L" + (c.x + 40) + " " + (c.y - 20) }, layers.edges));
  neurons.forEach((n, i) => { n.g = cell(layers.neu, { cls: "pyr", r: 22, nuc: 0.38, seed: i + 1, wob: 0.08 }); place(n.g, n.x, n.y, 0, 1); });
  inter.forEach((c, i) => { c.g = cell(layers.neu, { cls: "inh", r: 13, nuc: 0.45, seed: i + 30, wob: 0.12 }); place(c.g, c.x, c.y, 0, 1); });
  eegEl = $("eeg");
  initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.E = lerp(sm.E, m.E, k); sm.I = lerp(sm.I, m.I, k); sm.H = lerp(sm.H, m.H, k); sm.Sp = lerp(sm.Sp, m.Sp, k); sm.F = lerp(sm.F, m.F, k);
  sm.d1 = lerp(sm.d1, m && document.getElementById("drug").value === "1" ? 1 : 0, k); sm.d2 = lerp(sm.d2, document.getElementById("drug").value === "2" ? 1 : 0, k); sm.d3 = lerp(sm.d3, document.getElementById("drug").value === "3" ? 1 : 0, k);
  $("na-block").setAttribute("opacity", sm.d1.toFixed(2)); $("glu-block").setAttribute("opacity", sm.d3.toFixed(2));
  $("gaba-glow").setAttribute("opacity", (sm.d2 * 0.85).toFixed(2));
  neurons.forEach((n) => { const act = n.focal ? sm.H : sm.Sp; const pulse = Math.max(0, Math.sin(tm / 160 + n.ph)) * act; place(n.g, n.x, n.y, 0, 1 + 0.22 * pulse); n.g.style.opacity = (0.72 + 0.28 * act).toFixed(2); });
  inter.forEach((c, i) => place(c.g, c.x, c.y + Math.sin(tm / 700 + i) * 2, 0, 1 + 0.1 * sm.I * Math.max(0, Math.sin(tm / 240 + i))));
  acc.glu += dt * sm.E * (0.4 + sm.F) * 14; while (acc.glu >= 1) { acc.glu--; const p = free(glu), e = pick(edges); if (p && e) emit(p, neurons[e[0]].x, neurons[e[0]].y, 0, 0, e[1]); }
  glu.forEach((p) => { if (!p.on) return; const t = neurons[p.k], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 24) kill(p); });
  acc.gab += dt * sm.I * 11; while (acc.gab >= 1) { acc.gab--; const p = free(gab), c = pick(inter); if (p) { const t = neurons.reduce((q, r) => (Math.hypot(r.x - c.x, r.y - c.y) < Math.hypot(q.x - c.x, q.y - c.y) ? r : q)); emit(p, c.x, c.y, 0, 0, neurons.indexOf(t)); } }
  gab.forEach((p) => { if (!p.on) return; const t = neurons[p.k], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 56 * dt; p.y += (dy / d) * 56 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 24) kill(p); });
  if (eegEl) { let d = ""; for (let x = 668; x <= 928; x += 8) { const s = Math.sin(x * 0.09 + tm / 110), sp = Math.pow(Math.max(0, s), 3) - 0.6 * Math.pow(Math.max(0, -s), 3); const y = clamp(404 - (2 + 3 * (1 - sm.F)) * Math.sin(x * 0.05 + tm / 300) - sm.F * 20 * sp, 384, 424); d += (d ? "L" : "M") + x + " " + f1(y); } eegEl.setAttribute("d", d); }
  gg.exc.set(sm.E, wordOf(sm.E, 0.4, 0.65, ["low", "moderate", "high"])); gg.inh.set(sm.I, wordOf(sm.I, 0.38, 0.58, ["weak", "strained", "strong"]));
  gg.hyp.set(sm.H, wordOf(sm.H, 0.3, 0.62, ["steady", "tense", "hyperexcitable"])); gg.spr.set(sm.Sp, wordOf(sm.Sp, 0.2, 0.55, ["none", "local", "widespread"])); gg.fir.set(sm.F, wordOf(sm.F, 0.28, 0.62, ["calm", "active", "firing fast"]));
}
run({ init, step });
