/* PCOS scene: pituitary LH pulses, pancreatic insulin, muscle insulin resistance, ovarian androgens, arrested follicles, ovulation, skin signs and womb lining. */
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
let pancO = null, muscO = null, ovaryO = null, uterO = null;
let PP = null, MP = null, OP = null, UP = null;
let capEl = null, capDrug = -1;
let belly = [104, 336];
const recX = [];
let recY = 344;
let glowEl = null, glowV = 0;
let liningEl = null;
let eggEl = null, eggT = 0, eggTr = null;
let domEl = null, domPulse = 0;
let pitEl = null;
const rings = [], fols = [], blocks = [];
let seb1 = null, seb2 = null, hair1 = null, hair2 = null, hair3 = null;
let lhSrc = [163, 132], insSrc = [202, 232], insOSrc = [202, 240], andSrc = [621, 235];
let skinDst = [748, 212], ovaryDst = [318, 256];
let metN = 0;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.t = 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const free = (pl) => pl.find((p) => !p.on);
function home(p, tx, ty, sp, dt) { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; return d; }
const at = (p) => "translate(" + f1(p.x) + " " + f1(p.y) + ")";
const lhP = pool(22, () => mk("circle", { class: "sc-p p-lh", r: 3 }, layers.parts));
const insP = pool(26, () => mk("circle", { class: "sc-p p-ins", r: 3 }, layers.parts));
const insOP = pool(12, () => mk("circle", { class: "sc-p p-ins", r: 3 }, layers.parts));
const andP = pool(24, () => mk("path", { class: "sc-p p-and", d: "M0 -3.4L3 2L-3 2Z" }, layers.parts));
function capsuleG(parent) { const g = mk("g", {}, parent); mk("rect", { class: "sc-p p-met", x: -7, y: -3.5, width: 14, height: 7, rx: 3.5 }, g); mk("rect", { class: "p-met2", x: 0, y: -3.5, width: 7, height: 7, rx: 3.5 }, g); return g; }
const metP = pool(10, () => capsuleG(layers.parts));
const ovuP = pool(8, () => mk("circle", { class: "sc-p p-ovu", r: 3.4 }, layers.parts));
const shedP = pool(12, () => mk("path", { class: "p-shed", d: "M0 -3.6C2.4 -.6 3 1 3 2A3 3 0 0 1 -3 2C-3 1 -2.4 -.6 0 -3.6Z" }, layers.parts));
const sparkP = pool(8, () => mk("path", { class: "p-spark", d: "M-4 0L4 0M0 -4L0 4" }, layers.parts));
function capText(d) {
  if (d === 1) return "Lifestyle change lowers insulin resistance. Less insulin drives the ovary and androgens fall.";
  if (d === 2) return "Metformin helps insulin work again. Insulin falls and androgen excess eases.";
  if (d === 3) return "Combined care restores ovulation. An egg is released, the lining sheds and androgens fall.";
  return "No treatment. Extra LH and insulin drive androgens up, follicles stall and ovulation is rare.";
}
function init() {
  pancO = organ($("pancSlot"), "pancreas", 135, 232, 150, {});
  muscO = organ($("muscSlot"), "muscle", 135, 338, 170, {});
  ovaryO = organ($("ovarySlot"), "ovary", 465, 235, 300, {});
  uterO = organ($("uterSlot"), "uterus", 815, 322, 130, {});
  PP = pancO.ports; MP = muscO.ports; OP = ovaryO.ports; UP = uterO.ports;
  belly = MP.belly.slice();
  const C = layers.cells;
  lhSrc = [135 + 28, 132];
  insSrc = PP.out.slice(); insOSrc = [PP.out[0], PP.out[1] + 8];
  andSrc = OP.out.slice(); skinDst = [748, 212]; ovaryDst = [OP.in[0] + 9, OP.in[1] + 21];
  mk("path", { class: "pc-route", d: "M" + f1(lhSrc[0]) + " " + f1(lhSrc[1]) + "L" + f1(OP.in[0]) + " " + f1(OP.in[1]) }, C);
  mk("path", { class: "pc-route", d: "M" + f1(insSrc[0]) + " " + f1(insSrc[1]) + "L" + f1(belly[0]) + " " + f1(belly[1]) }, C);
  mk("path", { class: "pc-route", d: "M" + f1(insOSrc[0]) + " " + f1(insOSrc[1]) + "L" + f1(ovaryDst[0]) + " " + f1(ovaryDst[1]) }, C);
  mk("path", { class: "pc-route", d: "M" + f1(andSrc[0]) + " " + f1(andSrc[1]) + "L" + f1(skinDst[0]) + " " + f1(skinDst[1]) }, C);
  /* insulin receptors across the muscle belly, with blocker caps that sit on them while resistant */
  recY = Math.round(belly[1] + 8);
  for (let i = 0; i < 5; i++) recX.push(Math.round(belly[0] - 40 + i * 20));
  recX.forEach((x) => mk("path", { class: "pc-rec", d: "M" + (x - 7) + " " + recY + " A7 7 0 0 1 " + (x + 7) + " " + recY }, C));
  recX.forEach((x) => { const g = mk("g", {}, C); mk("rect", { class: "pc-block", x: -7, y: -10, width: 14, height: 7, rx: 3.5 }, g); g.setAttribute("opacity", "0"); blocks.push({ e: g, v: 0 }); });
  glowEl = mk("ellipse", { class: "pc-glow", cx: f1(belly[0]), cy: f1(belly[1]), rx: 58, ry: 24, opacity: "0" }, C);
  /* pituitary with outgoing pulse rings */
  pitEl = cell(C, { cls: "pit", r: 28, nuc: 0.4, seed: 3, wob: 0.12, x: 135, y: 132 });
  for (let j = 0; j < 2; j++) rings.push(mk("circle", { class: "pc-ring", cx: 135, cy: 132, r: 30, opacity: "0" }, C));
  /* arrested follicles ringing the ovary, one dominant follicle at the centre, one egg */
  const FC = OP.dom;
  for (let i = 0; i < 10; i++) { const t = (i / 10) * 6.2832, fx = FC[0] + Math.cos(t) * 84, fy = FC[1] + Math.sin(t) * 54;
    fols.push({ g: cell(C, { cls: "fol", r: 15, nuc: 0.35, seed: i + 11, wob: 0.1, x: fx, y: fy }), x: fx, y: fy, i }); }
  domEl = cell(C, { cls: "dom", r: 24, nuc: 0.3, seed: 7, wob: 0.08, x: FC[0], y: FC[1] });
  eggEl = mk("circle", { class: "pc-egg", r: 7, cx: f1(FC[0]), cy: f1(FC[1]), opacity: "0" }, C);
  eggTr = track([FC, [FC[0] + 120, FC[1] - 23], [FC[0] + 220, FC[1] + 5], [UP.ovL[0] + 13, UP.ovL[1] - 11]]);
  /* skin and hair patch */
  mk("rect", { class: "pc-skin", x: 742, y: 158, width: 148, height: 98, rx: 12 }, C);
  seb1 = mk("ellipse", { class: "pc-seb", cx: 790, cy: 205, rx: 12, ry: 8 }, C);
  seb2 = mk("ellipse", { class: "pc-seb", cx: 842, cy: 205, rx: 12, ry: 8 }, C);
  hair1 = mk("path", { class: "pc-hair", d: "M790 198 L782 168" }, C);
  hair2 = mk("path", { class: "pc-hair", d: "M816 200 L816 164" }, C);
  hair3 = mk("path", { class: "pc-hair", d: "M842 198 L850 168" }, C);
  /* womb lining bar inside the uterine cavity */
  liningEl = mk("rect", { class: "pc-lining", x: 806, y: 333, width: 18, height: 15, rx: 4 }, C);
  initPanel();
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The person";
  [["lh", "LH", "g-lh", "Luteinising hormone from the pituitary. In PCOS its pulses are stronger, driving ovarian androgen production."], ["ir", "Insulin resist.", "g-ins", "Insulin resistance: muscle and fat respond less to insulin, so more insulin circulates and acts on the ovary."], ["and", "Androgens", "g-and", "Ovarian androgen excess, driven by LH together with insulin. Androgens arrest follicles and act on skin and hair."], ["ovu", "Ovulation", "g-good", "Release of an egg. Arrested follicles mean ovulation is infrequent and periods are irregular."], ["sgn", "Skin and hair", "g-sgn", "Acne and extra hair growth from androgens acting on skin and hair follicles."], ["met", "Metabolic risk", "g-met", "Longer term metabolic risk linked to insulin resistance, including diabetes risk."]]
    .forEach((row, i) => { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Pituitary", 135, 122, 135, 84, "Pituitary gland: releases LH in pulses. In PCOS the pulses are stronger and LH runs high.");
  pill(ox, "Pancreas", 105, 205, 66, 168, "Pancreas: releases insulin. In PCOS insulin runs high because muscle and fat resist it.");
  pill(ox, "Muscle", 135, 326, 135, 392, "Muscle: resists insulin in PCOS, so insulin cannot dock and the downstream signal fades. Treatment unblocks the receptors.");
  pill(ox, "Ovary", 465, 158, 470, 84, "Ovary: LH plus extra insulin drive its theca cells to make too much androgen.");
  pill(ox, "Follicles", 381, 235, 300, 392, "Arrested follicles: many small follicles stall before one becomes dominant. These are the so called cysts.");
  pill(ox, "Skin", 800, 200, 816, 84, "Skin and hair: androgens enlarge oil glands, causing acne, and thicken hair growth.");
  pill(ox, "Womb", 788, 340, 768, 392, "Womb lining: without regular ovulation it is not shed, so it builds up. Restored ovulation lets it shed.");
  capEl = mk("text", { class: "pc-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0);
}
const sm = { LH: 0.5, IR: 0.5, A: 0.4, F: 0.4, O: 0.4, Sg: 0.3, M: 0.4 };
const acc = { lh: 0, insM: 0, insO: 0, and: 0, met: 0, ovu: 0, shed: 0, spark: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.LH = lerp(sm.LH, m.LH, k); sm.IR = lerp(sm.IR, m.IR, k); sm.A = lerp(sm.A, m.A, k);
  sm.F = lerp(sm.F, m.F, k); sm.O = lerp(sm.O, m.O, k); sm.Sg = lerp(sm.Sg, m.Sg, k); sm.M = lerp(sm.M, m.M, k);
  glowV = lerp(glowV, (1 - sm.IR) * 0.7, k);
  /* pituitary pulses harder when LH is high */
  place(pitEl, 135, 132 + Math.sin(tm / 1200) * 2, 0, 1 + 0.04 * sm.LH * Math.sin(tm / 280));
  rings.forEach((rg, j) => { const p = ((tm / 1500) + j * 0.5) % 1;
    rg.setAttribute("r", f1(30 + 15 * p)); rg.setAttribute("opacity", ((1 - p) * 0.5 * clamp(sm.LH + 0.15)).toFixed(2)); });
  /* blocker caps sit on muscle receptors while resistant, then pop off with treatment */
  const nb = Math.round(5 * sm.IR);
  blocks.forEach((b, i) => { b.v = lerp(b.v, i < nb ? 1 : 0, Math.min(1, dt * 2));
    b.e.setAttribute("opacity", b.v.toFixed(2)); place(b.e, recX[i], recY - 8 - (1 - b.v) * 10, 0, 0.6 + 0.4 * b.v); });
  glowEl.setAttribute("opacity", (glowV * 0.5).toFixed(2));
  /* follicles shrink and clear as androgens fall; the dominant follicle grows with ovulation */
  fols.forEach((fo) => { const on = (fo.i / 10) < (0.3 + 0.7 * sm.F);
    if (!on) { fo.g.style.opacity = "0"; return; }
    fo.g.style.opacity = "1";
    place(fo.g, fo.x, fo.y, 0, clamp((0.3 + 0.8 * sm.F) * (0.85 + 0.15 * Math.sin(tm / 900 + fo.i)), 0.2, 1.1)); });
  domPulse = Math.max(0, domPulse - dt * 0.8);
  place(domEl, OP.dom[0], OP.dom[1], 0, clamp(0.45 + 0.85 * sm.O + domPulse * 0.3, 0.3, 1.4));
  /* the egg travels to the tube only once ovulation is restored */
  if (sm.O > 0.5) { eggT += dt * 0.22; const q = eggTr.at(eggT % 1);
    eggEl.setAttribute("cx", f1(q.x)); eggEl.setAttribute("cy", f1(q.y));
    eggEl.setAttribute("opacity", clamp((sm.O - 0.5) * 2.4).toFixed(2));
  } else { eggT = 0; eggEl.setAttribute("opacity", "0"); }
  /* womb lining builds without ovulation and thins once it sheds */
  const lhgt = 5 + 13 * (1 - sm.O);
  liningEl.setAttribute("height", f1(lhgt)); liningEl.setAttribute("y", f1(350 - lhgt));
  /* skin and hair follow androgens */
  const hs = 0.6 + 0.7 * sm.Sg;
  hair1.setAttribute("transform", "translate(790 198) scale(1 " + hs.toFixed(2) + ") translate(-790 -198)");
  hair2.setAttribute("transform", "translate(816 200) scale(1 " + hs.toFixed(2) + ") translate(-816 -200)");
  hair3.setAttribute("transform", "translate(842 198) scale(1 " + hs.toFixed(2) + ") translate(-842 -198)");
  seb1.setAttribute("rx", f1(8 + 7 * sm.Sg)); seb2.setAttribute("rx", f1(8 + 7 * sm.Sg));
  /* LH pulses travel to the ovary */
  acc.lh += dt * (0.5 + 6.5 * sm.LH);
  while (acc.lh >= 1) { acc.lh--; const p = free(lhP); if (p) emit(p, lhSrc[0] + rnd(-4, 4), lhSrc[1] + rnd(-8, 8)); }
  lhP.forEach((p) => { if (!p.on) return;
    if (home(p, OP.in[0], OP.in[1], 95, dt) < 12) kill(p);
    else p.e.setAttribute("transform", at(p)); });
  /* insulin heads for muscle receptors: blocked particles bounce off, free ones dock */
  acc.insM += dt * (0.5 + 6 * sm.IR);
  while (acc.insM >= 1) { acc.insM--; const p = free(insP); if (p) { p.k = Math.floor(rnd(0, 5)); emit(p, insSrc[0] + rnd(-6, 6), insSrc[1] + rnd(-6, 6)); } }
  insP.forEach((p) => { if (!p.on) return;
    if (p.st === 0) {
      if (home(p, recX[p.k], recY, 90, dt) < 10) {
        if (p.k < Math.round(5 * sm.IR)) { p.st = 1; p.t = 0; p.vx = rnd(-40, 40); p.vy = -50 - rnd(0, 40); }
        else { glowV = Math.min(1, glowV + 0.08); kill(p); }
      } else p.e.setAttribute("transform", at(p));
    } else { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.e.setAttribute("transform", at(p)); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2));
      if (p.t > 0.9) kill(p); } });
  /* extra insulin also reaches the ovary and drives androgen excess */
  acc.insO += dt * 5 * sm.IR;
  while (acc.insO >= 1) { acc.insO--; const p = free(insOP); if (p) emit(p, insOSrc[0] + rnd(-6, 6), insOSrc[1] + rnd(-6, 6)); }
  insOP.forEach((p) => { if (!p.on) return;
    if (home(p, ovaryDst[0], ovaryDst[1], 90, dt) < 12) kill(p);
    else p.e.setAttribute("transform", at(p)); });
  /* androgens travel to skin and hair */
  acc.and += dt * 8 * sm.A;
  while (acc.and >= 1) { acc.and--; const p = free(andP); if (p) emit(p, andSrc[0] + rnd(-8, 8), andSrc[1] + rnd(-12, 12)); }
  andP.forEach((p) => { if (!p.on) return;
    if (home(p, skinDst[0], skinDst[1], 105, dt) < 14) kill(p);
    else p.e.setAttribute("transform", at(p) + " rotate(" + f1(tm / 6) + ")"); });
  /* metformin capsules dock on muscle receptors */
  if (drug === 2 || drug === 3) { acc.met += dt * (drug === 2 ? 2.4 : 1.2);
    while (acc.met >= 1) { acc.met--; const p = free(metP); if (p) { p.k = metN % 5; metN++; emit(p, 60 + rnd(0, 10), 100 + rnd(0, 10)); } } }
  metP.forEach((p) => { if (!p.on) return;
    if (p.st === 0) {
      if (home(p, recX[p.k], recY - 8, 80, dt) < 10) { p.st = 1; p.t = 0; }
      else p.e.setAttribute("transform", at(p));
    } else { p.t += dt; p.e.setAttribute("transform", at(p));
      if (p.t > 1.1) kill(p); } });
  /* ovulation induction tablets act on the ovary */
  if (drug === 3) { acc.ovu += dt * 1.1;
    while (acc.ovu >= 1) { acc.ovu--; const p = free(ovuP); if (p) emit(p, 60 + rnd(0, 10), 100 + rnd(0, 10)); } }
  ovuP.forEach((p) => { if (!p.on) return;
    if (home(p, OP.dom[0], OP.dom[1], 85, dt) < 14) { domPulse = 1; kill(p); }
    else p.e.setAttribute("transform", at(p)); });
  /* the shed lining leaves as droplets */
  if (drug === 3) { acc.shed += dt * 5;
    while (acc.shed >= 1) { acc.shed--; const p = free(shedP); if (p) { emit(p, 808 + rnd(0, 14), 350); p.vy = 44 + rnd(0, 26); } } }
  shedP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", at(p)); p.e.setAttribute("opacity", clamp(1 - (p.y - 350) / 48).toFixed(2));
    if (p.y > 398) kill(p); });
  /* lifestyle shows as activity sparkles around the muscle */
  if (drug === 1) { acc.spark += dt * 4;
    while (acc.spark >= 1) { acc.spark--; const p = free(sparkP); if (p) emit(p, 70 + rnd(0, 130), 310 + rnd(0, 60)); } }
  sparkP.forEach((p) => { if (!p.on) return; p.t += dt;
    p.e.setAttribute("transform", at(p) + " rotate(" + f1(p.t * 80) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.6).toFixed(2));
    if (p.t > 0.6) kill(p); });
  gg.lh.set(sm.LH, wordOf(sm.LH, 0.35, 0.62, ["normal", "raised", "high"]));
  gg.ir.set(sm.IR, wordOf(sm.IR, 0.3, 0.58, ["low", "raised", "high"]));
  gg.and.set(sm.A, wordOf(sm.A, 0.3, 0.55, ["mild", "raised", "high"]));
  gg.ovu.set(sm.O, wordOf(sm.O, 0.3, 0.6, ["rare", "irregular", "regular"]));
  gg.sgn.set(sm.Sg, wordOf(sm.Sg, 0.3, 0.55, ["mild", "moderate", "marked"]));
  gg.met.set(sm.M, wordOf(sm.M, 0.3, 0.55, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
