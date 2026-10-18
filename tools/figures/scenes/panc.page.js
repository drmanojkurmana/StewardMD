/* Acute pancreatitis scene: triggers, acinar cells, active trypsin, autodigestion, fat necrosis, systemic leak and gauges. */
const WW = SC.W, FAT = SC.FAT;
const layers = { cells: $("cells"), spots: $("spots"), rbc: $("rbcs2"), parts: $("parts"), over: $("over"), panel: $("panel"), inj: $("inj"), halo: $("painHalo"), stone: $("stone"), vessel: $("vessel") };
/* ---- acinar cells with zymogen granules ---- */
const acini = [[255, 240], [320, 282], [385, 238], [450, 282], [515, 238], [580, 282], [645, 238], [690, 278], [350, 300], [610, 220]].map(([x, y], i) => {
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
const juice = pool(10, () => mk("circle", { class: "sc-p p-juice", r: 2.2 }, layers.parts));
const drops = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bolus = pool(14, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const nut = pool(14, () => mk("circle", { class: "sc-p p-nut", r: 2.6 }, layers.parts));
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
  pill(ox, "Acinar cell", 340, 235, 255, 74, "Acinar cell: makes digestive enzymes as inactive precursors (zymogens) that should only be switched on in the duodenum.");
  pill(ox, "Pancreatic duct", 480, 258, 440, 74, "The main pancreatic duct carries enzyme-rich juice to the duodenum. A blocked outlet raises pressure and favours early activation.");
  pill(ox, "Gallstone", 716, 198, 610, 74, "A gallstone can lodge at the shared outlet of the bile and pancreatic ducts and block it. One of the two common triggers.");
  pill(ox, "Gallbladder", 705, 126, 745, 74, "The gallbladder stores bile. Stones formed here can travel down the bile duct and block the outlet.");
  pill(ox, "Fat necrosis", 272, 350, 225, 388, "Fat necrosis: enzymes leaking from the pancreas split nearby fat, leaving chalky deposits. It marks more severe local injury.");
  pill(ox, "Active trypsin", 450, 290, 385, 388, "Trypsin switched on too early, inside the acinar cell. It turns on more enzymes and starts autodigestion.");
  pill(ox, "Autodigestion", 580, 300, 545, 388, "Autodigestion: the activated enzymes digest the pancreas itself, damaging tissue and blood vessels.");
  pill(ox, "Inflammation", 720, 300, 690, 388, "Inflammatory signals escape the pancreas, make vessels throughout the body leaky, and can affect the lungs, kidneys and circulation.");
  pill(ox, "Leaky vessel", 876, 286, 835, 388, "A blood vessel in the rest of the body. When inflamed it leaks fluid, so less blood reaches the organs unless fluids replace it.");
  const fl = pill(ox, "Fluids", 876, 238, 860, 150, "Intravenous fluids refill the vessels while they leak, supporting blood flow to the organs."); fl.setAttribute("id", "fl-pill");
  const sr = pill(ox, "Stone removed", 716, 198, 855, 188, "Removing the blocking stone relieves the obstruction so pancreatic juice can drain again."); sr.setAttribute("id", "sr-pill");
  const pr = pill(ox, "Pain relief", 230, 280, 140, 330, "Analgesia eases the pain. It does not switch off the enzymes or heal the pancreas."); pr.setAttribute("id", "pr-pill");
  const fd = pill(ox, "Feeding", 778, 315, 880, 355, "Nutrition support, usually feeding into the gut, helps recovery once the patient can tolerate it."); fd.setAttribute("id", "fd-pill");
}
const sm = { A: 0.4, D: 0.3, F: 0.2, I: 0.3, Pain: 0.4, Perf: 0.6, Leak: 0.2, stone: 0, fluids: 0, analg: 0, nutr: 0 };
const acc = { tryp: 0, enz: 0, cyt: 0, alc: 0, juice: 0, drop: 0, bolus: 0, nut: 0, cap: 0 };
function init() { initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.A = lerp(sm.A, m.A, k2); sm.D = lerp(sm.D, m.D, k2); sm.F = lerp(sm.F, m.F, k2); sm.I = lerp(sm.I, m.I, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1); sm.Perf = lerp(sm.Perf, m.Perf, k1); sm.Leak = lerp(sm.Leak, m.Leak, k2);
  sm.stone = lerp(sm.stone, m.stone, k1); sm.fluids = lerp(sm.fluids, m.fluids, k1); sm.analg = lerp(sm.analg, m.analg, k1); sm.nutr = lerp(sm.nutr, m.nutr, k1);
  layers.inj.setAttribute("opacity", (sm.D * 0.45).toFixed(2));
  layers.halo.setAttribute("opacity", (sm.Pain * 0.28).toFixed(2));
  layers.stone.setAttribute("transform", "translate(716 " + f1(198 - sm.stone * 52) + ") scale(" + (1 - sm.stone * 0.92).toFixed(3) + ")");
  acini.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1600 + c.ph) * 2, c.y + Math.cos(tm / 1900 + c.ph) * 2, Math.sin(tm / 2800 + c.ph) * 5, 1 + 0.07 * sm.A * Math.sin(tm / 320 + i)));
  spots.forEach((s) => place(s.g, s.x, s.y, 0, Math.max(0.02, sm.F * s.k)));
  /* alcohol droplets drift to the pancreatic tail */
  acc.alc += dt * 1.6; while (acc.alc >= 1) { acc.alc--; const p = free(alc); if (p) emit(p, rnd(120, 165), rnd(165, 190), 0, 0, 0); }
  alc.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (212 - p.x) * dt * 0.8 + 10 * dt; p.y += (248 - p.y) * dt * 0.8; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); });
  /* active trypsin bursts out of acinar cells */
  acc.tryp += dt * sm.A * 13; while (acc.tryp >= 1) { acc.tryp--; const p = free(tryp), c = pick(acini); if (p && c) emit(p, c.x + rnd(-10, 10), c.y + rnd(-8, 8), rnd(-26, 26), rnd(-24, 24), 0); }
  tryp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4) / 0.9).toFixed(2)); if (p.t > 2.3) kill(p); });
  /* enzymes spill to the surrounding fat */
  acc.enz += dt * sm.D * 7; while (acc.enz >= 1) { acc.enz--; const p = free(enz); if (p) { const top = Math.random() < 0.5; emit(p, rnd(250, 680), top ? 190 : 326, rnd(-5, 5), top ? -rnd(12, 20) : rnd(12, 20), 0); } }
  enz.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) kill(p); });
  /* duct juice flows to the duodenum, slowed while the outlet is blocked */
  acc.juice += dt * (2 + 5 * sm.stone); while (acc.juice >= 1) { acc.juice--; const p = free(juice); if (p) emit(p, 226, 258 + rnd(-3, 3), 55 + 60 * sm.stone, 0, 0); }
  juice.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 700) kill(p); });
  /* inflammatory signals travel from the head to the systemic vessel */
  acc.cyt += dt * sm.I * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) emit(p, rnd(700, 730), rnd(255, 285), 0, 0, 0); }
  cyt.forEach((p) => { if (!p.on) return; const dx = 838 - p.x, dy = 262 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8) kill(p); });
  /* red cells flow with perfusion; the inflamed vessel leaks */
  rbcs.forEach((r) => { r.x += r.v * 46 * clamp(0.2 + sm.Perf) * dt; if (r.x > 940) r.x = 812; place(r.g, r.x, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.drop += dt * sm.Leak * 8; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(822, 930), 294, rnd(-3, 3), rnd(13, 20), 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 340) kill(p); });
  /* fluids refill the vessel */
  acc.bolus += dt * sm.fluids * 6; while (acc.bolus >= 1) { acc.bolus--; const p = free(bolus); if (p) emit(p, 818, rnd(246, 278), 85, 0, 0); }
  bolus.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 940) kill(p); });
  /* feeding droplets travel down the duodenum */
  acc.nut += dt * sm.nutr * 4; while (acc.nut >= 1) { acc.nut--; const p = free(nut); if (p) emit(p, 758, 192, 0, 0, 0); }
  nut.forEach((p) => { if (!p.on) return; p.t += dt; p.x = 772 + Math.sin(p.t * 1.6) * 16; p.y += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 322) kill(p); });
  /* analgesia capsules drift to the pancreas */
  acc.cap += dt * sm.analg * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(180, 240), 196, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (400 - p.x) * dt * 0.5 + 12 * dt; p.y += (258 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.6) / 1.4).toFixed(2)); if (p.t > 5) kill(p); });
  /* treatment pills fade with their treatment */
  $("fl-pill").style.opacity = sm.fluids.toFixed(2); $("sr-pill").style.opacity = sm.stone.toFixed(2); $("pr-pill").style.opacity = sm.analg.toFixed(2); $("fd-pill").style.opacity = sm.nutr.toFixed(2);
  /* gauges */
  gg.tryp.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["low", "raised", "high"])); gg.inj.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["mild", "moderate", "severe"])); gg.fat.set(sm.F, wordOf(sm.F, 0.25, 0.55, ["none", "some", "lots"]));
  gg.infl.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "raised", "high"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.perf.set(sm.Perf, wordOf(sm.Perf, 0.4, 0.62, ["low", "borderline", "ok"]));
}
run({ init, step });
