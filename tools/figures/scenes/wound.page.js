/* Wound healing scene: clot, neutrophils and macrophages, fibroblasts, new vessels, granulation, new skin, collagen change, contraction and scar. */
const WW = SC.W;
const layers = { gran: $("gran"), clotG: $("clotG"), collG: $("collG"), vess: $("vess"), epi: $("epi"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), skinL: $("skinL"), skinR: $("skinR") };
let granEl, clotEl, scarEl, epiL, epiR;
const vess = [];
const c3paths = [], c1paths = [];
const arrows = [];
/* ---- resident and arriving cells ---- */
const neus = Array.from({ length: 6 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }), x: 390 + i * 30, y: 165 + (i % 3) * 28, ph: i * 1.1 }));
const macs = Array.from({ length: 4 }, (_, i) => ({ g: cell(layers.cells, { cls: "mac", r: 17, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }), x: 405 + i * 48, y: 225 + (i % 2) * 22, ph: i * 1.7 }));
const fibs = Array.from({ length: 8 }, (_, i) => ({ g: cell(layers.cells, { cls: "fib", r: 8, nuc: 0.38, seed: i + 41, wob: 0.18 }), ph: (i / 8) * 6.283, rx: 68, ry: 42 }));
const myos = [[372, 205], [588, 205], [378, 262], [582, 262]].map(([x, y], i) => ({ g: cell(layers.cells, { cls: "myo", r: 9, nuc: 0.4, seed: i + 61, wob: 0.16 }), x, y, ph: i * 1.3 }));
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const bac = pool(22, () => { const g = mk("g", { class: "cl cl-bac" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 5.5, ry: 3 }, g); return g; });
const deb = pool(14, () => mk("circle", { class: "sc-p p-deb", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = Math.max(24, Math.min(WW - 24, x)); p.y = Math.max(56, Math.min(428, y)); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The wound";
  [["clean", "Cleaning", "g-clean", "Clearing of microbes and dead tissue, first by neutrophils and then by macrophages."], ["fill", "Fill", "g-fill", "Granulation tissue made by fibroblasts with new vessels growing in. It fills the gap from the base."], ["close", "Closure", "g-close", "New skin crawling across the surface (re-epithelialisation), helped by contraction pulling the edges in."], ["str", "Strength", "g-str", "Strength from collagen. Early type III collagen is replaced by stronger type I collagen in the scar."], ["delay", "Delay risk", "g-delay", "Risk of slow healing. Infection, poor blood supply (ischaemia), diabetes and steroids all raise it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Neutrophils", 405, 175, 150, 84, "Neutrophils: the first cleaners to arrive. They kill microbes and clear debris, then die and are removed.");
  pill(ox, "Clot", 480, 132, 350, 84, "Clot (haemostasis): platelets and fibrin plug the wound and stop bleeding. It is the scaffold repair starts from.");
  pill(ox, "Bacteria", 470, 152, 540, 84, "Bacteria in the wound. If they persist the wound is infected and filling and closure are delayed.");
  pill(ox, "Macrophages", 525, 232, 760, 84, "Macrophages: arrive after neutrophils. They clear dead neutrophils and debris and signal fibroblasts and vessels to start filling.");
  pill(ox, "Fibroblasts", 440, 235, 120, 412, "Fibroblasts: cells that make granulation tissue and collagen. They fill the wound from the base.");
  pill(ox, "New vessels", 480, 215, 285, 412, "New vessels (angiogenesis): capillaries sprout into the wound. Without blood supply the new tissue cannot survive.");
  pill(ox, "New skin", 398, 112, 445, 412, "New skin (re-epithelialisation): skin cells at the edges divide and crawl across the filled wound until they meet.");
  pill(ox, "Collagen", 500, 300, 595, 412, "Collagen: early thin type III collagen is replaced by thicker, stronger type I collagen. This is what gives the scar its strength.");
  pill(ox, "Contraction", 372, 238, 735, 412, "Contraction: myofibroblasts in the wound edges pull the edges together and shrink the wound. Too little leaves a large scar.");
  pill(ox, "Scar", 480, 302, 875, 412, "Scar: the healed area, paler and less stretchy than skin. A keloid is a raised scar that grows beyond the original wound edges.");
}
function init() {
  granEl = mk("ellipse", { class: "wd-gran", cx: 480, cy: 275, rx: 105, ry: 62 }, layers.gran);
  clotEl = mk("ellipse", { class: "wd-clot", cx: 480, cy: 138, rx: 92, ry: 30 }, layers.clotG);
  scarEl = mk("ellipse", { class: "wd-scar", cx: 480, cy: 112, rx: 105, ry: 10 }, layers.epi);
  epiL = mk("rect", { class: "wd-epi-new", x: 350, y: 106, width: 10, height: 12 }, layers.epi);
  epiR = mk("rect", { class: "wd-epi-new", x: 600, y: 106, width: 10, height: 12 }, layers.epi);
  [[430, 292, 430, 205], [480, 295, 480, 190], [530, 292, 530, 205]].forEach(([x1, y1, x2, y2]) => {
    const p = mk("path", { class: "wd-vess", d: "M" + x1 + " " + y1 + "L" + x1 + " " + y1 }, layers.vess); vess.push({ p, x1, y1, x2, y2 });
  });
  [[30, 250, 350, 250], [610, 250, 930, 250]].forEach(([x1, y1, x2, y2]) => { mk("path", { class: "wd-vess2", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2 }, layers.vess); });
  for (let i = 0; i < 5; i++) { const y = 268 + i * 13; const p3 = mk("path", { class: "wd-c3", d: "M385 " + y + "q24 -7 48 0t48 0t48 0t46 0" }, layers.collG); const p1 = mk("path", { class: "wd-c1", d: "M385 " + y + "L575 " + y }, layers.collG); c3paths.push(p3); c1paths.push(p1); }
  [[388, 238, 408, 238], [572, 238, 552, 238]].forEach(([x1, y1, x2, y2]) => { const p = mk("path", { class: "wd-arrow", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2 }, layers.collG); arrows.push(p); });
  initPanel();
}
const sm = { Clot: 1, Neu: 1, Mac: 0.5, Clean: 0.7, Fib: 0.1, Ang: 0.1, Gran: 0, Epi: 0, Coll3: 0.1, Coll1: 0, Contract: 0, Scar: 0, Strength: 0, Infect: 0.5, Delay: 0.5, Keloid: 0, perf: 0.4 };
const acc = { bac: 0, deb: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.6);
  sm.Clot = lerp(sm.Clot, m.Clot, k2); sm.Neu = lerp(sm.Neu, m.Neu, k2); sm.Mac = lerp(sm.Mac, m.Mac, k2); sm.Clean = lerp(sm.Clean, m.Clean, k2);
  sm.Fib = lerp(sm.Fib, m.Fib, k2); sm.Ang = lerp(sm.Ang, m.Ang, k2); sm.Gran = lerp(sm.Gran, m.Gran, k2); sm.Epi = lerp(sm.Epi, m.Epi, k2);
  sm.Coll3 = lerp(sm.Coll3, m.Coll3, k2); sm.Coll1 = lerp(sm.Coll1, m.Coll1, k2); sm.Contract = lerp(sm.Contract, m.Contract, k2);
  sm.Scar = lerp(sm.Scar, m.Scar, k2); sm.Strength = lerp(sm.Strength, m.Strength, k2); sm.Infect = lerp(sm.Infect, m.Infect, k2);
  sm.Delay = lerp(sm.Delay, m.Delay, k2); sm.Keloid = lerp(sm.Keloid, m.Keloid, k2); sm.perf = lerp(sm.perf, m.perf, k);
  /* wound edges pull in with contraction */
  const pull = sm.Contract * 16;
  layers.skinL.setAttribute("transform", "translate(" + f1(pull) + " 0)"); layers.skinR.setAttribute("transform", "translate(" + f1(-pull) + " 0)");
  /* clot, granulation and scar */
  clotEl.setAttribute("opacity", (sm.Clot * 0.95).toFixed(2));
  clotEl.setAttribute("transform", "translate(480 138) scale(" + (0.5 + 0.5 * sm.Clot).toFixed(2) + ") translate(-480 -138)");
  granEl.setAttribute("opacity", (sm.Gran * 0.9).toFixed(2));
  granEl.setAttribute("transform", "translate(480 275) scale(" + (0.35 + 0.65 * sm.Gran).toFixed(2) + " " + (0.3 + 0.7 * sm.Gran).toFixed(2) + ") translate(-480 -275)");
  const scarH = 6 + 14 * sm.Keloid;
  scarEl.setAttribute("opacity", (sm.Scar * 0.95).toFixed(2)); scarEl.setAttribute("ry", f1(scarH));
  scarEl.setAttribute("transform", "translate(480 112) scale(" + (0.4 + 0.6 * sm.Scar).toFixed(2) + " 1) translate(-480 -112)");
  /* new skin crawls from both edges */
  const epiW = 8 + sm.Epi * 122;
  epiL.setAttribute("x", f1(350 + pull)); epiL.setAttribute("width", f1(epiW)); epiL.setAttribute("opacity", (0.25 + 0.75 * sm.Epi).toFixed(2));
  epiR.setAttribute("x", f1(610 - pull - epiW)); epiR.setAttribute("width", f1(epiW)); epiR.setAttribute("opacity", (0.25 + 0.75 * sm.Epi).toFixed(2));
  /* new vessels sprout up into the granulation tissue */
  vess.forEach((v) => { const u = clamp(sm.Ang * 1.05); v.p.setAttribute("d", "M" + v.x1 + " " + v.y1 + "L" + f1(lerp(v.x1, v.x2, u)) + " " + f1(lerp(v.y1, v.y2, u))); v.p.setAttribute("opacity", (0.2 + 0.8 * u).toFixed(2)); });
  /* collagen: thin wavy type III fades as thick straight type I appears */
  c3paths.forEach((p) => p.setAttribute("opacity", (sm.Coll3 * (1 - sm.Coll1 * 0.75)).toFixed(2)));
  c1paths.forEach((p) => p.setAttribute("opacity", (sm.Coll1 * 0.95).toFixed(2)));
  arrows.forEach((p) => p.setAttribute("opacity", (sm.Contract * 0.9).toFixed(2)));
  /* cleaners wander in the wound, bounded inside it */
  const nOn = Math.round(sm.Neu * neus.length);
  neus.forEach((n, i) => { const on = i < nOn; const x = Math.max(372, Math.min(588, n.x + Math.sin(tm / 620 + n.ph) * 22)); const y = Math.max(140, Math.min(258, n.y + Math.cos(tm / 540 + n.ph) * 10));
    place(n.g, x, y, Math.sin(tm / 400 + i) * 14, on ? 1 : 0.1); n.g.style.opacity = on ? 1 : 0; });
  const mOn = Math.round(sm.Mac * macs.length);
  macs.forEach((mm, i) => { const on = i < mOn; const x = Math.max(378, Math.min(582, mm.x + Math.sin(tm / 900 + mm.ph) * 16)); const y = Math.max(185, Math.min(272, mm.y + Math.cos(tm / 800 + mm.ph) * 8));
    place(mm.g, x, y, Math.sin(tm / 500 + i) * 10, on ? (0.6 + 0.4 * sm.Clean) : 0.1); mm.g.style.opacity = on ? 1 : 0; });
  /* fibroblasts orbit in the granulation tissue */
  fibs.forEach((f, i) => { const on = sm.Fib > 0.1; const ang = f.ph + tm / 2600; const x = 480 + Math.cos(ang) * f.rx * (0.4 + 0.6 * sm.Gran); const y = 238 + Math.sin(ang) * f.ry * (0.4 + 0.6 * sm.Gran);
    place(f.g, Math.max(378, Math.min(582, x)), Math.max(180, Math.min(292, y)), Math.sin(tm / 500 + i) * 16, on ? 1 : 0.1); f.g.style.opacity = on ? clamp(sm.Fib * 1.2) : 0; });
  /* myofibroblasts at the edges in remodelling */
  myos.forEach((mm, i) => { const on = sm.Contract > 0.12; const inward = i % 2 === 0 ? pull : -pull;
    place(mm.g, mm.x + inward + Math.sin(tm / 600 + mm.ph) * 3, mm.y, 0, on ? 1 : 0.1); mm.g.style.opacity = on ? clamp(sm.Contract * 1.3) : 0; });
  /* bacteria persist on the wound surface when infected */
  acc.bac += dt * sm.Infect * 7; while (acc.bac >= 1) { acc.bac--; const p = free(bac); if (p) emit(p, rnd(392, 568), rnd(122, 168), rnd(-7, 7), rnd(-4, 6), 0); }
  bac.forEach((p) => { if (!p.on) return; p.t += dt; p.x = Math.max(378, Math.min(582, p.x + p.vx * dt)); p.y = Math.max(118, Math.min(180, p.y + p.vy * dt));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6 + p.x) + ")"); if (p.t > 3.2) kill(p); });
  /* debris cleared in proportion to cleaning */
  acc.deb += dt * (0.4 + sm.Infect) * 3; while (acc.deb >= 1) { acc.deb--; const p = free(deb); if (p) emit(p, rnd(390, 570), rnd(150, 250), rnd(-6, 6), rnd(-5, 5), 0); }
  deb.forEach((p) => { if (!p.on) return; p.t += dt; p.x = Math.max(372, Math.min(588, p.x + p.vx * dt)); p.y = Math.max(130, Math.min(280, p.y + p.vy * dt));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / (2 + 3 * (1 - sm.Clean))).toFixed(2)); if (p.t > 4.5) kill(p); });
  /* gauges */
  gg.clean.set(sm.Clean, wordOf(sm.Clean, 0.3, 0.6, ["slow", "active", "brisk"])); gg.fill.set(sm.Gran, wordOf(sm.Gran, 0.25, 0.6, ["little", "filling", "full"]));
  gg.close.set(sm.Epi, wordOf(sm.Epi, 0.3, 0.65, ["open", "closing", "closed"])); gg.str.set(sm.Strength, wordOf(sm.Strength, 0.25, 0.6, ["weak", "gaining", "strong"]));
  gg.delay.set(sm.Delay, wordOf(sm.Delay, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
