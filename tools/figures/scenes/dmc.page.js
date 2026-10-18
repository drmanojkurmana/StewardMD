/* Diabetic complications scene: high glucose, AGEs, sorbitol, real organ art, plaque and gauges. */
const WW = SC.W;
const layers = { src: $("src"), glow: $("glow"), org: $("org"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = { sorbDots: [], nerveDots: [], retDots: [], gates: [], glows: [], myelin: [], statSpots: [] };
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, c: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.c = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.c = 0; p.e.setAttribute("opacity", "0"); }
const gluc = pool(16, () => mk("circle", { class: "sc-p p-gluc", r: 3 }, layers.parts));
const alb = pool(10, () => mk("circle", { class: "sc-p p-alb", r: 2.6 }, layers.parts));
const stat = pool(9, () => mk("path", { class: "sc-p p-stat", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
gluc.forEach((p, i) => { p.x = 36 + i * 15; p.y = 90 + (i % 3) * 6; p.vx = 34 + (i % 4) * 6; });
function initSource() {
  mk("rect", { class: "dm-vess", x: 30, y: 80, width: 254, height: 36, rx: 18 }, layers.src);
  mk("path", { class: "dm-beam", d: "M284 150C300 140 306 138 320 138M284 300C300 300 306 310 320 318M284 220C300 230 306 236 320 240" }, layers.src);
  const ageG = mk("g", {}, layers.src);
  mk("ellipse", { class: "dm-nodeA", cx: 150, cy: 185, rx: 68, ry: 30 }, ageG);
  E.ageCross = mk("g", { opacity: "0" }, ageG);
  [[118, 172], [150, 185], [182, 172], [134, 198], [168, 198]].forEach(([x, y]) => { mk("path", { class: "dm-cross", d: "M" + (x - 6) + " " + (y - 6) + "L" + (x + 6) + " " + (y + 6) + "M" + (x + 6) + " " + (y - 6) + "L" + (x - 6) + " " + (y + 6) }, E.ageCross); });
  const polG = mk("g", {}, layers.src);
  mk("ellipse", { class: "dm-nodeP", cx: 150, cy: 268, rx: 68, ry: 30 }, polG);
  [[118, 258], [140, 272], [162, 256], [182, 274], [132, 282], [172, 284], [150, 264]].forEach(([x, y]) => { const c = mk("circle", { class: "dm-dotP", cx: x, cy: y, r: 3.4 }, polG); E.sorbDots.push(c); });
  mk("rect", { class: "dm-wallO", x: 82, y: 322, width: 136, height: 38, rx: 8 }, layers.src);
  E.wallIn = mk("rect", { class: "dm-wallI", x: 90, y: 330, width: 120, height: 22, rx: 5 }, layers.src);
  E.gateX = [90, 150, 210];
  E.gateX.forEach((gx, i) => {
    const g = mk("g", { opacity: "0" }, layers.src);
    mk("path", { class: "dm-gate", d: "M" + (gx - 11) + " 118L" + (gx + 11) + " 118L" + gx + " 140Z" }, g);
    E.gates.push({ g, ph: i * 2.1 });
  });
}
function initOrgans() {
  const slotE = mk("g", {}, layers.org);
  const eyeO = organ(slotE, "eye", 418, 158, 140, {});
  const rp = eyeO.ports.retina;
  E.rp = rp;
  E.retDots = [[-28, -22], [-14, 8], [6, -14], [16, 10], [-6, -30], [24, -6]].map(([dx, dy]) => mk("circle", { class: "dm-micro", cx: f1(rp[0] + dx), cy: f1(rp[1] + dy), r: 3 }, layers.org));
  const slotK = mk("g", {}, layers.org);
  const kidO = organ(slotK, "kidney", 630, 158, 90, {});
  E.pelvis = kidO.ports.pelvis;
  const slotN = mk("g", {}, layers.org);
  const nerveO = organ(slotN, "ganglion", 845, 160, 110, {});
  const sm0 = nerveO.ports.soma, ip = nerveO.ports.in, op = nerveO.ports.out;
  E.soma = sm0;
  [[(ip[0] + sm0[0]) / 2, 160], [(op[0] + sm0[0]) / 2, 160]].forEach(([x, y]) => { const g = mk("g", {}, layers.org); mk("rect", { class: "dm-myel", x: -11, y: -10, width: 22, height: 20, rx: 6 }, g); place(g, x, y, 0, 1); E.myelin.push({ g, x, y }); });
  E.nerveDots = [[-30, -26], [-10, 26], [12, -26], [30, 24], [0, 32]].map(([dx, dy]) => mk("circle", { class: "dm-dotP", cx: f1(sm0[0] + dx), cy: f1(sm0[1] + dy), r: 3 }, layers.org));
  const slotH = mk("g", {}, layers.org);
  organ(slotH, "heart", 418, 328, 85, {});
  E.heartArt = mk("path", { class: "dm-art", d: "M378 298C398 288 438 288 458 298" }, layers.org);
  E.heartPlaque = mk("ellipse", { class: "dm-plaque", cx: 418, cy: 293, rx: 19, ry: 6.5 }, layers.org);
  const slotB = mk("g", {}, layers.org);
  organ(slotB, "brain", 630, 334, 150, {});
  E.brainArt = mk("path", { class: "dm-art", d: "M562 332H698" }, layers.org);
  E.brainPlaque = mk("ellipse", { class: "dm-plaque", cx: 630, cy: 327, rx: 19, ry: 6.5 }, layers.org);
  const slotV = mk("g", {}, layers.org);
  const vesO = organ(slotV, "vessel", 845, 334, 60, {});
  const wp = vesO.ports.wall;
  E.legArt = mk("path", { class: "dm-art", d: "M" + f1(wp[0] - 4) + " 300L" + f1(wp[0] - 4) + " 368" }, layers.org);
  E.legPlaque = mk("ellipse", { class: "dm-plaque", cx: f1(wp[0]), cy: f1(wp[1]), rx: 11, ry: 8 }, layers.org);
  E.legPq = wp;
  E.ulcer = mk("circle", { class: "dm-ulcer", cx: 898, cy: 372, r: 8, opacity: "0" }, layers.org);
  E.brainPq = [630, 327];
  E.heartPq = [418, 293];
  [[418, 158, 85, 70, "Ret"], [630, 158, 70, 65, "Kid"], [845, 160, 80, 65, "Nerv"], [418, 328, 62, 72, "Macro"], [630, 334, 88, 72, "Macro"], [845, 334, 58, 82, "Limb"]].forEach(([x, y, rx, ry, k]) => {
    E.glows.push({ e: mk("ellipse", { class: "dm-glow", cx: x, cy: y, rx, ry, opacity: "0" }, layers.glow), k });
  });
  E.statSpots = [];
  [[418, 293], [630, 327], [E.legPq[0], E.legPq[1]]].forEach(([px, py]) => { [-12, 0, 12].forEach((ox) => E.statSpots.push({ x: px + ox, y: py })); });
}
function capText(d) {
  if (d === 1) return "Glucose control lowers glucose. Less AGE and sorbitol form, so organs suffer less.";
  if (d === 2) return "Pressure control relaxes arteries. Vessels widen and kidneys leak less.";
  if (d === 3) return "Statin treatment parks on plaque and steadies it. Arteries stay wider.";
  if (d === 4) return "Combined treatment protects small vessels and large arteries together.";
  return "No treatment. High glucose injures small vessels and feeds artery plaque.";
}
let capEl = null, capDrug = -1;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["gl", "Glucose", "g-gluc", "Glucose in the blood. Glucose control lowers it and slows new AGE and sorbitol formation, but damage already built up fades only partly."],
    ["age", "AGEs", "g-age", "Advanced glycation end products. They cross link proteins, thicken capillary walls and drive inflammation through their receptor."],
    ["ret", "Retina", "g-bad", "Retina damage: pericyte loss, tiny bulges in capillaries, leak and bleeding, and later fragile new vessels that can threaten sight."],
    ["kid", "Kidney", "g-fl", "Kidney damage: the glomerular filter thickens, albumin leaks into urine and filtration falls. Pressure control protects it strongly."],
    ["ner", "Nerve", "g-sorb", "Nerve damage: sorbitol stress and poor small vessel flow injure peripheral nerves, causing tingling, pain and then loss of feeling."],
    ["pla", "Plaque", "g-clot", "Arterial plaque: faster atherosclerosis in large arteries. A statin and pressure control protect the heart, brain and limbs most."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 110 + i * 150, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Glucose", 250, 98, 250, 138, "Glucose in the blood. Years of high glucose coat proteins with sugar and feed the sorbitol pathway.");
  pill(ox, "AGEs", 190, 178, 268, 185, "AGEs are sugar damaged proteins. They cross link vessel walls, thicken them and spark inflammation.");
  pill(ox, "Sorbitol", 185, 272, 266, 268, "Sorbitol builds up inside cells from extra glucose. It draws in water and weakens defences, harming nerves most.");
  pill(ox, "Eye", E.rp[0], E.rp[1], 418, 230, "Eye: leaky retinal vessels bleed and grow fragile new vessels that threaten sight.");
  pill(ox, "Kidney", E.pelvis[0], E.pelvis[1], 630, 230, "Kidney: the filter thickens and leaks albumin into urine. Pressure control protects it strongly.");
  pill(ox, "Nerve", E.soma[0], E.soma[1], 845, 230, "Nerve: sorbitol stress plus poor blood flow injures fibres, so tingling gives way to numbness.");
  pill(ox, "Plaque", E.brainPq[0], E.brainPq[1], 630, 402, "Plaque: fatty deposits narrow large arteries. A statin steadies plaque and pressure control widens flow.");
  capEl = mk("text", { class: "dm-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { G: 0.5, AGE: 0.4, Sorb: 0.4, Ret: 0.4, Kid: 0.4, Nerv: 0.4, Macro: 0.4, Limb: 0.4, glu: 0, bp: 0, stat: 0 };
const acc = { alb: 0 };
function init() { initSource(); initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.8), k1 = Math.min(1, dt * 1.4);
  Object.keys(sm).forEach((n) => { sm[n] = lerp(sm[n], m[n], n === "glu" || n === "bp" || n === "stat" ? k1 : k); });
  const wantG = Math.round(sm.G * gluc.length);
  gluc.forEach((p, i) => {
    const on = i < wantG || p.c > 0;
    if (!on) { if (p.e.getAttribute("opacity") !== "0") p.e.setAttribute("opacity", "0"); return; }
    if (!p.c && sm.glu > 0.5 && p.y < 116) {
      for (const gx of E.gateX) { if (Math.abs(p.x - gx) < 7 && Math.random() < dt * 1.6) { p.c = 1; p.vx = 0; break; } }
    }
    if (p.c) {
      p.y += 72 * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      p.e.setAttribute("opacity", clamp(1 - (p.y - 116) / 34).toFixed(2));
      if (p.y > 152) { p.c = 0; p.x = 36; p.y = 90 + (i % 3) * 6; p.e.setAttribute("opacity", "1"); }
      return;
    }
    p.x += p.vx * dt * (0.4 + sm.G);
    if (p.x > 278) { p.x = 36; p.y = 90 + (i % 3) * 6; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", "1");
  });
  E.gates.forEach((gt, i) => { gt.g.setAttribute("opacity", sm.glu.toFixed(2)); gt.g.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 500 + gt.ph) * 1.5) + ")"); });
  E.ageCross.setAttribute("opacity", clamp(sm.AGE * 1.1).toFixed(2));
  const wantS = Math.round(sm.Sorb * E.sorbDots.length);
  E.sorbDots.forEach((c, i) => c.setAttribute("opacity", i < wantS ? "1" : "0.12"));
  E.wallIn.setAttribute("height", f1(10 + 18 * sm.AGE)); E.wallIn.setAttribute("y", f1(341 - 9 * sm.AGE));
  E.retDots.forEach((c) => { c.setAttribute("opacity", clamp(sm.Ret * 1.15).toFixed(2)); c.setAttribute("r", f1(2.4 + 1.8 * sm.Ret)); });
  E.nerveDots.forEach((c, i) => c.setAttribute("opacity", (i / E.nerveDots.length < sm.Nerv ? 1 : 0.12).toFixed(2)));
  E.myelin.forEach((o) => place(o.g, o.x, o.y, 0, Math.max(0.35, 1 - 0.5 * sm.Nerv)));
  acc.alb += dt * sm.Kid * 4.5 * (1 - 0.85 * sm.bp); while (acc.alb >= 1) { acc.alb--; const p = free(alb); if (p) emit(p, E.pelvis[0] + rnd(-6, 6), E.pelvis[1] + 4, rnd(-5, 5), rnd(18, 28)); }
  alb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || p.y > 232) kill(p); });
  const ps = 0.3 + 0.85 * sm.Macro;
  E.heartPlaque.setAttribute("transform", "translate(418 293) scale(" + ps.toFixed(2) + ") translate(-418 -293)");
  E.brainPlaque.setAttribute("transform", "translate(630 327) scale(" + ps.toFixed(2) + ") translate(-630 -327)");
  E.legPlaque.setAttribute("transform", "translate(" + f1(E.legPq[0]) + " " + f1(E.legPq[1]) + ") scale(" + ps.toFixed(2) + ") translate(" + f1(-E.legPq[0]) + " " + f1(-E.legPq[1]) + ")");
  const lw = f1(3.5 + 2 * sm.bp + 1.5 * (1 - sm.Macro));
  E.heartArt.setAttribute("stroke-width", lw); E.brainArt.setAttribute("stroke-width", lw); E.legArt.setAttribute("stroke-width", lw);
  E.statSpots.forEach((s, i) => { const p = stat[i]; place(p.e, s.x, s.y - 11 + Math.sin(tm / 600 + i * 1.3) * 1.5, tm / 8, 1); p.e.setAttribute("opacity", sm.stat.toFixed(2)); });
  E.ulcer.setAttribute("opacity", clamp((sm.Limb - 0.25) * 1.6).toFixed(2));
  E.ulcer.setAttribute("r", f1(4 + 6 * sm.Limb));
  E.glows.forEach((gl) => gl.e.setAttribute("opacity", (sm[gl.k] * 0.5).toFixed(2)));
  gg.gl.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["controlled", "high", "very high"]));
  gg.age.set(sm.AGE, wordOf(sm.AGE, 0.3, 0.6, ["low", "building", "high"]));
  gg.ret.set(sm.Ret, wordOf(sm.Ret, 0.3, 0.6, ["healthy", "damaged", "severe"]));
  gg.kid.set(sm.Kid, wordOf(sm.Kid, 0.3, 0.6, ["healthy", "leaking", "failing"]));
  gg.ner.set(sm.Nerv, wordOf(sm.Nerv, 0.3, 0.6, ["healthy", "damaged", "severe"]));
  gg.pla.set(sm.Macro, wordOf(sm.Macro, 0.3, 0.6, ["clear", "narrowed", "diseased"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
