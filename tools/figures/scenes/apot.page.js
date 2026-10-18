/* Cardiac action potential scene: heart organ, ventricular and pacemaker traces, ECG, wall channels, blocker plugs, particles and gauges. */
const AP = SC.AP, PM = SC.PM, EG = SC.EG, HX = SC.HX, HY = SC.HY, HW = SC.HW, MEM = SC.MEM;
const L = { ap: $("apg"), pm: $("pmg"), eg: $("ecg"), mem: $("mem"), sig: $("sig"), parts: $("parts"), over: $("over"), panel: $("panel"), glow: $("beatGlow") };
const sm = { up: 0.9, plat: 0.5, repol: 0.6, dur: 0.5, rest: 0.1, pace: 0.5, Na: 0.9, Ca: 0.5, K: 0.6, QT: 0.5, naBlk: 0, kBlk: 0, caBlk: 0 };
let apTrace, apFaint, apDot, pmTrace, pmDot, egTrace, gg = {}, phaseDots = [], gates = {}, plugs = {}, capEl = null, capDrug = -1;
let heartO = null, saDot = null, apexDot = null, condDot = null, condTrack = null, saXY = [HX + 16, HY - 66], apexXY = [HX + 26, HY + 71];
const CH = { na: 290, ca: 395, k: 500 };
const MEMY = MEM.y, CY = MEMY + 8, DOCK = MEMY - 27;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const naP = pool(14, () => mk("circle", { class: "sc-p p-na", r: 3 }, L.parts));
const caP = pool(14, () => mk("circle", { class: "sc-p p-ca", r: 3.2 }, L.parts));
const kP = pool(16, () => mk("circle", { class: "sc-p p-k", r: 3 }, L.parts));
const funP = pool(10, () => mk("circle", { class: "sc-p p-fun", r: 2.8 }, L.parts));
const acc = { na: 0, ca: 0, k: 0, trap: 0, fun: 0 };
const smooth = (u) => { const v = clamp(u); return v * v * (3 - 2 * v); };
function timings() {
  const u0 = 0.18, uw = 0.025 + (1 - sm.up) * 0.07, u1 = u0 + uw, notch = u1 + 0.04;
  const platEnd = notch + 0.16 + sm.dur * 0.30, repolEnd = platEnd + 0.06 + (1 - sm.repol) * 0.11;
  return { u0, u1, notch, platEnd, repolEnd };
}
function apV(u) {
  const T = timings(), restY = AP.base - sm.rest * 26, peakY = AP.peak + (1 - sm.up) * 30;
  const platLevel = 0.84 - (1 - sm.plat) * 0.22;
  let v = 0;
  if (u < T.u0) v = 0;
  else if (u < T.u1) v = smooth((u - T.u0) / (T.u1 - T.u0));
  else if (u < T.notch) v = 1 - 0.14 * smooth((u - T.u1) / (T.notch - T.u1));
  else if (u < T.platEnd) v = platLevel - 0.05 * smooth((u - T.notch) / Math.max(0.01, T.platEnd - T.notch));
  else if (u < T.repolEnd) v = (platLevel - 0.05) * (1 - smooth((u - T.platEnd) / (T.repolEnd - T.platEnd)));
  else v = 0;
  return { v, y: restY - v * (restY - peakY), restY, peakY };
}
function pmV(u) {
  const su = 0.58 - sm.pace * 0.18, u1 = su + 0.08, repolEnd = u1 + 0.16;
  let v = 0;
  if (u < su) v = 0.38 * smooth(u / su * 0.9 + 0.05);
  else if (u < u1) v = 0.38 + 0.62 * smooth((u - su) / (u1 - su));
  else if (u < repolEnd) v = 1 - smooth((u - u1) / (repolEnd - u1));
  else v = 0.02;
  return { v, y: PM.base - v * (PM.base - PM.peak), su, u1, repolEnd };
}
function ecgV(u) {
  const T = timings();
  let v = 0;
  if (u > T.u0 - 0.10 && u < T.u0 - 0.02) v += 0.14 * Math.sin(Math.PI * (u - (T.u0 - 0.10)) / 0.08);
  if (u > T.u0 - 0.015 && u < T.u0 + 0.005) v -= 0.16 * Math.sin(Math.PI * (u - (T.u0 - 0.015)) / 0.02);
  if (u > T.u0 + 0.005 && u < T.u1 + 0.01) v += 1 * Math.sin(Math.PI * (u - (T.u0 + 0.005)) / Math.max(0.02, T.u1 - T.u0));
  if (u > T.u1 + 0.01 && u < T.u1 + 0.035) v -= 0.24 * Math.sin(Math.PI * (u - (T.u1 + 0.01)) / 0.025);
  const tc = T.repolEnd + 0.05;
  if (u > tc - 0.05 && u < tc + 0.07) v += 0.34 * Math.sin(Math.PI * (u - (tc - 0.05)) / 0.12);
  return v;
}
function makeChannel(parent, cx, cls, cy) {
  const g = mk("g", {}, parent);
  mk("rect", { class: cls, x: cx - 13, y: cy - 18, width: 26, height: 36, rx: 6 }, g);
  const gate = mk("rect", { class: "ap-gate", x: cx - 3, y: cy - 14, width: 6, height: 28, rx: 3 }, g);
  return gate;
}
function makePlug(parent) {
  const g = mk("g", { opacity: "0" }, parent);
  mk("circle", { class: "ap-plug", cx: 0, cy: 0, r: 9 }, g);
  mk("circle", { class: "ap-plug-hi", cx: -3, cy: -3, r: 2.6 }, g);
  return g;
}
function capText(d) {
  if (d === 1) return "Sodium blocker plugs the sodium channel. The beat starts slowly and weakly.";
  if (d === 2) return "Potassium blocker plugs the potassium channel. Potassium is trapped and the QT is long.";
  if (d === 3) return "Calcium blocker plugs the calcium channel. The plateau is short and the pacemaker slows.";
  return "No treatment. Sodium starts the beat, calcium holds it, potassium resets the cell.";
}
function init() {
  apFaint = mk("path", { class: "ap-faint", fill: "none" }, L.ap);
  apTrace = mk("path", { class: "ap-trace", fill: "none" }, L.ap);
  pmTrace = mk("path", { class: "pm-trace", fill: "none" }, L.pm);
  egTrace = mk("path", { class: "eg-trace", fill: "none" }, L.eg);
  apDot = mk("circle", { class: "ap-dot", r: 5 }, L.ap);
  pmDot = mk("circle", { class: "pm-dot", r: 5 }, L.pm);
  const infos = [
    "Rest and upstroke. The cell waits, then sodium gates open and sodium rushes in. The trace shoots up.",
    "Upstroke. Fast sodium entry. A sodium blocker makes this rise slower and smaller.",
    "Notch. A brief dip as early potassium flow starts and sodium gates shut.",
    "Plateau. Calcium entry balances potassium outflow and holds the trace up while the cell contracts.",
    "Reset and rest. Calcium gates close, potassium leaves, and the trace falls back to rest.",
  ];
  for (let i = 0; i < 5; i++) {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": infos[i] }, L.ap);
    mk("circle", { class: "ap-phase", r: 10 }, g);
    const t = mk("text", { class: "ap-phase-t", y: 3.5 }, g); t.textContent = String(i === 0 ? 4 : i - 1);
    phaseDots.push(g);
  }
  /* heart organ with real anatomy; wall strip below is a zoom of its wall */
  heartO = organ($("heartSlot"), "heart", HX, HY, HW, {});
  const hw = heartO.w, hh = heartO.h;
  saXY = [Math.round(heartO.x + hw * 0.12), Math.round(heartO.y - hh * 0.36)];
  const ap = heartO.ports.apex || [heartO.x + hw * 0.2, heartO.y + hh * 0.47];
  apexXY = [Math.round(ap[0]), Math.round(ap[1] - 15)];
  const zx = f1(heartO.x + hw * 0.47);
  $("zoomA").setAttribute("d", "M" + zx + " " + f1(heartO.y - hh * 0.15) + " L" + f1(MEM.x) + " " + f1(MEMY - 3));
  $("zoomB").setAttribute("d", "M" + zx + " " + f1(heartO.y + hh * 0.21) + " L" + f1(MEM.x) + " " + f1(MEMY + 21));
  const cond = mk("path", { class: "ap-cond", d: "M" + f1(saXY[0]) + " " + f1(saXY[1]) + "L" + f1((saXY[0] + apexXY[0]) / 2 + 8) + " " + f1((saXY[1] + apexXY[1]) / 2) + "L" + f1(apexXY[0]) + " " + f1(apexXY[1]), fill: "none" }, L.sig);
  condTrack = track([[saXY[0], saXY[1]], [(saXY[0] + apexXY[0]) / 2 + 8, (saXY[1] + apexXY[1]) / 2], [apexXY[0], apexXY[1]]]);
  cond.setAttribute("opacity", "0.55");
  saDot = mk("circle", { class: "ap-sa", r: 5 }, L.sig);
  apexDot = mk("circle", { class: "sc-p p-na", r: 4 }, L.sig);
  condDot = mk("circle", { class: "sc-p p-fun", r: 3 }, L.sig);
  /* zoomed wall strip with the three channels */
  mk("rect", { class: "ap-mem", x: MEM.x, y: MEMY, width: MEM.w, height: 9, rx: 4 }, L.mem);
  mk("rect", { class: "ap-mem2", x: MEM.x, y: MEMY + 11, width: MEM.w, height: 7, rx: 3 }, L.mem);
  gates.na = makeChannel(L.mem, CH.na, "ap-chan-na", CY);
  gates.ca = makeChannel(L.mem, CH.ca, "ap-chan-ca", CY);
  gates.k = makeChannel(L.mem, CH.k, "ap-chan-k", CY);
  plugs.na = makePlug(L.mem); plugs.ca = makePlug(L.mem); plugs.k = makePlug(L.mem);
  /* right side: pacemaker funny channel */
  const rY = 396;
  mk("rect", { class: "ap-mem", x: 628, y: rY, width: 296, height: 9, rx: 4 }, L.mem);
  mk("rect", { class: "ap-mem2", x: 628, y: rY + 11, width: 296, height: 7, rx: 3 }, L.mem);
  gates.fun = makeChannel(L.mem, 720, "ap-chan-fun", rY + 8);
  /* labels: eight short pills, left to right, top to bottom */
  const o = L.over;
  pill(o, "Heart", 95, 335, 52, 300, "Heart muscle. Each beat starts in the pacemaker, spreads through the heart, and shows on the ECG.");
  pill(o, "Wall zoom", 250, 371, 245, 412, "Zoomed wall of the heart. The coloured gates are the ion channels of one heart cell.");
  pill(o, "Na channel", CH.na, CY, 255, 316, "Fast sodium gates. They open for the upstroke, then shut until the cell rests again.");
  pill(o, "Ca channel", CH.ca, CY, 395, 300, "Calcium gates. Calcium entry holds the plateau and starts contraction. A blocker shortens it.");
  pill(o, "K channel", CH.k, CY, 535, 316, "Potassium gates. Potassium leaving resets the cell. A blocker traps potassium and lengthens the QT.");
  pill(o, "Beat trace", 300, 140, 300, 100, "One heart cell beating over time. Rise, hump, fall, rest. Drugs reshape it.");
  pill(o, "Pacemaker", 770, 148, 800, 100, "Pacemaker cell. It has no fixed rest and climbs slowly until it fires.");
  pill(o, "ECG", 700, 300, 800, 258, "One ECG lead. The spike is the ventricles firing and the hump is them resetting.");
  capEl = mk("text", { class: "ap-cap", x: 205, y: 444 }, o); capEl.textContent = capText(0);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The cell and ECG";
  [["na", "Sodium in", "g-na", "Sodium entry for the upstroke. It sets how fast and tall the rise is."], ["ca", "Calcium in", "g-ca", "Calcium entry for the plateau. It holds the trace up."], ["k", "Potassium out", "g-k", "Potassium outflow for the reset. It brings the cell back to rest."], ["dur", "AP duration", "g-fl", "How long the whole beat lasts, from rise to rest."], ["rest", "Rest level", "g-bad", "How deep the resting level sits. High outside potassium lifts it."], ["qt", "QT interval", "g-good", "The ECG time from spike to the end of the hump. It follows the beat length."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
function tracePath() {
  let d = "", d2 = "", d3 = "";
  for (let i = 0; i <= 90; i++) {
    const u = i / 90, a = apV(u), p = pmV(u), e = ecgV(u);
    d += (i ? "L" : "M") + f1(AP.x + u * AP.w) + " " + f1(a.y);
    d2 += (i ? "L" : "M") + f1(PM.x + u * PM.w) + " " + f1(p.y);
    const ey = clamp(EG.base - e * 62, EG.y + 6, EG.y + EG.h - 6);
    d3 += (i ? "L" : "M") + f1(EG.x + u * EG.w) + " " + f1(ey);
  }
  apTrace.setAttribute("d", d); pmTrace.setAttribute("d", d2); egTrace.setAttribute("d", d3);
  apFaint.setAttribute("d", d);
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  ["up", "Na", "naBlk", "kBlk", "caBlk"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["plat", "repol", "dur", "rest", "pace", "Ca", "K", "QT"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  tracePath();
  const cyc = (tm / 3400) % 1, T = timings(), a = apV(cyc), p = pmV(cyc);
  apDot.setAttribute("cx", f1(AP.x + cyc * AP.w)); apDot.setAttribute("cy", f1(a.y));
  pmDot.setAttribute("cx", f1(PM.x + cyc * PM.w)); pmDot.setAttribute("cy", f1(p.y));
  const us = [0.09, (T.u0 + T.u1) / 2, T.u1 + 0.02, (T.notch + T.platEnd) / 2, (T.platEnd + T.repolEnd) / 2];
  phaseDots.forEach((g, i) => { const pt = apV(clamp(us[i])); place(g, AP.x + clamp(us[i]) * AP.w, pt.y - 18, 0, 1); });
  const inPhase = (lo, hi) => cyc >= lo && cyc < hi ? 1 : 0.25;
  gates.na.setAttribute("opacity", (inPhase(T.u0, T.u1 + 0.03) * (1 - 0.7 * sm.naBlk)).toFixed(2));
  gates.ca.setAttribute("opacity", (inPhase(T.notch, T.platEnd) * (1 - 0.7 * sm.caBlk)).toFixed(2));
  gates.k.setAttribute("opacity", (inPhase(T.platEnd, T.repolEnd) * (1 - 0.7 * sm.kBlk)).toFixed(2));
  gates.fun.setAttribute("opacity", (0.3 + 0.7 * (cyc < p.su ? 1 : 0.2)).toFixed(2));
  /* blocker plugs slide onto their channel and sit there, bobbing */
  const plugAt = (g, cx, blk) => { place(g, cx, DOCK - (1 - blk) * 34 + Math.sin(tm / 500 + cx) * 1.5 * blk, 0, 1); g.setAttribute("opacity", blk.toFixed(2)); };
  plugAt(plugs.na, CH.na, sm.naBlk); plugAt(plugs.ca, CH.ca, sm.caBlk); plugAt(plugs.k, CH.k, sm.kBlk);
  /* heart flash follows the beat: weaker when the upstroke or plateau is drugged down */
  const beat = Math.max(inPhase(T.u0, T.u1 + 0.03), inPhase(T.notch, T.platEnd) * 0.8);
  L.glow.setAttribute("opacity", (beat * (0.08 + 0.5 * clamp(sm.Ca) * clamp(sm.up))).toFixed(2));
  const upPulse = inPhase(T.u0, T.u1 + 0.05);
  place(apexDot, apexXY[0], apexXY[1], 0, 1 + 0.35 * upPulse); apexDot.setAttribute("opacity", (upPulse * (0.2 + 0.8 * clamp(sm.up))).toFixed(2));
  place(saDot, saXY[0], saXY[1], 0, 1); saDot.setAttribute("opacity", (cyc < p.su ? 0.3 + 0.7 * (cyc / Math.max(0.01, p.su)) : 1).toFixed(2));
  const cu = (tm / 1400 * (0.35 + sm.pace)) % 1, cq = condTrack.at(cu);
  place(condDot, cq.x, cq.y, 0, 1); condDot.setAttribute("opacity", (0.25 + 0.65 * sm.pace).toFixed(2));
  /* ions cross the zoomed wall; blocked ions stop and potassium piles up inside */
  acc.na += dt * sm.Na * inPhase(T.u0 - 0.02, T.u1 + 0.04) * 9 * (1 - 0.92 * sm.naBlk);
  while (acc.na >= 1) { acc.na--; const q = free(naP); if (q) emit(q, CH.na + rnd(-6, 6), 332, rnd(-3, 3), 52, 0); }
  acc.ca += dt * sm.Ca * inPhase(T.notch, T.platEnd) * 7 * (1 - 0.92 * sm.caBlk);
  while (acc.ca >= 1) { acc.ca--; const q = free(caP); if (q) emit(q, CH.ca + rnd(-6, 6), 332, rnd(-3, 3), 44, 0); }
  acc.k += dt * sm.K * inPhase(T.platEnd - 0.02, T.repolEnd + 0.03) * 8 * (1 - 0.92 * sm.kBlk);
  while (acc.k >= 1) { acc.k--; const q = free(kP); if (q) emit(q, CH.k + rnd(-6, 6), 404, rnd(-3, 3), -46, 0); }
  acc.trap += dt * 4 * sm.kBlk;
  while (acc.trap >= 1) { acc.trap--; const q = free(kP); if (q) emit(q, CH.k + rnd(-9, 9), 404 + rnd(0, 8), rnd(-6, 6), rnd(4, 14), 1); }
  acc.fun += dt * sm.pace * (cyc < p.su ? 6 : 1);
  while (acc.fun >= 1) { acc.fun--; const q = free(funP); if (q) emit(q, 720 + rnd(-5, 5), 366, rnd(-2, 2), 34, 0); }
  [[naP, 330, 420], [caP, 330, 420], [funP, 364, 420]].forEach(([pl, lo, hi]) => pl.forEach((q) => { if (!q.on) return; q.t += dt; q.x = clamp(q.x + q.vx * dt, 44, 932); q.y += q.vy * dt; q.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (q.y < lo || q.y > hi) kill(q); }));
  kP.forEach((q) => { if (!q.on) return; q.t += dt;
    if (q.k === 1) { q.x = clamp(q.x + q.vx * dt + Math.sin(tm / 300 + q.y) * 8 * dt, 440, 560); q.y += q.vy * dt * 0.5; q.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); q.e.setAttribute("opacity", clamp(1 - (q.t - 2.2) / 1).toFixed(2)); if (q.t > 3.2 || q.y > 430) kill(q); }
    else { q.x = clamp(q.x + q.vx * dt, 44, 932); q.y += q.vy * dt; q.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (q.y < 330) kill(q); } });
  gg.na.set(sm.Na, wordOf(sm.Na, 0.4, 0.75, ["low", "normal", "high"]));
  gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.35, 0.7, ["low", "normal", "high"]));
  gg.k.set(sm.K, wordOf(sm.K, 0.38, 0.75, ["low", "normal", "high"]));
  gg.dur.set(sm.dur, wordOf(sm.dur, 0.4, 0.75, ["short", "normal", "long"]));
  gg.rest.set(sm.rest, wordOf(sm.rest, 0.3, 0.65, ["stable", "less negative", "depolarised"]));
  gg.qt.set(sm.QT, wordOf(sm.QT, 0.4, 0.75, ["short", "normal", "long"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
