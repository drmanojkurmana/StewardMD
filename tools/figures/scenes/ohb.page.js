/* OHB scene: dissociation curve, lung loading on real lung anatomy, tissue unloading,
 * acid docking on haemoglobin (Bohr effect) and buffer fluid soaking it up when treated. */
const GX0 = 118, GX1 = 518, GY0 = 100, GY1 = 338, GW = GX1 - GX0, GH = GY1 - GY0, MIDY = (GY0 + GY1) / 2;
const HBL = { x: 650, y: 150 }, HBT = { x: 655, y: 325 }, CELLC = { x: 830, y: 325 }, CELLR = 26;
const L = { chart: $("chart"), airIn: $("airIn"), lungVessel: $("lungVessel"), tisVessel: $("tisVessel"), lungSlot: $("lungSlot"), lung: $("lung"), tissue: $("tissue"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { shift: 0, load: 0.9, release: 0.5, satT: 0.5, affinity: 0.5, p50v: 0.5, driverR: 0.5, driverL: 0.5, corr: 0 };
const acc = { o2l: 0, o2t: 0, co2: 0, acid: 0, buf: 0 };
const DOCKS = [[-13, -12], [13, -12], [-13, 12], [13, 12], [-25, 0], [25, 0], [0, -25], [0, 25]];
let cur = {}, lungO = null, lungHb = null, tisHb = null, tisCell = null, gg = {}, capEl = null, capKey = "", p50pill = null, cellPulse = 0;
let trAir = null, trBlood = null, trRel = null;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null, slot: -1 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.st = 0; p.tr = null; p.slot = -1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const o2l = pool(14, () => mk("circle", { class: "sc-p p-o2", r: 3 }, L.parts));
const o2t = pool(14, () => mk("circle", { class: "sc-p p-o2", r: 3 }, L.parts));
const co2p = pool(10, () => mk("circle", { class: "sc-p p-co2", r: 2.6 }, L.parts));
const acidP = pool(12, () => mk("circle", { class: "sc-p p-h", r: 3 }, L.parts));
const bufP = pool(10, () => mk("circle", { class: "sc-p p-buf", r: 3 }, L.parts));
function hill(u, p50) { const n = 2.7, a = Math.pow(u, n), b = Math.pow(p50, n); return a / (a + b); }
function curveD(p50) { let d = ""; for (let i = 0; i <= 50; i++) { const u = i / 50, x = GX0 + u * GW, y = GY1 - hill(u, p50) * GH; d += (i ? "L" : "M") + f1(x) + " " + f1(y); } return d; }
function makeHb(parent, cx, cy) {
  const g = mk("g", {}, parent), dots = [], offs = [[-11, -10], [11, -10], [-11, 10], [11, 10]];
  offs.forEach(([dx, dy], i) => { const c = cell(g, { cls: "hb", r: 13, nuc: 0, seed: i * 2 + 1, wob: 0.12, n: 8 }); c.setAttribute("transform", "translate(" + f1(cx + dx) + " " + f1(cy + dy) + ")"); });
  offs.forEach(([dx, dy]) => { const d = mk("circle", { class: "oh-o2dot", cx: f1(cx + dx), cy: f1(cy + dy), r: 3.4, opacity: "1" }, g); dots.push(d); });
  return { g, dots };
}
function capText(lv, d) {
  if (d === 1) return "Acid-base correction soaks up acid. The curve moves back toward normal.";
  if (lv === 2) return "No treatment. Acid clings to haemoglobin and oxygen spills out too fast.";
  if (lv === 0) return "No treatment. Haemoglobin grips oxygen too tightly and releases too little.";
  return "No treatment. Loading in the lungs balances release in the tissues.";
}
function initChart() {
  const C = L.chart;
  [0.25, 0.5, 0.75].forEach((f) => { const y = GY1 - f * GH; mk("path", { class: "oh-grid", d: "M" + GX0 + " " + f1(y) + "H" + GX1 }, C); });
  [0.25, 0.5, 0.75].forEach((f) => { const x = GX0 + f * GW; mk("path", { class: "oh-grid", d: "M" + f1(x) + " " + GY0 + "V" + GY1 }, C); });
  mk("path", { class: "oh-axis", d: "M" + GX0 + " " + GY0 + "V" + GY1 + "H" + GX1 }, C);
  const yl = mk("text", { class: "oh-lab", x: 84, y: MIDY, "text-anchor": "middle", transform: "rotate(-90 84 " + MIDY + ")" }, C); yl.textContent = "Haemoglobin saturation";
  const xl = mk("text", { class: "oh-lab", x: 318, y: 374, "text-anchor": "middle" }, C); xl.textContent = "Oxygen partial pressure";
  [0.3, 0.42, 0.55].forEach((p) => mk("path", { class: "oh-ref", d: curveD(p) }, C));
  cur.act = mk("path", { class: "oh-act", d: curveD(0.42) }, C);
  cur.vl = mk("path", { class: "oh-p50l", d: "" }, C);
  cur.hl = mk("path", { class: "oh-p50l", d: "" }, C);
  cur.dot = mk("circle", { class: "oh-p50d", cx: GX0 + 0.42 * GW, cy: MIDY, r: 5.5 }, C);
  cur.lab = mk("text", { class: "oh-lab", x: 478, y: 122, "text-anchor": "middle" }, C); cur.lab.textContent = "normal";
}
function initOrgans() {
  lungO = organ(L.lungSlot, "lung", 810, 146, 110, {});
  const P = lungO.ports, tra = P.trachea || P.in, hil = P.hilumL || P.in;
  L.airIn.setAttribute("d", "M886 68 C878 92 " + f1(tra[0] + 16) + " " + f1(tra[1] + 18) + " " + f1(tra[0]) + " " + f1(tra[1]));
  L.lungVessel.setAttribute("d", "M" + HBL.x + " " + HBL.y + " L" + f1(hil[0]) + " " + f1(hil[1]));
  L.tisVessel.setAttribute("d", "M" + (HBT.x + 28) + " " + HBT.y + " L" + (CELLC.x - CELLR - 2) + " " + (CELLC.y + 1));
  trAir = track([[886, 68], [878, 92], tra]);
  trBlood = track([hil, [730, 153], [HBL.x + 26, HBL.y + 1]]);
  trRel = track([[HBT.x + 28, HBT.y], [745, HBT.y], [CELLC.x - CELLR - 2, CELLC.y + 1]]);
}
function initPanels() {
  lungHb = makeHb(L.lung, HBL.x, HBL.y);
  tisHb = makeHb(L.tissue, HBT.x, HBT.y);
  tisCell = cell(L.tissue, { cls: "tcell", r: CELLR, nuc: 0.4, seed: 5, wob: 0.1, n: 9 });
  place(tisCell, CELLC.x, CELLC.y, 0, 1);
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The blood";
  [["aff", "Affinity", "g-aff", "How tightly haemoglobin holds oxygen. High affinity holds on; low affinity lets go."], ["p50", "P50", "g-p50", "The oxygen partial pressure at half saturation. It rises when affinity falls and falls when affinity rises."], ["load", "Lung loading", "g-load", "How fully haemoglobin loads with oxygen in the lungs, where oxygen partial pressure is high."], ["rel", "Tissue release", "g-rel", "How readily haemoglobin releases oxygen in the tissues, where oxygen partial pressure is lower."], ["drv", "Acid and CO2 drive", "g-drv", "The combined push from carbon dioxide and hydrogen ions. More push shifts the curve right, the Bohr effect."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 170, y0, 52, 18, cls, name, tip); });
}
function initPills() {
  const o = L.over;
  pill(o, "Curve", 330, 185, 200, 120, "The S shape comes from teamwork between the four haemoglobin parts. As each oxygen loads, the next loads more easily.");
  p50pill = pill(o, "P50", 320, MIDY, 420, 300, "P50 marks half loading. A right shift raises it and lowers affinity; a left shift lowers it and raises affinity.");
  pill(o, "Lung", 790, 100, 862, 84, "The lung brings air in close to blood so oxygen can hop onto haemoglobin.");
  pill(o, "Loading", HBL.x, HBL.y, 640, 210, "In the lungs oxygen is plentiful, so haemoglobin loads up almost fully.");
  pill(o, "Acid", HBT.x, HBT.y - 13, 615, 285, "Acid and carbon dioxide from hard working tissues loosen the grip, so oxygen lets go where it is needed. This is the Bohr effect.");
  pill(o, "Tissue", CELLC.x, CELLC.y - 13, 868, 262, "In the tissues oxygen is scarce, so haemoglobin lets go and the tissue cell takes oxygen in.");
  pill(o, "Buffer", 895, 345, 880, 384, "Acid-base correction fluid soaks up extra acid on haemoglobin, so the curve moves back toward normal.");
  capEl = mk("text", { class: "oh-cap", x: 30, y: 428 }, o); capEl.textContent = capText(1, 0);
}
function init() { initChart(); initOrgans(); initPanels(); initPanel(); initPills(); }
function setDots(hb, bound) { hb.dots.forEach((d, i) => d.setAttribute("opacity", clamp(bound * 4 - i, 0, 1).toFixed(2))); }
function moveToward(p, tx, ty, sp, dt) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 0.001, s = Math.min(d, sp * dt); p.x += dx / d * s; p.y += dy / d * s; return d; }
function freeSlot() { return DOCKS.findIndex((_, i) => !acidP.some((p) => p.on && p.slot === i && p.st !== 2)); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), kc = Math.min(1, dt * 0.9);
  sm.shift = lerp(sm.shift, m.eff, k); sm.load = lerp(sm.load, m.load, k); sm.release = lerp(sm.release, m.release, k); sm.satT = lerp(sm.satT, m.satT, k); sm.affinity = lerp(sm.affinity, m.affinity, k); sm.p50v = lerp(sm.p50v, m.p50v, k); sm.driverR = lerp(sm.driverR, m.driverR, k); sm.driverL = lerp(sm.driverL, m.driverL, k); sm.corr = lerp(sm.corr, m.corr, kc);
  const p50u = 0.42 + sm.shift * 0.13, px = GX0 + p50u * GW;
  cur.act.setAttribute("d", curveD(p50u));
  cur.act.style.stroke = sm.shift > 0.18 ? "var(--c-bad)" : sm.shift < -0.18 ? "var(--c-lymph)" : "var(--c-good)";
  cur.dot.setAttribute("cx", f1(px)); cur.dot.setAttribute("cy", f1(MIDY));
  cur.vl.setAttribute("d", "M" + f1(px) + " " + MIDY + "V" + GY1); cur.hl.setAttribute("d", "M" + GX0 + " " + MIDY + "H" + f1(px));
  const lab = sm.shift > 0.3 ? "right shift" : sm.shift < -0.3 ? "left shift" : "normal"; if (cur.lab.textContent !== lab) cur.lab.textContent = lab;
  p50pill.querySelector("path").setAttribute("d", "M" + f1(px) + " " + MIDY + "L420 308");
  p50pill.querySelector("circle").setAttribute("cx", f1(px)); p50pill.querySelector("circle").setAttribute("cy", MIDY);
  setDots(lungHb, sm.load); setDots(tisHb, sm.satT);
  L.lungVessel.style.opacity = (0.45 + 0.5 * sm.load).toFixed(2);
  cellPulse = Math.max(0, cellPulse - dt * 2.2);
  place(tisCell, CELLC.x, CELLC.y, 0, 1 + 0.18 * cellPulse);
  /* oxygen: air down the trachea, then blood to lung haemoglobin */
  acc.o2l += dt * (2 + 6 * sm.load); while (acc.o2l >= 1) { acc.o2l--; const p = free(o2l); if (p) { emit(p, 886, 68); p.tr = trAir; } }
  o2l.forEach((p) => { if (!p.on) return; p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1);
    if (p.u >= 1) { if (p.tr === trAir) { p.tr = trBlood; p.u = 0; } else kill(p); } });
  /* oxygen: tissue haemoglobin releases to the tissue cell */
  acc.o2t += dt * (2 + 7 * sm.release); while (acc.o2t >= 1) { acc.o2t--; const p = free(o2t); if (p) { emit(p, HBT.x + 28, HBT.y); p.tr = trRel; } }
  o2t.forEach((p) => { if (!p.on) return; p.u += dt * 120 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) { kill(p); cellPulse = 1; } });
  /* waste carbon dioxide drifting out of the tissue */
  acc.co2 += dt * 7 * clamp(sm.shift); while (acc.co2 >= 1) { acc.co2--; const p = free(co2p); if (p) { emit(p, CELLC.x - 10, rnd(320, 345)); p.vx = -32; p.vy = 20; p.st = 0; } }
  co2p.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 606 || p.y > 382) kill(p); });
  /* acid leaves the tissue cell, drifts to haemoglobin and docks on it */
  acc.acid += dt * 8 * clamp(sm.shift); while (acc.acid >= 1) { acc.acid--; const p = free(acidP); if (p) { const s = freeSlot(); if (s < 0) break; emit(p, CELLC.x - 20, rnd(312, 338)); p.slot = s; } }
  acidP.forEach((p) => {
    if (!p.on) return;
    if (p.st === 2) { p.e.setAttribute("opacity", clamp(1 - p.t * 1.6).toFixed(2)); p.t += dt; if (p.t > 0.65) kill(p); return; }
    if (p.st === 0) { const sx = HBT.x + DOCKS[p.slot][0], sy = HBT.y + DOCKS[p.slot][1]; if (moveToward(p, sx, sy, 130, dt) < 7) { p.st = 1; p.t = 0; } place(p.e, p.x, p.y, 0, 1); return; }
    p.t += dt; place(p.e, HBT.x + DOCKS[p.slot][0] + Math.sin(tm / 300 + p.slot * 2) * 1.6, HBT.y + DOCKS[p.slot][1] + Math.cos(tm / 360 + p.slot) * 1.6, 0, 1);
    if (p.t > 4 + 8 * clamp(sm.shift)) { p.st = 2; p.t = 0; }
  });
  /* buffer fluid hunts docked acid and neutralises it */
  if (sm.corr > 0.4) { acc.buf += dt * 6; while (acc.buf >= 1) { acc.buf--; const p = free(bufP); if (p) emit(p, 912, rnd(300, 360)); } }
  bufP.forEach((p) => {
    if (!p.on) return;
    if (p.st === 1) { p.e.setAttribute("opacity", clamp(1 - p.t * 2).toFixed(2)); p.t += dt; if (p.t > 0.5) kill(p); return; }
    let tgt = null, bd = 1e9;
    acidP.forEach((a) => { if (!a.on || a.st === 2) return; const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; tgt = a; } });
    const tx = tgt ? tgt.x : HBT.x + 44, ty = tgt ? tgt.y : HBT.y + 22;
    if (moveToward(p, tx, ty, 150, dt) < 9) { if (tgt) { tgt.st = 2; tgt.t = 0; } kill(p); return; }
    place(p.e, p.x, p.y, 0, 1);
  });
  gg.aff.set(sm.affinity, wordOf(sm.affinity, 0.33, 0.66, ["low", "normal", "high"]));
  gg.p50.set(sm.p50v, wordOf(sm.p50v, 0.33, 0.66, ["low", "normal", "high"]));
  gg.load.set(sm.load, wordOf(sm.load, 0.86, 0.93, ["reduced", "good", "full"]));
  gg.rel.set(sm.release, wordOf(sm.release, 0.33, 0.66, ["low", "normal", "high"]));
  gg.drv.set(sm.driverR, wordOf(sm.driverR, 0.33, 0.66, ["low", "normal", "high"]));
  const key = level + ":" + drug; if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
