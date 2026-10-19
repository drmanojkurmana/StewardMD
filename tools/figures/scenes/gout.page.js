/* Gout scene: purines to uric acid, kidney clearance, joint crystals, immune attack, tophi and gauges. */
const layers = { flowg: $("flowg"), kidneySlot: $("kidneySlot"), nodes: $("nodes"), jointg: $("jointg"), glow: $("jointGlow"), crystals: $("crystals"), tophi: $("tophi"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
function arrow(x1, y1, x2, y2, cls) { mk("path", { class: cls || "gt-arrow", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, layers.flowg); mk("path", { class: "gt-head", d: "M" + f1(x2) + " " + f1(y2) + "l-9 -4.5l0 9Z", transform: "rotate(" + f1(Math.atan2(y2 - y1, x2 - x1) * 57.3) + " " + f1(x2) + " " + f1(y2) + ")" }, layers.flowg); }
/* ---- organs, tracks and treatment actors ---- */
let kidneyO = null, trBlood = null, trUrine = null;
let mac = null, xoNode = null, xoBadge = null, xoArrow = null, shieldG = null, urineEl = null, flushEl = null, levelRect = null;
let capEl1 = null, capEl2 = null, capKey = "";
const cryPos = [[500, 332], [545, 356], [590, 332], [625, 358], [562, 343], [528, 363], [605, 343], [488, 356]];
const cryGroups = [], topGroups = [];
function initOrgans() {
  kidneyO = organ($("kidneySlot"), "kidney", 748, 168, 116, {});
  const P = kidneyO.ports;
  trBlood = track([[585, 165], [640, 160], P.in]);
  trUrine = track([P.out, [P.out[0], 272]]);
}
function capText(d, l) {
  if (d === 1) return ["Attack care calms swelling.", l === 2 ? "Lumps stay for now." : l === 1 ? "Crystals stay for now." : "Urate stays high."];
  if (d === 2) return ["Kidney care passes more urate.", l === 2 ? "Lumps shrink slowly." : l === 1 ? "Swelling eases as crystals melt." : "Blood urate falls."];
  if (d === 3) return ["This drug blocks urate making.", l === 2 ? "Crystals melt. Lumps shrink." : l === 1 ? "Old crystals ache for a while." : "Blood urate falls."];
  return ["No treatment.", l === 2 ? "Urate stays high. Lumps keep growing." : l === 1 ? "Crystals set off swelling and pain." : "Urate is high. The joint stays calm."];
}
/* ---- static nodes and joint ---- */
function initStatic() {
  const P = kidneyO.ports;
  arrow(132, 165, 200, 165);
  xoArrow = mk("path", { class: "gt-arrow", d: "M254 165L328 165" }, layers.flowg);
  mk("path", { class: "gt-head", d: "M328 165l-9 -4.5l0 9Z" }, layers.flowg);
  mk("path", { class: "gt-ves", d: "M585 165 C625 165 655 158 " + f1(P.in[0]) + " " + f1(P.in[1]) }, layers.flowg);
  urineEl = mk("path", { class: "gt-urine", d: "M" + f1(P.out[0]) + " " + f1(P.out[1]) + "L" + f1(P.out[0]) + " 272" }, layers.flowg);
  flushEl = mk("g", { opacity: "0" }, layers.flowg);
  [248, 260].forEach((y) => mk("path", { class: "gt-flush", d: "M" + f1(P.out[0] - 8) + " " + y + "l8 8l8 -8" }, flushEl));
  mk("path", { class: "gt-arrow-d", d: "M460 205L460 262" }, layers.flowg); mk("path", { class: "gt-head", d: "M460 266l-5 -10l10 0Z" }, layers.flowg);
  cell(layers.nodes, { cls: "pur", r: 28, nuc: 0.35, seed: 3, wob: 0.12, x: 100, y: 165 });
  xoNode = cell(layers.nodes, { cls: "xan", r: 22, nuc: 0.3, seed: 7, wob: 0.12, x: 230, y: 165 });
  const defs = mk("defs", {}, svg);
  const cp = mk("clipPath", { id: "poolClip" }, defs);
  mk("rect", { x: 335, y: 128, width: 250, height: 74, rx: 37 }, cp);
  levelRect = mk("rect", { class: "gt-level", x: 335, y: 128, width: 250, height: 74, "clip-path": "url(#poolClip)" }, layers.nodes);
  mk("rect", { class: "gt-bone", x: 250, y: 268, width: 670, height: 42, rx: 16 }, layers.jointg);
  mk("rect", { class: "gt-cav", x: 250, y: 310, width: 670, height: 70, rx: 10 }, layers.jointg);
  mk("rect", { class: "gt-bone", x: 250, y: 380, width: 670, height: 52, rx: 16 }, layers.jointg);
  mac = cell(layers.cells, { cls: "mac", r: 20, nuc: 0.42, seed: 11, wob: 0.13, x: 678, y: 345 });
  cryPos.forEach(([x, y], i) => { const g = mk("g", {}, layers.crystals); const a = (i * 37) % 140 - 70;
    mk("path", { class: "gt-cry", d: "M-20 0L20 0", transform: "rotate(" + a + ")" }, g); mk("path", { class: "gt-cry2", d: "M-13 0L13 0", transform: "rotate(" + (a + 55) + ")" }, g); cryGroups.push({ g, x, y }); });
  [[868, 292], [868, 398]].forEach(([x, y]) => { const g = mk("g", {}, layers.tophi); [[-14, 2, 13], [4, -4, 16], [18, 4, 11]].forEach(([u, v, r]) => mk("circle", { class: "gt-top", cx: u, cy: v, r }, g)); topGroups.push({ g, x, y }); });
  xoBadge = mk("g", { opacity: "0" }, layers.cells);
  mk("rect", { class: "gt-drug", x: -17, y: -10, width: 34, height: 20, rx: 10 }, xoBadge);
  mk("rect", { class: "gt-drug", x: -3.5, y: 10, width: 7, height: 14 }, xoBadge);
  place(xoBadge, 230, 138, 0, 1);
  shieldG = mk("g", { opacity: "0" }, layers.cells);
  mk("circle", { class: "gt-shield", r: 27 }, shieldG);
  mk("circle", { class: "gt-drug", r: 11 }, shieldG);
  place(shieldG, 678, 345, 0, 1);
}
/* ---- neutrophils ---- */
const neus = Array.from({ length: 5 }, (_, i) => ({ g: cell(layers.cells, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 30, wob: 0.14 }), x: -40, y: 345, tx: 500 + i * 22, ty: 332 + (i % 3) * 13, ph: i * 1.7 }));
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0 }; }); }
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
  [["ur", "Urate", "g-ur", "Uric acid carried in the blood. It rises with overproduction or kidney underexcretion, and falls when production is blocked or excretion is increased."], ["cry", "Crystals", "g-cry", "Monosodium urate crystals deposited in and around the joint. They dissolve slowly when urate stays low."], ["inf", "Inflammation", "g-cyt", "Joint inflammation driven by attack signals and neutrophils. Attack care calms this without lowering urate."], ["top", "Tophi", "g-top", "Tophi: firm deposits of crystals and tissue that build up over years in chronic tophaceous gout."], ["pain", "Joint pain", "g-bad", "Pain of the attack, following the inflammation. It settles as inflammation is treated, even before crystals have gone."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Purines", 100, 165, 80, 102, "Purines from food and old cells. Breaking them down makes uric acid.");
  pill(ox, "XO enzyme", 230, 165, 230, 240, "This enzyme builds uric acid. Blocking it lowers urate.");
  pill(ox, "Urate in blood", 460, 140, 460, 102, "Urate carried in the blood. High levels let crystals form in the joint.");
  pill(ox, "Kidney", 775, 140, 768, 66, "The kidney passes urate out. Weak clearance lets urate build up.");
  pill(ox, "Joint", 300, 345, 300, 250, "The joint space where crystals settle and swelling starts.");
  pill(ox, "Crystals", 560, 345, 560, 250, "Sharp urate crystals. They trigger attacks and melt slowly when urate stays low.");
  pill(ox, "Immune attack", 678, 345, 705, 250, "Defense cells sense crystals and attack them. This causes heat, swelling and pain.");
  pill(ox, "Tophi", 868, 292, 860, 250, "Firm lumps of crystals that grow over years. They shrink slowly when urate stays low.");
  capEl1 = mk("text", { class: "gt-cap", x: 30, y: 398 }, ox); capEl2 = mk("text", { class: "gt-cap", x: 30, y: 414 }, ox);
  const c = capText(0, 1); capEl1.textContent = c[0]; capEl2.textContent = c[1];
}
const sm = { U: 0.6, C: 0.3, I: 0.3, T: 0, P: 0.3, atk: 0, xoi: 0, uri: 0 };
const acc = { prod: 0, il1: 0, exc: 0 };
function init() { initOrgans(); initStatic(); initPanel(); urDots.forEach((p, i) => { p.x = rnd(355, 565); p.y = rnd(140, 190); p.ph = i * 0.7; }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.U = lerp(sm.U, m.U, k2); sm.C = lerp(sm.C, m.C, k2); sm.I = lerp(sm.I, m.I, k2); sm.T = lerp(sm.T, m.T, k2); sm.P = lerp(sm.P, m.P, k1); sm.atk = lerp(sm.atk, m.atk, k1); sm.xoi = lerp(sm.xoi, m.xoi, k1); sm.uri = lerp(sm.uri, m.uri, k1);
  /* blood urate level inside the pool drains as urate falls */
  levelRect.setAttribute("y", f1(128 + 74 * (1 - sm.U))); levelRect.setAttribute("height", f1(Math.max(2, 74 * sm.U)));
  /* production particles along the top chain, throttled when the enzyme is blocked */
  acc.prod += dt * (3 + 5 * sm.U) * (1 - 0.6 * sm.xoi); while (acc.prod >= 1) { acc.prod--; const p = freeP(prod); if (p) emit(p, 104, 165 + rnd(-7, 7), rnd(52, 68), 0); }
  prod.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y = 165 + Math.sin(tm / 500 + p.x / 30) * 7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 578) killP(p); });
  xoArrow.setAttribute("opacity", f1(1 - 0.55 * sm.xoi)); xoNode.style.opacity = f1(1 - 0.3 * sm.xoi);
  xoBadge.setAttribute("opacity", sm.xoi.toFixed(2));
  place(xoBadge, 230, 138 + Math.sin(tm / 600) * 2, 0, 0.4 + 0.6 * sm.xoi);
  /* urate dots inside the blood pool */
  const wantU = Math.round(sm.U * urDots.length);
  urDots.forEach((p, i) => { const on = i < wantU; p.e.setAttribute("opacity", on ? "0.95" : "0"); if (on) p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 700 + p.ph) * 4) + " " + f1(p.y + Math.cos(tm / 600 + p.ph) * 3) + ") rotate(" + f1(tm / 8 + i * 20) + ")"); });
  /* excretion: blood leg into the kidney, then urine leg out below; the vessel widens with a uricosuric */
  acc.exc += dt * (2.2 + 6 * sm.uri); while (acc.exc >= 1) { acc.exc--; const p = freeP(exc); if (p) { emit(p, 585, 165, 0, 0); p.st = 0; p.u = 0; } }
  exc.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.u += dt * 95 / trBlood.len; const q = trBlood.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) { p.st = 1; p.u = 0; } }
    else { p.u += dt * 70 / trUrine.len; const q = trUrine.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (1 - p.u * 0.5).toFixed(2)); if (p.u >= 1) killP(p); } });
  urineEl.setAttribute("stroke-width", f1(3.5 + 5.5 * sm.uri)); flushEl.setAttribute("opacity", sm.uri.toFixed(2));
  /* joint wash of inflammation */
  layers.glow.setAttribute("opacity", (sm.I * 0.5).toFixed(2));
  /* crystals grow or shrink */
  cryGroups.forEach((c, i) => { const s = clamp((sm.C - i * 0.07) * 1.5); place(c.g, c.x, c.y, Math.sin(tm / 900 + i) * 4, Math.max(0.06, s)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* tophi */
  topGroups.forEach((c) => { const s = clamp(sm.T * 1.15); place(c.g, c.x, c.y, 0, Math.max(0.05, s)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* macrophage with its calming shield under attack care */
  place(mac, 678 + Math.sin(tm / 1500) * 2, 345 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1 + 0.07 * sm.I * Math.sin(tm / 300));
  shieldG.setAttribute("opacity", sm.atk.toFixed(2));
  place(shieldG, 678, 345, 0, 1 + 0.04 * Math.sin(tm / 300));
  /* IL-1 from macrophage toward the crystals */
  acc.il1 += dt * sm.I * 13; while (acc.il1 >= 1) { acc.il1--; const p = freeP(il1); if (p) emit(p, 662, 338 + rnd(-8, 8), rnd(-46, -26), rnd(-8, 10)); }
  il1.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6 || p.x < 470) killP(p); });
  /* neutrophils enter from the left of the cavity and gather at the crystals */
  const nn = Math.round(sm.I * neus.length);
  neus.forEach((n, i) => { const act = i < nn; if (!act) { n.g.style.opacity = 0; place(n.g, -40, 345, 0, 0.1); n.x = -40; return; } n.g.style.opacity = 1; if (n.x < 0) { n.x = 262; n.y = 338 + (i % 3) * 8; } n.x += (n.tx - n.x) * dt * 0.35; n.y += (n.ty - n.y) * dt * 0.35; if (Math.hypot(n.tx - n.x, n.ty - n.y) < 8) { n.tx = 495 + Math.random() * 120; n.ty = 328 + Math.random() * 34; } place(n.g, n.x + Math.sin(tm / 320 + n.ph) * 1.6, n.y, Math.sin(tm / 420 + n.ph) * 10, 1); });
  /* gauges */
  gg.ur.set(sm.U, wordOf(sm.U, 0.35, 0.65, ["low", "raised", "high"])); gg.cry.set(sm.C, wordOf(sm.C, 0.25, 0.6, ["few", "some", "many"])); gg.inf.set(sm.I, wordOf(sm.I, 0.25, 0.6, ["calm", "active", "severe"])); gg.top.set(sm.T, wordOf(sm.T, 0.25, 0.6, ["none", "forming", "established"])); gg.pain.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["none", "aching", "severe"]));
  const key = drug + "|" + level;
  if (key !== capKey) { capKey = key; const c = capText(drug, level); if (capEl1.textContent !== c[0]) capEl1.textContent = c[0]; if (capEl2.textContent !== c[1]) capEl2.textContent = c[1]; }
}
run({ init, step });
