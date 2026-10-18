/* Atopic dermatitis scene: real skin cross section, barrier bricks, alarm cells, itch nerve, visible drug actions. */
const layers = { skinL: $("skinSlotL"), skinR: $("skinSlotR"), ves: $("vesselSlot"), blush: $("blushG"), thick: $("thickG"), bricks: $("bricks"), staph: $("staphG"), cells: $("cellsG"), nerve: $("nerveG"), scratch: $("scratchG"), parts: $("parts"), film: $("filmG"), over: $("over"), panel: $("panel") };
let skinLO = null, skinRO = null, vesselO = null;
let surfY = 118, dermY = 302;
let blushEl = null, thickEl = null, filmEl = null, filmB = null, nerveEl = null, capEl = null, capDrug = -1;
const bricks = [];
const staphX = [120, 300, 620, 800];
const staphs = [];
let th2g = null, bcg = null;
const th2Pos = [190, 0], bPos = [350, 0];
const blockers = [];
const scratchPaths = [];
function capText(d) {
  if (d === 1) return "Emollient seals the surface. Less water escapes and fewer germs get in.";
  if (d === 2) return "Steroid calms the alarm cells. The signal fades and itch eases.";
  if (d === 3) return "IL-4 and IL-13 blocker plugs the receivers. The alarm fades and itch settles.";
  return "No treatment. Water escapes through gaps while germs get in, and itch keeps firing.";
}
function initOrgans() {
  skinLO = organ(layers.skinL, "skin", 245, 280, 470, { h: 430 });
  skinRO = organ(layers.skinR, "skin", 705, 280, 470, { flip: true, h: 430 });
  surfY = Math.round((skinLO.ports.surface[1] + skinRO.ports.surface[1]) / 2);
  dermY = Math.round(skinLO.ports.dermis[1]);
  th2Pos[1] = dermY; bPos[1] = dermY + 10;
  vesselO = organ(layers.ves, "vessel", 520, dermY + 74, 64, {});
  blushEl = mk("ellipse", { class: "ec-blush", cx: 480, cy: dermY + 8, rx: 400, ry: 72, opacity: "0" }, layers.blush);
  thickEl = mk("rect", { class: "ec-thick", x: 30, y: surfY - 2, width: 900, height: 6, opacity: "0.15" }, layers.thick);
  for (let i = 0; i < 14; i++) {
    const e = mk("rect", { class: "brick", x: -26, y: -7, width: 52, height: 13, rx: 3 }, layers.bricks);
    bricks.push({ e, x: 60 + i * 62, i });
  }
  staphX.forEach(function (x, i) {
    const g = mk("g", {}, layers.staph);
    [[0, 0], [7, -4], [4, 5], [-6, 4]].forEach(function (o) { mk("circle", { class: "staph-c", cx: o[0], cy: o[1], r: 4.2 }, g); });
    staphs.push({ g, x, i });
  });
  th2g = cell(layers.cells, { cls: "th2", r: 23, nuc: 0.42, seed: 3, wob: 0.12 });
  bcg = cell(layers.cells, { cls: "bcell", r: 19, nuc: 0.4, seed: 7, wob: 0.1 });
  for (let i = 0; i < 6; i++) blockers.push({ e: mk("path", { class: "ec-block", d: "M0 5L0 0M0 0L-4 -5M0 0L4 -5", opacity: "0" }, layers.cells), cell: 0, ang: (-60 + i * 48) * Math.PI / 180 });
  for (let i = 0; i < 5; i++) blockers.push({ e: mk("path", { class: "ec-block", d: "M0 5L0 0M0 0L-4 -5M0 0L4 -5", opacity: "0" }, layers.cells), cell: 1, ang: (-40 + i * 65) * Math.PI / 180 });
  nerveEl = mk("path", { class: "ec-nerve", d: "M790 " + (dermY + 60) + " C784 " + (dermY + 20) + " 796 " + (dermY - 60) + " 790 " + (dermY - 120) + " C787 " + (surfY + 37) + " 789 " + (surfY + 17) + " 790 " + (surfY + 6) }, layers.nerve);
  [["M560 0l10 13l8 -11l10 13l8 -11l10 11", 0], ["M600 -4l8 11l8 -9l8 11", 1]].forEach(function (row) {
    const p = mk("path", { class: "ec-scratch", d: row[0], transform: "translate(50 " + (surfY - 25) + ")" }, layers.scratch);
    scratchPaths.push(p);
  });
  filmEl = mk("rect", { class: "ec-film", x: 30, y: surfY - 36, width: 900, height: 32, rx: 12, opacity: "0" }, layers.film);
  filmB = mk("rect", { class: "ec-filmb", x: 30, y: surfY - 36, width: 900, height: 32, rx: 12, opacity: "0" }, layers.film);
}
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, life: 3 }; }); }
const water = pool(24, function () { return mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const allg = pool(20, function () { return mk("path", { class: "sc-p p-allg", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts); });
const cyt = pool(30, function () { return mk("circle", { class: "sc-p p-cyt", r: 2.5 }, layers.parts); });
const iges = pool(14, function () { const g = mk("g", {}, layers.parts); mk("path", { class: "ige-p", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; });
const itchp = pool(14, function () { return mk("circle", { class: "sc-p p-cyt2", r: 2.3 }, layers.parts); });
const emol = pool(12, function () { return mk("circle", { class: "sc-p p-emol", r: 3 }, layers.parts); });
const ster = pool(12, function () { return mk("circle", { class: "sc-p p-ster", r: 2.6 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* labels and gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The skin";
  [["barr", "Barrier", "g-bad", "How leaky the surface is. Wide gaps let water out and germs in."], ["water", "Water loss", "g-fl", "Water escaping through the broken surface. Lost water dries the skin."], ["th2", "Inflammation", "g-cyt", "Alarm signal from Th2 cells. It calls in help and drives itch."], ["itch", "Itch", "g-eos", "Itch signals running up the skin nerve. Scratching tears the surface again."], ["staph", "Staph", "g-clot", "Yellow germ clusters living on the broken surface. They can worsen flares."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Barrier", 150, surfY - 10, 110, 66, "Surface bricks that should lock together. Gaps let water out and let germs and allergens in.");
  pill(ox, "Allergen in", 330, surfY + 4, 330, 66, "Allergens falling onto the skin. Where gaps are wide they slip through to the alarm cells.");
  pill(ox, "Germs", 620, surfY - 18, 560, 66, "Germ clusters growing on the broken surface. They can trigger flares.");
  pill(ox, "Itch nerve", 790, dermY - 42, 800, 66, "A skin nerve carrying itch. Alarm signals make it fire, so scratching follows.");
  pill(ox, "Alarm cells", 190, dermY, 140, 398, "Th2 alarm cells. They release IL-4 and IL-13, which weaken the surface and drive itch.");
  pill(ox, "Antibody help", 350, dermY + 10, 350, 398, "B cells helped by the alarm signal. They release IgE, which arms allergy cells.");
  pill(ox, "Scratch", 610, surfY - 26, 600, 398, "Scratch marks. Scratching tears the surface, so more allergens enter and itch returns.");
  pill(ox, "Thick skin", 770, surfY - 2, 740, 398, "Thickened rough skin after long rubbing and scratching.");
  capEl = mk("text", { class: "ec-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { barr: 0.5, water: 0.4, aller: 0.3, th2: 0.3, ige: 0.2, itch: 0.3, scratch: 0.2, staph: 0.3, thick: 0.1, em: 0, st: 0, ib: 0 };
const acc = { water: 0, allg: 0, cyt: 0, ige: 0, itch: 0, emol: 0, ster: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.barr = lerp(sm.barr, m.barr, k2); sm.water = lerp(sm.water, m.water, k2); sm.aller = lerp(sm.aller, m.aller, k2);
  sm.th2 = lerp(sm.th2, m.th2, k2); sm.ige = lerp(sm.ige, m.ige, k2); sm.itch = lerp(sm.itch, m.itch, k1);
  sm.scratch = lerp(sm.scratch, m.scratch, k2); sm.staph = lerp(sm.staph, m.staph, k2); sm.thick = lerp(sm.thick, m.thick, k2);
  sm.em = lerp(sm.em, m.em, k1); sm.st = lerp(sm.st, m.st, k1); sm.ib = lerp(sm.ib, m.ib, k1);
  /* bricks part as the barrier fails; emollient film seals over them */
  bricks.forEach(function (b) {
    const gap = sm.barr * 10, dx = (b.i - 6.5) * gap * 0.16;
    place(b.e, clamp(b.x + dx, 34, 926), surfY - 10 + Math.sin(tm / 900 + b.i) * 0.6, Math.sin(tm / 1200 + b.i) * sm.barr * 4, 1);
  });
  filmEl.setAttribute("opacity", (sm.em * 0.55).toFixed(2)); filmB.setAttribute("opacity", (sm.em * 0.9).toFixed(2));
  /* red wash over the dermis follows inflammation, so treatment visibly cools it */
  blushEl.setAttribute("opacity", (sm.th2 * 0.5).toFixed(2));
  /* chronic thickening grows under the bricks */
  thickEl.setAttribute("height", f1(6 + sm.thick * 30));
  thickEl.setAttribute("opacity", (0.15 + sm.thick * 0.7).toFixed(2));
  /* feeder vessel swells with inflammation */
  layers.ves.setAttribute("transform", "translate(520 " + f1(dermY + 74) + ") scale(" + (0.8 + 0.45 * sm.th2).toFixed(3) + " 1) translate(-520 " + f1(-(dermY + 74)) + ")");
  /* Staph clusters shrink as treatment clears them */
  staphs.forEach(function (s, i) { const sc = 0.25 + sm.staph * (0.9 - i * 0.06); place(s.g, s.x, surfY - 18, 0, sc); s.g.style.opacity = sm.staph > 0.08 ? 1 : 0; });
  /* alarm cells shrink and dim under steroid; blocker plugs their receivers */
  const th2sc = 1 - 0.3 * sm.st, bsc = 1 - 0.2 * sm.ib - 0.1 * sm.st;
  place(th2g, th2Pos[0] + Math.sin(tm / 1500) * 3, th2Pos[1] + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, th2sc);
  th2g.style.opacity = (1 - 0.4 * sm.st).toFixed(2);
  place(bcg, bPos[0] + Math.sin(tm / 1600 + 2) * 3, bPos[1] + Math.cos(tm / 1800 + 1) * 2, Math.sin(tm / 2600) * 5, bsc);
  blockers.forEach(function (b, i) {
    const cx = b.cell ? bPos[0] : th2Pos[0], cy = b.cell ? bPos[1] : th2Pos[1], r = (b.cell ? 19 * bsc : 23 * th2sc) + 5;
    const a = b.ang + tm / 9000;
    b.e.setAttribute("transform", "translate(" + f1(cx + Math.cos(a) * r) + " " + f1(cy + Math.sin(a) * r) + ") rotate(" + f1(a * 57.3 + 90) + ")");
    b.e.setAttribute("opacity", sm.ib.toFixed(2));
  });
  /* scratch marks fade as itch settles */
  scratchPaths.forEach(function (p) { p.setAttribute("opacity", clamp(0.15 + sm.scratch).toFixed(2)); });
  /* water escaping upward */
  acc.water += dt * sm.water * 9; while (acc.water >= 1) { acc.water--; const p = freeP(water); if (p) emit(p, rnd(60, 900), surfY - 12, rnd(-4, 4), -rnd(22, 34)); }
  water.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 36, 924); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.y < 54 || p.t > 3) kill(p); });
  /* allergens fall; wide gaps let them through to the alarm cells */
  acc.allg += dt * sm.aller * 7; while (acc.allg >= 1) { acc.allg--; const p = freeP(allg); if (p) { emit(p, rnd(60, 900), 56, rnd(-3, 3), rnd(20, 30)); p.k = Math.random() < sm.aller ? 1 : 0; } }
  allg.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 36, 924); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.k === 1) { if (p.y > dermY - 20 || p.t > 8) kill(p); } else { p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.y - (surfY - 14)) / 22).toFixed(2)); if (p.y > surfY - 6 || p.t > 8) kill(p); } });
  /* alarm signals rise to the surface and across to the B cell */
  acc.cyt += dt * sm.th2 * 13; while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cyt); if (p) emit(p, th2Pos[0] + rnd(-14, 14), th2Pos[1] + rnd(-8, 8), rnd(8, 26), rnd(-30, -14), Math.random() < 0.5 ? 0 : 1); }
  cyt.forEach(function (p) { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < surfY + 10 || p.x > 343 || p.t > 5) kill(p); });
  /* IgE puffs around the helped B cell */
  acc.ige += dt * sm.ige * 6; while (acc.ige >= 1) { acc.ige--; const p = freeP(iges); if (p) { emit(p, bPos[0] + rnd(-12, 12), bPos[1] + rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)); p.life = rnd(2.2, 3.4); } }
  iges.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 300, 400); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / p.life).toFixed(2)); if (p.t > p.life) kill(p); });
  /* itch signals climb the nerve */
  acc.itch += dt * sm.itch * 8; while (acc.itch >= 1) { acc.itch--; const p = freeP(itchp); if (p) emit(p, 790, dermY + 48, 0, -42); }
  itchp.forEach(function (p) { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x = 790 + Math.sin((dermY + 48 - p.y) / 26) * 6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < surfY + 10 || p.t > 6) kill(p); });
  /* emollient rain seals the surface; steroid dots sink into the dermis */
  acc.emol += dt * sm.em * 8; while (acc.emol >= 1) { acc.emol--; const p = freeP(emol); if (p) emit(p, rnd(60, 900), 56, rnd(-3, 3), rnd(26, 34)); }
  emol.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 36, 924); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.y - (surfY - 44)) / 14).toFixed(2)); if (p.y > surfY - 32 || p.t > 4) kill(p); });
  acc.ster += dt * sm.st * 8; while (acc.ster >= 1) { acc.ster--; const p = freeP(ster); if (p) emit(p, rnd(100, 600), 60, rnd(-4, 4), rnd(10, 16)); }
  ster.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + (th2Pos[0] - p.x) * dt * 0.15, 60, 640); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 5).toFixed(2)); if (p.y > dermY + 30 || p.t > 6) kill(p); });
  /* gauges */
  gg.barr.set(sm.barr, wordOf(sm.barr, 0.3, 0.6, ["mild", "leaky", "very leaky"])); gg.water.set(sm.water, wordOf(sm.water, 0.3, 0.6, ["low", "raised", "high"]));
  gg.th2.set(sm.th2, wordOf(sm.th2, 0.3, 0.6, ["low", "raised", "high"]));
  gg.itch.set(sm.itch, wordOf(sm.itch, 0.3, 0.6, ["low", "raised", "high"])); gg.staph.set(sm.staph, wordOf(sm.staph, 0.3, 0.6, ["little", "present", "heavy"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
