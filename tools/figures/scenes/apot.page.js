/* Cardiac action potential scene: ventricular and pacemaker traces, ECG, membrane channels, particles and gauges. */
const AP = SC.AP, PM = SC.PM, EG = SC.EG;
const L = { ap: $("apg"), pm: $("pmg"), eg: $("ecg"), mem: $("mem"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { up: 0.9, plat: 0.5, repol: 0.6, dur: 0.5, rest: 0.1, pace: 0.5, Na: 0.9, Ca: 0.5, K: 0.6, QT: 0.5, naBlk: 0, kBlk: 0, caBlk: 0 };
let apTrace, apFaint, apDot, pmTrace, pmDot, egTrace, gg = {}, phaseDots = [], gates = {}, blkMarks = {};
const CH = { na: 140, ca: 275, k: 410 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const naP = pool(14, () => mk("circle", { class: "sc-p p-na", r: 3 }, L.parts));
const caP = pool(14, () => mk("circle", { class: "sc-p p-ca", r: 3.2 }, L.parts));
const kP = pool(14, () => mk("circle", { class: "sc-p p-k", r: 3 }, L.parts));
const funP = pool(10, () => mk("circle", { class: "sc-p p-fun", r: 2.8 }, L.parts));
const acc = { na: 0, ca: 0, k: 0, fun: 0 };
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
function xMark(parent, cx, cy, id) {
  const g = mk("g", { id, opacity: "0" }, parent);
  mk("circle", { class: "ap-blk", cx, cy, r: 10 }, g);
  mk("path", { class: "ap-x", d: "M" + (cx - 5) + " " + (cy - 5) + "L" + (cx + 5) + " " + (cy + 5) + "M" + (cx + 5) + " " + (cy - 5) + "L" + (cx - 5) + " " + (cy + 5) }, g);
  return g;
}
function init() {
  apFaint = mk("path", { class: "ap-faint" }, L.ap);
  apTrace = mk("path", { class: "ap-trace" }, L.ap);
  pmTrace = mk("path", { class: "pm-trace" }, L.pm);
  egTrace = mk("path", { class: "eg-trace" }, L.eg);
  apDot = mk("circle", { class: "ap-dot", r: 5 }, L.ap);
  pmDot = mk("circle", { class: "pm-dot", r: 5 }, L.pm);
  const infos = [
    "Phase 4 and phase 0: the cell rests, then fast sodium channels open and sodium rushes in. The trace shoots up.",
    "Phase 0: fast sodium entry. A sodium channel blocker makes this rise slower and smaller.",
    "Phase 1: a brief notch as early potassium efflux starts and sodium channels shut.",
    "Phase 2: the plateau. Calcium entry through L-type channels balances potassium efflux and triggers contraction.",
    "Phase 3 and phase 4: calcium channels close, potassium leaves the cell, and the trace falls back to rest.",
  ];
  for (let i = 0; i < 5; i++) {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": infos[i] }, L.ap);
    mk("circle", { class: "ap-phase", r: 10 }, g);
    const t = mk("text", { class: "ap-phase-t", "text-anchor": "middle", y: 3.5 }, g); t.textContent = String(i === 0 ? 4 : i - 1 === 0 ? 0 : i - 1);
    if (i === 0) t.textContent = "4"; else t.textContent = String(i - 1);
    phaseDots.push(g);
  }
  /* membrane, left */
  const memY = 367;
  mk("rect", { class: "ap-mem", x: 36, y: memY, width: 512, height: 9, rx: 4 }, L.mem);
  mk("rect", { class: "ap-mem2", x: 36, y: memY + 11, width: 512, height: 7, rx: 3 }, L.mem);
  const outT = mk("text", { class: "ap-lab", x: 542, y: 348, "text-anchor": "end" }, L.mem); outT.textContent = "outside";
  const inT = mk("text", { class: "ap-lab", x: 542, y: 424, "text-anchor": "end" }, L.mem); inT.textContent = "inside cell";
  gates.na = makeChannel(L.mem, CH.na, "ap-chan-na", memY + 8);
  gates.ca = makeChannel(L.mem, CH.ca, "ap-chan-ca", memY + 8);
  gates.k = makeChannel(L.mem, CH.k, "ap-chan-k", memY + 8);
  blkMarks.na = xMark(L.mem, CH.na, memY - 25, "blk-na");
  blkMarks.ca = xMark(L.mem, CH.ca, memY - 25, "blk-ca");
  blkMarks.k = xMark(L.mem, CH.k, memY - 25, "blk-k");
  /* membrane, right: pacemaker funny channel */
  const rY = 396;
  mk("rect", { class: "ap-mem", x: 628, y: rY, width: 296, height: 9, rx: 4 }, L.mem);
  mk("rect", { class: "ap-mem2", x: 628, y: rY + 11, width: 296, height: 7, rx: 3 }, L.mem);
  gates.fun = makeChannel(L.mem, 720, "ap-chan-fun", rY + 8);
  /* labels */
  const o = L.over;
  pill(o, "Na channel", CH.na, 349, 110, 318, "Fast voltage-gated sodium channel. It opens for phase 0, then shuts until the cell rests again.");
  pill(o, "Ca channel", CH.ca, 349, 285, 318, "L-type calcium channel. Calcium entry holds the phase 2 plateau and triggers contraction. A blocker shortens the plateau.");
  pill(o, "K channel", CH.k, 349, 445, 318, "Potassium channels. Potassium leaving the cell drives phase 3 repolarisation. A blocker prolongs the action potential and the QT.");
  pill(o, "Pacemaker", 790, 104, 858, 102, "Pacemaker cell of the sinoatrial node. It has no stable rest: its potential drifts up to threshold, then fires with a slower calcium-driven rise.");
  pill(o, "ECG", 686, 252, 856, 250, "One ECG lead. The QRS is ventricular depolarisation in phase 0 and the T wave is repolarisation in phase 3, so a longer plateau gives a longer QT.");
  pill(o, "Funny current", 720, 386, 720, 362, "The funny current: a slow inward current in pacemaker cells that gives the phase 4 slope. A calcium channel blocker flattens this rise.");
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The cell and ECG";
  [["na", "Sodium in", "g-na", "Sodium entry in phase 0. It sets how fast and how tall the upstroke is."], ["ca", "Calcium in", "g-ca", "Calcium entry in phase 2. It holds the plateau."], ["k", "Potassium out", "g-k", "Potassium efflux in phase 3. It repolarises the cell."], ["dur", "AP duration", "g-fl", "How long the whole action potential lasts, from upstroke to rest."], ["rest", "Rest level", "g-bad", "How negative the resting potential is. High outside potassium makes it less negative."], ["qt", "QT interval", "g-good", "The ECG time from QRS to the end of the T wave. It follows the action potential duration."]]
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
  gates.na.setAttribute("opacity", (0.25 + 0.75 * inPhase(T.u0, T.u1 + 0.03)).toFixed(2));
  gates.ca.setAttribute("opacity", (0.25 + 0.75 * inPhase(T.notch, T.platEnd)).toFixed(2));
  gates.k.setAttribute("opacity", (0.25 + 0.75 * inPhase(T.platEnd, T.repolEnd)).toFixed(2));
  gates.fun.setAttribute("opacity", (0.3 + 0.7 * (cyc < p.su ? 1 : 0.2)).toFixed(2));
  blkMarks.na.setAttribute("opacity", sm.naBlk.toFixed(2));
  blkMarks.k.setAttribute("opacity", sm.kBlk.toFixed(2));
  blkMarks.ca.setAttribute("opacity", sm.caBlk.toFixed(2));
  acc.na += dt * sm.Na * inPhase(T.u0 - 0.02, T.u1 + 0.04) * 9;
  while (acc.na >= 1) { acc.na--; const q = free(naP); if (q) emit(q, CH.na + rnd(-6, 6), 332, rnd(-3, 3), 52, 0); }
  acc.ca += dt * sm.Ca * inPhase(T.notch, T.platEnd) * 7;
  while (acc.ca >= 1) { acc.ca--; const q = free(caP); if (q) emit(q, CH.ca + rnd(-6, 6), 332, rnd(-3, 3), 44, 0); }
  acc.k += dt * sm.K * inPhase(T.platEnd - 0.02, T.repolEnd + 0.03) * 8;
  while (acc.k >= 1) { acc.k--; const q = free(kP); if (q) emit(q, CH.k + rnd(-6, 6), 404, rnd(-3, 3), -46, 0); }
  acc.fun += dt * sm.pace * (cyc < p.su ? 6 : 1);
  while (acc.fun >= 1) { acc.fun--; const q = free(funP); if (q) emit(q, 720 + rnd(-5, 5), 366, rnd(-2, 2), 34, 0); }
  [[naP, 330, 408], [caP, 330, 408], [funP, 364, 420]].forEach(([pl, lo, hi]) => pl.forEach((q) => { if (!q.on) return; q.t += dt; q.x = clamp(q.x + q.vx * dt, 44, 932); q.y += q.vy * dt; q.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (q.y < lo || q.y > hi) kill(q); }));
  kP.forEach((q) => { if (!q.on) return; q.t += dt; q.x = clamp(q.x + q.vx * dt, 44, 932); q.y += q.vy * dt; q.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (q.y < 330) kill(q); });
  gg.na.set(sm.Na, wordOf(sm.Na, 0.4, 0.75, ["low", "normal", "high"]));
  gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.35, 0.7, ["low", "normal", "high"]));
  gg.k.set(sm.K, wordOf(sm.K, 0.38, 0.75, ["low", "normal", "high"]));
  gg.dur.set(sm.dur, wordOf(sm.dur, 0.4, 0.75, ["short", "normal", "long"]));
  gg.rest.set(sm.rest, wordOf(sm.rest, 0.3, 0.65, ["stable", "less negative", "depolarised"]));
  gg.qt.set(sm.QT, wordOf(sm.QT, 0.4, 0.75, ["short", "normal", "long"]));
}
run({ init, step });
