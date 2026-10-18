/* Iron deficiency scene: duodenal absorption, transferrin transport, ferritin store, marrow output, red cell preview and gauges. */
const WW = SC.W;
const layers = { gut: $("gut"), vess: $("vess"), store: $("store"), marrow: $("marrow"), causes: $("causes"), preview: $("preview"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = { fer: [], prv: [], zzz: null };
/* ---- static shapes ---- */
function initShapes() {
  mk("path", { class: "id-gut", d: "M75 125H175Q205 125 205 155V185Q205 215 175 215H85" }, layers.gut);
  mk("path", { class: "id-gutIn", d: "M75 125H175Q205 125 205 155V185Q205 215 175 215H85" }, layers.gut);
  for (let x = 92; x <= 188; x += 16) mk("path", { class: "id-villus", d: "M" + x + " 118v10" }, layers.gut);
  for (let y = 140; y <= 200; y += 15) mk("path", { class: "id-villus", d: "M198 " + y + "h-9" }, layers.gut);
  mk("rect", { class: "id-vess", x: 320, y: 140, width: 310, height: 60, rx: 30 }, layers.vess);
  mk("rect", { class: "id-box", x: 330, y: 300, width: 290, height: 120, rx: 12 }, layers.store);
  mk("rect", { class: "id-box", x: 342, y: 312, width: 266, height: 96, rx: 8 }, layers.store);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) { const d = mk("circle", { class: "id-ferr", cx: 368 + c * 31, cy: 336 + r * 30, r: 8 }, layers.store); E.fer.push(d); }
  mk("ellipse", { class: "id-bone", cx: 800, cy: 175, rx: 110, ry: 72 }, layers.marrow);
  mk("ellipse", { class: "id-marrowIn", cx: 800, cy: 175, rx: 72, ry: 40 }, layers.marrow);
  mk("rect", { class: "id-box", x: 30, y: 300, width: 260, height: 120, rx: 12 }, layers.causes);
  mk("path", { class: "p-leak", d: "M50 318C55 326 57 330 57 334A7 7 0 0 1 43 334C43 330 45 326 50 318Z" }, layers.causes);
  mk("circle", { class: "id-box", cx: 50, cy: 365, r: 10 }, layers.causes);
  mk("path", { class: "id-villus", d: "M41 356H59M41 365H59M41 374H59" }, layers.causes);
  mk("rect", { class: "id-box", x: 40, y: 392, width: 20, height: 14, rx: 4 }, layers.causes);
  mk("path", { class: "id-villus", d: "M44 392L56 406M56 392L44 406" }, layers.causes);
  [["Blood loss", 338], ["Poor intake", 369], ["Malabsorption", 400]].forEach(([txt, y]) => { const t = mk("text", { class: "id-causeT", x: 72, y }, layers.causes); t.textContent = txt; });
  mk("rect", { class: "id-box", x: 650, y: 285, width: 280, height: 140, rx: 12 }, layers.preview);
  [[700, 355], [762, 355], [818, 355]].forEach(([x, y]) => { const g = mk("g", { class: "cl cl-rbc" }, layers.preview); const bodyEl = mk("ellipse", { class: "cl-b", rx: 21, ry: 12.5 }, g); const cen = mk("ellipse", { class: "cl-s", rx: 7, ry: 4 }, g); g.setAttribute("transform", "translate(" + x + " " + y + ")"); E.prv.push({ g, cen, x, y }); });
  const pg = mk("g", {}, layers.preview);
  mk("circle", { class: "id-person", cx: 890, cy: 338, r: 9 }, pg);
  mk("path", { class: "id-person", d: "M890 347V374M890 357L879 367M890 357L901 367M890 374L881 397M890 374L899 397" }, pg);
  E.zzz = mk("text", { class: "id-zzz", x: 904, y: 326, opacity: "0" }, pg); E.zzz.textContent = "z z";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const foodP = pool(10, () => mk("circle", { class: "sc-p p-iron", r: 2.6 }, layers.parts));
const absP = pool(12, () => mk("circle", { class: "sc-p p-iron", r: 2.4 }, layers.parts));
const capP = pool(6, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-caps", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-caps2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });
const ivP = pool(10, () => mk("circle", { class: "sc-p p-iron", r: 2.6 }, layers.parts));
const leakP = pool(8, () => mk("path", { class: "p-leak", d: "M0 -4C2 -1 3 1 3 2.4A3 3 0 0 1 -3 2.4C-3 1 -2 -1 0 -4Z" }, layers.parts));
const relP = pool(8, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); return g; });
const transP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-trans", r: 3.4 }, g); mk("circle", { class: "sc-p p-iron", r: 1.5, cx: 0, cy: -1 }, g); return g; });
transP.forEach((p, i) => { p.u = i / transP.length; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* vessel red cells */
const vrbc = [];
function initVesselCells() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vess); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); vrbc.push({ g, x: rnd(330, 620), y: [156, 170, 184][i % 3], v: rnd(0.8, 1.2) }); } }
/* ---- labels and gauges ---- */
const gg = {};
const rxPills = {};
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["stores", "Stores", "g-ferr", "Ferritin stores: spare iron held as ferritin. They empty first, while haemoglobin is still normal."],
    ["tf", "Blood iron", "g-trans", "Iron carried in blood by transferrin to the marrow. It falls when stores are empty and the marrow is short of iron."],
    ["hb", "Haemoglobin", "g-good", "Haemoglobin in red cells. It falls late, only after stores are empty and red cell making has been short of iron. That fall is anaemia."],
    ["size", "Cell size", "g-iron", "Red cell size. Cells made without enough iron are small (microcytic)."],
    ["colour", "Cell colour", "g-ferr", "Red cell colour. Cells made without enough iron carry less haemoglobin and look pale (hypochromic)."],
    ["sympt", "Symptoms", "g-bad", "Tiredness, pallor and breathlessness on effort follow the low haemoglobin. They ease as haemoglobin recovers."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Food iron", 95, 116, 95, 92, "Iron in food arrives in the duodenum. Haem iron from meat is absorbed more easily than non-haem iron from plants.");
  pill(ox, "Absorption", 208, 158, 235, 92, "Absorption happens mainly in the duodenum. It rises when stores are empty and falls when the body has enough iron.");
  pill(ox, "Transferrin", 475, 140, 475, 115, "Transferrin is the transport protein that carries iron in blood from the gut and stores to the bone marrow.");
  pill(ox, "Ferritin store", 475, 300, 475, 282, "Ferritin is the storage form of iron, held mainly in the liver and marrow. The store empties before haemoglobin falls.");
  pill(ox, "Marrow", 800, 108, 800, 82, "Bone marrow, where new red cells are made. It needs iron from transferrin to build haem for haemoglobin.");
  pill(ox, "Red cells", 770, 292, 770, 268, "New red cells in close up. Without enough iron they are made small and pale, with less haemoglobin in each cell.");
  pill(ox, "Symptoms", 890, 338, 882, 268, "Tiredness, pallor and breathlessness on effort. They follow the anaemia and ease as haemoglobin recovers.");
  pill(ox, "Causes", 160, 300, 160, 282, "Causes: chronic blood loss, poor intake and malabsorption. Iron leaves or never enters faster than the duodenum can absorb it.");
  rxPills.oral = pill(ox, "Oral iron", 150, 100, 150, 55, "Oral iron is taken by mouth and absorbed through the duodenum. It refills the store slowly.");
  rxPills.iv = pill(ox, "IV iron", 475, 200, 475, 228, "IV iron goes straight into the blood and bypasses the gut, so it refills stores even when absorption fails.");
  rxPills.causeRx = pill(ox, "Treat cause", 160, 418, 160, 432, "Treating the cause stops further blood loss or fixes intake and absorption. On its own it does not quickly replace iron already lost.");
}
const tfTrack = track([[215, 165], [320, 170], [480, 170], [625, 170], [705, 175]]);
const sm = { s: 1, oral: 0, iv: 0, causeRx: 0, Stores: 0, Tf: 0.26, Hb: 0.27, Size: 0.42, Colour: 0.33, Sympt: 0.7, Abs: 0.85, Leak: 0.85 };
const KEYS = Object.keys(sm);
const acc = { food: 0, abs: 0, cap: 0, iv: 0, leak: 0, rel: 0 };
function init() { initShapes(); initVesselCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  /* ferritin store fill */
  const ferWant = Math.round(sm.Stores * E.fer.length);
  E.fer.forEach((d, i) => { d.style.opacity = i < ferWant ? "1" : "0.10"; });
  /* red cell preview: size and pallor follow the model */
  E.prv.forEach((p) => { place(p.g, p.x, p.y, 0, 0.55 + 0.55 * sm.Size); p.cen.setAttribute("rx", f1(3 + 8 * (1 - sm.Colour))); p.cen.setAttribute("ry", f1(1.6 + 4 * (1 - sm.Colour))); });
  if (E.zzz) E.zzz.setAttribute("opacity", (sm.Sympt * 0.9).toFixed(2));
  /* food iron moving through the duodenum lumen */
  acc.food += dt * (2 + sm.oral * 3); while (acc.food >= 1) { acc.food--; const p = free(foodP); if (p) emit(p, 78, 125, rnd(22, 30), 0); }
  foodP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; if (p.x > 192) { p.x = 198; p.y += 22 * dt; if (p.y > 208) kill(p); } p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 70, 215)) + " " + f1(clamp(p.y, 112, 222)) + ")"); });
  /* absorbed iron crossing from gut to blood */
  acc.abs += dt * (1 + sm.Abs * 3 + sm.oral * 2.5); while (acc.abs >= 1) { acc.abs--; const p = free(absP); if (p) emit(p, 214, 165, rnd(34, 46), rnd(-3, 3)); }
  absP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 208, 322)) + " " + f1(clamp(p.y, 148, 188)) + ")"); if (p.x > 318) kill(p); });
  /* transferrin carriers riding gut to marrow */
  const tfWant = Math.round(sm.Tf * transP.length);
  transP.forEach((p, i) => { const on = i < tfWant; p.e.setAttribute("opacity", on ? "1" : "0"); if (!on) return; p.u += dt * 0.055 * (0.5 + sm.Tf); if (p.u > 1) p.u -= 1; const q = tfTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(clamp(q.x, 210, 720)) + " " + f1(clamp(q.y, 130, 200)) + ")"); });
  /* vessel red cells flow */
  vrbc.forEach((r) => { r.x += r.v * 42 * dt * (0.5 + sm.Hb * 0.6); if (r.x > 624) r.x = 328; place(r.g, r.x, r.y, 0, 0.6 + 0.5 * sm.Size); });
  /* marrow releases new red cells down to the preview */
  acc.rel += dt * (0.6 + sm.Hb * 2.4); while (acc.rel >= 1) { acc.rel--; const p = free(relP); if (p) emit(p, 790 + rnd(-24, 24), 248, rnd(-16, 16), rnd(26, 36)); }
  relP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 660, 920)) + " " + f1(clamp(p.y, 240, 336)) + ") scale(" + (0.7 + 0.5 * sm.Size).toFixed(2) + ")"); if (p.y > 332) kill(p); });
  /* oral iron capsules dropping into the duodenum */
  acc.cap += dt * sm.oral * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(capP); if (p) emit(p, 140 + rnd(-14, 14), 64, 0, 38); }
  capP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 60, 220)) + " " + f1(clamp(p.y, 58, 128)) + ") rotate(" + f1(p.t * 80) + ")"); if (p.y > 124) kill(p); });
  /* IV iron dots appearing directly in the blood */
  acc.iv += dt * sm.iv * 5; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, rnd(360, 600), rnd(152, 188), rnd(-8, 8), rnd(-6, 6)); }
  ivP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 326, 624)) + " " + f1(clamp(p.y, 146, 194)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3) kill(p); });
  /* blood loss leak from the causes box, stopped when the cause is treated */
  acc.leak += dt * sm.Leak * 2.6; while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) emit(p, 50 + rnd(-4, 4), 342, 0, rnd(22, 30)); }
  leakP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 36, 70)) + " " + f1(clamp(p.y, 338, 414)) + ")"); if (p.y > 412) kill(p); });
  /* treatment pills */
  setVis(rxPills.oral, clamp(sm.oral)); setVis(rxPills.iv, clamp(sm.iv)); setVis(rxPills.causeRx, clamp(sm.causeRx));
  /* gauges */
  gg.stores.set(sm.Stores, wordOf(sm.Stores, 0.35, 0.72, ["empty", "low", "replete"]));
  gg.tf.set(sm.Tf, wordOf(sm.Tf, 0.3, 0.6, ["low", "reduced", "normal"]));
  gg.hb.set(sm.Hb, wordOf(sm.Hb, 0.45, 0.78, ["low", "reduced", "normal"]));
  gg.size.set(sm.Size, wordOf(sm.Size, 0.65, 0.85, ["small", "smaller", "normal"]));
  gg.colour.set(sm.Colour, wordOf(sm.Colour, 0.6, 0.82, ["pale", "paler", "normal"]));
  gg.sympt.set(sm.Sympt, wordOf(sm.Sympt, 0.3, 0.6, ["none", "mild", "marked"]));
}
run({ init, step });
