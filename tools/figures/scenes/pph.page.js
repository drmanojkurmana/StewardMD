/* Postpartum haemorrhage scene: contracting uterus, spiral arteries, retained tissue, tear, blood pool, clot and circulation. */
const LY = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
const W = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dropPath = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
const drops = mkPool(38, () => mk("path", { class: "p-drop", d: dropPath }, LY.parts));
const spark = mkPool(18, () => mk("circle", { class: "sc-p p-txa", r: 2.4 }, LY.parts));
const uto = mkPool(16, () => mk("circle", { class: "sc-p p-uto", r: 2.4 }, LY.parts));
let uterusG, tissueG, tearG, stitchG, poolEl, heartG, clotG, spirals = [], rbcs = [];
const gg = {};
const sm = { Contr: 0.3, Bleed: 0.6, Clot: 0.8, Press: 0.6, tissueEff: 0, traumaEff: 0, mass: 0, rep: 0, txa: 0 };
const acc = { drop: 0, spark: 0, uto: 0 };
let shownCause = -1;
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["contr", "Contraction", "g-good", "How firmly the uterus squeezes after delivery. A firm contraction compresses the spiral arteries."], ["bleed", "Bleeding", "g-bad", "How much blood is escaping. Heavy bleeding after delivery is postpartum haemorrhage."], ["clot", "Clotting", "g-clot", "How well shed blood forms a firm clot. Poor clotting is the thrombin cause."], ["press", "Pressure", "g-fl", "Blood pressure. It falls as circulating volume is lost, towards shock."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 210, y0 + 2, 52, 18, cls, name, tip); });
  const o = LY.over;
  pill(o, "Uterus", 215, 205, 110, 170, "The uterus after delivery. It must contract down firmly to squeeze the blood vessels in its wall shut.");
  pill(o, "Spiral arteries", 385, 225, 470, 170, "Spiral arteries in the uterine wall fed the placenta. After it separates they are open, and only contraction compresses them.");
  pill(o, "Retained tissue", 325, 275, 110, 300, "A piece of placenta or membrane left inside. It stops the uterus contracting fully until it is removed.");
  pill(o, "Tear", 335, 385, 470, 335, "A tear of the cervix or vagina. It bleeds even when the uterus is firm, and it needs repair.");
  pill(o, "Blood pool", 365, 420, 470, 405, "Blood that has escaped collects below. The pool grows as bleeding continues.");
  pill(o, "Circulation", 860, 285, 860, 225, "Blood moving through a vessel. As volume is lost the flow slows and blood pressure falls towards shock.");
  pill(o, "Clot", 770, 370, 880, 365, "Shed blood should form a firm clot of platelets and fibrin. In coagulopathy it stays liquid and keeps oozing.");
  const a = pill(o, "Uterotonic", 260, 180, 500, 200, "Uterine massage and a uterotonic make a soft uterus contract, squeezing the spiral arteries shut."); a.setAttribute("id", "tr-mass"); a.style.opacity = 0;
  const b = pill(o, "Repair", 335, 385, 640, 365, "Repairing a tear, or removing retained placenta, removes that source of bleeding."); b.setAttribute("id", "tr-rep"); b.style.opacity = 0;
  const c = pill(o, "Clot support", 760, 380, 740, 405, "Tranexamic acid helps a clot hold, and clotting support replaces what is missing so a firm clot can form."); c.setAttribute("id", "tr-txa"); c.style.opacity = 0;
}
function init() {
  const g = LY.stage;
  poolEl = mk("ellipse", { class: "pp-pool", cx: 300, cy: 420, rx: 60, ry: 10 }, g);
  uterusG = mk("g", {}, g);
  mk("path", { class: "pp-wall", d: "M190 190C190 148 410 148 410 190C410 260 395 310 375 345L360 375L240 375L225 345C205 310 190 260 190 190Z" }, uterusG);
  mk("path", { class: "pp-cav", d: "M215 195C215 168 385 168 385 195C385 250 375 290 360 320L350 345L250 345L240 320C225 290 215 250 215 195Z" }, uterusG);
  mk("rect", { class: "pp-cervix", x: 262, y: 370, width: 26, height: 42, rx: 7 }, uterusG);
  mk("rect", { class: "pp-cervix", x: 312, y: 370, width: 26, height: 42, rx: 7 }, uterusG);
  ["M366 202c15 4 15 17 2 19c-11 2-13-11-2-14c8-2 11 7 2 9", "M374 244c15 4 15 17 2 19c-11 2-13-11-2-14c8-2 11 7 2 9", "M226 226c-13 5-12 18 0 19c10 1 12-11 2-14c-8-2-10 7-2 9"].forEach((d) => { spirals.push(mk("path", { class: "pp-spiral", d: d }, uterusG)); });
  tissueG = mk("g", {}, uterusG);
  const tb = mk("path", { class: "pp-tissue", d: blobD(27, 5, 0.2, 8) }, tissueG);
  tb.setAttribute("transform", "translate(0 0)");
  mk("circle", { class: "pp-tissue", cx: 12, cy: 10, r: 9 }, tissueG);
  place(tissueG, 322, 272, 12, 1);
  tearG = mk("g", {}, uterusG);
  mk("path", { class: "pp-tear", d: "M326 372L339 384L328 393L341 405" }, tearG);
  stitchG = mk("g", { opacity: "0" }, uterusG);
  [378, 390, 402].forEach((y) => { mk("path", { class: "pp-stitch", d: "M322 " + y + "L342 " + (y + 6) }, stitchG); });
  heartG = mk("g", {}, g);
  mk("ellipse", { class: "pp-heart", cx: 620, cy: 185, rx: 28, ry: 24 }, heartG);
  mk("path", { class: "pp-vwall", d: "M620 209L620 260", stroke: "var(--c-endo)" }, heartG);
  mk("rect", { class: "pp-lumen", x: 570, y: 268, width: 350, height: 44 }, g);
  mk("rect", { class: "pp-vwall", x: 570, y: 260, width: 350, height: 8, rx: 4 }, g);
  mk("rect", { class: "pp-vwall", x: 570, y: 312, width: 350, height: 8, rx: 4 }, g);
  for (let i = 0; i < 12; i++) { const e = mk("g", { class: "cl cl-rbc" }, g); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, e); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, e); rbcs.push({ e: e, x: 575 + i * 29, y: 290 + (i % 3 - 1) * 9, v: rnd(0.85, 1.15) }); }
  mk("path", { class: "pp-vwall", d: "M682 348L798 348L786 396L694 396Z" }, g);
  mk("ellipse", { class: "pp-pool", cx: 740, cy: 352, rx: 56, ry: 7 }, g);
  clotG = mk("g", {}, g);
  for (let i = 0; i < 6; i++) { const c = cell(clotG, { cls: "plt", r: 5, seed: i + 2, wob: 0.15, n: 7 }); place(c, 712 + i * 11, 366 + (i % 2) * 12, 0, 1); }
  for (let i = 0; i < 6; i++) mk("path", { class: "pp-fibrin", d: "M" + (700 + i * 14) + " 358L" + (706 + i * 13) + " 384" }, clotG);
  place(clotG, 0, 0, 0, 1);
  initPanel();
}
function step(dt, m) {
  if (m.cause !== shownCause) { shownCause = m.cause; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.cause)); }
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Contr = lerp(sm.Contr, m.Contr, k1); sm.Bleed = lerp(sm.Bleed, m.Bleed, k2); sm.Clot = lerp(sm.Clot, m.Clot, k1); sm.Press = lerp(sm.Press, m.Press, k1);
  sm.tissueEff = lerp(sm.tissueEff, m.tissueEff, k1); sm.traumaEff = lerp(sm.traumaEff, m.traumaEff, k1);
  sm.mass = lerp(sm.mass, m.mass, k1); sm.rep = lerp(sm.rep, m.rep, k1); sm.txa = lerp(sm.txa, m.txa, k1);
  const us = (1.07 - 0.15 * sm.Contr) * (1 + 0.008 * Math.sin(tm / 420));
  uterusG.setAttribute("transform", "translate(300 262) scale(" + us.toFixed(3) + ") translate(-300 -262)");
  spirals.forEach((s) => s.setAttribute("stroke-width", (1.4 + 2.4 * (1 - sm.Contr)).toFixed(2)));
  const ts = clamp(sm.tissueEff * 1.4);
  place(tissueG, 322, 272, 12, ts); tissueG.style.opacity = ts > 0.04 ? 1 : 0;
  tearG.style.opacity = clamp(sm.traumaEff * 1.4).toFixed(2);
  stitchG.setAttribute("opacity", (sm.rep * (m.cause === 1 ? 1 : 0)).toFixed(2));
  poolEl.setAttribute("rx", f1(24 + 76 * sm.Bleed)); poolEl.setAttribute("opacity", (0.35 + 0.65 * sm.Bleed).toFixed(2));
  const beat = 1 + 0.07 * Math.max(0, Math.sin(tm / (560 - 220 * sm.Press))) * sm.Press;
  heartG.setAttribute("transform", "translate(620 185) scale(" + beat.toFixed(3) + ") translate(-620 -185)");
  const cs = 0.35 + 0.65 * sm.Clot;
  clotG.setAttribute("transform", "translate(740 370) scale(" + cs.toFixed(3) + ") translate(-740 -370)");
  clotG.style.opacity = sm.Clot > 0.08 ? 1 : 0;
  rbcs.forEach((r) => { r.x += r.v * (18 + 62 * sm.Press) * dt; if (r.x > 924) r.x = 574; place(r.e, r.x, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.drop += dt * sm.Bleed * 11; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) emit(p, sm.traumaEff > 0.4 ? rnd(326, 340) : rnd(288, 312), sm.traumaEff > 0.4 ? 388 : 356, rnd(-3, 3), rnd(26, 40), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 416 || p.t > 3) kill(p); });
  acc.uto += dt * sm.mass * 7; while (acc.uto >= 1) { acc.uto--; const p = freeP(uto); if (p) emit(p, rnd(205, 395), 150, rnd(-4, 4), rnd(16, 26), 0); }
  uto.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) kill(p); });
  acc.spark += dt * sm.txa * 7; while (acc.spark >= 1) { acc.spark--; const p = freeP(spark); if (p) emit(p, rnd(700, 780), 330, rnd(-3, 3), rnd(14, 22), 0); }
  spark.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) kill(p); });
  $("tr-mass").style.opacity = sm.mass.toFixed(2); $("tr-rep").style.opacity = sm.rep.toFixed(2); $("tr-txa").style.opacity = sm.txa.toFixed(2);
  gg.contr.set(sm.Contr, wordOf(sm.Contr, 0.35, 0.65, ["soft", "partial", "firm"]));
  gg.bleed.set(sm.Bleed, wordOf(sm.Bleed, 0.28, 0.55, ["scant", "moderate", "heavy"]));
  gg.clot.set(sm.Clot, wordOf(sm.Clot, 0.35, 0.7, ["poor", "forming", "firm"]));
  gg.press.set(sm.Press, wordOf(sm.Press, 0.45, 0.7, ["low", "borderline", "ok"]));
}
run({ init, step });
