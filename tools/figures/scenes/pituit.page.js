/* Pituitary scene: brain control, stalk, gland and adenoma, optic cross, hormone streams to body targets. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), guides: $("guides"), docks: $("docks"), aden: $("adenoma"), chiasm: $("chiasm"), stalk: $("stalk"), veilDA: $("veilDA"), veilSA: $("veilSA"), vfL: $("vfLs"), vfR: $("vfRs"), boneS: $("boneS"), milkG: $("milkG"), milkD: $("milkD"), cap: $("capTxt"), pitG: $("pitG"), adrG: $("adrG"), haloGH: $("haloGH"), haloPRL: $("haloPRL") };
const guideEls = [];
const PIT = { x: 480, y: 246, stalk: [480, 206], base: [480, 262] };
const ADR_TOP = [380, 344];
let brainO = null, thyO = null, gonO = null;
let trGH = null, trACTH = null, trTSH = null, trGON = null, trPRL = null, trStalk = null;
let dockDA = null, dockSA = null, capKey = "";
const CAPS = [
  ["No treatment. Too much prolactin and the tumour presses on vision.",
   "Dopamine drug sits on the gland and blocks prolactin. Tumour shrinks.",
   "Somatostatin drug quiets growth signals a little. Tumour still presses.",
   "Surgery removed the tumour. Pressure on vision is gone."],
  ["No treatment. The gland has failed and all hormones are low.",
   "Dopamine drug docks on the gland but there is no tumour to shrink.",
   "Somatostatin drug docks on the gland but hormones stay low.",
   "Surgery cannot refill a failed gland. Hormones stay low."],
  ["No treatment. Too much growth hormone and the tumour presses on vision.",
   "Dopamine drug lowers prolactin a little. Growth hormone stays high.",
   "Somatostatin drug blocks growth hormone release. Levels fall.",
   "Surgery removed the tumour. Pressure on vision is gone."],
];
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 480, 116, 140, {});
  thyO = organ($("thySlot"), "thyroid", 580, 362, 84, {});
  gonO = organ($("gonSlot"), "uterus", 790, 358, 96, {});
  const stem = brainO.ports.stem || brainO.ports.in, PS = PIT.stalk;
  layers.stalk.setAttribute("d", "M" + f1(stem[0]) + " " + f1(stem[1]) + "L" + f1(PS[0]) + " " + f1(PS[1]));
  trStalk = track([stem, PS]);
  const PB = PIT.base;
  const boneTop = [150, 348], adrTop = ADR_TOP, thyIn = thyO.ports.in, gonTop = gonO.ports.fundus, milkTop = [862, 342];
  trGH = track([PB, [360, 292], [250, 330], boneTop]);
  trACTH = track([PB, [440, 300], [405, 325], adrTop]);
  trTSH = track([PB, [525, 300], [565, 320], thyIn]);
  trGON = track([PB, [580, 295], [690, 315], gonTop]);
  trPRL = track([PB, [620, 300], [750, 320], milkTop]);
  const mkGuide = (tr) => { const q = [0, 0.25, 0.5, 0.75, 1].map((u) => tr.at(u)); guideEls.push(mk("path", { class: "pit-guide", d: "M" + f1(q[0].x) + " " + f1(q[0].y) + "L" + f1(q[1].x) + " " + f1(q[1].y) + "L" + f1(q[2].x) + " " + f1(q[2].y) + "L" + f1(q[3].x) + " " + f1(q[3].y) + "L" + f1(q[4].x) + " " + f1(q[4].y) }, layers.guides)); };
  [trGH, trACTH, trTSH, trGON, trPRL].forEach(mkGuide);
  $("boneG").setAttribute("transform", "translate(150 362)");
  $("milkG").setAttribute("transform", "translate(862 352)");
  dockDA = mk("g", {}, layers.docks); dockSA = mk("g", {}, layers.docks);
  [195, 220, 245, 270, 295, 320, 345].forEach((a) => { const t = a * 0.01745; mk("circle", { class: "sc-p p-da", cx: f1(PIT.x + 31 * Math.cos(t)), cy: f1(PIT.y + 25 * Math.sin(t)), r: 4.5 }, dockDA); });
  [15, 45, 75, 105, 135, 165].forEach((a) => { const t = a * 0.01745; mk("circle", { class: "sc-p p-sa", cx: f1(PIT.x + 31 * Math.cos(t)), cy: f1(PIT.y + 25 * Math.sin(t)), r: 4.5 }, dockSA); });
  dockDA.setAttribute("opacity", "0"); dockSA.setAttribute("opacity", "0");
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, t: 0, u: 0, tr: null }; }); }
const ghP = pool(14, () => mk("circle", { class: "sc-p p-gh", r: 2.8 }, layers.parts));
const acthP = pool(10, () => mk("circle", { class: "sc-p p-acth", r: 2.6 }, layers.parts));
const tshP = pool(10, () => mk("circle", { class: "sc-p p-tsh", r: 2.6 }, layers.parts));
const gonP = pool(14, () => mk("circle", { class: "sc-p p-fsh", r: 2.6 }, layers.parts));
const prlP = pool(10, () => mk("circle", { class: "sc-p p-prl", r: 2.8 }, layers.parts));
const relP = pool(12, () => mk("circle", { class: "sc-p p-rel", r: 2.4 }, layers.parts));
const daP = pool(10, () => mk("circle", { class: "sc-p p-da", r: 3 }, layers.parts));
const saP = pool(10, () => mk("circle", { class: "sc-p p-sa", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function launch(p, tr) { p.on = true; p.tr = tr; p.u = 0; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(p, dt, speed) { p.u += dt * speed / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [140, 340, 540, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["prl", "Prolactin", "g-prl", "Prolactin from the gland. High in prolactinoma, lowered by a dopamine agonist."], ["gh", "Growth hormone", "g-gh", "Growth hormone. High in acromegaly, lowered by a somatostatin analogue or surgery."], ["oth", "Other hormones", "g-oth", "ACTH, TSH, FSH and LH together. Low when the gland fails or a large tumour squeezes it."], ["mass", "Mass effect", "g-mass", "Pressure from a tumour on nearby parts, above all the optic cross."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Optic cross", 480, 167, 668, 72, "Optic cross: nerves from both eyes cross here. A tumour growing upward presses here first, and the outer half of sight fades in both eyes.");
  pill(ox, "Brain control", 415, 105, 292, 72, "Brain control: the brain sends signals down the stalk telling the gland what to release.");
  pill(ox, "Pituitary", 448, 246, 250, 222, "Pituitary gland in its bony pocket. It releases GH, ACTH, TSH, FSH, LH and prolactin into the blood.");
  pill(ox, "Adenoma", 494, 250, 706, 222, "Adenoma: a benign tumour of the gland. It can release extra hormone and press on the cross and the normal gland.");
  pill(ox, "Growth", 150, 362, 150, 306, "Growth: growth hormone builds bone and tissue. Too much in adults thickens hands, feet and jaw.");
  pill(ox, "Adrenal", 380, 350, 380, 306, "Adrenal gland: ACTH tells it to release cortisol for stress and energy.");
  pill(ox, "Thyroid", 580, 350, 580, 306, "Thyroid gland: TSH tells it to release thyroid hormone.");
  pill(ox, "Gonads", 790, 348, 790, 306, "Gonads: FSH and LH drive ovaries and testes. Too much prolactin holds them back while milk flow rises.");
}
const sm = { prl: 0.5, gh: 0.4, acth: 0.3, tsh: 0.3, gon: 0.3, oth: 0.3, mass: 0.5, da: 0, sa: 0, sx: 0, gland: 1 };
const acc = { gh: 0, acth: 0, tsh: 0, gon: 0, prl: 0, rel: 0, da: 0, sa: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.prl = lerp(sm.prl, m.prl, k2); sm.gh = lerp(sm.gh, m.gh, k2); sm.acth = lerp(sm.acth, m.acth, k2); sm.tsh = lerp(sm.tsh, m.tsh, k2);
  sm.gon = lerp(sm.gon, (m.fsh + m.lh) / 2, k2); sm.oth = lerp(sm.oth, m.oth, k2);
  sm.mass = lerp(sm.mass, m.mass, k1); sm.da = lerp(sm.da, m.da, k1); sm.sa = lerp(sm.sa, m.sa, k1); sm.sx = lerp(sm.sx, m.sx, k1); sm.gland = lerp(sm.gland, m.gland, k2);
  layers.aden.setAttribute("r", f1(4 + 22 * sm.mass));
  layers.aden.style.opacity = (0.3 + 0.7 * clamp((sm.mass - 0.08) / 0.6)).toFixed(2);
  layers.pitG.setAttribute("transform", "translate(480 246) scale(" + sm.gland.toFixed(3) + ") translate(-480 -246)");
  layers.chiasm.setAttribute("transform", "translate(0 " + f1(-6 * sm.mass) + ")");
  const shade = clamp((sm.mass - 0.22) * 1.7);
  layers.vfL.setAttribute("opacity", shade.toFixed(2)); layers.vfR.setAttribute("opacity", shade.toFixed(2));
  layers.veilDA.setAttribute("opacity", (0.45 * sm.da).toFixed(2));
  layers.veilSA.setAttribute("opacity", (0.45 * sm.sa).toFixed(2));
  dockDA.setAttribute("opacity", sm.da.toFixed(2)); dockSA.setAttribute("opacity", sm.sa.toFixed(2));
  layers.haloGH.setAttribute("opacity", (0.4 * clamp((sm.gh - 0.4) / 0.6)).toFixed(2));
  layers.haloPRL.setAttribute("opacity", (0.4 * clamp((sm.prl - 0.4) / 0.6)).toFixed(2));
  layers.adrG.style.opacity = (0.5 + 0.5 * sm.acth).toFixed(2);
  layers.adrG.setAttribute("transform", "translate(380 356) scale(" + (0.78 + 0.45 * sm.acth).toFixed(3) + ") translate(-380 -356)");
  thyO.g.style.opacity = (0.5 + 0.5 * sm.tsh).toFixed(2);
  thyO.g.setAttribute("transform", "translate(580 362) scale(" + (0.78 + 0.45 * sm.tsh).toFixed(3) + ") translate(-580 -362)");
  gonO.g.style.opacity = (0.5 + 0.5 * sm.gon).toFixed(2);
  gonO.g.setAttribute("transform", "translate(790 358) scale(" + (0.78 + 0.45 * sm.gon).toFixed(3) + ") translate(-790 -358)");
  guideEls[0].setAttribute("opacity", (0.2 + 0.65 * sm.gh).toFixed(2));
  guideEls[1].setAttribute("opacity", (0.2 + 0.65 * sm.acth).toFixed(2));
  guideEls[2].setAttribute("opacity", (0.2 + 0.65 * sm.tsh).toFixed(2));
  guideEls[3].setAttribute("opacity", (0.2 + 0.65 * sm.gon).toFixed(2));
  guideEls[4].setAttribute("opacity", (0.2 + 0.65 * sm.prl).toFixed(2));
  place(layers.boneS, 0, 0, 0, 0.7 + 0.5 * sm.gh);
  layers.milkD.setAttribute("transform", "translate(0 2) scale(" + (0.55 + 0.55 * sm.prl).toFixed(3) + ") translate(0 -2)");
  layers.milkD.style.opacity = (0.35 + 0.65 * sm.prl).toFixed(2);
  acc.rel += dt * (1 + 5 * sm.oth); while (acc.rel >= 1) { acc.rel--; const p = free(relP); if (p) launch(p, trStalk); }
  relP.forEach((p) => { if (p.on) ride(p, dt, 60); });
  acc.gh += dt * (1 + 10 * sm.gh); while (acc.gh >= 1) { acc.gh--; const p = free(ghP); if (p) launch(p, trGH); }
  ghP.forEach((p) => { if (p.on) ride(p, dt, 80); });
  acc.acth += dt * (0.5 + 7 * sm.acth); while (acc.acth >= 1) { acc.acth--; const p = free(acthP); if (p) launch(p, trACTH); }
  acthP.forEach((p) => { if (p.on) ride(p, dt, 80); });
  acc.tsh += dt * (0.5 + 7 * sm.tsh); while (acc.tsh >= 1) { acc.tsh--; const p = free(tshP); if (p) launch(p, trTSH); }
  tshP.forEach((p) => { if (p.on) ride(p, dt, 80); });
  acc.gon += dt * (0.5 + 7 * sm.gon); while (acc.gon >= 1) { acc.gon--; const p = free(gonP); if (p) { p.e.setAttribute("class", "sc-p " + (Math.random() < 0.5 ? "p-fsh" : "p-lh")); launch(p, trGON); } }
  gonP.forEach((p) => { if (p.on) ride(p, dt, 80); });
  acc.prl += dt * (1 + 10 * sm.prl); while (acc.prl >= 1) { acc.prl--; const p = free(prlP); if (p) launch(p, trPRL); }
  prlP.forEach((p) => { if (p.on) ride(p, dt, 80); });
  acc.da += dt * sm.da * 6; while (acc.da >= 1) { acc.da--; const p = free(daP); if (p) { p.on = true; p.tr = null; p.t = 0; p.x = 300; p.y = 222; p.e.setAttribute("opacity", "1"); } }
  daP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (452 - p.x) * dt * 1.6 + 26 * dt; p.y += (246 - p.y) * dt * 1.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6) kill(p); });
  acc.sa += dt * sm.sa * 6; while (acc.sa >= 1) { acc.sa--; const p = free(saP); if (p) { p.on = true; p.tr = null; p.t = 0; p.x = 300; p.y = 264; p.e.setAttribute("opacity", "1"); } }
  saP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (452 - p.x) * dt * 1.6 + 26 * dt; p.y += (250 - p.y) * dt * 1.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6) kill(p); });
  gg.prl.set(sm.prl, wordOf(sm.prl, 0.35, 0.65, ["low", "normal", "high"]));
  gg.gh.set(sm.gh, wordOf(sm.gh, 0.35, 0.65, ["low", "normal", "high"]));
  gg.oth.set(sm.oth, wordOf(sm.oth, 0.3, 0.6, ["low", "reduced", "normal"]));
  gg.mass.set(sm.mass, wordOf(sm.mass, 0.3, 0.55, ["none", "mild", "marked"]));
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const t = CAPS[level][drug]; if (layers.cap.textContent !== t) layers.cap.textContent = t; }
}
run({ init, step });
