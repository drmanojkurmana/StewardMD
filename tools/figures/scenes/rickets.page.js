/* Rickets scene: sunlight to skin, liver and kidney activation, gut absorption, PTH, growing bone. */
const layers = { sun: $("sunG"), bone: $("boneG"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), vessel: $("vessel"), caWash: $("caWash"), gland: $("glandG"), act: $("actnode"), gp: $("gpBand"), seam: $("osteoidSeam"), shaft: $("boneShaft"), wash: $("minWash"), rosary: $("rosary"), legL: $("legL"), legR: $("legR"), fix: $("fixG") };
const beads = layers.rosary.querySelectorAll(".rk-bead");
let skinO = null, liverO = null, kidneyO = null, gutO = null, capEl = null, capDrug = -1;
let P = {};
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 168, 158, 110, {});
  liverO = organ($("liverSlot"), "liver", 318, 158, 150, {});
  kidneyO = organ($("kidneySlot"), "kidney", 462, 158, 100, {});
  gutO = organ($("gutSlot"), "bowel", 240, 292, 175, {});
  const SP = skinO.ports, LP = liverO.ports, KP = kidneyO.ports, GP = gutO.ports;
  const actX = Math.round(kidneyO.x + kidneyO.w * 0.45), actY = Math.round(kidneyO.y);
  layers.act.setAttribute("cx", actX); layers.act.setAttribute("cy", actY);
  P = {
    skinTop: [skinO.x, Math.round(skinO.y - skinO.h / 2 + 8)],
    skinOut: SP.out || [skinO.x, skinO.y],
    liverIn: LP.porta || LP.in,
    kidneyIn: KP.in || [kidneyO.x, kidneyO.y],
    actSrc: [actX, actY],
    gutIn: GP.coils || GP.in,
    gutOut: GP.out || [gutO.x, gutO.y],
    vesselL: [398, 272], vesselR: [604, 272],
    bone: [700, 180], plate: [714, 182], gland: [600, 300]
  };
}
function capText(d) {
  if (d === 1) return "Vitamin D and calcium restore gut absorption. Bone hardens and legs straighten.";
  if (d === 2) return "Sunlight on skin makes more vitamin D. Absorption and hardening partly recover.";
  if (d === 3) return "Surgery straightens the legs. It does not restore vitamin D or hardening.";
  return "No treatment. Little calcium reaches bone, so bone stays soft and legs bow.";
}
/* ---- red cells in the blood vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(398, 604), y: rnd(-11, 11), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, t: 0, k: 0 }; }); }
const sunP = pool(14, () => mk("circle", { class: "sc-p p-vit", r: 2.4 }, layers.parts));
const preP = pool(26, () => mk("circle", { class: "sc-p p-vit", r: 2.8 }, layers.parts));
const actP = pool(20, () => mk("circle", { class: "sc-p p-act", r: 2.8 }, layers.parts));
const caP = pool(24, () => mk("circle", { class: "sc-p p-ca2", r: 2.8 }, layers.parts));
const poP = pool(20, () => mk("rect", { class: "sc-p p-po4", x: -2.8, y: -2.8, width: 5.6, height: 5.6, rx: 1 }, layers.parts));
const pthP = pool(22, () => mk("path", { class: "sc-p p-pth", d: "M0 -3.8L3.8 0L0 3.8L-3.8 0Z" }, layers.parts));
const supP = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "rk-sup", x: -4.4, y: -2.2, width: 8.8, height: 4.4, rx: 2.2 }, g); mk("rect", { class: "rk-sup2", x: 0, y: -2.2, width: 4.4, height: 4.4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.tx = tx; p.ty = ty; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function seek(pl, speed, onArrive) { pl.forEach((p) => { if (!p.on) return; p.t += 0.016; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * 0.016; p.y += (dy / d) * speed * 0.016; p.x = clamp(p.x, 22, 938); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 10) onArrive(p); }); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P0 = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P0);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P0); t.textContent = "Blood and bone";
  [["vitd", "Vitamin D", "g-act", "Active vitamin D made after liver and kidney steps. It drives gut calcium and phosphate absorption."], ["ca", "Calcium", "g-ca2", "Blood calcium absorbed from the gut. Low calcium raises parathyroid hormone."], ["po4", "Phosphate", "g-po4", "Blood phosphate absorbed from the gut and needed with calcium to mineralise new bone."], ["pth", "PTH", "g-pth", "Parathyroid hormone. It rises when calcium is low."], ["min", "Mineralisation", "g-min", "How well new growth plate cartilage and osteoid harden with calcium and phosphate. Poor mineralisation is rickets in children and osteomalacia in adults."], ["def", "Deformity", "g-bad", "Bending of soft growing bone under load, shown as bowed legs and swollen rib ends."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P0, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Sunlight", 72, 100, 72, 126, "Sunlight on skin makes vitamin D. The sunlight treatment raises this supply.");
  pill(ox, "Skin", 168, 140, 168, 62, "Skin, where sunlight makes vitamin D.");
  pill(ox, "Liver", 318, 150, 318, 62, "Liver, the first activation step for vitamin D from skin and diet.");
  pill(ox, "Kidney", 462, 150, 462, 62, "Kidney, the second activation step that makes active vitamin D.");
  pill(ox, "Gut", 240, 340, 240, 378, "Gut. Active vitamin D drives calcium and phosphate absorption here.");
  pill(ox, "Blood", 501, 272, 501, 378, "Blood calcium and phosphate absorbed from the gut. Low calcium raises PTH.");
  pill(ox, "PTH", 600, 312, 610, 378, "Parathyroid gland. It releases PTH when calcium is low.");
  pill(ox, "Bone", 770, 322, 800, 404, "Growing bone. Poor mineralisation widens the growth plate, swells rib ends and bows the legs.");
  capEl = mk("text", { class: "rk-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { vitD: 0.3, ca: 0.3, phos: 0.3, pth: 0.6, mineral: 0.3, deform: 0.6, vitRx: 0, sunRx: 0, surg: 0 };
const acc = { sun: 0, pre: 0, act: 0, ca: 0, po: 0, pth: 0, sup: 0 };
function init() { initOrgans(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.1);
  sm.vitD = lerp(sm.vitD, m.vitD, k); sm.ca = lerp(sm.ca, m.ca, k); sm.phos = lerp(sm.phos, m.phos, k); sm.pth = lerp(sm.pth, m.pth, k); sm.mineral = lerp(sm.mineral, m.mineral, k); sm.deform = lerp(sm.deform, m.deform, k); sm.vitRx = lerp(sm.vitRx, m.vitRx, k); sm.sunRx = lerp(sm.sunRx, m.sunRx, k); sm.surg = lerp(sm.surg, m.surg, k);
  /* sun, active node, gland, blood richness, bone mineral wash, fixation plates */
  const sunI = 0.45 + 0.55 * sm.sunRx;
  layers.sun.setAttribute("opacity", sunI.toFixed(2));
  layers.sun.setAttribute("transform", "translate(" + f1(72 * (1 - (0.96 + 0.07 * sunI))) + " " + f1(92 * (1 - (0.96 + 0.07 * sunI))) + ") scale(" + (0.96 + 0.07 * sunI).toFixed(3) + ")");
  layers.act.setAttribute("r", f1(7 + 8 * sm.vitD));
  const gs = 0.84 + 0.34 * sm.pth;
  layers.gland.setAttribute("transform", "translate(" + f1(600 * (1 - gs)) + " " + f1(312 * (1 - gs)) + ") scale(" + gs.toFixed(3) + ")");
  layers.caWash.setAttribute("opacity", (0.08 + 0.55 * sm.ca).toFixed(2));
  layers.wash.setAttribute("opacity", (0.06 + 0.34 * sm.mineral).toFixed(2));
  layers.fix.setAttribute("opacity", sm.surg.toFixed(2));
  /* bone: growth plate widens, osteoid seam thickens, mineral fades, beads and bowing grow */
  const gpH = 8 + (1 - sm.mineral) * 22;
  layers.gp.setAttribute("height", f1(gpH)); layers.gp.setAttribute("y", f1(182 - gpH / 2)); layers.gp.setAttribute("opacity", (0.45 + 0.55 * (1 - sm.mineral)).toFixed(2));
  layers.seam.setAttribute("width", f1(4 + (1 - sm.mineral) * 12));
  layers.shaft.setAttribute("opacity", (0.45 + 0.55 * sm.mineral).toFixed(2));
  layers.rosary.setAttribute("opacity", (0.35 + 0.65 * sm.deform).toFixed(2));
  beads.forEach((b) => b.setAttribute("r", f1(2.4 + sm.deform * 3.2)));
  const bow = sm.deform * 26;
  layers.legL.setAttribute("d", "M742 322 C" + f1(742 - bow) + " 356 " + f1(738 - bow) + " 386 744 416");
  layers.legR.setAttribute("d", "M798 322 C" + f1(798 + bow) + " 356 " + f1(802 + bow) + " 386 796 416");
  /* red cells flow in the vessel */
  rbcs.forEach((r) => { r.x += r.v * 42 * dt; if (r.x > 604) { r.x = 398; r.y = rnd(-11, 11); } place(r.g, r.x, 272 + r.y, 0, 1); });
  /* sunlight to skin */
  acc.sun += dt * (1 + 7 * sunI); while (acc.sun >= 1) { acc.sun--; const p = free(sunP); if (p) emit(p, 72 + rnd(-10, 10), 108, P.skinTop[0] + rnd(-16, 16), P.skinTop[1], 0); }
  seek(sunP, 52, (p) => kill(p));
  /* precursor: skin to liver to kidney, joined at real organ ports */
  acc.pre += dt * (2 + 5 * Math.max(sm.sunRx, sm.vitRx, 0.35)); while (acc.pre >= 1) { acc.pre--; const p = free(preP); if (p) emit(p, P.skinOut[0], P.skinOut[1], P.liverIn[0], P.liverIn[1], 0); }
  seek(preP, 72, (p) => { if (p.k === 0) { p.k = 1; p.tx = P.kidneyIn[0]; p.ty = P.kidneyIn[1]; p.t = 0; } else kill(p); });
  /* active vitamin D: kidney to gut */
  acc.act += dt * (1 + 7 * sm.vitD); while (acc.act >= 1) { acc.act--; const p = free(actP); if (p) emit(p, P.actSrc[0], P.actSrc[1], P.gutIn[0], P.gutIn[1], 0); }
  seek(actP, 78, (p) => kill(p));
  /* calcium and phosphate: gut to blood, then toward bone */
  acc.ca += dt * (1 + 8 * m.gut); while (acc.ca >= 1) { acc.ca--; const p = free(caP); if (p) emit(p, P.gutOut[0], P.gutOut[1], P.vesselL[0], P.vesselL[1], 0); }
  seek(caP, 82, (p) => { if (p.k === 0) { p.k = 1; p.tx = P.vesselR[0]; p.ty = P.vesselR[1]; p.t = 0; } else if (p.k === 1) { p.k = 2; p.tx = P.bone[0]; p.ty = P.bone[1]; p.t = 0; } else kill(p); });
  acc.po += dt * (1 + 7 * m.gut); while (acc.po >= 1) { acc.po--; const p = free(poP); if (p) emit(p, P.gutOut[0], P.gutOut[1] + 8, P.vesselL[0], P.vesselL[1] + 8, 0); }
  seek(poP, 74, (p) => { if (p.k === 0) { p.k = 1; p.tx = P.vesselR[0]; p.ty = P.vesselR[1] + 8; p.t = 0; } else if (p.k === 1) { p.k = 2; p.tx = P.bone[0]; p.ty = P.bone[1] + 8; p.t = 0; } else kill(p); });
  /* PTH: gland to growth plate */
  acc.pth += dt * (1 + 9 * sm.pth); while (acc.pth >= 1) { acc.pth--; const p = free(pthP); if (p) emit(p, P.gland[0], P.gland[1] - 12, P.plate[0], P.plate[1], 0); }
  seek(pthP, 84, (p) => kill(p));
  /* supplement capsules: arrive at the gut when vitamin D and calcium are given */
  acc.sup += dt * sm.vitRx * 5; while (acc.sup >= 1) { acc.sup--; const p = free(supP); if (p) emit(p, P.gutIn[0] - 90, P.gutIn[1] - 40, P.gutIn[0], P.gutIn[1], 0); }
  seek(supP, 62, (p) => kill(p));
  /* gauges */
  gg.vitd.set(sm.vitD, wordOf(sm.vitD, 0.34, 0.66, ["low", "reduced", "normal"])); gg.ca.set(sm.ca, wordOf(sm.ca, 0.36, 0.62, ["low", "reduced", "normal"])); gg.po4.set(sm.phos, wordOf(sm.phos, 0.34, 0.62, ["low", "reduced", "normal"]));
  gg.pth.set(sm.pth, wordOf(sm.pth, 0.38, 0.64, ["normal", "raised", "high"])); gg.min.set(sm.mineral, wordOf(sm.mineral, 0.36, 0.64, ["poor", "reduced", "good"])); gg.def.set(sm.deform, wordOf(sm.deform, 0.3, 0.62, ["mild", "moderate", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
