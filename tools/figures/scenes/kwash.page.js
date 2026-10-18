/* Kwashiorkor and marasmus scene: wasted body, oedema, fatty liver, albumin, immunity and the infection cycle. */
const WW = SC.W;
const layers = { intake: $("intakeIn"), muscle: $("muscleIn"), fat: $("fatIn"), liver: $("liverIn"), alb: $("albIn"), oed: $("oedIn"), child: $("child"), immune: $("immuneIn"), inf: $("infIn"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const foodP = pool(10, () => mk("circle", { class: "sc-p p-food", r: 3 }, layers.parts));
const albP = pool(18, () => mk("circle", { class: "sc-p p-alb", r: 3 }, layers.parts));
const oedP = pool(14, () => mk("path", { class: "p-oedp", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const pathP = pool(12, () => mk("circle", { class: "sc-p p-path", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- dynamic parts ---- */
let torso, belly, hairPale, ankleL, ankleR, flakes = [], fibres = [], adips = [], fatDrops = [], immCells = [], pathGroup;
function buildChild() {
  const g = layers.child;
  mk("rect", { class: "kw-limb", x: 414, y: 176, width: 13, height: 92, rx: 6, transform: "rotate(10 420 176)" }, g);
  mk("rect", { class: "kw-limb", x: 533, y: 176, width: 13, height: 92, rx: 6, transform: "rotate(-10 540 176)" }, g);
  mk("rect", { class: "kw-limb", x: 452, y: 292, width: 15, height: 94, rx: 7 }, g);
  mk("rect", { class: "kw-limb", x: 493, y: 292, width: 15, height: 94, rx: 7 }, g);
  ankleL = mk("ellipse", { class: "kw-oed", cx: 460, cy: 388, rx: 12, ry: 8 }, g);
  ankleR = mk("ellipse", { class: "kw-oed", cx: 500, cy: 388, rx: 12, ry: 8 }, g);
  torso = mk("ellipse", { class: "kw-skin", cx: 480, cy: 228, rx: 38, ry: 72 }, g);
  belly = mk("ellipse", { class: "kw-belly", cx: 480, cy: 256, rx: 18, ry: 14 }, g);
  for (let i = 0; i < 6; i++) { const f = mk("ellipse", { class: "kw-flake", cx: 458 + (i % 3) * 20, cy: 205 + Math.floor(i / 3) * 34, rx: 5, ry: 3, transform: "rotate(" + (i * 37 % 50 - 25) + " " + (458 + (i % 3) * 20) + " " + (205 + Math.floor(i / 3) * 34) + ")" }, g); flakes.push(f); }
  mk("circle", { class: "kw-skin", cx: 480, cy: 128, r: 30 }, g);
  mk("ellipse", { class: "kw-hair", cx: 480, cy: 104, rx: 30, ry: 15 }, g);
  hairPale = mk("ellipse", { class: "kw-hairpale", cx: 480, cy: 104, rx: 26, ry: 12, opacity: "0" }, g);
  mk("circle", { cx: 470, cy: 126, r: 2.4, fill: "#2b1c14" }, g);
  mk("circle", { cx: 490, cy: 126, r: 2.4, fill: "#2b1c14" }, g);
  mk("path", { d: "M470 142 Q480 148 490 142", fill: "none", stroke: "#2b1c14", "stroke-width": 1.4 }, g);
}
function buildNodes() {
  mk("path", { class: "kw-bowl", d: "M88 124H182L170 150H100Z" }, layers.intake);
  [[105, 112], [135, 106], [165, 112]].forEach(([x, y]) => mk("circle", { class: "kw-food", cx: x, cy: y, r: 4 }, layers.intake));
  [212, 230, 248].forEach((y) => { const r = mk("rect", { class: "kw-fibre", x: 58, y: y, width: 150, height: 12, rx: 6 }, layers.muscle); fibres.push(r); });
  [[82, 326], [122, 326], [162, 326], [102, 356], [142, 356], [182, 356]].forEach(([x, y], i) => { const c = mk("circle", { class: "kw-adip", cx: x, cy: y, r: 15 }, layers.fat); adips.push(c); });
  mk("ellipse", { class: "kw-liver", cx: 825, cy: 128, rx: 64, ry: 30 }, layers.liver);
  [[790, 116], [815, 132], [840, 114], [862, 130], [800, 140], [850, 142], [825, 120]].forEach(([x, y]) => { const c = mk("circle", { class: "kw-fatdrop", cx: x, cy: y, r: 4 }, layers.liver); fatDrops.push(c); });
  mk("rect", { class: "kw-vessel", x: 750, y: 218, width: 150, height: 24, rx: 12 }, layers.alb);
  mk("rect", { class: "kw-tis", x: 750, y: 320, width: 150, height: 38, rx: 9 }, layers.oed);
  mk("ellipse", { class: "kw-oed", id: "oedBlob", cx: 825, cy: 339, rx: 46, ry: 13 }, layers.oed);
  for (let i = 0; i < 4; i++) { const c = cell(layers.immune, { cls: "lymph", r: 10, nuc: 0.45, seed: i * 2 + 3, wob: 0.12 }); place(c, 300 + i * 38, 412, 0, 1); immCells.push(c); }
  pathGroup = mk("g", {}, layers.inf);
  for (let i = 0; i < 5; i++) mk("ellipse", { class: "kw-paths", cx: 552 + i * 28, cy: 412, rx: 7, ry: 3.6, transform: "rotate(" + (i * 29 % 60 - 30) + " " + (552 + i * 28) + " 412)" }, pathGroup);
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The child";
  [["waste", "Wasting", "g-waste", "Loss of muscle and fat. Severe in marasmus, less marked in kwashiorkor where oedema masks it."], ["alb", "Albumin", "g-alb", "Blood albumin, a visceral protein. Relatively preserved in marasmus, low in kwashiorkor."], ["oed", "Oedema", "g-oedg", "Fluid in the tissues from low albumin and a leaky circulation. The sign that separates kwashiorkor from marasmus."], ["fat", "Fatty liver", "g-fatg", "Fat builds up in the liver when it cannot be exported as lipoprotein, a protein shortage effect."], ["imm", "Immunity", "g-imm", "Immune defence. Weak in all severe malnutrition, so infections are frequent and severe."], ["inf", "Infection", "g-inf", "Infection risk. Infection cuts appetite and raises losses, which deepens malnutrition in a vicious cycle."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Food intake", 110, 88, 115, 72, "Food intake: too little energy in marasmus, too little protein in kwashiorkor. Often worse during illness.");
  pill(ox, "Muscle", 60, 227, 105, 172, "Muscle is broken down for energy and amino acids. Wasting is most visible here and in the limbs.");
  pill(ox, "Fat store", 60, 337, 110, 282, "Fat store under the skin. Used up in marasmus; relatively spared in kwashiorkor, which can hide how ill the child is.");
  pill(ox, "Liver", 888, 88, 845, 72, "Liver: in kwashiorkor it cannot make enough export protein, so fat accumulates and the liver enlarges and feels soft.");
  pill(ox, "Albumin", 730, 227, 660, 232, "Albumin made by the liver from dietary protein. When it falls, fluid leaves the blood and collects as oedema.");
  pill(ox, "Oedema", 888, 337, 840, 282, "Oedema: pitting swelling, usually starting in the feet. Its presence defines kwashiorkor even when weight looks near normal.");
  pill(ox, "Hair and skin", 508, 110, 615, 98, "Hair becomes sparse, straight and paler, and skin may flake and darken then peel in kwashiorkor.");
  pill(ox, "Belly", 492, 252, 615, 210, "A swollen belly in kwashiorkor comes from the enlarged fatty liver, weak abdominal muscles and fluid.");
  pill(ox, "Swollen ankles", 500, 382, 615, 330, "Swollen ankles and feet from oedema. Pressing leaves a pit. In the mixed form they occur with severe wasting.");
  pill(ox, "Weak immunity", 355, 396, 355, 382, "Weak immunity: fewer and poorer immune cells, a leaky gut and skin barrier, and missing micronutrients.");
  pill(ox, "Infection", 605, 396, 605, 382, "Infection such as diarrhoea, pneumonia or measles. It suppresses appetite and burns protein, deepening malnutrition.");
}
const sm = { Waste: 0.5, Alb: 0.3, Oed: 0.5, Fat: 0.5, ImmLoss: 0.7, Inf: 0.5, Adapt: 0.3, Belly: 0.5, refeed: 0, antiInf: 0, micro: 0 };
const acc = { food: 0, alb: 0, oed: 0, path: 0 };
function init() { buildChild(); buildNodes(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Waste = lerp(sm.Waste, m.Waste, k2); sm.Alb = lerp(sm.Alb, m.Alb, k2); sm.Oed = lerp(sm.Oed, m.Oed, k2); sm.Fat = lerp(sm.Fat, m.Fat, k2); sm.ImmLoss = lerp(sm.ImmLoss, m.ImmLoss, k2); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.Adapt = lerp(sm.Adapt, m.Adapt, k2); sm.Belly = lerp(sm.Belly, m.Belly, k2);
  sm.refeed = lerp(sm.refeed, m.refeed, k1); sm.antiInf = lerp(sm.antiInf, m.antiInf, k1); sm.micro = lerp(sm.micro, m.micro, k1);
  const bob = Math.sin(tm / 900) * 1.2;
  layers.child.setAttribute("transform", "translate(0 " + f1(bob) + ")");
  torso.setAttribute("rx", f1(44 - 20 * sm.Waste + 5 * sm.Belly));
  belly.setAttribute("rx", f1(9 + 30 * sm.Belly)); belly.setAttribute("ry", f1(7 + 19 * sm.Belly)); belly.setAttribute("opacity", (0.35 + 0.65 * sm.Belly).toFixed(2));
  ankleL.setAttribute("rx", f1(10 + 17 * sm.Oed)); ankleL.setAttribute("ry", f1(6 + 9 * sm.Oed));
  ankleR.setAttribute("rx", f1(10 + 17 * sm.Oed)); ankleR.setAttribute("ry", f1(6 + 9 * sm.Oed));
  hairPale.setAttribute("opacity", clamp((1 - sm.Adapt) * 1.1).toFixed(2));
  flakes.forEach((f) => f.setAttribute("opacity", clamp((1 - sm.Adapt) * 1.15).toFixed(2)));
  fibres.forEach((r) => r.setAttribute("width", f1(150 * (1 - 0.68 * sm.Waste))));
  adips.forEach((c, i) => c.setAttribute("r", f1(Math.max(5, 17 * (1 - 0.62 * sm.Waste) + (i % 2) * 1.5))));
  fatDrops.forEach((c, i) => { c.setAttribute("r", f1(1.5 + 5.5 * sm.Fat)); c.setAttribute("opacity", (0.15 + 0.85 * sm.Fat).toFixed(2)); });
  const blob = $("oedBlob"); if (blob) { blob.setAttribute("rx", f1(24 + 34 * sm.Oed)); blob.setAttribute("opacity", (0.2 + 0.8 * sm.Oed).toFixed(2)); }
  immCells.forEach((c, i) => { place(c, 300 + i * 38, 412 + Math.sin(tm / 700 + i) * 1.5, 0, Math.max(0.3, 1 - sm.ImmLoss)); c.style.opacity = (1 - 0.65 * sm.ImmLoss).toFixed(2); });
  if (pathGroup) { pathGroup.setAttribute("opacity", (0.15 + 0.85 * sm.Inf).toFixed(2)); }
  /* food falling to the bowl */
  acc.food += dt * (0.7 + 3.2 * sm.refeed); while (acc.food >= 1) { acc.food--; const p = free(foodP); if (p) emit(p, rnd(98, 172), 94, 0, rnd(18, 28), 0); }
  foodP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 122) kill(p); });
  /* albumin flowing along the vessel */
  acc.alb += dt * sm.Alb * 5; while (acc.alb >= 1) { acc.alb--; const p = free(albP); if (p) emit(p, 754, 230 + rnd(-6, 6), rnd(28, 42), 0, 0); }
  albP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 896) kill(p); });
  /* oedema droplets gathering in tissue */
  acc.oed += dt * sm.Oed * 4.5; while (acc.oed >= 1) { acc.oed--; const p = free(oedP); if (p) emit(p, rnd(762, 888), 322, rnd(-3, 3), rnd(12, 20), 0); }
  oedP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 354) kill(p); });
  /* pathogens drifting in the infection node */
  acc.path += dt * sm.Inf * 3.5; while (acc.path >= 1) { acc.path--; const p = free(pathP); if (p) emit(p, rnd(532, 560), rnd(402, 422), rnd(14, 26), rnd(-4, 4), 0); }
  pathP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 400 || p.y > 424) p.vy = -p.vy; p.y = clamp(p.y, 400, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 682 || p.t > 6) kill(p); });
  /* gauges: Albumin and Immunity fill upward when better */
  gg.waste.set(sm.Waste, wordOf(sm.Waste, 0.35, 0.7, ["mild", "moderate", "severe"])); gg.alb.set(sm.Alb, wordOf(1 - sm.Alb, 0.35, 0.65, ["preserved", "low", "very low"]));
  gg.oed.set(sm.Oed, wordOf(sm.Oed, 0.2, 0.55, ["absent", "present", "marked"])); gg.fat.set(sm.Fat, wordOf(sm.Fat, 0.2, 0.55, ["absent", "present", "marked"]));
  gg.imm.set(1 - sm.ImmLoss, wordOf(sm.ImmLoss, 0.35, 0.65, ["kept", "weak", "very weak"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
