/* Glomerulonephritis scene: deposits, complement, neutrophils, crescents, podocytes, leak into the tubule, body effects and gauges. */
const CX = SC.CX, CY = SC.CY, WW = SC.W;
const layers = { vess: $("vess"), caps: $("caps"), tuft: $("tuft"), deps: $("deps"), cells: $("cells"), parts: $("parts"), urine: $("urine"), boxes: $("boxes"), over: $("over"), panel: $("panel") };
/* ---- static vessels, capsule, tubule and boxes ---- */
let fluidRect = null, dropEl = null, bpArrow = null;
function initStatic() {
  mk("path", { class: "gn-vess", d: "M14 " + CY + "L206 " + CY, "stroke-width": 40 }, layers.vess);
  mk("path", { class: "gn-vessin", d: "M14 " + CY + "L206 " + CY, "stroke-width": 30 }, layers.vess);
  mk("path", { class: "gn-vess", d: "M428 208L512 158", "stroke-width": 24 }, layers.vess);
  mk("path", { class: "gn-vessin", d: "M428 208L512 158", "stroke-width": 16 }, layers.vess);
  mk("circle", { class: "gn-caps", cx: CX, cy: CY, r: 122 }, layers.caps);
  mk("circle", { class: "gn-space", cx: CX, cy: CY, r: 112 }, layers.caps);
  mk("path", { class: "gn-tubew", d: "M438 262C520 262 545 214 615 226C690 239 715 282 790 256L878 256", "stroke-width": 34 }, layers.urine);
  mk("path", { class: "gn-tubel", d: "M438 262C520 262 545 214 615 226C690 239 715 282 790 256L878 256", "stroke-width": 24 }, layers.urine);
  mk("path", { class: "gn-cup", d: "M852 282L906 282L898 330L860 330Z" }, layers.urine);
  mk("rect", { class: "gn-urinefill", x: 860, y: 306, width: 38, height: 18, rx: 4 }, layers.urine);
  mk("rect", { class: "gn-box", x: 545, y: 318, width: 150, height: 78, rx: 10 }, layers.boxes);
  mk("rect", { class: "gn-box", x: 725, y: 318, width: 180, height: 78, rx: 10 }, layers.boxes);
  fluidRect = mk("rect", { class: "gn-fluid", x: 733, y: 366, width: 164, height: 22, rx: 6 }, layers.boxes);
  dropEl = mk("path", { class: "gn-drop", d: "M620 330C626 340 629 345 629 350A9 9 0 0 1 611 350C611 345 614 340 620 330Z" }, layers.boxes);
  bpArrow = mk("path", { class: "gn-arrow", d: "M815 386L815 344M806 354L815 342L824 354" }, layers.boxes);
}
/* ---- capillary coils, GBM, deposits, crescent ---- */
const coils = [[272, 192, 44, 27], [368, 192, 44, 27], [272, 286, 44, 27], [368, 286, 44, 27], [320, 239, 50, 31]];
let icG = null, igaG = null, gbmG = null, cresG = null;
function initTuft() {
  coils.forEach(([x, y, rx, ry]) => { mk("ellipse", { class: "gn-coil", cx: x, cy: y, rx, ry }, layers.tuft); mk("ellipse", { class: "gn-gbm", cx: x, cy: y, rx, ry }, layers.tuft); });
  icG = mk("g", {}, layers.deps); igaG = mk("g", {}, layers.deps); gbmG = mk("g", {}, layers.deps);
  [[238, 172], [272, 156], [320, 150], [368, 156], [402, 172], [238, 306], [402, 306], [320, 322]].forEach(([x, y]) => mk("circle", { class: "gn-depdot", cx: x, cy: y, r: 6 }, icG));
  for (let i = 0; i < 11; i++) { const a = i * 2.4, r = 8 + (i % 4) * 8; mk("circle", { class: "gn-igadot", cx: f1(CX + Math.cos(a) * r), cy: f1(CY + Math.sin(a) * r * 0.8), r: 4.6 }, igaG); }
  coils.slice(0, 4).forEach(([x, y, rx, ry]) => mk("ellipse", { class: "gn-gbmline", cx: x, cy: y, rx: rx + 3, ry: ry + 3 }, gbmG));
  for (let i = 0; i < 6; i++) mk("path", { class: "gn-fibrin", d: "M" + (255 + i * 22) + " 150L" + (268 + i * 20) + " 178" }, gbmG);
  cresG = mk("g", {}, layers.deps);
  mk("path", { class: "gn-cres", d: "M232 178A108 108 0 0 1 408 178A84 84 0 0 0 232 178Z" }, cresG);
}
/* ---- cells ---- */
const mes = [[296, 224], [344, 224], [320, 258]].map(([x, y], i) => { const g = cell(layers.cells, { cls: "mes", r: 17, nuc: 0.42, seed: i * 2 + 1, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y }; });
const pods = [[232, 164], [320, 152], [408, 164], [408, 312], [320, 326], [232, 312]].map(([x, y], i) => { const g = cell(layers.cells, { cls: "pod", r: 13, nuc: 0.4, seed: i + 7, wob: 0.14 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
const pars = [];
function initPars() { for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283 + 0.3, x = CX + Math.cos(a) * 112, y = CY + Math.sin(a) * 112; const g = cell(layers.cells, { cls: "par", r: 9, nuc: 0.38, seed: i + 30, wob: 0.1 }); place(g, x, y, 0, 1); pars.push({ g, x, y }); } }
const neus = Array.from({ length: 5 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }), st: 0, x: -30, y: CY, t: 0, tx: 0, ty: 0, i }));
const rbcs = [];
function initRbcs() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vess); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, 200), y: rnd(-9, 9), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const comp = pool(30, () => mk("circle", { class: "sc-p p-comp", r: 2.6 }, layers.parts));
const prot = pool(34, () => mk("rect", { class: "sc-p p-prot", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
const leak = pool(16, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return g; });
const filt = pool(18, () => mk("path", { class: "gn-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The kidney and the body";
  [["inj", "Injury", "g-bad", "How inflamed and damaged the glomerular capillary wall is."], ["comp", "Complement", "g-comp", "Complement activated by deposits or antibody. It recruits neutrophils and injures the wall."], ["neut", "Neutrophils", "g-neu", "Neutrophils drawn into the tuft by complement. They release enzymes that damage the filter."], ["prot", "Protein leak", "g-prot", "Protein escaping through the damaged wall or a failed podocyte into the urine."], ["haem", "Blood in urine", "g-bad", "Red cells escaping through the damaged wall. A hallmark of nephritic injury."], ["gfr", "Filtration", "g-good", "How well the glomerulus filters. It falls as injury and crescents block the filter."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Immune deposits", 262, 156, 135, 92, "Immune complexes trapped in the capillary wall, as in post-infectious disease. They activate complement.");
  pill(ox, "Complement", 352, 162, 285, 92, "Complement activated on the deposit or antibody. Its fragments recruit neutrophils and punch holes in cells.");
  pill(ox, "IgA in mesangium", CX, CY, 415, 92, "IgA deposits in the mesangium, the central stalk of the tuft, in IgA nephropathy. Injury is slower and episodes of blood are common.");
  pill(ox, "GBM injury", 398, 168, 545, 92, "Antibody binding along the glomerular basement membrane in anti-GBM disease, or pauci-immune injury with few deposits. Both can destroy the tuft fast.");
  pill(ox, "Crescent", 352, 138, 675, 92, "A crescent of proliferating cells and fibrin filling Bowman space. It crushes the tuft and filtration falls rapidly.");
  pill(ox, "Neutrophil", 282, 272, 135, 180, "Neutrophils recruited by complement crowd into the capillaries and damage the wall.");
  pill(ox, "Podocyte", 404, 178, 555, 165, "Podocyte: the cell wrapping the capillary with foot processes and a slit diaphragm. When it fails, protein leaks heavily and the picture is nephrotic, not nephritic.");
  pill(ox, "Bowman capsule", 232, 322, 135, 390, "Bowman capsule: the cup around the tuft. Filtrate, and in disease red cells and protein, collect in its space and enter the tubule.");
  pill(ox, "Protein leak", 640, 238, 690, 155, "Protein that has crossed the damaged filter flowing down the tubule. Heavy in podocyte disease.");
  pill(ox, "Blood in urine", 790, 252, 835, 155, "Red cells in the tubule and urine (haematuria), often with casts. Blood with little protein suggests nephritic injury.");
  pill(ox, "Filtration falls", 620, 344, 620, 300, "Filtration falls as inflamed and crescent-blocked glomeruli stop filtering. Waste and salt and water build up.");
  pill(ox, "Fluid and pressure", 800, 362, 815, 300, "Salt and water are retained as filtration falls, causing oedema and raising blood pressure. The arrow rises with pressure.");
}
const sm = { Dep: 0.5, Comp: 0.4, Neut: 0.4, Inj: 0.4, Cres: 0.1, Pod: 0.3, Prot: 0.3, Haem: 0.3, GFR: 0.7, BP: 0.4, Oed: 0.3 };
const acc = { comp: 0, prot: 0, leak: 0, filt: 0 };
function init() { initStatic(); initTuft(); initPars(); initRbcs(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  ["Dep", "Comp", "Neut", "Inj", "Cres", "Pod", "Prot", "Haem", "GFR", "BP", "Oed"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k2); });
  /* deposit patterns by level */
  icG.style.opacity = (level === 0 ? clamp(sm.Dep * 1.3) : 0.06).toFixed(2);
  igaG.style.opacity = (level === 1 ? clamp(sm.Dep * 1.4) : 0.06).toFixed(2);
  gbmG.style.opacity = (level === 2 ? 0.95 : 0.05).toFixed(2);
  const cs = clamp(sm.Cres * 1.15);
  cresG.setAttribute("transform", "translate(320 128) scale(" + (0.25 + 0.75 * cs).toFixed(3) + ") translate(-320 -128)");
  cresG.style.opacity = cs > 0.04 ? (0.2 + 0.8 * cs).toFixed(2) : "0";
  /* cells: mesangium swells with injury, podocytes flatten as they fail */
  mes.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1500 + i) * 2, c.y + Math.cos(tm / 1700 + i) * 2, 0, 1 + 0.22 * sm.Inj));
  pods.forEach((c) => { const flat = level === 3 ? sm.Pod : sm.Pod * 0.5; c.g.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y + Math.sin(tm / 1600 + c.i) * 1.5) + ") scale(1 " + (1 - 0.42 * flat).toFixed(3) + ")"); });
  pars.forEach((c, i) => place(c.g, c.x, c.y, 0, 1 + 0.05 * Math.sin(tm / 1400 + i)));
  /* red cells in the afferent arteriole */
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 202) r.x = 8; place(r.g, r.x, CY + r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  /* complement drifts from the deposit area into the tuft */
  acc.comp += dt * sm.Comp * 11;
  while (acc.comp >= 1) { acc.comp--; const p = free(comp); if (p) emit(p, rnd(235, 405), rnd(150, 200), rnd(-8, 8), rnd(18, 32), 0); }
  comp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 320 || p.t > 3.2) kill(p); });
  /* protein crosses the wall, collects, then flows down the tubule */
  acc.prot += dt * sm.Prot * 12;
  while (acc.prot >= 1) { acc.prot--; const p = free(prot); if (p) { const c = pick(coils); emit(p, c[0] + rnd(-30, 30), c[1] + rnd(-16, 16), rnd(10, 22), rnd(-6, 10), 0); } }
  prot.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 0) { p.x += p.vx * dt + 14 * dt; p.y += p.vy * dt; if (p.x > 432) { p.k = 1; p.y = 258; } } else { p.x += 62 * dt; p.y = 254 + Math.sin(p.x / 46) * 9; if (p.x > 878) { p.k = 2; } } if (p.k === 2) { p.y += 42 * dt; if (p.y > 322) kill(p); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.t > 9) kill(p); });
  /* red cells leak through the damaged wall into Bowman space and the tubule */
  acc.leak += dt * sm.Haem * 7;
  while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) { const c = pick(coils); emit(p, c[0] + rnd(-26, 26), c[1] + rnd(-14, 14), rnd(12, 24), rnd(-4, 10), 0); } }
  leak.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 0) { p.x += p.vx * dt + 12 * dt; p.y += p.vy * dt; if (p.x > 432) { p.k = 1; p.y = 264; } } else if (p.k === 1) { p.x += 58 * dt; p.y = 260 + Math.sin(p.x / 52 + 2) * 8; if (p.x > 878) p.k = 2; } else { p.y += 40 * dt; if (p.y > 320) kill(p); } place(p.e, p.x, p.y, Math.sin(tm / 400 + p.x) * 14, 1); if (p.t > 9) kill(p); });
  /* filtrate droplets in the tubule: fewer and slower as filtration falls */
  acc.filt += dt * (0.4 + 5 * sm.GFR);
  while (acc.filt >= 1) { acc.filt--; const p = free(filt); if (p) emit(p, 446, 262, 0, 0, 0); }
  filt.forEach((p) => { if (!p.on) return; p.x += (34 + 58 * sm.GFR) * dt; p.y = 258 + Math.sin(p.x / 48 + 1) * 9; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 880) kill(p); });
  /* neutrophils enter from the arteriole and crowd the tuft */
  const nn = Math.round(sm.Neut * neus.length);
  neus.forEach((n, i) => { const act = i < nn;
    if (n.st === 0) { if (act) { n.x = 30; n.y = CY; n.st = 1; } else { n.g.style.opacity = 0; place(n.g, -40, CY, 0, 0.1); } }
    else if (n.st === 1) { n.g.style.opacity = 1; n.x += 52 * dt; place(n.g, n.x, CY + Math.sin(tm / 300 + i) * 5, 0, 1); if (n.x > 225) { n.st = 2; n.tx = rnd(255, 385); n.ty = rnd(185, 295); } }
    else if (n.st === 2) { n.x += (n.tx - n.x) * dt * 1.1; n.y += (n.ty - n.y) * dt * 1.1; place(n.g, n.x, n.y, Math.sin(tm / 400 + i) * 10, 1); n.t += dt; if (n.t > 8 || !act) { n.t = 0; n.st = 3; } }
    else { n.g.style.opacity = clamp(parseFloat(n.g.style.opacity || 1) - dt * 0.6); if (parseFloat(n.g.style.opacity) < 0.05) n.st = 0; } });
  /* body effects: retained fluid rises, pressure arrow grows, filtrate drop slows */
  const fh = 8 + sm.Oed * 46;
  fluidRect.setAttribute("y", f1(388 - fh)); fluidRect.setAttribute("height", f1(fh));
  bpArrow.setAttribute("transform", "translate(815 386) scale(1 " + (0.45 + sm.BP * 0.75).toFixed(3) + ") translate(-815 -386)");
  dropEl.setAttribute("transform", "translate(620 " + f1(338 + Math.sin(tm / (900 - 500 * sm.GFR)) * 3) + ") scale(" + (0.6 + sm.GFR * 0.6).toFixed(3) + ") translate(-620 -344)");
  /* gauges */
  gg.inj.set(sm.Inj, wordOf(sm.Inj, 0.25, 0.6, ["low", "raised", "high"])); gg.comp.set(sm.Comp, wordOf(sm.Comp, 0.3, 0.6, ["low", "raised", "high"])); gg.neut.set(sm.Neut, wordOf(sm.Neut, 0.3, 0.6, ["few", "some", "many"]));
  gg.prot.set(sm.Prot, wordOf(sm.Prot, 0.3, 0.65, ["small", "moderate", "heavy"])); gg.haem.set(sm.Haem, wordOf(sm.Haem, 0.25, 0.6, ["absent", "present", "marked"])); gg.gfr.set(sm.GFR, wordOf(sm.GFR, 0.4, 0.68, ["low", "reduced", "preserved"]));
}
run({ init, step });
