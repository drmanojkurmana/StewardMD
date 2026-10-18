/* Pneumothorax scene: pleural air, collapsing lung, one-way valve, mediastinal shift, venous return and gauges. */
const LAY = { air: $("airspace"), lungs: $("lungs"), media: $("media"), parts: $("parts"), drain: $("drainG"), over: $("over"), panel: $("panel") };
const DYN = {};
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const airDots = pool(26, () => mk("circle", { class: "sc-p p-air", r: 3.2 }, LAY.parts));
const outDots = pool(10, () => mk("circle", { class: "sc-p p-out", r: 3 }, LAY.parts));
const oxyDots = pool(12, () => mk("circle", { class: "sc-p p-oxy", r: 3 }, LAY.parts));
let venDots = [];
function init() {
  DYN.airEl = mk("ellipse", { class: "pt-air", cx: 790, cy: 255, rx: 95, ry: 145, opacity: "0.18" }, LAY.air);
  DYN.lungN = mk("g", {}, LAY.lungs);
  mk("ellipse", { class: "pt-lungN", cx: 275, cy: 255, rx: 105, ry: 125 }, DYN.lungN);
  mk("ellipse", { class: "pt-lungN", cx: 250, cy: 225, rx: 55, ry: 70, opacity: "0.45" }, DYN.lungN);
  DYN.lungA = mk("g", {}, LAY.lungs);
  mk("ellipse", { class: "pt-lungA", cx: 0, cy: 0, rx: 105, ry: 125 }, DYN.lungA);
  mk("ellipse", { class: "pt-lungA", cx: -22, cy: -28, rx: 55, ry: 70, opacity: "0.45" }, DYN.lungA);
  DYN.bleb = mk("circle", { class: "pt-bleb", cx: 62, cy: -108, r: 11 }, DYN.lungA);
  const mg = mk("g", {}, LAY.media); DYN.mediaG = mg;
  mk("path", { class: "pt-vein", d: "M508 196V282M508 348V398" }, mg);
  mk("path", { class: "pt-vein2", d: "M508 196V282" }, mg);
  DYN.veinTop = mg.querySelector(".pt-vein");
  mk("path", { class: "pt-trach", d: "M480 92V196" }, mg);
  mk("path", { class: "pt-trach2", d: "M480 92V196" }, mg);
  mk("path", { class: "pt-bronch", d: "M480 196L392 232M480 196L568 228" }, mg);
  venDots = pool(12, () => mk("circle", { class: "sc-p p-ven", r: 3 }, mg));
  const hg = mk("g", { transform: "translate(480 322) scale(0.72)" }, mg); DYN.heartG = hg;
  mk("path", { class: "pt-heart", d: "M0 78C-70 35 -88 -10 -72 -48C-58 -82 -18 -88 0 -55C18 -88 58 -82 72 -48C88 -10 70 35 0 78Z" }, hg);
  mk("circle", { class: "pt-hole", cx: 851, cy: 185, r: 7 }, LAY.parts);
  DYN.flap = mk("path", { class: "pt-flap", d: "M851 178L838 196" }, LAY.parts);
  const dg = LAY.drain; dg.setAttribute("opacity", "0");
  mk("path", { class: "pt-drain", d: "M812 338L878 382" }, dg);
  mk("rect", { class: "pt-drainbox", x: 872, y: 376, width: 34, height: 42, rx: 6 }, dg);
  mk("path", { class: "pt-drain", d: "M889 382V404" }, dg);
  const ox = LAY.over;
  DYN.trachPill = pill(ox, "Trachea", 480, 120, 380, 78, "Windpipe (trachea). In tension it is pushed away from the side with air, a late and important sign.");
  const vp = pill(ox, "One-way valve", 845, 178, 595, 78, "In tension, the entry works as a one-way valve: air comes in as the patient breathes in but cannot get out, so pressure keeps rising."); vp.setAttribute("id", "valve-pill");
  pill(ox, "Chest wall entry", 851, 185, 765, 78, "Air can enter the pleural space through an injury in the chest wall, or from inside through a ruptured bleb on the lung.");
  pill(ox, "Normal lung", 275, 255, 250, 115, "The other lung keeps working. It expands and shrinks a little with each breath.");
  pill(ox, "Collapsed lung", 660, 250, 680, 155, "The affected lung recoils and collapses toward the hilum once air breaks its seal with the chest wall. A small bleb on its surface can be the source of the air.");
  pill(ox, "Pleural air", 815, 300, 800, 255, "Air trapped in the pleural space between lung and chest wall. The more air, the higher the pleural pressure and the more the lung collapses.");
  DYN.heartPill = pill(ox, "Heart and veins", 492, 330, 460, 405, "In tension the shifted mediastinum presses on the heart and great veins. Venous return falls, cardiac output falls and shock follows.");
  const dp = pill(ox, "Chest drain", 840, 360, 705, 408, "Needle decompression lets trapped air out at once in tension. A chest drain then keeps removing air so the lung can re-expand and seal."); dp.setAttribute("id", "drain-pill");
  const P = LAY.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["air", "Pleural air", "g-air", "How much air is trapped in the pleural space. It rises with size and, in tension, with every breath."], ["coll", "Lung collapse", "g-coll", "How far the lung has recoiled and collapsed. A collapsed lung takes part poorly in gas exchange."], ["shift", "Shift", "g-shift", "How far the trachea, heart and mediastinum are pushed away from the affected side. Marked shift means tension."], ["vr", "Venous return", "g-good", "Blood returning to the heart through the great veins. Shift and pressure squeeze the veins, so return falls."], ["bp", "Blood pressure", "g-good", "Systemic blood pressure. It falls when venous return and cardiac output fall, causing obstructive shock."], ["ox", "Oxygen", "g-cyt", "Oxygen level in the blood. It falls as the lung collapses; extra oxygen can support it but does not remove pleural air."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { A: 0.4, P: 0.3, C: 0.4, Sh: 0, VR: 0.9, BP: 0.9, Ox: 0.8, drain: 0, oxy: 0, valve: 0 };
const acc = { air: 0, out: 0, oxy: 0, ven: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.A = lerp(sm.A, m.A, k2); sm.P = lerp(sm.P, m.P, k2); sm.C = lerp(sm.C, m.C, k2); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.VR = lerp(sm.VR, m.VR, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.Ox = lerp(sm.Ox, m.Ox, k2); sm.drain = lerp(sm.drain, m.drain, k1); sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.valve = lerp(sm.valve, m.valve, k2);
  const breath = Math.sin(tm / 900), shiftPx = -58 * sm.Sh;
  DYN.mediaG.setAttribute("transform", "translate(" + f1(shiftPx) + " 0)");
  if (DYN.trachPill) DYN.trachPill.setAttribute("transform", "translate(" + f1(shiftPx) + " 0)");
  if (DYN.heartPill) DYN.heartPill.setAttribute("transform", "translate(" + f1(shiftPx) + " 0)");
  DYN.airEl.setAttribute("rx", f1(55 + 75 * sm.A)); DYN.airEl.setAttribute("ry", f1(105 + 55 * sm.A)); DYN.airEl.setAttribute("opacity", (0.08 + 0.28 * sm.A).toFixed(2));
  const nScale = 1 + 0.022 * breath;
  DYN.lungN.setAttribute("transform", "translate(275 255) scale(" + nScale.toFixed(3) + ") translate(-275 -255)");
  const aScale = (1 - 0.55 * sm.C) * (1 + 0.012 * breath), ax = 685 - 72 * sm.C, ay = 255 - 8 * sm.C;
  place(DYN.lungA, ax, ay, 0, aScale);
  DYN.bleb.setAttribute("opacity", (1 - sm.drain).toFixed(2));
  const beat = Math.sin(Math.min(3.14, ((tm / 850) % 1) * 3.14));
  DYN.heartG.setAttribute("transform", "translate(480 322) scale(" + (0.72 * (1 + 0.05 * sm.VR * beat)).toFixed(3) + ")");
  DYN.flap.setAttribute("transform", "rotate(" + f1(sm.valve * (breath > 0 ? -24 : 8)) + " 851 185)");
  DYN.flap.setAttribute("opacity", (0.25 + 0.75 * Math.max(sm.valve, sm.drain * 0.4)).toFixed(2));
  $("valve-pill").style.opacity = sm.valve.toFixed(2);
  LAY.drain.setAttribute("opacity", sm.drain.toFixed(2)); $("drain-pill").style.opacity = sm.drain.toFixed(2);
  acc.air += dt * (0.5 + 7 * sm.A) * (breath > -0.2 ? 1 : 0.35);
  while (acc.air >= 1) { acc.air--; const p = free(airDots); if (p) emit(p, 848, 188, rnd(-28, -16), rnd(-4, 10), 0); }
  airDots.forEach((p) => { if (!p.on) return; p.t += dt;
    if (sm.drain > 0.55) { p.x += (838 - p.x) * dt * 1.6; p.y += (352 - p.y) * dt * 1.6; if (Math.hypot(838 - p.x, 352 - p.y) < 12) kill(p); }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx += rnd(-6, 6) * dt; p.vy += rnd(-6, 6) * dt; p.vx = clamp(p.vx, -22, 22); p.vy = clamp(p.vy, -18, 18);
      if (p.x < 762) { p.x = 762; p.vx = Math.abs(p.vx); } if (p.x > 858) { p.x = 858; p.vx = -Math.abs(p.vx); } if (p.y < 118) { p.y = 118; p.vy = Math.abs(p.vy); } if (p.y > 392) { p.y = 392; p.vy = -Math.abs(p.vy); } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 9) kill(p); });
  acc.out += dt * sm.drain * 7; while (acc.out >= 1) { acc.out--; const p = free(outDots); if (p) emit(p, 818, 342, 0, 0, Math.random()); }
  outDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.9; const u = p.t % 1; p.e.setAttribute("transform", "translate(" + f1(818 + 62 * u) + " " + f1(342 + 42 * u) + ")"); if (p.t > 1.1) kill(p); });
  acc.oxy += dt * sm.oxy * 6; while (acc.oxy >= 1) { acc.oxy--; const p = free(oxyDots); if (p) emit(p, 480 + shiftPx, 96, 0, 0, Math.random()); }
  oxyDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.55; const u = p.t % 1; const x = u < 0.55 ? 480 + shiftPx : lerp(480 + shiftPx, 360, (u - 0.55) / 0.45), y = u < 0.55 ? lerp(96, 198, u / 0.55) : lerp(198, 232, (u - 0.55) / 0.45); p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); if (p.t > 1.2) kill(p); });
  acc.ven += dt * (0.4 + 3.4 * sm.VR); while (acc.ven >= 1) { acc.ven--; const p = free(venDots); if (p) emit(p, 508, 200, 0, 0, Math.random()); }
  venDots.forEach((p) => { if (!p.on) return; p.t += dt * (0.25 + 0.55 * sm.VR); const u = p.t % 1; p.e.setAttribute("transform", "translate(508 " + f1(lerp(200, 282, u)) + ")"); if (p.t > 1.3) kill(p); });
  gg.air.set(sm.A, wordOf(sm.A, 0.35, 0.7, ["small", "moderate", "large"])); gg.coll.set(sm.C, wordOf(sm.C, 0.35, 0.68, ["mild", "partial", "severe"])); gg.shift.set(sm.Sh, wordOf(sm.Sh, 0.2, 0.55, ["none", "some", "marked"]));
  gg.vr.set(sm.VR, wordOf(sm.VR, 0.35, 0.65, ["low", "reduced", "good"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.62, ["low", "borderline", "ok"])); gg.ox.set(sm.Ox, wordOf(sm.Ox, 0.45, 0.7, ["low", "reduced", "good"]));
}
run({ init, step });
