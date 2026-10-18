/* Phaeochromocytoma scene: chromaffin tumour, catecholamines, alpha vessel squeeze, beta heart effects, sweating, headache and gauges. */
const layers = { tum: $("tumourG"), wallT: $("wallTop"), wallB: $("wallBot"), rbc: $("rbcs"), heart: $("heartG"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("pheLumen"), rays: $("headRays") };
const tumCells = [];
const tumG = (function () { const big = cell(layers.tum, { cls: "phetum", r: 38, nuc: 0.42, seed: 3, wob: 0.12 }); const offs = [[-18, -10], [16, -14], [-8, 14], [20, 10], [-24, 8], [4, -2]];
  offs.forEach(function (o, i) { tumCells.push(cell(layers.tum, { cls: "phetum", r: 9, nuc: 0.4, seed: i + 7, wob: 0.16, x: o[0], y: o[1] })); }); return big; })();
place(layers.tum, 150, 214, 0, 1);
const wallCells = { top: [], bot: [] };
for (let wi = 0; wi < 12; wi++) { const wx = 322 + wi * 25;
  wallCells.top.push(cell(layers.wallT, { cls: "phewall", r: 11, nuc: 0.3, seed: wi + 2, wob: 0.08, n: 8, x: wx, y: 184 }));
  wallCells.bot.push(cell(layers.wallB, { cls: "phewall", r: 11, nuc: 0.3, seed: wi + 30, wob: 0.08, n: 8, x: wx, y: 240 })); }
const heartG = (function () { const g = mk("g", {}, layers.heart);
  mk("path", { class: "phe-heart", d: "M0 24 C-34 4 -28 -28 -9 -28 C-3 -28 0 -20 0 -15 C0 -20 3 -28 9 -28 C28 -28 34 4 0 24Z" }, g);
  mk("ellipse", { class: "phe-heart-h", cx: -10, cy: -12, rx: 7, ry: 10, transform: "rotate(-18 -10 -12)" }, g); return g; })();
const rbcs = [];
for (let ri = 0; ri < 12; ri++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g: g, x: rnd(316, 604), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const catTrk = track([[196, 212], [308, 212], [608, 212], [700, 202], [742, 192]]);
const metTrk = track([[196, 224], [308, 224], [608, 224], [690, 214], [730, 204]]);
const cats = pool(30, function () { return mk("path", { class: "sc-p p-cat", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts); });
const mets = pool(18, function () { return mk("circle", { class: "sc-p p-met", r: 2.6 }, layers.parts); });
const sweats = pool(20, function () { return mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const bolus = pool(14, function () { return mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cat", "Catecholamines", "g-cyt", "Adrenaline and noradrenaline released by the tumour into the blood."], ["bp", "Pressure", "g-bad", "Blood pressure. Alpha vasoconstriction raises it; alpha blockade lowers it."], ["hr", "Heart", "g-bad", "Heart rate and force from beta receptor action: palpitations when high."], ["sw", "Sweating", "g-sweat", "Sweating during a spell, part of the classic triad with palpitations and headache."], ["hd", "Headache", "g-head", "Throbbing headache during a surge, following the pressure rise."], ["met", "Metanephrines", "g-met", "Breakdown products measured in plasma or urine as the first biochemical test. Blockers treat effects without lowering this; removing the tumour does."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Adrenal tumour", 150, 182, 150, 118, "Phaeochromocytoma: a catecholamine secreting tumour of chromaffin cells in the adrenal medulla. Related tumours outside the adrenal are paragangliomas.");
  pill(ox, "Catecholamines", 238, 200, 325, 148, "Adrenaline and noradrenaline released in bursts, then carried in the blood to alpha and beta receptors.");
  pill(ox, "Vessel squeeze", 460, 186, 470, 148, "Alpha receptor activation constricts the vessel wall. Pressure rises; alpha blockade relaxes this squeeze.");
  pill(ox, "Heart", 770, 158, 738, 112, "Beta receptor activation speeds and strengthens the heartbeat, felt as palpitations. Beta blockade slows it, but only after alpha blockade.");
  const bp2 = pill(ox, "Beta blocker", 800, 176, 866, 112, "A beta blocker added only after alpha blockade. Given alone it can leave alpha vasoconstriction unopposed and worsen hypertension."); bp2.setAttribute("id", "phe-beta-pill");
  pill(ox, "Headache", 430, 312, 430, 292, "Throbbing headache during a paroxysm, part of the classic triad with palpitations and sweating.");
  const ap = pill(ox, "Alpha blockade", 520, 238, 576, 292, "Alpha blockade first: relaxes vessels and lets circulating volume recover before any beta blocker or surgery."); ap.setAttribute("id", "phe-alpha-pill");
  pill(ox, "Sweat gland", 800, 320, 800, 292, "Sweat glands activated during a spell. Sweating with palpitations and headache suggests a catecholamine surge.");
  pill(ox, "Metanephrines", 196, 232, 128, 408, "First test: plasma or urinary metanephrines, highly sensitive for PPGLs. Imaging of the adrenal follows biochemical proof, not the other way round.");
  pill(ox, "MEN2 VHL NF1", 182, 240, 302, 408, "Inherited associations include MEN2, von Hippel Lindau disease and neurofibromatosis type 1. Genetic testing and family screening are part of care after diagnosis.");
}
const sm = { rel: 0.4, alpha: 0.4, betaH: 0.4, bp: 0.5, hr: 0.4, sweat: 0.3, head: 0.3, met: 0.4, ab: 0, bb: 0, surg: 0, sup: 0 };
const acc = { cat: 0, met: 0, sweat: 0, bolus: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.rel = lerp(sm.rel, m.rel, k2); sm.alpha = lerp(sm.alpha, m.alpha, k1); sm.betaH = lerp(sm.betaH, m.betaH, k2);
  sm.bp = lerp(sm.bp, m.bp, k1); sm.hr = lerp(sm.hr, m.hr, k1); sm.sweat = lerp(sm.sweat, m.sweat, k2);
  sm.head = lerp(sm.head, m.head, k2); sm.met = lerp(sm.met, m.met, k2);
  sm.ab = lerp(sm.ab, m.ab, k1); sm.bb = lerp(sm.bb, m.bb, k1); sm.surg = lerp(sm.surg, m.surg, k2); sm.sup = lerp(sm.sup, m.sup, k1);
  const tumS = (1 - 0.82 * sm.surg) * (1 + 0.07 * sm.rel * Math.sin(tm / 280));
  place(layers.tum, 150, 214, Math.sin(tm / 2400) * 3, Math.max(0.12, tumS));
  layers.tum.style.opacity = (1 - 0.25 * sm.surg).toFixed(2);
  tumCells.forEach(function (c, i) { c.style.opacity = (0.55 + 0.45 * sm.rel * (0.5 + 0.5 * Math.sin(tm / 240 + i * 1.3))).toFixed(2); });
  const hh = 24 - 11 * sm.alpha;
  layers.lumen.setAttribute("y", f1(212 - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  wallCells.top.forEach(function (c, i) { place(c, 322 + i * 25, 212 - hh - 5 + Math.sin(tm / 700 + i) * 0.7, 0, 1); });
  wallCells.bot.forEach(function (c, i) { place(c, 322 + i * 25, 212 + hh + 5 + Math.sin(tm / 700 + i + 2) * 0.7, 0, 1); });
  const beat = 1 + (0.04 + 0.13 * sm.hr) * Math.max(0, Math.sin(tm / (210 - 90 * sm.hr)));
  place(heartG, 770, 188, Math.sin(tm / 900) * 2, beat);
  layers.rays.setAttribute("opacity", (sm.head * (0.55 + 0.45 * Math.sin(tm / 200))).toFixed(2));
  const flow = clamp(0.3 + 0.8 * sm.bp);
  rbcs.forEach(function (r) { r.x += r.v * 62 * flow * dt; if (r.x > 604) { r.x = 316; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, 212 + r.y * Math.max(6, hh - 8), r.rot, 1); });
  acc.cat += dt * sm.rel * 11; while (acc.cat >= 1) { acc.cat--; const p = freeP(cats); if (p) { emitP(p, 196, 212, 0, 0); } }
  cats.forEach(function (p) { if (!p.on) return; p.u += dt * (0.1 + 0.16 * sm.bp); if (p.u >= 1) { killP(p); return; } const q = catTrk.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 6) + ")"); });
  acc.met += dt * sm.met * 5; while (acc.met >= 1) { acc.met--; const p = freeP(mets); if (p) { emitP(p, 196, 224, 0, 0); } }
  mets.forEach(function (p) { if (!p.on) return; p.u += dt * 0.09; if (p.u >= 1) { killP(p); return; } const q = metTrk.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.sweat += dt * sm.sweat * 7; while (acc.sweat >= 1) { acc.sweat--; const p = freeP(sweats); if (p) emitP(p, pick([706, 800, 890]) + rnd(-6, 6), 316, rnd(-3, 3), -rnd(12, 20)); }
  sweats.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 668, 924)) + " " + f1(clamp(p.y, 282, 318)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) killP(p); });
  acc.bolus += dt * sm.sup * 6; while (acc.bolus >= 1) { acc.bolus--; const p = freeP(bolus); if (p) emitP(p, 318, 212 + rnd(-hh + 8, hh - 8), 80, 0); }
  bolus.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 604) killP(p); });
  const apEl = $("phe-alpha-pill"), bpEl = $("phe-beta-pill");
  if (apEl) apEl.style.opacity = sm.ab.toFixed(2);
  if (bpEl) bpEl.style.opacity = sm.bb.toFixed(2);
  gg.cat.set(sm.rel, wordOf(sm.rel, 0.3, 0.7, ["quiet", "surging", "flooding"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.45, 0.68, ["normal", "raised", "very high"]));
  gg.hr.set(sm.hr, wordOf(sm.hr, 0.4, 0.65, ["calm", "racing", "pounding"]));
  gg.sw.set(sm.sweat, wordOf(sm.sweat, 0.3, 0.6, ["dry", "moist", "drenched"]));
  gg.hd.set(sm.head, wordOf(sm.head, 0.3, 0.6, ["none", "mild", "throbbing"]));
  gg.met.set(sm.met, wordOf(sm.met, 0.3, 0.65, ["normal", "raised", "high"]));
}
run({ init: init, step: step });
