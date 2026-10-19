/* Autonomic scene: two outflows, ganglia, transmitters, five target organs and gauges. */
const LY = { fibres: $("fibres"), nodes: $("nodes"), organs: $("organs"), parts: $("parts"), over: $("over"), panel: $("panel") };
function rows() {
  return [
    { id: "eye", y: 125, sym: 119, para: 135 },
    { id: "heart", y: 189, sym: 183, para: 199 },
    { id: "lung", y: 256, sym: 250, para: 266 },
    { id: "gut", y: 322, sym: 316, para: 332 },
    { id: "bladder", y: 387, sym: 381, para: 397 },
  ];
}
function line(parent, x1, y1, x2, y2, cls) { return mk("line", { class: cls, x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2) }, parent); }
function path(parent, d, cls) { return mk("path", { class: cls, d: d }, parent); }
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const achPreSym = pool(12, () => mk("circle", { class: "sc-p p-achs", r: 2.6 }, LY.parts));
const achPrePara = pool(22, () => mk("circle", { class: "sc-p p-achp", r: 2.6 }, LY.parts));
const naPost = pool(40, () => mk("circle", { class: "sc-p p-na", r: 2.4 }, LY.parts));
const achPost = pool(26, () => mk("circle", { class: "sc-p p-achm", r: 2.4 }, LY.parts));
const drops = pool(10, () => mk("path", { class: "ans-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, LY.parts));
const caps = pool(18, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });
const gutDots = [], blood = [];
const symLines = {}, paraLines = {}, recSym = {}, recPara = {};
const marks = {};
const gg = {};
let vesselEl = null, vesselMark = null, vesselW = 20;
let brainO = null, heartO = null, lungO = null;
let pupilEl = null, bronchL = null, bronchR = null, urineEl = null, capEl = null;
let haloB = null, haloME = null, haloML = null, haloAV = null, haloAE = null;
let prevDrug = -1, capKey = -1, spawned = 0;
const sm = { sym: 0, para: 1, heart: 0.1, pupil: 0.08, airway: 0.3, gut: 0.9, bladder: 0.9, vessel: 0.2, beta: 0, musc: 0, alpha: 0 };
const acc = { preS: 0, preP: 0, na: 0, ach: 0, drop: 0, cap: 0 };
function nicMarks(parent, cx, cy) {
  for (let j = 0; j < 3; j++) { const a = -0.7 + j * 0.7; mk("path", { class: "ans-nic", d: "M" + f1(cx + Math.cos(a) * 12) + " " + f1(cy + Math.sin(a) * 12) + "l" + f1(Math.cos(a) * 5) + " " + f1(Math.sin(a) * 5) }, parent); }
}
function buildVessel() {
  vesselEl = mk("rect", { class: "ans-vessel", x: 742, y: 100, width: 20, height: 300, rx: 10 }, LY.fibres);
  for (let i = 0; i < 8; i++) { const e = mk("circle", { class: "sc-p p-blood", r: 2.2 }, LY.parts); e.setAttribute("opacity", "1"); blood.push({ e, y: 100 + i * 38, jx: rnd(-0.7, 0.7), sp: rnd(0.85, 1.15) }); }
}
function buildNodes() {
  const N = LY.nodes, F = LY.fibres;
  mk("rect", { class: "ans-cord", x: 88, y: 118, width: 24, height: 280, rx: 12 }, N);
  path(F, "M232 108L232 394", "ans-chain");
  path(F, "M124 80C150 84 168 100 168 130L168 397", "ans-vagus");
  path(F, "M96 386C120 404 148 402 168 397", "ans-paraline");
  rows().forEach((r) => {
    line(F, 112, r.sym, 221, r.sym, "ans-symline");
    line(F, 168, r.para, 612, r.para, "ans-paraline");
    symLines[r.id] = line(F, 243, r.sym, 785, r.sym, "ans-symline");
    paraLines[r.id] = line(F, 638, r.para, 785, r.para, "ans-paraline");
    mk("circle", { class: "ans-gang-sym", cx: 232, cy: r.sym, r: 11 }, N); nicMarks(N, 232, r.sym);
    mk("circle", { class: "ans-gang-para", cx: 625, cy: r.para, r: 11 }, N); nicMarks(N, 625, r.para);
    recSym[r.id] = mk("rect", { class: "ans-rec-sym", x: 781, y: f1(r.sym - 4), width: 8, height: 8, rx: 2 }, N);
    recPara[r.id] = mk("circle", { class: "ans-rec-para", cx: 785, cy: r.para, r: 4.4 }, N);
  });
  vesselMark = mk("path", { class: "ans-rec-sym", d: "M770 244L776 250L770 256L764 250Z" }, N);
}
function buildOrgans() {
  const O = LY.organs;
  haloB = mk("ellipse", { class: "au-halo-b", cx: 815, cy: 225, rx: 90, ry: 85 }, O);
  haloME = mk("ellipse", { class: "au-halo-m", cx: 820, cy: 125, rx: 65, ry: 50 }, O);
  haloML = mk("ellipse", { class: "au-halo-m", cx: 820, cy: 354, rx: 85, ry: 62 }, O);
  haloAV = mk("ellipse", { class: "au-halo-a", cx: 752, cy: 250, rx: 42, ry: 160 }, O);
  haloAE = mk("ellipse", { class: "au-halo-a", cx: 820, cy: 125, rx: 65, ry: 50 }, O);
  [haloB, haloME, haloML, haloAV, haloAE].forEach((h) => h.setAttribute("opacity", "0"));
  brainO = organ(O, "brain", 105, 92, 118, {});
  organ(O, "eye", 820, 125, 80, {});
  heartO = organ(O, "heart", 820, 189, 42, {});
  lungO = organ(O, "lung", 820, 256, 44, {});
  organ(O, "intestine", 820, 322, 58, {});
  organ(O, "bladder", 820, 387, 48, {});
  pupilEl = mk("circle", { class: "ans-pupil", cx: 796, cy: 125, r: 3.5 }, O);
  const hl = lungO.ports.hilumL, hr = lungO.ports.hilumR;
  bronchL = mk("circle", { class: "ans-bronch", cx: f1(hl[0]), cy: f1(hl[1]), r: 4 }, O);
  bronchR = mk("circle", { class: "ans-bronch", cx: f1(hr[0]), cy: f1(hr[1]), r: 4 }, O);
  urineEl = mk("ellipse", { class: "ans-urine", cx: 820, cy: 396, rx: 11, ry: 5 }, O);
  for (let i = 0; i < 3; i++) { const d = mk("circle", { class: "au-gutdot", cx: 810, cy: 322, r: 3 }, O); gutDots.push({ e: d, off: i * 0.33 }); }
}
function addMark(id, d, x, y, good) {
  const g = mk("g", {}, LY.over);
  if (good) { mk("path", { class: "mk-g", d: "M" + f1(x - 6) + " " + f1(y) + "l4 5l8 -10" }, g); }
  else { mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); }
  g.style.display = "none"; marks[id] = { g, drug: d };
}
function buildMarks() {
  addMark("bx-heart", 3, 785, 183, false); addMark("bx-lung", 3, 785, 250, false);
  addMark("mx-eye", 1, 785, 135, false); addMark("mx-heart", 1, 785, 199, false); addMark("mx-lung", 1, 785, 266, false);
  addMark("mx-gut", 1, 785, 332, false); addMark("mx-blad", 1, 785, 397, false);
  addMark("ax-ves", 2, 770, 250, true); addMark("ax-eye", 2, 785, 119, true);
}
function capText(d, l) {
  if (d === 3) return "Beta blocker sits on heart and airway receptors. Fight signals fade.";
  if (d === 1) return "Muscarinic blocker sits on rest receptors. Rest signals fade.";
  if (d === 2) return "Alpha agonist squeezes vessels and widens the pupil.";
  if (l === 2) return "No treatment. Fight signals win. The heart races and the gut waits.";
  if (l === 0) return "No treatment. Rest signals win. The heart slows and the gut moves.";
  return "No treatment. Both branches share the work.";
}
function buildLabels() {
  const O = LY.over;
  pill(O, "Brain and cord", 75, 75, 150, 58, "Control centre. Fight signals leave the mid cord. Rest signals leave the brainstem in the vagus nerve.");
  pill(O, "Two outflows", 232, 108, 330, 58, "Two outflows with opposite jobs. Short fibres relay in the chain and in ganglia near each organ. Every short fibre uses acetylcholine. Long fight fibres use noradrenaline and long rest fibres use acetylcholine again.");
  pill(O, "Eye", 858, 125, 910, 125, "Pupil size. Fight signals widen the pupil through alpha receptors. Rest signals narrow it for close work.");
  pill(O, "Heart", 840, 189, 906, 189, "Heart rate. Fight signals speed the heart through beta receptors. Rest signals slow it.");
  pill(O, "Lung", 841, 256, 906, 256, "Airways. Fight signals open the airways through beta receptors. Rest signals narrow them.");
  pill(O, "Gut", 848, 322, 904, 322, "Gut movement. Rest signals move food along. Fight signals pause digestion.");
  pill(O, "Bladder", 843, 387, 902, 387, "Bladder. Rest signals empty it. Fight signals hold urine.");
  pill(O, "Vessels", 752, 160, 648, 162, "Vessel tone. Fight signals squeeze vessels through alpha receptors, so pressure rises.");
  capEl = mk("text", { class: "au-cap", x: 30, y: 430 }, O); capEl.textContent = capText(0, 0);
}
function buildPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What the organs do";
  [["heart", "Heart rate", "g-bad", "Heart rate and force: beta sympathetic speeds it, muscarinic parasympathetic slows it."], ["pupil", "Pupil size", "g-eos", "Pupil size: alpha sympathetic widens it, muscarinic parasympathetic narrows it."], ["airway", "Airways", "g-fl", "Airway openness: beta sympathetic opens airways, muscarinic parasympathetic narrows them."], ["gut", "Gut activity", "g-bac", "Gut motility: muscarinic parasympathetic moves it, sympathetic slows it."], ["bladder", "Bladder", "g-cyt", "Bladder readiness to empty: muscarinic contracts the detrusor, sympathetic relaxes it and closes the outlet."], ["vessel", "Vessel tone", "g-clot", "Vessel tone and pressure tendency: alpha sympathetic tightens vessels, with little parasympathetic supply to most vessels."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 118 + i * 142, y0 + 2, 52, 18, cls, name, tip); });
}
function drugSites(d) {
  if (d === 3) return [[785, 183], [785, 183], [785, 183], [785, 250], [785, 250], [785, 250]];
  if (d === 1) return [[785, 135], [785, 199], [785, 266], [785, 332], [785, 397], [785, 135], [785, 199], [785, 266], [785, 332], [785, 397]];
  if (d === 2) return [[752, 240], [752, 270], [770, 244], [785, 119], [785, 119], [752, 255]];
  return [];
}
function capCls(el, on, base, cap) { const c = on ? base + " " + cap : base; if (el._c !== c) { el.setAttribute("class", c); el._c = c; } }
function init() { buildVessel(); buildNodes(); buildOrgans(); buildMarks(); buildLabels(); buildPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.sym = lerp(sm.sym, m.a, k); sm.para = lerp(sm.para, m.para, k); sm.heart = lerp(sm.heart, m.heart, k); sm.pupil = lerp(sm.pupil, m.pupil, k);
  sm.airway = lerp(sm.airway, m.airway, k); sm.gut = lerp(sm.gut, m.gut, k); sm.bladder = lerp(sm.bladder, m.bladder, k); sm.vessel = lerp(sm.vessel, m.vessel, k);
  sm.beta = lerp(sm.beta, m.betaBlock, k); sm.musc = lerp(sm.musc, m.muscBlock, k); sm.alpha = lerp(sm.alpha, m.alphaBoost, k);
  Object.keys(marks).forEach((id) => { marks[id].g.style.display = marks[id].drug === m.drug ? "" : "none"; });
  const bb = sm.beta > 0.5, mb = sm.musc > 0.5, ab = sm.alpha > 0.5;
  capCls(recSym.heart, bb, "ans-rec-sym", "ans-cap-b"); capCls(recSym.lung, bb, "ans-rec-sym", "ans-cap-b");
  capCls(recSym.eye, ab, "ans-rec-sym", "ans-cap-a"); capCls(vesselMark, ab, "ans-rec-sym", "ans-cap-a");
  ["eye", "heart", "lung", "gut", "bladder"].forEach((id) => capCls(recPara[id], mb, "ans-rec-para", "ans-cap-m"));
  symLines.heart.style.opacity = (0.75 - 0.6 * sm.beta).toFixed(2);
  symLines.lung.style.opacity = (0.75 - 0.6 * sm.beta).toFixed(2);
  symLines.eye.style.strokeWidth = (1.6 + 1.4 * sm.alpha).toFixed(2);
  ["eye", "heart", "lung", "gut", "bladder"].forEach((id) => { paraLines[id].style.opacity = (0.75 - 0.6 * sm.musc).toFixed(2); });
  haloB.setAttribute("opacity", (0.42 * sm.beta).toFixed(2));
  haloME.setAttribute("opacity", (0.42 * sm.musc).toFixed(2)); haloML.setAttribute("opacity", (0.42 * sm.musc).toFixed(2));
  haloAV.setAttribute("opacity", (0.42 * sm.alpha).toFixed(2)); haloAE.setAttribute("opacity", (0.42 * sm.alpha).toFixed(2));
  vesselW = 26 - 20 * sm.vessel;
  vesselEl.setAttribute("x", f1(752 - vesselW / 2)); vesselEl.setAttribute("width", f1(vesselW)); vesselEl.setAttribute("rx", f1(vesselW / 2));
  if (m.drug !== prevDrug) { prevDrug = m.drug; caps.forEach(kill); spawned = 0; acc.cap = 0; }
  if (m.drug > 0) {
    const sites = drugSites(m.drug);
    let parked = 0; caps.forEach((c) => { if (c.on && c.st === 1) parked++; });
    acc.cap += dt * 6;
    while (acc.cap >= 1 && parked < sites.length) {
      acc.cap--; const c = freeP(caps); if (!c) break;
      const s = sites[spawned % sites.length], slot = Math.floor(spawned / sites.length); spawned++; parked++;
      c.tx = s[0] + slot * 8 - 4; c.ty = s[1] - 10 - slot * 5; c.st = 0; emit(c, rnd(640, 780), 430, 0, 0);
    }
  }
  caps.forEach((c, ci) => {
    if (!c.on) return;
    if (c.st === 0) {
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < 5) { c.st = 1; place(c.e, c.tx, c.ty, 0, 1); }
      else { const v = 260 * dt / d; c.x += dx * v; c.y += dy * v; place(c.e, c.x, c.y, Math.atan2(dy, dx) * 57.2958, 1); }
    } else place(c.e, c.tx, c.ty + Math.sin(tm / 320 + ci) * 1.5, 0, 1);
  });
  acc.preS += dt * (2 + 7 * Math.max(sm.sym, sm.para)); while (acc.preS >= 1) { acc.preS--; const r = pick(rows()); const p = freeP(achPreSym); if (p) emit(p, 114, r.sym, 55, 0); }
  achPreSym.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 220) kill(p); });
  acc.preP += dt * (2 + 8 * sm.para); while (acc.preP >= 1) { acc.preP--; const r = pick(rows()); const p = freeP(achPrePara); if (p) emit(p, 170, r.para, 75, 0); }
  achPrePara.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 610) kill(p); });
  acc.na += dt * (1 + 13 * sm.sym); while (acc.na >= 1) { acc.na--; const r = pick(rows()); const p = freeP(naPost); if (p) emit(p, 246, r.sym, 92, 0, r.id); }
  naPost.forEach((p) => {
    if (!p.on) return; p.x += p.vx * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (bb && (p.k === "heart" || p.k === "lung") && p.x > 660) p.e.setAttribute("opacity", "0.12");
    if (p.x > 783) kill(p);
  });
  acc.ach += dt * (1 + 12 * sm.para); while (acc.ach >= 1) { acc.ach--; const r = pick(rows()); const p = freeP(achPost); if (p) emit(p, 640, r.para, 92, 0, r.id); }
  achPost.forEach((p) => {
    if (!p.on) return; p.x += p.vx * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (mb && p.x > 700) p.e.setAttribute("opacity", "0.12");
    if (p.x > 783) kill(p);
  });
  if (pupilEl) pupilEl.setAttribute("r", f1(3 + 3 * sm.pupil));
  if (heartO) { const s = 1 + 0.06 * Math.sin(tm / Math.max(90, 300 - 170 * sm.heart)) * (0.35 + sm.heart); heartO.g.setAttribute("transform", "translate(820 189) scale(" + s.toFixed(3) + ")"); }
  if (bronchL) { bronchL.setAttribute("r", f1(2 + 3.5 * sm.airway)); bronchR.setAttribute("r", f1(2 + 3.5 * sm.airway)); }
  gutDots.forEach((d, i) => { const u = (tm / 1000 * (0.08 + 0.5 * sm.gut) + d.off) % 1; d.e.setAttribute("cx", f1(800 + u * 40)); d.e.setAttribute("cy", f1(316 + (i % 3) * 7 + Math.sin(u * 9 + i) * 3)); });
  if (urineEl) urineEl.setAttribute("ry", f1(2 + 9 * sm.bladder));
  blood.forEach((b) => { b.y += dt * (25 + 70 * sm.heart) * b.sp; if (b.y > 400) b.y = 100; b.e.setAttribute("transform", "translate(" + f1(752 + b.jx * Math.max(1, vesselW / 2 - 3)) + " " + f1(b.y) + ")"); });
  acc.drop += dt * sm.bladder * 3.2; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p && sm.bladder > 0.55) emit(p, 820 + rnd(-3, 3), 420, 0, 16, 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 436) kill(p); });
  gg.heart.set(sm.heart, wordOf(sm.heart, 0.35, 0.65, ["slow", "steady", "fast"])); gg.pupil.set(sm.pupil, wordOf(sm.pupil, 0.35, 0.65, ["small", "midsize", "wide"]));
  gg.airway.set(sm.airway, wordOf(sm.airway, 0.35, 0.65, ["narrow", "normal", "wide"])); gg.gut.set(sm.gut, wordOf(sm.gut, 0.35, 0.65, ["slow", "steady", "active"]));
  gg.bladder.set(sm.bladder, wordOf(sm.bladder, 0.35, 0.65, ["held", "partly", "ready"])); gg.vessel.set(sm.vessel, wordOf(sm.vessel, 0.35, 0.65, ["relaxed", "steady", "tight"]));
  const ck = m.drug * 10 + level; if (ck !== capKey) { capKey = ck; const t = capText(m.drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
