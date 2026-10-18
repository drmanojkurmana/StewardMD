/* Osteoporosis scene: osteoclasts, osteoblasts, RANKL and OPG signalling, thinning trabeculae, fragility fracture and the gauges. */
const layers = { trab: $("trab"), pits: $("pits"), cells: $("cells"), signal: $("signal"), fracture: $("fracture"), parts: $("parts"), over: $("over"), panel: $("panel"), bone: $("bone") };
const gg = {};
let boneEl = layers.bone, rightBone = null, crackEl = null, oesEl = null, opgEl = null, srcEl = null, preEl = null;
const trabStruts = [];
const oclasts = [], oblasts = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ranklP = pool(20, () => mk("path", { class: "sc-p p-rankl", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, layers.parts));
const opgP = pool(12, () => mk("circle", { class: "sc-p p-opg", r: 3 }, layers.parts));
const chips = pool(14, () => mk("rect", { class: "sc-p p-chip", x: -2.4, y: -1.6, width: 4.8, height: 3.2, rx: 1 }, layers.parts));
const matrix = pool(14, () => mk("circle", { class: "sc-p p-matrix", r: 2.4 }, layers.parts));
const txP = pool(12, () => mk("circle", { class: "sc-p p-tx", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The skeleton";
  [["res", "Resorption", "g-res", "Bone removed by osteoclasts. When this runs ahead of formation, bone is lost."], ["form", "Formation", "g-form", "New bone laid down by osteoblasts to replace what was resorbed."], ["rankl", "RANKL", "g-rankl", "RANKL from osteoblast lineage cells binds RANK on osteoclast precursors and drives osteoclast formation."], ["opg", "OPG", "g-opg", "Osteoprotegerin: a decoy receptor that mops up RANKL and restrains osteoclast formation."], ["dens", "Density", "g-dens", "Overall bone density. Thin, perforated trabeculae and a thin cortex lower it."], ["fx", "Fracture", "g-fx", "Risk of a fragility fracture: bone breaking with little trauma, for example at the spine, wrist or hip."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Osteoclast", 160, 131, 170, 92, "Osteoclast: a large multinucleated cell that seals onto bone and dissolves it, digging a resorption pit. RANKL drives its formation.");
  pill(ox, "Osteoblast", 400, 139, 390, 92, "Osteoblast: a bone forming cell. Rows of osteoblasts lay down new bone matrix, which then hardens with mineral. Their lineage also makes RANKL and OPG.");
  pill(ox, "Oestrogen", 625, 152, 625, 92, "Oestrogen restrains osteoclast formation and activity. After the menopause oestrogen falls, RANKL signalling rises relative to OPG, and resorption speeds up.");
  pill(ox, "OPG", 770, 246, 770, 92, "Osteoprotegerin (OPG): a decoy receptor made by osteoblast lineage cells. It binds RANKL before RANKL can reach osteoclast precursors.");
  pill(ox, "RANKL", 848, 208, 875, 92, "RANKL binds RANK on osteoclast precursors and drives them to become active osteoclasts. More RANKL relative to OPG means more resorption.");
  pill(ox, "Trabeculae", 220, 316, 200, 412, "Trabeculae: the lattice of bone struts inside the bone. In osteoporosis they thin and some break through, so the lattice weakens out of proportion to the bone lost.");
  const tx1 = pill(ox, "Bisphosphonate", 480, 382, 480, 412, "A bisphosphonate settles on bone mineral and is taken up by osteoclasts as they resorb. The osteoclasts then resorb less and die sooner, so loss slows."); tx1.setAttribute("id", "tx-pill-1");
  const tx2 = pill(ox, "Calcium and D", 480, 382, 480, 412, "Calcium and vitamin D support mineralisation of new bone where intake or levels are low. Shown as a class level teaching toggle, with no amounts."); tx2.setAttribute("id", "tx-pill-2");
  const tx3 = pill(ox, "Anabolic agent", 480, 382, 480, 412, "An anabolic agent stimulates osteoblasts to form new bone, so formation rises and density can rebuild."); tx3.setAttribute("id", "tx-pill-3");
  pill(ox, "Fracture", 750, 386, 765, 412, "A fragility fracture: weakened bone breaks with little trauma. The crack widens as density falls and partly recovers as density returns.");
}
function init() {
  /* trabecular lattice: deterministic struts, each with its own survival threshold */
  const rows = [192, 234, 276, 318, 356], cols = [96, 156, 216, 276, 336, 396, 456, 512];
  const node = (r, c) => [cols[c] + Math.sin(r * 3.1 + c * 1.7) * 7, rows[r] + Math.cos(c * 2.3 + r) * 5];
  let si = 0;
  const addStrut = (a, b) => { const ln = mk("line", { class: "os-trab", x1: f1(a[0]), y1: f1(a[1]), x2: f1(b[0]), y2: f1(b[1]) }, layers.trab); trabStruts.push({ ln, k: (si % 17) / 17 }); si++; };
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length - 1; c++) addStrut(node(r, c), node(r, c + 1));
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols.length; c += 1) if ((r + c) % 2 === 0) addStrut(node(r, c), node(r + 1, c));
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols.length - 1; c += 2) addStrut(node(r, c), node(r + 1, c + 1));
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) if ((r * 3 + c) % 3 === 0) mk("circle", { class: "os-ocyte", cx: f1(node(r, c)[0] + 12), cy: f1(node(r, c)[1] + 10), r: 2 }, layers.trab);
  /* resorption pits and the cells on the top surface */
  [[160, 150], [245, 150]].forEach(([x, y]) => mk("ellipse", { class: "os-pit", cx: x, cy: y, rx: 23, ry: 7 }, layers.pits));
  [[160, 146], [245, 146]].forEach(([x, y], i) => oclasts.push({ g: cell(layers.cells, { cls: "ocl", r: 19, nuc: 0.5, nucCls: "multi", seed: i * 3 + 2, wob: 0.14 }), x, y, i }));
  for (let i = 0; i < 5; i++) oblasts.push({ g: cell(layers.cells, { cls: "obl", r: 8, nuc: 0.4, seed: i + 7, wob: 0.1 }), x: 358 + i * 20, y: 144, i });
  /* signalling panel: source cell, precursor, oestrogen and OPG */
  const sg = layers.signal;
  mk("path", { class: "os-arrow", d: "M652 225L846 225" }, sg);
  mk("path", { class: "os-inhib", d: "M625 186L625 200M618 200L632 200" }, sg);
  srcEl = cell(sg, { cls: "obl", r: 23, nuc: 0.42, seed: 11, wob: 0.11 }); place(srcEl, 625, 225, 0, 1);
  preEl = cell(sg, { cls: "ocl", r: 21, nuc: 0.5, nucCls: "multi", seed: 17, wob: 0.13 }); place(preEl, 875, 225, 0, 1);
  oesEl = mk("circle", { class: "os-oes", cx: 625, cy: 168, r: 16 }, sg);
  opgEl = cell(sg, { cls: "opg", r: 16, nuc: 0.4, seed: 23, wob: 0.1 }); place(opgEl, 770, 262, 0, 1);
  /* fragility panel: a long bone in two pieces with a crack between them */
  const fg = layers.fracture;
  mk("circle", { class: "os-fbone", cx: 606, cy: 368, r: 16 }, fg);
  mk("path", { class: "os-fbone", d: "M600 352L738 352L750 368L738 384L600 384Z" }, fg);
  rightBone = mk("g", {}, fg);
  mk("path", { class: "os-fbone", d: "M758 352L888 352L894 368L888 384L758 384L766 368Z" }, rightBone);
  mk("circle", { class: "os-fbone", cx: 890, cy: 368, r: 16 }, rightBone);
  crackEl = mk("path", { class: "os-crack", d: "M750 350L759 360L749 370L757 386" }, fg);
  initPanel();
}
const sm = { R: 0.6, F: 0.4, rankl: 0.6, opg: 0.4, oes: 0.4, dens: 0.5, fx: 0.5, bis: 0, cal: 0, ana: 0 };
const acc = { rankl: 0, opg: 0, chip: 0, mat: 0, tx: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.R = lerp(sm.R, m.R, k2); sm.F = lerp(sm.F, m.F, k2); sm.rankl = lerp(sm.rankl, m.rankl, k2); sm.opg = lerp(sm.opg, m.opg, k2);
  sm.oes = lerp(sm.oes, m.oes, k2); sm.dens = lerp(sm.dens, m.dens, k2); sm.fx = lerp(sm.fx, m.fx, k2);
  sm.bis = lerp(sm.bis, drug === 1 ? 1 : 0, k); sm.cal = lerp(sm.cal, drug === 2 ? 1 : 0, k); sm.ana = lerp(sm.ana, drug === 3 ? 1 : 0, k);
  /* trabeculae thin and drop out as density falls; the cortical shell thins too */
  boneEl.setAttribute("stroke-width", f1(1.5 + 5 * sm.dens));
  trabStruts.forEach((s) => { s.ln.setAttribute("stroke-width", f1(0.6 + 5.2 * sm.dens)); s.ln.setAttribute("opacity", clamp((sm.dens - s.k * 0.72) / 0.28).toFixed(2)); });
  layers.pits.setAttribute("opacity", (0.25 + 0.75 * sm.R).toFixed(2));
  /* cells on the bone surface */
  oclasts.forEach((c) => place(c.g, c.x + Math.sin(tm / 700 + c.i * 2) * 2, c.y, 0, (0.55 + 0.55 * sm.R) * (1 + 0.05 * Math.sin(tm / 280 + c.i))));
  oblasts.forEach((c) => place(c.g, c.x, c.y + Math.sin(tm / 600 + c.i) * 1.2, 0, 0.5 + 0.6 * sm.F));
  /* signalling panel scales with its signals */
  place(srcEl, 625, 225, 0, 0.85 + 0.3 * sm.F);
  place(preEl, 875, 225, 0, 0.45 + 0.65 * sm.rankl * (1 - 0.55 * sm.opg));
  oesEl.setAttribute("opacity", (0.15 + 0.85 * sm.oes).toFixed(2)); oesEl.setAttribute("r", f1(10 + 7 * sm.oes));
  place(opgEl, 770, 262 + Math.sin(tm / 900) * 2, 0, 0.4 + 0.75 * sm.opg);
  /* RANKL tokens travel to the precursor; OPG tokens rise and block some of them */
  acc.rankl += dt * sm.rankl * 7; while (acc.rankl >= 1) { acc.rankl--; const p = free(ranklP); if (p) emit(p, 652, 225 + rnd(-6, 6), 52, 0, 0); }
  ranklP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 300 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 762 && p.x < 778 && Math.random() < sm.opg * 0.03) kill(p); if (p.x > 850) kill(p); });
  acc.opg += dt * sm.opg * 5; while (acc.opg >= 1) { acc.opg--; const p = free(opgP); if (p) emit(p, 648, 232, 30, -14, 0); }
  opgP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.x > 764) { p.y += (225 - p.y) * dt * 2; p.vx *= 0.98; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); });
  /* bone chips from osteoclasts, new matrix from osteoblasts */
  acc.chip += dt * sm.R * 6; while (acc.chip >= 1) { acc.chip--; const p = free(chips); if (p) emit(p, pick(oclasts).x + rnd(-12, 12), 158, rnd(-8, 8), rnd(16, 30), 0); }
  chips.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 120) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.mat += dt * sm.F * 6; while (acc.mat >= 1) { acc.mat--; const p = free(matrix); if (p) emit(p, pick(oblasts).x + rnd(-6, 6), 156, rnd(-6, 6), rnd(12, 22), 0); }
  matrix.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* treatment particles travel from the treatment pill to their target cells */
  const txOn = drug > 0 ? 1 : 0;
  acc.tx += dt * txOn * 5; while (acc.tx >= 1) { acc.tx--; const p = free(txP); if (p) emit(p, 480 + rnd(-8, 8), 398, 0, 0, drug); }
  const txTarget = [[480, 398], [185, 160], [300, 250], [400, 158]];
  txP.forEach((p) => { if (!p.on) return; p.t += dt; const tg = txTarget[p.k] || txTarget[0]; p.x += (tg[0] - p.x) * dt * 1.1; p.y += (tg[1] - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.t - 2.4) / 1.2).toFixed(2)); if (p.t > 3.6) kill(p); });
  $("tx-pill-1").style.opacity = sm.bis.toFixed(2); $("tx-pill-2").style.opacity = sm.cal.toFixed(2); $("tx-pill-3").style.opacity = sm.ana.toFixed(2);
  /* fragility: the right hand piece drifts and the crack shows as risk rises */
  rightBone.setAttribute("transform", "translate(" + f1(sm.fx * 8) + " " + f1(sm.fx * 3) + ")");
  crackEl.setAttribute("opacity", clamp((sm.fx - 0.12) * 1.5).toFixed(2));
  /* gauges */
  gg.res.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["balanced", "raised", "high"])); gg.form.set(sm.F, wordOf(sm.F, 0.35, 0.6, ["low", "steady", "active"]));
  gg.rankl.set(sm.rankl, wordOf(sm.rankl, 0.35, 0.65, ["low", "raised", "high"])); gg.opg.set(sm.opg, wordOf(sm.opg, 0.35, 0.6, ["low", "steady", "high"]));
  gg.dens.set(sm.dens, wordOf(sm.dens, 0.45, 0.7, ["thin", "reduced", "preserved"])); gg.fx.set(sm.fx, wordOf(sm.fx, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
