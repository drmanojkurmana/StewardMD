/* Cytarabine scene: ara-CTP jams tumour DNA polymerase in S phase; marrow, brain, eye, skin and mouth show the harms. */
const L = { tum: $("tumSlot"), org: $("orgSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const TC = [250, 285], TR = 88, CONV = [172, 335], JAM = [245, 285], FX0 = 200, FX1 = 300;
const sm = { K: 0, Ms: 0, Cb: 0, Sy: 0, Ey: 0, Mk: 0, on: 0, pro: 0 };
const acc = { cap: 0, dct: 0, sys: 0, spk: 0, tea: 0, sdr: 0, bleb: 0 };
let tumG, dauG, strand, pol, jamG, kin, forkP = 0.2;
let brn, cereb = [622, 208], cerebE, marCells = [], blasts = [];
let eyeRed, dropG, rashE = [], heatE = [], acheE = [], lipRed, soreE = [];
let caps, tri, dct, sys, spark, tear, sdrop, bleb, gg = {}, capEl = null, capKey = "";
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 2) return ["Eye drops and steroid cover calm the eyes and the syndrome. Tumour kill goes on.", "Cover keeps eyes and fever down while ara-CTP keeps jamming tumour DNA.", "Even late on, the eyes and syndrome stay guarded. Marrow and brain harm still build."][l];
  if (d === 1) return ["ara-CTP starts jamming tumour polymerase. Early harm shows in marrow, eyes and skin.", "Polymerase stalls across the tumour while marrow, brain, eyes, skin and mouth suffer.", "Late courses kill more tumour, but unsteady movement and low counts build up."][l];
  return ["No treatment. The tumour cell copies its DNA in S phase and divides.", "No treatment. The tumour keeps copying DNA and dividing.", "No treatment. The tumour grows on, with no benefit and no harm."][l];
}
const DROP = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
const SYS_T = [[560, 186], [750, 180], [556, 330], [700, 330], [852, 330]];
function init() {
  tumG = cell(L.tum, { cls: "tum", r: TR, nuc: 0.58, seed: 3, wob: 0.08, x: TC[0], y: TC[1] });
  let rungs = "";
  for (let x = -48; x <= 48; x += 8) rungs += "M" + x + " -10L" + x + " 10";
  mk("path", { class: "oc-rung", d: rungs }, tumG);
  mk("path", { class: "oc-dna", d: "M-50 -10L50 -10M-50 10L50 10" }, tumG);
  strand = mk("path", { class: "oc-strand", d: "M-50 0L-50 0" }, tumG);
  pol = mk("g", {}, tumG);
  mk("circle", { class: "oc-pol", r: 10 }, pol);
  mk("circle", { class: "oc-pol-in", r: 3.5, cx: -3, cy: -3 }, pol);
  jamG = mk("g", { transform: "translate(-5 0)", opacity: "0" }, tumG);
  mk("path", { class: "oc-jam", d: "M-9 -9L9 9M-9 9L9 -9" }, jamG);
  dauG = cell(L.tum, { cls: "tum", r: 24, nuc: 0.5, seed: 5, wob: 0.1, x: 400, y: 355 });
  kin = mk("circle", { class: "oc-kin", cx: CONV[0], cy: CONV[1], r: 7, opacity: "0" }, L.tum);
  /* brain with a cerebellum that sparks as movement turns unsteady */
  brn = organ(L.org, "brain", 592, 182, 115, {});
  cereb = brn.ports.cereb;
  cerebE = mk("ellipse", { class: "oc-cereb", cx: f1(cereb[0] - 592), cy: f1(cereb[1] - 182), rx: 17, ry: 13, opacity: "0" }, brn.g);
  /* marrow bone: normal cells run low, leukaemia blasts die with the kill */
  const bg = mk("g", {}, L.org);
  mk("rect", { class: "oc-bone", x: 730, y: 132, width: 130, height: 96, rx: 20 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 730, cy: 180, rx: 17, ry: 52 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 860, cy: 180, rx: 17, ry: 52 }, bg);
  mk("rect", { class: "oc-cav", x: 750, y: 154, width: 90, height: 52, rx: 14 }, bg);
  [[762, 168, "rbc"], [784, 162, "neut"], [806, 167, "plt"], [828, 163, "rbc"], [770, 191, "neut"], [794, 196, "rbc"], [816, 191, "plt"], [834, 195, "neut"]]
    .forEach(([x, y, cls], i) => marCells.push({ g: cell(bg, { cls, r: 7.5, nuc: cls === "plt" ? 0 : 0.4, seed: i + 11, wob: 0.12, x, y }), x, y }));
  [[776, 178], [800, 172], [790, 190]].forEach(([x, y], i) => blasts.push({ g: cell(bg, { cls: "blast", r: 8, nuc: 0.55, seed: i + 31, wob: 0.1, x, y }), x, y }));
  /* eye that reddens and streams, guarded by steroid drops */
  organ(L.org, "eye", 580, 335, 100, {});
  eyeRed = mk("ellipse", { class: "oc-eye-red", cx: 580, cy: 335, rx: 30, ry: 26, opacity: "0" }, L.org);
  dropG = mk("g", { transform: "translate(610 266)", opacity: "0" }, L.org);
  mk("rect", { class: "oc-drop", x: -8, y: -16, width: 16, height: 22, rx: 3 }, dropG);
  mk("path", { class: "oc-droptip", d: "M-4 6L0 14L4 6Z" }, dropG);
  /* skin with rash, fever shimmer and ache flashes */
  organ(L.org, "skin", 745, 330, 120, {});
  [[715, 320, 7], [760, 345, 8], [730, 365, 6], [780, 315, 5.5], [700, 350, 5]].forEach(([x, y, r]) => rashE.push(mk("circle", { class: "oc-rash", cx: x, cy: y, r, opacity: "0" }, L.org)));
  [715, 745, 775].forEach((x, i) => heatE.push({ e: mk("path", { class: "oc-heat", d: "M0 0C-4 -6 4 -10 0 -16", opacity: "0" }, L.org), x, t: i / 3 }));
  acheE.push({ e: mk("polyline", { class: "oc-ache", points: "694,296 700,304 706,294 712,302", opacity: "0" }, L.org), ph: 0 });
  acheE.push({ e: mk("polyline", { class: "oc-ache", points: "772,362 778,370 784,360 790,368", opacity: "0" }, L.org), ph: 2 });
  /* sore mouth */
  mk("ellipse", { class: "oc-lip", cx: 880, cy: 330, rx: 26, ry: 13 }, L.org);
  lipRed = mk("ellipse", { class: "oc-lipred", cx: 880, cy: 330, rx: 26, ry: 13, opacity: "0" }, L.org);
  mk("ellipse", { class: "oc-mouth", cx: 880, cy: 330, rx: 14, ry: 4 }, L.org);
  [[872, 326], [884, 333], [890, 325]].forEach(([x, y]) => soreE.push(mk("circle", { class: "oc-sore", cx: x, cy: y, r: 2.5, opacity: "0" }, L.org)));
  /* particle pools */
  caps = pool(8, () => mk("ellipse", { class: "sc-p p-ara", rx: 5, ry: 3 }, L.parts));
  tri = pool(12, () => mk("path", { class: "sc-p p-ctp", d: "M0 -3.4L3 2.6L-3 2.6Z" }, L.parts));
  dct = pool(10, () => mk("circle", { class: "sc-p p-dct", r: 2.6 }, L.parts));
  sys = pool(12, () => mk("path", { class: "sc-p p-sys", d: "M0 -2.8L2.4 2.2L-2.4 2.2Z" }, L.parts));
  spark = pool(10, () => mk("circle", { class: "p-spark", r: 3 }, L.parts));
  tear = pool(8, () => mk("path", { class: "p-tear", d: DROP }, L.parts));
  sdrop = pool(6, () => mk("path", { class: "p-sdrop", d: DROP }, L.parts));
  bleb = pool(10, () => mk("circle", { class: "sc-p p-bleb", r: 3.2 }, L.parts));
  /* labels, caption, gauges */
  const ox = L.over;
  const p1 = pill(ox, "ara-C in", 40, 345, 86, 300, "Cytarabine enters the cell, where kinases convert it stepwise into ara-CTP, the active fake block."); p1.setAttribute("id", "ara-pill");
  const p2 = pill(ox, "Fake blocks", 172, 335, 150, 408, "ara-CTP looks like the natural block dCTP, so DNA polymerase picks it up by mistake."); p2.setAttribute("id", "ctp-pill");
  pill(ox, "DNA polymerase", 244, 302, 335, 408, "DNA polymerase copies tumour DNA in S phase. The fake block jams it, the new strand stops, and the cell dies.");
  pill(ox, "Marrow", 795, 140, 795, 92, "Marrow cells divide fast, so the drug kills them and red cells, white cells and platelets all fall. Leukaemia blasts die too.");
  pill(ox, "Brain", 560, 140, 660, 92, "With high exposure the drug injures cerebellar cells, so movement turns unsteady and clumsy.");
  pill(ox, "Eye", 545, 318, 503, 296, "Drug in tears burns the eye surface, causing chemical conjunctivitis. Steroid drops calm it.");
  pill(ox, "Skin rash", 745, 280, 745, 256, "The drug injures dividing skin cells, raising a painful hand and foot rash. Fever and muscle aches of the syndrome come with it.");
  pill(ox, "Sore mouth", 880, 318, 888, 258, "The drug injures the fast renewing mouth lining, so painful sores open: mucositis.");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 443 }, ox); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 470 }, P); t.textContent = "Benefit and harm together";
  [["kill", "Tumour kill", "g-good", "How much tumour dies as ara-CTP jams DNA polymerase. Rises with each course."], ["mar", "Marrow low", "g-neu", "Marrow cells divide fast, so the drug kills them and blood counts fall."], ["wob", "Wobbly", "g-cyt", "With high exposure the drug injures the cerebellum, so movement turns unsteady."], ["syn", "Syndrome", "g-eos", "Cytarabine syndrome: fever with rash and muscle aches. Steroid cover keeps it down."], ["eye", "Sore eyes", "g-fl", "Drug in tears burns the eye surface. Steroid eye drops keep this low."], ["rsh", "Rash, sores", "g-bad", "The drug injures fast renewing skin and mouth lining, raising rash and painful sores."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, 478, 70, 18, cls, name, tip); });
}
function step(dt, m) {
  const k2 = Math.min(1, dt * 1.2);
  sm.K = lerp(sm.K, m.K, k2); sm.Ms = lerp(sm.Ms, m.Ms, k2); sm.Cb = lerp(sm.Cb, m.Cb, k2); sm.Sy = lerp(sm.Sy, m.Sy, k2);
  sm.Ey = lerp(sm.Ey, m.Ey, k2); sm.Mk = lerp(sm.Mk, m.Mk, k2); sm.on = lerp(sm.on, m.on, k2); sm.pro = lerp(sm.pro, m.pro, k2);
  /* ara-C capsules drift into the cell and convert at the rim */
  acc.cap += dt * sm.on * 3;
  while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) { const sx = 16, sy = rnd(320, 352), dx = CONV[0] - sx, dy = CONV[1] - sy, d = Math.hypot(dx, dy); emit(p, sx, sy, dx / d * 46, dy / d * 46, 0); } }
  caps.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.x * 4) + ")"); if (Math.hypot(CONV[0] - p.x, CONV[1] - p.y) < 9) { kill(p); const q = free(tri); if (q) emit(q, CONV[0], CONV[1], 0, 0, 0); } });
  kin.setAttribute("opacity", sm.on.toFixed(2));
  kin.setAttribute("r", (7 + 2 * Math.sin(tm / 200)).toFixed(1));
  /* fake blocks fly to the jam while good blocks feed the fork */
  tri.forEach((p) => { if (!p.on) return; const dx = JAM[0] - p.x, dy = JAM[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (d < 7) kill(p); });
  const forkX = FX0 + forkP * (FX1 - FX0);
  acc.dct += dt * (0.4 + (1 - sm.on) * 3);
  while (acc.dct >= 1) { acc.dct--; const p = free(dct); if (p) emit(p, 250 + rnd(-30, 30), 362, 0, 0, 0); }
  dct.forEach((p) => { if (!p.on) return; const dx = forkX - p.x, dy = 285 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 55 * dt; p.y += (dy / d) * 55 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8) kill(p); });
  /* the fork copies DNA, then stalls at the jam and shakes */
  if (sm.on > 0.5) forkP = lerp(forkP, 0.45, Math.min(1, dt * 2));
  else { forkP += dt * 0.14; if (forkP > 1) forkP = 0; }
  const px = FX0 + forkP * (FX1 - FX0) + sm.on * Math.sin(tm / 60) * 2;
  strand.setAttribute("d", "M-50 0L" + f1(px - TC[0]) + " 0");
  pol.setAttribute("transform", "translate(" + f1(px - TC[0]) + " 0)");
  jamG.setAttribute("opacity", sm.on.toFixed(2));
  /* tumour shakes, blebs and stops dividing */
  const tsc = 1 - 0.15 * sm.K;
  place(tumG, TC[0], TC[1], Math.sin(tm / 300) * 4 * sm.K, tsc);
  acc.bleb += dt * sm.K * 4;
  while (acc.bleb >= 1) { acc.bleb--; const p = free(bleb); if (p) { const a = rnd(0, 6.28); emit(p, TC[0] + Math.cos(a) * TR * tsc, TC[1] + Math.sin(a) * TR * tsc, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  bleb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  const dg = (1 - sm.K) * (1 + 0.05 * Math.sin(tm / 500));
  place(dauG, 400, 355, 0, Math.max(dg, 0.001)); dauG.style.opacity = dg > 0.05 ? 1 : 0;
  $("ara-pill").style.opacity = sm.on.toFixed(2); $("ctp-pill").style.opacity = sm.on.toFixed(2);
  /* drug in the blood reaches each harmed organ */
  acc.sys += dt * sm.on * 5;
  while (acc.sys >= 1) { acc.sys--; const p = free(sys); if (p) { const tg = pick(SYS_T); emit(p, 474, tg[1] + rnd(-8, 8), 60, 0, tg[0]); } }
  sys.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x >= p.k) kill(p); });
  /* brain shakes and the cerebellum sparks */
  place(brn.g, 592 + Math.sin(tm / 90) * 4 * sm.Cb, 182 + Math.cos(tm / 110) * 3 * sm.Cb, Math.sin(tm / 130) * 3 * sm.Cb, 1);
  cerebE.setAttribute("opacity", (sm.Cb * 0.5).toFixed(2));
  acc.spk += dt * sm.on * (0.5 + sm.Cb * 5);
  while (acc.spk >= 1) { acc.spk--; const p = free(spark); if (p) emit(p, cereb[0] + rnd(-14, 14), cereb[1] + rnd(-10, 10), 0, 0, 0); }
  spark.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.6).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); });
  /* marrow cells run low while blasts die with the kill */
  const keep = (1 - 0.85 * sm.Ms) * marCells.length;
  marCells.forEach((c, i) => { const s = clamp(keep - i); place(c.g, c.x, c.y, 0, Math.max(s, 0.001)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  const bs = clamp(1 - sm.K * 1.2);
  blasts.forEach((c) => { place(c.g, c.x, c.y, 0, Math.max(bs, 0.001)); c.g.style.opacity = bs > 0.05 ? 1 : 0; });
  /* eyes stream, steroid drops guard them */
  eyeRed.setAttribute("opacity", (sm.Ey * 0.55).toFixed(2));
  acc.tea += dt * sm.Ey * 6;
  while (acc.tea >= 1) { acc.tea--; const p = free(tear); if (p) emit(p, 580 + rnd(-18, 18), 352, 0, 45, 0); }
  tear.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 392) kill(p); });
  dropG.setAttribute("opacity", sm.pro.toFixed(2));
  acc.sdr += dt * sm.pro * 3;
  while (acc.sdr >= 1) { acc.sdr--; const p = free(sdrop); if (p) emit(p, 610 + rnd(-6, 6), 282, 0, 60, 0); }
  sdrop.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 302) kill(p); });
  /* skin rash, fever shimmer and ache flashes; mouth sores */
  const rsh = Math.max(sm.Sy, sm.Mk);
  rashE.forEach((e) => e.setAttribute("opacity", (rsh * 0.85).toFixed(2)));
  heatE.forEach((h) => { h.t += dt * 0.5; if (h.t > 1) h.t -= 1; h.e.setAttribute("transform", "translate(" + h.x + " " + f1(360 - h.t * 45) + ")"); h.e.setAttribute("opacity", (sm.Sy * (1 - h.t) * 0.9).toFixed(2)); });
  acheE.forEach((a) => a.e.setAttribute("opacity", (sm.Sy * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(tm / 250 + a.ph)))).toFixed(2)));
  lipRed.setAttribute("opacity", (sm.Mk * 0.45).toFixed(2));
  soreE.forEach((e) => e.setAttribute("opacity", sm.Mk.toFixed(2)));
  /* caption and gauges */
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "medium", "high"]));
  gg.mar.set(sm.Ms, wordOf(sm.Ms, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.wob.set(sm.Cb, wordOf(sm.Cb, 0.3, 0.6, ["steady", "wobbly", "very wobbly"]));
  gg.syn.set(sm.Sy, wordOf(sm.Sy, 0.25, 0.6, ["none", "some", "strong"]));
  gg.eye.set(sm.Ey, wordOf(sm.Ey, 0.25, 0.6, ["calm", "sore", "streaming"]));
  gg.rsh.set(sm.Mk, wordOf(sm.Mk, 0.3, 0.6, ["clear", "some", "angry"]));
}
run({ init, step });
