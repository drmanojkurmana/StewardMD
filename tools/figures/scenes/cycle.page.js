/* Cardiac cycle scene: a real heart drawing with a cutaway window showing the left atrium,
 * mitral and aortic valves and the left ventricular cavity, plus the pressure-volume loop.
 * Vessels and blood tracks are anchored to the heart art ports at init. */
const layers = { slot: $("heartSlot"), cut: $("cut"), pv: $("pv"), flow: $("flow"), over: $("over"), panel: $("panel") };
let heartO = null;
const HF = { L: 0, T: 0, w: 1, h: 1 };
const HX = (f) => HF.L + f * HF.w, HY = (f) => HF.T + f * HF.h;
let ATR = { x: 0, y: 0 }, LVC = { x: 0, y: 0 }, MV = { x: 0, y: 0 }, AV = { x: 0, y: 0 }, AOP = { x: 0, y: 0 }, INP = { x: 0, y: 0 };
let atrEl = null, rimEl = null, cavEl = null, mvL = null, mvR = null, avL = null, avR = null;
let veinEl = null, aortaEl = null, aortaInEl = null, glowEl = null, aglowEl = null, bandG = null;
let pvPath = null, pvDot = null, svLine = null, svHL = null, svHR = null, capEl = null, capKey = "";
let s1G = null, s2G = null, s1Arc = null, s2Arc = null;
let inTrack = null, outTrack = null;
const phBoxes = [], phTexts = [];
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0, sp: 1, t: 0, x: 0, y: 0, vx: 0, vy: 0 }; }); }
const blood = pool(26, () => mk("circle", { class: "p-blood", r: 3.1 }, layers.flow));
const sparks = pool(16, () => mk("circle", { class: "sc-p p-spark", r: 2.6 }, layers.flow));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, k) { p.on = true; p.k = k; p.u = 0; p.sp = rnd(0.5, 0.72); p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function emitSpark(p, x, y, vx, vy) { p.on = true; p.t = 0; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.e.setAttribute("opacity", "1"); }
/* ---- heart drawing on the real art ---- */
function initHeart() {
  heartO = organ(layers.slot, "heart", 250, 225, 230, {});
  HF.L = heartO.x - heartO.w / 2; HF.T = heartO.y - heartO.h / 2; HF.w = heartO.w; HF.h = heartO.h;
  const P = heartO.ports;
  INP = P.in; AOP = P.aorta || P.out;
  ATR = { x: HX(0.33), y: HY(0.30) };
  LVC = { x: HX(0.47), y: HY(0.62) };
  MV = { x: HX(0.40), y: HY(0.44) };
  AV = { x: HX(0.54), y: HY(0.40) };
  const amid = { x: HX(0.47), y: HY(0.20) };
  const outEdge = { x: 448, y: 78 };
  veinEl = $("vein");
  veinEl.setAttribute("d", "M30 112L" + f1(120) + " " + f1(94) + "L" + f1(INP[0]) + " " + f1(INP[1]));
  aortaEl = $("aortaV"); aortaInEl = $("aortaIn");
  const aod = "M" + f1(AOP[0]) + " " + f1(AOP[1]) + "L" + f1(340) + " " + f1(60) + "L" + f1(outEdge.x) + " " + f1(outEdge.y);
  aortaEl.setAttribute("d", aod); aortaInEl.setAttribute("d", aod);
  const G = layers.cut;
  aglowEl = mk("ellipse", { class: "cy-aglow", cx: 340, cy: 61, rx: 44, ry: 24, opacity: "0" }, G);
  glowEl = mk("ellipse", { class: "cy-glow", cx: f1(LVC.x), cy: f1(LVC.y), rx: 74, ry: 84, opacity: "0" }, G);
  atrEl = mk("ellipse", { class: "cy-atr", cx: f1(ATR.x), cy: f1(ATR.y), rx: 30, ry: 24 }, G);
  rimEl = mk("ellipse", { class: "cy-rim", cx: f1(LVC.x), cy: f1(LVC.y), rx: 62, ry: 72 }, G);
  cavEl = mk("ellipse", { class: "cy-cav", cx: f1(LVC.x), cy: f1(LVC.y), rx: 40, ry: 52 }, G);
  mk("ellipse", { class: "cy-ring", cx: f1(MV.x), cy: f1(MV.y), rx: 15, ry: 5 }, G);
  mk("ellipse", { class: "cy-ring", cx: f1(AV.x), cy: f1(AV.y), rx: 13, ry: 5 }, G);
  mvL = mk("path", { class: "cy-leaf", d: "" }, G);
  mvR = mk("path", { class: "cy-leaf", d: "" }, G);
  avL = mk("path", { class: "cy-leaf", d: "" }, G);
  avR = mk("path", { class: "cy-leaf", d: "" }, G);
  bandG = mk("g", { class: "cy-band", opacity: "0" }, G);
  mk("path", { d: "M328 47L328 75" }, bandG);
  mk("path", { d: "M344 47L344 75" }, bandG);
  inTrack = track([[30, 112], [120, 94], INP, [ATR.x, ATR.y], [MV.x, MV.y], [LVC.x, LVC.y - 10]]);
  outTrack = track([[LVC.x, LVC.y - 20], [AV.x, AV.y], [amid.x, amid.y], AOP, [340, 60], [outEdge.x, outEdge.y]]);
  const Q = layers.pv;
  pvPath = mk("path", { class: "cy-pv", d: "" }, Q);
  svLine = mk("path", { class: "cy-sv", d: "" }, Q);
  svHL = mk("path", { class: "cy-svhead", d: "" }, Q);
  svHR = mk("path", { class: "cy-svhead", d: "" }, Q);
  pvDot = mk("circle", { class: "cy-pvdot", r: 6 }, Q);
  function badge(x, y, txt) { const g = mk("g", {}, layers.cut); mk("circle", { class: "cy-badge", cx: x, cy: y, r: 17 }, g); const t = mk("text", { class: "cy-badge-t", x: x, y: y + 5, "text-anchor": "middle" }, g); t.textContent = txt; const a = mk("path", { class: "cy-arc", d: "M" + (x - 24) + " " + (y - 12) + "a26 26 0 0 1 0 24M" + (x + 24) + " " + (y - 12) + "a26 26 0 0 0 0 24", opacity: "0" }, g); return { g, a }; }
  const b1 = badge(420, 250, "S1"), b2 = badge(420, 300, "S2"); s1G = b1.g; s2G = b2.g; s1Arc = b1.a; s2Arc = b2.a;
}
function capText(dk, ph) {
  const pre = dk === 1 ? "Extra filling. " : dk === 2 ? "Tight arteries. " : dk === 3 ? "Stronger squeeze. " : "No treatment. ";
  const bits = ["Atria top up the ventricle.", "Valves shut. Pressure climbs.", "Aortic valve open. Blood flows out.", "Valves shut. Pressure falls.", "Mitral valve open. Blood flows in."];
  return pre + bits[ph];
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The left ventricle";
  [["pre", "Preload", "g-pre", "How full the ventricle is at the end of filling. Extra filling stretches it further, shown by a wider vein and a loop shifted right."], ["aft", "Afterload", "g-bad", "The load the ventricle pushes against as it ejects, set mainly by the tightness of the arteries."], ["con", "Contractility", "g-sq", "How strongly the muscle squeezes for a given filling. An inotrope raises it, so the ventricle empties further."], ["sv", "Stroke volume", "g-good", "The blood sent out in one beat: the width of the loop, filling volume minus what is left behind."], ["peak", "Peak pressure", "g-bad", "The highest pressure the ventricle reaches in the beat: the top of the loop."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Left atrium", ATR.x - 24, ATR.y - 6, 85, 140, "Left atrium: the upper chamber. It gathers blood from the lungs and gives a final top up squeeze into the ventricle.");
  pill(o, "Mitral valve", MV.x, MV.y, 96, 258, "Mitral valve: the door between atrium and ventricle. Open for filling, shut for the squeeze. Its shutting makes the first heart sound.");
  pill(o, "Left ventricle", LVC.x - 38, LVC.y + 10, 88, 330, "Left ventricle: the main pump. Its squeeze sends blood to the body. Watch it shrink as it ejects.");
  pill(o, "Aortic valve", AV.x, AV.y, 400, 150, "Aortic valve: the door to the aorta. It opens when ventricular pressure passes aortic pressure. Its shutting makes the second heart sound.");
  pill(o, "Aorta", 360, 62, 412, 100, "Aorta: the great artery to the body. It carries each stroke volume out during ejection.");
  pill(o, "Heart sounds", 420, 275, 420, 352, "Heart sounds: the first sound as the mitral valve shuts, the second as the aortic valve shuts. The badges flash in those phases.");
  pill(o, "Ejection", 740, 228, 700, 95, "Ejection across the top of the loop: the aortic valve is open, volume falls and pressure first peaks, then falls.");
  pill(o, "Filling", 735, 315, 775, 398, "Filling along the bottom of the loop: the mitral valve is open and volume rises at low pressure.");
  const names = ["Atrial systole", "Iso contraction", "Ejection", "Iso relaxation", "Filling"];
  names.forEach((n, i) => { const x = 22 + i * 92; const r = mk("rect", { class: "cy-ph", x: x, y: 404, width: 88, height: 26, rx: 8 }, o); const tx = mk("text", { class: "cy-ph-t", x: x + 44, y: 420, "text-anchor": "middle" }, o); tx.textContent = n; phBoxes.push(r); phTexts.push(tx); });
  capEl = mk("text", { class: "cy-cap", x: 516, y: 424 }, o); capEl.textContent = capText(0, 2);
}
const gg = {};
const sm = { preload: 0.5, afterload: 0.5, contract: 0.52, SV: 0.28, peak: 0.52, EDV: 0.6, ESV: 0.32, mo: 0, ao: 0, pre: 0, aft: 0, ino: 0 };
const acc = { inn: 0, out: 0, sp: 0 };
function init() { initHeart(); initPanel(); }
function step(dt, m) {
  const k = 1 - Math.exp(-dt * 3), kv = 1 - Math.exp(-dt * 7);
  sm.preload = lerp(sm.preload, m.preload, k); sm.afterload = lerp(sm.afterload, m.afterload, k); sm.contract = lerp(sm.contract, m.contract, k);
  sm.SV = lerp(sm.SV, m.SV, k); sm.peak = lerp(sm.peak, m.peak, k); sm.EDV = lerp(sm.EDV, m.EDV, k); sm.ESV = lerp(sm.ESV, m.ESV, k);
  sm.mo = lerp(sm.mo, m.mitral, kv); sm.ao = lerp(sm.ao, m.aortic, kv);
  sm.pre = lerp(sm.pre, m.pre, k); sm.aft = lerp(sm.aft, m.after, k); sm.ino = lerp(sm.ino, m.ino, k);
  const s = (tm / 1700) % 1, ph = m.phase;
  /* current volume and pressure from the phase and progress inside it */
  let vol, press;
  if (ph === 0) { vol = lerp(sm.EDV - 0.09, sm.EDV, s); press = 0.15 + 0.05 * Math.sin(s * 3.14); }
  else if (ph === 1) { vol = sm.EDV; press = lerp(0.16, sm.peak * 0.8, s); }
  else if (ph === 2) { vol = lerp(sm.EDV, sm.ESV, s * s * (3 - 2 * s)); press = lerp(sm.peak * 0.8, sm.peak * 0.72, s) + Math.sin(s * 3.14) * sm.peak * 0.24; }
  else if (ph === 3) { vol = sm.ESV; press = lerp(sm.peak * 0.72, 0.14, s); }
  else { vol = lerp(sm.ESV, sm.EDV - 0.09, s); press = 0.13 + 0.02 * Math.sin(s * 3.14); }
  const vn = clamp((vol - 0.14) / 0.72), cav = 0.68 + 0.5 * vn;
  cavEl.setAttribute("transform", "translate(" + f1(LVC.x) + " " + f1(LVC.y) + ") scale(" + cav.toFixed(3) + " " + (0.72 + 0.42 * vn).toFixed(3) + ") translate(" + f1(-LVC.x) + " " + f1(-LVC.y) + ")");
  const wallS = 0.9 + 0.16 * vn;
  rimEl.setAttribute("transform", "translate(" + f1(LVC.x) + " " + f1(LVC.y) + ") scale(" + wallS.toFixed(3) + ") translate(" + f1(-LVC.x) + " " + f1(-LVC.y) + ")");
  rimEl.setAttribute("stroke-width", f1(1.4 + 1.4 * sm.ino));
  const squeeze = ph === 2 ? Math.sin(s * 3.14) : 0;
  glowEl.setAttribute("opacity", (sm.ino * (ph === 2 ? 0.14 + 0.16 * squeeze : 0.05)).toFixed(2));
  aglowEl.setAttribute("opacity", (sm.aft * 0.35).toFixed(2));
  bandG.setAttribute("opacity", sm.aft.toFixed(2));
  veinEl.setAttribute("stroke-width", f1(13 + 7 * sm.pre));
  const atS = (ph === 0 ? 1 - 0.13 * Math.sin(s * 3.14) : 1 + 0.03 * Math.sin(tm / 700)) * (1 + 0.12 * sm.pre);
  atrEl.setAttribute("transform", "translate(" + f1(ATR.x) + " " + f1(ATR.y) + ") scale(" + atS.toFixed(3) + ") translate(" + f1(-ATR.x) + " " + f1(-ATR.y) + ")");
  /* valves: leaflet tips swing between shut (across) and open (swung aside) */
  const mo = sm.mo, ao = sm.ao;
  mvL.setAttribute("d", "M" + f1(MV.x) + " " + f1(MV.y) + "L" + f1(lerp(MV.x - 13, MV.x - 9, mo)) + " " + f1(lerp(MV.y, MV.y + 20, mo)));
  mvR.setAttribute("d", "M" + f1(MV.x) + " " + f1(MV.y) + "L" + f1(lerp(MV.x + 13, MV.x + 9, mo)) + " " + f1(lerp(MV.y, MV.y + 20, mo)));
  avL.setAttribute("d", "M" + f1(AV.x) + " " + f1(AV.y) + "L" + f1(lerp(AV.x - 12, AV.x - 10, ao)) + " " + f1(lerp(AV.y, AV.y - 17, ao)));
  avR.setAttribute("d", "M" + f1(AV.x) + " " + f1(AV.y) + "L" + f1(lerp(AV.x + 12, AV.x + 10, ao)) + " " + f1(lerp(AV.y, AV.y - 17, ao)));
  /* blood flow: in while the mitral valve is open, out while the aortic valve is open */
  acc.inn += dt * sm.mo * 6.5 * (1 + 1.6 * sm.pre); while (acc.inn >= 1) { acc.inn--; const p = freeP(blood); if (p) emitP(p, 0); }
  acc.out += dt * sm.ao * 7 * (1 + 0.8 * sm.ino); while (acc.out >= 1) { acc.out--; const p = freeP(blood); if (p) emitP(p, 1); }
  blood.forEach((p) => { if (!p.on) return; p.u += dt * p.sp * (p.k ? 0.85 : 0.7); const tr = p.k ? outTrack : inTrack, pt = tr.at(clamp(p.u)); p.e.setAttribute("cx", f1(pt.x)); p.e.setAttribute("cy", f1(pt.y)); if (p.u >= 1) killP(p); });
  /* inotrope squeeze sparks fly off the wall during ejection */
  if (ph === 2 && sm.ino > 0.25) { acc.sp += dt * (2 + 10 * sm.ino); while (acc.sp >= 1) { acc.sp--; const p = freeP(sparks); if (p) { const a = rnd(0, 6.28); emitSpark(p, LVC.x + Math.cos(a) * 62, LVC.y + Math.sin(a) * 72, Math.cos(a) * rnd(50, 110), Math.sin(a) * rnd(50, 110)); } } }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("cx", f1(p.x)); p.e.setAttribute("cy", f1(p.y)); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) killP(p); });
  /* heart sounds light in the phase where their valve shuts */
  const s1on = ph === 1, s2on = ph === 3, pulse = 1 + 0.16 * Math.sin(Math.min(1, s) * 3.14);
  s1G.setAttribute("transform", s1on ? "translate(420 250) scale(" + pulse.toFixed(3) + ") translate(-420 -250)" : "");
  s2G.setAttribute("transform", s2on ? "translate(420 300) scale(" + pulse.toFixed(3) + ") translate(-420 -300)" : "");
  s1Arc.setAttribute("opacity", s1on ? (0.4 + 0.6 * Math.sin(s * 3.14)).toFixed(2) : "0");
  s2Arc.setAttribute("opacity", s2on ? (0.4 + 0.6 * Math.sin(s * 3.14)).toFixed(2) : "0");
  /* pressure-volume loop and the moving point */
  const EDVx = 580 + sm.EDV * 300, ESVx = 580 + sm.ESV * 300, lowY = 312, peakY = 340 - sm.peak * 230, openY = 340 - sm.peak * 0.8 * 230, endY = openY + 12;
  pvPath.setAttribute("d", "M" + f1(EDVx) + " " + lowY + "L" + f1(EDVx) + " " + f1(openY) + "C" + f1(EDVx - 6) + " " + f1(peakY) + " " + f1(ESVx + 34) + " " + f1(peakY) + " " + f1(ESVx) + " " + f1(endY) + "L" + f1(ESVx) + " " + lowY + "Q" + f1((EDVx + ESVx) / 2) + " 324 " + f1(EDVx) + " " + lowY + "Z");
  svLine.setAttribute("d", "M" + f1(ESVx) + " 332H" + f1(EDVx));
  svHL.setAttribute("d", "M" + f1(ESVx) + " 332l9 -4v8Z"); svHR.setAttribute("d", "M" + f1(EDVx) + " 332l-9 -4v8Z");
  let dx, dy;
  if (ph === 0) { dx = lerp(ESVx + (EDVx - ESVx) * 0.72, EDVx, s); dy = lowY - 5 * Math.sin(s * 3.14); }
  else if (ph === 1) { dx = EDVx; dy = lerp(lowY, openY, s); }
  else if (ph === 2) { dx = lerp(EDVx, ESVx, s); dy = lerp(openY, endY, s) - Math.sin(s * 3.14) * (openY - peakY); }
  else if (ph === 3) { dx = ESVx; dy = lerp(endY, lowY, s); }
  else { dx = lerp(ESVx, ESVx + (EDVx - ESVx) * 0.72, s); dy = lowY; }
  pvDot.setAttribute("cx", f1(dx)); pvDot.setAttribute("cy", f1(dy));
  /* phase strip */
  phBoxes.forEach((r, i) => r.setAttribute("class", i === ph ? "cy-ph cy-ph-on" : "cy-ph"));
  phTexts.forEach((tx, i) => tx.setAttribute("class", i === ph ? "cy-ph-t cy-ph-t-on" : "cy-ph-t"));
  /* gauges */
  gg.pre.set(sm.preload, wordOf(sm.preload, 0.4, 0.68, ["low", "normal", "high"]));
  gg.aft.set(sm.afterload, wordOf(sm.afterload, 0.4, 0.68, ["low", "normal", "high"]));
  gg.con.set(sm.contract, wordOf(sm.contract, 0.4, 0.68, ["weak", "normal", "strong"]));
  gg.sv.set(sm.SV, m.words[0]); gg.peak.set(sm.peak, m.words[1]);
  /* caption follows the treatment and the phase */
  const dk = m.ino ? 3 : m.after ? 2 : m.pre ? 1 : 0, q = dk + "|" + ph;
  if (q !== capKey) { capKey = q; const t = capText(dk, ph); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
