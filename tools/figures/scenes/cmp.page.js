/* Cardiomyopathies scene: a left heart that dilates, hypertrophies or stiffens, with causes, consequences and gauges. */
const HX = 480, HY = 252;
const L = { causes: $("causes"), heart: $("heart"), cons: $("cons"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { Dil: 0.92, Wall: 0.18, Stiff: 0.30, Dia: 0.45, Sys: 0.88, Out: 0.05, Fill: 0.55, Ej: 0.12, hf: 0, bb: 0, cause: 0, P0: 1, P1: 0, P2: 0 };
let myo, cav, la, aorta, sept, amyRing = [], gg = {};
const causeNodes = [], consNodes = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const inflow = pool(18, () => mk("circle", { class: "sc-p p-in", r: 2.6 }, L.parts));
const outflow = pool(18, () => mk("circle", { class: "sc-p p-out", r: 2.6 }, L.parts));
const amy = pool(12, () => mk("rect", { class: "sc-p p-amy", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const acc = { inn: 0, out: 0, amy: 0 };

function causeNode(x, y, kind) {
  const g = mk("g", {}, L.causes);
  mk("circle", { class: "cmp-node", cx: x, cy: y, r: 24 }, g);
  if (kind === 0) { mk("rect", { class: "cmp-icon", x: x - 6, y: y - 12, width: 12, height: 22, rx: 3 }, g); mk("rect", { class: "cmp-icon", x: x - 2.5, y: y - 17, width: 5, height: 6, rx: 1 }, g); }
  else if (kind === 1) { mk("circle", { class: "cmp-icon2", cx: x, cy: y, r: 9 }, g); for (let i = 0; i < 6; i++) { const a = i * 1.047; mk("path", { class: "cmp-fib", d: "M" + f1(x + Math.cos(a) * 9) + " " + f1(y + Math.sin(a) * 9) + "L" + f1(x + Math.cos(a) * 14) + " " + f1(y + Math.sin(a) * 14) }, g); } }
  else if (kind === 2) { mk("path", { class: "cmp-fib", d: "M" + (x - 8) + " " + (y - 12) + "C" + (x + 8) + " " + (y - 4) + " " + (x - 8) + " " + (y + 4) + " " + (x + 8) + " " + (y + 12) }, g); mk("path", { class: "cmp-fib", d: "M" + (x + 8) + " " + (y - 12) + "C" + (x - 8) + " " + (y - 4) + " " + (x + 8) + " " + (y + 4) + " " + (x - 8) + " " + (y + 12) }, g); }
  else { for (let i = -1; i <= 1; i++) mk("path", { class: "cmp-fib", d: "M" + (x - 12) + " " + (y + i * 7) + "q6 -5 12 0t12 0" }, g); }
  causeNodes.push({ g, kind });
  return g;
}
function consNode(x, y, kind) {
  const g = mk("g", {}, L.cons);
  mk("circle", { class: "cmp-node", cx: x, cy: y, r: 24 }, g);
  if (kind === 0) { mk("ellipse", { class: "cmp-icon2", cx: x, cy: y, rx: 11, ry: 8 }, g); }
  else if (kind === 1) { mk("rect", { class: "cmp-icon2", x: x - 13, y: y - 4, width: 26, height: 8, rx: 3 }, g); }
  else if (kind === 2) { mk("path", { class: "cmp-icon3", d: "M" + x + " " + (y - 12) + "C" + (x + 7) + " " + (y - 2) + " " + (x + 8) + " " + (y + 2) + " " + (x + 8) + " " + (y + 5) + "A8 8 0 0 1 " + (x - 8) + " " + (y + 5) + "C" + (x - 8) + " " + (y + 2) + " " + (x - 7) + " " + (y - 2) + " " + x + " " + (y - 12) + "Z" }, g); }
  else { mk("path", { class: "cmp-icon", d: "M" + (x + 3) + " " + (y - 14) + "L" + (x - 7) + " " + (y + 2) + "L" + (x - 1) + " " + (y + 2) + "L" + (x - 3) + " " + (y + 14) + "L" + (x + 8) + " " + (y - 3) + "L" + (x + 1) + " " + (y - 3) + "Z" }, g); }
  consNodes.push({ g, kind });
  return g;
}

function init() {
  aorta = mk("rect", { class: "cmp-aorta", x: 532, y: 74, width: 28, height: 104, rx: 12 }, L.heart);
  la = mk("ellipse", { class: "cmp-la", cx: 432, cy: 152, rx: 42, ry: 30 }, L.heart);
  myo = mk("circle", { class: "cmp-myo", cx: HX, cy: HY, r: 90 }, L.heart);
  cav = mk("circle", { class: "cmp-cav", cx: HX, cy: HY, r: 60 }, L.heart);
  sept = mk("ellipse", { class: "cmp-sept", cx: HX + 34, cy: HY - 16, rx: 14, ry: 34 }, L.heart);
  for (let i = 0; i < 14; i++) { const d = mk("rect", { class: "sc-p p-amy", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1, opacity: "0" }, L.heart); amyRing.push({ e: d, a: (i / 14) * 6.283 }); }
  causeNode(110, 120, 0); causeNode(110, 185, 1); causeNode(110, 250, 2); causeNode(110, 315, 3);
  consNode(850, 120, 0); consNode(850, 185, 1); consNode(850, 250, 2); consNode(850, 315, 3);
  const o = L.over;
  pill(o, "Alcohol", 110, 120, 110, 82, "Alcohol: long term heavy alcohol use can injure heart muscle and dilate the ventricle. Stopping alcohol is treating the cause.");
  pill(o, "Myocarditis", 110, 185, 110, 147, "Myocarditis: inflammation of heart muscle, often viral, including COVID-19, and sometimes immune, for example after immune checkpoint therapy or in systemic inflammatory disease. It can scar and dilate the ventricle.");
  pill(o, "Genetic", 110, 250, 110, 212, "Genetic disease: inherited variants in cardiac muscle proteins cause dilated disease in some families and hypertrophic disease in others. Family screening matters.");
  pill(o, "Amyloid", 110, 315, 110, 277, "Amyloid: misfolded protein deposited in the heart wall. The wall becomes stiff and restrictive, so filling fails. Treating the amyloid cause helps.");
  pill(o, "Left atrium", 432, 140, 330, 90, "Left atrium: it fills the ventricle. When filling is poor it enlarges and pressure backs up toward the lungs.");
  pill(o, "Outflow tract", 546, 128, 695, 88, "Outflow tract: the exit from the left ventricle to the aorta. A thick septum narrows it and can block ejection, especially on exertion.");
  pill(o, "Septum", 518, 214, 635, 150, "Septum: the wall between the ventricles. In hypertrophic disease it thickens most, bulges into the outflow tract and obstructs flow.");
  pill(o, "Left ventricle", HX, 272, HX, 378, "Left ventricle: the main pumping chamber. Dilated it is large and weak, hypertrophic it is thick and stiff, restrictive it is stiff with poor filling.");
  pill(o, "Weak squeeze", 850, 120, 850, 82, "Systolic failure: the ventricle cannot squeeze blood out. This dominates in dilated disease and causes breathlessness and fluid retention.");
  pill(o, "Blocked outflow", 850, 185, 850, 147, "Outflow obstruction: the thick septum and mitral leaflet block the exit in hypertrophic disease. A beta-blocker or myectomy relieves it.");
  pill(o, "Poor filling", 850, 250, 850, 212, "Diastolic dysfunction: a thick or stiff ventricle cannot relax and fill. Pressure rises even when squeezing looks preserved.");
  pill(o, "Sudden death", 850, 315, 850, 277, "Sudden death risk: hypertrophic muscle is prone to dangerous rhythms, especially in the young and on exertion. Risk assessment guides device decisions, not shown here.");
  const phf = pill(o, "HF therapy", HX, 292, 275, 408, "Heart failure therapy: medicines that unload the heart and block harmful neurohormonal signals. They help most when squeezing is weak."); phf.setAttribute("id", "p-hf"); phf.style.opacity = 0;
  const pbb = pill(o, "Beta-blocker", 546, 128, 680, 408, "A beta-blocker slows and softens contraction so the outflow tract opens. Septal myectomy surgically thins the septum when obstruction persists."); pbb.setAttribute("id", "p-bb"); pbb.style.opacity = 0;
  const pca = pill(o, "Treat cause", 110, 315, 110, 408, "Treat the cause: stop alcohol, treat myocarditis and systemic disease, or treat amyloid. This acts upstream of the ventricle."); pca.setAttribute("id", "p-cause"); pca.style.opacity = 0;
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The ventricle";
  [["dil", "Dilatation", "g-dil", "How stretched and enlarged the ventricle cavity is. High in dilated disease."], ["wall", "Wall", "g-wall", "Wall thickness. Thin in dilated disease, thick in hypertrophic disease."], ["stiff", "Stiffness", "g-stiff", "How stiff and non compliant the wall is. Highest in restrictive disease from amyloid and scarring."], ["fill", "Filling", "g-fill", "Diastolic filling of the ventricle. Poor when the wall is thick or stiff."], ["ej", "Ejection", "g-ej", "Systolic ejection, how well the ventricle squeezes blood out. Poor in dilated disease."], ["out", "Outflow block", "g-out", "Blockage of the outflow tract by the thick septum. A feature of hypertrophic disease."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Dil", "Wall", "Stiff", "Dia", "Sys", "Out", "Fill", "Ej", "hf", "bb", "cause", "P0", "P1", "P2"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "Fill" || q === "Ej" ? k2 : k1); });
  const thick = 10 + sm.Wall * 26 - sm.Dil * 4;
  let cavR = 28 + sm.Dil * 46 - sm.Wall * 11 - sm.Stiff * 5;
  const beatPh = (tm / 1050) % 1, contract = beatPh < 0.36 ? Math.sin(Math.PI * beatPh / 0.36) : 0;
  cavR = cavR * (1 - 0.15 * sm.Ej * contract);
  const outR = cavR + thick;
  myo.setAttribute("r", f1(outR)); cav.setAttribute("r", f1(Math.max(14, cavR)));
  la.setAttribute("rx", f1(36 + (1 - sm.Fill) * 24)); la.setAttribute("ry", f1(26 + (1 - sm.Fill) * 15));
  const aw = 28 - sm.Out * 14;
  aorta.setAttribute("width", f1(aw)); aorta.setAttribute("x", f1(546 - aw / 2));
  sept.setAttribute("cx", f1(HX + cavR * 0.60)); sept.setAttribute("cy", f1(HY - cavR * 0.28));
  sept.setAttribute("rx", f1(7 + sm.Wall * 15 + sm.Out * 9)); sept.setAttribute("ry", f1(Math.max(16, cavR * 0.52)));
  sept.setAttribute("opacity", (0.25 + 0.55 * sm.Wall).toFixed(2));
  amyRing.forEach((d) => { const rr = cavR + thick * 0.5; d.e.setAttribute("transform", "translate(" + f1(HX + rr * Math.cos(d.a)) + " " + f1(HY + rr * Math.sin(d.a)) + ") rotate(" + f1(d.a * 57.3) + ")"); d.e.setAttribute("opacity", (sm.P2 * sm.Stiff * 0.95).toFixed(2)); });
  const cAct = [sm.P0, sm.P0, Math.max(sm.P0, sm.P1), sm.P2];
  causeNodes.forEach((n, i) => { n.g.style.opacity = (0.32 + 0.68 * cAct[i]).toFixed(2); });
  const sAct = [sm.Sys, sm.Out, sm.Dia, sm.P1 * (0.35 + 0.65 * sm.Out)];
  consNodes.forEach((n, i) => { n.g.style.opacity = (0.32 + 0.68 * clamp(sAct[i])).toFixed(2); });
  $("p-hf").style.opacity = sm.hf.toFixed(2); $("p-bb").style.opacity = sm.bb.toFixed(2); $("p-cause").style.opacity = sm.cause.toFixed(2);
  acc.inn += dt * sm.Fill * 6; while (acc.inn >= 1) { acc.inn--; const p = free(inflow); if (p) emit(p, 424 + rnd(-10, 18), 168, rnd(-3, 3), rnd(30, 46), 0); }
  inflow.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > HY + 18 || p.t > 3) kill(p); });
  acc.out += dt * sm.Ej * (1 - sm.Out * 0.82) * 6; while (acc.out >= 1) { acc.out--; const p = free(outflow); if (p) emit(p, 546 + rnd(-5, 5), 168, rnd(-2, 2), -rnd(42, 60), 0); }
  outflow.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 80 || p.t > 3) kill(p); });
  acc.amy += dt * sm.P2 * sm.Stiff * 4; while (acc.amy >= 1) { acc.amy--; const p = free(amy); if (p) { const a = rnd(0, 6.28), rr = cavR + thick * 0.5; emit(p, HX + rr * Math.cos(a), HY + rr * Math.sin(a), rnd(-4, 4), rnd(-4, 4), 0); } }
  amy.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2) kill(p); });
  gg.dil.set(sm.Dil, wordOf(sm.Dil, 0.35, 0.65, ["small", "normal", "dilated"]));
  gg.wall.set(sm.Wall, wordOf(sm.Wall, 0.35, 0.65, ["thin", "normal", "thick"]));
  gg.stiff.set(sm.Stiff, wordOf(sm.Stiff, 0.3, 0.6, ["soft", "firm", "stiff"]));
  gg.fill.set(sm.Fill, wordOf(sm.Fill, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.ej.set(sm.Ej, wordOf(sm.Ej, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.out.set(sm.Out, wordOf(sm.Out, 0.25, 0.6, ["open", "narrowed", "blocked"]));
}
run({ init, step });
