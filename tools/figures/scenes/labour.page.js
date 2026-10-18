/* Labour scene: Ferguson reflex loop, oxytocin and prostaglandin particles, contractions, cervix and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel") };
const uterusG = $("uterusG"), fetusG = $("fetusG"), placG = $("placG"), arcs = $("contrArcs"), tocoMark = $("tocoMark");
const cxL = $("cxL"), cxR = $("cxR"), guideL = $("guideL"), guideR = $("guideR"), ticks = $("stretchTicks");
const stageHi = [0, 1, 2, 3].map((i) => $("stg" + i));
const bloodTrack = track([[712, 150], [620, 90], [470, 78], [352, 94]]);
const nerveTrack = track([[338, 388], [618, 388], [674, 300], [704, 168]]);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const oxy = pool(26, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, layers.parts));
const nerv = pool(16, () => mk("circle", { class: "sc-p p-nerve", r: 2.4 }, layers.parts));
const pgs = pool(22, () => mk("path", { class: "sc-p p-pg", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emitTrack(p, u) { p.on = true; p.u = u; p.e.setAttribute("opacity", "1"); }
function emitDrift(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let augPill = null, tocoPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The labour";
  [["str", "Stretch", "g-str", "Stretch of the cervix and lower uterus by the presenting part. This is the signal that starts the Ferguson reflex."], ["oxy", "Oxytocin", "g-oxy", "Released in pulses from the posterior pituitary when the cervix is stretched. It strengthens uterine contractions."], ["pg", "Prostaglandins", "g-pg", "Made by the membranes and decidua. They ripen the cervix and make the uterus more sensitive to oxytocin."], ["con", "Contractions", "g-bad", "Uterine contractions, driven by oxytocin and prostaglandins. A tocolytic calms them; oxytocin augmentation strengthens them."], ["cx", "Cervix", "g-good", "How far the cervix has effaced and opened. Prostaglandins ripen it and contractions open it."], ["des", "Descent", "g-fl", "Descent of the presenting part through the birth canal. It rises as contractions build, and ends with delivery."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Contraction", 250, 100, 115, 130, "Uterine contraction: the myometrium contracts from the fundus down, pushing the presenting part against the cervix.");
  pill(ox, "Fetal head", 270, 298, 140, 272, "The presenting part, here the fetal head. It presses on and stretches the cervix as it descends.");
  pill(ox, "Cervix", 262, 372, 135, 372, "Cervix: it softens, effaces (thins) and dilates (opens) during the first stage, helped by prostaglandins and by stretch.");
  pill(ox, "Birth canal", 300, 418, 135, 418, "Birth canal: the cervix, vagina and pelvic floor the baby passes through in the second stage.");
  pill(ox, "Placenta", 392, 195, 490, 190, "Placenta: attached to the uterine wall. In the third stage contractions separate and deliver it after the baby.");
  pill(ox, "Membranes", 398, 245, 490, 248, "Fetal membranes and decidua: stretched tissues here release prostaglandins that ripen the cervix and sensitise the uterus.");
  pill(ox, "Prostaglandins", 368, 320, 515, 302, "Prostaglandins from the membranes and decidua: they ripen the cervix, form gap junctions and boost the response to oxytocin.");
  pill(ox, "Oxytocin", 540, 88, 540, 64, "Oxytocin: released from the posterior pituitary into the blood and carried to the uterus, where it strengthens contractions.");
  pill(ox, "Hypothalamus", 738, 104, 832, 86, "Hypothalamus and posterior pituitary: stretch signals from the cervix arrive here and trigger pulsatile oxytocin release, the Ferguson reflex.");
  pill(ox, "Stretch signal", 618, 388, 575, 358, "Stretch signal: afferent nerves from the cervix carry the stretch signal to the spinal cord and up to the hypothalamus.");
  augPill = pill(ox, "Augmentation", 560, 90, 630, 146, "Oxytocin augmentation: extra oxytocin effect strengthens contractions when labour is slow.");
  tocoPill = pill(ox, "Tocolytic", 428, 128, 520, 130, "A tocolytic calms the myometrium, so contractions weaken even though oxytocin is still released.");
}
const sm = { St: 0.4, O: 0.3, Pg: 0.4, C: 0.3, D: 0.3, Desc: 0.2, aug: 0, toco: 0, deliv: 0 };
const acc = { oxy: 0, nerv: 0, pg: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.St = lerp(sm.St, m.St, k2); sm.O = lerp(sm.O, m.O, k2); sm.Pg = lerp(sm.Pg, m.Pg, k2); sm.C = lerp(sm.C, m.C, k1); sm.D = lerp(sm.D, m.D, k2); sm.Desc = lerp(sm.Desc, m.Desc, k2); sm.aug = lerp(sm.aug, m.aug, k1); sm.toco = lerp(sm.toco, m.toco, k1); sm.deliv = lerp(sm.deliv, m.stage === 3 ? 1 : 0, k2);
  stageHi.forEach((e, i) => { if (e) e.style.opacity = i === m.stage ? "0.32" : "0.06"; });
  /* contractions: episodic squeeze of the uterus */
  const wave = Math.pow(Math.max(0, Math.sin(tm / 850)), 3) * sm.C;
  uterusG.setAttribute("transform", "translate(300 230) scale(" + (1 - 0.02 * wave).toFixed(3) + " " + (1 + 0.012 * wave).toFixed(3) + ") translate(-300 -230)");
  arcs.setAttribute("opacity", wave.toFixed(2));
  tocoMark.setAttribute("opacity", sm.toco.toFixed(2));
  /* fetus descends; in the third stage it has been delivered and the placenta follows */
  const yOff = sm.Desc * 44 + sm.deliv * 58 + wave * 3;
  fetusG.setAttribute("transform", "translate(0 " + f1(yOff) + ")");
  fetusG.style.opacity = (1 - sm.deliv * 0.96).toFixed(2);
  placG.setAttribute("transform", "translate(0 " + f1(sm.deliv * 92) + ")");
  /* cervix: lips part as it dilates and shorten as it effaces */
  const eff = clamp(0.6 * sm.D + 0.4 * sm.Pg), ch = 42 - 19 * eff, gap = sm.D * 20;
  cxL.setAttribute("x", f1(262 - gap)); cxL.setAttribute("height", f1(ch)); cxR.setAttribute("x", f1(310 + gap)); cxR.setAttribute("height", f1(ch));
  guideL.setAttribute("d", "M" + f1(276 - gap) + " 396C" + f1(268 - gap - 4) + " 414 " + f1(262 - gap - 6) + " 426 " + f1(258 - gap - 8) + " 438");
  guideR.setAttribute("d", "M" + f1(324 + gap) + " 396C" + f1(332 + gap + 4) + " 414 " + f1(338 + gap + 6) + " 426 " + f1(342 + gap + 8) + " 438");
  ticks.setAttribute("opacity", (sm.St * (0.45 + 0.55 * wave)).toFixed(2));
  /* stretch signal: cervix to hypothalamus */
  acc.nerv += dt * sm.St * 6; while (acc.nerv >= 1) { acc.nerv--; const p = free(nerv); if (p) emitTrack(p, 0); }
  nerv.forEach((p) => { if (!p.on) return; p.u += dt * 0.22; if (p.u >= 1) { kill(p); return; } const q = nerveTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* oxytocin: pituitary to uterus in the blood */
  acc.oxy += dt * sm.O * 11; while (acc.oxy >= 1) { acc.oxy--; const p = free(oxy); if (p) emitTrack(p, 0); }
  oxy.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; if (p.u >= 1) { kill(p); return; } const q = bloodTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* prostaglandins: membranes and decidua down to the cervix */
  acc.pg += dt * sm.Pg * 8; while (acc.pg >= 1) { acc.pg--; const p = free(pgs); if (p) emitDrift(p, rnd(350, 382), rnd(292, 322), rnd(-26, -8), rnd(16, 30)); }
  pgs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > 382 || p.t > 3) kill(p); });
  /* treatment badges */
  if (augPill) augPill.style.opacity = sm.aug.toFixed(2);
  if (tocoPill) tocoPill.style.opacity = sm.toco.toFixed(2);
  /* gauges */
  gg.str.set(sm.St, wordOf(sm.St, 0.3, 0.62, ["low", "rising", "high"])); gg.oxy.set(sm.O, wordOf(sm.O, 0.3, 0.62, ["low", "rising", "high"])); gg.pg.set(sm.Pg, wordOf(sm.Pg, 0.3, 0.62, ["low", "rising", "high"]));
  gg.con.set(sm.C, wordOf(sm.C, 0.3, 0.62, ["mild", "regular", "strong"])); gg.cx.set(sm.D, wordOf(sm.D, 0.3, 0.7, ["closed", "opening", "fully open"])); gg.des.set(sm.Desc, wordOf(sm.Desc, 0.3, 0.7, ["high", "descending", "delivered"]));
}
run({ init, step });
