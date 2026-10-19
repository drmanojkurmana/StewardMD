/* Diarrhoea scene: secretory, osmotic and invasive types on one gut wall.
 * Bowel and vessel come from organs.lib.js; flows anchor to their ports.
 * Each treatment visibly acts on the drawing: ORS opens wide absorption
 * streams into the vessel, IV fluid arrives by bag and tube and widens the
 * vessel, antibiotic dots hunt germs and shrink them while toxin signalling
 * fades. A caption in the stage follows the state. */
const WW = SC.W;
const layers = { bowelS: $("bowelSlot"), vesselS: $("vesselSlot"), glow: $("glowG"), cells: $("cells"), parts: $("parts"), rbcs: $("rbcs"), over: $("over"), panel: $("panel"), stool: $("stool"), bag: $("bagG"), ulc: $("bowelUlc"), halo: $("dehyHalo") };
const orsFlowEls = [$("orsFlowA"), $("orsFlowB"), $("orsFlowC")];
/* ---- real anatomy; flows and labels anchor to its ports ---- */
let bowelO = null, vesselO = null, coils = [164, 339], vTop = [470, 242], vBot = [470, 408];
function initOrgans() {
  bowelO = organ(layers.bowelS, "bowel", 160, 330, 150, {});
  vesselO = organ(layers.vesselS, "vessel", 470, 325, 90, { h: 170 });
  coils = bowelO.ports.coils;
  vTop = vesselO.ports.in; vBot = vesselO.ports.out;
  layers.ulc.setAttribute("cx", f1(coils[0])); layers.ulc.setAttribute("cy", f1(coils[1]));
}
function capText(l, d) {
  const T = l === 0 ? "Secretory diarrhoea. Toxin holds salt channels open."
    : l === 1 ? "Osmotic diarrhoea. Unabsorbed solute holds water in the gut."
    : "Invasive diarrhoea. Germs damage the wall and absorption fails.";
  let D = " No treatment, so fluid loss continues.";
  if (d === 1) D = " ORS uses the SGLT route to pull salt and water back into blood.";
  else if (d === 2) D = " A drip refills the blood directly, bypassing the gut.";
  else if (d === 3) D = l === 1 ? " Antibiotic cannot help an osmotic loss."
    : " Antibiotic kills the bacteria, so toxin and invasion fall.";
  else if (d === 4) D = l === 1 ? " ORS replaces fluid. Only the ORS part helps here."
    : " ORS and antibiotic together. Best effect.";
  return T + D;
}
/* ---- wall cells with brush border, SGLT and CFTR gates ---- */
const cellXs = [];
for (let i = 0; i < 9; i++) cellXs.push(110 + i * 70);
const cells = cellXs.map((x, i) => {
  const g = mk("g", {}, layers.cells);
  cell(g, { cls: "ent", r: 24, nuc: 0.4, seed: i * 1.7 + 1, wob: 0.08 });
  for (let j = -2; j <= 2; j++) mk("path", { class: "dia-villi", d: "M" + (j * 8) + " -24l0 -7" }, g);
  place(g, x, 196, 0, 1);
  return { g, x };
});
const sgltXs = [180, 320, 460, 600, 680], cftrXs = [250, 390, 530, 660];
sgltXs.forEach((x) => { const g = mk("g", { class: "sglt" }, layers.cells); mk("rect", { class: "dia-sglt", x: x - 9, y: 164, width: 18, height: 8, rx: 3 }, g); });
cftrXs.forEach((x) => { const g = mk("g", { class: "cftr" }, layers.cells); mk("rect", { class: "dia-cftr", x: x - 8, y: 164, width: 16, height: 8, rx: 3 }, g); });
/* ---- invading germs in the lumen ---- */
const invaders = [];
for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-inv" }, layers.cells); mk("ellipse", { class: "cl-b", rx: 7, ry: 3.6 }, g); invaders.push({ g, x: 480 + (i % 4) * 55, y0: 100 + Math.floor(i / 4) * 30, ph: i * 1.3, hitT: 0, s: 1, vis: 0 }); }
/* ---- red cells flowing down inside the vessel ---- */
const rbcs = [];
for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.6 }, g); rbcs.push({ g, x: rnd(440, 500), y: rnd(250, 405), v: rnd(0.8, 1.2) }); }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const tox = pool(12, () => mk("path", { class: "sc-p p-tox", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.parts));
const sol = pool(14, () => mk("circle", { class: "sc-p p-solute", r: 3.4 }, layers.parts));
const camp = pool(16, () => mk("circle", { class: "sc-p p-camp", r: 2.2 }, layers.parts));
const clp = pool(22, () => mk("circle", { class: "sc-p p-cl", r: 2.4 }, layers.parts));
const pair = pool(24, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-na", r: 2.6, cx: -3 }, g); mk("circle", { class: "sc-p p-glu", r: 2.6, cx: 3 }, g); return g; });
const drops = pool(30, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const stoolP = pool(22, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const orsP = pool(14, () => mk("path", { class: "p-fl p-ors", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const ivP = pool(10, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const hunt = pool(10, () => mk("circle", { class: "sc-p p-abx", r: 3.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- antibiotic dots home onto visible germs and sit on them ---- */
function hunters(dt, active) {
  const targets = invaders.filter((t) => t.vis > 0.15);
  hunt.forEach((h, i) => {
    if (!active || !targets.length) { if (h.on) kill(h); return; }
    const T = targets[i % targets.length];
    if (!h.on) emit(h, T.x + rnd(-90, 90), 130 + rnd(-40, 40), 0, 0, 0);
    const Ty = lerp(T.y0, 190, sm.Inv * 0.8);
    const dx = T.x - h.x, dy = Ty - h.y, d = Math.hypot(dx, dy) || 1;
    const st = Math.min(d, 150 * dt);
    h.x += dx / d * st; h.y += dy / d * st;
    place(h.e, h.x, h.y, 0, 1);
    if (d < 14) T.hitT = 1;
  });
}
/* ---- labels, treatment marks, caption and gauges ---- */
const gg = {};
let causePills = [], orsMark = null, ivMark = null, abxMark0 = null, abxMark2 = null, capEl = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [80, 250, 420, 590, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sec", "Secretion", "g-sec", "Fluid secreted into the lumen. In secretory diarrhoea cAMP opens salt channels and water follows the salt out."], ["abs", "Absorption", "g-abs", "Salt and water taken up into blood. The SGLT route keeps working even when secretion is switched on."], ["loss", "Stool loss", "g-loss", "Watery stool leaving the gut. ORS replaces this loss; it does not stop it at once."], ["deh", "Dehydration", "g-deh", "Blood and body fluid lost. The vessel narrows and flow slows as dehydration deepens."], ["int", "Wall injury", "g-int", "How intact the gut wall is. Invasion damages it and absorption falls; antibiotic lets it recover."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  causePills = [
    pill(ox, "Toxin raises cAMP", 150, 105, 150, 58, "Toxin in the lumen enters the wall and keeps the cAMP signal high, so salt channels stay open."),
    pill(ox, "Solute holds water", 400, 105, 400, 58, "Solute that cannot be absorbed holds water in the lumen by osmosis, so water cannot follow salt into blood."),
    pill(ox, "Germs invade wall", 600, 120, 620, 58, "Invading germs inflame and damage the wall. A damaged wall absorbs poorly and may leak blood and mucus."),
  ];
  pill(ox, "SGLT route", 680, 168, 775, 58, "SGLT on the surface carries salt with sugar into blood, and water follows. cAMP does not switch it off, which is why ORS works.");
  pill(ox, "Small bowel", coils[0], coils[1], 160, 400, "Small bowel, magnified in the strip above. Most salt and water uptake happens across this wall.");
  pill(ox, "Blood", 470, 330, 470, 400, "Blood in the wall. Uptake refills it; loss without uptake lets it run dry, so flow slows.");
  pill(ox, "Stool loss", 824, 355, 824, 400, "Watery stool leaving the body. Bloody when invasion is severe.");
  orsMark = pill(ox, "ORS absorbed", 470, 244, 640, 252, "ORS: sugar with salt is taken up through SGLT in bulk, and water follows into blood.");
  ivMark = pill(ox, "Drip refills blood", 375, 297, 310, 250, "Intravenous fluid runs straight into blood and refills it without using the gut.");
  abxMark0 = pill(ox, "Bacteria killed", 180, 120, 340, 148, "Antibiotic kills the toxin making bacteria, so the cAMP signal fades and channels close.");
  abxMark2 = pill(ox, "Germs killed", 600, 130, 700, 300, "Antibiotic dots sit on invading germs and shrink them, so the wall can recover.");
  capEl = mk("text", { class: "di-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { Camp: 0.9, Sol: 0.1, Inv: 0.05, Sec: 0.8, Abs: 0.5, Int: 0.9, L: 0.7, D: 0.6, ors: 0, iv: 0, abx: 0 };
const acc = { tox: 0, sol: 0, camp: 0, cl: 0, pair: 0, drop: 0, stool: 0, ors: 0, iv: 0 };
let capL = -1, capD = -1;
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["Camp", "Sol", "Inv", "Sec", "Abs", "Int", "L", "D", "ors", "iv", "abx"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  /* vessel narrows as dehydration deepens, reopens with fluids */
  const vsx = 1 - 0.25 * sm.D;
  vesselO.g.setAttribute("transform", "translate(" + f1(vesselO.x) + " " + f1(vesselO.y) + ") scale(" + vsx.toFixed(3) + " 1)");
  layers.halo.setAttribute("opacity", (sm.D * 0.35).toFixed(2));
  /* wall injury ulcer on the bowel shrinks as the wall recovers */
  const ulc = 1 - sm.Int;
  layers.ulc.setAttribute("rx", f1(26 * (0.3 + 0.7 * ulc))); layers.ulc.setAttribute("ry", f1(34 * (0.3 + 0.7 * ulc)));
  layers.ulc.setAttribute("opacity", (ulc * 0.85).toFixed(2));
  /* ORS absorption streams pour into the vessel */
  orsFlowEls.forEach((e) => e.setAttribute("opacity", (sm.ors * 0.8).toFixed(2)));
  /* IV bag and tube appear with the drip */
  layers.bag.setAttribute("opacity", sm.iv.toFixed(2));
  layers.bag.style.display = sm.iv > 0.03 ? "" : "none";
  /* wall cells shrink with injury; gates follow secretion and uptake */
  cells.forEach((c, i) => { place(c.g, c.x, 196 + Math.sin(tm / 900 + i) * 1.2, 0, 0.72 + 0.28 * sm.Int); c.g.style.opacity = (0.35 + 0.65 * sm.Int).toFixed(2); });
  layers.cells.querySelectorAll(".sglt").forEach((g) => { g.style.opacity = (0.35 + 0.65 * sm.Abs).toFixed(2); });
  layers.cells.querySelectorAll(".cftr").forEach((g) => { g.style.opacity = (0.3 + 0.7 * sm.Sec).toFixed(2); });
  /* germs dive at the wall and shrink while a drug dot sits on them */
  invaders.forEach((b, i) => {
    b.hitT = Math.max(0, b.hitT - dt * 0.22);
    const want = (0.3 + 0.7 * sm.Inv) * (b.hitT > 0 ? 0.35 : 1);
    b.s = lerp(b.s === undefined ? 1 : b.s, want, Math.min(1, dt * 2));
    const y = lerp(b.y0, 190, sm.Inv * 0.8);
    place(b.g, b.x + Math.sin(tm / 600 + b.ph) * 8, y, Math.sin(tm / 500 + b.ph) * 20, Math.max(0.05, b.s));
    b.vis = (0.2 + 0.8 * sm.Inv) * (b.hitT > 0 ? 0.4 : 1);
    b.g.style.opacity = sm.Inv > 0.12 ? b.vis.toFixed(2) : "0";
  });
  hunters(dt, sm.abx > 0.5);
  /* toxin drifts to the wall */
  acc.tox += dt * sm.Camp * 5; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) emit(p, rnd(50, 140), rnd(86, 130), rnd(24, 40), rnd(-4, 8), 0); }
  tox.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 280) kill(p); });
  /* unabsorbed solute sits in the lumen holding water */
  acc.sol += dt * (0.4 + sm.Sol * 4); while (acc.sol >= 1) { acc.sol--; const p = free(sol); if (p) emit(p, rnd(280, 700), rnd(86, 130), rnd(-5, 5), rnd(-3, 3), 0); }
  sol.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.2; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (sm.Sol * clamp(1 - (p.t - 3) / 1.5)).toFixed(2)); if (p.t > 4.5) kill(p); });
  /* cAMP dots glow inside the cells */
  acc.camp += dt * sm.Camp * 9; while (acc.camp >= 1) { acc.camp--; const p = free(camp); if (p) emit(p, pick(cellXs) + rnd(-12, 12), 196 + rnd(-10, 10), 0, 0, 0); }
  camp.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* salt leaves through CFTR into the lumen, then joins the stool stream */
  acc.cl += dt * sm.Sec * 11; while (acc.cl >= 1) { acc.cl--; const p = free(clp); if (p) emit(p, pick(cftrXs) + rnd(-4, 4), 160, rnd(6, 16), -rnd(18, 30), 0); }
  clp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 108) { p.vy = 0; p.vx = 55; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 812) kill(p); });
  /* sugar with salt crosses through SGLT down into blood */
  acc.pair += dt * sm.Abs * 9; while (acc.pair >= 1) { acc.pair--; const p = free(pair); if (p) emit(p, pick(sgltXs) + rnd(-5, 5), 150, 0, rnd(30, 44), 0); }
  pair.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 240) kill(p); });
  /* water: secreted upward when Sec, absorbed downward when Abs */
  acc.drop += dt * (sm.Sec + sm.Abs) * 7; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) { const up = Math.random() < sm.Sec / Math.max(0.01, sm.Sec + sm.Abs); emit(p, rnd(120, 680), 190, 0, up ? -rnd(20, 32) : rnd(20, 32), up ? 1 : 0); } }
  drops.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 80 || p.y > 242) kill(p); });
  /* stool stream: right along the lumen, down the pipe, into the beaker */
  acc.stool += dt * sm.L * 12; while (acc.stool >= 1) { acc.stool--; const p = free(stoolP); if (p) emit(p, rnd(60, 300), rnd(96, 136), rnd(55, 80), 0, 0); }
  stoolP.forEach((p) => { if (!p.on) return; if (p.x < 812) { p.x += p.vx * dt; } else { p.x = 813; p.y += 85 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 384) kill(p); });
  const sh = 6 + sm.L * 26; layers.stool.setAttribute("y", f1(388 - sh)); layers.stool.setAttribute("height", f1(sh));
  layers.stool.setAttribute("class", m.ty === 2 && sm.Inv > 0.4 ? "dia-stoolb" : "dia-stool");
  /* red cells run down the vessel, slower as dehydration deepens */
  rbcs.forEach((r) => { r.y += r.v * 62 * clamp(1.05 - 0.65 * sm.D) * dt; if (r.y > 408) { r.y = 248; r.x = rnd(440, 500); } place(r.g, r.x, r.y, Math.sin(tm / 500 + r.y) * 8, 1); });
  /* ORS enters the lumen and feeds the co-transporter */
  acc.ors += dt * sm.ors * 8; while (acc.ors >= 1) { acc.ors--; const p = free(orsP); if (p) emit(p, 40, rnd(88, 132), rnd(45, 65), 0, 0); }
  orsP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; if (p.x > 180) p.y += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 240 || p.x > 700) kill(p); });
  /* IV fluid drips into the top of the vessel */
  acc.iv += dt * sm.iv * 8; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, vTop[0] + rnd(-8, 8), vTop[1] - 6, 0, 95, 0); }
  ivP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > vBot[1]) kill(p); });
  /* cause pill follows the type; treatment marks follow the drug */
  causePills.forEach((p, i) => { p.style.display = m.ty === i ? "" : "none"; });
  orsMark.style.display = (m.drug === 1 || m.drug === 4) ? "" : "none";
  ivMark.style.display = m.drug === 2 ? "" : "none";
  abxMark0.style.display = (m.drug === 3 || m.drug === 4) && m.ty === 0 ? "" : "none";
  abxMark2.style.display = (m.drug === 3 || m.drug === 4) && m.ty === 2 ? "" : "none";
  /* gauges */
  gg.sec.set(sm.Sec, wordOf(sm.Sec, 0.3, 0.6, ["low", "raised", "high"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.35, 0.65, ["poor", "partial", "good"])); gg.loss.set(sm.L, wordOf(sm.L, 0.35, 0.65, ["mild", "moderate", "heavy"]));
  gg.deh.set(sm.D, wordOf(sm.D, 0.3, 0.6, ["none", "some", "severe"])); gg.int.set(sm.Int, wordOf(sm.Int, 0.4, 0.7, ["damaged", "worn", "intact"]));
  if (m.ty !== capL || m.drug !== capD) { capL = m.ty; capD = m.drug; const t = capText(m.ty, m.drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
