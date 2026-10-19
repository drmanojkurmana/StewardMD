/* Osimertinib scene: mutant EGFR blockade on the left; skin, bowel, lung, heart and nail on the right. */
const WW = SC.W;
const layers = { cell: $("cellSlot"), egfr: $("egfr"), wt: $("wtSlot"), parts: $("parts"), skin: $("skinSlot"), bowel: $("bowelSlot"), lung: $("lungSlot"), heart: $("heartSlot"), nail: $("nailSlot"), over: $("over"), panel: $("panel") };
const CX = 240, CY = 252, CR = 128, KX = 240, KY = 199;
const MX = 478, MY = 315, MR = 52;
/* ---- main tumour cell ---- */
let cellG = null, deadShade = null;
function initCell() {
  cellG = cell(layers.cell, { cls: "tum", r: CR, nuc: 0.5, seed: 5, wob: 0.07 });
  place(cellG, CX, CY, 0, 1);
  deadShade = mk("circle", { class: "osi-dead", cx: 0, cy: 0, r: CR * 0.96, opacity: "0" }, cellG);
}
/* ---- mutant EGFR: Y arms outside, kinase with the C797 pocket inside ---- */
let wedge = null, flash = null, bondRing = null;
function starD(r1, r2, n) { let d = ""; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = (i / (n * 2)) * 6.283; d += (i ? "L" : "M") + f1(Math.cos(a) * r) + " " + f1(Math.sin(a) * r); } return d + "Z"; }
function initEgfr() {
  const g = layers.egfr;
  mk("path", { class: "osi-arm", d: "M240 122L222 94M240 122L258 94" }, g);
  mk("circle", { class: "osi-knob", cx: 222, cy: 94, r: 4 }, g);
  mk("circle", { class: "osi-knob", cx: 258, cy: 94, r: 4 }, g);
  mk("rect", { class: "osi-tm", x: 233, y: 120, width: 14, height: 38, rx: 4 }, g);
  mk("ellipse", { class: "osi-lobe", cx: KX, cy: 172, rx: 40, ry: 17 }, g);
  mk("ellipse", { class: "osi-lobe2", cx: KX, cy: 232, rx: 50, ry: 23 }, g);
  mk("rect", { class: "osi-pocket", x: KX - 24, y: 189, width: 48, height: 20, rx: 6 }, g);
  mk("circle", { class: "osi-cys", cx: 262, cy: KY, r: 3.2 }, g);
  const c1 = mk("text", { class: "osi-tag", x: 270, y: 203 }, g); c1.textContent = "C797";
  const c2 = mk("text", { class: "osi-tag", x: 150, y: 250, "text-anchor": "middle" }, g); c2.textContent = "T790M";
  wedge = mk("rect", { class: "osi-wedge", x: KX - 17, y: 191, width: 34, height: 16, rx: 5, opacity: "0" }, g);
  bondRing = mk("circle", { class: "osi-bond", cx: 262, cy: KY, r: 6.5, opacity: "0" }, g);
  flash = mk("g", { opacity: "0" }, g);
  mk("path", { class: "osi-flash", d: starD(12, 5, 8) }, flash);
  place(flash, KX, KY, 0, 1);
}
/* ---- healthy mini cell: wild type EGFR keeps working ---- */
let passW = null;
const wtEgf = [];
function initWt() {
  const g = cell(layers.wt, { cls: "health", r: MR, nuc: 0.45, seed: 9, wob: 0.09 });
  place(g, MX, MY, 0, 1);
  mk("path", { class: "osi-arm", d: "M478 292L466 278M478 292L490 278", "stroke-width": 2 }, layers.wt);
  mk("circle", { class: "osi-knob", cx: 466, cy: 278, r: 2.6 }, layers.wt);
  mk("circle", { class: "osi-knob", cx: 490, cy: 278, r: 2.6 }, layers.wt);
  mk("rect", { class: "osi-tm", x: 474, y: 290, width: 8, height: 16, rx: 3 }, layers.wt);
  mk("circle", { class: "osi-knob", cx: 478, cy: 310, r: 4 }, layers.wt);
  for (let i = 0; i < 2; i++) wtEgf.push(mk("circle", { class: "sc-p p-egf", r: 2.6 }, layers.parts));
  passW = mk("rect", { class: "osi-wedge", x: -11, y: -5, width: 22, height: 10, rx: 4 }, layers.parts);
}
/* ---- organs ---- */
let haze = null, hrtW = null;
const rash = [], crack = [], folds = [];
function initOrgans() {
  organ(layers.skin, "skin", 655, 148, 105, { h: 78 });
  [[-36, -16], [-12, -24], [15, -19], [36, -7], [-28, 7], [-2, 2], [24, 11], [4, 24]].forEach(([dx, dy], i) => {
    rash.push(mk("circle", { class: "osi-rash", cx: 655 + dx, cy: 148 + dy, r: 3 + (i % 3), opacity: "0" }, layers.skin));
  });
  organ(layers.bowel, "bowel", 858, 148, 100, { h: 78 });
  organ(layers.lung, "lung", 655, 268, 85, { h: 110 });
  haze = mk("ellipse", { class: "osi-haze", cx: 655, cy: 268, rx: 55, ry: 38, opacity: "0" }, layers.lung);
  [[-28, -13], [7, -20], [32, 4], [-6, 17]].forEach(([dx, dy]) => {
    crack.push(mk("circle", { class: "osi-crack", cx: 655 + dx, cy: 268 + dy, r: 2.6, opacity: "0" }, layers.lung));
  });
  organ(layers.heart, "heart", 858, 268, 80, { h: 105 });
  hrtW = mk("ellipse", { class: "osi-hrtwash", cx: 858, cy: 268, rx: 44, ry: 38, opacity: "0" }, layers.heart);
}
/* ---- fingertip with nail: folds inflame ---- */
function initNail() {
  const g = layers.nail;
  mk("rect", { class: "osi-finger", x: 737, y: 352, width: 56, height: 50, rx: 16 }, g);
  mk("rect", { class: "osi-nail", x: 747, y: 348, width: 36, height: 32, rx: 8 }, g);
  folds.push(mk("ellipse", { class: "osi-fold", cx: 747, cy: 372, rx: 5, ry: 8, opacity: "0" }, g));
  folds.push(mk("ellipse", { class: "osi-fold", cx: 783, cy: 372, rx: 5, ry: 8, opacity: "0" }, g));
  folds.push(mk("ellipse", { class: "osi-fold", cx: 765, cy: 382, rx: 16, ry: 5, opacity: "0" }, g));
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const osi = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { x: -7, y: -4, width: 14, height: 8, rx: 3, class: "osi-wedge" }, g); return g; });
const egf = pool(12, () => mk("circle", { class: "sc-p p-egf", r: 2.6 }, layers.parts));
const atp = pool(10, () => mk("circle", { class: "sc-p p-atp", r: 3 }, layers.parts));
const sig = pool(22, () => mk("circle", { class: "sc-p p-osisig", r: 2.6 }, layers.parts));
const wtSig = pool(6, () => mk("circle", { class: "sc-p p-osisig", r: 2.2 }, layers.parts));
const gut = pool(12, () => mk("circle", { class: "sc-p p-gut", r: 2.8 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges, caption ---- */
const gg = {};
let capEl = null;
function capText(m) {
  if (!m.on) return "No drug yet: mutant EGFR keeps firing and the tumour keeps growing.";
  if (m.prot) return "Checks catch lung and heart harm early while the tumour stays controlled.";
  return m.Kill < 0.6 ? "Osimertinib locks EGFR shut; early rash and loose stools stay mild." : "Tumour controlled; lung and heart harm build with time, nails suffer.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [120, 300, 480, 660, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour kill: covalent EGFR blockade starves the cancer of growth signals so tumour cells die."],
    ["rash", "Rash", "g-eos", "Rash: EGFR keeps skin healthy, so blocking it inflames hair follicles; milder than older drugs because healthy EGFR is mostly spared."],
    ["bowel", "Diarrhoea", "g-fl", "Diarrhoea: EGFR keeps the gut lining sealed, so blocking it loosens the bowel; usually mild for the same sparing reason."],
    ["lung", "Lung injury", "g-cyt", "Lung injury: rarely the drug inflames the lung interstitium and scars air sac walls, causing breathlessness; checks and steroids catch it early."],
    ["heart", "Heart risk", "g-bad", "Heart risk: rarely the drug prolongs the QT interval and weakens heart muscle; ECG and heart checks catch it early."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mutant EGFR", 282, 180, 150, 90, "Mutant EGFR: a stuck-on growth switch in lung cancer cells, sensitising change plus T790M. Osimertinib bonds to cysteine 797 and locks it shut.");
  pill(ox, "Osimertinib", 42, 320, 80, 400, "Osimertinib: a third generation pill that bonds irreversibly to cysteine 797 of mutant EGFR, blocking T790M while sparing healthy EGFR.");
  pill(ox, "Wild type spared", 478, 300, 478, 396, "Healthy EGFR keeps working: the drug largely ignores it, so skin and gut harm stays milder than with older EGFR drugs.");
  pill(ox, "Rash", 630, 140, 640, 92, "Rash and acne-like spots: skin needs EGFR, so blocking it inflames follicles; milder here because healthy EGFR is spared.");
  pill(ox, "Diarrhoea", 890, 140, 872, 92, "Loose stools: the gut lining needs EGFR to stay sealed, so blocking it loosens the bowel.");
  pill(ox, "Lung injury", 628, 258, 628, 336, "Interstitial lung disease: rarely the immune system attacks drug-exposed lung tissue and scars the air sac walls; stop the drug and give steroids.");
  pill(ox, "Heart strain", 890, 258, 888, 336, "QT prolongation and cardiomyopathy: rarely the drug slows heart recharge and weakens muscle; ECG and echo checks catch it early.");
  pill(ox, "Nail changes", 765, 378, 765, 414, "Painful nail folds: blocking EGFR around nails inflames the cuticle and ingrown edges form.");
  capEl = mk("text", { class: "osi-capline", x: 30, y: 428 }, ox); capEl.textContent = capText({ on: 0, prot: 0, Kill: 0 });
}
const sm = { Kill: 0, Rash: 0, Bowel: 0, Lung: 0, Heart: 0, Nail: 0, on: 0, prot: 0 };
const acc = { osi: 0, egf: 0, atp: 0, sig: 0, wt: 0, gut: 0 };
function init() { initCell(); initEgfr(); initWt(); initOrgans(); initNail(); initPanel(); }
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 0.9);
  ["Kill", "Rash", "Bowel", "Lung", "Heart", "Nail"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.on = lerp(sm.on, m.on, k1); sm.prot = lerp(sm.prot, m.prot, k1);
  const growth = sm.on > 0.5 ? (1 - sm.Kill) : 0.85;
  /* tumour cell: darkens and shrinks as it dies */
  deadShade.setAttribute("opacity", (sm.Kill * 0.45).toFixed(2));
  place(cellG, CX + Math.sin(tm / 1500) * 2, CY + Math.cos(tm / 1800) * 2, 0, 1 - 0.06 * sm.Kill + 0.015 * growth * Math.sin(tm / 500));
  wedge.setAttribute("opacity", sm.on.toFixed(2));
  const fl = 0.5 + 0.5 * Math.sin(tm / 140);
  bondRing.setAttribute("opacity", (sm.on * (0.35 + 0.65 * fl)).toFixed(2));
  flash.setAttribute("opacity", (growth * (0.25 + 0.6 * fl)).toFixed(2));
  place(flash, KX, KY, tm / 60, 0.7 + 0.5 * fl * growth);
  /* growth factor keeps arriving at the Y arms */
  acc.egf += dt * 5;
  while (acc.egf >= 1) { acc.egf--; const p = free(egf); if (p) emit(p, rnd(200, 280), rnd(52, 66), 0, rnd(40, 60), 0); }
  egf.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 96) kill(p); });
  /* osimertinib drifts in from the left and docks in the pocket */
  acc.osi += dt * sm.on * 5;
  while (acc.osi >= 1) { acc.osi--; const p = free(osi); if (p) emit(p, rnd(24, 60), rnd(150, 340), 0, 0, 0); }
  osi.forEach((p) => { if (!p.on) return; const dx = KX - p.x, dy = KY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 80 * dt; p.y += (dy / d) * 80 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 10) + ")"); if (d < 18) kill(p); });
  /* ATP seeks the pocket and bounces off once it is plugged */
  acc.atp += dt * 4;
  while (acc.atp >= 1) { acc.atp--; const p = free(atp); if (p) emit(p, rnd(350, 420), rnd(150, 320), 0, 0, 0); }
  atp.forEach((p) => {
    if (!p.on) return;
    if (p.k === 1) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    const dx = KX - p.x, dy = KY - p.y, d = Math.hypot(dx, dy) || 1;
    if (sm.on > 0.5 && d < 52) { p.k = 1; p.t = 0; p.vx = (dx / d) * -110; p.vy = (dy / d) * -110 + 30; return; }
    p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 12) kill(p);
  });
  /* growth signals stream from the firing kinase */
  acc.sig += dt * growth * 14;
  while (acc.sig >= 1) { acc.sig--; const p = free(sig); if (p) emit(p, KX + rnd(-8, 8), 215, rnd(-28, 28), rnd(55, 110), 0); }
  sig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y > 360) kill(p); });
  /* healthy cell: growth factor docks, signals persist, drug passes by */
  wtEgf.forEach((e, i) => { const a = tm / 700 + i * Math.PI; e.setAttribute("cx", f1(MX + Math.cos(a) * 24)); e.setAttribute("cy", f1(292 + Math.sin(a) * 24)); e.setAttribute("opacity", (0.5 + 0.5 * Math.sin(tm / 300 + i * 2)).toFixed(2)); });
  const sw = Math.sin(((tm / 1800) % 1) * Math.PI);
  place(passW, 560 - 36 * sw, MY, 0, 1);
  passW.setAttribute("opacity", (0.1 + 0.35 * sw).toFixed(2));
  acc.wt += dt * 2.2;
  while (acc.wt >= 1) { acc.wt--; const p = free(wtSig); if (p) emit(p, MX + rnd(-6, 6), 322, rnd(8, 26), rnd(14, 26), 0); }
  wtSig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  /* organs: rash spots, rushing bowel, hazy lung, slowing heart, sore nail folds */
  rash.forEach((s, i) => s.setAttribute("opacity", (sm.Rash * (0.55 + 0.3 * Math.sin(tm / 400 + i * 1.7))).toFixed(2)));
  place(layers.bowel, Math.sin(tm / 120) * 1.6 * sm.Bowel, 0, 0, 1);
  acc.gut += dt * sm.Bowel * 8;
  while (acc.gut >= 1) { acc.gut--; const p = free(gut); if (p) emit(p, 858 + rnd(-25, 25), 116, 0, rnd(60, 100), 0); }
  gut.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 184) kill(p); });
  haze.setAttribute("opacity", (sm.Lung * 0.55).toFixed(2));
  crack.forEach((c, i) => c.setAttribute("opacity", (sm.Lung * (0.4 + 0.4 * Math.sin(tm / 350 + i * 2))).toFixed(2)));
  const hb = Math.sin(tm * (0.002 - 0.001 * sm.Heart)), hs = 1 + (0.05 - 0.03 * sm.Heart) * hb;
  place(layers.heart, 858 * (1 - hs), 268 * (1 - hs), 0, hs);
  hrtW.setAttribute("opacity", (sm.Heart * 0.45).toFixed(2));
  folds.forEach((f) => f.setAttribute("opacity", (sm.Nail * 0.85).toFixed(2)));
  /* caption and gauges */
  const c = capText(m); if (capEl.textContent !== c) capEl.textContent = c;
  gg.kill.set(sm.Kill, wordOf(sm.Kill, 0.35, 0.7, ["none", "some", "high"]));
  gg.rash.set(sm.Rash, wordOf(sm.Rash, 0.25, 0.5, ["clear", "mild", "severe"]));
  gg.bowel.set(sm.Bowel, wordOf(sm.Bowel, 0.25, 0.5, ["calm", "loose", "severe"]));
  gg.lung.set(sm.Lung, wordOf(sm.Lung, 0.25, 0.6, ["clear", "hazy", "severe"]));
  gg.heart.set(sm.Heart, wordOf(sm.Heart, 0.25, 0.55, ["steady", "slow", "weak"]));
}
run({ init, step });
