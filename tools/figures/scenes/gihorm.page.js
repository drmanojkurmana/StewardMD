/* Gastrointestinal hormones scene: vagus, gastrin, histamine, acid, CCK, secretin, incretins, insulin and somatostatin. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), ducts: $("ducts"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.tx = tx; p.ty = ty; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const atP = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
function moveP(p, dt, speed) { if (!p.on) return; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * dt; p.y += (dy / d) * speed * dt; p.x = clamp(p.x, 22, WW - 22); p.y = clamp(p.y, 52, 438); atP(p); if (d < 9) killP(p); }

/* ---- nodes (every node has a visible filled cell body) ---- */
const vagusN = cell(layers.cells, { cls: "vagus", r: 18, nuc: 0.36, seed: 3, wob: 0.12, x: 85, y: 125 });
const parN = cell(layers.cells, { cls: "par", r: 20, nuc: 0.34, seed: 5, wob: 0.10, x: 165, y: 150 });
const eclN = cell(layers.cells, { cls: "ecl", r: 13, nuc: 0.34, seed: 8, wob: 0.12, x: 215, y: 130 });
const dN = cell(layers.cells, { cls: "dcell", r: 13, nuc: 0.34, seed: 12, wob: 0.12, x: 310, y: 165 });
const gN = cell(layers.cells, { cls: "gcell", r: 17, nuc: 0.36, seed: 15, wob: 0.11, x: 335, y: 245 });
const iN = cell(layers.cells, { cls: "icell", r: 16, nuc: 0.36, seed: 18, wob: 0.11, x: 545, y: 140 });
const kN = cell(layers.cells, { cls: "kcell", r: 14, nuc: 0.36, seed: 21, wob: 0.12, x: 495, y: 240 });
const sN = cell(layers.cells, { cls: "scell", r: 15, nuc: 0.36, seed: 24, wob: 0.11, x: 600, y: 235 });
const lN = cell(layers.cells, { cls: "lcell", r: 13, nuc: 0.36, seed: 27, wob: 0.12, x: 625, y: 170 });
const acN = cell(layers.cells, { cls: "acinar", r: 18, nuc: 0.34, seed: 30, wob: 0.10, x: 710, y: 180 });
const ductN = cell(layers.cells, { cls: "ductc", r: 16, nuc: 0.34, seed: 33, wob: 0.11, x: 716, y: 232 });
const betaN = cell(layers.cells, { cls: "beta", r: 20, nuc: 0.38, seed: 36, wob: 0.10, x: 800, y: 228 });
const gbShape = mk("ellipse", { class: "gi-gb", cx: 838, cy: 116, rx: 24, ry: 20 }, layers.cells);
mk("path", { class: "gi-duct", d: "M826 132C800 158 700 188 624 196" }, layers.ducts);
/* treatment block marks */
const ppiMark = mk("g", { opacity: "0" }, layers.marks);
mk("path", { class: "gi-block", d: "M152 137L178 163M178 137L152 163" }, ppiMark);
const somaMark = mk("g", { opacity: "0" }, layers.marks);
mk("path", { class: "gi-block", d: "M324 234L346 256M346 234L324 256" }, somaMark);
mk("path", { class: "gi-block", d: "M534 129L556 151M556 129L534 151" }, somaMark);

/* ---- particle pools ---- */
const vagP = pool(8, dot("p-vag", 2.6));
const histP = pool(8, dot("p-hist", 2.4));
const gasP = pool(14, dot("p-gas", 2.8));
const acidP = pool(16, dot("p-acid", 2.6));
const cckP = pool(12, dot("p-cck", 2.7));
const secP = pool(10, dot("p-sec", 2.6));
const bicP = pool(12, dot("p-bic", 2.6));
const enzP = pool(12, dot("p-enz", 2.8));
const bileP = pool(8, dot("p-bile", 2.8));
const incrP = pool(12, dot("p-incr", 2.7));
const insP = pool(10, dot("p-ins", 2.8));
const somaP = pool(8, dot("p-soma", 2.6));
const foodTr = track([[150, 202], [250, 206], [360, 202], [470, 198], [548, 198]]);
const foodDots = Array.from({ length: 12 }, (_, i) => ({ e: dot("p-food", 3.4)(), u: i / 12 }));
const bloodGas = Array.from({ length: 16 }, () => ({ e: dot("p-gas", 2.6)(), x: rnd(30, 930), r: rnd(-0.7, 0.7) }));
const bloodIns = Array.from({ length: 14 }, () => ({ e: dot("p-ins", 2.6)(), x: rnd(30, 930), r: rnd(-0.7, 0.7) }));

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Hormones and outputs";
  [["gas", "Gastrin", "g-gas", "Gastrin from stomach G cells. It drives parietal acid, in blood and locally. It rises when a proton pump inhibitor removes acid feedback."], ["acid", "Acid", "g-acid", "Hydrochloric acid from parietal cells, driven by gastrin, histamine and the vagus acting on the acid pump. A proton pump inhibitor blocks that pump."], ["enz", "Enzymes", "g-enz", "Pancreatic enzymes driven by CCK from duodenal I cells, released into the duodenum to digest food."], ["bic", "Bicarbonate", "g-bic", "Bicarbonate from pancreatic duct cells, driven by secretin from S cells. It neutralises acid chyme from the stomach."], ["ins", "Insulin", "g-ins", "Insulin from pancreatic beta cells. GIP and GLP-1 are incretins: gut hormones that boost insulin release when food arrives."], ["soma", "Somatostatin", "g-soma", "Somatostatin from D cells: the brake. It inhibits gastrin, acid and most gut hormone release. An analogue applies this brake widely."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 105 + i * 155, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Vagus", 85, 125, 172, 64, "Vagus nerve: in the cephalic phase, sight and thought of food send vagal signals that prime parietal and G cells before food arrives.");
  pill(ox, "Parietal cell", 165, 150, 160, 104, "Parietal cell: makes stomach acid through its acid pump. Gastrin, histamine and vagal signals all switch it on; a proton pump inhibitor blocks the pump itself.");
  pill(ox, "ECL histamine", 215, 130, 282, 104, "ECL cell: releases histamine next to parietal cells. Histamine is a strong local driver of acid and is switched on by gastrin and the vagus.");
  pill(ox, "D cell", 310, 165, 382, 132, "D cell: releases somatostatin, the local brake on gastrin, histamine and acid. Rising acid switches D cells on, giving feedback control.");
  pill(ox, "G cell", 335, 245, 335, 286, "G cell: in the stomach antrum. Stomach stretch and peptides switch it on to release gastrin; acid and somatostatin switch it off.");
  pill(ox, "CCK (I cell)", 545, 140, 545, 92, "I cell: in the duodenum. Fat and protein products switch it on to release cholecystokinin (CCK).");
  pill(ox, "GLP-1 (L cell)", 625, 170, 692, 92, "L cell: releases GLP-1, an incretin. With GIP it boosts insulin release from beta cells when food is in the gut.");
  pill(ox, "Gallbladder", 838, 116, 838, 62, "Gallbladder: CCK makes it contract, squeezing bile through its duct into the duodenum to help fat digestion.");
  pill(ox, "Acinar cell", 710, 180, 712, 128, "Acinar cell: in the pancreas. CCK drives it to release digestive enzymes into the pancreatic duct and then the duodenum.");
  pill(ox, "GIP (K cell)", 495, 240, 485, 286, "K cell: releases GIP, an incretin. With GLP-1 it boosts insulin release from beta cells when food is in the gut.");
  pill(ox, "Secretin (S)", 600, 235, 590, 286, "S cell: acid chyme entering the duodenum switches it on to release secretin, which drives bicarbonate to neutralise that acid.");
  pill(ox, "Duct cell", 716, 232, 702, 286, "Duct cell: in the pancreas. Secretin drives it to release bicarbonate-rich fluid into the duodenum.");
  pill(ox, "Beta cell", 800, 228, 838, 186, "Beta cell: in a pancreatic islet. GIP and GLP-1 boost its glucose-dependent insulin release in the fed state.");
  pill(ox, "Hormones", 190, CY, 190, 418, "Hormones in blood: gastrin and insulin travel in blood to their targets. Many gut hormones also act locally on nearby cells.");
}
const sm = { V: 0.4, Hist: 0.3, Gas: 0.4, Acid: 0.3, CCK: 0.2, Sec: 0.2, Incr: 0.2, Enz: 0.2, Bic: 0.2, GB: 0.2, Ins: 0.2, Soma: 0.3, ppi: 0, somaD: 0 };
const acc = { vag: 0, hist: 0, gas: 0, acid: 0, cck: 0, sec: 0, bic: 0, enz: 0, bile: 0, incr: 0, ins: 0, soma: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.V = lerp(sm.V, m.V, k2); sm.Hist = lerp(sm.Hist, m.Hist, k2); sm.Gas = lerp(sm.Gas, m.Gas, k2); sm.Acid = lerp(sm.Acid, m.Acid, k1); sm.CCK = lerp(sm.CCK, m.CCK, k2); sm.Sec = lerp(sm.Sec, m.Sec, k2); sm.Incr = lerp(sm.Incr, m.Incr, k2); sm.Enz = lerp(sm.Enz, m.Enz, k2); sm.Bic = lerp(sm.Bic, m.Bic, k2); sm.GB = lerp(sm.GB, m.GB, k2); sm.Ins = lerp(sm.Ins, m.Ins, k2); sm.Soma = lerp(sm.Soma, m.Soma, k2); sm.ppi = lerp(sm.ppi, m.ppi, k1); sm.somaD = lerp(sm.somaD, m.somaD, k1);
  ppiMark.setAttribute("opacity", sm.ppi.toFixed(2));
  somaMark.setAttribute("opacity", sm.somaD.toFixed(2));
  gbShape.setAttribute("rx", f1(24 - 6 * sm.GB * (0.6 + 0.4 * Math.sin(tm / 360))));
  place(betaN, 800, 228, 0, 1 + 0.07 * sm.Ins * Math.sin(tm / 320));
  place(acN, 710, 180, 0, 1 + 0.05 * sm.Enz * Math.sin(tm / 380));
  const stom = $("stomLum"), duod = $("duodLum");
  if (stom) stom.style.opacity = (0.55 + 0.45 * sm.Acid).toFixed(2);
  if (duod) duod.style.opacity = (0.45 + 0.55 * sm.Bic).toFixed(2);
  /* vagus to parietal and G cells */
  acc.vag += dt * sm.V * 3.2; while (acc.vag >= 1) { acc.vag--; const p = freeP(vagP); if (p) emit(p, 92, 132, Math.random() < 0.6 ? 158 : 328, Math.random() < 0.6 ? 148 : 240, 0); }
  vagP.forEach((p) => moveP(p, dt, 62));
  /* histamine ECL to parietal */
  acc.hist += dt * sm.Hist * 4; while (acc.hist >= 1) { acc.hist--; const p = freeP(histP); if (p) emit(p, 208, 134, 172, 146, 0); }
  histP.forEach((p) => moveP(p, dt, 52));
  /* gastrin G cell to parietal and to blood */
  acc.gas += dt * sm.Gas * 4.2; while (acc.gas >= 1) { acc.gas--; const p = freeP(gasP); if (p) { const toBlood = Math.random() < 0.45; emit(p, 335, 248, toBlood ? 335 : 178, toBlood ? CY - 4 : 156, 0); } }
  gasP.forEach((p) => moveP(p, dt, 58));
  /* acid parietal into stomach lumen */
  acc.acid += dt * sm.Acid * 7; while (acc.acid >= 1) { acc.acid--; const p = freeP(acidP); if (p) emit(p, 172, 158, 225 + rnd(-38, 38), 198 + rnd(-22, 22), 0); }
  acidP.forEach((p) => moveP(p, dt, 46));
  /* somatostatin D cell to G and parietal cells */
  acc.soma += dt * sm.Soma * 3; while (acc.soma >= 1) { acc.soma--; const p = freeP(somaP); if (p) emit(p, 312, 170, Math.random() < 0.5 ? 330 : 176, Math.random() < 0.5 ? 238 : 154, 0); }
  somaP.forEach((p) => moveP(p, dt, 50));
  /* CCK I cell to acinar cells and gallbladder */
  acc.cck += dt * sm.CCK * 4.2; while (acc.cck >= 1) { acc.cck--; const p = freeP(cckP); if (p) { const toGb = Math.random() < 0.4; emit(p, 552, 144, toGb ? 828 : 704, toGb ? 122 : 176, 0); } }
  cckP.forEach((p) => moveP(p, dt, 66));
  /* secretin S cell to duct cells */
  acc.sec += dt * sm.Sec * 4; while (acc.sec >= 1) { acc.sec--; const p = freeP(secP); if (p) emit(p, 606, 230, 708, 230, 0); }
  secP.forEach((p) => moveP(p, dt, 60));
  /* bicarbonate duct to duodenum */
  acc.bic += dt * sm.Bic * 5; while (acc.bic >= 1) { acc.bic--; const p = freeP(bicP); if (p) emit(p, 700, 218, 566 + rnd(-24, 24), 200 + rnd(-18, 18), 0); }
  bicP.forEach((p) => moveP(p, dt, 62));
  /* enzymes acinar to duodenum */
  acc.enz += dt * sm.Enz * 5; while (acc.enz >= 1) { acc.enz--; const p = freeP(enzP); if (p) emit(p, 700, 190, 566 + rnd(-24, 24), 198 + rnd(-18, 18), 0); }
  enzP.forEach((p) => moveP(p, dt, 62));
  /* bile gallbladder to duodenum */
  acc.bile += dt * sm.GB * 3.4; while (acc.bile >= 1) { acc.bile--; const p = freeP(bileP); if (p) emit(p, 824, 132, 580 + rnd(-18, 18), 196 + rnd(-14, 14), 0); }
  bileP.forEach((p) => moveP(p, dt, 64));
  /* incretins K and L cells to beta cell */
  acc.incr += dt * sm.Incr * 4.4; while (acc.incr >= 1) { acc.incr--; const p = freeP(incrP); if (p) { const fromL = Math.random() < 0.5; emit(p, fromL ? 620 : 502, fromL ? 176 : 234, 792, 226, 0); } }
  incrP.forEach((p) => moveP(p, dt, 62));
  /* insulin beta cell to blood */
  acc.ins += dt * sm.Ins * 4; while (acc.ins >= 1) { acc.ins--; const p = freeP(insP); if (p) emit(p, 800, 238, 800, CY - 4, 0); }
  insP.forEach((p) => moveP(p, dt, 56));
  /* food and chyme along stomach to duodenum, faster in the intestinal phase */
  const foodSpeed = 0.018 + 0.050 * sm.CCK + 0.020 * sm.Gas;
  const foodWant = m.ph === 0 ? 4 : m.ph === 1 ? 10 : 12;
  foodDots.forEach((d, i) => { d.u = (d.u + dt * foodSpeed) % 1; const a = foodTr.at(d.u); d.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); d.e.setAttribute("opacity", i < foodWant ? "1" : "0"); });
  /* blood flow carrying gastrin and insulin */
  const wg = Math.round(sm.Gas * bloodGas.length), wi = Math.round(sm.Ins * bloodIns.length);
  [[bloodGas, wg], [bloodIns, wi]].forEach(([arr, want]) => arr.forEach((p, i) => { p.x += 54 * dt; if (p.x > 938) { p.x = 22; p.r = rnd(-0.7, 0.7); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * 18) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); }));
  gg.gas.set(sm.Gas, wordOf(sm.Gas, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.acid.set(sm.Acid, wordOf(sm.Acid, 0.25, 0.6, ["low", "moderate", "high"]));
  gg.enz.set(sm.Enz, wordOf(sm.Enz, 0.25, 0.6, ["low", "some", "high"]));
  gg.bic.set(sm.Bic, wordOf(sm.Bic, 0.25, 0.6, ["low", "some", "high"]));
  gg.ins.set(sm.Ins, wordOf(sm.Ins, 0.25, 0.6, ["low", "some", "high"]));
  gg.soma.set(sm.Soma, wordOf(sm.Soma, 0.3, 0.65, ["low", "moderate", "high"]));
}
run({ init, step });
