/* COVID-19 scene: ACE2 entry, TMPRSS2 priming, replication, innate response, cytokine storm, alveolar damage, endothelitis and hypoxia. */
const layers = { epi: $("epiG"), endo: $("endoG"), ace: $("aceG"), cells: $("cellsG"), rbcs: $("rbcsG"), clots: $("clotsG"), parts: $("parts"), over: $("over"), panel: $("panel"), fluid: $("fluidEl"), hyal: $("hyal"), air: $("alvAir"), outer: $("alvOuter"), mini: $("miniLung"), cap: $("capLumen") };
/* ---- alveolar epithelial cells and ACE2 receptors ---- */
const epi = [];
function initEpi() { for (let i = 0; i < 16; i++) { const t = (i / 16) * 6.283, g = cell(layers.epi, { cls: "epi", r: 8, nuc: 0.35, seed: i + 3, wob: 0.1 }); const ace = mk("path", { class: "cov-ace", d: "M0 0L0 -6M0 -6L-3 -9M0 -6L3 -9" }, layers.ace); epi.push({ g, ace, t }); } }
/* ---- capillary endothelium ---- */
const endo = [];
function initEndo() { for (let i = 0; i < 12; i++) { const x = 338 + i * 24; [350, 382].forEach((y, r) => { const g = cell(layers.endo, { cls: "endo", r: 7, nuc: 0.3, seed: i + r * 20, wob: 0.08, n: 8 }); endo.push({ g, x, y }); }); } }
/* ---- macrophages and neutrophils ---- */
const macs = [[540, 262], [415, 275]].map(([x, y], i) => { const g = cell(layers.cells, { cls: "mac", r: 19, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }); return { g, x, y, ph: i * 2.2 }; });
const neus = Array.from({ length: 4 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 40, wob: 0.14 }), x: 350 + i * 55, y: 366, tx: 400 + i * 42, ty: 252 + (i % 3) * 20, ph: i * 1.4 }));
/* ---- red cells ---- */
const rbcs = Array.from({ length: 12 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); return { g, x: 326 + i * 25, y: rnd(-7, 7), v: rnd(0.8, 1.2) }; });
const vesselRbcs = Array.from({ length: 5 }, (_, i) => { const e = mk("ellipse", { class: "cl cl-rbc", rx: 7, ry: 4.2, fill: "#8a2f3a", stroke: "#5e1f28", "stroke-width": 0.7 }, layers.rbcs); return { e, x: 712 + i * 40, y: 257 + rnd(-5, 5) }; });
/* ---- microthrombi ---- */
const clots = [[385, 356], [500, 376], [580, 356], [762, 248], [852, 266]].map(([x, y], i) => { const g = mk("g", {}, layers.clots); for (let j = 0; j < 5; j++) cell(g, { cls: "plt", r: 4 + (j % 3), x: Math.cos(j * 1.4) * 8, y: Math.sin(j * 2) * 5, seed: j + i * 3, wob: 0.15, n: 7 }); for (let j = 0; j < 4; j++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-13, 13)) + " " + f1(rnd(-8, 8)) + "L" + f1(rnd(-13, 13)) + " " + f1(rnd(-8, 8)) }, g); return { g, x, y }; });
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const virs = pool(20, () => { const g = mk("g", { class: "cl cl-vir" }, layers.parts); mk("circle", { class: "cl-b", r: 5 }, g); mk("path", { class: "cl-b", d: "M0 -8v3M0 5v3M-8 0h3M5 0h3M-6 -6l2 2M4 -4l2 -2M-6 6l2 -2M4 4l2 2" }, g); return g; });
const cyt = pool(36, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const cyt2 = pool(20, () => mk("rect", { class: "sc-p p-cyt2", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const oxys = pool(18, () => mk("circle", { class: "sc-p p-oxy", r: 2.8 }, layers.parts));
const drops = pool(24, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const caps = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const dexs = pool(10, () => mk("rect", { class: "sc-p p-dex", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1.2 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The illness";
  [["vir", "Virus", "g-vir", "SARS-CoV-2 in airway and alveolar cells. An antiviral given early brings this down."], ["inn", "Innate", "g-inn", "Innate response: macrophages and neutrophils sensing the virus and releasing signals."], ["cyt", "Cytokines", "g-cyt", "Cytokines such as interleukins and TNF. In severe disease this becomes a cytokine storm."], ["dad", "Damage", "g-dad", "Diffuse alveolar damage: injured alveolar walls, hyaline membranes and flooded air spaces."], ["clot", "Clotting", "g-clot", "Endothelitis: injured vessel lining turns on clotting and forms microthrombi in small vessels."], ["oxy", "Oxygen", "g-oxy2", "Oxygen in the blood. It falls when alveoli are flooded and damaged, giving hypoxia."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "SARS-CoV-2", 95, 118, 95, 82, "SARS-CoV-2: a betacoronavirus spread in respiratory secretions. Its spike protein is the key that binds ACE2.");
  pill(ox, "Airway cell", 95, 238, 95, 210, "Airway cell: a respiratory tract cell carrying ACE2 on its surface. The virus infects airway and alveolar cells.");
  pill(ox, "ACE2 binding", 360, 178, 230, 92, "ACE2 binding: spike on the virus binds ACE2 on airway and alveolar cells. This is the entry step.");
  pill(ox, "TMPRSS2", 410, 146, 320, 92, "TMPRSS2: a cell surface protease that primes spike after ACE2 binding, helping the virus enter the cell.");
  pill(ox, "Replication", 470, 205, 500, 92, "Viral replication: inside the cell the virus makes copies of itself, which leave to infect more cells.");
  pill(ox, "Innate response", 540, 244, 680, 92, "Innate response: macrophages and neutrophils detect the virus, take it up and release cytokine signals.");
  pill(ox, "Cytokine storm", 768, 170, 830, 210, "Cytokine storm: in severe disease cytokine release becomes excessive, driving alveolar and vessel injury.");
  pill(ox, "Alveolar damage", 390, 302, 300, 400, "Diffuse alveolar damage: the alveolar wall is injured, hyaline membranes form and fluid floods the air space.");
  pill(ox, "Endothelitis clot", 560, 358, 520, 400, "Endothelitis and microthrombi: inflamed vessel lining activates clotting, forming tiny clots that block small vessels.");
  pill(ox, "Neutrophil", 488, 282, 660, 400, "Neutrophil: a white cell drawn into the infected alveolus. It helps defence but adds to tissue damage.");
  pill(ox, "Hypoxia", 810, 326, 760, 400, "Hypoxia: oxygen in the blood falls when damaged, flooded alveoli cannot pass oxygen to the capillary.");
}
const sm = { V: 0.6, I: 0.5, C: 0.4, D: 0.3, T: 0.2, Ox: 0.5, oxy: 0, dex: 0, ant: 0 };
const acc = { vir: 0, cyt: 0, oxy: 0, drop: 0, cap: 0, dex: 0 };
function init() { initEpi(); initEndo(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  ["V", "I", "C", "D", "T", "Ox"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.dex = lerp(sm.dex, m.dex, k1); sm.ant = lerp(sm.ant, m.ant, k1);
  const breath = 0.5 - 0.5 * Math.cos(tm * 0.0016), amp = 0.3 + 0.7 * sm.Ox;
  const arx = 138 * (1 + 0.04 * breath * amp), ary = 90 * (1 + 0.05 * breath * amp);
  layers.outer.setAttribute("rx", f1(arx + 20)); layers.outer.setAttribute("ry", f1(ary + 18));
  layers.air.setAttribute("rx", f1(arx)); layers.air.setAttribute("ry", f1(ary));
  layers.hyal.setAttribute("rx", f1(arx - 9)); layers.hyal.setAttribute("ry", f1(ary - 8)); layers.hyal.setAttribute("opacity", (0.85 * sm.D).toFixed(2));
  layers.fluid.setAttribute("opacity", (0.6 * sm.D).toFixed(2)); layers.fluid.setAttribute("ry", f1(12 + 24 * sm.D)); layers.fluid.setAttribute("cy", f1(298 - 16 * sm.D));
  layers.mini.setAttribute("rx", f1(56 * (1 + 0.08 * breath * amp))); layers.mini.setAttribute("ry", f1(38 * (1 + 0.1 * breath * amp)));
  /* epithelium and ACE2: gaps grow with alveolar damage */
  epi.forEach((e) => { const x = 470 + Math.cos(e.t) * arx, y = 230 + Math.sin(e.t) * ary; place(e.g, clamp(x, 30, 930), clamp(y, 55, 430), 0, 1 - 0.35 * sm.D); e.g.style.opacity = "1"; place(e.ace, clamp(x + Math.cos(e.t) * 9, 30, 930), clamp(y + Math.sin(e.t) * 9, 55, 430), e.t * 57.3 + 90, 1); e.ace.style.opacity = (1 - 0.4 * sm.D).toFixed(2); });
  endo.forEach((e) => place(e.g, e.x, e.y, 0, 1 - 0.2 * sm.T));
  macs.forEach((mm, i) => place(mm.g, clamp(mm.x + Math.sin(tm / 1500 + mm.ph) * 3, 340, 600), clamp(mm.y + Math.cos(tm / 1700 + mm.ph) * 2, 150, 320), Math.sin(tm / 2500 + mm.ph) * 6, 1 + 0.05 * sm.C * Math.sin(tm / 300 + i)));
  const nn = Math.round(sm.I * neus.length);
  neus.forEach((n, i) => { const on = i < nn, f = on ? clamp(sm.I * neus.length - i) : 0; const cx = lerp(n.x, n.tx, 0.55 + 0.2 * Math.sin(tm / 1300 + n.ph)), cy = lerp(n.y, n.ty, on ? 0.6 : 0); place(n.g, clamp(cx, 330, 610), clamp(cy, 180, 378), Math.sin(tm / 400 + i) * 10, 0.4 + 0.6 * f); n.g.style.opacity = on ? "1" : "0"; });
  rbcs.forEach((r) => { r.x += r.v * 52 * (0.35 + 0.65 * sm.Ox) * dt; if (r.x > 624) { r.x = 324; r.y = rnd(-7, 7); } place(r.g, clamp(r.x, 324, 624), clamp(366 + r.y, 354, 378), 0, 1); });
  vesselRbcs.forEach((r) => { r.x += 30 * dt; if (r.x > 924) r.x = 706; r.e.setAttribute("cx", f1(clamp(r.x, 706, 924))); r.e.setAttribute("cy", f1(clamp(r.y, 248, 266))); r.e.setAttribute("opacity", (0.3 + 0.7 * sm.T).toFixed(2)); });
  clots.forEach((c, i) => { const s = clamp((sm.T - 0.08 * i) * 1.7); place(c.g, clamp(c.x, 30, 930), clamp(c.y, 55, 430), 0, 0.15 + 0.85 * s); c.g.style.opacity = s > 0.05 ? "1" : "0"; });
  /* viruses: appear at the alveolar wall and wander inside */
  acc.vir += dt * sm.V * 7; while (acc.vir >= 1) { acc.vir--; const p = freeP(virs); if (p) { const t = rnd(0, 6.28); emitP(p, clamp(470 + Math.cos(t) * 120, 340, 600), clamp(230 + Math.sin(t) * 72, 150, 310), rnd(-14, 14), rnd(-10, 10), t); } }
  virs.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 350 + p.k) * 0.4, 332, 608); p.y = clamp(p.y + p.vy * dt + Math.cos(tm / 420 + p.k) * 0.3, 142, 318); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (p.t > 5) killP(p); });
  /* cytokines: from macrophages toward capillary and the systemic vessel */
  acc.cyt += dt * sm.C * 14; while (acc.cyt >= 1) { acc.cyt--; const mm = pick(macs), two = Math.random() < 0.4, p = freeP(two ? cyt2 : cyt); if (p) emitP(p, mm.x + rnd(-12, 12), mm.y + rnd(-8, 8), rnd(18, 38), rnd(10, 24), two ? 2 : 1); }
  [cyt, cyt2].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 330, 800); p.y = clamp(p.y + p.vy * dt, 130, 372); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) killP(p); }));
  /* oxygen: down the airway into the alveolus, more with supportive oxygen */
  acc.oxy += dt * (2.5 + 5 * sm.Ox + 7 * sm.oxy); while (acc.oxy >= 1) { acc.oxy--; const p = freeP(oxys); if (p) emitP(p, 381 + rnd(-4, 4), 72, rnd(-3, 3), rnd(30, 42), 0); }
  oxys.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + Math.sin(tm / 300 + p.y) * 0.25, 350, 590); p.y = clamp(p.y + p.vy * dt, 60, 300); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 292 || p.t > 4) killP(p); });
  /* alveolar fluid: leak dots rise from capillary into the alveolus */
  acc.drop += dt * sm.D * 10; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) emitP(p, rnd(360, 580), 348, rnd(-4, 4), -rnd(16, 26), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 340, 600); p.y = clamp(p.y + p.vy * dt, 190, 352); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 200 || p.t > 4) killP(p); });
  /* antiviral capsules move to the alveolus and limit replication */
  acc.cap += dt * sm.ant * 3; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emitP(p, rnd(40, 110), 150, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + (470 - p.x) * dt * 0.5 + 18 * dt, 30, 610); p.y = clamp(p.y + (225 - p.y) * dt * 0.6, 60, 330); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) killP(p); });
  /* dexamethasone markers move to macrophages and calm cytokines */
  acc.dex += dt * sm.dex * 3; while (acc.dex >= 1) { acc.dex--; const p = freeP(dexs); if (p) emitP(p, rnd(40, 110), 270, 0, 0, 0); }
  dexs.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + (540 - p.x) * dt * 0.5 + 18 * dt, 30, 620); p.y = clamp(p.y + (262 - p.y) * dt * 0.6, 60, 340); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) killP(p); });
  /* gauges */
  gg.vir.set(sm.V, wordOf(sm.V, 0.35, 0.7, ["low", "present", "high"])); gg.inn.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "raised", "high"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.62, ["low", "raised", "storm"]));
  gg.dad.set(sm.D, wordOf(sm.D, 0.3, 0.6, ["little", "some", "marked"])); gg.clot.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["none", "some", "many"])); gg.oxy.set(sm.Ox, wordOf(sm.Ox, 0.3, 0.6, ["very low", "low", "near normal"]));
}
run({ init, step });
