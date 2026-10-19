/* Onc-5fu scene: FdUMP plus folate locks thymidylate synthase and starves tumour DNA of thymidine (left);
 * heart, marrow, gut, skin and liver DPD show the side effects (right). */
const CCX = 240, CCY = 252;
const TSX = 205, TSY = 295;
const L = { tum: $("tum"), fu: $("fu"), fol: $("fol"), tmp: $("tmp"), frag: $("frag"), heartSlot: $("heartSlot"), heartFx: $("heartFx"), mar: $("mar"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), skinSlot: $("skinSlot"), skinFx: $("skinFx"), livSlot: $("livSlot"), livFx: $("livFx"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, tsG = null, fdLodge = null, folDot = null, lockBar = null, xMark = null, rnaFlash = null, dnaFlash = null;
let heartO = null, corT = null, corB = null, spasm = null, gutTint = null, skinTint = null, capEl = null, capKey = "";
let rungs = [], cracks = [], rnaBad = [], marCells = [], sores = [], blisters = [], dpdDots = [], gg = {};
let fuP, folP, tmpP, debP, incP, sloP, peelP, corP, livP;
function capText(d, l) {
  if (d === 0) return "No treatment. The tumour keeps growing and none of the drug harms appear.";
  if (d === 2 && l === 0) return "DPD deficiency, early course. The liver cannot clear the drug, so severe gut and marrow harm strikes early.";
  if (d === 2 && l === 1) return "DPD deficiency, middle course. The drug floods the body with overwhelming gut, marrow, skin and heart harm.";
  if (d === 2) return "DPD deficiency, late course. Without DPD clearance every harm keeps building to life threatening levels.";
  if (d === 3 && l === 0) return "Early course with leucovorin. Extra folate tightens the TS lock, so kill starts faster with more gut harm.";
  if (d === 3 && l === 1) return "Middle course with leucovorin. A stronger TS block shrinks the tumour faster, but gut and marrow harm is worse.";
  if (d === 3) return "Late course with leucovorin. The tumour is controlled through a locked TS, with severe gut and marrow harm.";
  if (l === 0) return "Early course. FdUMP starts to lock thymidylate synthase, and early gut and marrow harm appears.";
  if (l === 1) return "Middle course. Tumour DNA starves of thymidine as the tumour shrinks, while gut, marrow and skin harm builds.";
  return "Late course. Most tumour cells are dead, but gut, marrow, skin and heart harm is high after repeated courses.";
}
function nodeText(parent, text, x, y, cls) { const t = mk("text", { class: cls || "fu-node", x, y, "text-anchor": "middle" }, parent); t.textContent = text; return t; }
function init() {
  /* ---- tumour cell with TS enzyme, DNA and RNA ---- */
  tumG = cell(L.tum, { cls: "graft", r: 108, seed: 3, wob: 0.07, n: 10 });
  tsG = mk("g", { class: "fu-ts", transform: "translate(" + TSX + " " + TSY + ")" }, L.tum);
  mk("rect", { class: "fu-jaw", x: -16, y: -16, width: 38, height: 11, rx: 5 }, tsG);
  mk("rect", { class: "fu-jaw", x: -16, y: 5, width: 38, height: 11, rx: 5 }, tsG);
  mk("rect", { class: "fu-jaw", x: 11, y: -16, width: 11, height: 32, rx: 4 }, tsG);
  fdLodge = mk("path", { class: "sc-p fu-fd", d: "M0 -5L5 4L-5 4Z", transform: "translate(-6 0)", opacity: "0" }, tsG);
  folDot = mk("path", { class: "sc-p fu-fol", d: "M0 -4L4 0L0 4L-4 0Z", transform: "translate(4 0)", opacity: "0" }, tsG);
  lockBar = mk("rect", { class: "fu-lock", x: -21, y: -9, width: 6, height: 18, rx: 3, opacity: "0" }, tsG);
  nodeText(L.tum, "thymidylate synthase", TSX, TSY + 33);
  let d1 = "", d2 = "";
  for (let y = 200; y <= 300; y += 4) { const ph = (y - 200) / 100 * Math.PI * 2, x1 = 292 + 2.5 * Math.sin(ph), x2 = 308 - 2.5 * Math.sin(ph); d1 += (y === 200 ? "M" : "L") + f1(x1) + " " + y; d2 += (y === 200 ? "M" : "L") + f1(x2) + " " + y; }
  mk("path", { class: "fu-dna", d: d1 }, L.tum); mk("path", { class: "fu-dna", d: d2 }, L.tum);
  for (let y = 208; y <= 292; y += 12) { const ph = (y - 200) / 100 * Math.PI * 2; rungs.push(mk("path", { class: "fu-rung", d: "M" + f1(292 + 2.5 * Math.sin(ph)) + " " + y + "L" + f1(308 - 2.5 * Math.sin(ph)) + " " + y }, L.tum)); }
  [[300, 232], [300, 258], [300, 284]].forEach(([x, y]) => cracks.push(mk("path", { class: "fu-crack", d: "M" + (x - 5) + " " + (y - 5) + "L" + (x + 5) + " " + (y + 5) + "M" + (x + 5) + " " + (y - 5) + "L" + (x - 5) + " " + (y + 5), opacity: "0" }, L.tum)));
  dnaFlash = mk("circle", { class: "fu-flash", cx: 300, cy: 250, r: 12, opacity: "0" }, L.tum);
  nodeText(L.tum, "DNA", 300, 316);
  const ry = (x) => 195 + 4 * Math.sin((x - 170) / 110 * Math.PI * 3);
  let rd = "";
  for (let x = 170; x <= 280; x += 4) rd += (x === 170 ? "M" : "L") + f1(x) + " " + f1(ry(x));
  mk("path", { class: "fu-rna", d: rd }, L.tum);
  [180, 200, 220, 240, 260].forEach((x) => mk("rect", { class: "fu-rnablok", x: x - 4, y: f1(ry(x) - 3.5), width: 8, height: 7, rx: 2 }, L.tum));
  [190, 230, 270].forEach((x) => rnaBad.push(mk("rect", { class: "fu-rnabad", x: x - 4, y: f1(ry(x) - 3.5), width: 8, height: 7, rx: 2, opacity: "0" }, L.tum)));
  rnaFlash = mk("circle", { class: "fu-flash", cx: 225, cy: 195, r: 9, opacity: "0" }, L.tum);
  nodeText(L.tum, "RNA", 180, 212);
  mk("path", { class: "fu-arrow", d: "M232 295L282 295M282 295L274 291M282 295L274 299" }, L.tum);
  xMark = mk("path", { class: "fu-x", d: "M253 289L265 301M265 289L253 301", opacity: "0" }, L.tum);
  fuP = pool(12, () => mk("circle", { class: "sc-p fu-fu", r: 3 }, L.fu));
  folP = pool(12, () => mk("path", { class: "sc-p fu-fol", d: "M0 -3.5L3.5 0L0 3.5L-3.5 0Z" }, L.fol));
  tmpP = pool(8, () => mk("circle", { class: "sc-p fu-tmp", r: 2.4 }, L.tmp));
  debP = pool(14, () => mk("circle", { class: "sc-p fu-deb", r: 2.5 }, L.frag));
  incP = pool(8, () => mk("circle", { class: "sc-p fu-inc", r: 2.6 }, L.frag));
  /* ---- heart with a coronary artery that spasms ---- */
  heartO = organ(L.heartSlot, "heart", 610, 190, 150, { h: 155 });
  corT = mk("path", { class: "fu-cor", d: "M560 193 Q610 193 660 193" }, L.heartFx);
  corB = mk("path", { class: "fu-cor", d: "M560 207 Q610 207 660 207" }, L.heartFx);
  spasm = mk("path", { class: "fu-spasm", d: "M0 -8L2 -2L8 0L2 2L0 8L-2 2L-8 0L-2 -2Z", transform: "translate(610 200)", opacity: "0" }, L.heartFx);
  corP = pool(6, () => mk("circle", { class: "fu-corfl", r: 2.5 }, L.heartFx));
  corP.forEach((p, i) => { emit(p, 560 + i * 17, 200 + rnd(-3, 3), 0, 0, 0); });
  /* ---- marrow: bone with red cavity and precursor cells ---- */
  mk("circle", { class: "fu-bone", cx: 790, cy: 170, r: 28 }, L.mar);
  mk("circle", { class: "fu-bone", cx: 890, cy: 170, r: 28 }, L.mar);
  mk("rect", { class: "fu-bone", x: 796, y: 144, width: 88, height: 52, rx: 10 }, L.mar);
  mk("rect", { class: "fu-cav", x: 808, y: 154, width: 64, height: 32, rx: 16 }, L.mar);
  for (let i = 0; i < 12; i++) { const e = mk("circle", { class: "fu-mar", cx: 0, cy: 0, r: 4 }, L.mar); marCells.push({ e, x: 816 + (i % 6) * 10.4 + rnd(-1.5, 1.5), y: 161 + Math.floor(i / 6) * 11 + rnd(-1.5, 1.5), s: 1 }); }
  /* ---- gut, skin and liver DPD ---- */
  organ(L.gutSlot, "bowel", 605, 350, 140, { h: 80 });
  gutTint = mk("ellipse", { class: "fu-gut", cx: 605, cy: 350, rx: 58, ry: 30, opacity: "0" }, L.gutFx);
  [[580, 340], [600, 358], [622, 342], [640, 356]].forEach(([x, y]) => sores.push(mk("circle", { class: "fu-sore", cx: x, cy: y, r: 3, opacity: "0" }, L.gutFx)));
  sloP = pool(8, () => mk("circle", { class: "sc-p fu-slough", r: 2.2 }, L.gutFx));
  organ(L.skinSlot, "skin", 775, 350, 105, { h: 80 });
  skinTint = mk("ellipse", { class: "fu-skintint", cx: 775, cy: 350, rx: 45, ry: 32, opacity: "0" }, L.skinFx);
  [[755, 340], [768, 352], [782, 342], [795, 354], [760, 362]].forEach(([x, y]) => blisters.push(mk("circle", { class: "fu-blis", cx: x, cy: y, r: 2.5, opacity: "0" }, L.skinFx)));
  peelP = pool(8, () => mk("circle", { class: "sc-p fu-peel", r: 2 }, L.skinFx));
  organ(L.livSlot, "liver", 890, 348, 78, { h: 70 });
  [[872, 340], [884, 352], [896, 340], [906, 354]].forEach(([x, y]) => dpdDots.push(mk("circle", { class: "fu-dpd", cx: x, cy: y, r: 2.5 }, L.livFx)));
  livP = pool(8, () => mk("circle", { class: "fu-livfl", r: 2.2 }, L.livFx));
  const livCap = nodeText(L.livFx, "liver DPD", 890, 400, "hot fu-node2");
  livCap.setAttribute("tabindex", "0");
  livCap.setAttribute("data-info", "DPD in the liver breaks down most fluorouracil before it can act. With DPD deficiency the drug floods the body and severe toxicity strikes in the first course.");
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "5-FU", 60, 270, 70, 120, "Fluorouracil enters cells and is converted to FdUMP, the active form that locks thymidylate synthase with folate.");
  pill(o, "Thymidylate synthase", 215, 283, 330, 110, "Thymidylate synthase makes thymidine building blocks for DNA. FdUMP plus folate locks it in a stuck three part complex, so no thymidine is made.");
  pill(o, "Starved DNA", 300, 250, 395, 180, "Without thymidine the tumour DNA breaks as it is copied, and faulty drug blocks built into RNA and DNA add to the kill.");
  const leucoPill = pill(o, "Leucovorin", 215, 180, 120, 180, "Leucovorin adds folate that tightens the FdUMP lock on the enzyme, strengthening tumour kill and gut harm together.");
  leucoPill.setAttribute("id", "leuco-pill");
  pill(o, "Heart", 610, 255, 560, 292, "Coronary vasospasm. The drug can make coronary arteries clamp down, starving heart muscle of blood and causing chest pain.");
  pill(o, "Bone marrow", 840, 200, 840, 250, "Myelosuppression. Marrow precursors divide fast like tumour cells, so the drug kills them and blood counts fall.");
  pill(o, "Gut lining", 605, 385, 560, 418, "Mucositis and diarrhoea. The fast dividing lining of the mouth and gut is injured like the tumour, giving sores and diarrhoea.");
  pill(o, "Hands and feet", 775, 385, 740, 418, "Hand-foot syndrome. The drug injures skin of the palms and soles, giving painful redness, swelling and peeling.");
  capEl = mk("text", { class: "fu-cap", x: 30, y: 449 }, o); capEl.textContent = capText(drug, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. FdUMP plus folate locks thymidylate synthase so no thymidine is made, and faulty drug blocks built into RNA and DNA add to the kill."],
    ["gut", "Gut lining", "g-eos", "Mucositis and diarrhoea. The fast dividing lining of the mouth and gut is injured like the tumour. Leucovorin strengthens this harm too."],
    ["mar", "Marrow", "g-cyt", "Myelosuppression. Dividing marrow precursors are killed along with the tumour, so red cells, white cells and platelets fall."],
    ["skin", "Hands and feet", "g-bad", "Hand-foot syndrome. The drug injures skin of the palms and soles, giving painful redness, swelling and peeling that builds with each course."],
    ["heart", "Heart spasm", "g-neu", "Coronary vasospasm. The drug can make coronary arteries clamp down and starve heart muscle of blood, causing chest pain during or soon after treatment."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 175, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, B: 0.4, Gu: 0.3, Mr: 0.3, Sk: 0.15, Ht: 0.2, on: 0, leuco: 0, dpd: 0 };
const acc = { fu: 0, fol: 0, tmp: 0, inc: 0, deb: 0, slo: 0, peel: 0, liv: 0 };
let rnaFl = 0, dnaFl = 0;
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.B = lerp(sm.B, m.B, k); sm.Gu = lerp(sm.Gu, m.Gu, k); sm.Mr = lerp(sm.Mr, m.Mr, k);
  sm.Sk = lerp(sm.Sk, m.Sk, k); sm.Ht = lerp(sm.Ht, m.Ht, k); sm.on = lerp(sm.on, m.on, k); sm.leuco = lerp(sm.leuco, m.leuco, k); sm.dpd = lerp(sm.dpd, m.dpd, k);
  /* tumour cell grows without treatment, shrinks with kill */
  const cs = (1 - 0.08 * sm.K * sm.on + (1 - sm.on) * 0.05) * (1 + 0.015 * Math.sin(tm / 700));
  place(tumG, CCX, CCY, 0, cs);
  /* TS locks when FdUMP and folate lodge: enzyme turns red, dTMP stops */
  tsG.setAttribute("class", sm.B > 0.5 ? "fu-ts locked" : "fu-ts");
  fdLodge.setAttribute("opacity", sm.B.toFixed(2));
  folDot.setAttribute("opacity", sm.B.toFixed(2));
  lockBar.setAttribute("opacity", sm.B > 0.35 ? sm.B.toFixed(2) : "0");
  xMark.setAttribute("opacity", sm.B.toFixed(2));
  rungs.forEach((r, i) => r.setAttribute("opacity", sm.B > 0.3 + i * 0.07 ? "0.25" : "1"));
  cracks.forEach((c) => c.setAttribute("opacity", (sm.B * 0.9).toFixed(2)));
  rnaBad.forEach((b) => b.setAttribute("opacity", (sm.K * sm.on).toFixed(2)));
  /* 5-FU enters and converts to FdUMP inside the cell */
  acc.fu += dt * sm.on * (m.dpd ? 7 : 4);
  while (acc.fu >= 1) { acc.fu--; const p = free(fuP); if (p) { emit(p, rnd(20, 40), rnd(250, 290), 0, 0, 0); p.e.setAttribute("class", "sc-p fu-fu"); } }
  fuP.forEach((p) => {
    if (!p.on) return;
    if (p.x < 150) { p.x += (m.dpd ? 85 : 60) * dt; p.y += Math.sin(tm / 300 + p.y) * 0.2; }
    else {
      if (p.st === 1) { p.st = 2; p.e.setAttribute("class", "sc-p fu-fd"); }
      const dx = 190 - p.x, dy = 280 - p.y, d = Math.hypot(dx, dy) || 1, v = 70 * dt, s = Math.min(v, d);
      p.x += dx / d * s; p.y += dy / d * s;
      if (d < 7) { kill(p); return; }
    }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x > 466 || p.y < 48 || p.y > 436) kill(p);
  });
  /* folate drifts down into the enzyme; leucovorin sends much more */
  acc.fol += dt * (0.8 + sm.on * 1.2 + sm.leuco * 4);
  while (acc.fol >= 1) { acc.fol--; const p = free(folP); if (p) emit(p, rnd(198, 232), 150, 0, 0, 0); }
  folP.forEach((p) => {
    if (!p.on) return;
    const dx = 207 - p.x, dy = 293 - p.y, d = Math.hypot(dx, dy) || 1, v = 55 * dt, s = Math.min(v, d);
    p.x += dx / d * s; p.y += dy / d * s;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")");
    if (d < 6) kill(p);
  });
  /* dTMP flows from the enzyme to DNA until the block stops it */
  acc.tmp += dt * (0.3 + 3.2 * (1 - sm.B));
  while (acc.tmp >= 1) { acc.tmp--; const p = free(tmpP); if (p) emit(p, 234, 295, 60, 0, 0); }
  tmpP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 286) kill(p); });
  /* faulty drug blocks embed into RNA and DNA */
  acc.inc += dt * sm.on * sm.K * 5;
  while (acc.inc >= 1) { acc.inc--; const p = free(incP); if (p) { const toRna = Math.random() < 0.5; emit(p, rnd(150, 180), rnd(230, 270), 0, 0, toRna ? 1 : 0); p.tx = toRna ? rnd(185, 270) : 300; p.ty = toRna ? 195 : rnd(215, 285); } }
  incP.forEach((p) => {
    if (!p.on) return;
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1, v = 80 * dt, s = Math.min(v, d);
    p.x += dx / d * s; p.y += dy / d * s;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 5) { kill(p); if (p.k === 1) rnaFl = 1; else dnaFl = 1; }
  });
  rnaFl = Math.max(0, rnaFl - dt * 2); dnaFl = Math.max(0, dnaFl - dt * 2);
  rnaFlash.setAttribute("opacity", rnaFl.toFixed(2)); dnaFlash.setAttribute("opacity", dnaFl.toFixed(2));
  /* debris from dying tumour cells */
  acc.deb += dt * sm.K * sm.on * 7;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, CCX + Math.cos(a) * 104, CCY + Math.sin(a) * 104, Math.cos(a) * 24, Math.sin(a) * 24, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* heart beats; the coronary artery pinches in spasm and flow slows */
  place(heartO.g, 610, 190, 0, 1 + 0.028 * Math.sin(tm / 430));
  const cyc = 0.5 + 0.5 * Math.sin(tm / 1100);
  const pinch = clamp(sm.Ht * (0.35 + 0.65 * cyc));
  corT.setAttribute("d", "M560 193 Q610 " + f1(193 + pinch * 6.5) + " 660 193");
  corB.setAttribute("d", "M560 207 Q610 " + f1(207 - pinch * 6.5) + " 660 207");
  spasm.setAttribute("opacity", pinch > 0.55 ? ((pinch - 0.55) * 2).toFixed(2) : "0");
  corP.forEach((p) => { p.x += (26 + 54 * (1 - pinch)) * dt; if (p.x > 660) p.x = 560; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* marrow precursors deplete */
  const mwant = Math.round(12 * (1 - sm.Mr * 0.9));
  marCells.forEach((c, i) => { c.s = lerp(c.s, i < mwant ? 1 : 0, Math.min(1, dt * 2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(4 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  /* gut reddens, sores appear and lining sheds */
  gutTint.setAttribute("opacity", (sm.Gu * 0.55).toFixed(2));
  sores.forEach((s) => s.setAttribute("opacity", sm.Gu > 0.3 ? (sm.Gu * 0.9).toFixed(2) : "0"));
  acc.slo += dt * sm.Gu * 6;
  while (acc.slo >= 1) { acc.slo--; const p = free(sloP); if (p) emit(p, rnd(555, 655), 382, rnd(-4, 4), rnd(25, 40), 0); }
  sloP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 428) kill(p); });
  /* skin of palms and soles reddens, blisters and peels */
  skinTint.setAttribute("opacity", (sm.Sk * 0.5).toFixed(2));
  blisters.forEach((b) => b.setAttribute("opacity", sm.Sk > 0.2 ? (sm.Sk * 0.95).toFixed(2) : "0"));
  acc.peel += dt * sm.Sk * 5;
  while (acc.peel >= 1) { acc.peel--; const p = free(peelP); if (p) emit(p, rnd(735, 815), 384, rnd(-4, 4), rnd(20, 32), 0); }
  peelP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 428) kill(p); });
  /* liver DPD clears the drug; in deficiency the drug floods past */
  dpdDots.forEach((d, i) => d.setAttribute("opacity", sm.dpd > 0.5 ? "0" : (0.55 + 0.4 * Math.sin(tm / 400 + i * 1.7)).toFixed(2)));
  acc.liv += dt * sm.on * (m.dpd ? 6 : 3.5);
  while (acc.liv >= 1) { acc.liv--; const p = free(livP); if (p) emit(p, 845, rnd(335, 360), m.dpd ? 70 : 45, 0, 0); }
  livP.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt;
    p.e.setAttribute("opacity", m.dpd ? "1" : clamp(1 - (p.x - 862) / 38).toFixed(2));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x > (m.dpd ? 942 : 904)) kill(p);
  });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  const lp = $("leuco-pill");
  lp.style.opacity = sm.leuco.toFixed(2); lp.style.visibility = sm.leuco > 0.05 ? "visible" : "hidden";
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.gut.set(sm.Gu, wordOf(sm.Gu, 0.3, 0.6, ["ok", "sore", "severe"]));
  gg.mar.set(sm.Mr, wordOf(sm.Mr, 0.3, 0.65, ["ok", "low", "very low"])); gg.skin.set(sm.Sk, wordOf(sm.Sk, 0.25, 0.5, ["ok", "red", "peeling"]));
  gg.heart.set(sm.Ht, wordOf(sm.Ht, 0.25, 0.6, ["calm", "spasm", "severe"]));
}
run({ init, step });
