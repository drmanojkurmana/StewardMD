/* Hepatorenal syndrome scene, read left to right. A scarred liver raises portal
 * pressure, gut vessels widen and blood pools there, the arteries run empty, and
 * hormone and nerve drive squeezes the kidney arteries. The kidney itself is
 * normal tissue failing only from lack of blood. Albumin with a vessel tightener
 * narrows the gut vessels again, stopping triggers removes a smaller load, and a
 * new liver ends the whole chain so the kidney recovers and urine salt returns. */
const layers = { fluid: $("fluid"), flow: $("flow"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, ri: -1 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; if (p.ri >= 0) { recs[p.ri].who = null; p.ri = -1; } p.e.setAttribute("opacity", "0"); }

/* ---- organs from the shared library; vessels and particles meet their ports ---- */
let liverO = null, bowelO = null, vesselO = null, kidneyO = null, bladderO = null, capEl = null, capDrug = -1;
let portalSeg = { x0: 230, x1: 330, y: 180 };
let artTrack = null, sigTrack = null, ureterTrack = null, trBlock = [];
let beamMid = { x: 650, y: 285 }, sqzHome = { x: 685, y: 312 }, uretMid = { x: 781, y: 384 };
let bladderOut = [860, 415];
const recs = [];
const REC_LOCAL = [[-38, -26], [38, -26], [-38, 28], [38, 28]];
function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 140, 175, 180, {});
  bowelO = organ($("bowelSlot"), "bowel", 400, 180, 150, {});
  vesselO = organ($("vesselSlot"), "vessel", 600, 178, 64, { h: 150 });
  kidneyO = organ($("kidneySlot"), "kidney", 710, 330, 120, {});
  bladderO = organ($("bladderSlot"), "bladder", 860, 370, 64, {});
  const LP = liverO.ports, VP = vesselO.ports, KP = kidneyO.ports, DP = bladderO.ports;
  /* portal vein: gut to the liver hilum */
  const pIn = LP.porta || LP.in;
  const pStart = [bowelO.x - bowelO.w / 2 + 8, bowelO.y + 2];
  $("v-portal").setAttribute("d", "M" + f1(pStart[0]) + " " + f1(pStart[1]) + " L" + f1(pIn[0]) + " " + f1(pIn[1]));
  portalSeg = { x0: Math.min(pStart[0], pIn[0]), x1: Math.max(pStart[0], pIn[0]), y: (pStart[1] + pIn[1]) / 2 };
  /* arterial road: gut vessels past the artery sample into the kidney */
  const pel = KP.pelvis || KP.in, vIn = VP.in, vOut = VP.out;
  const a0 = [bowelO.x + bowelO.w / 2 - 6, bowelO.y - 2];
  artTrack = track([a0, [(a0[0] + vIn[0]) / 2, (a0[1] + vIn[1]) / 2 + 8], vIn, vOut, [(vOut[0] + pel[0]) / 2, (vOut[1] + pel[1]) / 2], pel]);
  $("v-art").setAttribute("d", "M" + f1(a0[0]) + " " + f1(a0[1]) + " L" + f1(vIn[0]) + " " + f1(vIn[1]));
  $("v-renal").setAttribute("d", "M" + f1(vOut[0]) + " " + f1(vOut[1])
    + " C" + f1(vOut[0] + 14) + " " + f1(vOut[1] + 30) + " " + f1(pel[0] - 34) + " " + f1(pel[1] - 34)
    + " " + f1(pel[0]) + " " + f1(pel[1]));
  /* hormone and nerve drive: low arteries to the kidney */
  sigTrack = track([[vOut[0] + 4, vOut[1]], [(vOut[0] + pel[0]) / 2, (vOut[1] + pel[1]) / 2], pel]);
  $("beam").setAttribute("d", "M" + f1(vOut[0] + 4) + " " + f1(vOut[1])
    + " L" + f1((vOut[0] + pel[0]) / 2) + " " + f1((vOut[1] + pel[1]) / 2)
    + " L" + f1(pel[0]) + " " + f1(pel[1]));
  beamMid = sigTrack.at(0.5); sqzHome = artTrack.at(0.96);
  /* ureter: kidney base to the bladder, then out below it */
  const uStart = [kidneyO.x - 8, kidneyO.y + kidneyO.h / 2 - 12];
  const trig = DP.trigone || [bladderO.x, bladderO.y + 16];
  ureterTrack = track([uStart, [(uStart[0] + trig[0]) / 2, uStart[1] + 14], [(uStart[0] + trig[0]) / 2 + 20, (uStart[1] + trig[1]) / 2], trig]);
  $("v-ureter").setAttribute("d", "M" + f1(uStart[0]) + " " + f1(uStart[1])
    + " C" + f1((uStart[0] + trig[0]) / 2) + " " + f1(uStart[1] + 14) + " " + f1((uStart[0] + trig[0]) / 2 + 20) + " " + f1((uStart[1] + trig[1]) / 2)
    + " " + f1(trig[0]) + " " + f1(trig[1]));
  uretMid = ureterTrack.at(0.5);
  bladderOut = DP.out || [bladderO.x, bladderO.y + 45];
  /* tightener receptors ride on the bowel, over its vessels */
  REC_LOCAL.forEach(([lx, ly]) => { const ring = mk("circle", { class: "hr-rec", cx: lx, cy: ly, r: 6 }, bowelO.g); recs.push({ lx, ly, ring, who: null }); });
  trBlock = recs.map((r) => { const wx = bowelO.x + r.lx, wy = bowelO.y + r.ly;
    return track([[vIn[0] - 46, vIn[1] - 24], [(vIn[0] - 46 + wx) / 2, (vIn[1] - 24 + wy) / 2 - 14], [wx, wy]]); });
}
function capText(d) {
  if (d === 1) return "Albumin plus a vessel tightener. The tightener sits on gut vessels, they narrow and the kidney eases.";
  if (d === 2) return "Harmful drugs stopped. With triggers gone, the squeeze on the kidney eases a little.";
  if (d === 3) return "A new liver. The cirrhosis is gone, so vessels relax and the kidney recovers.";
  return "No treatment. Wide gut vessels leave the arteries empty and the kidney squeezed.";
}

/* ---- scars, bowel vessels, squeeze markers, ascites ---- */
let nodG = null, bowG = null, sqzL = null, sqzR = null, ascPool = null, ascSurf = null;
const bowV = [];
function initBody() {
  nodG = mk("g", {}, layers.parts);
  [[-30, -35], [10, -45], [40, -25], [-20, 15], [25, 20], [-45, -5]].forEach(([u, v]) => mk("circle", { class: "hr-nod", cx: f1(liverO.x + u), cy: f1(liverO.y + v), r: 9 }, nodG));
  bowG = mk("g", {}, layers.flow);
  [150, 178, 206].forEach((yy) => bowV.push(mk("path", { class: "hr-bowv", d: "M335 " + yy + " Q365 " + (yy - 12) + " 395 " + yy + " T465 " + (yy - 4) }, bowG)));
  sqzL = mk("path", { class: "hr-sqz", d: "M630 308L630 328" }, layers.parts);
  sqzR = mk("path", { class: "hr-sqz", d: "M650 308L650 328" }, layers.parts);
  ascPool = mk("path", { class: "hr-pool", opacity: "0.32" }, layers.fluid);
  ascSurf = mk("path", { class: "hr-surf", opacity: "0.85" }, layers.fluid);
}

/* ---- red cells on the portal vein and inside the artery sample ---- */
const prbcs = [], vrbcs = [];
function initCells() {
  for (let i = 0; i < 8; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    prbcs.push({ g, x: rnd(portalSeg.x0, portalSeg.x1), y: rnd(-6, 6), v: rnd(0.85, 1.15), rot: rnd(-15, 15) });
  }
  for (let i = 0; i < 6; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, vesselO.g); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g);
    vrbcs.push({ g, x: rnd(-11, 11), y: rnd(-70, 70), v: rnd(0.85, 1.15) });
  }
}

/* ---- particle pools ---- */
const nos = pool(16, () => mk("circle", { class: "p-no", r: 3 }, layers.parts));
const sig = pool(20, () => mk("path", { class: "sc-p p-raas", d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z" }, layers.parts));
const urine = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const salt = pool(10, () => mk("circle", { class: "sc-p p-salt", r: 2 }, layers.parts));
const leak = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const albP = pool(10, () => mk("circle", { class: "sc-p p-alb", r: 2.6 }, layers.parts));
const artF = pool(10, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return g; });
const blk = pool(8, () => mk("circle", { class: "sc-p p-block", r: 4 }, layers.parts));
const diur = pool(8, () => mk("circle", { class: "sc-p p-diur", r: 2.6 }, layers.parts));
const tox = pool(8, () => mk("path", { class: "sc-p p-tox", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["portal", "Portal", "g-portal", "Pressure in the portal vein. It rises as the scarred liver resists flow and widened gut inflow stays high."], ["fill", "Filling", "g-good", "Arterial filling. Gut vessels widen and blood pools there, so the arteries run empty though total body fluid is up."], ["raas", "Hormone drive", "g-raas", "Renin angiotensin and sympathetic nerve activity. The body switches these on to defend pressure when filling falls."], ["sqz", "Renal squeeze", "g-bad", "How tightly the kidney arteries are squeezed by that hormone and nerve drive."], ["kid", "Kidney", "g-good", "Kidney filtration. It falls from poor blood flow, not from damaged tissue: the kidney here is normal."], ["salt", "Urine salt", "g-fl", "Salt appearing in the urine. The squeezed kidney holds on to salt, so urine salt is very low in this illness."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Liver", liverO.x, liverO.y - liverO.h / 2 + 12, 130, 84, "Scarred liver. Scarring resists blood flow, so pressure builds in the portal vein.");
  pill(ox, "Gut vessels", bowelO.x, bowelO.y - bowelO.h / 2 + 10, 400, 84, "Gut arteries widened by a vessel widening signal. Blood pools here instead of filling the arteries.");
  pill(ox, "Arteries", vesselO.ports.in[0], vesselO.ports.in[1], 590, 84, "Arteries run empty. Total body fluid is up, but so much blood sits in the gut vessels.");
  pill(ox, "Hormone drive", beamMid.x, beamMid.y, 790, 84, "Hormone and nerve drive. Low filling switches on renin angiotensin and sympathetic nerves to defend pressure.");
  pill(ox, "Kidney squeeze", sqzHome.x, sqzHome.y, 520, 262, "Squeezed kidney arteries. The drive squeezes these vessels hard, so filtration falls.");
  pill(ox, "Kidney", kidneyO.x + kidneyO.w / 2 - 6, kidneyO.y + 10, 860, 300, "The kidney. Its tissue is normal: it fails only from lack of blood, a functional failure.");
  pill(ox, "Ascites", 200, 378, 140, 352, "Ascites. Fluid in the belly from high portal pressure plus salt and water kept back.");
  pill(ox, "Urine salt", uretMid.x, uretMid.y, 780, 415, "Urine salt is very low. The squeezed kidney holds on to salt.");
  capEl = mk("text", { class: "hr-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { P: 0.6, D: 0.5, U: 0.4, R: 0.5, Rc: 0.4, K: 0.6, Asc: 0.5, UNa: 0.4, alb: 0, halt: 0, txp: 0, a: 0.7, dock: 0 };
const acc = { no: 0, sig: 0, ur: 0, salt: 0, leak: 0, alb: 0, art: 0, blk: 0, diur: 0, tox: 0 };
function init() { initOrgans(); initBody(); initCells(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["P", "D", "U", "R", "Rc", "Asc", "UNa", "alb", "halt", "txp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.K = lerp(sm.K, m.K, k2); sm.a = m.a;
  /* docked tightener share, eases toward the occupied receptor count */
  let docked = 0; recs.forEach((r) => { if (r.who) docked++; });
  sm.dock = lerp(sm.dock, docked / recs.length, Math.min(1, dt * 2));
  const fill = 1 - sm.U;
  const narrow = (1 - 0.8 * sm.dock) * (1 - 0.7 * sm.txp);
  /* vessels, scars, bowel vessels and receptors */
  $("v-portal").setAttribute("stroke-width", f1(9 + 13 * sm.P));
  $("v-renal").setAttribute("stroke-width", f1(13 - 9 * sm.Rc));
  $("beam").setAttribute("opacity", (0.15 + 0.6 * sm.R).toFixed(2));
  nodG.setAttribute("opacity", ((0.25 + 0.75 * sm.a) * (1 - 0.92 * sm.txp)).toFixed(2));
  const bw = 2.5 + 5.5 * sm.D * narrow;
  bowV.forEach((p) => { p.setAttribute("stroke-width", f1(bw)); });
  bowG.setAttribute("opacity", (0.35 + 0.65 * clamp(sm.D * narrow + 0.25)).toFixed(2));
  recs.forEach((r) => { r.ring.setAttribute("stroke-width", r.who ? "2.6" : "1.6"); r.ring.setAttribute("opacity", (r.who ? 1 : 0.55 + 0.35 * sm.alb).toFixed(2)); });
  /* artery sample fills or runs empty */
  vrbcs.forEach((c) => { c.y += c.v * dt * (30 + 60 * fill); if (c.y > 70) c.y = -70; place(c.g, c.x, c.y, 0, 1); c.g.setAttribute("opacity", (0.2 + 0.8 * fill).toFixed(2)); });
  /* squeeze markers at the kidney entry open and close */
  const Q = artTrack.at(0.96), gap = 10 - 7 * sm.Rc;
  sqzL.setAttribute("d", "M" + f1(Q.x - gap) + " " + f1(Q.y - 10) + "L" + f1(Q.x - gap) + " " + f1(Q.y + 10));
  sqzR.setAttribute("d", "M" + f1(Q.x + gap) + " " + f1(Q.y - 10) + "L" + f1(Q.x + gap) + " " + f1(Q.y + 10));
  sqzL.setAttribute("opacity", (0.25 + 0.75 * sm.Rc).toFixed(2)); sqzR.setAttribute("opacity", (0.25 + 0.75 * sm.Rc).toFixed(2));
  /* ascites pool, kept inside the stage */
  const topY = 436 - (8 + 74 * sm.Asc);
  let d = "M36 " + f1(topY), s = "M36 " + f1(topY);
  for (let x = 46; x <= 436; x += 10) { const y = topY + 1.6 * Math.sin(x / 24 + tm / 700); d += "L" + x + " " + f1(y); s += "L" + x + " " + f1(y); }
  ascPool.setAttribute("d", d + "L436 436L36 436Z"); ascSurf.setAttribute("d", s);
  /* red cells: portal vein into the liver */
  prbcs.forEach((r) => { r.x -= r.v * 40 * dt; if (r.x < portalSeg.x0) { r.x = portalSeg.x1; r.y = rnd(-6, 6); } place(r.g, r.x, portalSeg.y + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* arterial flow from the gut past the artery into the kidney, stronger when filled */
  acc.art += dt * (0.6 + 4.5 * fill); while (acc.art >= 1) { acc.art--; const p = free(artF); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  artF.forEach((p) => { if (!p.on) return; p.u += dt * (0.22 + 0.3 * fill); if (p.u >= 1) { kill(p); return; } const q = artTrack.at(p.u); place(p.e, q.x, q.y, q.a, 1); });
  /* vessel widening signal drifting out of the gut vessels, faded by the tightener */
  acc.no += dt * sm.D * (1 - 0.7 * sm.dock) * (1 - 0.8 * sm.txp) * 7; while (acc.no >= 1) { acc.no--; const p = free(nos); if (p) emit(p, bowelO.x + rnd(-45, 45), bowelO.y + rnd(-35, 35), rnd(-16, 16), rnd(-16, 16)); }
  nos.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, bowelO.x - 70, bowelO.x + 70); p.y = clamp(p.y + p.vy * dt, bowelO.y - 60, bowelO.y + 60); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.7).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  /* vessel tightener: travel to a free bowel receptor, sit on it, then let go */
  acc.blk += dt * sm.alb * 2.2; while (acc.blk >= 1) { acc.blk--; const ri = recs.findIndex((r) => !r.who); const p = free(blk); if (ri >= 0 && p) { p.ri = ri; recs[ri].who = p; p.tr = trBlock[ri]; p.u = 0; emit(p, 0, 0, 0, 0); p.ri = ri; recs[ri].who = p; } }
  blk.forEach((p) => {
    if (!p.on) return;
    if (p.tr) { p.u += dt * 0.9; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { p.tr = null; p.t = 0; } }
    else { p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 300 + p.y) * 1.5) + " " + f1(p.y) + ")"); if (p.t > 5 || sm.alb < 0.5) kill(p); }
  });
  /* albumin support riding the arterial road */
  acc.alb += dt * sm.alb * 6; while (acc.alb >= 1) { acc.alb--; const p = free(albP); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  albP.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; if (p.u >= 1) { kill(p); return; } const q = artTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* harmful triggers, present until they are stopped */
  acc.diur += dt * (1 - sm.halt) * (1 - sm.txp) * 3.2; while (acc.diur >= 1) { acc.diur--; const p = free(diur); if (p) emit(p, 560 + rnd(0, 80), 100, rnd(-3, 3), rnd(36, 48)); }
  diur.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y >= 168) kill(p); });
  acc.tox += dt * (1 - sm.halt) * (1 - sm.txp) * 2.4; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  tox.forEach((p) => { if (!p.on) return; p.u += dt * 0.35; if (p.u >= 1) { kill(p); return; } const q = sigTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 8) + ")"); });
  /* hormonal and nerve signals travelling to the kidney */
  acc.sig += dt * sm.R * 9; while (acc.sig >= 1) { acc.sig--; const p = free(sig); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  sig.forEach((p) => { if (!p.on) return; p.u += dt * 0.55; if (p.u >= 1) { kill(p); return; } const q = sigTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* urine and the salt inside it, kidney to bladder then out */
  acc.ur += dt * sm.K * 5; while (acc.ur >= 1) { acc.ur--; const p = free(urine); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; p.k = 0; } }
  urine.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) { p.u += dt * 0.8; if (p.u >= 1) { p.k = 1; p.x = bladderOut[0]; p.y = bladderOut[1]; p.vx = rnd(-2, 2); p.vy = rnd(8, 16); } else { const q = ureterTrack.at(p.u); p.x = q.x; p.y = q.y; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - bladderOut[1]) / 22).toFixed(2)); if (p.y > 436) kill(p); }
  });
  acc.salt += dt * sm.K * sm.UNa * 6; while (acc.salt >= 1) { acc.salt--; const p = free(salt); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; p.k = 0; } }
  salt.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) { p.u += dt * 0.8; if (p.u >= 1) { p.k = 1; p.x = bladderOut[0]; p.y = bladderOut[1]; p.vx = rnd(-2, 2); p.vy = rnd(8, 16); } else { const q = ureterTrack.at(p.u); p.x = q.x; p.y = q.y; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - bladderOut[1]) / 22).toFixed(2)); if (p.y > 436) kill(p); }
  });
  /* ascites leak drops falling into the pool */
  acc.leak += dt * sm.Asc * 5; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, rnd(80, 400), 252, rnd(-3, 3), rnd(24, 38)); }
  leak.forEach((p) => { if (!p.on) return; p.x = clamp(p.x + p.vx * dt, 40, 432); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > topY - 2) kill(p); });
  /* gauges */
  gg.portal.set(sm.P, wordOf(sm.P, 0.35, 0.7, ["mild", "raised", "very high"]));
  gg.fill.set(1 - sm.U, wordOf(1 - sm.U, 0.35, 0.65, ["low", "reduced", "maintained"]));
  gg.raas.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["quiet", "active", "very active"]));
  gg.sqz.set(sm.Rc, wordOf(sm.Rc, 0.3, 0.6, ["relaxed", "tight", "very tight"]));
  gg.kid.set(sm.K, wordOf(sm.K, 0.35, 0.7, ["failing", "struggling", "working"]));
  gg.salt.set(sm.UNa, wordOf(sm.UNa, 0.3, 0.6, ["very low", "low", "present"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
