/* DIC scene: trigger chips, tissue factor switching on a capillary that feeds the kidney, microthrombi blocking flow, consumption pools, fibrinolysis, bleeding and gauges. */
const WW = SC.W;
const layers = { chips: $("chips"), tf: $("tfnode"), lumen: $("lumen"), feed: $("kidneyFeed"), endo: $("endo"), rbc: $("rbcs"), clots: $("clots"), parts: $("parts"), kid: $("kidSlot"), lower: $("lower"), over: $("over"), panel: $("panel") };
const CY = 240, HH = 42, WALL_N = 26;
/* ---- endothelium ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 13, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
/* ---- tissue factor node with a treatment blocker cap ---- */
let tfNode, blockG;
function initTf() { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Tissue factor on injured tissue, activated endothelium and monocytes starts the clotting cascade everywhere at once, not just at one wound." }, layers.tf);
  tfNode = mk("rect", { class: "dic-tf", x: 400, y: 140, width: 160, height: 36, rx: 10 }, g);
  blockG = mk("g", { opacity: "0" }, layers.tf);
  mk("rect", { class: "dic-block", x: 388, y: 130, width: 184, height: 56, rx: 12 }, blockG);
  mk("path", { class: "dic-blockx", d: "M404 138L556 168M556 138L404 168" }, blockG); }
/* ---- red cells and flowing platelets ---- */
const rbcs = [], fplts = [];
function initFlow() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
  for (let i = 0; i < 16; i++) { const g = mk("g", {}, layers.rbc); cell(g, { cls: "plt", r: 5, seed: i + 3, wob: 0.15, n: 7 }); fplts.push({ g, x: rnd(0, WW), y: rnd(-0.7, 0.7), v: rnd(0.85, 1.15), i }); } }
/* ---- microthrombi clusters ---- */
const clots = [[170, 1], [320, -1], [470, 1], [620, -1], [720, 1]].map(([x, side], i) => { const g = mk("g", {}, layers.clots);
  for (let j = 0; j < 6; j++) cell(g, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.3) * 9, y: Math.sin(j * 2.1) * 6 * -side, seed: j + i, wob: 0.15, n: 7 });
  for (let j = 0; j < 5; j++) mk("path", { class: "dic-fib", d: "M" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) + "L" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) }, g);
  return { g, x, side, i }; });
/* ---- kidney fed by the capillary: vessel and cells end at its hilum ---- */
let kidneyO = null, feedX = 800, iscOverlay = null;
function initOrgans() {
  kidneyO = organ(layers.kid, "kidney", 860, 235, 140, {});
  const P = kidneyO.ports, entry = P.hilum || P.in;
  feedX = Math.round(entry[0]) - 4;
  layers.lumen.setAttribute("width", f1(feedX - 14));
  layers.feed.setAttribute("d", "M" + f1(feedX - 34) + " " + f1(CY) + " L" + f1(entry[0] + 4) + " " + f1(entry[1]));
  iscOverlay = mk("ellipse", { class: "dic-isc", cx: kidneyO.x, cy: kidneyO.y + 3, rx: f1(kidneyO.w * 0.33), ry: f1(kidneyO.h * 0.36), opacity: "0" }, layers.kid);
}
/* ---- lower: consumption pools and fibrinolysis ---- */
const tanks = {};
let fibGroup;
function initLower() { const L = layers.lower;
  [["pl", "Platelets", 322, "dic-fill-p", "Platelets are trapped in microthrombi all over the circulation, so the circulating count falls."], ["fg", "Fibrinogen", 350, "dic-fill-f", "Fibrinogen is turned into fibrin in vessels everywhere and is used up, so later clots are weak."], ["fac", "Clotting factors", 378, "dic-fill-c", "Clotting factors are consumed by widespread activation. PT and aPTT lengthen as they fall."]].forEach(([id, name, y, cls, tip]) => {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L);
    const t = mk("text", { class: "dic-lab2", x: 40, y: y + 4 }, g); t.textContent = name;
    mk("rect", { class: "dic-tank", x: 150, y: y - 7, width: 260, height: 14, rx: 7 }, g);
    tanks[id] = mk("rect", { class: cls, x: 150, y: y - 7, width: 260, height: 14, rx: 7 }, g); });
  const fg = mk("g", { class: "hot", tabindex: "0", "data-info": "Fibrinolysis: plasmin breaks fibrin down as fast as it forms. The fragments, including D-dimer, rise in the blood." }, L); fibGroup = fg;
  mk("path", { class: "dic-fib", d: "M472 348L504 340L520 352L552 342L580 350" }, fg);
  mk("path", { class: "dic-fib", d: "M480 366L512 374L538 362L566 372" }, fg);
  mk("path", { class: "dic-fib", d: "M524 338L518 356M548 346L556 364" }, fg); }
/* ---- particle pools (element exposed as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tfP = pool(20, () => mk("path", { class: "sc-p p-tf", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const ddP = pool(18, () => mk("rect", { class: "sc-p p-ddim", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const repP = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const bldP = pool(14, () => mk("path", { class: "dic-drop", d: "M0 -3.2C2 -.5 2.6 .8 2.6 1.7A2.6 2.6 0 0 1 -2.6 1.7C-2.6 .8 -2 -.5 0 -3.2Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges ---- */
const gg = {};
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Cause treated. No new clots start, flow returns and pools recover.";
  if (d === 2) return "Products replaced. Pools refill but new clots keep forming.";
  if (d === 3) return "Cause treated and products replaced. Clots clear and bleeding stops.";
  return "No treatment. Clots block small vessels, pools run low and blood oozes.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["mic", "Microthrombi", "g-mic", "Widespread microthrombi: tiny platelet and fibrin clots in small vessels everywhere."], ["pl", "Platelets", "g-pool", "Circulating platelets. They fall as platelets are consumed in microthrombi."], ["fg", "Fibrinogen", "g-pool", "Fibrinogen, the factor that becomes fibrin. It falls as it is used up."], ["dd", "D-dimer", "g-dd", "D-dimer, a fibrin breakdown product. It rises when fibrin is formed and dissolved, as in DIC."], ["bl", "Bleeding", "g-bad", "Bleeding tendency: with platelets and factors gone, clots are weak and blood oozes from lines, wounds and mucosa."], ["flow", "Organ flow", "g-flow", "Blood flow through small vessels in organs. Microthrombi block it and cause ischaemia."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Trigger", 115, 80, 115, 122, "A trigger switches clotting on everywhere: sepsis, major trauma, malignancy or an obstetric emergency.");
  pill(ox, "Tissue factor", 480, 158, 480, 122, "Tissue factor from injured tissue, placenta, tumour or activated cells starts clotting throughout the circulation. Treating the cause caps it.");
  pill(ox, "Microthrombi", 470, 222, 300, 180, "Microthrombi: widespread tiny clots of platelets and fibrin inside small vessels. They block flow and use up clotting material.");
  pill(ox, "Kidney", 872, 308, 862, 408, "Kidney: microthrombi block its small vessels, so it is starved of blood. Lung, brain and skin suffer the same way.");
  pill(ox, "Pools fall", 280, 350, 220, 408, "Platelets, fibrinogen and clotting factors are used up in microthrombi, so later clots are weak. Replacing products refills them.");
  pill(ox, "Fibrinolysis", 530, 356, 530, 408, "Fibrinolysis dissolves fibrin as fast as it forms and releases D-dimer, so D-dimer is raised while DIC is active.");
  pill(ox, "Bleeding", 640, 340, 710, 408, "With platelets and factors depleted, blood oozes from puncture sites, wounds and mucosa while small vessels keep clotting.");
  capEl = mk("text", { class: "dic-story", x: 30, y: 438 }, ox); capEl.textContent = capText(0);
}
const sm = { TF: 0.4, M: 0.3, Pl: 0.7, Fg: 0.7, Fac: 0.7, Dd: 0.3, Bl: 0.2, Flow: 0.7, Isc: 0.3, Fib: 0.3, cause: 0, rep: 0 };
const acc = { tf: 0, dd: 0, rep: 0, bld: 0 };
function init() { initEndo(); initTf(); initFlow(); initOrgans(); initLower(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.TF = lerp(sm.TF, m.TF, k2); sm.M = lerp(sm.M, m.M, k2); sm.Pl = lerp(sm.Pl, m.Pl, k2); sm.Fg = lerp(sm.Fg, m.Fg, k2); sm.Fac = lerp(sm.Fac, m.Fg, k2); sm.Dd = lerp(sm.Dd, m.Dd, k2); sm.Bl = lerp(sm.Bl, m.Bl, k1); sm.Flow = lerp(sm.Flow, m.Flow, k1); sm.Isc = lerp(sm.Isc, m.Isc, k1); sm.Fib = lerp(sm.Fib, m.Fib, k2); sm.cause = lerp(sm.cause, m.cause, k1); sm.rep = lerp(sm.rep, m.rep, k1);
  const wallT = CY - HH - 4, wallB = CY + HH + 4;
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1));
  endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.style.setProperty("--act", sm.TF.toFixed(2)); }));
  if (tfNode) tfNode.style.setProperty("--act", sm.TF.toFixed(2));
  /* treating the cause caps the trigger: chips dim, the blocker sits on the node, TF particles stop */
  layers.chips.setAttribute("opacity", (1 - 0.55 * sm.cause).toFixed(2));
  if (blockG) blockG.setAttribute("opacity", sm.cause.toFixed(2));
  /* tissue factor particles: chips down through the node into the vessel */
  acc.tf += dt * sm.TF * (1 - sm.cause) * 7; while (acc.tf >= 1) { acc.tf--; const p = freeP(tfP); if (p) emit(p, rnd(60, 900), 102, rnd(-6, 6), rnd(30, 46), 0); }
  tfP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (480 - p.x) * dt * 0.55 + p.vx * dt; p.y += p.vy * dt; if (p.y > 176) p.vy = rnd(18, 26); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > wallT - 4 || p.t > 3.2) kill(p); });
  /* red cells and platelets flow into the kidney, slowed and trapped by microthrombi */
  const flowK = clamp(0.2 + 0.85 * sm.Flow);
  rbcs.forEach((r) => { r.x += r.v * 62 * flowK * dt; if (r.x > feedX) { r.x = -12; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * (HH - 12), r.rot + Math.sin(tm / 500 + r.x) * 9, 1); });
  fplts.forEach((p) => { p.x += p.v * 66 * flowK * dt; if (p.x > feedX) { p.x = -10; p.y = rnd(-0.7, 0.7); } place(p.g, p.x, CY + p.y * (HH - 12), 0, 1); p.g.style.opacity = (p.i / fplts.length < sm.Pl ? 1 : 0.12).toFixed(2); });
  clots.forEach((c) => { const s = clamp((sm.M - 0.1 * c.i) * 2.1); place(c.g, c.x, c.side > 0 ? wallT + 15 : wallB - 15, 0, 0.12 + 0.88 * s); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* D-dimer fragments leave the clots */
  acc.dd += dt * sm.Dd * 6; while (acc.dd >= 1) { acc.dd--; const p = freeP(ddP), c = pick(clots); if (p && c) emit(p, c.x + rnd(-12, 12), CY + rnd(-18, 18), rnd(22, 38), rnd(-7, 7), 0); }
  ddP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, feedX - 6)) + " " + f1(clamp(p.y, CY - HH + 8, CY + HH - 8)) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4 || p.x > feedX - 10) kill(p); });
  /* replacement products enter from the left when selected */
  acc.rep += dt * sm.rep * 5; while (acc.rep >= 1) { acc.rep--; const p = freeP(repP); if (p) emit(p, -8, CY + rnd(-HH + 14, HH - 14), 78, 0, 0); }
  repP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); if (p.x > feedX) kill(p); });
  /* bleeding drops leak from the lower wall */
  acc.bld += dt * clamp((sm.Bl - 0.25) * 2) * 5; while (acc.bld >= 1) { acc.bld--; const p = freeP(bldP); if (p) emit(p, rnd(600, 650), wallB + 4, rnd(-3, 3), rnd(18, 28), 0); }
  bldP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, wallB, 402)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.7).toFixed(2)); if (p.t > 1.7 || p.y > 400) kill(p); });
  /* consumption pools, fibrinolysis and kidney ischaemia */
  tanks.pl.setAttribute("width", f1(clamp(sm.Pl) * 260)); tanks.fg.setAttribute("width", f1(clamp(sm.Fg) * 260)); tanks.fac.setAttribute("width", f1(clamp(sm.Fac) * 260));
  if (fibGroup) fibGroup.style.opacity = (0.35 + 0.65 * sm.Fib).toFixed(2);
  if (iscOverlay) iscOverlay.setAttribute("opacity", (sm.Isc * 0.72).toFixed(2));
  /* gauges */
  gg.mic.set(sm.M, wordOf(sm.M, 0.3, 0.6, ["few", "some", "many"])); gg.pl.set(sm.Pl, wordOf(sm.Pl, 0.35, 0.7, ["low", "reduced", "normal"])); gg.fg.set(sm.Fg, wordOf(sm.Fg, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.dd.set(sm.Dd, wordOf(sm.Dd, 0.3, 0.6, ["normal", "raised", "high"])); gg.bl.set(sm.Bl, wordOf(sm.Bl, 0.3, 0.55, ["low", "raised", "high"])); gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.65, ["poor", "reduced", "good"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
