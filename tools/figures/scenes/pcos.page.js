/* PCOS scene: LH pulses, insulin, ovarian androgens, arrested follicles, ovulation, skin signs and gauges. */
const layers = { links: $("links"), nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- static nodes ---- */
const pit = cell(layers.nodes, { cls: "pit", r: 36, nuc: 0.4, seed: 3, wob: 0.12, x: 135, y: 150 });
const adipCells = [[95, 298], [135, 315], [175, 298], [115, 338], [160, 338]].map(function (pt, i) { return cell(layers.nodes, { cls: "adip", r: 17, nuc: 0.32, seed: i + 5, wob: 0.14, x: pt[0], y: pt[1] }); });
mk("rect", { class: "pc-block", x: 52, y: 272, width: 166, height: 92, rx: 14 }, layers.links);
const ovaryG = mk("g", {}, layers.nodes);
mk("ellipse", { class: "pc-ovary", cx: 470, cy: 235, rx: 165, ry: 108 }, ovaryG);
const folPts = [[355, 175], [405, 145], [475, 140], [545, 150], [590, 190], [580, 265], [525, 315], [455, 325], [385, 300], [350, 235]];
const fols = folPts.map(function (pt, i) { const g = cell(layers.nodes, { cls: "fol", r: 16, nuc: 0.35, seed: i + 11, wob: 0.1, x: pt[0], y: pt[1] }); return { g: g, x: pt[0], y: pt[1], i: i }; });
const dom = cell(layers.nodes, { cls: "dom", r: 24, nuc: 0.3, seed: 7, wob: 0.08, x: 470, y: 235 });
const egg = mk("circle", { class: "pc-egg", r: 7, cx: 470, cy: 235, opacity: "0" }, layers.nodes);
/* skin and hair node */
mk("rect", { class: "pc-skin", x: 742, y: 158, width: 148, height: 98, rx: 12 }, layers.nodes);
const seb1 = mk("ellipse", { class: "pc-seb", cx: 790, cy: 205, rx: 12, ry: 8 }, layers.nodes);
const seb2 = mk("ellipse", { class: "pc-seb", cx: 842, cy: 205, rx: 12, ry: 8 }, layers.nodes);
const hair1 = mk("path", { class: "pc-hair", d: "M790 198 L782 168" }, layers.nodes);
const hair2 = mk("path", { class: "pc-hair", d: "M816 200 L816 164" }, layers.nodes);
const hair3 = mk("path", { class: "pc-hair", d: "M842 198 L850 168" }, layers.nodes);
/* womb node */
mk("path", { class: "pc-ut", d: "M772 292 L858 292 L848 348 L782 348 Z" }, layers.nodes);
const endoBar = mk("rect", { class: "pc-endo", x: 788, y: 300, width: 54, height: 8, rx: 4 }, layers.nodes);
/* links */
mk("path", { class: "pc-link", d: "M172 150 C240 150 260 185 310 205" }, layers.links);
mk("path", { class: "pc-link", d: "M218 315 C260 315 275 285 312 262" }, layers.links);
mk("path", { class: "pc-link", d: "M635 225 C680 220 700 212 742 208" }, layers.links);
mk("path", { class: "pc-link", d: "M610 285 C670 305 710 315 772 318" }, layers.links);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const lhP = pool(22, function () { return mk("circle", { class: "sc-p p-lh", r: 3 }, layers.parts); });
const insP = pool(20, function () { return mk("circle", { class: "sc-p p-ins", r: 3 }, layers.parts); });
const andP = pool(24, function () { return mk("path", { class: "sc-p p-and", d: "M0 -3.4L3 2L-3 2Z" }, layers.parts); });
const trP = pool(12, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-treat", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function fly(pl, tx, ty, sp, dt) { pl.forEach(function (p) { if (!p.on) return; const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 14) kill(p); }); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The person";
  [["lh", "LH", "g-lh", "Luteinising hormone from the pituitary. In PCOS its pulses are stronger, driving ovarian androgen production."], ["ir", "Insulin resist.", "g-ins", "Insulin resistance: tissues respond less to insulin, so more insulin circulates and acts on the ovary."], ["and", "Androgens", "g-and", "Ovarian androgen excess, driven by LH together with insulin. Androgens arrest follicles and act on skin and hair."], ["ovu", "Ovulation", "g-good", "Release of an egg. Arrested follicles mean ovulation is infrequent and periods are irregular."], ["sgn", "Skin and hair", "g-sgn", "Acne and extra hair growth (hirsutism) from androgens acting on skin and hair follicles."], ["met", "Metabolic risk", "g-met", "Longer term metabolic risk linked to insulin resistance, including diabetes risk."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Pituitary LH", 135, 112, 135, 84, "Pituitary gland: releases LH in pulses. In PCOS the pulses are stronger and LH is raised relative to FSH.");
  pill(ox, "Ovary", 470, 127, 470, 84, "Ovary: LH and insulin drive its outer theca cells to make androgens. Follicles start to grow then stall.");
  pill(ox, "Skin and hair", 816, 158, 816, 84, "Skin and hair follicles: androgens increase sebum (acne) and turn fine hair thicker and darker (hirsutism).");
  pill(ox, "Insulin resistance", 135, 364, 135, 392, "Muscle and fat tissue respond less to insulin. The pancreas makes more insulin, which also acts on the ovary.");
  pill(ox, "Arrested follicles", 385, 300, 360, 392, "Many small follicles collect in the ovary because growth stalls before one becomes dominant. These are the so called cysts.");
  pill(ox, "Womb lining", 815, 350, 815, 392, "Womb lining: without regular ovulation it is not shed regularly, so periods are infrequent and the lining can build up.");
}
const sm = { LH: 0.5, IR: 0.5, A: 0.4, F: 0.4, O: 0.4, Sg: 0.3, M: 0.4 };
const acc = { lh: 0, ins: 0, and: 0, tr: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const drugNow = m.drug || 0;
  const k = Math.min(1, dt * 0.7);
  sm.LH = lerp(sm.LH, m.LH, k); sm.IR = lerp(sm.IR, m.IR, k); sm.A = lerp(sm.A, m.A, k); sm.F = lerp(sm.F, m.F, k); sm.O = lerp(sm.O, m.O, k); sm.Sg = lerp(sm.Sg, m.Sg, k); sm.M = lerp(sm.M, m.M, k);
  place(pit, 135, 150 + Math.sin(tm / 1200) * 2, 0, 1 + 0.05 * sm.LH * Math.sin(tm / 280));
  fols.forEach(function (fo, i) { const s = 0.35 + 0.75 * sm.F * (0.7 + 0.3 * Math.sin(tm / 900 + i)); place(fo.g, fo.x, fo.y, 0, clamp(s, 0.2, 1.15)); fo.g.style.opacity = sm.F > 0.12 ? 1 : 0.25; });
  const domS = clamp(0.45 + 0.85 * sm.O, 0.3, 1.35);
  place(dom, 470, 235, 0, domS);
  const cyc = (tm % 5200) / 5200;
  if (sm.O > 0.35) { const ex = 470 + cyc * 150, ey = 235 - Math.sin(cyc * 3.14) * 34; egg.setAttribute("cx", f1(ex)); egg.setAttribute("cy", f1(ey)); egg.setAttribute("opacity", (sm.O * (cyc < 0.85 ? 1 : 0)).toFixed(2)); } else egg.setAttribute("opacity", "0");
  const hs = 0.6 + 0.7 * sm.Sg;
  hair1.setAttribute("transform", "translate(790 198) scale(1 " + hs.toFixed(2) + ") translate(-790 -198)");
  hair2.setAttribute("transform", "translate(816 200) scale(1 " + hs.toFixed(2) + ") translate(-816 -200)");
  hair3.setAttribute("transform", "translate(842 198) scale(1 " + hs.toFixed(2) + ") translate(-842 -198)");
  seb1.setAttribute("rx", f1(8 + 7 * sm.Sg)); seb2.setAttribute("rx", f1(8 + 7 * sm.Sg));
  endoBar.setAttribute("height", f1(5 + 13 * clamp(1 - sm.O)));
  acc.lh += dt * sm.LH * 7; while (acc.lh >= 1) { acc.lh--; const p = freeP(lhP); if (p) emit(p, 172, 150 + rnd(-8, 8), 0, 0, 0); }
  fly(lhP, 318, 205, 95, dt);
  acc.ins += dt * sm.IR * 7; while (acc.ins >= 1) { acc.ins--; const p = freeP(insP); if (p) emit(p, 218, 315 + rnd(-10, 10), 0, 0, 0); }
  fly(insP, 320, 262, 95, dt);
  acc.and += dt * sm.A * 8; while (acc.and >= 1) { acc.and--; const p = freeP(andP); if (p) emit(p, 628, 228 + rnd(-14, 14), 0, 0, 0); }
  fly(andP, 748, 208, 105, dt);
  andP.forEach(function (p) { if (p.on) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); });
  acc.tr += dt * (drugNow > 0 ? 2.2 : 0); while (acc.tr >= 1) { acc.tr--; const p = freeP(trP); if (p) emit(p, drugNow === 3 ? 640 : 60, drugNow === 3 ? 120 : 250, 0, 0, drugNow); }
  trP.forEach(function (p) { if (!p.on) return; const tx = p.k === 3 ? 500 : 135, ty = p.k === 3 ? 215 : 300, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 80 * dt; p.y += (dy / d) * 80 * dt; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (d < 16 || p.t > 6) kill(p); });
  gg.lh.set(sm.LH, wordOf(sm.LH, 0.35, 0.62, ["normal", "raised", "high"])); gg.ir.set(sm.IR, wordOf(sm.IR, 0.3, 0.58, ["low", "raised", "high"])); gg.and.set(sm.A, wordOf(sm.A, 0.3, 0.55, ["mild", "raised", "high"]));
  gg.ovu.set(sm.O, wordOf(sm.O, 0.3, 0.6, ["rare", "irregular", "regular"])); gg.sgn.set(sm.Sg, wordOf(sm.Sg, 0.3, 0.55, ["mild", "moderate", "marked"])); gg.met.set(sm.M, wordOf(sm.M, 0.3, 0.55, ["low", "raised", "high"]));
}
run({ init: init, step: step });
