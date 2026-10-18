/* Haemophilia and von Willebrand disease: torn vessel plug, short cascade, knee joint.
 * Left to right story. A real vessel carries the plug, a real joint collects leaked
 * blood, and the cascade between them is five filled nodes. Each treatment acts on
 * the drawing: factor concentrate falls onto the factor step and is absorbed, vessel
 * lining releases vWF dots, NSAID tablets are turned away from the plug. */
const layers = { halo: $("haloG"), vwf: $("vwf"), plug: $("plug"), fib: $("fib"), casc: $("casc"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cascDots = pool(28, () => mk("circle", { class: "sc-p p-casc", r: 3 }, layers.parts));
const leaks = pool(18, () => mk("path", { class: "p-leak", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const facP = pool(10, () => mk("circle", { class: "sc-p p-fac", r: 3.4 }, layers.parts));
const desmoP = pool(10, () => mk("circle", { class: "sc-p p-desmo", r: 2.6 }, layers.parts));
const tabP = pool(8, () => mk("rect", { class: "sc-p p-nsaid", x: -4, y: -2.6, width: 8, height: 5.2, rx: 2.6 }, layers.parts));
const flashP = pool(3, () => mk("circle", { class: "hm-flash", r: 6 }, layers.parts));
const crossP = pool(4, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "hm-xp", d: "M-7 -7L7 7M7 -7L-7 7" }, g); return g; });
function fire(x, y) { const p = free(flashP); if (p) emit(p, x, y, 0, 0, 0); }
function markX(x, y) { const p = free(crossP); if (p) emit(p, x, y, 0, 0, 0); }
/* ---- organs and wound furniture, anchored on real ports ---- */
let vesselO = null, jointO = null;
let wallPt = [176, 250], plugPt = [168, 258], lumX0 = 118, lumX1 = 162, lumY0 = 150, lumY1 = 350;
let jointPt = [847, 304];
let haloEl = null, jointBlood = null, jointRing = null;
const rbcs = [], plts = [], threads = [], fibs = [];
const NX = [300, 400, 500, 600, 700], NY = 335;
let cascTrack = null, ixRect = null, xRect = null, fibRect = null, viiiSat = null, blockMark = null;
function det(i, s) { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); }
function initOrgans() {
  vesselO = organ($("vesselSlot"), "vessel", 140, 250, 90, {});
  jointO = organ($("jointSlot"), "joint", 840, 290, 170, {});
  const VP = vesselO.ports, JP = jointO.ports;
  wallPt = VP.wall || [176, 250];
  plugPt = [wallPt[0] - 8, wallPt[1] + 8];
  lumX0 = vesselO.x - 22; lumX1 = vesselO.x + 22;
  lumY0 = vesselO.y - vesselO.h / 2 + 15; lumY1 = vesselO.y + vesselO.h / 2 - 15;
  jointPt = JP.joint || [847, 304];
  /* wound: dark tear, collagen fringe, bleed halo */
  const H = layers.halo;
  haloEl = mk("ellipse", { class: "hm-halo", cx: f1(wallPt[0] + 6), cy: f1(wallPt[1]), rx: 30, ry: 44, opacity: "0.4" }, H);
  mk("ellipse", { class: "hm-wound", cx: f1(wallPt[0] - 2), cy: f1(wallPt[1] - 14), rx: 7, ry: 10 }, H);
  mk("path", { class: "hm-coll", d: "M" + f1(wallPt[0] - 12) + " " + f1(wallPt[1] - 20) + "q7 -6 14 0t14 0" }, H);
  /* vWF threads from the collagen to the plug */
  for (let i = 0; i < 7; i++) {
    const x = wallPt[0] - 8 + i * 3.4;
    const e = mk("path", { class: "hm-vwf", d: "M" + f1(x) + " " + f1(wallPt[1] + 6) + "q3 -8 0 -16" }, layers.vwf);
    threads.push(e);
  }
  /* platelet plug: deterministic cluster inside the lumen at the tear */
  const offs = [[-16, -12], [-4, -14], [8, -12], [-22, 0], [-10, -2], [2, 0], [12, -2], [-16, 12], [-4, 12], [8, 12], [-10, 24], [4, 24]];
  offs.forEach(([dx, dy], i) => {
    const g = mk("g", {}, layers.plug);
    cell(g, { cls: "plt", r: 6.5, seed: i + 1, wob: 0.16, n: 7 });
    plts.push({ g, x: plugPt[0] + dx, y: plugPt[1] + dy, k: i / (offs.length - 1), ph: i });
  });
  /* fibrin mesh across the plug */
  for (let i = 0; i < 12; i++) {
    const x1 = plugPt[0] - 26 + det(i, 1) * 52, y1 = plugPt[1] - 28 + det(i, 2) * 56;
    const x2 = plugPt[0] - 26 + det(i, 3) * 52, y2 = plugPt[1] - 28 + det(i, 4) * 56;
    const e = mk("path", { class: "hm-fib", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, layers.fib);
    fibs.push(e);
  }
  /* red cells drift down the real lumen, in vessel-local coords */
  for (let i = 0; i < 8; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, vesselO.g);
    mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g);
    mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g);
    rbcs.push({ g, x: lumX0 + 8 + det(i, 5) * (lumX1 - lumX0 - 16), y: lumY0 + det(i, 6) * (lumY1 - lumY0), v: 0.8 + det(i, 7) * 0.5 });
  }
  /* pooled blood and a swelling ring on the real joint */
  jointBlood = mk("ellipse", { class: "hm-jblood", cx: f1(jointPt[0]), cy: f1(jointPt[1] + 8), rx: 38, ry: 12, opacity: "0.5" }, layers.parts);
  jointRing = mk("ellipse", { class: "hm-jring", cx: f1(jointPt[0]), cy: f1(jointPt[1]), rx: 48, ry: 42, opacity: "0.5" }, layers.parts);
  cascTrack = track(NX.map((x) => [x, NY]));
}
function nodeAt(x, y, sym, cap, tip, rx) {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, layers.casc);
  const r = mk("ellipse", { class: "hm-node", cx: x, cy: y, rx: rx || 34, ry: 21 }, g);
  const t = mk("text", { class: "dr-pt2", x, y: y + 4, "text-anchor": "middle" }, g); t.textContent = sym;
  if (cap) { const c = mk("text", { class: "sc-lab", x, y: y + 38, "text-anchor": "middle" }, g); c.textContent = cap; }
  return r;
}
function initCascade() {
  for (let i = 0; i < NX.length - 1; i++) mk("path", { class: "hm-arr", d: "M" + (NX[i] + 36) + " " + NY + "L" + (NX[i + 1] - 38) + " " + NY }, layers.casc);
  nodeAt(NX[0], NY, "XII/XI", "start", "Factors XII and XI start the intrinsic arm. The aPTT test follows this arm, so it lengthens when the arm is broken.");
  ixRect = nodeAt(NX[1], NY, "IX", "needs VIII", "Factor IX, helped by factor VIII, switches on factor X. Missing IX is haemophilia B, missing VIII is haemophilia A.");
  xRect = nodeAt(NX[2], NY, "X", "common", "Factor X is where the arms meet. With factor V it makes thrombin. PT tests the other arm, so PT stays normal here.");
  nodeAt(NX[3], NY, "Thrombin", "enzyme", "Thrombin turns fibrinogen into fibrin threads that weave through the plug.");
  fibRect = nodeAt(NX[4], NY, "Fibrin", "mesh", "Fibrin mesh holds the plug firm. Without it the plug is soft and bleeding restarts, deep in joints and muscles.");
  /* factor VIII satellite above IX */
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": "Factor VIII is the helper for factor IX. Without it the cascade stalls at the IX step." }, layers.casc);
  viiiSat = mk("ellipse", { class: "hm-node", cx: NX[1], cy: NY - 39, rx: 17, ry: 13 }, g);
  const t = mk("text", { class: "dr-pt2", x: NX[1], y: NY - 35, "text-anchor": "middle" }, g); t.textContent = "VIII";
  mk("path", { class: "hm-dash", d: "M" + NX[1] + " " + (NY - 26) + "V" + (NY - 21) }, layers.casc);
  blockMark = mk("g", { opacity: "0" }, layers.casc);
  mk("path", { class: "hm-xp", d: "M442 " + (NY - 8) + "l16 16M458 " + (NY - 8) + "l-16 16" }, blockMark);
}
/* ---- gauges, pills, caption ---- */
const gg = {};
let capEl = null, capDrug = -1, capLevel = -1, txPill = null;
function capText(d, l) {
  if (d === 1) return "Factor replacement restores fibrin. The plug firms up and bleeding slows.";
  if (d === 2) return l === 2 ? "Desmopressin releases stored vWF and factor VIII, but little is stored so help is small." : "Desmopressin releases stored vWF and factor VIII. Sticking and fibrin recover.";
  if (d === 3) return "Avoiding NSAIDs protects platelets. The plug holds a little better.";
  if (l === 0) return "No treatment. The plug is a little soft and oozes.";
  if (l === 1) return "No treatment. The plug is soft, so blood leaks and the joint swells.";
  return "No treatment. The plug fails, blood leaks out and the joint fills.";
}
function movePill(g, text, tip, x, y, tx, ty) {
  const ch = g.children, lw = text.length * 6.2 + 14;
  ch[0].setAttribute("d", "M" + f1(x) + " " + f1(y) + "L" + f1(tx) + " " + f1(ty + 8));
  ch[1].setAttribute("cx", f1(x)); ch[1].setAttribute("cy", f1(y));
  ch[2].setAttribute("x", f1(tx - lw / 2)); ch[2].setAttribute("y", f1(ty - 8));
  ch[2].setAttribute("width", f1(lw)); ch[2].setAttribute("height", 17);
  ch[3].setAttribute("x", f1(tx)); ch[3].setAttribute("y", f1(ty + 4));
  if (ch[3].textContent !== text) ch[3].textContent = text;
  g.setAttribute("data-info", tip);
}
const TXINFO = {
  1: ["Factor given", "Factor replacement supplies the missing factor VIII or IX, so the cascade reaches thrombin and fibrin again.", 540, 110],
  2: ["vWF released", "Desmopressin makes vessel lining cells release stored von Willebrand factor and factor VIII. It helps most in mild disease.", 330, 90],
  3: ["NSAIDs avoided", "Avoiding NSAIDs protects platelet function. It helps the platelet side only and does not fix the cascade.", 330, 120],
};
function txAnchor(d) {
  if (d === 1) return [450, NY - 5];
  if (d === 2) return [wallPt[0] - 8, wallPt[1] - 50];
  return [wallPt[0] + 14, plugPt[1] + 4];
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["vwf", "vWF stick", "g-vwf", "How well platelets stick to collagen through von Willebrand factor. Low in von Willebrand disease, so bleeding time is prolonged."], ["fac", "Factor VIII/IX", "g-fac", "Intrinsic cascade factor activity. Low in haemophilia, so fibrin is weak and aPTT is prolonged."], ["fib", "Fibrin", "g-clot", "Fibrin mesh made by thrombin to stabilise the platelet plug."], ["stab", "Stable plug", "g-stab", "Overall plug strength: platelet sticking plus fibrin stabilisation."], ["aptt", "aPTT", "g-bad", "aPTT prolongation: aPTT tests the intrinsic arm, so it lengthens in haemophilia. PT tests the other arm and stays normal. High here means a longer aPTT."], ["bt", "Bleed time", "g-bad", "Bleeding time prolongation: it tests platelet sticking, so it lengthens when von Willebrand factor is low and stays near normal in pure haemophilia. High here means a longer bleeding time."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Plug", plugPt[0], plugPt[1] + 4, 52, 180, "Plug: platelets clump here and fibrin mesh firms them up. A soft plug leaks again.");
  pill(ox, "vWF", wallPt[0] - 2, wallPt[1], 52, 215, "Von Willebrand factor strands link exposed collagen to platelets so they can stick under flow. Low or faulty vWF is von Willebrand disease.");
  pill(ox, "Torn wall", wallPt[0], wallPt[1] - 12, 56, 250, "The torn vessel wall. Exposed collagen underneath is where platelets must stick.");
  pill(ox, "Fibrin", plugPt[0] + 12, plugPt[1] + 6, 255, 300, "Fibrin threads from thrombin weave through the plug and hold it firm. Little fibrin means a soft plug that leaks again.");
  pill(ox, "Factor IX", NX[1] + 28, NY + 17, 400, 404, "Factor IX with its helper VIII is the step that fails in haemophilia. Without it the cascade stalls before factor X.");
  pill(ox, "Joint blood", jointPt[0], jointPt[1], 840, 404, "Blood collecting in the joint space, the deep bleed typical of haemophilia.");
  txPill = pill(ox, "Factor given", 450, NY - 5, 540, 110, TXINFO[1][1]);
  txPill.style.opacity = "0";
  capEl = mk("text", { class: "dr-pt", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { V: 0.4, F: 0.4, P: 0.4, Fb: 0.4, Stab: 0.4, Bleed: 0.4, Ap: 0.5, Bt: 0.5, fac: 0, des: 0, avo: 0 };
const acc = { casc: 0, leak: 0, fac: 0, desmo: 0, tab: 0 };
let meshBoost = 0;
function init() { initOrgans(); initCascade(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  ["V", "F", "P", "Fb", "Stab", "Bleed", "Ap", "Bt", "fac", "des", "avo"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  meshBoost = Math.max(0, meshBoost - dt * 1.4);
  /* red cells fall through the real lumen (vessel-local coords) */
  rbcs.forEach((r) => {
    r.y += r.v * 55 * dt;
    if (r.y > lumY1) { r.y = lumY0; r.x = lumX0 + 8 + det((r.y | 0) + 3, (r.x | 0) + 7) * (lumX1 - lumX0 - 16); }
    r.g.setAttribute("transform", "translate(" + f1(r.x - vesselO.x) + " " + f1(r.y - vesselO.y) + ")");
  });
  /* plug firms with overall stability, strands and mesh follow adhesion and fibrin */
  plts.forEach((p) => {
    const s = clamp((sm.Stab * 1.35 - p.k) * 3);
    place(p.g, p.x + Math.sin(tm / 700 + p.ph) * 1.2, p.y, Math.sin(tm / 500 + p.ph) * 8, 0.25 + 0.75 * s);
    p.g.style.opacity = s > 0.05 ? 1 : 0;
  });
  threads.forEach((e, i) => e.setAttribute("opacity", (i / 7 < sm.V * 1.25 ? 0.35 + 0.65 * sm.V : 0.06).toFixed(2)));
  const fibOp = clamp(sm.Fb + 0.35 * meshBoost);
  fibs.forEach((e, i) => e.setAttribute("opacity", (i / 12 < sm.Fb * 1.15 + 0.08 ? 0.2 + 0.8 * fibOp : 0.05).toFixed(2)));
  if (haloEl) {
    haloEl.setAttribute("rx", f1(24 + 14 * sm.Bleed));
    haloEl.setAttribute("opacity", (0.12 + 0.5 * sm.Bleed).toFixed(2));
  }
  /* cascade dots stall at the IX to X step when factor is low */
  acc.casc += dt * 5; while (acc.casc >= 1) { acc.casc--; const p = free(cascDots); if (p) emit(p, NX[0], NY, 0, 0, 0); }
  cascDots.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 70 / cascTrack.len;
    if (!p.k && p.u > 0.3) { p.k = Math.random() < sm.F ? 1 : 2; if (p.k === 2) { kill(p); return; } }
    const pt = cascTrack.at(clamp(p.u));
    p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")");
    if (p.u >= 1) { kill(p); meshBoost = 1; fire(NX[4], NY); }
  });
  const badF = sm.F < 0.5;
  if (ixRect) ixRect.setAttribute("class", badF ? "hm-nodebad" : "hm-node");
  if (xRect) xRect.setAttribute("class", badF ? "hm-nodebad" : "hm-node");
  if (viiiSat) viiiSat.setAttribute("class", badF ? "hm-nodebad" : "hm-node");
  if (fibRect) fibRect.setAttribute("class", sm.Fb < 0.45 ? "hm-nodebad" : "hm-node");
  if (blockMark) blockMark.setAttribute("opacity", clamp(1.15 - sm.F * 1.5).toFixed(2));
  /* factor concentrate falls onto the factor step, docks, then is absorbed */
  acc.fac += dt * sm.fac * 8;
  while (acc.fac >= 1) { acc.fac--; const p = free(facP); if (p) { emit(p, 430 + rnd(-22, 22), 150, 0, 130, 0); } }
  facP.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) {
      p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y / 40) * 8 * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (p.y >= NY - 13) { p.k = 1; p.t = 0; }
    } else { p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(NY - 13) + ") scale(" + (1 + 0.25 * Math.sin(p.t * 14)).toFixed(3) + ")"); if (p.t > 0.55) { kill(p); fire(p.x, NY - 6); } }
  });
  /* desmopressin: lining releases vWF dots that drift to the strands */
  acc.desmo += dt * sm.des * 7;
  while (acc.desmo >= 1) { acc.desmo--; const p = free(desmoP); if (p) { emit(p, wallPt[0] - 34 + rnd(0, 30), wallPt[1] - 78 + rnd(0, 26), 0, 0, 0); p.tx = wallPt[0] - 8 + rnd(0, 24); p.ty = wallPt[1] + rnd(-4, 8); } }
  desmoP.forEach((p) => {
    if (!p.on) return;
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 9) { kill(p); return; }
    p.x += dx / d * 58 * dt; p.y += dy / d * 58 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  /* avoided NSAIDs: tablets drift at the plug, are turned away with a cross */
  acc.tab += dt * sm.avo * 3;
  while (acc.tab >= 1) { acc.tab--; const p = free(tabP); if (p) emit(p, 300, plugPt[1] - 25 + rnd(0, 55), -46, 0, 0); }
  tabP.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x <= wallPt[0] + 34) { markX(p.x, p.y); kill(p); }
  });
  flashP.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("r", f1(6 + 26 * p.t));
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.7).toFixed(2));
    if (p.t > 0.7) kill(p);
  });
  crossP.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2));
    if (p.t > 0.8) kill(p);
  });
  /* leak from the weak plug into the tissue */
  acc.leak += dt * sm.Bleed * 7;
  while (acc.leak >= 1) { acc.leak--; const p = free(leaks); if (p) emit(p, wallPt[0] + 6 + rnd(0, 8), wallPt[1] - 12 + rnd(0, 24), rnd(15, 45), rnd(-30, -5), 0); }
  leaks.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2));
    if (p.t > 2.2) kill(p);
  });
  /* joint fills and reddens */
  if (jointBlood) {
    jointBlood.setAttribute("ry", f1(5 + 25 * sm.Bleed));
    jointBlood.setAttribute("opacity", (0.2 + 0.65 * sm.Bleed).toFixed(2));
  }
  if (jointRing) {
    jointRing.setAttribute("stroke-width", f1(1 + 5 * sm.Bleed));
    jointRing.setAttribute("opacity", (0.15 + 0.7 * sm.Bleed).toFixed(2));
  }
  /* treatment pill follows the drug, caption follows drug and level */
  if (txPill) {
    if (drug === 0) txPill.style.opacity = "0";
    else {
      const info = TXINFO[drug], a = txAnchor(drug);
      movePill(txPill, info[0], info[1], a[0], a[1], info[2], info[3]);
      txPill.style.opacity = String(clamp(sm.fac + sm.des + sm.avo));
    }
  }
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  /* gauges */
  gg.vwf.set(sm.V, wordOf(sm.V, 0.3, 0.6, ["low", "reduced", "ok"])); gg.fac.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["low", "reduced", "ok"])); gg.fib.set(sm.Fb, wordOf(sm.Fb, 0.35, 0.65, ["low", "reduced", "ok"]));
  gg.stab.set(sm.Stab, wordOf(sm.Stab, 0.3, 0.6, ["weak", "loose", "firm"])); gg.aptt.set(sm.Ap, wordOf(sm.Ap, 0.3, 0.6, ["normal", "raised", "long"])); gg.bt.set(sm.Bt, wordOf(sm.Bt, 0.3, 0.6, ["normal", "raised", "long"]));
}
run({ init, step });
