/* Addison scene: two failing routes to cortisol loss, hormone streams, skin, kidney, vessels and the gauges. */
const L = { left: $("left"), right: $("right"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LC = 250, RC = 720;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const acth = pool(22, () => mk("circle", { class: "sc-p p-acth", r: 2.6 }, L.parts));
const cort = pool(30, () => mk("circle", { class: "sc-p p-cort", r: 2.6 }, L.parts));
const aldo = pool(22, () => mk("rect", { class: "sc-p p-aldo", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, L.parts));
const hydro = pool(8, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const fluid = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const cols = [];
function buildColumn(parent, cx, primary) {
  const g = {};
  g.pit = cell(parent, { cls: "pit", r: 17, nuc: 0.4, seed: primary ? 3 : 8, wob: 0.1 });
  place(g.pit, cx, 112, 0, 1);
  g.arrow = mk("path", { class: "ad-arrow", d: "M" + (cx + 20) + " 134V202M" + (cx + 14) + " 194l6 10l6 -10" }, parent);
  g.adr = mk("g", {}, parent);
  mk("ellipse", { class: "ad-adr", rx: 42, ry: 21, transform: "rotate(-12)" }, g.adr);
  mk("ellipse", { class: "ad-adr-in", rx: 28, ry: 12, transform: "rotate(-12)" }, g.adr);
  mk("ellipse", { class: "ad-med", rx: 13, ry: 6, transform: "rotate(-12)" }, g.adr);
  g.crack = mk("path", { class: "ad-crack", d: "M-26 -8l12 7l-8 6l14 5", opacity: "0" }, g.adr);
  g.imm = [];
  if (primary) [[-50, -16], [48, -20], [-6, -34]].forEach(([u, v], i) => { const c = cell(parent, { cls: "imm", r: 8, nuc: 0.45, seed: i + 4, wob: 0.14 }); g.imm.push({ c, u, v, i }); });
  g.kid = mk("g", {}, parent);
  mk("ellipse", { class: "ad-kidney", rx: 50, ry: 34 }, g.kid);
  mk("circle", { class: "ad-notch", cx: 42, cy: 0, r: 13, fill: "var(--anatomy-paper)" }, g.kid);
  place(g.kid, cx, 292, 0, 1);
  g.skin = mk("g", {}, parent);
  mk("rect", { class: "ad-skin", x: cx + 78, y: 248, width: 62, height: 46, rx: 10 }, g.skin);
  g.pig = mk("rect", { class: "ad-pig", x: cx + 78, y: 248, width: 62, height: 46, rx: 10, opacity: "0" }, g.skin);
  g.ves = mk("rect", { class: "ad-vessel", x: cx - 115, y: 370, width: 230, height: 24, rx: 12 }, parent);
  g.rbcs = [];
  for (let i = 0; i < 6; i++) { const r = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx: 7.5, ry: 4.4 }, r); mk("ellipse", { class: "cl-s", rx: 2.8, ry: 1.4 }, r); g.rbcs.push({ g: r, x: cx - 100 + i * 36, v: rnd(0.85, 1.15) }); }
  g.cx = cx; g.primary = primary;
  cols.push(g); return g;
}
const gg = {};
let tpHydro, tpFlud, tpFluid;
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cort", "Cortisol", "g-glu", "Cortisol from the adrenal cortex. It supports blood pressure, glucose and the response to stress. It is low in both primary and secondary disease."], ["aldo", "Aldosterone", "g-aldo", "Aldosterone from the outer cortex in primary disease. It holds salt and water and removes potassium. In secondary disease it is largely kept, so this gauge follows the primary gland."], ["bp", "Pressure", "g-good", "Blood pressure. It falls when cortisol and aldosterone are lost and circulating volume shrinks."], ["na", "Sodium", "g-na", "Blood sodium. It falls when aldosterone is lost and salt and water escape through the kidney."], ["k", "Potassium", "g-k", "Blood potassium. It rises when aldosterone is lost, because the kidney cannot remove it."], ["glu", "Glucose", "g-glu", "Blood glucose. It falls when cortisol is low, because cortisol normally supports glucose making in the liver."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function init() {
  buildColumn(L.left, LC, true); buildColumn(L.right, RC, false);
  const o = L.over;
  pill(o, "Pituitary", LC - 15, 98, 110, 88, "The pituitary gland. When cortisol falls in primary disease it releases more ACTH, trying to drive the failing gland.");
  pill(o, "ACTH high", LC + 20, 150, 360, 88, "ACTH is high in primary adrenal insufficiency. The pituitary senses low cortisol and pushes harder. ACTH also drives the pigmentation seen in primary disease.");
  pill(o, "Adrenalitis", LC - 48, 214, 110, 195, "Autoimmune adrenalitis: immune cells attack and destroy the adrenal cortex. This is the commonest cause of primary adrenal insufficiency.");
  pill(o, "Cortisol", LC + 38, 222, 370, 195, "Cortisol made in the middle cortex layer. It is low here because the gland itself is destroyed.");
  pill(o, "Aldosterone low", LC - 35, 285, 120, 335, "Aldosterone from the outer cortex layer is lost in primary disease. Salt and water escape, potassium builds up, and blood pressure falls.");
  pill(o, "Pigmentation", LC + 110, 250, 360, 335, "Darkened skin in primary disease. High ACTH comes from the same precursor as melanocyte stimulating hormone, so the skin darkens, including in skin creases and scars.");
  pill(o, "Blood vessel", LC - 70, 382, 150, 412, "Blood vessels need cortisol to respond and hold their tone. With cortisol and volume lost, the vessel relaxes and pressure falls.");
  pill(o, "ACTH low", RC + 20, 150, 610, 88, "ACTH is low in secondary adrenal insufficiency. The pituitary cannot drive the gland, so cortisol falls even though the gland could work.");
  pill(o, "Pituitary", RC + 15, 98, 830, 88, "The pituitary gland in secondary disease. It makes too little ACTH, from pituitary or hypothalamic disease or long steroid treatment suppressing the axis.");
  pill(o, "Gland shrinks", RC - 38, 214, 590, 195, "Without ACTH the cortex shrinks (atrophy). Cortisol falls, but the outer aldosterone layer is driven mainly by other signals and keeps working.");
  pill(o, "Cortisol", RC + 38, 222, 850, 195, "Cortisol made in the middle cortex layer. It is low here because ACTH drive is missing.");
  pill(o, "Aldosterone kept", RC - 30, 285, 600, 335, "Aldosterone is largely kept in secondary disease, because it is controlled mainly by the renin angiotensin system and potassium. Salt loss and high potassium are therefore much less marked.");
  pill(o, "No pigmentation", RC + 110, 250, 840, 335, "No pigmentation in secondary disease. ACTH is low, so there is no extra melanocyte stimulation and the skin stays pale.");
  pill(o, "Blood vessel", RC - 70, 382, 650, 412, "Blood vessels need cortisol to hold their tone. Pressure can fall in secondary disease too, but volume and potassium problems are milder.");
  tpHydro = pill(o, "Hydrocortisone", 480, 228, 480, 88, "Hydrocortisone is cortisol replacement. It restores cortisol for pressure, glucose and the stress response.");
  tpFlud = pill(o, "Fludrocortisone", LC + 35, 300, 480, 195, "Fludrocortisone is aldosterone replacement for primary disease. It holds salt and water and brings potassium down.");
  tpFluid = pill(o, "IV fluids", 480, 382, 480, 335, "Intravenous fluids refill the circulating volume in a crisis, alongside hydrocortisone.");
  tpHydro.setAttribute("id", "tp-hydro"); tpFlud.setAttribute("id", "tp-flud"); tpFluid.setAttribute("id", "tp-fluid");
  initPanel();
}
const sm = { Cort: 0.3, AldoP: 0.26, AldoS: 0.7, BP: 0.5, Na: 0.5, K: 0.6, Glu: 0.5, deficit: 0.4, acthP: 0.5, acthS: 0.15, pig: 0.4, a: 0.35, hydroAmt: 0, flud: 0, fluids: 0 };
const acc = { aL: 0, aR: 0, cL: 0, cR: 0, alL: 0, alR: 0, hy: 0, fl: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Cort = lerp(sm.Cort, m.Cort, k2); sm.AldoP = lerp(sm.AldoP, m.AldoP, k2); sm.AldoS = lerp(sm.AldoS, m.AldoS, k2);
  sm.BP = lerp(sm.BP, m.BP, k1); sm.Na = lerp(sm.Na, m.Na, k2); sm.K = lerp(sm.K, m.K, k2); sm.Glu = lerp(sm.Glu, m.Glu, k2);
  sm.deficit = lerp(sm.deficit, m.deficit, k2); sm.acthP = lerp(sm.acthP, m.acthP, k2); sm.acthS = lerp(sm.acthS, m.acthS, k2);
  sm.pig = lerp(sm.pig, m.pig, k2); sm.a = lerp(sm.a, m.a, k2); sm.hydroAmt = lerp(sm.hydroAmt, m.hydro, k1); sm.flud = lerp(sm.flud, m.flud, k1); sm.fluids = lerp(sm.fluids, m.fluids, k1);
  cols.forEach((c) => {
    const acth = c.primary ? sm.acthP : sm.acthS;
    place(c.pit, c.cx, 112, 0, 1 + 0.08 * acth * Math.sin(tm / 320));
    c.arrow.setAttribute("opacity", (0.25 + 0.75 * acth).toFixed(2));
    const shrink = c.primary ? 1 - 0.1 * sm.a : 1 - 0.26 * sm.a;
    place(c.adr, c.cx, 228, -4 + Math.sin(tm / 900 + c.cx) * 2, shrink);
    c.crack.setAttribute("opacity", c.primary ? (0.25 + 0.75 * sm.a).toFixed(2) : "0");
    c.imm.forEach((im) => place(im.c, c.cx + im.u, 228 + im.v, Math.sin(tm / 400 + im.i) * 14, 0.9 + 0.25 * sm.a * Math.sin(tm / 300 + im.i)));
    c.pig.setAttribute("opacity", c.primary ? (sm.pig * 0.82).toFixed(2) : "0.04");
    const flow = clamp(0.2 + 0.9 * sm.BP);
    c.rbcs.forEach((r) => { r.x += r.v * 52 * flow * dt; if (r.x > c.cx + 106) r.x = c.cx - 106; place(r.g, r.x, 382, Math.sin(tm / 500 + r.x) * 8, 1); });
  });
  acc.aL += dt * sm.acthP * 7; while (acc.aL >= 1) { acc.aL--; const p = free(acth); if (p) emit(p, LC + 20, 136, 0, 46, 0); }
  acc.aR += dt * sm.acthS * 7; while (acc.aR >= 1) { acc.aR--; const p = free(acth); if (p) emit(p, RC + 20, 136, 0, 46, 1); }
  acth.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 208) kill(p); });
  acc.cL += dt * sm.Cort * 9; while (acc.cL >= 1) { acc.cL--; const p = free(cort); if (p) emit(p, LC + 24, 232, rnd(8, 22), rnd(24, 38), 0); }
  acc.cR += dt * sm.Cort * 9; while (acc.cR >= 1) { acc.cR--; const p = free(cort); if (p) emit(p, RC + 24, 232, rnd(8, 22), rnd(24, 38), 1); }
  cort.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 362) kill(p); });
  acc.alL += dt * sm.AldoP * 8; while (acc.alL >= 1) { acc.alL--; const p = free(aldo); if (p) emit(p, LC - 16, 242, rnd(-4, 4), 34, 0); }
  acc.alR += dt * sm.AldoS * 8; while (acc.alR >= 1) { acc.alR--; const p = free(aldo); if (p) emit(p, RC - 16, 242, rnd(-4, 4), 34, 1); }
  aldo.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 282) kill(p); });
  acc.hy += dt * clamp(sm.hydroAmt * 2.2); while (acc.hy >= 1) { acc.hy--; const p = free(hydro); if (p) emit(p, 480, 118, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  hydro.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? RC : LC, ty = 218; p.x += (tx - p.x) * dt * 0.9; p.y += (ty - p.y) * dt * 0.9 + 12 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6) kill(p); });
  acc.fl += dt * sm.fluids * 7; while (acc.fl >= 1) { acc.fl--; const p = free(fluid); if (p) emit(p, (Math.random() < 0.5 ? LC : RC) - 108, 382, 76, 0, 0); }
  fluid.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > LC + 108 && p.x < RC - 108) kill(p); if (p.x > RC + 108) kill(p); });
  $("tp-hydro").style.opacity = clamp(sm.hydroAmt * 2.4).toFixed(2);
  $("tp-flud").style.opacity = sm.flud.toFixed(2);
  $("tp-fluid").style.opacity = sm.fluids.toFixed(2);
  gg.cort.set(sm.Cort, wordOf(sm.Cort, 0.35, 0.6, ["low", "reduced", "ok"]));
  gg.aldo.set(sm.AldoP, wordOf(sm.AldoP, 0.3, 0.6, ["low", "reduced", "ok"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.38, 0.65, ["low", "borderline", "ok"]));
  gg.na.set(sm.Na, wordOf(sm.Na, 0.45, 0.65, ["low", "reduced", "normal"]));
  gg.k.set(sm.K, wordOf(sm.K, 0.38, 0.6, ["normal", "raised", "high"]));
  gg.glu.set(sm.Glu, wordOf(sm.Glu, 0.45, 0.65, ["low", "reduced", "normal"]));
}
run({ init, step });
