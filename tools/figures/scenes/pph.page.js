/* Postpartum haemorrhage scene: real uterus and heart organs, spiral arteries, tear, retained tissue, blood pool, circulation and clot. */
const LY = { flow: $("flow"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dropPath = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
const drops = mkPool(40, () => mk("path", { class: "p-drop", d: dropPath }, LY.parts));
const utoP = mkPool(16, () => mk("circle", { class: "sc-p p-uto", r: 2.6 }, LY.parts));
const txaP = mkPool(16, () => mk("circle", { class: "sc-p p-txa", r: 2.6 }, LY.parts));
let uterusO = null, heartO = null, uterusG = null, heartG = null;
let tissueG = null, tearG = null, stitchG = null, poolEl = null, dishPool = null, clotG = null, capEl = null;
let pillTissue = null, pillTear = null, capKey = "";
const spirals = [], fibrin = [], bUto = [], bTxa = [], rbcs = [];
const cervixPt = [300, 380], tearPt = [322, 368], fundusPt = [300, 195];
const gg = {};
const sm = { Contr: 0.3, Bleed: 0.6, Clot: 0.8, Press: 0.6, tissueEff: 0, traumaEff: 0, mass: 0, rep: 0, txa: 0 };
const acc = { drop: 0, uto: 0, txa: 0 };
let shownCause = -1;
function initOrgans() {
  uterusG = mk("g", {}, LY.cells); uterusG.appendChild($("uterusSlot"));
  heartG = mk("g", {}, LY.cells); heartG.appendChild($("heartSlot"));
  uterusO = organ($("uterusSlot"), "uterus", 300, 255, 250, {});
  heartO = organ($("heartSlot"), "heart", 620, 235, 100, {});
  const UP = uterusO.ports;
  cervixPt[0] = UP.out[0]; cervixPt[1] = UP.out[1] + 42;
  tearPt[0] = UP.out[0] + 22; tearPt[1] = UP.out[1] + 28;
  fundusPt[0] = UP.fundus[0]; fundusPt[1] = UP.fundus[1];
  mk("path", { class: "pp-stub", d: "M662 248 C668 262 668 276 670 290" }, LY.flow);
}
function capText(cause, drug) {
  if (drug === 1) {
    if (cause === 0) return "Massage and uterotonic. The uterus firms and squeezes vessels shut. Bleeding settles.";
    if (cause === 1) return "Uterotonic firms the uterus, but the tear still bleeds. It needs repair.";
    if (cause === 2) return "Uterotonic helps, but tissue still blocks full contraction. Removal is needed.";
    return "Uterotonic firms the uterus, but blood still cannot clot. Clotting help is needed.";
  }
  if (drug === 2) {
    if (cause === 1) return "Repair. Stitches close the tear. Bleeding settles.";
    if (cause === 2) return "Tissue removed. The uterus contracts fully now. Bleeding settles.";
    if (cause === 0) return "Nothing here to repair or remove. The soft uterus still bleeds.";
    return "Nothing here to repair or remove. Blood still cannot clot.";
  }
  if (drug === 3) {
    if (cause === 3) return "Tranexamic acid and clotting support. A firm clot holds. Oozing settles.";
    if (cause === 0) return "Clotting help cannot firm a soft uterus. Bleeding continues.";
    if (cause === 1) return "Clotting help cannot close a tear. Bleeding continues.";
    return "Clotting help cannot clear tissue. Bleeding continues.";
  }
  if (cause === 0) return "No treatment. The soft uterus cannot squeeze its vessels shut. Heavy bleeding.";
  if (cause === 1) return "No treatment. The uterus is firm, but the tear keeps bleeding.";
  if (cause === 2) return "No treatment. Retained tissue stops full contraction. Bleeding continues.";
  return "No treatment. Blood cannot form a firm clot. Everything oozes.";
}
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["contr", "Contraction", "g-good", "How firmly the uterus squeezes after delivery. A firm contraction compresses the spiral arteries."], ["bleed", "Bleeding", "g-bad", "How much blood is escaping. Heavy bleeding after delivery is postpartum haemorrhage."], ["clot", "Clotting", "g-clot", "How well shed blood forms a firm clot. Poor clotting is the thrombin cause."], ["press", "Pressure", "g-fl", "Blood pressure. It falls as circulating volume is lost, towards shock."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 210, y0 + 2, 52, 18, cls, name, tip); });
  const o = LY.over;
  pill(o, "Uterus", 187, 232, 102, 192, "The uterus after delivery. It must squeeze firmly to shut the vessels in its wall.");
  pill(o, "Spiral arteries", 348, 250, 505, 172, "Spiral arteries fed the placenta. Once it separates, only contraction squeezes them shut.");
  pillTissue = pill(o, "Retained tissue", 283, 283, 102, 312, "Placenta or membrane left inside. It blocks full contraction until it is removed.");
  pillTissue.style.opacity = 0;
  pillTear = pill(o, "Tear", 322, 358, 470, 352, "A tear of the cervix or vagina. It bleeds even when the uterus is firm.");
  pillTear.style.opacity = 0;
  pill(o, "Lost blood", 244, 412, 120, 412, "Blood already lost. The pool grows while bleeding continues.");
  pill(o, "Blood flow", 790, 291, 860, 232, "Flow in a body vessel. It slows as lost volume lowers the pressure.");
  pill(o, "Clot", 762, 372, 884, 340, "Shed blood should knit into a firm clot. Without clotting it stays liquid.");
  capEl = mk("text", { class: "pp-cap", x: 30, y: 142 }, o); capEl.textContent = capText(0, 0);
}
function init() {
  initOrgans();
  const g = LY.flow;
  poolEl = mk("ellipse", { class: "pp-pool", cx: 300, cy: 414, rx: 60, ry: 10 }, g);
  mk("rect", { class: "pp-lumen", x: 655, y: 274, width: 270, height: 34 }, g);
  mk("rect", { class: "pp-vwall", x: 655, y: 266, width: 270, height: 8, rx: 4 }, g);
  mk("rect", { class: "pp-vwall", x: 655, y: 308, width: 270, height: 8, rx: 4 }, g);
  mk("path", { class: "pp-dish", d: "M648 344 L792 344 L780 396 L660 396 Z" }, g);
  ["M262 232c14 4 14 16 2 18c-10 2-12-10-2-13c7-2 10 7 2 8", "M270 272c14 4 14 16 2 18c-10 2-12-10-2-13c7-2 10 7 2 8",
   "M338 232c-14 4-14 16-2 18c10 2 12-10 2-13c-7-2-10 7-2 8", "M330 272c-14 4-14 16-2 18c10 2 12-10 2-13c-7-2-10 7-2 8"]
    .forEach((d) => { spirals.push(mk("path", { class: "pp-spiral", d: d }, uterusG)); });
  tissueG = mk("g", {}, uterusG);
  mk("path", { class: "pp-tissue", d: blobD(20, 5, 0.2, 8) }, tissueG);
  mk("circle", { class: "pp-tissue", cx: -12, cy: 8, r: 9 }, tissueG);
  mk("circle", { class: "pp-tissue", cx: 12, cy: -6, r: 7 }, tissueG);
  place(tissueG, 300, 272, 12, 0.001); tissueG.style.opacity = 0;
  [["-24", "1"], ["-12", "-4"], ["0", "-6"], ["12", "-4"], ["24", "1"]].forEach(([dx, dy]) => {
    const e = mk("circle", { class: "sc-p p-uto", r: 3 }, uterusG);
    bUto.push({ e, x: fundusPt[0] + (+dx), y: fundusPt[1] + (+dy) });
    place(e, fundusPt[0] + (+dx), fundusPt[1] + (+dy), 0, 0.001); e.style.opacity = 0;
  });
  mk("rect", { class: "pp-canal", x: 284, y: 333, width: 32, height: 45, rx: 9 }, LY.cells);
  tearG = mk("g", {}, LY.cells);
  mk("path", { class: "pp-tear", d: "M316 344 L328 352 L317 360 L329 368" }, tearG);
  tearG.style.opacity = 0;
  stitchG = mk("g", { opacity: "0" }, LY.cells);
  [344, 354, 364].forEach((y) => { mk("path", { class: "pp-stitch", d: "M310 " + y + " L332 " + (y + 7) }, stitchG); });
  for (let i = 0; i < 12; i++) { const e = mk("g", { class: "cl cl-rbc" }, LY.cells); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, e); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, e); rbcs.push({ e: e, x: 660 + i * 22, y: 291 + (i % 3 - 1) * 9, v: rnd(0.85, 1.15) }); }
  dishPool = mk("ellipse", { class: "pp-pool", cx: 720, cy: 350, rx: 20, ry: 5 }, LY.cells);
  clotG = mk("g", {}, LY.cells);
  for (let i = 0; i < 6; i++) { const c = cell(clotG, { cls: "plt", r: 5, seed: i + 2, wob: 0.15, n: 7 }); place(c, 700 + i * 10, 362 + (i % 2) * 12, 0, 1); }
  for (let i = 0; i < 8; i++) fibrin.push(mk("path", { class: "pp-fibrin", d: "M" + (688 + i * 9) + " 354 L" + (694 + i * 9) + " 384" }, clotG));
  for (let i = 0; i < 8; i++) { const e = mk("circle", { class: "sc-p p-txa", r: 2.4 }, LY.cells); bTxa.push({ e, x: 692 + i * 8, y: 358 + (i % 3) * 10 }); place(e, 692 + i * 8, 358 + (i % 3) * 10, 0, 0.001); e.style.opacity = 0; }
  initPanel();
}
function step(dt, m) {
  if (m.cause !== shownCause) { shownCause = m.cause; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.cause)); }
  const k1 = Math.min(1, dt * 1.1);
  sm.Contr = lerp(sm.Contr, m.Contr, k1); sm.Bleed = lerp(sm.Bleed, m.Bleed, k1); sm.Clot = lerp(sm.Clot, m.Clot, k1); sm.Press = lerp(sm.Press, m.Press, k1);
  sm.tissueEff = lerp(sm.tissueEff, m.tissueEff, k1); sm.traumaEff = lerp(sm.traumaEff, m.traumaEff, k1);
  sm.mass = lerp(sm.mass, m.mass, k1); sm.rep = lerp(sm.rep, m.rep, k1); sm.txa = lerp(sm.txa, m.txa, k1);
  const sx = 1.06 - 0.13 * sm.Contr, sy = 1.03 - 0.08 * sm.Contr;
  uterusG.setAttribute("transform", "translate(300 262) scale(" + sx.toFixed(3) + " " + sy.toFixed(3) + ") translate(-300 -262)");
  spirals.forEach((s) => s.setAttribute("stroke-width", (1.2 + 2.6 * (1 - sm.Contr)).toFixed(2)));
  const ts = clamp(sm.tissueEff * 1.5);
  place(tissueG, 300, 272, 12, Math.max(ts, 0.001)); tissueG.style.opacity = ts > 0.04 ? 1 : 0;
  tearG.style.opacity = clamp(sm.traumaEff * 1.5).toFixed(2);
  stitchG.setAttribute("opacity", (sm.rep * (m.cause === 1 ? 1 : 0)).toFixed(2));
  bUto.forEach((b) => { place(b.e, b.x, b.y, 0, Math.max(sm.mass, 0.001)); b.e.style.opacity = sm.mass > 0.05 ? 1 : 0; });
  bTxa.forEach((b) => { place(b.e, b.x, b.y, 0, Math.max(sm.txa, 0.001)); b.e.style.opacity = sm.txa > 0.05 ? 1 : 0; });
  poolEl.setAttribute("rx", f1(22 + 74 * sm.Bleed)); poolEl.setAttribute("ry", f1(8 + 4 * sm.Bleed));
  poolEl.setAttribute("opacity", (0.35 + 0.65 * sm.Bleed).toFixed(2));
  dishPool.setAttribute("rx", f1(8 + 26 * (1 - sm.Clot)));
  dishPool.setAttribute("opacity", (0.3 + 0.5 * (1 - sm.Clot)).toFixed(2));
  const beat = 1 + 0.06 * Math.max(0, Math.sin(tm / (560 - 220 * sm.Press))) * sm.Press;
  heartG.setAttribute("transform", "translate(620 235) scale(" + beat.toFixed(3) + ") translate(-620 -235)");
  rbcs.forEach((r) => { r.x += r.v * (12 + 66 * sm.Press) * dt; if (r.x > 922) r.x = 658; place(r.e, r.x, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  const cs = 0.45 + 0.55 * sm.Clot;
  clotG.setAttribute("transform", "translate(720 370) scale(" + cs.toFixed(3) + ") translate(-720 -370)");
  const dense = sm.txa > 0.4 ? 1 : 0;
  fibrin.forEach((f, i) => { f.setAttribute("opacity", clamp(sm.Clot * 1.3 - i * 0.09 - (dense ? 0 : 0.15), 0.08, 1).toFixed(2)); f.setAttribute("stroke-width", dense ? 1.8 : 1.1); });
  acc.drop += dt * sm.Bleed * 12; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) { const o = sm.traumaEff > 0.4 ? tearPt : cervixPt; emit(p, o[0] + rnd(-6, 6), o[1], rnd(-3, 3), rnd(30, 45)); } }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); if (p.y > 406 || p.t > 3) kill(p); });
  acc.uto += dt * sm.mass * 8; while (acc.uto >= 1) { acc.uto--; const p = freeP(utoP); if (p) emit(p, rnd(250, 350), 150, rnd(-6, 6), rnd(18, 30)); }
  utoP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); if (p.y > fundusPt[1] + 4 || p.t > 3) kill(p); });
  acc.txa += dt * sm.txa * 8; while (acc.txa >= 1) { acc.txa--; const p = freeP(txaP); if (p) emit(p, rnd(700, 780), 320, rnd(-4, 4), rnd(16, 26)); }
  txaP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); if (p.y > 350 || p.t > 3) kill(p); });
  pillTissue.style.opacity = clamp(sm.tissueEff * 1.5).toFixed(2);
  pillTear.style.opacity = clamp(sm.traumaEff * 1.5).toFixed(2);
  gg.contr.set(sm.Contr, wordOf(sm.Contr, 0.35, 0.65, ["soft", "partial", "firm"]));
  gg.bleed.set(sm.Bleed, wordOf(sm.Bleed, 0.28, 0.55, ["scant", "moderate", "heavy"]));
  gg.clot.set(sm.Clot, wordOf(sm.Clot, 0.35, 0.7, ["poor", "forming", "firm"]));
  gg.press.set(sm.Press, wordOf(sm.Press, 0.45, 0.7, ["low", "borderline", "ok"]));
  const key = m.cause * 4 + drug; if (key !== capKey) { capKey = key; const t = capText(m.cause, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
