/* Iron deficiency scene: bowel absorption, transferrin transport, liver store, marrow output, red cell close up and gauges. */
const WW = SC.W;
const layers = { gut: $("gutSlot"), liver: $("liverSlot"), vess: $("vess"), marrow: $("marrow"), leak: $("leak"), treat: $("treat"), preview: $("preview"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = { fer: [], prv: [], ivBag: null, seal: null, capEl: null, capKey: "" };
let bowelO = null, liverO = null, mouthLx = 250, mouthRx = 705, tubeY = 186;
let trMain = null, trBranch = null;
/* food enters at the bowel inlet port, absorption leaves from the coils port (both read off the organ) */
let foodX = 100, foodY = 62, coilsX = 153, coilsY = 193;
function capText(d, l) {
  let s;
  if (d === 3) s = "IV iron enters blood directly and refills the store fast.";
  else if (d === 2) s = "Oral iron is absorbed in the bowel and slowly rebuilds the store.";
  else if (d === 1) s = "Treating the cause plugs the leak. Lost iron returns only slowly.";
  else s = "No treatment. Loss drains iron faster than food replaces it.";
  if (l === 0) s += " Stores empty first.";
  else if (l === 1) s += " The marrow runs short.";
  else s += " Red cells are small and pale.";
  return s;
}
function initOrgans() {
  bowelO = organ(layers.gut, "bowel", 150, 190, 170, {});
  liverO = organ(layers.liver, "liver", 430, 340, 180, {});
  const GP = bowelO.ports, LP = liverO.ports;
  foodX = GP.in[0]; coilsX = GP.coils[0]; coilsY = GP.coils[1];
  mouthLx = GP.coils[0] + 95; mouthRx = 810 - 105;
  $("bloodTube").setAttribute("d", "M" + f1(mouthLx) + " " + tubeY + " L" + f1(mouthRx) + " " + tubeY);
  const hv = LP.hepvein;
  $("branchV").setAttribute("d", "M480 208 C470 228 440 248 " + f1(hv[0]) + " " + f1(hv[1]));
  trMain = track([[mouthLx, tubeY], [480, tubeY], [mouthRx, tubeY], [748, 186]]);
  trBranch = track([[480, 208], [462, 236], hv]);
}
/* ---- static shapes ---- */
function initShapes() {
  mk("ellipse", { class: "id-bone", cx: 810, cy: 185, rx: 105, ry: 68 }, layers.marrow);
  mk("ellipse", { class: "id-marrowIn", cx: 810, cy: 185, rx: 62, ry: 34 }, layers.marrow);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
    const d = mk("circle", { class: "id-ferr", cx: 388 + c * 21 + rnd(-3, 3), cy: 312 + r * 19 + rnd(-3, 3), r: 7 }, layers.liver);
    E.fer.push(d);
  }
  const bag = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "id-ivbag", x: 585, y: 52, width: 52, height: 72, rx: 10 }, bag);
  mk("rect", { class: "id-ivfluid", x: 591, y: 82, width: 40, height: 36, rx: 6 }, bag);
  mk("path", { class: "id-ivline", d: "M611 124 L611 163" }, bag);
  E.ivBag = bag;
  E.seal = mk("rect", { class: "id-seal", x: 282, y: 202, width: 36, height: 12, rx: 6, opacity: "0" }, layers.treat);
  [[655, 355], [735, 355], [815, 355]].forEach(([x, y]) => {
    const g = mk("g", { class: "cl cl-rbc" }, layers.preview);
    const bodyEl = mk("ellipse", { class: "cl-b", rx: 21, ry: 12.5 }, g);
    const cen = mk("ellipse", { class: "cl-s", rx: 7, ry: 4 }, g);
    g.setAttribute("transform", "translate(" + x + " " + y + ")");
    E.prv.push({ g, bodyEl, cen, x, y });
  });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const foodP = pool(8, () => mk("circle", { class: "sc-p p-iron", r: 2.6 }, layers.parts));
const absP = pool(12, () => mk("circle", { class: "sc-p p-iron", r: 2.4 }, layers.parts));
const capP = pool(6, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-caps", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-caps2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });
const ivP = pool(10, () => mk("circle", { class: "sc-p p-iron", r: 2.6 }, layers.parts));
const leakP = pool(10, () => mk("path", { class: "p-leak", d: "M0 -4C2 -1 3 1 3 2.4A3 3 0 0 1 -3 2.4C-3 1 -2 -1 0 -4Z" }, layers.parts));
const relP = pool(8, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); return g; });
const transP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-trans", r: 3.4 }, g); mk("circle", { class: "sc-p p-iron", r: 1.5, cx: 0, cy: -1 }, g); return g; });
const livP = pool(8, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-trans", r: 3.4 }, g); mk("circle", { class: "sc-p p-iron", r: 1.5, cx: 0, cy: -1 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* vessel red cells */
const vrbc = [];
function initVesselCells() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vess); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); vrbc.push({ g, x: rnd(260, 700), y: [176, 186, 196][i % 3], v: rnd(0.8, 1.2) }); } }
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
  pill(ox, "Bowel", 65, 190, 95, 70, "Bowel: food iron enters here. Most absorption into blood happens in the duodenum.");
  pill(ox, "Blood", 480, 164, 480, 80, "Blood: transferrin carries iron in blood to the marrow for red cells and to the liver store.");
  pill(ox, "Liver store", 420, 272, 350, 240, "Liver store: spare iron waits here as ferritin. It empties before haemoglobin falls.");
  pill(ox, "Marrow", 810, 117, 810, 80, "Marrow: new red cells are built here. They need iron from transferrin to make haemoglobin.");
  pill(ox, "Red cells", 735, 355, 735, 410, "Red cells close up: without enough iron they are made small and pale, with less haemoglobin.");
  rxPills.oral = pill(ox, "Oral iron", 100, 95, 210, 60, "Oral iron: swallowed iron absorbed through the bowel. It refills the store slowly.");
  rxPills.iv = pill(ox, "IV iron", 600, 88, 690, 75, "IV iron: iron straight into blood through the drip. It refills stores fast, even if the gut fails.");
  rxPills.causeRx = pill(ox, "Treat cause", 300, 285, 185, 335, "Treating the cause plugs the leak. It does not replace iron already lost.");
  E.capEl = mk("text", { class: "id-cap", x: 30, y: 432 }, ox); E.capEl.textContent = capText(0, 2);
}
const sm = { s: 1, oral: 0, iv: 0, causeRx: 0, Stores: 0, Tf: 0.26, Hb: 0.27, Size: 0.42, Colour: 0.33, Sympt: 0.7, Abs: 0.85, Leak: 0.85 };
const KEYS = Object.keys(sm);
const acc = { food: 0, abs: 0, cap: 0, iv: 0, leak: 0, rel: 0 };
function rideIn(p, u) { const q = trMain.at(u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); }
function rideStore(p, u) { const q = trBranch.at(u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); }
function init() { initOrgans(); initShapes(); initVesselCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  /* ferritin store fill inside the liver */
  const ferWant = Math.round(sm.Stores * E.fer.length);
  E.fer.forEach((d, i) => { d.style.opacity = i < ferWant ? "1" : "0.12"; });
  /* red cell close up: size and pallor follow the model */
  E.prv.forEach((p) => { place(p.g, p.x, p.y, 0, 0.55 + 0.55 * sm.Size); p.cen.setAttribute("rx", f1(3 + 8 * (1 - sm.Colour))); p.cen.setAttribute("ry", f1(1.6 + 4 * (1 - sm.Colour))); });
  /* food iron dropping into the bowel inlet */
  acc.food += dt * 2; while (acc.food >= 1) { acc.food--; const p = free(foodP); if (p) emit(p, foodX + rnd(-8, 8), foodY, 0, 42); }
  foodP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 106) kill(p); });
  /* absorbed iron crossing from bowel coils to the vessel mouth */
  acc.abs += dt * (0.6 + sm.Abs * 2.2 + sm.oral * 2.5); while (acc.abs >= 1) { acc.abs--; const p = free(absP); if (p) emit(p, coilsX + rnd(-6, 6), coilsY + rnd(-6, 6), rnd(40, 52), rnd(-8, 0)); }
  absP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x >= mouthLx - 4) kill(p); });
  /* transferrin carriers riding bowel to marrow, absorbed at the end */
  const tfWant = Math.round(sm.Tf * transP.length);
  transP.forEach((p, i) => {
    if (i >= tfWant) { if (p.on) kill(p); return; }
    if (!p.on) { emit(p, 0, 0, 0, 0); p.u = 0; }
    p.u += dt * 0.06 * (0.5 + sm.Tf);
    if (p.u >= 1) { kill(p); return; }
    rideIn(p, p.u);
  });
  /* iron delivered down the branch into the liver store */
  const livWant = Math.round(8 * clamp(sm.iv * 0.95 + sm.oral * 0.5));
  livP.forEach((p, i) => {
    if (i >= livWant) { if (p.on) kill(p); return; }
    if (!p.on) { emit(p, 0, 0, 0, 0); p.u = -rnd(0, 0.5); }
    p.u += dt * 0.09 * (0.5 + sm.Tf);
    if (p.u >= 1) { kill(p); return; }
    if (p.u < 0) { p.e.setAttribute("opacity", "0"); return; }
    p.e.setAttribute("opacity", "1"); rideStore(p, p.u);
  });
  /* vessel red cells flow, fewer when haemoglobin is low */
  const cellWant = Math.round(4 + 8 * sm.Hb);
  vrbc.forEach((r, i) => {
    r.x += r.v * 42 * dt * (0.5 + sm.Hb * 0.6); if (r.x > 700) r.x = 260;
    place(r.g, r.x, r.y, 0, 0.6 + 0.5 * sm.Size); r.g.style.opacity = i < cellWant ? "1" : "0";
  });
  /* marrow releases new red cells down to the close up */
  acc.rel += dt * (0.6 + sm.Hb * 2.4); while (acc.rel >= 1) { acc.rel--; const p = free(relP); if (p) emit(p, 790 + rnd(-24, 24), 222, rnd(-16, 16), rnd(26, 36)); }
  relP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 660, 920)) + " " + f1(clamp(p.y, 220, 340)) + ") scale(" + (0.7 + 0.5 * sm.Size).toFixed(2) + ")"); if (p.y > 336) kill(p); });
  /* oral iron capsules dropping into the bowel inlet */
  acc.cap += dt * sm.oral * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(capP); if (p) emit(p, foodX + rnd(-14, 14), 56, 0, 38); }
  capP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 60, 230)) + " " + f1(clamp(p.y, 50, 110)) + ") rotate(" + f1(p.t * 80) + ")"); if (p.y > 104) kill(p); });
  /* IV iron dots appearing directly in the blood */
  acc.iv += dt * sm.iv * 5; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, rnd(360, 600), rnd(152, 188), rnd(-8, 8), rnd(-6, 6)); }
  ivP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 326, 624)) + " " + f1(clamp(p.y, 146, 194)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3) kill(p); });
  /* blood loss leak from the vessel, plugged when the cause is treated */
  acc.leak += dt * sm.Leak * 3; while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) emit(p, 300 + rnd(-4, 4), 210, 0, rnd(55, 80)); }
  leakP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 280, 320)) + " " + f1(clamp(p.y, 208, 334)) + ")"); if (p.y > 332) kill(p); });
  /* treatment markers: drip set, leak seal and pills */
  setVis(E.ivBag, clamp(sm.iv)); setVis(E.seal, clamp(sm.causeRx));
  setVis(rxPills.oral, clamp(sm.oral)); setVis(rxPills.iv, clamp(sm.iv)); setVis(rxPills.causeRx, clamp(sm.causeRx));
  /* gauges */
  gg.stores.set(sm.Stores, wordOf(sm.Stores, 0.35, 0.72, ["empty", "low", "replete"]));
  gg.tf.set(sm.Tf, wordOf(sm.Tf, 0.3, 0.6, ["low", "reduced", "normal"]));
  gg.hb.set(sm.Hb, wordOf(sm.Hb, 0.45, 0.78, ["low", "reduced", "normal"]));
  gg.size.set(sm.Size, wordOf(sm.Size, 0.65, 0.85, ["small", "smaller", "normal"]));
  gg.colour.set(sm.Colour, wordOf(sm.Colour, 0.6, 0.82, ["pale", "paler", "normal"]));
  gg.sympt.set(sm.Sympt, wordOf(sm.Sympt, 0.3, 0.6, ["none", "mild", "marked"]));
  const key = drug + ":" + level;
  if (key !== E.capKey) { E.capKey = key; const t = capText(drug, level); if (E.capEl.textContent !== t) E.capEl.textContent = t; }
}
run({ init, step });
