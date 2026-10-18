/* ACS scene: plaque and clot in the artery, the heart downstream, a live ECG, and the gauges. */
const AX0 = 24, AX1 = 566, TOP = 120, BOT = 230, CX = 315, PW = 100;      /* artery frame: lumen between TOP and BOT */
const HX = 765, HY = 230, HW = 200;                                       /* organ heart: centre and width */
const E = SC.ECG, EBASE = E.y + 70, ESPEED = 110;
const L = { art: $("art"), slot: $("heartSlot"), heart: $("heart"), ecg: $("ecg"), over: $("over"), panel: $("panel") };
const bump = (x, h) => (Math.abs(x - CX) < PW ? h * (0.5 + 0.5 * Math.cos(Math.PI * (x - CX) / PW)) : 0);
const sm = { Occ: 0.4, I: 0.3, N: 0, P: 1, T: 0, Cp: 0.2, st: 0, qw: 0, antiplt: 0, anticoag: 0, reperf: 0, prev: 0 };
let art = {}, rbcs = [], plts = [], foam = [], fibs = [], trapped = [], plas, spill, apDrug, acDrug, statD, trop, coro, marks = {}, heart = {}, gg = {}, ecgPath, ecgTxt;
let heartO = null, ladTr = null, ladD = "", TC = [743, 296], BLK = [763, 244], capEl = null, capKey = "";
const xmark = (parent, x, y, id) => { const g = mk("g", { id, opacity: "0" }, parent); mk("circle", { class: "ac-xc", cx: x, cy: y, r: 8 }, g); mk("path", { class: "ac-xp", d: "M" + (x - 4) + " " + (y - 4) + "L" + (x + 4) + " " + (y + 4) + "M" + (x + 4) + " " + (y - 4) + "L" + (x - 4) + " " + (y + 4) }, g); return g; };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 1) return "Antiplatelet drugs switch the platelets off. The clot stays smaller and blood keeps flowing.";
  if (d === 2) return "Heparin blocks the fibrin threads. Less mesh forms and the clot stays smaller.";
  if (d === 3) return "Reperfusion opens the artery with a stent. Blood returns and the muscle recovers.";
  if (d === 4) return "Statin, beta blocker and ACE inhibitor shrink the fatty core and slow the heart.";
  if (d === 5) return "The full bundle reopens the artery and protects the muscle. Flow returns and injury fades.";
  return l >= 2 ? "No treatment. The clot blocks the artery and heart muscle dies." : "No treatment. The clot narrows the artery and the muscle is starved.";
}

function init() {
  /* ---- artery: lumen, walls, plaque, clot, stent ---- */
  art.lum = mk("rect", { class: "ac-lum", x: AX0, y: TOP, width: AX1 - AX0, height: BOT - TOP }, L.art);
  const rg = mk("g", {}, L.art); for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(AX0, AX1), y: rnd(0.05, 0.95), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  art.mound = mk("path", { class: "ac-thromb" }, L.art);
  art.wallT = mk("rect", { class: "ac-wall", x: AX0, y: 70, width: AX1 - AX0, height: TOP - 70 }, L.art);
  art.intT = mk("path", { class: "ac-intima", d: "M" + AX0 + " " + TOP + "H" + AX1 }, L.art);
  art.wallB = mk("path", { class: "ac-wall" }, L.art);
  art.plaque = mk("path", { class: "ac-plaque" }, L.art);
  art.core = mk("ellipse", { class: "ac-core", cx: CX, cy: BOT + 12, rx: 62, ry: 15 }, L.art);
  const fg = mk("g", {}, L.art);
  [[-44, 8], [-28, 16], [-12, 6], [6, 15], [22, 7], [38, 14], [50, 9]].forEach(([u, v], i) => { const g = cell(fg, { cls: "foam", r: 6.5, nuc: 0.28, seed: i + 3, wob: 0.08, n: 8 }); mk("circle", { class: "ac-vac", cx: -2, cy: -1, r: 2.2 }, g); foam.push({ g, u, v }); });
  art.capL = mk("path", { class: "ac-cap" }, L.art); art.capR = mk("path", { class: "ac-cap" }, L.art);
  art.intB = mk("path", { class: "ac-intima" }, L.art);
  const fb = mk("g", {}, L.art); for (let i = 0; i < 16; i++) fibs.push({ e: mk("path", { class: "ac-fib" }, fb), u: rnd(-1, 1), v: rnd(0.05, 0.9), u2: rnd(-1, 1), v2: rnd(0.05, 0.9) });
  const pg = mk("g", {}, L.art); for (let i = 0; i < 40; i++) plts.push({ g: cell(pg, { cls: "plt", r: 5 + (i % 3) * 0.6, seed: i, wob: 0.16, n: 7 }), u: rnd(-1, 1), v: Math.pow(Math.random(), 0.8), i });
  const tg = mk("g", {}, L.art); for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, tg); mk("ellipse", { class: "cl-b", rx: 4.6, ry: 2.8 }, g); trapped.push({ g, u: rnd(-0.8, 0.8), v: rnd(0.15, 0.7), rot: rnd(0, 180) }); }
  art.stent = mk("g", { opacity: "0" }, L.art); art.stentA = mk("path", { class: "ac-stent" }, art.stent); art.stentB = mk("path", { class: "ac-stent" }, art.stent);
  let za = "", zb = ""; for (let i = 0; i <= 24; i++) { const x = CX - 96 + i * 8; za += (i ? "L" : "M") + x + " " + (TOP + 5 + (i % 2) * 7); zb += (i ? "L" : "M") + x + " " + (BOT - 12 + (i % 2) * 7); }
  art.stentA.setAttribute("d", za); art.stentB.setAttribute("d", zb);
  plas = pool(10, () => mk("circle", { class: "sc-p p-plas", r: 2.2 }, L.art));
  spill = pool(14, () => mk("rect", { class: "sc-p p-spill", x: -2, y: -2, width: 4, height: 4, rx: 1 }, L.art));
  apDrug = pool(12, () => mk("circle", { class: "sc-p p-apdrug", r: 2.6 }, L.art));
  acDrug = pool(10, () => mk("circle", { class: "sc-p p-acdrug", r: 2.6 }, L.art));
  statD = pool(8, () => mk("circle", { class: "sc-p p-stat", r: 2.4 }, L.art));
  marks.ap = xmark(L.art, 268, 178, "x-ap"); marks.ac = xmark(L.art, 366, 176, "x-ac");
  /* ---- heart: the shared organ, with one surface artery, its blocked point and the muscle at risk ---- */
  heartO = organ(L.slot, "heart", HX, HY, HW, {});
  const apex = heartO.ports.apex;
  TC = [apex[0] + 18, apex[1] - 34];
  const pts = [[HX + 14, HY - 46], [HX + 6, HY - 6], [HX - 8, HY + 34], [apex[0], apex[1]]];
  ladTr = track(pts);
  ladD = pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("");
  heart.lad = mk("path", { class: "ac-lad", d: ladD }, L.heart);
  heart.ladHi = mk("path", { class: "ac-lad2", d: ladD }, L.heart);
  heart.isch = mk("ellipse", { class: "ac-isch", cx: f1(TC[0]), cy: f1(TC[1]), rx: 46, ry: 34, opacity: "0" }, L.heart);
  heart.inf = mk("ellipse", { class: "ac-inf", cx: f1(TC[0]), cy: f1(TC[1]), rx: 40, ry: 28, opacity: "0" }, L.heart);
  const bq = ladTr.at(0.40); BLK = [bq.x, bq.y];
  heart.blk = mk("g", { opacity: "0" }, L.heart);
  mk("circle", { class: "ac-blk", cx: f1(BLK[0]), cy: f1(BLK[1]), r: 7 }, heart.blk);
  mk("path", { class: "ac-xp", d: "M" + f1(BLK[0] - 3.5) + " " + f1(BLK[1] - 3.5) + "l7 7M" + f1(BLK[0] + 3.5) + " " + f1(BLK[1] - 3.5) + "l-7 7" }, heart.blk);
  mk("path", { class: "dr-beam", d: "M" + AX1 + " 176C600 176 620 182 " + f1(HX - 100) + " " + f1(HY - 30) }, L.heart);
  coro = pool(10, () => mk("circle", { class: "sc-p", r: 2.2, style: "--cc:var(--c-rbc)" }, L.heart)); coro.forEach((p, i) => { p.k = i / 10; });
  trop = pool(16, () => mk("circle", { class: "sc-p p-trop", r: 2.6 }, L.heart));
  /* ---- ECG ---- */
  ecgPath = mk("path", { class: "ac-trace" }, L.ecg); ecgTxt = mk("text", { class: "sc-zone", x: E.x + E.w - 10, y: E.y + 18, "text-anchor": "end" }, L.ecg);
  const eh = mk("g", { class: "hot", tabindex: "0", "data-info": "One ECG lead. A partly blocked artery usually gives ST depression; a completely blocked one gives ST elevation; Q waves appear later when muscle has died. Reperfusion brings the ST segment back to the baseline." }, L.ecg);
  mk("rect", { x: E.x, y: E.y, width: E.w, height: E.h, fill: "transparent" }, eh);
  /* ---- labels and gauges ---- */
  const o = L.over;
  pill(o, "Fibrous cap", 262, 214, 232, 90, "The thin fibrous cap over a fatty plaque. When it cracks, the blood meets the material inside and clots.");
  pill(o, "Platelet plug", 300, 200, 350, 90, "Platelets stick to the exposed plaque, switch on and clump together. Antiplatelet drugs act here.");
  pill(o, "Fibrin", 340, 190, 452, 90, "The clotting cascade makes fibrin threads that bind the platelets into a firm clot. Heparin acts on this step.");
  pill(o, "Blood flow", 70, 150, 100, 90, "Red cells carry oxygen. As the clot grows the flow slows and then stops.");
  pill(o, "Foam cells", 288, 246, 140, 298, "Macrophages stuffed with oxidised cholesterol. They build the plaque core. Statins slow this process.");
  pill(o, "Lipid core", 345, 245, 262, 298, "The soft fatty centre of the plaque. A large core under a thin cap makes a plaque unstable.");
  pill(o, "Coronary artery", HX + 14, HY - 46, 640, 92, "One coronary artery runs on the surface of the heart and feeds a territory of muscle. Block it and that territory starves.");
  pill(o, "Muscle at risk", TC[0], TC[1], 874, 182, "The territory of muscle fed by the blocked artery. It turns from healthy to ischaemic to dead (infarcted).");
  pill(o, "Troponin", TC[0] + 32, TC[1] + 14, 880, 330, "Troponin is released from dying heart muscle cells. It is the blood test that shows muscle injury.");
  pill(o, "Heart", HX + 40, HY + 10, HX, 410, "The heart pumps blood to the body. The marked surface artery feeds the shaded territory.");
  const dr = pill(o, "Antiplatelet", 268, 178, 118, 172, "Antiplatelet drugs (aspirin, a P2Y12 inhibitor) stop platelets clumping, so the clot stays smaller."); dr.setAttribute("id", "p-ap"); dr.style.opacity = 0;
  const da = pill(o, "Anticoagulant", 366, 176, 500, 172, "An anticoagulant (heparin) blocks thrombin and factor Xa, so less fibrin forms."); da.setAttribute("id", "p-ac"); da.style.opacity = 0;
  const dp = pill(o, "Reperfusion", CX, 125, 300, 140, "Reperfusion: a balloon and stent (PCI) or a clot-dissolving drug (thrombolysis) reopens the vessel and brings blood back."); dp.setAttribute("id", "p-pci"); dp.style.opacity = 0;
  const dv = pill(o, "Prevention", HX + 55, HY + 70, 884, 395, "A statin, a beta-blocker and an ACE inhibitor: the core and plaque shrink, the heart works less hard, and the muscle remodels less."); dv.setAttribute("id", "p-prev"); dv.style.opacity = 0;
  capEl = mk("text", { class: "ac-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["fl", "Blood flow", "g-fl", "How much blood still gets through the artery."], ["clot", "Clot", "g-clot", "Size of the clot sitting on the ruptured plaque."], ["inj", "Muscle injury", "g-bad", "How much heart muscle is starved (ischaemic) or dead (infarcted)."], ["pump", "Pump", "g-good", "How well the left ventricle squeezes."], ["tr", "Troponin", "g-cyt", "Troponin in the blood: a marker of muscle cell death."], ["cp", "Chest pain", "g-pain", "Pain from muscle that is short of oxygen."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}

function artery(dt, m) {
  const hb = 27 * (1 - 0.75 * sm.reperf), Hh = Math.max(0, sm.Occ * (BOT - TOP) - hb), R = clamp((sm.Occ - 0.3) * 1.6);
  const Wh = 82, prof = (x) => { const u = (x - CX) / (Wh * 2); return Math.abs(u) < 0.5 ? Math.pow(Math.cos(Math.PI * u), 0.8) : 0; };
  const surf = (x) => BOT - bump(x, hb);
  let wb = "M" + AX0 + " " + (BOT + 60) + "L" + AX0 + " " + BOT; for (let x = AX0; x <= AX1; x += 6) wb += "L" + x + " " + f1(surf(x)); wb += "L" + AX1 + " " + (BOT + 60) + "Z";
  art.wallB.setAttribute("d", wb);
  let ib = ""; for (let x = AX0; x <= AX1; x += 6) ib += (x === AX0 ? "M" : "L") + x + " " + f1(surf(x)); art.intB.setAttribute("d", ib);
  /* plaque lens and its fatty core, shrunk by prevention */
  let pq = "M" + (CX - PW - 8) + " " + BOT; for (let x = CX - PW - 8; x <= CX + PW + 8; x += 6) pq += "L" + x + " " + f1(surf(x)); pq += "L" + (CX + PW + 8) + " " + BOT + "Q" + CX + " " + (BOT + 56) + " " + (CX - PW - 8) + " " + BOT + "Z"; art.plaque.setAttribute("d", pq);
  const cs = 1 - 0.5 * sm.prev; art.core.setAttribute("rx", f1(60 * cs)); art.core.setAttribute("ry", f1(15 * cs)); art.core.setAttribute("cy", f1(BOT + 12 - 3 * R)); art.core.setAttribute("opacity", (1 - 0.35 * R).toFixed(2));
  foam.forEach((f, i) => { const on = i < 7 - Math.round(3 * sm.prev); place(f.g, CX + f.u * cs, BOT + 4 + f.v * cs * 0.9 - 3 * R, 0, on ? 1 : 0.0); });
  /* the cap: whole when sound, split when it ruptures */
  const g = R > 0.04 ? 5 + R * 30 : 0, cp = (xa, xb) => { let d = "", first = true; for (let x = xa; x <= xb; x += 5) { d += (first ? "M" : "L") + x + " " + f1(surf(x) - 0.5); first = false; } return d; };
  if (g === 0) { art.capL.setAttribute("d", cp(CX - PW, CX + PW)); art.capR.setAttribute("d", ""); } else { art.capL.setAttribute("d", cp(CX - PW, CX - g)); art.capR.setAttribute("d", cp(CX + g, CX + PW)); }
  /* clot: a mound on the broken cap; antiplatelet drugs keep the platelet pile low */
  const apS = 1 - 0.55 * sm.antiplt;
  let md = "M" + (CX - Wh * 2) + " " + f1(surf(CX - Wh * 2)); for (let x = CX - Wh * 2; x <= CX + Wh * 2; x += 6) md += "L" + x + " " + f1(surf(x) - Hh * prof(x)); md += "L" + (CX + Wh * 2) + " " + f1(surf(CX + Wh * 2)) + "Z"; art.mound.setAttribute("d", md);
  art.mound.setAttribute("opacity", clamp(Hh / 8).toFixed(2));
  plts.forEach((p) => { const x = CX + p.u * Wh * 1.5 * (1 - 0.3 * p.v), pr = prof(x), top = Hh * pr; const s = clamp(Hh / 14) * clamp(pr * 3) * apS; place(p.g, x, surf(x) - p.v * top * 0.92 - 2, 0, s * (0.85 + 0.15 * Math.sin(tm / 400 + p.i))); });
  fibs.forEach((f) => { const x1 = CX + f.u * Wh * 1.4, x2 = CX + f.u2 * Wh * 1.4, y1 = surf(x1) - f.v * Hh * prof(x1), y2 = surf(x2) - f.v2 * Hh * prof(x2); f.e.setAttribute("d", "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2)); f.e.setAttribute("opacity", (clamp(Hh / 40) * (1 - 0.8 * sm.anticoag)).toFixed(2)); });
  trapped.forEach((t) => { const x = CX + t.u * Wh * 1.2, top = Hh * prof(x); place(t.g, x, surf(x) - t.v * top, t.rot, clamp(Hh / 30)); });
  art.stent.setAttribute("opacity", sm.reperf.toFixed(2));
  /* red cells flow, squeeze past the clot, or queue behind it */
  const blocked = (BOT - TOP - (hb + Hh)) < 12, vf = 55 * clamp(1 - sm.Occ * 0.92, 0.0, 1);
  rbcs.forEach((r) => {
    const gapTop = TOP + 8, mx = surf(r.x) - Hh * prof(r.x), gapBot = mx - 7;
    if (blocked && r.x > CX - 112 && r.x < CX - 60) { r.x = CX - 112 + Math.random() * 0.1; }
    else { r.x += r.v * vf * dt * (r.x > CX - 90 && r.x < CX + 90 ? 1.4 : 1); }
    if (r.x > AX1 + 10) { r.x = AX0 - 10; r.y = rnd(0.05, 0.95); }
    let y = gapTop + r.y * (BOT - 8 - gapTop); if (y > gapBot) y = Math.max(gapTop, gapBot);
    place(r.g, r.x, y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1);
    r.g.style.opacity = (blocked && r.x > CX + 60 ? 0.0 : 1);
  });
  /* drug particles show each mechanism: blockers sit on the clot, statin sinks into the core */
  const moundTop = (x) => surf(x) - Hh * prof(x) - 5;
  if (sm.antiplt > 0.5 && Math.random() < dt * 9) { const p = free(apDrug); if (p) emit(p, CX + rnd(-70, 70), TOP + 16, rnd(-6, 6), rnd(28, 40), 0); }
  apDrug.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y >= moundTop(p.x)) { p.st = 1; p.t = 0; } place(p.e, p.x, p.y, 0, 1); }
    else { place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) kill(p); } });
  if (sm.anticoag > 0.5 && Math.random() < dt * 8) { const p = free(acDrug); if (p) emit(p, CX + rnd(-70, 70), TOP + 16, rnd(-6, 6), rnd(28, 40), 0); }
  acDrug.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y >= moundTop(p.x)) { p.st = 1; p.t = 0; } place(p.e, p.x, p.y, 0, 1); }
    else { place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) kill(p); } });
  if (sm.prev > 0.5 && Math.random() < dt * 4) { const p = free(statD); if (p) emit(p, CX + rnd(-55, 55), BOT - 55, rnd(-4, 4), rnd(22, 32), 0); }
  statD.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - (BOT - 10)) / 22).toFixed(2)); if (p.y > BOT + 12) kill(p); });
  /* plasmin dots dissolving the clot, lipid spilling from the rupture */
  if (sm.reperf > 0.5 && Math.random() < dt * 6) { const p = free(plas); if (p) emit(p, CX + rnd(-70, 70), TOP + rnd(14, 40), rnd(-6, 6), rnd(14, 24), 0); }
  plas.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6 || p.y > surf(p.x) - 2) kill(p); });
  if (R > 0.1 && Math.random() < dt * R * 5) { const p = free(spill); if (p) emit(p, CX + rnd(-g, g), surf(CX) - 2, rnd(8, 26), -rnd(10, 22), 0); }
  spill.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  marks.ap.setAttribute("opacity", sm.antiplt.toFixed(2)); marks.ac.setAttribute("opacity", sm.anticoag.toFixed(2));
  $("p-ap").style.opacity = sm.antiplt.toFixed(2); $("p-ac").style.opacity = sm.anticoag.toFixed(2); $("p-pci").style.opacity = sm.reperf.toFixed(2); $("p-prev").style.opacity = sm.prev.toFixed(2);
}

function heartStep(dt, m) {
  const T = 1.0 + 0.5 * sm.prev, ph = ((tm / 1000) / T) % 1, c = ph < 0.4 ? Math.sin(Math.PI * ph / 0.4) : 0;
  const amp = sm.P * (1 - 0.35 * sm.prev);
  place(heartO.g, HX, HY - 1.5 * c * amp, 0, 1 + 0.02 * c * amp);
  const frac = lerp(0.45, 1, clamp((sm.Occ - 0.5) * 4));
  heart.isch.setAttribute("opacity", clamp(sm.I * 0.85).toFixed(2));
  heart.inf.setAttribute("rx", f1(40 * frac)); heart.inf.setAttribute("ry", f1(28 * frac));
  heart.inf.setAttribute("opacity", clamp(sm.N * 1.1).toFixed(2));
  heart.blk.setAttribute("opacity", clamp((sm.Occ - 0.3) * 3).toFixed(2));
  const sf = clamp(1 - sm.Occ * 0.95);
  coro.forEach((p) => { p.k = (p.k + dt * 0.22 * (0.15 + 0.85 * sf)) % 1; const q = ladTr.at(p.k), cut = sm.Occ > 0.55 && p.k > 0.40; p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (cut || sf < 0.04 ? 0 : 1)); });
  if (sm.N > 0.08 && Math.random() < dt * sm.N * 7) { const p = free(trop), a = rnd(0, 6.28), r = rnd(4, 26); if (p) emit(p, TC[0] + Math.cos(a) * r, TC[1] + Math.sin(a) * r, rnd(2, 16), rnd(-12, 2), 0); }
  trop.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.2).toFixed(2)); if (p.t > 3.2) kill(p); });
}

function ecgAt(t, T) {
  const p = ((t / T) % 1 + 1) % 1, st = sm.st, qd = sm.qw, ss = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  let v = 0;
  if (p > 0.06 && p < 0.16) v += 0.12 * Math.sin(Math.PI * (p - 0.06) / 0.10);
  if (p > 0.20 && p < 0.225) v -= (0.12 + 0.55 * qd) * Math.sin(Math.PI * (p - 0.20) / 0.025);
  if (p > 0.225 && p < 0.265) v += (1 - 0.35 * qd) * Math.sin(Math.PI * (p - 0.225) / 0.04);
  if (p > 0.265 && p < 0.29) v -= 0.22 * Math.sin(Math.PI * (p - 0.265) / 0.025);
  v += st * 0.4 * ss(0.29, 0.31, p) * (1 - ss(0.43, 0.46, p));
  if (p > 0.44 && p < 0.68) { const amp = 0.3 + 0.3 * Math.max(st, 0) + (st < 0 ? 0.5 * st : 0); v += amp * Math.sin(Math.PI * (p - 0.44) / 0.24); }
  return v;
}
function ecgStep() {
  const T = 1.0 + 0.5 * sm.prev; let d = "";
  for (let x = E.x; x <= E.x + E.w; x += 3) { const age = (E.x + E.w - x) / ESPEED, v = ecgAt(tm / 1000 - age, T), y = clamp(EBASE - 42 * v, E.y + 4, E.y + E.h - 4); d += (x === E.x ? "M" : "L") + x + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  const w = sm.st > 0.3 ? "ST elevation" : sm.st < -0.1 ? "ST depression" : "normal"; if (ecgTxt.textContent !== w) ecgTxt.textContent = w;
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.6);
  ["Occ", "st", "antiplt", "anticoag", "reperf", "prev"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["I", "N", "P", "T", "Cp", "qw"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  artery(dt, m); heartStep(dt, m); ecgStep();
  gg.fl.set(1 - sm.Occ, wordOf(1 - sm.Occ, 0.3, 0.7, ["blocked", "reduced", "open"]));
  gg.clot.set(clamp(sm.Occ * 1.1 - 0.15), wordOf(sm.Occ, 0.3, 0.7, ["none", "some", "large"]));
  gg.inj.set(clamp(Math.max(sm.I * 0.7, sm.N)), wordOf(Math.max(sm.I * 0.7, sm.N), 0.2, 0.5, ["none", "ischaemic", "infarcted"]));
  gg.pump.set(sm.P, wordOf(sm.P, 0.45, 0.75, ["poor", "reduced", "normal"]));
  gg.tr.set(sm.T, wordOf(sm.T, 0.15, 0.5, ["normal", "rising", "high"]));
  gg.cp.set(sm.Cp, wordOf(sm.Cp, 0.2, 0.55, ["none", "angina", "severe"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
