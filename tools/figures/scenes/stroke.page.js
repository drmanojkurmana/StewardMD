/* Ischaemic stroke scene: artery, clot sources, brain core and penumbra, glutamate, treatments and gauges. */
const WW = SC.W;
const L = { art: $("art"), brain: $("brain"), parts: $("parts"), over: $("over"), panel: $("panel") };
const BCX = 740, BCY = 242;
const sm = { Occ: 0.92, Flow: 0.06, Core: 0.2, Pen: 0.6, Ex: 0.4, Def: 0.4, lysis: 0, thromb: 0, anti: 0 };
const acc = { glut: 0, lys: 0, ap: 0 };
let gg = {}, clotG, coreEl, penEl, cathG, embG, heartG;
const rbcs = [], neurons = [], pltBits = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gluts = pool(30, () => mk("path", { class: "sc-p p-glut", d: "M0 -3L2.6 2L-2.6 2Z" }, L.parts));
const lysDots = pool(16, () => mk("circle", { class: "sc-p p-lys", r: 2.3 }, L.parts));
const apPills = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const embTrk = track([[90, 298], [102, 244], [116, 202], [128, 176], [210, 156], [338, 150]]);
function init() {
  /* artery: lumen and walls from the left edge to the brain */
  mk("rect", { class: "st-lumen", x: 30, y: 128, width: 560, height: 44 }, L.art);
  mk("rect", { class: "st-wall", x: 30, y: 118, width: 560, height: 10 }, L.art);
  mk("rect", { class: "st-wall", x: 30, y: 172, width: 560, height: 10 }, L.art);
  mk("ellipse", { class: "st-plaque", cx: 338, cy: 174, rx: 58, ry: 13 }, L.art);
  const rg = mk("g", {}, L.art);
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(30, 590), y: rnd(134, 166), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  /* clot at the plaque */
  clotG = mk("g", {}, L.art);
  for (let i = 0; i < 9; i++) { const b = cell(clotG, { cls: "plt", r: 6 + (i % 3), x: Math.cos(i * 1.4) * 16, y: Math.sin(i * 2.0) * 11, seed: i + 4, wob: 0.16, n: 7 }); pltBits.push(b); }
  for (let i = 0; i < 5; i++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-24, 24)) + " " + f1(rnd(-12, 12)) + "L" + f1(rnd(-24, 24)) + " " + f1(rnd(-12, 12)) }, clotG);
  /* catheter for thrombectomy, hidden until chosen */
  cathG = mk("g", { opacity: "0" }, L.art);
  mk("path", { class: "st-cath", d: "M30 150H318" }, cathG);
  mk("path", { class: "st-basket", d: "M318 150l22 -9M318 150l22 0M318 150l22 9" }, cathG);
  /* heart source and the embolus path */
  mk("path", { class: "st-path", d: "M90 298C102 244 116 202 128 176" }, L.art);
  heartG = mk("path", { class: "st-heart", d: "M90 340C58 316 62 282 90 298C118 282 122 316 90 340Z" }, L.art);
  embG = mk("g", {}, L.art); cell(embG, { cls: "plt", r: 7, seed: 9, wob: 0.18, n: 7 });
  /* brain: outer slice, penumbra ring, core */
  mk("ellipse", { class: "st-brain", cx: BCX, cy: BCY, rx: 152, ry: 126 }, L.brain);
  penEl = mk("ellipse", { class: "st-pen", cx: BCX, cy: BCY, rx: 86, ry: 68 }, L.brain);
  coreEl = mk("ellipse", { class: "st-core", cx: BCX, cy: BCY, rx: 26, ry: 20 }, L.brain);
  [[678, 192], [742, 208], [802, 192], [696, 282], [772, 286], [740, 244], [646, 240]].forEach(([x, y], i) => { const g = cell(L.brain, { cls: "neuron", r: 11, nuc: 0.4, seed: i + 11, wob: 0.12 }); neurons.push({ g, x, y, i }); });
  /* labels: top row, then side and bottom rows, kept apart by design */
  const o = L.over;
  pill(o, "Cerebral artery", 170, 150, 150, 92, "A cerebral artery carrying blood to one brain territory. Block it and that territory is starved of oxygen.");
  pill(o, "Plaque", 320, 166, 285, 92, "A fatty plaque in the artery wall. A clot forming here in place is a thrombotic stroke.");
  pill(o, "Clot", 356, 140, 362, 92, "A clot of platelets and fibrin blocking the artery. Flow beyond it falls or stops.");
  pill(o, "Penumbra", 656, 176, 650, 92, "The penumbra: tissue around the core that is barely perfused, not working but still alive and salvageable if flow returns.");
  pill(o, "Neurone", 802, 192, 830, 92, "A brain cell. Starved neurones fail, release glutamate and, in the core, die.");
  pill(o, "Embolus", 110, 236, 130, 260, "An embolus: a clot fragment that travels in the blood, often from the heart, and lodges in a narrower artery. That is an embolic stroke.");
  pill(o, "Heart", 90, 316, 95, 372, "The heart is a common source of emboli, for example when clot forms in a fibrillating atrium.");
  pill(o, "Glutamate", 696, 284, 615, 372, "Glutamate released by starved neurones overexcites neighbours, lets calcium in and drives excitotoxic cell death in the penumbra.");
  pill(o, "Core", BCX, 246, BCX, 395, "The ischaemic core: tissue with almost no flow that dies quickly and cannot be recovered.");
  const cp = pill(o, "Catheter", 240, 152, 210, 215, "Thrombectomy: a catheter passed into the artery to trap and remove the clot and reopen the vessel."); cp.setAttribute("id", "st-cath-pill"); cp.style.opacity = 0;
  const lp = pill(o, "Thrombolysis", 352, 136, 480, 92, "Thrombolysis: a clot dissolving drug given into a vein. It works best early, before the core has grown."); lp.setAttribute("id", "st-lys-pill"); lp.style.opacity = 0;
  const ap = pill(o, "Antiplatelet", 300, 140, 480, 92, "An antiplatelet drug stops platelets clumping further. On its own it does not reopen a blocked artery."); ap.setAttribute("id", "st-ap-pill"); ap.style.opacity = 0;
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["fl", "Flow", "g-fl", "How much blood still gets past the clot to the territory."], ["core", "Core", "g-bad", "Size of the ischaemic core: tissue already dead or dying."], ["pen", "Penumbra", "g-cyt", "Tissue at risk but still salvageable. It shrinks as it dies into the core or is saved by reperfusion."], ["glut", "Glutamate", "g-eos", "Excitotoxic glutamate signalling in the starved tissue."], ["death", "Cell death", "g-bad", "Neurones lost in the core."], ["def", "Deficit", "g-neut", "Loss of function for this territory, for example weakness or speech loss depending on the area involved."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Occ", "Flow", "lysis", "thromb", "anti"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["Core", "Pen", "Ex", "Def"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  /* clot, core and penumbra sizes */
  place(clotG, 340 - sm.thromb * 6 * Math.abs(Math.sin(tm / 500)), 150, 0, 0.25 + 0.85 * sm.Occ);
  const crx = 12 + 58 * sm.Core, cry = 10 + 44 * sm.Core;
  coreEl.setAttribute("rx", f1(crx)); coreEl.setAttribute("ry", f1(cry));
  penEl.setAttribute("rx", f1(Math.max(crx + 14, 34 + 62 * sm.Pen))); penEl.setAttribute("ry", f1(Math.max(cry + 12, 28 + 48 * sm.Pen)));
  penEl.setAttribute("opacity", (0.18 + 0.4 * sm.Pen).toFixed(2));
  /* neurones fade and shrink as the core reaches them */
  neurons.forEach((n) => { const d = Math.hypot(n.x - BCX, n.y - BCY); const harm = clamp(sm.Core * 1.5 - d / 190); const flick = 1 + 0.08 * sm.Ex * Math.sin(tm / 220 + n.i * 2); place(n.g, n.x, n.y, Math.sin(tm / 900 + n.i) * 8, Math.max(0.3, (1 - 0.55 * harm) * flick)); n.g.style.opacity = (1 - 0.55 * harm).toFixed(2); });
  /* red cells: flow through, queue before a blocking clot, thin out beyond it */
  rbcs.forEach((r) => { r.x += r.v * 72 * Math.max(0.04, sm.Flow) * dt; if (sm.Flow < 0.25 && r.x > 306 && r.x < 330) r.x = 306 - Math.random() * 2; if (r.x > 596) { r.x = 24; r.y = rnd(134, 166); } place(r.g, r.x, r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); r.g.style.opacity = r.x > 372 && sm.Flow < 0.3 ? 0.25 : 1; });
  /* embolus travelling from the heart to the clot */
  const eu = (tm / 6500) % 1, ep = embTrk.at(eu); place(embG, ep.x, ep.y, ep.a, 0.7 + 0.3 * Math.sin(tm / 300)); embG.style.opacity = eu > 0.96 ? 0 : 0.95;
  heartG.setAttribute("transform", "translate(90 311) scale(" + (1 + 0.05 * Math.sin(tm / 420)).toFixed(3) + ") translate(-90 -311)");
  /* glutamate in the penumbra */
  acc.glut += dt * sm.Ex * 9; while (acc.glut >= 1) { acc.glut--; const p = free(gluts); if (p) { const an = rnd(0, 6.28), rr = rnd(0.35, 0.95); emit(p, BCX + Math.cos(an) * rr * 78, BCY + Math.sin(an) * rr * 58, Math.cos(an) * 9, Math.sin(an) * 7, 0); } }
  gluts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) kill(p); });
  /* thrombolysis dots chewing at the clot */
  acc.lys += dt * sm.lysis * 7; while (acc.lys >= 1) { acc.lys--; const p = free(lysDots); if (p) emit(p, rnd(36, 120), rnd(136, 164), rnd(55, 80), rnd(-4, 4), 0); }
  lysDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 336 || p.t > 4) kill(p); });
  /* antiplatelet pills circulating in the artery */
  acc.ap += dt * sm.anti * 3; while (acc.ap >= 1) { acc.ap--; const p = free(apPills); if (p) emit(p, 28, rnd(138, 162), rnd(45, 65), 0, 0); }
  apPills.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); if (p.x > 330 || p.t > 6) kill(p); });
  /* treatment overlays */
  cathG.setAttribute("opacity", sm.thromb.toFixed(2));
  $("st-cath-pill").style.opacity = sm.thromb.toFixed(2); $("st-lys-pill").style.opacity = sm.lysis.toFixed(2); $("st-ap-pill").style.opacity = sm.anti.toFixed(2);
  /* gauges */
  gg.fl.set(sm.Flow, wordOf(sm.Flow, 0.3, 0.65, ["blocked", "reduced", "open"]));
  gg.core.set(sm.Core, wordOf(sm.Core, 0.18, 0.45, ["small", "growing", "large"]));
  gg.pen.set(sm.Pen, wordOf(sm.Pen, 0.25, 0.5, ["gone", "shrinking", "present"]));
  gg.glut.set(sm.Ex, wordOf(sm.Ex, 0.25, 0.5, ["low", "raised", "high"]));
  gg.death.set(sm.Core, wordOf(sm.Core, 0.18, 0.45, ["little", "spreading", "extensive"]));
  gg.def.set(sm.Def, wordOf(sm.Def, 0.3, 0.6, ["mild", "moderate", "severe"]));
}
run({ init, step });
