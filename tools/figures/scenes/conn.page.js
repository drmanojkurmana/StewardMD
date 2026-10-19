/* Primary hyperaldosteronism scene: adrenal adenoma, aldosterone to the collecting duct, sodium in, potassium and hydrogen out, vessel pressure, renin feedback. */
const layers = { adrenal: $("adrenalSlot"), kidney: $("kidneySlot"), tumour: $("tumourG"), duct: $("ductCells"), rbcs: $("rbcs"), renin: $("reninG"), parts: $("parts"), over: $("over"), panel: $("panel"), vessel: $("vesselLumen"), press: $("pressOverlay"), glow: $("ductGlow"), fb: $("fbPath"), aldoV: $("aldoVessel") };
let adrenalO = null, kidneyO = null, capEl = null, capDrug = -1;
let trAldo = null;
const TUM = [152, 190];
/* ---- static animated nodes ---- */
const tumour = cell(layers.tumour, { cls: "conntum", r: 16, nuc: 0.4, seed: 3, wob: 0.12 });
const reninCell = cell(layers.renin, { cls: "connren", r: 27, nuc: 0.42, seed: 5, wob: 0.1 });
const reninDots = [];
for (let i = 0; i < 7; i++) { const d = mk("circle", { class: "sc-p p-na", r: 2.6, cx: Math.cos(i * 1.7) * 13, cy: Math.sin(i * 1.7) * 11 }, layers.renin); reninDots.push(d); }
function initOrgans() {
  adrenalO = organ($("adrenalSlot"), "adrenal", 150, 196, 110, {});
  kidneyO = organ($("kidneySlot"), "kidney", 150, 315, 160, {});
  const AO = adrenalO.ports;
  layers.aldoV.setAttribute("d", "M" + f1(AO.out[0]) + " " + f1(AO.out[1]) + " C" + f1(AO.out[0] + 45) + " " + f1(AO.out[1] - 4) + " 300 208 360 214");
  trAldo = track([AO.out, [AO.out[0] + 40, AO.out[1] - 4], [310, 208], [360, 214], [430, 219], [505, 222]]);
}
function capText(d) {
  if (d === 1) return "Spironolactone sits on the kidney receptor. Salt and water escape, pressure falls, potassium recovers.";
  if (d === 2) return "The adenoma is removed. Aldosterone falls, so pressure, potassium and renin recover.";
  if (d === 3) return "Potassium top up refills potassium only. Pressure and alkalosis stay high.";
  return "No treatment. Aldosterone holds salt and water in, pushes potassium out, and pressure rises.";
}
/* principal cells along the duct, plus parked blockers that sit on the receptors */
const ductCells = [], dockers = [];
function initDuct() {
  for (let i = 0; i < 11; i++) {
    const x = 352 + i * 52;
    const gt = mk("g", { class: "cl cl-connduct" }, layers.duct); mk("ellipse", { class: "cl-b", rx: 24, ry: 10 }, gt); gt.setAttribute("transform", "translate(" + f1(x) + " 190)");
    const gb = mk("g", { class: "cl cl-connduct" }, layers.duct); mk("ellipse", { class: "cl-b", rx: 24, ry: 10 }, gb); gb.setAttribute("transform", "translate(" + f1(x) + " 252)");
    ductCells.push(gt, gb);
    if (i % 2 === 1) { const g = mk("g", { opacity: "0" }, layers.duct); mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); g.setAttribute("transform", "translate(" + f1(x) + " 243)"); dockers.push({ g, x }); }
  }
}
/* red cells inside the vessel */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(335, 915), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const aldo = pool(26, () => mk("path", { class: "sc-p p-aldo", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const nas = pool(24, () => mk("circle", { class: "sc-p p-na", r: 3 }, layers.parts));
const ks = pool(24, () => mk("circle", { class: "sc-p p-k", r: 3.2 }, layers.parts));
const hs = pool(16, () => mk("circle", { class: "sc-p p-h", r: 2.2 }, layers.parts));
const urine = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const blockers = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4.5, y: -2.2, width: 9, height: 4.4, rx: 2.2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.2, width: 4.5, height: 4.4, rx: 2.2 }, g); return g; });
const kplus = pool(14, () => mk("circle", { class: "sc-p p-k", r: 3.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["act", "Aldosterone action", "g-aldo", "How strongly aldosterone is acting on the collecting duct. Spironolactone blocks this action; adrenalectomy removes the source."], ["na", "Sodium in", "g-na", "Sodium reabsorbed from the collecting duct into the blood. Water follows, expanding blood volume."], ["bp", "Pressure", "g-bad", "Blood pressure rises as sodium and water retention expand circulating volume."], ["k", "Potassium", "g-k", "Serum potassium. Aldosterone pushes potassium out into the urine, so the level in blood falls."], ["alk", "Alkalosis", "g-alk", "Hydrogen ions lost in the urine leave the blood alkaline: metabolic alkalosis."], ["ren", "Renin", "g-good", "Renin is suppressed by the high volume and pressure. It recovers when aldosterone action or its source is removed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Adenoma", 152, 190, 250, 84, "A benign lump on the adrenal that makes aldosterone all the time, even when the body has enough salt and water.");
  pill(ox, "Aldosterone", 270, 208, 352, 120, "A hormone that tells the kidney to hold salt and water and to lose potassium and acid.");
  pill(ox, "Kidney", 225, 350, 285, 404, "Blood is filtered here. Its last stretch, the collecting duct, fine tunes salt, water, potassium and acid.");
  pill(ox, "Collecting duct", 610, 195, 615, 158, "The final stretch of kidney tubing. Aldosterone acts here through its receptor on principal cells.");
  pill(ox, "Sodium in", 505, 240, 505, 120, "Sodium moves from the duct into blood. Water follows, so blood volume and pressure rise.");
  pill(ox, "Potassium out", 758, 221, 790, 172, "Potassium moves from blood into the duct and leaves in urine. Blood potassium falls.");
  pill(ox, "Blood vessel", 700, 356, 700, 296, "Extra salt and water swell blood volume here, so pressure rises. Treatment narrows it back.");
  pill(ox, "Renin", 820, 126, 820, 92, "A kidney signal that normally raises aldosterone. High volume switches it off, so renin is low here.");
  capEl = mk("text", { class: "conn-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { src: 0.5, act: 0.5, Na: 0.4, BP: 0.5, K: 0.5, Alk: 0.4, Ren: 0.4, spiro: 0, surg: 0, krepl: 0 };
const acc = { aldo: 0, na: 0, k: 0, h: 0, ur: 0, blk: 0, kp: 0 };
function init() { initOrgans(); initDuct(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.src = lerp(sm.src, m.src, k2); sm.act = lerp(sm.act, m.act, k2); sm.Na = lerp(sm.Na, m.Na, k2); sm.BP = lerp(sm.BP, m.BP, k1); sm.K = lerp(sm.K, m.K, k2); sm.Alk = lerp(sm.Alk, m.Alk, k2); sm.Ren = lerp(sm.Ren, m.Ren, k2); sm.spiro = lerp(sm.spiro, m.spiro, k1); sm.surg = lerp(sm.surg, m.surg, k1); sm.krepl = lerp(sm.krepl, m.krepl, k1);
  /* adenoma grows with source; surgery shrinks it away, leaving the normal gland */
  const tsc = Math.max(0.04, (1 - sm.surg * 0.96) * (0.65 + 0.55 * sm.src));
  place(tumour, TUM[0], TUM[1], Math.sin(tm / 700) * 5, tsc); tumour.style.opacity = tsc < 0.08 ? 0 : 1;
  /* renin cell dulls when suppressed */
  place(reninCell, 820, 132, Math.sin(tm / 900) * 4, 0.75 + 0.3 * sm.Ren); reninCell.style.opacity = (0.4 + 0.6 * sm.Ren).toFixed(2);
  reninDots.forEach((d, i) => { d.setAttribute("transform", "translate(" + f1(820 + Math.sin(tm / 600 + i) * 2) + " " + f1(132 + Math.cos(tm / 700 + i) * 2) + ")"); d.setAttribute("opacity", sm.Ren.toFixed(2)); });
  /* suppression signal from the full vessel to the renin cells fades as pressure falls */
  layers.fb.setAttribute("opacity", (0.1 + 0.65 * sm.BP).toFixed(2));
  /* aldosterone action glow on the duct fades when blocked or removed */
  layers.glow.setAttribute("opacity", (0.06 + 0.42 * sm.act).toFixed(2));
  /* vessel widens with pressure and volume, with a pressure tint over the blood */
  const vh = 24 + 11 * sm.BP, vy0 = 349 - vh;
  layers.vessel.setAttribute("y", f1(vy0)); layers.vessel.setAttribute("height", f1(vh * 2));
  layers.press.setAttribute("y", f1(vy0)); layers.press.setAttribute("height", f1(vh * 2));
  layers.press.setAttribute("opacity", (0.05 + 0.5 * sm.BP).toFixed(2));
  /* aldosterone: adenoma along the vessel to the principal cells */
  acc.aldo += dt * (0.4 + 5.5 * sm.src) * (1 - sm.surg * 0.9); while (acc.aldo >= 1) { acc.aldo--; const p = free(aldo); if (p) emit(p, TUM[0] + rnd(-8, 8), TUM[1] + rnd(-6, 6), 0, 0, 0); }
  aldo.forEach((p) => { if (!p.on) return; p.u += dt * 70 / trAldo.len; const q = trAldo.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.u >= 1) kill(p); });
  /* sodium: duct lumen down into the vessel */
  acc.na += dt * sm.Na * 9; while (acc.na >= 1) { acc.na--; const p = free(nas); if (p) emit(p, rnd(360, 680), 222, rnd(-3, 3), rnd(38, 55), 0); }
  nas.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > vy0 + vh * 2 - 6) kill(p); });
  /* potassium and hydrogen: cell into lumen, then out in urine */
  acc.k += dt * sm.act * 8; while (acc.k >= 1) { acc.k--; const p = free(ks); if (p) emit(p, rnd(360, 680), 268, 0, -46, 0); }
  ks.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y <= 221) p.k = 1; } else { p.x += 105 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 892) kill(p); });
  acc.h += dt * sm.Alk * 6; while (acc.h >= 1) { acc.h--; const p = free(hs); if (p) emit(p, rnd(360, 660), 262, 0, -40, 0); }
  hs.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y <= 224) p.k = 1; } else { p.x += 95 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 892) kill(p); });
  /* urine flow out of the duct */
  acc.ur += dt * (1.5 + 5 * sm.act); while (acc.ur >= 1) { acc.ur--; const p = free(urine); if (p) emit(p, rnd(680, 760), 221, rnd(70, 95), 0, 0); }
  urine.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 894) kill(p); });
  /* spironolactone blockers travel from the vessel and park on the receptors */
  acc.blk += dt * sm.spiro * 3.2; while (acc.blk >= 1) { acc.blk--; const p = free(blockers); if (p) emit(p, rnd(380, 470), 345, 0, 0, 0); }
  blockers.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (540 - p.x) * dt * 1.1; p.y += (252 - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.2) / 1.2).toFixed(2)); if (p.t > 4.4) kill(p); });
  dockers.forEach((d, i) => { d.g.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(243 + Math.sin(tm / 600 + i * 1.3) * 1.5) + ")"); d.g.setAttribute("opacity", sm.spiro.toFixed(2)); });
  /* potassium replacement enters the vessel */
  acc.kp += dt * sm.krepl * 5; while (acc.kp >= 1) { acc.kp--; const p = free(kplus); if (p) emit(p, 338, rnd(338, 360), rnd(65, 85), 0, 0); }
  kplus.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 2.4) / 1.2).toFixed(2)); if (p.t > 3.6 || p.x > 900) kill(p); });
  /* red cells flow faster as pressure recovers */
  const flow = clamp(0.3 + 0.8 * sm.BP);
  rbcs.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > 932) { r.x = 330; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, 349 + r.y * (vh - 9), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  /* gauges */
  gg.act.set(sm.act, wordOf(sm.act, 0.3, 0.62, ["blocked or low", "moderate", "high"])); gg.na.set(sm.Na, wordOf(sm.Na, 0.32, 0.62, ["low", "moderate", "high"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.42, 0.68, ["near normal", "raised", "high"]));
  gg.k.set(sm.K, wordOf(sm.K, 0.38, 0.62, ["low", "borderline", "normal"])); gg.alk.set(sm.Alk, wordOf(sm.Alk, 0.35, 0.65, ["normal", "alkaline", "very alkaline"])); gg.ren.set(sm.Ren, wordOf(sm.Ren, 0.35, 0.62, ["suppressed", "low", "recovered"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
