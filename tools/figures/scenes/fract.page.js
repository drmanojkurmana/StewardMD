/* Fracture healing scene: clot, callus, vessels from bone ends and muscle, builders, cast cuff, plate and the gauges. */
const layers = { muscleT: $("muscleSlotT"), muscleB: $("muscleSlotB"), haem: $("haem"), callus: $("callus"), vessels: $("vessels"), cells: $("cells"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel"), fragR: $("fragR") };
let haemEl, softEl, hardEl, bridgeEl, castG, plateG, capEl = null, capDrug = -1;
let muscleTO = null, muscleBO = null;
const vess = [];
const strapEls = [], arrowEls = [], streakEls = [];
const blasts = [];
const clasts = [];
const gg = {};
function initOrgans() {
  muscleTO = organ(layers.muscleT, "muscle", 480, 110, 840, { h: 56, dim: true });
  muscleBO = organ(layers.muscleB, "muscle", 480, 386, 840, { h: 56, dim: true });
  const tb = muscleTO.ports.belly, bb = muscleBO.ports.belly;
  const defs = [
    [452, 214, 480, 236], [452, 286, 480, 264],
    [508, 214, 480, 236], [508, 286, 480, 264],
    [tb[0], tb[1], 440, 178], [bb[0], bb[1], 440, 322],
  ];
  defs.forEach(([x1, y1, x2, y2]) => {
    const p = mk("path", { class: "fr-vess", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x1) + " " + f1(y1) }, layers.vessels);
    vess.push({ p, x1, y1, x2, y2, tr: track([[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2], [x2, y2]]) });
  });
}
function capText(d) {
  if (d === 1) return "A cast holds the limb still from outside. The gap bridges and hardens.";
  if (d === 2) return "A plate holds the ends in line. The bone bridges, hardens and reunites.";
  return "No support. The loose ends move, so the gap bridges slowly.";
}
/* blood dots stream along the vessel tracks into the callus */
function pool(n, build) { return Array.from({ length: n }, (_, i) => { const e = build(); e.setAttribute("opacity", "0"); return { e, u: (i + 0.5) / n }; }); }
const flow = pool(8, () => mk("circle", { class: "sc-p p-frrbc", r: 2.6 }, layers.parts));
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The fracture";
  [["bridge", "Bridging", "g-bridge", "How far new tissue spans the gap between the bone ends."], ["hard", "Hardness", "g-hard", "How far soft callus has been replaced by mineralised bone."], ["align", "Alignment", "g-align", "How well the bone ends line up. Poor alignment that persists is malunion."], ["union", "Healing", "g-union", "Overall progress toward a united, strong bone."], ["delay", "Slow risk", "g-delay", "Risk of slow healing. Movement at the gap, poor blood supply, infection, smoking, diabetes and poor nutrition all raise it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Clot", 480, 262, 350, 70, "Clot: blood from the broken ends fills the gap. Cleaners clear debris and repair begins.");
  pill(ox, "Soft callus", 412, 205, 520, 70, "Soft callus: gristle-like tissue that bridges the gap. It holds the ends but is still weak.");
  pill(ox, "Hard callus", 548, 300, 700, 70, "Hard callus: builders replace gristle with woven bone. Later it is trimmed back into shape (remodelling).");
  pill(ox, "Bone", 200, 250, 110, 395, "Bone: the shaft is broken across. Without holding still, the ends move and healing slows.");
  pill(ox, "New vessels", 505, 268, 310, 395, "New vessels: blood vessels grow in from the bone ends and the nearby muscle. Without blood, new tissue cannot live.");
  pill(ox, "Builders", 440, 290, 510, 395, "Builders: osteoblasts lay down new bone. Osteoclasts later trim it back into shape.");
  const cp = pill(ox, "Cast", 700, 140, 860, 70, "Cast: a stiff shell worn outside the limb. It holds the break still so the gap can bridge."); cp.setAttribute("id", "cast-pill");
  const pp = pill(ox, "Plate", 560, 154, 730, 395, "Plate: metal fixed to the bone inside the body. It holds the ends in line while they reunite."); pp.setAttribute("id", "plate-pill");
  capEl = mk("text", { class: "fr-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
function init() {
  initOrgans();
  haemEl = mk("ellipse", { class: "fr-haem", cx: 480, cy: 250, rx: 34, ry: 58 }, layers.haem);
  softEl = mk("ellipse", { class: "fr-soft", cx: 480, cy: 250, rx: 80, ry: 84 }, layers.callus);
  hardEl = mk("ellipse", { class: "fr-hard", cx: 480, cy: 250, rx: 94, ry: 78 }, layers.callus);
  bridgeEl = mk("rect", { class: "fr-bridge", x: 450, y: 170, width: 60, height: 160, rx: 6 }, layers.callus);
  for (let i = 0; i < 10; i++) blasts.push({ g: cell(layers.cells, { cls: "ost", r: 7, nuc: 0.4, seed: i + 3, wob: 0.12 }), ph: (i / 10) * 6.283 });
  for (let i = 0; i < 4; i++) clasts.push({ g: cell(layers.cells, { cls: "ocl", r: 10, nuc: 0.5, seed: i + 30, wob: 0.14 }), x: 448 + i * 22, y: 218 + (i % 2) * 56 });
  /* movement streaks beside the gap: visible while the ends are loose */
  [["M444 216l7 9l-7 9l7 9"], ["M516 216l-7 9l7 9l-7 9"]].forEach(([d]) => {
    streakEls.push(mk("path", { class: "fr-streak", d }, layers.vessels));
  });
  /* cast cuff around the limb with wrap straps */
  castG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "fr-cast", x: 200, y: 118, width: 560, height: 264, rx: 30, opacity: "0.45" }, castG);
  mk("rect", { class: "fr-cuffedge", x: 208, y: 126, width: 544, height: 248, rx: 24 }, castG);
  [300, 480, 660].forEach((x) => { strapEls.push(mk("rect", { class: "fr-strap", x: x - 7, y: 118, width: 14, height: 264, rx: 7 }, castG)); });
  /* plate with screws plus arrows pulling the ends together */
  plateG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "fr-plate", x: 360, y: 146, width: 240, height: 16, rx: 7 }, plateG);
  [380, 420, 460, 500, 540, 580].forEach((x) => { mk("circle", { class: "fr-screw", cx: x, cy: 154, r: 5 }, plateG); mk("path", { class: "fr-shaft", d: "M" + x + " 154L" + x + " 184" }, plateG); });
  [["M298 132L350 132", "M350 132L338 126M350 132L338 138"], ["M662 132L610 132", "M610 132L622 126M610 132L622 138"]].forEach(([shaft, head]) => {
    arrowEls.push(mk("path", { class: "fr-arrow", d: shaft }, plateG));
    arrowEls.push(mk("path", { class: "fr-arrow", d: head }, plateG));
  });
  initPanel();
}
const sm = { a: 0.42, soft: 0.5, bridge: 0.2, mineral: 0.2, hard: 0.1, remodel: 0, stab: 0.1, align: 0.4, union: 0.1, delay: 0.5, imm: 0, fix: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7), kFast = Math.min(1, dt * 2.2);
  sm.a = lerp(sm.a, m.a, k2); sm.soft = lerp(sm.soft, m.soft, k2); sm.bridge = lerp(sm.bridge, m.bridge, k2); sm.mineral = lerp(sm.mineral, m.mineral, k2);
  sm.hard = lerp(sm.hard, m.hard, k2); sm.remodel = lerp(sm.remodel, m.remodel, k2); sm.stab = lerp(sm.stab, m.stab, k); sm.align = lerp(sm.align, m.align, k2);
  sm.union = lerp(sm.union, m.union, k2); sm.delay = lerp(sm.delay, m.delay, k2);
  /* treatment devices switch fast so the mechanism reads at a glance */
  sm.imm = lerp(sm.imm, drug === 1 ? 1 : 0, kFast); sm.fix = lerp(sm.fix, drug === 2 ? 1 : 0, kFast);
  const wob = (1 - sm.union) * (1 - sm.stab) * Math.sin(tm / 260) * 5;
  layers.fragR.setAttribute("transform", "translate(" + f1(wob) + " " + f1((1 - sm.align) * 7 + wob * 0.4) + ")");
  const haemS = clamp(1 - sm.a * 1.15);
  haemEl.setAttribute("opacity", haemS.toFixed(2)); haemEl.setAttribute("transform", "translate(480 250) scale(" + (0.4 + 0.6 * haemS).toFixed(2) + ") translate(-480 -250)");
  const shrink = 1 - sm.remodel * 0.45;
  softEl.setAttribute("opacity", (sm.soft * 0.75 * (1 - sm.hard * 0.7)).toFixed(2));
  softEl.setAttribute("transform", "translate(480 250) scale(" + (shrink * (0.5 + 0.5 * sm.soft)).toFixed(2) + ") translate(-480 -250)");
  hardEl.setAttribute("opacity", (sm.hard * 0.9).toFixed(2));
  hardEl.setAttribute("transform", "translate(480 250) scale(" + (shrink * (0.5 + 0.5 * sm.hard)).toFixed(2) + ") translate(-480 -250)");
  bridgeEl.setAttribute("opacity", (sm.remodel * 0.95).toFixed(2));
  /* vessels grow into the gap and widen as bridging proceeds */
  vess.forEach((v) => { const u = clamp(sm.bridge * 1.1); v.p.setAttribute("d", "M" + f1(v.x1) + " " + f1(v.y1) + "L" + f1(lerp(v.x1, v.x2, u)) + " " + f1(lerp(v.y1, v.y2, u))); v.p.setAttribute("opacity", (0.25 + 0.75 * u).toFixed(2)); v.p.setAttribute("stroke-width", f1(1.5 + 2.5 * sm.bridge)); });
  /* loose ends show movement streaks; holding still clears them */
  streakEls.forEach((p) => p.setAttribute("opacity", ((1 - sm.stab) * 0.85).toFixed(2)));
  /* blood dots stream in, more of them as bridging proceeds */
  const flowOn = Math.round(sm.bridge * flow.length);
  flow.forEach((p, i) => {
    if (i >= flowOn || sm.bridge < 0.05) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dt * (0.25 + 0.6 * sm.bridge); if (p.u > 1) p.u -= 1;
    const q = vess[i % vess.length].tr.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", "1");
  });
  blasts.forEach((b, i) => { const on = sm.mineral > 0.08 && sm.remodel < 0.85; const rx = 62 * shrink, ry = 66 * shrink, ang = b.ph + tm / 2400;
    place(b.g, 480 + Math.cos(ang) * rx, 250 + Math.sin(ang) * ry, 0, on ? 1 : 0.1); b.g.style.opacity = on ? 1 : 0; });
  clasts.forEach((c, i) => { place(c.g, c.x + Math.sin(tm / 500 + i) * 3, c.y, 0, 0.2 + 0.8 * sm.remodel); c.g.style.opacity = sm.remodel > 0.08 ? 1 : 0; });
  /* cast cuff and straps fade in fast around the limb */
  castG.setAttribute("opacity", sm.imm.toFixed(2));
  strapEls.forEach((s) => s.setAttribute("opacity", (0.35 + 0.65 * sm.imm).toFixed(2)));
  /* plate, screws and pull-together arrows appear with fixation */
  plateG.setAttribute("opacity", sm.fix.toFixed(2));
  $("cast-pill").style.opacity = sm.imm.toFixed(2); $("plate-pill").style.opacity = sm.fix.toFixed(2);
  gg.bridge.set(sm.bridge, wordOf(sm.bridge, 0.25, 0.65, ["absent", "partial", "complete"]));
  gg.hard.set(sm.mineral, wordOf(sm.mineral, 0.25, 0.6, ["soft", "forming", "hard"]));
  gg.align.set(sm.align, wordOf(sm.align, 0.35, 0.65, ["poor", "fair", "good"]));
  gg.union.set(sm.union, wordOf(sm.union, 0.3, 0.7, ["not united", "uniting", "united"]));
  gg.delay.set(sm.delay, wordOf(sm.delay, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
