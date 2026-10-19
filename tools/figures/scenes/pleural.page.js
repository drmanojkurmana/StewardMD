/* Pleural effusion scene: real lungs, pleural fluid, Starling forces, leak, drainage and pleurodesis. */
const layers = { slot: $("lungSlot"), parts: $("parts"), over: $("over"), panel: $("panel"), fluid: $("fluidPath"), mini: $("miniFluid"), drainG: $("drainG"), seal: $("sealPath"), adh: $("adhG"), talc: $("talcG"), memb: $("membPath"), push: $("pushArrow"), endo2: $("endo2") };
/* ---- the real lungs, and the needle track for the drainage stream ---- */
let lungO = null, capEl = null, capKey = "";
const TIP = [438, 400], OUT = [548, 296];
let outTrack = null;
function initOrgans() {
  lungO = organ(layers.slot, "lung", 300, 255, 230, {});
  outTrack = track([TIP, [493, 348], OUT]);
}
/* ---- capillary lining in the close up ---- */
for (let i = 0; i < 11; i++) { cell(layers.endo2, { cls: "endo", r: 10, nuc: 0.3, seed: i + 3, wob: 0.08, x: 592 + i * 28, y: 172 }); cell(layers.endo2, { cls: "endo", r: 10, nuc: 0.3, seed: i + 30, wob: 0.08, x: 592 + i * 28, y: 204 }); }
/* ---- particle pools ---- */
function pool(n, build, parent) { return Array.from({ length: n }, () => { const e = build(parent); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const drops = pool(26, (p) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, p), layers.parts);
const ddrops = pool(24, (p) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, p), layers.parts);
const prots = pool(34, (p) => mk("circle", { class: "sc-p p-prot", r: 3 }, p), layers.parts);
const out = pool(10, (p) => mk("circle", { class: "p-fl", r: 3.2 }, p), layers.parts);
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- pleurodesis adhesions round the rim, and sealant dots on the membrane ---- */
function initDots() {
  for (let x = 140; x <= 460; x += 40) mk("circle", { class: "sc-p p-adh", cx: x, cy: 132, r: 3 }, layers.adh);
  for (let y = 170; y <= 370; y += 40) { mk("circle", { class: "sc-p p-adh", cx: 112, cy: y, r: 3 }, layers.adh); mk("circle", { class: "sc-p p-adh", cx: 488, cy: y, r: 3 }, layers.adh); }
  for (let i = 0; i < 8; i++) mk("circle", { class: "sc-p p-talc", cx: 600 + i * 37, cy: 264, r: 2.6 }, layers.talc);
  out.forEach((p, i) => { p.u = i / out.length; });
}
/* ---- plain language story line for the stage ---- */
function capText(l, d) {
  if (d === 3) return "Pleurodesis seals the pleural space. The lung stays expanded and fluid cannot easily return.";
  if (d === 2) return "Drainage draws fluid out through a needle. The lung re expands, but fluid can build up again.";
  if (d === 1) return "Treating the cause slows new fluid and protein leak. The effusion shrinks and breathing eases.";
  return l === 0 ? "No treatment. A small effusion sits above the diaphragm and breathing is still easy."
    : l === 1 ? "No treatment. Fluid squeezes the lung and breathing is hard."
    : "No treatment. A large effusion crushes the lung and breathing is very hard.";
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vol", "Effusion", "g-fl", "Fluid in the pleural space. It collects at the base and blunts the angle between lung and diaphragm."], ["form", "Formation", "g-fl", "How fast new pleural fluid is forming. Treating the cause slows this down."], ["prot", "Protein", "g-prot", "Protein in the fluid. Low protein suggests a transudate; high protein and LDH compared with serum suggest an exudate (Light criteria idea)."], ["cmp", "Compression", "g-comp", "How much the effusion squeezes the lung and stops it expanding."], ["br", "Breathing", "g-bad", "Breathlessness from the compressed lung. It eases as fluid is removed."], ["rec", "Reaccurs", "g-bac", "Chance of fluid building up again. Drainage removes fluid but it can return; pleurodesis seals the space and makes return unlikely."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Lung", 350, 160, 310, 118, "Lung. Fluid in the pleural space presses on it, so it cannot fully expand and breath sounds fade over the fluid.");
  pill(ox, "Chest wall", 100, 250, 150, 86, "Chest wall and ribs. The parietal pleura lines the inside of the wall and makes most pleural fluid.");
  pill(ox, "Pleural fluid", 200, 398, 175, 350, "Pleural fluid. Only a thin film is normal. Extra fluid collects at the base first and dulls percussion. A sample is taken with a needle.");
  pill(ox, "Capillary", 640, 188, 620, 86, "A capillary in the pleura, close up. Starling forces decide whether fluid leaves the blood or returns to it.");
  pill(ox, "Push out", 760, 234, 810, 86, "Push out. Blood pressure pushes watery low protein fluid out, as in heart failure.");
  pill(ox, "Pull in", 650, 236, 620, 150, "Pull in. Blood proteins pull fluid back in. When blood protein is low, less fluid returns.");
  pill(ox, "Leaky gap", 698, 270, 715, 240, "Leaky gaps in the membrane. Inflammation or tumour opens gaps, so protein rich fluid escapes. Treating the cause closes them, and sealing the space stops return.");
  const dp = pill(ox, "Drain", 493, 348, 452, 292, "Drainage needle. It draws fluid out so the lung re expands and gives fluid to test, but fluid can build up again."); dp.setAttribute("id", "drain-pill");
  capEl = mk("text", { class: "pl-story", x: 30, y: 428 }, ox); capEl.textContent = capText(level, drug); capKey = level + ":" + drug;
}
const sm = { V: 0.4, Form: 0.4, Prot: 0.4, Leak: 0.4, Cmp: 0.2, Recur: 0.3, treat: 0, drain: 0, pleuro: 0 };
const acc = { drop: 0, ddrop: 0, prot: 0 };
function init() { initOrgans(); initDots(); initPanel(); }
function step(dt, m) {
  const kf = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.5);
  sm.V = lerp(sm.V, m.V, kf); sm.Cmp = lerp(sm.Cmp, m.Cmp, kf); sm.treat = lerp(sm.treat, m.treat, kf); sm.drain = lerp(sm.drain, m.drain, kf); sm.pleuro = lerp(sm.pleuro, m.pleuro, kf);
  sm.Form = lerp(sm.Form, m.Form, k2); sm.Prot = lerp(sm.Prot, m.Prot, k2); sm.Leak = lerp(sm.Leak, m.Leak, k2); sm.Recur = lerp(sm.Recur, m.Recur, k2);
  const fluidTop = 415 - sm.V * 185, miniTop = 415 - sm.V * 95;
  layers.fluid.setAttribute("d", "M95 " + f1(fluidTop) + "Q300 " + f1(fluidTop - 10) + " 505 " + f1(fluidTop) + "L505 415L95 415Z");
  layers.mini.setAttribute("d", "M575 " + f1(miniTop) + "Q730 " + f1(miniTop - 8) + " 885 " + f1(miniTop) + "L885 415L575 415Z");
  /* the lungs are squeezed up as fluid rises, and spread back down when it drains */
  place(lungO.g, 300 + 12 * sm.Cmp, 255 - 34 * sm.Cmp, 0, 1 - 0.28 * sm.Cmp);
  /* each treatment acts on the drawing: gaps close, fluid streams out, the space seals */
  layers.drainG.setAttribute("opacity", sm.drain.toFixed(2));
  layers.seal.setAttribute("opacity", (sm.pleuro * 0.9).toFixed(2));
  layers.adh.setAttribute("opacity", (sm.pleuro * 0.95).toFixed(2));
  layers.talc.setAttribute("opacity", (sm.pleuro * 0.95).toFixed(2));
  const dp = $("drain-pill"); if (dp) dp.style.opacity = sm.drain.toFixed(2);
  const gw = 8 * sm.treat;
  layers.memb.setAttribute("d", "M575 270H" + f1(690 + gw) + "M" + f1(706 - gw) + " 270H" + f1(800 + gw) + "M" + f1(816 - gw) + " 270H885");
  layers.push.setAttribute("stroke-width", f1(1.6 + 2.2 * sm.Form));
  /* fluid forming at the parietal wall, falling to the pool */
  acc.drop += dt * sm.Form * 9; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(440, 492), rnd(130, 250), rnd(-26, -14), rnd(18, 30), 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 102, 498)) + " " + f1(p.y) + ")"); if (p.y > fluidTop - 4 || p.x < 104) kill(p); });
  /* drainage stream: fluid runs up the needle while the drain is in */
  out.forEach((p) => {
    if (sm.drain < 0.05) { if (p.on) kill(p); return; }
    if (!p.on) { p.on = true; }
    p.u = (p.u + dt * 0.45 * (0.4 + sm.drain)) % 1;
    const q = outTrack.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    p.e.setAttribute("opacity", sm.drain.toFixed(2));
  });
  /* close up: droplets cross the membrane into the mini pool */
  acc.ddrop += dt * sm.Form * 10; while (acc.ddrop >= 1) { acc.ddrop--; const p = free(ddrops); if (p) emit(p, rnd(590, 870), rnd(212, 228), rnd(-3, 3), rnd(22, 34), 0); }
  ddrops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 582, 878)) + " " + f1(p.y) + ")"); if (p.y > miniTop - 3) kill(p); });
  /* protein escapes through the leaky gaps, then drifts in the fluid */
  acc.prot += dt * sm.Leak * 8; while (acc.prot >= 1) { acc.prot--; const p = free(prots); if (p) { const det = Math.random() < 0.55; emit(p, det ? pick([698, 808]) + rnd(-4, 4) : rnd(120, 480), det ? 276 : fluidTop + rnd(8, 26), rnd(-5, 5), rnd(14, 24), det ? 0 : 1); } }
  prots.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > miniTop - 4) p.k = 2; } else if (p.k === 1) { p.x += Math.sin(tm / 500 + p.y) * 7 * dt; p.y += 4 * dt; if (p.y > 406 || p.t > 5) kill(p); } else { p.x += Math.sin(tm / 600 + p.y) * 6 * dt; if (p.t > 6) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 102, 878)) + " " + f1(clamp(p.y, 118, 408)) + ")"); });
  /* gauges */
  const vw = sm.V < 0.12 ? "gone" : sm.V < 0.35 ? "small" : sm.V < 0.7 ? "moderate" : "large";
  gg.vol.set(sm.V, vw); gg.form.set(sm.Form, wordOf(sm.Form, 0.3, 0.6, ["slow", "steady", "fast"])); gg.prot.set(sm.Prot, wordOf(sm.Prot, 0.4, 0.65, ["low", "raised", "high"]));
  gg.cmp.set(sm.Cmp, wordOf(sm.Cmp, 0.3, 0.65, ["none", "some", "marked"])); gg.br.set(sm.Cmp, wordOf(sm.Cmp, 0.3, 0.65, ["comfortable", "breathless", "very breathless"])); gg.rec.set(sm.Recur, wordOf(sm.Recur, 0.25, 0.55, ["low", "possible", "likely"]));
  const key = level + ":" + drug; if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
