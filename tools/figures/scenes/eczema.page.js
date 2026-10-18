/* Atopic dermatitis scene: barrier bricks, water loss, allergen entry, Staph, Th2, IgE, itch nerve and gauges. */
const layers = { bricks: $("bricks"), staph: $("staphG"), cells: $("cellsG"), parts: $("parts"), over: $("over"), panel: $("panel"), epi: $("epi"), scratch: $("scratchG") };
/* barrier bricks: two staggered rows on the skin surface */
const bricks = [];
function initBricks() {
  for (let r = 0; r < 2; r++) for (let i = 0; i < 14; i++) {
    const e = mk("rect", { class: "brick", x: -19, y: -7, width: 38, height: 13, rx: 3 }, layers.bricks);
    bricks.push({ e, x: 48 + i * 44 + (r ? 22 : 0), y: 188 + r * 16, r, i });
  }
}
/* Staph clusters sitting on the surface */
const staphs = [70, 150, 430, 500, 610].map(function (x, i) {
  const g = mk("g", {}, layers.staph);
  [[0, 0], [7, -4], [4, 5], [-6, 4]].forEach(function (o) { mk("circle", { class: "staph-c", cx: o[0], cy: o[1], r: 4.2 }, g); });
  return { g, x, y: 172, i };
});
/* immune cells in the dermis */
const th2g = mk("g", {}, layers.cells); const th2c = cell(th2g, { cls: "th2", r: 23, nuc: 0.42, seed: 3, wob: 0.12 });
const bcg = mk("g", {}, layers.cells); const bc = cell(bcg, { cls: "bcell", r: 19, nuc: 0.4, seed: 7, wob: 0.1 });
const mastg = mk("g", {}, layers.cells); const mastc = cell(mastg, { cls: "mast", r: 17, nuc: 0.35, seed: 11, wob: 0.13 });
place(th2g, 170, 338, 0, 1); place(bcg, 320, 348, 0, 1); place(mastg, 455, 348, 0, 1);
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const water = pool(24, function () { return mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const allg = pool(20, function () { return mk("path", { class: "sc-p p-allg", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts); });
const cyt = pool(32, function () { return mk("circle", { class: "sc-p p-cyt", r: 2.5 }, layers.parts); });
const iges = pool(16, function () { const g = mk("g", {}, layers.parts); mk("path", { class: "ige-p", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; });
const itchp = pool(14, function () { return mk("circle", { class: "sc-p p-cyt2", r: 2.3 }, layers.parts); });
const treat = pool(16, function () { return mk("circle", { class: "sc-p p-treat", r: 3 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* labels and gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The skin";
  [["barr", "Barrier", "g-bad", "How broken the filaggrin barrier is. More gaps mean more water out and more allergen in."], ["water", "Water loss", "g-fl", "Water escaping through the broken surface. This dries the skin."], ["th2", "Th2", "g-cyt", "Th2 inflammation driven by IL-4 and IL-13. It weakens the barrier and drives itch."], ["ige", "IgE", "g-eos", "IgE made with Th2 help. It arms allergy cells in the skin."], ["itch", "Itch", "g-bad", "Itch signals travelling up skin nerves. Scratching then breaks the barrier again."], ["staph", "Staph", "g-clot", "Staphylococcus aureus colonising broken, inflamed skin. It can worsen flares."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Staph", 95, 168, 92, 92, "Staphylococcus aureus clusters colonising the broken skin surface. They can trigger and worsen flares.");
  pill(ox, "Water loss", 360, 162, 300, 92, "Water escaping through gaps in the barrier. The skin dries out and cracks more easily.");
  pill(ox, "Allergen entry", 500, 186, 470, 92, "Allergens slipping through barrier gaps into the skin, where they meet immune cells.");
  pill(ox, "Broken barrier", 200, 194, 180, 138, "Filaggrin helps the outer skin bricks hold together. When it is lacking or reduced, gaps open between them.");
  pill(ox, "Scratch", 590, 182, 560, 138, "Scratching for itch tears the surface. That lets in more allergen and Staph, so itch returns: the itch and scratch cycle.");
  pill(ox, "Th2 IL-4 IL-13", 170, 316, 150, 292, "Th2 helper cells release IL-4 and IL-13. These weaken the barrier, help IgE making and drive itch.");
  pill(ox, "IgE", 320, 330, 320, 292, "B cells helped by IL-4 make IgE, which arms allergy cells in the skin.");
  pill(ox, "Itch nerve", 540, 292, 475, 292, "A skin nerve carrying itch signals. IL-13 and inflamed, dry skin make itch stronger.");
  pill(ox, "Lichenified", 606, 240, 565, 292, "Thickened, rough skin from long standing rubbing and scratching in chronic disease.");
  pill(ox, "Age pattern", 796, 168, 796, 268, "Typical sites change with age: face and trunk in infants, elbow and knee folds in children, hands and folds in adults.");
}
const sm = { barr: 0.5, water: 0.4, aller: 0.3, th2: 0.3, ige: 0.2, itch: 0.3, scratch: 0.2, staph: 0.3, thick: 0.1, em: 0, st: 0, ib: 0 };
const acc = { water: 0, allg: 0, cyt: 0, ige: 0, itch: 0, treat: 0 };
function init() { initBricks(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.barr = lerp(sm.barr, m.barr, k2); sm.water = lerp(sm.water, m.water, k2); sm.aller = lerp(sm.aller, m.aller, k2);
  sm.th2 = lerp(sm.th2, m.th2, k2); sm.ige = lerp(sm.ige, m.ige, k2); sm.itch = lerp(sm.itch, m.itch, k1);
  sm.scratch = lerp(sm.scratch, m.scratch, k2); sm.staph = lerp(sm.staph, m.staph, k2); sm.thick = lerp(sm.thick, m.thick, k2);
  sm.em = lerp(sm.em, m.em, k1); sm.st = lerp(sm.st, m.st, k1); sm.ib = lerp(sm.ib, m.ib, k1);
  /* bricks separate as the barrier fails; epidermis thickens when chronic */
  bricks.forEach(function (b) {
    const gap = sm.barr * 7, dx = (b.i - 6.5) * gap * 0.14 + (b.r ? gap * 0.3 : 0);
    place(b.e, clamp(b.x + dx, 34, 630), b.y + Math.sin(tm / 900 + b.i) * 0.6, Math.sin(tm / 1200 + b.i) * sm.barr * 4, 1 - sm.barr * 0.08);
  });
  layers.epi.setAttribute("height", f1(56 + sm.thick * 34));
  layers.scratch.setAttribute("opacity", clamp(0.15 + sm.scratch).toFixed(2));
  /* Staph clusters grow on broken skin */
  staphs.forEach(function (s, i) { const sc = 0.25 + sm.staph * (0.9 - i * 0.06); place(s.g, s.x, s.y, 0, sc); s.g.style.opacity = sm.staph > 0.08 ? 1 : 0; });
  /* immune cells bob with activity */
  place(th2g, 170 + Math.sin(tm / 1500) * 3, 338 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1 + 0.06 * sm.th2 * Math.sin(tm / 300));
  place(bcg, 320 + Math.sin(tm / 1600 + 2) * 3, 348 + Math.cos(tm / 1800 + 1) * 2, Math.sin(tm / 2600) * 5, 1 + 0.05 * sm.ige * Math.sin(tm / 340 + 2));
  place(mastg, 455 + Math.sin(tm / 1400 + 4) * 2, 348 + Math.cos(tm / 1600 + 3) * 2, 0, 1 + 0.05 * sm.ige * Math.sin(tm / 320 + 4));
  /* water escaping upward, kept inside the stage */
  acc.water += dt * sm.water * 9; while (acc.water >= 1) { acc.water--; const p = freeP(water); if (p) emit(p, rnd(50, 620), 180, rnd(-4, 4), -rnd(22, 34), 0); }
  water.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 30, 630); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.y < 56 || p.t > 3) kill(p); });
  /* allergens falling through the gaps into the dermis */
  acc.allg += dt * sm.aller * 7; while (acc.allg >= 1) { acc.allg--; const p = freeP(allg); if (p) emit(p, rnd(50, 620), 58, rnd(-3, 3), rnd(20, 30), 0); }
  allg.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 30, 630); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > 300 || p.t > 8) kill(p); });
  /* Th2 cytokines drifting up to the barrier and across to the B cell */
  acc.cyt += dt * sm.th2 * 13; while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cyt); if (p) emit(p, 170 + rnd(-14, 14), 330 + rnd(-8, 8), rnd(8, 26), rnd(-30, -14), Math.random() < 0.5 ? 0 : 1); }
  cyt.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 218 || p.x > 330 || p.t > 5) kill(p); });
  /* IgE from the B cell toward the mast cell */
  acc.ige += dt * sm.ige * 6; while (acc.ige >= 1) { acc.ige--; const p = freeP(iges); if (p) emit(p, 338, 344 + rnd(-8, 8), rnd(22, 34), rnd(-4, 4), 0); }
  iges.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(90)"); if (p.x > 452 || p.t > 5) kill(p); });
  /* itch signals climbing the nerve */
  acc.itch += dt * sm.itch * 7; while (acc.itch >= 1) { acc.itch--; const p = freeP(itchp); if (p) emit(p, 540, 400, 0, -34, 0); }
  itchp.forEach(function (p) { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x = 540 + Math.sin((400 - p.y) / 28) * 7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 226 || p.t > 6) kill(p); });
  /* treatment particles: emollient to the surface, other treatments into the dermis */
  const tr = Math.max(sm.em, sm.st, sm.ib);
  acc.treat += dt * tr * 7; while (acc.treat >= 1) { acc.treat--; const p = freeP(treat); if (p) emit(p, rnd(60, 600), sm.em > 0.4 ? 62 : 250, rnd(-3, 3), sm.em > 0.4 ? 26 : 8, sm.em > 0.4 ? 0 : 1); }
  treat.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 30, 630); p.y += p.vy * dt; if (p.k === 1) { p.x += (220 - p.x) * dt * 0.25; p.y += (338 - p.y) * dt * 0.25; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if ((p.k === 0 && p.y > 178) || p.t > 4) kill(p); });
  /* gauges */
  gg.barr.set(sm.barr, wordOf(sm.barr, 0.3, 0.6, ["mild", "leaky", "very leaky"])); gg.water.set(sm.water, wordOf(sm.water, 0.3, 0.6, ["low", "raised", "high"]));
  gg.th2.set(sm.th2, wordOf(sm.th2, 0.3, 0.6, ["low", "raised", "high"])); gg.ige.set(sm.ige, wordOf(sm.ige, 0.3, 0.6, ["low", "raised", "high"]));
  gg.itch.set(sm.itch, wordOf(sm.itch, 0.3, 0.6, ["low", "raised", "high"])); gg.staph.set(sm.staph, wordOf(sm.staph, 0.3, 0.6, ["little", "present", "heavy"]));
}
run({ init, step });
