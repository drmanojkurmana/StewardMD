/* Parkinson scene: dopamine loss, direct and indirect pathways, the GPi brake, thalamus and a moving limb. */
const layers = { nodes: $("nodes"), snc: $("snc-cells"), parts: $("parts"), limb: $("limb"), over: $("over"), panel: $("panel") };
const NODES = [
  ["snc", "snc", 170, 220, 36],
  ["stri", "stri", 480, 220, 42],
  ["gpe", "gpe", 300, 345, 30],
  ["stn", "stn", 480, 345, 26],
  ["gpi", "gpi", 650, 345, 32],
  ["thal", "thal", 650, 220, 32],
];
const nodeG = {};
const sncCells = [];
const TRK = [
  track([[210, 220], [432, 220]]),
  track([[514, 250], [618, 314]]),
  track([[450, 250], [332, 316]]),
  track([[334, 345], [448, 345]]),
  track([[510, 345], [614, 345]]),
  track([[650, 309], [650, 256]]),
  track([[686, 220], [792, 220]]),
  track([[630, 194], [596, 152], [528, 116]]),
];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0, sp: 1 }; }); }
const dopaP = pool(20, () => mk("circle", { class: "sc-p p-dopa", r: 3 }, layers.parts));
const dirP = pool(14, () => mk("circle", { class: "sc-p p-dir", r: 2.8 }, layers.parts));
const indP = pool(24, () => mk("circle", { class: "sc-p p-ind", r: 2.8 }, layers.parts));
const gpiP = pool(14, () => mk("circle", { class: "sc-p p-gpi", r: 2.8 }, layers.parts));
const thalP = pool(18, () => mk("circle", { class: "sc-p p-thal", r: 2.8 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, k, sp) { p.on = true; p.u = 0; p.k = k; p.sp = sp || 1; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function moveP(pl, dt, base) { pl.forEach((p) => { if (!p.on) return; p.u += dt * base * p.sp / Math.max(30, TRK[p.k].len); const q = TRK[p.k].at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) killP(p); }); }
const gg = {};
let limbG = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 260, 420, 580, 740];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Movement drive";
  [["dopa", "Dopamine", "g-dopa", "Dopamine signal reaching the striatum from the substantia nigra. It falls as dopamine neurons are lost and rises again with the treatments shown, which do not restore the neurons."], ["dir", "Direct", "g-dir", "Direct pathway: striatum to GPi. Dopamine excites it. It releases the thalamus from the GPi brake and promotes movement."], ["ind", "Indirect", "g-ind", "Indirect pathway: striatum to GPe to STN to GPi. Dopamine restrains it. When dopamine falls it becomes overactive and strengthens the brake."], ["gpi", "GPi brake", "g-gpi", "Output of the GPi onto the thalamus. A strong brake holds the thalamus down and movement drive falls."], ["move", "Movement", "g-move", "Thalamic drive to the cortex and to movement. Low drive means slow, small movement (bradykinesia), with rigidity and resting tremor."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Cortex", 480, 88, 480, 58, "Cortex: the motor cortex excites the striatum with glutamate and receives drive back from the thalamus. It issues the final movement command.");
  pill(ox, "Substantia nigra", 170, 184, 165, 148, "Substantia nigra pars compacta: dopamine neurons that project to the striatum. These neurons are progressively lost in Parkinson disease.");
  pill(ox, "Striatum", 452, 186, 365, 160, "Striatum: the input nucleus. Dopamine excites its D1 direct pathway neurons and inhibits its D2 indirect pathway neurons.");
  pill(ox, "Dopamine", 320, 220, 325, 195, "Dopamine released in the striatum. It boosts the direct pathway and restrains the indirect pathway, so movement is released at the right scale.");
  pill(ox, "Thalamus", 650, 188, 650, 162, "Thalamus: the relay to the motor cortex. The GPi holds it down; when the direct pathway releases it, movement drive rises.");
  pill(ox, "Movement", 830, 190, 830, 150, "Movement output. With low drive the limb moves slowly and with small amplitude (bradykinesia), feels stiff (rigidity), and at rest it shakes (tremor).");
  pill(ox, "Direct pathway", 566, 282, 515, 298, "Direct pathway: striatum inhibits the GPi, the GPi releases the thalamus, and movement is promoted. Dopamine loss weakens this pathway.");
  pill(ox, "Indirect pathway", 360, 300, 170, 295, "Indirect pathway: striatum to GPe to subthalamic nucleus to GPi. It ends by exciting the GPi, so it applies the brake. Dopamine loss makes it overactive.");
  pill(ox, "GPe", 272, 345, 195, 345, "Globus pallidus externa (GPe): the first relay of the indirect pathway. It inhibits the subthalamic nucleus.");
  pill(ox, "STN", 480, 371, 480, 395, "Subthalamic nucleus (STN): it excites the GPi with glutamate. Released from GPe inhibition, it drives the brake harder.");
  pill(ox, "GPi output", 650, 377, 650, 398, "Globus pallidus interna (GPi): the output brake. Its inhibitory output onto the thalamus sets how much movement drive gets through.");
}
const sm = { DA: 0.5, raw: 0.5, D: 0.5, I: 0.5, G: 0.5, T: 0.4, Sym: 0.5 };
const acc = { dopa: 0, dir: 0, ind: 0, gpi: 0, thal: 0 };
function init() {
  const cg = mk("g", {}, layers.nodes);
  mk("rect", { class: "pk-rest", x: 390, y: 88, width: 180, height: 44, rx: 12 }, cg);
  nodeG.cor = cg;
  NODES.forEach(([id, cls, x, y, r]) => {
    const g = cell(layers.nodes, { cls, r, nuc: 0.34, seed: x * 0.01 + y * 0.02, wob: 0.08 });
    place(g, x, y, 0, 1);
    nodeG[id] = g;
  });
  for (let i = 0; i < 9; i++) {
    const g = cell(layers.snc, { cls: "snc", r: 7, nuc: 0.4, seed: i + 3, wob: 0.14 });
    const dx = [-13, -5, 4, 12, -9, 0, 8, -12, 11][i], dy = [-8, -10, -8, -5, 1, 4, 0, 7, 8][i];
    place(g, 170 + dx, 220 + dy, 0, 1);
    sncCells.push(g);
  }
  limbG = mk("g", {}, layers.limb);
  mk("path", { class: "pk-limb", d: "M0 0L26 30L56 24" }, limbG);
  mk("circle", { class: "pk-hand", cx: 62, cy: 23, r: 9 }, limbG);
  mk("circle", { class: "pk-hand", cx: 0, cy: 0, r: 6 }, limbG);
  place(limbG, 800, 202, 0, 1);
  const rt = mk("text", { class: "pk-node-s", x: 830, y: 268, "text-anchor": "middle" }, layers.limb); rt.textContent = "resting limb";
  initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 1.5);
  sm.DA = lerp(sm.DA, m.DA, k); sm.raw = lerp(sm.raw, m.raw, k); sm.D = lerp(sm.D, m.D, k); sm.I = lerp(sm.I, m.I, k); sm.G = lerp(sm.G, m.G, k); sm.T = lerp(sm.T, m.T, k); sm.Sym = lerp(sm.Sym, m.Sym, k);
  sncCells.forEach((g, i) => { const want = Math.round(sm.raw * sncCells.length); g.style.opacity = i < want ? "1" : "0.08"; });
  place(nodeG.snc, 170, 220, 0, 0.55 + 0.45 * sm.raw);
  place(nodeG.stri, 480, 220, 0, 0.9 + 0.18 * sm.DA * Math.max(0, Math.sin(tm / 360)));
  place(nodeG.gpi, 650, 345, 0, 0.88 + 0.3 * sm.G);
  place(nodeG.thal, 650, 220, 0, 0.9 + 0.2 * sm.T * Math.max(0, Math.sin(tm / 420)));
  place(nodeG.gpe, 300, 345, 0, 0.92 + 0.14 * sm.I);
  place(nodeG.stn, 480, 345, 0, 0.92 + 0.18 * sm.I * Math.max(0, Math.sin(tm / 300)));
  acc.dopa += dt * sm.DA * 9; while (acc.dopa >= 1) { acc.dopa--; const p = freeP(dopaP); if (p) emitP(p, 0, rnd(0.85, 1.15)); }
  acc.dir += dt * sm.D * 7; while (acc.dir >= 1) { acc.dir--; const p = freeP(dirP); if (p) emitP(p, 1, rnd(0.85, 1.15)); }
  acc.ind += dt * sm.I * 8; while (acc.ind >= 1) { acc.ind--; const p = freeP(indP); if (p) emitP(p, 2 + Math.floor(Math.random() * 3), rnd(0.85, 1.15)); }
  acc.gpi += dt * sm.G * 7; while (acc.gpi >= 1) { acc.gpi--; const p = freeP(gpiP); if (p) emitP(p, 5, rnd(0.85, 1.15)); }
  acc.thal += dt * sm.T * 9; while (acc.thal >= 1) { acc.thal--; const p = freeP(thalP); if (p) emitP(p, Math.random() < 0.55 ? 6 : 7, rnd(0.85, 1.15)); }
  moveP(dopaP, dt, 90); moveP(dirP, dt, 80); moveP(indP, dt, 80); moveP(gpiP, dt, 70); moveP(thalP, dt, 85);
  const swing = Math.sin(tm / 1300) * (3 + 15 * sm.T);
  const tremor = Math.sin(tm / 95) * sm.Sym * (1 - sm.T * 0.55) * 6;
  place(limbG, 800, 202, swing + tremor, 1);
  gg.dopa.set(sm.DA, wordOf(sm.DA, 0.35, 0.7, ["low", "reduced", "near normal"]));
  gg.dir.set(sm.D, wordOf(sm.D, 0.35, 0.65, ["weak", "reduced", "strong"]));
  gg.ind.set(sm.I, wordOf(sm.I, 0.35, 0.65, ["quiet", "active", "overactive"]));
  gg.gpi.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["light", "firm", "hard on"]));
  gg.move.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["low", "reduced", "strong"]));
}
run({ init, step });
