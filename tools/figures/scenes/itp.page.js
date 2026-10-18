/* Low platelets scene: marrow output, coated platelets to the spleen, vWF microthrombi with haemolysis, HIT activation and gauges. */
const LY = { back: $("back"), flow: $("flow"), parts: $("parts"), over: $("over"), panel: $("panel") };
const VW = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abY(parent, x, y, rot, sc) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5.5 -6.5M0 0L5.5 -6.5" }, g); place(g, x, y, rot, sc || 1); return g; }
const labels = [], trtPills = {};
function addLab(mode, text, x, y, tx, ty, tip) { const g = pill(LY.over, text, x, y, tx, ty, tip); labels.push({ g, mode }); return g; }
const gg = {};
const cur = { loss: 0.9, clot: 0.12, haem: 0.08, plt: 0.17, bleed: 0.7, marr: 0.9, vwf: 0, adam: 0.9, act: 0.15, ster: 0, plas: 0, noHep: 0, itp: 1, ttp: 0, hit: 0 };
let mega, spleenMac, clotGroups = [], vwfPaths = [], rbcs = [], miniRbcs = [], plts = [];
let buds, eaten, adamDots, hepDots, haemBits, bleedDrops, trtDots;
const acc = { bud: 0, eat: 0, adam: 0, hep: 0, haem: 0, bleed: 0, trt: 0 };
let shownMode = -1;
const clotSlots = [[742, 256], [782, 286], [826, 258], [866, 288], [620, 386], [706, 386], [792, 386], [878, 386]];
function initBack() {
  mega = mk("g", {}, LY.back); cell(mega, { cls: "mega", r: 36, nuc: 0.38, seed: 7, wob: 0.1 });
  place(mega, 113, 285, 0, 1);
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.4, b = cell(LY.back, { cls: "plt", r: 5, seed: i + 3, wob: 0.16, n: 7 }); place(b, 113 + Math.cos(a) * 44, 285 + Math.sin(a) * 40, 0, 1); }
  spleenMac = mk("g", {}, LY.back); cell(spleenMac, { cls: "mac", r: 27, nuc: 0.4, seed: 11, wob: 0.12 });
  place(spleenMac, 810, 192, 0, 1);
  for (let i = 0; i < 5; i++) { const y = 252 + i * 13, p = mk("path", { class: "it-vwf", d: "M240 " + y + "q30 -8 60 0" + "t60 0".repeat(10) }, LY.back); vwfPaths.push(p); }
  clotSlots.forEach(([x, y], ci) => { const g = mk("g", {}, LY.back);
    for (let j = 0; j < 6; j++) cell(g, { cls: "plt", r: 5 + (j % 3) * 0.6, x: Math.cos(j * 1.3) * 9, y: Math.sin(j * 2.1) * 6, seed: j + ci, wob: 0.15, n: 7 });
    for (let j = 0; j < 4; j++) mk("path", { class: "it-fib", d: "M" + f1(rnd(-15, 15)) + " " + f1(rnd(-8, 8)) + "L" + f1(rnd(-15, 15)) + " " + f1(rnd(-8, 8)) }, g);
    place(g, x, y, 0, 0.1); g.style.opacity = 0; clotGroups.push({ g, x, y }); });
}
function initFlow() {
  for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, LY.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.6 }, g); rbcs.push({ g, x: rnd(224, 922), y: rnd(248, 296), v: rnd(0.8, 1.2) }); }
  for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-rbc" }, LY.flow); const bodyEl = mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); const sc = mk("path", { class: "it-schist", d: "M-6 -4L6 -2L-1 5Z", opacity: "0" }, g); miniRbcs.push({ g, sc, bodyEl, x: rnd(490, 922), y: rnd(376, 396), v: rnd(0.8, 1.2) }); }
  for (let i = 0; i < 24; i++) { const g = mk("g", {}, LY.flow); const c = cell(g, { cls: "plt", r: 5, seed: i, wob: 0.16, n: 7 });
    const coat = abY(g, 0, -8, 0, 0.7); coat.setAttribute("opacity", "0");
    const spike = mk("path", { class: "it-spike", opacity: "0", d: "M-8 0L-4 0M8 0L4 0M0 -8L0 -4M0 8L0 4M-6 -6L-3 -3M6 6L3 3" }, g);
    plts.push({ g, coat, spike, x: rnd(224, 922), y: rnd(248, 296), px: 0, py: 0, v: rnd(0.85, 1.15), k: 0, st: 0, ph: rnd(0, 6) }); }
  buds = mkPool(10, () => mk("circle", { class: "sc-p p-bud", r: 3 }, LY.parts));
  eaten = mkPool(10, () => { const e = mk("g", {}, LY.parts); const c = cell(e, { cls: "plt", r: 5, seed: 2, wob: 0.16, n: 7 }); return e; });
  adamDots = mkPool(10, () => mk("circle", { class: "sc-p p-adam", r: 2.6 }, LY.parts));
  hepDots = mkPool(12, () => { const e = mk("g", {}, LY.parts); mk("circle", { class: "sc-p p-hep", r: 3 }, e); abY(e, 4, -4, 40, 0.6); return e; });
  haemBits = mkPool(12, () => mk("path", { class: "it-schist", d: "M-5 -3L5 -1L0 4Z" }, LY.parts));
  bleedDrops = mkPool(12, () => mk("path", { class: "p-bleed", d: "M0 -3C2 -.5 2.6 .8 2.6 1.8A2.6 2.6 0 0 1 -2.6 1.8C-2.6 .8 -2 -.5 0 -3Z" }, LY.parts));
  trtDots = mkPool(10, () => mk("circle", { class: "sc-p p-trt", r: 2.6 }, LY.parts));
}
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: VW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["plt", "Platelets", "g-good", "Platelet count in the blood. Low in all three causes shown, for different reasons."], ["loss", "Platelet loss", "g-cyt", "How fast platelets are removed, trapped or used up after the marrow makes them."], ["clot", "Clots", "g-clot", "Clots from trapped or switched on platelets: tiny and widespread in TTP, larger in HIT, few in ITP."], ["haem", "Haemolysis", "g-bad", "Red cell break-up as cells are sheared past microthrombi. A TTP feature."], ["bleed", "Bleeding risk", "g-fl", "Bleeding risk rises as the platelet count falls, most simply in ITP."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 160, y0 + 2, 52, 18, cls, name, tip); });
  addLab(-1, "Megakaryocyte", 113, 249, 113, 202, "Megakaryocyte in the marrow: the large cell that buds off platelets. In ITP, TTP and HIT it is working, often harder than usual. In marrow failure this cell and its output fall.");
  addLab(-1, "Platelet", 320, 272, 320, 205, "A platelet: a small cell fragment that plugs leaks and helps clotting. The count falls when platelets are removed, trapped or used up faster than they are made.");
  addLab(-1, "Red cell", 520, 285, 520, 205, "A red cell flowing through the vessel. In TTP it can be cut into fragments (schistocytes) by microthrombi, causing haemolysis.");
  addLab(0, "Antibody", 455, 255, 455, 162, "In ITP, antibody made by immune cells coats platelets. The coat itself is the removal signal.");
  addLab(0, "Spleen macrophage", 810, 165, 810, 140, "Macrophages in the spleen recognise the antibody coat and eat the platelet. This is the main removal site in ITP.");
  addLab(0, "Eaten here", 790, 210, 650, 205, "Coated platelets leave the flow and are eaten in the spleen, so fewer return to the blood.");
  addLab(1, "ADAMTS13 low", 380, 235, 380, 162, "ADAMTS13 is the enzyme that trims von Willebrand factor. In TTP it is severely lacking, usually because of an antibody against it.");
  addLab(1, "vWF strings", 575, 252, 575, 162, "Without trimming, very long von Willebrand factor strings stay in the vessel and catch passing platelets.");
  addLab(1, "Microthrombi", 700, 386, 700, 340, "Tiny platelet clots in small vessels. They block flow and use up platelets, so the count falls.");
  addLab(1, "Schistocytes", 560, 386, 520, 340, "Schistocytes: red cell fragments made when cells are sheared past microthrombi. Their break-up is haemolysis.");
  addLab(2, "Heparin and PF4", 380, 262, 380, 162, "In HIT, heparin binds platelet factor 4 from platelets. Antibody binds that pair and forms an immune complex.");
  addLab(2, "Platelets switch on", 575, 262, 575, 162, "The complex switches platelets on through their surface receptors. Switched on platelets release more platelet factor 4 and help make thrombin.");
  addLab(2, "Large clots", 760, 386, 710, 340, "Switched on platelets drive larger clots in veins or arteries, even though the platelet count is falling.");
  addLab(2, "Platelets used up", 620, 386, 530, 340, "Platelets are used up in clots and cleared after activation, so the count falls while clotting rises.");
  trtPills.ster = pill(LY.over, "Steroids and IVIG", 760, 205, 860, 340, "Steroids calm antibody making and spleen removal, and IVIG blocks spleen macrophages for a time. This helps ITP, not the missing enzyme of TTP or the heparin reaction of HIT.");
  trtPills.plas = pill(LY.over, "Plasma exchange", 660, 240, 860, 340, "Plasma exchange removes antibody and replaces ADAMTS13, so von Willebrand factor strings are trimmed again. This is the TTP treatment shown.");
  trtPills.noHep = pill(LY.over, "Heparin stopped", 650, 262, 860, 340, "Heparin is stopped so no new complexes form, and a non-heparin anticoagulant treats the clots while platelet activation settles. This is the HIT treatment shown.");
}
function init() { initBack(); initFlow(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  cur.loss = lerp(cur.loss, m.loss, k2); cur.clot = lerp(cur.clot, m.clot, k2); cur.haem = lerp(cur.haem, m.haem, k2);
  cur.plt = lerp(cur.plt, m.plt, k1); cur.bleed = lerp(cur.bleed, m.bleed, k2); cur.marr = lerp(cur.marr, m.marr, k2);
  cur.vwf = lerp(cur.vwf, m.vwf, k2); cur.adam = lerp(cur.adam, m.adam, k2); cur.act = lerp(cur.act, m.act, k2);
  cur.ster = lerp(cur.ster, m.ster, k1); cur.plas = lerp(cur.plas, m.plas, k1); cur.noHep = lerp(cur.noHep, m.noHep, k1);
  cur.itp = lerp(cur.itp, m.t === 0 ? 1 : 0, k1); cur.ttp = lerp(cur.ttp, m.t === 1 ? 1 : 0, k1); cur.hit = lerp(cur.hit, m.t === 2 ? 1 : 0, k1);
  labels.forEach((l) => { l.g.style.display = l.mode === -1 || l.mode === m.t ? "" : "none"; });
  if (m.t !== shownMode) { shownMode = m.t; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.t)); }
  trtPills.ster.style.opacity = cur.ster.toFixed(2); trtPills.plas.style.opacity = cur.plas.toFixed(2); trtPills.noHep.style.opacity = cur.noHep.toFixed(2);
  place(mega, 113, 285, Math.sin(tm / 900) * 3, 1 + 0.08 * cur.marr * Math.sin(tm / 320));
  place(spleenMac, 810, 192, 0, 1 + 0.18 * cur.itp * cur.loss * (0.5 + 0.5 * Math.sin(tm / 280)));
  vwfPaths.forEach((p) => p.setAttribute("opacity", (cur.vwf * 0.9).toFixed(2)));
  clotGroups.forEach((c, i) => { const s = clamp((cur.clot * Math.max(cur.ttp, cur.hit) - i * 0.04) * 1.6); place(c.g, c.x, c.y, 0, 0.1 + 0.9 * s); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  rbcs.forEach((r) => { r.x += r.v * 58 * dt; if (r.x > 928) { r.x = 220; r.y = rnd(248, 296); } place(r.g, r.x, r.y, Math.sin(tm / 500 + r.x) * 10, 1); });
  const miniFlow = clamp(1 - 0.75 * cur.clot * Math.max(cur.ttp, cur.hit));
  miniRbcs.forEach((s, i) => { s.x += s.v * 46 * miniFlow * dt; if (s.x > 926) { s.x = 486; s.y = rnd(376, 396); } place(s.g, s.x, s.y, Math.sin(tm / 450 + i) * 10, 1); const frag = cur.haem > 0.45 && i % 2 === 0; s.sc.setAttribute("opacity", frag ? 1 : 0); s.bodyEl.setAttribute("opacity", frag ? 0 : 1); });
  const stuckN = Math.round(cur.clot * Math.max(cur.ttp, cur.hit) * 10);
  plts.forEach((p, i) => {
    p.px = p.x; p.py = p.y;
    p.x += p.v * 62 * dt; if (p.x > 928) { p.x = 220; p.y = rnd(248, 296); p.st = 0; }
    const stuck = i < stuckN;
    p.k = lerp(p.k, stuck ? 1 : 0, Math.min(1, dt * 1.6));
    if (cur.itp > 0.5 && p.st === 0 && p.x > 700 && i % 3 !== 0 && cur.loss > 0.3) p.st = 1;
    let dx = p.x, dy = p.y + Math.sin(tm / 650 + p.ph) * 3;
    if (p.k > 0.03) { const s = clotSlots[i % clotSlots.length]; dx = lerp(dx, s[0], p.k); dy = lerp(dy, s[1], p.k); }
    if (p.st === 1) { dx = lerp(dx, 810, 0.55); dy = lerp(dy, 192, 0.55); p.x = lerp(p.x, 810, dt * 1.1); p.y = lerp(p.y, 192, dt * 1.1); dx = p.x; dy = p.y; if (Math.hypot(p.x - 810, p.y - 192) < 24) { p.x = 220; p.y = rnd(248, 296); p.st = 0; } }
    place(p.g, dx, dy, tm / 40 * p.k, 1 + 0.3 * p.k);
    p.coat.setAttribute("opacity", (cur.itp * (i % 5 !== 0 ? 1 : 0)).toFixed(2));
    p.spike.setAttribute("opacity", (cur.act * (stuck || cur.hit > 0.5 ? 1 : 0.3)).toFixed(2));
  });
  acc.bud += dt * cur.marr * 3; while (acc.bud >= 1) { acc.bud--; const p = freeP(buds); if (p) emitP(p, 152, 285 + rnd(-14, 14), 42, rnd(-6, 6), 0); }
  buds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 226 || p.t > 2) killP(p); });
  acc.eat += dt * cur.itp * cur.loss * 4; while (acc.eat >= 1) { acc.eat--; const p = freeP(eaten); if (p) emitP(p, 700, 272, 0, 0, 0); }
  eaten.forEach((p) => { if (!p.on) return; p.t += dt; p.x = lerp(p.x, 810, dt * 1.4); p.y = lerp(p.y, 192, dt * 1.4); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + clamp(1 - p.t / 2.4).toFixed(2) + ")"); if (p.t > 2.4) killP(p); });
  acc.adam += dt * cur.ttp * cur.adam * 5; while (acc.adam >= 1) { acc.adam--; const p = freeP(adamDots); if (p) emitP(p, rnd(260, 880), rnd(248, 300), rnd(10, 24), 0, 0); }
  adamDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6 || p.x > 926) killP(p); });
  acc.hep += dt * cur.hit * 6; while (acc.hep >= 1) { acc.hep--; const p = freeP(hepDots); if (p) emitP(p, 224, rnd(250, 298), rnd(30, 46), 0, 0); }
  hepDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 5).toFixed(2)); if (p.t > 5 || p.x > 926) killP(p); });
  acc.haem += dt * cur.haem * 6; while (acc.haem >= 1) { acc.haem--; const p = freeP(haemBits); if (p) emitP(p, rnd(520, 880), rnd(374, 398), rnd(-8, 14), rnd(-6, 6), 0); }
  haemBits.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) killP(p); });
  acc.bleed += dt * clamp(cur.bleed - 0.35) * 6; while (acc.bleed >= 1) { acc.bleed--; const p = freeP(bleedDrops); if (p) emitP(p, rnd(260, 900), 320, rnd(-3, 3), rnd(16, 26), 0); }
  bleedDrops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > 436) p.y = 436; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2) killP(p); });
  const trtAny = Math.max(cur.ster, cur.plas, cur.noHep);
  acc.trt += dt * trtAny * 5; while (acc.trt >= 1) { acc.trt--; const p = freeP(trtDots); if (p) emitP(p, 224, rnd(250, 298), rnd(36, 52), 0, 0); }
  trtDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4 || p.x > 926) killP(p); });
  gg.plt.set(cur.plt, wordOf(cur.plt, 0.35, 0.65, ["low", "reduced", "normal"]));
  gg.loss.set(cur.loss, wordOf(cur.loss, 0.3, 0.6, ["low", "raised", "high"]));
  gg.clot.set(cur.clot, wordOf(cur.clot, 0.3, 0.6, ["few", "some", "many"]));
  gg.haem.set(cur.haem, wordOf(cur.haem, 0.3, 0.6, ["none", "some", "marked"]));
  gg.bleed.set(cur.bleed, wordOf(cur.bleed, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
