/* Pulmonary hypertension scene: the heart pumps into a remodelled pulmonary artery; the lung, kidney and fluid pool show the load, and each treatment visibly acts on the drawing. */
const L = { glow: $("glow"), art: $("art"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
let heartO = null, lungO = null, kidO = null;
let wallEl = null, calmEl = null, flowEl = null, glowEl = null, haloEl = null, dimEl = null, fluidEl = null, kidTint = null;
let capEl = null, capDrug = -1;
let trArt = null;
const wallDots = [], muscDots = [], clotCells = [], blockers = [], jetP = [];
function cbez(p0, c1, c2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]];
}
function edge(u, side, off) {
  const q = trArt.at(u), r = q.a / 57.2958;
  return [q.x + Math.cos(r + 1.5708) * off * side, q.y + Math.sin(r + 1.5708) * off * side, q.a];
}
function capText(d) {
  if (d === 1) return "Oxygen and water pill. Oxygen eases the tightening and the water pill drains fluid. The wall stays thick.";
  if (d === 2) return "Vessel relaxer. It sits on the wall and the vessel opens, so pressure falls.";
  if (d === 3) return "Cause treated. The clot clears and the vessel opens widest, so the heart recovers best.";
  return "No treatment. The tight vessel keeps pressure high and the strained heart cannot keep up.";
}
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 170, 235, 170, {});
  lungO = organ($("lungSlot"), "lung", 650, 235, 210, {});
  kidO = organ($("kidSlot"), "kidney", 860, 300, 110, {});
  const HP = heartO.ports.pulm, LH = lungO.ports.hilumL;
  const C1 = [HP[0] + 160, HP[1] - 10], C2 = [LH[0] - 170, LH[1] - 70];
  const d = "M" + f1(HP[0]) + " " + f1(HP[1]) + "C" + f1(C1[0]) + " " + f1(C1[1]) + " " + f1(C2[0]) + " " + f1(C2[1]) + " " + f1(LH[0]) + " " + f1(LH[1]);
  glowEl = mk("ellipse", { class: "ph-glow", cx: heartO.x, cy: heartO.y, rx: 110, ry: 140, opacity: 0 }, L.glow);
  wallEl = mk("path", { class: "ph-wall", d: d }, L.art);
  calmEl = mk("path", { class: "ph-calm", d: d, opacity: 0 }, L.art);
  flowEl = mk("path", { class: "ph-flow", d: d }, L.art);
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(cbez(HP, C1, C2, LH, i / 8));
  trArt = track(pts);
  for (let i = 0; i < 11; i++) {
    const u = 0.08 + 0.84 * i / 10, side = i % 2 ? 1 : -1;
    wallDots.push({ g: cell(L.cells, { cls: "endo", r: 9, nuc: 0.3, seed: i + 1, wob: 0.06, n: 8 }), u: u, side: side });
  }
  for (let i = 0; i < 8; i++) {
    const u = 0.12 + 0.76 * i / 7, side = i % 2 ? 1 : -1;
    muscDots.push({ g: cell(L.cells, { cls: "sm", r: 9, nuc: 0.35, seed: i + 50, wob: 0.1, n: 8 }), u: u, side: side });
  }
  const cq = trArt.at(0.8);
  for (let i = 0; i < 5; i++) {
    clotCells.push({ g: cell(L.cells, { cls: "plt", r: 5 + (i % 3), seed: i + 90, wob: 0.15, n: 7 }), dx: -14 + i * 7, dy: (i % 2) * -5, x: cq.x, y: cq.y });
  }
  [0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.9, 0.26].forEach((u, i) => {
    const g = mk("g", {}, L.parts);
    mk("rect", { class: "sc-p p-blk", x: -4.5, y: -2.2, width: 9, height: 4.4, rx: 2.2 }, g);
    g.setAttribute("opacity", "0");
    blockers.push({ g: g, u: u, side: i % 2 ? 1 : -1 });
  });
  for (let i = 0; i < 10; i++) jetP.push({ e: mk("circle", { class: "ph-jet", r: 2.4, opacity: 0 }, L.parts), u: i / 10 });
  dimEl = mk("ellipse", { class: "ph-dim", cx: lungO.x, cy: lungO.y, rx: lungO.w * 0.42, ry: lungO.h * 0.44, opacity: 0 }, L.cells);
  haloEl = mk("ellipse", { class: "ph-halo", cx: lungO.x, cy: lungO.y, rx: lungO.w * 0.42, ry: lungO.h * 0.44, opacity: 0 }, L.cells);
  kidTint = mk("ellipse", { class: "ph-halo", cx: kidO.x, cy: kidO.y, rx: kidO.w * 0.4, ry: kidO.h * 0.38, opacity: 0 }, L.cells);
  fluidEl = mk("ellipse", { class: "ph-fluid", cx: 860, cy: 410, rx: 70, ry: 20 }, L.cells);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, j: 0 }; }); }
const rbcP = pool(16, () => { const g = mk("g", { class: "cl cl-rbc" }, L.parts); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return g; });
rbcP.forEach((p) => { p.u = Math.random(); p.j = rnd(-1, 1); p.e.setAttribute("opacity", "1"); });
const oxyP = pool(14, () => mk("circle", { class: "sc-p p-oxy", r: 2.2 }, L.parts));
const conP = pool(14, () => mk("path", { class: "sc-p p-con", d: "M0 -3L3 0L0 3L-3 0Z" }, L.parts));
const dripP = pool(8, () => mk("circle", { class: "sc-p p-drip", r: 2.4 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges ---- */
const gg = {};
function initPanel() {
  const eW = edge(0.32, -1, 20), eL = trArt.at(0.55), eC = trArt.at(0.8);
  pill(L.over, "Heart", 105, 250, 110, 66, "Heart: the right side pumps blood to the lungs. Against high pressure its wall thickens, then the chamber stretches and fails.");
  pill(L.over, "Artery wall", eW[0], eW[1], 300, 66, "Artery wall: faulty lining and tight muscle thicken the wall around a narrower passage. The relaxer eases the muscle.");
  pill(L.over, "Tight vessel", eL.x, eL.y, 470, 66, "Tight vessel: remodelling plus tightening shrink the passage, so resistance and pressure rise.");
  pill(L.over, "Old clot", eC.x, eC.y, 595, 66, "Old clot: leftover clot that never cleared scars the artery partly shut. Treating the cause clears it.");
  pill(L.over, "Lung", 700, 140, 700, 66, "Lung: low oxygen here tightens nearby vessels. Extra oxygen eases that tightening.");
  pill(L.over, "Kidney", kidO.ports.hilum[0], kidO.ports.hilum[1], 860, 66, "Kidney: back pressure plus low output congest the kidney, so fluid is held and swelling worsens.");
  pill(L.over, "Fluid", 830, 406, 700, 392, "Fluid: raised venous pressure pushes fluid into the tissues. The water pill drains it away.");
  capEl = mk("text", { class: "ph-cap", x: 30, y: 428 }, L.over); capEl.textContent = capText(0);
  const P = L.panel, y0 = 478, h = 52, xs = [130, 270, 410, 550, 690, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pap", "Pressure", "g-pap", "Pulmonary arterial pressure: the load the right ventricle must generate. It rises with vascular resistance."], ["pvr", "Resistance", "g-cyt", "Pulmonary vascular resistance: remodelling and tightening of the small lung vessels raise it."], ["strain", "RV strain", "g-neu", "Right ventricular strain: the wall thickens first, then the chamber stretches as the ventricle gives way."], ["out", "Output", "g-good", "Cardiac output: held at rest for a long stage, it cannot rise on exercise and falls when the ventricle fails."], ["cong", "Congestion", "g-fl", "Venous congestion: fluid buildup from back pressure. A water pill unloads it."], ["dys", "Dyspnea", "g-bad", "Dyspnea: breathlessness on exercise first, then at rest, from low output reserve and congested lungs."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); });
}
/* ---- animation ---- */
const sm = { sev: 0.65, pvr: 0.6, pap: 0.6, hyp: 0.6, dil: 0.4, strain: 0.5, output: 0.6, cong: 0.3, dys: 0.5, oxy: 0, vaso: 0, cause: 0 };
const acc = { oxy: 0, con: 0, drip: 0 };
let beat = 0;
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 2.0);
  sm.sev = lerp(sm.sev, m.a, k1); sm.pvr = lerp(sm.pvr, m.pvr, k1); sm.pap = lerp(sm.pap, m.pap, k1);
  sm.hyp = lerp(sm.hyp, m.hyp, k1); sm.dil = lerp(sm.dil, m.dil, k1); sm.strain = lerp(sm.strain, m.strain, k1);
  sm.output = lerp(sm.output, m.output, k1); sm.cong = lerp(sm.cong, m.cong, k1); sm.dys = lerp(sm.dys, m.dys, k1);
  sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.vaso = lerp(sm.vaso, m.vaso, k1); sm.cause = lerp(sm.cause, m.cause, k1);
  /* the wall thickens and the passage narrows with resistance; treatment opens it again */
  const outerW = 28 + 16 * sm.pvr, innerW = Math.max(6, 30 - 22 * sm.pvr);
  wallEl.setAttribute("stroke-width", f1(outerW));
  calmEl.setAttribute("stroke-width", f1(outerW - 2));
  calmEl.setAttribute("opacity", clamp(sm.vaso * 0.9 + sm.cause).toFixed(2));
  flowEl.setAttribute("stroke-width", f1(innerW));
  wallDots.forEach((o, i) => { const p = edge(o.u, o.side, innerW / 2 + 3); place(o.g, p[0], p[1] + Math.sin(tm / 800 + i) * 0.7, 0, 1); });
  const ms = 0.8 + 0.55 * sm.pvr;
  muscDots.forEach((o) => { const p = edge(o.u, o.side, outerW / 2 - 2); place(o.g, p[0], p[1], 0, ms); });
  /* leftover clot scars the passage shut until the cause is treated */
  const csc = clamp(sm.sev * 1.2) * (1 - 0.95 * sm.cause);
  clotCells.forEach((c) => { place(c.g, c.x + c.dx * csc, c.y + c.dy * csc, 0, Math.max(0.001, csc)); c.g.style.opacity = csc > 0.03 ? "1" : "0"; });
  /* relaxer capsules park on the wall while tightening signals fade downstream */
  blockers.forEach((b) => { const p = edge(b.u, b.side, outerW / 2 + 5); place(b.g, p[0], p[1], p[2], 1); b.g.setAttribute("opacity", sm.vaso.toFixed(2)); });
  /* the strained heart glows and beats harder; the chamber stretches as it fails */
  beat += dt * (0.85 + 0.3 * sm.pap);
  const ph = beat % 1, cph = Math.pow(Math.max(0, Math.sin(ph * 6.2832 * 0.5 + 0.2)), 1.2) * (ph < 0.5 ? 1 : 0);
  place(heartO.g, heartO.x, heartO.y, 0, 1 + 0.10 * sm.dil + 0.02 * cph);
  glowEl.setAttribute("rx", f1(90 + 50 * sm.strain)); glowEl.setAttribute("ry", f1(110 + 50 * sm.strain));
  glowEl.setAttribute("opacity", (0.10 + 0.25 * sm.strain).toFixed(2));
  /* low oxygen dims the lung; extra oxygen brightens it again */
  dimEl.setAttribute("opacity", (sm.hyp * 0.35 * (1 - 0.4 * sm.oxy)).toFixed(2));
  haloEl.setAttribute("opacity", (0.5 * clamp(sm.oxy + 0.6 * sm.cause)).toFixed(2));
  kidTint.setAttribute("opacity", (sm.cong * 0.45).toFixed(2));
  fluidEl.setAttribute("ry", f1(8 + 20 * sm.cong));
  fluidEl.setAttribute("opacity", (0.15 + 0.55 * sm.cong).toFixed(2));
  /* red cells squeeze through the passage; the pulse wave speeds with pressure */
  rbcP.forEach((p) => { p.u = (p.u + dt * (0.10 + 0.28 * sm.output)) % 1; const q = trArt.at(p.u), r = q.a / 57.2958;
    const j = p.j * Math.max(1, innerW / 2 - 5);
    place(p.e, q.x + Math.cos(r + 1.5708) * j, q.y + Math.sin(r + 1.5708) * j, Math.sin(tm / 500 + p.u * 40) * 8, 1); });
  jetP.forEach((p) => { p.u = (p.u + dt * (0.2 + 0.5 * sm.pap)) % 1; const q = trArt.at(p.u); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", clamp(0.15 + 0.8 * sm.output).toFixed(2)); });
  /* oxygen drifts over the air sacs; tightening signals hug the wall; the water pill drains fluid */
  acc.oxy += dt * (2 + 9 * sm.oxy + 6 * sm.cause + 2 * (1 - sm.pvr));
  while (acc.oxy >= 1) { acc.oxy--; const p = freeP(oxyP); if (p) emitP(p, rnd(570, 740), rnd(130, 340), rnd(-5, 5), rnd(-7, -2)); }
  oxyP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 560, 750); p.y = clamp(p.y, 120, 350); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) killP(p); });
  acc.con += dt * sm.pvr * 7 * (1 - 0.7 * sm.oxy) * (1 - 0.8 * sm.vaso) * (1 - 0.5 * sm.cause);
  while (acc.con >= 1) { acc.con--; const p = freeP(conP); if (p) { const u = rnd(0.1, 0.9), s = Math.random() < 0.5 ? 1 : -1, e = edge(u, s, innerW / 2 + rnd(6, 14)); emitP(p, e[0], e[1], rnd(-4, 4), rnd(-3, 3)); } }
  conP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  acc.drip += dt * 8 * sm.oxy;
  while (acc.drip >= 1) { acc.drip--; const p = freeP(dripP); if (p) emitP(p, rnd(800, 920), 414, rnd(-2, 2), rnd(30, 50)); }
  dripP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - 414) / 30).toFixed(2)); if (p.y > 444) killP(p); });
  /* gauges and the stage caption follow the state */
  gg.pap.set(sm.pap, wordOf(sm.pap, 0.40, 0.72, ["near normal", "raised", "very high"])); gg.pvr.set(sm.pvr, wordOf(sm.pvr, 0.35, 0.65, ["low", "raised", "high"]));
  gg.strain.set(sm.strain, wordOf(sm.strain, 0.35, 0.65, ["mild", "strained", "failing"])); gg.out.set(sm.output, wordOf(sm.output, 0.38, 0.66, ["low", "reduced", "held"]));
  gg.cong.set(sm.cong, wordOf(sm.cong, 0.28, 0.62, ["none", "some", "marked"])); gg.dys.set(sm.dys, wordOf(sm.dys, 0.3, 0.6, ["none", "on effort", "at rest"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
