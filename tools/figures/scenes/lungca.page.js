/* Lung cancer scene: smoke, airway, central and peripheral tumours, local effects, spread, hormones, gauges. */
const layers = { smoke: $("smoke"), air: $("air"), lungs: $("lungs"), tum: $("tum"), svc: $("svc"), apex: $("apex"), nodes: $("nodes"), far: $("far"), horm: $("horm"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CENT = { x: 352, y: 220 }, PERI = { x: 540, y: 330 };
const KID = { x: 730, y: 282 }, ADR = { x: 865, y: 282 }, BONE = { x: 800, y: 362 };
const gg = {};
let cavEl = null, neuroEl = null, glandEl = null, surgRing = null, rayG = null, svcPinch = null, tumG = null, apexG = null, farG = null;
const lymphG = [], hormNodes = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, tx, ty) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.tx = tx; p.ty = ty; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const smokeP = pool(16, () => mk("circle", { class: "sc-p p-smoke", r: 3 }, layers.parts));
const hormP = pool(22, () => mk("circle", { class: "sc-p p-horm", r: 2.6 }, layers.parts));
const spreadP = pool(18, () => mk("circle", { class: "sc-p p-spread", r: 2.6 }, layers.parts));
const targP = pool(14, () => mk("circle", { class: "sc-p p-targ", r: 2.8 }, layers.parts));
const smokeTrack = track([[86, 88], [190, 66], [338, 62], [352, 92], [352, 178], [352, 214]]);
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["tum", "Tumour", "g-bad", "Size and activity of the main lung tumour for the type selected."], ["loc", "Local", "g-fl", "Local effects in the chest: airway block, SVC obstruction and apex (Pancoast) effects."], ["spr", "Spread", "g-cyt", "Spread to lymph nodes and distant sites. Small cell spreads early."], ["hor", "Hormones", "g-horm", "Hormone like effects: SIADH and ACTH from small cell, PTHrP calcium effect from squamous."], ["res", "Response", "g-good", "How much the chosen treatment is expected to control this type, in teaching terms."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Smoke", 78, 88, 112, 102, "Smoke: inhaled carcinogens in tobacco smoke reach the airway lining over years and damage its DNA.");
  pill(ox, "Trachea", 352, 95, 285, 78, "Trachea and main bronchi: the central airways. Small cell and squamous tumours tend to arise here.");
  pill(ox, "SVC obstruction", 385, 110, 470, 78, "Superior vena cava obstruction: a central tumour or nodes squeeze the SVC, so blood from the head and arms drains poorly.");
  pill(ox, "Pancoast tumour", 558, 138, 600, 78, "Pancoast tumour: a tumour at the lung apex that can affect nearby nerves and ribs and cause shoulder and arm symptoms.");
  pill(ox, "Central tumour", 352, 220, 190, 170, "Central tumour: near the main bronchi. This is the typical site for small cell and squamous types.");
  pill(ox, "Peripheral tumour", 540, 330, 500, 385, "Peripheral tumour: out in the lung tissue near the pleura. This is the typical site for adenocarcinoma.");
  pill(ox, "Lymph nodes", 365, 288, 365, 330, "Mediastinal lymph nodes: a first station for spread from the lung.");
  pill(ox, "Distant spread", 800, 135, 800, 88, "Distant spread: tumour cells travel in blood and lymph to sites such as brain, liver, bone and adrenal glands.");
  pill(ox, "SIADH", 730, 282, 715, 225, "SIADH: small cell tumours can release ADH like activity, so the kidney holds water and blood sodium falls.");
  pill(ox, "ACTH", 865, 282, 880, 225, "ACTH: small cell tumours can release ACTH like activity and drive the adrenal glands to make excess cortisol.");
  pill(ox, "PTHrP calcium", 800, 362, 800, 415, "PTHrP: squamous tumours can release parathyroid hormone related protein, raising blood calcium from bone.");
  pill(ox, "Large cell", 140, 340, 140, 385, "Large cell: a poorly differentiated non small cell type, often peripheral and bulky. Shown for comparison; it is not on the type slider.");
}
function init() {
  const L = layers.lungs;
  mk("path", { class: "lc-lung", d: "M120 160C120 130 170 105 225 115C285 125 315 175 310 250C305 340 270 410 200 415C130 410 95 340 100 250C102 205 108 180 120 160Z" }, L);
  mk("path", { class: "lc-lung", d: "M410 160C410 130 460 105 515 115C575 125 605 175 600 250C595 340 560 410 490 415C420 410 385 340 390 250C392 205 398 180 410 160Z" }, L);
  mk("rect", { class: "lc-cig", x: 52, y: 82, width: 34, height: 9, rx: 4 }, layers.smoke);
  mk("rect", { class: "lc-cigtip", x: 80, y: 82, width: 7, height: 9, rx: 2 }, layers.smoke);
  const A = layers.air;
  mk("rect", { class: "lc-air", x: 338, y: 56, width: 28, height: 122, rx: 11 }, A);
  mk("path", { class: "lc-bronch", d: "M352 176L278 224M352 176L432 224" }, A);
  mk("rect", { class: "lc-svc", x: 378, y: 62, width: 15, height: 96, rx: 7 }, layers.svc);
  svcPinch = mk("ellipse", { class: "lc-pinch", cx: 385, cy: 112, rx: 13, ry: 9, opacity: "0.35" }, layers.svc);
  apexG = mk("g", {}, layers.apex); cell(apexG, { cls: "tum", r: 15, nuc: 0.4, seed: 7, wob: 0.16 }); place(apexG, 558, 138, 0, 1);
  const lc = mk("g", {}, L); cell(lc, { cls: "tum", r: 18, nuc: 0.38, seed: 11, wob: 0.18 }); place(lc, 140, 340, 0, 1);
  [[350, 282], [372, 296], [338, 300]].forEach(([x, y], i) => { const g = mk("g", {}, layers.nodes); cell(g, { cls: "lymph2", r: 10, nuc: 0.35, seed: 3 + i, wob: 0.12 }); place(g, x, y, 0, 1); lymphG.push(g); });
  farG = mk("g", {}, layers.far); cell(farG, { cls: "tum", r: 24, nuc: 0.42, seed: 5, wob: 0.15 }); mk("circle", { class: "lc-metdot", cx: -8, cy: -6, r: 3 }, farG); mk("circle", { class: "lc-metdot", cx: 9, cy: 7, r: 2.6 }, farG); place(farG, 800, 135, 0, 1);
  const hk = mk("g", {}, layers.horm); cell(hk, { cls: "kid", r: 16, nuc: 0.3, seed: 2, wob: 0.2 }); place(hk, KID.x, KID.y, 20, 1); hormNodes.push(hk);
  const ha = mk("g", {}, layers.horm); cell(ha, { cls: "adr", r: 14, nuc: 0.3, seed: 4, wob: 0.2 }); place(ha, ADR.x, ADR.y, -15, 1); hormNodes.push(ha);
  const hb = mk("g", {}, layers.horm); mk("path", { class: "lc-bone", d: "M-16 -6C-22 -14 -10 -22 -4 -14L14 -2C22 -8 30 2 22 8C16 13 6 9 6 2L-8 2C-8 10 -20 12 -24 4C-26 -1 -22 -5 -16 -6Z" }, hb); place(hb, BONE.x, BONE.y, 0, 1); hormNodes.push(hb);
  tumG = mk("g", {}, layers.tum);
  for (let i = 0; i < 7; i++) { const a = i * 0.9, rr = i === 0 ? 0 : 15; cell(tumG, { cls: "tum", r: i === 0 ? 17 : 11, nuc: 0.45, seed: i + 8, wob: 0.17, x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.8 }); }
  cavEl = mk("ellipse", { class: "lc-cav", rx: 11, ry: 8, opacity: "0" }, tumG);
  neuroEl = mk("g", { opacity: "0" }, tumG); [-10, 0, 10].forEach((dx) => mk("circle", { class: "lc-gran", cx: dx, cy: 6, r: 2.2 }, neuroEl));
  glandEl = mk("g", { opacity: "0" }, tumG); [-9, 9].forEach((dx) => mk("circle", { class: "lc-gland", cx: dx, cy: -4, r: 4.5 }, glandEl));
  surgRing = mk("circle", { class: "lc-ring", r: 34, opacity: "0" }, tumG);
  rayG = mk("g", { opacity: "0" }, layers.over); [-18, 0, 18].forEach((dx) => mk("path", { class: "lc-ray", d: "M" + dx + " -120L" + dx * 0.4 + " -28" }, rayG));
  place(tumG, CENT.x, CENT.y, 0, 1);
  initPanel();
}
const sm = { B: 0.7, L: 0.6, M: 0.6, H: 0.6, R: 0, tx: CENT.x, ty: CENT.y, cav: 0, neuro: 1, gland: 0, surg: 0, chemo: 0, targ: 0 };
const acc = { smoke: 0, horm: 0, spread: 0, targ: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.8);
  sm.B = lerp(sm.B, m.B, k2); sm.L = lerp(sm.L, m.L, k2); sm.M = lerp(sm.M, m.Mspr, k2); sm.H = lerp(sm.H, m.H, k2); sm.R = lerp(sm.R, m.R, k2);
  const peri = level === 2 ? 1 : 0;
  sm.tx = lerp(sm.tx, peri ? PERI.x : CENT.x, k2); sm.ty = lerp(sm.ty, peri ? PERI.y : CENT.y, k2);
  sm.cav = lerp(sm.cav, level === 1 ? 1 : 0, k2); sm.neuro = lerp(sm.neuro, level === 0 ? 1 : 0, k2); sm.gland = lerp(sm.gland, level === 2 ? 1 : 0, k2);
  sm.surg = lerp(sm.surg, drug === 1 ? 1 : 0, k); sm.chemo = lerp(sm.chemo, drug === 2 ? 1 : 0, k); sm.targ = lerp(sm.targ, drug === 3 ? 1 : 0, k);
  const tscale = clamp(0.45 + 0.75 * sm.B, 0.35, 1.25);
  place(tumG, sm.tx, sm.ty, Math.sin(tm / 900) * 3, tscale);
  cavEl.setAttribute("opacity", (sm.cav * 0.95).toFixed(2)); neuroEl.setAttribute("opacity", sm.neuro.toFixed(2)); glandEl.setAttribute("opacity", sm.gland.toFixed(2));
  surgRing.setAttribute("opacity", (sm.surg * 0.9).toFixed(2));
  rayG.setAttribute("transform", "translate(" + f1(sm.tx) + " " + f1(sm.ty) + ")"); rayG.setAttribute("opacity", (sm.chemo * (0.55 + 0.3 * Math.sin(tm / 180))).toFixed(2));
  svcPinch.setAttribute("opacity", (0.2 + 0.7 * sm.L).toFixed(2)); svcPinch.setAttribute("rx", f1(8 + 8 * sm.L));
  place(apexG, 558, 138, 0, 0.65 + 0.5 * sm.L);
  place(farG, 800, 135, 0, 0.5 + 0.6 * sm.M);
  lymphG.forEach((g, i) => { const p = [[350, 282], [372, 296], [338, 300]][i]; place(g, p[0], p[1], 0, 0.6 + 0.55 * sm.M); });
  hormNodes.forEach((g, i) => { const pos = [KID, ADR, BONE][i]; const act = level === 0 ? (i < 2 ? sm.H : sm.H * 0.25) : level === 1 ? (i === 2 ? sm.H : sm.H * 0.2) : sm.H * 0.3; place(g, pos.x, pos.y, 0, 0.85 + 0.3 * act * (0.6 + 0.4 * Math.sin(tm / 320 + i * 2))); g.style.opacity = (0.75 + 0.25 * act).toFixed(2); });
  acc.smoke += dt * 5; while (acc.smoke >= 1) { acc.smoke--; const p = free(smokeP); if (p) emit(p, 86, 88, 0, 0, 0, 0); }
  smokeP.forEach((p) => { if (!p.on) return; p.t += dt * 0.16; const q = smokeTrack.at(clamp(p.t)); p.e.setAttribute("transform", "translate(" + f1(clamp(q.x, 30, 930)) + " " + f1(clamp(q.y, 52, 430)) + ")"); p.e.setAttribute("opacity", p.t >= 1 ? "0" : "0.85"); if (p.t >= 1) kill(p); });
  acc.horm += dt * sm.H * 7; while (acc.horm >= 1) { acc.horm--; const p = free(hormP); if (p) { const tgt = level === 1 ? BONE : (Math.random() < 0.5 ? KID : ADR); emit(p, sm.tx, sm.ty, 0, 0, tgt.x, tgt.y); } }
  hormP.forEach((p) => { if (!p.on) return; p.x += (p.tx - p.x) * dt * 1.1 + 8 * dt; p.y += (p.ty - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 52, 432)) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14) kill(p); });
  acc.spread += dt * sm.M * 6; while (acc.spread >= 1) { acc.spread--; const p = free(spreadP); if (p) { const toFar = Math.random() < 0.55; emit(p, sm.tx, sm.ty, 0, 0, toFar ? 800 : 360, toFar ? 135 : 290); } }
  spreadP.forEach((p) => { if (!p.on) return; p.x += (p.tx - p.x) * dt * 0.9 + 6 * dt; p.y += (p.ty - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 52, 432)) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14) kill(p); });
  acc.targ += dt * sm.targ * 8; while (acc.targ >= 1) { acc.targ--; const p = free(targP); if (p) emit(p, sm.tx + rnd(-70, 70), sm.ty - 60, 0, 0, sm.tx + rnd(-14, 14), sm.ty + rnd(-10, 10)); }
  targP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.6; p.y += (p.ty - p.y) * dt * 1.6; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 52, 432)) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t * 0.35).toFixed(2)); if (p.t > 3) kill(p); });
  gg.tum.set(sm.B, wordOf(sm.B, 0.3, 0.62, ["small", "present", "large"])); gg.loc.set(sm.L, wordOf(sm.L, 0.3, 0.62, ["mild", "present", "marked"])); gg.spr.set(sm.M, wordOf(sm.M, 0.3, 0.62, ["limited", "possible", "extensive"])); gg.hor.set(sm.H, wordOf(sm.H, 0.3, 0.62, ["none", "possible", "marked"])); gg.res.set(sm.R, wordOf(sm.R, 0.25, 0.55, ["none", "partial", "good"]));
}
run({ init, step });
