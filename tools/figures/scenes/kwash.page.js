/* Kwashiorkor and marasmus scene: wasted child, fatty liver, albumin, oedema and the infection cycle.
 * Food flows left to right: intake, body stores, liver and blood, then swelling. Infection cycles below. */
const WW = SC.W;
const layers = { intake: $("intakeIn"), muscle: $("muscleIn"), fat: $("fatIn"), liver: $("liverIn"), alb: $("albIn"), oed: $("oedIn"), child: $("child"), immune: $("immuneIn"), inf: $("infIn"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const foodP = pool(10, () => mk("circle", { class: "sc-p p-food", r: 3 }, layers.parts));
const feedP = pool(10, () => mk("circle", { class: "sc-p p-food", r: 3 }, layers.parts));
const albP = pool(18, () => mk("circle", { class: "sc-p p-alb", r: 3 }, layers.parts));
const oedP = pool(14, () => mk("path", { class: "p-oedp", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const pathP = pool(12, () => mk("circle", { class: "sc-p p-path", r: 2.6 }, layers.parts));
const abxP = pool(8, () => mk("circle", { class: "sc-p p-abx", r: 3 }, layers.parts));
const micP = pool(8, () => mk("circle", { class: "sc-p p-mic", r: 2.4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- organs and tracks ---- */
let liverO = null, albX = 798, feedTrack = null, fatGlow = null, capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Careful refeeding. Small feeds rebuild muscle and fat and clear fat out of the liver.";
  if (d === 2) return "Infection care. Killing germs restores appetite and stops protein being burned up.";
  if (d === 3) return "Micronutrients. Missing vitamins and minerals return, so skin and hair recover and immunity strengthens.";
  if (d === 4) return "Combined care. Feeding plus infection care plus micronutrients rebuilds the child on every gauge.";
  return "No treatment. Too little protein keeps albumin low, so fluid leaks out and the feet swell.";
}
function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 825, 130, 185, {});
  albX = Math.round(liverO.ports.porta[0] * 10) / 10;
  feedTrack = track([[135, 152], [260, 150], [380, 140], [468, 140]]);
}
/* ---- dynamic parts ---- */
let torso, belly, hairPale, ankleL, ankleR, armL, armR, legL, legR, flakes = [], fibres = [], adips = [], fatDrops = [], immCells = [], pathGs = [];
const ARM = [{ x: 414, w: 13 }, { x: 533, w: 13 }], LEG = [{ x: 452, w: 15 }, { x: 493, w: 15 }];
function buildChild() {
  const g = layers.child;
  armL = mk("rect", { class: "kw-limb", x: 414, y: 176, width: 13, height: 92, rx: 6, transform: "rotate(10 420 176)" }, g);
  armR = mk("rect", { class: "kw-limb", x: 533, y: 176, width: 13, height: 92, rx: 6, transform: "rotate(-10 540 176)" }, g);
  legL = mk("rect", { class: "kw-limb", x: 452, y: 292, width: 15, height: 94, rx: 7 }, g);
  legR = mk("rect", { class: "kw-limb", x: 493, y: 292, width: 15, height: 94, rx: 7 }, g);
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
  [[82, 326], [122, 326], [162, 326], [102, 356], [142, 356], [182, 356]].forEach(([x, y]) => { const c = mk("circle", { class: "kw-adip", cx: x, cy: y, r: 15 }, layers.fat); adips.push(c); });
  fatGlow = mk("ellipse", { class: "kw-fatglow", cx: 825, cy: 130, rx: 80, ry: 60 }, layers.liver);
  [[-38, -30], [-18, 6], [22, -28], [44, 8], [-6, 26], [30, 30], [-28, 18]].forEach(([dx, dy]) => { const c = mk("circle", { class: "kw-fatdrop", cx: 825 + dx, cy: 130 + dy, r: 4 }, layers.liver); fatDrops.push(c); });
  mk("rect", { class: "kw-vessel", x: 750, y: 225, width: 150, height: 24, rx: 12 }, layers.alb);
  mk("rect", { class: "kw-tis", x: 750, y: 320, width: 150, height: 38, rx: 9 }, layers.oed);
  mk("ellipse", { class: "kw-oed", id: "oedBlob", cx: 825, cy: 339, rx: 46, ry: 13 }, layers.oed);
  for (let i = 0; i < 4; i++) { const c = cell(layers.immune, { cls: "lymph", r: 10, nuc: 0.45, seed: i * 2 + 3, wob: 0.12 }); place(c, 300 + i * 38, 412, 0, 1); immCells.push(c); }
  for (let i = 0; i < 5; i++) { const pg = mk("g", {}, layers.inf); place(pg, 552 + i * 28, 412, 0, 1);
    mk("ellipse", { class: "kw-paths", cx: 0, cy: 0, rx: 7, ry: 3.6, transform: "rotate(" + (i * 29 % 60 - 30) + " 0 0)" }, pg); pathGs.push({ g: pg, x: 552 + i * 28, y: 412 }); }
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The child";
  [["waste", "Wasting", "g-waste", "Loss of muscle and fat. Severe in marasmus, less marked in kwashiorkor where swelling masks it."], ["alb", "Albumin", "g-alb", "Blood albumin, a protein made by the liver. Relatively preserved in marasmus, low in kwashiorkor."], ["oed", "Swelling", "g-oedg", "Fluid leaked into the tissues because albumin is low. Swelling defines kwashiorkor even when weight looks near normal."], ["fat", "Fatty liver", "g-fatg", "Fat builds up in the liver when too little protein leaves it stranded there."], ["imm", "Immunity", "g-imm", "Immune defence. Weak in all severe malnutrition, so infections are frequent and severe."], ["inf", "Infection", "g-inf", "Infection risk. Infection cuts appetite and burns protein, which deepens malnutrition in a vicious cycle."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Food", 135, 118, 115, 64, "Food is too scarce. In marasmus energy is missing, in kwashiorkor protein is missing.");
  pill(ox, "Muscle and fat", 100, 279, 135, 392, "The body burns its own muscle and fat for energy, so the limbs grow thin.");
  pill(ox, "Hair and skin", 505, 110, 620, 84, "Hair turns pale and straight and skin flakes. Feeding and micronutrients reverse this.");
  pill(ox, "Belly", 508, 258, 620, 208, "The belly swells from the enlarged fatty liver, weak muscles and fluid inside.");
  pill(ox, "Liver", 750, 120, 648, 120, "Short of protein, the liver cannot export fat, so fat builds up and the liver swells.");
  pill(ox, "Albumin", 800, 237, 825, 280, "Albumin is a blood protein made by the liver. When it falls, fluid leaks into the tissues.");
  pill(ox, "Swelling", 825, 345, 825, 390, "Swollen feet and ankles from leaked fluid. Swelling with wasting means the mixed form.");
  pill(ox, "Infection cycle", 480, 414, 480, 384, "Weak immunity invites infection, and infection burns protein and kills appetite.");
  capEl = mk("text", { class: "kw-cap", x: 30, y: 436 }, ox); capEl.textContent = capText(0);
}
const sm = { Waste: 0.5, Alb: 0.3, Oed: 0.5, Fat: 0.5, ImmLoss: 0.7, Inf: 0.5, Adapt: 0.3, Belly: 0.5, refeed: 0, antiInf: 0, micro: 0 };
const acc = { food: 0, feed: 0, alb: 0, oed: 0, path: 0, abx: 0, mic: 0 };
function init() { initOrgans(); buildChild(); buildNodes(); initPanel(); }
function thin(el, base, waste) { const w = base.w * (1 - 0.5 * waste); el.setAttribute("width", f1(w)); el.setAttribute("x", f1(base.x + (base.w - w) / 2)); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Waste = lerp(sm.Waste, m.Waste, k2); sm.Alb = lerp(sm.Alb, m.Alb, k2); sm.Oed = lerp(sm.Oed, m.Oed, k2); sm.Fat = lerp(sm.Fat, m.Fat, k2); sm.ImmLoss = lerp(sm.ImmLoss, m.ImmLoss, k2); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.Adapt = lerp(sm.Adapt, m.Adapt, k2); sm.Belly = lerp(sm.Belly, m.Belly, k2);
  sm.refeed = lerp(sm.refeed, m.refeed, k1); sm.antiInf = lerp(sm.antiInf, m.antiInf, k1); sm.micro = lerp(sm.micro, m.micro, k1);
  const bob = Math.sin(tm / 900) * 1.2;
  layers.child.setAttribute("transform", "translate(0 " + f1(bob) + ")");
  torso.setAttribute("rx", f1(44 - 20 * sm.Waste + 5 * sm.Belly));
  thin(armL, ARM[0], sm.Waste); thin(armR, ARM[1], sm.Waste); thin(legL, LEG[0], sm.Waste); thin(legR, LEG[1], sm.Waste);
  belly.setAttribute("rx", f1(9 + 30 * sm.Belly)); belly.setAttribute("ry", f1(7 + 19 * sm.Belly)); belly.setAttribute("opacity", (0.35 + 0.65 * sm.Belly).toFixed(2));
  ankleL.setAttribute("rx", f1(10 + 17 * sm.Oed)); ankleL.setAttribute("ry", f1(6 + 9 * sm.Oed));
  ankleR.setAttribute("rx", f1(10 + 17 * sm.Oed)); ankleR.setAttribute("ry", f1(6 + 9 * sm.Oed));
  hairPale.setAttribute("opacity", clamp((1 - sm.Adapt) * 1.1).toFixed(2));
  flakes.forEach((f) => f.setAttribute("opacity", clamp((1 - sm.Adapt) * 1.15).toFixed(2)));
  fibres.forEach((r) => r.setAttribute("width", f1(150 * (1 - 0.68 * sm.Waste))));
  adips.forEach((c, i) => c.setAttribute("r", f1(Math.max(5, 17 * (1 - 0.62 * sm.Waste) + (i % 2) * 1.5))));
  fatDrops.forEach((c) => { c.setAttribute("r", f1(1.5 + 5.5 * sm.Fat)); c.setAttribute("opacity", (0.15 + 0.85 * sm.Fat).toFixed(2)); });
  if (fatGlow) fatGlow.setAttribute("opacity", (0.05 + 0.35 * sm.Fat).toFixed(2));
  const blob = $("oedBlob"); if (blob) { blob.setAttribute("rx", f1(24 + 34 * sm.Oed)); blob.setAttribute("opacity", (0.2 + 0.8 * sm.Oed).toFixed(2)); }
  const leak = $("leakLine"); if (leak) { leak.setAttribute("opacity", (0.1 + 0.8 * sm.Oed).toFixed(2)); leak.setAttribute("stroke-width", f1(2 + 5 * sm.Oed)); }
  const feed = $("feedLine"); if (feed) feed.setAttribute("opacity", (0.55 * sm.refeed).toFixed(2));
  immCells.forEach((c, i) => { place(c, 300 + i * 38, 412 + Math.sin(tm / 700 + i) * 1.5, 0, Math.max(0.3, 1 - sm.ImmLoss)); c.style.opacity = (1 - 0.65 * sm.ImmLoss).toFixed(2); });
  pathGs.forEach((pg) => { place(pg.g, pg.x, pg.y + Math.sin(tm / 800 + pg.x) * 1.5, 0, 1 - 0.5 * sm.antiInf); pg.g.style.opacity = (0.15 + 0.85 * sm.Inf).toFixed(2); });
  /* food falling to the bowl: a thin trickle off treatment, a pour when refeeding */
  acc.food += dt * (0.4 + 5 * sm.refeed); while (acc.food >= 1) { acc.food--; const p = free(foodP); if (p) emit(p, rnd(98, 172), 94, 0, rnd(18, 28), 0); }
  foodP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 122) kill(p); });
  /* refeed stream: food travelling from the bowl to the child's mouth, only when feeding */
  acc.feed += dt * 6 * sm.refeed; while (acc.feed >= 1) { acc.feed--; const p = free(feedP); if (p) { emit(p, 135, 152, 0, 0, 0); p.u = 0; } }
  feedP.forEach((p) => { if (!p.on) return; p.u += dt * 150 / feedTrack.len; const q = feedTrack.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p); });
  /* albumin made by the liver, flowing along the vessel */
  acc.alb += dt * sm.Alb * 5; while (acc.alb >= 1) { acc.alb--; const p = free(albP); if (p) emit(p, albX, 230 + rnd(-6, 6), rnd(28, 42), 0, 0); }
  albP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 896) kill(p); });
  /* fluid leaking from the vessel into the tissues */
  acc.oed += dt * sm.Oed * 4.5; while (acc.oed >= 1) { acc.oed--; const p = free(oedP); if (p) emit(p, rnd(762, 888), 322, rnd(-3, 3), rnd(12, 20), 0); }
  oedP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 354) kill(p); });
  /* pathogens drifting in the infection node */
  acc.path += dt * sm.Inf * 3.5; while (acc.path >= 1) { acc.path--; const p = free(pathP); if (p) emit(p, rnd(532, 560), rnd(402, 422), rnd(14, 26), rnd(-4, 4), 0); }
  pathP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 400 || p.y > 424) p.vy = -p.vy; p.y = clamp(p.y, 400, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 682 || p.t > 6) kill(p); });
  /* infection care: medicine dots swarming the germs while they shrink */
  acc.abx += dt * 7 * sm.antiInf; while (acc.abx >= 1) { acc.abx--; const p = free(abxP); if (p) emit(p, rnd(548, 668), rnd(400, 422), rnd(-8, 8), rnd(-6, 6), 0); }
  abxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 380 + p.y) * 0.3; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2) kill(p); });
  /* micronutrients: golden drops falling on the hair while skin and immunity recover */
  acc.mic += dt * 6 * sm.micro; while (acc.mic >= 1) { acc.mic--; const p = free(micP); if (p) emit(p, rnd(448, 512), 54, 0, rnd(24, 38), 0); }
  micP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 400 + p.y) * 0.25; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 102) kill(p); });
  /* gauges: Albumin and Immunity fill upward when better */
  gg.waste.set(sm.Waste, wordOf(sm.Waste, 0.35, 0.7, ["mild", "moderate", "severe"])); gg.alb.set(sm.Alb, wordOf(1 - sm.Alb, 0.35, 0.65, ["preserved", "low", "very low"]));
  gg.oed.set(sm.Oed, wordOf(sm.Oed, 0.2, 0.55, ["absent", "present", "marked"])); gg.fat.set(sm.Fat, wordOf(sm.Fat, 0.2, 0.55, ["absent", "present", "marked"]));
  gg.imm.set(1 - sm.ImmLoss, wordOf(sm.ImmLoss, 0.35, 0.65, ["kept", "weak", "very weak"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
