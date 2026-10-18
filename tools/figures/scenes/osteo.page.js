/* Osteoporosis scene: ovary oestrogen, gut calcium, bone remodelling with RANKL and OPG, knee joint fragility. */
const layers = { trab: $("trab"), coat: $("coat"), pits: $("pits"), cells: $("cells"), signal: $("signal"), fracture: $("fracture"), parts: $("parts"), over: $("over"), panel: $("panel"), bone: $("bone"), glow: $("glow") };
const gg = {};
let ovaryO = null, bowelO = null, jointO = null, crackEl = null, fxGlow = null, okGlow = null, opgCell = null, capEl = null, capDrug = -1, capLevel = -1;
let ovPort = [132, 158], bonePort = [262, 128], caFrom = [196, 340], caTo = [248, 306], jointPt = [798, 260];
let trOes = null, trCa = null;
const trabStruts = [];
const oclasts = [], oblasts = [];
const coatDots = [], bisBlock = [], anaBind = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null }; }); }
const ranklP = pool(16, () => mk("path", { class: "sc-p p-rankl", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const opgP = pool(10, () => mk("circle", { class: "sc-p p-opg", r: 3 }, layers.parts));
const chips = pool(12, () => mk("rect", { class: "sc-p p-chip", x: -2.4, y: -1.6, width: 4.8, height: 3.2, rx: 1 }, layers.parts));
const matrix = pool(14, () => mk("circle", { class: "sc-p p-matrix", r: 2.4 }, layers.parts));
const bisP = pool(10, () => mk("circle", { class: "sc-p p-bis", r: 3 }, layers.parts));
const caP = pool(14, () => mk("circle", { class: "sc-p p-matrix", r: 2.6 }, layers.parts));
const oesP = pool(10, () => mk("circle", { class: "sc-p p-oes", r: 2.4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 1) return "Bisphosphonate coats the bone and quiets osteoclasts. Loss slows.";
  if (d === 2) return "Calcium and vitamin D add mineral through the gut. New bone hardens a little.";
  if (d === 3) return l === 0 ? "Anabolic agent keeps builders ahead. New bone grows and the joint steadies." : "Anabolic agent wakes osteoblasts. New bone grows and the joint steadies.";
  if (l === 0) return "No treatment. Building and removal are balanced, so the lattice holds.";
  if (l === 1) return "No treatment. Removal is outrunning rebuilding, so struts are thinning.";
  return "No treatment. Removal outruns rebuilding, so struts thin and the joint can crack.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The skeleton";
  [["res", "Resorption", "g-res", "Bone removed by osteoclasts. When this runs ahead of formation, bone is lost."], ["form", "Formation", "g-form", "New bone laid down by osteoblasts to replace what was resorbed."], ["rankl", "RANKL", "g-rankl", "RANKL from bone forming cells binds RANK on osteoclast precursors and drives osteoclast formation."], ["opg", "OPG", "g-opg", "Osteoprotegerin: a decoy receptor that mops up RANKL and restrains osteoclast formation."], ["dens", "Density", "g-dens", "Overall bone density. Thin, broken struts lower it."], ["fx", "Fracture", "g-fx", "Risk that bone breaks with little trauma, for example at the spine, wrist or hip."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Ovary", 105, 92, 105, 66, "Ovary: makes oestrogen. Oestrogen restrains osteoclasts, so loss after the menopause speeds bone loss.");
  pill(ox, "Osteoclast", 300, 88, 300, 66, "Osteoclast: dissolves bone and digs pits. RANKL drives it, and bisphosphonate quiets it.");
  pill(ox, "Osteoblast", 490, 95, 490, 66, "Osteoblast: lays down new bone matrix. Anabolic treatment wakes it up.");
  pill(ox, "RANKL", 395, 140, 390, 100, "RANKL: the signal from bone forming cells that grows new osteoclasts.");
  pill(ox, "OPG", 505, 215, 555, 100, "OPG: a decoy that soaks up RANKL before it can reach osteoclasts.");
  pill(ox, "Knee", 790, 155, 795, 66, "Knee joint: thin bone cracks with little trauma. The crack closes as bone rebuilds.");
  pill(ox, "Gut", 125, 378, 125, 412, "Gut: calcium from food is absorbed here and travels to bone. Vitamin D helps the uptake.");
  pill(ox, "Bone", 430, 290, 430, 412, "Bone: a lattice of struts. When removal wins, struts thin and some snap.");
  capEl = mk("text", { class: "dr-pt", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 2);
}
function init() {
  ovaryO = organ($("ovSlot"), "ovary", 105, 125, 100, {});
  bowelO = organ($("gutSlot"), "bowel", 125, 305, 150, {});
  jointO = organ($("jointSlot"), "joint", 790, 245, 190, {});
  const OP = ovaryO.ports, GP = bowelO.ports, JP = jointO.ports;
  ovPort = OP.dom || [ovaryO.x, ovaryO.y]; bonePort = [262, 128];
  trOes = track([ovPort, [185, 152], [225, 138], bonePort]);
  $("oesTrack").setAttribute("d", "M" + f1(ovPort[0]) + " " + f1(ovPort[1]) + " C185 150 220 136 262 128");
  caFrom = GP.out || [196, 340]; caTo = [248, 306];
  trCa = track([caFrom, [(caFrom[0] + caTo[0]) / 2, (caFrom[1] + caTo[1]) / 2 + 14], caTo]);
  $("caVessel").setAttribute("d", "M" + f1(caFrom[0]) + " " + f1(caFrom[1]) + " L" + f1(caTo[0]) + " " + f1(caTo[1]));
  jointPt = JP.joint || [798, 260];
  /* trabecular lattice: deterministic struts, each with its own survival threshold */
  const rows = [160, 205, 250, 295, 340], cols = [270, 320, 370, 420, 470, 520, 570];
  const node = (r, c) => [cols[c] + Math.sin(r * 3.1 + c * 1.7) * 7, rows[r] + Math.cos(c * 2.3 + r) * 5];
  let si = 0;
  const addStrut = (a, b) => { const ln = mk("line", { class: "os-trab", x1: f1(a[0]), y1: f1(a[1]), x2: f1(b[0]), y2: f1(b[1]) }, layers.trab); trabStruts.push({ ln, a, b, k: (si % 17) / 17, rebuild: ((si % 17) / 17) > 0.55 }); si++; };
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length - 1; c++) addStrut(node(r, c), node(r, c + 1));
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols.length; c += 1) if ((r + c) % 2 === 0) addStrut(node(r, c), node(r + 1, c));
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols.length - 1; c += 2) addStrut(node(r, c), node(r + 1, c + 1));
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) if ((r * 3 + c) % 3 === 0) mk("circle", { class: "os-ocyte", cx: f1(node(r, c)[0] + 12), cy: f1(node(r, c)[1] + 10), r: 2 }, layers.trab);
  /* bisphosphonate coating settles on fixed strut midpoints */
  for (let i = 0; i < 24; i++) { const s = trabStruts[(i * 5 + 3) % trabStruts.length]; const e = mk("circle", { class: "os-coat", cx: f1((s.a[0] + s.b[0]) / 2), cy: f1((s.a[1] + s.b[1]) / 2), r: 2.6 }, layers.coat); e.setAttribute("opacity", "0"); coatDots.push(e); }
  /* resorption pits and the cells on the top surface */
  [[300, 105], [370, 105]].forEach(([x, y]) => mk("ellipse", { class: "os-pit", cx: x, cy: y, rx: 23, ry: 7 }, layers.pits));
  [[300, 101], [370, 101]].forEach(([x, y], i) => oclasts.push({ g: cell(layers.cells, { cls: "ocl", r: 19, nuc: 0.5, nucCls: "multi", seed: i * 3 + 2, wob: 0.14 }), x, y, i }));
  for (let i = 0; i < 5; i++) oblasts.push({ g: cell(layers.cells, { cls: "obl", r: 8, nuc: 0.4, seed: i + 7, wob: 0.1 }), x: 450 + i * 20, y: 101, i });
  /* blocker dots sit on osteoclasts, binder dots sit on osteoblasts */
  oclasts.forEach((c) => { const e = mk("circle", { class: "os-bis", cx: 0, cy: 0, r: 3.4 }, layers.cells); e.setAttribute("opacity", "0"); bisBlock.push(e); });
  oblasts.forEach((c) => { const e = mk("circle", { class: "os-ana", cx: 0, cy: 0, r: 2.8 }, layers.cells); e.setAttribute("opacity", "0"); anaBind.push(e); });
  /* RANKL signal runs left from the builders to the breakers; OPG sits below and soaks it up */
  const sg = layers.signal;
  mk("path", { class: "os-rankl", d: "M452 140L338 140" }, sg);
  mk("path", { class: "os-rankl", d: "M350 134L336 140L350 146" }, sg);
  opgCell = cell(sg, { cls: "opg", r: 14, nuc: 0.4, seed: 23, wob: 0.1 }); place(opgCell, 505, 215, 0, 1);
  /* fragility: crack plus warning glow across the joint, easing glow when bone rebuilds */
  const fg = layers.fracture;
  fxGlow = mk("ellipse", { class: "os-fxglow", cx: f1(jointPt[0]), cy: f1(jointPt[1]), rx: 42, ry: 34 }, fg); fxGlow.setAttribute("opacity", "0.3");
  okGlow = mk("ellipse", { class: "os-okglow", cx: f1(jointPt[0]), cy: f1(jointPt[1]), rx: 42, ry: 34 }, fg); okGlow.setAttribute("opacity", "0");
  crackEl = mk("path", { class: "os-crack", d: "M" + f1(jointPt[0] - 8) + " " + f1(jointPt[1] - 22) + "L" + f1(jointPt[0] + 6) + " " + f1(jointPt[1] - 10) + "L" + f1(jointPt[0] - 6) + " " + f1(jointPt[1] + 2) + "L" + f1(jointPt[0] + 8) + " " + f1(jointPt[1] + 14) + "L" + f1(jointPt[0] - 2) + " " + f1(jointPt[1] + 26) }, fg);
  initPanel();
}
const sm = { R: 0.6, F: 0.4, rankl: 0.6, opg: 0.4, oes: 0.4, dens: 0.5, fx: 0.5, bis: 0, cal: 0, ana: 0 };
const acc = { rankl: 0, opg: 0, chip: 0, mat: 0, tx: 0, ca: 0, oes: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.R = lerp(sm.R, m.R, k2); sm.F = lerp(sm.F, m.F, k2); sm.rankl = lerp(sm.rankl, m.rankl, k2); sm.opg = lerp(sm.opg, m.opg, k2);
  sm.oes = lerp(sm.oes, m.oes, k2); sm.dens = lerp(sm.dens, m.dens, k2); sm.fx = lerp(sm.fx, m.fx, k2);
  sm.bis = lerp(sm.bis, drug === 1 ? 1 : 0, k); sm.cal = lerp(sm.cal, drug === 2 ? 1 : 0, k); sm.ana = lerp(sm.ana, drug === 3 ? 1 : 0, k);
  /* trabeculae thin and drop out as density falls; the cortical shell thins too */
  layers.bone.setAttribute("stroke-width", f1(1.5 + 5 * sm.dens));
  trabStruts.forEach((s) => { s.ln.setAttribute("stroke-width", f1(0.6 + 5.2 * sm.dens)); s.ln.setAttribute("opacity", clamp((sm.dens - s.k * 0.72) / 0.28).toFixed(2)); s.ln.setAttribute("class", s.rebuild && sm.ana > 0.5 ? "os-trab os-new" : "os-trab"); });
  layers.glow.setAttribute("opacity", (0.32 * sm.ana).toFixed(2));
  layers.pits.setAttribute("opacity", (0.25 + 0.75 * sm.R).toFixed(2));
  /* ovary and bowel are real anatomy: the ovary fades as oestrogen falls, the calcium vessel widens on treatment */
  ovaryO.g.style.opacity = (0.4 + 0.6 * sm.oes).toFixed(2);
  $("caVessel").setAttribute("stroke-width", f1(5 + 7 * sm.cal));
  $("caVessel").setAttribute("opacity", (0.35 + 0.45 * sm.cal).toFixed(2));
  /* cells on the bone surface: blockers shrink breakers, binders grow builders */
  oclasts.forEach((c, i) => { place(c.g, c.x + Math.sin(tm / 700 + c.i * 2) * 2, c.y, 0, (0.55 + 0.55 * sm.R) * (1 - 0.38 * sm.bis) * (1 + 0.05 * Math.sin(tm / 280 + c.i))); bisBlock[i].setAttribute("cx", f1(c.x - 8)); bisBlock[i].setAttribute("cy", f1(c.y - 14)); bisBlock[i].setAttribute("opacity", sm.bis.toFixed(2)); });
  oblasts.forEach((c, i) => { place(c.g, c.x, c.y + Math.sin(tm / 600 + c.i) * 1.2, 0, (0.5 + 0.6 * sm.F) * (1 + 0.5 * sm.ana)); anaBind[i].setAttribute("cx", f1(c.x)); anaBind[i].setAttribute("cy", f1(c.y - 10)); anaBind[i].setAttribute("opacity", sm.ana.toFixed(2)); });
  coatDots.forEach((e) => e.setAttribute("opacity", sm.bis.toFixed(2)));
  place(opgCell, 505, 215 + Math.sin(tm / 900) * 2, 0, 0.4 + 0.75 * sm.opg);
  /* oestrogen drifts from the ovary to the bone and fades with the level */
  acc.oes += dt * (1 + 7 * sm.oes); while (acc.oes >= 1) { acc.oes--; const p = free(oesP); if (p) { emit(p, ovPort[0], ovPort[1], 0, 0, 0); p.tr = trOes; p.u = 0; } }
  oesP.forEach((p) => { if (!p.on) return; p.u += dt * 90 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.25 + 0.75 * sm.oes).toFixed(2)); if (p.u >= 1) kill(p); });
  /* calcium flows from the gut to the bone, faster on calcium and vitamin D */
  acc.ca += dt * (1.2 + 6 * (0.25 + 0.75 * sm.cal)); while (acc.ca >= 1) { acc.ca--; const p = free(caP); if (p) { emit(p, caFrom[0], caFrom[1], 0, 0, 0); p.tr = trCa; p.u = 0; } }
  caP.forEach((p) => { if (!p.on) return; p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p); });
  /* RANKL tokens run to the breakers; OPG tokens rise and soak them up on the way */
  acc.rankl += dt * sm.rankl * 7; while (acc.rankl >= 1) { acc.rankl--; const p = free(ranklP); if (p) emit(p, 452, 140 + rnd(-5, 5), -55, 0, 0); }
  ranklP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 300 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x < 410 && p.x > 380 && Math.random() < sm.opg * 0.035) kill(p); if (p.x < 340) kill(p); });
  acc.opg += dt * sm.opg * 5; while (acc.opg >= 1) { acc.opg--; const p = free(opgP); if (p) emit(p, 505 + rnd(-6, 6), 208, rnd(-22, -10), rnd(-30, -18), 0); }
  opgP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 440) { p.x += (395 - p.x) * dt * 2; p.y += (140 - p.y) * dt * 2; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4 || (Math.abs(p.x - 395) < 9 && Math.abs(p.y - 140) < 9)) kill(p); });
  /* bone chips from osteoclasts, new matrix from osteoblasts */
  acc.chip += dt * sm.R * 6 * (1 - 0.75 * sm.bis); while (acc.chip >= 1) { acc.chip--; const p = free(chips); if (p) emit(p, pick(oclasts).x + rnd(-12, 12), 158, rnd(-8, 8), rnd(16, 30), 0); }
  chips.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 120) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.mat += dt * sm.F * 6 * (1 + 1.2 * sm.ana); while (acc.mat >= 1) { acc.mat--; const p = free(matrix); if (p) emit(p, pick(oblasts).x + rnd(-6, 6), 156, rnd(-6, 6), rnd(12, 22), 0); }
  matrix.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* bisphosphonate rains onto the bone and sticks */
  acc.tx += dt * sm.bis * 6; while (acc.tx >= 1) { acc.tx--; const p = free(bisP); if (p) emit(p, rnd(280, 560), 92, rnd(-6, 6), rnd(40, 70), 0); }
  bisP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 165 || p.t > 2.4) kill(p); });
  /* fragility: the crack and warning glow fade as risk falls, the easing glow grows on rebuilding */
  crackEl.setAttribute("opacity", clamp((sm.fx - 0.12) * 1.5).toFixed(2));
  crackEl.setAttribute("stroke-width", f1(1.5 + 3 * sm.fx));
  fxGlow.setAttribute("opacity", (0.45 * sm.fx).toFixed(2));
  okGlow.setAttribute("opacity", (0.4 * sm.ana).toFixed(2));
  /* gauges */
  gg.res.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["balanced", "raised", "high"])); gg.form.set(sm.F, wordOf(sm.F, 0.35, 0.6, ["low", "steady", "active"]));
  gg.rankl.set(sm.rankl, wordOf(sm.rankl, 0.35, 0.65, ["low", "raised", "high"])); gg.opg.set(sm.opg, wordOf(sm.opg, 0.35, 0.6, ["low", "steady", "high"]));
  gg.dens.set(sm.dens, wordOf(sm.dens, 0.45, 0.7, ["thin", "reduced", "preserved"])); gg.fx.set(sm.fx, wordOf(sm.fx, 0.3, 0.65, ["low", "raised", "high"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
