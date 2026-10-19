/* Influenza scene: airway binding, nuclear replication, NA release, spread to the lung, blocks and pneumonia. */
const W = SC.W, SURF = 214, BXC = 320, NUCX = 320, NUCY = 292;
const L = { cells: $("cells"), parts: $("parts"), journey: $("journey"), over: $("over"), panel: $("panel") };
const DUR = [2, 1.8, 2.6, 2.2, 2, 2.4];
const ease = (t) => t * t * (3 - 2 * t);
const bez = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
let lungO = null, capEl = null, capDrug = -1, bacG = null;
let spreadEnd = [786, 130];
const bacs = [];
const heroPos = [70, 160];
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 786, 250, 230, {});
  const P = lungO.ports, w = lungO.w || 230, h = lungO.h || 220;
  const tr = P.trachea || P.in || [786, 130];
  spreadEnd = [tr[0], tr[1]];
  const gl = $("lungGlow");
  gl.setAttribute("cx", f1(lungO.x)); gl.setAttribute("cy", f1(lungO.y));
  gl.setAttribute("rx", f1(w * 0.5 + 24)); gl.setAttribute("ry", f1(h * 0.5 + 18));
}
function capText(d) {
  if (d === 3) return "Vaccine antibody blocks binding. Few viruses enter and illness stays mild.";
  if (d === 2) return "Early drug blocks release. New viruses stay stuck and spread slows.";
  if (d === 1) return "Supportive care eases fever and breathing. The virus itself is unchanged.";
  return "No treatment. Virus binds, copies itself and spreads. Pneumonia can follow.";
}
/* ---- epithelial cells (histology, not organs) ---- */
const cellXs = [100, 210, 320, 430];
const dieW = [0.15, 0.3, 0.7, 1];
const cellEls = cellXs.map((cx, i) => {
  const g = mk("g", {}, L.cells);
  const r = mk("rect", { class: "flu-cell" + (i >= 2 ? " hot-cell" : ""), x: cx - 48, y: SURF, width: 96, height: 150, rx: 12 }, g);
  mk("circle", { class: "flu-nuc", cx: f1(cx), cy: "292", r: "21" }, g);
  let cil = "";
  [-32, -16, 0, 16, 32].forEach((o) => { cil += "M" + (cx + o) + " " + SURF + "L" + (cx + o) + " " + (SURF - 13); });
  const cilEl = mk("path", { class: "flu-cilia", d: cil }, g);
  [-22, 0, 22].forEach((o) => { mk("path", { class: "flu-sia", d: "M0 0L0 -7M0 -7L-4 -11M0 -7L4 -11", transform: "translate(" + (cx + o) + " " + SURF + ")" }, g); });
  return { g: g, r: r, cil: cilEl, cx: cx };
});
/* ---- virion drawing ---- */
function virion(parent) {
  const g = mk("g", {}, parent);
  let ha = "", na = "";
  for (let i = 0; i < 8; i++) { const t = i * 0.785; ha += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 13.5) + " " + f1(Math.sin(t) * 13.5); }
  for (let i = 0; i < 4; i++) { const t = i * 1.571 + 0.39; na += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 12) + " " + f1(Math.sin(t) * 12); }
  mk("path", { class: "flu-ha", d: ha }, g); mk("path", { class: "flu-na", d: na }, g);
  mk("circle", { class: "flu-env", r: "9" }, g);
  mk("path", { class: "flu-seg", d: "M-4 -3L4 -3M-5 1L3 1M-3 5L4 5" }, g);
  return { g: g };
}
const hero = virion(L.journey);
const bud = virion(L.journey); bud.g.setAttribute("opacity", 0);
const endoEl = mk("circle", { class: "flu-endo", cx: f1(BXC), cy: "248", r: "17", opacity: "0" }, L.journey);
const nucDots = Array.from({ length: 6 }, (_, i) => {
  const e = mk("circle", { class: "flu-rna", r: "3", opacity: "0", cx: f1(NUCX + Math.cos(i * 1.05) * 11), cy: f1(NUCY + Math.sin(i * 1.05) * 8) }, L.journey);
  return e;
});
const amb = Array.from({ length: 8 }, () => { const v = virion(L.journey); return { v: v, x: rnd(40, 580), y: rnd(136, 192), t: rnd(0, 6) }; });
const absHomes = Array.from({ length: 6 }, (_, i) => [252 + i * 24, 158 + (i % 2) * 18]);
const abs = absHomes.map((pt) => {
  const g = mk("g", { opacity: "0" }, L.journey);
  mk("path", { class: "flu-ab", d: "M0 0L0 -7M0 -7L-5 -12M0 -7L5 -12" }, g);
  return { g: g, hx: pt[0], hy: pt[1] };
});
function xmark(x, y) {
  const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ")", opacity: "0" }, L.journey);
  mk("circle", { class: "flu-xc", r: "9" }, g);
  mk("path", { class: "flu-x", d: "M-4 -4L4 4M4 -4L-4 4" }, g);
  return g;
}
const Xha = xmark(262, 186), Xna = xmark(378, 186);
const drugDots = Array.from({ length: 8 }, () => {
  const e = mk("rect", { class: "flu-drug", x: "-3.5", y: "-2.5", width: "7", height: "5", rx: "2", opacity: "0" }, L.journey);
  return e;
});
const trapped = Array.from({ length: 6 }, (_, i) => {
  const v = virion(L.journey);
  v.g.setAttribute("opacity", "0");
  return { v: v, bx: 306 + (i % 3) * 18, by: 190 + Math.floor(i / 3) * 20, ph: i * 1.1 };
});
/* ---- bacteria settled in the lung (secondary pneumonia) ---- */
function initLung() {
  bacG = mk("g", { opacity: "0" }, L.cells);
  const P = lungO.ports, w = lungO.w || 230, h = lungO.h || 220;
  const cx = lungO.x, bot = Math.min(P.base ? P.base[1] : 340, lungO.y + h * 0.5 - 12);
  const top = Math.max(bot - 84, lungO.y - h * 0.5 + 30);
  for (let i = 0; i < 9; i++) {
    const bx = cx - 62 + (i % 3) * 62 + rnd(-8, 8), by = top + Math.floor(i / 3) * 30 + rnd(-6, 6);
    const e = mk("ellipse", { class: "flu-bac", rx: "9", ry: "4", cx: f1(bx), cy: f1(by), transform: "rotate(" + (i * 23 % 50 - 25) + " " + f1(bx) + " " + f1(by) + ")" }, bacG);
    bacs.push({ e: e, bx: bx, by: by, rot: (i * 23 % 50 - 25), ph: i * 0.9, w: w });
  }
}
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const prog = pool(10, () => virion(L.parts).g);
const debris = pool(14, () => mk("circle", { class: "flu-debris", r: "3" }, L.parts));
const cyt = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: "2.4" }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels: 8 short pills, airway left to lung right ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: "24", y: f1(y0 - 30), width: f1(W - 48), height: "142", rx: "14" }, P);
  const t = mk("text", { class: "dr-pt", x: "40", y: f1(y0 - 8) }, P); t.textContent = "The patient";
  [["virus", "Virus", "g-virus", "Viral replication and shedding in the airway. Early drug and vaccine immunity bring this down."], ["death", "Cell death", "g-death", "Death and shedding of infected airway cells, with loss of cilia and barrier."], ["fever", "Fever", "g-fever", "Fever and systemic illness: aches, malaise and feeling unwell from inflammatory mediators."], ["pneu", "Pneumonia", "g-pneu", "Risk of pneumonia, primary viral or secondary bacterial, the main complication."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 220, y0 + 2, 52, 18, cls, name, tip); });
  const ox = L.over;
  const lungAnchor = [lungO.x - 20, lungO.y - 35];
  const pneuAnchor = lungO.ports.base || lungO.ports.baseR || [lungO.x, lungO.y + 80];
  pill(ox, "Virus", 70, 160, 100, 100, "Influenza virion: a virus particle with binding and release spikes and its genome inside.");
  pill(ox, "Binding site", 298, 206, 225, 120, "Binding site: the surface sugar the virus spike grips. Vaccine antibody blocks this grip.");
  pill(ox, "Nucleus", 320, 292, 140, 335, "Nucleus: the virus copies its genome here, then new parts gather at the surface.");
  pill(ox, "Release site", 342, 198, 455, 120, "Release site: the enzyme that cuts new viruses free. The early drug plugs this enzyme.");
  pill(ox, "Airway", 100, 300, 105, 400, "Airway lining: ciliated cells that warm and clean inhaled air. Flu infects them.");
  pill(ox, "Cell death", 452, 320, 520, 400, "Dying cells: infected cells die and shed. The bare airway invites bacteria.");
  pill(ox, "Lung", lungAnchor[0], lungAnchor[1], 790, 100, "Lung: air sacs where oxygen enters blood. Virus spread here brings pneumonia.");
  pill(ox, "Pneumonia", pneuAnchor[0], pneuAnchor[1], 790, 400, "Pneumonia: lung filled with germs and fluid. It is the main dangerous complication.");
  capEl = mk("text", { class: "flu-cap", x: "30", y: "438" }, ox); capEl.textContent = capText(0);
}
/* ---- state ---- */
const sm = { V: 0.5, D: 0.3, F: 0.4, P: 0.2, nai: 0, vac: 0, sup: 0 };
const hs = { step: 0, t: 0, stall: 0, chk: false };
const acc = { prog: 0, deb: 0, cyt: 0 };
function hideJourney() { hero.g.setAttribute("opacity", 0); bud.g.setAttribute("opacity", 0); endoEl.setAttribute("opacity", 0); nucDots.forEach((e) => e.setAttribute("opacity", 0)); }
function nextVirion() { hs.step = 0; hs.t = 0; hs.stall = 0; hs.chk = false; hideJourney(); }
function journey(dt, m) {
  if (hs.stall > 0) {
    hs.stall -= dt;
    const kk = clamp(hs.stall / 1.3);
    hero.g.setAttribute("opacity", kk.toFixed(2)); bud.g.setAttribute("opacity", kk.toFixed(2));
    if (hs.stall <= 0) nextVirion();
    return;
  }
  const s = hs.step; hs.t += dt; const p = clamp(hs.t / DUR[s]), e = ease(p);
  if (!hs.chk && ((s === 0 && p > 0.72) || (s === 4 && p > 0.1))) {
    hs.chk = true;
    const blk = s === 0 ? m.blkHA : m.blkNA;
    if (blk > 0 && Math.random() < blk) { hs.stall = 1.3; return; }
  }
  hideJourney();
  if (s === 0) { const q = bez([70, 160], [298, 206], e); heroPos[0] = q[0]; heroPos[1] = q[1]; place(hero.g, q[0], q[1], 0, 1); hero.g.setAttribute("opacity", 1); }
  else if (s === 1) {
    const q = bez([298, 206], [BXC, 252], e);
    heroPos[0] = q[0]; heroPos[1] = q[1];
    place(hero.g, q[0], q[1], 0, 0.85); hero.g.setAttribute("opacity", (1 - p * 0.5).toFixed(2));
    endoEl.setAttribute("opacity", p.toFixed(2)); endoEl.setAttribute("cx", f1(q[0])); endoEl.setAttribute("cy", f1(q[1]));
  }
  else if (s === 2) {
    heroPos[0] = NUCX; heroPos[1] = NUCY;
    nucDots.forEach((d, i) => { d.setAttribute("opacity", (0.35 + 0.65 * Math.abs(Math.sin(tm / 300 + i))).toFixed(2)); });
  }
  else if (s === 3) { place(bud.g, BXC, lerp(238, 204, e), 0, lerp(0.4, 0.95, e)); bud.g.setAttribute("opacity", (0.4 + 0.6 * p).toFixed(2)); }
  else if (s === 4) { const q = bez([BXC, 200], [470, 150], e); place(bud.g, q[0], q[1], 0, 1); bud.g.setAttribute("opacity", 1); }
  else { const q = bez([470, 150], spreadEnd, e); place(bud.g, q[0], q[1], 0, 1); bud.g.setAttribute("opacity", (1 - p * 0.4).toFixed(2)); }
  if (p >= 1) {
    if (s === 5) {
      const pr = freeP(prog);
      if (pr) emit(pr, spreadEnd[0] + rnd(-10, 10), spreadEnd[1] + rnd(-6, 10), rnd(-14, 14), rnd(6, 20));
      nextVirion();
    } else { hs.step++; hs.t = 0; hs.chk = false; }
  }
}
function init() { initOrgans(); initLung(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.V = lerp(sm.V, m.V, k); sm.D = lerp(sm.D, m.D, k); sm.F = lerp(sm.F, m.F, k); sm.P = lerp(sm.P, m.P, k);
  sm.nai = lerp(sm.nai, m.nai, k); sm.vac = lerp(sm.vac, m.vac, k); sm.sup = lerp(sm.sup, m.sup, k);
  journey(dt, m);
  Xha.setAttribute("opacity", m.blkHA > 0.25 ? "1" : "0");
  Xna.setAttribute("opacity", m.blkNA > 0.25 ? "1" : "0");
  $("wash").setAttribute("opacity", (0.05 + 0.5 * sm.F).toFixed(2));
  $("lungGlow").setAttribute("opacity", (sm.P * 0.5).toFixed(2));
  if (bacG) bacG.setAttribute("opacity", sm.P.toFixed(2));
  /* epithelial death: focus on the two right hand cells */
  cellEls.forEach((c, i) => {
    const die = dieW[i] * sm.D;
    c.r.style.opacity = (1 - die * 0.45).toFixed(2);
    c.cil.style.opacity = (1 - die * 0.8).toFixed(2);
  });
  /* ambient virions drift in the air; immunity thins and shrinks them */
  const nAmb = Math.round(sm.V * amb.length);
  const ambSc = 0.75 - 0.2 * sm.vac;
  amb.forEach((a, i) => {
    const on = i < nAmb;
    a.t += dt;
    if (!on) { a.v.g.setAttribute("opacity", 0); return; }
    a.v.g.setAttribute("opacity", 0.9);
    a.x += 16 * dt;
    a.y = clamp(a.y + Math.sin(a.t * 0.8 + i * 2) * 8 * dt, 134, 196);
    if (a.x > 596) { a.x = 38; a.y = rnd(136, 192); }
    place(a.v.g, a.x, a.y, 0, ambSc);
  });
  /* vaccine antibody swarms the binding site and rides the hero virion */
  abs.forEach((a, i) => {
    a.g.style.opacity = sm.vac > 0.4 ? "1" : "0";
    if (sm.vac > 0.4 && i < 3) place(a.g, heroPos[0] - 12 + i * 12, heroPos[1] - 14, Math.sin(tm / 800 + i) * 14, 1);
    else place(a.g, a.hx + Math.sin(tm / 600 + i) * 4, a.hy + Math.cos(tm / 700 + i) * 4, Math.sin(tm / 800 + i) * 14, 1);
  });
  /* early drug dots plug the release site; progeny stay stuck there */
  drugDots.forEach((e, i) => {
    const an = tm / 500 + i * 0.785;
    e.setAttribute("transform", "translate(" + f1(342 + Math.cos(an) * 17) + " " + f1(198 + Math.sin(an) * 12) + ")");
    e.setAttribute("opacity", sm.nai > 0.4 ? "1" : "0");
  });
  trapped.forEach((o) => {
    place(o.v.g, o.bx + Math.sin(tm / 700 + o.ph) * 2, o.by + Math.cos(tm / 800 + o.ph) * 2, 0, 0.55);
    o.v.g.setAttribute("opacity", sm.nai > 0.4 ? "0.95" : "0");
  });
  /* progeny fly toward the lung (fewer when release is blocked) */
  acc.prog += dt * sm.V * (1 - m.blkNA * 0.85) * 1.8;
  while (acc.prog >= 1) { acc.prog--; const p = freeP(prog); if (p) emit(p, 330 + rnd(-8, 8), 196, rnd(30, 60), rnd(-12, 8)); }
  prog.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.x = clamp(p.x + p.vx * dt, 26, 940); p.y = clamp(p.y + p.vy * dt, 90, 400);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(0.8)");
    p.e.setAttribute("opacity", clamp(1.2 - p.t / 5).toFixed(2));
    if (p.t > 5.5) kill(p);
  });
  /* shed cell debris below the epithelium */
  acc.deb += dt * sm.D * 3.2;
  while (acc.deb >= 1) { acc.deb--; const p = freeP(debris); if (p) emit(p, rnd(240, 560), 368, rnd(-6, 6), rnd(10, 22)); }
  debris.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.x = clamp(p.x + p.vx * dt, 30, 604); p.y = clamp(p.y + p.vy * dt, 366, 424);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 3) kill(p);
  });
  /* inflammatory mediators rising from infected cells */
  acc.cyt += dt * sm.F * 7;
  while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cyt); if (p) emit(p, BXC + rnd(-50, 50), 330, rnd(-6, 6), -rnd(18, 30)); }
  cyt.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.x = clamp(p.x + p.vx * dt, 30, 604); p.y = clamp(p.y + p.vy * dt, 132, 360);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 3.4) kill(p);
  });
  /* lung bacteria drift gently */
  bacs.forEach((b) => {
    b.e.setAttribute("cx", f1(b.bx + Math.sin(tm / 900 + b.ph) * 3));
    b.e.setAttribute("cy", f1(b.by + Math.cos(tm / 1100 + b.ph) * 2.5));
  });
  gg.virus.set(sm.V, wordOf(sm.V, 0.2, 0.55, ["low", "moderate", "high"]));
  gg.death.set(sm.D, wordOf(sm.D, 0.34, 0.58, ["low", "raised", "high"]));
  gg.fever.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["mild", "raised", "high"]));
  gg.pneu.set(sm.P, wordOf(sm.P, 0.2, 0.5, ["low", "some", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
