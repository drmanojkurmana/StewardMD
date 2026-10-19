/* Vitamin deficiency scene: food and gut, cofactor work, target tissue and signs. */
const layers = { gutSlot: $("gutSlot"), targetSlot: $("targetSlot"), parts: $("parts"), over: $("over"), panel: $("panel"), badge: $("badge"), enz: $("enz"), blockG: $("blockG"), cofLetter: $("cofLetter"), cofForm: $("cofForm"), role1: $("role1"), role2: $("role2"), glow: $("signGlow"), haze: $("sickHaze"), signCard: $("signCard"), signName: $("signName"), signLine: $("signLine"), vesselFood: $("vesselFood"), vesselAbs: $("vesselAbs"), vesselRx: $("vesselRx"), vesselProd: $("vesselProd") };
const VIT = [
  { letter: "A", form: "Retinal and retinoic acid", r1: "Vision pigment and eye surface", r2: "Rod pigment, surface keeping", organ: "eye", tag: "Eye", vit: "vitamin A", tis: "the eye", res: "Eyesight returns.", sign: "Night blindness", line: "Dim light vision fails first", tinfo: "Eye: needs retinal for the vision pigment. Without it night vision fails.", sinfo: "Vitamin A lack: retinal for the vision pigment fails and the eye surface dries, giving night blindness and xerophthalmia." },
  { letter: "B1", form: "Thiamine pyrophosphate", r1: "Energy enzymes in nerve and heart", r2: "Pyruvate and keto acid steps", organ: "heart", tag: "Heart", vit: "thiamine", tis: "nerves and heart", res: "Nerves and heart recover.", sign: "Beriberi", line: "Numb feet and a weak heart", tinfo: "Heart and nerves: energy enzymes fail without thiamine.", sinfo: "Thiamine lack: energy enzymes fail, giving beriberi with nerve signs, heart failure or brain signs." },
  { letter: "B3", form: "NAD and NADP", r1: "Redox reactions in skin, gut, brain", r2: "Hydrogen carrying coenzymes", organ: "skin", tag: "Skin", vit: "niacin", tis: "skin and gut", res: "Skin and gut recover.", sign: "Pellagra", line: "Sun rash with diarrhoea", tinfo: "Skin and gut: redox reactions fail without niacin.", sinfo: "Niacin lack: NAD and NADP fall, giving pellagra with dermatitis, diarrhoea and dementia." },
  { letter: "B12", form: "Cobalamin cofactors", r1: "Methionine and methylmalonyl steps", r2: "Nerve, cord and marrow keeping", organ: "brain", tag: "Nerves", vit: "vitamin B12", tis: "nerves and cord", res: "Nerves and cord recover.", sign: "Neuropathy", line: "Tingling feet, unsteady walk", tinfo: "Nerves and cord: cofactor failure damages nerves.", sinfo: "Vitamin B12 lack: methionine and methylmalonyl steps fail, damaging cord and nerves and making large red cells." },
  { letter: "C", form: "Ascorbate", r1: "Collagen hydroxylation enzymes", r2: "Proline and lysine hydroxylation", organ: "vessel", tag: "Vessels", vit: "vitamin C", tis: "vessels and gums", res: "Vessels and gums recover.", sign: "Scurvy", line: "Bleeding gums, slow healing", tinfo: "Vessels and gums: weak collagen leaks without ascorbate.", sinfo: "Vitamin C lack: collagen hydroxylation fails, so collagen is weak and scurvy gives gum swelling and bleeding." },
  { letter: "D", form: "Calcitriol, active hormone", r1: "Gut calcium absorption", r2: "Bone mineralisation supply", organ: "joint", tag: "Bone", vit: "vitamin D", tis: "growing bone", res: "Growing bone recovers.", sign: "Rickets", line: "Soft bones that bow", tinfo: "Growing bone: needs calcium from gut absorption.", sinfo: "Vitamin D lack: calcium absorption falls and growing bone cannot mineralise, giving rickets." },
  { letter: "K", form: "Vitamin K cofactor", r1: "Clotting factor carboxylation", r2: "Factor activation in liver", organ: "liver", tag: "Clotting", vit: "vitamin K", tis: "clotting", res: "Clotting recovers.", sign: "Bleeding", line: "Blood that will not clot", tinfo: "Liver: makes clotting factors with vitamin K.", sinfo: "Vitamin K lack: the carboxylation cofactor for clotting factors fails, so clotting is weak and bleeding follows." },
];
/* ---- organs and tracks (ports anchor every vessel and particle path) ---- */
let gutO = null, targetO = null, targetPill = null, capEl = null, capKey = "";
let trFood = null, trAbs = null, trProd = null, trSink = null;
function initOrgans() {
  gutO = organ(layers.gutSlot, "intestine", 135, 300, 150, {});
  gutO.g.setAttribute("class", gutO.g.getAttribute("class") + " hot");
  gutO.g.setAttribute("tabindex", "0");
  gutO.g.setAttribute("data-info", "The gut absorbs vitamins. Fat soluble A, D and K need fat absorption.");
  const GP = gutO.ports;
  layers.vesselFood.setAttribute("d", "M95 166 L" + f1(GP.duodenum[0]) + " " + f1(GP.duodenum[1]));
  layers.vesselAbs.setAttribute("d", "M" + f1(GP.out[0]) + " " + f1(GP.out[1]) + " L386 162");
  trFood = track([[95, 166], [110, 200], GP.duodenum]);
  trAbs = track([[GP.out[0], GP.out[1]], [250, 300], [320, 220], [386, 162]]);
}
function buildTarget(kind, tinfo) {
  while (layers.targetSlot.firstChild) layers.targetSlot.removeChild(layers.targetSlot.firstChild);
  const cx = 750, cy = 215;
  if (kind === "eye") targetO = organ(layers.targetSlot, "eye", cx, cy, 170, { h: 148 });
  else if (kind === "heart") targetO = organ(layers.targetSlot, "heart", cx, cy, 120, { h: 168 });
  else if (kind === "skin") targetO = organ(layers.targetSlot, "skin", cx, cy, 170, { h: 170 });
  else if (kind === "brain") targetO = organ(layers.targetSlot, "brain", cx, cy, 170, { h: 136 });
  else if (kind === "vessel") targetO = organ(layers.targetSlot, "vessel", cx, cy, 70, { h: 178 });
  else if (kind === "joint") targetO = organ(layers.targetSlot, "joint", cx, cy, 140, { h: 140 });
  else targetO = organ(layers.targetSlot, "liver", cx, cy, 190, { h: 157 });
  const EP = targetO.ports.in, TC = [targetO.x, targetO.y];
  layers.vesselProd.setAttribute("d", "M444 270 L" + f1(EP[0]) + " " + f1(EP[1]));
  trProd = track([[444, 270], [(444 + EP[0]) / 2, (270 + EP[1]) / 2 - 12], EP]);
  trSink = track([EP, TC]);
  layers.glow.setAttribute("rx", f1(targetO.w / 2 + 35));
  layers.glow.setAttribute("ry", f1(targetO.h / 2 + 30));
  layers.haze.setAttribute("cx", f1(targetO.x));
  layers.haze.setAttribute("cy", f1(targetO.y));
  layers.haze.setAttribute("rx", f1(targetO.w * 0.34));
  layers.haze.setAttribute("ry", f1(targetO.h * 0.34));
  targetO.g.setAttribute("class", targetO.g.getAttribute("class") + " hot");
  targetO.g.setAttribute("tabindex", "0");
  targetO.g.setAttribute("data-info", tinfo);
  hotify(targetO.g);
}
function hotify(el) {
  const idle = "Hover or focus a labelled part for a one-line explanation.";
  const on = function () { info.textContent = el.dataset.info; el.classList.add("is-hot"); };
  const off = function () { info.textContent = idle; el.classList.remove("is-hot"); };
  el.addEventListener("pointerenter", on); el.addEventListener("pointerleave", off);
  el.addEventListener("focus", on); el.addEventListener("blur", off);
}
function movePill(g, x, y, tx, ty) {
  g.querySelector("path").setAttribute("d", "M" + f1(x) + " " + f1(y) + "L" + f1(tx) + " " + f1(ty + 8));
  const dot = g.querySelector("circle"); dot.setAttribute("cx", f1(x)); dot.setAttribute("cy", f1(y));
  const box = g.querySelector("rect"); box.setAttribute("x", f1(tx - parseFloat(box.getAttribute("width")) / 2)); box.setAttribute("y", f1(ty - 8));
  const t = g.querySelector("text"); t.setAttribute("x", f1(tx)); t.setAttribute("y", f1(ty + 4));
}
function placeTargetPill() {
  const top = targetO.y - targetO.h / 2;
  movePill(targetPill, 750, top - 2, 750, top - 24);
}
function capText(d, V) {
  if (d === 1) return "Replacement refills " + V.vit + ". " + V.res;
  if (d === 2) return "Better food slowly rebuilds " + V.vit + ".";
  if (d === 3) return "Fixing the gut cause restores " + V.vit + " uptake.";
  return "No treatment. Low " + V.vit + " harms " + V.tis + ".";
}
/* ---- particle pools (element is p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, st: 0, u: 0, t: 0, tr: null }; }); }
const vitP = pool(20, function () { return mk("circle", { class: "sc-p p-vit", r: 2.8 }, layers.parts); });
const cofP = pool(14, function () { return mk("circle", { class: "sc-p p-cof", r: 2.6 }, layers.parts); });
const prodP = pool(14, function () { return mk("circle", { class: "sc-p p-prod", r: 2.6 }, layers.parts); });
const dropP = pool(12, function () { return mk("circle", { class: "sc-p p-drop", r: 2.4 }, layers.parts); });
const treatP = pool(8, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4.4, y: -2.2, width: 8.8, height: 4.4, rx: 2.2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.2, width: 4.4, height: 4.4, rx: 2 }, g); return g; });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.st = 0; p.u = 0; p.t = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function rideTo(p, dt, speed) {
  p.u += dt * speed / Math.max(1, p.tr.len);
  const q = p.tr.at(Math.min(1, p.u));
  p.x = q.x; p.y = q.y;
  p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  return p.u >= 1;
}
function seekTo(p, dt, speed, tx, ty) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
  p.x += (dx / d) * speed * dt; p.y += (dy / d) * speed * dt;
  p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  return d < 10;
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [150, 380, 610, 840];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cof", "Cofactor", "g-cof", "Active cofactor supply for the vitamin shown. It falls when intake, absorption or stores fail, and rises with replacement, diet or treating malabsorption."], ["tiss", "Tissue function", "g-tiss", "How well the tissue that depends on this cofactor can work: eye, nerve, skin, marrow, collagen, bone or clotting."], ["syn", "Syndrome", "g-syn", "Severity of the named deficiency syndrome for the vitamin shown."], ["eff", "Treatment response", "g-eff", "How well the chosen treatment restores this vitamin. Replacement is direct, diet is slower, and treating malabsorption helps most when absorption was the fault."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Food", 95, 146, 95, 122, "Food is the usual source of most vitamins. Poor intake lowers supply.");
  pill(ox, "Replacement", 185, 130, 188, 108, "Replacement gives the missing vitamin directly. It restores the cofactor fastest in this teaching model.");
  const gt = gutO.y - gutO.h / 2;
  pill(ox, "Gut", gutO.x - 25, gt + 10, gutO.x - 25, gt - 12, "The gut absorbs vitamins. Fat soluble A, D and K need fat absorption.");
  pill(ox, "Blocked gut", 205, 284, 180, 260, "A gut cause blocks uptake. Treating the cause restores absorption.");
  pill(ox, "Active cofactor", 408, 138, 408, 118, "The active form of the vitamin shown. Its name and job change with the slider.");
  pill(ox, "Enzyme step", 408, 244, 408, 224, "The body step that needs this cofactor. Without it the product falls.");
  targetPill = pill(ox, "Clotting", 750, 191, 750, 169, VIT[6].tinfo);
  capEl = mk("text", { class: "vd-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, VIT[1]);
}
const sm = { Cof: 0.3, Syn: 0.7, Tiss: 0.3, eff: 0, mal: 0, rx: 0, diet: 0 };
const acc = { vit: 0, cof: 0, prod: 0, drop: 0, treat: 0 };
let shownIdx = -1;
function init() { initOrgans(); buildTarget(VIT[1].organ, VIT[1].tinfo); initPanel(); placeTargetPill(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 0.9);
  sm.Cof = lerp(sm.Cof, m.Cof, kk); sm.Syn = lerp(sm.Syn, m.Syn, kk); sm.Tiss = lerp(sm.Tiss, m.Tiss, kk); sm.eff = lerp(sm.eff, m.eff, kk);
  sm.mal = lerp(sm.mal, m.drug === 3 ? 1 : 0, kk); sm.rx = lerp(sm.rx, m.drug === 1 ? 1 : 0, kk); sm.diet = lerp(sm.diet, m.drug === 2 ? 1 : 0, kk);
  if (shownIdx !== m.t) {
    shownIdx = m.t;
    const V = VIT[m.t];
    layers.cofLetter.textContent = V.letter; layers.cofForm.textContent = V.form; layers.role1.textContent = V.r1; layers.role2.textContent = V.r2;
    layers.signName.textContent = V.sign; layers.signLine.textContent = V.line;
    layers.signCard.setAttribute("data-info", V.sinfo);
    buildTarget(V.organ, V.tinfo);
    targetPill.querySelector("text").textContent = V.tag;
    targetPill.setAttribute("data-info", V.tinfo);
    placeTargetPill();
    capKey = "";
  }
  layers.badge.setAttribute("r", f1(13 + 11 * sm.Cof));
  layers.badge.setAttribute("opacity", (0.55 + 0.45 * sm.Cof).toFixed(2));
  const es = 0.72 + 0.38 * sm.Cof;
  layers.enz.setAttribute("transform", "translate(408 270) scale(" + es.toFixed(3) + ") translate(-408 -270)");
  layers.enz.setAttribute("opacity", (0.5 + 0.5 * sm.Cof).toFixed(2));
  layers.blockG.setAttribute("opacity", (1 - 0.92 * sm.mal).toFixed(2));
  layers.glow.setAttribute("opacity", (0.5 * sm.Syn).toFixed(2));
  layers.haze.setAttribute("opacity", (0.38 * sm.Syn).toFixed(2));
  const flAbs = clamp(sm.Cof * (sm.mal ? 1 : 0.55) + 0.08);
  layers.vesselFood.setAttribute("stroke-width", f1(4 + 5 * (0.3 + 0.5 * sm.Cof + 0.4 * sm.diet)));
  layers.vesselFood.setAttribute("opacity", (0.3 + 0.5 * clamp(sm.Cof + sm.diet)).toFixed(2));
  layers.vesselAbs.setAttribute("stroke-width", f1(4 + 8 * flAbs));
  layers.vesselAbs.setAttribute("opacity", (0.3 + 0.6 * flAbs).toFixed(2));
  layers.vesselRx.setAttribute("stroke-width", f1(3 + 6 * sm.rx));
  layers.vesselRx.setAttribute("opacity", (0.08 + 0.9 * sm.rx).toFixed(2));
  layers.vesselProd.setAttribute("stroke-width", f1(4 + 8 * sm.Tiss));
  layers.vesselProd.setAttribute("opacity", (0.3 + 0.6 * sm.Tiss).toFixed(2));
  /* food to gut, then gut to cofactor unless the gut cause blocks it */
  const blockFrac = 0.55 * (1 - sm.mal);
  acc.vit += dt * (1.2 + 5 * sm.Cof + 4 * sm.diet);
  while (acc.vit >= 1) { acc.vit--; const p = freeP(vitP); if (p) { emit(p, 95, 166); p.tr = trFood; } }
  vitP.forEach(function (p) {
    if (!p.on || !p.tr) return;
    if (rideTo(p, dt, 90)) {
      if (p.tr === trFood) {
        if (Math.random() < blockFrac) kill(p);
        else { p.tr = trAbs; p.u = 0; }
      } else kill(p);
    }
  });
  /* cofactor sparks: badge down to the enzyme step */
  acc.cof += dt * (1 + 7 * sm.Cof);
  while (acc.cof >= 1) { acc.cof--; const p = freeP(cofP); if (p) emit(p, 408 + rnd(-8, 8), 182); }
  cofP.forEach(function (p) { if (!p.on) return; if (seekTo(p, dt, 74, 408, 244)) kill(p); });
  /* product: enzyme to target tissue entry, then into the tissue */
  acc.prod += dt * (1 + 7 * sm.Tiss);
  while (acc.prod >= 1) { acc.prod--; const p = freeP(prodP); if (p) { emit(p, 444, 270); p.tr = trProd; } }
  prodP.forEach(function (p) {
    if (!p.on || !p.tr) return;
    if (rideTo(p, dt, 95)) {
      if (p.tr === trProd) { p.tr = trSink; p.u = 0; }
      else kill(p);
    }
  });
  /* syndrome signs dripping off the sick tissue */
  acc.drop += dt * sm.Syn * 5.5;
  while (acc.drop >= 1) { acc.drop--; const p = freeP(dropP); if (p) emit(p, 750 + rnd(-50, 50), targetO.y + targetO.h / 2 - 4); }
  dropP.forEach(function (p) {
    if (!p.on) return;
    p.t += dt; p.y += 42 * dt;
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 590, 920)) + " " + f1(clamp(p.y, 52, 424)) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2));
    if (p.t > 0.9) kill(p);
  });
  /* replacement capsules: bottle to the badge */
  acc.treat += dt * sm.rx * 5;
  while (acc.treat >= 1) { acc.treat--; const p = freeP(treatP); if (p) emit(p, 185, 174); }
  treatP.forEach(function (p) {
    if (!p.on) return;
    p.t += dt;
    if (seekTo(p, dt, 95, 392, 160)) { kill(p); return; }
    p.e.setAttribute("opacity", "1");
  });
  /* gauges */
  gg.cof.set(sm.Cof, wordOf(sm.Cof, 0.35, 0.65, ["low", "reduced", "working"])); gg.tiss.set(sm.Tiss, wordOf(sm.Tiss, 0.35, 0.65, ["impaired", "reduced", "preserved"]));
  gg.syn.set(sm.Syn, wordOf(sm.Syn, 0.30, 0.60, ["mild", "moderate", "severe"])); gg.eff.set(sm.eff, wordOf(sm.eff, 0.35, 0.65, ["none", "partial", "strong"]));
  const key = drug + ":" + m.t;
  if (key !== capKey) { capKey = key; const t = capText(drug, VIT[m.t]); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
