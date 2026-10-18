/* Diarrhoea scene: toxin and cAMP, osmotic solute, invasion, SGLT absorption, stool loss and gauges. */
const WW = SC.W;
const layers = { cells: $("cells"), parts: $("parts"), rbcs: $("rbcs"), over: $("over"), panel: $("panel"), stool: $("stool") };
/* ---- enterocytes with brush border, SGLT and CFTR transporters, zinc badges ---- */
const cellXs = [];
for (let i = 0; i < 11; i++) cellXs.push(90 + i * 60);
const cells = cellXs.map((x, i) => {
  const g = mk("g", {}, layers.cells), c = cell(g, { cls: "ent", r: 25, nuc: 0.4, seed: i * 1.7 + 1, wob: 0.08 });
  for (let j = -2; j <= 2; j++) mk("path", { class: "dia-villi", d: "M" + (j * 8) + " -24l0 -7" }, g);
  return { g, x };
});
const sgltXs = [170, 290, 410, 530, 650], cftrXs = [230, 350, 470, 590];
sgltXs.forEach((x) => { const g = mk("g", { class: "sglt" }, layers.cells); mk("rect", { class: "dia-sglt", x: x - 9, y: 176, width: 18, height: 8, rx: 3 }, g); });
cftrXs.forEach((x) => { const g = mk("g", { class: "cftr" }, layers.cells); mk("rect", { class: "dia-cftr", x: x - 8, y: 176, width: 16, height: 8, rx: 3 }, g); });
[200, 380, 560].forEach((x) => { const g = mk("g", {}, layers.cells); mk("circle", { class: "dia-zinc", cx: x, cy: 242, r: 6 }, g); const t = mk("text", { class: "sc-lab", x: x, y: 245, "text-anchor": "middle" }, g); t.textContent = "Zn"; });
/* ---- invading bacteria in the lumen ---- */
const invaders = [];
for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-inv" }, layers.cells); mk("ellipse", { class: "cl-b", rx: 7, ry: 3.6 }, g); invaders.push({ g, x: 480 + (i % 4) * 52, y: 104 + Math.floor(i / 4) * 34, ph: i * 1.3 }); }
/* ---- red cells in the capillary ---- */
const rbcs = [];
for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(40, 700), y: rnd(-14, 14), v: rnd(0.8, 1.2) }); }
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
const ivP = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const abxP = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-abx", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {}, typePills = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [80, 250, 420, 590, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["sec", "Secretion", "g-sec", "Fluid secreted into the lumen. In secretory diarrhoea cyclic AMP opens chloride channels and sodium and water follow chloride out."], ["abs", "Absorption", "g-abs", "Sodium and water absorbed into the blood. The sodium glucose co-transporter keeps working even when secretion is switched on."], ["loss", "Stool loss", "g-loss", "Watery stool leaving the gut. ORS replaces this loss; it does not stop it at once."], ["deh", "Dehydration", "g-deh", "Body fluid lost. Signs progress from thirst and dry mouth to sunken eyes, poor skin pinch and low blood pressure."], ["int", "Epithelium", "g-int", "How intact the gut lining is. Invasion and inflammation damage it and absorption falls. Zinc supports its recovery."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  typePills.tox = pill(ox, "Cholera toxin", 150, 120, 150, 92, "Cholera toxin: locks a stimulatory G protein on so cyclic AMP stays high in the enterocyte. Shown in secretory diarrhoea.");
  typePills.sol = pill(ox, "Unabsorbed solute", 380, 120, 380, 92, "Solute that cannot be absorbed holds water in the lumen by osmosis. Shown in osmotic diarrhoea.");
  typePills.inv = pill(ox, "Invading bacteria", 610, 120, 610, 92, "Organisms invade and inflame the epithelium. Shown in invasive diarrhoea.");
  const ors = pill(ox, "ORS drink", 60, 95, 92, 140, "Oral rehydration solution: glucose and sodium taken up together through the sodium glucose co-transporter, and water follows."); ors.setAttribute("id", "ors-pill");
  pill(ox, "cAMP signal", 225, 210, 225, 140, "Cyclic AMP inside the enterocyte: raised by cholera toxin, it opens chloride channels and reduces sodium chloride absorption.");
  pill(ox, "CFTR channel", 350, 176, 350, 140, "CFTR chloride channel on the luminal surface: opened by cyclic AMP, it lets chloride leave the cell into the lumen.");
  pill(ox, "Sodium glucose co-transporter", 565, 176, 565, 140, "SGLT on the brush border: carries sodium and glucose together into the cell, water follows. It is not switched off by cyclic AMP, which is why ORS works.");
  pill(ox, "Dehydration", 140, 350, 140, 282, "Loss of body fluid in the stool: thirst, dry mouth, sunken eyes and reduced urine, progressing to low blood pressure.");
  pill(ox, "Capillary", 400, 350, 400, 282, "Blood vessel in the gut wall: absorbed sodium and water enter it. Intravenous fluids refill it directly.");
  pill(ox, "Zinc", 640, 242, 640, 282, "Zinc: an adjunct that supports epithelial repair and shortens diarrhoea, especially in children. It is not a fluid replacement.");
  pill(ox, "Stool fluid loss", 823, 360, 815, 420, "Watery stool: the route by which fluid, sodium and potassium leave the body.");
  const iv = pill(ox, "IV fluid", 60, 350, 95, 415, "Intravenous fluids: refill the circulation directly, bypassing the gut, when dehydration is severe or drinking is not possible."); iv.setAttribute("id", "iv-pill");
  const ab = pill(ox, "Antibiotic", 120, 300, 210, 415, "An antibiotic helps only with a bacterial cause, for example cholera or invasive bacterial diarrhoea. It does not replace lost fluid."); ab.setAttribute("id", "abx-pill");
}
const sm = { Camp: 0.9, Sol: 0.1, Inv: 0.05, Sec: 0.8, Abs: 0.5, Int: 0.9, L: 0.7, D: 0.6, ors: 0, iv: 0, abx: 0 };
const acc = { tox: 0, sol: 0, camp: 0, cl: 0, pair: 0, drop: 0, stool: 0, ors: 0, iv: 0, abx: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["Camp", "Sol", "Inv", "Sec", "Abs", "Int", "L", "D", "ors", "iv", "abx"].forEach((key) => { sm[key] = lerp(sm[key], m[key.charAt(0) === "o" || key === "iv" || key === "abx" ? key : key], k); });
  sm.ors = lerp(sm.ors, m.ors, k); sm.iv = lerp(sm.iv, m.iv, k); sm.abx = lerp(sm.abx, m.abx, k);
  /* cells: damaged epithelium shrinks and fades */
  cells.forEach((c, i) => { place(c.g, c.x, 210 + Math.sin(tm / 900 + i) * 1.2, 0, 0.72 + 0.28 * sm.Int); c.g.style.opacity = (0.35 + 0.65 * sm.Int).toFixed(2); });
  layers.cells.querySelectorAll(".sglt").forEach((g) => { g.style.opacity = (0.35 + 0.65 * sm.Abs).toFixed(2); });
  layers.cells.querySelectorAll(".cftr").forEach((g) => { g.style.opacity = (0.3 + 0.7 * sm.Sec).toFixed(2); });
  invaders.forEach((b, i) => { const y = lerp(104 + Math.floor(i / 4) * 34, 196, sm.Inv * 0.75); place(b.g, b.x + Math.sin(tm / 600 + b.ph) * 8, y, Math.sin(tm / 500 + b.ph) * 20, 0.3 + 0.7 * sm.Inv); b.g.style.opacity = sm.Inv > 0.12 ? 1 : 0; });
  /* toxin drifts to the enterocytes */
  acc.tox += dt * sm.Camp * 5; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) emit(p, rnd(50, 140), rnd(88, 150), rnd(24, 40), rnd(-4, 8), 0); }
  tox.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 240) kill(p); });
  /* unabsorbed solute sits in the lumen holding water */
  acc.sol += dt * (0.4 + sm.Sol * 4); while (acc.sol >= 1) { acc.sol--; const p = free(sol); if (p) emit(p, rnd(280, 700), rnd(86, 156), rnd(-5, 5), rnd(-3, 3), 0); }
  sol.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.2; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (sm.Sol * clamp(1 - (p.t - 3) / 1.5)).toFixed(2)); if (p.t > 4.5) kill(p); });
  /* cAMP dots glow inside the cells */
  acc.camp += dt * sm.Camp * 9; while (acc.camp >= 1) { acc.camp--; const p = free(camp); if (p) emit(p, pick(cellXs) + rnd(-12, 12), 210 + rnd(-10, 10), 0, 0, 0); }
  camp.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* chloride leaves through CFTR into the lumen, then joins the stool stream */
  acc.cl += dt * sm.Sec * 11; while (acc.cl >= 1) { acc.cl--; const p = free(clp); if (p) emit(p, pick(cftrXs) + rnd(-4, 4), 172, rnd(6, 16), -rnd(18, 30), 0); }
  clp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < 96) { p.vy = 0; p.vx = 55; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 800) kill(p); });
  /* sodium glucose pairs cross through SGLT into the blood */
  acc.pair += dt * sm.Abs * 9; while (acc.pair >= 1) { acc.pair--; const p = free(pair); if (p) emit(p, pick(sgltXs) + rnd(-5, 5), 150, 0, rnd(30, 44), 0); }
  pair.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 330) kill(p); });
  /* water: secreted upward when Sec, absorbed downward when Abs */
  acc.drop += dt * (sm.Sec + sm.Abs) * 7; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) { const up = Math.random() < sm.Sec / Math.max(0.01, sm.Sec + sm.Abs); emit(p, rnd(120, 680), 190, 0, up ? -rnd(20, 32) : rnd(20, 32), up ? 1 : 0); } }
  drops.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 92 || p.y > 330) kill(p); });
  /* stool stream: right along the lumen, down the pipe, into the beaker */
  acc.stool += dt * sm.L * 12; while (acc.stool >= 1) { acc.stool--; const p = free(stoolP); if (p) emit(p, rnd(60, 300), rnd(96, 150), rnd(55, 80), 0, 0); }
  stoolP.forEach((p) => { if (!p.on) return; if (p.x < 812) { p.x += p.vx * dt; } else { p.x = 813; p.y += 85 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 382) kill(p); });
  const sh = 6 + sm.L * 26; layers.stool.setAttribute("y", f1(388 - sh)); layers.stool.setAttribute("height", f1(sh));
  /* red cells slow as dehydration deepens */
  rbcs.forEach((r) => { r.x += r.v * 62 * clamp(1.05 - 0.65 * sm.D) * dt; if (r.x > 712) { r.x = 44; r.y = rnd(-14, 14); } place(r.g, r.x, 350 + r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  /* ORS enters the lumen and feeds the co-transporter */
  acc.ors += dt * sm.ors * 8; while (acc.ors >= 1) { acc.ors--; const p = free(orsP); if (p) emit(p, 44, rnd(92, 140), rnd(45, 65), 0, 0); }
  orsP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; if (p.x > 180) p.y += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 320 || p.x > 720) kill(p); });
  /* IV fluid refills the capillary directly */
  acc.iv += dt * sm.iv * 8; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, 44, 350 + rnd(-16, 16), 95, 0, 0); }
  ivP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 712) kill(p); });
  /* antibiotic capsules head for the lumen organisms */
  acc.abx += dt * sm.abx * 3; while (acc.abx >= 1) { acc.abx--; const p = free(abxP); if (p) emit(p, 70, 300, 0, 0, 0); }
  abxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (420 - p.x) * dt * 0.5 + 22 * dt; p.y += (130 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* treatment and type pills fade with the model */
  $("ors-pill").style.opacity = sm.ors.toFixed(2); $("iv-pill").style.opacity = sm.iv.toFixed(2); $("abx-pill").style.opacity = sm.abx.toFixed(2);
  typePills.tox.style.opacity = clamp(0.15 + 0.85 * sm.Camp).toFixed(2); typePills.sol.style.opacity = clamp(0.15 + 0.85 * sm.Sol).toFixed(2); typePills.inv.style.opacity = clamp(0.15 + 0.85 * sm.Inv).toFixed(2);
  /* gauges */
  gg.sec.set(sm.Sec, wordOf(sm.Sec, 0.3, 0.6, ["low", "raised", "high"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.35, 0.65, ["poor", "partial", "good"])); gg.loss.set(sm.L, wordOf(sm.L, 0.35, 0.65, ["mild", "moderate", "heavy"]));
  gg.deh.set(sm.D, wordOf(sm.D, 0.3, 0.6, ["none", "some", "severe"])); gg.int.set(sm.Int, wordOf(sm.Int, 0.4, 0.7, ["damaged", "worn", "intact"]));
}
run({ init, step });
