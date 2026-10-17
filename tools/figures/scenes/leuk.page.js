/* Leukaemia scene: stem cells, progenitors, the leukaemic crowd, blocked maturation, peripheral blood and gauges. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const W = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- fixed cells ---- */
const stems = [[95, 248], [95, 295], [95, 342]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "stem", r: 18, nuc: 0.42, seed: i * 3 + 1, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const progs = [[228, 238], [258, 282], [228, 326], [262, 340]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "prog", r: 12, nuc: 0.4, seed: i * 2 + 5, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
function grid(n, x0, y0, dx, dy, cols) { return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * dx + ((i * 37) % 13) - 6, y: y0 + Math.floor(i / cols) * dy + ((i * 53) % 11) - 5, s: 0 })); }
const blasts = grid(28, 350, 218, 38, 52, 7).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "blast", r: 14, nuc: 0.58, seed: i + 2, wob: 0.09 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const lymphs = grid(28, 350, 218, 38, 52, 7).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cll", r: 9, nuc: 0.68, seed: i + 30, wob: 0.06 }); return { g, x: p.x + 8, y: p.y + 6, s: 0, i }; });
const myels = grid(18, 596, 258, 42, 42, 4).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 50, wob: 0.12 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const mats = [[648, 362], [688, 378], [728, 362], [668, 392], [708, 392], [748, 378]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 70, wob: 0.12 }); return { g, x, y, s: 0 }; });
const vesselRbcs = Array.from({ length: 10 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, LY.stage); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { g, x: 832 + (i % 3) * 32, y: 250 + i * 18, v: 0.8 + (i % 4) * 0.15 }; });
const vesselPlts = Array.from({ length: 6 }, (_, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "plt", r: 5, seed: i + 90, wob: 0.15, n: 7 }); return { g, x: 848 + (i % 2) * 44, y: 260 + i * 28, v: 0.6 }; });
/* differentiation block cross */
const blockG = mk("g", { opacity: "0" }, LY.stage);
mk("path", { class: "lk-block", d: "M598 280L622 304M622 280L598 304" }, blockG);
/* Philadelphia chromosome inset */
const phG = mk("g", { opacity: "0" }, LY.stage);
mk("rect", { class: "lk-chr9", x: 662, y: 170, width: 12, height: 44, rx: 5 }, phG); mk("rect", { class: "lk-chr22", x: 662, y: 202, width: 12, height: 12, rx: 5 }, phG);
mk("rect", { class: "lk-chr22", x: 694, y: 170, width: 12, height: 28, rx: 5 }, phG); mk("rect", { class: "lk-chr9", x: 694, y: 186, width: 12, height: 12, rx: 5 }, phG);
mk("path", { d: "M714 188H736", stroke: "var(--anatomy-mid)", "stroke-width": 1.6 }, phG);
mk("rect", { class: "lk-fus", x: 744, y: 170, width: 12, height: 36, rx: 5 }, phG); mk("rect", { class: "lk-chr22", x: 744, y: 170, width: 12, height: 13, rx: 5 }, phG);
[["9", 668, 230], ["22", 700, 230], ["BCR-ABL", 750, 230]].forEach(([tx, x, y]) => { const e = mk("text", { class: "lk-pht", x, y, "text-anchor": "middle" }, phG); e.textContent = tx; });
/* particles */
const divs = mkPool(18, () => mk("circle", { class: "sc-p p-div", r: 2.2 }, LY.stage));
const tkis = mkPool(12, () => mk("circle", { class: "sc-p p-tki", r: 2.6 }, LY.stage));
const chemos = mkPool(8, () => { const g = mk("g", {}, LY.stage); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
/* labels and treatment marks */
const marks = [];
function addMark(drugs, cond, x, y, text, tx, ty, tip) { const g = mk("g", {}, LY.over); mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); pill(g, text, x, y, tx, ty, tip); marks.push({ g, drugs, cond }); return g; }
let phPill = null;
function initLabels() {
  pill(LY.over, "Stem cell", 95, 230, 110, 182, "Haematopoietic stem cell: the marrow stem cell that normally makes all blood cell lines. Leukaemia starts with a change in a stem or early progenitor cell.");
  pill(LY.over, "Progenitors", 240, 224, 288, 182, "Progenitor cells: partly committed early cells. They divide and then mature into red cells, white cells and platelets.");
  pill(LY.over, "Leukaemic cells", 460, 204, 482, 182, "The leukaemic clone: blasts in the acute leukaemias, excess myeloid cells in CML, and mature looking lymphocytes in CLL. They build up and crowd the marrow.");
  phPill = pill(LY.over, "Philadelphia chromosome", 750, 188, 852, 182, "Philadelphia chromosome: a swap between chromosomes 9 and 22 joins BCR to ABL, making a kinase that is always on. It is the driver of CML and the target of kinase inhibitors.");
  pill(LY.over, "Differentiation block", 610, 292, 500, 402, "Differentiation block: the leukaemic cells fail to mature, or crowd out maturation, so few normal mature cells are made despite a full marrow.");
  pill(LY.over, "Mature blood cells", 700, 360, 712, 402, "Mature neutrophils and other finished cells ready to leave the marrow. When they fall, infection risk rises.");
  pill(LY.over, "Peripheral blood", 863, 415, 863, 435, "Blood leaving the marrow. Low red cells cause anaemia, low neutrophils allow infection, and low platelets cause bruising and bleeding.");
  addMark([1], null, 460, 292, "Chemotherapy kills dividing blasts", 168, 402, "Chemotherapy kills dividing cells, including blasts. It also harms normal dividing marrow cells for a time.");
  addMark([2], (m) => m.t === 3 || m.t === 4, 750, 188, "Kinase inhibitor blocks BCR-ABL", 168, 402, "A targeted kinase inhibitor blocks the BCR-ABL kinase that drives CML, so the excess myeloid production switches off.");
  addMark([2], (m) => !(m.t === 3 || m.t === 4), 460, 292, "No BCR-ABL target here", 168, 402, "This leukaemia is not driven by BCR-ABL, so a BCR-ABL kinase inhibitor has no target and does little.");
  addMark([3], null, 95, 295, "Transplant replaces stem cells", 168, 402, "Stem cell transplant: after the leukaemic marrow is cleared, donor stem cells are given to rebuild a new, non leukaemic marrow.");
}
/* gauges */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Marrow and blood";
  [["clone", "Leukaemic cells", "g-bad", "How much of the marrow is taken over by the leukaemic clone. High means the marrow is crowded out."], ["red", "Red cells", "g-rbc", "Red cells carry oxygen. When they fall the patient is anaemic: pale, tired and breathless."], ["neut", "Neutrophils", "g-neu", "Neutrophils fight bacterial infection. When they fall, infection becomes likely and can be severe."], ["plt", "Platelets", "g-clot", "Platelets help blood clot. When they fall, bruising, gum bleeding and heavier bleeding follow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { blast: 0.8, clone: 0.8, lymph: 0, myel: 0.1, red: 0.3, neut: 0.2, plt: 0.2, mature: 0.2, ph: 0, block: 0.8 };
const acc = { div: 0, tki: 0, chemo: 0 };
let curT = -1;
function setPool(pool, n, dt, bob) { pool.forEach((c, i) => { const want = i < n ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2.2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * bob, c.y + Math.cos(tm / 900 + i) * bob, Math.sin(tm / 800 + i) * 6, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; }); }
function init() { initLabels(); initPanel(); }
function step(dt, m) {
  if (m.t !== curT) { curT = m.t; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", [1, 2, 3, 5].indexOf(m.t) === i || (m.t === 4 && i === 2) || (m.t === 6 && i === 3))); blasts.forEach((b) => b.g.setAttribute("class", m.t === 2 ? "cl cl-lyblast" : "cl cl-blast")); }
  const k = Math.min(1, dt * 1.6);
  sm.blast = lerp(sm.blast, m.blast, k); sm.clone = lerp(sm.clone, m.clone, k); sm.lymph = lerp(sm.lymph, m.lymph, k); sm.myel = lerp(sm.myel, m.myel, k);
  sm.red = lerp(sm.red, m.red, k); sm.neut = lerp(sm.neut, m.neut, k); sm.plt = lerp(sm.plt, m.plt, k); sm.mature = lerp(sm.mature, m.mature, k);
  sm.ph = lerp(sm.ph, (m.t === 3 || m.t === 4) ? 1 : 0, k); sm.block = lerp(sm.block, clamp(m.blast + m.lymph * 0.5), k);
  stems.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, (m.drug === 3 ? 1.12 : 1) + 0.03 * Math.sin(tm / 300 + i)));
  progs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 700 + i) * 2, Math.sin(tm / 900 + i) * 8, 1 - 0.35 * sm.block));
  setPool(blasts, Math.round(sm.blast * 28), dt, 2);
  setPool(lymphs, Math.round(sm.lymph * 28), dt, 1.4);
  setPool(myels, Math.round(clamp((sm.myel - 0.15) / 0.7) * 18), dt, 1.6);
  setPool(mats, Math.round(sm.neut * 6), dt, 1.4);
  blockG.setAttribute("opacity", sm.block.toFixed(2));
  phG.setAttribute("opacity", sm.ph.toFixed(2));
  const phb = $("phbox"); if (phb) phb.setAttribute("opacity", (sm.ph * 0.9).toFixed(2));
  if (phPill) { phPill.style.opacity = sm.ph.toFixed(2); phPill.style.display = sm.ph > 0.05 ? "" : "none"; }
  /* blood in the vessel: red cells and platelets flow down, fewer when the marrow fails */
  vesselRbcs.forEach((r, i) => { r.y += r.v * 26 * (0.3 + sm.red) * dt; if (r.y > 420) { r.y = 248; r.x = 832 + Math.floor(rnd(0, 3)) * 32; } place(r.g, r.x, r.y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = i < Math.round(sm.red * 10) ? 1 : 0; });
  vesselPlts.forEach((r, i) => { r.y += r.v * 20 * dt; if (r.y > 420) r.y = 250; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.plt * 6) ? 1 : 0; });
  /* dividing leukaemic cells shed small daughter dots */
  acc.div += dt * sm.clone * 5; while (acc.div >= 1) { acc.div--; const p = freeP(divs); if (p) emit(p, rnd(360, 580), rnd(220, 380), rnd(-14, 14), rnd(-14, 14), 0); }
  divs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* chemotherapy capsules drift to the blast crowd */
  acc.chemo += dt * (m.drug === 1 ? 2.2 : 0); while (acc.chemo >= 1) { acc.chemo--; const p = freeP(chemos); if (p) emit(p, rnd(200, 300), rnd(220, 300), 0, 0, 0); }
  chemos.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (460 - p.x) * dt * 0.6 + 14 * dt; p.y += (292 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2)); if (p.t > 4.7) kill(p); });
  /* kinase inhibitor dots home to the fusion gene in CML */
  acc.tki += dt * ((m.drug === 2 && sm.ph > 0.4) ? 4 : 0); while (acc.tki >= 1) { acc.tki--; const p = freeP(tkis); if (p) emit(p, rnd(620, 700), rnd(260, 320), 0, 0, 0); }
  tkis.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (750 - p.x) * dt * 1.4; p.y += (188 - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(750 - p.x, 188 - p.y) < 10 || p.t > 3) kill(p); });
  marks.forEach((mk2) => { const on = mk2.drugs.indexOf(m.drug) > -1 && (!mk2.cond || mk2.cond(m)); mk2.g.style.display = on ? "" : "none"; });
  gg.clone.set(sm.clone, wordOf(sm.clone, 0.25, 0.6, ["low", "moderate", "high"])); gg.red.set(sm.red, wordOf(sm.red, 0.35, 0.65, ["low", "reduced", "normal"]));
  gg.neut.set(sm.neut, wordOf(sm.neut, 0.35, 0.65, ["low", "reduced", "normal"])); gg.plt.set(sm.plt, wordOf(sm.plt, 0.35, 0.65, ["low", "reduced", "normal"]));
}
run({ init, step });
