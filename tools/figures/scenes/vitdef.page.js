/* Vitamin deficiency scene: intake and gut, active cofactor, enzyme work, syndrome rows and gauges. */
const layers = { nodes: $("nodes"), rowsG: $("rowsG"), parts: $("parts"), over: $("over"), panel: $("panel"), badge: $("badge"), enz: $("enz"), blockX: $("blockX"), cofLetter: $("cofLetter"), cofForm: $("cofForm"), role1: $("role1"), role2: $("role2") };
const VIT = [
  { letter: "A", form: "Retinal and retinoic acid", r1: "Vision pigment and eye surface", r2: "Rod pigment, surface keeping" },
  { letter: "B1", form: "Thiamine pyrophosphate", r1: "Energy enzymes in nerve and heart", r2: "Pyruvate and keto acid steps" },
  { letter: "B3", form: "NAD and NADP", r1: "Redox reactions in skin, gut, brain", r2: "Hydrogen carrying coenzymes" },
  { letter: "B12", form: "Cobalamin cofactors", r1: "Methionine and methylmalonyl steps", r2: "Nerve, cord and marrow keeping" },
  { letter: "C", form: "Ascorbate", r1: "Collagen hydroxylation enzymes", r2: "Proline and lysine hydroxylation" },
  { letter: "D", form: "Calcitriol, active hormone", r1: "Gut calcium absorption", r2: "Bone mineralisation supply" },
  { letter: "K", form: "Vitamin K cofactor", r1: "Clotting factor carboxylation", r2: "Factor activation in liver" },
];
const rowRects = [], rowIcons = [];
for (let i = 0; i < 7; i++) { rowRects.push($("rowR" + i)); rowIcons.push(layers.rowsG.querySelector("#row" + i + " circle")); }
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, t: 0, k: 0 }; }); }
const vitP = pool(20, function () { return mk("circle", { class: "sc-p p-vit", r: 2.8 }, layers.parts); });
const cofP = pool(16, function () { return mk("circle", { class: "sc-p p-cof", r: 2.6 }, layers.parts); });
const prodP = pool(16, function () { return mk("circle", { class: "sc-p p-prod", r: 2.6 }, layers.parts); });
const dropP = pool(12, function () { return mk("circle", { class: "sc-p p-drop", r: 2.4 }, layers.parts); });
const treatP = pool(10, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4.4, y: -2.2, width: 8.8, height: 4.4, rx: 2.2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.2, width: 4.4, height: 4.4, rx: 2 }, g); return g; });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.tx = tx; p.ty = ty; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function seek(pl, dt, speed, onArrive) { pl.forEach(function (p) { if (!p.on) return; p.t += dt; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * dt; p.y += (dy / d) * speed * dt; p.x = clamp(p.x, 22, 938); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 12) onArrive(p); }); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [150, 380, 610, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cof", "Cofactor", "g-cof", "Active cofactor supply for the vitamin shown. It falls when intake, absorption or stores fail, and rises with replacement, diet or treating malabsorption."], ["tiss", "Tissue function", "g-tiss", "How well the tissue that depends on this cofactor can work: eye, nerve, skin, marrow, collagen, bone or clotting."], ["syn", "Syndrome", "g-syn", "Severity of the named deficiency syndrome for the vitamin shown."], ["eff", "Treatment response", "g-eff", "How well the chosen treatment restores this vitamin. Replacement is direct, diet is slower, and treating malabsorption helps most when absorption was the fault."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Diet", 85, 143, 85, 128, "Diet: food is the usual source of most vitamins. Poor intake, alcoholism and restrictive diets lower supply.");
  pill(ox, "Replacement", 175, 150, 175, 128, "Replacement: giving the missing vitamin directly. It restores the cofactor fastest in this teaching model.");
  pill(ox, "Gut", 85, 227, 80, 210, "The gut, where vitamins are absorbed. Fat soluble vitamins A, D and K need fat absorption, and B12 needs a longer stomach and ileum route.");
  pill(ox, "Blocked gut", 175, 228, 178, 210, "Malabsorption: bowel disease, bariatric surgery or fat malabsorption blocks uptake. Treating the cause restores absorption.");
  pill(ox, "Alcohol", 85, 306, 85, 294, "Alcohol use: a classic route to thiamine lack through poor intake, poor absorption and poor stores.");
  pill(ox, "Low intake", 175, 318, 175, 294, "Low intake and empty stores: many water soluble vitamins have small stores, so deficiency follows quickly when intake stops.");
  pill(ox, "Active cofactor", 408, 138, 408, 120, "The active cofactor form of the vitamin shown. Its name and job change with the slider.");
  pill(ox, "Enzyme step", 408, 238, 408, 222, "The enzyme or tissue step that needs this cofactor. Without it the step slows and its product falls.");
  pill(ox, "Substrate", 316, 254, 310, 236, "Starting material entering the cofactor dependent step.");
  pill(ox, "Product", 500, 254, 502, 236, "Product of the cofactor dependent step, sent on to the tissue that needs it.");
}
const sm = { Cof: 0.3, Syn: 0.7, Tiss: 0.3, eff: 0, mal: 0 };
const acc = { vit: 0, cof: 0, prod: 0, drop: 0, treat: 0 };
let shownIdx = -1;
function init() { initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 0.9);
  sm.Cof = lerp(sm.Cof, m.Cof, kk); sm.Syn = lerp(sm.Syn, m.Syn, kk); sm.Tiss = lerp(sm.Tiss, m.Tiss, kk); sm.eff = lerp(sm.eff, m.eff, kk); sm.mal = lerp(sm.mal, m.drug === 3 ? 1 : 0, kk);
  if (shownIdx !== m.t) { shownIdx = m.t; const v = VIT[m.t]; layers.cofLetter.textContent = v.letter; layers.cofForm.textContent = v.form; layers.role1.textContent = v.r1; layers.role2.textContent = v.r2; }
  layers.badge.setAttribute("r", f1(13 + 11 * sm.Cof));
  layers.badge.setAttribute("opacity", (0.55 + 0.45 * sm.Cof).toFixed(2));
  const es = 0.72 + 0.38 * sm.Cof;
  layers.enz.setAttribute("transform", "translate(408 270) scale(" + es.toFixed(3) + ") translate(-408 -270)");
  layers.enz.setAttribute("opacity", (0.5 + 0.5 * sm.Cof).toFixed(2));
  layers.blockX.setAttribute("opacity", clamp(1 - sm.mal * 0.9).toFixed(2));
  rowRects.forEach(function (r, i) { const act = i === m.t; r.setAttribute("opacity", act ? (0.55 + 0.45 * (0.35 + 0.65 * sm.Syn)).toFixed(2) : "0.35"); r.style.strokeWidth = act ? "2" : "1"; });
  rowIcons.forEach(function (c, i) { const act = i === m.t; c.setAttribute("r", f1(act ? 13 + 3 * sm.Syn * (1 + 0.12 * Math.sin(tm / 300)) : 13)); c.setAttribute("opacity", act ? "1" : "0.55"); });
  /* vitamin supply: diet to gut to cofactor badge */
  acc.vit += dt * (1 + 6 * sm.Cof); while (acc.vit >= 1) { acc.vit--; const p = freeP(vitP); if (p) emit(p, 85, 168, 85, 238, 0); }
  seek(vitP, dt, 68, function (p) { if (p.k === 0) { p.k = 1; p.tx = 392; p.ty = 164; p.t = 0; } else kill(p); });
  /* cofactor sparks: badge down to the enzyme step */
  acc.cof += dt * (1 + 7 * sm.Cof); while (acc.cof >= 1) { acc.cof--; const p = freeP(cofP); if (p) emit(p, 408 + rnd(-8, 8), 182, 408 + rnd(-10, 10), 244, 0); }
  seek(cofP, dt, 74, function (p) { kill(p); });
  /* product: enzyme to product node, then to the active syndrome row */
  acc.prod += dt * (1 + 7 * sm.Tiss); while (acc.prod >= 1) { acc.prod--; const p = freeP(prodP); if (p) emit(p, 438, 270, 492, 270, m.t); }
  seek(prodP, dt, 80, function (p) { if (p.k < 10) { const rowCy = 131 + p.k * 44; p.k = 10 + p.k; p.tx = 600; p.ty = rowCy; p.t = 0; } else kill(p); });
  /* syndrome drops at the active row when severity is high */
  acc.drop += dt * sm.Syn * 5; while (acc.drop >= 1) { acc.drop--; const p = freeP(dropP); if (p) { const rowCy = 131 + m.t * 44; emit(p, 612 + rnd(-6, 6), rowCy + 8, 612 + rnd(-6, 6), rowCy + 15, 0); } }
  dropP.forEach(function (p) { if (!p.on) return; p.t += dt; p.y += 18 * dt; p.x = clamp(p.x, 590, 930); p.y = clamp(p.y, 52, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  /* treatment capsules: replacement source to the badge */
  acc.treat += dt * sm.eff * 5; while (acc.treat >= 1) { acc.treat--; const p = freeP(treatP); if (p) emit(p, 182, 160, 392, 160, 0); }
  seek(treatP, dt, 76, function (p) { kill(p); });
  /* gauges */
  gg.cof.set(sm.Cof, wordOf(sm.Cof, 0.35, 0.65, ["low", "reduced", "working"])); gg.tiss.set(sm.Tiss, wordOf(sm.Tiss, 0.35, 0.65, ["impaired", "reduced", "preserved"]));
  gg.syn.set(sm.Syn, wordOf(sm.Syn, 0.30, 0.60, ["mild", "moderate", "severe"])); gg.eff.set(sm.eff, wordOf(sm.eff, 0.35, 0.65, ["none", "partial", "strong"]));
}
run({ init: init, step: step });
