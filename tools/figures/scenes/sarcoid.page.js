/* Sarcoidosis scene: antigen presentation, CD4 T cells, macrophages, a non-caseating granuloma, hilar nodes, fibrosis, organ spots, vitamin D particles and gauges. */
const WW = SC.W;
const layers = { ags: $("ags"), cells: $("cells"), gran: $("gran"), parts: $("parts"), over: $("over"), panel: $("panel"), fib: $("fibBands") };
/* ---- antigen presenting macrophage and CD4 T cells ---- */
const apcG = mk("g", {}, layers.cells);
const apc = cell(apcG, { cls: "mac", r: 26, nuc: 0.42, seed: 3, wob: 0.13 });
place(apcG, 145, 230, 0, 1);
const tcells = [[80, 335], [150, 348], [215, 325]].map(([x, y], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "lymph", r: 13, nuc: 0.5, seed: i + 7, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
/* ---- hilar lymph nodes: two clusters either side of the mediastinum ---- */
const nodeGroups = [];
[[378, 158], [502, 158]].forEach(([x, y], s) => { const g = mk("g", {}, layers.cells); [[-12, -6], [10, -8], [0, 10], [-14, 10], [14, 8]].forEach(([dx, dy], j) => { const c = cell(g, { cls: "lymph", r: 10, nuc: 0.45, seed: s * 9 + j, wob: 0.12 }); c.setAttribute("transform", "translate(" + dx + " " + dy + ")"); }); place(g, x, y, 0, 1); nodeGroups.push(g); });
/* ---- granuloma: giant cell centre, epithelioid ring, lymphocyte cuff, pale non-caseating core ---- */
const granG = mk("g", {}, layers.gran);
for (let j = 0; j < 10; j++) { const t = (j / 10) * 6.283; const c = cell(granG, { cls: "lymph", r: 7, nuc: 0.45, seed: j + 30, wob: 0.12 }); c.setAttribute("transform", "translate(" + f1(Math.cos(t) * 52) + " " + f1(Math.sin(t) * 52) + ")"); }
for (let j = 0; j < 8; j++) { const t = (j / 8) * 6.283 + 0.4; const c = cell(granG, { cls: "mac", r: 11, nuc: 0.4, seed: j + 12, wob: 0.14 }); c.setAttribute("transform", "translate(" + f1(Math.cos(t) * 33) + " " + f1(Math.sin(t) * 33) + ")"); }
const giant = cell(granG, { cls: "mac", r: 20, nuc: 0.55, nucCls: "multi", seed: 5, wob: 0.1 });
mk("circle", { class: "sg-core", cx: 0, cy: 0, r: 7 }, granG);
place(granG, 450, 280, 0, 1);
/* ---- lung infiltrate dots and fibroblasts along the fibrosis bands ---- */
const infG = mk("g", {}, layers.gran);
[[330, 180], [360, 210], [545, 190], [565, 230], [340, 290], [560, 300], [330, 245], [575, 265], [580, 180], [325, 315]].forEach(([x, y]) => mk("circle", { class: "sg-spot", cx: x, cy: y, r: 3.5 }, infG));
const fibCells = [[350, 350], [430, 342], [510, 352], [565, 342]].map(([x, y], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "sm", r: 8, nuc: 0.4, seed: i + 40, wob: 0.12 }); place(g, x, y, 0, 1); return g; });
/* ---- organ involvement dots (right edge of each organ card) ---- */
const spotGroups = ["spotSkin", "spotEye", "spotHeart", "spotCalc"].map((id, s) => { const g = $(id); if (g) [0, 1, 2].forEach((j) => mk("circle", { class: "sg-spot", cx: 892 + j * 14, cy: 118 + s * 92 + (j % 2) * 10, r: 4 }, g)); return g; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ags = pool(16, () => mk("path", { class: "sc-p p-ag", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.ags));
const cyts = pool(34, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const vits = pool(14, () => mk("circle", { class: "sc-p p-vit", r: 3 }, layers.parts));
const meds = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gran", "Granuloma", "g-cyt", "Granuloma burden: tight balls of activated macrophages and T cells without central caseous necrosis."], ["cd4", "CD4 activity", "g-fl", "CD4 T cell help driving macrophage activation. Falls when inflammation is suppressed."], ["nodes", "Hilar nodes", "g-eos", "Enlarged lymph nodes at both lung roots (bilateral hilar lymphadenopathy), a classic chest finding."], ["fib", "Fibrosis", "g-fib", "Lung scarring. Builds up late and is not reversed by suppressing inflammation."], ["org", "Organs", "g-org", "How much skin, eye, heart and other organs are involved by granulomas."], ["ca", "Calcium", "g-bad", "Blood calcium. Activated macrophages make active vitamin D, so calcium rises and falls again when they quieten."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Antigen", 70, 122, 75, 92, "Unknown antigen: the trigger is not known. A presumed inhaled antigen starts the response in susceptible people.");
  pill(ox, "Macrophage", 145, 202, 145, 178, "Antigen presenting macrophage: shows antigen to CD4 T cells and, once activated, becomes the epithelioid cell of the granuloma.");
  pill(ox, "CD4 T cell", 150, 362, 150, 390, "CD4 T cell: helper T lymphocyte. Its cytokines recruit and activate macrophages and hold the granuloma together.");
  pill(ox, "Cytokines", 258, 248, 262, 205, "Cytokines from T cells and macrophages: they recruit more macrophages and keep granulomatous inflammation going.");
  pill(ox, "Hilar nodes", 440, 140, 440, 102, "Bilateral hilar lymphadenopathy: enlarged nodes at both lung roots, packed with granulomas. Often found on a chest scan.");
  pill(ox, "Granuloma", 450, 226, 450, 205, "Non-caseating granuloma: a tight ball of epithelioid macrophages, a multinucleated giant cell and a lymphocyte cuff, with no central caseous necrosis. Biopsy can show this pattern.");
  pill(ox, "Lung fibrosis", 450, 372, 450, 412, "Lung fibrosis: late scarring around granulomas. It stiffens the lung, causes breathlessness and does not reverse with treatment.");
}
const sm = { a: 0.5, T: 0.3, G: 0.3, F: 0.2, Ca: 0.2, N: 0.3, O: 0.2, sup: 0 };
const acc = { ag: 0, cyt: 0, vit: 0, med: 0 };
const agState = ags.map((p, i) => ({ p, x: rnd(45, 230), y: rnd(108, 182), a: rnd(0, 6.28), s: 0, i }));
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.a = lerp(sm.a, m.a, k2); sm.T = lerp(sm.T, m.T, k2); sm.G = lerp(sm.G, m.G, k2); sm.F = lerp(sm.F, m.F, k2); sm.Ca = lerp(sm.Ca, m.Ca, k2); sm.N = lerp(sm.N, m.N, k2); sm.O = lerp(sm.O, m.O, k2); sm.sup = lerp(sm.sup, m.sup, k1);
  /* antigen particles drift in the trigger zone; some reach the macrophage */
  const want = Math.round(ags.length * (0.35 + 0.55 * sm.a));
  agState.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt;
    if (b.x < 42 || b.x > 232) b.a = Math.PI - b.a; if (b.y < 106 || b.y > 184) b.a = -b.a; b.x = clamp(b.x, 42, 232); b.y = clamp(b.y, 106, 184);
    b.p.on = b.s > 0.05; b.p.e.setAttribute("opacity", b.s > 0.05 ? "1" : "0"); b.p.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ") rotate(" + f1(tm / 6 + i * 20) + ") scale(" + b.s.toFixed(3) + ")"); });
  /* presenting cell and T cells bob with activity */
  place(apcG, 145 + Math.sin(tm / 1500) * 3, 230 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1 + 0.07 * sm.T * Math.sin(tm / 300));
  tcells.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1300 + i * 2) * 3, c.y + Math.cos(tm / 1500 + i) * 2, Math.sin(tm / 2000 + i) * 8, 0.7 + 0.5 * sm.T));
  /* cytokines from T cells toward the granuloma */
  acc.cyt += dt * sm.T * 13; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyts), c = pick(tcells); if (p) emit(p, c.x + rnd(-8, 8), c.y - 10, rnd(20, 34), rnd(-16, -6), 0); }
  cyts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (450 - p.x) * dt * 0.35; p.y += p.vy * dt + (280 - p.y) * dt * 0.35; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(450 - p.x, 280 - p.y) < 58 || p.t > 6) kill(p); });
  /* granuloma, nodes, infiltrates and fibrosis scale with the model */
  place(granG, 450, 280, Math.sin(tm / 3000) * 3, 0.45 + 0.6 * sm.G);
  nodeGroups.forEach((g, i) => place(g, i ? 502 : 378, 158, 0, 0.45 + 0.75 * sm.N));
  infG.setAttribute("opacity", (0.15 + 0.85 * sm.G).toFixed(2));
  layers.fib.setAttribute("opacity", (0.08 + 0.92 * sm.F).toFixed(2));
  fibCells.forEach((g, i) => { place(g, [350, 430, 510, 565][i], [350, 342, 352, 342][i], 0, 0.3 + 0.8 * sm.F); });
  spotGroups.forEach((g) => { if (g) g.setAttribute("opacity", sm.O.toFixed(2)); });
  /* active vitamin D particles leave the granuloma toward the calcium card */
  acc.vit += dt * sm.G * 5; while (acc.vit >= 1) { acc.vit--; const p = free(vits); if (p) emit(p, 505, 292, rnd(38, 52), rnd(16, 26), 0); }
  vits.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 632 || p.y > 424) kill(p); });
  /* treatment capsules drift to the granuloma when a drug is chosen */
  acc.med += dt * sm.sup * 2.6; while (acc.med >= 1) { acc.med--; const p = free(meds); if (p) emit(p, rnd(30, 90), 268, 0, 0, 0); }
  meds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (450 - p.x) * dt * 0.4 + 14 * dt; p.y += (280 - p.y) * dt * 0.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* gauges */
  gg.gran.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["small", "active", "extensive"])); gg.cd4.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["low", "raised", "high"])); gg.nodes.set(sm.N, wordOf(sm.N, 0.3, 0.6, ["normal", "enlarged", "marked"]));
  gg.fib.set(sm.F, wordOf(sm.F, 0.25, 0.6, ["none", "some", "extensive"])); gg.org.set(sm.O, wordOf(sm.O, 0.3, 0.6, ["none", "some", "marked"])); gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.3, 0.6, ["normal", "raised", "high"]));
}
run({ init, step });
