/* Lipid scene: gut uptake, liver production, VLDL to LDL, receptor clearance, HDL return and the gauges. */
const WW = SC.W;
const L = { gut: $("gutn"), liv: $("livn"), per: $("pern"), parts: $("parts"), over: $("over"), panel: $("panel") };
const xmark = (parent, x, y, id) => { const g = mk("g", { id, opacity: "0" }, parent); mk("circle", { class: "li-x", cx: x, cy: y, r: 9 }, g); mk("path", { class: "li-xp", d: "M" + (x - 4) + " " + (y - 4) + "L" + (x + 4) + " " + (y + 4) + "M" + (x + 4) + " " + (y - 4) + "L" + (x - 4) + " " + (y + 4) }, g); return g; };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gutTrack = track([[105, 132], [105, 215], [105, 345]]);
const prodTrack = track([[390, 158], [345, 215], [330, 348]]);
const pcskTrack = track([[470, 222], [462, 252], [445, 276]]);
const hdlTrack = track([[800, 218], [800, 350], [430, 350], [398, 252]]);
const gutP = pool(10, () => mk("circle", { class: "sc-p p-chol", r: 3.2 }, L.parts));
const prodP = pool(10, () => mk("circle", { class: "sc-p p-chol", r: 3.2 }, L.parts));
const pcskP = pool(10, () => mk("circle", { class: "sc-p p-pcsk", r: 3.4 }, L.parts));
let enzX, gutX, pcskX, famX, recG;
const liverChol = [], gutChol = [], perChol = [], recs = [];
const lipos = [], hdls = [];
const gg = {};
const sm = { Prod: 0.4, Abs: 0.3, V: 0.4, L: 0.3, R: 0.6, Hd: 0.5, Per: 0.2, Pk: 0.5, statin: 0, eze: 0, pcsk9i: 0, fam: 0 };
const acc = { gut: 0, prod: 0, pcsk: 0 };
function initNodes() {
  mk("rect", { class: "li-gut", x: 78, y: 122, width: 54, height: 106, rx: 27 }, L.gut);
  [88, 105, 122].forEach((x) => mk("circle", { class: "li-trans", cx: x, cy: 220, r: 4.5 }, L.gut));
  [[92, 145], [112, 160], [98, 178], [118, 192], [90, 200]].forEach(([x, y], i) => { const c = mk("circle", { class: "sc-p p-chol", cx: x, cy: y, r: 3.4 }, L.gut); gutChol.push({ e: c, i }); });
  mk("path", { class: "li-liver", d: "M255 170C255 125 300 108 390 108C480 108 525 125 525 170C525 215 480 238 390 238C300 238 255 215 255 170Z" }, L.liv);
  [[340, 155], [390, 148], [440, 158]].forEach(([x, y]) => mk("polygon", { class: "li-enz", points: (x - 9) + "," + y + " " + (x - 4.5) + "," + (y - 8) + " " + (x + 4.5) + "," + (y - 8) + " " + (x + 9) + "," + y + " " + (x + 4.5) + "," + (y + 8) + " " + (x - 4.5) + "," + (y + 8) }, L.liv));
  [[310, 190], [360, 198], [415, 190], [465, 198], [335, 215], [440, 218]].forEach(([x, y], i) => { const c = mk("circle", { class: "sc-p p-chol", cx: x, cy: y, r: 3.6 }, L.liv); liverChol.push({ e: c, i }); });
  mk("circle", { class: "sc-p p-vldl", cx: 330, cy: 222, r: 9 }, L.liv);
  recG = mk("g", {}, L.liv);
  [380, 405, 430, 455, 480].forEach((x) => { const p = mk("path", { class: "li-rec", d: "M" + x + " 276L" + x + " 264M" + x + " 264L" + (x - 6) + " 257M" + x + " 264L" + (x + 6) + " 257" }, recG); recs.push(p); });
  [[680, 150], [740, 138], [810, 152], [880, 142], [705, 195], [775, 200], [855, 192], [905, 205]].forEach(([x, y], i) => cell(L.per, { cls: "tiss", r: 17, nuc: 0.35, seed: i + 4, wob: 0.1, x, y }));
  [[672, 178], [722, 168], [792, 178], [848, 168], [898, 178], [742, 218], [822, 220], [688, 222]].forEach(([x, y], i) => { const c = mk("circle", { class: "sc-p p-chol", cx: x, cy: y, r: 3.4 }, L.per); perChol.push({ e: c, i }); });
  enzX = xmark(L.liv, 390, 152, "x-enz"); gutX = xmark(L.gut, 105, 220, "x-gut"); pcskX = xmark(L.parts, 520, 318, "x-pcsk");
  famX = mk("g", { opacity: "0" }, L.liv); mk("path", { class: "li-recbad", d: "M422 258l16 16M438 258l-16 16" }, famX);
  for (let i = 0; i < 22; i++) { const g = mk("g", {}, L.parts); const c = mk("circle", { class: "sc-p p-vldl", r: 8 }, g); mk("circle", { class: "sc-p p-vldl", r: 2.4, cx: -2, cy: -2 }, g); lipos.push({ g, c, x: rnd(40, 920), y: rnd(338, 382), lane: rnd(-20, 20), mode: 0, tx: 0, ty: 0, i }); }
  for (let i = 0; i < 10; i++) { const e = mk("circle", { class: "sc-p p-hdl", r: 4.4 }, L.parts); hdls.push({ e, u: i / 10, i }); }
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["prod", "Liver making", "g-prod", "Cholesterol made in the liver. HMG-CoA reductase is the controlling enzyme; a statin blocks it."], ["abs", "Gut uptake", "g-fl", "Cholesterol absorbed from the gut. Ezetimibe blocks this uptake."], ["ldl", "Blood LDL", "g-ldl", "LDL cholesterol carried in the blood. High LDL drives cholesterol into artery walls."], ["rec", "Receptor uptake", "g-rec", "LDL receptors on the liver pulling LDL out of the blood. Faulty in familial hypercholesterolaemia."], ["hdl", "HDL return", "g-hdl", "HDL carrying cholesterol from peripheral tissues back to the liver: reverse cholesterol transport."], ["per", "Tissue load", "g-bad", "Cholesterol loaded into peripheral tissues. It rises when LDL is high and return is poor."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 52, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Gut absorption", 105, 150, 105, 82, "The gut absorbs cholesterol from food and bile through a transporter in the gut wall. Ezetimibe blocks that transporter.");
  pill(o, "HMG-CoA reductase", 390, 155, 390, 82, "HMG-CoA reductase: the enzyme that controls cholesterol making in the liver. A statin blocks it, and the liver then makes more LDL receptors.");
  pill(o, "Peripheral tissue", 785, 175, 785, 82, "Body tissues outside the liver. LDL delivers cholesterol here; HDL collects spare cholesterol and takes it back.");
  const pe = pill(o, "Ezetimibe", 105, 215, 105, 296, "Ezetimibe blocks cholesterol uptake from the gut, so less cholesterol reaches the liver and blood."); pe.setAttribute("id", "p-eze");
  const ps = pill(o, "Statin", 360, 158, 180, 296, "A statin blocks HMG-CoA reductase in the liver. The liver makes less cholesterol and puts more LDL receptors on its surface."); ps.setAttribute("id", "p-statin");
  pill(o, "VLDL", 330, 348, 275, 296, "VLDL: the liver sends fat and cholesterol out in VLDL particles. In the blood VLDL loses fat and becomes LDL.");
  pill(o, "LDL receptor", 430, 264, 415, 296, "LDL receptor on the liver surface. It binds LDL and pulls it into the liver. In familial hypercholesterolaemia the receptor is faulty, so clearance fails.");
  pill(o, "PCSK9", 500, 282, 545, 296, "PCSK9: a liver protein that marks LDL receptors for destruction. Blocking it leaves more receptors working.");
  pill(o, "LDL", 615, 360, 615, 296, "LDL: the main cholesterol carrier in blood. It delivers cholesterol to tissues; spare LDL is cleared by liver receptors.");
  pill(o, "HDL returns", 760, 350, 715, 296, "HDL returns: HDL picks up cholesterol from peripheral tissues and carries it back to the liver. This is reverse cholesterol transport.");
  pill(o, "Bloodstream", 70, 360, 90, 424, "The bloodstream linking gut, liver and tissues. Lipoproteins, not free cholesterol, carry the lipid here.");
  const pf = pill(o, "Receptor defect", 445, 272, 560, 424, "Familial hypercholesterolaemia: one faulty LDL receptor gene leaves too few working receptors, so LDL stays high even with treatment that needs receptors."); pf.setAttribute("id", "p-fam");
  const pp = pill(o, "PCSK9 blocker", 520, 330, 800, 424, "PCSK9 inhibitor concept: an antibody that stops PCSK9, so LDL receptors are recycled instead of destroyed and clear more LDL."); pp.setAttribute("id", "p-pcsk");
}
function follow(pl, tr, dt, speed) {
  pl.forEach((p) => { if (!p.on) return; p.u += dt * speed; if (p.u >= 1) { kill(p); return; } const q = tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
}
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), famT = (m.R < 0.3 && m.a > 0.9) ? 1 : 0;
  sm.Prod = lerp(sm.Prod, m.Prod, k); sm.Abs = lerp(sm.Abs, m.Abs, k); sm.V = lerp(sm.V, m.V, k); sm.L = lerp(sm.L, m.L, k); sm.R = lerp(sm.R, m.R, k); sm.Hd = lerp(sm.Hd, m.Hd, k); sm.Per = lerp(sm.Per, m.Per, k); sm.Pk = lerp(sm.Pk, m.Pk, k);
  sm.statin = lerp(sm.statin, m.statin, k); sm.eze = lerp(sm.eze, m.eze, k); sm.pcsk9i = lerp(sm.pcsk9i, m.pcsk9i, k); sm.fam = lerp(sm.fam, famT, k);
  gutChol.forEach((c) => c.e.setAttribute("opacity", (c.i < 1 + sm.Abs * 4 ? 1 : 0.12).toFixed(2)));
  liverChol.forEach((c) => c.e.setAttribute("opacity", (c.i < 1 + sm.Prod * 5 ? 1 : 0.12).toFixed(2)));
  perChol.forEach((c) => c.e.setAttribute("opacity", (c.i < sm.Per * 8 ? 1 : 0.1).toFixed(2)));
  enzX.setAttribute("opacity", sm.statin.toFixed(2)); gutX.setAttribute("opacity", sm.eze.toFixed(2)); pcskX.setAttribute("opacity", sm.pcsk9i.toFixed(2)); famX.setAttribute("opacity", sm.fam.toFixed(2));
  recG.setAttribute("opacity", (0.3 + 0.7 * sm.R).toFixed(2));
  $("p-eze").style.opacity = sm.eze.toFixed(2); $("p-statin").style.opacity = sm.statin.toFixed(2); $("p-pcsk").style.opacity = sm.pcsk9i.toFixed(2); $("p-fam").style.opacity = sm.fam.toFixed(2);
  acc.gut += dt * sm.Abs * 3.2; while (acc.gut >= 1) { acc.gut--; const p = free(gutP); if (p) emit(p, 105, 132, 0, 0, 0); }
  acc.prod += dt * sm.Prod * 3.4; while (acc.prod >= 1) { acc.prod--; const p = free(prodP); if (p) emit(p, 390, 158, 0, 0, 0); }
  acc.pcsk += dt * sm.Pk * 2.6; while (acc.pcsk >= 1) { acc.pcsk--; const p = free(pcskP); if (p) emit(p, 470, 222, 0, 0, 0); }
  follow(gutP, gutTrack, dt, 0.16); follow(prodP, prodTrack, dt, 0.15); follow(pcskP, pcskTrack, dt, 0.22);
  const want = Math.round(5 + sm.L * 16);
  lipos.forEach((p, idx) => {
    const on = idx < want;
    if (p.mode === 0) {
      p.x += 46 * dt; if (p.x > 928) { p.x = 32; p.y = 360 + p.lane; }
      if (p.x > 424 && p.x < 436 && Math.random() < sm.R * dt * 1.4) { p.mode = 1; p.tx = 380 + (idx % 5) * 25; p.ty = 278; }
      else if (p.x > 744 && p.x < 756 && Math.random() < sm.Per * dt * 1.1) { p.mode = 2; p.tx = 760 + (idx % 4) * 22; p.ty = 262; }
      const isL = p.x > 560 || p.x < 330, sc = on ? (isL ? 0.62 : 1) : 0.001;
      p.c.setAttribute("class", "sc-p " + (isL ? "p-ldl" : "p-vldl")); place(p.g, p.x, 360 + p.lane, 0, sc);
    } else {
      p.k = Math.min(1, (p.k || 0) + dt * 0.55);
      const curY = lerp(360 + p.lane, p.ty, p.k);
      place(p.g, lerp(p.sx || p.x, p.tx, p.k), curY, 0, on ? 0.62 : 0.001);
      if (p.k >= 1) { p.mode = 0; p.k = 0; p.sx = 0; p.x = 330; p.y = 360 + p.lane; }
      if (!p.sx) { p.sx = p.x; }
    }
    p.g.style.opacity = on ? 1 : 0;
  });
  hdls.forEach((p) => { p.u += dt * 0.055 * (0.4 + sm.Hd); if (p.u > 1) p.u -= 1; const q = hdlTrack.at(p.u), vis = p.i < 2 + sm.Hd * 8; p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", vis ? "1" : "0"); });
  gg.prod.set(sm.Prod, wordOf(sm.Prod, 0.3, 0.55, ["low", "usual", "high"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.25, 0.45, ["low", "usual", "high"]));
  gg.ldl.set(sm.L, wordOf(sm.L, 0.35, 0.65, ["low", "raised", "high"])); gg.rec.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["very low", "reduced", "good"]));
  gg.hdl.set(sm.Hd, wordOf(sm.Hd, 0.42, 0.52, ["low", "usual", "good"])); gg.per.set(sm.Per, wordOf(sm.Per, 0.3, 0.55, ["low", "raised", "high"]));
}
function init() { initNodes(); initPanel(); }
run({ init, step });
