/* Amyloidosis scene: precursor misfolding, beta-pleated sheet, fibrils, extracellular deposits, Congo red and organ deposition. */
const layers = { base: $("base"), deps: $("deps"), parts: $("parts"), over: $("over"), panel: $("panel") };
const FLOW = track([[110, 160], [285, 160], [465, 160], [650, 160], [650, 224], [560, 300], [430, 340]]);
/* ---- static nodes ---- */
const nodes = {};
function initNodes() {
  const B = layers.base;
  [[148, 160, 247, 160], [323, 160, 422, 160], [508, 160, 602, 160]].forEach(([x1, y1, x2, y2]) => {
    mk("path", { class: "amy-link", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2 }, B);
    mk("path", { class: "amy-link", d: "M" + (x2 - 7) + " " + (y2 - 4) + "L" + x2 + " " + y2 + "L" + (x2 - 7) + " " + (y2 + 4) }, B);
  });
  const pre = mk("g", {}, B); cell(pre, { cls: "prot", r: 28, nuc: 0, seed: 3, wob: 0.12 });
  mk("path", { class: "amy-strand", style: "stroke:var(--anatomy-strong)", d: "M-16 -6C-8 -14 2 -2 8 -8C14 -13 18 -6 16 2C10 8 -2 4 -8 8C-14 12 -18 2 -16 -6Z" }, pre);
  place(pre, 110, 160); nodes.pre = pre;
  const mis = mk("g", {}, B); cell(mis, { cls: "mis", r: 28, nuc: 0, seed: 7, wob: 0.16 });
  mk("path", { class: "amy-strand", d: "M-17 8L-9 -8L-2 8L5 -8L12 8L18 -6" }, mis);
  place(mis, 285, 160); nodes.mis = mis;
  const sheet = mk("g", {}, B);
  for (let r = 0; r < 4; r++) { const y = -21 + r * 14; let d = "M-40 " + y; for (let s = 0; s < 8; s++) d += "L" + (-30 + s * 10) + " " + (y + (s % 2 ? 5 : -5)); mk("path", { class: "amy-strand", d }, sheet); }
  for (let cix = 0; cix < 5; cix++) mk("path", { class: "amy-link", d: "M" + (-32 + cix * 16) + " -21L" + (-32 + cix * 16) + " 21" }, sheet);
  place(sheet, 465, 160); nodes.sheet = sheet;
  const fib = mk("g", {}, B);
  mk("path", { class: "amy-fib", d: "M-48 -8C-24 -18 0 2 24 -8C36 -13 44 -10 48 -8" }, fib);
  mk("path", { class: "amy-fib2", d: "M-48 8C-24 18 0 -2 24 8C36 13 44 10 48 8" }, fib);
  for (let cix = 0; cix < 6; cix++) mk("path", { class: "amy-link", d: "M" + (-38 + cix * 15) + " -9L" + (-38 + cix * 15) + " 9" }, fib);
  place(fib, 650, 160); nodes.fib = fib;
  /* precursor types */
  nodes.types = [[55, 270, "#7fc4e8"], [55, 310, "#f08a4b"], [55, 350, "#3ddc97"]].map(([x, y, col]) => {
    const g = mk("g", {}, B); mk("circle", { class: "cl-b", style: "--cc:" + col, r: 9 }, g); mk("circle", { class: "cl-h", r: 3, cx: -2, cy: -2 }, g); place(g, x, y); return g;
  });
  /* organs */
  const heart = mk("g", {}, B); mk("path", { class: "amy-heart", d: "M0 24C-30 5 -24 -20 -9 -20C-3 -20 0 -12 0 -7C0 -12 3 -20 9 -20C24 -20 30 5 0 24Z" }, heart); place(heart, 675, 315); nodes.heart = heart;
  const kid = mk("g", {}, B); mk("path", { class: "amy-kid", d: "M-13 -22C10 -24 22 -7 18 9C14 26 -8 28 -17 15C-23 5 -11 1 -13 -8C-15 -15 -20 -20 -13 -22Z" }, kid); place(kid, 790, 315); nodes.kid = kid;
  const nerve = mk("g", {}, B);
  mk("path", { class: "amy-nerve", d: "M855 315C870 300 885 330 900 315C912 303 925 322 938 312" }, nerve);
  mk("path", { class: "amy-myelin", d: "M868 310L882 318M898 312L912 314" }, nerve);
  nodes.nerve = nerve;
  nodes.rings = [[675, 315], [790, 315], [897, 315]].map(([x, y]) => { const e = mk("ellipse", { class: "amy-ring", cx: x, cy: y, rx: 42, ry: 34 }, B); return e; });
}
/* ---- deposits ---- */
const depPts = [[320, 285], [390, 340], [460, 290], [530, 345], [350, 385], [480, 395], [300, 340], [560, 290]];
const deps = depPts.map(([x, y], i) => {
  const g = mk("g", {}, layers.deps);
  for (let j = 0; j < 5; j++) mk("path", { class: j % 2 ? "amy-dep2" : "amy-dep", d: "M" + f1(rnd(-13, 3)) + " " + f1(rnd(-8, 8)) + "L" + f1(rnd(3, 13)) + " " + f1(rnd(-8, 8)) }, g);
  place(g, x, y, i * 24, 0.2); return { g, x, y, sens: 0.55 + (i % 4) * 0.18 };
});
const congo = (() => { const g = mk("g", {}, layers.deps);
  for (let j = 0; j < 5; j++) mk("path", { class: "amy-dep", d: "M" + f1(rnd(-12, 3)) + " " + f1(rnd(-7, 7)) + "L" + f1(rnd(3, 12)) + " " + f1(rnd(-7, 7)) }, g);
  mk("circle", { class: "amy-congo", r: 20 }, g); place(g, 565, 385, 12, 1); return g; })();
/* ---- particles along the pathway ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, sp: 0 }; }); }
const dots = pool(26, () => mk("circle", { class: "sc-p p-amy", r: 2.6 }, layers.parts));
const freeDot = (pl) => pl.find((p) => !p.on);
/* ---- labels and gauges ---- */
const gg = {}; let rxCause = null, rxChemo = null, supPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [140, 360, 580, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The tissues";
  [["pre", "Precursor", "g-prot", "How much amyloid precursor protein is being made. AL comes from light chains, AA from an inflammatory protein, transthyretin from transthyretin."], ["fib", "New fibrils", "g-amy", "How fast misfolded protein is stacking into new amyloid fibrils."], ["dep", "Deposition", "g-amy", "How much fibril material has built up outside cells. It clears slowly, so it falls only a little when the precursor is cut."], ["fn", "Organ function", "g-good", "How well the deposited organs still work. Supportive care helps this without removing deposits."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Precursor protein", 110, 132, 110, 95, "A normal soluble protein that can misfold. The source depends on the type: light chains, serum amyloid A, or transthyretin.");
  pill(ox, "Misfolded protein", 285, 132, 285, 95, "The precursor loses its normal shape. In this shape it tends to stack on other misfolded copies instead of staying dissolved.");
  pill(ox, "Beta-pleated sheet", 465, 132, 465, 95, "Misfolded proteins line up in a beta-pleated sheet: flat strands held side by side. This stacked shape is the core of amyloid.");
  pill(ox, "Amyloid fibril", 650, 132, 650, 95, "Many sheets twist into a rigid fibril. Fibrils are hard for the body to break down and they deposit outside cells.");
  pill(ox, "AL light chain", 64, 270, 155, 270, "AL amyloidosis: the precursor is an immunoglobulin light chain made by a plasma cell clone in the bone marrow.");
  pill(ox, "AA reactive", 64, 310, 155, 310, "AA amyloidosis: the precursor is serum amyloid A, raised by long-standing inflammation. Treating that inflammation lowers it.");
  pill(ox, "Transthyretin", 64, 350, 155, 350, "Transthyretin amyloidosis: the precursor is transthyretin, from an inherited variant or from the normal protein with ageing. Heart and nerve are often affected.");
  pill(ox, "Extracellular deposit", 430, 268, 430, 245, "Fibrils build up outside cells, in the spaces between them. The deposit stiffens tissue and gets in the way of normal cells.");
  pill(ox, "Congo red", 565, 365, 565, 425, "Congo red dye binds the deposit. Under polarised light it shows apple-green colour, the classic way amyloid is proved in tissue.");
  pill(ox, "Heart", 675, 290, 675, 245, "Heart deposition stiffens the ventricle walls. Filling is restricted, so breathlessness and fluid retention follow.");
  pill(ox, "Kidney", 790, 290, 790, 245, "Kidney deposition damages the filters. Protein leaks into the urine and kidney function can fall.");
  pill(ox, "Nerve", 897, 292, 897, 245, "Nerve deposition injures peripheral nerves, causing numbness, pain and weakness, and can affect gut and blood pressure control.");
  rxCause = pill(ox, "Treat the cause", 110, 190, 110, 225, "Treating the underlying cause lowers precursor supply: for example controlling the inflammation behind AA amyloidosis.");
  rxChemo = pill(ox, "Chemotherapy", 110, 190, 110, 225, "Chemotherapy for AL amyloidosis targets the plasma cell clone making the light chain, cutting the precursor supply.");
  supPill = pill(ox, "Supportive care", 690, 340, 775, 405, "Supportive care helps the affected organs, for example managing fluid and heart strain. It does not remove deposits or stop new fibrils.");
  rxCause.style.opacity = 0; rxChemo.style.opacity = 0; supPill.style.opacity = 0;
}
const sm = { P: 0.5, F: 0.4, D: 0.5, Fn: 0.5, cause: 0, chemo: 0, sup: 0 };
const acc = { dot: 0 };
function init() { initNodes(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.P = lerp(sm.P, m.P, k2); sm.F = lerp(sm.F, m.F, k2); sm.D = lerp(sm.D, m.D, k2); sm.Fn = lerp(sm.Fn, m.Fn, k1);
  sm.cause = lerp(sm.cause, m.src === 0.3 ? 1 : 0, k1); sm.chemo = lerp(sm.chemo, m.src === 0.18 ? 1 : 0, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  place(nodes.pre, 110 + Math.sin(tm / 1500) * 2, 160 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 0.75 + 0.35 * sm.P);
  place(nodes.mis, 285, 160, Math.sin(tm / 900) * 7, 0.7 + 0.4 * sm.F);
  place(nodes.sheet, 465, 160, 0, 0.75 + 0.3 * sm.F);
  place(nodes.fib, 650, 160 + Math.sin(tm / 1200) * 2, Math.sin(tm / 2000) * 3, 0.8 + 0.3 * sm.F);
  deps.forEach((d) => { const s = clamp((sm.D - 0.12) * d.sens * 1.5); place(d.g, d.x, d.y, Math.sin(tm / 1800 + d.x) * 4, 0.15 + s); d.g.style.opacity = s > 0.03 ? 1 : 0; });
  congo.style.opacity = (0.35 + 0.65 * sm.D).toFixed(2);
  nodes.rings.forEach((e, i) => { e.setAttribute("opacity", (sm.D * (0.45 + 0.15 * Math.sin(tm / 700 + i * 2))).toFixed(2)); e.setAttribute("rx", f1(38 + 10 * sm.D)); e.setAttribute("ry", f1(30 + 8 * sm.D)); });
  place(nodes.heart, 675, 315, 0, 1 - 0.08 * sm.D + 0.02 * Math.sin(tm / 420));
  place(nodes.kid, 790, 315, 0, 1 - 0.05 * sm.D);
  acc.dot += dt * sm.F * 7; while (acc.dot >= 1) { acc.dot--; const p = freeDot(dots); if (p) { p.on = true; p.u = 0; p.sp = rnd(0.1, 0.16); p.e.setAttribute("opacity", "1"); } }
  dots.forEach((p) => { if (!p.on) return; p.u += p.sp * dt * (0.5 + sm.F); const q = FLOW.at(clamp(p.u, 0, 1)); p.e.setAttribute("transform", "translate(" + f1(q.x + Math.sin(tm / 300 + p.u * 9) * 3) + " " + f1(q.y + Math.cos(tm / 340 + p.u * 7) * 3) + ")"); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  rxCause.style.opacity = sm.cause.toFixed(2); rxChemo.style.opacity = sm.chemo.toFixed(2); supPill.style.opacity = sm.sup.toFixed(2);
  gg.pre.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["low", "present", "high"])); gg.fib.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["low", "present", "high"]));
  gg.dep.set(sm.D, wordOf(sm.D, 0.35, 0.65, ["little", "moderate", "extensive"])); gg.fn.set(sm.Fn, wordOf(sm.Fn, 0.4, 0.65, ["poor", "reduced", "preserved"]));
}
run({ init, step });
