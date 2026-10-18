/* Respiratory mechanics scene: breath cycle, diaphragm, alveoli, air flow and the pressure volume curve. */
const layers = { alv: $("alvG"), parts: $("parts"), over: $("over"), panel: $("panel"), pv: $("pvG"), diaph: $("diaph"), lung: $("lungShape"), pleura: $("pleura"), ribs: $("ribsG") };
/* ---- alveoli with surfactant dots on the inner surface ---- */
const ALV = [[238, 268], [286, 248], [336, 268], [258, 310], [310, 304], [354, 308], [286, 284]];
const alvs = ALV.map(([x, y], i) => {
  const g = mk("g", {}, layers.alv);
  mk("circle", { class: "rp-alv", r: 20 }, g);
  const sg = mk("g", {}, g), dots = [];
  for (let j = 0; j < 6; j++) { const t = (j / 6) * 6.283 + i; dots.push(mk("circle", { class: "rp-surf", r: 2.2, cx: f1(Math.cos(t) * 15), cy: f1(Math.sin(t) * 15) }, sg)); }
  return { g, sg, x, y, ph: i * 0.9 };
});
/* ---- air particles along three airway tracks ---- */
const tracks = [
  track([[300, 66], [300, 184], [264, 232], [238, 268]]),
  track([[300, 66], [300, 184], [296, 236], [286, 284]]),
  track([[300, 66], [300, 184], [336, 232], [336, 268]]),
];
function poolAir(n) { return Array.from({ length: n }, (_, i) => { const e = mk("circle", { class: "p-airp", r: 3 }, layers.parts); return { e, tr: tracks[i % 3], o: (i % 9) * 0.07, jx: rnd(-5, 5) }; }); }
const airs = poolAir(27);
/* ---- pressure volume panel ---- */
const PV = { ox: 592, oy: 330, w: 296, h: 198 };
let pvCurve = null, pvDot = null;
function pvPoint(t, compN, Vt, swing) {
  const maxVol = clamp(0.35 + 0.65 * Vt), presEnd = clamp(1.12 - 0.6 * compN + 0.18 * swing, 0.3, 1);
  return { x: PV.ox + t * maxVol * PV.w, y: PV.oy - Math.pow(t, 1.3) * presEnd * PV.h };
}
function pvPath(compN, Vt, swing) {
  let d = "";
  for (let i = 0; i <= 20; i++) { const p = pvPoint(i / 20, compN, Vt, swing); d += (i ? "L" : "M") + f1(p.x) + " " + f1(p.y); }
  return d;
}
function initPV() {
  const P = layers.pv;
  mk("path", { class: "rp-axis", d: "M" + PV.ox + " " + (PV.oy - PV.h - 12) + "L" + PV.ox + " " + PV.oy + "L" + (PV.ox + PV.w + 14) + " " + PV.oy }, P);
  mk("path", { class: "rp-ref", d: pvPath(0.65, 0.59, 0.58) }, P);
  pvCurve = mk("path", { class: "rp-curve", d: "" }, P);
  pvDot = mk("circle", { class: "rp-dot", r: 5, cx: PV.ox, cy: PV.oy }, P);
  const tv = mk("text", { class: "sc-lab", x: 740, y: 354, "text-anchor": "middle" }, P); tv.textContent = "Volume";
  const tp = mk("text", { class: "sc-lab", x: 566, y: 226, "text-anchor": "middle", transform: "rotate(-90 566 226)" }, P); tp.textContent = "Pressure";
  const tr = mk("text", { class: "sc-lab", x: 884, y: 140, "text-anchor": "middle" }, P); tr.textContent = "faint: normal";
  [["1 Muscles contract, chest expands", 378], ["2 Pleural pressure falls, lung opens", 396], ["3 Alveolar pressure falls, air flows in", 414]].forEach(([s, y]) => { const t = mk("text", { class: "rp-step", x: 544, y }, P); t.textContent = s; });
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The breath";
  [["comp", "Compliance", "g-comp", "How easily the lung stretches for a given pressure change. Low in stiff fibrotic lungs, high when elastic tissue is lost."], ["res", "Resistance", "g-res", "How hard it is to push air through the airways. High in asthma and other obstructive patterns."], ["flow", "Airflow", "g-flow", "Air flow into the lung. It rises when resistance falls or the lung opens more easily."], ["rec", "Recoil", "g-rec", "Elastic recoil: the lung springing back. High in fibrosis, lost in emphysema."], ["ten", "Tension", "g-ten", "Surface tension at the wet alveolar surface. Surfactant lowers it and stops small alveoli collapsing."], ["eff", "Effort", "g-eff", "Pleural pressure swing and work needed for the breath. It rises when the lung is stiff or the airways are narrow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Airway", 300, 105, 118, 94, "Airway: the trachea and bronchi carry air to the alveoli. Narrowing here raises resistance and slows flow.");
  pill(ox, "Alveoli", 252, 282, 88, 192, "Alveoli: tiny air sacs where the lung stretches. They expand as alveolar pressure falls and air enters.");
  pill(ox, "Pleural space", 168, 262, 88, 262, "Pleural space: the thin gap between lung and chest wall. When the chest expands this pressure falls and pulls the lung open.");
  pill(ox, "Surfactant", 292, 312, 102, 352, "Surfactant: made by type II alveolar cells. It lowers surface tension, raises compliance and stops small alveoli collapsing.");
  pill(ox, "Intercostals", 450, 248, 412, 102, "Intercostal muscles: between the ribs. They contract with the diaphragm to enlarge the chest.");
  pill(ox, "Diaphragm", 300, 388, 132, 424, "Diaphragm: the main breathing muscle. It contracts and flattens downward, enlarging the chest and lowering pleural pressure.");
  pill(ox, "PV curve", 738, 228, 858, 100, "Pressure volume curve: pressure needed for each volume. A stiff lung curve sits to the right, a floppy lung curve to the left. The faint dashed curve is the normal pattern.");
}
const sm = { compN: 0.65, R: 0.25, tension: 0.48, recoil: 0.55, flow: 0.65, Vt: 0.59, swing: 0.58, surf: 0 };
function init() { initPV(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 1.4);
  sm.compN = lerp(sm.compN, m.compN, kk); sm.R = lerp(sm.R, m.R, kk); sm.tension = lerp(sm.tension, m.tension, kk); sm.recoil = lerp(sm.recoil, m.recoil, kk); sm.flow = lerp(sm.flow, m.flow, kk); sm.Vt = lerp(sm.Vt, m.Vt, kk); sm.swing = lerp(sm.swing, m.swing, kk); sm.surf = lerp(sm.surf, m.surf, kk);
  const b = 0.5 - 0.5 * Math.cos(tm * 0.0017);
  const volB = b * sm.Vt, dMove = b * clamp(0.55 + 0.45 * sm.swing);
  /* diaphragm flattens down, chest and lung expand */
  layers.diaph.setAttribute("d", "M168 " + f1(396 + 6 * dMove) + "Q300 " + f1(352 + 30 * dMove) + " 432 " + f1(396 + 6 * dMove));
  const ls = "translate(300 278) scale(" + (1 + 0.05 * volB).toFixed(3) + " " + (1 + 0.07 * volB).toFixed(3) + ") translate(-300 -278)";
  layers.lung.setAttribute("transform", ls); layers.pleura.setAttribute("transform", ls);
  layers.ribs.setAttribute("transform", "translate(300 278) scale(" + (1 + 0.03 * volB).toFixed(3) + " 1) translate(-300 -278)");
  layers.pleura.style.opacity = (0.55 + 0.45 * dMove).toFixed(2);
  /* alveoli expand with the breath; surfactant dots show with the concept */
  const baseScale = 0.82 + 0.32 * sm.compN;
  alvs.forEach((av) => { const s = baseScale * (0.82 + 0.45 * volB) * (1 + 0.03 * Math.sin(tm / 500 + av.ph)); place(av.g, av.x, av.y, 0, s); av.sg.style.opacity = (0.25 + 0.75 * sm.surf).toFixed(2); });
  /* air particles ride the breath in and out, kept inside the airway tracks */
  airs.forEach((p) => { const u = clamp(b * 1.18 - p.o, 0.02, 0.98), pt = p.tr.at(u); p.e.setAttribute("transform", "translate(" + f1(pt.x + p.jx * (u < 0.45 ? 0.4 : 1)) + " " + f1(pt.y) + ")"); p.e.setAttribute("opacity", sm.flow < 0.15 && u > 0.6 ? "0.35" : "1"); });
  /* pressure volume curve and the moving breath point */
  if (pvCurve) { pvCurve.setAttribute("d", pvPath(sm.compN, sm.Vt, sm.swing)); const dp = pvPoint(b, sm.compN, sm.Vt, sm.swing); pvDot.setAttribute("cx", f1(dp.x)); pvDot.setAttribute("cy", f1(dp.y)); }
  /* gauges */
  gg.comp.set(sm.compN, wordOf(sm.compN, 0.4, 0.75, ["low", "normal", "high"])); gg.res.set(sm.R, wordOf(sm.R, 0.35, 0.65, ["low", "raised", "high"])); gg.flow.set(sm.flow, wordOf(sm.flow, 0.4, 0.6, ["low", "reduced", "good"]));
  gg.rec.set(sm.recoil, wordOf(sm.recoil, 0.35, 0.65, ["low", "normal", "high"])); gg.ten.set(sm.tension, wordOf(sm.tension, 0.35, 0.55, ["low", "normal", "high"])); gg.eff.set(sm.swing, wordOf(sm.swing, 0.45, 0.7, ["low", "raised", "high"]));
}
run({ init, step });
