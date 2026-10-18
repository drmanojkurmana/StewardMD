/* DNA replication and repair scene: fork enzymes, nucleotide flow, three lesions and three repair routes. */
const L = { fork: $("fork"), dmg: $("dmgzone"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, sx: 0, sy: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.sx = x; p.sy = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const nuc = pool(26, () => mk("circle", { class: "sc-p p-nuc", r: 2.6 }, L.parts));
const uvp = pool(12, () => mk("path", { class: "sc-p p-uv", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, L.parts));
const fixp = pool(16, () => mk("circle", { class: "sc-p p-fix", r: 2.2 }, L.parts));
const mutp = pool(12, () => mk("path", { class: "sc-p p-mut", d: "M-2.6 -2.6L2.6 2.6M2.6 -2.6L-2.6 2.6" }, L.parts));
const blk = pool(10, () => mk("path", { class: "sc-p p-block", d: "M0 -4.5L3.5 0L0 4.5L-3.5 0Z" }, L.parts));
const slots = [];
for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.2832 - 1.57; slots.push([790 + Math.cos(a) * 17, 325 + Math.sin(a) * 17]); }
function capText(l, d) {
  if (l === 0 && d === 0) return "Healthy DNA. Copying runs and repairs keep up.";
  if (l === 0 && d === 1) return "Sunscreen on healthy DNA. Almost nothing changes.";
  if (l === 0) return "PARP blocked but repair works, so the cell copes.";
  if (l === 1 && d === 0) return "No protection. Sunlight damages the DNA and copying stalls.";
  if (l === 1 && d === 1) return "Sunscreen blocks sunlight. Little damage forms and copying recovers.";
  if (l === 1) return "PARP blocked in sun damaged DNA. Repair strains and errors stick.";
  if (d === 0) return "No treatment. Faulty repair leaves breaks open and errors stick.";
  if (d === 1) return "Sunscreen cannot fix faulty repair. Breaks stay open.";
  return "PARP blocked. Breaks pile up and faulty cells are lost.";
}
let heli, polLead, polLag, prim, lig, frags = [], dimerG, misC, breakL, breakR, breakGlow, repBlobs = [], parpC, doom = [], shieldArc, sunG, gg = {}, parpPill, leadPath, capEl = null, capKey = -1;
const sm = { D: 0.14, cap: 0.9, unrep: 0.01, R: 0.9, M: 0, kill: 0, parp: 0, sun: 0 };
const acc = { nuc: 0, uv: 0, fix: 0, mut: 0 };
function init() {
  const F = L.fork;
  /* parental duplex on the left */
  mk("path", { class: "dn-parent", d: "M40 150H432" }, F); mk("path", { class: "dn-parent", d: "M40 190H432" }, F);
  for (let x = 58; x <= 420; x += 30) mk("path", { class: "dn-rung", d: "M" + x + " 152V188" }, F);
  /* separated template strands */
  mk("path", { class: "dn-temp", d: "M458 158L900 108" }, F); mk("path", { class: "dn-temp", d: "M458 182L900 232" }, F);
  /* leading strand: continuous, below the lower template */
  leadPath = mk("path", { class: "dn-lead", d: "M472 178L898 220" }, F);
  /* lagging strand: short pieces along the upper template, each with a primer */
  frags = [[528, 146, 596, 138], [626, 134, 694, 127], [724, 123, 792, 116], [822, 112, 884, 107]].map(([x1, y1, x2, y2]) => {
    mk("path", { class: "dn-primer", d: "M" + x1 + " " + y1 + "L" + (x1 + 16) + " " + (y1 - 1) }, F);
    return mk("path", { class: "dn-lag", d: "M" + (x1 + 16) + " " + (y1 - 1) + "L" + x2 + " " + y2 }, F);
  });
  /* enzymes as shaded cells */
  heli = cell(F, { cls: "heli", r: 20, nuc: 0.34, seed: 3, wob: 0.12 }); place(heli, 445, 165, 0, 1);
  polLead = cell(F, { cls: "pol", r: 18, nuc: 0.36, seed: 5, wob: 0.1 }); place(polLead, 610, 192, 0, 1);
  polLag = cell(F, { cls: "pol", r: 16, nuc: 0.36, seed: 7, wob: 0.1 }); place(polLag, 640, 138, 0, 1);
  prim = cell(F, { cls: "prim", r: 11, nuc: 0.3, seed: 9, wob: 0.12 }); place(prim, 545, 128, 0, 1);
  lig = cell(F, { cls: "lig", r: 10, nuc: 0.3, seed: 11, wob: 0.12 }); place(lig, 850, 124, 0, 1);
  /* ---- damage zone: one DNA segment with three lesions, left to right ---- */
  const Dg = L.dmg;
  breakGlow = mk("ellipse", { class: "dn-glow", cx: 720, cy: 365, rx: 80, ry: 45, opacity: "0" }, Dg);
  mk("path", { class: "dn-dna2", d: "M60 355H704M736 355H900" }, Dg); mk("path", { class: "dn-dna2", d: "M60 375H704M736 375H900" }, Dg);
  for (let x = 76; x <= 690; x += 28) { if (x > 218 && x < 262) continue; if (x > 458 && x < 502) continue; mk("path", { class: "dn-rung", d: "M" + x + " 357V373" }, Dg); }
  for (let x = 752; x <= 884; x += 28) mk("path", { class: "dn-rung", d: "M" + x + " 357V373" }, Dg);
  mk("path", { class: "dn-sister", d: "M650 400H800" }, Dg);
  sunG = mk("g", {}, Dg); mk("circle", { class: "dn-sun", cx: 95, cy: 322, r: 9 }, sunG);
  for (let i = 0; i < 6; i++) { const a = i * 1.047; mk("path", { class: "dn-ray", d: "M" + f1(95 + Math.cos(a) * 12) + " " + f1(322 + Math.sin(a) * 12) + "L" + f1(95 + Math.cos(a) * 17) + " " + f1(322 + Math.sin(a) * 17) }, sunG); }
  shieldArc = mk("path", { class: "dn-shield", d: "M192 334Q240 310 288 334", opacity: "0" }, Dg);
  dimerG = mk("g", {}, Dg); mk("circle", { class: "dn-dimer", cx: 234, cy: 350, r: 5.5 }, dimerG); mk("circle", { class: "dn-dimer", cx: 248, cy: 350, r: 5.5 }, dimerG); mk("path", { class: "dn-dimer", d: "M234 350H248" }, dimerG);
  misC = mk("circle", { class: "dn-mis", cx: 480, cy: 348, r: 5.5 }, Dg);
  breakL = mk("g", {}, Dg); mk("path", { class: "dn-end", d: "M704 355L713 361L706 366L713 371L704 375" }, breakL);
  breakR = mk("g", {}, Dg); mk("path", { class: "dn-end", d: "M736 355L727 361L734 366L727 371L736 375" }, breakR);
  repBlobs = [[240, 325], [480, 325], [720, 325]].map(([x, y], i) => { const g = cell(Dg, { cls: "rep", r: 13, nuc: 0.34, seed: 20 + i, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y }; });
  parpC = cell(Dg, { cls: "parp", r: 10, nuc: 0.34, seed: 31, wob: 0.12 }); place(parpC, 790, 325, 0, 1);
  doom = [[848, 362, 15, 41], [882, 388, 12, 43], [838, 398, 10, 47]].map(([x, y, r, seed]) => { const g = cell(Dg, { cls: "doom", r, nuc: 0.4, seed, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
  /* ---- label pills: two at the fork, four along the damage, one for the blocker ---- */
  const O = L.over;
  pill(O, "Helicase", 445, 170, 360, 238, "Helicase unwinds the double helix so each strand can be copied.");
  pill(O, "Polymerase", 610, 190, 600, 238, "DNA polymerase builds both new strands. Primase starts each piece, ligase seals the joins, and proofreading removes most errors.");
  pill(O, "Sunlight", 95, 322, 110, 300, "Ultraviolet in sunlight joins two thymines into a dimer that blocks copying.");
  pill(O, "Dimer", 241, 350, 240, 300, "Thymine dimer, fixed by excision repair, which cuts it out and fills the gap.");
  pill(O, "Mismatch", 480, 348, 480, 300, "Wrong base, fixed by mismatch repair. Missed errors become permanent mutations.");
  pill(O, "Break", 720, 358, 720, 300, "Both strands broken. Recombination using the sister copy fixes it. BRCA genes run this route.");
  parpPill = pill(O, "PARP blocked", 790, 325, 838, 300, "PARP inhibitor concept. Blocked PARP traps breaks. Cells lacking recombination cannot cope and are lost.");
  parpPill.style.opacity = 0;
  capEl = mk("text", { class: "dn-cap", x: 30, y: 428 }, O); capEl.textContent = capText(0, 0);
  /* ---- gauges ---- */
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The cell";
  [["rep", "Replication", "g-rep", "How steadily the fork copies the DNA."], ["dmg", "Damage", "g-dmg", "How much damage is present: dimers, mismatches and breaks."], ["fix", "Repair", "g-good", "How well the repair pathways can cope."], ["mut", "Mutations", "g-mut", "Unrepaired damage left as permanent mutations."], ["kill", "Cell loss", "g-kill", "Loss of repair defective cells. With a PARP inhibitor this is the intended effect on BRCA defective cells."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 170, y0 + 2, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.D = lerp(sm.D, m.D, k); sm.cap = lerp(sm.cap, m.cap, k); sm.unrep = lerp(sm.unrep, m.unrep, k); sm.R = lerp(sm.R, m.R, k); sm.M = lerp(sm.M, m.M, k); sm.kill = lerp(sm.kill, m.kill, k); sm.parp = lerp(sm.parp, m.parp, k); sm.sun = lerp(sm.sun, m.sun || 0, k);
  place(heli, 445 + Math.sin(tm / 500) * 2, 165, Math.sin(tm / 300) * 8, 1 + 0.05 * Math.sin(tm / 200));
  place(polLead, 610 + Math.sin(tm / 700) * 6, 192 + Math.cos(tm / 600) * 2, 0, 1 + 0.06 * sm.R * Math.sin(tm / 250));
  place(polLag, 640 + Math.sin(tm / 800 + 2) * 5, 138 + Math.cos(tm / 650) * 2, 0, 1);
  place(prim, 545 + Math.sin(tm / 900) * 3, 128, Math.sin(tm / 500) * 10, 1);
  place(lig, 850, 124 + Math.sin(tm / 550) * 3, 0, 1);
  frags.forEach((fg, i) => { const ph = 0.35 + 0.65 * clamp(sm.R * 1.2 - i * 0.12 + 0.15 * Math.sin(tm / 900 + i * 1.6)); fg.setAttribute("opacity", ph.toFixed(2)); });
  leadPath.setAttribute("opacity", (0.45 + 0.55 * sm.R).toFixed(2));
  /* broken ends drift apart while repair fails; the danger glow grows */
  const spread = 30 * sm.unrep;
  breakL.setAttribute("transform", "translate(" + f1(-spread) + " 0)");
  breakR.setAttribute("transform", "translate(" + f1(spread) + " 0)");
  breakGlow.setAttribute("opacity", (0.05 + 0.5 * Math.max(sm.unrep, sm.kill * 0.8)).toFixed(2));
  /* damage visuals scale with damage and unrepaired load */
  const ds = (0.3 + sm.D).toFixed(2); dimerG.setAttribute("transform", "translate(240 350) scale(" + ds + ") translate(-240 -350)"); dimerG.setAttribute("opacity", clamp(0.25 + sm.D).toFixed(2));
  misC.setAttribute("opacity", clamp(0.2 + sm.D * 0.9).toFixed(2)); misC.setAttribute("r", (4 + 3 * sm.D).toFixed(1));
  shieldArc.setAttribute("opacity", sm.sun.toFixed(2)); sunG.setAttribute("opacity", (1 - 0.55 * sm.sun).toFixed(2));
  parpPill.style.opacity = sm.parp.toFixed(2);
  repBlobs.forEach((b, i) => { place(b.g, b.x, b.y + Math.sin(tm / 600 + i * 2) * 2.5, 0, 1); b.g.style.opacity = ((0.3 + 0.7 * sm.cap) * (i === 2 ? 1 - 0.55 * sm.parp : 1)).toFixed(2); });
  place(parpC, 790 + Math.sin(tm / 700) * 1.5, 325, 0, 1);
  /* faulty cells shrink and fade as the kill model rises */
  doom.forEach((c, i) => { const s = Math.max(0.25, 1 - 0.68 * sm.kill); place(c.g, c.x, c.y + Math.sin(tm / 600 + i * 2.1) * 2, 0, s); c.g.style.opacity = (1 - 0.7 * sm.kill).toFixed(2); });
  /* PARP blocker dots fly in and sit on PARP while the drug is on */
  blk.forEach((p, i) => {
    if (sm.parp < 0.05) { if (p.on) killP(p); return; }
    if (!p.on) emit(p, slots[i][0] + rnd(-34, 34), 272 + rnd(0, 8), 0, 0, 0);
    p.t += dt; const s = slots[i], e = Math.min(1, p.t / 1.4), ez = e * e * (3 - 2 * e);
    const px = lerp(p.sx, s[0], ez) + (e >= 1 ? Math.sin(tm / 300 + i * 2.4) * 1.2 : 0);
    const py = lerp(p.sy, s[1], ez) + (e >= 1 ? Math.cos(tm / 360 + i * 1.7) * 1.2 : 0);
    p.e.setAttribute("transform", "translate(" + f1(px) + " " + f1(py) + ") rotate(" + f1(tm / 8 + i * 36) + ")");
    p.e.setAttribute("opacity", clamp(sm.parp * (1.6 - p.t / 4)).toFixed(2));
    if (p.t > 6) killP(p);
  });
  /* nucleotide particles flow from above the fork to the polymerases, kept inside the fork zone */
  acc.nuc += dt * sm.R * 9; while (acc.nuc >= 1) { acc.nuc--; const p = freeP(nuc); if (p) emit(p, rnd(500, 880), 66, 0, 0, Math.random() < 0.6 ? 0 : 1); }
  nuc.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? 640 : 610, ty = p.k ? 142 : 188, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 62 * dt; p.y += (dy / d) * 62 * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 52, 248); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 16 || p.t > 7) killP(p); });
  /* ultraviolet photons fall on the dimer; the shield stops them above the DNA */
  acc.uv += dt * sm.D * (m.lvl === 1 ? 7 : 1.2) * (1 - 0.9 * sm.sun); while (acc.uv >= 1) { acc.uv--; const p = freeP(uvp); if (p) emit(p, rnd(205, 275), 288, rnd(-3, 3), 34, 0); }
  uvp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 30, 930); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")");
    if (sm.sun > 0.4 && p.y >= 322 && p.x > 188 && p.x < 292) { killP(p); return; } if (p.y > 348 || p.t > 2.4) killP(p); });
  /* repair sparkles drift from each repair blob to its lesion; blocking PARP starves the break route */
  acc.fix += dt * sm.cap * sm.D * 8 * (1 - 0.7 * sm.parp) + dt * 0.4; while (acc.fix >= 1) { acc.fix--; const p = freeP(fixp); if (p) { const b = pick(repBlobs); emit(p, b.x + rnd(-8, 8), b.y + 8, rnd(-4, 4), 22, 0); } }
  fixp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.y = clamp(p.y, 280, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* mutation marks leave the fork when unrepaired damage is high */
  acc.mut += dt * sm.M * 6; while (acc.mut >= 1) { acc.mut--; const p = freeP(mutp); if (p) emit(p, rnd(820, 880), rnd(196, 224), rnd(8, 16), rnd(4, 10), 0); }
  mutp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 30, 938); p.y = clamp(p.y, 52, 248); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) killP(p); });
  gg.rep.set(sm.R, wordOf(sm.R, 0.45, 0.75, ["stalled", "slowed", "steady"]));
  gg.dmg.set(sm.D, wordOf(sm.D, 0.3, 0.6, ["low", "raised", "high"]));
  gg.fix.set(sm.cap, wordOf(sm.cap, 0.35, 0.7, ["failing", "strained", "coping"]));
  gg.mut.set(sm.M, wordOf(sm.M, 0.25, 0.55, ["rare", "some", "frequent"]));
  gg.kill.set(sm.kill, wordOf(sm.kill, 0.2, 0.55, ["little", "some", "marked"]));
  const ck = level * 10 + drug; if (ck !== capKey) { capKey = ck; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
