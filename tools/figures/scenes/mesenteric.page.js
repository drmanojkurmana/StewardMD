/* Mesenteric scene: SMA flow into real bowel, clot, magnified wall slice, leak, and gauges. */
const WW = SC.W;
const layers = { bowel: $("bowelSlot"), art: $("artery"), branch: $("branch"), tint: $("tint"), flow: $("flow"), clot: $("clot"), stent: $("stent"), parts: $("parts"), perf: $("perf"), over: $("over"), panel: $("panel"), mucD: $("mucDark"), wallD: $("wallDark"), resect: $("resectMark") };
let bowelO = null, artery = null;
const CLOT = [390, 148];
/* clot blocking the artery */
const clotG = mk("g", {}, layers.clot);
mk("circle", { class: "mes-clot", r: 16, cx: 0, cy: 0 }, clotG);
mk("circle", { class: "mes-clot", r: 11, cx: 13, cy: 4 }, clotG);
mk("circle", { class: "mes-clot", r: 10, cx: -12, cy: 5 }, clotG);
place(clotG, CLOT[0], CLOT[1], 0, 0.2);
/* stent mesh that holds the artery open with revascularisation */
const stentG = mk("g", { opacity: "0" }, layers.stent);
mk("path", { class: "mes-stent", d: "M346 134L434 134M346 162L434 162M346 148L434 148M358 134L358 162M372 134L372 162M386 134L386 162M400 134L400 162M414 134L414 162M428 134L428 162M346 134L434 162M346 162L434 134" }, stentG);
/* resection marks over the dead right hand segment, with the removed piece shaded */
const resectG = mk("g", { opacity: "0" }, layers.resect);
mk("rect", { class: "mes-dark", x: 628, y: 304, width: 128, height: 104, rx: 30, opacity: "0.55" }, resectG);
mk("rect", { class: "mes-resect", x: 620, y: 296, width: 144, height: 128, rx: 36 }, resectG);
mk("path", { class: "mes-resect", d: "M632 308L752 404M752 308L632 404" }, resectG);
mk("path", { class: "mes-staple", d: "M628 302L628 418M756 302L756 418" }, resectG);
/* leak jag at the base of the magnified wall */
const perfG = mk("g", { opacity: "0" }, layers.perf);
mk("path", { class: "mes-perf", d: "M656 406L666 418L676 406L686 418L696 406L690 422L662 422Z" }, perfG);
function initOrgans() {
  bowelO = organ(layers.bowel, "intestine", 665, 180, 250, {});
  const pin = bowelO.ports.in, pco = bowelO.ports.colon;
  layers.art.setAttribute("d", "M100 148C300 148 480 146 560 144C610 143 650 146 " + f1(pin[0]) + " " + f1(pin[1]));
  layers.branch.setAttribute("d", "M598 144C604 165 608 185 " + f1(pco[0]) + " " + f1(pco[1]));
  artery = track([[78, 104], [78, 148], [160, 148], [300, 148], [470, 147], [600, 144], pin]);
}
/* red cells flowing from the aorta along the artery into the bowel */
const rbcs = [];
function initFlow() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, u: i / 18, v: rnd(0.8, 1.2), rot: rnd(-16, 16) }); } }
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, a: 0 }; }); }
const lac = pool(26, () => mk("circle", { class: "sc-p p-lac", r: 2.6 }, layers.parts));
const spill = pool(24, () => mk("circle", { class: "sc-p p-spill", r: 2.8 }, layers.parts));
const blockers = pool(14, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const drip = pool(8, () => mk("circle", { class: "sc-p p-drip", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d) {
  if (d === 1) return "Revascularisation opens the artery. Flow floods back.";
  if (d === 2) return "Fluids and blood thinner. The clot stops spreading.";
  if (d === 3) return "Dead bowel is cut out. The leak is sealed.";
  return "No treatment. The clot starves the bowel.";
}
const gg = {};
let capEl = null, capDrug = -1;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["flow", "Flow", "g-good", "Blood flow in the superior mesenteric artery to the bowel."], ["muc", "Mucosa", "g-bad", "Injury to the mucosa, the inner lining. It is the most sensitive layer and is hurt first."], ["wall", "Full wall", "g-bad", "Injury through the full bowel wall. Beyond this the bowel dies."], ["la", "Lactate", "g-bad", "Lactate rises when bowel tissue is starved of oxygen."], ["leak", "Leak", "g-clot", "Leak: a hole in dead bowel spilling bowel contents."], ["sep", "Sepsis", "g-cyt", "Sepsis following the leak and spill of bowel contents."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "SMA", 190, 148, 190, 102, "Superior mesenteric artery. It carries blood from the aorta to most of the small bowel. Pain is severe early while signs are few.");
  pill(ox, "Clot", 390, 130, 390, 96, "Block of the artery. An embolus from elsewhere, a clot on a narrowed artery, very low flow, or a clot in the vein can all starve the bowel.");
  pill(ox, "Bowel", 775, 180, 855, 90, "Small bowel. It needs rich blood flow. Without it the wall is injured within hours.");
  pill(ox, "Mucosa", 520, 360, 430, 282, "Magnified slice of the bowel wall below the bowel. The mucosa, the inner lining, is hurt first, then injury spreads through the full wall.");
  pill(ox, "Leak", 676, 412, 786, 430, "Leak through dead bowel. Contents spill out and sepsis follows.");
  const st = pill(ox, "Stent", 390, 148, 250, 232, "Revascularisation. A stent holds the artery open so blood reaches the bowel again."); st.setAttribute("id", "stent-pill");
  const th = pill(ox, "Blood thinner", 390, 148, 250, 232, "Resuscitation and blood thinner. Fluids support flow and the drug coats the clot so it stops spreading."); th.setAttribute("id", "thin-pill");
  const ct = pill(ox, "Cut out", 692, 350, 855, 250, "Resection. The dead segment is cut out and the healthy ends are sealed."); ct.setAttribute("id", "cut-pill");
  capEl = mk("text", { class: "mes-cap", x: 30, y: 352 }, ox); capEl.textContent = capText(0);
}
const sm = { F: 0.5, M: 0.5, Wd: 0.4, Pf: 0, Sep: 0.1, La: 0.4, occ: 0.5, revasc: 0, anticoag: 0, resect: 0 };
const acc = { lac: 0, spill: 0, blk: 0, drip: 0 };
function init() { initOrgans(); initFlow(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.F = lerp(sm.F, m.F, k1); sm.M = lerp(sm.M, m.M, k2); sm.Wd = lerp(sm.Wd, m.Wd, k2); sm.Pf = lerp(sm.Pf, m.Pf, k2); sm.Sep = lerp(sm.Sep, m.Sep, k2); sm.La = lerp(sm.La, m.La, k2); sm.occ = lerp(sm.occ, m.occ, k1); sm.revasc = lerp(sm.revasc, m.revasc, k1); sm.anticoag = lerp(sm.anticoag, m.anticoag, k1); sm.resect = lerp(sm.resect, m.resect, k1);
  /* artery widens as flow returns and the stent holds it open */
  layers.art.setAttribute("stroke-width", f1(15 + 9 * sm.F + 5 * sm.revasc));
  /* clot shrinks with each treatment and stops pulsing once coated */
  const occEff = sm.occ * (1 - 0.75 * sm.revasc);
  const pulse = 1 + 0.05 * Math.sin(tm / 300) * (1 - sm.anticoag);
  place(clotG, CLOT[0], CLOT[1], Math.sin(tm / 700) * 4, Math.max(0.08, (0.2 + 0.9 * occEff) * pulse));
  clotG.style.opacity = sm.occ > 0.04 ? 1 : 0;
  stentG.setAttribute("opacity", sm.revasc.toFixed(2));
  resectG.setAttribute("opacity", sm.resect.toFixed(2));
  perfG.setAttribute("opacity", sm.Pf.toFixed(2));
  layers.tint.setAttribute("opacity", (0.45 * sm.Wd).toFixed(2));
  layers.mucD.setAttribute("opacity", (sm.M * 0.75).toFixed(2));
  layers.wallD.setAttribute("opacity", (sm.Wd * 0.65).toFixed(2));
  const flow = clamp(0.15 + 0.9 * sm.F);
  rbcs.forEach((r) => { r.u += r.v * 0.11 * flow * dt; if (r.u > 1) r.u -= 1; const pt = artery.at(r.u); const held = r.u > 0.45 && r.u < 0.65 ? (1 - sm.occ * 0.7) : 1; place(r.g, pt.x, pt.y, pt.a + r.rot, held); r.g.style.opacity = held > 0.35 ? 1 : 0.3; });
  acc.lac += dt * sm.La * 7; while (acc.lac >= 1) { acc.lac--; const p = free(lac); if (p) emit(p, rnd(825, 858), rnd(290, 330), rnd(-5, 5), -rnd(16, 26), 0); }
  lac.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y < 70) kill(p); });
  acc.spill += dt * sm.Pf * 9; while (acc.spill >= 1) { acc.spill--; const p = free(spill); if (p) emit(p, rnd(665, 695), 422, rnd(-8, 8), rnd(14, 24), 0); }
  spill.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 438) kill(p); });
  /* blood thinner particles ride the flow, then sit on the clot and coat it */
  acc.blk += dt * sm.anticoag * 4; while (acc.blk >= 1) { acc.blk--; const p = free(blockers); if (p) { const pt = artery.at(0.02); emit(p, pt.x, pt.y, 0, 0, 0.02); p.a = rnd(0, 6.28); } }
  blockers.forEach((p) => {
    if (!p.on) return;
    if (p.st === 1) {
      const s = Math.max(0.08, 0.2 + 0.9 * sm.occ);
      place(p.e, CLOT[0] + Math.cos(p.a + tm / 2400) * 22 * s, CLOT[1] + Math.sin(p.a + tm / 2400) * 16 * s, p.a * 57.3 + tm / 40, 1);
      p.e.setAttribute("opacity", sm.anticoag.toFixed(2)); if (sm.anticoag < 0.05) kill(p);
    } else {
      p.k += dt * 0.12 * (0.3 + 0.7 * flow); const pt = artery.at(Math.min(1, p.k));
      p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ") rotate(" + f1(p.t * 80) + ")"); p.t += dt;
      if (pt.x >= 376 || p.k >= 1) { p.st = 1; } if (p.k >= 1 && p.st !== 1) kill(p);
    }
  });
  /* fluid drips fall into the aorta with resuscitation */
  acc.drip += dt * sm.anticoag * 5; while (acc.drip >= 1) { acc.drip--; const p = free(drip); if (p) emit(p, rnd(64, 92), 58, 0, 75, 0); }
  drip.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 96) kill(p); });
  $("stent-pill").style.opacity = sm.revasc.toFixed(2); $("thin-pill").style.opacity = sm.anticoag.toFixed(2); $("cut-pill").style.opacity = sm.resect.toFixed(2);
  gg.flow.set(sm.F, wordOf(sm.F, 0.35, 0.7, ["poor", "reduced", "good"])); gg.muc.set(sm.M, wordOf(sm.M, 0.25, 0.6, ["intact", "injured", "severe"])); gg.wall.set(sm.Wd, wordOf(sm.Wd, 0.22, 0.6, ["intact", "injured", "infarcted"]));
  gg.la.set(sm.La, wordOf(sm.La, 0.25, 0.55, ["normal", "raised", "high"])); gg.leak.set(sm.Pf, wordOf(sm.Pf, 0.2, 0.55, ["none", "risk", "leaking"])); gg.sep.set(sm.Sep, wordOf(sm.Sep, 0.25, 0.55, ["none", "risk", "sepsis"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
