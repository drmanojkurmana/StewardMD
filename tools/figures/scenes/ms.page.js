/* Multiple sclerosis scene: immune cells cross the barrier, strip myelin, form a plaque and block the impulse. */
const AXY = SC.AXY, WW = SC.W;
const LY = { bbb: $("bbb"), myelin: $("myelin"), cells: $("cells"), parts: $("parts"), imps: $("imps"), over: $("over"), panel: $("panel"), plaque: $("plaque"), axon: $("axonRect") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }

/* ---- blood-brain barrier: a row of flat endothelial cells ---- */
const bbbCells = [];
function initBbb() { for (let i = 0; i < 20; i++) { const g = mk("g", {}, LY.bbb); cell(g, { cls: "endo", r: 13, nuc: 0.3, seed: i + 3, wob: 0.06, n: 8 }); bbbCells.push({ g, x: 38 + i * 46 }); } }

/* ---- myelin segments around the axon ---- */
const SEGX = [190, 275, 360, 445, 530, 615, 700, 785];
const SEGV = [0.15, 0.35, 0.7, 1, 1, 0.7, 0.35, 0.15];
const segs = SEGX.map((x, i) => { const g = mk("g", {}, LY.myelin); mk("rect", { class: "ms-myelin", x: -34, y: -17, width: 68, height: 34, rx: 15 }, g); return { g, x, v: SEGV[i] }; });

/* ---- immune and glial cells ---- */
const tCells = [[150, 125], [215, 165], [275, 118]].map(([hx, hy], i) => { const g = mk("g", {}, LY.cells); cell(g, { cls: "lymph", r: 19, nuc: 0.5, seed: 5 + i * 3, wob: 0.1 }); return { g, hx, hy, tx: 440 + i * 55, ty: 306 + (i % 2) * 10, p: 0, hold: 0, off: i * 0.7 }; });
const bCells = [[345, 150], [400, 115]].map(([hx, hy], i) => { const g = mk("g", {}, LY.cells); cell(g, { cls: "bcell", r: 18, nuc: 0.45, seed: 21 + i * 4, wob: 0.1 }); return { g, hx, hy, tx: 485 + i * 55, ty: 292, p: 0, hold: 0, off: 1 + i * 0.9 }; });
const oligoG = mk("g", {}, LY.cells); cell(oligoG, { cls: "oligo", r: 18, nuc: 0.4, seed: 9, wob: 0.12 });
const microG = mk("g", {}, LY.cells); cell(microG, { cls: "micro", r: 16, nuc: 0.35, seed: 17, wob: 0.2 });

/* ---- particles and impulses ---- */
const cyts = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, LY.parts));
const abds = pool(14, () => abShape(LY.parts));
const imps = Array.from({ length: 6 }, () => { const e = mk("circle", { class: "ms-imp", r: 5 }, LY.imps); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, willBlock: false, entered: false }; });

/* ---- labels and gauges ---- */
let steroidPill, dmtPill;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The nerve fibre";
  [["imm", "Immune attack", "g-imm", "How strongly autoreactive T cells and B cells are attacking myelin inside the brain."], ["leak", "Barrier leak", "g-fl", "How easily immune cells cross the blood-brain barrier into the brain."], ["mye", "Myelin loss", "g-mye", "How much of the myelin sheath has been stripped. The bare segment is the plaque."], ["con", "Conduction", "g-good", "How well the impulse travels along the axon. Bare myelin slows it or blocks it completely."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "T cell", 150, 125, 120, 92, "T cell: an autoreactive T cell activated outside the brain. It crosses the barrier and directs the attack on myelin.");
  pill(ox, "B cell", 352, 142, 310, 92, "B cell: an autoreactive B cell. It crosses the barrier, helps drive inflammation and makes antibodies against myelin.");
  pill(ox, "Blood-brain barrier", 620, 218, 690, 172, "Blood-brain barrier: the tight endothelial lining of brain capillaries. When inflamed it loosens and lets immune cells into the brain.");
  pill(ox, "Oligodendrocyte", 366, 270, 300, 262, "Oligodendrocyte: the cell that makes and maintains the myelin sheath around axons in the brain and spinal cord. It is injured in the attack.");
  pill(ox, "Microglia", 678, 272, 800, 262, "Microglia: the resident immune cell of the brain. Activated microglia and macrophages strip myelin and release inflammatory signals.");
  pill(ox, "Axon", 150, AXY, 115, 285, "Axon: the long nerve fibre that carries the impulse. It survives at first, but is lost over time in progression.");
  pill(ox, "Myelin", 222, AXY - 18, 180, 398, "Myelin: the fatty sheath made by oligodendrocytes. It insulates the axon so the impulse can jump fast from node to node.");
  pill(ox, "Plaque", 488, AXY, 470, 398, "Plaque: a patch of stripped, bare axon left after myelin is destroyed. Conduction fails across it.");
  pill(ox, "Blocked impulse", 560, AXY, 700, 398, "Blocked impulse: without myelin the signal leaks away and cannot jump the bare segment, so it slows or stops. That block causes symptoms in a relapse.");
  steroidPill = pill(ox, "Steroid", 690, 288, 850, 360, "A steroid for relapse calms acute inflammation and barrier leak quickly. It shortens the relapse but does not repair myelin or prevent later damage.");
  dmtPill = pill(ox, "DMT", 560, AXY + 18, 850, 398, "Disease-modifying therapy (DMT): lowers the autoreactive attack and the rate of new plaques over time. It protects the nerve in the long run but does not reverse fixed loss.");
}
const sm = { I: 0.5, L: 0.4, M: 0.4, C: 0.5, ster: 0, dmt: 0 };
const acc = { cyt: 0, abd: 0, imp: 0 };
function init() { initBbb(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.8), k2 = Math.min(1, dt * 1.4);
  sm.I = lerp(sm.I, m.I, k); sm.L = lerp(sm.L, m.L, k); sm.M = lerp(sm.M, m.M, k); sm.C = lerp(sm.C, m.C, k2);
  sm.ster = lerp(sm.ster, m.ster, k2); sm.dmt = lerp(sm.dmt, m.dmt, k2);
  /* barrier cells loosen and drift apart as leak rises */
  bbbCells.forEach((e, i) => { const off = (i % 2 ? 1 : -1) * sm.L * 3.5; place(e.g, e.x + off, 218 + Math.sin(tm / 900 + i) * 0.7, 0, 1); e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + (1 - 0.16 * sm.L).toFixed(3) + " 0.62)"); e.g.style.setProperty("--act", sm.I.toFixed(2)); });
  /* immune cells: cross when the attack is active, drift back when it settles */
  const allCells = tCells.concat(bCells);
  allCells.forEach((c, i) => {
    if (c.hold > 0) { c.hold -= dt; if (c.hold <= 0) c.p = 0; }
    else if (sm.I > 0.28) c.p = clamp(c.p + dt * 0.14 * (0.4 + sm.I));
    else c.p = clamp(c.p - dt * 0.2);
    const e = c.p * c.p * (3 - 2 * c.p), x = lerp(c.hx, c.tx, e) + Math.sin(tm / 700 + c.off * 3) * 3, y = lerp(c.hy, c.ty, e) + Math.cos(tm / 800 + c.off * 2) * 2;
    if (c.p >= 1 && c.hold <= 0) c.hold = 1.6;
    place(c.g, x, y, Math.sin(tm / 500 + i) * 8, 1 + 0.06 * sm.I * Math.sin(tm / 300 + i));
    c.cx = x; c.cy = y;
  });
  /* glia */
  place(oligoG, 380 + Math.sin(tm / 1600) * 2, 282, 0, 1 - 0.18 * sm.M);
  place(microG, 665 + Math.sin(tm / 900) * 3, 285 + Math.cos(tm / 1000) * 2, Math.sin(tm / 700) * 10, 0.7 + 0.5 * sm.I);
  /* myelin thins most at the plaque, plaque glows, axon thins with heavy loss */
  segs.forEach((s) => { const keep = clamp(1 - sm.M * s.v * 0.96, 0.06, 1); s.g.setAttribute("transform", "translate(" + f1(s.x) + " " + AXY + ") scale(" + (0.35 + 0.65 * keep).toFixed(3) + " " + keep.toFixed(3) + ")"); });
  LY.plaque.setAttribute("opacity", (sm.M * 0.4).toFixed(2)); LY.plaque.setAttribute("rx", f1(50 + 90 * sm.M));
  const thin = clamp((sm.M - 0.55) * 1.4); LY.axon.setAttribute("height", f1(8 - 3.5 * thin)); LY.axon.setAttribute("y", f1(AXY - 4 + 1.75 * thin));
  /* inflammatory dots cross the barrier downward */
  acc.cyt += dt * sm.I * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyts), c = pick(allCells); if (p && c) emit(p, c.cx || c.hx, (c.cy || c.hy) + 12, rnd(-5, 5), rnd(18, 30), 0); }
  cyts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 318 || p.t > 4) kill(p); });
  /* antibodies from B cells that have crossed, toward the myelin */
  acc.abd += dt * sm.I * 3.4; while (acc.abd >= 1) { acc.abd--; const p = free(abds), c = pick(bCells); if (p && c && c.p > 0.6) emit(p, c.cx || c.tx, (c.cy || c.ty) + 10, rnd(-4, 8), rnd(10, 18), 0); }
  abds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > AXY - 8 || p.t > 3.5) kill(p); });
  /* impulses run left to right, crawl or block at the bare plaque (x 445 to 585) */
  acc.imp += dt * (0.5 + 0.9 * sm.C + 0.3); while (acc.imp >= 1) { acc.imp--; const q = imps.find((z) => !z.on); if (q) { q.on = true; q.x = 108; q.willBlock = false; q.entered = false; q.e.setAttribute("opacity", "1"); } }
  imps.forEach((q) => { if (!q.on) return; const inPlaque = q.x > 445 && q.x < 585; if (inPlaque && !q.entered) { q.entered = true; q.willBlock = Math.random() < clamp((sm.M - 0.45) * 1.4); }
    const speed = 175 * (inPlaque ? clamp(1 - 0.82 * sm.M) : 1); q.x += speed * dt;
    const fade = q.willBlock && q.x > 470 ? clamp(1 - (q.x - 470) / 45) : 1;
    q.e.setAttribute("cx", f1(q.x)); q.e.setAttribute("cy", f1(AXY + Math.sin(tm / 200 + q.x) * 1.2)); q.e.setAttribute("opacity", fade.toFixed(2));
    if ((q.willBlock && q.x > 515) || q.x > 862) { q.on = false; q.e.setAttribute("opacity", "0"); } });
  /* treatment labels fade in for the chosen treatment */
  steroidPill.style.opacity = sm.ster.toFixed(2); dmtPill.style.opacity = sm.dmt.toFixed(2);
  /* gauges */
  gg.imm.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "moderate", "high"])); gg.leak.set(sm.L, wordOf(sm.L, 0.3, 0.6, ["tight", "leaky", "very leaky"]));
  gg.mye.set(sm.M, wordOf(sm.M, 0.35, 0.65, ["little", "moderate", "extensive"])); gg.con.set(sm.C, wordOf(sm.C, 0.35, 0.65, ["blocked", "slowed", "preserved"]));
}
run({ init, step });
