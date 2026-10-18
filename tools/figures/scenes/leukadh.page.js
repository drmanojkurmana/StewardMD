/* Leukocyte adhesion scene: flow, selectin rolling, chemokine activation, integrin firm adhesion, transmigration and chemotaxis. */
const CY = SC.CY, WW = SC.W;
const WALLT = CY - 46, WALLB = CY + 46;
const layers = { rbc: $("rbcs"), endo: $("endo"), marks: $("marks"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
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
/* ---- leukocytes with integrin dots, blocker caps and wall bonds ---- */
const SLOTS = [235, 385, 545, 705];
const neus = Array.from({ length: 6 }, (_, i) => {
  const g = cell(layers.cells, { cls: "neut", r: 12, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.13 });
  const ints = [], blocks = [], bonds = mk("g", {}, g);
  for (let j = 0; j < 5; j++) { const t = -2.4 + j * 0.6; ints.push(mk("circle", { class: "lk-int", r: 1.8, cx: f1(Math.sin(t) * 11), cy: f1(-Math.cos(t) * 11) }, g)); }
  for (let j = 0; j < 3; j++) { const t = -1.8 + j * 0.9; blocks.push(mk("rect", { class: "lk-block", x: f1(Math.sin(t) * 11 - 2.4), y: f1(-Math.cos(t) * 11 - 2.4), width: 4.8, height: 4.8, rx: 1.4, opacity: "0" }, g)); }
  const bRoll = mk("g", { opacity: "0" }, bonds), bFirm = mk("g", { opacity: "0" }, bonds);
  [-6, 0, 6].forEach((dx) => { mk("path", { class: "lk-bond", d: "M" + dx + " -10L" + dx + " -16" }, bRoll); mk("path", { class: "lk-bond2", d: "M" + dx + " -10L" + dx + " -17" }, bFirm); });
  return { g, ints, blocks, bRoll, bFirm, st: 0, x: -40 - i * 130, y: CY + rnd(-14, 14), t: 0, slot: i % SLOTS.length, capX: 0, tx: 832, ty: 112, ph: i * 1.3 };
});
/* ---- chemokine particle pool ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const chemP = pool(24, () => mk("circle", { class: "sc-p p-chem", r: 2.4 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [130, 340, 550, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The response";
  [["chem", "Chemokines", "g-cyt", "Chemokines made at the site and shown on the vessel wall. They activate rolling leukocytes."], ["roll", "Rolling", "g-neu", "Leukocytes caught by selectins roll slowly along the activated vessel wall instead of flowing past."], ["firm", "Firm adhesion", "g-good", "Activated integrins on the leukocyte bind ICAM on the endothelium and hold the cell firmly."], ["tiss", "In tissue", "g-bad", "Leukocytes that have crossed the endothelium and moved through the tissue toward the site."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Site", 832, 112, 700, 72, "The site in the tissue. Signals from here activate the nearby vessel wall and draw leukocytes in.");
  pill(ox, "Chemotaxis", 690, 150, 600, 95, "Chemotaxis: after crossing, the leukocyte follows chemokine signals through the tissue toward the site.");
  pill(ox, "Leukocyte", 170, 278, 170, 196, "A leukocyte (here a neutrophil) carried in the blood. It can only leave where the wall is activated.");
  pill(ox, "Selectins", 300, 258, 300, 196, "Selectins on the activated endothelium catch the passing leukocyte briefly, again and again, so it rolls.");
  pill(ox, "Integrins", 480, 262, 470, 196, "Integrins on the leukocyte. Chemokines switch them to a sticky state that can grip ICAM.");
  pill(ox, "Chemokines", 640, 258, 620, 196, "Chemokines shown on the vessel wall. They activate the integrins of leukocytes rolling past.");
  pill(ox, "ICAM", 730, 258, 760, 196, "ICAM on the endothelium: the wall partner that activated integrins grip for firm adhesion.");
  pill(ox, "Transmigration", 430, 262, 400, 385, "Transmigration (diapedesis): the firmly held leukocyte squeezes between endothelial cells into the tissue.");
  pill(ox, "Endothelium", 820, 336, 820, 385, "Endothelium: the single-cell lining of the vessel. When activated it shows selectins, chemokines and ICAM.");
}
const sm = { Chem: 0.4, Roll: 0.3, Firm: 0.2, Tissue: 0.1, anti: 0, def: 0 };
const acc = { chem: 0 };
function init() { initEndo(); initMarks(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Chem = lerp(sm.Chem, m.Chem, k2); sm.Roll = lerp(sm.Roll, m.Roll, k2); sm.Firm = lerp(sm.Firm, m.Firm, k2); sm.Tissue = lerp(sm.Tissue, m.Tissue, k2); sm.anti = lerp(sm.anti, m.anti, k1); sm.def = lerp(sm.def, m.def, k1);
  endo.top.forEach((e, i) => place(e.g, e.x, WALLT + Math.sin(tm / 800 + i) * 0.7, 0, 1));
  endo.bot.forEach((e, i) => place(e.g, e.x, WALLB + Math.sin(tm / 800 + i + 2) * 0.7, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(0.94 0.62)"); e.g.style.setProperty("--act", sm.Chem.toFixed(2)); }));
  selMarks.forEach((p) => p.setAttribute("opacity", (0.15 + 0.85 * sm.Chem).toFixed(2)));
  icamMarks.forEach((p) => p.setAttribute("opacity", (0.1 + 0.9 * sm.Chem).toFixed(2)));
  wallChem.forEach((c) => c.setAttribute("opacity", sm.Chem.toFixed(2)));
  /* red cells flow through the lumen */
  rbcs.forEach((r) => { r.x += r.v * 78 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * 28, r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  /* chemokines drift from the site toward the vessel wall */
  acc.chem += dt * sm.Chem * 7; while (acc.chem >= 1) { acc.chem--; const p = freeP(chemP); if (p) { const tx = rnd(580, 770), dx = tx - 832, dy = (WALLT - 4) - 112, d = Math.hypot(dx, dy) || 1; emitP(p, 832 + rnd(-16, 16), 112 + rnd(-12, 12), (dx / d) * 30, (dy / d) * 30); } }
  chemP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 22, WW - 22); p.y = clamp(p.y + p.vy * dt, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > WALLT - 8 || p.t > 9) killP(p); });
  /* leukocytes: flow, roll, stick, cross, then crawl to the site */
  neus.forEach((n) => {
    n.ints.forEach((c) => c.setAttribute("opacity", (1 - 0.75 * sm.def).toFixed(2)));
    n.blocks.forEach((c) => c.setAttribute("opacity", sm.anti.toFixed(2)));
    const showRoll = n.st === 1, showFirm = n.st === 2 || n.st === 3;
    n.bRoll.setAttribute("opacity", showRoll ? "1" : "0"); n.bFirm.setAttribute("opacity", showFirm ? "1" : "0");
    if (n.st === 0) { n.g.style.opacity = 1; n.x += 92 * dt; n.y = lerp(n.y, CY + Math.sin(n.ph) * 14, Math.min(1, dt * 2)); place(n.g, n.x, n.y, Math.sin(tm / 500 + n.ph) * 14, 1);
      n.capX = SLOTS[n.slot] - 25;
      if (n.x >= n.capX && sm.Roll > 0.18 && Math.random() < sm.Roll) { n.st = 1; n.t = 0; }
      else if (n.x > WW + 30) { n.x = -30; n.slot = (n.slot + 1) % SLOTS.length; } }
    else if (n.st === 1) { n.t += dt; n.x += 17 * dt; n.y = lerp(n.y, WALLT + 18 + Math.sin(tm / 300 + n.ph) * 1.6, Math.min(1, dt * 5)); place(n.g, n.x, n.y, Math.sin(tm / 260 + n.ph) * 22, 1);
      if (n.x >= SLOTS[n.slot]) { if (sm.Firm > 0.3) { n.st = 2; n.t = 0; } else { n.st = 5; n.t = 0; } } }
    else if (n.st === 2) { n.t += dt; place(n.g, n.x, WALLT + 17, 0, 1.08); if (n.t > 2.4) { if (sm.Firm > 0.25) { n.st = 3; n.t = 0; } else { n.st = 5; n.t = 0; } } }
    else if (n.st === 3) { n.y -= 24 * dt; n.x += 3 * dt; const sq = n.y > WALLT - 8 && n.y < WALLT + 18 ? 0.72 : 1; place(n.g, n.x, n.y, 0, sq); if (n.y < WALLT - 20) { n.st = 4; n.tx = n.x + 24; n.ty = 165; } }
    else if (n.st === 4) { const dx = n.tx - n.x, dy = n.ty - n.y, d = Math.hypot(dx, dy) || 1;
      if (d < 8) { n.tx = 832 + Math.sin(n.ph) * 22; n.ty = 112 + Math.cos(n.ph) * 18; if (n.tx === 832 + Math.sin(n.ph) * 22 && Math.hypot(n.tx - n.x, n.ty - n.y) < 30) { n.st = 6; n.t = 0; } }
      else { n.x += (dx / d) * 34 * dt; n.y += (dy / d) * 34 * dt; }
      place(n.g, clamp(n.x, 24, WW - 24), clamp(n.y, 56, 432), Math.sin(tm / 400 + n.ph) * 12, 1);
      if (Math.hypot(832 - n.x, 112 - n.y) < 30) { n.st = 6; n.t = 0; } }
    else if (n.st === 5) { n.t += dt; n.x += 55 * dt; n.y = lerp(n.y, CY, Math.min(1, dt * 1.6)); place(n.g, n.x, n.y, Math.sin(tm / 400 + n.ph) * 12, 1); if (n.y > CY - 6 || n.t > 2.5) { n.st = 0; if (n.x > WW + 30) n.x = -30; } }
    else { n.t += dt; n.g.style.opacity = clamp(1 - n.t * 0.5); place(n.g, n.x, n.y, 0, 1); if (n.t > 2.2) { n.st = 0; n.x = -30 - Math.random() * 80; n.y = CY; n.slot = (n.slot + 1) % SLOTS.length; n.g.style.opacity = 1; } }
  });
  gg.chem.set(sm.Chem, wordOf(sm.Chem, 0.3, 0.6, ["low", "raised", "high"])); gg.roll.set(sm.Roll, wordOf(sm.Roll, 0.3, 0.6, ["little", "some", "much"]));
  gg.firm.set(sm.Firm, wordOf(sm.Firm, 0.3, 0.6, ["weak", "patchy", "strong"])); gg.tiss.set(sm.Tissue, wordOf(sm.Tissue, 0.3, 0.6, ["few", "some", "many"]));
}
run({ init, step });
