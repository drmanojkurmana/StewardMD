/* DIC scene: trigger chips, tissue factor, a systemic capillary with microthrombi, consumption pools, fibrinolysis, bleeding, organ flow and gauges. */
const WW = SC.W;
const layers = { tf: $("tfnode"), lumen: $("lumen"), endo: $("endo"), rbc: $("rbcs"), clots: $("clots"), parts: $("parts"), lower: $("lower"), over: $("over"), panel: $("panel") };
const CY = 240, HH = 42, WALL_N = 26;
/* ---- endothelium ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 13, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
/* ---- tissue factor node ---- */
let tfNode;
function initTf() { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Tissue factor on injured tissue, activated endothelium and monocytes starts the clotting cascade everywhere at once, not just at one wound." }, layers.tf);
  tfNode = mk("rect", { class: "dic-tf", x: 400, y: 140, width: 160, height: 36, rx: 10 }, g);
  const t = mk("text", { class: "dic-cap", x: 480, y: 162, "text-anchor": "middle" }, g); t.textContent = "Tissue factor on"; }
/* ---- red cells and flowing platelets ---- */
const rbcs = [], fplts = [];
function initFlow() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
  for (let i = 0; i < 16; i++) { const g = mk("g", {}, layers.rbc); cell(g, { cls: "plt", r: 5, seed: i + 3, wob: 0.15, n: 7 }); fplts.push({ g, x: rnd(0, WW), y: rnd(-0.7, 0.7), v: rnd(0.85, 1.15), i }); } }
/* ---- microthrombi clusters ---- */
const clots = [[190, 1], [350, -1], [510, 1], [670, -1], [830, 1]].map(([x, side], i) => { const g = mk("g", {}, layers.clots);
  for (let j = 0; j < 6; j++) cell(g, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.3) * 9, y: Math.sin(j * 2.1) * 6 * -side, seed: j + i, wob: 0.15, n: 7 });
  for (let j = 0; j < 5; j++) mk("path", { class: "dic-fib", d: "M" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) + "L" + f1(rnd(-15, 15)) + " " + f1(rnd(-9, 9)) }, g);
  return { g, x, side, i }; });
/* ---- lower: consumption pools, fibrinolysis, organ ---- */
const tanks = {};
let iscOverlay, fibGroup;
function initLower() { const L = layers.lower;
  [["pl", "Platelets", 322, "dic-fill-p", "Platelets are trapped in microthrombi all over the circulation, so the circulating count falls."], ["fg", "Fibrinogen", 350, "dic-fill-f", "Fibrinogen is turned into fibrin in vessels everywhere and is used up, so later clots are weak."], ["fac", "Clotting factors", 378, "dic-fill-c", "Clotting factors are consumed by widespread activation. PT and aPTT lengthen as they fall."]].forEach(([id, name, y, cls, tip]) => {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L);
    const t = mk("text", { class: "dic-lab2", x: 40, y: y + 4 }, g); t.textContent = name;
    mk("rect", { class: "dic-tank", x: 150, y: y - 7, width: 260, height: 14, rx: 7 }, g);
    tanks[id] = mk("rect", { class: cls, x: 150, y: y - 7, width: 260, height: 14, rx: 7 }, g); });
  const fg = mk("g", { class: "hot", tabindex: "0", "data-info": "Fibrinolysis: plasmin breaks fibrin down as fast as it forms. The fragments, including D-dimer, rise in the blood." }, L); fibGroup = fg;
  const ft = mk("text", { class: "dic-lab2", x: 560, y: 322, "text-anchor": "middle" }, fg); ft.textContent = "Fibrinolysis";
  mk("path", { class: "dic-fib", d: "M500 348L532 340L548 352L580 342L612 350" }, fg);
  mk("path", { class: "dic-fib", d: "M508 366L540 374L566 362L598 372" }, fg);
  mk("path", { class: "dic-fib", d: "M552 338L546 356M576 346L584 364" }, fg);
  const og = mk("g", { class: "hot", tabindex: "0", "data-info": "Organ ischaemia: microthrombi block small vessels in organs such as kidney, lung, brain and skin, so tissue is starved of blood even while the patient bleeds elsewhere." }, L);
  mk("circle", { class: "dic-organ", cx: 830, cy: 356, r: 40 }, og);
  iscOverlay = mk("circle", { class: "dic-isc", cx: 830, cy: 356, r: 40, opacity: "0" }, og);
  const ot = mk("text", { class: "dic-cap", x: 830, y: 360, "text-anchor": "middle" }, og); ot.textContent = "Organ"; }
/* ---- particle pools (element exposed as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tfP = pool(20, () => mk("path", { class: "sc-p p-tf", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const ddP = pool(18, () => mk("rect", { class: "sc-p p-ddim", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const repP = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const bldP = pool(14, () => mk("path", { class: "dic-drop", d: "M0 -3.2C2 -.5 2.6 .8 2.6 1.7A2.6 2.6 0 0 1 -2.6 1.7C-2.6 .8 -2 -.5 0 -3.2Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["mic", "Microthrombi", "g-mic", "Widespread microthrombi: tiny platelet and fibrin clots in small vessels everywhere."], ["pl", "Platelets", "g-pool", "Circulating platelets. They fall as platelets are consumed in microthrombi."], ["fg", "Fibrinogen", "g-pool", "Fibrinogen, the factor that becomes fibrin. It falls as it is used up."], ["dd", "D-dimer", "g-dd", "D-dimer, a fibrin breakdown product. It rises when fibrin is formed and dissolved, as in DIC."], ["bl", "Bleeding", "g-bad", "Bleeding tendency: with platelets and factors gone, clots are weak and blood oozes from lines, wounds and mucosa."], ["flow", "Organ flow", "g-flow", "Blood flow through small vessels in organs. Microthrombi block it and cause ischaemia."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Trigger", 115, 80, 115, 122, "A trigger switches clotting on systemically: sepsis, major trauma, malignancy or an obstetric emergency.");
  pill(ox, "Tissue factor", 480, 140, 480, 122, "Tissue factor from injured tissue, placenta, tumour or activated cells starts clotting throughout the circulation.");
  pill(ox, "Cause treated", 822, 80, 822, 122, "Treating the cause (for example antibiotics and source control in sepsis, or delivery in an obstetric emergency) switches the drive off.");
  pill(ox, "Microthrombi", 260, 226, 250, 180, "Microthrombi: widespread tiny clots of platelets and fibrin inside small vessels. They block flow and consume clotting material.");
  pill(ox, "D-dimer rises", 670, 226, 660, 180, "Fibrinolysis dissolves fibrin and releases D-dimer, so D-dimer is raised when DIC is active.");
  pill(ox, "Products replaced", 850, 240, 850, 180, "Replacing platelets, plasma or fibrinogen refills the pool, but it does not stop the trigger, so the benefit fades while DIC continues.");
  pill(ox, "Platelets fall", 220, 322, 170, 428, "Platelets are used up in microthrombi, so the count falls.");
  pill(ox, "Fibrinogen falls", 300, 350, 345, 428, "Fibrinogen and clotting factors are consumed, so clotting tests lengthen and clots become weak.");
  pill(ox, "Bleeding", 690, 300, 640, 428, "With platelets and factors depleted, blood oozes from puncture sites, wounds and mucosa at the same time as small vessels are clotting.");
  pill(ox, "Organ ischaemia", 830, 396, 830, 428, "Microthrombi starve organs of blood: kidney, lung, brain and skin ischaemia and dysfunction.");
  ox.querySelectorAll(".dr-lab").forEach((el) => { const tx = el.querySelector("text"); if (tx && tx.textContent === "Cause treated") el.setAttribute("id", "dic-cause-pill"); if (tx && tx.textContent === "Products replaced") el.setAttribute("id", "dic-rep-pill"); });
}
const sm = { TF: 0.4, M: 0.3, Pl: 0.7, Fg: 0.7, Fac: 0.7, Dd: 0.3, Bl: 0.2, Flow: 0.7, Isc: 0.3, Fib: 0.3, cause: 0, rep: 0 };
const acc = { tf: 0, dd: 0, rep: 0, bld: 0 };
function init() { initEndo(); initTf(); initFlow(); initLower(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.TF = lerp(sm.TF, m.TF, k2); sm.M = lerp(sm.M, m.M, k2); sm.Pl = lerp(sm.Pl, m.Pl, k2); sm.Fg = lerp(sm.Fg, m.Fg, k2); sm.Fac = lerp(sm.Fac, m.Fg, k2); sm.Dd = lerp(sm.Dd, m.Dd, k2); sm.Bl = lerp(sm.Bl, m.Bl, k1); sm.Flow = lerp(sm.Flow, m.Flow, k1); sm.Isc = lerp(sm.Isc, m.Isc, k1); sm.Fib = lerp(sm.Fib, m.Fib, k2); sm.cause = lerp(sm.cause, m.cause, k1); sm.rep = lerp(sm.rep, m.rep, k1);
  const wallT = CY - HH - 4, wallB = CY + HH + 4;
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1));
  endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.style.setProperty("--act", sm.TF.toFixed(2)); }));
  if (tfNode) tfNode.style.setProperty("--act", sm.TF.toFixed(2));
  /* tissue factor particles: chips down through the node into the vessel */
  acc.tf += dt * sm.TF * 7; while (acc.tf >= 1) { acc.tf--; const p = freeP(tfP); if (p) emit(p, rnd(60, 900), 102, rnd(-6, 6), rnd(30, 46), 0); }
  tfP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (480 - p.x) * dt * 0.55 + p.vx * dt; p.y += p.vy * dt; if (p.y > 176) p.vy = rnd(18, 26); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > wallT - 4 || p.t > 3.2) kill(p); });
  /* red cells and platelets flow, slowed and trapped by microthrombi */
  const flowK = clamp(0.2 + 0.85 * sm.Flow);
  rbcs.forEach((r) => { r.x += r.v * 62 * flowK * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * (HH - 12), r.rot + Math.sin(tm / 500 + r.x) * 9, 1); });
  fplts.forEach((p) => { p.x += p.v * 66 * flowK * dt; if (p.x > WW + 10) { p.x = -10; p.y = rnd(-0.7, 0.7); } place(p.g, p.x, CY + p.y * (HH - 12), 0, 1); p.g.style.opacity = (p.i / fplts.length < sm.Pl ? 1 : 0.12).toFixed(2); });
  clots.forEach((c) => { const s = clamp((sm.M - 0.1 * c.i) * 2.1); place(c.g, c.x, c.side > 0 ? wallT + 15 : wallB - 15, 0, 0.12 + 0.88 * s); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* D-dimer fragments leave the clots */
  acc.dd += dt * sm.Dd * 6; while (acc.dd >= 1) { acc.dd--; const p = freeP(ddP), c = pick(clots); if (p && c) emit(p, c.x + rnd(-12, 12), CY + rnd(-18, 18), rnd(22, 38), rnd(-7, 7), 0); }
  ddP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, WW - 22)) + " " + f1(clamp(p.y, CY - HH + 8, CY + HH - 8)) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4 || p.x > WW - 18) kill(p); });
  /* replacement products enter from the left when selected */
  acc.rep += dt * sm.rep * 5; while (acc.rep >= 1) { acc.rep--; const p = freeP(repP); if (p) emit(p, -8, CY + rnd(-HH + 14, HH - 14), 78, 0, 0); }
  repP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); if (p.x > WW + 8) kill(p); });
  /* bleeding drops leak from the lower wall */
  acc.bld += dt * clamp((sm.Bl - 0.25) * 2) * 5; while (acc.bld >= 1) { acc.bld--; const p = freeP(bldP); if (p) emit(p, rnd(640, 730), wallB + 4, rnd(-3, 3), rnd(18, 28), 0); }
  bldP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, wallB, 402)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.7).toFixed(2)); if (p.t > 1.7 || p.y > 400) kill(p); });
  /* consumption pools, fibrinolysis and organ */
  tanks.pl.setAttribute("width", f1(clamp(sm.Pl) * 260)); tanks.fg.setAttribute("width", f1(clamp(sm.Fg) * 260)); tanks.fac.setAttribute("width", f1(clamp(sm.Fac) * 260));
  if (fibGroup) fibGroup.style.opacity = (0.35 + 0.65 * sm.Fib).toFixed(2);
  if (iscOverlay) iscOverlay.setAttribute("opacity", (sm.Isc * 0.72).toFixed(2));
  const cp = $("dic-cause-pill"), rp = $("dic-rep-pill");
  if (cp) cp.style.opacity = sm.cause.toFixed(2); if (rp) rp.style.opacity = sm.rep.toFixed(2);
  /* gauges */
  gg.mic.set(sm.M, wordOf(sm.M, 0.3, 0.6, ["few", "some", "many"])); gg.pl.set(sm.Pl, wordOf(sm.Pl, 0.35, 0.7, ["low", "reduced", "normal"])); gg.fg.set(sm.Fg, wordOf(sm.Fg, 0.35, 0.7, ["low", "reduced", "normal"]));
  gg.dd.set(sm.Dd, wordOf(sm.Dd, 0.3, 0.6, ["normal", "raised", "high"])); gg.bl.set(sm.Bl, wordOf(sm.Bl, 0.3, 0.55, ["low", "raised", "high"])); gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.65, ["poor", "reduced", "good"]));
}
run({ init, step });
