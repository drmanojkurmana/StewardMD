/* Conduction scene: an impulse runs SA node, atria, AV node (delay), His, branches; chambers light as it arrives; the ECG is drawn from the same events. */
const G = SC.GEO, E = SC.ECG, WW = SC.W;
const L = { imps: $("imps"), marks: $("marks"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const ch = { ra: $("ch-ra"), la: $("ch-la"), rv: $("ch-rv"), lv: $("ch-lv") }, act = { ra: 0, la: 0, rv: 0, lv: 0 };
const trace = mk("path", { class: "cd-trace" }, L.ecg), noteEl = $("ecgnote");
const tracks = { ra: track(G.inter), la: track(G.bach), his: track(G.hisTrack), lbb: track(G.lbb), rbb: track(G.rbb) };
const dots = Array.from({ length: 8 }, () => ({ e: mk("circle", { class: "cd-imp", r: 5 }, L.imps), on: false, tr: null, u: 0, sp: 1, cb: null, hold: 0, x: 0, y: 0 }));
dots.forEach((d) => d.e.setAttribute("opacity", "0"));
let T = 0, kind = "", nextA = 0.4, nextV = 0.8, sparkT = 0, embAcc = 0;
const pulses = [], pts = [];
const sm = { th: 0, V: 0.5, reg: 1, CO: 0.8, S: 0.1, rate: 0, rhythm: 0, pace: 0, coag: 0 };
const sw = { x: E.x };                                     // ECG sweep position
/* ---- impulses ---- */
function launch(tr, dur, cb, hold) { const d = dots.find((q) => !q.on); if (!d) return; d.on = true; d.tr = tr; d.u = 0; d.sp = 1 / Math.max(0.02, dur); d.cb = cb || null; d.hold = hold || 0; d.e.setAttribute("opacity", "1"); const p = tr.at(0); d.x = p.x; d.y = p.y; d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y)); }
function fireAtrial(conduct) {
  act.ra = 1; act.la = 1; pulses.push({ t: T, k: "P" });
  launch(tracks.la, 0.16, null);
  launch(tracks.ra, 0.1, () => { avPulse = 1; if (!conduct) { blockFlash = 1; return; } holdAV(0.14, () => conductDown("narrow")); });
}
let avPulse = 0, blockFlash = 0, holdQ = [];
function holdAV(sec, cb) { holdQ.push({ t: sec, cb }); }
function conductDown(k, spikeFirst) { launch(tracks.his, 0.03, null); setTimeout(() => {}, 0); const done = () => { fireVent(k); }; launch(tracks.lbb, 0.07, done); launch(tracks.rbb, 0.07, null); }
function fireVent(k) { act.rv = 1; act.lv = 1; pulses.push({ t: T, k }); }
function firePaced() { sparkT = 1; pulses.push({ t: T, k: "spike" }); setTimeout(() => {}, 0); pacedQ.push({ t: 0.02 }); }
const pacedQ = [];
function escapeBeat() { const tr = track([G.escape, G.apexR]); launch(tr, 0.22, () => fireVent("escape")); }
/* ---- ECG signal built from fired events ---- */
const g = (x, c, s) => Math.exp(-((x - c) * (x - c)) / (2 * s * s));
function signal(t, rk) {
  let y = 0;
  for (let i = 0; i < pulses.length; i++) { const p = pulses[i], d = t - p.t; if (d < -0.05 || d > 0.9) continue;
    if (p.k === "P") y += 0.16 * g(d, 0.05, 0.03);
    else if (p.k === "narrow") y += -0.1 * g(d, 0.005, 0.008) + 1.0 * g(d, 0.026, 0.011) - 0.25 * g(d, 0.05, 0.01) + 0.3 * g(d, 0.27, 0.055);
    else if (p.k === "escape") y += 0.75 * g(d, 0.05, 0.028) - 0.35 * g(d, 0.1, 0.03) - 0.22 * g(d, 0.34, 0.08);
    else if (p.k === "spike") y += 0.9 * g(d, 0, 0.003);
    else if (p.k === "paced") y += 0.7 * g(d, 0.05, 0.026) - 0.3 * g(d, 0.1, 0.03) - 0.2 * g(d, 0.32, 0.08); }
  if (rk === "af" || rk === "afslow") y += 0.05 * Math.sin(t * 38) + 0.04 * Math.sin(t * 57 + 1) + 0.03 * Math.sin(t * 93 + 2);
  return y;
}
/* ---- marks for each treatment, labels ---- */
let marks = {};
function initPanel() {
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The rhythm";
  gg.V = gauge(P, 150, y0 + 2, 52, 18, "g-neu", "Ventricular rate", "How fast the ventricles beat. Complete block gives a slow escape rate; untreated AF is fast.");
  gg.R = gauge(P, 330, y0 + 2, 52, 18, "g-cyt", "Regularity", "How regular the beat is. Sinus rhythm is regular; AF is irregularly irregular; complete block is regular but atria and ventricles are dissociated.");
  gg.C = gauge(P, 510, y0 + 2, 52, 18, "g-good", "Cardiac output", "Blood pumped per minute. A slow ventricle or AF with a fast, uncoordinated rate lowers it.");
  gg.S = gauge(P, 690, y0 + 2, 52, 18, "g-bad", "Stroke risk", "In AF, blood pools in the left atrial appendage and can clot. A clot can travel to the brain and cause a stroke. An anticoagulant lowers the risk.");
  const o = L.over;
  pill(o, "SA node", G.sa[0], G.sa[1], 74, 128, "Sinoatrial node: the heart's natural pacemaker. It fires about every beat, and the wave spreads over the atria.");
  pill(o, "AV node (delay)", G.av[0], G.av[1], 330, 232, "Atrioventricular node: the only normal electrical gateway between atria and ventricles. It holds the signal briefly so the ventricles can fill.");
  pill(o, "His bundle", G.his[0], G.his[1], 310, 270, "Bundle of His: carries the signal from the AV node into the ventricles, then splits into left and right bundle branches.");
  pill(o, "Purkinje fibres", 346, 308, 452, 330, "Purkinje fibres: fast fibres that spread the signal through the ventricular muscle so the ventricles contract together.");
  pill(o, "Atria", 300, 150, 290, 70, "Atria: the two top chambers. The P wave is their depolarisation.");
  pill(o, "Ventricles", 130, 330, 76, 300, "Ventricles: the two lower pumping chambers. The QRS is their depolarisation.");
  const mClot = pill(o, "Appendage clot", G.clot[0], G.clot[1], 462, 172, "In AF the left atrial appendage does not empty well. Blood pools and clots, and a piece can break off and travel to the brain."); mClot.setAttribute("id", "pl-clot");
  const mPm = pill(o, "Pacemaker", G.pm[0], G.pm[1] + 16, 470, 176, "Pacemaker: senses the atria and sends a small pulse down a lead to the ventricle when the signal does not get through."); mPm.setAttribute("id", "pl-pm");
  const mRate = pill(o, "Rate control", G.av[0], G.av[1], 190, 232, "Rate control (beta-blocker, calcium-channel blocker or digoxin) slows conduction through the AV node, so fewer atrial signals reach the ventricles."); mRate.setAttribute("id", "pl-rate");
  const mRhy = pill(o, "Rhythm control", 330, 120, 482, 134, "Rhythm control (an antiarrhythmic drug or electrical cardioversion) tries to restore sinus rhythm in the atria."); mRhy.setAttribute("id", "pl-rhy");
  const mCo = pill(o, "Anticoagulant", G.clot[0], G.clot[1] + 12, 462, 206, "An anticoagulant stops the clot forming, which lowers the stroke risk in AF."); mCo.setAttribute("id", "pl-co");
  const mBr = pill(o, "To the brain: stroke", 470, 62, 440, 72, "A clot that breaks off travels in the blood to the brain and can block an artery there: a stroke."); mBr.setAttribute("id", "pl-brain");
  const px = mk("g", { id: "mk-rate" }, L.marks); mk("circle", { class: "cd-x", cx: G.av[0] + 16, cy: G.av[1] - 12, r: 7 }, px); mk("path", { class: "cd-xp", d: "M" + (G.av[0] + 12) + " " + (G.av[1] - 16) + "l8 8m0 -8l-8 8" }, px);
  const pr = mk("g", { id: "mk-rhy" }, L.marks); mk("path", { class: "cd-ok", d: "M138 80Q260 56 384 80" }, pr);
  const pc = mk("g", { id: "mk-co" }, L.marks); mk("circle", { class: "cd-x", cx: G.clot[0] + 20, cy: G.clot[1] - 14, r: 7 }, pc); mk("path", { class: "cd-xp", d: "M" + (G.clot[0] + 16) + " " + (G.clot[1] - 18) + "l8 8m0 -8l-8 8" }, pc);
  marks = { rate: px, rhy: pr, co: pc };
  spark = mk("path", { class: "cd-spark", d: "M" + (G.pm[0] - 6) + " " + (G.pm[1] + 22) + "l6 -8l-4 8l8 -8", opacity: "0" }, L.marks);
}
const gg = {}; let spark = null;
const emb = Array.from({ length: 3 }, () => ({ e: mk("circle", { class: "cd-clot", r: 4 }, L.imps), on: false, u: 0 }));
emb.forEach((q) => q.e.setAttribute("opacity", "0"));
const embTr = track([G.clot, [452, 96], G.brain]);
function init() { initPanel(); }
function step(dt, m) {
  T += dt;
  const k = 1 - Math.exp(-dt * 2.2);
  sm.th += (m.th - sm.th) * k; sm.V += (m.V - sm.V) * k; sm.reg += (m.reg - sm.reg) * k; sm.CO += (m.CO - sm.CO) * k; sm.S += (m.S0 - sm.S) * k;
  /* rhythm change: restart the timers */
  if (m.kind !== kind) { kind = m.kind; nextA = 0.3; nextV = 0.9; pulses.length = 0; }
  /* rhythm engine */
  if (kind === "sinus" || kind === "paced") {
    nextA -= dt; if (nextA <= 0) { nextA += m.rate ? 1.3 : 1.05; fireAtrial(kind === "sinus"); if (kind === "paced") pacedQ.push({ t: 0.26, p: 1 }); }
  } else if (kind === "block") {
    nextA -= dt; if (nextA <= 0) { nextA += 0.82; fireAtrial(false); }
    nextV -= dt; if (nextV <= 0) { nextV += 1.9; escapeBeat(); }
  } else {                                                  // AF: no organised atrial wave, irregular ventricular events
    act.ra = Math.max(act.ra, 0.15 + Math.random() * 0.3); act.la = Math.max(act.la, 0.15 + Math.random() * 0.3);
    nextV -= dt; if (nextV <= 0) { nextV += kind === "af" ? rnd(0.32, 0.72) : rnd(0.75, 1.3); avPulse = 1; launch(tracks.his, 0.03, null); launch(tracks.lbb, 0.07, () => fireVent("narrow")); launch(tracks.rbb, 0.07, null); }
  }
  /* paced ventricular beat: spike then a wide QRS from the lead tip */
  for (let i = pacedQ.length - 1; i >= 0; i--) { const q = pacedQ[i]; q.t -= dt; if (q.t <= 0) { pacedQ.splice(i, 1); if (q.p) { sparkT = 1; pulses.push({ t: T, k: "spike" }); launch(track([G.lead, G.apexL, G.lbb[1]]), 0.2, () => fireVent("paced")); } } }
  /* AV node holds the impulse */
  for (let i = holdQ.length - 1; i >= 0; i--) { const q = holdQ[i]; q.t -= dt; if (q.t <= 0) { holdQ.splice(i, 1); q.cb(); } }
  /* travelling dots */
  dots.forEach((d) => { if (!d.on) return; d.u += dt * d.sp; const p = d.tr.at(clamp(d.u)); d.x = p.x; d.y = p.y; d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y));
    if (d.u >= 1) { d.on = false; d.e.setAttribute("opacity", "0"); if (d.cb) d.cb(); } });
  /* chambers light, then fade */
  const dec = Math.exp(-dt * 3.2);
  ["ra", "la", "rv", "lv"].forEach((n) => { act[n] *= dec; ch[n].style.setProperty("--act", act[n].toFixed(2)); });
  avPulse *= Math.exp(-dt * 4); blockFlash *= Math.exp(-dt * 3);
  const avEl = svg.querySelector(".cd-av"); avEl.setAttribute("r", f1(8 + 5 * avPulse + (holdQ.length ? 2 : 0)));
  /* ECG sweep */
  const rk = kind, y = signal(T, rk), speed = 92;
  sw.x += speed * dt; if (sw.x > E.x + E.w) sw.x = E.x;
  for (let i = pts.length - 1; i >= 0; i--) { if (pts[i][0] > sw.x - 1 && pts[i][0] < sw.x + 26) pts.splice(i, 1); }
  pts.push([sw.x, E.base - y * 74]);
  let d = "", prev = -1; for (let i = 0; i < pts.length; i++) { const p = pts[i]; d += (p[0] < prev || i === 0 ? "M" : "L") + f1(p[0]) + " " + f1(p[1]); prev = p[0]; }
  trace.setAttribute("d", d);
  for (let i = pulses.length - 1; i >= 0; i--) if (T - pulses[i].t > 3.5) pulses.splice(i, 1);
  noteEl.textContent = kind === "block" ? "P waves march on, QRS is slow and wide" : kind === "paced" ? "pacing spike, then the QRS" : kind === "af" || kind === "afslow" ? "no P waves, irregular QRS" : "P, QRS, T in order";
  /* treatment marks, clot, pacemaker */
  const sh = (el, v) => el.setAttribute("opacity", (+v).toFixed(2));
  sh(marks.rate, m.rate ? 1 : 0); sh(marks.rhy, m.rhythm && m.kind === "sinus" ? 1 : 0); sh(marks.co, m.coag && (m.th > 0 || m.kind === "sinus" || true) && SC_IS_AF(m) ? 1 : 0);
  $("pl-rate").style.opacity = m.rate ? 1 : 0; $("pl-rhy").style.opacity = m.rhythm && SC_IS_AF(m) ? 1 : 0; $("pl-co").style.opacity = m.coag && SC_IS_AF(m) ? 1 : 0; $("pl-pm").style.opacity = m.pace && m.kind === "paced" ? 1 : 0; $("pl-clot").style.opacity = sm.th > 0.3 ? 1 : 0; $("pl-brain").style.opacity = sm.th > 0.3 ? 1 : 0;
  $("pmg").setAttribute("opacity", m.kind === "paced" ? "1" : "0");
  sparkT *= Math.exp(-dt * 8); spark.setAttribute("opacity", sparkT.toFixed(2));
  const cg = $("clotg"); cg.setAttribute("opacity", clamp(sm.th * 1.2).toFixed(2)); cg.setAttribute("transform", "translate(" + G.clot[0] + " " + G.clot[1] + ") scale(" + (0.4 + 0.9 * sm.th).toFixed(2) + ") translate(" + (-G.clot[0]) + " " + (-G.clot[1]) + ")");
  /* emboli leave when the clot is large */
  embAcc += dt * (sm.th > 0.5 ? (sm.th - 0.4) * 0.9 : 0); if (embAcc >= 1) { embAcc = 0; const q = emb.find((z) => !z.on); if (q) { q.on = true; q.u = 0; q.e.setAttribute("opacity", "1"); } }
  emb.forEach((q) => { if (!q.on) return; q.u += dt * 0.35; const p = embTr.at(clamp(q.u)); q.e.setAttribute("cx", f1(p.x)); q.e.setAttribute("cy", f1(p.y)); if (q.u >= 1) { q.on = false; q.e.setAttribute("opacity", "0"); } });
  /* gauges */
  gg.V.set(sm.V, m.words[0]); gg.R.set(sm.reg, m.regWord); gg.C.set(sm.CO, m.words[2]); gg.S.set(sm.S, m.words[3]);
}
function SC_IS_AF(m) { return m.th > 0 || m.kind === "af" || m.kind === "afslow" || (m.kind === "sinus" && (m.rhythm || m.coag) && m.S0 > 0.1); }
run({ init, step });
