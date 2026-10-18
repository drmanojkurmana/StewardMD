/* Vaccination scene: dendritic presentation, helper T cells, germinal centre B cells, plasma cells, antibody, memory and later pathogen. */
const L = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
const W = SC.W;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "ab-y", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }

/* ---- main cells ---- */
const dcG = mk("g", {}, L.stage); const dcCell = cell(dcG, { cls: "dc", r: 33, nuc: 0.4, seed: 3, wob: 0.16 });
const presentG = mk("g", {}, L.stage);
const presentDots = [];
for (let j = 0; j < 8; j++) { const a = j / 8 * 6.283; presentDots.push(mk("circle", { class: "present", cx: f1(170 + Math.cos(a) * 34), cy: f1(210 + Math.sin(a) * 34), r: 3 }, presentG)); }
const thCell = cell(L.stage, { cls: "th", r: 21, nuc: 0.45, seed: 7, wob: 0.12 });
place(thCell, 400, 168, 0, 1);
mk("circle", { class: "foll", cx: 520, cy: 255, r: 88 }, L.stage);
const gcCirc = mk("circle", { class: "gc", cx: 520, cy: 255, r: 52 }, L.stage);
const bPos = [[478, 228], [505, 215], [535, 222], [560, 240], [470, 258], [498, 248], [528, 255], [556, 272], [482, 288], [512, 282], [542, 292], [500, 305], [532, 312], [462, 235], [568, 255], [520, 235]];
const bCells = bPos.map(([x, y], i) => { const g = cell(L.stage, { cls: "bcell", r: 10, nuc: 0.5, seed: i + 5, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
const plasma = [[720, 168], [790, 150]].map(([x, y], i) => { const g = cell(L.stage, { cls: "plasma", r: i ? 16 : 18, nuc: 0.38, seed: i + 21, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
const memB = cell(L.stage, { cls: "memb", r: 14, nuc: 0.5, seed: 31, wob: 0.1 }); place(memB, 600, 362, 0, 1);
const memT = cell(L.stage, { cls: "memt", r: 14, nuc: 0.5, seed: 37, wob: 0.1 }); place(memT, 700, 362, 0, 1);
const memRingB = mk("circle", { class: "mem-ring", cx: 600, cy: 362, r: 20 }, L.stage);
const memRingT = mk("circle", { class: "mem-ring", cx: 700, cy: 362, r: 20 }, L.stage);
const memExtra = [[560, 332], [650, 330], [748, 332], [640, 388]].map(([x, y], i) => { const g = cell(L.stage, { cls: i % 2 ? "memt" : "memb", r: 9, nuc: 0.5, seed: i + 41, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y, i }; });

/* ---- particle pools ---- */
const ag = pool(20, () => mk("path", { class: "sc-p p-ag", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
const sig = pool(22, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, L.parts));
const sig2 = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.parts));
const abs = pool(26, () => abShape(L.parts));
const paths = [];
for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-bac" }, L.parts); mk("ellipse", { class: "cl-b", rx: 7, ry: 3.6 }, g); mk("circle", { class: "cl-h", r: 1.4, cx: -1.5, cy: -1.2 }, g); paths.push({ g, x: 800 + (i % 4) * 32, y: 262 + Math.floor(i / 4) * 34 + (i % 3) * 6, i }); }
const acc = { ag: 0, sig: 0, sig2: 0, ab: 0 };

/* ---- labels ---- */
const marks = [];
function addMark(drugs, levels, text, x, y, tx, ty, tip) { const g = pill(L.over, text, x, y, tx, ty, tip); marks.push({ g, drugs, levels }); return g; }
pill(L.over, "Dendritic cell", 170, 176, 170, 96, "Dendritic cell: takes up antigen at the injection site, travels to the lymph node and presents antigen to helper T cells. Without it the adaptive response barely begins.");
pill(L.over, "T helper cell", 400, 147, 400, 96, "Helper T cell: activated by the dendritic cell. It helps B cells enter a germinal centre and also supports cellular immunity and memory T cells.");
pill(L.over, "Germinal centre", 520, 203, 530, 116, "Germinal centre in a lymph node follicle: B cells multiply here and their antibody is refined, helped by helper T cells. It produces plasma cells and memory B cells.");
pill(L.over, "B cell", 485, 295, 452, 362, "B cell: recognises antigen with its surface antibody. With T cell help it multiplies in the germinal centre and gives plasma cells and memory B cells.");
pill(L.over, "Plasma cell", 720, 150, 740, 96, "Plasma cell: a B cell turned antibody factory. It secretes large amounts of antibody into the blood.");
pill(L.over, "Antibody", 790, 166, 862, 116, "Antibody (immunoglobulin) made by plasma cells. It coats microbes, blocks attachment and marks them for clearance. Memory makes it return faster and stronger.");
pill(L.over, "Memory B cell", 600, 348, 595, 405, "Memory B cell: long-lived after the first dose and expanded by a booster. On later exposure it rapidly makes new plasma cells and high quality antibody.");
pill(L.over, "Memory T cell", 700, 348, 715, 405, "Memory T cell: long-lived helper memory. On later exposure it reacts within a short time, helping B cells and cellular defence far faster than a naive T cell.");
addMark([0], [0, 1], "No vaccine", 85, 150, 85, 116, "No vaccine was given, so there is no vaccine antigen to present. Only a later real infection can start a slow primary response.");
addMark([1], [0, 1], "Live vaccine", 85, 150, 85, 116, "Live attenuated vaccine: a weakened microbe that replicates briefly. It presents many antigens and drives strong T cell, germinal centre and memory responses, close to natural infection without the disease.");
addMark([2], [0, 1], "Conjugate vaccine", 85, 150, 85, 116, "Conjugate vaccine: a sugar coat antigen linked to a carrier protein. The protein recruits helper T cells, turning a weak sugar response into germinal centres, antibody and memory.");
addMark([0, 1, 2], [2], "Pathogen", 850, 296, 855, 405, "The real pathogen arrives later. With memory, antibody rises fast and the pathogen is controlled. Without vaccination this first meeting starts only a slow primary response while the pathogen multiplies.");

/* ---- gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The response";
  [["D", "Presentation", "g-dc", "Antigen taken up and presented by dendritic cells to helper T cells."], ["T", "T cell help", "g-th", "Activated helper T cells helping B cells and forming memory T cells."], ["G", "Germ centre", "g-gc", "Germinal centre activity: B cells multiplying and refining antibody in the lymph node."], ["Ab", "Antibody", "g-ab", "Antibody secreted by plasma cells into the blood."], ["M", "Memory", "g-mem", "Long-lived memory B and T cells left after vaccination, expanded by a booster."], ["Path", "Pathogen", "g-bad", "Real pathogen burden on later exposure. High without memory, controlled quickly when antibody returns fast."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { D: 0.2, T: 0.2, G: 0.2, Ab: 0.1, M: 0.1, Path: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.D = lerp(sm.D, m.D, k); sm.T = lerp(sm.T, m.T, k); sm.G = lerp(sm.G, m.G, k); sm.Ab = lerp(sm.Ab, m.Ab, k); sm.M = lerp(sm.M, m.M, k2); sm.Path = lerp(sm.Path, m.Path, k);
  place(dcCell, 170 + Math.sin(tm / 1500) * 3, 210 + Math.cos(tm / 1700) * 2.5, Math.sin(tm / 2400) * 5, 1 + 0.07 * sm.D * Math.sin(tm / 300));
  presentG.setAttribute("opacity", sm.D.toFixed(2));
  presentDots.forEach((d, j) => { const a = j / 8 * 6.283 + tm / 1800; d.setAttribute("cx", f1(170 + Math.cos(a) * 34)); d.setAttribute("cy", f1(210 + Math.sin(a) * 34)); });
  place(thCell, 400 + Math.sin(tm / 1300) * 2, 168 + Math.cos(tm / 1500) * 2, 0, 0.45 + 0.55 * sm.T);
  thCell.style.opacity = (0.35 + 0.65 * sm.T).toFixed(2);
  const gs = 0.55 + 0.55 * sm.G;
  gcCirc.setAttribute("transform", "translate(" + f1(520 * (1 - gs)) + " " + f1(255 * (1 - gs)) + ") scale(" + gs.toFixed(3) + ")");
  gcCirc.setAttribute("opacity", (0.3 + 0.7 * sm.G).toFixed(2));
  const bWant = Math.round(sm.G * bCells.length);
  bCells.forEach((b, i) => { const on = i < bWant; place(b.g, b.x + Math.sin(tm / 700 + i * 1.7) * 2.2, b.y + Math.cos(tm / 800 + i) * 2, 0, on ? 1 : 0.35); b.g.style.opacity = on ? "1" : "0.22"; });
  plasma.forEach((p, i) => { place(p.g, p.x, p.y + Math.sin(tm / 900 + i * 2) * 2, 0, 0.35 + 0.65 * sm.Ab); p.g.style.opacity = (0.3 + 0.7 * sm.Ab).toFixed(2); });
  place(memB, 600, 362 + Math.sin(tm / 1100) * 1.6, 0, 0.45 + 0.55 * sm.M); memB.style.opacity = (0.3 + 0.7 * sm.M).toFixed(2);
  place(memT, 700, 362 + Math.cos(tm / 1200) * 1.6, 0, 0.45 + 0.55 * sm.M); memT.style.opacity = (0.3 + 0.7 * sm.M).toFixed(2);
  memRingB.setAttribute("opacity", sm.M.toFixed(2)); memRingT.setAttribute("opacity", sm.M.toFixed(2));
  const mWant = Math.round(sm.M * memExtra.length);
  memExtra.forEach((e2, i) => { const on = i < mWant; place(e2.g, e2.x, e2.y, 0, on ? 1 : 0.3); e2.g.style.opacity = on ? "0.95" : "0.18"; });
  /* antigen to dendritic cell */
  acc.ag += dt * (m.level < 2 && m.drug > 0 ? 2 + 5 * sm.D : 0);
  while (acc.ag >= 1) { acc.ag--; const p = freeP(ag); if (p) emit(p, rnd(42, 110), rnd(132, 288), 0, 0, 0); }
  ag.forEach((p) => { if (!p.on) return; const dx = 170 - p.x, dy = 210 - p.y, d = Math.hypot(dx, dy) || 1; p.x += dx / d * 44 * dt; p.y += dy / d * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 36 || p.x > 300) kill(p); });
  /* signals: dendritic cell to T cell, then T cell to germinal centre */
  acc.sig += dt * sm.D * sm.T * 9; while (acc.sig >= 1) { acc.sig--; const p = freeP(sig); if (p) emit(p, 196, 198, 0, 0, 0); }
  sig.forEach((p) => { if (!p.on) return; const dx = 400 - p.x, dy = 168 - p.y, d = Math.hypot(dx, dy) || 1; p.x += dx / d * 58 * dt; p.y += dy / d * 58 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 24) kill(p); });
  acc.sig2 += dt * sm.T * sm.G * 9; while (acc.sig2 >= 1) { acc.sig2--; const p = freeP(sig2); if (p) emit(p, 414, 182, 0, 0, 0); }
  sig2.forEach((p) => { if (!p.on) return; const dx = 505 - p.x, dy = 240 - p.y, d = Math.hypot(dx, dy) || 1; p.x += dx / d * 54 * dt; p.y += dy / d * 54 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 20) kill(p); });
  /* antibody from plasma cells, drifting through the blood zone */
  acc.ab += dt * sm.Ab * 9; while (acc.ab >= 1) { acc.ab--; const p = freeP(abs); if (p) { const src = plasma[Math.floor(Math.random() * plasma.length)]; emit(p, src.x + rnd(-8, 8), src.y + rnd(-6, 10), rnd(14, 34), rnd(-6, 16), 0); } }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 400 + p.x) * 0.15; p.x = clamp(p.x, 676, 934); p.y = clamp(p.y, 58, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 350 + p.y) * 20) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.6).toFixed(2)); if (p.t > 5.6 || p.x >= 934) kill(p); });
  /* real pathogen on later exposure only */
  const pathVis = m.level === 2 ? sm.Path : 0;
  paths.forEach((p) => { place(p.g, p.x + Math.sin(tm / 800 + p.i * 1.9) * 4, p.y + Math.cos(tm / 950 + p.i) * 3, Math.sin(tm / 600 + p.i) * 24, 0.3 + 0.7 * pathVis); p.g.style.opacity = pathVis > 0.04 ? pathVis.toFixed(2) : "0"; });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.drugs.indexOf(m.drug) > -1 && mk2.levels.indexOf(m.level) > -1 ? "" : "none"; });
  gg.D.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["quiet", "active", "strong"])); gg.T.set(sm.T, wordOf(sm.T, 0.25, 0.55, ["few", "active", "many"]));
  gg.G.set(sm.G, wordOf(sm.G, 0.25, 0.55, ["quiet", "active", "busy"])); gg.Ab.set(sm.Ab, wordOf(sm.Ab, 0.25, 0.55, ["low", "rising", "high"]));
  gg.M.set(sm.M, wordOf(sm.M, 0.25, 0.55, ["few", "forming", "many"])); gg.Path.set(sm.Path, wordOf(sm.Path, 0.25, 0.55, ["none", "present", "high"]));
}
run({ init, step });
