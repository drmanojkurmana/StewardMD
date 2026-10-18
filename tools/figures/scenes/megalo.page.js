/* Megaloblastic anaemia scene: vitamin supply and absorption, marrow DNA failure, macrocytes, hypersegmented neutrophils and myelin. */
const layers = { supply: $("supply"), marrow: $("marrow"), blood: $("blood"), over: $("over"), panel: $("panel") };
const folTrack = track([[70, 116], [92, 350], [180, 410], [360, 410], [428, 262]]);
const b12Track = track([[155, 116], [100, 158], [106, 236], [186, 288], [236, 408], [360, 410], [428, 262]]);
let eryG = null, eryNuc = null, macroG = null, lobesG = null, blockG = null, dnaG = null;
const daughters = [], myelinSegs = [];
function initSupply() {
  cell(layers.supply, { cls: "fol", r: 13, nuc: 0, seed: 3, wob: 0.1, x: 70, y: 100 });
  cell(layers.supply, { cls: "b12", r: 13, nuc: 0, seed: 5, wob: 0.1, x: 155, y: 100 });
  mk("ellipse", { class: "mg-organ", cx: 85, cy: 198, rx: 36, ry: 46, transform: "rotate(-14 85 198)" }, layers.supply);
  mk("path", { class: "mg-gut", d: "M158 266h58a17 17 0 0 1 0 34h-46a15 15 0 0 0 0 30h58" }, layers.supply);
}
function initMarrow() {
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
}
function initBlood() {
  macroG = mk("g", { class: "cl cl-rbc" }, layers.blood);
  mk("ellipse", { class: "cl-b", rx: 26, ry: 16 }, macroG); mk("ellipse", { class: "cl-s", rx: 10, ry: 5 }, macroG);
  const norm = mk("g", { class: "cl cl-rbc", transform: "translate(845 145)" }, layers.blood);
  mk("ellipse", { class: "cl-b", rx: 13, ry: 8 }, norm); mk("ellipse", { class: "cl-s", rx: 5, ry: 2.4 }, norm);
  const neu = cell(layers.blood, { cls: "neut", r: 25, nuc: 0.55, nucCls: "multi", seed: 21, wob: 0.12, x: 795, y: 215 });
  lobesG = mk("g", { class: "cl cl-neut" }, layers.blood);
  [[782, 204], [808, 208], [796, 228]].forEach(([x, y]) => mk("circle", { class: "cl-n", cx: x, cy: y, r: 6 }, lobesG));
  for (let i = 0; i < 5; i++) myelinSegs.push(mk("rect", { class: "mg-myel", x: 690 + i * 48, y: 340, width: 38, height: 24, rx: 10 }, layers.blood));
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const folDots = pool(22, () => mk("circle", { class: "sc-p p-fol", r: 3 }, layers.supply));
const b12Dots = pool(22, () => mk("circle", { class: "sc-p p-b12", r: 3.2 }, layers.supply));
const ifDots = pool(12, () => mk("path", { class: "p-if", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.supply));
const dnaDots = pool(16, () => mk("rect", { class: "sc-p p-cyt2", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.marrow));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 285, 460, 635, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["dna", "DNA synthesis", "g-good", "Copying of DNA in marrow cells. It needs folate, and B12 to keep folate working (the methyl trap when B12 is missing)."], ["b12", "Vitamin B12", "g-b12", "Vitamin B12 level. It falls when intake or absorption fails, and in pernicious anaemia where intrinsic factor is missing."], ["fol", "Folate", "g-fol", "Folate level from food and replacement. Folate can look normal while B12 lack traps it in an unusable form."], ["macro", "Red cell size", "g-macro", "Size of red cells leaving the marrow. Too few divisions make large red cells (macrocytes, raised mean cell volume)."], ["nerve", "Nerves", "g-good", "Health of myelin and nerves. Only B12 lack damages them; folate lack alone does not."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Folate", 70, 114, 62, 142, "Folate from green vegetables and other foods. It is absorbed in the upper small bowel and supplies building blocks for DNA.");
  pill(ox, "Vitamin B12", 155, 114, 168, 142, "Vitamin B12 from animal foods. It must bind intrinsic factor and be absorbed in the terminal ileum.");
  pill(ox, "Intrinsic factor", 114, 192, 205, 200, "Intrinsic factor: a protein made by parietal cells in the stomach. B12 binds it for absorption. In pernicious anaemia it is missing, so B12 is not absorbed.");
  pill(ox, "Terminal ileum", 196, 300, 190, 382, "Terminal ileum: the end of the small bowel, where the B12 and intrinsic factor complex is absorbed.");
  pill(ox, "Erythroblast", 430, 160, 430, 125, "Erythroblast: a red cell precursor in the marrow. Its cytoplasm matures and turns pink while its nucleus lags behind when DNA synthesis fails.");
  pill(ox, "Lagging nucleus", 444, 200, 550, 125, "The nucleus cannot copy its DNA and divide on time, while the cytoplasm keeps growing. This mismatch is nuclear cytoplasmic asynchrony.");
  pill(ox, "Daughter cells", 568, 206, 560, 280, "Healthy precursors divide several times, making many smaller red cells. With too little DNA building material there are fewer divisions and each cell stays large.");
  pill(ox, "DNA synthesis", 524, 338, 480, 418, "Making DNA building blocks (including thymine) needs folate, and B12 keeps folate in its usable form. When either is missing, DNA copying stalls.");
  pill(ox, "Macrocyte", 745, 132, 738, 112, "Macrocyte: an unusually large red cell released from a megaloblastic marrow. The mean cell volume is raised.");
  pill(ox, "Normal red cell", 845, 137, 858, 112, "A normal sized red cell for comparison. Macrocytes are larger and often oval.");
  pill(ox, "Hyperseg. neutrophil", 795, 240, 798, 282, "A neutrophil whose nucleus has too many lobes (hypersegmented). A classic sign of megaloblastic marrow failure.");
  pill(ox, "Myelin", 758, 350, 718, 398, "Myelin: the fatty sheath around nerve fibres. B12 lack thins it and damages nerves and the spinal cord; folate lack alone does not.");
}
const sm = { dna: 0.3, macro: 0.7, nerve: 0.2, folLvl: 0.5, bLvl: 0.2, fEff: 0.7, bEff: 0.8, ifK: 1, txB: 0 };
const acc = { fol: 0, b12: 0, ifd: 0, dna: 0 };
function init() { initSupply(); initMarrow(); initBlood(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45), kN = Math.min(1, dt * 0.3);
  sm.dna = lerp(sm.dna, m.dna, k1); sm.macro = lerp(sm.macro, m.macro, k1); sm.folLvl = lerp(sm.folLvl, m.folLvl, k1); sm.bLvl = lerp(sm.bLvl, m.bLvl, k1);
  sm.fEff = lerp(sm.fEff, m.fEff, k1); sm.bEff = lerp(sm.bEff, m.bEff, k1); sm.ifK = lerp(sm.ifK, m.ifK, k1); sm.txB = lerp(sm.txB, m.txB, k1);
  sm.nerve = lerp(sm.nerve, m.nerve, sm.nerve < m.nerve ? kN : k1);
  const eryS = 1 + 0.36 * sm.macro;
  place(eryG, 430, 205, Math.sin(tm / 2400) * 5, eryS);
  place(eryNuc, 444, 200, 0, eryS * (1.18 - 0.42 * sm.macro));
  daughters.forEach((d) => { const s = clamp((sm.dna - d.i * 0.16) * 1.7, 0.08, 1); place(d.g, d.x, d.y, Math.sin(tm / 700 + d.i * 2) * 10, s); d.g.style.opacity = s > 0.2 ? 1 : 0.25; });
  dnaG.setAttribute("opacity", (0.3 + 0.7 * sm.dna).toFixed(2));
  blockG.setAttribute("opacity", clamp(1 - sm.dna * 1.4).toFixed(2));
  place(macroG, 745, 152, Math.sin(tm / 900) * 12, 0.78 + 0.55 * sm.macro);
  lobesG.setAttribute("opacity", sm.macro.toFixed(2));
  myelinSegs.forEach((r) => { const th = 8 + 18 * sm.nerve; r.setAttribute("y", f1(352 - th / 2)); r.setAttribute("height", f1(th)); });
  acc.fol += dt * (1.5 + 8 * sm.folLvl); while (acc.fol >= 1) { acc.fol--; const p = freeP(folDots); if (p) { emit(p, 70, 116, 0, 0); } }
  folDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.14; if (p.u >= 1) { kill(p); return; } const q = folTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  const blocked = sm.ifK < 0.5 && sm.txB < 0.5;
  acc.b12 += dt * (1.5 + 8 * sm.bLvl + (blocked ? 5 : 0)); while (acc.b12 >= 1) { acc.b12--; const p = freeP(b12Dots); if (p) emit(p, 155, 116, 0, 0); }
  b12Dots.forEach((p) => { if (!p.on) return; p.u += dt * 0.14; if (blocked && p.u > 0.5) { kill(p); return; } if (p.u >= 1) { kill(p); return; } const q = b12Track.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.ifd += dt * sm.ifK * 5; while (acc.ifd >= 1) { acc.ifd--; const p = freeP(ifDots); if (p) emit(p, 112, 196, rnd(14, 22), rnd(22, 30)); }
  ifDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.t > 3.4 || p.y > 320) kill(p); });
  acc.dna += dt * sm.dna * 9; while (acc.dna >= 1) { acc.dna--; const p = freeP(dnaDots); if (p) emit(p, 430 + rnd(-24, 24), 205 + rnd(-18, 18), rnd(-8, 26), rnd(-16, -6)); }
  dnaDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2) kill(p); });
  gg.dna.set(sm.dna, wordOf(sm.dna, 0.3, 0.65, ["low", "reduced", "working"])); gg.b12.set(sm.bLvl, wordOf(sm.bLvl, 0.3, 0.65, ["low", "reduced", "ok"])); gg.fol.set(sm.folLvl, wordOf(sm.folLvl, 0.3, 0.65, ["low", "reduced", "ok"]));
  gg.macro.set(sm.macro, wordOf(sm.macro, 0.3, 0.65, ["normal", "large", "very large"])); gg.nerve.set(sm.nerve, wordOf(sm.nerve, 0.35, 0.7, ["damaged", "at risk", "intact"]));
}
run({ init, step });
