/* Phaeochromocytoma scene: adrenal tumour bursts, vessel alpha squeeze, heart beta pounding, sweat and headache. */
const layers = { tum: $("tumourG"), scar: $("scarG"), wallT: $("wallTop"), wallB: $("wallBot"), rec: $("recG"), rbc: $("rbcs"), heart: $("heartSlot"), rings: $("ringsG"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("pheLumen"), rays: $("headRays") };
const VY = 218, VX0 = 272, VX1 = 648;
let kidneyO = null, adrO = null, heartO = null, medulla = [150, 190], heartPort = [740, 170], capEl = null, capKey = "";
let catTrk = null;
const tumCells = [], wallT = [], wallB = [], recNubs = [], rbcs = [];
const RECX = [330, 410, 490, 570];
let scarEl = null;
const rings = [];
function initOrgans() {
  kidneyO = organ($("kidneySlot"), "kidney", 135, 300, 150, {});
  adrO = organ($("adrSlot"), "adrenal", kidneyO.x + 8, kidneyO.y - kidneyO.h / 2 - 8, 96, {});
  heartO = organ($("heartSlot"), "heart", 775, 185, 160, {});
  medulla = adrO.ports.medulla;
  heartPort = heartO.ports.pulm;
  catTrk = track([medulla, [VX0, VY], [VX1, VY], heartPort]);
  const big = cell(layers.tum, { cls: "phetum", r: 26, nuc: 0.42, seed: 3, wob: 0.12 });
  tumCells.push(big);
  [[-20, -8], [18, -12], [-6, 14], [22, 10], [-26, 6]].forEach(function (o, i) {
    tumCells.push(cell(layers.tum, { cls: "phetum", r: 8, nuc: 0.4, seed: i + 7, wob: 0.16, x: o[0], y: o[1] }));
  });
  scarEl = mk("circle", { class: "phe-scar", r: 9 }, layers.scar);
  for (let wi = 0; wi < 16; wi++) {
    const wx = 282 + wi * 24;
    wallT.push(cell(layers.wallT, { cls: "phewall", r: 10, nuc: 0.3, seed: wi + 2, wob: 0.08, n: 8, x: wx, y: VY - 20 }));
    wallB.push(cell(layers.wallB, { cls: "phewall", r: 10, nuc: 0.3, seed: wi + 30, wob: 0.08, n: 8, x: wx, y: VY + 20 }));
  }
  RECX.forEach(function (rx) {
    recNubs.push({ side: -1, e: mk("circle", { class: "phe-rec", r: 3.4 }, layers.rec), x: rx });
    recNubs.push({ side: 1, e: mk("circle", { class: "phe-rec", r: 3.4 }, layers.rec), x: rx });
  });
  for (let ri = 0; ri < 12; ri++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.rbc);
    mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    rbcs.push({ g: g, x: rnd(VX0 + 4, VX1 - 4), y: rnd(-0.6, 0.6), v: rnd(0.8, 1.2), rot: rnd(-18, 18) });
  }
  for (let gi = 0; gi < 2; gi++) rings.push(mk("ellipse", { class: "phe-ring" }, layers.rings));
}
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: Math.random(), k: 0 }; }); }
function capsule(parent) {
  const g = mk("g", {}, parent);
  mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g);
  mk("rect", { class: "p-pill2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g);
  return g;
}
const cats = pool(30, function () { return mk("path", { class: "sc-p p-cat", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts); });
const mets = pool(18, function () { return mk("circle", { class: "sc-p p-met", r: 2.6 }, layers.parts); });
const sweats = pool(20, function () { return mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const bolus = pool(14, function () { return mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const abx = pool(8, function () { return capsule(layers.parts); });
const bbx = pool(4, function () { return capsule(layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function capText(d, l) {
  if (d === 1) return "Alpha blockade sits on the vessel wall. The vessel relaxes.";
  if (d === 2) return "Alpha plus beta blockade. Vessel relaxed and heart calmed.";
  if (d === 3) return "Fluids and rest only. Bursts continue and pressure stays high.";
  if (d === 4) return "Tumour removed after blockade. No more bursts. Pressure normal.";
  return ["No treatment. Quiet tumour. Little hormone release.", "No treatment. Bursts surge in the blood. Pressure spikes.", "No treatment. Crisis. Flooding blood and very high pressure."][l];
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cat", "Catecholamines", "g-cyt", "Adrenaline and noradrenaline released by the tumour in bursts."], ["bp", "Pressure", "g-bad", "Blood pressure. Alpha squeeze raises it. Alpha blockade lowers it."], ["hr", "Heart", "g-bad", "Heart rate and force from beta action. Calm only after beta blockade."], ["sw", "Sweating", "g-sweat", "Sweating during a spell, with palpitations and headache."], ["hd", "Headache", "g-head", "Throbbing headache that follows the pressure rise."], ["met", "Metanephrines", "g-met", "Breakdown products in blood and urine. Blockers do not lower them. Removal does."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Adrenal tumour", medulla[0], medulla[1], 140, 100, "Phaeochromocytoma: a tumour of the adrenal medulla that releases adrenaline and noradrenaline in bursts.");
  pill(ox, "Vessel squeeze", 460, VY - 15, 460, 100, "Alpha receptors on the vessel wall tighten it and pressure rises. Alpha blockade relaxes this squeeze.");
  pill(ox, "Heart", heartPort[0], heartPort[1], 895, 150, "Beta receptors speed and strengthen the heartbeat, felt as palpitations. Beta blockade slows it, only after alpha blockade.");
  pill(ox, "Sweat", 880, 336, 860, 300, "Sweating during a spell. Sweat with palpitations and headache points to a catecholamine surge.");
  pill(ox, "Headache", 470, 330, 560, 300, "Throbbing headache during a surge, eased when pressure falls.");
  const ap = pill(ox, "Alpha blockade", 330, VY + 22, 300, 300, "Alpha blockade first. It sits on vessel receptors and relaxes the vessel before any beta blocker or surgery."); ap.setAttribute("id", "phe-alpha-pill");
  const bp2 = pill(ox, "Beta blockade", heartPort[0] - 34, heartPort[1] + 12, 640, 100, "A beta blocker added only after alpha blockade. Given alone it can leave alpha squeeze unopposed and worsen pressure."); bp2.setAttribute("id", "phe-beta-pill");
  capEl = mk("text", { class: "phe-cap", x: 30, y: 424 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { rel: 0.4, alpha: 0.4, betaH: 0.4, bp: 0.5, hr: 0.4, sweat: 0.3, head: 0.3, met: 0.4, ab: 0, bb: 0, surg: 0, sup: 0 };
const acc = { cat: 0, met: 0, sweat: 0, bolus: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.rel = lerp(sm.rel, m.rel, k2); sm.alpha = lerp(sm.alpha, m.alpha, k1); sm.betaH = lerp(sm.betaH, m.betaH, k2);
  sm.bp = lerp(sm.bp, m.bp, k1); sm.hr = lerp(sm.hr, m.hr, k1); sm.sweat = lerp(sm.sweat, m.sweat, k2);
  sm.head = lerp(sm.head, m.head, k2); sm.met = lerp(sm.met, m.met, k2);
  sm.ab = lerp(sm.ab, m.ab, k1); sm.bb = lerp(sm.bb, m.bb, k1); sm.surg = lerp(sm.surg, m.surg, k2); sm.sup = lerp(sm.sup, m.sup, k1);
  const tumS = Math.max(0.1, (1 - 0.88 * sm.surg) * (1 + 0.07 * sm.rel * Math.sin(tm / 280)));
  place(layers.tum, medulla[0], medulla[1], Math.sin(tm / 2400) * 3, tumS);
  layers.tum.style.opacity = (1 - 0.2 * sm.surg).toFixed(2);
  tumCells.forEach(function (c, i) { c.style.opacity = (0.35 + 0.65 * clamp(sm.rel * 1.6) * (0.5 + 0.5 * Math.sin(tm / 240 + i * 1.3))).toFixed(2); });
  place(scarEl, medulla[0], medulla[1], 0, 1);
  layers.scar.setAttribute("opacity", sm.surg.toFixed(2));
  const hh = 9 + 13 * (1 - sm.alpha);
  layers.lumen.setAttribute("y", f1(VY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  wallT.forEach(function (c, i) { place(c, 282 + i * 24, VY - hh - 6 + Math.sin(tm / 700 + i) * 0.7, 0, 1); });
  wallB.forEach(function (c, i) { place(c, 282 + i * 24, VY + hh + 6 + Math.sin(tm / 700 + i + 2) * 0.7, 0, 1); });
  recNubs.forEach(function (r) { r.e.setAttribute("cx", f1(r.x)); r.e.setAttribute("cy", f1(VY + r.side * (hh + 1))); r.e.setAttribute("opacity", (0.35 + 0.65 * sm.alpha).toFixed(2)); });
  abx.forEach(function (p, i) {
    const site = recNubs[i % recNubs.length];
    p.u = (p.u + dt * (0.15 + 0.25 * sm.bp)) % 1;
    const dx = VX0 + p.u * (VX1 - VX0), dy = VY + (i % 2 ? 9 : -9);
    const e = sm.ab * sm.ab;
    const sx = site.x, sy = VY + site.side * (hh + 1) + site.side * 5;
    p.e.setAttribute("transform", "translate(" + f1(lerp(dx, sx, e)) + " " + f1(lerp(dy, sy, e)) + ") rotate(" + f1(Math.sin(tm / 500 + i) * 14) + ")");
    p.e.setAttribute("opacity", sm.ab > 0.03 ? sm.ab.toFixed(2) : "0");
  });
  bbx.forEach(function (p, i) {
    p.u += dt * 0.5;
    const dx = heartO.x + Math.cos(p.u * 2 + i * 1.7) * 62, dy = heartO.y + Math.sin(p.u * 2 + i * 1.7) * 44;
    const sx = heartPort[0] - 34 + (i % 2) * 22, sy = heartPort[1] + 12 + Math.floor(i / 2) * 20;
    const e = sm.bb * sm.bb;
    p.e.setAttribute("transform", "translate(" + f1(lerp(dx, sx, e)) + " " + f1(lerp(dy, sy, e)) + ") rotate(" + f1(Math.sin(tm / 500 + i * 2) * 14) + ")");
    p.e.setAttribute("opacity", sm.bb > 0.03 ? sm.bb.toFixed(2) : "0");
  });
  const beat = 1 + (0.04 + 0.13 * sm.hr) * Math.max(0, Math.sin(tm / (230 - 110 * sm.hr)));
  place(heartO.g, heartO.x, heartO.y, Math.sin(tm / 900) * 2, beat);
  const pulse = Math.max(0, Math.sin(tm / (230 - 110 * sm.hr)));
  rings.forEach(function (r, i) {
    const rr = heartO.w * (0.58 + 0.1 * i) + pulse * 16;
    r.setAttribute("cx", f1(heartO.x)); r.setAttribute("cy", f1(heartO.y));
    r.setAttribute("rx", f1(rr)); r.setAttribute("ry", f1(rr * 0.82));
    r.setAttribute("opacity", (sm.hr * 0.5 * Math.max(0, pulse - i * 0.25)).toFixed(2));
  });
  layers.rays.setAttribute("opacity", (sm.head * (0.55 + 0.45 * Math.sin(tm / 200))).toFixed(2));
  const flow = clamp(0.3 + 0.8 * sm.bp);
  rbcs.forEach(function (r) { r.x += r.v * 62 * flow * dt; if (r.x > VX1 - 4) { r.x = VX0 + 4; r.y = rnd(-0.6, 0.6); } place(r.g, r.x, VY + r.y * Math.max(6, hh - 6), r.rot, 1); });
  acc.cat += dt * sm.rel * 11; while (acc.cat >= 1) { acc.cat--; const p = freeP(cats); if (p) emitP(p, medulla[0], medulla[1], 0, 0); }
  cats.forEach(function (p) { if (!p.on) return; p.u += dt * (0.1 + 0.16 * sm.bp); if (p.u >= 1) { killP(p); return; } const q = catTrk.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 6) + ")"); });
  acc.met += dt * sm.met * 5; while (acc.met >= 1) { acc.met--; const p = freeP(mets); if (p) emitP(p, medulla[0], medulla[1] + 8, 0, 0); }
  mets.forEach(function (p) { if (!p.on) return; p.u += dt * 0.07; if (p.u >= 0.9) { killP(p); return; } const q = catTrk.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y + 8) + ")"); });
  acc.sweat += dt * sm.sweat * 7; while (acc.sweat >= 1) { acc.sweat--; const p = freeP(sweats); if (p) emitP(p, [700, 790, 880][Math.floor(rnd(0, 3))] + rnd(-6, 6), 332, rnd(-3, 3), -rnd(12, 20)); }
  sweats.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 648, 932)) + " " + f1(clamp(p.y, 292, 334)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) killP(p); });
  acc.bolus += dt * sm.sup * 6; while (acc.bolus >= 1) { acc.bolus--; const p = freeP(bolus); if (p) emitP(p, VX0 + 6, VY + rnd(-hh + 8, hh - 8), 80, 0); }
  bolus.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > VX1 - 4) killP(p); });
  const apEl = $("phe-alpha-pill"), bpEl = $("phe-beta-pill");
  if (apEl) apEl.style.opacity = sm.ab.toFixed(2);
  if (bpEl) bpEl.style.opacity = sm.bb.toFixed(2);
  gg.cat.set(sm.rel, wordOf(sm.rel, 0.3, 0.7, ["quiet", "surging", "flooding"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.45, 0.68, ["normal", "raised", "very high"]));
  gg.hr.set(sm.hr, wordOf(sm.hr, 0.4, 0.65, ["calm", "racing", "pounding"]));
  gg.sw.set(sm.sweat, wordOf(sm.sweat, 0.3, 0.6, ["dry", "moist", "drenched"]));
  gg.hd.set(sm.head, wordOf(sm.head, 0.3, 0.6, ["none", "mild", "throbbing"]));
  gg.met.set(sm.met, wordOf(sm.met, 0.3, 0.65, ["normal", "raised", "high"]));
  const key = drug + "-" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
