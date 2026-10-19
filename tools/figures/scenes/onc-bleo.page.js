/* Bleomycin scene: tumour DNA breaks on the left; lung, skin and spared marrow on the right. */
const WW = SC.W;
const layers = { cell: $("cellSlot"), dna: $("dna"), bursts: $("bursts"), parts: $("parts"), lung: $("lungSlot"), skin: $("skinSlot"), mar: $("marrow"), over: $("over"), panel: $("panel") };
const CX = 290, CY = 245, CR = 160;
const BRK = [245, 290, 335];
/* ---- tumour cell ---- */
let deadShade = null;
function initCell() {
  const g = cell(layers.cell, { cls: "tum", r: CR, nuc: 0.62, seed: 3, wob: 0.07 });
  place(g, CX, CY, 0, 1);
  deadShade = mk("circle", { class: "bl-dead", cx: 0, cy: 0, r: CR * 0.96, opacity: "0" }, g);
}
/* ---- DNA in 4 segments; joints at the break sites separate as strands snap ---- */
const segs = [];
function initDna() {
  const B = [205, 245, 290, 335, 375];
  for (let i = 0; i < 4; i++) {
    const g = mk("g", {}, layers.dna);
    mk("path", { class: "bl-dna-s", d: "M" + B[i] + " 237L" + B[i + 1] + " 237" }, g);
    mk("path", { class: "bl-dna-s", d: "M" + B[i] + " 253L" + B[i + 1] + " 253" }, g);
    for (let x = B[i] + 5; x < B[i + 1]; x += 9) mk("path", { class: "bl-dna-r", d: "M" + x + " 237L" + x + " 253" }, g);
    segs.push({ g, dir: i % 2 ? 1 : -1 });
  }
}
/* ---- radical bursts at the break sites ---- */
const bursts = [];
function starD(r1, r2, n) { let d = ""; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = (i / (n * 2)) * 6.283; d += (i ? "L" : "M") + f1(Math.cos(a) * r) + " " + f1(Math.sin(a) * r); } return d + "Z"; }
function initBursts() { BRK.forEach((x) => { const g = mk("g", { opacity: "0" }, layers.bursts); mk("path", { class: "bl-burst", d: starD(11, 4.5, 8) }, g); place(g, x, 245, 0, 1); bursts.push(g); }); }
/* ---- blebs on the dying cell rim ---- */
const blebs = [];
function initBlebs() { for (let i = 0; i < 6; i++) { const c = mk("circle", { class: "bl-bleb", cx: 0, cy: 0, r: 8, opacity: "0" }, layers.cell); blebs.push({ e: c, a: i * 1.05 + 0.4 }); } }
/* ---- organs ---- */
let fibG = null, scarE = null, pigG = null, pigW = null, flushE = null;
function initOrgans() {
  organ(layers.lung, "lung", 765, 165, 175, {});
  fibG = mk("g", { opacity: "0" }, layers.lung);
  for (let i = 0; i < 12; i++) { const x = rnd(690, 840), y = rnd(100, 230); mk("path", { class: "bl-streak", d: "M" + f1(x) + " " + f1(y) + "l" + f1(rnd(-22, 22)) + " " + f1(rnd(-6, 6)) }, fibG); }
  scarE = mk("ellipse", { class: "bl-scar", cx: 765, cy: 165, rx: 80, ry: 68, opacity: "0" }, layers.lung);
  organ(layers.skin, "skin", 765, 300, 175, {});
  pigG = mk("g", { opacity: "0" }, layers.skin);
  for (let i = 0; i < 12; i++) mk("circle", { class: "bl-pig", cx: f1(692 + i * 13.4), cy: f1(292 + ((i * 37) % 17)), r: 3 }, pigG);
  pigW = mk("ellipse", { class: "bl-pigwash", cx: 765, cy: 300, rx: 85, ry: 26, opacity: "0" }, layers.skin);
  flushE = mk("ellipse", { class: "bl-flush", cx: 765, cy: 300, rx: 85, ry: 26, opacity: "0" }, layers.skin);
}
/* ---- marrow inside a small procedural bone: stays healthy ---- */
function initMarrow() {
  const g = layers.mar, bx = 765, by = 392;
  mk("rect", { class: "bl-bone", x: bx - 75, y: by - 14, width: 150, height: 28, rx: 12 }, g);
  [[-75, -8], [-75, 8], [75, -8], [75, 8]].forEach(([dx, dy]) => mk("circle", { class: "bl-bone", cx: bx + dx, cy: by + dy, r: 13 }, g));
  mk("ellipse", { class: "bl-cav", cx: bx, cy: by, rx: 52, ry: 9 }, g);
  for (let i = 0; i < 14; i++) mk("circle", { class: "bl-mcell", cx: f1(bx - 46 + i * 7), cy: f1(by + ((i * 37) % 9) - 4), r: 2.6 }, g);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const bleo = pool(14, () => mk("path", { class: "sc-p p-bleo", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const fer = pool(10, () => mk("circle", { class: "sc-p p-fe", r: 2.6 }, layers.parts));
const o2 = pool(10, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges, caption ---- */
const gg = {};
let capEl = null;
function capText(m) {
  if (!m.on) return "No drug yet: the tumour keeps growing and the lungs, skin and marrow stay healthy.";
  if (m.prot) return m.Fib < 0.25 ? "Bleomycin is cutting tumour DNA while low oxygen and lung checks keep the lungs clear." : "The tumour is dying and lung checks have held the scarring back, though skin still darkens.";
  return m.Kill < 0.5 ? "Bleomycin with iron is cutting tumour DNA while the lungs are still clear." : "Tumour DNA lies in pieces but lung scarring and skin darkening have built up.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [180, 360, 540, 720];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "How much of the tumour the drug has killed. Rises as strand breaks pile up through the course."],
    ["fib", "Lung scar", "g-bad", "Lung scarring: radicals injure air sacs the lung cannot disarm, and fibrosis builds with the course. Low oxygen and lung checks hold it back."],
    ["skin", "Skin change", "g-eos", "Skin darkening and rash: skin also lacks bleomycin hydrolase, so injury builds with the course."],
    ["mar", "Marrow harm", "g-neu", "Marrow harm stays near none: marrow has plenty of hydrolase, so bleomycin causes little myelosuppression."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Tumour DNA", 340, 238, 430, 120, "Tumour DNA: bleomycin with iron and oxygen cuts both strands, and the cell cannot divide past G2 to M so it dies.");
  pill(ox, "Bleomycin", 132, 245, 70, 110, "Bleomycin: a glycopeptide drug that enters the cell, grabs iron and latches onto DNA.");
  pill(ox, "Iron", 260, 360, 150, 400, "Iron: bleomycin needs iron and oxygen to make the radicals that cut DNA.");
  pill(ox, "Radicals", 290, 232, 470, 330, "Oxygen radicals: short lived sparks that snap single and double strands of DNA.");
  pill(ox, "Lung", 700, 150, 640, 100, "Lung: the lung has little bleomycin hydrolase to disarm the drug, so radicals scar the air sacs into fibrosis.");
  pill(ox, "Oxygen", 835, 120, 880, 92, "Oxygen: high oxygen feeds the radical reaction, so it worsens bleomycin lung injury.");
  pill(ox, "Skin", 845, 305, 885, 350, "Skin: skin also lacks the hydrolase, so bleomycin darkens it in streaks and rashes.");
  pill(ox, "Marrow spared", 855, 390, 800, 352, "Marrow: marrow has plenty of hydrolase, so bleomycin causes little myelosuppression.");
  capEl = mk("text", { class: "bl-capline", x: 30, y: 428 }, ox); capEl.textContent = capText({ on: 0, prot: 0, Kill: 0, Fib: 0 });
}
const sm = { Kill: 0, Fib: 0, Skin: 0, Fev: 0, O2: 0.8, on: 0, prot: 0 };
const acc = { bleo: 0, fe: 0, o2: 0 };
function init() { initCell(); initDna(); initBursts(); initBlebs(); initOrgans(); initMarrow(); initPanel(); }
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 0.9);
  ["Kill", "Fib", "Skin", "Fev", "O2"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.on = lerp(sm.on, m.on, k1); sm.prot = lerp(sm.prot, m.prot, k1);
  /* dying cell: darkens, blebs, DNA joints separate */
  deadShade.setAttribute("opacity", (sm.Kill * 0.4).toFixed(2));
  segs.forEach((s) => place(s.g, 0, s.dir * sm.Kill * 7, 0, 1));
  bursts.forEach((b, i) => { const fl = 0.5 + 0.5 * Math.sin(tm / 130 + i * 2.1); b.setAttribute("opacity", (sm.Kill * (0.35 + 0.65 * fl)).toFixed(2)); place(b, BRK[i], 245, tm / 40 + i * 30, 0.7 + 0.5 * fl); });
  blebs.forEach((b) => { const r = CR + 2; b.e.setAttribute("cx", f1(CX + Math.cos(b.a) * r)); b.e.setAttribute("cy", f1(CY + Math.sin(b.a) * r)); b.e.setAttribute("r", f1(4 + 10 * sm.Kill)); b.e.setAttribute("opacity", sm.Kill > 0.15 ? "1" : "0"); });
  /* bleomycin drifts in from the left and docks on DNA */
  acc.bleo += dt * sm.on * (2 + 6 * sm.Kill);
  while (acc.bleo >= 1) { acc.bleo--; const p = free(bleo); if (p) emit(p, rnd(24, 60), rnd(150, 340), 0, 0, Math.floor(rnd(0, 3))); }
  bleo.forEach((p) => { if (!p.on) return; const tx = BRK[p.k], ty = 245, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 60 * dt; p.y += (dy / d) * 60 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (d < 14) kill(p); });
  /* iron drifts to the break sites inside the cell */
  acc.fe += dt * sm.on * 4;
  while (acc.fe >= 1) { acc.fe--; const p = free(fer); if (p) emit(p, rnd(180, 400), rnd(160, 330), 0, 0, Math.floor(rnd(0, 3))); }
  fer.forEach((p) => { if (!p.on) return; const tx = BRK[p.k], ty = 245, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 40 * dt; p.y += (dy / d) * 40 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 10) kill(p); });
  /* oxygen rains into the lung; less of it with lung protection */
  acc.o2 += dt * (1 + 5 * sm.O2);
  while (acc.o2 >= 1) { acc.o2--; const p = free(o2); if (p) emit(p, rnd(690, 840), 52, rnd(-4, 4), rnd(26, 36), 0); }
  o2.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y > 130 ? clamp(1 - (p.y - 130) / 30).toFixed(2) : "1"); if (p.y > 160) kill(p); });
  /* organs: fibrosis streaks, scar wash, pigment, fever flush */
  fibG.setAttribute("opacity", sm.Fib.toFixed(2));
  scarE.setAttribute("opacity", (sm.Fib * 0.35).toFixed(2));
  pigG.setAttribute("opacity", sm.Skin.toFixed(2));
  pigW.setAttribute("opacity", (sm.Skin * 0.4).toFixed(2));
  flushE.setAttribute("opacity", (sm.Fev * 0.3).toFixed(2));
  /* caption and gauges */
  const c = capText(m); if (capEl.textContent !== c) capEl.textContent = c;
  gg.kill.set(sm.Kill, wordOf(sm.Kill, 0.3, 0.65, ["none", "some", "high"]));
  gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.25, 0.55, ["none", "some", "severe"]));
  gg.skin.set(sm.Skin, wordOf(sm.Skin, 0.3, 0.6, ["none", "some", "marked"]));
  gg.mar.set(m.Mar, "none");
}
run({ init, step });
