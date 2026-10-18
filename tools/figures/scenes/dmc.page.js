/* Diabetic complications scene: high glucose, AGEs, polyol pathway, small vessel organs, large vessel plaque and gauges. */
const WW = SC.W;
const layers = { src: $("src"), org: $("org"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = { myelin: [], ageDots: [], sorbDots: [], nerveDots: [] };
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gluc = pool(16, () => mk("circle", { class: "sc-p p-gluc", r: 3 }, layers.parts));
const alb = pool(10, () => mk("circle", { class: "sc-p p-alb", r: 2.6 }, layers.parts));
gluc.forEach((p, i) => { p.x = 36 + i * 15; p.y = 92 + (i % 3) * 8; p.vx = 34 + (i % 4) * 6; });
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
}
function initOrgans() {
  /* retina */
  const rG = mk("g", {}, layers.org);
  mk("ellipse", { class: "dm-eye", cx: 418, cy: 152, rx: 58, ry: 36 }, rG);
  mk("circle", { class: "dm-iris", cx: 418, cy: 152, r: 15 }, rG);
  mk("path", { class: "dm-retv", d: "M418 152L382 132M418 152L380 158M418 152L386 176M418 152L452 134M418 152L454 166" }, rG);
  E.retDots = mk("g", { opacity: "0" }, rG);
  [[388, 138], [402, 170], [438, 132], [448, 162], [372, 156], [430, 176]].forEach(([x, y]) => mk("circle", { class: "dm-micro", cx: x, cy: y, r: 3.4 }, E.retDots));
  /* kidney */
  const kG = mk("g", {}, layers.org);
  mk("path", { class: "dm-glom", d: "M608 138q22 -18 44 0q18 16 2 30q-12 12 -24 2q-22 10 -34 -6q-10 -16 12 -26" }, kG);
  mk("circle", { class: "dm-eye", cx: 630, cy: 152, r: 9 }, kG);
  mk("path", { class: "dm-tub", d: "M630 178C630 198 616 204 616 224" }, kG);
  E.glomRing = mk("circle", { class: "dm-glom", cx: 630, cy: 152, r: 27, opacity: "0.35" }, kG);
  /* nerve */
  const nG = mk("g", {}, layers.org);
  mk("path", { class: "dm-axon", d: "M766 152H924" }, nG);
  [782, 812, 842, 872, 902].forEach((x, i) => { const g = mk("g", {}, nG); mk("rect", { class: "dm-myel", x: -11, y: -10, width: 22, height: 20, rx: 6 }, g); place(g, x, 152, 0, 1); E.myelin.push(g); });
  [[790, 140], [820, 164], [850, 140], [880, 164], [905, 142]].forEach(([x, y]) => { const c = mk("circle", { class: "dm-dotP", cx: x, cy: y, r: 3 }, nG); E.nerveDots.push(c); });
  /* heart */
  const hG = mk("g", {}, layers.org);
  E.heartCav = mk("circle", { class: "dm-cav", cx: 418, cy: 332, r: 13 }, hG);
  E.heartRing = mk("circle", { class: "dm-ring", cx: 418, cy: 332, r: 30 }, hG);
  E.heartRing.setAttribute("stroke-width", "30");
  mk("path", { class: "dm-art", d: "M372 302C396 286 440 286 464 302" }, hG);
  E.heartPlaque = mk("path", { class: "dm-plaque", d: "M398 292q20 -10 40 0q-6 10 -20 10q-14 0 -20 -10Z" }, hG);
  /* brain */
  const bG = mk("g", {}, layers.org);
  mk("ellipse", { class: "dm-brain", cx: 630, cy: 332, rx: 52, ry: 38 }, bG);
  mk("path", { class: "dm-fold", d: "M596 314q14 -12 28 0q14 10 28 0M592 338q16 10 32 0q16 -8 34 2M606 356q12 8 26 0" }, bG);
  mk("path", { class: "dm-art", d: "M584 332H676" }, bG);
  E.brainPlaque = mk("path", { class: "dm-plaque", d: "M612 326q18 -9 36 0q-5 9 -18 9q-13 0 -18 -9Z" }, bG);
  /* limb */
  const lG = mk("g", {}, layers.org);
  mk("ellipse", { class: "dm-limb", cx: 845, cy: 332, rx: 52, ry: 34 }, lG);
  mk("path", { class: "dm-art", d: "M800 324C824 314 866 314 892 326" }, lG);
  E.limbPlaque = mk("path", { class: "dm-plaque", d: "M828 316q18 -9 36 0q-5 9 -18 9q-13 0 -18 -9Z" }, lG);
  E.ulcer = mk("circle", { class: "dm-ulcer", cx: 888, cy: 350, r: 8, opacity: "0" }, lG);
}
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
  pill(ox, "Glucose", 240, 92, 240, 64, "Glucose in the blood. When it stays high for years it glycates proteins and feeds the polyol pathway.");
  pill(ox, "AGEs", 218, 185, 258, 185, "Advanced glycation end products: sugar modified proteins that cross link, stiffen and thicken vessel walls and spark inflammation.");
  pill(ox, "Polyol path", 218, 268, 262, 268, "The polyol pathway: aldose reductase turns extra glucose into sorbitol. NADPH is used up, antioxidant defence weakens and cells swell.");
  pill(ox, "Thick wall", 218, 341, 260, 341, "Thickened capillary basement membrane: AGE cross links and sugar driven injury make small vessel walls thick, stiff and leaky.");
  pill(ox, "Leak", 440, 165, 418, 218, "Leaky retinal vessels: damaged capillaries leak fluid and blood, form tiny bulges and later grow fragile new vessels.");
  pill(ox, "Albumin", 657, 152, 692, 152, "Albumin leak: a damaged glomerular filter lets albumin pass into the urine, an early sign of diabetic kidney disease.");
  pill(ox, "Sorbitol", 845, 166, 845, 218, "Sorbitol in nerve cells: polyol pathway stress plus poor nerve blood flow injures the axon and its myelin sheath.");
  pill(ox, "Plaque", 418, 297, 418, 390, "Coronary plaque: fatty atherosclerotic plaque in the artery on the heart. It narrows flow and can rupture to cause a heart attack.");
  pill(ox, "Narrowing", 630, 330, 630, 390, "Narrowed brain artery: atherosclerosis narrows arteries to the brain and raises stroke risk.");
  pill(ox, "Low flow", 846, 320, 845, 390, "Poor limb flow: narrowed leg arteries plus numb feet raise ulcer and amputation risk, because injuries are felt late and heal slowly.");
}
const sm = { G: 0.5, AGE: 0.4, Sorb: 0.4, Ret: 0.4, Kid: 0.4, Nerv: 0.4, Macro: 0.4, Limb: 0.4 };
const acc = { alb: 0 };
function init() { initSource(); initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.8);
  Object.keys(sm).forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const wantG = Math.round(sm.G * gluc.length);
  gluc.forEach((p, i) => { const on = i < wantG; p.e.setAttribute("opacity", on ? "1" : "0"); if (!on) return; p.x += p.vx * dt * (0.4 + sm.G); if (p.x > 278) { p.x = 36; p.y = 92 + (i % 3) * 8; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  E.ageCross.setAttribute("opacity", clamp(sm.AGE * 1.1).toFixed(2));
  const wantS = Math.round(sm.Sorb * E.sorbDots.length);
  E.sorbDots.forEach((c, i) => c.setAttribute("opacity", i < wantS ? "1" : "0.12"));
  E.wallIn.setAttribute("height", f1(10 + 18 * sm.AGE)); E.wallIn.setAttribute("y", f1(341 - 9 * sm.AGE));
  E.retDots.setAttribute("opacity", clamp(sm.Ret * 1.15).toFixed(2));
  E.glomRing.setAttribute("r", f1(24 + 6 * sm.Kid));
  acc.alb += dt * sm.Kid * 4.5; while (acc.alb >= 1) { acc.alb--; const p = free(alb); if (p) emit(p, 624 + rnd(-6, 10), 176, rnd(-5, 5), rnd(18, 28)); }
  alb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || p.y > 228) kill(p); });
  E.myelin.forEach((g, i) => place(g, [782, 812, 842, 872, 902][i], 152, 0, Math.max(0.35, 1 - 0.5 * sm.Nerv)));
  const wantN = Math.round(sm.Nerv * E.nerveDots.length);
  E.nerveDots.forEach((c, i) => c.setAttribute("opacity", i < wantN ? "1" : "0.12"));
  const ps = 0.25 + 0.95 * sm.Macro;
  E.heartPlaque.setAttribute("transform", "translate(418 297) scale(" + ps.toFixed(2) + ") translate(-418 -297)");
  E.brainPlaque.setAttribute("transform", "translate(630 330) scale(" + ps.toFixed(2) + ") translate(-630 -330)");
  E.limbPlaque.setAttribute("transform", "translate(846 320) scale(" + ps.toFixed(2) + ") translate(-846 -320)");
  E.ulcer.setAttribute("opacity", clamp((sm.Limb - 0.25) * 1.6).toFixed(2));
  E.ulcer.setAttribute("r", f1(4 + 6 * sm.Limb));
  gg.gl.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["controlled", "high", "very high"]));
  gg.age.set(sm.AGE, wordOf(sm.AGE, 0.3, 0.6, ["low", "building", "high"]));
  gg.ret.set(sm.Ret, wordOf(sm.Ret, 0.3, 0.6, ["healthy", "damaged", "severe"]));
  gg.kid.set(sm.Kid, wordOf(sm.Kid, 0.3, 0.6, ["healthy", "leaking", "failing"]));
  gg.ner.set(sm.Nerv, wordOf(sm.Nerv, 0.3, 0.6, ["healthy", "damaged", "severe"]));
  gg.pla.set(sm.Macro, wordOf(sm.Macro, 0.3, 0.6, ["clear", "narrowed", "diseased"]));
}
run({ init, step });
