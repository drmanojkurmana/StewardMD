/* Vinblastine scene: spindle falls apart in the tumour cell; marrow, bowel, nerve, skin and SIADH toxicities; gauges. */
const TC = [242, 258], CR = 104, POLE = 64;
const CHY = [-42, -26, -10, 10, 26, 42], CHX = [-4, 4, -3, 3, -5, 5];
const RAILY = [250, 258, 266];
const L = { tum: $("tum"), drug: $("drugG"), mar: $("marG"), gutS: $("gutSlot"), gut: $("gutFx"), nerve: $("nerveG"), skinS: $("skinSlot"), skin: $("skinFx"), si: $("siadh"), over: $("over"), panel: $("panel") };
const sm = { K: 0.5, M: 0.4, C: 0.4, N: 0.2, Sk: 0.3, Wt: 0.3, on: 0, care: 0 };
let cyc = 0.28, cutMode = false, capEl = null, capKey = "";
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 0) return "No treatment. The spindle pulls chromosomes apart and the tumour divides freely.";
  if (d === 2) return ["Bowel regimen and vein watch guard gut and skin, but marrow, nerves and water still suffer.",
    "Protected middle course. Tumour kill builds while gut keeps moving and the vein stays safe.",
    "Late course with care. Marrow runs very low and water builds, though gut and skin are guarded."][l];
  return ["Vinblastine caps tubulin. The spindle falls apart and the tumour arrests as marrow empties.",
    "More cycles. Tumour kill builds, and marrow, gut, nerve, skin and water harm build too.",
    "Late course. Marrow very low, gut blocked and water held, as the tumour keeps shrinking."][l];
}
/* ---- tumour cell: spindle depolymerises, chromosomes scatter, cell dies ---- */
let Tb = null, dieOv = null;
const fibres = [], chroms = [], blebs = [], daus = [], tubs = [], caps = [];
let vbl = [], apop = [];
function initTumour() {
  const g = mk("g", {}, L.tum); place(g, TC[0], TC[1], 0, 1); Tb = { g };
  Tb.body = cell(g, { cls: "tum", r: CR, seed: 3, wob: 0.05, n: 12 });
  dieOv = mk("circle", { class: "pn-die", r: CR - 4, opacity: "0" }, g);
  [-1, 1].forEach((s) => mk("circle", { class: "pn-pole", cx: s * POLE, cy: 0, r: 5 }, g));
  CHY.forEach((y, i) => {
    [-1, 1].forEach((s) => fibres.push({ e: mk("path", { class: "pn-sp", d: "" }, g), s, ex: s * 8 + CHX[i], ey: y }));
    chroms.push({ c1: mk("circle", { class: "pn-ch", r: 4.6 }, g), c2: mk("circle", { class: "pn-ch", r: 4.6 }, g), y, px: CHX[i] });
  });
  for (let i = 0; i < 8; i++) blebs.push({ e: mk("circle", { class: "pn-bleb", r: 0, opacity: "0" }, g), a: (i / 8) * 6.2832 + 0.3 });
  for (let i = 0; i < 12; i++) tubs.push({ e: mk("circle", { class: "sc-p p-tub", r: 2.2 }, g), x: rnd(-80, 80), y: rnd(-70, 70), v: rnd(4, 10), o: rnd(0, 6.28) });
  for (let i = 0; i < 10; i++) caps.push({ e: mk("circle", { class: "sc-p p-vbl", r: 3, opacity: "0" }, g), x: rnd(-50, 50), y: rnd(-40, 40) });
  const t = mk("text", { class: "sc-lab", x: 168, y: 392 }, L.tum); t.textContent = "tubulin";
  mk("path", { class: "dr-leader", d: "M196 384L224 330" }, L.tum);
  [-1, 1].forEach((s) => { const dg = mk("g", { opacity: "0" }, L.tum); cell(dg, { cls: "tum", r: 64, seed: s > 0 ? 5 : 9, wob: 0.06, n: 10 }); daus.push({ g: dg, s }); });
  vbl = pool(24, () => mk("circle", { class: "sc-p p-vbl", r: 3.2 }, L.drug));
  apop = pool(10, () => mk("circle", { class: "sc-p p-apop", r: 2.6 }, L.drug));
}
let accVbl = 0, accAp = 0;
function stepTumour(dt) {
  if (sm.on > 0.5) cyc = lerp(cyc, 0.28, Math.min(1, dt * 2));
  else cyc = (cyc + dt * 0.1) % 1;
  const sep = cyc < 0.35 ? 3 : cyc < 0.6 ? 3 + ((cyc - 0.35) / 0.25) * 69 : 72;
  const mOp = cyc < 0.6 ? 1 : cyc < 0.72 ? 1 - (cyc - 0.6) / 0.12 : cyc < 0.9 ? 0 : (cyc - 0.9) / 0.1;
  Tb.g.setAttribute("opacity", mOp.toFixed(2));
  const dp = clamp((cyc - 0.6) / 0.3);
  daus.forEach((d) => { d.g.setAttribute("opacity", (1 - mOp).toFixed(2)); place(d.g, TC[0] + d.s * (52 + 30 * dp), TC[1], 0, 0.55 + 0.25 * dp); });
  const cut = sm.K > 0.45;
  if (cut !== cutMode) { cutMode = cut; fibres.forEach((fb) => fb.e.setAttribute("class", cut ? "pn-sp cut" : "pn-sp")); }
  const lenF = 1 - 0.72 * sm.K;
  fibres.forEach((fb) => {
    const px = fb.s * POLE, ex = fb.s * POLE + (fb.ex - fb.s * POLE) * lenF;
    fb.e.setAttribute("d", "M" + f1(px) + " 0L" + f1(ex) + " " + f1(fb.ey * (0.4 + 0.6 * lenF)));
    fb.e.setAttribute("opacity", (1 - 0.5 * sm.K).toFixed(2));
  });
  chroms.forEach((c, i) => {
    const j1 = Math.sin(tm / 180 + i * 2.4) * (1.6 + 5 * sm.K), j2 = Math.cos(tm / 200 + i * 1.7) * (1.6 + 5 * sm.K);
    c.c1.setAttribute("cx", f1(c.px - sep + j1)); c.c1.setAttribute("cy", f1(c.y + j1 * 0.4));
    c.c2.setAttribute("cx", f1(c.px + sep + j2)); c.c2.setAttribute("cy", f1(c.y + j2 * 0.4));
  });
  tubs.forEach((tb) => { tb.x += Math.cos(tm / 700 + tb.o) * tb.v * dt; tb.y += Math.sin(tm / 800 + tb.o) * tb.v * dt;
    if (Math.hypot(tb.x, tb.y) > 88) { tb.x *= -0.9; tb.y *= -0.9; }
    tb.e.setAttribute("transform", "translate(" + f1(tb.x) + " " + f1(tb.y) + ")"); });
  caps.forEach((cp) => { cp.e.setAttribute("transform", "translate(" + f1(cp.x + Math.sin(tm / 300 + cp.y) * 1.5) + " " + f1(cp.y) + ")"); cp.e.setAttribute("opacity", sm.on.toFixed(2)); });
  blebs.forEach((b, i) => { b.e.setAttribute("cx", f1(Math.cos(b.a) * (CR - 2))); b.e.setAttribute("cy", f1(Math.sin(b.a) * (CR - 2))); b.e.setAttribute("r", f1(Math.max(0, sm.K * (5 + 3 * Math.sin(tm / 400 + i * 1.1))))); b.e.setAttribute("opacity", sm.K.toFixed(2)); });
  dieOv.setAttribute("opacity", (sm.K * 0.22).toFixed(2));
  accVbl += dt * sm.on * 9;
  while (accVbl >= 1) { accVbl--; const p = free(vbl); if (p) { emit(p, 22, rnd(120, 380), 0, 0, 0); p.tx = TC[0] + rnd(-70, 70); p.ty = TC[1] + rnd(-50, 50); } }
  vbl.forEach((p) => {
    if (!p.on) return;
    if (sm.on < 0.5) { const o = parseFloat(p.e.getAttribute("opacity")) - dt * 1.6; if (o <= 0.02) kill(p); else p.e.setAttribute("opacity", o.toFixed(2)); return; }
    if (p.st === 0) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 4) p.st = 1; }
    else p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 300 + p.tx) * 1.5) + " " + f1(p.y + Math.cos(tm / 340 + p.ty) * 1.5) + ")");
  });
  accAp += dt * sm.K * 5;
  while (accAp >= 1) { accAp--; const p = free(apop); if (p) { const a = rnd(0, 6.2832); emit(p, TC[0] + Math.cos(a) * CR, TC[1] + Math.sin(a) * CR, Math.cos(a) * rnd(15, 30), Math.sin(a) * rnd(15, 30), 0); } }
  apop.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) kill(p); });
}
/* ---- marrow: bone cavity precursors empty out ---- */
const marCells = [], outN = [];
function initMarrow() {
  const g = L.mar;
  mk("rect", { class: "pn-bone", x: 520, y: 96, width: 136, height: 64, rx: 14 }, g);
  mk("circle", { class: "pn-bone", cx: 520, cy: 128, r: 32 }, g);
  mk("circle", { class: "pn-bone", cx: 656, cy: 128, r: 32 }, g);
  mk("rect", { class: "pn-cav", x: 536, y: 108, width: 104, height: 40, rx: 20 }, g);
  for (let i = 0; i < 10; i++) marCells.push({ e: mk("circle", { class: "pn-prog", cx: 0, cy: 0, r: 4.5 }, g), x: 546 + (i % 5) * 21 + rnd(-3, 3), y: 118 + Math.floor(i / 5) * 14 + rnd(-2, 2), s: 1 });
  for (let i = 0; i < 6; i++) outN.push({ e: mk("circle", { class: "sc-p p-neut", r: 3 }, g), x: 692 + i * 10, o: rnd(0, 6.28) });
}
function stepMarrow(dt) {
  const want = Math.round((1 - sm.M) * marCells.length);
  marCells.forEach((c, i) => { c.s = lerp(c.s, i < want ? 1 : 0, Math.min(1, dt * 2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(4.5 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  const vis = 1 - sm.M * 0.9;
  outN.forEach((n, i) => { n.x += dt * 40; if (n.x > 742) n.x = 692; n.e.setAttribute("transform", "translate(" + f1(n.x) + " " + f1(128 + Math.sin(tm / 600 + n.o) * 5) + ")"); n.e.setAttribute("opacity", (((i + 0.5) / outN.length < vis ? 1 : 0.08)).toFixed(2)); });
}
/* ---- bowel: wave slows, stool lumps pile up ---- */
const wave = [], stools = [];
function initGut() {
  organ(L.gutS, "bowel", 815, 140, 140, { h: 92 });
  for (let i = 0; i < 5; i++) wave.push({ e: mk("circle", { class: "sc-p p-tub", r: 2.6 }, L.gut), x: 762 + i * 24 });
  [[792, 132], [812, 146], [832, 132], [822, 156]].forEach(([x, y]) => stools.push({ e: mk("rect", { class: "pn-stool", x: x - 7, y: y - 5, width: 14, height: 10, rx: 5, opacity: "0" }, L.gut), x, y }));
}
function stepGut(dt) {
  wave.forEach((wd, i) => { wd.x += dt * 46 * (1 - 0.85 * sm.C); if (wd.x > 868) wd.x = 762; wd.e.setAttribute("transform", "translate(" + f1(wd.x) + " " + f1(140 + Math.sin(tm / 500 + i * 1.5) * 8) + ")"); });
  stools.forEach((s) => s.e.setAttribute("opacity", sm.C.toFixed(2)));
}
/* ---- nerve: axon transport stalls, mildly ---- */
const cargo = [], railV = [], degB = [];
function initNerve() {
  const g = L.nerve;
  mk("circle", { class: "pn-soma", cx: 528, cy: 258, r: 12 }, g);
  mk("circle", { class: "pn-nucl", cx: 528, cy: 258, r: 5 }, g);
  [248, 268].forEach((y) => mk("path", { class: "pn-axon", d: "M540 " + y + "L700 " + y }, g));
  RAILY.forEach((y) => mk("path", { class: "pn-rail", d: "M542 " + y + "L698 " + y }, g));
  mk("circle", { class: "pn-term", cx: 704, cy: 258, r: 5 }, g);
  for (let i = 0; i < 6; i++) cargo.push({ e: mk("circle", { class: "sc-p p-cargo", r: 3 }, g), x: 546 + i * 26, r: i % 3 });
  for (let i = 0; i < 6; i++) railV.push({ e: mk("circle", { class: "sc-p p-vbl", r: 3.4, opacity: "0" }, g), x: 552 + i * 25 + rnd(0, 10), r: i % 3 });
  for (let i = 0; i < 2; i++) degB.push({ e: mk("circle", { class: "pn-deg", r: 2.5, opacity: "0" }, g), x: 700 + i * 9, y: 248 + i * 12 });
}
function stepNerve(dt) {
  const sp = 14 + 80 * (1 - sm.N * 0.9);
  cargo.forEach((c, i) => { c.x += sp * dt; if (c.x > 696) c.x = 546; c.e.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(RAILY[c.r] + Math.sin(tm / 500 + i * 2) * 1) + ")"); });
  railV.forEach((p) => { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(RAILY[p.r]) + ")"); p.e.setAttribute("opacity", sm.on.toFixed(2)); });
  const dOp = clamp((sm.N - 0.3) * 2);
  degB.forEach((b) => { b.e.setAttribute("cx", b.x); b.e.setAttribute("cy", b.y); b.e.setAttribute("opacity", dOp.toFixed(2)); });
}
/* ---- skin: drip leaks, patch dies unless vein care ---- */
let necro = null, shield = null;
let leak = [];
function initSkin() {
  organ(L.skinS, "skin", 815, 258, 120, { h: 64 });
  const g = L.skin;
  mk("path", { class: "pn-vein", d: "M688 232L788 232" }, g);
  mk("path", { class: "pn-needle", d: "M742 218L760 232" }, g);
  necro = mk("ellipse", { class: "pn-necro", cx: 806, cy: 258, rx: 26, ry: 14, opacity: "0" }, g);
  shield = mk("rect", { class: "pn-shield", x: 776, y: 230, width: 70, height: 56, rx: 12, opacity: "0" }, g);
  leak = pool(10, () => mk("circle", { class: "sc-p p-leak", r: 2.4 }, g));
}
let accLeak = 0;
function stepSkin(dt) {
  necro.setAttribute("opacity", (sm.Sk * 0.85).toFixed(2));
  shield.setAttribute("opacity", sm.care.toFixed(2));
  accLeak += dt * sm.Sk * (1 - sm.care) * 9;
  while (accLeak >= 1) { accLeak--; const p = free(leak); if (p) emit(p, 760, 232, rnd(10, 40), rnd(5, 30), 0); }
  leak.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p); });
}
/* ---- SIADH: brain ADH holds kidney water ---- */
let water = null, adhT = null;
let adh = [];
const ADH_TR = [[612, 368], [720, 368]];
function initSiadh() {
  organ(L.si, "brain", 560, 368, 96, { h: 72 });
  organ(L.si, "kidney", 772, 368, 84, { h: 80 });
  water = mk("ellipse", { class: "pn-water", cx: 772, cy: 388, rx: 20, ry: 4, opacity: "0.3" }, L.si);
  adhT = mk("text", { class: "sc-lab", x: 640, y: 348 }, L.si); adhT.textContent = "ADH";
  adh = pool(10, () => mk("circle", { class: "sc-p p-adh", r: 2.6 }, L.si));
}
let accAdh = 0;
function stepSiadh(dt) {
  water.setAttribute("ry", f1(4 + sm.Wt * 14));
  water.setAttribute("opacity", (0.25 + 0.5 * sm.Wt).toFixed(2));
  accAdh += dt * (0.5 + sm.Wt * 6) * (sm.on > 0.5 ? 1 : 0.15);
  while (accAdh >= 1) { accAdh--; const p = free(adh); if (p) emit(p, ADH_TR[0][0], ADH_TR[0][1] + rnd(-6, 6), 0, 0, 0); }
  adh.forEach((p) => { if (!p.on) return; p.x += 60 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 400 + p.x) * 2) + ")"); if (p.x > ADH_TR[1][0]) kill(p); });
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 486, h = 60, xs = [120, 260, 400, 540, 680, 820];
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["kill", "Tumour kill", "g-good", "Share of tumour cells arrested and dying. Rises with each cycle of vinblastine."],
   ["mar", "Marrow", "g-cyt", "Myelosuppression. Marrow progenitors divide fast like tumour cells, so counts fall. Stronger than with vincristine."],
   ["gut", "Gut slow", "g-eos", "Constipation. Autonomic nerve harm stills the bowel wall, so stool piles up. A bowel regimen keeps it moving."],
   ["ner", "Nerves", "g-neu", "Neuropathy. Mild tingling from tubulin harm in long axons. Milder than with vincristine."],
   ["skn", "Skin", "g-bad", "Extravasation. Drug leaking out of the vein kills the skin patch. Vein watch and warmth limit it."],
   ["wat", "Water", "g-fl", "SIADH. Extra ADH makes the kidney hold water, which dilutes the blood salt."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0, h, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Vinblastine", 24, 190, 100, 108, "Vinblastine, given by drip. It caps tubulin, the building block of microtubules, so microtubules cannot grow.");
  pill(o, "Spindle", 300, 222, 400, 108, "The spindle is a cage of microtubule ropes that pulls chromosomes apart. With tubulin capped the ropes fall apart, so the cell arrests and dies.");
  pill(o, "Marrow", 556, 168, 560, 210, "Myelosuppression is the main harm. Marrow progenitors divide fast like tumour cells, so the drug empties them and blood counts fall.");
  pill(o, "Bowel", 852, 186, 820, 210, "Constipation. Autonomic nerve harm stills the bowel wall, so stool piles up and the bowel stops moving.");
  pill(o, "Nerves", 620, 268, 628, 302, "Mild tingling and numbness from tubulin harm in long axons. Milder than with vincristine.");
  pill(o, "Vein", 788, 236, 820, 302, "Extravasation. Drug leaking out of the vein burns the skin patch black. Stopping the drip, warmth and vein watch limit it.");
  pill(o, "SIADH", 740, 404, 700, 424, "SIADH. The drug drives extra ADH, so the kidney holds water and the blood salt is diluted.");
  capEl = mk("text", { class: "pn-cap", x: 30, y: 449 }, o); capEl.textContent = capText(drug, level);
}
function init() { initTumour(); initMarrow(); initGut(); initNerve(); initSkin(); initSiadh(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.6);
  ["on", "care"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["K", "M", "C", "N", "Sk", "Wt"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  stepTumour(dt); stepMarrow(dt); stepGut(dt); stepNerve(dt); stepSkin(dt); stepSiadh(dt);
  gg.kill.set(sm.K, wordOf(sm.K, 0.2, 0.6, ["growing", "held", "shrinking"]));
  gg.mar.set(sm.M, wordOf(sm.M, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.gut.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["moving", "slow", "blocked"]));
  gg.ner.set(sm.N, wordOf(sm.N, 0.25, 0.6, ["ok", "tingling", "numb"]));
  gg.skn.set(sm.Sk, wordOf(sm.Sk, 0.25, 0.55, ["ok", "sore", "burnt"]));
  gg.wat.set(sm.Wt, wordOf(sm.Wt, 0.25, 0.55, ["ok", "held", "dilute"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
