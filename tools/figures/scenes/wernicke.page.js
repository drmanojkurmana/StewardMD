/* Wernicke Korsakoff scene: supply, enzyme gate with thiamine helper, brain injury, triad and memory. */
const layers = { cause: $("causeG"), gate: $("gateG"), inj: $("injG"), clin: $("clinG"), parts: $("parts"), over: $("over"), panel: $("panel") };
let brainO = null, capEl = null, capDrug = -1;
let carotid = [617, 268], paren = [673, 211];
let thiTargets = [[655, 205], [695, 223], [673, 253]];
let brainBox = [590, 790, 145, 305];
let trThi = null, trFuel = null, thiPipeEl = null, fuelEl = null;
let dripG = null, warnG = null, supG = null, cofG = null;
let halo1 = null, halo2 = null, halo3 = null, spot1 = null, spot2 = null, spot3 = null;
let enz1 = null, enz2 = null;
let confG = null, eyeG = null, gaitG = null, gaitInner = null, memG = null, iris = null, pupil = null, memX = null;
const drips = [];
function capText(d) {
  if (d === 1) return "Thiamine first. The helper docks and energy returns.";
  if (d === 2) return "Sugar alone. The last helper burns and injury grows.";
  if (d === 3) return "Supportive care only. The helper stays low.";
  return "No treatment. The gate stalls and injury spreads.";
}
/* ---- supply icons, drip rig and sugar ---- */
function initCause() {
  mk("rect", { class: "wk-bottle", x: 66, y: 118, width: 14, height: 18, rx: 3 }, layers.cause);
  mk("rect", { class: "wk-bottle", x: 56, y: 134, width: 34, height: 46, rx: 7 }, layers.cause);
  mk("rect", { class: "wk-bottle2", x: 61, y: 146, width: 24, height: 16, rx: 3 }, layers.cause);
  mk("ellipse", { class: "wk-plate", cx: 170, cy: 158, rx: 34, ry: 13 }, layers.cause);
  mk("ellipse", { class: "wk-plate2", cx: 170, cy: 156, rx: 20, ry: 7 }, layers.cause);
  mk("circle", { class: "wk-bottle2", cx: 162, cy: 154, r: 3 }, layers.cause);
  mk("circle", { class: "wk-bottle2", cx: 177, cy: 157, r: 2.4 }, layers.cause);
  dripG = mk("g", { opacity: "0" }, layers.cause);
  mk("rect", { class: "wk-bag", x: 56, y: 232, width: 58, height: 44, rx: 6 }, dripG);
  mk("rect", { class: "wk-fluid", x: 61, y: 250, width: 48, height: 20, rx: 3 }, dripG);
  mk("path", { class: "wk-line", d: "M85 276L85 320" }, dripG);
  for (let i = 0; i < 3; i++) drips.push({ e: mk("circle", { class: "wk-drop", r: 2.5 }, dripG), ph: i * 13 });
  mk("rect", { class: "wk-sugar", x: 158, y: 312, width: 20, height: 20, rx: 4 }, layers.cause);
  mk("rect", { class: "wk-sugar", x: 182, y: 318, width: 18, height: 18, rx: 4 }, layers.cause);
  supG = mk("g", { opacity: "0" }, layers.cause);
  [[200, 244], [220, 264], [196, 284]].forEach(function (q) {
    mk("path", { class: "wk-sup", d: "M-7 0L7 0M0-7L0 7", transform: "translate(" + q[0] + " " + q[1] + ")" }, supG);
  });
}
/* ---- enzyme gate, cofactor dots, fuel makers ---- */
function initGate() {
  mk("circle", { class: "wk-gluN", cx: 292, cy: 250, r: 14 }, layers.gate);
  mk("circle", { class: "wk-gluN", cx: 292, cy: 352, r: 12 }, layers.gate);
  mk("path", { class: "wk-arrow", d: "M308 250L332 250M308 352L334 352M386 250L412 250M386 352L408 352" }, layers.gate);
  enz1 = mk("g", {}, layers.gate); enz2 = mk("g", {}, layers.gate);
  mk("polygon", { class: "wk-enz", points: "0,-24 24,0 0,24 -24,0" }, enz1);
  mk("polygon", { class: "wk-enz", points: "0,-24 24,0 0,24 -24,0" }, enz2);
  place(enz1, 360, 250, 0, 1); place(enz2, 360, 352, 0, 1);
  cofG = mk("g", { opacity: "0" }, layers.gate);
  [[360, 224], [386, 250], [360, 326], [386, 352]].forEach(function (q) {
    mk("circle", { class: "wk-cof", cx: q[0], cy: q[1], r: 5 }, cofG);
  });
  mk("circle", { class: "wk-tca", cx: 436, cy: 250, r: 20 }, layers.gate);
  mk("path", { class: "wk-arrow", d: "M425 242A14 14 0 1 1 447 242" }, layers.gate);
  mk("rect", { class: "wk-box", x: 414, y: 335, width: 52, height: 34, rx: 8 }, layers.gate);
  mk("circle", { class: "wk-atp", cx: 500, cy: 250, r: 8 }, layers.gate);
  mk("path", { class: "wk-arrow", d: "M456 250L488 250" }, layers.gate);
  warnG = mk("g", { opacity: "0" }, layers.gate);
  mk("path", { class: "wk-x", d: "M340 230L380 270M380 230L340 270" }, warnG);
  mk("path", { class: "wk-x", d: "M342 334L378 370M378 334L342 370" }, warnG);
}
/* ---- real brain organ, injury halos and spots on it ---- */
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 690, 225, 215, {});
  const BP = brainO.ports;
  carotid = BP.carotid; paren = BP.parenchyma;
  fuelEl.setAttribute("d", "M508 250 C560 246 590 252 " + f1(carotid[0]) + " " + f1(carotid[1]));
  thiTargets = [[paren[0] - 18, paren[1] - 6], [paren[0] + 22, paren[1] + 12], [paren[0], paren[1] + 42]];
  brainBox = [Math.round(brainO.x - 100), Math.round(brainO.x + 95), Math.round(brainO.y - 80), Math.round(brainO.y + 75)];
  trThi = track([[85, 320], [170, 312], [250, 280], [330, 250]]);
  trFuel = track([[508, 250], [560, 248], carotid]);
  halo1 = mk("circle", { class: "wk-halo", cx: thiTargets[0][0], cy: thiTargets[0][1], r: 40 }, layers.inj);
  halo2 = mk("circle", { class: "wk-halo", cx: thiTargets[1][0], cy: thiTargets[1][1], r: 30 }, layers.inj);
  halo3 = mk("circle", { class: "wk-halo", cx: thiTargets[2][0], cy: thiTargets[2][1], r: 26 }, layers.inj);
  spot1 = mk("circle", { class: "wk-spot", cx: thiTargets[0][0], cy: thiTargets[0][1], r: 7 }, layers.inj);
  spot2 = mk("circle", { class: "wk-spot", cx: thiTargets[1][0], cy: thiTargets[1][1], r: 6 }, layers.inj);
  spot3 = mk("circle", { class: "wk-spot", cx: thiTargets[2][0], cy: thiTargets[2][1], r: 6 }, layers.inj);
}
/* ---- triad and memory icons ---- */
function initClin() {
  confG = mk("g", {}, layers.clin);
  mk("circle", { class: "wk-cloud", cx: 852, cy: 148, r: 12 }, confG);
  mk("circle", { class: "wk-cloud", cx: 868, cy: 140, r: 15 }, confG);
  mk("circle", { class: "wk-cloud", cx: 884, cy: 148, r: 12 }, confG);
  mk("ellipse", { class: "wk-cloud", cx: 868, cy: 152, rx: 24, ry: 9 }, confG);
  eyeG = mk("g", {}, layers.clin);
  mk("ellipse", { class: "wk-eyeW", cx: 868, cy: 222, rx: 24, ry: 13 }, eyeG);
  iris = mk("circle", { class: "wk-iris", cx: 868, cy: 222, r: 7 }, eyeG);
  pupil = mk("circle", { class: "wk-pupil", cx: 868, cy: 222, r: 3 }, eyeG);
  gaitG = mk("g", {}, layers.clin);
  gaitInner = mk("g", {}, gaitG);
  mk("circle", { class: "wk-head", cx: 862, cy: 262, r: 7 }, gaitInner);
  mk("path", { class: "wk-fig", d: "M862 269L866 288L856 306M866 288L878 300M862 277L848 288M862 277L880 282M842 312C856 306 872 314 892 309" }, gaitInner);
  memG = mk("g", {}, layers.clin);
  mk("rect", { class: "wk-book", x: 844, y: 340, width: 48, height: 32, rx: 4 }, memG);
  mk("rect", { class: "wk-book2", x: 866, y: 344, width: 22, height: 24, rx: 2 }, memG);
  mk("path", { class: "wk-fig", d: "M868 344L868 368" }, memG);
  memX = mk("g", { opacity: "0" }, memG);
  mk("path", { class: "wk-x", d: "M848 344L888 368M888 344L848 368" }, memX);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, tr: null }; }); }
const thiP = pool(18, function () { return mk("circle", { class: "sc-p p-thi", r: 2.7 }, layers.parts); });
const gluP = pool(20, function () { return mk("circle", { class: "sc-p p-gluP", r: 2.5 }, layers.parts); });
const atpP = pool(14, function () { return mk("circle", { class: "sc-p p-atp", r: 2.4 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["thi", "Thiamine", "g-thi", "Thiamine stores and supply. Alcohol use and poor meals drain them, and sugar use burns the active helper."], ["enz", "Enzymes", "g-enz", "Thiamine helper engines: one feeds the fuel cycle and one feeds the side path. Both stall without the helper."], ["atp", "Energy", "g-atp", "Energy made by brain cells. It falls when the helper engines stall."], ["dmg", "Injury", "g-dmg", "Injury to memory and gaze areas. It grows when lack lasts or sugar is given alone."], ["tri", "Triad", "g-tri", "The Wernicke triad: confusion, unsteady walk and weak eye movement. Often incomplete."], ["mem", "Memory", "g-mem", "Ability to form new memories. In Korsakoff this stays lost even when thiamine returns."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Low supply", 100, 150, 100, 62, "Alcohol use and poor meals drain the small thiamine store.");
  pill(ox, "Sugar in", 172, 322, 150, 398, "Sugar fuel entering the gate. Alone it burns the last helper.");
  pill(ox, "Gate needs helper", 360, 250, 400, 62, "Two engines that need thiamine to run. Without it the gate stalls.");
  pill(ox, "Energy out", 436, 250, 490, 398, "Fuel made by the cycle. The brain burns it fast.");
  pill(ox, "Brain", 700, 155, 700, 62, "The brain runs almost entirely on sugar, so it fails first.");
  pill(ox, "Injury spots", thiTargets[1][0], thiTargets[1][1], 640, 398, "Memory and gaze areas get injured when energy fails.");
  pill(ox, "Triad signs", 868, 222, 868, 108, "Confusion, weak eye movement and unsteady walk.");
  pill(ox, "Memory loss", 868, 356, 868, 398, "New memories fail to stick. Late damage stays.");
  capEl = mk("text", { class: "wk-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { Th: 0.4, En: 0.4, ATP: 0.4, Dmg: 0.4, Tri: 0.4, Mem: 0.6, thi: 0, glu: 0, sup: 0 };
const acc = { thi: 0, glu: 0, atp: 0 };
function init() {
  thiPipeEl = $("thiPipe"); fuelEl = $("fuelVessel");
  initCause(); initGate(); initOrgans(); initClin(); initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k1 = Math.min(1, dt * 1.1);
  sm.Th = lerp(sm.Th, m.Th, k); sm.En = lerp(sm.En, m.En, k); sm.ATP = lerp(sm.ATP, m.ATP, k); sm.Dmg = lerp(sm.Dmg, m.Dmg, k); sm.Tri = lerp(sm.Tri, m.Tri, k); sm.Mem = lerp(sm.Mem, m.Mem, k);
  sm.thi = lerp(sm.thi, m.thi, k1); sm.glu = lerp(sm.glu, m.glu, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  thiPipeEl.setAttribute("opacity", (0.3 + 0.6 * clamp(sm.Th + 0.4 * sm.thi)).toFixed(2));
  fuelEl.setAttribute("opacity", (0.3 + 0.6 * sm.ATP).toFixed(2));
  dripG.setAttribute("opacity", sm.thi.toFixed(2));
  drips.forEach(function (d) {
    const y = 280 + ((tm * 0.045 + d.ph) % 38);
    d.e.setAttribute("transform", "translate(85 " + f1(y) + ")");
    d.e.setAttribute("opacity", sm.thi.toFixed(2));
  });
  cofG.setAttribute("opacity", clamp(0.12 + 0.88 * sm.thi).toFixed(2));
  warnG.setAttribute("opacity", sm.glu.toFixed(2));
  supG.setAttribute("opacity", sm.sup.toFixed(2));
  place(enz1, 360, 250, 0, 0.7 + 0.3 * sm.En); place(enz2, 360, 352, 0, 0.7 + 0.3 * sm.En);
  const pulse = 1 + 0.08 * Math.sin(tm / 320);
  halo1.setAttribute("opacity", (sm.Dmg * 0.5).toFixed(2)); halo2.setAttribute("opacity", (sm.Dmg * 0.5).toFixed(2)); halo3.setAttribute("opacity", (sm.Dmg * 0.5).toFixed(2));
  halo1.setAttribute("r", f1(40 * pulse)); halo2.setAttribute("r", f1(30 * pulse)); halo3.setAttribute("r", f1(26 * pulse));
  spot1.style.opacity = sm.Dmg.toFixed(2); spot2.style.opacity = sm.Dmg.toFixed(2); spot3.style.opacity = sm.Dmg.toFixed(2);
  confG.style.opacity = (0.3 + 0.7 * sm.Tri).toFixed(2); eyeG.style.opacity = (0.3 + 0.7 * sm.Tri).toFixed(2);
  gaitG.style.opacity = (0.3 + 0.7 * sm.Tri).toFixed(2);
  memG.style.opacity = (0.35 + 0.65 * (1 - sm.Mem)).toFixed(2);
  memX.setAttribute("opacity", clamp(1 - sm.Mem).toFixed(2));
  const irisX = 868 + Math.sin(tm / 700) * 8 * (1 - sm.Tri * 0.85);
  iris.setAttribute("cx", f1(irisX)); pupil.setAttribute("cx", f1(irisX));
  gaitInner.setAttribute("transform", "rotate(" + f1(Math.sin(tm / 420) * 7 * sm.Tri) + " 866 288)");
  /* helper supply rides the pipe, docks at the gate, then runs on to the brain */
  acc.thi += dt * (0.6 + 7 * sm.Th + 6 * sm.thi);
  while (acc.thi >= 1) { acc.thi--; const p = freeP(thiP); if (p && trThi) { emit(p, 0, 0, 0, 0); p.tr = trThi; p.u = 0; } }
  thiP.forEach(function (p) {
    if (!p.on) return;
    if (p.tr) {
      p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u));
      p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (p.u >= 1) { p.tr = null; p.k = Math.floor(rnd(0, 3)); }
    } else {
      const tg = thiTargets[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.x = clamp(p.x, 300, 900); p.y = clamp(p.y, 90, 424);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (d < 14) kill(p);
    }
  });
  /* sugar queues at the gate when the engines stall */
  acc.glu += dt * (3 + 3 * sm.glu + 2 * sm.En);
  while (acc.glu >= 1) { acc.glu--; const p = freeP(gluP); if (p) emit(p, 200, Math.random() < 0.5 ? 250 : 352, rnd(26, 40), 0); }
  gluP.forEach(function (p) {
    if (!p.on) return; p.t += dt;
    const gate = 312, past = p.x > gate + 26;
    p.x += p.vx * dt * (past ? 0.4 + 0.6 * sm.En : 1);
    if (!past && sm.En < 0.45) p.x = Math.min(p.x, gate + rnd(0, 2));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1.2 - p.t / 2.4).toFixed(2));
    if (p.x > 420 || p.t > 2.8) kill(p);
  });
  /* fuel rides the vessel to the brain */
  acc.atp += dt * (1 + 8 * sm.ATP + 6 * sm.thi);
  while (acc.atp >= 1) { acc.atp--; const p = freeP(atpP); if (p && trFuel) { emit(p, 0, 0, 0, 0); p.tr = trFuel; p.u = 0; p.t = 0; } }
  atpP.forEach(function (p) {
    if (!p.on) return;
    if (p.tr) {
      p.u += dt * 110 / p.tr.len; const q = p.tr.at(Math.min(1, p.u));
      p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (p.u >= 1) { p.tr = null; p.t = 0; p.vx = rnd(-14, 14); p.vy = rnd(-10, 10); }
    } else {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.x = clamp(p.x, brainBox[0], brainBox[1]); p.y = clamp(p.y, brainBox[2], brainBox[3]);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2));
      if (p.t > 1.4) kill(p);
    }
  });
  gg.thi.set(sm.Th, wordOf(sm.Th, 0.35, 0.65, ["low", "reduced", "ok"])); gg.enz.set(sm.En, wordOf(sm.En, 0.35, 0.65, ["slow", "reduced", "working"])); gg.atp.set(sm.ATP, wordOf(sm.ATP, 0.35, 0.65, ["low", "reduced", "ok"]));
  gg.dmg.set(sm.Dmg, wordOf(sm.Dmg, 0.3, 0.6, ["little", "active", "severe"])); gg.tri.set(sm.Tri, wordOf(sm.Tri, 0.3, 0.6, ["absent", "partial", "full"])); gg.mem.set(sm.Mem, wordOf(sm.Mem, 0.35, 0.65, ["lost", "impaired", "preserved"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
