/* Paclitaxel scene: locked spindle in the tumour cell; axon, marrow, mast cell, hair and muscle toxicities; gauges. */
const CC = [244, 252], CR = 116, POLE = 76;
const CHY = [-42, -26, -10, 10, 26, 42], CHX = [-4, 4, -3, 3, -5, 5];
const MAST = [588, 257];
const RAILY = [112, 117, 122];
const L = { tum: $("tum"), drug: $("drugG"), nerve: $("nerveG"), mar: $("marG"), alg: $("algG"), skinS: $("skinSlot"), hair: $("hairG"), muscS: $("muscSlot"), ache: $("acheG"), over: $("over"), panel: $("panel") };
const sm = { K: 0.5, N: 0.4, P: 0.4, H: 0.1, A: 0.4, Mu: 0.4, pac: 0, prem: 0 };
let cyc = 0.28, frozen = false, capEl = null, capKey = "";
let skinO = null, muscO = null, skinSurf = [610, 308], muscBelly = [615, 398];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 0) return "No treatment. Tumour cells divide freely and healthy cells are left alone.";
  if (d === 2) return "Premedication calms the allergy alarm, but nerve, marrow, hair and muscle harm still build.";
  return l === 0 ? "Paclitaxel locks the spindle. The tumour arrests while the feet start to tingle."
    : l === 1 ? "More cycles. Tumour kill builds, and nerve, marrow, hair and muscle harm build too."
    : "Late course. Nerves grow numb, counts fall and hair is lost as the tumour keeps shrinking.";
}
/* ---- tumour cell: spindle, chromosomes, division or arrest ---- */
let Tb = null, dieOv = null;
const fibres = [], chroms = [], blebs = [], daus = [];
let pacD = [], apop = [];
function initTumour() {
  const g = mk("g", {}, L.tum); place(g, CC[0], CC[1], 0, 1); Tb = { g };
  Tb.body = cell(g, { cls: "tum", r: CR, seed: 3, wob: 0.05, n: 12 });
  dieOv = mk("circle", { class: "pn-die", r: CR - 4, opacity: "0" }, g);
  [-1, 1].forEach((s) => mk("circle", { class: "pn-pole", cx: s * POLE, cy: 0, r: 5 }, g));
  CHY.forEach((y, i) => {
    [-1, 1].forEach((s) => fibres.push(mk("path", { class: "pn-sp", d: "M" + (s * POLE) + " 0L" + (s * 8 + CHX[i]) + " " + y }, g)));
    chroms.push({ c1: mk("circle", { class: "pn-ch", r: 4.6 }, g), c2: mk("circle", { class: "pn-ch", r: 4.6 }, g), y, px: CHX[i] });
  });
  for (let i = 0; i < 8; i++) blebs.push({ e: mk("circle", { class: "pn-bleb", r: 0, opacity: "0" }, g), a: (i / 8) * 6.2832 + 0.3 });
  const t = mk("text", { class: "sc-lab", x: 210, y: 348 }, L.tum); t.textContent = "tubulin";
  mk("path", { class: "dr-leader", d: "M232 340L240 302" }, L.tum);
  [-1, 1].forEach((s) => { const dg = mk("g", { opacity: "0" }, L.tum); cell(dg, { cls: "tum", r: 64, seed: s > 0 ? 5 : 9, wob: 0.06, n: 10 }); daus.push({ g: dg, s }); });
  pacD = pool(24, () => mk("circle", { class: "sc-p p-pac", r: 3.2 }, L.drug));
  apop = pool(10, () => mk("circle", { class: "sc-p p-apop", r: 2.6 }, L.drug));
}
let accPac = 0, accAp = 0;
function stepTumour(dt) {
  if (sm.pac > 0.5) cyc = lerp(cyc, 0.28, Math.min(1, dt * 2));
  else cyc = (cyc + dt * 0.1) % 1;
  const sep = cyc < 0.35 ? 3 : cyc < 0.6 ? 3 + ((cyc - 0.35) / 0.25) * 69 : 72;
  const mOp = cyc < 0.6 ? 1 : cyc < 0.72 ? 1 - (cyc - 0.6) / 0.12 : cyc < 0.9 ? 0 : (cyc - 0.9) / 0.1;
  Tb.g.setAttribute("opacity", mOp.toFixed(2));
  const dp = clamp((cyc - 0.6) / 0.3);
  daus.forEach((d) => { d.g.setAttribute("opacity", (1 - mOp).toFixed(2)); place(d.g, CC[0] + d.s * (52 + 30 * dp), CC[1], 0, 0.55 + 0.25 * dp); });
  const fr = sm.K > 0.45;
  if (fr !== frozen) { frozen = fr; fibres.forEach((e) => e.setAttribute("class", fr ? "pn-sp frozen" : "pn-sp")); }
  chroms.forEach((c, i) => {
    const j1 = Math.sin(tm / 180 + i * 2.4) * 1.6 * sm.K, j2 = Math.cos(tm / 200 + i * 1.7) * 1.6 * sm.K;
    c.c1.setAttribute("cx", f1(c.px - sep + j1)); c.c1.setAttribute("cy", f1(c.y + j1 * 0.4));
    c.c2.setAttribute("cx", f1(c.px + sep + j2)); c.c2.setAttribute("cy", f1(c.y + j2 * 0.4));
  });
  blebs.forEach((b, i) => { b.e.setAttribute("cx", f1(Math.cos(b.a) * (CR - 2))); b.e.setAttribute("cy", f1(Math.sin(b.a) * (CR - 2))); b.e.setAttribute("r", f1(Math.max(0, sm.K * (5 + 3 * Math.sin(tm / 400 + i * 1.1))))); b.e.setAttribute("opacity", sm.K.toFixed(2)); });
  dieOv.setAttribute("opacity", (sm.K * 0.22).toFixed(2));
  accPac += dt * sm.pac * 9;
  while (accPac >= 1) { accPac--; const p = free(pacD); if (p) { emit(p, 22, rnd(120, 380), 0, 0, 0); p.tx = CC[0] + rnd(-70, 70); p.ty = CC[1] + rnd(-50, 50); } }
  pacD.forEach((p) => {
    if (!p.on) return;
    if (sm.pac < 0.5) { const o = parseFloat(p.e.getAttribute("opacity")) - dt * 1.6; if (o <= 0.02) kill(p); else p.e.setAttribute("opacity", o.toFixed(2)); return; }
    if (p.st === 0) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 4) p.st = 1; }
    else p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 300 + p.tx) * 1.5) + " " + f1(p.y + Math.cos(tm / 340 + p.ty) * 1.5) + ")");
  });
  accAp += dt * sm.K * 5;
  while (accAp >= 1) { accAp--; const p = free(apop); if (p) { const a = rnd(0, 6.2832); emit(p, CC[0] + Math.cos(a) * CR, CC[1] + Math.sin(a) * CR, Math.cos(a) * rnd(15, 30), Math.sin(a) * rnd(15, 30), 0); } }
  apop.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) kill(p); });
}
/* ---- nerve: axon rails stall, cargo piles up ---- */
const cargo = [], railPac = [], degB = [];
function initNerve() {
  const g = L.nerve;
  mk("circle", { class: "pn-soma", cx: 530, cy: 117, r: 15 }, g);
  mk("circle", { class: "pn-nucl", cx: 530, cy: 117, r: 6 }, g);
  [107, 127].forEach((y) => mk("path", { class: "pn-axon", d: "M545 " + y + "L820 " + y }, g));
  RAILY.forEach((y) => mk("path", { class: "pn-rail", d: "M547 " + y + "L818 " + y }, g));
  mk("circle", { class: "pn-term", cx: 824, cy: 117, r: 5 }, g);
  for (let i = 0; i < 10; i++) cargo.push({ e: mk("circle", { class: "sc-p p-cargo", r: 3 }, g), x: 550 + i * 26, r: i % 3 });
  for (let i = 0; i < 8; i++) railPac.push({ e: mk("circle", { class: "sc-p p-pac", r: 3.4, opacity: "0" }, g), x: 560 + i * 30 + rnd(0, 14), r: i % 3 });
  for (let i = 0; i < 3; i++) degB.push({ e: mk("circle", { class: "pn-deg", r: 2.5, opacity: "0" }, g), x: 798 + i * 9, y: 108 + i * 7 });
}
function stepNerve(dt) {
  const sp = 14 + 90 * (1 - sm.N * 0.92);
  cargo.forEach((c, i) => { c.x += sp * dt; if (c.x > 815) c.x = 550; c.e.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(RAILY[c.r] + Math.sin(tm / 500 + i * 2) * 1) + ")"); });
  railPac.forEach((p) => { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(RAILY[p.r]) + ")"); p.e.setAttribute("opacity", sm.pac.toFixed(2)); });
  const dOp = clamp((sm.N - 0.35) * 2);
  degB.forEach((b) => { b.e.setAttribute("cx", b.x); b.e.setAttribute("cy", b.y); b.e.setAttribute("opacity", dOp.toFixed(2)); });
}
/* ---- marrow: progenitors arrest, neutrophil output falls ---- */
const progs = [], progPac = [], neut = [];
function initMarrow() {
  const g = L.mar;
  mk("rect", { class: "pn-bone", x: 510, y: 164, width: 200, height: 46, rx: 23 }, g);
  mk("rect", { class: "pn-cavity", x: 532, y: 174, width: 156, height: 26, rx: 13 }, g);
  for (let i = 0; i < 5; i++) { const x = 552 + i * 30, y = 187 + (i % 2 ? 3 : -3); progs.push({ e: mk("circle", { class: "pn-prog", r: 7 }, g), x, y }); progPac.push({ e: mk("circle", { class: "sc-p p-pac", r: 3, opacity: "0" }, g), x: x + 5, y: y - 5 }); }
  for (let i = 0; i < 8; i++) neut.push({ e: mk("circle", { class: "sc-p p-neut", r: 3 }, g), x: 690 + i * 17, o: rnd(0, 6.28) });
}
function stepMarrow(dt) {
  progs.forEach((c, i) => { const s = sm.pac > 0.5 ? 1 : 1 + 0.16 * Math.sin(tm / 280 + i * 1.3); c.e.setAttribute("transform", "translate(" + c.x + " " + c.y + ") scale(" + s.toFixed(3) + ")"); });
  progPac.forEach((p) => { p.e.setAttribute("transform", "translate(" + p.x + " " + p.y + ")"); p.e.setAttribute("opacity", sm.pac.toFixed(2)); });
  const vis = 1 - sm.P * 0.88;
  neut.forEach((n, i) => { n.x += dt * 55; if (n.x > 830) n.x = 690; const fade = clamp((832 - n.x) / 36); n.e.setAttribute("transform", "translate(" + f1(n.x) + " " + f1(187 + Math.sin(tm / 600 + n.o) * 6) + ")"); n.e.setAttribute("opacity", (((i + 0.5) / neut.length < vis ? 1 : 0.08) * fade).toFixed(2)); });
}
/* ---- allergy: mast cell dumps histamine unless premedication blocks it ---- */
let mastG = null, flushEl = null, premRing = null;
const inGran = [], premOrb = [];
let hist = [];
function initAllergy() {
  const g = L.alg;
  flushEl = mk("ellipse", { class: "pn-flush", cx: 700, cy: 257, rx: 70, ry: 34, opacity: "0" }, g);
  mastG = mk("g", {}, g); place(mastG, MAST[0], MAST[1], 0, 1);
  cell(mastG, { cls: "mast", r: 21, seed: 4, wob: 0.1, n: 9 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.2832; inGran.push(mk("circle", { class: "pn-gran", cx: f1(Math.cos(a) * 9), cy: f1(Math.sin(a) * 9), r: 2.2 }, mastG)); }
  premRing = mk("circle", { class: "pn-prem", cx: MAST[0], cy: MAST[1], r: 30, opacity: "0" }, g);
  for (let i = 0; i < 3; i++) premOrb.push(mk("circle", { class: "sc-p p-prem", r: 3, opacity: "0" }, g));
  hist = pool(14, () => mk("circle", { class: "sc-p p-hist", r: 2.6 }, g));
}
let accHist = 0;
function stepAllergy(dt) {
  place(mastG, MAST[0], MAST[1], 0, 1 + 0.05 * Math.sin(tm / 350) * sm.H);
  inGran.forEach((e) => e.setAttribute("opacity", (1 - sm.H * 0.9).toFixed(2)));
  flushEl.setAttribute("opacity", (sm.H * 0.32).toFixed(2));
  premRing.setAttribute("opacity", sm.prem.toFixed(2));
  premOrb.forEach((e, i) => { const a = tm / 900 + i * 2.094; e.setAttribute("transform", "translate(" + f1(MAST[0] + Math.cos(a) * 30) + " " + f1(MAST[1] + Math.sin(a) * 30) + ")"); e.setAttribute("opacity", sm.prem.toFixed(2)); });
  accHist += dt * sm.H * 14;
  while (accHist >= 1) { accHist--; const p = free(hist); if (p) { const a = rnd(-1.2, 1.2); emit(p, MAST[0] + Math.cos(a) * 20, MAST[1] + Math.sin(a) * 20, Math.cos(a) * rnd(35, 65), Math.sin(a) * rnd(35, 65), 0); } }
  hist.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); });
}
/* ---- hair: shafts loosen and fall from skin ---- */
const hairs = [];
function initHair() {
  skinO = organ(L.skinS, "skin", 610, 328, 130, { h: 50 });
  skinSurf = skinO.ports.surface;
  const derm = skinO.ports.dermis || [skinSurf[0], skinSurf[1] + 30];
  [-36, -12, 12, 36].forEach((u, i) => {
    const bx = skinSurf[0] + u;
    mk("ellipse", { class: "pn-fol", cx: f1(bx), cy: f1(derm[1]), rx: 5, ry: 7 }, L.hair);
    const g = mk("g", {}, L.hair);
    mk("path", { class: "pn-hair", d: "M0 0L" + (i % 2 ? 3 : -3) + " -20" }, g);
    hairs.push({ g, bx, by: skinSurf[1] + 2, dir: i % 2 ? 1 : -1, i });
  });
}
function stepHair() {
  hairs.forEach((h) => {
    const sway = Math.sin(tm / 900 + h.i * 1.4) * 3 * (1 - sm.A);
    place(h.g, h.bx + sm.A * 8 * h.dir, h.by + sm.A * 24, sm.A * 40 * h.dir + sway, 1);
    h.g.setAttribute("opacity", (1 - sm.A * 0.85).toFixed(2));
  });
}
/* ---- muscle: aching flashes over the belly ---- */
const aches = [];
function initMuscle() {
  muscO = organ(L.muscS, "muscle", 615, 398, 150, { h: 48 });
  muscBelly = muscO.ports.belly;
  [[-42, 0], [0, -6], [42, 4]].forEach(([u, v]) => aches.push({ e: mk("path", { class: "pn-ache", d: "M0 -7L2 -2L7 0L2 2L0 7L-2 2L-7 0L-2 -2Z", opacity: "0" }, L.ache), x: muscBelly[0] + u, y: muscBelly[1] + v }));
}
function stepMuscle() {
  aches.forEach((a, i) => { a.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); a.e.setAttribute("opacity", (sm.Mu * (Math.sin(tm / 280 + i * 2.1) > -0.2 ? 1 : 0.12)).toFixed(2)); });
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 486, h = 60, xs = [120, 260, 400, 540, 680, 820];
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["kill", "Tumour kill", "g-good", "Share of tumour cells arrested and dying. Rises with each cycle of paclitaxel."],
   ["neuro", "Neuropathy", "g-neu", "Nerve harm from stalled axon transport. Builds with each cycle and fades only slowly."],
   ["pneut", "Neutropenia", "g-cyt", "Low neutrophils from arrested marrow. Deepest days after each dose, then recovers."],
   ["alg", "Allergy", "g-eos", "Histamine alarm set off by the Cremophor vehicle. Premedication keeps it calm."],
   ["hair", "Hair loss", "g-clot", "Hair loss from arrested hair roots. Builds over cycles and regrows afterwards."],
   ["mus", "Muscle pain", "g-bad", "Aching joints and muscles starting days after each dose."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0, h, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Paclitaxel", 46, 200, 100, 150, "Paclitaxel, given by drip. It sticks to beta tubulin, the building block of microtubules, and locks them so they cannot shorten.");
  pill(o, "Spindle", 320, 246, 408, 118, "The spindle is a cage of microtubule ropes that pulls chromosomes apart. Locked ropes cannot shorten, so the cell arrests in mitosis and dies.");
  pill(o, "Nerves", 790, 117, 880, 104, "Long sensory axons depend on microtubule rails to carry supplies. Paclitaxel locks the rails, so feet tingle first, then go numb in a stocking and glove pattern.");
  pill(o, "Marrow", 610, 170, 880, 174, "Marrow progenitors divide fast to make neutrophils. Paclitaxel arrests them, so neutrophil counts fall days after each dose.");
  pill(o, "Allergy", MAST[0], MAST[1] - 19, 880, 244, "The oily Cremophor vehicle can set off mast cells to dump histamine, causing flushing, rash and wheeze. Steroid and antihistamine premedication blocks this alarm.");
  pill(o, "Hair", skinSurf[0], skinSurf[1] - 4, 880, 314, "Hair root cells divide fast, so paclitaxel arrests them and the shaft loosens and falls out. Hair regrows after treatment ends.");
  pill(o, "Muscle", muscBelly[0], muscBelly[1], 880, 384, "Aching joints and muscles start days after each dose as microtubule injury irritates muscle and nerve endings.");
  capEl = mk("text", { class: "pn-cap", x: 30, y: 449 }, o); capEl.textContent = capText(drug, level);
}
function init() { initTumour(); initNerve(); initMarrow(); initAllergy(); initHair(); initMuscle(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.6);
  ["pac", "prem", "H"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["K", "N", "P", "A", "Mu"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  stepTumour(dt); stepNerve(dt); stepMarrow(dt); stepAllergy(dt); stepHair(); stepMuscle();
  gg.kill.set(sm.K, wordOf(sm.K, 0.2, 0.6, ["growing", "held", "shrinking"]));
  gg.neuro.set(sm.N, wordOf(sm.N, 0.25, 0.6, ["ok", "tingling", "numb"]));
  gg.pneut.set(sm.P, wordOf(sm.P, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.alg.set(sm.H, wordOf(sm.H, 0.2, 0.45, ["calm", "uneasy", "reacting"]));
  gg.hair.set(sm.A, wordOf(sm.A, 0.25, 0.6, ["kept", "thinning", "lost"]));
  gg.mus.set(sm.Mu, wordOf(sm.Mu, 0.25, 0.6, ["ok", "achy", "painful"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
