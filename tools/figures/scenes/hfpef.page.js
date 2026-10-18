/* HFpEF scene: drivers thicken the ventricle wall, slow relaxation raises filling pressure, the atrium enlarges and pressure backs up into the lungs, while the squeeze stays preserved. */
const layers = { drivers: $("drivers"), heart: $("heart"), cong: $("cong"), inset: $("inset"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const LV = [466, 250], LA0 = [438, 162];
/* ---- driver and chain nodes (every node has a visible fill) ---- */
const NODES = {
  ht: { x: 160, y: 108, w: 200, t: "Hypertension", tip: "Hypertension: years of high pressure make the ventricle pump against more load, so its wall thickens inward." },
  dm: { x: 160, y: 156, w: 200, t: "Diabetes", tip: "Diabetes stiffens heart muscle directly and damages small vessels, so relaxation worsens." },
  ob: { x: 160, y: 204, w: 200, t: "Obesity", tip: "Obesity adds blood volume and metabolic strain and promotes inflammation and wall thickening." },
  age: { x: 160, y: 252, w: 200, t: "Ageing", tip: "Ageing replaces elastic muscle with stiffer fibrous tissue, so the ventricle relaxes more slowly." },
  thick: { x: 160, y: 312, w: 180, t: "Thick wall", tip: "Concentric hypertrophy: the wall thickens inward. The chamber stays small instead of dilating." },
  stiff: { x: 160, y: 356, w: 210, t: "Stiff, slow to relax", tip: "A thick, fibrous wall relaxes slowly and resists filling. Filling therefore needs a higher pressure." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, layers.drivers);
  mk("rect", { class: "hfpef-node", x: n.x - n.w / 2, y: n.y - 17, width: n.w, height: 34, rx: 12 }, g);
  const t = mk("text", { class: "hfpef-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; nodeEls[k] = g; });
{ const c = mk("text", { class: "hfpef-cap", x: 160, y: 408, "text-anchor": "middle" }, layers.drivers); c.textContent = "Drivers add up over years"; }
/* arrows: drivers down the chain, then into the heart */
function arrow(parent, pts) { const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""); const e = mk("path", { class: "hfpef-arrow", d }, parent);
  const p1 = pts[pts.length - 2], p2 = pts[pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958;
  mk("path", { class: "hfpef-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, parent); return e; }
arrow(layers.drivers, [[160, 269], [160, 293]]);
arrow(layers.drivers, [[160, 329], [160, 337]]);
const drvArrows = [[108], [156], [204], [252]].map(([y]) => { const e = mk("path", { class: "hfpef-arrow", d: "M260 " + y + "C300 " + y + " 320 238 396 250", opacity: "0.35" }, layers.drivers); return e; });
mk("path", { class: "hfpef-arrow", d: "M265 356C305 345 350 305 398 274" }, layers.drivers);
mk("path", { class: "hfpef-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(398 274) rotate(-38)" }, layers.drivers);
/* ---- the heart ---- */
const hg = mk("g", {}, layers.heart);
const aortaEl = mk("path", { class: "hfpef-aorta", d: "M492 198C500 152 515 132 540 130C555 132 558 148 556 164" }, hg);
const rv = mk("ellipse", { class: "hfpef-rv", cx: 392, cy: 256, rx: 19, ry: 44 }, hg);
const wall = mk("ellipse", { class: "hfpef-wall", cx: LV[0], cy: LV[1] }, hg);
const wsh = mk("ellipse", { class: "hfpef-shade", cx: LV[0] + 5, cy: LV[1] + 6 }, hg);
const ch = mk("ellipse", { class: "hfpef-ch", cx: LV[0], cy: LV[1] }, hg);
const la = mk("ellipse", { class: "hfpef-at", cx: LA0[0], cy: LA0[1] }, hg);
const chev = mk("g", { opacity: "0" }, hg);
[448, 466, 484].forEach((x) => mk("path", { class: "hfpef-head", d: "M" + (x - 5) + " 232l5 -7l5 7", fill: "none", stroke: "var(--c-fl)", "stroke-width": "1.6" }, chev));
const backPath = mk("path", { class: "hfpef-back", d: "M470 158C560 146 640 168 716 204" }, hg);
mk("path", { class: "hfpef-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(716 204) rotate(28)" }, hg);
/* ---- lungs and consequences ---- */
const LUNG_D = "M766 182q-8 30 8 52q20 8 28 -8l0 -52q-20 -10 -36 8zM834 182q8 30 -8 52q-20 8 -28 -8l0 -52q20 -10 36 8z";
{ const clip = mk("clipPath", { id: "hfpefLungClip" }, layers.cong); mk("path", { d: LUNG_D }, clip); }
const lungG = mk("g", { class: "hot", tabindex: "0", "data-info": "Pulmonary congestion: pressure behind the stiff ventricle pushes fluid into the lungs. That gives breathlessness, worse lying flat and on effort." }, layers.cong);
mk("path", { class: "hfpef-arrow", d: "M800 158L800 180" }, lungG);
mk("path", { class: "hfpef-lung", d: LUNG_D }, lungG);
const lungFill = mk("rect", { class: "hfpef-fluid", x: 758, y: 242, width: 84, height: 0, "clip-path": "url(#hfpefLungClip)", opacity: "0.75" }, lungG);
{ const t = mk("text", { class: "hfpef-cap", x: 800, y: 264, "text-anchor": "middle" }, layers.cong); t.textContent = "Lungs"; }
const CONS = {
  breath: { x: 797, y: 352, w: 210, t: "Breathless on effort", tip: "Breathlessness: fluid in the lungs makes them stiff, so breathing takes more work, especially on effort or lying flat." },
  tired: { x: 797, y: 398, w: 220, t: "Tired legs, swelling", tip: "Congestion and poor reserve give tiredness and swollen ankles as fluid collects in the tissues." },
};
Object.keys(CONS).forEach((k) => { const n = CONS[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, layers.cong);
  mk("rect", { class: "hfpef-node", x: n.x - n.w / 2, y: n.y - 16, width: n.w, height: 32, rx: 12 }, g);
  const t = mk("text", { class: "hfpef-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; });
/* ---- contrast inset: reduced ejection fraction ---- */
{ const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Reduced ejection fraction, for contrast: the ventricle dilates, its wall thins and the squeeze weakens, so the ejection fraction falls. In preserved ejection fraction the chamber is small and thick and the squeeze stays normal; filling is the problem." }, layers.inset);
  mk("rect", { class: "hfpef-node", x: 316, y: 364, width: 320, height: 62, rx: 12 }, g);
  mk("ellipse", { class: "hfpef-mini", cx: 362, cy: 395, rx: 34, ry: 24 }, g);
  mk("ellipse", { class: "hfpef-ch", cx: 362, cy: 395, rx: 27, ry: 18 }, g);
  const t1 = mk("text", { class: "hfpef-node-t", x: 408, y: 390 }, g); t1.textContent = "Reduced EF, for contrast";
  const t2 = mk("text", { class: "hfpef-cap", x: 408, y: 408 }, g); t2.textContent = "dilated, thin wall, weak squeeze"; }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const drvTr = [108, 156, 204, 252].map((y) => track([[260, y], [320, 238], [396, 250]]));
const aortaTr = track([[492, 198], [508, 142], [540, 130], [556, 162]]);
const backTr = track([[470, 158], [560, 146], [640, 168], [716, 204]]);
const drvP = pool(16, () => mk("circle", { class: "hfpef-dot", r: 2.4 }, layers.parts));
const inP = pool(12, () => mk("circle", { class: "hfpef-inflow", r: 2.6 }, layers.parts));
const ejP = pool(10, () => mk("circle", { class: "hfpef-eject", r: 2.6 }, layers.parts));
const bkP = pool(16, () => mk("circle", { class: "hfpef-inflow", r: 2.4 }, layers.parts));
const dropP = pool(18, () => mk("path", { class: "p-hfpef-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- treatment marks ---- */
const MARKS = { bp: [260, 108, "BP control", 160, 82], diu: [852, 178, "Diuretic", 800, 318], sg: [505, 308, "SGLT2 inhibitor", 575, 345] };
const marks = {};
Object.keys(MARKS).forEach((id) => { const m = MARKS[id], g = mk("g", { opacity: 0 }, layers.marks);
  mk("circle", { class: "hfpef-x", cx: m[0], cy: m[1], r: 8.5 }, g); mk("path", { class: "hfpef-xx", d: "M" + (m[0] - 4) + " " + (m[1] - 4) + "l8 8M" + (m[0] + 4) + " " + (m[1] - 4) + "l-8 8" }, g);
  const t = mk("text", { class: "hfpef-mk", x: m[2 + 1], y: m[2 + 2], "text-anchor": "middle" }, g); t.textContent = m[2]; marks[id] = g; });
/* ---- labels and gauges ---- */
pill(layers.over, "Thick wall", 410, 255, 352, 342, "Concentric hypertrophy: the wall thickens inward, so the chamber stays small. This is thickening, not dilation.");
pill(layers.over, "Left atrium", 452, 150, 565, 118, "Left atrium: it stretches and enlarges because it must push blood into a stiff ventricle at high pressure. An enlarged atrium also favours atrial fibrillation.");
pill(layers.over, "Preserved squeeze", 470, 250, 580, 305, "Preserved ejection fraction: the chamber still ejects a normal fraction of its contents. The squeeze is fine; filling is the problem.");
pill(layers.over, "Raised pressure", 600, 168, 605, 225, "Raised filling pressure: the stiff ventricle only fills when pressure behind it rises. That pressure is felt in the atrium and lungs.");
pill(layers.over, "Lung fluid", 800, 210, 795, 135, "Fluid in the lungs from back pressure. It rises as congestion worsens and eases with a diuretic.");
const gg = {};
{ const P = layers.panel, y0 = 478, h = 52, xs = [130, 290, 450, 610, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["stiff", "Stiffness", "g-cyt", "How thick and stiff the ventricle wall is. Stiffer muscle relaxes more slowly."], ["fill", "Pressure", "g-bad", "Filling pressure: the pressure needed to fill the stiff ventricle."], ["la", "Atrium", "g-eos", "Left atrial size: it enlarges under years of raised filling pressure."], ["cong", "Congestion", "g-fl", "How much fluid has backed up into the lungs and tissues."], ["ef", "Ejection", "g-good", "Ejection fraction: the fraction ejected each beat. Here it stays preserved, unlike reduced ejection fraction."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); }); }
/* ---- animation ---- */
const sm = { a: 0.65, stiff: 0.6, fill: 0.6, cong: 0.6, la: 0.6, ef: 0.85, diu: 0, bp: 0, sg: 0 };
const acc = { drv: 0, inn: 0, ej: 0, bk: 0, drop: 0 };
let beat = 0;
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.a = lerp(sm.a, m.a, k2); sm.stiff = lerp(sm.stiff, m.stiff, k2); sm.la = lerp(sm.la, m.la, k2);
  sm.fill = lerp(sm.fill, m.fill, k1); sm.cong = lerp(sm.cong, m.cong, k1); sm.ef = lerp(sm.ef, m.ef, k1);
  sm.diu = lerp(sm.diu, m.diu, k1); sm.bp = lerp(sm.bp, m.bp, k1); sm.sg = lerp(sm.sg, m.sg, k1);
  /* beat: strong squeeze (preserved), then slow, incomplete relaxation when stiff */
  beat += dt * 1.05; const ph = beat % 1;
  let c; if (ph < 0.35) { const u = ph / 0.35; c = Math.sin(u * Math.PI * 0.5); } else { const u = (ph - 0.35) / 0.65; c = Math.pow(1 - u, 1 + 2.2 * sm.stiff); }
  const baseRx = 36 * (1 - 0.10 * sm.stiff), baseRy = 50 * (1 - 0.08 * sm.stiff), thick = 13 + 17 * sm.stiff;
  const chRx = baseRx * (1 - 0.40 * sm.ef * c), chRy = baseRy * (1 - 0.40 * sm.ef * c);
  ch.setAttribute("rx", f1(chRx)); ch.setAttribute("ry", f1(chRy));
  wall.setAttribute("rx", f1(chRx + thick * (1 + 0.12 * c))); wall.setAttribute("ry", f1(chRy + thick * (1 + 0.12 * c)));
  wsh.setAttribute("rx", f1(chRx + thick)); wsh.setAttribute("ry", f1(chRy + thick));
  const laRx = 26 + 17 * sm.la, laRy = 20 + 12 * sm.la, laCy = LV[1] - (chRy + thick) - laRy - 2;
  la.setAttribute("rx", f1(laRx)); la.setAttribute("ry", f1(laRy)); la.setAttribute("cy", f1(laCy));
  rv.setAttribute("ry", f1(44 * (1 - 0.07 * c)));
  aortaEl.setAttribute("opacity", (0.25 + 0.45 * sm.ef).toFixed(2));
  chev.setAttribute("opacity", (sm.fill * (0.4 + 0.6 * (1 - c))).toFixed(2));
  chev.setAttribute("transform", "translate(0 " + f1(-4 * sm.fill * Math.sin(tm / 300)) + ")");
  backPath.setAttribute("opacity", (0.25 + 0.6 * sm.fill).toFixed(2));
  /* node glow: drivers feed thickening; blood pressure control calms the hypertension node */
  const glow = { ht: sm.a * (1 - 0.55 * sm.bp), dm: sm.a, ob: sm.a, age: sm.a, thick: sm.stiff, stiff: sm.stiff };
  Object.keys(glow).forEach((k) => { nodeEls[k].style.filter = "drop-shadow(0 0 " + (glow[k] * 6).toFixed(1) + "px var(--c-cyt))"; });
  marks.bp.setAttribute("opacity", sm.bp.toFixed(2)); marks.diu.setAttribute("opacity", sm.diu.toFixed(2)); marks.sg.setAttribute("opacity", sm.sg.toFixed(2));
  /* driver signals travelling into the wall */
  acc.drv += dt * sm.a * 7; while (acc.drv >= 1) { acc.drv--; const p = free(drvP); if (p) { emit(p, 260, 0, 0, 0, Math.floor(rnd(0, 4))); const q = drvTr[p.k].at(0); p.x = q.x; p.y = q.y; } }
  drvP.forEach((p) => { if (!p.on) return; p.u += dt * 0.35; if (p.u >= 1) { kill(p); return; } const q = drvTr[p.k].at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* inflow from atrium into ventricle: slower and later when stiff */
  acc.inn += dt * (2 + 5 * (1 - sm.stiff * 0.5)) * (ph > 0.35 ? 1 : 0.15); while (acc.inn >= 1) { acc.inn--; const p = free(inP); if (p) emit(p, LA0[0] + rnd(-8, 8), laCy + laRy - 2, rnd(-3, 3), rnd(22, 34) * (1 - 0.45 * sm.stiff), 0); }
  inP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 420, 500)) + " " + f1(clamp(p.y, 120, 252)) + ")"); if (p.y > 250 || p.t > 2.4) kill(p); });
  /* ejection along the aorta: brisk, because the squeeze is preserved */
  acc.ej += dt * 6 * sm.ef; while (acc.ej >= 1) { acc.ej--; const p = free(ejP); if (p) emit(p, 492, 198, 0, 0, 0); }
  ejP.forEach((p) => { if (!p.on) return; p.u += dt * (0.5 + 0.5 * c); if (p.u >= 1) { kill(p); return; } const q = aortaTr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* back pressure: signals travel from the atrium toward the lungs */
  acc.bk += dt * sm.fill * 8; while (acc.bk >= 1) { acc.bk--; const p = free(bkP); if (p) emit(p, 470, 158, 0, 0, 0); }
  bkP.forEach((p) => { if (!p.on) return; p.u += dt * 0.4; if (p.u >= 1) { kill(p); return; } const q = backTr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* lung fluid level and droplets, kept inside the lung shape */
  lungFill.setAttribute("height", f1(52 * sm.cong)); lungFill.setAttribute("y", f1(242 - 52 * sm.cong));
  acc.drop += dt * sm.cong * 5; while (acc.drop >= 1) { acc.drop--; const p = free(dropP); if (p) emit(p, rnd(774, 826), rnd(188, 210), 0, rnd(10, 16), 0); }
  dropP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x, 770, 830); p.y = clamp(p.y, 184, 238); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y >= 238) kill(p); });
  /* gauges */
  gg.stiff.set(sm.stiff, wordOf(sm.stiff, 0.3, 0.6, ["mild", "stiff", "very stiff"])); gg.fill.set(sm.fill, wordOf(sm.fill, 0.25, 0.6, ["near normal", "raised", "high"]));
  gg.la.set(sm.la, wordOf(sm.la, 0.3, 0.6, ["normal", "enlarged", "large"])); gg.cong.set(sm.cong, wordOf(sm.cong, 0.25, 0.5, ["minimal", "mild", "marked"]));
  gg.ef.set(sm.ef, wordOf(sm.ef, 0.6, 0.75, ["reduced", "borderline", "preserved"]));
}
run({ init, step });
