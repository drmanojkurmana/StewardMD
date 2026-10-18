/* OHB scene: dissociation curve, lung loading, tissue unloading, driver chips and gauges. */
const GX0 = 118, GX1 = 518, GY0 = 100, GY1 = 338, GW = GX1 - GX0, GH = GY1 - GY0, MIDY = (GY0 + GY1) / 2;
const L = { chart: $("chart"), lung: $("lung"), tissue: $("tissue"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { shift: 0, load: 0.9, release: 0.5, satT: 0.5, affinity: 0.5, p50v: 0.5, driverR: 0.5, driverL: 0.5 };
const acc = { o2l: 0, o2t: 0, co2: 0 };
let cur = {}, lungHb = null, tisHb = null, leftChips = [], rightChips = [], gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const o2l = pool(14, () => mk("circle", { class: "sc-p p-o2", r: 3 }, L.parts));
const o2t = pool(14, () => mk("circle", { class: "sc-p p-o2", r: 3 }, L.parts));
const co2p = pool(12, () => mk("circle", { class: "sc-p p-co2", r: 2.6 }, L.parts));
function hill(u, p50) { const n = 2.7, a = Math.pow(u, n), b = Math.pow(p50, n); return a / (a + b); }
function curveD(p50) { let d = ""; for (let i = 0; i <= 50; i++) { const u = i / 50, x = GX0 + u * GW, y = GY1 - hill(u, p50) * GH; d += (i ? "L" : "M") + f1(x) + " " + f1(y); } return d; }
function makeHb(parent, cx, cy) {
  const g = mk("g", {}, parent), dots = [], offs = [[-11, -10], [11, -10], [-11, 10], [11, 10]];
  offs.forEach(([dx, dy], i) => { const c = cell(g, { cls: "hb", r: 13, nuc: 0, seed: i * 2 + 1, wob: 0.12, n: 8 }); c.setAttribute("transform", "translate(" + f1(cx + dx) + " " + f1(cy + dy) + ")"); });
  offs.forEach(([dx, dy]) => { const d = mk("circle", { class: "oh-o2dot", cx: f1(cx + dx), cy: f1(cy + dy), r: 3.4, opacity: "1" }, g); dots.push(d); });
  return { g, dots };
}
function chip(parent, x, y, w, text, cls, tip) {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, parent);
  mk("rect", { class: cls, x: x, y: y, width: w, height: 18, rx: 9 }, g);
  const t = mk("text", { class: "oh-chip-t", x: f1(x + w / 2), y: y + 13, "text-anchor": "middle" }, g); t.textContent = text;
  return g;
}
function initChart() {
  const C = L.chart;
  [0.25, 0.5, 0.75].forEach((f) => { const y = GY1 - f * GH; mk("path", { class: "oh-grid", d: "M" + GX0 + " " + f1(y) + "H" + GX1 }, C); });
  [0.25, 0.5, 0.75].forEach((f) => { const x = GX0 + f * GW; mk("path", { class: "oh-grid", d: "M" + f1(x) + " " + GY0 + "V" + GY1 }, C); });
  mk("path", { class: "oh-axis", d: "M" + GX0 + " " + GY0 + "V" + GY1 + "H" + GX1 }, C);
  const yl = mk("text", { class: "oh-lab", x: 84, y: MIDY, "text-anchor": "middle", transform: "rotate(-90 84 " + MIDY + ")" }, C); yl.textContent = "Haemoglobin saturation";
  const xl = mk("text", { class: "oh-lab", x: 318, y: 374, "text-anchor": "middle" }, C); xl.textContent = "Oxygen partial pressure";
  const lo = mk("text", { class: "oh-dim", x: GX0, y: 356, "text-anchor": "middle" }, C); lo.textContent = "low";
  const hi = mk("text", { class: "oh-dim", x: GX1, y: 356, "text-anchor": "middle" }, C); hi.textContent = "high";
  const sh = mk("text", { class: "oh-dim", x: 108, y: 104, "text-anchor": "end" }, C); sh.textContent = "high";
  const sl = mk("text", { class: "oh-dim", x: 108, y: 338, "text-anchor": "end" }, C); sl.textContent = "low";
  [0.3, 0.42, 0.55].forEach((p) => mk("path", { class: "oh-ref", d: curveD(p) }, C));
  cur.act = mk("path", { class: "oh-act", d: curveD(0.42) }, C);
  cur.vl = mk("path", { class: "oh-p50l", d: "" }, C);
  cur.hl = mk("path", { class: "oh-p50l", d: "" }, C);
  cur.dot = mk("circle", { class: "oh-p50d", cx: GX0 + 0.42 * GW, cy: MIDY, r: 5.5 }, C);
  cur.lab = mk("text", { class: "oh-lab", x: 435, y: 262, "text-anchor": "middle" }, C); cur.lab.textContent = "normal";
}
function initPanels() {
  lungHb = makeHb(L.lung, 652, 152);
  mk("circle", { class: "oh-alv", cx: 838, cy: 152, r: 32 }, L.lung);
  [[826, 140], [842, 136], [852, 150], [832, 160], [848, 164]].forEach(([x, y]) => mk("circle", { class: "sc-p p-o2", cx: x, cy: y, r: 3 }, L.lung));
  mk("path", { class: "oh-arrow", d: "M802 152H692" }, L.lung);
  mk("path", { class: "oh-ah", d: "M692 152l10 -5v10Z" }, L.lung);
  leftChips = [
    chip(L.lung, 586, 196, 78, "fetal Hb", "oh-chip-l", "Fetal haemoglobin binds oxygen more tightly than adult haemoglobin, shifting the curve left."),
    chip(L.lung, 672, 196, 44, "CO", "oh-chip-l", "Carbon monoxide binds haemoglobin very tightly and shifts the curve left, so less oxygen is released."),
    chip(L.lung, 724, 196, 84, "alkalosis", "oh-chip-l", "Alkalosis, a low hydrogen ion level, raises affinity and shifts the curve left."),
  ];
  tisHb = makeHb(L.tissue, 652, 330);
  const tc = cell(L.tissue, { cls: "tcell", r: 28, nuc: 0.4, seed: 5, wob: 0.1, n: 9 }); tc.setAttribute("transform", "translate(838 334)");
  mk("path", { class: "oh-arrow", d: "M692 334H800" }, L.tissue);
  mk("path", { class: "oh-ah", d: "M800 334l-10 -5v10Z" }, L.tissue);
  rightChips = [
    chip(L.tissue, 586, 368, 48, "CO2", "oh-chip-r", "Raised carbon dioxide lowers affinity through the Bohr effect and shifts the curve right."),
    chip(L.tissue, 642, 368, 78, "H+ acid", "oh-chip-r", "Raised hydrogen ions, acid, lower affinity and shift the curve right. This is the Bohr effect."),
    chip(L.tissue, 728, 368, 52, "heat", "oh-chip-r", "Raised temperature in active tissue lowers affinity and shifts the curve right."),
    chip(L.tissue, 788, 368, 74, "2,3-BPG", "oh-chip-r", "Raised 2,3-BPG inside red cells lowers affinity and shifts the curve right."),
  ];
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
  pill(o, "Sigmoid curve", 185, 305, 180, 120, "The S shape comes from cooperativity: binding gets easier as more oxygen binds, and release gets easier as oxygen leaves.");
  pill(o, "P50", 286, 219, 168, 204, "P50 is the oxygen partial pressure at half saturation. Right shift raises P50 and lowers affinity; left shift lowers P50 and raises affinity.");
  pill(o, "Cooperativity", 318, 182, 442, 318, "Cooperativity: the four subunits of haemoglobin influence each other, so the curve steepens in its middle range.");
  pill(o, "Haemoglobin", 652, 152, 652, 104, "Haemoglobin, four subunits in each red cell. Yellow dots show bound oxygen. It loads in the lungs and unloads in the tissues.");
  pill(o, "Alveolus", 838, 152, 852, 104, "The alveolus in the lung. Oxygen partial pressure is high here, so haemoglobin loads almost fully.");
  pill(o, "Bohr effect", 676, 334, 668, 290, "The Bohr effect: carbon dioxide and hydrogen ions from active tissues lower affinity, shift the curve right and help release oxygen where it is needed.");
  pill(o, "Unloading", 838, 334, 852, 290, "Unloading in the tissues. Oxygen partial pressure is lower here, so haemoglobin releases oxygen to the tissue cell.");
}
function init() { initChart(); initPanels(); initPanel(); initPills(); }
function setDots(hb, bound) { hb.dots.forEach((d, i) => d.setAttribute("opacity", clamp(bound * 4 - i, 0, 1).toFixed(2))); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.shift = lerp(sm.shift, m.eff, k); sm.load = lerp(sm.load, m.load, k); sm.release = lerp(sm.release, m.release, k); sm.satT = lerp(sm.satT, m.satT, k); sm.affinity = lerp(sm.affinity, m.affinity, k); sm.p50v = lerp(sm.p50v, m.p50v, k); sm.driverR = lerp(sm.driverR, m.driverR, k); sm.driverL = lerp(sm.driverL, m.driverL, k);
  const p50u = 0.42 + sm.shift * 0.13, px = GX0 + p50u * GW;
  cur.act.setAttribute("d", curveD(p50u));
  cur.act.style.stroke = sm.shift > 0.18 ? "var(--c-bad)" : sm.shift < -0.18 ? "var(--c-lymph)" : "var(--c-good)";
  cur.dot.setAttribute("cx", f1(px)); cur.dot.setAttribute("cy", f1(MIDY));
  cur.vl.setAttribute("d", "M" + f1(px) + " " + MIDY + "V" + GY1); cur.hl.setAttribute("d", "M" + GX0 + " " + MIDY + "H" + f1(px));
  const lab = sm.shift > 0.3 ? "right shift" : sm.shift < -0.3 ? "left shift" : "normal"; if (cur.lab.textContent !== lab) cur.lab.textContent = lab;
  setDots(lungHb, sm.load); setDots(tisHb, sm.satT);
  leftChips.forEach((g) => { g.style.opacity = (0.22 + 0.78 * clamp(-sm.shift)).toFixed(2); });
  rightChips.forEach((g) => { g.style.opacity = (0.22 + 0.78 * clamp(sm.shift)).toFixed(2); });
  acc.o2l += dt * (2 + 6 * sm.load); while (acc.o2l >= 1) { acc.o2l--; const p = free(o2l); if (p) emit(p, 800, rnd(142, 162), -56, rnd(-4, 4), 0); }
  o2l.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.y = clamp(p.y, 124, 180); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 682) kill(p); });
  acc.o2t += dt * (2 + 7 * sm.release); while (acc.o2t >= 1) { acc.o2t--; const p = free(o2t); if (p) emit(p, 682, rnd(324, 340), 56, rnd(-4, 4), 0); }
  o2t.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.y = clamp(p.y, 306, 360); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 800) kill(p); });
  acc.co2 += dt * 7 * clamp(sm.shift); while (acc.co2 >= 1) { acc.co2--; const p = free(co2p); if (p) emit(p, 812, rnd(332, 350), -32, 20, 0); }
  co2p.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 606 || p.y > 382) kill(p); });
  gg.aff.set(sm.affinity, wordOf(sm.affinity, 0.33, 0.66, ["low", "normal", "high"]));
  gg.p50.set(sm.p50v, wordOf(sm.p50v, 0.33, 0.66, ["low", "normal", "high"]));
  gg.load.set(sm.load, wordOf(sm.load, 0.86, 0.93, ["reduced", "good", "full"]));
  gg.rel.set(sm.release, wordOf(sm.release, 0.33, 0.66, ["low", "normal", "high"]));
  gg.drv.set(sm.driverR, wordOf(sm.driverR, 0.33, 0.66, ["low", "normal", "high"]));
}
run({ init, step });
