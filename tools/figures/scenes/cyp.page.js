/* CYP scene: parent drug cleared by liver CYP enzymes; an inducer grows extra enzyme, an inhibitor plugs it. */
const WW = SC.W;
const layers = { liver: $("liverSlot"), cyp: $("cypnodes"), parts: $("parts"), rbcs: $("rbcs"), over: $("over"), panel: $("panel") };
let liverO = null, capEl = null, capDrug = -1;
let liverLeft = 330, liverRight = 539, liverCX = 430, liverCY = 205;
/* five working enzymes plus two reserve enzymes that only appear with an inducer */
const NX = 5;
const cypNodes = [];
function initOrgans() {
  liverO = organ(layers.liver, "liver", 430, 205, 320, {});
  liverCX = liverO.x; liverCY = liverO.y;
  liverLeft = Math.round(liverO.x - liverO.w * 0.30);
  liverRight = Math.round(liverO.x + liverO.w * 0.34);
  const P = liverO.ports, hv = P.hepvein;
  $("vesselIn").setAttribute("d", "M24 302 L" + f1(P.lobe[0]) + " " + f1(P.lobe[1]));
  $("vesselOut").setAttribute("d", "M" + f1(hv[0]) + " " + f1(hv[1])
    + " C" + f1(hv[0] + 160) + " " + f1(hv[1] - 5) + " " + f1(hv[0] + 260) + " " + f1(hv[1] + 65) + " " + f1(hv[0] + 342) + " " + f1(hv[1] + 155)
    + " C" + f1(hv[0] + 402) + " " + f1(hv[1] + 215) + " " + f1(hv[0] + 462) + " " + f1(hv[1] + 265) + " 936 380");
  for (let i = 0; i < NX + 2; i++) {
    const main = i < NX;
    const x = main ? liverCX + (i - 2) * 48 : liverCX + (i === NX ? -48 : 48);
    const y = main ? (i % 2 ? liverCY - 10 : liverCY + 16) : liverCY + 62;
    const g = mk("g", {}, layers.cyp);
    mk("circle", { class: "cy-cyp", r: 17, cx: 0, cy: 0 }, g);
    mk("circle", { class: "cy-cypin", r: 7, cx: -3, cy: -3 }, g);
    const plug = mk("g", { opacity: "0" }, g);
    mk("rect", { class: "cy-inh", x: -13, y: -5, width: 26, height: 10, rx: 5 }, plug);
    if (!main) g.setAttribute("opacity", "0");
    place(g, x, y, 0, 1);
    cypNodes.push({ g: g, plug: plug, x: x, y: y, extra: !main });
  }
}
function capText(d) {
  if (d === 1) return "Inducer added. Extra enzyme clears the drug faster. Drug level falls.";
  if (d === 2) return "Inhibitor added. Plugged enzyme cannot clear the drug. Level rises and harm follows.";
  return "No interaction. Liver enzymes clear the drug at the usual speed.";
}
/* ---- red cells in the bloodstream ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g: g, x: rnd(0, WW), y: rnd(368, 402), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const parents = pool(22, function () { return mk("circle", { class: "sc-p p-parent", r: 5 }, layers.parts); });
const mets = pool(22, function () { return mk("path", { class: "sc-p p-met", d: "M0 -5L5 0L0 5L-5 0Z" }, layers.parts); });
const inds = pool(12, function () { return mk("path", { class: "sc-p p-ind", d: "M0 -5L5 4L-5 4Z" }, layers.parts); });
const inhs = pool(10, function () { return mk("rect", { class: "sc-p p-inh", x: -5, y: -3, width: 10, height: 6, rx: 3 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["enz", "Enzyme", "g-enz", "CYP enzyme activity. Inducers raise it, inhibitors block it."], ["clr", "Clearance", "g-clr", "How fast the parent drug is changed and removed."], ["lev", "Drug level", "g-lev", "Parent drug level in the blood."], ["eff", "Effect", "g-eff", "Effect of the parent drug. It follows the drug level."], ["tox", "Toxicity", "g-tox", "Harm from too much parent drug. Inhibitors raise it."], ["pro", "Prodrug", "g-pro", "Some drugs need CYP to become active. Blocked enzyme means less active drug."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Liver", 450, 140, 545, 80, "Liver. Most drug oxidation by cytochrome P450 happens in liver cells.");
  pill(ox, "CYP enzymes", 430, 221, 360, 106, "CYP enzymes. They change the parent drug into a metabolite.");
  pill(ox, "Parent drug", 170, 280, 110, 340, "Parent drug arriving in the blood, before the liver changes it.");
  pill(ox, "Metabolite", 505, 344, 560, 320, "Metabolite leaving the liver in the blood for removal.");
  pill(ox, "Blood", 870, 385, 880, 320, "Bloodstream. It carries parent drug in and metabolite out.");
  pill(ox, "Inducer", 110, 303, 205, 80, "Inducer. It makes the liver build extra CYP enzyme.");
  pill(ox, "Inhibitor", 700, 385, 760, 106, "Inhibitor. It plugs CYP enzyme so the drug builds up.");
  capEl = mk("text", { class: "cy-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { E: 0.5, Clear: 0.5, Lev: 0.52, Tox: 0.18, Prod: 0.48, ind: 0, inh: 0 };
const acc = { par: 0, ind: 0, inh: 0 };
function init() { initOrgans(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k2); sm.Clear = lerp(sm.Clear, m.Clear, k2); sm.Lev = lerp(sm.Lev, m.Lev, k1); sm.Tox = lerp(sm.Tox, m.Tox, k2); sm.Prod = lerp(sm.Prod, m.Prod, k2); sm.ind = lerp(sm.ind, m.ind, k1); sm.inh = lerp(sm.inh, m.inh, k1);
  /* enzymes grow with activity; plugs lock on with inhibitor; reserve enzymes appear with inducer */
  cypNodes.forEach(function (c, i) {
    const s = 0.65 + 0.6 * sm.E + 0.05 * Math.sin(tm / 400 + i);
    place(c.g, c.x, c.y, Math.sin(tm / 900 + i) * 5, Math.max(0.2, s));
    c.plug.setAttribute("opacity", sm.inh.toFixed(2));
    if (c.extra) c.g.setAttribute("opacity", sm.ind.toFixed(2));
  });
  /* bloodstream shows the drug level as an orange wash and toxicity as a red glow */
  $("bloodTint").setAttribute("opacity", (sm.Lev * 0.4).toFixed(2));
  $("toxGlow").setAttribute("opacity", (sm.Tox * 0.55).toFixed(2));
  /* red cells flow in the vessel */
  rbcs.forEach(function (r) { r.x += r.v * 55 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(368, 402); } place(r.g, r.x, r.y, r.rot, 1); });
  /* parent drug flows in from the left; inside the liver it is converted or escapes uncleared */
  acc.par += dt * 1.8; while (acc.par >= 1) { acc.par--; const p = freeP(parents); if (p) emit(p, 24, rnd(290, 314), rnd(52, 68), 0, 0); }
  parents.forEach(function (p) {
    if (!p.on) return; p.t += dt;
    if (p.k === 2) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y >= 384) { p.y = 384; p.vy = 0; p.vx = 72; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (p.x > WW - 16 || p.t > 14) kill(p); return;
    }
    p.x += p.vx * dt; p.y += Math.sin(tm / 500 + p.t * 2) * 4 * dt; p.y = clamp(p.y, 120, 340);
    if (p.x > liverLeft && p.x < liverRight && Math.random() < dt * sm.Clear * 2.2) { const q = freeP(mets); if (q) emit(q, p.x, p.y, rnd(18, 30), rnd(34, 48), 0); kill(p); return; }
    if (p.x >= liverRight) { p.k = 2; p.vx = 60; p.vy = 46; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x > WW - 20) kill(p);
  });
  /* metabolites drift down to the vessel, then flow away */
  mets.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 382) { p.y = 382; p.vy = 0; p.vx = 70; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > WW - 16 || p.t > 9) kill(p); });
  /* inducer molecules arrive in the blood and switch on extra enzyme */
  acc.ind += dt * sm.ind * 4; while (acc.ind >= 1) { acc.ind--; const p = freeP(inds); if (p) emit(p, rnd(40, 150), rnd(288, 318), 0, 0, Math.floor(Math.random() * NX)); }
  inds.forEach(function (p) { if (!p.on) return; const c = cypNodes[p.k], dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 55 * dt; p.y += (dy / d) * 55 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 16) kill(p); });
  /* inhibitor molecules rise from the blood and plug the enzymes */
  acc.inh += dt * sm.inh * 3; while (acc.inh >= 1) { acc.inh--; const p = freeP(inhs); if (p) emit(p, rnd(600, 780), rnd(368, 400), 0, 0, Math.floor(Math.random() * NX)); }
  inhs.forEach(function (p) { if (!p.on) return; const c = cypNodes[p.k], dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 50 * dt; p.y += (dy / d) * 50 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 14) kill(p); });
  /* gauges */
  gg.enz.set(sm.E, wordOf(sm.E, 0.3, 0.65, ["blocked", "usual", "high"])); gg.clr.set(sm.Clear, wordOf(sm.Clear, 0.3, 0.65, ["slow", "usual", "fast"])); gg.lev.set(sm.Lev, wordOf(sm.Lev, 0.3, 0.65, ["low", "usual", "high"]));
  gg.eff.set(sm.Lev, wordOf(sm.Lev, 0.3, 0.65, ["reduced", "usual", "excessive"])); gg.tox.set(sm.Tox, wordOf(sm.Tox, 0.3, 0.6, ["low", "some", "high"])); gg.pro.set(sm.Prod, wordOf(sm.Prod, 0.3, 0.65, ["low", "usual", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
