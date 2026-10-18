/* Polio scene: faecal oral entry, gut lymphoid replication, viraemia, anterior horn loss, flaccid muscle and breathing. */
const WW = SC.W;
const layers = { gut: $("gutparts"), parts: $("parts"), neurons: $("neurons"), muscle: $("muscle"), lungs: $("lungs"), over: $("over"), panel: $("panel") };
/* gut lymphoid cells */
const lymph = [[118, 218], [150, 230], [182, 218], [134, 238], [166, 238]].map(([x, y], i) => { const g = cell(layers.gut, { cls: "vircell", r: 11, nuc: 0.45, seed: i + 3, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y }; });
/* swallowed virus dots sitting in the gut lumen */
const gutVirus = [];
for (let i = 0; i < 12; i++) { const e = mk("circle", { class: "sc-p p-virus", r: 3 }, layers.gut); gutVirus.push({ e, x: rnd(62, 206), y: rnd(136, 168), a: rnd(0, 6.28), s: 0 }); }
/* motor neurons in the anterior horn */
const neurons = [[540, 148], [578, 142], [548, 206], [584, 214], [560, 272], [590, 282]].map(([x, y], i) => { const g = cell(layers.neurons, { cls: "mot", r: 15, nuc: 0.42, seed: i * 2 + 5, wob: 0.14 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
/* muscle fibres: upper group keeps bulk, lower group wastes first, so weakness looks asymmetric */
const fibres = [];
for (let i = 0; i < 5; i++) { const weak = i >= 3 ? 1 : 0; const e = mk("rect", { class: "po-fibre", x: 716, y: 126 + i * 17, width: 168, height: 11, rx: 5.5 }, layers.muscle); fibres.push({ e, weak }); }
const fibreCap = mk("text", { class: "po-cap", x: 716, y: 214 }, layers.muscle); fibreCap.textContent = "one side weaker, wasting later";
/* lungs and diaphragm */
const lungL = mk("ellipse", { class: "po-lung", cx: 756, cy: 322, rx: 30, ry: 24 }, layers.lungs);
const lungR = mk("ellipse", { class: "po-lung", cx: 862, cy: 322, rx: 30, ry: 24 }, layers.lungs);
const diaph = mk("path", { class: "po-diaph", d: "M724 366Q809 344 894 366" }, layers.lungs);
const ventTube = mk("path", { class: "po-tube", d: "M809 256L809 292", opacity: "0" }, layers.lungs);
const brain = mk("ellipse", { class: "po-lung", cx: 809, cy: 292, rx: 17, ry: 11 }, layers.lungs);
/* particle pools: items expose their element as p.e */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const virus = pool(22, () => mk("circle", { class: "sc-p p-virus", r: 2.8 }, layers.parts));
const signal = pool(14, () => mk("circle", { class: "sc-p p-signal", r: 2.6 }, layers.parts));
const air = pool(16, () => mk("circle", { class: "sc-p p-air", r: 2.5 }, layers.parts));
const ab = pool(12, () => mk("circle", { class: "sc-p p-ab", r: 2.7 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const virusTrack = track([[76, 152], [186, 152], [152, 222], [252, 198], [362, 180], [462, 180], [540, 172]]);
const signalTrack = track([[628, 196], [690, 172], [742, 156], [884, 156]]);
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 260, 430, 600, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vir", "Gut virus", "g-vir", "Poliovirus multiplying in the gut and gut lymphoid tissue after faecal oral spread. Vaccine prevention lowers this."], ["via", "Viraemia", "g-via", "Virus in the blood: the bridge from gut infection to invasion of the nervous system."], ["neur", "Neuron loss", "g-neur", "Anterior horn motor neurons destroyed in the spinal cord and brainstem. Lost neurons do not recover."], ["par", "Paralysis", "g-par", "Asymmetric flaccid weakness from lower motor neuron loss: low tone, weak or absent reflexes, sensation usually intact."], ["resp", "Breathing", "g-resp", "Breathing trouble from bulbar failure and weak respiratory muscles. Ventilation supports this, it does not restore neurons."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Faecal-oral entry", 66, 126, 105, 68, "Faecal oral spread: poliovirus is swallowed, often from contaminated hands, food or water, and starts in the throat and gut.");
  pill(ox, "Viraemia", 362, 160, 362, 108, "Viraemia: virus in the bloodstream after gut replication, giving access to the central nervous system.");
  pill(ox, "Anterior horn cells", 560, 148, 576, 68, "Anterior horn motor neurons: lower motor neurons in the front of the spinal cord. Poliovirus invasion destroys them.");
  pill(ox, "Skeletal muscle", 790, 140, 808, 68, "Skeletal muscle supplied by lost motor neurons: it becomes flaccid and weak, often asymmetrically, and wastes over time.");
  pill(ox, "Gut lymphoid tissue", 152, 224, 300, 288, "Gut associated lymphoid tissue, including Peyer patches: a main site where poliovirus multiplies before viraemia.");
  pill(ox, "Bulbar and breathing", 790, 292, 808, 238, "Bulbar involvement: brainstem motor nuclei for swallowing and airway control fail, and weak respiratory muscles can cause breathing failure.");
  const vac = pill(ox, "Vaccine prevention", 120, 200, 130, 338, "Prevention before exposure. Oral live vaccine gives strong gut immunity. Inactivated injected vaccine gives blood antibody that protects the nervous system."); vac.setAttribute("id", "vac-pill");
  const sup = pill(ox, "Supportive care", 575, 300, 560, 338, "Supportive care: protect the airway, swallowing, nutrition and limbs, treat complications and support weak muscles. It does not kill the virus."); sup.setAttribute("id", "sup-pill");
  const ven = pill(ox, "Ventilation", 809, 366, 808, 425, "Ventilation: a machine supports breathing when bulbar control or respiratory muscles fail. It buys time but does not restore lost neurons."); ven.setAttribute("id", "ven-pill");
}
const sm = { G: 0.6, V: 0.4, N: 0.1, P: 0.1, R: 0.1, At: 0, vacc: 0, sup: 0, vent: 0 };
const acc = { virus: 0, signal: 0, air: 0, ab: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["G", "V", "N", "P", "R", "At", "vacc", "sup", "vent"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  /* gut virus wanders in the lumen */
  const wantGut = Math.round(sm.G * gutVirus.length);
  gutVirus.forEach((b, i) => { const on = i < wantGut; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 8 * dt; b.y += Math.sin(b.a) * 8 * dt; b.x = clamp(b.x, 60, 208); b.y = clamp(b.y, 134, 170);
    b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")"); b.e.setAttribute("opacity", b.s.toFixed(2)); });
  lymph.forEach((c, i) => place(c.g, c.x, c.y + Math.sin(tm / 1100 + i) * 1.4, 0, 1 + 0.05 * sm.G * Math.sin(tm / 320 + i)));
  /* virus travels gut to lymphoid to blood to cord */
  acc.virus += dt * (2 + 9 * Math.max(sm.G, sm.V)); while (acc.virus >= 1) { acc.virus--; const p = free(virus); if (p) emit(p, 0, 0, 0, 0, 0); }
  const wantVirus = Math.round(clamp((sm.G + sm.V) / 1.6) * virus.length);
  virus.forEach((p, i) => { if (i >= wantVirus) { if (p.on) kill(p); return; } if (!p.on) emit(p, 0, 0, 0, 0, 0);
    p.u += dt * 0.055 * (0.5 + sm.V); if (p.u > 1) p.u = 0; const pt = virusTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); });
  /* antibody dots patrol the blood when vaccine prevention is chosen */
  acc.ab += dt * sm.vacc * 7; while (acc.ab >= 1) { acc.ab--; const p = free(ab); if (p) emit(p, rnd(278, 446), rnd(146, 214), rnd(14, 26), 0, 0); }
  ab.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; if (p.x > 450) p.x = 278; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", sm.vacc.toFixed(2)); if (p.t > 6) kill(p); });
  /* motor neurons shrink and fade as neuron loss rises; a few survive */
  neurons.forEach((n, i) => { const survives = i === 1 || i === 4; const loss = survives ? sm.N * 0.35 : sm.N; const s = clamp(1 - loss * 0.72, 0.22, 1); place(n.g, n.x, n.y, 0, s); n.g.style.opacity = (1 - loss * 0.55).toFixed(2); });
  /* motor signals run from cord to muscle, fading with paralysis */
  acc.signal += dt * (1 - sm.P * 0.75) * 7; while (acc.signal >= 1) { acc.signal--; const p = free(signal); if (p) emit(p, 0, 0, 0, 0, 0); }
  signal.forEach((p) => { if (!p.on) return; p.u += dt * 0.16 * (1 - sm.P * 0.6); if (p.u > 1) { kill(p); return; } const pt = signalTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); p.e.setAttribute("opacity", (1 - sm.P * 0.55).toFixed(2)); });
  /* muscle fibres thin: weak lower fibres thin most, and more as post-polio wasting rises */
  fibres.forEach((f) => { const thin = clamp(1 - sm.P * (f.weak ? 0.42 : 0.14) - sm.At * (f.weak ? 0.38 : 0.12), 0.3, 1); f.e.setAttribute("width", f1(168 * thin)); f.e.setAttribute("opacity", (0.45 + 0.55 * thin).toFixed(2)); });
  fibreCap.setAttribute("opacity", clamp(sm.P * 0.6 + sm.At).toFixed(2));
  /* breathing: lungs expand and the diaphragm moves; strain flattens the rhythm, ventilation steadies it */
  const steady = sm.vent, depth = clamp(1 - sm.R * 0.55 + steady * 0.35, 0.25, 1.2);
  const phase = Math.sin(tm / (steady > 0.4 ? 620 : 850));
  const lr = 1 + 0.1 * depth * phase, dy = 366 - 9 * depth * phase;
  lungL.setAttribute("transform", "translate(756 322) scale(" + lr.toFixed(3) + ") translate(-756 -322)");
  lungR.setAttribute("transform", "translate(862 322) scale(" + lr.toFixed(3) + ") translate(-862 -322)");
  diaph.setAttribute("d", "M724 " + f1(dy) + "Q809 " + f1(dy - 22 * depth) + " 894 " + f1(dy));
  brain.setAttribute("opacity", (0.45 + 0.55 * (1 - sm.N * 0.5)).toFixed(2));
  ventTube.setAttribute("opacity", sm.vent.toFixed(2));
  /* air particles move down the tube when ventilation supports breathing */
  acc.air += dt * (sm.vent * 8 + (1 - sm.R) * 2); while (acc.air >= 1) { acc.air--; const p = free(air); if (p) emit(p, 809 + rnd(-4, 4), 262, 0, rnd(38, 55), 0); }
  air.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 0.15; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(sm.vent + 0.25).toFixed(2)); if (p.y > 348) kill(p); });
  $("vac-pill").style.opacity = sm.vacc.toFixed(2); $("sup-pill").style.opacity = sm.sup.toFixed(2); $("ven-pill").style.opacity = sm.vent.toFixed(2);
  gg.vir.set(sm.G, wordOf(sm.G, 0.25, 0.65, ["cleared", "present", "high"])); gg.via.set(sm.V, wordOf(sm.V, 0.2, 0.45, ["none", "low", "present"])); gg.neur.set(sm.N, wordOf(sm.N, 0.3, 0.65, ["low", "some", "high"]));
  gg.par.set(sm.P, wordOf(sm.P, 0.25, 0.6, ["none", "some", "severe"])); gg.resp.set(sm.R, wordOf(sm.R, 0.25, 0.5, ["ok", "strained", "failing"]));
}
run({ init, step });
