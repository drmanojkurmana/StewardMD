/* Electron transport chain scene: fuel donors, complexes I to IV, proton pool, ATP synthase, oxygen to water, blockers, leak and heat. */
const etcL = { res: $("etcRes"), unc: $("etcUnc"), parts: $("etcParts"), over: $("etcOver"), panel: $("etcPanel"), rotor: $("etcRotor"), pool: $("etcPool"), dim1: $("etcDim1"), dim4: $("etcDim4"), dimS: $("etcDimS") };
const etcCX = SC.CX;
const etcETrack = track([[230, 240], [370, 240], [510, 240], [650, 240]]);
const etcATrack = track([[760, 305], [825, 330], [902, 344]]);
function etcPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, s: 1, tx: 0, ty: 0 }; }); }
const etcFree = (pl) => pl.find((p) => !p.on);
function etcEmit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function etcKill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const etcElecs = etcPool(22, () => mk("circle", { class: "p-elec", r: 3 }, etcL.parts));
const etcNadh = etcPool(12, () => mk("circle", { class: "p-nadh", r: 3.4 }, etcL.parts));
const etcFadh = etcPool(10, () => mk("rect", { class: "p-fadh", x: -3, y: -3, width: 6, height: 6, rx: 1.2 }, etcL.parts));
const etcPump = etcPool(20, () => mk("circle", { class: "p-prot", r: 2.8 }, etcL.parts));
const etcBack = etcPool(14, () => mk("circle", { class: "p-prot", r: 2.8 }, etcL.parts));
const etcLeak = etcPool(14, () => mk("circle", { class: "p-prot", r: 2.8 }, etcL.parts));
const etcAtpP = etcPool(16, () => mk("circle", { class: "p-atpp", r: 3.4 }, etcL.parts));
const etcO2P = etcPool(12, () => mk("circle", { class: "p-o2p", r: 3.2 }, etcL.parts));
const etcWat = etcPool(10, () => mk("path", { class: "p-water", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, etcL.parts));
const etcHeatP = etcPool(10, () => mk("path", { class: "p-heatp", d: "M0 6 Q-4 0 0 -6 Q4 0 0 6" }, etcL.parts));
const etcAntP = etcPool(8, () => mk("circle", { class: "p-ant", r: 3 }, etcL.parts));
const etcResDots = [], etcUncDots = [], etcBlk = {};
let etcPillBlock = null, etcPillLeak = null, etcCap = null, etcCapKey = "";
function capText(t, d) {
  if (t === 1 && d === 2) return "Antidote clears the blockers. Flow restarts and ATP recovers.";
  if (t === 2 && d === 2) return "Antidote plugs the leak. The pool refills and ATP recovers.";
  if (t === 1) return d === 1 ? "Extra oxygen helps a little, but the blockers still hold the chain." : "No treatment. Blockers sit on the chain and ATP runs down.";
  if (t === 2) return d === 1 ? "Extra oxygen feeds the burn, but ATP stays low while the leak is open." : "No treatment. Protons leak back and energy escapes as heat.";
  if (d === 1) return "Extra oxygen. The healthy chain already runs well.";
  if (d === 2) return "No poison to clear. The chain runs as normal.";
  return "No poison. Fuel flows through the chain and the pool drives ATP.";
}
function etcBlock(id, x, y) { const g = mk("g", { opacity: "0" }, etcL.over); mk("circle", { class: "etc-blk-c", cx: x, cy: y, r: 9 }, g); mk("path", { class: "etc-blk-l", fill: "none", d: "M" + (x - 4.5) + " " + (y - 4.5) + "L" + (x + 4.5) + " " + (y + 4.5) + "M" + (x + 4.5) + " " + (y - 4.5) + "L" + (x - 4.5) + " " + (y + 4.5) }, g); etcBlk[id] = g; }
const etcGG = {};
function etcInit() {
  for (let r = 0; r < 2; r++) for (let i = 0; i < 15; i++) { const c = mk("circle", { class: "p-prot", r: 2.8, cx: 172 + i * 42 + r * 18, cy: 104 + r * 20, opacity: "0" }, etcL.res); etcResDots.push(c); }
  for (let i = 0; i < 8; i++) { const c = mk("circle", { class: "p-prot", r: 2.6, cx: 200 + i * 72, cy: 174, opacity: "0" }, etcL.res); etcResDots.push(c); }
  [180, 285, 425, 565, 705].forEach((x) => { const c = mk("circle", { class: "etc-uncdot", cx: x, cy: 240, r: 8, opacity: "0" }, etcL.unc); etcUncDots.push(c); });
  etcBlock("rot", 230, 212); etcBlock("cya", 650, 212); etcBlock("oli", 760, 212);
  const O = etcL.over;
  pill(O, "Fuel in", 255, 348, 200, 392, "Fuel from food. NADH feeds complex I and FADH2 feeds complex II.");
  pill(O, "Chain I-IV", 370, 212, 300, 74, "The chain. Electrons pass from complex to complex along the inner membrane.");
  pill(O, "Proton pool", 500, 112, 500, 74, "Protons pumped up here. Their return through ATP synthase makes ATP.");
  pill(O, "Oxygen in", 672, 200, 770, 74, "Oxygen waits at complex IV. It takes the spent electrons and joins protons to form water.");
  pill(O, "ATP maker", 742, 286, 640, 392, "ATP synthase. Returning protons spin its rotor and it builds ATP.");
  pill(O, "ATP out", 845, 330, 830, 392, "Fresh ATP leaves the mitochondrion to power the cell.");
  etcPillBlock = pill(O, "Blockers", 230, 205, 130, 150, "Blockers sit on complexes I and IV and on ATP synthase. Flow stalls and ATP runs down.");
  etcPillLeak = pill(O, "Leak", 440, 240, 440, 180, "The leak. Protons slip back across the membrane, so the pool drains as heat.");
  etcPillBlock.style.opacity = "0"; etcPillBlock.style.pointerEvents = "none";
  etcPillLeak.style.opacity = "0"; etcPillLeak.style.pointerEvents = "none";
  etcCap = mk("text", { class: "etc-cap", x: 30, y: 428 }, O); etcCap.textContent = capText(0, 0);
  const P = etcL.panel, y0 = 478, h = 52, xs = [140, 320, 500, 680, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The mitochondrion";
  [["ef", "Electron flow", "g-elec", "How fast electrons move from NADH and FADH2 through the complexes to oxygen."], ["pg", "Proton gradient", "g-fl", "How many protons are held in the intermembrane space compared with the matrix."], ["atp", "ATP made", "g-atp", "How fast ATP synthase makes ATP for the cell."], ["oxy", "Oxygen used", "g-oxy", "How fast oxygen is used as the final electron acceptor at complex IV."], ["heat", "Heat", "g-heat", "Energy released as heat. An uncoupler turns the proton gradient into heat instead of ATP."]]
    .forEach(([id, name, cls, tip], i) => { etcGG[id] = gauge(P, xs[i], y0 + 2, h - 18, 20, cls, name, tip); });
}
const etcSm = { E: 0.7, G: 0.7, A: 0.7, O: 0.7, Heat: 0.2, inh: 0, unc: 0, oxy: 0.35, ant: 0 };
const etcAcc = { elec: 0, nadh: 0, fadh: 0, pump: 0, back: 0, leak: 0, atp: 0, o2: 0, wat: 0, heat: 0, ant: 0 };
function etcStep(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  etcSm.E = lerp(etcSm.E, m.E, k2); etcSm.G = lerp(etcSm.G, m.G, k2); etcSm.A = lerp(etcSm.A, m.A, k2); etcSm.O = lerp(etcSm.O, m.O, k2); etcSm.Heat = lerp(etcSm.Heat, m.Heat, k2); etcSm.inh = lerp(etcSm.inh, m.inh, k1); etcSm.unc = lerp(etcSm.unc, m.unc, k1); etcSm.oxy = lerp(etcSm.oxy, m.oxy, k1); etcSm.ant = lerp(etcSm.ant, m.ant, k1);
  etcL.pool.setAttribute("opacity", (0.04 + 0.5 * etcSm.G).toFixed(2));
  const dim = (0.55 * etcSm.inh).toFixed(2);
  etcL.dim1.setAttribute("opacity", dim); etcL.dim4.setAttribute("opacity", dim); etcL.dimS.setAttribute("opacity", dim);
  etcResDots.forEach((c, i) => { const th = (i + 1) / etcResDots.length; c.setAttribute("opacity", clamp((etcSm.G - th * 0.85) * 5).toFixed(2)); });
  etcUncDots.forEach((c) => c.setAttribute("opacity", etcSm.unc.toFixed(2)));
  Object.keys(etcBlk).forEach((id) => etcBlk[id].setAttribute("opacity", etcSm.inh.toFixed(2)));
  etcPillBlock.style.opacity = etcSm.inh.toFixed(2); etcPillLeak.style.opacity = etcSm.unc.toFixed(2);
  etcPillBlock.style.pointerEvents = etcSm.inh > 0.4 ? "auto" : "none";
  etcPillLeak.style.pointerEvents = etcSm.unc > 0.4 ? "auto" : "none";
  etcL.rotor.setAttribute("transform", "rotate(" + f1((tm / 6 * clamp(etcSm.A * 1.4)) % 360) + " 760 284)");
  /* donors in the matrix move to their complex */
  etcAcc.nadh += dt * (0.5 + etcSm.E * 3.2); while (etcAcc.nadh >= 1) { etcAcc.nadh--; const p = etcFree(etcNadh); if (p) { etcEmit(p, rnd(150, 262), rnd(336, 364)); p.tx = 230; p.ty = 272; } }
  etcNadh.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 44 * dt; p.y += (dy / d) * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 7) etcKill(p); });
  etcAcc.fadh += dt * (0.4 + etcSm.E * 2.4); while (etcAcc.fadh >= 1) { etcAcc.fadh--; const p = etcFree(etcFadh); if (p) { etcEmit(p, rnd(312, 428), rnd(336, 364)); p.tx = 370; p.ty = 272; } }
  etcFadh.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 44 * dt; p.y += (dy / d) * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 7) etcKill(p); });
  /* electrons along the membrane, entering at I or at II */
  etcAcc.elec += dt * (0.4 + etcSm.E * 5); while (etcAcc.elec >= 1) { etcAcc.elec--; const p = etcFree(etcElecs); if (p) { const fromII = Math.random() < 0.35; etcEmit(p, 0, 0, fromII ? 1 : 0); p.u = fromII ? 140 / 420 : 0; } }
  etcElecs.forEach((p) => { if (!p.on) return; p.u += dt * 0.22 * (0.35 + etcSm.E); const q = etcETrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y + Math.sin(tm / 180 + p.u * 9) * 2.5) + ")"); if (p.u >= 1) etcKill(p); });
  /* protons pumped at I, III and IV from matrix to intermembrane space */
  etcAcc.pump += dt * etcSm.E * (1 - etcSm.inh * 0.6) * 5; while (etcAcc.pump >= 1) { etcAcc.pump--; const p = etcFree(etcPump); if (p) { const cx = pick([230, 510, 650]); etcEmit(p, cx + rnd(-9, 9), 272); p.tx = cx + rnd(-12, 12); p.ty = rnd(100, 132); } }
  etcPump.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 56 * dt; p.y += (dy / d) * 56 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 7) etcKill(p); });
  /* protons return through ATP synthase */
  etcAcc.back += dt * (0.3 + etcSm.A * 5); while (etcAcc.back >= 1) { etcAcc.back--; const p = etcFree(etcBack); if (p) { etcEmit(p, 760 + rnd(-7, 7), 176); p.tx = 760; p.ty = 288; } }
  etcBack.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 68 * dt; p.y += (dy / d) * 68 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 7) etcKill(p); });
  /* uncoupler leak straight back across the membrane */
  etcAcc.leak += dt * etcSm.unc * 7; while (etcAcc.leak >= 1) { etcAcc.leak--; const p = etcFree(etcLeak); if (p) { etcEmit(p, rnd(175, 720), 176); p.tx = p.x; p.ty = rnd(292, 318); } }
  etcLeak.forEach((p) => { if (!p.on) return; p.y += 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 240) / 90).toFixed(2)); if (p.y > p.ty) etcKill(p); });
  /* ATP leaves the synthase head for the cytosol */
  etcAcc.atp += dt * (0.2 + etcSm.A * 3.4); while (etcAcc.atp >= 1) { etcAcc.atp--; const p = etcFree(etcAtpP); if (p) { etcEmit(p, 760, 305); p.u = 0; } }
  etcAtpP.forEach((p) => { if (!p.on) return; p.u += dt * 0.3; const q = etcATrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", p.u > 0.85 ? clamp(1 - (p.u - 0.85) / 0.15).toFixed(2) : "1"); if (p.u >= 1) etcKill(p); });
  /* oxygen from the cytosol to complex IV, then water into the matrix */
  etcAcc.o2 += dt * (0.8 + etcSm.O * 3 + etcSm.oxy * 1.6); while (etcAcc.o2 >= 1) { etcAcc.o2--; const p = etcFree(etcO2P); if (p) { etcEmit(p, 908, rnd(148, 176)); p.tx = 668; p.ty = 204; } }
  etcO2P.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 72 * dt; p.y += (dy / d) * 72 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8) etcKill(p); });
  etcAcc.wat += dt * etcSm.O * 3; while (etcAcc.wat >= 1) { etcAcc.wat--; const p = etcFree(etcWat); if (p) etcEmit(p, 650 + rnd(-8, 8), 274); }
  etcWat.forEach((p) => { if (!p.on) return; p.y += 42 * dt; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) etcKill(p); });
  /* heat rises off the membrane, mostly with an uncoupler */
  etcAcc.heat += dt * (0.3 + etcSm.Heat * 5); while (etcAcc.heat >= 1) { etcAcc.heat--; const p = etcFree(etcHeatP); if (p) { etcEmit(p, rnd(175, 790), 224); p.t = 0; } }
  etcHeatP.forEach((p) => { if (!p.on) return; p.t += dt; p.y -= 36 * dt; p.x += Math.sin(tm / 220 + p.t * 4) * 12 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 150, 815)) + " " + f1(Math.max(92, p.y)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3 || p.y < 94) etcKill(p); });
  /* antidote particles travel to the blocked sites or the leak */
  etcAcc.ant += dt * etcSm.ant * 3.4; while (etcAcc.ant >= 1) { etcAcc.ant--; const p = etcFree(etcAntP); if (p) { etcEmit(p, 48, 182); const tgt = m.t === 1 ? pick([[230, 212], [650, 212], [760, 212]]) : [440, 240]; p.tx = tgt[0]; p.ty = tgt[1]; } }
  etcAntP.forEach((p) => { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 76 * dt; p.y += (dy / d) * 76 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 9) etcKill(p); });
  etcGG.ef.set(etcSm.E, wordOf(etcSm.E, 0.3, 0.6, ["low", "moderate", "high"])); etcGG.pg.set(etcSm.G, wordOf(etcSm.G, 0.3, 0.6, ["low", "moderate", "high"])); etcGG.atp.set(etcSm.A, wordOf(etcSm.A, 0.3, 0.6, ["low", "moderate", "high"])); etcGG.oxy.set(etcSm.O, wordOf(etcSm.O, 0.3, 0.6, ["low", "moderate", "high"])); etcGG.heat.set(etcSm.Heat, wordOf(etcSm.Heat, 0.3, 0.6, ["low", "moderate", "high"]));
  const key = m.t + ":" + drug;
  if (key !== etcCapKey) { etcCapKey = key; const t = capText(m.t, drug); if (etcCap.textContent !== t) etcCap.textContent = t; }
}
run({ init: etcInit, step: etcStep });
