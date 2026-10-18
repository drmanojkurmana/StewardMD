/* Haemophilia and von Willebrand disease scene: platelet plug, vWF strands, intrinsic cascade, fibrin, joint bleed and gauges. */
const layers = { vwf: $("vwf"), plug: $("plug"), fib: $("fib"), rbcs: $("rbcs"), casc: $("casc"), jointG: $("jointG"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cascDots = pool(22, () => mk("circle", { class: "sc-p p-casc", r: 3 }, layers.parts));
const leaks = pool(18, () => mk("path", { class: "p-leak", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const desmoP = pool(12, () => mk("circle", { class: "sc-p p-desmo", r: 2.6 }, layers.parts));
/* ---- vessel: red cells, platelet plug, vWF strands, fibrin mesh ---- */
const rbcs = [], plts = [];
let vwfG, fibG, avoBadge;
function initVessel() {
  vwfG = mk("g", {}, layers.vwf);
  for (let i = 0; i < 7; i++) { const x = 440 + i * 13; mk("path", { class: "hm-vwf", d: "M" + x + " 156q3 -8 0 -16" }, vwfG); }
  const pg = layers.plug;
  const rows = [[140, 6], [152, 7], [164, 6]];
  let idx = 0;
  rows.forEach(([y, n], r) => { for (let i = 0; i < n; i++) { const g = mk("g", {}, pg); cell(g, { cls: "plt", r: 6.5, seed: idx + 1, wob: 0.16, n: 7 }); plts.push({ g, x: 480 + (i - (n - 1) / 2) * 15 + (r % 2) * 4, y, k: idx / 19, ph: idx }); idx++; } });
  fibG = mk("g", {}, layers.fib);
  for (let i = 0; i < 12; i++) mk("path", { class: "hm-fib", d: "M" + f1(rnd(432, 528)) + " " + f1(rnd(128, 166)) + "L" + f1(rnd(432, 528)) + " " + f1(rnd(128, 166)) }, fibG);
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, SC.W), y: rnd(172, 228), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
  avoBadge = mk("g", { class: "hot", tabindex: "0", "data-info": "NSAIDs block platelet cyclo-oxygenase and weaken platelet function. Avoiding them protects the plug, but it does not replace the missing factor, so aPTT stays prolonged." }, layers.parts);
  mk("rect", { x: -11, y: -5, width: 22, height: 10, rx: 5, class: "p-pill" }, avoBadge);
  mk("circle", { cx: 0, cy: 0, r: 13, class: "hm-xp" }, avoBadge); mk("path", { d: "M-9 -9L9 9", class: "hm-xp" }, avoBadge);
  avoBadge.setAttribute("transform", "translate(700 122)"); avoBadge.setAttribute("opacity", "0");
}
/* ---- intrinsic cascade nodes ---- */
const NODEPTS = [[90, 330], [190, 330], [290, 330], [450, 330], [570, 330], [690, 330]];
const cascTrack = track(NODEPTS);
let ixRect, viiiRect, blockMark, jointBlood;
function nodeAt(x, y, sym, cap, tip, bad) {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, layers.casc);
  const r = mk("ellipse", { class: bad ? "hm-nodebad" : "hm-node", cx: x, cy: y, rx: 36, ry: 21 }, g);
  const t = mk("text", { class: "dr-pt2", x, y: y + 4, "text-anchor": "middle" }, g); t.textContent = sym;
  if (cap) { const c = mk("text", { class: "sc-lab", x, y: y + 38, "text-anchor": "middle" }, g); c.textContent = cap; }
  return r;
}
function initCascade() {
  for (let i = 0; i < NODEPTS.length - 1; i++) mk("path", { class: "hm-arr", d: "M" + (NODEPTS[i][0] + 38) + " 330L" + (NODEPTS[i + 1][0] - 40) + " 330" }, layers.casc);
  mk("path", { class: "hm-dash", d: "M370 308V326" }, layers.casc);
  nodeAt(90, 330, "XII", "contact", "Factor XII: contact activation starts the intrinsic arm. The aPTT test follows this arm.");
  nodeAt(190, 330, "XI", "next step", "Factor XI, switched on by factor XIIa and later by thrombin.");
  ixRect = nodeAt(290, 330, "IX", "factor IX", "Factor IX: missing or poor factor IX is haemophilia B (Christmas disease). With factor VIII it switches on factor X.");
  nodeAt(450, 330, "X", "common", "Factor X: where intrinsic and extrinsic arms meet. With factor V it makes thrombin.");
  nodeAt(570, 330, "Thrombin", "enzyme", "Thrombin turns fibrinogen into fibrin and stabilises the platelet plug.");
  nodeAt(690, 330, "Fibrin", "mesh", "Fibrin strands weave through the plug. Without them the plug is soft and bleeding restarts, deep in joints and muscles.");
  viiiRect = nodeAt(370, 286, "VIII", "", "Factor VIII: the cofactor for factor IX. Missing or poor factor VIII is haemophilia A, the commoner haemophilia.");
  blockMark = mk("g", { opacity: "0" }, layers.casc);
  mk("path", { class: "hm-xp", d: "M282 322l16 16M298 322l-16 16" }, blockMark);
  mk("path", { class: "hm-xp", d: "M362 278l16 16M378 278l-16 16" }, blockMark);
}
/* ---- joint ---- */
function initJoint() {
  const J = layers.jointG, g = mk("g", { class: "hot", tabindex: "0", "data-info": "Joint bleed (haemarthrosis): in haemophilia blood collects inside a joint such as the knee. The joint swells and hurts, and repeated bleeds damage it. This deep bleeding contrasts with the surface and mucosal bleeding of von Willebrand disease." }, J);
  mk("rect", { class: "hm-caps", x: 772, y: 270, width: 162, height: 118, rx: 16 }, g);
  const t = mk("text", { class: "sc-lab", x: 786, y: 290 }, g); t.textContent = "JOINT";
  const clip = mk("clipPath", { id: "hmJClip" }, g); mk("rect", { x: 784, y: 282, width: 138, height: 94, rx: 10 }, clip);
  jointBlood = mk("rect", { class: "hm-jblood", x: 784, y: 376, width: 138, height: 0, "clip-path": "url(#hmJClip)" }, g);
  mk("ellipse", { class: "hm-bone", cx: 853, cy: 306, rx: 50, ry: 17 }, g);
  mk("ellipse", { class: "hm-bone", cx: 853, cy: 356, rx: 50, ry: 17 }, g);
}
/* ---- gauges and label pills ---- */
const gg = {};
let txFac, txDes, txAvo;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vwf", "vWF stick", "g-vwf", "How well platelets stick to collagen through von Willebrand factor. Low in von Willebrand disease, so bleeding time is prolonged."], ["fac", "Factor VIII/IX", "g-fac", "Intrinsic cascade factor activity. Low in haemophilia, so fibrin is weak and aPTT is prolonged."], ["fib", "Fibrin", "g-clot", "Fibrin mesh made by thrombin to stabilise the platelet plug."], ["stab", "Stable plug", "g-stab", "Overall plug strength: platelet sticking plus fibrin stabilisation."], ["aptt", "aPTT", "g-bad", "aPTT prolongation: aPTT tests the intrinsic arm (XII, XI, IX, VIII), so it is prolonged in haemophilia. In von Willebrand disease it can also lengthen when factor VIII is low. High here means a longer aPTT."], ["bt", "Bleed time", "g-bad", "Bleeding time prolongation: bleeding time tests platelet sticking, so it is prolonged when von Willebrand factor is low and near normal in pure haemophilia. High here means a longer bleeding time."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Fibrin mesh", 448, 130, 200, 102, "Fibrin strands from thrombin weave through the plug and hold it firm. Little fibrin means a soft plug that leaks again.");
  pill(ox, "Platelets", 472, 146, 350, 102, "Platelets: first responders. They stick, switch on and clump into the primary plug. Their sticking step needs von Willebrand factor.");
  pill(ox, "vWF strands", 500, 150, 610, 102, "Von Willebrand factor strands link exposed collagen to platelet GPIb so platelets can stick under flow. Low or faulty vWF is von Willebrand disease.");
  pill(ox, "Vessel wall", 850, 150, 850, 102, "The torn vessel wall. Exposed collagen underneath is where platelets must stick.");
  pill(ox, "Joint bleed", 853, 332, 847, 215, "Blood collecting in the joint space (haemarthrosis), the deep bleed typical of haemophilia.");
  txAvo = pill(ox, "NSAIDs avoided", 700, 122, 560, 238, "Avoiding NSAIDs protects platelet function. It helps the platelet side only and does not fix the cascade.");
  txFac = pill(ox, "Factor given", 370, 286, 470, 238, "Factor replacement supplies the missing factor VIII or IX, so the cascade reaches thrombin and fibrin again.");
  txDes = pill(ox, "vWF released", 620, 150, 700, 238, "Desmopressin makes vessel lining cells release stored von Willebrand factor and factor VIII. It helps most in mild disease.");
  txFac.style.opacity = "0"; txDes.style.opacity = "0"; txAvo.style.opacity = "0";
}
const sm = { V: 0.4, F: 0.4, P: 0.4, Fb: 0.4, Stab: 0.4, Bleed: 0.4, Ap: 0.5, Bt: 0.5, fac: 0, des: 0, avo: 0 };
const acc = { casc: 0, leak: 0, desmo: 0 };
function init() { initVessel(); initCascade(); initJoint(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["V", "F", "P", "Fb", "Stab", "Bleed", "Ap", "Bt", "fac", "des", "avo"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  /* plug, strands and mesh follow adhesion and fibrin */
  plts.forEach((p) => { const s = clamp((sm.P * 1.3 - p.k) * 3); place(p.g, p.x + Math.sin(tm / 700 + p.ph) * 1.2, p.y, Math.sin(tm / 500 + p.ph) * 8, 0.25 + 0.75 * s); p.g.style.opacity = s > 0.05 ? 1 : 0; });
  if (vwfG) vwfG.setAttribute("opacity", sm.V.toFixed(2));
  if (fibG) fibG.setAttribute("opacity", sm.Fb.toFixed(2));
  /* red cells flow past the plug */
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > SC.W + 12) { r.x = -12; r.y = rnd(172, 228); } place(r.g, r.x, r.y, r.rot, 1); });
  /* cascade dots stall at the IX with VIII step when factor is low */
  acc.casc += dt * 5; while (acc.casc >= 1) { acc.casc--; const p = free(cascDots); if (p) emit(p, 90, 330, 0, 0, 0); }
  cascDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.14; if (!p.k && p.u > 0.45) { p.k = Math.random() < sm.F ? 1 : 2; if (p.k === 2) { kill(p); return; } } const pt = cascTrack.at(clamp(p.u)); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")"); if (p.u >= 1) kill(p); });
  if (ixRect) ixRect.setAttribute("class", sm.F < 0.5 ? "hm-nodebad" : "hm-node");
  if (viiiRect) viiiRect.setAttribute("class", sm.F < 0.5 ? "hm-nodebad" : "hm-node");
  if (blockMark) blockMark.setAttribute("opacity", clamp(1.15 - sm.F * 1.5).toFixed(2));
  /* leak from the weak plug */
  acc.leak += dt * sm.Bleed * 7; while (acc.leak >= 1) { acc.leak--; const p = free(leaks); if (p) emit(p, rnd(442, 520), 132, rnd(-5, 5), -rnd(16, 28), 0); }
  leaks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.y < 74 || p.t > 2.4) kill(p); });
  /* desmopressin release dots from the wall */
  acc.desmo += dt * sm.des * 6; while (acc.desmo >= 1) { acc.desmo--; const p = free(desmoP); if (p) emit(p, rnd(560, 900), 152, rnd(-8, -2), -rnd(10, 18), 0); }
  desmoP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) kill(p); });
  /* joint fills, avoid badge and treatment pills */
  if (jointBlood) { const bh = sm.Bleed * 54; jointBlood.setAttribute("y", f1(376 - bh)); jointBlood.setAttribute("height", f1(bh)); }
  if (avoBadge) avoBadge.setAttribute("opacity", sm.avo.toFixed(2));
  if (txFac) txFac.style.opacity = sm.fac.toFixed(2);
  if (txDes) txDes.style.opacity = sm.des.toFixed(2);
  if (txAvo) txAvo.style.opacity = sm.avo.toFixed(2);
  /* lab badges */
  const ba = $("badA"), bb = $("badB");
  if (ba) ba.textContent = "aPTT: " + m.words[1];
  if (bb) bb.textContent = "Bleeding time: " + m.words[2];
  /* gauges */
  gg.vwf.set(sm.V, wordOf(sm.V, 0.3, 0.6, ["low", "reduced", "ok"])); gg.fac.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["low", "reduced", "ok"])); gg.fib.set(sm.Fb, wordOf(sm.Fb, 0.35, 0.65, ["low", "reduced", "ok"]));
  gg.stab.set(sm.Stab, wordOf(sm.Stab, 0.3, 0.6, ["weak", "loose", "firm"])); gg.aptt.set(sm.Ap, wordOf(sm.Ap, 0.3, 0.6, ["normal", "raised", "long"])); gg.bt.set(sm.Bt, wordOf(sm.Bt, 0.3, 0.6, ["normal", "raised", "long"]));
}
run({ init, step });
