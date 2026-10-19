/* Lung cancer scene: smoke, airway, lung organs, central and peripheral tumours, nodes, brain and kidney spread, treatment actions. */
const layers = { tum: $("tum"), svc: $("svc"), nodes: $("nodes"), mets: $("mets"), bone: $("bone"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CENT = { x: 390, y: 228 }, PERI = { x: 550, y: 333 };
const BONE = { x: 872, y: 322 };
const gg = {};
let lungL = null, lungR = null, brainO = null, kidneyO = null;
let cavEl = null, neuroEl = null, glandEl = null, recepG = null, surgRing = null, rayG = null, svcPinch = null, tumG = null, capEl = null, capDrug = -1, capLevel = -1;
let tumLead = null, tumDot = null, brainGlow = null, kidneyGlow = null;
const lymphG = [], metG = [], caDots = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0, slot: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, tx, ty) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.tx = tx; p.ty = ty; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const smokeP = pool(16, () => mk("circle", { class: "sc-p p-smoke", r: 3 }, layers.parts));
const hormP = pool(22, () => mk("circle", { class: "sc-p p-horm", r: 2.6 }, layers.parts));
const spreadP = pool(18, () => mk("circle", { class: "sc-p p-spread", r: 2.6 }, layers.parts));
const targP = pool(12, () => mk("circle", { class: "sc-p p-targ", r: 3 }, layers.parts));
const smokeTrack = track([[86, 88], [200, 70], [330, 64], [365, 100], [365, 150], [372, 214]]);
function capText(d, l) {
  if (d === 1) return l === 0 ? "Surgery removes the lump, but spread cells are left behind." : "Surgery cuts out the tumour. Less is left to spread.";
  if (d === 2) return "Chemotherapy and radiotherapy shrink the tumour and slow spread.";
  if (d === 3) return l === 2 ? "Targeted therapy blocks the growth signal. The tumour shrinks." : "Targeted therapy finds no target here, so little changes.";
  if (l === 0) return "No treatment. The tumour grows fast, spreads early and releases hormones.";
  if (l === 1) return "No treatment. The tumour grows, hollows out and raises calcium.";
  return "No treatment. The tumour grows out in the lung and spreads.";
}
function initOrgans() {
  lungL = organ($("lungSlotL"), "lung", 225, 268, 190, {});
  lungR = organ($("lungSlotR"), "lung", 505, 268, 190, { flip: true });
  $("bronchL").setAttribute("d", "M365 176L" + f1(lungL.ports.in[0]) + " " + f1(lungL.ports.in[1]));
  $("bronchR").setAttribute("d", "M365 176L" + f1(lungR.ports.in[0]) + " " + f1(lungR.ports.in[1]));
  brainGlow = mk("ellipse", { class: "lc-glow", cx: 797, cy: 150, rx: 92, ry: 78, opacity: "0" }, $("brainSlot"));
  brainO = organ($("brainSlot"), "brain", 797, 150, 165, {});
  kidneyGlow = mk("ellipse", { class: "lc-kglow", cx: 740, cy: 322, rx: 62, ry: 52, opacity: "0" }, $("kidneySlot"));
  kidneyO = organ($("kidneySlot"), "kidney", 740, 322, 130, {});
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["tum", "Tumour", "g-bad", "Size and activity of the main lung tumour for the type selected."], ["loc", "Local", "g-fl", "Local effects in the chest: airway narrowing and squeezing of the vein from the head and arms."], ["spr", "Spread", "g-cyt", "Spread to lymph nodes and distant sites. Small cell spreads early."], ["hor", "Hormones", "g-horm", "Hormone like effects: water retention shown at the kidney for small cell, calcium release shown at bone for squamous."], ["res", "Response", "g-good", "How much the chosen treatment is expected to control this type, in teaching terms."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Smoke", 86, 88, 86, 132, "Smoke: inhaled carcinogens in tobacco smoke reach the airway lining over years and damage its DNA.");
  pill(ox, "Airway", 365, 80, 300, 60, "Airway: the windpipe and main branches. Small cell and squamous tumours tend to start near them.");
  pill(ox, "Lung", 200, 320, 150, 402, "Lung: the breathing organ. Adenocarcinoma tends to start out in its outer tissue.");
  const tp = pill(ox, "Tumour", CENT.x, CENT.y, 480, 120, "Tumour: the main mass. Central for small cell and squamous, outer for adenocarcinoma.");
  tumLead = tp.childNodes[0]; tumDot = tp.childNodes[1];
  pill(ox, "Lymph nodes", 360, 308, 360, 372, "Lymph nodes: a first station for spread from the lung.");
  pill(ox, "Brain", 760, 130, 797, 88, "Brain: a distant site tumour cells can reach in blood. Small cell spreads here early.");
  pill(ox, "Kidney", 740, 322, 712, 400, "Kidney: in SIADH the small cell tumour signal makes it hold water, so blood sodium falls.");
  pill(ox, "Bone", BONE.x, BONE.y, 872, 400, "Bone: squamous tumours can release a signal that leaches calcium from bone.");
  capEl = mk("text", { class: "lc-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 2);
}
function init() {
  initOrgans();
  svcPinch = mk("ellipse", { class: "lc-pinch", cx: 399, cy: 110, rx: 13, ry: 9, opacity: "0.35" }, layers.svc);
  [[350, 300], [380, 315], [335, 322]].forEach(([x, y], i) => { const g = mk("g", {}, layers.nodes); cell(g, { cls: "lymph2", r: 10, nuc: 0.35, seed: 3 + i, wob: 0.12 }); place(g, x, y, 0, 1); lymphG.push(g); });
  const bp = brainO.ports.parenchyma;
  [[-14, -10], [12, -4], [0, 14]].forEach(([dx, dy], i) => { const g = mk("g", {}, layers.mets); cell(g, { cls: "tum", r: 6, nuc: 0.4, seed: 31 + i, wob: 0.15 }); place(g, bp[0] + dx, bp[1] + dy, 0, 1); metG.push({ g, dx, dy }); });
  const bg = mk("g", { transform: "translate(" + BONE.x + " " + BONE.y + ")" }, layers.bone);
  mk("path", { class: "lc-bone", d: "M-16 -6C-22 -14 -10 -22 -4 -14L14 -2C22 -8 30 2 22 8C16 13 6 9 6 2L-8 2C-8 10 -20 12 -24 4C-26 -1 -22 -5 -16 -6Z" }, bg);
  for (let i = 0; i < 3; i++) caDots.push(mk("circle", { class: "lc-ca", cx: -10 + i * 10, cy: -12, r: 2.2, opacity: "0" }, bg));
  tumG = mk("g", {}, layers.tum);
  for (let i = 0; i < 7; i++) { const a = i * 0.9, rr = i === 0 ? 0 : 15; cell(tumG, { cls: "tum", r: i === 0 ? 17 : 11, nuc: 0.45, seed: i + 8, wob: 0.17, x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.8 }); }
  cavEl = mk("ellipse", { class: "lc-cav", rx: 11, ry: 8, opacity: "0" }, tumG);
  neuroEl = mk("g", { opacity: "0" }, tumG); [-10, 0, 10].forEach((dx) => mk("circle", { class: "lc-gran", cx: dx, cy: 6, r: 2.2 }, neuroEl));
  glandEl = mk("g", { opacity: "0" }, tumG); [-9, 9].forEach((dx) => mk("circle", { class: "lc-gland", cx: dx, cy: -4, r: 4.5 }, glandEl));
  recepG = mk("g", { opacity: "0" }, tumG);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.2832, x1 = Math.cos(a) * 22, y1 = Math.sin(a) * 22, x2 = Math.cos(a) * 28, y2 = Math.sin(a) * 28;
    mk("path", { class: "lc-recep", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, recepG); }
  surgRing = mk("circle", { class: "lc-ring", r: 42, opacity: "0" }, layers.over);
  rayG = mk("g", { opacity: "0" }, layers.over); [-18, 0, 18].forEach((dx) => mk("path", { class: "lc-ray", d: "M" + dx + " -120L" + dx * 0.4 + " -28" }, rayG));
  place(tumG, CENT.x, CENT.y, 0, 1);
  initPanel();
}
const sm = { B: 0.7, L: 0.6, M: 0.6, H: 0.6, R: 0, tx: PERI.x, ty: PERI.y, tscale: 1, cav: 0, neuro: 0, gland: 1, surg: 0, chemo: 0, targ: 0 };
const acc = { smoke: 0, horm: 0, spread: 0, targ: 0 };
function rimPos(slot, out) { const a = (slot / 8) * 6.2832; out.x = sm.tx + Math.cos(a) * 26 * sm.tscale; out.y = sm.ty + Math.sin(a) * 26 * sm.tscale; return out; }
const _rim = { x: 0, y: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.8);
  sm.B = lerp(sm.B, m.B, k2); sm.L = lerp(sm.L, m.L, k2); sm.M = lerp(sm.M, m.Mspr, k2); sm.H = lerp(sm.H, m.H, k2); sm.R = lerp(sm.R, m.R, k2);
  const peri = level === 2 ? 1 : 0;
  sm.tx = lerp(sm.tx, peri ? PERI.x : CENT.x, k2); sm.ty = lerp(sm.ty, peri ? PERI.y : CENT.y, k2);
  sm.cav = lerp(sm.cav, level === 1 ? 1 : 0, k2); sm.neuro = lerp(sm.neuro, level === 0 ? 1 : 0, k2); sm.gland = lerp(sm.gland, level === 2 ? 1 : 0, k2);
  sm.surg = lerp(sm.surg, drug === 1 ? 1 : 0, k); sm.chemo = lerp(sm.chemo, drug === 2 ? 1 : 0, k); sm.targ = lerp(sm.targ, drug === 3 ? 1 : 0, k);
  sm.tscale = clamp((0.45 + 0.75 * sm.B) * (1 - 0.5 * sm.surg), 0.3, 1.25);
  place(tumG, sm.tx, sm.ty, Math.sin(tm / 900) * 3, sm.tscale);
  cavEl.setAttribute("opacity", (sm.cav * 0.95).toFixed(2)); neuroEl.setAttribute("opacity", sm.neuro.toFixed(2)); glandEl.setAttribute("opacity", sm.gland.toFixed(2));
  recepG.setAttribute("opacity", sm.targ.toFixed(2));
  surgRing.setAttribute("opacity", (sm.surg * 0.9).toFixed(2));
  surgRing.setAttribute("cx", f1(sm.tx)); surgRing.setAttribute("cy", f1(sm.ty));
  surgRing.setAttribute("r", f1(34 + 8 * Math.sin(tm / 300)));
  rayG.setAttribute("transform", "translate(" + f1(sm.tx) + " " + f1(sm.ty) + ")"); rayG.setAttribute("opacity", (sm.chemo * (0.55 + 0.3 * Math.sin(tm / 180))).toFixed(2));
  svcPinch.setAttribute("opacity", (0.2 + 0.7 * sm.L).toFixed(2)); svcPinch.setAttribute("rx", f1(8 + 8 * sm.L));
  tumLead.setAttribute("d", "M480 120L" + f1(sm.tx) + " " + f1(sm.ty + 8)); tumDot.setAttribute("cx", f1(sm.tx)); tumDot.setAttribute("cy", f1(sm.ty));
  brainGlow.setAttribute("opacity", (sm.M * 0.4).toFixed(2));
  const bp = brainO.ports.parenchyma;
  metG.forEach((mt, i) => place(mt.g, bp[0] + mt.dx, bp[1] + mt.dy, 0, 0.4 + 0.7 * sm.M));
  kidneyGlow.setAttribute("opacity", ((level === 0 ? sm.H : sm.H * 0.2) * 0.45).toFixed(2));
  caDots.forEach((d, i) => d.setAttribute("opacity", ((level === 1 ? sm.H : sm.H * 0.15) * (0.5 + 0.5 * Math.sin(tm / 400 + i * 2))).toFixed(2)));
  lymphG.forEach((g, i) => { const p = [[350, 300], [380, 315], [335, 322]][i]; place(g, p[0], p[1], 0, 0.6 + 0.55 * sm.M); });
  acc.smoke += dt * 5; while (acc.smoke >= 1) { acc.smoke--; const p = free(smokeP); if (p) emit(p, 86, 88, 0, 0, 0, 0); }
  smokeP.forEach((p) => { if (!p.on) return; p.t += dt * 0.16; const q = smokeTrack.at(clamp(p.t)); p.e.setAttribute("transform", "translate(" + f1(clamp(q.x, 30, 930)) + " " + f1(clamp(q.y, 52, 430)) + ")"); p.e.setAttribute("opacity", p.t >= 1 ? "0" : "0.85"); if (p.t >= 1) kill(p); });
  acc.horm += dt * sm.H * 7 * (1 - 0.75 * sm.targ); while (acc.horm >= 1) { acc.horm--; const p = free(hormP); if (p) { const tgt = level === 1 ? BONE : { x: kidneyO.ports.pelvis[0], y: kidneyO.ports.pelvis[1] }; emit(p, sm.tx, sm.ty, 0, 0, tgt.x, tgt.y); } }
  hormP.forEach((p) => { if (!p.on) return; p.x += (p.tx - p.x) * dt * 1.1 + 8 * dt; p.y += (p.ty - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 52, 432)) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14) kill(p); });
  acc.spread += dt * sm.M * 6 * (1 - 0.5 * sm.surg); while (acc.spread >= 1) { acc.spread--; const p = free(spreadP); if (p) { const toFar = Math.random() < 0.55; emit(p, sm.tx, sm.ty, 0, 0, toFar ? bp[0] : 360, toFar ? bp[1] : 308); } }
  spreadP.forEach((p) => { if (!p.on) return; p.x += (p.tx - p.x) * dt * 0.9 + 6 * dt; p.y += (p.ty - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 52, 432)) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14) kill(p); });
  acc.targ += dt * (drug === 3 ? 7 : 0); while (acc.targ >= 1) { acc.targ--; const p = free(targP); if (p) { p.slot = Math.floor(rnd(0, 8)); emit(p, sm.tx + rnd(-90, 90), sm.ty - 80, 0, 0, 0, 0); } }
  targP.forEach((p) => { if (!p.on) return;
    if (drug !== 3) { p.t += dt * 2; p.e.setAttribute("opacity", clamp(1 - p.t).toFixed(2)); if (p.t >= 1) kill(p); return; }
    rimPos(p.slot, _rim); p.x += (_rim.x - p.x) * dt * 2.2; p.y += (_rim.y - p.y) * dt * 2.2;
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 52, 432)) + ")");
    p.e.setAttribute("opacity", (0.6 + 0.4 * Math.sin(tm / 250 + p.slot * 2)).toFixed(2)); });
  gg.tum.set(sm.B, wordOf(sm.B, 0.3, 0.62, ["controlled", "present", "large"])); gg.loc.set(sm.L, wordOf(sm.L, 0.3, 0.62, ["mild", "present", "marked"])); gg.spr.set(sm.M, wordOf(sm.M, 0.3, 0.62, ["limited", "possible", "extensive"])); gg.hor.set(sm.H, wordOf(sm.H, 0.3, 0.62, ["none", "possible", "marked"])); gg.res.set(sm.R, wordOf(sm.R, 0.25, 0.55, ["none", "partial", "good"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
