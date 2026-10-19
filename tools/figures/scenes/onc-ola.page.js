/* Onc-ola scene: olaparib traps PARP on tumour DNA (left); the copying fork
 * doubles the break and BRCA mutant cells die. Marrow, vein clot, gut and
 * muscle show the side effects (right). */
const TCX = 235, TCY = 235, NX = 240;
const L = { tum: $("tum"), ola: $("ola"), frag: $("frag"), mar: $("mar"), blast: $("blast"), vesSlot: $("vesSlot"), vesFx: $("vesFx"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), musSlot: $("musSlot"), musFx: $("musFx"), over: $("over"), panel: $("panel") };
const SLOTS = [[228, 220], [252, 220], [228, 240], [252, 240]];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, topCont = null, topGap = null, botCont = null, botGap = null, parpG = null, forkG = null, flashA = null, flashB = null;
let clotG = null, gutTint = null, gutRing = null, veil = null, capEl = null, capKey = "";
let marCells = [], blastCells = [], gg = {};
let olaP, debP, driP, floP, queP, spaP;
let fx = 150, dsb = 0;
function capText(d, l) {
  if (d === 0) return "No treatment. The tumour grows unchecked and no drug harm builds.";
  if (d === 2 && l === 0) return "Early course with support. Tumour kill proceeds while red cells and sickness stay covered.";
  if (d === 2 && l === 1) return "Middle course with support. The tumour shrinks with red cells and nausea covered, but fatigue and clot risk build.";
  if (d === 2) return "Late course with support. The tumour is controlled with red cells covered, yet clots and rare MDS or AML can still follow.";
  if (l === 0) return "Early course. Olaparib traps PARP on tumour DNA and single strand breaks persist.";
  if (l === 1) return "Middle course. Stuck PARP blocks the copying fork, breaks double, and BRCA mutant cells die while anaemia and nausea build.";
  return "Late course. Most tumour cells are dead but counts are low, clots can form, and rare MDS or AML can emerge.";
}
function init() {
  /* ---- tumour cell, DNA with a nick, PARP, copying fork, break flashes ---- */
  tumG = cell(L.tum, { cls: "graft", r: 105, nuc: 0.57, seed: 3, wob: 0.07, n: 10 });
  topCont = mk("path", { class: "ol-dna", d: "M150 229L320 229", opacity: "0" }, L.tum);
  topGap = mk("path", { class: "ol-dna", d: "M150 229L234 229M246 229L320 229" }, L.tum);
  botCont = mk("path", { class: "ol-dna", d: "M150 243L320 243" }, L.tum);
  botGap = mk("path", { class: "ol-dna", d: "M150 243L236 243M244 243L320 243", opacity: "0" }, L.tum);
  let rg = "";
  for (let x = 156; x <= 314; x += 12) { if (x > 230 && x < 250) continue; rg += "M" + x + " 229L" + x + " 243"; }
  mk("path", { class: "ol-rung", d: rg }, L.tum);
  parpG = mk("g", { class: "ol-parp" }, L.tum);
  mk("path", { class: "ol-pl", d: "M-8 0L8 0" }, parpG);
  mk("circle", { class: "ol-pb", cx: -8, cy: 0, r: 7 }, parpG);
  mk("circle", { class: "ol-pb", cx: 8, cy: 0, r: 7 }, parpG);
  forkG = mk("path", { class: "ol-fork", d: "M-8 -9L8 0L-8 9Z" }, L.tum);
  flashA = mk("path", { class: "ol-break", d: "M232 218L240 226L233 229L241 238", opacity: "0" }, L.tum);
  flashB = mk("path", { class: "ol-break", d: "M244 244L250 250L243 252L249 260", opacity: "0" }, L.tum);
  olaP = pool(10, () => mk("path", { class: "sc-p ol-wedge", d: "M0 -4.5L4.5 3L-4.5 3Z" }, L.ola));
  debP = pool(14, () => mk("circle", { class: "sc-p ol-deb", r: 2.5 }, L.frag));
  /* ---- marrow: bone with red cavity, precursors, MDS/AML blasts, transfusion drips ---- */
  mk("circle", { class: "ol-bone", cx: 548, cy: 155, r: 24 }, L.mar);
  mk("circle", { class: "ol-bone", cx: 648, cy: 155, r: 24 }, L.mar);
  mk("rect", { class: "ol-bone", x: 552, y: 132, width: 92, height: 46, rx: 10 }, L.mar);
  mk("rect", { class: "ol-cav", x: 562, y: 140, width: 72, height: 30, rx: 15 }, L.mar);
  for (let i = 0; i < 10; i++) { const e = mk("circle", { class: "ol-mar", cx: 0, cy: 0, r: 4 }, L.mar); marCells.push({ e, x: 570 + (i % 5) * 13 + rnd(-2, 2), y: 147 + Math.floor(i / 5) * 11 + rnd(-2, 2), s: 1 }); }
  for (let i = 0; i < 8; i++) { const e = mk("circle", { class: "ol-blast", cx: 0, cy: 0, r: 5, opacity: "0" }, L.blast); blastCells.push({ e, x: 572 + (i % 4) * 17 + rnd(-2, 2), y: 147 + Math.floor(i / 4) * 12 + rnd(-2, 2), s: 0 }); }
  driP = pool(10, () => mk("path", { class: "sc-p ol-drip", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.mar));
  /* ---- vein with growing clot and slowing flow ---- */
  organ(L.vesSlot, "vessel", 820, 150, 150, { h: 70 });
  clotG = mk("g", {}, L.vesFx);
  for (let j = 0; j < 6; j++) mk("circle", { class: "ol-plt", cx: f1(Math.cos(j * 1.3) * 12), cy: f1(Math.sin(j * 2.1) * 8), r: 5 + (j % 3) }, clotG);
  for (let j = 0; j < 4; j++) mk("path", { class: "ol-fib", d: "M" + f1(rnd(-20, 20)) + " " + f1(rnd(-12, 12)) + "L" + f1(rnd(-20, 20)) + " " + f1(rnd(-12, 12)) }, clotG);
  floP = pool(14, () => mk("circle", { class: "sc-p ol-flow", r: 2.6 }, L.vesFx));
  /* ---- bowel with nausea tint, quease bubbles and cover shield ---- */
  organ(L.gutSlot, "bowel", 600, 330, 150, { h: 85 });
  gutTint = mk("ellipse", { class: "ol-gut", cx: 600, cy: 330, rx: 62, ry: 34, opacity: "0" }, L.gutFx);
  gutRing = mk("ellipse", { class: "ol-shield", cx: 600, cy: 330, rx: 68, ry: 40, opacity: "0" }, L.gutFx);
  queP = pool(12, () => mk("circle", { class: "sc-p ol-quease", r: 2.2 }, L.gutFx));
  /* ---- muscle with fatigue veil and fading energy sparks ---- */
  organ(L.musSlot, "muscle", 820, 330, 150, { h: 70 });
  veil = mk("ellipse", { class: "ol-veil", cx: 820, cy: 330, rx: 70, ry: 32, opacity: "0" }, L.musFx);
  spaP = pool(14, () => mk("path", { class: "sc-p ol-spark", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, L.musFx));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Olaparib", 55, 240, 78, 114, "Olaparib (Lynparza), a PARP inhibitor. It locks PARP onto DNA so single strand breaks persist.");
  pill(o, "PARP", 240, 220, 382, 112, "PARP, a repair protein. It finds single strand breaks and fixes them; trapped by olaparib, it stays stuck on DNA.");
  pill(o, "Tumour DNA", 310, 236, 235, 388, "Tumour DNA in a BRCA mutant cell. Stuck PARP blocks the copying fork, the break doubles, and with no homologous recombination the cell dies.");
  pill(o, "Marrow", 598, 182, 540, 228, "Anaemia and low counts. Marrow precursors divide fast like tumour cells, so the drug kills them and red cells, white cells and platelets fall.");
  pill(o, "MDS or AML", 640, 155, 718, 232, "MDS or AML, rarely. The same DNA damage in a marrow stem cell can cause a second marrow cancer courses later.");
  pill(o, "Vein clot", 820, 150, 888, 100, "Venous thrombosis. The drug makes blood more likely to clot inside veins, which can block flow or travel to the lungs.");
  pill(o, "Nausea", 600, 365, 545, 414, "Nausea. The drug irritates the gut lining and triggers the vomiting centre, so the patient feels sick.");
  pill(o, "Fatigue", 820, 365, 806, 414, "Fatigue. Anaemia and the drug itself leave muscles short of energy, so even small tasks feel exhausting.");
  capEl = mk("text", { class: "ol-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. Trapped PARP turns single strand breaks into double strand breaks at the fork, which BRCA mutant cells cannot fix."],
    ["anae", "Anaemia", "g-bad", "Anaemia. Dividing marrow precursors are killed along with the tumour, so red cells fall; transfusion covers it."],
    ["naus", "Nausea", "g-eos", "Nausea and vomiting from gut lining irritation and the vomiting centre; nausea cover helps."],
    ["fati", "Fatigue", "g-neu", "Fatigue from anaemia and the drug itself, leaving muscles short of energy."],
    ["clot", "Vein clots", "g-clot", "Venous thrombosis. Blood is more likely to clot inside veins, which can block flow or travel to the lungs."],
    ["mds", "MDS/AML risk", "g-cyt", "MDS or AML, rarely. DNA damage in a marrow stem cell can cause a second marrow cancer courses later."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Mr: 0.3, An: 0.3, Na: 0.2, Fa: 0.2, Th: 0.1, Md: 0, on: 0, sup: 0 };
const acc = { ola: 0, deb: 0, dri: 0, flo: 0, que: 0, spa: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Mr = lerp(sm.Mr, m.Mr, k); sm.An = lerp(sm.An, m.An, k);
  sm.Na = lerp(sm.Na, m.Na, k); sm.Fa = lerp(sm.Fa, m.Fa, k); sm.Th = lerp(sm.Th, m.Th, k);
  sm.Md = lerp(sm.Md, m.Md, k); sm.on = lerp(sm.on, m.on, k); sm.sup = lerp(sm.sup, m.sup, k);
  /* tumour cell pulses, grows without treatment, shrinks with kill */
  const cs = (1 - 0.12 * sm.K * sm.on + (1 - sm.on) * 0.06) * (1 + 0.015 * Math.sin(tm / 700));
  place(tumG, TCX, TCY, 0, cs);
  /* wedges fly in and lodge around PARP; they leave when treatment stops */
  const want = m.on ? 4 : 0;
  let n = 0, lodged = 0;
  olaP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; if (p.on && p.st === 2) lodged++; });
  acc.ola += dt * m.on * 2;
  while (acc.ola >= 1) { acc.ola--; if (n < want) { const p = free(olaP); if (p) { const used = {}; olaP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 4) si++; emit(p, rnd(20, 50), rnd(190, 290), 0, 0, si % 4); n++; } } }
  if (n > want) { const p = olaP.find((q) => q.on && q.st === 2) || olaP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  olaP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = SLOTS[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 110 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 61) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.k * 40) + ")");
    else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  /* PARP repairs the nick when free, sits trapped when wedges lodge */
  const trapped = lodged >= 2;
  parpG.setAttribute("class", trapped ? "ol-parp trapped" : "ol-parp");
  const py = trapped ? 229 : 214 + Math.sin(tm / 900) * 4;
  place(parpG, NX, py, trapped ? 0 : Math.sin(tm / 1200) * 8, 1);
  const rep = (1 - sm.on) * (0.5 + 0.5 * Math.sin(tm / 1400));
  topCont.setAttribute("opacity", rep.toFixed(2)); topGap.setAttribute("opacity", (1 - rep).toFixed(2));
  /* the copying fork travels the DNA and stalls at trapped PARP */
  const stall = trapped && fx > 196 && fx < 224;
  if (!stall) { fx += 55 * dt; if (fx > 322) fx = 148; } else fx = 218;
  forkG.setAttribute("transform", "translate(" + f1(fx) + " 236)");
  dsb = lerp(dsb, stall ? 1 : 0, Math.min(1, dt * (stall ? 3 : 0.8)));
  botCont.setAttribute("opacity", (1 - dsb).toFixed(2)); botGap.setAttribute("opacity", dsb.toFixed(2));
  const fl = (dsb > 0.4 && Math.sin(tm / 110) > 0.55) ? (0.85 * dsb).toFixed(2) : "0";
  flashA.setAttribute("opacity", fl); flashB.setAttribute("opacity", fl);
  /* debris from dying tumour cells */
  acc.deb += dt * sm.K * sm.on * 8;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * 100, TCY + Math.sin(a) * 100, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* marrow precursors deplete; MDS/AML blasts grow late; transfusion drips with support */
  const mwant = Math.round(10 * (1 - sm.Mr * 0.9));
  marCells.forEach((c, i) => { c.s = lerp(c.s, i < mwant ? 1 : 0, Math.min(1, dt * 2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(4 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  const lwant = Math.round(8 * sm.Md);
  blastCells.forEach((c, i) => { c.s = lerp(c.s, i < lwant ? 1 : 0, Math.min(1, dt * 1.2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(5 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  acc.dri += dt * sm.sup * 3;
  while (acc.dri >= 1) { acc.dri--; const p = free(driP); if (p) emit(p, 598 + rnd(-8, 8), 100, 0, 60, 0); }
  driP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 142) kill(p); });
  /* vein clot grows; flow slows */
  const s = clamp((sm.Th - 0.08) * 1.8);
  place(clotG, 820, 150, 0, 0.15 + 0.85 * s); clotG.style.opacity = s > 0.05 ? 1 : 0;
  const flow = clamp(1.15 - sm.Th);
  acc.flo += dt * (2 + 6 * flow);
  while (acc.flo >= 1) { acc.flo--; const p = free(floP); if (p) emit(p, 745, 150 + rnd(-8, 8), 60 + 60 * flow, 0, 0); }
  floP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 895) kill(p); });
  /* gut reddens and quease bubbles rise; cover shield shows with support */
  gutTint.setAttribute("opacity", (sm.Na * 0.55).toFixed(2));
  gutRing.setAttribute("opacity", sm.sup.toFixed(2));
  acc.que += dt * sm.Na * 6;
  while (acc.que >= 1) { acc.que--; const p = free(queP); if (p) emit(p, rnd(550, 650), 300, rnd(-4, 4), -rnd(18, 30), 0); }
  queP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  /* muscle dulls and energy sparks fade with fatigue */
  veil.setAttribute("opacity", (sm.Fa * 0.55).toFixed(2));
  acc.spa += dt * (1 - sm.Fa) * 6;
  while (acc.spa >= 1) { acc.spa--; const p = free(spaP); if (p) emit(p, rnd(760, 880), rnd(310, 355), rnd(-6, 6), -rnd(10, 20), 0); }
  spaP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.anae.set(sm.An, wordOf(sm.An, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.naus.set(sm.Na, wordOf(sm.Na, 0.3, 0.6, ["ok", "sick", "very sick"])); gg.fati.set(sm.Fa, wordOf(sm.Fa, 0.3, 0.6, ["ok", "tired", "spent"]));
  gg.clot.set(sm.Th, wordOf(sm.Th, 0.25, 0.55, ["rare", "some", "high"])); gg.mds.set(sm.Md, wordOf(sm.Md, 0.2, 0.55, ["rare", "rare", "present"]));
}
run({ init, step });
