/* Pharmacokinetics scene: gut absorption, first pass, plasma binding, tissue distribution, liver and kidney clearance, bile, and the concentration over time curve. */
const WW = SC.W;
const layers = { gut: $("gutdet"), liv: $("livdet"), pla: $("pladet"), tis: $("tisdet"), graph: $("graph"), kid: $("kidet"), bil: $("bildet"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = { enz: [], blocks: null, prots: [], curveRep: null, curveOne: null, halfLine: null, halfDot: null, halfText: null, doseTicks: [], adjPill: null, livWarn: null, kidWarn: null };
const PROT = [[488, 124], [528, 162], [568, 122], [606, 160], [634, 132]];
function initStage() {
  mk("rect", { class: "pk-lumen", x: 42, y: 128, width: 126, height: 38, rx: 10 }, layers.gut);
  mk("path", { class: "pk-wall", d: "M42 128H168M42 166H168" }, layers.gut);
  for (let i = 0; i < 7; i++) mk("path", { class: "pk-wall", d: "M" + (52 + i * 18) + " 128v-8M" + (52 + i * 18) + " 166v8" }, layers.gut);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) { const x = 258 + c * 30, y = 118 + r * 34; mk("circle", { class: "pk-hep", cx: x, cy: y, r: 12 }, layers.liv); const e = mk("circle", { class: "pk-enz", cx: x + 4, cy: y - 3, r: 3 }, layers.liv); E.enz.push(e); }
  const bg = mk("g", {}, layers.liv);
  [[252, 112], [312, 112], [372, 146]].forEach(([x, y]) => { mk("path", { class: "pk-block", d: "M" + (x - 5) + " " + (y - 5) + "L" + (x + 5) + " " + (y + 5) + "M" + (x + 5) + " " + (y - 5) + "L" + (x - 5) + " " + (y + 5) }, bg); });
  E.blocks = bg;
  PROT.forEach(([x, y]) => { mk("circle", { class: "pk-prot", cx: x, cy: y, r: 11 }, layers.pla); E.prots.push([x, y]); });
  [[742, 122], [792, 158], [842, 120], [892, 156], [768, 168], [872, 104]].forEach(([x, y]) => mk("circle", { class: "pk-tcell", cx: x, cy: y, r: 15 }, layers.tis));
  E.livWarn = mk("circle", { class: "pk-hdot", cx: 386, cy: 106, r: 6, opacity: "0" }, layers.liv);
  /* concentration graph */
  const G = layers.graph;
  mk("line", { class: "pk-axis", x1: 62, y1: 270, x2: 62, y2: 382 }, G); mk("line", { class: "pk-axis", x1: 62, y1: 382, x2: 442, y2: 382 }, G);
  mk("line", { class: "pk-grid", x1: 62, y1: 326, x2: 442, y2: 326 }, G);
  const yt = mk("text", { class: "sc-lab", x: 50, y: 326, "text-anchor": "middle", transform: "rotate(-90 50 326)" }, G); yt.textContent = "concentration";
  const xt = mk("text", { class: "sc-lab", x: 442, y: 398, "text-anchor": "end" }, G); xt.textContent = "time";
  E.curveOne = mk("path", { class: "pk-curve2", d: "" }, G); E.curveRep = mk("path", { class: "pk-curve1", d: "" }, G);
  E.halfLine = mk("line", { class: "pk-half", x1: 100, y1: 290, x2: 100, y2: 382 }, G); E.halfDot = mk("circle", { class: "pk-hdot", cx: 100, cy: 320, r: 3.4 }, G);
  E.halfText = mk("text", { class: "sc-lab", x: 106, y: 374 }, G); E.halfText.textContent = "half-life";
  mk("line", { class: "pk-curve1", x1: 330, y1: 274, x2: 358, y2: 274 }, G); const l1 = mk("text", { class: "sc-lab", x: 364, y: 278 }, G); l1.textContent = "repeated";
  mk("line", { class: "pk-curve2", x1: 330, y1: 290, x2: 358, y2: 290 }, G); const l2 = mk("text", { class: "sc-lab", x: 364, y: 294 }, G); l2.textContent = "one dose";
  for (let i = 0; i < 6; i++) E.doseTicks.push(mk("line", { class: "pk-dose", x1: 62, y1: 382, x2: 62, y2: 388 }, G));
  /* kidney and bile details */
  mk("ellipse", { class: "pk-node pk-kidney", cx: 595, cy: 312, rx: 50, ry: 44 }, layers.kid);
  mk("path", { class: "pk-tube", d: "M595 356V396" }, layers.kid);
  const kt = mk("text", { class: "sc-lab", x: 608, y: 402 }, layers.kid); kt.textContent = "urine";
  E.kidWarn = mk("circle", { class: "pk-hdot", cx: 672, cy: 268, r: 6, opacity: "0" }, layers.kid);
  mk("path", { class: "pk-duct", d: "M752 302H886V352" }, layers.bil);
  mk("rect", { class: "pk-lumen", x: 760, y: 356, width: 150, height: 30, rx: 9 }, layers.bil);
  const bt = mk("text", { class: "sc-lab", x: 835, y: 402, "text-anchor": "middle" }, layers.bil); bt.textContent = "to gut and faeces";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, tx: 0, ty: 0 }; }); }
const absP = pool(18, () => mk("circle", { class: "sc-p p-drug", r: 3.2 }, layers.parts));
const plaP = pool(22, () => mk("circle", { class: "sc-p p-drug", r: 3.2 }, layers.parts));
const metP = pool(12, () => mk("circle", { class: "sc-p p-metab", r: 2.8 }, layers.parts));
const uriP = pool(12, () => mk("circle", { class: "sc-p p-urine", r: 2.8 }, layers.parts));
const bilP = pool(10, () => mk("circle", { class: "sc-p p-bilep", r: 2.8 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const absTrack = track([[58, 147], [172, 147], [228, 147], [315, 140], [398, 147], [468, 147]]);
function spawnPlasma(x, y) { const p = freeP(plaP); if (!p) return; emit(p, x, y, 0); p.vx = rnd(-16, 16); p.vy = rnd(-10, 10); p.t = rnd(0.4, 1.4); }
function spawnMetab(x, y) { const p = freeP(metP); if (p) { emit(p, x, y, 0); p.vy = rnd(8, 16); } }
function spawnUrine() { const p = freeP(uriP); if (p) emit(p, 595 + rnd(-14, 14), 276, 0); }
function spawnBile() { const p = freeP(bilP); if (p) emit(p, 756, 302, 0); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, xs = [95, 245, 395, 545, 695, 845];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "How the body handles the drug";
  [["abs", "Absorption", "g-drug", "How much of the dose reaches the systemic blood. Oral dosing loses some drug to first-pass metabolism in the gut wall and liver; intravenous dosing reaches the blood in full."],
    ["free", "Free drug", "g-prot", "The share of plasma drug that is not bound to plasma protein. Only free drug leaves the blood, enters tissues, acts and is cleared. Liver impairment lowers protein and raises the free share."],
    ["met", "Liver metab.", "g-liv", "Liver metabolism: enzymes change drug into metabolites. Inducers speed this up, inhibitors slow it down, and liver impairment reduces it."],
    ["kid", "Kidney excr.", "g-kid", "Kidney excretion of drug into urine. Kidney impairment slows this route, so drug stays in the body longer."],
    ["hl", "Half-life", "g-bad", "The time for the plasma concentration to fall by half. It lengthens when total clearance falls and shortens when clearance rises."],
    ["auc", "Exposure", "g-cyt", "Overall exposure to the drug over time. It rises with higher bioavailability and lower clearance, and falls when metabolism is induced or the regimen is adjusted."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, 52, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Gut wall", 105, 92, 105, 74, "Gut wall: an oral dose crosses from the gut lumen into portal blood. Some drug is metabolised in the wall on the way.");
  pill(ox, "Liver", 315, 92, 315, 74, "Liver: portal blood passes through the liver first, so part of an oral dose is removed before it reaches the body (first-pass metabolism). The liver also metabolises drug returning in the systemic blood.");
  pill(ox, "Plasma", 550, 92, 550, 74, "Plasma: drug in the blood is bound to plasma protein or free. Bound drug is a store; free drug can leave the blood, act and be cleared.");
  pill(ox, "Tissues", 815, 92, 815, 74, "Tissues: free drug moves from plasma into tissues and back again. This distribution, with clearance, shapes how long drug stays in the plasma.");
  pill(ox, "Level over time", 245, 250, 245, 236, "Plasma concentration over time. The dashed curve is one dose falling with its half-life. The solid curve is repeated dosing rising until intake and clearance balance at a steady state.");
  pill(ox, "Kidney", 595, 250, 595, 236, "Kidney: drug is excreted from the blood into urine. Kidney impairment slows this, prolongs half-life and raises exposure unless the regimen is adjusted.");
  pill(ox, "Bile", 830, 250, 830, 236, "Bile: the liver also puts some drug and metabolites into bile, which reaches the gut and leaves in faeces. This is a smaller route than metabolism and kidney excretion here.");
  E.adjPill = pill(ox, "Adjusted dosing", 240, 388, 150, 398, "Renal impairment adjustment: the regimen is adjusted (for example doses spaced further apart) so exposure returns toward usual despite slow kidney excretion.");
  E.adjPill.style.opacity = "0";
}
const sm = { bio: 0.58, firstPass: 0.42, metab: 0.62, renal: 0.62, bile: 0.32, freeF: 0.28, doseRate: 1, clTot: 0.59, ke: 2.08, hl: 0.55, peak: 0.46, auc: 0.38, steady: 0.39, iv: 0, liverImp: 0, kidneyImp: 0, inducer: 0, inhibitor: 0, renalAdj: 0 };
const KEYS = Object.keys(sm);
const acc = { abs: 0, pla: 0, uri: 0, bil: 0 };
function concAt(tt, doses, m) {
  let c = 0;
  for (let i = 0; i < doses.length; i++) { const tau = (tt - doses[i]) * 2.2; if (tau < 0) continue; const shape = m.iv > 0.5 ? 1 : (1 - Math.exp(-tau * 5)); c += m.peak * shape * Math.exp(-m.ke * tau); }
  return c;
}
function drawGraph() {
  const x0 = 62, x1 = 442, yb = 382, yt = 268, N = 64;
  const interval = sm.renalAdj > 0.5 ? 0.30 : 0.20;
  const doses = []; for (let d = 0; d < 1; d += interval) doses.push(d);
  let dRep = "", dOne = "", halfX = x0, halfY = yb, peakOne = 0; const one = [];
  for (let i = 0; i < N; i++) { const tt = i / (N - 1); one.push(concAt(tt, [0], sm)); if (one[i] > peakOne) peakOne = one[i]; }
  for (let i = 0; i < N; i++) { const tt = i / (N - 1), xr = x0 + tt * (x1 - x0);
    const yR = yb - clamp(concAt(tt, doses, sm) / 1.3) * (yb - yt), yO = yb - clamp(one[i] / 1.3) * (yb - yt);
    dRep += (i ? "L" : "M") + f1(xr) + " " + f1(yR); dOne += (i ? "L" : "M") + f1(xr) + " " + f1(yO); }
  E.curveRep.setAttribute("d", dRep); E.curveOne.setAttribute("d", dOne);
  const tPk = sm.iv > 0.5 ? 0 : 0.05, tHalf = Math.min(0.92, tPk + 0.315 / Math.max(0.4, sm.ke));
  halfX = x0 + tHalf * (x1 - x0); halfY = yb - clamp((peakOne * 0.5) / 1.3) * (yb - yt);
  E.halfLine.setAttribute("x1", f1(halfX)); E.halfLine.setAttribute("x2", f1(halfX)); E.halfLine.setAttribute("y1", f1(halfY));
  E.halfDot.setAttribute("cx", f1(halfX)); E.halfDot.setAttribute("cy", f1(halfY));
  E.halfText.setAttribute("x", f1(Math.min(388, halfX + 6)));
  E.doseTicks.forEach((tk, i) => { if (i < doses.length) { const dx = x0 + doses[i] * (x1 - x0); tk.setAttribute("x1", f1(dx)); tk.setAttribute("x2", f1(dx)); tk.setAttribute("opacity", "1"); } else tk.setAttribute("opacity", "0"); });
}
function init() { initStage(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  layers.gut.style.opacity = sm.iv > 0.5 ? "0.35" : "1";
  layers.liv.style.opacity = sm.liverImp > 0.5 ? "0.82" : "1";
  E.blocks.style.opacity = sm.inhibitor.toFixed(2);
  E.enz.forEach((e, i) => e.setAttribute("opacity", clamp(0.25 + 0.75 * (sm.inducer > 0.5 ? 1 : sm.inhibitor > 0.5 ? 0.3 : 0.65)).toFixed(2)));
  E.livWarn.setAttribute("opacity", sm.liverImp.toFixed(2)); E.kidWarn.setAttribute("opacity", sm.kidneyImp.toFixed(2));
  if (E.adjPill) { E.adjPill.style.opacity = sm.renalAdj.toFixed(2); E.adjPill.style.pointerEvents = sm.renalAdj < 0.05 ? "none" : "auto"; }
  drawGraph();
  /* absorption: oral particles ride the gut to liver to plasma; intravenous particles enter plasma directly */
  if (sm.iv > 0.5) { acc.pla += dt * 3.2; while (acc.pla >= 1) { acc.pla--; spawnPlasma(rnd(470, 620), 100); } }
  else { acc.abs += dt * (1.2 + 2.2 * sm.bio) * sm.doseRate; while (acc.abs >= 1) { acc.abs--; const p = freeP(absP); if (p) { emit(p, 58, 147, 0); p.u = 0; p.k = 0; } } }
  absP.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; const q = absTrack.at(clamp(p.u)); p.x = q.x; p.y = q.y + Math.sin(tm / 300 + p.u * 20) * 2;
    if (p.k === 0 && q.x > 300) { p.k = 1; if (Math.random() < sm.firstPass) { spawnMetab(p.x, p.y); kill(p); return; } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { kill(p); spawnPlasma(472, 147); } });
  /* plasma: bound store, free roaming, tissue exchange and clearance exits */
  plaP.forEach((p) => { if (!p.on) return; p.t -= dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 462 || p.x > 638) p.vx *= -1; if (p.y < 104 || p.y > 180) p.vy *= -1; p.x = clamp(p.x, 462, 638); p.y = clamp(p.y, 104, 180);
      if (p.t <= 0) { const roll = Math.random();
        if (roll < (1 - sm.freeF) * 0.55) { p.k = 1; const pr = pick(E.prots); p.tx = pr[0] + rnd(-6, 6); p.ty = pr[1] + rnd(-6, 6); p.t = rnd(0.8, 1.8); }
        else if (roll < 0.72) { p.k = 2; p.tx = rnd(720, 912); p.ty = rnd(112, 178); }
        else { const tot = sm.metab + sm.renal + sm.bile + 0.001, rr = Math.random() * tot; if (rr < sm.metab) { p.k = 5; p.tx = 392; p.ty = 158; } else if (rr < sm.metab + sm.renal) { p.k = 6; p.tx = 595; p.ty = 252; } else { p.k = 7; p.tx = 392; p.ty = 158; } p.t = 4; } } }
    else if (p.k === 1) { p.x = lerp(p.x, p.tx, Math.min(1, dt * 6)); p.y = lerp(p.y, p.ty, Math.min(1, dt * 6)); if (p.t <= 0) { p.k = 0; p.t = rnd(0.3, 1); p.vx = rnd(-16, 16); p.vy = rnd(-10, 10); } }
    else if (p.k === 2 || p.k === 4 || p.k === 5 || p.k === 6 || p.k === 7) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1, sp = p.k === 2 || p.k === 4 ? 90 : 75; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt;
      if (d < 8) { if (p.k === 2) { p.k = 3; p.t = rnd(1, 2.2); } else if (p.k === 4) { p.k = 0; p.t = rnd(0.3, 1.2); p.x = clamp(p.x, 462, 638); } else if (p.k === 5) { spawnMetab(p.x, p.y); kill(p); return; } else if (p.k === 6) { spawnUrine(); kill(p); return; } else { spawnMetab(p.x, p.y); spawnBile(); kill(p); return; } } }
    else if (p.k === 3) { p.x += Math.sin(tm / 400 + p.y) * 8 * dt; p.y += Math.cos(tm / 500 + p.x) * 6 * dt; p.x = clamp(p.x, 712, 920); p.y = clamp(p.y, 104, 182); if (p.t <= 0) { p.k = 4; p.tx = rnd(500, 620); p.ty = rnd(115, 175); } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* clearance products */
  metP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.t * 4) * 4 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 238, 392)) + " " + f1(clamp(p.y, 100, 196)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.uri += dt * sm.renal * 1.4; while (acc.uri >= 1) { acc.uri--; if (Math.random() < 0.6) spawnUrine(); }
  uriP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += 34 * dt; p.x = lerp(p.x, 595, Math.min(1, dt * 3)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, 258, 402)) + ")"); if (p.y > 400) kill(p); });
  acc.bil += dt * sm.bile * 1.1; while (acc.bil >= 1) { acc.bil--; if (Math.random() < 0.6) spawnBile(); }
  bilP.forEach((p) => { if (!p.on) return; p.t += dt; if (p.x < 886) p.x += 55 * dt; else if (p.y < 366) p.y += 45 * dt; else p.x += 30 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 738, 922)) + " " + f1(clamp(p.y, 258, 392)) + ")"); if (p.x > 918 && p.y >= 366) kill(p); });
  /* gauges */
  gg.abs.set(sm.bio, wordOf(sm.bio, 0.65, 0.9, ["partial", "high", "complete"])); gg.free.set(sm.freeF, wordOf(sm.freeF, 0.32, 0.42, ["low", "usual", "high"])); gg.met.set(sm.metab, wordOf(sm.metab, 0.3, 0.6, ["low", "usual", "high"]));
  gg.kid.set(sm.renal, wordOf(sm.renal, 0.3, 0.6, ["low", "usual", "high"])); gg.hl.set(sm.hl, wordOf(sm.hl, 0.38, 0.68, ["short", "usual", "long"])); gg.auc.set(sm.auc, wordOf(sm.auc, 0.32, 0.58, ["low", "usual", "high"]));
}
run({ init, step });
