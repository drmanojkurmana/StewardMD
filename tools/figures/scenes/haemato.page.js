/* Haematopoiesis scene: stem cell, progenitors, growth factors, mature lineages entering blood, gauges. */
const L = { links: $("links"), nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const NODES = {
  hsc: { x: 125, y: 235, r: 26, cls: "hsc", nuc: 0.45, seed: 1 },
  cmp: { x: 285, y: 160, r: 20, cls: "cmp", nuc: 0.45, seed: 2 },
  clp: { x: 285, y: 330, r: 20, cls: "clp", nuc: 0.45, seed: 3 },
  eryp: { x: 455, y: 95, r: 16, cls: "eryp", nuc: 0.5, seed: 4 },
  mega: { x: 455, y: 165, r: 24, cls: "mega", nuc: 0.55, seed: 5, nucCls: "multi" },
  granp: { x: 455, y: 235, r: 16, cls: "granp", nuc: 0.5, seed: 6 },
  monop: { x: 455, y: 305, r: 16, cls: "monop", nuc: 0.5, seed: 7 },
  lympp: { x: 455, y: 370, r: 16, cls: "lymp", nuc: 0.55, seed: 8 },
};
const nodes = {}, links = {};
const TERM = { ery: [640, 95], plt: [640, 165], gran: [640, 235], mono: [640, 305], lymph: [640, 370] };
let termNodes = {};
function makeNode(key) { const d = NODES[key], g = mk("g", {}, L.nodes); cell(g, { cls: d.cls, r: d.r, nuc: d.nuc, nucCls: d.nucCls, seed: d.seed, wob: 0.1 }); place(g, d.x, d.y); nodes[key] = { g, x: d.x, y: d.y, r: d.r }; }
function makeLink(id, x1, y1, x2, y2) { const p = mk("path", { class: "hm-link", d: "M" + x1 + " " + y1 + "C" + (x1 + 55) + " " + y1 + " " + (x2 - 55) + " " + y2 + " " + x2 + " " + y2 }, L.links); links[id] = p; }
function rbcEl(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.38, ry: ry * 0.32 }, g); return g; }
/* pools: mature cells flowing to blood, growth factors, donor stem cells */
const flowEry = pool(16, () => rbcEl(L.parts, 8, 4.8));
const flowPlt = pool(16, () => { const g = mk("g", { class: "cl cl-plt" }, L.parts); mk("circle", { class: "cl-b", r: 4.2 }, g); return g; });
const flowGran = pool(9, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: 21, wob: 0.12 }); return g; });
const flowMono = pool(8, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "monop", r: 11, nuc: 0.45, seed: 22, wob: 0.12 }); return g; });
const flowLymph = pool(9, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "lymp", r: 9, nuc: 0.68, seed: 23, wob: 0.1 }); return g; });
const fEpo = pool(12, () => mk("circle", { class: "sc-p p-epo", r: 2.6 }, L.parts));
const fTpo = pool(12, () => mk("circle", { class: "sc-p p-tpo", r: 2.6 }, L.parts));
const fCsf = pool(14, () => mk("circle", { class: "sc-p p-csf", r: 2.6 }, L.parts));
const donor = pool(4, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "hsc", r: 8, nuc: 0.45, seed: 31, wob: 0.1 }); return g; });
const gg = {};
const sm = { stem: 0.8, ery: 0.8, plt: 0.8, gran: 0.8, mono: 0.8, lymph: 0.8, epo: 0.4, tpo: 0.4, csf: 0.4, gf: 0, tx: 0 };
const acc = { ery: 0, plt: 0, gran: 0, mono: 0, lymph: 0, epo: 0, tpo: 0, csf: 0, donor: 0 };
let gfPill = null, txPill = null;
function init() {
  makeLink("hsc-cmp", 148, 222, 262, 168); makeLink("hsc-clp", 148, 248, 262, 322);
  makeLink("ery", 305, 152, 432, 98); makeLink("plt", 305, 158, 428, 163);
  makeLink("gran", 305, 164, 432, 232); makeLink("mono", 305, 168, 432, 300);
  makeLink("lymph", 305, 332, 432, 368);
  mk("ellipse", { class: "hm-niche", cx: 125, cy: 245, rx: 62, ry: 58 }, L.links);
  [[78, 318], [172, 322], [72, 158]].forEach(([x, y], i) => { const g = mk("g", {}, L.nodes); cell(g, { cls: "strom", r: 11, nuc: 0.35, seed: 40 + i, wob: 0.16 }); place(g, x, y); });
  Object.keys(NODES).forEach(makeNode);
  /* terminal mature cells sitting at the end of each lineage */
  const tg = mk("g", {}, L.nodes);
  const r1 = rbcEl(tg, 10, 6); place(r1, 632, 88); const r2 = rbcEl(tg, 10, 6); place(r2, 650, 100); const r3 = rbcEl(tg, 9, 5.4); place(r3, 636, 104);
  [[628, 158], [644, 168], [658, 158], [646, 154]].forEach(([x, y]) => { const g = mk("g", { class: "cl cl-plt" }, tg); mk("circle", { class: "cl-b", r: 4.6 }, g); place(g, x, y); });
  const gn = mk("g", {}, tg); cell(gn, { cls: "neut", r: 14, nuc: 0.55, nucCls: "multi", seed: 51, wob: 0.12 }); place(gn, TERM.gran[0], TERM.gran[1]);
  const mn = mk("g", {}, tg); cell(mn, { cls: "monop", r: 15, nuc: 0.45, seed: 52, wob: 0.12 }); place(mn, TERM.mono[0], TERM.mono[1]);
  const ln = mk("g", {}, tg); cell(ln, { cls: "lymp", r: 13, nuc: 0.68, seed: 53, wob: 0.1 }); place(ln, TERM.lymph[0], TERM.lymph[1]);
  termNodes = { gran: gn, mono: mn, lymph: ln };
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Blood output";
  [["stem", "Stem cells", "g-stem", "The haematopoietic stem cell pool in the marrow niche. A transplant replaces this pool."], ["ery", "Red cells", "g-ery", "Red cells made by the erythroid line, driven by erythropoietin. They carry oxygen."], ["plt", "Platelets", "g-plt2", "Platelets shed by megakaryocytes, driven by thrombopoietin. They start clots."], ["gran", "Neutrophils", "g-gran", "Granulocytes, here neutrophils, driven by colony stimulating factors. They fight bacteria."], ["mono", "Monocytes", "g-mono", "Monocytes leave the blood and become macrophages in tissues."], ["lym", "Lymphocytes", "g-lym", "Lymphocytes from the lymphoid line: B, T and natural killer cells."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 110 + i * 148, y0, 52, 18, cls, name, tip); });
  /* label pills: centres checked to stay clear of nodes, other pills and zone text */
  const O = L.over;
  pill(O, "Stem cell", 104, 214, 125, 292, "Haematopoietic stem cell. It can copy itself and make every blood lineage. It lives in the marrow niche.");
  pill(O, "Myeloid progenitor", 282, 138, 285, 112, "Common myeloid progenitor. It gives red cells, platelets, granulocytes and monocytes.");
  pill(O, "Lymphoid progenitor", 282, 310, 285, 282, "Common lymphoid progenitor. It gives lymphocytes: B, T and natural killer cells.");
  pill(O, "Erythroid prog.", 438, 82, 455, 60, "Erythroid progenitor. Driven by erythropoietin, it becomes reticulocytes and then red cells.");
  pill(O, "Megakaryocyte", 476, 148, 548, 128, "Megakaryocyte: a large marrow cell driven by thrombopoietin. Its edges break into platelets.");
  pill(O, "Myeloblast", 438, 238, 455, 272, "Myeloblast: the granulocyte line. Driven by colony stimulating factors, it becomes neutrophils and other granulocytes.");
  pill(O, "Monoblast", 470, 292, 545, 278, "Monoblast: the monocyte line. Monocytes enter tissues and become macrophages.");
  pill(O, "Lymphoblast", 438, 372, 455, 410, "Lymphoblast: the lymphocyte line. It matures into B, T and natural killer cells.");
  pill(O, "Red cells", 640, 80, 640, 60, "Mature red cells. They leave the marrow and carry oxygen in the blood.");
  pill(O, "Platelets", 662, 150, 720, 128, "Platelets shed from the megakaryocyte. They plug vessel injury and start clotting.");
  pill(O, "Neutrophils", 654, 238, 715, 272, "Neutrophils: the main granulocyte in blood. They engulf bacteria.");
  pill(O, "Monocytes", 655, 308, 715, 340, "Monocytes circulate briefly, then enter tissues as macrophages.");
  pill(O, "Lymphocytes", 653, 372, 715, 402, "Lymphocytes: B, T and natural killer cells of the adaptive and innate immune system.");
  pill(O, "Marrow niche", 84, 330, 125, 362, "The niche: stromal, bone and vessel cells around the stem cell. They hold it, feed it and tell it when to divide.");
  pill(O, "EPO", 505, 76, 575, 60, "Erythropoietin (EPO): made mainly by the kidney when oxygen delivery falls. It drives the red cell line.");
  pill(O, "TPO", 482, 182, 600, 200, "Thrombopoietin (TPO): made mainly by the liver. It drives megakaryocytes and platelet release.");
  pill(O, "CSF", 475, 256, 600, 338, "Colony stimulating factors (CSF): they drive granulocyte and monocyte production, and rise in infection and stress.");
  gfPill = pill(O, "Growth factor", 500, 90, 745, 60, "A growth factor treatment boosts the progenitor lines it acts on. It cannot rebuild an empty stem cell pool.");
  txPill = pill(O, "Transplant", 820, 110, 745, 95, "A transplant brings donor stem cells through the blood to the niche. Every lineage can then recover.");
  gfPill.style.opacity = 0; txPill.style.opacity = 0;
}
function flowStep(pl, dt, key, rate) {
  acc[key] += dt * rate * 2.6;
  while (acc[key] >= 1) { acc[key]--; const p = free(pl); if (p) emit(p, TERM[key][0] + rnd(-6, 8), TERM[key][1] + rnd(-5, 5), rnd(52, 72), 0, 0); }
  pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; if (p.x > 858) { p.x = 858; p.y += 62 * dt; } place(p.e, p.x, p.y, Math.sin(tm / 500 + p.y) * 8, 1); if (p.y > 424 || (p.x > 858 && p.y > 400)) kill(p); if (p.t > 7) kill(p); });
}
function factorStep(pl, dt, key, rate, tx, ty) {
  acc[key] += dt * rate * 5;
  while (acc[key] >= 1) { acc[key]--; const p = free(pl); if (p) emit(p, tx - 58, ty + rnd(-9, 9), 34, 0, 0); }
  pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || p.x > tx - 14) kill(p); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.6);
  ["stem", "ery", "plt", "gran", "mono", "lymph", "epo", "tpo", "csf", "gf", "tx"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  const act = { hsc: sm.stem, cmp: Math.max(sm.ery, sm.gran), clp: sm.lymph, eryp: sm.ery, mega: sm.plt, granp: sm.gran, monop: sm.mono, lympp: sm.lymph };
  Object.keys(nodes).forEach((key, i) => { const n = nodes[key], a = act[key]; place(n.g, n.x + Math.sin(tm / 1500 + i * 1.7) * 1.6, n.y + Math.cos(tm / 1800 + i) * 1.6, 0, Math.max(0.12, 0.35 + 0.65 * a) * (1 + 0.04 * Math.sin(tm / 320 + i))); n.g.style.opacity = a > 0.04 ? 1 : 0.25; });
  links.ery.setAttribute("opacity", (0.12 + 0.6 * sm.ery).toFixed(2)); links.plt.setAttribute("opacity", (0.12 + 0.6 * sm.plt).toFixed(2));
  links.gran.setAttribute("opacity", (0.12 + 0.6 * sm.gran).toFixed(2)); links.mono.setAttribute("opacity", (0.12 + 0.6 * sm.mono).toFixed(2));
  links.lymph.setAttribute("opacity", (0.12 + 0.6 * sm.lymph).toFixed(2));
  links["hsc-cmp"].setAttribute("opacity", (0.12 + 0.6 * sm.stem).toFixed(2)); links["hsc-clp"].setAttribute("opacity", (0.12 + 0.6 * sm.stem).toFixed(2));
  factorStep(fEpo, dt, "epo", sm.epo, NODES.eryp.x, NODES.eryp.y);
  factorStep(fTpo, dt, "tpo", sm.tpo, NODES.mega.x, NODES.mega.y);
  factorStep(fCsf, dt, "csf", sm.csf, NODES.granp.x, NODES.granp.y);
  flowStep(flowEry, dt, "ery", sm.ery); flowStep(flowPlt, dt, "plt", sm.plt);
  flowStep(flowGran, dt, "gran", sm.gran); flowStep(flowMono, dt, "mono", sm.mono); flowStep(flowLymph, dt, "lymph", sm.lymph);
  /* donor stem cells arrive through the blood and home to the niche */
  acc.donor += dt * sm.tx * 0.7;
  while (acc.donor >= 1) { acc.donor--; const p = free(donor); if (p) emit(p, 866, 84, 0, 0, 0); }
  donor.forEach((p) => { if (!p.on) return; p.t += dt; const tx2 = NODES.hsc.x, ty2 = NODES.hsc.y; p.x = lerp(p.x, tx2, dt * 0.35); p.y = lerp(p.y, ty2, dt * 0.35); place(p.e, p.x, p.y, 0, 1); if (Math.hypot(p.x - tx2, p.y - ty2) < 18 || p.t > 9) kill(p); });
  if (gfPill) gfPill.style.opacity = sm.gf.toFixed(2);
  if (txPill) txPill.style.opacity = sm.tx.toFixed(2);
  gg.stem.set(sm.stem, wordOf(sm.stem, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.ery.set(sm.ery, wordOf(sm.ery, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.plt.set(sm.plt, wordOf(sm.plt, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.gran.set(sm.gran, wordOf(sm.gran, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.mono.set(sm.mono, wordOf(sm.mono, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.lym.set(sm.lymph, wordOf(sm.lymph, 0.35, 0.7, ["low", "reduced", "normal"]));
}
run({ init, step });
