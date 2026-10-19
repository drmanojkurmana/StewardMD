/* OSA scene: throat closure in sleep, real lung, brain and heart organs, blood oxygen,
 * brain arousal, sympathetic surge, each treatment visibly acting, and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), air: $("airLumen"), tongue: $("tongueG"), palate: $("palateG"), fat: $("fatPad"), cpap: $("cpapG"), jaw: $("jawG"), pos: $("posG"), trachea: $("trachea"), duskL: $("duskL"), duskR: $("duskR"), vessel: $("oxyVessel"), oxy: $("oxyOverlay"), brainFx: $("brainFx"), arousal: $("arousalG"), symp: $("sympG"), zzz: $("zzz"), blood: $("bloodG"), slotL: $("lungSlotL"), slotR: $("lungSlotR"), heart: $("heartSlot") };
let lungL = null, lungR = null, brainO = null, heartO = null, capEl = null, capDrug = -1, capLevel = -1;
let HX = 786, HY = 322, VX0 = 560, VX1 = 729, LT = 190, LB = 330;
let airTrack = null, cpapTrack = null;
function capText(d, l) {
  const sev = ["Mild crowding. ", "Moderate crowding. ", "Severe crowding. "][l];
  if (d === 1) return sev + "Weight loss and side sleeping ease the squeeze. Closures fall but some remain.";
  if (d === 2) return sev + "The jaw device holds the tongue forward. The throat stays open longer.";
  if (d === 3) return sev + "CPAP pressure holds the throat open. Air flows and sleep settles.";
  return sev + "No treatment. The throat closes in sleep, oxygen dips and sleep breaks up.";
}
/* recognisable organs; vessels, tracks and particles anchor to their ports */
function initOrgans() {
  lungL = organ($("lungSlotL"), "lung", 458, 258, 130, { flip: true });
  lungR = organ($("lungSlotR"), "lung", 572, 258, 130, {});
  brainO = organ($("brainSlot"), "brain", 795, 175, 170, {});
  heartO = organ($("heartSlot"), "heart", 786, 322, 115, {});
  HX = heartO.x; HY = heartO.y;
  const hilL = lungL.ports.hilumL || lungL.ports.in, hilR = lungR.ports.hilumL || lungR.ports.in;
  const carina = [515, 232], hilMid = [(hilL[0] + hilR[0]) / 2, (hilL[1] + hilR[1]) / 2];
  layers.trachea.setAttribute("d", "M291 330 L315 384 L" + f1(carina[0]) + " " + f1(carina[1])
    + " M" + f1(carina[0]) + " " + f1(carina[1]) + " L" + f1(hilL[0]) + " " + f1(hilL[1])
    + " M" + f1(carina[0]) + " " + f1(carina[1]) + " L" + f1(hilR[0]) + " " + f1(hilR[1]));
  airTrack = track([[92, 185], [228, 185], [282, 212], [291, 318], [315, 384], carina, hilMid]);
  cpapTrack = track([[110, 192], [190, 190], [250, 205], [285, 245]]);
  VX0 = 560; VX1 = Math.round(HX - heartO.w * 0.28);
  layers.vessel.setAttribute("x", f1(VX0)); layers.vessel.setAttribute("width", f1(VX1 - VX0));
  layers.oxy.setAttribute("x", f1(VX0)); layers.oxy.setAttribute("width", f1(VX1 - VX0));
  LT = Math.round(Math.min(lungL.y - lungL.h * 0.32, lungR.y - lungR.h * 0.32));
  LB = Math.round(Math.max(lungL.y + lungL.h * 0.32, lungR.y + lungR.h * 0.32));
  [[layers.duskL, lungL], [layers.duskR, lungR]].forEach(([el, L]) => {
    el.setAttribute("cx", f1(L.x)); el.setAttribute("cy", f1(L.y));
    el.setAttribute("rx", f1(L.w * 0.33)); el.setAttribute("ry", f1(L.h * 0.36));
  });
  const top = brainO.y - brainO.h / 2;
  layers.brainFx.setAttribute("transform", "translate(" + f1(brainO.x - 795) + " " + f1(top - 30 - 98) + ")");
  layers.symp.setAttribute("transform", "translate(" + f1(HX - 786) + " " + f1(HY - 322) + ")");
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const airP = pool(22, () => mk("circle", { class: "sc-p p-air", r: 3.2 }, layers.parts));
const co2P = pool(12, () => mk("circle", { class: "sc-p p-co2", r: 3 }, layers.parts));
const symP = pool(10, () => mk("circle", { class: "sc-p p-symp", r: 2.6 }, layers.parts));
const cpapP = pool(10, () => mk("circle", { class: "sc-p osa-cpapdot", r: 3 }, layers.parts));
const rbcs = [];
function initBlood() { for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.blood); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(VX0 + 6, VX1 - 6), y: 399, v: rnd(0.8, 1.2) }); } }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "During the night and after";
  [["col", "Collapse", "g-osa", "How far the throat narrows or closes in sleep as muscle tone falls."], ["apn", "Apnoeas", "g-bad", "Breathing pauses when the throat closes completely, although the chest still tries to breathe in."], ["oxy", "Oxygen dip", "g-osa2", "How far blood oxygen falls during each closure. Carbon dioxide rises at the same time."], ["aro", "Arousals", "g-eos", "Brief waking of the brain that reopens the throat but breaks up sleep, causing daytime sleepiness."], ["sym", "Sympathetic", "g-bac", "Nightly surges that raise heart rate and blood pressure and strain the heart."], ["slp", "Sleepiness", "g-cyt", "Daytime sleepiness from broken sleep. Repeated strain is linked to raised blood pressure and heart rhythm problems."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Tongue and palate", 240, 250, 150, 100, "Tongue and palate: they fall back in sleep and crowd the throat.");
  pill(ox, "Throat muscle", 316, 230, 340, 100, "Throat muscle: sleep relaxes it, so a crowded throat can close.");
  pill(ox, "Lungs", 515, 258, 515, 100, "Lungs: the chest keeps trying to breathe, but no air moves while the throat is closed.");
  pill(ox, "Brain waking", 790, 175, 790, 100, "Brain: falling oxygen briefly wakes the brain. Sleep breaks up and daytime sleepiness follows.");
  pill(ox, "Neck fat", 330, 368, 200, 410, "Neck fat: extra tissue around the neck presses on the throat from outside.");
  pill(ox, "Blood oxygen", 647, 399, 640, 418, "Blood leaving the lungs carries less oxygen after closures, and carbon dioxide rises.");
  pill(ox, "Heart strain", 800, 352, 790, 420, "Heart: repeated nightly surges strain the heart and vessels.");
  capEl = mk("text", { class: "osa-cap", x: 30, y: 438 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { a: 0.65, C: 0.65, oxy: 0.6, aro: 0.6, symp: 0.5, sleepy: 0.6, wl: 0, cpap: 0, surg: 0, close: 0, oxyState: 0.3 };
const acc = { co2: 0, sym: 0 };
function init() { initOrgans(); initBlood(); initPanel(); airP.forEach((p, i) => { emit(p, 0, 0, 0, 0); p.u = i / airP.length; }); cpapP.forEach((p, i) => { emit(p, 0, 0, 0, 0); p.u = i / cpapP.length; p.e.setAttribute("opacity", "0"); }); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.6);
  sm.a = lerp(sm.a, m.a, k2); sm.C = lerp(sm.C, m.C, k2); sm.oxy = lerp(sm.oxy, m.oxy, k2); sm.aro = lerp(sm.aro, m.aro, k2); sm.symp = lerp(sm.symp, m.symp, k2); sm.sleepy = lerp(sm.sleepy, m.sleepy, k2);
  sm.wl = lerp(sm.wl, m.wl, k); sm.cpap = lerp(sm.cpap, m.cpap, k); sm.surg = lerp(sm.surg, m.surg, k);
  const apFrac = sm.C * 0.55 * (1 - 0.92 * sm.cpap), cyc = (tm % 8000) / 8000;
  const inAp = cyc < apFrac, aroPh = !inAp && cyc < apFrac + 0.09 && sm.C > 0.22;
  sm.close = lerp(sm.close, inAp ? 1 : 0, Math.min(1, dt * 3));
  sm.oxyState = lerp(sm.oxyState, inAp ? 0.25 + 0.7 * sm.C : 0.12 * sm.C, Math.min(1, dt * (inAp ? 0.55 : 0.9)));
  const gap = clamp(1 - sm.C * (0.22 + 0.72 * sm.close) + sm.cpap * 0.55 + sm.surg * 0.1, 0.06, 1);
  layers.air.setAttribute("width", f1(58 * gap)); layers.air.setAttribute("x", f1(320 - 58 * gap));
  const back = (1 - gap) * 52 - sm.surg * 20 - sm.wl * 8;
  layers.tongue.setAttribute("transform", "translate(" + f1(back) + " " + f1((1 - gap) * 8) + ")");
  layers.palate.setAttribute("transform", "translate(" + f1((1 - gap) * 22 - sm.surg * 8) + " " + f1((1 - gap) * 13) + ")");
  const fatS = (0.72 + 0.45 * sm.a) * (1 - 0.42 * sm.wl);
  layers.fat.setAttribute("transform", "translate(330 368) scale(" + fatS.toFixed(3) + ") translate(-330 -368)");
  layers.cpap.setAttribute("opacity", sm.cpap.toFixed(2)); layers.jaw.setAttribute("opacity", sm.surg.toFixed(2));
  layers.pos.setAttribute("opacity", sm.wl.toFixed(2));
  layers.pos.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 900) * 2.5) + ")");
  const breath = Math.sin(tm / 1100), vent = inAp ? 0 : clamp(0.4 + 0.6 * (1 - sm.C * 0.4));
  const lungS = 1 + 0.055 * breath * vent + (inAp ? 0.012 * Math.sin(tm / 90) : 0);
  [[layers.slotL, lungL], [layers.slotR, lungR]].forEach(([slot, L]) => {
    slot.setAttribute("transform", "translate(" + f1(L.x) + " " + f1(L.y) + ") scale(" + lungS.toFixed(3) + ") translate(" + f1(-L.x) + " " + f1(-L.y) + ")");
  });
  layers.oxy.setAttribute("opacity", sm.oxyState.toFixed(2));
  layers.duskL.setAttribute("opacity", (sm.oxyState * 0.5).toFixed(2));
  layers.duskR.setAttribute("opacity", (sm.oxyState * 0.5).toFixed(2));
  rbcs.forEach((r) => { r.x += r.v * (inAp ? 14 : 42) * dt; if (r.x > VX1 - 6) r.x = VX0 + 6; place(r.g, r.x, r.y + Math.sin(tm / 500 + r.x) * 1.5, 0, 1); });
  layers.arousal.setAttribute("opacity", aroPh ? "1" : "0"); layers.symp.setAttribute("opacity", aroPh ? (0.4 + 0.6 * sm.symp).toFixed(2) : (sm.symp * 0.25).toFixed(2));
  layers.zzz.setAttribute("opacity", aroPh ? "0.15" : "0.9");
  const beat = Math.max(0, Math.sin(tm * (0.004 + 0.005 * sm.symp))), hs = 1 + 0.07 * beat * (0.5 + sm.symp) + (aroPh ? 0.05 : 0);
  layers.heart.setAttribute("transform", "translate(" + f1(HX) + " " + f1(HY) + ") scale(" + hs.toFixed(3) + ") translate(" + f1(-HX) + " " + f1(-HY) + ")");
  airP.forEach((p) => { if (!p.on) return; const blocked = sm.close > 0.55 && gap < 0.45;
    if (!(blocked && p.u > 0.3)) p.u += dt * (inAp ? 0.015 : 0.11) * (0.5 + vent);
    if (p.u > 1) p.u = 0; if (blocked && p.u > 0.3 && p.u < 0.36) p.u = 0.3;
    const q = airTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", blocked && p.u >= 0.3 ? "0.25" : "0.95"); });
  cpapP.forEach((p) => { if (!p.on) return; p.u += dt * (0.2 + 0.5 * sm.cpap); if (p.u > 1) p.u -= 1;
    const q = cpapTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    p.e.setAttribute("opacity", sm.cpap < 0.05 ? "0" : (0.2 + 0.8 * sm.cpap).toFixed(2)); });
  acc.co2 += dt * (inAp ? 5 : sm.C * 1.2); while (acc.co2 >= 1) { acc.co2--; const p = free(co2P); if (p) emit(p, rnd(lungL.x - 45, lungR.x + 45), rnd(LT, LB), rnd(-5, 5), rnd(-14, -7)); }
  co2P.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) kill(p); });
  if (aroPh) { acc.sym += dt * 9; while (acc.sym >= 1) { acc.sym--; const p = free(symP); if (p) emit(p, HX + rnd(-28, 28), HY + rnd(-18, 18), rnd(-34, 34), rnd(-30, -8)); } }
  symP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3) kill(p); });
  gg.col.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["open", "narrow", "closing"])); gg.apn.set(sm.C, wordOf(sm.C, 0.25, 0.55, ["rare", "some", "many"]));
  gg.oxy.set(sm.oxyState, wordOf(sm.oxyState, 0.3, 0.6, ["small", "deep", "very deep"])); gg.aro.set(sm.aro, wordOf(sm.aro, 0.3, 0.6, ["few", "some", "many"]));
  gg.sym.set(sm.symp, wordOf(sm.symp, 0.3, 0.6, ["low", "raised", "high"])); gg.slp.set(sm.sleepy, wordOf(sm.sleepy, 0.3, 0.6, ["alert", "sleepy", "very sleepy"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
