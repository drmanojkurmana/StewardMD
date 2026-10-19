/* Acute pancreatitis scene: triggers, acinar cells in a real pancreas, active trypsin, autodigestion, fat necrosis, systemic leak and gauges. */
const WW = SC.W, FAT = SC.FAT;
const layers = { cells: $("cells"), spots: $("spots"), rbc: $("rbcs2"), parts: $("parts"), over: $("over"), panel: $("panel"), inj: $("inj"), halo: $("painHalo"), stone: $("stone"), bile: $("bile"), tube: $("feedTube") };
let pancO = null, liverO = null, bowelO = null, vesselO = null, capEl = null, capKey = "";
let trDuct = null, trDuo = null, trFeed = null;
let coils = [691, 266], vesL = [836, 250], vesWall = [910, 262], vesCX = 876, tubeTop = [690, 58];
const STONE = [624, 292];
function initOrgans() {
  pancO = organ($("pancSlot"), "pancreas", 450, 262, 340, {});
  liverO = organ($("liverSlot"), "liver", 600, 108, 185, {});
  bowelO = organ($("bowelSlot"), "bowel", 688, 266, 130, {});
  vesselO = organ($("vesselSlot"), "vessel", 876, 262, 84, { h: 175 });
  const tail = pancO.ports.tail, out = pancO.ports.out;
  trDuct = track([tail, [450, 279], [580, 296], out]);
  const bi = bowelO.ports.in, co = bowelO.ports.coils, bo = bowelO.ports.out;
  coils = [co[0], co[1]];
  trDuo = track([out, [(out[0] + bi[0]) / 2, (out[1] + bi[1]) / 2 - 6], bi, co]);
  /* feed tube drops from the top of the stage into the bowel, then feed runs through it */
  tubeTop = [Math.round(bi[0]), 58];
  layers.tube.setAttribute("d", "M" + f1(tubeTop[0]) + " 58 L" + f1(tubeTop[0] + 6) + " " + f1(bi[1] - 40) + " L" + f1(bi[0]) + " " + f1(bi[1]));
  trFeed = track([tubeTop, [tubeTop[0] + 6, bi[1] - 40], bi, co, bo]);
  /* bile duct runs from the liver gallbladder down to the blocked outlet */
  const gp = liverO.ports.gall;
  layers.bile.setAttribute("d", "M" + f1(gp[0]) + " " + f1(gp[1])
    + " C" + f1(gp[0] + 8) + " " + f1(gp[1] + 55) + " " + f1(STONE[0] - 16) + " " + f1(STONE[1] - 62)
    + " " + f1(STONE[0]) + " " + f1(STONE[1] - 8));
  /* inflammatory signals enter the vessel at its left edge; leaks leave from its right wall */
  vesCX = vesselO.x;
  vesL = [Math.round(vesselO.x - vesselO.w / 2 + 2), Math.round(vesselO.y - 12)];
  const wp = vesselO.ports.wall;
  vesWall = [wp[0], wp[1]];
}
function capText(d, l) {
  if (d === 1) return "The stone is removed. Juice drains again and enzyme activation falls.";
  if (d === 2) return "Fluids refill the leaky vessels. Blood flow to the organs recovers.";
  if (d === 3) return "Pain relief eases the pain. It does not switch off the enzymes.";
  if (d === 4) return "Liquid feed through the gut supports recovery while inflammation settles.";
  if (l === 2) return "No treatment. Severe attack. Enzymes digest the pancreas and fluid leaks from vessels.";
  if (l === 0) return "No treatment. Mild attack. Some enzymes switch on inside the pancreas.";
  return "No treatment. Enzymes switch on inside the pancreas and digest it.";
}
/* ---- acinar cells with zymogen granules, sitting in the pancreatic parenchyma ---- */
const acini = [[330, 252], [380, 278], [430, 250], [480, 282], [530, 256], [570, 276], [352, 284], [420, 298], [500, 298], [600, 286]].map(([x, y], i) => {
  const g = cell(layers.cells, { cls: "acinar", r: 17, nuc: 0.38, seed: i * 2 + 1, wob: 0.12 });
  for (let j = 0; j < 3; j++) mk("circle", { class: "pc-gran", r: 1.8, cx: rnd(-8, 8), cy: rnd(-7, 7) }, g);
  return { g, x, y, ph: i * 1.7 };
});
/* ---- fat necrosis chalk spots ---- */
const spots = FAT.map(([x, y], i) => { const g = mk("g", {}, layers.spots); mk("circle", { class: "pc-chalk", r: 4 + (i % 3) * 1.6 }, g); return { g, x: x + ((i % 5) - 2) * 3, y: y + ((i % 4) - 1.5) * 3, k: 0.45 + (i % 5) * 0.13 }; });
/* ---- red cells flowing down inside the upright vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 9; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 4.8, ry: 8 }, g); mk("ellipse", { class: "cl-s", rx: 1.5, ry: 3 }, g); rbcs.push({ g, x: rnd(866, 886), y: rnd(190, 340), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tryp = pool(36, () => mk("path", { class: "sc-p p-tryp", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const enz = pool(22, () => mk("circle", { class: "sc-p p-enz", r: 2.4 }, layers.parts));
const cyt = pool(28, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const alc = pool(10, () => mk("path", { class: "p-alc", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const juice = pool(12, () => mk("circle", { class: "sc-p p-juice", r: 2.2 }, layers.parts));
const drops = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bolus = pool(14, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const nut = pool(14, () => mk("circle", { class: "sc-p p-nut", r: 3 }, layers.parts));
const spark = pool(24, () => mk("path", { class: "sc-p p-spark", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "pc-capA", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "pc-capB", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["tryp", "Trypsin", "g-tryp", "Trypsin switched on inside acinar cells, before the enzymes reach the gut. It activates other digestive enzymes."], ["inj", "Injury", "g-bad", "Autodigestion: active enzymes digest pancreatic tissue itself, injuring cells and small vessels."], ["fat", "Fat necrosis", "g-fat", "Enzymes split fat around the pancreas. The released fat binds calcium and forms chalky white deposits."], ["infl", "Inflammation", "g-cyt", "Inflammatory signals from the injured pancreas spread through the body and make vessels leaky."], ["pain", "Pain", "g-pain", "Severe upper abdominal pain is the hallmark symptom, driven by inflammation and swelling of the pancreas."], ["perf", "Perfusion", "g-good", "How well blood reaches the organs. It falls as fluid leaks out of vessels, and fluids help restore it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Alcohol", 132, 148, 105, 74, "Alcohol can injure acinar cells directly, so enzymes switch on inside the cell. One of the two common triggers.");
  pill(ox, "Acinar cell", 330, 252, 255, 74, "Acinar cell: makes digestive enzymes as inactive precursors that should only switch on in the gut.");
  pill(ox, "Pancreatic duct", 450, 279, 440, 74, "The main pancreatic duct carries enzyme rich juice to the gut. A blocked outlet raises pressure and favours early switch on.");
  pill(ox, "Gallstone", STONE[0], STONE[1], 620, 74, "A stone from the gallbladder, seen under the liver, can lodge where the bile and pancreatic ducts meet and block the outlet.");
  pill(ox, "Fat necrosis", 285, 378, 225, 388, "Fat necrosis: enzymes leaking from the pancreas split nearby fat, leaving chalky deposits. It marks worse local injury.");
  pill(ox, "Active trypsin", 480, 282, 400, 388, "Trypsin switched on too early, inside the acinar cell. It turns on more enzymes and starts self digestion.");
  pill(ox, "Gut", coils[0], coils[1], 620, 388, "The small bowel receives pancreatic juice once the outlet is open, and liquid feed that supports healing.");
  pill(ox, "Leaky vessel", vesWall[0], vesWall[1] + 18, 835, 388, "A blood vessel in the rest of the body. Inflammation makes it leak fluid, so less blood reaches the organs unless fluids replace it.");
  capEl = mk("text", { class: "pc-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { A: 0.4, D: 0.3, F: 0.2, I: 0.3, Pain: 0.4, Perf: 0.6, Leak: 0.2, stone: 0, fluids: 0, analg: 0, nutr: 0 };
const acc = { tryp: 0, enz: 0, cyt: 0, alc: 0, juice: 0, drop: 0, bolus: 0, nut: 0, cap: 0, spark: 0 };
function init() { initOrgans(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.A = lerp(sm.A, m.A, k2); sm.D = lerp(sm.D, m.D, k2); sm.F = lerp(sm.F, m.F, k2); sm.I = lerp(sm.I, m.I, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1); sm.Perf = lerp(sm.Perf, m.Perf, k1); sm.Leak = lerp(sm.Leak, m.Leak, k2);
  sm.stone = lerp(sm.stone, m.stone, k1); sm.fluids = lerp(sm.fluids, m.fluids, k1); sm.analg = lerp(sm.analg, m.analg, k1); sm.nutr = lerp(sm.nutr, m.nutr, k1);
  layers.inj.setAttribute("opacity", (sm.D * 0.45).toFixed(2));
  /* pain halo shrinks and fades as pain eases */
  layers.halo.setAttribute("opacity", (sm.Pain * 0.4).toFixed(2));
  layers.halo.setAttribute("rx", f1(282 * (0.45 + 0.55 * clamp(sm.Pain))));
  /* the stone lifts away and vanishes once removed */
  layers.stone.setAttribute("transform", "translate(" + STONE[0] + " " + f1(STONE[1] - sm.stone * 52) + ") scale(" + (1 - sm.stone * 0.92).toFixed(3) + ")");
  layers.stone.setAttribute("opacity", (1 - sm.stone).toFixed(2));
  /* fluids visibly widen the upright vessel as they refill it */
  const vsx = 1 + 0.3 * sm.fluids;
  vesselO.g.setAttribute("transform", "translate(" + f1(vesCX) + " 262) scale(" + vsx.toFixed(3) + " 1)");
  /* feed tube appears only while feeding */
  layers.tube.setAttribute("opacity", sm.nutr.toFixed(2));
  acini.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1600 + c.ph) * 2, c.y + Math.cos(tm / 1900 + c.ph) * 2, Math.sin(tm / 2800 + c.ph) * 5, 1 + 0.07 * sm.A * Math.sin(tm / 320 + i)));
  spots.forEach((s) => place(s.g, s.x, s.y, 0, Math.max(0.02, sm.F * s.k)));
  /* alcohol droplets drift to the pancreatic tail */
  acc.alc += dt * 1.6; while (acc.alc >= 1) { acc.alc--; const p = free(alc); if (p) emit(p, rnd(120, 165), rnd(165, 190), 0, 0, 0); }
  alc.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (283 - p.x) * dt * 0.8 + 10 * dt; p.y += (261 - p.y) * dt * 0.8; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); });
  /* active trypsin bursts out of acinar cells */
  acc.tryp += dt * sm.A * 13; while (acc.tryp >= 1) { acc.tryp--; const p = free(tryp), c = pick(acini); if (p && c) emit(p, c.x + rnd(-10, 10), c.y + rnd(-8, 8), rnd(-26, 26), rnd(-24, 24), 0); }
  tryp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4) / 0.9).toFixed(2)); if (p.t > 2.3) kill(p); });
  /* pain signals radiate from the inflamed pancreas and fade with analgesia */
  acc.spark += dt * sm.Pain * 9; while (acc.spark >= 1) { acc.spark--; const p = free(spark); if (p) emit(p, rnd(300, 600), rnd(230, 320), rnd(-15, 15), rnd(-30, -10), 0); }
  spark.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 0.5) / 0.7).toFixed(2)); if (p.t > 1.2) kill(p); });
  /* enzymes spill to the surrounding fat */
  acc.enz += dt * sm.D * 7; while (acc.enz >= 1) { acc.enz--; const p = free(enz); if (p) { const top = Math.random() < 0.5; emit(p, top ? rnd(270, 440) : rnd(280, 600), top ? 190 : 330, rnd(-5, 5), top ? -rnd(12, 20) : rnd(12, 20), 0); } }
  enz.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) kill(p); });
  /* duct juice flows to the gut; the stone stalls it, removal lets it drain and be absorbed */
  acc.juice += dt * (3 + 4 * sm.stone); while (acc.juice >= 1) { acc.juice--; const p = free(juice); if (p) { emit(p, 293, 265, 0, 0, 0); p.st = 0; p.u = 0; } }
  juice.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.u += dt * (45 + 90 * sm.stone) / trDuct.len; const q = trDuct.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1);
      if (p.u >= 1) { if (sm.stone > 0.5) { p.st = 1; p.u = 0; } else kill(p); } }
    else { p.u += dt * 120 / trDuo.len; const q = trDuo.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", (1 - p.u * 0.7).toFixed(2)); if (p.u >= 1) kill(p); } });
  /* inflammatory signals travel from the head into the upright vessel */
  acc.cyt += dt * sm.I * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) emit(p, rnd(620, 650), rnd(280, 300), 0, 0, 0); }
  cyt.forEach((p) => { if (!p.on) return; const dx = vesL[0] - p.x, dy = vesL[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 10) kill(p); });
  /* red cells run down the vessel with perfusion; the inflamed wall leaks from its side */
  const spread = 10 + 8 * sm.fluids;
  rbcs.forEach((r) => { r.y += r.v * 52 * clamp(0.25 + sm.Perf) * dt; if (r.y > 348) { r.y = 180; r.x = vesCX + rnd(-spread, spread); } place(r.g, r.x, r.y, Math.sin(tm / 500 + r.y) * 8, 1); });
  acc.drop += dt * sm.Leak * 8; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, vesCX + (vesWall[0] - vesCX) * vsx + rnd(-4, 4), rnd(225, 300), rnd(10, 22), rnd(6, 16), 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 952 || p.y > 365) kill(p); });
  /* fluids pour in through the top of the vessel */
  acc.bolus += dt * sm.fluids * 6; while (acc.bolus >= 1) { acc.bolus--; const p = free(bolus); if (p) emit(p, vesCX + rnd(-12, 12), 182, 0, 95, 0); }
  bolus.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 300) / 45).toFixed(2)); if (p.y > 345) kill(p); });
  /* liquid feed runs down the tube and through the gut, fading as it is absorbed */
  acc.nut += dt * sm.nutr * 7; while (acc.nut >= 1) { acc.nut--; const p = free(nut); if (p) { emit(p, tubeTop[0], tubeTop[1], 0, 0, 0); p.u = 0; } }
  nut.forEach((p) => { if (!p.on) return; p.u += dt * 95 / trFeed.len; const q = trFeed.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", (1 - Math.max(0, p.u - 0.6) / 0.4 * 0.85).toFixed(2)); if (p.u >= 1) kill(p); });
  /* analgesia capsules drift to the pancreas, dock, then fade */
  acc.cap += dt * sm.analg * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) { emit(p, rnd(180, 240), 196, 0, 0, 0); p.dx = rnd(330, 560); p.dy = rnd(240, 300); p.st = 0; } }
  caps.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += (p.dx - p.x) * dt * 0.9 + 12 * dt; p.y += (p.dy - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (Math.hypot(p.dx - p.x, p.dy - p.y) < 10) { p.st = 1; p.t = 0; } if (p.t > 6) kill(p); }
    else { p.e.setAttribute("transform", "translate(" + f1(p.dx + Math.sin(tm / 300) * 1.5) + " " + f1(p.dy) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 2.2) / 1).toFixed(2)); if (p.t > 3.2) kill(p); } });
  /* gauges */
  gg.tryp.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["low", "raised", "high"])); gg.inj.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["mild", "moderate", "severe"])); gg.fat.set(sm.F, wordOf(sm.F, 0.25, 0.55, ["none", "some", "lots"]));
  gg.infl.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "raised", "high"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.perf.set(sm.Perf, wordOf(sm.Perf, 0.4, 0.62, ["low", "borderline", "ok"]));
  const key = drug * 10 + (drug === 0 ? level : 0);
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
