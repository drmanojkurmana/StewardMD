/* Hepatitis B scene: virion journey in a hepatocyte, T cell injury, fibrosis, marker curves and gauges. */
const W = SC.W, CX = 305, CY = 272, R = 118;
const L = { fib: $("fib"), cell: $("cellg"), steps: $("steps"), over: $("over"), plot: $("plot"), panel: $("panel") };
const NC = [340, 260], NR = 46, S0 = [CX - R, CY - 8], AS = [398, 345], OUT = [0.79, 0.61];
const RB = [[312, 336], [348, 346], [282, 348]], POL = [265, 322], CTLH = [505, 178], CTLC = [438, 248];
const STEPS = ["entry via NTCP", "cccDNA in the nucleus", "making viral RNA and proteins", "reverse transcription by polymerase", "assembly", "release"];
const DUR = [2, 1.8, 2.6, 2.4, 2, 1.8];
const ease = (t) => t * t * (3 - 2 * t);
const bez = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
/* ---- step strip ---- */
const boxes = STEPS.map((nm, i) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Step " + (i + 1) + ": " + nm }, L.steps); const b = mk("rect", { class: "hb-box", x: 30 + i * 62, y: 74, width: 54, height: 20, rx: 6 }, g); const t = mk("text", { class: "hb-bn", x: 30 + i * 62 + 27, y: 88, "text-anchor": "middle" }, g); t.textContent = String(i + 1); return b; });
/* ---- hepatocyte, nucleus, receptors ---- */
const cellG = mk("g", {}, L.cell); cell(cellG, { cls: "hep", r: R, wob: 0.03, n: 12, seed: 4, x: CX, y: CY });
cell(cellG, { cls: "hnuc", r: NR, wob: 0.04, n: 10, seed: 6, x: NC[0], y: NC[1] });
mk("path", { class: "hb-host", d: "M" + f1(NC[0] - 34) + " " + f1(NC[1] + 16) + "Q" + f1(NC[0] - 8) + " " + f1(NC[1] - 26) + " " + f1(NC[0] + 10) + " " + f1(NC[1] - 4) + "T" + f1(NC[0] + 36) + " " + f1(NC[1] + 18) }, L.cell);
const cccEl = mk("circle", { class: "hb-ccc", cx: f1(NC[0] + 2), cy: f1(NC[1] - 10), r: 11, opacity: 0 }, L.cell);
RB.forEach((p) => mk("circle", { class: "hv-ribo hb-ribo", cx: f1(p[0]), cy: f1(p[1]), r: 4, fill: "var(--anatomy-mid)" }, L.cell));
[168, 180, 192].forEach((a) => { const t = a * Math.PI / 180, x = CX + R * Math.cos(t), y = CY + R * Math.sin(t); const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(a - 180) + ")" }, L.cell); mk("path", { class: "hb-rec", d: "M0 0L-10 0M-10 0L-16 -5M-10 0L-16 5" }, g); });
/* fibrosis bands and cancer nodule (behind pills, over tissue) */
const fibPaths = ["M196 214Q300 196 414 218", "M192 300Q300 282 418 304", "M205 362Q305 346 405 366", "M432 240Q520 228 606 244", "M432 386Q520 374 606 390"].map((d) => mk("path", { class: "hb-fib", d, opacity: 0 }, L.fib));
const nod1 = mk("circle", { class: "hb-nod", cx: 478, cy: 322, r: 15, opacity: 0 }, L.fib);
const hccG = mk("g", { opacity: 0 }, L.fib); cell(hccG, { cls: "hep", r: 14, wob: 0.18, n: 8, seed: 9, x: 565, y: 402 }); mk("circle", { class: "hb-hccn", cx: 565, cy: 402, r: 5 }, hccG); hccG.querySelector(".cl-b").setAttribute("class", "hb-hcc");
/* cytotoxic T cell */
const ctlG = mk("g", {}, L.cell); const ctlCell = cell(ctlG, { cls: "ctl", r: 24, nuc: 0.5, seed: 11, wob: 0.12, x: CTLH[0], y: CTLH[1] });
const glow = mk("circle", { class: "hb-glow", r: 16, opacity: 0 }, L.cell);
/* ---- virion drawing ---- */
function virion(parent, sc) { const g = mk("g", {}, parent); let d = ""; for (let i = 0; i < 8; i++) { const t = i * 0.785; d += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 13) + " " + f1(Math.sin(t) * 13); } mk("path", { class: "hb-spk", d }, g); mk("circle", { class: "hb-env", r: 9 }, g); mk("circle", { class: "hb-core", r: 4.2 }, g); if (sc) g.setAttribute("transform", "scale(" + sc + ")"); return { g }; }
const hero = virion(L.cell), capG = mk("g", { opacity: 0 }, L.cell); mk("path", { class: "hb-core", d: "M-4 -8L4 -8L2 8L-2 8Z" }, capG);
const rnaEl = mk("path", { class: "hb-rna", d: "M-14 -3q4 -5 7 0t7 0t7 0t7 0", opacity: 0 }, L.cell);
const dnaEl = mk("path", { class: "hb-dna", d: "", opacity: 0 }, L.cell);
const mrnas = Array.from({ length: 3 }, () => mk("circle", { class: "hb-mrna", r: 3, opacity: 0 }, L.cell));
const prots = Array.from({ length: 8 }, () => mk("circle", { class: "hb-prot", r: 3, opacity: 0 }, L.cell));
const bud = virion(L.cell); bud.g.setAttribute("opacity", 0);
const prog = Array.from({ length: 5 }, () => { const v = virion(L.cell); v.g.setAttribute("opacity", 0); return { v, t: 9, x: 0, y: 0 }; });
const amb = Array.from({ length: 8 }, () => { const v = virion(L.cell, 0.7); return { v, x: rnd(36, 140), y: rnd(175, 335), t: rnd(0, 6) }; });
const svps = Array.from({ length: 20 }, () => { const e = mk("circle", { class: "hb-svp", r: 3, opacity: 0 }, L.cell); return { e, x: rnd(438, 602), y: rnd(118, 382), t: rnd(0, 6) }; });
const abs = Array.from({ length: 5 }, (_, i) => { const g = mk("g", { opacity: 0 }, L.cell); mk("path", { class: "hb-ab", d: "M0 0L0 -7M0 -7L-5 -12M0 -7L5 -12" }, g); return { g, x: 78 + i * 22, y: 232 + (i % 2) * 26 }; });
function xmark(x, y) { const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ")", opacity: 0 }, L.cell); mk("circle", { class: "hb-xc", r: 9 }, g); mk("path", { class: "hb-x", d: "M-4 -4L4 4M4 -4L-4 4" }, g); return g; }
const Xpol = xmark(POL[0], POL[1] - 18);
/* ---- labels ---- */
pill(L.over, "HBV virion", 62, 205, 90, 150, "Hepatitis B virion (Dane particle): an envelope carrying HBsAg around a core with partly double-stranded DNA and polymerase.");
pill(L.over, "NTCP entry", S0[0], S0[1], 90, 310, "NTCP, the bile-acid transporter on hepatocytes, is the entry receptor for hepatitis B.");
pill(L.over, "cccDNA", NC[0] + 4, NC[1] - 10, 485, 125, "cccDNA: the viral DNA kept as a stable mini-chromosome in the nucleus. It is the template for all viral RNAs and is hard to clear.");
pill(L.over, "T cell (CTL)", CTLH[0], CTLH[1] - 24, 525, 228, "Cytotoxic T cell: it kills infected hepatocytes. This immune attack, not the virus itself, is the main cause of liver injury.");
pill(L.over, "HBsAg particles", 470, 300, 510, 285, "Empty HBsAg particles: far more numerous than complete virions. HBsAg in blood marks current infection.");
pill(L.over, "New virions", AS[0] + 8, AS[1] + 8, 510, 355, "Complete new virions leave the hepatocyte to infect other hepatocytes and other people.");
pill(L.over, "Polymerase", POL[0], POL[1], 95, 365, "Viral polymerase (reverse transcriptase): it copies pregenomic RNA back into DNA. Nucleoside analogues block it.");
pill(L.over, "Vaccine antibody", 105, 232, 110, 215, "Vaccine antibody (anti-HBs): it coats the virion and blocks entry. Vaccination prevents infection but does not clear established cccDNA.");
pill(L.over, "Nucleoside drug", POL[0], POL[1] - 18, 150, 415, "Nucleoside analogue: a faulty building block that stops the polymerase, so viral replication and inflammation fall, but cccDNA often persists.");
pill(L.over, "Liver cancer", 565, 402, 492, 420, "Hepatocellular carcinoma (HCC): liver cancer that arises more often in a cirrhotic liver.");
const drugPills = L.over.querySelectorAll(".dr-lab");
/* ---- marker plot ---- */
const PX0 = 664, PX1 = 922, PY0 = 120, PY1 = 278, PW = PX1 - PX0, PH = PY1 - PY0;
const SAG_PTS = [[[0, 0.15], [0.15, 0.85], [0.35, 0.9], [0.55, 0.45], [0.7, 0.08], [1, 0.02]], [[0, 0.7], [0.3, 0.88], [1, 0.92]], [[0, 0.75], [0.4, 0.84], [1, 0.85]]];
const ANTI_PTS = [[[0, 0], [0.5, 0], [0.65, 0.1], [0.8, 0.75], [1, 0.9]], [[0, 0.03], [1, 0.03]], [[0, 0.03], [1, 0.03]]];
const EAG_PTS = [[[0, 0.1], [0.2, 0.8], [0.4, 0.5], [0.55, 0.05], [1, 0]], [[0, 0.85], [0.6, 0.75], [1, 0.55]], [[0, 0.6], [0.6, 0.42], [1, 0.3]]];
const evalPts = (pts, u) => { for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i], f = (u - a[0]) / Math.max(0.001, b[0] - a[0]); return lerp(a[1], b[1], ease(f)); } return pts[pts.length - 1][1]; };
const px = (u) => PX0 + u * PW, py = (v) => PY1 - v * PH;
mk("path", { class: "pl-ax", d: "M" + PX0 + " " + (PY0 - 6) + "L" + PX0 + " " + PY1 + "L" + PX1 + " " + PY1 }, L.plot);
[["early", 0.12], ["later", 0.5], ["long term", 0.86]].forEach(([t, u]) => { const e = mk("text", { class: "dr-pt2", x: f1(px(u)), y: PY1 + 14, "text-anchor": "middle" }, L.plot); e.textContent = t; });
const axT = mk("text", { class: "dr-pt2", x: PX0, y: PY0 - 14 }, L.plot); axT.textContent = "higher is more";
const curves = { sagb: mk("path", { class: "pl-sag base" }, L.plot), sag: mk("path", { class: "pl-sag" }, L.plot), antib: mk("path", { class: "pl-anti base" }, L.plot), anti: mk("path", { class: "pl-anti" }, L.plot), eagb: mk("path", { class: "pl-eag base" }, L.plot), eag: mk("path", { class: "pl-eag" }, L.plot) };
const mkr = mk("path", { class: "pl-mk" }, L.plot), dots = [mk("circle", { class: "pl-dot", r: 3.6 }, L.plot), mk("circle", { class: "pl-dot", r: 3.6 }, L.plot)];
const poly = (fn, n) => { let d = ""; for (let i = 0; i <= n; i++) { const u = i / n; d += (i ? "L" : "M") + f1(px(u)) + " " + f1(py(clamp(fn(u)))); } return d; };
function legend(x, y, cls, name, tip) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.plot); mk("path", { class: cls, d: "M" + x + " " + y + "l22 0" }, g); const t = mk("text", { class: "dr-pt2", x: x + 28, y: y + 4 }, g); t.textContent = name; }
legend(PX0, 312, "pl-sag", "HBsAg", "HBsAg (surface antigen): marks current infection. Lost in resolution, persistent in chronic infection.");
legend(PX0 + 128, 312, "pl-anti", "Anti-HBs", "Anti-HBs (surface antibody): marks recovery after infection and immunity after vaccination.");
legend(PX0, 332, "pl-eag", "HBeAg", "HBeAg (e antigen): marks active replication and infectivity. Its loss with anti-HBe is seroconversion.");
const outT = mk("text", { class: "dr-pt2", x: 650, y: 360 }, L.plot); outT.textContent = "Outcome";
const out1 = mk("text", { class: "dr-pt2", x: 650, y: 380 }, L.plot), out2 = mk("text", { class: "dr-pt2", x: 650, y: 398 }, L.plot);
/* ---- gauges ---- */
const gg = {};
{ const y0 = 478, P = L.panel; mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P); const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["virus", "Virus", "g-virus", "Viral replication in blood (HBV DNA). Nucleoside analogues bring this down."], ["sag", "HBsAg", "g-sag", "Surface antigen in blood: marks current infection and usually persists while cccDNA persists."], ["anti", "Anti-HBs", "g-anti", "Protective surface antibody: present after recovery or vaccination."], ["inj", "Injury", "g-inj", "Liver injury from immune killing of infected hepatocytes (the ALT pattern)."], ["fib", "Fibrosis", "g-fib", "Scar tissue laid down after years of injury and repair. Severe fibrosis is cirrhosis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 110 + i * 185, y0 + 2, 52, 18, cls, name, tip); }); }
/* ---- state ---- */
const sm = { V: 0.5, Sag: 0.5, Eag: 0.5, Inj: 0.4, Fib: 0.3, Anti: 0.1, Ccc: 0.5, pos: 0.48 };
const hs = { step: 0, t: 0, stall: 0, chk: false, formed: false };
let outKey = "";
function stepName() { const s = $("stepname"); if (s) s.textContent = "Step " + (hs.step + 1) + ": " + STEPS[hs.step] + (hs.stall > 0 ? " (blocked)" : ""); boxes.forEach((b, i) => b.setAttribute("class", "hb-box" + (i === hs.step ? " on" : ""))); }
function hideJourney() { [hero.g, capG, rnaEl, dnaEl, bud.g].forEach((e) => e.setAttribute("opacity", 0)); mrnas.concat(prots).forEach((e) => e.setAttribute("opacity", 0)); }
function nextVirion() { hs.step = 0; hs.t = 0; hs.stall = 0; hs.chk = false; hideJourney(); stepName(); }
function dnaPath(a, len, prog) { let d = ""; const n = Math.max(2, Math.round(22 * prog)); for (let i = 0; i <= n; i++) { const f = i / 22; d += (i ? "L" : "M") + f1(a[0] + f * len) + " " + f1(a[1] + Math.sin(f * 13) * 3.5); } return d; }
function journey(dt, m) {
  if (hs.stall > 0) { hs.stall -= dt; const k = clamp(hs.stall / 1.3); hero.g.setAttribute("opacity", k.toFixed(2)); if (hs.step === 3) capG.setAttribute("opacity", k.toFixed(2)); if (hs.stall <= 0) nextVirion(); return; }
  const s = hs.step; hs.t += dt; const p = clamp(hs.t / DUR[s]), e = ease(p);
  if (!hs.chk && ((s === 0 && p > 0.75) || (s === 3 && p > 0.1))) { hs.chk = true; const blk = s === 0 ? m.blkE : m.blkP; if (blk > 0 && Math.random() < blk) { hs.stall = 1.3; stepName(); return; } }
  hideJourney();
  if (s === 0) { const q = bez([52, 205], [S0[0] - 10, S0[1]], e); place(hero.g, q[0], q[1], 0, 1); hero.g.setAttribute("opacity", 1); }
  else if (s === 1) { const q = bez([S0[0] + 6, S0[1]], [NC[0] - NR + 4, NC[1]], e); capG.setAttribute("opacity", 1); place(capG, q[0], q[1], 60, 1); if (p > 0.7) { hs.formed = true; glow.setAttribute("opacity", 0.7); glow.setAttribute("cx", f1(NC[0])); glow.setAttribute("cy", f1(NC[1] - 10)); glow.setAttribute("r", 15); } }
  else if (s === 2) { mrnas.forEach((r, i) => { const f = clamp(p * 1.4 - i * 0.2); if (f <= 0) return; const q = bez([NC[0], NC[1] + 8], RB[i], ease(f)); r.setAttribute("opacity", p < 0.85 ? 1 : 0); r.setAttribute("cx", f1(q[0])); r.setAttribute("cy", f1(q[1])); }); prots.forEach((r, i) => { const f = clamp(p * 1.3 - i * 0.08); if (f <= 0) return; const b = RB[i % 3]; r.setAttribute("opacity", 1); r.setAttribute("cx", f1(b[0] + Math.sin(i * 2.1) * 13)); r.setAttribute("cy", f1(b[1] - 9 - (i % 3) * 7)); }); }
  else if (s === 3) { capG.setAttribute("opacity", 1); place(capG, POL[0], POL[1], 60, 1); rnaEl.setAttribute("opacity", (1 - clamp(p * 1.3 - 0.15)).toFixed(2)); place(rnaEl, POL[0] + 2, POL[1] - 6, 0, 1); dnaEl.setAttribute("opacity", 1); dnaEl.setAttribute("d", dnaPath([POL[0] - 20, POL[1] + 10], 46, clamp(p * 1.2))); }
  else if (s === 4) { prots.forEach((r, i) => { const q = bez([RB[i % 3][0] + Math.sin(i * 2.1) * 13, RB[i % 3][1] - 9 - (i % 3) * 7], [AS[0] - 12 + (i % 4) * 5, AS[1] - 12 + (i % 3) * 6], ease(clamp(p * 1.4))); r.setAttribute("opacity", p < 0.95 ? 1 : 0); r.setAttribute("cx", f1(q[0])); r.setAttribute("cy", f1(q[1])); }); bud.g.setAttribute("opacity", (p * 0.7).toFixed(2)); place(bud.g, AS[0] - 6, AS[1] - 6, 0, 0.6); }
  else { const o = 4 + 26 * e, q = [AS[0] + OUT[0] * o, AS[1] + OUT[1] * o]; bud.g.setAttribute("opacity", 1); place(bud.g, q[0], q[1], 0, 1); }
  if (p >= 1) { if (s === 5) { const pr = prog.find((q) => q.t >= 9) || prog[0]; pr.t = 0; pr.x = AS[0] + OUT[0] * 30; pr.y = AS[1] + OUT[1] * 30; nextVirion(); } else { hs.step++; hs.t = 0; hs.chk = false; stepName(); } }
}
function init() { stepName(); hideJourney(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.V = lerp(sm.V, m.V, k); sm.Sag = lerp(sm.Sag, m.Sag, k); sm.Eag = lerp(sm.Eag, m.Eag, k); sm.Inj = lerp(sm.Inj, m.Inj, k); sm.Fib = lerp(sm.Fib, m.Fib, k); sm.Anti = lerp(sm.Anti, m.Anti, k); sm.Ccc = lerp(sm.Ccc, m.Ccc, k); sm.pos = lerp(sm.pos, m.pos, Math.min(1, dt * 2));
  journey(dt, m);
  cccEl.setAttribute("opacity", hs.formed ? sm.Ccc.toFixed(2) : "0");
  Xpol.setAttribute("opacity", m.blkP > 0 ? "1" : "0");
  /* drug pills: indices in creation order (7 vaccine, 8 nucleoside) */
  drugPills.forEach((g, i) => { if (i === 7) g.style.opacity = m.vac ? "1" : "0"; if (i === 8) g.style.opacity = m.na ? "1" : "0"; });
  /* T cell attack: approach, contact flash, injury */
  const atk = sm.Inj * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(tm / 850)));
  const cp = bez(CTLH, CTLC, clamp(atk * 1.15));
  ctlG.setAttribute("transform", "translate(" + f1(cp[0] - CTLH[0]) + " " + f1(cp[1] - CTLH[1]) + ")");
  if (hs.step !== 1) { glow.setAttribute("cx", f1(CTLC[0] + 8)); glow.setAttribute("cy", f1(CTLC[1])); glow.setAttribute("r", 16); glow.setAttribute("opacity", atk > 0.55 ? (sm.Inj * 0.8).toFixed(2) : "0"); }
  /* fibrosis and cancer */
  fibPaths.forEach((p) => p.setAttribute("opacity", (sm.Fib * 0.75).toFixed(2)));
  nod1.setAttribute("opacity", (sm.Fib * 0.9).toFixed(2));
  hccG.setAttribute("opacity", m.lvl === 2 ? "1" : "0"); hccG.setAttribute("transform", "scale(1)");
  /* ambient virions and HBsAg particles */
  const nAmb = Math.round(sm.V * amb.length);
  amb.forEach((a, i) => { const on = i < nAmb; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; } a.v.g.setAttribute("opacity", 0.85); a.x += 20 * dt; a.y = clamp(a.y + Math.sin(a.t * 0.9 + i * 2) * 9 * dt, 168, 338); if (a.x > S0[0] - 24) { a.x = rnd(32, 66); a.y = rnd(175, 335); } place(a.v.g, a.x, a.y, 0, 0.7); });
  const nSvp = Math.round(sm.Sag * svps.length);
  svps.forEach((a, i) => { const on = i < nSvp; a.t += dt; if (!on) { a.e.setAttribute("opacity", 0); return; } a.e.setAttribute("opacity", 0.9); a.x += Math.sin(a.t * 0.7 + i) * 6 * dt; a.y += Math.cos(a.t * 0.5 + i * 1.7) * 5 * dt; a.x = clamp(a.x, 436, 604); a.y = clamp(a.y, 116, 384); a.e.setAttribute("cx", f1(a.x)); a.e.setAttribute("cy", f1(a.y)); });
  abs.forEach((a, i) => { a.g.style.opacity = m.vac ? "1" : "0"; place(a.g, a.x + Math.sin(tm / 600 + i) * 3, a.y + Math.cos(tm / 700 + i) * 3, Math.sin(tm / 800 + i) * 14, 1); });
  prog.forEach((q) => { if (q.t >= 9) { q.v.g.setAttribute("opacity", 0); return; } q.t += dt; q.x += 14 * dt; q.y += 9 * dt; place(q.v.g, q.x, q.y, 0, 1); q.v.g.setAttribute("opacity", clamp(1.3 - q.t / 5).toFixed(2)); if (q.t > 6) q.t = 9; });
  /* marker curves: dashed untreated, solid with intervention */
  const lvl = m.lvl, sagF = m.na ? 0.88 : 1 - m.vacEff * 0.55, eagF = m.na ? 0.3 : 1 - m.vacEff * 0.5;
  curves.sagb.setAttribute("d", poly((u) => evalPts(SAG_PTS[lvl], u), 60)); curves.sag.setAttribute("d", poly((u) => evalPts(SAG_PTS[lvl], u) * sagF, 60));
  curves.antib.setAttribute("d", poly((u) => evalPts(ANTI_PTS[lvl], u), 60)); curves.anti.setAttribute("d", poly((u) => clamp(evalPts(ANTI_PTS[lvl], u) + (m.vac ? 0.35 * u : 0)), 60));
  curves.eagb.setAttribute("d", poly((u) => evalPts(EAG_PTS[lvl], u), 60)); curves.eag.setAttribute("d", poly((u) => evalPts(EAG_PTS[lvl], u) * eagF, 60));
  mkr.setAttribute("d", "M" + f1(px(sm.pos)) + " " + (PY0 - 6) + "L" + f1(px(sm.pos)) + " " + PY1);
  dots[0].setAttribute("cx", f1(px(sm.pos))); dots[0].setAttribute("cy", f1(py(evalPts(SAG_PTS[lvl], sm.pos) * sagF)));
  dots[1].setAttribute("cx", f1(px(sm.pos))); dots[1].setAttribute("cy", f1(py(clamp(evalPts(ANTI_PTS[lvl], sm.pos) + (m.vac ? 0.35 * sm.pos : 0)))));
  const key = lvl + ":" + (m.na ? "na" : m.vac ? "vac" : "no");
  if (key !== outKey) { outKey = key; const lines = m.na && lvl === 0 ? ["Virus suppressed in acute illness;", "clearance still depends on immunity"] : m.vac && lvl === 0 ? ["Antibodies block entry: infection is", "prevented or cleared (anti-HBs)"] : m.na && lvl === 1 ? ["Polymerase blocked: virus falls, but", "cccDNA and HBsAg often persist"] : m.na && lvl === 2 ? ["Virus suppressed, but scarring and", "cancer risk remain"] : lvl === 0 ? ["Immune clearance: HBsAg is lost and", "anti-HBs appears (resolved)"] : lvl === 1 ? ["HBsAg persists: chronic infection", "with ongoing injury and scarring"] : ["Cirrhosis: risk of liver failure", "and liver cancer (HCC)"]; out1.textContent = lines[0]; out2.textContent = lines[1]; }
  gg.virus.set(sm.V, wordOf(sm.V, 0.2, 0.55, ["low", "moderate", "high"])); gg.sag.set(sm.Sag, wordOf(sm.Sag, 0.2, 0.6, ["cleared", "present", "high"])); gg.anti.set(sm.Anti, wordOf(sm.Anti, 0.2, 0.6, ["absent", "low", "present"])); gg.inj.set(sm.Inj, wordOf(sm.Inj, 0.25, 0.58, ["low", "raised", "high"])); gg.fib.set(sm.Fib, wordOf(sm.Fib, 0.2, 0.65, ["none", "some", "severe"]));
}
run({ init, step });
