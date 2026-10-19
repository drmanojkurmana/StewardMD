/* Onc-ato scene: arsenic binds PML and tags the fusion with SUMO and ubiquitin for
 * destruction, so APL cells mature and die (left); heart, lung, liver and nerves show
 * the harms, with an ECG trace for the QT (right). */
const TCX = 240, TCY = 210;
const HX = 610, HY = 172, LX = 812, LY = 175, VX = 605, VY = 348, NX = 805, NY = 348;
const CH = [[585, 150], [625, 185], [660, 160]];
const L = { tum: $("tum"), ars: $("ars"), sumo: $("sumo"), ub: $("ub"), ros: $("ros"), deb: $("deb"), mat: $("mat"), heartSlot: $("heartSlot"), heartFx: $("heartFx"), ecg: $("ecg"), lungSlot: $("lungSlot"), lungFx: $("lungFx"), livSlot: $("livSlot"), livFx: $("livFx"), nerSlot: $("nerSlot"), nerFx: $("nerFx"), over: $("over"), panel: $("panel") };
const ASLOTS = [[206, 204], [218, 210], [206, 216]];
const SSLOTS = [[210, 193], [232, 193], [252, 193], [272, 193]];
const UBDOTS = [[232, 228], [240, 234], [236, 241], [244, 246], [240, 253]];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
/* dock-and-leave machine shared by the arsenic wedges and SUMO tags */
function dockStep(pl, slots, want, add, entry, spin, dt, edge) {
  let n = 0;
  pl.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; });
  pl._v = (pl._v || 0) + add;
  while (pl._v >= 1) { pl._v--; if (n < want) { const p = free(pl); if (p) { const used = {}; pl.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < slots.length) si++; emit(p, entry[0] + rnd(-8, 8), entry[1] + rnd(-8, 8), 0, 0, si % slots.length); n++; } } }
  if (n > want) { const p = pl.find((q) => q.on && q.st === 2) || pl.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  pl.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = slots[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 110 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 47) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(spin ? p.k * 30 : 0) + ")");
    else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - edge) / 40).toFixed(2)); if (p.x < edge + 2) kill(p); }
  });
}
let tumG = null, glow = null, clampP = null, clampR = null, arrowX = null, traceEl = null, capEl = null, capKey = "", heartO = null, shield = null, heartTint = null, eff = null, livTint = null, nerTint = null;
let neus = [], blebs = [], ubDots = [], chanOpen = [], chanBlk = [], statiks = [], gg = {};
let arsP, sumoP, rosP, debP, harsP, kP, kmP, cytP, leakP, enzP, sigP, kmi = 0;
function capText(d, l) {
  if (d === 0) return "No treatment. PML-RARa clamps the maturation genes shut, so leukaemia cells pile up and no drug harm builds.";
  if (d === 2 && l === 0) return "Early course with heart protection. Arsenic destroys the fusion while potassium and magnesium keep the rhythm steadier.";
  if (d === 2 && l === 1) return "Middle course with heart protection. Leukaemia cells mature and die while the guarded heart keeps a steadier rhythm.";
  if (d === 2) return "Late course with heart protection. Leukaemia is controlled with the rhythm guarded, though liver, nerves and fatigue still need care.";
  if (l === 0) return "Early arsenic. The drug binds PML and tags the fusion for destruction, but the QT stretches and the syndrome threatens.";
  if (l === 1) return "Middle course. Leukaemia cells mature and die while the QT lengthens, the liver strains and nerves tingle.";
  return "Late course. Most leukaemia is gone but harm has built: twisting rhythm risk, liver strain, numb nerves and fatigue.";
}
function init() {
  /* ---- APL blast: DNA with the PML-RARa clamp, PML half marked for arsenic ---- */
  tumG = cell(L.tum, { cls: "lymph", r: 85, nuc: 0.55, seed: 5, wob: 0.07, n: 10 });
  const hot = mk("g", { class: "hot", tabindex: "0", "data-info": "APL blast stuck by PML-RARa. The fusion clamps maturation genes shut; without arsenic the blasts pile up instead of maturing." }, L.tum);
  mk("circle", { cx: TCX, cy: TCY, r: 85, fill: "none", "pointer-events": "all" }, hot);
  mk("path", { class: "aa-dna", d: "M195 206L285 206M195 214L285 214" }, L.tum);
  let rg = "";
  for (let x = 199; x <= 283; x += 9) rg += "M" + x + " 206L" + x + " 214";
  mk("path", { class: "aa-rung", d: rg }, L.tum);
  glow = mk("path", { class: "aa-glow", d: "M195 210L285 210", opacity: "0" }, L.tum);
  clampP = mk("g", { class: "aa-clamp aa-pml" }, L.tum);
  mk("rect", { class: "aa-cb", x: 198, y: 198, width: 40, height: 24, rx: 8 }, clampP);
  mk("circle", { class: "aa-cb", cx: 198, cy: 210, r: 9 }, clampP);
  clampR = mk("g", { class: "aa-clamp" }, L.tum);
  mk("rect", { class: "aa-cb", x: 242, y: 198, width: 40, height: 24, rx: 8 }, clampR);
  mk("circle", { class: "aa-cb", cx: 282, cy: 210, r: 9 }, clampR);
  arsP = pool(7, () => mk("path", { class: "sc-p aa-ars", d: "M0 -5L4 0L0 5L-4 0Z" }, L.ars));
  sumoP = pool(6, () => mk("rect", { class: "sc-p aa-sumo", x: -3.5, y: -3.5, width: 7, height: 7, rx: 1 }, L.sumo));
  ubDots = UBDOTS.map(([x, y]) => mk("circle", { class: "sc-p aa-ub", cx: x, cy: y, r: 2.2, opacity: "0" }, L.ub));
  rosP = pool(8, () => mk("path", { class: "aa-ros", d: "M0 -5L1.5 -1.5L5 0L1.5 1.5L0 5L-1.5 1.5L-5 0L-1.5 -1.5Z" }, L.ros));
  debP = pool(12, () => mk("circle", { class: "sc-p aa-deb", r: 2.5 }, L.deb));
  /* ---- maturation arrow, block cross, new neutrophils, apoptotic fragments ---- */
  mk("path", { class: "aa-arrow", d: "M240 302L240 330M234 324L240 332L246 324" }, L.mat);
  arrowX = mk("path", { class: "aa-blockx", d: "M230 307L250 327M250 307L230 327" }, L.mat);
  neus = [180, 240, 300].map((x, i) => cell(L.mat, { cls: "neut", r: 13, nuc: 0.55, nucCls: "multi", seed: i + 11, wob: 0.14, x, y: 362 }));
  blebs = [[95, 340, 6], [125, 368, 8], [105, 392, 6], [375, 368, 8], [345, 392, 6], [405, 340, 7]].map(([x, y, r]) => ({ e: mk("circle", { class: "aa-bleb", cx: x, cy: y, r, opacity: "0" }, L.mat), x, y }));
  /* ---- heart with potassium channels, arsenic block, shield, K and Mg rescue ---- */
  heartO = organ(L.heartSlot, "heart", HX, HY, 140, { h: 130 });
  heartTint = mk("ellipse", { class: "aa-tint", cx: HX, cy: HY, rx: 58, ry: 52, opacity: "0" }, L.heartFx);
  CH.forEach(([x, y]) => {
    chanOpen.push(mk("rect", { class: "aa-chan", x: x - 5, y: y - 3.5, width: 10, height: 7, rx: 3 }, L.heartFx));
    chanBlk.push(mk("rect", { class: "aa-chanblk", x: x - 5, y: y - 3.5, width: 10, height: 7, rx: 3, opacity: "0" }, L.heartFx));
  });
  shield = mk("ellipse", { class: "aa-shield", cx: HX, cy: HY, rx: 82, ry: 76, opacity: "0" }, L.heartFx);
  harsP = pool(6, () => mk("path", { class: "sc-p aa-ars", d: "M0 -5L4 0L0 5L-4 0Z" }, L.heartFx));
  kP = pool(10, () => mk("circle", { class: "sc-p aa-k", r: 2.4 }, L.heartFx));
  kmP = pool(8, () => { kmi++; return mk("circle", { class: "sc-p " + (kmi % 2 ? "aa-mg" : "aa-k"), r: 3 }, L.heartFx); });
  /* ---- ECG monitor strip ---- */
  mk("rect", { class: "aa-ecgbox", x: 500, y: 248, width: 430, height: 52, rx: 8 }, L.ecg);
  traceEl = mk("path", { class: "aa-trace" }, L.ecg);
  /* ---- lung: cytokines, capillary leak, effusion ---- */
  organ(L.lungSlot, "lung", LX, LY, 150, { h: 135 });
  eff = mk("ellipse", { class: "aa-eff", cx: LX, cy: 230, rx: 14, ry: 3, opacity: "0" }, L.lungFx);
  cytP = pool(18, () => mk("circle", { class: "sc-p aa-cyt", r: 2.4 }, L.lungFx));
  leakP = pool(14, () => mk("circle", { class: "aa-leak", r: 2.4 }, L.lungFx));
  /* ---- liver: strain tint and leaking enzymes ---- */
  organ(L.livSlot, "liver", VX, VY, 140, { h: 80 });
  livTint = mk("ellipse", { class: "aa-tint", cx: VX, cy: VY, rx: 62, ry: 34, opacity: "0" }, L.livFx);
  enzP = pool(10, () => mk("circle", { class: "sc-p aa-enz", r: 2.4 }, L.livFx));
  /* ---- nerve: signals falter along the fibre, static crackles ---- */
  organ(L.nerSlot, "ganglion", NX, NY, 130, { h: 90 });
  nerTint = mk("ellipse", { class: "aa-tint", cx: NX, cy: NY, rx: 30, ry: 24, opacity: "0" }, L.nerFx);
  sigP = pool(8, () => mk("circle", { class: "sc-p aa-sig", r: 3 }, L.nerFx));
  statiks = [[750, 344], [762, 352], [848, 344], [858, 352], [805, 326]].map(([x, y], i) => mk("path", { class: "aa-stat", d: "M0 -4L0 4", transform: "translate(" + x + " " + y + ") rotate(" + (i * 37) + ")", opacity: "0" }, L.nerFx));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Arsenic", 46, 215, 74, 118, "Arsenic trioxide. It binds the PML half of the fusion protein and starts the tagging that destroys it.");
  pill(o, "PML-RARa", 240, 210, 366, 112, "PML-RARa fusion protein. It clamps maturation genes shut; arsenic binds the PML half and marks the whole clamp for destruction.");
  pill(o, "Matures or dies", 180, 362, 118, 415, "Freed genes restart maturation, so blasts become neutrophils, while others die by apoptosis and break into fragments.");
  pill(o, "Blocked K channels", 625, 185, 610, 92, "Potassium channel block. Arsenic plugs heart potassium channels, delaying recharge and stretching the QT; low potassium or magnesium makes it worse.");
  pill(o, "Leaky lung", 860, 195, 812, 92, "Differentiation syndrome. Maturing cells release cytokines that make lung capillaries leak, flooding air spaces and pleura.");
  pill(o, "Long QT", 860, 290, 905, 320, "The ECG. The QT stretch grows with each course and can twist into torsades; heart protection keeps it steadier.");
  pill(o, "Liver", 605, 378, 566, 414, "Liver injury. Arsenic strains liver cells, so liver enzymes rise in the blood.");
  pill(o, "Nerves", 805, 365, 845, 414, "Neuropathy. Arsenic injures sensory nerves, so signals falter and hands and feet tingle then go numb.");
  capEl = mk("text", { class: "aa-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["leu", "Leukaemia", "g-good", "Leukaemia kill. Arsenic destroys PML-RARa, so APL blasts mature and die by apoptosis."],
    ["syn", "Syndrome", "g-bad", "Differentiation syndrome. Maturing cells release cytokines that make lung capillaries leak: fever, breathlessness and fluid around the lung."],
    ["qt", "QT rhythm", "g-cyt", "QT prolongation and torsades. Arsenic blocks potassium channels, stretching the QT until the rhythm twists; potassium and magnesium kept up plus avoiding other QT drugs guards it."],
    ["liv", "Liver", "g-clot", "Liver strain. Arsenic injures liver cells, so liver enzymes leak into the blood."],
    ["ner", "Nerves", "g-neu", "Neuropathy. Arsenic damages sensory nerves, so hands and feet tingle and go numb; harm builds with each course."],
    ["fat", "Fatigue", "g-fl", "Fatigue. Treatment and the illness itself leave the patient washed out; tiredness builds through the course."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.4, Dg: 0.4, DS: 0.3, QT: 0.3, Liv: 0.3, Ner: 0.2, Fat: 0.3, on: 0, prot: 0 };
const acc = { ros: 0, deb: 0, k: 0, km: 0, cyt: 0, leak: 0, enz: 0, sig: 0 };
function ecgVal(tt) {
  const T = 1.15, p = (((tt / T) % 1) + 1) % 1;
  let v = 0;
  if (p > 0.06 && p < 0.16) v += 0.12 * Math.sin(Math.PI * (p - 0.06) / 0.1);
  if (p > 0.2 && p < 0.225) v -= 0.12 * Math.sin(Math.PI * (p - 0.2) / 0.025);
  if (p > 0.225 && p < 0.265) v += 1 * Math.sin(Math.PI * (p - 0.225) / 0.04);
  if (p > 0.265 && p < 0.29) v -= 0.22 * Math.sin(Math.PI * (p - 0.265) / 0.025);
  const tc = 0.44 + 0.22 * sm.QT;
  if (p > tc && p < tc + 0.24) v += 0.34 * Math.sin(Math.PI * (p - tc) / 0.24);
  const tw = clamp((sm.QT - 0.55) / 0.45);
  if (tw > 0) v += tw * 0.85 * Math.sin(tt * 19) * Math.sin(tt * 1.9 + 1);
  return v;
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Dg = lerp(sm.Dg, m.Dg, k); sm.DS = lerp(sm.DS, m.DS, k); sm.QT = lerp(sm.QT, m.QT, k);
  sm.Liv = lerp(sm.Liv, m.Liv, k); sm.Ner = lerp(sm.Ner, m.Ner, k); sm.Fat = lerp(sm.Fat, m.Fat, k); sm.on = lerp(sm.on, m.on, k); sm.prot = lerp(sm.prot, m.prot, k);
  /* blast shrinks as it dies; clamp splits and fades as arsenic destroys it */
  place(tumG, TCX, TCY, 0, (1 - 0.07 * sm.K) * (1 + 0.012 * Math.sin(tm / 700)));
  place(clampP, -sm.Dg * 14, 0, 0, 1); place(clampR, sm.Dg * 14, 0, 0, 1);
  clampP.setAttribute("opacity", (1 - sm.Dg).toFixed(2)); clampR.setAttribute("opacity", (1 - sm.Dg).toFixed(2));
  glow.setAttribute("opacity", (sm.Dg * (0.5 + 0.3 * Math.sin(tm / 300))).toFixed(2));
  ubDots.forEach((e, i) => e.setAttribute("opacity", sm.Dg > 0.12 + i * 0.14 ? "0.95" : "0"));
  /* arsenic wedges dock on the PML half; SUMO tags cap the clamp */
  dockStep(arsP, ASLOTS, m.on ? 3 : 0, dt * m.on * 2.2, [18, 210], true, dt, 16);
  dockStep(sumoP, SSLOTS, m.on ? 4 : 0, dt * m.on * 2.6, [240, 159], false, dt, 16);
  /* oxidative stress flashes around the clamp */
  acc.ros += dt * sm.on * 7;
  while (acc.ros >= 1) { acc.ros--; const p = free(rosP); if (p) emit(p, rnd(200, 280), rnd(190, 230), 0, 0, 0); }
  rosP.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.45).toFixed(2)); if (p.t > 0.45) kill(p); });
  /* debris from the destroyed clamp */
  acc.deb += dt * sm.on * sm.Dg * 6;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, 240 + Math.cos(a) * 40, 210 + Math.sin(a) * 14, Math.cos(a) * 22, Math.sin(a) * 22, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* maturation: cross lifts, neutrophils grow in, apoptotic fragments appear */
  arrowX.setAttribute("opacity", (1 - sm.Dg).toFixed(2));
  neus.forEach((g, i) => { const s = 0.15 + 0.85 * sm.Dg; place(g, [180, 240, 300][i], 362 + Math.sin(tm / 600 + i * 2) * 2, 0, s); g.style.opacity = sm.Dg > 0.1 ? 1 : 0; });
  blebs.forEach((b, i) => { b.e.setAttribute("opacity", sm.K > 0.12 ? "0.95" : "0"); b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y + Math.sin(tm / 700 + i * 2) * 2) + ") scale(" + (0.2 + 0.8 * sm.K).toFixed(2) + ") translate(" + f1(-b.x) + " " + f1(-b.y) + ")"); });
  /* heart: beat steadies or twists; channels flip from open to blocked */
  const T = 1.15, ph = ((tm / 1000) / T) % 1, sq = ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : 0;
  const tw = clamp((sm.QT - 0.55) / 0.45);
  place(heartO.g, HX, HY, tw * 5 * Math.sin(tm / 70), 1 + 0.08 * sq * (1 - 0.6 * tw) + tw * 0.03 * Math.sin(tm / 55));
  chanOpen.forEach((e) => e.setAttribute("opacity", (1 - sm.QT).toFixed(2)));
  chanBlk.forEach((e) => e.setAttribute("opacity", sm.QT.toFixed(2)));
  heartTint.setAttribute("opacity", (0.32 * sm.QT).toFixed(2));
  shield.setAttribute("opacity", sm.prot.toFixed(2));
  dockStep(harsP, CH, m.on ? 3 : 0, dt * m.on * 2, [490, 175], true, dt, 488);
  /* potassium leaves through open channels; little escapes when blocked */
  acc.k += dt * ((1 - sm.QT) * 6 + 0.5);
  while (acc.k >= 1) { acc.k--; const p = free(kP), c = pick(CH); if (p) emit(p, c[0] + rnd(-4, 4), c[1] + rnd(-3, 3), rnd(-15, 15), rnd(20, 35), 0); }
  kP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2 || p.y > 245) kill(p); });
  /* potassium and magnesium rescue drifts into the guarded heart */
  acc.km += dt * sm.prot * 4;
  while (acc.km >= 1) { acc.km--; const p = free(kmP); if (p) emit(p, rnd(694, 706), rnd(125, 225), -30, 0, 0); }
  kmP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.2 || p.x < 676) kill(p); });
  /* ECG trace: T wave slides later with QT, then twists into torsades */
  traceEl.style.stroke = tw > 0.4 ? "var(--c-bad)" : "var(--c-good)";
  let d = "";
  for (let x = 506; x <= 924; x += 3) { const age = (924 - x) / 110, v = ecgVal(tm / 1000 - age), y = clamp(277 - 26 * v, 252, 296); d += (x === 506 ? "M" : "L") + x + " " + f1(y); }
  traceEl.setAttribute("d", d);
  /* lung: cytokines surge, capillaries leak, effusion pools */
  acc.cyt += dt * sm.DS * 10;
  while (acc.cyt >= 1) { acc.cyt--; const p = free(cytP); if (p) emit(p, LX + rnd(-60, 60), rnd(140, 220), rnd(-6, 6), rnd(-20, -10), 0); }
  cytP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y < 112) kill(p); });
  acc.leak += dt * sm.DS * 7;
  while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) emit(p, LX + rnd(-35, 35), rnd(150, 180), 0, rnd(26, 38), 0); }
  leakP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 228) kill(p); });
  eff.setAttribute("rx", f1(14 + 34 * sm.DS)); eff.setAttribute("ry", f1(3 + 7 * sm.DS)); eff.setAttribute("opacity", (0.75 * sm.DS).toFixed(2));
  /* liver: strain tint and leaking enzymes */
  livTint.setAttribute("opacity", (0.4 * sm.Liv).toFixed(2));
  acc.enz += dt * sm.Liv * 7;
  while (acc.enz >= 1) { acc.enz -= 1; const p = free(enzP); if (p) emit(p, VX + rnd(-50, 50), rnd(370, 382), rnd(-4, 4), rnd(18, 30), 0); }
  enzP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 400) kill(p); });
  /* nerve: signals slow, flicker and die out; static crackles on the fibres */
  acc.sig += dt * 5 * (1 - 0.6 * sm.Ner);
  while (acc.sig >= 1) { acc.sig -= 1; const p = free(sigP); if (p) emit(p, 738, NY, rnd(70, 100), 0, 0); }
  sigP.forEach((p) => { if (!p.on) return; p.x += p.vx * (1 - 0.7 * sm.Ner) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", sm.Ner > 0.5 ? (0.35 + 0.65 * Math.abs(Math.sin(tm / 90 + p.x / 8))).toFixed(2) : "1"); if (p.x > 872 || (sm.Ner > 0.45 && p.x > 766 + (1 - sm.Ner) * 110)) kill(p); });
  statiks.forEach((e, i) => e.setAttribute("opacity", sm.Ner > 0.3 ? (sm.Ner * (0.4 + 0.6 * Math.abs(Math.sin(tm / 70 + i * 2)))).toFixed(2) : "0"));
  nerTint.setAttribute("opacity", (0.35 * sm.Ner).toFixed(2));
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.leu.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["growing", "slowing", "dying"])); gg.syn.set(sm.DS, wordOf(sm.DS, 0.3, 0.65, ["none", "warning", "severe"]));
  gg.qt.set(sm.QT, wordOf(sm.QT, 0.3, 0.6, ["steady", "long", "twisting"])); gg.liv.set(sm.Liv, wordOf(sm.Liv, 0.3, 0.6, ["calm", "raised", "strained"]));
  gg.ner.set(sm.Ner, wordOf(sm.Ner, 0.3, 0.6, ["fine", "tingling", "numb"])); gg.fat.set(sm.Fat, wordOf(sm.Fat, 0.3, 0.6, ["fresh", "tired", "spent"]));
}
run({ init, step });
