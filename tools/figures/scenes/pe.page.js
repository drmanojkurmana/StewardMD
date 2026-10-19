/* PE scene: leg clot, travelling emboli, lung blockage with dead space, straining right heart, body blood.
 * Two organ lungs fed by a pulmonary artery branch, one organ heart that dilates and flutters with strain. */
const WW = SC.W, EX = SC.EX;
const layers = { leg: $("leg"), lungSlot: $("lungSlot"), lung: $("lung"), heartSlot: $("heartSlot"), heart: $("heart"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const mix = (a, b, t) => "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
const DEOX = [92, 66, 150], OXY = [232, 62, 74];
const satColor = (s) => mix(DEOX, OXY, clamp(s));
const T = track(SC.travel);
const sm = { Occ: 0.5, Flow: 0.5, Ds: 0.5, Hx: 0.5, O: 0.5, St: 0.4, BP: 0.6, ac: 0, ly: 0, sup: 0 };
let breathPh = 0, beatPh = 0, flowPh = 0, pulse = 0, gg = {};
let veinCells = [], proxCells = [], distCells = [], bodyCells = [];
let clotG, legFib = [], embG, stubR, dsOv, paleOv, rvC, veinTr;
let lungL = null, lungR = null, heartO = null, capEl = null, capKey = "", maskG = null;
let shed, cross, waste, spark, crumb, raDots, veinDots, maskO2, vol;
const acc = { shed: 0, o2: 0, waste: 0, ly: 0, cr: 0, ox: 0, vol: 0 };
const HX = 770, HY = 228;

function capText(d, l) {
  if (d === 1) return "Anticoagulant. The leg clot stops growing, but the lung block stays.";
  if (d === 2) return "Anticoagulant with oxygen and fluids. Breathing eases, but flow stays blocked.";
  if (d === 3) return "Clot-dissolving drug. The embolus breaks up, flow returns and the heart settles.";
  return l >= 2 ? "No treatment. A large clot blocks flow and the right heart fails." : "No treatment. The clot blocks lung flow and the right heart strains.";
}

function rbc(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.36, ry: ry * 0.32 }, g); return g; }

function initLeg() {
  const L = layers.leg;
  mk("rect", { class: "pe-vein", x: 94, y: 90, width: 90, height: 206, rx: 30 }, L);
  mk("path", { class: "pe-valve", d: "M94 170L122 182M184 170L156 182" }, L);
  mk("path", { class: "pe-valve", d: "M94 262L122 274M184 262L156 274" }, L);
  clotG = mk("g", {}, L);
  for (let i = 0; i < 7; i++) cell(clotG, { cls: "plt", r: 5 + (i % 3), x: Math.cos(i * 1.4) * 16, y: Math.sin(i * 2.2) * 12, seed: i + 1, wob: 0.16, n: 7 });
  for (let i = 0; i < 4; i++) legFib.push(mk("path", { class: "fibrin", d: "M" + f1(rnd(-20, 20)) + " " + f1(rnd(-13, 13)) + "L" + f1(rnd(-20, 20)) + " " + f1(rnd(-13, 13)) }, clotG));
  place(clotG, 158, 240, 0, 1);
  const sh = mk("g", { id: "m-ac", opacity: "0" }, L);
  mk("circle", { class: "pe-shield", cx: 112, cy: 205, r: 11 }, sh);
  mk("path", { class: "pe-tick", d: "M107 205l4 4l7 -8" }, sh);
  for (let i = 0; i < 10; i++) { const g = rbc(layers.cells, 8, 4.8); veinCells.push({ g, x: 139 + rnd(-18, 18), y: rnd(96, 290), v: rnd(0.8, 1.2), rot: rnd(-15, 15) }); }
}

/* Two organ lungs on one artery branch. Branch stubs run from each hilum port down
 * to the main vessel; the embolus lodges just upstream of the right stub mouth. */
function initLung() {
  lungL = organ(layers.lungSlot, "lung", 372, 160, 116, {});
  lungR = organ(layers.lungSlot, "lung", 560, 160, 116, {});
  const hL = lungL.ports.in, hR = lungR.ports.in;
  const L = layers.lung;
  mk("path", { class: "pe-part", d: "M" + f1(hL[0]) + " " + f1(hL[1]) + "L" + f1(hL[0]) + " 241", fill: "none" }, L);
  stubR = mk("path", { class: "pe-part", d: "M" + f1(hR[0]) + " " + f1(hR[1]) + "L" + f1(hR[0]) + " 241", fill: "none" }, L);
  mk("rect", { class: "pe-part", x: 286, y: 228, width: 356, height: 26, rx: 13 }, L);
  paleOv = mk("rect", { class: "pe-pale", x: EX, y: 228, width: 642 - EX, height: 26, rx: 13, opacity: "0" }, L);
  dsOv = mk("ellipse", { class: "pe-ds", cx: 560, cy: 160, rx: 54, ry: 68, opacity: "0" }, L);
  embG = mk("g", {}, L);
  for (let i = 0; i < 8; i++) cell(embG, { cls: "plt", r: 5.5 + (i % 3), x: Math.cos(i * 1.1) * 15, y: Math.sin(i * 1.9) * 10, seed: i + 9, wob: 0.16, n: 7 });
  for (let i = 0; i < 5; i++) mk("path", { class: "pe-fib", d: "M" + f1(rnd(-22, 22)) + " " + f1(rnd(-12, 12)) + "L" + f1(rnd(-22, 22)) + " " + f1(rnd(-12, 12)) }, embG);
  place(embG, EX, 241, 0, 1);
  for (let i = 0; i < 12; i++) { const g = rbc(layers.cells, 7, 4.2); proxCells.push({ g, x: rnd(292, EX - 18), v: rnd(0.85, 1.15), rot: rnd(-12, 12) }); }
  for (let i = 0; i < 10; i++) { const g = rbc(layers.cells, 7, 4.2); distCells.push({ g, x: rnd(EX + 20, 636), v: rnd(0.85, 1.15), rot: rnd(-12, 12) }); }
}

/* The shared organ heart. Strain shows as a fast shallow flutter, whole-organ
 * dilation, a red glow, and a right-ventricle crescent that swells left of the septum. */
function initHeart() {
  const L = layers.heart;
  heartO = organ(layers.heartSlot, "heart", HX, HY, 150, {});
  veinTr = track([[642, 241], [668, 240], [695, 224], [724, 206]]);
  mk("path", { class: "pe-ao", d: "M642 241C668 240 695 224 724 206", fill: "none" }, L);
  rvC = mk("path", { class: "pe-rvc", d: "M734 198C724 218 719 242 719 260C719 274 725 283 732 288L738 282C728 262 728 226 738 200Z" }, L);
}

/* Right-ventricle crescent: outer edge hugs the heart wall, inner edge moves
 * toward the septum as strain rises. All points sit inside the organ mass. */
function rvPath(st) {
  const it = f1(738 + 18 * st), im = f1(728 + 24 * st), ib = f1(738 + 14 * st);
  return "M734 198C724 218 719 242 719 260C719 274 725 283 732 288L" + ib + " 282C" + im + " 262 " + im + " 226 " + it + " 200Z";
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
  crumb = pool(8, () => mk("circle", { class: "sc-p p-emb", r: 2.5 }, layers.parts));
  raDots = pool(8, () => mk("circle", { class: "sc-p", r: 2.6, style: "--cc:#5f8fd0" }, layers.parts));
  veinDots = pool(6, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
  maskO2 = pool(10, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
  vol = pool(8, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
}

function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["clot", "Clot", "g-clot", "Size of the blocking embolus in the lung artery. An anticoagulant stops it growing; a clot-dissolving drug breaks it up."],
   ["flow", "Lung flow", "g-fl", "How much blood still reaches the lung capillaries past the embolus."],
   ["ds", "Dead space", "g-cyt", "Lung that gets air but no blood. Its ventilation is wasted and oxygen in the blood falls."],
   ["ox", "Blood oxygen", "g-ox", "Oxygen in blood leaving the lungs. Low when dead space is large; oxygen support lifts it."],
   ["heart", "Right heart", "g-bad", "Strain on the right ventricle as it pumps against the blockage. Severe strain drops output and pressure."],
   ["bp", "Pressure", "g-good", "Systemic blood pressure. Falls when the strained right heart cannot fill the left side; fluids and oxygen support it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Leg vein", 100, 150, 78, 92, "Deep leg vein. Blood flows up toward the heart. Slow flow lets a clot form on the wall.");
  pill(o, "DVT clot", 168, 240, 202, 92, "Leg clot (deep vein thrombosis). Pieces can break off and travel with the blood to the lungs. An anticoagulant stops it growing.");
  const pa = pill(o, "Anticoagulant", 112, 205, 112, 148, "Anticoagulant: stops the clot growing and stops new clots forming. It does not dissolve clot quickly."); pa.setAttribute("id", "p-ac"); pa.style.opacity = 0;
  pill(o, "Healthy lung", 390, 120, 340, 100, "Healthy lung. Air reaches the sacs and blood in the wall vessels picks up oxygen.");
  pill(o, "Open flow", 350, 241, 340, 284, "Branch that stays open. Blood keeps flowing and the lung keeps exchanging gas.");
  pill(o, "Embolus", EX, 241, 458, 188, "Embolus: a travelled clot wedged in the lung artery. Blood cannot pass, so the lung beyond gets air but no blood.");
  pill(o, "Dead space", 575, 130, 560, 102, "Dead space: lung that is ventilated but not perfused. The air here is wasted and blood oxygen falls.");
  const pl = pill(o, "Clot buster", 470, 241, 440, 284, "Clot-dissolving drug: breaks the embolus up and reopens flow. Reserved for a large blocking clot."); pl.setAttribute("id", "p-ly"); pl.style.opacity = 0;
  pill(o, "Blocked flow", 580, 241, 580, 284, "Blocked branch. No blood reaches the lung beyond the embolus, so its air is wasted.");
  pill(o, "Right ventricle", 735, 245, 724, 92, "Right ventricle: pumps blood into the lung artery. Against the blockage its pressure rises and it dilates.");
  pill(o, "Septum", 758, 240, 830, 92, "Septum: the wall between the ventricles. High right sided pressure bows it toward the left.");
  pill(o, "Left ventricle", 807, 258, 890, 120, "Left ventricle: filled by blood from the lungs. When flow through the lungs falls, less blood leaves for the body.");
  pill(o, "Body blood", 200, 366, 200, 418, "Blood to the body. Its oxygen follows what the lungs manage to add.");
  const ps = pill(o, "Oxygen", 880, 410, 808, 418, "Oxygen with careful fluids: lifts blood oxygen and supports output while the clot clears."); ps.setAttribute("id", "p-sup"); ps.style.opacity = 0;
  capEl = mk("text", { class: "pe-cap", x: 30, y: 444 }, o); capEl.textContent = capText(0, level);
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
  flowPh += dt * (0.15 + 0.5 * sm.Flow);
  const ph = beatPh % 1, cb = ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : 0;
  /* leg: clot, slow venous return, shed emboli; anticoagulant shields the clot and stills its mesh */
  const legC = clamp(0.35 + 0.5 * sm.Occ - 0.2 * sm.ac);
  place(clotG, 158, 240, 0, 0.6 + 0.5 * legC);
  legFib.forEach((f) => { f.style.opacity = (1 - 0.65 * sm.ac).toFixed(2); });
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
  /* lung: embolus lodges, queued and distal flow, gas exchange in the two organ lungs */
  const es = 0.1 + 0.9 * clamp((sm.Occ - 0.03) * 1.5) + pulse * 0.18;
  place(embG, EX, 241, Math.sin(tm / 700) * 6, Math.max(0.05, es));
  embG.style.opacity = es > 0.2 ? (sm.ly ? (0.7 + 0.3 * Math.sin(tm / 90)).toFixed(2) : 1) : 0;
  stubR.style.opacity = (0.25 + 0.75 * sm.Flow).toFixed(2);
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
  dsOv.setAttribute("opacity", (sm.Ds * 0.8).toFixed(2));
  paleOv.setAttribute("opacity", (sm.Ds * 0.75).toFixed(2));
  /* oxygen is picked up in the open lung; wasted air leaves the blocked lung */
  acc.o2 += dt * (1 + 4.5 * sm.Flow); while (acc.o2 >= 1) { acc.o2--; const p = free(cross); if (p) emit(p, 348 + rnd(-24, 24), 118, 0, 34, 0); }
  cross.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 130) / 45).toFixed(2)); if (p.y > 174) kill(p); });
  acc.waste += dt * br * 1.1; while (acc.waste >= 1) { acc.waste--; const p = free(waste); if (p) emit(p, 540 + rnd(-20, 20), 198, 0, -46, 0); }
  waste.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp((p.y - 88) / 60).toFixed(2)); if (p.y < 86) kill(p); });
  /* clot buster: sparks chew the embolus and dissolving crumbs wash away downstream */
  acc.ly += dt * sm.ly * 8; while (acc.ly >= 1) { acc.ly--; const p = free(spark); if (p) emit(p, EX + rnd(-30, 30), 241 + rnd(-20, 20), 0, 0, 0); }
  spark.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 160) + ") scale(" + (1 - p.t).toFixed(2) + ")"); if (p.t > 0.9) kill(p); });
  acc.cr += dt * sm.ly * clamp(sm.Occ * 3) * 7; while (acc.cr >= 1) { acc.cr--; const p = free(crumb); if (p) emit(p, EX + rnd(-14, 14), 241 + rnd(-12, 12), rnd(26, 44), rnd(-6, 6), 0); }
  crumb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + Math.max(0.01, 1 - p.t / 1.1).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1 || p.x > 640) kill(p); });
  /* heart: fast shallow flutter when strained, slow deep beat when settled; glow and RV crescent follow strain */
  const ef = 0.05 + 0.12 * (1 - sm.St), dk = (1 + 0.24 * sm.St) * (1 - ef * cb);
  heartO.g.setAttribute("transform", "translate(" + HX + " " + HY + ") scale(" + dk.toFixed(3) + ")");
  heartO.g.style.filter = sm.St > 0.02 ? "drop-shadow(0 0 " + f1(sm.St * 9) + "px var(--c-bad))" : "none";
  rvC.setAttribute("d", rvPath(sm.St));
  const nd = Math.round(sm.St * raDots.length);
  raDots.forEach((p, i) => {
    if (!p.on && i < nd && Math.random() < dt * 3) emit(p, 720 + rnd(-6, 26), 210 + rnd(-5, 45), rnd(-4, 4), rnd(-6, 6), 0);
    if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 1.6) kill(p);
  });
  raDots.forEach((p, i) => { if (!p.on && i >= nd) p.e.setAttribute("opacity", "0"); });
  /* blood to the left heart returns only past the blockage */
  veinDots.forEach((p, i) => { const u = (flowPh + i / veinDots.length) % 1, q = veinTr.at(u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", i / veinDots.length < sm.Flow ? 0.9 : 0); });
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
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
