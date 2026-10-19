/* Snake scene: bite in skin, venom spread to nerve and blood, blocked signal, clotting use and bleeding. */
const layers = { dyn: $("dyn"), recs: $("recs"), blocks: $("blockMarks"), stuck: $("stuckV"), platelets: $("platelets"), clotG: $("clotG"), rbcs: $("rbcs2"), parts: $("parts"), over: $("over"), panel: $("panel"), swell: $("swell"), nec: $("necrosis"), splT: $("splintTop"), splB: $("splintBot"), tube: $("ventTube") };
let skinO = null, gangO = null, muscleO = null, vesselO = null;
let trNerve = null, trBlood = null, trVessel = null;
let shieldEl = null, glowEl = null, capEl = null, capDrug = -1;
const MUSC = [470, 352];
const REC_X = [415, 448, 480, 512, 544], REC_Y = 268;
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 160, 262, 150, {});
  gangO = organ($("gangSlot"), "ganglion", 470, 165, 115, {});
  muscleO = organ($("muscleSlot"), "muscle", 470, 352, 205, {});
  vesselO = organ($("vesselSlot"), "vessel", 790, 235, 100, {});
  const SP = skinO.ports, GP = gangO.ports, VP = vesselO.ports;
  const bite = SP.dermis || [157, 270];
  trNerve = track([bite, [220, 280], [310, 240], [360, 200], GP.in, [GP.soma[0], GP.soma[1]]]);
  trBlood = track([bite, [230, 310], [360, 368], [560, 388], [700, 382], [745, 352], [790, 320], [790, 220], [790, 130]]);
  trVessel = track([VP.in, [VP.in[0], (VP.in[1] + VP.out[1]) / 2], VP.out]);
  shieldEl = mk("circle", { class: "sn-shield", cx: bite[0], cy: bite[1], r: 75, opacity: "0" }, layers.dyn);
  glowEl = mk("ellipse", { class: "sn-mglow", cx: MUSC[0], cy: MUSC[1], rx: 125, ry: 62, opacity: "0" }, layers.dyn);
  layers.tube.setAttribute("opacity", "0");
}
function capText(d) {
  if (d === 1) return "Ventilation breathes for the patient and transfusion replaces clotting factors.";
  if (d === 2) return "Antivenom traps venom in the blood. Nerves and clotting recover.";
  return "The limb is kept still, but venom spreads to nerves and blood.";
}
/* tracks are built in initOrgans from the skin, ganglion, muscle and vessel ports (see above) */
/* ---- receptors, block marks and stuck venom on the receptors ---- */
const stuckDots = [];
function initRecs() {
  REC_X.forEach((x) => { mk("rect", { class: "sn-rec", x: x - 7, y: REC_Y, width: 14, height: 12, rx: 3 }, layers.recs); });
  REC_X.forEach((x) => { const g = mk("g", { transform: "translate(" + x + " " + (REC_Y + 6) + ")" }, layers.blocks); mk("path", { class: "sn-block", d: "M-6 -6L6 6M6 -6L-6 6" }, g); });
  layers.blocks.setAttribute("opacity", "0");
  [REC_X[0], REC_X[2], REC_X[4]].forEach((x) => { stuckDots.push(mk("path", { class: "sc-p sn-venom", d: "M0 -4L3.4 0L0 4L-3.4 0Z", transform: "translate(" + x + " " + (REC_Y + 6) + ")", opacity: "0" }, layers.stuck)); });
}
/* ---- platelets wandering the vessel, clots growing, red cells flowing through ---- */
const plats = [];
function initCells() {
  for (let i = 0; i < 6; i++) { const g = cell(layers.platelets, { cls: "plt", r: 6, seed: i + 3, wob: 0.15, n: 7 }); plats.push({ g, x: rnd(752, 828), y: rnd(130, 340), a: rnd(0, 6.28) }); }
}
const clotGroups = [[772, 195], [808, 292]].map(([x, y], i) => {
  const g = mk("g", {}, layers.clotG);
  for (let j = 0; j < 5; j++) cell(g, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.4) * 9, y: Math.sin(j * 2) * 6, seed: j + i * 4, wob: 0.15, n: 7 });
  for (let j = 0; j < 4; j++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) + "L" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) }, g);
  return { g, x, y };
});
const vesselRbcs = [];
function initRbcs() { for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); vesselRbcs.push({ g, u: i / 10, v: rnd(0.8, 1.2) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, sc: 1, st: 0, tgt: null }; }); }
const venom = pool(26, () => mk("path", { class: "sc-p sn-venom", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const ach = pool(18, () => mk("circle", { class: "sn-ach", r: 2.4 }, layers.parts));
const bleed = pool(18, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const asvAb = pool(14, () => mk("path", { class: "sn-asvP", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, layers.parts));
const airP = pool(10, () => mk("circle", { class: "sn-airP", r: 3 }, layers.parts));
const transf = pool(12, () => mk("circle", { class: "sc-p sn-trans", r: 2.8 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.tr = null; p.sc = 1; p.st = 0; p.tgt = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.tr = null; p.tgt = null; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges and the plain language caption ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["local", "Local damage", "g-bad", "Swelling, tissue injury and necrosis at and around the bite."], ["spread", "Venom spread", "g-cyt", "Venom leaving the bite site in lymph and blood. A still limb slows this."], ["muscle", "Muscle power", "g-good", "How well muscle still answers nerve signals. Blocked receptors weaken it."], ["breath", "Breathing", "g-good", "Breathing as the breathing muscles weaken. Ventilation can support it."], ["use", "Factor use", "g-clot", "Clotting factors and platelets used up as venom switches clotting on."], ["bleed", "Bleeding", "g-bad", "Bleeding once clotting factors and platelets have been consumed. Transfusion replaces them."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bite", 160, 202, 225, 105, "Bite wound. Venom from the fangs sits in the skin, then moves in lymph and blood.");
  pill(ox, "Nerve", 410, 165, 400, 100, "Nerve ending. Venom arriving in blood and lymph reaches the nerve ending.");
  pill(ox, "Blocked signal", 512, 274, 575, 130, "Blocked receptors. Venom sits on muscle receptors, so the nerve signal cannot pass.");
  pill(ox, "Muscle", 560, 360, 600, 352, "Muscle. Without its signal the muscle goes limp, and breathing muscles can fail.");
  pill(ox, "Blood vessel", 790, 112, 790, 92, "Blood vessel. Red cells, platelets and clotting factors travel here.");
  pill(ox, "Clots", 772, 195, 895, 150, "Clots. Venom switches clotting on everywhere and uses up factors and platelets.");
  pill(ox, "Bleeding", 790, 364, 790, 408, "Bleeding. Once factors are used up the blood cannot clot, so bleeding follows.");
  capEl = mk("text", { class: "sn-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { Local: 0.3, Spread: 0.3, NeuroBlock: 0.3, Muscle: 0.7, Breath: 0.8, Consume: 0.1, Bleed: 0, ClotAct: 0.1, imm: 1, sup: 0, asv: 0 };
const acc = { venom: 0, ach: 0, bleed: 0, asv: 0, air: 0, transf: 0 };
let venomAlt = 0;
function init() { initOrgans(); initRecs(); initCells(); initRbcs(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Local = lerp(sm.Local, m.Local, k2); sm.Spread = lerp(sm.Spread, m.Spread, k2); sm.NeuroBlock = lerp(sm.NeuroBlock, m.NeuroBlock, k2);
  sm.Muscle = lerp(sm.Muscle, m.Muscle, k2); sm.Breath = lerp(sm.Breath, m.Breath, k1); sm.Consume = lerp(sm.Consume, m.Consume, k2);
  sm.Bleed = lerp(sm.Bleed, m.Bleed, k2); sm.ClotAct = lerp(sm.ClotAct, m.ClotAct, k2);
  sm.imm = lerp(sm.imm, m.imm, k1); sm.sup = lerp(sm.sup, m.sup, k1); sm.asv = lerp(sm.asv, m.asv, k1);
  /* bite: swelling and necrosis grow with local damage, splints show a still limb */
  const ns = 0.25 + sm.Local * 1.6;
  layers.nec.setAttribute("transform", "translate(157 270) scale(" + ns.toFixed(3) + ") translate(-157 -270)");
  layers.nec.setAttribute("opacity", (0.2 + 0.8 * sm.Local).toFixed(2));
  const ss = 0.65 + sm.Local * 0.55;
  layers.swell.setAttribute("transform", "translate(157 270) scale(" + ss.toFixed(3) + ") translate(-157 -270)");
  layers.swell.setAttribute("opacity", (sm.Local * 0.75).toFixed(2));
  layers.splT.style.opacity = (0.45 + 0.3 * sm.imm).toFixed(2); layers.splB.style.opacity = (0.45 + 0.3 * sm.imm).toFixed(2);
  shieldEl.setAttribute("opacity", (sm.asv * 0.9).toFixed(2));
  /* muscle twitches while it still answers, and glows with each machine breath under ventilation */
  const sx = 1 + 0.028 * sm.Muscle * Math.sin(tm / 300);
  muscleO.g.setAttribute("transform", "translate(" + MUSC[0] + " " + MUSC[1] + ") scale(" + sx.toFixed(3) + " 1) translate(" + (-MUSC[0]) + " " + (-MUSC[1]) + ")");
  muscleO.g.style.opacity = (1 - 0.12 * (1 - sm.Muscle)).toFixed(2);
  glowEl.setAttribute("opacity", (sm.sup * (0.12 + 0.16 * (0.5 + 0.5 * Math.sin(tm / 620)))).toFixed(2));
  layers.tube.setAttribute("opacity", sm.sup.toFixed(2));
  /* receptors blocked while venom sits on them, and the signal chemical fades with the block */
  layers.blocks.setAttribute("opacity", sm.NeuroBlock.toFixed(2));
  stuckDots.forEach((e) => { e.setAttribute("opacity", sm.NeuroBlock.toFixed(2)); });
  /* vessel: platelets are consumed unless replaced, clots grow, red cells keep flowing */
  const dep = sm.Consume * (sm.sup > 0.4 ? 0.2 : 1) * (sm.asv > 0.4 ? 0.55 : 1);
  plats.forEach((pl, i) => { pl.a += rnd(-1.2, 1.2) * dt; pl.x += Math.cos(pl.a) * 10 * dt; pl.y += Math.sin(pl.a) * 10 * dt;
    if (pl.x < 752 || pl.x > 828) pl.a = Math.PI - pl.a; if (pl.y < 130 || pl.y > 340) pl.a = -pl.a;
    pl.x = clamp(pl.x, 752, 828); pl.y = clamp(pl.y, 130, 340);
    place(pl.g, pl.x, pl.y, Math.sin(tm / 700 + i) * 20, 1); pl.g.style.opacity = (1 - dep * 0.8).toFixed(2); });
  clotGroups.forEach((c) => { const s = clamp((sm.ClotAct - 0.08) * 1.5); place(c.g, c.x, c.y, 0, 0.1 + 0.9 * s); c.g.style.opacity = s > 0.04 ? 1 : 0; });
  const flow = clamp(0.3 + 0.8 * sm.Breath) * (1 - 0.35 * sm.ClotAct);
  vesselRbcs.forEach((r) => { r.u += dt * 0.13 * (0.35 + flow) * r.v; if (r.u > 1) r.u -= 1; const q = trVessel.at(r.u);
    place(r.g, q.x + Math.sin(tm / 500 + r.u * 40) * 10, q.y, Math.sin(tm / 500 + r.u * 40) * 8, 1); });
  /* venom leaves the bite along the nerve and blood tracks */
  acc.venom += dt * (1 + 7 * sm.Spread);
  while (acc.venom >= 1) { acc.venom--; const p = free(venom); if (p) { venomAlt = 1 - venomAlt; emit(p, 0, 0, 0, 0, venomAlt); p.u = 0; const q = (p.k ? trBlood : trNerve).at(0); p.x = q.x; p.y = q.y; } }
  venom.forEach((p) => { if (!p.on) return;
    if (p.tr) { p.t += dt; const s = Math.max(0.05, 1 - p.t * 1.3);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + s.toFixed(2) + ")"); if (p.t > 0.85) kill(p); return; }
    p.u += dt * 0.11 * (0.45 + sm.Spread); const q = (p.k ? trBlood : trNerve).at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.u >= 1) kill(p); });
  /* signal chemical falls from the nerve ending to the receptors */
  acc.ach += dt * (2 + 7 * sm.Muscle);
  while (acc.ach >= 1) { acc.ach--; const p = free(ach); if (p) emit(p, rnd(420, 520), 224, rnd(-5, 5), rnd(30, 42), 0); }
  ach.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (1 - sm.NeuroBlock * 0.75).toFixed(2)); if (p.y > 266) kill(p); });
  /* bleeding droplets below the vessel */
  acc.bleed += dt * sm.Bleed * 9;
  while (acc.bleed >= 1) { acc.bleed--; const p = free(bleed); if (p) emit(p, rnd(760, 820), 366, rnd(-4, 4), rnd(16, 26), 0); }
  bleed.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 740, 840);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 408) kill(p); });
  /* antivenom antibodies hunt venom, latch on, and both fade as the venom is trapped */
  acc.asv += dt * sm.asv * 6;
  while (acc.asv >= 1) { acc.asv--; const p = free(asvAb); if (p) emit(p, rnd(380, 890), rnd(92, 115), 0, 0, 0); }
  asvAb.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 2) { p.y += 14 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    if (p.st === 1) {
      if (!p.tgt || !p.tgt.on) { p.st = 2; p.t = 0; return; }
      p.x = p.tgt.x; p.y = p.tgt.y;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300 + p.x) * 20) + ")");
      if (p.t > 0.7) { kill(p.tgt); p.st = 2; p.t = 0; } return;
    }
    let best = null, bd = 150 * 150;
    venom.forEach((q) => { if (!q.on || q.tr) return; const dx = q.x - p.x, dy = q.y - p.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = q; } });
    if (best) { const dx = best.x - p.x, dy = best.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 120 * dt; p.y += (dy / d) * 120 * dt;
      if (d < 9) { p.st = 1; p.t = 0; p.tgt = best; best.tr = 1; best.t = 0; } }
    else { p.x += Math.sin(tm / 400 + p.y) * 0.2; p.y += 26 * dt; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300 + p.x) * 20) + ")");
    if (p.t > 6) kill(p); });
  /* transfusion factors drift into the vessel while blood products are given */
  acc.transf += dt * sm.sup * 6;
  while (acc.transf >= 1) { acc.transf--; const p = free(transf); if (p) emit(p, rnd(855, 915), 108, 0, 0, 0); }
  transf.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 800 - p.x, dy = 190 - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 90 * dt; p.y += (dy / d) * 90 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 4) kill(p); });
  /* ventilation air puffs travel the tube toward the muscle */
  acc.air += dt * sm.sup * 7;
  while (acc.air >= 1) { acc.air--; const p = free(airP); if (p) emit(p, 938, rnd(384, 394), rnd(-58, -44), rnd(-3, 1), 0); }
  airP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", sm.sup.toFixed(2)); if (p.x < 596 || p.t > 8) kill(p); });
  /* gauges and the plain language caption */
  gg.local.set(sm.Local, wordOf(sm.Local, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.spread.set(sm.Spread, wordOf(sm.Spread, 0.3, 0.6, ["slow", "moving", "fast"]));
  gg.muscle.set(sm.Muscle, wordOf(sm.Muscle, 0.35, 0.65, ["weak", "reduced", "strong"])); gg.breath.set(sm.Breath, wordOf(sm.Breath, 0.35, 0.65, ["failing", "laboured", "steady"]));
  gg.use.set(sm.Consume, wordOf(sm.Consume, 0.3, 0.6, ["low", "raised", "high"])); gg.bleed.set(sm.Bleed, wordOf(sm.Bleed, 0.15, 0.4, ["none", "some", "heavy"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
