/* Vincristine scene: capped tubulin and spindle loss in the tumour cell; nerve, bowel, vein, spine and marrow effects; gauges. */
const CC = [244, 250], CR = 114, POLE = 74;
const CHY = [-42, -26, -10, 10, 26, 42], CHX = [-4, 4, -3, 3, -5, 5];
const TUB = [[-70, -60], [-30, -75], [30, -68], [70, -50], [-85, -10], [-45, -25], [0, -40], [45, -20], [85, 5], [-60, 30], [41, 65], [75, 40]];
const SCAT = [[-30, -40], [25, -48], [-45, -15], [40, -25], [-35, 20], [30, 30], [-20, 45], [15, 50], [50, 10], [-55, 5], [10, -60], [-5, 62]];
const RAILY = [110, 115, 120];
const LEAKX = 650;
const L = { tum: $("tum"), drug: $("drugG"), nerve: $("nerveG"), bowelS: $("bowelSlot"), bowel: $("bowelG"), vein: $("veinG"), spine: $("spineG"), mar: $("marG"), over: $("over"), panel: $("panel") };
const sm = { K: 0.5, N: 0.4, B: 0.3, T: 0.3, M: 0.05, vcr: 0, prot: 0 };
let cyc = 0.28, capEl = null, capKey = "";
let colonO = null, bowelTrack = null, transP = [645, 205];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 0) return "No treatment. Tumour cells divide freely and healthy cells are left alone.";
  if (d === 2) return "Bowel care keeps stool moving and a safe line protects the vein, but nerve harm still builds.";
  return l === 0 ? "Vincristine caps tubulin. No spindle forms, the tumour arrests and tingling begins."
    : l === 1 ? "More cycles. Tumour kill builds, and nerve and bowel harm build too."
    : "Late course. Numb feet, weak grip and a blocked bowel while the tumour dies.";
}
/* ---- tumour cell: tubulin capped, spindle lost, chromosomes scatter, arrest ---- */
let Tb = null, dieOv = null, stubbed = false;
const fibres = [], chroms = [], blebs = [], daus = [], tubs = [];
let vcrD = [], apop = [];
function initTumour() {
  const g = mk("g", {}, L.tum); place(g, CC[0], CC[1], 0, 1); Tb = { g };
  Tb.body = cell(g, { cls: "tum", r: CR, seed: 3, wob: 0.05, n: 12 });
  dieOv = mk("circle", { class: "vc-die", r: CR - 4, opacity: "0" }, g);
  [-1, 1].forEach((s) => mk("circle", { class: "vc-pole", cx: s * POLE, cy: 0, r: 5 }, g));
  TUB.forEach(([u, v], i) => {
    const b = mk("circle", { class: "vc-tub", cx: u, cy: v, r: 3 }, g);
    const c = mk("circle", { class: "vc-capd", cx: u, cy: v, r: 3.6, opacity: "0" }, g);
    tubs.push({ b, c, i });
  });
  CHY.forEach((y, i) => {
    [-1, 1].forEach((s) => fibres.push({ e: mk("path", { class: "vc-sp", d: "M" + (s * POLE) + " 0L" + (s * 8 + CHX[i]) + " " + y }, g), s, px: s * 8 + CHX[i], py: y }));
    chroms.push({ c1: mk("circle", { class: "vc-ch", r: 4.6 }, g), c2: mk("circle", { class: "vc-ch", r: 4.6 }, g), y, px: CHX[i], i });
  });
  for (let i = 0; i < 8; i++) blebs.push({ e: mk("circle", { class: "vc-bleb", r: 0, opacity: "0" }, g), a: (i / 8) * 6.2832 + 0.3 });
  const t = mk("text", { class: "vc-cap", x: 190, y: 340 }, L.tum); t.textContent = "tubulin";
  mk("path", { class: "dr-leader", d: "M228 332L282 317" }, L.tum);
  [-1, 1].forEach((s) => { const dg = mk("g", { opacity: "0" }, L.tum); cell(dg, { cls: "tum", r: 64, seed: s > 0 ? 5 : 9, wob: 0.06, n: 10 }); daus.push({ g: dg, s }); });
  vcrD = pool(24, () => mk("circle", { class: "sc-p p-vcr", r: 3.2 }, L.drug));
  apop = pool(10, () => mk("circle", { class: "sc-p p-apop", r: 2.6 }, L.drug));
}
let accVcr = 0, accAp = 0;
function stepTumour(dt) {
  if (sm.vcr > 0.5) cyc = lerp(cyc, 0.28, Math.min(1, dt * 2));
  else cyc = (cyc + dt * 0.1) % 1;
  const sep = cyc < 0.35 ? 3 : cyc < 0.6 ? 3 + ((cyc - 0.35) / 0.25) * 69 : 72;
  const mOp = cyc < 0.6 ? 1 : cyc < 0.72 ? 1 - (cyc - 0.6) / 0.12 : cyc < 0.9 ? 0 : (cyc - 0.9) / 0.1;
  Tb.g.setAttribute("opacity", mOp.toFixed(2));
  const dp = clamp((cyc - 0.6) / 0.3);
  daus.forEach((d) => { d.g.setAttribute("opacity", (1 - mOp).toFixed(2)); place(d.g, CC[0] + d.s * (52 + 30 * dp), CC[1], 0, 0.55 + 0.25 * dp); });
  const stub = sm.vcr;
  if ((stub > 0.5) !== stubbed) { stubbed = stub > 0.5; fibres.forEach((f) => f.e.setAttribute("class", stubbed ? "vc-sp gone" : "vc-sp")); }
  fibres.forEach((f) => {
    const ex = lerp(f.px, f.s * POLE * 0.92, stub), ey = lerp(f.py, 0, stub);
    f.e.setAttribute("d", "M" + (f.s * POLE) + " 0L" + f1(ex) + " " + f1(ey));
  });
  tubs.forEach((tb) => tb.c.setAttribute("opacity", clamp(sm.vcr * 1.6 - tb.i * 0.06).toFixed(2)));
  chroms.forEach((c) => {
    const j1 = Math.sin(tm / 180 + c.i * 2.4) * 1.6 * sm.K, j2 = Math.cos(tm / 200 + c.i * 1.7) * 1.6 * sm.K;
    const s1 = SCAT[c.i * 2], s2 = SCAT[c.i * 2 + 1];
    c.c1.setAttribute("cx", f1(c.px - sep + s1[0] * 0.8 * sm.K + j1)); c.c1.setAttribute("cy", f1(c.y + s1[1] * 0.8 * sm.K + j1 * 0.4));
    c.c2.setAttribute("cx", f1(c.px + sep + s2[0] * 0.8 * sm.K + j2)); c.c2.setAttribute("cy", f1(c.y + s2[1] * 0.8 * sm.K + j2 * 0.4));
  });
  blebs.forEach((b, i) => { b.e.setAttribute("cx", f1(Math.cos(b.a) * (CR - 2))); b.e.setAttribute("cy", f1(Math.sin(b.a) * (CR - 2))); b.e.setAttribute("r", f1(Math.max(0, sm.K * (5 + 3 * Math.sin(tm / 400 + i * 1.1))))); b.e.setAttribute("opacity", sm.K.toFixed(2)); });
  dieOv.setAttribute("opacity", (sm.K * 0.22).toFixed(2));
  accVcr += dt * sm.vcr * 9;
  while (accVcr >= 1) { accVcr--; const p = free(vcrD); if (p) { const tu = TUB[Math.floor(Math.random() * TUB.length)]; emit(p, 22, rnd(120, 380), 0, 0, 0); p.tx = CC[0] + tu[0]; p.ty = CC[1] + tu[1]; } }
  vcrD.forEach((p) => {
    if (!p.on) return;
    if (sm.vcr < 0.5) { const o = parseFloat(p.e.getAttribute("opacity")) - dt * 1.6; if (o <= 0.02) kill(p); else p.e.setAttribute("opacity", o.toFixed(2)); return; }
    if (p.st === 0) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 4) p.st = 1; }
    else p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 300 + p.tx) * 1.5) + " " + f1(p.y + Math.cos(tm / 340 + p.ty) * 1.5) + ")");
  });
  accAp += dt * sm.K * 5;
  while (accAp >= 1) { accAp--; const p = free(apop); if (p) { const a = rnd(0, 6.2832); emit(p, CC[0] + Math.cos(a) * CR, CC[1] + Math.sin(a) * CR, Math.cos(a) * rnd(15, 30), Math.sin(a) * rnd(15, 30), 0); } }
  apop.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) kill(p); });
}
/* ---- nerve: microtubule rails melt back, cargo stalls, terminal degenerates ---- */
const cargo = [], railVcr = [], degB = [], rails = [];
function initNerve() {
  const g = L.nerve;
  mk("circle", { class: "vc-soma", cx: 528, cy: 115, r: 14 }, g);
  mk("circle", { class: "vc-nucl", cx: 528, cy: 115, r: 5.5 }, g);
  [105, 125].forEach((y) => mk("path", { class: "vc-axon", d: "M543 " + y + "L820 " + y }, g));
  RAILY.forEach((y) => rails.push(mk("path", { class: "vc-rail", d: "M547 " + y + "L818 " + y }, g)));
  mk("circle", { class: "vc-term", cx: 824, cy: 115, r: 5 }, g);
  for (let i = 0; i < 10; i++) cargo.push({ e: mk("circle", { class: "sc-p p-cargo", r: 3 }, g), x: 550 + i * 26, r: i % 3 });
  for (let i = 0; i < 8; i++) railVcr.push({ e: mk("circle", { class: "sc-p p-vcr", r: 3.4, opacity: "0" }, g), x: 560 + i * 30 + rnd(0, 14), r: i % 3 });
  for (let i = 0; i < 3; i++) degB.push({ e: mk("circle", { class: "vc-deg", r: 2.5, opacity: "0" }, g), x: 798 + i * 9, y: 106 + i * 7 });
}
function stepNerve(dt) {
  const front = 815 - sm.N * 70, sp = 14 + 90 * (1 - sm.N * 0.92);
  rails.forEach((e, i) => e.setAttribute("d", "M547 " + RAILY[i] + "L" + f1(front + 3) + " " + RAILY[i]));
  cargo.forEach((c, i) => { c.x += sp * dt; if (c.x > front) c.x = 550; c.e.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(RAILY[c.r] + Math.sin(tm / 500 + i * 2) * 1) + ")"); });
  railVcr.forEach((p) => { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(RAILY[p.r]) + ")"); p.e.setAttribute("opacity", (sm.vcr * (p.x < front ? 1 : 0)).toFixed(2)); });
  const dOp = clamp((sm.N - 0.35) * 2);
  degB.forEach((b) => { b.e.setAttribute("cx", b.x); b.e.setAttribute("cy", b.y); b.e.setAttribute("opacity", dOp.toFixed(2)); });
}
/* ---- bowel: stool pellets creep along the colon and pile up toward the rectum ---- */
const pellets = [], waves = [];
let distEl = null, lax = [], accLax = 0;
function initBowel() {
  colonO = organ(L.bowelS, "colon", 645, 205, 150, { h: 110 });
  transP = colonO.ports.transverse;
  bowelTrack = track([colonO.ports.caecum, colonO.ports.ascending, colonO.ports.transverse, colonO.ports.descending, colonO.ports.sigmoid, colonO.ports.rectum]);
  distEl = mk("ellipse", { class: "vc-dist", cx: f1(transP[0]), cy: f1(transP[1]), rx: 46, ry: 22, opacity: "0" }, L.bowel);
  for (let i = 0; i < 8; i++) { const p = trackPos(i / 8); pellets.push({ e: mk("circle", { class: "vc-pel", r: 3 }, L.bowel), u: i / 8, x: p.x, y: p.y }); }
  for (let k = 0; k < 2; k++) waves.push({ e: mk("circle", { class: "vc-wave", r: 6, opacity: "0" }, L.bowel), k });
  lax = pool(6, () => mk("circle", { class: "sc-p p-lax", r: 2.8 }, L.bowel));
}
function trackPos(u) { return bowelTrack.at(u); }
function stepBowel(dt) {
  const B = sm.B, spd = 0.055 * (1 - B * 0.9) + 0.002;
  pellets.forEach((pl) => {
    const gate = pl.u > 0.72 ? 0.12 : 1;
    pl.u = (pl.u + dt * spd * gate) % 1;
    const p = trackPos(pl.u); pl.x = p.x; pl.y = p.y;
    pl.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    pl.e.setAttribute("r", f1(3 + B * 1.2));
  });
  waves.forEach((wv) => {
    const p = trackPos((tm / 9000 + wv.k * 0.5) % 1);
    wv.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    wv.e.setAttribute("opacity", ((1 - B) * 0.75).toFixed(2));
  });
  distEl.setAttribute("opacity", (B * 0.38).toFixed(2));
  accLax += dt * sm.prot * 5;
  while (accLax >= 1) { accLax--; const p = free(lax); if (p) emit(p, transP[0] + rnd(-50, 50), 146, 0, rnd(36, 50), 0); }
  lax.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > transP[1] + 10) kill(p); });
}
/* ---- vein: drip flows in; a leak burns the skin unless the line is safe ---- */
const flow = [], blis = [];
let patchEl = null, safeEl = null, chamFl = null, dripA = null, dripB = null, leak = [], accLeak = 0;
function initVein() {
  const g = L.vein;
  mk("rect", { class: "vc-cham", x: 518, y: 258, width: 16, height: 26, rx: 3 }, g);
  chamFl = mk("rect", { class: "vc-chamfl", x: 520, y: 272, width: 12, height: 10, opacity: "0" }, g);
  dripA = mk("circle", { class: "sc-p p-vcr", r: 2.2, opacity: "0" }, g);
  dripB = mk("circle", { class: "sc-p p-vcr", r: 2.2, opacity: "0" }, g);
  mk("path", { class: "vc-drip", d: "M526 284L526 292" }, g);
  mk("rect", { class: "vc-vein", x: 510, y: 292, width: 290, height: 16, rx: 8 }, g);
  for (let i = 0; i < 8; i++) flow.push({ e: mk("circle", { class: "sc-p p-vcr", r: 2.8, opacity: "0" }, g), x: 534 + i * 33 });
  patchEl = mk("ellipse", { class: "vc-necro", cx: LEAKX, cy: 332, rx: 38, ry: 14, opacity: "0" }, g);
  [[-18, -6, 4], [0, 4, 5], [18, -5, 3.5]].forEach(([u, v, r]) => blis.push(mk("circle", { class: "vc-blis", cx: LEAKX + u, cy: 332 + v, r, opacity: "0" }, g)));
  safeEl = mk("circle", { class: "vc-safe", cx: LEAKX, cy: 300, r: 15, opacity: "0" }, g);
  leak = pool(8, () => mk("circle", { class: "sc-p p-vcr", r: 2.6 }, g));
}
function stepVein(dt) {
  chamFl.setAttribute("opacity", sm.vcr.toFixed(2));
  [dripA, dripB].forEach((e, k) => {
    const y = 260 + (((tm / 700) + k * 0.5) % 1) * 22;
    e.setAttribute("transform", "translate(526 " + f1(y) + ")");
    e.setAttribute("opacity", sm.vcr.toFixed(2));
  });
  flow.forEach((f) => { f.x += 55 * dt; if (f.x > 795) f.x = 534; f.e.setAttribute("transform", "translate(" + f1(f.x) + " 300)"); f.e.setAttribute("opacity", sm.vcr.toFixed(2)); });
  accLeak += dt * sm.T * 7;
  while (accLeak >= 1) { accLeak--; const p = free(leak); if (p) emit(p, LEAKX + rnd(-3, 3), 309, 0, rnd(25, 40), 0); }
  leak.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 326) kill(p); });
  patchEl.setAttribute("opacity", sm.T.toFixed(2));
  blis.forEach((e) => e.setAttribute("opacity", sm.T.toFixed(2)));
  safeEl.setAttribute("opacity", sm.prot.toFixed(2));
  safeEl.setAttribute("transform", "rotate(" + f1(tm / 30) + " " + LEAKX + " 300)");
}
/* ---- spine: intrathecal injection is fatal, so the syringe stays banned ---- */
let syrG = null, banC = null, banL = null, glowEl = null;
function initSpine() {
  const g = L.spine;
  glowEl = mk("circle", { class: "vc-glow", cx: 596, cy: 388, r: 22, opacity: "0.08" }, g);
  mk("rect", { class: "vc-canal", x: 551, y: 362, width: 8, height: 56, rx: 4 }, g);
  for (let i = 0; i < 4; i++) mk("rect", { class: "vc-vert", x: 536, y: 368 + i * 13, width: 38, height: 9, rx: 2 }, g);
  syrG = mk("g", {}, g); place(syrG, 596, 388, -150, 1);
  mk("rect", { class: "vc-syr", x: -18, y: -5, width: 28, height: 10, rx: 2 }, syrG);
  mk("rect", { class: "vc-syrfl", x: -14, y: -3, width: 16, height: 6 }, syrG);
  mk("path", { class: "vc-ln", d: "M-18 0L-25 0M-25 -5L-25 5" }, syrG);
  mk("path", { class: "vc-ln", d: "M10 0L26 0" }, syrG);
  banC = mk("circle", { class: "vc-ban", cx: 596, cy: 388, r: 18 }, g);
  banL = mk("path", { class: "vc-ban", d: "M583 401L609 375" }, g);
}
function stepSpine() {
  place(syrG, 596, 388, -150 + Math.sin(tm / 250) * 3 * sm.vcr, 1);
  const pulse = 0.55 + 0.35 * sm.vcr * (0.5 + 0.5 * Math.sin(tm / 300));
  banC.setAttribute("opacity", pulse.toFixed(2)); banL.setAttribute("opacity", pulse.toFixed(2));
  glowEl.setAttribute("opacity", (0.08 + 0.15 * sm.vcr).toFixed(2));
}
/* ---- marrow: progenitors keep dividing, neutrophils keep leaving ---- */
const progs = [], neut = [];
function initMarrow() {
  const g = L.mar;
  mk("rect", { class: "vc-bone", x: 660, y: 372, width: 190, height: 38, rx: 19 }, g);
  mk("rect", { class: "vc-cavity", x: 682, y: 380, width: 146, height: 22, rx: 11 }, g);
  [[702, 391], [732, 388], [762, 393], [792, 389]].forEach(([x, y], i) => progs.push({ e: mk("circle", { class: "vc-prog", r: 7 }, g), x, y, i }));
  for (let i = 0; i < 6; i++) neut.push({ e: mk("circle", { class: "sc-p p-neut", r: 3 }, g), x: 854 + i * 14, o: rnd(0, 6.28) });
}
function stepMarrow(dt) {
  progs.forEach((c) => { const s = 1 + 0.16 * Math.sin(tm / 280 + c.i * 1.3); c.e.setAttribute("transform", "translate(" + c.x + " " + c.y + ") scale(" + s.toFixed(3) + ")"); });
  neut.forEach((n) => { n.x += 55 * dt; if (n.x > 932) n.x = 854; n.e.setAttribute("transform", "translate(" + f1(n.x) + " " + f1(391 + Math.sin(tm / 600 + n.o) * 5) + ")"); n.e.setAttribute("opacity", clamp((934 - n.x) / 30).toFixed(2)); });
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 486, h = 60, xs = [150, 310, 470, 630, 790];
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["kill", "Tumour kill", "g-good", "Share of tumour cells arrested and dying. Rises with each cycle of vincristine."],
   ["neuro", "Neuropathy", "g-neu", "Nerve harm from broken axon transport. Builds with each cycle and fades only slowly."],
   ["bowel", "Constipation", "g-eos", "Blocked bowel from failed gut nerves. Bowel care with laxatives keeps stool moving."],
   ["tissue", "Tissue injury", "g-bad", "Skin death where drug leaks from the vein. A safe, free running line prevents it."],
   ["marrow", "Marrow", "g-cyt", "Marrow keeps making blood cells. Vincristine spares marrow, so counts stay steady."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0, h, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Vincristine", 60, 210, 100, 150, "Vincristine is given by drip into a vein. It caps tubulin, the building block of microtubules, so no spindle can form.");
  pill(o, "Spindle", 320, 244, 408, 118, "The spindle is a cage of ropes that lines chromosomes up and pulls them apart. With tubulin capped, no ropes form, so the cell arrests in metaphase and dies.");
  pill(o, "Nerves", 790, 115, 880, 104, "Long axons carry supplies on microtubule rails. Capped tubulin breaks the rails, so feet tingle then go numb, ankles weaken, grip fades and the jaw may ache.");
  pill(o, "Bowel", transP[0], transP[1], 880, 180, "Gut nerves also run on microtubules. When they fail the bowel slows and stalls toward ileus. Laxative bowel care keeps stool moving.");
  pill(o, "Vein leak", LEAKX, 318, 880, 300, "Vincristine burns any tissue it touches outside the vein. A leak blisters and kills skin, so the line must run freely with a careful watch.");
  pill(o, "Spine: never", 555, 366, 560, 350, "Vincristine must never enter spinal fluid. It destroys brain and nerves from the inside and this mistake is fatal. Vein only, always.");
  pill(o, "Marrow", 755, 372, 905, 352, "Unlike most chemo drugs, vincristine harms marrow little, so neutrophil counts stay steady while nerves suffer.");
  capEl = mk("text", { class: "vc-capline", x: 30, y: 449 }, o); capEl.textContent = capText(drug, level);
}
function init() { initTumour(); initNerve(); initBowel(); initVein(); initSpine(); initMarrow(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.6);
  ["vcr", "prot"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["K", "N", "B", "T", "M"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  stepTumour(dt); stepNerve(dt); stepBowel(dt); stepVein(dt); stepSpine(); stepMarrow(dt);
  gg.kill.set(sm.K, wordOf(sm.K, 0.2, 0.6, ["growing", "held", "shrinking"]));
  gg.neuro.set(sm.N, wordOf(sm.N, 0.25, 0.6, ["ok", "tingling", "numb"]));
  gg.bowel.set(sm.B, wordOf(sm.B, 0.25, 0.6, ["moving", "slow", "blocked"]));
  gg.tissue.set(sm.T, wordOf(sm.T, 0.25, 0.6, ["safe", "burning", "dead"]));
  gg.marrow.set(sm.M, "steady");
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
