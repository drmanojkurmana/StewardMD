/* CKD-MBD scene: kidney, phosphate, active vitamin D, calcium, parathyroid hormone, osteoclasts, osteoblasts and gauges. */
const layers = { kid: $("kidney"), gland: $("gland"), bone: $("boneg"), gut: $("gutg"), rbcs: $("rbcs"), parts: $("parts"), osteo: $("osteocells"), over: $("over"), panel: $("panel"), lumen: $("lumen"), vit: $("vitnode"), casr: $("casr"), pit: $("pit"), mat: $("bonemat") };
/* ---- bone cells ---- */
const ocl = cell(layers.osteo, { cls: "mac", r: 16, nuc: 0.5, nucCls: "multi", seed: 3, wob: 0.14 });
const obls = [818, 852, 886].map((x, i) => ({ g: cell(layers.osteo, { cls: "ostb", r: 9, nuc: 0.4, seed: i + 8, wob: 0.08 }), x }));
const ocys = [[732, 168], [798, 178], [872, 162]].map(([x, y], i) => ({ g: cell(layers.osteo, { cls: "ocy", r: 7, nuc: 0.35, seed: i + 15, wob: 0.1 }), x, y }));
place(ocl, 726, 124, 0, 1); obls.forEach((o) => place(o.g, o.x, 120, 0, 1)); ocys.forEach((o) => place(o.g, o.x, o.y, 0, 1));
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, 960), y: rnd(-12, 12), v: rnd(0.8, 1.2) }); } }
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, t: 0, k: 0 }; }); }
const po4 = pool(36, () => mk("rect", { class: "sc-p p-phos2", x: -3, y: -3, width: 6, height: 6, rx: 1 }, layers.parts));
const caP = pool(28, () => mk("circle", { class: "sc-p p-ca2", r: 3 }, layers.parts));
const pthP = pool(30, () => mk("path", { class: "sc-p p-pth2", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const vitP = pool(22, () => mk("circle", { class: "sc-p p-vitd2", r: 3 }, layers.parts));
const cmP = pool(12, () => mk("circle", { class: "sc-p p-cmim", r: 3.2 }, layers.parts));
const bindP = pool(16, () => mk("rect", { class: "sc-p p-vitd2", x: -3.4, y: -2.2, width: 6.8, height: 4.4, rx: 2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, tx, ty, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.tx = tx || 0; p.ty = ty || 0; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function seek(pl, speed, arrive) { pl.forEach((p) => { if (!p.on) return; p.t += 0.016; const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * speed * 0.016 + p.vx * 0.016; p.y += (dy / d) * speed * 0.016 + p.vy * 0.016; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < arrive || p.t > 9) kill(p); }); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Blood and bone";
  [["gfr", "Filtration", "g-good", "How well the kidney filters. It falls as CKD stage advances."], ["phos", "Phosphate", "g-phos2", "Phosphate retained when filtration falls. A binder traps it in the gut."], ["vitd", "Vitamin D", "g-vitd2", "Active vitamin D made by the kidney. It drives gut calcium absorption and calms the parathyroid."], ["ca", "Calcium", "g-ca2", "Blood calcium. It falls when active vitamin D is low and rises again when absorption recovers."], ["pth", "PTH", "g-pth2", "Parathyroid hormone. It rises in secondary hyperparathyroidism and drives bone resorption."], ["bone", "Bone loss", "g-bone2", "Net bone loss when osteoclast resorption outruns osteoblast formation and mineralization."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 110, 205, 90, 262, "Kidney. As nephrons are lost, filtration falls, phosphate is retained and active vitamin D production drops.");
  pill(ox, "Filtration", 150, 132, 290, 110, "Filtration at the glomerulus. Falling filtration is the starting point of CKD mineral bone disorder.");
  pill(ox, "Active vitamin D", 196, 196, 290, 190, "Active vitamin D made in the kidney. It lets the gut absorb calcium and feeds back to suppress parathyroid hormone. Osteoblast lineage cells and mineralization also depend on it.");
  pill(ox, "PTH", 482, 204, 482, 242, "Parathyroid hormone from the parathyroid gland. Sustained excess is secondary hyperparathyroidism.");
  pill(ox, "Phosphate", 330, 299, 340, 262, "Phosphate in the blood. Retained phosphate helps drive parathyroid hormone up.");
  pill(ox, "Calcium", 560, 299, 580, 262, "Calcium in the blood, absorbed from the gut and released from bone. Low calcium stimulates the parathyroid gland.");
  pill(ox, "Osteoclast", 726, 126, 710, 242, "Osteoclast: a multinucleate cell derived from hematopoietic progenitors in marrow. Recruited by a ligand from osteoblast lineage cells, it sits on the bone surface and resorbs mineral and collagen matrix.");
  pill(ox, "Osteoblast", 852, 120, 850, 242, "Osteoblast: a bone forming cell from mesenchymal progenitors. It expresses Runx2 during differentiation, lays down collagen and other proteins, supports mineralization, and some osteoblasts become osteocytes in matrix.");
  pill(ox, "Gut", 370, 389, 250, 390, "Gut. Active vitamin D drives calcium and phosphate absorption here. A phosphate binder traps dietary phosphate in the gut.");
  const bp = pill(ox, "Binder", 584, 382, 660, 390, "Phosphate binder in the gut. It binds dietary phosphate so less reaches the blood."); bp.setAttribute("id", "binder-pill");
  const cp = pill(ox, "Calcimimetic", 546, 150, 615, 110, "Calcimimetic at the calcium sensing receptor. It makes the gland act as if calcium were higher, so parathyroid hormone falls."); cp.setAttribute("id", "cmim-pill");
}
const sm = { gfr: 0.4, phos: 0.6, vitD: 0.3, ca: 0.4, pth: 0.7, bone: 0.6, binder: 0, cmim: 0 };
const acc = { po4: 0, ca: 0, pth: 0, vit: 0, cm: 0, bind: 0 };
function init() { initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.2);
  sm.gfr = lerp(sm.gfr, m.gfr, k); sm.phos = lerp(sm.phos, m.phos, k); sm.vitD = lerp(sm.vitD, m.vitD, k); sm.ca = lerp(sm.ca, m.ca, k); sm.pth = lerp(sm.pth, m.pth, k); sm.bone = lerp(sm.bone, m.bone, k); sm.binder = lerp(sm.binder, m.binder, k); sm.cmim = lerp(sm.cmim, m.cmim, k);
  /* gland and bone cells scale with the model */
  layers.gland.setAttribute("transform", "translate(" + f1(482 * (1 - (0.92 + 0.22 * sm.pth))) + " " + f1(150 * (1 - (0.92 + 0.22 * sm.pth))) + ") scale(" + (0.92 + 0.22 * sm.pth).toFixed(3) + ")");
  place(ocl, 726, 124, Math.sin(tm / 500) * 6, 0.35 + 0.95 * m.resorp);
  obls.forEach((o, i) => place(o.g, o.x, 120 + Math.sin(tm / 600 + i) * 1.5, 0, 0.4 + 0.8 * m.form));
  ocys.forEach((o) => place(o.g, o.x, o.y, 0, 0.7 + 0.3 * m.form));
  layers.mat.setAttribute("opacity", (1 - 0.38 * sm.bone).toFixed(2)); layers.pit.setAttribute("opacity", (0.25 + 0.75 * sm.bone).toFixed(2));
  layers.vit.setAttribute("r", f1(5 + 6 * sm.vitD)); layers.casr.setAttribute("opacity", (0.35 + 0.65 * Math.max(sm.ca, sm.cmim)).toFixed(2));
  $("binder-pill").style.opacity = sm.binder.toFixed(2); $("cmim-pill").style.opacity = sm.cmim.toFixed(2);
  /* red cells */
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 950) { r.x = 35; r.y = rnd(-12, 12); } place(r.g, r.x, 299 + r.y, 0, 1); });
  /* phosphate retained in the vessel */
  acc.po4 += dt * (1 + 9 * sm.phos); while (acc.po4 >= 1) { acc.po4--; const p = free(po4); if (p) emit(p, rnd(40, 120), rnd(286, 312), rnd(28, 48), 0, 0, 0, 0); }
  po4.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 400 + p.x) * dt * 3; p.x = clamp(p.x, 36, 924); p.y = clamp(p.y, 284, 314); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); if (p.x > 918) kill(p); });
  /* calcium absorbed at the gut, rising into the vessel */
  acc.ca += dt * (1 + 8 * m.gutCa); while (acc.ca >= 1) { acc.ca--; const p = free(caP); if (p) emit(p, rnd(390, 570), 350, 0, -rnd(18, 28), 0, 0, 0); }
  caP.forEach((p) => { if (!p.on) return; p.x += Math.sin(tm / 500 + p.y) * dt * 4; p.y += p.vy * dt; p.x = clamp(p.x, 370, 590); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 322) kill(p); });
  /* PTH from the gland to the bone surface */
  acc.pth += dt * (1 + 10 * sm.pth); while (acc.pth >= 1) { acc.pth--; const p = free(pthP); if (p) emit(p, 482 + rnd(-18, 18), 198, rnd(-4, 4), 0, rnd(700, 880), 112, 0); }
  seek(pthP, 85, 14);
  /* active vitamin D from the kidney to the gut */
  acc.vit += dt * (1 + 7 * sm.vitD); while (acc.vit >= 1) { acc.vit--; const p = free(vitP); if (p) emit(p, 200, 200, 0, 0, rnd(390, 540), 362, 0); }
  seek(vitP, 70, 14);
  /* calcimimetic arriving at the calcium sensing receptor */
  acc.cm += dt * sm.cmim * 5; while (acc.cm >= 1) { acc.cm--; const p = free(cmP); if (p) emit(p, 482 + rnd(-20, 20), 58, 0, 0, 544, 148, 0); }
  seek(cmP, 75, 12);
  /* binder particles working in the gut */
  acc.bind += dt * sm.binder * 6; while (acc.bind >= 1) { acc.bind--; const p = free(bindP); if (p) emit(p, rnd(380, 420), rnd(372, 408), rnd(16, 26), 0, 0, 0, 0); }
  bindP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3) / 1.2).toFixed(2)); if (p.t > 4.2 || p.x > 590) kill(p); });
  /* gauges */
  gg.gfr.set(sm.gfr, wordOf(sm.gfr, 0.35, 0.7, ["very low", "reduced", "near normal"])); gg.phos.set(sm.phos, wordOf(sm.phos, 0.32, 0.62, ["normal", "raised", "high"])); gg.vitd.set(sm.vitD, wordOf(sm.vitD, 0.32, 0.62, ["low", "reduced", "normal"]));
  gg.ca.set(sm.ca, wordOf(sm.ca, 0.38, 0.62, ["low", "normal", "high"])); gg.pth.set(sm.pth, wordOf(sm.pth, 0.4, 0.65, ["normal", "raised", "high"])); gg.bone.set(sm.bone, wordOf(sm.bone, 0.3, 0.58, ["balanced", "increased", "high"]));
}
run({ init, step });
