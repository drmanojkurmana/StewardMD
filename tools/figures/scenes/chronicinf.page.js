/* Chronic inflammation scene: persistent trigger, macrophage and lymphocyte infiltrate, Th1 and Th17 cytokines, macrophage activation, tissue damage, angiogenesis, fibroblast fibrosis, granuloma and the gauges. */
const CY = SC.CY, WW = SC.W;
const GX = 500, GY = 205;
const layers = { bac: $("bac"), gran: $("gran"), cells: $("cells"), rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), angio: $("angio"), coll: $("collagen"), dmg: $("damage") };
let hh = 34;
const WALL_N = 26;
/* ---- persistent trigger inside the granuloma core ---- */
const BAC_N = 24, bac = [];
function initBacteria() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6, ry: 3.2 } : { class: "cl-b", r: 3.8 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1.2, cy: -1.1 }, g);
    bac.push({ g, x: rnd(GX - 34, GX + 34), y: rnd(GY - 32, GY + 32), a: rnd(0, 6.28), s: 0, rod, rot: rnd(0, 180) }); } }
/* ---- granuloma: epithelioid ring, giant cell, lymphocyte cuff ---- */
const core = mk("circle", { class: "gran-core", cx: GX, cy: GY, r: 54, opacity: "0" }, layers.gran);
const ring = [];
for (let i = 0; i < 10; i++) { const t = (i / 10) * 6.283, g = mk("g", {}, layers.gran); cell(g, { cls: "epi", r: 17, nuc: 0.38, seed: i * 2 + 3, wob: 0.1 }); ring.push({ g, x: GX + Math.cos(t) * 80, y: GY + Math.sin(t) * 80 }); }
const giant = (() => { const g = mk("g", {}, layers.gran); cell(g, { cls: "giant", r: 21, nuc: 0.34, seed: 9, wob: 0.12 }); return { g }; })();
const cuff = [];
for (let i = 0; i < 12; i++) { const t = (i / 12) * 6.283 + 0.26, g = mk("g", {}, layers.gran); cell(g, { cls: "lymph", r: 10.5, nuc: 0.62, seed: i + 51, wob: 0.08 }); cuff.push({ g, x: GX + Math.cos(t) * 110, y: GY + Math.sin(t) * 110 }); }
/* ---- infiltrating and resident cells ---- */
const macs = [[285, 235, 24], [340, 135, 21], [705, 255, 22]].map(([x, y, r], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "mac", r, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }); return { g, x, y, ph: i * 2.1 }; });
const lymphs = [[150, 150], [210, 290], [745, 200], [880, 178]].map(([x, y], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "lymph", r: 12, nuc: 0.62, seed: i + 71, wob: 0.08 }); return { g, x, y }; });
const th1 = (() => { const g = mk("g", {}, layers.cells); cell(g, { cls: "th1", r: 13, nuc: 0.58, seed: 81, wob: 0.08 }); return { g, x: 628, y: 112 }; })();
const th17 = (() => { const g = mk("g", {}, layers.cells); cell(g, { cls: "th17", r: 13, nuc: 0.58, seed: 83, wob: 0.08 }); return { g, x: 675, y: 155 }; })();
const neus = [[120, 210], [170, 242], [95, 262]].map(([x, y], i) => { const g = cell(layers.cells, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 91, wob: 0.14 }); place(g, x, y, 0, 1); return { g, x, y }; });
const fibs = [[790, 255, -18], [838, 286, 14], [762, 296, -8], [882, 248, 22]].map(([x, y, rot], i) => { const g = mk("g", { class: "cl cl-fib" }, layers.cells); mk("ellipse", { class: "cl-b", rx: 17, ry: 6.5 }, g); mk("ellipse", { class: "cl-h", rx: 6, ry: 2, cx: -4, cy: -1.6 }, g); place(g, x, y, rot, 1); return { g, x, y, rot }; });
const dmgCells = [[400, 280], [368, 244], [438, 288], [612, 302]].map(([x, y], i) => { const g = mk("g", {}, layers.dmg); cell(g, { cls: "dam", r: 9, nuc: 0, seed: i + 101, wob: 0.24 }); place(g, x, y, i * 45, 0.9); return g; });
/* ---- angiogenesis sprouts and collagen fibres (static paths, faded by the model) ---- */
function initVesselsFibres() {
  [[230, 292], [700, 278], [858, 296]].forEach(([x, y]) => { mk("path", { class: "angio-v", d: "M" + x + " " + (CY - 30) + "C" + (x - 12) + " " + (CY - 58) + " " + (x + 10) + " " + (y + 26) + " " + x + " " + y }, layers.angio); mk("circle", { class: "angio-tip", cx: x, cy: y, r: 3.4 }, layers.angio); });
  const fibres = ["M730 205C760 195 790 198 815 188", "M392 118C430 100 470 96 512 104", "M64 282C120 268 180 272 238 258"];
  fibres.forEach((d) => mk("path", { class: "coll-f", d }, layers.coll));
}
/* ---- endothelium and red cells ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ifn = pool(16, () => mk("circle", { class: "sc-p p-ifn", r: 2.5 }, layers.parts));
const tnf = pool(16, () => mk("rect", { class: "sc-p p-tnf", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, layers.parts));
const il17 = pool(14, () => mk("path", { class: "sc-p p-il17", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const drugp = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = clamp(x, 26, WW - 26); p.y = clamp(y, 58, 424); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The tissue response";
  [["trig", "Trigger", "g-bac", "The persistent trigger: microbes or material that could not be cleared, or a stimulus that keeps returning."], ["inf", "Infiltrate", "g-cyt", "Macrophages and lymphocytes gathered in the tissue, replacing the early neutrophils."], ["cyt", "Cytokines", "g-cyt", "Interferon gamma from Th1 cells, interleukin 17 from Th17 cells and tumour necrosis factor from macrophages."], ["dmg", "Damage", "g-bad", "Tissue destruction by persistently activated macrophages, which release enzymes and reactive products."], ["ang", "New vessels", "g-bad", "Angiogenesis: new small blood vessels grow into the inflamed tissue."], ["fib", "Fibrosis", "g-clot", "Fibroblasts lay down collagen. Scar like fibrosis replaces damaged tissue and can distort it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Trigger", GX - 18, GY - 24, 390, 86, "The persistent trigger at the centre. It resists clearing, so the response does not switch off.");
  pill(ox, "Granuloma", GX + 62, GY - 58, 675, 86, "Granuloma: a walled off collection of epithelioid macrophages and giant cells around the trigger, with lymphocytes at the rim. It contains the trigger but can also damage tissue.");
  pill(ox, "Th1 cell", th1.x, th1.y - 12, 835, 86, "Th1 cell: a helper T cell that releases interferon gamma, the main macrophage activating cytokine.");
  pill(ox, "Macrophage", 285, 211, 195, 100, "Macrophage: the central cell of chronic inflammation. It presents antigen, releases tumour necrosis factor and, when persistently activated, damages tissue.");
  pill(ox, "Lymphocyte", 745, 188, 750, 175, "Lymphocyte: T and B lymphocytes gather with macrophages. Their cytokines keep the response going.");
  pill(ox, "Th17 cell", th17.x + 12, th17.y, 850, 140, "Th17 cell: a helper T cell that releases interleukin 17, which recruits cells and adds to macrophage activation.");
  pill(ox, "Fibroblast", 806, 248, 855, 225, "Fibroblast: a tissue cell that makes collagen. In chronic inflammation it lays down fibrosis.");
  pill(ox, "New vessels", 230, 292, 145, 315, "New vessels: angiogenesis grows small vessels into the tissue, bringing more cells but also sustaining the response.");
  pill(ox, "Tissue damage", 400, 262, 405, 315, "Tissue damage: activated macrophages release enzymes and reactive products that break down the tissue around them.");
  pill(ox, "Cytokines", GX + 42, GY + 62, 625, 315, "Cytokines: interferon gamma from Th1 cells, interleukin 17 from Th17 cells and tumour necrosis factor from macrophages. They keep macrophages activated.");
  pill(ox, "Fibrosis", 858, 282, 845, 315, "Fibrosis: collagen laid down by fibroblasts. It walls off and repairs, but excess fibrosis distorts the tissue.");
  const dp = pill(ox, "Treatment", 650, CY + 6, 650, 405, "Treatment arriving in the blood: removing the trigger, a broad anti-inflammatory, or a biologic against a cytokine."); dp.setAttribute("id", "drug-pill");
}
const sm = { Trig: 0.6, Inf: 0.5, Cyt: 0.5, Act: 0.4, Destr: 0.3, Ang: 0.3, Fib: 0.2, Gran: 0.3, Resol: 0.2, drug: 0 };
const acc = { ifn: 0, tnf: 0, il17: 0, drugp: 0 };
function init() { initBacteria(); initEndo(); initRbc(); initVesselsFibres(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Trig = lerp(sm.Trig, m.Trig, k2); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.Cyt = lerp(sm.Cyt, m.Cyt, k2); sm.Act = lerp(sm.Act, m.Act, k2); sm.Destr = lerp(sm.Destr, m.Destr, k2); sm.Ang = lerp(sm.Ang, m.Ang, k2); sm.Fib = lerp(sm.Fib, m.Fib, k2); sm.Gran = lerp(sm.Gran, m.Gran, k2); sm.Resol = lerp(sm.Resol, m.Resol, k2); sm.drug = lerp(sm.drug, m.drugAny, k1);
  hh = 34 + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.angio.setAttribute("opacity", (0.12 + 0.88 * sm.Ang).toFixed(2));
  layers.coll.setAttribute("opacity", (0.08 + 0.92 * sm.Fib).toFixed(2));
  layers.dmg.setAttribute("opacity", clamp(0.15 + sm.Destr).toFixed(2));
  core.setAttribute("opacity", (sm.Gran * 0.9).toFixed(2));
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  /* trigger wanders only inside the core, so particles stay in the stage */
  const want = Math.round(sm.Trig * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.4, 1.4) * dt; b.x += Math.cos(b.a) * 6 * dt; b.y += Math.sin(b.a) * 6 * dt; b.x = clamp(b.x, GX - 38, GX + 38); b.y = clamp(b.y, GY - 36, GY + 36);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 18, Math.max(0.001, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* granuloma ring and cuff grow with persistence */
  ring.forEach((c, i) => { place(c.g, c.x + Math.sin(tm / 1500 + i) * 1.6, c.y + Math.cos(tm / 1700 + i) * 1.6, Math.sin(tm / 2400 + i) * 8, Math.max(0.001, 0.25 + 0.75 * sm.Gran)); c.g.style.opacity = sm.Gran > 0.05 ? 1 : 0; });
  place(giant.g, GX - 14 + Math.sin(tm / 1900) * 1.5, GY - 8, Math.sin(tm / 2800) * 5, Math.max(0.001, 0.3 + 0.7 * sm.Gran)); giant.g.style.opacity = sm.Gran > 0.05 ? 1 : 0;
  cuff.forEach((c, i) => { place(c.g, c.x, c.y + Math.sin(tm / 1400 + i) * 2, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); c.g.style.opacity = sm.Inf > 0.06 ? 1 : 0; });
  /* infiltrate, helper T cells, early neutrophils, fibroblasts */
  macs.forEach((mm, i) => { place(mm.g, mm.x + Math.sin(tm / 1600 + mm.ph) * 3, mm.y + Math.cos(tm / 1800 + mm.ph) * 2.5, Math.sin(tm / 2600 + mm.ph) * 6, (0.35 + 0.65 * sm.Inf) * (1 + 0.07 * sm.Act * Math.sin(tm / 300 + i))); mm.g.style.opacity = clamp(0.3 + sm.Inf); });
  lymphs.forEach((l, i) => { place(l.g, l.x, l.y + Math.sin(tm / 1400 + i * 1.3) * 2.5, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); l.g.style.opacity = clamp(0.25 + sm.Inf); });
  place(th1.g, th1.x, th1.y + Math.sin(tm / 1300) * 2, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); th1.g.style.opacity = clamp(0.25 + sm.Inf);
  place(th17.g, th17.x, th17.y + Math.cos(tm / 1500) * 2, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); th17.g.style.opacity = clamp(0.25 + sm.Inf);
  neus.forEach((n, i) => { place(n.g, n.x + Math.sin(tm / 1200 + i) * 2, n.y, Math.sin(tm / 500 + i) * 10, Math.max(0.001, sm.Resol)); n.g.style.opacity = sm.Resol > 0.05 ? 1 : 0; });
  fibs.forEach((fb, i) => { place(fb.g, fb.x, fb.y, fb.rot + Math.sin(tm / 2000 + i) * 4, Math.max(0.001, 0.3 + 0.7 * sm.Fib)); fb.g.style.opacity = clamp(0.3 + sm.Fib); });
  /* cytokines drift toward the granuloma and macrophages */
  acc.ifn += dt * sm.Cyt * 7; while (acc.ifn >= 1) { acc.ifn--; const p = free(ifn); if (p) emit(p, th1.x + rnd(-10, 10), th1.y + rnd(8, 16), rnd(-26, -12), rnd(18, 30), 0); }
  acc.tnf += dt * sm.Cyt * 8; while (acc.tnf >= 1) { acc.tnf--; const mm = pick(macs), p = free(tnf); if (p) emit(p, mm.x + rnd(-14, 14), mm.y + rnd(-10, 10), rnd(-14, 14), rnd(-8, 16), 0); }
  acc.il17 += dt * sm.Cyt * 6; while (acc.il17 >= 1) { acc.il17--; const p = free(il17); if (p) emit(p, th17.x + rnd(-10, 10), th17.y + rnd(8, 14), rnd(-30, -16), rnd(6, 18), 0); }
  [ifn, tnf, il17].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 400 + p.y) * 0.25, 26, WW - 26); p.y = clamp(p.y + p.vy * dt, 58, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); }));
  /* red cells and treatment capsules in the vessel */
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, clamp(r.x, -12, WW + 12), CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  acc.drugp += dt * sm.drug * 3; while (acc.drugp >= 1) { acc.drugp--; const p = free(drugp); if (p) emit(p, -6, CY + rnd(-hh + 12, hh - 12), 85, 0, 0); }
  drugp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.x > WW + 6) kill(p); });
  const dpill = $("drug-pill"); if (dpill) dpill.style.opacity = sm.drug.toFixed(2);
  /* gauges */
  gg.trig.set(sm.Trig, wordOf(sm.Trig, 0.3, 0.6, ["clearing", "present", "persistent"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["few", "many", "dense"])); gg.cyt.set(sm.Cyt, wordOf(sm.Cyt, 0.3, 0.6, ["low", "raised", "high"]));
  gg.dmg.set(sm.Destr, wordOf(sm.Destr, 0.3, 0.6, ["little", "some", "marked"])); gg.ang.set(sm.Ang, wordOf(sm.Ang, 0.3, 0.6, ["few", "growing", "many"])); gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.3, 0.6, ["none", "some", "dense"]));
}
run({ init, step });
