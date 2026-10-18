/* Rickets scene: sunlight and diet, liver and kidney activation, gut absorption, PTH, growth plate, rosary, bowed legs and gauges. */
const layers = { sun: $("sunG"), nodes: $("nodes"), bone: $("boneG"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), vessel: $("vessel"), gland: $("glandG"), act: $("actnode"), gp: $("gpBand"), seam: $("osteoidSeam"), shaft: $("boneShaft"), rosary: $("rosary"), legL: $("legL"), legR: $("legR") };
const beads = layers.rosary.querySelectorAll(".rk-bead");
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
const supP = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4.4, y: -2.2, width: 8.8, height: 4.4, rx: 2.2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.2, width: 4.4, height: 4.4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.tx = tx; p.ty = ty; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function seek(pl, speed, onArrive) { pl.forEach((p) => { if (!p.on) return; p.t += 0.016; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * 0.016; p.y += (dy / d) * speed * 0.016; p.x = clamp(p.x, 22, 938); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 10) onArrive(p); }); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Blood and bone";
  [["vitd", "Vitamin D", "g-act", "Active vitamin D made after liver and kidney steps. It drives gut calcium and phosphate absorption."], ["ca", "Calcium", "g-ca2", "Blood calcium absorbed from the gut. Low calcium raises parathyroid hormone."], ["po4", "Phosphate", "g-po4", "Blood phosphate absorbed from the gut and needed with calcium to mineralise new bone."], ["pth", "PTH", "g-pth", "Parathyroid hormone. It rises when calcium is low."], ["min", "Mineralisation", "g-min", "How well new growth plate cartilage and osteoid harden with calcium and phosphate. Poor mineralisation is rickets in children and osteomalacia in adults."], ["def", "Deformity", "g-bad", "Bending of soft growing bone under load, shown as bowed legs and swollen rib ends."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Sunlight", 95, 105, 95, 115, "Sunlight on skin makes vitamin D. The sunlight treatment raises this supply.");
  pill(ox, "Skin", 95, 178, 95, 208, "Skin, where sunlight makes vitamin D.");
  pill(ox, "Liver", 243, 176, 243, 208, "Liver, the first activation step for vitamin D from skin and diet.");
  pill(ox, "Kidney", 382, 190, 382, 208, "Kidney, the second activation step that makes active vitamin D.");
  pill(ox, "Active D", 532, 168, 532, 208, "Active vitamin D. It lets the gut absorb calcium and phosphate.");
  pill(ox, "Diet", 100, 300, 100, 330, "Diet, the other source of vitamin D, and the source of calcium and phosphate.");
  pill(ox, "Gut", 240, 306, 240, 330, "Gut. Active vitamin D drives calcium and phosphate absorption here.");
  pill(ox, "Calcium", 450, 292, 450, 330, "Calcium in the blood, absorbed from the gut. Low calcium stimulates the parathyroid gland.");
  pill(ox, "Parathyroid", 532, 288, 560, 330, "Parathyroid gland. It releases parathyroid hormone when calcium is low.");
  pill(ox, "Growth plate", 717, 182, 835, 100, "Growth plate in a growing long bone. New cartilage that fails to mineralise widens and weakens in rickets.");
  pill(ox, "Rosary", 862, 180, 835, 215, "Rachitic rosary: swollen rib ends where cartilage fails to mineralise, felt as beads along the chest.");
  pill(ox, "Osteoid", 737, 230, 835, 260, "Osteoid: new unmineralised bone matrix. In osteomalacia and rickets it stays soft because mineralisation fails.");
  pill(ox, "Bowed legs", 800, 370, 870, 360, "Bowed legs: soft growing leg bones bend under body weight when mineralisation is poor.");
  const sg = pill(ox, "Surgery", 796, 392, 870, 395, "Surgery for deformity can straighten a fixed bend. It does not by itself restore vitamin D or mineralisation."); sg.setAttribute("id", "surg-pill");
  const sp = pill(ox, "Supplement", 138, 285, 120, 375, "Vitamin D and calcium treatment, taken in and absorbed at the gut."); sp.setAttribute("id", "supp-pill");
}
const sm = { vitD: 0.3, ca: 0.3, phos: 0.3, pth: 0.6, mineral: 0.3, deform: 0.6, vitRx: 0, sunRx: 0, surg: 0 };
const acc = { sun: 0, pre: 0, act: 0, ca: 0, po: 0, pth: 0, sup: 0 };
function init() { initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.1);
  sm.vitD = lerp(sm.vitD, m.vitD, k); sm.ca = lerp(sm.ca, m.ca, k); sm.phos = lerp(sm.phos, m.phos, k); sm.pth = lerp(sm.pth, m.pth, k); sm.mineral = lerp(sm.mineral, m.mineral, k); sm.deform = lerp(sm.deform, m.deform, k); sm.vitRx = lerp(sm.vitRx, m.vitRx, k); sm.sunRx = lerp(sm.sunRx, m.sunRx, k); sm.surg = lerp(sm.surg, m.surg, k);
  /* sun, active node, gland */
  const sunI = 0.45 + 0.55 * sm.sunRx;
  layers.sun.setAttribute("opacity", sunI.toFixed(2));
  layers.sun.setAttribute("transform", "translate(" + f1(95 * (1 - (0.96 + 0.07 * sunI))) + " " + f1(90 * (1 - (0.96 + 0.07 * sunI))) + ") scale(" + (0.96 + 0.07 * sunI).toFixed(3) + ")");
  layers.act.setAttribute("r", f1(7 + 8 * sm.vitD));
  const gs = 0.84 + 0.34 * sm.pth;
  layers.gland.setAttribute("transform", "translate(" + f1(532 * (1 - gs)) + " " + f1(270 * (1 - gs)) + ") scale(" + gs.toFixed(3) + ")");
  $("surg-pill").style.opacity = sm.surg.toFixed(2); $("supp-pill").style.opacity = sm.vitRx.toFixed(2);
  /* bone: growth plate widens, osteoid seam thickens, mineral fades, beads and bowing grow */
  const gpH = 8 + (1 - sm.mineral) * 22;
  layers.gp.setAttribute("height", f1(gpH)); layers.gp.setAttribute("y", f1(182 - gpH / 2)); layers.gp.setAttribute("opacity", (0.45 + 0.55 * (1 - sm.mineral)).toFixed(2));
  layers.seam.setAttribute("width", f1(4 + (1 - sm.mineral) * 12));
  layers.shaft.setAttribute("opacity", (0.45 + 0.55 * sm.mineral).toFixed(2));
  layers.rosary.setAttribute("opacity", (0.35 + 0.65 * sm.deform).toFixed(2));
  beads.forEach((b, i) => b.setAttribute("r", f1(2.4 + sm.deform * 3.2)));
  const bow = sm.deform * 26;
  layers.legL.setAttribute("d", "M742 322 C" + f1(742 - bow) + " 356 " + f1(738 - bow) + " 386 744 416");
  layers.legR.setAttribute("d", "M798 322 C" + f1(798 + bow) + " 356 " + f1(802 + bow) + " 386 796 416");
  /* red cells flow in the vessel */
  rbcs.forEach((r) => { r.x += r.v * 42 * dt; if (r.x > 604) { r.x = 398; r.y = rnd(-11, 11); } place(r.g, r.x, 272 + r.y, 0, 1); });
  /* sunlight to skin */
  acc.sun += dt * (1 + 7 * sunI); while (acc.sun >= 1) { acc.sun--; const p = free(sunP); if (p) emit(p, 95 + rnd(-10, 10), 108, 95 + rnd(-16, 16), 136, 0); }
  seek(sunP, 52, (p) => kill(p));
  /* precursor: skin to liver to kidney */
  acc.pre += dt * (2 + 5 * Math.max(sm.sunRx, sm.vitRx, 0.35)); while (acc.pre >= 1) { acc.pre--; const p = free(preP); if (p) emit(p, 148, 155, 200, 150, 0); }
  seek(preP, 72, (p) => { if (p.k === 0) { p.k = 1; p.tx = 340; p.ty = 155; p.t = 0; } else kill(p); });
  /* active vitamin D: kidney to gut */
  acc.act += dt * (1 + 7 * sm.vitD); while (acc.act >= 1) { acc.act--; const p = free(actP); if (p) emit(p, 414, 168, 262, 248, 0); }
  seek(actP, 78, (p) => kill(p));
  /* calcium and phosphate: gut to blood, then toward bone */
  acc.ca += dt * (1 + 8 * m.gut); while (acc.ca >= 1) { acc.ca--; const p = free(caP); if (p) emit(p, 268, 272, 410, 272, 0); }
  seek(caP, 82, (p) => { if (p.k === 0) { p.k = 1; p.tx = 636; p.ty = 272; p.t = 0; } else kill(p); });
  acc.po += dt * (1 + 7 * m.gut); while (acc.po >= 1) { acc.po--; const p = free(poP); if (p) emit(p, 262, 284, 410, 284, 0); }
  seek(poP, 74, (p) => { if (p.k === 0) { p.k = 1; p.tx = 636; p.ty = 280; p.t = 0; } else kill(p); });
  /* PTH: gland to growth plate */
  acc.pth += dt * (1 + 9 * sm.pth); while (acc.pth >= 1) { acc.pth--; const p = free(pthP); if (p) emit(p, 540, 258, 706, 188, 0); }
  seek(pthP, 84, (p) => kill(p));
  /* supplement capsules: diet to gut */
  acc.sup += dt * sm.vitRx * 5; while (acc.sup >= 1) { acc.sup--; const p = free(supP); if (p) emit(p, 132, 282, 214, 276, 0); }
  seek(supP, 62, (p) => kill(p));
  /* gauges */
  gg.vitd.set(sm.vitD, wordOf(sm.vitD, 0.34, 0.66, ["low", "reduced", "normal"])); gg.ca.set(sm.ca, wordOf(sm.ca, 0.36, 0.62, ["low", "reduced", "normal"])); gg.po4.set(sm.phos, wordOf(sm.phos, 0.34, 0.62, ["low", "reduced", "normal"]));
  gg.pth.set(sm.pth, wordOf(sm.pth, 0.38, 0.64, ["normal", "raised", "high"])); gg.min.set(sm.mineral, wordOf(sm.mineral, 0.36, 0.64, ["poor", "reduced", "good"])); gg.def.set(sm.deform, wordOf(sm.deform, 0.3, 0.62, ["mild", "moderate", "severe"]));
}
run({ init, step });
