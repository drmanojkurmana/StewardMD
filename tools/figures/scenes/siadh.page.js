/* SIADH and diabetes insipidus scene: pituitary ADH, blood, collecting duct aquaporin-2, brain and urine. */
const WW = SC.W;
const layers = { brain: $("brain"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), urinefill: $("urinefill"), duct: $("ductcells") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freePool = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dropD = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
const adhP = pool(16, () => mk("circle", { class: "sc-p p-adh", r: 3 }, layers.parts));
const saltP = pool(16, () => mk("path", { class: "sc-p p-salt2", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const watP = pool(16, () => mk("path", { class: "p-fl", d: dropD }, layers.parts));
const reabP = pool(18, () => mk("path", { class: "p-fl", d: dropD }, layers.parts));
const urineP = pool(18, () => mk("path", { class: "p-fl", d: dropD }, layers.parts));
const thirstP = pool(10, () => mk("path", { class: "p-fl", d: dropD }, layers.parts));
/* collecting duct wall cells and aquaporin gates */
const aqpGates = [];
[92, 122, 152, 182].forEach((y, i) => {
  cell(layers.duct, { cls: "endo", r: 13, nuc: 0.3, seed: i + 3, wob: 0.08, x: 764, y });
  cell(layers.duct, { cls: "endo", r: 13, nuc: 0.3, seed: i + 13, wob: 0.08, x: 800, y });
  aqpGates.push(mk("rect", { class: "si-aqp", x: 758, y: y - 5, width: 6, height: 10, rx: 2 }, layers.duct));
  aqpGates.push(mk("rect", { class: "si-aqp", x: 800, y: y - 5, width: 6, height: 10, rx: 2 }, layers.duct));
});
/* brain cell group */
const brainG = mk("g", {}, layers.brain);
cell(brainG, { cls: "endo", r: 46, nuc: 0.34, seed: 5, wob: 0.1, x: 0, y: 0 });
cell(brainG, { cls: "endo", r: 16, nuc: 0.38, seed: 9, wob: 0.12, x: -58, y: 28 });
cell(brainG, { cls: "endo", r: 14, nuc: 0.38, seed: 15, wob: 0.12, x: 58, y: 24 });
cell(brainG, { cls: "endo", r: 11, nuc: 0.38, seed: 21, wob: 0.12, x: 30, y: -42 });
const BRAIN = { x: 196, y: 344 };
/* thirst cup */
const cupG = mk("g", {}, layers.parts);
mk("path", { class: "si-watercup", d: "M368 318h44l-6 52h-32Z" }, cupG);
const cupWater = mk("rect", { class: "p-fl", x: 374, y: 330, width: 32, height: 22, rx: 3 }, cupG);
const sm = { ADH: 0.5, AQP: 0.5, Re: 0.5, Uv: 0.4, Uc: 0.5, Na: 0.5, Wat: 0.5, Th: 0.3, Bw: 0.5 };
const acc = { adh: 0, salt: 0, wat: 0, reab: 0, urine: 0, thirst: 0 };
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 260, 430, 600, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["adh", "ADH effect", "g-adh", "ADH effect at the collecting duct: ADH amount reaching the duct and aquaporin-2 inserted in its wall."],
   ["re", "Water back", "g-re", "Water reabsorbed from the collecting duct back into the body. High in SIADH, low in diabetes insipidus."],
   ["uv", "Urine flow", "g-uv", "Urine volume. Small when water is held, large when water is lost in diabetes insipidus."],
   ["na", "Sodium", "g-na2", "Blood sodium concentration: salt relative to water. Diluted and low in SIADH, concentrated and high in diabetes insipidus."],
   ["bw", "Brain water", "g-bw", "Water inside brain cells. The brain swells when sodium is diluted and shrinks when sodium is concentrated."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Pituitary", 168, 118, 190, 86, "Posterior pituitary: stores and releases ADH made in the hypothalamus into the blood.");
  pill(ox, "ADH", 212, 148, 268, 108, "ADH (vasopressin): hormone carried in blood to the kidney collecting duct.");
  pill(ox, "Blood", 460, 126, 460, 86, "Blood: carries ADH and holds salt relative to water, which sets sodium concentration.");
  pill(ox, "Aquaporin-2", 765, 118, 700, 84, "Aquaporin-2: water channels inserted into the collecting duct wall when ADH acts, letting water leave the urine and return to the body.");
  pill(ox, "Duct wall", 814, 158, 862, 120, "Collecting duct wall: in nephrogenic diabetes insipidus it does not respond to ADH, so aquaporin-2 stays out and water is lost.");
  pill(ox, "Water returns", 778, 174, 668, 196, "Water reabsorption: water crossing the duct wall back into the body. High in SIADH, low in diabetes insipidus.");
  pill(ox, "Brain cell", 196, 302, 200, 262, "Brain cell: swells when blood sodium is diluted by retained water, and shrinks when sodium is concentrated by water loss.");
  pill(ox, "Thirst", 390, 318, 392, 268, "Thirst: driven when blood becomes concentrated in diabetes insipidus, prompting drinking.");
  pill(ox, "Urine", 715, 296, 715, 262, "Urine: small and concentrated in SIADH, large and dilute in diabetes insipidus. Colour depth shows concentration, height shows volume.");
}
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.ADH = lerp(sm.ADH, m.ADH, k2); sm.AQP = lerp(sm.AQP, m.AQP, k2); sm.Re = lerp(sm.Re, m.Re, k2);
  sm.Uv = lerp(sm.Uv, m.Uv, k2); sm.Uc = lerp(sm.Uc, m.Uc, k2); sm.Na = lerp(sm.Na, m.Na, k2);
  sm.Wat = lerp(sm.Wat, m.Wat, k2); sm.Th = lerp(sm.Th, m.Th, k2); sm.Bw = lerp(sm.Bw, m.Bw, k2);
  /* duct gates open with ADH effect */
  aqpGates.forEach((g) => g.classList.toggle("open", sm.AQP > 0.45));
  /* brain swell or shrink */
  brainG.setAttribute("transform", "translate(" + BRAIN.x + " " + BRAIN.y + ") scale(" + (0.78 + 0.5 * sm.Bw).toFixed(3) + ")");
  /* thirst cup empties as thirst rises */
  cupWater.setAttribute("height", f1(6 + 20 * (1 - sm.Th)));
  cupWater.setAttribute("y", f1(352 - (6 + 20 * (1 - sm.Th))));
  /* urine beaker: height is volume, depth is concentration */
  const uh = 14 + sm.Uv * 88;
  layers.urinefill.setAttribute("y", f1(404 - uh)); layers.urinefill.setAttribute("height", f1(uh));
  layers.urinefill.setAttribute("opacity", (0.3 + 0.65 * sm.Uc).toFixed(2));
  /* ADH from pituitary through blood to the duct */
  acc.adh += dt * (0.6 + sm.ADH * 7); while (acc.adh >= 1) { acc.adh--; const p = freePool(adhP); if (p) emit(p, 198, 148 + rnd(-10, 10), 72, 0, 0); }
  adhP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 360 + p.x * 0.04) * 7 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 756) kill(p); });
  /* blood salt and water show concentration */
  acc.salt += dt * (1 + sm.Na * 7); while (acc.salt >= 1) { acc.salt--; const p = freePool(saltP); if (p) emit(p, 334, 155 + rnd(-20, 20), 52, 0, 0); }
  saltP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 586) kill(p); });
  acc.wat += dt * (1 + sm.Wat * 6); while (acc.wat >= 1) { acc.wat--; const p = freePool(watP); if (p) emit(p, 334, 155 + rnd(-20, 20), 44, 0, 0); }
  watP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 586) kill(p); });
  /* water reabsorbed out of the duct */
  acc.reab += dt * (0.4 + sm.Re * 9); while (acc.reab >= 1) { acc.reab--; const p = freePool(reabP); if (p) emit(p, 778, rnd(92, 188), -58, 0, 0); }
  reabP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 664) kill(p); });
  /* urine falling into the beaker */
  acc.urine += dt * (0.5 + sm.Uv * 9); while (acc.urine >= 1) { acc.urine--; const p = freePool(urineP); if (p) emit(p, 782 + rnd(-4, 4), 204, 0, 62, 0); }
  urineP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 398) kill(p); });
  /* thirst droplets move from cup toward the brain */
  acc.thirst += dt * sm.Th * 5; while (acc.thirst >= 1) { acc.thirst--; const p = freePool(thirstP); if (p) emit(p, 366, 340 + rnd(-12, 12), -52, 0, 0); }
  thirstP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 252) kill(p); });
  gg.adh.set(sm.AQP, wordOf(sm.AQP, 0.3, 0.65, ["low", "normal", "high"]));
  gg.re.set(sm.Re, wordOf(sm.Re, 0.3, 0.65, ["low", "normal", "high"]));
  gg.uv.set(sm.Uv, wordOf(sm.Uv, 0.3, 0.65, ["small", "normal", "large"]));
  gg.na.set(sm.Na, wordOf(sm.Na, 0.35, 0.65, ["low", "normal", "high"]));
  gg.bw.set(sm.Bw, wordOf(sm.Bw, 0.35, 0.65, ["shrunken", "normal", "swollen"]));
}
run({ init, step });
