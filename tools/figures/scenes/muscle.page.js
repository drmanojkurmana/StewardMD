/* Muscle scene: action potential, acetylcholine, depolarisation, T tubule, calcium, troponin and cross-bridges. */
const layers = { back: $("back"), parts: $("parts"), nodes: $("nodes"), over: $("over"), panel: $("panel") };
/* soft calcium glow over the filaments, like the pilot scene swelling glow */
const glow = mk("ellipse", { class: "mu-glow", cx: 610, cy: 355, rx: 250, ry: 55, opacity: "0" }, layers.back);
/* ---- nodes with visible fills ---- */
const neuron = cell(layers.nodes, { cls: "neuron", r: 28, nuc: 0.42, seed: 3, wob: 0.12 });
place(neuron, 90, 105, 0, 1);
const bouton = cell(layers.nodes, { cls: "bouton", r: 21, nuc: 0, seed: 5, wob: 0.1 });
place(bouton, 430, 146, 0, 1);
const ves = [];
[[424, 140], [436, 138], [430, 150], [420, 152], [440, 152]].forEach(([x, y]) => { const c = mk("circle", { class: "mu-ves", cx: x, cy: y, r: 3.4 }, layers.nodes); ves.push(c); });
const recs = [], blkCaps = [];
[408, 428, 448, 468].forEach((x) => { const g = mk("g", {}, layers.nodes); mk("path", { class: "mu-head", d: "M0 0V10", stroke: "#3ddc97" }, g); mk("rect", { class: "mu-rec", x: -5, y: -6, width: 10, height: 6, rx: 3 }, g); g.setAttribute("transform", "translate(" + x + " 178)"); recs.push(g);
  const b = mk("rect", { class: "mu-blk", x: x - 7, y: 164, width: 14, height: 8, rx: 4, opacity: "0" }, layers.nodes); blkCaps.push(b); });
/* enzyme marks in the cleft: the second drug blocks breakdown here */
const enzX = [];
[[414, 160], [436, 164], [458, 160]].forEach(([x, y]) => { const p = mk("path", { class: "mu-enzx", d: "M-5 -5L5 5M-5 5L5 -5", transform: "translate(" + x + " " + y + ")", opacity: "0" }, layers.nodes); enzX.push(p); });
const pump = mk("g", {}, layers.nodes); mk("circle", { class: "mu-pump", r: 7 }, pump); mk("path", { d: "M-3 0H3M0 -3V3", stroke: "#123", "stroke-width": 1.2 }, pump); pump.setAttribute("transform", "translate(812 292)");
/* ---- sarcomere ---- */
const sar = { zL: mk("rect", { class: "mu-z", x: -4, y: 305, width: 8, height: 100, rx: 3 }, layers.nodes), zR: mk("rect", { class: "mu-z", x: -4, y: 305, width: 8, height: 100, rx: 3 }, layers.nodes),
  aTL: mk("path", { class: "mu-actin" }, layers.nodes), aTR: mk("path", { class: "mu-actin" }, layers.nodes), aBL: mk("path", { class: "mu-actin" }, layers.nodes), aBR: mk("path", { class: "mu-actin" }, layers.nodes),
  tTL: mk("path", { class: "mu-tropm" }, layers.nodes), tTR: mk("path", { class: "mu-tropm" }, layers.nodes), tBL: mk("path", { class: "mu-tropm" }, layers.nodes), tBR: mk("path", { class: "mu-tropm" }, layers.nodes),
  myo: mk("path", { class: "mu-myosin", d: "M520 355H700" }, layers.nodes) };
const heads = [];
[542, 574, 606, 638, 670].forEach((x, i) => { [-1, 1].forEach((side) => { const p = mk("path", { class: "mu-head" }, layers.nodes); heads.push({ p, x, side, i: i * 2 + (side > 0 ? 1 : 0) }); }); });
const trops = [];
[325, 385].forEach((y) => { [-1, 1].forEach((side) => { for (let i = 0; i < 4; i++) { const c = mk("circle", { class: "mu-trop", r: 4 }, layers.nodes); trops.push({ c, y, side, d: 36 + i * 46 }); } }); });
/* ---- particle pools (opacity set per element, never via CSS) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, u: 0 }; }); }
const apP = pool(7, () => mk("circle", { class: "sc-p p-ap", r: 3.6 }, layers.parts)); apP.forEach((p, i) => { p.u = i / 7; p.on = true; });
const depP = pool(6, () => mk("circle", { class: "sc-p p-dep", r: 3.2 }, layers.parts)); depP.forEach((p, i) => { p.u = i / 6; p.on = true; });
const achP = pool(22, () => mk("circle", { class: "sc-p p-ach", r: 2.5 }, layers.parts));
const caP = pool(34, () => mk("circle", { class: "sc-p p-ca", r: 2.6 }, layers.parts)); caP.forEach((p) => { p.x = rnd(350, 870); p.y = rnd(302, 408); p.vx = rnd(-9, 9); p.vy = rnd(-7, 7); p.on = true; });
const atpP = pool(12, () => mk("rect", { class: "sc-p p-atp", x: -3, y: -3, width: 6, height: 6, rx: 1.5 }, layers.parts)); atpP.forEach((p) => { p.x = rnd(505, 715); p.y = rnd(318, 392); p.on = true; });
/* blocker drug lingering in the cleft while treatment is on */
const blkP = pool(8, () => mk("circle", { class: "sc-p p-blk", r: 4 }, layers.parts)); blkP.forEach((p) => { p.x = rnd(398, 482); p.y = rnd(138, 168); p.vx = rnd(-8, 8); p.vy = rnd(-6, 6); p.on = true; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, life) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.life = life; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const apTrack = track([[118, 104], [260, 97], [360, 108], [404, 128], [428, 144]]);
const depTrack = track([[484, 176], [650, 176], [650, 256], [722, 264]]);
function capText(d, l) {
  const T = [
    ["At rest there is no signal, so the fibre stays relaxed.", "Blocker sits on the receptors. At rest nothing changes.", "This drug keeps the signal longer. At rest there is none."],
    ["No treatment. The signal spreads and the filaments pull.", "Blocker sits on the receptors. The fibre cannot contract.", "This drug keeps the signal longer, so the pull is stronger."],
    ["No treatment. In fatigue the signal fades and pull weakens.", "Blocker sits on the receptors. The tired fibre goes slack.", "This drug keeps the signal longer, fighting fatigue."],
    ["No ATP, so the bridges cannot let go. The fibre is locked.", "Blocker is on the receptors, but no ATP means still locked.", "More signal cannot help. With no ATP the fibre stays locked."],
  ];
  return T[l][d];
}
/* ---- labels and gauges ---- */
const gg = {};
let capEl = null, capDrug = -1, capLevel = -1;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The muscle fibre";
  [["sig", "Signal", "g-good", "Depolarisation of the fibre surface after acetylcholine opens its receptors."], ["ca", "Calcium", "g-ca", "Calcium in the fibre fluid, released from the calcium store and pumped back for relaxation."], ["sites", "Sites open", "g-sites", "Actin binding sites exposed when calcium binds troponin and tropomyosin moves aside."], ["cb", "Cross-bridges", "g-cb", "Myosin heads attaching, pulling and detaching on actin. Cycling needs ATP; without ATP they stay locked in rigor."], ["short", "Shortening", "g-fl", "How much the sarcomere shortens as cross-bridges pull the Z discs closer."], ["atp", "ATP", "g-good", "ATP available to detach myosin heads and pump calcium back. It falls in fatigue and is absent in rigor."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Motor neuron", 90, 105, 95, 62, "Motor neuron: its signal travels down the axon to the muscle.");
  pill(ox, "Nerve signal", 235, 98, 250, 64, "Nerve signal: the electrical pulse travelling along the axon. It opens the nerve terminal.");
  pill(ox, "Acetylcholine", 436, 166, 450, 105, "Acetylcholine: crosses the gap to the receptors. One drug slows its breakdown; the blocker acts later at the receptor.");
  pill(ox, "Receptor", 452, 178, 560, 140, "Receptor on the fibre membrane. The blocker sits here and stops the signal entering the fibre.");
  pill(ox, "T tubule", 656, 222, 700, 150, "T tubule: a fold of the fibre membrane carrying the surface signal deep to the calcium store.");
  pill(ox, "Calcium store", 806, 252, 815, 200, "Calcium store: releases calcium for the pull and pumps it back to relax. Calcium binds troponin to start the pull.");
  pill(ox, "Cross-bridges", 610, 355, 640, 418, "Cross-bridges: myosin heads pull actin past troponin and tropomyosin using ATP. With no ATP they stay locked.");
  capEl = mk("text", { class: "mu-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { Ap: 0, Ach: 0, Dep: 0, Ca: 0.1, Sites: 0, Cyc: 0, Short: 0, Atp: 1, Block: 0, Che: 0, Rigor: 0 };
const acc = { ach: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 3), k2 = Math.min(1, dt * 1.6);
  sm.Ap = lerp(sm.Ap, m.Ap, k); sm.Ach = lerp(sm.Ach, m.Ach, k); sm.Dep = lerp(sm.Dep, m.Dep, k); sm.Ca = lerp(sm.Ca, m.Ca, k2); sm.Sites = lerp(sm.Sites, m.Sites, k2); sm.Cyc = lerp(sm.Cyc, m.Cyc, k2); sm.Short = lerp(sm.Short, m.Short, k2); sm.Atp = lerp(sm.Atp, m.Atp, k2); sm.Block = lerp(sm.Block, m.block, k); sm.Che = lerp(sm.Che, m.che, k); sm.Rigor = lerp(sm.Rigor, m.rigor, k);
  /* neuron and terminal */
  place(bouton, 430, 146 + Math.sin(tm / 700) * 1.5, 0, 1);
  ves.forEach((c, i) => c.setAttribute("opacity", (0.35 + 0.65 * sm.Ach * (0.6 + 0.4 * Math.sin(tm / 300 + i * 2))).toFixed(2)));
  $("endplate").setAttribute("opacity", (sm.Dep * 0.55).toFixed(2));
  recs.forEach((g) => g.style.opacity = (0.45 + 0.55 * sm.Dep).toFixed(2));
  blkCaps.forEach((b) => b.setAttribute("opacity", sm.Block.toFixed(2)));
  enzX.forEach((p) => p.setAttribute("opacity", sm.Che.toFixed(2)));
  glow.setAttribute("opacity", (sm.Ca * 0.32).toFixed(2));
  pump.setAttribute("opacity", (0.35 + 0.65 * sm.Atp * (1 - sm.Rigor)).toFixed(2));
  /* action potential pulses along the axon */
  apP.forEach((p) => { p.u += dt * 0.3 * sm.Ap; if (p.u > 1) p.u -= 1; const q = apTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", sm.Ap > 0.04 ? (0.25 + 0.75 * sm.Ap).toFixed(2) : "0"); });
  /* depolarisation wave over the sarcolemma and down the T tubule */
  depP.forEach((p) => { p.u += dt * 0.34 * sm.Dep; if (p.u > 1) p.u -= 1; const q = depTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", sm.Dep > 0.04 ? (0.25 + 0.75 * sm.Dep).toFixed(2) : "0"); });
  /* acetylcholine into the cleft; a cholinesterase inhibitor makes it last longer */
  acc.ach += dt * sm.Ach * 9; while (acc.ach >= 1) { acc.ach--; const p = free(achP); if (p) emit(p, rnd(414, 452), 164, rnd(-7, 7), rnd(10, 18), m.che ? 2.3 : 1.15); }
  achP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 402, 478); p.y = clamp(p.y + p.vy * dt, 158, 174); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / p.life).toFixed(2)); if (p.t > p.life) kill(p); });
  /* blocker drug lingering in the cleft while treatment is on */
  blkP.forEach((p, i) => { p.x = clamp(p.x + p.vx * dt, 398, 482); p.y = clamp(p.y + p.vy * dt, 138, 168); if (p.x <= 399 || p.x >= 481) p.vx *= -1; if (p.y <= 139 || p.y >= 167) p.vy *= -1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", i < sm.Block * blkP.length ? "0.95" : "0"); });
  /* sarcomere geometry */
  const zl = 340 + sm.Short * 48, zr = 880 - sm.Short * 48;
  sar.zL.setAttribute("transform", "translate(" + f1(zl) + " 0)"); sar.zR.setAttribute("transform", "translate(" + f1(zr) + " 0)");
  sar.aTL.setAttribute("d", "M" + f1(zl) + " 325H642"); sar.aTR.setAttribute("d", "M" + f1(zr) + " 325H578"); sar.aBL.setAttribute("d", "M" + f1(zl) + " 385H642"); sar.aBR.setAttribute("d", "M" + f1(zr) + " 385H578");
  const dy = 7 - sm.Sites * 7;
  sar.tTL.setAttribute("d", "M" + f1(zl) + " " + f1(325 + dy) + "H642"); sar.tTR.setAttribute("d", "M" + f1(zr) + " " + f1(325 + dy) + "H578"); sar.tBL.setAttribute("d", "M" + f1(zl) + " " + f1(385 - dy) + "H642"); sar.tBR.setAttribute("d", "M" + f1(zr) + " " + f1(385 - dy) + "H578");
  const attach = Math.max(sm.Cyc, sm.Rigor);
  heads.forEach((hd) => { const sway = sm.Rigor > 0.5 ? 0 : Math.sin(tm / 260 + hd.i * 1.4) * 14 * sm.Cyc; const len = 13 + 11 * attach; const ex = sway * 0.4 - 5, ey = hd.side * len; hd.p.setAttribute("d", "M" + hd.x + " 355L" + f1(hd.x + ex) + " " + f1(355 + ey)); hd.p.setAttribute("opacity", (0.3 + 0.7 * Math.max(attach, 0.15)).toFixed(2)); });
  trops.forEach((tp) => { const x = tp.side < 0 ? zl + tp.d : zr - tp.d; place(tp.c, x, tp.y, 0, 0.7 + sm.Ca * 0.7); tp.c.setAttribute("opacity", (0.3 + 0.7 * sm.Ca).toFixed(2)); });
  /* calcium ions drifting around the filaments; count follows the level */
  caP.forEach((p, i) => { p.x = clamp(p.x + p.vx * dt, 342, 878); p.y = clamp(p.y + p.vy * dt, 300, 410); if (p.x <= 343 || p.x >= 877) p.vx *= -1; if (p.y <= 301 || p.y >= 409) p.vy *= -1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", i < sm.Ca * caP.length ? "1" : "0"); });
  /* ATP tokens near the myosin heads */
  atpP.forEach((p, i) => { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9 + i * 30) + ")"); p.e.setAttribute("opacity", i < sm.Atp * atpP.length ? "0.95" : "0"); });
  /* gauges */
  gg.sig.set(sm.Dep, wordOf(sm.Dep, 0.15, 0.55, ["none", "weak", "strong"])); gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.25, 0.5, ["low", "raised", "high"])); gg.sites.set(sm.Sites, wordOf(sm.Sites, 0.2, 0.55, ["covered", "partly open", "open"]));
  gg.cb.set(Math.max(sm.Cyc, sm.Rigor), sm.Rigor > 0.5 ? "locked" : wordOf(sm.Cyc, 0.15, 0.5, ["none", "some", "cycling"])); gg.short.set(sm.Short, sm.Rigor > 0.5 ? "locked" : wordOf(sm.Short, 0.08, 0.5, ["none", "weak", "strong"])); gg.atp.set(sm.Atp, wordOf(sm.Atp, 0.2, 0.6, ["absent", "low", "plenty"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
