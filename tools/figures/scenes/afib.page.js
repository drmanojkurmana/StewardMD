/* AF scene: vein triggers, atrial wavelets, AV node filter, appendage clot to brain, ECG and gauges. */
const E = SC.ECG, EBASE = E.base, ESPEED = 110;
const L = { heart: $("heart"), parts: $("parts"), ecg: $("ecg"), brain: $("brain"), over: $("over"), panel: $("panel") };
let heartO = null, brainO = null, capEl = null, capDrug = -1;
let AV = [278, 235], SAN = [355, 213], APP = [188, 225], VEN = [305, 300], BRN = [729, 328];
const PVX = [245, 265, 285, 305];
let embTrack = null, condTrack = null;
const RR = [0.62, 0.95, 0.71, 1.08, 0.58, 0.84, 0.73, 0.99];
const RRSUM = RR.reduce((s, v) => s + v, 0);
const sm = { af: 0.7, vRate: 0.8, irreg: 0.7, stasis: 0.5, clot: 0.4, stroke: 0.4, rate: 0, rhythm: 0, coag: 0, sinus: 0 };
const gg = {};
let zA = null, zV = null, avNodeEl = null, saNodeEl = null, condEl = null;
let wavelets = [], stasisDots = [], sparks = [], rings = [], clotGrp = null, brainMark = null, avMark = null, saMark = null, coagMark = null;
let ecgPath = null, ecgTxt = null;
const acc = { trig: 0, emb: 0, cond: 0 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const trigDots = pool(14, () => mk("circle", { class: "sc-p p-trig", r: 2.2 }, L.parts));
const embDots = pool(6, () => mk("circle", { class: "sc-p p-emb", r: 3 }, L.parts));
const condDots = pool(8, () => mk("circle", { class: "sc-p p-cond", r: 2.4 }, L.parts));
const rateDots = pool(8, () => mk("circle", { class: "sc-p p-rate", r: 3 }, L.parts));
const rhyDots = pool(10, () => mk("circle", { class: "sc-p p-rhy", r: 2.6 }, L.parts));
const coagDots = pool(10, () => mk("circle", { class: "sc-p p-coag", r: 2.6 }, L.parts));
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 280, 250, 250, {});
  brainO = organ($("brainSlot"), "brain", 742, 338, 165, {});
  const hx = heartO.x, hy = heartO.y, hs = heartO.w / 100;
  AV = [Math.round(hx - hs), Math.round(hy - 6 * hs)];
  SAN = [Math.round(hx + 30 * hs), Math.round(hy - 15 * hs)];
  APP = [Math.round(hx - 37 * hs), Math.round(hy - 10 * hs)];
  VEN = [Math.round(hx + 10 * hs), Math.round(hy + 20 * hs)];
  const bp = brainO.ports.parenchyma;
  BRN = [Math.round(bp[0]), Math.round(bp[1])];
  condTrack = track([AV, [Math.round(hx - 4 * hs), Math.round(hy + 7 * hs)], VEN]);
  embTrack = track([[Math.round(hx + 16 * hs), Math.round(hy + 30 * hs)], [332, 240], [318, 170], [292, 128], [380, 190], [470, 260], [560, 300], [650, 320], BRN]);
}
function capText(d) {
  if (d === 1) return "Rate control plugs the AV node. The pulse slows although the atria still quiver.";
  if (d === 2) return "Rhythm control calms the vein triggers and restores one orderly beat.";
  if (d === 3) return "Anticoagulation traps clot material so less reaches the brain. The rhythm is unchanged.";
  if (d === 4) return "The combination steadies the beat and lowers the chance of a clot reaching the brain.";
  return "No treatment. The atria quiver, the pulse is fast and uneven, and a clot can reach the brain.";
}
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
  initOrgans();
  const H = L.heart;
  PVX.forEach((x) => { mk("path", { class: "af-vein2", d: "M" + x + " 112L" + x + " 138" }, H); });
  zA = mk("ellipse", { class: "af-zA", cx: 280, cy: 205, rx: 92, ry: 38 }, H);
  zV = mk("ellipse", { class: "af-zV", cx: 290, cy: 315, rx: 80, ry: 55 }, H);
  mk("path", { class: "af-beam", d: "M320 325C332 240 318 170 292 128C340 160 400 210 470 260C540 302 620 318 698 328" }, H);
  condEl = mk("path", { class: "af-beam", d: "M" + AV[0] + " " + AV[1] + "L" + (AV[0] - 8) + " " + (AV[1] + 33) + "L" + VEN[0] + " " + VEN[1] }, H);
  saNodeEl = mk("circle", { class: "af-node", cx: SAN[0], cy: SAN[1], r: 7 }, H);
  avNodeEl = mk("circle", { class: "af-node", cx: AV[0], cy: AV[1], r: 8 }, H);
  PVX.forEach((x, i) => { const g = mk("g", {}, H); mk("path", { class: "af-spark", d: "M-6 0H6M0 -6V6M-4 -4L4 4M4 -4L-4 4" }, g); g.setAttribute("transform", "translate(" + x + " 116)"); sparks.push({ g, i }); });
  const wc = [[230, 195], [270, 208], [310, 200], [250, 220], [330, 190], [290, 195], [350, 215]];
  wc.forEach(([x, y], i) => { const g = mk("g", { class: "cl" }, L.parts); mk("circle", { class: "af-wave", r: 3.2 }, g); wavelets.push({ g, cx: x, cy: y, r: 9 + (i % 3) * 4, sp: 1.6 + (i % 4) * 0.7, ph: i * 1.1 }); });
  for (let i = 0; i < 2; i++) { const r = mk("ellipse", { class: "af-ok", cx: SAN[0], cy: SAN[1], rx: 14, ry: 5 }, H); rings.push(r); }
  for (let i = 0; i < 8; i++) { const g = mk("g", {}, L.parts); mk("circle", { class: "af-wave", r: 2 }, g); stasisDots.push({ g, ph: i * 0.785, rr: 5 + (i % 3) * 3 }); }
  clotGrp = mk("g", {}, L.parts);
  for (let i = 0; i < 6; i++) { const g = cell(clotGrp, { cls: "plt", r: 4.5 + (i % 3), seed: i + 4, wob: 0.15, n: 7 }); place(g, APP[0] + Math.cos(i * 1.4) * 7, APP[1] + Math.sin(i * 1.9) * 5, 0, 1); }
  for (let i = 0; i < 5; i++) mk("path", { class: "fibrin", d: "M" + (APP[0] - 12 + i * 5) + " " + (APP[1] - 8) + "L" + (APP[0] + 8 - i * 3) + " " + (APP[1] + 8) }, clotGrp);
  avMark = mk("g", { opacity: "0" }, H); mk("circle", { class: "af-x", cx: AV[0], cy: AV[1], r: 9 }, avMark); mk("path", { class: "af-xp", d: "M" + (AV[0] - 4) + " " + (AV[1] - 4) + "L" + (AV[0] + 4) + " " + (AV[1] + 4) + "M" + (AV[0] + 4) + " " + (AV[1] - 4) + "L" + (AV[0] - 4) + " " + (AV[1] + 4) }, avMark);
  saMark = mk("g", { opacity: "0" }, H); mk("circle", { class: "af-ok", cx: SAN[0], cy: SAN[1], r: 13 }, saMark);
  coagMark = mk("g", { opacity: "0" }, H); mk("circle", { class: "af-x", cx: APP[0], cy: APP[1], r: 10 }, coagMark); mk("path", { class: "af-xp", d: "M" + (APP[0] - 4) + " " + (APP[1] - 4) + "L" + (APP[0] + 4) + " " + (APP[1] + 4) + "M" + (APP[0] + 4) + " " + (APP[1] - 4) + "L" + (APP[0] - 4) + " " + (APP[1] + 4) }, coagMark);
  const B = L.brain;
  mk("path", { class: "af-vessel", d: "M698 328Q718 316 738 330T782 324" }, B);
  brainMark = mk("g", { opacity: "0" }, B); mk("circle", { class: "af-x", cx: BRN[0] + 14, cy: BRN[1] - 6, r: 9 }, brainMark); mk("path", { class: "af-xp", d: "M" + (BRN[0] + 10) + " " + (BRN[1] - 10) + "L" + (BRN[0] + 18) + " " + (BRN[1] - 2) + "M" + (BRN[0] + 18) + " " + (BRN[1] - 10) + "L" + (BRN[0] + 10) + " " + (BRN[1] - 2) }, brainMark);
  ecgPath = mk("path", { class: "af-trace" }, L.ecg);
  ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 16, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. In atrial fibrillation there are no clear P waves, the baseline wavers, and beats arrive at uneven gaps. In sinus rhythm a P wave comes before each even beat." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  initPanel();
}
function initPanel() {
  const o = L.over;
  pill(o, "PV triggers", 270, 140, 400, 66, "Pulmonary vein triggers: rapid extra beats from muscle sleeves around the lung veins. These starts often set off atrial fibrillation.");
  pill(o, "Re-entry", 240, 195, 82, 160, "Re-entry: many small wandering circuits in the atria. The wavefront breaks up, so the atria quiver instead of beating together.");
  pill(o, "Appendage clot", APP[0], APP[1], 95, 120, "Left atrial appendage: a small pouch where blood swirls slowly in atrial fibrillation. Slow blood there can form a clot.");
  pill(o, "AV node", AV[0], AV[1], 478, 180, "AV node filter: the AV node is bombarded by atrial signals and lets only some through, at uneven gaps. That is why the pulse is uneven.");
  pill(o, "Atria", 340, 200, 452, 132, "Atria: the upper chambers. In fibrillation they quiver fast and chaotically instead of squeezing together.");
  pill(o, "Ventricles", VEN[0], VEN[1], 120, 392, "Ventricles: the lower pumping chambers. They follow the uneven signals that pass the AV node, so the pulse is fast and uneven.");
  pill(o, "Stasis", 172, 244, 300, 392, "Stasis: blood that barely moves in the quivering atrium and pouch. Slow flow helps a clot form.");
  pill(o, "No P waves", 640, 162, 720, 275, "On the ECG there is no clear P wave before each beat, because the atria are not beating in order.");
  pill(o, "Irregular QRS", 800, 150, 850, 275, "Beats arrive at uneven gaps, with a wavy baseline between them.");
  pill(o, "Embolus", 520, 277, 608, 275, "A piece of pouch clot can leave with the blood flow and travel to the brain.");
  pill(o, "Stroke", BRN[0] + 14, BRN[1] - 6, 888, 330, "If the piece blocks a brain artery it causes a stroke. Anticoagulation lowers this risk.");
  const pr = pill(o, "Rate control", AV[0], AV[1], 740, 408, "Rate control plugs the AV node. Watch the plugs sit on the node while fewer pulses reach the ventricles."); pr.setAttribute("id", "p-rate"); pr.style.opacity = 0;
  const ph = pill(o, "Rhythm control", SAN[0], SAN[1], 740, 408, "Rhythm control calms the vein triggers and restores one orderly wave from the natural pacemaker."); ph.setAttribute("id", "p-rhythm"); ph.style.opacity = 0;
  const pc = pill(o, "Anticoagulation", APP[0], APP[1], 740, 408, "Anticoagulation sends trappers that swarm the clot, so less breaks off to the brain. The rhythm is unchanged."); pc.setAttribute("id", "p-coag"); pc.style.opacity = 0;
  const pb = pill(o, "Combination", AV[0], AV[1], 740, 408, "The combination steadies the beat and traps clot material, so the pulse calms and stroke risk falls."); pb.setAttribute("id", "p-combo"); pb.style.opacity = 0;
  capEl = mk("text", { class: "af-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0);
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["af", "Atrial activity", "g-cyt", "How chaotically the atria are firing. High means fibrillating, low means organised sinus activity."], ["vr", "Ventricular rate", "g-bad", "How fast the ventricles are beating. Rate control brings this down."], ["ir", "Irregularity", "g-irreg", "How uneven the ventricular rhythm is. In atrial fibrillation it is uneven and unpredictable."], ["st", "Stasis", "g-fl", "How slowly blood moves in the atria and pouch. Slow flow favours clot."], ["cl", "Clot", "g-clot", "Clot forming in the left atrial pouch."], ["sr", "Stroke risk", "g-bad", "Chance that a clot piece travels to the brain. Anticoagulation lowers it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.af = lerp(sm.af, m.af, k2); sm.vRate = lerp(sm.vRate, m.vRate, k1); sm.irreg = lerp(sm.irreg, m.irreg, k2);
  sm.stasis = lerp(sm.stasis, m.stasis, k2); sm.clot = lerp(sm.clot, m.clot, k2); sm.stroke = lerp(sm.stroke, m.stroke, k2);
  sm.rate = lerp(sm.rate, m.rate, k1); sm.rhythm = lerp(sm.rhythm, m.rhythm, k1); sm.coag = lerp(sm.coag, m.coag, k1); sm.sinus = lerp(sm.sinus, m.sinus, k2);
  const phNow = beatPhase(tm / 1000);
  const qrsPulse = (phNow > 0.245 && phNow < 0.32) ? 1 : 0;
  zA.style.setProperty("--act", (sm.af * (0.45 + 0.55 * Math.abs(Math.sin(tm / 130)))).toFixed(2));
  zV.style.setProperty("--act", (0.25 + 0.75 * qrsPulse * (0.5 + 0.5 * sm.vRate)).toFixed(2));
  if (avNodeEl) avNodeEl.style.opacity = (0.45 + 0.55 * qrsPulse).toFixed(2);
  if (saNodeEl) saNodeEl.style.opacity = (0.3 + 0.7 * (sm.sinus * (phNow < 0.2 ? 1 : 0.2) + (1 - sm.sinus) * 0.3 * Math.abs(Math.sin(tm / 130)))).toFixed(2);
  if (condEl) condEl.style.opacity = (0.2 + 0.6 * (1 - 0.6 * sm.rate) * (0.4 + 0.6 * qrsPulse)).toFixed(2);
  sparks.forEach((s, i) => { const sc = sm.af * (0.4 + 0.6 * Math.abs(Math.sin(tm / 110 + i * 1.3))); s.g.setAttribute("transform", "translate(" + PVX[i] + " 116) scale(" + sc.toFixed(2) + ")"); s.g.style.opacity = sc > 0.05 ? 1 : 0; });
  wavelets.forEach((wv) => { const a = tm / 1000 * wv.sp + wv.ph, x = wv.cx + Math.cos(a) * wv.r, y = wv.cy + Math.sin(a * 1.3) * wv.r * 0.7; place(wv.g, x, y, 0, sm.af > 0.05 ? 1 : 0.01); wv.g.style.opacity = sm.af > 0.12 ? 1 : 0; });
  rings.forEach((r, i) => { const ph = (beatPhase(tm / 1000) + i * 0.5) % 1, rx = 14 + ph * 150; r.setAttribute("rx", f1(rx)); r.setAttribute("ry", f1(rx * 0.35)); r.style.opacity = ((1 - ph) * sm.sinus * 0.85).toFixed(2); });
  const swirl = 0.25 + 1.1 * (1 - sm.stasis);
  stasisDots.forEach((d) => { const a = tm / 1000 * swirl + d.ph; place(d.g, APP[0] + Math.cos(a) * d.rr, APP[1] + Math.sin(a) * d.rr * 0.7, 0, 1); d.g.style.opacity = sm.af > 0.12 ? 0.9 : 0.25; });
  if (clotGrp) { const cs = 0.12 + 0.88 * sm.clot; clotGrp.setAttribute("transform", "translate(" + APP[0] + " " + APP[1] + ") scale(" + cs.toFixed(3) + ") translate(" + (-APP[0]) + " " + (-APP[1]) + ")"); clotGrp.style.opacity = sm.clot > 0.06 ? 1 : 0; }
  acc.trig += dt * sm.af * 7; while (acc.trig >= 1) { acc.trig--; const p = freeP(trigDots); if (p) { const sx = PVX[Math.floor(Math.random() * PVX.length)]; emitP(p, sx, 118, rnd(-8, 8), rnd(22, 38), 0); } }
  trigDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8 || p.y > 218) killP(p); });
  acc.cond += dt * (0.8 + 3.4 * sm.vRate) * (1 - 0.55 * sm.rate); while (acc.cond >= 1) { acc.cond--; const p = freeP(condDots); if (p) emitP(p, 0, 0, 0, 0, 0); }
  condDots.forEach((p) => { if (!p.on) return; p.u += dt * 1.5; const q = condTrack.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) killP(p); });
  rateDots.forEach((p, i) => {
    if (i < Math.round(sm.rate * 8)) {
      if (!p.on) emitP(p, 0, 0, 0, 0, i);
      p.t += dt; const kk = clamp(p.t / 1.4);
      const sx = AV[0] - 110 + (i % 4) * 16, sy = AV[1] + 55 + Math.floor(i / 4) * 18;
      const dx = AV[0] + Math.cos(i * 2.4) * 15, dy = AV[1] + Math.sin(i * 2.4) * 15;
      place(p.e, lerp(sx, dx, kk) + Math.sin(tm / 400 + i) * 1.5 * kk, lerp(sy, dy, kk), 0, 1);
    } else if (p.on) killP(p);
  });
  rhyDots.forEach((p, i) => {
    if (i < Math.round(sm.rhythm * 10)) {
      if (!p.on) emitP(p, 0, 0, 0, 0, i);
      p.t += dt; const kk = clamp(p.t / 1.2);
      const sx = PVX[i % 4] + ((i * 7) % 5 - 2), sy = 60;
      const dx = PVX[i % 4] + (i % 2 ? 5 : -5), dy = 122 + Math.floor(i / 4) * 6;
      place(p.e, lerp(sx, dx, kk), lerp(sy, dy, kk) + Math.sin(tm / 450 + i) * 1.2 * kk, 0, 1);
    } else if (p.on) killP(p);
  });
  coagDots.forEach((p, i) => {
    if (i < Math.round(sm.coag * 10)) {
      if (!p.on) emitP(p, 0, 0, 0, 0, i);
      p.t += dt; const a = tm / 700 + i * 0.63, rad = 17 + (i % 3) * 5;
      place(p.e, APP[0] + Math.cos(a) * rad, APP[1] + Math.sin(a) * rad * 0.7, 0, 1);
      p.e.style.opacity = clamp(p.t / 0.6).toFixed(2);
    } else if (p.on) killP(p);
  });
  acc.emb += dt * sm.stroke * 0.55; while (acc.emb >= 1) { acc.emb--; const p = freeP(embDots); if (p) emitP(p, 0, 0, 0, 0, 0); }
  embDots.forEach((p) => { if (!p.on) return; p.t += dt; p.u = clamp(p.t / 3.2); const pt = embTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); p.e.setAttribute("opacity", p.u >= 1 ? "0" : "1"); if (p.u >= 1) killP(p); });
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
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
