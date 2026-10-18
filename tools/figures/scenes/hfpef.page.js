/* HFpEF scene: a real heart, lung and kidney. A thick ring shows the stiff wall, the cavity stays
 * small, the atrium balloons and fluid gathers in the lungs. Blockers dock for blood pressure control,
 * amber salt and sugar particles leave in urine for the SGLT2 inhibitor concept, and a diuretic
 * flushes water out so the lung fluid visibly drains. The aortic outflow stays brisk throughout. */
const layers = { drivers: $("drivers"), heart: $("heart"), cong: $("cong"), parts: $("parts"), over: $("over"), panel: $("panel") };
const HX = 400, HY = 245, HW = 170, KX = 620, KY = 335, KW = 95, LX = 770, LY = 230, LW = 200;
let heartO = null, lungO = null, kidO = null;
let trLoad = null, trIn = null, trOut = null, trBack = null, trUrine = null;
let cavEl, ringEl, laEl, laVes, loadVes, beamEl, hazeEl, fluidEl, capEl = null, capKey = "";
let CX = HX + 6, CY = HY + 20, LAx = HX - 35, LAy = HY - 148, FLx = LX - 1, FLy = LY + 97;
const recPos = [], recEls = [], drvDots = [];
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, ri: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const loadP = pool(10, () => mk("circle", { class: "sc-p p-hfpef-load", r: 2.4 }, layers.parts));
const inP = pool(14, () => mk("circle", { class: "sc-p p-hfpef-in", r: 2.6 }, layers.parts));
const outP = pool(12, () => mk("circle", { class: "sc-p p-hfpef-out", r: 2.6 }, layers.parts));
const backP = pool(14, () => mk("circle", { class: "sc-p p-hfpef-back", r: 2.4 }, layers.parts));
const lungD = pool(16, () => mk("circle", { class: "sc-p p-hfpef-drop", r: 2.4 }, layers.parts));
const urineP = pool(22, () => mk("circle", { class: "sc-p p-hfpef-ur", r: 2.6 }, layers.parts));
const blkP = pool(6, () => mk("circle", { class: "sc-p p-hfpef-blk", r: 3 }, layers.parts));
const sugP = pool(12, () => mk("rect", { class: "sc-p p-hfpef-sg", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, layers.parts));
function capText(d, l) {
  if (d === 1) return "Blood pressure control lowers the load. Blockers dock and the wall eases.";
  if (d === 2) return "SGLT2 inhibitor concept moves salt and sugar out in urine.";
  if (d === 3) return "Diuretic flushes water through the kidney. Lung fluid drains.";
  if (l === 2) return "No treatment. The stiff heart barely fills. Fluid gathers.";
  return "No treatment. The stiff heart fills slowly and fluid backs up.";
}
function init() {
  heartO = organ($("heartSlot"), "heart", HX, HY, HW, {});
  lungO = organ($("lungSlot"), "lung", LX, LY, LW, {});
  kidO = organ($("kidneySlot"), "kidney", KX, KY, KW, {});
  const HP = heartO.ports, LP = lungO.ports, KP = kidO.ports;
  const hTop = heartO.y - heartO.h / 2;
  LAx = HX - 35; LAy = Math.round(hTop - 28);
  CX = HX + 6; CY = HY + 20;
  FLx = Math.round((LP.base[0] + LP.baseR[0]) / 2); FLy = Math.round((LP.base[1] + LP.baseR[1]) / 2) - 4;
  /* cause dots and the load vessel feeding the heart */
  [150, 200, 250, 300].forEach((y) => drvDots.push(mk("circle", { class: "hfpef-drv", cx: 100, cy: y, r: 9 }, layers.drivers)));
  loadVes = mk("path", { class: "hfpef-load", d: "M140 225C200 225 250 238 312 242", fill: "none" }, layers.drivers);
  trLoad = track([[140, 225], [200, 225], [260, 238], [312, 242]]);
  [0.35, 0.55, 0.75].forEach((u) => { const q = trLoad.at(u); recPos.push([q.x, q.y]);
    recEls.push(mk("path", { class: "hfpef-rec", d: "M" + f1(q.x - 1) + " " + f1(q.y - 7) + "L" + f1(q.x + 1) + " " + f1(q.y + 7) }, layers.drivers)); });
  /* atrium balloon and its connector into the heart */
  laEl = mk("ellipse", { class: "hfpef-la", cx: LAx, cy: LAy, rx: 34, ry: 24 }, layers.heart);
  laVes = mk("path", { class: "hfpef-laves", d: "M" + LAx + " " + (LAy + 14) + "L" + (HX - 18) + " " + f1(hTop + 8), fill: "none" }, layers.heart);
  trIn = track([[LAx, LAy + 14], [HX - 18, hTop + 8], [CX, CY - 10]]);
  /* cavity and thick wall ring on the heart */
  cavEl = mk("ellipse", { class: "hfpef-cav", cx: CX, cy: CY, rx: 26, ry: 33 }, layers.heart);
  ringEl = mk("ellipse", { class: "hfpef-ring", cx: CX, cy: CY, rx: 40, ry: 47 }, layers.heart);
  /* brisk aortic outflow: the squeeze stays preserved */
  const AP = HP.aorta;
  trOut = track([[AP[0], AP[1]], [AP[0] + 2, AP[1] - 42], [AP[0] + 72, AP[1] - 52]]);
  /* back pressure beam from atrium to lung hilum, plus congestion haze and fluid */
  const HL = LP.hilumL;
  beamEl = mk("path", { class: "hfpef-beam", d: "M" + (LAx + 12) + " " + (LAy + 4) + "C560 150 680 205 " + f1(HL[0]) + " " + f1(HL[1]), fill: "none" }, layers.cong);
  trBack = track([[LAx + 12, LAy + 4], [560, 150], [680, 205], HL]);
  hazeEl = mk("ellipse", { class: "hfpef-haze", cx: LX, cy: LY, rx: 100, ry: 115, opacity: "0.3" }, layers.cong);
  fluidEl = mk("ellipse", { class: "hfpef-fluid", cx: FLx, cy: FLy, rx: 70, ry: 20, opacity: "0.6" }, layers.cong);
  trUrine = track([KP.out, [KP.out[0], KP.out[1] + 34]]);
  /* six short labels, left to right: causes, atrium, squeeze, wall, kidney, lung fluid */
  const o = layers.over;
  pill(o, "Causes", 100, 190, 100, 84, "Years of load that thicken the wall: hypertension, diabetes, obesity and ageing. Blood pressure control calms this stream.");
  pill(o, "Left atrium", LAx, LAy, 215, 70, "Left atrium: it stretches and enlarges because it must push blood into a stiff ventricle at high pressure.");
  pill(o, "Good squeeze", AP[0] + 43, AP[1] - 47, 560, 80, "Preserved ejection fraction: blood leaves briskly down the aorta in every setting. The squeeze is fine; filling is the problem.");
  pill(o, "Thick wall", CX + 45, CY + 5, 290, 352, "Concentric hypertrophy: the wall thickens inward, so the chamber stays small. The ring thins a little with blood pressure control.");
  pill(o, "Kidney", KX, KY, 620, 262, "Kidney: the diuretic and the SGLT2 inhibitor concept act here, moving water with salt and sugar out in urine.");
  pill(o, "Lung fluid", FLx, FLy, 775, 400, "Fluid in the lungs from back pressure. It rises as congestion worsens and drains with a diuretic.");
  capEl = mk("text", { class: "hfpef-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, level);
  const P = layers.panel, y0 = 478, h = 70;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["stiff", "Stiffness", "g-cyt", "How thick and stiff the ventricle wall is. Stiffer muscle fills more slowly."], ["fill", "Pressure", "g-bad", "Filling pressure: the pressure needed to fill the stiff ventricle."], ["la", "Atrium", "g-eos", "Left atrial size: it enlarges under years of raised filling pressure."], ["cong", "Congestion", "g-fl", "How much fluid has backed up into the lungs."], ["ef", "Ejection", "g-good", "Ejection fraction: the fraction ejected each beat. Here it stays preserved."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 125 + i * 160, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { a: 0.65, stiff: 0.68, fill: 0.7, cong: 0.71, la: 0.7, ef: 0.85, bp: 0, sg: 0, diu: 0 };
const acc = { load: 0, inn: 0, out: 0, back: 0, drop: 0, urine: 0, sug: 0, blk: 0 };
let beat = 0;
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.a = lerp(sm.a, m.a, k2); sm.stiff = lerp(sm.stiff, m.stiff, k2); sm.la = lerp(sm.la, m.la, k2);
  sm.fill = lerp(sm.fill, m.fill, k1); sm.cong = lerp(sm.cong, m.cong, k1); sm.ef = lerp(sm.ef, m.ef, k1);
  sm.bp = lerp(sm.bp, m.bp, k1); sm.sg = lerp(sm.sg, m.sg, k1); sm.diu = lerp(sm.diu, m.diu, k1);
  /* beat: squeeze stays strong (preserved), filling is what suffers */
  beat += dt * 1.05; const ph = beat % 1;
  const contract = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
  const efN = clamp((sm.ef - 0.6) / 0.25, 0.35, 1);
  place(heartO.g, HX, HY - 1.5 * contract * efN, 0, 1 + 0.015 * contract * efN);
  const cavR = Math.max(14, (30 - 9 * sm.stiff) * (1 - 0.28 * contract * efN));
  cavEl.setAttribute("rx", f1(cavR)); cavEl.setAttribute("ry", f1(cavR * 1.25));
  const sw = 4 + 22 * sm.stiff;
  ringEl.setAttribute("rx", f1(cavR + sw / 2 + 2)); ringEl.setAttribute("ry", f1(cavR * 1.25 + sw / 2 + 2));
  ringEl.setAttribute("stroke-width", f1(sw)); ringEl.setAttribute("opacity", (0.35 + 0.5 * sm.stiff).toFixed(2));
  const laRx = 20 + 24 * sm.la, laRy = 14 + 16 * sm.la;
  laEl.setAttribute("rx", f1(laRx)); laEl.setAttribute("ry", f1(laRy));
  laVes.setAttribute("stroke-width", f1(5 + 8 * sm.fill)); laVes.setAttribute("opacity", (0.3 + 0.5 * sm.fill).toFixed(2));
  /* load stream dims when blood pressure is controlled */
  const loadR = sm.a * (1 - 0.45 * sm.bp);
  loadVes.setAttribute("opacity", (0.2 + 0.55 * loadR).toFixed(2));
  drvDots.forEach((d) => d.setAttribute("opacity", (0.45 + 0.55 * loadR).toFixed(2)));
  recEls.forEach((r) => r.setAttribute("opacity", (0.25 + 0.75 * Math.max(sm.bp, 0.2)).toFixed(2)));
  /* back pressure beam, congestion haze and lung fluid */
  beamEl.setAttribute("opacity", (0.12 + 0.65 * sm.fill).toFixed(2)); beamEl.setAttribute("stroke-width", f1(2 + 6 * sm.fill));
  hazeEl.setAttribute("opacity", (0.04 + 0.30 * sm.cong).toFixed(2));
  const flRy = 6 + 34 * sm.cong;
  fluidEl.setAttribute("ry", f1(flRy)); fluidEl.setAttribute("cy", f1(FLy + (flRy - 6) / 4));
  fluidEl.setAttribute("opacity", (0.35 + 0.45 * sm.cong).toFixed(2));
  /* blocker dots dock on the load vessel receptors */
  acc.blk += dt * 5 * sm.bp;
  while (acc.blk >= 1) { acc.blk--; const p = free(blkP); if (p) { p.ri = blkP.indexOf(p) % 3; emit(p, 140, 225, 0, 0, 0); } }
  blkP.forEach((p) => { if (!p.on) return;
    if (sm.bp < 0.4) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    const r = recPos[p.ri];
    p.x += (r[0] - p.x) * Math.min(1, dt * 3); p.y += (r[1] - p.y) * Math.min(1, dt * 3);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* cause signals travelling into the wall */
  acc.load += dt * 6 * loadR;
  while (acc.load >= 1) { acc.load--; const p = free(loadP); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  loadP.forEach((p) => { if (!p.on) return; p.u += dt * 0.4; if (p.u >= 1) { kill(p); return; }
    const q = trLoad.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* slow inflow from atrium, brisk outflow down the aorta */
  acc.inn += dt * 6;
  while (acc.inn >= 1) { acc.inn--; const p = free(inP); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  inP.forEach((p) => { if (!p.on) return; p.u += dt * (0.55 - 0.32 * sm.stiff); if (p.u >= 1) { kill(p); return; }
    const q = trIn.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.out += dt * 7 * sm.ef;
  while (acc.out >= 1) { acc.out--; const p = free(outP); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  outP.forEach((p) => { if (!p.on) return; p.u += dt * 0.65; if (p.u >= 1) { kill(p); return; }
    const q = trOut.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* back pressure signals toward the lungs */
  acc.back += dt * 9 * sm.fill;
  while (acc.back >= 1) { acc.back--; const p = free(backP); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  backP.forEach((p) => { if (!p.on) return; p.u += dt * 0.4; if (p.u >= 1) { kill(p); return; }
    const q = trBack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* droplets gathering in the lungs */
  acc.drop += dt * 6 * sm.cong;
  while (acc.drop >= 1) { acc.drop--; const p = free(lungD); if (p) emit(p, rnd(FLx - 40, FLx + 40), rnd(200, 250), 0, rnd(20, 30), 0); }
  lungD.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x, FLx - 55, FLx + 55);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y >= FLy + flRy - 4) kill(p); });
  /* urine out of the kidney, surging with diuretic */
  acc.urine += dt * (1.5 + 13 * sm.diu + 5 * sm.sg);
  while (acc.urine >= 1) { acc.urine--; const p = free(urineP); if (p) { const q = trUrine.at(0); emit(p, q.x, q.y, 0, 55 + 70 * sm.diu, 0); } }
  urineP.forEach((p) => { if (!p.on) return; p.t += dt; const q = trUrine.at(Math.min(1, p.t * 2.2));
    p.x = q.x; p.y = q.y + Math.max(0, p.t - 0.45) * (55 + 70 * sm.diu);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.y - trUrine.at(1).y) / 14).toFixed(2));
    if (p.y > trUrine.at(1).y + 12) kill(p); });
  /* amber salt and sugar particles leaving in urine on the SGLT2 inhibitor concept */
  acc.sug += dt * 7 * sm.sg;
  while (acc.sug >= 1) { acc.sug--; const p = free(sugP); if (p) emit(p, kidO.x - 20, kidO.y - 10, 0, 0, 0); }
  sugP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { const f = Math.min(1, p.t / 0.7);
      p.x = lerp(kidO.x - 20, kidO.ports.out[0], f); p.y = lerp(kidO.y - 10, kidO.ports.out[1], f);
      if (f >= 1) { p.st = 1; p.t = 0; } }
    else { p.y += 60 * dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.6).toFixed(2)); if (p.t > 0.6) { kill(p); return; } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  gg.stiff.set(sm.stiff, wordOf(sm.stiff, 0.3, 0.6, ["mild", "stiff", "very stiff"])); gg.fill.set(sm.fill, wordOf(sm.fill, 0.25, 0.6, ["near normal", "raised", "high"]));
  gg.la.set(sm.la, wordOf(sm.la, 0.3, 0.6, ["normal", "enlarged", "large"])); gg.cong.set(sm.cong, wordOf(sm.cong, 0.25, 0.6, ["minimal", "mild", "marked"]));
  gg.ef.set(sm.ef, wordOf(sm.ef, 0.6, 0.75, ["reduced", "borderline", "preserved"]));
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
