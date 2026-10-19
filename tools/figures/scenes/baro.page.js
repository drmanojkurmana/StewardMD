/* Baroreceptor scene: sensors fire up the neck artery, the medulla answers, heart and vessels respond. */
const WW = SC.W;
const L = { links: $("links"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("baroLumen"), toneTop: $("toneTop"), toneBot: $("toneBot"), clamps: $("clamps"), dockTube: $("dockTube"), dockVess: $("dockVess"), cuffCar: $("cuffCar"), cuffAor: $("cuffAor"), vasoDot: $("vasoDot"), vessLumen: $("vessLumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const fluP = pool(20, () => mk("path", { class: "p-baro-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const bleedP = pool(16, () => mk("path", { class: "p-baro-bl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const sensP = pool(18, () => mk("circle", { class: "baro-dot", r: 3 }, L.parts));
let heartO = null, brainO = null, vasoPos = [497, 204];
const arrows = {};
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 480, 155, 170, {});
  heartO = organ($("heartSlot"), "heart", 795, 155, 110, {});
  const st = brainO.ports.stem || brainO.ports.parenchyma;
  vasoPos = [Math.round(st[0]), Math.round(st[1])];
  L.vasoDot.setAttribute("cx", vasoPos[0]); L.vasoDot.setAttribute("cy", vasoPos[1]);
}
function initArrows() {
  const defs = {
    affCar: { pts: [[160, 110], [270, 104], [brainO.x - 86, 132]], kind: "aff" },
    affAor: { pts: [[160, 200], [270, 206], [brainO.x - 86, 176]], kind: "aff" },
    symHeart: { pts: [[brainO.x + 86, 132], [652, 124], [heartO.x - 57, 130]], kind: "sym" },
    symVess: { pts: [[brainO.x + 86, 174], [640, 214], [714, 260]], kind: "sym" },
    vagHeart: { pts: [[536, 196], [588, 252], [652, 242], [652, 156], [heartO.x - 57, 126]], kind: "vag" },
  };
  Object.keys(defs).forEach((id) => { const a = defs[id], d = a.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a.pts);
    mk("path", { class: "baro-arrow", d }, L.links);
    const p1 = a.pts[a.pts.length - 2], p2 = a.pts[a.pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958;
    mk("path", { class: "baro-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, L.links);
    const nd = Math.max(3, Math.round(tr.len / 55)), dots = Array.from({ length: nd }, (_, i) => { const c = mk("circle", { class: "baro-dot " + a.kind, r: 2.4 }, L.parts); return { c, u: i / nd }; });
    arrows[id] = { tr, dots, kind: a.kind }; });
}
/* vasoconstrictor hardware: clamp bands around the arterial tube and docked drug dots on vessel walls */
const clampRects = [];
function initTreat() {
  [150, 290, 430, 570, 710, 830].forEach((x) => clampRects.push(mk("rect", { class: "baro-clamp", x: x - 7, y: 320, width: 14, height: 72, rx: 7 }, L.clamps)));
  for (let i = 0; i < 6; i++) mk("circle", { class: "baro-drug", cx: 731 + i * 26, cy: 243, r: 3.6 }, L.dockVess);
  for (let i = 0; i < 6; i++) mk("circle", { class: "baro-drug", cx: 200 + i * 110, cy: 330, r: 3.6 }, L.dockTube);
}
/* red cells in the arterial tube */
const rbcs = [];
function initRBCs() {
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(50, 910), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
}
function capText(l, d) {
  if (d === 1 && l === 0) return "Vasoconstrictor tightens small vessels. Pressure stays up.";
  if (d === 1 && l === 1) return "Vasoconstrictor tightens small vessels. It holds pressure on standing.";
  if (d === 1) return "Vasoconstrictor tightens small vessels. It holds pressure after blood loss.";
  if (d === 2 && l === 0) return "Fluids top up the vessels. Pressure stays steady.";
  if (d === 2 && l === 1) return "Fluids refill the vessels. More blood returns to the heart.";
  if (d === 2) return "Fluids replace lost volume. Pressure recovers as filling returns.";
  if (l === 0) return "No treatment. Pressure is steady and the sensors fire briskly.";
  if (l === 1) return "No treatment. Standing pools blood in the legs and pressure dips.";
  return "No treatment. Blood loss lowers pressure and the heart races.";
}
const gg = {};
let capEl = null, capKey = "", poolPill = null, bleedPill = null;
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bp", "Pressure", "g-good", "Arterial pressure in the large arteries. The reflex pulls it back toward its set point."], ["fir", "Sensor firing", "g-fir", "How fast the carotid sinus and aortic arch sensors fire. More stretch means more firing."], ["sym", "Sympathetic", "g-sym", "Sympathetic outflow from the medulla to the heart and arterioles. It rises when sensor firing falls."], ["vag", "Vagus", "g-vag", "Parasympathetic vagus outflow to the heart. It slows the heart and rises when pressure rises."], ["hr", "Heart rate", "g-hr", "Heart rate and force, raised by sympathetic outflow and restrained by the vagus."], ["tone", "Vessel tone", "g-tone", "Tightening of arteriole muscle. More tone narrows vessels and raises pressure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Neck sensors", 152, 110, 232, 84, "Stretch sensors in the neck artery. More pressure means more stretch and faster firing.");
  pill(ox, "Chest sensors", 152, 200, 232, 224, "Stretch sensors in the aortic arch. They signal the brain through the vagus nerve.");
  pill(ox, "Brain control", vasoPos[0], vasoPos[1], 480, 242, "Vasomotor centre in the medulla. It raises sympathetic outflow and lowers vagus outflow when sensor firing falls.");
  pill(ox, "Heart", heartO.x + 53, 155, 902, 152, "Heart. Sympathetic signals speed it and strengthen each beat. Vagus signals slow it.");
  pill(ox, "Small vessels", 795, 247, 795, 308, "Small arteries. Sympathetic signals tighten their muscle and narrow them, which raises pressure.");
  pill(ox, "Pressure", 640, 355, 640, 408, "Arterial pressure. This is what the sensors feel, closing the feedback loop.");
  poolPill = pill(ox, "Pooling in legs", 90, 392, 100, 412, "On standing, blood pools in the leg veins. Less blood returns to the heart, so pressure dips.");
  poolPill.setAttribute("id", "pool-pill");
  bleedPill = pill(ox, "Blood loss", 890, 388, 850, 412, "Haemorrhage loses blood volume. Pressure falls and the reflex works harder.");
  bleedPill.setAttribute("id", "bleed-pill");
  capEl = mk("text", { class: "baro-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(level, drug);
}
const sm = { vol: 0.9, bp: 0.9, fir: 0.9, sym: 0.4, vag: 0.6, hr: 0.55, tone: 0.5, vaso: 0, flu: 0, stand: 0, haem: 0 };
const acc = { flu: 0, bleed: 0, sens: 0 };
let beat = 0, glowC = 0, glowA = 0, curHH = 24;
function pulseEl(el, cx, cy, s) { el.setAttribute("transform", "translate(" + cx + " " + cy + ") scale(" + s.toFixed(3) + ") translate(" + (-cx) + " " + (-cy) + ")"); }
function init() { initOrgans(); initArrows(); initTreat(); initRBCs(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["vol", "bp", "fir", "sym", "vag", "hr", "tone", "vaso", "flu", "stand", "haem"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* heart beat, sensor cuff flash and vasomotor glow */
  beat += dt * (0.55 + 1.15 * sm.hr); const ph = beat % 1, c = ph < 0.45 ? Math.sin(Math.PI * ph / 0.45) : 0;
  heartO.g.setAttribute("transform", "translate(" + f1(heartO.x) + " " + f1(heartO.y) + ") scale(" + (1 + 0.16 * sm.hr * c).toFixed(3) + ")");
  glowC = Math.max(0, glowC - dt * 2.5); glowA = Math.max(0, glowA - dt * 2.5);
  pulseEl(L.cuffCar, 140, 110, 1 + 0.28 * glowC + 0.07 * sm.fir * c);
  pulseEl(L.cuffAor, 140, 200, 1 + 0.28 * glowA + 0.07 * sm.fir * c);
  const act = Math.max(sm.sym, sm.vag);
  L.vasoDot.setAttribute("opacity", (0.55 + 0.45 * act).toFixed(2));
  pulseEl(L.vasoDot, vasoPos[0], vasoPos[1], 1 + 0.3 * act * c);
  /* arterial tube: height follows volume and pressure, so fluids visibly refill it */
  const hh = 8 + 18 * sm.vol + 6 * sm.bp; curHH = hh;
  L.lumen.setAttribute("y", f1(356 - hh)); L.lumen.setAttribute("height", f1(hh * 2));
  L.toneTop.setAttribute("d", "M40 " + f1(356 - hh) + "L920 " + f1(356 - hh));
  L.toneBot.setAttribute("d", "M40 " + f1(356 + hh) + "L920 " + f1(356 + hh));
  L.toneTop.setAttribute("opacity", (sm.vaso * 0.9).toFixed(2));
  L.toneBot.setAttribute("opacity", (sm.vaso * 0.9).toFixed(2));
  L.clamps.setAttribute("opacity", sm.vaso.toFixed(2));
  clampRects.forEach((r) => { r.setAttribute("y", f1(356 - hh - 8)); r.setAttribute("height", f1(hh * 2 + 16)); });
  L.dockVess.setAttribute("opacity", sm.vaso.toFixed(2));
  L.dockTube.setAttribute("opacity", sm.vaso.toFixed(2));
  Array.from(L.dockTube.children).forEach((d) => d.setAttribute("cy", f1(356 - hh - 4)));
  /* small vessel lumen: narrows with tone, near shut with vasoconstrictor */
  const lh = Math.max(1.2, (1 - sm.tone) * 11 + 1.5 - sm.vaso * 1.5);
  L.vessLumen.setAttribute("y", f1(265 - lh)); L.vessLumen.setAttribute("height", f1(lh * 2)); L.vessLumen.setAttribute("rx", f1(lh));
  /* arrow traffic */
  const rate = { aff: sm.fir, sym: sm.sym, vag: sm.vag };
  Object.keys(arrows).forEach((id) => { const a = arrows[id], v = rate[a.kind];
    a.dots.forEach((d) => { d.u = (d.u + dt * (0.04 + 0.3 * v)) % 1; const q = a.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(0.15 + v).toFixed(2); }); });
  /* sensor pulses rise up the neck artery and are absorbed at the cuffs */
  acc.sens += dt * (0.8 + 3.5 * sm.fir); while (acc.sens >= 1) { acc.sens--; const p = free(sensP); if (p) emit(p, 140 + rnd(-3, 3), 330, 0, -90, Math.random() < 0.5 ? 1 : 0); }
  sensP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.k === 1 && p.y <= 202) { glowA = 1; kill(p); } else if (p.y <= 112) { glowC = 1; kill(p); } });
  /* red cells: flow speed follows pressure, visible count follows volume */
  const flow = 30 + 75 * sm.bp;
  rbcs.forEach((r, i) => { r.x += r.v * flow * dt; if (r.x > 918) { r.x = 46; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, 356 + r.y * Math.max(5, hh - 9), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); r.g.style.opacity = i < Math.round(sm.vol * rbcs.length) ? 1 : 0; });
  /* fluids entering from the left of the tube */
  acc.flu += dt * sm.flu * 7; while (acc.flu >= 1) { acc.flu--; const p = free(fluP); if (p) emit(p, 46, 356 + rnd(-hh + 10, hh - 10), 95, 0, 0); }
  fluP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 914) kill(p); });
  /* blood loss drops leaving the right end of the tube */
  acc.bleed += dt * sm.haem * (1 - 0.35 * sm.flu) * 5; while (acc.bleed >= 1) { acc.bleed--; const p = free(bleedP); if (p) emit(p, 890 + rnd(-6, 6), 356 + curHH + 3, rnd(-4, 4), 34, 0); }
  bleedP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x, 30, 930); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 418) kill(p); });
  /* conditional pills */
  if (poolPill) poolPill.style.opacity = sm.stand.toFixed(2);
  if (bleedPill) bleedPill.style.opacity = sm.haem.toFixed(2);
  /* gauges */
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.68, 0.84, ["low", "near normal", "normal"])); gg.fir.set(sm.fir, wordOf(sm.fir, 0.72, 0.85, ["low", "reduced", "brisk"]));
  gg.sym.set(sm.sym, wordOf(sm.sym, 0.5, 0.75, ["quiet", "raised", "high"])); gg.vag.set(sm.vag, wordOf(sm.vag, 0.35, 0.6, ["low", "present", "brisk"]));
  gg.hr.set(sm.hr, wordOf(sm.hr, 0.6, 0.78, ["calm", "raised", "fast"])); gg.tone.set(sm.tone, wordOf(sm.tone, 0.45, 0.7, ["relaxed", "firm", "tight"]));
  const key = level + " " + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
