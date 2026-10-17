/* HIV scene: one virion's life cycle through a CD4 T cell, the over-the-years plot, and the gauges. */
const W = SC.W, CX = 312, CY = 268, R = 160;
const L = { steps: $("steps"), cell: $("cellg"), over: $("over"), plot: $("plot"), panel: $("panel") };
const STEPS = ["binding", "fusion", "reverse transcription (RNA to DNA)", "integration into the host DNA", "transcription", "translation", "assembly", "budding", "maturation"];
const DUR = [2.2, 1.6, 2.6, 2.8, 1.8, 2, 2, 1.6, 2];
const NC = [CX + 52, CY - 4], NR = 64, S0 = [CX - R + 2, CY - 8], C1 = [CX - 84, CY - 2], PORE = [NC[0] - NR, CY - 4], INT = [NC[0], CY - 24];
const PB = [NC[0], NC[1] + NR], RB = [[NC[0] - 34, CY + 98], [NC[0] + 8, CY + 108], [NC[0] + 48, CY + 94]];
const ANG = 40 * Math.PI / 180, AS = [CX + R * Math.cos(ANG), CY + R * Math.sin(ANG)], OUT = [Math.cos(ANG), Math.sin(ANG)], REL = [AS[0] + 74, AS[1] + 50];
const ease = (t) => t * t * (3 - 2 * t);
const bez = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
/* ---- step strip ---- */
const boxes = STEPS.map((nm, i) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Step " + (i + 1) + ": " + nm }, L.steps); const b = mk("rect", { class: "hv-box", x: 30 + i * 62, y: 74, width: 54, height: 20, rx: 6 }, g); const t = mk("text", { class: "hv-bn", x: 30 + i * 62 + 27, y: 88, "text-anchor": "middle" }, g); t.textContent = String(i + 1); return b; });
/* ---- the cell, nucleus, receptors ---- */
const cellG = mk("g", {}, L.cell); cell(cellG, { cls: "cd4", r: R, wob: 0.025, n: 12, seed: 3, x: CX, y: CY });
cell(cellG, { cls: "nuc", r: NR, wob: 0.04, n: 10, seed: 5, x: NC[0], y: NC[1] });
mk("path", { class: "hv-host", d: "M" + f1(NC[0] - 42) + " " + f1(CY + 18) + "Q" + f1(NC[0] - 10) + " " + f1(CY - 30) + " " + f1(NC[0] + 8) + " " + f1(CY - 6) + "T" + f1(NC[0] + 46) + " " + f1(CY + 20) }, L.cell);
const prov = mk("path", { class: "hv-prov", d: "M" + f1(NC[0] - 10) + " " + f1(CY - 18) + "Q" + f1(NC[0] - 2) + " " + f1(CY - 24) + " " + f1(NC[0] + 8) + " " + f1(CY - 6), opacity: 0 }, L.cell);
RB.forEach((p) => mk("circle", { class: "hv-ribo", cx: f1(p[0]), cy: f1(p[1]), r: 4 }, L.cell));
const rec = [];
[[158, "cd4"], [170, "ccr"], [184, "cd4"], [198, "ccr"], [146, "cd4"]].forEach(([a, k]) => { const t = a * Math.PI / 180, x = CX + R * Math.cos(t), y = CY + R * Math.sin(t) * 1;
  const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(a - 180) + ")" }, L.cell);
  mk("path", { class: k === "cd4" ? "hv-cd4" : "hv-ccr", d: k === "cd4" ? "M0 0L-12 0M-12 0L-19 -6M-12 0L-19 6" : "M0 0L-6 -4L-9 4L-14 -3L-18 3" }, g); rec.push({ g, k, x, y, a }); });
/* ---- block markers (shown when a drug blocks that step) ---- */
function xmark(x, y) { const g = mk("g", { transform: "translate(" + f1(x) + " " + f1(y) + ")", opacity: 0 }, L.cell); mk("circle", { class: "hv-xc", r: 9 }, g); mk("path", { class: "hv-x", d: "M-4 -4L4 4M4 -4L-4 4" }, g); return g; }
const X = { entry: xmark(S0[0] - 4, S0[1] - 30), rt: xmark(C1[0], C1[1] + 22), integ: xmark(INT[0] - 6, INT[1] - 22), prot: xmark(AS[0] + 34, AS[1] - 4) };
/* ---- the journey of one virion ---- */
function virion(parent, mature) { const g = mk("g", {}, parent); const spk = mk("path", { class: "hv-spk", d: "" }, g); let d = ""; for (let i = 0; i < 8; i++) { const t = i * 0.785; d += "M" + f1(Math.cos(t) * 9) + " " + f1(Math.sin(t) * 9) + "L" + f1(Math.cos(t) * 14) + " " + f1(Math.sin(t) * 14); } spk.setAttribute("d", d);
  const env = mk("circle", { class: "hv-env", r: 9 }, g); const cap = mk("path", { class: "hv-cap", d: "M-3.4 -6L3.4 -6L1.4 6L-1.4 6Z" }, g); return { g, spk, env, cap }; }
const hero = virion(L.cell), capG = mk("g", { opacity: 0 }, L.cell); const capP = mk("path", { class: "hv-cap", d: "M-4 -8L4 -8L2 8L-2 8Z" }, capG);
const rna = mk("path", { class: "hv-rna", d: "M-14 -4q4 -6 7 0t7 0t7 0t7 0M-14 4q4 -6 7 0t7 0t7 0t7 0", opacity: 0 }, L.cell);
const dna = mk("path", { class: "hv-dna", d: "", opacity: 0 }, L.cell);
const glow = mk("circle", { class: "hv-glow", r: 14, opacity: 0 }, L.cell);
const mrnas = Array.from({ length: 3 }, () => mk("circle", { class: "hv-mrna", r: 3, opacity: 0 }, L.cell));
const prots = Array.from({ length: 8 }, () => mk("circle", { class: "hv-prot", r: 3, opacity: 0 }, L.cell));
const asm = mk("path", { class: "hv-spk", d: "", opacity: 0 }, L.cell); asm.setAttribute("stroke", "#b5517a"); asm.setAttribute("stroke-width", 4);
const bud = virion(L.cell); bud.g.setAttribute("opacity", 0);
const prog = Array.from({ length: 6 }, () => { const v = virion(L.cell); v.g.setAttribute("opacity", 0); return { v, t: 9, x: 0, y: 0, imm: false }; });
/* ambient virions in the blood, drifting toward the receptors */
const amb = Array.from({ length: 10 }, () => { const v = virion(L.cell); v.g.setAttribute("transform", "scale(0.7)"); return { v, x: rnd(40, 100), y: rnd(120, 350), t: rnd(0, 6), bounce: 0 }; });
/* ---- labels ---- */
const pills = {};
pills.cd4 = pill(L.over, "CD4 receptor", rec[0].x - 12, rec[0].y, 70, 392, "CD4 on the T helper cell. The virion's gp120 protein binds it first.");
pills.ccr = pill(L.over, "CCR5 co-receptor", rec[1].x - 10, rec[1].y, 100, 360, "A co-receptor (CCR5, or CXCR4 in later disease) that gp120 must also engage before gp41 can fuse the membranes.");
pill(L.over, "Nucleus", NC[0] + 40, CY - 44, NC[0] + 112, CY - 92, "The host nucleus holds the cell's own DNA. The provirus is inserted here.");
pill(L.over, "Host DNA", NC[0] + 30, CY + 14, NC[0] + 112, CY + 14, "The cell's own genome. Integrase splices the viral DNA into it, so every copy of the cell carries the provirus.");
pill(L.over, "Ribosomes", RB[1][0] - 4, RB[1][1] + 4, RB[1][0] - 76, RB[1][1] + 34, "Host ribosomes translate viral mRNA into viral proteins.");
pill(L.over, "New virion", AS[0] + 10, AS[1] + 12, AS[0] + 92, AS[1] + 42, "New virions assemble at the membrane, bud out and mature into infectious particles.");
const dp = {
  entry: pill(L.over, "Entry inhibitor", S0[0] - 4, S0[1] - 30, 86, 196, "Entry inhibitors stop the virion binding or fusing, so it cannot get in."),
  rt: pill(L.over, "RT inhibitor", C1[0], C1[1] + 22, C1[0] + 24, C1[1] + 70, "Reverse transcriptase inhibitors give the enzyme a faulty building block or jam it, so no DNA copy is made."),
  integ: pill(L.over, "Integrase inhibitor", INT[0] - 6, INT[1] - 22, INT[0] - 70, INT[1] - 86, "Integrase inhibitors stop the viral DNA being spliced into the host genome."),
  prot: pill(L.over, "Protease inhibitor", AS[0] + 34, AS[1] - 4, AS[0] + 100, AS[1] - 40, "Protease inhibitors stop the virion's proteins being cut into working parts, so new virions stay immature and cannot infect."),
};
/* ---- the over-the-years plot ---- */
const PX0 = 664, PX1 = 922, PY0 = 112, PY1 = 308, PW = PX1 - PX0, PH = PY1 - PY0;
const CD_PTS = [[0, 0.85], [0.07, 0.62], [0.2, 0.72], [0.5, 0.58], [0.75, 0.42], [0.9, 0.18], [1, 0.08]], VL_PTS = [[0, 0.1], [0.06, 0.95], [0.18, 0.5], [0.5, 0.42], [0.75, 0.5], [0.9, 0.8], [1, 0.9]];
const evalPts = (pts, u) => { for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i], f = (u - a[0]) / (b[0] - a[0]); return lerp(a[1], b[1], ease(f)); } return pts[pts.length - 1][1]; };
const px = (u) => PX0 + u * PW, py = (v) => PY1 - v * PH;
mk("path", { class: "pl-ax", d: "M" + PX0 + " " + (PY0 - 6) + "L" + PX0 + " " + PY1 + "L" + PX1 + " " + PY1 }, L.plot);
[0.17, 0.78].forEach((u) => mk("path", { class: "pl-ph", d: "M" + f1(px(u)) + " " + (PY0 - 6) + "L" + f1(px(u)) + " " + PY1 }, L.plot));
[["acute", 0.085], ["chronic, no symptoms", 0.475], ["AIDS", 0.89]].forEach(([t, u]) => { const e = mk("text", { class: "dr-pt2", x: f1(px(u)), y: PY1 + 14, "text-anchor": "middle" }, L.plot); e.textContent = t.length > 8 ? "chronic" : t; });
const ax1 = mk("text", { class: "dr-pt2", x: PX0, y: PY0 - 14 }, L.plot); ax1.textContent = "higher is more";
const lg1 = mk("g", { class: "hot", tabindex: "0", "data-info": "CD4 count: the number of T helper cells. It falls over years without treatment." }, L.plot); mk("path", { class: "pl-cd", d: "M" + PX0 + " " + (PY1 + 34) + "l22 0" }, lg1); const l1 = mk("text", { class: "dr-pt2", x: PX0 + 28, y: PY1 + 38 }, lg1); l1.textContent = "CD4 count";
const lg2 = mk("g", { class: "hot", tabindex: "0", "data-info": "Viral load: the amount of virus in the blood. It spikes early, settles at a set point, and rises again in advanced disease." }, L.plot); mk("path", { class: "pl-vl", d: "M" + (PX0 + 120) + " " + (PY1 + 34) + "l22 0" }, lg2); const l2 = mk("text", { class: "dr-pt2", x: PX0 + 148, y: PY1 + 38 }, lg2); l2.textContent = "Viral load";
const curves = { cdb: mk("path", { class: "pl-cd base" }, L.plot), vlb: mk("path", { class: "pl-vl base" }, L.plot), cdt: mk("path", { class: "pl-cd" }, L.plot), vlt: mk("path", { class: "pl-vl" }, L.plot) };
const mkr = mk("path", { class: "pl-mk" }, L.plot), dots = [mk("circle", { class: "pl-dot", r: 3.6 }, L.plot), mk("circle", { class: "pl-dot", r: 3.6 }, L.plot)];
const poly = (fn, u0, u1, n) => { let d = ""; for (let i = 0; i <= n; i++) { const u = lerp(u0, u1, i / n); d += (i ? "L" : "M") + f1(px(u)) + " " + f1(py(fn(u))); } return d; };
const OI = [["Thrush", 0.55, "Oral thrush (candidiasis) appears when CD4 starts to fall."], ["TB", 0.45, "Tuberculosis can appear at higher CD4 counts than other opportunistic infections."], ["PCP", 0.3, "Pneumocystis pneumonia: a lung infection of advanced HIV."], ["Toxoplasma", 0.22, "Cerebral toxoplasmosis: a brain infection of advanced HIV."], ["CMV", 0.15, "Cytomegalovirus disease (for example retinitis) at very low CD4."]];
const oiE = OI.map(([nm, th, tip], i) => { const x = 652 + (i % 2) * 144, y = 386 + Math.floor(i / 2) * 20; const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.plot); mk("rect", { class: "dr-lab-r", x, y: y - 10, width: 130, height: 18, rx: 9 }, g); const t = mk("text", { class: "dr-lab-t", x: x + 65, y: y + 3, "text-anchor": "middle" }, g); t.textContent = nm; return { g, th }; });
const ot = mk("text", { class: "dr-pt2", x: 652, y: 366 }, L.plot); ot.textContent = "Opportunistic infections appear as CD4 falls";
/* ---- gauges ---- */
const gg = {};
{ const y0 = 478, P = L.panel; mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P); const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vl", "Viral load", "g-vl", "Amount of virus in the blood."], ["cd4", "CD4 count", "g-cd4", "T helper cells in the blood. Higher is better."], ["risk", "Infection risk", "g-risk", "Risk of opportunistic infection. It rises as CD4 falls."], ["inf", "Cells infected", "g-inf", "Share of CD4 cells carrying or producing virus."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 200, y0 + 2, 52, 18, cls, name, tip); }); }
/* ---- state ---- */
const sm = { VL: 0.5, CD: 0.6, risk: 0.3, inf: 0.5, eff: 0, u0: 0.5 };
const hs = { step: 0, t: 0, stall: 0, imm: false, ok: true };
function stepName() { const s = $("stepname"); if (s) s.textContent = "Step " + (hs.step + 1) + ": " + STEPS[hs.step] + (hs.stall > 0 ? " (blocked by the drug)" : ""); boxes.forEach((b, i) => b.setAttribute("class", "hv-box" + (i === hs.step ? " on" : ""))); }
function blockedAt(step, m) { const p = step === 0 ? m.blk.entry : step === 2 ? m.blk.rt : step === 3 ? m.blk.integ : 0; return p > 0 && Math.random() < p; }
function init() { stepName(); hideAll(); }
function hideAll() { [hero.g, capG, rna, dna, glow, asm, bud.g].forEach((e) => e.setAttribute("opacity", 0)); mrnas.concat(prots).forEach((e) => e.setAttribute("opacity", 0)); prov.setAttribute("opacity", 0); }
function nextVirion() { hs.step = 0; hs.t = 0; hs.stall = 0; hs.ok = true; hs.chk = false; hideAll(); stepName(); }
function dnaPath(a, len, prog) { let d = ""; const n = Math.max(2, Math.round(24 * prog)); for (let i = 0; i <= n; i++) { const f = i / 24; d += (i ? "L" : "M") + f1(a[0] + f * len) + " " + f1(a[1] + Math.sin(f * 14) * 4); } return d; }
function journey(dt, m) {
  if (hs.stall > 0) { hs.stall -= dt; if (hs.step === 0) { place(hero.g, S0[0] - 12 - (1.3 - hs.stall) * 34, S0[1] - (1.3 - hs.stall) * 12, 0, 1); } const k = clamp(hs.stall / 1.3); hero.g.setAttribute("opacity", k.toFixed(2)); capG.setAttribute("opacity", (k * (hs.step === 2 || hs.step === 3 ? 1 : 0)).toFixed(2)); if (hs.stall <= 0) nextVirion(); return; }
  const s = hs.step; hs.t += dt; const p = clamp(hs.t / DUR[s]);
  if (s !== 0 && hs.t === dt && blockedAt(s, m)) { hs.stall = 1.3; stepName(); return; }
  if (s === 0 && !hs.chk && p > 0.8) { hs.chk = true; if (blockedAt(0, m)) { hs.stall = 1.3; stepName(); return; } }
  hideAll(); const e = ease(p);
  if (s === 0) { const q = bez([48, 200], [S0[0] - 12, S0[1]], e); place(hero.g, q[0], q[1], 0, 1); hero.g.setAttribute("opacity", 1); hero.cap.setAttribute("opacity", 1); hero.env.setAttribute("opacity", 1); if (p > 0.7) { glow.setAttribute("opacity", 0.9); glow.setAttribute("cx", f1(S0[0])); glow.setAttribute("cy", f1(S0[1])); } }
  else if (s === 1) { place(hero.g, S0[0] - 12, S0[1], 0, 1); hero.env.setAttribute("opacity", (1 - e).toFixed(2)); hero.spk.setAttribute("opacity", (1 - e).toFixed(2)); hero.cap.setAttribute("opacity", 0); hero.g.setAttribute("opacity", 1 - e * 0.6); const q = bez([S0[0] + 4, S0[1]], C1, e); capG.setAttribute("opacity", 1); place(capG, q[0], q[1], 70, 1); hero.spk.setAttribute("opacity", 1 - e); }
  else if (s === 2) { capG.setAttribute("opacity", (1 - clamp(p * 3)).toFixed(2)); place(capG, C1[0], C1[1], 70, 1); rna.setAttribute("opacity", (1 - clamp(p * 1.4 - 0.2)).toFixed(2)); place(rna, C1[0] + 4, C1[1], 0, 1); dna.setAttribute("opacity", 1); dna.setAttribute("d", dnaPath([C1[0] - 22, C1[1] + 14], 52, clamp(p * 1.2))); }
  else if (s === 3) { const a = p < 0.5 ? bez([C1[0] - 22, C1[1] + 14], [PORE[0] - 6, PORE[1]], ease(p * 2)) : bez([PORE[0] - 6, PORE[1]], [INT[0] - 26, INT[1] + 8], ease((p - 0.5) * 2)); dna.setAttribute("opacity", p > 0.82 ? 0 : 1); dna.setAttribute("d", dnaPath(a, 40, 1)); if (p > 0.78) { prov.setAttribute("opacity", 1); glow.setAttribute("opacity", 0.8); glow.setAttribute("cx", f1(INT[0] - 2)); glow.setAttribute("cy", f1(INT[1] + 8)); } }
  else if (s === 4) { prov.setAttribute("opacity", 1); mrnas.forEach((r, i) => { const f = clamp(p * 1.4 - i * 0.2); if (f <= 0) return; const q = bez([INT[0], INT[1] + 6], PB, ease(f)); r.setAttribute("opacity", 1); r.setAttribute("cx", f1(q[0])); r.setAttribute("cy", f1(q[1])); }); }
  else if (s === 5) { prov.setAttribute("opacity", 1); mrnas.forEach((r, i) => { const q = bez(PB, RB[i], ease(clamp(p * 1.6))); r.setAttribute("opacity", p < 0.8 ? 1 : 0); r.setAttribute("cx", f1(q[0])); r.setAttribute("cy", f1(q[1])); }); prots.forEach((r, i) => { const f = clamp(p * 1.3 - i * 0.08); if (f <= 0) return; const b = RB[i % 3]; r.setAttribute("opacity", 1); r.setAttribute("cx", f1(b[0] + Math.sin(i * 2) * 14)); r.setAttribute("cy", f1(b[1] - 10 - (i % 3) * 8)); r.setAttribute("r", (1.2 + 1.8 * f).toFixed(2)); }); }
  else if (s === 6) { prov.setAttribute("opacity", 1); prots.forEach((r, i) => { const q = bez([RB[i % 3][0] + Math.sin(i * 2) * 14, RB[i % 3][1] - 10 - (i % 3) * 8], [AS[0] - 10 + (i % 4) * 5, AS[1] - 12 + (i % 3) * 6], ease(clamp(p * 1.4))); r.setAttribute("opacity", p < 0.95 ? 1 : 0); r.setAttribute("cx", f1(q[0])); r.setAttribute("cy", f1(q[1])); r.setAttribute("r", 3); }); asm.setAttribute("opacity", clamp(p * 2)); const w = 6 + 16 * p, tx = -OUT[1], ty = OUT[0]; asm.setAttribute("d", "M" + f1(AS[0] - tx * w) + " " + f1(AS[1] - ty * w) + "L" + f1(AS[0] + tx * w) + " " + f1(AS[1] + ty * w)); }
  else if (s === 7) { prov.setAttribute("opacity", 1); const o = 4 + 12 * e; bud.g.setAttribute("opacity", 1); place(bud.g, AS[0] + OUT[0] * o, AS[1] + OUT[1] * o, 0, 0.45 + 0.55 * e); bud.cap.setAttribute("opacity", 0); bud.g.setAttribute("class", "hv-imm"); }
  else if (s === 8) { prov.setAttribute("opacity", 1); const q = bez([AS[0] + OUT[0] * 16, AS[1] + OUT[1] * 16], [AS[0] + OUT[0] * 40, AS[1] + OUT[1] * 40], e); bud.g.setAttribute("opacity", 1); place(bud.g, q[0], q[1], 0, 1); const imm = m.blk.prot > 0 && (hs.imm = hs.imm || Math.random() < m.blk.prot); bud.g.setAttribute("class", imm ? "hv-imm" : ""); bud.cap.setAttribute("opacity", p > 0.5 && !imm ? 1 : 0); if (imm && p > 0.6) { X.prot.setAttribute("opacity", 1); } }
  if (p >= 1) { if (s === 8) { const pr = prog.find((q) => q.t >= 9) || prog[0]; pr.t = 0; pr.x = AS[0] + OUT[0] * 40; pr.y = AS[1] + OUT[1] * 40; pr.imm = hs.imm; pr.v.g.setAttribute("class", hs.imm ? "hv-imm" : ""); pr.v.cap.setAttribute("opacity", hs.imm ? 0 : 1); hs.imm = false; nextVirion(); } else { hs.step++; hs.t = 0; stepName(); } }
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.8);
  sm.VL = lerp(sm.VL, m.VL, k1); sm.CD = lerp(sm.CD, m.CD, k1); sm.risk = lerp(sm.risk, m.risk, k1); sm.inf = lerp(sm.inf, m.inf, k1); sm.eff = lerp(sm.eff, m.e, k1); sm.u0 = lerp(sm.u0, m.u0, Math.min(1, dt * 2));
  journey(dt, m);
  ["entry", "rt", "integ", "prot"].forEach((k) => { const v = m.blk[k]; X[k].setAttribute("opacity", k === "prot" && v > 0 ? 0 : (v > 0 ? 1 : 0)); dp[k].style.opacity = v > 0 ? 1 : 0; if (k === "prot") X.prot.setAttribute("opacity", v > 0 ? 1 : 0); });
  /* receptors glow while the entry inhibitor is on */
  rec.forEach((r, i) => r.g.style.opacity = m.blk.entry > 0 && r.k === "ccr" && m.e > 0.9 ? 0.4 : 1);
  /* progeny drift away */
  prog.forEach((q) => { if (q.t >= 9) { q.v.g.setAttribute("opacity", 0); return; } q.t += dt; const f = q.t / 6; q.x += (REL[0] - q.x) * dt * 0.5 + 6 * dt; q.y += (REL[1] - q.y) * dt * 0.5 + 4 * dt; place(q.v.g, q.x, q.y, 0, 1); q.v.g.setAttribute("opacity", clamp(1.4 - f * 1.4).toFixed(2)); if (q.t > 6) q.t = 9; });
  /* ambient virions drift in and bounce off or attach */
  const nAmb = Math.round(sm.VL * amb.length);
  amb.forEach((a, i) => { const on = i < nAmb; a.t += dt; if (!on) { a.v.g.setAttribute("opacity", 0); return; } a.v.g.setAttribute("opacity", 0.8);
    a.x += (22 + 10 * Math.sin(a.t + i)) * dt; a.y = clamp(a.y + Math.sin(a.t * 0.8 + i * 2) * 10 * dt, 110, 350); if (a.x > S0[0] - 20 - (a.y - 260) * 0.0) { a.x = rnd(30, 70); a.y = rnd(120, 350); } place(a.v.g, a.x, a.y, 0, 0.7); });
  /* plot */
  const u0 = sm.u0, e = sm.eff, cb = evalPts(CD_PTS, u0), vb = evalPts(VL_PTS, u0);
  curves.cdb.setAttribute("d", poly((u) => evalPts(CD_PTS, u), 0, 1, 70)); curves.vlb.setAttribute("d", poly((u) => evalPts(VL_PTS, u), 0, 1, 70));
  const cdT = (u) => { const t = Math.min(1, e); return u < u0 ? evalPts(CD_PTS, u) : lerp(evalPts(CD_PTS, u), clamp(cb + 0.55 * t), clamp(1 - Math.exp(-(u - u0) / 0.1)) * t); };
  const vlT = (u) => u < u0 ? evalPts(VL_PTS, u) : evalPts(VL_PTS, u) * (1 - e * (1 - Math.exp(-(u - u0) / 0.035)));
  curves.cdt.setAttribute("d", poly(cdT, 0, 1, 80)); curves.vlt.setAttribute("d", poly(vlT, 0, 1, 80));
  mkr.setAttribute("d", "M" + f1(px(u0)) + " " + (PY0 - 6) + "L" + f1(px(u0)) + " " + PY1); dots[0].setAttribute("cx", f1(px(u0))); dots[0].setAttribute("cy", f1(py(cb))); dots[1].setAttribute("cx", f1(px(u0))); dots[1].setAttribute("cy", f1(py(vb)));
  oiE.forEach((o) => o.g.style.opacity = sm.CD < o.th ? 1 : 0.18);
  gg.vl.set(sm.VL, sm.VL < 0.1 ? "undetectable" : sm.VL < 0.3 ? "low" : sm.VL < 0.6 ? "moderate" : "high");
  gg.cd4.set(sm.CD, sm.CD < 0.3 ? "low" : sm.CD < 0.62 ? "moderate" : "preserved"); gg.risk.set(sm.risk, sm.risk < 0.2 ? "low" : sm.risk < 0.5 ? "some" : "high"); gg.inf.set(sm.inf, sm.inf < 0.15 ? "few" : sm.inf < 0.5 ? "some" : "many");
}
run({ init, step });
