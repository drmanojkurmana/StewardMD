/* PE scene: leg clot, travelling emboli, lung blockage with dead space, straining right heart, body blood. */
const WW = SC.W, EX = SC.EX;
const layers = { leg: $("leg"), lung: $("lung"), heart: $("heart"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const mix = (a, b, t) => "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
const DEOX = [92, 66, 150], OXY = [232, 62, 74];
const satColor = (s) => mix(DEOX, OXY, clamp(s));
const T = track(SC.travel);
const sm = { Occ: 0.5, Flow: 0.5, Ds: 0.5, Hx: 0.5, O: 0.5, St: 0.4, BP: 0.6, ac: 0, ly: 0, sup: 0 };
let breathPh = 0, beatPh = 0, pulse = 0, gg = {};
let veinCells = [], proxCells = [], distCells = [], bodyCells = [];
let clotG, embG, sacL, sacR, dsOv, paleOv, septum, rvG, lvG, rvCav, lvCav, raG, maskG;
let shed, cross, waste, spark, raDots, maskO2, vol;
const acc = { shed: 0, o2: 0, waste: 0, ly: 0, ox: 0, vol: 0 };

function rbc(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.36, ry: ry * 0.32 }, g); return g; }

function initLeg() {
  const L = layers.leg;
  mk("rect", { class: "pe-vein", x: 94, y: 90, width: 90, height: 206, rx: 30 }, L);
  mk("path", { class: "pe-valve", d: "M94 170L122 182M184 170L156 182" }, L);
  mk("path", { class: "pe-valve", d: "M94 262L122 274M184 262L156 274" }, L);
  clotG = mk("g", {}, L);
  for (let i = 0; i < 7; i++) cell(clotG, { cls: "plt", r: 5 + (i % 3), x: Math.cos(i * 1.4) * 16, y: Math.sin(i * 2.2) * 12, seed: i + 1, wob: 0.16, n: 7 });
  for (let i = 0; i < 4; i++) mk("path", { class: "fibrin", d: "M" + f1(rnd(-20, 20)) + " " + f1(rnd(-13, 13)) + "L" + f1(rnd(-20, 20)) + " " + f1(rnd(-13, 13)) }, clotG);
  place(clotG, 158, 240, 0, 1);
  const sh = mk("g", { id: "m-ac", opacity: "0" }, L);
  mk("circle", { class: "pe-shield", cx: 112, cy: 205, r: 11 }, sh);
  mk("path", { class: "pe-tick", d: "M107 205l4 4l7 -8" }, sh);
  for (let i = 0; i < 10; i++) { const g = rbc(layers.cells, 8, 4.8); veinCells.push({ g, x: 139 + rnd(-18, 18), y: rnd(96, 290), v: rnd(0.8, 1.2), rot: rnd(-15, 15) }); }
}

function initLung() {
  const L = layers.lung;
  [370, 560].forEach((cx) => {
    mk("rect", { class: "pe-air", x: cx - 10, y: 80, width: 20, height: 40, rx: 9 }, L);
    mk("rect", { class: "pe-cap", x: cx - 8, y: 182, width: 16, height: 46 }, L);
  });
  sacL = mk("circle", { class: "pe-sac", cx: 370, cy: 152, r: 30 }, L);
  sacR = mk("circle", { class: "pe-sac", cx: 560, cy: 152, r: 30 }, L);
  dsOv = mk("circle", { class: "pe-ds", cx: 560, cy: 152, r: 30, opacity: "0" }, L);
  mk("rect", { class: "pe-cap", x: 286, y: 228, width: 356, height: 26, rx: 13 }, L);
  paleOv = mk("rect", { class: "pe-pale", x: EX, y: 228, width: 642 - EX, height: 26, rx: 13, opacity: "0" }, L);
  embG = mk("g", {}, L);
  for (let i = 0; i < 8; i++) cell(embG, { cls: "plt", r: 5.5 + (i % 3), x: Math.cos(i * 1.1) * 15, y: Math.sin(i * 1.9) * 10, seed: i + 9, wob: 0.16, n: 7 });
  for (let i = 0; i < 5; i++) mk("path", { class: "pe-fib", d: "M" + f1(rnd(-22, 22)) + " " + f1(rnd(-12, 12)) + "L" + f1(rnd(-22, 22)) + " " + f1(rnd(-12, 12)) }, embG);
  place(embG, EX, 241, 0, 1);
  for (let i = 0; i < 12; i++) { const g = rbc(layers.cells, 7, 4.2); proxCells.push({ g, x: rnd(292, EX - 18), v: rnd(0.85, 1.15), rot: rnd(-12, 12) }); }
  for (let i = 0; i < 10; i++) { const g = rbc(layers.cells, 7, 4.2); distCells.push({ g, x: rnd(EX + 20, 636), v: rnd(0.85, 1.15), rot: rnd(-12, 12) }); }
}

/* Ventricles sharing one thick septum. The right ventricle is a crescent with its
 * own cavity left of the septum; bow bends the septum into the left ventricle and
 * squeezes its cavity, dil widens the right ventricle as strain rises. Quadratic
 * controls sit twice as far out as the curve itself reaches. */
function heartPaths(bow, dil, beat) {
  const lq = f1(810 + bow * 2), rq = f1(822 + bow * 2), cq = f1(826 + bow * 2);
  const dl = f1(702 - dil), dc = f1(714 - dil * 0.85), rt = f1(888 - beat * 2);
  return {
    rv: "M810 160C762 142 " + f1(724 - dil) + " 146 " + dl + " 180C" + f1(692 - dil) + " 218 " + f1(700 - dil) + " 256 " + f1(728 - dil) + " 276C756 294 786 294 810 282Q" + lq + " 220 810 160Z",
    lv: "M822 160C856 146 890 156 900 188C910 222 902 260 878 277C860 290 838 291 822 282Q" + rq + " 220 822 160Z",
    rvc: "M808 175C768 161 " + f1(732 - dil * 0.85) + " 164 " + dc + " 190C" + f1(706 - dil * 0.85) + " 220 " + dc + " 246 " + f1(738 - dil * 0.85) + " 262C762 277 786 276 808 267Q" + f1(806 + bow * 2) + " 220 808 175Z",
    sept: "M810 160Q" + lq + " 220 810 282L822 282Q" + rq + " 220 822 160Z",
    cav: "M826 176Q" + cq + " 220 826 263C848 275 872 272 " + rt + " 252C" + f1(896 - beat * 2) + " 230 " + f1(896 - beat * 2) + " 202 884 186C868 169 844 167 826 176Z",
  };
}

function initHeart() {
  const L = layers.heart, hp = heartPaths(4, 2, 0);
  mk("path", { class: "pe-pa", d: "M750 162C728 154 706 154 684 157" }, L);
  mk("path", { class: "pe-ao", d: "M868 152C868 138 856 128 844 122" }, L);
  raG = mk("ellipse", { class: "pe-ra", cx: 748, cy: 134, rx: 28, ry: 22 }, L);
  lvG = mk("path", { class: "pe-lv", d: hp.lv }, L);
  rvG = mk("path", { class: "pe-rv", d: hp.rv }, L);
  rvCav = mk("path", { class: "pe-rvc", d: hp.rvc }, L);
  lvCav = mk("path", { class: "pe-cav", d: hp.cav }, L);
  septum = mk("path", { class: "pe-sept", d: hp.sept }, L);
  mk("ellipse", { class: "pe-la", cx: 862, cy: 130, rx: 23, ry: 17 }, L);
  mk("path", { class: "pe-valve", d: "M730 164L744 176M762 164L750 176" }, L);
  mk("path", { class: "pe-valve", d: "M842 156L852 168M872 156L862 168" }, L);
}

function initBlood() {
  for (let i = 0; i < 24; i++) { const g = rbc(layers.cells, 8, 4.8); bodyCells.push({ g, x: rnd(20, 940), r: rnd(-0.8, 0.8), i }); }
  maskG = mk("g", { id: "m-sup", opacity: "0" }, layers.parts);
  mk("rect", { class: "pe-mask", x: 862, y: 398, width: 36, height: 24, rx: 10 }, maskG);
  mk("path", { class: "pe-mask", d: "M862 404L848 398M862 416L848 422" }, maskG);
}

function initPools() {
  shed = pool(6, () => mk("circle", { class: "sc-p p-emb", r: 4 }, layers.parts));
  cross = pool(8, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
  waste = pool(8, () => mk("circle", { class: "sc-p p-waste", r: 2.6 }, layers.parts));
  spark = pool(10, () => mk("path", { class: "pe-ly", d: "M-4 0L4 0M0 -4L0 4" }, layers.parts));
  raDots = pool(8, () => mk("circle", { class: "sc-p", r: 2.6, style: "--cc:#5f8fd0" }, layers.parts));
  maskO2 = pool(10, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
  vol = pool(8, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
}

function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["clot", "Clot", "g-clot", "Size of the blocking embolus in the lung artery. An anticoagulant stops it growing; a clot-dissolving drug breaks it up."],
   ["flow", "Lung flow", "g-fl", "How much blood still reaches the lung capillaries past the embolus."],
   ["ds", "Dead space", "g-cyt", "Sacs that get air but no blood. Their ventilation is wasted and oxygen in the blood falls."],
   ["ox", "Blood oxygen", "g-ox", "Oxygen in blood leaving the lungs. Low when dead space is large; oxygen support lifts it."],
   ["heart", "Right heart", "g-bad", "Strain on the right ventricle as it pumps against the blockage. Severe strain drops output and pressure."],
   ["bp", "Pressure", "g-good", "Systemic blood pressure. Falls when the strained right heart cannot fill the left side; fluids and oxygen support it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Leg vein", 100, 150, 78, 92, "Deep leg vein. Blood flows up toward the heart. Slow flow lets a clot form on the wall.");
  pill(o, "DVT clot", 168, 240, 202, 92, "Leg clot (deep vein thrombosis). Pieces can break off and travel with the blood to the lungs. An anticoagulant stops it growing.");
  const pa = pill(o, "Anticoagulant", 112, 205, 112, 148, "Anticoagulant: stops the clot growing and stops new clots forming. It does not dissolve clot quickly."); pa.setAttribute("id", "p-ac"); pa.style.opacity = 0;
  pill(o, "Air sac", 352, 130, 306, 88, "Air sac (alveolus). Air arrives here; blood in the wall vessels picks up oxygen and drops off carbon dioxide.");
  pill(o, "Open flow", 350, 241, 322, 208, "Branch that stays open. Blood keeps flowing and its sac keeps exchanging gas.");
  pill(o, "Embolus", EX, 228, EX + 8, 188, "Embolus: a travelled clot wedged in the lung artery. Blood cannot pass, so the sacs beyond get air but no blood.");
  pill(o, "Dead space", 572, 128, 466, 102, "Dead space: sacs that are ventilated but not perfused. The air here is wasted and blood oxygen falls.");
  const pl = pill(o, "Clot buster", 520, 232, 560, 284, "Clot-dissolving drug: breaks the embolus up and reopens flow. Reserved for a large blocking clot."); pl.setAttribute("id", "p-ly"); pl.style.opacity = 0;
  pill(o, "Right ventricle", 738, 232, 724, 92, "Right ventricle: pumps blood into the lung artery. Against the blockage its pressure rises and it dilates.");
  pill(o, "Septum", 818, 170, 805, 128, "Septum: the wall between the ventricles. High right sided pressure bows it toward the left.");
  pill(o, "Left ventricle", 865, 220, 890, 92, "Left ventricle: squeezed by the bowing septum, so less blood leaves for the body.");
  pill(o, "Body blood", 200, 366, 200, 418, "Blood to the body. Its oxygen follows what the lungs manage to add.");
  const ps = pill(o, "Oxygen", 880, 366, 808, 418, "Oxygen with careful fluids: lifts blood oxygen and supports output while the clot clears."); ps.setAttribute("id", "p-sup"); ps.style.opacity = 0;
}

function init() { initLeg(); initLung(); initHeart(); initBlood(); initPools(); initPanel(); }

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.5);
  ["Occ", "Flow", "BP", "ac", "ly", "sup"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  ["Ds", "Hx", "O", "St"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  pulse = Math.max(0, pulse - dt * 2);
  const br = 1.6 + 2.6 * (1 - sm.O);
  breathPh += dt * br;
  beatPh += dt * (1.1 + 1.4 * sm.St);
  const ph = beatPh % 1, cb = ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : 0;
  /* leg: clot, slow venous return, shed emboli */
  const legC = clamp(0.35 + 0.5 * sm.Occ - 0.2 * sm.ac);
  place(clotG, 158, 240, 0, 0.6 + 0.5 * legC);
  $("m-ac").setAttribute("opacity", sm.ac.toFixed(2));
  veinCells.forEach((c, i) => {
    let sp = 46 * c.v * (1 - 0.45 * legC);
    if (c.x > 100 && c.x < 180 && c.y > 200 && c.y < 282) sp *= (1 - 0.5 * legC);
    c.y -= sp * dt;
    if (c.y < 96) { c.y = 290; c.x = 139 + rnd(-18, 18); }
    place(c.g, c.x + Math.sin(tm / 500 + i) * 2, c.y, c.rot, 1);
  });
  acc.shed += dt * sm.Occ * 2.4 * (sm.ac ? 0.2 : 1);
  while (acc.shed >= 1) { acc.shed--; const p = free(shed); if (p) { p.u = 0; emit(p, 150, 96, 0, 0, 0); } }
  shed.forEach((p) => { if (!p.on) return; p.u += dt * 0.32; const a = T.at(p.u); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); if (p.u >= 1) { kill(p); pulse = 1; } });
  /* lung: embolus, queued and distal flow, gas exchange */
  const es = 0.15 + 0.85 * clamp((sm.Occ - 0.05) * 1.4) + pulse * 0.18;
  place(embG, EX, 241, Math.sin(tm / 700) * 6, es);
  embG.style.opacity = es > 0.2 ? 1 : 0;
  const vf = 12 + 70 * sm.Flow;
  proxCells.forEach((c) => {
    c.x += c.v * vf * dt;
    if (c.x > EX - 16) c.x = EX - 16 - Math.random() * 4;
    place(c.g, c.x, 241 + Math.sin(tm / 450 + c.x) * 3, c.rot, 1);
  });
  const want = Math.round(sm.Flow * distCells.length);
  distCells.forEach((c, i) => {
    c.x += c.v * vf * dt;
    if (c.x > 636) c.x = EX + 20 + Math.random() * 6;
    place(c.g, c.x, 241 + Math.sin(tm / 450 + c.x) * 3, c.rot, 1);
    c.g.style.opacity = i < want ? 1 : 0;
  });
  const amp = 0.04 + 0.07 * (1 - sm.O), bs = 1 + amp * Math.sin(breathPh);
  sacL.setAttribute("transform", "translate(370 152) scale(" + bs.toFixed(3) + ") translate(-370 -152)");
  sacR.setAttribute("transform", "translate(560 152) scale(" + bs.toFixed(3) + ") translate(-560 -152)");
  dsOv.setAttribute("opacity", (sm.Ds * 0.8).toFixed(2));
  paleOv.setAttribute("opacity", (sm.Ds * 0.75).toFixed(2));
  acc.o2 += dt * (1.5 + 5 * sm.Flow); while (acc.o2 >= 1) { acc.o2--; const p = free(cross); if (p) emit(p, 370 + rnd(-14, 14), 182, 0, 38, 0); }
  cross.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 220) kill(p); });
  acc.waste += dt * br * 1.1; while (acc.waste >= 1) { acc.waste--; const p = free(waste); if (p) emit(p, 560 + rnd(-10, 10), 128, 0, -42, 0); }
  waste.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 82) kill(p); });
  acc.ly += dt * sm.ly * 6; while (acc.ly >= 1) { acc.ly--; const p = free(spark); if (p) emit(p, EX + rnd(-30, 30), 241 + rnd(-20, 20), 0, 0, 0); }
  spark.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 160) + ") scale(" + (1 - p.t).toFixed(2) + ")"); if (p.t > 0.9) kill(p); });
  /* heart: dilating right ventricle, septum bowing into the left ventricle */
  const hp = heartPaths(sm.St * 20, sm.St * 14 + cb * 2, cb * 2);
  rvG.setAttribute("d", hp.rv);
  lvG.setAttribute("d", hp.lv);
  rvCav.setAttribute("d", hp.rvc);
  septum.setAttribute("d", hp.sept);
  lvCav.setAttribute("d", hp.cav);
  const nd = Math.round(sm.St * raDots.length);
  raDots.forEach((p, i) => {
    if (!p.on && i < nd && Math.random() < dt * 3) emit(p, 735 + rnd(-18, 30), 140 + rnd(-14, 60), rnd(-4, 4), rnd(-6, 6), 0);
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.6) kill(p);
  });
  raDots.forEach((p, i) => { if (!p.on && i >= nd) p.e.setAttribute("opacity", "0"); });
  /* body blood: colour and speed follow oxygen and pressure */
  bodyCells.forEach((c) => {
    c.x += 52 * clamp(0.3 + 0.7 * sm.BP) * dt;
    if (c.x > 946) { c.x = 20; c.r = rnd(-0.8, 0.8); }
    place(c.g, c.x, 366 + c.r * 14, Math.sin(tm / 500 + c.x) * 8, 1);
    c.g.style.fill = satColor(clamp(sm.O * 1.05 + (c.i % 5 === 0 ? 0.15 : -0.1)));
  });
  $("m-sup").setAttribute("opacity", sm.sup.toFixed(2));
  acc.ox += dt * sm.sup * 5; while (acc.ox >= 1) { acc.ox--; const p = free(maskO2); if (p) emit(p, 880 + rnd(-18, 18), 402, 0, -48, 0); }
  maskO2.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 354) kill(p); });
  acc.vol += dt * sm.sup * 4; while (acc.vol >= 1) { acc.vol--; const p = free(vol); if (p) emit(p, 700 + rnd(-40, 40), 328, 0, 52, 0); }
  vol.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 362) kill(p); });
  /* treatment pills fade in */
  $("p-ac").style.opacity = sm.ac.toFixed(2); $("p-ly").style.opacity = sm.ly.toFixed(2); $("p-sup").style.opacity = sm.sup.toFixed(2);
  /* gauges */
  gg.clot.set(sm.Occ, wordOf(sm.Occ, 0.35, 0.65, ["small", "medium", "large"]));
  gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.7, ["blocked", "reduced", "open"]));
  gg.ds.set(sm.Ds, wordOf(sm.Ds, 0.3, 0.6, ["none", "some", "large"]));
  gg.ox.set(sm.O, wordOf(sm.O, 0.35, 0.7, ["very low", "low", "normal"]));
  gg.heart.set(sm.St, wordOf(sm.St, 0.4, 0.7, ["normal", "strained", "failing"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.45, 0.7, ["low", "borderline", "ok"]));
}
run({ init, step });
