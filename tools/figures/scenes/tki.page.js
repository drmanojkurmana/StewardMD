/* TKI scene: Philadelphia chromosome, BCR-ABL kinase with its ATP pocket and gatekeeper,
 * dasatinib and imatinib docking or rejected, signals carried through a marrow vessel,
 * clone growth and heart traced side effects. */
const TK = { chr: $("chr"), cell: $("cellbase"), kin: $("kin"), nodes: $("nodes"), vessel: $("vesselSlot"), marrow: $("marrow"), heart: $("heartSlot"), se: $("se"), parts: $("parts"), over: $("over"), panel: $("panel") };
let kinCX = 290, kinCY = 250;
const POCK = { x: 288, y: 250 };
/* ---- big leukaemic cell ---- */
let cellG = null;
function initCellBase() {
  cellG = cell(TK.cell, { cls: "leuk", r: 120, nuc: 0, seed: 5, wob: 0.07 });
  place(cellG, 290, 262, 0, 1);
}
/* ---- kinase: two lobes, pocket, gatekeeper, activation sensor, two drugs ---- */
const kinG = mk("g", {}, TK.kin);
const nLobe = mk("g", {}, kinG);
const cLobe = mk("g", {}, kinG);
let gateC = null, actOpen = null, actShut = null, haloRing = null;
const rejRings = [];
let drugD = null, drugI = null, drugDq = null, drugIq = null;
const drugPos = { dx: -70, dy: -46, ix: -80, iy: 40, qx: 64, qy: 20 };
function initKin() {
  kinG.setAttribute("transform", "translate(290 250)");
  cell(nLobe, { cls: "kin", r: 26, seed: 3, wob: 0.1 });
  cell(cLobe, { cls: "kin", r: 34, seed: 4, wob: 0.1 });
  mk("rect", { class: "pocket", x: -11, y: -9, width: 22, height: 18, rx: 6 }, kinG);
  actOpen = mk("path", { class: "act-open", d: "M-22 -12C-10 -28 10 -28 22 -10" }, kinG);
  actShut = mk("path", { class: "act-shut", d: "M-22 -12C-10 -4 8 -4 20 -14" }, kinG);
  haloRing = mk("circle", { class: "drug-halo", cx: -2, cy: 0, r: 24, opacity: "0" }, kinG);
  gateC = mk("circle", { class: "gate", cx: 15, cy: 0, r: 3 }, kinG);
  for (let i = 0; i < 2; i++) rejRings.push(mk("circle", { class: "rej-ring", cx: 15, cy: 0, r: 8, opacity: "0" }, kinG));
  drugD = mk("g", { opacity: "0" }, kinG);
  mk("circle", { class: "drugD", r: 13 }, drugD);
  mk("circle", { class: "drugD-b", r: 5.5 }, drugD);
  drugDq = mk("g", { opacity: "0" }, kinG);
  mk("circle", { class: "drugD", r: 10 }, drugDq);
  mk("circle", { class: "drugD-b", r: 4 }, drugDq);
  drugI = mk("g", { opacity: "0" }, kinG);
  mk("rect", { class: "drugI", x: -22, y: -9, width: 44, height: 18, rx: 9 }, drugI);
  mk("rect", { class: "drugI-b", x: 0, y: -9, width: 22, height: 18, rx: 9 }, drugI);
  drugIq = mk("g", { opacity: "0" }, kinG);
  mk("rect", { class: "drugI", x: -17, y: -7, width: 34, height: 14, rx: 7 }, drugIq);
  mk("rect", { class: "drugI-b", x: 0, y: -7, width: 17, height: 14, rx: 7 }, drugIq);
  place(nLobe, 0, -26, 0, 1); place(cLobe, 0, 28, 0, 1);
}
/* ---- substrate nodes (named by the Substrates pill) ---- */
const nodesArr = [];
function initNodes() {
  [[220, 0], [380, 1]].forEach(([x, i]) => {
    const g = mk("g", {}, TK.nodes);
    const halo = mk("circle", { class: "node-halo", r: 16, opacity: "0.2" }, g);
    cell(g, { cls: "subs", r: 12, seed: 20 + i, wob: 0.12 });
    place(g, x, 368, 0, 1);
    nodesArr.push({ g, halo, x, y: 368, glow: 0 });
  });
}
/* ---- recognisable organs; signals and traces anchor to their ports ---- */
let vesselO = null, heartO = null;
let vesTop = [600, 117], vesBot = [600, 283];
let trIn = null;
function initOrgans() {
  vesselO = organ(TK.vessel, "vessel", 600, 200, 42, { h: 170 });
  heartO = organ(TK.heart, "heart", 818, 340, 80, {});
  vesTop = vesselO.ports.in.slice(); vesBot = vesselO.ports.out.slice();
  trIn = track([[290, 250], [400, 212], [505, 158], vesTop]);
}
/* ---- marrow clone grid ---- */
const clones = [];
function initMarrow() {
  [648, 724, 800, 876].forEach((x, c) => [140, 200, 260].forEach((y, r) => {
    const i = clones.length, g = mk("g", {}, TK.marrow);
    const norm = cell(g, { cls: "norm", r: 20, nuc: 0.4, seed: i + 1, wob: 0.1 });
    const leuk = mk("g", {}, g); cell(leuk, { cls: "leuk", r: 20, nuc: 0.45, seed: i + 30, wob: 0.12 });
    const rim = mk("circle", { class: "mut-rim", r: 22, opacity: "0" }, g);
    place(g, x, y, 0, 1);
    clones.push({ g, norm, leuk, rim, x, y, thr: i / 12 });
  }));
}
/* ---- side effect icons anchored by the heart ---- */
let dropG = null, dropPath = null, swellEl = null, ripG = null, seFlush = null, qtBg = null, qtN = null, qtL = null;
const demoCells = [];
function initSE() {
  dropG = mk("g", { transform: "translate(640 352)" }, TK.se);
  dropPath = mk("path", { class: "drop", d: "M0 -10C6.6 -1.8 8.4 2.4 8.4 5.4A8.4 8.4 0 0 1 -8.4 5.4C-8.4 2.4 -6.6 -1.8 0 -10Z", transform: "scale(1.15)" }, dropG);
  swellEl = mk("ellipse", { class: "se-swell", cx: 640, cy: 372, rx: 7, ry: 3, opacity: "0.2" }, TK.se);
  ripG = mk("g", { transform: "translate(640 370) scale(0.65 1)", opacity: "0" }, TK.se);
  mk("path", { class: "rip", d: "M-18 -4q18 8 36 0" }, ripG);
  mk("path", { class: "rip", d: "M-24 3q24 10 48 0" }, ripG);
  [[690, 352], [714, 352]].forEach(([x, y], i) => { const g = cell(TK.se, { cls: "norm", r: 9, nuc: 0.4, seed: 60 + i, wob: 0.12 }); place(g, x, y, 0, 1); demoCells.push({ g, x, y }); });
  seFlush = mk("ellipse", { class: "se-flush", cx: 818, cy: 340, rx: 46, ry: 54, opacity: "0" }, TK.se);
  qtBg = mk("rect", { class: "se-qtbg", x: 768, y: 404, width: 100, height: 24, rx: 6, opacity: "0" }, TK.se);
  qtN = mk("polyline", { class: "qt-n", points: "774,416 786,416 790,406 796,424 800,416 820,416 824,410 832,410 836,416 862,416" }, TK.se);
  qtL = mk("polyline", { class: "qt-long", points: "774,416 786,416 790,406 796,424 800,416 818,416 824,402 840,402 846,416 862,416", opacity: "0" }, TK.se);
}
/* ---- particle pools (elements exposed as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const atp = pool(10, () => mk("rect", { class: "sc-p p-atp", x: -3, y: -3, width: 6, height: 6, rx: 1, transform: "rotate(45)" }, TK.parts));
const pss = pool(26, () => mk("circle", { class: "sc-p p-ps", r: 3 }, TK.parts));
const sigs = pool(16, () => mk("circle", { class: "sc-p p-sig", r: 2.2 }, TK.parts));
const clash = pool(10, () => { const g = mk("g", {}, TK.parts); mk("path", { class: "clash", d: "M-6 0L6 0M0 -6L0 6M-4 -4L4 4M-4 4L4 -4" }, g); return g; });
/* ---- labels, caption and gauges ---- */
const gg = {};
let drugPill = null, capEl = null, capKey = -1;
function capText(lvl, dg) {
  if (lvl === 2 && dg > 0) return "The gatekeeper change rejects the drug. Signals stay high.";
  if (dg === 1) return "Dasatinib sits in the pocket. Signals fade and the clone shrinks.";
  if (dg === 2) return "Imatinib locks the shut pocket. Signals fade and growth slows.";
  if (lvl === 2) return "No treatment. The gatekeeper clone signals without stop.";
  return "No treatment. The kinase stays open and the clone grows.";
}
function initTKPanel() {
  const P = TK.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The clone";
  [["kin", "Kinase", "g-bad", "BCR-ABL kinase activity. The Philadelphia swap leaves the kinase stuck on."],
    ["sig", "Signals", "g-cyt", "Phosphate flow to substrates. Active kinase loads ATP into its pocket and tags substrates that drive growth and survival."],
    ["gro", "Growth", "g-clot", "How fast the leukaemic clone expands in the marrow. It follows signalling and the mutant share."],
    ["blk", "Blocked", "g-good", "How much drug sits in the ATP pocket. Dasatinib fits both forms; imatinib locks only the shut form, but the gatekeeper mutant rejects both."],
    ["mut", "Mutant", "g-eos", "Share of the clone carrying the gatekeeper swap (T315I). It blocks drug binding while ATP still fits."],
    ["sef", "Side effects", "g-neu", "Fluid retention and pleural effusion, low blood counts and QT prolongation rise with treatment."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const O = TK.over;
  pill(O, "Philadelphia", 120, 132, 150, 100, "Philadelphia chromosome: a swap that fuses BCR to ABL. The short swapped chromosome marks it.");
  pill(O, "BCR-ABL", 322, 232, 486, 140, "BCR-ABL fusion protein. The ABL kinase part is stuck on, so it signals without normal controls.");
  pill(O, "ATP pocket", 274, 246, 118, 190, "ATP binding pocket. The kinase scoops ATP here and uses its phosphate to tag substrates.");
  pill(O, "Gatekeeper", 305, 250, 478, 300, "Gatekeeper spot at the pocket mouth. The T315I swap puts a bulkier block here that rejects both drugs while ATP still fits.");
  drugPill = pill(O, "Dasatinib", 232, 288, 118, 326, "Drug heading for the pocket. Dasatinib fits both pocket forms; imatinib locks only the shut form. Neither fits the gatekeeper mutant.");
  pill(O, "Substrates", 300, 372, 300, 406, "Substrates tagged with phosphate. Their signals tell the cell to divide (proliferation) and to stay alive (survival).");
  pill(O, "Clone", 724, 140, 852, 100, "Leukaemic clone in the marrow. Pale cells are normal; orange cells are BCR-ABL driven; red rims carry the gatekeeper mutant.");
  pill(O, "Side effects", 640, 352, 700, 310, "Treatment related effects: fluid retention and fluid around the lung, low blood counts from marrow suppression, and QT prolongation on the heart trace.");
  capEl = mk("text", { class: "tki-cap", x: 30, y: 432 }, O); capEl.textContent = capText(0, 0);
}
const sm = { K: 0.9, P: 0.9, G: 0.7, B: 0, Mut: 0.04, A: 0.06 };
const acc = { atp: 0, ps: 0, sig: 0, clash: 0 };
const drugNames = ["", "Dasatinib", "Imatinib"];
function init() { initCellBase(); initKin(); initNodes(); initOrgans(); initMarrow(); initSE(); initTKPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.K = lerp(sm.K, m.K, k2); sm.P = lerp(sm.P, m.P, k2); sm.G = lerp(sm.G, m.G, Math.min(1, dt * 0.3));
  sm.B = lerp(sm.B, m.B, k1); sm.Mut = lerp(sm.Mut, m.Mut, k2); sm.A = lerp(sm.A, m.A, k1);
  const lvl = m.lvl, dg = m.dg, conf = clamp(sm.K * 1.1);
  /* cell and kinase bob; lobes open with activity */
  place(cellG, 290 + Math.sin(tm / 1400) * 2, 262 + Math.cos(tm / 1700) * 2, 0, 1);
  kinCX = 290 + Math.sin(tm / 1400) * 2; kinCY = 250 + Math.cos(tm / 1700) * 2;
  kinG.setAttribute("transform", "translate(" + f1(kinCX) + " " + f1(kinCY) + ")");
  place(nLobe, -4, -26 - 6 * conf, -10 * conf, 1);
  place(cLobe, 4, 28 + 5 * conf, 8 * conf, 1);
  actOpen.setAttribute("opacity", (0.1 + 0.9 * conf).toFixed(2));
  actShut.setAttribute("opacity", (1 - 0.85 * conf).toFixed(2));
  POCK.x = kinCX - 2; POCK.y = kinCY;
  /* gatekeeper bulks up in the mutant clone and shivers when a drug is refused */
  const rej = dg > 0 && lvl === 2;
  gateC.setAttribute("r", (3 + 2.5 * sm.Mut + (rej ? Math.sin(tm / 200) * 1 : 0)).toFixed(1));
  if (sm.Mut > 0.5) gateC.setAttribute("class", "gate mut"); else gateC.setAttribute("class", "gate");
  rejRings.forEach((r, i) => {
    if (!rej) { r.setAttribute("opacity", "0"); return; }
    const ph = ((tm / 900) + i * 0.5) % 1;
    r.setAttribute("r", f1(8 + 22 * ph));
    r.setAttribute("opacity", ((1 - ph) * 0.9).toFixed(2));
  });
  /* drugs: dasatinib fits either pocket form, imatinib only the shut one; the mutant rejects both */
  const dockD = dg === 1 && lvl !== 2, dockI = dg === 2 && lvl !== 2;
  const docked = dockD || dockI;
  drugD.setAttribute("opacity", dg === 1 ? "1" : "0");
  drugI.setAttribute("opacity", dg === 2 ? "1" : "0");
  drugDq.setAttribute("opacity", dg === 1 && rej ? "1" : "0");
  drugIq.setAttribute("opacity", dg === 2 && rej ? "1" : "0");
  const jigX = rej ? Math.sin(tm / 85) * 6 : 0, jigY = rej ? Math.cos(tm / 110) * 5 : 0;
  if (dg === 1) {
    const tx = dockD ? -4 : rej ? 38 : -70, ty = dockD ? -2 : rej ? -6 : -46;
    drugPos.dx = lerp(drugPos.dx, tx, k1); drugPos.dy = lerp(drugPos.dy, ty, k1);
    drugD.setAttribute("transform", "translate(" + f1(drugPos.dx + jigX) + " " + f1(drugPos.dy + jigY) + ")");
    drugPos.qx = lerp(drugPos.qx, 64, k1); drugPos.qy = lerp(drugPos.qy, 20, k1);
    drugDq.setAttribute("transform", "translate(" + f1(drugPos.qx - jigX) + " " + f1(drugPos.qy + jigY) + ")");
  }
  if (dg === 2) {
    const tx = dockI ? -4 : rej ? 38 : -80, ty = dockI ? 2 : rej ? -6 : 40;
    drugPos.ix = lerp(drugPos.ix, tx, k1); drugPos.iy = lerp(drugPos.iy, ty, k1);
    drugI.setAttribute("transform", "translate(" + f1(drugPos.ix + jigX) + " " + f1(drugPos.iy + jigY) + ") rotate(15)");
    drugPos.qx = lerp(drugPos.qx, 64, k1); drugPos.qy = lerp(drugPos.qy, 20, k1);
    drugIq.setAttribute("transform", "translate(" + f1(drugPos.qx - jigX) + " " + f1(drugPos.qy + jigY) + ") rotate(15)");
  }
  haloRing.setAttribute("opacity", docked ? (0.45 + 0.25 * Math.sin(tm / 350)).toFixed(2) : "0");
  /* drug pill follows the select */
  if (dg === 0) drugPill.setAttribute("opacity", "0");
  else {
    drugPill.setAttribute("opacity", "1");
    const tp = drugPill.querySelector("text"), rp = drugPill.querySelector("rect"), nm = drugNames[dg];
    if (tp.textContent !== nm) {
      tp.textContent = nm;
      const lw = nm.length * 6.2 + 14;
      rp.setAttribute("x", f1(118 - lw / 2)); rp.setAttribute("width", f1(lw));
      tp.setAttribute("x", f1(118));
    }
  }
  /* ATP drifts into the pocket; a seated drug thins the stream */
  acc.atp += dt * 3 * (1 - 0.75 * sm.B); while (acc.atp >= 1) { acc.atp--; const p = free(atp); if (p) emit(p, rnd(220, 360), rnd(148, 165), 0, 0, 0); }
  atp.forEach((p) => { if (!p.on) return;
    const dx = POCK.x - p.x, dy = POCK.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 60 * dt; p.y += (dy / d) * 60 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(45)");
    if (d < 12) kill(p); });
  /* phosphate substrates fly to the nodes when the kinase is active */
  acc.ps += dt * sm.K * 14; while (acc.ps >= 1) { acc.ps--; const p = free(pss); if (p) { const n = nodesArr[Math.floor(Math.random() * nodesArr.length)]; emit(p, POCK.x + rnd(-6, 6), POCK.y + rnd(-6, 6), 0, 0, nodesArr.indexOf(n)); } }
  pss.forEach((p) => { if (!p.on) return;
    const n = nodesArr[p.k], dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 110 * dt; p.y += (dy / d) * 110 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 14) { n.glow = 1; kill(p); } });
  nodesArr.forEach((n, i) => { n.glow = Math.max(0, n.glow - dt * 1.5);
    n.halo.setAttribute("opacity", clamp(0.12 + 0.75 * sm.P * (0.6 + 0.4 * Math.sin(tm / 300 + i * 2)) + n.glow).toFixed(2)); });
  /* signals leave the pocket, run down the marrow vessel, then spread to the clone */
  acc.sig += dt * sm.P * 7; while (acc.sig >= 1) { acc.sig--; const p = free(sigs), c = clones[Math.floor(Math.random() * clones.length)]; if (p && c) emit(p, POCK.x + rnd(-6, 6), POCK.y + rnd(-6, 6), 0, 0, clones.indexOf(c)); }
  sigs.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.u += dt * 110 / trIn.len; const q = trIn.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { p.st = 1; p.x = vesTop[0]; p.y = vesTop[1]; } }
    else if (p.st === 1) { p.y += dt * 95; p.x = vesTop[0] + Math.sin(tm / 300 + p.y) * 3;
      if (p.y >= vesBot[1]) p.st = 2; }
    else { const c = clones[p.k], dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * 130 * dt; p.y += (dy / d) * 130 * dt;
      if (d < 16) { kill(p); return; } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* clash sparks at the mutant gatekeeper while a drug keeps trying */
  if (rej) { acc.clash += dt * 7; while (acc.clash >= 1) { acc.clash--; const p = free(clash); if (p) emit(p, kinCX + 15 + rnd(-3, 3), kinCY + rnd(-4, 4), 0, 0, 0); } }
  clash.forEach((p) => { if (!p.on) return; p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 2).toFixed(2) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.6).toFixed(2));
    if (p.t > 0.6) kill(p); });
  /* marrow clone follows growth; rims mark the mutant */
  clones.forEach((c, i) => {
    const s = clamp((sm.G - c.thr * 0.75) * 3, 0, 1);
    place(c.leuk, 0, 0, 0, 0.12 + 0.88 * s);
    c.leuk.setAttribute("opacity", s > 0.06 ? "1" : "0");
    c.rim.setAttribute("opacity", (sm.Mut * (s > 0.3 ? 1 : 0)).toFixed(2));
    place(c.g, c.x + Math.sin(tm / 1300 + i) * 0.8, c.y + Math.cos(tm / 1700 + i) * 0.8, 0, 1);
  });
  /* side effects follow treatment: fluid swells, marrow demo pales, heart trace prolongs */
  dropPath.setAttribute("transform", "scale(" + (1.15 + 0.75 * sm.A).toFixed(2) + ")");
  swellEl.setAttribute("rx", f1(6 + 26 * sm.A)); swellEl.setAttribute("ry", f1(2.5 + 8 * sm.A));
  swellEl.setAttribute("opacity", (0.15 + 0.6 * sm.A).toFixed(2));
  ripG.setAttribute("transform", "translate(640 370) scale(" + (0.6 + 0.9 * sm.A).toFixed(2) + " 1)");
  ripG.setAttribute("opacity", sm.A.toFixed(2));
  demoCells.forEach((c) => { place(c.g, c.x, c.y, 0, 1 - 0.3 * sm.A); c.g.setAttribute("opacity", (1 - 0.4 * sm.A).toFixed(2)); });
  seFlush.setAttribute("opacity", (0.55 * sm.A).toFixed(2));
  qtBg.setAttribute("opacity", (0.65 * sm.A).toFixed(2));
  qtL.setAttribute("opacity", clamp((sm.A - 0.15) * 2).toFixed(2));
  qtN.setAttribute("opacity", (1 - 0.5 * sm.A).toFixed(2));
  /* gauges */
  gg.kin.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["low", "raised", "high"]));
  gg.sig.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["low", "raised", "high"]));
  gg.gro.set(sm.G, wordOf(sm.G, 0.35, 0.6, ["low", "raised", "high"]));
  gg.blk.set(sm.B, wordOf(sm.B, 0.3, 0.7, ["open", "closing", "blocked"]));
  gg.mut.set(sm.Mut, wordOf(sm.Mut, 0.3, 0.7, ["absent", "present", "dominant"]));
  gg.sef.set(sm.A, wordOf(sm.A, 0.3, 0.7, ["few", "some", "many"]));
  const key = lvl * 4 + dg;
  if (key !== capKey) { capKey = key; const t = capText(lvl, dg); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
