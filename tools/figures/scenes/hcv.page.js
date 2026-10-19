/* Hepatitis C scene: virus from blood into the liver, magnified hepatocyte, copying blocked by caps, scarring over time and gauges. */
const W = SC.W, ICX = 450, ICY = 275, IR = 88;
const L = { liver: $("liverSlot"), fib: $("fib"), cell: $("cellg"), over: $("over"), prog: $("prog"), panel: $("panel") };
const S0 = [ICX - IR + 2, ICY - 13], RNAP = [415, 292], POLY = [372, 332], NS3P = [400, 330], NSBP = [488, 320];
const NSA = [[520, 302], [528, 330], [512, 348]], NUCP = [472, 236], AS = [534, 270], EXITP = [602, 266];
const DUR = [2, 1.8, 2.4, 2.4, 2.6, 2];
const ease = (t) => t * t * (3 - 2 * t);
const bez = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
let liverO = null, porta = [173, 318], LVR = [317, 252], capEl = null, capDrug = -1;
/* ---- liver organ, magnifier and inset ---- */
function initAnatomy() {
  liverO = organ(L.liver, "liver", 205, 255, 215, {});
  porta = liverO.ports.porta; LVR = [Math.round(liverO.x + liverO.w * 0.52), liverO.y - 3];
  mk("path", { class: "hc-mag", d: "M" + f1(liverO.x + liverO.w * 0.5) + " " + f1(liverO.y - 18) + "L" + f1(ICX - IR + 6) + " " + f1(ICY - 52) }, L.cell);
  mk("path", { class: "hc-mag", d: "M" + f1(liverO.x + liverO.w * 0.5) + " " + f1(liverO.y + 22) + "L" + f1(ICX - IR + 6) + " " + f1(ICY + 52) }, L.cell);
  mk("path", { class: "hc-mag", d: "M" + f1(LVR[0]) + " " + f1(LVR[1]) + "L" + f1(S0[0]) + " " + f1(S0[1]) }, L.cell);
  mk("path", { class: "hc-mag", d: "M118 300L" + f1(porta[0]) + " " + f1(porta[1]) }, L.cell);
  mk("circle", { class: "hc-inset", cx: ICX, cy: ICY, r: IR }, L.cell);
}
const infl = () => $("infl"), heal = () => $("heal");
function initInset() {
  mk("circle", { id: "infl", class: "hc-infl", cx: ICX, cy: ICY, r: IR - 3, opacity: 0 }, L.cell);
  mk("circle", { id: "heal", class: "hc-heal", cx: ICX, cy: ICY, r: IR - 3, opacity: 0 }, L.cell);
  mk("path", { class: "hc-er", d: "M388 346Q450 358 528 346" }, L.cell);
  mk("path", { class: "hc-er", d: "M392 356Q450 366 524 356" }, L.cell);
  [[400, 340], [424, 344], [448, 342], [472, 344]].forEach((p) => mk("circle", { cx: f1(p[0]), cy: f1(p[1]), r: 3.6, fill: "var(--anatomy-mid)" }, L.cell));
  const nuc = cell(L.cell, { cls: "hnuc", r: 14, wob: 0.04, n: 10, seed: 6, x: NUCP[0], y: NUCP[1] });
  nuc.setAttribute("opacity", "0.8");
  [168, 182, 196].forEach((a) => { const t = a * Math.PI / 180, x = ICX + IR * Math.cos(t), y = ICY + IR * Math.sin(t);
    const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(a - 180) + ")" }, L.cell);
    mk("path", { class: "hc-rna", d: "M0 0L-9 0M-9 0L-14 -5M-9 0L-14 5" }, g); });
}
/* fibrosis bands and cancer nodule on the liver, placed between two real art ports */
const fibPaths = [];
function initFib() {
  const x = liverO.x, w = liverO.w, lobe = liverO.ports.lobe;
  const mid = [(lobe[0] + porta[0]) / 2, (lobe[1] + porta[1]) / 2];
  [0.3, 0.55, 0.8].forEach((t) => { const y = lerp(lobe[1], porta[1], t);
    fibPaths.push(mk("path", { class: "hc-fib", d: "M" + f1(x - w * 0.35) + " " + f1(y) + "Q" + f1(x) + " " + f1(y - 8) + " " + f1(x + w * 0.35) + " " + f1(y), opacity: 0 }, L.fib)); });
  mk("circle", { id: "nod1", class: "hc-nod", cx: mid[0] + 10, cy: mid[1], r: 9, opacity: 0 }, L.fib);
  const hg = mk("g", { id: "hccG", opacity: 0 }, L.fib);
  cell(hg, { cls: "hep", r: 14, wob: 0.18, n: 8, seed: 9, x: mid[0] + 38, y: mid[1] + 22 });
  mk("circle", { class: "hc-hccn", cx: mid[0] + 38, cy: mid[1] + 22, r: 5 }, hg);
  hg.querySelector(".cl-b").setAttribute("class", "hc-hcc");
}
/* ---- virion drawing ---- */
function virion(parent, sc) { const g = mk("g", {}, parent); let d = ""; for (let i = 0; i < 8; i++) { const t = i * 0.785; d += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 13) + " " + f1(Math.sin(t) * 13); } mk("path", { class: "hc-spk", d }, g); mk("circle", { class: "hc-env", r: 9 }, g); mk("circle", { class: "hc-core", r: 4.2 }, g); if (sc) g.setAttribute("transform", "scale(" + sc + ")"); return { g }; }
const hero = virion(L.cell);
const rnaEl = mk("path", { class: "hc-rna", d: "M-16 -3q4 -5 8 0t8 0t8 0t8 0", opacity: 0 }, L.cell);
const copyEls = [0, 1, 2].map((i) => mk("path", { class: "hc-rna2", d: "M-14 -2q4 -4 7 0t7 0t7 0", opacity: 0, transform: "translate(" + (476 + i * 14) + " " + (296 - i * 6) + ")" }, L.cell));
/* polyprotein: one long chain of segments that later separate */
const polyG = mk("g", { opacity: 0 }, L.cell);
const segs = []; const segCols = ["#e85a7a", "#f08a4b", "#f2d27a", "#3a9a8c", "#3a86e8", "#8a7ac0"];
for (let i = 0; i < 6; i++) { segs.push(mk("rect", { class: "hc-seg", x: POLY[0] + i * 16, y: POLY[1] - 6, width: 15, height: 12, rx: 3, fill: segCols[i] }, polyG)); }
const ns3El = mk("circle", { class: "hc-ns3", cx: NS3P[0], cy: NS3P[1], r: 9, opacity: 0 }, L.cell);
const ns5bEl = mk("circle", { class: "hc-pol", cx: NSBP[0], cy: NSBP[1], r: 13, opacity: 0 }, L.cell);
const ns5aEls = NSA.map((p) => mk("circle", { class: "hc-ns5a", cx: p[0], cy: p[1], r: 4.5, opacity: 0 }, L.cell));
const bud = virion(L.cell); bud.g.setAttribute("opacity", 0);
const prog = Array.from({ length: 5 }, () => { const v = virion(L.cell); v.g.setAttribute("opacity", 0); return { v, t: 9, x: 0, y: 0 }; });
const amb = Array.from({ length: 7 }, () => { const v = virion(L.cell, 0.7); return { v, x: rnd(36, 110), y: rnd(170, 365), t: rnd(0, 6) }; });
const rel = Array.from({ length: 7 }, () => { const v = virion(L.cell, 0.7); return { v, x: rnd(548, 600), y: rnd(240, 300), t: rnd(0, 6) }; });
function xmark(x, y) { const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ")", opacity: 0 }, L.cell); mk("circle", { class: "hc-xc", r: 9 }, g); mk("path", { class: "hc-x", d: "M-4 -4L4 4M4 -4L-4 4" }, g); return g; }
const X3 = xmark(NS3P[0], NS3P[1] - 22), XB = xmark(NSBP[0], NSBP[1] - 24), XA = xmark(538, 312), XASM = xmark(AS[0], AS[1] - 24);
/* blocker caps that dock onto their target when its drug is on */
function makeCap(x, y) { const g = mk("g", { opacity: 0 }, L.cell); mk("circle", { class: "hc-capk", cx: 0, cy: 0, r: 11 }, g); mk("rect", { class: "hc-capk2", x: -6, y: -1.5, width: 12, height: 3, rx: 1.5 }, g); place(g, x, y - 46, 0, 1); return { g, x, y, cur: 0, ph: rnd(0, 6) }; }
const capNS3 = makeCap(NS3P[0], NS3P[1]), capNS5B = makeCap(NSBP[0], NSBP[1]), capNS5A = makeCap(520, 324), capASM = makeCap(AS[0], AS[1]);
function dockCap(c, target, dt) { c.cur = lerp(c.cur, target, Math.min(1, dt * 3)); const e = ease(clamp(c.cur));
  place(c.g, c.x, c.y - 46 * (1 - e) + Math.sin(tm / 480 + c.ph) * 1.5 * e, 0, 1); c.g.setAttribute("opacity", c.cur.toFixed(2)); }
/* ---- labels: seven short pills ---- */
function initPills() {
  const lobe = liverO.ports.lobe;
  pill(L.over, "Virus in blood", 64, 262, 86, 108, "Hepatitis C virions travel in the blood and enter liver cells through surface receptors.");
  pill(L.over, "Liver", f1(lobe[0]), f1(lobe[1]), 250, 108, "The liver, where hepatitis C lives and copies itself. Years of infection scar the liver.");
  pill(L.over, "RNA genome", 415, 292, 410, 108, "The viral RNA genome: one strand that is both the building plan and the copied template. It never enters the nucleus.");
  pill(L.over, "Scarring", f1(porta[0] + 30), f1(porta[1] - 25), 180, 392, "Scarring after years of injury and repair. Severe scarring is cirrhosis, which raises cancer risk.");
  pill(L.over, "NS3 cutter", NS3P[0], NS3P[1], 320, 392, "NS3 cutter: the viral enzyme that cuts the long protein chain into working parts. An NS3 blocker sits on it and stops the cutting.");
  pill(L.over, "Copying complex", NSBP[0], NSBP[1] + 2, 452, 392, "Copying complex: the NS5B copier makes new RNA with help from NS5A. A blocker of either sits here and slows copying.");
  pill(L.over, "New virions", 572, 272, 560, 392, "New virions leaving to infect other liver cells. With treatment far fewer leave.");
  capEl = mk("text", { class: "hc-cap", x: 30, y: 428 }, L.over); capEl.textContent = capText(0);
}
function capText(d) {
  if (d === 1) return "NS3 blocker sits on the cutter. The chain stays whole and copying stalls.";
  if (d === 2) return "NS5B blocker sits on the copier. Little new viral RNA gets made.";
  if (d === 3) return "Combination sits on NS5A and the copier. Copying and assembly stop.";
  return "No treatment. The virus keeps copying and new virions keep leaving.";
}
/* ---- liver progression (right panel) ---- */
const stageEls = [];
function initProg() {
  [["Healthy liver", "hc-dot-h", "A healthy liver with little scar tissue. Acute infection may clear or become chronic."], ["Fibrosis", "hc-dot-f", "Fibrosis: scar tissue builds up after years of chronic inflammation and repair."], ["Cirrhosis", "hc-dot-c", "Cirrhosis: severe, widespread scarring that distorts the liver and can lead to liver failure."], ["Liver cancer", "hc-dot-ca", "Liver cancer, which arises more often once cirrhosis is present."]].forEach(([nm, cls, tip], i) => {
    const cy = 128 + i * 74, g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.prog);
    const bg = mk("rect", { class: "hc-stg", x: 650, y: cy - 26, width: 278, height: 52, rx: 12 }, g);
    mk("circle", { class: cls, cx: 684, cy, r: 17 }, g);
    if (i === 1) mk("path", { class: "hc-fib", d: "M670 " + (cy - 6) + "Q684 " + (cy - 12) + " " + "698 " + (cy - 4) + "M670 " + (cy + 8) + "Q684 " + (cy + 2) + " 698 " + (cy + 9) }, g);
    if (i === 2) { mk("circle", { class: "hc-nod", cx: 678, cy: cy - 6, r: 6 }, g); mk("circle", { class: "hc-nod", cx: 692, cy: cy + 7, r: 5 }, g); }
    if (i === 3) mk("circle", { class: "hc-hccn", cx: 684, cy, r: 6 }, g);
    const t = mk("text", { class: "dr-pt2", x: 714, y: cy + 4 }, g); t.textContent = nm;
    stageEls.push(bg);
    if (i < 3) mk("path", { class: "hc-arr", d: "M684 " + (cy + 28) + "L684 " + (cy + 44) + "M679 " + (cy + 39) + "L684 " + (cy + 46) + "L689 " + (cy + 39) }, L.prog);
  });
}
/* ---- gauges ---- */
const gg = {};
function initGauges() {
  const y0 = 478, P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["virus", "Virus", "g-virus", "Hepatitis C virus in blood. Blocking NS3, NS5B or NS5A brings it down."], ["rep", "Copying", "g-rep", "How actively the NS5B copier, helped by NS5A, is copying the RNA genome."], ["inj", "Injury", "g-inj", "Liver injury from chronic inflammation as infected liver cells are attacked and replaced."], ["fib", "Fibrosis", "g-fib", "Scar tissue laid down after years of injury and repair. Severe fibrosis is cirrhosis."], ["risk", "Cancer risk", "g-risk", "Risk of liver cancer, highest once cirrhosis is present."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 110 + i * 185, y0 + 2, 52, 18, cls, name, tip); });
}
/* ---- state ---- */
const sm = { V: 0.5, R: 0.5, Inj: 0.4, Fib: 0.3, Risk: 0.1, b3: 0, bB: 0, bA: 0 };
const hs = { turn: 0, t: 0, stall: 0, chk: false };
function hideJourney() { [hero.g, rnaEl, bud.g].forEach((e) => e.setAttribute("opacity", 0)); polyG.setAttribute("opacity", 0); ns3El.setAttribute("opacity", 0); ns5bEl.setAttribute("opacity", 0); ns5aEls.forEach((e) => e.setAttribute("opacity", 0)); copyEls.forEach((e) => e.setAttribute("opacity", 0)); segs.forEach((sg, i) => sg.setAttribute("x", f1(POLY[0] + i * 16))); }
function nextVirion() { hs.turn = 0; hs.t = 0; hs.stall = 0; hs.chk = false; hideJourney(); }
function journey(dt, m) {
  if (hs.stall > 0) { hs.stall -= dt; const k = clamp(hs.stall / 1.3); hero.g.setAttribute("opacity", k.toFixed(2)); polyG.setAttribute("opacity", k.toFixed(2)); if (hs.stall <= 0) nextVirion(); return; }
  const s = hs.turn; hs.t += dt; const p = clamp(hs.t / DUR[s]), e = ease(p);
  if (!hs.chk && ((s === 3 && p > 0.15) || (s === 4 && p > 0.15) || (s === 5 && p > 0.15))) { hs.chk = true; const blk = s === 3 ? m.blk3 : s === 4 ? (m.blkB || m.blkA * 0.7) : m.blkA; if (blk > 0 && Math.random() < blk) { hs.stall = 1.3; return; } }
  hideJourney();
  const ghost = 1 - 0.85 * Math.max(sm.bB, sm.bA * 0.7);
  if (s === 0) { const q = bez(LVR, [S0[0] - 8, S0[1]], e); place(hero.g, q[0], q[1], 0, 1); hero.g.setAttribute("opacity", 1); }
  else if (s === 1) { hero.g.setAttribute("opacity", (1 - p).toFixed(2)); place(hero.g, S0[0] + 14, S0[1], 0, 1); const q = bez([S0[0] + 16, S0[1]], RNAP, e); rnaEl.setAttribute("opacity", 1); place(rnaEl, q[0], q[1], 0, 1); }
  else if (s === 2) { rnaEl.setAttribute("opacity", 1); place(rnaEl, 408, 320, 0, 1); polyG.setAttribute("opacity", 1); segs.forEach((sg, i) => sg.setAttribute("opacity", clamp(p * 6 - i) > 0 ? "1" : "0")); }
  else if (s === 3) { ns3El.setAttribute("opacity", 1); ns3El.setAttribute("cx", f1(lerp(POLY[0] + 8, POLY[0] + 88, e))); segs.forEach((sg, i) => { sg.setAttribute("opacity", "1"); sg.setAttribute("x", f1(POLY[0] + i * 16 + i * e * 5 * (1 - sm.b3))); }); polyG.setAttribute("opacity", (1 - 0.45 * sm.b3).toFixed(2)); }
  else if (s === 4) { polyG.setAttribute("opacity", (0.35 * (1 - 0.5 * sm.b3)).toFixed(2)); ns5bEl.setAttribute("opacity", 1); ns5aEls.forEach((el) => el.setAttribute("opacity", 1)); rnaEl.setAttribute("opacity", 1); place(rnaEl, 470, 306, 0, 1); copyEls.forEach((el, i) => el.setAttribute("opacity", (clamp(p * 3 - i * 0.7) > 0 ? ghost : 0).toFixed(2))); }
  else { ns5aEls.forEach((el) => el.setAttribute("opacity", 1 - sm.bA)); const q = bez([AS[0] - 6, AS[1] - 4], EXITP, e); bud.g.setAttribute("opacity", (1 - 0.5 * sm.bA).toFixed(2)); place(bud.g, q[0], q[1], 0, 1 - 0.45 * sm.bA); }
  if (p >= 1) { if (s === 5) { if (sm.bA < 0.5) { const pr = prog.find((q) => q.t >= 9) || prog[0]; pr.t = 0; pr.x = EXITP[0]; pr.y = EXITP[1]; } nextVirion(); } else { hs.turn++; hs.t = 0; hs.chk = false; } }
}
function init() { initAnatomy(); initInset(); initFib(); initPills(); initProg(); initGauges();
  const o1 = mk("text", { class: "dr-pt2", x: 650, y: 414 }, L.prog); o1.textContent = "Outcome";
  const o2 = mk("text", { class: "dr-pt2", x: 650, y: 432 }, L.prog); o2.setAttribute("id", "hcout"); hideJourney(); }
let outKey = "";
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.V = lerp(sm.V, m.V, k); sm.R = lerp(sm.R, m.R, k); sm.Inj = lerp(sm.Inj, m.Inj, k); sm.Fib = lerp(sm.Fib, m.Fib, k); sm.Risk = lerp(sm.Risk, m.Risk, k);
  sm.b3 = lerp(sm.b3, m.blk3, k); sm.bB = lerp(sm.bB, m.blkB, k); sm.bA = lerp(sm.bA, m.blkA, k);
  const healSm = Math.max(sm.b3, sm.bB, sm.bA);
  journey(dt, m);
  dockCap(capNS3, m.blk3, dt); dockCap(capNS5B, (m.blkB || m.blkA) ? 1 : 0, dt); dockCap(capNS5A, m.blkA, dt); dockCap(capASM, m.blkA, dt);
  X3.setAttribute("opacity", sm.b3.toFixed(2)); XB.setAttribute("opacity", Math.max(sm.bB, sm.bA).toFixed(2)); XA.setAttribute("opacity", sm.bA.toFixed(2)); XASM.setAttribute("opacity", sm.bA.toFixed(2));
  infl().setAttribute("opacity", (sm.Inj * 0.4).toFixed(2));
  heal().setAttribute("opacity", (healSm * 0.35).toFixed(2));
  fibPaths.forEach((p) => p.setAttribute("opacity", (sm.Fib * 0.75).toFixed(2)));
  $("nod1").setAttribute("opacity", (sm.Fib * 0.9).toFixed(2));
  $("hccG").setAttribute("opacity", m.lvl === 2 ? "1" : "0");
  stageEls.forEach((bg, i) => { const on = (m.lvl === 0 && i === 0) || (m.lvl === 1 && i === 1) || (m.lvl === 2 && i >= 2); bg.setAttribute("class", "hc-stg" + (on ? " on" : "")); });
  const shrink = 1 - 0.35 * healSm, vsc = 0.7 * shrink;
  const nAmb = Math.round(sm.V * amb.length);
  amb.forEach((a, i) => { const on = i < nAmb; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; }
    a.v.g.setAttribute("opacity", 0.85); a.x += (14 + i * 1.5) * dt; a.y = clamp(a.y + Math.sin(a.t * 0.9 + i * 2) * 8 * dt, 165, 370); place(a.v.g, a.x, a.y, 0, vsc);
    const dx = a.x - porta[0], dy = a.y - porta[1]; if (dx * dx + dy * dy < 26 * 26 || a.x > porta[0] + 8) { a.x = rnd(32, 60); a.y = rnd(170, 365); } });
  const nRel = Math.round(sm.V * rel.length);
  rel.forEach((a, i) => { const on = i < nRel; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; }
    a.v.g.setAttribute("opacity", 0.8); a.x += 9 * dt; a.y = clamp(a.y + Math.cos(a.t * 0.5 + i * 1.7) * 4 * dt, 232, 330); place(a.v.g, a.x, a.y, 0, vsc); if (a.x > 612) { a.x = EXITP[0] + rnd(-4, 4); a.y = EXITP[1] + rnd(-8, 8); } });
  prog.forEach((q) => { if (q.t >= 9) { q.v.g.setAttribute("opacity", 0); return; } q.t += dt; q.x += 8 * dt; q.y += 10 * dt; q.x = clamp(q.x, 420, 614); q.y = clamp(q.y, 250, 430); place(q.v.g, q.x, q.y, 0, 1); q.v.g.setAttribute("opacity", clamp(1.3 - q.t / 5).toFixed(2)); if (q.t > 6) q.t = 9; });
  const key = m.lvl + ":" + (m.blk3 ? "ns3" : m.blkB ? "ns5b" : m.blkA ? "ns5a" : "no");
  if (key !== outKey) { outKey = key; $("hcout").textContent = m.blk3 || m.blkB || m.blkA ? (m.lvl === 2 ? "Virus suppressed, scarring and cancer risk remain" : "Replication blocked: virus and injury fall") : m.lvl === 0 ? "Acute infection: may clear or become chronic" : m.lvl === 1 ? "Chronic infection: scarring builds over years" : "Cirrhosis: risk of failure and liver cancer"; }
  gg.virus.set(sm.V, wordOf(sm.V, 0.2, 0.55, ["low", "moderate", "high"])); gg.rep.set(sm.R, wordOf(sm.R, 0.2, 0.55, ["low", "moderate", "high"])); gg.inj.set(sm.Inj, wordOf(sm.Inj, 0.25, 0.58, ["low", "raised", "high"])); gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.2, 0.65, ["none", "some", "severe"])); gg.risk.set(sm.Risk, wordOf(sm.Risk, 0.2, 0.55, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
