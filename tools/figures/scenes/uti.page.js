/* UTI scene: bacteria ascend urethra to bladder to kidney, fimbriae adherence, urine flushing, obstruction and catheter, gauges. */
const layers = { bac: $("bac"), flow: $("flow"), wbc: $("wbc"), parts: $("parts"), over: $("over"), panel: $("panel") };
const routeL = track([[480, 436], [480, 385], [478, 335], [430, 272], [350, 205], [278, 148]]);
const routeR = track([[480, 436], [480, 385], [482, 335], [530, 272], [610, 205], [682, 148]]);
/* ---- ascending bacteria with fimbriae ---- */
const BAC_N = 36, bac = [];
function initBac() { for (let i = 0; i < BAC_N; i++) { const g = mk("g", { class: "cl cl-bac" }, layers.bac);
  mk("ellipse", { class: "cl-b", rx: 6.5, ry: 3.4 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1.4, cy: -1.1 }, g);
  mk("path", { class: "ut-fimb", d: "M-6 -2 L-9 -5 M-6 2 L-9 5 M6 -2 L9 -5 M6 2 L9 5" }, g);
  bac.push({ g, u: Math.random(), route: i % 2 ? routeL : routeR, s: 0, rot: rnd(0, 180) }); } }
/* adherent bacteria stuck to the bladder wall */
const stuck = [[412, 300], [428, 352], [480, 378], [532, 352], [548, 300], [455, 282]].map(([x, y], i) => { const g = mk("g", { class: "cl cl-bac" }, layers.bac);
  mk("ellipse", { class: "cl-b", rx: 6.5, ry: 3.4 }, g); mk("path", { class: "ut-fimb", d: "M-6 0 L-10 0 M6 -2 L10 -4 M6 2 L10 4" }, g); place(g, x, y, i * 35, 0.1); return { g, x, y, rot: i * 35 }; });
/* ---- urine droplets flowing down and out ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const drops = pool(26, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.flow));
const pills = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const sysp = pool(14, () => mk("circle", { class: "sc-p p-lps", r: 2.6 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- white cells in the bladder ---- */
const wbcs = Array.from({ length: 5 }, (_, i) => ({ g: cell(layers.wbc, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 7, wob: 0.14 }), x: 430 + i * 22, y: 320 + (i % 3) * 18, ph: i * 1.7 }));
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 280, 450, 620, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Bacteria", "g-bac", "Bacteria climbing the urinary tract. An antibiotic brings this down."], ["blad", "Bladder", "g-bad", "Bladder wall inflammation (cystitis): soreness and needing to pass urine often."], ["kid", "Kidney", "g-kid", "Kidney involvement (pyelonephritis). In urosepsis infection affects the whole body."], ["flow", "Urine flow", "g-flow", "Urine flow and bladder emptying flush bacteria out. Fluids support this."], ["bp", "Pressure", "g-good", "Blood pressure. It falls in urosepsis; fluids support it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 700, 105, 815, 88, "Kidney. Bacteria reaching it cause pyelonephritis, with loin pain and fever.");
  pill(ox, "Ureter", 585, 205, 695, 185, "Ureter: the tube carrying urine from kidney to bladder. Bacteria can climb it against the flow.");
  pill(ox, "Obstruction", 612, 212, 800, 250, "Obstruction: a blockage such as a stone slows urine flow, so bacteria are not flushed out and can persist.");
  pill(ox, "Bladder wall", 385, 285, 260, 235, "Bladder wall. Inflammation here is cystitis.");
  pill(ox, "Fimbriae", 440, 335, 275, 350, "Fimbriae: hair-like threads that let bacteria stick to the bladder wall so urine cannot wash them away.");
  pill(ox, "Bacteria", 488, 415, 640, 405, "Bacteria enter at the urethra and climb toward the bladder and kidney.");
  pill(ox, "Urine flow", 480, 428, 350, 420, "Urine flow: steady flow and emptying flush bacteria out of the bladder and urethra.");
  pill(ox, "Catheter", 452, 400, 180, 410, "Catheter: a tube in the urethra. Bacteria can travel along it into the bladder, so it raises infection risk.");
}
const sm = { B: 0.3, I: 0.3, K: 0.1, Sys: 0.1, Flow: 0.7, BP: 0.9, abx: 0, obst: 0.55 };
const acc = { drop: 0, pill: 0, sys: 0 };
function init() { initBac(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.B = lerp(sm.B, m.B, k2); sm.I = lerp(sm.I, m.I, k2); sm.K = lerp(sm.K, m.K, k2); sm.Sys = lerp(sm.Sys, m.Sys, k2); sm.Flow = lerp(sm.Flow, m.Flow, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.abx = lerp(sm.abx, m.abx, k1); sm.obst = lerp(sm.obst, m.obst, k1);
  /* reach: cystitis stops in the bladder, higher levels reach the kidney */
  const maxU = m.a < 0.5 ? 0.52 : 1;
  const want = Math.round(sm.B * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.u += dt * 0.055 * (1 - 0.45 * sm.obst) * (on ? 1 : 0); if (b.u > maxU) b.u = 0.02;
    const pt = b.route.at(clamp(b.u, 0, 1)); place(b.g, clamp(pt.x, 30, 930), clamp(pt.y, 60, 436), b.rot + pt.a, b.s); b.g.style.opacity = b.s > 0.04 ? 1 : 0; });
  stuck.forEach((s) => place(s.g, s.x, s.y, s.rot, 0.15 + 0.85 * sm.I));
  /* bladder inflammation and kidney involvement */
  $("bladderWall").setAttribute("stroke-width", (2 + 3 * sm.I).toFixed(2));
  $("bladderIn").setAttribute("opacity", (0.55 + 0.45 * sm.I).toFixed(2));
  $("kidLglow").setAttribute("opacity", (sm.K * 0.4).toFixed(2)); $("kidRglow").setAttribute("opacity", (sm.K * 0.4).toFixed(2));
  const sg = $("stoneG"); const ss = clamp(sm.obst * 1.6); sg.setAttribute("transform", "translate(612 212) scale(" + ss.toFixed(3) + ") translate(-612 -212)"); sg.style.opacity = ss > 0.08 ? 1 : 0;
  wbcs.forEach((w, i) => { const s = sm.I > 0.12 ? 1 : 0.12; place(w.g, w.x + Math.sin(tm / 700 + w.ph) * 14, w.y + Math.cos(tm / 900 + w.ph) * 9, Math.sin(tm / 500 + i) * 14, s); w.g.style.opacity = sm.I > 0.12 ? 1 : 0; });
  /* urine droplets: kidney down ureter, through bladder, out urethra */
  acc.drop += dt * sm.Flow * 7; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) { p.on = true; p.u = 1; p.route = Math.random() < 0.5 ? routeL : routeR; p.e.setAttribute("opacity", "1"); } }
  drops.forEach((p) => { if (!p.on) return; p.u -= dt * 0.11 * (0.4 + sm.Flow); if (p.u <= 0) { kill(p); return; } const pt = p.route.at(clamp(p.u, 0, 1)); p.e.setAttribute("transform", "translate(" + f1(clamp(pt.x, 30, 930)) + " " + f1(clamp(pt.y, 60, 436)) + ")"); });
  /* systemic particles along the top vessel in urosepsis */
  acc.sys += dt * sm.Sys * 5; while (acc.sys >= 1) { acc.sys--; const p = freeP(sysp); if (p) emit(p, Math.random() < 0.5 ? 255 : 705, 118, (Math.random() < 0.5 ? -1 : 1) * rnd(18, 30), -rnd(16, 24)); }
  sysp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 52, 436)) + ")"); if (p.t > 2.2 || p.y < 54) kill(p); });
  /* antibiotic capsules into the bladder */
  acc.pill += dt * sm.abx * 2.4; while (acc.pill >= 1) { acc.pill--; const p = freeP(pills); if (p) emit(p, rnd(60, 130), 330, 0, 0); }
  pills.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (470 - p.x) * dt * 0.5 + 16 * dt; p.y += (330 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["low", "present", "high"])); gg.blad.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["calm", "inflamed", "very inflamed"])); gg.kid.set(sm.K, wordOf(sm.K, 0.25, 0.55, ["spared", "involved", "heavily involved"]));
  gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.4, 0.65, ["sluggish", "steady", "brisk"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.45, 0.68, ["low", "borderline", "ok"]));
}
run({ init, step });
