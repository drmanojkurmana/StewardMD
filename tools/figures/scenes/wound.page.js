/* Wound healing scene: clot, cleaners, builders, feeder vessel and sprouts, new skin, collagen and scar in real skin. */
const layers = { skinL: $("skinSlotL"), skinR: $("skinSlotR"), ves: $("vesselSlot"), gran: $("gran"), clotG: $("clotG"), collG: $("collG"), vess: $("vess"), epi: $("epi"), cells: $("cells"), parts: $("parts"), dress: $("dressG"), over: $("over"), panel: $("panel") };
let skinLO = null, skinRO = null, vesselO = null;
let granEl, blushEl, clotEl, scarEl, epiL, epiR, filmEl, filmB;
let edgeL = 300, edgeR = 660, surfY = 146, vesCY = 340;
const vess = [];
const stubs = [];
const c3paths = [], c1paths = [];
const arrows = [];
const trkV = [];
const AB_OFF = [[-95, -8], [-65, 12], [-35, -14], [-5, 10], [25, -12], [55, 10], [85, -6], [-110, 14]];
function initOrgans() {
  skinLO = organ(layers.skinL, "skin", 165, 235, 270, {});
  skinRO = organ(layers.skinR, "skin", 795, 235, 270, { flip: true });
  vesselO = organ(layers.ves, "vessel", 480, 340, 48, {});
  const dL = skinLO.ports.dermis, dR = skinRO.ports.dermis;
  const eL = skinLO.ports.epidermis, eR = skinRO.ports.epidermis;
  edgeL = Math.round(skinLO.x + skinLO.w / 2); edgeR = Math.round(skinRO.x - skinRO.w / 2);
  surfY = Math.round((eL[1] + eR[1]) / 2);
  vesCY = vesselO.y;
  const lum = vesselO.ports.lumen;
  /* short vessel stubs run from each dermis into the wound sides */
  [[dL, edgeL + 30], [dR, edgeR - 30]].forEach(([d, tx]) => {
    const p = mk("path", { class: "wd-vess2", d: "M" + f1(d[0]) + " " + f1(d[1]) + "L" + f1(tx) + " " + f1(d[1]) }, layers.vess);
    stubs.push(p);
  });
  /* three sprouts rise from the feeder vessel lumen into the wound */
  const bases = [[lum[0] - 16, lum[1] + 4], [lum[0], lum[1]], [lum[0] + 16, lum[1] + 4]];
  const tips = [[lum[0] - 52, 202], [lum[0], 190], [lum[0] + 52, 202]];
  bases.forEach((b, i) => {
    const mid = [(b[0] + tips[i][0]) / 2, (b[1] + tips[i][1]) / 2 + 12];
    trkV.push(track([b, mid, tips[i]]));
    const p = mk("path", { class: "wd-vess", d: "M" + f1(b[0]) + " " + f1(b[1]) + "L" + f1(b[0]) + " " + f1(b[1]) }, layers.vess);
    vess.push({ p, b, tip: tips[i] });
  });
}
/* ---- resident and arriving cells ---- */
const neus = Array.from({ length: 6 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }), x: 380 + i * 44, y: 205 + (i % 3) * 24, ph: i * 1.1 }));
const macs = Array.from({ length: 4 }, (_, i) => ({ g: cell(layers.cells, { cls: "mac", r: 17, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }), x: 395 + i * 60, y: 232 + (i % 2) * 20, ph: i * 1.7 }));
const fibs = Array.from({ length: 8 }, (_, i) => ({ g: cell(layers.cells, { cls: "fib", r: 8, nuc: 0.38, seed: i + 41, wob: 0.18 }), ph: (i / 8) * 6.283, rx: 62, ry: 36 }));
const myos = [];
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, (_, i) => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: (i + 0.5) / n, x: 0, y: 0, vx: 0, vy: 0, t: 0, ph: i * 1.7 }; }); }
const bac = pool(22, () => { const g = mk("g", { class: "cl cl-bac" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 5.5, ry: 3 }, g); return g; });
const deb = pool(14, () => mk("circle", { class: "sc-p p-deb", r: 3 }, layers.parts));
const rbc = pool(14, () => mk("circle", { class: "sc-p p-rbc", r: 2.6 }, layers.parts));
const abxP = pool(8, () => mk("path", { class: "wd-abx", d: "M0 0L0 -7M0 -7L-4.5 -12M0 -7L4.5 -12" }, layers.parts));
const trapP = pool(10, () => mk("circle", { class: "sc-p p-trap", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = Math.max(310, Math.min(650, x)); p.y = Math.max(120, Math.min(360, y)); p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Cleaned and dressed. The cover keeps germs out and holds moisture in, so skin closes faster.";
  if (d === 2) return "Infection treated and blood supply restored. Trapped germs shrink and wider vessels feed repair.";
  return "No treatment. Germs slow the cleaners and weak blood flow starves the new tissue.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The wound";
  [["clean", "Cleaning", "g-clean", "Clearing of germs and dead tissue, first by neutrophils and then by macrophages."], ["fill", "Fill", "g-fill", "Soft new tissue with new vessels, made by fibroblasts. It fills the gap from the base."], ["close", "Closure", "g-close", "New skin crawling across the surface, helped by the edges pulling in."], ["str", "Strength", "g-str", "Strength from collagen. Early thin collagen is replaced by thicker stronger collagen."], ["delay", "Delay risk", "g-delay", "Risk of slow healing. Infection and poor blood supply raise it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Skin", 190, 160, 110, 70, "Skin in cross section. The wound cuts through the surface and the deeper layer, leaving a gap.");
  pill(ox, "Clot", 430, surfY + 30, 330, 70, "Clot. Platelets and fibrin plug the gap and stop bleeding. Repair starts from this plug.");
  pill(ox, "Germs", 560, surfY + 22, 560, 70, "Germs in the wound. While they persist, filling and closure are delayed.");
  pill(ox, "Cleaners", 580, 228, 800, 70, "Cleaners. Neutrophils arrive first, then macrophages. They clear germs and dead tissue.");
  pill(ox, "Builders", 420, 292, 140, 395, "Builders. Fibroblasts make soft new tissue and collagen that fills the gap from the base.");
  pill(ox, "New vessels", 530, 250, 400, 395, "New vessels. Capillaries sprout into the wound. Without blood supply the new tissue cannot live.");
  pill(ox, "Scar", 520, surfY + 4, 600, 395, "Scar. Early thin collagen gives way to thicker stronger collagen while the edges pull together.");
  pill(ox, "New skin", 610, surfY - 2, 800, 395, "New skin. Surface cells at the edges divide and crawl across until they meet.");
  capEl = mk("text", { class: "wd-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
function init() {
  initOrgans();
  blushEl = mk("ellipse", { class: "wd-blush", cx: 480, cy: 282, rx: 102, ry: 62, opacity: "0.2" }, layers.gran);
  granEl = mk("ellipse", { class: "wd-gran", cx: 480, cy: 285, rx: 95, ry: 55 }, layers.gran);
  clotEl = mk("ellipse", { class: "wd-clot", cx: 480, cy: surfY + 30, rx: 80, ry: 24 }, layers.clotG);
  scarEl = mk("ellipse", { class: "wd-scar", cx: 480, cy: surfY - 2, rx: 95, ry: 6 }, layers.epi);
  epiL = mk("rect", { class: "wd-epi-new", x: edgeL, y: surfY - 6, width: 10, height: 12 }, layers.epi);
  epiR = mk("rect", { class: "wd-epi-new", x: edgeR - 10, y: surfY - 6, width: 10, height: 12 }, layers.epi);
  for (let i = 0; i < 5; i++) { const y = 282 + i * 13; const p3 = mk("path", { class: "wd-c3", d: "M360 " + y + "q24 -7 48 0t48 0t48 0t46 0" }, layers.collG); const p1 = mk("path", { class: "wd-c1", d: "M360 " + y + "L600 " + y }, layers.collG); c3paths.push(p3); c1paths.push(p1); }
  [[344, 252, 366, 252], [616, 252, 594, 252]].forEach(([x1, y1, x2, y2]) => { const p = mk("path", { class: "wd-arrow", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2 }, layers.collG); arrows.push(p); });
  filmEl = mk("rect", { class: "wd-film", x: edgeL - 8, y: surfY - 38, width: edgeR - edgeL + 16, height: 70, rx: 14, opacity: "0" }, layers.dress);
  filmB = mk("rect", { class: "wd-filmb", x: edgeL - 8, y: surfY - 38, width: edgeR - edgeL + 16, height: 70, rx: 14, opacity: "0" }, layers.dress);
  [[edgeL + 22, 250], [edgeR - 22, 250], [edgeL + 28, 292], [edgeR - 28, 292]].forEach(([x, y], i) => myos.push({ g: cell(layers.cells, { cls: "myo", r: 9, nuc: 0.4, seed: i + 61, wob: 0.16 }), x, y, ph: i * 1.3 }));
  initPanel();
}
const sm = { Clot: 1, Neu: 1, Mac: 0.5, Clean: 0.7, Fib: 0.1, Ang: 0.1, Gran: 0, Epi: 0, Coll3: 0.1, Coll1: 0, Contract: 0, Scar: 0, Strength: 0, Infect: 0.5, Delay: 0.5, Keloid: 0, perf: 0.4, abx: 0, dress: 0 };
const acc = { bac: 0, deb: 0 };
function step(dt, m) {
  const kFast = Math.min(1, dt * 2.2), kMed = Math.min(1, dt * 1.2);
  sm.Clot = lerp(sm.Clot, m.Clot, kMed); sm.Neu = lerp(sm.Neu, m.Neu, kMed); sm.Mac = lerp(sm.Mac, m.Mac, kMed); sm.Clean = lerp(sm.Clean, m.Clean, kMed);
  sm.Fib = lerp(sm.Fib, m.Fib, kMed); sm.Ang = lerp(sm.Ang, m.Ang, kMed); sm.Gran = lerp(sm.Gran, m.Gran, kMed); sm.Epi = lerp(sm.Epi, m.Epi, kMed);
  sm.Coll3 = lerp(sm.Coll3, m.Coll3, kMed); sm.Coll1 = lerp(sm.Coll1, m.Coll1, kMed); sm.Contract = lerp(sm.Contract, m.Contract, kMed);
  sm.Scar = lerp(sm.Scar, m.Scar, kMed); sm.Strength = lerp(sm.Strength, m.Strength, kMed); sm.Infect = lerp(sm.Infect, m.Infect, kMed);
  sm.Delay = lerp(sm.Delay, m.Delay, kMed); sm.Keloid = lerp(sm.Keloid, m.Keloid, kMed);
  /* treatment driven visuals switch fast so the mechanism reads at a glance */
  sm.perf = lerp(sm.perf, m.perf, kFast); sm.abx = lerp(sm.abx, drug === 2 ? 1 : 0, kFast); sm.dress = lerp(sm.dress, drug === 1 ? 1 : 0, kFast);
  /* wound edges pull in with contraction */
  const pull = sm.Contract * 16;
  layers.skinL.setAttribute("transform", "translate(" + f1(pull) + " 0)"); layers.skinR.setAttribute("transform", "translate(" + f1(-pull) + " 0)");
  /* feeder vessel below the wound widens as blood supply is restored */
  layers.ves.setAttribute("transform", "translate(480 " + f1(vesCY) + ") scale(" + (0.75 + 0.5 * sm.perf).toFixed(3) + " 1) translate(-480 " + f1(-vesCY) + ")");
  /* blood blush over the repair grows with perfusion */
  blushEl.setAttribute("opacity", (0.05 + 0.5 * sm.perf).toFixed(2));
  /* clot, granulation and scar */
  clotEl.setAttribute("opacity", (sm.Clot * 0.95).toFixed(2));
  clotEl.setAttribute("transform", "translate(480 " + f1(surfY + 30) + ") scale(" + (0.5 + 0.5 * sm.Clot).toFixed(2) + ") translate(-480 " + f1(-(surfY + 30)) + ")");
  granEl.setAttribute("opacity", (sm.Gran * 0.9).toFixed(2));
  granEl.setAttribute("transform", "translate(480 285) scale(" + (0.35 + 0.65 * sm.Gran).toFixed(2) + " " + (0.3 + 0.7 * sm.Gran).toFixed(2) + ") translate(-480 -285)");
  const scarH = 6 + 14 * sm.Keloid;
  scarEl.setAttribute("opacity", (sm.Scar * 0.95).toFixed(2)); scarEl.setAttribute("ry", f1(scarH));
  scarEl.setAttribute("transform", "translate(480 " + f1(surfY - 2) + ") scale(" + (0.4 + 0.6 * sm.Scar).toFixed(2) + " 1) translate(-480 " + f1(-(surfY - 2)) + ")");
  /* new skin crawls from both edges */
  const epiW = 8 + sm.Epi * 172;
  epiL.setAttribute("x", f1(edgeL + pull)); epiL.setAttribute("width", f1(epiW)); epiL.setAttribute("opacity", (0.25 + 0.75 * sm.Epi).toFixed(2));
  epiR.setAttribute("x", f1(edgeR - pull - epiW)); epiR.setAttribute("width", f1(epiW)); epiR.setAttribute("opacity", (0.25 + 0.75 * sm.Epi).toFixed(2));
  /* dressing film covers the wound when cleaned and dressed */
  filmEl.setAttribute("opacity", (sm.dress * 0.55).toFixed(2)); filmB.setAttribute("opacity", (sm.dress * 0.9).toFixed(2));
  /* new vessels sprout from the feeder vessel and widen with perfusion */
  const vw = 1.5 + 3.5 * sm.perf;
  vess.forEach((v) => { const u = clamp(sm.Ang * 1.05); const mx = lerp(v.b[0], v.tip[0], u), my = lerp(v.b[1], v.tip[1], u);
    v.p.setAttribute("d", "M" + f1(v.b[0]) + " " + f1(v.b[1]) + "L" + f1(mx) + " " + f1(my)); v.p.setAttribute("opacity", (0.2 + 0.8 * u).toFixed(2)); v.p.setAttribute("stroke-width", f1(vw)); });
  stubs.forEach((p) => { p.setAttribute("stroke-width", f1(1.2 + 2.5 * sm.perf)); p.setAttribute("opacity", (0.3 + 0.7 * clamp(sm.perf + 0.2)).toFixed(2)); });
  /* collagen: thin wavy type III fades as thick straight type I appears */
  c3paths.forEach((p) => p.setAttribute("opacity", (sm.Coll3 * (1 - sm.Coll1 * 0.75)).toFixed(2)));
  c1paths.forEach((p) => p.setAttribute("opacity", (sm.Coll1 * 0.95).toFixed(2)));
  arrows.forEach((p) => p.setAttribute("opacity", (sm.Contract * 0.9).toFixed(2)));
  /* cleaners wander in the wound, bounded inside it */
  const nOn = Math.round(sm.Neu * neus.length);
  neus.forEach((n, i) => { const on = i < nOn; const x = Math.max(352, Math.min(608, n.x + Math.sin(tm / 620 + n.ph) * 22)); const y = Math.max(180, Math.min(262, n.y + Math.cos(tm / 540 + n.ph) * 10));
    place(n.g, x, y, Math.sin(tm / 400 + i) * 14, on ? 1 : 0.1); n.g.style.opacity = on ? 1 : 0; });
  const mOn = Math.round(sm.Mac * macs.length);
  macs.forEach((mm, i) => { const on = i < mOn; const x = Math.max(358, Math.min(602, mm.x + Math.sin(tm / 900 + mm.ph) * 16)); const y = Math.max(195, Math.min(272, mm.y + Math.cos(tm / 800 + mm.ph) * 8));
    place(mm.g, x, y, Math.sin(tm / 500 + i) * 10, on ? (0.6 + 0.4 * sm.Clean) : 0.1); mm.g.style.opacity = on ? 1 : 0; });
  /* fibroblasts orbit in the granulation tissue */
  fibs.forEach((f, i) => { const on = sm.Fib > 0.1; const ang = f.ph + tm / 2600; const x = 480 + Math.cos(ang) * f.rx * (0.4 + 0.6 * sm.Gran); const y = 278 + Math.sin(ang) * f.ry * (0.4 + 0.6 * sm.Gran);
    place(f.g, Math.max(360, Math.min(600, x)), Math.max(220, Math.min(330, y)), Math.sin(tm / 500 + i) * 16, on ? 1 : 0.1); f.g.style.opacity = on ? clamp(sm.Fib * 1.2) : 0; });
  /* myofibroblasts at the edges in remodelling */
  myos.forEach((mm, i) => { const on = sm.Contract > 0.12; const inward = (i % 2 === 0 ? pull : -pull);
    place(mm.g, mm.x + inward + Math.sin(tm / 600 + mm.ph) * 3, mm.y, 0, on ? 1 : 0.1); mm.g.style.opacity = on ? clamp(sm.Contract * 1.3) : 0; });
  /* germs settle on the clot and shrink as antibiotics trap them */
  const shrink = 1 - 0.65 * sm.abx;
  acc.bac += dt * sm.Infect * 7; while (acc.bac >= 1) { acc.bac--; const p = free(bac); if (p) emit(p, rnd(360, 600), rnd(surfY + 4, surfY + 48), rnd(-7, 7), rnd(-4, 6)); }
  bac.forEach((p) => { if (!p.on) return; p.t += dt; p.x = Math.max(340, Math.min(620, p.x + p.vx * dt)); p.y = Math.max(surfY, Math.min(surfY + 60, p.y + p.vy * dt));
    place(p.e, p.x, p.y, tm / 6 + p.x, shrink); if (p.t > 3.2 - 1.6 * sm.abx) kill(p); });
  /* debris cleared in proportion to cleaning, faster under a dressing */
  acc.deb += dt * (0.4 + sm.Infect) * 3; while (acc.deb >= 1) { acc.deb--; const p = free(deb); if (p) emit(p, rnd(360, 600), rnd(190, 280), rnd(-6, 6), rnd(-5, 5)); }
  deb.forEach((p) => { if (!p.on) return; p.t += dt; p.x = Math.max(352, Math.min(608, p.x + p.vx * dt)); p.y = Math.max(170, Math.min(300, p.y + p.vy * dt));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / ((2 + 3 * (1 - sm.Clean)) * (1 - 0.4 * sm.dress))).toFixed(2)); if (p.t > 4.5 - 2 * sm.dress) kill(p); });
  /* red cells stream up the sprouts, more of them with better perfusion */
  const rbcOn = Math.round(sm.perf * rbc.length);
  rbc.forEach((p, i) => { if (i >= rbcOn || sm.Ang < 0.05) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dt * (0.2 + 0.55 * sm.perf); if (p.u > 1) p.u -= 1; const q = trkV[i % trkV.length].at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", "1"); });
  /* antibiotic traps hover over the germs and hold trapped dots */
  abxP.forEach((p, i) => { const o = AB_OFF[i % AB_OFF.length]; const x = 480 + o[0] + Math.sin(tm / 800 + p.ph) * 5, y = surfY + 20 + o[1] + Math.cos(tm / 950 + p.ph) * 5;
    p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(Math.sin(tm / 1100 + p.ph) * 12) + ")"); p.e.setAttribute("opacity", sm.abx.toFixed(2)); });
  trapP.forEach((p, i) => { const o = AB_OFF[(i + 3) % AB_OFF.length]; const a = tm / 700 + p.ph; const x = 480 + o[0] + Math.cos(a) * 11, y = surfY + 20 + o[1] + Math.sin(a) * 9;
    p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", (sm.abx * 0.95).toFixed(2)); });
  /* gauges */
  gg.clean.set(sm.Clean, wordOf(sm.Clean, 0.3, 0.6, ["slow", "active", "brisk"])); gg.fill.set(sm.Gran, wordOf(sm.Gran, 0.2, 0.6, ["little", "filling", "full"]));
  gg.close.set(sm.Epi, wordOf(sm.Epi, 0.3, 0.65, ["open", "closing", "closed"])); gg.str.set(sm.Strength, wordOf(sm.Strength, 0.25, 0.6, ["weak", "gaining", "strong"]));
  gg.delay.set(sm.Delay, wordOf(sm.Delay, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
