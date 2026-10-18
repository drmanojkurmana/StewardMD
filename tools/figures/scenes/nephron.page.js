/* Nephron scene: kidney and bladder organs, glomerulus, tubule, blood, filtrate, protein, cells, a stone, treatment actions and gauges. */
const WW = SC.W, GX = 190, GY = 178;
const layers = { kidney: $("kidneySlot"), bladder: $("bladderSlot"), caps: $("caps"), tub: $("tub"), vess: $("vess"), glom: $("glom"), rbc: $("rbcs"), parts: $("parts"), stone: $("stone"), over: $("over"), panel: $("panel") };
/* Catmull-Rom sampling so one dense point list draws the path and also steers the particles */
function smoothPts(p, n) { const out = [];
  for (let i = 0; i < p.length - 1; i++) { const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let s = 0; s < n; s++) { const t = s / n, t2 = t * t, t3 = t2 * t, c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3); out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]); } }
  out.push(p[p.length - 1]); return out; }
const dp = (pts) => "M" + pts.map((q) => f1(q[0]) + " " + f1(q[1])).join("L");
const TUB = smoothPts([[246, 178], [282, 178], [305, 152], [345, 202], [390, 152], [435, 202], [482, 218], [490, 330], [500, 392], [535, 404], [565, 392], [572, 300], [576, 236], [620, 206], [665, 246], [710, 206], [760, 206], [825, 206], [868, 216], [880, 262], [880, 330], [880, 400]], 10);
/* blood: renal artery from the left edge into the kidney hilum, through the tuft, back out to the renal vein */
const BLD = smoothPts([[16, 206], [65, 206], [110, 212], [135, 192], [152, 170], [178, 150], [218, 164], [228, 190], [200, 216], [165, 206], [150, 208], [128, 224], [100, 232], [65, 242], [16, 240]], 8);
/* drawn vessel halves; their tips hide under the tuft while the full track steers the cells */
const AFF = smoothPts([[16, 206], [65, 206], [110, 212], [135, 192], [152, 170], [168, 158]], 8);
const EFF = smoothPts([[172, 196], [150, 208], [128, 224], [100, 232], [65, 242], [16, 240]], 8);
const tr = track(TUB), bt = track(BLD), fragTr = track([[880, 322], [880, 362], [880, 394]]);
const BLOOD_U = 0.31;
let uStone = 0.9; { let best = 1e9; for (let i = 0; i <= 600; i++) { const q = tr.at(i / 600), d = Math.hypot(q.x - 880, q.y - 322); if (d < best) { best = d; uStone = i / 600; } } }
const E = {};
/* ---- organs and the caption that follows the state ---- */
let kidneyO = null, bladderO = null, bladFill = null, capEl = null, capKey = "";
function initOrgans() {
  kidneyO = organ(layers.kidney, "kidney", 165, 222, 200, {});
  bladderO = organ(layers.bladder, "bladder", 880, 396, 72, {});
  bladFill = mk("ellipse", { class: "nf-urine", cx: 0, cy: 8, rx: 26, ry: 15, opacity: "0" }, bladderO.g);
}
function capText(l, d) {
  if (d === 1) return l === 0 ? "Fluids restore blood volume. Flow returns and filtration recovers." : "Fluids restore volume, but low volume is not the problem here. Little changes.";
  if (d === 2) return l === 4 ? "Relieving the blockage. Urine drains again and the bladder fills." : "Nothing blocks drainage here, so relieving obstruction changes little.";
  if (d === 3) {
    if (l === 2) return "Steroid calms the immune attack. Inflammation fades and filtration recovers.";
    if (l === 3) return "Steroid calms the immune attack. Protein loss eases.";
    return "This injury is not an immune attack, so a steroid changes little.";
  }
  if (d === 4) return l === 1 ? "Stopping the toxin. No new toxin reaches the tubule. Damage fades." : "No toxin drives this injury, so stopping it changes little.";
  if (l === 0) return "No treatment. Too little blood reaches the filter. Filtration stays very low.";
  if (l === 1) return "No treatment. Injured tubule cells shed and clog the tubule. Filtration stays low.";
  if (l === 2) return "No treatment. The inflamed filter leaks blood cells. Filtration stays low.";
  if (l === 3) return "No treatment. The leaky filter spills protein into the urine.";
  return "No treatment. Urine cannot drain. Pressure backs up and filtration stops.";
}
/* ---- static parts ---- */
function initStatic() {
  mk("circle", { class: "nf-caps", cx: GX, cy: GY, r: 62 }, layers.caps);
  E.tw = mk("path", { class: "nf-wall", d: dp(TUB), "stroke-width": 22 }, layers.tub);
  E.tl = mk("path", { class: "nf-lum", d: dp(TUB), "stroke-width": 14 }, layers.tub);
  E.td = mk("path", { class: "nf-dmg", d: dp(TUB.slice(0, Math.floor(TUB.length * 0.5))), "stroke-width": 20, opacity: "0" }, layers.tub);
  E.aw = mk("path", { class: "nf-vw", d: dp(AFF) }, layers.vess); E.al = mk("path", { class: "nf-vl", d: dp(AFF) }, layers.vess);
  E.ew = mk("path", { class: "nf-vw", d: dp(EFF) }, layers.vess); E.el = mk("path", { class: "nf-vl", d: dp(EFF) }, layers.vess);
  E.tuft = mk("circle", { class: "nf-tuft", cx: GX, cy: GY, r: 42 }, layers.glom);
  ["M165 160C175 140 200 142 205 158C212 178 180 182 188 198", "M170 196C160 180 178 170 196 178C214 186 214 204 198 210", "M208 150C224 160 224 180 212 192"].forEach((d) => mk("path", { class: "nf-coil", d }, layers.glom));
  E.bar = mk("circle", { class: "nf-bar", cx: GX, cy: GY, r: 44 }, layers.glom);
  E.dep = mk("g", { opacity: "0" }, layers.glom);
  for (let i = 0; i < 12; i++) { const t = i * 0.5236 + 0.2; mk("circle", { class: "nf-dep", cx: f1(GX + Math.cos(t) * 46.5), cy: f1(GY + Math.sin(t) * 46.5), r: 2.3 }, E.dep); }
  E.neus = Array.from({ length: 5 }, (_, i) => { const g = cell(layers.glom, { cls: "neut", r: 6, nuc: 0.55, nucCls: "multi", seed: i + 3, wob: 0.14 }); g.style.opacity = 0; return g; });
  E.stone = mk("g", { transform: "translate(880 322)", opacity: "0" }, layers.stone);
  mk("path", { class: "nf-stone", d: "M-10 -3L-4 -10L6 -8L11 0L6 9L-4 10L-11 4Z" }, E.stone);
  E.badge = mk("g", { transform: "translate(70 206)", opacity: "0", "pointer-events": "none" }, layers.over);
  mk("circle", { class: "nf-badge", r: 9 }, E.badge);
  mk("path", { class: "nf-badgex", d: "M-5 5L5 -5" }, E.badge);
}
/* ---- red cells in the renal artery, through the tuft and out the renal vein ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 5.5, ry: 3.3 }, g); mk("ellipse", { class: "cl-s", rx: 2, ry: 1 }, g); rbcs.push({ g, u: i / 16, v: rnd(0.85, 1.15), lat: rnd(-2, 2) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, u: 0, st: 1, t: 0, sx: 0, sy: 0, lat: 0, off: 0, v: 1 }; }); }
const filt = pool(90, () => mk("circle", { class: "p-fd", r: 2 }, layers.parts));
const prot = pool(40, () => mk("circle", { class: "p-prot", r: 3 }, layers.parts));
const bld = pool(30, () => mk("circle", { class: "p-bl", r: 2.8 }, layers.parts));
const slough = pool(26, () => mk("circle", { class: "p-sl", r: 3.8 }, layers.parts));
const tox = pool(14, () => mk("path", { class: "sc-p p-lps", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const fluid = pool(22, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const frag = pool(10, () => mk("path", { class: "sc-p nf-frag", d: "M0 -3L3 2L-3 2Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p) { p.on = true; p.t = 0; p.v = rnd(0.85, 1.15); p.off = rnd(0, 0.16); p.lat = rnd(-4, 4); p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function fromRing(p, r) { emit(p); const t = rnd(0, 6.28); p.st = 0; p.sx = GX + Math.cos(t) * r; p.sy = GY + Math.sin(t) * r; p.x = p.sx; p.y = p.sy; }
/* ---- labels and gauges ---- */
const gg = {};
function setVis(g, v) { g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
const pills = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 226, 352, 478, 604, 730, 856];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The kidney";
  [["F", "Blood flow", "g-fl", "Blood reaching the glomerulus through the afferent arteriole. Low in prerenal injury, for example when volume is low or the pump is weak."],
    ["O", "Back-pressure", "g-eos", "Pressure that builds in the tubule and ureter when urine cannot drain. High in postrenal injury (obstruction)."],
    ["T", "Tubule damage", "g-bad", "Injury to the cells lining the tubule, most often from poor blood flow or a toxin (acute tubular necrosis). Dead cells shed into the lumen and form casts."],
    ["G", "Inflammation", "g-cyt", "Immune attack on the glomerulus (a nephritic picture): the filter is inflamed and red cells and white cells appear in the urine."],
    ["P", "Protein leak", "g-clot", "Protein crossing a damaged filter (a nephrotic picture) and appearing in the urine."],
    ["GFR", "Filtration", "g-good", "How much blood the glomeruli filter. It falls in acute kidney injury, and creatinine in the blood rises as a result."],
    ["UO", "Urine output", "g-neu", "How much urine is made. Low in most acute injury, and almost none if drainage is fully blocked."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, pl = (key, ...a) => { pills[key] = pill(ox, ...a); return pills[key]; };
  pl("aff", "Afferent arteriole", 135, 178, 110, 62, "Afferent arteriole: brings blood into the glomerulus. How much blood arrives depends on the blood volume and pressure behind it. Prerenal problems act here.");
  pl("glo", "Glomerulus filter", 200, 148, 292, 62, "Glomerulus: a tuft of capillaries where blood is filtered. The filtration barrier (capillary lining, basement membrane and podocytes) normally keeps blood cells and protein in the blood. When it is inflamed and lets red cells through the picture is nephritic; when it leaks protein the picture is nephrotic.");
  pl("bow", "Bowman space", 228, 142, 340, 96, "Bowman space: the cup around the glomerulus that collects the filtered fluid (filtrate) before it enters the tubule.");
  pl("eff", "Efferent vessel", 116, 227, 60, 166, "Efferent arteriole: carries blood out of the glomerulus toward the tubules.");
  pl("pct", "Proximal tubule", 345, 202, 360, 262, "Proximal tubule: reclaims most of the filtered salt, water and sugar. Its cells use a lot of energy, so they are the usual casualty of poor blood flow or a toxin (acute tubular necrosis).");
  pl("loop", "Loop of Henle", 488, 330, 400, 350, "Loop of Henle: builds the salty gradient that lets the kidney concentrate urine.");
  pl("dct", "Distal tubule", 665, 246, 665, 300, "Distal tubule: fine tuning of salt, potassium and acid.");
  pl("cd", "Collecting duct", 790, 206, 770, 140, "Collecting duct: the last place where water is adjusted under hormone control. Urine then drains through the ureter.");
  pl("stone", "Obstruction (stone)", 880, 322, 770, 348, "A blockage in the urinary tract, for example a stone, an enlarged prostate or a tumour. Urine backs up, pressure rises toward the kidney and filtration falls (postrenal injury).");
  pl("ure", "Ureter", 880, 290, 795, 300, "Ureter: the tube that carries urine from the kidney to the bladder. A stone here blocks drainage and pressure backs up.");
  pl("uri", "Urine", 880, 385, 795, 432, "Urine entering the bladder. Its volume and what it contains (protein, blood, casts) help tell the types of injury apart.");
  pl("kid", "Kidney", 185, 340, 170, 400, "Kidney: the glomerulus and tubule drawn here sit in its cortex. Blood arrives through the renal artery at the hilum.");
  pl("bla", "Bladder", 907, 390, 830, 262, "Bladder: stores urine arriving through the ureter. It stays empty while the ureter is blocked.");
  pl("fl", "Fluids", 52, 202, 55, 280, "Intravenous fluids restore blood volume. They help when the problem is low volume (prerenal); they do not fix a blocked tract, an inflamed filter or a toxin.");
  pl("tox", "Nephrotoxin", 70, 206, 136, 192, "A drug or toxin that damages tubule cells. It arrives in the blood, is filtered, and the tubule cells take it up.");
  pl("st", "Steroid", 228, 218, 250, 352, "A steroid dampens immune activity. It helps some immune-driven glomerular diseases (for example minimal change disease and some nephritis), but does nothing for low volume, a blockage or a toxin.");
  capEl = mk("text", { class: "nf-cap", x: 30, y: 432 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { F: 0.85, O: 0, T: 0.5, G: 0, P: 0, GFR: 0.5, UO: 0.5, X: 1, stop: 0, fl: 0, imm: 0 }, KEYS = Object.keys(sm);
const acc = { filt: 0, prot: 0, bld: 0, slough: 0, tox: 0, fl: 0, cap: 0, frag: 0 };
function init() { initOrgans(); initStatic(); initRbc(); initPanel(); }
/* particles that ride the tubule (stage 0: out of the glomerulus, 1: along the tubule, -1: toxin still in the blood) */
function lumenStep(pl, dt, spd, blocked, dil) {
  pl.forEach((p) => { if (!p.on) return;
    if (p.st === -1) { p.u += dt * 0.12 * (0.2 + sm.F); const q = bt.at(p.u); p.x = q.x; p.y = q.y; if (p.u > BLOOD_U) { p.st = 0; p.sx = q.x; p.sy = q.y; p.t = 0; } }
    else if (p.st === 0) { p.t += dt / 0.75; const q = tr.at(0); p.x = lerp(p.sx, q.x, Math.min(1, p.t)); p.y = lerp(p.sy, q.y, Math.min(1, p.t)); if (p.t >= 1) { p.st = 1; p.u = 0; } }
    else { const lim = blocked && p.u < uStone ? uStone - 0.012 - p.off : 2; p.u = Math.min(lim, p.u + spd * dt * p.v / tr.len); if (p.u >= 1) { kill(p); return; }
      const q = tr.at(p.u), na = (q.a + 90) * 0.01745, l = p.lat * dil; p.x = q.x + Math.cos(na) * l; p.y = q.y + Math.sin(na) * l; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const blocked = sm.O > 0.4, dil = 1 + 0.7 * sm.O;
  /* vessel and tubule widths: low blood flow narrows the supply; backed-up urine swells the tubule */
  const vw = 7 + 9 * sm.F;
  E.aw.setAttribute("stroke-width", f1(vw + 7)); E.al.setAttribute("stroke-width", f1(vw)); E.ew.setAttribute("stroke-width", f1(vw + 7)); E.el.setAttribute("stroke-width", f1(vw));
  E.tw.setAttribute("stroke-width", f1(22 + 10 * sm.O)); E.tl.setAttribute("stroke-width", f1(14 + 10 * sm.O));
  E.td.setAttribute("stroke-width", f1(20 + 10 * sm.O)); E.td.setAttribute("opacity", clamp(sm.T * 0.95).toFixed(2));
  E.tw.style.stroke = "color-mix(in srgb,var(--c-brown) " + Math.round(sm.T * 55) + "%,color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid)))";
  /* glomerulus: leaky barrier, immune deposits, inflammatory cells */
  E.bar.setAttribute("stroke-dasharray", "6 " + f1(1.2 + 10 * sm.P));
  E.tuft.style.fill = "color-mix(in srgb,var(--c-bad) " + Math.round(sm.G * 32) + "%,color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper)))";
  E.dep.setAttribute("opacity", clamp(sm.G * 1.3).toFixed(2));
  E.neus.forEach((n, i) => { const t = tm / 2600 + i * 1.256, r = 51 + Math.sin(tm / 700 + i) * 2; place(n, GX + Math.cos(t) * r, GY + Math.sin(t) * r, Math.sin(tm / 400 + i) * 12, 1); n.style.opacity = clamp(sm.G * 1.5 - 0.3).toFixed(2); });
  /* stone shrinks as the obstruction is relieved; the stop badge marks a halted toxin */
  E.stone.setAttribute("opacity", clamp(sm.O * 1.4).toFixed(2));
  E.stone.setAttribute("transform", "translate(880 322) scale(" + (0.35 + 0.65 * clamp(sm.O * 1.6)).toFixed(2) + ")");
  E.badge.setAttribute("opacity", clamp(sm.stop).toFixed(2));
  /* urine pooling in the bladder mirrors output: empty while blocked, filling when draining */
  bladFill.setAttribute("opacity", clamp((sm.UO - 0.15) * 1.4).toFixed(2));
  /* blood cells ride the renal artery, through the tuft and out the renal vein */
  const nr = Math.ceil(sm.F * rbcs.length);
  rbcs.forEach((r, i) => { const act = i < nr; if (act) { r.u += dt * 0.11 * (0.25 + sm.F) * r.v; if (r.u > 1) r.u -= 1; } r.g.style.opacity = act ? 1 : 0;
    const q = bt.at(r.u), na = (q.a + 90) * 0.01745; place(r.g, q.x + Math.cos(na) * r.lat, q.y + Math.sin(na) * r.lat, q.a, 1); });
  /* emitters */
  acc.filt += dt * sm.GFR * 6; while (acc.filt >= 1) { acc.filt--; const p = free(filt); if (p) fromRing(p, 38); }
  acc.prot += dt * sm.P * 4.5; while (acc.prot >= 1) { acc.prot--; const p = free(prot); if (p) fromRing(p, 38); }
  acc.bld += dt * sm.G * 4; while (acc.bld >= 1) { acc.bld--; const p = free(bld); if (p) fromRing(p, 38); }
  acc.slough += dt * sm.T * 3.5; while (acc.slough >= 1) { acc.slough--; const p = free(slough); if (p) { emit(p); p.st = 1; p.u = rnd(0.03, 0.3); } }
  acc.tox += dt * sm.X * 2.5; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) { emit(p); p.st = -1; p.u = 0; } }
  const spd = 70 + 80 * sm.GFR;
  lumenStep(filt, dt, spd, blocked, dil); lumenStep(prot, dt, spd * 0.95, blocked, dil); lumenStep(bld, dt, spd * 0.95, blocked, dil); lumenStep(slough, dt, spd * 0.8, blocked, dil);
  lumenStep(tox, dt, spd, blocked, dil);
  tox.forEach((p) => { if (p.on) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 5) + ")"); });
  /* stone fragments break off and wash into the bladder while the blockage is relieved */
  acc.frag += dt * (drug === 2 ? 7 * clamp(sm.O + 0.12) : 0);
  while (acc.frag >= 1) { acc.frag--; const p = free(frag); if (p) { emit(p); p.u = 0; } }
  frag.forEach((p) => { if (!p.on) return; p.u += dt * 0.5 * p.v; if (p.u >= 1) { kill(p); return; }
    const q = fragTr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x + p.lat * 0.3) + " " + f1(q.y) + ") rotate(" + f1(tm / 7 + p.off * 90) + ")");
    p.e.setAttribute("opacity", clamp((1 - p.u) * 4).toFixed(2)); });
  /* fluid drops ride the renal artery toward the glomerulus while fluids run */
  acc.fl += dt * sm.fl * 6; while (acc.fl >= 1) { acc.fl--; const p = free(fluid); if (p) { emit(p); p.u = 0; } }
  fluid.forEach((p) => { if (!p.on) return; p.u += dt * 0.2 * p.v; if (p.u > BLOOD_U) { kill(p); return; } const q = bt.at(p.u), na = (q.a + 90) * 0.01745; p.e.setAttribute("transform", "translate(" + f1(q.x + Math.cos(na) * p.lat * 0.4) + " " + f1(q.y + Math.sin(na) * p.lat * 0.4) + ")"); });
  /* steroid capsules arrive in the blood, dock on the inflamed filter and sit on it while selected */
  caps.forEach((p, i) => {
    if (drug === 3) {
      const t = (i % 8) * 0.785 + 0.2, sx = GX + Math.cos(t) * 46.5, sy = GY + Math.sin(t) * 46.5;
      if (!p.on) { const q = bt.at(0.12); emit(p); p.x = q.x + rnd(-6, 6); p.y = q.y + rnd(-6, 6); p.st = 0; }
      const dx = sx - p.x, dy = sy - p.y, d = Math.hypot(dx, dy) || 1;
      if (p.st === 0) { if (d < 7) p.st = 1; else { const go = 150 * dt; p.x += dx / d * Math.min(d, go); p.y += dy / d * Math.min(d, go); } }
      else { p.x = sx + Math.sin(tm / 500 + i * 2.1) * 2; p.y = sy + Math.cos(tm / 430 + i * 1.7) * 2; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(i * 45 + Math.sin(tm / 600 + i) * 6) + ")");
      p.e.setAttribute("opacity", "1");
    } else if (p.on) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); }
  });
  /* treatment labels and stone label follow the model */
  setVis(pills.fl, clamp(sm.fl)); setVis(pills.st, clamp(sm.imm)); setVis(pills.tox, clamp(Math.max(sm.X, sm.stop))); setVis(pills.stone, clamp(sm.O * 1.5));
  /* gauges */
  gg.F.set(sm.F, wordOf(sm.F, 0.4, 0.7, ["low", "reduced", "normal"])); gg.O.set(sm.O, wordOf(sm.O, 0.2, 0.6, ["none", "some", "high"]));
  gg.T.set(sm.T, wordOf(sm.T, 0.2, 0.6, ["none", "some", "severe"])); gg.G.set(sm.G, wordOf(sm.G, 0.2, 0.6, ["none", "some", "marked"]));
  gg.P.set(sm.P, wordOf(sm.P, 0.2, 0.6, ["none", "some", "heavy"])); gg.GFR.set(sm.GFR, wordOf(sm.GFR, 0.35, 0.75, ["very low", "reduced", "near normal"]));
  gg.UO.set(sm.UO, wordOf(sm.UO, 0.1, 0.55, ["very little", "low", "adequate"]));
  /* caption follows the injury and the treatment together */
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const c = capText(level, drug); if (capEl.textContent !== c) capEl.textContent = c; }
}
run({ init, step, onModel() { const t = $("tag"); if (t && t.textContent !== S.level.tags[level]) t.textContent = S.level.tags[level]; } });
