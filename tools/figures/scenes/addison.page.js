/* Addison scene: primary adrenal failure, left to right. Pituitary ACTH drives the
 * adrenal cap on the kidney; cortisol and aldosterone loss lowers pressure, wastes
 * salt, raises potassium and lowers glucose. Replacement treatments visibly restore
 * each stream: hydrocortisone becomes cortisol that docks on vessel receptors,
 * fludrocortisone becomes aldosterone at the kidney, IV fluids refill the vessel. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
const acthVEl = $("acthV"), bloodVEl = $("bloodV"), livVEl = $("livV");
let brainO = null, kidneyO = null, vesselO = null, liverO = null;
let capG = null, capCrack = null, capShade = null, pitDot = null, shockEl = null, pigLay = null, capEl = null;
let capCX = 455, capCY = 178, capDrug = -1, capLevel = -1;
let trACTH = null, trBlood = null, trLiv = null, bloodStart = [479, 184];
let receptors = [], rbcs = [], imms = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, tx: 0, ty: 0, tr: null, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.t = 0; p.u = 0; p.st = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const acth = pool(20, () => mk("circle", { class: "sc-p p-acth", r: 2.6 }, layers.parts));
const cort = pool(26, () => mk("circle", { class: "sc-p p-cort", r: 2.6 }, layers.parts));
const aldo = pool(14, () => mk("rect", { class: "sc-p p-aldo", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, layers.parts));
const na = pool(12, () => mk("circle", { class: "sc-p p-na", r: 2.4 }, layers.parts));
const kp = pool(12, () => mk("circle", { class: "sc-p p-k", r: 2.4 }, layers.parts));
const glu = pool(12, () => mk("path", { class: "sc-p p-glu", d: "M0 -3.6L2.8 0L0 3.6L-2.8 0Z" }, layers.parts));
const hydroP = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const fludP = pool(6, () => mk("rect", { class: "sc-p p-aldo", x: -3.4, y: -3.4, width: 6.8, height: 6.8, rx: 2 }, layers.parts));
const fluidP = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
function ptsD(pts) { return "M" + pts.map((q) => f1(q[0]) + " " + f1(q[1])).join(" L"); }
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 150, 185, 160, {});
  kidneyO = organ($("kidneySlot"), "kidney", 455, 280, 165, {});
  vesselO = organ($("vesselSlot"), "vessel", 735, 245, 88, { h: 180 });
  liverO = organ($("liverSlot"), "liver", 270, 348, 135, {});
  capCX = kidneyO.x; capCY = Math.round((kidneyO.y - kidneyO.h / 2 - 8) * 10) / 10;
  /* adrenal cap sits on the kidney top, with damage cracks and shade */
  capG = mk("g", {}, layers.cells);
  mk("ellipse", { class: "ad-adr", rx: 34, ry: 15 }, capG);
  mk("ellipse", { class: "ad-adr-in", rx: 22, ry: 8.5 }, capG);
  mk("ellipse", { class: "ad-med", rx: 9, ry: 4 }, capG);
  capCrack = mk("path", { class: "ad-crack", d: "M-20 -4l10 6l-7 5l11 4", opacity: "0" }, capG);
  capShade = mk("ellipse", { class: "ad-shade", rx: 34, ry: 15, opacity: "0" }, capG);
  place(capG, capCX, capCY, 0, 1);
  /* immune cells attacking the cap */
  [[-44, -14], [42, -18], [-8, -32], [30, 12]].forEach(([u, v], i) => {
    const c = cell(layers.cells, { cls: "imm", r: 7, nuc: 0.45, seed: i + 4, wob: 0.14 });
    imms.push({ c, u, v, i });
  });
  /* pituitary dot at the brain stem, where ACTH leaves */
  const stem = brainO.ports.stem || brainO.ports.in;
  pitDot = mk("circle", { class: "ad-pitd", r: 6 }, layers.cells);
  pitDot.setAttribute("transform", "translate(" + f1(stem[0]) + " " + f1(stem[1]) + ")");
  /* cortisol receptors ride inside the vessel group so they widen with it */
  [[-34, -55], [34, -25], [-34, 5], [34, 35], [-34, 62]].forEach(([lx, ly]) => {
    const e = mk("circle", { class: "ad-rec", cx: lx, cy: ly, r: 3.4 }, vesselO.g);
    receptors.push({ e, hot: 0 });
  });
  for (let i = 0; i < 8; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, vesselO.g);
    mk("ellipse", { class: "cl-b", rx: 7.5, ry: 4.4 }, g);
    mk("ellipse", { class: "cl-s", rx: 2.8, ry: 1.4 }, g);
    rbcs.push({ g, x: rnd(-20, 20), y: rnd(-85, 85), v: rnd(0.85, 1.15) });
  }
  /* crisis shock ring around the vessel */
  shockEl = mk("ellipse", { class: "ad-shock", rx: 62, ry: 104, opacity: "0" }, layers.cells);
  shockEl.setAttribute("transform", "translate(" + f1(vesselO.x) + " " + f1(vesselO.y) + ")");
  /* skin patch with a pigment layer that darkens with ACTH */
  const skin = mk("g", {}, layers.cells);
  mk("rect", { class: "ad-skin", x: 770, y: 350, width: 90, height: 56, rx: 12 }, skin);
  pigLay = mk("rect", { class: "ad-piglay", x: 770, y: 350, width: 90, height: 56, rx: 12, opacity: "0" }, skin);
  /* hormone tracks anchored on real ports */
  const cortex = kidneyO.ports.cortex || kidneyO.ports.pelvis;
  const vin = vesselO.ports.in;
  const livIn = liverO.ports.hepvein || liverO.ports.in;
  bloodStart = [capCX + 24, capCY + 6];
  const pACTH = [stem, [260, 268], [360, 228], [capCX - 10, capCY - 6]];
  const pBlood = [bloodStart, [580, 196], [662, 178], [vin[0], vin[1]]];
  const pLiv = [[capCX - 24, capCY + 4], [375, 155], [315, 220], [livIn[0], livIn[1]]];
  acthVEl.setAttribute("d", ptsD(pACTH));
  bloodVEl.setAttribute("d", ptsD(pBlood));
  livVEl.setAttribute("d", ptsD(pLiv));
  trACTH = track(pACTH); trBlood = track(pBlood); trLiv = track(pLiv);
  return { stem, cortex };
}
function capText(d, l) {
  if (d === 1) return "Stress dose hydrocortisone tops up cortisol. Sugar and pressure recover part way.";
  if (d === 2) return "Hydrocortisone replaces cortisol and fludrocortisone replaces aldosterone. Salt and potassium recover.";
  if (d === 3) return "IV fluids refill the vessels and hydrocortisone replaces cortisol. Pressure recovers.";
  if (l === 2) return "No treatment. Hormones are very low and this is a crisis. Pressure, salt and sugar fall.";
  return "No treatment. The gland makes too little hormone, so pressure, salt and sugar fall.";
}
const gg = {};
let anchors = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cort", "Cortisol", "g-glu", "Cortisol from the adrenal cap. It holds up pressure and sugar and answers stress. Replacement tops it up."],
   ["aldo", "Aldosterone", "g-aldo", "Aldosterone from the cap. It makes the kidney hold salt and water and pass potassium. Fludrocortisone replaces it."],
   ["bp", "Pressure", "g-good", "Blood pressure. It falls when cortisol and salt water are lost, and IV fluids refill the vessels."],
   ["na", "Sodium", "g-na", "Blood sodium. It falls when the kidney cannot hold salt without aldosterone."],
   ["k", "Potassium", "g-k", "Blood potassium. It rises when the kidney cannot pass potassium without aldosterone."],
   ["glu", "Glucose", "g-glu", "Blood sugar. It falls when cortisol is low, because cortisol helps the liver release sugar."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over, stem = anchors.stem, cortex = anchors.cortex;
  const aMid = trACTH.at(0.4), bMid = trBlood.at(0.3);
  pill(o, "Pituitary", stem[0], stem[1], 148, 64, "The pituitary releases ACTH. When cortisol falls it releases more, trying to drive the failing gland.");
  pill(o, "ACTH", aMid.x, aMid.y, 305, 64, "ACTH drives the adrenal cap to make cortisol. It runs high here and also darkens the skin.");
  pill(o, "Adrenal gland", capCX, capCY, 470, 64, "The adrenal cap on the kidney. Immune attack has destroyed it, so cortisol and aldosterone run low.");
  pill(o, "Cortisol", bMid.x, bMid.y, 630, 64, "Cortisol travelling in blood to the vessel. Hydrocortisone tops it up and it docks on vessel receptors.");
  pill(o, "Aldosterone", cortex[0], cortex[1], 630, 104, "Aldosterone acting on the kidney. It holds salt and water and passes potassium. Fludrocortisone replaces it.");
  pill(o, "Blood vessel", vesselO.x, vesselO.y - 40, 810, 100, "Blood vessel. Without cortisol it relaxes and pressure falls. Fluids refill it and cortisol restores its tone.");
  pill(o, "Skin", 840, 360, 872, 336, "Skin. High ACTH also stimulates pigment cells, so the skin darkens. It pales again with treatment.");
  pill(o, "Liver", liverO.x - 62, liverO.y, 140, 404, "Liver. Cortisol helps it release sugar. Sugar runs low in a crisis and recovers with hydrocortisone.");
  capEl = mk("text", { class: "ad-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, 0);
}
const sm = { Cort: 0.3, Aldo: 0.26, BP: 0.5, Na: 0.5, K: 0.6, Glu: 0.5, deficit: 0.4, acth: 0.5, pig: 0.4, a: 0.35, hydro: 0, flud: 0, fluids: 0 };
const acc = { acth: 0, cort: 0, cortL: 0, aldo: 0, na: 0, k: 0, glu: 0, hy: 0, fl: 0, flud: 0 };
function init() { anchors = initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Cort = lerp(sm.Cort, m.Cort, k2); sm.Aldo = lerp(sm.Aldo, m.AldoP, k2);
  sm.BP = lerp(sm.BP, m.BP, k1); sm.Na = lerp(sm.Na, m.Na, k2); sm.K = lerp(sm.K, m.K, k2); sm.Glu = lerp(sm.Glu, m.Glu, k2);
  sm.deficit = lerp(sm.deficit, m.deficit, k2); sm.acth = lerp(sm.acth, m.acthP, k2);
  sm.pig = lerp(sm.pig, m.pig, k2); sm.a = lerp(sm.a, m.a, k2);
  sm.hydro = lerp(sm.hydro, m.hydro, k1); sm.flud = lerp(sm.flud, m.flud, k1); sm.fluids = lerp(sm.fluids, m.fluids, k1);
  /* gland damage follows severity only: treatment replaces hormones, it does not regrow the gland */
  place(capG, capCX, capCY, Math.sin(tm / 900) * 2, 1 - 0.12 * sm.a);
  capCrack.setAttribute("opacity", sm.a.toFixed(2));
  capShade.setAttribute("opacity", (0.55 * sm.a).toFixed(2));
  imms.forEach((im) => { place(im.c, capCX + im.u, capCY + im.v, Math.sin(tm / 400 + im.i) * 14, 1); im.c.style.opacity = (0.35 + 0.65 * sm.a).toFixed(2); });
  const stem = anchors.stem;
  pitDot.setAttribute("transform", "translate(" + f1(stem[0]) + " " + f1(stem[1]) + ") scale(" + (1 + 0.25 * sm.acth * Math.sin(tm / 320)).toFixed(3) + ")");
  acthVEl.setAttribute("opacity", (0.15 + 0.6 * sm.acth).toFixed(2));
  bloodVEl.setAttribute("stroke-width", f1(8 + 10 * sm.BP));
  /* vessel widens with pressure; receptors and red cells ride inside the vessel group */
  const sx = 0.72 + 0.45 * sm.BP;
  vesselO.g.setAttribute("transform", "translate(" + f1(vesselO.x) + " " + f1(vesselO.y) + ") scale(" + sx.toFixed(3) + " 1)");
  const flow = 0.25 + 1.1 * sm.BP;
  rbcs.forEach((r) => { r.y += r.v * 46 * flow * dt; if (r.y > 88) r.y = -88; place(r.g, r.x + Math.sin(tm / 500 + r.y) * 3, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  receptors.forEach((r) => { r.hot = Math.max(0, r.hot - dt * 1.2); r.e.setAttribute("class", r.hot > 0.35 ? "ad-rec ad-on" : "ad-rec"); r.e.setAttribute("r", (3.4 + 2 * r.hot).toFixed(1)); });
  shockEl.setAttribute("opacity", (sm.deficit * (0.55 + 0.25 * Math.sin(tm / 180))).toFixed(2));
  pigLay.setAttribute("opacity", (sm.pig * 0.8).toFixed(2));
  /* ACTH from pituitary to cap, thinning as replacement restores feedback */
  acc.acth += dt * (1 + 9 * sm.acth);
  while (acc.acth >= 1) { acc.acth--; const p = free(acth); if (p) { emit(p, stem[0], stem[1]); p.tr = trACTH; p.u = 0; p.st = 1; } }
  acth.forEach((p) => { if (!p.on) return; p.u += dt * 70 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) kill(p); });
  /* cortisol into blood, docking on vessel receptors */
  acc.cort += dt * (0.5 + 10 * sm.Cort);
  while (acc.cort >= 1) { acc.cort--; const p = free(cort); if (p) { emit(p, bloodStart[0], bloodStart[1]); p.tr = trBlood; p.u = 0; } }
  cort.forEach((p) => { if (!p.on) return; p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u));
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    if (p.u >= 1) { const r = receptors.find((s) => s.hot <= 0); if (r) r.hot = 1; kill(p); } });
  /* cortisol signal to the liver */
  acc.cortL += dt * (0.3 + 4 * sm.Cort);
  while (acc.cortL >= 1) { acc.cortL--; const p = free(cort); if (p) { emit(p, capCX - 24, capCY + 4); p.tr = trLiv; p.u = 0; } }
  /* aldosterone made at the cap, absorbed at the kidney cortex */
  const cortex = anchors.cortex;
  acc.aldo += dt * (0.5 + 8 * sm.Aldo);
  while (acc.aldo >= 1) { acc.aldo--; const p = free(aldo); if (p) { emit(p, capCX - 8, capCY + 10); p.tx = cortex[0]; p.ty = cortex[1]; p.st = 1; } }
  aldo.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 2.2; p.y += (p.ty - p.y) * dt * 2.2;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 0.8).toFixed(2)); if (p.t > 2.4) kill(p); });
  /* sodium: held into blood when aldosterone works, lost downward when it does not */
  const kBot = kidneyO.y + kidneyO.h / 2;
  acc.na += dt * 4;
  while (acc.na >= 1) { acc.na--; const p = free(na); if (p) { emit(p, cortex[0] + rnd(-8, 8), cortex[1] + rnd(-8, 8)); p.t = 0; p.st = 1;
    if (Math.random() < sm.Aldo) { p.tx = bloodStart[0]; p.ty = bloodStart[1]; } else { p.tx = cortex[0]; p.ty = kBot + 26; } } }
  na.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 2.4; p.y += (p.ty - p.y) * dt * 2.4;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4) / 0.7).toFixed(2)); if (p.t > 2.1) kill(p); });
  /* potassium: passed out downward when aldosterone works, carried up into blood when it does not */
  acc.k += dt * 4;
  while (acc.k >= 1) { acc.k--; const p = free(kp); if (p) { emit(p, bloodStart[0] + rnd(-6, 6), bloodStart[1] + rnd(-4, 4)); p.t = 0;
    if (Math.random() < sm.Aldo) { p.st = 1; p.tx = cortex[0] - 10; p.ty = kBot + 26; } else { p.st = 2; p.tr = trBlood; p.u = 0; } } }
  kp.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 2) { p.u += dt * 80 / p.tr.len; const q = p.tr.at(Math.min(1, p.u));
      p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p);
    } else { p.x += (p.tx - p.x) * dt * 2.4; p.y += (p.ty - p.y) * dt * 2.4;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4) / 0.7).toFixed(2)); if (p.t > 2.1) kill(p); } });
  /* glucose released by the liver, carried away in blood */
  acc.glu += dt * (0.5 + 7 * sm.Glu);
  while (acc.glu >= 1) { acc.glu--; const p = free(glu); if (p) { emit(p, liverO.x + rnd(-30, 30), liverO.y + rnd(-10, 10)); p.vx = rnd(40, 70); p.t = 0; } }
  glu.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.x - liverO.x - 90) / 90).toFixed(2)); if (p.x > vesselO.x - 70) kill(p); });
  /* hydrocortisone capsules fall on the cap and burst into cortisol */
  acc.hy += dt * sm.hydro * 3;
  while (acc.hy >= 1) { acc.hy--; const p = free(hydroP); if (p) { emit(p, capCX + rnd(-40, 40), 56); p.vy = 95; p.t = 0; } }
  hydroP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")");
    if (p.y >= capCY - 2) { for (let i = 0; i < 3; i++) { const c = free(cort); if (c) { emit(c, bloodStart[0], bloodStart[1]); c.tr = trBlood; c.u = 0; } } kill(p); }
    if (p.t > 5) kill(p); });
  /* fludrocortisone tablets fly to the kidney cortex and burst into aldosterone */
  acc.flud += dt * sm.flud * 2.5;
  while (acc.flud >= 1) { acc.flud--; const p = free(fludP); if (p) { emit(p, 480 + rnd(-30, 30), 56); p.tx = cortex[0]; p.ty = cortex[1]; p.t = 0; } }
  fludP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.6; p.y += (p.ty - p.y) * dt * 1.6 + 14 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (Math.hypot(p.tx - p.x, p.ty - p.y) < 8) { for (let i = 0; i < 2; i++) { const c = free(aldo); if (c) { emit(c, cortex[0], cortex[1]); c.tx = cortex[0]; c.ty = cortex[1]; } } kill(p); }
    if (p.t > 6) kill(p); });
  /* IV fluid drops rain into the top of the vessel */
  const vTop = vesselO.y - 90;
  acc.fl += dt * sm.fluids * 9;
  while (acc.fl >= 1) { acc.fl--; const p = free(fluidP); if (p) { emit(p, vesselO.x + rnd(-24, 24), 56); p.vy = 260; } }
  fluidP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y >= vTop + 6) kill(p); });
  gg.cort.set(sm.Cort, wordOf(sm.Cort, 0.35, 0.6, ["low", "reduced", "ok"]));
  gg.aldo.set(sm.Aldo, wordOf(sm.Aldo, 0.3, 0.6, ["low", "reduced", "ok"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.38, 0.65, ["low", "borderline", "maintained"]));
  gg.na.set(sm.Na, wordOf(sm.Na, 0.45, 0.65, ["low", "reduced", "normal"]));
  gg.k.set(sm.K, wordOf(sm.K, 0.38, 0.6, ["normal", "raised", "high"]));
  gg.glu.set(sm.Glu, wordOf(sm.Glu, 0.45, 0.65, ["low", "reduced", "normal"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
