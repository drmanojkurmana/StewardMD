/* Onc-etop scene: etoposide traps topoisomerase II on tumour DNA (left);
 * marrow, hair, gut, vessel pressure and second leukaemia show the side effects (right). */
const TCX = 235, TCY = 235;
const L = { tum: $("tum"), eto: $("eto"), frag: $("frag"), mar: $("mar"), blast: $("blast"), skinSlot: $("skinSlot"), hairG: $("hairG"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), vesSlot: $("vesSlot"), vesFx: $("vesFx"), over: $("over"), panel: $("panel") };
const SLOTS = [192, 210, 228, 246, 264, 282].map((y, i) => [TCX + (i % 2 ? 7 : -7), y]);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, flashA = null, flashB = null, vesO = null, dil = null, ring = null, gutTint = null, capEl = null, capKey = "";
let topo = [], marCells = [], blastCells = [], hairs = [], gg = {};
let etoP, debP, queP, floP, driP, hisP;
function capText(d, l) {
  if (d === 0) return "No treatment. The tumour grows unchecked and no drug harm builds.";
  if (d === 2 && l === 0) return "Early course as a slow infusion. Tumour kill proceeds while pressure stays steady.";
  if (d === 2 && l === 1) return "Middle course as a slow infusion. The tumour shrinks with steady pressure, but marrow, hair and gut harm builds.";
  if (d === 2) return "Late course as a slow infusion. The tumour is controlled with pressure protected, yet a rare second leukaemia can still follow.";
  if (l === 0) return "Early course. Etoposide traps topoisomerase II on tumour DNA and breaks appear in S and G2.";
  if (l === 1) return "Middle course. Tumour kill builds with marrow, hair and gut harm, and rapid infusion lets pressure dip.";
  return "Late course. Most tumour cells are dead but the marrow is empty, pressure dips, and rare MLL leukaemia can emerge.";
}
function init() {
  /* ---- tumour cell, DNA helix, topoisomerase II, break marks ---- */
  tumG = cell(L.tum, { cls: "graft", r: 105, nuc: 0.57, seed: 3, wob: 0.07, n: 10 });
  let d1 = "", d2 = "";
  for (let y = 182; y <= 288; y += 4) { const ph = (y - 182) / 106 * Math.PI * 3, x1 = TCX + 13 * Math.sin(ph), x2 = TCX - 13 * Math.sin(ph); d1 += (y === 182 ? "M" : "L") + f1(x1) + " " + y; d2 += (y === 182 ? "M" : "L") + f1(x2) + " " + y; }
  mk("path", { class: "et-dna", d: d1 }, L.tum); mk("path", { class: "et-dna", d: d2 }, L.tum);
  let rg = "";
  for (let y = 188; y <= 282; y += 12) { const ph = (y - 182) / 106 * Math.PI * 3, x1 = TCX + 13 * Math.sin(ph), x2 = TCX - 13 * Math.sin(ph); rg += "M" + f1(x1) + " " + y + "L" + f1(x2) + " " + y; }
  mk("path", { class: "et-rung", d: rg }, L.tum);
  topo = [[219, 212, 0], [251, 258, 2.1]].map(([x, y, ph]) => { const g = mk("g", { class: "et-topo" }, L.tum); mk("path", { class: "et-tl", d: "M-8 0L8 0" }, g); mk("circle", { class: "et-tb", cx: -8, cy: 0, r: 7 }, g); mk("circle", { class: "et-tb", cx: 8, cy: 0, r: 7 }, g); return { g, x, y, ph }; });
  flashA = mk("path", { class: "et-break", d: "M222 218L232 226L224 230L234 240", opacity: "0" }, L.tum);
  flashB = mk("path", { class: "et-break", d: "M238 258L248 266L240 270L250 280", opacity: "0" }, L.tum);
  etoP = pool(14, () => mk("path", { class: "sc-p et-wedge", d: "M0 -4.5L4.5 3L-4.5 3Z" }, L.eto));
  debP = pool(14, () => mk("circle", { class: "sc-p et-deb", r: 2.5 }, L.frag));
  /* ---- marrow: bone with red cavity, precursors and leukaemia blasts ---- */
  mk("circle", { class: "et-bone", cx: 548, cy: 155, r: 24 }, L.mar);
  mk("circle", { class: "et-bone", cx: 648, cy: 155, r: 24 }, L.mar);
  mk("rect", { class: "et-bone", x: 552, y: 132, width: 92, height: 46, rx: 10 }, L.mar);
  mk("rect", { class: "et-cav", x: 562, y: 140, width: 72, height: 30, rx: 15 }, L.mar);
  for (let i = 0; i < 10; i++) { const e = mk("circle", { class: "et-mar", cx: 0, cy: 0, r: 4 }, L.mar); marCells.push({ e, x: 570 + (i % 5) * 13 + rnd(-2, 2), y: 147 + Math.floor(i / 5) * 11 + rnd(-2, 2), s: 1 }); }
  for (let i = 0; i < 8; i++) { const e = mk("circle", { class: "et-blast", cx: 0, cy: 0, r: 5, opacity: "0" }, L.blast); blastCells.push({ e, x: 572 + (i % 4) * 17 + rnd(-2, 2), y: 147 + Math.floor(i / 4) * 12 + rnd(-2, 2), s: 0 }); }
  /* ---- skin with hairs, bowel, vessel ---- */
  organ(L.skinSlot, "skin", 800, 150, 150, { h: 80 });
  for (let i = 0; i < 6; i++) { const e = mk("rect", { class: "et-hair", x: -1.25, y: -22, width: 2.5, height: 22, rx: 1 }, L.hairG); hairs.push({ e, x: 745 + i * 16, s: 0 }); }
  organ(L.gutSlot, "bowel", 595, 330, 150, { h: 85 });
  gutTint = mk("ellipse", { class: "et-gut", cx: 595, cy: 330, rx: 62, ry: 34, opacity: "0" }, L.gutFx);
  queP = pool(12, () => mk("circle", { class: "sc-p et-quease", r: 2.2 }, L.gutFx));
  vesO = organ(L.vesSlot, "vessel", 805, 330, 150, { h: 70 });
  dil = mk("ellipse", { class: "et-dil", cx: 805, cy: 330, rx: 78, ry: 40, opacity: "0" }, L.vesFx);
  ring = mk("ellipse", { class: "et-shield", cx: 805, cy: 330, rx: 84, ry: 46, opacity: "0" }, L.vesFx);
  floP = pool(14, () => mk("circle", { class: "sc-p et-flow", r: 2.6 }, L.vesFx));
  driP = pool(10, () => mk("circle", { class: "sc-p et-drip", r: 2.4 }, L.vesFx));
  hisP = pool(16, () => mk("path", { class: "sc-p et-hist", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, L.vesFx));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Etoposide", 55, 240, 78, 114, "Etoposide, a topoisomerase II poison. It enters the cell and locks topoisomerase II onto DNA so the cut strands cannot rejoin.");
  pill(o, "Topoisomerase II", 251, 258, 382, 112, "Topoisomerase II cuts DNA to untangle it before copying. Trapped by etoposide, the stuck cut becomes a double strand break.");
  pill(o, "Tumour DNA", 235, 290, 235, 388, "Tumour DNA, the drug target. Unrepaired breaks in S and G2 stop the genome being copied, so the tumour cell dies.");
  pill(o, "Bone marrow", 598, 182, 560, 228, "Myelosuppression. Marrow precursors divide fast like tumour cells, so the drug kills them and blood counts fall until the marrow recovers.");
  pill(o, "Second leukaemia", 630, 150, 718, 232, "Therapy related leukaemia. The same topoisomerase II damage in a marrow stem cell can swap part of chromosome 11q23 (MLL) and cause leukaemia courses later.");
  pill(o, "Hair", 770, 99, 880, 96, "Alopecia. Hair matrix cells divide fast and are killed, so hair falls out; it regrows after treatment ends.");
  pill(o, "Gut", 595, 365, 540, 414, "Nausea and vomiting. The drug irritates the gut lining and the vomiting centre, so the patient feels sick.");
  pill(o, "Blood pressure", 805, 368, 800, 414, "Hypotension with rapid infusion. A fast drip releases histamine like signals that widen vessels and drop pressure; a slow infusion avoids it.");
  capEl = mk("text", { class: "et-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. Etoposide traps topoisomerase II on DNA and the unrepaired double strand breaks kill cells in S and G2."],
    ["marrow", "Marrow", "g-cyt", "Myelosuppression. Dividing marrow precursors are killed along with the tumour, so red cells, white cells and platelets fall."],
    ["hair", "Hair loss", "g-neu", "Alopecia. Hair matrix cells divide fast and are killed, so hair falls out; it regrows after treatment ends."],
    ["gut", "Nausea", "g-eos", "Nausea and vomiting from gut lining irritation and the vomiting centre."],
    ["press", "Pressure", "g-bad", "Blood pressure. Rapid infusion releases histamine like signals that widen vessels and drop pressure; a slow infusion protects it."],
    ["leuk", "Leukaemia risk", "g-clot", "Therapy related leukaemia. Topoisomerase II damage in a marrow stem cell can rearrange 11q23 (MLL) and cause leukaemia courses later."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Mr: 0.3, Ha: 0.2, Na: 0.2, Hy: 0.1, Lk: 0, on: 0, slow: 0 };
const acc = { eto: 0, deb: 0, que: 0, flo: 0, dri: 0, his: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Mr = lerp(sm.Mr, m.Mr, k); sm.Ha = lerp(sm.Ha, m.Ha, k);
  sm.Na = lerp(sm.Na, m.Na, k); sm.Hy = lerp(sm.Hy, m.Hy, k); sm.Lk = lerp(sm.Lk, m.Lk, k);
  sm.on = lerp(sm.on, m.on, k); sm.slow = lerp(sm.slow, m.slow, k);
  /* tumour cell pulses, grows without treatment, shrinks with kill */
  const cs = (1 - 0.1 * sm.K * sm.on + (1 - sm.on) * 0.06) * (1 + 0.015 * Math.sin(tm / 700));
  place(tumG, TCX, TCY, 0, cs);
  /* wedges fly in and lodge on the DNA; they leave when treatment stops */
  const want = m.on ? 6 : 0;
  let n = 0, lodged = 0;
  etoP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; if (p.on && p.st === 2) lodged++; });
  acc.eto += dt * m.on * 2.4;
  while (acc.eto >= 1) { acc.eto--; if (n < want) { const p = free(etoP); if (p) { const used = {}; etoP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 6) si++; emit(p, rnd(20, 50), rnd(190, 290), 0, 0, si % 6); n++; } } }
  if (n > want) { const p = etoP.find((q) => q.on && q.st === 2) || etoP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  etoP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = SLOTS[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 110 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 47) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.k * 30) + ")");
    else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  /* topo II traps when wedges lodge: turns red, freezes, and breaks flash */
  const trapped = lodged >= 3;
  topo.forEach((tp) => { tp.g.setAttribute("class", trapped ? "et-topo trapped" : "et-topo");
    place(tp.g, tp.x, tp.y + Math.sin(tm / 900 + tp.ph) * 3 * (trapped ? 0.3 : 1), Math.sin(tm / 1200 + tp.ph) * 8 * (trapped ? 0 : 1), 1); });
  const fl = (sm.on * sm.K > 0.15 && Math.sin(tm / 110) > 0.55) ? (0.85 * sm.K).toFixed(2) : "0";
  flashA.setAttribute("opacity", trapped ? fl : "0"); flashB.setAttribute("opacity", trapped ? fl : "0");
  /* debris from dying tumour cells */
  acc.deb += dt * sm.K * sm.on * 8;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * 100, TCY + Math.sin(a) * 100, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* marrow precursors deplete; leukaemia blasts grow late */
  const mwant = Math.round(10 * (1 - sm.Mr * 0.9));
  marCells.forEach((c, i) => { c.s = lerp(c.s, i < mwant ? 1 : 0, Math.min(1, dt * 2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(4 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  const lwant = Math.round(8 * sm.Lk);
  blastCells.forEach((c, i) => { c.s = lerp(c.s, i < lwant ? 1 : 0, Math.min(1, dt * 1.2)); c.e.setAttribute("cx", f1(c.x)); c.e.setAttribute("cy", f1(c.y)); c.e.setAttribute("r", f1(5 * c.s)); c.e.setAttribute("opacity", c.s > 0.05 ? "1" : "0"); });
  /* hair sheds */
  hairs.forEach((h, i) => { const th = 0.25 + 0.1 * i; h.s = lerp(h.s, sm.Ha > th ? 1 : 0, Math.min(1, dt * 1.5)); place(h.e, h.x, 110 + 40 * h.s, 75 * h.s, 1); h.e.setAttribute("opacity", (1 - h.s).toFixed(2)); });
  /* gut reddens and quease bubbles rise */
  gutTint.setAttribute("opacity", (sm.Na * 0.55).toFixed(2));
  acc.que += dt * sm.Na * 6;
  while (acc.que >= 1) { acc.que--; const p = free(queP); if (p) emit(p, rnd(545, 645), 300, rnd(-4, 4), -rnd(18, 30), 0); }
  queP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  /* vessel dilates with hypotension; flow slows; shield shows with slow infusion */
  place(vesO.g, 805, 330, 0, 1);
  dil.setAttribute("rx", f1(78 + 12 * sm.Hy)); dil.setAttribute("ry", f1(40 + 10 * sm.Hy)); dil.setAttribute("opacity", (0.12 + 0.6 * sm.Hy).toFixed(2));
  ring.setAttribute("opacity", sm.slow.toFixed(2));
  const flow = clamp(1.1 - sm.Hy);
  acc.flo += dt * (2 + 6 * flow);
  while (acc.flo >= 1) { acc.flo--; const p = free(floP); if (p) emit(p, 732, 330 + rnd(-10, 10), 60 + 60 * flow, 0, 0); }
  floP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 878) kill(p); });
  /* infusion drips: fast and many when rapid, few when slow */
  acc.dri += dt * sm.on * (sm.slow > 0.5 ? 1.2 : 6);
  while (acc.dri >= 1) { acc.dri--; const p = free(driP); if (p) emit(p, 805, 258, 0, sm.slow > 0.5 ? 40 : 110, 0); }
  driP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 302) kill(p); });
  /* histamine like sparks with rapid infusion */
  acc.his += dt * sm.Hy * (1 - sm.slow) * 14;
  while (acc.his >= 1) { acc.his--; const p = free(hisP); if (p) emit(p, 805 + rnd(-50, 50), 330 + rnd(-25, 25), rnd(-6, 6), rnd(-6, 6), 0); }
  hisP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ") scale(" + (0.6 + p.t).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.marrow.set(sm.Mr, wordOf(sm.Mr, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.hair.set(sm.Ha, wordOf(sm.Ha, 0.3, 0.65, ["kept", "thinning", "lost"])); gg.gut.set(sm.Na, wordOf(sm.Na, 0.3, 0.6, ["ok", "sick", "very sick"]));
  gg.press.set(sm.Hy, wordOf(sm.Hy, 0.25, 0.6, ["ok", "dipping", "low"])); gg.leuk.set(sm.Lk, wordOf(sm.Lk, 0.2, 0.55, ["rare", "rare", "present"]));
}
run({ init, step });
