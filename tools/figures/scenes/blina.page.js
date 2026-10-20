/* Blinatumomab scene: a CD19 blast and a CD3 T cell are bridged into an immune synapse,
 * granzymes lyse the blast, normal B cells and antibodies fall, cytokines flood the blood,
 * and the brain shows ICANS with no causal arrow (mechanism not fully understood). */
const BB = { x0: 140, y: 210, x1: 195, r: 60 };
const TT = { x0: 400, y: 210, x1: 315, r: 50 };
const SYN = { x: 255, y: 210 };
const VX = 500, VY = 96, VW = 430, VH = 24, BX = 830, BY = 300;
const L = { norm: $("norm"), stage: $("stage"), bridge: $("bridge"), gran: $("gran"), debris: $("debris"), vessel: $("vessel"), blood: $("blood"), glow: $("glow"), brainSlot: $("brainSlot"), brainFx: $("brainFx"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
function bridgeGlyph(parent) {
  const g = mk("g", {}, parent);
  mk("line", { class: "bl-core", x1: -9, y1: 0, x2: 9, y2: 0 }, g);
  mk("circle", { class: "bl-cd19", cx: -12, cy: 0, r: 4 }, g);
  mk("circle", { class: "bl-cd3", cx: 12, cy: 0, r: 4 }, g);
  return g;
}
let blastG = null, tG = null, synEl = null, capEl = null, capKey = "";
let cd19n = [], cd3n = [], sats = [], nbs = [], abs = [], docked = [], flashes = [];
let flyP, granP, debP, cytP, ringP, brainTint = null, glowEl = null, tintEl = null;
let gg = {};
function capText(d, l) {
  if (d === 0) return "No treatment. The blast and the T cell drift apart, leukaemia fills the marrow, and B cells with antibodies hold.";
  if (d === 2 && l === 0) return "Infusion paused for toxicity at low burden. No new bridges form and killing has stopped; the burden reading stays put while cytokines ease and the brain is watched.";
  if (d === 2 && l === 1) return "Infusion paused for toxicity. Bridging and killing have stopped, so further blast clearing is not assumed; the burden reading stays put while cytokine and brain toxicity ease under care.";
  if (d === 2) return "Infusion paused for toxicity at high burden. Bridging and killing have stopped and the burden stays high; severe cytokine release or neurologic toxicity gets clinical treatment.";
  if (l === 0) return "Early course on blinatumomab. The bridge pulls T cells onto blasts, killing begins, and cytokines stir.";
  if (l === 1) return "Blinatumomab engaged. Synapses form, granzymes lyse blasts and normal B cells too, and cytokines flood the blood.";
  return "High burden on blinatumomab. Killing runs hot and toxicity peaks: cytokine release plus neurologic watch.";
}
function init() {
  /* ---- malignant B cell with CD19 nubs; T cell with CD3 nubs (children, so they move together) ---- */
  blastG = cell(L.stage, { cls: "blast", r: BB.r, nuc: 0.55, seed: 5, wob: 0.07 });
  for (let i = -1; i <= 1; i++) cd19n.push(mk("rect", { class: "bl-cd19", x: BB.r - 2, y: i * 18 - 5, width: 10, height: 10, rx: 3 }, blastG));
  const bh = mk("g", { class: "hot", tabindex: "0", "data-info": "Malignant B cell. It carries CD19 on its surface; without the drug the T cell cannot see it." }, blastG);
  mk("circle", { cx: 0, cy: 0, r: BB.r, fill: "none", "pointer-events": "all" }, bh);
  tG = cell(L.stage, { cls: "tcell", r: TT.r, nuc: 0.5, seed: 9, wob: 0.09 });
  for (let i = -1; i <= 1; i++) cd3n.push(mk("rect", { class: "bl-cd3", x: -TT.r - 8, y: i * 16 - 5, width: 10, height: 10, rx: 3 }, tG));
  const th = mk("g", { class: "hot", tabindex: "0", "data-info": "T cell. It carries CD3; the drug grips CD3 and drags the T cell onto the blast." }, tG);
  mk("circle", { cx: 0, cy: 0, r: TT.r, fill: "none", "pointer-events": "all" }, th);
  /* ---- satellite blasts show the tumour burden falling ---- */
  sats = [[70, 120], [70, 300], [330, 120]].map(([x, y], i) => { const g = cell(L.stage, { cls: "blast", r: 20, nuc: 0.55, seed: i + 21, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
  /* ---- normal B cells and the antibodies above them ---- */
  nbs = [60, 105, 150, 195, 240].map((x, i) => { const g = cell(L.norm, { cls: "nb", r: 14, nuc: 0.5, seed: i + 31, wob: 0.12 }); place(g, x, 362, 0, 1); return { g, x }; });
  const nbh = mk("g", { class: "hot", tabindex: "0", "data-info": "Normal B cells. They also carry CD19, so the drug depletes them; antibodies fall and infection risk rises." }, L.norm);
  mk("rect", { x: 40, y: 340, width: 220, height: 44, fill: "none", "pointer-events": "all" }, nbh);
  abs = Array.from({ length: 8 }, (_, i) => mk("path", { class: "bl-ab", d: "M-4 -6L0 0L4 -6M0 0L0 7", transform: "translate(" + (66 + i * 24) + " 322)", opacity: "0" }, L.norm));
  /* ---- synapse glow and docked bridges at the cleft ---- */
  synEl = mk("ellipse", { class: "bl-syn", cx: SYN.x, cy: SYN.y, rx: 24, ry: 62, opacity: "0" }, L.bridge);
  const syh = mk("g", { class: "hot", tabindex: "0", "data-info": "Immune synapse. The bridge holds both cells close while the T cell fires into the blast." }, L.bridge);
  mk("ellipse", { cx: SYN.x, cy: SYN.y, rx: 30, ry: 66, fill: "none", "pointer-events": "all" }, syh);
  docked = [150, 190, 230, 270].map((y) => { const g = bridgeGlyph(L.bridge); g.setAttribute("transform", "translate(" + SYN.x + " " + y + ")"); g.setAttribute("opacity", "0"); return g; });
  const brh = mk("g", { class: "hot", tabindex: "0", "data-info": "Blinatumomab bridge. One end grips CD19, the other grips CD3, pulling both cells into an immune synapse." }, L.bridge);
  mk("rect", { x: SYN.x - 20, y: 140, width: 40, height: 140, fill: "none", "pointer-events": "all" }, brh);
  flashes = [0, 1, 2, 3].map((i) => mk("path", { class: "bl-hit", d: "M-5 -5L5 5M5 -5L-5 5", opacity: "0" }, L.gran));
  const grh = mk("g", { class: "hot", tabindex: "0", "data-info": "Granzyme kill. The joined T cell releases perforin and granzymes that lyse the blast." }, L.gran);
  mk("rect", { x: 208, y: 236, width: 76, height: 52, fill: "none", "pointer-events": "all" }, grh);
  flyP = pool(8, () => bridgeGlyph(L.bridge));
  granP = pool(14, () => mk("circle", { class: "sc-p p-gran", r: 2.6 }, L.gran));
  debP = pool(12, () => mk("circle", { class: "sc-p p-deb", r: 2.4 }, L.debris));
  /* ---- blood vessel strip with cytokines and inflammation glow ---- */
  const vs = mk("g", { class: "hot", tabindex: "0", "data-info": "Cytokines in blood. Activated T cells flood the blood with inflammatory cytokines: systemic inflammation." }, L.vessel);
  mk("rect", { class: "sc-lumen", x: VX, y: VY, width: VW, height: VH, rx: VH / 2 }, vs);
  tintEl = mk("ellipse", { class: "bl-infl", cx: 715, cy: 242, rx: 218, ry: 192, opacity: "0" }, L.glow);
  glowEl = mk("ellipse", { class: "bl-infl", cx: 715, cy: VY + VH / 2, rx: 200, ry: 15, opacity: "0" }, L.glow);
  cytP = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.blood));
  /* ---- brain: ICANS ring and tint, with an explicit unclear-mechanism marker and no causal arrow ---- */
  organ(L.brainSlot, "brain", BX, BY, 150, {});
  brainTint = mk("ellipse", { class: "bl-infl", cx: BX, cy: BY, rx: 56, ry: 46, opacity: "0" }, L.brainFx);
  mk("circle", { class: "bl-unk", cx: BX, cy: BY, r: 72 }, L.brainFx);
  const qt = mk("text", { class: "bl-q", x: BX + 62, y: BY - 58, "text-anchor": "middle" }, L.brainFx); qt.textContent = "?";
  const qh = mk("g", { class: "hot", tabindex: "0", "data-info": "ICANS. Confusion, tremor or seizures can follow treatment; the mechanism is not fully understood." }, L.brainFx);
  mk("circle", { cx: BX + 62, cy: BY - 64, r: 12, fill: "none", "pointer-events": "all" }, qh);
  ringP = pool(6, () => mk("circle", { class: "bl-ring", r: 30 }, L.brainFx));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Blast CD19", 140, 158, 110, 112, "Malignant B cell. It carries CD19 on its surface; without the drug the T cell cannot see it.");
  pill(o, "T cell CD3", 400, 160, 400, 112, "T cell. It carries CD3; the drug grips CD3 and drags the T cell onto the blast.");
  pill(o, "Bridge", 255, 210, 255, 300, "Blinatumomab bridge. One end grips CD19, the other grips CD3, pulling both cells into an immune synapse.");
  pill(o, "Granzyme kill", 236, 252, 352, 332, "Granzyme kill. The joined T cell releases perforin and granzymes that lyse the blast.");
  pill(o, "Normal B cells", 105, 362, 105, 406, "Normal B cells. They also carry CD19, so the drug depletes them; antibodies fall and infection risk rises.");
  pill(o, "Cytokines in blood", 715, 108, 715, 162, "Cytokines in blood. Activated T cells flood the blood with inflammatory cytokines: systemic inflammation.");
  pill(o, "ICANS: unclear how", 830, 300, 830, 392, "ICANS. Confusion, tremor or seizures can follow treatment; the mechanism is not fully understood.");
  capEl = mk("text", { class: "bl-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["bla", "Blasts", "g-blast", "Blasts. The malignant CD19 clone that fills the marrow and blood."],
    ["nb", "B cells", "g-nb", "Normal B cells. Healthy CD19 B cells depleted alongside blasts; antibodies fall."],
    ["kil", "Killing", "g-kill", "T cell killing. Synapse driven granzyme lysis of CD19 positive cells."],
    ["cyt", "Cytokines", "g-cyt", "Cytokine release. Activated T cells flood the blood: fever, low pressure, systemic inflammation."],
    ["nt", "Brain", "g-nt", "Neurologic toxicity including ICANS. Associated harm; the mechanism is not fully understood."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 165, 486, 60, 18, cls, name, tip); });
}
const sm = { syn: 0, kill: 0, B: 0.5, Nb: 0.9, Ab: 0.9, C: 0, N: 0, on: 0 };
const acc = { fly: 0, gran: 0, deb: 0, cyt: 0, ring: 0, fl: 0 };
const flash = [0, 0, 0, 0]; let flI = 0;
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.syn = lerp(sm.syn, m.syn, k); sm.kill = lerp(sm.kill, m.kill, k); sm.B = lerp(sm.B, m.B, k);
  sm.Nb = lerp(sm.Nb, m.Nb, k); sm.Ab = lerp(sm.Ab, m.Ab, k); sm.C = lerp(sm.C, m.C, k);
  sm.N = lerp(sm.N, m.N, k); sm.on = lerp(sm.on, m.on, k);
  /* cells drift together as the bridge engages */
  const bx = lerp(BB.x0, BB.x1, sm.on), tx = lerp(TT.x0, TT.x1, sm.on);
  place(blastG, bx + Math.sin(tm / 700) * 1.5, BB.y, 0, 1 + 0.012 * Math.sin(tm / 500));
  place(tG, tx + Math.sin(tm / 640 + 2) * 1.5, TT.y, 0, 1 + 0.015 * Math.sin(tm / 560 + 1));
  synEl.setAttribute("opacity", (sm.syn * 0.9).toFixed(2));
  synEl.setAttribute("stroke-dashoffset", (-tm / 40).toFixed(1));
  docked.forEach((g) => g.setAttribute("opacity", sm.syn.toFixed(2)));
  sats.forEach((s, i) => { const sc = Math.max(0.001, 1 - 0.9 * sm.kill); place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, sc); s.g.style.opacity = sm.kill > 0.92 ? 0 : 1; });
  /* flying bridges drift down to the cleft while treatment runs */
  acc.fly += dt * sm.on * 2.2;
  while (acc.fly >= 1) { acc.fly--; const p = free(flyP); if (p) emit(p, rnd(190, 320), 56, rnd(-6, 6), rnd(46, 70), 0); }
  flyP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 10 + p.x) + ")"); if (p.y > 200) kill(p); });
  /* granzyme granules fly from the T cell into the blast, then burst into debris */
  acc.gran += dt * sm.syn * 9;
  while (acc.gran >= 1) { acc.gran--; const p = free(granP); if (p) emit(p, tx - TT.r + 6, TT.y + rnd(-26, 26), -(70 + rnd(0, 50)), rnd(-8, 8), 0); }
  granP.forEach((p) => {
    if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x < bx + BB.r - 2) {
      kill(p); flash[flI++ % 4] = 1;
      for (let i = 0; i < 2; i++) { const d = free(debP); if (d) { const a = rnd(0, 6.28); emit(d, bx + BB.r - 6, TT.y + rnd(-30, 30), Math.cos(a) * rnd(14, 40), Math.sin(a) * rnd(14, 40), 0); } }
    }
  });
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); });
  flashes.forEach((f, i) => { flash[i] = Math.max(0, flash[i] - dt * 2.2); f.setAttribute("transform", "translate(" + f1(bx + BB.r - 4) + " " + (196 + i * 14) + ")"); f.setAttribute("opacity", flash[i].toFixed(2)); });
  /* normal B cells and antibodies fade as on-target depletion builds */
  nbs.forEach((c, i) => { const v = sm.Nb > 0.12 + i * 0.16 ? 1 : 0.08; place(c.g, c.x, 362 + Math.sin(tm / 750 + i * 2.4) * 2, 0, 0.25 + 0.75 * v); c.g.style.opacity = v; });
  abs.forEach((e, i) => e.setAttribute("opacity", sm.Ab > (i + 1) / 9 ? "0.95" : "0.06"));
  /* cytokines stream through the vessel; the tissue glows with systemic inflammation */
  acc.cyt += dt * (1.5 + sm.C * 9);
  while (acc.cyt >= 1) { acc.cyt--; const p = free(cytP); if (p) emit(p, VX, VY + rnd(3, VH - 3), rnd(40, 70) + sm.C * 60, 0, 0); }
  cytP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > VX + VW) kill(p); });
  glowEl.setAttribute("opacity", (0.55 * sm.C).toFixed(2));
  tintEl.setAttribute("opacity", (0.12 * sm.C).toFixed(2));
  /* brain: pressure tint and expanding rings with no causal arrow drawn */
  brainTint.setAttribute("opacity", (0.45 * sm.N).toFixed(2));
  acc.ring += dt * (0.25 + sm.N * 1.4);
  while (acc.ring >= 1) { acc.ring--; const p = free(ringP); if (p) emit(p, BX, BY, 0, 0, 0); }
  ringP.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.3 + p.t * 0.9).toFixed(2) + ")"); p.e.setAttribute("opacity", ((0.12 + 0.6 * sm.N) * (1 - p.t / 1.6)).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.bla.set(sm.B, wordOf(sm.B, 0.25, 0.6, ["cleared", "present", "high"])); gg.nb.set(sm.Nb, wordOf(sm.Nb, 0.3, 0.65, ["gone", "low", "normal"]));
  gg.kil.set(sm.kill, wordOf(sm.kill, 0.3, 0.65, ["idle", "starting", "hot"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["quiet", "rising", "severe"]));
  gg.nt.set(sm.N, wordOf(sm.N, 0.3, 0.6, ["quiet", "watch", "severe"]));
}
run({ init, step });
