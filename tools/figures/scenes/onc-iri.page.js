/* Irinotecan scene: prodrug switched on to SN-38, the trapped topoisomerase lock, gut and marrow harm. */
const TCX = 235, TCY = 260, TCR = 115, NUCR = 58, TRAP_Y = 262, CEX = 150, CEY = 322;
const BX = 610, BY = 250;
const L = { tum: $("tumSlot"), dna: $("dnaSlot"), liv: $("livSlot"), bow: $("bowSlot"), mar: $("marSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { K: 0, T: 0, E: 0, Ld: 0, N: 0, on: 0, atr: 0, lop: 0 };
const acc = { iri: 0, gl: 0, ach: 0, lop: 0, msn: 0 };
const gg = {};
let tumG = null, nucG = null, wedgeG = null, forkG = null, breakG = null, bowelO = null, livO = null, ugX = 818, ugY = 192;
let gutGlow = null, marrowDim = null, atrX = null, lopX = null, capEl = null, capKey = "", forkY = 210;
let trGl = null, trMot = null;
const blebs = [], marns = [], bacts = [], churns = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const iri = pool(12, () => mk("ellipse", { class: "sc-p p-iri", rx: 5, ry: 3 }, L.parts));
const sn = pool(14, () => mk("circle", { class: "sc-p p-sn", r: 3 }, L.parts));
const gl = pool(10, () => mk("circle", { class: "sc-p p-gl", r: 2.8 }, L.parts));
const bsn = pool(10, () => mk("circle", { class: "sc-p p-sn", r: 2.8 }, L.parts));
const ach = pool(12, () => mk("circle", { class: "sc-p p-ach", r: 2.4 }, L.parts));
const mot = pool(8, () => mk("circle", { class: "sc-p p-mot", r: 2.6 }, L.parts));
const msn = pool(8, () => mk("circle", { class: "sc-p p-sn", r: 2.4 }, L.parts));
const lop = pool(8, () => mk("circle", { class: "p-lop", r: 5 }, L.parts));
const xmark = (parent, x, y) => { const g = mk("g", { opacity: "0" }, parent); mk("circle", { class: "oc-xc", cx: x, cy: y, r: 7 }, g); mk("path", { class: "oc-xp", d: "M" + (x - 3.5) + " " + (y - 3.5) + "l7 7M" + (x + 3.5) + " " + (y - 3.5) + "l-7 7" }, g); return g; };

function capText(d, l) {
  if (d === 3) return ["Atropine and loperamide guard the gut. Tumour kill goes on as before.", "Gut rescue holds both cramps and late diarrhoea down while the tumour dies.", "Late courses with full gut rescue. The gut stays guarded but neutrophils still fall."][l];
  if (d === 2) return ["Atropine blocks the early cholinergic cramps. Tumour kill goes on as before.", "Atropine keeps early cramps settled while SN-38 keeps breaking tumour DNA.", "Even late on, atropine holds the early cramps down. Late gut and marrow harm still build."][l];
  if (d === 1) return ["SN-38 traps topoisomerase I on tumour DNA. Early cramps grip while late harm is still small.", "SN-38 traps topoisomerase I and breaks tumour DNA. Cramps grip and the gut lining sores.", "Late courses break more tumour DNA. The gut lining is raw and neutrophils run very low."][l];
  return ["No treatment. The tumour copies its DNA and divides.", "No treatment. The tumour keeps dividing and nothing is harmed.", "No treatment. The tumour grows on with no benefit and no harm."][l];
}

function init() {
  /* ---- tumour cell with nucleus ---- */
  tumG = cell(L.tum, { cls: "tum", r: TCR, seed: 3, wob: 0.08, n: 10 });
  place(tumG, TCX, TCY, 0, 1);
  nucG = cell(L.tum, { cls: "nuc", r: NUCR, seed: 7, wob: 0.06, n: 9 });
  place(nucG, TCX, TCY, 0, 1);
  /* ---- DNA: two wavy strands with rungs ---- */
  let dL = "", dR = "";
  for (let y = 208; y <= 312; y += 4) { const s = 5 * Math.sin(y / 10); dL += (y === 208 ? "M" : "L") + f1(TCX - 14 + s) + " " + y; dR += (y === 208 ? "M" : "L") + f1(TCX + 14 + s) + " " + y; }
  mk("path", { class: "oc-dna", d: dL }, L.dna);
  mk("path", { class: "oc-dna", d: dR }, L.dna);
  for (let y = 214; y <= 308; y += 14) { const s = 5 * Math.sin(y / 10); mk("path", { class: "oc-rung", d: "M" + f1(TCX - 14 + s) + " " + y + "L" + f1(TCX + 14 + s) + " " + y }, L.dna); }
  /* ---- topoisomerase lock on the DNA, SN-38 wedge, stalling fork, breaks ---- */
  const topo = mk("g", {}, L.dna);
  mk("ellipse", { class: "oc-topo", cx: TCX, cy: TRAP_Y, rx: 16, ry: 10 }, topo);
  mk("circle", { class: "oc-topo", cx: TCX - 11, cy: TRAP_Y - 6, r: 5 }, topo);
  mk("circle", { class: "oc-topo", cx: TCX + 11, cy: TRAP_Y - 6, r: 5 }, topo);
  wedgeG = mk("g", { opacity: "0" }, L.dna);
  mk("path", { class: "oc-wedge", d: "M" + (TCX - 9) + " " + (TRAP_Y - 8) + "L" + (TCX + 9) + " " + (TRAP_Y - 8) + "L" + TCX + " " + (TRAP_Y + 9) + "Z" }, wedgeG);
  forkG = mk("g", {}, L.dna);
  mk("path", { class: "oc-fork", d: "M-9 0L9 0L0 12Z" }, forkG);
  place(forkG, TCX, forkY, 0, 1);
  breakG = mk("g", { opacity: "0" }, L.dna);
  mk("path", { class: "oc-brk", d: "M" + (TCX - 12) + " 276l8 10M" + (TCX + 12) + " 276l-8 10" }, breakG);
  /* ---- apoptotic blebs around the rim ---- */
  for (let i = 0; i < 7; i++) { const ang = -0.5 + i * 0.62, e = mk("circle", { class: "oc-bleb", r: 5 + (i % 3) * 1.6 }, L.tum); blebs.push({ e, ang }); }
  /* ---- carboxylesterase badge: the switch in the cytoplasm ---- */
  mk("circle", { class: "oc-ce", cx: CEX, cy: CEY, r: 10 }, L.tum);
  const cet = mk("text", { class: "oi-tag", x: CEX, y: CEY + 3.5, "text-anchor": "middle" }, L.tum); cet.textContent = "CE";
  /* ---- liver with the UGT1A1 badge ---- */
  livO = organ(L.liv, "liver", 835, 165, 110, {});
  const porta = livO.ports.porta || [818, 206];
  ugX = porta[0]; ugY = porta[1] - 14;
  mk("circle", { class: "oc-ce", cx: f1(ugX), cy: f1(ugY), r: 10 }, L.parts);
  const ugt = mk("text", { class: "oi-tag", x: f1(ugX), y: f1(ugY + 3.5), "text-anchor": "middle" }, L.parts); ugt.textContent = "UGT";
  /* ---- bowel: tagged SN-38 arrives, bacteria switch it back on ---- */
  bowelO = organ(L.bow, "bowel", BX, BY, 150, { h: 190 });
  const coils = bowelO.ports.coils || [613, 255];
  gutGlow = mk("ellipse", { class: "oc-dmg", cx: BX, cy: BY, rx: 78, ry: 98, opacity: "0" }, L.parts);
  [[585, 232, 20], [642, 238, -25], [598, 278, 10], [632, 288, -15], [613, 212, 35]].forEach(([x, y, r], i) => {
    const e = mk("ellipse", { class: "oc-bact", rx: 5.5, ry: 2.6 }, L.parts);
    bacts.push({ e, x, y, r, i });
  });
  churns.push(mk("path", { class: "oc-churn", d: "M503 228q10 -12 20 0", opacity: "0" }, L.parts));
  churns.push(mk("path", { class: "oc-churn", d: "M505 282q10 -12 20 0", opacity: "0" }, L.parts));
  atrX = xmark(L.parts, 545, 166);
  lopX = xmark(L.parts, 668, 302);
  trGl = track([[ugX, ugY], [740, 214], [668, 236], [coils[0], coils[1]]]);
  trMot = track([[613, 178], [620, 255], [614, 332]]);
  mot.forEach((p, i) => { p.u = i / 8; p.on = true; p.e.setAttribute("opacity", "1"); });
  /* ---- marrow bone with neutrophils that run low ---- */
  const bg = mk("g", {}, L.mar);
  mk("rect", { class: "oc-bone", x: 762, y: 235, width: 140, height: 52, rx: 20 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 762, cy: 261, rx: 15, ry: 30 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 902, cy: 261, rx: 15, ry: 30 }, bg);
  mk("rect", { class: "oc-cav", x: 780, y: 247, width: 104, height: 28, rx: 12 }, bg);
  [[795, 256, "neut"], [815, 252, "neut"], [835, 258, "plt"], [855, 253, "neut"], [875, 258, "neut"], [805, 268, "rbc"], [830, 268, "neut"], [860, 268, "plt"]]
    .forEach(([x, y, cls], i) => marns.push({ g: cell(bg, { cls, r: 7, nuc: cls === "plt" ? 0 : 0.4, seed: i + 11, wob: 0.12, x, y }), x, y, i }));
  marrowDim = mk("ellipse", { class: "oc-dmg", cx: 832, cy: 261, rx: 58, ry: 30, opacity: "0" }, L.parts);
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Irinotecan", 36, 200, 110, 102, "A prodrug. Carboxylesterase in liver and gut switches it on to SN-38.");
  pill(o, "Topo I trap", 220, 256, 118, 152, "SN-38 locks topoisomerase I onto DNA. When copying reaches the lock, the DNA breaks.");
  pill(o, "SN-38", 252, 300, 345, 150, "The active form. It traps topoisomerase I and also harms gut and marrow.");
  pill(o, "Dying cell", 323, 334, 350, 415, "Broken DNA the cell cannot fix. The tumour cell blebs and dies.");
  pill(o, "Gut", coils[0], coils[1], 560, 400, "Gut bacteria switch tagged SN-38 back on and it burns the lining: late diarrhoea. Early cramps come from excess acetylcholine.");
  pill(o, "Marrow", 832, 261, 832, 332, "SN-38 kills dividing marrow cells, so neutrophils fall and infection risk rises.");
  pill(o, "Liver UGT1A1", ugX, ugY, 836, 96, "The liver enzyme that tags SN-38 for removal. Weak versions leave more SN-38 to harm.");
  const gr = pill(o, "Gut rescue", 655, 290, 716, 398, "Atropine calms early cholinergic cramps. Loperamide slows late diarrhoea."); gr.setAttribute("id", "gr-pill");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm together";
  [["kill", "Tumour kill", "g-good", "How much tumour dies from broken DNA. It rises with each course while the drug is given."],
    ["trap", "Topo I trap", "g-cyt", "SN-38 wedged into the topoisomerase I lock on DNA. Set while the drug is present."],
    ["early", "Early cramps", "g-eos", "Cholinergic diarrhoea during or soon after treatment, from blocked acetylcholinesterase. Atropine eases it."],
    ["late", "Late gut harm", "g-bad", "SN-38 reactivated by gut bacteria burns the lining days later. Loperamide slows it."],
    ["neut", "Neutrophils", "g-neu", "White cells that fight bacteria. Marrow harm lets them fall as courses build."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 160, 478, 70, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.K = lerp(sm.K, m.K, k2); sm.T = lerp(sm.T, m.T, k2); sm.E = lerp(sm.E, m.E, k1); sm.Ld = lerp(sm.Ld, m.Ld, k2);
  sm.N = lerp(sm.N, m.N, k2); sm.on = lerp(sm.on, m.on, k1); sm.atr = lerp(sm.atr, m.atr, k1); sm.lop = lerp(sm.lop, m.lop, k1);
  /* tumour shrinks and its nucleus condenses as cells die */
  place(tumG, TCX, TCY, 0, 1 - 0.06 * sm.K);
  place(nucG, TCX, TCY, 0, 1 - 0.2 * sm.K);
  blebs.forEach((b, i) => { const s = clamp((sm.K - 0.08 * i) * 1.6), rr = TCR * (1 - 0.06 * sm.K) + 2;
    b.e.setAttribute("cx", f1(TCX + Math.cos(b.ang) * rr)); b.e.setAttribute("cy", f1(TCY + Math.sin(b.ang) * rr));
    b.e.setAttribute("r", f1((5 + (i % 3) * 1.6) * (0.2 + 0.8 * s))); b.e.setAttribute("opacity", s > 0.05 ? "1" : "0"); });
  /* the SN-38 wedge flashes while drug is present; breaks show with kill */
  wedgeG.setAttribute("opacity", (sm.on * (0.55 + 0.45 * Math.sin(tm / 180))).toFixed(2));
  breakG.setAttribute("opacity", clamp(sm.K * 1.3).toFixed(2));
  /* the fork runs when untreated and stalls at the trap when treated */
  if (sm.on > 0.5) forkY = lerp(forkY, 240, Math.min(1, dt * 2));
  else { forkY += 42 * dt; if (forkY > 312) forkY = 208; }
  place(forkG, TCX, forkY, 0, 1);
  /* prodrug drifts in, reaches the CE switch and becomes SN-38 bound for DNA */
  acc.iri += dt * sm.on * 6;
  while (acc.iri >= 1) { acc.iri--; const p = free(iri); if (p) emit(p, 16, rnd(150, 370), 0, 0, 0); }
  iri.forEach((p) => { if (!p.on) return;
    if (p.k === 0) { p.x += 50 * dt; p.y += (CEY - p.y) * dt * 0.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.x * 4) + ")"); if (p.x > 118) p.k = 1; }
    else { const dx = CEX - p.x, dy = CEY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.x * 4) + ")");
      if (d < 10) { kill(p); const q = free(sn); if (q) emit(q, CEX, CEY, 0, 0, 0); } }
    if (p.x > 460) kill(p); });
  sn.forEach((p) => { if (!p.on) return; const dx = TCX - p.x, dy = TCY + 6 - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 75 * dt; p.y += (dy / d) * 75 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 26) kill(p); });
  /* tagged SN-38 runs from the liver to the bowel, where bacteria free it again */
  acc.gl += dt * sm.on * 4;
  while (acc.gl >= 1) { acc.gl--; const p = free(gl); if (p) emit(p, 0, 0, 0, 0, 0); }
  gl.forEach((p) => { if (!p.on) return; p.u += dt * 0.3; if (p.u >= 1) { kill(p); const q = free(bsn); if (q) emit(q, 613 + rnd(-26, 26), 255 + rnd(-60, 60), rnd(-8, 8), rnd(-8, 8), 0); return; }
    const q = trGl.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  bsn.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); });
  bacts.forEach((b) => { const s = 1 + (0.1 + 0.2 * sm.Ld) * Math.sin(tm / 280 + b.i * 1.9);
    b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ") rotate(" + b.r + ") scale(" + s.toFixed(2) + " 1)"); });
  gutGlow.setAttribute("opacity", (sm.Ld * 0.5).toFixed(2));
  /* early cholinergic storm: acetylcholine flashes and the bowel grips */
  acc.ach += dt * sm.E * 8;
  while (acc.ach >= 1) { acc.ach--; const p = free(ach); if (p) { const left = Math.random() < 0.5; emit(p, left ? 545 : 675, 180 + rnd(-8, 8), left ? -rnd(25, 45) : rnd(25, 45), rnd(-30, -10), 0); } }
  ach.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  place(bowelO.g, BX, BY, 0, 1 - 0.045 * sm.E * (0.5 + 0.5 * Math.sin(tm / 140)));
  churns.forEach((c, i) => { c.setAttribute("opacity", (sm.E * 0.9).toFixed(2));
    c.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 150 + i * 2) * 3 * sm.E) + ")"); });
  /* motility streams down the bowel; loperamide slows it */
  mot.forEach((p) => { p.u += dt * (0.02 + 0.2 * (1 - 0.7 * sm.lop)); if (p.u > 1) p.u -= 1;
    const q = trMot.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.lop += dt * sm.lop * 3;
  while (acc.lop >= 1) { acc.lop--; const p = free(lop); if (p) emit(p, rnd(570, 650), 170, 0, 30, 0); }
  lop.forEach((p) => { if (!p.on) return; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.y - 170) / 160).toFixed(2)); if (p.y > 330) kill(p); });
  atrX.setAttribute("opacity", sm.atr.toFixed(2));
  lopX.setAttribute("opacity", sm.lop.toFixed(2));
  $("gr-pill").style.opacity = Math.max(sm.atr, sm.lop).toFixed(2);
  /* marrow: SN-38 drifts in and neutrophils run low */
  acc.msn += dt * sm.on * 4;
  while (acc.msn >= 1) { acc.msn--; const p = free(msn); if (p) emit(p, 748, rnd(250, 272), rnd(45, 65), 0, 0); }
  msn.forEach((p) => { if (!p.on) return; p.x += p.vx * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 895) kill(p); });
  marns.forEach((n) => { n.g.style.opacity = (1 - 0.85 * sm.N).toFixed(2);
    place(n.g, n.x + Math.sin(tm / 400 + n.i * 2) * 1.5 * (1 - sm.N), n.y + Math.cos(tm / 500 + n.i) * 1.2 * (1 - sm.N), 0, 1 - 0.25 * sm.N); });
  marrowDim.setAttribute("opacity", (sm.N * 0.5).toFixed(2));
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["growing", "shrinking", "dying"]));
  gg.trap.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["free", "setting", "trapped"]));
  gg.early.set(sm.E, wordOf(sm.E, 0.25, 0.6, ["settled", "cramping", "griping"]));
  gg.late.set(sm.Ld, wordOf(sm.Ld, 0.25, 0.6, ["ok", "sore", "raw"]));
  gg.neut.set(sm.N, wordOf(sm.N, 0.3, 0.6, ["steady", "falling", "very low"]));
}
run({ init, step });
