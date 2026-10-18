/* Pulmonary hypertension scene: a pressure loaded right ventricle, a remodelled pulmonary artery, the lungs, causes, the consequence chain, body signs and the gauges. */
const L = { art: $("art"), rv: $("rv"), lung: $("lung"), causes: $("causes"), parts: $("parts"), chain: $("chain"), icons: $("icons"), over: $("over"), panel: $("panel") };
const VC = [140, 288];
/* ---- artery wall, lumen and outflow ---- */
mk("path", { class: "ph-out", d: "M140 218L182 180L214 170" }, L.art);
mk("rect", { class: "ph-artwall", x: 210, y: 110, width: 330, height: 120, rx: 10 }, L.art);
const lumenEl = mk("rect", { class: "ph-lumen", id: "phlumen", x: 210, y: 147, width: 330, height: 46, rx: 8 }, L.art);
const aTrack = track([[140, 212], [168, 180], [230, 170], [535, 170]]);
/* ---- right ventricle ---- */
const wallEl = mk("ellipse", { class: "ph-wall", cx: VC[0], cy: VC[1] }, L.rv);
const shadeEl = mk("ellipse", { class: "ph-shade", cx: VC[0] + 5, cy: VC[1] + 6 }, L.rv);
const chEl = mk("ellipse", { class: "ph-ch", cx: VC[0], cy: VC[1] }, L.rv);
const parr = [118, 140, 162].map((x) => mk("path", { class: "ph-pres" }, L.rv));
/* ---- wall cells: endothelium on the lumen, smooth muscle in the wall ---- */
const endoT = [], endoB = [], muscT = [], muscB = [];
for (let i = 0; i < 13; i++) { const x = 228 + i * 25; endoT.push({ g: cell(L.art, { cls: "endo", r: 9, nuc: 0.3, seed: i + 1, wob: 0.06, n: 8 }), x }); endoB.push({ g: cell(L.art, { cls: "endo", r: 9, nuc: 0.3, seed: i + 30, wob: 0.06, n: 8 }), x }); }
for (let i = 0; i < 9; i++) { const x = 235 + i * 35; muscT.push({ g: cell(L.art, { cls: "sm", r: 9, nuc: 0.35, seed: i + 50, wob: 0.1, n: 8 }), x }); muscB.push({ g: cell(L.art, { cls: "sm", r: 9, nuc: 0.35, seed: i + 70, wob: 0.1, n: 8 }), x }); }
/* ---- old clot sitting in the artery (chronic thromboembolic disease) ---- */
const clotCells = [];
for (let i = 0; i < 5; i++) clotCells.push({ g: cell(L.art, { cls: "plt", r: 5 + (i % 3), seed: i + 90, wob: 0.15, n: 7 }), dx: -14 + i * 7, dy: (i % 2) * -5 });
/* ---- lungs: alveoli with a capillary blush ---- */
const ALV = [[340, 280, 22], [400, 308, 26], [458, 282, 24], [492, 322, 20]];
ALV.forEach(([x, y, r]) => { mk("circle", { class: "ph-alv", cx: x, cy: y, r: r }, L.lung); mk("circle", { class: "ph-alv", cx: x - r * 0.3, cy: y - r * 0.25, r: r * 0.45 }, L.lung); });
/* ---- causes strip ---- */
const CAUSES = [
  { x: 88, t: "Left heart", tip: "Left heart disease: pressure from a failing or stiff left side, or a tight mitral valve, is passed back into the pulmonary veins and artery." },
  { x: 222, t: "Lung disease", tip: "Lung disease: damaged lungs lose small vessels and leave the remaining blood short of oxygen." },
  { x: 356, t: "Low oxygen", tip: "Low oxygen in the air sacs makes nearby pulmonary vessels tighten: hypoxic pulmonary vasoconstriction. Helpful in one spot, harmful when the whole lung is short of oxygen." },
  { x: 490, t: "Old clot", tip: "Chronic thromboembolic disease: old clot that never cleared scars the artery open only in part, so resistance stays high." },
];
const causeEls = CAUSES.map((c) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": c.tip }, L.causes);
  mk("rect", { class: "ph-cause", x: c.x - 61, y: 392, width: 122, height: 34, rx: 10 }, g);
  const t = mk("text", { class: "ph-node-t", x: c.x, y: 413, "text-anchor": "middle" }, g); t.textContent = c.t; return g; });
/* ---- consequence chain ---- */
const NODES = {
  a: { x: 760, y: 118, t: "Wall remodels, vessels tighten", tip: "Endothelial dysfunction: less relaxing signal, more tightening and growth signal. Vascular smooth muscle thickens and the lumen narrows.", k: "pvr" },
  b: { x: 760, y: 183, t: "Pulmonary pressure rises", tip: "Pulmonary arterial systolic pressure climbs as resistance rises. The right ventricle must make that pressure with every beat.", k: "pap" },
  c: { x: 760, y: 248, t: "Right ventricle overloads", tip: "Pressure overload: the right ventricular wall hypertrophies to cope, then the chamber dilates, the muscle strains and output stops rising on exercise.", k: "strain" },
  d: { x: 760, y: 313, t: "Right heart failure", tip: "Right heart failure: venous pressure rises (raised JVP), fluid leaves the vessels (oedema), the kidney congests, and cardiac output and systemic pressure fall late.", k: "cong" },
};
const nodeEls = {};
Object.keys(NODES).forEach((key) => { const n = NODES[key], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.chain);
  mk("rect", { class: "ph-node", x: n.x - 150, y: n.y - 18, width: 300, height: 36, rx: 12 }, g);
  const t = mk("text", { class: "ph-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; nodeEls[key] = g; });
const ARROWS = { ab: { pts: [[760, 136], [760, 165]], k: "pap" }, bc: { pts: [[760, 201], [760, 230]], k: "strain" }, cd: { pts: [[760, 266], [760, 295]], k: "cong" } };
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const a2 = ARROWS[id], d = a2.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a2.pts);
  mk("path", { class: "ph-arrow", d }, L.chain);
  const p2 = a2.pts[a2.pts.length - 1]; mk("path", { class: "ph-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(90)" }, L.chain);
  const dots = Array.from({ length: 2 }, (_, i) => ({ c: mk("circle", { class: "ph-jet", r: 2.3 }, L.parts), u: i / 2 }));
  arrows[id] = { tr, dots, k: a2.k }; });
/* ---- body signs ---- */
function iconGroup(tip) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.icons); return g; }
const dysG = iconGroup("Dyspnea and poor exercise tolerance: output cannot rise on effort and congested lungs stiffen, so breathlessness comes first on effort, then at rest.");
mk("path", { class: "ph-icon", d: "M642 362q-14 4-15 20q0 14 12 15q6-16 3-35zM658 362q14 4 15 20q0 14-12 15q-6-16-3-35z" }, dysG);
mk("path", { class: "ph-icon", d: "M650 356v16" }, dysG);
const jvpG = iconGroup("Raised jugular venous pressure (JVP): the failing right ventricle passes pressure back into the neck veins, a key part of the diagnostic assessment.");
mk("circle", { class: "ph-icon", cx: 730, cy: 368, r: 13 }, jvpG);
mk("path", { class: "ph-icon", d: "M730 381v14M724 388q6 5 12 0" }, jvpG);
const oedG = iconGroup("Oedema: raised venous pressure pushes fluid into the tissues, first at the ankles. A diuretic unloads this congestion.");
mk("path", { class: "ph-icon", d: "M804 358h12v24h-12zM804 382q-6 10 2 13q14 3 20-2q4-4-2-7l-8-4" }, oedG);
const renG = iconGroup("Kidney: venous congestion and low cardiac output together reduce renal perfusion, so fluid is held on to and congestion worsens.");
mk("path", { class: "ph-icon", d: "M885 360q14 2 13 16q-1 15-14 17q-12 1-13-12q0-8 5-10q-5-2-3-7q2-5 12-4z" }, renG);
[[650, "Dyspnea"], [730, "Raised JVP"], [810, "Oedema"], [885, "Kidney"]].forEach(([x, s]) => { const t = mk("text", { class: "ph-cap", x: x, y: 418, "text-anchor": "middle" }, L.icons); t.textContent = s; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const rbcP = pool(16, () => { const g = mk("g", { class: "cl cl-rbc" }, L.parts); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return g; });
rbcP.forEach((p) => { p.on = true; p.x = rnd(215, 535); p.y = rnd(-0.8, 0.8); p.vx = rnd(0.85, 1.15); p.e.setAttribute("opacity", "1"); });
const oxyP = pool(12, () => mk("circle", { class: "sc-p p-oxy", r: 2.2 }, L.parts));
const conP = pool(14, () => mk("path", { class: "sc-p p-con", d: "M0 -3L3 0L0 3L-3 0Z" }, L.parts));
const jetP = Array.from({ length: 12 }, (_, i) => ({ e: mk("circle", { class: "ph-jet", r: 2.4, opacity: 0 }, L.parts), u: i / 12, off: rnd(-4, 4) }));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
pill(L.over, "Thick wall", 300, 124, 200, 98, "The artery wall thickens: smooth muscle grows and the wall remodels around a narrower lumen.");
pill(L.over, "Pulmonary artery", 375, 146, 375, 98, "Pulmonary artery: it carries blood from the right ventricle to the lungs. Its systolic pressure is what rises in pulmonary hypertension.");
pill(L.over, "Right ventricle", 172, 318, 265, 350, "Right ventricle: the thin walled chamber built for low pressure. Under pressure overload it hypertrophies, then dilates and fails.");
pill(L.over, "Narrowed lumen", 425, 172, 280, 250, "The narrowed lumen: remodelling plus vasoconstriction shrink the passage, so vascular resistance and pressure rise.");
pill(L.over, "Smooth muscle", 300, 216, 270, 322, "Vascular smooth muscle in the artery wall. It tightens (vasoconstriction) and, over time, thickens the wall.");
pill(L.over, "Lungs", 458, 282, 520, 255, "Lungs: the air sacs. Lung disease and low oxygen here are a major cause of raised pulmonary pressure.");
const oxyPill = pill(L.over, "Oxygen + diuretic", 448, 262, 120, 125, "Oxygen eases hypoxic vasoconstriction in the lungs; a diuretic removes congestive fluid and lowers venous pressure. Neither reverses fixed remodelling.");
oxyPill.setAttribute("id", "oxy-pill"); oxyPill.style.opacity = "0";
const vasoPill = pill(L.over, "Vasodilator", 375, 198, 430, 365, "Pulmonary vasodilator concept: relaxing the pulmonary vessels lowers resistance and pressure. If it also relaxes systemic vessels, systemic pressure can fall.");
vasoPill.setAttribute("id", "vaso-pill"); vasoPill.style.opacity = "0";
const causePill = pill(L.over, "Treat cause", 490, 392, 275, 280, "Treat the cause: the left heart, the lung disease and low oxygen, or the old clot. Works best before vascular remodelling becomes fixed.");
causePill.setAttribute("id", "cause-pill"); causePill.style.opacity = "0";
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [130, 270, 410, 550, 690, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pap", "Pressure", "g-pap", "Pulmonary arterial pressure: the systolic load the right ventricle must generate. It rises with vascular resistance."], ["pvr", "Resistance", "g-cyt", "Pulmonary vascular resistance: remodelling and vasoconstriction of the small pulmonary vessels raise it."], ["strain", "RV strain", "g-neu", "Right ventricular strain: hypertrophy first, then dilatation as the pressure loaded ventricle gives way."], ["out", "Output", "g-good", "Cardiac output: held at rest for a long stage, it cannot rise on exercise and falls when the ventricle fails."], ["cong", "Congestion", "g-fl", "Venous congestion: raised JVP, oedema and renal congestion from back pressure. A diuretic unloads it."], ["dys", "Dyspnea", "g-bad", "Dyspnea: breathlessness on exercise first, then at rest, from low output reserve and congested lungs."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); }); }
/* ---- animation ---- */
const sm = { pvr: 0.6, pap: 0.6, hyp: 0.6, dil: 0.4, strain: 0.5, output: 0.6, cong: 0.3, dys: 0.5, sys: 0.7, renal: 0.3, oxy: 0, vaso: 0, cause: 0 };
const acc = { oxy: 0, con: 0 };
let beat = 0;
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.pvr = lerp(sm.pvr, m.pvr, k1); sm.pap = lerp(sm.pap, m.pap, k1); sm.dil = lerp(sm.dil, m.dil, k1); sm.output = lerp(sm.output, m.output, k1); sm.cong = lerp(sm.cong, m.cong, k1); sm.sys = lerp(sm.sys, m.sys, k1); sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.vaso = lerp(sm.vaso, m.vaso, k1); sm.cause = lerp(sm.cause, m.cause, k1);
  sm.hyp = lerp(sm.hyp, m.hyp, k2); sm.strain = lerp(sm.strain, m.strain, k2); sm.dys = lerp(sm.dys, m.dys, k2); sm.renal = lerp(sm.renal, m.renal, k2);
  /* lumen narrows with resistance; wall cells swell with remodelling */
  const lh = 46 - 28 * sm.pvr, topY = 170 - lh / 2, botY = 170 + lh / 2;
  lumenEl.setAttribute("y", f1(topY)); lumenEl.setAttribute("height", f1(lh));
  endoT.forEach((e, i) => place(e.g, e.x, topY + 3 + Math.sin(tm / 800 + i) * 0.7, 0, 1));
  endoB.forEach((e, i) => place(e.g, e.x, botY - 3 + Math.sin(tm / 800 + i + 2) * 0.7, 0, 1));
  const ms = 0.8 + 0.55 * sm.pvr;
  muscT.forEach((e) => place(e.g, e.x, 128, 0, ms)); muscB.forEach((e) => place(e.g, e.x, 212, 0, ms));
  clotCells.forEach((c) => place(c.g, 482 + c.dx, botY - 5 + c.dy, 0, clamp(m.a * 1.1)));
  /* heartbeat: cavity shrinks as it ejects; hypertrophy thickens the wall, failure dilates the cavity */
  beat += dt * (0.85 + 0.3 * sm.pap); const ph = beat % 1, cph = Math.pow(Math.max(0, Math.sin(ph * 6.2832 * 0.5 + 0.2)), 1.2) * (ph < 0.5 ? 1 : 0);
  const ef = 0.08 + 0.24 * sm.output, rx0 = 36 + 18 * sm.dil, ry0 = 44 + 14 * sm.dil, tw = 9 + 13 * sm.hyp;
  const rx = rx0 * (1 - ef * cph), ry = ry0 * (1 - ef * cph);
  chEl.setAttribute("rx", f1(rx)); chEl.setAttribute("ry", f1(ry));
  wallEl.setAttribute("rx", f1(rx + tw * (1 + 0.25 * cph))); wallEl.setAttribute("ry", f1(ry + tw * (1 + 0.25 * cph)));
  shadeEl.setAttribute("rx", f1(rx + tw)); shadeEl.setAttribute("ry", f1(ry + tw));
  parr.forEach((p, i) => { const x = [118, 140, 162][i], len = (22 + 48 * sm.pap) * (0.85 + 0.15 * Math.sin(tm / 300 + i));
    p.setAttribute("d", "M" + x + " 332L" + x + " " + f1(332 - len) + "M" + (x - 4) + " " + f1(340 - len) + "L" + x + " " + f1(332 - len) + "L" + (x + 4) + " " + f1(340 - len)); p.setAttribute("opacity", (0.15 + 0.8 * sm.pap).toFixed(2)); });
  /* red cells traverse the narrowed lumen; the jet out of the ventricle speeds with pressure */
  const vf = 34 + 58 * sm.output;
  rbcP.forEach((p) => { p.x += p.vx * vf * dt * (p.x > 300 && p.x < 480 ? 1 + 0.7 * sm.pvr : 1); if (p.x > 542) { p.x = 212; p.y = rnd(-0.8, 0.8); } place(p.e, p.x, 170 + p.y * Math.max(4, lh / 2 - 7), Math.sin(tm / 500 + p.x) * 8, 1); });
  jetP.forEach((p) => { p.u = (p.u + dt * (0.25 + 0.6 * sm.pap)) % 1; const q = aTrack.at(p.u); p.e.setAttribute("cx", f1(q.x + p.off * (1 - 0.5 * sm.pvr))); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", clamp(0.15 + 0.8 * sm.output).toFixed(2)); });
  /* oxygen drifting in the air sacs; constrictor signals hugging the wall */
  acc.oxy += dt * (2 + 7 * sm.oxy + 3 * (1 - sm.pvr)); while (acc.oxy >= 1) { acc.oxy--; const p = freeP(oxyP); if (p) emitP(p, rnd(322, 508), rnd(258, 344), rnd(-5, 5), rnd(-7, -2)); }
  oxyP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 318, 512); p.y = clamp(p.y, 252, 348); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) killP(p); });
  acc.con += dt * sm.pvr * 7; while (acc.con >= 1) { acc.con--; const p = freeP(conP); if (p) emitP(p, rnd(225, 525), Math.random() < 0.5 ? topY - rnd(6, 16) : botY + rnd(6, 16), rnd(-4, 4), rnd(-3, 3)); }
  conP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* chain glow, flowing dots, causes and body signs */
  const act = { pvr: sm.pvr, pap: sm.pap, strain: sm.strain, cong: sm.cong };
  Object.keys(NODES).forEach((key) => { nodeEls[key].style.filter = "drop-shadow(0 0 " + (act[NODES[key].k] * 7).toFixed(1) + "px var(--c-cyt))"; });
  Object.keys(arrows).forEach((id) => { const ar = arrows[id], v = act[ar.k]; ar.dots.forEach((d) => { d.u = (d.u + dt * (0.1 + 0.45 * v)) % 1; const q = ar.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(v * 1.3).toFixed(2); }); });
  causeEls.forEach((g) => { g.style.opacity = (1 - 0.35 * sm.cause).toFixed(2); });
  dysG.style.opacity = (0.25 + 0.75 * sm.dys).toFixed(2); jvpG.style.opacity = (0.25 + 0.75 * sm.cong).toFixed(2);
  oedG.style.opacity = (0.25 + 0.75 * sm.cong).toFixed(2); renG.style.opacity = (0.25 + 0.75 * sm.renal).toFixed(2);
  oxyPill.style.opacity = sm.oxy.toFixed(2); vasoPill.style.opacity = sm.vaso.toFixed(2); causePill.style.opacity = sm.cause.toFixed(2);
  /* gauges */
  gg.pap.set(sm.pap, wordOf(sm.pap, 0.40, 0.72, ["near normal", "raised", "very high"])); gg.pvr.set(sm.pvr, wordOf(sm.pvr, 0.35, 0.65, ["low", "raised", "high"]));
  gg.strain.set(sm.strain, wordOf(sm.strain, 0.35, 0.65, ["mild", "strained", "failing"])); gg.out.set(sm.output, wordOf(sm.output, 0.38, 0.66, ["low", "reduced", "held"]));
  gg.cong.set(sm.cong, wordOf(sm.cong, 0.28, 0.62, ["none", "some", "marked"])); gg.dys.set(sm.dys, wordOf(sm.dys, 0.3, 0.6, ["none", "on effort", "at rest"]));
}
run({ init, step });
