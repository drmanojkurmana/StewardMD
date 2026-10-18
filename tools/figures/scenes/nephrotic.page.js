/* Nephrotic scene: podocytes and filter wall, protein leak to urine, low albumin, oedema, lipids, clot and infection risk, gauges. */
const WW = SC.W;
const layers = { glom: $("glom"), vess: $("vess"), tiss: $("tiss"), risk: $("risk"), parts: $("parts"), over: $("over"), panel: $("panel"), oed: $("oedema") };
const E = {};
const pods = [];
const tissCells = [];
const bacCells = [];
let teethG = null, effBand = null, depG = null, scarG = null, clotG = null;
function initGlom() {
  const tuftPts = [[150, 185], [205, 180], [178, 220], [145, 240], [210, 238]];
  tuftPts.forEach(([x, y], i) => { const c = cell(layers.glom, { cls: "tuft", r: 27, nuc: 0.32, seed: i * 2 + 1, wob: 0.1 }); place(c, x, y, i * 24, 1); });
  mk("circle", { class: "np-gbm", cx: 178, cy: 212, r: 72 }, layers.glom);
  effBand = mk("circle", { class: "np-eff", cx: 178, cy: 212, r: 78 }, layers.glom);
  teethG = mk("g", {}, layers.glom);
  for (let i = 0; i < 28; i++) { const a = (i / 28) * 6.283, x1 = 178 + Math.cos(a) * 73, y1 = 212 + Math.sin(a) * 73, x2 = 178 + Math.cos(a) * 84, y2 = 212 + Math.sin(a) * 84; mk("path", { class: "np-tooth", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, teethG); }
  depG = mk("g", { opacity: "0" }, layers.glom);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283 + 0.2; mk("circle", { class: "np-dep", cx: f1(178 + Math.cos(a) * 80), cy: f1(212 + Math.sin(a) * 80), r: 4.2 }, depG); }
  scarG = mk("g", { opacity: "0" }, layers.glom);
  const scarPath = mk("path", { class: "np-scar", d: "M205 238L252 258L238 292L200 272Z" }, scarG); scarPath.style.opacity = "1";
  mk("path", { class: "fibrin", d: "M210 250L244 282M244 250L210 282" }, scarG);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283 + 0.5, x = 178 + Math.cos(a) * 94, y = 212 + Math.sin(a) * 94, c = cell(layers.glom, { cls: "pod", r: 12, nuc: 0.42, seed: i * 3 + 2, wob: 0.14 }); place(c, x, y, i * 40, 1); pods.push(c); }
  mk("rect", { class: "np-mini", x: 382, y: 356, width: 242, height: 38, rx: 19 }, layers.risk);
  clotG = mk("g", {}, layers.risk);
  for (let j = 0; j < 6; j++) { const p = cell(clotG, { cls: "plt2", r: 6, x: Math.cos(j * 1.4) * 11, y: Math.sin(j * 2) * 6, seed: j + 3, wob: 0.15, n: 7 }); }
  for (let j = 0; j < 5; j++) mk("path", { class: "fibrin", d: "M" + f1(478 + rnd(-18, 18)) + " " + f1(374 + rnd(-10, 10)) + "L" + f1(478 + rnd(-18, 18)) + " " + f1(374 + rnd(-10, 10)) }, clotG);
  const bacPts = [[705, 368], [760, 390], [825, 365], [875, 392], [795, 405]];
  bacPts.forEach(([x, y], i) => { const b = cell(layers.risk, { cls: "bac", r: 8, nuc: 0.3, seed: i * 2 + 5, wob: 0.16 }); place(b, x, y, i * 35, 1); bacCells.push(b); });
  const tissPts = [[440, 225], [560, 252], [680, 222], [800, 252], [885, 225], [620, 272]];
  tissPts.forEach(([x, y], i) => { const c = cell(layers.tiss, { cls: "endo", r: 14, nuc: 0.3, seed: i * 2 + 8, wob: 0.1 }); place(c, x, y, 0, 1); tissCells.push({ g: c, x, y }); });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, lane: 0 }; }); }
const prot = pool(28, () => mk("circle", { class: "sc-p p-prot", r: 3 }, layers.parts));
const drops = pool(24, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const igg = pool(12, () => mk("circle", { class: "sc-p p-igg", r: 2.6 }, layers.parts));
const rxp = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function lanePool(n, build, laneBase) { const pl = pool(n, build); pl.forEach((p, i) => { p.x = rnd(378, 918); p.lane = laneBase + (i % 3) * 10; p.vx = rnd(28, 46); }); return pl; }
const albP = lanePool(18, () => mk("circle", { class: "sc-p p-alb", r: 3 }, layers.parts), -12);
const lipP = lanePool(14, () => mk("circle", { class: "sc-p p-lip", r: 4 }, layers.parts), 4);
function rideLane(pl, dt, frac, cy) { const want = Math.round(clamp(frac) * pl.length); pl.forEach((p, i) => { const on = i < want; if (!on) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.x += p.vx * dt; if (p.x > 922) p.x = 374; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(cy + p.lane) + ")"); }); }
/* ---- labels and gauges ---- */
const gg = {};
const rxPills = {};
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 260, 410, 560, 710, 860];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient and urine";
  [["leak", "Protein leak", "g-alb", "Albumin escaping through the damaged glomerular filter into the urine (heavy proteinuria). A steroid or immunosuppression can repair the injury in some lesions, and an ACE inhibitor cuts the leak."],
    ["alb", "Albumin", "g-good", "Blood albumin. It falls as albumin is lost in the urine (hypoalbuminaemia), so less water is held inside the blood vessel."],
    ["oed", "Oedema", "g-fl", "Fluid that has left the blood and collected in the tissues because blood albumin is low. A diuretic helps remove it."],
    ["lip", "Lipids", "g-lip", "Blood lipids. The liver makes more lipid carrying particles in response to the protein loss, so lipids rise (hyperlipidaemia)."],
    ["clot", "Clot risk", "g-clot", "Risk of a blood clot (thrombosis). Defence and regulatory proteins are lost in the urine while the liver makes more clotting proteins."],
    ["inf", "Infection risk", "g-dep", "Risk of infection. Antibodies and other defence proteins are lost in the urine, so defence against bacteria is weaker."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Podocytes", 118, 138, 82, 88, "Podocytes: cells that wrap the filter capillaries. Their foot processes form part of the barrier that normally keeps albumin in the blood.");
  pill(ox, "Foot processes", 232, 162, 292, 92, "Foot processes: the small feet of the podocyte on the filter wall. In nephrotic syndrome they spread flat and fuse (effacement), so the barrier leaks. Effacement is diffuse in minimal change disease.");
  pill(ox, "Filter wall", 242, 248, 318, 275, "The filter wall: endothelium, basement membrane and podocyte foot processes together. Immune deposits under the podocytes thicken it in membranous disease, and a scarred segment replaces it in FSGS.");
  pill(ox, "Protein in urine", 268, 384, 305, 352, "Protein in the urine: albumin that has crossed the leaky filter and travels down the tubule. Heavy proteinuria is the defining leak of nephrotic syndrome.");
  pill(ox, "Albumin", 480, 115, 545, 62, "Albumin in the blood. It holds water inside the vessel. When it is lost in the urine, blood albumin falls and fluid moves out into the tissues.");
  pill(ox, "Lipids", 770, 118, 800, 62, "Lipid particles in the blood. The liver increases lipid production when albumin is lost, causing hyperlipidaemia.");
  pill(ox, "Oedema", 760, 232, 880, 170, "Oedema: fluid collected in the tissue space after leaving the blood because albumin is low. It shows here as blue fluid between the tissue cells.");
  pill(ox, "Clot", 505, 374, 560, 305, "A clot forming in a small vein. Loss of clot regulating proteins in the urine and extra clotting proteins from the liver raise thrombosis risk.");
  pill(ox, "Weak defence", 770, 378, 790, 305, "Weak defence: bacteria meet fewer antibodies because defence proteins are lost in the urine, so infection risk rises.");
  rxPills.steroid = pill(ox, "Steroid", 215, 155, 600, 170, "A steroid calms podocyte injury. It works best in minimal change disease, partly in FSGS, and little on its own in membranous disease.");
  rxPills.ace = pill(ox, "ACE and diuretic", 215, 155, 600, 170, "An ACE inhibitor lowers pressure inside the glomerulus and cuts protein leak, and a diuretic removes oedema fluid. The filter injury itself remains.");
  rxPills.immuno = pill(ox, "Immune therapy", 215, 155, 600, 170, "Immunosuppression dampens immune injury to the filter. It is shown strongest in membranous disease and partly in FSGS.");
}
const urineTrack = track([[205, 248], [188, 322], [188, 384], [268, 384]]);
const sm = { leak: 0.7, efface: 0.7, albumin: 0.4, oedema: 0.6, lipids: 0.6, clot: 0.6, infection: 0.6, deposits: 0.1, sclerosis: 0.1, steroid: 0, ace: 0, immuno: 0 };
const KEYS = Object.keys(sm);
const acc = { prot: 0, drop: 0, igg: 0, rx: 0 };
function init() { initGlom(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  teethG.setAttribute("opacity", clamp(1 - sm.efface).toFixed(2));
  effBand.setAttribute("opacity", (sm.efface * 0.75).toFixed(2));
  depG.setAttribute("opacity", sm.deposits.toFixed(2));
  scarG.setAttribute("opacity", sm.sclerosis.toFixed(2));
  if (scarG.firstChild) scarG.firstChild.style.opacity = sm.sclerosis > 0.05 ? "1" : "0";
  pods.forEach((p, i) => { p.style.opacity = i === 4 ? (1 - 0.75 * sm.sclerosis).toFixed(2) : "1"; });
  layers.oed.setAttribute("opacity", (sm.oedema * 0.5).toFixed(2));
  tissCells.forEach((c, i) => { const spread = 1 + sm.oedema * 0.1; place(c.g, 647 + (c.x - 647) * spread, c.y + Math.sin(tm / 900 + i) * 1.5, 0, 1); });
  place(clotG, 505, 374, 0, 0.25 + 0.95 * sm.clot); clotG.style.opacity = sm.clot > 0.08 ? "1" : "0";
  bacCells.forEach((b, i) => { const s = 0.45 + 0.75 * sm.infection; place(b, [705, 760, 825, 875, 795][i], [368, 390, 365, 392, 405][i], i * 35 + Math.sin(tm / 500 + i) * 8, s); });
  rideLane(albP, dt, sm.albumin, 115);
  rideLane(lipP, dt, sm.lipids, 115);
  acc.prot += dt * sm.leak * 7; while (acc.prot >= 1) { acc.prot--; const p = free(prot); if (p) { emit(p, 205, 248, 0, 0); } }
  prot.forEach((p) => { if (!p.on) return; p.u += dt * (0.12 + 0.1 * sm.leak); if (p.u >= 1) { kill(p); return; } const q = urineTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.drop += dt * sm.oedema * 8; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(390, 910), 150, rnd(-3, 3), rnd(18, 30)); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 282) kill(p); });
  acc.igg += dt * (1 - sm.infection) * 3.2; while (acc.igg >= 1) { acc.igg--; const p = free(igg); if (p) emit(p, 672, rnd(360, 408), rnd(22, 36), rnd(-5, 5)); }
  igg.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 918) kill(p); });
  const rxAny = Math.max(sm.steroid, sm.ace, sm.immuno);
  acc.rx += dt * rxAny * 2.6; while (acc.rx >= 1) { acc.rx--; const p = free(rxp); if (p) emit(p, 592, 166, 0, 0); }
  rxp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (218 - p.x) * dt * 0.55; p.y += (160 - p.y) * dt * 0.55; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6) kill(p); });
  setVis(rxPills.steroid, clamp(sm.steroid)); setVis(rxPills.ace, clamp(sm.ace)); setVis(rxPills.immuno, clamp(sm.immuno));
  gg.leak.set(sm.leak, wordOf(sm.leak, 0.3, 0.62, ["mild", "heavy", "very heavy"]));
  gg.alb.set(sm.albumin, wordOf(sm.albumin, 0.4, 0.7, ["low", "reduced", "near normal"]));
  gg.oed.set(sm.oedema, wordOf(sm.oedema, 0.3, 0.62, ["none", "present", "marked"]));
  gg.lip.set(sm.lipids, wordOf(sm.lipids, 0.35, 0.65, ["normal", "raised", "high"]));
  gg.clot.set(sm.clot, wordOf(sm.clot, 0.3, 0.62, ["low", "raised", "high"]));
  gg.inf.set(sm.infection, wordOf(sm.infection, 0.3, 0.62, ["low", "raised", "high"]));
}
run({ init, step });
