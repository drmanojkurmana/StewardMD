/* ILD scene: epithelial injury, fibroblasts, collagen, thickened interstitium, honeycombing, stiff restrictive lung and gauges. */
const L = { lung: $("lungG"), alv: $("alvG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CX = 270, CYA = 250;
/* ---- alveolar unit ---- */
let interE = null, airE = null, capPath = null;
const epiCells = [], fibCells = [], collStrands = [], inflCells = [];
function initAlv() {
  interE = mk("ellipse", { class: "ild-inter", cx: CX, cy: CYA, rx: 150, ry: 112 }, L.alv);
  airE = mk("ellipse", { class: "ild-air", cx: CX, cy: CYA, rx: 104, ry: 80 }, L.alv);
  capPath = mk("path", { class: "ild-cap", d: "M175 330 Q270 388 365 330" }, L.alv);
  for (let i = 0; i < 14; i++) { const t = (i / 14) * 6.283, x1 = CX + Math.cos(t) * 116, y1 = CYA + Math.sin(t) * 88, x2 = CX + Math.cos(t + 0.35) * 132, y2 = CYA + Math.sin(t + 0.35) * 100;
    collStrands.push(mk("path", { class: "ild-coll", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, L.alv)); }
  for (let i = 0; i < 8; i++) { const t = (i / 8) * 6.283 + 0.2, g = mk("g", {}, L.alv); cell(g, { cls: "epi2", r: 11, nuc: 0.32, seed: i + 2, wob: 0.06, n: 8 }); epiCells.push({ g, t }); }
  for (let i = 0; i < 6; i++) { const t = (i / 6) * 6.283 + 0.55, g = mk("g", {}, L.alv); cell(g, { cls: "fib2", r: 13, nuc: 0.36, seed: i + 11, wob: 0.16, n: 8 }); fibCells.push({ g, t, i }); }
  [[232, 228], [308, 272]].forEach(([x, y], i) => { const g = mk("g", {}, L.alv); cell(g, { cls: "mac", r: 14, nuc: 0.4, seed: i + 30, wob: 0.12 }); inflCells.push({ g, x, y, i }); });
}
/* ---- whole lung, honeycombing, clubbing ---- */
let lungG2 = null, diaph = null;
const honeyC = [], reticL = [];
function initLung() {
  lungG2 = mk("g", {}, L.lung);
  mk("path", { class: "ild-trach", d: "M792 58 L792 96" }, lungG2);
  mk("path", { class: "ild-lung", d: "M708 96 C662 112 642 198 652 288 C658 350 692 380 762 384 L858 384 C908 380 934 342 930 262 C925 182 882 106 822 92 C782 83 742 84 708 96 Z" }, lungG2);
  [[700, 180, 880, 230], [710, 250, 900, 190], [690, 300, 860, 320], [760, 130, 800, 360], [840, 120, 730, 340]].forEach(([a, b, c, d]) => reticL.push(mk("line", { class: "ild-retic", x1: a, y1: b, x2: c, y2: d }, lungG2)));
  [[735, 322], [775, 338], [815, 322], [855, 338], [760, 358], [830, 360], [795, 318]].forEach(([x, y], i) => honeyC.push({ e: mk("circle", { class: "ild-honey", cx: x, cy: y, r: 13 + (i % 3) * 3 }, lungG2), x, y, i }));
  diaph = mk("path", { class: "ild-diaph", d: "M660 398 Q790 424 920 398" }, L.lung);
  /* clubbed fingertips: rounded ends with broad nails */
  const fg = mk("g", {}, L.lung);
  [538, 562, 586].forEach((x, i) => { mk("ellipse", { class: "ild-finger", cx: x, cy: 368 + (i % 2) * 6, rx: 10, ry: 15 }, fg); mk("ellipse", { class: "ild-nail", cx: x, cy: 360 + (i % 2) * 6, rx: 6, ry: 5 }, fg); });
}
/* ---- capillary red cells ---- */
const capTrack = track([[178, 332], [222, 356], [270, 366], [318, 356], [362, 332]]);
const rbcs2 = [];
function initRbc() { for (let i = 0; i < 7; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.alv); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); rbcs2.push({ g, u: i / 7, v: rnd(0.8, 1.2) }); } }
/* ---- particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const injP = pool(18, () => mk("path", { class: "sc-p p-inj", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, L.parts));
const o2P = pool(26, () => mk("circle", { class: "sc-p p-oxy", r: 3 }, L.parts));
const colP = pool(18, () => mk("circle", { class: "sc-p p-colp", r: 2.4 }, L.parts));
const drugP = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {}, dpills = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lungs";
  [["inj", "Injury", "g-ildinj", "Repeated injury to alveolar epithelial cells. Causes include idiopathic disease, connective tissue disease, asbestos, some drugs and other inhaled exposures."], ["fib", "Fibrosis", "g-ildfib", "Fibroblast activation and collagen deposition in the interstitium. The wall thickens and stiffens and cannot be stretched back once scarred."], ["dif", "Diffusion", "g-ilddif", "How easily oxygen crosses the thickened alveolar wall into capillary blood. A longer, scarred path lowers gas transfer."], ["comp", "Compliance", "g-good", "How easily the lung stretches to take in air. Fibrosis makes the lung stiff, so compliance falls."], ["vol", "Volume", "g-fl", "Usable lung volume. A stiff scarred lung cannot expand fully, giving a restrictive pattern with smaller volumes."], ["oxy", "Oxygen", "g-ildoxy", "Blood oxygen. It falls when diffusion is impaired and ventilation is restricted. Oxygen treatment raises it without reversing scar."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Injury sparks", 178, 176, 285, 82, "Repeated alveolar epithelial injury: idiopathic, connective tissue disease, asbestos, drug related and other causes. Abnormal repair, not one hit, drives fibrosis.");
  pill(ox, "Interstitium", 150, 252, 80, 182, "The interstitium: thin support tissue between alveolar epithelium and capillary. Collagen deposited here thickens the wall and lengthens the path for oxygen.");
  pill(ox, "Epithelium", 196, 314, 126, 368, "Alveolar epithelial lining cells. Repeated injury and failed repair signal fibroblasts to make scar tissue.");
  pill(ox, "Fibroblast", 368, 168, 460, 110, "Fibroblasts in the interstitium. When activated they multiply and lay down collagen and matrix. Antifibrotic treatment slows this, it does not erase scar.");
  pill(ox, "Collagen", 340, 336, 460, 368, "Collagen fibres deposited in the interstitium. They thicken and stiffen the alveolar wall and distort the air sacs.");
  pill(ox, "Capillary", 270, 366, 270, 410, "Capillary carrying blood past the air sac. Oxygen must cross epithelium, thickened interstitium and endothelium to reach it, so diffusion falls.");
  pill(ox, "Stiff lung", 876, 164, 850, 72, "A scarred lung is stiff and small: low compliance and a restrictive pattern. Breathing takes more effort and volumes shrink.");
  pill(ox, "Clubbing", 562, 380, 565, 410, "Finger clubbing: broad fingertips and nails seen in some patients with pulmonary fibrosis. One of the examination findings to look for.");
  pill(ox, "Crackles", 716, 348, 682, 410, "Fine inspiratory crackles, also called rales, heard with a stethoscope over fibrotic lung, like Velcro being pulled apart. Cough and breathlessness are typical symptoms.");
  pill(ox, "Honeycombing", 806, 336, 826, 410, "Honeycombing: clustered cystic spaces at the lung bases in advanced fibrosis. Normal alveoli are replaced and gas exchange surface is lost.");
  [[1, "Antifibrotic", "An antifibrotic slows fibroblast driven scarring and the fall in lung function. Established collagen and honeycombing remain."], [2, "Immune calming", "Immunosuppression calms inflammation driven patterns, for example some connective tissue disease related disease. It does not dissolve established scar."], [3, "Oxygen support", "Oxygen raises blood oxygen and transplant referral is considered for suitable end-stage disease. Oxygen alone does not reverse fibrosis."]]
    .forEach(([d, n, tip]) => { dpills[d] = pill(ox, n, 366, 176, 486, 72, tip); dpills[d].style.opacity = 0; });
}
const sv = { inj: 0.5, fib: 0.5, col: 0.5, honey: 0.2, diff: 0.5, comp: 0.5, vol: 0.5, oxy: 0.5, anti: 0, imm: 0, oxyT: 0 };
const acc = { inj: 0, o2: 0, col: 0, drug: 0 };
function init() { initAlv(); initLung(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  for (const q of ["inj", "fib", "col", "honey", "diff", "comp", "vol", "oxy"]) sv[q] = lerp(sv[q], m[q], k2);
  sv.anti = lerp(sv.anti, m.anti, k1); sv.imm = lerp(sv.imm, m.imm, k1); sv.oxyT = lerp(sv.oxyT, m.oxyT, k1);
  /* alveolar geometry: interstitium thickens, air space shrinks */
  const oRx = 138 + 30 * sv.col, oRy = 102 + 24 * sv.col, iRx = 108 - 24 * sv.col, iRy = 84 - 18 * sv.col;
  interE.setAttribute("rx", f1(oRx)); interE.setAttribute("ry", f1(oRy));
  airE.setAttribute("rx", f1(iRx)); airE.setAttribute("ry", f1(iRy));
  epiCells.forEach((e) => place(e.g, CX + Math.cos(e.t) * iRx, CYA + Math.sin(e.t) * iRy, 0, 1 - 0.25 * sv.col));
  fibCells.forEach((e) => { const rr = 0.5 + 0.5 * Math.sin(tm / 500 + e.i); place(e.g, CX + Math.cos(e.t) * (iRx + oRx) / 2, CYA + Math.sin(e.t) * (iRy + oRy) / 2, Math.sin(tm / 700 + e.i) * 14, (0.55 + 0.65 * sv.fib) * (0.92 + 0.12 * rr)); });
  collStrands.forEach((s, i) => s.setAttribute("opacity", clamp(0.12 + sv.col * 1.1 - (i % 4) * 0.05).toFixed(2)));
  inflCells.forEach((e) => { place(e.g, e.x + Math.sin(tm / 900 + e.i) * 4, e.y + Math.cos(tm / 1100 + e.i) * 3, 0, 0.3 + 0.7 * sv.inj); e.g.style.opacity = (0.25 + 0.75 * sv.inj).toFixed(2); });
  /* lung: stiff small breathing, reticulation, honeycombing */
  const br = 1 + 0.018 * sv.comp * Math.sin(tm / 850);
  lungG2.setAttribute("transform", "translate(790 240) scale(" + br.toFixed(3) + " " + (2 - br).toFixed(3) + ") translate(-790 -240)");
  reticL.forEach((s) => s.setAttribute("opacity", (0.1 + 0.5 * sv.col).toFixed(2)));
  honeyC.forEach((c) => { const s = clamp((sv.honey - c.i * 0.05) * 1.6); c.e.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y) + ") scale(" + (0.2 + 0.9 * s).toFixed(2) + ") translate(" + f1(-c.x) + " " + f1(-c.y) + ")"); c.e.setAttribute("opacity", s > 0.04 ? "1" : "0"); });
  const dy = 398 + 7 * sv.comp * Math.sin(tm / 850);
  diaph.setAttribute("d", "M660 " + f1(dy) + " Q790 " + f1(dy + 24 * sv.comp + 6) + " 920 " + f1(dy));
  /* capillary flow slows as diffusion and compliance fall */
  rbcs2.forEach((r) => { r.u += dt * 0.055 * r.v * (0.4 + 0.6 * sv.diff); if (r.u > 1) r.u -= 1; const p = capTrack.at(r.u); place(r.g, p.x, p.y, p.a, 1); });
  /* injury sparks toward the epithelium */
  acc.inj += dt * sv.inj * 6; while (acc.inj >= 1) { acc.inj--; const p = freeP(injP); if (p) emitP(p, rnd(46, 120), rnd(96, 140), rnd(38, 55), rnd(18, 30)); }
  injP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6 || p.x > 215) killP(p); });
  /* oxygen crossing from air space to capillary: fewer and fainter when thick */
  acc.o2 += dt * (1.5 + 7 * sv.diff + 5 * sv.oxyT); while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2P); if (p) emitP(p, CX + rnd(-55, 55), CYA + rnd(-35, 25), rnd(-6, 6), rnd(26, 40)); }
  o2P.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp((0.25 + 0.75 * sv.diff) * (1 - p.t / 2.6)).toFixed(2)); if (p.t > 2.6 || p.y > 366) killP(p); });
  /* collagen dots shed by fibroblasts */
  acc.col += dt * sv.fib * 5; while (acc.col >= 1) { acc.col--; const f = pick(fibCells), p = freeP(colP); if (p && f) { const fx = CX + Math.cos(f.t) * (iRx + oRx) / 2, fy = CYA + Math.sin(f.t) * (iRy + oRy) / 2; emitP(p, fx, fy, rnd(-12, 12), rnd(-12, 12)); } }
  colP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 30, 440); p.y = clamp(p.y, 90, 380); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* treatment capsules toward fibroblasts */
  acc.drug += dt * (sv.anti + sv.imm) * 2.6; while (acc.drug >= 1) { acc.drug--; const p = freeP(drugP); if (p) emitP(p, rnd(36, 90), 330, 0, 0); }
  drugP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (368 - p.x) * dt * 0.5 + 14 * dt; p.y += (176 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.4).toFixed(2)); if (p.t > 4.9) killP(p); });
  dpills[1].style.opacity = sv.anti.toFixed(2); dpills[2].style.opacity = sv.imm.toFixed(2); dpills[3].style.opacity = sv.oxyT.toFixed(2);
  gg.inj.set(sv.inj, wordOf(sv.inj, 0.3, 0.62, ["low", "ongoing", "high"])); gg.fib.set(sv.col, wordOf(sv.col, 0.3, 0.62, ["little", "moderate", "extensive"])); gg.dif.set(sv.diff, wordOf(sv.diff, 0.35, 0.62, ["low", "reduced", "near normal"]));
  gg.comp.set(sv.comp, wordOf(sv.comp, 0.35, 0.62, ["low", "reduced", "near normal"])); gg.vol.set(sv.vol, wordOf(sv.vol, 0.35, 0.62, ["low", "reduced", "near normal"])); gg.oxy.set(sv.oxy, wordOf(sv.oxy, 0.45, 0.68, ["low", "reduced", "near normal"]));
}
run({ init, step });
