/* Sepsis scene: bacteria, macrophages, cytokines, the capillary wall, leak, microthrombi and the gauges. */
const CY = SC.CY, WW = SC.W;
const layers = { bac: $("bacteria"), rbc: $("rbcs"), clots: $("clots"), endo: $("endo"), parts: $("parts"), phag: $("phag"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema") };
let hh = 40;                                            // half height of the lumen
const WALL_N = 26;
/* ---- bacteria ---- */
const BAC_N = 42, bac = [];
function initBacteria() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6.5, ry: 3.4 } : { class: "cl-b", r: 4 }, g); mk("circle", { class: "cl-h", r: 1.4, cx: -1.4, cy: -1.2 }, g);
    bac.push({ g, x: rnd(40, 400), y: rnd(96, 228), a: rnd(0, 6.28), s: 0, on: false, rod, rot: rnd(0, 180) }); } }
/* ---- macrophages (with TLR receptors on the rim) ---- */
const macs = [[470, 150], [585, 215], [345, 238]].map(([x, y], i) => { const g = mk("g", {}, layers.phag), c = cell(g, { cls: "mac", r: 25, nuc: 0.42, seed: i * 2 + 1, wob: 0.13 }); const tl = [];
  for (let j = 0; j < 8; j++) { const t = (j / 8) * 6.28 + i, d = mk("g", { class: "tlr", transform: "translate(" + f1(Math.cos(t) * 27) + " " + f1(Math.sin(t) * 27) + ") rotate(" + f1(t * 57.3 + 90) + ")" }, g); mk("path", { class: "tlr-p", d: "M0 4L0 -1M-3 -5L0 -1L3 -5" }, d); tl.push(d); }
  return { g, x, y, tl, ph: i * 2.1 }; });
/* ---- endothelium: two rows of flat cells along the wall ---- */
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
/* ---- red cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 20; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- microthrombi on the wall ---- */
const clots = [[250, 1], [420, -1], [560, 1], [700, -1], [840, 1]].map(([x, side], i) => { const g = mk("g", {}, layers.clots), parts = [];
  for (let j = 0; j < 6; j++) parts.push(cell(g, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.3) * 9, y: Math.sin(j * 2.1) * 6 * -side, seed: j + i, wob: 0.15, n: 7 }));
  for (let j = 0; j < 6; j++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-16, 16)) + " " + f1(rnd(-10, 10)) + "L" + f1(rnd(-16, 16)) + " " + f1(rnd(-10, 10)) }, g);
  return { g, x, side, i }; });
/* ---- neutrophils ---- */
const neus = Array.from({ length: 5 }, (_, i) => ({ g: cell(layers.phag, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }), st: 0, x: -30, y: CY, t: 0, tx: 0, ty: 0, i }));
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const lps = pool(14, () => mk("path", { class: "sc-p p-lps", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts));
const cyt = pool(46, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const cyt2 = pool(30, () => mk("rect", { class: "sc-p p-cyt2", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const nos = pool(14, () => mk("circle", { class: "p-no", r: 3 }, layers.parts));
const drops = pool(34, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const pills = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const vol = pool(18, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, vasopressor chevrons, gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Infection", "g-bac", "Bacteria in the tissue. Antibiotics bring this down."], ["cyt", "Inflammation", "g-cyt", "Cytokines released by activated macrophages: TNF, IL-1, IL-6."], ["fl", "Leaky wall", "g-fl", "How much plasma escapes through the activated vessel wall into the tissue."], ["clot", "Clotting", "g-clot", "Activation of clotting inside small vessels (microthrombi), which can block flow."], ["bp", "Pressure", "g-good", "Blood pressure: the vessel relaxes (vasodilation) and plasma leaks out, so it falls. Fluids and a vasopressor raise it."], ["la", "Lactate", "g-bad", "Lactate rises when tissues are short of oxygen. High lactate means organs are not being perfused well."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bacteria", 120, 150, 120, 108, "Bacteria multiplying in the tissue. Parts of them (for example endotoxin from the cell wall) are danger signals.");
  pill(ox, "Macrophage", macs[0].x, macs[0].y - 26, macs[0].x + 30, 84, "Macrophage: a tissue sentinel. Receptors such as Toll-like receptor 4 on its surface detect bacterial parts, switch on NF-kB and make cytokines.");
  pill(ox, "Cytokines", 668, 300, 780, 130, "TNF, IL-1 and IL-6. They act on the vessel wall and on the brain, liver and bone marrow.");
  pill(ox, "Vessel wall", 820, CY - 56, 850, CY - 100, "Endothelium: the single-cell lining of the capillary. Cytokines make it release nitric oxide (relaxes the vessel), loosen its seals (leak) and turn on clotting.");
  pill(ox, "Nitric oxide", 250, CY - 36, 270, CY - 80, "Nitric oxide from the activated wall relaxes the muscle around the vessel and widens it. Pressure falls.");
  pill(ox, "Microthrombus", 560, CY + 42, 520, CY + 78, "Tiny clots of platelets and fibrin formed inside small vessels. They block flow and use up clotting factors.");
  pill(ox, "Neutrophil", 100, CY - 34, 80, CY - 84, "Neutrophils leave the vessel and move toward the infection.");
  const chev = mk("g", { id: "chev", opacity: "0" }, ox);
  [150, 340, 530, 720].forEach((x) => { mk("path", { class: "dr-bond", d: "M" + x + " " + (CY - 56) + "l6 8l6 -8", id: "ct" + x }, chev); mk("path", { class: "dr-bond", d: "M" + x + " " + (CY + 56) + "l6 -8l6 8", id: "cb" + x }, chev); });
  const cl = pill(ox, "Vasopressor", 540, CY - 56, 560, CY - 92, "A vasopressor tightens blood vessels and raises blood pressure."); cl.setAttribute("id", "vp-pill");
  const fl = pill(ox, "Fluids", 30, CY + 18, 60, CY + 78, "Intravenous fluids refill the vessel and restore circulating volume."); fl.setAttribute("id", "fl-pill");
}
const sm = { B: 0.5, C: 0.3, P: 0.2, Ve: 0.3, T: 0.1, BP: 0.7, La: 0.2, sup: 0, abx: 0 };
const acc = { lps: 0, cyt: 0, no: 0, drop: 0, pill: 0, vol: 0, neu: 0 };
function init() { initBacteria(); initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.B = lerp(sm.B, m.B, k2); sm.C = lerp(sm.C, m.C, k2); sm.P = lerp(sm.P, m.P, k2); sm.Ve = lerp(sm.Ve, m.Ve, k1); sm.T = lerp(sm.T, m.T, k2); sm.BP = lerp(sm.BP, m.BP, k1); sm.La = lerp(sm.La, m.La, k2); sm.sup = lerp(sm.sup, m.sup, k1); sm.abx = lerp(sm.abx, m.abx, k1);
  hh = 40 + 24 * sm.Ve + 3 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oed.setAttribute("height", f1(wallT - 44)); layers.oed.setAttribute("opacity", (sm.P * 0.55).toFixed(2));
  /* endothelium */
  const gapK = 1 - 0.26 * sm.P, wob = Math.sin(tm / 1400);
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + gapK.toFixed(3) + " " + (1 - 0.1 * sm.Ve).toFixed(3) + ")"); e.g.style.setProperty("--act", sm.C.toFixed(2)); }));
  /* bacteria */
  const want = Math.round(sm.B * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.4, 1.4) * dt; b.x += Math.cos(b.a) * 7 * dt; b.y += Math.sin(b.a) * 7 * dt; if (b.x < 40 || b.x > 400) b.a = Math.PI - b.a; if (b.y < 96 || b.y > 228) b.a = -b.a; b.x = clamp(b.x, 40, 400); b.y = clamp(b.y, 96, 228);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 18, b.s); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* LPS from bacteria toward the nearest macrophage */
  acc.lps += dt * sm.B * 5.5; while (acc.lps >= 1) { acc.lps--; const p = free(lps), b = bac[Math.floor(Math.random() * Math.max(1, want))]; if (p && b && b.s > 0.5) { const m0 = macs.reduce((q, r) => (Math.hypot(r.x - b.x, r.y - b.y) < Math.hypot(q.x - b.x, q.y - b.y) ? r : q)); emit(p, b.x, b.y, 0, 0, macs.indexOf(m0)); } }
  lps.forEach((p) => { if (!p.on) return; const mm = macs[p.k], dx = mm.x - p.x, dy = mm.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 48 * dt; p.y += (dy / d) * 48 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 5) + ")"); if (d < 26) kill(p); });
  /* macrophages: bob, glow, release cytokines toward the vessel */
  macs.forEach((mm, i) => { place(mm.g, mm.x + Math.sin(tm / 1500 + mm.ph) * 3, mm.y + Math.cos(tm / 1800 + mm.ph) * 2.5, Math.sin(tm / 2600 + mm.ph) * 6, 1 + 0.06 * sm.C * Math.sin(tm / 300 + i));
    mm.tl.forEach((t, j) => t.style.opacity = (0.35 + 0.65 * sm.C * (0.5 + 0.5 * Math.sin(tm / 260 + j))).toFixed(2)); });
  acc.cyt += dt * sm.C * 15; while (acc.cyt >= 1) { acc.cyt--; const mm = pick(macs), two = Math.random() < 0.4, p = free(two ? cyt2 : cyt); if (p) emit(p, mm.x + rnd(-14, 14), mm.y + rnd(-10, 10), rnd(-12, 12), rnd(26, 40), two ? 2 : 1); }
  [cyt, cyt2].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.x += p.vx * dt + Math.sin(tm / 400 + p.y) * 0.3; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > wallT - 8) kill(p); }));
  /* nitric oxide from the wall, widening the vessel */
  acc.no += dt * sm.Ve * 6; while (acc.no >= 1) { acc.no--; const p = free(nos); if (p) emit(p, rnd(40, WW - 40), wallT + 6, rnd(-4, 4), rnd(-10, -4), 0); }
  nos.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.8).toFixed(2) + ")"); p.e.setAttribute("opacity", (1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); });
  /* plasma leak: droplets through the top wall into the tissue */
  acc.drop += dt * sm.P * 9; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(60, WW - 60), CY - hh + 4, rnd(-4, 4), -rnd(14, 22), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y < wallT ? clamp(1 - (wallT - p.y) / 60).toFixed(2) : "1"); if (p.y < wallT - 70) kill(p); });
  /* red cells flow; clots slow them */
  const flow = clamp(0.25 + 0.85 * sm.BP) * (1 - 0.5 * sm.T);
  rbcs.forEach((r) => { r.x += r.v * 70 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  /* microthrombi grow with clotting */
  clots.forEach((c) => { const s = clamp((sm.T - 0.12 * c.i - 0.05) * 1.8); place(c.g, c.x, c.side > 0 ? wallT + 14 + 2 : wallB - 14, 0, 0.12 + 0.88 * s); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* neutrophils: roll, squeeze through the wall, crawl to the bacteria */
  const nn = Math.round(sm.C * neus.length);
  neus.forEach((n, i) => { const act = i < nn;
    if (n.st === 0) { if (act) { n.x = rnd(30, 200); n.y = CY - hh + 12; n.st = 1; } else { n.g.style.opacity = 0; place(n.g, -40, CY, 0, 0.1); } }
    else if (n.st === 1) { n.g.style.opacity = 1; n.x += 36 * dt; n.y = CY - hh + 12; place(n.g, n.x, n.y, 0, 1); if (n.x > 130 + i * 40) { n.st = 2; n.tx = n.x + rnd(40, 80); n.ty = rnd(120, 190); } }
    else if (n.st === 2) { n.y -= 34 * dt; const s = n.y > wallT - 6 ? 0.8 : 1; place(n.g, n.x, n.y, 0, s); if (n.y < wallT - 10) n.st = 3; }
    else if (n.st === 3) { n.x += (n.tx - n.x) * dt * 0.7; n.y += (n.ty - n.y) * dt * 0.7; place(n.g, n.x + Math.sin(tm / 300 + i) * 2, n.y, Math.sin(tm / 400 + i) * 12, 1); n.t += dt; if (n.t > 9 || !act) { n.t = 0; n.st = 4; } }
    else { n.g.style.opacity = clamp(parseFloat(n.g.style.opacity) - dt * 0.6); if (parseFloat(n.g.style.opacity) < 0.05) n.st = 0; } });
  /* antibiotic capsules cross into the tissue and clear bacteria */
  acc.pill += dt * sm.abx * 2.4; while (acc.pill >= 1) { acc.pill--; const p = free(pills); if (p) emit(p, rnd(30, 120), CY - 10, 0, 0, 0); }
  pills.forEach((p) => { if (!p.on) return; p.t += dt; const tx = 190, ty = 150; p.x += (tx - p.x) * dt * 0.5 + 16 * dt; p.y += (ty - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* fluids refilling the lumen */
  acc.vol += dt * sm.sup * 6; while (acc.vol >= 1) { acc.vol--; const p = free(vol); if (p) emit(p, -6, CY + rnd(-hh + 12, hh - 12), 90, 0, 0); }
  vol.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW + 6) kill(p); });
  /* supports: chevrons and pills fade in */
  const chev = $("chev"); if (chev) { chev.setAttribute("opacity", sm.sup.toFixed(2)); [150, 340, 530, 720].forEach((x) => { $("ct" + x).setAttribute("d", "M" + x + " " + f1(wallT - 14) + "l6 8l6 -8"); $("cb" + x).setAttribute("d", "M" + x + " " + f1(wallB + 14) + "l6 -8l6 8"); }); }
  $("vp-pill").style.opacity = sm.sup.toFixed(2); $("fl-pill").style.opacity = sm.sup.toFixed(2);
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.62, ["low", "present", "high"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["low", "raised", "high"])); gg.fl.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["tight", "leaky", "very leaky"]));
  gg.clot.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["none", "some", "many"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.4, 0.62, ["low", "borderline", "ok"])); gg.la.set(sm.La, wordOf(sm.La, 0.25, 0.5, ["normal", "raised", "high"]));
}
run({ init, step });
