/* Epilepsy scene: brain organ, magnified cortex patch, glutamate and GABA particles,
 * drug blockers docking on their channel, spread ring, EEG trace and gauges. */
const layers = { edges: $("edges"), neu: $("neurons"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* cortex patch: columns 310, 430, 550; rows 165, 245, 325 (box 280 to 588, 128 to 360) */
const COLS = [310, 430, 550], ROWS = [165, 245, 325];
const neurons = [];
COLS.forEach((x, ci) => ROWS.forEach((y, ri) => neurons.push({ x, y, focal: ci === 0 && ri < 2, ph: rnd(0, 6.28) })));
const inter = [{ x: 370, y: 205 }, { x: 490, y: 205 }, { x: 430, y: 285 }];
const edges = [];
neurons.forEach((n, i) => neurons.forEach((m, j) => { if (j > i && ((Math.abs(n.x - m.x) === 120 && n.y === m.y) || (n.x === m.x && Math.abs(n.y - m.y) === 80))) edges.push([i, j]); }));
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0, dock: false, fade: false }; }); }
const glu = pool(36, () => mk("circle", { class: "sc-p p-glu", r: 2.6 }, layers.parts));
const gab = pool(26, () => mk("circle", { class: "sc-p p-gaba", r: 2.6 }, layers.parts));
const med = pool(16, () => mk("circle", { class: "sc-p p-drug", r: 3.4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.dock = false; p.fade = false; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function rowY(d) { return d === 1 ? 282 : d === 2 ? 222 : 162; }
let brainO = null, eegEl = null, capEl = null, capDrug = -1, prevDrug = -1, dockN = 0;
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 150, 235, 190, {});
  $("brainGlow").setAttribute("cx", f1(brainO.x));
  $("brainGlow").setAttribute("cy", f1(brainO.y));
  $("fiber").setAttribute("d", "M" + f1(brainO.x + brainO.w / 2 - 4) + " " + f1(brainO.y) + " L280 245");
}
function capText(d) {
  if (d === 1) return "Glutamate blocker sits on its receptor. Less excitation gets through, so spread shrinks.";
  if (d === 2) return "GABA boost opens calming receptors wider. Firing slows and the trace settles.";
  if (d === 3) return "Sodium blocker plugs the channel. Fast firing stalls and the trace flattens.";
  return "No treatment. Excitation beats inhibition, firing spreads and the trace spikes.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The network";
  [["exc", "Excitation", "g-exc", "Glutamate drive from excitatory neurons onto their neighbours. More excitation pushes the network toward firing together."], ["inh", "Inhibition", "g-inh", "GABA released by inhibitory cells. It steadies neurons and holds firing down."], ["hyp", "Hyperexcitable", "g-hyp", "How ready neurons are to fire fast and together: high when excitation outruns inhibition, or when sodium channels are too ready to open."], ["spr", "Spread", "g-spr", "How far firing recruits beyond the starting cluster: local in a focal seizure, widespread when generalised."], ["fir", "Firing", "g-fir", "How fast and how together the network is firing. Fast, synchronised firing is the seizure itself."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, top = brainO.y - brainO.h / 2;
  pill(ox, "Brain", brainO.x, top + 4, 150, 66, "Brain: the seizure happens here, in the cortex. A patch of cortex is shown magnified on the right.");
  pill(ox, "Cortex patch", 430, 130, 430, 66, "Cortex patch, magnified. Orange cells excite their neighbours, teal cells calm them.");
  pill(ox, "Ion channels", 796, 112, 800, 66, "Ion channels set excitability: sodium drives firing, GABA calms, glutamate passes excitation on. Treatment docks on its own row.");
  pill(ox, "Seizure focus", 310, 182, 300, 392, "The starting cluster. In a focal seizure a small group of hyperexcitable neurons fires first and may recruit its neighbours.");
  pill(ox, "Glutamate excites", 370, 245, 455, 392, "Glutamate is the main excitatory transmitter. It makes the next neuron more likely to fire.");
  pill(ox, "GABA calms", 490, 205, 600, 392, "GABA is the main calming transmitter. Weak or overwhelmed calming lets excitation run unchecked.");
  pill(ox, "Brain wave trace", 796, 400, 796, 345, "The trace sums many neurons. Calm activity is small and irregular, a seizure shows large regular spikes.");
  capEl = mk("text", { class: "ep-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { E: 0.5, I: 0.5, H: 0.4, Sp: 0.2, F: 0.3, d1: 0, d2: 0, d3: 0 };
const acc = { glu: 0, gab: 0, med: 0 };
function init() {
  initOrgans();
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
  sm.d1 = lerp(sm.d1, drug === 1 ? 1 : 0, k); sm.d2 = lerp(sm.d2, drug === 2 ? 1 : 0, k); sm.d3 = lerp(sm.d3, drug === 3 ? 1 : 0, k);
  if (drug !== prevDrug) { prevDrug = drug; dockN = 0; med.forEach(kill); }
  /* channels close or open: sodium and glutamate narrow shut, GABA opens wider */
  const naW = 16 - 9 * sm.d3, gluW = 16 - 9 * sm.d1, gabaW = 16 + 8 * sm.d2;
  $("na-chan").setAttribute("width", f1(naW)); $("na-chan").setAttribute("x", f1(856 - naW / 2));
  $("glu-chan").setAttribute("width", f1(gluW)); $("glu-chan").setAttribute("x", f1(856 - gluW / 2));
  $("gaba-chan").setAttribute("width", f1(gabaW)); $("gaba-chan").setAttribute("x", f1(856 - gabaW / 2));
  $("na-block").setAttribute("opacity", sm.d3.toFixed(2)); $("glu-block").setAttribute("opacity", sm.d1.toFixed(2));
  $("gaba-glow").setAttribute("opacity", (sm.d2 * 0.85).toFixed(2));
  /* seizure glow on the brain and the spread ring round the focus */
  $("brainGlow").setAttribute("opacity", (sm.F * 0.45).toFixed(2));
  const ring = $("spreadRing"), wob = Math.sin(tm / 300) * 8 * sm.Sp;
  ring.setAttribute("rx", f1(34 + 110 * sm.Sp + wob)); ring.setAttribute("ry", f1(30 + 95 * sm.Sp + wob * 0.8));
  ring.setAttribute("opacity", (0.08 + 0.5 * sm.Sp).toFixed(2));
  neurons.forEach((n) => { const act = n.focal ? sm.H : sm.Sp; const pulse = Math.max(0, Math.sin(tm / 160 + n.ph)) * act; place(n.g, n.x, n.y, 0, 1 + 0.22 * pulse); n.g.style.opacity = (0.55 + 0.45 * act).toFixed(2); });
  inter.forEach((c, i) => { place(c.g, c.x, c.y + Math.sin(tm / 700 + i) * 2, 0, 1 + 0.12 * sm.I * Math.max(0, Math.sin(tm / 240 + i))); c.g.style.opacity = (0.6 + 0.4 * Math.max(sm.I, sm.d2)).toFixed(2); });
  acc.glu += dt * sm.E * (0.4 + sm.F) * 14; while (acc.glu >= 1) { acc.glu--; const p = free(glu), e = pick(edges); if (p && e) emit(p, neurons[e[0]].x, neurons[e[0]].y, 0, 0, e[1]); }
  glu.forEach((p) => {
    if (!p.on) return;
    if (drug === 1 && !p.fade && Math.random() < dt * 1.4) p.fade = true;
    if (p.fade) { p.e.setAttribute("opacity", clamp(+p.e.getAttribute("opacity") - dt * 2.4).toFixed(2)); if (+p.e.getAttribute("opacity") <= 0.02) kill(p); return; }
    const t = neurons[p.k], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 24) kill(p);
  });
  acc.gab += dt * sm.I * 11; while (acc.gab >= 1) { acc.gab--; const p = free(gab), c = pick(inter); if (p) { const t = neurons.reduce((q, r) => (Math.hypot(r.x - c.x, r.y - c.y) < Math.hypot(q.x - c.x, q.y - c.y) ? r : q)); emit(p, c.x, c.y, 0, 0, neurons.indexOf(t)); } }
  gab.forEach((p) => { if (!p.on) return; const t = neurons[p.k], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 56 * dt; p.y += (dy / d) * 56 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 24) kill(p); });
  /* treatment particles rise from below and dock on their channel row */
  if (drug > 0) {
    acc.med += dt * 2.2;
    while (acc.med >= 1) {
      acc.med--;
      const p = free(med);
      if (p) {
        const s = dockN % 8; dockN++;
        emit(p, rnd(700, 900), 448, 0, 0, 0);
        p.tx = 842 + (s % 4) * 8; p.ty = rowY(drug) - 12 + (s > 3 ? 22 : 0);
      }
    }
  }
  med.forEach((p) => {
    if (!p.on) return;
    if (p.dock) {
      p.t += dt; place(p.e, p.tx + Math.sin(tm / 300 + p.ty) * 1.2, p.ty, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.1).toFixed(2));
      if (p.t > 4.5) kill(p); return;
    }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 110 * dt; p.y += (dy / d) * 110 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 7) { p.dock = true; p.t = 0; }
  });
  if (eegEl) { let d = ""; for (let x = 668; x <= 928; x += 8) { const s = Math.sin(x * 0.09 + tm / 110), sp = Math.pow(Math.max(0, s), 3) - 0.6 * Math.pow(Math.max(0, -s), 3); const y = clamp(404 - (2 + 3 * (1 - sm.F)) * Math.sin(x * 0.05 + tm / 300) - sm.F * 20 * sp, 384, 424); d += (d ? "L" : "M") + x + " " + f1(y); } eegEl.setAttribute("d", d); }
  gg.exc.set(sm.E, wordOf(sm.E, 0.4, 0.65, ["low", "moderate", "high"])); gg.inh.set(sm.I, wordOf(sm.I, 0.38, 0.58, ["weak", "strained", "strong"]));
  gg.hyp.set(sm.H, wordOf(sm.H, 0.3, 0.62, ["steady", "tense", "hyperexcitable"])); gg.spr.set(sm.Sp, wordOf(sm.Sp, 0.2, 0.55, ["none", "local", "widespread"])); gg.fir.set(sm.F, wordOf(sm.F, 0.28, 0.62, ["calm", "active", "firing fast"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
