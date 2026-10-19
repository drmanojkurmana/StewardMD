/* Conduction on a real heart: the SA node fires, the atria flash, the AV node holds, His and branches carry the beat down, and the ECG draws the same events. */
const G = SC.GEO, E = SC.ECG, WW = SC.W;
const L = { imps: $("imps"), marks: $("marks"), ecg: $("ecg"), over: $("over"), panel: $("panel"), quiv: $("quiv"), blockers: $("blockers"), diss: $("diss") };
const trace = mk("path", { class: "cd-trace" }, L.ecg), noteEl = $("ecgnote");
let heartO = null, brainO = null, capEl = null, capKey = "";
let embTr = track([[G.clot[0], G.clot[1]], [350, 172], G.carotid]);
const tracks = { ra: track(G.inter), la: track(G.bach), his: track(G.hisTrack), lbb: track(G.lbb), rbb: track(G.rbb) };
const dots = Array.from({ length: 8 }, () => ({ e: mk("circle", { class: "cd-imp", r: 5 }, L.imps), on: false, tr: null, u: 0, sp: 1, cb: null, x: 0, y: 0 }));
dots.forEach((d) => d.e.setAttribute("opacity", "0"));
let T = 0, kind = "", nextA = 0.4, nextV = 0.8, sparkT = 0, embAcc = 0;
let saPulse = 0, avPulse = 0, blockFlash = 0;
const holdQ = [], pacedQ = [], pulses = [], pts = [];
const sm = { th: 0, V: 0.5, reg: 1, CO: 0.8, S: 0.1, quiv: 0 };
const sw = { x: E.x };                                     // ECG sweep position
/* ---- impulses ---- */
function launch(tr, dur, cb) { const d = dots.find((q) => !q.on); if (!d) return; d.on = true; d.tr = tr; d.u = 0; d.sp = 1 / Math.max(0.02, dur); d.cb = cb || null; d.e.setAttribute("opacity", "1"); const p = tr.at(0); d.x = p.x; d.y = p.y; d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y)); }
function fireAtrial(conduct) {
  act.ra = 1; act.la = 1; saPulse = 1; pulses.push({ t: T, k: "P" });
  launch(tracks.la, 0.16, null);
  launch(tracks.ra, 0.1, () => { avPulse = 1; if (!conduct) { blockFlash = 1; return; } holdAV(0.14, () => conductDown("narrow")); });
}
const act = { ra: 0, la: 0, rv: 0, lv: 0 };
function holdAV(sec, cb) { holdQ.push({ t: sec, cb }); }
function conductDown(k) { launch(tracks.his, 0.03, null); launch(tracks.lbb, 0.07, () => fireVent(k, 1)); launch(tracks.rbb, 0.07, null); }
function fireVent(k, v) { act.rv = v; act.lv = v; pulses.push({ t: T, k }); }
function firePaced() { sparkT = 1; pulses.push({ t: T, k: "spike" }); pacedQ.push({ t: 0.02 }); }
function escapeBeat() { const tr = track([G.escape, G.apexR]); launch(tr, 0.22, () => fireVent("escape", 0.55)); }
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
/* ---- one line caption for the stage ---- */
function capText(d, k) {
  if (d === 5) return (k === "paced" || k === "block") ? "Combination: paced beat on time and no clots." : "Combination: normal beat back and no clots.";
  if (d === 1) return "Rate control plugs the AV node. Ventricles beat slower.";
  if (d === 2) return k === "sinus" ? "Rhythm control restores the normal beat from the top." : "Rhythm control tries to restore the normal beat.";
  if (d === 3) return k === "paced" ? "The pacemaker fires the ventricles on time." : "The pacemaker watches and fires when needed.";
  if (d === 4) return "Anticoagulant stops clots. The beat is unchanged.";
  if (k === "block") return "No treatment. The signal stops. Ventricles beat slowly.";
  if (k === "af" || k === "afslow") return "No treatment. Upper chambers quiver. Clots can form.";
  return "No treatment. The normal beat spreads top to bottom.";
}
/* ---- organs, particles, labels ---- */
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 245, 238, 240, {});
  brainO = organ($("brainSlot"), "brain", 480, 132, 120, {});
  const ap = heartO.ports.apex, cp = brainO.ports.carotid;
  $("pblead").setAttribute("d", "M92 106 C140 118 168 146 " + f1(G.sa[0]) + " " + f1(G.sa[1]) + " C226 232 256 300 " + f1(ap[0]) + " " + f1(ap[1]));
  $("pltip").setAttribute("cx", f1(ap[0])); $("pltip").setAttribute("cy", f1(ap[1]));
  $("embtrack").setAttribute("d", "M" + f1(G.clot[0]) + " " + f1(G.clot[1]) + " C320 182 390 170 " + f1(cp[0]) + " " + f1(cp[1]));
  embTr = track([[G.clot[0], G.clot[1]], [350, 172], cp]);
}
const qdots = [];
function initQuiv() {
  for (let i = 0; i < 14; i++) {
    const e = mk("circle", { class: "cd-quiv", r: 2.5 }, L.quiv);
    e.setAttribute("opacity", "0");
    qdots.push({ e, vis: false, bx: rnd(G.quiver[0], G.quiver[1]), by: rnd(G.quiver[2], G.quiver[3]), s: rnd(0, 6.28) });
  }
}
const bl = [];
function initBlockers() {
  const offs = [[-15, 2], [1, -13], [13, 7]];
  offs.forEach((o, i) => {
    const g = mk("g", {}, L.blockers);
    mk("rect", { class: "p-pill", x: -5, y: -2.6, width: 10, height: 5.2, rx: 2.6 }, g);
    mk("rect", { class: "p-pill2", x: 0, y: -2.6, width: 5, height: 5.2, rx: 2 }, g);
    bl.push({ g, x: G.av[0] + o[0], y: G.av[1] + o[1], s: i * 2.1 });
  });
}
const diss = [];
function initDiss() {
  for (let i = 0; i < 6; i++) { const e = mk("circle", { class: "cd-diss", r: 2 }, L.diss); e.setAttribute("opacity", "0"); diss.push({ e }); }
}
let marks = {};
const gg = {}; let spark = null;
function initPanel() {
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The rhythm";
  gg.V = gauge(P, 150, y0 + 2, 52, 18, "g-neu", "Ventricular rate", "How fast the ventricles beat. Complete block gives a slow escape rate; untreated AF is fast.");
  gg.R = gauge(P, 330, y0 + 2, 52, 18, "g-cyt", "Regularity", "How regular the beat is. Sinus rhythm is regular; AF is irregularly irregular; complete block is regular but atria and ventricles are dissociated.");
  gg.C = gauge(P, 510, y0 + 2, 52, 18, "g-good", "Cardiac output", "Blood pumped per minute. A slow ventricle or AF with a fast, uncoordinated rate lowers it.");
  gg.S = gauge(P, 690, y0 + 2, 52, 18, "g-bad", "Stroke risk", "In AF, blood pools in the left atrial appendage and can clot. A clot can travel to the brain and cause a stroke. An anticoagulant lowers the risk.");
  const o = L.over;
  pill(o, "SA node", G.sa[0], G.sa[1], 80, 180, "SA node: the natural starter. Each beat begins here and spreads over the top chambers.");
  pill(o, "AV node", G.av[0], G.av[1], 90, 262, "AV node: the gate between top and bottom. It holds each beat briefly, then passes it down.");
  pill(o, "Ventricles", 250, 335, 80, 336, "Ventricles: the main pumps. Fast fibres spread the signal so both fire together for the QRS.");
  pill(o, "ECG", 740, 196, 862, 72, "ECG: the same beats drawn live. P is the top chambers, QRS the bottom, T the reset.");
  const mRate = pill(o, "Rate control", G.av[0] + 40, G.av[1], 462, 262, "Rate control plugs the AV gate, so fewer beats reach the bottom chambers."); mRate.setAttribute("id", "pl-rate");
  const mRhy = pill(o, "Rhythm control", G.bach[3][0], G.bach[3][1], 462, 216, "Rhythm control calms the top chambers back to a normal beat from the top."); mRhy.setAttribute("id", "pl-rhy");
  const mPm = pill(o, "Pacemaker", G.pm[0], G.pm[1] + 16, 66, 152, "Pacemaker: fires the bottom chambers on time through a lead to the tip."); mPm.setAttribute("id", "pl-pm");
  const mClot = pill(o, "Clot to brain", 330, 200, 462, 308, "In AF the top left chamber quivers, blood pools into a clot, and a piece can travel to the brain."); mClot.setAttribute("id", "pl-clot");
  const pr = mk("g", { id: "mk-rhy", opacity: "0" }, L.marks);
  mk("path", { class: "cd-ok", d: "M150 128Q240 100 332 128" }, pr);
  marks = { rhy: pr };
  spark = mk("path", { class: "cd-spark", d: "M" + (G.pm[0] - 6) + " " + (G.pm[1] + 22) + "l6 -8l-4 8l8 -8", opacity: "0" }, L.marks);
  capEl = mk("text", { class: "cd-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, "af");
}
const emb = Array.from({ length: 3 }, () => ({ e: mk("circle", { class: "cd-clot", r: 4 }, L.imps), on: false, u: 0 }));
emb.forEach((q) => q.e.setAttribute("opacity", "0"));
function init() { initOrgans(); initQuiv(); initBlockers(); initDiss(); initPanel(); }
function step(dt, m) {
  T += dt;
  const k = 1 - Math.exp(-dt * 2.2);
  sm.th += (m.th - sm.th) * k; sm.V += (m.V - sm.V) * k; sm.reg += (m.reg - sm.reg) * k; sm.CO += (m.CO - sm.CO) * k; sm.S += (m.S0 - sm.S) * k;
  /* rhythm change: restart the timers */
  if (m.kind !== kind) { kind = m.kind; nextA = 0.3; nextV = 0.9; pulses.length = 0; }
  sm.quiv += (((kind === "af" || kind === "afslow") ? 1 : 0) - sm.quiv) * k;
  /* rhythm engine */
  if (kind === "sinus" || kind === "paced") {
    nextA -= dt; if (nextA <= 0) { nextA += m.rate ? 1.3 : 1.05; fireAtrial(kind === "sinus"); if (kind === "paced") firePaced(); }
  } else if (kind === "block") {
    nextA -= dt; if (nextA <= 0) { nextA += 0.82; fireAtrial(false); }
    nextV -= dt; if (nextV <= 0) { nextV += 1.9; escapeBeat(); }
  } else {                                                  // AF: no organised atrial wave, irregular ventricular events
    act.ra = Math.max(act.ra, 0.15 + Math.random() * 0.3); act.la = Math.max(act.la, 0.15 + Math.random() * 0.3);
    nextV -= dt; if (nextV <= 0) { nextV += kind === "af" ? rnd(0.32, 0.72) : rnd(0.75, 1.3); avPulse = 1; launch(tracks.his, 0.03, null); launch(tracks.lbb, 0.07, () => fireVent("narrow", 1)); launch(tracks.rbb, 0.07, null); }
  }
  /* AV node holds the impulse */
  for (let i = holdQ.length - 1; i >= 0; i--) { const q = holdQ[i]; q.t -= dt; if (q.t <= 0) { holdQ.splice(i, 1); q.cb(); } }
  /* travelling dots */
  dots.forEach((d) => { if (!d.on) return; d.u += dt * d.sp; const p = d.tr.at(clamp(d.u)); d.x = p.x; d.y = p.y; d.e.setAttribute("cx", f1(d.x)); d.e.setAttribute("cy", f1(d.y));
    if (d.u >= 1) { d.on = false; d.e.setAttribute("opacity", "0"); if (d.cb) d.cb(); } });
  /* chamber flashes on the real heart, then fade */
  const dec = Math.exp(-dt * 3.2);
  ["ra", "la", "rv", "lv"].forEach((n) => { act[n] *= dec; });
  saPulse *= Math.exp(-dt * 4); avPulse *= Math.exp(-dt * 4); blockFlash *= Math.exp(-dt * 3);
  $("nd-sa").setAttribute("r", f1(8 + 5 * saPulse));
  const avEl = svg.querySelector(".cd-av"); avEl.setAttribute("r", f1(8 + 5 * avPulse + (holdQ.length ? 2 : 0) + 3 * blockFlash));
  $("flA").setAttribute("opacity", clamp(Math.max(act.ra, act.la)).toFixed(2));
  $("flV").setAttribute("opacity", clamp(Math.max(act.rv, act.lv)).toFixed(2));
  /* strain tints follow the state, not the beat */
  $("tintA").setAttribute("opacity", (0.06 + 0.30 * sm.quiv).toFixed(2));
  $("tintV").setAttribute("opacity", (0.04 + 0.30 * (1 - sm.CO)).toFixed(2));
  /* AF quiver dots over the atria */
  qdots.forEach((q) => {
    if (sm.quiv < 0.04) { if (q.vis) { q.vis = false; q.e.setAttribute("opacity", "0"); } return; }
    q.vis = true;
    q.e.setAttribute("cx", f1(q.bx + Math.sin(tm / 160 + q.s) * 7)); q.e.setAttribute("cy", f1(q.by + Math.cos(tm / 130 + q.s * 1.7) * 6));
    q.e.setAttribute("opacity", (sm.quiv * (0.35 + 0.65 * Math.abs(Math.sin(tm / 210 + q.s * 2.3)))).toFixed(2));
  });
  /* rate control parks blockers on the AV node */
  L.blockers.setAttribute("opacity", m.rate ? "1" : "0");
  if (m.rate) bl.forEach((b) => place(b.g, b.x + Math.sin(tm / 500 + b.s) * 2, b.y + Math.cos(tm / 620 + b.s) * 2, Math.sin(tm / 700 + b.s) * 25, 1));
  $("cuff").setAttribute("opacity", m.rate ? "1" : "0");
  /* blocked gate, restored wave, protected clot site */
  $("blockx").setAttribute("opacity", kind === "block" ? "1" : "0");
  marks.rhy.setAttribute("opacity", m.rhythm && m.kind === "sinus" ? "1" : "0");
  $("shield").setAttribute("opacity", m.coag && m.S0 > 0.1 ? "1" : "0");
  /* dissolve sparkles while the anticoagulant clears the clot */
  const dOp = (m.coag && sm.th > 0.12) ? clamp((sm.th - 0.12) * 2.4) : 0;
  diss.forEach((q, i) => {
    if (dOp < 0.04) { q.e.setAttribute("opacity", "0"); return; }
    const a = tm / 900 + i * 1.05;
    q.e.setAttribute("cx", f1(G.clot[0] + Math.cos(a) * 24)); q.e.setAttribute("cy", f1(G.clot[1] + Math.sin(a) * 19));
    q.e.setAttribute("opacity", (dOp * (0.4 + 0.6 * Math.abs(Math.sin(a * 2)))).toFixed(2));
  });
  /* ECG sweep */
  const rk = kind, y = signal(T, rk), speed = 92;
  sw.x += speed * dt; if (sw.x > E.x + E.w) sw.x = E.x;
  for (let i = pts.length - 1; i >= 0; i--) { if (pts[i][0] > sw.x - 1 && pts[i][0] < sw.x + 26) pts.splice(i, 1); }
  pts.push([sw.x, E.base - y * 74]);
  let d = "", prev = -1; for (let i = 0; i < pts.length; i++) { const p = pts[i]; d += (p[0] < prev || i === 0 ? "M" : "L") + f1(p[0]) + " " + f1(p[1]); prev = p[0]; }
  trace.setAttribute("d", d);
  for (let i = pulses.length - 1; i >= 0; i--) if (T - pulses[i].t > 3.5) pulses.splice(i, 1);
  noteEl.textContent = kind === "block" ? "P waves march on, QRS is slow and wide" : kind === "paced" ? "pacing spike, then the QRS" : kind === "af" || kind === "afslow" ? "no P waves, irregular QRS" : "P, QRS, T in order";
  /* clot, emboli, pacemaker, labels */
  $("pmg").setAttribute("opacity", m.kind === "paced" ? "1" : "0");
  sparkT *= Math.exp(-dt * 8); spark.setAttribute("opacity", sparkT.toFixed(2));
  const cg = $("clotg"); cg.setAttribute("opacity", clamp(sm.th * 1.2).toFixed(2)); cg.setAttribute("transform", "translate(" + G.clot[0] + " " + G.clot[1] + ") scale(" + (0.4 + 0.9 * sm.th).toFixed(2) + ") translate(" + (-G.clot[0]) + " " + (-G.clot[1]) + ")");
  $("embtrack").setAttribute("opacity", clamp(sm.th * 1.5).toFixed(2));
  embAcc += dt * (sm.th > 0.5 ? (sm.th - 0.4) * 0.9 : 0); if (embAcc >= 1) { embAcc = 0; const q = emb.find((z) => !z.on); if (q) { q.on = true; q.u = 0; q.e.setAttribute("opacity", "1"); } }
  emb.forEach((q) => { if (!q.on) return; q.u += dt * 0.35; const p = embTr.at(clamp(q.u)); q.e.setAttribute("cx", f1(p.x)); q.e.setAttribute("cy", f1(p.y)); if (q.u >= 1) { q.on = false; q.e.setAttribute("opacity", "0"); } });
  $("pl-rate").style.opacity = m.rate ? 1 : 0; $("pl-rhy").style.opacity = m.rhythm && isAF(m) ? 1 : 0; $("pl-pm").style.opacity = m.pace && m.kind === "paced" ? 1 : 0; $("pl-clot").style.opacity = sm.th > 0.3 ? 1 : 0;
  const key = drug + "|" + m.kind;
  if (key !== capKey) { capKey = key; const t = capText(drug, m.kind); if (capEl.textContent !== t) capEl.textContent = t; }
  /* gauges */
  gg.V.set(sm.V, m.words[0]); gg.R.set(sm.reg, m.regWord); gg.C.set(sm.CO, m.words[2]); gg.S.set(sm.S, m.words[3]);
}
function isAF(m) { return m.th > 0 || m.kind === "af" || m.kind === "afslow" || (m.kind === "sinus" && (m.rhythm || m.coag) && m.S0 > 0.1); }
run({ init, step });
