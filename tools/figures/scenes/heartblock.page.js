/* Heart block scene: SA node fires, AV node delays or drops, His-Purkinje conducts, escape or paced rhythm fills in; ECG drawn from the same events. */
const G = SC.GEO, E = SC.ECG, WW = SC.W;
const L = { imps: $("imps"), marks: $("marks"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const chEls = { ra: $("ch-ra"), la: $("ch-la"), rv: $("ch-rv"), lv: $("ch-lv") }, act = { ra: 0, la: 0, rv: 0, lv: 0 };
const trace = mk("path", { class: "hb-trace" }, L.ecg), noteEl = $("ecgnote"), delayFill = $("delayfill");
const tracks = { ra: track(G.inter), la: track(G.bach), his: track(G.hisTrack), lbb: track(G.lbb), rbb: track(G.rbb), esc: track([G.escape, G.apexR]) };
const dots = Array.from({ length: 8 }, () => ({ e: mk("circle", { class: "hb-imp", r: 5 }, L.imps), on: false, tr: null, u: 0, sp: 1, cb: null }));
dots.forEach((d) => d.e.setAttribute("opacity", "0"));
let hbT = 0, hbKind = "", hbMode = "", atrialTimer = 0.35, ventTimer = 1.1, atrialIdx = 0, avPulse = 0, blockFlash = 0, sparkT = 0;
const pulses = [], pts = [], holdQ = [], pacedQ = [];
const sm = { reach: 1, vent: 0.5, reg: 1, out: 0.85, delay: 0.2 };
const sw = { x: E.x };
const gg = {};
let spark = null, pillEscape = null, pillPace = null, pillAtrop = null;
function launchDot(tr, dur, cb) { const d = dots.find((q) => !q.on); if (!d) { if (cb) cb(); return; } d.on = true; d.tr = tr; d.u = 0; d.sp = 1 / Math.max(0.02, dur); d.cb = cb || null; d.e.setAttribute("opacity", "1"); const p = tr.at(0); d.e.setAttribute("cx", f1(p.x)); d.e.setAttribute("cy", f1(p.y)); }
function fireVent(k) { act.rv = 1; act.lv = 1; pulses.push({ t: hbT, k }); }
function conductDown() { launchDot(tracks.his, 0.03, null); launchDot(tracks.lbb, 0.07, () => fireVent("narrow")); launchDot(tracks.rbb, 0.07, null); }
function fireAtrial(m) {
  act.ra = 1; act.la = 1; pulses.push({ t: hbT, k: "P" });
  launchDot(tracks.la, 0.16, null);
  const idx = atrialIdx; atrialIdx++;
  let dropped = false, pr = m.prSec;
  if (m.paced) dropped = true;
  else if (m.kind === "complete") dropped = true;
  else if (m.kind === "wenckebach" && m.cycle > 0) { const pos = idx % m.cycle; pr = 0.18 + pos * 0.1; dropped = pos === m.cycle - 1; }
  else if (m.kind === "mobitz2" && m.cycle > 0) { dropped = (idx % m.cycle) === m.cycle - 1; }
  launchDot(tracks.ra, 0.1, () => { avPulse = 1; if (dropped) { if (!m.paced) blockFlash = 1; } else holdQ.push({ t: pr, cb: conductDown }); });
}
function fireEscape() { launchDot(tracks.esc, 0.22, () => fireVent("escape")); }
function firePacedBeat() { sparkT = 1; pulses.push({ t: hbT, k: "spike" }); pacedQ.push({ t: 0.06 }); }
const gauss = (x, c, s) => Math.exp(-((x - c) * (x - c)) / (2 * s * s));
function signal(t) {
  let y = 0;
  for (let i = 0; i < pulses.length; i++) { const p = pulses[i], d = t - p.t; if (d < -0.05 || d > 0.9) continue;
    if (p.k === "P") y += 0.16 * gauss(d, 0.05, 0.03);
    else if (p.k === "narrow") y += -0.1 * gauss(d, 0.005, 0.008) + 1.0 * gauss(d, 0.026, 0.011) - 0.25 * gauss(d, 0.05, 0.01) + 0.3 * gauss(d, 0.27, 0.055);
    else if (p.k === "escape") y += 0.75 * gauss(d, 0.05, 0.028) - 0.35 * gauss(d, 0.1, 0.03) - 0.22 * gauss(d, 0.34, 0.08);
    else if (p.k === "spike") y += 0.9 * gauss(d, 0, 0.003);
    else if (p.k === "paced") y += 0.7 * gauss(d, 0.05, 0.026) - 0.3 * gauss(d, 0.1, 0.03) - 0.2 * gauss(d, 0.32, 0.08); }
  return y;
}
function initPanel() {
  const Pn = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, Pn);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, Pn); t.textContent = "The rhythm";
  gg.reach = gauge(Pn, 140, y0 + 2, 52, 18, "g-reach", "Conducted", "Share of atrial signals that reach the ventricles through the AV node. Pacing bypasses the node, so this can stay low while the ventricles are paced.");
  gg.vent = gauge(Pn, 350, y0 + 2, 52, 18, "g-vent", "Ventricular rate", "How fast the ventricles beat. Dropped and blocked beats slow them, unless an escape rhythm or pacing takes over.");
  gg.reg = gauge(Pn, 560, y0 + 2, 52, 18, "g-cyt", "Regularity", "How regular the ventricular beat is. Wenckebach gives grouped beating, Mobitz II drops beats, and complete block is regular but independent of the atria.");
  gg.out = gauge(Pn, 770, y0 + 2, 52, 18, "g-good", "Output", "Blood pumped by the ventricles. A slow ventricular rate lowers it; pacing restores it.");
  const o = L.over;
  pill(o, "SA node", G.sa[0], G.sa[1], 74, 86, "Sinoatrial node: the natural pacemaker. It fires first in every degree of block shown here, so P waves keep coming.");
  pill(o, "Atria", 340, 140, 395, 86, "Atria: the two top chambers. Their firing gives the P wave, even when the signal below is blocked.");
  pill(o, "AV node delay", G.av[0], G.av[1], 138, 238, "Atrioventricular node: the normal gateway to the ventricles. It holds each signal briefly, and that hold is the delay that lengthens or fails in block.");
  pill(o, "His bundle", G.his[0], G.his[1], 356, 262, "Bundle of His: carries a signal that gets through the AV node down into the ventricles, then splits into the two bundle branches.");
  pill(o, "Purkinje fibres", 346, 308, 424, 344, "Purkinje fibres: fast fibres that spread the signal through the ventricular muscle so the ventricles fire together in a narrow QRS.");
  pill(o, "Ventricles", 130, 330, 76, 360, "Ventricles: the two lower pumping chambers. Their firing gives the QRS, whether it came through the node, an escape focus or a pacemaker lead.");
  pillEscape = pill(o, "Escape focus", G.escape[0], G.escape[1], 104, 414, "Escape focus: a backup site lower down that fires slowly and widely when no signal reaches the ventricles, as in complete block.");
  pillPace = pill(o, "Pacemaker", G.pm[0], G.pm[1] + 16, 472, 86, "Pacemaker: a pulse generator with a lead to the ventricle. It supplies the ventricular beat when the AV node drops or blocks too many signals.");
  pillAtrop = pill(o, "Atropine", G.av[0], G.av[1], 356, 196, "Atropine acts at the AV node. It can ease block at the node, in first degree and Mobitz I, but not block below the node in Mobitz II or complete block.");
  spark = mk("path", { class: "hb-spark", d: "M" + (G.pm[0] - 6) + " " + (G.pm[1] + 22) + "l6 -8l-4 8l8 -8", opacity: "0" }, L.marks);
}
function init() { initPanel(); }
function step(dt, m) {
  hbT += dt;
  const k = 1 - Math.exp(-dt * 2.2);
  sm.reach += (m.reach - sm.reach) * k; sm.vent += (m.vent - sm.vent) * k; sm.reg += (m.reg - sm.reg) * k; sm.out += (m.out - sm.out) * k; sm.delay += (m.delay - sm.delay) * k;
  const modeKey = m.kind + "|" + (m.paced ? "paced" : m.atropHelp);
  if (modeKey !== hbMode) { hbMode = modeKey; hbKind = m.kind; atrialTimer = 0.25; ventTimer = 0.9; atrialIdx = 0; holdQ.length = 0; pacedQ.length = 0; pulses.length = 0; }
  atrialTimer -= dt;
  if (atrialTimer <= 0) { atrialTimer += (m.kind === "complete" && m.atrop ? 0.82 : 1.05); fireAtrial(m); }
  if (m.paced) { ventTimer -= dt; if (ventTimer <= 0) { ventTimer += 1.05; firePacedBeat(); } }
  else if (m.kind === "complete") { ventTimer -= dt; if (ventTimer <= 0) { ventTimer += 1.9; fireEscape(); } }
  for (let i = pacedQ.length - 1; i >= 0; i--) { const q = pacedQ[i]; q.t -= dt; if (q.t <= 0) { pacedQ.splice(i, 1); launchDot(track([G.lead, G.apexL]), 0.2, () => fireVent("paced")); } }
  for (let i = holdQ.length - 1; i >= 0; i--) { const q = holdQ[i]; q.t -= dt; if (q.t <= 0) { holdQ.splice(i, 1); q.cb(); } }
  dots.forEach((d) => { if (!d.on) return; d.u += dt * d.sp; const p = d.tr.at(clamp(d.u)); d.e.setAttribute("cx", f1(p.x)); d.e.setAttribute("cy", f1(p.y)); if (d.u >= 1) { d.on = false; d.e.setAttribute("opacity", "0"); if (d.cb) d.cb(); } });
  const dec = Math.exp(-dt * 3.2);
  ["ra", "la", "rv", "lv"].forEach((n) => { act[n] *= dec; chEls[n].style.setProperty("--act", act[n].toFixed(2)); });
  avPulse *= Math.exp(-dt * 4); blockFlash *= Math.exp(-dt * 2.4); sparkT *= Math.exp(-dt * 8);
  const avEl = svg.querySelector(".hb-avnode"); if (avEl) avEl.setAttribute("r", f1(9 + 5 * avPulse + (holdQ.length ? 2 : 0)));
  $("blockx").setAttribute("opacity", (m.kind === "complete" ? 0.9 : blockFlash).toFixed(2));
  $("helpm").setAttribute("opacity", m.atropHelp === 1 ? "0.95" : m.atropHelp === -1 ? "0" : "0");
  $("delaybars").setAttribute("opacity", (0.35 + 0.65 * sm.delay).toFixed(2));
  $("pmg").setAttribute("opacity", m.paced ? "1" : m.paceStandby ? "0.45" : "0");
  if (spark) spark.setAttribute("opacity", sparkT.toFixed(2));
  if (pillEscape) pillEscape.style.opacity = m.kind === "complete" ? "1" : "0";
  if (pillPace) pillPace.style.opacity = (m.paced || m.paceStandby) ? "1" : "0";
  if (pillAtrop) pillAtrop.style.opacity = m.atrop ? "1" : "0";
  delayFill.setAttribute("width", f1(292 * clamp(sm.delay)));
  delayFill.setAttribute("class", "hb-fill" + (sm.delay > 0.85 ? " g-bad" : ""));
  const y = signal(hbT), speed = 92;
  sw.x += speed * dt; if (sw.x > E.x + E.w) sw.x = E.x;
  for (let i = pts.length - 1; i >= 0; i--) { if (pts[i][0] > sw.x - 1 && pts[i][0] < sw.x + 26) pts.splice(i, 1); }
  pts.push([sw.x, E.base - y * 74]);
  let dStr = "", prev = -1; for (let i = 0; i < pts.length; i++) { const p = pts[i]; dStr += (p[0] < prev || i === 0 ? "M" : "L") + f1(p[0]) + " " + f1(p[1]); prev = p[0]; }
  trace.setAttribute("d", dStr);
  for (let i = pulses.length - 1; i >= 0; i--) if (hbT - pulses[i].t > 3.5) pulses.splice(i, 1);
  noteEl.textContent = m.paced ? "pacing spike, then a wide QRS" : m.paceStandby ? "pacemaker present, on standby" : m.kind === "complete" ? "P waves march on, slow wide escape QRS" : m.kind === "wenckebach" ? "PR lengthens, then a beat is dropped" : m.kind === "mobitz2" ? "beats drop suddenly, no lengthening first" : m.kind === "first" ? "every beat gets through, after a long PR" : "P, then QRS after a short delay";
  gg.reach.set(sm.reach, m.reachWord); gg.vent.set(sm.vent, m.words[2]); gg.reg.set(sm.reg, m.regWord); gg.out.set(sm.out, m.words[3]);
}
run({ init, step });
