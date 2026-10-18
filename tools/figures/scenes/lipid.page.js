/* Lipid scene: gut uptake, liver production, VLDL to LDL, receptor clearance, HDL return and the gauges.
 * Organs are real anatomy art (bowel, liver, muscle); flows and receptors anchor to their ports. */
const L = { gut: $("gutn"), liv: $("livn"), per: $("pern"), parts: $("parts"), over: $("over"), panel: $("panel"), vGut: $("vGut"), vProd: $("vProd"), vHdl: $("vHdl"), wash: $("bloodWash"), glow: $("tissGlow") };
const xmark = (parent, x, y) => { const g = mk("g", { opacity: "0" }, parent); mk("circle", { class: "li-x", cx: x, cy: y, r: 9 }, g); mk("path", { class: "li-xp", d: "M" + (x - 4) + " " + (y - 4) + "L" + (x + 4) + " " + (y + 4) + "M" + (x + 4) + " " + (y - 4) + "L" + (x - 4) + " " + (y + 4) }, g); return g; };
const blockerAt = (parent, x, y, rot) => { const g = mk("g", { opacity: "0" }, parent); const b = mk("g", {}, g); mk("rect", { class: "p-block", x: -6, y: -3, width: 12, height: 6, rx: 3 }, b); mk("rect", { class: "p-block2", x: 0, y: -3, width: 6, height: 6, rx: 3 }, b); place(b, x, y, rot, 1.3); return { g, b, x, y, rot }; };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
let gutO = null, liverO = null, perO = null, capEl = null, capKey = null;
let trGut = null, trProd = null, trHdl = null, trPcsk = null;
let enzC = [405, 158], transC = [178, 214], recY = 285, pcskEnd = [483, 285], prodStart = [370, 273], hdlStart = [690, 230], gutOutPt = [175, 247], pcskStartPt = [470, 222];
let recXs = [350, 375, 400, 425, 450, 475, 500];
const gutP = pool(10, () => mk("circle", { class: "sc-p p-chol", r: 3.2 }, L.parts));
const prodP = pool(10, () => mk("circle", { class: "sc-p p-chol", r: 3.2 }, L.parts));
const pcskP = pool(10, () => mk("circle", { class: "sc-p p-pcsk", r: 3.4 }, L.parts));
let enzX = null, gutX = null, pcskX = null, famX = null, recG = null, recPlus = null, vldlBlob = null;
const enzD = [], transD = [], gutChol = [], liverChol = [], perChol = [];
const statBlock = [], ezeBlock = [], pcskBlock = [];
const lipos = [], hdls = [];
const gg = {};
const sm = { Prod: 0.4, Abs: 0.3, V: 0.4, L: 0.3, R: 0.6, Hd: 0.5, Per: 0.2, Pk: 0.5, statin: 0, eze: 0, pcsk9i: 0, fam: 0 };
const acc = { gut: 0, prod: 0, pcsk: 0 };
function initOrgans() {
  gutO = organ(L.gut, "bowel", 130, 178, 150, {});
  liverO = organ(L.liv, "liver", 430, 180, 230, {});
  perO = organ(L.per, "muscle", 790, 175, 220, {});
  const GP = gutO.ports, LP = liverO.ports, MP = perO.ports;
  const gutOut = GP.out;
  gutOutPt = [gutOut[0], gutOut[1]];
  pcskStartPt = [liverO.x + 40, liverO.y + 42];
  enzC = [Math.round(liverO.x - 25), Math.round(liverO.y - 22)];
  recY = Math.round(liverO.y + liverO.h / 2 + 10);
  recXs = [0, 1, 2, 3, 4, 5, 6].map((i) => Math.round(liverO.x - 80 + i * 25));
  prodStart = [Math.round(liverO.x - 68), recY - 12];
  pcskEnd = [recXs[4] + 33, recY];
  transC = [Math.round(gutO.x + 48), Math.round(gutO.y + 36)];
  hdlStart = [Math.round(MP.in[0] + 6), Math.round(MP.in[1] + 21)];
  L.vGut.setAttribute("d", "M" + f1(gutOut[0]) + " " + f1(gutOut[1]) + " L" + f1(gutOut[0]) + " 358");
  L.vProd.setAttribute("d", "M" + f1(prodStart[0]) + " " + f1(prodStart[1]) + " C" + f1(prodStart[0] - 5) + " 300 " + f1(prodStart[0] - 12) + " 330 " + f1(prodStart[0] - 18) + " 358");
  L.vHdl.setAttribute("d", "M" + f1(hdlStart[0]) + " " + f1(hdlStart[1]) + " C" + f1(hdlStart[0]) + " 300 " + f1(hdlStart[0]) + " 330 " + f1(hdlStart[0]) + " 358 L430 358 C415 335 405 310 400 " + f1(recY));
  trGut = track([gutOut, [gutOut[0], 358]]);
  trProd = track([prodStart, [prodStart[0] - 5, 310], [prodStart[0] - 18, 358]]);
  trPcsk = track([pcskStartPt, [liverO.x + 48, recY - 30], pcskEnd]);
  trHdl = track([hdlStart, [hdlStart[0], 358], [430, 358], [400, recY]]);
}
function capText(d, l) {
  if (d === 1) return "Statin blocks cholesterol making. The liver adds receptors and clears more LDL.";
  if (d === 2) return "Ezetimibe blocks gut uptake. Less cholesterol reaches the liver and blood.";
  if (d === 3) return "PCSK9 blocker protects LDL receptors. More receptors survive and clear LDL.";
  if (l === 2) return "No treatment. Faulty receptors cannot clear LDL, so blood levels stay very high.";
  if (l === 1) return "No treatment. Extra LDL builds up in blood and loads the tissue.";
  return "No treatment. Making and clearing stay balanced.";
}
function initNodes() {
  initOrgans();
  [[-22, -4], [3, -10], [24, 0]].forEach(([dx, dy]) => {
    const x = enzC[0] + dx, y = enzC[1] + dy;
    const e = mk("polygon", { class: "li-enz", points: (x - 9) + "," + y + " " + (x - 4.5) + "," + (y - 8) + " " + (x + 4.5) + "," + (y - 8) + " " + (x + 9) + "," + y + " " + (x + 4.5) + "," + (y + 8) + " " + (x - 4.5) + "," + (y + 8) }, L.liv);
    enzD.push(e);
  });
  [[0, -14], [0, 0], [0, 14]].forEach(([dx, dy]) => transD.push(mk("circle", { class: "li-trans", cx: transC[0] + dx, cy: transC[1] + dy, r: 4.5 }, L.gut)));
  [[95, 150], [120, 165], [100, 190], [130, 200], [150, 180]].forEach(([x, y], i) => { const c = mk("circle", { class: "sc-p p-chol", cx: x, cy: y, r: 3.4 }, L.gut); gutChol.push({ e: c, i }); });
  [[350, 150], [390, 140], [440, 145], [480, 155], [365, 185], [455, 190]].forEach(([x, y], i) => { const c = mk("circle", { class: "sc-p p-chol", cx: x, cy: y, r: 3.6 }, L.liv); liverChol.push({ e: c, i }); });
  vldlBlob = mk("g", {}, L.liv);
  mk("circle", { class: "sc-p p-vldl", cx: prodStart[0], cy: prodStart[1], r: 9 }, vldlBlob);
  mk("circle", { class: "sc-p p-vldl", cx: prodStart[0] - 2, cy: prodStart[1] - 2, r: 2.4 }, vldlBlob);
  recG = mk("g", {}, L.liv);
  recXs.slice(0, 5).forEach((x) => mk("path", { class: "li-rec", d: "M" + x + " " + (recY + 8) + "L" + x + " " + (recY - 4) + "M" + x + " " + (recY - 4) + "L" + (x - 6) + " " + (recY - 11) + "M" + x + " " + (recY - 4) + "L" + (x + 6) + " " + (recY - 11) }, recG));
  recPlus = mk("g", { opacity: "0" }, L.liv);
  recXs.slice(5).forEach((x) => mk("path", { class: "li-rec", d: "M" + x + " " + (recY + 8) + "L" + x + " " + (recY - 4) + "M" + x + " " + (recY - 4) + "L" + (x - 6) + " " + (recY - 11) + "M" + x + " " + (recY - 4) + "L" + (x + 6) + " " + (recY - 11) }, recPlus));
  [[690, 150], [750, 140], [810, 150], [870, 145], [720, 195], [790, 200], [860, 195], [890, 210]].forEach(([x, y], i) => { const c = mk("circle", { class: "sc-p p-chol", cx: x, cy: y, r: 3.4 }, L.per); perChol.push({ e: c, i }); });
  enzX = xmark(L.liv, enzC[0] + 3, enzC[1] - 4);
  gutX = xmark(L.gut, transC[0], transC[1]);
  pcskX = xmark(L.parts, pcskEnd[0], pcskEnd[1] + 14);
  famX = mk("g", { opacity: "0" }, L.liv);
  mk("path", { class: "li-recbad", d: "M" + (recXs[2] - 8) + " " + (recY - 14) + "l16 16M" + (recXs[2] + 8) + " " + (recY - 14) + "l-16 16" }, famX);
  [[-20, -8, -25], [2, 10, 15], [22, -8, 30]].forEach(([dx, dy, r]) => statBlock.push(blockerAt(L.liv, enzC[0] + dx, enzC[1] + dy, r)));
  [[-11, -15, -20], [11, -1, 20], [-11, 13, -20]].forEach(([dx, dy, r]) => ezeBlock.push(blockerAt(L.gut, transC[0] + dx, transC[1] + dy, r)));
  [[-13, -9, -20], [1, 7, 10], [15, -9, 25]].forEach(([dx, dy, r]) => pcskBlock.push(blockerAt(L.parts, pcskEnd[0] + dx, pcskEnd[1] + dy + 14, r)));
  for (let i = 0; i < 22; i++) { const g = mk("g", {}, L.parts); const c = mk("circle", { class: "sc-p p-vldl", r: 8 }, g); mk("circle", { class: "sc-p p-vldl", r: 2.4, cx: -2, cy: -2 }, g); lipos.push({ g, c, x: rnd(40, 920), y: 360, lane: rnd(-20, 20), mode: 0, sx: 0, sy: 0, tx: 0, ty: 0, i }); }
  for (let i = 0; i < 10; i++) { const e = mk("circle", { class: "sc-p p-hdl", r: 4.4 }, L.parts); hdls.push({ e, u: i / 10, i }); }
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["prod", "Liver making", "g-prod", "Cholesterol made in the liver. HMG-CoA reductase is the controlling enzyme; a statin blocks it."], ["abs", "Gut uptake", "g-fl", "Cholesterol absorbed from the gut. Ezetimibe blocks this uptake."], ["ldl", "Blood LDL", "g-ldl", "LDL cholesterol carried in the blood. High LDL drives cholesterol into artery walls."], ["rec", "Receptor uptake", "g-rec", "LDL receptors on the liver pulling LDL out of the blood. Faulty in familial hypercholesterolaemia."], ["hdl", "HDL return", "g-hdl", "HDL carrying cholesterol from peripheral tissues back to the liver: reverse cholesterol transport."], ["per", "Tissue load", "g-bad", "Cholesterol loaded into peripheral tissues. It rises when LDL is high and return is poor."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 52, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Gut", 110, 160, 105, 80, "Gut: takes up cholesterol from food and bile. Ezetimibe blocks this uptake.");
  pill(o, "Liver", 430, 140, 390, 80, "Liver: makes cholesterol and pulls LDL out of blood through LDL receptors.");
  pill(o, "Tissue", 790, 160, 790, 80, "Tissue: muscle outside the liver. LDL delivers cholesterol here and HDL collects the spare.");
  pill(o, "Cholesterol making", enzC[0], enzC[1], 200, 300, "Cholesterol making: the enzyme HMG-CoA reductase controls it. A statin blocks this step.");
  pill(o, "VLDL", prodStart[0], prodStart[1], 325, 300, "VLDL: the liver ships cholesterol out in VLDL. In blood VLDL turns into LDL.");
  pill(o, "LDL receptor", recXs[2], recY, 400, 303, "LDL receptor: catches LDL and pulls it into the liver. PCSK9 marks receptors for destruction.");
  pill(o, "LDL", 620, 358, 610, 300, "LDL: the main cholesterol carrier in blood. It delivers cholesterol to tissues; spare LDL is cleared by liver receptors.");
  pill(o, "HDL return", hdlStart[0], 352, 760, 300, "HDL return: HDL picks up spare cholesterol from tissue and carries it back to the liver.");
  capEl = mk("text", { class: "li-state", x: 30, y: 432 }, o); capEl.textContent = capText(0, 1);
}
function follow(pl, tr, dt, speed) {
  pl.forEach((p) => { if (!p.on) return; p.u += dt * speed; if (p.u >= 1) { kill(p); return; } const q = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
}
function showBlocks(list, v, i0) {
  list.forEach((b, i) => { b.g.setAttribute("opacity", v.toFixed(2)); place(b.b, b.x, b.y + Math.sin(tm / 500 + (i0 + i) * 1.3) * 1.5, b.rot, 1.3); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), famT = (m.R < 0.3 && m.a > 0.9) ? 1 : 0;
  sm.Prod = lerp(sm.Prod, m.Prod, k); sm.Abs = lerp(sm.Abs, m.Abs, k); sm.V = lerp(sm.V, m.V, k); sm.L = lerp(sm.L, m.L, k); sm.R = lerp(sm.R, m.R, k); sm.Hd = lerp(sm.Hd, m.Hd, k); sm.Per = lerp(sm.Per, m.Per, k); sm.Pk = lerp(sm.Pk, m.Pk, k);
  sm.statin = lerp(sm.statin, m.statin, k); sm.eze = lerp(sm.eze, m.eze, k); sm.pcsk9i = lerp(sm.pcsk9i, m.pcsk9i, k); sm.fam = lerp(sm.fam, famT, k);
  L.wash.setAttribute("opacity", (0.05 + 0.5 * sm.L * sm.L).toFixed(2));
  L.glow.setAttribute("opacity", (sm.Per * 0.4).toFixed(2));
  gutChol.forEach((c) => c.e.setAttribute("opacity", (c.i < 1 + sm.Abs * 4 ? 1 : 0.12).toFixed(2)));
  liverChol.forEach((c) => c.e.setAttribute("opacity", (c.i < 1 + sm.Prod * 5 ? 1 : 0.12).toFixed(2)));
  perChol.forEach((c) => c.e.setAttribute("opacity", (c.i < sm.Per * 8 ? 1 : 0.1).toFixed(2)));
  enzD.forEach((e) => e.setAttribute("opacity", (1 - 0.65 * sm.statin).toFixed(2)));
  transD.forEach((e) => e.setAttribute("opacity", (1 - 0.5 * sm.eze).toFixed(2)));
  vldlBlob.setAttribute("opacity", (0.25 + 0.75 * sm.V).toFixed(2));
  enzX.setAttribute("opacity", sm.statin.toFixed(2)); gutX.setAttribute("opacity", sm.eze.toFixed(2)); pcskX.setAttribute("opacity", sm.pcsk9i.toFixed(2)); famX.setAttribute("opacity", sm.fam.toFixed(2));
  recG.setAttribute("opacity", (0.3 + 0.7 * sm.R).toFixed(2));
  recPlus.setAttribute("opacity", Math.max(sm.statin, sm.pcsk9i).toFixed(2));
  showBlocks(statBlock, sm.statin, 0); showBlocks(ezeBlock, sm.eze, 3); showBlocks(pcskBlock, sm.pcsk9i, 6);
  acc.gut += dt * sm.Abs * 3.2; while (acc.gut >= 1) { acc.gut--; const p = free(gutP); if (p) emit(p, gutOutPt[0], gutOutPt[1], 0, 0, 0); }
  acc.prod += dt * sm.Prod * 3.4; while (acc.prod >= 1) { acc.prod--; const p = free(prodP); if (p) emit(p, prodStart[0], prodStart[1], 0, 0, 0); }
  acc.pcsk += dt * sm.Pk * 2.6; while (acc.pcsk >= 1) { acc.pcsk--; const p = free(pcskP); if (p) emit(p, pcskStartPt[0], pcskStartPt[1], 0, 0, 0); }
  follow(gutP, trGut, dt, 0.16); follow(prodP, trProd, dt, 0.15); follow(pcskP, trPcsk, dt, 0.22);
  const want = Math.round(4 + sm.L * 17);
  lipos.forEach((p, idx) => {
    const on = idx < want;
    if (p.mode === 0) {
      p.x += 46 * dt; if (p.x > 928) { p.x = 32; p.y = 360 + p.lane; }
      if (p.x > 395 && p.x < 445 && Math.random() < sm.R * dt * 1.4) { p.mode = 1; p.k = 0; p.sx = p.x; p.sy = 360 + p.lane; p.tx = recXs[1] + (idx % 4) * 25; p.ty = recY; }
      else if (p.x > 735 && p.x < 765 && Math.random() < sm.Per * dt * 1.1) { p.mode = 1; p.k = 0; p.sx = p.x; p.sy = 360 + p.lane; p.tx = 730 + (idx % 4) * 20; p.ty = 252; }
      const isL = p.x > 560 || p.x < 330, sc = on ? (isL ? 0.62 : 1) : 0.001;
      p.c.setAttribute("class", "sc-p " + (isL ? "p-ldl" : "p-vldl")); place(p.g, p.x, 360 + p.lane, 0, sc);
    } else {
      p.k = Math.min(1, p.k + dt * 0.55);
      place(p.g, lerp(p.sx, p.tx, p.k), lerp(p.sy, p.ty, p.k), 0, on ? 0.62 : 0.001);
      if (p.k >= 1) { p.mode = 0; p.x = 335; p.y = 360 + p.lane; }
    }
    p.g.style.opacity = on ? 1 : 0;
  });
  hdls.forEach((p) => { p.u += dt * 0.055 * (0.4 + sm.Hd); if (p.u > 1) p.u -= 1; const q = trHdl.at(p.u), vis = p.i < 2 + sm.Hd * 8; p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", vis ? "1" : "0"); });
  gg.prod.set(sm.Prod, wordOf(sm.Prod, 0.3, 0.55, ["low", "usual", "high"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.25, 0.45, ["low", "usual", "high"]));
  gg.ldl.set(sm.L, wordOf(sm.L, 0.35, 0.9, ["low", "raised", "high"])); gg.rec.set(sm.R, wordOf(sm.R, 0.25, 0.6, ["very low", "reduced", "good"]));
  gg.hdl.set(sm.Hd, wordOf(sm.Hd, 0.42, 0.52, ["low", "usual", "good"])); gg.per.set(sm.Per, wordOf(sm.Per, 0.3, 0.7, ["low", "raised", "high"]));
  const key = drug * 3 + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
function init() { initNodes(); initPanel(); }
run({ init, step });
