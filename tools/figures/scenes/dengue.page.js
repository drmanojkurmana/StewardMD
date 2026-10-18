/* Dengue scene: mosquito bite, virus replication in immune cells, capillary plasma leak, haemoconcentration, falling platelets and recovery. */
const CY = SC.CY, WW = SC.W;
const layers = { mosq: $("mosq"), immune: $("immune"), rbc: $("rbcs"), plts: $("plts"), endo: $("endo"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema"), fev: $("fever") };
let hh = 38;
const WALL_N = 26;
/* ---- mosquito (original simple drawing, above the skin line) ---- */
let mosqG = null;
function initMosq() {
  mosqG = mk("g", {}, layers.mosq);
  mk("ellipse", { class: "dn-wing", cx: -4, cy: -14, rx: 17, ry: 6, transform: "rotate(-24 -4 -14)" }, mosqG);
  mk("ellipse", { class: "dn-wing", cx: 8, cy: -13, rx: 14, ry: 5, transform: "rotate(18 8 -13)" }, mosqG);
  mk("ellipse", { class: "dn-mos", cx: 0, cy: 0, rx: 16, ry: 8, transform: "rotate(-18)" }, mosqG);
  mk("circle", { class: "dn-mos", cx: 16, cy: -5, r: 5.5 }, mosqG);
  mk("path", { class: "dn-prob", d: "M19 -2L27 22" }, mosqG);
  mk("path", { class: "dn-leg", d: "M-8 5L-18 20M-2 7L-4 24M6 6L16 20" }, mosqG);
  place(mosqG, 118, 118, 0, 1);
  const bite = mk("circle", { class: "p-vir", cx: 145, cy: 148, r: 3 }, layers.mosq);
  bite.setAttribute("opacity", "0.9");
}
/* ---- immune cells where virus copies itself ---- */
const imms = [[470, 162], [592, 198]].map(([x, y], i) => {
  const g = mk("g", {}, layers.immune);
  const c = cell(g, { cls: "mac", r: i ? 20 : 25, nuc: 0.42, seed: i * 3 + 2, wob: 0.13 });
  return { g, x, y, ph: i * 2.2 };
});
/* a single still virus marker that the Virus pill points at */
function initVirusMark() {
  const g = mk("g", {}, layers.parts);
  for (let j = 0; j < 8; j++) { const t = (j / 8) * 6.28; mk("path", { class: "p-virs", d: "M" + f1(Math.cos(t) * 5) + " " + f1(Math.sin(t) * 5) + "L" + f1(Math.cos(t) * 8) + " " + f1(Math.sin(t) * 8) }, g); }
  mk("circle", { class: "p-vir", r: 5 }, g);
  place(g, 372, 138, 0, 1);
}
/* ---- endothelium: two rows along the capillary wall ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
/* ---- red cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- platelets flowing in the lumen ---- */
const fplts = [];
function initPlt() { for (let i = 0; i < 14; i++) { const g = mk("g", {}, layers.plts); cell(g, { cls: "plt", r: 5.5, seed: i + 7, wob: 0.15, n: 7 }); fplts.push({ g, x: rnd(0, WW), y: rnd(-24, 24), v: rnd(0.7, 1.1) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
function virBuild() { const g = mk("g", {}, layers.parts); for (let j = 0; j < 6; j++) { const t = (j / 6) * 6.28; mk("path", { class: "p-virs", d: "M" + f1(Math.cos(t) * 3.4) + " " + f1(Math.sin(t) * 3.4) + "L" + f1(Math.cos(t) * 5.4) + " " + f1(Math.sin(t) * 5.4) }, g); } mk("circle", { class: "p-vir", r: 3.6 }, g); return g; }
const virs = pool(34, virBuild);
const drops = pool(32, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bols = pool(16, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const psup = pool(12, () => mk("circle", { class: "p-pltsup", r: 3.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vir", "Virus", "g-vir", "Dengue virus level in the blood. Highest early, in the febrile phase, then falls. Treatment shown does not clear it directly."], ["fev", "Fever", "g-fev", "Fever and inflammation. High in the febrile phase, settling as recovery begins."], ["leak", "Leak", "g-fl", "How much plasma leaks through the loosened capillary wall. This drives the critical phase."], ["hct", "Haematocrit", "g-hct", "Haemoconcentration: as plasma leaves, the red cells left behind are more concentrated, so haematocrit rises."], ["plt", "Platelets", "g-good", "Platelet level. It falls through the illness, lowest in the critical phase, then rises in recovery."], ["bp", "Circulation", "g-good", "Circulation and blood pressure. Plasma leak lowers circulating volume and can cause shock. Fluids support it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mosquito", 132, 128, 210, 74, "Aedes mosquito. Its bite places dengue virus in the skin. Only a biting mosquito is shown; breeding sites and other spread are not.");
  pill(ox, "Virus", 372, 138, 370, 74, "Dengue virus. It infects immune cells, copies itself there, then circulates in the blood.");
  pill(ox, "Immune cell", 470, 136, 530, 74, "Immune cell in the tissue. Dengue virus infects cells like this and copies itself inside them before spreading in the blood.");
  pill(ox, "Vessel wall", 720, 244, 715, 74, "Endothelium: the single-cell lining of the capillary. In the critical phase its seals loosen and plasma leaks out.");
  pill(ox, "Plasma leak", 180, 330, 180, 410, "Plasma escaping through the loosened capillary wall into the tissue. This is the central problem of the critical phase.");
  pill(ox, "Platelets", 380, 285, 380, 410, "Platelets in the blood. Their count falls, lowest in the critical phase. Support is given only if there is bleeding.");
  pill(ox, "Red cells", 580, 285, 580, 410, "Red cells. They stay in the vessel while plasma leaks out, so the blood left behind becomes more concentrated.");
  const fl = pill(ox, "Fluids", 880, 262, 880, 205, "Intravenous fluids with monitoring. They replace leaked plasma and support circulation, but do not seal the leak."); fl.setAttribute("id", "dn-fl-pill");
  const ps = pill(ox, "Platelet support", 700, 318, 880, 150, "Platelet support, shown only as a treatment choice for bleeding. It raises platelets briefly and does not restore circulating volume."); ps.setAttribute("id", "dn-ps-pill");
}
const sm = { V: 0.6, F: 0.6, L: 0.2, H: 0.4, Pl: 0.6, BP: 0.8, supF: 0, supP: 0 };
const acc = { vir: 0, drop: 0, bol: 0, ps: 0 };
function init() { initMosq(); initVirusMark(); initEndo(); initRbc(); initPlt(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.V = lerp(sm.V, m.V, k2); sm.F = lerp(sm.F, m.F, k2); sm.L = lerp(sm.L, m.L, k2); sm.H = lerp(sm.H, m.H, k2); sm.Pl = lerp(sm.Pl, m.Pl, k2); sm.BP = lerp(sm.BP, m.BP, k1); sm.supF = lerp(sm.supF, m.supF, k1); sm.supP = lerp(sm.supP, m.supP, k1);
  hh = 38 - 8 * sm.L + 6 * sm.supF * sm.L + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oed.setAttribute("height", f1(Math.max(0, wallT - 44))); layers.oed.setAttribute("opacity", (sm.L * 0.45).toFixed(2));
  layers.fev.setAttribute("opacity", (sm.F * 0.1).toFixed(2));
  /* mosquito bobs over the bite */
  if (mosqG) place(mosqG, 118 + Math.sin(tm / 700) * 3, 118 + Math.cos(tm / 900) * 2.5, Math.sin(tm / 1200) * 5, 1);
  /* endothelium loosens as leak rises */
  const gapK = 1 - 0.26 * sm.L;
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + gapK.toFixed(3) + " 1)"); e.g.style.setProperty("--act", sm.L.toFixed(2)); }));
  /* immune cells bob; virus bursts out of them and drifts to the vessel */
  imms.forEach((im, i) => place(im.g, im.x + Math.sin(tm / 1500 + im.ph) * 3, im.y + Math.cos(tm / 1800 + im.ph) * 2.5, Math.sin(tm / 2600 + im.ph) * 6, 1 + 0.05 * sm.V * Math.sin(tm / 300 + i)));
  acc.vir += dt * sm.V * 11; while (acc.vir >= 1) { acc.vir--; const p = free(virs), im = pick(imms); if (p) emit(p, im.x + rnd(-16, 16), im.y + rnd(-12, 12), rnd(-10, 18), rnd(22, 38), 0); }
  virs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 400 + p.y) * 0.3; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.t - 2.2) / 1.2).toFixed(2)); if (p.y > wallT - 6 || p.t > 3.6) kill(p); });
  /* plasma leak outwards; in recovery, fluid drifts back in */
  const recov = m.lev === 2;
  acc.drop += dt * sm.L * (recov ? 4 : 10); while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (!p) continue; const up = Math.random() < 0.55;
    if (recov) emit(p, rnd(60, WW - 60), up ? wallT - rnd(34, 58) : wallB + rnd(34, 58), 0, up ? rnd(16, 24) : -rnd(16, 24), up ? 2 : 3);
    else emit(p, rnd(60, WW - 60), up ? wallT + 4 : wallB - 4, rnd(-4, 4), up ? -rnd(16, 26) : rnd(16, 26), up ? 0 : 1); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.k === 0 && p.y < wallT - 64) kill(p); if (p.k === 1 && p.y > wallB + 64) kill(p); if (p.k === 2 && p.y > wallT - 4) kill(p); if (p.k === 3 && p.y < wallB + 4) kill(p); if (p.t > 4) kill(p); });
  /* red cells flow, slower and more crowded when concentrated and circulation is poor */
  const flow = clamp(0.25 + 0.85 * sm.BP);
  rbcs.forEach((r) => { r.x += r.v * 66 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 0.9 + 0.25 * sm.H); });
  /* platelets: fewer visible as the count falls */
  const wantP = Math.round(sm.Pl * fplts.length);
  fplts.forEach((p, i) => { const on = i < wantP; p.g.style.opacity = on ? 1 : 0; if (!on) return; p.x += p.v * 66 * flow * dt; if (p.x > WW + 8) { p.x = -8; p.y = rnd(-(hh - 14), hh - 14); } place(p.g, p.x, CY + clamp(p.y, -(hh - 12), hh - 12), 0, 1); });
  /* fluids refilling the lumen */
  acc.bol += dt * sm.supF * 6; while (acc.bol >= 1) { acc.bol--; const p = free(bols); if (p) emit(p, -6, CY + rnd(-hh + 12, hh - 12), 90, 0, 0); }
  bols.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW + 6) kill(p); });
  /* platelet support entering the vessel */
  acc.ps += dt * sm.supP * 5; while (acc.ps >= 1) { acc.ps--; const p = free(psup); if (p) emit(p, -6, CY + rnd(-hh + 14, hh - 14), 78, 0, 0); }
  psup.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW + 6) kill(p); });
  $("dn-fl-pill").style.opacity = sm.supF.toFixed(2); $("dn-ps-pill").style.opacity = sm.supP.toFixed(2);
  /* gauges */
  gg.vir.set(sm.V, wordOf(sm.V, 0.25, 0.6, ["low", "present", "high"])); gg.fev.set(sm.F, wordOf(sm.F, 0.3, 0.65, ["settled", "present", "high"])); gg.leak.set(sm.L, wordOf(sm.L, 0.25, 0.6, ["none", "mild", "severe"]));
  gg.hct.set(sm.H, wordOf(sm.H, 0.4, 0.65, ["normal", "rising", "high"])); gg.plt.set(sm.Pl, wordOf(sm.Pl, 0.35, 0.6, ["very low", "falling", "preserved"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.45, 0.7, ["at risk", "borderline", "stable"]));
}
run({ init, step });
