/* Megaloblastic anaemia scene: vitamin supply and absorption, marrow DNA failure, macrocytes and myelin.
 * Folate tablets dissolve into the supply stream; B12 visibly binds intrinsic factor at the stomach,
 * trapped folate parks uselessly until B12 frees it, and replacement B12 bypasses a gut that cannot absorb. */
const layers = { supply: $("supply"), marrow: $("marrow"), blood: $("blood"), over: $("over"), panel: $("panel") };
let stomachO = null, bowelO = null;
let folTrack = null, b12TrackA = null, b12TrackB = null, bypassTrack = null, bindPt = [130, 250], ileumPt = [212, 360];
let haloEl = null, eryG = null, eryNuc = null, blockG = null, dnaG = null;
const daughters = [], myelinSegs = [], myelinGaps = [], vesselCells = [], trapDots = [];
let tabG = null, vialG = null, capEl = null, capKey = -1;
const FOL_FOOD = [52, 100], B12_FOOD = [160, 100], TAB_SPOT = [52, 168], VIAL_TOP = [264, 112], INSET_IN = [348, 338];
function initOrgans() {
  stomachO = organ($("stomachSlot"), "stomach", 105, 222, 130, {});
  bowelO = organ($("bowelSlot"), "intestine", 218, 352, 130, {});
  const SP = stomachO.ports, IP = bowelO.ports;
  bindPt = SP.pylorus.slice(); ileumPt = IP.ileum.slice();
  const gut = [IP.duodenum, IP.jejunum, IP.ileum];
  folTrack = track([FOL_FOOD, [100, 170], gut[0], gut[1], gut[2], [300, 408], INSET_IN]);
  b12TrackA = track([B12_FOOD, SP.in, SP.pylorus, gut[0], gut[1], gut[2]]);
  b12TrackB = track([gut[2], [300, 408], INSET_IN]);
  bypassTrack = track([[VIAL_TOP[0], VIAL_TOP[1] + 66], [318, 250], INSET_IN]);
}
function initSupply() {
  cell(layers.supply, { cls: "fol", r: 13, nuc: 0, seed: 3, wob: 0.1, x: FOL_FOOD[0], y: FOL_FOOD[1] });
  cell(layers.supply, { cls: "b12", r: 13, nuc: 0, seed: 5, wob: 0.1, x: B12_FOOD[0], y: B12_FOOD[1] });
  tabG = mk("g", { opacity: "0" }, layers.supply);
  [[30, 158, 8], [58, 162, -10], [42, 178, 4]].forEach(([x, y, r]) => {
    mk("rect", { class: "mg-tab", x: x - 15, y: y - 7, width: 30, height: 14, rx: 7, transform: "rotate(" + r + " " + x + " " + y + ")" }, tabG);
    mk("path", { class: "mg-tab", d: "M" + (x - 15) + " " + y + "L" + (x + 15) + " " + y }, tabG);
  });
  vialG = mk("g", { opacity: "0" }, layers.supply);
  mk("rect", { class: "mg-vcap", x: VIAL_TOP[0] - 8, y: VIAL_TOP[1], width: 16, height: 12, rx: 3 }, vialG);
  mk("rect", { class: "mg-vial", x: VIAL_TOP[0] - 14, y: VIAL_TOP[1] + 12, width: 28, height: 54, rx: 7 }, vialG);
  mk("rect", { class: "mg-vial", x: VIAL_TOP[0] - 9, y: VIAL_TOP[1] + 34, width: 18, height: 26, rx: 5 }, vialG);
}
function initMarrow() {
  haloEl = mk("ellipse", { class: "mg-halo", cx: 430, cy: 205, rx: 80, ry: 68, opacity: "0" }, layers.marrow);
  eryG = mk("g", { class: "cl cl-mega" }, layers.marrow);
  mk("path", { class: "cl-b", d: blobD(46, 4, 0.08, 9) }, eryG);
  mk("path", { class: "cl-s", d: blobD(39, 4, 0.08, 9), transform: "translate(2 2)" }, eryG);
  mk("path", { class: "cl-h", d: blobD(28, 5, 0.05, 7), transform: "translate(-7 -8)" }, eryG);
  eryNuc = mk("g", { class: "cl cl-mega" }, layers.marrow);
  mk("path", { class: "cl-n", d: blobD(17, 7, 0.14, 7) }, eryNuc);
  [[552, 148], [576, 206], [536, 252]].forEach(([x, y], i) => { const g = cell(layers.marrow, { cls: "daught", r: 14, nuc: 0.45, seed: i + 8, wob: 0.1 }); daughters.push({ g, x, y, i }); });
  dnaG = mk("g", {}, layers.marrow);
  let d1 = "", d2 = "";
  for (let x = 356; x <= 596; x += 8) { const yy = 338 + Math.sin((x - 356) / 22) * 10; d1 += (x === 356 ? "M" : "L") + f1(x) + " " + f1(yy); d2 += (x === 356 ? "M" : "L") + f1(x) + " " + f1(338 - Math.sin((x - 356) / 22) * 10); }
  mk("path", { class: "mg-dna", d: d1 }, dnaG); mk("path", { class: "mg-dna", d: d2 }, dnaG);
  for (let x = 368; x <= 592; x += 24) { const yy = Math.sin((x - 356) / 22) * 10; mk("path", { class: "mg-rung", d: "M" + x + " " + f1(338 - yy) + "L" + x + " " + f1(338 + yy) }, dnaG); }
  blockG = mk("g", { opacity: "0" }, layers.marrow);
  mk("path", { class: "mg-block", d: "M512 326L536 350M536 326L512 350" }, blockG);
  for (let i = 0; i < 8; i++) trapDots.push(mk("circle", { class: "mg-trap", cx: 516 + i * 11, cy: 366, r: 4, opacity: "0" }, layers.marrow));
}
function initBlood() {
  for (let i = 0; i < 4; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.blood);
    mk("ellipse", { class: "cl-b", rx: 20, ry: 12 }, g); mk("ellipse", { class: "cl-s", rx: 8, ry: 4 }, g);
    vesselCells.push({ g, x: 700 + i * 58, y: 150 + (i % 2) * 55, vx: 10 + i * 2, ph: i * 1.7 });
  }
  const big = mk("g", { class: "cl cl-rbc" }, layers.blood);
  mk("ellipse", { class: "cl-b", rx: 26, ry: 16 }, big); mk("ellipse", { class: "cl-s", rx: 10, ry: 5 }, big);
  vesselCells.push({ g: big, x: 745, y: 152, vx: 0, ph: 0, anchor: true });
  const norm = mk("g", { class: "cl cl-rbc", transform: "translate(845 145)" }, layers.blood);
  mk("ellipse", { class: "cl-b", rx: 13, ry: 8 }, norm); mk("ellipse", { class: "cl-s", rx: 5, ry: 2.4 }, norm);
  cell(layers.blood, { cls: "neut", r: 25, nuc: 0.55, nucCls: "multi", seed: 21, wob: 0.12, x: 795, y: 215 });
  const lobesG = mk("g", { class: "cl cl-neut" }, layers.blood);
  [[782, 204], [808, 208], [796, 228]].forEach(([x, y]) => mk("circle", { class: "cl-n", cx: x, cy: y, r: 6 }, lobesG));
  vesselCells.lobes = lobesG;
  for (let i = 0; i < 5; i++) myelinSegs.push(mk("rect", { class: "mg-myel", x: 690 + i * 48, y: 340, width: 38, height: 24, rx: 10 }, layers.blood));
  for (let i = 0; i < 4; i++) myelinGaps.push(mk("rect", { class: "mg-gap", x: 726 + i * 48, y: 336, width: 12, height: 32, rx: 5, opacity: "0" }, layers.blood));
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, st: 0, bound: false }; }); }
const folDots = pool(22, () => mk("circle", { class: "sc-p p-fol", r: 3 }, layers.supply));
const b12Dots = pool(24, () => mk("circle", { class: "sc-p p-b12", r: 3.2 }, layers.supply));
const passDots = pool(14, () => mk("circle", { class: "sc-p p-b12", r: 3.4 }, layers.supply));
const ifDots = pool(12, () => mk("path", { class: "p-if", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.supply));
const dnaDots = pool(16, () => mk("rect", { class: "sc-p p-cyt2", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.marrow));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.st = 0; p.bound = false; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 285, 460, 635, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["dna", "DNA synthesis", "g-good", "Copying of DNA in marrow cells. It needs folate, and B12 keeps folate working."], ["b12", "Vitamin B12", "g-b12", "Vitamin B12 level. It falls when intake or absorption fails, and in pernicious anaemia where intrinsic factor is missing."], ["fol", "Folate", "g-fol", "Folate level from food and replacement. Folate can look normal while B12 lack traps it in an unusable form."], ["macro", "Red cell size", "g-macro", "Size of red cells leaving the marrow. Too few divisions make large red cells."], ["nerve", "Nerves", "g-good", "Health of myelin and nerves. Only B12 lack damages them. Folate lack alone does not."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, SP = stomachO.ports, IP = bowelO.ports;
  pill(ox, "Folate", FOL_FOOD[0], FOL_FOOD[1], 56, 132, "Folate from food. It supplies blocks for copying DNA.");
  pill(ox, "Vitamin B12", B12_FOOD[0], B12_FOOD[1], 170, 132, "B12 from food. It must bind intrinsic factor to be absorbed.");
  pill(ox, "Stomach", SP.fundus[0], SP.fundus[1], 60, 308, "The stomach makes intrinsic factor. B12 binds it here.");
  pill(ox, "Ileum", IP.ileum[0], IP.ileum[1], 258, 210, "Terminal ileum. The B12 complex is absorbed here. In pernicious anaemia this step fails.");
  pill(ox, "Marrow", 400, 170, 352, 112, "Marrow precursors. Without DNA blocks the nucleus lags while the cell body keeps growing.");
  pill(ox, "DNA", 470, 338, 600, 300, "DNA copying needs folate, and B12 keeps folate usable. Lack stalls copying.");
  pill(ox, "Blood cells", 745, 152, 745, 286, "Large red cells and lobed neutrophils spill into blood.");
  pill(ox, "Nerves", 800, 352, 800, 398, "Myelin around nerves. Only B12 lack damages it. Folate cannot protect nerves.");
  capEl = mk("text", { class: "mg-cap", x: 30, y: 430 }, ox); capEl.textContent = "";
}
function capText(t, d) {
  if (d === 1) return t === 0 ? "Folate restocks DNA blocks. Copying restarts and red cells recover." : "Folate restocks DNA blocks, so red cells recover. Nerves still need B12.";
  if (d === 2) return t === 0 ? "B12 cannot fix a folate lack. DNA copying still stalls." : t === 1 ? "B12 frees trapped folate and feeds nerves. Blood and nerves recover." : "Replacement B12 bypasses the gut. Blood and nerves recover.";
  if (d === 3) return "Folate plus B12 restocks everything. DNA, red cells and nerves recover.";
  return t === 0 ? "No treatment. Folate is low, so DNA copying stalls and red cells come out oversized." : t === 1 ? "No treatment. B12 is low, so DNA copying stalls and red cells are oversized. Nerves suffer." : "No treatment. Without intrinsic factor, B12 cannot be absorbed. Nerves suffer too.";
}
const sm = { dna: 0.3, macro: 0.7, nerve: 0.2, folLvl: 0.5, bLvl: 0.2, fEff: 0.7, bEff: 0.8, ifK: 1, txF: 0, txB: 0 };
const acc = { fol: 0, b12: 0, pass: 0, ifd: 0, dna: 0 };
function init() { initOrgans(); initSupply(); initMarrow(); initBlood(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45), kN = Math.min(1, dt * 0.3);
  sm.dna = lerp(sm.dna, m.dna, k1); sm.macro = lerp(sm.macro, m.macro, k1); sm.folLvl = lerp(sm.folLvl, m.folLvl, k1); sm.bLvl = lerp(sm.bLvl, m.bLvl, k1);
  sm.fEff = lerp(sm.fEff, m.fEff, k1); sm.bEff = lerp(sm.bEff, m.bEff, k1); sm.ifK = lerp(sm.ifK, m.ifK, k1);
  sm.txF = lerp(sm.txF, m.txF, k1); sm.txB = lerp(sm.txB, m.txB, k1);
  sm.nerve = lerp(sm.nerve, m.nerve, sm.nerve < m.nerve ? kN : k1);
  const eryS = 0.92 + 0.44 * sm.macro;
  haloEl.setAttribute("opacity", (0.55 * sm.macro * (0.9 + 0.1 * Math.sin(tm / 500))).toFixed(2));
  place(eryG, 430, 205, Math.sin(tm / 2400) * 5, eryS);
  place(eryNuc, 444, 200, 0, eryS * (1.18 - 0.42 * sm.macro));
  daughters.forEach((d) => { const s = clamp((sm.dna - d.i * 0.16) * 1.7, 0.08, 1); place(d.g, d.x, d.y, Math.sin(tm / 700 + d.i * 2) * 10, s); d.g.style.opacity = s > 0.2 ? 1 : 0.25; });
  dnaG.setAttribute("opacity", (0.35 + 0.65 * sm.dna).toFixed(2));
  blockG.setAttribute("opacity", clamp(1 - sm.dna * 1.4).toFixed(2));
  const nTrap = Math.round(8 * clamp(sm.bEff * 1.15 - 0.08));
  trapDots.forEach((e, i) => { const on = i < nTrap; e.setAttribute("opacity", on ? "1" : "0"); if (on) e.setAttribute("transform", "translate(" + f1(Math.sin(tm / 600 + i * 2.1) * 2.5) + " " + f1(Math.cos(tm / 700 + i * 1.7) * 2.5) + ")"); });
  tabG.setAttribute("opacity", sm.txF.toFixed(2));
  vialG.setAttribute("opacity", sm.txB.toFixed(2));
  vesselCells.forEach((c) => {
    if (c.anchor) { place(c.g, c.x, c.y + Math.sin(tm / 900) * 3, Math.sin(tm / 900) * 12, 0.78 + 0.55 * sm.macro); return; }
    c.x += c.vx * dt; if (c.x > 912) c.x = 688;
    place(c.g, c.x, c.y + Math.sin(tm / 800 + c.ph) * 6, Math.sin(tm / 900 + c.ph) * 10, 0.7 + 0.6 * sm.macro);
  });
  vesselCells.lobes.setAttribute("opacity", sm.macro.toFixed(2));
  myelinSegs.forEach((r) => { const th = 8 + 18 * sm.nerve; r.setAttribute("y", f1(352 - th / 2)); r.setAttribute("height", f1(th)); });
  myelinGaps.forEach((r) => r.setAttribute("opacity", clamp(1.1 - sm.nerve * 1.6).toFixed(2)));
  const gutOpen = sm.ifK >= 0.5;
  acc.fol += dt * (1 + 9 * sm.folLvl); while (acc.fol >= 1) { acc.fol--; const p = freeP(folDots); if (p) { const fromTab = sm.txF > 0.5 && Math.random() < 0.5; emit(p, fromTab ? TAB_SPOT[0] + rnd(-14, 14) : FOL_FOOD[0], fromTab ? TAB_SPOT[1] + rnd(-6, 6) : FOL_FOOD[1], 0, 0); } }
  folDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.12; if (p.u >= 1) { kill(p); return; } const q = folTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.b12 += dt * (1 + 9 * sm.bLvl); while (acc.b12 >= 1) { acc.b12--; const p = freeP(b12Dots); if (p) { emit(p, B12_FOOD[0], B12_FOOD[1], 0, 0); p.e.setAttribute("class", "sc-p p-b12"); } }
  b12Dots.forEach((p) => {
    if (!p.on) return;
    if (p.st === 0) {
      p.u += dt * 0.11; const q = b12TrackA.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
      if (!p.bound && gutOpen && Math.hypot(q.x - bindPt[0], q.y - bindPt[1]) < 30) { p.bound = true; p.e.setAttribute("class", "sc-p p-b12if"); }
      p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
      if (p.u >= 1) { if (gutOpen) { p.st = 1; p.u = 0; } else { p.st = 2; p.t = 0; p.vx = rnd(-6, 6); p.vy = rnd(14, 22); } }
    } else if (p.st === 1) {
      p.u += dt * 0.12; if (p.u >= 1) { kill(p); return; } const q = b12TrackB.at(p.u); p.x = q.x; p.y = q.y;
      p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    } else { p.t += dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); }
  });
  if (sm.txB > 0.5) { acc.pass += dt * 7; while (acc.pass >= 1) { acc.pass--; const p = freeP(passDots); if (p) emit(p, VIAL_TOP[0], VIAL_TOP[1] + 66, 0, 0); } }
  passDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.22; if (p.u >= 1) { kill(p); return; } const q = bypassTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.ifd += dt * sm.ifK * 5; while (acc.ifd >= 1) { acc.ifd--; const p = freeP(ifDots); if (p) { const SP = stomachO.ports; emit(p, SP.antrum[0] + rnd(-8, 8), SP.antrum[1] + rnd(-8, 8), (SP.pylorus[0] - SP.antrum[0]) * 0.45, (SP.pylorus[1] - SP.antrum[1]) * 0.45); } }
  ifDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.t > 3.2) kill(p); });
  acc.dna += dt * sm.dna * 9; while (acc.dna >= 1) { acc.dna--; const p = freeP(dnaDots); if (p) emit(p, 430 + rnd(-24, 24), 205 + rnd(-18, 18), rnd(-8, 26), rnd(-16, -6)); }
  dnaDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2) kill(p); });
  gg.dna.set(sm.dna, wordOf(sm.dna, 0.3, 0.65, ["low", "reduced", "working"])); gg.b12.set(sm.bLvl, wordOf(sm.bLvl, 0.3, 0.65, ["low", "reduced", "ok"])); gg.fol.set(sm.folLvl, wordOf(sm.folLvl, 0.3, 0.65, ["low", "reduced", "ok"]));
  gg.macro.set(sm.macro, wordOf(sm.macro, 0.3, 0.65, ["normal", "large", "very large"])); gg.nerve.set(sm.nerve, wordOf(sm.nerve, 0.35, 0.7, ["damaged", "at risk", "intact"]));
  const key = m.t * 4 + drug;
  if (key !== capKey) { capKey = key; const s = capText(m.t, drug); if (capEl.textContent !== s) capEl.textContent = s; }
}
run({ init, step });
