/* Kidney stones scene: supersaturated urine, nucleation, stone growth and movement, blockage, swelling, colic and gauges. */
const WW = SC.W;
const layers = { tract: $("tract"), hydro: $("hydro"), urine: $("urine"), crys: $("crystals"), stone: $("stoneG"), bugs: $("bugs"), waves: $("waves"), scopeG: $("scopeG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const UPTS = [[226, 210], [320, 220], [395, 246], [445, 296], [505, 336], [600, 351], [674, 351]];
const utrack = track(UPTS);
const stoneUByLevel = [0.03, 0.22, 0.54];
const stonePosByLevel = [[188, 198], null, null];
stonePosByLevel[1] = (() => { const p = utrack.at(0.22); return [p.x, p.y]; })();
stonePosByLevel[2] = (() => { const p = utrack.at(0.54); return [p.x, p.y]; })();
const stoneBase = stonePosByLevel[2];
/* ---- static anatomy ---- */
function initAnatomy() {
  const T = layers.tract;
  mk("path", { class: "ks-kid", d: "M118 88C72 92 50 138 54 196C58 256 92 302 148 306C188 309 216 282 226 238C234 202 230 158 210 122C194 94 158 84 118 88Z" }, T);
  mk("path", { class: "ks-ureter", d: "M226 210L320 220L395 246L445 296L505 336L600 351L674 351" }, T);
  mk("path", { class: "ks-ureter-in", d: "M226 210L320 220L395 246L445 296L505 336L600 351L674 351" }, T);
  mk("ellipse", { class: "ks-blad", cx: 762, cy: 352, rx: 90, ry: 56 }, T);
  mk("path", { class: "ks-blad", d: "M742 404L752 424h20l10 -20" }, T);
  mk("path", { class: "ks-cal", d: "M188 180L150 132M188 196L138 178M188 214L148 252" }, T);
  mk("ellipse", { class: "ks-kid-in", cx: 188, cy: 198, rx: 34, ry: 44 }, T);
  const hy = mk("ellipse", { id: "hydroEl", class: "ks-hydro", cx: 188, cy: 198, rx: 52, ry: 62 }, layers.hydro);
  hy.setAttribute("opacity", "0");
  /* pain arcs, shock arcs and scope, all repositioned in step */
  const Wv = layers.waves;
  for (let i = 0; i < 3; i++) mk("path", { class: "ks-pain", id: "pain" + i, d: "M" + (14 + i * 9) + " " + (-12 - i * 4) + "a" + (18 + i * 8) + " " + (18 + i * 8) + " 0 0 1 0 " + (24 + i * 8) }, Wv);
  for (let i = 0; i < 3; i++) mk("path", { class: "ks-shock", id: "shock" + i, d: "M0 -16a16 16 0 0 1 0 32" }, layers.scopeG);
  mk("path", { id: "scopePath", class: "ks-scope", d: "M674 351L600 351" }, layers.scopeG);
  mk("circle", { id: "scopeTip", class: "ks-scope-tip", r: 4, cx: 674, cy: 351 }, layers.scopeG);
  /* stone with facets and lithotripsy fragments */
  const S = layers.stone;
  const sg = mk("g", { id: "stoneMain" }, S);
  mk("path", { class: "ks-stone", d: "M-13 -6L-5 -14L7 -12L14 -3L11 9L2 15L-9 11L-15 3Z" }, sg);
  mk("path", { class: "ks-facet", d: "M-13 -6L2 0L7 -12M2 0L11 9M2 0L-9 11" }, sg);
  const fg = mk("g", { id: "fragG" }, S);
  for (let i = 0; i < 6; i++) { const a = i * 1.05, fx = Math.cos(a) * 22, fy = Math.sin(a) * 16; mk("path", { class: "ks-stone", d: "M-4 -3L3 -4L5 2L0 5L-4 2Z", transform: "translate(" + f1(fx) + " " + f1(fy) + ") rotate(" + (i * 40) + ")" }, fg); }
  fg.setAttribute("opacity", "0");
  /* infection bugs in pelvis and bladder */
  const B = layers.bugs;
  [[176, 182], [198, 214], [716, 338], [782, 366], [806, 336]].forEach(([x, y], i) => { const g = mk("g", { class: "cl cl-bug bug", transform: "translate(" + x + " " + y + ") rotate(" + (i * 37) + ")" }, B); mk("ellipse", { class: "cl-b", rx: 6, ry: 3 }, g); });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const urineP = pool(26, () => mk("circle", { class: "sc-p p-urine", r: 2.6 }, layers.urine));
const crysP = pool(22, () => mk("path", { class: "sc-p p-crys", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.crys));
const dropP = pool(16, () => mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const fragP = pool(12, () => mk("path", { class: "sc-p p-frag", d: "M0 -3L3 1L-2 3Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let stonePillEl = null, hydroPillEl = null, shockPillEl = null, scopePillEl = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ss", "Saturation", "g-ss", "How concentrated the urine is with stone forming solutes. Above saturation, crystals can form."], ["st", "Stone size", "g-st", "Size of the stone. Small stones may pass; large stones tend to stick."], ["ob", "Blockage", "g-ob", "How much the stone blocks urine flow in the ureter."], ["hy", "Swelling", "g-hy", "Hydronephrosis: the renal pelvis and calyces swell when urine is held back."], ["pa", "Pain", "g-bad", "Ureteric colic: severe waving loin to groin pain as the ureter squeezes against the stone."], ["inf", "Infection", "g-bac", "Risk of infection in held back urine. Infected blockage is dangerous and needs urgent drainage in practice."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 105, 130, 80, 90, "Kidney: makes urine. Stones often start in its renal pelvis and may sit there without pain.");
  pill(ox, "Renal pelvis", 188, 170, 200, 132, "Renal pelvis: the funnel that collects urine from the calyces. Crystals can nucleate and grow here.");
  hydroPillEl = pill(ox, "Dilated pelvis", 210, 180, 315, 158, "Dilated pelvis: in hydronephrosis the pelvis and calyces are swollen with held back urine.");
  pill(ox, "Ureter", 410, 255, 382, 205, "Ureter: the narrow tube carrying urine to the bladder. A stone sticking here causes colic and blockage.");
  pill(ox, "Bladder", 750, 310, 762, 278, "Bladder: stores urine. A passed stone leaves through here, and a scope is passed up from here.");
  pill(ox, "Crystals", 170, 225, 105, 338, "Crystals: when urine is supersaturated, tiny crystals nucleate, grow and stick together into a stone.");
  stonePillEl = pill(ox, "Stone", stoneBase[0], stoneBase[1], 375, 365, "The stone. Its size and position decide pain, blockage and whether it can pass on its own.");
  shockPillEl = pill(ox, "Shock waves", 540, 275, 625, 238, "Lithotripsy: shock waves focused from outside the body fragment the stone so pieces can pass.");
  scopePillEl = pill(ox, "Scope", 600, 355, 625, 405, "Ureteroscopy: a fine scope passed up the ureter to see, fragment and remove the stone.");
  hydroPillEl.style.opacity = "0"; shockPillEl.style.opacity = "0"; scopePillEl.style.opacity = "0";
}
const sm = { SS: 0.7, St: 0.5, Ob: 0.4, Hy: 0.3, Pa: 0.4, Inf: 0.3, Fl: 0.6, fluids: 0, litho: 0, scp: 0, sx: 188, sy: 198, su: 0.03 };
const acc = { crys: 0, drop: 0, frag: 0 };
function init() { initAnatomy(); initPanel(); urineP.forEach((p, i) => { p.on = true; p.u = i / urineP.length; p.e.setAttribute("opacity", "1"); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.SS = lerp(sm.SS, m.SS, k2); sm.St = lerp(sm.St, m.St, k2); sm.Ob = lerp(sm.Ob, m.Ob, k1); sm.Hy = lerp(sm.Hy, m.Hy, k2); sm.Pa = lerp(sm.Pa, m.Pa, k1); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.Fl = lerp(sm.Fl, m.Fl, k1);
  sm.fluids = lerp(sm.fluids, m.fluids, k1); sm.litho = lerp(sm.litho, m.litho, k1); sm.scp = lerp(sm.scp, m.scope, k1);
  const tgt = stonePosByLevel[level], tu = stoneUByLevel[level];
  sm.sx = lerp(sm.sx, tgt[0], k2); sm.sy = lerp(sm.sy, tgt[1], k2); sm.su = lerp(sm.su, tu, k2);
  /* hydronephrosis swelling */
  const hy = $("hydroEl"); if (hy) { hy.setAttribute("opacity", (sm.Hy * 0.85).toFixed(2)); hy.setAttribute("rx", f1(34 + 22 * sm.Hy)); hy.setAttribute("ry", f1(44 + 20 * sm.Hy)); }
  if (hydroPillEl) hydroPillEl.style.opacity = sm.Hy.toFixed(2);
  /* stone position, size and pill following it */
  const stoneScale = (0.45 + sm.St * 1.05) * (1 - sm.litho * 0.25);
  const sg = $("stoneMain"); if (sg) sg.setAttribute("transform", "translate(" + f1(sm.sx) + " " + f1(sm.sy) + ") rotate(" + f1(Math.sin(tm / 700) * 4) + ") scale(" + stoneScale.toFixed(3) + ")");
  const fg = $("fragG"); if (fg) { fg.setAttribute("transform", "translate(" + f1(sm.sx) + " " + f1(sm.sy) + ") scale(" + (stoneScale * (0.7 + 0.1 * Math.sin(tm / 300))).toFixed(3) + ")"); fg.setAttribute("opacity", sm.litho.toFixed(2)); }
  if (stonePillEl) stonePillEl.setAttribute("transform", "translate(" + f1(sm.sx - stoneBase[0]) + " " + f1(sm.sy - stoneBase[1]) + ")");
  /* pain arcs at the stone */
  for (let i = 0; i < 3; i++) { const el = $("pain" + i); if (el) { el.setAttribute("transform", "translate(" + f1(sm.sx) + " " + f1(sm.sy) + ")"); el.setAttribute("opacity", (sm.Pa * clamp(0.35 + 0.65 * Math.sin(tm / 420 + i * 0.9) * 0.5 + 0.5)).toFixed(2)); } }
  /* infection bugs fade in with risk */
  layers.bugs.querySelectorAll(".bug").forEach((g, i) => { g.style.opacity = clamp(sm.Inf * 1.4 - i * 0.08).toFixed(2); });
  /* supersaturation crystals swirling in the pelvis */
  acc.crys += dt * sm.SS * 10; while (acc.crys >= 1) { acc.crys--; const p = freeP(crysP); if (p) emit(p, rnd(162, 214), rnd(166, 230), rnd(-7, 7), rnd(-5, 5)); }
  crysP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.25; p.y += p.vy * dt; if (p.x < 158) p.vx = Math.abs(p.vx); if (p.x > 218) p.vx = -Math.abs(p.vx); if (p.y < 162) p.vy = Math.abs(p.vy); if (p.y > 234) p.vy = -Math.abs(p.vy); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) kill(p); });
  /* urine flow along the ureter, slowed and held above a blockage */
  const spd = clamp(sm.Fl) * 0.055;
  urineP.forEach((p) => { let v = spd * (p.u > sm.su - 0.02 && p.u < sm.su + 0.05 ? 1 - sm.Ob * 0.85 : 1); p.u += v * dt * 10; if (p.u > 1) p.u -= 1; const q = utrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.65 * clamp(sm.Fl + 0.25)).toFixed(2)); });
  /* fluid droplets into the kidney when fluids are chosen */
  acc.drop += dt * sm.fluids * 7; while (acc.drop >= 1) { acc.drop--; const p = freeP(dropP); if (p) emit(p, rnd(150, 220), 118, rnd(-3, 3), rnd(16, 24)); }
  dropP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 232 || p.t > 5) kill(p); });
  /* lithotripsy: shock arcs converge on the stone, fragments drift down the ureter */
  for (let i = 0; i < 3; i++) { const el = $("shock" + i); if (el) { const ph = (tm / 650 + i * 0.33) % 1; el.setAttribute("transform", "translate(" + f1(sm.sx + 54 - ph * 26) + " " + f1(sm.sy - 30 + ph * 12) + ") scale(" + (1 - ph * 0.35).toFixed(2) + ")"); el.setAttribute("opacity", (sm.litho * (1 - ph)).toFixed(2)); } }
  if (shockPillEl) shockPillEl.style.opacity = sm.litho.toFixed(2);
  acc.frag += dt * sm.litho * 5; while (acc.frag >= 1) { acc.frag--; const p = freeP(fragP); if (p) { emit(p, sm.sx, sm.sy, rnd(8, 18), rnd(4, 10)); p.u = sm.su; } }
  fragP.forEach((p) => { if (!p.on) return; p.t += dt; p.u += dt * 0.045; if (p.u > 1 || p.t > 7) { kill(p); return; } const q = utrack.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 4) + ")"); });
  /* ureteroscopy: a scope line from the bladder up to the stone */
  const sp = $("scopePath"), stp = $("scopeTip");
  if (sp && stp) { let d = ""; for (let u = 1; u >= sm.su; u -= 0.06) { const q = utrack.at(clamp(u)); d += (d ? "L" : "M") + f1(q.x) + " " + f1(q.y); } const q0 = utrack.at(sm.su); d += "L" + f1(q0.x) + " " + f1(q0.y); sp.setAttribute("d", d); sp.setAttribute("opacity", sm.scp.toFixed(2)); stp.setAttribute("cx", f1(sm.sx)); stp.setAttribute("cy", f1(sm.sy)); stp.setAttribute("opacity", sm.scp.toFixed(2)); }
  if (scopePillEl) scopePillEl.style.opacity = sm.scp.toFixed(2);
  /* gauges */
  gg.ss.set(sm.SS, wordOf(sm.SS, 0.35, 0.65, ["dilute", "near limit", "supersaturated"])); gg.st.set(sm.St, wordOf(sm.St, 0.4, 0.72, ["tiny", "small", "large"])); gg.ob.set(sm.Ob, wordOf(sm.Ob, 0.22, 0.55, ["none", "partial", "blocked"]));
  gg.hy.set(sm.Hy, wordOf(sm.Hy, 0.22, 0.55, ["none", "mild", "marked"])); gg.pa.set(sm.Pa, wordOf(sm.Pa, 0.25, 0.55, ["mild", "moderate", "severe"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.25, 0.55, ["low", "raised", "high"]));
}
run({ init, step });
