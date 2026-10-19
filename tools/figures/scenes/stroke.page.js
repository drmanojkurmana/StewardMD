/* Ischaemic stroke scene: artery into a real brain, emboli from a real heart, core and penumbra, treatments that visibly act. */
const WW = SC.W;
const L = { art: $("art"), heartSlot: $("heartSlot"), brain: $("brainOver"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CLOTX = 470, CLOTY = 218, ARTY = 218;
let ARTE = 668, COREX = 739, COREY = 218;
let heartO = null, brainO = null, heartWrap = null, embTrk = null;
const sm = { Occ: 0.92, Flow: 0.06, Core: 0.2, Pen: 0.6, Ex: 0.4, Def: 0.4, Clump: 0.7, lysis: 0, thromb: 0, anti: 0 };
const acc = { glut: 0, lys: 0, stream: 0, crumb: 0, ap: 0 };
let gg = {}, clotG, coreEl, penEl, riskEl, cathG, cathLine, basketG, embG, capEl = null, capDrug = -1;
const rbcs = [], neurons = [], streams = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null, a: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.a = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gluts = pool(30, () => mk("path", { class: "sc-p p-glut", d: "M0 -3L2.6 2L-2.6 2Z" }, L.parts));
const lysDots = pool(16, () => mk("circle", { class: "sc-p p-lys", r: 2.6 }, L.parts));
const crumbs = pool(10, () => mk("circle", { class: "sc-p p-crumb", r: 2.4 }, L.parts));
const apPills = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
function capText(d) {
  if (d === 1) return "Thrombolysis dissolves the clot. Flow returns.";
  if (d === 2) return "Antiplatelet slows further clumping. The artery stays blocked.";
  if (d === 3) return "Thrombectomy pulls the clot out. Flow returns.";
  return "No treatment. The clot stays and the core grows.";
}
function init() {
  /* real organs; vessels and particles anchor to their ports below */
  heartWrap = mk("g", {}, L.heartSlot);
  heartO = organ(heartWrap, "heart", 110, 330, 130, { flip: true });
  brainO = organ($("brainSlot"), "brain", 758, 232, 240, {});
  const fp = brainO.ports.frontal, pp = brainO.ports.parenchyma, ao = heartO.ports.out;
  ARTE = Math.round(fp[0]) + 6;
  COREX = Math.round(pp[0]); COREY = Math.round(pp[1]);
  embTrk = track([[ao[0], ao[1]], [170, 244], [220, 224], [340, 220], [CLOTX - 8, CLOTY]]);
  /* artery from the left edge into the brain */
  mk("rect", { class: "st-lumen", x: 30, y: 196, width: ARTE - 30, height: 44 }, L.art);
  mk("rect", { class: "st-wall", x: 30, y: 186, width: ARTE - 30, height: 10 }, L.art);
  mk("rect", { class: "st-wall", x: 30, y: 240, width: ARTE - 30, height: 10 }, L.art);
  mk("ellipse", { class: "st-plaque", cx: CLOTX, cy: 242, rx: 58, ry: 12 }, L.art);
  const rg = mk("g", {}, L.art);
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(30, ARTE), y: rnd(202, 234), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  /* clot sitting on the plaque */
  clotG = mk("g", {}, L.art);
  for (let i = 0; i < 9; i++) cell(clotG, { cls: "plt", r: 6 + (i % 3), x: Math.cos(i * 1.4) * 16, y: Math.sin(i * 2.0) * 11, seed: i + 4, wob: 0.16, n: 7 });
  for (let i = 0; i < 5; i++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-24, 24)) + " " + f1(rnd(-12, 12)) + "L" + f1(rnd(-24, 24)) + " " + f1(rnd(-12, 12)) }, clotG);
  /* catheter for thrombectomy, hidden until chosen */
  cathG = mk("g", { opacity: "0" }, L.art);
  cathLine = mk("path", { class: "st-cath", d: "M30 " + ARTY + "H60" }, cathG);
  basketG = mk("g", { opacity: "0" }, cathG);
  mk("path", { class: "st-basket", d: "M0 0L24 -11" }, basketG);
  mk("path", { class: "st-basket", d: "M0 0L26 0" }, basketG);
  mk("path", { class: "st-basket", d: "M0 0L24 11" }, basketG);
  /* embolus guide from the heart aorta port, and the travelling embolus */
  mk("path", { class: "st-path", d: "M" + f1(ao[0]) + " " + f1(ao[1]) + "L170 244L220 224L340 220L" + (CLOTX - 8) + " " + CLOTY }, L.art);
  embG = mk("g", {}, L.art); cell(embG, { cls: "plt", r: 7, seed: 9, wob: 0.18, n: 7 });
  /* brain overlays: risk glow, penumbra ring, core, neurones */
  riskEl = mk("ellipse", { class: "st-risk", cx: COREX, cy: COREY, rx: 80, ry: 62, opacity: "0" }, L.brain);
  penEl = mk("ellipse", { class: "st-pen", cx: COREX, cy: COREY, rx: 72, ry: 56 }, L.brain);
  coreEl = mk("ellipse", { class: "st-core", cx: COREX, cy: COREY, rx: 26, ry: 20 }, L.brain);
  [[680, 180], [735, 168], [795, 172], [668, 258], [762, 272], [815, 238], [700, 222]].forEach(([x, y], i) => { const g = cell(L.brain, { cls: "neuron", r: 11, nuc: 0.4, seed: i + 11, wob: 0.12 }); neurons.push({ g, x, y, i }); });
  /* platelet streamers: each carries a drug cap dot that fills in on antiplatelet */
  for (let i = 0; i < 10; i++) { const g = mk("g", { opacity: "0" }, L.parts); mk("ellipse", { class: "p-stream", rx: 5, ry: 3 }, g); const cap = mk("circle", { class: "sc-p p-lys", r: 1.8, cx: 3, cy: -2, opacity: "0" }, g); streams.push({ g, cap, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, coat: 0, st: 0, a: 0 }); }
  const freeStream = () => streams.find((p) => !p.on);
  /* labels */
  const o = L.over;
  pill(o, "Cerebral artery", 110, 200, 140, 92, "A cerebral artery carrying blood to one brain territory. Block it and that territory is starved.");
  pill(o, "Embolus", 220, 224, 235, 92, "An embolus: a clot fragment that travels in the blood, often from the heart, and lodges in a narrower artery.");
  pill(o, "Plaque", 430, 244, 300, 92, "A fatty plaque in the artery wall. A clot forming here in place is a thrombotic stroke.");
  pill(o, "Clot", CLOTX, 206, 500, 92, "A clot of platelets and fibrin blocking the artery. Flow beyond it falls or stops.");
  pill(o, "Core", COREX, 180, 580, 92, "The ischaemic core: tissue with almost no flow that dies quickly and cannot be recovered.");
  pill(o, "Penumbra", 668, 192, 660, 92, "The penumbra: tissue around the core that is barely perfused, not working but still alive and salvageable if flow returns.");
  pill(o, "Neurone", 795, 172, 860, 92, "A brain cell. Starved neurones fail, release glutamate and, in the core, die.");
  pill(o, "Heart", 170, 340, 250, 340, "The heart is a common source of emboli, for example when clot forms in a fibrillating atrium.");
  pill(o, "Glutamate", 700, 270, 640, 395, "Glutamate released by starved neurones overexcites neighbours and drives cell death in the penumbra.");
  const cp = pill(o, "Catheter", 200, 218, 330, 300, "Thrombectomy: a catheter passed into the artery traps the clot and pulls it out, reopening the vessel."); cp.setAttribute("id", "st-cath-pill"); cp.style.opacity = 0;
  const lp = pill(o, "Thrombolysis", 150, 218, 420, 330, "Thrombolysis: a clot dissolving drug that breaks the clot apart so flow can return."); lp.setAttribute("id", "st-lys-pill"); lp.style.opacity = 0;
  const ap = pill(o, "Antiplatelet", 350, 218, 550, 340, "An antiplatelet drug coats platelets so they stop piling onto the clot. On its own it does not reopen a blocked artery."); ap.setAttribute("id", "st-ap-pill"); ap.style.opacity = 0;
  capEl = mk("text", { class: "st-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0);
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["fl", "Flow", "g-fl", "How much blood still gets past the clot to the territory."], ["core", "Core", "g-bad", "Size of the ischaemic core: tissue already dead or dying."], ["pen", "Penumbra", "g-cyt", "Tissue at risk but still salvageable. It shrinks as it dies into the core or is saved by reperfusion."], ["glut", "Glutamate", "g-eos", "Excitotoxic glutamate signalling in the starved tissue."], ["death", "Cell death", "g-bad", "Neurones lost in the core."], ["def", "Deficit", "g-neu", "Loss of function for this territory, for example weakness or speech loss depending on the area involved."], ["clump", "Clumping", "g-clot", "Platelets still piling onto the clot. Antiplatelet treatment calms this even though the artery stays blocked."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 96 + i * 120, y0, 60, 18, cls, name, tip); });
  L.freeStream = freeStream;
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Occ", "Flow", "Clump", "lysis", "thromb", "anti"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["Core", "Pen", "Ex", "Def"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  /* catheter: advances, grabs the clot, pulls it out */
  const adv = clamp(sm.thromb * 1.6), grab = clamp((sm.thromb - 0.55) / 0.2), retract = clamp((sm.thromb - 0.8) / 0.2);
  const tipX = lerp(lerp(60, CLOTX - 14, adv), 120, retract);
  const clotX = lerp(CLOTX, tipX, Math.max(grab * 0.3, retract));
  const clotS = Math.max(0.05, (0.25 + 0.85 * sm.Occ) * (1 + 0.07 * (1 - 0.7 * sm.anti) * Math.sin(tm / 300)) * (1 - 0.95 * retract));
  place(clotG, clotX, CLOTY, 0, clotS);
  cathG.setAttribute("opacity", clamp(sm.thromb * 3).toFixed(2));
  cathLine.setAttribute("d", "M30 " + ARTY + "H" + f1(tipX));
  place(basketG, tipX, CLOTY, 0, 1);
  basketG.setAttribute("opacity", grab.toFixed(2));
  /* clot, core and penumbra sizes */
  const crx = 12 + 58 * sm.Core, cry = 10 + 44 * sm.Core;
  coreEl.setAttribute("rx", f1(crx)); coreEl.setAttribute("ry", f1(cry));
  const prx = Math.max(crx + 14, 34 + 62 * sm.Pen), pry = Math.max(cry + 12, 28 + 48 * sm.Pen);
  penEl.setAttribute("rx", f1(prx)); penEl.setAttribute("ry", f1(pry));
  penEl.setAttribute("opacity", (0.18 + 0.4 * sm.Pen).toFixed(2));
  riskEl.setAttribute("rx", f1(prx + 8)); riskEl.setAttribute("ry", f1(pry + 8));
  riskEl.setAttribute("opacity", (0.08 + 0.4 * sm.Pen).toFixed(2));
  /* neurones fade and shrink as the core reaches them */
  neurons.forEach((n) => { const d = Math.hypot(n.x - COREX, n.y - COREY); const harm = clamp(sm.Core * 1.5 - d / 190); const flick = 1 + 0.08 * sm.Ex * Math.sin(tm / 220 + n.i * 2); place(n.g, n.x, n.y, Math.sin(tm / 900 + n.i) * 8, Math.max(0.3, (1 - 0.55 * harm) * flick)); n.g.style.opacity = (1 - 0.55 * harm).toFixed(2); });
  /* red cells: flow through, queue before a blocking clot, thin out beyond it */
  rbcs.forEach((r) => { r.x += r.v * 72 * Math.max(0.04, sm.Flow) * dt; if (sm.Flow < 0.25 && r.x > CLOTX - 40 && r.x < CLOTX - 8) r.x = CLOTX - 40 - Math.random() * 4; if (r.x > ARTE - 2) { r.x = 24; r.y = rnd(202, 234); } place(r.g, r.x, r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); r.g.style.opacity = r.x > CLOTX + 24 && sm.Flow < 0.3 ? 0.25 : 1; });
  /* embolus travelling from the heart aorta to the clot */
  const eu = (tm / 7000) % 1, ep = embTrk.at(eu); place(embG, ep.x, ep.y, ep.a, 0.7 + 0.3 * Math.sin(tm / 300)); embG.style.opacity = eu > 0.96 ? 0 : 0.95;
  heartWrap.setAttribute("transform", "translate(110 330) scale(" + (1 + 0.04 * Math.sin(tm / 420)).toFixed(3) + ") translate(-110 -330)");
  /* glutamate in the penumbra */
  acc.glut += dt * sm.Ex * 9; while (acc.glut >= 1) { acc.glut--; const p = free(gluts); if (p) { const an = rnd(0, 6.28), rr = rnd(0.35, 0.95); emit(p, COREX + Math.cos(an) * rr * prx, COREY + Math.sin(an) * rr * pry, Math.cos(an) * 9, Math.sin(an) * 7, 0); } }
  gluts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) kill(p); });
  /* thrombolysis dots flow in, sit on the clot, then crumble it downstream */
  acc.lys += dt * sm.lysis * 7; while (acc.lys >= 1) { acc.lys--; const p = free(lysDots); if (p) emit(p, rnd(36, 120), ARTY + rnd(-12, 12), rnd(55, 80), rnd(-4, 4), 0); }
  lysDots.forEach((p) => { if (!p.on) return; p.t += dt;
    if (!p.st) { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x >= clotX - 26 * clotS) { p.st = 1; p.t = 0; p.a = rnd(0, 6.28); } if (p.t > 5) kill(p); }
    else { p.x = clotX + Math.cos(p.a + tm / 900) * 26 * clotS; p.y = CLOTY + Math.sin(p.a + tm / 900) * 17 * clotS; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp((2.4 - p.t) / 0.8).toFixed(2)); if (p.t > 2.4) kill(p); } });
  acc.crumb += dt * sm.lysis * (2 + 6 * (1 - sm.Occ)); while (acc.crumb >= 1) { acc.crumb--; const p = free(crumbs); if (p) emit(p, clotX + rnd(0, 18) * clotS, CLOTY + rnd(-10, 10), rnd(45, 75), rnd(-8, 8), 0); }
  crumbs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.x - CLOTX) / 190).toFixed(2)); if (p.x > ARTE - 6 || p.t > 4) kill(p); });
  /* platelet streamers pile onto the clot unless coated by antiplatelet, then they slide past */
  acc.stream += dt * (2 + 5 * sm.Occ); while (acc.stream >= 1) { acc.stream--; const p = L.freeStream(); if (p) { p.on = true; p.x = 28; p.y = ARTY + rnd(-12, 12); p.vx = rnd(50, 70); p.vy = 0; p.t = 0; p.coat = 0; p.st = 0; p.a = rnd(0, 6.28); p.g.setAttribute("opacity", "1"); } }
  streams.forEach((p) => { if (!p.on) return; p.t += dt;
    const done = () => { p.on = false; p.g.setAttribute("opacity", "0"); };
    if (!p.st) { p.coat = Math.min(1, p.coat + dt * sm.anti * 1.6); p.cap.setAttribute("opacity", p.coat.toFixed(2)); p.x += p.vx * dt; p.g.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")");
      if (p.x > CLOTX - 44) { if (retract > 0.3 || sm.Occ < 0.25) p.st = 1; else if (p.coat > 0.55) { p.st = 1; p.vy = (p.y < CLOTY ? -1 : 1) * rnd(25, 45); } else { p.st = 2; p.t = 0; } } if (p.t > 8) done(); }
    else if (p.st === 1) { p.x += p.vx * dt; p.y += (p.vy || 0) * dt; p.g.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.g.setAttribute("opacity", clamp(1 - (p.x - CLOTX) / 90).toFixed(2)); if (p.x > CLOTX + 90 || p.t > 8) done(); }
    else { p.x = clotX + Math.cos(p.a) * 24 * clotS; p.y = CLOTY + Math.sin(p.a) * 16 * clotS; p.g.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) done(); } });
  /* antiplatelet capsules circulating in the artery */
  acc.ap += dt * sm.anti * 3; while (acc.ap >= 1) { acc.ap--; const p = free(apPills); if (p) emit(p, 28, ARTY + rnd(-12, 12), rnd(45, 65), 0, 0); }
  apPills.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); if (p.x > CLOTX - 20 || p.t > 6) kill(p); });
  /* treatment pills and caption follow the drug */
  $("st-cath-pill").style.opacity = clamp(sm.thromb * 3).toFixed(2); $("st-lys-pill").style.opacity = sm.lysis.toFixed(2); $("st-ap-pill").style.opacity = sm.anti.toFixed(2);
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
  /* gauges */
  gg.fl.set(sm.Flow, wordOf(sm.Flow, 0.3, 0.65, ["blocked", "reduced", "open"]));
  gg.core.set(sm.Core, wordOf(sm.Core, 0.18, 0.45, ["small", "growing", "large"]));
  gg.pen.set(sm.Pen, wordOf(sm.Pen, 0.25, 0.5, ["gone", "shrinking", "present"]));
  gg.glut.set(sm.Ex, wordOf(sm.Ex, 0.25, 0.5, ["low", "raised", "high"]));
  gg.death.set(sm.Core, wordOf(sm.Core, 0.18, 0.45, ["little", "spreading", "extensive"]));
  gg.def.set(sm.Def, wordOf(sm.Def, 0.3, 0.6, ["mild", "moderate", "severe"]));
  gg.clump.set(sm.Clump, wordOf(sm.Clump, 0.3, 0.6, ["calm", "slowing", "piling on"]));
}
run({ init, step });
