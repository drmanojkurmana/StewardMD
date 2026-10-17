/* Graft rejection scene: donor graft, recipient lymph node, direct and indirect presentation, T and B cell arms, drug targets. */
const L = { base: $("L0"), dir: $("Ldir"), ind: $("Lind"), part: $("Lpart"), over: $("Lover"), panel: $("Lpanel") };
const pathSel = document.getElementById("path");
const SITE = { dc: [505, 168], cd4a: [575, 238], cd8a: [455, 238], apc: [735, 165], cd4b: [795, 250], b: [870, 335] };
const EF = track([[455, 262], [415, 330], [340, 352], [296, 330], [250, 300]]);
const DT = track([[246, 96], [320, 96], [420, 120], [SITE.dc[0] - 6, SITE.dc[1] - 4]]);
const DP = track([[282, 110], [330, 88], [560, 84], [700, 140], [SITE.apc[0] - 14, SITE.apc[1] - 8]]);
const AB = track([[870, 355], [870, 418], [330, 418], [60, 418], [52, 392]]);
const CK = track([[SITE.cd4a[0], SITE.cd4a[1] + 14], [470, 320], [345, 330], [270, 318]]);
const lolli = (g, ang, r, cls, withPep) => { const c = Math.cos(ang), s = Math.sin(ang);
  mk("path", { class: "mhc-stem", d: "M" + f1(c * r) + " " + f1(s * r) + "L" + f1(c * (r + 7)) + " " + f1(s * (r + 7)) }, g);
  mk("circle", { class: cls, cx: f1(c * (r + 9)), cy: f1(s * (r + 9)), r: 3 }, g);
  if (withPep) mk("circle", { class: "pep", cx: f1(c * (r + 12.5)), cy: f1(s * (r + 12.5)), r: 1.6 }, g); };
/* ---- graft: endothelial strip, kidney cells with donor MHC, donor dendritic cells ---- */
const gcells = [], endo = [], comps = [];
function initGraft() {
  for (let i = 0; i < 9; i++) { const y = 108 + i * 33, g = mk("g", {}, L.base); cell(g, { cls: "endo", r: 12, nuc: 0.3, seed: i, wob: 0.07, n: 8 }); place(g, 52, y); endo.push({ g, y, dm: 0 });
    const c = mk("circle", { class: "p-comp", cx: 66, cy: y, r: 4 }, L.part); c.style.opacity = 0; comps.push(c); }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) { const x = 112 + c * 34 + (r % 2) * 8, y = 100 + r * 40, g = mk("g", {}, L.base), body = mk("g", {}, g);
    cell(body, { cls: "graft", r: 14, nuc: 0.38, seed: r * 6 + c, wob: 0.1 });
    for (let k = 0; k < 2; k++) lolli(g, -2.4 + k * 1.4 + (c % 2) * 0.4, 14, "mhc-d", false);
    place(g, x, y); gcells.push({ g, body, x, y, dm: 0, sens: rnd(0.55, 1.25) }); } }
/* ---- donor dendritic cells (they travel to the lymph node) ---- */
const dcs = [0, 1].map((i) => { const g = mk("g", {}, L.dir); for (let k = 0; k < 7; k++) { const t = k * 0.9 + i; mk("path", { class: "den", d: "M0 0L" + f1(Math.cos(t) * 21) + " " + f1(Math.sin(t) * 21) }, g); }
  cell(g, { cls: "donor", r: 12, nuc: 0.4, seed: 30 + i, wob: 0.12 }); const mh = mk("g", { opacity: 0 }, g); for (let k = 0; k < 4; k++) lolli(mh, -1.2 + k * 0.6, 12, "mhc-d", false);
  return { g, mh, st: 0, t: 0, x: 246, y: 96, home: [246 + i * 28, 90 + i * 8], wait: i * 4 }; });
/* ---- recipient T cells, APC, B cell ---- */
const stat = (cls, r, nuc, x, y, parent, seed) => { const g = mk("g", {}, parent); cell(g, { cls, r, nuc, seed, wob: 0.1 }); place(g, x, y); return { g, x, y }; };
const cd4a = stat("th2", 17, 0.55, SITE.cd4a[0], SITE.cd4a[1], L.dir, 51), cd8a = stat("eos", 17, 0.55, SITE.cd8a[0], SITE.cd8a[1], L.dir, 52);
const cd4b = stat("th2", 17, 0.55, SITE.cd4b[0], SITE.cd4b[1], L.ind, 53), bcell = stat("bcell", 18, 0.45, SITE.b[0], SITE.b[1], L.ind, 54);
const apc = (() => { const g = mk("g", {}, L.ind); for (let k = 0; k < 7; k++) { const t = k * 0.9 + 0.4; mk("path", { class: "den", d: "M0 0L" + f1(Math.cos(t) * 24) + " " + f1(Math.sin(t) * 24), style: "stroke:var(--c-mac)" }, g); }
  cell(g, { cls: "mac", r: 15, nuc: 0.4, seed: 55, wob: 0.12 }); const mh = mk("g", {}, g); for (let k = 0; k < 4; k++) lolli(mh, 3.5 + k * 0.55, 15, "mhc-r", true); place(g, SITE.apc[0], SITE.apc[1]); return { g, mh }; })();
const bystand = [[400, 180, "th2"], [640, 200, "eos"], [620, 300, "th2"], [500, 340, "eos"], [880, 190, "th2"], [700, 340, "eos"], [930, 260, "th2"]].map(([x, y, c], i) => { const g = mk("g", {}, L.part); cell(g, { cls: c, r: 11, nuc: 0.55, seed: 60 + i, wob: 0.1 }); place(g, x, y); return { g, x, y, ph: i }; });
/* ---- signal links ---- */
const links = (() => { const d = mk("g", { opacity: 0 }, L.dir), s1 = mk("path", { class: "sig", d: "M" + (SITE.dc[0] + 8) + " " + (SITE.dc[1] + 10) + "L" + (SITE.cd4a[0] - 12) + " " + (SITE.cd4a[1] - 14) }, d), s2 = mk("path", { class: "sig2", d: "M" + (SITE.dc[0] + 14) + " " + (SITE.dc[1] + 4) + "L" + (SITE.cd4a[0] - 4) + " " + (SITE.cd4a[1] - 18) }, d), s1b = mk("path", { class: "sig", d: "M" + (SITE.dc[0] - 8) + " " + (SITE.dc[1] + 10) + "L" + (SITE.cd8a[0] + 12) + " " + (SITE.cd8a[1] - 14) }, d);
  const t1 = mk("text", { class: "sig-t", x: 520, y: 215 }, d); t1.textContent = "1"; const t2 = mk("text", { class: "sig-t", x: 556, y: 196 }, d); t2.textContent = "2";
  const i = mk("g", { opacity: 0 }, L.ind), p1 = mk("path", { class: "sig", d: "M" + (SITE.apc[0] + 14) + " " + (SITE.apc[1] + 16) + "L" + (SITE.cd4b[0] - 8) + " " + (SITE.cd4b[1] - 18) }, i), p2 = mk("path", { class: "sig2", d: "M" + (SITE.apc[0] + 22) + " " + (SITE.apc[1] + 8) + "L" + (SITE.cd4b[0] + 4) + " " + (SITE.cd4b[1] - 18) }, i), hp = mk("path", { class: "sig", style: "stroke-dasharray:2 4", d: "M" + SITE.cd4b[0] + " " + (SITE.cd4b[1] + 18) + "L" + (SITE.b[0] - 6) + " " + (SITE.b[1] - 20) }, i);
  const t3 = mk("text", { class: "sig-t", x: 760, y: 215 }, i); t3.textContent = "1"; const t4 = mk("text", { class: "sig-t", x: 796, y: 203 }, i); t4.textContent = "2"; const t5 = mk("text", { class: "sig-t", x: 836, y: 296 }, i); t5.textContent = "help";
  return { d, i }; })();
/* ---- drug block markers ---- */
const blocks = {};
function blockMark(id, x, y, text, tip) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip, opacity: 0 }, L.over);
  mk("circle", { class: "blk-c", cx: x, cy: y, r: 9 }, g); mk("path", { class: "blk-l", d: "M" + (x - 5) + " " + (y + 5) + "L" + (x + 5) + " " + (y - 5) }, g);
  const t = mk("text", { class: "blk-t", x: x + 13, y: y + 4 }, g); t.textContent = text; blocks[id] = g; }
/* ---- pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, t: 0, u: 0, k: 0, s: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
const kill = (p) => { p.on = false; p.e.setAttribute("opacity", "0"); };
const shed = pool(12, () => mk("rect", { class: "p-shed", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.ind));
const il2 = pool(12, () => mk("rect", { class: "sc-p p-il2", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.dir));
const abs = pool(16, () => mk("path", { class: "p-ab", d: "M0 4V0M-3.4 -4L0 0L3.4 -4" }, L.ind));
const cyk = pool(18, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.part));
const perf = pool(10, () => mk("circle", { class: "p-perf", r: 1.8 }, L.part));
const eff = pool(6, () => { const g = mk("g", {}, L.dir); cell(g, { cls: "eos", r: 9, nuc: 0.5, seed: 70, wob: 0.1 }); return g; });
const macs = pool(3, () => { const g = mk("g", {}, L.part); cell(g, { cls: "mac", r: 12, nuc: 0.4, seed: 80, wob: 0.12 }); return g; });
const clones = pool(8, () => { const g = mk("g", {}, L.part); cell(g, { cls: "th2", r: 7, nuc: 0.5, seed: 90, wob: 0.1 }); return g; });
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
/* ---- labels and gauges ---- */
const gg = {};
function initOver() {
  const P = L.panel, y0 = 478, h = 52, xs = [174, 354, 534, 714];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P); const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The graft";
  [["act", "T-cell activation", "g-cyt", "How strongly recipient T cells have been switched on against the donor tissue."], ["ab", "Donor antibodies", "g-eos", "Antibodies made by B cells that bind donor tissue, especially graft blood vessels."], ["dm", "Graft damage", "g-bad", "Injury to the graft from killer T cells, antibodies, complement and macrophages."], ["fn", "Graft function", "g-good", "How well the graft still works."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h + 4, 20, cls, name, tip); });
  const O = L.over;
  pill(O, "Donor kidney cells", 175, 340, 170, 418, "Donor kidney cells. Their surface carries donor MHC (HLA) molecules, which differ from the recipient's. This difference is what the recipient immune system reacts to.");
  pill(O, "Graft vessels", 52, 108, 64, 86, "The lining of the graft's blood vessels is the first surface that antibodies reach. Complement proteins switch on where antibodies bind and punch holes in these cells (the red rings).");
  pill(O, "Donor DC", 246, 96, 272, 54, "A donor dendritic cell that came with the graft (a passenger cell). It can carry intact donor MHC to a recipient lymph node.");
  pill(O, "CD4 T cell", SITE.cd4a[0], SITE.cd4a[1] + 18, SITE.cd4a[0] + 40, SITE.cd4a[1] + 58, "CD4 helper T cell. It needs signal 1 (its receptor meeting MHC with peptide) and signal 2 (CD28 meeting B7) to switch on, then makes IL-2 and divides.");
  pill(O, "CD8 T cell", SITE.cd8a[0], SITE.cd8a[1] + 18, SITE.cd8a[0] - 22, SITE.cd8a[1] + 62, "CD8 cytotoxic T cell. Once activated it travels to the graft and kills cells that carry donor MHC.");
  pill(O, "Direct pathway", 600, 160, 610, 118, "Direct pathway: donor dendritic cells show intact donor MHC to recipient T cells. It dominates early acute rejection.");
  pill(O, "Recipient APC", SITE.apc[0] - 16, SITE.apc[1] + 14, SITE.apc[0] - 60, SITE.apc[1] + 62, "Recipient antigen-presenting cell. It takes up donor proteins shed from the graft, cuts them into peptides and shows them on its own MHC class II.");
  pill(O, "Indirect pathway", 860, 140, 870, 100, "Indirect pathway: recipient cells show pieces of donor proteins on recipient MHC. It drives antibody help and later, chronic rejection.");
  pill(O, "B cell", SITE.b[0] - 16, SITE.b[1] + 12, SITE.b[0] - 58, SITE.b[1] + 40, "B cell. With help from the CD4 T cell it becomes a plasma cell and makes antibodies against donor proteins.");
  pill(O, "Antibodies", 560, 418, 580, 396, "Donor-specific antibodies travel in the blood and bind the graft's vessel lining.");
  pill(O, "Killer T cell", 310, 345, 330, 392, "Activated CD8 T cells reach the graft, release perforin and granzymes and kill donor cells.");
  blockMark("cni", 604, 266, "no IL-2", "Calcineurin inhibitor: after signal 1, calcineurin switches on the IL-2 gene. Blocking it means the T cell makes little IL-2.");
  blockMark("cos", 548, 190, "CD28 blocked", "Costimulation blocker: it binds B7 on the antigen-presenting cell so CD28 on the T cell gets no signal 2. The T cell is left unresponsive.");
  blockMark("il2r", 598, 214, "IL-2 receptor", "Anti-IL-2 receptor antibody: it covers the IL-2 receptor on activated T cells so IL-2 cannot drive them to divide.");
  blockMark("mmf", 515, 332, "no division", "Antiproliferative: it blocks the building of new DNA in lymphocytes, so activated T and B cells cannot divide.");
  blockMark("atg", 658, 262, "T cells removed", "Anti-thymocyte globulin: antibodies that coat T cells so they are cleared. The T-cell army is depleted.");
  blockMark("st", 340, 306, "steroid", "Corticosteroid: switches off many inflammatory genes, so fewer cytokines and less macrophage activity reach the graft.");
}
const sm = { T: 0.4, Ab: 0.3, G: 0.2, dep: 0, fl: {} };
const dmg = { v: 0 }, acc = { shed: 0, il2: 0, ab: 0, cyk: 0, eff: 0, mac: 0, clone: 0, perf: 0 };
function init() { initGraft(); initOver(); }
function clonePlace(p, x, y) { place(p.e, x, y, 0, 0.3); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45), fl = m.fl;
  sm.T = lerp(sm.T, m.T, k2); sm.Ab = lerp(sm.Ab, m.Ab, k2); sm.G = lerp(sm.G, m.G, Math.min(1, dt * 0.25)); sm.dep = lerp(sm.dep, fl.atg ? 0.75 : 0, k1);
  const pw = pathSel ? +pathSel.value : 0, dirO = pw === 2 ? 0.22 : 1, indO = pw === 1 ? 0.22 : 1;
  L.dir.style.opacity = dirO; L.ind.style.opacity = indO;
  Object.keys(blocks).forEach((id) => { const on = !!fl[id], v = parseFloat(blocks[id].getAttribute("opacity")) || 0; blocks[id].setAttribute("opacity", lerp(v, on ? 1 : 0, k1).toFixed(2)); });
  /* graft cells take damage in proportion to the model, each with its own sensitivity */
  gcells.forEach((c, i) => { c.dm = lerp(c.dm, clamp(sm.G * c.sens * 1.05), Math.min(1, dt * 0.3)); c.body.style.setProperty("--dm", c.dm.toFixed(2)); place(c.g, c.x + Math.sin(tm / 1300 + i) * 0.8, c.y + Math.cos(tm / 1700 + i) * 0.8, 0, 1 - 0.18 * c.dm); });
  comps.forEach((c, i) => { c.style.opacity = clamp(sm.Ab * 1.5 - i * 0.07).toFixed(2); c.setAttribute("r", (4 + 1.2 * Math.sin(tm / 400 + i)).toFixed(1)); });
  endo.forEach((e, i) => e.g.firstChild.style.setProperty("--act", clamp(sm.Ab * 1.2).toFixed(2)));
  /* donor DCs: leave the graft, present in the node, fade */
  const dcRate = sm.T;
  dcs.forEach((d) => { d.wait -= dt;
    if (d.st === 0) { place(d.g, d.home[0], d.home[1], 0, 1); d.g.style.opacity = 1; d.mh.setAttribute("opacity", 0); if (d.wait <= 0 && dcRate > 0.12) { d.st = 1; d.u = 0; } }
    else if (d.st === 1) { d.u += dt * 0.12; const q = DT.at(d.u); place(d.g, q.x, q.y, 0, 1); d.mh.setAttribute("opacity", clamp(d.u * 1.4)); if (d.u >= 1) { d.st = 2; d.t = 0; } }
    else if (d.st === 2) { d.t += dt; const q = DT.at(1); place(d.g, q.x + Math.sin(tm / 500) * 2, q.y + Math.cos(tm / 600) * 2, 0, 1); if (d.t > 7) { d.st = 3; } }
    else { d.g.style.opacity = clamp(parseFloat(d.g.style.opacity) - dt * 0.8); if (parseFloat(d.g.style.opacity) < 0.03) { d.st = 0; d.wait = rnd(3, 7); } } });
  const present = dcs.some((d) => d.st === 2) ? 1 : 0, presN = dcs.filter((d) => d.st === 2).length ? 1 : 0;
  const linkK = clamp(sm.T * 1.3) * presN;
  links.d.setAttribute("opacity", linkK.toFixed(2)); links.i.setAttribute("opacity", clamp(sm.Ab * 1.2 + sm.T * 0.3).toFixed(2));
  /* stationary T cells, B cell: pulse with activation; ATG shrinks and fades them */
  const dep = sm.dep, so = 1 - 0.55 * dep;
  [[cd4a, 0], [cd8a, 1.3], [cd4b, 2.6]].forEach(([c, ph]) => place(c.g, c.x + Math.sin(tm / 900 + ph) * 2, c.y + Math.cos(tm / 1100 + ph) * 2, Math.sin(tm / 1500 + ph) * 6, (1 + 0.1 * sm.T * Math.sin(tm / 300 + ph)) * (1 - 0.35 * dep)));
  [cd4a, cd8a, cd4b].forEach((c) => (c.g.style.opacity = so)); place(bcell.g, bcell.x + Math.sin(tm / 1000) * 2, bcell.y + Math.cos(tm / 1200) * 2, 0, 1 + 0.12 * sm.Ab * Math.sin(tm / 350));
  bystand.forEach((b) => { place(b.g, b.x + Math.sin(tm / 1500 + b.ph) * 4, b.y + Math.cos(tm / 1800 + b.ph) * 4, 0, 1 - 0.4 * dep); b.g.style.opacity = so; });
  apc.mh.setAttribute("opacity", clamp(0.25 + sm.Ab + sm.T * 0.4).toFixed(2)); place(apc.g, SITE.apc[0] + Math.sin(tm / 1000) * 2, SITE.apc[1] + Math.cos(tm / 1200) * 2, Math.sin(tm / 1900) * 5, 1);
  /* shed donor protein travels to the recipient APC */
  acc.shed += dt * (0.4 + 2.4 * sm.G + 0.8 * sm.T); while (acc.shed >= 1) { acc.shed--; const p = free(shed), c = pick(gcells); if (p) { emit(p, c.x, c.y); p.s = rnd(0.8, 1.1); } }
  shed.forEach((p) => { if (!p.on) return; p.u += dt * 0.1 * p.s; const q = DP.at(p.u); const dx = 282 - 282; p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y + Math.sin(tm / 250 + p.s * 9) * 2) + ")"); if (p.u >= 1) kill(p); });
  /* IL-2 made by the activated CD4 T cell, mostly feeding back on itself and the CD8 cell */
  const il2Rate = sm.T * (fl.cni ? 0.15 : 1) * (fl.atg ? 0.4 : 1);
  acc.il2 += dt * il2Rate * 7; while (acc.il2 >= 1) { acc.il2--; const p = free(il2); if (p) { emit(p, cd4a.x + rnd(-10, 10), cd4a.y + rnd(-8, 8)); p.s = Math.random() < 0.5 ? 1 : 0; } }
  il2.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.s ? cd8a.x : cd4a.x, ty = p.s ? cd8a.y : cd4a.y, ph = Math.min(1, p.t / 1.6); p.x = lerp(p.x, tx + Math.cos(p.t * 4) * 24, dt * 1.5); p.y = lerp(p.y, ty - 20 - Math.sin(p.t * 3) * 10, dt * 1.5); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (1 - ph * 0.5).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* proliferation: little clones bud off the activated T cells */
  const cloneRate = sm.T * (fl.mmf ? 0.1 : 1) * (fl.il2r ? 0.35 : 1) * (1 - dep);
  acc.clone += dt * cloneRate * 2; while (acc.clone >= 1) { acc.clone--; const p = free(clones), c = pick([cd4a, cd8a, cd4b]); if (p) { emit(p, c.x, c.y); p.k = rnd(0, 6.28); } }
  clones.forEach((p) => { if (!p.on) return; p.t += dt; const r = 18 + p.t * 14; const x = p.x + Math.cos(p.k) * r, y = p.y + Math.sin(p.k) * r; place(p.e, x, y, 0, clamp(p.t * 2, 0, 1) * 1); p.e.setAttribute("opacity", (1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) kill(p); });
  /* cytotoxic CD8 effectors go from the node to the graft and kill */
  acc.eff += dt * sm.T * (1 - dep) * 0.55; while (acc.eff >= 1) { acc.eff--; const p = free(eff); if (p) { emit(p, 0, 0); p.u = 0; p.k = 0; p.s = rnd(0, 1); p.tg = pick(gcells); } }
  eff.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.u += dt * 0.22; const q = EF.at(p.u); p.x = q.x; p.y = q.y; if (p.u >= 1) { p.k = 1; p.t = 0; p.x = p.tg.x + 18; p.y = p.tg.y; } } else { p.t += dt; p.x = lerp(p.x, p.tg.x + 15, dt * 3); p.y = lerp(p.y, p.tg.y, dt * 3); if (p.t > 3.5) { p.k = 2; } }
    place(p.e, p.x, p.y, p.k === 1 ? Math.sin(tm / 90) * 10 : 0, 1); if (p.k === 2) { const o = parseFloat(p.e.getAttribute("opacity")) - dt * 0.6; p.e.setAttribute("opacity", o.toFixed(2)); if (o < 0.03) kill(p); } else p.e.setAttribute("opacity", "1"); });
  acc.perf += dt * 9; while (acc.perf >= 1) { acc.perf--; const a = eff.find((q) => q.on && q.k === 1), p = free(perf); if (a && p) { emit(p, a.x - 6, a.y); p.tg = a.tg; } }
  perf.forEach((p) => { if (!p.on) return; p.t += dt; p.x -= 18 * dt; p.e.setAttribute("cx", f1(p.x)); p.e.setAttribute("cy", f1(p.y + Math.sin(p.t * 20) * 2)); p.e.setAttribute("opacity", (1 - p.t / 0.6).toFixed(2)); if (p.t > 0.6) kill(p); });
  /* CD4 cytokines head for the graft and call in macrophages */
  const ckRate = sm.T * (fl.st ? 0.3 : 1);
  acc.cyk += dt * ckRate * 5; while (acc.cyk >= 1) { acc.cyk--; const p = free(cyk); if (p) { emit(p, 0, 0); p.u = 0; p.s = rnd(0.8, 1.2); } }
  cyk.forEach((p) => { if (!p.on) return; p.u += dt * 0.2 * p.s; const q = CK.at(p.u); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y + Math.sin(tm / 200 + p.s * 7) * 3)); if (p.u >= 1) kill(p); });
  acc.mac += dt * sm.T * (fl.st ? 0.2 : 1) * 0.3; while (acc.mac >= 1) { acc.mac--; const p = free(macs); if (p) { emit(p, 320, 420); p.tg = pick(gcells); p.k = 0; } }
  macs.forEach((p) => { if (!p.on) return; p.t += dt; p.x = lerp(p.x, p.tg.x + 16, dt * 0.6); p.y = lerp(p.y, p.tg.y + 6, dt * 0.6); place(p.e, p.x, p.y, Math.sin(tm / 300) * 8, 1); p.e.setAttribute("opacity", p.t > 7 ? clamp(1 - (p.t - 7) / 1.5).toFixed(2) : "1"); if (p.t > 8.5) kill(p); });
  /* antibodies from the B cell to the graft vessels */
  const abRate = sm.Ab * (fl.atg ? 0.7 : 1);
  acc.ab += dt * abRate * 6; while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) { emit(p, 0, 0); p.u = 0; p.s = rnd(0.8, 1.2); } }
  abs.forEach((p) => { if (!p.on) return; p.u += dt * 0.12 * p.s; const q = AB.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a + 90) + ")"); if (p.u >= 1) kill(p); });
  /* gauges */
  gg.act.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["low", "moderate", "high"])); gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.3, 0.6, ["low", "moderate", "high"])); gg.dm.set(sm.G, wordOf(sm.G, 0.25, 0.55, ["intact", "injured", "rejecting"])); gg.fn.set(1 - sm.G, wordOf(1 - sm.G, 0.45, 0.75, ["failing", "reduced", "good"]));
}
run({ init, step });
