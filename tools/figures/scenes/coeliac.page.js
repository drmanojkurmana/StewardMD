/* Coeliac scene: gluten and nutrients in the lumen, deamidation, HLA presentation, T-cell attack, villi, crypts, blood and gauges.
 * Small bowel and a blood vessel come from organs.lib.js. The strip is a magnified patch of the bowel wall; absorbed nutrients drain to blood.
 * Each treatment visibly acts on the drawing: a gluten-free diet stops the gluten rain so the attack fades and villi regrow tall, and nutrient
 * replacement floods the vessel with green stores while villi stay flat. A caption in the stage follows the state. */
const SURF = SC.SURF, WW = SC.W;
const layers = { bowelS: $("bowelSlot"), vesselS: $("vesselSlot"), crypts: $("crypts"), villi: $("villi"), parts: $("parts"), immune: $("immune"), over: $("over"), panel: $("panel"), gfdWash: $("gfdWash"), replWash: $("replWash"), halo: $("replHalo") };
/* ---- real anatomy; flows and labels anchor to its ports ---- */
let bowelO = null, vesselO = null, vTop = [862, 245], vBot = [862, 394];
function initOrgans() {
  bowelO = organ(layers.bowelS, "bowel", 862, 128, 140, {});
  vesselO = organ(layers.vesselS, "vessel", 862, 320, 60, {});
  vTop = vesselO.ports.in; vBot = vesselO.ports.out;
}
function capText(l, d) {
  if (d === 1) return "Gluten-free diet. No gluten arrives, the attack settles and villi regrow, so food is absorbed again.";
  if (d === 2) return "Nutrient replacement. Stores rise but gluten still attacks, so villi stay flat.";
  if (l === 0) return "Healthy lining. Villi are tall and absorb food well.";
  return "No treatment. Gluten drives the attack, villi flatten and food is poorly absorbed.";
}
/* ---- villi and crypts (rebuilt each step from villus height and crypt depth) ---- */
const vilX = [110, 230, 350, 470, 590, 710];
const vilEls = vilX.map((x) => mk("path", { class: "co-villus" }, layers.villi));
mk("path", { class: "co-surface", d: "M24 " + SURF + "L936 " + SURF }, layers.villi);
const cryX = [170, 290, 410, 530, 650, 770];
const cryEls = cryX.map((x) => mk("rect", { class: "co-crypt", x: x - 11, y: SURF, width: 22, height: 30, rx: 10 }, layers.crypts));
/* ---- immune cells in the lamina propria ---- */
const apc = { g: cell(layers.immune, { cls: "mac", r: 23, nuc: 0.42, seed: 3, wob: 0.12 }), x: 500, y: 350 };
const tcells = [{ g: cell(layers.immune, { cls: "lymph", r: 15, nuc: 0.5, seed: 7, wob: 0.1 }), x: 612, y: 344 }, { g: cell(layers.immune, { cls: "lymph", r: 13, nuc: 0.5, seed: 11, wob: 0.1 }), x: 662, y: 364 }];
const plasma = { g: cell(layers.immune, { cls: "bcell", r: 17, nuc: 0.4, seed: 5, wob: 0.1 }), x: 730, y: 352 };
[[330, 344], [382, 362], [434, 344]].forEach(([x, y]) => mk("path", { class: "p-ttg", d: "M0 -6L5 0L0 6L-5 0Z", transform: "translate(" + x + " " + y + ")" }, layers.immune));
/* ---- red cells in the blood vessel and the blood band ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 9; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.immune); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(30, 930), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const glu = pool(24, () => mk("circle", { class: "sc-p p-glu", r: 3.4 }, layers.parts));
const deam = pool(16, () => mk("path", { class: "sc-p p-deam", d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z" }, layers.parts));
const atk = pool(24, () => mk("circle", { class: "sc-p p-atk", r: 2.5 }, layers.parts));
const iron = pool(10, () => mk("circle", { class: "sc-p p-iron", r: 3 }, layers.parts));
const folate = pool(10, () => mk("path", { class: "sc-p p-folate", d: "M0 -4L4 3L-4 3Z" }, layers.parts));
const fat = pool(10, () => mk("circle", { class: "sc-p p-fat", r: 5 }, layers.parts));
const absPool = pool(12, () => mk("path", { class: "co-ab", d: "M0 2L0 -4M0 -1L-4 -6M0 -1L4 -6" }, layers.parts));
const replP = pool(12, () => mk("circle", { class: "sc-p p-repl", r: 3.4 }, layers.parts));
const nutDots = pool(14, () => mk("circle", { class: "sc-p p-nut", r: 3 }, layers.parts));
const vesRbc = pool(4, () => mk("circle", { class: "sc-p p-vb", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function move(p, dt) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); }
/* ---- labels, caption and gauges ---- */
const gg = {};
let capEl = null, capL = -1, capD = -1;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The mucosa and the body";
  [["gli", "Gliadin", "g-gli", "Altered gliadin load: gluten peptides changed by tissue transglutaminase so they bind HLA strongly."], ["atk", "T cells", "g-atk", "Activated gluten-specific T cells attacking enterocytes in the mucosa."], ["ab", "Antibodies", "g-ab2", "Antibodies to tissue transglutaminase and endomysium, markers of coeliac disease."], ["vil", "Villi", "g-vil", "Villus height: tall villi give a large absorptive surface, flat villi give almost none."], ["abs", "Absorption", "g-abs", "How well iron, folate, fat and other nutrients cross the mucosa into the blood."], ["nut", "Nutrients", "g-nut", "Nutrient stores in the body. Replacement can raise these even while the mucosa stays flat."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Gluten", 150, 118, 150, 86, "Gluten from food, with its gliadin part, reaches the bowel. A gluten-free diet removes this trigger.");
  pill(ox, "Small bowel", 865, 131, 860, 54, "Small bowel, inset. The strip is a magnified patch of its wall.");
  pill(ox, "Villi and crypts", 470, 229, 470, 140, "Villi and crypts. Tall villi absorb iron, folate and fat. Attack flattens villi and crypts deepen to replace lost cells.");
  pill(ox, "tTG enzyme", 330, 344, 285, 382, "tTG enzyme in the wall. It alters gluten so the immune system sees it far more strongly.");
  pill(ox, "Gluten presenter", 500, 328, 440, 382, "Antigen presenting cell. It shows altered gluten to T cells and starts the attack.");
  pill(ox, "T cell attack", 630, 335, 600, 382, "Activated T cells. Their attack injures the lining and flattens the villi.");
  pill(ox, "Antibodies", 730, 330, 735, 382, "Plasma cell. It makes antibodies to tTG, whose level marks disease activity.");
  pill(ox, "Blood", 862, 310, 865, 228, "Blood. Iron, folate and fat cross tall villi into blood here. Replacement adds nutrients directly.");
  capEl = mk("text", { class: "co-cap", x: 30, y: 436 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { Gl: 0.9, D: 0.4, I: 0.4, Ab: 0.3, V: 0.5, C: 0.5, Abs: 0.5, N: 0.5, gfd: 0, repl: 0 };
const acc = { glu: 0, deam: 0, atk: 0, nut: 0, ab: 0, repl: 0, nd: 0 };
function init() { initOrgans(); initRbc(); initPanel(); }
function villusD(x, h) { const top = SURF - h; return "M" + f1(x - 26) + " " + SURF + "L" + f1(x - 26) + " " + f1(top + 22) + "Q" + f1(x - 26) + " " + f1(top) + " " + f1(x) + " " + f1(top) + "Q" + f1(x + 26) + " " + f1(top) + " " + f1(x + 26) + " " + f1(top + 22) + "L" + f1(x + 26) + " " + SURF + "Z"; }
function stepNut(pl, dt) { pl.forEach((p) => { if (!p.on) return; move(p, dt); if (p.k === 0 && p.y > 268) { p.vy = 0; p.vx = 55; } if (p.y > 414 || p.x > 938 || p.t > 9) kill(p); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Gl = lerp(sm.Gl, m.Gl, k1); sm.D = lerp(sm.D, m.D, k2); sm.I = lerp(sm.I, m.I, k2); sm.Ab = lerp(sm.Ab, m.Ab, k2); sm.V = lerp(sm.V, m.V, k2); sm.C = lerp(sm.C, m.C, k2); sm.Abs = lerp(sm.Abs, m.Abs, k2); sm.N = lerp(sm.N, m.N, k2); sm.gfd = lerp(sm.gfd, m.gfd, k1); sm.repl = lerp(sm.repl, m.repl, k1);
  /* villi shrink and crypts deepen with attack */
  const vh = 14 + sm.V * 108;
  vilEls.forEach((e, i) => e.setAttribute("d", villusD(vilX[i], vh + Math.sin(tm / 900 + i) * 2)));
  cryEls.forEach((e) => e.setAttribute("height", f1(22 + sm.C * 48)));
  /* treatment washes: clean lumen on a gluten-free diet, fed blood on replacement */
  layers.gfdWash.setAttribute("opacity", (sm.gfd * 0.22).toFixed(2));
  layers.replWash.setAttribute("opacity", (sm.repl * 0.38).toFixed(2));
  layers.halo.setAttribute("opacity", (sm.repl * 0.45).toFixed(2));
  /* immune cells: gentle bob, T cells swell with activation */
  place(apc.g, apc.x + Math.sin(tm / 1500) * 3, apc.y + Math.cos(tm / 1800) * 2, Math.sin(tm / 2600) * 5, 1);
  tcells.forEach((c, i) => place(c.g, c.x, c.y, Math.sin(tm / 500 + i) * 8, 1 + 0.16 * sm.I * (0.5 + 0.5 * Math.sin(tm / 320 + i))));
  place(plasma.g, plasma.x, plasma.y + Math.sin(tm / 1700) * 2, 0, 1 + 0.08 * sm.Ab * Math.sin(tm / 380));
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 936) r.x = 28; place(r.g, r.x, 415, 0, 1); });
  /* blood drifts down inside the vessel */
  vesRbc.forEach((p, i) => { if (!p.on) emit(p, vTop[0] + rnd(-7, 7), vTop[1] + (i * 37) % 140, 0, rnd(38, 52), 0); p.y += p.vy * dt; if (p.y > vBot[1]) { p.y = vTop[1]; p.x = vTop[0] + rnd(-7, 7); } place(p.e, p.x, p.y, 0, 1); });
  /* gluten drifts down from the lumen to the mucosal surface */
  acc.glu += dt * sm.Gl * 7; while (acc.glu >= 1) { acc.glu--; const p = free(glu); if (p) emit(p, rnd(50, 760), rnd(52, 110), rnd(-5, 5), rnd(16, 26), 0); }
  glu.forEach((p) => { if (!p.on) return; move(p, dt); if (p.y > SURF - vh + 8 || p.t > 8) kill(p); });
  /* deamidated gliadin crosses to the antigen-presenting cell */
  acc.deam += dt * sm.D * 6; while (acc.deam >= 1) { acc.deam--; const p = free(deam); if (p) emit(p, rnd(90, 700), SURF + 6, 0, 0, 0); }
  deam.forEach((p) => { if (!p.on) return; const dx = apc.x - p.x, dy = apc.y - p.y, d = Math.hypot(dx, dy) || 1; p.vx = (dx / d) * 46; p.vy = (dy / d) * 46; move(p, dt); if (d < 24 || p.t > 8) kill(p); });
  /* T-cell attack signals rise to the villus bases */
  acc.atk += dt * sm.I * 11; while (acc.atk >= 1) { acc.atk--; const p = free(atk), c = pick(tcells); if (p && c) emit(p, c.x + rnd(-10, 10), c.y - 12, rnd(-8, 8), -rnd(28, 44), 0); }
  atk.forEach((p) => { if (!p.on) return; move(p, dt); if (p.y < SURF + 4 || p.t > 5) kill(p); });
  /* nutrients: absorbed ones reach the blood, the rest wash along the lumen */
  acc.nut += dt * 5.2; while (acc.nut >= 1) { acc.nut--; const pl = pick([iron, folate, fat]), p = free(pl); if (p) emit(p, rnd(50, 760), rnd(52, 110), rnd(-4, 4), rnd(24, 34), Math.random() < sm.Abs ? 1 : 0); }
  stepNut(iron, dt); stepNut(folate, dt); stepNut(fat, dt);
  /* green stores drain to blood: absorbed food through the mucosa, replacement through the vessel top */
  acc.nd += dt * (sm.repl * 7 + sm.Abs * 4); while (acc.nd >= 1) { acc.nd--; const p = free(nutDots); if (p) {
    if (Math.random() < sm.repl / Math.max(0.05, sm.repl + sm.Abs)) emit(p, vTop[0] + rnd(-8, 8), vTop[1] + 4, rnd(-4, 4), rnd(50, 70), 0);
    else emit(p, rnd(60, 750), rnd(282, 300), rnd(-6, 6), rnd(20, 30), 0); } }
  nutDots.forEach((p) => { if (!p.on) return; move(p, dt); p.e.setAttribute("opacity", clamp(1 - (p.y - 380) / 40).toFixed(2)); if (p.y > 420 || p.t > 8) kill(p); });
  /* antibodies drift from the plasma cell */
  acc.ab += dt * sm.Ab * 5; while (acc.ab >= 1) { acc.ab--; const p = free(absPool); if (p) emit(p, plasma.x + rnd(-8, 8), plasma.y - 14, rnd(-18, -6), rnd(-16, -8), 0); }
  absPool.forEach((p) => { if (!p.on) return; move(p, dt); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4 || p.y < 296 || p.x < 30) kill(p); });
  /* replacement nutrients enter along the blood */
  acc.repl += dt * sm.repl * 6; while (acc.repl >= 1) { acc.repl--; const p = free(replP); if (p) emit(p, 28, 415 + rnd(-7, 7), rnd(60, 85), 0, 0); }
  replP.forEach((p) => { if (!p.on) return; move(p, dt); if (p.x > 936) kill(p); });
  /* gauges */
  gg.gli.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["none", "some", "high"])); gg.atk.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "moderate", "high"])); gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.vil.set(sm.V, wordOf(sm.V, 0.35, 0.7, ["flat", "short", "tall"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.35, 0.65, ["poor", "reduced", "good"])); gg.nut.set(sm.N, wordOf(sm.N, 0.35, 0.65, ["low", "borderline", "ok"]));
  if (level !== capL || drug !== capD) { capL = level; capD = drug; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
