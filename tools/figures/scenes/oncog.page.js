/* Oncogenes scene: growth signalling, RAS, kinase cascade, p53 and Rb checkpoints, DNA damage and repair, clone and gauges. */
const OG = { stage: $("stage"), over: $("over"), panel: $("panel") };
function oncPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const oncFree = (pl) => pl.find((p) => !p.on);
function oncEmit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function oncKill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- signalling nodes ---- */
const oncRasG = mk("g", {}, OG.stage);
mk("circle", { class: "onc-nodeRas", r: 19 }, oncRasG);
mk("circle", { class: "onc-nodeIn", r: 8 }, oncRasG);
place(oncRasG, 135, 180, 0, 1);
const oncKinG = mk("g", {}, OG.stage);
mk("circle", { class: "onc-nodeKin", r: 17 }, oncKinG);
mk("circle", { class: "onc-nodeIn", r: 7 }, oncKinG);
place(oncKinG, 135, 238, 0, 1);

/* ---- checkpoint gates on the cell cycle ring ---- */
function oncGate(x, y, w, h) {
  const g = mk("g", {}, OG.stage);
  mk("rect", { class: "onc-gate", x: f1(x - w / 2), y: f1(y - h / 2), width: w, height: h, rx: 7 }, g);
  const c = mk("g", { opacity: "0" }, OG.stage);
  mk("path", { class: "onc-cross", d: "M" + f1(x - 11) + " " + f1(y - 11) + "L" + f1(x + 11) + " " + f1(y + 11) + "M" + f1(x + 11) + " " + f1(y - 11) + "L" + f1(x - 11) + " " + f1(y + 11) }, c);
  return { g, c };
}
const oncGateP53 = oncGate(485, 174, 44, 14);
const oncGateRb = oncGate(571, 260, 14, 36);

/* ---- DNA damage marks inside the nucleus ---- */
const oncDmgMarks = [[455, 250], [475, 262], [495, 248], [515, 260], [465, 274], [505, 276], [485, 240], [525, 246], [448, 262], [518, 238]].map(([x, y]) => {
  const e = mk("path", { class: "onc-dmg", d: "M-5 -5L5 5M5 -5L-5 5", transform: "translate(" + x + " " + y + ")" }, OG.stage);
  e.style.opacity = 0; return e;
});

/* ---- cell population: normal cells behind, abnormal clone in front ---- */
function oncGridPos(i) { return { x: 728 + (i % 4) * 52, y: 150 + Math.floor(i / 4) * 42 }; }
const oncNormCells = Array.from({ length: 24 }, (_, i) => { const p = oncGridPos(i); const g = mk("g", {}, OG.stage); cell(g, { cls: "norm", r: 11, nuc: 0.4, seed: i + 11, wob: 0.07 }); place(g, p.x, p.y, 0, 1); g.style.opacity = 0.38; return { g, x: p.x, y: p.y }; });
const oncCloneCells = Array.from({ length: 24 }, (_, i) => { const p = oncGridPos(i); const g = mk("g", {}, OG.stage); cell(g, { cls: "onc", r: 12, nuc: 0.55, seed: i + 41, wob: 0.1 });
  const dots = [mk("circle", { class: "sc-p p-div", r: 1.8, cx: -4, cy: -3 }, g), mk("circle", { class: "sc-p p-div", r: 1.8, cx: 4, cy: 3 }, g)];
  return { g, x: p.x, y: p.y, s: 0, dots }; });

/* ---- a damaged cell that should die by apoptosis ---- */
const oncApoG = mk("g", {}, OG.stage);
cell(oncApoG, { cls: "onc", r: 13, nuc: 0.5, seed: 7, wob: 0.12 });
const oncFragG = mk("g", { opacity: "0" }, OG.stage);
[[616, 352], [664, 354], [626, 380]].forEach(([x, y]) => { const g = mk("g", {}, oncFragG); cell(g, { cls: "onc", r: 5, seed: x, wob: 0.16, n: 7 }); place(g, x, y, 0, 1); });

/* ---- particle pools ---- */
const oncSigTrack = track([[135, 148], [135, 180], [135, 238], [250, 254], [366, 261], [448, 260]]);
const oncGf = oncPool(12, () => mk("circle", { class: "sc-p p-sig", r: 3 }, OG.stage));
const oncSig = oncPool(20, () => mk("circle", { class: "sc-p p-sig", r: 2.6 }, OG.stage));
const oncRep = oncPool(16, () => mk("circle", { class: "sc-p p-rep", r: 2.4 }, OG.stage));
const oncTki = oncPool(12, () => mk("circle", { class: "sc-p p-tki", r: 2.6 }, OG.stage));
const oncDiv = oncPool(16, () => mk("circle", { class: "sc-p p-div", r: 2 }, OG.stage));
const oncChemo = oncPool(10, () => { const g = mk("g", {}, OG.stage); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });

/* ---- labels ---- */
let oncKinMark = null, oncChemoMark = null;
function oncLabels() {
  pill(OG.over, "Growth factor", 120, 98, 88, 82, "Growth factor: a signal molecule outside the cell. It binds a receptor and normally switches growth on only when needed.");
  pill(OG.over, "Receptor", 152, 122, 208, 100, "Receptor: sits in the cell membrane. When a growth factor binds, it switches on RAS inside the cell.");
  pill(OG.over, "RAS", 156, 180, 208, 168, "RAS: a switch protein. Normal RAS turns off after signalling. An activating change can lock RAS on, so the divide signal never stops.");
  pill(OG.over, "Kinase cascade", 154, 238, 212, 232, "Kinase cascade: a chain of kinases that carries the RAS signal to the nucleus and turns on division genes. It is the target of targeted kinase inhibitors.");
  pill(OG.over, "p53 checkpoint", 485, 166, 485, 128, "p53 checkpoint: p53 senses DNA damage, pauses the cell cycle for repair, and can trigger apoptosis. Losing p53 removes this guard.");
  pill(OG.over, "DNA damage", 465, 238, 365, 155, "DNA damage: breaks and changes in the DNA. Damage builds from everyday copying errors and harmful exposures, and rises further when repair fails.");
  pill(OG.over, "Cell cycle", 428, 322, 338, 302, "Cell cycle: the ordered copying and division of a cell. Checkpoint loss and always on growth signalling make it run faster and without pauses.");
  pill(OG.over, "Repair", 520, 288, 618, 332, "DNA repair: enzymes that fix damaged DNA before it is copied. When checkpoints fail, damage is copied instead of repaired and changes are passed on.");
  pill(OG.over, "Rb checkpoint", 578, 260, 637, 210, "Rb checkpoint: the Rb protein holds the cell at the G1 checkpoint. Losing Rb lets the cell copy its DNA and divide when it should have waited.");
  pill(OG.over, "Apoptosis", 640, 376, 640, 398, "Apoptosis: programmed cell death. A badly damaged cell should die this way. Evading apoptosis lets damaged cells survive and keep dividing.");
  pill(OG.over, "Abnormal clone", 760, 148, 806, 86, "Abnormal clone: daughter cells that inherit the same changes. Over several hits the clone expands, takes over the population and behaves as a cancer.");
  oncKinMark = pill(OG.over, "Kinase inhibitor", 154, 252, 212, 295, "A targeted kinase inhibitor blocks the kinase cascade, so the growth signal falls. It does not restore p53 or Rb or undo damage already done.");
  oncChemoMark = pill(OG.over, "Chemotherapy", 806, 380, 806, 398, "Chemotherapy harms dividing cells, so the dividing clone shrinks. It also damages DNA and harms normal dividing cells.");
}

/* ---- gauges ---- */
const oncGg = {};
function oncPanel() {
  const P = OG.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The cell";
  [["sig", "Signalling", "g-sig", "Growth signalling through RAS and the kinase cascade. Regulated in a normal cell, always on when a proto-oncogene is locked on."], ["chk", "Checkpoints", "g-chk", "The p53 and Rb checkpoints together. High means the brakes still work; low means they are lost."], ["unrep", "Damage", "g-dmg", "Unrepaired DNA damage: damage that was copied instead of fixed, so changes accumulate hit after hit."], ["cyc", "Division", "g-cyt", "How fast the cell cycle runs. It speeds up when growth signalling is always on and checkpoints are lost."], ["apo", "Cell death", "g-good", "Apoptosis of damaged cells. High means damaged cells die as they should; low means they evade death and survive."], ["clone", "Clone", "g-bad", "The abnormal clone: how much of the cell population is taken over by descendants of the altered cell."]]
    .forEach(([id, name, cls, tip], i) => { oncGg[id] = gauge(P, 130 + i * 140, y0 + 2, 52, 18, cls, name, tip); });
}
const oncSm = { sig: 0.6, chk: 0.57, dmg: 0.5, unrep: 0.28, rep: 0.59, cyc: 0.66, apo: 0.37, clone: 0.58, mut: 0.49 };
const oncAcc = { gf: 0, sig: 0, rep: 0, tki: 0, chemo: 0, div: 0 };
let oncAngle = 0;
function init() { oncLabels(); oncPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  oncSm.sig = lerp(oncSm.sig, m.sig, k); oncSm.chk = lerp(oncSm.chk, m.chk, k); oncSm.dmg = lerp(oncSm.dmg, m.dmg, k); oncSm.unrep = lerp(oncSm.unrep, m.unrep, k);
  oncSm.rep = lerp(oncSm.rep, m.rep, k); oncSm.cyc = lerp(oncSm.cyc, m.cyc, k); oncSm.apo = lerp(oncSm.apo, m.apo, k); oncSm.clone = lerp(oncSm.clone, m.clone, k); oncSm.mut = lerp(oncSm.mut, m.mut, k);
  /* main cell breathing with division drive, and the cycle ring turning */
  const mc = $("mainCell"); if (mc) { const s = 1 + 0.022 * oncSm.cyc * Math.sin(tm / 450); mc.setAttribute("transform", "translate(485 260) scale(" + s.toFixed(3) + ") translate(-485 -260)"); }
  oncAngle = (oncAngle + dt * 42 * oncSm.cyc) % 360;
  const ring = $("cycRing"); if (ring) ring.setAttribute("transform", "rotate(" + f1(oncAngle) + " 485 260)");
  place(oncRasG, 135, 180, 0, 1 + 0.16 * oncSm.sig * Math.sin(tm / 260));
  place(oncKinG, 135, 238, 0, 1 + 0.14 * oncSm.sig * Math.sin(tm / 260 + 1));
  /* checkpoint gates: solid when working, crossed when lost */
  [oncGateP53, oncGateRb].forEach((gt) => { gt.g.setAttribute("opacity", oncSm.chk.toFixed(2)); gt.c.setAttribute("opacity", (1 - oncSm.chk).toFixed(2)); });
  oncDmgMarks.forEach((e, i) => { e.style.opacity = (i / oncDmgMarks.length) < oncSm.dmg ? 1 : 0; });
  /* clone takes over the population grid */
  const wantClone = Math.round(oncSm.clone * oncCloneCells.length);
  oncCloneCells.forEach((c, i) => { const want = i < wantClone ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * 1.4, c.y + Math.cos(tm / 900 + i) * 1.4, Math.sin(tm / 800 + i) * 5, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; c.dots.forEach((d, j) => d.setAttribute("opacity", clamp(oncSm.mut * 1.3 - j * 0.3 - (i % 4) * 0.08).toFixed(2))); });
  /* apoptosis: the damaged cell shrinks and fragments only when cell death works */
  place(oncApoG, 640, 362, Math.sin(tm / 500) * 6, Math.max(0.2, 1 - 0.5 * oncSm.apo));
  oncApoG.style.opacity = (1 - 0.45 * oncSm.apo).toFixed(2);
  oncFragG.setAttribute("opacity", oncSm.apo.toFixed(2));
  /* growth factor dots drift in to the receptor */
  oncAcc.gf += dt * 2.2; while (oncAcc.gf >= 1) { oncAcc.gf--; const p = oncFree(oncGf); if (p) oncEmit(p, rnd(64, 206), rnd(94, 108), 0, 0, 0); }
  oncGf.forEach((p) => { if (!p.on) return; const dx = 135 - p.x, dy = 104 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 34 * dt; p.y += (dy / d) * 34 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 44, 226)) + " " + f1(clamp(p.y, 60, 130)) + ")"); if (d < 12) oncKill(p); });
  /* signal pulses travel receptor, RAS, cascade, then to the nucleus */
  oncAcc.sig += dt * oncSm.sig * 5; while (oncAcc.sig >= 1) { oncAcc.sig--; const p = oncFree(oncSig); if (p) oncEmit(p, 135, 148, 0, 0, 0); }
  oncSig.forEach((p) => { if (!p.on) return; p.u += dt * 0.26; if (p.u >= 1) { oncKill(p); return; } const q = oncSigTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(clamp(q.x, 30, 540)) + " " + f1(clamp(q.y, 60, 330)) + ")"); });
  /* repair particles work around the DNA inside the nucleus */
  oncAcc.rep += dt * oncSm.rep * 4; while (oncAcc.rep >= 1) { oncAcc.rep--; const p = oncFree(oncRep); if (p) { const an = rnd(0, 6.28), rr = rnd(6, 42); oncEmit(p, 485 + Math.cos(an) * rr, 260 + Math.sin(an) * rr, rnd(-8, 8), rnd(-8, 8), 0); } }
  oncRep.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 437, 533); p.y = clamp(p.y + p.vy * dt, 212, 308); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) oncKill(p); });
  /* clone cells shed division dots inside the population box */
  oncAcc.div += dt * oncSm.cyc * oncSm.clone * 4; while (oncAcc.div >= 1) { oncAcc.div--; const p = oncFree(oncDiv); if (p) { const c = oncCloneCells[Math.floor(rnd(0, Math.max(1, wantClone)))]; if (c) oncEmit(p, c.x, c.y, rnd(-16, 16), rnd(-16, 16), 0); } }
  oncDiv.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 700, 912); p.y = clamp(p.y + p.vy * dt, 122, 368); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) oncKill(p); });
  /* targeted kinase inhibitor dots home to the cascade */
  oncAcc.tki += dt * (m.kin ? 4.5 : 0); while (oncAcc.tki >= 1) { oncAcc.tki--; const p = oncFree(oncTki); if (p) oncEmit(p, rnd(84, 190), rnd(196, 276), 0, 0, 0); }
  oncTki.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (135 - p.x) * dt * 1.6; p.y += (238 - p.y) * dt * 1.6; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 40, 260)) + " " + f1(clamp(p.y, 70, 330)) + ")"); if (Math.hypot(135 - p.x, 238 - p.y) < 9 || p.t > 3) oncKill(p); });
  /* chemotherapy capsules drift to dividing clone cells */
  oncAcc.chemo += dt * (m.chemo ? 2.6 : 0); while (oncAcc.chemo >= 1) { oncAcc.chemo--; const p = oncFree(oncChemo); if (p) oncEmit(p, 700, rnd(130, 200), 0, 0, Math.floor(rnd(0, 24))); }
  oncChemo.forEach((p) => { if (!p.on) return; p.t += dt; const c = oncCloneCells[p.k] || oncCloneCells[0]; p.x += (c.x - p.x) * dt * 0.7 + 10 * dt; p.y += (c.y - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 694, 916)) + " " + f1(clamp(p.y, 118, 372)) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6) oncKill(p); });
  if (oncKinMark) oncKinMark.style.display = m.drug === 1 ? "" : "none";
  if (oncChemoMark) oncChemoMark.style.display = m.drug === 2 ? "" : "none";
  oncGg.sig.set(oncSm.sig, wordOf(oncSm.sig, 0.35, 0.65, ["regulated", "raised", "always on"]));
  oncGg.chk.set(oncSm.chk, wordOf(oncSm.chk, 0.35, 0.65, ["lost", "weakened", "working"]));
  oncGg.unrep.set(oncSm.unrep, wordOf(oncSm.unrep, 0.2, 0.5, ["low", "building", "high"]));
  oncGg.cyc.set(oncSm.cyc, wordOf(oncSm.cyc, 0.35, 0.65, ["slow", "active", "rapid"]));
  oncGg.apo.set(oncSm.apo, wordOf(oncSm.apo, 0.3, 0.6, ["evaded", "reduced", "working"]));
  oncGg.clone.set(oncSm.clone, wordOf(oncSm.clone, 0.3, 0.65, ["small", "growing", "dominant"]));
}
run({ init, step });
