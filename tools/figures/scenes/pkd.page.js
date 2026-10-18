/* Polycystic kidney disease scene: mutated gene, defective cilium, proliferation, fluid secretion, cyst growth, body effects and gauges. */
const WW = SC.W;
const layers = { kid: $("kid"), tub: $("tub"), fx: $("bodyfx"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = {};
const cystsKid = [];
const epiCells = [];
function initKidney() {
  E.kidG = mk("g", {}, layers.kid);
  mk("ellipse", { class: "pk-kid", cx: 185, cy: 255, rx: 90, ry: 118 }, E.kidG);
  mk("path", { class: "pk-ureter", d: "M185 368V408" }, E.kidG);
  const dna = mk("g", {}, layers.kid);
  mk("path", { class: "pk-dna", d: "M96 100q9 8 0 16q-9 8 0 16" }, dna);
  mk("path", { class: "pk-dna", d: "M124 100q-9 8 0 16q9 8 0 16" }, dna);
  [104, 116, 128].forEach((y) => mk("path", { class: "pk-rung", d: "M100 " + y + "H120" }, dna));
  mk("circle", { class: "pk-mut", cx: 110, cy: 116, r: 5 }, dna);
  const pos = [[140, 175, 16], [195, 165, 20], [238, 195, 15], [130, 225, 22], [185, 218, 26], [238, 245, 20], [145, 278, 18], [200, 282, 24], [242, 305, 14], [165, 325, 17], [215, 338, 15], [120, 300, 13]];
  pos.forEach(([x, y, r], i) => { const c = mk("circle", { class: "pk-cyst", cx: x, cy: y, r: r }, E.kidG); cystsKid.push({ c, r, i }); });
  const burst = mk("g", {}, layers.kid);
  mk("path", { class: "pk-berry", d: "M262 348l4 10 10 1-8 7 3 10-9-6-9 6 3-10-8-7 10-1Z" }, burst);
  E.burst = burst;
}
function initTubule() {
  E.lumen = mk("circle", { class: "pk-lumen", cx: 490, cy: 225, r: 56 }, layers.tub);
  mk("path", { class: "pk-tubule", d: "M425 308C455 326 525 326 555 308" }, layers.tub);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 6.283, x = 490 + Math.cos(a) * 70, y = 225 + Math.sin(a) * 70;
    const gcell = cell(layers.tub, { cls: "epi", r: 13, nuc: 0.4, seed: i * 1.9 + 1, wob: 0.12 });
    epiCells.push({ g: gcell, x, y, a, i });
  }
  E.cilia = mk("g", {}, layers.tub);
  mk("path", { class: "pk-cilia", d: "M490 164q-6 14 0 28" }, E.cilia);
  mk("circle", { class: "pk-poly", cx: 488, cy: 176, r: 3.4 }, E.cilia);
  mk("circle", { class: "pk-poly", cx: 491, cy: 188, r: 3.4 }, E.cilia);
}
function initBody() {
  mk("ellipse", { class: "pk-liver", cx: 715, cy: 123, rx: 46, ry: 27 }, layers.fx);
  E.liverCysts = [[700, 115, 9], [725, 128, 11], [712, 134, 7]].map(([x, y, r]) => mk("circle", { class: "pk-cyst", cx: x, cy: y, r: r }, layers.fx));
  mk("path", { class: "pk-vess", d: "M822 142C845 104 882 104 908 142" }, layers.fx);
  E.berry = mk("circle", { class: "pk-berry", cx: 865, cy: 106, r: 11 }, layers.fx);
  E.vessRect = mk("rect", { class: "pk-vess", x: 664, y: 218, width: 252, height: 28, rx: 14 }, layers.fx);
  mk("path", { class: "pk-ureter", d: "M672 306L754 320M908 306L826 320" }, layers.fx);
  mk("ellipse", { class: "pk-blad", cx: 790, cy: 326, rx: 34, ry: 21 }, layers.fx);
  E.urineDots = [[778, 320, 4], [792, 330, 5], [804, 319, 3.4]].map(([x, y, r]) => mk("circle", { class: "p-urine", cx: x, cy: y, r: r }, layers.fx));
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, a: 0 }; }); }
const fluidP = pool(22, () => mk("circle", { class: "p-fluid", r: 2.6 }, layers.parts));
const rbcP = pool(12, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); return g; });
rbcP.forEach((p, i) => { p.x = rnd(670, 910); p.y = 232 + (i % 3 - 1) * 6; p.vx = rnd(28, 46); });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
const rxPills = {};
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [105, 225, 345, 465, 585, 705, 825];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["cyst", "Cysts", "g-cyst", "Cyst burden: how much of the kidney is taken up by cysts. It rises as cysts form and grow."],
    ["size", "Size", "g-size", "Kidney size. Many growing cysts enlarge both kidneys, sometimes greatly."],
    ["filt", "Filtration", "g-good", "How much blood the working nephrons filter. It is held up early, then falls as cysts replace nephrons, ending in kidney failure."],
    ["bp", "Pressure", "g-fluid", "Blood pressure. It is often high in this condition and high pressure speeds further kidney damage. Blood pressure control lowers it."],
    ["waste", "Waste", "g-bad", "Waste products the kidney normally clears. They are retained when filtration falls. Dialysis or transplant clears them."],
    ["haem", "Haematuria", "g-pain", "Blood in the urine. A cyst can bleed into the urine, which turns red or brown."],
    ["pain", "Pain", "g-pain", "Flank pain from the enlarged kidney and its stretched covering, and from cyst bleeding."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mutated gene", 110, 116, 110, 88, "A mutation in PKD1 or PKD2, the genes for polycystin. It is passed on in an autosomal dominant pattern, so each child has a chance of inheriting it.");
  pill(ox, "Defective cilium", 490, 178, 490, 95, "The primary cilium on a tubular cell. Faulty polycystin on the cilium disturbs flow sensing and signalling, so growth and fluid control fail.");
  pill(ox, "Fluid secretion", 452, 232, 395, 340, "Fluid secretion: the cyst lining pumps fluid into the cyst space, so the cyst swells from inside.");
  pill(ox, "Growing cyst", 548, 248, 585, 340, "A cyst that has budded from a tubule and is growing. The lining cells multiply and secrete fluid, and the cyst presses on working nephrons nearby.");
  pill(ox, "Liver cysts", 715, 123, 715, 182, "Cysts in the liver are a common association. They grow from bile duct tissue and usually leave liver function working.");
  pill(ox, "Berry aneurysm", 865, 106, 865, 182, "A berry aneurysm: a small sac on a brain vessel wall. It is an association of this condition and can bleed if it bursts.");
  pill(ox, "High pressure", 790, 224, 790, 278, "High blood pressure is common, appears early, and speeds loss of kidney function. Controlling it protects the kidneys and circulation.");
  pill(ox, "Flank pain", 262, 356, 240, 398, "Flank pain in the loin from the enlarged kidney, its stretched covering, and bleeding into a cyst.");
  pill(ox, "Blood in urine", 790, 326, 700, 385, "Blood in the urine (haematuria) when a cyst bleeds or bursts into the urine space. The urine may look red or smoky.");
  rxPills.tolv = pill(ox, "Tolvaptan", 490, 292, 490, 375, "Tolvaptan concept: blocking a fluid secretion signal slows cyst growth and kidney enlargement. Shown as an idea only.");
  rxPills.repl = pill(ox, "Dialysis or transplant", 822, 326, 855, 385, "Dialysis or transplant replaces kidney function when filtration is very low: dialysis filters the blood, and a transplant does the kidney work.");
}
const sm = { cyst: 0.5, size: 0.5, filt: 0.5, waste: 0.4, bp: 0.5, haem: 0.4, pain: 0.4, liver: 0.4, aneur: 0.4, tolv: 0, repl: 0 };
const KEYS = Object.keys(sm);
const acc = { fluid: 0 };
function init() { initKidney(); initTubule(); initBody(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], kk); });
  /* kidney enlargement and cyst growth */
  const ks = 0.82 + 0.3 * sm.size;
  E.kidG.setAttribute("transform", "translate(185 255) scale(" + ks.toFixed(3) + ") translate(-185 -255)");
  cystsKid.forEach((c) => { const sc = 0.35 + 0.85 * sm.cyst; c.c.setAttribute("r", f1(c.r * sc)); c.c.style.opacity = (0.35 + 0.65 * sm.cyst).toFixed(2); });
  E.burst.style.opacity = (0.25 + 0.75 * sm.pain).toFixed(2);
  /* magnified cyst: lumen swells, lining cells multiply and pulse */
  const lr = 34 + 30 * sm.cyst;
  E.lumen.setAttribute("r", f1(lr));
  epiCells.forEach((c) => { const ring = lr + 14, x = 490 + Math.cos(c.a) * ring, y = 225 + Math.sin(c.a) * ring; const pulse = 1 + 0.1 * sm.cyst * Math.sin(tm / 320 + c.i * 1.3); place(c.g, x, y, 0, pulse); });
  E.cilia.setAttribute("transform", "translate(490 164) rotate(" + f1(Math.sin(tm / 420) * 9) + ") translate(-490 -164)");
  /* fluid secretion: droplets move from the lining into the cyst space */
  const rate = sm.cyst * (sm.tolv > 0.4 ? 0.35 : 1);
  acc.fluid += dt * rate * 9; while (acc.fluid >= 1) { acc.fluid--; const p = free(fluidP); if (p) { const a = rnd(0, 6.28), rr = lr + 10; emit(p, 490 + Math.cos(a) * rr, 225 + Math.sin(a) * rr, -Math.cos(a) * rnd(14, 22), -Math.sin(a) * rnd(14, 22)); p.a = a; } }
  fluidP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(p.x - 490, p.y - 225) < 12 || p.t > 2.4) kill(p); });
  /* body effects */
  E.liverCysts.forEach((c, i) => { c.style.opacity = (0.25 + 0.75 * sm.liver).toFixed(2); c.setAttribute("r", f1((7 + i * 2) * (0.5 + 0.7 * sm.liver))); });
  E.berry.setAttribute("r", f1(6 + 9 * sm.aneur));
  const vh = 20 + 16 * sm.bp;
  E.vessRect.setAttribute("y", f1(232 - vh / 2)); E.vessRect.setAttribute("height", f1(vh));
  rbcP.forEach((p) => { p.x += p.vx * dt * (0.5 + 0.6 * sm.bp); if (p.x > 912) p.x = 668; p.e.setAttribute("opacity", "1"); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 500 + p.x) * 1.5) + ")"); });
  E.urineDots.forEach((c) => { c.style.opacity = (0.15 + 0.85 * sm.haem).toFixed(2); });
  setVis(rxPills.tolv, clamp(sm.tolv)); setVis(rxPills.repl, clamp(sm.repl));
  /* gauges */
  gg.cyst.set(sm.cyst, wordOf(sm.cyst, 0.35, 0.7, ["low", "raised", "high"]));
  gg.size.set(sm.size, wordOf(sm.size, 0.35, 0.7, ["near normal", "enlarged", "very large"]));
  gg.filt.set(sm.filt, wordOf(sm.filt, 0.35, 0.75, ["very low", "reduced", "near normal"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.6, ["controlled", "raised", "high"]));
  gg.waste.set(sm.waste, wordOf(sm.waste, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.haem.set(sm.haem, wordOf(sm.haem, 0.3, 0.6, ["none", "some", "visible"]));
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.3, 0.6, ["none", "mild", "marked"]));
}
run({ init, step });
