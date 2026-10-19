/* Cholera scene: vibrios, toxin entry, G protein and cAMP, CFTR secretion, rice-water stool, dehydration and gauges.
 * Bowel and vessel come from organs.lib.js; flows and labels anchor to their ports.
 * Each treatment visibly acts on the drawing: ORS opens wide absorption
 * streams into the vessel, antibiotic dots hunt vibrios and shrink them while
 * toxin signalling fades, and a drip bag appears and widens the vessel.
 * A caption in the stage follows the state. */
const WW = SC.W;
const layers = { bowelS: $("bowelSlot"), vesselS: $("vesselSlot"), glow: $("glowG"), cells: $("cells"), parts: $("parts"), rbcs: $("rbcs"), over: $("over"), panel: $("panel"), stool: $("stool"), bag: $("bagG") };
const orsFlowEls = [$("orsFlowA"), $("orsFlowB"), $("orsFlowC")];
/* ---- real anatomy; flows and labels anchor to its ports ---- */
let bowelO = null, vesselO = null, coils = [164, 339], vTop = [470, 242], vBot = [470, 408];
function initOrgans() {
  bowelO = organ(layers.bowelS, "bowel", 160, 330, 150, {});
  vesselO = organ(layers.vesselS, "vessel", 470, 325, 90, { h: 170 });
  coils = bowelO.ports.coils;
  vTop = vesselO.ports.in; vBot = vesselO.ports.out;
}
function capText(l, d) {
  const L = l === 0 ? "Mild loss. " : l === 1 ? "Moderate loss. " : "Heavy loss. ";
  let D = "No treatment, so water keeps pouring out.";
  if (d === 1) D = "ORS uses the SGLT route to pull salt and water back into blood.";
  else if (d === 2) D = "Antibiotic kills vibrios, so toxin fades and the gates close.";
  else if (d === 3) D = "A drip refills the blood directly, bypassing the gut.";
  return L + D;
}
/* ---- wall cells with brush border, SGLT and CFTR gates, G protein in the focus cell ---- */
const cellXs = [];
for (let i = 0; i < 9; i++) cellXs.push(110 + i * 70);
const cells = cellXs.map((x, i) => {
  const g = mk("g", {}, layers.cells);
  cell(g, { cls: "ent", r: 24, nuc: 0.4, seed: i * 1.7 + 1, wob: 0.08 });
  for (let j = -2; j <= 2; j++) mk("path", { class: "cho-villi", d: "M" + (j * 8) + " -24l0 -7" }, g);
  place(g, x, 196, 0, 1);
  return { g, x };
});
const sgltXs = [180, 320, 460, 600, 680], cftrXs = [250, 390, 530, 660];
sgltXs.forEach((x) => { const g = mk("g", { class: "sglt" }, layers.cells); mk("rect", { class: "cho-sglt", x: x - 9, y: 164, width: 18, height: 8, rx: 3 }, g); });
cftrXs.forEach((x) => { const g = mk("g", { class: "cftr" }, layers.cells); mk("rect", { class: "cho-cftr", x: x - 8, y: 164, width: 16, height: 8, rx: 3 }, g); });
const gprot = mk("g", { id: "gprot" }, layers.cells);
[[366, 220], [380, 211], [394, 220]].forEach(([x, y]) => mk("circle", { class: "cho-gp", cx: x, cy: y, r: 5 }, gprot));
/* ---- vibrios in the lumen; antibiotic dots shrink them on contact ---- */
const vibs = [];
for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-vib" }, layers.cells); mk("ellipse", { class: "cl-b", rx: 7, ry: 3.6 }, g); mk("path", { class: "cho-villi", d: "M7 0q7 3 9 -3" }, g); vibs.push({ g, x: rnd(45, 720), y: rnd(86, 132), a: rnd(0, 6.28), s: 1, hitT: 0, vis: 1, rot: rnd(0, 180) }); }
/* ---- red cells flowing down inside the vessel ---- */
const rbcs = [];
for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.6 }, g); rbcs.push({ g, x: rnd(440, 500), y: rnd(250, 405), v: rnd(0.8, 1.2) }); }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tox = pool(10, () => mk("path", { class: "sc-p p-tox", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.parts));
const camp = pool(16, () => mk("circle", { class: "sc-p p-camp", r: 2.2 }, layers.parts));
const clp = pool(22, () => mk("circle", { class: "sc-p p-cl", r: 2.4 }, layers.parts));
const pair = pool(24, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-na", r: 2.6, cx: -3 }, g); mk("circle", { class: "sc-p p-glu", r: 2.6, cx: 3 }, g); return g; });
const drops = pool(26, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const stoolP = pool(22, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const orsP = pool(12, () => mk("path", { class: "p-fl p-ors", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const ivP = pool(10, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const hunt = pool(10, () => mk("circle", { class: "sc-p p-abx", r: 3.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- antibiotic dots home onto visible vibrios and sit on them ---- */
function hunters(dt, active) {
  const targets = vibs.filter((t) => t.vis > 0.15);
  hunt.forEach((h, i) => {
    if (!active || !targets.length) { if (h.on) kill(h); return; }
    const T = targets[i % targets.length];
    if (!h.on) emit(h, T.x + rnd(-90, 90), 130 + rnd(-40, 40), 0, 0, 0);
    const dx = T.x - h.x, dy = T.y - h.y, d = Math.hypot(dx, dy) || 1;
    const st = Math.min(d, 150 * dt);
    h.x += dx / d * st; h.y += dy / d * st;
    place(h.e, h.x, h.y, 0, 1);
    if (d < 14) T.hitT = 1;
  });
}
/* ---- labels, treatment marks, caption and gauges ---- */
const gg = {};
let ivMark = null, abxMark = null, capEl = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [80, 250, 420, 590, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["col", "Colonisation", "g-col", "Vibrio cholerae colonising the small bowel surface. An antibiotic brings this down."], ["camp", "cAMP", "g-camp", "Cyclic AMP inside the wall: raised when cholera toxin locks a stimulatory G protein on."], ["sec", "Secretion", "g-sec", "Salt and water secreted into the lumen through CFTR gates opened by cyclic AMP."], ["loss", "Stool loss", "g-loss", "Profuse watery rice-water stool leaving the gut. Fluids replace this loss."], ["deh", "Dehydration", "g-deh", "Blood and body fluid lost in the stool. The vessel narrows and flow slows as dehydration deepens."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Vibrios", 100, 105, 100, 58, "Vibrio cholerae: swallowed bacteria that colonise the small bowel surface without invading it.");
  pill(ox, "Toxin opens salt gates", 300, 185, 300, 58, "Cholera toxin enters the wall and locks a stimulatory G protein on, so cAMP rises and CFTR salt gates open.");
  pill(ox, "SGLT route", 680, 168, 775, 58, "SGLT on the surface carries salt with sugar into blood, and water follows. cAMP does not switch it off, which is why ORS works.");
  pill(ox, "Small bowel", coils[0], coils[1], 160, 400, "Small bowel, magnified in the strip above. Most salt and water uptake happens across this wall.");
  pill(ox, "Blood", 470, 330, 470, 400, "Blood in the wall. Uptake refills it; loss without uptake lets it run dry, so flow slows.");
  pill(ox, "Stool loss", 824, 355, 824, 400, "Rice-water stool: pale, watery stool, the route by which fluid and salts leave the body.");
  ivMark = pill(ox, "Drip refills blood", 375, 297, 310, 250, "Intravenous fluid runs straight into blood and refills it without using the gut.");
  abxMark = pill(ox, "Vibrios killed", 180, 120, 340, 148, "Antibiotic dots sit on vibrios and shrink them, so toxin and secretion fall.");
  capEl = mk("text", { class: "cho-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { V: 0.6, Camp: 0.6, Sec: 0.6, Loss: 0.6, Abs: 0.5, D: 0.5, ors: 0, iv: 0, abx: 0 };
const acc = { tox: 0, camp: 0, cl: 0, pair: 0, drop: 0, stool: 0, ors: 0, iv: 0 };
let capL = -1, capD = -1;
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["V", "Camp", "Sec", "Loss", "Abs", "D", "ors", "iv", "abx"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  /* vessel narrows as dehydration deepens, reopens with fluids */
  const vsx = 1 - 0.25 * sm.D;
  vesselO.g.setAttribute("transform", "translate(" + f1(vesselO.x) + " " + f1(vesselO.y) + ") scale(" + vsx.toFixed(3) + " 1)");
  layers.glow.setAttribute("opacity", (sm.D * 0.35).toFixed(2));
  /* ORS absorption streams pour into the vessel */
  orsFlowEls.forEach((e) => e.setAttribute("opacity", (sm.ors * 0.8).toFixed(2)));
  /* drip bag and tube appear with intravenous fluids */
  layers.bag.setAttribute("opacity", sm.iv.toFixed(2));
  layers.bag.style.display = sm.iv > 0.03 ? "" : "none";
  /* wall cells hold steady; gates follow secretion and uptake */
  cells.forEach((c, i) => { place(c.g, c.x, 196 + Math.sin(tm / 900 + i) * 1.2, 0, 1); });
  layers.cells.querySelectorAll(".sglt").forEach((g) => { g.style.opacity = (0.35 + 0.65 * sm.Abs).toFixed(2); });
  layers.cells.querySelectorAll(".cftr").forEach((g) => { g.style.opacity = (0.3 + 0.7 * sm.Sec).toFixed(2); });
  gprot.style.opacity = (0.25 + 0.75 * sm.Camp).toFixed(2);
  /* vibrios wander in the lumen, fewer as colonisation falls, shrinking while a drug dot sits on them */
  const want = Math.round(sm.V * vibs.length);
  vibs.forEach((b, i) => {
    const on = i < want;
    b.hitT = Math.max(0, b.hitT - dt * 0.22);
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt; if (b.x < 42 || b.x > 760) b.a = Math.PI - b.a; if (b.y < 84 || b.y > 134) b.a = -b.a; b.x = clamp(b.x, 42, 760); b.y = clamp(b.y, 84, 134);
    const sc = Math.max(0.05, b.s * (b.hitT > 0 ? 0.4 : 1));
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, sc); b.g.style.opacity = b.s > 0.04 ? (b.hitT > 0 ? 0.4 : 1) : 0;
    b.vis = b.s * (b.hitT > 0 ? 0.4 : 1);
  });
  hunters(dt, sm.abx > 0.5);
  /* toxin travels from the lumen into the focus wall cell */
  acc.tox += dt * sm.V * 4; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) emit(p, rnd(70, 260), rnd(86, 130), 0, 0, 0); }
  tox.forEach((p) => { if (!p.on) return; const dx = 372 - p.x, dy = 206 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 46 * dt; p.y += (dy / d) * 46 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 12) kill(p); });
  /* cAMP dots glow inside the wall cells */
  acc.camp += dt * sm.Camp * 8; while (acc.camp >= 1) { acc.camp--; const p = free(camp); if (p) emit(p, pick(cellXs) + rnd(-13, 13), 196 + rnd(-11, 11), 0, 0, 0); }
  camp.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* salt leaves through CFTR into the lumen, then joins the stool stream */
  acc.cl += dt * sm.Sec * 10; while (acc.cl >= 1) { acc.cl--; const p = free(clp); if (p) emit(p, pick(cftrXs) + rnd(-4, 4), 160, rnd(6, 16), -rnd(18, 30), 0); }
  clp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 108) { p.vy = 0; p.vx = 55; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 812) kill(p); });
  /* sugar with salt crosses through SGLT down into blood */
  acc.pair += dt * sm.Abs * 9; while (acc.pair >= 1) { acc.pair--; const p = free(pair); if (p) emit(p, pick(sgltXs) + rnd(-5, 5), 150, 0, rnd(30, 44), 0); }
  pair.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 240) kill(p); });
  /* water: secreted upward when Sec, absorbed downward when Abs */
  acc.drop += dt * (sm.Sec + sm.Abs) * 7; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) { const up = Math.random() < sm.Sec / Math.max(0.01, sm.Sec + sm.Abs); emit(p, rnd(120, 680), 190, 0, up ? -rnd(20, 32) : rnd(20, 32), up ? 1 : 0); } }
  drops.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 80 || p.y > 242) kill(p); });
  /* rice-water stool: right along the lumen, down the pipe, into the beaker */
  acc.stool += dt * sm.Loss * 11; while (acc.stool >= 1) { acc.stool--; const p = free(stoolP); if (p) emit(p, rnd(55, 280), rnd(86, 132), rnd(55, 80), 0, 0); }
  stoolP.forEach((p) => { if (!p.on) return; if (p.x < 812) { p.x += p.vx * dt; } else { p.x = 813; p.y += 85 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 384) kill(p); });
  const sh = 6 + sm.Loss * 26; layers.stool.setAttribute("y", f1(388 - sh)); layers.stool.setAttribute("height", f1(sh));
  /* red cells run down the vessel, slower as dehydration deepens */
  rbcs.forEach((r) => { r.y += r.v * 62 * clamp(1.05 - 0.65 * sm.D) * dt; if (r.y > 408) { r.y = 248; r.x = rnd(440, 500); } place(r.g, r.x, r.y, Math.sin(tm / 500 + r.y) * 8, 1); });
  /* ORS enters the lumen and feeds the co-transporter */
  acc.ors += dt * sm.ors * 8; while (acc.ors >= 1) { acc.ors--; const p = free(orsP); if (p) emit(p, 40, rnd(88, 132), rnd(45, 65), 0, 0); }
  orsP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; if (p.x > 180) p.y += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 240 || p.x > 700) kill(p); });
  /* drip fluid runs into the top of the vessel */
  acc.iv += dt * sm.iv * 8; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, vTop[0] + rnd(-8, 8), vTop[1] - 6, 0, 95, 0); }
  ivP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > vBot[1]) kill(p); });
  /* treatment marks follow the drug */
  ivMark.style.display = m.drug === 3 ? "" : "none";
  abxMark.style.display = m.drug === 2 ? "" : "none";
  /* gauges */
  gg.col.set(sm.V, wordOf(sm.V, 0.3, 0.6, ["low", "present", "high"])); gg.camp.set(sm.Camp, wordOf(sm.Camp, 0.3, 0.6, ["low", "raised", "high"])); gg.sec.set(sm.Sec, wordOf(sm.Sec, 0.4, 0.7, ["low", "raised", "high"]));
  gg.loss.set(sm.Loss, wordOf(sm.Loss, 0.4, 0.7, ["mild", "moderate", "heavy"])); gg.deh.set(sm.D, wordOf(sm.D, 0.38, 0.65, ["none", "some", "severe"]));
  const li = m.a < 0.5 ? 0 : m.a < 0.8 ? 1 : 2;
  if (li !== capL || m.drug !== capD) { capL = li; capD = m.drug; const t = capText(li, m.drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
