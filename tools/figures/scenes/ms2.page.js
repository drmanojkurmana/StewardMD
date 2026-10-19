/* Mitral stenosis scene: a real heart and lungs. A fused mitral valve dams blood in a
 * stretching left atrium, pressure backs up through the pulmonary veins into the lungs,
 * and the pulmonary artery and right ventricle strain. Rate control docks blockers on the
 * heart and a diuretic drains lung fluid, anticoagulation dissolves the atrial clot, and
 * valvotomy opens the valve so pressure falls and the lungs clear. */
const HX = 270, HY = 265, HW = 150, LX = 640, LY = 230, LW = 170;
const layers = { heartSlot: $("heartSlot"), lungSlot: $("lungSlot"), circ: $("circ"), heart: $("heart"), cong: $("cong"), parts: $("parts"), over: $("over"), panel: $("panel") };
let heartO = null, lungO = null;
let CX = HX - 5, CY = HY + 5, LAx = 230, LAy = 130, RVx = 315, RVy = 311, FLx = 640, FLy = 312, FLbase = 334;
let trBack = null, trPA = null, trIn = null, trFwd = null;
let veinEl, artEl, laGlow, laEl, laVes, afLine, clotG, shieldEl, leafL, leafR, splitL, splitR, lvGlow, rvCav, rvRing, hazeEl, fluidEl, capEl = null;
const recPos = [], recEls = [];
const gg = {};
function capText(d, l) {
  const sev = ["Mild stenosis. ", "Moderate stenosis. ", "Severe stenosis. "][l];
  if (d === 1) return sev + "Rate control slows the heart and a diuretic drains fluid from the lungs.";
  if (d === 2) return sev + "Anticoagulation dissolves the clot. The valve stays tight.";
  if (d === 3) return sev + "Valvotomy opens the valve. Pressure falls and the lungs clear.";
  return sev + "No treatment. Blood dams behind the valve and the lungs fill.";
}
function initOrgans() {
  heartO = organ(layers.heartSlot, "heart", HX, HY, HW, {});
  lungO = organ(layers.lungSlot, "lung", LX, LY, LW, {});
  const HP = heartO.ports, LP = lungO.ports;
  const hTop = heartO.y - heartO.h / 2;
  LAx = HX - 40; LAy = Math.round(hTop - 30);
  CX = HX - 5; CY = Math.round(HY + 5);
  RVx = Math.round(HX + 0.3 * HW); RVy = Math.round(HY + 0.22 * heartO.h);
  FLx = Math.round((LP.base[0] + LP.baseR[0]) / 2); FLy = Math.round((LP.base[1] + LP.baseR[1]) / 2); FLbase = FLy + 22;
  /* pulmonary veins: lung hilum back to the left atrium; dots run atrium to lung */
  const HL = LP.hilumL;
  const pv = [[HL[0], HL[1]], [Math.round((HL[0] + LAx) / 2) + 30, Math.round(HL[1]) - 30], [Math.round((HL[0] + LAx) / 2) - 40, LAy + 30], [LAx + 32, LAy + 4]];
  veinEl = mk("path", { class: "ms-vein", d: "M" + f1(pv[0][0]) + " " + f1(pv[0][1]) + " C" + f1(pv[1][0]) + " " + f1(pv[1][1]) + " " + f1(pv[2][0]) + " " + f1(pv[2][1]) + " " + f1(pv[3][0]) + " " + f1(pv[3][1]), fill: "none" }, layers.circ);
  trBack = track([pv[3], pv[2], pv[1], pv[0]]);
  /* pulmonary artery: heart right edge forward to the lung hilum */
  const HR = LP.hilumR;
  const pa = [[Math.round(HX + HW / 2 - 7), HY + 7], [450, HY + 10], [560, HR[1] + 14], [HR[0], HR[1]]];
  artEl = mk("path", { class: "ms-art", d: "M" + f1(pa[0][0]) + " " + f1(pa[0][1]) + " C" + f1(pa[1][0]) + " " + f1(pa[1][1]) + " " + f1(pa[2][0]) + " " + f1(pa[2][1]) + " " + f1(pa[3][0]) + " " + f1(pa[3][1]), fill: "none" }, layers.circ);
  trPA = track(pa);
  /* inflow through the valve and brisk outflow up the aorta */
  trIn = track([[LAx + 6, LAy + 18], [CX - 8, CY - 36], [CX, CY + 2], [CX, CY + 56]]);
  const AP = HP.aorta;
  trFwd = track([[CX, CY + 48], [CX + 8, CY - 30], [AP[0], AP[1]], [AP[0] + 78, AP[1] - 58]]);
  /* atrium balloon with its pressure glow, connector, rhythm trace, clot and shield */
  laGlow = mk("ellipse", { class: "ms-laglow", cx: LAx, cy: LAy, rx: 60, ry: 46 }, layers.heart);
  laEl = mk("ellipse", { class: "ms-la", cx: LAx, cy: LAy, rx: 34, ry: 24 }, layers.heart);
  laVes = mk("path", { class: "ms-laves", d: "M" + LAx + " " + (LAy + 16) + " L" + (HX - 16) + " " + f1(hTop + 10), fill: "none" }, layers.heart);
  afLine = mk("path", { class: "ms-af", d: "", fill: "none" }, layers.heart);
  clotG = mk("g", {}, layers.heart);
  mk("circle", { class: "ms-clot", cx: 0, cy: 0, r: 10 }, clotG);
  mk("circle", { class: "ms-clot", cx: -9, cy: 7, r: 6.5 }, clotG);
  shieldEl = mk("circle", { class: "ms-shield", cx: LAx + 14, cy: LAy + 8, r: 19, opacity: "0" }, layers.heart);
  /* fused leaflets and the split marks valvotomy leaves */
  leafL = mk("path", { class: "ms-leaf", d: "" }, layers.heart);
  leafR = mk("path", { class: "ms-leaf", d: "" }, layers.heart);
  splitL = mk("path", { class: "ms-split", d: "M" + (CX - 36) + " " + (CY - 8) + " L" + (CX - 24) + " " + (CY + 8), fill: "none", opacity: "0" }, layers.heart);
  splitR = mk("path", { class: "ms-split", d: "M" + (CX + 36) + " " + (CY - 8) + " L" + (CX + 24) + " " + (CY + 8), fill: "none", opacity: "0" }, layers.heart);
  /* underfilled left ventricle glow, straining right ventricle chamber and ring */
  lvGlow = mk("ellipse", { class: "ms-lvglow", cx: CX - 20, cy: CY + 55, rx: 20, ry: 24 }, layers.heart);
  rvCav = mk("ellipse", { class: "ms-rvcav", cx: RVx, cy: RVy, rx: 16, ry: 18 }, layers.heart);
  rvRing = mk("ellipse", { class: "ms-rvring", cx: RVx, cy: RVy, rx: 24, ry: 27, fill: "none" }, layers.heart);
  /* lung haze and gathered fluid */
  hazeEl = mk("ellipse", { class: "ms-haze", cx: LX, cy: LY, rx: Math.round(lungO.w / 2), ry: Math.round(lungO.h / 2), opacity: "0.2" }, layers.cong);
  fluidEl = mk("ellipse", { class: "ms-fluid", cx: FLx, cy: FLbase - 20, rx: 70, ry: 20 }, layers.cong);
  /* blocker docking points on the heart rim */
  [-40, 0, 40].forEach((dy) => { const qx = Math.round(HX - HW / 2 + 4), qy = HY + dy; recPos.push([qx, qy]);
    recEls.push(mk("path", { class: "ms-rec", d: "M" + (qx - 2) + " " + (qy - 7) + " L" + (qx + 2) + " " + (qy + 7), fill: "none" }, layers.circ)); });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, ri: 0 }; }); }
const jet = pool(20, () => mk("circle", { class: "sc-p p-ms", r: 2.6 }, layers.parts));
const swirl = pool(10, () => mk("circle", { class: "sc-p p-ms", r: 2.2 }, layers.parts));
const back = pool(12, () => mk("circle", { class: "sc-p p-msb", r: 2.4 }, layers.parts));
const fwd = pool(10, () => mk("circle", { class: "sc-p p-ms", r: 2.6 }, layers.parts));
const pa = pool(10, () => mk("circle", { class: "sc-p p-ms", r: 2.4 }, layers.parts));
const drop = pool(12, () => mk("circle", { class: "sc-p p-msfl", r: 2.6 }, layers.parts));
const drain = pool(10, () => mk("circle", { class: "sc-p p-msfl", r: 2.4 }, layers.parts));
const blk = pool(6, () => mk("circle", { class: "sc-p p-msblk", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges, caption ---- */
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 290, 480, 670, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["open", "Valve opening", "g-good", "How wide the mitral valve opens in diastole. Rheumatic fusion of the leaflet edges makes it small."], ["lap", "LA pressure", "g-bad", "Pressure in the left atrium. It rises because the atrium must push blood through a narrow valve."], ["cong", "Lungs", "g-fl", "Fluid congestion in the lungs as pressure backs up through the pulmonary veins."], ["pht", "Pulm. pressure", "g-cyt", "Pressure in the pulmonary arteries, raised by the backward transmission of left atrial pressure."], ["rv", "Right heart", "g-clot", "Strain on the right ventricle, which must pump against raised pulmonary pressure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over, qv = trBack.at(0.5), qa = trPA.at(0.5);
  pill(ox, "Left atrium", LAx - 12, LAy - 4, 110, 64, "The chamber behind the mitral valve. Forced to push through a small opening, it stretches and its pressure rises.");
  pill(ox, "Tight valve", CX - 45, CY - 12, 110, 340, "The leaflet edges are fused by scarring, so only a small gap stays open. Blood crossing it makes a low murmur.");
  pill(ox, "Left ventricle", CX - 25, CY + 55, 130, 400, "It fills through the tight valve, so it holds less blood and pumps less out with each beat.");
  pill(ox, "Clot risk", LAx + 14, LAy + 8, 340, 66, "The stretched atrium often loses its rhythm. Slow swirling flow there can form a clot that may travel.");
  pill(ox, "Pulmonary veins", qv.x, qv.y, 505, 80, "Raised atrial pressure travels backward through these veins toward the lungs.");
  pill(ox, "Congested lungs", FLx, FLbase - 12, 800, 400, "Back pressure pushes fluid into lung tissue, which causes breathlessness. A diuretic drains it away.");
  pill(ox, "Pulmonary artery", qa.x, qa.y, 560, 340, "Long standing back pressure raises pressure here too, so this vessel widens.");
  pill(ox, "Right ventricle", RVx, RVy, 430, 400, "It must pump against the raised lung pressure, so its wall thickens and then it dilates.");
  capEl = mk("text", { class: "ms-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, level);
}
/* ---- animation ---- */
const sm = { eff: 0.65, lap: 0.6, laSize: 0.6, af: 0.55, cong: 0.6, pht: 0.6, rv: 0.55, clot: 0.5, fill: 0.5, support: 0, anticoag: 0, repair: 0 };
const acc = { jet: 0, back: 0, fwd: 0, pa: 0, drop: 0, drain: 0, blk: 0 };
let beat = 0, capKey = "";
function init() { initOrgans(); initPanel(); swirl.forEach((p, i) => { p.on = true; p.k = i / swirl.length; p.e.setAttribute("opacity", "0.4"); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["eff", "lap", "af", "cong", "pht", "clot", "fill", "support", "anticoag", "repair"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.laSize = lerp(sm.laSize, m.laSize, k2); sm.rv = lerp(sm.rv, m.rv, k2);
  /* the beat: rate control slows it visibly */
  beat += dt * (1.06 - 0.38 * sm.support);
  const pulse = Math.max(0, Math.sin((beat % 1) * 6.2832));
  place(heartO.g, HX, HY - 1.5 * pulse, 0, 1 + 0.014 * pulse);
  /* atrium balloon, pressure glow and fibrillation trace */
  const laRx = 22 + 22 * sm.laSize, laRy = 16 + 15 * sm.laSize;
  laEl.setAttribute("rx", f1(laRx)); laEl.setAttribute("ry", f1(laRy));
  laGlow.setAttribute("rx", f1(laRx + 20)); laGlow.setAttribute("ry", f1(laRy + 18));
  laGlow.setAttribute("opacity", (0.08 + 0.42 * sm.lap).toFixed(2));
  let ad = "";
  for (let i = 0; i <= 10; i++) { const x = LAx - laRx + 6 + i * (2 * laRx - 12) / 10, y = LAy - 8 + Math.sin(tm / 130 + i * 1.7) * (2 + 5 * sm.af); ad += (i ? "L" : "M") + f1(x) + " " + f1(y); }
  afLine.setAttribute("d", ad); afLine.setAttribute("opacity", (0.15 + 0.8 * sm.af).toFixed(2));
  /* the clot dissolves on anticoagulation while the shield ring marks protection */
  const cs = 0.2 + 0.8 * clamp(sm.clot * 1.6);
  clotG.setAttribute("transform", "translate(" + (LAx + 14) + " " + (LAy + 8) + ") scale(" + cs.toFixed(3) + ")");
  clotG.setAttribute("opacity", clamp(0.1 + sm.clot * 1.5).toFixed(2));
  shieldEl.setAttribute("opacity", (sm.anticoag * 0.9).toFixed(2));
  /* fused leaflets: a slit when tight, a wide mouth after valvotomy */
  const gap = 36 - 28 * sm.eff, xm = CX - gap / 2, xp = CX + gap / 2;
  leafL.setAttribute("d", "M" + (CX - 62) + " " + (CY - 14) + " Q" + (CX - 32) + " " + (CY - 8) + " " + f1(xm) + " " + (CY + 2) + " Q" + (CX - 32) + " " + (CY + 8) + " " + (CX - 62) + " " + (CY + 12) + " Z");
  leafR.setAttribute("d", "M" + (CX + 62) + " " + (CY - 14) + " Q" + (CX + 32) + " " + (CY - 8) + " " + f1(xp) + " " + (CY + 2) + " Q" + (CX + 32) + " " + (CY + 8) + " " + (CX + 62) + " " + (CY + 12) + " Z");
  splitL.setAttribute("opacity", sm.repair.toFixed(2)); splitR.setAttribute("opacity", sm.repair.toFixed(2));
  /* vessels carry the backward and forward pressures */
  veinEl.setAttribute("stroke-width", f1(5 + 6 * sm.lap)); veinEl.setAttribute("opacity", (0.35 + 0.5 * sm.lap).toFixed(2));
  artEl.setAttribute("stroke-width", f1(6 + 8 * sm.pht)); artEl.setAttribute("opacity", (0.4 + 0.5 * sm.pht).toFixed(2));
  /* lungs: haze lifts and pooled fluid drains */
  hazeEl.setAttribute("opacity", (0.05 + 0.3 * sm.cong).toFixed(2));
  const flRy = 6 + 40 * sm.cong;
  fluidEl.setAttribute("ry", f1(flRy)); fluidEl.setAttribute("cy", f1(FLbase - flRy));
  fluidEl.setAttribute("opacity", (0.4 + 0.4 * sm.cong).toFixed(2));
  /* ventricles: poor left filling, straining right wall */
  const lvR = 13 + 15 * sm.fill;
  lvGlow.setAttribute("rx", f1(lvR)); lvGlow.setAttribute("ry", f1(lvR * 1.25 * (1 + 0.05 * pulse)));
  lvGlow.setAttribute("opacity", (0.25 + 0.5 * sm.fill).toFixed(2));
  rvCav.setAttribute("rx", f1(14 + 10 * sm.rv)); rvCav.setAttribute("ry", f1(16 + 10 * sm.rv));
  rvRing.setAttribute("rx", f1(24 + 7 * sm.rv)); rvRing.setAttribute("ry", f1(27 + 7 * sm.rv));
  rvRing.setAttribute("stroke-width", f1(2.5 + 9 * sm.rv));
  rvRing.setAttribute("opacity", (0.35 + 0.55 * sm.rv).toFixed(2));
  /* blocker dots dock on the heart rim while rate control is on */
  recEls.forEach((r) => r.setAttribute("opacity", (0.25 + 0.75 * Math.max(sm.support, 0.25)).toFixed(2)));
  acc.blk += dt * 5 * sm.support;
  while (acc.blk >= 1) { acc.blk--; const p = free(blk); if (p) { p.ri = blk.indexOf(p) % recPos.length; p.t = 0; p.on = true; p.x = 60; p.y = HY + (p.ri - 1) * 40 + rnd(-6, 6); p.e.setAttribute("opacity", "1"); } }
  blk.forEach((p) => { if (!p.on) return;
    if (sm.support < 0.4) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    const r = recPos[p.ri || 0];
    p.x += (r[0] - p.x) * Math.min(1, dt * 3); p.y += (r[1] - p.y) * Math.min(1, dt * 3);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", "1"); });
  /* trickle through the tight valve, brisk after opening */
  acc.jet += dt * (2.5 + 9 * (1 - sm.eff));
  while (acc.jet >= 1) { acc.jet--; const p = free(jet); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  jet.forEach((p) => { if (!p.on) return; p.u += dt * (0.25 + 0.75 * (1 - sm.eff)); if (p.u >= 1) { kill(p); return; }
    const q = trIn.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x + rnd(-2, 2)) + " " + f1(q.y) + ")"); });
  /* sluggish swirl inside the stretching atrium */
  swirl.forEach((p, i) => { const ang = p.k * 6.2832 + tm / (1700 - 700 * sm.af) * (i % 2 ? 1 : -0.7), rad = 8 + (i % 4) * 5;
    p.e.setAttribute("transform", "translate(" + f1(LAx + Math.cos(ang) * rad) + " " + f1(LAy + Math.sin(ang) * rad * 0.6) + ")");
    p.e.setAttribute("opacity", (0.2 + 0.5 * sm.laSize).toFixed(2)); });
  /* back pressure signals toward the lungs */
  acc.back += dt * (2 + 10 * sm.lap);
  while (acc.back >= 1) { acc.back--; const p = free(back); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  back.forEach((p) => { if (!p.on) return; p.u += dt * 0.4; if (p.u >= 1) { kill(p); return; }
    const q = trBack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* forward output up the aorta, poor when filling is poor */
  acc.fwd += dt * (1.5 + 8 * sm.fill);
  while (acc.fwd >= 1) { acc.fwd--; const p = free(fwd); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  fwd.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; if (p.u >= 1) { kill(p); return; }
    const q = trFwd.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* artery flow from the heart to the lungs */
  acc.pa += dt * (2 + 7 * sm.fill);
  while (acc.pa >= 1) { acc.pa--; const p = free(pa); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  pa.forEach((p) => { if (!p.on) return; p.u += dt * 0.45; if (p.u >= 1) { kill(p); return; }
    const q = trPA.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* droplets gather in the lungs and a diuretic flush drains them away */
  acc.drop += dt * (1 + 9 * sm.cong);
  while (acc.drop >= 1) { acc.drop--; const p = free(drop); if (p) emit(p, rnd(FLx - 50, FLx + 50), rnd(FLy - 60, FLy - 10), 0, rnd(24, 40), 0); }
  drop.forEach((p) => { if (!p.on) return; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y > FLbase - 4) kill(p); });
  acc.drain += dt * 10 * sm.support;
  while (acc.drain >= 1) { acc.drain--; const p = free(drain); if (p) emit(p, rnd(FLx - 45, FLx + 45), FLbase, 0, rnd(50, 80), 0); }
  drain.forEach((p) => { if (!p.on) return; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.y - FLbase) / 60).toFixed(2));
    if (p.y > FLbase + 62) kill(p); });
  /* gauges and the plain language caption */
  gg.open.set(1 - sm.eff, wordOf(1 - sm.eff, 0.35, 0.68, ["very small", "small", "wide"])); gg.lap.set(sm.lap, wordOf(sm.lap, 0.3, 0.6, ["near normal", "raised", "high"])); gg.cong.set(sm.cong, wordOf(sm.cong, 0.3, 0.6, ["clear", "congested", "wet"]));
  gg.pht.set(sm.pht, wordOf(sm.pht, 0.3, 0.6, ["near normal", "raised", "high"])); gg.rv.set(sm.rv, wordOf(sm.rv, 0.3, 0.6, ["coping", "strained", "failing"]));
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
