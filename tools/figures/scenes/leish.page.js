/* Kala-azar scene: sandfly, promastigotes, macrophages with amastigotes, liver spleen marrow, fever, patches and gauges. */
const layers = { organs: $("organs"), patches: $("patches"), fly: $("fly"), rbcs: $("rbcs"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), spleenG: $("spleenG") };
/* ---- macrophages with amastigote dots inside ---- */
const macPos = [[125, 250], [390, 207], [705, 142], [665, 278], [854, 351]];
const macs = macPos.map(([x, y], i) => {
  const g = cell(layers.cells, { cls: "mac", r: i === 4 ? 20 : 24, nuc: 0.4, seed: i * 3 + 1, wob: 0.12 });
  const ama = [];
  for (let j = 0; j < 7; j++) { const c = mk("circle", { class: "p-am", r: 2.6, cx: f1(Math.cos(j * 2.4) * 10), cy: f1(Math.sin(j * 1.9) * 8) }, g); ama.push(c); }
  return { g, x, y, ama, ph: i * 1.7 };
});
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbcs() { for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(250, 530), y: rnd(-14, 14), v: rnd(0.8, 1.2) }); } }
/* ---- sandfly, bite, heat waves, skin patches ---- */
let heatG = null, patchEls = [];
function initScene() {
  const f = layers.fly;
  mk("ellipse", { class: "le-flyW", cx: 72, cy: 92, rx: 16, ry: 6, transform: "rotate(-24 72 92)" }, f);
  mk("ellipse", { class: "le-flyW", cx: 104, cy: 92, rx: 16, ry: 6, transform: "rotate(24 104 92)" }, f);
  mk("ellipse", { class: "le-flyB", cx: 88, cy: 108, rx: 13, ry: 7 }, f);
  mk("circle", { class: "le-flyB", cx: 100, cy: 103, r: 5 }, f);
  mk("path", { class: "p-flag", d: "M103 106L116 128" }, f);
  mk("path", { class: "p-flag", d: "M80 114L70 128M88 115L86 130M96 114L102 128" }, f);
  mk("circle", { class: "le-bite", cx: 118, cy: 132, r: 4 }, f);
  heatG = mk("g", { id: "heat" }, layers.over);
  [330, 390, 450].forEach((x, i) => { mk("path", { class: "p-heat", d: "M" + x + " 128c-6 -10 6 -14 0 -24c-6 -10 6 -14 0 -24" }, heatG); });
  patchEls = [[70, 338], [118, 366], [172, 332], [92, 392], [208, 356]].map(([x, y]) => mk("ellipse", { class: "le-patch", cx: x, cy: y, rx: 13, ry: 8 }, layers.patches));
}
/* ---- particle pools (items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const pros = pool(20, () => { const g = mk("g", {}, layers.parts); mk("ellipse", { class: "p-pro", rx: 7, ry: 3.2 }, g); mk("path", { class: "p-flag", d: "M7 0C12 -3 15 -6 17 -10" }, g); return g; });
const trts = pool(14, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-trt", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-trt2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const sups = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["par", "Parasite", "g-par", "Parasite load inside macrophages of liver, spleen and marrow."], ["fev", "Fever", "g-fever", "Prolonged fever as parasite load and inflammation rise."], ["spl", "Spleen", "g-spleen", "Spleen size. In advanced kala-azar the spleen is massive."], ["bc", "Blood cells", "g-good", "Blood cells overall. Marrow involvement and a large spleen lower red cells, white cells and platelets together: pancytopenia."], ["ab", "Antibody", "g-cyt", "Antibody level. Hypergammaglobulinaemia: many antibodies are made but they do not clear parasites inside macrophages."], ["sk", "Skin form", "g-bad", "Post kala-azar dermal form: patches and nodules in skin after or alongside visceral disease."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Sandfly", 100, 103, 88, 78, "Sandfly: the bite injects promastigotes into skin.");
  pill(ox, "Promastigote", 165, 190, 150, 168, "Promastigote: the slender form with a tail-like flagellum, put into skin by the sandfly.");
  pill(ox, "Macrophage", 125, 250, 125, 295, "Macrophage: takes up promastigotes. Inside it they change into amastigotes and multiply.");
  pill(ox, "Amastigotes", 705, 142, 805, 92, "Amastigotes: the round form living and multiplying inside macrophages, seen here in the liver macrophage.");
  pill(ox, "Liver", 770, 128, 860, 170, "Liver: macrophages here carry parasites and the liver enlarges.");
  pill(ox, "Spleen", 665, 278, 545, 345, "Spleen: loaded with parasitised macrophages, it enlarges greatly. A massive spleen also traps blood cells.");
  pill(ox, "Marrow", 854, 351, 850, 410, "Bone marrow: parasitised macrophages and crowding contribute to pancytopenia.");
  pill(ox, "Skin patches", 118, 360, 190, 382, "Skin patches of the post kala-azar dermal form, where parasites persist in skin.");
}
const sm = { P: 0.4, F: 0.3, Sp: 0.4, Bc: 0.6, G: 0.3, D: 0.1, kill: 0, sup: 0 };
const acc = { pro: 0, trt: 0, sup: 0 };
function init() { initRbcs(); initScene(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.7), k2 = Math.min(1, dt * 0.45);
  sm.P = lerp(sm.P, m.P, k2); sm.F = lerp(sm.F, m.F, k2); sm.Sp = lerp(sm.Sp, m.Sp, k2); sm.Bc = lerp(sm.Bc, m.Bc, k2); sm.G = lerp(sm.G, m.G, k2); sm.D = lerp(sm.D, m.D, k2); sm.kill = lerp(sm.kill, m.kill, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  macs.forEach((mm, i) => {
    place(mm.g, mm.x + Math.sin(tm / 1600 + mm.ph) * 2.5, mm.y + Math.cos(tm / 1900 + mm.ph) * 2, Math.sin(tm / 2600 + mm.ph) * 5, 1);
    mm.ama.forEach((c, j) => { const on = sm.P * 7 > j + 0.4; c.style.opacity = on ? "0.95" : "0.08"; });
  });
  layers.spleenG.setAttribute("transform", "translate(665 278) scale(" + (0.72 + 0.55 * sm.Sp).toFixed(3) + ") translate(-665 -278)");
  if (heatG) heatG.setAttribute("opacity", (sm.F * 0.9).toFixed(2));
  patchEls.forEach((e, i) => { const s = clamp((sm.D - i * 0.1) * 1.6); e.setAttribute("transform", "translate(0 0)"); e.style.opacity = (s * 0.9).toFixed(2); });
  rbcs.forEach((r) => { r.x += r.v * 52 * clamp(0.35 + sm.Bc) * dt; if (r.x > 532) { r.x = 250; r.y = rnd(-14, 14); } place(r.g, r.x, 207 + r.y, Math.sin(tm / 500 + r.x) * 8, 0.4 + 0.6 * sm.Bc); r.g.style.opacity = sm.Bc > 0.18 ? 1 : 0.35; });
  /* promastigotes: bite to a macrophage */
  acc.pro += dt * (1.2 + 3.2 * sm.P) * (1 - sm.kill * 0.45);
  while (acc.pro >= 1) { acc.pro--; const p = freeP(pros); if (p) emit(p, 118, 136, Math.floor(rnd(0, macs.length))); }
  pros.forEach((p) => { if (!p.on) return; const mm = macs[p.k], dx = mm.x - p.x, dy = mm.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 56 * dt; p.y += (dy / d) * 56 * dt; p.x = clamp(p.x, 30, 932); p.y = clamp(p.y, 56, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.atan2(dy, dx) * 57.3) + ")"); if (d < 24) killP(p); });
  /* parasite killing treatment: left to macrophages */
  acc.trt += dt * sm.kill * 5;
  while (acc.trt >= 1) { acc.trt--; const p = freeP(trts); if (p) emit(p, rnd(30, 90), 190, Math.floor(rnd(0, macs.length))); }
  trts.forEach((p) => { if (!p.on) return; p.t += dt; const mm = macs[p.k], dx = mm.x - p.x, dy = mm.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (d < 24) killP(p); });
  /* supportive drops toward marrow and spleen */
  acc.sup += dt * sm.sup * 4;
  while (acc.sup >= 1) { acc.sup--; const p = freeP(sups); if (p) emit(p, 260, 207, Math.random() < 0.5 ? 3 : 4); }
  sups.forEach((p) => { if (!p.on) return; const mm = macs[p.k], dx = mm.x - p.x, dy = mm.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 58 * dt; p.y += (dy / d) * 58 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 22) killP(p); });
  gg.par.set(sm.P, wordOf(sm.P, 0.25, 0.55, ["low", "moderate", "high"]));
  gg.fev.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["none", "present", "high"]));
  gg.spl.set(sm.Sp, wordOf(sm.Sp, 0.3, 0.65, ["near normal", "enlarged", "massive"]));
  gg.bc.set(sm.Bc, wordOf(sm.Bc, 0.35, 0.65, ["low", "reduced", "near normal"]));
  gg.ab.set(sm.G, wordOf(sm.G, 0.3, 0.6, ["normal", "raised", "very high"]));
  gg.sk.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["none", "possible", "present"]));
}
run({ init, step });
