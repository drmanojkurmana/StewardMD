/* Labour scene: Ferguson reflex loop, oxytocin and prostaglandin particles, contractions, cervix and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel") };
const uterusG = $("uterusG"), fetusG = $("fetusG"), placG = $("placG"), arcs = $("contrArcs");
const flush = $("flush"), tone = $("tone"), dripG = $("dripG");
const cxL = $("cxL"), cxR = $("cxR"), guideL = $("guideL"), guideR = $("guideR"), ticks = $("stretchTicks");
const stageHi = [0, 1, 2, 3].map((i) => $("stg" + i));
const receptG = $("receptG"), capsG = $("capsG"), bloodV = $("bloodV"), nerveP = $("nerveP");
let uterusO = null, brainO = null, capEl = null, capDrug = -1;
let bloodTrack = null, nerveTrack = null, dripTrack = null;
const recs = [], caps = [];
const dripDots = [$("drip0"), $("drip1"), $("drip2")];
const UX = 300, UY = 232;
function ptsD(pts) { return "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"); }
function initOrgans() {
  uterusO = organ($("uterusSlot"), "uterus", UX, UY, 270, { h: 330 });
  brainO = organ($("brainSlot"), "brain", 730, 130, 130, {});
  const UP = uterusO.ports, BP = brainO.ports;
  const F = UP.fundus, Sb = BP.stem || BP.in, Cb = BP.carotid || BP.in;
  const mid = (a, b, t, dy) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + dy];
  const bpts = [Sb, mid(Sb, F, 0.35, -45), mid(Sb, F, 0.7, -30), F];
  bloodTrack = track(bpts);
  bloodV.setAttribute("d", ptsD(bpts));
  const Cx = [338, 388];
  const npts = [Cx, [500, 388], [Cx[0] + (Cb[0] - Cx[0]) * 0.75, 388 + (Cb[1] - 388) * 0.55], Cb];
  nerveTrack = track(npts);
  nerveP.setAttribute("d", ptsD(npts));
  dripTrack = track([[92, 98], [130, 126], [UP.in[0], UP.in[1]]]);
  const xs = [UX - 47, UX + 47], ys = [170, 205, 240, 275];
  xs.forEach((x) => ys.forEach((y) => {
    recs.push({ e: mk("circle", { class: "lb-rec", cx: 0, cy: 0, r: 5 }, receptG), x, y });
    const c = mk("path", { class: "lb-capX", d: "M-4 -4L4 4M4 -4L-4 4", transform: "translate(" + x + " " + y + ") scale(0.001)" }, capsG);
    caps.push({ e: c, x, y });
  }));
}
function capText(d) {
  if (d === 2) return "Oxytocin drip given. Extra oxytocin drives stronger contractions.";
  if (d === 1) return "Tocolytic given. It caps uterus receptors so contractions fade.";
  return "No treatment. Stretch alone drives oxytocin and contractions.";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const oxy = pool(26, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, layers.parts));
const nerv = pool(16, () => mk("circle", { class: "sc-p p-nerve", r: 2.4 }, layers.parts));
const pgs = pool(22, () => mk("path", { class: "sc-p p-pg", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts));
const dripO = pool(10, () => mk("circle", { class: "sc-p p-oxy", r: 2.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emitTrack(p, u) { p.on = true; p.u = u; p.e.setAttribute("opacity", "1"); }
function emitDrift(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The labour";
  [["str", "Stretch", "g-str", "Stretch of the cervix and lower uterus by the presenting part. This is the signal that starts the Ferguson reflex."], ["oxy", "Oxytocin", "g-oxy", "Released in pulses from the posterior pituitary when the cervix is stretched. It strengthens uterine contractions."], ["pg", "Prostaglandins", "g-pg", "Made by the membranes and decidua. They ripen the cervix and make the uterus more sensitive to oxytocin."], ["con", "Contractions", "g-bad", "Uterine contractions, driven by oxytocin and prostaglandins. A tocolytic calms them; oxytocin augmentation strengthens them."], ["cx", "Cervix", "g-good", "How far the cervix has effaced and opened. Prostaglandins ripen it and contractions open it."], ["des", "Descent", "g-fl", "Descent of the presenting part through the birth canal. It rises as contractions build, and ends with delivery."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Uterus", 253, 215, 95, 142, "Uterus: the muscular wall contracts from the top down and pushes the baby against the cervix.");
  pill(ox, "Baby", 302, 272, 130, 320, "Baby: the presenting part, here the head. Each contraction pushes it lower and stretches the cervix.");
  pill(ox, "Cervix", 300, 372, 130, 380, "Cervix: it thins and opens in the first stage, helped by prostaglandins and stretch.");
  pill(ox, "Placenta", 312, 166, 460, 170, "Placenta: attached to the uterine wall. In the third stage contractions deliver it after the baby.");
  pill(ox, "Prostaglandins", 348, 290, 480, 300, "Prostaglandins: made by the membranes nearby. They soften the cervix and boost the response to oxytocin.");
  pill(ox, "Oxytocin", 520, 128, 520, 88, "Oxytocin: released from the pituitary into the blood when the cervix stretches. It makes the uterus contract.");
  pill(ox, "Brain and pituitary", 690, 150, 880, 130, "Brain and pituitary: stretch signals arrive here and the pituitary releases oxytocin into the blood.");
  pill(ox, "Stretch signal", 500, 388, 500, 358, "Stretch signal: nerves carry cervical stretch up to the brain. More stretch means more oxytocin.");
  capEl = mk("text", { class: "lb-cap", x: 370, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { St: 0.4, O: 0.3, Pg: 0.4, C: 0.3, D: 0.3, Desc: 0.2, aug: 0, toco: 0, deliv: 0 };
const acc = { oxy: 0, nerv: 0, pg: 0, drip: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.St = lerp(sm.St, m.St, k2); sm.O = lerp(sm.O, m.O, k2); sm.Pg = lerp(sm.Pg, m.Pg, k2); sm.C = lerp(sm.C, m.C, k1); sm.D = lerp(sm.D, m.D, k2); sm.Desc = lerp(sm.Desc, m.Desc, k2); sm.aug = lerp(sm.aug, m.aug, k1); sm.toco = lerp(sm.toco, m.toco, k1); sm.deliv = lerp(sm.deliv, m.stage === 3 ? 1 : 0, k2);
  stageHi.forEach((e, i) => { if (e) e.style.opacity = i === m.stage ? "0.32" : "0.06"; });
  /* contractions: episodic squeeze of the uterus, deeper with augmentation */
  const wave = Math.pow(Math.max(0, Math.sin(tm / 850)), 3) * sm.C;
  const sq = 0.02 + 0.05 * sm.aug;
  uterusG.setAttribute("transform", "translate(300 232) scale(" + (1 - sq * wave).toFixed(3) + " " + (1 + sq * 0.6 * wave).toFixed(3) + ") translate(-300 -232)");
  arcs.setAttribute("opacity", wave.toFixed(2));
  flush.setAttribute("opacity", (0.35 * wave).toFixed(2));
  tone.setAttribute("opacity", (0.28 * sm.aug).toFixed(2));
  /* oxytocin receptors on the wall fill as oxytocin binds; tocolytic caps them */
  const bound = clamp(sm.O * 1.05 - sm.toco * 1.3, 0, 1);
  recs.forEach((r, i) => {
    const on = (i + 0.5) / recs.length < bound;
    r.e.setAttribute("class", on ? "lb-recB" : "lb-rec");
    place(r.e, r.x, r.y, 0, on ? 1 + 0.18 * Math.sin(tm / 280 + i * 2.1) : 1);
  });
  capsG.setAttribute("opacity", sm.toco.toFixed(2));
  caps.forEach((c, i) => {
    const sc = clamp((sm.toco - i * 0.06) * 4, 0.001, 1);
    c.e.setAttribute("transform", "translate(" + c.x + " " + c.y + ") scale(" + sc.toFixed(3) + ")");
  });
  /* drip set appears with augmentation, dots run down the line */
  dripG.setAttribute("opacity", sm.aug.toFixed(2));
  dripDots.forEach((d, i) => {
    const q = dripTrack.at((tm / 1400 + i / 3) % 1);
    d.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    d.setAttribute("opacity", sm.aug > 0.05 ? "1" : "0");
  });
  /* fetus descends further with augmentation; in the third stage it has been delivered */
  const yOff = sm.Desc * 60 + sm.deliv * 70 + sm.aug * 22 + wave * 3;
  fetusG.setAttribute("transform", "translate(0 " + f1(yOff) + ")");
  fetusG.style.opacity = (1 - sm.deliv * 0.96).toFixed(2);
  placG.setAttribute("transform", "translate(0 " + f1(sm.deliv * 92) + ")");
  /* cervix: lips part as it dilates and shorten as it effaces, wider with augmentation */
  const eff = clamp(0.6 * sm.D + 0.4 * sm.Pg), ch = 42 - 19 * eff, gap = sm.D * 20 + sm.aug * 16;
  cxL.setAttribute("x", f1(262 - gap)); cxL.setAttribute("height", f1(ch)); cxR.setAttribute("x", f1(310 + gap)); cxR.setAttribute("height", f1(ch));
  guideL.setAttribute("d", "M" + f1(276 - gap) + " 396C" + f1(268 - gap - 4) + " 414 " + f1(262 - gap - 6) + " 426 " + f1(258 - gap - 8) + " 438");
  guideR.setAttribute("d", "M" + f1(324 + gap) + " 396C" + f1(332 + gap + 4) + " 414 " + f1(338 + gap + 6) + " 426 " + f1(342 + gap + 8) + " 438");
  ticks.setAttribute("opacity", (sm.St * (0.45 + 0.55 * wave)).toFixed(2));
  /* stretch signal: cervix to brain */
  acc.nerv += dt * sm.St * 6; while (acc.nerv >= 1) { acc.nerv--; const p = free(nerv); if (p) emitTrack(p, 0); }
  nerv.forEach((p) => { if (!p.on) return; p.u += dt * 0.22; if (p.u >= 1) { kill(p); return; } const q = nerveTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* oxytocin: pituitary to uterus in the blood, a denser stream with augmentation */
  acc.oxy += dt * (sm.O * 11 + sm.aug * 6); while (acc.oxy >= 1) { acc.oxy--; const p = free(oxy); if (p) emitTrack(p, 0); }
  oxy.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; if (p.u >= 1) { kill(p); return; } const q = bloodTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* drip oxytocin drifts from the line join to wall receptors and is absorbed */
  acc.drip += dt * sm.aug * 7; while (acc.drip >= 1) { acc.drip--; const p = free(dripO); if (p && recs.length) { const r = recs[Math.floor(Math.random() * recs.length)]; emitDrift(p, 179, 159, (r.x - 179) / 1.1, (r.y - 159) / 1.1); p.k = 1.1; } }
  dripO.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t >= p.k) kill(p); });
  /* prostaglandins: membranes and decidua down to the cervix */
  acc.pg += dt * sm.Pg * 8; while (acc.pg >= 1) { acc.pg--; const p = free(pgs); if (p) emitDrift(p, rnd(350, 382), rnd(292, 322), rnd(-26, -8), rnd(16, 30)); }
  pgs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.y > 382 || p.t > 3) kill(p); });
  /* gauges */
  gg.str.set(sm.St, wordOf(sm.St, 0.3, 0.62, ["low", "rising", "high"])); gg.oxy.set(sm.O, wordOf(sm.O, 0.3, 0.62, ["low", "rising", "high"])); gg.pg.set(sm.Pg, wordOf(sm.Pg, 0.3, 0.62, ["low", "rising", "high"]));
  gg.con.set(sm.C, wordOf(sm.C, 0.3, 0.62, ["mild", "regular", "strong"])); gg.cx.set(sm.D, wordOf(sm.D, 0.3, 0.7, ["closed", "opening", "fully open"])); gg.des.set(sm.Desc, wordOf(sm.Desc, 0.3, 0.7, ["high", "descending", "delivered"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
