/* Neonatal jaundice scene: red cell breakdown, liver conjugation, gut excretion, albumin carriage, skin yellowing and brain entry. */
const WW = SC.W;
const layers = { rbcTop: $("rbcsTop"), alb: $("alb"), ugt: $("ugt"), parts: $("parts"), over: $("over"), panel: $("panel"), bbb: $("endoBBB"), lamp: $("lampG"), cone: $("lightCone"), glow: $("skinGlow"), clean: $("bloodClean"), exchG: $("exchG"), skinOv: $("skinOv"), brainOv: $("brainOv") };
/* ---- real organ anatomy; vessels and particles anchor to their ports ---- */
let liverO = null, bowelO = null, skinO = null, brainO = null, capEl = null, capKey = "";
let rbcExit = [190, 208], liverEntry = [368, 172], gallPt = [560, 190], bowelCoils = [798, 148], bowelOut = [830, 220];
let bloodY = 344, bloodL = 40, bloodR = 700, carotidPt = [750, 360], parenPt = [830, 348], skinSurf = [635, 310], skinDerm = [635, 360];
function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 475, 148, 200, {});
  bowelO = organ($("bowelSlot"), "bowel", 798, 148, 150, {});
  skinO = organ($("skinSlot"), "skin", 635, 348, 100, { h: 70 });
  brainO = organ($("brainSlot"), "brain", 830, 348, 165, {});
  const LP = liverO.ports, BP = bowelO.ports, KP = skinO.ports, NP = brainO.ports;
  liverEntry = LP.lobe; gallPt = LP.gall;
  bowelCoils = BP.coils; bowelOut = BP.out;
  skinSurf = KP.surface; skinDerm = KP.dermis;
  carotidPt = NP.carotid; parenPt = NP.parenchyma;
  $("vRbcLiv").setAttribute("d", "M" + f1(rbcExit[0]) + " " + f1(rbcExit[1]) + " C260 212 320 190 " + f1(liverEntry[0]) + " " + f1(liverEntry[1]));
  $("vBile").setAttribute("d", "M" + f1(gallPt[0]) + " " + f1(gallPt[1]) + " C640 200 700 180 " + f1(bowelCoils[0]) + " " + f1(bowelCoils[1]));
  $("vBloodBrain").setAttribute("d", "M" + f1(bloodR) + " " + f1(bloodY) + " C722 " + f1(bloodY) + " 734 350 " + f1(carotidPt[0]) + " " + f1(carotidPt[1]));
}
function capText(d, l) {
  const sev = ["Early jaundice. ", "Worsening jaundice. ", "Severe jaundice. "][l];
  if (d === 1) return sev + "Phototherapy light changes skin bilirubin so it can leave in stool and urine.";
  if (d === 2) return sev + "Exchange transfusion swaps bilirubin rich blood for clean blood.";
  return sev + "Feeds and watching only. Bilirubin builds up and some can reach the brain.";
}
/* ---- red cells in the turnover box ---- */
const rbcs = [];
function initRbcs() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcTop); mk("ellipse", { class: "cl-b", rx: 10, ry: 6 }, g); mk("ellipse", { class: "cl-s", rx: 3.6, ry: 1.8 }, g); rbcs.push({ g, x: 52 + (i % 4) * 58 + rnd(-6, 6), y: 100 + Math.floor(i / 4) * 42 + rnd(-5, 5), ph: i * 1.3 }); } }
/* ---- UGT enzyme dots across the real liver ---- */
const ugts = [];
function initUgt() { for (let i = 0; i < 10; i++) { const g = cell(layers.ugt, { cls: "ugt", r: 6, seed: i + 3, wob: 0.12, n: 7 }); ugts.push({ g, x: liverO.x - 70 + (i % 5) * 35, y: liverO.y - 14 + Math.floor(i / 5) * 30 }); } }
/* ---- BBB endothelial dots ---- */
const bbbCells = [];
function initBbb() { for (let i = 0; i < 7; i++) { const g = cell(layers.bbb, { cls: "endo", r: 7, seed: i + 30, wob: 0.08, n: 7 }); place(g, 722, 290 + i * 17, 0, 1); bbbCells.push(g); } }
/* ---- particle pools (pool items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const bili = pool(38, () => mk("circle", { class: "sc-p p-bili", r: 3.2 }, layers.parts));
const conj = pool(22, () => mk("circle", { class: "sc-p p-conj", r: 3 }, layers.parts));
const albP = pool(14, () => mk("ellipse", { class: "sc-p p-alb", rx: 5, ry: 3 }, layers.parts));
const ent = pool(10, () => mk("circle", { class: "sc-p p-ent", r: 2.6 }, layers.parts));
const lightP = pool(14, () => mk("circle", { class: "sc-p p-light", r: 2.2 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.t = 0; p.k = k || 0; p.vx = 0; p.vy = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function moveTo(p, tx, ty, sp, dt) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; return d; }
/* ---- labels, caption and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 330, 530, 730];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The baby";
  [["prod", "Breakdown", "g-prod", "Red cell breakdown releasing bilirubin. ABO or Rh mismatch or G6PD deficiency raises this greatly."], ["bil", "Bilirubin", "g-bili", "Unconjugated bilirubin in blood. It yellows skin and eyes."], ["brain", "Brain entry", "g-brain", "Free unconjugated bilirubin crossing the blood brain barrier. Sustained entry can injure the brain."], ["excr", "Excretion", "g-conj", "Bilirubin leaving the body: conjugated bilirubin in stool, plus light changed forms during phototherapy."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Red cells", 150, 140, 150, 70, "Newborn red cells break down fast. Their haem becomes unconjugated bilirubin. ABO or Rh mismatch or a red cell enzyme fault speeds this up.");
  pill(ox, "Liver", 475, 140, 475, 70, "The newborn liver. Its UGT enzymes conjugate bilirubin so it can leave in bile. The system is immature at birth.");
  pill(ox, "Gut", 798, 140, 798, 70, "Conjugated bilirubin leaves in bile to the gut and stool. Feeding speeds passage and lowers reabsorption back to the liver.");
  pill(ox, "Blood", 280, 344, 280, 292, "Unconjugated bilirubin travels in blood, mostly bound to albumin. Yellow dots are bilirubin. Teal dots are conjugated or light changed forms.");
  pill(ox, "Skin", 615, 340, 560, 300, "Bilirubin in skin and eyes shows as yellow jaundice. Phototherapy light acts here and in surface blood.");
  pill(ox, "Light", 635, 264, 700, 244, "Phototherapy. Blue light changes bilirubin in skin into forms that leave without liver conjugation.");
  pill(ox, "Brain", 845, 335, 845, 282, "Free bilirubin that crosses the blood brain barrier can injure the brain. Albumin bound bilirubin cannot cross.");
  pill(ox, "Exchange", 120, 392, 140, 300, "Exchange transfusion. Bilirubin rich blood is removed and replaced, so blood bilirubin and brain entry fall fast.");
  capEl = mk("text", { class: "nn-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { prod: 0.3, bil: 0.2, brain: 0, excr: 0.4, conj: 0.4, photo: 0, exch: 0, feed: 1, haem: 0 };
const acc = { bili: 0, alb: 0, ent: 0, light: 0 };
function init() { initOrgans(); initRbcs(); initUgt(); initBbb(); initPanel(); albP.forEach((p, i) => { emit(p, rnd(30, 530), 335, 0); p.x = 30 + i * 38; }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.prod = lerp(sm.prod, m.prod, k2); sm.bil = lerp(sm.bil, m.bil, k2); sm.brain = lerp(sm.brain, m.brain, k2); sm.excr = lerp(sm.excr, m.excr, k2); sm.conj = lerp(sm.conj, m.conj, k2); sm.photo = lerp(sm.photo, m.photo, k1); sm.exch = lerp(sm.exch, m.exch, k1); sm.feed = lerp(sm.feed, m.feed, k2); sm.haem = lerp(sm.haem, m.haem, k2);
  rbcs.forEach((r) => { const frag = 0.85 + 0.15 * Math.sin(tm / (700 - sm.prod * 300) + r.ph); place(r.g, r.x, r.y, Math.sin(tm / 900 + r.ph) * 8, frag); r.g.style.opacity = 0.55 + 0.45 * sm.prod; });
  ugts.forEach((u) => { place(u.g, u.x, u.y, 0, 0.5 + 0.6 * sm.conj); u.g.style.opacity = (0.25 + 0.75 * sm.conj).toFixed(2); });
  bbbCells.forEach((g, i) => { g.style.opacity = (0.95 - 0.55 * sm.brain).toFixed(2); });
  layers.skinOv.setAttribute("opacity", (sm.bil * 0.85).toFixed(2));
  layers.brainOv.setAttribute("opacity", (sm.brain * 0.75).toFixed(2));
  /* phototherapy rig: lamp shimmers, cone and skin glow sit over the skin */
  layers.lamp.setAttribute("opacity", (sm.photo * (0.7 + 0.3 * Math.sin(tm / 240))).toFixed(2));
  layers.cone.setAttribute("opacity", (sm.photo * 0.4).toFixed(2));
  layers.glow.setAttribute("opacity", (sm.photo * (0.35 + 0.15 * Math.sin(tm / 300))).toFixed(2));
  /* exchange rig: clean blood washes the lumen and the arrows pulse */
  layers.clean.setAttribute("opacity", (sm.exch * 0.55).toFixed(2));
  layers.exchG.setAttribute("opacity", (sm.exch * (0.7 + 0.3 * Math.sin(tm / 300))).toFixed(2));
  /* light particles rain from the lamp onto the skin while phototherapy is on */
  acc.light += dt * 22 * sm.photo;
  while (acc.light >= 1) { acc.light--; const p = freeP(lightP); if (p) { emit(p, 605 + Math.random() * 60, 272, 0); p.vy = 130; } }
  lightP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x += Math.sin(tm / 240 + p.t * 6) * 10 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > skinSurf[1] - 4 || p.t > 3) kill(p); });
  /* spawn bilirubin from red cells */
  acc.bili += dt * (1.2 + 7 * sm.prod); while (acc.bili >= 1) { acc.bili--; const p = freeP(bili); if (p) emit(p, rnd(60, 260), rnd(100, 190), 0); }
  bili.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { if (moveTo(p, liverEntry[0], liverEntry[1], 62, dt) < 12) { if (Math.random() < sm.conj * 0.85) { kill(p); const c = freeP(conj); if (c) emit(c, gallPt[0], gallPt[1], 0); } else { p.k = 1; } } }
    else if (p.k === 1) { if (moveTo(p, bloodL, bloodY, 70, dt) < 10) p.k = 2; }
    else if (p.k === 2) { p.x += 62 * dt; p.y = bloodY + Math.sin(tm / 300 + p.t * 3) * 10; if (sm.photo > 0.5 && Math.random() < dt * 1.8) { kill(p); const c = freeP(conj); if (c) emit(c, p.x, p.y, 1); } else if (sm.exch > 0.5 && Math.random() < dt * 2.4) { kill(p); } else if (p.x > bloodR - 10) { p.k = (Math.random() < clamp(sm.brain * 1.6)) ? 3 : 4; } }
    else if (p.k === 3) { if (moveTo(p, parenPt[0], parenPt[1], 58, dt) < 12 || p.t > 9) kill(p); }
    else { if (moveTo(p, skinDerm[0], skinDerm[1], 58, dt) < 12 || p.t > 9) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 14) kill(p);
  });
  conj.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { if (moveTo(p, bowelCoils[0], bowelCoils[1], 66, dt) < 10) p.k = 2; }
    else if (p.k === 2) { p.y += 34 * dt; p.x += Math.sin(tm / 250 + p.t) * 8 * dt; if (p.y > bowelOut[1] + 30 || p.t > 8) kill(p); }
    else { p.y += 46 * dt; if (p.y > 432 || p.t > 6) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  /* albumin carriers drift in blood */
  albP.forEach((p) => { if (!p.on) return; p.x += (26 + 30 * sm.bil) * dt; if (p.x > 540) p.x = 28; p.y = bloodY + Math.sin(tm / 420 + p.x / 40) * 10; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.5 * sm.bil).toFixed(2)); });
  /* enterohepatic return: gut back toward liver, less with feeding */
  acc.ent += dt * (1 - sm.feed * 0.75) * (0.4 + sm.bil) * 3; while (acc.ent >= 1) { acc.ent--; const p = freeP(ent); if (p) emit(p, bowelOut[0], bowelOut[1], bowelOut[1]); }
  ent.forEach((p) => { if (!p.on) return; p.t += dt; p.x -= 52 * dt; p.y = p.k + Math.sin(tm / 300 + p.t * 2) * 4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 600 || p.t > 7) kill(p); });
  gg.prod.set(sm.prod, wordOf(sm.prod, 0.35, 0.65, ["steady", "raised", "high"])); gg.bil.set(sm.bil, wordOf(sm.bil, 0.28, 0.58, ["mild", "raised", "high"])); gg.brain.set(sm.brain, wordOf(sm.brain, 0.12, 0.45, ["minimal", "possible", "likely"])); gg.excr.set(sm.excr, wordOf(sm.excr, 0.35, 0.62, ["low", "steady", "good"]));
  const key = drug + ":" + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
