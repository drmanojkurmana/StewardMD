/* Leukocyte adhesion scene: flow, selectin rolling, chemokine activation, integrin firm adhesion, transmigration and chemotaxis to a skin infection. */
const CY = SC.CY, WW = SC.W;
const WALLT = CY - 46, WALLB = CY + 46;
const layers = { skin: $("skinSlot"), rbcs: $("rbcs"), endo: $("endo"), marks: $("marks"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel"), grad: $("grad"), flush: $("flush"), ring: $("ring") };
let skinO = null, capEl = null, capDrug = -1;
const siteP = [805, 149];
function capText(d) {
  if (d === 2) return "Anti-integrin caps the grip. Cells roll past and few cross.";
  if (d === 1) return "Adhesion defect weakens rolling and grip. Few cells cross.";
  return "No treatment. Cells roll, grip and cross into the tissue.";
}
/* ---- real anatomy: skin holds the infection; signals and cells travel between it and the wall ---- */
function initOrgans() {
  skinO = organ(layers.skin, "skin", 810, 140, 180, {});
  siteP[0] = Math.round(skinO.ports.dermis[0]); siteP[1] = Math.round(skinO.ports.dermis[1]);
  layers.ring.setAttribute("cx", f1(siteP[0])); layers.ring.setAttribute("cy", f1(siteP[1]));
  const wx = 640, wy = WALLT - 4;
  layers.grad.setAttribute("d", "M" + f1(siteP[0]) + " " + f1(siteP[1])
    + "C" + f1(siteP[0] - 60) + " " + f1(siteP[1] + 30) + " " + f1(wx + 60) + " " + f1(wy - 40) + " " + f1(wx) + " " + f1(wy));
}
/* ---- endothelium: two rows of flat cells ---- */
const WALL_N = 26, endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
/* ---- wall markers: selectins, ICAM and displayed chemokines on the top wall ---- */
const selMarks = [], icamMarks = [], wallChem = [];
function initMarks() {
  for (let x = 48; x < WW - 30; x += 42) { const p = mk("path", { class: "lk-sel", d: "M0 0L0 -6M0 -6L-3 -10M0 -6L3 -10", transform: "translate(" + x + " " + (WALLT + 14) + ")" }, layers.marks); selMarks.push(p); }
  for (let x = 69; x < WW - 30; x += 42) { const p = mk("path", { class: "lk-icam", d: "M0 0L0 -9", transform: "translate(" + x + " " + (WALLT + 13) + ")" }, layers.marks); icamMarks.push(p); }
  for (let x = 58; x < WW - 30; x += 42) { const c = mk("circle", { class: "sc-p p-chem", r: 2.3, cx: x, cy: WALLT + 6 }, layers.marks); wallChem.push(c); }
}
/* ---- red cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- bacteria clustered at the infection focus in the skin ---- */
const bugs = [];
function initSite() {
  for (let i = 0; i < 7; i++) { const g = cell(layers.cells, { cls: "bac", r: 5, seed: i + 11, wob: 0.16 }); bugs.push({ g, x: siteP[0] + rnd(-20, 20), y: siteP[1] + rnd(-14, 14), a: rnd(0, 6.28) }); }
}
/* ---- leukocytes with integrin dots, blocker caps and wall bonds ---- */
const SLOTS = [235, 385, 545, 705];
const neus = Array.from({ length: 6 }, (_, i) => {
  const g = cell(layers.cells, { cls: "neut", r: 12, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.13 });
  const ints = [], blocks = [], bonds = mk("g", {}, g);
  for (let j = 0; j < 5; j++) { const t = -2.4 + j * 0.6; ints.push(mk("circle", { class: "lk-int", r: 1.8, cx: f1(Math.sin(t) * 11), cy: f1(-Math.cos(t) * 11) }, g)); }
  for (let j = 0; j < 3; j++) { const t = -1.8 + j * 0.9; blocks.push(mk("rect", { class: "lk-block", x: f1(Math.sin(t) * 11 - 2.4), y: f1(-Math.cos(t) * 11 - 2.4), width: 4.8, height: 4.8, rx: 1.4, opacity: "0" }, g)); }
  const bRoll = mk("g", { opacity: "0" }, bonds), bFirm = mk("g", { opacity: "0" }, bonds);
  mk("ellipse", { class: "lk-grip", cx: "0", cy: "-2", rx: "19", ry: "12" }, bFirm);
  [-6, 0, 6].forEach((dx) => { mk("path", { class: "lk-bond", d: "M" + dx + " -10L" + dx + " -16" }, bRoll); mk("path", { class: "lk-bond2", d: "M" + dx + " -10L" + dx + " -17" }, bFirm); });
  return { g, ints, blocks, bRoll, bFirm, st: 0, x: -40 - i * 130, y: CY + rnd(-14, 14), t: 0, slot: i % SLOTS.length, capX: 0, tried: false, tx: siteP[0], ty: siteP[1], ph: i * 1.3 };
});
/* ---- chemokine and free blocker-drug particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const chemP = pool(24, () => mk("circle", { class: "sc-p p-chem", r: 2.4 }, layers.parts));
const drugP = pool(22, () => mk("circle", { class: "sc-p p-drug", r: 2.6 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [130, 340, 550, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The response";
  [["chem", "Chemokines", "g-cyt", "Chemokines made at the site and shown on the vessel wall. They switch rolling leukocytes to a sticky grip."], ["roll", "Rolling", "g-neu", "Leukocytes caught by selectins roll slowly along the activated vessel wall instead of flowing past."], ["firm", "Firm adhesion", "g-good", "Activated integrins on the leukocyte bind ICAM on the endothelium and hold the cell firmly."], ["tiss", "In tissue", "g-bad", "Leukocytes that have crossed the endothelium and moved through the tissue toward the infected skin."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Skin infection", siteP[0], siteP[1], 690, 66, "Infection in the skin. Its signals activate the nearby vessel wall and draw leukocytes in.");
  pill(ox, "Leukocyte", 150, 288, 140, 196, "A leukocyte in the blood. Where the wall is activated it can slow, grip and leave.");
  pill(ox, "Rolling", 300, 256, 290, 196, "Rolling: selectins on the activated wall catch the cell again and again, so it rolls slowly.");
  pill(ox, "Chemokines", 470, 252, 455, 196, "Chemokines on the wall switch the rolling cell to a sticky grip.");
  pill(ox, "Firm grip", 640, 256, 630, 196, "Firm grip: integrins on the cell bind ICAM on the wall and hold the cell still.");
  pill(ox, "Crossing", 385, 258, 390, 385, "Crossing: the held cell squeezes between lining cells into the tissue.");
  pill(ox, "Vessel wall", 800, 338, 800, 385, "The vessel lining. When activated it shows selectins, chemokines and ICAM.");
  capEl = mk("text", { class: "lk-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { Chem: 0.4, Roll: 0.3, Firm: 0.2, Tissue: 0.1, anti: 0, def: 0 };
const acc = { chem: 0, drug: 0 };
function init() { initOrgans(); initEndo(); initMarks(); initRbc(); initSite(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Chem = lerp(sm.Chem, m.Chem, k2); sm.Roll = lerp(sm.Roll, m.Roll, k2); sm.Firm = lerp(sm.Firm, m.Firm, k2); sm.Tissue = lerp(sm.Tissue, m.Tissue, k2); sm.anti = lerp(sm.anti, m.anti, k1); sm.def = lerp(sm.def, m.def, k1);
  endo.top.forEach((e, i) => place(e.g, e.x, WALLT + Math.sin(tm / 800 + i) * 0.7, 0, 1));
  endo.bot.forEach((e, i) => place(e.g, e.x, WALLB + Math.sin(tm / 800 + i + 2) * 0.7, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(0.94 0.62)"); e.g.style.setProperty("--act", sm.Chem.toFixed(2)); }));
  layers.flush.setAttribute("opacity", (0.05 + 0.42 * sm.Tissue).toFixed(2));
  selMarks.forEach((p) => p.setAttribute("opacity", ((0.15 + 0.85 * sm.Chem) * (1 - 0.45 * sm.def)).toFixed(2)));
  icamMarks.forEach((p) => p.setAttribute("opacity", (0.1 + 0.9 * sm.Chem).toFixed(2)));
  wallChem.forEach((c) => c.setAttribute("opacity", sm.Chem.toFixed(2)));
  /* red cells flow through the lumen */
  rbcs.forEach((r) => { r.x += r.v * 78 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * 28, r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  /* bacteria wander around the infection focus */
  bugs.forEach((b, i) => { b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 7 * dt; b.y += Math.sin(b.a) * 7 * dt;
    if (b.x < siteP[0] - 26 || b.x > siteP[0] + 26) b.a = Math.PI - b.a; if (b.y < siteP[1] - 20 || b.y > siteP[1] + 20) b.a = -b.a;
    b.x = clamp(b.x, siteP[0] - 26, siteP[0] + 26); b.y = clamp(b.y, siteP[1] - 20, siteP[1] + 20);
    place(b.g, b.x, b.y, Math.sin(tm / 700 + i) * 20, 1); });
  /* chemokines drift from the skin focus toward the vessel wall */
  acc.chem += dt * sm.Chem * 7; while (acc.chem >= 1) { acc.chem--; const p = freeP(chemP); if (p) { const tx = rnd(560, 760), dx = tx - siteP[0], dy = (WALLT - 4) - siteP[1], d = Math.hypot(dx, dy) || 1; emitP(p, siteP[0] + rnd(-14, 14), siteP[1] + rnd(-10, 10), (dx / d) * 30, (dy / d) * 30); } }
  chemP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 22, WW - 22); p.y = clamp(p.y + p.vy * dt, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > WALLT - 8 || p.t > 9) killP(p); });
  /* blocker drug streams through the blood only while it is given */
  acc.drug += dt * sm.anti * 16; while (acc.drug >= 1) { acc.drug--; const p = freeP(drugP); if (p) emitP(p, -12, CY + rnd(-22, 22), rnd(70, 110), rnd(-6, 6)); }
  drugP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y = clamp(p.y + p.vy * dt + Math.sin(tm / 420 + p.t * 3) * 6 * dt, CY - 30, CY + 30); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW + 12 || p.t > 14) killP(p); });
  /* leukocytes: flow, roll, stick, cross, then crawl to the infected skin */
  neus.forEach((n) => {
    n.ints.forEach((c) => c.setAttribute("opacity", (1 - 0.7 * sm.def).toFixed(2)));
    n.blocks.forEach((c, j) => c.setAttribute("opacity", (sm.anti * (0.7 + 0.3 * Math.sin(tm / 280 + n.ph + j))).toFixed(2)));
    const showRoll = n.st === 1, showFirm = n.st === 2 || n.st === 3;
    n.bRoll.setAttribute("opacity", showRoll ? (1 - 0.55 * sm.def).toFixed(2) : "0"); n.bFirm.setAttribute("opacity", showFirm ? "1" : "0");
    if (n.st === 0) { n.g.style.opacity = 1; n.x += 92 * dt; n.y = lerp(n.y, CY + Math.sin(n.ph) * 14, Math.min(1, dt * 2)); place(n.g, n.x, n.y, Math.sin(tm / 500 + n.ph) * 14, 1);
      n.capX = SLOTS[n.slot] - 25;
      if (n.x >= n.capX && !n.tried) { n.tried = true; if (sm.Roll > 0.12 && Math.random() < sm.Roll) { n.st = 1; n.t = 0; } }
      else if (n.x > WW + 30) { n.x = -30; n.tried = false; n.slot = (n.slot + 1) % SLOTS.length; } }
    else if (n.st === 1) { n.t += dt; n.x += 17 * dt; n.y = lerp(n.y, WALLT + 18 + Math.sin(tm / 300 + n.ph) * 1.6, Math.min(1, dt * 5)); place(n.g, n.x, n.y, Math.sin(tm / 260 + n.ph) * 22, 1);
      if (n.x >= SLOTS[n.slot]) { if (sm.Firm > 0.3) { n.st = 2; n.t = 0; } else { n.st = 5; n.t = 0; } } }
    else if (n.st === 2) { n.t += dt; place(n.g, n.x, WALLT + 17, 0, 1.08); if (n.t > 2.4) { if (sm.Firm > 0.25) { n.st = 3; n.t = 0; } else { n.st = 5; n.t = 0; } } }
    else if (n.st === 3) { n.y -= 24 * dt; n.x += 3 * dt; const sq = n.y > WALLT - 8 && n.y < WALLT + 18 ? 0.72 : 1; place(n.g, n.x, n.y, 0, sq); if (n.y < WALLT - 20) { n.st = 4; n.tx = siteP[0] + rnd(-10, 10); n.ty = siteP[1] + rnd(-8, 8); } }
    else if (n.st === 4) { const dx = n.tx - n.x, dy = n.ty - n.y, d = Math.hypot(dx, dy) || 1;
      if (d < 14 || Math.hypot(siteP[0] - n.x, siteP[1] - n.y) < 16) { n.st = 6; n.t = 0; }
      else { n.x += (dx / d) * 34 * dt; n.y += (dy / d) * 34 * dt; }
      place(n.g, clamp(n.x, 24, WW - 24), clamp(n.y, 56, 432), Math.sin(tm / 400 + n.ph) * 12, 1); }
    else if (n.st === 5) { n.t += dt; n.x += 55 * dt; n.y = lerp(n.y, CY, Math.min(1, dt * 1.6)); place(n.g, n.x, n.y, Math.sin(tm / 400 + n.ph) * 12, 1); if (n.y > CY - 6 || n.t > 2.5) { n.st = 0; if (n.x > WW + 30) { n.x = -30; n.tried = false; } } }
    else { n.t += dt; n.g.style.opacity = clamp(1 - n.t * 0.5); place(n.g, n.x, n.y, 0, 1); if (n.t > 2.2) { n.st = 0; n.x = -30 - Math.random() * 80; n.y = CY; n.tried = false; n.slot = (n.slot + 1) % SLOTS.length; n.g.style.opacity = 1; } }
  });
  gg.chem.set(sm.Chem, wordOf(sm.Chem, 0.3, 0.6, ["low", "raised", "high"])); gg.roll.set(sm.Roll, wordOf(sm.Roll, 0.3, 0.6, ["little", "some", "much"]));
  gg.firm.set(sm.Firm, wordOf(sm.Firm, 0.3, 0.6, ["weak", "patchy", "strong"])); gg.tiss.set(sm.Tissue, wordOf(sm.Tissue, 0.3, 0.6, ["few", "some", "many"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
