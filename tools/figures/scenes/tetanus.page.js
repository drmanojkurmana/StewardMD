/* Tetanus and botulism scene: toxin travel, inhibitory and ACh release, muscle tone, breathing and gauges. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), muscle: $("muscleG"), lungs: $("lungsG"), vent: $("ventG"), band: $("bandage") };
/* ---- tracks for toxin particles ---- */
const trkTet = track([[185, 300], [262, 236], [346, 180], [428, 148], [478, 144]]);
const trkBot = track([[185, 300], [320, 330], [500, 325], [620, 310], [658, 305]]);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, (_, i) => { const e = build(); e.setAttribute("opacity", "0"); return { e, u: i / n }; }); }
const toxP = pool(18, () => mk("circle", { class: "sc-p p-tox", r: 3 }, layers.parts));
const inhP = pool(10, () => mk("circle", { class: "sc-p p-inh", r: 2.4 }, layers.parts));
const achP = pool(12, () => mk("circle", { class: "sc-p p-ach", r: 2.4 }, layers.parts));
const abP = pool(8, () => mk("path", { class: "p-ab", d: "M0 0L0 -6M0 -6L-4 -10M0 -6L4 -10" }, layers.parts));
const airP = pool(8, () => mk("circle", { class: "sc-p p-air", r: 2.6 }, layers.parts));
/* ---- gauges ---- */
const gg = {};
let tetG, botG, antiPill, woundPill, ventPill, bactG, motorG;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [160, 360, 560, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["tox", "Toxin", "g-tox", "Free toxin still able to reach nerve endings. Antitoxin lowers this; wound care removes the source."], ["blk", "Target block", "g-blk", "How much toxin has blocked its target: inhibitory release in the cord in tetanus, acetylcholine release at the junction in botulism."], ["eff", "Muscle effect", "g-eff", "The result in muscle: rigidity and spasm in tetanus, weakness and floppiness in botulism."], ["br", "Breathing", "g-br", "Breathing when spasm or weakness reaches the chest and airway muscles. Ventilation supports it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Spores in wound", 85, 295, 100, 255, "Clostridium spores enter through a wound. In tetanus they germinate in the wound and release tetanospasmin; botulinum toxin usually arrives ready made and reaches nerve endings.");
  pill(ox, "Toxin", 240, 288, 240, 255, "Toxin made by the bacteria, or arriving in the blood. Free toxin can still be neutralised; toxin already inside a neuron cannot.");
  pill(ox, "Motor neuron", 570, 210, 610, 180, "The motor neuron runs from the spinal cord to the muscle. Tetanus toxin travels backwards along it; its cell body is driven hard when inhibition is lost.");
  pill(ox, "NMJ", 672, 289, 672, 240, "Neuromuscular junction: the nerve ending on the muscle. Botulinum toxin acts here and blocks acetylcholine release.");
  pill(ox, "Muscle", 800, 360, 800, 395, "Skeletal muscle, including the jaw. Locked jaw (lockjaw) is a classic early sign of tetanus; floppy weak muscles are the picture in botulism.");
  pill(ox, "Lungs", 762, 125, 790, 90, "Breathing muscles move the lungs. Spasm in tetanus or weakness in botulism can both make breathing fail.");
  tetG = mk("g", {}, ox); botG = mk("g", {}, ox);
  pill(tetG, "Retrograde travel", 300, 214, 270, 175, "Tetanospasmin is carried backwards (retrograde) inside the motor neuron, from the muscle end up to the spinal cord.");
  pill(tetG, "Inhibitory cell", 415, 127, 415, 84, "A small inhibitory interneuron in the spinal cord. It normally brakes the motor neuron using glycine and GABA.");
  pill(tetG, "Glycine + GABA", 458, 144, 460, 218, "Glycine and GABA are inhibitory transmitters. Tetanus toxin blocks their release, so the brake comes off and muscles lock in spasm.");
  pill(tetG, "Rigid muscle", 800, 250, 800, 215, "With no inhibitory brake the motor neuron fires unchecked: rigid, spastic muscle, including the jaw (lockjaw).");
  pill(botG, "Via blood", 300, 300, 270, 175, "Botulinum toxin spreads in the blood to nerve endings all over the body, including the neuromuscular junction.");
  pill(botG, "No ACh release", 665, 295, 590, 255, "Botulinum toxin blocks acetylcholine (ACh) release from the nerve ending, so the muscle gets no signal at all.");
  pill(botG, "Floppy muscle", 800, 250, 800, 215, "A muscle with no acetylcholine signal cannot contract: flaccid, weak, floppy paralysis, the opposite of tetanus.");
  antiPill = pill(ox, "Antitoxin", 240, 332, 240, 380, "Antitoxin antibodies mop up free toxin in the blood. They cannot reach toxin already bound or inside neurons.");
  woundPill = pill(ox, "Wound care", 115, 350, 110, 380, "Cleaning and removing dead tissue takes away the spores and their toxin source. Vaccine builds protection against future toxin.");
  ventPill = pill(ox, "Ventilator", 893, 118, 885, 90, "A ventilator breathes for the patient while nerve endings recover. It supports breathing but does not remove toxin.");
}
function initCells() {
  bactG = cell(layers.cells, { cls: "bact", r: 19, nuc: 0.35, seed: 3, wob: 0.12, x: 240, y: 310 });
  cell(layers.cells, { cls: "inhib", r: 17, nuc: 0.4, seed: 5, wob: 0.1, x: 415, y: 144 });
  motorG = cell(layers.cells, { cls: "motor", r: 19, nuc: 0.42, seed: 7, wob: 0.1, x: 495, y: 144 });
  cell(layers.cells, { cls: "bouton", r: 15, nuc: 0.3, seed: 9, wob: 0.1, x: 672, y: 305 });
}
const sm = { Free: 0.9, Block: 0.85, Effect: 0.85, Breath: 0.8, tet: 1, anti: 0, wound: 0, vent: 0 };
function init() { initCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.Free = lerp(sm.Free, m.Free, k); sm.Block = lerp(sm.Block, m.Block, k); sm.Effect = lerp(sm.Effect, m.Effect, k); sm.Breath = lerp(sm.Breath, m.Breath, k);
  sm.tet = lerp(sm.tet, m.tet, k); sm.anti = lerp(sm.anti, m.anti, k); sm.wound = lerp(sm.wound, m.wound, k); sm.vent = lerp(sm.vent, m.vent, k);
  tetG.setAttribute("opacity", sm.tet.toFixed(2)); botG.setAttribute("opacity", (1 - sm.tet).toFixed(2));
  antiPill.style.opacity = sm.anti.toFixed(2); woundPill.style.opacity = sm.wound.toFixed(2); ventPill.style.opacity = sm.vent.toFixed(2);
  layers.band.setAttribute("opacity", (sm.wound * 0.95).toFixed(2)); layers.vent.setAttribute("opacity", sm.vent.toFixed(2));
  /* toxin particles along the active track */
  const trk = sm.tet > 0.5 ? trkTet : trkBot;
  toxP.forEach((p, i) => { p.u += dt * 0.1 * (0.3 + sm.Free); if (p.u > 1) p.u -= 1; const q = trk.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.2 + 0.8 * sm.Free).toFixed(2)); });
  /* inhibitory transmitter: interneuron to motor neuron */
  const inhRate = sm.tet > 0.5 ? 1 - sm.Block : 0.92;
  inhP.forEach((p, i) => { p.u += dt * 0.55; if (p.u > 1) p.u -= 1; const x = lerp(434, 474, p.u); p.e.setAttribute("transform", "translate(" + f1(x) + " 144)"); p.e.setAttribute("opacity", i < inhRate * 10 ? "1" : "0"); });
  /* acetylcholine: bouton into muscle */
  const achRate = sm.tet > 0.5 ? clamp(0.35 + sm.Effect) : 1 - sm.Block;
  achP.forEach((p, i) => { p.u += dt * 0.7; if (p.u > 1) p.u -= 1; const x = lerp(688, 736, p.u), y = 305 + Math.sin(p.u * 6 + i) * 7; p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", i < achRate * 12 ? "1" : "0"); });
  /* antitoxin antibodies drift to the bacteria */
  abP.forEach((p, i) => { p.u += dt * 0.3; if (p.u > 1) p.u -= 1; const x = lerp(196, 232, p.u), y = lerp(258 + (i % 3) * 14, 300, p.u); p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(p.u * 80) + ")"); p.e.setAttribute("opacity", sm.anti.toFixed(2)); });
  /* ventilator air to the lungs */
  airP.forEach((p) => { p.u += dt * 0.8; if (p.u > 1) p.u -= 1; const x = lerp(860, 830, p.u); p.e.setAttribute("transform", "translate(" + f1(x) + " 145)"); p.e.setAttribute("opacity", sm.vent.toFixed(2)); });
  /* muscle: shake when rigid (tetanus), sag when floppy (botulism) */
  const shake = sm.tet * sm.Effect, sag = (1 - sm.tet) * sm.Effect;
  const mx = Math.sin(tm / 55) * 2.6 * shake, my = sag * 7 - shake * Math.abs(Math.sin(tm / 55)) * 1.5;
  layers.muscle.setAttribute("transform", "translate(" + f1(mx) + " " + f1(my) + ")");
  const brScale = 1 + 0.05 * Math.sin(tm / 620) * (1 - sm.Breath * 0.7) + 0.03 * sm.vent * Math.sin(tm / 620);
  layers.lungs.setAttribute("transform", "translate(792 150) scale(" + brScale.toFixed(3) + ") translate(-792 -150)");
  place(bactG, 240, 310, Math.sin(tm / 700) * 6, 1 + 0.04 * Math.sin(tm / 400));
  place(motorG, 495, 144, 0, 1 + (sm.tet * sm.Effect * 0.09) * Math.sin(tm / 160));
  /* gauges */
  gg.tox.set(sm.Free, wordOf(sm.Free, 0.3, 0.65, ["low", "present", "high"]));
  gg.blk.set(sm.Block, wordOf(sm.Block, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.eff.set(sm.Effect, sm.tet > 0.5 ? wordOf(sm.Effect, 0.3, 0.65, ["relaxed", "stiff", "rigid"]) : wordOf(sm.Effect, 0.3, 0.65, ["normal", "weak", "floppy"]));
  gg.br.set(1 - sm.Breath, wordOf(sm.Breath, 0.35, 0.65, ["comfortable", "strained", "failing"]));
}
run({ init, step });
