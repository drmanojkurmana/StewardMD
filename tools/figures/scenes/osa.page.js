/* OSA scene: pharyngeal collapse in sleep, apnoea, gas changes, arousal, sympathetic surge and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), air: $("airLumen"), tongue: $("tongueG"), palate: $("palateG"), fat: $("fatPad"), cpap: $("cpapG"), jaw: $("jawG"), lung: $("lungG"), brain: $("brainG"), heart: $("heartG"), arousal: $("arousalG"), symp: $("sympG"), oxy: $("oxyOverlay"), zzz: $("zzz"), blood: $("bloodG") };
const airTrack = track([[92, 185], [228, 185], [282, 212], [291, 318], [338, 378], [452, 328], [505, 272]]);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const airP = pool(22, () => mk("circle", { class: "sc-p p-air", r: 3.2 }, layers.parts));
const co2P = pool(12, () => mk("circle", { class: "sc-p p-co2", r: 3 }, layers.parts));
const symP = pool(10, () => mk("circle", { class: "sc-p p-symp", r: 2.6 }, layers.parts));
const rbcs = [];
function initBlood() { for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.blood); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(418, 612), y: 397, v: rnd(0.8, 1.2) }); } }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
let cpapPill = null, jawPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "During the night and after";
  [["col", "Collapse", "g-osa", "How far the pharyngeal airway narrows or closes in sleep as dilator muscle tone falls."], ["apn", "Apnoeas", "g-bad", "Breathing pauses when the upper airway closes completely, despite chest effort to breathe in."], ["oxy", "Oxygen dip", "g-osa2", "How far blood oxygen falls during each apnoea. Carbon dioxide rises at the same time."], ["aro", "Arousals", "g-eos", "Brief brain arousals reopen the airway but fragment sleep, causing daytime sleepiness."], ["sym", "Sympathetic", "g-bac", "Sympathetic surges with each arousal raise heart rate and blood pressure and strain the heart."], ["slp", "Sleepiness", "g-cyt", "Daytime sleepiness from fragmented sleep. Long term strain links to hypertension, arrhythmia and pulmonary hypertension."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Soft palate", 248, 205, 120, 100, "Soft palate: the flap at the back of the roof of the mouth. In a crowded airway it is pulled back and helps block the pharynx.");
  pill(ox, "Tongue", 202, 272, 110, 330, "Tongue: a large tongue falls back in sleep, especially lying flat, and narrows the pharyngeal airway.");
  pill(ox, "Pharyngeal wall", 333, 220, 355, 100, "Pharyngeal wall: the back wall of the throat. The airway collapses between the tongue and palate in front and this wall behind.");
  pill(ox, "Dilator muscles", 316, 240, 375, 128, "Upper airway dilator muscles hold the pharynx open while awake. Sleep reduces their tone, so a crowded airway can collapse.");
  pill(ox, "Neck fat", 330, 368, 180, 395, "Fat around the neck in obesity presses on the airway from outside and makes pharyngeal collapse more likely.");
  pill(ox, "Lungs", 515, 258, 515, 125, "Lungs and chest: breathing effort continues during an apnoea, but no air moves until arousal reopens the airway.");
  pill(ox, "Low oxygen blood", 515, 397, 515, 430, "Blood leaving the lungs carries less oxygen after apnoeas, and carbon dioxide rises. Repeated dips strain the heart and vessels.");
  pill(ox, "Brain arousal", 786, 145, 785, 80, "Brain: falling oxygen and rising carbon dioxide trigger a brief arousal. Muscle tone returns and breathing restarts, but sleep is fragmented.");
  pill(ox, "Heart", 786, 315, 700, 255, "Heart: sympathetic surges and pressure swings with each arousal strain the heart, linked to hypertension, arrhythmia and pulmonary hypertension.");
  cpapPill = pill(ox, "CPAP mask", 88, 185, 75, 135, "CPAP mask: continuous positive airway pressure splints the pharynx open so it cannot collapse in sleep.");
  jawPill = pill(ox, "Jaw device", 116, 245, 85, 285, "Mandibular device or surgery: holds the jaw and tongue forward, or removes crowded tissue, to enlarge the airway.");
}
const sm = { a: 0.65, C: 0.65, oxy: 0.6, aro: 0.6, symp: 0.5, sleepy: 0.6, wl: 0, cpap: 0, surg: 0, close: 0, oxyState: 0.3 };
const acc = { co2: 0, sym: 0 };
function init() { initBlood(); initPanel(); airP.forEach((p, i) => { emit(p, 0, 0, 0, 0); p.u = i / airP.length; }); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.6);
  sm.a = lerp(sm.a, m.a, k2); sm.C = lerp(sm.C, m.C, k2); sm.oxy = lerp(sm.oxy, m.oxy, k2); sm.aro = lerp(sm.aro, m.aro, k2); sm.symp = lerp(sm.symp, m.symp, k2); sm.sleepy = lerp(sm.sleepy, m.sleepy, k2);
  sm.wl = lerp(sm.wl, m.wl, k); sm.cpap = lerp(sm.cpap, m.cpap, k); sm.surg = lerp(sm.surg, m.surg, k);
  const cyc = (tm % 8000) / 8000, apFrac = sm.C * 0.55, inAp = cyc < apFrac, aroPh = !inAp && cyc < apFrac + 0.09 && sm.C > 0.22;
  sm.close = lerp(sm.close, inAp ? 1 : 0, Math.min(1, dt * 3));
  sm.oxyState = lerp(sm.oxyState, inAp ? 0.25 + 0.7 * sm.C : 0.12 * sm.C, Math.min(1, dt * (inAp ? 0.55 : 0.9)));
  const gap = clamp(1 - sm.C * (0.22 + 0.72 * sm.close) + sm.cpap * 0.25, 0.06, 1);
  layers.air.setAttribute("width", f1(58 * gap)); layers.air.setAttribute("x", f1(320 - 58 * gap));
  const back = (1 - gap) * 52 - sm.surg * 20;
  layers.tongue.setAttribute("transform", "translate(" + f1(back) + " " + f1((1 - gap) * 8) + ")");
  layers.palate.setAttribute("transform", "translate(" + f1((1 - gap) * 22) + " " + f1((1 - gap) * 13) + ")");
  const fatS = (0.72 + 0.45 * sm.a) * (1 - 0.42 * sm.wl);
  layers.fat.setAttribute("transform", "translate(330 368) scale(" + fatS.toFixed(3) + ") translate(-330 -368)");
  layers.cpap.setAttribute("opacity", sm.cpap.toFixed(2)); layers.jaw.setAttribute("opacity", sm.surg.toFixed(2));
  if (cpapPill) cpapPill.style.opacity = sm.cpap.toFixed(2); if (jawPill) jawPill.style.opacity = sm.surg.toFixed(2);
  const breath = Math.sin(tm / 1100), vent = inAp ? 0 : clamp(0.4 + 0.6 * (1 - sm.C * 0.4));
  const lungS = 1 + 0.055 * breath * vent + (inAp ? 0.012 * Math.sin(tm / 90) : 0);
  layers.lung.setAttribute("transform", "translate(515 258) scale(" + lungS.toFixed(3) + ") translate(-515 -258)");
  layers.oxy.setAttribute("opacity", sm.oxyState.toFixed(2));
  rbcs.forEach((r) => { r.x += r.v * (inAp ? 14 : 42) * dt; if (r.x > 614) r.x = 416; place(r.g, r.x, r.y + Math.sin(tm / 500 + r.x) * 1.5, 0, 1); });
  layers.arousal.setAttribute("opacity", aroPh ? "1" : "0"); layers.symp.setAttribute("opacity", aroPh ? (0.4 + 0.6 * sm.symp).toFixed(2) : (sm.symp * 0.25).toFixed(2));
  layers.zzz.setAttribute("opacity", aroPh ? "0.15" : "0.9");
  const beat = Math.max(0, Math.sin(tm * (0.004 + 0.005 * sm.symp))), hs = 1 + 0.07 * beat * (0.5 + sm.symp) + (aroPh ? 0.05 : 0);
  layers.heart.setAttribute("transform", "translate(786 315) scale(" + hs.toFixed(3) + ") translate(-786 -315)");
  airP.forEach((p) => { if (!p.on) return; const blocked = sm.close > 0.55 && gap < 0.45;
    if (!(blocked && p.u > 0.3)) p.u += dt * (inAp ? 0.015 : 0.11) * (0.5 + vent);
    if (p.u > 1) p.u = 0; if (blocked && p.u > 0.3 && p.u < 0.36) p.u = 0.3;
    const q = airTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", blocked && p.u >= 0.3 ? "0.25" : "0.95"); });
  acc.co2 += dt * (inAp ? 5 : sm.C * 1.2); while (acc.co2 >= 1) { acc.co2--; const p = free(co2P); if (p) emit(p, rnd(440, 590), rnd(210, 310), rnd(-5, 5), rnd(-14, -7)); }
  co2P.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) kill(p); });
  if (aroPh) { acc.sym += dt * 9; while (acc.sym >= 1) { acc.sym--; const p = free(symP); if (p) emit(p, 786 + rnd(-28, 28), 315 + rnd(-18, 18), rnd(-34, 34), rnd(-30, -8)); } }
  symP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3) kill(p); });
  gg.col.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["open", "narrow", "closing"])); gg.apn.set(sm.C, wordOf(sm.C, 0.25, 0.55, ["rare", "some", "many"]));
  gg.oxy.set(sm.oxyState, wordOf(sm.oxyState, 0.3, 0.6, ["small", "deep", "very deep"])); gg.aro.set(sm.aro, wordOf(sm.aro, 0.3, 0.6, ["few", "some", "many"]));
  gg.sym.set(sm.symp, wordOf(sm.symp, 0.3, 0.6, ["low", "raised", "high"])); gg.slp.set(sm.sleepy, wordOf(sm.sleepy, 0.3, 0.6, ["alert", "sleepy", "very sleepy"]));
}
run({ init, step });
