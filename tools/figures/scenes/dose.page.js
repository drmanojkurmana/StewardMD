/* Dose and response scene: log concentration curves on the left, receptors, ligands, antagonists and cell signal on the right. */
const GX0 = SC.GX0, GX1 = SC.GX1, GY0 = SC.GY0, GY1 = SC.GY1;
const layers = { graph: $("graph"), cellfx: $("cellfx"), parts: $("parts"), over: $("over"), panel: $("panel") };
const REC_X = [575, 639, 703, 767, 831, 895], MEMB_Y = 216;
/* curve maths, shared with the model: a is a relative concentration, logC is its log position on the axis */
function respOf(drug, a) { const Emax = [1, 0.6, 1, 0.45][drug], shift = drug === 2 ? 3.5 : 1; return Emax * a / (0.18 * shift + a); }
function gxOf(logC) { return GX0 + ((logC + 1.6) / 1.9) * (GX1 - GX0); }
function gyOf(r) { return GY1 - r * (GY1 - GY0); }
/* ---- graph: four curves, plateau line, current point, shift and ceiling arrows ---- */
const curves = [], graphEls = {};
function initGraph() {
  const G = layers.graph;
  for (let d = 0; d < 4; d++) { let p = ""; for (let i = 0; i <= 24; i++) { const logC = -1.6 + (i / 24) * 1.9, a = Math.pow(10, logC), x = gxOf(logC), y = gyOf(respOf(d, a)); p += (i ? "L" : "M") + f1(x) + " " + f1(y); } const el = mk("path", { class: "dose-curve dc" + d, d: p, opacity: "0.16" }, G); curves.push(el); }
  graphEls.plateau = mk("path", { class: "dose-plateau", d: "" }, G);
  graphEls.dashX = mk("path", { class: "dose-dash", d: "" }, G);
  graphEls.dashY = mk("path", { class: "dose-dash", d: "" }, G);
  graphEls.marker = mk("circle", { class: "dose-marker", r: 5.5, cx: GX0, cy: GY1 }, G);
  const sh = mk("g", { id: "shiftarr", opacity: "0" }, G);
  mk("path", { class: "dose-arrow", d: "M300 " + f1(gyOf(0.5)) + "H372" }, sh);
  mk("path", { class: "dose-arrow", d: "M364 " + f1(gyOf(0.5) - 5) + "L374 " + f1(gyOf(0.5)) + "L364 " + f1(gyOf(0.5) + 5) }, sh);
  graphEls.shift = sh;
  const lo = mk("g", { id: "lowarr", opacity: "0" }, G);
  mk("path", { class: "dose-arrow", d: "M440 " + f1(gyOf(0.92)) + "V" + f1(gyOf(0.55)) }, lo);
  mk("path", { class: "dose-arrow", d: "M435 " + f1(gyOf(0.62)) + "L440 " + f1(gyOf(0.52)) + "L445 " + f1(gyOf(0.62)) }, lo);
  graphEls.low = lo;
}
/* ---- cell: body, membrane, six receptors with a binding pocket and a separate allosteric site ---- */
const recs = [];
function initCell() {
  const C = layers.cellfx;
  mk("rect", { class: "cell-body", x: 540, y: 115, width: 376, height: 280, rx: 18 }, C);
  graphEls.glow = mk("rect", { class: "cell-glow", x: 540, y: 232, width: 376, height: 163, rx: 18, opacity: "0" }, C);
  mk("rect", { class: "membr", x: 540, y: MEMB_Y - 16, width: 376, height: 32, rx: 8 }, C);
  REC_X.forEach((x, i) => { const g = mk("g", {}, C);
    mk("rect", { class: "rec-stem", x: -5, y: -18, width: 10, height: 36, rx: 4, transform: "translate(" + x + " " + MEMB_Y + ")" }, g);
    const fill = mk("circle", { class: "rec-fill", cx: x, cy: MEMB_Y - 20, r: 5.6, opacity: "0" }, g);
    const pocket = mk("circle", { class: "rec-pocket", cx: x, cy: MEMB_Y - 20, r: 6.8, fill: "none" }, g);
    const allo = mk("rect", { class: "ant-n", x: x + 9, y: MEMB_Y + 2, width: 8, height: 8, rx: 2, opacity: "0", transform: "rotate(45 " + (x + 13) + " " + (MEMB_Y + 6) + ")" }, g);
    recs.push({ g, fill, pocket, allo, x, i, mode: "fill", ring: false }); });
}
/* ---- particle pools: agonist ligands, competitive blockers on the pocket, signal and resting dots inside ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ligs = pool(16, () => mk("circle", { class: "lig-p", r: 3.4 }, layers.parts));
const ants = pool(8, () => mk("rect", { class: "ant-c", x: -4, y: -4, width: 8, height: 8, rx: 2 }, layers.parts));
const sigs = pool(22, () => mk("circle", { class: "sig-p", r: 2.4 }, layers.parts));
const basals = pool(8, () => mk("circle", { class: "basal-p", r: 1.8 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [170, 360, 550, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Binding and response";
  [["bind", "Binding", "g-cyt", "How many receptors have drug bound (occupancy). It rises with concentration and then saturates."], ["resp", "Response", "g-good", "The size of the cell response. It can reach its ceiling before every receptor is bound: spare receptors."], ["ceil", "Ceiling", "g-eos", "The maximum response this drug can reach (efficacy). A partial agonist and a non-competitive antagonist lower it."], ["block", "Block", "g-bad", "How much an antagonist is holding the response back. Competitive block fades as concentration rises; non-competitive block does not."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h + 4, 20, cls, name, tip); });
  const O = layers.over;
  pill(O, "Efficacy", 452, GY0 + 12, 390, 78, "Efficacy: the height of the ceiling (the maximum response). A drug can be potent yet have low efficacy.");
  pill(O, "Potency", 259, gyOf(0.5), 140, 120, "Potency: the position of the curve. Further left means less drug is needed for the same effect. It is not the same as efficacy (the ceiling height).");
  pill(O, "Receptor", REC_X[0], MEMB_Y - 22, 585, 88, "A receptor in the cell membrane. Drug binding in the pocket above the membrane starts a signal inside the cell.");
  pill(O, "Agonist", 765, 145, 795, 88, "Agonist molecules in the fluid outside the cell. Raising the concentration sends more of them onto receptors.");
  const cp = pill(O, "Competitive blocker", REC_X[1], MEMB_Y - 20, 645, 152, "Competitive antagonist: it sits in the same binding pocket without switching the receptor on. More agonist can push it off, so the curve shifts right with the same ceiling.");
  cp.setAttribute("id", "cp-pill");
  const np = pill(O, "Non-competitive blocker", REC_X[5] + 4, MEMB_Y + 8, 835, 152, "Non-competitive antagonist: it binds a separate site and disables the receptor. More agonist cannot restore the response, so the ceiling falls.");
  np.setAttribute("id", "np-pill");
  pill(O, "Cell response", 655, 290, 625, 368, "Signals inside the cell. Their strength follows the response gauge and the glow of the cell interior.");
  pill(O, "Spare receptors", REC_X[5], MEMB_Y + 18, 825, 368, "Spare receptors: the response reaches its ceiling while some receptors are still empty, because one bound receptor is amplified into a large cell signal.");
  capEl = mk("text", { class: "dose-cap", x: 30, y: 428 }, O); capEl.textContent = capText(0, 1);
}
/* one short plain-language line in the stage; it changes with the drug and the level */
let capEl = null, capKey = -1;
function capText(drug, level) {
  if (drug === 1) {
    if (level === 0) return "Little partial agonist bound, and it only half switches receptors on.";
    if (level === 1) return "More partial agonist binds, but each receptor answers weakly.";
    return "Receptors full, yet the response stops at a low ceiling.";
  }
  if (drug === 2) {
    if (level === 0) return "The blocker sits in most pockets, so little drug binds.";
    if (level === 1) return "More drug pushes some blocker off, and the response recovers.";
    return "Plenty of drug pushes the blocker off. Full ceiling returns.";
  }
  if (drug === 3) {
    if (level === 0) return "The blocker plugs receptors shut, so little response is possible.";
    if (level === 1) return "More drug cannot reopen plugged receptors. Response stays small.";
    return "Even plenty of drug cannot lift the lowered ceiling.";
  }
  if (level === 0) return "Little drug, few receptors bound, small response.";
  if (level === 1) return "More drug binds more receptors, so the response climbs.";
  return "Plenty of drug. Receptors full and response at its ceiling.";
}
const sm = { Occ: 0.3, Resp: 0.3, Emax: 1, Block: 0, drug: 0 };
const acc = { lig: 0, ant: 0, sig: 0, bas: 0 };
function init() { initGraph(); initCell(); initPanel(); basals.forEach((p, i) => emit(p, rnd(575, 890), rnd(255, 375), rnd(-5, 5), rnd(-4, 4), i)); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  sm.Occ = lerp(sm.Occ, m.Occ, k1); sm.Resp = lerp(sm.Resp, m.Resp, k1); sm.Emax = lerp(sm.Emax, m.Emax, k1); sm.Block = lerp(sm.Block, m.Block, k1); sm.drug = m.drug;
  const isComp = sm.drug === 2, isNon = sm.drug === 3;
  /* graph: bold active curve, marker at the chosen concentration, ceiling line, teaching arrows */
  curves.forEach((c, d) => { const on = d === sm.drug; c.setAttribute("opacity", on ? "0.95" : "0.15"); c.setAttribute("stroke-width", on ? "3" : "1.6"); });
  const logC = Math.log10(Math.max(0.01, m.a)), mx = gxOf(logC), my = gyOf(sm.Resp);
  graphEls.marker.setAttribute("cx", f1(mx)); graphEls.marker.setAttribute("cy", f1(my));
  graphEls.dashX.setAttribute("d", "M" + f1(mx) + " " + f1(my) + "V" + GY1);
  graphEls.dashY.setAttribute("d", "M" + GX0 + " " + f1(my) + "H" + f1(mx));
  graphEls.plateau.setAttribute("d", "M" + GX0 + " " + f1(gyOf(sm.Emax)) + "H" + GX1);
  graphEls.shift.setAttribute("opacity", isComp ? "0.9" : "0");
  graphEls.low.setAttribute("opacity", (sm.drug === 1 || isNon) ? "0.9" : "0");
  const cl = $("curvelab"); if (cl && cl.textContent !== S.drugNames[sm.drug]) cl.textContent = S.drugNames[sm.drug];
  /* receptors: pocket fills with occupancy; a partial agonist only half switches them on;
   * a competitive blocker rings the pockets it holds; a non-competitive blocker plugs its site */
  recs.forEach((r, i) => { const fill = clamp(sm.Occ * REC_X.length - i, 0, 1);
    const disabled = isNon && i >= 3, ring = isComp && i < Math.ceil(sm.Block * REC_X.length);
    const mode = disabled ? "plug" : "fill";
    if (r.mode !== mode) { r.mode = mode; r.fill.setAttribute("class", disabled ? "rec-plug" : "rec-fill"); }
    if (r.ring !== ring) { r.ring = ring; r.pocket.style.stroke = ring ? "var(--c-comp)" : ""; }
    r.fill.setAttribute("opacity", disabled ? "0.9" : (fill * (sm.drug === 1 ? 0.55 : 1)).toFixed(2));
    r.allo.setAttribute("opacity", disabled ? "0.95" : "0"); r.g.style.opacity = disabled ? 0.45 : 1; });
  if (graphEls.glow) graphEls.glow.setAttribute("opacity", (sm.Resp * 0.3).toFixed(2));
  $("cp-pill").style.opacity = isComp ? 1 : 0; $("np-pill").style.opacity = isNon ? 1 : 0;
  /* agonist ligands drift outside the cell and settle on free pockets, kept inside the cell panel */
  acc.lig += dt * (2 + sm.Occ * 9); while (acc.lig >= 1) { acc.lig--; const p = freeP(ligs); if (p) emit(p, rnd(560, 905), rnd(122, 150), rnd(-5, 5), rnd(9, 16), Math.floor(rnd(0, REC_X.length))); }
  ligs.forEach((p) => { if (!p.on) return; p.t += dt; const want = sm.drug === 1 ? "lig-pp" : "lig-p"; if (p.cls !== want) { p.cls = want; p.e.setAttribute("class", want); }
    const tx = REC_X[p.k], ty = MEMB_Y - 20; p.x += (tx - p.x) * dt * 1.6 + p.vx * dt; p.y += (ty - p.y) * dt * 1.6 + p.vy * dt * 0.3; p.x = clamp(p.x, 548, 908); p.y = clamp(p.y, 120, MEMB_Y - 14);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.t > 3.4 ? clamp(1 - (p.t - 3.4)).toFixed(2) : "1"); if (p.t > 4.4) kill(p); });
  /* competitive blockers sit on pockets, fewer as the agonist concentration rises */
  acc.ant += dt * 5; while (acc.ant >= 1) { acc.ant--; const p = freeP(ants); if (p && isComp) emit(p, rnd(560, 905), rnd(122, 148), 0, 10, Math.floor(rnd(0, REC_X.length))); }
  ants.forEach((p, i) => { if (!p.on) return; if (!isComp) { kill(p); return; } const want = sm.Block * 5; if (i > want + 2) { kill(p); return; } const tx = REC_X[p.k], ty = MEMB_Y - 20; p.x += (tx - p.x) * dt * 2; p.y += (ty - p.y) * dt * 2;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); });
  /* signal dots inside the cell, plus faint resting activity that is always there */
  acc.sig += dt * sm.Resp * 13; while (acc.sig >= 1) { acc.sig--; const p = freeP(sigs); if (p) emit(p, rnd(560, 900), MEMB_Y + 24, rnd(-9, 9), rnd(13, 24), 0); }
  sigs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 550, 906); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y > 382 ? clamp(1 - (p.y - 382) / 12).toFixed(2) : "1"); if (p.y > 394) kill(p); });
  basals.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 552 || p.x > 904) p.vx = -p.vx; if (p.y < 244 || p.y > 386) p.vy = -p.vy; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.2 * Math.sin(tm / 500 + p.k)).toFixed(2)); });
  /* gauges */
  gg.bind.set(sm.Occ, wordOf(sm.Occ, 0.35, 0.65, ["few", "some", "most"])); gg.resp.set(sm.Resp, wordOf(sm.Resp, 0.35, 0.65, ["low", "moderate", "high"]));
  gg.ceil.set(sm.Emax, sm.Emax < 0.7 ? "reduced" : "full"); gg.block.set(sm.Block, wordOf(sm.Block, 0.2, 0.5, ["none", "some", "strong"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
