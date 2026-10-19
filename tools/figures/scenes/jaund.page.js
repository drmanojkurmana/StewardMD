/* Jaundice scene: red cell breakdown in the spleen, blood to the liver, conjugation, bile duct to the bowel, urobilinogen to the kidney. */
const layers = { spleenBits: $("spleenBits"), face: $("face"), rbcs: $("rbcs"), parts: $("parts"), samples: $("samples"), light: $("light"), over: $("over"), panel: $("panel"), vesselBlood: $("vesselBlood"), ductBile: $("ductBile"), uroPath: $("uroPath"), liverGlow: $("liverGlow"), stone: $("stone") };
let spleenO = null, liverO = null, gutO = null, kidneyO = null;
let trU = null, trC = null, trR = null, stoneX = 640, stoneY = 255, cycX = 465, cycY = 185;
let skinO = null, eyeY = null, urineD = null, stoolP = null, rays = null, wash = null, capEl = null, capKey = "";
function initOrgans() {
  spleenO = organ($("spleenSlot"), "spleen", 110, 165, 135, {});
  liverO = organ($("liverSlot"), "liver", 465, 185, 230, {});
  gutO = organ($("gutSlot"), "bowel", 790, 320, 175, {});
  kidneyO = organ($("kidneySlot"), "kidney", 835, 140, 105, {});
  const SP = spleenO.ports, LP = liverO.ports, GP = gutO.ports, KP = kidneyO.ports;
  const sU = SP.hilum, eU = LP.porta;
  const mU1 = [sU[0] + 50, 272], mU2 = [eU[0] - 60, 272];
  layers.vesselBlood.setAttribute("d", "M" + f1(sU[0]) + " " + f1(sU[1]) + "L" + f1(mU1[0]) + " " + f1(mU1[1]) + "L" + f1(mU2[0]) + " " + f1(mU2[1]) + "L" + f1(eU[0]) + " " + f1(eU[1]));
  trU = track([sU, mU1, mU2, eU]);
  const sC = LP.gall, eC = GP.in;
  const mC1 = [(sC[0] + eC[0]) / 2, sC[1] + 12], mC2 = [(sC[0] + eC[0]) / 2 + 22, eC[1] - 42];
  layers.ductBile.setAttribute("d", "M" + f1(sC[0]) + " " + f1(sC[1]) + "L" + f1(mC1[0]) + " " + f1(mC1[1]) + "L" + f1(mC2[0]) + " " + f1(mC2[1]) + "L" + f1(eC[0]) + " " + f1(eC[1]));
  trC = track([sC, mC1, mC2, eC]);
  const mid = trC.at(0.55);
  stoneX = Math.round(mid.x); stoneY = Math.round(mid.y);
  layers.stone.setAttribute("cx", String(stoneX)); layers.stone.setAttribute("cy", String(stoneY));
  const sR = GP.coils, eR = KP.hilum || KP.pelvis;
  const mR1 = [sR[0] + 55, sR[1] - 50], mR2 = [eR[0] + 25, eR[1] + 70];
  layers.uroPath.setAttribute("d", "M" + f1(sR[0]) + " " + f1(sR[1]) + "L" + f1(mR1[0]) + " " + f1(mR1[1]) + "L" + f1(mR2[0]) + " " + f1(mR2[1]) + "L" + f1(eR[0]) + " " + f1(eR[1]));
  trR = track([sR, mR1, mR2, eR]);
  cycX = liverO.x; cycY = liverO.y;
}
function capText(d, t) {
  if (d === 1) return "Light on the skin breaks down bilirubin. Yellow fades.";
  if (d === 2) {
    if (t === 2) return "The drain is open. Bile flows again and stools darken.";
    return "No blockage here, so opening the drain changes little.";
  }
  if (d === 3) {
    if (t === 0) return "Treating the cause slows red cell breakdown. Bilirubin falls.";
    if (t === 1) return "Treating the cause helps the liver heal. Bilirubin falls.";
    return "Treating the cause opens bile flow. Yellow fades.";
  }
  if (t === 0) return "No treatment. Red cells break down fast and skin turns yellow.";
  if (t === 1) return "No treatment. The liver cannot keep up and yellow builds.";
  return "No treatment. Bile is blocked and stools turn pale.";
}
/* ---- spleen bits and gut bacteria ---- */
const spleenCells = [], bacs = [];
let bacBox = [740, 840, 290, 350];
function initSpleenBits() {
  for (let i = 0; i < 6; i++) {
    const c = cell(layers.spleenBits, { cls: "rbc", r: 10, seed: i + 5, wob: 0.12 });
    spleenCells.push({ c, x: 110 + Math.cos(i * 1.05) * 26, y: 165 + Math.sin(i * 1.05) * 22, i });
  }
  const coils = gutO.ports.coils;
  bacBox = [Math.round(coils[0] - 48), Math.round(coils[0] + 48), Math.round(coils[1] - 32), Math.round(coils[1] + 32)];
  for (let i = 0; i < 10; i++) {
    const g = cell(layers.spleenBits, { cls: "bac", r: 5.5, seed: i + 30, wob: 0.16 });
    bacs.push({ g, x: rnd(bacBox[0], bacBox[1]), y: rnd(bacBox[2], bacBox[3]), a: rnd(0, 6.28), i });
  }
}
let skinDots = [];
const conjDots = [];
function initFaceSamples() {
  const g = layers.face;
  mk("circle", { class: "jd-skin", cx: 255, cy: 135, r: 26 }, g);
  skinO = mk("circle", { class: "jd-jaund", cx: 255, cy: 135, r: 26, opacity: "0.3" }, g);
  mk("circle", { class: "jd-eye", cx: 246, cy: 131, r: 7 }, g); mk("circle", { class: "jd-eye", cx: 264, cy: 131, r: 7 }, g);
  eyeY = mk("g", {}, g);
  mk("circle", { class: "jd-jaund", cx: 246, cy: 131, r: 7, opacity: "0.3" }, eyeY);
  mk("circle", { class: "jd-jaund", cx: 264, cy: 131, r: 7, opacity: "0.3" }, eyeY);
  mk("circle", { class: "jd-iris", cx: 246, cy: 131, r: 3 }, g); mk("circle", { class: "jd-iris", cx: 264, cy: 131, r: 3 }, g);
  mk("path", { class: "dr-bond", d: "M246 149 Q255 155 264 149" }, g);
  for (let i = 0; i < 8; i++) {
    const d = mk("circle", { class: "sc-p p-un", r: 2.6 }, g);
    skinDots.push({ e: d, x: rnd(240, 270), y: rnd(122, 148), i });
  }
  const s = layers.samples;
  mk("rect", { class: "jd-box", x: 90, y: 355, width: 100, height: 57, rx: 8 }, s);
  mk("rect", { class: "jd-urine", x: 98, y: 378, width: 84, height: 26, rx: 5 }, s);
  urineD = mk("rect", { class: "jd-urine-d", x: 98, y: 378, width: 84, height: 26, rx: 5, opacity: "0" }, s);
  mk("rect", { class: "jd-box", x: 310, y: 355, width: 100, height: 57, rx: 8 }, s);
  mk("rect", { class: "jd-stool", x: 318, y: 378, width: 84, height: 26, rx: 5 }, s);
  stoolP = mk("rect", { class: "jd-stool-p", x: 318, y: 378, width: 84, height: 26, rx: 5, opacity: "0" }, s);
  wash = mk("ellipse", { class: "jd-wash", cx: 255, cy: 135, rx: 70, ry: 55, opacity: "0" }, layers.light);
  rays = mk("g", { opacity: "0" }, layers.light);
  for (let i = 0; i < 5; i++) { const x = 225 + i * 15; mk("path", { class: "jd-ray", d: "M" + x + " 70 L" + (x + 6) + " 96" }, rays); }
  for (let i = 0; i < 3; i++) conjDots.push(mk("circle", { class: "sc-p p-con", r: 3.2 }, layers.parts));
}
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(60, 500), y: rnd(-8, 8), v: rnd(0.8, 1.2), rot: rnd(-16, 16) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const pU = pool(26, () => mk("circle", { class: "sc-p p-un", r: 3.4 }, layers.parts));
const pC = pool(22, () => mk("circle", { class: "sc-p p-con", r: 3.4 }, layers.parts));
const pR = pool(14, () => mk("circle", { class: "sc-p p-uro", r: 2.8 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, u) { p.on = true; p.u = u; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(pl, tr, speed, dt) { pl.forEach((p) => { if (!p.on) return; p.u += speed * dt / tr.len; const pt = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); if (p.u >= 1) kill(p); }); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["un", "Unconjugated", "g-un", "Unconjugated bilirubin from red cell breakdown. Not water soluble, so it does not appear in urine."], ["con", "Conjugated", "g-con", "Conjugated bilirubin made in the liver. Water soluble and able to appear in urine when high in blood."], ["jau", "Jaundice", "g-jau", "Yellow colour of skin and the whites of the eyes when bilirubin builds up in blood and tissues."], ["uri", "Urine bilirubin", "g-uri", "Bilirubin in urine. Only conjugated bilirubin can do this, so urine looks dark in hepatic and post-hepatic patterns."], ["uro", "Urobilinogen", "g-uro", "Made by gut bacteria from conjugated bilirubin. It falls when bile cannot reach the gut."], ["sto", "Stool pigment", "g-sto", "Brown stool pigment from bilirubin reaching the gut. Pale clay stool means bile is not reaching the gut."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Spleen", 110, 165, 110, 82, "Spleen: old red cells are broken down here, releasing bilirubin into blood.");
  pill(ox, "Blood", 280, 272, 280, 232, "Blood: unconjugated bilirubin travels here to the liver. It cannot enter urine.");
  pill(ox, "Liver", 465, 185, 465, 82, "Liver: takes up bilirubin and conjugates it so it can leave in bile.");
  pill(ox, "Bile duct", 640, 255, 640, 232, "Bile duct: carries bile to the gut. A stone can block it.");
  pill(ox, "Gut", 790, 320, 790, 292, "Gut: bacteria turn bile into brown stool pigment and urobilinogen.");
  pill(ox, "Kidney", 835, 140, 835, 82, "Kidney: passes urobilinogen and, when high, conjugated bilirubin into urine.");
  pill(ox, "Skin", 255, 135, 255, 205, "Skin and eyes: look yellow when bilirubin builds up in blood.");
  pill(ox, "Urine and stool", 250, 385, 250, 335, "Samples: dark urine and pale stools point to blocked bile flow.");
  capEl = mk("text", { class: "jd-cap", x: 30, y: 428 }, ox);
  capEl.textContent = capText(0, 0);
}
const sm = { U: 0.9, C: 0.2, Flow: 0.8, Obs: 0, J: 0.5, UrineB: 0, Uro: 0.7, Stool: 0.8, photo: 0 };
const acc = { u: 0, c: 0, r: 0 };
function init() { initOrgans(); initSpleenBits(); initFaceSamples(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  ["U", "C", "Flow", "Obs", "J", "UrineB", "Uro", "Stool", "photo"].forEach((f) => { sm[f] = lerp(sm[f], m[f], k); });
  layers.liverGlow.setAttribute("opacity", (sm.C * 0.38).toFixed(2));
  layers.ductBile.setAttribute("stroke-width", f1(6 + 9 * sm.Flow));
  layers.ductBile.setAttribute("opacity", (0.45 + 0.5 * sm.Flow).toFixed(2));
  layers.uroPath.setAttribute("opacity", (0.2 + 0.6 * clamp(sm.Uro + 0.15)).toFixed(2));
  const sc = 0.15 + 0.85 * sm.Obs;
  layers.stone.setAttribute("transform", "translate(" + stoneX + " " + stoneY + ") scale(" + sc.toFixed(2) + ") translate(" + (-stoneX) + " " + (-stoneY) + ")");
  layers.stone.setAttribute("opacity", (0.15 + 0.85 * sm.Obs).toFixed(2));
  spleenCells.forEach((s, i) => { const q = 0.7 + 0.5 * sm.U; place(s.c, s.x + Math.sin(tm / 900 + i) * 2, s.y, Math.sin(tm / 700 + i) * 14, Math.max(0.45, q * (1 - 0.12 * Math.sin(tm / 500 + i * 1.3)))); });
  bacs.forEach((b, i) => { b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt; if (b.x < bacBox[0] || b.x > bacBox[1]) b.a = Math.PI - b.a; if (b.y < bacBox[2] || b.y > bacBox[3]) b.a = -b.a; b.x = clamp(b.x, bacBox[0], bacBox[1]); b.y = clamp(b.y, bacBox[2], bacBox[3]); place(b.g, b.x, b.y, Math.sin(tm / 700 + i) * 20, 1); });
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > 520) r.x = 60; place(r.g, r.x, 272 + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  conjDots.forEach((d, i) => { const t = tm / 650 + i * 2.1; d.setAttribute("transform", "translate(" + f1(cycX + Math.cos(t) * 24) + " " + f1(cycY + Math.sin(t) * 22) + ")"); d.setAttribute("opacity", (0.15 + 0.85 * sm.Flow).toFixed(2)); });
  skinDots.forEach((d, i) => { d.x += Math.sin(tm / 800 + i * 2) * 4 * dt; d.y += Math.cos(tm / 900 + i) * 4 * dt; d.x = clamp(d.x, 238, 272); d.y = clamp(d.y, 120, 150); d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); d.e.setAttribute("opacity", (0.9 - 0.65 * sm.photo).toFixed(2)); });
  acc.u += dt * sm.U * 7; while (acc.u >= 1) { acc.u--; const p = free(pU); if (p) emit(p, 0); }
  ride(pU, trU, 120, dt);
  acc.c += dt * sm.C * sm.Flow * 7; while (acc.c >= 1) { acc.c--; const p = free(pC); if (p) emit(p, 0); }
  ride(pC, trC, 105, dt);
  acc.r += dt * sm.Uro * 4; while (acc.r >= 1) { acc.r--; const p = free(pR); if (p) emit(p, 0); }
  ride(pR, trR, 82, dt);
  if (skinO) { skinO.setAttribute("opacity", (sm.J * 0.72).toFixed(2)); eyeY.querySelectorAll("circle").forEach((c) => c.setAttribute("opacity", (sm.J * 0.8).toFixed(2))); }
  if (wash) wash.setAttribute("opacity", (sm.photo * 0.35).toFixed(2));
  if (urineD) urineD.setAttribute("opacity", sm.UrineB.toFixed(2));
  if (stoolP) stoolP.setAttribute("opacity", clamp(1 - sm.Stool).toFixed(2));
  if (rays) rays.setAttribute("opacity", sm.photo.toFixed(2));
  gg.un.set(sm.U, wordOf(sm.U, 0.35, 0.7, ["low", "raised", "high"])); gg.con.set(sm.C, wordOf(sm.C, 0.35, 0.7, ["low", "raised", "high"]));
  gg.jau.set(sm.J, wordOf(sm.J, 0.3, 0.6, ["none", "mild", "marked"])); gg.uri.set(sm.UrineB, wordOf(sm.UrineB, 0.15, 0.55, ["absent", "present", "strong"]));
  gg.uro.set(sm.Uro, wordOf(sm.Uro, 0.3, 0.65, ["low", "normal", "high"])); gg.sto.set(sm.Stool, wordOf(sm.Stool, 0.3, 0.65, ["pale", "normal", "dark"]));
  const key = level * 10 + drug;
  if (key !== capKey) { capKey = key; const t = capText(drug, m.type); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
