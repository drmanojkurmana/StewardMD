/* Checkpoint scene: lymph node priming (CD28/B7, CTLA-4 brake), tumour killing (PD-1/PD-L1 brake), bowel side effects. */
const CK = { base: $("base"), links: $("links"), parts: $("parts"), over: $("over"), panel: $("panel"), gut: $("gutSlot"), primeGlow: $("primeGlow"), tumGlow: $("tumGlow") };
const APC = { x: 140, y: 240, r: 22 };
const TN = { x: 330, y: 240, r: 20 };
const TE = { x: 758, y: 195, r: 18 };
const EFF = track([[352, 262], [420, 300], [492, 302], [545, 262]]);
const lolli = (g, ang, r, cls) => { const c = Math.cos(ang), s = Math.sin(ang);
  mk("path", { class: "r-stem", d: "M" + f1(c * r) + " " + f1(s * r) + "L" + f1(c * (r + 6)) + " " + f1(s * (r + 6)) }, g);
  mk("circle", { class: cls, cx: f1(c * (r + 8)), cy: f1(s * (r + 8)), r: 3.2 }, g); };
const yAb = (parent, x, y, s) => { const g = mk("g", { transform: "translate(" + x + " " + y + ") scale(" + s + ")" }, parent);
  mk("path", { class: "p-ck", d: "M0 6V1M-4.5 -5L0 1L4.5 -5" }, g); return g; };
/* ---- bowel organ for the healthy gut under attack, plus its inflammation veil ---- */
let bowelO = null, ginfl = null, coils = [838, 365];
function initOrgans() {
  bowelO = organ(CK.gut, "bowel", 835, 362, 150, {});
  coils = bowelO.ports.coils;
  ginfl = mk("ellipse", { class: "ck-ginfl", cx: f1(bowelO.x), cy: f1(bowelO.y), rx: 60, ry: 58, opacity: "0" }, CK.gut);
}
/* ---- lymph node cells ---- */
const apcG = mk("g", {}, CK.base), tnG = mk("g", {}, CK.base), teG = mk("g", {}, CK.base);
function initCells() {
  for (let k = 0; k < 7; k++) { const t = k * 0.9 + 0.4; mk("path", { class: "r-stem", d: "M0 0L" + f1(Math.cos(t) * 30) + " " + f1(Math.sin(t) * 30), style: "stroke:var(--c-mac)" }, apcG); }
  cell(apcG, { cls: "mac", r: APC.r, nuc: 0.4, seed: 11, wob: 0.12 });
  lolli(apcG, -0.3, APC.r, "r-mhc"); lolli(apcG, 0.2, APC.r, "r-b7"); lolli(apcG, 0.65, APC.r, "r-b7");
  place(apcG, APC.x, APC.y);
  cell(tnG, { cls: "lymph", r: TN.r, nuc: 0.55, seed: 12, wob: 0.1 });
  lolli(tnG, Math.PI + 0.3, TN.r, "r-tcr"); lolli(tnG, Math.PI - 0.15, TN.r, "r-cd28"); lolli(tnG, Math.PI - 0.65, TN.r, "r-ctla");
  place(tnG, TN.x, TN.y);
  cell(teG, { cls: "eos", r: TE.r, nuc: 0.5, seed: 13, wob: 0.1 });
  lolli(teG, Math.PI + 0.25, TE.r, "r-pd1"); lolli(teG, Math.PI - 0.2, TE.r, "r-pd1");
  place(teG, TE.x, TE.y);
}
/* ---- tumour cluster ---- */
const tumours = [];
function initTumour() {
  [560, 620, 680].forEach((x, c) => [140, 200, 260].forEach((y, r) => {
    const g = mk("g", {}, CK.base), inner = mk("g", {}, g);
    cell(inner, { cls: "tum", r: 19, nuc: 0.45, seed: c * 3 + r + 1, wob: 0.12 });
    if (c === 2) lolli(g, 0, 19, "r-pdl1");
    if (c === 0) lolli(g, Math.PI, 19, "r-pdl1");
    const jx = x + ((c * 7 + r * 3) % 3 - 1) * 3, jy = y + ((c * 5 + r * 7) % 3 - 1) * 3;
    place(g, jx, jy); tumours.push({ g, inner, x: jx, y: jy, dm: 0, sens: 0.6 + ((c + r * 2) % 4) * 0.18 });
  }));
}
/* ---- signal links and docked blocker antibodies ---- */
let s1 = null, s2 = null, brakeC = null, pd1 = null, pd2 = null, absC = null, absP = null;
function initLinks() {
  s1 = mk("path", { class: "sig", d: "M169 231L303 232" }, CK.links);
  s2 = mk("path", { class: "sig", d: "M169 246L302 244" }, CK.links);
  brakeC = mk("path", { class: "sigB", d: "M164 258L308 257" }, CK.links);
  pd1 = mk("path", { class: "sigB", d: "M732 200L707 200" }, CK.links);
  pd2 = mk("path", { class: "sigB", d: "M733 189L704 187" }, CK.links);
  absC = mk("g", { opacity: "0" }, CK.links); yAb(absC, 306, 252, 1.6); yAb(absC, 312, 266, 1.6);
  absP = mk("g", { opacity: "0" }, CK.links); yAb(absP, 730, 186, 1.6); yAb(absP, 730, 200, 1.6);
}
/* ---- pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, s: 1 }; }); }
const free = (pl) => pl.find((p) => !p.on);
const kill = (p) => { p.on = false; p.e.setAttribute("opacity", "0"); };
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
const il2 = pool(10, () => mk("rect", { class: "sc-p p-il2", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, CK.parts));
const perf = pool(12, () => mk("circle", { class: "p-perf", r: 1.8 }, CK.parts));
const clones = pool(6, () => { const g = mk("g", {}, CK.parts); cell(g, { cls: "lymph", r: 7, nuc: 0.5, seed: 50, wob: 0.1 }); return g; });
const effs = pool(6, () => { const g = mk("g", {}, CK.parts); cell(g, { cls: "eos", r: 9, nuc: 0.5, seed: 60, wob: 0.1 }); return g; });
const gutT = pool(6, () => { const g = mk("g", {}, CK.parts); cell(g, { cls: "eos", r: 8, nuc: 0.5, seed: 70, wob: 0.1 }); return g; });
/* ---- in stage caption, changed with the treatment ---- */
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Anti-CTLA-4 sits on the early brake. Priming rises and more killers reach the tumour.";
  if (d === 2) return "Anti-PD-1 sits on the tired cell brake. Killers recover and shrink the tumour.";
  if (d === 3) return "Both drugs together. Strongest killing, but the healthy gut is attacked more.";
  return "No treatment. Both brakes stay on, so priming is weak and the tumour grows.";
}
/* ---- labels and gauges ---- */
const gg = {};
function initOver() {
  const P = CK.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The response";
  [["prim", "Priming", "g-cyt", "How strongly T cells are primed in the lymph node. Signal 1 plus signal 2 drives it; CTLA-4 stealing B7 holds it back."],
    ["kill", "Killing", "g-good", "How much tumour killing restored T cells achieve. PD-1 meeting PD-L1 switches it off."],
    ["tum", "Tumour", "g-bad", "How much living tumour remains. It falls as killing rises."],
    ["ctla", "CTLA-4", "g-neu", "The early brake in the lymph node. CTLA-4 competes with CD28 for B7. Anti-CTLA-4 releases it."],
    ["pd", "PD-1", "g-fl", "The late brake in the tissue. PD-1 on exhausted T cells meets PD-L1 on tumour cells. Anti-PD-1 releases it."],
    ["ae", "Side effects", "g-eos", "Immune related side effects: reinvigorated T cells attacking self tissue such as gut, lung, liver and hormone glands."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const O = CK.over;
  pill(O, "Dendritic cell", APC.x, APC.y - 22, 140, 100, "Dendritic cell in the lymph node. It shows tumour antigen on MHC (signal 1) and B7 (signal 2) to a naive T cell.");
  pill(O, "Two signals", 236, 239, 240, 150, "Signals 1 and 2: the T cell receptor recognises antigen on MHC, and CD28 meets B7. Both together prime the T cell to divide and hunt.");
  pill(O, "CTLA-4 brake", 308, 257, 330, 350, "CTLA-4 appears after activation and steals B7 from CD28, which dampens priming. Anti-CTLA-4 blocks CTLA-4 so priming continues.");
  const abC = pill(O, "Anti-CTLA-4", 288, 279, 150, 360, "Anti-CTLA-4 antibody. It sits on CTLA-4 so B7 stays free for CD28. Shown only when treatment includes it."); abC.setAttribute("id", "ckabC");
  pill(O, "Tumour", 620, 122, 600, 100, "Tumour cells. They carry PD-L1 on their surface, which switches off attacking T cells.");
  pill(O, "Killer T cell", TE.x, TE.y - 18, 830, 110, "A primed killer T cell that reached the tumour. PD-1 on its surface marks exhaustion; blocking PD-1 reinvigorates it.");
  pill(O, "PD-1 brake", 719, 195, 745, 275, "PD-1 on the exhausted T cell binds PD-L1 on the tumour and switches killing off. Anti-PD-1 blocks PD-1.");
  const abP = pill(O, "Anti-PD-1", 726, 214, 870, 270, "Anti-PD-1 antibody. It sits on PD-1 so the tumour cannot switch the T cell off. Shown only when treatment includes it."); abP.setAttribute("id", "ckabP");
  capEl = mk("text", { class: "ck-cap", x: 30, y: 428 }, O); capEl.textContent = capText(0);
}
const sm = { P: 0.3, K: 0.1, T: 0.85, CTLA: 0.6, PD: 0.7, A: 0.1, cB: 0, pB: 0, gP: 0.3, gT: 0.85 };
const acc = { il2: 0, perf: 0, clone: 0, eff: 0, gut: 0 };
function init() { initOrgans(); initCells(); initTumour(); initLinks(); initOver(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.P = lerp(sm.P, m.P, k2); sm.K = lerp(sm.K, m.K, k2); sm.T = lerp(sm.T, m.T, Math.min(1, dt * 0.3));
  sm.CTLA = lerp(sm.CTLA, m.CTLA, k2); sm.PD = lerp(sm.PD, m.PD, k2); sm.A = lerp(sm.A, m.A, k2);
  sm.cB = lerp(sm.cB, m.cB, k1); sm.pB = lerp(sm.pB, m.pB, k1);
  sm.gP = lerp(sm.gP, m.P, k1); sm.gT = lerp(sm.gT, m.T, k1);
  /* priming and burden glows: the stage brightens and dims with the state */
  CK.primeGlow.setAttribute("opacity", (0.3 * sm.gP).toFixed(2));
  CK.tumGlow.setAttribute("opacity", (0.35 * sm.gT).toFixed(2));
  /* cells bob; naive cell swells with priming, effector brightens as the PD brake lifts */
  place(apcG, APC.x + Math.sin(tm / 1200) * 2, APC.y + Math.cos(tm / 1500) * 2, Math.sin(tm / 2000) * 4, 1);
  place(tnG, TN.x + Math.sin(tm / 1000 + 1) * 2, TN.y + Math.cos(tm / 1300) * 2, 0, 1 + 0.12 * sm.P * Math.sin(tm / 350));
  place(teG, TE.x + Math.sin(tm / 1100 + 2) * 2, TE.y + Math.cos(tm / 1400) * 2, 0, 0.88 + 0.24 * (1 - sm.PD) + 0.05 * sm.K * Math.sin(tm / 300));
  /* tumour cells take damage from killing: they shrink and grey out */
  tumours.forEach((c, i) => { c.dm = lerp(c.dm, clamp(sm.K * c.sens * 1.15), Math.min(1, dt * 0.35));
    c.inner.style.setProperty("--dm", c.dm.toFixed(2));
    place(c.g, c.x + Math.sin(tm / 1300 + i) * 0.8, c.y + Math.cos(tm / 1700 + i) * 0.8, 0, 1 - 0.25 * c.dm); });
  /* bowel inflammation veil follows side effects; attackers home to the bowel coils */
  ginfl.setAttribute("opacity", (0.6 * sm.A).toFixed(2));
  /* signals strengthen with priming; brakes fade as blockers dock on them */
  s1.setAttribute("opacity", (0.15 + 0.85 * sm.P).toFixed(2));
  s1.setAttribute("stroke-width", f1(1.2 + 2.2 * sm.P));
  s2.setAttribute("opacity", (0.15 + 0.85 * sm.P * (1 - 0.55 * sm.CTLA)).toFixed(2));
  s2.setAttribute("stroke-width", f1(1.2 + 2.2 * sm.P * (1 - 0.5 * sm.CTLA)));
  brakeC.setAttribute("opacity", sm.CTLA.toFixed(2));
  brakeC.setAttribute("stroke-width", f1(1 + 2.5 * sm.CTLA));
  pd1.setAttribute("opacity", sm.PD.toFixed(2)); pd2.setAttribute("opacity", sm.PD.toFixed(2));
  pd1.setAttribute("stroke-width", f1(1 + 2.5 * sm.PD)); pd2.setAttribute("stroke-width", f1(1 + 2.5 * sm.PD));
  absC.setAttribute("opacity", sm.cB.toFixed(2)); absP.setAttribute("opacity", sm.pB.toFixed(2));
  absC.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 500) * 1.5) + ")");
  absP.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 500 + 1) * 1.5) + ")");
  $("ckabC").style.opacity = sm.cB.toFixed(2); $("ckabP").style.opacity = sm.pB.toFixed(2);
  /* IL-2 around the primed cell */
  acc.il2 += dt * sm.P * 6; while (acc.il2 >= 1) { acc.il2--; const p = free(il2); if (p) { emit(p, TN.x + rnd(-14, 14), TN.y + rnd(-12, 12)); p.vx = rnd(-10, 10); p.vy = rnd(-26, -14); } }
  il2.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  /* clones bud off the primed cell */
  acc.clone += dt * sm.P * 1.6; while (acc.clone >= 1) { acc.clone--; const p = free(clones); if (p) { emit(p, TN.x, TN.y); p.k = rnd(0, 6.28); } }
  clones.forEach((p) => { if (!p.on) return; p.t += dt; const r = 22 + p.t * 15;
    place(p.e, p.x + Math.cos(p.k) * r, p.y + Math.sin(p.k) * r, 0, clamp(p.t * 2, 0, 1)); p.e.setAttribute("opacity", (1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) kill(p); });
  /* effectors travel from node to tumour */
  acc.eff += dt * (0.15 + sm.P * 0.85); while (acc.eff >= 1) { acc.eff--; const p = free(effs); if (p) { emit(p, 0, 0); p.s = rnd(0.8, 1.2); } }
  effs.forEach((p) => { if (!p.on) return; p.u += dt * 0.2 * p.s; const q = EFF.at(p.u);
    place(p.e, q.x, q.y + Math.sin(tm / 300 + p.s * 7) * 2, 0, 1); p.e.setAttribute("opacity", p.u > 0.85 ? clamp((1 - p.u) / 0.15).toFixed(2) : "1"); if (p.u >= 1) kill(p); });
  /* perforin from the reinvigorated cell flies left and strikes the tumour */
  acc.perf += dt * sm.K * 12; while (acc.perf >= 1) { acc.perf--; const p = free(perf); if (p) { emit(p, 745, TE.y + rnd(-8, 8)); p.vx = -rnd(40, 58); p.vy = rnd(-6, 6); } }
  perf.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6 || p.x < 655) kill(p); });
  /* self reactive cells home to the bowel coils and injure the gut */
  acc.gut += dt * sm.A * 3; while (acc.gut >= 1) { acc.gut--; const p = free(gutT); if (p) { emit(p, rnd(788, 882), 302); p.vx = coils[0] + rnd(-24, 24); p.k = coils[1] + rnd(-22, 22); } }
  gutT.forEach((p) => { if (!p.on) return; p.t += dt; p.x = lerp(p.x, p.vx, dt * 0.8); p.y = lerp(p.y, p.k, dt * 1.2);
    place(p.e, p.x + Math.sin(tm / 400 + p.k) * 2, p.y, 0, 1); p.e.setAttribute("opacity", p.t > 3 ? clamp(1 - (p.t - 3) / 1.2).toFixed(2) : "1"); if (p.t > 4.2) kill(p); });
  /* gauges */
  gg.prim.set(sm.P, wordOf(sm.P, 0.35, 0.65, ["low", "moderate", "high"]));
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.tum.set(sm.T, wordOf(sm.T, 0.35, 0.65, ["small", "present", "large"]));
  gg.ctla.set(sm.CTLA, wordOf(sm.CTLA, 0.3, 0.6, ["blocked", "some", "active"]));
  gg.pd.set(sm.PD, wordOf(sm.PD, 0.3, 0.6, ["blocked", "some", "active"]));
  gg.ae.set(sm.A, wordOf(sm.A, 0.3, 0.55, ["few", "some", "many"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
