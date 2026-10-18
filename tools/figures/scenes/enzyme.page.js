/* Enzyme scene: substrate converted to product, inhibitor docking, Michaelis-Menten and Lineweaver-Burk plots, gauges. */
const WW = SC.W;
const layers = { main: $("enzMain"), parts: $("parts"), over: $("over"), panel: $("panel") };
const ENZ = { x: 112, y: 182, actX: 132, actY: 170, alloX: 88, alloY: 202, modX: 112, modY: 214 };
const enzG = cell(layers.main, { cls: "enz", r: 34, nuc: 0, seed: 3, wob: 0.12 });
mk("circle", { class: "enz-act", cx: 20, cy: -12, r: 9 }, enzG);
mk("circle", { class: "enz-site", cx: -24, cy: 20, r: 7 }, enzG);
mk("circle", { class: "enz-site", cx: 0, cy: 30, r: 6 }, enzG);
place(enzG, ENZ.x, ENZ.y, 0, 1);
const vigRects = [0, 1, 2].map(function (i) { return svg.querySelector("#vig" + i + " rect"); });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const subs = pool(18, function () { return mk("circle", { class: "sc-p p-sub", r: 5 }, layers.parts); });
const prods = pool(14, function () { return mk("path", { class: "sc-p p-prod", d: "M0 -5L5 0L0 5L-5 0Z" }, layers.parts); });
const inhs = pool(6, function () { return mk("rect", { class: "sc-p p-inhp", x: -7, y: -4, width: 14, height: 8, rx: 4 }, layers.parts); });
const mods = pool(6, function () { return mk("path", { class: "sc-p p-modp", d: "M0 -5L5 4L-5 4Z" }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [180, 400, 620, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The reaction";
  [["vmax", "Max rate", "g-vmax", "Vmax: the maximum rate when the enzyme is saturated with substrate. Competitive inhibition leaves it unchanged, non-competitive inhibition lowers it."], ["km", "Km", "g-km", "Km: the substrate level at half the maximum rate. A higher Km means more substrate is needed. Competitive inhibition raises it."], ["rate", "Rate now", "g-rate", "The reaction rate at the substrate level shown. More substrate raises it until the enzyme is saturated."], ["sub", "Substrate", "g-sub", "How much substrate is present. Adding more substrate overcomes competitive inhibition but cannot restore a lowered maximum rate."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Enzyme", ENZ.x, 148, 112, 252, "The enzyme. Substrate binds at its active site (the pale pocket) and is converted to product. Other sites on its surface can bind inhibitors or modulators.");
  pill(ox, "Substrate", 200, 140, 228, 252, "Substrate: the molecule the enzyme acts on. More substrate fills more active sites and raises the rate up to the maximum.");
  pill(ox, "Inhibitor", ENZ.actX, ENZ.actY, 228, 118, "An inhibitor. Competitive inhibitors compete for the active site. Non-competitive inhibitors bind a separate site and distort the enzyme.");
  pill(ox, "Vmax", 570, 140, 520, 118, "Vmax: the maximum rate, shown by the dashed line the curve levels off at. Non-competitive inhibition lowers it, competitive inhibition does not.");
  pill(ox, "Km", 442, 203, 505, 228, "Km: the substrate level at half the maximum rate, marked by the dot on the curve. Competitive inhibition moves it to the right (higher Km).");
  pill(ox, "Reciprocal", 720, 170, 800, 122, "Lineweaver-Burk plot: 1/rate against 1/substrate. It is a straight line. Where it meets the vertical axis shows 1/Vmax, and its steepness shows Km.");
}
const sm = { Vmax: 0.86, KmN: 0.32, Rate: 0.45, Sub: 0.38, SubG: 0.45, KmG: 0.4, comp: 0, nonc: 0, modu: 0 };
const acc = { sub: 0, inh: 0, mod: 0 };
function mmPath(Vmax, KmN) { let d = ""; for (let i = 0; i <= 24; i++) { const s = i / 24, v = Vmax * s / (KmN + s), x = 368 + 232 * s, y = 262 - 138 * v; d += (i ? "L" : "M") + f1(x) + " " + f1(y); } return d; }
function lbPath(Vmax, KmN) { const ss = [1, 0.7, 0.45, 0.3, 0.2, 0.14]; let d = ""; ss.forEach(function (s, i) { const invS = 1 / s, invV = (KmN / Vmax) * invS + 1 / Vmax; const x = clamp(692 + (invS - 1) / 6.14 * 208, 692, 900), y = clamp(262 - (invV - 1) / 6 * 138, 126, 260); d += (i ? "L" : "M") + f1(x) + " " + f1(y); }); return d; }
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Vmax = lerp(sm.Vmax, m.Vmax, k2); sm.KmN = lerp(sm.KmN, m.KmN, k2); sm.Rate = lerp(sm.Rate, m.Rate, k1); sm.Sub = lerp(sm.Sub, m.Sub, k1); sm.SubG = lerp(sm.SubG, m.SubG, k1); sm.KmG = lerp(sm.KmG, m.KmG, k2); sm.comp = lerp(sm.comp, m.comp, k1); sm.nonc = lerp(sm.nonc, m.nonc, k1); sm.modu = lerp(sm.modu, m.modu, k1);
  /* enzyme pulses faster when the rate is high; modulator enlarges it a little */
  const es = 0.94 + 0.1 * sm.Rate + 0.07 * sm.modu + 0.02 * Math.sin(tm / 300);
  place(enzG, ENZ.x + Math.sin(tm / 1600) * 2, ENZ.y + Math.cos(tm / 1900) * 2, Math.sin(tm / 2400) * 5, es);
  vigRects.forEach(function (r, i) { if (r) r.setAttribute("opacity", ((i === 0 && sm.comp > 0.5) || (i === 1 && sm.nonc > 0.5)) ? "0.9" : "0"); });
  /* plots: current curve and line against the faint no-inhibitor baseline */
  $("mmCur").setAttribute("d", mmPath(sm.Vmax, sm.KmN)); $("mmBase").setAttribute("d", mmPath(0.86, 0.32));
  $("lbCur").setAttribute("d", lbPath(sm.Vmax, sm.KmN)); $("lbBase").setAttribute("d", lbPath(0.86, 0.32));
  $("mmVmax").setAttribute("y1", f1(262 - 138 * sm.Vmax)); $("mmVmax").setAttribute("y2", f1(262 - 138 * sm.Vmax));
  const kmDot = $("mmKmDot"); kmDot.setAttribute("cx", f1(368 + 232 * Math.min(1, sm.KmN))); kmDot.setAttribute("cy", f1(262 - 138 * sm.Vmax / 2));
  const opDot = $("mmOpDot"); opDot.setAttribute("cx", f1(368 + 232 * sm.Sub)); opDot.setAttribute("cy", f1(262 - 138 * sm.Vmax * sm.Sub / (sm.KmN + sm.Sub)));
  $("lbInt").setAttribute("cy", f1(clamp(262 - (1 / sm.Vmax - 1) / 6 * 138, 126, 260)));
  /* substrate flows in, reaches the active site, and may become product */
  acc.sub += dt * (0.7 + 2.4 * sm.Sub); while (acc.sub >= 1) { acc.sub--; const p = freeP(subs); if (p) emit(p, 36, rnd(145, 215), 0, 0, 0); }
  subs.forEach(function (p) { if (!p.on) return; p.t += dt;
    if (p.k === 2) { p.x -= 42 * dt; p.y += 18 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 34 || p.t > 3) kill(p); return; }
    const dx = ENZ.actX - p.x, dy = ENZ.actY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 55 * dt; p.y += (dy / d) * 55 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 13) { if (Math.random() < clamp(0.2 + sm.Rate * 1.1)) { const q = freeP(prods); if (q) emit(q, ENZ.actX, ENZ.actY, rnd(38, 55), rnd(-12, 16), 0); kill(p); } else { p.k = 2; p.t = 0; } } });
  prods.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 30, 294); p.y = clamp(p.y, 92, 278); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 290 || p.t > 4) kill(p); });
  /* inhibitor particles dock at the active site (competitive) or the side site (non-competitive) */
  const inhOn = sm.comp + sm.nonc;
  acc.inh += dt * inhOn * 1.6; while (acc.inh >= 1) { acc.inh--; const p = freeP(inhs); if (p) emit(p, rnd(160, 250), 96, 0, 0, 0); }
  inhs.forEach(function (p) { if (!p.on) return; const tx = sm.comp >= sm.nonc ? ENZ.actX : ENZ.alloX, ty = sm.comp >= sm.nonc ? ENZ.actY : ENZ.alloY;
    if (p.k === 1) { p.t += dt; p.x = tx; p.y = ty; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2 || inhOn < 0.2) kill(p); return; }
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 10) { p.k = 1; p.t = 0; } if (inhOn < 0.2) kill(p); });
  /* modulator particles dock underneath and boost the enzyme */
  acc.mod += dt * sm.modu * 1.6; while (acc.mod >= 1) { acc.mod--; const p = freeP(mods); if (p) emit(p, rnd(50, 180), 96, 0, 0, 0); }
  mods.forEach(function (p) { if (!p.on) return;
    if (p.k === 1) { p.t += dt; p.x = ENZ.modX; p.y = ENZ.modY; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2 || sm.modu < 0.2) kill(p); return; }
    const dx = ENZ.modX - p.x, dy = ENZ.modY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 10) { p.k = 1; p.t = 0; } if (sm.modu < 0.2) kill(p); });
  /* gauges */
  gg.vmax.set(sm.Vmax, wordOf(sm.Vmax, 0.55, 0.9, ["low", "usual", "high"])); gg.km.set(sm.KmG, wordOf(sm.KmG, 0.3, 0.65, ["low", "usual", "high"]));
  gg.rate.set(sm.Rate, wordOf(sm.Rate, 0.28, 0.52, ["slow", "usual", "fast"])); gg.sub.set(sm.SubG, wordOf(sm.SubG, 0.35, 0.7, ["low", "usual", "high"]));
}
run({ init: init, step: step });
