/* UTI scene: bacteria climb from the urethra to the bladder and kidneys.
 * Antibiotic capsules arrive and burst over colonies, fluids surge and wash
 * bacteria back down, relief of the blockage clears the stone and the ureter
 * narrows back as flow returns. */
const layers = { flow: $("flow"), bac: $("bac"), wbc: $("wbc"), parts: $("parts"), over: $("over"), panel: $("panel") };
let kidL = null, kidR = null, bladder = null, capEl = null, capDrug = -1;
let trEB = null, trBKL = null, trBKR = null, trDnL = null, trDnR = null, trBlood = null;
let midL = [350, 210], midR = [610, 210], stoneX = 350, stoneY = 210, entryX = 480, entryY = 436, trig = [480, 330];
function bez(p0, p1, p2, p3, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return pts;
}
function rev(pts) { return pts.slice().reverse(); }
function initOrgans() {
  kidL = organ($("kidLSlot"), "kidney", 250, 135, 110, { flip: true });
  kidR = organ($("kidRSlot"), "kidney", 710, 135, 110, {});
  bladder = organ($("bladderSlot"), "bladder", 480, 320, 150, {});
  const PL = kidL.ports.pelvis, PR = kidR.ports.pelvis;
  const BL = bladder.ports.in, BR = bladder.ports.inR, TG = bladder.ports.trigone, OUT = bladder.ports.out;
  trig = TG;
  entryX = OUT[0]; entryY = 436;
  const entry = [entryX, entryY];
  const mkUreter = (P, B) => {
    const c0 = [P[0], P[1] + 45], c1 = [B[0], B[1] - 55];
    return {
      d: "M" + f1(P[0]) + " " + f1(P[1]) + " C" + f1(c0[0]) + " " + f1(c0[1]) + " " + f1(c1[0]) + " " + f1(c1[1]) + " " + f1(B[0]) + " " + f1(B[1]),
      pts: bez(P, c0, c1, B, 8)
    };
  };
  const UL = mkUreter(PL, BL), UR = mkUreter(PR, BR);
  $("ureterL").setAttribute("d", UL.d); $("ureterLIn").setAttribute("d", UL.d);
  $("ureterR").setAttribute("d", UR.d); $("ureterRIn").setAttribute("d", UR.d);
  midL = UL.pts[4]; midR = UR.pts[4]; stoneX = UL.pts[4][0]; stoneY = UL.pts[4][1];
  place($("stoneG"), stoneX, stoneY, 20, 1);
  trEB = track([entry, OUT, TG]);
  trBKL = track([TG].concat(rev(UL.pts)));
  trBKR = track([TG].concat(rev(UR.pts)));
  trDnL = track(UL.pts.concat([TG, OUT, entry]));
  trDnR = track(UR.pts.concat([TG, OUT, entry]));
  trBlood = track([[180, 60], [360, 52], [550, 50], [730, 54], [890, 62]]);
  const halo = (id, o, fx, fy) => { const e = $(id); e.setAttribute("cx", f1(o.x)); e.setAttribute("cy", f1(o.y)); e.setAttribute("rx", f1(o.w * fx)); e.setAttribute("ry", f1(o.h * fy)); };
  halo("kidLhalo", kidL, 0.62, 0.55); halo("kidRhalo", kidR, 0.62, 0.55); halo("bladderHalo", bladder, 0.68, 0.6);
}
function capText(d) {
  if (d === 1) return "Antibiotic kills bacteria. The bladder and kidney clear.";
  if (d === 2) return "Fluids flush out bacteria and support blood pressure.";
  if (d === 3) return "Relief of the blockage lets urine wash bacteria out.";
  if (d === 4) return "All three together kill and flush bacteria. The kidney recovers.";
  return "No treatment. Bacteria climb to the bladder and kidney.";
}
/* ---- ascending bacteria with fimbriae ---- */
const BAC_N = 34, bac = [];
function initBac() {
  for (let i = 0; i < BAC_N; i++) {
    const g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk("ellipse", { class: "cl-b", rx: 6.5, ry: 3.4 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1.4, cy: -1.1 }, g);
    mk("path", { class: "ut-fimb", d: "M-6 -2 L-9 -5 M-6 2 L-9 5 M6 -2 L9 -5 M6 2 L9 5" }, g);
    bac.push({ g, u: Math.random(), leg: 0, bk: i % 2 ? trBKL : trBKR, dn: null, s: 0, rot: rnd(0, 180) });
    bac[i].dn = i % 2 ? trDnL : trDnR;
    bac[i].kid = i % 2 === 0;
  }
}
/* adherent colonies on the bladder wall, placed from the bladder centre */
const stuck = [];
function initStuck() {
  const offs = [[-68, -30], [-62, 10], [-30, 42], [30, 42], [62, 10], [68, -30]];
  offs.forEach(([dx, dy], i) => {
    const g = mk("g", { class: "cl cl-bac" }, layers.bac);
    mk("ellipse", { class: "cl-b", rx: 6.5, ry: 3.4 }, g);
    mk("path", { class: "ut-fimb", d: "M-6 0 L-10 0 M6 -2 L10 -4 M6 2 L10 4" }, g);
    place(g, bladder.x + dx, bladder.y + dy, i * 35, 0.1);
    stuck.push({ g, x: bladder.x + dx, y: bladder.y + dy, rot: i * 35 });
  });
}
/* ---- urine droplets, capsules, kill bursts, blood particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, tr: null, dir: 1 }; }); }
const drops = pool(30, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.flow));
const caps = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const dots = pool(16, () => mk("circle", { class: "sc-p p-kill", r: 2.2 }, layers.parts));
const sysp = pool(16, () => mk("circle", { class: "sc-p p-lps", r: 2.6 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- white cells in the bladder ---- */
const wbcs = [];
function initWbc() {
  const offs = [[-30, -20], [0, -30], [30, -15], [-15, 15], [25, 20]];
  offs.forEach(([dx, dy], i) => {
    const g = cell(layers.wbc, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 7, wob: 0.14 });
    wbcs.push({ g, x: bladder.x + dx, y: bladder.y + dy, ph: i * 1.7 });
  });
}
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 280, 450, 620, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Bacteria", "g-bac", "Bacteria climbing the urinary tract. An antibiotic brings this down."], ["blad", "Bladder", "g-bad", "Bladder inflammation. Soreness and needing to pass urine often."], ["kid", "Kidney", "g-kid", "Kidney involvement. Severe infection can enter the blood."], ["flow", "Urine flow", "g-flow", "Urine flow and bladder emptying flush bacteria out. Fluids support this."], ["bp", "Pressure", "g-good", "Blood pressure. It falls in severe infection; fluids support it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", kidL.x - 45, kidL.y - 35, 140, 95, "Kidney. Bacteria reaching it cause kidney infection with loin pain and fever.");
  pill(ox, "Ureter", midR[0], midR[1], 740, 232, "Ureter: the tube carrying urine from kidney to bladder. Bacteria can climb it against the flow.");
  pill(ox, "Stone", stoneX, stoneY, 250, 265, "Stone blocking the ureter. It slows urine flow, so bacteria are not flushed out.");
  pill(ox, "Bladder", bladder.x - 65, bladder.y, 300, 330, "Bladder. Infection here is cystitis. Bacteria stick to the wall, so urine cannot wash them away.");
  pill(ox, "Bacteria", entryX, 420, 620, 415, "Bacteria enter at the urethra and climb toward the bladder and kidney.");
  pill(ox, "Urine flow", entryX + 15, 430, 300, 403, "Urine flow: steady flow and emptying flush bacteria out. Fluids support this.");
  pill(ox, "Antibiotic", 95, 330, 150, 380, "Antibiotic: capsules arrive in the bladder, burst, and kill bacteria there.");
  pill(ox, "Blood", 820, 60, 860, 110, "Blood. Severe infection can enter the bloodstream and lower blood pressure.");
  capEl = mk("text", { class: "ut-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { B: 0.3, I: 0.3, K: 0.1, Sys: 0.1, Flow: 0.7, BP: 0.9, abx: 0, flu: 0, obst: 0.55 };
const acc = { drop: 0, cap: 0, sys: 0 };
function init() { initOrgans(); initBac(); initStuck(); initWbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.B = lerp(sm.B, m.B, k2); sm.I = lerp(sm.I, m.I, k2); sm.K = lerp(sm.K, m.K, k2); sm.Sys = lerp(sm.Sys, m.Sys, k2);
  sm.Flow = lerp(sm.Flow, m.Flow, k1); sm.BP = lerp(sm.BP, m.BP, k1);
  sm.abx = lerp(sm.abx, m.abx, k1); sm.flu = lerp(sm.flu, m.flu, k1); sm.obst = lerp(sm.obst, m.obst, k1);
  /* ureter widens above the blockage; the stone shrinks as the blockage is relieved */
  const uw = f1(12 + 7 * sm.obst);
  $("ureterL").setAttribute("stroke-width", uw); $("ureterR").setAttribute("stroke-width", uw);
  const ss = clamp(sm.obst * 1.6);
  place($("stoneG"), stoneX, stoneY, 20, Math.max(0.001, ss));
  $("stoneG").style.opacity = ss > 0.08 ? 1 : 0;
  /* inflammation halos on bladder and kidneys */
  $("bladderHalo").setAttribute("opacity", (sm.I * 0.45).toFixed(2));
  $("kidLhalo").setAttribute("opacity", (sm.K * 0.45).toFixed(2));
  $("kidRhalo").setAttribute("opacity", (sm.K * 0.45).toFixed(2));
  /* blood vessel carries the severe-infection load */
  $("bloodV").setAttribute("opacity", (0.2 + 0.65 * sm.Sys).toFixed(2));
  $("bloodV").setAttribute("stroke-width", f1(4 + 3 * sm.Sys));
  /* bacteria climb; fluids push them back down and antibiotic clears them */
  const want = Math.round(sm.B * BAC_N);
  const fwd = 0.06 * (1 - 0.45 * sm.obst), back = 0.09 * sm.flu;
  const ascend = m.a >= 0.5;
  bac.forEach((b, i) => {
    const on = i < want;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    if (b.leg === 0) {
      if (on) b.u += dt * (fwd - back);
      if (b.u >= 1) { if (ascend && b.kid) { b.leg = 1; b.u = 0; } else b.u = 0.02; }
      if (b.u < 0.02) b.u = rnd(0.02, 0.3);
      const pt = trEB.at(clamp(b.u, 0, 1));
      place(b.g, clamp(pt.x, 30, 930), clamp(pt.y, 60, 436), b.rot + pt.a, Math.max(0.001, b.s));
    } else {
      if (on) b.u += dt * (fwd * 0.8 - back * 0.4);
      if (b.u >= 1) { b.leg = 0; b.u = 0.02; }
      if (b.u <= 0) { b.leg = 0; b.u = 0.9; }
      const pt = b.bk.at(clamp(b.u, 0, 1));
      place(b.g, clamp(pt.x, 30, 930), clamp(pt.y, 60, 436), b.rot + pt.a, Math.max(0.001, b.s));
    }
    b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  /* stuck colonies shrink as antibiotic and flushing dislodge them */
  const stScale = (0.15 + 0.85 * sm.I) * (1 - 0.7 * sm.abx) * (1 - 0.3 * sm.flu);
  stuck.forEach((s) => place(s.g, s.x, s.y, s.rot, Math.max(0.001, stScale)));
  wbcs.forEach((w, i) => {
    place(w.g, w.x + Math.sin(tm / 700 + w.ph) * 14, w.y + Math.cos(tm / 900 + w.ph) * 9, Math.sin(tm / 500 + i) * 14, sm.I > 0.12 ? 1 : 0.12);
    w.g.style.opacity = sm.I > 0.12 ? 1 : 0;
  });
  /* urine droplets: kidney down the ureter, through the bladder, out */
  acc.drop += dt * (2 + 8 * sm.Flow);
  while (acc.drop >= 1) {
    acc.drop--;
    const p = freeP(drops);
    if (p) { p.on = true; p.u = 1; p.tr = Math.random() < 0.5 ? trDnL : trDnR; p.e.setAttribute("opacity", "1"); }
  }
  drops.forEach((p) => {
    if (!p.on) return;
    p.u -= dt * (0.25 + 0.35 * sm.Flow);
    if (p.u <= 0) { kill(p); return; }
    const pt = p.tr.at(clamp(p.u, 0, 1));
    p.e.setAttribute("transform", "translate(" + f1(clamp(pt.x, 30, 930)) + " " + f1(clamp(pt.y, 60, 436)) + ")");
  });
  /* antibiotic capsules fly in and burst over the bladder */
  acc.cap += dt * sm.abx * 2.4;
  while (acc.cap >= 1) {
    acc.cap--;
    const p = freeP(caps);
    if (p) emit(p, rnd(60, 130), 330, 0, 0);
  }
  caps.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.x += (trig[0] - p.x) * dt * 0.5 + 16 * dt; p.y += (trig[1] - p.y) * dt * 0.7;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2));
    const dx = p.x - trig[0], dy = p.y - trig[1];
    if (dx * dx + dy * dy < 144 || p.t > 5.5) {
      kill(p);
      for (let j = 0; j < 3; j++) { const d = freeP(dots); if (d) emit(d, p.x + rnd(-6, 6), p.y + rnd(-6, 6), rnd(-22, 22), rnd(-22, 22)); }
    }
  });
  dots.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2));
    if (p.t > 1.2) kill(p);
  });
  /* severe-infection particles ride the blood vessel */
  acc.sys += dt * sm.Sys * 6;
  while (acc.sys >= 1) {
    acc.sys--;
    const p = freeP(sysp);
    if (p) { p.on = true; p.u = Math.random(); p.dir = Math.random() < 0.5 ? 1 : -1; p.t = 0; p.e.setAttribute("opacity", "1"); }
  }
  sysp.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.u += p.dir * dt * 0.06;
    if (p.u <= 0 || p.u >= 1 || p.t > 6) { kill(p); return; }
    const pt = trBlood.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")");
  });
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["low", "present", "high"])); gg.blad.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["calm", "inflamed", "very inflamed"])); gg.kid.set(sm.K, wordOf(sm.K, 0.25, 0.55, ["spared", "involved", "heavily involved"]));
  gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.4, 0.65, ["sluggish", "steady", "brisk"])); gg.bp.set(sm.BP, wordOf(sm.BP, 0.45, 0.68, ["low", "borderline", "ok"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
