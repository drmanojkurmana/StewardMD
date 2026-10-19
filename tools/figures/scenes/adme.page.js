/* Pharmacokinetics scene: gut absorption, first pass, plasma binding, tissue spread, liver and kidney clearance, bile, and levels over time. */
const WW = SC.W;
const layers = { enz: $("enz"), block: $("block"), prot: $("prot"), tcells: $("tcells"), graph: $("graph"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = { enz: [], blocks: [], prots: [], curveRep: null, curveOne: null, aucFill: null, halfLine: null, halfDot: null, halfText: null, doseTicks: [], intArrow: null, intL: null, intR: null, capEl: null, capKey: "" };
let gutO = null, liverO = null, kidneyO = null;
let trGutLiver = null, trBile = null;
const ENZ_OFF = [[-60, -10], [-30, -25], [0, -5], [30, -20], [60, -5], [-45, 15], [15, 25]];
const PROT = [[530, 140], [575, 178], [620, 140]];
const TCELL = [[535, 292], [580, 292], [625, 292]];
function capText(d, l) {
  let s;
  if (d === 1) s = "Enzyme inducer speeds liver breakdown. More drug is cleared and levels fall.";
  else if (d === 2) s = "Enzyme blocker sits on liver enzymes. Less is broken down and levels stay high.";
  else if (d === 3) s = "Adjusted dosing spaces doses further apart. Levels stay steadier.";
  else s = "No treatment. Drug spreads in blood, then the liver and kidney clear it.";
  if (l === 1) s += " The intravenous dose enters blood directly.";
  else if (l === 2) s += " The damaged liver clears less.";
  else if (l === 3) s += " The weak kidney passes less urine.";
  else s += " A swallowed dose passes the liver first.";
  return s;
}
function initOrgans() {
  gutO = organ($("gutSlot"), "intestine", 135, 170, 155, {});
  liverO = organ($("liverSlot"), "liver", 370, 165, 200, {});
  kidneyO = organ($("kidneySlot"), "kidney", 805, 160, 120, {});
  const GP = gutO.ports, LP = liverO.ports, KP = kidneyO.ports;
  $("portalV").setAttribute("d", "M" + f1(GP.out[0]) + " " + f1(GP.out[1]) + " C240 236 300 224 " + f1(LP.porta[0]) + " " + f1(LP.porta[1]));
  $("hepV").setAttribute("d", "M" + f1(LP.out[0]) + " " + f1(LP.out[1]) + " C425 106 460 125 495 145");
  $("bkV").setAttribute("d", "M655 150 L" + f1(KP.in[0]) + " " + f1(KP.in[1]));
  $("urineTube").setAttribute("d", "M" + f1(KP.out[0]) + " " + f1(KP.out[1]) + " L" + f1(KP.out[0]) + " 395");
  $("bileDuct").setAttribute("d", "M" + f1(LP.gall[0]) + " " + f1(LP.gall[1]) + " C395 228 430 250 452 292 C465 318 480 332 500 345");
  trGutLiver = track([GP.out, [250, 230], LP.porta]);
  trBile = track([LP.gall, [420, 262], [468, 320], [505, 348]]);
}
function initStage() {
  ENZ_OFF.forEach(([dx, dy]) => {
    const e = mk("circle", { class: "pk-enz", r: 4.5 }, layers.enz);
    e._bx = liverO.x + dx; e._by = liverO.y + dy; E.enz.push(e);
  });
  ENZ_OFF.slice(0, 5).forEach(([dx, dy]) => {
    const b = mk("rect", { class: "pk-block", x: -6, y: -3, width: 12, height: 6, rx: 3, opacity: "0" }, layers.block);
    b._bx = liverO.x + dx; b._by = liverO.y + dy - 7; E.blocks.push(b);
  });
  PROT.forEach(([x, y]) => mk("circle", { class: "pk-prot", cx: x, cy: y, r: 10 }, layers.prot));
  TCELL.forEach(([x, y]) => mk("circle", { class: "pk-tcell", cx: x, cy: y, r: 16 }, layers.tcells));
  const G = layers.graph;
  mk("line", { class: "pk-axis", x1: 62, y1: 270, x2: 62, y2: 382 }, G); mk("line", { class: "pk-axis", x1: 62, y1: 382, x2: 398, y2: 382 }, G);
  mk("line", { class: "pk-grid", x1: 62, y1: 326, x2: 398, y2: 326 }, G);
  const yt = mk("text", { class: "sc-lab", x: 50, y: 326, "text-anchor": "middle", transform: "rotate(-90 50 326)" }, G); yt.textContent = "concentration";
  const xt = mk("text", { class: "sc-lab", x: 398, y: 398, "text-anchor": "end" }, G); xt.textContent = "time";
  E.aucFill = mk("path", { class: "pk-auc", d: "" }, G);
  E.curveOne = mk("path", { class: "pk-curve2", d: "" }, G); E.curveRep = mk("path", { class: "pk-curve1", d: "" }, G);
  E.halfLine = mk("line", { class: "pk-half", x1: 100, y1: 290, x2: 100, y2: 382 }, G); E.halfDot = mk("circle", { class: "pk-hdot", cx: 100, cy: 320, r: 3.4 }, G);
  E.halfText = mk("text", { class: "sc-lab", x: 106, y: 374 }, G); E.halfText.textContent = "half-life";
  mk("line", { class: "pk-curve1", x1: 288, y1: 274, x2: 316, y2: 274 }, G); const l1 = mk("text", { class: "sc-lab", x: 322, y: 278 }, G); l1.textContent = "repeated";
  mk("line", { class: "pk-curve2", x1: 288, y1: 290, x2: 316, y2: 290 }, G); const l2 = mk("text", { class: "sc-lab", x: 322, y: 294 }, G); l2.textContent = "one dose";
  for (let i = 0; i < 6; i++) E.doseTicks.push(mk("line", { class: "pk-dose", x1: 62, y1: 382, x2: 62, y2: 388 }, G));
  E.intArrow = mk("line", { class: "pk-dose", x1: 62, y1: 398, x2: 130, y2: 398 }, G);
  E.intL = mk("line", { class: "pk-dose", x1: 62, y1: 395, x2: 62, y2: 401 }, G);
  E.intR = mk("line", { class: "pk-dose", x1: 130, y1: 395, x2: 130, y2: 401 }, G);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, tx: 0, ty: 0 }; }); }
const absP = pool(16, () => mk("circle", { class: "sc-p p-drug", r: 3.2 }, layers.parts));
const plaP = pool(22, () => mk("circle", { class: "sc-p p-drug", r: 3.2 }, layers.parts));
const metP = pool(14, () => mk("circle", { class: "sc-p p-metab", r: 2.8 }, layers.parts));
const uriP = pool(12, () => mk("circle", { class: "sc-p p-urine", r: 2.8 }, layers.parts));
const bilP = pool(10, () => mk("circle", { class: "sc-p p-bilep", r: 2.8 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function spawnPlasma(x, y) { const p = freeP(plaP); if (!p) return; emit(p, x, y, 0); p.vx = rnd(-16, 16); p.vy = rnd(-10, 10); p.t = rnd(0.4, 1.4); }
function spawnMetab(x, y) { const p = freeP(metP); if (p) { emit(p, x, y, 0); p.vy = rnd(8, 16); } }
function spawnUrine() { const p = freeP(uriP); if (p) emit(p, kidneyO.ports.out[0] + rnd(-10, 10), kidneyO.ports.out[1] + 14, 0); }
function spawnBile(x, y) { const p = freeP(bilP); if (p) emit(p, x, y, 0); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, xs = [95, 245, 395, 545, 695, 845];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "How the body handles the drug";
  [["abs", "Absorption", "g-drug", "How much of the dose reaches the blood. A swallowed dose loses some drug to first-pass metabolism in the gut wall and liver; an intravenous dose reaches the blood in full."],
    ["free", "Free drug", "g-prot", "The share of blood drug that is not bound to protein. Only free drug leaves the blood, enters tissues, acts and is cleared."],
    ["met", "Liver metab.", "g-liv", "Liver metabolism: enzymes change drug into metabolites. Inducers speed this up, blockers slow it down, and a damaged liver does less."],
    ["kid", "Kidney excr.", "g-kid", "Kidney excretion of drug into urine. A weak kidney clears less, so drug stays in the body longer."],
    ["hl", "Half-life", "g-bad", "The time for the level to fall by half. It lengthens when total clearance falls and shortens when clearance rises."],
    ["auc", "Exposure", "g-cyt", "Overall exposure to the drug over time, the shaded area in the graph. It rises with higher absorption and lower clearance, and falls when metabolism is induced or doses are spaced out."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, 52, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Gut", 135, 95, 135, 64, "Gut: a swallowed dose crosses the gut wall into portal blood on its way to the liver. An intravenous dose skips this step.");
  pill(ox, "Liver", 370, 100, 370, 64, "Liver: portal blood arrives first, so some drug is removed before it acts. Liver enzymes also break down drug returning in blood.");
  pill(ox, "Blood", 575, 112, 575, 64, "Blood: drug rides bound to protein as a store, or travels free. Only free drug enters tissues and is cleared.");
  pill(ox, "Kidney", 805, 95, 805, 64, "Kidney: drug leaves blood into urine, which drains down the tube. A weak kidney clears less, so levels stay high longer.");
  pill(ox, "Levels over time", 225, 250, 225, 236, "Levels over time: dashed is one dose fading with its half-life, solid is repeated doses climbing until each dose balances what the body clears. Shading is overall exposure.");
  pill(ox, "Tissues", 575, 250, 575, 236, "Tissues: free drug moves down into tissues and back. This spread plus clearance sets how long drug lasts.");
  pill(ox, "Bile", 600, 345, 700, 236, "Bile: the liver also sends some drug to the gut in bile. It leaves in faeces.");
  E.capEl = mk("text", { class: "pk-cap", x: 30, y: 432 }, ox); E.capEl.textContent = capText(0, 0);
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
  const x0 = 62, x1 = 398, yb = 382, yt = 268, N = 64;
  const interval = lerp(0.20, 0.30, sm.renalAdj);
  const doses = []; for (let d = 0; d < 1 - 1e-6; d += interval) doses.push(d);
  let dRep = "", dOne = "", halfX = x0, halfY = yb, peakOne = 0; const one = [];
  for (let i = 0; i < N; i++) { const tt = i / (N - 1); one.push(concAt(tt, [0], sm)); if (one[i] > peakOne) peakOne = one[i]; }
  for (let i = 0; i < N; i++) { const tt = i / (N - 1), xr = x0 + tt * (x1 - x0);
    const yR = yb - clamp(concAt(tt, doses, sm) / 1.3) * (yb - yt), yO = yb - clamp(one[i] / 1.3) * (yb - yt);
    dRep += (i ? "L" : "M") + f1(xr) + " " + f1(yR); dOne += (i ? "L" : "M") + f1(xr) + " " + f1(yO); }
  E.aucFill.setAttribute("d", dRep + "L" + f1(x1) + " " + yb + "L" + f1(x0) + " " + yb + "Z");
  E.curveRep.setAttribute("d", dRep); E.curveOne.setAttribute("d", dOne);
  const tPk = sm.iv > 0.5 ? 0 : 0.05, tHalf = Math.min(0.92, tPk + 0.315 / Math.max(0.4, sm.ke));
  halfX = x0 + tHalf * (x1 - x0); halfY = yb - clamp((peakOne * 0.5) / 1.3) * (yb - yt);
  E.halfLine.setAttribute("x1", f1(halfX)); E.halfLine.setAttribute("x2", f1(halfX)); E.halfLine.setAttribute("y1", f1(halfY));
  E.halfDot.setAttribute("cx", f1(halfX)); E.halfDot.setAttribute("cy", f1(halfY));
  E.halfText.setAttribute("x", f1(Math.min(344, halfX + 6)));
  E.doseTicks.forEach((tk, i) => { if (i < doses.length) { const dx = x0 + doses[i] * (x1 - x0); tk.setAttribute("x1", f1(dx)); tk.setAttribute("x2", f1(dx)); tk.setAttribute("opacity", "1"); } else tk.setAttribute("opacity", "0"); });
  const ix = x0 + interval * (x1 - x0);
  E.intArrow.setAttribute("x2", f1(ix)); E.intR.setAttribute("x1", f1(ix)); E.intR.setAttribute("x2", f1(ix));
}
function init() { initOrgans(); initStage(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  $("gutDim").setAttribute("opacity", (sm.iv * 0.45).toFixed(2));
  $("plasmaBoost").setAttribute("opacity", clamp((sm.peak - 0.30) * 1.1, 0, 0.5).toFixed(2));
  $("liverGlow").setAttribute("opacity", (sm.inducer * 0.55).toFixed(2));
  $("liverDim").setAttribute("opacity", clamp(sm.liverImp * 0.45 + sm.inhibitor * 0.35, 0, 0.6).toFixed(2));
  $("kidneyDim").setAttribute("opacity", (sm.kidneyImp * 0.5).toFixed(2));
  E.enz.forEach((e) => { const s = (1 + 0.6 * sm.inducer) * (1 - 0.2 * sm.inhibitor);
    e.setAttribute("transform", "translate(" + f1(e._bx) + " " + f1(e._by) + ") scale(" + s.toFixed(2) + ")");
    e.setAttribute("opacity", clamp(1 - 0.5 * sm.inhibitor, 0.2, 1).toFixed(2)); });
  E.blocks.forEach((b) => { b.setAttribute("transform", "translate(" + f1(b._bx) + " " + f1(b._by) + ") scale(" + (0.9 + 0.1 * sm.inhibitor).toFixed(2) + ")");
    b.setAttribute("opacity", sm.inhibitor.toFixed(2)); });
  drawGraph();
  const KP = kidneyO.ports, LP = liverO.ports;
  /* absorption: oral particles wander in the gut then ride portal blood to the liver; intravenous doses enter blood directly */
  if (sm.iv > 0.5) { acc.pla += dt * 3.2; while (acc.pla >= 1) { acc.pla--; spawnPlasma(rnd(515, 635), 130); } }
  else { acc.abs += dt * (1.2 + 2.2 * sm.bio) * sm.doseRate; while (acc.abs >= 1) { acc.abs--; const p = freeP(absP); if (p) { emit(p, gutO.x + rnd(-45, 45), gutO.y + rnd(-40, 40), 0); p.vx = rnd(-8, 8); p.vy = rnd(-8, 8); p.t = 0; p.k = 0; } } }
  absP.forEach((p) => { if (!p.on) return;
    if (p.k === 0) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 70, 205); p.y = clamp(p.y, 105, 235);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 0.8) { p.k = 1; p.u = 0; } }
    else { p.u += dt * 0.22; const q = trGutLiver.at(clamp(p.u)); p.x = q.x; p.y = q.y + Math.sin(tm / 300 + p.u * 20) * 2;
      if (p.k === 1 && p.u > 0.55) { p.k = 2; if (Math.random() < sm.firstPass * (1 + 0.8 * sm.inducer) * (1 - 0.6 * sm.inhibitor)) { spawnMetab(p.x, p.y); kill(p); return; } }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { kill(p); spawnPlasma(510, 150); } } });
  /* blood: bound store, free roaming, tissue exchange and clearance exits */
  plaP.forEach((p) => { if (!p.on) return; p.t -= dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 505 || p.x > 645) p.vx *= -1; if (p.y < 120 || p.y > 210) p.vy *= -1; p.x = clamp(p.x, 505, 645); p.y = clamp(p.y, 120, 210);
      if (p.t <= 0) { const roll = Math.random();
        if (roll < (1 - sm.freeF) * 0.55) { p.k = 1; const pr = pick(PROT); p.tx = pr[0] + rnd(-6, 6); p.ty = pr[1] + rnd(-6, 6); p.t = rnd(0.8, 1.8); }
        else if (roll < 0.72) { p.k = 2; p.tx = rnd(535, 625); p.ty = 262; }
        else { const metabW = sm.metab * (1 + 1.5 * sm.inducer) * (1 - 0.7 * sm.inhibitor), tot = metabW + sm.renal + sm.bile + 0.001, rr = Math.random() * tot;
          if (rr < metabW) { p.k = 5; p.tx = liverO.x; p.ty = liverO.y; } else if (rr < metabW + sm.renal) { p.k = 6; p.tx = KP.in[0]; p.ty = KP.in[1]; } else { p.k = 7; p.tx = LP.gall[0]; p.ty = LP.gall[1]; } p.t = 4; } } }
    else if (p.k === 1) { p.x = lerp(p.x, p.tx, Math.min(1, dt * 6)); p.y = lerp(p.y, p.ty, Math.min(1, dt * 6)); if (p.t <= 0) { p.k = 0; p.t = rnd(0.3, 1); p.vx = rnd(-16, 16); p.vy = rnd(-10, 10); } }
    else if (p.k === 2 || p.k === 4 || p.k === 5 || p.k === 6 || p.k === 7) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1, sp = p.k === 2 || p.k === 4 ? 90 : 75; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt;
      if (d < 9) { if (p.k === 2) { p.k = 3; p.t = rnd(1, 2.2); p.tx = pick(TCELL)[0]; p.ty = 292; } else if (p.k === 4) { p.k = 0; p.t = rnd(0.3, 1.2); p.x = clamp(p.x, 505, 645); } else if (p.k === 5) { spawnMetab(p.x, p.y); if (Math.random() < 0.5 * sm.inducer) spawnMetab(p.x + 6, p.y); kill(p); return; } else if (p.k === 6) { spawnUrine(); kill(p); return; } else { spawnBile(p.x, p.y); kill(p); return; } } }
    else if (p.k === 3) { p.x += Math.sin(tm / 400 + p.y) * 8 * dt; p.y += Math.cos(tm / 500 + p.x) * 6 * dt; p.x = clamp(p.x, 505, 645); p.y = clamp(p.y, 260, 325); if (p.t <= 0) { p.k = 4; p.tx = rnd(540, 620); p.ty = 225; } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* clearance products */
  metP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.t * 4) * 4 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 270, 470)) + " " + f1(clamp(p.y, 100, 230)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.uri += dt * sm.renal * 1.4; while (acc.uri >= 1) { acc.uri--; if (Math.random() < 0.6) spawnUrine(); }
  uriP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += 34 * dt; p.x = lerp(p.x, KP.out[0], Math.min(1, dt * 3)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, KP.out[1], 402)) + ")"); if (p.y > 400) kill(p); });
  acc.bil += dt * sm.bile * 1.1; while (acc.bil >= 1) { acc.bil--; if (Math.random() < 0.6) spawnBile(LP.gall[0], LP.gall[1]); }
  bilP.forEach((p) => { if (!p.on) return; p.t += dt * 0.35; const q = trBile.at(clamp(p.t)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.t - 0.7) / 0.3).toFixed(2)); if (p.t > 1) kill(p); });
  /* gauges */
  gg.abs.set(sm.bio, wordOf(sm.bio, 0.65, 0.9, ["partial", "high", "complete"])); gg.free.set(sm.freeF, wordOf(sm.freeF, 0.32, 0.42, ["low", "usual", "high"])); gg.met.set(sm.metab, wordOf(sm.metab, 0.3, 0.6, ["low", "usual", "high"]));
  gg.kid.set(sm.renal, wordOf(sm.renal, 0.3, 0.6, ["low", "usual", "high"])); gg.hl.set(sm.hl, wordOf(sm.hl, 0.38, 0.68, ["short", "usual", "long"])); gg.auc.set(sm.auc, wordOf(sm.auc, 0.32, 0.58, ["low", "usual", "high"]));
  const key = drug * 10 + level;
  if (key !== E.capKey) { E.capKey = key; const t = capText(drug, level); if (E.capEl.textContent !== t) E.capEl.textContent = t; }
}
run({ init, step });
