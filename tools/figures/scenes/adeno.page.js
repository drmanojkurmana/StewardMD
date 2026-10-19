/* Adenosine scene: heart organ with SA and AV nodes, re-entry circuit, adenosine and caffeine at A1 receptors, AV node cell close-up, ECG and gauges. */
const G = SC.GEO, E = SC.ECG, WW = SC.W;
const L = { imps: $("imps"), ado: $("ado"), ecg: $("ecg"), over: $("over"), panel: $("panel"), inset: $("inset"), marks: $("marks") };
const flashA = $("flashA"), flashV = $("flashV"), loopEl = $("loopPath");
const act = { a: 0, v: 0 };
const trSaAv = track(G.saAv);
const trVentL = track(G.hisTrack.concat(G.lbb.slice(1)));
const trVentR = track(G.hisTrack.concat(G.rbb.slice(1)));
const trLoop = track(G.loop);
const sm = { rate: 0.7, circ: 0.5, cond: 0.5, a1: 0.1, adv: 0.1, caf: 0 };
const gg = {};
let beatT = 0.3, circT = 0.1, Tsec = 0, blockGlow = 0;
const acc = { ado: 0, caf: 0, k: 0, ca: 0 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, sp: 1, cb: null }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dots = pool(14, () => mk("circle", { class: "ad-imp", r: 5 }, L.imps));
const adoP = pool(18, () => mk("path", { class: "ad-ado", d: "M0 -4L3 0L0 4L-3 0Z" }, L.ado));
const cafP = pool(10, () => mk("rect", { class: "ad-caf", x: -3.4, y: -3.4, width: 6.8, height: 6.8, rx: 1.6 }, L.ado));
const kP = pool(16, () => mk("circle", { class: "ad-k", r: 2.6 }, L.inset));
const caP = pool(14, () => mk("circle", { class: "ad-ca", r: 2.6 }, L.inset));
function launch(tr, dur, cb) { const p = freeP(dots); if (!p) { if (cb) cb(); return; } p.on = true; p.tr = tr; p.u = 0; p.sp = 1 / Math.max(0.05, dur); p.cb = cb || null; p.e.setAttribute("opacity", "1"); const q = tr.at(0); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); }
function emitP(pl, x, y, vx, vy) { const p = freeP(pl); if (!p) return; p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); }
function flashAtria() { act.a = 1; }
function flashVentr() { act.v = 1; }
let ecgPath = null, ecgTxt = null, avMark = null, caMark = null, recEls = [], cafEls = [], cellG = null, kArrow = null, capEl = null, capKey = "";
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
  [0, 2, 3, 5].forEach((j) => { const a = -2.4 + j * 0.32, x = 685 + Math.cos(a) * 46, y = 360 + Math.sin(a) * 46; cafEls.push(mk("rect", { class: "ad-caf", x: f1(x - 4), y: f1(y - 4), width: 8, height: 8, rx: 2, opacity: "0" }, I)); });
  kArrow = mk("path", { class: "ad-arrow", d: "M672 404V420M665 413l7 8 7-8", opacity: "0" }, I);
  caMark = mk("g", { opacity: "0" }, I);
  mk("circle", { class: "ad-x", cx: 732, cy: 318, r: 7 }, caMark); mk("path", { class: "ad-xp", d: "M729 315l6 6m0-6l-6 6" }, caMark);
  const tc = mk("text", { class: "ad-cap", x: 685, y: 364, "text-anchor": "middle" }, I); tc.textContent = "AV cell";
}
function capText(lv, d) {
  if (d === 2) return lv === 0 ? "Adenosine briefly blocks the AV node. Beats pause." : "Adenosine blocks the AV node. The loop breaks.";
  if (d === 1) return lv === 0 ? "Caffeine holds the receptors. Adenosine barely acts." : "Caffeine holds the receptors. The loop keeps racing.";
  return lv === 0 ? "No treatment. Beats cross the AV node normally." : "No treatment. The beat loops and the heart races.";
}
function initPanel() {
  initInset();
  organ($("heartSlot"), "heart", 270, 240, 260, {});
  ecgPath = mk("path", { class: "ad-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "ad-zone", x: E.x + E.w - 10, y: E.y + 16, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. Sinus rhythm shows a P wave, then a QRS and a T wave. SVT is fast and regular with narrow QRS complexes. After adenosine the QRS can drop out for a beat or two, giving a brief pause before sinus rhythm returns." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  avMark = mk("g", { opacity: "0" }, L.marks);
  mk("circle", { class: "ad-x", cx: G.av[0] + 18, cy: G.av[1] - 14, r: 8 }, avMark); mk("path", { class: "ad-xp", d: "M" + (G.av[0] + 14) + " " + (G.av[1] - 18) + "l8 8m0-8l-8 8" }, avMark);
  const o = L.over;
  pill(o, "SA node", G.sa[0], G.sa[1], 110, 90, "SA node: the heart's normal pacemaker. Each beat starts here in sinus rhythm.");
  pill(o, "AV node", G.av[0], G.av[1], 470, 190, "AV node: the gate between the top and bottom chambers. It delays each beat, and adenosine can shut it briefly.");
  pill(o, "SVT loop", 375, 190, 470, 140, "SVT loop: the beat circles down through the AV node and back up again, round and round. Break the loop and the racing stops.");
  pill(o, "Ventricles", 285, 392, 470, 320, "Ventricles: the main pumping chambers. In SVT they race with the loop. In AV block they pause.");
  const pb = pill(o, "AV node blocked", G.av[0], G.av[1], 470, 250, "AV node blocked: while adenosine sits on A1 receptors the beat cannot pass. The effect wears off fast."); pb.setAttribute("id", "p-block"); pb.style.opacity = 0;
  pill(o, "A1 receptor", 676, 315, 795, 300, "A1 receptor: adenosine docks here and calms the cell. Caffeine sits in the same seat and blocks adenosine. Dipyridamole keeps adenosine around longer.");
  pill(o, "K+ out", 685, 404, 600, 419, "Potassium leaves the cell through open channels. The cell gets more negative and harder to excite.");
  pill(o, "Ca2+ blocked", 732, 318, 862, 336, "Calcium entry falls. AV node cells need calcium to pass the beat on, so conduction slows, then stops.");
  capEl = mk("text", { class: "ad-cap", x: 30, y: 428 }, o); capEl.textContent = capText(1, 0);
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["rate", "Rate", "g-bad", "How fast the ventricles beat. SVT is fast. A brief AV block gives a pause, then sinus rhythm returns."], ["circ", "Circuit", "g-cyt", "How strongly the re-entry loop through the AV node is running. AV block breaks the loop."], ["cond", "AV conduction", "g-good", "How freely beats pass through the AV node. Adenosine shuts this briefly."], ["a1", "A1 effect", "g-cyt", "A1 receptor action at the AV and SA nodes: potassium out, harder to excite, less calcium entry. Caffeine blunts it."], ["adv", "Side effects", "g-adv", "Flushing, chest tightness, breathlessness and a brief pause can occur as adenosine acts and then wears off."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 180, y0 + 2, 52, 18, cls, name, tip); });
}
function init() { initPanel(); }
function step(dt, m) {
  Tsec += dt;
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.rate = lerp(sm.rate, m.rate, k1); sm.circ = lerp(sm.circ, m.circ, k2); sm.cond = lerp(sm.cond, m.cond, k1); sm.a1 = lerp(sm.a1, m.a1, k2); sm.adv = lerp(sm.adv, m.adv, k2);
  sm.caf = lerp(sm.caf, drug === 1 ? 1 : 0, k2);
  blockGlow = lerp(blockGlow, sm.cond < 0.35 ? 1 : 0, k1);
  for (const key in act) act[key] = Math.max(0, act[key] - dt * 2.2);
  if (flashA) flashA.setAttribute("fill-opacity", (act.a * 0.38).toFixed(2));
  if (flashV) flashV.setAttribute("fill-opacity", (act.v * 0.38).toFixed(2));
  if (loopEl) { loopEl.setAttribute("opacity", (0.12 + 0.55 * sm.circ).toFixed(2)); loopEl.setAttribute("stroke-width", f1(2 + 2.4 * sm.circ)); }
  dots.forEach((p) => { if (!p.on) return; p.u += dt * p.sp; const q = p.tr.at(clamp(p.u)); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); if (p.u >= 1) { killP(p); if (p.cb) p.cb(); } });
  if (sm.circ > 0.5) {
    circT -= dt;
    if (circT <= 0) { circT += 0.30; flashAtria(); launch(trLoop, 0.62, () => flashVentr()); }
  } else {
    beatT -= dt;
    if (beatT <= 0) { beatT += intervalOf(); flashAtria(); launch(trSaAv, 0.34, () => { if (sm.cond > 0.35) { launch(trVentL, 0.30, () => flashVentr()); launch(trVentR, 0.30, null); } }); }
  }
  if (avMark) avMark.setAttribute("opacity", blockGlow.toFixed(2));
  const bp = $("p-block"); if (bp) bp.style.opacity = blockGlow.toFixed(2);
  acc.ado += dt * sm.a1 * 7; while (acc.ado >= 1) { acc.ado--; emitP(adoP, rnd(430, 470), rnd(120, 160), 0, 0); }
  adoP.forEach((p) => { if (!p.on) return; const dx = G.av[0] - p.x, dy = G.av[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Tsec * 90) + ")"); if (d < 14) killP(p); });
  acc.caf += dt * sm.caf * 6; while (acc.caf >= 1) { acc.caf--; emitP(cafP, rnd(600, 750), rnd(268, 290), 0, 0); }
  cafP.forEach((p) => { if (!p.on) return; const dx = 685 - p.x, dy = 335 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Tsec * 60) + ")"); if (d < 16) killP(p); });
  const adoSit = sm.a1 * (drug === 1 ? 0.3 : 1);
  recEls.forEach((c, j) => c.style.opacity = (0.35 + 0.65 * adoSit * (0.6 + 0.4 * Math.sin(Tsec * 3 + j))).toFixed(2));
  cafEls.forEach((c, j) => c.setAttribute("opacity", (sm.caf * (0.75 + 0.25 * Math.sin(Tsec * 3 + j * 1.7))).toFixed(2)));
  if (kArrow) kArrow.setAttribute("opacity", sm.a1.toFixed(2));
  if (caMark) caMark.setAttribute("opacity", blockGlow.toFixed(2));
  if (cellG) cellG.style.setProperty("--act", sm.a1.toFixed(2));
  acc.k += dt * sm.a1 * 9; while (acc.k >= 1) { acc.k--; emitP(kP, 685 + rnd(-16, 16), 402, rnd(-5, 5), rnd(22, 34)); }
  kP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9 || p.y > 428) killP(p); });
  acc.ca += dt * 6; while (acc.ca >= 1) { acc.ca--; emitP(caP, 732 + rnd(-8, 8), 292, 0, 26); }
  const caLim = 336 - 26 * sm.a1;
  caP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt * (p.y < caLim ? 1 : 0); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (p.y >= caLim ? clamp(1 - (p.t - 0.4)).toFixed(2) : "1")); if (p.t > 1.1) killP(p); });
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
  const ck = level + ":" + drug;
  if (ck !== capKey) { capKey = ck; const t = capText(level, drug); if (capEl && capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
