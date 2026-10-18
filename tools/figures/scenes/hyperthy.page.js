/* Hyperthyroid scene: antibodies drive the thyroid, excess T4 and T3 stream to heart, eye and muscle. */
const layers = { stream: $("stream"), thy: $("thyroid"), heart: $("heartg"), eye: $("eyeg"), mus: $("muscleg"), parts: $("parts"), over: $("over"), panel: $("panel") };
const THY = { x: 190, y: 250 }, HRT = { x: 620, y: 205 }, EYE = { x: 830, y: 145 }, MUS = { x: 830, y: 325 };
/* ---- static nodes (each with a visible fill) ---- */
function initNodes() {
  const t = layers.thy;
  mk("ellipse", { class: "ht-thy", cx: 152, cy: 250, rx: 38, ry: 56, transform: "rotate(-14 152 250)" }, t);
  mk("ellipse", { class: "ht-thy", cx: 228, cy: 250, rx: 38, ry: 56, transform: "rotate(14 228 250)" }, t);
  mk("rect", { class: "ht-thy2", x: 172, y: 238, width: 36, height: 24, rx: 10 }, t);
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; mk("circle", { class: "ht-thy2", cx: f1(152 + Math.cos(a) * 20), cy: f1(250 + Math.sin(a) * 32), r: 7 }, t); mk("circle", { class: "ht-thy2", cx: f1(228 + Math.cos(a + 1) * 20), cy: f1(250 + Math.sin(a + 1) * 32), r: 7 }, t); }
  mk("circle", { class: "ht-nod", cx: 238, cy: 278, r: 13, id: "nodule" }, t);
  const h = layers.heart;
  mk("path", { class: "ht-heart", id: "heartpath", d: "M620 262 C590 232 566 214 566 188 C566 166 582 154 600 154 C612 154 618 162 620 168 C622 162 628 154 640 154 C658 154 674 166 674 188 C674 214 650 232 620 262 Z" }, h);
  const e = layers.eye;
  mk("circle", { class: "ht-eye", cx: EYE.x, cy: EYE.y, r: 34 }, e);
  mk("circle", { class: "ht-iris", cx: EYE.x, cy: EYE.y, r: 14 }, e);
  mk("circle", { class: "ht-pupil", cx: EYE.x, cy: EYE.y, r: 6 }, e);
  mk("path", { class: "ht-pulse", id: "lid", d: "M792 128 Q830 106 868 128" }, e);
  const mu = layers.mus;
  mk("ellipse", { class: "ht-mus", cx: MUS.x, cy: MUS.y, rx: 48, ry: 30 }, mu);
  mk("ellipse", { class: "ht-mus", cx: MUS.x - 10, cy: MUS.y - 6, rx: 30, ry: 17, opacity: "0.65" }, mu);
  mk("path", { class: "ht-ecg", id: "ecg", d: "" }, layers.stream);
  mk("path", { class: "dr-bond", id: "flowline", d: "M272 238 C360 210 470 200 552 202" }, layers.stream);
}
/* ---- particle pools (items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const abs = pool(14, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "ht-ab", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; });
const horm = pool(42, () => mk("circle", { class: "sc-p ht-horm", r: 3 }, layers.parts));
const pulses = pool(10, () => mk("circle", { class: "p-no", r: 4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["hm", "Hormone", "g-bad", "Free T4 and T3 released by the thyroid. High in hyperthyroidism; TSH is suppressed."], ["hr", "Heart", "g-bad", "Heart rate. Hormone raises metabolic rate and adrenergic sensitivity, so the heart races."], ["af", "Rhythm", "g-bad", "Risk of atrial fibrillation: fast, irregular atrial activity with an irregular pulse, more likely in the elderly."], ["tr", "Tremor", "g-cyt", "Fine tremor, heat intolerance, sweating and muscle weakness from the overactive state."], ["eye", "Eyes", "g-fl", "Graves eye signs: proptosis, lid retraction and swollen extraocular muscle and orbital tissue."], ["st", "Storm", "g-bad", "Thyroid storm: the severe end of thyrotoxicosis with fever, racing heart and confusion. An emergency."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "TSH-R antibody", 190, 188, 150, 98, "In Graves disease, autoimmune TSH receptor antibodies stimulate the gland. They can be detected in blood.");
  pill(ox, "Thyroid gland", 140, 262, 88, 352, "The thyroid gland in the neck. In Graves it is diffusely enlarged; hormone output rises.");
  pill(ox, "Toxic nodule", 238, 278, 308, 352, "A toxic nodule makes hormone on its own, without TSH control. One cause among several.");
  pill(ox, "T4 and T3", 410, 214, 410, 148, "Thyroxine (T4) and triiodothyronine (T3) travelling in blood to tissues. Excess drives the signs.");
  pill(ox, "Heart", 620, 168, 620, 98, "The heart: faster, stronger beats. Sustained excess can cause atrial fibrillation and heart strain.");
  pill(ox, "Eye signs", EYE.x, EYE.y - 30, EYE.x, 64, "Graves ophthalmopathy: immune swelling behind the eye causes proptosis and lid retraction. Moderate to severe disease needs specialist care.");
  pill(ox, "Irregular rhythm", 620, 250, 620, 330, "Atrial fibrillation: chaotic atrial activity, irregular ventricular response. Watch the tracing turn irregular.");
  pill(ox, "Tremor", MUS.x, MUS.y + 24, MUS.x, 398, "Skeletal muscle: fine tremor, weakness and weight loss as metabolic rate stays high.");
}
const sm = { Hm: 0.5, HR: 0.5, AF: 0.2, Tr: 0.4, Eye: 0.3, Storm: 0.1, anti: 0, beta: 0, defn: 0 };
const acc = { ab: 0, horm: 0, pulse: 0 };
function init() { initNodes(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.7);
  sm.Hm = lerp(sm.Hm, m.Hm, k1); sm.HR = lerp(sm.HR, m.HR, k1); sm.AF = lerp(sm.AF, m.AF, k1); sm.Tr = lerp(sm.Tr, m.Tr, k1); sm.Eye = lerp(sm.Eye, m.Eye, k1); sm.Storm = lerp(sm.Storm, m.Storm, k1); sm.anti = lerp(sm.anti, m.anti, k1); sm.beta = lerp(sm.beta, m.beta, k1); sm.defn = lerp(sm.defn, m.defn, k1);
  /* thyroid pulse and nodule */
  const th = layers.thy; th.setAttribute("transform", "translate(" + f1(190 + Math.sin(tm / 500) * 1) + " 250) scale(" + (1 + 0.04 * sm.Hm * Math.sin(tm / (240 - 120 * sm.HR))).toFixed(3) + ") translate(-190 -250)");
  const nod = $("nodule"); if (nod) nod.setAttribute("opacity", (0.35 + 0.65 * sm.Hm).toFixed(2));
  /* heart beat: faster and, with AF, irregular */
  const irr = sm.AF > 0.45 ? Math.sin(tm / 173) * 0.35 + Math.sin(tm / 97) * 0.2 : 0;
  const beat = 1 + (0.07 + 0.05 * sm.HR) * Math.max(0, Math.sin(tm / (300 - 170 * sm.HR) + irr * 4));
  const hp = $("heartpath"); if (hp) hp.setAttribute("transform", "translate(620 205) scale(" + beat.toFixed(3) + ") translate(-620 -205)");
  /* eye: proptosis shift and lid retraction grow with eye signs */
  const eg = layers.eye; eg.setAttribute("transform", "translate(" + f1(sm.Eye * 7) + " " + f1(-sm.Eye * 3 + Math.sin(tm / 900) * 1) + ")");
  const lid = $("lid"); if (lid) lid.setAttribute("d", "M792 " + f1(128 - sm.Eye * 10) + " Q830 " + f1(106 - sm.Eye * 12) + " 868 " + f1(128 - sm.Eye * 10));
  /* muscle tremor jitter */
  const mg = layers.mus; mg.setAttribute("transform", "translate(" + f1(Math.sin(tm / 47) * 2.2 * sm.Tr) + " " + f1(Math.cos(tm / 39) * 1.4 * sm.Tr) + ")");
  /* ECG tracing across the lower tissue */
  const ecg = $("ecg"); if (ecg) { let d = ""; const yb = 414, x0 = 300, x1 = 700, sp = 46 - 26 * sm.HR; for (let x = x0; x <= x1; x += 8) { const ph = ((x + tm * (0.12 + 0.22 * sm.HR)) % sp) / sp; let y = yb; if (ph > 0.42 && ph < 0.5) y = yb - 4; else if (ph >= 0.5 && ph < 0.56) y = yb - (sm.AF > 0.45 ? 12 + 8 * Math.sin(x) : 18); else if (ph >= 0.56 && ph < 0.62) y = yb + 5; else if (ph > 0.75 && ph < 0.9) y = yb - 3; d += (x === x0 ? "M" : "L") + f1(x) + " " + f1(y); } ecg.setAttribute("d", d); ecg.style.opacity = (0.35 + 0.65 * sm.HR).toFixed(2); }
  /* antibodies drift down to the gland (Graves drive) */
  acc.ab += dt * (2 + 5 * sm.Hm) * (1 - 0.6 * sm.defn); while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) emit(p, rnd(120, 260), 108, rnd(-3, 3), rnd(18, 28), 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 300 + p.x) * 14) + ")"); if (p.y > 196 || p.t > 5) kill(p); });
  /* hormone dots: thyroid to heart, eye and muscle */
  acc.horm += dt * (3 + 17 * sm.Hm); while (acc.horm >= 1) { acc.horm--; const p = free(horm); if (p) { const k = Math.random(); emit(p, 268, rnd(228, 252), rnd(55, 85), k < 0.6 ? -14 : k < 0.8 ? -34 : 22, k < 0.6 ? 0 : k < 0.8 ? 1 : 2); } }
  horm.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k === 1 ? EYE.x - 40 : p.k === 2 ? MUS.x - 52 : HRT.x - 58, ty = p.k === 1 ? EYE.y + 18 : p.k === 2 ? MUS.y - 8 : HRT.y; p.x += p.vx * dt; p.y += ((ty - p.y) * 0.9 + p.vy) * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 58, 428)) + ")"); if (p.x > tx || p.t > 7) kill(p); });
  /* pulse rings at the heart */
  acc.pulse += dt * (1 + 5 * sm.HR); while (acc.pulse >= 1) { acc.pulse--; const p = free(pulses); if (p) emit(p, HRT.x, HRT.y, 0, 0, 0); }
  pulses.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(HRT.x) + " " + f1(HRT.y) + ") scale(" + (1 + p.t * 2.4).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  gg.hm.set(sm.Hm, wordOf(sm.Hm, 0.25, 0.55, ["near normal", "raised", "very high"])); gg.hr.set(sm.HR, wordOf(sm.HR, 0.3, 0.6, ["steady", "fast", "racing"])); gg.af.set(sm.AF, wordOf(sm.AF, 0.25, 0.5, ["regular", "at risk", "likely"]));
  gg.tr.set(sm.Tr, wordOf(sm.Tr, 0.3, 0.6, ["none", "mild", "marked"])); gg.eye.set(sm.Eye, wordOf(sm.Eye, 0.25, 0.5, ["none", "mild", "marked"])); gg.st.set(sm.Storm, wordOf(sm.Storm, 0.2, 0.45, ["settled", "strained", "storm"]));
}
run({ init, step });
