/* Baroreceptor scene: sensor firing, afferent and efferent traffic, heart, arteriole, arterial flow and the gauges. */
const WW = SC.W;
const L = { vessels: $("vessels"), rbcs: $("rbcs"), links: $("links"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("baroLumen"), art: $("artLumen"), heart: $("heartIcon"), sensCar: $("sensCar"), sensAor: $("sensAor"), med: $("medIcon") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const fluP = pool(20, () => mk("path", { class: "p-baro-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const bleedP = pool(16, () => mk("path", { class: "p-baro-bl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const sensP = pool(12, () => mk("circle", { class: "baro-dot", r: 3 }, L.parts));
/* arrows with moving dots */
const ARROWS = {
  affCar: { pts: [[260, 110], [315, 125], [370, 140]], kind: "aff" },
  affAor: { pts: [[260, 200], [315, 185], [370, 170]], kind: "aff" },
  symHeart: { pts: [[590, 135], [648, 122], [705, 110]], kind: "sym" },
  symVess: { pts: [[590, 170], [648, 188], [705, 205]], kind: "sym" },
  vagHeart: { pts: [[540, 190], [590, 250], [650, 240], [650, 150], [720, 133]], kind: "vag" },
};
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const a = ARROWS[id], d = a.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a.pts);
  mk("path", { class: "baro-arrow", d }, L.links);
  const p1 = a.pts[a.pts.length - 2], p2 = a.pts[a.pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958;
  mk("path", { class: "baro-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, L.links);
  const nd = Math.max(3, Math.round(tr.len / 55)), dots = Array.from({ length: nd }, (_, i) => { const c = mk("circle", { class: "baro-dot " + a.kind, r: 2.4 }, L.parts); return { c, u: i / nd }; });
  arrows[id] = { tr, dots, kind: a.kind }; });
/* red cells in the arterial tube */
const rbcs = [];
for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(50, 910), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
/* treatment and posture marks, made in initPanel */
let vasoG = null, poolG = null, poolPill = null, bleedPill = null;
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bp", "Pressure", "g-good", "Arterial pressure in the large arteries. The reflex pulls it back toward its set point."], ["fir", "Sensor firing", "g-fir", "How fast the carotid sinus and aortic arch sensors fire. More stretch means more firing."], ["sym", "Sympathetic", "g-sym", "Sympathetic outflow from the medulla to the heart and arterioles. It rises when sensor firing falls."], ["vag", "Vagus", "g-vag", "Parasympathetic vagus outflow to the heart. It slows the heart and rises when pressure rises."], ["hr", "Heart rate", "g-hr", "Heart rate and force, raised by sympathetic outflow and restrained by the vagus."], ["tone", "Vessel tone", "g-tone", "Tightening of arteriole muscle. More tone narrows vessels and raises pressure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "CN IX", 315, 118, 315, 78, "Glossopharyngeal nerve, cranial nerve IX. It carries carotid sinus sensor signals to the medulla.");
  pill(ox, "CN X", 315, 192, 315, 248, "Vagus nerve, cranial nerve X. It carries aortic arch sensor signals to the medulla, and later carries slowing signals back to the heart.");
  pill(ox, "Sympathetic", 648, 122, 648, 84, "Sympathetic outflow. It speeds and strengthens the heart and tightens arterioles, raising pressure.");
  pill(ox, "Vagus outflow", 620, 248, 560, 305, "Vagus outflow from the medulla to the heart. It slows the heart and falls when pressure falls, letting the heart speed up.");
  pill(ox, "Arterial pressure", 480, 355, 480, 412, "Pressure in the arterial system. This is what the sensors stretch against, closing the feedback circle.");
  pill(ox, "Negative feedback", 165, 280, 95, 285, "Negative feedback: a fall in pressure reduces sensor firing, and the response that follows pushes pressure back up.");
  poolPill = pill(ox, "Pooling in legs", 90, 382, 95, 412, "On standing, blood pools in the leg veins. Less blood returns to the heart, so pressure tends to fall.");
  poolPill.setAttribute("id", "pool-pill");
  bleedPill = pill(ox, "Blood loss", 890, 382, 850, 412, "Haemorrhage loses circulating blood volume, so pressure falls further and the reflex works harder.");
  bleedPill.setAttribute("id", "bleed-pill");
  vasoG = mk("g", { opacity: "0" }, ox);
  mk("path", { class: "baro-chev", d: "M712 196l8 9l-8 9" }, vasoG); mk("path", { class: "baro-chev", d: "M758 196l-8 9l8 9" }, vasoG);
  poolG = mk("g", { opacity: "0" }, ox);
  [90, 850].forEach((x) => mk("path", { class: "baro-pool", d: "M" + (x - 7) + " 388l7 8l7 -8" }, poolG));
}
const sm = { vol: 0.9, bp: 0.9, fir: 0.9, sym: 0.4, vag: 0.6, hr: 0.55, tone: 0.5, vaso: 0, flu: 0, stand: 0, haem: 0 };
const acc = { flu: 0, bleed: 0, sens: 0 };
let beat = 0;
function pulseEl(el, cx, cy, s) { el.setAttribute("transform", "translate(" + cx + " " + cy + ") scale(" + s.toFixed(3) + ") translate(" + (-cx) + " " + (-cy) + ")"); }
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["vol", "bp", "fir", "sym", "vag", "hr", "tone", "vaso", "flu", "stand", "haem"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* heart beat and sensor pulse */
  beat += dt * (0.55 + 1.15 * sm.hr); const ph = beat % 1, c = ph < 0.45 ? Math.sin(Math.PI * ph / 0.45) : 0;
  pulseEl(L.heart, 735, 102, 1 + 0.16 * sm.hr * c);
  pulseEl(L.sensCar, 100, 110, 1 + 0.12 * sm.fir * c); pulseEl(L.sensAor, 100, 200, 1 + 0.12 * sm.fir * c);
  L.med.style.filter = "drop-shadow(0 0 " + (2 + 6 * Math.max(sm.sym, sm.vag)).toFixed(1) + "px var(--c-mac))";
  /* arteriole lumen and arterial tube */
  L.art.setAttribute("r", f1(Math.max(3.5, 13 - 8 * sm.tone)));
  const hh = 19 + 9 * sm.bp + 1.2 * Math.sin(tm / 300) * sm.bp;
  L.lumen.setAttribute("y", f1(355 - hh)); L.lumen.setAttribute("height", f1(hh * 2));
  /* arrow traffic */
  const rate = { aff: sm.fir, sym: sm.sym, vag: sm.vag };
  Object.keys(arrows).forEach((id) => { const a = arrows[id], v = rate[a.kind];
    a.dots.forEach((d) => { d.u = (d.u + dt * (0.04 + 0.3 * v)) % 1; const q = a.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(0.15 + v).toFixed(2); }); });
  /* sensor pulses rising from the arterial tube toward the sensors */
  acc.sens += dt * sm.fir * 4; while (acc.sens >= 1) { acc.sens--; const p = free(sensP); if (p) emit(p, 165, 326, 0, -46, 0); }
  sensP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 238) kill(p); });
  /* red cells: flow speed follows pressure, visible count follows volume */
  const flow = 30 + 75 * sm.bp;
  rbcs.forEach((r, i) => { r.x += r.v * flow * dt; if (r.x > 918) { r.x = 46; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, 355 + r.y * Math.max(5, hh - 9), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); r.g.style.opacity = i < Math.round(sm.vol * rbcs.length) ? 1 : 0; });
  /* fluids entering from the left of the tube */
  acc.flu += dt * sm.flu * 7; while (acc.flu >= 1) { acc.flu--; const p = free(fluP); if (p) emit(p, 46, 355 + rnd(-hh + 10, hh - 10), 95, 0, 0); }
  fluP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.x = clamp(p.x, 30, 930); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 914) kill(p); });
  /* blood loss drops leaving the right end of the tube */
  acc.bleed += dt * sm.haem * (1 - 0.35 * sm.flu) * 5; while (acc.bleed >= 1) { acc.bleed--; const p = free(bleedP); if (p) emit(p, 890 + rnd(-6, 6), 382, rnd(-4, 4), 34, 0); }
  bleedP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 52, 420); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 418) kill(p); });
  /* marks and conditional pills */
  if (vasoG) vasoG.setAttribute("opacity", sm.vaso.toFixed(2));
  if (poolG) poolG.setAttribute("opacity", sm.stand.toFixed(2));
  if (poolPill) poolPill.style.opacity = sm.stand.toFixed(2);
  if (bleedPill) bleedPill.style.opacity = sm.haem.toFixed(2);
  /* gauges */
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.68, 0.84, ["low", "near normal", "normal"])); gg.fir.set(sm.fir, wordOf(sm.fir, 0.72, 0.85, ["low", "reduced", "brisk"]));
  gg.sym.set(sm.sym, wordOf(sm.sym, 0.5, 0.75, ["quiet", "raised", "high"])); gg.vag.set(sm.vag, wordOf(sm.vag, 0.35, 0.6, ["low", "present", "brisk"]));
  gg.hr.set(sm.hr, wordOf(sm.hr, 0.6, 0.78, ["calm", "raised", "fast"])); gg.tone.set(sm.tone, wordOf(sm.tone, 0.45, 0.7, ["relaxed", "firm", "tight"]));
}
run({ init, step });
