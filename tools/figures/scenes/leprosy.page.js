/* Leprosy scene: bacilli in skin macrophages and Schwann cells, the Th1 and granuloma response, nerve damage, reaction flare and the gauges. */
const LY = { skin: $("skinCells"), immune: $("immuneCells"), parts: $("parts"), nerve: $("nerveCells"), dmg: $("damage"), hand: $("hand"), over: $("over"), panel: $("panel"), flare: $("flare"), patch: $("patch"), halo: $("halo") };
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* skin organ plus the cells that sit on it */
let skinO = null, derm = [145, 173], capEl = null, capDrug = -1;
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 150, 164, 180, {});
  if (skinO.ports && skinO.ports.dermis) derm = skinO.ports.dermis;
}
function capText(d) {
  if (d === 1) return "Multidrug therapy kills bacilli. Skin spots fade.";
  if (d === 2) return "Steroid calms the flare. The nerve is protected.";
  if (d === 3) return "Multidrug therapy plus steroid. Bacilli die and the flare fades.";
  return "No treatment. Bacilli grow and reactions injure the nerve.";
}
/* skin macrophages over the dermis, and spread nodules to the right of the organ */
const skinMacs = [[120, 180, 21], [165, 175, 22], [210, 185, 20]].map(([x, y, r], i) => { const g = mk("g", {}, LY.skin); cell(g, { cls: "mac", r, nuc: 0.38, seed: i * 3 + 2, wob: 0.13 }); return { g, x, y }; });
const nods = [[300, 110, 26, 15], [322, 160, 22, 13], [298, 208, 24, 14]].map(([cx, cy, rx, ry]) => mk("ellipse", { class: "sc-nod", cx, cy, rx, ry, opacity: "0" }, $("nodules")));
/* immune cells: Th1 lymphocytes and a granuloma cluster of macrophages */
const thCells = [[455, 140, 20], [505, 172, 17]].map(([x, y, r], i) => { const g = mk("g", {}, LY.immune); cell(g, { cls: "lymph", r, nuc: 0.5, seed: i * 4 + 11, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const granMacs = [[-30, -6, 27], [26, -16, 25], [4, 20, 23]].map(([ox, oy, r], i) => { const g = mk("g", {}, LY.immune); cell(g, { cls: "mac", r, nuc: 0.4, seed: i * 5 + 21, wob: 0.12 }); return { g, ox, oy }; });
/* nerve: Schwann cells on an axon, with myelin ellipses that dull as damage rises */
const myelins = [120, 230, 340, 450, 560, 670].map((x) => mk("ellipse", { class: "sc-myel", cx: x, cy: 351, rx: 40, ry: 27 }, LY.nerve));
const schw = [120, 230, 340, 450, 560, 670].map((x, i) => { const g = mk("g", {}, LY.nerve); cell(g, { cls: "schw", r: 25, nuc: 0.34, seed: i * 3 + 7, wob: 0.08 }); place(g, x, 351, 0, 1); return { g, x }; });
const gaps = [285, 475, 650].map((x) => mk("rect", { class: "sc-gap", x, y: 346, width: 36, height: 10, rx: 4, opacity: "0" }, LY.dmg));
/* hand at the end of the nerve: palm and four fingers that curl with damage */
mk("ellipse", { class: "hand-palm", cx: 875, cy: 356, rx: 21, ry: 25 }, LY.hand);
mk("path", { class: "hand-fin", d: "M856 358L842 346" }, LY.hand);
const fingers = [860, 870, 881, 891].map((x) => mk("path", { class: "hand-fin", d: "M" + x + " 332L" + x + " 314L" + x + " 300" }, LY.hand));
const fingerBase = [860, 870, 881, 891];
/* bacilli: rods homed in skin macrophages and in Schwann cells, interleaved */
const bac = [];
(function () {
  const skinHomes = [], nerveHomes = [];
  skinMacs.forEach((m) => { for (let j = 0; j < 4; j++) skinHomes.push([m.x + rnd(-11, 11), m.y + rnd(-9, 9)]); });
  schw.forEach((s) => { for (let j = 0; j < 5; j++) nerveHomes.push([s.x + rnd(-13, 13), 351 + rnd(-10, 10)]); });
  for (let j = 0; j < 30; j++) { if (j < nerveHomes.length) bac.push(nerveHomes[j]); if (j % 3 === 0 && skinHomes.length) bac.push(skinHomes.shift()); }
  bac.forEach(([x, y], i) => { const g = mk("g", { class: "cl cl-bac" }, LY.parts); mk("ellipse", { class: "cl-b", rx: 5, ry: 2.2 }, g); bac[i] = { g, x, y, rot: rnd(0, 160), ph: i * 1.3 }; });
})();
/* particle pools */
const cyt = mkPool(28, () => mk("circle", { class: "sc-p p-ifng", r: 2.4 }, LY.parts));
const rxn = mkPool(20, () => mk("circle", { class: "sc-p p-rxn", r: 2.6 }, LY.parts));
const ster = mkPool(14, () => mk("circle", { class: "sc-p p-ster", r: 2.6 }, LY.parts));
const caps = mkPool(8, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
/* eight short labels telling the story skin to immune to nerve to hand */
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  const ox = LY.over;
  pill(ox, "Skin", 150, 100, 120, 56, "Skin. The pale patch has less feeling. Widespread disease brings many spots.");
  pill(ox, "Bacilli", 165, 175, 250, 56, "Bacilli. The germs live inside skin cells. More germs means spreading disease.");
  pill(ox, "Th1 cells", 455, 140, 490, 56, "Th1 cells. They release signals that switch macrophages on to kill germs.");
  pill(ox, "Granuloma", 745, 160, 745, 56, "Granuloma. A tight ball of switched on macrophages. Tight means strong defence.");
  pill(ox, "Schwann cells", 230, 351, 230, 278, "Schwann cells. They wrap the nerve fibre. Germs hide inside them.");
  pill(ox, "Nerve injury", 600, 351, 600, 278, "Nerve injury. Attacks on infected cells break the fibre, so feeling is lost.");
  pill(ox, "Reaction", 560, 405, 640, 430, "Reaction. A sudden flare that swells the nerve and can injure it fast.");
  pill(ox, "Claw hand", 875, 381, 860, 430, "Claw hand. Weak muscles and lost feeling after nerve injury.");
  capEl = mk("text", { class: "le-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const gg = {};
function initGauges() {
  [["bac", "Bacilli", "g-bac", "How many bacilli are in skin and nerve. Few in tuberculoid disease, many in lepromatous disease."], ["th1", "Th1 response", "g-cyt", "Strength of the cell mediated Th1 response. Strong at the tuberculoid end, weak at the lepromatous end."], ["gran", "Granuloma", "g-clot", "How tight and well formed the granuloma is. Tight in tuberculoid disease, loose in lepromatous disease."], ["nd", "Nerve damage", "g-bad", "Damage to the peripheral nerve fibre, from the immune attack and from reactions."], ["rxn", "Reaction", "g-eos", "Risk and activity of a reaction flare: a sudden immune flare that can injure nerves quickly."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(LY.panel, 180 + i * 160, 480, 52, 18, cls, name, tip); });
}
const sm = { B: 0.5, I: 0.5, G: 0.4, R: 0.5, Nd: 0.5, Skn: 0.5, mdt: 0, ster: 0 };
const acc = { cyt: 0, rxn: 0, ster: 0, cap: 0 };
function init() { initOrgans(); initPanel(); initGauges(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.B = lerp(sm.B, m.B, k); sm.I = lerp(sm.I, m.I, k); sm.G = lerp(sm.G, m.G, k); sm.R = lerp(sm.R, m.R, k); sm.Nd = lerp(sm.Nd, m.Nd, k); sm.Skn = lerp(sm.Skn, m.Skn, k);
  sm.mdt = lerp(sm.mdt, m.mdt, k); sm.ster = lerp(sm.ster, m.steroid, k);
  /* skin patch size follows spread, red halo and nerve flare follow reaction */
  LY.patch.setAttribute("rx", f1(60 + 25 * sm.Skn)); LY.patch.setAttribute("opacity", (0.65 + 0.3 * sm.Skn).toFixed(2));
  LY.halo.setAttribute("opacity", clamp((sm.R - 0.15) * 0.9).toFixed(2));
  nods.forEach((n) => n.setAttribute("opacity", clamp((sm.Skn - 0.4) * 1.8).toFixed(2)));
  skinMacs.forEach((mc, i) => place(mc.g, mc.x + Math.sin(tm / 900 + i * 2) * 2, mc.y + Math.cos(tm / 1100 + i) * 2, 0, 1 + 0.3 * sm.B));
  /* immune: Th1 bob, granuloma tightens with Th1 strength */
  thCells.forEach((t, i) => place(t.g, t.x, t.y + Math.sin(tm / 700 + i * 2.4) * 3, 0, 1 + 0.1 * sm.I * Math.sin(tm / 320 + i)));
  const spread = lerp(1.75, 0.65, sm.I);
  granMacs.forEach((mc, i) => place(mc.g, 745 + mc.ox * spread, 160 + mc.oy * spread * 0.72 + Math.sin(tm / 800 + i * 2) * 2, 0, (1 + 0.25 * sm.B) * (0.9 + 0.2 * sm.G)));
  /* cytokines from Th1 cells toward the granuloma */
  acc.cyt += dt * sm.I * 11; while (acc.cyt >= 1) { acc.cyt--; const p = freeP(cyt); if (p) emit(p, 522, rnd(132, 166), rnd(28, 44), rnd(-7, 7), 0); }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 705 || p.t > 5) kill(p); });
  /* bacilli: visible count follows the load, and multidrug therapy shrinks survivors */
  const want = Math.round(sm.B * bac.length), shk = 1 - 0.5 * sm.mdt;
  bac.forEach((b, i) => { const on = i < want, s = on ? shk : 0.001; place(b.g, b.x + Math.sin(tm / 500 + b.ph) * 1.4, b.y + Math.cos(tm / 620 + b.ph) * 1.2, b.rot + Math.sin(tm / 700 + b.ph) * 14, s); b.g.style.opacity = on ? 1 - 0.35 * sm.mdt : 0; });
  /* nerve: myelin dulls and Schwann cells shrink with damage, gaps and flare fade with treatment */
  myelins.forEach((e) => e.setAttribute("opacity", (0.55 + 0.45 * (1 - sm.Nd)).toFixed(2)));
  schw.forEach((s, i) => place(s.g, s.x, 351 + Math.sin(tm / 900 + i) * 1.5, 0, 1 - 0.16 * sm.Nd));
  gaps.forEach((g) => g.setAttribute("opacity", clamp((sm.Nd - 0.12) * 1.3).toFixed(2)));
  LY.flare.setAttribute("opacity", clamp((sm.R - 0.12) * 0.75).toFixed(2));
  acc.rxn += dt * sm.R * 6; while (acc.rxn >= 1) { acc.rxn--; const p = freeP(rxn); if (p) emit(p, rnd(60, 900), 408, rnd(-4, 4), -rnd(8, 15), 0); }
  rxn.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8 || p.y < 292) kill(p); });
  /* fingers curl as nerve damage rises */
  const curl = sm.Nd;
  fingers.forEach((fg, i) => { const bx = fingerBase[i], tipX = bx - curl * (5 + i * 1.5), tipY = 300 + curl * 19; fg.setAttribute("d", "M" + bx + " 332L" + bx + " 314L" + f1(tipX) + " " + f1(tipY)); });
  /* multidrug therapy capsules fly to the dermis where the skin bacilli live */
  acc.cap += dt * m.mdt * 2.2; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) emit(p, rnd(40, 80), rnd(140, 190), 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (derm[0] - p.x) * dt * 0.6 + 14 * dt; p.y += (derm[1] - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* steroid drops settle on the inflamed nerve */
  acc.ster += dt * m.steroid * 7; while (acc.ster >= 1) { acc.ster--; const p = freeP(ster); if (p) emit(p, rnd(80, 820), 290, 0, rnd(18, 26), 0); }
  ster.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 402 || p.t > 6) kill(p); });
  /* gauges and the state caption */
  gg.bac.set(sm.B, wordOf(sm.B, 0.25, 0.6, ["few", "some", "many"])); gg.th1.set(sm.I, wordOf(sm.I, 0.3, 0.7, ["weak", "moderate", "strong"]));
  gg.gran.set(sm.G, wordOf(sm.G, 0.3, 0.6, ["loose", "forming", "tight"])); gg.nd.set(sm.Nd, wordOf(sm.Nd, 0.3, 0.6, ["little", "some", "marked"])); gg.rxn.set(sm.R, wordOf(sm.R, 0.35, 0.65, ["low", "moderate", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
