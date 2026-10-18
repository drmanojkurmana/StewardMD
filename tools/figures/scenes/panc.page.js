/* Acute pancreatitis scene: triggers, acinar cells in a real pancreas, active trypsin, autodigestion, fat necrosis, systemic leak and gauges. */
const WW = SC.W, FAT = SC.FAT;
const layers = { cells: $("cells"), spots: $("spots"), rbc: $("rbcs2"), parts: $("parts"), over: $("over"), panel: $("panel"), inj: $("inj"), halo: $("painHalo"), stone: $("stone"), vessel: $("vessel"), vwallT: $("vwallT"), vwallB: $("vwallB") };
let pancO = null, capEl = null, capDrug = -1, trDuct = null, trDuo = null;
const VES = { cy: 262, y: 238, h: 48 };
function initOrgans() {
  pancO = organ($("pancSlot"), "pancreas", 450, 262, 340, {});
  const tail = pancO.ports.tail, out = pancO.ports.out;
  trDuct = track([[tail[0], tail[1]], [450, 279], [580, 296], [out[0], out[1]]]);
  trDuo = track([[out[0], out[1]], [650, 306], [664, 340]]);
}
function capText(d) {
  if (d === 1) return "The stone is removed. Juice drains again and enzyme activation falls.";
  if (d === 2) return "Fluids refill the leaky vessels. Blood flow to the organs recovers.";
  if (d === 3) return "Pain relief eases the pain. It does not switch off the enzymes.";
  if (d === 4) return "Feeding through the gut supports recovery while inflammation settles.";
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
/* ---- red cells in the systemic vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 9; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(818, 934), y: rnd(246, 278), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tryp = pool(36, () => mk("path", { class: "sc-p p-tryp", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const enz = pool(22, () => mk("circle", { class: "sc-p p-enz", r: 2.4 }, layers.parts));
const cyt = pool(28, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const alc = pool(10, () => mk("path", { class: "p-alc", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const juice = pool(12, () => mk("circle", { class: "sc-p p-juice", r: 2.2 }, layers.parts));
const drops = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bolus = pool(14, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const nut = pool(14, () => mk("circle", { class: "sc-p p-nut", r: 2.6 }, layers.parts));
const spark = pool(24, () => mk("path", { class: "sc-p p-spark", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
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
  pill(ox, "Alcohol", 132, 148, 105, 74, "Alcohol can injure acinar cells directly and make enzyme activation inside the cell more likely. One of the two common triggers.");
  pill(ox, "Acinar cell", 330, 252, 255, 74, "Acinar cell: makes digestive enzymes as inactive precursors (zymogens) that should only be switched on in the duodenum.");
  pill(ox, "Pancreatic duct", 450, 279, 440, 74, "The main pancreatic duct carries enzyme-rich juice to the duodenum. A blocked outlet raises pressure and favours early activation.");
  pill(ox, "Gallstone", 624, 292, 600, 74, "A gallstone can lodge at the shared outlet of the bile and pancreatic ducts and block it. One of the two common triggers.");
  pill(ox, "Gallbladder", 640, 126, 745, 74, "The gallbladder stores bile. Stones formed here can travel down the bile duct and block the outlet.");
  pill(ox, "Fat necrosis", 285, 378, 225, 388, "Fat necrosis: enzymes leaking from the pancreas split nearby fat, leaving chalky deposits. It marks more severe local injury.");
  pill(ox, "Active trypsin", 480, 282, 385, 388, "Trypsin switched on too early, inside the acinar cell. It turns on more enzymes and starts autodigestion.");
  pill(ox, "Autodigestion", 570, 290, 545, 388, "Autodigestion: the activated enzymes digest the pancreas itself, damaging tissue and blood vessels.");
  pill(ox, "Inflammation", 650, 295, 690, 388, "Inflammatory signals escape the pancreas, make vessels throughout the body leaky, and can affect the lungs, kidneys and circulation.");
  pill(ox, "Leaky vessel", 876, 290, 835, 388, "A blood vessel in the rest of the body. When inflamed it leaks fluid, so less blood reaches the organs unless fluids replace it.");
  const sr = pill(ox, "Stone removed", 624, 292, 800, 120, "Removing the blocking stone relieves the obstruction so pancreatic juice can drain again."); sr.setAttribute("id", "sr-pill");
  const fl = pill(ox, "Fluids", 876, 235, 880, 150, "Intravenous fluids refill the vessels while they leak, supporting blood flow to the organs."); fl.setAttribute("id", "fl-pill");
  const pr = pill(ox, "Pain relief", 320, 300, 138, 330, "Analgesia eases the pain. It does not switch off the enzymes or heal the pancreas."); pr.setAttribute("id", "pr-pill");
  const fd = pill(ox, "Feeding", 672, 320, 880, 355, "Nutrition support, usually feeding into the gut, helps recovery once the patient can tolerate it."); fd.setAttribute("id", "fd-pill");
  capEl = mk("text", { class: "pc-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { A: 0.4, D: 0.3, F: 0.2, I: 0.3, Pain: 0.4, Perf: 0.6, Leak: 0.2, stone: 0, fluids: 0, analg: 0, nutr: 0 };
const acc = { tryp: 0, enz: 0, cyt: 0, alc: 0, juice: 0, drop: 0, bolus: 0, nut: 0, cap: 0, spark: 0 };
function init() { initOrgans(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.A = lerp(sm.A, m.A, k2); sm.D = lerp(sm.D, m.D, k2); sm.F = lerp(sm.F, m.F, k2); sm.I = lerp(sm.I, m.I, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1); sm.Perf = lerp(sm.Perf, m.Perf, k1); sm.Leak = lerp(sm.Leak, m.Leak, k2);
  sm.stone = lerp(sm.stone, m.stone, k1); sm.fluids = lerp(sm.fluids, m.fluids, k1); sm.analg = lerp(sm.analg, m.analg, k1); sm.nutr = lerp(sm.nutr, m.nutr, k1);
  layers.inj.setAttribute("opacity", (sm.D * 0.45).toFixed(2));
  layers.halo.setAttribute("opacity", (sm.Pain * 0.4).toFixed(2));
  layers.stone.setAttribute("transform", "translate(624 " + f1(292 - sm.stone * 52) + ") scale(" + (1 - sm.stone * 0.92).toFixed(3) + ")");
  /* fluids visibly widen the vessel as they refill it */
  VES.h = 48 + 16 * sm.fluids; VES.y = VES.cy - VES.h / 2;
  layers.vessel.setAttribute("y", f1(VES.y)); layers.vessel.setAttribute("height", f1(VES.h));
  layers.vwallT.setAttribute("y", f1(VES.y - 6)); layers.vwallB.setAttribute("y", f1(VES.y + VES.h));
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
  acc.enz += dt * sm.D * 7; while (acc.enz >= 1) { acc.enz--; const p = free(enz); if (p) { const top = Math.random() < 0.5; emit(p, rnd(280, 600), top ? 190 : 330, rnd(-5, 5), top ? -rnd(12, 20) : rnd(12, 20), 0); } }
  enz.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) kill(p); });
  /* duct juice flows to the duodenum; the stone stalls it, removal lets it drain */
  acc.juice += dt * (3 + 4 * sm.stone); while (acc.juice >= 1) { acc.juice--; const p = free(juice); if (p) { emit(p, 293, 265, 0, 0, 1); p.st = 0; p.u = 0; } }
  juice.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.u += dt * (45 + 90 * sm.stone) / trDuct.len; const q = trDuct.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1);
      if (p.u >= 1) { if (sm.stone > 0.5) { p.st = 1; p.u = 0; } else kill(p); } }
    else { p.u += dt * 120 / trDuo.len; const q = trDuo.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); if (p.u >= 1) kill(p); } });
  /* inflammatory signals travel from the head to the systemic vessel */
  acc.cyt += dt * sm.I * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) emit(p, rnd(620, 650), rnd(280, 300), 0, 0, 0); }
  cyt.forEach((p) => { if (!p.on) return; const dx = 815 - p.x, dy = 262 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8) kill(p); });
  /* red cells flow with perfusion; the inflamed vessel leaks */
  rbcs.forEach((r) => { r.x += r.v * 46 * clamp(0.2 + sm.Perf) * dt; if (r.x > 940) r.x = 812; place(r.g, r.x, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.drop += dt * sm.Leak * 8; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(822, 930), VES.y + VES.h + 2, rnd(-3, 3), rnd(13, 20), 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 345) kill(p); });
  /* fluids refill the vessel */
  acc.bolus += dt * sm.fluids * 6; while (acc.bolus >= 1) { acc.bolus--; const p = free(bolus); if (p) emit(p, 818, rnd(244, 280), 85, 0, 0); }
  bolus.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 940) kill(p); });
  /* feeding droplets travel down the duodenum */
  acc.nut += dt * sm.nutr * 4; while (acc.nut >= 1) { acc.nut--; const p = free(nut); if (p) emit(p, 668, 200, 0, 0, 0); }
  nut.forEach((p) => { if (!p.on) return; p.t += dt; p.x = 672 + Math.sin(p.t * 1.6) * 14; p.y += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 330) kill(p); });
  /* analgesia capsules drift to the pancreas, dock, then fade */
  acc.cap += dt * sm.analg * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) { emit(p, rnd(180, 240), 196, 0, 0, 0); p.dx = rnd(330, 560); p.dy = rnd(240, 300); p.st = 0; } }
  caps.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += (p.dx - p.x) * dt * 0.9 + 12 * dt; p.y += (p.dy - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (Math.hypot(p.dx - p.x, p.dy - p.y) < 10) { p.st = 1; p.t = 0; } if (p.t > 6) kill(p); }
    else { p.e.setAttribute("transform", "translate(" + f1(p.dx + Math.sin(tm / 300) * 1.5) + " " + f1(p.dy) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 2.2) / 1).toFixed(2)); if (p.t > 3.2) kill(p); } });
  /* treatment pills fade with their treatment */
  $("fl-pill").style.opacity = sm.fluids.toFixed(2); $("sr-pill").style.opacity = sm.stone.toFixed(2); $("pr-pill").style.opacity = sm.analg.toFixed(2); $("fd-pill").style.opacity = sm.nutr.toFixed(2);
  /* gauges */
  gg.tryp.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["low", "raised", "high"])); gg.inj.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["mild", "moderate", "severe"])); gg.fat.set(sm.F, wordOf(sm.F, 0.25, 0.55, ["none", "some", "lots"]));
  gg.infl.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "raised", "high"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.perf.set(sm.Perf, wordOf(sm.Perf, 0.4, 0.62, ["low", "borderline", "ok"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
