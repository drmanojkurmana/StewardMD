/* Pulmonary oedema scene: Starling forces, interstitial then alveolar fluid, failing gas exchange and treatment effects. */
const layers = { cells: $("cellsG"), rbcs: $("rbcsG"), parts: $("parts"), over: $("over"), panel: $("panel"), fluid: $("fluidEl"), inter: $("interEl"), band: $("interBand"), airEl: $("alvAir"), outer: $("alvOuter"), cap: $("capLumen"), hydro: $("hydroArrow"), onc: $("oncArrow"), vein: $("vein"), fx: $("fx"), cloud: $("cloudG") };
const HX = 100, HY = 168, LX = 100, LY = 302, BX = 842, BY = 248;
let heartO = null, lungO = null, brainO = null, capEl = null, capKey = "", cyEl = null;
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", HX, HY, 96, {});
  lungO = organ($("lungSlot"), "lung", LX, LY, 88, { flip: true });
  brainO = organ($("brainSlot"), "brain", BX, BY, 116, {});
  cyEl = mk("ellipse", { class: "po-cy", cx: BX, cy: BY, rx: 56, ry: 58, opacity: "0" }, layers.fx);
}
const trVein = track([[132, 196], [210, 214], [280, 272], [352, 338]]);
const trLeak = track([[132, 298], [220, 290], [310, 265], [386, 242]]);
const trOut = track([[708, 344], [750, 340], [775, 315], [788, 292]]);
/* ---- epithelial cells around the alveolus ---- */
const epi = [];
function initEpi() { for (let i = 0; i < 16; i++) { const t = (i / 16) * 6.283, g = cell(layers.cells, { cls: "epi", r: 8, nuc: 0.4, seed: i + 3, wob: 0.1 }); epi.push({ g, t }); } }
/* ---- endothelium along the capillary ---- */
const endo = [];
function initEndo() { for (let i = 0; i < 13; i++) { const x = 368 + i * 27; [326, 362].forEach((y, r) => { const g = cell(layers.cells, { cls: "endo", r: 7, nuc: 0.3, seed: i + r * 20, wob: 0.08, n: 8 }); endo.push({ g, x, y }); }); } }
/* ---- red cells in the capillary ---- */
const rbcs = Array.from({ length: 13 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return { g, x: 356 + i * 27, y: rnd(-8, 8), v: rnd(0.8, 1.2) }; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const drops = pool(34, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const oxys = pool(24, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, layers.parts));
const airs = pool(20, () => mk("circle", { class: "sc-p p-air2", r: 2.8 }, layers.parts));
const vens = pool(16, () => mk("circle", { class: "sc-p p-ven", r: 3 }, layers.parts));
const injs = pool(16, () => mk("path", { class: "sc-p p-inj", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const outs = pool(14, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- injury cloud over the ARDS lung ---- */
const puffs = [];
function initCloud() {
  [[78, 280, 16], [105, 272, 19], [122, 295, 15], [82, 320, 17], [108, 322, 18], [95, 302, 14], [125, 318, 13]]
    .forEach(([x, y, r]) => { const e = mk("circle", { class: "po-cloud", cx: x, cy: y, r: r, opacity: "0" }, layers.cloud); puffs.push({ e, r }); });
}
/* ---- pressure support waves in the airway ---- */
const chevs = [];
function initChev() { for (let i = 0; i < 3; i++) chevs.push(mk("path", { class: "po-ppv", d: "M-8 0L0 7L8 0", opacity: "0" }, layers.fx)); }
function capText(d, l) {
  if (d === 1) return l === 0 ? "Treating the cause keeps pressures low. Fluid stays in the lung wall." : "Treating the cause lowers pressure and seals the leak. Air spaces reopen.";
  if (d === 2) return l === 2 ? "Diuretic with nitrate drains fluid and lowers pressure. Flooding shrinks back." : "Diuretic with nitrate lowers filling pressure. Less fluid is pushed out.";
  if (d === 3) return "Pressure support holds air sacs open. Oxygen rises while the cause is treated.";
  return l === 0 ? "No treatment. Fluid sits only in the lung wall and breathing stays easy." : l === 1 ? "No treatment. Fluid enters the air sacs and oxygen dips." : "No treatment. Air sacs flood widely and oxygen falls.";
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lung fluid";
  [["hydro", "Hydrostatic", "g-hydro", "Capillary hydrostatic pressure, set mainly by left sided heart filling pressure. Higher pressure pushes more fluid out of the capillary."], ["perm", "Permeability", "g-perm", "How leaky the alveolar capillary barrier is. Injury as in acute respiratory distress syndrome makes it leak protein rich fluid."], ["fluid", "Lung fluid", "g-fluid", "Fluid in the interstitium and then inside alveoli. It starts between the capillary and the alveolus and floods the air space when it overwhelms clearance."], ["air", "Air space", "g-air", "Air space still open for gas exchange. Positive pressure support can recruit flooded alveoli and reopen some of this space."], ["oxy", "Oxygen", "g-oxy", "Oxygen reaching the blood. Flooded alveoli are perfused but not ventilated, so blood passing them stays oxygen poor."], ["work", "Breathing", "g-work", "Work of breathing. A flooded, stiff lung makes each breath harder, so breathing becomes laboured."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Failing left heart", 104, 132, 120, 92, "Failing left heart: left heart failure or mitral valve disease raises pressure in the pulmonary veins and capillaries, pushing fluid out. This is cardiogenic pulmonary oedema.");
  pill(ox, "Alveolar wall", 402, 168, 290, 92, "Alveolar wall: the thin barrier of alveolar epithelium, interstitium and capillary endothelium across which gas exchange happens and across which oedema fluid moves.");
  pill(ox, "Airway", 540, 72, 430, 92, "Airway: brings air to the alveolus. Positive pressure support uses this route to recruit flooded alveoli and improve oxygen.");
  pill(ox, "Flooded alveolus", 596, 282, 640, 92, "Flooded alveolus: an air sac filled with oedema fluid. It cannot take part in gas exchange, so blood passing it leaves still short of oxygen.");
  pill(ox, "Gas exchange", 748, 339, 820, 92, "Gas exchange: oxygen moving from alveolar air into capillary blood, carried on toward the body. Flooding blocks it and oxygen falls.");
  pill(ox, "Leaky barrier in ARDS", 62, 302, 110, 395, "Leaky barrier in ARDS: in acute respiratory distress syndrome the alveolar capillary barrier is injured and permeability rises, so fluid leaks even without raised heart pressures. This is non-cardiogenic pulmonary oedema.");
  pill(ox, "Interstitium", 420, 314, 265, 395, "Interstitium: the thin space between capillary and alveolus. Oedema fluid collects here first, thickening the barrier before it floods the air space.");
  pill(ox, "Capillary", 470, 344, 395, 395, "Pulmonary capillary: blood flowing past the alveolus. Starling forces across its wall decide whether fluid stays in, leaks into the interstitium, or is drawn back.");
  pill(ox, "Endothelium", 640, 336, 525, 395, "Capillary endothelium: the vessel lining. Together with the alveolar epithelium it forms the barrier whose permeability rises when it is injured.");
  pill(ox, "Hydrostatic push", 452, 300, 665, 395, "Hydrostatic push: pressure inside the capillary pushing fluid out through the wall. A diuretic and a nitrate lower preload and bring this push down.");
  pill(ox, "Starling forces", 628, 300, 830, 395, "Starling forces: hydrostatic pressure pushing fluid out of the capillary against plasma oncotic pressure pulling fluid back in, modified by how leaky the wall is. The balance sets net filtration.");
  capEl = mk("text", { class: "po-cap2", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { Hydro: 0.6, Perm: 0.5, Fluid: 0.6, Inter: 0.6, Alv: 0.5, Air: 0.5, Oxy: 0.5, Work: 0.5, cause: 0, diur: 0, ppv: 0 };
const acc = { drop: 0, oxy: 0, air: 0, ven: 0, inj: 0, out: 0 };
function init() { initOrgans(); initCloud(); initChev(); initEpi(); initEndo(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  ["Hydro", "Perm", "Fluid", "Inter", "Alv", "Air", "Oxy", "Work"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.cause = lerp(sm.cause, m.cause, k1); sm.diur = lerp(sm.diur, m.diur, k1); sm.ppv = lerp(sm.ppv, m.ppv, k1);
  const breath = 0.5 - 0.5 * Math.cos(tm * 0.0016), amp = clamp(sm.Air) * (1 + 0.25 * sm.ppv);
  const orx = 152 * (1 + 0.04 * breath * amp), ory = 98 * (1 + 0.06 * breath * amp), arx = 134 * (1 + 0.04 * breath * amp), ary = 82 * (1 + 0.06 * breath * amp);
  layers.outer.setAttribute("rx", f1(orx)); layers.outer.setAttribute("ry", f1(ory));
  layers.airEl.setAttribute("rx", f1(arx)); layers.airEl.setAttribute("ry", f1(ary));
  layers.inter.setAttribute("rx", f1(orx + 14)); layers.inter.setAttribute("ry", f1(ory + 14)); layers.inter.setAttribute("opacity", (0.28 * sm.Inter).toFixed(2));
  layers.band.setAttribute("opacity", (0.55 * sm.Inter).toFixed(2));
  layers.fluid.setAttribute("opacity", (0.62 * sm.Alv).toFixed(2)); layers.fluid.setAttribute("ry", f1(8 + 34 * sm.Alv)); layers.fluid.setAttribute("cy", f1(292 - 22 * sm.Alv)); layers.fluid.setAttribute("rx", f1(70 + 52 * sm.Alv));
  layers.vein.setAttribute("stroke-width", f1(9 + 13 * sm.Hydro));
  layers.hydro.setAttribute("opacity", (0.25 + 0.75 * sm.Hydro).toFixed(2));
  layers.hydro.setAttribute("stroke-width", f1(2 + 5 * sm.Hydro));
  layers.onc.setAttribute("opacity", (0.85 - 0.35 * sm.Perm).toFixed(2));
  layers.cap.setAttribute("y", f1(326 + 3.5 * sm.diur)); layers.cap.setAttribute("height", f1(36 - 7 * sm.diur));
  /* failing heart strains: the beat weakens as pressure backs up and recovers with treatment */
  place(heartO.g, HX, HY, 0, 1 + 0.035 * Math.sin(tm / 280) * (0.3 + 0.7 * (1 - sm.Hydro)));
  /* injury cloud over the ARDS lung shrinks as the cause is treated */
  puffs.forEach((p) => { p.e.setAttribute("r", f1(p.r * (0.55 + 0.5 * sm.Perm))); p.e.setAttribute("opacity", (0.6 * sm.Perm).toFixed(2)); });
  /* brain blues as oxygen falls and pinks up again with treatment */
  cyEl.setAttribute("opacity", ((1 - sm.Oxy) * 0.5).toFixed(2));
  /* pressure support waves travel down the airway */
  chevs.forEach((c, i) => { const y = 78 + ((tm * 0.035 + i * 16) % 48); c.setAttribute("transform", "translate(540 " + f1(y) + ")"); c.setAttribute("opacity", (0.08 + 0.8 * sm.ppv).toFixed(2)); });
  /* wall cells */
  epi.forEach((e) => { const x = 540 + Math.cos(e.t) * arx, y = 226 + Math.sin(e.t) * ary; place(e.g, x, y, 0, 1 - 0.18 * sm.Perm); });
  endo.forEach((e) => place(e.g, e.x, e.y, 0, 1 - 0.2 * sm.Perm));
  /* red cells flow through the capillary */
  rbcs.forEach((r) => { r.x += r.v * 54 * (0.35 + 0.65 * sm.Oxy) * dt; if (r.x > 704) { r.x = 356; r.y = rnd(-8, 8); } place(r.g, clamp(r.x, 356, 704), clamp(344 + r.y, 334, 354), 0, 1); });
  /* venous backup: blood drains toward the failing heart, slow and engorged when pressure is high */
  acc.ven += dt * (3 + 5 * (1 - sm.Hydro)); while (acc.ven >= 1) { acc.ven--; const p = freeP(vens); if (p) { p.u = 1; p.on = true; p.e.setAttribute("opacity", "1"); } }
  vens.forEach((p) => { if (!p.on) return; p.u -= dt * (26 + 110 * (1 - sm.Hydro)) / trVein.len; if (p.u <= 0) { killP(p); return; } const q = trVein.at(p.u); place(p.e, q.x, q.y, 0, 1); });
  /* injury particles drift from the injured lung to the alveolar wall while the barrier is leaky */
  acc.inj += dt * 9 * sm.Perm; while (acc.inj >= 1) { acc.inj--; const p = freeP(injs); if (p) { p.u = 0; p.on = true; p.e.setAttribute("opacity", "1"); } }
  injs.forEach((p) => { if (!p.on) return; p.u += dt * 70 / trLeak.len; if (p.u >= 1) { killP(p); return; } const q = trLeak.at(p.u); place(p.e, q.x, q.y, tm / 6, 1); });
  /* oxygenated blood leaves for the brain; the stream thins as flooding worsens */
  acc.out += dt * (1 + 7 * sm.Oxy); while (acc.out >= 1) { acc.out--; const p = freeP(outs); if (p) { p.u = 0; p.on = true; p.e.setAttribute("opacity", "1"); } }
  outs.forEach((p) => { if (!p.on) return; p.u += dt * 90 / trOut.len; if (p.u >= 1) { killP(p); return; } const q = trOut.at(p.u); place(p.e, q.x, q.y, 0, 1); });
  /* leaked fluid: droplets cross the capillary wall into the alveolus; the diuretic turns much of the stream back */
  acc.drop += dt * sm.Fluid * 11 * (1 - 0.65 * sm.diur); while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) { emitP(p, rnd(390, 680), 324, rnd(-4, 4), -rnd(16, 28), 0); if (Math.random() < 0.55 * sm.diur) p.k = 1; } }
  drops.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.k === 1) { if (p.t > 0.55) p.vy = 46; p.x = clamp(p.x + p.vx * dt, 380, 700); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (p.vy > 0 ? clamp(1 - (p.y - 316) / 16) : 1).toFixed(2)); if (p.y > 332) killP(p); return; }
    p.x = clamp(p.x + p.vx * dt, 380, 700); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 178 || p.t > 4.5) killP(p);
  });
  /* oxygen: dots cross from alveolar air into the capillary, fewer when flooded */
  acc.oxy += dt * (1.5 + 8 * sm.Air * sm.Oxy); while (acc.oxy >= 1) { acc.oxy--; const p = freeP(oxys); if (p) emitP(p, rnd(430, 650), rnd(180, 265), rnd(-3, 3), rnd(22, 34), 0); }
  oxys.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 400, 680); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 342 || p.t > 4) killP(p); });
  /* air: enters down the airway, steadier and stronger with positive pressure support */
  acc.air += dt * (2 + 6 * sm.Air) * (sm.ppv ? 1.5 : 1); while (acc.air >= 1) { acc.air--; const p = freeP(airs); if (p) emitP(p, 540 + rnd(-5, 5), 74, rnd(-3, 3), rnd(30, 46), 0); }
  airs.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 300 + p.y) * 0.25, 415, 665); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 282 || p.t > 4) killP(p); });
  /* gauges */
  gg.hydro.set(sm.Hydro, wordOf(sm.Hydro, 0.35, 0.65, ["normal", "raised", "high"])); gg.perm.set(sm.Perm, wordOf(sm.Perm, 0.35, 0.65, ["normal", "raised", "high"])); gg.fluid.set(sm.Fluid, wordOf(sm.Fluid, 0.4, 0.7, ["interstitial", "alveolar", "widespread"]));
  gg.air.set(sm.Air, wordOf(sm.Air, 0.38, 0.68, ["much reduced", "reduced", "open"])); gg.oxy.set(sm.Oxy, wordOf(sm.Oxy, 0.4, 0.68, ["low", "reduced", "near normal"])); gg.work.set(sm.Work, wordOf(sm.Work, 0.38, 0.68, ["easy", "laboured", "very laboured"]));
  const key = drug + ":" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
