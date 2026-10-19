/* Hydrocephalus scene: CSF made in the lateral ventricle, flowing down through the
 * third and fourth ventricles to the space around the brain and the arachnoid villi.
 * Brain and bowel are real organ art; all tracks are built from their ports. */
const layers = { brainSlot: $("brainSlot"), bowelSlot: $("bowelSlot"), vent: $("vent"), chor: $("choroid"), parts: $("parts"), over: $("over"), panel: $("panel"), glow: $("pressGlow"), bglow: $("bowelGlow"), lat: $("ventLat"), third: $("ventThird"), fourth: $("ventFourth"), block: $("blockMark"), plug: $("plugDot"), aq: $("aqChannel"), villi: $("villiG"), villiFail: $("villiMark"), etvMark: $("etvMark"), stoma: $("stomaDot"), shuntTube: $("shuntTube") };
let brainO = null, bowelO = null, capEl = null, capKey = "";
let latC = [225, 201], thirdC = [318, 259], fourthC = [394, 315], stomaP = [323, 291], aqMid = [355, 292], bowelCoils = [808, 338], bowelIn = [764, 270];
let trkMain = null, trkEtv = null, trkShunt = null, uBlock = 0.3, uJoin = 0.55;
const CHOR_OFF = [[-24, -8], [-12, -14], [0, -6], [12, -12], [24, -4], [-6, 8], [14, 10]];
function cumU(pts, idx) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return cum[idx] / cum[cum.length - 1]; }
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 325, 240, 400, {});
  bowelO = organ($("bowelSlot"), "bowel", 805, 335, 140, {});
  const BP = brainO.ports, CP = bowelO.ports;
  bowelCoils = [Math.round(CP.coils[0]), Math.round(CP.coils[1])];
  bowelIn = [Math.round(CP.in[0]), Math.round(CP.in[1])];
  latC = [Math.round((BP.frontal[0] + BP.parenchyma[0]) / 2), Math.round((BP.frontal[1] + BP.parenchyma[1]) / 2 - 8)];
  thirdC = [Math.round(BP.parenchyma[0] + 25), Math.round(BP.parenchyma[1] + 45)];
  fourthC = [Math.round(BP.cereb[0] - 35), Math.round(BP.cereb[1] - 15)];
  stomaP = [thirdC[0] + 5, thirdC[1] + 32];
  aqMid = [Math.round((thirdC[0] + fourthC[0]) / 2), Math.round((thirdC[1] + fourthC[1]) / 2)];
  const aqIn = [thirdC[0] + 12, thirdC[1] + 20], fourthOut = [fourthC[0] + 36, fourthC[1] + 17];
  const preThird = [Math.round((latC[0] + thirdC[0]) / 2), Math.round((latC[1] + thirdC[1]) / 2)];
  const mainPts = [latC, preThird, thirdC, aqIn, aqMid, fourthC, fourthOut, [500, 340], [548, 300], [560, 220], [552, 140], [530, 90], [510, 70], [560, 64]];
  trkMain = track(mainPts);
  uBlock = cumU(mainPts, 3); uJoin = cumU(mainPts, 6);
  trkEtv = track([stomaP, [stomaP[0] + 30, stomaP[1] + 22], fourthOut]);
  const shuntPts = [[latC[0] + 10, latC[1] - 25], [270, 110], [350, 85], [550, 75], [700, 110], [745, 180], bowelIn, bowelCoils];
  trkShunt = track(shuntPts);
  layers.shuntTube.setAttribute("d", "M" + shuntPts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"));
  layers.aq.setAttribute("d", "M" + f1(thirdC[0] + 4) + " " + f1(thirdC[1] + 20) + "Q" + f1(aqMid[0]) + " " + f1(aqMid[1]) + " " + f1(fourthC[0] - 6) + " " + f1(fourthC[1] - 15));
  layers.block.setAttribute("transform", "translate(" + f1(aqMid[0]) + " " + f1(aqMid[1]) + ")");
  layers.etvMark.setAttribute("transform", "translate(" + f1(stomaP[0]) + " " + f1(stomaP[1]) + ")");
  layers.glow.setAttribute("cx", f1(latC[0])); layers.glow.setAttribute("cy", f1(latC[1]));
  layers.bglow.setAttribute("cx", f1(bowelCoils[0])); layers.bglow.setAttribute("cy", f1(bowelCoils[1]));
  CHOR_OFF.forEach((o) => { const c = mk("circle", { class: "hc-chorDot", r: 5 - (Math.abs(o[0] + o[1]) % 3), cx: f1(latC[0] + o[0]), cy: f1(latC[1] + o[1]) }, layers.chor); c.setAttribute("opacity", "0.95"); });
}
function capText(d, ob, fa) {
  if (d === 1) return "A shunt drains fluid to the belly. Swelling eases and pressure falls.";
  if (d === 2) return ob ? "The new opening bypasses the block. Fluid flows again." : "The new opening helps little here. Fluid still is not absorbed.";
  if (d === 3) return ob ? "Treating the cause opens the block. Flow returns." : fa ? "Treating the cause restores absorption. Swelling eases." : "Treating the cause changes little. Flow is already normal.";
  if (ob) return "No treatment. Fluid is blocked. Ventricles swell and pressure rises.";
  if (fa) return "No treatment. Fluid is not absorbed. Ventricles swell.";
  return "No treatment. Fluid flows freely and ventricles look normal.";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, mode: 0, ang: 0 }; }); }
const csf = pool(38, () => mk("circle", { class: "sc-p p-csf", r: 3 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, mode) { p.on = true; p.mode = mode; p.u = 0; p.t = 0; p.k = 0; p.ang = -1.1; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Cerebrospinal fluid";
  [["prod", "Production", "g-fl", "CSF is made continuously by the choroid plexus, mainly in the lateral ventricles."], ["flow", "Flow", "g-fl", "Flow from the lateral ventricles down to the third ventricle, through the narrow aqueduct to the fourth ventricle, then out around the brain."], ["abs", "Absorption", "g-good", "CSF is absorbed through arachnoid villi into the venous sinus blood."], ["vent", "Ventricles", "g-bad", "Size of the ventricles. They enlarge when CSF builds up faster than it can leave or be absorbed."], ["pres", "Pressure", "g-bad", "Pressure inside the skull. A fast build up raises it; a slow build up in older adults may leave pressure near normal."], ["sym", "Symptoms", "g-bad", "Effects of the build up: headache and vomiting when pressure rises fast, or unsteady walking with slowed thinking and bladder urgency when it creeps up."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Choroid plexus", latC[0] - 10, latC[1] - 6, 140, 108, "Choroid plexus: tiny blood vessels in the ventricles that make CSF.");
  pill(ox, "Ventricles", latC[0] - 55, latC[1] + 4, 120, 252, "Ventricles: fluid spaces in the brain. They swell when CSF builds up.");
  pill(ox, "Aqueduct", aqMid[0] - 7, aqMid[1] + 4, 290, 352, "Aqueduct: the narrow channel between the third and fourth ventricles. A block here traps fluid above it.");
  const ep = pill(ox, "ETV opening", stomaP[0] + 7, stomaP[1] + 5, 470, 352, "ETV opening: a new hole in the third ventricle floor that lets fluid bypass a blocked aqueduct."); ep.setAttribute("id", "etv-pill");
  pill(ox, "Villi", 510, 68, 560, 115, "Arachnoid villi: tiny drains that pass CSF into the blood. When they fail, fluid is not absorbed.");
  pill(ox, "Sinus", 585, 64, 710, 70, "Venous sinus: the vein channel along the top of the brain that receives the absorbed CSF.");
  const sp = pill(ox, "Shunt", 600, 86, 660, 150, "Shunt: a tube from a ventricle to the belly that drains CSF past any block or failed absorption."); sp.setAttribute("id", "shunt-pill");
  pill(ox, "Belly", bowelCoils[0], bowelCoils[1] - 38, 808, 248, "Belly: a shunt drains CSF here, where nearby blood vessels absorb it.");
  capEl = mk("text", { class: "hc-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1, 0);
}
const sm = { prod: 0.7, flow: 0.8, absorb: 0.8, vent: 0.3, downVent: 0.3, pressure: 0.3, symptoms: 0.2, block: 0, villiFail: 0, shunt: 0, etv: 0 };
const acc = { csf: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.6), k2 = Math.min(1, dt * 0.8);
  sm.prod = lerp(sm.prod, m.prod, k2); sm.flow = lerp(sm.flow, m.flow, k2); sm.absorb = lerp(sm.absorb, m.absorb, k2);
  sm.vent = lerp(sm.vent, m.vent, k1); sm.downVent = lerp(sm.downVent, m.downVent, k1); sm.pressure = lerp(sm.pressure, m.pressure, k1);
  sm.symptoms = lerp(sm.symptoms, m.symptoms, k2); sm.block = lerp(sm.block, m.blockVis, k1); sm.villiFail = lerp(sm.villiFail, m.villiFail, k1);
  sm.shunt = lerp(sm.shunt, m.shunt, k1); sm.etv = lerp(sm.etv, m.etv, k1);
  const sLat = 0.62 + sm.vent * 0.78, sDown = 0.62 + sm.downVent * 0.78;
  layers.lat.setAttribute("transform", "translate(" + f1(latC[0]) + " " + f1(latC[1]) + ") scale(" + sLat.toFixed(3) + ")");
  layers.third.setAttribute("transform", "translate(" + f1(thirdC[0]) + " " + f1(thirdC[1]) + ") scale(" + sLat.toFixed(3) + ")");
  layers.fourth.setAttribute("transform", "translate(" + f1(fourthC[0]) + " " + f1(fourthC[1]) + ") scale(" + sDown.toFixed(3) + ")");
  layers.glow.setAttribute("opacity", (sm.pressure * 0.4).toFixed(2));
  layers.bglow.setAttribute("opacity", (sm.shunt * 0.35).toFixed(2));
  layers.block.setAttribute("transform", "translate(" + f1(aqMid[0]) + " " + f1(aqMid[1]) + ") scale(" + (0.7 + 0.5 * sm.block).toFixed(3) + ")");
  layers.block.setAttribute("opacity", sm.block.toFixed(2));
  layers.plug.setAttribute("r", f1(3 + 7 * sm.block));
  layers.aq.setAttribute("stroke-width", f1(7 - 4.5 * sm.block));
  layers.villi.setAttribute("opacity", (1 - 0.45 * sm.villiFail).toFixed(2));
  layers.villiFail.setAttribute("opacity", sm.villiFail.toFixed(2));
  layers.etvMark.setAttribute("opacity", sm.etv.toFixed(2));
  layers.stoma.setAttribute("rx", f1(4 + 9 * sm.etv + Math.sin(tm / 300) * 1.5 * sm.etv));
  layers.shuntTube.setAttribute("opacity", (sm.shunt * 0.95).toFixed(2));
  layers.shuntTube.setAttribute("stroke-width", f1(3 + 5 * sm.shunt));
  bowelO.g.setAttribute("transform", "translate(805 335) scale(" + (1 + 0.04 * sm.shunt + 0.015 * Math.sin(tm / 500) * sm.shunt).toFixed(3) + ")");
  $("shunt-pill").style.opacity = sm.shunt.toFixed(2); $("etv-pill").style.opacity = sm.etv.toFixed(2);
  layers.chor.setAttribute("transform", "translate(" + f1(Math.sin(tm / 700) * 1.5) + " " + f1(Math.cos(tm / 900) * 1.2) + ")");
  acc.csf += dt * (2 + sm.prod * 7);
  while (acc.csf >= 1) { acc.csf--; const p = freeP(csf); if (p) { const mode = sm.shunt > 0.45 && Math.random() < 0.55 ? 2 : (sm.etv > 0.45 && sm.block > 0.3 ? 1 : 0); emitP(p, mode); } }
  csf.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    if (p.mode === 2) {
      p.u += dt * 0.16; const q = trkShunt.at(p.u); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { p.mode = 4; p.t = 0; p.vx = rnd(-10, 10); p.vy = rnd(6, 20); }
    } else if (p.mode === 1) {
      p.u += dt * 0.5; const q = trkEtv.at(p.u); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { p.mode = 0; p.u = uJoin; p.t = 0; }
    } else if (p.mode === 3) {
      p.ang += dt * 0.22; p.x = 325 + Math.cos(p.ang) * 238; p.y = 240 + Math.sin(p.ang) * 170;
      p.e.setAttribute("opacity", clamp(1.2 - p.t / 3).toFixed(2)); if (p.t > 3.4) { killP(p); return; }
    } else if (p.mode === 4) {
      p.x = clamp(p.x + p.vx * dt, 742, 872); p.y = clamp(p.y + p.vy * dt, 280, 398);
      p.e.setAttribute("opacity", clamp(1.2 - p.t / 1.6).toFixed(2)); if (p.t > 1.8) { killP(p); return; }
    } else {
      const blocked = sm.block > 0.35 && sm.etv < 0.35;
      p.u += dt * 0.075 * (0.35 + sm.flow);
      if (blocked && p.u > uBlock) { p.u = uBlock; if (!p.k) { p.k = 1; p.t = 0; } if (p.t > 1.8) { killP(p); return; } }
      const q = trkMain.at(p.u); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { if (Math.random() < sm.absorb) { killP(p); return; } p.mode = 3; p.t = 0; p.ang = -1.2; }
    }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  gg.prod.set(sm.prod, wordOf(sm.prod, 0.4, 0.7, ["low", "steady", "steady"]));
  gg.flow.set(sm.flow, wordOf(sm.flow, 0.3, 0.65, ["blocked", "slow", "flowing"]));
  gg.abs.set(sm.absorb, wordOf(sm.absorb, 0.3, 0.65, ["poor", "reduced", "good"]));
  gg.vent.set(sm.vent, wordOf(sm.vent, 0.3, 0.65, ["normal", "enlarged", "gross"]));
  gg.pres.set(sm.pressure, wordOf(sm.pressure, 0.35, 0.65, ["normal", "raised", "high"]));
  gg.sym.set(sm.symptoms, wordOf(sm.symptoms, 0.3, 0.6, ["none", "some", "marked"]));
  const key = drug + (m.obstruct ? "o" : m.failing ? "f" : "n");
  if (key !== capKey) { capKey = key; const t = capText(drug, m.obstruct, m.failing); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
