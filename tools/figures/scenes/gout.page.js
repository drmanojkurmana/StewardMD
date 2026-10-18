/* Gout scene: purine breakdown, blood urate, kidney excretion, joint crystals, IL-1, neutrophils, tophi and gauges. */
const layers = { flowg: $("flowg"), nodes: $("nodes"), jointg: $("jointg"), crystals: $("crystals"), tophi: $("tophi"), cells: $("cells"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
function arrow(x1, y1, x2, y2, cls) { mk("path", { class: cls || "gt-arrow", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, layers.flowg); mk("path", { class: "gt-head", d: "M" + f1(x2) + " " + f1(y2) + "l-9 -4.5l0 9Z", transform: "rotate(" + f1(Math.atan2(y2 - y1, x2 - x1) * 57.3) + " " + f1(x2) + " " + f1(y2) + ")" }, layers.flowg); }
/* ---- static nodes and joint ---- */
let mac = null;
const cryPos = [[505, 330], [545, 355], [585, 332], [620, 358], [560, 342], [530, 362], [600, 342], [490, 355]];
let cryGroups = [], topGroups = [];
function initStatic() {
  arrow(132, 165, 200, 165); arrow(254, 165, 328, 165); arrow(592, 165, 692, 165); arrow(740, 218, 740, 250);
  mk("path", { class: "gt-arrow-d", d: "M460 205L460 262" }, layers.flowg); mk("path", { class: "gt-head", d: "M460 266l-5 -10l10 0Z" }, layers.flowg);
  cell(layers.nodes, { cls: "pur", r: 28, nuc: 0.35, seed: 3, wob: 0.12, x: 100, y: 165 });
  cell(layers.nodes, { cls: "xan", r: 22, nuc: 0.3, seed: 7, wob: 0.12, x: 230, y: 165 });
  const kg = mk("g", {}, layers.nodes); mk("ellipse", { class: "gt-kid", cx: 740, cy: 165, rx: 36, ry: 48 }, kg); mk("ellipse", { class: "gt-kid-in", cx: 752, cy: 165, rx: 14, ry: 30 }, kg);
  mk("rect", { class: "gt-bone", x: 250, y: 268, width: 670, height: 42, rx: 16 }, layers.jointg);
  mk("rect", { class: "gt-cav", x: 250, y: 310, width: 670, height: 70, rx: 10 }, layers.jointg);
  mk("rect", { class: "gt-bone", x: 250, y: 380, width: 670, height: 52, rx: 16 }, layers.jointg);
  mac = cell(layers.cells, { cls: "mac", r: 20, nuc: 0.42, seed: 11, wob: 0.13, x: 678, y: 345 });
  cryPos.forEach(([x, y], i) => { const g = mk("g", {}, layers.crystals); const a = (i * 37) % 140 - 70;
    mk("path", { class: "gt-cry", d: "M-13 0L13 0", transform: "rotate(" + a + ")" }, g); mk("path", { class: "gt-cry2", d: "M-9 0L9 0", transform: "rotate(" + (a + 55) + ")" }, g); cryGroups.push({ g, x, y }); });
  [[868, 292], [868, 398]].forEach(([x, y]) => { const g = mk("g", {}, layers.tophi); [[-14, 2, 13], [4, -4, 16], [18, 4, 11]].forEach(([u, v, r]) => mk("circle", { class: "gt-top", cx: u, cy: v, r }, g)); topGroups.push({ g, x, y }); });
  const xo = mk("g", { id: "xomark", opacity: "0" }, layers.marks); mk("circle", { class: "gt-x", cx: 166, cy: 165, r: 11 }, xo); mk("path", { class: "gt-xp", d: "M159 158L173 172M173 158L159 172" }, xo);
  const at = mk("g", { id: "atkmark", opacity: "0" }, layers.marks); mk("circle", { class: "gt-x", cx: 678, cy: 318, r: 10 }, at); mk("path", { class: "gt-xp", d: "M672 312L684 324M684 312L672 324" }, at);
  const ur = mk("g", { id: "urimark", opacity: "0" }, layers.marks); [228, 240].forEach((y) => mk("path", { class: "gt-xp", d: "M732 " + y + "l8 8l8 -8", style: "stroke:var(--c-good)" }, ur));
}
/* ---- neutrophils ---- */
const neus = Array.from({ length: 5 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 30, wob: 0.14 }), x: -40, y: 345, tx: 500 + i * 22, ty: 332 + (i % 3) * 13, ph: i * 1.7 }));
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const prod = pool(16, () => mk("path", { class: "sc-p p-ur", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const il1 = pool(30, () => mk("circle", { class: "sc-p p-il1", r: 2.5 }, layers.parts));
const exc = pool(16, () => mk("path", { class: "sc-p p-exc", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const urDots = pool(18, () => mk("path", { class: "sc-p p-ur", d: "M0 -3L2.6 0L0 3L-2.6 0Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [150, 320, 490, 660, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ur", "Urate", "g-ur", "Uric acid carried in the blood. It rises with overproduction or kidney underexcretion, and falls when production is blocked or excretion is increased."], ["cry", "Crystals", "g-cry", "Monosodium urate crystals deposited in and around the joint. They dissolve slowly when urate stays low."], ["inf", "Inflammation", "g-cyt", "Joint inflammation driven by IL-1 and neutrophils. An NSAID or colchicine calms this without lowering urate."], ["top", "Tophi", "g-top", "Tophi: firm deposits of crystals and tissue that build up over years in chronic tophaceous gout."], ["pain", "Joint pain", "g-bad", "Pain of the attack, following the inflammation. It settles as inflammation is treated, even before crystals have gone."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Purines", 100, 136, 80, 102, "Purines come from the diet and from normal cell turnover. Their breakdown is one source of uric acid. Making too much uric acid is overproduction.");
  pill(ox, "Xanthine oxidase", 166, 182, 220, 238, "Xanthine oxidase is the enzyme that makes uric acid in the final steps of purine breakdown. Blocking it lowers urate production.");
  pill(ox, "Uric acid", 460, 130, 460, 102, "Uric acid (urate) carried in the blood. Humans lack uricase, so this is the end product of purine breakdown. When it stays high, crystals can form.");
  pill(ox, "Kidney", 740, 120, 740, 102, "The kidney filters urate and normally reabsorbs and secretes it in balance. Excreting too little is underexcretion, the commonest reason urate stays high.");
  pill(ox, "Underexcretion", 774, 202, 862, 185, "Underexcretion: the kidney clears less urate than it should, so blood urate rises. A uricosuric increases this excretion.");
  pill(ox, "Neutrophils", 425, 330, 340, 250, "Neutrophils are recruited into the joint by IL-1. They try to ingest crystals and release inflammatory contents, driving the acute attack.");
  pill(ox, "Urate crystals", 560, 326, 560, 250, "Monosodium urate crystals: needle-like deposits that form in and around a joint when urate stays high. They trigger the attack and build into tophi over years.");
  pill(ox, "IL-1", 664, 322, 700, 250, "Interleukin-1 (IL-1), released by macrophages that sense crystals through the inflammasome. It recruits neutrophils and causes pain, heat and swelling.");
  pill(ox, "Tophus", 864, 294, 845, 250, "A tophus is a firm lump of urate crystals with surrounding tissue, seen in chronic tophaceous gout. Tophi shrink slowly when urate stays low.");
}
const sm = { U: 0.6, C: 0.3, I: 0.3, T: 0, P: 0.3, atk: 0, xoi: 0, uri: 0 };
const acc = { prod: 0, il1: 0, exc: 0 };
function init() { initStatic(); initPanel(); urDots.forEach((p, i) => { p.x = rnd(355, 565); p.y = rnd(140, 190); p.ph = i * 0.7; }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.U = lerp(sm.U, m.U, k2); sm.C = lerp(sm.C, m.C, k2); sm.I = lerp(sm.I, m.I, k2); sm.T = lerp(sm.T, m.T, k2); sm.P = lerp(sm.P, m.P, k1); sm.atk = lerp(sm.atk, m.atk, k1); sm.xoi = lerp(sm.xoi, m.xoi, k1); sm.uri = lerp(sm.uri, m.uri, k1);
  /* production particles along the top chain */
  acc.prod += dt * (3 + 5 * sm.U) * (1 - 0.45 * sm.xoi); while (acc.prod >= 1) { acc.prod--; const p = freeP(prod); if (p) emit(p, 104, 165 + rnd(-7, 7), rnd(52, 68), 0); }
  prod.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y = 165 + Math.sin(tm / 500 + p.x / 30) * 7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 578) killP(p); });
  /* urate dots inside the blood pool */
  const wantU = Math.round(sm.U * urDots.length);
  urDots.forEach((p, i) => { const on = i < wantU; p.e.setAttribute("opacity", on ? "0.95" : "0"); if (on) p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 700 + p.ph) * 4) + " " + f1(p.y + Math.cos(tm / 600 + p.ph) * 3) + ") rotate(" + f1(tm / 8 + i * 20) + ")"); });
  /* excretion: pool to kidney, then down */
  acc.exc += dt * (2.2 + 6 * sm.uri); while (acc.exc >= 1) { acc.exc--; const p = freeP(exc); if (p) emit(p, 596, 165 + rnd(-8, 8), rnd(45, 60), 0); }
  exc.forEach((p) => { if (!p.on) return; if (p.x < 736) { p.x += p.vx * dt; } else { p.x = 740; p.y += 55 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 252) killP(p); });
  /* crystals grow or shrink */
  cryGroups.forEach((c, i) => { const s = clamp((sm.C - i * 0.07) * 1.5); place(c.g, c.x, c.y, Math.sin(tm / 900 + i) * 4, Math.max(0.06, s)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* tophi */
  topGroups.forEach((c) => { const s = clamp(sm.T * 1.15); place(c.g, c.x, c.y, 0, Math.max(0.05, s)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* macrophage glow with inflammation */
  place(mac, 678 + Math.sin(tm / 1500) * 2, 345 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1 + 0.07 * sm.I * Math.sin(tm / 300));
  /* IL-1 from macrophage toward the crystals */
  acc.il1 += dt * sm.I * 13; while (acc.il1 >= 1) { acc.il1--; const p = freeP(il1); if (p) emit(p, 662, 338 + rnd(-8, 8), rnd(-46, -26), rnd(-8, 10)); }
  il1.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6 || p.x < 470) killP(p); });
  /* neutrophils enter from the left of the cavity and gather at the crystals */
  const nn = Math.round(sm.I * neus.length);
  neus.forEach((n, i) => { const act = i < nn; if (!act) { n.g.style.opacity = 0; place(n.g, -40, 345, 0, 0.1); n.x = -40; return; } n.g.style.opacity = 1; if (n.x < 0) { n.x = 262; n.y = 338 + (i % 3) * 8; } n.x += (n.tx - n.x) * dt * 0.35; n.y += (n.ty - n.y) * dt * 0.35; if (Math.hypot(n.tx - n.x, n.ty - n.y) < 8) { n.tx = 495 + Math.random() * 120; n.ty = 328 + Math.random() * 34; } place(n.g, n.x + Math.sin(tm / 320 + n.ph) * 1.6, n.y, Math.sin(tm / 420 + n.ph) * 10, 1); });
  /* treatment marks */
  $("xomark").setAttribute("opacity", sm.xoi.toFixed(2)); $("atkmark").setAttribute("opacity", sm.atk.toFixed(2)); $("urimark").setAttribute("opacity", sm.uri.toFixed(2));
  /* gauges */
  gg.ur.set(sm.U, wordOf(sm.U, 0.35, 0.65, ["low", "raised", "high"])); gg.cry.set(sm.C, wordOf(sm.C, 0.25, 0.6, ["few", "some", "many"])); gg.inf.set(sm.I, wordOf(sm.I, 0.25, 0.6, ["calm", "active", "severe"])); gg.top.set(sm.T, wordOf(sm.T, 0.25, 0.6, ["none", "forming", "established"])); gg.pain.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["none", "aching", "severe"]));
}
run({ init, step });
