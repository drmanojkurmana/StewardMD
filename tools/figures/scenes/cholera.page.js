/* Cholera scene: vibrios, toxin entry, G protein and cAMP, CFTR secretion, rice-water stool, dehydration and gauges. */
const WW = SC.W;
const layers = { cells: $("cells"), parts: $("parts"), rbcs: $("rbcs"), over: $("over"), panel: $("panel"), stool: $("stool") };
/* ---- enterocytes with brush border, CFTR and SGLT transporters, G protein in the focus cell ---- */
const cellXs = [140, 260, 380, 500, 620, 740];
const cells = cellXs.map((x, i) => {
  const g = mk("g", {}, layers.cells), c = cell(g, { cls: "ent", r: 30, nuc: 0.4, seed: i * 1.7 + 1, wob: 0.08 });
  for (let j = -2; j <= 2; j++) mk("path", { class: "cho-villi", d: "M" + (j * 8) + " -28l0 -7" }, g);
  return { g, x };
});
[460, 580, 700].forEach((x) => { const g = mk("g", { class: "cftr" }, layers.cells); mk("rect", { class: "cho-cftr", x: x - 8, y: 198, width: 16, height: 8, rx: 3 }, g); });
[200, 320].forEach((x) => { const g = mk("g", { class: "sglt" }, layers.cells); mk("rect", { class: "cho-sglt", x: x - 9, y: 198, width: 18, height: 8, rx: 3 }, g); });
const gprot = mk("g", { id: "gprot" }, layers.cells);
[[366, 220], [380, 211], [394, 220]].forEach(([x, y]) => mk("circle", { class: "cho-gp", cx: x, cy: y, r: 5 }, gprot));
/* ---- vibrios in the lumen ---- */
const vibs = [];
for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-vib" }, layers.cells); mk("ellipse", { class: "cl-b", rx: 7, ry: 3.6 }, g); mk("path", { class: "cho-villi", d: "M7 0q7 3 9 -3" }, g); vibs.push({ g, x: rnd(45, 720), y: rnd(104, 156), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180) }); }
/* ---- red cells in the capillary ---- */
const rbcs = [];
for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(50, 710), y: rnd(-13, 13), v: rnd(0.8, 1.2) }); }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tox = pool(10, () => mk("path", { class: "sc-p p-tox", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.parts));
const camp = pool(16, () => mk("circle", { class: "sc-p p-camp", r: 2.2 }, layers.parts));
const clp = pool(22, () => mk("circle", { class: "sc-p p-cl", r: 2.4 }, layers.parts));
const pair = pool(18, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-camp", r: 2.6, cx: -3 }, g); mk("circle", { class: "sc-p p-cl", r: 2.6, cx: 3 }, g); return g; });
const drops = pool(26, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const stoolP = pool(22, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const orsP = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const ivP = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const abxP = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [80, 250, 420, 590, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["col", "Colonisation", "g-col", "Vibrio cholerae colonising the small bowel surface. An antibiotic brings this down."], ["camp", "cAMP", "g-camp", "Cyclic AMP inside the enterocyte: raised when cholera toxin locks a stimulatory G protein on."], ["sec", "Secretion", "g-sec", "Chloride and water secreted into the lumen through CFTR channels opened by cyclic AMP."], ["loss", "Stool loss", "g-loss", "Profuse watery rice-water stool leaving the gut. Rehydration replaces this loss."], ["deh", "Dehydration", "g-deh", "Body fluid lost in the stool: thirst and dry mouth progressing to sunken eyes, poor skin pinch and low blood pressure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Vibrio cholerae", 105, 115, 120, 68, "Vibrio cholerae: swallowed bacteria that colonise the small bowel surface without invading it.");
  pill(ox, "Cholera toxin", 330, 195, 285, 68, "Cholera toxin: released by the vibrios and taken into the enterocyte, where it locks a stimulatory G protein on.");
  pill(ox, "G protein", 380, 218, 420, 68, "Stimulatory G protein: locked in its active form by cholera toxin, so adenylate cyclase stays switched on.");
  pill(ox, "cAMP rise", 405, 242, 520, 68, "Cyclic AMP rises inside the enterocyte and opens CFTR chloride channels while reducing sodium chloride absorption.");
  pill(ox, "CFTR", 580, 200, 630, 68, "CFTR chloride channel on the luminal membrane: opened by cyclic AMP, it lets chloride leave the cell into the lumen.");
  pill(ox, "Chloride out", 700, 150, 740, 68, "Chloride leaving into the lumen: sodium and water follow it, which is the fluid that is then lost.");
  pill(ox, "Water follows", 770, 125, 865, 68, "Water follows chloride and sodium into the lumen by osmosis, making the stool profuse and watery.");
  const ors = pill(ox, "ORS", 45, 120, 60, 310, "Oral rehydration solution: glucose and sodium are taken up together and water follows, replacing losses even while secretion continues."); ors.setAttribute("id", "ors-pill");
  pill(ox, "Enterocyte", 140, 235, 140, 310, "Enterocyte: the small bowel surface cell that the vibrios colonise and the toxin enters.");
  pill(ox, "Dehydration", 200, 355, 285, 310, "Dehydration: body fluid lost in the stool. The capillary flow slows as circulating volume falls.");
  const abx = pill(ox, "Antibiotic", 180, 240, 395, 310, "An antibiotic can shorten cholera and reduce bacterial shedding. It does not replace lost fluid."); abx.setAttribute("id", "abx-pill");
  const iv = pill(ox, "IV fluid", 480, 355, 500, 310, "Intravenous fluids: refill the circulation directly, bypassing the gut, when dehydration is severe or drinking is not possible."); iv.setAttribute("id", "iv-pill");
  pill(ox, "Rice-water stool", 820, 355, 860, 410, "Rice-water stool: pale, watery stool with flecks of mucus, the route by which fluid and salts leave the body in cholera.");
}
const sm = { V: 0.6, Camp: 0.6, Sec: 0.6, Loss: 0.6, Abs: 0.5, D: 0.5, ors: 0, iv: 0, abx: 0 };
const acc = { tox: 0, camp: 0, cl: 0, pair: 0, drop: 0, stool: 0, ors: 0, iv: 0, abx: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["V", "Camp", "Sec", "Loss", "Abs", "D", "ors", "iv", "abx"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  cells.forEach((c, i) => place(c.g, c.x, 235 + Math.sin(tm / 900 + i) * 1.2, 0, 1));
  layers.cells.querySelectorAll(".cftr").forEach((g) => { g.style.opacity = (0.3 + 0.7 * sm.Sec).toFixed(2); });
  layers.cells.querySelectorAll(".sglt").forEach((g) => { g.style.opacity = (0.35 + 0.65 * sm.Abs).toFixed(2); });
  gprot.style.opacity = (0.25 + 0.75 * sm.Camp).toFixed(2);
  /* vibrios wander in the lumen, more as colonisation rises */
  const want = Math.round(sm.V * vibs.length);
  vibs.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt; if (b.x < 42 || b.x > 760) b.a = Math.PI - b.a; if (b.y < 102 || b.y > 158) b.a = -b.a; b.x = clamp(b.x, 42, 760); b.y = clamp(b.y, 102, 158);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, b.s); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  /* toxin travels from the lumen into the focus enterocyte */
  acc.tox += dt * sm.V * 4; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) emit(p, rnd(70, 260), rnd(108, 150), 0, 0, 0); }
  tox.forEach((p) => { if (!p.on) return; const dx = 372 - p.x, dy = 206 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 46 * dt; p.y += (dy / d) * 46 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 12) kill(p); });
  /* cAMP dots glow inside the enterocytes */
  acc.camp += dt * sm.Camp * 8; while (acc.camp >= 1) { acc.camp--; const p = free(camp); if (p) emit(p, pick(cellXs) + rnd(-13, 13), 235 + rnd(-11, 11), 0, 0, 0); }
  camp.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* chloride leaves through CFTR into the lumen, then joins the stool stream */
  acc.cl += dt * sm.Sec * 10; while (acc.cl >= 1) { acc.cl--; const p = free(clp); if (p) emit(p, pick([460, 580, 700]) + rnd(-4, 4), 194, rnd(4, 12), -rnd(20, 30), 0); }
  clp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 122) { p.vy = 0; p.vx = 58; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 810) kill(p); });
  /* secreted water follows chloride up into the lumen */
  acc.drop += dt * sm.Sec * 7; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(400, 720), 196, rnd(4, 10), -rnd(20, 30), 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 120) { p.vy = 0; p.vx = 58; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 810) kill(p); });
  /* sodium glucose pairs are absorbed down into the capillary, the ORS route */
  acc.pair += dt * sm.Abs * 6; while (acc.pair >= 1) { acc.pair--; const p = free(pair); if (p) emit(p, pick([200, 320]) + rnd(-5, 5), 160, 0, rnd(30, 42), 0); }
  pair.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 348) kill(p); });
  /* rice-water stool: right along the lumen, down the pipe, into the beaker */
  acc.stool += dt * sm.Loss * 11; while (acc.stool >= 1) { acc.stool--; const p = free(stoolP); if (p) emit(p, rnd(55, 280), rnd(104, 152), rnd(55, 80), 0, 0); }
  stoolP.forEach((p) => { if (!p.on) return; if (p.x < 818) { p.x += p.vx * dt; p.y = clamp(p.y, 100, 160); } else { p.x = 819; p.y += 85 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 380) kill(p); });
  const sh = 6 + sm.Loss * 24; layers.stool.setAttribute("y", f1(388 - sh)); layers.stool.setAttribute("height", f1(sh));
  /* red cells slow as dehydration deepens */
  rbcs.forEach((r) => { r.x += r.v * 60 * clamp(1.05 - 0.6 * sm.D) * dt; if (r.x > 718) { r.x = 52; r.y = rnd(-13, 13); } place(r.g, r.x, 355 + r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  /* ORS enters the lumen and feeds the co-transporter */
  acc.ors += dt * sm.ors * 7; while (acc.ors >= 1) { acc.ors--; const p = free(orsP); if (p) emit(p, 40, rnd(106, 148), rnd(45, 62), 0, 0); }
  orsP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; if (p.x > 190) p.y += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 345 || p.x > 730) kill(p); });
  /* IV fluid refills the capillary directly */
  acc.iv += dt * sm.iv * 7; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, 52, 355 + rnd(-14, 14), 92, 0, 0); }
  ivP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 718) kill(p); });
  /* antibiotic capsules head for the vibrios in the lumen */
  acc.abx += dt * sm.abx * 3; while (acc.abx >= 1) { acc.abx--; const p = free(abxP); if (p) emit(p, 70, 292, 0, 0, 0); }
  abxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (240 - p.x) * dt * 0.5 + 20 * dt; p.y += (128 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* treatment pills fade with the model */
  $("ors-pill").style.opacity = sm.ors.toFixed(2); $("iv-pill").style.opacity = sm.iv.toFixed(2); $("abx-pill").style.opacity = sm.abx.toFixed(2);
  /* gauges */
  gg.col.set(sm.V, wordOf(sm.V, 0.3, 0.6, ["low", "present", "high"])); gg.camp.set(sm.Camp, wordOf(sm.Camp, 0.3, 0.6, ["low", "raised", "high"])); gg.sec.set(sm.Sec, wordOf(sm.Sec, 0.4, 0.7, ["low", "raised", "high"]));
  gg.loss.set(sm.Loss, wordOf(sm.Loss, 0.4, 0.7, ["mild", "moderate", "heavy"])); gg.deh.set(sm.D, wordOf(sm.D, 0.38, 0.65, ["none", "some", "severe"]));
}
run({ init, step });
