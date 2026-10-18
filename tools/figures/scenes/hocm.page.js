/* HOCM scene: sarcomere gene to thick myocytes, a stiff ventricle, systolic anterior motion, outflow jet, murmur, rhythm and gauges. */
const HX = 460, HY = 280;
const EB = { x: 678, y: 266, w: 238, h: 92 };
const L = { inset: $("inset"), heart: $("heart"), flow: $("flow"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const sm = { a: 0.65, Th: 0.6, Obs: 0.5, SAM: 0.5, Dias: 0.6, FlowOut: 0.6, Mur: 0.5, Risk: 0.6, beta: 0, sept: 0, icd: 0 };
let wallEl, cavEl, septEl, leafEl, chordEl, tipEl, arrowL, arrowR, myosinEls = [], myocytes = [], waves = [], flashEl, ecgPath, jetTrack;
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
  for (let y = 100; y <= 182; y += 4) { const x1 = 82 + Math.sin((y - 100) / 13) * 20, x2 = 82 - Math.sin((y - 100) / 13) * 20; d1 += (y === 100 ? "M" : "L") + f1(x1) + " " + y; d2 += (y === 100 ? "M" : "L") + f1(x2) + " " + y; }
  mk("path", { class: "hoc-dna", d: d1 }, g); mk("path", { class: "hoc-dna", d: d2 }, g);
  for (let y = 108; y <= 176; y += 17) { const dx = Math.sin((y - 100) / 13) * 20; mk("path", { class: "hoc-rung", d: "M" + f1(82 - dx) + " " + y + "L" + f1(82 + dx) + " " + y }, g); }
  mk("circle", { class: "hoc-mut", cx: 96, cy: 141, r: 6 }, g);
  const cap1 = mk("text", { class: "hoc-cap sc-lab", x: 128, y: 128 }, g); cap1.textContent = "sarcomere";
  const cap2 = mk("text", { class: "hoc-cap sc-lab", x: 128, y: 144 }, g); cap2.textContent = "gene change";
  mk("path", { class: "hoc-z", d: "M52 214V278M238 214V278" }, g);
  [226, 242, 262].forEach((y) => { mk("path", { class: "hoc-actin", d: "M52 " + y + "H150M238 " + y + "H140" }, g); });
  [232, 248, 264].forEach((y) => { const e = mk("path", { class: "hoc-myosin", d: "M104 " + y + "H186", "stroke-width": 5 }, g); myosinEls.push(e); });
  const ccap = mk("text", { class: "hoc-cap sc-lab", x: 52, y: 406 }, g); ccap.textContent = "disordered, thick filaments";
  [[72, 348], [140, 358], [208, 348]].forEach(([x, y], i) => { const c = cell(g, { cls: "hocmyo", r: 24, nuc: 0.4, seed: i * 3 + 2, wob: 0.14 }); myocytes.push({ g: c, x, y }); });
}

function initHeart() {
  const g = L.heart;
  mk("path", { class: "hoc-aorta", d: "M560 188C618 118 676 96 756 96H842" }, g);
  mk("path", { class: "hoc-aortaIn", d: "M560 188C618 118 676 96 756 96H842" }, g);
  wallEl = mk("ellipse", { class: "hoc-wall", cx: HX, cy: HY, rx: 158, ry: 140 }, g);
  cavEl = mk("ellipse", { class: "hoc-cav", cx: HX - 12, cy: HY + 6, rx: 96, ry: 112 }, g);
  septEl = mk("ellipse", { class: "hoc-sept", cx: HX + 82, cy: HY - 4, rx: 58, ry: 104, transform: "rotate(-10 " + (HX + 82) + " " + (HY - 4) + ")" }, g);
  mk("path", { class: "hoc-mitral", d: "M352 176L398 188" }, g);
  chordEl = mk("path", { class: "hoc-chord", d: "M448 238L420 318" }, g);
  leafEl = mk("path", { class: "hoc-leaf", d: "M412 182L452 242" }, g);
  tipEl = mk("circle", { class: "hoc-mut", cx: 452, cy: 242, r: 4 }, g);
  arrowL = mk("path", { class: "hoc-arrow", d: "M0 -6L10 0L0 6Z", opacity: "0" }, g);
  arrowR = mk("path", { class: "hoc-arrow", d: "M10 -6L0 0L10 6Z", opacity: "0" }, g);
  waves = [0, 1, 2].map((i) => mk("path", { class: "hoc-wave", d: "M0 -12Q8 0 0 12", opacity: "0" }, g));
  jetTrack = track([[360, 190], [404, 252], [452, 306], [512, 262], [560, 192], [632, 122], [748, 98], [838, 98]]);
  blood.forEach((p, i) => { p.k = i / blood.length; p.on = true; p.e.setAttribute("opacity", "1"); });
}

function initEcg() {
  flashEl = mk("rect", { class: "hoc-flash", x: EB.x, y: EB.y, width: EB.w, height: EB.h, rx: 10 }, L.ecg);
  ecgPath = mk("path", { class: "hoc-ecg" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "Rhythm strip. Disordered scarred muscle can start a fast ventricular rhythm. Without treatment at high risk this can cause sudden death; an ICD detects it and delivers a shock." }, L.ecg);
  mk("rect", { x: EB.x, y: EB.y, width: EB.w, height: EB.h, fill: "transparent" }, eh);
}

function initPanel() {
  const o = L.over;
  pill(o, "Sarcomere gene", 96, 141, 165, 100, "A change in a sarcomere gene, the motor proteins of the muscle cell. It is often inherited and can run in families.");
  pill(o, "Thick myocyte", 140, 348, 150, 300, "Muscle cells grow large with disordered sarcomeres. The wall thickens, relaxes poorly and can scar.");
  pill(o, "Mitral leaflet", 452, 242, 380, 115, "The anterior mitral leaflet. In systole fast outflow pulls it toward the septum: systolic anterior motion, or SAM.");
  pill(o, "Thick septum", 528, 262, 540, 115, "The septum bulges into the cavity, most near the outflow tract. This asymmetric septal hypertrophy narrows the exit.");
  pill(o, "Narrow outflow", 566, 188, 700, 165, "The outflow tract between leaflet and septum. Obstruction here is dynamic: worse when the heart is emptier or squeezing harder, for example on standing or with the Valsalva manoeuvre.");
  pill(o, "Aorta", 756, 96, 830, 132, "Blood leaving for the body. When outflow is blocked the jet is fast and turbulent but forward flow falls, so the patient may faint.");
  pill(o, "Murmur", 648, 132, 715, 205, "A harsh ejection systolic murmur from turbulent outflow. It gets louder with the Valsalva manoeuvre and standing, and softer with squatting, the opposite of most murmurs.");
  pill(o, "Syncope", 700, 108, 855, 205, "Fainting when outflow cannot rise to meet demand, or from a dangerous rhythm. Chest pain and breathlessness also occur.");
  pill(o, "Risk rhythm", 790, 312, 800, 235, "Ventricular arrhythmia arising in thick, disordered, scarred muscle. This is the main route to sudden death in this condition.");
  pill(o, "Stiff filling", 420, 330, 430, 425, "Diastolic dysfunction: the thick stiff ventricle relaxes slowly and fills at high pressure, causing breathlessness even when the squeeze looks strong.");
  const pb = pill(o, "Beta blocker", 430, 280, 250, 425, "A beta blocker slows the heart and softens the squeeze, giving more filling time and less dynamic obstruction."); pb.setAttribute("id", "p-beta"); pb.style.opacity = 0;
  const ps = pill(o, "Septal reduction", 528, 240, 625, 425, "Septal reduction thins the bulging septum by surgical myectomy or alcohol ablation, widening the outflow tract."); ps.setAttribute("id", "p-sept"); ps.style.opacity = 0;
  const pi = pill(o, "ICD", 820, 300, 888, 235, "An implantable cardioverter defibrillator. It does not open the outflow tract; it shocks a lethal ventricular rhythm back to normal."); pi.setAttribute("id", "p-icd"); pi.style.opacity = 0;
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["sept", "Septum", "g-bad", "Thickness of the septal wall. Septal reduction thins it; other treatments do not."], ["obs", "Block", "g-bad", "How narrow the outflow tract becomes in systole. It is dynamic and changes with filling and squeeze."], ["sam", "SAM", "g-sam", "Systolic anterior motion: how far the mitral leaflet moves toward the septum in systole."], ["fill", "Filling", "g-fl", "How stiff the ventricle is in diastole. Poor filling raises pressures and causes breathlessness."], ["mur", "Murmur", "g-mur", "Loudness of the ejection systolic murmur. Louder with the Valsalva manoeuvre, softer with squatting."], ["risk", "Risk", "g-bad", "Risk of sudden death from a ventricular arrhythmia. An ICD lowers it without changing the obstruction."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, y0, 52, 18, cls, name, tip); });
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
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["a", "beta", "sept", "icd"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["Th", "Obs", "SAM", "Dias", "FlowOut", "Mur", "Risk"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  const beatT = 1.05 + 0.45 * sm.beta;
  const ph = ((tm / 1000) / beatT) % 1;
  const contract = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
  const squeeze = contract * (1 - 0.28 * sm.beta);
  cavEl.setAttribute("rx", f1(96 - 26 * squeeze + 5 * sm.Dias * (1 - contract)));
  cavEl.setAttribute("ry", f1(112 - 30 * squeeze));
  const septRx = 30 + 44 * sm.Th;
  septEl.setAttribute("rx", f1(septRx)); septEl.setAttribute("ry", f1(88 + 26 * sm.Th));
  septEl.setAttribute("cx", f1(HX + 96 - 22 * sm.Th));
  const tipX = 452 + 52 * sm.SAM * contract, tipY = 242 - 30 * sm.SAM * contract;
  leafEl.setAttribute("d", "M412 182L" + f1(tipX) + " " + f1(tipY));
  chordEl.setAttribute("d", "M" + f1(tipX) + " " + f1(tipY) + "L420 318");
  tipEl.setAttribute("cx", f1(tipX)); tipEl.setAttribute("cy", f1(tipY));
  const gapX = HX + 96 - 22 * sm.Th - septRx;
  arrowL.setAttribute("transform", "translate(" + f1(gapX - 16) + " " + f1(HY - 92) + ")");
  arrowR.setAttribute("transform", "translate(" + f1(gapX + 20) + " " + f1(HY - 92) + ") scale(-1 1)");
  arrowL.setAttribute("opacity", (sm.Obs * contract).toFixed(2)); arrowR.setAttribute("opacity", (sm.Obs * contract).toFixed(2));
  wallEl.setAttribute("rx", f1(158 - 6 * squeeze)); wallEl.setAttribute("ry", f1(140 - 6 * squeeze));
  myosinEls.forEach((e) => e.setAttribute("stroke-width", f1(3.5 + 5 * sm.Th)));
  myocytes.forEach((c, i) => place(c.g, c.x, c.y, Math.sin(tm / 700 + i) * 5, 0.72 + 0.55 * sm.Th));
  waves.forEach((wv, i) => { const s = 0.7 + 0.3 * Math.sin(tm / 260 + i); wv.setAttribute("transform", "translate(" + f1(650 + i * 17) + " " + f1(128 - i * 3) + ") scale(" + s.toFixed(2) + ")"); wv.setAttribute("opacity", (sm.Mur * contract * (1 - i * 0.22)).toFixed(2)); });
  const speed = (0.028 + 0.075 * sm.FlowOut + 0.05 * contract) * (1 - 0.25 * sm.beta);
  blood.forEach((p) => { p.k = (p.k + dt * speed) % 1; const pt = jetTrack.at(p.k); const turb = p.k > 0.62 ? Math.sin(tm / 90 + p.k * 40) * 5 * sm.Obs : 0; p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y + turb) + ")"); p.e.setAttribute("opacity", p.k > 0.62 && sm.Obs > 0.72 && contract < 0.15 ? "0.25" : "1"); });
  if (sm.icd > 0.5 && sm.a > 0.8 && Math.random() < dt * 1.4) { const p = free(sparks); if (p) emit(p, rnd(720, 880), rnd(280, 340), rnd(-14, 14), rnd(-10, 10), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  const cyc = (tm / 1000) % 7;
  const danger = sm.Risk > 0.62 && cyc > 5.1 && cyc < 6.3;
  const shocked = sm.icd > 0.5 && sm.a > 0.8 && cyc > 5.1 && cyc < 5.32;
  flashEl.setAttribute("opacity", shocked ? "0.55" : "0");
  let d = "";
  for (let x = EB.x; x <= EB.x + EB.w; x += 3) { const age = (EB.x + EB.w - x) / 110, tt = tm / 1000 - age, isD = sm.Risk > 0.62 && ((tt % 7) + 7) % 7 > 5.1 && ((tt % 7) + 7) % 7 < 6.3; const v = ecgValue(tt, beatT, isD && !shocked); const y = clamp(EB.y + 58 - 34 * v, EB.y + 6, EB.y + EB.h - 6); d += (x === EB.x ? "M" : "L") + x + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  $("p-beta").style.opacity = sm.beta.toFixed(2); $("p-sept").style.opacity = sm.sept.toFixed(2); $("p-icd").style.opacity = sm.icd.toFixed(2);
  gg.sept.set(sm.Th, wordOf(sm.Th, 0.45, 0.7, ["thick", "thicker", "very thick"]));
  gg.obs.set(sm.Obs, wordOf(sm.Obs, 0.22, 0.55, ["none", "moderate", "severe"]));
  gg.sam.set(sm.SAM, wordOf(sm.SAM, 0.22, 0.55, ["none", "some", "marked"]));
  gg.fill.set(sm.Dias, wordOf(sm.Dias, 0.38, 0.68, ["supple", "stiff", "very stiff"]));
  gg.mur.set(sm.Mur, wordOf(sm.Mur, 0.3, 0.62, ["soft", "audible", "loud"]));
  gg.risk.set(sm.Risk, wordOf(sm.Risk, 0.25, 0.55, ["low", "raised", "high"]));
}
function init() { initInset(); initHeart(); initEcg(); initPanel(); }
run({ init, step });
