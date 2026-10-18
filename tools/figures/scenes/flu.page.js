/* Influenza scene: HA binding, endocytosis, nuclear replication, NA release, cell death, drift and shift, gauges. */
const W = SC.W, SURF = 214, CXC = 315, NUC = [315, 292];
const L = { cells: $("cells"), parts: $("parts"), journey: $("journey"), over: $("over"), change: $("change"), over2: $("over2"), panel: $("panel") };
const STEPS = ["HA binds sialic acid", "endocytosis", "replication in the nucleus", "assembly at the surface", "neuraminidase release", "cell death and spread"];
const DUR = [2, 1.8, 2.6, 2.2, 2, 2];
const ease = (t) => t * t * (3 - 2 * t);
const bez = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
/* ---- step strip ---- */
const boxes = STEPS.map((nm, i) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Step " + (i + 1) + ": " + nm }, L.cells); const b = mk("rect", { class: "flu-box", x: 30 + i * 62, y: 74, width: 54, height: 20, rx: 6 }, g); const t = mk("text", { class: "flu-bn", x: 30 + i * 62 + 27, y: 88, "text-anchor": "middle" }, g); t.textContent = String(i + 1); return b; });
/* ---- epithelial cells ---- */
const cellXs = [95, 205, 315, 425, 535];
const cellEls = cellXs.map((cx, i) => {
  const g = mk("g", {}, L.cells);
  const r = mk("rect", { class: "flu-cell" + (i === 2 ? " hot-cell" : ""), x: cx - 48, y: SURF, width: 96, height: 150, rx: 12 }, g);
  mk("circle", { class: "flu-nuc", cx: cx, cy: 292, r: 21 }, g);
  let cil = ""; [-32, -16, 0, 16, 32].forEach((o) => { cil += "M" + (cx + o) + " " + SURF + "L" + (cx + o) + " " + (SURF - 13); });
  mk("path", { class: "flu-cilia", d: cil }, g);
  [-22, 0, 22].forEach((o) => { const s = mk("path", { class: "flu-sia", d: "M0 0L0 -7M0 -7L-4 -11M0 -7L4 -11", transform: "translate(" + (cx + o) + " " + SURF + ")" }, g); });
  return { g, r, cx };
});
mk("path", { class: "flu-divider", d: "M28 370L606 370" }, L.cells);
const secT = mk("text", { class: "dr-pt2", x: 32, y: 430 }, L.cells); secT.textContent = "below the epithelium";
/* ---- virion drawing ---- */
function virion(parent, mut) {
  const g = mk("g", {}, parent);
  let ha = "", na = "";
  for (let i = 0; i < 8; i++) { const t = i * 0.785; ha += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 13.5) + " " + f1(Math.sin(t) * 13.5); }
  for (let i = 0; i < 4; i++) { const t = i * 1.571 + 0.39; na += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 12) + " " + f1(Math.sin(t) * 12); }
  mk("path", { class: "flu-ha", d: ha }, g); mk("path", { class: "flu-na", d: na }, g);
  if (mut) mk("path", { class: "flu-ha-mut", d: "M0 -9L0 -15" }, g);
  mk("circle", { class: "flu-env", r: 9 }, g);
  mk("path", { class: "flu-seg", d: "M-4 -3L4 -3M-5 1L3 1M-3 5L4 5" }, g);
  return { g };
}
const hero = virion(L.journey);
const bud = virion(L.journey); bud.g.setAttribute("opacity", 0);
const endoEl = mk("circle", { class: "flu-endo", cx: CXC, cy: 248, r: 17, opacity: 0 }, L.journey);
const nucDots = Array.from({ length: 6 }, (_, i) => { const e = mk("circle", { class: "flu-rna", r: 3, opacity: 0, cx: NUC[0] + Math.cos(i * 1.05) * 11, cy: NUC[1] + Math.sin(i * 1.05) * 8 }, L.journey); return e; });
const amb = Array.from({ length: 8 }, () => { const v = virion(L.journey, false); return { v, x: rnd(40, 580), y: rnd(136, 188), t: rnd(0, 6) }; });
const abs = Array.from({ length: 5 }, (_, i) => { const g = mk("g", { opacity: 0 }, L.journey); mk("path", { class: "flu-ab", d: "M0 0L0 -7M0 -7L-5 -12M0 -7L5 -12" }, g); return { g, x: 52 + i * 24, y: 168 + (i % 2) * 18 }; });
function xmark(x, y) { const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ")", opacity: 0 }, L.journey); mk("circle", { class: "flu-xc", r: 9 }, g); mk("path", { class: "flu-x", d: "M-4 -4L4 4M4 -4L-4 4" }, g); return g; }
const Xha = xmark(285, 196), Xna = xmark(342, 188);
/* ---- bacteria and debris (secondary pneumonia) ---- */
const bacG = mk("g", { opacity: 0 }, L.cells);
Array.from({ length: 9 }, (_, i) => { const e = mk("ellipse", { class: "flu-bac", rx: 7, ry: 3.4, cx: 195 + (i % 3) * 38, cy: 380 + Math.floor(i / 3) * 12, transform: "rotate(" + (i * 23 % 50 - 25) + " " + (195 + (i % 3) * 38) + " " + (380 + Math.floor(i / 3) * 12) + ")" }, bacG); return e; });
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const prog = pool(10, () => virion(L.parts, false).g);
const debris = pool(14, () => mk("circle", { class: "flu-debris", r: 3 }, L.parts));
const cyt = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- antigenic change panel ---- */
function secTitle(y, txt) { const t = mk("text", { class: "dr-pt2", x: 650, y }, L.change); t.textContent = txt; }
secTitle(88, "Antigenic drift"); secTitle(228, "Antigenic shift"); secTitle(348, "Outcome");
mk("path", { class: "flu-divider", d: "M650 208L928 208M650 328L928 328" }, L.change);
const driftA = virion(L.change, false); place(driftA.g, 695, 152, 0, 1);
mk("path", { class: "flu-arr", d: "M722 152L800 152M800 152L792 147M800 152L792 157" }, L.change);
const driftB = virion(L.change, true); place(driftB.g, 848, 152, 0, 1);
const driftT = mk("text", { class: "dr-pt2", x: 650, y: 188 }, L.change); driftT.textContent = "small HA and NA changes";
const shiftA = virion(L.change, false); place(shiftA.g, 690, 288, 0, 0.9);
const shiftB = virion(L.change, true); place(shiftB.g, 748, 288, 0, 0.9);
mk("path", { class: "flu-arr", d: "M778 288L822 288M822 288L814 283M822 288L814 293" }, L.change);
const shiftC = virion(L.change, true); place(shiftC.g, 862, 288, 0, 1);
const out1 = mk("text", { class: "dr-pt2", x: 650, y: 372 }, L.change), out2 = mk("text", { class: "dr-pt2", x: 650, y: 392 }, L.change);
/* ---- labels ---- */
pill(L.over, "Influenza virion", 70, 160, 105, 142, "Influenza virion: an enveloped virus with haemagglutinin and neuraminidase spikes and a segmented RNA genome inside.");
pill(L.over, "Haemagglutinin", 285, 205, 195, 180, "Haemagglutinin (HA): the spike that binds sialic acid and helps the virion enter. Antibody to HA is the main protection.");
pill(L.over, "Sialic acid", 348, 205, 435, 180, "Sialic acid: the cell surface sugar on respiratory epithelial cells that haemagglutinin binds.");
pill(L.over, "Neuraminidase", 342, 188, 505, 142, "Neuraminidase (NA): the spike enzyme that clips sialic acid so new virions can leave the cell and spread.");
pill(L.over, "Nucleus", 337, 285, 500, 255, "Nucleus: influenza copies and transcribes its segmented genome here, unusual for an RNA virus.");
pill(L.over, "Epithelial cell", 150, 300, 120, 395, "Respiratory epithelial cell: the ciliated cell lining the airway that influenza infects and kills.");
pill(L.over, "Cell death", 450, 330, 455, 395, "Infected epithelial cells die and are shed. The airway loses cilia and its barrier, so bacteria can invade.");
pill(L.over, "Pneumonia", 240, 398, 240, 422, "Pneumonia: lung inflammation that can be primary viral pneumonia or secondary bacterial pneumonia after epithelial damage.");
const pNai = pill(L.over, "Neuraminidase drug", 342, 188, 400, 422, "Neuraminidase inhibitor: it blocks neuraminidase so progeny virions stay stuck to the dying cell. It helps most when given early.");
const pVac = pill(L.over, "Vaccine antibody", 70, 160, 400, 422, "Vaccine antibody (anti HA): it coats the virion and blocks binding to sialic acid. Vaccination prevents infection rather than treating it.");
const pSup = pill(L.over, "Supportive care", 315, 330, 400, 422, "Supportive care: rest, fluids and help with fever and breathing. It eases illness but has no direct antiviral effect.");
pill(L.over2, "Antigenic drift", 848, 152, 789, 105, "Antigenic drift: small point changes in haemagglutinin and neuraminidase each season, so prior immunity partly escapes and vaccines are updated.");
pill(L.over2, "Antigenic shift", 862, 288, 789, 245, "Antigenic shift: reassortment of genome segments when two influenza viruses co infect one cell, making a subtype with little population immunity.");
/* ---- gauges ---- */
const gg = {};
{ const y0 = 478, P = L.panel; mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P); const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["virus", "Virus", "g-virus", "Viral replication and shedding in the airway. A neuraminidase inhibitor and vaccine immunity bring this down."], ["death", "Cell death", "g-death", "Death and shedding of infected respiratory epithelial cells, with loss of cilia and barrier."], ["fever", "Fever", "g-fever", "Fever and systemic illness: aches, malaise and feeling unwell from inflammatory mediators."], ["pneu", "Pneumonia", "g-pneu", "Risk of pneumonia, primary viral or secondary bacterial, the main complication."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 220, y0 + 2, 52, 18, cls, name, tip); }); }
/* ---- state ---- */
const sm = { V: 0.5, D: 0.3, F: 0.4, P: 0.2 };
const hs = { step: 0, t: 0, stall: 0, chk: false };
const acc = { prog: 0, deb: 0, cyt: 0 };
let outKey = "";
function stepName() { const s = $("stepname"); if (s) s.textContent = "Step " + (hs.step + 1) + ": " + STEPS[hs.step] + (hs.stall > 0 ? " (blocked)" : ""); boxes.forEach((b, i) => b.setAttribute("class", "flu-box" + (i === hs.step ? " on" : ""))); }
function hideJourney() { hero.g.setAttribute("opacity", 0); bud.g.setAttribute("opacity", 0); endoEl.setAttribute("opacity", 0); nucDots.forEach((e) => e.setAttribute("opacity", 0)); }
function nextVirion() { hs.step = 0; hs.t = 0; hs.stall = 0; hs.chk = false; hideJourney(); stepName(); }
function journey(dt, m) {
  if (hs.stall > 0) { hs.stall -= dt; const kk = clamp(hs.stall / 1.3); hero.g.setAttribute("opacity", kk.toFixed(2)); bud.g.setAttribute("opacity", kk.toFixed(2)); if (hs.stall <= 0) nextVirion(); return; }
  const s = hs.step; hs.t += dt; const p = clamp(hs.t / DUR[s]), e = ease(p);
  if (!hs.chk && ((s === 0 && p > 0.72) || (s === 4 && p > 0.1))) { hs.chk = true; const blk = s === 0 ? m.blkHA : m.blkNA; if (blk > 0 && Math.random() < blk) { hs.stall = 1.3; stepName(); return; } }
  hideJourney();
  if (s === 0) { const q = bez([70, 160], [288, 196], e); place(hero.g, q[0], q[1], 0, 1); hero.g.setAttribute("opacity", 1); }
  else if (s === 1) { const q = bez([300, 200], [CXC, 252], e); place(hero.g, q[0], q[1], 0, 0.85); hero.g.setAttribute("opacity", (1 - p * 0.5).toFixed(2)); endoEl.setAttribute("opacity", p.toFixed(2)); endoEl.setAttribute("cx", f1(q[0])); endoEl.setAttribute("cy", f1(q[1])); }
  else if (s === 2) { nucDots.forEach((d, i) => { d.setAttribute("opacity", (0.35 + 0.65 * Math.abs(Math.sin(tm / 300 + i))).toFixed(2)); }); }
  else if (s === 3) { place(bud.g, CXC, lerp(238, 202, e), 0, lerp(0.4, 0.9, e)); bud.g.setAttribute("opacity", (0.4 + 0.6 * p).toFixed(2)); }
  else if (s === 4) { const q = bez([CXC, 200], [368, 152], e); place(bud.g, q[0], q[1], 0, 1); bud.g.setAttribute("opacity", 1); }
  else { const q = bez([CXC, 214], [430, 330], e); place(bud.g, q[0], q[1], 0, 0.6); bud.g.setAttribute("opacity", (1 - p * 0.6).toFixed(2)); }
  if (p >= 1) { if (s === 5) { const pr = freeP(prog); if (pr) emit(pr, 368, 152, rnd(18, 30), rnd(-8, 2)); nextVirion(); } else { hs.step++; hs.t = 0; hs.chk = false; stepName(); } }
}
function init() { stepName(); hideJourney(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.V = lerp(sm.V, m.V, k); sm.D = lerp(sm.D, m.D, k); sm.F = lerp(sm.F, m.F, k); sm.P = lerp(sm.P, m.P, k);
  journey(dt, m);
  Xha.setAttribute("opacity", m.blkHA > 0.25 ? "1" : "0"); Xna.setAttribute("opacity", m.blkNA > 0.25 ? "1" : "0");
  pNai.style.opacity = m.nai ? "1" : "0"; pVac.style.opacity = m.vac ? "1" : "0"; pSup.style.opacity = m.sup ? "1" : "0";
  /* epithelial death: right hand cells fade and shrink a little */
  cellEls.forEach((c, i) => { const die = i >= 3 ? sm.D : i === 2 ? sm.D * 0.55 : sm.D * 0.18; c.r.style.opacity = (1 - die * 0.45).toFixed(2); });
  bacG.setAttribute("opacity", sm.P.toFixed(2));
  /* ambient virions in the airway */
  const nAmb = Math.round(sm.V * amb.length);
  amb.forEach((a, i) => { const on = i < nAmb; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; } a.v.g.setAttribute("opacity", 0.9); a.x += 16 * dt; a.y = clamp(a.y + Math.sin(a.t * 0.8 + i * 2) * 8 * dt, 134, 192); if (a.x > 596) { a.x = 38; a.y = rnd(136, 188); } place(a.v.g, a.x, a.y, 0, 0.75); });
  abs.forEach((a, i) => { a.g.style.opacity = m.vac ? "1" : "0"; place(a.g, a.x + Math.sin(tm / 600 + i) * 3, a.y + Math.cos(tm / 700 + i) * 3, Math.sin(tm / 800 + i) * 14, 1); });
  /* progeny release (blocked when neuraminidase is inhibited) */
  acc.prog += dt * sm.V * (1 - m.blkNA * 0.85) * 1.6;
  while (acc.prog >= 1) { acc.prog--; const p = freeP(prog); if (p) emit(p, CXC + rnd(-8, 8), 196, rnd(14, 30), rnd(-16, -6)); }
  prog.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 26, 606); p.y = clamp(p.y + p.vy * dt, 132, 200); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(0.8)"); p.e.setAttribute("opacity", clamp(1.2 - p.t / 4).toFixed(2)); if (p.t > 4.5) kill(p); });
  /* debris from dying cells */
  acc.deb += dt * sm.D * 3.2;
  while (acc.deb >= 1) { acc.deb--; const p = freeP(debris); if (p) emit(p, rnd(360, 580), 362, rnd(-6, 6), rnd(12, 22)); }
  debris.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 30, 604); p.y = clamp(p.y + p.vy * dt, 366, 424); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3) kill(p); });
  /* inflammatory mediators upward from infected cells */
  acc.cyt += dt * sm.F * 7;
  while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cyt); if (p) emit(p, CXC + rnd(-50, 50), 330, rnd(-6, 6), -rnd(18, 30)); }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 30, 604); p.y = clamp(p.y + p.vy * dt, 132, 360); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); });
  /* outcome text */
  const key = m.lvl + ":" + (m.nai ? "nai" : m.vac ? "vac" : m.sup ? "sup" : "no");
  if (key !== outKey) { outKey = key; const lines = m.vac && m.lvl === 0 ? ["Antibody blocks binding: infection", "is prevented or stays mild"] : m.nai && m.lvl === 0 ? ["Release blocked early: virus stays", "low and illness is shortened"] : m.nai && m.lvl === 2 ? ["Given late, release is only partly", "blocked and pneumonia can follow"] : m.sup ? ["Illness eased, virus unchanged:", "recovery depends on immunity"] : m.lvl === 0 ? ["Early infection of the airway", "epithelium with fever beginning"] : m.lvl === 1 ? ["Established illness: epithelial", "death, fever and systemic illness"] : ["Complicated: pneumonia, primary", "viral or secondary bacterial"]; out1.textContent = lines[0]; out2.textContent = lines[1]; }
  gg.virus.set(sm.V, wordOf(sm.V, 0.2, 0.55, ["low", "moderate", "high"])); gg.death.set(sm.D, wordOf(sm.D, 0.22, 0.58, ["low", "raised", "high"])); gg.fever.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["mild", "raised", "high"])); gg.pneu.set(sm.P, wordOf(sm.P, 0.18, 0.5, ["low", "some", "high"]));
}
run({ init, step });
