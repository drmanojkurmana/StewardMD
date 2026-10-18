/* Neonatal jaundice scene: red cell breakdown, bilirubin, liver conjugation, gut excretion, albumin carriage, skin yellowing and brain entry. */
const WW = SC.W;
const layers = { rbcTop: $("rbcsTop"), alb: $("alb"), ugt: $("ugt"), parts: $("parts"), over: $("over"), panel: $("panel"), bbb: $("endoBBB"), lamp: $("photoLamp"), exchG: $("exchG"), skinOv: $("skinOv"), skinOv2: $("skinOv2"), brainOv: $("brainOv") };
/* ---- red cells in the turnover box ---- */
const rbcs = [];
function initRbcs() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcTop); mk("ellipse", { class: "cl-b", rx: 10, ry: 6 }, g); mk("ellipse", { class: "cl-s", rx: 3.6, ry: 1.8 }, g); rbcs.push({ g, x: 52 + (i % 4) * 58 + rnd(-6, 6), y: 108 + Math.floor(i / 4) * 42 + rnd(-5, 5), ph: i * 1.3 }); } }
/* ---- UGT enzyme dots in the liver ---- */
const ugts = [];
function initUgt() { for (let i = 0; i < 10; i++) { const g = cell(layers.ugt, { cls: "ugt", r: 6, seed: i + 3, wob: 0.12, n: 7 }); ugts.push({ g, x: 408 + (i % 5) * 36, y: 128 + Math.floor(i / 5) * 48, ph: i }); } }
/* ---- BBB endothelial dots ---- */
function initBbb() { for (let i = 0; i < 7; i++) { const g = cell(layers.bbb, { cls: "endo", r: 7, seed: i + 30, wob: 0.08, n: 7 }); place(g, 720, 292 + i * 22, 0, 1); } }
/* ---- particle pools (pool items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const bili = pool(38, () => mk("circle", { class: "sc-p p-bili", r: 3.2 }, layers.parts));
const conj = pool(22, () => mk("circle", { class: "sc-p p-conj", r: 3 }, layers.parts));
const albP = pool(14, () => mk("ellipse", { class: "sc-p p-alb", rx: 5, ry: 3 }, layers.parts));
const ent = pool(10, () => mk("circle", { class: "sc-p p-ent", r: 2.6 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function moveTo(p, tx, ty, sp, dt) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; return d; }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 330, 530, 730];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The baby";
  [["prod", "Breakdown", "g-prod", "Red cell breakdown releasing bilirubin. Haemolysis from ABO or Rh incompatibility or G6PD deficiency raises this greatly."], ["bil", "Bilirubin", "g-bili", "Unconjugated bilirubin in blood. It yellows skin and eyes."], ["brain", "Brain entry", "g-brain", "Free unconjugated bilirubin crossing the blood brain barrier. Sustained entry can injure the brain (kernicterus)."], ["excr", "Excretion", "g-conj", "Conjugation in the liver plus excretion in gut and, with phototherapy, from skin and blood."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Red cells", 150, 110, 190, 85, "Newborn red cells are numerous and short lived. Their breakdown releases haem, which becomes unconjugated bilirubin.");
  pill(ox, "Haemolysis", 120, 172, 120, 218, "Haemolysis: ABO or Rh incompatibility or G6PD deficiency breaks red cells faster and can cause pathological jaundice. Prematurity and breast milk jaundice also prolong jaundice.");
  pill(ox, "Conjugation", 430, 122, 400, 95, "Conjugation: liver UGT enzymes attach glucuronic acid to bilirubin so it can be excreted. This system is immature at birth, especially in prematurity.");
  pill(ox, "Liver", 520, 168, 560, 205, "The newborn liver. Immature conjugation means much bilirubin stays unconjugated.");
  pill(ox, "Gut", 800, 118, 800, 85, "Conjugated bilirubin leaves in bile to the gut and stool. Feeding speeds gut passage and reduces reabsorption (enterohepatic circulation). Breast milk can increase reabsorption.");
  pill(ox, "Feeding", 790, 185, 700, 218, "Feeding and monitoring: regular feeding speeds stooling and bilirubin excretion while levels are watched.");
  pill(ox, "Bilirubin", 300, 322, 240, 282, "Unconjugated bilirubin travels in blood, mostly bound to albumin. Yellow dots are bilirubin; teal dots are conjugated or phototherapy converted forms heading for excretion.");
  pill(ox, "Albumin", 400, 330, 400, 282, "Albumin carries unconjugated bilirubin in blood. When bilirubin is high, binding fills and free bilirubin rises, which is the form that can cross into the brain.");
  pill(ox, "Baby skin", 635, 322, 635, 290, "Bilirubin in skin and eyes causes visible yellow jaundice. Phototherapy light acts here and in surface blood.");
  const pp = pill(ox, "Phototherapy", 635, 268, 635, 243, "Phototherapy: blue light converts bilirubin in skin to water soluble forms that can be excreted without liver conjugation."); pp.setAttribute("id", "photo-pill");
  pill(ox, "Brain", 836, 318, 836, 282, "The brain. Free unconjugated bilirubin can injure basal ganglia and brainstem nuclei, causing kernicterus.");
  pill(ox, "Blood brain barrier", 720, 380, 770, 422, "Blood brain barrier: the sealed vessel wall protecting the brain. Free bilirubin can cross it, especially in prematurity and severe jaundice; albumin bound bilirubin cannot.");
  const ep = pill(ox, "Exchange", 430, 366, 430, 422, "Exchange transfusion: blood is exchanged to remove bilirubin and, in haemolysis, antibody coated red cells and antibodies."); ep.setAttribute("id", "exch-pill");
}
const sm = { prod: 0.3, bil: 0.2, brain: 0, excr: 0.4, conj: 0.4, photo: 0, exch: 0, feed: 1, haem: 0 };
const acc = { bili: 0, alb: 0, ent: 0 };
function init() { initRbcs(); initUgt(); initBbb(); initPanel(); albP.forEach((p, i) => { emit(p, rnd(30, 530), 335, 0); p.x = 30 + i * 38; }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.prod = lerp(sm.prod, m.prod, k2); sm.bil = lerp(sm.bil, m.bil, k2); sm.brain = lerp(sm.brain, m.brain, k2); sm.excr = lerp(sm.excr, m.excr, k2); sm.conj = lerp(sm.conj, m.conj, k2); sm.photo = lerp(sm.photo, m.photo, k1); sm.exch = lerp(sm.exch, m.exch, k1); sm.feed = lerp(sm.feed, m.feed, k2); sm.haem = lerp(sm.haem, m.haem, k2);
  rbcs.forEach((r, i) => { const frag = 0.85 + 0.15 * Math.sin(tm / (700 - sm.prod * 300) + r.ph); place(r.g, r.x, r.y, Math.sin(tm / 900 + r.ph) * 8, frag); r.g.style.opacity = 0.55 + 0.45 * sm.prod; });
  ugts.forEach((u, i) => { place(u.g, u.x, u.y, 0, 0.5 + 0.6 * sm.conj); u.g.style.opacity = (0.25 + 0.75 * sm.conj).toFixed(2); });
  layers.skinOv.setAttribute("opacity", (sm.bil * 0.85).toFixed(2)); layers.skinOv2.setAttribute("opacity", (sm.bil * 0.85).toFixed(2));
  layers.brainOv.setAttribute("opacity", (sm.brain * 0.75).toFixed(2));
  layers.lamp.setAttribute("opacity", sm.photo.toFixed(2));
  layers.exchG.setAttribute("opacity", sm.exch.toFixed(2));
  const pPill = $("photo-pill"); if (pPill) pPill.style.opacity = sm.photo.toFixed(2);
  const ePill = $("exch-pill"); if (ePill) ePill.style.opacity = sm.exch.toFixed(2);
  /* spawn bilirubin from red cells */
  acc.bili += dt * (1.2 + 7 * sm.prod); while (acc.bili >= 1) { acc.bili--; const p = freeP(bili); if (p) emit(p, rnd(56, 270), rnd(100, 190), 0); }
  bili.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { if (moveTo(p, 356, 146, 62, dt) < 10) { if (Math.random() < sm.conj * 0.85) { kill(p); const c = freeP(conj); if (c) emit(c, 500, 146, 0); } else { p.k = 1; } } }
    else if (p.k === 1) { if (moveTo(p, 280, 330, 70, dt) < 10) p.k = 2; }
    else if (p.k === 2) { p.x += 62 * dt; p.y = 335 + Math.sin(tm / 300 + p.t * 3) * 10; if (sm.photo > 0.5 && Math.random() < dt * 1.6) { kill(p); const c = freeP(conj); if (c) emit(c, p.x, p.y, 1); } else if (sm.exch > 0.5 && Math.random() < dt * 2.2) { kill(p); } else if (p.x > 700) { p.k = (Math.random() < sm.brain * 1.4) ? 3 : 4; } }
    else if (p.k === 3) { if (moveTo(p, 836, 352, 58, dt) < 12 || p.t > 9) kill(p); }
    else { if (moveTo(p, 635, 360, 58, dt) < 12 || p.t > 9) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 14) kill(p);
  });
  conj.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { if (moveTo(p, 806, 140, 66, dt) < 10) p.k = 2; }
    else if (p.k === 2) { p.y += 34 * dt; p.x += Math.sin(tm / 250 + p.t) * 8 * dt; if (p.y > 208 || p.t > 8) kill(p); }
    else { p.y += 46 * dt; if (p.y > 432 || p.t > 6) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  /* albumin carriers drift in blood */
  albP.forEach((p) => { if (!p.on) return; p.x += (26 + 30 * sm.bil) * dt; if (p.x > 540) p.x = 28; p.y = 335 + Math.sin(tm / 420 + p.x / 40) * 12; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.5 * sm.bil).toFixed(2)); });
  /* enterohepatic return: gut back toward liver, less with feeding */
  acc.ent += dt * (1 - sm.feed * 0.75) * (0.4 + sm.bil) * 3; while (acc.ent >= 1) { acc.ent--; const p = freeP(ent); if (p) emit(p, 820, 232, 0); }
  ent.forEach((p) => { if (!p.on) return; p.t += dt; p.x -= 52 * dt; p.y = 238 + Math.sin(tm / 300 + p.t * 2) * 4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 500 || p.t > 7) kill(p); });
  gg.prod.set(sm.prod, wordOf(sm.prod, 0.35, 0.65, ["steady", "raised", "high"])); gg.bil.set(sm.bil, wordOf(sm.bil, 0.28, 0.58, ["mild", "raised", "high"])); gg.brain.set(sm.brain, wordOf(sm.brain, 0.12, 0.38, ["minimal", "possible", "likely"])); gg.excr.set(sm.excr, wordOf(sm.excr, 0.35, 0.62, ["low", "steady", "good"]));
}
run({ init, step });
