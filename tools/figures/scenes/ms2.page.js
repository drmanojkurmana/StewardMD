/* Mitral stenosis scene: fused leaflets, a pressure loaded left atrium with fibrillation and stasis, backward congestion into the lungs and pulmonary circuit, and a strained right ventricle. */
const layers = { circ: $("circ"), heart: $("heart"), lungs: $("lungs"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LA = { x: 260, y: 162 }, LV = { x: 260, y: 332 }, RV = { x: 690, y: 332 };
/* ---- vessels ---- */
const vein = mk("path", { class: "ms-vein", d: "M612 168 C520 150 420 148 336 154", "stroke-width": 7 }, layers.circ);
const artery = mk("path", { class: "ms-vess", d: "M690 286 C688 244 706 218 724 202", "stroke-width": 9 }, layers.circ);
const veinTrack = track([[612, 168], [500, 152], [336, 154]]);
const artTrack = track([[690, 286], [690, 244], [724, 202]]);
/* ---- left heart ---- */
const laWall = mk("ellipse", { class: "ms-wall", cx: LA.x, cy: LA.y }, layers.heart);
const laCh = mk("ellipse", { class: "ms-at", cx: LA.x, cy: LA.y }, layers.heart);
const lvWall = mk("ellipse", { class: "ms-wall", cx: LV.x, cy: LV.y }, layers.heart);
const lvCh = mk("ellipse", { class: "ms-ch", cx: LV.x, cy: LV.y }, layers.heart);
const afLine = mk("path", { class: "ms-af", d: "" }, layers.heart);
const clotG = mk("g", {}, layers.heart);
mk("circle", { class: "ms-clot", cx: 306, cy: 188, r: 11 }, clotG);
mk("circle", { class: "ms-clot", cx: 296, cy: 196, r: 7 }, clotG);
const clotX = mk("g", { opacity: "0" }, layers.heart);
mk("path", { class: "ms-mur", d: "M296 178 L316 198 M316 178 L296 198", stroke: "var(--c-bad)" }, clotX);
const leafL = mk("path", { class: "ms-leaf", d: "" }, layers.heart);
const leafR = mk("path", { class: "ms-leaf", d: "" }, layers.heart);
mk("path", { class: "ms-vess", d: "M202 242 L318 242", stroke: "var(--anatomy-mid)", "stroke-width": 2 }, layers.heart);
const mur = [0, 1, 2].map((i) => mk("path", { class: "ms-mur", d: "" }, layers.heart));
/* ---- lungs ---- */
const lungDims = [[648, 156], [742, 156]];
const lungFluids = [];
lungDims.forEach(([x, y], i) => {
  const clip = mk("clipPath", { id: "msLungClip" + i }, layers.lungs);
  mk("ellipse", { cx: x, cy: y, rx: 36, ry: 48 }, clip);
  mk("ellipse", { class: "ms-lung", cx: x, cy: y, rx: 36, ry: 48 }, layers.lungs);
  lungFluids.push(mk("rect", { class: "ms-fluid", x: x - 36, y: y + 48, width: 72, height: 0, "clip-path": "url(#msLungClip" + i + ")" }, layers.lungs));
});
/* ---- right ventricle ---- */
const rvWall = mk("ellipse", { class: "ms-rvwall", cx: RV.x, cy: RV.y }, layers.heart);
const rvCh = mk("ellipse", { class: "ms-rvch", cx: RV.x, cy: RV.y }, layers.heart);
const supportNote = mk("text", { class: "ms-mk", x: 462, y: 402, "text-anchor": "middle", opacity: "0" }, layers.over);
supportNote.textContent = "slower rate, less fluid";
/* ---- particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const jet = pool(22, () => mk("circle", { class: "p-ms", r: 2.6 }, layers.parts));
const swirl = pool(12, () => mk("circle", { class: "p-ms", r: 2.2 }, layers.parts));
const flowDots = pool(16, () => mk("circle", { class: "p-msb", r: 2.5 }, layers.parts));
const freeDot = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
swirl.forEach((p, i) => emit(p, LA.x, LA.y, 0, 0, i / swirl.length));
flowDots.forEach((p, i) => emit(p, 0, 0, 0, 0, i / flowDots.length));
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 290, 480, 670, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["open", "Valve opening", "g-good", "How wide the mitral valve opens in diastole. Rheumatic fusion of the leaflet edges makes it small."], ["lap", "LA pressure", "g-bad", "Pressure in the left atrium. It rises because the atrium must push blood through a narrow valve."], ["cong", "Lungs", "g-fl", "Fluid congestion in the lungs as pressure backs up through the pulmonary veins."], ["pht", "Pulm. pressure", "g-cyt", "Pressure in the pulmonary arteries, raised by the backward transmission of left atrial pressure."], ["rv", "Right heart", "g-clot", "Strain on the right ventricle, which must pump against raised pulmonary pressure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Left atrium", 218, 148, 140, 110, "Left atrium: the chamber behind the mitral valve. It dilates and its wall thickens as pressure rises.");
  pill(ox, "Fused leaflets", 228, 246, 130, 210, "The mitral leaflets are thickened and fused at their edges by rheumatic scarring, leaving a small opening.");
  pill(ox, "Left ventricle", 202, 336, 130, 380, "Left ventricle: it receives less filling through the tight valve, so it is underfilled rather than dilated.");
  pill(ox, "Atrial fibrillation", 306, 138, 430, 110, "Atrial fibrillation: the enlarged atrium often loses its organised rhythm. The heartbeat becomes irregular and the atrial contribution to filling is lost.");
  pill(ox, "Pulmonary veins", 470, 152, 460, 165, "Pulmonary veins carry blood from the lungs to the left atrium. Raised atrial pressure is transmitted backward through them.");
  pill(ox, "Clot risk", 302, 190, 410, 190, "Sluggish flow in a dilated, fibrillating atrium can form clot. Anticoagulation lowers that risk but does not open the valve.");
  pill(ox, "Diastolic murmur", 262, 268, 390, 285, "A low rumbling diastolic murmur is heard as blood crosses the narrowed mitral valve during filling.");
  pill(ox, "Congested lungs", 648, 132, 670, 95, "Congested lungs: raised pulmonary venous pressure pushes fluid into the lung tissue, causing breathlessness.");
  pill(ox, "Pulmonary hypertension", 712, 232, 790, 218, "Pulmonary hypertension: long standing backward pressure raises pulmonary artery pressure and resistance.");
  pill(ox, "Right ventricle", 738, 332, 820, 330, "Right ventricle: it hypertrophies and then dilates as it pumps against raised pulmonary pressure.");
}
/* ---- animation ---- */
const sm = { eff: 0.6, lap: 0.6, laSize: 0.6, af: 0.5, cong: 0.6, pht: 0.6, rv: 0.5, clot: 0.4, fill: 0.5, murmur: 0.6, support: 0, anticoag: 0, repair: 0 };
const acc = { jet: 0 };
let beatPhase = 0;
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["eff", "lap", "af", "cong", "pht", "clot", "fill", "murmur", "support", "anticoag", "repair"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.laSize = lerp(sm.laSize, m.laSize, k2); sm.rv = lerp(sm.rv, m.rv, k2);
  beatPhase += dt * (1.05 - 0.32 * sm.support + 0.18 * sm.af * Math.sin(tm / 700));
  const cyc = beatPhase % 1, openGate = cyc < 0.58 ? 1 : 0.25, pulse = Math.max(0, Math.sin(cyc * 6.2832)) * openGate;
  /* left atrium enlarges and pulses; the ventricle stays underfilled */
  const laRx = 55 * (1 + 0.42 * sm.laSize) * (1 + 0.025 * pulse), laRy = 42 * (1 + 0.32 * sm.laSize) * (1 + 0.02 * pulse);
  laCh.setAttribute("rx", f1(laRx)); laCh.setAttribute("ry", f1(laRy)); laWall.setAttribute("rx", f1(laRx + 7 + 3 * sm.lap)); laWall.setAttribute("ry", f1(laRy + 7 + 3 * sm.lap));
  const lvRx = 50 * (0.82 + 0.28 * sm.fill), lvRy = 64 * (0.86 + 0.2 * sm.fill);
  lvCh.setAttribute("rx", f1(lvRx * (1 - 0.05 * pulse))); lvCh.setAttribute("ry", f1(lvRy * (1 - 0.04 * pulse))); lvWall.setAttribute("rx", f1(lvRx + 11)); lvWall.setAttribute("ry", f1(lvRy + 11));
  /* fibrillation squiggle inside the atrium */
  let ad = "";
  for (let i = 0; i <= 12; i++) { const x = LA.x - 42 + i * 7, y = LA.y - 12 + Math.sin(tm / 130 + i * 1.7) * (2 + 5 * sm.af) + Math.sin(tm / 47 + i) * 2 * sm.af; ad += (i ? "L" : "M") + f1(x) + " " + f1(y); }
  afLine.setAttribute("d", ad); afLine.setAttribute("opacity", (0.15 + 0.8 * sm.af).toFixed(2));
  clotG.setAttribute("opacity", clamp(sm.clot * 1.4).toFixed(2)); clotG.setAttribute("transform", "scale(1)"); clotX.setAttribute("opacity", sm.anticoag.toFixed(2));
  /* fused leaflets and the diastolic opening */
  const gap = 38 - 30 * sm.eff, xm = 260 - gap / 2, xp = 260 + gap / 2;
  leafL.setAttribute("d", "M202 238 Q228 244 " + f1(xm) + " 260 Q228 254 202 252 Z");
  leafR.setAttribute("d", "M318 238 Q292 244 " + f1(xp) + " 260 Q292 254 318 252 Z");
  leafL.style.opacity = 1; leafR.style.opacity = 1;
  mur.forEach((p, i) => { const yy = 272 + i * 16 + Math.sin(tm / 240 + i) * 2, amp = 3 + 6 * sm.murmur; p.setAttribute("d", "M238 " + f1(yy) + " q8 " + f1(-amp) + " 16 0 q8 " + f1(amp) + " 16 0 q8 " + f1(-amp) + " 16 0"); p.setAttribute("opacity", (sm.murmur * openGate * (0.35 + 0.2 * Math.sin(tm / 300 + i))).toFixed(2)); });
  /* vessels widen under backward and forward pressure */
  vein.setAttribute("stroke-width", f1(6 + 5 * sm.lap)); artery.setAttribute("stroke-width", f1(8 + 6 * sm.pht));
  /* lungs fill from below with congestion */
  lungFluids.forEach((r) => { const hh = 62 * sm.cong; r.setAttribute("height", f1(hh)); r.setAttribute("y", f1(156 + 48 - hh)); });
  /* right ventricle wall thickens, then the chamber dilates */
  const rvRx = 52 * (1 + 0.3 * sm.rv), rvRy = 46 * (1 + 0.2 * sm.rv), wallT = 9 + 11 * sm.rv;
  rvWall.setAttribute("rx", f1(rvRx)); rvWall.setAttribute("ry", f1(rvRy)); rvCh.setAttribute("rx", f1(Math.max(18, rvRx - wallT))); rvCh.setAttribute("ry", f1(Math.max(16, rvRy - wallT)));
  supportNote.setAttribute("opacity", sm.support.toFixed(2));
  /* jet through the narrow opening during diastole */
  acc.jet += dt * (4 + 10 * sm.murmur) * openGate;
  while (acc.jet >= 1) { acc.jet--; const p = freeDot(jet); if (p) emit(p, rnd(238, 282), 206, 0, 0, 0); }
  jet.forEach((p) => { if (!p.on) return; p.t += dt; const narrowing = 1 - Math.abs(p.y - 252) / 60; p.x += (260 - p.x) * dt * (1 + 3 * clamp(narrowing)) + rnd(-3, 3) * dt; p.y += (58 + 90 * sm.murmur * clamp(narrowing)) * dt * openGate + 18 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.6 * openGate).toFixed(2)); if (p.y > 372 || p.t > 4) kill(p); });
  /* sluggish swirl in the enlarged atrium */
  swirl.forEach((p, i) => { const ang = p.k * 6.2832 + tm / (1600 + 900 * sm.af) * (i % 2 ? 1 : -0.7), rad = 16 + (i % 4) * 9; p.x = LA.x + Math.cos(ang) * rad * (1 + 0.3 * sm.laSize); p.y = LA.y + Math.sin(ang) * rad * 0.62; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (0.25 + 0.55 * sm.laSize).toFixed(2)); });
  /* circuit flow: right ventricle to lungs, then back to the left atrium */
  flowDots.forEach((p) => { p.k = (p.k + dt * 0.045 * (0.5 + sm.fill)) % 1; const q = p.k < 0.42 ? artTrack.at(p.k / 0.42) : veinTrack.at((p.k - 0.42) / 0.58); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.5 * sm.fill).toFixed(2)); });
  /* gauges */
  gg.open.set(1 - sm.eff, wordOf(1 - sm.eff, 0.35, 0.68, ["very small", "small", "wide"])); gg.lap.set(sm.lap, wordOf(sm.lap, 0.3, 0.6, ["near normal", "raised", "high"])); gg.cong.set(sm.cong, wordOf(sm.cong, 0.3, 0.6, ["clear", "congested", "wet"]));
  gg.pht.set(sm.pht, wordOf(sm.pht, 0.3, 0.6, ["near normal", "raised", "high"])); gg.rv.set(sm.rv, wordOf(sm.rv, 0.3, 0.6, ["coping", "strained", "failing"]));
}
run({ init, step });
