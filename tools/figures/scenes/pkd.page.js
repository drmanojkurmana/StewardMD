/* Polycystic kidney disease scene: faulty gene, cyst growth on a real kidney, tubule fluid
 * secretion with a blockable receptor, liver cysts, pressure vessel, bladder bleeding and a
 * dialysis filter. Drug mechanisms are animated: blockers dock on receptors, vessels calm,
 * waste is trapped in a filter. */
const WW = SC.W;
const layers = { kid: $("kid"), tub: $("tub"), fx: $("bodyfx"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = {};
const KX = 185, KY = 250, KW = 190;
const CX = 490, CY = 225;
const cystsKid = [];
const epiCells = [];
const recPos = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
const REC_IDX = [0, 4, 8];
function initKidney() {
  E.kidG = mk("g", {}, layers.kid);
  E.kidO = organ(E.kidG, "kidney", KX, KY, KW, {});
  mk("path", { class: "pk-ureter", d: "M158 246V384" }, E.kidG);
  const cp = E.kidO.ports.cortex;
  const off = [[-45, -65, 14], [-5, -72, 17], [38, -42, 13], [-52, -12, 16], [-2, -18, 20], [44, 8, 15], [-38, 38, 15], [6, 42, 19], [42, 56, 12], [-16, 78, 14], [24, 82, 13], [-44, 40, 12]];
  off.forEach(([dx, dy, r]) => { const c = mk("circle", { class: "pk-cyst", cx: f1(cp[0] + dx), cy: f1(cp[1] + dy), r: r }, E.kidG); cystsKid.push({ c, bx: cp[0] + dx, by: cp[1] + dy, r }); });
  const dna = mk("g", {}, layers.kid);
  mk("path", { class: "pk-dna", d: "M60 78q9 8 0 16q-9 8 0 16" }, dna);
  mk("path", { class: "pk-dna", d: "M88 78q-9 8 0 16q9 8 0 16" }, dna);
  [86, 96, 106].forEach((y) => mk("path", { class: "pk-rung", d: "M64 " + y + "H84" }, dna));
  mk("circle", { class: "pk-mut", cx: 74, cy: 96, r: 5 }, dna);
}
function initTubule() {
  E.lumen = mk("circle", { class: "pk-lumen", cx: CX, cy: CY, r: 48 }, layers.tub);
  mk("path", { class: "pk-tubule", d: "M425 308C455 326 525 326 555 308" }, layers.tub);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 6.283, x = CX + Math.cos(a) * 62, y = CY + Math.sin(a) * 62;
    const gcell = cell(layers.tub, { cls: "epi", r: 13, nuc: 0.4, seed: i * 1.9 + 1, wob: 0.12 });
    epiCells.push({ g: gcell, a, i });
  }
  E.cilia = mk("g", {}, layers.tub);
  mk("path", { class: "pk-cilia", d: "M0 0q-6 -12 0 -24" }, E.cilia);
  mk("circle", { class: "pk-poly", cx: -2, cy: -9, r: 3.4 }, E.cilia);
  mk("circle", { class: "pk-poly", cx: 1, cy: -17, r: 3.4 }, E.cilia);
  E.recs = REC_IDX.map(() => mk("circle", { class: "pk-rec", r: 3.4 }, layers.tub));
}
function initBody() {
  E.glow = mk("ellipse", { class: "pk-glow", cx: 866, cy: 130, rx: 34, ry: 78 }, layers.fx);
  E.livO = organ(layers.fx, "liver", 715, 140, 130, {});
  const lp = E.livO.ports.lobe;
  E.liverCysts = [[-14, -6, 8], [10, 0, 10], [-2, 12, 6.5]].map(([dx, dy, r]) => mk("circle", { class: "pk-cyst", cx: f1(lp[0] + dx), cy: f1(lp[1] + dy), r: r }, layers.fx));
  E.vesO = organ(layers.fx, "vessel", 866, 130, 56, {});
  const wp = E.vesO.ports.wall;
  E.berry = mk("circle", { class: "pk-berry", cx: f1(wp[0] + 7), cy: f1(wp[1]), r: 10 }, layers.fx);
  E.blaO = organ(layers.fx, "bladder", 788, 322, 90, {});
  const tp = E.blaO.ports.trigone;
  E.urineDots = [[-10, -4, 4], [8, 2, 5], [-2, 8, 3.4]].map(([dx, dy, r]) => mk("circle", { class: "p-urine", cx: f1(tp[0] + dx), cy: f1(tp[1] + dy), r: r }, layers.fx));
  E.clearDots = [[-14, 6, 3.4], [12, -6, 3]].map(([dx, dy, r]) => { const c = mk("circle", { class: "p-clean", cx: f1(tp[0] + dx), cy: f1(tp[1] + dy), r: r }, layers.fx); c.setAttribute("opacity", "0.3"); return c; });
  E.filtG = mk("g", {}, layers.fx);
  E.filtG.style.opacity = "0";
  mk("rect", { class: "pk-filt", x: 848, y: 258, width: 88, height: 104, rx: 10 }, E.filtG);
  [284, 310, 336].forEach((y) => mk("path", { class: "pk-mem", d: "M856 " + y + "H928" }, E.filtG));
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, a: 0, st: 0 }; }); }
const fluidP = pool(18, () => mk("circle", { class: "p-fluid", r: 2.6 }, layers.parts));
const blockP = [];
for (let i = 0; i < 6; i++) {
  const g = mk("g", { opacity: "0" }, layers.parts);
  mk("rect", { class: "p-pill", x: -6, y: -3, width: 12, height: 6, rx: 3 }, g);
  mk("rect", { class: "p-pill2", x: 0, y: -3, width: 6, height: 6, rx: 3 }, g);
  blockP.push({ g, on: false, x: 430 + (i * 37) % 130, y: 132, dock: i % 3, wait: (i % 3) * 0.4 + Math.floor(i / 3) * 0.9, st: 0 });
}
const rbcP = pool(10, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 4.2, ry: 7 }, g); mk("ellipse", { class: "cl-s", rx: 1.4, ry: 2.6 }, g); return g; });
const wasteP = pool(10, () => mk("circle", { class: "sc-p p-waste", r: 3.2 }, layers.parts));
const cleanP = pool(8, () => mk("circle", { class: "sc-p p-clean", r: 2.8 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges ---- */
const gg = {};
const rxPills = {};
let capEl = null, capKey = "";
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function capText(l, d) {
  const pre = ["Early. ", "Enlarged. ", "Failing. "][l];
  if (d === 1) return pre + "Pressure control relaxes the vessels and protects the filters.";
  if (d === 2) return pre + "Tolvaptan blocks the fluid signal, so cysts fill and grow more slowly.";
  if (d === 3) return pre + "Dialysis filters waste from the blood, though the cysts stay.";
  return pre + "Cysts swell the kidney, crush filters and push pressure up.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 230, 350, 470, 590, 710];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["cyst", "Cysts", "g-cyst", "Cyst burden: how much of the kidney is taken up by cysts. It rises as cysts form and grow."],
    ["size", "Size", "g-size", "Kidney size. Many growing cysts enlarge both kidneys, sometimes greatly."],
    ["filt", "Filtration", "g-good", "How much blood the working nephrons filter. It is held up early, then falls as cysts replace nephrons, ending in kidney failure."],
    ["bp", "Pressure", "g-fluid", "Blood pressure. It is often high in this condition and high pressure speeds further kidney damage. Pressure control lowers it."],
    ["waste", "Waste", "g-bad", "Waste products the kidney normally clears. They are retained when filtration falls. Dialysis filters them out."],
    ["haem", "Urine blood", "g-pain", "Blood in the urine. A cyst can bleed into the urine, which turns red or smoky."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Faulty gene", 74, 96, 170, 84, "A change in the PKD1 or PKD2 gene makes faulty polycystin. The tubule cell sensor fails, so cells divide and pump fluid.");
  pill(ox, "Kidney cysts", 185, 235, 185, 400, "Many fluid filled cysts swell the kidney and crush working filters. Filtration falls toward kidney failure.");
  pill(ox, "Fluid in", 430, 260, 400, 348, "The cyst lining pumps fluid inward, so each cyst swells from inside. The moving dots show this secretion.");
  const p4 = pill(ox, "Blocked signal", 560, 225, 590, 348, "Tolvaptan concept: a blocker sits on the fluid signal receptor, so less fluid is pumped and cysts grow more slowly. Idea only.");
  rxPills.tolv = p4; E.p4dot = p4.childNodes[1]; E.p4lead = p4.childNodes[0];
  pill(ox, "Liver cysts", 670, 162, 700, 232, "Liver cysts often come with this condition. They usually leave liver function working.");
  pill(ox, "High pressure", 866, 150, 868, 228, "High pressure is common and speeds kidney damage. Pressure control relaxes the vessels, shown calmer here.");
  pill(ox, "Blood in urine", 788, 351, 690, 402, "A cyst can bleed into the urine, which turns red or smoky.");
  rxPills.repl = pill(ox, "Dialysis filter", 892, 310, 862, 400, "Dialysis filters waste from the blood when the kidneys fail. Trapped waste stays in the filter and cleaned blood returns.");
  capEl = mk("text", { class: "pk-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { cyst: 0.5, size: 0.5, filt: 0.5, waste: 0.4, bp: 0.5, haem: 0.4, pain: 0.4, liver: 0.4, aneur: 0.4, tolv: 0, repl: 0 };
const KEYS = Object.keys(sm);
const acc = { fluid: 0, waste: 0, clean: 0 };
let wantBlock = false;
function init() {
  initKidney(); initTubule(); initBody(); initPanel();
  const top = E.vesO.ports.lumen[1], bot = E.vesO.ports.out[1], lx = E.vesO.ports.lumen[0];
  rbcP.forEach((p, i) => { p.x = lx + ((i * 7) % 9) - 4; p.y = top + ((bot - top) * i) / rbcP.length; p.on = true; p.e.setAttribute("opacity", "1"); });
}
function step(dt, m) {
  const kk = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], kk); });
  /* kidney enlargement and cyst growth on the real organ */
  const ks = 0.9 + 0.22 * sm.size;
  E.kidG.setAttribute("transform", "translate(" + KX + " " + KY + ") scale(" + ks.toFixed(3) + ") translate(" + (-KX) + " " + (-KY) + ")");
  cystsKid.forEach((c) => {
    c.c.setAttribute("cx", f1(KX + (c.bx - KX) * ks)); c.c.setAttribute("cy", f1(KY + (c.by - KY) * ks));
    c.c.setAttribute("r", f1(c.r * (0.35 + 0.85 * sm.cyst))); c.c.style.opacity = (0.35 + 0.65 * sm.cyst).toFixed(2);
  });
  /* magnified cyst: lumen swells, lining cells pulse, receptors ride the ring */
  const lr = 34 + 30 * sm.cyst, ring = lr + 14;
  E.lumen.setAttribute("r", f1(lr));
  epiCells.forEach((c) => {
    const x = CX + Math.cos(c.a) * ring, y = CY + Math.sin(c.a) * ring;
    const pulse = 1 + 0.1 * sm.cyst * Math.sin(tm / 320 + c.i * 1.3);
    place(c.g, x, y, 0, pulse); c.x = x; c.y = y;
  });
  REC_IDX.forEach((ci, k) => {
    const c = epiCells[ci], nx = (c.x - CX) / ring, ny = (c.y - CY) / ring;
    recPos[k].x = c.x + nx * 15; recPos[k].y = c.y + ny * 15;
    E.recs[k].setAttribute("cx", f1(recPos[k].x)); E.recs[k].setAttribute("cy", f1(recPos[k].y));
    E.recs[k].style.opacity = (0.35 + 0.65 * Math.max(sm.tolv, 0.3)).toFixed(2);
  });
  const topCellY = CY - ring - 10;
  place(E.cilia, CX, topCellY, Math.sin(tm / 420) * 9, 1);
  /* tolvaptan blockers fly in and sit on the receptors */
  wantBlock = sm.tolv > 0.5;
  if (wantBlock && !E.wasBlock) blockP.forEach((b) => { b.wait = (b.dock) * 0.4 + (b.dock === 2 ? 0.9 : 0); });
  E.wasBlock = wantBlock;
  blockP.forEach((b) => {
    const D = recPos[b.dock];
    if (wantBlock) {
      if (b.wait > 0) { b.wait -= dt; return; }
      b.on = true;
      const dx = D.x - b.x, dy = D.y - b.y, d = Math.hypot(dx, dy);
      if (d < 5) { b.st = 1; b.x = D.x + Math.sin(tm / 300 + b.dock) * 1.5; b.y = D.y + Math.cos(tm / 340 + b.dock) * 1.5; }
      else { b.st = 0; b.x += (dx / d) * 130 * dt; b.y += (dy / d) * 130 * dt; }
      b.g.setAttribute("opacity", "1");
      b.g.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ") rotate(" + f1(Math.atan2(dy, dx) * 57.3) + ")");
    } else if (b.on) {
      b.st = 0; b.y -= 70 * dt;
      b.g.setAttribute("opacity", Math.max(0, (+b.g.getAttribute("opacity")) - dt * 1.2).toFixed(2));
      b.g.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")");
      if (b.y < 118) { b.on = false; b.x = 430 + (b.dock * 37) % 130; b.y = 132; }
    }
  });
  E.p4dot.setAttribute("cx", f1(recPos[0].x)); E.p4dot.setAttribute("cy", f1(recPos[0].y));
  E.p4lead.setAttribute("d", "M" + f1(recPos[0].x) + " " + f1(recPos[0].y) + "L590 356");
  /* fluid secretion: droplets move from the lining into the cyst space */
  const rate = sm.cyst * (sm.tolv > 0.4 ? 0.3 : 1);
  acc.fluid += dt * rate * 7; while (acc.fluid >= 1) { acc.fluid--; const p = free(fluidP); if (p) { const a = rnd(0, 6.28), rr = lr + 10; p.x = CX + Math.cos(a) * rr; p.y = CY + Math.sin(a) * rr; p.vx = -Math.cos(a) * rnd(14, 22); p.vy = -Math.sin(a) * rnd(14, 22); p.t = 0; p.on = true; p.e.setAttribute("opacity", "1"); } }
  fluidP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(p.x - CX, p.y - CY) < 12 || p.t > 2.4) kill(p); });
  /* body effects on real organs */
  E.liverCysts.forEach((c, i) => { c.style.opacity = (0.25 + 0.75 * sm.liver).toFixed(2); c.setAttribute("r", f1((7 + i * 2) * (0.5 + 0.7 * sm.liver))); });
  const pulse = 1 + 0.06 * sm.bp * Math.sin(tm / 280 + 1);
  E.berry.setAttribute("r", f1((6 + 9 * sm.aneur) * pulse));
  const vs = 1 + 0.045 * sm.bp * Math.sin(tm / 280);
  E.vesO.g.setAttribute("transform", "translate(" + E.vesO.x + " " + E.vesO.y + ") scale(" + vs.toFixed(3) + " 1)");
  E.glow.style.opacity = (0.08 + 0.5 * sm.bp).toFixed(2);
  const top = E.vesO.ports.lumen[1], bot = E.vesO.ports.out[1], lx = E.vesO.ports.lumen[0];
  rbcP.forEach((p) => { p.y += (18 + 52 * sm.bp) * dt; if (p.y > bot) { p.y = top; p.x = lx + rnd(-4, 4); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 500 + p.y) * 1.5) + ")"); });
  E.urineDots.forEach((c) => { c.style.opacity = (0.15 + 0.85 * sm.haem).toFixed(2); });
  /* dialysis filter traps waste and returns cleaned blood */
  E.filtG.style.opacity = clamp(sm.repl).toFixed(2);
  E.filtG.style.pointerEvents = sm.repl < 0.05 ? "none" : "auto";
  if (sm.repl > 0.5) {
    acc.waste += dt * 5; while (acc.waste >= 1) { acc.waste--; const p = free(wasteP); if (p) emit(p, 866 + rnd(-6, 6), 208, 26, 50); }
    acc.clean += dt * 4; while (acc.clean >= 1) { acc.clean--; const p = free(cleanP); if (p) emit(p, 892, 362, -52, -10); }
  }
  wasteP.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.st === 1) { p.x += Math.sin(tm / 240 + p.y) * 8 * dt; p.y += Math.cos(tm / 280 + p.x) * 8 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 7) kill(p); return; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y > 262 && p.x > 848) { p.st = 1; p.t = 0; p.x = rnd(858, 926); p.y = rnd(268, 352); }
    else if (p.t > 3) kill(p);
  });
  cleanP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 0.5) / 0.7).toFixed(2)); if (p.t > 1.2 || sm.repl < 0.4) kill(p); });
  if (sm.repl < 0.4) wasteP.forEach((p) => { if (p.on && p.st !== 1) kill(p); });
  setVis(rxPills.tolv, clamp(sm.tolv)); setVis(rxPills.repl, clamp(sm.repl));
  /* caption follows the state */
  const key = level + "|" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
  /* gauges */
  gg.cyst.set(sm.cyst, wordOf(sm.cyst, 0.35, 0.7, ["low", "raised", "high"]));
  gg.size.set(sm.size, wordOf(sm.size, 0.35, 0.7, ["near normal", "enlarged", "very large"]));
  gg.filt.set(sm.filt, wordOf(sm.filt, 0.35, 0.75, ["very low", "reduced", "near normal"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.6, ["controlled", "raised", "high"]));
  gg.waste.set(sm.waste, wordOf(sm.waste, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.haem.set(sm.haem, wordOf(sm.haem, 0.3, 0.6, ["none", "some", "visible"]));
}
run({ init, step });
