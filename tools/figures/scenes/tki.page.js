/* TKI scene: Philadelphia chromosome, BCR-ABL kinase with its ATP pocket and gatekeeper,
 * imatinib and dasatinib binding, substrate phosphorylation, marrow clone growth and side effects. */
const TK = { chr: $("chr"), cell: $("cellbase"), kin: $("kin"), nodes: $("nodes"), marrow: $("marrow"), se: $("se"), parts: $("parts"), over: $("over"), panel: $("panel") };
let kinCX = 290, kinCY = 250;
const POCK = { x: 288, y: 250 };
/* ---- big leukaemic cell ---- */
let cellG = null;
function initCellBase() {
  cellG = cell(TK.cell, { cls: "leuk", r: 120, nuc: 0, seed: 5, wob: 0.07 });
  place(cellG, 290, 262, 0, 1);
}
/* ---- kinase: two lobes, pocket, gatekeeper, activation loop, two drugs ---- */
const kinG = mk("g", {}, TK.kin);
const nLobe = mk("g", {}, kinG);
const cLobe = mk("g", {}, kinG);
let gateC = null, loopO = null, loopC = null, drugI = null, drugD = null;
const drugPos = { ix: -80, iy: 40, dx: -70, dy: -46 };
function initKin() {
  kinG.setAttribute("transform", "translate(290 250)");
  cell(nLobe, { cls: "kin", r: 26, seed: 3, wob: 0.1 });
  cell(cLobe, { cls: "kin", r: 34, seed: 4, wob: 0.1 });
  mk("rect", { class: "pocket", x: -11, y: -9, width: 22, height: 18, rx: 6 }, kinG);
  loopO = mk("path", { class: "loop-o", d: "M-22 -12C-10 -28 10 -28 22 -10" }, kinG);
  loopC = mk("path", { class: "loop-c", d: "M-22 -12C-10 -4 8 -4 20 -14" }, kinG);
  gateC = mk("circle", { class: "gate", cx: 15, cy: 0, r: 3 }, kinG);
  drugI = mk("g", { opacity: "0" }, kinG);
  mk("rect", { class: "drugI", x: -13, y: -5, width: 26, height: 10, rx: 5 }, drugI);
  mk("rect", { class: "drugI-b", x: 0, y: -5, width: 13, height: 10, rx: 5 }, drugI);
  drugD = mk("g", { opacity: "0" }, kinG);
  mk("circle", { class: "drugD", r: 8.5 }, drugD);
  mk("circle", { class: "drugD-b", r: 3.4 }, drugD);
  place(nLobe, 0, -26, 0, 1); place(cLobe, 0, 28, 0, 1);
}
/* ---- substrate nodes ---- */
const nodesArr = [];
function initNodes() {
  [["Proliferation", 220], ["Survival", 380]].forEach(([name, x], i) => {
    const g = mk("g", {}, TK.nodes);
    const halo = mk("circle", { class: "node-halo", r: 16, opacity: "0.2" }, g);
    cell(g, { cls: "subs", r: 12, seed: 20 + i, wob: 0.12 });
    const cap = mk("text", { class: "sc-cap", x: x, y: 398 }, TK.nodes); cap.textContent = name;
    place(g, x, 368, 0, 1);
    nodesArr.push({ g, halo, x, y: 368, glow: 0 });
  });
}
/* ---- marrow clone grid ---- */
const clones = [];
function initMarrow() {
  [640, 720, 800, 880].forEach((x, c) => [140, 200, 260].forEach((y, r) => {
    const i = clones.length, g = mk("g", {}, TK.marrow);
    const norm = cell(g, { cls: "norm", r: 20, nuc: 0.4, seed: i + 1, wob: 0.1 });
    const leuk = mk("g", {}, g); cell(leuk, { cls: "leuk", r: 20, nuc: 0.45, seed: i + 30, wob: 0.12 });
    const rim = mk("circle", { class: "mut-rim", r: 22, opacity: "0" }, g);
    place(g, x, y, 0, 1);
    clones.push({ g, norm, leuk, rim, x, y, thr: i / 12 });
  }));
}
/* ---- side effect icons ---- */
let ripG = null, marDim = null, qtN = null, qtL = null;
function initSE() {
  const d = mk("g", { transform: "translate(640 350)" }, TK.se);
  mk("path", { class: "drop", d: "M0 -10C6.6 -1.8 8.4 2.4 8.4 5.4A8.4 8.4 0 0 1 -8.4 5.4C-8.4 2.4 -6.6 -1.8 0 -10Z", transform: "scale(1.15)" }, d);
  ripG = mk("g", { opacity: "0" }, TK.se);
  mk("path", { class: "rip", d: "M622 366q18 8 36 0" }, ripG);
  mk("path", { class: "rip", d: "M616 373q24 10 48 0" }, ripG);
  marDim = mk("g", {}, TK.se);
  [715, 740, 765].forEach((x, i) => { const g = cell(marDim, { cls: "norm", r: 9, nuc: 0.4, seed: 60 + i, wob: 0.12 }); place(g, x, 352, 0, 1); });
  const box = mk("g", {}, TK.se);
  mk("rect", { class: "ecg-bg", x: 805, y: 330, width: 90, height: 50, rx: 8 }, box);
  qtN = mk("polyline", { class: "ecg", points: "810,358 822,358 826,344 832,368 836,358 852,358 856,350 864,350 868,358 890,358" }, box);
  qtL = mk("polyline", { class: "ecg-long", points: "810,358 822,358 826,344 832,368 836,358 850,358 856,346 872,346 878,358 890,358", opacity: "0" }, box);
  [["fluid", 640], ["marrow", 740], ["QT", 850]].forEach(([name, x]) => { const t = mk("text", { class: "sc-cap", x, y: 392 }, TK.se); t.textContent = name; });
}
/* ---- particle pools (elements exposed as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const atp = pool(10, () => mk("rect", { class: "sc-p p-atp", x: -3, y: -3, width: 6, height: 6, rx: 1, transform: "rotate(45)" }, TK.parts));
const pss = pool(26, () => mk("circle", { class: "sc-p p-ps", r: 3 }, TK.parts));
const sigs = pool(12, () => mk("circle", { class: "sc-p p-sig", r: 2.2 }, TK.parts));
const clash = pool(6, () => { const g = mk("g", {}, TK.parts); mk("path", { class: "clash", d: "M-6 0L6 0M0 -6L0 6M-4 -4L4 4M-4 4L4 -4" }, g); return g; });
/* ---- labels and gauges ---- */
const gg = {};
let drugPill = null;
function initTKPanel() {
  const P = TK.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The clone";
  [["kin", "Kinase", "g-bad", "BCR-ABL kinase activity. The Philadelphia swap leaves the kinase stuck on."],
    ["sig", "Signals", "g-cyt", "Phosphate flow to substrates. Active kinase loads ATP into its pocket and tags substrates that drive growth and survival."],
    ["gro", "Growth", "g-clot", "How fast the leukaemic clone expands in the marrow. It follows signalling and the mutant share."],
    ["blk", "Blocked", "g-good", "How much drug sits in the ATP pocket. Imatinib locks the closed form; dasatinib fits both forms but the gatekeeper mutant rejects both."],
    ["mut", "Mutant", "g-eos", "Share of the clone carrying the gatekeeper swap (T315I). It blocks drug binding while ATP still fits."],
    ["sef", "Side effects", "g-neu", "Fluid retention and pleural effusion, low blood counts and QT prolongation rise with treatment."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const O = TK.over;
  pill(O, "Philadelphia", 160, 124, 150, 100, "Philadelphia chromosome: a swap between chromosomes 9 and 22 fuses BCR to ABL. The short swapped chromosome is the visible mark of it.");
  pill(O, "BCR-ABL", 322, 232, 486, 140, "BCR-ABL fusion protein. The ABL kinase part is stuck on, so it signals without normal controls.");
  pill(O, "ATP pocket", 288, 250, 118, 190, "ATP binding pocket. The kinase scoops ATP here and uses its phosphate to tag substrates.");
  pill(O, "Gatekeeper", 305, 250, 478, 300, "Gatekeeper spot at the pocket mouth. The T315I swap puts a bulkier block here that rejects both drugs while ATP still fits.");
  drugPill = pill(O, "Imatinib", 235, 285, 118, 326, "Drug capsule heading for the pocket. Imatinib locks the closed form; dasatinib fits both forms. Neither fits the gatekeeper mutant.");
  drugPill.setAttribute("id", "tkdrug");
  pill(O, "Substrates", 300, 378, 300, 414, "Substrates tagged with phosphate. Their signals tell the cell to divide (proliferation) and to stay alive (survival).");
  pill(O, "Clone", 720, 140, 852, 100, "Leukaemic clone in the marrow. Pale cells are normal; orange cells are BCR-ABL driven; red rims carry the gatekeeper mutant.");
  pill(O, "Side effects", 740, 340, 746, 300, "Treatment related effects: fluid retention and fluid around the lung, low blood counts from marrow suppression, and QT prolongation on the heart trace.");
}
const sm = { K: 0.9, P: 0.9, G: 0.7, B: 0, Mut: 0.04, A: 0.06 };
const acc = { atp: 0, ps: 0, sig: 0, clash: 0 };
const drugNames = ["", "Imatinib", "Dasatinib"];
function init() { initCellBase(); initKin(); initNodes(); initMarrow(); initSE(); initTKPanel(); }
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
  loopO.setAttribute("opacity", (0.1 + 0.9 * conf).toFixed(2));
  loopC.setAttribute("opacity", (1 - 0.85 * conf).toFixed(2));
  gateC.setAttribute("r", (3 + 2.5 * sm.Mut).toFixed(1));
  if (sm.Mut > 0.5) gateC.setAttribute("class", "gate mut"); else gateC.setAttribute("class", "gate");
  POCK.x = kinCX - 2; POCK.y = kinCY;
  /* drugs: imatinib docks only in the closed form, dasatinib in either; neither fits the mutant */
  const dockI = dg === 1 && lvl === 1, dockD = dg === 2 && lvl !== 2;
  drugI.setAttribute("opacity", dg === 1 ? "1" : "0");
  drugD.setAttribute("opacity", dg === 2 ? "1" : "0");
  if (dg === 1) {
    const tx = dockI ? -4 : -80, ty = dockI ? 2 : 40;
    drugPos.ix = lerp(drugPos.ix, tx, k1); drugPos.iy = lerp(drugPos.iy, ty, k1);
    drugI.setAttribute("transform", "translate(" + f1(drugPos.ix) + " " + f1(drugPos.iy) + ") rotate(15)");
  }
  if (dg === 2) {
    const tx = dockD ? -4 : -70, ty = dockD ? -2 : -46;
    drugPos.dx = lerp(drugPos.dx, tx, k1); drugPos.dy = lerp(drugPos.dy, ty, k1);
    const jig = lvl === 2 ? Math.sin(tm / 90) * 3 : 0;
    drugD.setAttribute("transform", "translate(" + f1(drugPos.dx + jig) + " " + f1(drugPos.dy) + ")");
  }
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
  /* ATP drifts into the pocket */
  acc.atp += dt * 3; while (acc.atp >= 1) { acc.atp--; const p = free(atp); if (p) emit(p, rnd(220, 360), rnd(148, 165), 0, 0, 0); }
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
  /* signals cross to the marrow */
  acc.sig += dt * sm.P * 6; while (acc.sig >= 1) { acc.sig--; const p = free(sigs), c = clones[Math.floor(Math.random() * clones.length)]; if (p && c) emit(p, 450, 330, 0, 0, clones.indexOf(c)); }
  sigs.forEach((p) => { if (!p.on) return;
    const c = clones[p.k], dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 130 * dt; p.y += (dy / d) * 130 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 16) kill(p); });
  /* clash sparks at the mutant gatekeeper when drug is tried */
  if (lvl === 2 && dg > 0) { acc.clash += dt * 4; while (acc.clash >= 1) { acc.clash--; const p = free(clash); if (p) emit(p, kinCX + 15 + rnd(-3, 3), kinCY + rnd(-4, 4), 0, 0, 0); } }
  clash.forEach((p) => { if (!p.on) return; p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.6).toFixed(2) + ")");
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
  /* side effects follow treatment */
  ripG.setAttribute("opacity", sm.A.toFixed(2));
  marDim.setAttribute("opacity", (1 - 0.45 * sm.A).toFixed(2));
  qtL.setAttribute("opacity", clamp((sm.A - 0.15) * 2).toFixed(2));
  qtN.setAttribute("opacity", (1 - 0.5 * sm.A).toFixed(2));
  /* gauges */
  gg.kin.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["low", "raised", "high"]));
  gg.sig.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["low", "raised", "high"]));
  gg.gro.set(sm.G, wordOf(sm.G, 0.35, 0.6, ["low", "raised", "high"]));
  gg.blk.set(sm.B, wordOf(sm.B, 0.3, 0.7, ["open", "closing", "blocked"]));
  gg.mut.set(sm.Mut, wordOf(sm.Mut, 0.3, 0.7, ["absent", "present", "dominant"]));
  gg.sef.set(sm.A, wordOf(sm.A, 0.3, 0.7, ["few", "some", "many"]));
}
run({ init, step });
