/* Kidney stones scene: supersaturated urine, nucleation, stone growth and movement, blockage, swelling, colic and gauges. */
const WW = SC.W;
const layers = { kidney: $("kidneySlot"), bladder: $("bladderSlot"), tube: $("ureterTube"), tubeIn: $("ureterIn"), hydro: $("hydro"), backup: $("backupG"), urine: $("urine"), crys: $("crystals"), stone: $("stoneG"), bugs: $("bugs"), waves: $("waves"), scopeG: $("scopeG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const stoneU = [0.005, 0.165, 0.6];
let utrack = null, stonePos = [[144, 196], [150, 308], [454, 293]], stoneBase = [454, 293], pelvisP = [144, 196];
let kidO = null, bladO = null, capEl = null, capDrug = -1;
/* ---- real organ art, with the ureter anchored on the kidney and bladder ports ---- */
function initOrgans() {
  kidO = organ(layers.kidney, "kidney", 170, 215, 185, {});
  bladO = organ(layers.bladder, "bladder", 762, 322, 140, {});
  const P = kidO.ports.pelvis, O = kidO.ports.out, E = bladO.ports.in;
  pelvisP = [Math.round(P[0]), Math.round(P[1])];
  const UPTS = [P, [O[0] - 2, (P[1] + O[1]) / 2], O, [240, 322], [330, 312], [460, 292], [580, 262], [655, 240], E];
  const d = UPTS.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("");
  layers.tube.setAttribute("d", d); layers.tubeIn.setAttribute("d", d);
  utrack = track(UPTS);
  stonePos = stoneU.map((u) => { const q = utrack.at(u); return [Math.round(q.x), Math.round(q.y)]; });
  stoneBase = stonePos[2];
  sm.sx = stonePos[1][0]; sm.sy = stonePos[1][1]; sm.su = stoneU[1];
}
function capText(d) {
  if (d === 1) return "Fluids dilute the urine and ease pain. Small stones may pass.";
  if (d === 2) return "Shock waves break the stone into small pieces that can pass.";
  if (d === 3) return "The scope grabs and removes the stone. Urine flows again.";
  return "No treatment. The stone blocks urine flow and pain comes in waves.";
}
/* ---- static anatomy ---- */
function initAnatomy() {
  const hy = mk("ellipse", { id: "hydroEl", class: "ks-hydro", cx: pelvisP[0], cy: pelvisP[1], rx: 34, ry: 44 }, layers.hydro);
  hy.setAttribute("opacity", "0");
  mk("ellipse", { id: "diluteEl", class: "ks-dilute", cx: pelvisP[0], cy: pelvisP[1], rx: 40, ry: 48 }, layers.hydro);
  const bq = utrack.at(0.5);
  const bk = mk("ellipse", { id: "backupEl", class: "ks-backup", cx: f1(bq.x), cy: f1(bq.y), rx: 24, ry: 13 }, layers.backup);
  bk.setAttribute("opacity", "0");
  /* pain arcs, shock arcs, flash ring and basket, all repositioned in step */
  const Wv = layers.waves;
  for (let i = 0; i < 3; i++) mk("path", { class: "ks-pain", id: "pain" + i, d: "M" + (14 + i * 9) + " " + (-12 - i * 4) + "a" + (18 + i * 8) + " " + (18 + i * 8) + " 0 0 1 0 " + (24 + i * 8) }, Wv);
  for (let i = 0; i < 3; i++) mk("path", { class: "ks-shock", id: "shock" + i, d: "M0 -16a16 16 0 0 1 0 32" }, layers.scopeG);
  mk("circle", { id: "flash", class: "ks-flash", r: 20, cx: stoneBase[0], cy: stoneBase[1] }, layers.scopeG);
  mk("path", { id: "scopePath", class: "ks-scope", d: "M727 211" }, layers.scopeG);
  mk("circle", { id: "scopeTip", class: "ks-scope-tip", r: 7, cx: stoneBase[0], cy: stoneBase[1] }, layers.scopeG);
  mk("circle", { id: "basket", class: "ks-basket", r: 30, cx: stoneBase[0], cy: stoneBase[1] }, layers.scopeG);
  /* stone with facets and lithotripsy fragments */
  const S = layers.stone;
  const sg = mk("g", { id: "stoneMain" }, S);
  mk("path", { class: "ks-stone", d: "M-13 -6L-5 -14L7 -12L14 -3L11 9L2 15L-9 11L-15 3Z" }, sg);
  mk("path", { class: "ks-facet", d: "M-13 -6L2 0L7 -12M2 0L11 9M2 0L-9 11" }, sg);
  const fg = mk("g", { id: "fragG" }, S);
  for (let i = 0; i < 6; i++) { const a = i * 1.05, fx = Math.cos(a) * 22, fy = Math.sin(a) * 16; mk("path", { class: "ks-stone", d: "M-4 -3L3 -4L5 2L0 5L-4 2Z", transform: "translate(" + f1(fx) + " " + f1(fy) + ") rotate(" + (i * 40) + ")" }, fg); }
  fg.setAttribute("opacity", "0");
  /* infection bugs in pelvis and bladder */
  const B = layers.bugs, T = bladO.ports.trigone;
  [[pelvisP[0] - 10, pelvisP[1] - 12], [pelvisP[0] + 12, pelvisP[1] + 12], [T[0] - 25, T[1] - 25], [T[0] + 25, T[1] - 15], [T[0] - 2, T[1] + 22]].forEach(([x, y], i) => { const g = mk("g", { class: "cl cl-bug bug", transform: "translate(" + x + " " + y + ") rotate(" + (i * 37) + ")" }, B); mk("ellipse", { class: "cl-b", rx: 6, ry: 3 }, g); });
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
let stonePillEl = null, shockPillEl = null, scopePillEl = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ss", "Saturation", "g-ss", "How concentrated the urine is with stone forming solutes. Above saturation, crystals can form."], ["st", "Stone size", "g-st", "Size of the stone. Small stones may pass; large stones tend to stick."], ["ob", "Blockage", "g-ob", "How much the stone blocks urine flow in the ureter."], ["hy", "Swelling", "g-hy", "Hydronephrosis: the kidney pelvis swells when urine is held back."], ["pa", "Pain", "g-bad", "Ureteric colic: severe waving loin to groin pain as the ureter squeezes against the stone."], ["inf", "Infection", "g-bac", "Risk of infection in held back urine. Infected blockage is dangerous and needs urgent drainage in practice."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, ip = stonePos[1];
  pill(ox, "Kidney", 100, 160, 86, 94, "Kidney: makes urine. Stones often start in its renal pelvis and may sit there without pain.");
  pill(ox, "Crystals", pelvisP[0] + 16, pelvisP[1] + 24, 105, 338, "Crystals: when urine is supersaturated, tiny crystals gather and stick together. Calcium oxalate is the commonest stone type; uric acid, struvite and cystine are other types.");
  pill(ox, "Ureter", 329, 312, 360, 240, "Ureter: the narrow tube carrying urine to the bladder. A stone sticking here causes colic and blockage.");
  pill(ox, "Swelling", pelvisP[0] + 6, pelvisP[1] - 46, 330, 120, "Swelling: in hydronephrosis the pelvis is swollen with held back urine. It drains away once flow returns.");
  pill(ox, "Bladder", bladO.ports.dome[0], bladO.ports.dome[1], 792, 246, "Bladder: stores urine. A passed stone leaves through here, and a scope is passed up from here.");
  stonePillEl = pill(ox, "Stone", ip[0], ip[1], ip[0] - 75, ip[1] + 70, "The stone. Its size and position decide pain, blockage and whether it can pass on its own.");
  shockPillEl = pill(ox, "Shock waves", ip[0] + 25, ip[1] - 20, ip[0] + 105, ip[1] - 55, "Lithotripsy: shock waves focused from outside the body fragment the stone so pieces can pass.");
  scopePillEl = pill(ox, "Scope", ip[0], ip[1] + 10, ip[0] + 95, ip[1] + 60, "Ureteroscopy: a fine scope passed up the ureter to grab and remove the stone.");
  shockPillEl.style.opacity = "0"; scopePillEl.style.opacity = "0";
  capEl = mk("text", { class: "ks-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { SS: 0.7, St: 0.5, Ob: 0.4, Hy: 0.3, Pa: 0.4, Inf: 0.3, Fl: 0.6, fluids: 0, litho: 0, scp: 0, sx: 150, sy: 308, su: 0.165 };
const acc = { crys: 0, drop: 0, frag: 0 };
function init() { initOrgans(); initAnatomy(); initPanel(); urineP.forEach((p, i) => { p.on = true; p.u = i / urineP.length; p.e.setAttribute("opacity", "1"); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.SS = lerp(sm.SS, m.SS, k2); sm.St = lerp(sm.St, m.St, k2); sm.Ob = lerp(sm.Ob, m.Ob, k1); sm.Hy = lerp(sm.Hy, m.Hy, k2); sm.Pa = lerp(sm.Pa, m.Pa, k1); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.Fl = lerp(sm.Fl, m.Fl, k1);
  sm.fluids = lerp(sm.fluids, m.fluids, k1); sm.litho = lerp(sm.litho, m.litho, k1); sm.scp = lerp(sm.scp, m.scope, k1);
  const tgt = stonePos[level], tu = stoneU[level];
  sm.sx = lerp(sm.sx, tgt[0], k2); sm.sy = lerp(sm.sy, tgt[1], k2); sm.su = lerp(sm.su, tu, k2);
  /* hydronephrosis swelling and the fluids dilution wash in the pelvis */
  const hy = $("hydroEl"); if (hy) { hy.setAttribute("opacity", (sm.Hy * 0.85).toFixed(2)); hy.setAttribute("rx", f1(34 + 26 * sm.Hy)); hy.setAttribute("ry", f1(44 + 24 * sm.Hy)); }
  const di = $("diluteEl"); if (di) di.setAttribute("opacity", (sm.fluids * 0.35).toFixed(2));
  /* held back urine pooling above the blockage */
  const bk = $("backupEl"); if (bk) { const q = utrack.at(clamp(sm.su - 0.1)); bk.setAttribute("cx", f1(q.x)); bk.setAttribute("cy", f1(q.y)); bk.setAttribute("transform", "rotate(" + f1(q.a) + " " + f1(q.x) + " " + f1(q.y) + ")"); bk.setAttribute("opacity", (sm.Ob * 0.7).toFixed(2)); }
  /* stone position, size and pills following it */
  const stoneScale = (0.45 + sm.St * 1.05) * (1 - sm.litho * 0.25);
  const sg = $("stoneMain"); if (sg) { sg.setAttribute("transform", "translate(" + f1(sm.sx) + " " + f1(sm.sy) + ") rotate(" + f1(Math.sin(tm / 700) * 4) + ") scale(" + stoneScale.toFixed(3) + ")"); sg.setAttribute("opacity", (1 - 0.8 * sm.scp).toFixed(2)); }
  const fg = $("fragG"); if (fg) { fg.setAttribute("transform", "translate(" + f1(sm.sx) + " " + f1(sm.sy) + ") scale(" + (stoneScale * (0.7 + 0.1 * Math.sin(tm / 300))).toFixed(3) + ")"); fg.setAttribute("opacity", sm.litho.toFixed(2)); }
  const dx = f1(sm.sx - stonePos[1][0]), dy = f1(sm.sy - stonePos[1][1]);
  if (stonePillEl) stonePillEl.setAttribute("transform", "translate(" + dx + " " + dy + ")");
  if (shockPillEl) shockPillEl.setAttribute("transform", "translate(" + dx + " " + dy + ")");
  if (scopePillEl) scopePillEl.setAttribute("transform", "translate(" + dx + " " + dy + ")");
  /* pain arcs at the stone */
  for (let i = 0; i < 3; i++) { const el = $("pain" + i); if (el) { el.setAttribute("transform", "translate(" + f1(sm.sx) + " " + f1(sm.sy) + ")"); el.setAttribute("opacity", (sm.Pa * clamp(0.35 + 0.65 * Math.sin(tm / 420 + i * 0.9) * 0.5 + 0.5)).toFixed(2)); } }
  /* infection bugs fade in with risk */
  layers.bugs.querySelectorAll(".bug").forEach((g, i) => { g.style.opacity = clamp(sm.Inf * 1.4 - i * 0.08).toFixed(2); });
  /* supersaturation crystals swirling in the pelvis */
  const cx0 = pelvisP[0] - 26, cx1 = pelvisP[0] + 26, cy0 = pelvisP[1] - 30, cy1 = pelvisP[1] + 30;
  acc.crys += dt * sm.SS * 10; while (acc.crys >= 1) { acc.crys--; const p = freeP(crysP); if (p) emit(p, rnd(cx0, cx1), rnd(cy0, cy1), rnd(-7, 7), rnd(-5, 5)); }
  crysP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.25; p.y += p.vy * dt; if (p.x < cx0) p.vx = Math.abs(p.vx); if (p.x > cx1) p.vx = -Math.abs(p.vx); if (p.y < cy0) p.vy = Math.abs(p.vy); if (p.y > cy1) p.vy = -Math.abs(p.vy); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1.2 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) kill(p); });
  /* urine flow along the ureter, slowed and held above a blockage */
  const spd = clamp(sm.Fl) * 0.055;
  urineP.forEach((p) => { const v = spd * (p.u > sm.su - 0.02 && p.u < sm.su + 0.05 ? 1 - sm.Ob * 0.85 : 1); p.u += v * dt * 10; if (p.u > 1) p.u -= 1; const q = utrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.65 * clamp(sm.Fl + 0.25)).toFixed(2)); });
  /* fluid droplets into the kidney when fluids are chosen */
  acc.drop += dt * sm.fluids * 7; while (acc.drop >= 1) { acc.drop--; const p = freeP(dropP); if (p) emit(p, rnd(130, 210), 118, rnd(-3, 3), rnd(16, 24)); }
  dropP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > pelvisP[1] + 14 || p.t > 5) kill(p); });
  /* lithotripsy: shock arcs converge on the stone, a flash ring pulses, fragments drift down the ureter */
  for (let i = 0; i < 3; i++) { const el = $("shock" + i); if (el) { const ph = (tm / 650 + i * 0.33) % 1; el.setAttribute("transform", "translate(" + f1(sm.sx + 54 - ph * 26) + " " + f1(sm.sy - 30 + ph * 12) + ") scale(" + (1 - ph * 0.35).toFixed(2) + ")"); el.setAttribute("opacity", (sm.litho * (1 - ph)).toFixed(2)); } }
  const fl = $("flash"); if (fl) { const ph = (tm / 650) % 1; fl.setAttribute("cx", f1(sm.sx)); fl.setAttribute("cy", f1(sm.sy)); fl.setAttribute("r", f1(16 + 14 * ph)); fl.setAttribute("opacity", (sm.litho * (1 - ph)).toFixed(2)); }
  if (shockPillEl) shockPillEl.style.opacity = sm.litho.toFixed(2);
  acc.frag += dt * sm.litho * 5; while (acc.frag >= 1) { acc.frag--; const p = freeP(fragP); if (p) { emit(p, sm.sx, sm.sy, rnd(8, 18), rnd(4, 10)); p.u = sm.su; } }
  fragP.forEach((p) => { if (!p.on) return; p.t += dt; p.u += dt * 0.045; if (p.u > 1 || p.t > 7) { kill(p); return; } const q = utrack.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 4) + ")"); });
  /* ureteroscopy: a scope line from the bladder up to the stone, with a basket grabbing it */
  const sp = $("scopePath"), stp = $("scopeTip"), bk2 = $("basket");
  if (sp && stp) { let d = ""; for (let u = 1; u >= sm.su; u -= 0.06) { const q = utrack.at(clamp(u)); d += (d ? "L" : "M") + f1(q.x) + " " + f1(q.y); } const q0 = utrack.at(sm.su); d += "L" + f1(q0.x) + " " + f1(q0.y); sp.setAttribute("d", d); sp.setAttribute("opacity", sm.scp.toFixed(2)); stp.setAttribute("cx", f1(sm.sx)); stp.setAttribute("cy", f1(sm.sy)); stp.setAttribute("opacity", sm.scp.toFixed(2)); }
  if (bk2) { bk2.setAttribute("cx", f1(sm.sx)); bk2.setAttribute("cy", f1(sm.sy)); bk2.setAttribute("r", f1(22 * stoneScale + 8 + Math.sin(tm / 400) * 2)); bk2.setAttribute("opacity", sm.scp.toFixed(2)); }
  if (scopePillEl) scopePillEl.style.opacity = sm.scp.toFixed(2);
  /* gauges */
  gg.ss.set(sm.SS, wordOf(sm.SS, 0.35, 0.65, ["dilute", "near limit", "supersaturated"])); gg.st.set(sm.St, wordOf(sm.St, 0.4, 0.72, ["tiny", "small", "large"])); gg.ob.set(sm.Ob, wordOf(sm.Ob, 0.22, 0.55, ["none", "partial", "blocked"]));
  gg.hy.set(sm.Hy, wordOf(sm.Hy, 0.22, 0.55, ["none", "mild", "marked"])); gg.pa.set(sm.Pa, wordOf(sm.Pa, 0.25, 0.55, ["mild", "moderate", "severe"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.25, 0.55, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
