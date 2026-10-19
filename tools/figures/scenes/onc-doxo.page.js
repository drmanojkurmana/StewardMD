/* Onc-doxo scene: doxorubicin wedges into tumour DNA and traps topoisomerase II (left);
 * heart, marrow, gut, skin and urine show the side effects and dexrazoxane protection (right). */
const TCX = 235, TCY = 235;
const HX = 625, HY = 185;
const L = { tum: $("tum"), dox: $("dox"), frag: $("frag"), heartSlot: $("heartSlot"), heartFx: $("heartFx"), mar: $("mar"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), skinSlot: $("skinSlot"), skinFx: $("skinFx"), kidSlot: $("kidSlot"), urine: $("urine"), over: $("over"), panel: $("panel") };
const SLOTS = [192, 210, 228, 246, 264, 282].map((y, i) => [TCX + (i % 2 ? 7 : -7), y]);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, flash = null, heartO = null, dil = null, ring = null, gutTint = null, blotch = null, necro = null, capEl = null, capKey = "";
let topo = [], marCells = [], hairs = [], gg = {};
let doxP, debP, radP, dxrP, sloP, uriP;
function capText(d, l) {
  if (d === 0) return "No treatment. The tumour grows unchecked and no drug harm builds.";
  if (d === 2 && l === 0) return "Early course with dexrazoxane. Tumour kill proceeds while the heart is shielded from radical damage.";
  if (d === 2 && l === 1) return "Middle course with dexrazoxane. The tumour shrinks and heart damage stays low, but marrow, gut and hair harm continues.";
  if (d === 2) return "Late course with dexrazoxane. The tumour is controlled with the heart protected; other side effects still need care.";
  if (l === 0) return "Early course. Doxorubicin wedges into tumour DNA and traps topoisomerase II; tumour cells begin to die.";
  if (l === 1) return "Middle course. Tumour kill builds and early heart, marrow, gut and hair harm appears.";
  return "Late course. Most tumour cells are dead but cumulative radical damage has strained the heart toward failure.";
}
function init() {
  /* ---- tumour cell, DNA helix, topoisomerase II ---- */
  tumG = cell(L.tum, { cls: "graft", r: 105, nuc: 0.57, seed: 3, wob: 0.07, n: 10 });
  let d1 = "", d2 = "";
  for (let y = 182; y <= 288; y += 4) { const ph = (y - 182) / 106 * Math.PI * 3, x1 = TCX + 13 * Math.sin(ph), x2 = TCX - 13 * Math.sin(ph); d1 += (y === 182 ? "M" : "L") + f1(x1) + " " + y; d2 += (y === 182 ? "M" : "L") + f1(x2) + " " + y; }
  mk("path", { class: "dx-dna", d: d1 }, L.tum); mk("path", { class: "dx-dna", d: d2 }, L.tum);
  let rg = "";
  for (let y = 188; y <= 282; y += 12) { const ph = (y - 182) / 106 * Math.PI * 3, x1 = TCX + 13 * Math.sin(ph), x2 = TCX - 13 * Math.sin(ph); rg += "M" + f1(x1) + " " + y + "L" + f1(x2) + " " + y; }
  mk("path", { class: "dx-rung", d: rg }, L.tum);
  topo = [[219, 212, 0], [251, 258, 2.1]].map(([x, y, ph]) => { const g = mk("g", { class: "dx-topo" }, L.tum); mk("path", { class: "dx-tl", d: "M-8 0L8 0" }, g); mk("circle", { class: "dx-tb", cx: -8, cy: 0, r: 7 }, g); mk("circle", { class: "dx-tb", cx: 8, cy: 0, r: 7 }, g); return { g, x, y, ph }; });
  flash = mk("path", { class: "dx-flash", d: "M228 218L240 230L230 233L243 250", opacity: "0" }, L.tum);
  doxP = pool(14, () => mk("path", { class: "sc-p dx-wedge", d: "M0 -4.5L4.5 3L-4.5 3Z" }, L.dox));
  debP = pool(14, () => mk("circle", { class: "sc-p dx-deb", r: 2.5 }, L.frag));
  /* ---- heart with dilation outline and shield ring ---- */
  heartO = organ(L.heartSlot, "heart", HX, HY, 170, { h: 175 });
  dil = mk("ellipse", { class: "dx-dil", cx: HX, cy: HY, rx: 88, ry: 80, opacity: "0" }, L.heartFx);
  ring = mk("ellipse", { class: "dx-shield", cx: HX, cy: HY, rx: 84, ry: 76, opacity: "0" }, L.heartFx);
  radP = pool(22, () => mk("path", { class: "sc-p dx-rad", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, L.heartFx));
  dxrP = pool(10, () => mk("circle", { class: "sc-p dx-dxr", r: 3 }, L.heartFx));
  /* ---- marrow: bone with red cavity and precursor cells ---- */
  mk("circle", { class: "dx-bone", cx: 780, cy: 165, r: 30 }, L.mar);
  mk("circle", { class: "dx-bone", cx: 896, cy: 165, r: 30 }, L.mar);
  mk("rect", { class: "dx-bone", x: 786, y: 138, width: 104, height: 54, rx: 10 }, L.mar);
  mk("rect", { class: "dx-cav", x: 798, y: 148, width: 80, height: 34, rx: 17 }, L.mar);
  for (let i = 0; i < 12; i++) { const e = mk("circle", { class: "dx-mar", cx: 0, cy: 0, r: 4.5 }, L.mar); marCells.push({ e, x: 808 + (i % 6) * 12.8 + rnd(-2, 2), y: 157 + Math.floor(i / 6) * 12 + rnd(-2, 2), s: 1 }); }
  /* ---- gut, skin with hairs and blotch, kidney with red urine ---- */
  organ(L.gutSlot, "bowel", 612, 345, 150, { h: 85 });
  gutTint = mk("ellipse", { class: "dx-gut", cx: 612, cy: 345, rx: 62, ry: 34, opacity: "0" }, L.gutFx);
  sloP = pool(10, () => mk("circle", { class: "sc-p dx-slough", r: 2.2 }, L.gutFx));
  organ(L.skinSlot, "skin", 795, 345, 115, { h: 85 });
  blotch = mk("ellipse", { class: "dx-blotch", cx: 795, cy: 358, rx: 6, ry: 5, opacity: "0" }, L.skinFx);
  necro = mk("ellipse", { class: "dx-necro", cx: 795, cy: 358, rx: 3, ry: 2.5, opacity: "0" }, L.skinFx);
  for (let i = 0; i < 6; i++) { const e = mk("rect", { class: "dx-hair", x: -1.25, y: -22, width: 2.5, height: 22, rx: 1 }, L.skinFx); hairs.push({ e, x: 752 + i * 17, s: 0 }); }
  organ(L.kidSlot, "kidney", 902, 335, 62, { h: 85 });
  uriP = pool(8, () => mk("circle", { class: "dx-urine", r: 2.6 }, L.urine));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Doxorubicin", 55, 240, 78, 118, "Doxorubicin, a red anthracycline drug. It enters cells, wedges between DNA base pairs and traps topoisomerase II, and in the heart it also makes free radicals with iron.");
  pill(o, "Topoisomerase II", 251, 258, 382, 112, "Topoisomerase II untangles DNA so it can be copied. Doxorubicin traps it on the DNA and the stuck complex breaks the genome.");
  pill(o, "Tumour DNA", 235, 290, 235, 388, "Tumour DNA, the drug target. Wedged drug plus trapped topoisomerase II stops the genome being copied, so the tumour cell dies.");
  pill(o, "Heart", 625, 250, 640, 288, "Anthracycline cardiomyopathy. In heart muscle the drug plus iron makes free radicals and poisons topoisomerase II beta in mitochondria; the ventricle dilates and fails. Damage builds with each course.");
  pill(o, "Bone marrow", 838, 197, 838, 258, "Myelosuppression. Marrow precursors divide fast like tumour cells, so the drug kills them and blood counts fall until the marrow recovers.");
  pill(o, "Gut lining", 612, 380, 560, 414, "Mucositis. The fast dividing gut lining is injured, giving mouth sores and diarrhoea.");
  pill(o, "Skin", 795, 385, 758, 414, "Extravasation necrosis. Drug leaking from the vein during infusion burns the skin and soft tissue, which can ulcerate and die.");
  pill(o, "Red urine", 918, 396, 872, 414, "Red urine. The red drug colours the urine for a day or so; it is harmless and is not blood or kidney damage.");
  capEl = mk("text", { class: "dx-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. Doxorubicin wedges between DNA base pairs and traps topoisomerase II on the DNA, so the cell cannot copy its genome and dies."],
    ["heart", "Heart damage", "g-bad", "Cumulative heart muscle damage. In cardiomyocytes the drug cycles with iron to make free radicals and also poisons topoisomerase II beta in mitochondria; the ventricle dilates and fails. Dexrazoxane chelates iron and blocks this."],
    ["marrow", "Marrow", "g-cyt", "Myelosuppression. Dividing marrow precursors are killed along with the tumour, so red cells, white cells and platelets fall."],
    ["gut", "Gut lining", "g-eos", "Mucositis. The fast dividing gut lining is damaged, giving mouth sores, diarrhoea and poor absorption."],
    ["hair", "Hair loss", "g-neu", "Alopecia. Hair matrix cells divide fast and are killed, so hair falls out; it regrows after treatment ends."],
    ["skin", "Skin injury", "g-clot", "Extravasation necrosis. Drug leaking from the vein during infusion kills the surrounding skin and soft tissue."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Ht: 0.3, Mr: 0.3, Gu: 0.2, Ha: 0.2, Sk: 0.05, on: 0, dxr: 0 };
const acc = { dox: 0, deb: 0, rad: 0, dxr: 0, slo: 0, uri: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Ht = lerp(sm.Ht, m.Ht, k); sm.Mr = lerp(sm.Mr, m.Mr, k); sm.Gu = lerp(sm.Gu, m.Gu, k);
  sm.Ha = lerp(sm.Ha, m.Ha, k); sm.Sk = lerp(sm.Sk, m.Sk, k); sm.on = lerp(sm.on, m.on, k); sm.dxr = lerp(sm.dxr, m.dxr, k);
  /* tumour cell pulses, grows without treatment, shrinks with kill */
  const cs = (1 - 0.1 * sm.K * sm.on + (1 - sm.on) * 0.06) * (1 + 0.015 * Math.sin(tm / 700));
  place(tumG, TCX, TCY, 0, cs);
  /* wedges fly in and lodge between base pairs; they leave when treatment stops */
  const want = m.on ? 6 : 0;
  let n = 0, lodged = 0;
  doxP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; if (p.on && p.st === 2) lodged++; });
  acc.dox += dt * m.on * 2.4;
  while (acc.dox >= 1) { acc.dox--; if (n < want) { const p = free(doxP); if (p) { const used = {}; doxP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 6) si++; emit(p, rnd(20, 50), rnd(190, 290), 0, 0, si % 6); n++; } } }
  if (n > want) { const p = doxP.find((q) => q.on && q.st === 2) || doxP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  doxP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = SLOTS[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 110 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 47) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.k * 30) + ")");
    else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  /* topo II traps when wedges lodge: turns red and freezes */
  const trapped = lodged >= 3;
  topo.forEach((tp) => { tp.g.setAttribute("class", trapped ? "dx-topo trapped" : "dx-topo");
    place(tp.g, tp.x, tp.y + Math.sin(tm / 900 + tp.ph) * 3 * (trapped ? 0.3 : 1), Math.sin(tm / 1200 + tp.ph) * 8 * (trapped ? 0 : 1), 1); });
  flash.setAttribute("opacity", (sm.on * sm.K > 0.15 && Math.sin(tm / 110) > 0.55) ? (0.85 * sm.K).toFixed(2) : "0");
  /* debris from dying tumour cells */
  acc.deb += dt * sm.K * sm.on * 8;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * 100, TCY + Math.sin(a) * 100, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* heart beats, dilates with damage, gains a shield with dexrazoxane */
  place(heartO.g, HX, HY, 0, 1 + 0.028 * Math.sin(tm / 430) * (1 - 0.5 * sm.Ht));
  dil.setAttribute("rx", f1(88 + 12 * sm.Ht)); dil.setAttribute("ry", f1(80 + 10 * sm.Ht)); dil.setAttribute("opacity", (0.15 + 0.55 * sm.Ht).toFixed(2));
  ring.setAttribute("opacity", sm.dxr.toFixed(2));
  acc.rad += dt * sm.Ht * 16;
  while (acc.rad >= 1) { acc.rad--; const p = free(radP); if (p) emit(p, HX + rnd(-60, 60), HY + rnd(-53, 53), rnd(-6, 6), rnd(-6, 6), 0); }
  radP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ") scale(" + (0.6 + p.t).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  acc.dxr += dt * sm.dxr * 5;
  while (acc.dxr >= 1) { acc.dxr--; const p = free(dxrP); if (p) emit(p, 940, rnd(215, 245), -80, 0, 0); }
  dxrP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 712) kill(p); });
  /* marrow precursors deplete */
  const mwant = Math.round(12 * (1 - sm.Mr * 0.9));
  marCells.forEach((c, i) => { c.s = lerp(c.s, i < mwant ? 1 : 0, Math.min(1, dt * 2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(4.5 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  /* gut reddens and sheds */
  gutTint.setAttribute("opacity", (sm.Gu * 0.55).toFixed(2));
  acc.slo += dt * sm.Gu * 6;
  while (acc.slo >= 1) { acc.slo--; const p = free(sloP); if (p) emit(p, rnd(560, 664), 382, rnd(-4, 4), rnd(25, 40), 0); }
  sloP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 428) kill(p); });
  /* skin blotch grows with a necrotic centre; hairs shed */
  blotch.setAttribute("rx", f1(6 + 26 * sm.Sk)); blotch.setAttribute("ry", f1(5 + 16 * sm.Sk)); blotch.setAttribute("opacity", sm.Sk > 0.02 ? "0.75" : "0");
  necro.setAttribute("rx", f1((6 + 26 * sm.Sk) * 0.45)); necro.setAttribute("ry", f1((5 + 16 * sm.Sk) * 0.45)); necro.setAttribute("opacity", sm.Sk > 0.15 ? "0.9" : "0");
  hairs.forEach((h, i) => { const th = 0.25 + 0.1 * i; h.s = lerp(h.s, sm.Ha > th ? 1 : 0, Math.min(1, dt * 1.5)); place(h.e, h.x, 302 + 40 * h.s, 75 * h.s, 1); h.e.setAttribute("opacity", (1 - h.s).toFixed(2)); });
  /* red urine while on drug */
  acc.uri += dt * sm.on * 3;
  while (acc.uri >= 1) { acc.uri--; const p = free(uriP); if (p) emit(p, 918, 380, 0, 50, 0); }
  uriP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 412) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.heart.set(sm.Ht, wordOf(sm.Ht, 0.25, 0.6, ["none", "some", "severe"]));
  gg.marrow.set(sm.Mr, wordOf(sm.Mr, 0.3, 0.65, ["ok", "low", "very low"])); gg.gut.set(sm.Gu, wordOf(sm.Gu, 0.3, 0.6, ["ok", "sore", "severe"]));
  gg.hair.set(sm.Ha, wordOf(sm.Ha, 0.3, 0.65, ["kept", "thinning", "lost"])); gg.skin.set(sm.Sk, wordOf(sm.Sk, 0.08, 0.2, ["none", "red", "necrotic"]));
}
run({ init, step });
