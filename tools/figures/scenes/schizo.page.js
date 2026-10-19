/* Schizophrenia scene: a real brain feeds four dopamine roads; medicine caps the D2 gates. */
const layers = { brain: $("brainSlot"), lanes: $("lanes"), nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LY = [130, 215, 300, 375], GX = 470, TX = 790;
let brainO = null;
const TRKS = [];
const lanePaths = [];
const gates = [];
let halo = null, epsRing = null;
const targets = {};
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Typical medicine caps all four gates. Voices ease but movement stiffens and prolactin flows.";
  if (d === 2) return "Atypical medicine caps the top gates most. Voices ease with less stiffness.";
  return "No treatment. The top road floods the limbic area and voices stay loud.";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, pass: false, lane: 0, x: -999, y: 0, vx: 0, vy: 0, mode: 0, slot: -1 }; }); }
const daML = pool(30, () => mk("circle", { class: "sc-p p-da", r: 3 }, layers.parts));
const daMC = pool(10, () => mk("circle", { class: "sc-p p-da", r: 2.6 }, layers.parts));
const daNS = pool(16, () => mk("circle", { class: "sc-p p-da", r: 2.8 }, layers.parts));
const daTI = pool(16, () => mk("circle", { class: "sc-p p-da", r: 2.8 }, layers.parts));
const prlP = pool(14, () => mk("circle", { class: "sc-p p-prl", r: 2.6 }, layers.parts));
const blkP = pool(16, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-drug", x: -5, y: -3.5, width: 10, height: 7, rx: 2 }, g); return g; });
function killB(p) { p.on = false; p.mode = 0; p.slot = -1; p.e.setAttribute("opacity", "0"); }
function emitDA(pl, lane) { const p = pl.find((q) => !q.on); if (!p) return; p.on = true; p.u = 0; p.pass = false; p.lane = lane; p.x = -999; p.e.setAttribute("opacity", "1"); }
function moveDA(pl, dt, blk) {
  pl.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 90 / TRKS[p.lane].len;
    if (!p.pass && p.x >= GX - 2) { p.pass = true; if (Math.random() < blk) { killB(p); return; } }
    const q = TRKS[p.lane].at(Math.min(1, p.u));
    p.x = q.x; p.y = q.y;
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    if (p.u >= 1) killB(p);
  });
}
/* a small dopamine cell group on the brain, hovering as one labelled part */
function cluster(c, cls, n, tip) {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, layers.nodes);
  const offs = [[-13, -4], [-4, -9], [5, -10], [12, -4], [-8, 4], [2, 1], [10, 6]];
  for (let i = 0; i < n; i++) {
    const q = cell(g, { cls, r: 6.5, nuc: 0.4, seed: i * 1.3 + c[0] * 0.01 + c[1] * 0.02, wob: 0.14 });
    place(q, c[0] + offs[i % offs.length][0], c[1] + offs[i % offs.length][1], 0, 1);
  }
  return g;
}
function nodeT(cls, x, y, r, tip) {
  const g = cell(layers.nodes, { cls, r, nuc: 0.34, seed: x * 0.013 + y * 0.017, wob: 0.08 });
  g.setAttribute("class", g.getAttribute("class") + " hot"); g.setAttribute("tabindex", "0"); g.setAttribute("data-info", tip);
  place(g, x, y, 0, 1); return g;
}
function slotPos(lane, s) {
  const y = LY[lane];
  if (s === 0) return [GX - 10, y - 11];
  if (s === 1) return [GX + 10, y - 11];
  return [GX, y + 12];
}
function wantFor(lane) {
  if (drug === 1) return 3;
  if (drug === 2) return lane < 2 ? 3 : lane === 3 ? 2 : 1;
  return 0;
}
function initOrgans() {
  brainO = organ(layers.brain, "brain", 175, 215, 250, {});
  const ST = brainO.ports.stem;
  const vc = [Math.round(ST[0] - 4), Math.round(ST[1] - 38)];
  const nc = [Math.round(ST[0] - 12), Math.round(ST[1] - 16)];
  const ac = [Math.round(ST[0] + 16), Math.round(ST[1] - 26)];
  const SRC = [vc, vc, nc, ac];
  const L = layers.lanes;
  for (let i = 0; i < 4; i++) {
    TRKS.push(track([SRC[i], [310, LY[i]], [752, LY[i]]]));
    lanePaths.push(mk("path", { class: "sz-arrow", d: "M" + f1(SRC[i][0]) + " " + f1(SRC[i][1]) + "L310 " + LY[i] + "L752 " + LY[i], "marker-end": "url(#sz-arr)" }, L));
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": "D2 gate on this road. Medicine caps sit here and stop dopamine dots passing, so the signal past the gate fades." }, layers.nodes);
    const bar = mk("rect", { class: "sz-gate", x: GX - 5, y: LY[i] - 4, width: 10, height: 8, rx: 3, opacity: "0.18" }, g);
    mk("circle", { class: "sz-rec", cx: GX, cy: LY[i], r: 4 }, g);
    gates.push({ bar, y: LY[i], i });
  }
  halo = mk("ellipse", { class: "sz-hot", cx: f1(TX), cy: f1(LY[0]), rx: 60, ry: 45, opacity: "0" }, layers.nodes);
  epsRing = mk("circle", { class: "sz-eps", cx: f1(TX), cy: f1(LY[2]), r: 37, opacity: "0" }, layers.nodes);
  cluster(vc, "vta", 7, "Source cells: three small dopamine cell groups deep in the brain feed the four roads. The VTA feeds the top two roads.");
  cluster(nc, "nigra", 5, "Substantia nigra: the dopamine group feeding the movement road. It starts healthy. Trouble comes from blocking its gate.");
  cluster(ac, "arc", 4, "Arcuate nucleus of the hypothalamus: the dopamine group feeding the hormone road. Its signal holds prolactin down.");
  targets.limb = nodeT("limb", TX, LY[0], 30, "Limbic area including the nucleus accumbens. A flood of signal here drives voices and false beliefs. Blockade calms it and the glow fades.");
  targets.pfc = nodeT("pfc", TX, LY[1], 30, "Front of the brain. Too little signal here brings flat mood and withdrawal. Blockade does not refill it, so it stays dim.");
  targets.stri = nodeT("stri", TX, LY[2], 28, "Striatum. Capping its gate disturbs movement and brings stiffness and tremor, shown by the shaking ring.");
  targets.pit = nodeT("pit", TX, LY[3], 24, "Pituitary gland. Dopamine holds prolactin down, so capping its gate lets prolactin flow.");
  const ox = layers.over;
  pill(ox, "Source cells", vc[0], vc[1], 110, 128, "Three small dopamine cell groups deep in the brain feed the four roads. The VTA feeds the top two, the nigra feeds the movement road, and the arcuate feeds the hormone road.");
  pill(ox, "Voices road", 320, LY[0], 320, 106, "Mesolimbic road from the VTA to the limbic area. Too much signal here drives delusions and hallucinations.");
  pill(ox, "Flat road", 320, LY[1], 320, 191, "Mesocortical road from the VTA to the front of the brain. Too little signal here brings flat mood and withdrawal.");
  pill(ox, "Movement road", 320, LY[2], 320, 276, "Nigrostriatal road from the nigra to the striatum. It starts near normal. Blocking it causes stiffness and tremor.");
  pill(ox, "Hormone road", 320, LY[3], 320, 351, "Tuberoinfundibular road from the arcuate to the pituitary. Its dopamine holds prolactin down.");
  pill(ox, "D2 gates", GX + 16, LY[0] + 2, 470, 94, "D2 gates, one per road. Medicine sits on every gate at once, so help and harm arrive together.");
  pill(ox, "Voices", TX + 12, LY[0] - 6, 880, 108, "Limbic area. Excess signal here drives voices and false beliefs. Blockade calms it and the glow fades.");
  pill(ox, "Prolactin", TX + 14, LY[3] - 3, 880, 352, "Pituitary gland. When its dopamine brake is blocked, prolactin flows.");
  capEl = mk("text", { class: "sz-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 260, 420, 580, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Symptoms and effects";
  [["block", "D2 block", "g-szblock", "How strongly the D2 gates are capped. The slider sets illness intensity and the treatment choice sets how much blockade falls on each road."], ["meso", "Meso signal", "g-szmeso", "Effective dopamine signal on the voices road. A flood drives positive symptoms and capping the gate calms it."], ["pos", "Positive sx", "g-szpos", "Positive symptoms such as delusions and hallucinations. They ease as the voices road is capped."], ["move", "Movement fx", "g-szeps", "Movement effects from capping the movement road. Typical blockade makes them marked and atypical blockade mostly spares them."], ["prl", "Prolactin", "g-szprl", "Prolactin from the pituitary. Dopamine normally holds it down, so capping the hormone gate lets it flow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { Bm: 0, Bc: 0, Bn: 0, Bt: 0, ML: 0.9, MC: 0.26, NS: 0.95, TI: 0.92, PRL: 0.14, EPS: 0.05 };
const acc = { ml: 0, mc: 0, ns: 0, ti: 0, prl: 0, blk: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.Bm = lerp(sm.Bm, m.Bm, k); sm.Bc = lerp(sm.Bc, m.Bc, k); sm.Bn = lerp(sm.Bn, m.Bn, k); sm.Bt = lerp(sm.Bt, m.Bt, k);
  sm.ML = lerp(sm.ML, m.ML, k); sm.MC = lerp(sm.MC, m.MC, k); sm.NS = lerp(sm.NS, m.NS, k); sm.TI = lerp(sm.TI, m.TI, k); sm.PRL = lerp(sm.PRL, m.PRL, k); sm.EPS = lerp(sm.EPS, m.EPS, k);
  const blks = [sm.Bm, sm.Bc, sm.Bn, sm.Bt];
  gates.forEach((gt, i) => {
    const bh = 8 + 30 * blks[i];
    gt.bar.setAttribute("y", f1(gt.y - bh / 2)); gt.bar.setAttribute("height", f1(bh));
    gt.bar.setAttribute("opacity", (0.18 + 0.82 * blks[i]).toFixed(2));
  });
  halo.setAttribute("opacity", (0.5 * sm.ML).toFixed(2));
  halo.setAttribute("rx", f1(50 + 22 * sm.ML)); halo.setAttribute("ry", f1(38 + 16 * sm.ML));
  epsRing.setAttribute("opacity", (0.75 * sm.EPS).toFixed(2));
  lanePaths[0].setAttribute("stroke-width", f1(1.6 + 4 * sm.ML));
  place(targets.limb, TX, LY[0], 0, 0.92 + 0.16 * sm.ML * Math.max(0, Math.sin(tm / 380)));
  place(targets.pfc, TX, LY[1], 0, 1); targets.pfc.style.opacity = (0.45 + 0.4 * sm.MC).toFixed(2);
  place(targets.stri, TX + Math.sin(tm / 42) * sm.EPS * 3.2, LY[2], 0, 0.92 + 0.1 * sm.NS);
  place(targets.pit, TX, LY[3], 0, 0.9 + 0.28 * sm.PRL);
  acc.ml += dt * (3 + 9 * m.a); while (acc.ml >= 1) { acc.ml--; emitDA(daML, 0); }
  acc.mc += dt * 2.2; while (acc.mc >= 1) { acc.mc--; emitDA(daMC, 1); }
  acc.ns += dt * 7; while (acc.ns >= 1) { acc.ns--; emitDA(daNS, 2); }
  acc.ti += dt * 7; while (acc.ti >= 1) { acc.ti--; emitDA(daTI, 3); }
  moveDA(daML, dt, sm.Bm); moveDA(daMC, dt, sm.Bc); moveDA(daNS, dt, sm.Bn); moveDA(daTI, dt, sm.Bt);
  acc.prl += dt * Math.max(0, sm.PRL - 0.25) * 14;
  while (acc.prl >= 1) {
    acc.prl--;
    const p = prlP.find((q) => !q.on);
    if (p) { p.on = true; p.x = TX + 34; p.y = LY[3] + rnd(-6, 6); p.vx = rnd(22, 30); p.vy = rnd(-5, 5); p.e.setAttribute("opacity", "1"); }
  }
  prlP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > TX + 68) killB(p); });
  /* blockers fall onto the gates and sit on them while treatment is on */
  const docked = [0, 0, 0, 0];
  blkP.forEach((p) => { if (p.on && p.mode === 2) docked[p.lane]++; });
  blkP.forEach((p) => { if (p.on && p.mode === 2 && docked[p.lane] > wantFor(p.lane)) { killB(p); docked[p.lane]--; } });
  if (drug > 0) {
    acc.blk += dt * 5;
    while (acc.blk >= 1) {
      acc.blk--;
      let li = -1;
      for (let i = 0; i < 4; i++) {
        let n = 0;
        blkP.forEach((p) => { if (p.on && p.lane === i) n++; });
        if (n < wantFor(i)) { li = i; break; }
      }
      if (li < 0) break;
      const p = blkP.find((q) => !q.on);
      if (!p) break;
      const used = [];
      blkP.forEach((q) => { if (q.on && q.lane === li && q.slot >= 0) used.push(q.slot); });
      let s = -1;
      for (let i = 0; i < 3; i++) if (used.indexOf(i) < 0) { s = i; break; }
      if (s < 0) break;
      p.on = true; p.mode = 0; p.lane = li; p.slot = s;
      p.x = GX + rnd(-46, 46); p.y = LY[li] - 120;
      p.e.setAttribute("opacity", "1");
    }
  }
  blkP.forEach((p) => {
    if (!p.on) return;
    if (p.mode === 0) {
      if (drug === 0) { killB(p); return; }
      const sp = slotPos(p.lane, p.slot);
      const dx = sp[0] - p.x, dy = sp[1] - p.y, dist = Math.hypot(dx, dy), st = 110 * dt;
      if (dist < st + 2) { p.mode = 2; p.x = sp[0]; p.y = sp[1]; }
      else { p.x += dx / dist * st; p.y += dy / dist * st; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    } else {
      if (drug === 0) { killB(p); return; }
      const sp = slotPos(p.lane, p.slot);
      p.e.setAttribute("transform", "translate(" + f1(sp[0] + Math.sin(tm / 500 + p.slot * 2) * 1.2) + " " + f1(sp[1]) + ")");
    }
  });
  gg.block.set(Math.max(sm.Bm, sm.Bc, sm.Bn, sm.Bt), wordOf(Math.max(sm.Bm, sm.Bc, sm.Bn, sm.Bt), 0.2, 0.6, ["none", "partial", "strong"]));
  gg.meso.set(sm.ML, wordOf(sm.ML, 0.35, 0.65, ["low", "raised", "high"]));
  gg.pos.set(m.Pos, wordOf(m.Pos, 0.35, 0.65, ["controlled", "moderate", "marked"]));
  gg.move.set(sm.EPS, wordOf(sm.EPS, 0.25, 0.55, ["none", "some", "marked"]));
  gg.prl.set(sm.PRL, wordOf(sm.PRL, 0.3, 0.6, ["normal", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
