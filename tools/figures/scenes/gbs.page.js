/* Guillain-Barre scene: mimicry, antibody attack, macrophage stripping, conduction block, treatment devices. */
const layers = { nodes: $("nodes"), nerve: $("nerve"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
const NERVE_Y = 300;
const nodeXs = [174, 286, 398, 510, 622, 738];
const targets = [[230, 270], [342, 270], [454, 270], [566, 270], [398, 290], [510, 290], [622, 290], [174, 290]];
const PLEX_IN = [724, 120];

/* trigger germ and plasma cell */
const germ = cell(layers.nodes, { cls: "germ", r: 27, nuc: 0.34, seed: 3, wob: 0.13 });
place(germ, 120, 135, 0, 1);
for (let j = 0; j < 7; j++) { const t = j / 7 * 6.283; mk("circle", { class: "gbs-gang", cx: f1(120 + Math.cos(t) * 29), cy: f1(135 + Math.sin(t) * 29), r: 3 }, layers.nodes); }
const plasma = cell(layers.nodes, { cls: "plasma", r: 26, nuc: 0.42, seed: 7, wob: 0.1 });
place(plasma, 330, 135, 0, 1);
const mac = cell(layers.cells, { cls: "macc", r: 24, nuc: 0.4, seed: 11, wob: 0.13 });

/* organs: heart, two lungs, muscle */
const heartO = organ($("heartSlot"), "heart", 600, 382, 72, {});
const lungLO = organ($("lungLSlot"), "lung", 688, 370, 76, {});
const lungRO = organ($("lungRSlot"), "lung", 784, 370, 76, { flip: true });
const muscleO = organ($("muscleSlot"), "muscle", 876, 300, 120, {});

/* IVIG drip: bag, fluid, drip line and tube to the nerve */
const ivG = mk("g", { opacity: "0" }, layers.nodes);
mk("rect", { class: "gbs-devbox", x: 796, y: 60, width: 72, height: 92, rx: 12 }, ivG);
mk("rect", { class: "gbs-ivliq", x: 801, y: 98, width: 62, height: 49, rx: 8 }, ivG);
mk("path", { class: "gbs-devline", d: "M832 152L832 168" }, ivG);
mk("path", { class: "gbs-vessel", d: "M832 168C760 176 690 200 640 232" }, ivG);
const drips = [];
for (let i = 0; i < 3; i++) drips.push(mk("circle", { class: "sc-p p-drip", r: 2.6, opacity: "0" }, ivG));

/* plasma exchange: pump, antibody filter with trapped dots, screen, tubes */
const plexG = mk("g", { opacity: "0" }, layers.nodes);
mk("rect", { class: "gbs-devbox", x: 716, y: 56, width: 188, height: 120, rx: 12 }, plexG);
mk("circle", { class: "gbs-devbox", cx: 752, cy: 116, r: 22 }, plexG);
const rotor = mk("path", { class: "gbs-pump", d: "M752 104L752 128" }, plexG);
mk("rect", { class: "gbs-filter", x: 792, y: 76, width: 48, height: 80, rx: 10 }, plexG);
mk("rect", { class: "gbs-screen", x: 848, y: 80, width: 48, height: 40, rx: 6 }, plexG);
mk("path", { class: "gbs-devline", d: "M854 100L862 100L868 92L876 108L884 96L890 100" }, plexG);
mk("path", { class: "gbs-vessel", d: "M500 258C580 230 640 170 716 122" }, plexG);
mk("path", { class: "gbs-vessel", d: "M830 176C820 215 740 245 660 258" }, plexG);
const trapped = [];
for (let i = 0; i < 12; i++) trapped.push(mk("circle", { class: "gbs-trap", cx: f1(804 + (i % 3) * 12), cy: f1(90 + Math.floor(i / 3) * 17), r: 4, opacity: "0.08" }, plexG));
const plexOut = track([[830, 176], [820, 215], [740, 245], [660, 258]]);

/* ventilator: box, pumping bellows, screen, circuit down to the lung */
const ventG = mk("g", { opacity: "0" }, layers.nodes);
mk("rect", { class: "gbs-devbox", x: 748, y: 56, width: 156, height: 100, rx: 12 }, ventG);
const belG = mk("g", {}, ventG);
mk("rect", { class: "gbs-screen", x: 762, y: 76, width: 62, height: 58, rx: 6 }, belG);
mk("path", { class: "gbs-folds", d: "M762 90L824 90M762 105L824 105M762 120L824 120" }, belG);
mk("rect", { class: "gbs-screen", x: 832, y: 76, width: 58, height: 40, rx: 6 }, ventG);
mk("path", { class: "gbs-devline", d: "M838 96L846 96L852 88L860 104L868 92L876 96L884 96" }, ventG);
const lungPort = lungRO.ports.trachea || lungRO.ports.in || [784, 320];
const ventTubeD = "M826 156C824 220 " + f1(lungPort[0] - 8) + " 262 " + f1(lungPort[0]) + " " + f1(lungPort[1]);
mk("path", { class: "gbs-vessel", d: ventTubeD }, ventG);
const ventTrack = track([[826, 156], [824, 220], [lungPort[0] - 8, 262], lungPort]);

/* IVIG blockers sitting on nerve receptors */
const blockG = mk("g", { opacity: "0" }, layers.cells);
const blockBase = nodeXs.map((nx) => [nx, 282]).concat([[238, 270], [574, 270]]);
blockBase.forEach((pt) => mk("circle", { class: "gbs-block", cx: f1(pt[0]), cy: f1(pt[1]), r: 4.2 }, blockG));

/* nerve: axon, myelin segments, nodes */
mk("rect", { class: "gbs-axon", x: 60, y: 292, width: 752, height: 16, rx: 8 }, layers.nerve);
const segX = [70, 182, 294, 406, 518, 630];
const segs = segX.map(function (sx, i) {
  const g = mk("g", {}, layers.nerve);
  const r = mk("rect", { class: "gbs-myelin", x: sx, y: 268, width: 96, height: 64, rx: 15 }, g);
  mk("ellipse", { class: "gbs-nuc", cx: sx + 48, cy: 300, rx: 10, ry: 6 }, g);
  return { g: g, r: r, x: sx, i: i, dmg: [0.45, 0.8, 1, 0.9, 0.65, 0.4][i] };
});
nodeXs.forEach(function (nx) {
  mk("circle", { class: "gbs-gang", cx: nx, cy: 291, r: 3 }, layers.nerve);
  mk("circle", { class: "gbs-gang", cx: nx, cy: 309, r: 3 }, layers.nerve);
});

/* particle pools; every item exposes its element as p.e */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, capped: false }; }); }
const abP = pool(26, function () { const g = mk("g", {}, layers.parts); mk("path", { class: "gbs-abpath", d: "M-4 -5L0 -1L4 -5M0 -1L0 5" }, g); return g; });
const compP = pool(22, function () { return mk("circle", { class: "gbs-comp", r: 3 }, layers.parts); });
const fragP = pool(18, function () { return mk("rect", { class: "gbs-frag", x: -4, y: -2.4, width: 8, height: 4.8, rx: 2 }, layers.parts); });
const sigP = pool(14, function () { return mk("circle", { class: "gbs-sig", r: 3.2 }, layers.parts); });
const airP = pool(14, function () { return mk("circle", { class: "sc-p p-air", r: 3 }, layers.parts); });
const cleanP = pool(10, function () { return mk("circle", { class: "sc-p p-clean", r: 3 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.capped = false; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

function capText(d) {
  if (d === 1) return "Ventilator breathes for the patient. The nerve attack goes on unchanged.";
  if (d === 2) return "IVIG caps harmful antibodies. More signals get through and strength returns.";
  if (d === 3) return "Plasma exchange washes out harmful antibodies. The nerve conducts again.";
  return "No treatment. Antibodies attack the nerve, signals block and muscles weaken.";
}

const gg = {};
let capEl = null, capDrug = -1;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [150, 330, 510, 690, 850];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["atk", "Attack", "g-atk", "Antibodies and complement binding myelin, nodes and axons after molecular mimicry. IVIG and plasma exchange lower this; ventilatory support does not."],
   ["myl", "Myelin loss", "g-myl", "How much myelin has been stripped by macrophages. Loss slows conduction and can block it. Remyelination during recovery restores speed."],
   ["cond", "Conduction", "g-cond", "Whether the nerve signal gets through. Demyelination slows and blocks conduction; axonal degeneration removes the signal until regrowth."],
   ["weak", "Weakness", "g-weak", "Flaccid ascending weakness with lost reflexes. Sensory symptoms can accompany the motor loss. Severe weakness threatens breathing."],
   ["bre", "Breathing", "g-bre", "Breathing when the diaphragm and chest muscles weaken. Ventilatory support holds this up while the nerve recovers."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Germ", 120, 135, 110, 70, "Trigger germ: an infection that often comes first. Its surface sugars look like nerve sugars.");
  pill(ox, "Plasma cell", 330, 135, 300, 70, "Plasma cell: makes antibodies. Some antibodies attack the nerve by mistake.");
  pill(ox, "Antibodies", 430, 215, 450, 178, "Antibodies plus complement: stick to myelin and nodes and call in the macrophage.");
  pill(ox, "Macrophage", 560, 222, 570, 150, "Macrophage: strips myelin in the common form. In other forms axons are hurt instead.");
  pill(ox, "Myelin", 230, 280, 230, 240, "Myelin: insulation made by Schwann cells. Lost myelin slows the signal.");
  pill(ox, "Node", 398, 300, 398, 348, "Node: gap where the signal is renewed. Attack here blocks conduction early.");
  pill(ox, "Muscle", 880, 300, 880, 348, "Muscle: weakens when signals fail. Weakness climbs up from the legs.");
  pill(ox, "Lungs", 784, 370, 736, 422, "Lungs: breathing fails when weakness reaches the chest. Support buys time.");
  capEl = mk("text", { class: "gbs-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { atk: 0.4, myelinLoss: 0.3, conduction: 0.7, weakness: 0.3, breathing: 0.8, csfProtein: 0.3, autonomic: 0.3, axonal: 0.1, recovery: 0.2, imm: 0, vent: 0, iv: 0, plex: 0, block: 0, trap: 0 };
const acc = { ab: 0, comp: 0, frag: 0, sig: 0, air: 0, clean: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.atk = lerp(sm.atk, m.atk, k2); sm.myelinLoss = lerp(sm.myelinLoss, m.myelinLoss, k2); sm.conduction = lerp(sm.conduction, m.conduction, k2);
  sm.weakness = lerp(sm.weakness, m.weakness, k2); sm.breathing = lerp(sm.breathing, m.breathing, k1); sm.csfProtein = lerp(sm.csfProtein, m.csfProtein, k2);
  sm.autonomic = lerp(sm.autonomic, m.autonomic, k2); sm.axonal = lerp(sm.axonal, m.axonal, k2); sm.recovery = lerp(sm.recovery, m.recovery, k2);
  sm.imm = lerp(sm.imm, m.imm, k1); sm.vent = lerp(sm.vent, m.vent, k1);
  sm.iv = lerp(sm.iv, m.rx === 2 ? 1 : 0, k1); sm.plex = lerp(sm.plex, m.rx === 3 ? 1 : 0, k1);
  sm.block = lerp(sm.block, m.rx === 2 ? 0.95 : 0, k1); sm.trap = lerp(sm.trap, m.rx === 3 ? 1 : 0, k1);
  place(germ, 120 + Math.sin(tm / 1400) * 2, 135 + Math.cos(tm / 1500) * 2, Math.sin(tm / 2000) * 5, 1);
  place(plasma, 330, 135 + Math.sin(tm / 1300 + 1) * 2, 0, 1 + 0.05 * sm.atk * Math.sin(tm / 300));
  place(mac, 560 + Math.sin(tm / 1600) * 3, 224 - 26 * sm.imm + Math.cos(tm / 1700) * 2, 0, 1 - 0.28 * sm.imm + 0.08 * sm.atk * Math.sin(tm / 320));
  ivG.setAttribute("opacity", sm.iv.toFixed(2));
  plexG.setAttribute("opacity", sm.plex.toFixed(2));
  ventG.setAttribute("opacity", sm.vent.toFixed(2));
  blockG.setAttribute("opacity", sm.block.toFixed(2));
  blockG.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 800) * 1.5) + ")");
  rotor.setAttribute("transform", "rotate(" + f1(tm / 8 % 360) + " 752 116)");
  const phase = 0.5 + 0.5 * Math.sin(tm / 700);
  belG.setAttribute("transform", "translate(762 134) scale(1 " + (1 - 0.38 * phase).toFixed(3) + ") translate(-762 -134)");
  const showTrap = Math.round(sm.trap * 12);
  trapped.forEach(function (d, i) { d.setAttribute("opacity", i < showTrap ? "0.95" : "0.08"); });
  drips.forEach(function (d, i) {
    const yy = 168 + ((tm / 28 + i * 9) % 26);
    d.setAttribute("cx", "832"); d.setAttribute("cy", f1(yy)); d.setAttribute("opacity", (sm.iv * 0.9).toFixed(2));
  });
  segs.forEach(function (s) {
    const loss = clamp(sm.myelinLoss * s.dmg + sm.axonal * 0.18 * s.dmg);
    const sy = 1 - loss * 0.55, sx = 1 - loss * 0.18;
    s.g.setAttribute("transform", "translate(" + f1(s.x + 48) + " 300) scale(" + sx.toFixed(3) + " " + sy.toFixed(3) + ") translate(" + f1(-(s.x + 48)) + " -300)");
    s.g.style.opacity = (1 - loss * 0.45).toFixed(2);
  });
  const weakPulse = 1 - sm.weakness * 0.22;
  place(muscleO.g, 876, 300, 0, weakPulse + 0.05 * sm.conduction * Math.sin(tm / 280));
  const beat = 1 + (0.06 + 0.1 * sm.autonomic) * Math.max(0, Math.sin(tm / (sm.autonomic > 0.55 ? 210 : 380)));
  place(heartO.g, 600, 382, 0, beat);
  const lungS = (0.92 + 0.1 * sm.breathing) * (1 + 0.3 * sm.vent * phase);
  place(lungLO.g, 688, 370, 0, lungS);
  place(lungRO.g, 784, 370, 0, lungS);
  /* antibodies from plasma cell to nerve targets, or into the filter when exchanged */
  acc.ab += dt * (0.4 + sm.atk * 7); while (acc.ab >= 1) { acc.ab--; const p = freeP(abP); if (p) { const toTrap = sm.trap > 0.05 && Math.random() < sm.trap * 0.65; emit(p, 330 + rnd(-10, 10), 162, 0, 0, toTrap ? 99 : Math.floor(Math.random() * targets.length)); } }
  const abSpeed = 62 * (1 - 0.45 * sm.block);
  abP.forEach(function (p) {
    if (!p.on) return;
    if (p.capped) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); return; }
    if (!p.capped && sm.block > 0.3 && Math.random() < dt * 1.4 * sm.block) { p.capped = true; p.t = 0; return; }
    const tg = p.k === 99 ? PLEX_IN : targets[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * abSpeed * dt; p.y += (dy / d) * abSpeed * dt; p.x = clamp(p.x, 24, 936); p.y = clamp(p.y, 54, 430);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.atan2(dy, dx) * 57.3 + 90) + ")"); if (d < 12) kill(p);
  });
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
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + NERVE_Y + ")"); if (p.k === 1 && p.x >= 398) kill(p); if (p.x > 812) kill(p); });
  /* ventilator airflow down the circuit into the lung */
  acc.air += dt * 9 * sm.vent; while (acc.air >= 1) { acc.air--; const p = freeP(airP); if (p) { emit(p, 0, 0, 0, 0, 0); p.tr = ventTrack; p.u = 0; } }
  airP.forEach(function (p) { if (!p.on) return; p.u += dt * 0.55; if (p.u >= 1) { kill(p); return; } const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* cleaned blood returning from the filter */
  acc.clean += dt * 7 * sm.trap; while (acc.clean >= 1) { acc.clean--; const p = freeP(cleanP); if (p) { emit(p, 0, 0, 0, 0, 0); p.tr = plexOut; p.u = 0; } }
  cleanP.forEach(function (p) { if (!p.on) return; p.u += dt * 0.45; if (p.u >= 1) { kill(p); return; } const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  gg.atk.set(sm.atk, wordOf(sm.atk, 0.3, 0.65, ["low", "active", "strong"]));
  gg.myl.set(sm.myelinLoss, wordOf(sm.myelinLoss, 0.3, 0.65, ["intact", "patchy", "stripped"]));
  gg.cond.set(sm.conduction, wordOf(sm.conduction, 0.34, 0.66, ["blocked", "slowed", "preserved"]));
  gg.weak.set(sm.weakness, wordOf(sm.weakness, 0.34, 0.66, ["mild", "moderate", "severe"]));
  gg.bre.set(sm.breathing, wordOf(sm.breathing, 0.38, 0.68, ["failing", "strained", "supported"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
