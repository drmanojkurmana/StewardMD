/* Autoimmunity scene: thymus and marrow training, peripheral guards, escape down a vessel, autoantibodies and kidney injury. */
const L = { base: $("Lbase"), part: $("Lpart"), over: $("Lover"), panel: $("Lpanel") };
const SITE = { apcT: [164, 155], apcB: [480, 155], treg: [755, 130], autoT: [695, 195], anerg: [835, 170], bP: [885, 210], vir: [662, 200] };
const KX = 790, KY = 348, KW = 140;
let kidneyO = null, kidEntry = [721, 340], kidAim = [808, 350], glowEl = null;
let TR_T = null, TR_B = null, TR_AB = null, TR_CY = null, TR_H = null;
const ringEls = [];
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
/* ---- kidney target with injury glow, damage rings, vessel and hormone capsule ---- */
function initOrgans() {
  kidneyO = organ($("kidSlot"), "kidney", KX, KY, KW, {});
  if (kidneyO.ports.vein) kidEntry = kidneyO.ports.vein;
  if (kidneyO.ports.cortex) kidAim = kidneyO.ports.cortex;
  glowEl = mk("ellipse", { class: "ai-glow", cx: f1(KX), cy: f1(KY), rx: 80, ry: 64, opacity: "0" }, L.part);
  [58, 70, 82].forEach((r) => ringEls.push(mk("circle", { class: "dmg-ring", cx: f1(KX), cy: f1(KY), r: r, opacity: "0" }, L.part)));
  $("vesselKid").setAttribute("d", "M700 234 C700 268 " + f1(kidEntry[0] + 20) + " " + f1(kidEntry[1] - 60) + " " + f1(kidEntry[0]) + " " + f1(kidEntry[1]));
  TR_T = track([[164, 192], [205, 252], [320, 302], [kidEntry[0] - 70, kidEntry[1] - 20], kidEntry]);
  TR_B = track([[480, 192], [505, 252], [560, 300], [kidEntry[0] - 40, kidEntry[1] + 10], kidEntry]);
  TR_AB = track([[872, 226], [(872 + kidAim[0]) / 2 + 20, (226 + kidAim[1]) / 2], kidAim]);
  TR_CY = track([[702, 212], [688, 262], [kidAim[0] - 40, kidAim[1] - 6], [kidAim[0] - 24, kidAim[1] + 8]]);
  TR_H = track([[648, 406], [690, 398], kidAim]);
  const cap = mk("g", { class: "hot", tabindex: "0", "data-info": "Replacement hormone: tops up what the injured kidney no longer makes. It does not stop the attack." }, L.base);
  mk("rect", { class: "ai-cap2", x: 617, y: 402, width: 30, height: 12, rx: 6 }, cap);
  mk("path", { class: "ai-capline", d: "M632 402L632 414" }, cap);
}
/* ---- drug badges (symbols only) and stage caption ---- */
const badges = {};
function badge(id, x, y, tip) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip, opacity: "0" }, L.over); mk("circle", { class: "blk-c", cx: x, cy: y, r: 9 }, g); mk("path", { class: "blk-l", d: "M" + (x - 5) + " " + (y + 5) + "L" + (x + 5) + " " + (y - 5) }, g); badges[id] = g; }
let capEl = null, capKey = "";
function capText(d, l) {
  if (l === 0) return "Tolerance holds. Few escapees, and guards calm the rest.";
  if (d === 3) return "Immunosuppression calms attack cells. Kidney injury fades.";
  if (d === 2) return "Anti B therapy clears B cells. Antibody attack falls.";
  if (d === 1) return "Replacement tops up kidney function. The attack itself goes on.";
  return "No treatment. Escaped cells and antibodies injure the kidney.";
}
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, s: 1, tx: 0, ty: 0, st: 0 }; }); }
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
const blockP = pool(10, () => mk("circle", { class: "sc-p p-blk", r: 3.4 }, L.part));
const trapP = pool(6, () => mk("circle", { class: "sc-p p-blk", r: 2.6 }, L.part));
const hormP = pool(8, () => mk("circle", { class: "sc-p p-horm", r: 2.6 }, L.part));
/* ---- labels and gauges ---- */
const gg = {};
function initOver() {
  const P = L.panel, y0 = 478, h = 52, xs = [150, 320, 490, 660, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Tolerance and injury";
  [["esc", "Escape", "g-cyt", "Self-reactive lymphocytes that leave the thymus or marrow instead of being deleted."], ["reg", "Regulation", "g-good", "Peripheral control by regulatory T cells and anergy. High means escapees are held in check."], ["ab", "Antibodies", "g-eos", "Autoantibodies made by B cells against self antigens."], ["dmg", "Damage", "g-bad", "Kidney injury from autoreactive T cells, autoantibodies and inflammation."], ["fn", "Function", "g-good", "How well the kidney still works. Replacement restores function without stopping damage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h + 4, 20, cls, name, tip); });
  const O = L.over;
  pill(O, "Thymus", 95, 130, 108, 96, "Thymus: young T cells are tested against self here. Strong binders are normally deleted.");
  pill(O, "Marrow", 395, 130, 420, 96, "Bone marrow: young B cells are tested against self here. Strong binders are removed or silenced.");
  pill(O, "Guard cell", 755, 130, 805, 82, "Regulatory T cell: a guard that calms escaped self reactive cells. Pale dots show it working.");
  pill(O, "Escapee", 695, 195, 720, 234, "Escaped attack cell: a self reactive T cell that slipped control. Infection mimicry can help trigger it.");
  pill(O, "B cell", 885, 210, 890, 158, "B cell: with help from attack T cells it becomes an antibody factory aimed at self.");
  pill(O, "Antibody", 866, 254, 902, 296, "Autoantibody: antibody against self. It travels to the kidney and recruits inflammation.");
  pill(O, "Kidney", kidAim[0], kidAim[1], 890, 248, "Kidney: the target under attack here. Injury lowers function; treatment can calm the attack or top up function.");
  badge("immT", 720, 182, "Blocked: immunosuppression damps this attack cell, so fewer signals reach the kidney.");
  badge("immB", 885, 182, "Blocked: immunosuppression damps this B cell, so antibody output falls.");
  badge("antiB", 862, 196, "B cells removed: anti B therapy clears B cells, so antibody output falls while T cell injury can continue.");
  badge("repl", 838, 258, "Supported: replacement tops up kidney function while the attack continues.");
  capEl = mk("text", { class: "ai-cap", x: 30, y: 428 }, O); capEl.textContent = capText(0, 1);
}
const sm = { E: 0.4, R: 0.6, T: 0.3, Ab: 0.3, D: 0.2, Fn: 0.7, imm: 0, antiB: 0, repl: 0 };
const acc = { escT: 0, escB: 0, ab: 0, cyt: 0, self: 0, supp: 0, vir: 0, blk: 0, trap: 0, horm: 0 };
function init() { initOrgans(); initOver(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k2); sm.R = lerp(sm.R, m.R, k2); sm.T = lerp(sm.T, m.T, k2); sm.Ab = lerp(sm.Ab, m.Ab, k2); sm.D = lerp(sm.D, m.D, Math.min(1, dt * 0.35)); sm.Fn = lerp(sm.Fn, m.Fn, k1);
  sm.imm = lerp(sm.imm, m.imm, k1); sm.antiB = lerp(sm.antiB, m.antiB, k1); sm.repl = lerp(sm.repl, m.repl, k1);
  badges.immT.setAttribute("opacity", sm.imm.toFixed(2)); badges.immB.setAttribute("opacity", sm.imm.toFixed(2));
  badges.antiB.setAttribute("opacity", sm.antiB.toFixed(2)); badges.repl.setAttribute("opacity", sm.repl.toFixed(2));
  /* kidney injury: glow, rings and swelling track damage; vessel narrows as the attack fades */
  glowEl.setAttribute("opacity", clamp((sm.D - 0.2) * 0.8).toFixed(2));
  ringEls.forEach((r, i) => r.setAttribute("opacity", clamp(sm.D * 1.3 - i * 0.18).toFixed(2)));
  place(kidneyO.g, KX, KY, 0, 1 - 0.05 * sm.D + 0.008 * Math.sin(tm / 500));
  $("vesselKid").setAttribute("stroke-width", f1(5 + 9 * sm.T));
  $("vesselKid").setAttribute("opacity", (0.3 + 0.55 * sm.T).toFixed(2));
  /* central organs pulse; deletion crosses fade as escape rises */
  place(apcT.g, apcT.x + Math.sin(tm / 1200) * 2, apcT.y + Math.cos(tm / 1400) * 2, 0, 1);
  place(apcB.g, apcB.x + Math.sin(tm / 1300 + 2) * 2, apcB.y + Math.cos(tm / 1500) * 2, 0, 1);
  tDevs.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1000 + i * 2) * 2, c.y + Math.cos(tm / 1200 + i) * 2, 0, 1 + 0.05 * Math.sin(tm / 350 + i)));
  bDevs.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1100 + i * 2 + 1) * 2, c.y + Math.cos(tm / 1300 + i) * 2, 0, 1 + 0.05 * Math.sin(tm / 380 + i)));
  delMarks.forEach((g) => g.setAttribute("opacity", clamp(1.05 - sm.E * 1.25).toFixed(2)));
  /* periphery: guard steady, escapee calmed by blockers, B cell cleared by anti B therapy */
  place(tregC.g, tregC.x + Math.sin(tm / 1100) * 2, tregC.y + Math.cos(tm / 1300) * 2, 0, 1 + 0.07 * sm.R * Math.sin(tm / 320));
  place(autoTC.g, autoTC.x + Math.sin(tm / 900 + 1) * 2, autoTC.y + Math.cos(tm / 1100) * 2, 0, (1 + 0.1 * sm.T * Math.sin(tm / 300)) * (1 - 0.15 * sm.imm));
  anergC.g.style.opacity = (0.45 + 0.3 * sm.R).toFixed(2); place(anergC.g, anergC.x, anergC.y, 0, 0.92);
  place(bPC.g, bPC.x + Math.sin(tm / 1000 + 3) * 2, bPC.y + Math.cos(tm / 1200) * 2, 0, (1 + 0.1 * sm.Ab * Math.sin(tm / 340)) * (1 - 0.5 * sm.antiB) * (1 - 0.15 * sm.imm));
  bPC.g.style.opacity = (1 - 0.6 * sm.antiB - 0.15 * sm.imm).toFixed(2);
  suppLine.setAttribute("opacity", clamp(sm.R * 1.1).toFixed(2));
  /* self antigen dots drift inside the two central panels, kept inside the stage */
  acc.self += dt * 4; while (acc.self >= 1) { acc.self--; const p = freeP(selfP); if (p) { const inThy = Math.random() < 0.5; emitP(p, inThy ? rnd(50, 280) : rnd(365, 595), rnd(95, 210)); p.vx = rnd(-7, 7); p.vy = rnd(-5, 5); } }
  selfP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 44, 616); p.y = clamp(p.y + p.vy * dt, 84, 226); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.5) killP(p); });
  /* virus mimic dots wander in the periphery panel only */
  acc.vir += dt * (0.4 + 1.6 * sm.E); while (acc.vir >= 1) { acc.vir--; const p = freeP(virP); if (p) { emitP(p, rnd(660, 694), rnd(185, 220)); p.vx = rnd(10, 26); p.vy = rnd(-7, 7); } }
  virP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 656, 936); p.y = clamp(p.y + p.vy * dt, 84, 230); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 4) killP(p); });
  /* regulatory suppression dots travel from the guard toward the escapee */
  acc.supp += dt * sm.R * 3.2; while (acc.supp >= 1) { acc.supp--; const p = freeP(suppP); if (p) { emitP(p, SITE.treg[0] - 10, SITE.treg[1] + 10); } }
  suppP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = lerp(p.x, SITE.autoT[0] + 8, dt * 1.4); p.y = lerp(p.y, SITE.autoT[1] - 8, dt * 1.4); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) killP(p); });
  /* blocker dots fly in and sit on the attack and B cells while immunosuppression is on */
  acc.blk += dt * sm.imm * 7; while (acc.blk >= 1) { acc.blk--; const p = freeP(blockP); if (p) { emitP(p, rnd(680, 920), rnd(56, 80)); p.st = 0; const toB = Math.random() < 0.4; p.tx = toB ? SITE.bP[0] : SITE.autoT[0]; p.ty = toB ? SITE.bP[1] : SITE.autoT[1]; p.k = rnd(0, 6.28); } }
  blockP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x = lerp(p.x, p.tx, Math.min(1, dt * 2.2)); p.y = lerp(p.y, p.ty, Math.min(1, dt * 2.2)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 7) { p.st = 1; p.t = 0; } }
    else { p.e.setAttribute("transform", "translate(" + f1(p.tx + Math.cos(p.k + tm / 600) * 17) + " " + f1(p.ty + Math.sin(p.k + tm / 600) * 17) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4)).toFixed(2)); if (p.t > 2.4) killP(p); } });
  /* trap dots converge on the B cell while anti B therapy is on */
  acc.trap += dt * sm.antiB * 5; while (acc.trap >= 1) { acc.trap--; const p = freeP(trapP); if (p) { const a = rnd(0, 6.28); emitP(p, SITE.bP[0] + Math.cos(a) * rnd(44, 60), SITE.bP[1] + Math.sin(a) * rnd(44, 60)); } }
  trapP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = lerp(p.x, SITE.bP[0], Math.min(1, dt * 2.5)); p.y = lerp(p.y, SITE.bP[1], Math.min(1, dt * 2.5)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(SITE.bP[0] - p.x, SITE.bP[1] - p.y) < 6 || p.t > 3) killP(p); });
  /* hormone dots flow from the capsule into the kidney while replacement is on */
  acc.horm += dt * sm.repl * 5; while (acc.horm >= 1) { acc.horm--; const p = freeP(hormP); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  hormP.forEach((p) => { if (!p.on) return; p.u += dt * 0.45 * p.s; const q = TR_H.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) killP(p); });
  /* escaping clones travel from central organs down to the kidney */
  acc.escT += dt * sm.T * 2.2; while (acc.escT >= 1) { acc.escT--; const p = freeP(escT); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  escT.forEach((p) => { if (!p.on) return; p.u += dt * 0.16 * p.s; const q = TR_T.at(clamp(p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", p.u > 0.92 ? clamp((1 - p.u) * 12).toFixed(2) : "1"); if (p.u >= 1) killP(p); });
  acc.escB += dt * sm.T * 1.0 * (1 - 0.5 * sm.antiB); while (acc.escB >= 1) { acc.escB--; const p = freeP(escB); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  escB.forEach((p) => { if (!p.on) return; p.u += dt * 0.16 * p.s; const q = TR_B.at(clamp(p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", p.u > 0.92 ? clamp((1 - p.u) * 12).toFixed(2) : "1"); if (p.u >= 1) killP(p); });
  /* autoantibodies from the B cell to the kidney */
  acc.ab += dt * sm.Ab * 6; while (acc.ab >= 1) { acc.ab--; const p = freeP(absP); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  absP.forEach((p) => { if (!p.on) return; p.u += dt * 0.14 * p.s; const q = TR_AB.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a + 90) + ")"); if (p.u >= 1) killP(p); });
  /* signals from the escapee to the kidney fade as blockers dock */
  acc.cyt += dt * sm.T * 6 * (1 - 0.45 * sm.imm); while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cytP); if (p) { emitP(p, 0, 0); p.s = rnd(0.85, 1.15); } }
  cytP.forEach((p) => { if (!p.on) return; p.u += dt * 0.18 * p.s; const q = TR_CY.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x + Math.sin(tm / 220 + p.s * 8) * 3) + " " + f1(q.y) + ")"); if (p.u >= 1) killP(p); });
  /* gauges and the stage caption */
  gg.esc.set(sm.E, wordOf(sm.E, 0.25, 0.60, ["low", "some", "high"])); gg.reg.set(sm.R, wordOf(sm.R, 0.35, 0.65, ["weak", "partial", "strong"])); gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.25, 0.55, ["low", "moderate", "high"])); gg.dmg.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["intact", "injured", "damaged"])); gg.fn.set(sm.Fn, wordOf(sm.Fn, 0.40, 0.70, ["failing", "reduced", "preserved"]));
  const key = drug + ":" + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
