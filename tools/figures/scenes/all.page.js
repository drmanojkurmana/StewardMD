/* Acute lymphoblastic leukaemia scene: predisposed progenitor, genetic hit, lymphoblast clone, cytopenias, sanctuary sites, mediastinal mass and gauges. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const W = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- fixed cells ---- */
const riskCells = [[110, 190], [110, 252]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "risk", r: 18, nuc: 0.42, seed: i * 3 + 1, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const progs = [[205, 300], [242, 328], [168, 328]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "prog2", r: 12, nuc: 0.4, seed: i * 2 + 5, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
function grid(n, x0, y0, dx, dy, cols) { return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * dx + ((i * 37) % 11) - 5, y: y0 + Math.floor(i / cols) * dy + ((i * 53) % 9) - 4, s: 0 })); }
const blasts = grid(28, 342, 162, 28, 38, 7).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "lyb", r: 13, nuc: 0.62, seed: i + 2, wob: 0.08 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const chrG = mk("g", {}, LY.stage);
mk("rect", { class: "all-chrA", x: 232, y: 148, width: 10, height: 42, rx: 5 }, chrG);
mk("rect", { class: "all-chrB", x: 254, y: 148, width: 10, height: 42, rx: 5 }, chrG);
mk("rect", { class: "all-fus", x: 276, y: 156, width: 10, height: 34, rx: 5 }, chrG);
mk("path", { d: "M268 168H272", stroke: "var(--anatomy-mid)", "stroke-width": 1.6 }, chrG);
const vesselRbcs = Array.from({ length: 10 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, LY.stage); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { g, x: 588 + (i % 3) * 34, y: 136 + i * 21, v: 0.8 + (i % 4) * 0.15 }; });
const vesselPlts = Array.from({ length: 6 }, (_, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "plt", r: 5, seed: i + 90, wob: 0.15, n: 7 }); return { g, x: 600 + (i % 2) * 48, y: 150 + i * 32, v: 0.6 }; });
const vesselNeus = Array.from({ length: 4 }, (_, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "neut", r: 9, nuc: 0.55, nucCls: "multi", seed: i + 70, wob: 0.12 }); return { g, x: 610 + (i % 2) * 34, y: 170 + i * 44, v: 0.5 }; });
/* sanctuary and chest shapes, each with a visible fill */
mk("ellipse", { class: "all-brain", cx: 825, cy: 146, rx: 34, ry: 15 }, LY.stage);
mk("ellipse", { class: "all-barrier", cx: 825, cy: 146, rx: 44, ry: 21 }, LY.stage);
mk("ellipse", { class: "all-testis", cx: 825, cy: 232, rx: 28, ry: 13 }, LY.stage);
mk("ellipse", { class: "all-barrier", cx: 825, cy: 232, rx: 38, ry: 19 }, LY.stage);
const massG = mk("g", {}, LY.stage); cell(massG, { cls: "sm", r: 24, nuc: 0.3, seed: 7, wob: 0.12 });
const massCap = mk("text", { class: "sc-lab", x: 825, y: 354, "text-anchor": "middle" }, LY.stage); massCap.textContent = "T lineage thymus";
const cnsBlasts = [[805, 142], [825, 150], [845, 142], [815, 138], [838, 152]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "lyb", r: 6, nuc: 0.6, seed: i + 40, wob: 0.08 }); place(g, x, y, 0, 1); return { g, x, y, s: 0 }; });
const testBlasts = [[808, 230], [825, 236], [842, 230], [818, 228]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "lyb", r: 6, nuc: 0.6, seed: i + 60, wob: 0.08 }); place(g, x, y, 0, 1); return { g, x, y, s: 0 }; });
/* particles */
const divs = mkPool(16, () => mk("circle", { class: "sc-p p-div", r: 2.2 }, LY.stage));
const chemos = mkPool(8, () => { const g = mk("g", {}, LY.stage); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const cnsDots = mkPool(10, () => mk("circle", { class: "sc-p p-cns", r: 2.6 }, LY.stage));
const tgts = mkPool(10, () => mk("circle", { class: "sc-p p-tgt", r: 2.6 }, LY.stage));
/* labels and treatment marks */
const marks = [];
function addMark(drugs, x, y, text, tx, ty, tip) { const g = mk("g", {}, LY.over); mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); pill(g, text, x, y, tx, ty, tip); marks.push({ g, drugs }); return g; }
function initLabels() {
  pill(LY.over, "At risk progenitor", 110, 172, 110, 82, "A lymphoid progenitor at risk. Germline predisposition or an early genetic change can prime it, but more hits are needed before leukaemia develops.");
  pill(LY.over, "Genetic hit", 255, 148, 262, 82, "A genetic hit: a fusion gene or other mutation that blocks lymphoid maturation and drives growth. Chromosome aberrations help classify the disease.");
  pill(LY.over, "Lymphoblast clone", 430, 150, 430, 82, "The lymphoblast clone: one B or T precursor expands as blasts with large nuclei. They replace the marrow instead of maturing into working lymphocytes.");
  pill(LY.over, "Cytopenias in blood", 625, 140, 625, 82, "Blood leaving the crowded marrow. Low red cells cause anemia, low neutrophils allow infection, and low platelets cause bruising and bleeding.");
  pill(LY.over, "CNS sanctuary", 825, 128, 825, 114, "Central nervous system sanctuary: blasts behind the blood brain barrier. Many drugs cross poorly, so seated blasts can survive and later seed relapse.");
  pill(LY.over, "Testis sanctuary", 825, 214, 825, 198, "Testis sanctuary: blasts behind the blood testis barrier, another sheltered site where blasts can persist after the marrow looks clear.");
  pill(LY.over, "Mediastinal mass", 825, 292, 825, 282, "Mediastinal mass: a thymus based lump seen mainly in T lineage disease. It can press on the airway and large veins in the chest.");
  pill(LY.over, "Normal lines squeezed", 240, 300, 430, 392, "Normal progenitors squeezed out by the clone. As they fall, red cells, neutrophils and platelets are no longer replaced.");
  addMark([1], 430, 230, "Induction clears marrow", 180, 415, "Induction chemotherapy kills dividing blasts in the marrow and aims for remission. It reaches sanctuary sites poorly, so a reservoir can remain.");
  addMark([2], 825, 146, "CNS cover clears sanctuary", 180, 415, "CNS prophylaxis directs therapy at the central nervous system reservoir, clearing sheltered blasts that marrow directed treatment can miss.");
  addMark([3], 110, 210, "Targeted or transplant reset", 180, 415, "Targeted therapy attacks a driving genetic lesion where one is present. Transplant replaces the marrow after it is cleared, in selected high risk or relapsed disease.");
}
/* gauges */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478, xs = [90, 230, 370, 510, 650, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Marrow, sanctuary and blood";
  [["clone", "Lymphoblasts", "g-bad", "How much of the marrow is taken over by lymphoblasts. High means normal production is replaced."], ["sanc", "Sanctuary cells", "g-sanc", "Blasts sheltered in the central nervous system and testis. They can survive treatment and seed relapse."], ["med", "Mediastinal mass", "g-med", "Thymus based mass in mainly T lineage disease. Larger masses can press on chest structures."], ["red", "Red cells", "g-rbc", "Red cells carry oxygen. When they fall the patient is anaemic: pale, tired and breathless."], ["neut", "Neutrophils", "g-neu", "Neutrophils fight bacterial infection. When they fall, infection becomes likely and can be severe."], ["plt", "Platelets", "g-clot", "Platelets help blood clot. When they fall, bruising and bleeding follow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { clone: 0.8, sanc: 0.6, med: 0.5, red: 0.3, neut: 0.2, plt: 0.2 };
const acc = { div: 0, chemo: 0, cns: 0, tgt: 0 };
function setFixed(pool, n, dt, bob) { pool.forEach((c, i) => { const want = i < n ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2.2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * bob, c.y + Math.cos(tm / 900 + i) * bob, Math.sin(tm / 800 + i) * 6, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; }); }
function init() { initLabels(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.clone = lerp(sm.clone, m.clone, k); sm.sanc = lerp(sm.sanc, m.sanc, k); sm.med = lerp(sm.med, m.med, k);
  sm.red = lerp(sm.red, m.red, k); sm.neut = lerp(sm.neut, m.neut, k); sm.plt = lerp(sm.plt, m.plt, k);
  riskCells.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, 1 + 0.04 * Math.sin(tm / 300 + i)));
  progs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 700 + i) * 2, Math.sin(tm / 900 + i) * 8, Math.max(0.25, 1 - 0.7 * sm.clone)));
  chrG.setAttribute("opacity", (0.35 + 0.65 * sm.clone).toFixed(2));
  setFixed(blasts, Math.round(sm.clone * 28), dt, 1.6);
  setFixed(cnsBlasts, Math.round(sm.sanc * 5), dt, 0.7);
  setFixed(testBlasts, Math.round(sm.sanc * 4), dt, 0.7);
  place(massG, 825, 318, Math.sin(tm / 900) * 4, Math.max(0.08, 0.15 + 0.85 * sm.med)); massG.style.opacity = sm.med > 0.03 ? 1 : 0;
  vesselRbcs.forEach((r, i) => { r.y += r.v * 24 * (0.3 + sm.red) * dt; if (r.y > 348) { r.y = 132; r.x = 588 + Math.floor(rnd(0, 3)) * 34; } place(r.g, r.x, r.y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = i < Math.round(sm.red * 10) ? 1 : 0; });
  vesselPlts.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 348) r.y = 136; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.plt * 6) ? 1 : 0; });
  vesselNeus.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 348) r.y = 140; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.neut * 4) ? 1 : 0; });
  acc.div += dt * sm.clone * 5; while (acc.div >= 1) { acc.div--; const p = freeP(divs); if (p) emit(p, rnd(350, 500), rnd(170, 300), rnd(-12, 12), rnd(-12, 12), 0); }
  divs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 40, 520); p.y = clamp(p.y, 106, 350); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.chemo += dt * (m.drug === 1 ? 2 : 0); while (acc.chemo >= 1) { acc.chemo--; const p = freeP(chemos); if (p) emit(p, rnd(210, 300), rnd(220, 300), 0, 0, 0); }
  chemos.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (430 - p.x) * dt * 0.6 + 12 * dt; p.y += (230 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2)); if (p.t > 4.7) kill(p); });
  acc.cns += dt * (m.drug === 2 ? 3 : 0); while (acc.cns >= 1) { acc.cns--; const p = freeP(cnsDots); if (p) emit(p, 692, 170, 0, 0, 0); }
  cnsDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (825 - p.x) * dt * 1.2; p.y += (146 - p.y) * dt * 1.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(825 - p.x, 146 - p.y) < 12 || p.t > 3) kill(p); });
  acc.tgt += dt * (m.drug === 3 ? 3 : 0); while (acc.tgt >= 1) { acc.tgt--; const p = freeP(tgts); if (p) emit(p, rnd(300, 380), rnd(260, 320), 0, 0, 0); }
  tgts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (255 - p.x) * dt * 1.1; p.y += (168 - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(255 - p.x, 168 - p.y) < 10 || p.t > 3) kill(p); });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  gg.clone.set(sm.clone, wordOf(sm.clone, 0.25, 0.6, ["cleared", "present", "high"])); gg.sanc.set(sm.sanc, wordOf(sm.sanc, 0.22, 0.55, ["cleared", "present", "seated"]));
  gg.med.set(sm.med, wordOf(sm.med, 0.2, 0.5, ["none", "small", "large"])); gg.red.set(sm.red, wordOf(sm.red, 0.35, 0.65, ["low", "reduced", "normal"]));
  gg.neut.set(sm.neut, wordOf(sm.neut, 0.35, 0.65, ["low", "reduced", "normal"])); gg.plt.set(sm.plt, wordOf(sm.plt, 0.35, 0.65, ["low", "reduced", "normal"]));
}
run({ init, step });
