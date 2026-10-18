/* Menstr scene: GnRH pulses, FSH and LH, follicle growth, ovulation, corpus luteum, endometrium and contraception. */
const L = { parts: $("parts"), over: $("over"), panel: $("panel"), hypo: $("hypoG"), pit: $("pitG"), follC: $("follC"), clG: $("clG"), cav: $("cavityE"), glands: $("glands"), mucus: $("mucusR"), ooc: $("oocyte") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gnrh = pool(12, () => mk("path", { class: "sc-p p-gnrh", d: "M0 -3L3 0L0 3L-3 0Z" }, L.parts));
const fsh = pool(16, () => mk("circle", { class: "sc-p p-fsh", r: 2.6 }, L.parts));
const lh = pool(16, () => mk("path", { class: "sc-p p-lh", d: "M0 -3.2L3 2.4L-3 2.4Z" }, L.parts));
const e2 = pool(20, () => mk("circle", { class: "sc-p p-e2", r: 2.6 }, L.parts));
const p4 = pool(20, () => mk("rect", { class: "sc-p p-p4", x: -2.3, y: -2.3, width: 4.6, height: 4.6, rx: 1 }, L.parts));
const bleed = pool(16, () => mk("path", { class: "p-bleed", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const caps = pool(8, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const tube = track([[316, 302], [390, 285], [470, 263], [562, 244]]);
const gg = {};
let tpComb, tpPop;
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Cycle signals";
  [["gnrh", "GnRH", "g-gnrh", "Gonadotropin releasing hormone from the hypothalamus, released in pulses. It drives the pituitary."], ["fsh", "FSH", "g-fsh", "Follicle stimulating hormone from the pituitary. It grows the ovarian follicle."], ["lh", "LH", "g-lh", "Luteinising hormone from the pituitary. A mid cycle surge triggers ovulation."], ["e2", "Oestradiol", "g-e2", "Oestradiol from the growing follicle. It builds the endometrium and, when high for long enough, helps trigger the LH surge."], ["p4", "Progesterone", "g-p4", "Progesterone from the corpus luteum after ovulation. It makes the endometrium secretory and slows GnRH pulses."], ["endo", "Endometrium", "g-endo", "The lining of the uterus. Oestradiol makes it grow, progesterone makes it secretory, and hormone fall makes it shed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function init() {
  const o = L.over;
  pill(o, "Hypothalamus", 185, 105, 100, 88, "The hypothalamus at the base of the brain. It releases GnRH in pulses and sets the rhythm of the cycle.");
  pill(o, "Pituitary", 212, 172, 100, 155, "The pituitary gland below the hypothalamus. GnRH makes it release FSH and LH into the blood.");
  pill(o, "GnRH pulses", 242, 148, 340, 125, "GnRH pulses travel the short portal blood supply from hypothalamus to pituitary. Pulse pattern controls FSH and LH release.");
  pill(o, "FSH", 216, 232, 130, 235, "FSH travels in the blood to the ovary and grows a follicle. The follicle in turn makes oestradiol.");
  pill(o, "LH surge", 246, 236, 365, 240, "When oestradiol stays high, feedback switches and LH surges. The surge is the trigger for ovulation.");
  pill(o, "Ovary", 168, 322, 95, 335, "The ovary. Each cycle a follicle grows here, releases an egg, and then forms the corpus luteum.");
  pill(o, "Follicle", 226, 338, 110, 395, "A fluid filled follicle around the egg. FSH grows it and its cells make oestradiol as it matures.");
  pill(o, "Corpus luteum", 258, 326, 365, 325, "What the follicle becomes after ovulation. The corpus luteum makes progesterone for the second half of the cycle.");
  pill(o, "Ovulation", 330, 298, 485, 200, "Ovulation: the mature follicle ruptures and the egg travels along the tube toward the uterus.");
  pill(o, "Oestradiol", 300, 272, 485, 130, "Oestradiol from the follicle acts on the brain and pituitary and builds the endometrium. High sustained levels help trigger the LH surge.");
  pill(o, "Progesterone", 330, 330, 485, 385, "Progesterone from the corpus luteum makes the endometrium secretory and slows GnRH pulses. Its fall brings on menses.");
  pill(o, "Uterus", 700, 196, 855, 150, "The uterus. Its inner lining, the endometrium, grows and then becomes secretory each cycle.");
  pill(o, "Endometrium", 624, 246, 855, 210, "The endometrium lining the uterus. It proliferates under oestradiol and becomes secretory under progesterone.");
  pill(o, "Cervical mucus", 660, 360, 855, 330, "Mucus in the cervix. Near ovulation it is thin and lets sperm pass. Progestogen makes it thick and hostile to sperm.");
  pill(o, "Menses", 642, 318, 855, 375, "Menses: when oestradiol and progesterone fall, the endometrium sheds and bleeding follows.");
  tpComb = pill(o, "Combined pill", 742, 212, 850, 88, "A combined pill gives oestrogen and progestogen feedback that suppresses GnRH, FSH and the LH surge, so ovulation is prevented.");
  tpPop = pill(o, "Progestogen only", 660, 372, 850, 88, "A progestogen only method mainly thickens cervical mucus and thins the endometrium. Ovulation is suppressed in some cycles but not all.");
  tpComb.setAttribute("id", "tp-comb"); tpPop.setAttribute("id", "tp-pop");
  initPanel();
}
const sm = { GnRH: 0.5, FSH: 0.5, LH: 0.3, E2: 0.4, P4: 0.1, Foll: 0.5, CLu: 0, Endo: 0.4, Ov: 0, Bleed: 0, Muc: 0.3, comb: 0, pop: 0 };
const acc = { g: 0, f: 0, l: 0, e: 0, p: 0, b: 0, c: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.GnRH = lerp(sm.GnRH, m.GnRH, k2); sm.FSH = lerp(sm.FSH, m.FSH, k2); sm.LH = lerp(sm.LH, m.LH, k2); sm.E2 = lerp(sm.E2, m.E2, k2); sm.P4 = lerp(sm.P4, m.P4, k2);
  sm.Foll = lerp(sm.Foll, m.Foll, k2); sm.CLu = lerp(sm.CLu, m.CLu, k2); sm.Endo = lerp(sm.Endo, m.Endo, k2); sm.Ov = lerp(sm.Ov, m.Ov, k1); sm.Bleed = lerp(sm.Bleed, m.Bleed, k2); sm.Muc = lerp(sm.Muc, m.Muc, k2);
  sm.comb = lerp(sm.comb, m.comb, k1); sm.pop = lerp(sm.pop, m.pop, k1);
  const pulse = 0.5 + 0.5 * Math.sin(tm / 380);
  L.hypo.setAttribute("transform", "translate(230 112) scale(" + (1 + 0.05 * sm.GnRH * pulse).toFixed(3) + ") translate(-230 -112)");
  L.pit.setAttribute("transform", "translate(230 175) scale(" + (1 + 0.06 * clamp((sm.FSH + sm.LH) / 2) * Math.sin(tm / 420)).toFixed(3) + ") translate(-230 -175)");
  L.follC.setAttribute("r", f1(8 + 26 * sm.Foll));
  const cs = 0.35 + 0.65 * sm.CLu;
  L.clG.setAttribute("opacity", sm.CLu > 0.03 ? (0.25 + 0.75 * sm.CLu).toFixed(2) : "0");
  L.clG.setAttribute("transform", "translate(252 318) scale(" + cs.toFixed(3) + ") translate(-252 -318)");
  L.cav.setAttribute("rx", f1(64 - 34 * sm.Endo)); L.cav.setAttribute("ry", f1(50 - 26 * sm.Endo));
  L.glands.setAttribute("opacity", (sm.P4 * 0.9).toFixed(2));
  L.mucus.setAttribute("opacity", (0.2 + 0.7 * sm.Muc).toFixed(2)); L.mucus.setAttribute("height", f1(12 + 22 * sm.Muc));
  if (sm.Ov > 0.35) { const u = (tm / 4200) % 1, pos = tube.at(u); L.ooc.setAttribute("cx", f1(pos.x)); L.ooc.setAttribute("cy", f1(pos.y)); L.ooc.setAttribute("opacity", (sm.Ov * (u > 0.92 ? 0.3 : 1)).toFixed(2)); } else L.ooc.setAttribute("opacity", "0");
  acc.g += dt * sm.GnRH * 7; while (acc.g >= 1) { acc.g--; const p = free(gnrh); if (p) emit(p, 230, 141, 0, 30, 0); }
  gnrh.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 156) kill(p); });
  acc.f += dt * sm.FSH * 8; while (acc.f >= 1) { acc.f--; const p = free(fsh); if (p) emit(p, 218, 196, 5, 38, 0); }
  fsh.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 258 || p.x > 930) kill(p); });
  acc.l += dt * sm.LH * 9; while (acc.l >= 1) { acc.l--; const p = free(lh); if (p) emit(p, 242, 196, -4, 40, 0); }
  lh.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > 258) kill(p); });
  acc.e += dt * sm.E2 * 10; while (acc.e >= 1) { acc.e--; const p = free(e2); if (p) { const toUt = Math.random() < 0.55; emit(p, 252, 280, toUt ? rnd(42, 58) : rnd(-14, -6), toUt ? rnd(-12, -4) : rnd(-44, -34), toUt ? 1 : 0); } }
  e2.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.k === 1 && p.x > 548) kill(p); if (p.k === 0 && p.y < 148) kill(p); });
  acc.p += dt * sm.P4 * 10; while (acc.p >= 1) { acc.p--; const p = free(p4); if (p) emit(p, 264, 312, rnd(44, 58), rnd(-12, -4), 0); }
  p4.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 548) kill(p); });
  acc.b += dt * sm.Bleed * 9; while (acc.b >= 1) { acc.b--; const p = free(bleed); if (p) emit(p, 660 + rnd(-28, 28), 320, 0, rnd(24, 34), 0); }
  bleed.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 620, 700)) + " " + f1(p.y) + ")"); if (p.y > 428) kill(p); });
  const drugAmt = Math.max(sm.comb, sm.pop);
  acc.c += dt * drugAmt * 3; while (acc.c >= 1) { acc.c--; const p = free(caps); if (p) emit(p, 852, 112, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? 650 : 236, ty = p.k ? 238 : 118; p.x += (tx - p.x) * dt * 0.8; p.y += (ty - p.y) * dt * 0.8 + 8 * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 52, 432); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6) kill(p); });
  $("tp-comb").style.opacity = sm.comb.toFixed(2); $("tp-pop").style.opacity = sm.pop.toFixed(2);
  gg.gnrh.set(sm.GnRH, wordOf(sm.GnRH, 0.4, 0.65, ["slow", "steady", "fast"]));
  gg.fsh.set(sm.FSH, wordOf(sm.FSH, 0.35, 0.55, ["low", "mid", "high"]));
  gg.lh.set(sm.LH, wordOf(sm.LH, 0.4, 0.75, ["low", "rising", "surge"]));
  gg.e2.set(sm.E2, wordOf(sm.E2, 0.32, 0.65, ["low", "rising", "high"]));
  gg.p4.set(sm.P4, wordOf(sm.P4, 0.3, 0.65, ["low", "rising", "high"]));
  gg.endo.set(sm.Endo, wordOf(sm.Endo, 0.35, 0.68, ["thin", "growing", "thick"]));
}
run({ init, step });
