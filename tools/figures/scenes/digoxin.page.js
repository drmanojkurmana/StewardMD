/* Digoxin scene: pump blockade in a heart cell, calcium build up, beating heart, AV slowing, ECG and warning signs. */
const layers = { cell: $("cellg"), cond: $("cond"), signs: $("signs"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
let heartO = null, eyeO = null, gutO = null, capEl = null, capDrug = -1;
const HX = 575, HY = 285, EX = 810, EY = 128, GX = 810, GY = 245;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const digPool = pool(12, () => mk("path", { class: "sc-p p-dig", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.cell));
const fabPool = pool(8, () => mk("path", { class: "p-fab", d: "M0 0L0 -7M0 0L-5 -6M0 0L5 -6M0 0L0 7" }, layers.cell));
let pumpX, haloEl, washEl, glowEl, gutGlow, ecgPath, boundG = [], sarcTicks = [], naDots = [], caDots = [], kxDots = [], pulses = [];
let condTrack, apexPt = [575, 327];
const gg = {};
const sm = { E: 0.4, Na: 0.3, Ca: 0.3, Ino: 0.4, AV: 0.3, Kx: 0.2, Arr: 0.2, Tox: 0.2, haltF: 0, corrF: 0, fabF: 0 };
const acc = { dig: 0, fab: 0 };
function capText(d) {
  if (d === 1) return "Stopping the drug. Less digoxin reaches the pump.";
  if (d === 2) return "Correcting potassium. Digoxin grips the pump less tightly.";
  if (d === 3) return "Antibody fragments trap digoxin in the blood. The pump is freed.";
  if (d === 4) return "All measures. The pump is freed and the rhythm settles.";
  return "No treatment. Digoxin blocks the pump and the heart suffers.";
}
function init() {
  /* real anatomy: heart for conduction and beating, eye for halos, stomach for nausea */
  heartO = organ($("heartSlot"), "heart", HX, HY, 108, {});
  eyeO = organ($("eyeSlot"), "eye", EX, EY, 104, {});
  gutO = organ($("gutSlot"), "stomach", GX, GY, 128, {});
  apexPt = heartO.ports.apex || [HX, HY + 42];
  /* sick heart glow sits over the heart and fades with treatment */
  glowEl = mk("ellipse", { class: "dg-glow", cx: HX, cy: HY, rx: 92, ry: 72, opacity: "0" }, layers.cond);
  /* pump and exchanger in the membrane */
  const pump = mk("g", {}, layers.cell);
  mk("rect", { class: "dg-pump", x: -24, y: -22, width: 48, height: 44, rx: 11 }, pump);
  mk("circle", { class: "dg-eye", cx: -9, cy: -6, r: 5 }, pump); mk("circle", { class: "dg-eye", cx: 9, cy: 6, r: 5 }, pump);
  pump.setAttribute("transform", "translate(170 128)");
  pumpX = mk("g", { opacity: "0" }, layers.cell);
  mk("path", { class: "dg-vagus", d: "M152 108L188 148M188 108L152 148", style: "stroke:var(--c-bad);stroke-dasharray:none" }, pumpX);
  /* blocker particles parked on the pump, freed by treatment */
  [[148, 106], [192, 106], [148, 150], [192, 150]].forEach((q) => {
    boundG.push(mk("path", { class: "sc-p p-dig", d: "M0 -5L5 0L0 5L-5 0Z", transform: "translate(" + q[0] + " " + q[1] + ")" }, layers.cell));
  });
  const ncx = mk("g", {}, layers.cell);
  mk("rect", { class: "dg-ncx", x: -21, y: -17, width: 42, height: 34, rx: 9 }, ncx);
  mk("circle", { class: "dg-eye", cx: 0, cy: 0, r: 5 }, ncx);
  ncx.setAttribute("transform", "translate(350 128)");
  /* sarcomere lines inside the cell */
  [278, 302, 326].forEach((y) => { mk("path", { class: "dg-sarc", d: "M62 " + y + "H428" }, layers.cell); });
  [92, 162, 232, 302, 372].forEach((x) => { [278, 302, 326].forEach((y) => { const t = mk("path", { class: "dg-sarc2", d: "M" + x + " " + (y - 9) + "V" + (y + 9) }, layers.cell); sarcTicks.push({ e: t, x, y }); }); });
  /* ion dots, kept inside the cell or the outside strip */
  for (let i = 0; i < 26; i++) { const e = mk("circle", { class: "sc-p p-na", r: 3.4 }, layers.cell); naDots.push({ e, x: rnd(58, 432), y: rnd(165, 248), vx: rnd(-14, 14), vy: rnd(-10, 10) }); }
  for (let i = 0; i < 22; i++) { const e = mk("circle", { class: "sc-p p-ca", r: 3 }, layers.cell); caDots.push({ e, x: rnd(58, 432), y: rnd(262, 332), vx: rnd(-9, 9), vy: rnd(-7, 7) }); }
  for (let i = 0; i < 18; i++) { const e = mk("circle", { class: "sc-p p-kx", r: 3.2 }, layers.cell); kxDots.push({ e, x: rnd(118, 442), y: rnd(92, 118), ph: i * 1.3 }); }
  /* conduction: vagus, SA node, AV node, then the wire runs into the real heart */
  mk("path", { class: "dg-vagus", d: "M505 82C540 120 545 165 552 198" }, layers.cond);
  mk("path", { class: "dg-wire", d: "M565 142V193M565 235L" + f1(apexPt[0]) + " " + f1(apexPt[1]) }, layers.cond);
  mk("circle", { class: "dg-node", cx: 565, cy: 125, r: 17 }, layers.cond); mk("circle", { class: "dg-eye", cx: 565, cy: 125, r: 6 }, layers.cond);
  mk("circle", { class: "dg-node-av", cx: 565, cy: 215, r: 20 }, layers.cond); mk("circle", { class: "dg-eye", cx: 565, cy: 215, r: 7 }, layers.cond);
  condTrack = track([[565, 125], [565, 215], apexPt]);
  for (let i = 0; i < 3; i++) { const e = mk("circle", { class: "dg-node", r: 5 }, layers.cond); pulses.push({ e, u: i / 3, y: 125 }); }
  /* warning signs anchored on the real eye and stomach */
  haloEl = mk("circle", { class: "dg-halo", cx: EX, cy: EY, r: 48, opacity: "0" }, layers.signs);
  washEl = mk("ellipse", { class: "dg-wash", cx: EX, cy: EY, rx: 40, ry: 26, opacity: "0" }, layers.signs);
  gutGlow = mk("ellipse", { class: "dg-gutglow", cx: GX, cy: GY, rx: 70, ry: 40, opacity: "0" }, layers.signs);
  ecgPath = mk("path", { class: "dg-trace" }, layers.ecg);
  /* labels: eight short pills telling the story left to right */
  const ox = layers.over;
  pill(ox, "Digoxin", 80, 105, 150, 105, "Digoxin in the blood outside the cell. It locks onto the pump from outside. Antibody fragments trap it in the blood before it can bind.");
  pill(ox, "Pump blocked", 170, 128, 265, 95, "The sodium potassium pump. Digoxin blocks it, so sodium stays inside the cell and potassium stays outside.");
  pill(ox, "Calcium up", 380, 300, 380, 372, "Calcium inside the cell. Trapped sodium stops the exchanger clearing calcium, so calcium rises.");
  pill(ox, "Stronger beat", 245, 302, 245, 372, "The squeeze. Extra calcium makes each beat stronger. Helpful in failure, harmful in excess.");
  pill(ox, "AV node slow", 565, 215, 680, 190, "The AV node between upper and lower chambers. Digoxin boosts vagus slowing here, so the pulse slows.");
  pill(ox, "Yellow halos", EX, EY, 810, 70, "Vision in toxicity. Yellow tinge and halos around lights are classic warning signs.");
  pill(ox, "Sick gut", GX, GY, 810, 305, "The gut in toxicity. Poor appetite, nausea and vomiting are often the earliest signs.");
  pill(ox, "Rhythm", 712, 398, 710, 325, "The ECG rhythm. Toxicity breeds extra beats and blocks that can turn dangerous.");
  capEl = mk("text", { class: "dg-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
  /* gauges */
  const P = layers.panel, y0 = 478, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["blk", "Pump blocked", "g-dig", "How much of the sodium potassium pump digoxin has blocked."], ["na", "Sodium in", "g-bac", "Sodium building up inside the heart muscle cell."], ["ca", "Calcium in", "g-ca", "Calcium inside the cell, kept in because the exchanger removes less of it."], ["ino", "Contraction", "g-good", "Strength of contraction. Helpful at a low level, part of toxicity when excessive."], ["av", "AV slowing", "g-fl", "Vagal slowing of AV node conduction. Too much gives a very slow pulse or AV block."], ["arr", "Arrhythmia", "g-bad", "Risk of dangerous rhythms from calcium overload and extra beats in toxicity."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, 52, 18, cls, name, tip); });
}
function ecgVal(tt, T) {
  const p = ((tt / T) % 1 + 1) % 1;
  let v = 0;
  if (p > 0.06 && p < 0.16) v += 0.12 * Math.sin(Math.PI * (p - 0.06) / 0.1);
  if (p > 0.2 && p < 0.225) v -= 0.12 * Math.sin(Math.PI * (p - 0.2) / 0.025);
  if (p > 0.225 && p < 0.265) v += 1 * Math.sin(Math.PI * (p - 0.225) / 0.04);
  if (p > 0.265 && p < 0.29) v -= 0.22 * Math.sin(Math.PI * (p - 0.265) / 0.025);
  if (p > 0.44 && p < 0.68) v += 0.32 * Math.sin(Math.PI * (p - 0.44) / 0.24);
  v += sm.Arr * 0.16 * Math.sin(tt * 11.3) * Math.sin(tt * 3.7);
  if (sm.Arr > 0.45 && p > 0.78 && p < 0.86) v += 0.45 * Math.sin(Math.PI * (p - 0.78) / 0.08);
  return v;
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.E = lerp(sm.E, m.E, k1); sm.AV = lerp(sm.AV, m.AV, k1); sm.haltF = lerp(sm.haltF, m.haltF, k1); sm.fabF = lerp(sm.fabF, m.fabF, k1); sm.corrF = lerp(sm.corrF, m.corrF, k1);
  sm.Na = lerp(sm.Na, m.Na, k2); sm.Ca = lerp(sm.Ca, m.Ca, k2); sm.Ino = lerp(sm.Ino, m.Ino, k2); sm.Kx = lerp(sm.Kx, m.Kx, k2); sm.Arr = lerp(sm.Arr, m.Arr, k2); sm.Tox = lerp(sm.Tox, m.Tox, k2);
  pumpX.setAttribute("opacity", sm.E.toFixed(2));
  boundG.forEach((e) => e.setAttribute("opacity", sm.E.toFixed(2)));
  /* toxicity washes fade as treatment works */
  glowEl.setAttribute("opacity", (sm.Tox * 0.5).toFixed(2));
  haloEl.setAttribute("opacity", (sm.Tox * 0.9).toFixed(2));
  haloEl.setAttribute("r", f1(46 + 6 * sm.Tox + 3 * Math.sin(tm / 400) * sm.Tox));
  washEl.setAttribute("opacity", (sm.Tox * 0.5).toFixed(2));
  gutGlow.setAttribute("opacity", (sm.Tox * 0.4).toFixed(2));
  /* digoxin drifting to the pump, less of it when stopped or bound by Fab */
  acc.dig += dt * sm.E * 3.2 * (1 - 0.75 * sm.haltF) * (1 - 0.8 * sm.fabF); while (acc.dig >= 1) { acc.dig--; const p = freeP(digPool); if (p) emit(p, rnd(42, 90), rnd(96, 118), 0, 0, 0); }
  digPool.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (170 - p.x) * dt * 0.7 + 12 * dt; p.y += (128 - p.y) * dt * 0.7; p.x = clamp(p.x, 36, 452); p.y = clamp(p.y, 88, 122); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t / 3).toFixed(2)); if (p.t > 3.4) killP(p); });
  acc.fab += dt * sm.fabF * 3; while (acc.fab >= 1) { acc.fab--; const p = freeP(fabPool); if (p) emit(p, rnd(400, 448), rnd(94, 118), 0, 0, 0); }
  fabPool.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (178 - p.x) * dt * 0.6; p.y += (124 - p.y) * dt * 0.6; p.x = clamp(p.x, 36, 452); p.y = clamp(p.y, 88, 122); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t / 3.4).toFixed(2)); if (p.t > 3.8) killP(p); });
  /* ions */
  const naN = Math.round(sm.Na * naDots.length), caN = Math.round(sm.Ca * caDots.length), kxN = Math.round(sm.Kx * kxDots.length);
  naDots.forEach((d, i) => { d.x += d.vx * dt; d.y += d.vy * dt; if (d.x < 54 || d.x > 436) d.vx = -d.vx; if (d.y < 160 || d.y > 252) d.vy = -d.vy; d.x = clamp(d.x, 54, 436); d.y = clamp(d.y, 160, 252); d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); d.e.setAttribute("opacity", i < naN ? "1" : "0"); });
  caDots.forEach((d, i) => { d.x += d.vx * dt; d.y += d.vy * dt; if (d.x < 54 || d.x > 436) d.vx = -d.vx; if (d.y < 258 || d.y > 336) d.vy = -d.vy; d.x = clamp(d.x, 54, 436); d.y = clamp(d.y, 258, 336); d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); d.e.setAttribute("opacity", i < caN ? "1" : "0"); });
  kxDots.forEach((d, i) => { const x = clamp(d.x + Math.sin(tm / 500 + d.ph) * 4, 112, 446), y = clamp(d.y + Math.cos(tm / 620 + d.ph) * 3, 90, 120); d.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); d.e.setAttribute("opacity", i < kxN ? "1" : "0"); });
  /* beat: stronger squeeze, slower through the AV node */
  const T = 0.9 + 1.1 * sm.AV, ph = ((tm / 1000) / T) % 1, sq = sm.Ino * (ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : 0);
  sarcTicks.forEach((t, i) => { const dir = t.x < 245 ? 1 : -1, nx = t.x + dir * sq * 7; t.e.setAttribute("d", "M" + f1(nx) + " " + (t.y - 9) + "V" + (t.y + 9)); });
  place(heartO.g, HX, HY, 0, 1 + 0.12 * sq);
  place(gutO.g, GX + Math.sin(tm / 300) * (1 + 5 * sm.Tox), GY, 0, 1);
  pulses.forEach((p) => { const slow = p.y > 140 && p.y < 218 ? 1 - 0.72 * sm.AV : 1; p.u = (p.u + dt * 0.2 * slow) % 1; const pt = condTrack.at(p.u); p.y = pt.y; p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); p.e.setAttribute("opacity", "1"); });
  /* ECG */
  let d = ""; for (let x = 506; x <= 920; x += 3) { const age = (920 - x) / 110, v = ecgVal(tm / 1000 - age, T), y = clamp(402 - 34 * v, 362, 432); d += (x === 506 ? "M" : "L") + x + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  gg.blk.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["little", "much", "almost all"])); gg.na.set(sm.Na, wordOf(sm.Na, 0.3, 0.6, ["normal", "raised", "high"])); gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.ino.set(sm.Ino, wordOf(sm.Ino, 0.35, 0.6, ["gentle", "stronger", "forceful"])); gg.av.set(sm.AV, wordOf(sm.AV, 0.3, 0.6, ["near normal", "slowed", "markedly slowed"])); gg.arr.set(sm.Arr, wordOf(sm.Arr, 0.25, 0.55, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
