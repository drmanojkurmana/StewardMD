/* ARDS scene: injured alveolar capillary barrier, protein rich oedema, hyaline membranes, neutrophils, shunt, stiff lung and fibrosis. */
const layers = { cells: $("cellsG"), coll: $("collG"), rbcs: $("rbcsG"), parts: $("parts"), over: $("over"), panel: $("panel"), surf: $("surfG"), fluid: $("fluidEl"), hyal: $("hyal"), air: $("alvAir"), outer: $("alvOuter"), mini: $("miniLung"), cap: $("capLumen") };
/* ---- epithelial cells around the alveolus ---- */
const epi = [];
function initEpi() { for (let i = 0; i < 16; i++) { const t = (i / 16) * 6.283, g = cell(layers.cells, { cls: i % 4 === 0 ? "type2" : "epi", r: i % 4 === 0 ? 10 : 8, nuc: 0.4, seed: i + 3, wob: 0.1 }); epi.push({ g, t, type2: i % 4 === 0 }); } }
/* ---- endothelium along the capillary ---- */
const endo = [];
function initEndo() { for (let i = 0; i < 12; i++) { const x = 348 + i * 24; [325, 359].forEach((y, r) => { const g = cell(layers.cells, { cls: "endo", r: 7, nuc: 0.3, seed: i + r * 20, wob: 0.08, n: 8 }); endo.push({ g, x, y }); }); } }
/* ---- surfactant dots on the inner alveolar surface ---- */
const surfDots = [];
function initSurf() { for (let i = 0; i < 14; i++) { const t = (i / 14) * 6.283; surfDots.push(mk("circle", { class: "ards-surf", r: 2.4, cx: f1(480 + Math.cos(t) * 126), cy: f1(225 + Math.sin(t) * 74) }, layers.surf)); } }
/* ---- collagen strands and fibroblasts in the interstitium ---- */
const colls = [];
function initColl() { for (let i = 0; i < 12; i++) { const t = (i / 12) * 6.283, x = 480 + Math.cos(t) * 155, y = 225 + Math.sin(t) * 101; const p = mk("path", { class: "ards-coll", d: "M" + f1(x - 12) + " " + f1(y) + "Q" + f1(x) + " " + f1(y - 6) + " " + f1(x + 12) + " " + f1(y) }, layers.coll); colls.push(p); } }
const fibros = Array.from({ length: 5 }, (_, i) => { const g = cell(layers.cells, { cls: "fibro", r: 9, nuc: 0.4, seed: i + 30, wob: 0.14 }); const t = 0.6 + i * 1.1; return { g, x: 480 + Math.cos(t) * 155, y: 225 + Math.sin(t) * 101 }; });
/* ---- neutrophils that leave the capillary for the alveolus ---- */
const neus = Array.from({ length: 6 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 50, wob: 0.14 }), x: 360 + i * 40, y: 342, tx: 390 + i * 32, ty: 245 + (i % 3) * 22, ph: i * 1.3 }));
/* ---- red cells in the capillary and in shunted blood ---- */
const rbcs = Array.from({ length: 14 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return { g, x: 330 + i * 22, y: rnd(-8, 8), v: rnd(0.8, 1.2) }; });
const shuntRbcs = Array.from({ length: 6 }, (_, i) => { const e = mk("ellipse", { rx: 7, ry: 4.2, fill: "#4a3560", stroke: "#2c1e3e", "stroke-width": 0.7 }, layers.rbcs); return { e, x: 728 + i * 28, y: 304 + rnd(-5, 5) }; });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const prots = pool(28, () => mk("circle", { class: "sc-p p-prot", r: 2.6 }, layers.parts));
const airs = pool(18, () => mk("circle", { class: "sc-p p-air2", r: 2.8 }, layers.parts));
const injs = pool(12, () => mk("path", { class: "sc-p p-inj", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lung injury";
  [["oed", "Oedema", "g-oed", "Protein rich fluid in the alveolus. It floods the air space, blocks gas exchange and washes out surfactant."], ["neut", "Neutrophils", "g-neut", "Neutrophils drawn into the injured lung. They help defence but their products add to epithelial and endothelial damage."], ["shunt", "Shunt", "g-shunt", "Blood that passes flooded or collapsed alveoli without picking up oxygen. It mixes with oxygenated blood and lowers arterial oxygen."], ["oxy", "Oxygen", "g-oxy", "Oxygen in the blood. It stays low in shunt even when more oxygen is given, which is refractory hypoxaemia."], ["stiff", "Stiffness", "g-stiff", "How stiff the lung is. Flooded, collapsed and later fibrotic lung needs more pressure for the same breath, so compliance is low."], ["fib", "Fibrosis", "g-fib", "Collagen laid down in the interstitial space in the later fibrotic phase. It thickens the barrier and keeps the lung stiff."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Direct injury", 105, 120, 110, 92, "Direct injury from the air side, for example pneumonia or aspiration, hits the alveolar epithelium first.");
  pill(ox, "Indirect injury", 105, 310, 110, 370, "Indirect injury from the blood side, for example a severe systemic infection or pancreatitis, hits the capillary endothelium first.");
  pill(ox, "Epithelium", 375, 155, 270, 92, "Alveolar epithelium: the thin lining of the air sac. Type I cells form most of the surface and type II cells make surfactant and can grow to repair it.");
  pill(ox, "Airway", 480, 85, 430, 92, "Airway: brings air to the alveolus. In a stiff, flooded lung each breath moves less air for the same pressure.");
  pill(ox, "Hyaline membrane", 575, 165, 570, 92, "Hyaline membrane: protein and cell debris plastered on the injured alveolar wall in the exudative phase. It thickens the barrier to gas exchange.");
  pill(ox, "Alveolar fluid", 530, 285, 770, 92, "Alveolar fluid: protein rich oedema that has leaked through the damaged epithelial and endothelial barrier and flooded the air space.");
  pill(ox, "Neutrophil", 410, 260, 210, 225, "Neutrophil: a white cell that leaves the capillary and enters the alveolus during the exudative phase, adding to barrier injury.");
  pill(ox, "Stiff lung", 800, 175, 800, 140, "Stiff lung: the small lung drawing barely expands with each breath when compliance is low, in flooding early and in fibrosis later.");
  pill(ox, "Shunted blood", 810, 304, 800, 350, "Shunted blood: dark, oxygen poor blood that has passed flooded alveoli without gas exchange and mixes into the arterial blood.");
  pill(ox, "Surfactant loss", 450, 295, 380, 382, "Surfactant loss: surfactant is washed out and not replaced when type II cells are injured, so alveoli collapse more easily and the lung stiffens.");
  pill(ox, "Capillary", 480, 342, 550, 382, "Pulmonary capillary: blood flowing past the alveolus. When the alveolus is flooded this blood leaves still oxygen poor.");
  pill(ox, "Endothelium", 600, 328, 680, 382, "Capillary endothelium: the vessel lining. When it is injured the barrier leaks protein rich fluid toward the alveolus.");
}
const sm = { Leak: 0.8, Fluid: 0.8, Neut: 0.8, Fib: 0.1, Sh: 0.8, Ox: 0.2, Stiff: 0.7, Comp: 0.3, Hyal: 0.8, Surf: 0.2, prone: 0, lpv: 0, cause: 0, phase: 0 };
const acc = { prot: 0, air: 0, inj: 0 };
function init() { initEpi(); initEndo(); initSurf(); initColl(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  ["Leak", "Fluid", "Neut", "Fib", "Sh", "Ox", "Stiff", "Comp", "Hyal", "Surf"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.prone = lerp(sm.prone, m.prone, k1); sm.lpv = lerp(sm.lpv, m.lpv, k1); sm.cause = lerp(sm.cause, m.cause, k1); sm.phase = m.phase;
  const breath = 0.5 - 0.5 * Math.cos(tm * 0.0016), amp = sm.Comp * (1 - 0.4 * sm.lpv);
  const orx = 165 * (1 + 0.05 * breath * amp), ory = 110 * (1 + 0.07 * breath * amp), arx = 145 * (1 + 0.05 * breath * amp), ary = 92 * (1 + 0.07 * breath * amp);
  layers.outer.setAttribute("rx", f1(orx)); layers.outer.setAttribute("ry", f1(ory));
  layers.air.setAttribute("rx", f1(arx)); layers.air.setAttribute("ry", f1(ary));
  layers.hyal.setAttribute("rx", f1(arx - 9)); layers.hyal.setAttribute("ry", f1(ary - 8)); layers.hyal.setAttribute("opacity", (0.85 * sm.Hyal).toFixed(2));
  layers.fluid.setAttribute("opacity", (0.6 * sm.Fluid).toFixed(2)); layers.fluid.setAttribute("ry", f1(14 + 26 * sm.Fluid)); layers.fluid.setAttribute("cy", f1(296 - 18 * sm.Fluid));
  layers.mini.setAttribute("rx", f1(58 * (1 + 0.09 * breath * amp))); layers.mini.setAttribute("ry", f1(42 * (1 + 0.11 * breath * amp)));
  /* epithelium: gaps when damaged, type II growth in the proliferative phase */
  epi.forEach((e) => { const x = 480 + Math.cos(e.t) * arx, y = 225 + Math.sin(e.t) * ary; const dmg = sm.phase === 0 ? 0.62 : sm.phase === 1 ? (e.type2 ? 1.35 : 0.95) : 0.85; place(e.g, x, y, 0, dmg); e.g.style.opacity = sm.phase === 0 ? "0.75" : "1"; });
  endo.forEach((e) => place(e.g, e.x, e.y, 0, 1 - 0.22 * sm.Leak));
  surfDots.forEach((d, i) => { const t = (i / 14) * 6.283; d.setAttribute("cx", f1(480 + Math.cos(t) * (arx - 19))); d.setAttribute("cy", f1(225 + Math.sin(t) * (ary - 18))); d.setAttribute("opacity", (0.15 + 0.85 * sm.Surf).toFixed(2)); });
  colls.forEach((c) => c.setAttribute("opacity", (0.9 * sm.Fib).toFixed(2)));
  fibros.forEach((f) => { place(f.g, f.x, f.y, 0, 0.25 + 0.75 * sm.Fib); f.g.style.opacity = sm.Fib > 0.12 ? "1" : "0"; });
  /* neutrophils cross from capillary into the alveolus */
  const nn = Math.round(sm.Neut * neus.length);
  neus.forEach((n, i) => { const on = i < nn, f = on ? clamp((sm.Neut * neus.length - i)) : 0; const cx = lerp(n.x, n.tx, 0.5 + 0.5 * Math.sin(tm / 1400 + n.ph)), cy = lerp(n.y, n.ty, on ? 0.55 + 0.2 * Math.sin(tm / 900 + n.ph) : 0); place(n.g, clamp(cx, 350, 610), clamp(cy, 190, 345), Math.sin(tm / 400 + i) * 10, 0.4 + 0.6 * f); n.g.style.opacity = on ? "1" : "0"; });
  /* red cells: flow slows and colour stays dark when shunt is high */
  rbcs.forEach((r) => { r.x += r.v * 52 * (0.35 + 0.65 * sm.Ox) * dt; if (r.x > 634) { r.x = 326; r.y = rnd(-8, 8); } place(r.g, clamp(r.x, 326, 634), clamp(342 + r.y, 332, 352), 0, 1); r.g.style.opacity = "1"; });
  shuntRbcs.forEach((r, i) => { r.x += 34 * dt; if (r.x > 904) r.x = 724; r.e.setAttribute("cx", f1(clamp(r.x, 724, 904))); r.e.setAttribute("cy", f1(clamp(r.y, 294, 314))); r.e.setAttribute("opacity", (0.25 + 0.75 * sm.Sh).toFixed(2)); });
  /* protein leak: dots rise from the capillary into the alveolus */
  acc.prot += dt * sm.Leak * 11; while (acc.prot >= 1) { acc.prot--; const p = freeP(prots); if (p) emitP(p, rnd(370, 590), 322, rnd(-5, 5), -rnd(18, 30), 0); }
  prots.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 352, 608); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 195 || p.t > 4) killP(p); });
  /* air: enters down the airway, less when the lung is stiff, steadier with lung-protective ventilation */
  acc.air += dt * (2 + 7 * sm.Comp) * (sm.lpv ? 0.8 : 1); while (acc.air >= 1) { acc.air--; const p = freeP(airs); if (p) emitP(p, 480 + rnd(-5, 5), 76, rnd(-3, 3), rnd(30, 44), 0); }
  airs.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 300 + p.y) * 0.25, 360, 600); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 285 || p.t > 4) killP(p); });
  /* injury signals from the two injury nodes toward the barrier */
  acc.inj += dt * (0.6 + 3.4 * sm.Leak); while (acc.inj >= 1) { acc.inj--; const p = freeP(injs), top = Math.random() < 0.5; if (p) emitP(p, 143, top ? 145 : 285, rnd(26, 36), top ? rnd(6, 12) : rnd(0, 6), top ? 0 : 1); }
  injs.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 40, 330); p.y = clamp(p.y + p.vy * dt, 90, 320); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 325 || p.t > 6) killP(p); });
  /* gauges */
  gg.oed.set(sm.Fluid, wordOf(sm.Fluid, 0.35, 0.65, ["little", "some", "marked"])); gg.neut.set(sm.Neut, wordOf(sm.Neut, 0.3, 0.6, ["few", "some", "many"])); gg.shunt.set(sm.Sh, wordOf(sm.Sh, 0.3, 0.6, ["low", "raised", "high"]));
  gg.oxy.set(sm.Ox, wordOf(sm.Ox, 0.25, 0.55, ["very low", "low", "near normal"])); gg.stiff.set(sm.Stiff, wordOf(sm.Stiff, 0.45, 0.7, ["low", "raised", "high"])); gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.25, 0.6, ["low", "some", "marked"]));
}
run({ init, step });
