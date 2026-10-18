/* Cardiac cycle scene: left atrium and ventricle, mitral and aortic valves, heart sounds, blood flow and the pressure-volume loop. */
const WW = SC.W;
const layers = { pv: $("pv"), heart: $("heart"), flow: $("flow"), over: $("over"), panel: $("panel") };
const MV = { x: 202, y: 198 }, AV = { x: 258, y: 214 }, LVC = { x: 210, y: 302 };
let atriumEl = null, lvWallEl = null, lvCavEl = null, mvL = null, mvR = null, avL = null, avR = null, pvPath = null, pvDot = null, svLine = null, svHL = null, svHR = null;
let s1G = null, s2G = null, s1Arc = null, s2Arc = null;
const phBoxes = [], phTexts = [];
const inTrack = track([[55, 122], [130, 126], [178, 148], [200, 192], [212, 252]]);
const outTrack = track([[252, 220], [282, 178], [318, 140], [370, 130], [442, 132]]);
/* ---- blood particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0, sp: 1 }; }); }
const blood = pool(26, () => mk("circle", { class: "p-blood", r: 3.1 }, layers.flow));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, k) { p.on = true; p.k = k; p.u = 0; p.sp = rnd(0.5, 0.72); p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- heart and loop drawing ---- */
function initHeart() {
  const G = layers.heart;
  mk("path", { class: "cy-vein", d: "M42 122H136" }, G);
  mk("path", { class: "cy-aorta", d: "M258 214C298 172 318 138 356 129L448 129" }, G);
  mk("path", { class: "cy-aorta-in", d: "M258 214C298 172 318 138 356 129L448 129" }, G);
  atriumEl = mk("ellipse", { class: "cy-atrium", cx: 195, cy: 132, rx: 60, ry: 44 }, G);
  lvWallEl = mk("ellipse", { class: "cy-wall", cx: LVC.x, cy: LVC.y, rx: 74, ry: 82 }, G);
  lvCavEl = mk("ellipse", { class: "cy-cavity", cx: LVC.x, cy: 306, rx: 46, ry: 58 }, G);
  mvL = mk("path", { class: "cy-leaf", d: "M202 198L188 198" }, G);
  mvR = mk("path", { class: "cy-leaf", d: "M202 198L216 198" }, G);
  avL = mk("path", { class: "cy-leaf", d: "M258 214L246 206" }, G);
  avR = mk("path", { class: "cy-leaf", d: "M258 214L270 222" }, G);
  const P = layers.pv;
  pvPath = mk("path", { class: "cy-pv", d: "" }, P);
  svLine = mk("path", { class: "cy-sv", d: "" }, P);
  svHL = mk("path", { class: "cy-svhead", d: "" }, P);
  svHR = mk("path", { class: "cy-svhead", d: "" }, P);
  pvDot = mk("circle", { class: "cy-pvdot", r: 6 }, P);
  function badge(x, txt) { const g = mk("g", {}, layers.heart); mk("circle", { class: "cy-badge", cx: x, cy: 322, r: 17 }, g); const t = mk("text", { class: "cy-badge-t", x: x, y: 327, "text-anchor": "middle" }, g); t.textContent = txt; const a = mk("path", { class: "cy-arc", d: "M" + (x - 24) + " 310a26 26 0 0 1 0 24M" + (x + 24) + " 310a26 26 0 0 0 0 24", opacity: "0" }, g); return { g, a }; }
  const b1 = badge(358, "S1"), b2 = badge(408, "S2"); s1G = b1.g; s2G = b2.g; s1Arc = b1.a; s2Arc = b2.a;
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The left ventricle";
  [["pre", "Preload", "g-pre", "How full the ventricle is at the end of filling. Raised by more filling; shown by how far right the loop reaches."], ["aft", "Afterload", "g-bad", "The load the ventricle pushes against as it ejects, set mainly by the tightness of the arteries."], ["con", "Contractility", "g-sq", "How strongly the muscle squeezes for a given filling. An inotrope raises it, so the ventricle empties further."], ["sv", "Stroke volume", "g-good", "The blood sent out in one beat: the width of the loop, filling volume minus what is left behind."], ["peak", "Peak pressure", "g-bad", "The highest pressure the ventricle reaches in the beat: the top of the loop."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Left atrium", 150, 118, 78, 92, "Left atrium: the upper chamber. It collects blood from the lungs and, in atrial systole, gives a final top-up squeeze into the ventricle.");
  pill(o, "Mitral valve", MV.x, MV.y, 78, 225, "Mitral valve: between the left atrium and ventricle. It opens for filling and shuts as ventricular contraction begins, which gives the first heart sound.");
  pill(o, "Left ventricle", 172, 318, 78, 330, "Left ventricle: the main pumping chamber drawn here. Its squeeze sends blood into the aorta; its relaxation lets it fill again.");
  pill(o, "Aortic valve", AV.x, AV.y, 386, 180, "Aortic valve: between the left ventricle and the aorta. It opens when ventricular pressure passes aortic pressure, and shuts as the ventricle relaxes, which gives the second heart sound.");
  pill(o, "Aorta", 390, 129, 398, 84, "Aorta: the great artery leaving the heart. During ejection it receives the stroke volume and carries it to the body.");
  pill(o, "Heart sounds", 332, 300, 386, 282, "Heart sounds: S1 as the mitral valve shuts at the start of contraction, and S2 as the aortic valve shuts at the start of relaxation. The badges light up in those phases.");
  pill(o, "Blood ejected", 735, 228, 730, 88, "Ejection across the top of the loop: the aortic valve is open, volume falls and pressure first rises, then falls as ejection slows.");
  pill(o, "Pressure falls", 683, 278, 538, 252, "Isovolumetric relaxation down the left side: both valves are shut, so volume stays fixed while pressure falls after the aortic valve closes.");
  pill(o, "Volume fixed", 758, 278, 872, 240, "Isovolumetric contraction up the right side: both valves are shut, so volume stays fixed while pressure climbs after the mitral valve closes.");
  pill(o, "Filling flow", 720, 312, 735, 400, "Filling along the bottom of the loop: the mitral valve is open, volume rises at low pressure, and atrial systole gives the last top-up.");
  const names = ["Atrial systole", "Iso contraction", "Ejection", "Iso relaxation", "Filling"];
  names.forEach((n, i) => { const x = 30 + i * 89; const r = mk("rect", { class: "cy-ph", x: x, y: 404, width: 84, height: 26, rx: 8 }, o); const tx = mk("text", { class: "cy-ph-t", x: x + 42, y: 420, "text-anchor": "middle" }, o); tx.textContent = n; phBoxes.push(r); phTexts.push(tx); });
}
const gg = {};
const sm = { preload: 0.5, afterload: 0.5, contract: 0.52, SV: 0.28, peak: 0.52, EDV: 0.6, ESV: 0.32, mo: 0, ao: 0 };
const acc = { inn: 0, out: 0 };
function init() { initHeart(); initPanel(); }
function step(dt, m) {
  const k = 1 - Math.exp(-dt * 3), kv = 1 - Math.exp(-dt * 7);
  sm.preload = lerp(sm.preload, m.preload, k); sm.afterload = lerp(sm.afterload, m.afterload, k); sm.contract = lerp(sm.contract, m.contract, k);
  sm.SV = lerp(sm.SV, m.SV, k); sm.peak = lerp(sm.peak, m.peak, k); sm.EDV = lerp(sm.EDV, m.EDV, k); sm.ESV = lerp(sm.ESV, m.ESV, k);
  sm.mo = lerp(sm.mo, m.mitral, kv); sm.ao = lerp(sm.ao, m.aortic, kv);
  const s = (tm / 1700) % 1, ph = m.phase;
  /* current volume and pressure from the phase and progress inside it */
  let vol, press;
  if (ph === 0) { vol = lerp(sm.EDV - 0.09, sm.EDV, s); press = 0.15 + 0.05 * Math.sin(s * 3.14); }
  else if (ph === 1) { vol = sm.EDV; press = lerp(0.16, sm.peak * 0.8, s); }
  else if (ph === 2) { vol = lerp(sm.EDV, sm.ESV, s * s * (3 - 2 * s)); press = lerp(sm.peak * 0.8, sm.peak * 0.72, s) + Math.sin(s * 3.14) * sm.peak * 0.24; }
  else if (ph === 3) { vol = sm.ESV; press = lerp(sm.peak * 0.72, 0.14, s); }
  else { vol = lerp(sm.ESV, sm.EDV - 0.09, s); press = 0.13 + 0.02 * Math.sin(s * 3.14); }
  const vn = clamp((vol - 0.14) / 0.72), cav = 0.68 + 0.5 * vn;
  lvCavEl.setAttribute("transform", "translate(" + f1(LVC.x) + " 306) scale(" + cav.toFixed(3) + " " + (0.72 + 0.42 * vn).toFixed(3) + ") translate(" + f1(-LVC.x) + " -306)");
  const wallS = 0.9 + 0.16 * vn;
  lvWallEl.setAttribute("transform", "translate(" + f1(LVC.x) + " " + LVC.y + ") scale(" + wallS.toFixed(3) + ") translate(" + f1(-LVC.x) + " " + (-LVC.y) + ")");
  const atS = ph === 0 ? 1 - 0.13 * Math.sin(s * 3.14) : 1 + 0.03 * Math.sin(tm / 700);
  atriumEl.setAttribute("transform", "translate(195 132) scale(" + atS.toFixed(3) + ") translate(-195 -132)");
  /* valves: leaflet tips swing between shut (across) and open (swung down or aside) */
  const mo = sm.mo, ao = sm.ao;
  mvL.setAttribute("d", "M202 198L" + f1(lerp(187, 184, mo)) + " " + f1(lerp(198, 218, mo)));
  mvR.setAttribute("d", "M202 198L" + f1(lerp(217, 220, mo)) + " " + f1(lerp(198, 218, mo)));
  avL.setAttribute("d", "M258 214L" + f1(lerp(246, 248, ao)) + " " + f1(lerp(206, 198, ao)));
  avR.setAttribute("d", "M258 214L" + f1(lerp(270, 272, ao)) + " " + f1(lerp(222, 230, ao)));
  /* blood flow: in while the mitral valve is open, out while the aortic valve is open */
  acc.inn += dt * sm.mo * 6.5; while (acc.inn >= 1) { acc.inn--; const p = freeP(blood); if (p) emitP(p, 0); }
  acc.out += dt * sm.ao * 7; while (acc.out >= 1) { acc.out--; const p = freeP(blood); if (p) emitP(p, 1); }
  blood.forEach((p) => { if (!p.on) return; p.u += dt * p.sp * (p.k ? 0.85 : 0.7); const tr = p.k ? outTrack : inTrack, pt = tr.at(clamp(p.u)); p.e.setAttribute("cx", f1(pt.x)); p.e.setAttribute("cy", f1(pt.y)); if (p.u >= 1) killP(p); });
  /* heart sounds light in the phase where their valve shuts */
  const s1on = ph === 1, s2on = ph === 3, pulse = 1 + 0.16 * Math.sin(Math.min(1, s) * 3.14);
  s1G.setAttribute("transform", s1on ? "translate(358 322) scale(" + pulse.toFixed(3) + ") translate(-358 -322)" : "");
  s2G.setAttribute("transform", s2on ? "translate(408 322) scale(" + pulse.toFixed(3) + ") translate(-408 -322)" : "");
  s1Arc.setAttribute("opacity", s1on ? (0.4 + 0.6 * Math.sin(s * 3.14)).toFixed(2) : "0");
  s2Arc.setAttribute("opacity", s2on ? (0.4 + 0.6 * Math.sin(s * 3.14)).toFixed(2) : "0");
  /* pressure-volume loop and the moving point */
  const EDVx = 600 + sm.EDV * 260, ESVx = 600 + sm.ESV * 260, lowY = 312, peakY = 340 - sm.peak * 230, openY = 340 - sm.peak * 0.8 * 230, endY = openY + 12;
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
}
run({ init, step });
