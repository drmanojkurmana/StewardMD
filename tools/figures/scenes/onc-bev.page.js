/* Onc-bev scene: tumour VEGF grows a leaky sprout from the parent vessel (left);
 * bevacizumab mops up VEGF so the sprout stalls and vessels normalise, while
 * kidney, artery, bowel and skin wound show the side effects (right). */
const TCX = 310, TCY = 285;
const L = { tum: $("tum"), ves: $("ves"), sprout: $("sprout"), veg: $("veg"), ab: $("ab"), cx: $("cx"), deb: $("deb"), leak: $("leak"), kidSlot: $("kidSlot"), kidFx: $("kidFx"), artSlot: $("artSlot"), artFx: $("artFx"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), skinSlot: $("skinSlot"), skinFx: $("skinFx"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, q: null }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.q = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.q = null; p.e.setAttribute("opacity", "0"); }
let tumA = null, tumB = null, tumC = null, sproutPath = null, tipG = null, artO = null, clotG = null, artRing = null, kidTint = null, gutTint = null, hole = null, slit = null, lipT = null, lipB = null, woundRing = null, capEl = null, capKey = "";
let rbcs = [], gg = {}, cs = 1, tipX = 180, tipY = 287;
let vegP, abP, cxP, debP, leakP, protP, noP, floP, spillP, bleedP;
function capText(d, l) {
  if (d === 0) return "No treatment. VEGF grows a leaky new vessel into the tumour and no drug harm builds.";
  if (d === 2 && l === 0) return "Early courses with protection. VEGF is mopped up, the sprout stalls and pressure stays down.";
  if (d === 2 && l === 1) return "Middle courses with protection. The tumour starves while pressure, gut and wounds hold; protein still leaks.";
  if (d === 2) return "Late courses with protection. The tumour is dying, harms held except protein leak and artery clots.";
  if (l === 0) return "Early courses. Antibody mops up VEGF, the sprout stalls, vessels tighten and pressure starts to rise.";
  if (l === 1) return "Middle courses. The tumour starves as pressure, urine protein and bleeding build and the gut weakens.";
  return "Late courses. The tumour dies but pressure is very high, kidneys flood, clots threaten and wounds gape.";
}
function init() {
  /* ---- tumour cluster ---- */
  tumA = cell(L.tum, { cls: "graft", r: 64, nuc: 0.5, seed: 3, wob: 0.07, n: 10 });
  tumB = cell(L.tum, { cls: "graft", r: 30, nuc: 0.5, seed: 7, wob: 0.1 });
  tumC = cell(L.tum, { cls: "graft", r: 24, nuc: 0.5, seed: 11, wob: 0.1 });
  /* ---- parent vessel: lumen, two endothelium walls, flowing red cells ---- */
  mk("rect", { class: "bv-lumen", x: 40, y: 120, width: 48, height: 280, rx: 22 }, L.ves);
  for (let i = 0; i < 11; i++) {
    const y = 130 + i * 26;
    const cl = cell(L.ves, { cls: "endo", r: 8, nuc: 0.3, seed: i + 1, wob: 0.06, n: 8 });
    place(cl, 46, y, 0, 1);
    const cr = cell(L.ves, { cls: "endo", r: 8, nuc: 0.3, seed: i + 40, wob: 0.06, n: 8 });
    place(cr, 86, y, 0, 1);
  }
  for (let i = 0; i < 5; i++) {
    const g = cell(L.ves, { cls: "rbc", r: 7, seed: i + 60, wob: 0.12 });
    rbcs.push({ g, x: 64, y: 130 + i * 52, rot: rnd(-20, 20), i });
  }
  /* ---- sprout from the wall toward the tumour ---- */
  sproutPath = mk("path", { class: "bv-sprout", d: "M88 283L180 283L180 291L88 301Z" }, L.sprout);
  tipG = cell(L.sprout, { cls: "endo", r: 9, nuc: 0.4, seed: 5, wob: 0.12 });
  vegP = pool(16, () => mk("circle", { class: "sc-p bv-veg", r: 3 }, L.veg));
  abP = pool(12, () => { const g = mk("g", {}, L.ab); mk("path", { class: "bv-abd", d: "M-1.6 8L-1.6 -1L-6.5 -9L-3.4 -10.6L0 -3.6L3.4 -10.6L6.5 -9L1.6 -1L1.6 8Z" }, g); return g; });
  cxP = pool(8, () => mk("circle", { class: "sc-p bv-cx", r: 4 }, L.cx));
  debP = pool(12, () => mk("circle", { class: "sc-p bv-deb", r: 2.5 }, L.deb));
  leakP = pool(16, () => mk("path", { class: "bv-leak", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.leak));
  /* ---- kidney: protein leaks into the urine ---- */
  organ(L.kidSlot, "kidney", 605, 168, 95, {});
  kidTint = mk("ellipse", { class: "bv-tint", cx: 605, cy: 168, rx: 38, ry: 46, opacity: "0" }, L.kidFx);
  protP = pool(14, () => mk("circle", { class: "sc-p bv-prot", r: 2.4 }, L.kidFx));
  /* ---- artery: tightens as nitric oxide falls, clot grows inside ---- */
  artO = organ(L.artSlot, "vessel", 830, 170, 70, { h: 140 });
  artRing = mk("ellipse", { class: "bv-shield", cx: 830, cy: 170, rx: 52, ry: 78, opacity: "0" }, L.artFx);
  clotG = mk("g", {}, L.artFx);
  for (let j = 0; j < 5; j++) cell(clotG, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.3) * 9, y: Math.sin(j * 2.1) * 7, seed: j + 3, wob: 0.15, n: 7 });
  for (let j = 0; j < 4; j++) mk("path", { class: "bv-fib", d: "M" + f1(rnd(-14, 14)) + " " + f1(rnd(-9, 9)) + "L" + f1(rnd(-14, 14)) + " " + f1(rnd(-9, 9)) }, clotG);
  noP = pool(10, () => mk("circle", { class: "p-no", r: 3 }, L.artFx));
  floP = pool(12, () => mk("circle", { class: "sc-p bv-flow", r: 2.6 }, L.artFx));
  /* ---- bowel: weak patch tears open and spills ---- */
  organ(L.gutSlot, "bowel", 605, 340, 150, { h: 85 });
  gutTint = mk("ellipse", { class: "bv-gut", cx: 605, cy: 340, rx: 62, ry: 34, opacity: "0" }, L.gutFx);
  hole = mk("ellipse", { class: "bv-hole", cx: 640, cy: 330, rx: 1.5, ry: 1, opacity: "0" }, L.gutFx);
  spillP = pool(12, () => mk("circle", { class: "sc-p bv-spill", r: 2.6 }, L.gutFx));
  /* ---- skin wound: lips stay apart and bleed ---- */
  organ(L.skinSlot, "skin", 815, 340, 130, { h: 80 });
  slit = mk("rect", { class: "bv-slash", x: 762, y: 338, width: 106, height: 3, rx: 1.5 }, L.skinFx);
  lipT = mk("rect", { class: "bv-lip", x: 762, y: 333, width: 106, height: 4, rx: 2 }, L.skinFx);
  lipB = mk("rect", { class: "bv-lip", x: 762, y: 343, width: 106, height: 4, rx: 2 }, L.skinFx);
  woundRing = mk("ellipse", { class: "bv-shield", cx: 815, cy: 340, rx: 78, ry: 52, opacity: "0" }, L.skinFx);
  bleedP = pool(10, () => mk("path", { class: "bv-blood", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.skinFx));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Bevacizumab", 55, 145, 90, 108, "Bevacizumab, an antibody to VEGF-A. It mops up free VEGF in the blood so none reaches the vessel wall.");
  pill(o, "VEGF", 240, 268, 210, 128, "VEGF-A, the main vessel growth signal. Tumour cells release it when short of oxygen; it tells nearby vessels to sprout and leak.");
  pill(o, "New vessel", 120, 290, 130, 394, "Tumour sprout. VEGF pulls a new branch from the parent vessel toward the tumour; without treatment it grows and leaks, with treatment it stalls and tightens.");
  pill(o, "Tumour", 310, 352, 310, 392, "Tumour cells. New vessels feed them oxygen and food; when VEGF is blocked the vessels regress and the tumour starves and shrinks.");
  pill(o, "Kidney", 652, 180, 700, 118, "Proteinuria. Glomerular cells need VEGF to keep the filter tight, so blockade lets protein leak into the urine.");
  pill(o, "Artery", 858, 160, 895, 118, "Hypertension and artery clots. Less VEGF means less nitric oxide, so the artery tightens and pressure rises; the injured lining also seeds clots.");
  pill(o, "Bowel", 605, 378, 555, 414, "Gut perforation. VEGF keeps the bowel wall and its blood supply sound, so blockade can let a weak patch tear open and spill into the belly.");
  pill(o, "Wound", 815, 375, 790, 414, "Poor healing and bleeding. New vessels cannot sprout into the cut, so it stays open and oozes; surgery needs the drug paused.");
  capEl = mk("text", { class: "bv-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. Mopped up VEGF starves the tumour: the sprout stalls, vessels regress and the mass shrinks."],
    ["bp", "High BP", "g-bad", "Hypertension. Less VEGF means less endothelial nitric oxide, so arteries tighten and pressure rises. BP control keeps it down."],
    ["kid", "Proteinuria", "g-fl", "Protein in the urine. Glomerular cells need VEGF to keep the filter tight, so blockade lets protein leak through."],
    ["clot", "Artery clot", "g-clot", "Arterial thrombosis. The injured lining of a tightened artery seeds clots that can block flow."],
    ["gut", "Perforation", "g-eos", "Gut perforation. Blockade weakens the bowel wall and its blood supply until a patch tears open and spills."],
    ["wound", "Wound healing", "g-neu", "Poor healing and bleeding. No new vessels can sprout into the cut, so it stays open and oozes; pausing the drug around surgery protects it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Grow: 0.7, Leak: 0.7, BP: 0.2, Pu: 0.2, Cl: 0.1, Pf: 0.1, Wd: 0.2, on: 0, mon: 0 };
const acc = { veg: 0, ab: 0, deb: 0, leak: 0, prot: 0, no: 0, flo: 0, spill: 0, bleed: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Grow = lerp(sm.Grow, m.Grow, k); sm.Leak = lerp(sm.Leak, m.Leak, k);
  sm.BP = lerp(sm.BP, m.BP, k); sm.Pu = lerp(sm.Pu, m.Pu, k); sm.Cl = lerp(sm.Cl, m.Cl, k);
  sm.Pf = lerp(sm.Pf, m.Pf, k); sm.Wd = lerp(sm.Wd, m.Wd, k); sm.on = lerp(sm.on, m.on, k); sm.mon = lerp(sm.mon, m.mon, k);
  /* tumour cluster grows without treatment, shrinks with kill */
  cs = (1 - 0.1 * sm.K * sm.on + (1 - sm.on) * 0.05) * (1 + 0.015 * Math.sin(tm / 700));
  place(tumA, TCX, TCY, 0, cs);
  place(tumB, 258, 322, 0, cs);
  place(tumC, 358, 248, 0, cs);
  /* sprout length follows growth; tip cell rides the end */
  const llen = 18 + 118 * sm.Grow;
  tipX = 88 + llen; tipY = 292 - 8 * sm.Grow;
  const tw = 4 + 2 * sm.Grow;
  sproutPath.setAttribute("d", "M88 283L" + f1(tipX) + " " + f1(tipY - tw) + "L" + f1(tipX) + " " + f1(tipY + tw) + "L88 301Z");
  place(tipG, tipX, tipY, 0, 0.7 + 0.5 * sm.Grow);
  /* red cells flow down the parent vessel */
  rbcs.forEach((r) => { r.y += 46 * dt; if (r.y > 392) r.y = 128; place(r.g, 64 + Math.sin(tm / 600 + r.i * 2) * 8, r.y, r.rot, 1); });
  /* VEGF leaves the tumour rim and homes to the sprout tip */
  acc.veg += dt * (3 + 5 * (1 - sm.K * sm.on));
  while (acc.veg >= 1) { acc.veg--; const p = free(vegP); if (p) { const a = rnd(2.4, 3.9); emit(p, TCX + Math.cos(a) * 62 * cs, TCY + Math.sin(a) * 62 * cs, 0, 0, 0); } }
  vegP.forEach((p) => { if (!p.on) return; p.t += dt; const dx = tipX - p.x, dy = tipY - p.y, d = Math.hypot(dx, dy) || 1, v = 60 * dt;
    p.x += dx / d * v + Math.sin(tm / 400 + p.y) * 0.3; p.y += dy / d * v;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 10 || p.t > 9) kill(p); });
  /* antibodies fly in and mop up VEGF; the pair drifts off as a complex */
  const want = m.on ? 10 : 0;
  let n = 0;
  abP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; });
  acc.ab += dt * m.on * 2.6;
  while (acc.ab >= 1) { acc.ab--; if (n < want) { const p = free(abP); if (p) { emit(p, rnd(16, 50), rnd(150, 260), 0, 0, 0); n++; } } }
  if (n > want) { const p = abP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  abP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) {
      if (!p.q || !p.q.on) { let best = null, bd = 1e9; vegP.forEach((q) => { if (!q.on) return; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }); p.q = best; }
      const tx = p.q ? p.q.x : 180, ty = p.q ? p.q.y : 220;
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1, v = (p.q ? 130 : 40) * dt;
      p.x += dx / d * Math.min(v, d); p.y += dy / d * Math.min(v, d);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 47) + ")");
      if (p.q && d < 9) { const c = free(cxP); if (c) emit(c, p.x, p.y, -20, 16, 0); kill(p.q); kill(p); }
    } else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  cxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5 || p.x < 16) kill(p); });
  /* debris from dying tumour cells */
  acc.deb += dt * sm.K * sm.on * 8;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * 62 * cs, TCY + Math.sin(a) * 62 * cs, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* leaky sprout drips until vessels normalise */
  acc.leak += dt * sm.Leak * 10;
  while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) { const lx = rnd(92, Math.max(93, tipX)); emit(p, lx, 292 + (tipY - 292) * (lx - 88) / llen + rnd(4, 8), rnd(-4, 4), rnd(22, 36), 0); } }
  leakP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8 || p.y > 430) kill(p); });
  /* kidney leaks protein into the urine */
  kidTint.setAttribute("opacity", (sm.Pu * 0.5).toFixed(2));
  acc.prot += dt * sm.Pu * 9;
  while (acc.prot >= 1) { acc.prot--; const p = free(protP); if (p) emit(p, 605 + rnd(-22, 22), 205, rnd(-3, 3), rnd(45, 65), 0); }
  protP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp((285 - p.y) / 50).toFixed(2)); if (p.y > 285) kill(p); });
  /* artery tightens, nitric oxide fades, clot grows, flow races */
  const sx = 1 - 0.3 * sm.BP;
  artO.g.setAttribute("transform", "translate(830 170) scale(" + sx.toFixed(3) + " 1)");
  artRing.setAttribute("opacity", sm.mon.toFixed(2));
  acc.no += dt * (1 - sm.BP) * 6;
  while (acc.no >= 1) { acc.no--; const p = free(noP); if (p) { const s = Math.random() < 0.5 ? -1 : 1; emit(p, 830 + s * (30 * sx + 5), rnd(115, 225), s * rnd(10, 18), rnd(-6, 6), 0); } }
  noP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  acc.flo += dt * (4 + 10 * sm.BP);
  while (acc.flo >= 1) { acc.flo--; const p = free(floP); if (p) emit(p, 830 + rnd(-8, 8), 106, 0, 70 + 130 * sm.BP, 0); }
  floP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 236) kill(p); });
  const cs2 = clamp((sm.Cl - 0.05) * 1.6);
  place(clotG, 830, 195, 0, 0.12 + 0.88 * cs2); clotG.style.opacity = sm.Cl > 0.06 ? 1 : 0;
  /* bowel weakens, tears and spills */
  gutTint.setAttribute("opacity", (sm.Pf * 0.6).toFixed(2));
  hole.setAttribute("rx", f1(1.5 + 9 * sm.Pf)); hole.setAttribute("ry", f1(1 + 6 * sm.Pf)); hole.setAttribute("opacity", sm.Pf > 0.05 ? "1" : "0");
  acc.spill += dt * sm.Pf * 8;
  while (acc.spill >= 1) { acc.spill--; const p = free(spillP); if (p) emit(p, 640 + rnd(-6, 6), 332, rnd(-26, 26), rnd(12, 42), 0); }
  spillP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y > 400) kill(p); });
  /* wound lips gape and bleed, or close with protection */
  const gap = 2 + 13 * sm.Wd;
  slit.setAttribute("y", f1(340 - gap / 2)); slit.setAttribute("height", f1(gap));
  lipT.setAttribute("y", f1(340 - gap / 2 - 5)); lipB.setAttribute("y", f1(340 + gap / 2 + 1));
  woundRing.setAttribute("opacity", sm.mon.toFixed(2));
  acc.bleed += dt * sm.Wd * 6;
  while (acc.bleed >= 1) { acc.bleed--; const p = free(bleedP); if (p) emit(p, rnd(772, 858), 342 + gap / 2, rnd(-3, 3), rnd(40, 60), 0); }
  bleedP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 402) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.25, 0.6, ["ok", "high", "very high"]));
  gg.kid.set(sm.Pu, wordOf(sm.Pu, 0.25, 0.6, ["none", "some", "heavy"])); gg.clot.set(sm.Cl, wordOf(sm.Cl, 0.3, 0.55, ["none", "small", "big"]));
  gg.gut.set(sm.Pf, wordOf(sm.Pf, 0.25, 0.6, ["sealed", "weak", "open hole"])); gg.wound.set(sm.Wd, wordOf(sm.Wd, 0.3, 0.6, ["healing", "slow", "open, bleeding"]));
}
run({ init, step });
