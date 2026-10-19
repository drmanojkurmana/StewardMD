/* Asparaginase scene: blood asparagine chopped, the blast starves, and the harmed organs. */
const L = { tum: $("tumSlot"), org: $("orgSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const BC = [240, 292], BR = 100;
const sm = { K: 0, H: 0, P: 0, C: 0, Lv: 0, G: 0, F: 0, on: 0, pro: 0 };
const acc = { asn: 0, enz: 0, frag: 0, prot: 0, bleb: 0, hist: 0, spk: 0, ins: 0, atg: 0, fbg: 0, fat: 0, glu: 0, leak: 0, ah: 0, atx: 0 };
let blastG, dauG, blockE, glowE, fatovE, clotG, crackE, gg = {}, capEl = null, capKey = "";
let mastA, mastB, hiveE = [], fatDots = [], rbcs = [];
let trAsn, trDrug, trProt, trIns, trLiv, trSup1, trSup2, asn, enz, frag, prot, bleb, hist, spk, ins, atg, fbg, fat, glu, leak, ah, atx;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 2) return ["Allergy cover and clotting support ease allergy, clots and sugar. The blast still starves.", "Support holds allergy, clotting and sugar down, but pancreas and liver injury keep building.", "Even late on, support guards allergy, clots and sugar. Pancreas and liver harm need stopping."][l];
  if (d === 1) return ["Asparaginase chops blood asparagine. The blast cannot make its own, so its proteins run out.", "The blast starves and dies back while allergy, pancreas, clot, liver, sugar and fat harms build.", "Late courses kill more blasts but allergy, clot, pancreas, liver, sugar and fat harms all build."][l];
  return ["No treatment. Asparagine flows to the blast and it keeps dividing.", "No treatment. The blast keeps dividing and no harm builds.", "No treatment. The blast grows unchecked, with no benefit and no harm."][l];
}
const DROP = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
function init() {
  blastG = cell(L.tum, { cls: "blast", r: BR, nuc: 0.55, seed: 3, wob: 0.08, x: BC[0], y: BC[1] });
  /* the missing enzyme: greyed out, crossed, labelled */
  const sT = mk("text", { class: "sc-lab", x: 240, y: 246, "text-anchor": "middle" }, L.tum); sT.textContent = "synthetase";
  mk("rect", { class: "oc-syn", x: 196, y: 250, width: 88, height: 26, rx: 8 }, L.tum);
  mk("path", { class: "oc-synx", d: "M200 254L280 272M280 254L200 272" }, L.tum);
  /* ribosome with its protein chain, blocked as the blast starves */
  mk("ellipse", { class: "oc-ribo", cx: 284, cy: 322, rx: 10, ry: 8 }, L.tum);
  const pT = mk("text", { class: "sc-lab", x: 317, y: 312, "text-anchor": "middle" }, L.tum); pT.textContent = "protein";
  blockE = mk("path", { class: "oc-block", d: "M300 314L334 330M334 314L300 330", opacity: "0" }, L.tum);
  dauG = cell(L.tum, { cls: "blast", r: 26, nuc: 0.5, seed: 5, wob: 0.1, x: 408, y: 372 });
  /* mast cells and hives for hypersensitivity */
  mastA = cell(L.org, { cls: "mast", r: 15, nuc: 0.4, seed: 7, wob: 0.12, x: 530, y: 150 });
  mastB = cell(L.org, { cls: "mast", r: 13, nuc: 0.4, seed: 9, wob: 0.12, x: 592, y: 132 });
  [[505, 178, 14, 8], [558, 164, 12, 7], [622, 158, 10, 6]].forEach(([x, y, rx, ry]) => hiveE.push(mk("ellipse", { class: "oc-hive", cx: x, cy: y, rx, ry, opacity: "0" }, L.org)));
  /* pancreas with inflammation glow, liver with fatty overlay */
  glowE = mk("ellipse", { class: "oc-glow", cx: 565, cy: 305, rx: 88, ry: 50, opacity: "0" }, L.org);
  organ(L.org, "pancreas", 565, 305, 150, { h: 75 });
  fatovE = mk("ellipse", { class: "oc-fatov", cx: 795, cy: 168, rx: 55, ry: 32, opacity: "0" }, L.org);
  organ(L.org, "liver", 795, 168, 140, { h: 85 });
  [[770, 155], [788, 162], [806, 154], [818, 168], [782, 178], [800, 180]].forEach(([x, y]) => fatDots.push(mk("circle", { class: "oc-fat", cx: x, cy: y, r: 3, opacity: "0" }, L.org)));
  /* clot of platelets and fibrin sitting on the vessel wall */
  clotG = mk("g", {}, L.org);
  [[-14, 2, 5], [-6, -6, 6], [4, -2, 5], [12, 3, 6], [-2, 5, 4], [8, -7, 4]].forEach(([x, y, r], i) => cell(clotG, { cls: "plt", r, seed: i + 3, wob: 0.15, n: 7, x, y }));
  ["M-18 -6L12 2", "M-14 4L16 -2", "M-8 -8L6 6", "M-20 0L0 -8", "M-4 8L18 4"].forEach((d) => mk("path", { class: "fibrin", d }, clotG));
  crackE = mk("path", { class: "oc-block", d: "M670 392l6 -5l6 5", opacity: "0" }, L.org);
  /* red cells drifting through the vessel */
  for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.org); mk("ellipse", { class: "cl-b", rx: 8, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(668, 928), y: rnd(344, 384), v: rnd(0.8, 1.2) }); }
  /* tracks and particle pools */
  trAsn = track([[60, 116], [200, 116], [240, 170], [240, 228]]);
  trDrug = track([[16, 116], [200, 116], [420, 116]]);
  trProt = track([[298, 322], [336, 322]]);
  trIns = track([[648, 302], [668, 332], [700, 354]]);
  trLiv = track([[795, 218], [795, 280], [790, 332]]);
  trSup1 = track([[16, 424], [300, 428], [460, 390], [478, 220], [522, 168]]);
  trSup2 = track([[16, 424], [400, 428], [600, 424], [700, 394], [748, 366]]);
  asn = pool(12, () => mk("circle", { class: "sc-p p-asn", r: 3 }, L.parts));
  enz = pool(10, () => mk("path", { class: "sc-p p-enz", d: "M-5 0A5 5 0 1 0 5 0L0 0Z" }, L.parts));
  frag = pool(12, () => mk("rect", { class: "sc-p p-frag", x: -2.4, y: -1.4, width: 4.8, height: 2.8, rx: 1 }, L.parts));
  prot = pool(8, () => mk("circle", { class: "sc-p p-prot", r: 2.6 }, L.parts));
  bleb = pool(12, () => mk("circle", { class: "sc-p p-bleb", r: 3.4 }, L.parts));
  hist = pool(14, () => mk("circle", { class: "p-hist", r: 4 }, L.parts));
  spk = pool(10, () => mk("circle", { class: "sc-p p-spk", r: 2.4 }, L.parts));
  ins = pool(8, () => mk("circle", { class: "sc-p p-ins", r: 2.6 }, L.parts));
  atg = pool(8, () => mk("circle", { class: "sc-p p-at", r: 2.8 }, L.parts));
  fbg = pool(8, () => mk("circle", { class: "sc-p p-fbg", r: 2.8 }, L.parts));
  fat = pool(10, () => mk("circle", { class: "sc-p p-fat", r: 4.2 }, L.parts));
  glu = pool(12, () => mk("circle", { class: "sc-p p-glu", r: 2 }, L.parts));
  leak = pool(10, () => mk("path", { class: "p-leak", d: DROP }, L.parts));
  ah = pool(10, () => mk("circle", { class: "sc-p p-ah", r: 3 }, L.parts));
  let flip = false;
  atx = pool(10, () => { flip = !flip; return mk("circle", { class: flip ? "sc-p p-at" : "sc-p p-ins", r: 3 }, L.parts); });
  /* labels, caption, gauges */
  const ox = L.over;
  pill(ox, "Asparaginase", 90, 116, 90, 190, "Asparaginase is an enzyme drug that circulates in blood and chops up asparagine before blasts can use it.");
  pill(ox, "Asparagine", 240, 200, 368, 156, "Asparagine dissolved in plasma. Blasts drink it in to build proteins.");
  pill(ox, "ALL blast", 320, 340, 395, 290, "ALL blast. It lacks asparagine synthetase, so it cannot make its own asparagine and starves when blood levels fall. Healthy cells make their own and survive.");
  pill(ox, "No synthetase", 205, 263, 115, 408, "The blast has no working asparagine synthetase, the enzyme that builds asparagine from aspartate. This missing step is why the drug works.");
  pill(ox, "Allergy", 530, 150, 520, 92, "Asparaginase is a foreign protein, so mast cells burst and release histamine, causing hives, wheeze and shock.");
  pill(ox, "Pancreas", 520, 300, 520, 228, "The inflamed pancreas swells and leaks enzymes, causing pain, and its islets make less insulin, so blood sugar rises.");
  pill(ox, "Liver", 795, 160, 800, 92, "The liver makes less protein, so fats build up inside it and blood levels of antithrombin and fibrinogen fall.");
  pill(ox, "Clot and bleed", 800, 374, 790, 418, "With less antithrombin, thrombin stays active in plasma and turns fibrinogen to fibrin, so platelets clump and clotting starts on the vessel wall, while low fibrinogen also lets wounds ooze.");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 443 }, ox); capEl.textContent = capText(drug, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 470 }, P); t.textContent = "Benefit and harm together";
  [["kill", "Tumour kill", "g-good", "Without asparagine the blast cannot build proteins, so it stops dividing and dies. Kill rises with each course."], ["alg", "Allergy", "g-bad", "Asparaginase is a foreign protein, so mast cells burst and release histamine. Allergy cover calms this."], ["pan", "Pancreas", "g-eos", "Pancreas inflammation builds with each course and only stopping the drug settles it."], ["clot", "Clot/bleed", "g-clot", "Antithrombin is the natural brake on thrombin. When the liver makes less, coagulation runs free and fibrin clots form, while low fibrinogen lets wounds ooze. Clotting support tops antithrombin up."], ["liv", "Liver", "g-neu", "The liver makes less protein, so fat builds up inside it and antithrombin and fibrinogen output falls."], ["sug", "Sugar high", "g-cyt", "Inflamed islets make less insulin, so sugar rises. Insulin treatment brings it down."], ["tri", "Fat in blood", "g-fl", "With liver protein output low, triglycerides pile up in plasma until it turns milky."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 90 + i * 130, 478, 70, 18, cls, name, tip); });
}
function step(dt, m) {
  const k2 = Math.min(1, dt * 1.2);
  sm.K = lerp(sm.K, m.K, k2); sm.H = lerp(sm.H, m.H, k2); sm.P = lerp(sm.P, m.P, k2); sm.C = lerp(sm.C, m.C, k2); sm.Lv = lerp(sm.Lv, m.L, k2); sm.G = lerp(sm.G, m.G, k2); sm.F = lerp(sm.F, m.F, k2); sm.on = lerp(sm.on, m.on, k2); sm.pro = lerp(sm.pro, m.pro, k2);
  /* asparagine feeds the blast until the drug chops it into fragments */
  acc.asn += dt * (1 - sm.K) * 6;
  while (acc.asn >= 1) { acc.asn--; const p = free(asn); if (p) emit(p, 0, 0, 0, 0, 0); }
  asn.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; if (p.u >= 1) { kill(p); return; } const q = trAsn.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.enz += dt * sm.on * 4;
  while (acc.enz >= 1) { acc.enz--; const p = free(enz); if (p) emit(p, 0, 0, 0, 0, 0); }
  enz.forEach((p) => { if (!p.on) return; p.u += dt * 0.22; if (p.u >= 1) { kill(p); return; } const q = trDrug.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(p.u * 160) + ")"); });
  acc.frag += dt * sm.on * 5;
  while (acc.frag >= 1) { acc.frag--; const p = free(frag); if (p) emit(p, rnd(40, 400), rnd(100, 132), rnd(4, 14), rnd(8, 20), 0); }
  frag.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 120) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); });
  /* protein chain runs dry, the blast blebs, the daughter cell stalls */
  acc.prot += dt * (1 - sm.K) * 4;
  while (acc.prot >= 1) { acc.prot--; const p = free(prot); if (p) emit(p, 0, 0, 0, 0, 0); }
  prot.forEach((p) => { if (!p.on) return; p.u += dt * 0.7; if (p.u >= 1) { kill(p); return; } const q = trProt.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  blockE.setAttribute("opacity", sm.K.toFixed(2));
  acc.bleb += dt * sm.K * 5;
  while (acc.bleb >= 1) { acc.bleb--; const p = free(bleb); if (p) { const a = rnd(0, 6.28); emit(p, BC[0] + Math.cos(a) * BR, BC[1] + Math.sin(a) * BR, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  bleb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  place(blastG, BC[0], BC[1], 0, 1 - 0.08 * sm.K);
  const dg = 1 - sm.K;
  place(dauG, 408, 372, 0, Math.max(dg, 0.001)); dauG.style.opacity = dg > 0.05 ? 1 : 0;
  /* mast cells burst histamine, hives bloom */
  place(mastA, 530, 150, Math.sin(tm / 900) * 6, 1 + 0.08 * sm.H * Math.sin(tm / 300));
  place(mastB, 592, 132, Math.sin(tm / 900 + 1) * 6, 1 + 0.08 * sm.H * Math.sin(tm / 300 + 1));
  acc.hist += dt * sm.H * 8;
  while (acc.hist >= 1) { acc.hist--; const p = free(hist); if (p) { const b = Math.random() < 0.6; emit(p, (b ? 530 : 592) + rnd(-14, 14), (b ? 150 : 132) + rnd(-12, 12), 0, 0, 0); } }
  hist.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 2).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t).toFixed(2)); if (p.t > 1) kill(p); });
  const hv = sm.H * (0.7 + 0.3 * Math.sin(tm / 350));
  hiveE.forEach((e) => e.setAttribute("opacity", hv.toFixed(2)));
  /* pancreas inflames and crackles, insulin output runs dry */
  glowE.setAttribute("opacity", (sm.P * 0.55).toFixed(2));
  acc.spk += dt * sm.P * 6;
  while (acc.spk >= 1) { acc.spk--; const p = free(spk); if (p) emit(p, 565 + rnd(-60, 60), 305 + rnd(-30, 30), 0, 0, 0); }
  spk.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.6).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); });
  acc.ins += dt * (1 - sm.P) * 3;
  while (acc.ins >= 1) { acc.ins--; const p = free(ins); if (p) emit(p, 0, 0, 0, 0, 0); }
  ins.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; if (p.u >= 1) { kill(p); return; } const q = trIns.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* liver fattens, antithrombin and fibrinogen output falls */
  fatovE.setAttribute("opacity", (sm.Lv * 0.5).toFixed(2));
  fatDots.forEach((e) => e.setAttribute("opacity", sm.Lv.toFixed(2)));
  acc.atg += dt * (1 - sm.C) * 2.2;
  while (acc.atg >= 1) { acc.atg--; const p = free(atg); if (p) emit(p, 0, 0, 0, 0, 0); }
  atg.forEach((p) => { if (!p.on) return; p.u += dt * 0.4; if (p.u >= 1) { kill(p); return; } const q = trLiv.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.fbg += dt * (1 - sm.C) * 2.2;
  while (acc.fbg >= 1) { acc.fbg--; const p = free(fbg); if (p) emit(p, 0, 0, 0, 0, 0); }
  fbg.forEach((p) => { if (!p.on) return; p.u += dt * 0.4; if (p.u >= 1) { kill(p); return; } const q = trLiv.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* vessel: red cells slow, fat and sugar pile up, the wall oozes */
  const flow = 0.35 + 0.65 * (1 - 0.6 * sm.C);
  rbcs.forEach((r) => { r.x += r.v * 70 * flow * dt; if (r.x > 928) { r.x = 668; r.y = rnd(344, 384); } place(r.g, r.x, r.y, 0, 1); });
  acc.fat += dt * sm.F * 4;
  while (acc.fat >= 1) { acc.fat--; const p = free(fat); if (p) emit(p, rnd(668, 760), rnd(344, 384), rnd(14, 24), 0, 0); }
  fat.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 928) kill(p); });
  acc.glu += dt * sm.G * 7;
  while (acc.glu >= 1) { acc.glu--; const p = free(glu); if (p) emit(p, rnd(668, 860), rnd(344, 384), rnd(10, 20), 0, 0); }
  glu.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 930) kill(p); });
  acc.leak += dt * sm.C * 4;
  while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, 675 + rnd(-6, 6), 392, 0, rnd(40, 60), 0); }
  leak.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 426) kill(p); });
  crackE.setAttribute("opacity", sm.C.toFixed(2));
  const cs = clamp((sm.C - 0.05) * 1.6);
  place(clotG, 800, 374, 0, 0.15 + 0.85 * cs); clotG.style.opacity = cs > 0.05 ? 1 : 0;
  /* support: allergy cover to the mast cells, antithrombin and insulin to the blood */
  acc.ah += dt * sm.pro * 3;
  while (acc.ah >= 1) { acc.ah--; const p = free(ah); if (p) emit(p, 0, 0, 0, 0, 0); }
  ah.forEach((p) => { if (!p.on) return; p.u += dt * 0.2; if (p.u >= 1) { kill(p); return; } const q = trSup1.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.atx += dt * sm.pro * 4;
  while (acc.atx >= 1) { acc.atx--; const p = free(atx); if (p) emit(p, 0, 0, 0, 0, 0); }
  atx.forEach((p) => { if (!p.on) return; p.u += dt * 0.25; if (p.u >= 1) { kill(p); return; } const q = trSup2.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* caption and gauges */
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "medium", "high"]));
  gg.alg.set(sm.H, wordOf(sm.H, 0.2, 0.45, ["calm", "uneasy", "reacting"]));
  gg.pan.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["ok", "sore", "inflamed"]));
  gg.clot.set(sm.C, wordOf(sm.C, 0.3, 0.65, ["steady", "clot prone", "clots, bleeds"]));
  gg.liv.set(sm.Lv, wordOf(sm.Lv, 0.2, 0.4, ["ok", "fatty", "failing"]));
  gg.sug.set(sm.G, wordOf(sm.G, 0.2, 0.5, ["ok", "high", "very high"]));
  gg.tri.set(sm.F, wordOf(sm.F, 0.2, 0.5, ["ok", "cloudy", "milky"]));
}
run({ init, step });
