/* HOCM scene: gene to thick septum, narrow outflow, SAM, weak aortic flow, murmur, rhythm risk.
 * Heart art comes from organs.lib.js; cavity, septum, leaflet, tube and particles anchor to its ports. */
const L = { inset: $("inset"), hsl: $("heartSlot"), heart: $("heart"), flow: $("flow"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const EB = { x: 678, y: 266, w: 238, h: 92 };
const sm = { a: 0.65, Th: 0.6, Obs: 0.5, SAM: 0.5, Dias: 0.6, FlowOut: 0.6, Mur: 0.5, Risk: 0.6, beta: 0, sept: 0, icd: 0 };
let heartO = null, AP = [444, 120], AY = 96, cav = { x: 420, y: 280 };
let cavEl, septEl, tubeEl, tubeInEl, hingeEl, leafEl, chordEl, stubEl, arrowL, arrowR, icdG, strainEl;
let recXY = [], betaDots = [], sigDots = [], sigTracks = [], swirls = [], waves = [];
let flashEl, ecgPath, jetTrack = null, capEl = null, capKey = "";
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const blood = pool(26, () => mk("circle", { class: "sc-p p-blood", r: 3 }, L.flow));
const sparks = pool(10, () => mk("circle", { class: "sc-p", r: 2.4, style: "--cc:#ffd24a" }, L.flow));

function initInset() {
  const g = L.inset;
  let d1 = "", d2 = "";
  for (let y = 100; y <= 182; y += 4) { const x1 = 80 + Math.sin((y - 100) / 13) * 18, x2 = 80 - Math.sin((y - 100) / 13) * 18; d1 += (y === 100 ? "M" : "L") + f1(x1) + " " + y; d2 += (y === 100 ? "M" : "L") + f1(x2) + " " + y; }
  mk("path", { class: "hoc-dna", d: d1, fill: "none" }, g); mk("path", { class: "hoc-dna", d: d2, fill: "none" }, g);
  for (let y = 108; y <= 176; y += 17) { const dx = Math.sin((y - 100) / 13) * 18; mk("path", { class: "hoc-rung", d: "M" + f1(80 - dx) + " " + y + "L" + f1(80 + dx) + " " + y }, g); }
  mk("circle", { class: "hoc-mut", cx: 93, cy: 141, r: 6 }, g);
  [[72, 248], [138, 288]].forEach(([x, y], i) => { const c = cell(g, { cls: "hocmyo", r: 22, nuc: 0.4, seed: i * 3 + 2, wob: 0.14 }); place(c, x, y, 0, 1); });
  const ccap = mk("text", { class: "sc-lab", x: 40, y: 326 }, g); ccap.textContent = "thick disordered cells";
}

function tubeD() {
  const ax = AP[0], ay = AP[1];
  return "M" + f1(ax) + " " + f1(ay) + " C" + f1(ax + 60) + " " + f1(ay) + " 700 " + f1(AY) + " 880 " + f1(AY);
}
function jetPts(septX) {
  return [[cav.x, cav.y + 58], [cav.x - 8, cav.y - 10], [septX - 16, cav.y - 62], AP, [(AP[0] + 880) / 2, AY], [880, AY]];
}

function initOrgans() {
  heartO = organ(L.hsl, "heart", 450, 262, 272, {});
  const P = heartO.ports;
  AP = P.aorta || P.out || [444, 120];
  AY = Math.round(AP[1]) - 24;
  cav = { x: heartO.x - 30, y: heartO.y + 18 };
  strainEl = $("strain");
  strainEl.setAttribute("cx", f1(heartO.x)); strainEl.setAttribute("cy", f1(heartO.y));
  strainEl.setAttribute("rx", f1(heartO.w * 0.75)); strainEl.setAttribute("ry", f1(heartO.h * 0.68));
  const g = L.heart;
  cavEl = mk("ellipse", { class: "hoc-cav", cx: f1(cav.x), cy: f1(cav.y), rx: 60, ry: 78 }, g);
  septEl = mk("rect", { class: "hoc-sept", x: f1(cav.x + 20), y: f1(cav.y - 78), width: 58, height: 156, rx: 14 }, g);
  tubeEl = mk("path", { class: "hoc-tube", d: tubeD(), fill: "none", "stroke-width": 18 }, g);
  tubeInEl = mk("path", { class: "hoc-tubein", d: tubeD(), fill: "none", "stroke-width": 9 }, g);
  stubEl = mk("path", { class: "hoc-mitral", d: "M" + f1(cav.x - 90) + " " + f1(cav.y - 42) + "L" + f1(cav.x - 50) + " " + f1(cav.y - 50), fill: "none" }, g);
  hingeEl = mk("circle", { class: "hoc-hinge", cx: f1(cav.x - 52), cy: f1(cav.y - 48), r: 3.5 }, g);
  leafEl = mk("path", { class: "hoc-leaf", d: "M" + f1(cav.x - 52) + " " + f1(cav.y - 48) + "L" + f1(cav.x - 8) + " " + f1(cav.y + 4), fill: "none" }, g);
  chordEl = mk("path", { class: "hoc-chord", d: "M" + f1(cav.x - 8) + " " + f1(cav.y + 4) + "L" + f1(cav.x - 32) + " " + f1(cav.y + 72), fill: "none" }, g);
  arrowL = mk("path", { class: "hoc-arrow", d: "M0 -6L10 0L0 6Z", opacity: "0" }, g);
  arrowR = mk("path", { class: "hoc-arrow", d: "M10 -6L0 0L10 6Z", opacity: "0" }, g);
  swirls = [0, 1, 2].map(() => mk("path", { class: "hoc-tur", d: "M0 -8 A8 8 0 1 1 -0.1 -8", fill: "none", opacity: "0" }, g));
  waves = [0, 1, 2].map(() => mk("path", { class: "hoc-wave", d: "M0 -12Q8 0 0 12", fill: "none", opacity: "0" }, g));
  recXY = [0, 1, 2, 3, 4].map((i) => [cav.x - 64, cav.y - 44 + i * 22]);
  recXY.forEach(([x, y]) => { mk("circle", { class: "hoc-rec", cx: f1(x), cy: f1(y), r: 4 }, g); });
  betaDots = recXY.map(([x, y]) => mk("circle", { class: "sc-p p-beta", cx: f1(x), cy: f1(y), r: 5.5, opacity: "0" }, g));
  sigTracks = recXY.slice(0, 4).map(([x, y]) => track([[x + 6, y], [cav.x - 24, y + 4]]));
  sigDots = [0, 1, 2, 3].map(() => mk("circle", { class: "sc-p p-sig", r: 3, opacity: "0" }, g));
  icdG = mk("g", { opacity: "0" }, g);
  mk("rect", { class: "hoc-icd", x: 716, y: 384, width: 58, height: 30, rx: 7 }, icdG);
  mk("path", { class: "hoc-lead", d: "M716 398 C672 392 630 362 592 314", fill: "none" }, icdG);
  mk("circle", { class: "hoc-shock", cx: 592, cy: 314, r: 4 }, icdG);
  const septX = cav.x + 78 - (22 + 58 * sm.Th);
  jetTrack = track(jetPts(septX));
  blood.forEach((p, i) => { p.k = i / blood.length; p.on = true; p.e.setAttribute("opacity", "1"); });
}

function initEcg() {
  flashEl = mk("rect", { class: "hoc-flash", x: EB.x, y: EB.y, width: EB.w, height: EB.h, rx: 10 }, L.ecg);
  ecgPath = mk("path", { class: "hoc-ecg", d: "M0 0", fill: "none" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "Rhythm strip. Thick scarred muscle can trigger a fast rhythm. Without treatment at high risk this can cause sudden death; an ICD shocks it back to normal." }, L.ecg);
  mk("rect", { x: EB.x, y: EB.y, width: EB.w, height: EB.h, fill: "transparent" }, eh);
}

function initPanel() {
  const o = L.over;
  pill(o, "Gene change", 93, 141, 150, 102, "A change in a heart muscle gene. It runs in families and makes muscle grow thick and disordered.");
  pill(o, "Leaflet", cav.x - 52, cav.y - 48, 300, 120, "The front flap of the mitral valve. Fast flow drags it toward the wall and plugs the exit.");
  pill(o, "Thick septum", cav.x + 48, cav.y, 560, 100, "The wall between the ventricles grows thickest near the exit and crowds it.");
  pill(o, "Narrow exit", cav.x + 7, cav.y - 62, 650, 170, "The doorway to the aorta. It narrows with each squeeze, so less blood gets out.");
  pill(o, "Aorta flow", 770, AY, 810, 150, "Blood leaving for the body. Weak flow can cause fainting, chest pain and breathlessness.");
  pill(o, "Murmur", AP[0] + 278, AY + 6, 700, 215, "A harsh noise from turbulent flow. It grows with standing and eases with squatting.");
  pill(o, "Rhythm", 790, 312, 800, 235, "Scarred thick muscle can trigger a fast rhythm that can cause sudden death.");
  capEl = mk("text", { class: "hoc-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, "moderate");
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["sept", "Septum", "g-bad", "Thickness of the septal wall. Septal reduction thins it; other treatments do not."], ["obs", "Block", "g-bad", "How narrow the outflow tract becomes in systole. It is dynamic and changes with filling and squeeze."], ["sam", "SAM", "g-sam", "Systolic anterior motion: how far the mitral leaflet moves toward the septum in systole."], ["fill", "Filling", "g-fl", "How stiff the ventricle is in diastole. Poor filling raises pressures and causes breathlessness."], ["mur", "Murmur", "g-mur", "Loudness of the ejection systolic murmur. Louder with the Valsalva manoeuvre, softer with squatting."], ["risk", "Risk", "g-bad", "Risk of sudden death from a ventricular arrhythmia. An ICD lowers it without changing the obstruction."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, y0, 52, 18, cls, name, tip); });
}

function capText(d, b) {
  if (d === 1) return "Beta blocker slows each squeeze. The exit stays open longer. Block is " + b + ".";
  if (d === 2) return "ICD shocks a dangerous rhythm. It does not unblock the exit. Block is " + b + ".";
  if (d === 3) return "Septal reduction thins the wall. The exit widens. Block is " + b + ".";
  return "No treatment. Thick wall blocks blood leaving the heart. Block is " + b + ".";
}

function ecgValue(tSec, beatT, danger) {
  if (danger) return 0.62 * Math.sin(tSec * 34);
  const p = ((tSec / beatT) % 1 + 1) % 1;
  let v = 0;
  if (p > 0.08 && p < 0.18) v += 0.14 * Math.sin(Math.PI * (p - 0.08) / 0.1);
  if (p > 0.22 && p < 0.245) v -= 0.16 * Math.sin(Math.PI * (p - 0.22) / 0.025);
  if (p > 0.245 && p < 0.285) v += 1 * Math.sin(Math.PI * (p - 0.245) / 0.04);
  if (p > 0.285 && p < 0.31) v -= 0.24 * Math.sin(Math.PI * (p - 0.285) / 0.025);
  if (p > 0.46 && p < 0.7) v += 0.32 * Math.sin(Math.PI * (p - 0.46) / 0.24);
  return v;
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 2.5), k2 = Math.min(1, dt * 1.8);
  ["a", "beta", "sept", "icd"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["Th", "Obs", "SAM", "Dias", "FlowOut", "Mur", "Risk"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  const beatT = 1.05 + 0.5 * sm.beta;
  const ph = ((tm / 1000) / beatT) % 1;
  const contract = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
  const squeeze = contract * (1 - 0.28 * sm.beta);
  const septW = 22 + 58 * sm.Th, septX = cav.x + 78 - septW;
  cavEl.setAttribute("rx", f1(58 + 10 * sm.sept - 14 * squeeze));
  cavEl.setAttribute("ry", f1(78 - 16 * squeeze));
  septEl.setAttribute("x", f1(septX));
  septEl.setAttribute("width", f1(septW));
  strainEl.setAttribute("opacity", (0.04 + 0.30 * sm.Obs).toFixed(2));
  tubeEl.setAttribute("stroke-width", f1(10 + 16 * sm.FlowOut));
  tubeInEl.setAttribute("stroke-width", f1(5 + 8 * sm.FlowOut));
  const hx = cav.x - 52, hy = cav.y - 48;
  const tipX = hx + 44 + 52 * sm.SAM * contract, tipY = hy + 52 - 48 * sm.SAM * contract;
  leafEl.setAttribute("d", "M" + f1(hx) + " " + f1(hy) + "L" + f1(tipX) + " " + f1(tipY));
  chordEl.setAttribute("d", "M" + f1(tipX) + " " + f1(tipY) + "L" + f1(tipX - 24) + " " + f1(cav.y + 72));
  arrowL.setAttribute("transform", "translate(" + f1(septX - 34) + " " + f1(cav.y - 62) + ")");
  arrowR.setAttribute("transform", "translate(" + f1(septX - 2) + " " + f1(cav.y - 62) + ") scale(-1 1)");
  arrowL.setAttribute("opacity", (sm.Obs * contract).toFixed(2)); arrowR.setAttribute("opacity", (sm.Obs * contract).toFixed(2));
  swirls.forEach((sw, i) => { sw.setAttribute("transform", "translate(" + f1(septX - 34 + i * 16) + " " + f1(cav.y - 38 + (i % 2) * 10 - 5) + ")"); sw.setAttribute("opacity", (sm.Obs * contract * (1 - i * 0.25)).toFixed(2)); });
  waves.forEach((wv, i) => { const s = 0.7 + 0.3 * Math.sin(tm / 260 + i); wv.setAttribute("transform", "translate(" + f1(700 + i * 22) + " " + f1(AY - 2) + ") scale(" + s.toFixed(2) + ")"); wv.setAttribute("opacity", (sm.Mur * contract * (1 - i * 0.22)).toFixed(2)); });
  betaDots.forEach((bd) => { bd.setAttribute("opacity", sm.beta.toFixed(2)); });
  sigDots.forEach((sd, i) => { const u = ((tm / 900) + i * 0.25) % 1, q = sigTracks[i % sigTracks.length].at(u); sd.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); sd.setAttribute("opacity", ((1 - sm.beta) * 0.9).toFixed(2)); });
  icdG.setAttribute("opacity", sm.icd.toFixed(2));
  jetTrack = track(jetPts(septX));
  const speed = (0.03 + 0.08 * sm.FlowOut + 0.05 * contract) * (1 - 0.2 * sm.beta);
  blood.forEach((p) => { p.k = (p.k + dt * speed) % 1; const pt = jetTrack.at(p.k); const turb = (p.k > 0.22 && p.k < 0.5) ? Math.sin(tm / 90 + p.k * 40) * 7 * sm.Obs : 0; p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y + turb) + ")"); });
  const cyc = (tm / 1000) % 7;
  const endD = sm.icd > 0.5 ? 5.32 : 6.3;
  const danger = sm.Risk > 0.62 && cyc > 5.1 && cyc < endD;
  const shocked = sm.icd > 0.5 && cyc > 5.1 && cyc < 5.32;
  flashEl.setAttribute("opacity", shocked ? "0.55" : "0");
  if (shocked && Math.random() < dt * 22) { const p = free(sparks); if (p) emit(p, rnd(700, 860), rnd(280, 340), rnd(-14, 14), rnd(-10, 10), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  let d = "";
  for (let x = EB.x; x <= EB.x + EB.w; x += 3) { const age = (EB.x + EB.w - x) / 110, tt = tm / 1000 - age, tc = ((tt % 7) + 7) % 7, isD = sm.Risk > 0.62 && tc > 5.1 && tc < (sm.icd > 0.5 ? 5.32 : 6.3); const v = ecgValue(tt, beatT, isD && !shocked); const y = clamp(EB.y + 58 - 34 * v, EB.y + 6, EB.y + EB.h - 6); d += (x === EB.x ? "M" : "L") + x + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  gg.sept.set(sm.Th, wordOf(sm.Th, 0.45, 0.7, ["thick", "thicker", "very thick"]));
  gg.obs.set(sm.Obs, wordOf(sm.Obs, 0.22, 0.55, ["none", "moderate", "severe"]));
  gg.sam.set(sm.SAM, wordOf(sm.SAM, 0.22, 0.55, ["none", "some", "marked"]));
  gg.fill.set(sm.Dias, wordOf(sm.Dias, 0.38, 0.68, ["supple", "stiff", "very stiff"]));
  gg.mur.set(sm.Mur, wordOf(sm.Mur, 0.3, 0.62, ["soft", "audible", "loud"]));
  gg.risk.set(sm.Risk, wordOf(sm.Risk, 0.25, 0.55, ["low", "raised", "high"]));
  const key = drug + "|" + m.words[0];
  if (key !== capKey) { capKey = key; const t = capText(drug, m.words[0]); if (capEl.textContent !== t) capEl.textContent = t; }
}
function init() { initInset(); initOrgans(); initEcg(); initPanel(); }
run({ init, step });
