/* Pneumothorax scene: pleural air, collapsing organ lung, one-way valve, mediastinal shift, venous return and gauges.
 * The healthy lung and the affected lung are organ art; the heart is organ art. Bronchi meet the lung
 * hilum ports, the vein runs into the shifting heart, and the drain tube visibly removes pleural air. */
const LAY = { air: $("airspace"), media: $("media"), lungL: $("lungSlotL"), lungR: $("lungSlotR"), heart: $("heartSlot"), shade: $("shade"), parts: $("parts"), drain: $("drainG"), over: $("over"), panel: $("panel") };
const DYN = {};
const gg = {};
const LX = 280, LY = 252, RX = 665, RY = 252, HX = 468, HY = 322;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const airDots = pool(26, () => mk("circle", { class: "sc-p p-air", r: 3.2 }, LAY.parts));
const outDots = pool(10, () => mk("circle", { class: "sc-p p-out", r: 3 }, LAY.parts));
const oxyDots = pool(12, () => mk("circle", { class: "sc-p p-oxy", r: 3 }, LAY.parts));
let venDots = [];
function capText(d, l) {
  if (d === 2) return "Chest drain. Trapped air leaves through the tube and the lung re-expands.";
  if (d === 1) return "Oxygen supports blood oxygen but the trapped air stays put.";
  if (l === 2) return "No treatment. Air builds up, the lung collapses and the heart is pushed away.";
  return "No treatment. Air in the pleural space collapses the lung.";
}
function init() {
  DYN.airEl = mk("ellipse", { class: "pt-air", cx: 780, cy: 255, rx: 70, ry: 125, opacity: "0.18" }, LAY.air);
  DYN.lungL = organ(LAY.lungL, "lung", LX, LY, 200, { flip: true });
  DYN.lungR = organ(LAY.lungR, "lung", RX, RY, 200, {});
  DYN.hilL = DYN.lungL.ports.in.slice();
  DYN.hilR = DYN.lungR.ports.in.slice();
  DYN.locHilR = [DYN.hilR[0] - RX, DYN.hilR[1] - RY];
  const ap = DYN.lungR.ports.apex;
  DYN.locBleb = [ap[0] - RX, ap[1] - RY];
  DYN.heartO = organ(LAY.heart, "heart", HX, HY, 140, {});
  DYN.trach = mk("path", { class: "pt-trach", d: "M480 84L480 205", fill: "none" }, LAY.media);
  DYN.trach2 = mk("path", { class: "pt-trach2", d: "M480 84L480 205", fill: "none" }, LAY.media);
  DYN.bronL = mk("path", { class: "pt-bronch", d: "M480 205L288 260", fill: "none" }, LAY.media);
  DYN.bronR = mk("path", { class: "pt-bronch", d: "M480 205L657 254", fill: "none" }, LAY.media);
  DYN.vein = mk("path", { class: "pt-vein", d: "M445 190L445 228", fill: "none" }, LAY.media);
  DYN.vein2 = mk("path", { class: "pt-vein2", d: "M445 190L445 228", fill: "none" }, LAY.media);
  DYN.ivc = mk("path", { class: "pt-vein", d: "M445 414L445 434", fill: "none" }, LAY.media);
  venDots = pool(12, () => mk("circle", { class: "sc-p p-ven", r: 3 }, LAY.media));
  DYN.shadeEl = mk("ellipse", { class: "pt-shade", cx: 665, cy: 252, rx: 60, ry: 80, opacity: "0" }, LAY.shade);
  DYN.bleb = mk("circle", { class: "pt-bleb", cx: 660, cy: 130, r: 11 }, LAY.shade);
  mk("circle", { class: "pt-hole", cx: 851, cy: 185, r: 7 }, LAY.parts);
  DYN.flap = mk("path", { class: "pt-flap", d: "M851 178L838 196", fill: "none" }, LAY.parts);
  const dg = LAY.drain; dg.setAttribute("opacity", "0");
  mk("path", { class: "pt-drain", d: "M795 300L870 378", fill: "none" }, dg);
  mk("rect", { class: "pt-drainbox", x: 864, y: 372, width: 36, height: 44, rx: 6 }, dg);
  mk("path", { class: "pt-drain", d: "M882 378V402", fill: "none" }, dg);
  const ox = LAY.over;
  pill(ox, "Healthy lung", 235, 230, 170, 108, "The other lung keeps working. It rises and falls a little with each breath.");
  DYN.trachPill = pill(ox, "Windpipe", 480, 120, 392, 72, "Windpipe. In tension it is pushed away from the side with air, a late and important sign.");
  const vp = pill(ox, "One-way valve", 845, 178, 700, 72, "In tension, the entry works as a one-way valve. Air comes in as the patient breathes in but cannot get out, so pressure keeps rising."); vp.setAttribute("id", "valve-pill");
  pill(ox, "Collapsed lung", 660, 250, 700, 140, "The affected lung recoils and collapses toward its hilum once air breaks its seal with the chest wall. A small bleb on its surface can be the source of the air.");
  pill(ox, "Pleural air", 810, 300, 812, 252, "Air trapped in the pleural space between lung and chest wall. The more air, the higher the pleural pressure and the more the lung collapses.");
  DYN.heartPill = pill(ox, "Heart and veins", 500, 345, 430, 410, "In tension the shifted mediastinum presses on the heart and great veins. Venous return falls, cardiac output falls and shock follows.");
  const dp = pill(ox, "Chest drain", 830, 345, 716, 412, "Needle decompression lets trapped air out at once in tension. A chest drain then keeps removing air so the lung can re-expand and seal."); dp.setAttribute("id", "drain-pill");
  DYN.capEl = mk("text", { class: "pt-cap", x: 30, y: 444 }, ox); DYN.capEl.textContent = capText(0, level);
  DYN.capKey = -1;
  const P = LAY.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["air", "Pleural air", "g-air", "How much air is trapped in the pleural space. It rises with size and, in tension, with every breath."], ["coll", "Lung collapse", "g-coll", "How far the lung has recoiled and collapsed. A collapsed lung takes part poorly in gas exchange."], ["shift", "Shift", "g-shift", "How far the windpipe, heart and mediastinum are pushed away from the affected side. Marked shift means tension."], ["vr", "Venous return", "g-good", "Blood returning to the heart through the great veins. Shift and pressure squeeze the veins, so return falls."], ["bp", "Blood pressure", "g-good", "Systemic blood pressure. It falls when venous return and cardiac output fall, causing obstructive shock."], ["ox", "Oxygen", "g-cyt", "Oxygen level in the blood. It falls as the lung collapses; extra oxygen can support it but does not remove pleural air."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  DYN.bronL.setAttribute("d", "M480 205L" + f1(DYN.hilL[0]) + " " + f1(DYN.hilL[1]));
  DYN.bronR.setAttribute("d", "M480 205L" + f1(DYN.hilR[0]) + " " + f1(DYN.hilR[1]));
}
const sm = { A: 0.4, P: 0.3, C: 0.4, Sh: 0, VR: 0.9, BP: 0.9, Ox: 0.8, drain: 0, oxy: 0, valve: 0 };
const acc = { air: 0, out: 0, oxy: 0, ven: 0 };
let beatPh = 0;
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.A = lerp(sm.A, m.A, k1); sm.C = lerp(sm.C, m.C, k1); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.drain = lerp(sm.drain, m.drain, k1); sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.valve = lerp(sm.valve, m.valve, k1);
  sm.P = lerp(sm.P, m.P, k2); sm.VR = lerp(sm.VR, m.VR, k2); sm.BP = lerp(sm.BP, m.BP, k2); sm.Ox = lerp(sm.Ox, m.Ox, k2);
  const breath = Math.sin(tm / 900), shiftPx = -58 * sm.Sh;
  const carX = 480 + shiftPx, veinX = 445 + shiftPx;
  DYN.trach.setAttribute("d", "M480 84L" + f1(carX) + " 205");
  DYN.trach2.setAttribute("d", "M480 84L" + f1(carX) + " 205");
  DYN.bronL.setAttribute("d", "M" + f1(carX) + " 205L" + f1(DYN.hilL[0]) + " " + f1(DYN.hilL[1]));
  DYN.bronR.setAttribute("d", "M" + f1(carX) + " 205L" + f1(DYN.hilR[0]) + " " + f1(DYN.hilR[1]));
  DYN.vein.setAttribute("d", "M445 190L" + f1(veinX) + " 228");
  DYN.vein2.setAttribute("d", "M445 190L" + f1(veinX) + " 228");
  DYN.ivc.setAttribute("d", "M" + f1(veinX) + " 414L" + f1(veinX) + " 434");
  const pinch = 1 - 0.55 * sm.Sh;
  DYN.vein.setAttribute("stroke-width", f1(13 * pinch));
  DYN.ivc.setAttribute("stroke-width", f1(13 * pinch));
  if (DYN.trachPill) DYN.trachPill.setAttribute("transform", "translate(" + f1(shiftPx) + " 0)");
  if (DYN.heartPill) DYN.heartPill.setAttribute("transform", "translate(" + f1(shiftPx) + " 0)");
  DYN.airEl.setAttribute("rx", f1(40 + 60 * sm.A)); DYN.airEl.setAttribute("ry", f1(100 + 50 * sm.A)); DYN.airEl.setAttribute("opacity", (0.08 + 0.28 * sm.A).toFixed(2));
  const nScale = 1 + 0.022 * breath;
  DYN.lungL.g.setAttribute("transform", "translate(" + LX + " " + LY + ") scale(" + nScale.toFixed(3) + ")");
  const s = (1 - 0.55 * sm.C) * (1 + 0.012 * breath);
  const Tx = DYN.hilR[0] - s * DYN.locHilR[0], Ty = DYN.hilR[1] - s * DYN.locHilR[1];
  DYN.lungR.g.setAttribute("transform", "translate(" + f1(Tx) + " " + f1(Ty) + ") scale(" + s.toFixed(3) + ")");
  DYN.shadeEl.setAttribute("cx", f1(Tx)); DYN.shadeEl.setAttribute("cy", f1(Ty));
  DYN.shadeEl.setAttribute("rx", f1(100 * s)); DYN.shadeEl.setAttribute("ry", f1(133 * s));
  DYN.shadeEl.setAttribute("opacity", (0.45 * sm.C).toFixed(2));
  DYN.bleb.setAttribute("cx", f1(Tx + s * DYN.locBleb[0])); DYN.bleb.setAttribute("cy", f1(Ty + s * DYN.locBleb[1]));
  DYN.bleb.setAttribute("opacity", (1 - 0.5 * sm.drain).toFixed(2));
  beatPh += dt * (1.2 + 1.2 * (1 - sm.VR));
  const ph = beatPh % 1, cb = ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : 0;
  const hk = (0.9 + 0.1 * sm.VR) * (1 + 0.05 * cb * sm.VR);
  DYN.heartO.g.setAttribute("transform", "translate(" + f1(HX + shiftPx) + " " + HY + ") scale(" + hk.toFixed(3) + ")");
  DYN.heartO.g.style.filter = sm.Sh > 0.02 ? "drop-shadow(0 0 " + f1(sm.Sh * 9) + "px var(--c-bad))" : "none";
  DYN.flap.setAttribute("transform", "rotate(" + f1(sm.valve * (breath > 0 ? -24 : 8)) + " 851 185)");
  DYN.flap.setAttribute("opacity", (0.25 + 0.75 * Math.max(sm.valve, sm.drain * 0.4)).toFixed(2));
  $("valve-pill").style.opacity = sm.valve.toFixed(2);
  LAY.drain.setAttribute("opacity", sm.drain.toFixed(2)); $("drain-pill").style.opacity = sm.drain.toFixed(2);
  const edgeX = Tx + 100 * s + 8;
  acc.air += dt * (0.5 + 7 * sm.A) * (breath > -0.2 ? 1 : 0.35);
  while (acc.air >= 1) { acc.air--; const p = free(airDots); if (p) emit(p, 848, 188, rnd(-28, -16), rnd(-4, 10), 0); }
  airDots.forEach((p) => { if (!p.on) return; p.t += dt;
    if (sm.drain > 0.55) { p.x += (795 - p.x) * dt * 1.6; p.y += (300 - p.y) * dt * 1.6; if (Math.hypot(795 - p.x, 300 - p.y) < 12) kill(p); }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx += rnd(-6, 6) * dt; p.vy += rnd(-6, 6) * dt; p.vx = clamp(p.vx, -22, 22); p.vy = clamp(p.vy, -18, 18);
      if (p.x < edgeX) { p.x = edgeX; p.vx = Math.abs(p.vx); } if (p.x > 858) { p.x = 858; p.vx = -Math.abs(p.vx); } if (p.y < 118) { p.y = 118; p.vy = Math.abs(p.vy); } if (p.y > 392) { p.y = 392; p.vy = -Math.abs(p.vy); } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 9) kill(p); });
  acc.out += dt * sm.drain * 7; while (acc.out >= 1) { acc.out--; const p = free(outDots); if (p) emit(p, 795, 300, 0, 0, Math.random()); }
  outDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.9; const u = p.t % 1; p.e.setAttribute("transform", "translate(" + f1(795 + 75 * u) + " " + f1(300 + 78 * u) + ")"); if (p.t > 1.1) kill(p); });
  acc.oxy += dt * sm.oxy * 6; while (acc.oxy >= 1) { acc.oxy--; const p = free(oxyDots); if (p) emit(p, 480, 96, 0, 0, Math.random()); }
  oxyDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.55; const u = p.t % 1; const x = u < 0.55 ? lerp(480, carX, u / 0.55) : lerp(carX, DYN.hilL[0], (u - 0.55) / 0.45), y = u < 0.55 ? lerp(96, 205, u / 0.55) : lerp(205, DYN.hilL[1], (u - 0.55) / 0.45); p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); if (p.t > 1.2) kill(p); });
  acc.ven += dt * (0.4 + 3.4 * sm.VR); while (acc.ven >= 1) { acc.ven--; const p = free(venDots); if (p) emit(p, veinX, 192, 0, 0, Math.random()); }
  venDots.forEach((p) => { if (!p.on) return; p.t += dt * (0.25 + 0.55 * sm.VR); const u = p.t % 1; p.e.setAttribute("transform", "translate(" + f1(veinX) + " " + f1(lerp(192, 226, u)) + ")"); if (p.t > 1.3) kill(p); });
  gg.air.set(sm.A, wordOf(sm.A, 0.35, 0.7, ["small", "moderate", "large"])); gg.coll.set(sm.C, wordOf(sm.C, 0.35, 0.68, ["mild", "partial", "severe"])); gg.shift.set(sm.Sh, wordOf(sm.Sh, 0.2, 0.55, ["none", "some", "marked"]));
  gg.vr.set(sm.VR, wordOf(sm.VR, 0.35, 0.65, ["low", "reduced", "good"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.62, ["low", "borderline", "ok"])); gg.ox.set(sm.Ox, wordOf(sm.Ox, 0.45, 0.7, ["low", "reduced", "good"]));
  const key = drug * 10 + level; if (key !== DYN.capKey) { DYN.capKey = key; const t = capText(drug, level); if (DYN.capEl.textContent !== t) DYN.capEl.textContent = t; }
}
run({ init, step });
