/* Biologics in type 2 airway and skin inflammation: allergen, Th2 cytokines, IgE mast cell arming,
 * eosinophils, mucus and barrier loss, and where anti-IgE, anti-IL-5 and anti-IL-4 receptor act. */
const L = { arrows: $("arrows"), muc: $("muc"), epi: $("epi"), musc: $("musc"), skin: $("skin"), immune: $("immune"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), airRed: $("airRed"), skinRed: $("skinRed") };
const W = SC.W;
/* ---- airway lining: plain cells in a row ---- */
const epiCells = [];
function initEpi() {
  for (let i = 0; i < 9; i++) { const g = mk("g", {}, L.epi); cell(g, { cls: "epi", r: 13, nuc: 0.3, seed: i + 1, wob: 0.06, n: 8 }); epiCells.push({ g, x: 44 + i * 33, i }); }
}
/* ---- airway smooth muscle band ---- */
const muscCells = [];
function initMuscle() { for (let i = 0; i < 5; i++) { const g = mk("g", {}, L.musc); mk("ellipse", { class: "bl-mus", rx: 28, ry: 9 }, g); mk("ellipse", { class: "bl-mus-n", rx: 7, ry: 3 }, g); muscCells.push({ g, x: 62 + i * 55, y: 248 }); } }
/* ---- mucus blobs in the lumen ---- */
const blobs = [];
function initMucus() { [150, 222, 286].forEach((x, i) => blobs.push({ e: mk("ellipse", { class: "mucus", rx: 14, ry: 7 }, L.muc), x, i })); }
/* ---- skin dermis dots ---- */
function initSkin() { [[660, 170], [700, 200], [880, 180], [910, 220], [680, 250], [900, 258], [740, 258], [860, 150]].forEach(([x, y], i) => mk("circle", { class: "bl-col", r: 2.4, cx: x, cy: y }, L.skin)); }
/* ---- fixed immune cells ---- */
const fix = {}, granules = [], igeDeco = [];
function addFix(key, x, y, o) { const g = mk("g", {}, L.immune), c = cell(g, o); fix[key] = { g, c, x, y, ph: x % 7 + y % 5 }; return fix[key]; }
function addMast(key, x, y, seed) {
  const f = addFix(key, x, y, { cls: "mast", r: 20, nuc: 0, seed, wob: 0.1 });
  for (let j = 0; j < 8; j++) granules.push({ e: mk("circle", { class: "gran", r: 2.5, cx: f1(Math.cos(j * 0.8 + seed) * 10), cy: f1(Math.sin(j * 1.9 + seed) * 9) }, f.g) });
  for (let j = 0; j < 6; j++) { const t = j * 1.05 + seed * 0.2; igeDeco.push({ e: mk("path", { class: "ige-y", d: "M0 0L0 -5M-3 -9L0 -5L3 -9", transform: "translate(" + f1(Math.cos(t) * 23) + " " + f1(Math.sin(t) * 23) + ") rotate(" + f1(t * 57.3 + 90) + ")" }, f.g) }); }
  return f;
}
function initImmune() {
  const dc = addFix("dc", 390, 150, { cls: "dc", r: 17, nuc: 0.4, seed: 3, wob: 0.16 });
  for (let j = 0; j < 7; j++) { const t = j * 0.9 + 0.3; mk("path", { class: "dend", d: "M" + f1(Math.cos(t) * 14) + " " + f1(Math.sin(t) * 14) + "L" + f1(Math.cos(t) * 27) + " " + f1(Math.sin(t) * 27) }, dc.g); }
  addFix("th2", 475, 162, { cls: "th2", r: 13, nuc: 0.6, seed: 6 });
  addFix("b", 565, 150, { cls: "bcell", r: 14, nuc: 0.5, seed: 7 });
  addMast("mastA", 180, 222, 9); addMast("mastS", 755, 222, 12);
}
/* ---- eosinophils recruited into airway and skin ---- */
const mob = [];
function initMobile() {
  for (let i = 0; i < 6; i++) { const air = i < 3, g = cell(L.immune, { cls: "eos", r: 11.5, nuc: 0.55, nucCls: "multi", seed: 30 + i, wob: 0.1 });
    mob.push({ g, hx: air ? 225 + i * 26 : 806 + (i - 3) * 26, hy: air ? 246 : 244, st: 0, x: 0, y: 0, i }); }
  mob.forEach((m) => { m.g.style.opacity = 0; place(m.g, -40, 250, 0, 0.1); });
}
/* ---- mediator tracks ---- */
const T = { dc2th: [[408, 148], [434, 155], [460, 160]], il4: [[490, 156], [522, 152], [550, 150]], igeL: [[552, 160], [440, 188], [310, 210]], igeR: [[578, 160], [660, 188], [736, 208]], il5L: [[464, 172], [360, 208], [262, 240]], il5R: [[488, 174], [650, 208], [818, 238]], il13L: [[462, 170], [310, 178], [186, 190]], il13R: [[490, 170], [640, 148], [766, 130]], histA: [[180, 242], [176, 256], [172, 266]], histS: [[755, 242], [780, 256], [804, 266]] };
const FLOWS = [["dc2th", "p-il4", "t2", 1.6], ["il4", "p-il4", "t2", 2.2], ["igeL", "p-ige", "ige", 2.6], ["igeR", "p-ige", "ige", 2.6], ["il5L", "p-il5", "eos", 2.6], ["il5R", "p-il5", "eos", 2.6], ["il13L", "p-il13", "il4", 2.2], ["il13R", "p-il13", "il4", 2.2], ["histA", "p-hist", "mast", 3.4], ["histS", "p-hist", "mast", 3.4]]
  .map(([k, cls, src, rate]) => ({ k, cls, src, rate, tr: track(T[k]), acc: 0 }));
function chev(parent, a, b) { const t = Math.atan2(b[1] - a[1], b[0] - a[0]), p = (d, o) => f1(b[0] - Math.cos(t + o) * d) + " " + f1(b[1] - Math.sin(t + o) * d); return mk("path", { class: "arh", d: "M" + p(7, 0.5) + "L" + f1(b[0]) + " " + f1(b[1]) + "L" + p(7, -0.5) }, parent); }
function initArrows() { for (const k in T) { const pts = T[k]; mk("path", { class: "ar", d: "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L") }, L.arrows); chev(L.arrows, pts[pts.length - 2], pts[pts.length - 1]); } }
/* ---- particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, f: null }; }); }
const parts = pool(120, () => mk("circle", { r: 2.3 }, L.parts));
function emitP(f) { const p = parts.find((q) => !q.on); if (!p) return; p.on = true; p.f = f; p.u = 0; p.e.setAttribute("class", "sc-p " + f.cls); p.e.setAttribute("r", f.k === "igeL" || f.k === "igeR" ? 3 : 2.3); p.e.setAttribute("opacity", "1"); }
const trig = pool(18, () => mk("path", { d: "M0 -5L1.4 -1.4L5 0L1.4 1.4L0 5L-1.4 1.4L-5 0L-1.4 -1.4Z", class: "p-alg" }, L.parts));
/* ---- treatment marks: antibody Y shapes, block caps, receptor shields ---- */
const mkG = {};
function capAt(g, x, y) { mk("circle", { class: "blk-c", cx: x, cy: y, r: 7.5 }, g); mk("path", { class: "blk-x", d: "M" + (x - 3.6) + " " + (y - 3.6) + "l7.2 7.2M" + (x + 3.6) + " " + (y - 3.6) + "l-7.2 7.2" }, g); }
function abAt(g, x, y, rot) { mk("path", { class: "ab-y", d: "M0 0L0 -6M-4 -11L0 -6L4 -11", transform: "translate(" + x + " " + y + ") rotate(" + rot + ")" }, g); }
function initMarks() {
  const g1 = mk("g", { opacity: 0 }, L.marks); mkG[1] = g1;
  capAt(g1, 440, 188); capAt(g1, 660, 188); abAt(g1, 380, 200, 24); abAt(g1, 500, 176, -18); abAt(g1, 620, 178, 20); abAt(g1, 700, 196, -24);
  const g2 = mk("g", { opacity: 0 }, L.marks); mkG[2] = g2;
  capAt(g2, 360, 208); capAt(g2, 650, 208); abAt(g2, 420, 192, 20); abAt(g2, 300, 226, -22); abAt(g2, 560, 192, 18); abAt(g2, 740, 224, -20);
  const g3 = mk("g", { opacity: 0 }, L.marks); mkG[3] = g3;
  capAt(g3, 522, 152); capAt(g3, 310, 178); capAt(g3, 640, 148);
  abAt(g3, 470, 168, 12); abAt(g3, 250, 184, -14); abAt(g3, 700, 140, 16);
  [[565, 132], [120, 156], [770, 100]].forEach(([x, y]) => mk("path", { class: "rec-sh", d: "M" + (x - 9) + " " + y + "A9 9 0 0 1 " + (x + 9) + " " + y }, g3));
}
/* ---- labels, gauges, safety note ---- */
const gg = {}, dpills = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Type 2 inflammation";
  [["t2", "Th2", "g-cyt", "Th2 helper activity. Allergen shown by dendritic cells wakes Th2 cells, which release IL-4, IL-5 and IL-13."], ["ige", "IgE", "g-bad", "Free IgE in the tissue fluid. It arms mast cells. Anti-IgE binds it up."], ["eos", "Eos", "g-eos", "Eosinophils in airway and skin, called in by IL-5. Anti-IL-5 lowers them."], ["mast", "Mast", "g-mast", "Mast cell firing. Allergen cross links IgE on the surface and histamine is released."], ["flare", "Flare", "g-fl", "Flare: tight airway plus red itchy skin. Each biologic calms it through its own path."], ["ctrl", "Control", "g-good", "Control: calm airway and settled skin. Rises as flare falls."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const nt = mk("text", { class: "sc-note", x: 480, y: 582 }, P); nt.textContent = "Watch outs: injection reactions with each biologic. Rare anaphylaxis with anti-IgE. Eye irritation with anti-IL-4 receptor.";
  const ox = L.over;
  pill(ox, "Airway", 170, 116, 140, 64, "Airway wall. In type 2 inflammation the lining makes mucus and the muscle tightens.");
  pill(ox, "Allergen", 430, 66, 300, 64, "Allergen from air or skin. Dendritic cells pick it up and show it to helper T cells.");
  pill(ox, "Skin", 790, 116, 850, 64, "Skin. In atopic dermatitis the barrier leaks and type 2 inflammation reddens and itches it.");
  pill(ox, "Epithelium", 120, 168, 200, 96, "Airway lining. IL-13 makes it grow more mucus cells.");
  pill(ox, "Mucus", 250, 112, 330, 96, "Mucus sitting in the lumen. Thick mucus narrows the airway.");
  pill(ox, "IL-13", 350, 180, 440, 96, "IL-13 from Th2 cells. It drives mucus, twitchy muscle and skin barrier loss.");
  pill(ox, "Skin barrier", 770, 128, 690, 96, "Skin barrier. IL-4 and IL-13 weaken it so water leaves and irritants enter.");
  pill(ox, "Dendritic", 390, 150, 370, 320, "Dendritic cell. It picks up allergen and wakes helper T cells.");
  pill(ox, "Th2 cell", 475, 162, 480, 320, "Th2 helper cell. It releases IL-4, IL-5 and IL-13.");
  pill(ox, "B cell", 565, 150, 590, 320, "B cell. IL-4 tells it to switch to making IgE.");
  pill(ox, "IgE", 630, 182, 690, 320, "IgE antibody. It arms mast cells and waits for allergen.");
  pill(ox, "IL-5", 420, 190, 410, 280, "IL-5 from Th2 cells. It calls in eosinophils and keeps them alive.");
  pill(ox, "IL-4", 525, 158, 530, 280, "IL-4 from Th2 cells. It pushes IgE switching and Th2 growth.");
  pill(ox, "Mast cell", 180, 222, 120, 385, "Airway mast cell armed with IgE. Allergen cross links it and histamine is released.");
  pill(ox, "Eosinophil", 255, 250, 262, 385, "Eosinophils. Their granules injure lining and keep flares going.");
  pill(ox, "Muscle", 170, 258, 400, 385, "Airway smooth muscle. Mast mediators and IL-13 make it tighten.");
  pill(ox, "Skin flare", 810, 270, 560, 385, "Flare: redness, swelling and itch where mast cells and eosinophils gather.");
  pill(ox, "Skin mast", 755, 222, 705, 385, "Skin mast cell. Same IgE arming as in the airway.");
  pill(ox, "Histamine", 830, 250, 845, 385, "Histamine and other mast mediators. They redden skin and tighten muscle.");
  [[1, "Anti-IgE", "Anti-IgE binds free IgE in the tissue fluid, so less IgE arms mast cells and they fire less. Watch out for injection reactions and rare anaphylaxis."], [2, "Anti-IL-5", "Anti-IL-5 soaks up IL-5, so fewer eosinophils are called in and kept alive. Watch out for injection reactions."], [3, "Anti-IL-4R", "Anti-IL-4 receptor blocks the shared alpha chain used by IL-4 and IL-13, calming mucus, barrier loss and IgE switching. Watch out for injection reactions and eye irritation."]]
    .forEach(([d, n, tip]) => { dpills[d] = pill(ox, n, 505, 96, 505, 64, tip); dpills[d].style.opacity = 0; });
}
const s = { t2: 0.5, ige: 0.5, eos: 0.5, mast: 0.5, flare: 0.5, ctrl: 0.5, il4: 0.5 }, dw = [1, 0, 0, 0, 0];
const acc = { allergen: 0 };
function init() { initArrows(); initEpi(); initMuscle(); initMucus(); initSkin(); initImmune(); initMobile(); initMarks(); initPanel(); }
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 1.2);
  for (const q of ["t2", "ige", "eos", "mast", "flare", "ctrl", "il4"]) s[q] = lerp(s[q], m[q === "t2" ? "a" : q], q === "flare" || q === "ctrl" ? k1 : k2);
  dw.forEach((_, d) => { dw[d] = lerp(dw[d], m.drug === d ? 1 : 0, k1); });
  epiCells.forEach((e) => place(e.g, e.x, 168 + Math.sin(tm / 900 + e.i) * 0.7, 0, 1));
  const mv = clamp(s.il4 * 1.3);
  blobs.forEach((b) => { const v = clamp(mv - b.i * 0.18); b.e.setAttribute("transform", "translate(" + f1(b.x) + " 114) scale(" + (0.15 + 0.85 * v).toFixed(2) + ")"); b.e.setAttribute("opacity", v > 0.05 ? "1" : "0"); });
  muscCells.forEach((c) => c.g.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y) + ") scale(" + (1 - 0.2 * s.flare).toFixed(2) + " " + (1 + 0.3 * s.flare).toFixed(2) + ")"));
  L.airRed.setAttribute("opacity", (s.flare * 0.5).toFixed(2)); L.skinRed.setAttribute("opacity", (s.flare * 0.5).toFixed(2));
  for (const k in fix) { const f = fix[k], act = k === "mastA" || k === "mastS" ? s.mast : k === "b" ? s.ige : s.t2; place(f.g, f.x + Math.sin(tm / 1500 + f.ph) * 2.5, f.y + Math.cos(tm / 1700 + f.ph) * 2.2, Math.sin(tm / 2400 + f.ph) * 5, 1 + 0.05 * act * Math.sin(tm / 320 + f.ph)); f.g.style.opacity = (0.55 + 0.45 * clamp(act * 1.3)).toFixed(2); }
  granules.forEach((g) => g.e.setAttribute("opacity", (1 - 0.7 * s.mast).toFixed(2)));
  igeDeco.forEach((y) => { y.e.style.opacity = ((1 - 0.9 * dw[1]) * (0.3 + 0.7 * s.t2)).toFixed(2); });
  const ne = Math.round(s.eos * 6);
  mob.forEach((o) => { const want = o.i < ne, op = parseFloat(o.g.style.opacity || 0);
    if (o.st === 0) { if (want) { o.st = 1; o.x = o.hx + rnd(-24, 24); o.y = 300; o.g.style.opacity = 1; } }
    else if (o.st === 1) { o.y -= 44 * dt; o.x += (o.hx - o.x) * dt * 0.8; place(o.g, o.x, o.y, 0, 1); if (o.y <= o.hy) o.st = 2; if (!want) o.st = 3; }
    else if (o.st === 2) { place(o.g, o.hx + Math.sin(tm / 700 + o.i) * 6, o.hy + Math.cos(tm / 900 + o.i * 2) * 4, Math.sin(tm / 500 + o.i) * 14, 1); if (!want) o.st = 3; }
    else { o.g.style.opacity = Math.max(0, op - dt * 0.7); if (op < 0.06) { o.st = 0; o.g.style.opacity = 0; } } });
  const rate = { t2: s.t2, ige: s.ige * (1 - 0.85 * dw[1]), eos: s.eos * (1 - 0.4 * dw[2]), il4: s.il4 * (1 - 0.8 * dw[3]), mast: s.mast * (1 - 0.5 * dw[1]) * (1 - 0.25 * dw[3]) };
  FLOWS.forEach((f) => { let r = f.rate * (rate[f.src] || 0); f.acc += dt * r; while (f.acc >= 1) { f.acc--; emitP(f); } });
  parts.forEach((p) => { if (!p.on) return; p.u += dt * 0.45; const a = p.f.tr.at(p.u); p.e.setAttribute("cx", f1(a.x + Math.sin(tm / 300 + p.u * 9) * 1.2)); p.e.setAttribute("cy", f1(a.y)); if (p.u > 1) { p.on = false; p.e.setAttribute("opacity", "0"); } else p.e.setAttribute("opacity", f1(Math.min(1, p.u * 6, (1 - p.u) * 6))); });
  acc.allergen += dt * 2.4 * (0.3 + s.t2);
  while (acc.allergen >= 1) { acc.allergen--; const p = trig.find((q) => !q.on); if (p) { p.on = true; p.x = rnd(360, 580); p.y = 52; p.vx = rnd(-6, 6); p.e.setAttribute("opacity", "1"); } }
  trig.forEach((p) => { if (!p.on) return; p.y += 32 * dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.y * 3) + ")"); if (p.y > 138) { p.on = false; p.e.setAttribute("opacity", "0"); } });
  for (const d in mkG) mkG[d].setAttribute("opacity", dw[d].toFixed(2)); for (const d in dpills) dpills[d].style.opacity = dw[d].toFixed(2);
  gg.t2.set(s.t2, wordOf(s.t2, 0.25, 0.55, ["low", "raised", "high"]));
  gg.ige.set(s.ige, dw[1] > 0.5 && s.ige < 0.3 ? "blocked" : wordOf(s.ige, 0.25, 0.55, ["low", "raised", "high"]));
  gg.eos.set(s.eos, wordOf(s.eos, 0.25, 0.55, ["low", "raised", "high"]));
  gg.mast.set(s.mast, wordOf(s.mast, 0.3, 0.7, ["quiet", "primed", "firing"]));
  gg.flare.set(s.flare, wordOf(s.flare, 0.35, 0.7, ["calm", "ongoing", "severe"]));
  gg.ctrl.set(s.ctrl, wordOf(s.ctrl, 0.4, 0.7, ["poor", "fair", "good"]));
}
run({ init, step });
