/* DVT scene: Virchow triad, valve clot with propagation, calf swelling, travelling emboli and lung block. */
const WW = SC.W;
const layers = { triad: $("triad"), leg: $("leg"), lung: $("lung"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const TR = track(SC.travel);
const sm = { Ce: 0.5, Prop: 0.4, Flow: 0.6, Swell: 0.4, Emb: 0.4, LungBlock: 0.3, LungFlow: 0.7, comp: 0, ac: 0, fl: 0 };
const gg = {};
let clotCells = [], veinCells = [], lungCells = [], embG, sacOpen, sacBlocked, dsOv, calfTop, calfBot, stockG, shieldG, filterG;
let embPool, sparkPool, dropPool;
const acc = { emb: 0, spark: 0, drop: 0 };

function rbc(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.36, ry: ry * 0.32 }, g); return g; }

function initTriad() {
  const defs = [
    [180, "STASIS", "slow flow", "Slow or still blood flow, for example when the calf is not moving. Blood lingers in the valve pocket and clotting starts more easily."],
    [480, "WALL INJURY", "lining hurt", "Injury to the vein wall lining exposes material that platelets stick to and that switches clotting on."],
    [780, "READY TO CLOT", "blood clots easily", "Blood that clots more readily, from inherited traits, illness, hormones, cancer or other states. Platelets and clotting factors respond faster."],
  ];
  defs.forEach(([cx, name, sub, tip]) => {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, layers.triad);
    mk("rect", { class: "dvt-tribox", x: cx - 105, y: 82, width: 210, height: 50, rx: 12 }, g);
    const t = mk("text", { class: "dvt-trit", x: cx, y: 104, "text-anchor": "middle" }, g); t.textContent = name;
    const s = mk("text", { class: "dvt-tris", x: cx, y: 120, "text-anchor": "middle" }, g); s.textContent = sub;
  });
}

function initLeg() {
  const L = layers.leg;
  mk("path", { class: "dvt-valve", d: "M200 274L224 292M200 326L224 308" }, L);
  mk("path", { class: "dvt-valve", d: "M252 274L228 292M252 326L228 308", opacity: "0.45" }, L);
  stockG = mk("g", { id: "m-comp", opacity: "0" }, L);
  mk("rect", { class: "dvt-stock", x: 64, y: 348, width: 300, height: 72, rx: 18 }, stockG);
  mk("path", { class: "dvt-filter", d: "M92 398l10 -10M112 398l10 -10M132 398l10 -10", opacity: "0.7" }, stockG);
  calfTop = mk("path", { class: "dvt-calf", d: "M70 368C160 352 280 352 370 368" }, L);
  calfBot = mk("path", { class: "dvt-calf", d: "M70 398C160 414 280 414 370 398" }, L);
  const cg = mk("g", {}, L);
  for (let i = 0; i < 16; i++) {
    const c = cell(cg, { cls: "plt", r: 6 + (i % 3), x: 214 + i * 15, y: 300 + Math.sin(i * 1.7) * 11, seed: i + 3, wob: 0.16, n: 7 });
    clotCells.push(c);
  }
  for (let i = 0; i < 5; i++) mk("path", { class: "fibrin", d: "M220 " + (288 + i * 6) + "L430 " + (282 + i * 8) }, cg);
  shieldG = mk("g", { id: "m-ac", opacity: "0" }, L);
  mk("circle", { class: "dvt-shield", cx: 250, cy: 252, r: 11 }, shieldG);
  mk("path", { class: "dvt-tick", d: "M245 252l4 4l7 -8" }, shieldG);
  filterG = mk("g", { id: "m-fl", opacity: "0" }, L);
  mk("path", { class: "dvt-filter", d: "M562 282L588 300L562 318M588 300L562 282M588 300L562 318M575 291L575 309" }, filterG);
  for (let i = 0; i < 14; i++) { const g = rbc(layers.cells, 8, 4.8); veinCells.push({ g, x: rnd(50, 538), y: rnd(282, 318), v: rnd(0.8, 1.2), rot: rnd(-14, 14) }); }
}

function initLung() {
  const L = layers.lung;
  sacOpen = mk("circle", { class: "dvt-sac", cx: 750, cy: 218, r: 28 }, L);
  sacBlocked = mk("circle", { class: "dvt-sac", cx: 860, cy: 218, r: 28 }, L);
  dsOv = mk("circle", { class: "dvt-ds", cx: 860, cy: 218, r: 28, opacity: "0" }, L);
  embG = mk("g", {}, L);
  for (let i = 0; i < 7; i++) cell(embG, { cls: "plt", r: 5.5 + (i % 3), x: Math.cos(i * 1.2) * 14, y: Math.sin(i * 2) * 9, seed: i + 11, wob: 0.16, n: 7 });
  place(embG, 700, 300, 0, 1);
  for (let i = 0; i < 12; i++) { const g = rbc(layers.cells, 7, 4.2); lungCells.push({ g, x: rnd(590, 940), y: rnd(286, 314), v: rnd(0.85, 1.15), rot: rnd(-12, 12) }); }
}

function initPools() {
  embPool = pool(5, () => mk("circle", { class: "sc-p p-emb2", r: 4.5 }, layers.parts));
  sparkPool = pool(10, () => mk("path", { class: "dvt-spark", d: "M-4 0L4 0M0 -4L0 4" }, layers.parts));
  dropPool = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
}

function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["clot", "Clot", "g-clot", "How far the clot extends along the calf vein from the valve."],
   ["flow", "Vein flow", "g-fl", "How much blood still gets past the clot in the calf vein. Compression and movement speed it up."],
   ["swell", "Swelling", "g-swell", "Calf swelling from raised pressure behind the blocked vein. Fluid leaves the vessels into the tissue."],
   ["prop", "Growth", "g-cyt", "Whether the clot is still propagating along the vein. An anticoagulant and clot dissolving treatment stop this."],
   ["emb", "Embolus risk", "g-bad", "Chance that a piece breaks off and travels toward the lung. A filter catches travelling pieces."],
   ["lung", "Lung flow", "g-good", "How much blood still flows through the lung vessel past a travelled embolus."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Calf vein", 80, 285, 80, 225, "Calf vein: a deep vein in the calf. Blood flows toward the heart, here from left to right.");
  pill(o, "Valve", 205, 288, 255, 225, "Vein valve: a one way flap that stops blood falling back. Flow is slowest in the pocket behind it, so clot often starts here.");
  pill(o, "Growing tail", 370, 288, 430, 225, "The clot propagates along the vein toward the heart as platelets and fibrin add to its tail.");
  pill(o, "Embolus", 545, 292, 560, 210, "Embolus: a piece of clot that has broken off and is travelling with the blood toward the lung.");
  pill(o, "Lung artery", 640, 288, 660, 225, "Lung artery vessel: travelled clot can lodge here and block blood flow through part of the lung.");
  pill(o, "Blocked sac", 860, 232, 830, 176, "Air sac behind the blocked vessel. It still receives air but little blood, so its gas exchange is wasted.");
  pill(o, "Clot", 225, 314, 180, 385, "Clot at the valve: platelets and fibrin mesh stuck to the vein wall in the valve pocket.");
  pill(o, "Swelling", 250, 382, 320, 385, "Swollen calf: pressure behind the blocked vein pushes fluid into the tissue, so the calf widens.");
  pill(o, "Open sac", 750, 232, 760, 385, "Air sac on an open branch. Blood still flows past it and picks up oxygen.");
  const pc = pill(o, "Compression", 150, 384, 460, 385, "Compression and mobilisation: squeezing the calf and walking speed venous flow, ease stasis and reduce swelling."); pc.setAttribute("id", "p-comp"); pc.style.opacity = 0;
  const pa = pill(o, "Anticoagulant", 250, 258, 460, 385, "Anticoagulant: stops the clot growing and stops new clots forming. It does not dissolve clot quickly."); pa.setAttribute("id", "p-ac"); pa.style.opacity = 0;
  const pf = pill(o, "Filter + lysis", 575, 300, 460, 385, "A filter in the large vein catches travelling pieces, and a clot dissolving treatment breaks clot up. Reserved for selected situations."); pf.setAttribute("id", "p-fl"); pf.style.opacity = 0;
}

function init() { initTriad(); initLeg(); initLung(); initPools(); initPanel(); }

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.5);
  ["Ce", "Flow", "Swell", "LungBlock", "LungFlow", "comp", "ac", "fl"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  ["Prop", "Emb"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  ["tri1", "tri2", "tri3"].forEach((id) => { const e = $(id); if (e) e.setAttribute("opacity", (0.25 + 0.55 * sm.Ce).toFixed(2)); });
  const shown = Math.round(sm.Ce * clotCells.length);
  clotCells.forEach((c, i) => { const on = i < shown; place(c, 214 + i * 15, 300 + Math.sin(i * 1.7) * 11, 0, on ? 1 : 0.05); c.style.opacity = on ? 1 : 0; });
  const gap = sm.Swell * 16;
  calfTop.setAttribute("d", "M70 " + f1(368 - gap * 0.4) + "C160 " + f1(352 - gap) + " 280 " + f1(352 - gap) + " 370 " + f1(368 - gap * 0.4));
  calfBot.setAttribute("d", "M70 " + f1(398 + gap * 0.4) + "C160 " + f1(414 + gap) + " 280 " + f1(414 + gap) + " 370 " + f1(398 + gap * 0.4));
  stockG.setAttribute("opacity", sm.comp.toFixed(2));
  shieldG.setAttribute("opacity", sm.ac.toFixed(2));
  filterG.setAttribute("opacity", sm.fl.toFixed(2));
  const vf = 18 + 62 * sm.Flow;
  veinCells.forEach((c, i) => {
    let sp = vf * c.v;
    if (c.x > 200 && c.x < 210 + shown * 15) sp *= 0.35;
    c.x += sp * dt;
    if (c.x > 540) { c.x = 48; c.y = rnd(282, 318); }
    place(c.g, c.x, c.y + Math.sin(tm / 500 + i) * 1.5, c.rot, 1);
  });
  const lf = 16 + 60 * sm.LungFlow;
  lungCells.forEach((c) => {
    c.x += lf * c.v * dt;
    if (c.x > 700 - 14 && c.x < 716 && sm.LungBlock > 0.25) c.x = 700 - 16;
    if (c.x > 940) { c.x = 590; c.y = rnd(286, 314); }
    place(c.g, c.x, c.y, c.rot, 1);
  });
  const es = clamp((sm.LungBlock - 0.04) * 1.5);
  place(embG, 700, 300, Math.sin(tm / 700) * 5, 0.15 + 0.85 * es);
  embG.style.opacity = es > 0.08 ? 1 : 0;
  dsOv.setAttribute("opacity", (sm.LungBlock * 0.8).toFixed(2));
  const br = 1 + 0.05 * Math.sin(tm / 600);
  sacOpen.setAttribute("transform", "translate(750 218) scale(" + br.toFixed(3) + ") translate(-750 -218)");
  sacBlocked.setAttribute("transform", "translate(860 218) scale(" + br.toFixed(3) + ") translate(-860 -218)");
  dsOv.setAttribute("transform", "translate(860 218) scale(" + br.toFixed(3) + ") translate(-860 -218)");
  acc.emb += dt * sm.Emb * 1.8 * (sm.ac ? 0.35 : 1);
  while (acc.emb >= 1) { acc.emb--; const p = free(embPool); if (p) { p.u = 0; emit(p, 400, 300, 0, 0, 0); } }
  embPool.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 0.3;
    const lim = sm.fl ? 0.58 : 1;
    const a = TR.at(Math.min(p.u, lim));
    p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")");
    if (p.u >= lim) kill(p);
  });
  acc.spark += dt * sm.fl * 7;
  while (acc.spark >= 1) { acc.spark--; const p = free(sparkPool); if (p) emit(p, 230 + Math.random() * Math.max(20, shown * 15), 300 + rnd(-14, 14), 0, 0, 0); }
  sparkPool.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 160) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  acc.drop += dt * sm.Swell * 5;
  while (acc.drop >= 1) { acc.drop--; const p = free(dropPool); if (p) emit(p, rnd(90, 350), 336, 0, 20, 0); }
  dropPool.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 360 + gap) kill(p); });
  $("p-comp").style.opacity = sm.comp.toFixed(2);
  $("p-ac").style.opacity = sm.ac.toFixed(2);
  $("p-fl").style.opacity = sm.fl.toFixed(2);
  gg.clot.set(sm.Ce, wordOf(sm.Ce, 0.35, 0.7, ["short", "long", "extensive"]));
  gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.7, ["slow", "reduced", "brisk"]));
  gg.swell.set(sm.Swell, wordOf(sm.Swell, 0.3, 0.6, ["little", "moderate", "marked"]));
  gg.prop.set(sm.Prop, wordOf(sm.Prop, 0.3, 0.6, ["stopped", "slow", "active"]));
  gg.emb.set(sm.Emb, wordOf(sm.Emb, 0.3, 0.6, ["low", "raised", "high"]));
  gg.lung.set(sm.LungFlow, wordOf(sm.LungFlow, 0.35, 0.7, ["blocked", "reduced", "open"]));
}
run({ init, step });
