/* Menstrual cycle scene: brain signals, follicle growth, ovulation, womb lining, and how hormonal contraception acts on each step. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
let brainO = null, ovaryO = null, uterO = null;
let BP = null, OP = null, UP = null;
let hypo = [148, 192], pit = [186, 277], ovIn = [310, 300], ovOut = [580, 300], dom = [445, 300];
let fund = [735, 227], ovL = [645, 255], cav = [735, 283], cerv = [735, 355];
let eggMid = [566, 284], eggTr = null;
let capEl = null, capDrug = -1;
let hypoDot = null, pitDot = null, glowEl = null, follEl = null, clEl = null, endoEl = null, glandsG = null, mucEl = null, eggEl = null;
let eggT = 0;
const rings = [], blocks = [];
const recX = [];
let recY = 0;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tx: 0, ty: 0 }; }); }
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.t = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const free = (pl) => pl.find((p) => !p.on);
function home(p, tx, ty, sp, dt) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; return d; }
const at = (p) => "translate(" + f1(p.x) + " " + f1(p.y) + ")";
const gnrh = pool(12, () => mk("path", { class: "sc-p p-gnrh", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts));
const fsh = pool(14, () => mk("circle", { class: "sc-p p-fsh", r: 2.6 }, layers.parts));
const lh = pool(14, () => mk("path", { class: "sc-p p-lh", d: "M0 -3.2L3 2.4L-3 2.4Z" }, layers.parts));
const e2 = pool(18, () => mk("circle", { class: "sc-p p-e2", r: 2.6 }, layers.parts));
const p4 = pool(14, () => mk("rect", { class: "sc-p p-p4", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, layers.parts));
const bleed = pool(14, () => mk("path", { class: "p-bleed", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
function capText(d) {
  if (d === 1) return "Combined pill switches off brain signals. No follicle growth, no ovulation, lining stays thin.";
  if (d === 2) return "Progestogen only method thickens the mucus gate and thins the lining. Ovulation can still occur.";
  return "No treatment. Brain signals grow a follicle, an egg is released and the lining builds, then sheds.";
}
function init() {
  brainO = organ($("brainSlot"), "brain", 165, 205, 210, {});
  ovaryO = organ($("ovarySlot"), "ovary", 445, 300, 260, {});
  uterO = organ($("uterSlot"), "uterus", 735, 275, 200, {});
  BP = brainO.ports; OP = ovaryO.ports; UP = uterO.ports;
  hypo = BP.parenchyma.slice(); pit = BP.stem.slice();
  ovIn = OP.in.slice(); ovOut = OP.out.slice(); dom = OP.dom.slice();
  fund = UP.fundus.slice(); ovL = UP.ovL.slice();
  cav = [UP.fundus[0], UP.fundus[1] + 56]; cerv = [UP.out[0], UP.out[1] + 14];
  const C = layers.cells;
  /* faint roads the signals travel, anchored on organ ports */
  mk("path", { class: "mn-route", d: "M" + f1(pit[0]) + " " + f1(pit[1]) + " C" + f1(pit[0] + 45) + " " + f1(pit[1] + 14) + " " + f1(ovIn[0] - 42) + " " + f1(ovIn[1] - 4) + " " + f1(ovIn[0]) + " " + f1(ovIn[1]) }, C);
  mk("path", { class: "mn-route", d: "M" + f1(dom[0]) + " " + f1(dom[1]) + " C" + f1(dom[0] - 85) + " " + f1(dom[1] - 80) + " " + f1(hypo[0] + 95) + " " + f1(hypo[1] + 12) + " " + f1(hypo[0]) + " " + f1(hypo[1]) }, C);
  mk("path", { class: "mn-route", d: "M" + f1(dom[0]) + " " + f1(dom[1]) + " C" + f1(dom[0] + 95) + " " + f1(dom[1] - 10) + " " + f1(fund[0] - 95) + " " + f1(fund[1] + 33) + " " + f1(fund[0]) + " " + f1(fund[1]) }, C);
  mk("path", { class: "mn-tube", d: "M" + f1(ovOut[0]) + " " + f1(ovOut[1]) + " C" + f1(ovOut[0] + 25) + " " + f1(ovOut[1] - 10) + " " + f1(ovL[0] - 20) + " " + f1(ovL[1] + 21) + " " + f1(ovL[0]) + " " + f1(ovL[1]) }, C);
  eggTr = track([dom.slice(), [dom[0] + 75, dom[1] - 10], [dom[0] + 155, dom[1] - 24], ovL.slice(), [cav[0] - 30, cav[1] - 13]]);
  eggMid = [eggTr.at(0.45).x, eggTr.at(0.45).y];
  /* brain activity glow plus pituitary pulse rings: the downstream signal, fading with treatment */
  glowEl = mk("ellipse", { class: "mn-glow", cx: f1(hypo[0]), cy: f1(hypo[1]), rx: 46, ry: 34, opacity: "0" }, C);
  for (let j = 0; j < 2; j++) rings.push(mk("circle", { class: "mn-ring", cx: f1(pit[0]), cy: f1(pit[1]), r: 30, opacity: "0" }, C));
  /* the two glands: hypothalamus source and pituitary relay */
  hypoDot = cell(C, { cls: "hypo", r: 10, nuc: 0.4, seed: 5, wob: 0.1, x: hypo[0], y: hypo[1] });
  pitDot = cell(C, { cls: "pit", r: 12, nuc: 0.4, seed: 9, wob: 0.1, x: pit[0], y: pit[1] });
  /* pill receptors across the pituitary, with blocker caps that sit on them while treated */
  recY = Math.round(pit[1] + 10);
  for (let i = 0; i < 5; i++) recX.push(Math.round(pit[0] - 40 + i * 20));
  recX.forEach((x) => mk("path", { class: "mn-rec", d: "M" + (x - 7) + " " + recY + " A7 7 0 0 1 " + (x + 7) + " " + recY }, C));
  recX.forEach((x) => { const g = mk("g", {}, C); mk("rect", { class: "mn-block", x: -7, y: -3.5, width: 14, height: 7, rx: 3.5 }, g); g.setAttribute("opacity", "0"); place(g, x, recY - 8, 0, 1); blocks.push({ e: g, v: 0 }); });
  /* the follicle at the ovary centre and the corpus luteum beside it */
  follEl = cell(C, { cls: "fol", r: 26, nuc: 0.35, seed: 7, wob: 0.08, x: dom[0], y: dom[1] });
  clEl = cell(C, { cls: "clu", r: 18, nuc: 0.3, seed: 12, wob: 0.1, x: dom[0] + 26, y: dom[1] + 10 });
  /* the lining inside the womb, with glands that answer progesterone */
  endoEl = mk("ellipse", { class: "mn-endo", cx: f1(cav[0]), cy: f1(cav[1]), rx: 20, ry: 30, opacity: "0.7" }, C);
  glandsG = mk("g", { opacity: "0" }, C);
  for (let i = 0; i < 4; i++) { const gx = cav[0] - 21 + i * 14;
    mk("path", { class: "mn-gland", d: "M" + f1(gx) + " " + f1(cav[1] - 24) + " c6 8 -6 12 0 20" }, glandsG);
    mk("path", { class: "mn-gland", d: "M" + f1(gx + 7) + " " + f1(cav[1] + 4) + " c6 8 -6 12 0 20" }, glandsG); }
  /* the mucus gate in the cervix */
  mucEl = mk("rect", { class: "mn-mucus", x: f1(cerv[0] - 11), y: f1(cerv[1] - 9), width: 22, height: 20, rx: 8, opacity: "0.4" }, C);
  eggEl = mk("circle", { class: "mn-egg", r: 7, cx: f1(dom[0]), cy: f1(dom[1]), opacity: "0" }, C);
  initPanel();
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Cycle signals";
  [["gnrh", "GnRH", "g-gnrh", "GnRH pulses from the hypothalamus. They drive the pituitary."], ["fsh", "FSH", "g-fsh", "Follicle stimulating hormone from the pituitary. It grows the ovarian follicle."], ["lh", "LH", "g-lh", "Luteinising hormone from the pituitary. A mid cycle surge triggers ovulation."], ["e2", "Oestradiol", "g-e2", "Oestradiol from the growing follicle. It builds the lining and helps trigger the LH surge."], ["p4", "Progesterone", "g-p4", "Progesterone from the corpus luteum after ovulation. It matures the lining."], ["endo", "Lining", "g-endo", "The womb lining. Oestradiol grows it, progesterone matures it, hormone fall sheds it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Brain", hypo[0], hypo[1], 150, 90, "Hypothalamus releases GnRH pulses and the pituitary answers with FSH and LH. Oestradiol feedback flips the system into the LH surge.");
  pill(o, "Combined pill", pit[0], pit[1] + 4, 150, 392, "Combined pill gives steady oestrogen plus progestogen feedback that switches off GnRH, FSH and the LH surge, so no follicle grows and no egg is released.");
  pill(o, "Ovary", OP.surf[0], OP.surf[1], 445, 150, "One follicle grows here each cycle, makes oestradiol, then releases its egg.");
  pill(o, "Follicle", dom[0], dom[1], 445, 404, "The growing follicle makes oestradiol. After ovulation it becomes the corpus luteum and makes progesterone.");
  pill(o, "Ovulation", eggMid[0], eggMid[1], 620, 150, "The LH surge ruptures the follicle and the egg travels along the tube toward the womb.");
  pill(o, "Womb", UP.fundus[0], UP.fundus[1], 800, 120, "The womb. Its lining builds under oestradiol, matures under progesterone, then sheds as menses when hormones fall.");
  pill(o, "Lining", cav[0] + 26, cav[1] + 19, 870, 240, "Womb lining. Thick and ready without treatment, thin on hormonal treatment.");
  pill(o, "Mucus gate", cerv[0], cerv[1] + 5, 862, 372, "Cervical mucus. Thin near ovulation so sperm can pass, thick on progestogen so they cannot.");
  capEl = mk("text", { class: "mn-cap", x: 30, y: 434 }, o); capEl.textContent = capText(0);
}
const sm = { GnRH: 0.5, FSH: 0.5, LH: 0.3, E2: 0.4, P4: 0.1, Foll: 0.5, CLu: 0, Endo: 0.4, Ov: 0, Bleed: 0, Muc: 0.3, comb: 0, pop: 0 };
const acc = { g: 0, f: 0, l: 0, e: 0, p: 0, b: 0, c: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.5), kf = Math.min(1, dt * 3);
  sm.GnRH = lerp(sm.GnRH, m.GnRH, k); sm.FSH = lerp(sm.FSH, m.FSH, k); sm.LH = lerp(sm.LH, m.LH, k); sm.E2 = lerp(sm.E2, m.E2, k); sm.P4 = lerp(sm.P4, m.P4, k);
  sm.Foll = lerp(sm.Foll, m.Foll, k); sm.CLu = lerp(sm.CLu, m.CLu, k); sm.Endo = lerp(sm.Endo, m.Endo, k); sm.Ov = lerp(sm.Ov, m.Ov, k); sm.Bleed = lerp(sm.Bleed, m.Bleed, k); sm.Muc = lerp(sm.Muc, m.Muc, k);
  sm.comb = lerp(sm.comb, m.comb, kf); sm.pop = lerp(sm.pop, m.pop, kf);
  /* glands pulse with their signals; the brain glow is the downstream signal, fading as blockers dock */
  place(hypoDot, hypo[0], hypo[1] + Math.sin(tm / 1200) * 2, 0, 1 + 0.08 * sm.GnRH * Math.sin(tm / 380));
  place(pitDot, pit[0], pit[1], 0, 1 + 0.06 * clamp((sm.FSH + sm.LH) / 2) * Math.sin(tm / 420));
  glowEl.setAttribute("opacity", (0.5 * clamp(sm.GnRH * 1.2) * (1 - 0.9 * sm.comb)).toFixed(2));
  rings.forEach((rg, j) => { const u = ((tm / 1500) + j * 0.5) % 1;
    rg.setAttribute("r", f1(30 + 15 * u)); rg.setAttribute("opacity", ((1 - u) * 0.5 * clamp((sm.FSH + sm.LH) / 2 + 0.15) * (1 - sm.comb)).toFixed(2)); });
  /* blocker caps sit on the pituitary receptors while the combined pill acts */
  const nb = Math.round(5 * sm.comb);
  blocks.forEach((b, i) => { b.v = lerp(b.v, i < nb ? 1 : 0, kf);
    b.e.setAttribute("opacity", b.v.toFixed(2)); place(b.e, recX[i], recY - 8 - (1 - b.v) * 10, 0, 0.6 + 0.4 * b.v); });
  /* follicle grows, corpus luteum follows ovulation */
  place(follEl, dom[0], dom[1], 0, clamp(0.3 + 0.85 * sm.Foll, 0.2, 1.3));
  clEl.setAttribute("opacity", sm.CLu > 0.03 ? (0.25 + 0.75 * sm.CLu).toFixed(2) : "0");
  place(clEl, dom[0] + 26, dom[1] + 10, 0, clamp(0.4 + 0.7 * sm.CLu, 0.3, 1.2));
  /* lining thickens or stays thin, glands answer progesterone, mucus gate opens or shuts */
  endoEl.setAttribute("rx", f1(12 + 20 * sm.Endo)); endoEl.setAttribute("ry", f1(16 + 36 * sm.Endo));
  endoEl.setAttribute("opacity", (0.55 + 0.45 * sm.Endo).toFixed(2));
  glandsG.setAttribute("opacity", (0.9 * sm.P4).toFixed(2));
  mucEl.setAttribute("height", f1(10 + 30 * sm.Muc)); mucEl.setAttribute("opacity", (0.25 + 0.75 * sm.Muc).toFixed(2));
  /* the egg travels to the womb only when ovulation happens */
  if (sm.Ov > 0.5) { eggT += dt * 0.22; const q = eggTr.at(eggT % 1);
    eggEl.setAttribute("cx", f1(q.x)); eggEl.setAttribute("cy", f1(q.y));
    eggEl.setAttribute("opacity", eggT % 1 > 0.92 ? "0.3" : "1");
  } else { eggT = 0; eggEl.setAttribute("opacity", "0"); }
  /* GnRH pulses run to the pituitary */
  acc.g += dt * m.GnRH * 7; while (acc.g >= 1) { acc.g--; const p = free(gnrh); if (p) emit(p, hypo[0] + rnd(-4, 4), hypo[1] + rnd(-4, 4)); }
  gnrh.forEach((p) => { if (!p.on) return;
    if (home(p, pit[0], pit[1], 95, dt) < 10) kill(p);
    else p.e.setAttribute("transform", at(p)); });
  /* FSH and LH run to the ovary */
  acc.f += dt * m.FSH * 8; while (acc.f >= 1) { acc.f--; const p = free(fsh); if (p) emit(p, pit[0] + rnd(-5, 5), pit[1] + rnd(-5, 5)); }
  fsh.forEach((p) => { if (!p.on) return;
    if (home(p, ovIn[0], ovIn[1], 95, dt) < 12) kill(p);
    else p.e.setAttribute("transform", at(p)); });
  acc.l += dt * m.LH * 9; while (acc.l >= 1) { acc.l--; const p = free(lh); if (p) emit(p, pit[0] + rnd(-5, 5), pit[1] + rnd(-5, 5)); }
  lh.forEach((p) => { if (!p.on) return;
    if (home(p, ovIn[0], ovIn[1], 95, dt) < 12) kill(p);
    else p.e.setAttribute("transform", at(p) + " rotate(" + f1(tm / 6) + ")"); });
  /* oestradiol feeds back to the brain and builds the lining */
  acc.e += dt * m.E2 * 10; while (acc.e >= 1) { acc.e--; const p = free(e2); if (p) { const toBrain = Math.random() < 0.45; emit(p, dom[0] + rnd(-8, 8), dom[1] + rnd(-8, 8)); p.tx = toBrain ? hypo[0] : fund[0]; p.ty = toBrain ? hypo[1] : fund[1]; } }
  e2.forEach((p) => { if (!p.on) return;
    if (home(p, p.tx, p.ty, 100, dt) < 14) kill(p);
    else p.e.setAttribute("transform", at(p)); });
  /* progesterone runs to the womb */
  acc.p += dt * m.P4 * 10; while (acc.p >= 1) { acc.p--; const p = free(p4); if (p) emit(p, dom[0] + 26 + rnd(-8, 8), dom[1] + 10 + rnd(-8, 8)); }
  p4.forEach((p) => { if (!p.on) return;
    if (home(p, fund[0], fund[1], 100, dt) < 14) kill(p);
    else p.e.setAttribute("transform", at(p)); });
  /* shed lining leaves as droplets */
  acc.b += dt * m.Bleed * 9; while (acc.b >= 1) { acc.b--; const p = free(bleed); if (p) { emit(p, cav[0] + rnd(-24, 24), cav[1] + 40); p.vy = 24 + rnd(0, 12); } }
  bleed.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", at(p)); p.e.setAttribute("opacity", clamp(1 - (p.y - cav[1] - 40) / 60).toFixed(2));
    if (p.y > cav[1] + 145) kill(p); });
  /* pill capsules travel in and dock: on pituitary receptors for the combined pill, on the cervix for progestogen only */
  if (drug === 1 || drug === 2) { acc.c += dt * 2.4;
    while (acc.c >= 1) { acc.c--; const p = free(caps); if (p) { emit(p, 80 + rnd(0, 12), 62 + rnd(0, 8)); p.k = Math.floor(rnd(0, 5));
      if (drug === 1) { p.tx = recX[p.k]; p.ty = recY - 10; } else { p.tx = cerv[0] + rnd(-8, 8); p.ty = cerv[1] - 6; } } } }
  caps.forEach((p) => { if (!p.on) return;
    if (p.st === 0) {
      if (home(p, p.tx, p.ty, 85, dt) < 10) { p.st = 1; p.t = 0; }
      else p.e.setAttribute("transform", at(p));
    } else { p.t += dt; p.e.setAttribute("transform", at(p));
      p.e.setAttribute("opacity", clamp(1 - (p.t - 0.8) / 0.6).toFixed(2));
      if (p.t > 1.4) kill(p); } });
  gg.gnrh.set(sm.GnRH, wordOf(sm.GnRH, 0.4, 0.65, ["slow", "steady", "fast"]));
  gg.fsh.set(sm.FSH, wordOf(sm.FSH, 0.35, 0.55, ["low", "mid", "high"]));
  gg.lh.set(sm.LH, wordOf(sm.LH, 0.4, 0.75, ["low", "rising", "surge"]));
  gg.e2.set(sm.E2, wordOf(sm.E2, 0.32, 0.65, ["low", "rising", "high"]));
  gg.p4.set(sm.P4, wordOf(sm.P4, 0.3, 0.65, ["low", "rising", "high"]));
  gg.endo.set(sm.Endo, wordOf(sm.Endo, 0.35, 0.68, ["thin", "growing", "thick"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
