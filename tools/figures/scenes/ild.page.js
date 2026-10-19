/* ILD scene: epithelial injury, fibroblasts, collagen, thickened interstitium, honeycombing, stiff restrictive lung and gauges. */
const layers = { alv: $("alvG"), lungSlot: $("lungSlot"), parts: $("parts"), over: $("over"), panel: $("panel"), airway: $("airway"), diaph: $("diaph") };
const CX = 250, CYA = 245, LX = 790, LY = 235;
/* ---- whole lung from the shared organ art, with scar and honeycomb overlays ---- */
let lungO = null, glowE = null, o2Kit = null, trachY = 98;
const scarLines = [], honeyC = [];
function initLung() {
  lungO = organ(layers.lungSlot, "lung", LX, LY, 210, {});
  const P = lungO.ports;
  layers.airway.setAttribute("d", "M" + f1(LX) + " 58 L" + f1(P.trachea[0]) + " " + f1(P.trachea[1]));
  trachY = P.trachea[1];
  glowE = mk("ellipse", { class: "ild-glow", cx: LX, cy: LY, rx: 105, ry: 135, opacity: "0" }, layers.lungSlot);
  [[718, 168, 758, 186], [768, 158, 798, 196], [818, 168, 848, 206], [700, 228, 748, 246],
   [758, 238, 808, 258], [828, 238, 862, 262], [728, 288, 768, 308], [788, 298, 828, 318]]
    .forEach(([a, b, c, d]) => scarLines.push(mk("path", { class: "ild-scar", d: "M" + a + " " + b + "L" + c + " " + d }, layers.lungSlot)));
  const bL = P.base, bR = P.baseR;
  [[bL, -30, -26, 13], [bL, -2, -30, 16], [bL, 24, -24, 12], [bL, -8, 2, 15], [bR, -22, -24, 14], [bR, 6, -28, 12], [bR, 0, 0, 16]]
    .forEach(([b, dx, dy, r], i) => honeyC.push({ e: mk("circle", { class: "ild-honey", cx: f1(b[0] + dx), cy: f1(b[1] + dy), r: r }, layers.lungSlot), x: b[0] + dx, y: b[1] + dy, i }));
  o2Kit = mk("g", { opacity: "0" }, layers.lungSlot);
  mk("path", { class: "ild-o2tube", d: "M936 56 C900 62 " + f1(P.trachea[0] + 42) + " " + f1(P.trachea[1] - 16) + " " + f1(P.trachea[0] + 7) + " " + f1(P.trachea[1] - 7) }, o2Kit);
  mk("path", { class: "ild-o2tube", d: "M" + f1(P.trachea[0] - 9) + " " + f1(P.trachea[1] + 3) + "L" + f1(P.trachea[0] + 9) + " " + f1(P.trachea[1] + 3) }, o2Kit);
}
/* ---- magnified alveolar unit ---- */
let interE = null, airE = null, capPath = null;
const epiCells = [], fibCells = [], collStrands = [], inflCells = [], halos = [];
function initAlv() {
  interE = mk("ellipse", { class: "ild-inter", cx: CX, cy: CYA, rx: 150, ry: 112 }, layers.alv);
  airE = mk("ellipse", { class: "ild-air", cx: CX, cy: CYA, rx: 104, ry: 80 }, layers.alv);
  capPath = mk("path", { class: "ild-cap", d: "M168 322 C200 345 225 356 250 356 C275 356 300 345 332 322" }, layers.alv);
  for (let i = 0; i < 14; i++) { const t = (i / 14) * 6.283, x1 = CX + Math.cos(t) * 116, y1 = CYA + Math.sin(t) * 88, x2 = CX + Math.cos(t + 0.35) * 132, y2 = CYA + Math.sin(t + 0.35) * 100;
    collStrands.push(mk("path", { class: "ild-coll", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, layers.alv)); }
  for (let i = 0; i < 8; i++) { const t = (i / 8) * 6.283 + 0.2, g = mk("g", {}, layers.alv); cell(g, { cls: "epi2", r: 11, nuc: 0.32, seed: i + 2, wob: 0.06, n: 8 }); epiCells.push({ g, t }); }
  for (let i = 0; i < 6; i++) { const t = (i / 6) * 6.283 + 0.55, g = mk("g", {}, layers.alv); cell(g, { cls: "fib2", r: 13, nuc: 0.36, seed: i + 11, wob: 0.16, n: 8 }); fibCells.push({ g, t, i }); }
  [[140, 215], [360, 215]].forEach(([x, y], i) => {
    const g = mk("g", {}, layers.alv); cell(g, { cls: "infl", r: 14, nuc: 0.4, seed: i + 30, wob: 0.12 }); inflCells.push({ g, x, y, i });
    halos.push(mk("circle", { class: "ild-halo", cx: x, cy: y, r: 19 }, layers.alv));
  });
}
/* ---- capillary red cells ---- */
const capTrack = track([[168, 322], [212, 346], [250, 356], [288, 346], [332, 322]]);
const rbcs2 = [];
function initRbc() { for (let i = 0; i < 7; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.alv); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); rbcs2.push({ g, u: i / 7, v: rnd(0.8, 1.2) }); } }
/* ---- particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, st: 0, fi: 0 }; }); }
const injP = pool(18, () => mk("path", { class: "sc-p p-inj", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const o2P = pool(26, () => mk("circle", { class: "sc-p p-oxy", r: 3 }, layers.parts));
const colP = pool(18, () => mk("circle", { class: "sc-p p-colp", r: 2.4 }, layers.parts));
const blockP = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4.5, y: -2.4, width: 9, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 4.5, height: 4.8, rx: 2.4 }, g); return g; });
const calmP = pool(8, () => mk("circle", { class: "sc-p p-calm", r: 3 }, layers.parts));
const airP = pool(10, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- caption, labels and gauges ---- */
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 3) return "Antifibrotic slows new scarring. The wall stays thinner and oxygen crosses better.";
  if (d === 1) return "Immunosuppression calms injury. Less new scarring starts.";
  if (d === 2) return "Oxygen lifts blood oxygen for now. The scar itself stays.";
  return "No treatment. Scar thickens the wall so less oxygen reaches the blood.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lungs";
  [["inj", "Injury", "g-ildinj", "Repeated injury to the air sac lining. Healing goes wrong and calls in scar making cells."], ["fib", "Fibrosis", "g-ildfib", "Scar tissue in the wall. It thickens and stiffens the wall and cannot be stretched back once formed."], ["dif", "Diffusion", "g-ilddif", "How easily oxygen crosses the thickened wall into capillary blood. A longer scarred path lowers it."], ["comp", "Compliance", "g-good", "How easily the lung stretches to take in air. Scar makes the lung stiff, so compliance falls."], ["vol", "Volume", "g-fl", "Usable lung volume. A stiff scarred lung cannot expand fully, giving smaller volumes."], ["oxy", "Oxygen", "g-ildoxy", "Blood oxygen. It falls when diffusion is impaired and the lung is stiff. Oxygen treatment raises it without removing scar."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, ap = lungO.ports.apex, bR = lungO.ports.baseR;
  pill(ox, "Injury", 185, 170, 140, 92, "Repeated injury to the air sac lining. Healing goes wrong and calls in scar making cells.");
  pill(ox, "Air sac", 250, 222, 258, 92, "The air sac where oxygen should cross into blood. Scar makes the crossing longer.");
  pill(ox, "Fibroblast", 360, 200, 470, 116, "Scar making cell. An antifibrotic slows it down but does not remove old scar.");
  pill(ox, "Scar", 335, 315, 482, 180, "Stiff scar tissue in the wall. It thickens the wall and shrinks the lung.");
  pill(ox, "Blood", 265, 356, 425, 362, "Blood in the capillary. It picks up less oxygen when the wall is thick.");
  pill(ox, "Lung", ap[0], ap[1], 700, 92, "The whole lung. Scar makes it stiff and small so each breath moves less air.");
  pill(ox, "Honeycomb", bR[0], bR[1], 858, 122, "Honeycomb cysts in late disease. Normal air sacs are lost for good.");
  capEl = mk("text", { class: "ild-capline", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sv = { inj: 0.5, fib: 0.5, col: 0.5, honey: 0.2, diff: 0.5, comp: 0.5, vol: 0.5, oxy: 0.5, anti: 0, imm: 0, oxyT: 0 };
const acc = { inj: 0, o2: 0, col: 0, block: 0, calm: 0, air: 0 };
function init() { initLung(); initAlv(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  for (const q of ["inj", "fib", "col", "honey", "diff", "comp", "vol", "oxy"]) sv[q] = lerp(sv[q], m[q], k2);
  sv.anti = lerp(sv.anti, m.anti, k1); sv.imm = lerp(sv.imm, m.imm, k1); sv.oxyT = lerp(sv.oxyT, m.oxyT, k1);
  /* alveolar geometry: interstitium thickens, air space shrinks */
  const oRx = 138 + 30 * sv.col, oRy = 102 + 24 * sv.col, iRx = 108 - 24 * sv.col, iRy = 84 - 18 * sv.col;
  interE.setAttribute("rx", f1(oRx)); interE.setAttribute("ry", f1(oRy));
  airE.setAttribute("rx", f1(iRx)); airE.setAttribute("ry", f1(iRy));
  epiCells.forEach((e) => place(e.g, CX + Math.cos(e.t) * iRx, CYA + Math.sin(e.t) * iRy, 0, 1 - 0.25 * sv.col));
  const fibPos = (f) => [CX + Math.cos(f.t) * (iRx + oRx) / 2, CYA + Math.sin(f.t) * (iRy + oRy) / 2];
  fibCells.forEach((e) => { const [fx, fy] = fibPos(e), rr = 0.5 + 0.5 * Math.sin(tm / 500 + e.i);
    place(e.g, fx, fy, Math.sin(tm / 700 + e.i) * 14, (0.55 + 0.65 * sv.fib) * (0.92 + 0.12 * rr) * (1 - 0.15 * sv.anti)); });
  collStrands.forEach((s, i) => s.setAttribute("opacity", clamp(0.12 + sv.col * 1.1 - (i % 4) * 0.05 - 0.35 * sv.anti).toFixed(2)));
  inflCells.forEach((e, i) => { place(e.g, e.x + Math.sin(tm / 900 + e.i) * 4, e.y + Math.cos(tm / 1100 + e.i) * 3, 0, (0.3 + 0.7 * sv.inj) * (1 - 0.2 * sv.imm));
    e.g.style.opacity = (0.25 + 0.75 * sv.inj).toFixed(2);
    halos[i].setAttribute("opacity", (0.55 * sv.imm).toFixed(2)); halos[i].setAttribute("r", f1(19 + 2 * Math.sin(tm / 600 + e.i))); });
  /* whole lung: restrictive small stiff breathing, scar lines, honeycombing, oxygen glow */
  const br = (0.94 + 0.06 * sv.comp) + 0.02 * sv.comp * Math.sin(tm / 850);
  layers.lungSlot.setAttribute("transform", "translate(" + LX + " " + LY + ") scale(" + br.toFixed(3) + ") translate(" + (-LX) + " " + (-LY) + ")");
  scarLines.forEach((s, i) => s.setAttribute("opacity", clamp((sv.col - i * 0.08) * 1.5).toFixed(2)));
  honeyC.forEach((c) => { const s = clamp((sv.honey - c.i * 0.05) * 1.6); c.e.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y) + ") scale(" + (0.2 + 0.9 * s).toFixed(2) + ") translate(" + f1(-c.x) + " " + f1(-c.y) + ")"); c.e.setAttribute("opacity", s > 0.04 ? "1" : "0"); });
  const dy = 398 + 7 * sv.comp * Math.sin(tm / 850);
  layers.diaph.setAttribute("d", "M660 " + f1(dy) + " Q790 " + f1(dy + 24 * sv.comp + 6) + " 920 " + f1(dy));
  glowE.setAttribute("opacity", (0.3 * sv.oxy).toFixed(2));
  o2Kit.setAttribute("opacity", sv.oxyT.toFixed(2));
  /* capillary widens and brightens on oxygen */
  capPath.setAttribute("stroke-width", f1(7 + 2.5 * sv.oxyT));
  capPath.setAttribute("opacity", (0.75 + 0.15 * sv.oxyT).toFixed(2));
  /* capillary flow slows as diffusion falls */
  rbcs2.forEach((r) => { r.u += dt * 0.055 * r.v * (0.4 + 0.6 * sv.diff); if (r.u > 1) r.u -= 1; const p = capTrack.at(r.u); place(r.g, p.x, p.y, p.a, 1); });
  /* injury sparks toward the epithelium */
  acc.inj += dt * sv.inj * 6; while (acc.inj >= 1) { acc.inj--; const p = freeP(injP); if (p) emitP(p, rnd(40, 110), rnd(96, 140), rnd(38, 55), rnd(18, 30)); }
  injP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6 || p.x > 205) killP(p); });
  /* oxygen crossing from air space to capillary: fewer and fainter when thick */
  acc.o2 += dt * (1.5 + 7 * sv.diff + 5 * sv.oxyT); while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2P); if (p) emitP(p, CX + rnd(-55, 55), CYA + rnd(-35, 25), rnd(-6, 6), rnd(26, 40)); }
  o2P.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp((0.25 + 0.75 * sv.diff) * (1 - p.t / 2.6)).toFixed(2)); if (p.t > 2.6 || p.y > 354) killP(p); });
  /* collagen dots shed by fibroblasts: antifibrotic chokes the downstream flow */
  acc.col += dt * sv.fib * 5 * (1 - 0.45 * sv.anti); while (acc.col >= 1) { acc.col--; const f = pick(fibCells), p = freeP(colP); if (p && f) { const [fx, fy] = fibPos(f); emitP(p, fx, fy, rnd(-12, 12), rnd(-12, 12)); } }
  colP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 30, 440); p.y = clamp(p.y, 90, 380); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* antifibrotic capsules fly in and dock on fibroblasts while the drug is on */
  acc.block += dt * sv.anti * 3; while (acc.block >= 1) { acc.block--; const p = freeP(blockP); if (p) { p.fi = Math.floor(rnd(0, fibCells.length)); emitP(p, rnd(40, 90), rnd(315, 340), 0, 0); } }
  blockP.forEach((p) => { if (!p.on) return; const f = fibCells[p.fi] || fibCells[0], [fx, fy] = fibPos(f);
    if (p.st === 0) { p.t += dt; p.x += (fx - p.x) * Math.min(1, dt * 1.6) + 10 * dt; p.y += (fy - p.y) * Math.min(1, dt * 1.8);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")");
      if (Math.hypot(fx - p.x, fy - p.y) < 14 || p.t > 3.2) p.st = 1; }
    else p.e.setAttribute("transform", "translate(" + f1(fx + 11) + " " + f1(fy - 9) + ") rotate(24)");
    p.e.setAttribute("opacity", clamp(sv.anti * 1.6).toFixed(2)); if (sv.anti < 0.12) killP(p); });
  /* immune calming particles drift to inflammatory cells while the drug is on */
  acc.calm += dt * sv.imm * 4; while (acc.calm >= 1) { acc.calm--; const p = freeP(calmP); if (p) { p.fi = Math.floor(rnd(0, inflCells.length)); emitP(p, rnd(60, 120), rnd(180, 260), 0, 0); } }
  calmP.forEach((p) => { if (!p.on) return; const c = inflCells[p.fi] || inflCells[0]; p.t += dt;
    p.x += (c.x - p.x) * Math.min(1, dt * 1.4); p.y += (c.y - p.y) * Math.min(1, dt * 1.4);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(sv.imm * 1.6 * (1 - p.t / 3)).toFixed(2));
    if (Math.hypot(c.x - p.x, c.y - p.y) < 10 || p.t > 3 || sv.imm < 0.12) killP(p); });
  /* air puffs down the airway: a strong oxygen stream on oxygen treatment */
  acc.air += dt * (0.8 + 7 * sv.oxyT); while (acc.air >= 1) { acc.air--; const p = freeP(airP); if (p) emitP(p, LX + rnd(-4, 4), 64, rnd(-3, 3), rnd(45, 65)); }
  airP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp((0.25 + 0.75 * sv.oxyT) * (1 - p.t / 1.4)).toFixed(2)); if (p.t > 1.4 || p.y > trachY - 3) killP(p); });
  gg.inj.set(sv.inj, wordOf(sv.inj, 0.3, 0.62, ["low", "ongoing", "high"])); gg.fib.set(sv.col, wordOf(sv.col, 0.3, 0.62, ["little", "moderate", "extensive"])); gg.dif.set(sv.diff, wordOf(sv.diff, 0.35, 0.62, ["low", "reduced", "near normal"]));
  gg.comp.set(sv.comp, wordOf(sv.comp, 0.35, 0.62, ["low", "reduced", "near normal"])); gg.vol.set(sv.vol, wordOf(sv.vol, 0.35, 0.62, ["low", "reduced", "near normal"])); gg.oxy.set(sv.oxy, wordOf(sv.oxy, 0.45, 0.68, ["low", "reduced", "near normal"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
