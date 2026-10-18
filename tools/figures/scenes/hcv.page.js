/* Hepatitis C scene: virion journey in a hepatocyte, polyprotein cleavage, RNA replication, fibrosis progression and gauges. */
const W = SC.W, CX = 300, CY = 290, R = 100;
const L = { fib: $("fib"), cell: $("cellg"), steps: $("steps"), over: $("over"), prog: $("prog"), panel: $("panel") };
const NC = [340, 250], NR = 30, S0 = [CX - R, CY - 15], AS = [398, 288], POLY = [232, 338], NS3P = [305, 322], NSBP = [368, 338];
const STEPS = ["entry into the hepatocyte", "RNA genome released", "polyprotein made on the ER", "NS3 protease cleaves the polyprotein", "NS5B polymerase copies the RNA", "assembly and release"];
const DUR = [2, 1.8, 2.4, 2.4, 2.6, 2];
const ease = (t) => t * t * (3 - 2 * t);
const bez = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
/* ---- step strip ---- */
const boxes = STEPS.map((nm, i) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Step " + (i + 1) + ": " + nm }, L.steps); const b = mk("rect", { class: "hc-box", x: 30 + i * 62, y: 74, width: 54, height: 20, rx: 6 }, g); const t = mk("text", { class: "hc-bn", x: 30 + i * 62 + 27, y: 88, "text-anchor": "middle" }, g); t.textContent = String(i + 1); return b; });
/* ---- hepatocyte, nucleus, ER, receptors ---- */
const cellG = mk("g", {}, L.cell); cell(cellG, { cls: "hep", r: R, wob: 0.03, n: 12, seed: 4, x: CX, y: CY });
cell(cellG, { cls: "hnuc", r: NR, wob: 0.04, n: 10, seed: 6, x: NC[0], y: NC[1] });
mk("path", { class: "hc-er", d: "M222 352Q300 368 378 350" }, L.cell);
mk("path", { class: "hc-er", d: "M228 364Q300 378 372 362" }, L.cell);
[[240, 334], [268, 342], [296, 336], [324, 344]].forEach((p) => mk("circle", { cx: f1(p[0]), cy: f1(p[1]), r: 3.6, fill: "var(--anatomy-mid)" }, L.cell));
[168, 182, 196].forEach((a) => { const t = a * Math.PI / 180, x = CX + R * Math.cos(t), y = CY + R * Math.sin(t); const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(a - 180) + ")" }, L.cell); mk("path", { class: "hc-rna", d: "M0 0L-9 0M-9 0L-14 -5M-9 0L-14 5" }, g); });
const glow = mk("circle", { class: "hc-glow", cx: CX, cy: CY, r: R - 4, opacity: 0 }, L.cell);
/* fibrosis bands and cancer nodule */
const fibPaths = ["M432 214Q520 200 606 218", "M432 306Q520 292 606 310", "M440 372Q520 360 606 376", "M214 386Q300 374 386 388"].map((d) => mk("path", { class: "hc-fib", d, opacity: 0 }, L.fib));
const nod1 = mk("circle", { class: "hc-nod", cx: 500, cy: 340, r: 13, opacity: 0 }, L.fib);
const hccG = mk("g", { opacity: 0 }, L.fib); cell(hccG, { cls: "hep", r: 14, wob: 0.18, n: 8, seed: 9, x: 560, y: 398 }); mk("circle", { class: "hc-hccn", cx: 560, cy: 398, r: 5 }, hccG); hccG.querySelector(".cl-b").setAttribute("class", "hc-hcc");
/* ---- virion drawing ---- */
function virion(parent, sc) { const g = mk("g", {}, parent); let d = ""; for (let i = 0; i < 8; i++) { const t = i * 0.785; d += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 13) + " " + f1(Math.sin(t) * 13); } mk("path", { class: "hc-spk", d }, g); mk("circle", { class: "hc-env", r: 9 }, g); mk("circle", { class: "hc-core", r: 4.2 }, g); if (sc) g.setAttribute("transform", "scale(" + sc + ")"); return { g }; }
const hero = virion(L.cell);
const rnaEl = mk("path", { class: "hc-rna", d: "M-16 -3q4 -5 8 0t8 0t8 0t8 0", opacity: 0 }, L.cell);
const copyEls = [0, 1, 2].map((i) => mk("path", { class: "hc-rna2", d: "M-14 -2q4 -4 7 0t7 0t7 0", opacity: 0, transform: "translate(368 " + (322 - i * 14) + ")" }, L.cell));
/* polyprotein: one long chain of segments that later separate */
const polyG = mk("g", { opacity: 0 }, L.cell);
const segs = []; const segCols = ["#e85a7a", "#f08a4b", "#f2d27a", "#3a9a8c", "#3a86e8", "#8a7ac0"];
for (let i = 0; i < 6; i++) { segs.push(mk("rect", { class: "hc-seg", x: POLY[0] + i * 16, y: POLY[1] - 6, width: 15, height: 12, rx: 3, fill: segCols[i] }, polyG)); }
const ns3El = mk("circle", { class: "hc-ns3", cx: NS3P[0], cy: NS3P[1], r: 9, opacity: 0 }, L.cell);
const ns5bEl = mk("circle", { class: "hc-pol", cx: NSBP[0], cy: NSBP[1], r: 13, opacity: 0 }, L.cell);
const ns5aEls = [[386, 318], [396, 354], [350, 318]].map((p) => mk("circle", { class: "hc-ns5a", cx: p[0], cy: p[1], r: 4.5, opacity: 0 }, L.cell));
const bud = virion(L.cell); bud.g.setAttribute("opacity", 0);
const prog = Array.from({ length: 5 }, () => { const v = virion(L.cell); v.g.setAttribute("opacity", 0); return { v, t: 9, x: 0, y: 0 }; });
const amb = Array.from({ length: 7 }, () => { const v = virion(L.cell, 0.7); return { v, x: rnd(36, 150), y: rnd(180, 340), t: rnd(0, 6) }; });
const rel = Array.from({ length: 7 }, () => { const v = virion(L.cell, 0.7); return { v, x: rnd(440, 590), y: rnd(240, 325), t: rnd(0, 6) }; });
function xmark(x, y) { const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ")", opacity: 0 }, L.cell); mk("circle", { class: "hc-xc", r: 9 }, g); mk("path", { class: "hc-x", d: "M-4 -4L4 4M4 -4L-4 4" }, g); return g; }
const X3 = xmark(NS3P[0], NS3P[1] - 16), XB = xmark(NSBP[0], NSBP[1] - 20), XA = xmark(386, 302);
/* ---- labels ---- */
pill(L.over, "HCV virion", 62, 215, 92, 150, "Hepatitis C virion: an enveloped virus carrying a single positive-sense RNA genome.");
pill(L.over, "Entry receptors", S0[0], S0[1], 95, 335, "HCV enters hepatocytes using several surface receptors and co-receptors on the liver cell.");
pill(L.over, "Nucleus not used", NC[0] + 4, NC[1] - 8, 485, 128, "The nucleus is not used by HCV. Unlike hepatitis B or HIV, HCV stays in the cytoplasm and does not integrate into host DNA.");
pill(L.over, "RNA genome", 242, 298, 165, 198, "The HCV RNA genome: one positive-sense RNA strand. It is both the message for making proteins and the template that gets copied.");
pill(L.over, "Polyprotein", 270, 340, 165, 378, "One long polyprotein: the whole HCV genome is translated as a single chain, which then has to be cut into separate working proteins.");
pill(L.over, "NS3 protease", NS3P[0], NS3P[1], 285, 408, "NS3 protease: the viral cutter that cleaves the polyprotein. Blocking it stops working viral proteins being made.");
pill(L.over, "NS5B polymerase", NSBP[0], NSBP[1], 415, 382, "NS5B: the viral RNA-dependent RNA polymerase. It copies the RNA genome. Blocking it stops new genomes being made.");
pill(L.over, "NS5A", 386, 318, 475, 332, "NS5A: a viral protein with no enzyme activity that organises the replication complex and helps assembly. Blocking it disrupts both.");
pill(L.over, "New virions", 455, 285, 535, 282, "Complete new virions leave the hepatocyte to infect other hepatocytes.");
pill(L.over, "Fibrosis", 515, 205, 545, 168, "Fibrosis: scar tissue laid down after years of inflammation, injury and repair in chronic infection.");
pill(L.over, "Liver cancer", 560, 398, 580, 362, "Hepatocellular carcinoma (HCC): liver cancer that arises more often in a cirrhotic liver.");
pill(L.over, "NS3 inhibitor", NS3P[0], NS3P[1] - 16, 115, 418, "NS3 protease inhibitor: it blocks the viral cutter, so the polyprotein is not cleaved into working proteins.");
pill(L.over, "NS5B inhibitor", NSBP[0], NSBP[1] - 20, 260, 428, "NS5B polymerase inhibitor: it blocks RNA copying, so few new viral genomes are made.");
pill(L.over, "NS5A combination", 386, 302, 445, 418, "NS5A inhibitor combination: NS5A blockers are used with other direct-acting antivirals, disrupting replication and assembly together.");
const drugPills = L.over.querySelectorAll(".dr-lab");
/* ---- liver progression (right panel) ---- */
const stageEls = [];
[["Healthy liver", "hc-dot-h", "A healthy liver with little scar tissue. Acute HCV may clear or become chronic."], ["Fibrosis", "hc-dot-f", "Fibrosis: scar tissue builds up after years of chronic inflammation and repair."], ["Cirrhosis", "hc-dot-c", "Cirrhosis: severe, widespread scarring that distorts the liver and can lead to liver failure."], ["Liver cancer", "hc-dot-ca", "Hepatocellular carcinoma: liver cancer, which arises more often once cirrhosis is present."]].forEach(([nm, cls, tip], i) => {
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
const outT = mk("text", { class: "dr-pt2", x: 650, y: 414 }, L.prog); outT.textContent = "Outcome";
const out1 = mk("text", { class: "dr-pt2", x: 650, y: 432 }, L.prog);
/* ---- gauges ---- */
const gg = {};
{ const y0 = 478, P = L.panel; mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P); const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["virus", "Virus", "g-virus", "Hepatitis C virus in blood. Blocking NS3, NS5B or NS5A brings replication down."], ["rep", "Copying", "g-rep", "How actively the NS5B polymerase, helped by NS5A, is copying the RNA genome."], ["inj", "Injury", "g-inj", "Liver injury from chronic inflammation as infected hepatocytes are attacked and replaced."], ["fib", "Fibrosis", "g-fib", "Scar tissue laid down after years of injury and repair. Severe fibrosis is cirrhosis."], ["risk", "Cancer risk", "g-risk", "Risk of hepatocellular carcinoma, highest once cirrhosis is present."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 110 + i * 185, y0 + 2, 52, 18, cls, name, tip); }); }
/* ---- state ---- */
const sm = { V: 0.5, R: 0.5, Inj: 0.4, Fib: 0.3, Risk: 0.1 };
const hs = { step: 0, t: 0, stall: 0, chk: false };
let outKey = "";
function stepName() { const s = $("stepname"); if (s) s.textContent = "Step " + (hs.step + 1) + ": " + STEPS[hs.step] + (hs.stall > 0 ? " (blocked)" : ""); boxes.forEach((b, i) => b.setAttribute("class", "hc-box" + (i === hs.step ? " on" : ""))); }
function hideJourney() { [hero.g, rnaEl, bud.g].forEach((e) => e.setAttribute("opacity", 0)); polyG.setAttribute("opacity", 0); ns3El.setAttribute("opacity", 0); ns5bEl.setAttribute("opacity", 0); ns5aEls.forEach((e) => e.setAttribute("opacity", 0)); copyEls.forEach((e) => e.setAttribute("opacity", 0)); segs.forEach((sg, i) => sg.setAttribute("x", f1(POLY[0] + i * 16))); }
function nextVirion() { hs.step = 0; hs.t = 0; hs.stall = 0; hs.chk = false; hideJourney(); stepName(); }
function journey(dt, m) {
  if (hs.stall > 0) { hs.stall -= dt; const k = clamp(hs.stall / 1.3); hero.g.setAttribute("opacity", k.toFixed(2)); polyG.setAttribute("opacity", k.toFixed(2)); if (hs.stall <= 0) nextVirion(); return; }
  const s = hs.step; hs.t += dt; const p = clamp(hs.t / DUR[s]), e = ease(p);
  if (!hs.chk && ((s === 3 && p > 0.15) || (s === 4 && p > 0.15) || (s === 5 && p > 0.15))) { hs.chk = true; const blk = s === 3 ? m.blk3 : s === 4 ? (m.blkB || m.blkA * 0.7) : m.blkA; if (blk > 0 && Math.random() < blk) { hs.stall = 1.3; stepName(); return; } }
  hideJourney();
  if (s === 0) { const q = bez([52, 215], [S0[0] - 8, S0[1]], e); place(hero.g, q[0], q[1], 0, 1); hero.g.setAttribute("opacity", 1); }
  else if (s === 1) { hero.g.setAttribute("opacity", (1 - p).toFixed(2)); place(hero.g, S0[0] + 14, S0[1], 0, 1); const q = bez([S0[0] + 16, S0[1]], [242, 298], e); rnaEl.setAttribute("opacity", 1); place(rnaEl, q[0], q[1], 0, 1); }
  else if (s === 2) { rnaEl.setAttribute("opacity", 1); place(rnaEl, 258, 322, 0, 1); polyG.setAttribute("opacity", 1); segs.forEach((sg, i) => sg.setAttribute("opacity", clamp(p * 6 - i) > 0 ? "1" : "0")); }
  else if (s === 3) { polyG.setAttribute("opacity", 1); ns3El.setAttribute("opacity", 1); ns3El.setAttribute("cx", f1(lerp(POLY[0] + 8, POLY[0] + 88, e))); segs.forEach((sg, i) => { sg.setAttribute("opacity", "1"); sg.setAttribute("x", f1(POLY[0] + i * 16 + i * e * 5)); }); }
  else if (s === 4) { polyG.setAttribute("opacity", 0.35); ns5bEl.setAttribute("opacity", 1); ns5aEls.forEach((el) => el.setAttribute("opacity", 1)); rnaEl.setAttribute("opacity", 1); place(rnaEl, 352, 306, 0, 1); copyEls.forEach((el, i) => el.setAttribute("opacity", clamp(p * 3 - i * 0.7) > 0 ? "1" : "0")); }
  else { ns5aEls.forEach((el) => el.setAttribute("opacity", 1)); const q = bez([AS[0] - 6, AS[1] - 4], [520, 282], e); bud.g.setAttribute("opacity", 1); place(bud.g, q[0], q[1], 0, 1); }
  if (p >= 1) { if (s === 5) { const pr = prog.find((q) => q.t >= 9) || prog[0]; pr.t = 0; pr.x = 524; pr.y = 282; nextVirion(); } else { hs.step++; hs.t = 0; hs.chk = false; stepName(); } }
}
function init() { stepName(); hideJourney(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.V = lerp(sm.V, m.V, k); sm.R = lerp(sm.R, m.R, k); sm.Inj = lerp(sm.Inj, m.Inj, k); sm.Fib = lerp(sm.Fib, m.Fib, k); sm.Risk = lerp(sm.Risk, m.Risk, k);
  journey(dt, m);
  X3.setAttribute("opacity", m.blk3 > 0 ? "1" : "0"); XB.setAttribute("opacity", m.blkB > 0 ? "1" : "0"); XA.setAttribute("opacity", m.blkA > 0 ? "1" : "0");
  drugPills.forEach((g, i) => { if (i === 11) g.style.opacity = m.blk3 ? "1" : "0"; if (i === 12) g.style.opacity = m.blkB ? "1" : "0"; if (i === 13) g.style.opacity = m.blkA ? "1" : "0"; });
  glow.setAttribute("opacity", (sm.Inj * 0.45).toFixed(2));
  fibPaths.forEach((p) => p.setAttribute("opacity", (sm.Fib * 0.75).toFixed(2)));
  nod1.setAttribute("opacity", (sm.Fib * 0.9).toFixed(2));
  hccG.setAttribute("opacity", m.lvl === 2 ? "1" : "0");
  stageEls.forEach((bg, i) => { const on = (m.lvl === 0 && i === 0) || (m.lvl === 1 && i === 1) || (m.lvl === 2 && i >= 2); bg.setAttribute("class", "hc-stg" + (on ? " on" : "")); });
  const nAmb = Math.round(sm.V * amb.length);
  amb.forEach((a, i) => { const on = i < nAmb; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; } a.v.g.setAttribute("opacity", 0.85); a.x += 18 * dt; a.y = clamp(a.y + Math.sin(a.t * 0.9 + i * 2) * 8 * dt, 172, 342); if (a.x > S0[0] - 26) { a.x = rnd(32, 60); a.y = rnd(180, 335); } place(a.v.g, a.x, a.y, 0, 0.7); });
  const nRel = Math.round(sm.V * rel.length);
  rel.forEach((a, i) => { const on = i < nRel; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; } a.v.g.setAttribute("opacity", 0.8); a.x += Math.sin(a.t * 0.7 + i) * 5 * dt; a.y += Math.cos(a.t * 0.5 + i * 1.7) * 4 * dt; a.x = clamp(a.x, 436, 604); a.y = clamp(a.y, 232, 330); place(a.v.g, a.x, a.y, 0, 0.7); });
  prog.forEach((q) => { if (q.t >= 9) { q.v.g.setAttribute("opacity", 0); return; } q.t += dt; q.x += 13 * dt; q.y += 6 * dt; q.x = clamp(q.x, 420, 610); q.y = clamp(q.y, 250, 340); place(q.v.g, q.x, q.y, 0, 1); q.v.g.setAttribute("opacity", clamp(1.3 - q.t / 5).toFixed(2)); if (q.t > 6) q.t = 9; });
  const key = m.lvl + ":" + (m.blk3 ? "ns3" : m.blkB ? "ns5b" : m.blkA ? "ns5a" : "no");
  if (key !== outKey) { outKey = key; out1.textContent = m.blk3 || m.blkB || m.blkA ? (m.lvl === 2 ? "Virus suppressed, scarring and cancer risk remain" : "Replication blocked: virus and injury fall") : m.lvl === 0 ? "Acute infection: may clear or become chronic" : m.lvl === 1 ? "Chronic infection: scarring builds over years" : "Cirrhosis: risk of failure and liver cancer"; }
  gg.virus.set(sm.V, wordOf(sm.V, 0.2, 0.55, ["low", "moderate", "high"])); gg.rep.set(sm.R, wordOf(sm.R, 0.2, 0.55, ["low", "moderate", "high"])); gg.inj.set(sm.Inj, wordOf(sm.Inj, 0.25, 0.58, ["low", "raised", "high"])); gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.2, 0.65, ["none", "some", "severe"])); gg.risk.set(sm.Risk, wordOf(sm.Risk, 0.2, 0.55, ["low", "raised", "high"]));
}
run({ init, step });
