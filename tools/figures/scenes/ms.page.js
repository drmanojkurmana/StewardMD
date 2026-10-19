/* Multiple sclerosis scene: attack cells cross the barrier, strip myelin, form a plaque and block the signal. Steroid seals the barrier, DMT caps the attack cells. */
const AXY = SC.AXY, WW = SC.W;
const LY = { bbb: $("bbb"), vessel: $("vessel"), brainSlot: $("brainSlot"), lesion: $("lesion"), glow: $("attackGlow"), myelin: $("myelin"), seal: $("seal"), cells: $("cells"), parts: $("parts"), imps: $("imps"), over: $("over"), panel: $("panel"), plaque: $("plaque"), axon: $("axonRect") };
let brainO = null, BP = null, brainDot = [768, 220], vesTrack = null, capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Steroid seals the barrier and calms the attack. The relapse settles and signals get through.";
  if (d === 2) return "Disease modifying therapy blocks the attack cells. Fewer new plaques form and signals survive.";
  if (d === 3) return "Steroid plus disease modifying therapy calm the attack and seal the barrier. Myelin is spared and signals get through.";
  return "No treatment. Attack cells cross the barrier and strip myelin, so the signal blocks.";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }
function dmtCap(parent) { const g = mk("g", { opacity: "0" }, parent); mk("circle", { class: "ms-dmtcap", cx: 0, cy: -14, r: 6 }, g); mk("path", { class: "ms-dmtx", d: "M-4 -18l8 8M4 -18l-8 8" }, g); return g; }

/* ---- blood-brain barrier: a row of flat endothelial cells ---- */
const bbbCells = [];
function initBbb() { for (let i = 0; i < 14; i++) { const g = mk("g", {}, LY.bbb); cell(g, { cls: "endo", r: 13, nuc: 0.3, seed: i + 3, wob: 0.06, n: 8 }); bbbCells.push({ g, x: 38 + i * 42 }); } }

/* ---- myelin segments around the axon ---- */
const SEGX = [150, 225, 300, 375, 450, 525];
const SEGV = [0.12, 0.3, 0.65, 1, 1, 0.55];
const segs = SEGX.map((x) => { const g = mk("g", {}, LY.myelin); mk("rect", { class: "ms-myelin", x: -38, y: -20, width: 76, height: 40, rx: 16 }, g); return { g, x }; });

/* ---- immune and glial cells ---- */
const tCells = [[150, 110], [220, 150], [280, 105]].map(([hx, hy], i) => { const g = mk("g", {}, LY.cells); cell(g, { cls: "lymph", r: 19, nuc: 0.5, seed: 5 + i * 3, wob: 0.1 }); const cap = dmtCap(LY.cells); return { g, cap, hx, hy, tx: 400 + i * 60, ty: 300 + (i % 2) * 10, p: 0, off: i * 0.7 }; });
const bCells = [[350, 140], [405, 105]].map(([hx, hy], i) => { const g = mk("g", {}, LY.cells); cell(g, { cls: "bcell", r: 18, nuc: 0.45, seed: 21 + i * 4, wob: 0.1 }); const cap = dmtCap(LY.cells); return { g, cap, hx, hy, tx: 440 + i * 50, ty: 290 + i * 15, p: 0, off: 1 + i * 0.9 }; });
const oligoG = mk("g", {}, LY.cells); cell(oligoG, { cls: "oligo", r: 18, nuc: 0.4, seed: 9, wob: 0.12 });
const microG = mk("g", {}, LY.cells); cell(microG, { cls: "micro", r: 16, nuc: 0.35, seed: 17, wob: 0.2 });

/* ---- barrier seal ticks that appear with steroid ---- */
const sealTicks = [59, 143, 227, 311, 395, 479, 563].map((x) => mk("rect", { class: "ms-seal", x: f1(x - 3.5), y: 205, width: 7, height: 26, rx: 3.5, opacity: "0" }, LY.seal));

/* ---- particles and impulses ---- */
const cyts = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, LY.parts));
const abds = pool(14, () => abShape(LY.parts));
const vesP = pool(10, () => mk("circle", { class: "sc-p p-cyt", r: 2.6 }, LY.parts));
const imps = Array.from({ length: 6 }, () => { const e = mk("circle", { class: "ms-imp", r: 5 }, LY.imps); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, willBlock: false, entered: false }; });

/* ---- brain organ with lesion markers anchored to its ports ---- */
const lesEls = [];
let actRing = null;
function initOrgans() {
  brainO = organ(LY.brainSlot, "brain", 785, 235, 210, {});
  BP = brainO.ports;
  brainDot = [Math.round(BP.parenchyma[0]), Math.round(BP.parenchyma[1])];
  const spots = [[0, 0, 13], [30, -16, 9], [-28, 18, 7]];
  spots.forEach(([dx, dy, r]) => { const e = mk("ellipse", { class: "ms-lesion", cx: f1(brainDot[0] + dx), cy: f1(brainDot[1] + dy), rx: r, ry: Math.round(r * 0.75) }, LY.lesion); lesEls.push({ e, x: brainDot[0] + dx, y: brainDot[1] + dy }); });
  actRing = mk("circle", { class: "ms-active", cx: f1(brainDot[0] + 30), cy: f1(brainDot[1] - 16), r: 16, opacity: "0" }, LY.lesion);
  const cp = BP.carotid;
  LY.vessel.setAttribute("d", "M527 230 C580 232 640 240 " + f1(cp[0]) + " " + f1(cp[1]));
  vesTrack = track([[527, 230], [580, 232], [640, 240], cp]);
}

/* ---- labels and gauges ---- */
let steroidPill, dmtPill;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The nerve fibre";
  [["imm", "Immune attack", "g-imm", "How strongly autoreactive T cells and B cells are attacking myelin inside the brain."], ["leak", "Barrier leak", "g-fl", "How easily immune cells cross the blood-brain barrier into the brain."], ["mye", "Myelin loss", "g-mye", "How much of the myelin sheath has been stripped. The bare segment is the plaque."], ["con", "Conduction", "g-good", "How well the signal travels along the fibre. Bare myelin slows it or blocks it completely."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "T and B cells", 185, 128, 150, 82, "Attack cells in blood. T cells direct the attack and B cells make antibodies. Both cross the barrier when it loosens.");
  dmtPill = pill(ox, "DMT blocks", 350, 140, 330, 82, "Disease modifying therapy. It blocks attack cells over time, so fewer new plaques form. It does not restore fixed loss.");
  pill(ox, "Barrier", 430, 218, 430, 172, "Blood-brain barrier. The tight vessel lining that normally keeps blood cells out of the brain. Inflammation loosens it.");
  steroidPill = pill(ox, "Steroid seals", 248, 218, 248, 190, "Steroid for relapse. It calms inflammation and seals the barrier quickly. The relapse settles but lost myelin does not regrow.");
  pill(ox, "Brain", brainDot[0], brainDot[1], 810, 108, "The whole brain. Bright spots are lesions where myelin was stripped. Active lesions fade when treatment works.");
  pill(ox, "Myelin", 225, AXY - 20, 170, 400, "Myelin insulation made by oligodendrocytes. It lets the signal jump fast along the fibre.");
  pill(ox, "Plaque", 412, AXY, 330, 400, "Plaque. The bare patch where myelin was stripped by microglia and antibodies. Signals slow or block here.");
  pill(ox, "Nerve signal", 540, AXY, 505, 400, "The travelling signal. It jumps along healthy myelin and dies out across a bare plaque.");
  steroidPill.style.opacity = "0"; dmtPill.style.opacity = "0";
  capEl = mk("text", { class: "ms-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { I: 0.5, L: 0.4, M: 0.4, C: 0.5, ster: 0, dmt: 0 };
const acc = { cyt: 0, abd: 0, imp: 0, ves: 0 };
function init() { initBbb(); initOrgans(); initPanel(); }
function step(dt, m) {
  const kf = Math.min(1, dt * 2.2);
  sm.I = lerp(sm.I, m.I, kf); sm.L = lerp(sm.L, m.L, kf); sm.M = lerp(sm.M, m.M, kf); sm.C = lerp(sm.C, m.C, kf);
  sm.ster = lerp(sm.ster, m.ster, kf); sm.dmt = lerp(sm.dmt, m.dmt, kf);
  /* barrier cells loosen and drift apart as leak rises */
  bbbCells.forEach((e, i) => { const off = (i % 2 ? 1 : -1) * sm.L * 9; place(e.g, e.x + off, 218 + Math.sin(tm / 900 + i) * 0.7, 0, 1); e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + (1 - 0.1 * sm.L).toFixed(3) + " 0.62)"); e.g.style.setProperty("--act", sm.I.toFixed(2)); });
  /* steroid seal ticks close the gaps */
  sealTicks.forEach((s) => s.setAttribute("opacity", sm.ster.toFixed(2)));
  /* immune cells: cross when attack and leak are high, retreat when treatment works */
  const T = clamp((sm.I * 0.65 + sm.L * 0.55 - 0.28) / 0.3, 0, 1);
  const allCells = tCells.concat(bCells);
  allCells.forEach((c, i) => {
    c.p += clamp(T - c.p, -dt * 0.45, dt * 0.45);
    const e = c.p * c.p * (3 - 2 * c.p), x = lerp(c.hx, c.tx, e) + Math.sin(tm / 700 + c.off * 3) * 3, y = lerp(c.hy, c.ty, e) + Math.cos(tm / 800 + c.off * 2) * 2;
    place(c.g, x, y, Math.sin(tm / 500 + i) * 8, 1 + 0.06 * sm.I * Math.sin(tm / 300 + i));
    c.g.style.opacity = (1 - 0.3 * sm.dmt).toFixed(2);
    place(c.cap, x, y, 0, 1); c.cap.setAttribute("opacity", sm.dmt.toFixed(2));
    c.cx = x; c.cy = y;
  });
  /* glia */
  place(oligoG, 300 + Math.sin(tm / 1600) * 2, 282, 0, 1 - 0.25 * sm.M);
  place(microG, 560 + Math.sin(tm / 900) * 3, 288 + Math.cos(tm / 1000) * 2, Math.sin(tm / 700) * 10, 0.7 + 0.5 * sm.I);
  /* myelin thins most at the plaque, plaque grows, glow follows the attack */
  segs.forEach((s, i) => { const keep = clamp(1 - sm.M * SEGV[i], 0.05, 1); s.g.setAttribute("transform", "translate(" + f1(s.x) + " " + AXY + ") scale(" + (0.4 + 0.6 * keep).toFixed(3) + " " + keep.toFixed(3) + ")"); });
  LY.plaque.setAttribute("opacity", (0.25 + 0.5 * sm.M).toFixed(2)); LY.plaque.setAttribute("rx", f1(50 + 90 * sm.M));
  LY.glow.setAttribute("opacity", (0.3 * sm.I).toFixed(2));
  const thin = clamp((sm.M - 0.55) * 1.4); LY.axon.setAttribute("height", f1(8 - 3.5 * thin)); LY.axon.setAttribute("y", f1(AXY - 4 + 1.75 * thin));
  /* brain lesions grow with myelin loss, the active ring fades with treatment */
  lesEls.forEach((o) => place(o.e, o.x, o.y, 0, Math.max(0.05, 0.35 + 0.75 * sm.M)));
  actRing.setAttribute("opacity", clamp((sm.I - 0.35) / 0.3).toFixed(2));
  actRing.setAttribute("r", f1(15 + 3 * Math.sin(tm / 400)));
  /* dots stream along the vessel into the brain organ, slowing to a trickle on treatment */
  acc.ves += dt * 8 * clamp(sm.I * 0.5 + sm.L * 0.5); while (acc.ves >= 1) { acc.ves--; const p = free(vesP); if (p) { emit(p, 0, 0, 0, 0, 0); p.u = 0; } }
  vesP.forEach((p) => { if (!p.on) return; p.u += dt * 90 / vesTrack.len; const q = vesTrack.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) kill(p); });
  /* inflammatory dots spread from crossed cells */
  acc.cyt += dt * sm.I * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyts), c = pick(allCells); if (p && c) emit(p, c.cx || c.hx, (c.cy || c.hy) + 12, rnd(-5, 5), rnd(18, 30), 0); }
  cyts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 400 || p.t > 4) kill(p); });
  /* antibodies from B cells that have crossed, fewer on DMT */
  acc.abd += dt * sm.I * (1 - 0.65 * sm.dmt) * 3.4; while (acc.abd >= 1) { acc.abd--; const p = free(abds), c = pick(bCells); if (p && c && c.p > 0.6) emit(p, c.cx || c.tx, (c.cy || c.ty) + 10, rnd(-4, 8), rnd(10, 18), 0); }
  abds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > AXY - 8 || p.t > 3.5) kill(p); });
  /* impulses run left to right, crawl or block at the bare plaque (x 375 to 450) */
  acc.imp += dt * (0.5 + 0.9 * sm.C + 0.3); while (acc.imp >= 1) { acc.imp--; const q = imps.find((z) => !z.on); if (q) { q.on = true; q.x = 108; q.willBlock = false; q.entered = false; q.e.setAttribute("opacity", "1"); } }
  imps.forEach((q) => { if (!q.on) return; const inPlaque = q.x > 375 && q.x < 450; if (inPlaque && !q.entered) { q.entered = true; q.willBlock = Math.random() < clamp((sm.M - 0.45) * 1.4); }
    const speed = 175 * (inPlaque ? clamp(1 - 0.82 * sm.M) : 1); q.x += speed * dt;
    const fade = q.willBlock && q.x > 395 ? clamp(1 - (q.x - 395) / 45) : 1;
    q.e.setAttribute("cx", f1(q.x)); q.e.setAttribute("cy", f1(AXY + Math.sin(tm / 200 + q.x) * 1.2)); q.e.setAttribute("opacity", fade.toFixed(2));
    if ((q.willBlock && q.x > 440) || q.x > 586) { q.on = false; q.e.setAttribute("opacity", "0"); } });
  /* treatment labels fade in for the chosen treatment */
  steroidPill.style.opacity = sm.ster.toFixed(2); dmtPill.style.opacity = sm.dmt.toFixed(2);
  /* gauges */
  gg.imm.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "moderate", "high"])); gg.leak.set(sm.L, wordOf(sm.L, 0.3, 0.6, ["tight", "leaky", "very leaky"]));
  gg.mye.set(sm.M, wordOf(sm.M, 0.35, 0.65, ["little", "moderate", "extensive"])); gg.con.set(sm.C, wordOf(sm.C, 0.35, 0.65, ["blocked", "slowed", "preserved"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
