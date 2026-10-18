/* Systemic lupus scene: loss of tolerance, anti-nuclear antibodies, immune complexes, complement use and organ deposition. */
const LY = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), glowSkin: $("glowSkin"), glowJoint: $("glowJoint"), glowKidney: $("glowKidney"), glowBlood: $("glowBlood"), glom: $("glom"), jointSyn: $("jointSyn"), bloodFx: $("bloodFx"), skinFx: $("skinFx") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }
function cplxShape(parent) { const g = mk("g", {}, parent); mk("circle", { class: "sc-p p-cplx", r: 3.4, cx: -2, cy: 0 }, g); mk("circle", { class: "sc-p p-comp", r: 2.4, cx: 3, cy: -2 }, g); mk("path", { class: "ab-p", d: "M1 5L1 0M1 0L-2 -4M1 0L4 -4" }, g); return g; }

/* ---- cells ---- */
const dmgG = mk("g", {}, LY.cells); cell(dmgG, { cls: "endo", r: 20, nuc: 0.52, seed: 4, wob: 0.2 });
mk("circle", { class: "sc-p p-ag", r: 2.2, cx: -7, cy: -5 }, dmgG); mk("circle", { class: "sc-p p-ag", r: 1.8, cx: 6, cy: 4 }, dmgG);
const tG = mk("g", {}, LY.cells); cell(tG, { cls: "lymph", r: 22, nuc: 0.5, seed: 7, wob: 0.1 });
const bG = mk("g", {}, LY.cells); cell(bG, { cls: "bcell", r: 22, nuc: 0.45, seed: 11, wob: 0.1 });
const compDots = [];
for (let i = 0; i < 7; i++) { const c = mk("circle", { class: "sc-p p-comp", r: 3.4, cx: 596 + (i % 4) * 16, cy: 162 + Math.floor(i / 4) * 16 }, LY.cells); compDots.push(c); }
const txCap = mk("g", {}, LY.cells); mk("rect", { class: "tx-cap", x: -11, y: -5, width: 22, height: 10, rx: 5 }, txCap); mk("rect", { class: "tx-cap", x: 0, y: -5, width: 11, height: 10, rx: 5 }, txCap);
const bloodCells = [];
for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, LY.bloodFx); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); bloodCells.push({ g, x: 742 + i * 28, y: 392 + (i % 2) * 18, rbc: true }); }
for (let i = 0; i < 2; i++) { const g = mk("g", {}, LY.bloodFx); cell(g, { cls: "lymph", r: 8, nuc: 0.5, seed: 30 + i, wob: 0.12 }); bloodCells.push({ g, x: 770 + i * 70, y: 402 + i * 6, rbc: false }); }

/* ---- particles ---- */
const ags = pool(10, () => mk("path", { class: "sc-p p-ag", d: "M0 -3L3 0L0 3L-3 0Z" }, LY.parts));
const abs = pool(14, () => abShape(LY.parts));
const cplxs = pool(18, () => cplxShape(LY.parts));
const comps = pool(14, () => mk("circle", { class: "sc-p p-comp", r: 2.6 }, LY.parts));
const deps = pool(16, () => mk("circle", { class: "sc-p p-cplx", r: 2.4 }, LY.parts));

/* ---- labels and gauges ---- */
let hcqPill, steroidPill, immunoPill;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ana", "Autoantibodies", "g-ana", "Anti-nuclear and related autoantibodies made by B cells after tolerance to nuclear antigens is lost."], ["cplx", "Immune complexes", "g-cplx", "Antibody bound to nuclear antigen. Complexes circulate and deposit in tissues."], ["comp", "Complement left", "g-comp", "Complement remaining in blood. It falls when immune complexes use it up in active disease."], ["org", "Organ inflammation", "g-org", "Inflammation in skin, joints, kidney and blood from deposited complexes and recruited cells."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Self antigen", 95, 155, 95, 115, "Nuclear material from damaged and dying cells. In lupus the immune system stops tolerating these self antigens.");
  pill(ox, "T cell", 195, 153, 195, 115, "Helper T cell: it sees nuclear antigen and helps B cells make autoantibodies.");
  pill(ox, "B cell", 295, 153, 295, 115, "B cell: helped by T cells, it makes anti-nuclear antibodies and related autoantibodies.");
  pill(ox, "Complement", 620, 156, 620, 115, "Complement proteins in blood. Immune complexes activate and consume them, so levels fall in a flare.");
  pill(ox, "ANA", 330, 200, 380, 225, "ANA: anti-nuclear antibodies released by B cells. They bind nuclear antigen in blood and tissues.");
  pill(ox, "Immune complexes", 540, 274, 540, 225, "Immune complexes: antibody joined to nuclear antigen. They deposit in small vessels and tissues and start inflammation.");
  pill(ox, "Skin", 134, 382, 134, 350, "Skin: complexes and inflammation in skin vessels give rashes, including light sensitive rashes.");
  pill(ox, "Joint", 362, 400, 362, 350, "Joint: synovial inflammation causes painful, swollen and stiff joints.");
  pill(ox, "Kidney", 570, 385, 590, 350, "Kidney: complexes deposit in glomeruli, use complement and cause glomerular inflammation and protein leak.");
  pill(ox, "Blood", 818, 395, 818, 350, "Blood: autoantibodies and complexes can lower red cells, white cells and platelets.");
  hcqPill = pill(ox, "Hydroxychloroquine", 830, 172, 830, 115, "Hydroxychloroquine dampens immune activation and autoantibody drive over time.");
  steroidPill = pill(ox, "Steroid", 830, 172, 830, 115, "A steroid calms tissue inflammation quickly, while autoantibodies and complexes persist more.");
  immunoPill = pill(ox, "Immunosuppressant", 830, 172, 830, 115, "An immunosuppressant suppresses B cell and T cell activity more strongly, so antibodies, complexes and organ inflammation fall.");
}
const sm = { A: 0.5, Cx: 0.4, Comp: 0.5, Org: 0.4, hcq: 0, steroid: 0, immuno: 0 };
const acc = { ag: 0, ab: 0, cplx: 0, comp: 0, dep: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k2 = Math.min(1, dt * 1.2);
  sm.A = lerp(sm.A, m.A, k); sm.Cx = lerp(sm.Cx, m.Cx, k); sm.Comp = lerp(sm.Comp, m.Comp, k); sm.Org = lerp(sm.Org, m.Org, k);
  sm.hcq = lerp(sm.hcq, m.hcq, k2); sm.steroid = lerp(sm.steroid, m.steroid, k2); sm.immuno = lerp(sm.immuno, m.immuno, k2);
  place(dmgG, 95 + Math.sin(tm / 1500) * 2, 175 + Math.cos(tm / 1700) * 2, 0, 1);
  place(tG, 195 + Math.sin(tm / 1300 + 2) * 3, 175, 0, 1 + 0.08 * sm.A * Math.sin(tm / 280 + 1));
  place(bG, 295, 175 + Math.cos(tm / 1400) * 2, 0, 1 + 0.09 * sm.A * Math.sin(tm / 320 + 2));
  place(txCap, 830, 185, Math.sin(tm / 600) * 12, 1);
  txCap.style.opacity = Math.max(sm.hcq, sm.steroid, sm.immuno).toFixed(2);
  compDots.forEach((c, i) => { c.setAttribute("opacity", clamp(sm.Comp * 1.4 - i * 0.06).toFixed(2)); });
  /* organ effects */
  LY.glowSkin.setAttribute("opacity", (sm.Org * 0.22).toFixed(2)); LY.glowJoint.setAttribute("opacity", (sm.Org * 0.22).toFixed(2));
  LY.glowKidney.setAttribute("opacity", (sm.Org * 0.26).toFixed(2)); LY.glowBlood.setAttribute("opacity", (sm.Org * 0.18).toFixed(2));
  LY.jointSyn.setAttribute("height", f1(4 + 9 * sm.Org)); LY.jointSyn.setAttribute("y", f1(402 - 4 * sm.Org));
  LY.glom.setAttribute("r", f1(13 + 5 * sm.Org));
  LY.skinFx.style.opacity = (0.45 + 0.55 * sm.Org).toFixed(2);
  bloodCells.forEach((b, i) => { const keep = clamp(1.15 - sm.Org * 0.75 - i * 0.04); place(b.g, b.x + Math.sin(tm / 500 + i) * 2, b.y, 0, Math.max(0.25, keep)); b.g.style.opacity = clamp(keep).toFixed(2); });
  /* self antigen: damaged cell toward T cell */
  acc.ag += dt * (0.4 + sm.A) * 2.2; while (acc.ag >= 1) { acc.ag--; const p = free(ags); if (p) emit(p, 116, 172, 34, rnd(-5, 5), 0); }
  ags.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 5) + ")"); if (p.x > 178 || p.t > 3) kill(p); });
  /* ANA: B cell down toward the bloodstream */
  acc.ab += dt * sm.A * 3.4; while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) emit(p, 318, 188, rnd(10, 22), rnd(18, 30), 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > 252 || p.t > 4) kill(p); });
  /* immune complexes travel along the bloodstream */
  acc.cplx += dt * sm.Cx * 3.2; while (acc.cplx >= 1) { acc.cplx--; const p = free(cplxs); if (p) emit(p, 24, rnd(256, 294), rnd(42, 62), rnd(-3, 3), 0); }
  cplxs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 400 + p.x) * 0.15; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 936 || p.t > 18) kill(p); });
  /* complement falls to complexes and is used up */
  acc.comp += dt * sm.Cx * 4.2; while (acc.comp >= 1) { acc.comp--; const p = free(comps); if (p) emit(p, rnd(600, 650), 184, rnd(-8, 8), rnd(24, 36), 0); }
  comps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 262 || p.t > 3) kill(p); });
  /* deposition: complexes leave the bloodstream for the organs below */
  acc.dep += dt * sm.Cx * sm.Org * 5.2; while (acc.dep >= 1) { acc.dep--; const p = free(deps); if (p) { const tx = pick([134, 362, 590, 818]); emit(p, tx + rnd(-50, 50), 306, rnd(-4, 4), rnd(22, 34), tx); } }
  deps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (p.k - p.x) * dt * 0.6; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 392 || p.t > 4) kill(p); });
  /* treatment pills */
  hcqPill.style.opacity = sm.hcq.toFixed(2); steroidPill.style.opacity = sm.steroid.toFixed(2); immunoPill.style.opacity = sm.immuno.toFixed(2);
  /* gauges */
  gg.ana.set(sm.A, wordOf(sm.A, 0.35, 0.65, ["low", "moderate", "high"])); gg.cplx.set(sm.Cx, wordOf(sm.Cx, 0.35, 0.65, ["few", "some", "many"]));
  gg.comp.set(sm.Comp, sm.Comp > 0.6 ? "preserved" : sm.Comp > 0.35 ? "reduced" : "low"); gg.org.set(sm.Org, wordOf(sm.Org, 0.3, 0.6, ["mild", "moderate", "high"]));
}
run({ init, step });
