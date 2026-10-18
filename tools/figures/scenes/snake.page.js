/* Snake scene: bite and local injury, venom spread, neuromuscular block, clotting use and bleeding. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), recs: $("recs"), blocks: $("blockMarks"), platelets: $("platelets"), clotG: $("clotG"), rbcs: $("rbcs2"), necrosis: $("necrosis"), swell: $("swell"), muscleG: $("muscleG") };
/* ---- receptors and block marks ---- */
const REC_X = [390, 425, 460, 495, 530];
function initRecs() {
  REC_X.forEach((x) => { mk("rect", { class: "sn-rec", x: x - 8, y: 276, width: 16, height: 12, rx: 3 }, layers.recs); });
  REC_X.forEach((x) => { const g = mk("g", { transform: "translate(" + x + " 282)" }, layers.blocks); mk("path", { class: "sn-block", d: "M-6 -6L6 6M6 -6L-6 6" }, g); });
  layers.blocks.setAttribute("opacity", "0");
}
/* ---- platelets, clots, red cells in the vessel ---- */
const plats = [[690, 205], [735, 238], [775, 208], [820, 240], [860, 210], [900, 236]].map(([x, y], i) => {
  const g = cell(layers.platelets, { cls: "plt", r: 6, seed: i + 3, wob: 0.15, n: 7 }); place(g, x, y, i * 30, 1); return { g };
});
const clotGroups = [[710, 198], [800, 244], [880, 200]].map(([x, y], i) => {
  const g = mk("g", {}, layers.clotG);
  for (let j = 0; j < 5; j++) cell(g, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.4) * 9, y: Math.sin(j * 2) * 6, seed: j + i * 4, wob: 0.15, n: 7 });
  for (let j = 0; j < 5; j++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) + "L" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) }, g);
  return { g, x, y };
});
const vesselRbcs = [];
function initRbcs() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); vesselRbcs.push({ g, x: rnd(655, 925), y: rnd(198, 246), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const venom = pool(26, () => mk("path", { class: "sc-p sn-venom", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const ach = pool(20, () => mk("circle", { class: "sn-ach", r: 2.4 }, layers.parts));
const bleed = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const asvP = pool(12, () => mk("path", { class: "sn-asvP", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, layers.parts));
const airP = pool(10, () => mk("circle", { class: "sn-airP", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let immPill = null, asvPill = null, ventPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["local", "Local damage", "g-bad", "Swelling, tissue injury and necrosis at and around the bite."], ["spread", "Venom spread", "g-cyt", "Venom leaving the bite site in lymph and blood. Immobilisation slows this."], ["muscle", "Muscle power", "g-good", "How well muscle still answers nerve signals. Neurotoxic venom lowers this."], ["breath", "Breathing", "g-good", "Breathing as the breathing muscles weaken. Ventilation can support it."], ["use", "Factor use", "g-clot", "Clotting factors and platelets used up as venom switches clotting on."], ["bleed", "Bleeding", "g-bad", "Bleeding once clotting factors and platelets have been consumed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Local necrosis", 155, 242, 150, 335, "Dead and injured tissue around the bite. Established necrosis is not undone by anti-snake venom.");
  immPill = pill(ox, "Immobilised limb", 80, 295, 95, 380, "Immobilise the bitten limb and reassure the patient. Movement and anxiety speed venom spread.");
  pill(ox, "Venom spread", 235, 235, 250, 125, "Venom travels from the bite through lymph and blood to nerve endings and to the clotting system.");
  pill(ox, "Nerve terminal", 410, 145, 380, 115, "The nerve ending above the muscle. It releases acetylcholine, the signal chemical, into the gap.");
  asvPill = pill(ox, "Anti-snake venom", 520, 120, 545, 82, "Anti-snake venom: antibodies that bind and neutralise circulating venom. It does not repair tissue already destroyed.");
  pill(ox, "Blocked receptors", 460, 282, 550, 225, "Neurotoxic venom blocks acetylcholine receptors (and can injure the nerve ending), so the muscle gets no signal. Weakness descends: eyes, speech and swallowing, then breathing muscles.");
  pill(ox, "Muscle fibre", 400, 322, 375, 375, "Muscle that contracts only when its receptors receive acetylcholine. Blocked signalling causes flaccid paralysis.");
  ventPill = pill(ox, "Ventilation", 540, 322, 555, 375, "Ventilation: a machine breathes for the patient while paralysed breathing muscles recover.");
  pill(ox, "Blood vessel", 730, 190, 705, 110, "Blood vessel carrying red cells, platelets and clotting factors. Haemotoxic venom acts here.");
  pill(ox, "Blood products", 860, 190, 855, 145, "Blood products replace clotting factors and platelets that clotting has used up.");
  pill(ox, "Fibrin clots", 800, 240, 855, 270, "Fibrin clots formed as haemotoxic venom switches the clotting system on throughout the blood.");
  pill(ox, "Bleeding", 820, 262, 795, 355, "Bleeding from the bite, gums and into tissues once factors and platelets are consumed and blood cannot clot.");
}
const sm = { Local: 0.3, Spread: 0.3, NeuroBlock: 0.3, Muscle: 0.7, Breath: 0.8, Consume: 0.1, Bleed: 0, ClotAct: 0.1, imm: 1, asv: 0, sup: 0 };
const acc = { venom: 0, ach: 0, bleed: 0, asv: 0, air: 0 };
const TARGETS = [[460, 180], [785, 220], [185, 245]];
function init() { initRecs(); initRbcs(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Local = lerp(sm.Local, m.Local, k2); sm.Spread = lerp(sm.Spread, m.Spread, k2); sm.NeuroBlock = lerp(sm.NeuroBlock, m.NeuroBlock, k2);
  sm.Muscle = lerp(sm.Muscle, m.Muscle, k2); sm.Breath = lerp(sm.Breath, m.Breath, k1); sm.Consume = lerp(sm.Consume, m.Consume, k2);
  sm.Bleed = lerp(sm.Bleed, m.Bleed, k2); sm.ClotAct = lerp(sm.ClotAct, m.ClotAct, k2);
  sm.imm = lerp(sm.imm, m.imm, k1); sm.asv = lerp(sm.asv, m.asv, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  /* local injury */
  const ns = 0.25 + sm.Local * 1.6;
  layers.necrosis.setAttribute("transform", "translate(155 242) scale(" + ns.toFixed(3) + ") translate(-155 -242)");
  layers.necrosis.setAttribute("opacity", (0.2 + 0.8 * sm.Local).toFixed(2));
  const ss = 0.65 + sm.Local * 0.55;
  layers.swell.setAttribute("transform", "translate(155 242) scale(" + ss.toFixed(3) + ") translate(-155 -242)");
  layers.swell.setAttribute("opacity", (sm.Local * 0.7).toFixed(2));
  $("splintTop").style.opacity = (0.08 + 0.55 * sm.imm).toFixed(2); $("splintBot").style.opacity = (0.08 + 0.55 * sm.imm).toFixed(2);
  /* muscle contraction and receptor block */
  const sx = 0.94 + 0.07 * sm.Muscle + sm.Muscle * 0.025 * Math.sin(tm / 280);
  layers.muscleG.setAttribute("transform", "translate(460 322) scale(" + sx.toFixed(3) + " 1) translate(-460 -322)");
  layers.blocks.setAttribute("opacity", sm.NeuroBlock.toFixed(2));
  /* vessel: platelets are consumed, clots grow, red cells keep flowing */
  plats.forEach((pl) => { pl.g.style.opacity = (1 - sm.Consume * 0.8).toFixed(2); });
  clotGroups.forEach((c) => { const s = clamp((sm.ClotAct - 0.08) * 1.5); place(c.g, c.x, c.y, 0, 0.1 + 0.9 * s); c.g.style.opacity = s > 0.04 ? 1 : 0; });
  const flow = clamp(0.3 + 0.8 * sm.Breath) * (1 - 0.35 * sm.ClotAct);
  vesselRbcs.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > 928) { r.x = 656; r.y = rnd(198, 246); } place(r.g, r.x, r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* venom from the bite toward nerve, vessel or local tissue */
  acc.venom += dt * sm.Spread * 7;
  while (acc.venom >= 1) { acc.venom--; const p = free(venom); if (p) emit(p, rnd(165, 200), rnd(225, 255), 0, 0, Math.floor(rnd(0, 3))); }
  venom.forEach((p) => { if (!p.on) return; const tg = TARGETS[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 60, 425);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 16) kill(p); });
  /* acetylcholine from nerve terminal down to the receptors */
  acc.ach += dt * (2 + 7 * sm.Muscle);
  while (acc.ach >= 1) { acc.ach--; const p = free(ach); if (p) emit(p, rnd(400, 520), 214, rnd(-5, 5), rnd(30, 42), 0); }
  ach.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (1 - sm.NeuroBlock * 0.75).toFixed(2)); if (p.y > 272) kill(p); });
  /* bleeding droplets below the vessel */
  acc.bleed += dt * sm.Bleed * 9;
  while (acc.bleed >= 1) { acc.bleed--; const p = free(bleed); if (p) emit(p, rnd(675, 905), 264, rnd(-4, 4), rnd(16, 26), 0); }
  bleed.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 640, 930); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 368) kill(p); });
  /* anti-snake venom antibodies drifting in to bind venom */
  acc.asv += dt * sm.asv * 5;
  while (acc.asv >= 1) { acc.asv--; const p = free(asvP); if (p) emit(p, rnd(400, 880), rnd(92, 120), rnd(-8, 8), rnd(18, 28), 0); }
  asvP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 330, 930); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300 + p.x) * 20) + ")"); if (p.y > 205 || p.t > 4) kill(p); });
  /* ventilation air puffs beside the muscle */
  acc.air += dt * sm.sup * 4;
  while (acc.air >= 1) { acc.air--; const p = free(airP); if (p) emit(p, 574, rnd(300, 344), rnd(14, 22), rnd(-4, 4), 0); }
  airP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.7).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3 || p.x > 622) kill(p); });
  /* treatment pills */
  if (immPill) immPill.style.opacity = (0.12 + 0.88 * sm.imm).toFixed(2);
  if (asvPill) asvPill.style.opacity = (0.12 + 0.88 * sm.asv).toFixed(2);
  if (ventPill) ventPill.style.opacity = (0.12 + 0.88 * sm.sup).toFixed(2);
  /* gauges */
  gg.local.set(sm.Local, wordOf(sm.Local, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.spread.set(sm.Spread, wordOf(sm.Spread, 0.3, 0.6, ["slow", "moving", "fast"]));
  gg.muscle.set(sm.Muscle, wordOf(sm.Muscle, 0.35, 0.65, ["weak", "reduced", "strong"])); gg.breath.set(sm.Breath, wordOf(sm.Breath, 0.35, 0.65, ["failing", "laboured", "steady"]));
  gg.use.set(sm.Consume, wordOf(sm.Consume, 0.3, 0.6, ["low", "raised", "high"])); gg.bleed.set(sm.Bleed, wordOf(sm.Bleed, 0.15, 0.4, ["none", "some", "heavy"]));
}
run({ init, step });
