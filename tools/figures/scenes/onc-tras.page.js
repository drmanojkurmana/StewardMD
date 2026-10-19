/* Onc-tras scene: trastuzumab coats HER2 on the tumour, blocks its signal and recruits NK cells (left);
 * heart, lung, bowel and skin show the side effects and heart check protection (right). */
const TCX = 225, TCY = 245, TR = 100;
const HX = 625, HY = 185, LX = 838, LY = 165;
const HER_ANG = [-160, -118, -76, -34, 8, 48, 128, 162];
const L = { tum: $("tum"), her: $("her"), sig: $("sig"), ab: $("ab"), nk: $("nk"), gran: $("gran"), frag: $("frag"), heartSlot: $("heartSlot"), heartFx: $("heartFx"), lungSlot: $("lungSlot"), lungFx: $("lungFx"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), skinSlot: $("skinSlot"), skinFx: $("skinFx"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, nkG = null, heartO = null, flash = null, dil = null, ring = null, haze = null, gutTint = null, flush = null, capEl = null, capKey = "";
let recs = [], wheals = [], gg = {}, cs = 1;
let abP, sigP, granP, debP, survP, sparkP, hazeP, sloP, heatP;
function rad(d) { return d * Math.PI / 180; }
function slotPos(k) { const a = rad(HER_ANG[k]), r = TR * cs + 18; return { x: TCX + Math.cos(a) * r, y: TCY + Math.sin(a) * r, rot: HER_ANG[k] }; }
function capText(d, l) {
  if (d === 0) return "No treatment. HER2 drives the tumour to grow and no drug harm builds.";
  if (d === 2 && l === 0) return "First courses with heart checks. Tumour kill proceeds and the heart is watched from the start.";
  if (d === 2 && l === 1) return "Middle courses with heart checks. The tumour shrinks while early strain pauses the drug before failure.";
  if (d === 2) return "Late courses with heart checks. The tumour is controlled and pauses kept the heart working; other harms still need care.";
  if (l === 0) return "First courses. Trastuzumab coats HER2, blocks its signal and NK cells move in; infusion reactions are worst now.";
  if (l === 1) return "Middle courses. Tumour kill builds, infusion reactions settle and the heart begins to feel the lost survival signal.";
  return "Late courses. The tumour is dying but HER2 blockade has weakened the heart toward failure; the lung stays mostly clear.";
}
function init() {
  /* ---- tumour cell with HER2 receptors on its rim ---- */
  tumG = cell(L.tum, { cls: "graft", r: TR, nuc: 0.5, seed: 3, wob: 0.07, n: 10 });
  recs = HER_ANG.map((ad) => {
    const g = mk("g", {}, L.her);
    mk("rect", { class: "tr-stem", x: -2, y: -2.5, width: 10, height: 5, rx: 2 }, g);
    mk("circle", { class: "tr-knob", cx: 10, cy: -4.5, r: 4.6 }, g);
    mk("circle", { class: "tr-knob", cx: 10, cy: 4.5, r: 4.6 }, g);
    mk("path", { class: "tr-tail", d: "M-2 0L-13 0" }, g);
    const tip = mk("circle", { class: "tr-tip", cx: -15, cy: 0, r: 2.6 }, g);
    return { g, tip, ad };
  });
  flash = mk("path", { class: "tr-flash", d: "M128 232L142 246L132 249L146 268", opacity: "0" }, L.tum);
  abP = pool(10, () => { const g = mk("g", {}, L.ab); mk("path", { class: "tr-abd", d: "M-1.6 8L-1.6 -1L-6.5 -9L-3.4 -10.6L0 -3.6L3.4 -10.6L6.5 -9L1.6 -1L1.6 8Z" }, g); return g; });
  sigP = pool(18, () => mk("circle", { class: "sc-p tr-sig", r: 2.4 }, L.sig));
  /* ---- NK cell that drifts in when antibody coats the tumour ---- */
  nkG = cell(L.nk, { cls: "lymph", r: 20, nuc: 0.5, seed: 5, wob: 0.1 });
  place(nkG, 86, 332, 0, 1);
  granP = pool(12, () => mk("circle", { class: "sc-p tr-gran", r: 2.2 }, L.gran));
  debP = pool(14, () => mk("circle", { class: "sc-p tr-deb", r: 2.5 }, L.frag));
  /* ---- heart: survival signal flows when healthy, sparks and dilation with damage ---- */
  heartO = organ(L.heartSlot, "heart", HX, HY, 170, { h: 175 });
  dil = mk("ellipse", { class: "tr-dil", cx: HX, cy: HY, rx: 88, ry: 80, opacity: "0" }, L.heartFx);
  ring = mk("ellipse", { class: "tr-shield", cx: HX, cy: HY, rx: 84, ry: 76, opacity: "0" }, L.heartFx);
  survP = pool(10, () => mk("circle", { class: "sc-p tr-surv", r: 2.6 }, L.heartFx));
  sparkP = pool(20, () => mk("path", { class: "sc-p tr-spark", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, L.heartFx));
  /* ---- lung: faint haze of rare interstitial injury ---- */
  organ(L.lungSlot, "lung", LX, LY, 150, { h: 95 });
  haze = mk("ellipse", { class: "tr-haze", cx: LX, cy: LY, rx: 60, ry: 35, opacity: "0" }, L.lungFx);
  hazeP = pool(8, () => mk("circle", { class: "sc-p tr-hazep", r: 3 }, L.lungFx));
  /* ---- bowel: reddens and sheds with diarrhoea ---- */
  organ(L.gutSlot, "bowel", 612, 345, 150, { h: 85 });
  gutTint = mk("ellipse", { class: "tr-gut", cx: 612, cy: 345, rx: 62, ry: 34, opacity: "0" }, L.gutFx);
  sloP = pool(10, () => mk("circle", { class: "sc-p tr-slough", r: 2.2 }, L.gutFx));
  /* ---- skin: flush, wheals and heat of the infusion reaction ---- */
  organ(L.skinSlot, "skin", 795, 345, 115, { h: 85 });
  flush = mk("ellipse", { class: "tr-flush", cx: 795, cy: 345, rx: 48, ry: 32, opacity: "0" }, L.skinFx);
  [[772, 338], [792, 330], [812, 340], [783, 356], [804, 358]].forEach(([x, y]) => wheals.push(mk("ellipse", { class: "tr-wheal", cx: x, cy: y, rx: 5, ry: 3.6, opacity: "0" }, L.skinFx)));
  heatP = pool(8, () => mk("circle", { class: "sc-p tr-heat", r: 2.2 }, L.skinFx));
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "Trastuzumab", 55, 240, 78, 118, "Trastuzumab, an antibody to the HER2 extracellular domain. It coats HER2 on tumour cells, blocks growth signalling and flags the cell for NK cells.");
  pill(o, "HER2", 313, 194, 390, 112, "HER2, a growth signal receiver overmade by this tumour. When switched on it tells the cell to divide; the antibody silences it.");
  pill(o, "NK cell", 97, 325, 72, 388, "Natural killer cell. It grips antibody coated tumour cells and injects granules that kill them (ADCC).");
  pill(o, "Tumour cell", 235, 340, 235, 388, "HER2 positive tumour cell. Blocked signalling plus NK attack kills it; without treatment it keeps dividing.");
  pill(o, "Heart", 630, 255, 645, 292, "Cardiotoxicity. HER2 signalling keeps heart muscle alive under stress, so blocking it weakens the pump toward reversible failure, worse after anthracyclines.");
  pill(o, "Lung", 838, 205, 838, 252, "Interstitial lung disease, rare. Immune irritation scars the air sac walls and stiffens the lung.");
  pill(o, "Bowel", 612, 380, 560, 414, "Diarrhoea. HER2 blockade irritates the gut lining so it absorbs less water and moves faster.");
  pill(o, "Skin flush", 795, 382, 770, 414, "Infusion reaction. The first antibody dose activates immune cells that flush the skin with fever and chills; later doses are milder.");
  capEl = mk("text", { class: "tr-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. Trastuzumab coats HER2, blocks its growth signal and recruits NK cells that kill the coated cell (ADCC)."],
    ["heart", "Heart damage", "g-bad", "Cardiotoxicity. Heart muscle needs HER2 signalling to survive stress, so blockade weakens the pump toward reversible failure, worse after anthracyclines. Heart checks with early pause keep it low."],
    ["inf", "Infusion", "g-eos", "Infusion reaction. The first antibody dose activates immune cells, flushing the skin with fever and chills; later doses are milder."],
    ["gut", "Diarrhoea", "g-cyt", "Diarrhoea. HER2 blockade irritates the gut lining so it absorbs less water and moves faster."],
    ["lung", "Lung injury", "g-fl", "Interstitial lung disease, rare. Immune irritation scars the air sac walls and stiffens the lung."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 140 + i * 155, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Ht: 0.3, Inf: 0.3, Di: 0.2, Lu: 0.05, on: 0, mon: 0 };
const acc = { ab: 0, sig: 0, gran: 0, deb: 0, surv: 0, spark: 0, haze: 0, slo: 0, heat: 0 };
let hitFlash = 0;
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Ht = lerp(sm.Ht, m.Ht, k); sm.Inf = lerp(sm.Inf, m.Inf, k);
  sm.Di = lerp(sm.Di, m.Di, k); sm.Lu = lerp(sm.Lu, m.Lu, k); sm.on = lerp(sm.on, m.on, k); sm.mon = lerp(sm.mon, m.mon, k);
  /* tumour cell pulses, grows without treatment, shrinks with kill */
  cs = (1 - 0.1 * sm.K * sm.on + (1 - sm.on) * 0.05) * (1 + 0.015 * Math.sin(tm / 700));
  place(tumG, TCX, TCY, 0, cs);
  /* HER2 receptors ride the rim and glow while signalling */
  const lodged = abP.filter((p) => p.on && p.st === 2).length;
  const block = clamp(lodged / 6), sig = m.on ? clamp(1 - block) : 1;
  recs.forEach((r, i) => { const a = rad(r.ad);
    place(r.g, TCX + Math.cos(a) * TR * cs, TCY + Math.sin(a) * TR * cs, r.ad, 1);
    r.tip.setAttribute("opacity", (0.25 + 0.75 * sig * (0.6 + 0.4 * Math.sin(tm / 260 + i * 1.3))).toFixed(2)); });
  /* antibodies fly in and dock on HER2; they leave when treatment stops */
  const want = m.on ? 8 : 0;
  let n = 0;
  abP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; });
  acc.ab += dt * m.on * 2.6;
  while (acc.ab >= 1) { acc.ab--; if (n < want) { const p = free(abP); if (p) { const used = {}; abP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 8) si++; emit(p, rnd(20, 50), rnd(190, 290), 0, 0, si % 8); n++; } } }
  if (n > want) { const p = abP.find((q) => q.on && q.st === 2) || abP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  abP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = slotPos(p.k), dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy) || 1, v = 110 * dt;
      if (d < v + 2) { p.x = s.x; p.y = s.y; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 47) + ")"); }
    else if (p.st === 2) { const s = slotPos(p.k); p.x = s.x; p.y = s.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(s.rot + 90) + ")"); }
    else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  /* HER2 signal cascade streams to the nucleus until blocked */
  acc.sig += dt * (0.2 + 9 * sig);
  while (acc.sig >= 1) { acc.sig--; const p = free(sigP), r = pick(recs); if (p && r) { const a = rad(r.ad), rr = TR * cs - 14; emit(p, TCX + Math.cos(a) * rr, TCY + Math.sin(a) * rr, 0, 0, 0); } }
  sigP.forEach((p) => { if (!p.on) return; const dx = TCX - p.x, dy = TCY - p.y, d = Math.hypot(dx, dy) || 1, v = 70 * dt;
    p.x += dx / d * v; p.y += dy / d * v; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 40) kill(p); });
  /* NK cell drifts in with coating and fires granules at the tumour */
  const bf = clamp(block * sm.on + block * 0.2);
  place(nkG, 86 + 22 * bf + Math.sin(tm / 1500) * 2, 332 - 14 * bf + Math.cos(tm / 1800) * 2, Math.sin(tm / 2600) * 6, 1);
  acc.gran += dt * bf * sm.K * 9;
  while (acc.gran >= 1) { acc.gran--; const p = free(granP); if (p) emit(p, 86 + 22 * bf + 14, 332 - 14 * bf - 6, 0, 0, 0); }
  granP.forEach((p) => { if (!p.on) return; const tx = TCX - TR * cs + 4, ty = TCY + 8, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1, v = 130 * dt;
    p.x += dx / d * v; p.y += dy / d * v; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (d < 9) { hitFlash = 1; kill(p); } });
  hitFlash = Math.max(0, hitFlash - dt * 2.2);
  flash.setAttribute("opacity", (hitFlash * 0.85).toFixed(2));
  /* debris from dying tumour cells */
  acc.deb += dt * sm.K * sm.on * 8;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * TR * cs, TCY + Math.sin(a) * TR * cs, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* heart beats, loses its survival signal, sparks and dilates with damage */
  organBeat();
  acc.surv += dt * (1 - sm.Ht) * 3;
  while (acc.surv >= 1) { acc.surv--; const p = free(survP); if (p) emit(p, HX + rnd(-40, 40), HY - 60, rnd(-4, 4), rnd(24, 34), 0); }
  survP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > HY + 62) kill(p); });
  acc.spark += dt * sm.Ht * 14;
  while (acc.spark >= 1) { acc.spark--; const p = free(sparkP); if (p) emit(p, HX + rnd(-55, 55), HY + rnd(-50, 50), rnd(-6, 6), rnd(-6, 6), 0); }
  sparkP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ") scale(" + (0.6 + p.t).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  /* lung haze of rare injury */
  haze.setAttribute("opacity", clamp(sm.Lu * 2.2).toFixed(2));
  acc.haze += dt * sm.Lu * 10;
  while (acc.haze >= 1) { acc.haze--; const p = free(hazeP); if (p) emit(p, LX + rnd(-50, 50), LY + 28, rnd(-3, 3), rnd(-16, -10), 0); }
  hazeP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) kill(p); });
  /* gut reddens and sheds */
  gutTint.setAttribute("opacity", (sm.Di * 0.6).toFixed(2));
  acc.slo += dt * sm.Di * 6;
  while (acc.slo >= 1) { acc.slo--; const p = free(sloP); if (p) emit(p, rnd(560, 664), 382, rnd(-4, 4), rnd(25, 40), 0); }
  sloP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 428) kill(p); });
  /* skin flush, wheals and heat */
  flush.setAttribute("opacity", (sm.Inf * 0.6).toFixed(2));
  wheals.forEach((e, i) => e.setAttribute("opacity", (clamp((sm.Inf - 0.1) * 1.6) * (0.55 + 0.15 * Math.sin(tm / 500 + i * 2))).toFixed(2)));
  acc.heat += dt * sm.Inf * 7;
  while (acc.heat >= 1) { acc.heat--; const p = free(heatP); if (p) emit(p, rnd(756, 834), 302, rnd(-3, 3), rnd(-22, -14), 0); }
  heatP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 272) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.heart.set(sm.Ht, wordOf(sm.Ht, 0.25, 0.6, ["none", "some", "severe"]));
  gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.25, 0.5, ["none", "flushed", "severe"])); gg.gut.set(sm.Di, wordOf(sm.Di, 0.25, 0.45, ["ok", "loose", "severe"]));
  gg.lung.set(sm.Lu, wordOf(sm.Lu, 0.08, 0.15, ["clear", "faint haze", "haze"]));
}
function organBeat() {
  place(heartO.g, HX, HY, 0, 1 + 0.028 * Math.sin(tm / 430) * (1 - 0.5 * sm.Ht));
  dil.setAttribute("rx", f1(88 + 12 * sm.Ht)); dil.setAttribute("ry", f1(80 + 10 * sm.Ht)); dil.setAttribute("opacity", (0.15 + 0.55 * sm.Ht).toFixed(2));
  ring.setAttribute("opacity", sm.mon.toFixed(2));
}
run({ init, step });
