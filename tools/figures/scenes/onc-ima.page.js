/* Imatinib scene: BCR-ABL blockade on the left; eye, muscle, liver, heart and marrow on the right. */
const WW = SC.W;
const layers = { cell: $("cellSlot"), kin: $("kinase"), mut: $("mutSlot"), parts: $("parts"), eye: $("eyeSlot"), mus: $("musSlot"), liv: $("livSlot"), hrt: $("hrtSlot"), mar: $("marrow"), over: $("over"), panel: $("panel") };
const CX = 255, CY = 235, CR = 135, KX = 255, KY = 226;
const MX = 480, MY = 315, MR = 52, MCY = 313;
/* ---- main leukaemia cell ---- */
let cellG = null, deadShade = null;
function initCell() {
  cellG = cell(layers.cell, { cls: "leuk", r: CR, nuc: 0.55, seed: 5, wob: 0.07 });
  place(cellG, CX, CY, 0, 1);
  deadShade = mk("circle", { class: "im-dead", cx: 0, cy: 0, r: CR * 0.96, opacity: "0" }, cellG);
}
/* ---- BCR-ABL kinase: two lobes with the ATP pocket between them ---- */
let wedge = null, flash = null;
function starD(r1, r2, n) { let d = ""; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = (i / (n * 2)) * 6.283; d += (i ? "L" : "M") + f1(Math.cos(a) * r) + " " + f1(Math.sin(a) * r); } return d + "Z"; }
function initKinase() {
  const g = layers.kin;
  mk("ellipse", { class: "im-lobe", cx: KX, cy: 196, rx: 46, ry: 22 }, g);
  mk("ellipse", { class: "im-lobe2", cx: KX, cy: 263, rx: 57, ry: 29 }, g);
  mk("rect", { class: "im-pocket", x: KX - 24, y: 216, width: 48, height: 20, rx: 6 }, g);
  wedge = mk("rect", { class: "im-wedge", x: KX - 17, y: 218, width: 34, height: 16, rx: 5, opacity: "0" }, g);
  flash = mk("g", { opacity: "0" }, g);
  mk("path", { class: "im-flash", d: starD(12, 5, 8) }, flash);
  place(flash, KX, KY, 0, 1);
}
/* ---- resistant mini cell: T315I gatekeeper bump in the pocket ---- */
let mutWedge = null;
const mutAtp = [];
function initMut() {
  const g = cell(layers.mut, { cls: "leuk", r: MR, nuc: 0.5, seed: 9, wob: 0.09 });
  place(g, MX, MY, 0, 1);
  mk("ellipse", { class: "im-lobe", cx: MX, cy: 300, rx: 24, ry: 11 }, layers.mut);
  mk("ellipse", { class: "im-lobe2", cx: MX, cy: 330, rx: 28, ry: 14 }, layers.mut);
  mk("path", { class: "im-gate", d: "M472 317L480 306L488 317Z" }, layers.mut);
  for (let i = 0; i < 2; i++) mutAtp.push(mk("circle", { class: "sc-p p-atp", r: 3 }, layers.parts));
  mutWedge = mk("rect", { class: "im-wedge", x: -11, y: -5, width: 22, height: 10, rx: 4 }, layers.parts);
}
/* ---- organs ---- */
let puff = null, bag = null, spasm = null, livW = null, hrtW = null;
const mcells = [];
function initOrgans() {
  organ(layers.eye, "eye", 672, 145, 110, {});
  puff = mk("ellipse", { class: "im-puff", cx: 672, cy: 145, rx: 66, ry: 50, opacity: "0" }, layers.eye);
  bag = mk("ellipse", { class: "im-bag", cx: 672, cy: 172, rx: 30, ry: 11, opacity: "0" }, layers.eye);
  organ(layers.mus, "muscle", 858, 145, 105, {});
  spasm = mk("ellipse", { class: "im-spasm", cx: 858, cy: 145, rx: 52, ry: 40, opacity: "0" }, layers.mus);
  organ(layers.liv, "liver", 672, 252, 125, {});
  livW = mk("ellipse", { class: "im-livwash", cx: 672, cy: 252, rx: 68, ry: 38, opacity: "0" }, layers.liv);
  organ(layers.hrt, "heart", 858, 252, 105, {});
  hrtW = mk("ellipse", { class: "im-hrtwash", cx: 858, cy: 252, rx: 52, ry: 44, opacity: "0" }, layers.hrt);
}
/* ---- marrow inside a small procedural bone ---- */
function initMarrow() {
  const g = layers.mar, bx = 765, by = 372;
  mk("rect", { class: "im-bone", x: bx - 85, y: by - 13, width: 170, height: 26, rx: 12 }, g);
  [[-85, -7], [-85, 7], [85, -7], [85, 7]].forEach(([dx, dy]) => mk("circle", { class: "im-bone", cx: bx + dx, cy: by + dy, r: 12 }, g));
  mk("ellipse", { class: "im-cav", cx: bx, cy: by, rx: 62, ry: 8 }, g);
  for (let i = 0; i < 16; i++) mcells.push(mk("circle", { class: "im-mcell", cx: f1(bx - 56 + i * 7.4), cy: f1(by + ((i * 37) % 9) - 4), r: 2.6 }, g));
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ima = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { x: -7, y: -4, width: 14, height: 8, rx: 3, class: "im-wedge" }, g); return g; });
const atp = pool(12, () => mk("circle", { class: "sc-p p-atp", r: 3 }, layers.parts));
const sig = pool(22, () => mk("circle", { class: "sc-p p-sig", r: 2.6 }, layers.parts));
const mutSig = pool(6, () => mk("circle", { class: "sc-p p-sig", r: 2.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges, caption ---- */
const gg = {};
let capEl = null;
function capText(m) {
  if (!m.on) return "No drug yet: BCR-ABL keeps firing and the leukaemia cell keeps dividing.";
  if (m.prot) return "Checks and diuretics hold swelling and liver strain back; tumour controlled.";
  return m.Kill < 0.6 ? "Imatinib plugs the ATP pocket; early nausea, cramps and low counts fade." : "Tumour controlled but swelling and liver strain build; T315I still fires.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [180, 360, 540, 720];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "How much leukaemia growth imatinib has stopped. Rises as BCR-ABL falls silent through the course."],
    ["sw", "Swelling", "g-fl", "Fluid retention and puffy eyes: PDGFR blockade loosens vessel walls so fluid leaks out. Diuretics drain it away."],
    ["mar", "Low counts", "g-neu", "Cytopenias: imatinib also hits healthy marrow, so blood counts dip early and then recover."],
    ["liv", "Liver strain", "g-eos", "Liver enzyme rise: the liver breaks imatinib down and the workload injures liver cells. Checks catch it early."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "BCR-ABL", 300, 200, 150, 90, "BCR-ABL: a stuck-on kinase from the Philadelphia chromosome. It grabs ATP and fires growth signals so the leukaemia cell keeps dividing. Imatinib also blocks KIT and PDGFR.");
  pill(ox, "Imatinib", 42, 320, 80, 400, "Imatinib: a small molecule that slots into the ATP pocket of inactive BCR-ABL and locks it shut, so ATP cannot enter and signalling stops.");
  pill(ox, "T315I resists", 480, 306, 478, 396, "T315I gatekeeper mutant: one changed building block bulks up the pocket so imatinib cannot fit, but ATP still can, so this clone keeps growing.");
  pill(ox, "Puffy eyes", 640, 135, 640, 92, "Periorbital oedema: blocking PDGFR loosens capillary walls so fluid leaks into soft tissue, worst around the eyes, and diuretics drain it away.");
  pill(ox, "Muscle cramps", 890, 135, 872, 92, "Muscle cramps: imatinib upsets muscle ion and phosphate handling so muscles seize, often at night and worst in the first months.");
  pill(ox, "Liver strain", 648, 245, 636, 306, "Liver enzyme rise: the liver breaks imatinib down and the workload injures liver cells, so enzymes leak into the blood; checks catch it early.");
  pill(ox, "Heart (rare)", 882, 245, 890, 306, "Rare heart failure: in a few patients prolonged kinase blockade weakens heart muscle, so fluid backs up; checks catch breathlessness early.");
  pill(ox, "Low blood counts", 765, 376, 765, 414, "Cytopenias: imatinib hits healthy marrow stem cells too, so red cells, white cells and platelets dip, usually in the first weeks.");
  capEl = mk("text", { class: "im-capline", x: 30, y: 428 }, ox); capEl.textContent = capText({ on: 0, prot: 0, Kill: 0 });
}
const sm = { Kill: 0, Swell: 0, Mar: 0, Liv: 0, Cramp: 0, Hrt: 0.02, on: 0, prot: 0 };
const acc = { ima: 0, atp: 0, sig: 0, mut: 0 };
function init() { initCell(); initKinase(); initMut(); initOrgans(); initMarrow(); initPanel(); }
function step(dt, m) {
  const k2 = Math.min(1, dt * 0.55), k1 = Math.min(1, dt * 0.9);
  ["Kill", "Swell", "Mar", "Liv", "Cramp", "Hrt"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  sm.on = lerp(sm.on, m.on, k1); sm.prot = lerp(sm.prot, m.prot, k1);
  const growth = sm.on > 0.5 ? (1 - sm.Kill) : 0.85;
  /* leukaemia cell: darkens and shrinks as it dies */
  deadShade.setAttribute("opacity", (sm.Kill * 0.45).toFixed(2));
  place(cellG, CX + Math.sin(tm / 1500) * 2, CY + Math.cos(tm / 1800) * 2, 0, 1 - 0.06 * sm.Kill + 0.015 * growth * Math.sin(tm / 500));
  wedge.setAttribute("opacity", sm.on.toFixed(2));
  const fl = 0.5 + 0.5 * Math.sin(tm / 140);
  flash.setAttribute("opacity", (growth * (0.25 + 0.6 * fl)).toFixed(2));
  place(flash, KX, KY, tm / 60, 0.7 + 0.5 * fl * growth);
  /* imatinib drifts in from the left and docks in the pocket */
  acc.ima += dt * sm.on * 5;
  while (acc.ima >= 1) { acc.ima--; const p = free(ima); if (p) emit(p, rnd(24, 60), rnd(150, 340), 0, 0, 0); }
  ima.forEach((p) => { if (!p.on) return; const dx = KX - p.x, dy = KY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 80 * dt; p.y += (dy / d) * 80 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 10) + ")"); if (d < 18) kill(p); });
  /* ATP seeks the pocket and bounces off once it is plugged */
  acc.atp += dt * 4;
  while (acc.atp >= 1) { acc.atp--; const p = free(atp); if (p) emit(p, rnd(350, 420), rnd(150, 320), 0, 0, 0); }
  atp.forEach((p) => {
    if (!p.on) return;
    if (p.k === 1) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    const dx = KX - p.x, dy = KY - p.y, d = Math.hypot(dx, dy) || 1;
    if (sm.on > 0.5 && d < 52) { p.k = 1; p.t = 0; p.vx = (dx / d) * -110; p.vy = (dy / d) * -110 + 30; return; }
    p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 12) kill(p);
  });
  /* growth signals stream from the firing kinase */
  acc.sig += dt * growth * 14;
  while (acc.sig >= 1) { acc.sig--; const p = free(sig); if (p) emit(p, KX + rnd(-8, 8), KY + rnd(-4, 8), rnd(-45, 45), rnd(55, 110), 0); }
  sig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y > 368) kill(p); });
  /* T315I clone: ATP still docks, imatinib bounces off, signals persist */
  mutAtp.forEach((e, i) => { const a = tm / 700 + i * Math.PI; e.setAttribute("cx", f1(MX + Math.cos(a) * 24)); e.setAttribute("cy", f1(MCY + Math.sin(a) * 24)); e.setAttribute("opacity", (0.5 + 0.5 * Math.sin(tm / 300 + i * 2)).toFixed(2)); });
  const sw = Math.sin(((tm / 1800) % 1) * Math.PI);
  place(mutWedge, 536 - 50 * sw, MCY, 0, 1);
  mutWedge.setAttribute("opacity", (0.25 + 0.75 * sw).toFixed(2));
  acc.mut += dt * 2.2;
  while (acc.mut >= 1) { acc.mut--; const p = free(mutSig); if (p) emit(p, MX + rnd(-6, 6), 336, rnd(8, 26), rnd(18, 34), 0); }
  mutSig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* organs: puffy eyes, cramping muscle, strained liver, rare heart touch, fading marrow */
  puff.setAttribute("opacity", (sm.Swell * 0.35).toFixed(2));
  bag.setAttribute("opacity", (sm.Swell * 0.75).toFixed(2));
  place(layers.mus, Math.sin(tm / 90) * 2.2 * sm.Cramp, Math.cos(tm / 130) * 1.6 * sm.Cramp, 0, 1);
  spasm.setAttribute("opacity", (sm.Cramp * (0.25 + 0.25 * Math.sin(tm / 90))).toFixed(2));
  livW.setAttribute("opacity", (sm.Liv * 0.45).toFixed(2));
  hrtW.setAttribute("opacity", (sm.Hrt * 2.2).toFixed(2));
  mcells.forEach((c) => c.setAttribute("opacity", (1 - 0.8 * sm.Mar).toFixed(2)));
  /* caption and gauges */
  const c = capText(m); if (capEl.textContent !== c) capEl.textContent = c;
  gg.kill.set(sm.Kill, wordOf(sm.Kill, 0.35, 0.7, ["none", "some", "high"]));
  gg.sw.set(sm.Swell, wordOf(sm.Swell, 0.25, 0.6, ["none", "some", "severe"]));
  gg.mar.set(sm.Mar, wordOf(sm.Mar, 0.25, 0.5, ["normal", "low", "very low"]));
  gg.liv.set(sm.Liv, wordOf(sm.Liv, 0.25, 0.55, ["normal", "raised", "high"]));
}
run({ init, step });
