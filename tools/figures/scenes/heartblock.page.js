/* Heart block scene: SA node fires across real heart anatomy, AV node delays or drops, His-Purkinje conducts, escape or paced rhythm fills in; ECG drawn from the same events. */
const E = SC.ECG, WW = SC.W, PMB = SC.PM;
const L = { imps: $("imps"), marks: $("marks"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const flashA = $("flashA"), flashV = $("flashV"), trace = mk("path", { class: "hb-trace" }, L.ecg);
const noteEl = $("ecgnote"), delayFill = $("delayfill"), capEl = $("cap");
const P = { SA: [302, 129], LA: [329, 155], AV: [258, 239], HIS: [258, 277], PL: [306, 355], PR: [210, 355], ESC: [258, 323], APEX: [254, 368], VENT: [263, 319] };
let tracks = null, heartO = null;
const dots = Array.from({ length: 8 }, () => ({ e: mk("circle", { class: "hb-imp", r: 5 }, L.imps), on: false, tr: null, u: 0, sp: 1, cb: null }));
dots.forEach((d) => d.e.setAttribute("opacity", "0"));
let hbT = 0, hbKind = "", hbMode = "", atrialTimer = 0.35, ventTimer = 1.1, atrialIdx = 0, avPulse = 0, blockFlash = 0, sparkT = 0;
let actA = 0, actV = 0, capKey = "";
const pulses = [], pts = [], holdQ = [], pacedQ = [];
const sm = { reach: 1, vent: 0.5, reg: 1, out: 0.85, delay: 0.2 };
const sw = { x: E.x };
const gg = {};
let spark = null, pillEscape = null, pillPace = null, pillAtrop = null;
function setD(id, d) { $(id).setAttribute("d", d); }
function setXY(id, p) { const e = $(id); e.setAttribute("cx", f1(p[0])); e.setAttribute("cy", f1(p[1])); }
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 265, 245, 230, {});
  const hx = heartO.x, hy = heartO.y, w = heartO.w, h = heartO.h;
  P.SA = [hx + 0.16 * w, hy - 0.36 * h]; P.LA = [hx + 0.28 * w, hy - 0.28 * h];
  P.AV = [hx - 0.03 * w, hy - 0.02 * h]; P.HIS = [hx - 0.03 * w, hy + 0.10 * h];
  P.PL = [hx + 0.18 * w, hy + 0.34 * h]; P.PR = [hx - 0.24 * w, hy + 0.34 * h];
  P.ESC = [hx - 0.03 * w, hy + 0.24 * h]; P.APEX = [hx - 0.05 * w, hy + 0.38 * h];
  P.VENT = [hx - 0.01 * w, hy + 0.23 * h];
  const q = (p) => f1(p[0]) + " " + f1(p[1]);
  setD("wSA", "M" + q(P.SA) + "Q" + q([(P.SA[0] + P.LA[0]) / 2 + 8, (P.SA[1] + P.LA[1]) / 2]) + q(P.LA));
  setD("wAV", "M" + q(P.SA) + "Q" + q([(P.SA[0] + P.AV[0]) / 2 - 14, (P.SA[1] + P.AV[1]) / 2]) + q(P.AV));
  setD("wHis", "M" + q(P.AV) + "L" + q(P.HIS));
  setD("wLBB", "M" + q(P.HIS) + "Q" + q([(P.HIS[0] + P.PL[0]) / 2 + 12, (P.HIS[1] + P.PL[1]) / 2]) + q(P.PL));
  setD("wRBB", "M" + q(P.HIS) + "Q" + q([(P.HIS[0] + P.PR[0]) / 2 - 12, (P.HIS[1] + P.PR[1]) / 2]) + q(P.PR));
  setD("wEsc", "M" + q(P.ESC) + "L" + q(P.APEX));
  const pmL = [PMB[0] - 26, PMB[1]], mid1 = [(PMB[0] - 26 + P.VENT[0]) / 2 + 30, (PMB[1] + P.VENT[1]) / 2 - 40], mid2 = [(PMB[0] - 26 + P.VENT[0]) / 2 - 20, (PMB[1] + P.VENT[1]) / 2 + 40];
  setD("wLead", "M" + q(pmL) + "Q" + q(mid1) + q(mid2) + "T" + q(P.VENT));
  setXY("tipLead", P.VENT);
  setXY("ndSA", P.SA); setXY("ndAV", P.AV); setXY("ndHis", P.HIS); setXY("ndEsc", P.ESC);
  flashA.setAttribute("cx", f1(hx + 0.08 * w)); flashA.setAttribute("cy", f1(hy - 0.28 * h));
  flashA.setAttribute("rx", f1(0.30 * w)); flashA.setAttribute("ry", f1(0.14 * h));
  flashV.setAttribute("cx", f1(hx - 0.03 * w)); flashV.setAttribute("cy", f1(hy + 0.24 * h));
  flashV.setAttribute("rx", f1(0.26 * w)); flashV.setAttribute("ry", f1(0.18 * h));
  const at = (dx, dy) => "translate(" + f1(P.AV[0] + dx) + " " + f1(P.AV[1] + dy) + ")";
  $("delaybars").setAttribute("transform", at(0, 0));
  $("blockx").setAttribute("transform", at(0, 0));
  $("helpm").setAttribute("transform", at(0, 0));
  const dotsA = $("atrop").querySelectorAll("circle");
  const offs = [[-10, -10], [12, -6], [0, 14]];
  dotsA.forEach((c, i) => { c.setAttribute("cx", f1(P.AV[0] + offs[i][0])); c.setAttribute("cy", f1(P.AV[1] + offs[i][1])); });
  tracks = { ra: track([P.SA, P.AV]), la: track([P.SA, P.LA]), his: track([P.AV, P.HIS]), lbb: track([P.HIS, P.PL]), rbb: track([P.HIS, P.PR]), esc: track([P.ESC, P.APEX]), lead: track([pmL, mid1, mid2, P.VENT]) };
}
function capText(d, kind, paced, standby) {
  if (paced) return "Pacing takes over the ventricles. Rate and output recover.";
  if (standby) return "Pacemaker on standby. Signals still get through, so it does not fire.";
  if (d === 1) {
    if (kind === "first" || kind === "wenckebach") return "Atropine eases the AV node. More signals get through.";
    return "Atropine sits on the AV node. It cannot fix block below the node, so little changes.";
  }
  if (kind === "complete") return "No treatment. No signal gets through, so a slow backup beat drives the ventricles.";
  if (kind === "mobitz2") return "No treatment. Beats drop suddenly and the ventricles beat slowly.";
  if (kind === "wenckebach") return "No treatment. The wait grows until a beat is dropped.";
  if (kind === "first") return "No treatment. Every signal gets through, but after a long wait.";
  return "No block. Every signal reaches the ventricles.";
}
function launchDot(tr, dur, cb) { const d = dots.find((q) => !q.on); if (!d) { if (cb) cb(); return; } d.on = true; d.tr = tr; d.u = 0; d.sp = 1 / Math.max(0.02, dur); d.cb = cb || null; d.e.setAttribute("opacity", "1"); const p = tr.at(0); d.e.setAttribute("cx", f1(p.x)); d.e.setAttribute("cy", f1(p.y)); }
function fireVent(kind) { actV = 1; pulses.push({ t: hbT, k: kind }); }
function conductDown() { launchDot(tracks.his, 0.03, null); launchDot(tracks.lbb, 0.07, () => fireVent("narrow")); launchDot(tracks.rbb, 0.07, null); }
function fireAtrial(m) {
  actA = 1; pulses.push({ t: hbT, k: "P" });
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
  pill(o, "SA node", P.SA[0], P.SA[1], 120, 94, "Natural pacemaker at the top of the heart. It fires first in every beat shown here.");
  pill(o, "Atria", P.LA[0], P.LA[1], 440, 170, "Top chambers. Their firing gives the P wave, even when lower signals are blocked.");
  pill(o, "AV node", P.AV[0], P.AV[1], 110, 250, "Gate to the ventricles. It holds each signal briefly, and that hold is what lengthens or fails in block.");
  pill(o, "His-Purkinje", P.PL[0], P.PL[1], 445, 345, "Fast path that spreads a signal through the ventricles so they fire together.");
  pill(o, "Ventricles", P.VENT[0] - 30, P.VENT[1] + 39, 85, 355, "Lower pumping chambers. Their firing gives the QRS, whether it came through the node, an escape focus or a pacemaker lead.");
  pillEscape = pill(o, "Escape focus", P.ESC[0], P.ESC[1], 450, 395, "Backup site lower down that fires slowly when no signal reaches the ventricles.");
  pillPace = pill(o, "Pacemaker", PMB[0], PMB[1] + 16, 478, 80, "Box with a lead to the ventricle. It fires the ventricles when block slows them, and waits on standby otherwise.");
  pillAtrop = pill(o, "Atropine", P.AV[0], P.AV[1], 420, 215, "Drug dots parked on the AV node. They ease block at the node only, not block below it.");
  spark = mk("path", { class: "hb-spark", d: "M" + (PMB[0] - 6) + " " + (PMB[1] + 22) + "l6 -8l-4 8l8 -8", opacity: "0" }, L.marks);
}
function init() { initOrgans(); initPanel(); }
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
  for (let i = pacedQ.length - 1; i >= 0; i--) { const q = pacedQ[i]; q.t -= dt; if (q.t <= 0) { pacedQ.splice(i, 1); launchDot(tracks.lead, 0.2, () => fireVent("paced")); } }
  for (let i = holdQ.length - 1; i >= 0; i--) { const q = holdQ[i]; q.t -= dt; if (q.t <= 0) { holdQ.splice(i, 1); q.cb(); } }
  dots.forEach((d) => { if (!d.on) return; d.u += dt * d.sp; const p = d.tr.at(clamp(d.u)); d.e.setAttribute("cx", f1(p.x)); d.e.setAttribute("cy", f1(p.y)); if (d.u >= 1) { d.on = false; d.e.setAttribute("opacity", "0"); if (d.cb) d.cb(); } });
  const dec = Math.exp(-dt * 3.2);
  actA *= dec; actV *= dec;
  flashA.style.setProperty("--act", actA.toFixed(2)); flashV.style.setProperty("--act", actV.toFixed(2));
  avPulse *= Math.exp(-dt * 4); blockFlash *= Math.exp(-dt * 2.4); sparkT *= Math.exp(-dt * 8);
  const avEl = $("ndAV"); if (avEl) { avEl.setAttribute("r", f1(9 + 5 * avPulse + (holdQ.length ? 2 : 0))); avEl.setAttribute("class", "hb-node hb-avnode" + (m.atropHelp === 1 ? " hb-avhelp" : "")); }
  const tip = $("tipLead"); if (tip) tip.setAttribute("r", f1(4 + 5 * sparkT));
  $("blockx").setAttribute("opacity", (m.kind === "complete" ? 0.9 : blockFlash).toFixed(2));
  $("helpm").setAttribute("opacity", m.atropHelp === 1 ? "0.95" : "0");
  $("atrop").setAttribute("opacity", m.atrop ? "1" : "0");
  $("delaybars").setAttribute("opacity", (0.35 + 0.65 * sm.delay).toFixed(2));
  $("pmg").setAttribute("opacity", m.paced ? "1" : m.paceStandby ? "0.45" : "0");
  if (spark) spark.setAttribute("opacity", sparkT.toFixed(2));
  if (pillEscape) pillEscape.style.opacity = (m.kind === "complete" && !m.paced) ? "1" : "0";
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
  const ck = drug + "|" + m.kind + "|" + (m.paced ? "p" : m.paceStandby ? "s" : "-");
  if (ck !== capKey) { capKey = ck; const t = capText(drug, m.kind, m.paced, m.paceStandby); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
