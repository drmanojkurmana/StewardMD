/* Guillain-Barre scene: mimicry, antibodies and complement, macrophage stripping, conduction block and recovery. */
const layers = { nodes: $("nodes"), nerve: $("nerve"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
const NERVE_Y = 300;
const targets = [[230, 270], [342, 270], [454, 270], [566, 270], [398, 290], [510, 290], [622, 290], [174, 290]];

/* trigger germ and plasma cell */
const germ = cell(layers.nodes, { cls: "germ", r: 27, nuc: 0.34, seed: 3, wob: 0.13 });
place(germ, 120, 135, 0, 1);
for (let j = 0; j < 7; j++) { const t = j / 7 * 6.283; mk("circle", { class: "gbs-gang", cx: f1(120 + Math.cos(t) * 29), cy: f1(135 + Math.sin(t) * 29), r: 3 }, layers.nodes); }
const plasma = cell(layers.nodes, { cls: "plasma", r: 26, nuc: 0.42, seed: 7, wob: 0.1 });
place(plasma, 330, 135, 0, 1);
const mac = cell(layers.cells, { cls: "macc", r: 24, nuc: 0.4, seed: 11, wob: 0.13 });
place(mac, 560, 224, 0, 1);

/* spinal fluid tube: many protein dots, very few cells */
const protG = mk("g", {}, layers.nodes);
mk("rect", { class: "gbs-tube", x: 802, y: 96, width: 58, height: 82, rx: 9 }, layers.nodes);
mk("rect", { class: "gbs-csf", x: 806, y: 118, width: 50, height: 56, rx: 6 }, layers.nodes);
for (let j = 0; j < 14; j++) mk("circle", { class: "gbs-prot", cx: f1(814 + (j % 5) * 9), cy: f1(126 + Math.floor(j / 5) * 14), r: 2.6 }, protG);
mk("circle", { class: "gbs-celldot", cx: 822, cy: 162, r: 3.4 }, layers.nodes);
mk("circle", { class: "gbs-celldot", cx: 842, cy: 156, r: 3.4 }, layers.nodes);

/* nerve: axon, myelin segments, nodes */
mk("rect", { class: "gbs-axon", x: 60, y: 292, width: 772, height: 16, rx: 8 }, layers.nerve);
const segStarts = [70, 182, 294, 406, 518, 630];
const segs = segStarts.map(function (sx, i) {
  const g = mk("g", {}, layers.nerve);
  const r = mk("rect", { class: "gbs-myelin", x: sx, y: 268, width: 96, height: 64, rx: 15 }, g);
  mk("ellipse", { class: "gbs-nuc", cx: sx + 48, cy: 300, rx: 10, ry: 6 }, g);
  return { g: g, r: r, x: sx, i: i, dmg: [0.45, 0.8, 1, 0.9, 0.65, 0.4][i] };
});
[174, 286, 398, 510, 622, 738].forEach(function (nx) {
  mk("circle", { class: "gbs-gang", cx: nx, cy: 291, r: 3 }, layers.nerve);
  mk("circle", { class: "gbs-gang", cx: nx, cy: 309, r: 3 }, layers.nerve);
});

/* muscle, heart, lungs */
const muscleG = mk("g", {}, layers.nodes);
mk("rect", { class: "gbs-muscle", x: 830, y: 272, width: 68, height: 56, rx: 13 }, muscleG);
[282, 292, 302, 312].forEach(function (yy) { mk("path", { class: "gbs-musline", d: "M836 " + yy + "C852 " + (yy - 4) + " 876 " + (yy + 4) + " 892 " + yy }, muscleG); });
const heartG = mk("g", {}, layers.nodes);
mk("path", { class: "gbs-heart", d: "M0 10C-16 -4 -10 -18 0 -9C10 -18 16 -4 0 10Z" }, heartG);
place(heartG, 650, 382, 0, 1.5);
const lungL = mk("ellipse", { class: "gbs-lung", cx: 736, cy: 384, rx: 19, ry: 25 }, layers.nodes);
const lungR = mk("ellipse", { class: "gbs-lung", cx: 786, cy: 384, rx: 19, ry: 25 }, layers.nodes);
const ventG = mk("g", { opacity: "0" }, layers.nodes);
mk("rect", { class: "gbs-ventbox", x: 818, y: 360, width: 34, height: 26, rx: 6 }, ventG);
mk("path", { class: "gbs-vent", d: "M818 373C806 373 800 378 794 382" }, ventG);

/* particle pools; every item exposes its element as p.e */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const abP = pool(26, function () { const g = mk("g", {}, layers.parts); mk("path", { class: "gbs-abpath", d: "M-4 -5L0 -1L4 -5M0 -1L0 5" }, g); return g; });
const compP = pool(22, function () { return mk("circle", { class: "gbs-comp", r: 3 }, layers.parts); });
const fragP = pool(18, function () { return mk("rect", { class: "gbs-frag", x: -4, y: -2.4, width: 8, height: 4.8, rx: 2 }, layers.parts); });
const sigP = pool(14, function () { return mk("circle", { class: "gbs-sig", r: 3.2 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [150, 330, 510, 690, 850];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["atk", "Attack", "g-atk", "Antibodies and complement binding myelin, nodes and axons after molecular mimicry. IVIG and plasma exchange lower this; ventilatory support does not."],
   ["myl", "Myelin loss", "g-myl", "How much myelin has been stripped by macrophages. Loss slows conduction and can block it. Remyelination during recovery restores speed."],
   ["cond", "Conduction", "g-cond", "Whether the nerve signal gets through. Demyelination slows and blocks conduction; axonal degeneration removes the signal until regrowth."],
   ["weak", "Weakness", "g-weak", "Flaccid ascending weakness with areflexia (lost reflexes). Sensory symptoms can accompany the motor loss. Severe weakness threatens breathing."],
   ["bre", "Breathing", "g-bre", "Breathing when the diaphragm and chest muscles weaken. Ventilatory support holds this up while the nerve recovers. Autonomic instability can also disturb heart rhythm."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Germ", 120, 108, 120, 78, "Trigger germ: an infection that often comes before Guillain-Barre syndrome. Its surface sugars can resemble nerve gangliosides.");
  pill(ox, "Mimicry", 225, 135, 225, 78, "Molecular mimicry: microbial sugars resemble gangliosides on axons and myelin, so the immune reply cross reacts with peripheral nerve.");
  pill(ox, "Plasma cell", 330, 109, 330, 78, "Plasma cell making antibodies. In Guillain-Barre syndrome some antibodies bind nodes, paranodal NF155, myelin or axons and activate complement.");
  pill(ox, "Spinal fluid", 830, 96, 830, 64, "Spinal fluid: raised protein with few white cells, called albuminocytological dissociation. Little or no pleocytosis. Protein can be normal early.");
  pill(ox, "Antibodies", 430, 214, 450, 178, "Antibodies binding myelin, nodes of Ranvier and axons. Binding activates complement and marks the nerve for macrophage attack.");
  pill(ox, "Complement", 650, 246, 690, 178, "Complement fixed by bound antibody. It injures Schwann cell and axon membranes and helps recruit macrophages to strip myelin.");
  pill(ox, "Macrophage", 560, 200, 570, 150, "Macrophage stripping myelin in the demyelinating form. In motor axonal forms the attack at nodes injures axons instead, with slower recovery.");
  pill(ox, "Myelin", 230, 268, 230, 238, "Myelin made by Schwann cells. Demyelination exposes the axon, slows conduction and can cause conduction block and flaccid weakness.");
  pill(ox, "Axon", 120, 300, 120, 348, "Axon carrying the motor signal. Sensory axons run in the same nerve. Axonal degeneration in AMAN and AMSAN recovers slowly by regrowth.");
  pill(ox, "Node", 398, 300, 398, 348, "Node of Ranvier: the gap between myelin segments where the signal renews. Antibody and complement binding here, including at NF155, can block conduction early.");
  pill(ox, "Muscle", 864, 328, 864, 348, "Muscle that weakens when conduction blocks or axons degenerate. Weakness ascends, reflexes fade, and severe disease can reach the breathing muscles.");
  pill(ox, "Heart", 650, 396, 650, 422, "Autonomic involvement can swing heart rate and blood pressure. This is part of severe Guillain-Barre syndrome and needs monitoring.");
  pill(ox, "Lungs", 760, 396, 760, 422, "Lungs and diaphragm. Respiratory failure is the feared severe step. Ventilatory support breathes for the patient while recovery happens.");
}
const sm = { atk: 0.4, myelinLoss: 0.3, conduction: 0.7, weakness: 0.3, breathing: 0.8, csfProtein: 0.3, autonomic: 0.3, axonal: 0.1, recovery: 0.2, imm: 0, vent: 0 };
const acc = { ab: 0, comp: 0, frag: 0, sig: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.atk = lerp(sm.atk, m.atk, k2); sm.myelinLoss = lerp(sm.myelinLoss, m.myelinLoss, k2); sm.conduction = lerp(sm.conduction, m.conduction, k2);
  sm.weakness = lerp(sm.weakness, m.weakness, k2); sm.breathing = lerp(sm.breathing, m.breathing, k1); sm.csfProtein = lerp(sm.csfProtein, m.csfProtein, k2);
  sm.autonomic = lerp(sm.autonomic, m.autonomic, k2); sm.axonal = lerp(sm.axonal, m.axonal, k2); sm.recovery = lerp(sm.recovery, m.recovery, k2);
  sm.imm = lerp(sm.imm, m.imm, k1); sm.vent = lerp(sm.vent, m.vent, k1);
  place(germ, 120 + Math.sin(tm / 1400) * 2, 135 + Math.cos(tm / 1500) * 2, Math.sin(tm / 2000) * 5, 1);
  place(plasma, 330, 135 + Math.sin(tm / 1300 + 1) * 2, 0, 1 + 0.05 * sm.atk * Math.sin(tm / 300));
  protG.style.opacity = (0.2 + 0.8 * sm.csfProtein).toFixed(2);
  place(mac, 560 + Math.sin(tm / 1600) * 3, 224 + Math.cos(tm / 1700) * 2, 0, 1 - 0.25 * sm.imm + 0.08 * sm.atk * Math.sin(tm / 320));
  segs.forEach(function (s) {
    const loss = clamp(sm.myelinLoss * s.dmg + sm.axonal * 0.18 * s.dmg);
    const sy = 1 - loss * 0.55, sx = 1 - loss * 0.18;
    s.g.setAttribute("transform", "translate(" + f1(s.x + 48) + " 300) scale(" + sx.toFixed(3) + " " + sy.toFixed(3) + ") translate(" + f1(-(s.x + 48)) + " -300)");
    s.g.style.opacity = (1 - loss * 0.45).toFixed(2);
  });
  const weakPulse = 1 - sm.weakness * 0.25;
  muscleG.setAttribute("transform", "translate(864 300) scale(" + (weakPulse + 0.03 * Math.sin(tm / 420)).toFixed(3) + ") translate(-864 -300)");
  const beat = 1 + (0.06 + 0.1 * sm.autonomic) * Math.max(0, Math.sin(tm / (sm.autonomic > 0.55 ? 210 : 380)));
  place(heartG, 650, 382, 0, 1.5 * beat);
  const br = (0.82 + 0.2 * sm.breathing) * (1 + 0.07 * sm.breathing * Math.sin(tm / 700));
  lungL.setAttribute("transform", "translate(736 384) scale(" + br.toFixed(3) + ") translate(-736 -384)");
  lungR.setAttribute("transform", "translate(786 384) scale(" + br.toFixed(3) + ") translate(-786 -384)");
  ventG.setAttribute("opacity", sm.vent.toFixed(2));
  /* antibodies from plasma cell to nerve targets */
  acc.ab += dt * sm.atk * 7; while (acc.ab >= 1) { acc.ab--; const p = freeP(abP); if (p) emit(p, 330 + rnd(-10, 10), 162, 0, 0, Math.floor(Math.random() * targets.length)); }
  abP.forEach(function (p) { if (!p.on) return; const tg = targets[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.x = clamp(p.x, 24, 936); p.y = clamp(p.y, 54, 430);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.atan2(dy, dx) * 57.3 + 90) + ")"); if (d < 12) kill(p); });
  /* complement falling onto myelin and nodes */
  acc.comp += dt * sm.atk * 8; while (acc.comp >= 1) { acc.comp--; const p = freeP(compP); if (p) emit(p, rnd(90, 720), 240, rnd(-3, 3), rnd(22, 34), 0); }
  compP.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 24, 936); p.y = clamp(p.y, 54, 430);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 268) kill(p); });
  /* myelin fragments shed from damaged segments */
  acc.frag += dt * sm.myelinLoss * 5; while (acc.frag >= 1) { acc.frag--; const p = freeP(fragP); if (p) { const s = pick(segs); emit(p, s.x + rnd(14, 82), 264, rnd(-14, 14), rnd(-24, -12), 0); } }
  fragP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 24, 936); p.y = clamp(p.y, 54, 430);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y < 120) kill(p); });
  /* signal pulses along the axon; many block at the damaged node */
  acc.sig += dt * (1.2 + sm.conduction * 3.2); while (acc.sig >= 1) { acc.sig--; const p = freeP(sigP); if (p) emit(p, 66, NERVE_Y, 0, 0, Math.random() < (1 - sm.conduction) ? 1 : 0); }
  sigP.forEach(function (p) { if (!p.on) return; p.x += (46 + 120 * sm.conduction) * dt; p.x = clamp(p.x, 24, 936);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + NERVE_Y + ")"); if (p.k === 1 && p.x >= 398) kill(p); if (p.x > 828) kill(p); });
  gg.atk.set(sm.atk, wordOf(sm.atk, 0.3, 0.65, ["low", "active", "strong"]));
  gg.myl.set(sm.myelinLoss, wordOf(sm.myelinLoss, 0.3, 0.65, ["intact", "patchy", "stripped"]));
  gg.cond.set(sm.conduction, wordOf(sm.conduction, 0.34, 0.66, ["blocked", "slowed", "preserved"]));
  gg.weak.set(sm.weakness, wordOf(sm.weakness, 0.34, 0.66, ["mild", "moderate", "severe"]));
  gg.bre.set(sm.breathing, wordOf(sm.breathing, 0.38, 0.68, ["failing", "strained", "supported"]));
}
run({ init, step });
