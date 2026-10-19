/* Haematopoiesis scene: marrow niche, signal organs, progenitors, mature lines entering blood, gauges. */
const L = { links: $("links"), beams: $("beams"), halos: $("halos"), nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, sp: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const NODES = {
  hsc: { x: 330, y: 242, r: 24, cls: "hsc", nuc: 0.45, seed: 1 },
  cmp: { x: 505, y: 160, r: 18, cls: "cmp", nuc: 0.45, seed: 2 },
  clp: { x: 505, y: 335, r: 18, cls: "clp", nuc: 0.45, seed: 3 },
};
const nodes = {}, links = {};
const TERM = { ery: [660, 100], plt: [660, 172], gran: [660, 244], mono: [660, 308], lymph: [660, 376] };
const terms = {};
let kidneyO = null, liverO = null, vesselO = null;
let epoBeam = null, tpoBeam = null, csfBeam = null, gfGlow = null, graftGlow = null, fullTint = null, capEl = null, capKey = "";
let trEpo = null, trTpo = null, trCsf = null;
const stromDots = [];
function makeNode(key) { const d = NODES[key], g = mk("g", {}, L.nodes); cell(g, { cls: d.cls, r: d.r, nuc: d.nuc, seed: d.seed, wob: 0.1 }); place(g, d.x, d.y); nodes[key] = { g, x: d.x, y: d.y, r: d.r }; }
function makeLink(id, x1, y1, x2, y2) { const p = mk("path", { class: "hm-link", d: "M" + x1 + " " + y1 + "C" + (x1 + 55) + " " + y1 + " " + (x2 - 55) + " " + y2 + " " + x2 + " " + y2 }, L.links); links[id] = p; }
function rbcEl(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.38, ry: ry * 0.32 }, g); return g; }
function initOrgans() {
  kidneyO = organ($("kidneySlot"), "kidney", 100, 145, 95, {});
  liverO = organ($("liverSlot"), "liver", 105, 340, 135, {});
  vesselO = organ($("vesselSlot"), "vessel", 845, 240, 80, { h: 290 });
  fullTint = $("marrowFull");
  const KP = kidneyO.ports.cortex, LP = liverO.ports.lobe;
  const cmpL = [NODES.cmp.x - 24, NODES.cmp.y - 1], cmpB = [NODES.cmp.x - 15, NODES.cmp.y + 24], cmpR = [NODES.cmp.x + 22, NODES.cmp.y];
  epoBeam = mk("path", { class: "hm-beam hm-epo", d: "M" + f1(KP[0]) + " " + f1(KP[1]) + "L" + f1(cmpL[0]) + " " + f1(cmpL[1]) }, L.beams);
  const mid = [430, 362];
  tpoBeam = mk("path", { class: "hm-beam hm-tpo", d: "M" + f1(LP[0]) + " " + f1(LP[1]) + "L" + f1(mid[0]) + " " + f1(mid[1]) + "L" + f1(cmpB[0]) + " " + f1(cmpB[1]) }, L.beams);
  const csfS = [vesselO.x - 38, 240];
  csfBeam = mk("path", { class: "hm-beam hm-csf", d: "M" + f1(csfS[0]) + " " + f1(csfS[1]) + "L" + f1(cmpR[0]) + " " + f1(cmpR[1]) }, L.beams);
  trEpo = track([[KP[0], KP[1]], cmpL]);
  trTpo = track([[LP[0], LP[1]], mid, cmpB]);
  trCsf = track([csfS, cmpR]);
  gfGlow = mk("ellipse", { class: "hm-gfglow", cx: NODES.cmp.x, cy: NODES.cmp.y, rx: 46, ry: 40 }, L.halos);
  graftGlow = mk("ellipse", { class: "hm-graft", cx: 330, cy: 246, rx: 85, ry: 72 }, L.halos);
  gfGlow.setAttribute("opacity", "0"); graftGlow.setAttribute("opacity", "0");
}
function capText(l, d) {
  if (d === 2) return "Transplant. Donor stem cells settle in the marrow. Every line can recover.";
  if (d === 1) return "Growth factor. It boosts the progenitor lines. It cannot rebuild an empty stem pool.";
  if (l === 1) return "No treatment. The marrow is suppressed. Few new blood cells leave.";
  if (l === 2) return "No treatment. The stressed marrow strains to keep up.";
  return "No treatment. The healthy marrow keeps every line supplied.";
}
/* pools: mature cells flowing to blood, signal particles, donor stem cells */
const flowEry = pool(16, () => rbcEl(L.parts, 8, 4.8));
const flowPlt = pool(16, () => { const g = mk("g", { class: "cl cl-plt" }, L.parts); mk("circle", { class: "cl-b", r: 4.2 }, g); return g; });
const flowGran = pool(9, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: 21, wob: 0.12 }); return g; });
const flowMono = pool(8, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "monop", r: 11, nuc: 0.45, seed: 22, wob: 0.12 }); return g; });
const flowLymph = pool(9, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "lymp", r: 9, nuc: 0.68, seed: 23, wob: 0.1 }); return g; });
const fEpo = pool(12, () => mk("circle", { class: "sc-p p-epo", r: 2.8 }, L.parts));
const fTpo = pool(12, () => mk("circle", { class: "sc-p p-tpo", r: 2.8 }, L.parts));
const fCsf = pool(12, () => mk("circle", { class: "sc-p p-csf", r: 2.8 }, L.parts));
const donor = pool(6, () => { const g = mk("g", {}, L.parts); cell(g, { cls: "hsc", r: 8, nuc: 0.45, seed: 31, wob: 0.1 }); return g; });
const gg = {};
const sm = { stem: 0.8, ery: 0.8, plt: 0.8, gran: 0.8, mono: 0.8, lymph: 0.8, epo: 0.4, tpo: 0.4, csf: 0.4, gf: 0, tx: 0 };
const acc = { ery: 0, plt: 0, gran: 0, mono: 0, lymph: 0, epo: 0, tpo: 0, csf: 0, donor: 0 };
function initMarrow() {
  mk("ellipse", { class: "hm-niche", cx: 330, cy: 248, rx: 62, ry: 55 }, L.links);
  for (let i = 0; i < 34; i++) { const c = mk("circle", { class: "hm-strom", r: rnd(3.5, 6.5), cx: 0, cy: 0 }, L.links);
    stromDots.push({ e: c, x: rnd(242, 578), y: rnd(88, 398), th: i / 34 }); }
}
function initNodes() {
  makeLink("hsc-cmp", 350, 232, 488, 164); makeLink("hsc-clp", 350, 252, 488, 330);
  makeLink("ery", 520, 150, 644, 102); makeLink("plt", 523, 160, 642, 170);
  makeLink("gran", 523, 166, 642, 242); makeLink("mono", 520, 172, 642, 304);
  makeLink("lymph", 523, 337, 642, 372);
  Object.keys(NODES).forEach(makeNode);
  const tg = mk("g", {}, L.nodes);
  const t = (key, build) => { const g = build(); place(g, TERM[key][0], TERM[key][1]); terms[key] = { g, x: TERM[key][0], y: TERM[key][1] }; };
  t("ery", () => { const g = mk("g", {}, tg); const r1 = rbcEl(g, 10, 6); place(r1, -8, -6); const r2 = rbcEl(g, 10, 6); place(r2, 10, 6); const r3 = rbcEl(g, 9, 5.4); place(r3, -2, 10); return g; });
  t("plt", () => { const g = mk("g", {}, tg); [[-14, -6], [2, 4], [16, -6], [4, -10]].forEach(([x, y]) => { const c = mk("g", { class: "cl cl-plt" }, g); mk("circle", { class: "cl-b", r: 4.6 }, c); place(c, x, y); }); return g; });
  t("gran", () => { const g = mk("g", {}, tg); cell(g, { cls: "neut", r: 14, nuc: 0.55, nucCls: "multi", seed: 51, wob: 0.12 }); return g; });
  t("mono", () => { const g = mk("g", {}, tg); cell(g, { cls: "monop", r: 15, nuc: 0.45, seed: 52, wob: 0.12 }); return g; });
  t("lymph", () => { const g = mk("g", {}, tg); cell(g, { cls: "lymp", r: 13, nuc: 0.68, seed: 53, wob: 0.1 }); return g; });
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Blood output";
  [["stem", "Stem cells", "g-stem", "The blood stem cell pool in the marrow niche. A transplant replaces this pool."], ["ery", "Red cells", "g-ery", "Red cells driven by EPO from the kidney. They carry oxygen."], ["plt", "Platelets", "g-plt2", "Platelets driven by TPO from the liver. They start clots."], ["gran", "Neutrophils", "g-gran", "Neutrophils driven by colony stimulating factors. They fight bacteria."], ["mono", "Monocytes", "g-mono", "Monocytes leave the blood and become macrophages in tissues."], ["lym", "Lymphocytes", "g-lym", "Lymphocytes from the lymphoid line: B, T and natural killer cells."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 110 + i * 148, y0, 52, 18, cls, name, tip); });
  const O = L.over;
  const kDot = kidneyO.ports.hilum || kidneyO.ports.cortex;
  pill(O, "Kidney signal", kDot[0], kDot[1], 120, 58, "The kidney releases EPO when oxygen delivery falls. EPO drives the red cell line.");
  pill(O, "Stem cell", 270, 247, 200, 200, "The blood stem cell. It copies itself and makes every blood line. It lives in the marrow niche.");
  pill(O, "Myeloid line", 505, 142, 505, 100, "The myeloid progenitor. It gives red cells, platelets and most white cells.");
  pill(O, "Red cells", 650, 96, 665, 58, "Mature red cells. They leave the marrow and carry oxygen in the blood.");
  pill(O, "Platelets", 652, 168, 760, 130, "Platelets shed from megakaryocytes. They plug vessel injury and start clotting.");
  pill(O, "White cells", 676, 332, 745, 330, "White cells: granulocytes, monocytes and lymphocytes. They fight infection.");
  pill(O, "Lymphoid line", 505, 353, 430, 395, "The lymphoid progenitor. It gives lymphocytes.");
  const lDot = liverO.ports.gall || liverO.ports.lobe;
  pill(O, "Liver signal", lDot[0], lDot[1], 145, 410, "The liver releases TPO. TPO drives platelet release.");
  capEl = mk("text", { class: "hm-cap", x: 30, y: 431 }, O); capEl.textContent = capText(0, 0);
}
function init() { initOrgans(); initMarrow(); initNodes(); initPanel(); }
function flowStep(pl, dt, key, rate) {
  acc[key] += dt * rate * 2.6;
  while (acc[key] >= 1) { acc[key]--; const p = free(pl); if (p) emit(p, TERM[key][0] + rnd(-6, 8), TERM[key][1] + rnd(-5, 5), rnd(52, 72), 0); }
  pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; if (p.x > 838) { p.x = 838; p.y += 64 * dt; }
    place(p.e, p.x, p.y, Math.sin(tm / 500 + p.y) * 8, 1); if (p.y > 392 || p.t > 8) kill(p); });
}
function signalStep(pl, dt, key, rate, tr, speed) {
  acc[key] += dt * rate;
  while (acc[key] >= 1) { acc[key]--; const p = free(pl); if (p) { emit(p, 0, 0, 0, 0); p.tr = tr; p.u = 0; p.sp = speed * rnd(0.9, 1.1); } }
  pl.forEach((p) => { if (!p.on || !p.tr) return; p.u += dt * p.sp / p.tr.len; const q = p.tr.at(Math.min(1, p.u));
    p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) kill(p); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.6);
  ["stem", "ery", "plt", "gran", "mono", "lymph", "epo", "tpo", "csf", "gf", "tx"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  const act = { hsc: clamp(sm.stem + 0.3 * sm.tx), cmp: Math.max(sm.ery, sm.gran), clp: sm.lymph };
  Object.keys(nodes).forEach((key, i) => { const n = nodes[key], a = act[key];
    const sc = Math.max(0.12, 0.35 + 0.65 * a) * (key === "hsc" ? 1 + 0.25 * sm.tx : 1) * (1 + 0.04 * Math.sin(tm / 320 + i));
    place(n.g, n.x + Math.sin(tm / 1500 + i * 1.7) * 1.6, n.y + Math.cos(tm / 1800 + i) * 1.6, 0, sc); n.g.style.opacity = a > 0.04 ? 1 : 0.25; });
  const termAct = { ery: sm.ery, plt: sm.plt, gran: sm.gran, mono: sm.mono, lymph: sm.lymph };
  Object.keys(terms).forEach((key) => { const n = terms[key]; place(n.g, n.x, n.y, 0, 0.45 + 0.55 * termAct[key]); });
  ["ery", "plt", "gran", "mono", "lymph"].forEach((id) => { links[id].setAttribute("opacity", (0.12 + 0.6 * sm[id]).toFixed(2));
    links[id].style.setProperty("stroke-width", (1.6 + 2.6 * sm.gf).toFixed(1)); });
  links["hsc-cmp"].setAttribute("opacity", (0.12 + 0.6 * sm.stem).toFixed(2)); links["hsc-clp"].setAttribute("opacity", (0.12 + 0.6 * sm.stem).toFixed(2));
  epoBeam.setAttribute("stroke-width", f1(3 + 11 * sm.gf)); epoBeam.setAttribute("opacity", (0.15 + 0.75 * sm.gf).toFixed(2));
  tpoBeam.setAttribute("stroke-width", f1(3 + 11 * sm.gf)); tpoBeam.setAttribute("opacity", (0.15 + 0.75 * sm.gf).toFixed(2));
  csfBeam.setAttribute("stroke-width", f1(2.5 + 3 * sm.csf)); csfBeam.setAttribute("opacity", (0.12 + 0.6 * sm.csf).toFixed(2));
  gfGlow.setAttribute("opacity", (0.05 + 0.32 * sm.gf + 0.05 * Math.sin(tm / 400)).toFixed(2));
  graftGlow.setAttribute("opacity", (0.04 + 0.42 * sm.tx).toFixed(2));
  fullTint.setAttribute("opacity", (0.06 + 0.3 * sm.stem).toFixed(2));
  stromDots.forEach((d) => { d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y)); d.e.setAttribute("opacity", sm.stem + 0.1 * sm.tx > d.th ? "0.9" : "0.06"); });
  signalStep(fEpo, dt, "epo", (0.5 + 3 * sm.epo) * (1 + 1.8 * sm.gf), trEpo, 130 * (1 + 0.5 * sm.gf));
  signalStep(fTpo, dt, "tpo", (0.5 + 3 * sm.tpo) * (1 + 1.8 * sm.gf), trTpo, 120 * (1 + 0.5 * sm.gf));
  signalStep(fCsf, dt, "csf", 0.4 + 2.6 * sm.csf, trCsf, 120);
  flowStep(flowEry, dt, "ery", 0.25 + 2.8 * sm.ery); flowStep(flowPlt, dt, "plt", 0.25 + 2.8 * sm.plt);
  flowStep(flowGran, dt, "gran", 0.25 + 2.8 * sm.gran); flowStep(flowMono, dt, "mono", 0.25 + 2.8 * sm.mono); flowStep(flowLymph, dt, "lymph", 0.25 + 2.8 * sm.lymph);
  acc.donor += dt * sm.tx * 1.1;
  while (acc.donor >= 1) { acc.donor--; const p = free(donor); if (p) emit(p, vesselO.ports.in[0], vesselO.ports.in[1], 0, 0); }
  donor.forEach((p) => { if (!p.on) return; p.t += dt; const tx2 = NODES.hsc.x, ty2 = NODES.hsc.y;
    p.x = lerp(p.x, tx2, dt * 0.35); p.y = lerp(p.y, ty2, dt * 0.35); place(p.e, p.x, p.y, 0, 1); if (Math.hypot(p.x - tx2, p.y - ty2) < 18 || p.t > 9) kill(p); });
  gg.stem.set(sm.stem, wordOf(sm.stem, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.ery.set(sm.ery, wordOf(sm.ery, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.plt.set(sm.plt, wordOf(sm.plt, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.gran.set(sm.gran, wordOf(sm.gran, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.mono.set(sm.mono, wordOf(sm.mono, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.lym.set(sm.lymph, wordOf(sm.lymph, 0.35, 0.7, ["low", "reduced", "normal"]));
  const ck = level + ":" + drug;
  if (ck !== capKey) { capKey = ck; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
