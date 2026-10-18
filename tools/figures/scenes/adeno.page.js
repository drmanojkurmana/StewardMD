/* Adenosine scene: SA and AV nodes, re-entry circuit, adenosine particles, AV node cell close-up, ECG and gauges. */
const G = SC.GEO, E = SC.ECG, WW = SC.W;
const L = { imps: $("imps"), ado: $("ado"), ecg: $("ecg"), over: $("over"), panel: $("panel"), inset: $("inset"), marks: $("marks") };
const chEls = { ra: $("ch-ra"), la: $("ch-la"), rv: $("ch-rv"), lv: $("ch-lv") };
const act = { ra: 0, la: 0, rv: 0, lv: 0 };
const trSaAv = track(G.saAv);
const trVentL = track(G.hisTrack.concat(G.lbb.slice(1)));
const trVentR = track(G.hisTrack.concat(G.rbb.slice(1)));
const trLoop = track(G.loop);
const sm = { rate: 0.7, circ: 0.5, cond: 0.5, a1: 0.1, adv: 0.1 };
const gg = {};
let beatT = 0.3, circT = 0.1, Tsec = 0, blockGlow = 0;
const acc = { ado: 0, k: 0, ca: 0 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, sp: 1, cb: null }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dots = pool(14, () => mk("circle", { class: "ad-imp", r: 5 }, L.imps));
const adoP = pool(18, () => mk("path", { class: "ad-ado", d: "M0 -4L3 0L0 4L-3 0Z" }, L.ado));
const kP = pool(16, () => mk("circle", { class: "ad-k", r: 2.6 }, L.inset));
const caP = pool(14, () => mk("circle", { class: "ad-ca", r: 2.6 }, L.inset));
function launch(tr, dur, cb) { const p = freeP(dots); if (!p) { if (cb) cb(); return; } p.on = true; p.tr = tr; p.u = 0; p.sp = 1 / Math.max(0.05, dur); p.cb = cb || null; p.e.setAttribute("opacity", "1"); const q = tr.at(0); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); }
function emitP(pl, x, y, vx, vy) { const p = freeP(pl); if (!p) return; p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); }
function flashA() { act.ra = 1; act.la = 1; }
function flashV() { act.rv = 1; act.lv = 1; }
let ecgPath = null, ecgTxt = null, avMark = null, caMark = null, recEls = [], cellG = null, kArrow = null;
function intervalOf() { return 1.3 - 0.8 * sm.rate; }
function ecgVal(tSec) {
  const per = intervalOf(), bt = Math.floor(tSec / per), p = ((tSec % per) + per) % per / per;
  const blocked = sm.cond < 0.35, svt = sm.circ > 0.5;
  let v = 0;
  if (svt) {
    if (p > 0.05 && p < 0.075) v -= 0.10 * Math.sin(Math.PI * (p - 0.05) / 0.025);
    if (p > 0.075 && p < 0.115) v += 1.0 * Math.sin(Math.PI * (p - 0.075) / 0.04);
    if (p > 0.115 && p < 0.14) v -= 0.20 * Math.sin(Math.PI * (p - 0.115) / 0.025);
    if (p > 0.26 && p < 0.50) v += 0.24 * Math.sin(Math.PI * (p - 0.26) / 0.24);
    return v;
  }
  if (p > 0.06 && p < 0.18) v += 0.13 * Math.sin(Math.PI * (p - 0.06) / 0.12);
  const noQrs = blocked && bt % 3 !== 0;
  if (!noQrs) {
    if (p > 0.29 && p < 0.315) v -= 0.10 * Math.sin(Math.PI * (p - 0.29) / 0.025);
    if (p > 0.315 && p < 0.355) v += 0.95 * Math.sin(Math.PI * (p - 0.315) / 0.04);
    if (p > 0.355 && p < 0.38) v -= 0.20 * Math.sin(Math.PI * (p - 0.355) / 0.025);
    if (p > 0.48 && p < 0.72) v += 0.26 * Math.sin(Math.PI * (p - 0.48) / 0.24);
  }
  return v;
}
function initInset() {
  const I = L.inset;
  cellG = cell(I, { cls: "endo", r: 44, nuc: 0.38, seed: 3, wob: 0.08, x: 685, y: 360 });
  for (let j = 0; j < 6; j++) { const a = -2.4 + j * 0.32, x = 685 + Math.cos(a) * 46, y = 360 + Math.sin(a) * 46; const c = mk("circle", { class: "ad-rec", cx: f1(x), cy: f1(y), r: 4.5 }, I); recEls.push(c); }
  kArrow = mk("path", { class: "ad-arrow", d: "M672 404V420M665 413l7 8 7-8", opacity: "0" }, I);
  caMark = mk("g", { opacity: "0" }, I);
  mk("circle", { class: "ad-x", cx: 732, cy: 318, r: 7 }, caMark); mk("path", { class: "ad-xp", d: "M729 315l6 6m0-6l-6 6" }, caMark);
  const tc = mk("text", { class: "ad-cap", x: 685, y: 364, "text-anchor": "middle" }, I); tc.textContent = "AV cell";
}
function initPanel() {
  initInset();
  ecgPath = mk("path", { class: "ad-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "ad-zone", x: E.x + E.w - 10, y: E.y + 16, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. Sinus rhythm shows a P wave, then a QRS and a T wave. Re-entrant SVT is fast and regular with narrow QRS complexes. After adenosine the QRS can drop out for a beat or two, giving a brief pause before sinus rhythm returns." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  avMark = mk("g", { opacity: "0" }, L.marks);
  mk("circle", { class: "ad-x", cx: G.av[0] + 18, cy: G.av[1] - 14, r: 8 }, avMark); mk("path", { class: "ad-xp", d: "M" + (G.av[0] + 14) + " " + (G.av[1] - 18) + "l8 8m0-8l-8 8" }, avMark);
  const o = L.over;
  pill(o, "SA node", G.sa[0], G.sa[1], 78, 98, "Sinoatrial node: the normal pacemaker in the right atrium. Adenosine also acts here, so the pacemaker slows briefly.");
  pill(o, "Atria", 360, 120, 470, 90, "Atria: the top chambers. Their activation is the P wave. In sinus rhythm each P wave is followed, after the AV nodal delay, by a QRS.");
  pill(o, "Re-entry loop", 420, 240, 470, 140, "Re-entry circuit: in SVT the impulse goes down through the AV node to the ventricles and back up to the atria, then round again. If the AV node blocks, the loop has nowhere to go and the SVT stops.");
  pill(o, "AV node", G.av[0], G.av[1], 455, 205, "AV node: the normal gateway from atria to ventricles. It delays the impulse so the ventricles can fill. Adenosine blocks it briefly through A1 receptors.");
  pill(o, "His bundle", G.his[0], G.his[1], 472, 285, "Bundle of His and bundle branches: the fast route from the AV node that activates both ventricles together, giving a narrow QRS.");
  pill(o, "Ventricles", 212, 384, 90, 425, "Ventricles: the pumping chambers. In fast SVT they are driven round the circuit. When the AV node blocks, no impulse reaches them and there is a brief pause.");
  pill(o, "Dipyridamole boosts", 370, 175, 360, 425, "Dipyridamole blocks adenosine uptake into cells, so more adenosine stays around its receptors and the AV block is stronger and longer. Caffeine and theophylline do the opposite.");
  const pb = pill(o, "AV node blocked", G.av[0], G.av[1], 492, 350, "Adenosine at A1 receptors: potassium leaves the cell, the membrane hyperpolarises, calcium current falls, and the AV node cannot pass the impulse for a brief period. The re-entry circuit breaks."); pb.setAttribute("id", "p-block"); pb.style.opacity = 0;
  pill(o, "A1 receptor", 648, 322, 795, 303, "A1 receptor on AV nodal and sinoatrial cells. Adenosine binding switches on Gi signalling. Caffeine and theophylline sit on the same receptor as antagonists and blunt this effect.");
  pill(o, "K+ out", 685, 404, 600, 420, "Potassium channels open and potassium leaves the cell. The inside becomes more negative: hyperpolarisation, so the cell is harder to excite.");
  pill(o, "Less Ca2+ in", 732, 318, 862, 338, "Calcium current falls. AV nodal cells depend on calcium current to pass the impulse, so conduction slows and then blocks.");
  pill(o, "Hyperpolarised", 685, 360, 862, 392, "Hyperpolarised AV nodal cell: further from threshold, slower to recover, and unable to conduct for a short time. Because adenosine is cleared very fast, this wears off quickly.");
  pill(o, "Caffeine opposes", 660, 330, 738, 420, "Caffeine and theophylline are adenosine receptor antagonists. With caffeine on board, the same adenosine produces less AV block and the SVT circuit may keep running.");
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["rate", "Rate", "g-bad", "How fast the ventricles beat. Re-entrant SVT is fast. A brief AV block gives a pause, then sinus rhythm returns."], ["circ", "Circuit", "g-cyt", "How strongly the re-entry loop through the AV node is running. AV block breaks the loop."], ["cond", "AV conduction", "g-good", "How freely impulses pass through the AV node. Adenosine reduces this to blocked for a brief period."], ["a1", "A1 effect", "g-cyt", "A1 receptor activation at the AV and SA nodes: potassium out, hyperpolarisation, less calcium current. Caffeine blunts it, dipyridamole strengthens it."], ["adv", "Side effects", "g-adv", "Flushing, chest tightness, breathlessness from bronchospasm, and a transient pause or brief asystole can occur as adenosine acts and then wears off."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 180, y0 + 2, 52, 18, cls, name, tip); });
}
function init() { initPanel(); }
function step(dt, m) {
  Tsec += dt;
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.rate = lerp(sm.rate, m.rate, k1); sm.circ = lerp(sm.circ, m.circ, k2); sm.cond = lerp(sm.cond, m.cond, k1); sm.a1 = lerp(sm.a1, m.a1, k2); sm.adv = lerp(sm.adv, m.adv, k2);
  blockGlow = lerp(blockGlow, sm.cond < 0.35 ? 1 : 0, k1);
  for (const key in act) act[key] = Math.max(0, act[key] - dt * 2.2);
  chEls.ra.style.setProperty("--act", act.ra.toFixed(2)); chEls.la.style.setProperty("--act", act.la.toFixed(2)); chEls.rv.style.setProperty("--act", act.rv.toFixed(2)); chEls.lv.style.setProperty("--act", act.lv.toFixed(2));
  dots.forEach((p) => { if (!p.on) return; p.u += dt * p.sp; const q = p.tr.at(clamp(p.u)); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); if (p.u >= 1) { killP(p); if (p.cb) p.cb(); } });
  if (sm.circ > 0.5) {
    circT -= dt;
    if (circT <= 0) { circT += 0.30; flashA(); launch(trLoop, 0.62, () => flashV()); }
  } else {
    beatT -= dt;
    if (beatT <= 0) { beatT += intervalOf(); flashA(); launch(trSaAv, 0.34, () => { if (sm.cond > 0.35) { launch(trVentL, 0.30, () => flashV()); launch(trVentR, 0.30, null); } }); }
  }
  if (avMark) avMark.setAttribute("opacity", blockGlow.toFixed(2));
  const bp = $("p-block"); if (bp) bp.style.opacity = blockGlow.toFixed(2);
  acc.ado += dt * sm.a1 * 7; while (acc.ado >= 1) { acc.ado--; emitP(adoP, rnd(430, 470), rnd(120, 160), 0, 0); }
  adoP.forEach((p) => { if (!p.on) return; const dx = G.av[0] - p.x, dy = G.av[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Tsec * 90) + ")"); if (d < 14) killP(p); });
  recEls.forEach((c, j) => c.style.opacity = (0.35 + 0.65 * sm.a1 * (0.6 + 0.4 * Math.sin(Tsec * 3 + j))).toFixed(2));
  if (kArrow) kArrow.setAttribute("opacity", sm.a1.toFixed(2));
  if (caMark) caMark.setAttribute("opacity", blockGlow.toFixed(2));
  if (cellG) cellG.style.setProperty("--act", sm.a1.toFixed(2));
  acc.k += dt * sm.a1 * 9; while (acc.k >= 1) { acc.k--; emitP(kP, 685 + rnd(-16, 16), 402, rnd(-5, 5), rnd(22, 34)); }
  kP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9 || p.y > 428) killP(p); });
  acc.ca += dt * 6; while (acc.ca >= 1) { acc.ca--; emitP(caP, 732 + rnd(-8, 8), 292, 0, 26); }
  caP.forEach((p) => { if (!p.on) return; p.t += dt; const lim = sm.a1 > 0.4 ? 312 : 336; p.y += p.vy * dt * (p.y < lim ? 1 : 0); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (p.y >= lim ? clamp(1 - (p.t - 0.4)).toFixed(2) : "1")); if (p.t > 1.1) killP(p); });
  let d = "";
  for (let x = E.x; x <= E.x + E.w; x += 3) { const age = (E.x + E.w - x) / 110, v = ecgVal(Tsec - age), y = clamp(E.base - 44 * v, E.y + 4, E.y + E.h - 4); d += (x === E.x ? "M" : "L") + x + " " + f1(y); }
  if (ecgPath) ecgPath.setAttribute("d", d);
  const ew = sm.circ > 0.5 ? "SVT" : sm.cond < 0.35 ? "AV block, pause" : "sinus";
  if (ecgTxt && ecgTxt.textContent !== ew) ecgTxt.textContent = ew;
  gg.rate.set(sm.rate, wordOf(sm.rate, 0.38, 0.68, ["slow", "normal", "fast"]));
  gg.circ.set(sm.circ, wordOf(sm.circ, 0.25, 0.6, ["off", "weak", "running"]));
  gg.cond.set(sm.cond, wordOf(sm.cond, 0.35, 0.65, ["blocked", "reduced", "open"]));
  gg.a1.set(sm.a1, wordOf(sm.a1, 0.35, 0.7, ["low", "moderate", "strong"]));
  gg.adv.set(sm.adv, wordOf(sm.adv, 0.25, 0.55, ["none", "some", "marked"]));
}
run({ init, step });
