/* Acne scene: sebaceous gland, sebum flow, keratin plug, C. acnes, inflammation and lesion gauges. */
const layers = { glandSlot: $("glandSlot"), halo: $("halo"), plug: $("plug"), lesion: $("lesion"), bac: $("bac"), rbcs: $("rbcs"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
let capEl = null, capLevel = -1, capDrug = -1, gsNow = 1, paleOn = false;
const DUCT = [466, 250];
/* ---- sebaceous gland: grapelike alveoli feeding one short duct into the follicle ---- */
const glandG = mk("g", {}, layers.glandSlot);
mk("path", { class: "sc-sebduct", d: "M430 242 L462 242 C466 242 466 258 462 258 L430 258 C426 258 426 242 430 242 Z" }, glandG);
const lobes = [[392, 218], [362, 238], [398, 252], [368, 272], [410, 282], [410, 250]].map(function (pt, i) {
  const g = cell(glandG, { cls: "seb", r: 19, nuc: 0.3, seed: i * 2 + 1, wob: 0.14 });
  return { g: g, x: pt[0], y: pt[1] };
});
function capText(d) {
  if (d === 1) return "Retinoid loosens the plug. Oil drains out and the bump flattens.";
  if (d === 2) return "Antibiotic lowers the germs. Redness and swelling fade away.";
  if (d === 3) return "Isotretinoin shrinks the oil gland. Oil, germs and swelling all fall.";
  return "No treatment. Oil and plug build up, germs multiply, the spot swells.";
}
/* ---- plug, lesion dome, pustule head, deep nodule, scar ---- */
const plugEl = mk("ellipse", { class: "sc-plug", cx: 480, cy: 138, rx: 17, ry: 26 }, layers.plug);
const domeEl = mk("ellipse", { class: "sc-lesion", cx: 480, cy: 104, rx: 34, ry: 16 }, layers.lesion);
const pustEl = mk("circle", { class: "sc-pust", cx: 480, cy: 94, r: 9 }, layers.lesion);
const nodEl = mk("ellipse", { class: "sc-nodule", cx: 480, cy: 322, rx: 58, ry: 42 }, layers.nodule);
const scarEls = [0, 1, 2].map(function (i) {
  return mk("path", { class: "sc-scar", d: "M" + (438 + i * 28) + " 348 q10 14 2 30 q-6 12 4 24" }, layers.nodule);
});
/* ---- bacteria inside the follicle ---- */
const BAC_N = 26, bac = [];
function initBac() {
  for (let i = 0; i < BAC_N; i++) {
    const g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk("ellipse", { class: "cl-b", rx: 7, ry: 3.5 }, g);
    mk("circle", { class: "cl-h", r: 1.4, cx: -1.4, cy: -1 }, g);
    bac.push({ g: g, x: rnd(468, 492), y: rnd(178, 318), rot: rnd(0, 180), s: 0 });
  }
}
/* ---- red cells in the dermal vessel ---- */
const rbcs = [];
function initRbc() {
  for (let i = 0; i < 12; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs);
    mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g);
    mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    rbcs.push({ g: g, x: rnd(0, SC.W), y: rnd(400, 418), v: rnd(0.8, 1.2) });
  }
}
/* ---- neutrophils ---- */
const neus = Array.from({ length: 5 }, function (_, i) {
  return { g: cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }), st: 0, x: -30, y: 408, t: 0, tx: 0, ty: 0, i: i };
});
/* ---- particle pools (items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, sx: 0, sy: 0, lx: 0, ly: 0 }; }); }
const sebP = pool(18, function () { return mk("circle", { class: "p-seb", r: 3 }, layers.parts); });
const kerP = pool(14, function () { return mk("rect", { class: "p-ker", x: -3, y: -2, width: 6, height: 4, rx: 1 }, layers.parts); });
const cytP = pool(28, function () { return mk("circle", { class: "sc-p p-cyt", r: 2.3 }, layers.parts); });
const treatP = pool(16, function () { return mk("circle", { class: "p-treat", r: 3 }, layers.parts); });
const free = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lesion";
  [["seb", "Sebum", "g-seb", "Sebum made by the oil gland, driven by androgens. More oil feeds the plug and the germs."], ["plug", "Plug", "g-plug", "Sticky shed lining cells block the follicle opening, forming a comedone."], ["bac", "C. acnes", "g-bac", "Cutibacterium acnes, a normal skin resident that multiplies in the plugged oily follicle."], ["infl", "Inflammation", "g-bad", "Inflammatory signals and cells around the follicle. This makes lesions red, raised and sore."], ["les", "Lesion", "g-les", "Overall lesion bulk, from a small comedone to a deep lump."], ["scar", "Scar risk", "g-scar", "Deeper and more intense inflammation is more likely to leave a scar."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Plug", 480, 132, 480, 62, "Plug: sticky shed skin and oil blocking the follicle mouth. Open plugs look dark and closed ones look pale.");
  pill(ox, "Red bump", 456, 100, 185, 95, "Red bump: the plugged follicle swells with pus near the surface.");
  pill(ox, "Oil gland", 360, 250, 185, 178, "Oil gland: makes the oil that feeds the plug and the germs. Isotretinoin shrinks it.");
  pill(ox, "Follicle", 492, 205, 705, 120, "Follicle: the canal the hair grows in. Shed skin turns sticky and blocks it.");
  pill(ox, "C. acnes", 484, 238, 735, 215, "C. acnes: normal skin germs that multiply in the oily plugged canal.");
  pill(ox, "Swelling", 542, 326, 735, 325, "Swelling: white cells gather and the follicle wall may burst.");
  pill(ox, "Deep lump", 480, 330, 185, 385, "Deep lump: a deep sore swelling. Deep intense spots can scar.");
  capEl = mk("text", { class: "ac-cap", x: 30, y: 436 }, ox); capEl.textContent = capText(0);
}
const sm = { Seb: 0.5, Plug: 0.5, Bac: 0.3, Infl: 0.2, Les: 0.2, Scar: 0.1 };
const acc = { seb: 0, ker: 0, cyt: 0, treat: 0 };
function init() { initBac(); initRbc(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 1.4);
  sm.Seb = lerp(sm.Seb, m.Seb, kk); sm.Plug = lerp(sm.Plug, m.Plug, kk); sm.Bac = lerp(sm.Bac, m.Bac, kk);
  sm.Infl = lerp(sm.Infl, m.Infl, kk); sm.Les = lerp(sm.Les, m.Les, kk); sm.Scar = lerp(sm.Scar, m.Scar, kk);
  /* gland shrinks hard as sebum falls (isotretinoin effect) */
  gsNow = 0.3 + 0.7 * sm.Seb;
  layers.glandSlot.setAttribute("transform", "translate(395 250) scale(" + gsNow.toFixed(3) + ") translate(-395 -250)");
  lobes.forEach(function (l, i) { place(l.g, l.x, l.y, Math.sin(tm / 2000 + i) * 4, 1 + 0.03 * Math.sin(tm / 700 + i)); });
  /* inflammation halo reddens the whole pilosebaceous unit */
  layers.halo.setAttribute("opacity", (sm.Infl * 0.38).toFixed(2));
  /* plug, dome, pustule, nodule, scar */
  const plugS = 0.25 + 0.75 * sm.Plug;
  plugEl.setAttribute("transform", "translate(480 138) scale(" + plugS.toFixed(3) + ") translate(-480 -138)");
  plugEl.style.opacity = sm.Plug > 0.06 ? 1 : 0;
  const domeS = clamp((sm.Infl - 0.12) * 1.5);
  domeEl.setAttribute("transform", "translate(480 110) scale(" + Math.max(0.05, domeS).toFixed(3) + ") translate(-480 -110)");
  domeEl.style.opacity = domeS > 0.06 ? (0.25 + 0.45 * sm.Infl).toFixed(2) : 0;
  const pusS = clamp((sm.Infl - 0.35) * 1.6) * clamp((sm.Les - 0.15) * 1.4);
  pustEl.setAttribute("transform", "translate(480 94) scale(" + Math.max(0.05, pusS).toFixed(3) + ") translate(-480 -94)");
  pustEl.style.opacity = pusS > 0.06 ? 1 : 0;
  const nodS = clamp(sm.Les * (0.3 + 0.7 * m.depth) + (sm.Infl - 0.5) * 0.4);
  nodEl.setAttribute("transform", "translate(480 322) scale(" + Math.max(0.05, nodS).toFixed(3) + ") translate(-480 -322)");
  nodEl.style.opacity = nodS > 0.08 ? (0.15 + 0.3 * sm.Infl).toFixed(2) : 0;
  scarEls.forEach(function (s) { s.style.opacity = (sm.Scar * 0.9).toFixed(2); });
  /* bacteria count follows Bac; antibiotic pales and shrinks the germs */
  if ((drug === 2) !== paleOn) {
    paleOn = drug === 2;
    bac.forEach(function (b) {
      if (paleOn) b.g.style.setProperty("--cc", "color-mix(in srgb, var(--c-bac) 40%, var(--anatomy-paper))");
      else b.g.style.removeProperty("--cc");
    });
  }
  const want = Math.round(sm.Bac * BAC_N);
  bac.forEach(function (b, i) {
    const on = i < want;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 2));
    place(b.g, b.x + Math.sin(tm / 600 + i) * 2, b.y + Math.cos(tm / 700 + i) * 2, b.rot, Math.max(0.05, b.s) * (drug === 2 ? 0.65 : 1));
    b.g.style.opacity = b.s > 0.05 ? 1 : 0;
  });
  /* sebum: out of the gland duct into the follicle, then upward */
  acc.seb += dt * sm.Seb * 7;
  while (acc.seb >= 1) { acc.seb--; const p = free(sebP); if (p) emit(p, DUCT[0] - 8 + rnd(-3, 3), DUCT[1] + rnd(-5, 5), 24, 4, 0); }
  sebP.forEach(function (p) {
    if (!p.on) return; p.t += dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.x > 472) { p.k = 1; p.vy = -rnd(18, 30); p.vx = 0; } }
    else { p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.t) * 4 * dt; }
    p.x = clamp(p.x, 452, 508); p.y = clamp(p.y, 118, 330);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y < 122 || p.t > 7) kill(p);
  });
  /* keratin flakes from follicle wall into the canal; retinoid dissolves them near the plug */
  acc.ker += dt * sm.Plug * 5;
  while (acc.ker >= 1) { acc.ker--; const p = free(kerP); if (p) emit(p, Math.random() < 0.5 ? 466 : 494, rnd(150, 280), 0, -rnd(8, 16), 0); }
  kerP.forEach(function (p) {
    if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x = clamp(p.x + Math.sin(tm / 400 + p.t * 3) * 5 * dt, 464, 496); p.y = clamp(p.y, 118, 330);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")");
    p.e.setAttribute("opacity", drug === 1 ? clamp((p.y - 120) / 70, 0.15, 1).toFixed(2) : 1);
    if (p.y < 124 || p.t > 6) kill(p);
  });
  /* inflammatory signals around the follicle */
  acc.cyt += dt * sm.Infl * 13;
  while (acc.cyt >= 1) { acc.cyt--; const p = free(cytP); if (p) emit(p, 480 + rnd(-26, 26), rnd(190, 330), rnd(-16, 16), rnd(-8, 8), 0); }
  cytP.forEach(function (p) {
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, 420, 580); p.y = clamp(p.y, 150, 380);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2));
    if (p.t > 2.4) kill(p);
  });
  /* treatment motes act on their target: retinoid sticks on the plug, antibiotic washes the canal, isotretinoin lodges in the gland */
  acc.treat += dt * (drug ? 6 : 0);
  while (acc.treat >= 1) {
    acc.treat--; const p = free(treatP); if (!p) break;
    if (drug === 1) emit(p, rnd(455, 505), 62, 0, 26, 1);
    else if (drug === 2) emit(p, rnd(462, 498), 118, 0, 22, 2);
    else if (drug === 3) emit(p, rnd(350, 440), 406, 0, -30, 3);
    else break;
  }
  treatP.forEach(function (p) {
    if (!p.on) return; p.t += dt;
    if (p.k === 1) {
      p.y += p.vy * dt;
      if (p.y >= 110) { p.k = 4; p.t = 0; p.sx = p.x; p.sy = Math.max(108, p.y); }
    } else if (p.k === 2) {
      p.y += p.vy * dt; p.x += (480 - p.x) * dt * 0.5 + Math.sin(tm / 350 + p.t) * 6 * dt;
      p.y = clamp(p.y, 110, 330); if (p.y > 320) kill(p);
    } else if (p.k === 3) {
      p.y += p.vy * dt; p.x += Math.sin(tm / 350 + p.t) * 6 * dt;
      const dx = p.x - 395, dy = p.y - 250;
      if (Math.hypot(dx, dy) < 60 * gsNow + 10) { p.k = 4; p.t = 0; p.lx = dx / gsNow; p.ly = dy / gsNow; }
      else if (p.y < 150) kill(p);
    } else {
      if (drug === 3 && p.lx) { p.x = 395 + p.lx * gsNow + Math.sin(tm / 500 + p.t * 4); p.y = 250 + p.ly * gsNow + Math.cos(tm / 500 + p.t * 4); }
      else { p.x = p.sx + Math.sin(tm / 500 + p.t * 4) * 1.5; p.y = p.sy + Math.cos(tm / 500 + p.t * 4) * 1.5; }
      p.e.setAttribute("opacity", p.t < 1.6 ? 1 : clamp(1 - (p.t - 1.6) / 0.9).toFixed(2));
      if (p.t > 2.5) kill(p);
    }
    if (!p.on) return;
    p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 58, 430);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 6) kill(p);
  });
  /* red cells drift in the vessel */
  rbcs.forEach(function (r) { r.x += r.v * 42 * dt; if (r.x > SC.W + 10) r.x = -10; place(r.g, r.x, r.y, 0, 1); });
  /* neutrophils leave the vessel and gather at the follicle */
  const nn = Math.round(sm.Infl * neus.length);
  neus.forEach(function (n, i) {
    const act = i < nn;
    if (n.st === 0) { if (act) { n.x = rnd(380, 560); n.y = 400; n.st = 1; n.tx = 480 + rnd(-52, 52); n.ty = rnd(270, 340); } else { n.g.style.opacity = 0; place(n.g, -40, 408, 0, 0.1); } }
    else if (n.st === 1) { n.g.style.opacity = 1; n.y -= 30 * dt; place(n.g, n.x, n.y, 0, 1); if (n.y < 372) n.st = 2; }
    else if (n.st === 2) { n.x += (n.tx - n.x) * dt * 0.8; n.y += (n.ty - n.y) * dt * 0.8; place(n.g, n.x + Math.sin(tm / 300 + i) * 2, n.y, Math.sin(tm / 400 + i) * 10, 1); n.t += dt; if (n.t > 8 || !act) { n.t = 0; n.st = 3; } }
    else { n.g.style.opacity = clamp(parseFloat(n.g.style.opacity || 1) - dt * 0.6); if (parseFloat(n.g.style.opacity) < 0.05) n.st = 0; }
  });
  /* gauges */
  gg.seb.set(sm.Seb, wordOf(sm.Seb, 0.3, 0.62, ["low", "moderate", "high"]));
  gg.plug.set(sm.Plug, wordOf(sm.Plug, 0.3, 0.62, ["small", "forming", "blocking"]));
  gg.bac.set(sm.Bac, wordOf(sm.Bac, 0.28, 0.6, ["few", "present", "many"]));
  gg.infl.set(sm.Infl, wordOf(sm.Infl, 0.28, 0.6, ["calm", "inflamed", "intense"]));
  gg.les.set(sm.Les, wordOf(sm.Les, 0.3, 0.6, ["small", "moderate", "large"]));
  gg.scar.set(sm.Scar, wordOf(sm.Scar, 0.22, 0.5, ["low", "some", "high"]));
  if (level !== capLevel || drug !== capDrug) { capLevel = level; capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
