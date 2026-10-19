/* Renal filtration scene: kidney locator, inlet and outlet arterioles, glomerular tuft, filter wall, Bowman space, tubule, macula densa feedback, docking drug tablets and gauges. */
const WW = SC.W;
const layers = { vess: $("vess"), caps: $("caps"), tub: $("tub"), arrows: $("arrows"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = {};
let kidneyO = null, capEl = null, capKey = "";
/* tablet docking sites on the vessel walls: prostaglandin sites on the inlet, angiotensin sites on the outlet */
const AFFS = [[140, 221], [220, 249], [300, 221]];
const EFFS = [[650, 249], [740, 221], [830, 249]];
function capText(l, d) {
  if (l === 0 && d === 0) return "No treatment. The inlet vessel is tight, so little pressure reaches the filter.";
  if (l === 0 && d === 1) return "NSAID tablets sit on the inlet wall. The inlet narrows further and filtering falls further.";
  if (l === 0) return "ACE inhibitor tablets sit on the outlet wall. Flow rises but filtering stays low.";
  if (l === 1 && d === 0) return "No treatment. Inlet and outlet are balanced, so filtering sits in the middle.";
  if (l === 1 && d === 1) return "NSAID tablets sit on the inlet wall. The inlet narrows and filtering falls.";
  if (l === 1) return "ACE inhibitor tablets sit on the outlet wall. The outlet opens and pressure eases.";
  if (l === 2 && d === 0) return "No treatment. The outlet is tight, so pressure builds and filtering runs high.";
  if (l === 2 && d === 1) return "NSAID tablets sit on the inlet wall. Less blood arrives, so filtering drops.";
  return "ACE inhibitor tablets sit on the tight outlet. It opens and built up pressure eases.";
}
function initOrgans() {
  kidneyO = organ($("kidneySlot"), "kidney", 872, 108, 100, { h: 110 });
}
function initStage() {
  E.washA = mk("rect", { class: "gf-washA", x: 36, y: 204, width: 348, height: 62, rx: 16, opacity: "0" }, layers.vess);
  E.washE = mk("rect", { class: "gf-washE", x: 580, y: 204, width: 352, height: 62, rx: 16, opacity: "0" }, layers.vess);
  E.aff = mk("path", { class: "gf-vess", d: "M28 235H394", "stroke-width": 24, fill: "none" }, layers.vess);
  E.affIn = mk("path", { class: "gf-vessin", d: "M28 235H394", "stroke-width": 16, fill: "none" }, layers.vess);
  E.eff = mk("path", { class: "gf-vess", d: "M566 235H932", "stroke-width": 15, fill: "none" }, layers.vess);
  E.effIn = mk("path", { class: "gf-vessin", d: "M566 235H932", "stroke-width": 8, fill: "none" }, layers.vess);
  mk("circle", { class: "gf-caps", cx: 480, cy: 235, r: 92 }, layers.caps);
  E.glow = mk("ellipse", { class: "gf-glow", cx: 480, cy: 235, rx: 68, ry: 68, opacity: "0.25" }, layers.caps);
  E.tuft = mk("g", {}, layers.caps);
  mk("circle", { class: "gf-tuft", cx: 480, cy: 235, r: 58 }, E.tuft);
  mk("path", { class: "gf-coil", d: "M445 205q35 -22 70 0q-35 20 -70 0M442 248q38 24 76 0q-38 -20 -76 0M462 192q-14 43 6 84M498 192q14 43 -6 84", fill: "none" }, E.tuft);
  mk("path", { class: "gf-bar1", d: "M453.8 291.2A62 62 0 0 0 420.1 251", fill: "none" }, layers.caps);
  mk("path", { class: "gf-bar2", d: "M449.5 298.5A69 69 0 0 0 413.2 252.4", fill: "none" }, layers.caps);
  mk("path", { class: "gf-bar3", d: "M445.2 305.8A76 76 0 0 0 406.3 253.8", fill: "none" }, layers.caps);
  mk("path", { class: "gf-tubw", d: "M480 327C480 362 505 378 560 378H892", "stroke-width": 17, fill: "none" }, layers.tub);
  E.tubL = mk("path", { class: "gf-tubl", d: "M480 327C480 362 505 378 560 378H892", "stroke-width": 8, fill: "none" }, layers.tub);
  mk("path", { class: "gf-tubw", d: "M248 162C300 184 352 200 396 208", "stroke-width": 13, fill: "none" }, layers.tub);
  mk("path", { class: "gf-tubl", d: "M248 162C300 184 352 200 396 208", "stroke-width": 7, fill: "none" }, layers.tub);
  E.mdots = [];
  [[352, 199], [366, 204], [380, 208], [392, 211]].forEach(([x, y]) => E.mdots.push(mk("circle", { class: "gf-mdot", cx: x, cy: y, r: 4.2 }, layers.tub)));
  E.fb = mk("path", { class: "gf-fb", d: "M378 214C366 222 360 226 356 232", fill: "none" }, layers.arrows);
  E.aPgc = mk("line", { class: "gf-arr-pgc", x1: 480, y1: 235, x2: 480, y2: 200 }, layers.arrows);
  E.aOnc = mk("line", { class: "gf-arr-onc", x1: 434, y1: 281, x2: 452, y2: 263 }, layers.arrows);
  E.aPbc = mk("line", { class: "gf-arr-pbc", x1: 532, y1: 188, x2: 514, y2: 206 }, layers.arrows);
  E.dPgc = mk("circle", { class: "p-pg", cx: 480, cy: 200, r: 3.4 }, layers.arrows);
  E.dOnc = mk("circle", { class: "p-ang", cx: 452, cy: 263, r: 3.4 }, layers.arrows);
  E.dPbc = mk("circle", { cx: 514, cy: 206, r: 3.4, fill: "var(--c-pbc)" }, layers.arrows);
  E.recA = AFFS.map(([x, y]) => mk("circle", { class: "gf-recA", cx: x, cy: y, r: 4.5, fill: "none", opacity: "0.55" }, layers.arrows));
  E.recE = EFFS.map(([x, y]) => mk("circle", { class: "gf-recE", cx: x, cy: y, r: 4.5, fill: "none", opacity: "0.55" }, layers.arrows));
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, st: 0, si: 0, side: 0 }; }); }
const filt = pool(30, () => mk("circle", { class: "p-filt2", r: 2.2 }, layers.parts));
const pgP = pool(8, () => mk("circle", { class: "p-pg", r: 2.6 }, layers.parts));
const angP = pool(8, () => mk("circle", { class: "p-ang", r: 2.6 }, layers.parts));
const tabs = pool(8, () => mk("rect", { class: "p-tab", x: -6, y: -3.5, width: 12, height: 7, rx: 3.5 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const bloodTrack = track([[20, 235], [394, 235], [430, 219], [480, 235], [530, 219], [566, 235], [940, 235]]);
const filtTrack = track([[508, 288], [480, 330], [482, 376], [560, 378], [892, 378]]);
const rbcs = [];
function initBlood() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 7.5, ry: 4.4 }, g); mk("ellipse", { class: "cl-s", rx: 2.8, ry: 1.4 }, g); rbcs.push({ g, u: i / 16, v: rnd(0.85, 1.15) }); } }
/* ---- drug tablets ride the blood in, dock on their wall sites, and wash out when treatment stops ---- */
function freeSite(side) {
  for (let i = 0; i < 3; i++) {
    let used = false;
    tabs.forEach((o) => { if (o.on && o.st !== 3 && o.side === side && o.si === i) used = true; });
    if (!used) return i;
  }
  return -1;
}
function stepTabs(dt) {
  if (drug) {
    acc.tab += dt * 3.2;
    while (acc.tab >= 1) {
      acc.tab--;
      const side = drug - 1, si = freeSite(side), tb = si >= 0 && free(tabs);
      if (!tb) { acc.tab = 0; break; }
      emit(tb, 24, 235, 0, 0); tb.st = 0; tb.side = side; tb.si = si;
    }
  } else acc.tab = 0;
  tabs.forEach((tb) => {
    if (!tb.on) return;
    if (!drug || tb.side !== drug - 1) { if (tb.st !== 3) { tb.st = 3; tb.t = 0; } }
    if (tb.st === 0) {
      tb.x += 110 * dt; tb.y = 235 + Math.sin(tm / 300 + tb.x * 0.2) * 4;
      place(tb.e, tb.x, tb.y, 0, 1);
      const tp = (tb.side ? EFFS : AFFS)[tb.si];
      if (tb.x >= tp[0] - 70) tb.st = 1;
    } else if (tb.st === 1) {
      const tp = (tb.side ? EFFS : AFFS)[tb.si];
      const dx = tp[0] - tb.x, dy = tp[1] - tb.y, d = Math.hypot(dx, dy);
      if (d < 9) tb.st = 2;
      else { tb.x += dx / d * 150 * dt; tb.y += dy / d * 150 * dt; }
      place(tb.e, tb.x, tb.y, 0, 1);
    } else if (tb.st === 2) {
      const tp = (tb.side ? EFFS : AFFS)[tb.si];
      place(tb.e, tp[0], tp[1], 0, 1);
    } else {
      tb.t += dt; tb.y += 34 * dt;
      tb.e.setAttribute("opacity", clamp(1 - tb.t).toFixed(2));
      place(tb.e, tb.x, tb.y, tb.t * 50, 1);
      if (tb.t >= 1) kill(tb);
    }
  });
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, xs = [95, 245, 395, 545, 695, 845];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Pressures and flows";
  [["pgc", "Glom pressure", "g-pgc", "Glomerular capillary hydrostatic pressure. It pushes fluid out of the capillary and favours filtration. It rises when the efferent arteriole tightens and falls when the afferent arteriole tightens."],
    ["pbc", "Bowman press.", "g-pbc", "Bowman capsule pressure. Fluid already in Bowman space pushes back against more filtration. It changes little here."],
    ["onc", "Oncotic press.", "g-onc", "Oncotic pressure from plasma proteins. It holds water in the capillary and opposes filtration. It rises as protein free filtrate leaves and the blood left behind concentrates."],
    ["gfr", "Filtration", "g-good", "Glomerular filtration rate: how much filtrate the glomeruli make. It follows the net filtration pressure and the plasma flow."],
    ["rpf", "Plasma flow", "g-fl", "Renal plasma flow through the glomerulus. Tightening either arteriole lowers it, even when the two have opposite effects on pressure."],
    ["ff", "Filt. fraction", "g-clot", "Filtration fraction: the share of arriving plasma that becomes filtrate. It rises when the efferent arteriole tightens, because pressure rises while flow falls."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, 52, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Afferent in", 200, 235, 200, 168, "Afferent arteriole: blood enters the glomerulus here. When it tightens, less pressure reaches the tuft and filtration falls. Prostaglandins help keep it open when perfusion is low.");
  pill(ox, "Efferent out", 750, 235, 750, 168, "Efferent arteriole: blood leaves the glomerulus here. When it tightens, pressure builds up in the tuft and filtration is held up, but plasma flow falls. Angiotensin II tightens it.");
  pill(ox, "Glomerulus", 480, 180, 480, 118, "Glomerulus: a tuft of capillaries where filtration happens. Its pressure pushes filtrate out across the filter wall of endothelium, basement membrane and podocytes.");
  pill(ox, "Bowman space", 548, 292, 648, 340, "Bowman space: the cup around the tuft that collects the filtrate. Pressure here pushes back against filtration.");
  pill(ox, "Filter layers", 438, 288, 330, 340, "Filtration barrier: capillary endothelium, basement membrane and podocytes in layers. Water and small solutes cross; cells and most protein stay in the blood.");
  pill(ox, "Tubule", 700, 378, 770, 416, "Tubule: the filtrate flows on from Bowman space and is reworked along the tubule before leaving as urine.");
  pill(ox, "Macula densa", 372, 203, 300, 118, "Macula densa: distal tubule cells that pass the arteriole pole and sense sodium chloride delivery. High delivery signals the afferent arteriole to tighten; low delivery lets it relax.");
  pill(ox, "Kidney", 890, 105, 878, 58, "Kidney: this scene magnifies one glomerulus from the kidney cortex, where blood is first filtered.");
  capEl = mk("text", { class: "gf-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { Pgc: 0.55, Pbc: 0.36, Onc: 0.41, GFR: 0.6, RPF: 0.7, FF: 0.59, affCal: 0.63, effCal: 0.63, PG: 0.75, Ang: 0.5, nsaid: 0, acei: 0, TGF: 0.6 };
const KEYS = Object.keys(sm);
const acc = { filt: 0, tab: 0 };
function init() { initOrgans(); initStage(); initBlood(); initPanel(); pgP.forEach((p, i) => emit(p, 110 + i * 30, i % 2 ? 216 : 254, rnd(4, 9), 0)); angP.forEach((p, i) => emit(p, 620 + i * 32, i % 2 ? 216 : 254, rnd(4, 9), 0)); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  /* arteriole calibre follows tone and treatment: the change is large on purpose so it reads at a glance */
  const affW = 5 + 30 * sm.affCal, effW = 5 + 28 * sm.effCal;
  E.aff.setAttribute("stroke-width", f1(affW)); E.affIn.setAttribute("stroke-width", f1(Math.max(3, affW - 8)));
  E.eff.setAttribute("stroke-width", f1(effW)); E.effIn.setAttribute("stroke-width", f1(Math.max(3, effW - 7)));
  /* treatment highlight bands mark where each drug acts */
  E.washA.setAttribute("opacity", (0.22 * sm.nsaid).toFixed(2));
  E.washE.setAttribute("opacity", (0.22 * sm.acei).toFixed(2));
  /* pressure glow in the tuft follows glomerular pressure */
  E.glow.setAttribute("opacity", (0.04 + 0.5 * sm.Pgc).toFixed(2));
  E.glow.setAttribute("rx", f1(58 + 22 * sm.Pgc)); E.glow.setAttribute("ry", f1(58 + 22 * sm.Pgc));
  E.tuft.setAttribute("transform", "translate(480 235) scale(" + (1 + 0.05 * sm.Pgc * Math.sin(tm / 500)).toFixed(3) + ") translate(-480 -235)");
  /* opposing pressure arrows: hydrostatic out, oncotic and Bowman in */
  const lP = 14 + 52 * sm.Pgc, lO = 10 + 40 * sm.Onc, lB = 10 + 40 * sm.Pbc;
  E.aPgc.setAttribute("y2", f1(235 - lP)); E.dPgc.setAttribute("cy", f1(235 - lP));
  E.aOnc.setAttribute("x2", f1(434 + lO * 0.707)); E.aOnc.setAttribute("y2", f1(281 - lO * 0.707)); E.dOnc.setAttribute("cx", f1(434 + lO * 0.707)); E.dOnc.setAttribute("cy", f1(281 - lO * 0.707));
  E.aPbc.setAttribute("x2", f1(532 - lB * 0.707)); E.aPbc.setAttribute("y2", f1(188 + lB * 0.707)); E.dPbc.setAttribute("cx", f1(532 - lB * 0.707)); E.dPbc.setAttribute("cy", f1(188 + lB * 0.707));
  /* macula densa senses filtrate delivery; feedback signal follows it */
  E.mdots.forEach((d) => d.setAttribute("opacity", (0.35 + 0.65 * sm.TGF).toFixed(2)));
  E.fb.setAttribute("opacity", (0.2 + 0.75 * sm.TGF).toFixed(2));
  /* red cells ride blood in, through the tuft, and out; speed follows plasma flow */
  rbcs.forEach((r) => { r.u += dt * 0.055 * r.v * (0.3 + sm.RPF); if (r.u > 1) r.u -= 1; const q = bloodTrack.at(r.u); place(r.g, q.x, q.y, q.a, 1); });
  /* filtrate crosses into Bowman space and flows along the tubule; the stream thins as filtration falls */
  E.tubL.setAttribute("stroke-width", f1(3 + 9 * sm.GFR));
  acc.filt += dt * sm.GFR * 9; while (acc.filt >= 1) { acc.filt--; const p = free(filt); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  filt.forEach((p) => { if (!p.on) return; p.u += dt * 0.14 * (0.4 + sm.GFR); if (p.u >= 1) { kill(p); return; } const q = filtTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x + Math.sin(p.u * 40) * 2) + " " + f1(q.y) + ")"); });
  /* prostaglandin support at the inlet, angiotensin signal at the outlet; each fades when its drug sits on the wall */
  pgP.forEach((p) => { p.x += p.vx * dt; if (p.x > 330) p.x = 100; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 400 + p.x) * 2) + ")"); p.e.setAttribute("opacity", sm.PG.toFixed(2)); });
  angP.forEach((p) => { p.x += p.vx * dt; if (p.x > 880) p.x = 610; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.cos(tm / 400 + p.x) * 2) + ")"); p.e.setAttribute("opacity", sm.Ang.toFixed(2)); });
  stepTabs(dt);
  /* a ring lights up while a tablet sits on it */
  E.recA.forEach((r, i) => r.setAttribute("opacity", tabs.some((o) => o.on && o.st === 2 && o.side === 0 && o.si === i) ? "1" : "0.55"));
  E.recE.forEach((r, i) => r.setAttribute("opacity", tabs.some((o) => o.on && o.st === 2 && o.side === 1 && o.si === i) ? "1" : "0.55"));
  /* gauges */
  gg.pgc.set(sm.Pgc, wordOf(sm.Pgc, 0.48, 0.60, ["low", "normal", "high"]));
  gg.pbc.set(sm.Pbc, wordOf(sm.Pbc, 0.35, 0.65, ["low", "normal", "high"]));
  gg.onc.set(sm.Onc, wordOf(sm.Onc, 0.35, 0.65, ["low", "normal", "high"]));
  gg.gfr.set(sm.GFR, sm.GFR < 0.32 ? "very low" : wordOf(sm.GFR, 0.42, 0.62, ["low", "normal", "high"]));
  gg.rpf.set(sm.RPF, wordOf(sm.RPF, 0.60, 0.78, ["low", "normal", "high"]));
  gg.ff.set(sm.FF, wordOf(sm.FF, 0.52, 0.72, ["low", "normal", "high"]));
  const capK = level + ":" + drug;
  if (capK !== capKey) { capKey = capK; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
