/* Alcohol withdrawal scene: GABA and glutamate particles at a synapse, timeline, body signs and gauges. */
const layers = { sending: $("sending"), receiving: $("receiving"), parts: $("parts"), signs: $("signs"), over: $("over"), panel: $("panel") };
const sendG = cell(layers.sending, { cls: "pre", r: 38, nuc: 0.4, seed: 3, wob: 0.1 });
const recvG = cell(layers.receiving, { cls: "post", r: 42, nuc: 0.38, seed: 7, wob: 0.09 });
const heartG = mk("g", {}, layers.signs);
mk("path", { class: "heart", d: "M0 8C-16 -4 -10 -20 0 -9C10 -20 16 -4 0 8Z" }, heartG);
const tremG = cell(layers.signs, { cls: "brain", r: 16, nuc: 0.45, seed: 11, wob: 0.14 });
const brainG = cell(layers.signs, { cls: "brain", r: 20, nuc: 0.42, seed: 15, wob: 0.1 });
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const gabaP = pool(24, () => mk("circle", { class: "sc-p p-gaba", r: 2.6 }, layers.parts));
const gluP = pool(26, () => mk("path", { class: "sc-p p-glu", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const benzoP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const thiaP = pool(10, () => mk("rect", { class: "sc-p p-thia", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
const fluidP = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 230, 370, 510, 650, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The rebound";
  [["inh", "Inhibition", "g-inh", "GABA inhibition. Chronic alcohol boosted it, so the brain weakened it. When alcohol stops, this brake is too weak."], ["exc", "Excitation", "g-exc", "Glutamate excitation through NMDA receptors. Chronic alcohol blocked these receptors, so the brain strengthened them."], ["hyp", "Excitability", "g-hyp", "How ready the brain is to fire out of control: high when excitation outruns inhibition. Seizures come from this surge."], ["aut", "Autonomic", "g-aut", "Autonomic hyperactivity: racing pulse, sweating and raised temperature as the rebound spreads beyond the brain."], ["conf", "Confusion", "g-conf", "Confusion and agitation. Most marked in delirium tremens, the severe late stage."], ["thi", "Thiamine", "g-thi", "Thiamine (vitamin B1) store. Chronic alcohol use depletes it. Replacing it protects the brain but does not calm excitability."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "GABA signal", 310, 248, 130, 180, "GABA is the main inhibitory transmitter. After adaptation its signal is weak, so the brake on firing fails.");
  pill(ox, "Glutamate signal", 310, 312, 330, 365, "Glutamate is the main excitatory transmitter. Strengthened NMDA receptors make its signal surge when alcohol stops.");
  pill(ox, "Receiving neuron", 435, 238, 470, 180, "The receiving neuron carries GABA receptors (upper, teal) and NMDA glutamate receptors (lower, orange) on its surface.");
  pill(ox, "Sending neuron", 175, 313, 170, 395, "The sending neuron releases GABA and glutamate across the gap to the receiving neuron.");
  pill(ox, "Heart racing", 712, 222, 830, 200, "A racing pulse from autonomic hyperactivity. Sweating and tremor come with it in early withdrawal.");
  pill(ox, "Tremor", 712, 292, 830, 270, "Shaking, most obvious in the hands. An early sign that grows as excitability rises.");
  pill(ox, "Confused brain", 712, 362, 830, 340, "In delirium tremens the brain is agitated and confused, with severe autonomic hyperactivity. This stage can be life threatening.");
  const bz = pill(ox, "Benzodiazepine", 388, 314, 480, 410, "A benzodiazepine boosts GABA inhibition, restoring the brake and calming excitability, tremor and autonomic surge."); bz.setAttribute("id", "bz-pill");
  const th = pill(ox, "Thiamine", 710, 370, 830, 400, "Thiamine replaces the depleted vitamin store and protects the brain. It does not by itself stop the excitability surge."); th.setAttribute("id", "th-pill");
  const fl = pill(ox, "Fluids", 672, 248, 675, 415, "Supportive fluids support circulation while the rebound settles. They do not restore the GABA brake."); fl.setAttribute("id", "fl-pill");
}
const sm = { G: 0.5, E: 0.4, Exc: 0.4, Aut: 0.4, Conf: 0.2, Thi: 0.4, tlv: 1, benzo: 0, thia: 0, fluids: 0 };
const acc = { gaba: 0, glu: 0, benzo: 0, thia: 0, fluid: 0 };
function init() { place(sendG, 175, 275, 0, 1); place(recvG, 435, 275, 0, 1); place(heartG, 690, 230, 0, 1); place(tremG, 690, 300, 0, 1); place(brainG, 690, 370, 0, 1); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.G = lerp(sm.G, m.G, k); sm.E = lerp(sm.E, m.E, k); sm.Exc = lerp(sm.Exc, m.Exc, k); sm.Aut = lerp(sm.Aut, m.Aut, k); sm.Conf = lerp(sm.Conf, m.Conf, k); sm.Thi = lerp(sm.Thi, m.Thi, k); sm.tlv = lerp(sm.tlv, m.tl, k);
  sm.benzo = lerp(sm.benzo, m.benzo, k); sm.thia = lerp(sm.thia, m.thia, k); sm.fluids = lerp(sm.fluids, m.fluids, k);
  const shake = sm.Exc * Math.sin(tm / 70);
  place(sendG, 175, 275 + Math.sin(tm / 900) * 2, 0, 1);
  place(recvG, 435 + shake * 4, 275 + Math.cos(tm / 80) * sm.Exc * 3, shake * 2, 1 + 0.08 * sm.Exc * Math.max(0, Math.sin(tm / 180)));
  $("gaba-rec").setAttribute("opacity", (0.3 + 0.7 * sm.G).toFixed(2)); $("nmda-rec").setAttribute("opacity", (0.3 + 0.7 * sm.E).toFixed(2));
  $("tl-prog").setAttribute("width", f1((sm.tlv / 2) * 820));
  [0, 1, 2].forEach((i) => { const el = $("tl" + i); el.style.fill = Math.round(sm.tlv) === i ? "var(--c-bad)" : ""; });
  place(heartG, 690, 230, 0, 1 + 0.3 * sm.Aut * Math.max(0, Math.sin(tm / 160)));
  place(tremG, 690 + Math.sin(tm / 55) * sm.Exc * 5, 300, Math.sin(tm / 60) * sm.Exc * 8, 1);
  place(brainG, 690 + Math.sin(tm / 90) * sm.Conf * 4, 370, Math.sin(tm / 110) * sm.Conf * 6, 1 + 0.06 * sm.Conf * Math.sin(tm / 200));
  [0, 1, 2].forEach((i) => { const el = $("trem" + i); if (el) el.setAttribute("opacity", (sm.Exc * (0.4 + 0.2 * i)).toFixed(2)); });
  acc.gaba += dt * sm.G * 10; while (acc.gaba >= 1) { acc.gaba--; const p = free(gabaP); if (p) emit(p, 218, rnd(238, 258), rnd(52, 68), rnd(-4, 4), 0); }
  gabaP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 200, 392)) + " " + f1(clamp(p.y, 225, 270)) + ")"); if (p.x > 378) kill(p); });
  acc.glu += dt * sm.E * 13; while (acc.glu >= 1) { acc.glu--; const p = free(gluP); if (p) emit(p, 218, rnd(298, 318), rnd(52, 68), rnd(-4, 4), 0); }
  gluP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 200, 392)) + " " + f1(clamp(p.y, 288, 335)) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 378) kill(p); });
  acc.benzo += dt * sm.benzo * 5; while (acc.benzo >= 1) { acc.benzo--; const p = free(benzoP); if (p) emit(p, rnd(280, 360), 205, rnd(-5, 5), rnd(18, 28), 0); }
  benzoP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 250, 385)) + " " + f1(clamp(p.y, 195, 265)) + ") rotate(" + f1(p.t * 80) + ")"); if (p.y > 258) kill(p); });
  acc.thia += dt * sm.thia * 5; while (acc.thia >= 1) { acc.thia--; const p = free(thiaP); if (p) emit(p, rnd(655, 675), rnd(355, 385), rnd(22, 34), rnd(-4, 4), 0); }
  thiaP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 648, 700)) + " " + f1(clamp(p.y, 348, 392)) + ")"); if (p.x > 668) kill(p); });
  acc.fluid += dt * sm.fluids * 6; while (acc.fluid >= 1) { acc.fluid--; const p = free(fluidP); if (p) emit(p, rnd(650, 665), rnd(215, 245), rnd(24, 36), 0, 0); }
  fluidP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 645, 682)) + " " + f1(clamp(p.y, 208, 252)) + ")"); if (p.x > 678) kill(p); });
  $("bz-pill").style.opacity = sm.benzo.toFixed(2); $("th-pill").style.opacity = sm.thia.toFixed(2); $("fl-pill").style.opacity = sm.fluids.toFixed(2);
  gg.inh.set(sm.G, wordOf(sm.G, 0.35, 0.6, ["low", "reduced", "steady"])); gg.exc.set(sm.E, wordOf(sm.E, 0.5, 0.75, ["mild", "raised", "high"]));
  gg.hyp.set(sm.Exc, wordOf(sm.Exc, 0.3, 0.62, ["calm", "tense", "surging"])); gg.aut.set(sm.Aut, wordOf(sm.Aut, 0.4, 0.65, ["settled", "active", "racing"]));
  gg.conf.set(sm.Conf, wordOf(sm.Conf, 0.3, 0.62, ["clear", "uneasy", "confused"])); gg.thi.set(sm.Thi, wordOf(sm.Thi, 0.35, 0.65, ["low", "partly filled", "replaced"]));
}
run({ init, step });
