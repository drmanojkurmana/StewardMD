/* Dengue scene: mosquito bite on real skin, virus copying in immune cells, capillary
 * plasma leak, heart racing in shock, fluids refilling the vessel and platelet support.
 * Skin and heart come from organs.lib.js; the bite, virus spread and labels anchor
 * to their ports. Each treatment visibly acts on the drawing: fluids send bright
 * inflow streams that widen the vessel and steady the heart, platelet support dots
 * top up the platelets. A caption in the stage follows the state. */
const CY = SC.CY, WW = SC.W;
const layers = { skin: $("skinSlot"), heart: $("heartSlot"), shock: $("shock"), mosq: $("mosq"), immune: $("immune"), rbc: $("rbcs"), plts: $("plts"), endo: $("endo"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), refill: $("refill"), oed: $("oedema"), fev: $("fever") };
let hh = 38;
const WALL_N = 26;
const HX = 800, HY = 180;
/* ---- real anatomy; bite, flows and labels anchor to its ports ---- */
let skinO = null, heartO = null, bite = [155, 150], skinMid = [155, 205], heartTop = [800, 105];
function initOrgans() {
  skinO = organ(layers.skin, "skin", 155, 195, 160, {});
  heartO = organ(layers.heart, "heart", HX, HY, 150, {});
  bite = skinO.ports.surface || skinO.ports.epidermis || bite;
  skinMid = skinO.ports.dermis || skinMid;
  heartTop = heartO.ports.out || heartO.ports.aorta || heartTop;
}
function capText(l, d) {
  const L = l === 0 ? "Fever phase. Virus is high but vessels still hold." : l === 1 ? "Critical phase. Plasma leaks out and circulation is at risk." : "Recovery. The leak stops and fluid returns.";
  const D = d === 1 ? " Fluids refill the blood." : d === 2 ? " Platelet support tops up platelets only." : d === 3 ? " Fluids refill the blood and platelets are topped up." : " No treatment.";
  return L + D;
}
/* ---- mosquito (original simple drawing), parked with its sting on the bite ---- */
let mosqG = null;
function initMosq() {
  mosqG = mk("g", {}, layers.mosq);
  mk("ellipse", { class: "dn-wing", cx: -4, cy: -14, rx: 17, ry: 6, transform: "rotate(-24 -4 -14)" }, mosqG);
  mk("ellipse", { class: "dn-wing", cx: 8, cy: -13, rx: 14, ry: 5, transform: "rotate(18 8 -13)" }, mosqG);
  mk("ellipse", { class: "dn-mos", cx: 0, cy: 0, rx: 16, ry: 8, transform: "rotate(-18)" }, mosqG);
  mk("circle", { class: "dn-mos", cx: 16, cy: -5, r: 5.5 }, mosqG);
  mk("path", { class: "dn-prob", d: "M19 -2L27 22" }, mosqG);
  mk("path", { class: "dn-leg", d: "M-8 5L-18 20M-2 7L-4 24M6 6L16 20" }, mosqG);
  place(mosqG, bite[0] - 27, bite[1] - 22, 0, 1);
  const mark = mk("circle", { class: "p-vir", cx: bite[0], cy: bite[1], r: 3 }, layers.mosq);
  mark.setAttribute("opacity", "0.9");
}
/* ---- immune cells where virus copies itself ---- */
const imms = [[360, 175], [480, 208]].map(([x, y], i) => {
  const g = mk("g", {}, layers.immune);
  cell(g, { cls: "mac", r: i ? 20 : 25, nuc: 0.42, seed: i * 3 + 2, wob: 0.13 });
  return { g, x, y, ph: i * 2.2 };
});
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
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
function virBuild() { const g = mk("g", {}, layers.parts); for (let j = 0; j < 6; j++) { const t = (j / 6) * 6.28; mk("path", { class: "p-virs", d: "M" + f1(Math.cos(t) * 3.4) + " " + f1(Math.sin(t) * 3.4) + "L" + f1(Math.cos(t) * 5.4) + " " + f1(Math.sin(t) * 5.4) }, g); } mk("circle", { class: "p-vir", r: 3.6 }, g); return g; }
const virs = pool(34, virBuild);
const seeds = pool(8, virBuild);
const drops = pool(32, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bols = pool(16, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const psup = pool(12, () => mk("circle", { class: "p-pltsup", r: 3.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges ---- */
const gg = {};
let capEl = null, capL = -1, capD = -1;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vir", "Virus", "g-vir", "Dengue virus level in the blood. Highest early, in the febrile phase, then falls. Treatment shown does not clear it directly."], ["fev", "Fever", "g-fev", "Fever and inflammation. High in the febrile phase, settling as recovery begins."], ["leak", "Leak", "g-fl", "How much plasma leaks through the loosened capillary wall. This drives the critical phase."], ["hct", "Haematocrit", "g-hct", "Haemoconcentration: as plasma leaves, the red cells left behind are more concentrated, so haematocrit rises. Fluids bring it back down."], ["plt", "Platelets", "g-good", "Platelet level. It falls through the illness, lowest in the critical phase, then rises in recovery."], ["bp", "Circulation", "g-good", "Circulation and blood pressure. Plasma leak lowers circulating volume and can cause shock. Fluids support it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mosquito", bite[0] - 27, bite[1] - 22, 100, 62, "Aedes mosquito. Its bite places dengue virus in the skin.");
  pill(ox, "Skin", skinMid[0], skinMid[1], 225, 62, "Skin at the bite. Virus enters here and meets immune cells nearby.");
  pill(ox, "Immune cell", 360, 175, 390, 62, "Immune cell in the tissue. Dengue virus copies itself inside cells like this, then spreads in the blood.");
  pill(ox, "Heart", heartTop[0], heartTop[1], 810, 62, "Heart. When plasma leaks and volume falls, the heart beats faster but moves less blood. Fluids steady it.");
  pill(ox, "Plasma leak", 180, CY + 45, 300, 410, "Plasma escaping through the loosened vessel wall. Red cells stay behind, so the blood left behind thickens.");
  pill(ox, "Platelets", 450, CY, 520, 410, "Platelets in the blood. Their count falls, lowest in the critical phase. Support is given only with bleeding.");
  const fl = pill(ox, "Fluids", 90, CY, 90, 410, "Fluids with monitoring. Bright inflow refills the blood, widens the vessel and steadies the heart. It does not seal the leak."); fl.setAttribute("id", "dn-fl-pill");
  const ps = pill(ox, "Platelet support", 700, CY + 15, 760, 410, "Platelet support, shown only as a treatment choice with bleeding. It tops up platelets but does not refill the blood."); ps.setAttribute("id", "dn-ps-pill");
  capEl = mk("text", { class: "dn-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { V: 0.6, F: 0.6, L: 0.2, H: 0.4, Pl: 0.6, BP: 0.8, Sh: 0.3, supF: 0, supP: 0 };
const acc = { vir: 0, seed: 0, drop: 0, bol: 0, ps: 0 };
function init() { initOrgans(); initMosq(); initEndo(); initRbc(); initPlt(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.V = lerp(sm.V, m.V, k2); sm.F = lerp(sm.F, m.F, k2); sm.L = lerp(sm.L, m.L, k2); sm.H = lerp(sm.H, m.H, k2); sm.Pl = lerp(sm.Pl, m.Pl, k2); sm.BP = lerp(sm.BP, m.BP, k1); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.supF = lerp(sm.supF, m.supF, k1); sm.supP = lerp(sm.supP, m.supP, k1);
  /* fluids refill and visibly widen the vessel; the refill wash shows the top up */
  hh = 38 - 8 * sm.L + 8 * sm.supF * sm.L + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.refill.setAttribute("opacity", (sm.supF * 0.3).toFixed(2));
  layers.oed.setAttribute("height", f1(Math.max(0, wallT - 44))); layers.oed.setAttribute("opacity", (sm.L * 0.45).toFixed(2));
  layers.fev.setAttribute("opacity", (sm.F * 0.1).toFixed(2));
  layers.shock.setAttribute("opacity", (sm.Sh * 0.45).toFixed(2));
  /* heart races weakly in shock, beats slow and full again with fluids */
  const spd = lerp(0.012, 0.006, sm.BP), amp = lerp(0.05, 0.1, sm.BP);
  heartO.g.setAttribute("transform", "translate(" + HX + " " + HY + ") scale(" + (1 + amp * Math.pow(Math.max(0, Math.sin(tm * spd)), 3)).toFixed(3) + ")");
  /* mosquito bobs over the bite */
  if (mosqG) place(mosqG, bite[0] - 27 + Math.sin(tm / 700) * 3, bite[1] - 22 + Math.cos(tm / 900) * 2.5, Math.sin(tm / 1200) * 5, 1);
  /* endothelium loosens as leak rises; fluids do not reseal it */
  const gapK = 1 - 0.26 * sm.L;
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + gapK.toFixed(3) + " 1)"); e.g.style.setProperty("--act", sm.L.toFixed(2)); }));
  /* immune cells bob; virus also trickles from the bite to the cells */
  imms.forEach((im, i) => place(im.g, im.x + Math.sin(tm / 1500 + im.ph) * 3, im.y + Math.cos(tm / 1800 + im.ph) * 2.5, Math.sin(tm / 2600 + im.ph) * 6, 1 + 0.05 * sm.V * Math.sin(tm / 300 + i)));
  acc.seed += dt * sm.V * 5; while (acc.seed >= 1) { acc.seed--; const p = free(seeds), im = pick(imms); if (p) { emit(p, bite[0], bite[1], 0, 0, 0); p.tx = im.x; p.ty = im.y; } }
  seeds.forEach((p) => { if (!p.on) return; p.t += dt; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1, st = Math.min(d, 60 * dt); p.x += dx / d * st; p.y += dy / d * st; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 5) kill(p); });
  /* virus bursts out of immune cells and drifts to the vessel */
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
  /* caption follows the state */
  if (m.lev !== capL || m.drug !== capD) { capL = m.lev; capD = m.drug; const t = capText(capL, capD); if (capEl.textContent !== t) capEl.textContent = t; }
  /* gauges */
  gg.vir.set(sm.V, wordOf(sm.V, 0.25, 0.6, ["low", "present", "high"])); gg.fev.set(sm.F, wordOf(sm.F, 0.3, 0.65, ["settled", "present", "high"])); gg.leak.set(sm.L, wordOf(sm.L, 0.25, 0.6, ["none", "mild", "severe"]));
  gg.hct.set(sm.H, wordOf(sm.H, 0.4, 0.65, ["normal", "rising", "high"])); gg.plt.set(sm.Pl, wordOf(sm.Pl, 0.35, 0.6, ["very low", "falling", "preserved"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.45, 0.7, ["at risk", "borderline", "stable"]));
}
run({ init, step });
