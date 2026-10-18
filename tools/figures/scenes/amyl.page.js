/* Amyloidosis scene: plasma cell clone makes precursor, misfold, fibril, organ deposits. */
const layers = { base: $("base"), org: $("orgSlot"), deps: $("deps"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CX = 130, CY = 278, MISX = 350, MISY = 262, FIBX = 500, FIBY = 262;
const HEART = [730, 195], KID = [872, 200], NRV = [800, 335];
/* ---- static nodes ---- */
const nodes = {};
let trPre = null, trFib = null;
function initNodes() {
  const B = layers.base;
  nodes.glow = mk("ellipse", { class: "amy-glow", cx: CX, cy: CY, rx: 95, ry: 72, opacity: "0.3" }, B);
  const cl = mk("g", {}, B);
  [["plas", -22, -16, 21, 5], ["plas", 22, -10, 18, 9], ["plas", -2, 24, 16, 2]].forEach(([cls, dx, dy, r, seed]) => {
    const g = mk("g", {}, cl);
    cell(g, { cls, r, nuc: 0.45, seed, wob: 0.1 });
    g.setAttribute("transform", "translate(" + dx + " " + dy + ")");
  });
  nodes.clone = cl;
  const pool = mk("g", {}, B);
  cell(pool, { cls: "prot", r: 7, nuc: 0, seed: 4, wob: 0.12 });
  place(pool, 200, 270); nodes.pool = pool;
  const mis = mk("g", {}, B);
  cell(mis, { cls: "mis", r: 26, nuc: 0, seed: 7, wob: 0.16 });
  mk("path", { class: "amy-strand", d: "M-16 7L-8 -7L-2 7L5 -7L11 7L17 -5" }, mis);
  place(mis, MISX, MISY); nodes.mis = mis;
  const fib = mk("g", {}, B);
  mk("rect", { class: "amy-plate", x: -52, y: -30, width: 104, height: 60, rx: 10 }, fib);
  for (let r = 0; r < 3; r++) { const y = -18 + r * 16; let d = "M-44 " + y; for (let s = 0; s < 8; s++) d += "L" + (-34 + s * 11) + " " + (y + (s % 2 ? 4 : -4)); mk("path", { class: "amy-strand", d }, fib); }
  nodes.bundle = mk("g", {}, fib);
  mk("path", { class: "amy-fib", d: "M-48 -8C-24 -18 0 2 24 -8C36 -13 44 -10 48 -8" }, nodes.bundle);
  mk("path", { class: "amy-fib2", d: "M-48 8C-24 18 0 -2 24 8C36 13 44 10 48 8" }, nodes.bundle);
  place(fib, FIBX, FIBY); nodes.fib = fib;
  trPre = track([[200, 270], [255, 267], [312, 264]]);
  trFib = track([[548, 262], [600, 270], [660, 272]]);
}
let heartO = null, kidO = null, nerveO = null;
const sicks = [], halos = [];
function initOrgans() {
  const O = layers.org;
  heartO = organ(O, "heart", HEART[0], HEART[1], 135, {});
  kidO = organ(O, "kidney", KID[0], KID[1], 105, {});
  nerveO = organ(O, "ganglion", NRV[0], NRV[1], 95, {});
  [[HEART[0], HEART[1], 72, 80], [KID[0], KID[1], 50, 60], [NRV[0], NRV[1], 46, 32]].forEach(([x, y, rx, ry]) => {
    sicks.push(mk("ellipse", { class: "amy-sick", cx: x, cy: y, rx, ry, opacity: "0.35" }, O));
  });
  [[HEART[0], HEART[1], 86, 94], [KID[0], KID[1], 62, 72], [NRV[0], NRV[1], 58, 44]].forEach(([x, y, rx, ry]) => {
    halos.push(mk("ellipse", { class: "amy-halo", cx: x, cy: y, rx, ry, opacity: "0" }, O));
  });
}
/* ---- deposit speckles over and around the organs ---- */
const deps = [];
function initDeps() {
  const pts = [[690, 170], [760, 160], [700, 230], [765, 225], [730, 252], [675, 205],
    [845, 170], [895, 165], [850, 235], [900, 230], [872, 255],
    [775, 330], [825, 330], [800, 362], [620, 330], [650, 360], [600, 300]];
  pts.forEach(([x, y], i) => {
    const g = mk("g", {}, layers.deps);
    for (let j = 0; j < 3; j++) mk("path", { class: j % 2 ? "amy-dep2" : "amy-dep", d: "M" + f1(rnd(-11, 2)) + " " + f1(rnd(-7, 7)) + "L" + f1(rnd(2, 11)) + " " + f1(rnd(-7, 7)) }, g);
    place(g, x, y, i * 37, 0.5); deps.push({ g, x, y, sens: 0.6 + (i % 4) * 0.15 });
  });
  const anchor = mk("g", {}, layers.deps);
  mk("circle", { cx: 0, cy: 0, r: 6, fill: "#e879a8", stroke: "none" }, anchor);
  place(anchor, 700, 330); deps.push({ g: anchor, x: 700, y: 330, sens: 1, anchor: true });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, sp: 0, sx: 0, sy: 0, tx: 0, ty: 0, stuck: 0 }; }); }
const preDots = pool(22, () => mk("circle", { class: "sc-p p-pre", r: 2.8 }, layers.parts));
const fibDots = pool(22, () => mk("circle", { class: "sc-p p-fib", r: 2.6 }, layers.parts));
const chemoDots = pool(8, () => mk("circle", { class: "sc-p p-chemo", r: 3 }, layers.parts));
const blockDots = pool(6, () => mk("circle", { class: "sc-p p-block", r: 3 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
const cloneTargets = [[108, 262], [152, 268], [128, 302]];
const rimTargets = [[55, 278], [205, 278], [130, 212], [130, 344]];
function launchDrug(p, tx, ty) {
  p.on = true; p.u = 0; p.sp = rnd(0.35, 0.55); p.stuck = 0;
  p.sx = rnd(50, 210); p.sy = 118; p.tx = tx; p.ty = ty;
  p.e.setAttribute("opacity", "1");
}
function stepDrug(pl, dt, active, targets) {
  pl.forEach((p) => {
    if (!p.on) return;
    if (p.u < 1) {
      p.u = Math.min(1, p.u + dt * p.sp);
      place(p.e, lerp(p.sx, p.tx, p.u), lerp(p.sy, p.ty, p.u) + Math.sin(p.u * 9) * 4, 0, 1);
      if (p.u >= 1) p.e.setAttribute("opacity", "1");
    } else if (!active) { p.on = false; p.e.setAttribute("opacity", "0");
    } else {
      p.stuck += dt;
      p.e.setAttribute("opacity", clamp(1 - (p.stuck - 1.4) / 0.8).toFixed(2));
      if (p.stuck > 2.2) { p.on = false; p.e.setAttribute("opacity", "0"); }
    }
  });
  if (active) {
    const want = pl === chemoDots ? 6 : 4;
    const sitting = pl.filter((p) => p.on).length;
    if (sitting < want) { const p = freeP(pl); if (p) { const t = targets[Math.floor(Math.random() * targets.length)]; launchDrug(p, t[0] + rnd(-6, 6), t[1] + rnd(-6, 6)); } }
  }
}
/* ---- labels, gauges, caption ---- */
const gg = {};
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Treating the cause caps the source. Less precursor is made and fewer new fibrils form.";
  if (d === 2) return "Chemotherapy shrinks the plasma cell clone. Precursor falls and deposits stop growing.";
  if (d === 3) return "Supportive care helps the organs cope. Deposits stay put but organ function improves.";
  return "No treatment. The clone keeps releasing precursor and deposits keep growing in the organs.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [140, 360, 580, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The tissues";
  [["pre", "Precursor", "g-prot", "How much amyloid precursor protein is being made. AL comes from light chains and AA from an inflammatory protein."], ["fib", "New fibrils", "g-amy", "How fast misfolded protein is stacking into new amyloid fibrils."], ["dep", "Deposition", "g-amy", "How much fibril material has built up outside cells. It clears slowly, so it falls only a little when the precursor is cut."], ["fn", "Organ function", "g-good", "How well the deposited organs still work. Supportive care helps this without removing deposits."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Plasma cells", 112, 242, 110, 105, "Plasma cell clone: many copies of one plasma cell making the same light chain protein. Chemotherapy shrinks this clone.");
  pill(ox, "Precursor", 250, 266, 250, 150, "Precursor protein: the small soluble protein that will misfold. Cutting its supply slows everything downstream.");
  pill(ox, "Misfold", MISX, 236, 350, 105, "Misfold: the precursor loses its normal shape and starts to stack on other copies.");
  pill(ox, "Fibril", FIBX, 234, 505, 105, "Amyloid fibril: stacked sheets twist into a rigid fibril that the body cannot break down.");
  pill(ox, "Heart", 668, 190, 640, 150, "Heart: deposits stiffen the walls so filling is restricted. Breathlessness and fluid retention follow.");
  pill(ox, "Kidney", KID[0], 165, 880, 105, "Kidney: deposits damage the filters so protein leaks into the urine.");
  pill(ox, "Nerve", 848, 335, 895, 375, "Nerve: deposits injure peripheral nerves, causing numbness, pain and weakness.");
  pill(ox, "Deposits", 700, 330, 620, 400, "Deposits: fibrils build up outside cells and stiffen the tissue.");
  capEl = mk("text", { class: "amy-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { P: 0.5, F: 0.4, D: 0.5, Fn: 0.5, cause: 0, chemo: 0, sup: 0 };
const acc = { pre: 0, fib: 0 };
function init() { initNodes(); initOrgans(); initDeps(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.P = lerp(sm.P, m.P, k2); sm.F = lerp(sm.F, m.F, k2); sm.D = lerp(sm.D, m.D, k2); sm.Fn = lerp(sm.Fn, m.Fn, k1);
  sm.cause = lerp(sm.cause, m.src === 0.3 ? 1 : 0, k1); sm.chemo = lerp(sm.chemo, m.src === 0.18 ? 1 : 0, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  /* source clone shrinks under chemotherapy, dims when the cause is treated */
  const csc = Math.max(0.3, 1 - 0.55 * sm.chemo - 0.15 * sm.cause);
  place(nodes.clone, CX + Math.sin(tm / 1500) * 2, CY, Math.sin(tm / 2400) * 3, csc);
  nodes.clone.style.opacity = (1 - 0.6 * sm.chemo - 0.2 * sm.cause).toFixed(2);
  nodes.glow.setAttribute("opacity", (0.3 * (1 - 0.85 * sm.cause - 0.6 * sm.chemo)).toFixed(2));
  place(nodes.pool, 200 + Math.sin(tm / 1300) * 2, 270, 0, 0.6 + 0.6 * sm.P);
  /* misfold and fibril assembly track new fibril formation */
  place(nodes.mis, MISX, MISY, Math.sin(tm / 900) * 7 * (0.3 + 0.7 * sm.F), 0.65 + 0.45 * sm.F);
  place(nodes.fib, FIBX, FIBY + Math.sin(tm / 1200) * 2, 0, 0.8 + 0.25 * sm.F);
  nodes.bundle.style.opacity = (0.35 + 0.65 * sm.F).toFixed(2);
  $("preArrow").setAttribute("opacity", (0.2 + 0.6 * sm.P).toFixed(2));
  $("preArrowH").setAttribute("opacity", (0.2 + 0.6 * sm.P).toFixed(2));
  $("postArrow").setAttribute("opacity", (0.2 + 0.6 * sm.F).toFixed(2));
  $("postArrowH").setAttribute("opacity", (0.2 + 0.6 * sm.F).toFixed(2));
  /* organ injury tint follows active deposition; support halo shows supportive care */
  sicks.forEach((e) => e.setAttribute("opacity", (0.42 * sm.F).toFixed(2)));
  halos.forEach((e, i) => e.setAttribute("opacity", (sm.sup * (0.75 + 0.15 * Math.sin(tm / 800 + i * 2))).toFixed(2)));
  deps.forEach((d) => {
    if (d.anchor) { d.g.style.opacity = (0.3 + 0.7 * sm.F).toFixed(2); return; }
    const s = clamp((sm.F - 0.06) * d.sens * 1.5);
    place(d.g, d.x, d.y, Math.sin(tm / 1800 + d.x) * 4, 0.12 + s); d.g.style.opacity = s > 0.03 ? 1 : 0;
  });
  /* precursor stream feeds the pathway; fibril stream feeds the deposits */
  acc.pre += dt * (0.5 + 10 * sm.P); while (acc.pre >= 1) { acc.pre--; const p = freeP(preDots); if (p) { p.on = true; p.u = 0; p.sp = rnd(0.25, 0.4); p.e.setAttribute("opacity", "1"); } }
  preDots.forEach((p) => { if (!p.on) return; p.u += p.sp * dt * (0.5 + sm.P); const q = trPre.at(clamp(p.u, 0, 1)); place(p.e, q.x + Math.sin(tm / 300 + p.u * 9) * 3, q.y, 0, 1); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  acc.fib += dt * (0.4 + 9 * sm.F); while (acc.fib >= 1) { acc.fib--; const p = freeP(fibDots); if (p) { p.on = true; p.u = 0; p.sp = rnd(0.2, 0.32); p.e.setAttribute("opacity", "1"); } }
  fibDots.forEach((p) => { if (!p.on) return; p.u += p.sp * dt * (0.5 + sm.F); const q = trFib.at(clamp(p.u, 0, 1)); place(p.e, q.x, q.y + Math.cos(tm / 340 + p.u * 7) * 3, 0, 1); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  stepDrug(chemoDots, dt, drug === 2, cloneTargets);
  stepDrug(blockDots, dt, drug === 1, rimTargets);
  gg.pre.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["low", "present", "high"])); gg.fib.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["low", "present", "high"]));
  gg.dep.set(sm.D, wordOf(sm.D, 0.35, 0.65, ["little", "moderate", "extensive"])); gg.fn.set(sm.Fn, wordOf(sm.Fn, 0.4, 0.65, ["poor", "reduced", "preserved"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
