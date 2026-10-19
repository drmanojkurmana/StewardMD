/* PID scene: ascending infection through real uterus and liver anatomy.
 * Read bottom to top: vagina, cervix, uterus, tubes and ovaries, with the liver capsule top right.
 * Antibiotics park on the tubes and germs shrink, drainage empties the abscess into a bag,
 * partner treatment shields the partner and stops germs returning. */
const layers = { cells: $("cells"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
let uterO = null, liverO = null, UP = null;
let trkL = null, trkR = null, trkP = null;
let midL = [355, 190], midR = [505, 190], absC = [591, 221];
let cervH = null, uterH = null, tubeHL = null, tubeHR = null, ovH = null, livH = null;
let absG = null, adhEls = [], drainT = null, drainB = null, shieldEl = null;
let dockEls = [], capEl = null, capKey = "";
const neus = [];
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, hp: 1 }; }); }
const orgP = pool(34, function () { return mk("circle", { class: "sc-p p-org", r: 3.4 }, layers.parts); });
const org2P = pool(18, function () { return mk("path", { class: "sc-p p-org2", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts); });
const abxP = pool(12, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2 }, g); return g; });
const drP = pool(12, function () { return mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const ptP = pool(8, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
const reP = pool(8, function () { return mk("circle", { class: "sc-p p-org", r: 2.6 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.hp = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 3) return l === 2 ? "Combined treatment kills germs and drains the abscess. Swelling shrinks." : "Combined treatment kills germs and stops return. Tubes are spared.";
  if (d === 1) return l === 2 ? "Antibiotics kill germs but the abscess stays. It still needs drainage." : "Antibiotics kill the germs. Infection and swelling fade.";
  if (d === 2) return l === 2 ? "Drainage empties the abscess. The swelling shrinks." : "Drainage has little to drain yet. Infection stays.";
  if (l === 2) return "No treatment. Infection spreads and an abscess grows.";
  if (l === 1) return "No treatment. Infection climbs the tubes and scars them.";
  return "No treatment. Infection sits in the cervix and can climb.";
}
function initOrgans() {
  uterO = organ($("uterSlot"), "uterus", 430, 250, 330, {});
  liverO = organ($("liverSlot"), "liver", 842, 102, 120, {});
  UP = uterO.ports;
  midL = [(UP.fundus[0] + UP.ovL[0]) / 2, (UP.fundus[1] + UP.ovL[1]) / 2 - 4];
  midR = [(UP.fundus[0] + UP.ovR[0]) / 2, (UP.fundus[1] + UP.ovR[1]) / 2 - 4];
  absC = [UP.ovR[0] + 12, UP.ovR[1] + 4];
  trkL = track([[430, 418], UP.out, [430, 300], UP.fundus, midL, UP.ovL]);
  trkR = track([[430, 418], UP.out, [430, 300], UP.fundus, midR, UP.ovR]);
  trkP = track([[108, 372], [190, 392], [290, 404], [370, 412], [430, 418]]);
}
function initAnatomy() {
  const C = layers.cells;
  /* vagina canal and cervix ring below the uterus mouth */
  mk("rect", { class: "pid-vag", x: 408, y: 360, width: 44, height: 52, rx: 12 }, C);
  mk("ellipse", { class: "pid-cervix", cx: 430, cy: 359, rx: 30, ry: 14 }, C);
  /* violin string adhesions between liver capsule and diaphragm */
  [[790, 74, 796, 94], [830, 68, 834, 92], [870, 68, 868, 92], [905, 74, 898, 94]].forEach(function (q) {
    mk("path", { class: "pid-string", d: "M" + q[0] + " " + q[1] + " L" + q[2] + " " + q[3] }, C).setAttribute("id", "ls" + q[0]);
  });
  /* inflammation halos that fade with treatment */
  cervH = mk("ellipse", { class: "pid-halo", cx: UP.out[0], cy: UP.out[1], rx: 42, ry: 22, opacity: 0 }, C);
  uterH = mk("ellipse", { class: "pid-halo", cx: 430, cy: 265, rx: 64, ry: 95, opacity: 0 }, C);
  const dL = "M" + f1(UP.fundus[0]) + " " + f1(UP.fundus[1]) + " Q" + f1(midL[0]) + " " + f1(midL[1]) + " " + f1(UP.ovL[0]) + " " + f1(UP.ovL[1]);
  const dR = "M" + f1(UP.fundus[0]) + " " + f1(UP.fundus[1]) + " Q" + f1(midR[0]) + " " + f1(midR[1]) + " " + f1(UP.ovR[0]) + " " + f1(UP.ovR[1]);
  tubeHL = mk("path", { class: "pid-inflamT", d: dL, opacity: 0 }, C);
  tubeHR = mk("path", { class: "pid-inflamT", d: dR, opacity: 0 }, C);
  ovH = mk("ellipse", { class: "pid-halo", cx: f1(absC[0]), cy: f1(absC[1]), rx: 58, ry: 40, opacity: 0 }, C);
  livH = mk("ellipse", { class: "pid-halo", cx: f1(liverO.x), cy: f1(liverO.y), rx: 66, ry: 38, opacity: 0 }, C);
  /* tubo-ovarian abscess over the right ovary */
  absG = mk("g", {}, C);
  mk("ellipse", { class: "pid-abs", cx: 0, cy: 0, rx: 42, ry: 32 }, absG);
  mk("ellipse", { class: "pid-absIn", cx: -8, cy: -6, rx: 24, ry: 17 }, absG);
  mk("ellipse", { class: "pid-absIn", cx: 16, cy: 10, rx: 15, ry: 11 }, absG);
  /* pelvic adhesions anchored to the ovary and uterus ports */
  adhEls = [
    mk("path", { class: "pid-adh", d: "M" + f1(UP.ovL[0]) + " " + f1(UP.ovL[1] + 18) + " C330 260 370 290 405 305" }, C),
    mk("path", { class: "pid-adh", d: "M" + f1(UP.ovR[0] + 6) + " " + f1(UP.ovR[1] + 18) + " C640 260 680 290 705 320" }, C),
    mk("path", { class: "pid-adh", d: "M400 335 C360 355 330 360 305 362" }, C),
  ];
  /* drain tube from the abscess to a bag */
  drainT = mk("path", { class: "pid-drain", d: "M" + f1(absC[0] + 8) + " " + f1(absC[1] + 6) + " C700 250 780 270 868 296", opacity: 0 }, C);
  drainB = mk("rect", { class: "pid-bag", x: 852, y: 292, width: 46, height: 54, rx: 8, opacity: 0 }, C);
  /* partner figure with a shield that appears with partner treatment */
  const pg = mk("g", {}, C);
  mk("circle", { class: "pid-person", cx: 98, cy: 346, r: 13 }, pg);
  mk("path", { class: "pid-person", d: "M98 359 C82 366 76 382 78 398 L118 398 C120 382 114 366 98 359Z" }, pg);
  shieldEl = mk("circle", { class: "pid-shield", cx: 98, cy: 372, r: 30, opacity: 0 }, C);
  /* antibiotic docking spots on fundus and tubes */
  const docks = [[UP.fundus[0], UP.fundus[1] - 8], [midL[0], midL[1] - 12], [midR[0], midR[1] - 12], [UP.ovR[0], UP.ovR[1] - 14]];
  docks.forEach(function (q) {
    mk("path", { class: "pid-rec", d: "M" + f1(q[0] - 8) + " " + f1(q[1]) + " A8 8 0 0 1 " + f1(q[0] + 8) + " " + f1(q[1]) }, C);
    const g = mk("g", { opacity: 0 }, C);
    mk("rect", { class: "pid-dock", x: f1(q[0] - 7), y: f1(q[1] - 17), width: 14, height: 7, rx: 3.5 }, g);
    dockEls.push(g);
  });
  /* neutrophils that crawl from below toward the tubes */
  const targets = [[UP.ovL[0], UP.ovL[1] + 10], [midL[0], midL[1] + 12], [UP.fundus[0], UP.fundus[1] + 14], [midR[0], midR[1] + 12], [UP.ovR[0], UP.ovR[1] + 10]];
  targets.forEach(function (q, i) {
    neus.push({ g: cell(C, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 30, wob: 0.14 }), x: 430, y: 408, tx: q[0], ty: q[1], ph: i * 1.7 });
  });
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The person";
  [["inf", "Infection", "g-bac", "Chlamydia and gonorrhoea climbing from the cervix to the tubes. Antibiotics bring this down."], ["infl", "Inflammation", "g-inf2", "Inflamed cervix, womb lining, tubes and ovaries. This is what causes pain and fever and drives scarring."], ["abs", "Abscess", "g-abs2", "Tubo-ovarian abscess: pus walled off around tube and ovary. It may need drainage as well as antibiotics."], ["dam", "Tubal damage", "g-dam", "Scarring and adhesions narrow or block the tube. Damage already done does not fully reverse."], ["ect", "Ectopic risk", "g-ect", "A damaged tube raises the chance that a later pregnancy implants in the tube instead of the womb."], ["peri", "Liver capsule", "g-peri", "Fitz-Hugh-Curtis perihepatitis: infection reaching the liver capsule, with string like adhesions and pain high on the right side."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Ovary", UP.ovL[0], UP.ovL[1] - 14, 180, 100, "The healthy ovary. It releases eggs. Infection from the tube can reach it and form an abscess.");
  pill(ox, "Tube", midL[0], midL[1], 320, 100, "The fallopian tube. Infection climbs through it. Scarring and adhesions here block fertility.");
  pill(ox, "Uterus", UP.fundus[0], UP.fundus[1] + 6, 455, 100, "The uterus. Germs pass through its lining on the way from the cervix to the tubes.");
  pill(ox, "Abscess", absC[0], absC[1] - 26, 625, 100, "Tubo-ovarian abscess. Pus walled off around tube and ovary. It may need drainage.");
  pill(ox, "Liver capsule", liverO.x, liverO.y + 14, 845, 178, "Liver capsule. Infection can reach it and leave string like adhesions with pain high on the right side.");
  pill(ox, "Cervix", UP.out[0] + 16, UP.out[1], 565, 330, "The cervix. Chlamydia and gonorrhoea start here, often with no symptoms, then climb.");
  pill(ox, "Partner", 98, 360, 110, 300, "Partner. Treating partners and testing again stops the infection coming back.");
  pill(ox, "Vagina", 414, 392, 300, 410, "The vagina. The route by which sexually transmitted germs reach the cervix.");
  capEl = mk("text", { class: "pid-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { B: 0.4, I: 0.4, Abs: 0.1, D: 0.3, Ect: 0.3, Peri: 0.1, abx: 0, drain: 0, partner: 0, reach: 0.78 };
const acc = { org: 0, org2: 0, abx: 0, dr: 0, pt: 0, re: 0 };
function init() { initOrgans(); initAnatomy(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.B = lerp(sm.B, m.B, k); sm.I = lerp(sm.I, m.I, k); sm.Abs = lerp(sm.Abs, m.Abs, k); sm.D = lerp(sm.D, m.D, k); sm.Ect = lerp(sm.Ect, m.Ect, k); sm.Peri = lerp(sm.Peri, m.Peri, k);
  sm.abx = lerp(sm.abx, m.abx, k); sm.drain = lerp(sm.drain, m.drain, k); sm.partner = lerp(sm.partner, m.partner, k); sm.reach = lerp(sm.reach, m.reach, k);
  /* inflammation halos breathe and fade with treatment */
  cervH.setAttribute("opacity", (sm.I * 0.5).toFixed(2));
  uterH.setAttribute("opacity", (sm.I * (sm.reach > 0.35 ? 0.32 : 0.08)).toFixed(2));
  tubeHL.setAttribute("opacity", (sm.I * (sm.reach > 0.35 ? 0.5 : 0)).toFixed(2));
  tubeHR.setAttribute("opacity", (sm.I * (sm.reach > 0.35 ? 0.5 : 0)).toFixed(2));
  ovH.setAttribute("opacity", (sm.I * (sm.reach > 0.8 ? 0.42 : 0)).toFixed(2));
  livH.setAttribute("opacity", (sm.Peri * 0.45).toFixed(2));
  /* abscess over the right ovary shrinks with drainage and antibiotics */
  place(absG, absC[0], absC[1], 0, Math.max(0.12, 0.2 + 0.95 * sm.Abs));
  absG.setAttribute("opacity", sm.Abs > 0.03 ? "1" : "0");
  adhEls.forEach(function (e) { e.setAttribute("opacity", (sm.D * 0.95).toFixed(2)); });
  layers.cells.querySelectorAll(".pid-string").forEach(function (e) { e.setAttribute("opacity", sm.Peri.toFixed(2)); });
  drainT.setAttribute("opacity", sm.drain.toFixed(2)); drainB.setAttribute("opacity", sm.drain.toFixed(2));
  shieldEl.setAttribute("opacity", sm.partner.toFixed(2));
  /* antibiotics parked on their docking spots while treatment is on */
  dockEls.forEach(function (e) { e.setAttribute("opacity", sm.abx.toFixed(2)); });
  /* ascending organisms along the tracks; antibiotics shrink them */
  acc.org += dt * sm.B * 9; while (acc.org >= 1) { acc.org--; const p = freeP(orgP); if (p) emit(p, 430, 418, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  acc.org2 += dt * sm.B * 5; while (acc.org2 >= 1) { acc.org2--; const p = freeP(org2P); if (p) emit(p, 430, 418, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  [orgP, org2P].forEach(function (pl) { pl.forEach(function (p) {
    if (!p.on) return;
    p.hp -= dt * sm.abx * 1.1; if (p.hp <= 0) { kill(p); return; }
    p.u += dt * 0.14 * (0.4 + sm.B); if (p.u >= sm.reach) { kill(p); return; }
    const pt = (p.k ? trkR : trkL).at(p.u);
    p.x = pt.x + Math.sin(tm / 300 + p.k * 4 + p.u * 20) * 3; p.y = pt.y;
    place(p.e, p.x, p.y, tm / 6, 0.35 + 0.65 * p.hp);
  }); });
  /* germs returning from an untreated partner */
  acc.re += dt * (1 - sm.partner) * sm.B * 2.2; while (acc.re >= 1) { acc.re--; const p = freeP(reP); if (p) emit(p, 108, 372, 0, 0, 0); }
  reP.forEach(function (p) { if (!p.on) return; p.u += dt * 0.12; if (p.u >= 1) { kill(p); return; } const q = trkP.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* neutrophils crawl from below toward the tubes */
  neus.forEach(function (n, i) {
    const act = sm.I > 0.18 && i < Math.round(sm.I * neus.length);
    n.x = lerp(n.x, act ? n.tx : 430 + (i - 2) * 22, Math.min(1, dt * 0.35));
    n.y = lerp(n.y, act ? n.ty + Math.sin(tm / 500 + n.ph) * 6 : 408, Math.min(1, dt * 0.35));
    n.g.style.opacity = act || sm.I > 0.1 ? 1 : 0.25; place(n.g, n.x, n.y, Math.sin(tm / 400 + n.ph) * 10, 1);
  });
  /* antibiotics drift in from the left toward the womb and tubes */
  acc.abx += dt * sm.abx * 3; while (acc.abx >= 1) { acc.abx--; const p = freeP(abxP); if (p) emit(p, 40, rnd(230, 330), 0, 0, 0); }
  abxP.forEach(function (p) { if (!p.on) return; p.t += dt; const dx = 430 - p.x, dy = 260 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 78 * dt; p.y += (dy / d) * 78 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); if (d < 20 || p.t > 6) kill(p); });
  /* drainage drops leave the abscess for the bag */
  acc.dr += dt * sm.drain * sm.Abs * 7 + dt * sm.drain * 1.2; while (acc.dr >= 1) { acc.dr--; const p = freeP(drP); if (p) emit(p, absC[0], absC[1], 0, 0, 0); }
  drP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = lerp(p.x, 872, Math.min(1, dt * 1.1)); p.y = lerp(p.y, 304, Math.min(1, dt * 1.1)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  /* partner treatment pills reach the partner figure */
  acc.pt += dt * sm.partner * 2.4; while (acc.pt >= 1) { acc.pt--; const p = freeP(ptP); if (p) emit(p, 430, 410, 0, 0, 0); }
  ptP.forEach(function (p) { if (!p.on) return; p.t += dt; const dx = 108 - p.x, dy = 372 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 82 * dt; p.y += (dy / d) * 82 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (d < 16 || p.t > 6) kill(p); });
  gg.inf.set(sm.B, wordOf(sm.B, 0.2, 0.5, ["controlled", "present", "spreading"])); gg.infl.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["mild", "moderate", "marked"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.18, 0.45, ["none", "forming", "large"]));
  gg.dam.set(sm.D, wordOf(sm.D, 0.28, 0.55, ["little", "some", "marked"])); gg.ect.set(sm.Ect, wordOf(sm.Ect, 0.28, 0.55, ["low", "raised", "high"])); gg.peri.set(sm.Peri, wordOf(sm.Peri, 0.25, 0.5, ["none", "mild", "marked"]));
  const ck = drug + ":" + level;
  if (ck !== capKey) { capKey = ck; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
