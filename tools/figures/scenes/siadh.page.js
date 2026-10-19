/* SIADH and diabetes insipidus: pituitary ADH in blood, kidney duct gates, brain and urine. */
const WW = SC.W;
const layers = { pit: $("pitSlot"), kidney: $("kidneySlot"), brain: $("brainSlot"), gates: $("gates"), recept: $("recept"), parts: $("parts"), over: $("over"), panel: $("panel"), vessel: $("vessel"), duct: $("duct"), ductlum: $("ductlum"), urinefill: $("urinefill"), lid: $("lid") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, st: 0, si: 0 }; }); }
const freePool = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const adhP = pool(16, () => mk("circle", { class: "sc-p p-adh", r: 3 }, layers.parts));
const saltP = pool(14, () => mk("path", { class: "sc-p p-salt2", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const watP = pool(14, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const dvpP = pool(9, () => mk("path", { class: "sc-p p-dvp", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const reabP = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const urineP = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const inP = pool(8, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
/* organs, tracks and gate furniture, all anchored to the real organ ports */
let pitO = null, kidneyO = null, brainO = null, capEl = null, capKey = "";
let bloodTr = null, ductTr = null, fullTr = null;
const slots = [], gateEls = [], recEls = [], stationQs = [];
const dp = (pts) => "M" + pts.map((q) => f1(q[0]) + " " + f1(q[1])).join("L");
function initOrgans() {
  pitO = organ(layers.pit, "pituitary", 105, 150, 95, {});
  kidneyO = organ(layers.kidney, "kidney", 600, 185, 160, {});
  brainO = organ(layers.brain, "brain", 200, 340, 175, {});
  const P0 = pitO.ports.out, K1 = kidneyO.ports.in, K2 = kidneyO.ports.out;
  const vesselPts = [P0, [200, 136], [300, 132], [400, 140], [470, 150], K1];
  const ductPts = [K2, [620, 273], [650, 276], [682, 275], [712, 274], [742, 273], [770, 272]];
  layers.vessel.setAttribute("d", dp(vesselPts));
  layers.duct.setAttribute("d", dp(ductPts));
  layers.ductlum.setAttribute("d", dp(ductPts));
  bloodTr = track(vesselPts); ductTr = track(ductPts); fullTr = track(vesselPts.concat(ductPts));
  [0.3, 0.57, 0.82].forEach((u) => {
    const q = ductTr.at(u); stationQs.push(q);
    gateEls.push(mk("rect", { class: "si-aqp", x: f1(q.x - 3.5), y: f1(q.y - 15), width: 7, height: 10, rx: 2 }, layers.gates));
    gateEls.push(mk("rect", { class: "si-aqp", x: f1(q.x - 3.5), y: f1(q.y + 5), width: 7, height: 10, rx: 2 }, layers.gates));
    slots.push([q.x - 11, q.y - 15]); slots.push([q.x + 11, q.y + 15]);
    recEls.push(mk("circle", { class: "si-v2r", cx: f1(q.x - 11), cy: f1(q.y - 15), r: 3 }, layers.recept));
    recEls.push(mk("circle", { class: "si-v2r", cx: f1(q.x + 11), cy: f1(q.y + 15), r: 3 }, layers.recept));
  });
}
function capText(l, d) {
  if (l === 0 && d === 0) return "At rest. ADH matches water intake and all stays balanced.";
  if (l === 0 && d === 1) return "Less water in. Urine falls a little and thirst rises.";
  if (l === 0 && d === 2) return "Thiazide drains a little extra water here. Urine rises a little.";
  if (l === 0) return "Extra ADH signal holds water back. Urine falls.";
  if (l === 1 && d === 0) return "No treatment. Too much ADH holds water and sodium falls.";
  if (l === 1 && d === 1) return "Less water in. Sodium climbs back and the brain settles.";
  if (l === 1 && d === 2) return "Thiazide does not fix excess ADH. Little changes.";
  if (l === 1) return "More ADH signal on top of excess. Waterlogging worsens.";
  if (l === 2 && d === 0) return "No treatment. No ADH, so water pours out and the brain shrinks.";
  if (l === 2 && d === 1) return "Less water in, but the tap is still open. Little changes.";
  if (l === 2 && d === 2) return "Thiazide trims urine a little, but ADH is still missing.";
  if (l === 2) return "Desmopressin stands in for ADH. Gates open and water stays in.";
  if (l === 3 && d === 0) return "No treatment. The duct ignores ADH and water pours out.";
  if (l === 3 && d === 1) return "Less water in yet the duct still wastes it. Little changes.";
  if (l === 3 && d === 2) return "Thiazide trims urine flow even though the duct ignores ADH.";
  return "The duct cannot hear the signal, so desmopressin changes little.";
}
const sm = { ADH: 0.07, AQP: 0.1, Re: 0.1, Uv: 0.92, Uc: 0.1, Na: 0.86, Wat: 0.16, Th: 0.92, Bw: 0.1 };
const acc = { adh: 0, salt: 0, wat: 0, dvp: 0, reab: 0, urine: 0, in: 0 };
const gg = {};
let dvpPill = null;
function setVis(g, v) { g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 260, 430, 600, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["adh", "ADH effect", "g-adh", "ADH effect at the collecting duct: ADH amount reaching the duct and aquaporin gates standing in its wall."],
   ["re", "Water back", "g-re", "Water reabsorbed from the collecting duct back into the body. High in SIADH, low in diabetes insipidus."],
   ["uv", "Urine flow", "g-uv", "Urine volume. Small when water is held, large when water is lost in diabetes insipidus."],
   ["na", "Sodium", "g-na2", "Blood sodium concentration: salt relative to water. Diluted and low in SIADH, concentrated and high in diabetes insipidus."],
   ["bw", "Brain water", "g-bw", "Water inside brain cells. The brain swells when sodium is diluted and shrinks when sodium is concentrated."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  const aD = bloodTr.at(0.25), bD = bloodTr.at(0.55);
  pill(ox, "Pituitary", pitO.x, pitO.y - 45, 105, 68, "Posterior pituitary: stores and releases ADH made in the hypothalamus into the blood.");
  pill(ox, "ADH", aD.x, aD.y, 245, 90, "ADH: the hormone that tells the collecting duct to hold water. Desmopressin copies it.");
  pill(ox, "Blood", bD.x, bD.y, 370, 98, "Blood: carries ADH to the kidney. Drinking adds water here, which dilutes sodium.");
  pill(ox, "Kidney", kidneyO.x, kidneyO.y - kidneyO.h / 2 + 4, 600, 60, "Kidney: the collecting duct inside it adjusts water under ADH control.");
  pill(ox, "Water gates", stationQs[1].x, stationQs[1].y, 818, 232, "Aquaporin water gates: ADH puts them in the duct wall so water leaves the urine and returns to the blood.");
  pill(ox, "Urine", 770, 350, 866, 292, "Urine: small and dark when water is held, large and pale when water is lost.");
  pill(ox, "Brain", brainO.x, brainO.y - brainO.h / 2 + 8, 200, 248, "Brain cells: swell when blood sodium is diluted by retained water, shrink when sodium concentrates.");
  dvpPill = pill(ox, "Desmopressin", stationQs[0].x, stationQs[0].y, 548, 336, "Desmopressin: replacement ADH signal. It docks on duct receptors and opens the water gates.");
  setVis(dvpPill, 0);
  capEl = mk("text", { class: "si-cap", x: 30, y: 432 }, ox); capEl.textContent = capText(level, drug);
}
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.ADH = lerp(sm.ADH, m.ADH, k2); sm.AQP = lerp(sm.AQP, m.AQP, k2); sm.Re = lerp(sm.Re, m.Re, k2);
  sm.Uv = lerp(sm.Uv, m.Uv, k2); sm.Uc = lerp(sm.Uc, m.Uc, k2); sm.Na = lerp(sm.Na, m.Na, k2);
  sm.Wat = lerp(sm.Wat, m.Wat, k2); sm.Th = lerp(sm.Th, m.Th, k2); sm.Bw = lerp(sm.Bw, m.Bw, k2);
  /* gates stand open with ADH effect; the brain swells or shrinks */
  gateEls.forEach((g) => g.classList.toggle("open", sm.AQP > 0.45));
  const bs = 0.85 + 0.3 * sm.Bw;
  brainO.g.setAttribute("transform", "translate(200 340) scale(" + bs.toFixed(3) + ")");
  /* drinking cup gets its lid while fluid is restricted */
  layers.lid.setAttribute("opacity", drug === 1 ? "1" : "0");
  /* urine beaker: height is volume, depth is concentration */
  const uh = 14 + sm.Uv * 88;
  layers.urinefill.setAttribute("y", f1(404 - uh)); layers.urinefill.setAttribute("height", f1(uh));
  layers.urinefill.setAttribute("opacity", (0.3 + 0.65 * sm.Uc).toFixed(2));
  /* ADH rides blood all the way to the duct, then is taken up */
  acc.adh += dt * (0.5 + sm.ADH * 6.5); while (acc.adh >= 1) { acc.adh--; const p = freePool(adhP); if (p) { const q = fullTr.at(0); emit(p, q.x + rnd(-4, 4), q.y + rnd(-4, 4), 0, 0); p.u = 0; } }
  adhP.forEach((p) => { if (!p.on) return; p.u += dt * 95 / fullTr.len; if (p.u >= 1) { kill(p); return; } const q = fullTr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* salt and water show blood concentration, then leave for the kidney */
  acc.salt += dt * (0.8 + sm.Na * 6); while (acc.salt >= 1) { acc.salt--; const p = freePool(saltP); if (p) { const q = bloodTr.at(0); emit(p, q.x + rnd(-5, 5), q.y + rnd(-5, 5), 0, 0); p.u = 0; } }
  saltP.forEach((p) => { if (!p.on) return; p.u += dt * 62 / bloodTr.len; if (p.u >= 1) { kill(p); return; } const q = bloodTr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 6) + ")"); });
  acc.wat += dt * (0.8 + sm.Wat * 5.5); while (acc.wat >= 1) { acc.wat--; const p = freePool(watP); if (p) { const q = bloodTr.at(0); emit(p, q.x + rnd(-5, 5), q.y + rnd(-5, 5), 0, 0); p.u = 0; } }
  watP.forEach((p) => { if (!p.on) return; p.u += dt * 55 / bloodTr.len; if (p.u >= 1) { kill(p); return; } const q = bloodTr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* desmopressin rides the blood, then docks on duct receptors and sits there */
  const occ = slots.map(() => false);
  if (drug === 3) {
    dvpP.forEach((p, i) => {
      if (!p.on) { const q = bloodTr.at(0); emit(p, q.x, q.y, 0, 0); p.st = 0; p.u = -(i % 9) * 0.12; p.si = i % slots.length; }
      const slot = slots[p.si];
      if (p.st === 0) { p.u += dt * 0.3; if (p.u >= 1) { p.st = 1; } else if (p.u > 0) { const q = bloodTr.at(p.u); p.x = q.x; p.y = q.y; } }
      if (p.st === 1) { const dx = slot[0] - p.x, dy = slot[1] - p.y, d = Math.hypot(dx, dy) || 1; const go = 175 * dt; p.x += dx / d * Math.min(d, go); p.y += dy / d * Math.min(d, go); if (d < 6) p.st = 2; }
      else if (p.st === 2) { p.x = slot[0] + Math.sin(tm / 480 + i * 2.1) * 2; p.y = slot[1] + Math.cos(tm / 420 + i * 1.7) * 2; occ[p.si] = true; }
      if (p.u <= 0 && p.st === 0) p.e.setAttribute("opacity", "0");
      else p.e.setAttribute("opacity", "1");
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 7 + i * 40) + ")");
    });
  } else dvpP.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.7).toFixed(2)); if (p.t > 0.7) kill(p); });
  recEls.forEach((r, i) => r.classList.toggle("hit", occ[i]));
  /* water crossing the duct wall back toward blood */
  acc.reab += dt * (0.3 + sm.Re * 8); while (acc.reab >= 1) { acc.reab--; const p = freePool(reabP); if (p) { const q = stationQs[Math.floor(Math.random() * stationQs.length)]; emit(p, q.x + rnd(-4, 4), q.y + rnd(-3, 3), rnd(-22, -6), -38); } }
  reabP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* urine falling from the duct into the beaker */
  acc.urine += dt * (0.4 + sm.Uv * 8); while (acc.urine >= 1) { acc.urine--; const p = freePool(urineP); if (p) emit(p, 770 + rnd(-4, 4), 276, 0, 62); }
  urineP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 394) kill(p); });
  /* sips from the cup join the blood unless fluid is restricted */
  acc.in += dt * (drug === 1 ? 0 : 2.4); while (acc.in >= 1) { acc.in--; const p = freePool(inP); if (p) emit(p, 46, 216, 0, 0); }
  inP.forEach((p) => { if (!p.on) return; p.t += dt / 0.9; if (p.t >= 1) { kill(p); return; } p.e.setAttribute("transform", "translate(" + f1(lerp(46, 140, p.t)) + " " + f1(lerp(216, 143, p.t)) + ")"); });
  gg.adh.set(sm.AQP, wordOf(sm.AQP, 0.3, 0.65, ["low", "normal", "high"]));
  gg.re.set(sm.Re, wordOf(sm.Re, 0.3, 0.65, ["low", "normal", "high"]));
  gg.uv.set(sm.Uv, wordOf(sm.Uv, 0.3, 0.65, ["small", "normal", "large"]));
  gg.na.set(sm.Na, wordOf(sm.Na, 0.35, 0.65, ["low", "normal", "high"]));
  gg.bw.set(sm.Bw, wordOf(sm.Bw, 0.35, 0.65, ["shrunken", "normal", "swollen"]));
  setVis(dvpPill, drug === 3 ? 1 : 0);
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const c = capText(level, drug); if (capEl.textContent !== c) capEl.textContent = c; }
}
run({ init, step });
