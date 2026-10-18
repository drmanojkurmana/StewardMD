/* Hypertensive emergency scene: pressure surge, autoregulation, breakthrough, wall injury, fibrinoid necrosis and target organs. */
const CY = SC.CY, WW = SC.W;
const layers = { rbc: $("rbcs"), endo: $("endo"), fib: $("fib"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
let hh = 38;
const WALL_N = 24;
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 13, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 24 + (i + 0.5) * (520 / WALL_N) }); } }); }
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(20, 540), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
const fibs = [[170, 1], [270, -1], [370, 1], [470, -1]].map(([x, side]) => { const e = mk("ellipse", { class: "htn-fibp", rx: 22, ry: 7 }, layers.fib); return { e, x, side }; });
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const surge = pool(18, () => mk("path", { class: "p-surge", d: "M-6 -6L1 0L-6 6" }, layers.parts));
const leaks = pool(30, () => mk("path", { class: "p-leak2", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const sparks = pool(20, () => mk("circle", { class: "sc-p p-cyt", r: 2.3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
const dmgs = ["dmg-brain", "dmg-kidney", "dmg-heart", "dmg-aorta", "dmg-retina"];
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pr", "Pressure", "g-bad", "How high the pressure in the arteriole is. Very high pressure drives every later step."], ["br", "Breakthrough", "g-break", "Flow breaking through after autoregulation is overwhelmed, forcing pressure into fragile small vessels."], ["wa", "Wall injury", "g-wall", "Endothelial injury: the lining is damaged, swells and lets plasma proteins into the wall."], ["fi", "Fibrinoid", "g-fib", "Fibrinoid necrosis: fibrin and plasma protein in a dying vessel wall. The wall weakens and may leak or close."], ["or", "Organ damage", "g-bad", "Damage across brain, kidney, heart, aorta and retina. Its presence is what makes this an emergency."], ["pe", "Perfusion", "g-good", "Flow actually reaching the tissues. Too fast a fall in pressure can cut this, so lowering is controlled and gradual."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "High pressure", 62, CY, 86, 108, "Blood enters under very high pressure. The faster and higher the rise, the less time vessels have to adapt.");
  pill(ox, "Autoregulation", 272, CY - 40, 272, 108, "Autoregulation: the arteriole narrows as pressure rises, holding flow steady. Beyond its limit it is forced open.");
  pill(ox, "Fibrinoid necrosis", 462, CY - 34, 448, 108, "Fibrinoid necrosis: injured wall muscle dies with fibrin and plasma protein in it. A hallmark of malignant hypertension.");
  pill(ox, "Leaky wall", 190, CY + 40, 182, 268, "Once the endothelium is injured the wall leaks plasma into the tissue around the vessel.");
  pill(ox, "Endothelium", 362, CY + 40, 366, 268, "Endothelium: the single-cell lining. Pressure injury makes it swell, leak and trigger clotting and narrowing signals.");
}
const sm = { P: 0.7, B: 0.5, E: 0.4, F: 0.3, O: 0.4, Perf: 0.6 };
const acc = { surge: 0, leak: 0, spark: 0 };
function init() { initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.P = lerp(sm.P, m.P, k1); sm.B = lerp(sm.B, m.B, k2); sm.E = lerp(sm.E, m.E, k2); sm.F = lerp(sm.F, m.F, k2); sm.O = lerp(sm.O, m.O, k2); sm.Perf = lerp(sm.Perf, m.Perf, k2);
  const narrow = 1 - 0.35 * clamp((sm.P - 0.2) * 1.2) * (1 - sm.B);
  hh = (38 * narrow + 7 * sm.B) + 3.5 * sm.P * Math.sin(tm / 360);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.7, 0, 1));
  endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.7, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + (1 - 0.18 * sm.E).toFixed(3) + " 1)"); e.g.style.setProperty("--act", sm.E.toFixed(2)); }));
  fibs.forEach((f) => { const s = clamp((sm.F - 0.05) * 1.5); f.e.setAttribute("transform", "translate(" + f1(f.x) + " " + f1(f.side > 0 ? wallT + 3 : wallB - 3) + ") scale(" + (0.2 + 0.8 * s).toFixed(3) + ")"); f.e.setAttribute("opacity", s > 0.04 ? (0.35 + 0.65 * s).toFixed(2) : "0"); });
  const flow = clamp(0.3 + 0.9 * sm.P + 0.5 * sm.B);
  rbcs.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > 548) { r.x = 18; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * Math.max(8, hh - 13), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.surge += dt * (2 + 9 * sm.P); while (acc.surge >= 1) { acc.surge--; const p = free(surge); if (p) emit(p, 22, CY + rnd(-hh + 12, hh - 12), 70 + 90 * sm.P, 0, 0); }
  surge.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 6 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, 546)) + " " + f1(clamp(p.y, CY - hh + 8, CY + hh - 8)) + ")"); if (p.x > 544) kill(p); });
  acc.spark += dt * sm.E * 8; while (acc.spark >= 1) { acc.spark--; const p = free(sparks); if (p) emit(p, rnd(50, 530), Math.random() < 0.5 ? wallT + 4 : wallB - 4, rnd(-8, 8), rnd(-14, 14), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, 544); p.y = clamp(p.y + p.vy * dt, 56, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.1) kill(p); });
  acc.leak += dt * sm.B * 9; while (acc.leak >= 1) { acc.leak--; const p = free(leaks); if (p) { const up = Math.random() < 0.5; emit(p, rnd(50, 530), up ? wallT - 2 : wallB + 2, rnd(-4, 4), up ? -rnd(13, 22) : rnd(13, 22), up ? 1 : -1); } }
  leaks.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, 544); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < wallT - 48 || p.y > wallB + 44 || p.t > 3) kill(p); });
  const dx = 70 + sm.P * 430;
  const dy = dx < 215 ? 378 - (dx - 70) * 0.041 : Math.max(306, 372 - (dx - 215) * 0.23);
  const dot = $("curvedot"); if (dot) { dot.setAttribute("cx", f1(dx)); dot.setAttribute("cy", f1(dy)); dot.setAttribute("r", f1(5 + 2 * sm.B)); }
  dmgs.forEach((id) => { const e = $(id); if (e) e.setAttribute("opacity", clamp(sm.O * 1.25).toFixed(2)); });
  gg.pr.set(sm.P, wordOf(sm.P, 0.35, 0.65, ["lower", "high", "very high"]));
  gg.br.set(sm.B, wordOf(sm.B, 0.25, 0.55, ["held", "straining", "breaking through"]));
  gg.wa.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["intact", "injured", "badly injured"]));
  gg.fi.set(sm.F, wordOf(sm.F, 0.2, 0.5, ["none", "some", "severe"]));
  gg.or.set(sm.O, wordOf(sm.O, 0.25, 0.55, ["settled", "threatened", "damaged"]));
  gg.pe.set(sm.Perf, wordOf(sm.Perf, 0.4, 0.65, ["poor", "reduced", "kept"]));
}
run({ init, step });
