/* AF scene: pulmonary vein triggers, re-entrant wavelets, AV filtering, irregular ventricles, appendage clot, brain embolus, ECG and gauges. */
const E = SC.ECG, EBASE = E.base, ESPEED = 110;
const L = { heart: $("heart"), parts: $("parts"), ecg: $("ecg"), brain: $("brain"), over: $("over"), panel: $("panel") };
const PVX = [305, 330, 355, 375];
const RR = [0.62, 0.95, 0.71, 1.08, 0.58, 0.84, 0.73, 0.99];
const RRSUM = RR.reduce((s, v) => s + v, 0);
const sm = { af: 0.7, vRate: 0.8, irreg: 0.7, stasis: 0.5, clot: 0.4, stroke: 0.4, rate: 0, rhythm: 0, coag: 0, sinus: 0 };
const gg = {};
let atrialEls = [], ventEls = [], wavelets = [], stasisDots = [], sparks = [], clotGrp = null, brainMark = null, avMark = null, saMark = null, coagMark = null;
let ecgPath = null, ecgTxt = null, avNodeEl = null;
const acc = { trig: 0, emb: 0 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const trigDots = pool(14, () => mk("circle", { class: "sc-p p-trig", r: 2.2 }, L.parts));
const embDots = pool(6, () => mk("circle", { class: "sc-p p-emb", r: 3 }, L.parts));
const embTrack = track([[350, 300], [470, 255], [570, 285], [650, 335], [718, 350]]);
function beatPhase(tSec) {
  if (sm.af < 0.18) { const iv = 0.86; return ((tSec % iv) + iv) % iv / iv; }
  let tt = ((tSec % RRSUM) + RRSUM) % RRSUM;
  for (let i = 0; i < RR.length; i++) { if (tt < RR[i]) return tt / RR[i]; tt -= RR[i]; }
  return 0;
}
function ecgVal(tSec) {
  const p = beatPhase(tSec); let v = 0;
  if (sm.af < 0.18) { if (p > 0.08 && p < 0.20) v += 0.12 * Math.sin(Math.PI * (p - 0.08) / 0.12); }
  else { v += sm.af * (0.07 * Math.sin(tSec * 23) + 0.05 * Math.sin(tSec * 37 + 1.3) + 0.03 * Math.sin(tSec * 51)); }
  if (p > 0.20 && p < 0.245) v -= 0.14 * Math.sin(Math.PI * (p - 0.20) / 0.045);
  if (p > 0.245 && p < 0.285) v += 1.0 * Math.sin(Math.PI * (p - 0.245) / 0.04);
  if (p > 0.285 && p < 0.31) v -= 0.22 * Math.sin(Math.PI * (p - 0.285) / 0.025);
  if (p > 0.44 && p < 0.68) v += 0.28 * Math.sin(Math.PI * (p - 0.44) / 0.24);
  return v;
}
function init() {
  const H = L.heart;
  PVX.forEach((x) => { mk("path", { class: "af-vein", d: "M" + x + " 102L" + (x - 6) + " 90" }, H); mk("path", { class: "af-vein2", d: "M" + x + " 102L" + (x - 6) + " 90" }, H); });
  const ra = mk("path", { class: "af-ch", d: "M175 124Q175 102 197 102H243Q265 102 265 124V180Q265 202 243 202H197Q175 202 175 180Z" }, H);
  const la = mk("path", { class: "af-ch", d: "M285 124Q285 102 307 102H365Q387 102 387 124V180Q387 202 365 202H307Q285 202 285 180Z" }, H);
  const app = mk("ellipse", { class: "af-app", cx: 274, cy: 190, rx: 20, ry: 16 }, H);
  atrialEls = [ra, la, app];
  const rv = mk("path", { class: "af-ch", d: "M150 240Q150 218 178 218H262V388Q208 420 176 386Q150 342 150 240Z" }, H);
  const lv = mk("path", { class: "af-ch", d: "M282 218H394Q426 218 426 256Q426 340 386 390Q336 420 282 388Z" }, H);
  ventEls = [rv, lv];
  mk("path", { class: "af-septum", d: "M272 218V396" }, H);
  mk("circle", { class: "af-node", cx: 185, cy: 122, r: 7 }, H);
  avNodeEl = mk("circle", { class: "af-node", cx: 272, cy: 210, r: 8 }, H);
  mk("path", { class: "af-beam", d: "M350 300C420 270 520 260 650 335" }, H);
  PVX.forEach((x, i) => { const g = mk("g", {}, H); mk("path", { class: "af-spark", d: "M-6 0H6M0 -6V6M-4 -4L4 4M4 -4L-4 4" }, g); g.setAttribute("transform", "translate(" + (x - 6) + " 94)"); sparks.push({ g, i }); });
  const wc = [[205, 145], [238, 172], [198, 178], [320, 140], [355, 165], [312, 178], [365, 132]];
  wc.forEach(([x, y], i) => { const g = mk("g", { class: "cl" }, L.parts); mk("circle", { class: "af-wave", r: 3.2 }, g); wavelets.push({ g, cx: x, cy: y, r: 9 + (i % 3) * 4, sp: 1.6 + (i % 4) * 0.7, ph: i * 1.1 }); });
  for (let i = 0; i < 8; i++) { const g = mk("g", {}, L.parts); mk("circle", { class: "af-wave", r: 2 }, g); stasisDots.push({ g, ph: i * 0.785, rr: 6 + (i % 3) * 3 }); }
  clotGrp = mk("g", {}, L.parts);
  for (let i = 0; i < 6; i++) { const g = cell(clotGrp, { cls: "plt", r: 4.5 + (i % 3), seed: i + 4, wob: 0.15, n: 7 }); place(g, 274 + Math.cos(i * 1.4) * 7, 190 + Math.sin(i * 1.9) * 5, 0, 1); }
  for (let i = 0; i < 5; i++) mk("path", { class: "fibrin", d: "M" + (262 + i * 5) + " 182L" + (282 - i * 3) + " 198" }, clotGrp);
  avMark = mk("g", { opacity: "0" }, H); mk("circle", { class: "af-x", cx: 272, cy: 210, r: 9 }, avMark); mk("path", { class: "af-xp", d: "M268 206L276 214M276 206L268 214" }, avMark);
  saMark = mk("g", { opacity: "0" }, H); mk("circle", { class: "af-ok", cx: 185, cy: 122, r: 13 }, saMark);
  coagMark = mk("g", { opacity: "0" }, H); mk("circle", { class: "af-x", cx: 274, cy: 190, r: 10 }, coagMark); mk("path", { class: "af-xp", d: "M270 186L278 194M278 186L270 194" }, coagMark);
  const B = L.brain;
  mk("ellipse", { class: "af-brain", cx: 740, cy: 352, rx: 95, ry: 56 }, B);
  mk("path", { class: "af-vessel", d: "M668 352Q705 328 740 352T812 342" }, B);
  brainMark = mk("g", { opacity: "0" }, B); mk("circle", { class: "af-x", cx: 762, cy: 346, r: 9 }, brainMark); mk("path", { class: "af-xp", d: "M758 342L766 350M766 342L758 350" }, brainMark);
  ecgPath = mk("path", { class: "af-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 16, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. In atrial fibrillation there are no clear P waves, the baseline wavers, and QRS complexes arrive at irregular intervals. In sinus rhythm a P wave comes before each regular QRS." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  initPanel();
}
function initPanel() {
  const o = L.over;
  pill(o, "Pulmonary vein trigger", 304, 96, 150, 78, "Rapid ectopic firing from muscle sleeves around the pulmonary veins. This is the commonest trigger that starts atrial fibrillation.");
  pill(o, "Re-entrant circuits", 210, 150, 360, 78, "Many small wandering re-entrant wavelets in the atria. The wavefront breaks up, so the atria quiver instead of contracting together.");
  pill(o, "Appendage clot", 274, 190, 82, 168, "The left atrial appendage: a small pouch where blood swirls slowly in atrial fibrillation. Stasis there lets a clot form.");
  pill(o, "AV node filter", 272, 210, 482, 215, "The AV node is bombarded by atrial signals and lets only some through, at irregular intervals. That is why the pulse is irregularly irregular.");
  pill(o, "Ventricles", 340, 320, 190, 418, "The ventricles follow the irregular signals that get through the AV node. When the rate is fast, filling and output fall.");
  pill(o, "Stasis", 260, 178, 380, 418, "Stasis: blood that barely moves in the fibrillating atrium and appendage. Slow flow is one part of clot formation.");
  pill(o, "No P waves", 600, 162, 720, 275, "On the ECG there is no clear P wave before each QRS, because the atria are not beating in order.");
  pill(o, "Irregular QRS", 800, 150, 850, 275, "QRS complexes arrive at irregular intervals, with a wavy fibrillatory baseline between them.");
  pill(o, "Embolus", 660, 335, 608, 275, "A fragment of appendage clot can leave the heart with the blood flow and travel to the brain.");
  pill(o, "Stroke", 790, 330, 888, 330, "If the embolus blocks a brain artery it causes a stroke. Anticoagulation lowers this risk.");
  const pr = pill(o, "Rate control", 272, 210, 740, 425, "Rate control slows conduction through the AV node. The ventricles slow, but the atria keep fibrillating."); pr.setAttribute("id", "p-rate"); pr.style.opacity = 0;
  const ph = pill(o, "Rhythm control", 185, 122, 740, 425, "Rhythm control tries to restore and hold sinus rhythm, with an antiarrhythmic drug or cardioversion."); ph.setAttribute("id", "p-rhythm"); ph.style.opacity = 0;
  const pc = pill(o, "Anticoagulation", 274, 190, 740, 425, "Anticoagulation makes clot less likely to form and embolise, so stroke risk falls. It does not change the rhythm."); pc.setAttribute("id", "p-coag"); pc.style.opacity = 0;
  const pb = pill(o, "Combination", 272, 210, 740, 425, "Rate or rhythm control paired with anticoagulation: the rate or rhythm is treated and stroke risk is lowered."); pb.setAttribute("id", "p-combo"); pb.style.opacity = 0;
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["af", "Atrial activity", "g-cyt", "How chaotically the atria are firing. High means fibrillating, low means organised sinus activity."], ["vr", "Ventricular rate", "g-bad", "How fast the ventricles are beating. Rate control brings this down."], ["ir", "Irregularity", "g-irreg", "How irregular the ventricular rhythm is. In atrial fibrillation it is irregularly irregular."], ["st", "Stasis", "g-fl", "How slowly blood moves in the atria and appendage. Slow flow favours clot."], ["cl", "Clot", "g-clot", "Clot forming in the left atrial appendage."], ["sr", "Stroke risk", "g-bad", "Chance that a clot fragment embolises to the brain. Anticoagulation lowers it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.af = lerp(sm.af, m.af, k2); sm.vRate = lerp(sm.vRate, m.vRate, k1); sm.irreg = lerp(sm.irreg, m.irreg, k2);
  sm.stasis = lerp(sm.stasis, m.stasis, k2); sm.clot = lerp(sm.clot, m.clot, k2); sm.stroke = lerp(sm.stroke, m.stroke, k2);
  sm.rate = lerp(sm.rate, m.rate, k1); sm.rhythm = lerp(sm.rhythm, m.rhythm, k1); sm.coag = lerp(sm.coag, m.coag, k1); sm.sinus = lerp(sm.sinus, m.sinus, k2);
  const phNow = beatPhase(tm / 1000);
  const qrsPulse = (phNow > 0.245 && phNow < 0.32) ? 1 : 0;
  atrialEls.forEach((el, i) => { el.style.setProperty("--act", (sm.af * (0.45 + 0.55 * Math.abs(Math.sin(tm / 130 + i * 1.7)))).toFixed(2)); });
  ventEls.forEach((el) => { el.style.setProperty("--act", (0.25 + 0.75 * qrsPulse * (0.5 + 0.5 * sm.vRate)).toFixed(2)); });
  if (avNodeEl) avNodeEl.style.opacity = (0.45 + 0.55 * qrsPulse).toFixed(2);
  sparks.forEach((s, i) => { const sc = sm.af * (0.4 + 0.6 * Math.abs(Math.sin(tm / 110 + i * 1.3))); s.g.setAttribute("transform", "translate(" + (PVX[i] - 6) + " 94) scale(" + sc.toFixed(2) + ")"); s.g.style.opacity = sc > 0.05 ? 1 : 0; });
  wavelets.forEach((wv) => { const a = tm / 1000 * wv.sp + wv.ph, x = wv.cx + Math.cos(a) * wv.r, y = wv.cy + Math.sin(a * 1.3) * wv.r * 0.7; place(wv.g, x, y, 0, sm.af > 0.05 ? 1 : 0.01); wv.g.style.opacity = sm.af > 0.12 ? 1 : 0; });
  const swirl = 0.25 + 1.1 * (1 - sm.stasis);
  stasisDots.forEach((d) => { const a = tm / 1000 * swirl + d.ph; place(d.g, 274 + Math.cos(a) * d.rr, 190 + Math.sin(a) * d.rr * 0.7, 0, 1); d.g.style.opacity = sm.af > 0.12 ? 0.9 : 0.25; });
  if (clotGrp) { const cs = 0.12 + 0.88 * sm.clot; clotGrp.setAttribute("transform", "translate(274 190) scale(" + cs.toFixed(3) + ") translate(-274 -190)"); clotGrp.style.opacity = sm.clot > 0.06 ? 1 : 0; }
  acc.trig += dt * sm.af * 7; while (acc.trig >= 1) { acc.trig--; const p = freeP(trigDots); if (p) { const sx = PVX[Math.floor(Math.random() * PVX.length)] - 6; emitP(p, sx, 92, rnd(-8, 18), rnd(22, 38), 0); } }
  trigDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6 || p.y > 205) killP(p); });
  acc.emb += dt * sm.stroke * 0.55; while (acc.emb >= 1) { acc.emb--; const p = freeP(embDots); if (p) emitP(p, 350, 300, 0, 0, 0); }
  embDots.forEach((p) => { if (!p.on) return; p.t += dt; p.u = clamp(p.t / 3); const pt = embTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); p.e.setAttribute("opacity", p.u >= 1 ? "0" : "1"); if (p.u >= 1) killP(p); });
  if (brainMark) brainMark.setAttribute("opacity", clamp((sm.stroke - 0.35) * 1.6).toFixed(2));
  if (avMark) avMark.setAttribute("opacity", (sm.rate * (1 - sm.sinus)).toFixed(2));
  if (saMark) saMark.setAttribute("opacity", (sm.rhythm * sm.sinus).toFixed(2));
  if (coagMark) coagMark.setAttribute("opacity", (sm.coag * clamp(sm.clot * 1.4)).toFixed(2));
  $("p-rate").style.opacity = m.drug === 1 ? "1" : "0"; $("p-rhythm").style.opacity = m.drug === 2 ? "1" : "0";
  $("p-coag").style.opacity = m.drug === 3 ? "1" : "0"; $("p-combo").style.opacity = m.drug === 4 ? "1" : "0";
  let d = "";
  for (let x = E.x; x <= E.x + E.w; x += 3) { const age = (E.x + E.w - x) / ESPEED, v = ecgVal(tm / 1000 - age), y = clamp(EBASE - 42 * v, E.y + 4, E.y + E.h - 4); d += (x === E.x ? "M" : "L") + x + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  const ew = sm.af < 0.18 ? "sinus rhythm" : "atrial fibrillation"; if (ecgTxt.textContent !== ew) ecgTxt.textContent = ew;
  gg.af.set(sm.af, wordOf(sm.af, 0.18, 0.55, ["organised", "episodes", "fibrillating"]));
  gg.vr.set(sm.vRate, wordOf(sm.vRate, 0.55, 0.75, ["controlled", "moderate", "fast"]));
  gg.ir.set(sm.irreg, wordOf(sm.irreg, 0.25, 0.6, ["regular", "variable", "irregular"]));
  gg.st.set(sm.stasis, wordOf(sm.stasis, 0.25, 0.55, ["flowing", "slow", "stagnant"]));
  gg.cl.set(sm.clot, wordOf(sm.clot, 0.2, 0.5, ["none", "forming", "present"]));
  gg.sr.set(sm.stroke, wordOf(sm.stroke, 0.25, 0.55, ["low", "raised", "high"]));
}
run({ init, step });
