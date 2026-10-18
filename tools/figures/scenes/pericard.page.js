/* Pericarditis scene: a real heart inside the pericardial sac. Inflammation reddens the
 * sac, fibrin roughens the heart surface, fluid can wedge the layers apart, and a stiff
 * shell can encase the heart. Tablets coat the layers, colchicine dots sit on immune
 * cells, and drainage draws fluid off through a needle. */
const HX = SC.HX, HY = SC.HY;
const LAY = { sac: $("sac"), flush: $("flush"), fluid: $("fluid"), inner: $("inner"), fibrin: $("fibrin"), coat: $("coat"), cells: $("cells"), parts: $("parts"), signs: $("signs"), over: $("over"), panel: $("panel") };
const DYN = {};
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freePool = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const tabDots = pool(24, () => mk("circle", { class: "sc-p p-tab", r: 3 }, LAY.parts));
const colDots = pool(12, () => mk("circle", { class: "sc-p p-col", r: 2.6 }, LAY.parts));
const fibDots = pool(12, () => mk("rect", { class: "sc-p p-fib", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, LAY.parts));
const outDots = pool(12, () => mk("circle", { class: "sc-p p-out", r: 3 }, LAY.parts));
const outTrack = track([[248, 328], [218, 360], [188, 394]]);
const cellRing = [];
let heartO = null, capEl = null, capKey = "";
const coatDots = [], dockDots = [];
function capText(l, d) {
  if (d === 3) {
    if (l === 1) return "Anti-inflammatory treatment. It calms the layers, though fluid still squeezes.";
    if (l === 2) return "Anti-inflammatory treatment. It eases the inflamed shell so filling improves.";
    return "Anti-inflammatory treatment. It calms the layers so pain and the ECG settle.";
  }
  if (d === 2) {
    if (l === 0) return "Colchicine concept. It quiets immune cells so inflammation fades.";
    if (l === 2) return "Colchicine concept. It quiets immune cells and eases the stiff shell a little.";
    return "Colchicine concept. It quiets immune cells, though fluid still squeezes.";
  }
  if (d === 1) {
    if (l === 1) return "Drainage. The needle draws fluid off so the heart can fill again.";
    return "Drainage. There is little fluid to draw off at this stage.";
  }
  if (l === 1) return "No treatment. Fluid wedges the layers apart and squeezes the heart.";
  if (l === 2) return "No treatment. A stiff shell stops the heart filling freely.";
  return "No treatment. Both layers are inflamed and grate with each beat.";
}
function init() {
  DYN.pari = mk("ellipse", { class: "pc-parietal", cx: HX, cy: HY, rx: 162, ry: 126 }, LAY.sac);
  DYN.shellCold = mk("ellipse", { class: "pc-shell", cx: HX, cy: HY, rx: 168, ry: 132, opacity: "0.2" }, LAY.sac);
  DYN.shellHot = mk("ellipse", { class: "pc-shellhot", cx: HX, cy: HY, rx: 168, ry: 132, opacity: "0.2" }, LAY.sac);
  DYN.flush = mk("ellipse", { class: "pc-flush", cx: HX, cy: HY, rx: 158, ry: 122, opacity: "0.3" }, LAY.flush);
  DYN.flu = mk("ellipse", { class: "pc-fluid", cx: HX, cy: HY, rx: 124, ry: 94, opacity: "0.3" }, LAY.fluid);
  heartO = organ($("heartSlot"), "heart", HX, HY, 150, {});
  const hw = heartO.w / 2, hh = heartO.h / 2;
  mk("ellipse", { class: "pc-inner", cx: HX, cy: HY, rx: f1(hw + 5), ry: f1(hh + 5) }, LAY.inner);
  for (let i = 0; i < 16; i++) {
    const an = (i / 16) * 6.283, fx = HX + Math.cos(an) * (hw + 11), fy = HY + Math.sin(an) * (hh + 11);
    const zig = "M" + f1(fx - 7) + " " + f1(fy) + "l5 -6l5 7l5 -5";
    const pth = mk("path", { class: "pc-fib", d: zig }, LAY.fibrin);
    pth.setAttribute("transform", "rotate(" + f1(an * 57.3 + 90) + " " + f1(fx) + " " + f1(fy) + ")");
  }
  for (let i = 0; i < 9; i++) {
    const an = (i / 9) * 6.283 + 0.3;
    const cg = cell(LAY.cells, { cls: i % 2 ? "neut" : "mac", r: i % 2 ? 9 : 12, nuc: 0.45, seed: i * 3 + 1, wob: 0.13 });
    cellRing.push({ g: cg, an, ph: i * 1.3 });
  }
  for (let i = 0; i < 22; i++) coatDots.push(mk("circle", { class: "sc-p p-tab", r: 3.4, opacity: "0" }, LAY.coat));
  for (let i = 0; i < 9; i++) dockDots.push(mk("circle", { class: "sc-p p-col", r: 3, opacity: "0" }, LAY.coat));
  const dg = mk("g", { id: "drainG", opacity: "0" }, LAY.parts); DYN.drainG = dg;
  mk("path", { class: "pc-needle", d: "M188 394L248 328" }, dg);
  mk("rect", { class: "pc-syr", x: 162, y: 386, width: 30, height: 13, rx: 3, transform: "rotate(-48 177 392)" }, dg);
  const sg = LAY.signs;
  mk("rect", { class: "pc-box", x: 600, y: 108, width: 330, height: 128, rx: 10 }, sg);
  for (let gx = 618; gx <= 912; gx += 18) mk("path", { class: "pc-grid", d: "M" + gx + " 112V232" }, sg);
  for (let gy = 126; gy <= 232; gy += 18) mk("path", { class: "pc-grid", d: "M604 " + gy + "H926" }, sg);
  mk("path", { class: "pc-baseline", d: "M610 188H920" }, sg);
  DYN.trace = mk("path", { class: "pc-trace", d: "M610 188H920" }, sg);
  mk("rect", { class: "pc-box", x: 600, y: 268, width: 330, height: 112, rx: 10 }, sg);
  mk("rect", { class: "pc-torso", x: 632, y: 292, width: 76, height: 68, rx: 16 }, sg);
  mk("circle", { class: "pc-heartdot", cx: 678, cy: 322, r: 10 }, sg);
  DYN.rays = [];
  [[652, 302], [668, 296], [694, 298], [704, 312], [650, 338]].forEach(([x, y]) => { DYN.rays.push(mk("path", { class: "pc-ray", d: "M" + f1(678 + (x - 678) * 0.45) + " " + f1(322 + (y - 322) * 0.45) + "L" + x + " " + y }, sg)); });
  mk("circle", { class: "pc-torso", cx: 838, cy: 296, r: 11 }, sg);
  mk("path", { class: "pc-lean", d: "M838 307L818 330L800 330M818 330L812 356M818 330L838 348L856 348M830 316L806 326" }, sg);
  DYN.leanArrow = mk("path", { class: "pc-arrow", d: "M872 292C858 282 842 280 830 284M830 284l10 1M830 284l3 -9" }, sg);
  const ox = LAY.over;
  pill(ox, "Heart", 320, 300, 430, 400, "Heart: the muscular pump. The pericardium wraps the heart and its great vessels.");
  pill(ox, "Outer layer", 200, 140, 150, 82, "Outer layer of the sac. In acute pericarditis it is inflamed along with the inner layer.");
  pill(ox, "Inner layer", 362, 235, 472, 148, "Inner layer stuck to the heart surface. Roughened with fibrin, it grates and gives the rub.");
  pill(ox, "Effusion", 170, 290, 95, 300, "Fluid between the layers. It parts the surfaces so pain and the rub may fade, but a large effusion can squeeze the heart.");
  pill(ox, "Stiff shell", 420, 320, 470, 372, "Healed, thickened pericardium. This stiff shell encases the heart and stops it filling freely.");
  const dp = pill(ox, "Drainage", 218, 361, 140, 400, "Drainage draws fluid from the sac and relieves squeezing. It does not calm inflammation or soften a stiff shell."); dp.setAttribute("id", "drain-pill");
  pill(ox, "ECG", 762, 176, 765, 94, "Widespread ST elevation with a PR dip, seen across many leads because the whole surface is inflamed.");
  pill(ox, "Chest pain", 678, 322, 688, 254, "Sharp pain, worse breathing in and lying flat. Sitting up and leaning forward eases it.");
  capEl = mk("text", { class: "pc-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 0);
  const P = LAY.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["inf", "Inflammation", "g-cyt", "How inflamed the pericardial layers are. Anti-inflammatory treatment and the colchicine concept bring this down."], ["pain", "Pain", "g-pain", "Pleuritic positional chest pain from the inflamed layers. It eases as inflammation settles and when leaning forward."], ["ecg", "ECG change", "g-ecg", "Diffuse ST elevation and PR depression across the ECG. It fades as the surface inflammation settles."], ["eff", "Effusion", "g-fl", "Fluid between the pericardial layers. Drainage removes it."], ["con", "Constriction", "g-con", "Thickness and stiffness of the healed pericardial shell. A high bar means the heart is encased."], ["fill", "Filling", "g-good", "How freely the heart fills. A stiff shell, and a large effusion squeezing the heart, both restrict filling."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { I: 0.8, F: 0.15, K: 0.08, Kr: 0.08, Pain: 0.7, Rub: 0.7, Ecg: 0.8, Fill: 0.85, anti: 0, colch: 0, drain: 0 };
const acc = { tab: 0, col: 0, fib: 0, out: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.I = lerp(sm.I, m.I, k2); sm.F = lerp(sm.F, m.F, k2); sm.K = lerp(sm.K, m.K, k2); sm.Kr = lerp(sm.Kr, m.Kr, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1); sm.Rub = lerp(sm.Rub, m.Rub, k2); sm.Ecg = lerp(sm.Ecg, m.Ecg, k2); sm.Fill = lerp(sm.Fill, m.Fill, k1);
  sm.anti = lerp(sm.anti, m.anti, k1); sm.colch = lerp(sm.colch, m.colch, k1); sm.drain = lerp(sm.drain, m.drain, k1);
  const beat = Math.sin(Math.min(3.14, ((tm / 850) % 1) * 3.14));
  const orx = 160 + 30 * sm.F + 4 * sm.K, ory = 124 + 24 * sm.F + 3 * sm.K;
  DYN.pari.setAttribute("rx", f1(orx)); DYN.pari.setAttribute("ry", f1(ory));
  DYN.shellCold.setAttribute("rx", f1(orx + 7)); DYN.shellCold.setAttribute("ry", f1(ory + 6));
  DYN.shellCold.setAttribute("stroke-width", f1(2 + 17 * sm.Kr)); DYN.shellCold.setAttribute("opacity", (0.12 + 0.88 * sm.Kr).toFixed(2));
  DYN.shellHot.setAttribute("rx", f1(orx + 7)); DYN.shellHot.setAttribute("ry", f1(ory + 6));
  DYN.shellHot.setAttribute("stroke-width", f1(2 + 17 * sm.Kr)); DYN.shellHot.setAttribute("opacity", clamp(sm.Kr * sm.I * 2.4).toFixed(2));
  DYN.flush.setAttribute("rx", f1(orx - 2)); DYN.flush.setAttribute("ry", f1(ory - 2)); DYN.flush.setAttribute("opacity", (0.34 * sm.I).toFixed(2));
  DYN.flu.setAttribute("rx", f1(104 + 46 * sm.F)); DYN.flu.setAttribute("ry", f1(80 + 36 * sm.F)); DYN.flu.setAttribute("opacity", (0.10 + 0.52 * sm.F).toFixed(2));
  LAY.fibrin.setAttribute("opacity", clamp(sm.Rub * 1.15).toFixed(2));
  const hScale = (1 - 0.20 * sm.Kr - 0.10 * sm.F) * (1 + (0.012 + 0.045 * sm.Fill) * beat);
  heartO.g.setAttribute("transform", "translate(" + HX + " " + HY + ") scale(" + hScale.toFixed(3) + ")");
  cellRing.forEach((c, i) => { const rr = 1 + 0.05 * Math.sin(tm / 500 + c.ph); const cx = clamp(HX + Math.cos(c.an) * (orx + 14) * rr, 36, 548), cy = clamp(HY + Math.sin(c.an) * (ory + 12) * rr, 58, 424); c.x = cx; c.y = cy; place(c.g, cx, cy, Math.sin(tm / 700 + c.ph) * 14, (0.25 + 0.75 * sm.I) * (i % 2 ? 0.9 : 1.1) * (1 - 0.28 * sm.colch)); c.g.style.opacity = (0.15 + 0.85 * sm.I).toFixed(2); });
  coatDots.forEach((e, i) => { const an = (i / coatDots.length) * 6.283 + 0.2; e.setAttribute("cx", f1(HX + Math.cos(an) * (orx + 3))); e.setAttribute("cy", f1(HY + Math.sin(an) * (ory + 3))); e.setAttribute("opacity", (sm.anti * (0.75 + 0.25 * Math.sin(tm / 600 + i * 1.7))).toFixed(2)); });
  dockDots.forEach((e, i) => { const c = cellRing[i]; e.setAttribute("cx", f1(c.x + 6)); e.setAttribute("cy", f1(c.y - 5)); e.setAttribute("opacity", sm.colch.toFixed(2)); });
  DYN.drainG.setAttribute("opacity", sm.drain.toFixed(2)); $("drain-pill").style.opacity = sm.drain.toFixed(2);
  DYN.rays.forEach((r) => r.setAttribute("opacity", (sm.Pain * (0.55 + 0.45 * beat)).toFixed(2)));
  DYN.leanArrow.setAttribute("opacity", (0.25 + 0.75 * sm.Pain).toFixed(2));
  let td = "";
  for (let i = 0; i <= 62; i++) {
    const x = 612 + i * 5, cyc = ((x - 612 + (tm / 9) % 62) % 62) / 62;
    let y = 188;
    y += -3.2 * sm.Ecg * Math.exp(-Math.pow((cyc - 0.16) * 9, 2));
    y += -26 * Math.exp(-Math.pow((cyc - 0.30) * 16, 2)) + 7 * Math.exp(-Math.pow((cyc - 0.36) * 18, 2));
    y += -13 * sm.Ecg * Math.exp(-Math.pow((cyc - 0.52) * 6, 2));
    y += -5 * Math.exp(-Math.pow((cyc - 0.62) * 10, 2)) * (0.4 + 0.6 * sm.Ecg);
    td += (i ? "L" : "M") + f1(x) + " " + f1(clamp(y, 116, 230));
  }
  DYN.trace.setAttribute("d", td);
  acc.tab += dt * sm.anti * 7; while (acc.tab >= 1) { acc.tab--; const p = freePool(tabDots); if (p) emit(p, rnd(120, 450), 62, rnd(-6, 6), rnd(24, 46), 0); }
  tabDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4 || p.x < 30 || p.x > 556 || p.y < 54 || p.y > 430) kill(p); });
  acc.col += dt * sm.colch * 5; while (acc.col >= 1) { acc.col--; const p = freePool(colDots); if (p) emit(p, rnd(120, 450), 62, rnd(-6, 6), rnd(20, 40), 0); }
  colDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4 || p.x < 30 || p.x > 556 || p.y < 54 || p.y > 430) kill(p); });
  acc.fib += dt * sm.Rub * 4; while (acc.fib >= 1) { acc.fib--; const p = freePool(fibDots); if (p) { const an = rnd(0, 6.28); emit(p, HX + Math.cos(an) * (heartO.w / 2 + 8), HY + Math.sin(an) * (heartO.h / 2 + 8), rnd(-8, 8), rnd(-8, 8), 0); } }
  fibDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || p.x < 30 || p.x > 556 || p.y < 54 || p.y > 430) kill(p); });
  acc.out += dt * sm.drain * sm.F * 7 + dt * sm.drain * 1.2; while (acc.out >= 1) { acc.out--; const p = freePool(outDots); if (p) emit(p, 0, 0, 0, 0, Math.random()); }
  outDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.75; const q = outTrack.at(p.t % 1); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.t > 1.2) kill(p); });
  gg.inf.set(sm.I, wordOf(sm.I, 0.3, 0.62, ["settled", "active", "intense"])); gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.3, 0.62, ["mild", "present", "sharp"])); gg.ecg.set(sm.Ecg, wordOf(sm.Ecg, 0.3, 0.62, ["normal", "mild change", "marked"]));
  gg.eff.set(sm.F, wordOf(sm.F, 0.3, 0.62, ["none", "some", "large"])); gg.con.set(sm.Kr, wordOf(sm.Kr, 0.3, 0.62, ["supple", "stiffening", "rigid"])); gg.fill.set(sm.Fill, wordOf(sm.Fill, 0.35, 0.65, ["poor", "reduced", "good"]));
  const ck = level + ":" + drug; if (ck !== capKey) { capKey = ck; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
