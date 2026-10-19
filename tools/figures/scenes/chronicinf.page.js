/* Chronic inflammation scene in the lung: inhaled trigger, macrophage and lymphocyte infiltrate, helper T cytokines, macrophage activation, granuloma, angiogenesis, fibrosis and the gauges. */
const CY = SC.CY, WW = SC.W;
const GX = 560, GY = 218;
const layers = { lung: $("lungSlot"), flush: $("flush"), airway: $("airway"), bac: $("bac"), gran: $("gran"), cells: $("cells"), blk: $("blk"), rbc: $("rbcs"), endo: $("endo"), seals: $("seals"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), angio: $("angio"), coll: $("collagen"), dmg: $("damage") };
let hh = 34, lungO = null, TRX = 558;
const WALL_N = 26;
/* ---- the lung holds the granuloma; the airway above it brings the trigger in ---- */
function initOrgans() {
  lungO = organ(layers.lung, "lung", 560, 212, 230, {});
  const tp = lungO.ports.trachea || [560, 62];
  TRX = Math.round(tp[0]);
  layers.airway.setAttribute("d", "M" + f1(TRX) + " 46L" + f1(TRX) + " " + f1(tp[1] + 8));
}
/* ---- persistent trigger inside the granuloma core ---- */
const BAC_N = 24, bac = [];
function initBacteria() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6, ry: 3.2 } : { class: "cl-b", r: 3.8 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1.2, cy: -1.1 }, g);
    bac.push({ g, x: rnd(GX - 34, GX + 34), y: rnd(GY - 32, GY + 32), a: rnd(0, 6.28), s: 0, rod, rot: rnd(0, 180) }); } }
/* ---- granuloma: epithelioid ring, giant cell, lymphocyte cuff ---- */
const core = mk("circle", { class: "gran-core", cx: GX, cy: GY, r: 48, opacity: "0" }, layers.gran);
const ring = [];
for (let i = 0; i < 10; i++) { const t = (i / 10) * 6.283, g = mk("g", {}, layers.gran); cell(g, { cls: "epi", r: 16, nuc: 0.38, seed: i * 2 + 3, wob: 0.1 }); ring.push({ g, t }); }
const giant = (() => { const g = mk("g", {}, layers.gran); cell(g, { cls: "giant", r: 20, nuc: 0.34, seed: 9, wob: 0.12 }); return { g }; })();
const cuff = [];
for (let i = 0; i < 12; i++) { const t = (i / 12) * 6.283 + 0.26, g = mk("g", {}, layers.gran); cell(g, { cls: "lymph", r: 10, nuc: 0.62, seed: i + 51, wob: 0.08 }); cuff.push({ g, t }); }
/* ---- infiltrating and resident cells ---- */
const macs = [[150, 205, 24], [300, 255, 21], [350, 160, 20]].map(([x, y, r], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "mac", r, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }); return { g, x, y, r, ph: i * 2.1, px: x, py: y, ring: null }; });
const lymphs = [[95, 295], [235, 305], [760, 300]].map(([x, y], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "lymph", r: 12, nuc: 0.62, seed: i + 71, wob: 0.08 }); return { g, x, y }; });
const th1 = (() => { const g = mk("g", {}, layers.cells); cell(g, { cls: "th1", r: 13, nuc: 0.58, seed: 81, wob: 0.08 }); return { g, x: 380, y: 110 }; })();
const th17 = (() => { const g = mk("g", {}, layers.cells); cell(g, { cls: "th17", r: 13, nuc: 0.58, seed: 83, wob: 0.08 }); return { g, x: 415, y: 150 }; })();
const neus = [[70, 240], [120, 258]].map(([x, y], i) => { const g = cell(layers.cells, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 91, wob: 0.14 }); place(g, x, y, 0, 1); return { g, x, y }; });
const fibs = [[795, 235, -18], [850, 275, 14]].map(([x, y, rot], i) => { const g = mk("g", { class: "cl cl-fib" }, layers.cells); mk("ellipse", { class: "cl-b", rx: 17, ry: 6.5 }, g); mk("ellipse", { class: "cl-h", rx: 6, ry: 2, cx: -4, cy: -1.6 }, g); place(g, x, y, rot, 1); return { g, x, y, rot }; });
const dmgCells = [[450, 280], [650, 280], [560, 308]].map(([x, y], i) => { const g = mk("g", {}, layers.dmg); cell(g, { cls: "dam", r: 9, nuc: 0, seed: i + 101, wob: 0.24 }); place(g, x, y, i * 45, 0.9); return g; });
/* ---- activation rings, drug blockers and vessel seals (appear with treatment) ---- */
const blockers = [];
function initDrugFx() {
  macs.forEach((mm) => { mm.ring = mk("circle", { class: "act-ring", r: mm.r + 7, opacity: "0" }, layers.cells);
    [[-14, -6], [12, -10], [0, 12]].forEach(([ox, oy]) => { const e = mk("path", { class: "blk-y", d: "M0 0L0-7M0-4L-4.5-8.5M0-4L4.5-8.5", opacity: "0" }, layers.blk); blockers.push({ e, mm, ox, oy, ph: rnd(0, 6.28) }); }); });
}
const seals = [];
function initSeals() { for (let i = 0; i < 12; i++) { const x = 60 + i * 74;
  seals.push(mk("path", { class: "seal-t", d: "M" + x + " " + (CY - 41) + "L" + x + " " + (CY - 25), opacity: "0" }, layers.seals));
  seals.push(mk("path", { class: "seal-t", d: "M" + x + " " + (CY + 25) + "L" + x + " " + (CY + 41), opacity: "0" }, layers.seals)); } }
/* ---- angiogenesis sprouts and collagen fibres (static paths, faded by the model) ---- */
function initVesselsFibres() {
  [[250, 285], [620, 280]].forEach(([x, y]) => { mk("path", { class: "angio-v", d: "M" + x + " " + (CY - 30) + "C" + (x - 12) + " " + (CY - 58) + " " + (x + 10) + " " + (y + 26) + " " + x + " " + y }, layers.angio); mk("circle", { class: "angio-tip", cx: x, cy: y, r: 3.4 }, layers.angio); });
  const fibres = ["M730 205C760 195 790 198 815 188", "M770 262C800 252 830 254 860 246", "M64 282C120 268 180 272 238 258"];
  fibres.forEach((d) => mk("path", { class: "coll-f", d }, layers.coll));
}
/* ---- endothelium and red cells ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const ifn = pool(16, () => mk("circle", { class: "sc-p p-ifn", r: 2.5 }, layers.parts));
const tnf = pool(16, () => mk("rect", { class: "sc-p p-tnf", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, layers.parts));
const il17 = pool(14, () => mk("path", { class: "sc-p p-il17", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const inh = pool(8, () => mk("circle", { class: "sc-p p-trig", r: 2.8 }, layers.parts));
const drugp = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = clamp(x, 26, WW - 26); p.y = clamp(y, 58, 424); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 1) return "Anti-inflammatory treatment calms the infiltrate. Fewer signals reach the macrophages.";
  if (d === 2) return "The biologic blocks the cytokine signal. Macrophages switch off but the trigger stays.";
  if (d === 3) return l >= 2 ? "Trigger removed. The infiltrate disperses. The granuloma shrinks but fibrosis stays." : "Trigger removed. The infiltrate disperses and the granuloma shrinks.";
  return l >= 2 ? "No treatment. The trigger persists and the tissue scars." : "No treatment. The trigger persists and macrophages stay switched on.";
}
/* ---- labels and gauges ---- */
const gg = {};
let capEl = null, capKey = "";
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The tissue response";
  [["trig", "Trigger", "g-bac", "The persistent trigger: breathed in down the airway, it resists clearing, so the response does not switch off."], ["inf", "Infiltrate", "g-cyt", "Macrophages and lymphocytes gathered in the tissue, replacing the early neutrophils."], ["cyt", "Cytokines", "g-cyt", "Interferon gamma from Th1 cells, interleukin 17 from Th17 cells and tumour necrosis factor from macrophages."], ["dmg", "Damage", "g-bad", "Tissue destruction by persistently activated macrophages, which release enzymes and reactive products."], ["ang", "New vessels", "g-bad", "Angiogenesis: new small blood vessels grow into the inflamed tissue."], ["fib", "Fibrosis", "g-clot", "Fibroblasts lay down collagen. Scar like fibrosis replaces damaged tissue and can distort it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Trigger", 545, 203, 350, 80, "The trigger at the centre, breathed in down the airway. It resists clearing, so the response does not switch off.");
  pill(ox, "Macrophage", 150, 181, 140, 100, "The central cell. It presents antigen, releases tumour necrosis factor and, when switched on, damages tissue.");
  pill(ox, "Cytokines", 397, 128, 600, 80, "Interferon gamma from Th1 cells, interleukin 17 from Th17 cells and tumour necrosis factor from macrophages. They keep macrophages switched on.");
  pill(ox, "Granuloma", 632, 203, 720, 80, "A wall of epithelioid macrophages and giant cells around the trigger, with lymphocytes at the rim. It contains the trigger but can damage tissue.");
  pill(ox, "Lung", 655, 140, 858, 80, "This granuloma sits in the lung. Airborne triggers arrive down the airway, and blood brings cells and treatment.");
  pill(ox, "Tissue damage", 450, 280, 450, 315, "Switched on macrophages release enzymes and reactive products that break down the tissue around them.");
  pill(ox, "Fibrosis", 800, 240, 845, 315, "Collagen laid down by fibroblasts. It walls off and repairs, but excess fibrosis distorts the tissue.");
  pill(ox, "Blood vessel", 100, 368, 120, 315, "Cells and treatment arrive in the blood. New small vessels also sprout into the inflamed tissue.");
  capEl = mk("text", { class: "ci-cap", x: 30, y: 432 }, ox); capEl.textContent = capText(0, level);
}
const sm = { Trig: 0.6, Inf: 0.5, Cyt: 0.5, Act: 0.4, Destr: 0.3, Ang: 0.3, Fib: 0.2, Gran: 0.3, Resol: 0.2, drug: 0, ster: 0, bio: 0, rem: 0 };
const acc = { ifn: 0, tnf: 0, il17: 0, inh: 0, drugp: 0 };
function trapped(p) { if (sm.bio < 0.5) return false; for (let i = 0; i < macs.length; i++) { const dx = p.x - macs[i].px, dy = p.y - macs[i].py; if (dx * dx + dy * dy < 36 * 36) { p.st = 9; p.t = 0; return true; } } return false; }
function init() { initOrgans(); initBacteria(); initDrugFx(); initSeals(); initEndo(); initRbc(); initVesselsFibres(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  ["Trig", "Inf", "Cyt", "Act", "Destr", "Ang", "Fib", "Gran", "Resol"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  ["drug", "ster", "bio", "rem"].forEach((q, i) => { sm[q] = lerp(sm[q], [m.drugAny, m.ster, m.bio, m.rem][i], k1); });
  hh = 34 + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.angio.setAttribute("opacity", (0.12 + 0.88 * sm.Ang).toFixed(2));
  layers.coll.setAttribute("opacity", (0.08 + 0.92 * sm.Fib).toFixed(2));
  layers.dmg.setAttribute("opacity", clamp(0.15 + sm.Destr).toFixed(2));
  layers.flush.setAttribute("opacity", (0.30 * clamp(Math.max(sm.Inf, sm.Cyt))).toFixed(2));
  core.setAttribute("r", f1(48 * (0.45 + 0.55 * sm.Gran))); core.setAttribute("opacity", (sm.Gran * 0.9).toFixed(2));
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  seals.forEach((s) => s.setAttribute("opacity", sm.ster.toFixed(2)));
  /* trigger wanders only inside the core, so particles stay in the stage */
  const want = Math.round(sm.Trig * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.4, 1.4) * dt; b.x += Math.cos(b.a) * 6 * dt; b.y += Math.sin(b.a) * 6 * dt; b.x = clamp(b.x, GX - 38, GX + 38); b.y = clamp(b.y, GY - 36, GY + 36);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 18, Math.max(0.001, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* inhaled trigger drifts down the airway into the core until the trigger is removed */
  acc.inh += dt * sm.Trig * (1 - sm.rem) * 4; while (acc.inh >= 1) { acc.inh--; const p = free(inh); if (p) { const dx = GX - TRX, dy = GY - 62, L = Math.hypot(dx, dy) || 1, v = rnd(38, 58); emit(p, TRX + rnd(-4, 4), 62, dx / L * v, dy / L * v, 0); } }
  inh.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 420 + p.t * 3) * 5 * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    const dx = p.x - GX, dy = p.y - GY; if (dx * dx + dy * dy < 26 * 26 || p.t > 5) kill(p); });
  /* granuloma ring and cuff grow with persistence and shrink when the trigger goes */
  const rr = 72 * (0.55 + 0.45 * sm.Gran), cr = 95 * (0.6 + 0.4 * clamp(sm.Inf));
  ring.forEach((c, i) => { place(c.g, GX + Math.cos(c.t) * rr + Math.sin(tm / 1500 + i) * 1.6, GY + Math.sin(c.t) * rr + Math.cos(tm / 1700 + i) * 1.6, Math.sin(tm / 2400 + i) * 8, Math.max(0.001, 0.25 + 0.75 * sm.Gran)); c.g.style.opacity = sm.Gran > 0.05 ? 1 : 0; });
  place(giant.g, GX - 12 + Math.sin(tm / 1900) * 1.5, GY - 8, Math.sin(tm / 2800) * 5, Math.max(0.001, 0.3 + 0.7 * sm.Gran)); giant.g.style.opacity = sm.Gran > 0.05 ? 1 : 0;
  cuff.forEach((c, i) => { place(c.g, GX + Math.cos(c.t) * cr, GY + Math.sin(c.t) * cr + Math.sin(tm / 1400 + i) * 2, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); c.g.style.opacity = sm.Inf > 0.06 ? 1 : 0; });
  /* infiltrate, helper T cells, early neutrophils, fibroblasts */
  macs.forEach((mm, i) => { mm.px = mm.x + Math.sin(tm / 1600 + mm.ph) * 3; mm.py = mm.y + Math.cos(tm / 1800 + mm.ph) * 2.5;
    place(mm.g, mm.px, mm.py, Math.sin(tm / 2600 + mm.ph) * 6, (0.35 + 0.65 * sm.Inf) * (1 + 0.07 * sm.Act * Math.sin(tm / 300 + i))); mm.g.style.opacity = clamp(0.3 + sm.Inf);
    place(mm.ring, mm.px, mm.py, 0, 1); mm.ring.setAttribute("opacity", (sm.Act * 0.85).toFixed(2)); });
  blockers.forEach((b) => { place(b.e, b.mm.px + b.ox, b.mm.py + b.oy + Math.sin(tm / 700 + b.ph) * 1.5, 0, 1); b.e.setAttribute("opacity", sm.bio.toFixed(2)); });
  lymphs.forEach((l, i) => { place(l.g, l.x, l.y + Math.sin(tm / 1400 + i * 1.3) * 2.5, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); l.g.style.opacity = clamp(0.25 + sm.Inf); });
  place(th1.g, th1.x, th1.y + Math.sin(tm / 1300) * 2, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); th1.g.style.opacity = clamp(0.25 + sm.Inf);
  place(th17.g, th17.x, th17.y + Math.cos(tm / 1500) * 2, 0, Math.max(0.001, 0.3 + 0.7 * sm.Inf)); th17.g.style.opacity = clamp(0.25 + sm.Inf);
  neus.forEach((n, i) => { place(n.g, n.x + Math.sin(tm / 1200 + i) * 2, n.y, Math.sin(tm / 500 + i) * 10, Math.max(0.001, sm.Resol)); n.g.style.opacity = sm.Resol > 0.05 ? 1 : 0; });
  fibs.forEach((fb, i) => { place(fb.g, fb.x, fb.y, fb.rot + Math.sin(tm / 2000 + i) * 4, Math.max(0.001, 0.3 + 0.7 * sm.Fib)); fb.g.style.opacity = clamp(0.3 + sm.Fib); });
  /* cytokines drift right toward the granuloma and macrophages; the biologic traps them there */
  acc.ifn += dt * sm.Cyt * 7; while (acc.ifn >= 1) { acc.ifn--; const p = free(ifn); if (p) emit(p, th1.x + rnd(-10, 10), th1.y + rnd(8, 16), rnd(28, 52), rnd(8, 26), 0); }
  acc.tnf += dt * sm.Cyt * 8; while (acc.tnf >= 1) { acc.tnf--; const mm = pick(macs), p = free(tnf); if (p) emit(p, mm.px + rnd(-14, 14), mm.py + rnd(-10, 10), rnd(10, 30), rnd(-8, 14), 0); }
  acc.il17 += dt * sm.Cyt * 6; while (acc.il17 >= 1) { acc.il17--; const p = free(il17); if (p) emit(p, th17.x + rnd(-10, 10), th17.y + rnd(8, 14), rnd(28, 50), rnd(6, 20), 0); }
  [ifn, tnf, il17].forEach((pl) => pl.forEach((p) => { if (!p.on) return;
    if (p.st === 9) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); return; }
    p.t += dt; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 400 + p.y) * 0.25, 26, WW - 26); p.y = clamp(p.y + p.vy * dt, 58, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); trapped(p); if (p.t > 3.4) kill(p); }));
  /* red cells flow; treatment capsules leave the blood under the lung */
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, clamp(r.x, -12, WW + 12), CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  acc.drugp += dt * sm.drug * 3; while (acc.drugp >= 1) { acc.drugp--; const p = free(drugp); if (p) emit(p, -6, CY + rnd(-hh + 12, hh - 12), 85, 0, 0); }
  drugp.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += p.vx * dt; if (sm.drug > 0.5 && p.x > 400 && p.x < 720) { p.st = 1; p.vx = 20; p.vy = -34; } if (p.x > WW + 6) kill(p); }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("opacity", clamp((p.y - (CY - 110)) / 60).toFixed(2)); if (p.y < CY - 110) kill(p); }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); });
  /* gauges */
  gg.trig.set(sm.Trig, wordOf(sm.Trig, 0.3, 0.6, ["clearing", "present", "persistent"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["few", "many", "dense"])); gg.cyt.set(sm.Cyt, wordOf(sm.Cyt, 0.3, 0.6, ["low", "raised", "high"]));
  gg.dmg.set(sm.Destr, wordOf(sm.Destr, 0.3, 0.6, ["little", "some", "marked"])); gg.ang.set(sm.Ang, wordOf(sm.Ang, 0.3, 0.6, ["few", "growing", "many"])); gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.3, 0.6, ["none", "some", "dense"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
