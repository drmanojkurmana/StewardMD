/* Chronic kidney disease scene: nephron loss, hyperfiltration, retained solutes, hormones, bone, marrow and gauges. */
const WW = SC.W;
const layers = { kid: $("kid"), vess: $("vess"), parts: $("parts"), bonebox: $("bonebox"), over: $("over"), panel: $("panel") };
const E = {};
const neph = [];
function initKidney() {
  mk("ellipse", { class: "ck-kid", cx: 175, cy: 255, rx: 105, ry: 135 }, layers.kid);
  mk("path", { class: "ck-ureter", d: "M175 388V426" }, layers.kid);
  const xs = [115, 175, 235], ys = [165, 225, 285, 345];
  let idx = 0;
  ys.forEach((y) => xs.forEach((x) => {
    const g = mk("g", {}, layers.kid);
    cell(g, { cls: "neph", r: 12, nuc: 0.4, seed: idx * 1.7 + 1, wob: 0.12 });
    mk("path", { class: "ck-tub", d: "M-8 10q8 10 0 18q-6 8 2 14" }, g);
    const scar = mk("g", { opacity: "0" }, g);
    mk("path", { class: "ck-scarx", d: "M-7 -7L7 7M7 -7L-7 7" }, scar);
    neph.push({ g, scar, x, y, idx });
    idx++;
  }));
  E.vessRect = mk("rect", { class: "ck-vess", x: 360, y: 138, width: 560, height: 56, rx: 28 }, layers.vess);
  mk("path", { class: "ck-arrow", d: "M272 322C400 368 580 368 712 326" }, layers.bonebox);
  E.pthG = mk("g", {}, layers.bonebox);
  mk("circle", { class: "sc-p p-pth", cx: -12, cy: 0, r: 10 }, E.pthG);
  mk("circle", { class: "sc-p p-pth", cx: 12, cy: 0, r: 10 }, E.pthG);
  mk("ellipse", { class: "ck-bone", cx: 785, cy: 300, rx: 70, ry: 38 }, layers.bonebox);
  mk("ellipse", { class: "ck-marrow", cx: 785, cy: 300, rx: 50, ry: 23 }, layers.bonebox);
  mk("circle", { class: "ck-bone", cx: 500, cy: 294, r: 14 }, layers.bonebox);
  mk("circle", { class: "ck-bone", cx: 612, cy: 294, r: 14 }, layers.bonebox);
  E.boneShaft = mk("rect", { class: "ck-bone", x: 500, y: 285, width: 112, height: 18 }, layers.bonebox);
  E.dialG = mk("g", { opacity: "0" }, layers.bonebox);
  mk("rect", { class: "ck-mach", x: 854, y: 108, width: 52, height: 76, rx: 8 }, E.dialG);
  mk("rect", { class: "ck-machin", x: 862, y: 118, width: 36, height: 40, rx: 4 }, E.dialG);
  mk("circle", { class: "ck-machin", cx: 880, cy: 170, r: 6 }, E.dialG);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, lane: 0 }; }); }
const filt = pool(36, () => mk("circle", { class: "p-filt", r: 2 }, layers.parts));
const pthP = pool(10, () => mk("circle", { class: "sc-p p-pth", r: 2.6 }, layers.parts));
const epoP = pool(10, () => mk("circle", { class: "sc-p p-epo", r: 2.6 }, layers.parts));
const marP = pool(10, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 6, ry: 3.6 }, g); mk("ellipse", { class: "cl-s", rx: 2.2, ry: 1.1 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* blood lane particles: each rides the vessel from left to right on its own lane */
function lanePool(n, build, laneBase) { const pl = pool(n, build); pl.forEach((p, i) => { p.x = rnd(370, 910); p.lane = laneBase + (i % 4) * 9; p.vx = rnd(26, 44); }); return pl; }
const rbcB = lanePool(16, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); return g; }, -14);
const ureaP = lanePool(20, () => mk("circle", { class: "sc-p p-urea", r: 2.6 }, layers.parts), -12);
const potP = lanePool(12, () => mk("rect", { class: "sc-p p-pot", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts), -8);
const acidP = lanePool(12, () => mk("circle", { class: "sc-p p-acid", r: 2 }, layers.parts), 2);
const phosP = lanePool(12, () => mk("circle", { class: "sc-p p-phos", r: 2.8 }, layers.parts), 8);
function rideLane(pl, dt, frac, cy) {
  const want = Math.round(clamp(frac) * pl.length);
  pl.forEach((p, i) => { const on = i < want; if (!on) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.x += p.vx * dt; if (p.x > 914) p.x = 366; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(cy + p.lane) + ")"); });
}
/* ---- labels and gauges ---- */
const gg = {};
const rxPills = {};
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [84, 190, 296, 402, 508, 614, 720, 826];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["gfr", "Filtration", "g-good", "How much blood the glomeruli filter (GFR). Hyperfiltration by the nephrons that remain holds it up early, then it falls as more nephrons are lost."],
    ["urea", "Urea", "g-urea", "Urea is a waste product the kidney normally clears. It is retained in the blood when filtration falls, and dialysis clears it."],
    ["pot", "Potassium", "g-pot", "Potassium is normally cleared by the kidney. Retention raises blood potassium (hyperkalaemia), which can disturb heart rhythm. Dialysis clears it."],
    ["acid", "Acid load", "g-acid", "The kidney normally clears hydrogen ions and remakes bicarbonate. Retention causes a build up of acid (acidosis). Dialysis helps clear it."],
    ["phos", "Phosphate", "g-phos", "Phosphate is normally cleared by the kidney. Retention raises blood phosphate. A binder in the gut and dialysis lower it."],
    ["pth", "Parathyroid", "g-clot", "Parathyroid hormone (PTH). Retained phosphate and disturbed vitamin D make the parathyroid glands release more PTH (secondary hyperparathyroidism), which thins bone."],
    ["hb", "Haemoglobin", "g-bad", "Haemoglobin in red cells. The failing kidney makes less erythropoietin, so the marrow makes fewer red cells and anaemia follows. Erythropoietin treatment raises it."],
    ["bp", "Pressure", "g-fl", "Blood pressure. Retained salt and water and pressure-raising systems raise it in chronic kidney disease, and high pressure speeds further nephron loss. Blood pressure control lowers it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Nephrons", 120, 170, 105, 100, "Nephrons are the filtering units of the kidney. In chronic kidney disease they are lost one by one and do not grow back. The pale crossed units here are lost nephrons.");
  pill(ox, "Hyperfiltration", 225, 285, 250, 100, "Hyperfiltration: each nephron that remains enlarges and filters more than usual. This holds total filtration up early on but strains the survivors.");
  pill(ox, "Blood", 500, 142, 480, 108, "Blood in the circulation. Waste products, potassium, acid and phosphate build up here when the kidney cannot clear them, and pressure rises.");
  pill(ox, "Retained solutes", 640, 166, 640, 108, "Retained solutes: urea, potassium, hydrogen ions (acid) and phosphate that a healthy kidney would have cleared into the urine.");
  pill(ox, "Parathyroid", 437, 282, 430, 248, "Parathyroid glands. Retained phosphate and disturbed vitamin D drive them to release more parathyroid hormone. The glands enlarge as hormone output rises.");
  pill(ox, "Bone", 555, 294, 560, 248, "Bone. Excess parathyroid hormone draws calcium out of bone to hold blood calcium up, so bone thins and weakens over time.");
  pill(ox, "Marrow", 785, 300, 785, 248, "Bone marrow, where red cells are made. It needs erythropoietin from the kidney. When that hormone falls, red cell production falls and anaemia follows.");
  pill(ox, "Urine", 180, 410, 260, 420, "Urine leaving the kidney through the ureter. Less filtrate is made as filtration falls, so less urine is formed.");
  pill(ox, "Red cells", 730, 335, 650, 385, "Red cells made in the marrow and released into the blood. Fewer are made when erythropoietin is low, which is anaemia.");
  rxPills.bp = pill(ox, "Pressure control", 540, 176, 540, 222, "Blood pressure control: lowering pressure protects the remaining nephrons, the heart and the circulation.");
  rxPills.binder = pill(ox, "Binder and vitamin D", 500, 320, 500, 382, "A phosphate binder taken with food binds phosphate in the gut, and active vitamin D helps settle parathyroid hormone. Together they lower phosphate and parathyroid hormone.");
  rxPills.epo = pill(ox, "Erythropoietin", 760, 320, 815, 385, "Erythropoietin treatment replaces the hormone the failing kidney no longer makes, so the marrow makes more red cells and haemoglobin rises.");
  rxPills.dial = pill(ox, "Dialysis", 880, 150, 880, 92, "Dialysis: blood passes through an artificial filter that clears urea, potassium, acid and phosphate and removes extra fluid.");
}
const epoTrack = track([[272, 322], [400, 365], [560, 365], [712, 326]]);
const sm = { s: 0.7, N: 0.4, Hf: 0.75, GFR: 0.48, U: 0.54, K: 0.5, Ac: 0.5, Ph: 0.52, PTH: 0.54, BP: 0.72, Hb: 0.5, bpRx: 0, binder: 0, epoRx: 0, dial: 0 };
const KEYS = Object.keys(sm);
const acc = { filt: 0, pth: 0, epo: 0, mar: 0 };
function init() { initKidney(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const vcy = 166, vh = 44 + 22 * sm.BP;
  E.vessRect.setAttribute("y", f1(vcy - vh / 2)); E.vessRect.setAttribute("height", f1(vh));
  /* nephrons: survivors enlarge and work harder, lost units fade and are crossed */
  const active = Math.round(sm.N * neph.length);
  neph.forEach((u, i) => { const on = i < active; const sc = on ? 1 + 0.4 * sm.Hf : 0.85; place(u.g, u.x, u.y, 0, sc); u.g.style.opacity = on ? "1" : "0.32"; u.scar.setAttribute("opacity", on ? "0" : "1"); });
  /* filtrate from surviving nephrons down to the ureter */
  acc.filt += dt * sm.GFR * 7; while (acc.filt >= 1) { acc.filt--; const p = free(filt), src = neph[Math.floor(Math.random() * Math.max(1, active))]; if (p && src) emit(p, src.x + rnd(-6, 6), src.y + 14, rnd(-4, 4), rnd(10, 18)); }
  filt.forEach((p) => { if (!p.on) return; p.x += (175 - p.x) * dt * 0.7 + p.vx * dt; p.y += p.vy * dt + 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 420) kill(p); });
  /* retained solutes ride the blood; counts follow the model */
  rideLane(rbcB, dt, 0.35 + 0.6 * sm.Hb, vcy);
  rideLane(ureaP, dt, sm.U, vcy); rideLane(potP, dt, sm.K, vcy); rideLane(acidP, dt, sm.Ac, vcy); rideLane(phosP, dt, sm.Ph, vcy);
  /* parathyroid hormone from gland to bone; gland enlarges, bone thins */
  place(E.pthG, 437, 282, 0, 0.7 + 0.8 * sm.PTH);
  E.boneShaft.setAttribute("height", f1(18 - 8 * sm.PTH)); E.boneShaft.setAttribute("y", f1(285 + 4 * sm.PTH));
  acc.pth += dt * sm.PTH * 3.2; while (acc.pth >= 1) { acc.pth--; const p = free(pthP); if (p) emit(p, 452, 282, rnd(18, 30), rnd(-4, 6)); }
  pthP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 545) kill(p); });
  /* erythropoietin from kidney to marrow, then red cells up into the blood */
  const epoRate = sm.epoRx > 0.4 ? 1 : sm.N;
  acc.epo += dt * epoRate * 2.6; while (acc.epo >= 1) { acc.epo--; const p = free(epoP); if (p) { emit(p, 272, 322, 0, 0); p.u = 0; } }
  epoP.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; if (p.u >= 1) { kill(p); return; } const q = epoTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.mar += dt * sm.Hb * 3; while (acc.mar >= 1) { acc.mar--; const p = free(marP); if (p) emit(p, 760 + rnd(-24, 24), 306, rnd(14, 24), -rnd(26, 38)); }
  marP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < vcy + 10 || p.x > 905) kill(p); });
  /* treatment cues */
  E.dialG.setAttribute("opacity", sm.dial.toFixed(2));
  setVis(rxPills.bp, clamp(sm.bpRx)); setVis(rxPills.binder, clamp(sm.binder)); setVis(rxPills.epo, clamp(sm.epoRx)); setVis(rxPills.dial, clamp(sm.dial));
  /* gauges */
  gg.gfr.set(sm.GFR, wordOf(sm.GFR, 0.35, 0.75, ["very low", "reduced", "near normal"]));
  gg.urea.set(sm.U, wordOf(sm.U, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.pot.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.acid.set(sm.Ac, wordOf(sm.Ac, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.phos.set(sm.Ph, wordOf(sm.Ph, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.pth.set(sm.PTH, wordOf(sm.PTH, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.hb.set(sm.Hb, wordOf(sm.Hb, 0.45, 0.75, ["low", "reduced", "normal"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.6, ["controlled", "raised", "high"]));
}
run({ init, step });
