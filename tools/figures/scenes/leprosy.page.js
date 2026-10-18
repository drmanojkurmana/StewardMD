/* Leprosy scene: bacilli in skin macrophages and Schwann cells, the Th1 and granuloma response, nerve damage, reaction flare and the gauges. */
const LY = { skin: $("skinCells"), immune: $("immuneCells"), parts: $("parts"), nerve: $("nerveCells"), dmg: $("damage"), hand: $("hand"), over: $("over"), panel: $("panel"), flare: $("flare"), patch: $("patch") };
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* skin macrophages and extra nodules */
const skinMacs = [[150, 150, 22], [228, 168, 20], [322, 140, 21]].map(([x, y, r], i) => { const g = mk("g", {}, LY.skin); cell(g, { cls: "mac", r, nuc: 0.38, seed: i * 3 + 2, wob: 0.13 }); return { g, x, y }; });
const nods = [[320, 132, 32, 18], [365, 168, 26, 15], [395, 118, 20, 12], [285, 182, 24, 14]].map(([cx, cy, rx, ry]) => mk("ellipse", { class: "sc-nod", cx, cy, rx, ry, opacity: "0" }, $("nodules")));
/* immune cells: Th1 lymphocytes and a granuloma cluster of macrophages */
const thCells = [[570, 145, 21], [622, 178, 17]].map(([x, y, r], i) => { const g = mk("g", {}, LY.immune); cell(g, { cls: "lymph", r, nuc: 0.5, seed: i * 4 + 11, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const granMacs = [[-30, -6, 27], [26, -16, 25], [4, 20, 23]].map(([ox, oy, r], i) => { const g = mk("g", {}, LY.immune); cell(g, { cls: "mac", r, nuc: 0.4, seed: i * 5 + 21, wob: 0.12 }); return { g, ox, oy }; });
/* nerve: Schwann cells on an axon, with myelin ellipses */
const schw = [120, 230, 340, 450, 560, 670].map((x, i) => { mk("ellipse", { class: "sc-myel", cx: x, cy: 335, rx: 40, ry: 27 }, LY.nerve); const g = mk("g", {}, LY.nerve); cell(g, { cls: "schw", r: 25, nuc: 0.34, seed: i * 3 + 7, wob: 0.08 }); place(g, x, 335, 0, 1); return { g, x }; });
const gaps = [285, 475, 650].map((x) => mk("rect", { class: "sc-gap", x, y: 330, width: 36, height: 10, rx: 4, opacity: "0" }, LY.dmg));
/* hand at the end of the nerve: palm and four fingers that curl with damage */
mk("ellipse", { class: "hand-palm", cx: 875, cy: 340, rx: 21, ry: 25 }, LY.hand);
mk("path", { class: "hand-fin", d: "M856 342L842 330" }, LY.hand);
const fingers = [860, 870, 881, 891].map((x) => mk("path", { class: "hand-fin", d: "M" + x + " 316L" + x + " 298L" + x + " 284" }, LY.hand));
const fingerBase = [860, 870, 881, 891];
/* bacilli: rods homed in skin macrophages and in Schwann cells, interleaved */
const bac = [];
(function () {
  const skinHomes = [], nerveHomes = [];
  skinMacs.forEach((m) => { for (let j = 0; j < 4; j++) skinHomes.push([m.x + rnd(-11, 11), m.y + rnd(-9, 9)]); });
  schw.forEach((s) => { for (let j = 0; j < 5; j++) nerveHomes.push([s.x + rnd(-13, 13), 335 + rnd(-10, 10)]); });
  for (let j = 0; j < 30; j++) { if (j < nerveHomes.length) bac.push(nerveHomes[j]); if (j % 3 === 0 && skinHomes.length) bac.push(skinHomes.shift()); }
  bac.forEach(([x, y], i) => { const g = mk("g", { class: "cl cl-bac" }, LY.parts); mk("ellipse", { class: "cl-b", rx: 5, ry: 2.2 }, g); bac[i] = { g, x, y, rot: rnd(0, 160), ph: i * 1.3 }; });
})();
/* particle pools */
const cyt = mkPool(28, () => mk("circle", { class: "sc-p p-ifng", r: 2.4 }, LY.parts));
const rxn = mkPool(20, () => mk("circle", { class: "sc-p p-rxn", r: 2.6 }, LY.parts));
const ster = mkPool(14, () => mk("circle", { class: "sc-p p-ster", r: 2.6 }, LY.parts));
const caps = mkPool(8, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
/* labels and treatment marks */
let mdtPill = null, sterPill = null;
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  const ox = LY.over;
  pill(ox, "Skin patch", 185, 112, 160, 66, "A well defined patch with loss of feeling in tuberculoid disease. In lepromatous disease the lesions are many, widespread and poorly defined.");
  pill(ox, "Bacilli in skin", 322, 118, 330, 66, "Mycobacterium leprae bacilli inside skin macrophages. Very few in tuberculoid disease, very many in lepromatous disease.");
  pill(ox, "Th1 cell", 570, 122, 560, 66, "A Th1 lymphocyte. Its interferon gamma switches macrophages on to kill bacilli. Strong at the tuberculoid end, weak at the lepromatous end.");
  pill(ox, "Cytokines", 640, 140, 675, 66, "Interferon gamma and other cytokines from Th1 cells. They build the granuloma and also drive the nerve damage and reactions.");
  pill(ox, "Macrophage", 775, 118, 815, 66, "A macrophage. Activated macrophages kill bacilli and form the granuloma. In lepromatous disease they are foamy and packed with bacilli they cannot kill.");
  pill(ox, "Granuloma", 775, 178, 770, 208, "A tight cluster of activated macrophages and lymphocytes. Well formed in tuberculoid disease, loose and foamy in lepromatous disease.");
  pill(ox, "Schwann cell", 230, 306, 190, 252, "A Schwann cell wrapping the nerve fibre. Mycobacterium leprae invades Schwann cells, which is why leprosy is mainly a disease of skin and peripheral nerve.");
  pill(ox, "Bacilli in nerve", 360, 310, 390, 252, "Bacilli living inside Schwann cells in the peripheral nerve. The immune attack on them injures the fibre.");
  pill(ox, "Axon", 560, 335, 590, 252, "The nerve fibre itself. It carries feeling and movement signals. When it is damaged, feeling is lost and muscles weaken.");
  pill(ox, "Nerve damage", 700, 362, 790, 252, "Damage to the nerve fibre from the immune response and from reactions. It causes loss of feeling, weakness, unnoticed injury and deformity.");
  pill(ox, "Reaction flare", 330, 392, 360, 424, "A reaction: a sudden immune flare with inflamed patches and painful swollen nerves. A type 1 reaction in borderline disease, or erythema nodosum leprosum in lepromatous disease.");
  pill(ox, "Claw hand", 875, 368, 835, 424, "Claw hand and other deformity follow nerve damage: weak hand muscles, lost feeling and repeated unnoticed injury.");
  mdtPill = pill(ox, "Multidrug therapy", 170, 362, 175, 424, "Multidrug therapy kills the bacilli in skin and nerve and lowers the load. It does not by itself calm a reaction flare.");
  sterPill = pill(ox, "Steroid", 575, 392, 560, 424, "A steroid calms the reaction flare and protects the nerve while it is inflamed. It does not kill bacilli.");
}
const gg = {};
function initGauges() {
  [["bac", "Bacilli", "g-bac", "How many bacilli are in skin and nerve. Few in tuberculoid disease, many in lepromatous disease."], ["th1", "Th1 response", "g-cyt", "Strength of the cell mediated Th1 response. Strong at the tuberculoid end, weak at the lepromatous end."], ["gran", "Granuloma", "g-clot", "How tight and well formed the granuloma is. Tight in tuberculoid disease, loose in lepromatous disease."], ["nd", "Nerve damage", "g-bad", "Damage to the peripheral nerve fibre, from the immune attack and from reactions."], ["rxn", "Reaction", "g-eos", "Risk and activity of a reaction flare: a sudden immune flare that can injure nerves quickly."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(LY.panel, 180 + i * 160, 480, 52, 18, cls, name, tip); });
}
const sm = { B: 0.5, I: 0.5, G: 0.4, R: 0.5, Nd: 0.5, Skn: 0.5 };
const acc = { cyt: 0, rxn: 0, ster: 0, cap: 0 };
function init() { initPanel(); initGauges(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.B = lerp(sm.B, m.B, k); sm.I = lerp(sm.I, m.I, k); sm.G = lerp(sm.G, m.G, k); sm.R = lerp(sm.R, m.R, k); sm.Nd = lerp(sm.Nd, m.Nd, k); sm.Skn = lerp(sm.Skn, m.Skn, k);
  /* skin patch and spread */
  LY.patch.setAttribute("rx", f1(100 * (0.8 + 0.35 * sm.Skn))); LY.patch.setAttribute("opacity", (0.65 + 0.3 * sm.Skn).toFixed(2));
  nods.forEach((n) => n.setAttribute("opacity", clamp((sm.Skn - 0.45) * 1.6).toFixed(2)));
  skinMacs.forEach((mc, i) => place(mc.g, mc.x + Math.sin(tm / 900 + i * 2) * 2, mc.y + Math.cos(tm / 1100 + i) * 2, 0, 1 + 0.3 * sm.B));
  /* immune: Th1 bob, granuloma tightens with Th1 strength */
  thCells.forEach((t, i) => place(t.g, t.x, t.y + Math.sin(tm / 700 + i * 2.4) * 3, 0, 1 + 0.1 * sm.I * Math.sin(tm / 320 + i)));
  const spread = lerp(1.75, 0.65, sm.I);
  granMacs.forEach((mc, i) => place(mc.g, 775 + mc.ox * spread, 142 + mc.oy * spread * 0.72 + Math.sin(tm / 800 + i * 2) * 2, 0, (1 + 0.25 * sm.B) * (0.9 + 0.2 * sm.G)));
  /* cytokines from Th1 cells toward the granuloma */
  acc.cyt += dt * sm.I * 11; while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cyt); if (p) emit(p, 596, rnd(132, 158), rnd(28, 44), rnd(-7, 7), 0); }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 742 || p.t > 5) kill(p); });
  /* bacilli: visible count follows the load, in skin and nerve homes alike */
  const want = Math.round(sm.B * bac.length);
  bac.forEach((b, i) => { const on = i < want, s = on ? 1 : 0.001; place(b.g, b.x + Math.sin(tm / 500 + b.ph) * 1.4, b.y + Math.cos(tm / 620 + b.ph) * 1.2, b.rot + Math.sin(tm / 700 + b.ph) * 14, s); b.g.style.opacity = on ? 1 : 0; });
  /* nerve: Schwann cells shrink a little, axon gaps and flare follow damage and reaction */
  schw.forEach((s, i) => place(s.g, s.x, 335 + Math.sin(tm / 900 + i) * 1.5, 0, 1 - 0.16 * sm.Nd));
  gaps.forEach((g) => g.setAttribute("opacity", clamp((sm.Nd - 0.12) * 1.3).toFixed(2)));
  LY.flare.setAttribute("opacity", (sm.R * 0.3).toFixed(2));
  acc.rxn += dt * sm.R * 6; while (acc.rxn >= 1) { acc.rxn--; const p = freeP(rxn); if (p) emit(p, rnd(60, 900), 268, rnd(-4, 4), -rnd(8, 15), 0); }
  rxn.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8 || p.y < 244) kill(p); });
  /* fingers curl as nerve damage rises */
  const curl = sm.Nd;
  fingers.forEach((fg, i) => { const bx = fingerBase[i], tipX = bx - curl * (5 + i * 1.5), tipY = 284 + curl * 19; fg.setAttribute("d", "M" + bx + " 316L" + bx + " 298L" + f1(tipX) + " " + f1(tipY)); });
  /* multidrug therapy capsules drift to the skin bacilli */
  if (mdtPill) mdtPill.style.display = m.mdt ? "" : "none";
  if (sterPill) sterPill.style.display = m.steroid ? "" : "none";
  acc.cap += dt * m.mdt * 2.2; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emit(p, rnd(36, 90), rnd(138, 168), 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (205 - p.x) * dt * 0.6 + 14 * dt; p.y += (150 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* steroid drops settle on the inflamed nerve */
  acc.ster += dt * m.steroid * 7; while (acc.ster >= 1) { acc.ster--; const p = freeP(ster); if (p) emit(p, rnd(80, 820), 258, 0, rnd(18, 26), 0); }
  ster.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 392 || p.t > 6) kill(p); });
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.25, 0.6, ["few", "some", "many"])); gg.th1.set(sm.I, wordOf(sm.I, 0.3, 0.7, ["weak", "moderate", "strong"]));
  gg.gran.set(sm.G, wordOf(sm.G, 0.3, 0.6, ["loose", "forming", "tight"])); gg.nd.set(sm.Nd, wordOf(sm.Nd, 0.3, 0.6, ["little", "some", "marked"])); gg.rxn.set(sm.R, wordOf(sm.R, 0.35, 0.65, ["low", "moderate", "high"]));
}
run({ init, step });
