/* Polio scene: swallowed virus, gut replication, viraemia, cord cell loss, weak muscle and breathing. */
const WW = SC.W;
const layers = { gut: $("gutparts"), parts: $("parts"), neurons: $("neurons"), dyn: $("dyn"), over: $("over"), panel: $("panel") };
let bowelO = null, vesselO = null, muscleO = null, brainO = null, lungO = null;
let virusTrack = null, signalTrack = null, airX = 852, airY = 272;
let shieldEl = null, haloM = null, haloB = null, splintEl = null, ventTube = null, flowEl = null, glowEl = null, diaph = null;
let capEl = null, capDrug = -1;
function initOrgans() {
  const D = layers.dyn;
  bowelO = organ($("gutSlot"), "bowel", 134, 182, 150, {});
  vesselO = organ($("bloodSlot"), "vessel", 362, 185, 54, {});
  muscleO = organ($("muscleSlot"), "muscle", 808, 157, 190, {});
  brainO = organ($("brainSlot"), "brain", 742, 292, 84, {});
  lungO = organ($("lungSlot"), "lung", 852, 334, 100, {});
  const BP = bowelO.ports, VP = vesselO.ports, MP = muscleO.ports, LP = lungO.ports;
  glowEl = mk("ellipse", { class: "po-bglow", cx: 852, cy: 334, rx: 62, ry: 72, opacity: "0" }, D);
  shieldEl = mk("circle", { class: "po-shield", cx: 570, cy: 205, r: 36, opacity: "0" }, D);
  haloM = mk("rect", { class: "po-halo", x: 705, y: 104, width: 206, height: 106, rx: 16, opacity: "0" }, D);
  haloB = mk("rect", { class: "po-halo", x: 700, y: 254, width: 216, height: 152, rx: 16, opacity: "0" }, D);
  splintEl = mk("rect", { class: "po-splint", x: 730, y: 196, width: 160, height: 9, rx: 4.5, opacity: "0" }, D);
  ventTube = mk("path", { class: "po-tube", d: "M848 254 L848 272 M856 254 L856 272", opacity: "0" }, D);
  flowEl = mk("path", { class: "po-flow", d: "M852 272 L852 302", opacity: "0" }, D);
  diaph = mk("path", { class: "po-diaph", d: "M804 406 Q852 390 900 406" }, D);
  virusTrack = track([BP.coils, BP.out, [280, 230], VP.in, VP.out, [460, 232], [542, 205], [562, 205]]);
  signalTrack = track([[598, 190], [655, 180], [MP.in[0], MP.in[1] + 8], [MP.belly[0], MP.belly[1]]]);
  airX = LP.trachea[0]; airY = LP.trachea[1] + 4;
}
function capText(d) {
  if (d === 1) return "Supportive care protects swallowing and supports weak limbs. Daily life gets easier.";
  if (d === 2) return "Ventilation pushes air into the lungs. Breathing recovers.";
  if (d === 3) return "Vaccine antibodies trap the virus in the gut and blood. The cord stays safe.";
  return "No treatment. Virus reaches the cord nerves and muscles go weak.";
}
/* tracks are built in initOrgans from the bowel, vessel, muscle and lung ports (see above) */
/* gut lymphoid cells sit on the bowel coils; swallowed virus dots gather above them */
const lymph = [], gutVirus = [];
function initGut() {
  [[105, 175], [135, 190], [165, 178], [118, 210], [152, 212]].forEach(([x, y], i) => { const g = cell(layers.gut, { cls: "vircell", r: 11, nuc: 0.45, seed: i + 3, wob: 0.12 }); place(g, x, y, 0, 1); lymph.push({ g, x, y }); });
  for (let i = 0; i < 12; i++) { const e = mk("circle", { class: "sc-p p-virus", r: 3 }, layers.gut); gutVirus.push({ e, x: rnd(70, 200), y: rnd(118, 170), a: rnd(0, 6.28), s: 0 }); }
}
/* motor neurons in the anterior horn, on the cord column */
const neurons = [[560, 140], [586, 150], [558, 205], [588, 214], [560, 268], [587, 278]].map(([x, y], i) => { const g = cell(layers.neurons, { cls: "mot", r: 15, nuc: 0.42, seed: i * 2 + 5, wob: 0.14 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
/* particle pools: items expose their element as p.e */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, st: 0 }; }); }
const virus = pool(22, () => mk("circle", { class: "sc-p p-virus", r: 2.8 }, layers.parts));
const signal = pool(14, () => mk("circle", { class: "sc-p p-signal", r: 2.6 }, layers.parts));
const air = pool(16, () => mk("circle", { class: "sc-p p-air", r: 2.5 }, layers.parts));
const ab = pool(14, () => mk("circle", { class: "sc-p p-ab", r: 2.7 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 260, 430, 600, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vir", "Gut virus", "g-vir", "Poliovirus multiplying in the gut and gut lymphoid tissue after faecal oral spread. Vaccine prevention lowers this."], ["via", "Viraemia", "g-via", "Virus in the blood: the bridge from gut infection to invasion of the nervous system."], ["neur", "Neuron loss", "g-neur", "Anterior horn motor neurons destroyed in the spinal cord and brainstem. Lost neurons do not recover."], ["par", "Paralysis", "g-par", "Asymmetric flaccid weakness from lower motor neuron loss: low tone, weak or absent reflexes, sensation usually intact."], ["resp", "Breathing", "g-resp", "Breathing trouble from bulbar failure and weak respiratory muscles. Ventilation supports this, it does not restore neurons."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Swallowed virus", 115, 118, 105, 68, "Swallowed virus: poliovirus is swallowed, often from dirty hands, food or water, and reaches the gut.");
  pill(ox, "Gut", 137, 190, 245, 68, "Gut: the virus multiplies in gut lymphoid tissue. Vaccine antibodies trap it here before it spreads.");
  pill(ox, "Blood", 362, 130, 362, 68, "Blood: virus in the blood can carry infection to the nerves. Vaccine antibodies trap it here too.");
  pill(ox, "Cord cells", 570, 150, 576, 68, "Cord cells: motor nerves in the front of the spinal cord. When the virus kills them, muscles lose their signal.");
  pill(ox, "Muscle", 774, 155, 790, 68, "Muscle: without its nerve signal the muscle goes weak and floppy, often on one side, and wastes over time.");
  pill(ox, "Breathing", 852, 320, 852, 414, "Breathing: nerves for swallowing and the breathing muscles can fail. Ventilation pushes air into the lungs.");
  capEl = mk("text", { class: "po-capline", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { G: 0.6, V: 0.4, N: 0.1, P: 0.1, R: 0.1, At: 0, vacc: 0, sup: 0, vent: 0 };
const acc = { virus: 0, signal: 0, air: 0, ab: 0, trap: 0 };
function init() { initOrgans(); initGut(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.1);
  ["G", "V", "N", "P", "R", "At", "vacc", "sup", "vent"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  /* gut virus wanders above the bowel coils */
  const wantGut = Math.round(sm.G * gutVirus.length);
  gutVirus.forEach((b, i) => { const on = i < wantGut; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 8 * dt; b.y += Math.sin(b.a) * 8 * dt; b.x = clamp(b.x, 70, 200); b.y = clamp(b.y, 118, 170);
    b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")"); b.e.setAttribute("opacity", b.s.toFixed(2)); });
  lymph.forEach((c, i) => place(c.g, c.x, c.y + Math.sin(tm / 1100 + i) * 1.4, 0, 1 + 0.05 * sm.G * Math.sin(tm / 320 + i)));
  /* virus travels from the bowel coils through the vessel to the cord */
  acc.virus += dt * (2 + 9 * Math.max(sm.G, sm.V)); while (acc.virus >= 1) { acc.virus--; const p = free(virus); if (p) { emit(p, 0, 0, 0, 0, 0); p.u = 0; } }
  const wantVirus = Math.round(clamp((sm.G + sm.V) / 1.6) * virus.length);
  virus.forEach((p, i) => { if (i >= wantVirus) { if (p.on) kill(p); return; } if (!p.on) { emit(p, 0, 0, 0, 0, 0); p.u = Math.random(); }
    p.u += dt * 0.09 * (0.5 + sm.V); if (p.u > 1) p.u -= 1; const pt = virusTrack.at(p.u); p.x = pt.x; p.y = pt.y; p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); });
  /* vaccine antibodies patrol the vessel and trap virus particles they meet */
  acc.ab += dt * sm.vacc * 6; while (acc.ab >= 1) { acc.ab--; const p = free(ab); if (p) { emit(p, rnd(344, 380), rnd(120, 150), 0, rnd(18, 30), 0); p.st = 0; } }
  acc.trap += dt * sm.vacc * 3; while (acc.trap >= 1) { acc.trap--; const moving = virus.filter((q) => q.on); if (moving.length) { const v = moving[Math.floor(Math.random() * moving.length)]; const q = virusTrack.at(v.u); kill(v); const a = free(ab); if (a) { emit(a, q.x, q.y, rnd(-6, 6), rnd(4, 14), 0); a.st = 1; } } }
  ab.forEach((p) => { if (!p.on) return;
    if (p.st === 1) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (clamp(1.2 - p.t / 1.4) * sm.vacc).toFixed(2)); if (p.t > 1.6) kill(p); }
    else { p.y += p.vy * dt; if (p.y > 252) p.y = 124; p.x += Math.sin(tm / 400 + p.y) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", sm.vacc.toFixed(2)); p.t += dt; if (p.t > 8) kill(p); } });
  /* shield ring sits on the cord while vaccine antibodies protect it */
  shieldEl.setAttribute("opacity", sm.vacc.toFixed(2));
  /* motor neurons shrink and fade as neuron loss rises; a few survive */
  neurons.forEach((n) => { const survives = n.i === 1 || n.i === 4; const loss = survives ? sm.N * 0.35 : sm.N; const s = clamp(1 - loss * 0.72, 0.22, 1); place(n.g, n.x, n.y, 0, s); n.g.style.opacity = (1 - loss * 0.55).toFixed(2); });
  /* motor signals run from cord to muscle belly, fading with paralysis */
  acc.signal += dt * (1 - sm.P * 0.75) * 7; while (acc.signal >= 1) { acc.signal--; const p = free(signal); if (p) { emit(p, 0, 0, 0, 0, 0); p.u = 0; } }
  signal.forEach((p) => { if (!p.on) return; p.u += dt * 0.16 * (1 - sm.P * 0.6); if (p.u > 1) { kill(p); return; } const pt = signalTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); p.e.setAttribute("opacity", (1 - sm.P * 0.55).toFixed(2)); });
  /* muscle organ thins and dulls as paralysis and wasting rise */
  const thin = clamp(1 - sm.P * 0.28 - sm.At * 0.18, 0.55, 1);
  muscleO.g.setAttribute("transform", "translate(808 157) scale(1 " + thin.toFixed(3) + ") translate(-808 -157)");
  muscleO.g.style.opacity = (1 - 0.2 * sm.P).toFixed(2);
  /* brainstem dulls as neurons are lost */
  brainO.g.style.opacity = (1 - 0.35 * sm.N).toFixed(2);
  /* supportive care shows as halos on muscle and breathing plus a limb splint */
  haloM.setAttribute("opacity", sm.sup.toFixed(2)); haloB.setAttribute("opacity", sm.sup.toFixed(2)); splintEl.setAttribute("opacity", sm.sup.toFixed(2));
  /* breathing: lungs expand and the diaphragm moves; strain flattens the rhythm, ventilation steadies it */
  const steady = sm.vent, depth = clamp(1 - sm.R * 0.55 + steady * 0.35, 0.25, 1.2);
  const phase = Math.sin(tm / (steady > 0.4 ? 620 : 850));
  const lr = 1 + 0.08 * depth * phase, dy = 406 - 8 * depth * phase;
  lungO.g.setAttribute("transform", "translate(852 334) scale(" + lr.toFixed(3) + ")");
  diaph.setAttribute("d", "M804 " + f1(dy) + " Q852 " + f1(dy - 16 * depth) + " 900 " + f1(dy));
  glowEl.setAttribute("opacity", (sm.vent * 0.3).toFixed(2));
  ventTube.setAttribute("opacity", sm.vent.toFixed(2));
  flowEl.setAttribute("opacity", (sm.vent * 0.8).toFixed(2));
  /* air particles move down the tube into the lungs when ventilation supports breathing */
  acc.air += dt * (sm.vent * 8 + (1 - sm.R) * 2); while (acc.air >= 1) { acc.air--; const p = free(air); if (p) emit(p, airX + rnd(-4, 4), airY, 0, rnd(38, 55), 0); }
  air.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x + Math.sin(tm / 300 + p.y) * 0.15, 810, 895); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(sm.vent + 0.25).toFixed(2)); if (p.y > 390) kill(p); });
  gg.vir.set(sm.G, wordOf(sm.G, 0.25, 0.65, ["cleared", "present", "high"])); gg.via.set(sm.V, wordOf(sm.V, 0.2, 0.45, ["none", "low", "present"])); gg.neur.set(sm.N, wordOf(sm.N, 0.3, 0.65, ["low", "some", "high"]));
  gg.par.set(sm.P, wordOf(sm.P, 0.25, 0.6, ["none", "some", "severe"])); gg.resp.set(sm.R, wordOf(sm.R, 0.25, 0.5, ["ok", "strained", "failing"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
