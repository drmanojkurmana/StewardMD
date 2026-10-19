/* Hyperthyroid scene: Graves antibodies drive the thyroid, excess T4 and T3 race the heart, shake muscle and push the eyes. */
const layers = { thy: $("thyroidSlot"), heart: $("heartSlot"), eye: $("eyeSlot"), mus: $("muscleSlot"), flow: $("flowline"), ecg: $("ecg"), tglow: $("thyGlow"), sglow: $("stormGlow"), drug: $("drugG"), parts: $("parts"), over: $("over"), panel: $("panel") };
let thyO = null, heartO = null, eyeO = null, musO = null, capEl = null, capDrug = -1;
let trHeart = null, trEye = null, trMus = null;
/* ---- state caption: one short line that changes with treatment ---- */
function capText(d) {
  if (d === 1) return "Antithyroid drug blocks new hormone in the gland. The heart slows as hormone falls.";
  if (d === 2) return "Beta blocker shields the heart. Hormone stays high but the pulse slows.";
  if (d === 3) return "Radioiodine or surgery shrinks the gland. Hormone falls and the storm settles.";
  return "No treatment. The gland floods the body with hormone and the heart races.";
}
/* ---- organs, vessel and tracks, all anchored to real organ ports ---- */
const antiTabs = [], betaCaps = [], ioDots = [];
function initOrgans() {
  thyO = organ(layers.thy, "thyroid", 175, 250, 150, {});
  heartO = organ(layers.heart, "heart", 570, 230, 160, {});
  eyeO = organ(layers.eye, "eye", 815, 160, 120, {});
  musO = organ(layers.mus, "muscle", 810, 330, 170, {});
  const TP = thyO.ports, HP = heartO.ports, EP = eyeO.ports, MP = musO.ports;
  const src = TP.lobeR, hIn = HP.in, eIn = EP.in, mIn = MP.in;
  layers.flow.setAttribute("d", "M" + f1(src[0]) + " " + f1(src[1])
    + " C" + f1(src[0] + 90) + " " + f1(src[1] - 10) + " " + f1(hIn[0] - 120) + " " + f1(hIn[1] + 60) + " " + f1(hIn[0]) + " " + f1(hIn[1]));
  trHeart = track([src, [src[0] + 70, src[1] - 8], [hIn[0] - 90, hIn[1] + 40], hIn]);
  trEye = track([src, [src[0] + 120, src[1] - 40], [eIn[0] - 110, eIn[1] + 10], eIn]);
  trMus = track([src, [src[0] + 110, src[1] + 40], [mIn[0] - 110, mIn[1] - 10], mIn]);
  /* antithyroid tablets docked on both lobes: synthesis blocked at the gland */
  const lobeL = TP.lobeL, lobeR = TP.lobeR;
  for (let i = 0; i < 6; i++) {
    const bx = (i % 2 ? lobeR[0] : lobeL[0]) + rnd(-13, 13), by = (i % 2 ? lobeR[1] : lobeL[1]) + rnd(-32, 32);
    antiTabs.push(mk("rect", { class: "ht-tab", x: f1(bx - 5), y: f1(by - 3), width: 10, height: 6, rx: 3, opacity: "0" }, layers.drug));
  }
  /* beta blocker caps ringing the heart plus a few on muscle: receptors shielded */
  for (let i = 0; i < 7; i++) {
    const t = (i / 7) * 6.28;
    betaCaps.push(mk("circle", { class: "ht-block", cx: f1(570 + Math.cos(t) * 80), cy: f1(230 + Math.sin(t) * 102), r: 4.5, opacity: "0" }, layers.drug));
  }
  for (let i = 0; i < 3; i++) {
    betaCaps.push(mk("circle", { class: "ht-block", cx: f1(770 + i * 42), cy: f1(322 + (i % 2) * 14), r: 4.5, opacity: "0" }, layers.drug));
  }
  /* trapped iodine dots inside the gland: definitive treatment at work */
  for (let i = 0; i < 8; i++) {
    ioDots.push(mk("circle", { class: "ht-io", cx: f1(rnd(140, 210)), cy: f1(rnd(215, 285)), r: 3, opacity: "0" }, layers.drug));
  }
}
/* ---- particle pools (items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, t: 0, k: 0, u: 0, tr: null }; }); }
const abs = pool(14, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "ht-ab", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; });
const horm = pool(46, () => mk("circle", { class: "sc-p ht-horm", r: 3 }, layers.parts));
const pulses = pool(10, () => mk("circle", { class: "p-no", r: 4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k, tr) { p.on = true; p.x = x; p.y = y; p.t = 0; p.k = k || 0; p.u = 0; p.tr = tr || null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels: seven short pills, left to right ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["hm", "Hormone", "g-bad", "Free T4 and T3 released by the thyroid. High in hyperthyroidism; TSH is suppressed."], ["hr", "Heart", "g-bad", "Heart rate. Hormone raises metabolic rate and adrenergic sensitivity, so the heart races."], ["af", "Rhythm", "g-bad", "Risk of atrial fibrillation: fast, irregular atrial activity with an irregular pulse."], ["tr", "Tremor", "g-cyt", "Fine tremor and muscle weakness from the overactive state."], ["eye", "Eyes", "g-fl", "Graves eye signs: proptosis and lid retraction from swollen orbital tissue."], ["st", "Storm", "g-bad", "Thyroid storm: the severe end of thyrotoxicosis with fever, racing heart and confusion. An emergency."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Antibody", 175, 196, 110, 96, "Graves antibody: an immune protein that switches the gland on. Found in blood.");
  pill(ox, "Thyroid", 142, 250, 110, 362, "Thyroid gland in the neck. Driven hard, it releases far too much hormone.");
  pill(ox, "T4 and T3", 340, 228, 360, 140, "Thyroid hormones T4 and T3 travelling in blood. Excess speeds the whole body up.");
  pill(ox, "Heart", 560, 220, 575, 84, "Heart: beats faster and harder. Lasting excess strains it.");
  pill(ox, "Rhythm", 610, 412, 560, 368, "Heartbeat tracing. The fast rhythm can turn irregular.");
  pill(ox, "Eyes", 790, 160, 815, 70, "Eyes in Graves disease: immune swelling behind the eye pushes it forward.");
  pill(ox, "Tremor", 770, 330, 815, 402, "Muscle: fine shaking and weakness while hormone stays high.");
  capEl = mk("text", { class: "ht-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { Hm: 0.5, HR: 0.5, AF: 0.2, Tr: 0.4, Eye: 0.3, Storm: 0.1, anti: 0, beta: 0, defn: 0 };
const acc = { ab: 0, horm: 0, pulse: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.7);
  sm.Hm = lerp(sm.Hm, m.Hm, k1); sm.HR = lerp(sm.HR, m.HR, k1); sm.AF = lerp(sm.AF, m.AF, k1); sm.Tr = lerp(sm.Tr, m.Tr, k1); sm.Eye = lerp(sm.Eye, m.Eye, k1); sm.Storm = lerp(sm.Storm, m.Storm, k1); sm.anti = lerp(sm.anti, m.anti, k1); sm.beta = lerp(sm.beta, m.beta, k1); sm.defn = lerp(sm.defn, m.defn, k1);
  /* gland: swollen and busy when hot, shrunken and dimmed when definitively treated */
  const gsc = (1 + 0.04 * sm.Hm) * (1 - 0.38 * sm.defn);
  layers.thy.setAttribute("transform", "translate(175 250) scale(" + gsc.toFixed(3) + ") translate(-175 -250)");
  layers.thy.setAttribute("opacity", (1 - 0.3 * sm.defn).toFixed(2));
  layers.tglow.setAttribute("opacity", (0.38 * sm.Hm).toFixed(2));
  layers.sglow.setAttribute("opacity", (0.5 * sm.Storm).toFixed(2));
  /* blood stream carries less hormone as hormone falls */
  layers.flow.setAttribute("opacity", (0.22 + 0.55 * sm.Hm).toFixed(2));
  layers.flow.setAttribute("stroke-width", f1(6 + 8 * sm.Hm));
  /* heart beat: faster and, with AF, irregular */
  const irr = sm.AF > 0.45 ? Math.sin(tm / 173) * 0.35 + Math.sin(tm / 97) * 0.2 : 0;
  const beat = 1 + (0.07 + 0.05 * sm.HR) * Math.max(0, Math.sin(tm / (300 - 170 * sm.HR) + irr * 4));
  layers.heart.setAttribute("transform", "translate(570 230) scale(" + beat.toFixed(3) + ") translate(-570 -230)");
  /* eye pushed forward with eye signs; muscle shakes with tremor */
  layers.eye.setAttribute("transform", "translate(" + f1(sm.Eye * 7) + " " + f1(-sm.Eye * 3 + Math.sin(tm / 900) * 1) + ")");
  layers.mus.setAttribute("transform", "translate(" + f1(Math.sin(tm / 47) * 2.2 * sm.Tr) + " " + f1(Math.cos(tm / 39) * 1.4 * sm.Tr) + ")");
  /* ECG tracing across the lower tissue, clear of the caption */
  const ecg = layers.ecg; let d = ""; const yb = 414, x0 = 470, x1 = 720, sp = 46 - 26 * sm.HR;
  for (let x = x0; x <= x1; x += 8) { const ph = ((x + tm * (0.12 + 0.22 * sm.HR)) % sp) / sp; let y = yb;
    if (ph > 0.42 && ph < 0.5) y = yb - 4; else if (ph >= 0.5 && ph < 0.56) y = yb - (sm.AF > 0.45 ? 12 + 8 * Math.sin(x) : 18); else if (ph >= 0.56 && ph < 0.62) y = yb + 5; else if (ph > 0.75 && ph < 0.9) y = yb - 3;
    d += (x === x0 ? "M" : "L") + f1(x) + " " + f1(y); }
  ecg.setAttribute("d", d); ecg.setAttribute("opacity", (0.35 + 0.65 * sm.HR).toFixed(2));
  /* antibodies drift down to the gland (Graves drive) */
  acc.ab += dt * (2 + 5 * sm.Hm) * (1 - 0.6 * sm.defn);
  while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) { emit(p, rnd(120, 230), 108, 0); p.vx = rnd(-3, 3); p.vy = rnd(18, 28); } }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300 + p.x) * 14) + ")"); if (p.y > 196 || p.t > 5) kill(p); });
  /* hormone dots ride tracks from the gland into heart, eye and muscle */
  acc.horm += dt * (2 + 16 * sm.Hm);
  while (acc.horm >= 1) { acc.horm--; const p = free(horm); if (p) { const r = Math.random(), k = r < 0.55 ? 0 : r < 0.78 ? 1 : 2; const src = thyO.ports.lobeR; emit(p, src[0], src[1], k, k === 1 ? trEye : k === 2 ? trMus : trHeart); } }
  horm.forEach((p) => { if (!p.on || !p.tr) return; p.t += dt; p.u += dt * 120 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1 || p.t > 7) kill(p); });
  /* pulse rings at the heart */
  acc.pulse += dt * (1 + 5 * sm.HR); while (acc.pulse >= 1) { acc.pulse--; const p = free(pulses); if (p) { emit(p, 570, 230, 0); } }
  pulses.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(570 230) scale(" + (1 + p.t * 2.4).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* docked drug effects: tablets on the gland, caps on the heart, iodine inside */
  antiTabs.forEach((e) => e.setAttribute("opacity", sm.anti.toFixed(2)));
  betaCaps.forEach((e) => e.setAttribute("opacity", sm.beta.toFixed(2)));
  ioDots.forEach((e) => e.setAttribute("opacity", sm.defn.toFixed(2)));
  gg.hm.set(sm.Hm, wordOf(sm.Hm, 0.25, 0.55, ["near normal", "raised", "very high"])); gg.hr.set(sm.HR, wordOf(sm.HR, 0.3, 0.6, ["steady", "fast", "racing"])); gg.af.set(sm.AF, wordOf(sm.AF, 0.25, 0.5, ["regular", "at risk", "likely"]));
  gg.tr.set(sm.Tr, wordOf(sm.Tr, 0.3, 0.6, ["none", "mild", "marked"])); gg.eye.set(sm.Eye, wordOf(sm.Eye, 0.25, 0.5, ["none", "mild", "marked"])); gg.st.set(sm.Storm, wordOf(sm.Storm, 0.2, 0.45, ["settled", "strained", "storm"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
