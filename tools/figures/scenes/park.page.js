/* Parkinson scene: a real brain makes dopamine for the striatum; go and stop lanes work a GPi brake on the thalamus, which drives the limb. */
const layers = { brain: $("brainSlot"), lanes: $("lanes"), nodes: $("nodes"), parts: $("parts"), limb: $("limb"), over: $("over"), panel: $("panel") };
let brainO = null, SNc = [209, 288], STR = [170, 202], DOPA_MID = [190, 245];
let trDopa = null, trGo = null, trSA = null, trSB = null, trSC = null, trBrake = null, trMove = null, trAgo = null;
let laneGo = null, laneSB = null, laneDopa = null, jawL = null, jawR = null, halo = null;
let striDot = null, striRing = null, striFlash = 0, nodeGPI = null, nodeThal = null;
let capEl = null, capDrug = -1;
const sncCells = [];
const WP1 = [360, 368], WP2 = [545, 368], GPI = [620, 345], THAL = [660, 215], LIMB = [845, 215];
const AGO_N = 8;
function laneD(pts) { return "M" + pts.map(function (p) { return f1(p[0]) + " " + f1(p[1]); }).join("L"); }
function capText(d) {
  if (d === 1) return "Levodopa turns into dopamine in the brain. The brake loosens and the limb swings.";
  if (d === 2) return "The agonist presses dopamine receptors itself. The go path wakes up without new dopamine.";
  if (d === 3) return "The inhibitor protects dopamine from breakdown. The signal lasts longer and movement returns.";
  return "No treatment. Little dopamine, so the brake holds and the limb barely moves.";
}
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0, sp: 1, x: 0, y: 0, t: 0, mode: 0, slot: -1 }; }); }
const dopaP = pool(26, () => mk("circle", { class: "sc-p p-dopa", r: 3 }, layers.parts));
const goP = pool(14, () => mk("circle", { class: "sc-p p-dir", r: 2.8 }, layers.parts));
const stopP = pool(22, () => mk("circle", { class: "sc-p p-ind", r: 2.8 }, layers.parts));
const brakeP = pool(12, () => mk("circle", { class: "sc-p p-gpi", r: 2.8 }, layers.parts));
const moveP = pool(16, () => mk("circle", { class: "sc-p p-thal", r: 2.8 }, layers.parts));
const tabP = pool(8, () => mk("rect", { class: "pk-tab", x: -9, y: -4.5, width: 18, height: 9, rx: 4.5 }, layers.parts));
const agoP = pool(10, () => mk("circle", { class: "sc-p p-ago", r: 3.4 }, layers.parts));
const TRKS = [];
const freeP = (pl) => pl.find((p) => !p.on);
function emitT(p, k, sp) { p.on = true; p.mode = 0; p.u = 0; p.k = k; p.sp = sp || 1; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.mode = 0; p.slot = -1; p.e.setAttribute("opacity", "0"); }
function moveT(p, dt, base) { p.u += dt * base * p.sp / Math.max(30, TRKS[p.k].len); const q = TRKS[p.k].at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); return p.u >= 1; }
/* breakdown enzymes wandering near the dopamine line, each with a blocker cap for drug 3 */
const enzymes = [];
function initOrgans() {
  brainO = organ(layers.brain, "brain", 190, 218, 250, {});
  const P = brainO.ports;
  STR = [Math.round(P.parenchyma[0]), Math.round(P.parenchyma[1])];
  SNc = [Math.round(P.stem[0]) - 6, Math.round(P.stem[1]) - 16];
  DOPA_MID = [Math.round((SNc[0] + STR[0]) / 2), Math.round((SNc[1] + STR[1]) / 2)];
  trDopa = track([SNc, DOPA_MID, STR]);
  trGo = track([STR, [330, 250], [480, 290], [604, 322]]);
  trSA = track([STR, [250, 300], WP1]);
  trSB = track([WP1, WP2]);
  trSC = track([WP2, [590, 350]]);
  trBrake = track([[628, 313], [652, 247]]);
  trMove = track([[692, 215], [818, 215]]);
  trAgo = track([[110, 58], [130, 130], STR]);
  TRKS.push(trDopa, trGo, trSA, trSB, trSC, trBrake, trMove, trAgo);
  const L = layers.lanes;
  laneDopa = mk("path", { class: "pk-dopa", d: laneD([SNc, DOPA_MID, STR]) }, L);
  laneGo = mk("path", { class: "pk-go", d: laneD([STR, [330, 250], [480, 290], [604, 322]]), "marker-end": "url(#pk-arr)" }, L);
  mk("path", { class: "pk-stop", d: laneD([STR, [250, 300], WP1]), "marker-end": "url(#pk-arr)" }, L);
  laneSB = mk("path", { class: "pk-stop", d: laneD([WP1, WP2, [590, 350]]), "marker-end": "url(#pk-arr)" }, L);
  mk("path", { class: "pk-brake", d: laneD([[628, 313], [640, 280]]) }, L);
  mk("path", { class: "pk-bar", d: "M628 252L664 242" }, L);
  mk("path", { class: "pk-move", d: laneD([[692, 215], [818, 215]]), "marker-end": "url(#pk-arr)" }, L);
  halo = mk("ellipse", { class: "pk-halo", cx: f1(THAL[0]), cy: f1(THAL[1]), rx: 48, ry: 40, opacity: "0" }, layers.nodes);
  nodeGPI = cell(layers.nodes, { cls: "gpi", r: 30, nuc: 0.34, seed: 4, wob: 0.08 });
  place(nodeGPI, GPI[0], GPI[1], 0, 1);
  nodeThal = cell(layers.nodes, { cls: "thal", r: 30, nuc: 0.34, seed: 9, wob: 0.08 });
  place(nodeThal, THAL[0], THAL[1], 0, 1);
  striRing = mk("circle", { class: "pk-ring", cx: f1(STR[0]), cy: f1(STR[1]), r: 14, opacity: "0.3" }, layers.nodes);
  striDot = cell(layers.nodes, { cls: "stri", r: 8, nuc: 0.4, seed: 5, wob: 0.1 });
  place(striDot, STR[0], STR[1], 0, 1);
  mk("circle", { class: "pk-wp", cx: f1(WP1[0]), cy: f1(WP1[1]), r: 4 }, layers.nodes);
  mk("circle", { class: "pk-wp", cx: f1(WP2[0]), cy: f1(WP2[1]), r: 4 }, layers.nodes);
  const offs = [[-14, -6], [-5, -10], [4, -12], [12, -8], [-10, 3], [0, 0], [10, 2], [-6, 8], [6, 10]];
  offs.forEach(function (o, i) { const g = cell(layers.nodes, { cls: "snc", r: 7, nuc: 0.4, seed: i + 3, wob: 0.14 }); place(g, SNc[0] + o[0], SNc[1] + o[1], 0, 1); sncCells.push(g); });
  const mid = trBrake.at(0.5);
  jawL = mk("rect", { class: "pk-jaw", x: f1(mid.x - 34), y: f1(mid.y - 8), width: 30, height: 16, rx: 6 }, layers.nodes);
  jawR = mk("rect", { class: "pk-jaw", x: f1(mid.x + 4), y: f1(mid.y - 8), width: 30, height: 16, rx: 6 }, layers.nodes);
  for (let i = 0; i < 4; i++) {
    const g = mk("g", {}, layers.nodes);
    const body = mk("circle", { class: "pk-enz", cx: 0, cy: 0, r: 6 }, g);
    const cap = mk("circle", { class: "pk-capb", cx: 0, cy: -7, r: 3.4, opacity: "0" }, g);
    place(g, DOPA_MID[0], DOPA_MID[1], 0, 1);
    enzymes.push({ g, body, cap, ph: i * 1.7 });
  }
  const ox = layers.over;
  pill(ox, "Nigra cells", SNc[0] - 9, SNc[1] + 4, 100, 332, "Substantia nigra: dopamine cells that die off in Parkinson disease. The slider sets how many are left.");
  pill(ox, "Striatum", STR[0] + 12, STR[1] - 2, 315, 150, "Striatum: the input station. Dopamine here excites the go path and quiets the stop path.");
  pill(ox, "Dopamine", DOPA_MID[0], DOPA_MID[1], 120, 250, "Dopamine: the tuning signal. Little of it reaches the striatum when nigra cells are lost.");
  const gm = trGo.at(0.45);
  pill(ox, "Go path", gm.x, gm.y, 480, 238, "Go path: the striatum loosens the GPi brake, the thalamus is released, and movement is switched on.");
  pill(ox, "Stop path", WP1[0] + 92, WP1[1], 452, 402, "Stop path: striatum to GPe to STN to GPi. It tightens the brake. Low dopamine makes it overactive.");
  pill(ox, "GPi brake", GPI[0], GPI[1] + 32, 715, 402, "GPi brake: the output that holds the thalamus down. A hard brake means slow, small movement.");
  pill(ox, "Thalamus", THAL[0] + 22, THAL[1] - 20, 775, 148, "Thalamus: the relay to movement. Released from the brake, it drives the limb.");
  pill(ox, "Movement", LIMB[0], LIMB[1] - 15, 862, 148, "Movement: with low drive the limb moves slowly and shakes at rest. Treatment makes the swings bigger.");
  capEl = mk("text", { class: "pk-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const gg = {};
let limbG = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 260, 420, 580, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Movement drive";
  [["dopa", "Dopamine", "g-dopa", "Dopamine signal reaching the striatum from the substantia nigra. It falls as dopamine neurons are lost and rises again with the treatments shown, which do not restore the neurons."], ["dir", "Direct", "g-dir", "Direct pathway: striatum to GPi. Dopamine excites it. It releases the thalamus from the GPi brake and promotes movement."], ["ind", "Indirect", "g-ind", "Indirect pathway: striatum to GPe to STN to GPi. Dopamine restrains it. When dopamine falls it becomes overactive and strengthens the brake."], ["gpi", "GPi brake", "g-gpi", "Output of the GPi onto the thalamus. A strong brake holds the thalamus down and movement drive falls."], ["move", "Movement", "g-move", "Thalamic drive to movement. Low drive means slow, small movement (bradykinesia), with rigidity and resting tremor."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function initLimb() {
  limbG = mk("g", {}, layers.limb);
  mk("path", { class: "pk-limb", d: "M0 0L26 30L56 24" }, limbG);
  mk("circle", { class: "pk-hand", cx: 62, cy: 23, r: 9 }, limbG);
  mk("circle", { class: "pk-hand", cx: 0, cy: 0, r: 6 }, limbG);
  place(limbG, LIMB[0], LIMB[1], 0, 1);
}
const sm = { DA: 0.5, raw: 0.5, D: 0.5, I: 0.5, G: 0.5, T: 0.4, Sym: 0.5 };
const acc = { dopa: 0, dir: 0, ind: 0, gpi: 0, thal: 0, tab: 0, ago: 0 };
function init() { initOrgans(); initLimb(); initPanel(); }
function dockPos(i) { const a = (i / AGO_N) * 6.2832 - 1.57; return [STR[0] + Math.cos(a) * 14, STR[1] + Math.sin(a) * 14]; }
function step(dt, m) {
  const k = Math.min(1, dt * 1.5);
  sm.DA = lerp(sm.DA, m.DA, k); sm.raw = lerp(sm.raw, m.raw, k); sm.D = lerp(sm.D, m.D, k); sm.I = lerp(sm.I, m.I, k); sm.G = lerp(sm.G, m.G, k); sm.T = lerp(sm.T, m.T, k); sm.Sym = lerp(sm.Sym, m.Sym, k);
  sncCells.forEach((g, i) => { const want = Math.round(sm.raw * sncCells.length); g.style.opacity = i < want ? "1" : "0.08"; });
  striFlash = Math.max(0, striFlash - dt * 2);
  place(striDot, STR[0], STR[1], 0, 1 + 0.25 * striFlash + 0.12 * sm.DA * Math.max(0, Math.sin(tm / 360)));
  place(nodeGPI, GPI[0], GPI[1], 0, 0.85 + 0.35 * sm.G);
  place(nodeThal, THAL[0], THAL[1], 0, 0.9 + 0.2 * sm.T * Math.max(0, Math.sin(tm / 420)));
  halo.setAttribute("opacity", (sm.T * 0.4).toFixed(2));
  laneDopa.setAttribute("opacity", (0.2 + 0.55 * sm.raw).toFixed(2));
  laneGo.setAttribute("stroke-width", f1(1.5 + 5 * sm.D));
  laneSB.setAttribute("stroke-width", f1(1.5 + 4.5 * sm.I));
  const mid = trBrake.at(0.5), gap = 2 + 20 * (1 - sm.G);
  jawL.setAttribute("x", f1(mid.x - gap - 30)); jawR.setAttribute("x", f1(mid.x + gap));
  /* enzymes chew passing dopamine unless the inhibitor caps them */
  const capped = drug === 3;
  enzymes.forEach((en, i) => {
    const ex = DOPA_MID[0] + Math.cos(tm / 1100 + en.ph) * 34, ey = DOPA_MID[1] + Math.sin(tm / 1300 + en.ph) * 26;
    place(en.g, ex, ey, 0, 1); en.x = ex; en.y = ey;
    en.cap.setAttribute("opacity", capped ? "1" : "0");
    en.body.setAttribute("opacity", capped ? "0.35" : "0.9");
  });
  /* levodopa tablets fall in and burst into dopamine at the striatum */
  if (drug === 1) { acc.tab += dt * 2.2; while (acc.tab >= 1) { acc.tab--; const p = freeP(tabP); if (p) { p.on = true; p.mode = 1; p.x = rnd(120, 260); p.y = 56; p.e.setAttribute("opacity", "1"); } } }
  tabP.forEach((p) => {
    if (!p.on || p.mode !== 1) return;
    p.y += 130 * dt; p.x += (STR[0] - p.x) * Math.min(1, dt * 2);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 12) + ")");
    if (Math.hypot(p.x - STR[0], p.y - STR[1]) < 22) {
      killP(p); striFlash = 1;
      for (let j = 0; j < 3; j++) { const d = freeP(dopaP); if (d) { d.on = true; d.mode = 0; d.k = 0; d.u = rnd(0.2, 0.6); d.sp = rnd(0.85, 1.15); d.e.setAttribute("opacity", "1"); } }
    }
  });
  /* agonist dots travel in and sit on striatal receptors, each firing go pulses */
  let docked = 0;
  agoP.forEach((p) => { if (p.on && p.mode === 2) docked++; });
  if (drug === 2 && docked < AGO_N) { acc.ago += dt * 1.6; while (acc.ago >= 1) { acc.ago--; const p = freeP(agoP); if (p) emitT(p, 7, 0.55); } }
  agoP.forEach((p) => {
    if (!p.on) return;
    if (p.mode === 0) {
      if (drug !== 2) { killP(p); return; }
      if (moveT(p, dt, 95)) {
        const used = agoP.filter((q) => q.on && q.mode === 2).map((q) => q.slot);
        let s = -1;
        for (let i = 0; i < AGO_N; i++) if (used.indexOf(i) < 0) { s = i; break; }
        if (s < 0) { killP(p); return; }
        p.mode = 2; p.slot = s; p.t = rnd(0, 1.1);
        const dp = dockPos(s);
        p.e.setAttribute("transform", "translate(" + f1(dp[0]) + " " + f1(dp[1]) + ")");
      }
    } else if (p.mode === 2) {
      if (drug !== 2) { killP(p); return; }
      const dp = dockPos(p.slot);
      p.e.setAttribute("transform", "translate(" + f1(dp[0]) + " " + f1(dp[1]) + ")");
      p.t += dt;
      if (p.t > 1.1) { p.t = 0; const g = freeP(goP); if (g) emitT(g, 1, rnd(0.9, 1.2)); striFlash = Math.max(striFlash, 0.4); }
    }
  });
  striRing.setAttribute("opacity", (drug === 2 ? 0.35 + 0.65 * docked / AGO_N : 0.3).toFixed(2));
  acc.dopa += dt * (1 + 9 * sm.DA); while (acc.dopa >= 1) { acc.dopa--; const p = freeP(dopaP); if (p) emitT(p, 0, rnd(0.85, 1.15)); }
  acc.dir += dt * sm.D * 7; while (acc.dir >= 1) { acc.dir--; const p = freeP(goP); if (p) emitT(p, 1, rnd(0.85, 1.15)); }
  acc.ind += dt * sm.I * 8; while (acc.ind >= 1) { acc.ind--; const p = freeP(stopP); if (p) emitT(p, 2 + Math.floor(Math.random() * 3), rnd(0.85, 1.15)); }
  acc.gpi += dt * (1 + 8 * sm.G); while (acc.gpi >= 1) { acc.gpi--; const p = freeP(brakeP); if (p) emitT(p, 5, rnd(0.85, 1.15)); }
  acc.thal += dt * sm.T * 9; while (acc.thal >= 1) { acc.thal--; const p = freeP(moveP); if (p) emitT(p, 6, rnd(0.85, 1.15)); }
  dopaP.forEach((p) => {
    if (!p.on || p.mode !== 0) return;
    const done = moveT(p, dt, 90);
    if (!capped) {
      for (const en of enzymes) { if (Math.hypot(p.x - en.x, p.y - en.y) < 14 && Math.random() < dt * 3) { killP(p); break; } }
      if (!p.on) return;
    }
    if (done) { killP(p); striFlash = Math.max(striFlash, 0.5); }
  });
  goP.forEach((p) => { if (!p.on) return; if (moveT(p, dt, 80)) killP(p); });
  stopP.forEach((p) => { if (!p.on) return; if (moveT(p, dt, 80)) killP(p); });
  brakeP.forEach((p) => { if (!p.on) return; if (moveT(p, dt, 70)) killP(p); });
  moveP.forEach((p) => { if (!p.on) return; if (moveT(p, dt, 85)) killP(p); });
  const swing = Math.sin(tm / 1300) * (3 + 15 * sm.T);
  const tremor = Math.sin(tm / 95) * sm.Sym * (1 - sm.T * 0.55) * 6;
  place(limbG, LIMB[0], LIMB[1], swing + tremor, 1);
  gg.dopa.set(sm.DA, wordOf(sm.DA, 0.35, 0.7, ["low", "reduced", "near normal"]));
  gg.dir.set(sm.D, wordOf(sm.D, 0.35, 0.65, ["weak", "reduced", "strong"]));
  gg.ind.set(sm.I, wordOf(sm.I, 0.35, 0.65, ["quiet", "active", "overactive"]));
  gg.gpi.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["light", "firm", "hard on"]));
  gg.move.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["low", "reduced", "strong"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
