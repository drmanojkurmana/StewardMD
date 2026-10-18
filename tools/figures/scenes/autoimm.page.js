/* Autoimmunity scene: central deletion in thymus and marrow, peripheral regulation and anergy, escape, autoantibodies and tissue injury. */
const L = { base: $("Lbase"), part: $("Lpart"), over: $("Lover"), panel: $("Lpanel") };
const SITE = { apcT: [164, 155], apcB: [480, 155], treg: [755, 130], autoT: [695, 190], anerg: [835, 170], bP: [885, 210], vir: [660, 215] };
const TR_T = track([[164, 192], [205, 252], [320, 302], [420, 358]]);
const TR_B = track([[480, 192], [505, 252], [545, 302], [580, 358]]);
const TR_AB = track([[872, 226], [845, 290], [725, 338], [628, 358]]);
const TR_CY = track([[688, 206], [640, 262], [562, 318], [505, 358]]);
/* ---- central organs: presenting cells and developing lymphocytes ---- */
function presenting(x, y, seed) { const g = mk("g", {}, L.base); cell(g, { cls: "mac", r: 18, nuc: 0.4, seed: seed, wob: 0.12 }); place(g, x, y); return { g, x, y }; }
const apcT = presenting(SITE.apcT[0], SITE.apcT[1], 11), apcB = presenting(SITE.apcB[0], SITE.apcB[1], 12);
function devCell(cls, x, y, seed) { const g = mk("g", {}, L.base); cell(g, { cls: cls, r: 13, nuc: 0.5, seed: seed, wob: 0.1 }); place(g, x, y); return { g, x, y }; }
const tDevs = [devCell("th2", 95, 130, 21), devCell("th2", 122, 186, 22), devCell("th2", 225, 135, 23)];
const bDevs = [devCell("bcell", 395, 130, 24), devCell("bcell", 432, 186, 25), devCell("bcell", 545, 135, 26)];
const delMarks = [];
function delMark(x, y) { const g = mk("g", { opacity: "0.9" }, L.over); mk("path", { class: "del-x", d: "M-6 -6L6 6M6 -6L-6 6" }, g); place(g, x + 10, y - 10, 0, 1); delMarks.push(g); }
tDevs.forEach((c) => delMark(c.x, c.y)); bDevs.forEach((c) => delMark(c.x, c.y));
/* ---- periphery cells ---- */
function statCell(cls, r, x, y, seed, parent) { const g = mk("g", {}, parent || L.base); cell(g, { cls: cls, r: r, nuc: 0.5, seed: seed, wob: 0.1 }); place(g, x, y); return { g, x, y }; }
const tregC = statCell("treg", 17, SITE.treg[0], SITE.treg[1], 31);
const autoTC = statCell("th2", 15, SITE.autoT[0], SITE.autoT[1], 32);
const anergC = statCell("th2", 13, SITE.anerg[0], SITE.anerg[1], 33);
const bPC = statCell("bcell", 15, SITE.bP[0], SITE.bP[1], 34);
const virIcon = (() => { const g = mk("g", {}, L.base); for (let j = 0; j < 8; j++) { const t = j * 0.785; mk("path", { class: "vir-spike", d: "M0 0L" + f1(Math.cos(t) * 11) + " " + f1(Math.sin(t) * 11) }, g); } mk("circle", { class: "sc-p p-vir", r: 6 }, g); place(g, SITE.vir[0], SITE.vir[1]); return g; })();
const suppLine = mk("path", { class: "supp", d: "M" + (SITE.treg[0] - 12) + " " + (SITE.treg[1] + 12) + "L" + (SITE.autoT[0] + 10) + " " + (SITE.autoT[1] - 12) }, L.base);
/* ---- target tissue cells and damage rings ---- */
const tisCells = [], dmgRings = [];
for (let i = 0; i < 9; i++) { const x = 80 + i * 100, y = 372, g = mk("g", {}, L.base); cell(g, { cls: "tis2", r: 15, nuc: 0.38, seed: 40 + i, wob: 0.1 }); place(g, x, y); tisCells.push({ g, x, y }); const ring = mk("circle", { class: "dmg-ring", cx: x, cy: y, r: 20, opacity: "0" }, L.part); dmgRings.push(ring); }
/* ---- drug block markers ---- */
const blocks = {};
function blockMark(id, x, y, text, tip) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip, opacity: "0" }, L.over); const t = mk("text", { class: "blk-t", x: x, y: y - 14, "text-anchor": "middle" }, g); t.textContent = text; mk("circle", { class: "blk-c", cx: x, cy: y, r: 9 }, g); mk("path", { class: "blk-l", d: "M" + (x - 5) + " " + (y + 5) + "L" + (x + 5) + " " + (y - 5) }, g); blocks[id] = g; }
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, s: 1 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const escT = pool(6, () => { const g = mk("g", {}, L.part); cell(g, { cls: "th2", r: 7, nuc: 0.5, seed: 51, wob: 0.1 }); return g; });
const escB = pool(4, () => { const g = mk("g", {}, L.part); cell(g, { cls: "bcell", r: 7, nuc: 0.45, seed: 52, wob: 0.1 }); return g; });
const absP = pool(14, () => mk("path", { class: "p-ab", d: "M0 4V0M-3.4 -4L0 0L3.4 -4" }, L.part));
const cytP = pool(12, () => mk("circle", { class: "sc-p p-cytk", r: 2.4 }, L.part));
const selfP = pool(10, () => mk("circle", { class: "sc-p p-self", r: 2.2 }, L.part));
const suppP = pool(8, () => mk("circle", { class: "sc-p p-cytk", r: 2, style: "fill:var(--c-ab)" }, L.part));
const virP = pool(5, () => mk("circle", { class: "sc-p p-vir", r: 3 }, L.part));
/* ---- labels and gauges ---- */
const gg = {};
function initOver() {
  const P = L.panel, y0 = 478, h = 52, xs = [150, 320, 490, 660, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Tolerance and injury";
  [["esc", "Escape", "g-cyt", "Self-reactive lymphocytes that leave the thymus or marrow instead of being deleted."], ["reg", "Regulation", "g-good", "Peripheral control by regulatory T cells and anergy. High means escapees are held in check."], ["ab", "Antibodies", "g-eos", "Autoantibodies made by B cells against self antigens."], ["dmg", "Damage", "g-bad", "Tissue injury from autoreactive T cells, autoantibodies and inflammation."], ["fn", "Function", "g-good", "How well the target organ still works. Replacement restores function without stopping damage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h + 4, 20, cls, name, tip); });
  const O = L.over;
  pill(O, "Developing T cell", 95, 130, 105, 96, "Developing T cell in the thymus. If it binds self strongly it is normally deleted before it can leave.");
  pill(O, "Deleted clone", 225, 135, 240, 96, "Central deletion: a strongly self-reactive clone is removed by cell death in the thymus or marrow. The cross fades when clones escape instead.");
  pill(O, "Developing B cell", 395, 130, 420, 96, "Developing B cell in the bone marrow. Strong binding to self leads to deletion, editing or unresponsiveness.");
  pill(O, "Regulatory T cell", 755, 130, 760, 96, "Regulatory T cell: a peripheral guard. It suppresses self-reactive cells that escaped central deletion.");
  pill(O, "Anergic cell", 835, 170, 860, 138, "Anergic cell: a self-reactive cell that met self antigen without costimulation and was switched off rather than deleted.");
  pill(O, "Virus mimic", 665, 210, 700, 228, "Infection mimicry: a microbe carries shapes close to self. The response to the microbe can cross-react with self tissue.");
  pill(O, "HLA risk", 500, 285, 470, 298, "HLA risk genes: inherited antigen-presentation variants linked to susceptibility. Non-HLA genes and epigenetic change also shape risk.");
  pill(O, "Autoantibody", 620, 360, 580, 298, "Autoantibody: antibody against self, made after B cell help from autoreactive T cells. It binds target tissue and recruits inflammation.");
  pill(O, "Injured cell", 240, 372, 240, 325, "Target tissue cell under attack by autoreactive T cells and autoantibodies. Injury may stay in one organ or spread systemically.");
  pill(O, "Hidden antigen", 380, 372, 400, 325, "Hidden antigen: self material normally sequestered from the immune system. Injury releases it, along with nucleic acids from dying cells, and can start or worsen autoimmunity.");
  blockMark("imm", 720, 180, "dampened", "Immunosuppression broadly dampens autoreactive T and B cell activity, so fewer effectors and antibodies reach the tissue.");
  blockMark("antiB", 885, 178, "B cells off", "Anti-B cell therapy removes B cells. Autoantibodies fall, while autoreactive T cell injury can continue.");
  blockMark("repl", 480, 418, "replaced", "Replacing lost function restores what the damaged organ no longer provides. It does not itself stop the immune attack, so damage can continue.");
}
const sm = { E: 0.4, R: 0.6, T: 0.3, Ab: 0.3, D: 0.2, Fn: 0.7, imm: 0, antiB: 0, repl: 0 };
const acc = { escT: 0, escB: 0, ab: 0, cyt: 0, self: 0, supp: 0, vir: 0 };
function init() { initOver(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k2); sm.R = lerp(sm.R, m.R, k2); sm.T = lerp(sm.T, m.T, k2); sm.Ab = lerp(sm.Ab, m.Ab, k2); sm.D = lerp(sm.D, m.D, Math.min(1, dt * 0.35)); sm.Fn = lerp(sm.Fn, m.Fn, k1);
  sm.imm = lerp(sm.imm, m.imm, k1); sm.antiB = lerp(sm.antiB, m.antiB, k1); sm.repl = lerp(sm.repl, m.repl, k1);
  blocks.imm.setAttribute("opacity", sm.imm.toFixed(2)); blocks.antiB.setAttribute("opacity", sm.antiB.toFixed(2)); blocks.repl.setAttribute("opacity", sm.repl.toFixed(2));
  /* central organs pulse; deletion crosses fade as escape rises */
  place(apcT.g, apcT.x + Math.sin(tm / 1200) * 2, apcT.y + Math.cos(tm / 1400) * 2, 0, 1);
  place(apcB.g, apcB.x + Math.sin(tm / 1300 + 2) * 2, apcB.y + Math.cos(tm / 1500) * 2, 0, 1);
  tDevs.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1000 + i * 2) * 2, c.y + Math.cos(tm / 1200 + i) * 2, 0, 1 + 0.05 * Math.sin(tm / 350 + i)));
  bDevs.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1100 + i * 2 + 1) * 2, c.y + Math.cos(tm / 1300 + i) * 2, 0, 1 + 0.05 * Math.sin(tm / 380 + i)));
  delMarks.forEach((g) => g.setAttribute("opacity", clamp(1.05 - sm.E * 1.25).toFixed(2)));
  /* periphery: Treg steady, autoreactive cell pulses with activation, anergic cell dim, B cell pulses with antibodies */
  place(tregC.g, tregC.x + Math.sin(tm / 1100) * 2, tregC.y + Math.cos(tm / 1300) * 2, 0, 1 + 0.07 * sm.R * Math.sin(tm / 320));
  place(autoTC.g, autoTC.x + Math.sin(tm / 900 + 1) * 2, autoTC.y + Math.cos(tm / 1100) * 2, 0, 1 + 0.1 * sm.T * Math.sin(tm / 300));
  anergC.g.style.opacity = (0.45 + 0.3 * sm.R).toFixed(2); place(anergC.g, anergC.x, anergC.y, 0, 0.92);
  place(bPC.g, bPC.x + Math.sin(tm / 1000 + 3) * 2, bPC.y + Math.cos(tm / 1200) * 2, 0, (1 + 0.1 * sm.Ab * Math.sin(tm / 340)) * (1 - 0.45 * sm.antiB));
  bPC.g.style.opacity = (1 - 0.55 * sm.antiB).toFixed(2);
  suppLine.setAttribute("opacity", clamp(sm.R * 1.1).toFixed(2));
  /* self antigen dots drift inside the two central panels, kept inside the stage */
  acc.self += dt * 4; while (acc.self >= 1) { acc.self--; const p = freeP(selfP); if (p) { const inThy = Math.random() < 0.5; emitP(p, inThy ? rnd(50, 280) : rnd(365, 595), rnd(95, 210)); p.vx = rnd(-7, 7); p.vy = rnd(-5, 5); } }
  selfP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 44, 616); p.y = clamp(p.y + p.vy * dt, 84, 226); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.5) killP(p); });
  /* virus mimic dots wander in the periphery panel only */
  acc.vir += dt * (0.4 + 1.6 * sm.E); while (acc.vir >= 1) { acc.vir--; const p = freeP(virP); if (p) { emitP(p, rnd(665, 700), rnd(195, 230)); p.vx = rnd(10, 26); p.vy = rnd(-7, 7); } }
  virP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 656, 936); p.y = clamp(p.y + p.vy * dt, 84, 230); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 4) killP(p); });
  /* regulatory suppression dots travel from Treg toward the autoreactive cell */
  acc.supp += dt * sm.R * 3.2; while (acc.supp >= 1) { acc.supp--; const p = freeP(suppP); if (p) { emitP(p, SITE.treg[0] - 10, SITE.treg[1] + 10); } }
  suppP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = lerp(p.x, SITE.autoT[0] + 8, dt * 1.4); p.y = lerp(p.y, SITE.autoT[1] - 8, dt * 1.4); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) killP(p); });
  /* escaping clones travel from central organs down to the tissue */
  acc.escT += dt * sm.T * 1.5; while (acc.escT >= 1) { acc.escT--; const p = freeP(escT); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  escT.forEach((p) => { if (!p.on) return; p.u += dt * 0.16 * p.s; const q = TR_T.at(clamp(p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", p.u > 0.92 ? clamp((1 - p.u) * 12).toFixed(2) : "1"); if (p.u >= 1) killP(p); });
  acc.escB += dt * sm.T * 0.8; while (acc.escB >= 1) { acc.escB--; const p = freeP(escB); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  escB.forEach((p) => { if (!p.on) return; p.u += dt * 0.16 * p.s; const q = TR_B.at(clamp(p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", p.u > 0.92 ? clamp((1 - p.u) * 12).toFixed(2) : "1"); if (p.u >= 1) killP(p); });
  /* autoantibodies from the peripheral B cell to the tissue */
  acc.ab += dt * sm.Ab * 5; while (acc.ab >= 1) { acc.ab--; const p = freeP(absP); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  absP.forEach((p) => { if (!p.on) return; p.u += dt * 0.14 * p.s; const q = TR_AB.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a + 90) + ")"); if (p.u >= 1) killP(p); });
  /* proinflammatory cytokines from the autoreactive T cell to the tissue */
  acc.cyt += dt * sm.T * 5; while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cytP); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  cytP.forEach((p) => { if (!p.on) return; p.u += dt * 0.18 * p.s; const q = TR_CY.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x + Math.sin(tm / 220 + p.s * 8) * 3) + " " + f1(q.y) + ")"); if (p.u >= 1) killP(p); });
  /* tissue injury: cells shrink a little and damage rings grow */
  tisCells.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1400 + i) * 0.7, c.y + Math.cos(tm / 1600 + i) * 0.7, 0, 1 - 0.16 * sm.D));
  dmgRings.forEach((r, i) => { const v = clamp(sm.D * 1.25 - i * 0.05); r.setAttribute("opacity", (v * 0.9).toFixed(2)); r.setAttribute("r", (19 + 2.5 * Math.sin(tm / 420 + i)).toFixed(1)); });
  /* gauges */
  gg.esc.set(sm.E, wordOf(sm.E, 0.25, 0.60, ["low", "some", "high"])); gg.reg.set(sm.R, wordOf(sm.R, 0.35, 0.65, ["weak", "partial", "strong"])); gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.25, 0.55, ["low", "moderate", "high"])); gg.dmg.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["intact", "injured", "damaged"])); gg.fn.set(sm.Fn, wordOf(sm.Fn, 0.40, 0.70, ["failing", "reduced", "preserved"]));
}
run({ init, step });
