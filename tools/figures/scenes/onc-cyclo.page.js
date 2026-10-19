/* Cyclophosphamide scene: liver CYP activation, mustard cross-linking tumour DNA, and the harmed organs. */
const L = { liver: $("liverSlot"), tum: $("tumSlot"), org: $("orgSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const TC = [310, 285], TR = 80;
const sm = { K: 0, Cy: 0, Ms: 0, Wm: 0, F: 0, Sc: 0, on: 0, pro: 0 };
const acc = { prod: 0, must: 0, acro: 0, mes: 0, fl: 0, bl: 0, dom: 0, bleb: 0, m2: 0 };
let tumG, dauG, dnaXl = [], urineE, bloodE, kovE, ovE, adhT, marCells = [], blasts = [], fols = [], gg = {}, capEl = null, capKey = "";
let trMust, trAcro, trMar, trOv, prod, must, acro, mes, flu, blo, dom, bleb, mside, wat;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 2) return ["Mesna binds acrolein and fluids flush the bladder. Tumour kill goes on as before.", "The bladder stays guarded while mustard keeps killing tumour and marrow alike.", "Even late on, mesna and fluids keep the bladder safe. Other harms still build."][l];
  if (d === 1) return ["The liver switches the drug on. Mustard heads for tumour DNA, acrolein for the bladder.", "Mustard links tumour DNA while acrolein burns the bladder and marrow runs low.", "Late courses kill more tumour but harm builds: bladder, marrow, water, fertility."][l];
  return ["No treatment. The tumour cell copies its DNA and divides.", "No treatment. The tumour keeps dividing and nothing else changes.", "No treatment. The tumour grows on, with no benefit and no harm."][l];
}
function buildDNA(g) {
  let left = "", right = "", rungs = "";
  for (let y = -38; y <= 38; y += 4) {
    const x = 13 * Math.cos((y / 38) * Math.PI * 2);
    left += (y === -38 ? "M" : "L") + f1(x) + " " + y;
    right += (y === -38 ? "M" : "L") + f1(-x) + " " + y;
    if (((y + 38) / 4) % 3 === 0) rungs += "M" + f1(x) + " " + y + "L" + f1(-x) + " " + y;
  }
  mk("path", { class: "oc-rung", d: rungs }, g);
  mk("path", { class: "oc-dna", d: left }, g);
  mk("path", { class: "oc-dna", d: right }, g);
  for (let i = 0; i < 8; i++) { const y = -32 + i * 9; dnaXl.push(mk("path", { class: "oc-xl", d: "M-14 " + y + "L14 " + y, opacity: "0" }, g)); }
}
const DROP = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
function init() {
  organ(L.liver, "liver", 110, 170, 135, {});
  tumG = cell(L.tum, { cls: "tum", r: TR, nuc: 0.58, seed: 3, wob: 0.08, x: TC[0], y: TC[1] });
  buildDNA(tumG);
  dauG = cell(L.tum, { cls: "tum", r: 30, nuc: 0.5, seed: 5, wob: 0.1, x: 415, y: 352 });
  /* bladder with urine that turns bloody */
  organ(L.org, "bladder", 585, 185, 90, {});
  urineE = mk("ellipse", { class: "oc-urine", cx: 585, cy: 197, rx: 24, ry: 40 }, L.org);
  bloodE = mk("ellipse", { class: "oc-bloodpool", cx: 585, cy: 197, rx: 24, ry: 40, opacity: "0" }, L.org);
  /* marrow bone with blood cells that run low and late blasts */
  const bg = mk("g", {}, L.org);
  mk("rect", { class: "oc-bone", x: 730, y: 132, width: 130, height: 96, rx: 20 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 730, cy: 180, rx: 17, ry: 52 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 860, cy: 180, rx: 17, ry: 52 }, bg);
  mk("rect", { class: "oc-cav", x: 750, y: 154, width: 90, height: 52, rx: 14 }, bg);
  const mpos = [[762, 168, "rbc"], [784, 162, "neut"], [806, 167, "plt"], [828, 163, "rbc"], [770, 191, "neut"], [794, 196, "rbc"], [816, 191, "plt"], [834, 195, "neut"]];
  mpos.forEach(([x, y, cls], i) => marCells.push({ g: cell(bg, { cls, r: 7.5, nuc: cls === "plt" ? 0 : 0.4, seed: i + 11, wob: 0.12, x, y }), x, y }));
  [[776, 178], [800, 172], [790, 190], [814, 183]].forEach(([x, y], i) => { const g = cell(bg, { cls: "blast", r: 8, nuc: 0.55, seed: i + 31, wob: 0.1, x, y }); g.style.opacity = 0; blasts.push({ g, x, y }); });
  /* kidney that holds water, and the gonad */
  organ(L.org, "kidney", 585, 345, 85, {});
  kovE = mk("ellipse", { class: "oc-kov", cx: 585, cy: 345, rx: 32, ry: 40, opacity: "0" }, L.org);
  adhT = mk("text", { class: "sc-lab", x: 634, y: 336, opacity: "0.12" }, L.org); adhT.textContent = "ADH holds water";
  organ(L.org, "ovary", 795, 345, 105, {});
  [[-28, -8], [-10, -18], [12, -12], [28, 2], [5, 12], [-18, 10]].forEach(([u, v]) => fols.push(mk("circle", { class: "sc-p p-fol", cx: 795 + u, cy: 345 + v, r: 3.5 }, L.org)));
  ovE = mk("ellipse", { class: "oc-ov", cx: 795, cy: 345, rx: 46, ry: 30, opacity: "0" }, L.org);
  /* tracks and particle pools */
  trMust = track([[178, 196], [235, 228], [285, 262], [306, 282]]);
  trAcro = track([[172, 214], [230, 165], [330, 138], [470, 140], [525, 160], [558, 178]]);
  trMar = track([[645, 262], [720, 248], [795, 200]]);
  trOv = track([[645, 300], [720, 318], [782, 338]]);
  prod = pool(8, () => mk("ellipse", { class: "sc-p p-prod", rx: 5, ry: 3 }, L.parts));
  must = pool(14, () => mk("circle", { class: "sc-p p-must", r: 3 }, L.parts));
  acro = pool(16, () => mk("path", { class: "sc-p p-acro", d: "M0 -3.4L3 2.6L-3 2.6Z" }, L.parts));
  mes = pool(10, () => mk("circle", { class: "p-mesna", r: 4.5 }, L.parts));
  flu = pool(10, () => mk("path", { class: "p-flush", d: DROP }, L.parts));
  blo = pool(12, () => mk("path", { class: "p-blood", d: "M0 -3C1.8 -.5 2.4 .6 2.4 1.5A2.4 2.4 0 0 1 -2.4 1.5C-2.4 .6 -1.8 -.5 0 -3Z" }, L.parts));
  dom = pool(10, () => mk("circle", { class: "sc-p p-acro", r: 2.2 }, L.parts));
  bleb = pool(12, () => mk("circle", { class: "sc-p p-bleb", r: 3.4 }, L.parts));
  mside = pool(12, () => mk("circle", { class: "sc-p p-must", r: 2.6 }, L.parts));
  wat = pool(10, () => mk("path", { class: "p-flush", d: DROP }, L.parts));
  wat.forEach((p, i) => { emit(p, rnd(566, 604), 410, 0, 0, 0); p.t = i / 10; });
  /* labels, caption, gauges */
  const ox = L.over;
  pill(ox, "Liver CYP", 110, 148, 110, 92, "Liver CYP enzymes switch the prodrug on, splitting it into active mustard and toxic acrolein.");
  pill(ox, "Mustard", 255, 240, 185, 285, "Phosphoramide mustard: the active split product. It locks the two strands of DNA together.");
  pill(ox, "Acrolein", 350, 134, 350, 96, "Acrolein: the other split product. It leaves in urine and burns the bladder wall.");
  pill(ox, "Tumour DNA", 310, 285, 310, 404, "Mustard cross-links tumour DNA so the cell cannot copy it and dies.");
  pill(ox, "Bladder", 585, 158, 585, 92, "Acrolein in stored urine injures the bladder lining so it bleeds. Mesna and fluids prevent this.");
  pill(ox, "Marrow", 795, 152, 795, 92, "Mustard kills fast-dividing marrow cells, so red cells, white cells and platelets all fall.");
  pill(ox, "Kidney holds water", 560, 370, 488, 416, "Extra ADH effect makes the kidney keep water, diluting the blood sodium: SIADH.");
  pill(ox, "Gonad", 795, 335, 888, 290, "Mustard harms egg and sperm makers in ovaries and testes, which can cause lasting infertility.");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 443 }, ox); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 470 }, P); t.textContent = "Benefit and harm together";
  [["kill", "Tumour kill", "g-good", "How much tumour the mustard kills. Rises with each course."], ["cys", "Cystitis", "g-bad", "Acrolein burns the bladder lining so it bleeds. Mesna and fluids keep this low."], ["mar", "Marrow low", "g-neu", "Marrow cells divide fast, so mustard kills them and blood counts fall."], ["sia", "Holds water", "g-fl", "Extra ADH effect makes the kidney keep water, diluting blood sodium."], ["inf", "Infertility", "g-cyt", "Mustard harms egg and sperm makers, risking lasting infertility."], ["sec", "Second cancer", "g-eos", "Mustard can mutate healthy DNA, rarely seeding a new cancer years later."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, 478, 70, 18, cls, name, tip); });
}
function step(dt, m) {
  const k2 = Math.min(1, dt * 1.2);
  sm.K = lerp(sm.K, m.K, k2); sm.Cy = lerp(sm.Cy, m.Cy, k2); sm.Ms = lerp(sm.Ms, m.Ms, k2); sm.Wm = lerp(sm.Wm, m.Wm, k2); sm.F = lerp(sm.F, m.F, k2); sm.Sc = lerp(sm.Sc, m.Sc, k2); sm.on = lerp(sm.on, m.on, k2); sm.pro = lerp(sm.pro, m.pro, k2);
  /* prodrug capsules drift into the liver */
  acc.prod += dt * sm.on * 3;
  while (acc.prod >= 1) { acc.prod--; const p = free(prod); if (p) { const sx = 16, sy = rnd(245, 285), dx = 52 - sx, dy = 198 - sy, d = Math.hypot(dx, dy); emit(p, sx, sy, dx / d * 46, dy / d * 46, 0); } }
  prod.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.x * 4) + ")"); if (Math.hypot(52 - p.x, 198 - p.y) < 9) kill(p); });
  /* mustard runs to the tumour nucleus */
  acc.must += dt * sm.on * 5;
  while (acc.must >= 1) { acc.must--; const p = free(must); if (p) emit(p, 0, 0, 0, 0, 0); }
  must.forEach((p) => { if (!p.on) return; p.u += dt * 0.45; if (p.u >= 1) { kill(p); return; } const q = trMust.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* acrolein runs to the bladder unless mesna catches it */
  acc.acro += dt * sm.on * 4.5;
  while (acc.acro >= 1) { acc.acro--; const p = free(acro); if (p) emit(p, 0, 0, 0, 0, 0); }
  acro.forEach((p) => { if (!p.on) return; p.u += dt * 0.3; const q = trAcro.at(Math.min(p.u, 1)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 6 + p.u * 40) + ")"); if ((sm.pro > 0.5 && q.x > 445) || p.u >= 1) kill(p); });
  /* mesna rings guard the acrolein path */
  acc.mes += dt * sm.pro * 3.5;
  while (acc.mes >= 1) { acc.mes--; const p = free(mes); if (p) emit(p, 448 + rnd(-4, 4), 140 + rnd(-5, 5), rnd(20, 30), rnd(4, 10), 0); }
  mes.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.x - 448) / 90).toFixed(2)); if (p.x > 538) kill(p); });
  /* bladder: blood drips with cystitis, fast flush with protection */
  acc.bl += dt * sm.Cy * 7;
  while (acc.bl >= 1) { acc.bl--; const p = free(blo); if (p) emit(p, rnd(562, 608), rnd(158, 175), 0, rnd(22, 34), 0); }
  blo.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 236) kill(p); });
  bloodE.setAttribute("opacity", sm.Cy.toFixed(2));
  acc.fl += dt * sm.pro * 6;
  while (acc.fl >= 1) { acc.fl--; const p = free(flu); if (p) emit(p, rnd(562, 608), 148, 0, rnd(70, 95), 0); }
  flu.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 244) kill(p); });
  /* acrolein sparkle at the bladder dome */
  acc.dom += dt * sm.on * (0.5 + sm.Cy * 5);
  while (acc.dom >= 1) { acc.dom--; const p = free(dom); if (p) emit(p, 585 + rnd(-22, 22), 152 + rnd(-6, 10), 0, 0, 0); }
  dom.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.6).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); });
  /* side mustard reaches marrow and gonad, where mesna cannot guard */
  acc.m2 += dt * sm.on * 4;
  while (acc.m2 >= 1) { acc.m2--; const p = free(mside); if (p) emit(p, 0, 0, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  mside.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; const tr = p.k ? trOv : trMar; if (p.u >= 1) { kill(p); return; } const q = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* marrow cells run low, mutant blasts creep in late */
  const keep = (1 - 0.85 * sm.Ms) * marCells.length;
  marCells.forEach((c, i) => { const s = clamp(keep - i); place(c.g, c.x, c.y, 0, Math.max(s, 0.001)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  const bs = clamp((sm.Sc - 0.08) * 2.5);
  blasts.forEach((c) => { place(c.g, c.x, c.y, 0, Math.max(bs, 0.001)); c.g.style.opacity = bs > 0.05 ? 1 : 0; });
  /* kidney holds water: drops stop leaving and turn back */
  kovE.setAttribute("opacity", (sm.Wm * 0.45).toFixed(2));
  adhT.setAttribute("opacity", (0.12 + 0.88 * clamp((sm.Wm - 0.15) * 2)).toFixed(2));
  wat.forEach((p) => { p.t += dt * 0.45; if (p.t > 1) { p.t = 0; p.x = rnd(566, 604); } const y = lerp(396 + p.t * 34, 430 - p.t * 34, sm.Wm); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* gonad follicles fade */
  fols.forEach((e) => e.setAttribute("opacity", (1 - 0.9 * sm.F).toFixed(2)));
  ovE.setAttribute("opacity", (sm.F * 0.5).toFixed(2));
  /* tumour: cross-links grow, blebs fly off, the daughter cell stalls */
  dnaXl.forEach((e, i) => e.setAttribute("opacity", clamp((sm.K - i * 0.07) * 2.2).toFixed(2)));
  const tsc = 1 - 0.22 * sm.K;
  place(tumG, TC[0], TC[1], Math.sin(tm / 300) * 4 * sm.K, tsc);
  acc.bleb += dt * sm.K * 5;
  while (acc.bleb >= 1) { acc.bleb--; const p = free(bleb); if (p) { const a = rnd(0, 6.28); emit(p, TC[0] + Math.cos(a) * TR * tsc, TC[1] + Math.sin(a) * TR * tsc, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  bleb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  const dg = (1 - sm.K) * (1 + 0.05 * Math.sin(tm / 500));
  place(dauG, 415, 352, 0, Math.max(dg, 0.001)); dauG.style.opacity = dg > 0.05 ? 1 : 0;
  /* caption and gauges */
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "medium", "high"]));
  gg.cys.set(sm.Cy, wordOf(sm.Cy, 0.2, 0.55, ["ok", "sore", "bleeding"]));
  gg.mar.set(sm.Ms, wordOf(sm.Ms, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.sia.set(sm.Wm, wordOf(sm.Wm, 0.25, 0.5, ["ok", "some", "much"]));
  gg.inf.set(sm.F, wordOf(sm.F, 0.35, 0.7, ["ok", "at risk", "high risk"]));
  gg.sec.set(sm.Sc, wordOf(sm.Sc, 0.1, 0.35, ["very low", "low", "higher"]));
}
run({ init, step });
