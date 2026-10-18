/* Pleural effusion scene: pleural fluid, compressed lung, Starling forces, leak, drainage and gauges. */
const layers = { lung: $("lungG"), parts: $("parts"), fparts: $("fparts"), over: $("over"), panel: $("panel"), fluid: $("fluidPath"), mini: $("miniFluid"), drainG: $("drainG"), seal: $("sealPath"), endo2: $("endo2") };
/* ---- lung with airway branches (visceral pleura is its surface) ---- */
(function buildLung() {
  const g = layers.lung;
  mk("ellipse", { class: "pl-lung", rx: 145, ry: 112 }, g);
  mk("path", { class: "pl-bronch", d: "M-105 -6L-30 0L28 -22M-30 0L22 18M28 -22L72 -38M22 18L66 34M-30 0L-52 34" }, g);
  mk("ellipse", { class: "pl-hl", rx: 42, ry: 26, cx: -42, cy: -42 }, g);
})();
/* ---- capillary lining in the close up ---- */
for (let i = 0; i < 11; i++) { cell(layers.endo2, { cls: "endo", r: 10, nuc: 0.3, seed: i + 3, wob: 0.08, x: 592 + i * 28, y: 172 }); cell(layers.endo2, { cls: "endo", r: 10, nuc: 0.3, seed: i + 30, wob: 0.08, x: 592 + i * 28, y: 204 }); }
/* ---- particle pools ---- */
function pool(n, build, parent) { return Array.from({ length: n }, () => { const e = build(parent); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const drops = pool(26, (p) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, p), layers.parts);
const ddrops = pool(24, (p) => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, p), layers.parts);
const prots = pool(34, (p) => mk("circle", { class: "sc-p p-prot", r: 3 }, p), layers.parts);
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vol", "Effusion", "g-fl", "Fluid in the pleural space. It collects at the base and blunts the angle between lung and diaphragm."], ["form", "Formation", "g-fl", "How fast new pleural fluid is forming. Treating the cause slows this down."], ["prot", "Protein", "g-prot", "Protein in the fluid. Low protein suggests a transudate; high protein and LDH compared with serum suggest an exudate (Light criteria idea)."], ["cmp", "Compression", "g-comp", "How much the effusion squeezes the lung and stops it expanding."], ["br", "Breathing", "g-bad", "Breathlessness from the compressed lung. It eases as fluid is removed."], ["rec", "Reaccurs", "g-bac", "Chance of fluid building up again. Pleurodesis seals the space and makes this low."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Chest wall", 84, 190, 150, 86, "Chest wall and ribs. The parietal pleura lines its inner surface.");
  pill(ox, "Parietal pleura", 500, 150, 360, 86, "Parietal pleura: the membrane lining the chest wall and diaphragm. Its capillaries make most pleural fluid.");
  pill(ox, "Visceral pleura", 176, 214, 180, 148, "Visceral pleura: the membrane wrapped on the lung surface. The pleural space lies between this and the parietal pleura.");
  pill(ox, "Lung", 300, 132, 295, 118, "Lung. A growing effusion pushes on it, so it cannot expand fully and air entry falls.");
  pill(ox, "Pleural fluid", 170, 388, 175, 350, "Pleural fluid (the effusion). Percussion over it sounds dull and breath sounds are reduced. A sample is taken by thoracentesis.");
  pill(ox, "Diaphragm", 360, 408, 395, 372, "Diaphragm. Fluid collects above it first, so a small effusion shows mainly at the base.");
  pill(ox, "Capillary", 700, 170, 620, 86, "A capillary in the parietal pleura, close up. Starling forces decide whether fluid leaves or returns.");
  pill(ox, "Push out", 760, 240, 810, 86, "Hydrostatic pressure inside the capillary pushes fluid out. It rises in heart failure, giving a low protein transudate. Low serum protein lowers oncotic pull and does the same.");
  pill(ox, "Pull in", 650, 254, 620, 150, "Oncotic pressure from serum proteins pulls fluid back into the capillary. When serum protein is low, less is pulled back.");
  pill(ox, "Pleural membrane", 640, 270, 720, 240, "The pleural membrane and capillary wall. Inflammation or malignancy makes it leaky, so an exudate forms.");
  pill(ox, "Protein leak", 800, 270, 830, 240, "Through leaky gaps, protein and cells escape with the fluid. That protein rich fluid is an exudate.");
  const dp = pill(ox, "Drain needle", 470, 340, 455, 295, "Thoracentesis or a chest drain: a needle or tube through the chest wall removes fluid, lets the lung re expand, and gives fluid to test."); dp.setAttribute("id", "drain-pill");
}
const sm = { V: 0.4, Form: 0.4, Prot: 0.4, Leak: 0.4, Cmp: 0.2, Recur: 0.3, drain: 0, pleuro: 0 };
const acc = { drop: 0, ddrop: 0, prot: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.V = lerp(sm.V, m.V, k2); sm.Form = lerp(sm.Form, m.Form, k2); sm.Prot = lerp(sm.Prot, m.Prot, k2); sm.Leak = lerp(sm.Leak, m.Leak, k2); sm.Cmp = lerp(sm.Cmp, m.Cmp, k1); sm.Recur = lerp(sm.Recur, m.Recur, k2); sm.drain = lerp(sm.drain, m.drain, k1); sm.pleuro = lerp(sm.pleuro, m.pleuro, k1);
  const fluidTop = 415 - sm.V * 180, miniTop = 415 - sm.V * 95;
  layers.fluid.setAttribute("d", "M95 " + f1(fluidTop) + "Q300 " + f1(fluidTop - 10) + " 505 " + f1(fluidTop) + "L505 415L95 415Z");
  layers.mini.setAttribute("d", "M575 " + f1(miniTop) + "Q730 " + f1(miniTop - 8) + " 885 " + f1(miniTop) + "L885 415L575 415Z");
  /* lung is pushed up and squeezed as fluid rises */
  place(layers.lung, 295 + 25 * sm.Cmp, 242 - 38 * sm.Cmp + Math.sin(tm / 1200) * 2, 0, 1 - 0.3 * sm.Cmp);
  layers.drainG.setAttribute("opacity", sm.drain.toFixed(2));
  layers.seal.setAttribute("opacity", (sm.pleuro * 0.9).toFixed(2));
  const dp = $("drain-pill"); if (dp) dp.style.opacity = sm.drain.toFixed(2);
  /* fluid forming at the parietal wall, falling to the pool */
  acc.drop += dt * sm.Form * 9; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(440, 492), rnd(130, 250), rnd(-26, -14), rnd(18, 30), 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 102, 498)) + " " + f1(p.y) + ")"); if (p.y > fluidTop - 4 || p.x < 104) kill(p); });
  /* close up: droplets cross the membrane into the mini pool */
  acc.ddrop += dt * sm.Form * 10; while (acc.ddrop >= 1) { acc.ddrop--; const p = free(ddrops); if (p) emit(p, rnd(590, 870), rnd(212, 228), rnd(-3, 3), rnd(22, 34), 0); }
  ddrops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 582, 878)) + " " + f1(p.y) + ")"); if (p.y > miniTop - 3) kill(p); });
  /* protein escapes through the leaky gaps, then drifts in the fluid */
  acc.prot += dt * sm.Leak * 8; while (acc.prot >= 1) { acc.prot--; const p = free(prots); if (p) { const det = Math.random() < 0.55; emit(p, det ? pick([698, 808]) + rnd(-4, 4) : rnd(120, 480), det ? 276 : fluidTop + rnd(8, 26), rnd(-5, 5), rnd(14, 24), det ? 0 : 1); } }
  prots.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > miniTop - 4) p.k = 2; } else if (p.k === 1) { p.x += Math.sin(tm / 500 + p.y) * 7 * dt; p.y += 4 * dt; if (p.y > 406 || p.t > 5) kill(p); } else { p.x += Math.sin(tm / 600 + p.y) * 6 * dt; if (p.t > 6) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 102, 878)) + " " + f1(clamp(p.y, 118, 408)) + ")"); });
  /* gauges */
  gg.vol.set(sm.V, wordOf(sm.V, 0.35, 0.7, ["small", "moderate", "large"])); gg.form.set(sm.Form, wordOf(sm.Form, 0.3, 0.6, ["slow", "steady", "fast"])); gg.prot.set(sm.Prot, wordOf(sm.Prot, 0.4, 0.65, ["low", "raised", "high"]));
  gg.cmp.set(sm.Cmp, wordOf(sm.Cmp, 0.3, 0.65, ["none", "some", "marked"])); gg.br.set(sm.Cmp, wordOf(sm.Cmp, 0.3, 0.65, ["comfortable", "breathless", "very breathless"])); gg.rec.set(sm.Recur, wordOf(sm.Recur, 0.25, 0.55, ["low", "possible", "likely"]));
}
run({ init, step });
