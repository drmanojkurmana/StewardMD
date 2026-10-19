/* Onc-atra scene: ATRA docks on PML-RARa and destroys it, restarting neutrophil
 * maturation (left); lung, brain, liver, skin and uterus show the side effects (right). */
const TCX = 240, TCY = 240;
const LX = 625, LY = 185, BX = 810, BY = 175, VX = 605, VY = 335, SX = 760, SY = 335, UX = 880, UY = 335;
const L = { tum: $("tum"), atra: $("atra"), deb: $("deb"), mat: $("mat"), vessel: $("vessel"), wbc: $("wbc"), lungSlot: $("lungSlot"), lungFx: $("lungFx"), brainSlot: $("brainSlot"), brainFx: $("brainFx"), livSlot: $("livSlot"), livFx: $("livFx"), skinSlot: $("skinSlot"), skinFx: $("skinFx"), uteSlot: $("uteSlot"), uteFx: $("uteFx"), over: $("over"), panel: $("panel") };
const SLOTS = [214, 232, 250, 268].map((x) => [x, 240]);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, glow = null, clampL = null, clampR = null, arrowX = null, lungO = null, eff = null, shield = null, brainO = null, tint = null, warn = null, capEl = null, capKey = "";
let rods = [], grans = [], neus = [], blasts = [], fats = [], flakes = [], cracks = [], gg = {};
let atraP, debP, cytP, leakP, dexP, wbcP, ringP;
function capText(d, l) {
  if (d === 0) return "No treatment. PML-RARa clamps the maturation genes shut, so promyelocytes pile up and no drug harm builds.";
  if (d === 2 && l === 0) return "Early course with dexamethasone. Maturation restarts while the steroid damps the cytokine surge and protects the lung.";
  if (d === 2 && l === 1) return "Middle course with dexamethasone. Blasts keep maturing and the lung stays dry, though white cells still climb.";
  if (d === 2) return "Late course with dexamethasone. The disease is controlled with the syndrome prevented; other ATRA harms still need care.";
  if (l === 0) return "Early ATRA. The drug docks on PML-RARa and maturation restarts, but cytokines surge and the lung leaks: differentiation syndrome.";
  if (l === 1) return "Middle course. More blasts mature into neutrophils while white cells climb and syndrome risk peaks.";
  return "Late course. Most blasts have matured and the syndrome has eased, but white cells, head pressure, blood fats and dry skin need care.";
}
function init() {
  /* ---- promyelocyte: granules, Auer rods, nucleus with DNA and the PML-RARa clamp ---- */
  tumG = cell(L.tum, { cls: "lymph", r: 95, nuc: 0.55, seed: 5, wob: 0.07, n: 10 });
  for (let i = 0; i < 14; i++) { const a = rnd(0, 6.28), r = rnd(60, 84); grans.push(mk("circle", { class: "ax-gran", cx: f1(TCX + Math.cos(a) * r), cy: f1(TCY + Math.sin(a) * r), r: f1(rnd(1.5, 2.6)) }, L.tum)); }
  rods = ["M160 200L195 218", "M155 262L190 250", "M298 272L330 256"].map((d) => mk("path", { class: "ax-rod", d }, L.tum));
  const hot = mk("g", { class: "hot", tabindex: "0", "data-info": "Promyelocyte stuck by PML-RARa. Needle shaped Auer rods and heavy granules mark these blasts; without ATRA they pile up instead of maturing." }, L.tum);
  mk("circle", { cx: TCX, cy: TCY, r: 95, fill: "none", "pointer-events": "all" }, hot);
  mk("path", { class: "ax-dna", d: "M195 236L285 236M195 244L285 244" }, L.tum);
  let rg = "";
  for (let x = 199; x <= 283; x += 9) rg += "M" + x + " 236L" + x + " 244";
  mk("path", { class: "ax-rung", d: rg }, L.tum);
  glow = mk("path", { class: "ax-glow", d: "M195 240L285 240", opacity: "0" }, L.tum);
  clampL = mk("g", { class: "ax-clamp" }, L.tum);
  mk("rect", { class: "ax-cb", x: 200, y: 228, width: 40, height: 24, rx: 8 }, clampL);
  mk("circle", { class: "ax-cb", cx: 200, cy: 240, r: 9 }, clampL);
  clampR = mk("g", { class: "ax-clamp" }, L.tum);
  mk("rect", { class: "ax-cb", x: 240, y: 228, width: 40, height: 24, rx: 8 }, clampR);
  mk("circle", { class: "ax-cb", cx: 280, cy: 240, r: 9 }, clampR);
  atraP = pool(10, () => mk("path", { class: "sc-p ax-atra", d: "M0 -4.5L4.5 3L-4.5 3Z" }, L.atra));
  debP = pool(12, () => mk("circle", { class: "sc-p ax-deb", r: 2.5 }, L.deb));
  /* ---- maturation arrow, block cross, new neutrophils, stuck blasts ---- */
  mk("path", { class: "ax-arrow", d: "M240 342L240 370M234 364L240 372L246 364" }, L.mat);
  arrowX = mk("path", { class: "ax-blockx", d: "M230 347L250 367M250 347L230 367" }, L.mat);
  neus = [180, 240, 300].map((x, i) => cell(L.mat, { cls: "neut", r: 13, nuc: 0.55, nucCls: "multi", seed: i + 11, wob: 0.14, x, y: 392 }));
  blasts = [[80, 350], [400, 350]].map(([x, y], i) => { const g = cell(L.mat, { cls: "lymph", r: 16, nuc: 0.62, seed: i + 30, wob: 0.08 }); place(g, x, y, 0, 1); return { g, x, y }; });
  /* ---- blood vessel strip: white cells stream across as leucocytosis builds ---- */
  const vs = mk("g", { class: "hot", tabindex: "0", "data-info": "Blood. Maturing promyelocytes flood the bloodstream, so the white cell count climbs steeply during treatment." }, L.vessel);
  mk("rect", { class: "sc-lumen", x: 494, y: 86, width: 442, height: 14, rx: 7 }, vs);
  wbcP = pool(26, () => mk("circle", { class: "sc-p ax-wbc", r: 3 }, L.wbc));
  /* ---- lung: cytokines, capillary leak, effusion, dexamethasone shield ---- */
  lungO = organ(L.lungSlot, "lung", LX, LY, 150, { h: 130 });
  eff = mk("ellipse", { class: "ax-eff", cx: LX, cy: 240, rx: 18, ry: 4, opacity: "0" }, L.lungFx);
  shield = mk("ellipse", { class: "ax-shield", cx: LX, cy: LY, rx: 84, ry: 72, opacity: "0" }, L.lungFx);
  cytP = pool(24, () => mk("circle", { class: "sc-p ax-cyt", r: 2.4 }, L.lungFx));
  leakP = pool(20, () => mk("circle", { class: "ax-leak", r: 2.4 }, L.lungFx));
  dexP = pool(10, () => mk("circle", { class: "sc-p ax-dex", r: 3 }, L.lungFx));
  /* ---- brain: pressure tint and expanding rings ---- */
  brainO = organ(L.brainSlot, "brain", BX, BY, 140, { h: 120 });
  tint = mk("ellipse", { class: "ax-tint", cx: BX, cy: BY, rx: 58, ry: 48, opacity: "0" }, L.brainFx);
  ringP = pool(6, () => mk("circle", { class: "ax-ring", r: 30 }, L.brainFx));
  /* ---- liver: fat dots; skin: flakes and cracks; uterus: pregnancy warning ---- */
  organ(L.livSlot, "liver", VX, VY, 130, { h: 90 });
  for (let i = 0; i < 10; i++) fats.push(mk("circle", { class: "ax-fat", cx: f1(VX + rnd(-42, 42)), cy: f1(VY + rnd(-24, 24)), r: 3, opacity: "0" }, L.livFx));
  organ(L.skinSlot, "skin", SX, SY, 100, { h: 85 });
  for (let i = 0; i < 8; i++) { const e = mk("rect", { class: "ax-flake", x: -3.5, y: -1.5, width: 7, height: 3, rx: 1, opacity: "0" }, L.skinFx); flakes.push({ e, x: SX + rnd(-36, 36), y: SY + rnd(-28, 28), r: rnd(0, 180) }); }
  cracks = ["M735 318l10 8l-6 9l12 6", "M762 312l8 10l-8 8l10 9", "M786 320l9 7l-5 10l11 5"].map((d) => mk("path", { class: "ax-crack", d, opacity: "0" }, L.skinFx));
  organ(L.uteSlot, "uterus", UX, UY, 70, {});
  warn = mk("g", { opacity: "0" }, L.uteFx);
  mk("circle", { class: "ax-warn", cx: UX, cy: UY, r: 30 }, warn);
  mk("path", { class: "ax-warn", d: "M859 356L901 314" }, warn);
  /* ---- labels, caption, gauges ---- */
  const o = L.over;
  pill(o, "ATRA", 60, 300, 70, 120, "All-trans retinoic acid, a vitamin A derivative. It docks on the PML-RARa fusion protein and marks it for destruction.");
  pill(o, "PML-RARa", 240, 240, 370, 112, "PML-RARa fusion protein. It clamps the maturation genes shut, freezing white cells as promyelocytes.");
  pill(o, "New neutrophils", 180, 392, 130, 421, "Mature neutrophils. Once the clamp is destroyed, the maturation genes switch on and blasts become working neutrophils.");
  pill(o, "Leaky lung", 625, 246, 548, 278, "Differentiation syndrome. Maturing cells release cytokines that make lung capillaries leak, so fluid floods the air spaces and pleura: fever, breathlessness and effusions.");
  pill(o, "Brain pressure", 835, 228, 845, 280, "Raised pressure inside the skull. ATRA can raise intracranial pressure, giving headache and blurred vision.");
  pill(o, "Blood fats", 605, 370, 560, 412, "High blood triglycerides. ATRA disturbs lipid handling, so blood fats rise and the liver strains.");
  pill(o, "Dry skin", 760, 370, 740, 412, "Dry skin and lips. ATRA dries and peels skin and mucous membranes like strong vitamin A.");
  pill(o, "No pregnancy", 880, 366, 876, 412, "Teratogenic. ATRA severely harms the unborn child, so pregnancy must be avoided and excluded before treatment.");
  capEl = mk("text", { class: "ax-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["mat", "Maturation", "g-good", "Maturation restarted. ATRA destroys PML-RARa, so the blocked genes switch on and promyelocytes mature into neutrophils."],
    ["syn", "Syndrome", "g-bad", "Differentiation syndrome. A cytokine surge from maturing cells makes capillaries leak: fever, breathlessness, effusions and weight gain. Dexamethasone prevents and treats it."],
    ["wbc", "White cells", "g-neu", "Leucocytosis. Maturing promyelocytes flood the blood, so the white count climbs steeply."],
    ["icp", "Head pressure", "g-cyt", "Raised intracranial pressure. ATRA can raise pressure inside the skull, giving headache and blurred vision."],
    ["fat", "Blood fats", "g-clot", "High blood triglycerides. ATRA disturbs lipid handling, so blood fats rise and the liver strains."],
    ["skn", "Dry skin", "g-eos", "Dry skin, lips and mouth. ATRA dries skin and mucous membranes, which crack and peel."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
const sm = { D: 0.4, DS: 0.3, Wc: 0.4, ICP: 0.3, Li: 0.3, Sk: 0.2, on: 0, dex: 0 };
const acc = { atra: 0, deb: 0, cyt: 0, leak: 0, dex: 0, wbc: 0, ring: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.D = lerp(sm.D, m.D, k); sm.DS = lerp(sm.DS, m.DS, k); sm.Wc = lerp(sm.Wc, m.Wc, k); sm.ICP = lerp(sm.ICP, m.ICP, k);
  sm.Li = lerp(sm.Li, m.Li, k); sm.Sk = lerp(sm.Sk, m.Sk, k); sm.on = lerp(sm.on, m.on, k); sm.dex = lerp(sm.dex, m.dex, k);
  /* leukaemia cell pulses; clamp splits and fades as ATRA destroys it */
  place(tumG, TCX, TCY, 0, (0.96 + 0.06 * (1 - sm.D)) * (1 + 0.012 * Math.sin(tm / 700)));
  place(clampL, -sm.D * 14, 0, 0, 1); place(clampR, sm.D * 14, 0, 0, 1);
  clampL.setAttribute("opacity", (1 - sm.D).toFixed(2)); clampR.setAttribute("opacity", (1 - sm.D).toFixed(2));
  glow.setAttribute("opacity", (sm.D * (0.5 + 0.3 * Math.sin(tm / 300))).toFixed(2));
  rods.forEach((r) => r.setAttribute("opacity", (1 - sm.D).toFixed(2)));
  grans.forEach((g) => g.setAttribute("opacity", (1 - 0.7 * sm.D).toFixed(2)));
  /* ATRA wedges fly in and dock on the clamp; they leave when treatment stops */
  const want = m.on ? 4 : 0;
  let n = 0;
  atraP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; });
  acc.atra += dt * m.on * 2.4;
  while (acc.atra >= 1) { acc.atra--; if (n < want) { const p = free(atraP); if (p) { const used = {}; atraP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 4) si++; emit(p, 18, rnd(190, 300), 0, 0, si % 4); n++; } } }
  if (n > want) { const p = atraP.find((q) => q.on && q.st === 2) || atraP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  atraP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = SLOTS[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 110 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 47) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.k * 30) + ")");
    else { p.x -= 70 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.x - 16) / 40).toFixed(2)); if (p.x < 18) kill(p); }
  });
  /* debris from the destroyed clamp */
  acc.deb += dt * sm.on * sm.D * 6;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, 240 + Math.cos(a) * 40, 240 + Math.sin(a) * 14, Math.cos(a) * 22, Math.sin(a) * 22, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* maturation: cross lifts, neutrophils grow in, stuck blasts clear */
  arrowX.setAttribute("opacity", (1 - sm.D).toFixed(2));
  neus.forEach((g, i) => { const s = 0.15 + 0.85 * sm.D; place(g, [180, 240, 300][i], 392 + Math.sin(tm / 600 + i * 2) * 2, 0, s); g.style.opacity = sm.D > 0.1 ? 1 : 0; });
  blasts.forEach((b, i) => { const s = 0.2 + 0.8 * (1 - sm.D); place(b.g, b.x, b.y + Math.sin(tm / 800 + i * 3) * 2, 0, s); b.g.style.opacity = sm.D < 0.9 ? 1 : 0; });
  /* white cells stream through the vessel */
  acc.wbc += dt * (1.5 + sm.Wc * 9);
  while (acc.wbc >= 1) { acc.wbc--; const p = free(wbcP); if (p) emit(p, 494, rnd(89, 97), rnd(40, 75), 0, 0); }
  wbcP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 936) kill(p); });
  /* lung: cytokines surge, capillaries leak, effusion pools; dexamethasone shields */
  acc.cyt += dt * sm.DS * 11;
  while (acc.cyt >= 1) { acc.cyt--; const p = free(cytP); if (p) emit(p, LX + rnd(-65, 65), rnd(140, 225), rnd(-6, 6), rnd(-20, -10), 0); }
  cytP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y < 108) kill(p); });
  acc.leak += dt * sm.DS * 8;
  while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) emit(p, LX + rnd(-40, 40), rnd(150, 185), 0, rnd(26, 38), 0); }
  leakP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 238) kill(p); });
  eff.setAttribute("rx", f1(18 + 42 * sm.DS)); eff.setAttribute("ry", f1(4 + 9 * sm.DS)); eff.setAttribute("opacity", (0.75 * sm.DS).toFixed(2));
  shield.setAttribute("opacity", sm.dex.toFixed(2));
  acc.dex += dt * sm.dex * 4;
  while (acc.dex >= 1) { acc.dex--; const p = free(dexP); if (p) emit(p, 938, rnd(140, 190), -90, 0, 0); }
  dexP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 712) kill(p); });
  /* brain: red pressure tint and expanding rings */
  place(brainO.g, BX, BY, 0, 1 + 0.02 * sm.ICP * Math.sin(tm / 430));
  tint.setAttribute("opacity", (0.45 * sm.ICP).toFixed(2));
  acc.ring += dt * (0.25 + sm.ICP * 1.4);
  while (acc.ring >= 1) { acc.ring--; const p = free(ringP); if (p) emit(p, BX, BY, 0, 0, 0); }
  ringP.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (0.3 + p.t * 0.9).toFixed(2) + ")"); p.e.setAttribute("opacity", ((0.12 + 0.6 * sm.ICP) * (1 - p.t / 1.6)).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* liver fats, skin flakes and cracks, pregnancy warning */
  fats.forEach((e, i) => e.setAttribute("opacity", sm.Li > 0.08 + i * 0.09 ? "0.95" : "0"));
  flakes.forEach((fl, i) => { place(fl.e, fl.x, fl.y, fl.r, 1); fl.e.setAttribute("opacity", sm.Sk > 0.1 + i * 0.1 ? "0.95" : "0"); });
  cracks.forEach((c) => c.setAttribute("opacity", (sm.Sk * 0.9).toFixed(2)));
  warn.setAttribute("opacity", sm.on.toFixed(2));
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.mat.set(sm.D, wordOf(sm.D, 0.3, 0.7, ["blocked", "starting", "flowing"])); gg.syn.set(sm.DS, wordOf(sm.DS, 0.3, 0.65, ["none", "warning", "severe"]));
  gg.wbc.set(sm.Wc, wordOf(sm.Wc, 0.35, 0.65, ["normal", "high", "very high"])); gg.icp.set(sm.ICP, wordOf(sm.ICP, 0.3, 0.6, ["none", "headache", "high"]));
  gg.fat.set(sm.Li, wordOf(sm.Li, 0.3, 0.6, ["normal", "raised", "high"])); gg.skn.set(sm.Sk, wordOf(sm.Sk, 0.3, 0.6, ["ok", "dry", "cracked"]));
}
run({ init, step });
