/* Myasthenia gravis scene: thymus linked antibodies block and damage acetylcholine receptors, so the muscle signal fades. */
const NX = SC.NX, MY = SC.MY, WW = SC.W;
const LY = { cells: $("cells"), recs: $("recs"), parts: $("parts"), imps: $("imps"), over: $("over"), panel: $("panel"), lid: $("lidPath"), weight: $("weightC"), diaph: $("diaphPath"), muscle: $("muscleRect"), eyeRing: $("eyeRing"), limbRing: $("limbRing"), breathRing: $("breathRing") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "mg-abd", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }

/* plasma cell making antibody */
const plasmaG = mk("g", {}, LY.cells); cell(plasmaG, { cls: "bcell", r: 21, nuc: 0.45, seed: 7, wob: 0.1 }); place(plasmaG, 225, 205, 0, 1);

/* receptors along the muscle top, each with a bound antibody marker */
const RECX = [320, 355, 390, 425, 460, 495, 530, 565, 600, 635];
const recs = RECX.map((x) => { const g = mk("g", {}, LY.recs); mk("rect", { class: "mg-rec", x: -5, y: 0, width: 10, height: 18, rx: 3 }, g); mk("circle", { class: "mg-rec", cx: -5, cy: -2, r: 3.4 }, g); mk("circle", { class: "mg-rec", cx: 5, cy: -2, r: 3.4 }, g); const ab = abShape(g); ab.setAttribute("transform", "translate(0 -10)"); return { g, ab, x }; });

/* particles and nerve impulses */
const achs = pool(24, () => mk("circle", { class: "sc-p p-ach", r: 2.6 }, LY.parts));
const abds = pool(16, () => abShape(LY.parts));
const comps = pool(14, () => mk("circle", { class: "sc-p p-comp", r: 2.2 }, LY.parts));
const impDots = Array.from({ length: 5 }, () => { const e = mk("circle", { class: "mg-imp", r: 5 }, LY.imps); e.setAttribute("opacity", "0"); return { e, on: false, y: 0 }; });

/* labels and gauges */
let achPill, immPill, remPill;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The junction and muscle";
  [["ab", "Antibodies", "g-ab", "Antibodies against the acetylcholine receptor, made after the thymus linked immune response. They block receptors and attract complement."], ["comp", "Complement", "g-comp", "Complement attracted by bound antibody. It damages the folded muscle membrane so receptors are lost."], ["rec", "Receptors", "g-rec", "Working acetylcholine receptors left on the muscle. Fewer receptors means a smaller signal for the same nerve impulse."], ["sig", "Signal", "g-good", "Muscle signal from each nerve impulse. It fades with repeated use when receptors are few, giving fatigable weakness."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 190, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Thymus", 120, 100, 120, 82, "Thymus: a gland in the chest that is often abnormal in myasthenia gravis. It helps drive the faulty antibody response against the receptor.");
  pill(ox, "Plasma cell", 225, 188, 235, 165, "Plasma cell: an immune cell making antibodies against the acetylcholine receptor.");
  pill(ox, "Antibodies", 320, 215, 335, 165, "Antibodies against the acetylcholine receptor travel to the junction, block receptors and attract complement.");
  pill(ox, "Motor nerve", NX, 120, NX, 82, "Motor nerve: carries the impulse to the muscle. The nerve itself is healthy; the fault is at the junction beyond it.");
  pill(ox, "Acetylcholine", 435, 285, 365, 282, "Acetylcholine: the messenger released by the nerve. It crosses the cleft and opens receptors to trigger the muscle.");
  pill(ox, "Receptors", 575, 312, 590, 282, "Acetylcholine receptors on the folded muscle membrane. Antibody and complement leave fewer working receptors.");
  pill(ox, "Complement", 625, 306, 660, 235, "Complement: blood proteins attracted by bound antibody. They punch into the folded membrane and destroy receptors.");
  pill(ox, "Weak muscles", 830, 245, 830, 215, "Weak muscles: eye muscles first, then limbs, and in crisis the breathing muscles. Weakness worsens with use and eases with rest.");
  pill(ox, "Muscle fibre", 485, 405, 485, 428, "Muscle fibre: healthy in itself, but it fails when the junction signal falls too low. Repeated signals fade fastest.");
  achPill = pill(ox, "AChE inhibitor", 435, 288, 135, 315, "Cholinesterase inhibitor: slows breakdown of acetylcholine in the cleft, so remaining receptors get a longer signal. It does not stop the antibody attack.");
  immPill = pill(ox, "Immune calming", 225, 215, 135, 350, "Immunosuppression: lowers antibody production over time, so fewer receptors are blocked and damaged.");
  remPill = pill(ox, "Antibody removal", 320, 215, 135, 385, "Thymectomy and plasmapheresis: removing the thymus source and filtering antibody out of the blood lower the attack on receptors.");
}
const sm = { Ab: 0.5, Comp: 0.4, Rec: 0.5, Sig: 0.5, ach: 0, imm: 0, rem: 0, a: 0.65, lvl: 1 };
const acc = { ach: 0, abd: 0, comp: 0, imp: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 1.5);
  sm.Ab = lerp(sm.Ab, m.Ab, k); sm.Comp = lerp(sm.Comp, m.Comp, k); sm.Rec = lerp(sm.Rec, m.Rec, k); sm.Sig = lerp(sm.Sig, m.Sig, k2);
  sm.ach = lerp(sm.ach, m.ach, k2); sm.imm = lerp(sm.imm, m.imm, k2); sm.rem = lerp(sm.rem, m.rem, k2); sm.a = lerp(sm.a, m.a, k); sm.lvl = m.lvl;
  /* receptors: working ones stand tall, damaged ones shrink and carry antibody */
  const working = Math.round(sm.Rec * recs.length);
  recs.forEach((r, i) => { const ok = i < working; r.g.setAttribute("transform", "translate(" + f1(r.x) + " " + MY + ") scale(1 " + (ok ? "1" : "0.45") + ")"); r.g.style.opacity = ok ? "1" : "0.5"; r.ab.style.opacity = ok ? "0" : sm.Ab.toFixed(2); });
  /* fatigable twitch: repeats within a train fade as receptors fall */
  const train = (tm / 1000) % 5, fade = 1 - 0.5 * (1 - sm.Rec) * (train / 5);
  const phase = (tm / 900) % 1, pulse = Math.pow(Math.max(0, Math.sin(phase * 3.1416)), 2);
  const amp = sm.Sig * fade * pulse;
  LY.muscle.setAttribute("height", f1(92 - 7 * amp)); LY.muscle.setAttribute("y", f1(MY + 3.5 * amp));
  LY.weight.setAttribute("cy", f1(282 - 20 * amp));
  LY.lid.setAttribute("d", "M784 " + f1(150 + (1 - sm.Sig) * 10) + "Q830 " + f1(132 + (1 - sm.Sig) * 22) + " 876 " + f1(150 + (1 - sm.Sig) * 10));
  const breath = Math.sin(tm / 1200) * (3 + 11 * sm.Sig);
  LY.diaph.setAttribute("d", "M790 378Q830 " + f1(390 + breath) + " 870 378");
  LY.eyeRing.style.opacity = "0.9"; LY.limbRing.style.opacity = sm.lvl >= 1 ? "0.9" : "0.08"; LY.breathRing.style.opacity = sm.lvl >= 2 ? "0.9" : "0.08";
  /* nerve impulses run down the healthy nerve */
  acc.imp += dt * 1.6; while (acc.imp >= 1) { acc.imp--; const q = impDots.find((z) => !z.on); if (q) { q.on = true; q.y = 58; q.e.setAttribute("opacity", "1"); } }
  impDots.forEach((q) => { if (!q.on) return; q.y += 95 * dt; q.e.setAttribute("cx", f1(NX)); q.e.setAttribute("cy", f1(q.y)); if (q.y > 240) { q.on = false; q.e.setAttribute("opacity", "0"); } });
  /* acetylcholine crosses the cleft; a cholinesterase inhibitor makes it linger */
  acc.ach += dt * 8; while (acc.ach >= 1) { acc.ach--; const p = free(achs); if (p) emit(p, NX + rnd(-34, 34), 276, rnd(-16, 16), rnd(22, 34), 0); }
  achs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > MY - 4) p.vy = -Math.abs(p.vy) * 0.25; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / (1.1 + 1.3 * sm.ach)).toFixed(2)); if (p.t > 1.1 + 1.3 * sm.ach) kill(p); });
  /* antibodies drift from the plasma cell to receptors */
  acc.abd += dt * sm.Ab * 5; while (acc.abd >= 1) { acc.abd--; const p = free(abds); if (p) emit(p, 238, 198, 0, 0, Math.floor(rnd(0, RECX.length))); }
  abds.forEach((p) => { if (!p.on) return; const tx = RECX[p.k], ty = MY - 12, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 42 * dt; p.y += (dy / d) * 42 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 8) kill(p); });
  /* complement gathers at damaged receptors */
  acc.comp += dt * sm.Comp * 6; while (acc.comp >= 1) { acc.comp--; const p = free(comps); const bad = recs[working + Math.floor(rnd(0, Math.max(1, recs.length - working)))]; if (p && bad) emit(p, bad.x + rnd(-8, 8), MY + rnd(2, 14), rnd(-5, 5), rnd(-4, 4), 0); }
  comps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* treatment labels fade in for the chosen treatment */
  achPill.style.opacity = sm.ach.toFixed(2); immPill.style.opacity = sm.imm.toFixed(2); remPill.style.opacity = sm.rem.toFixed(2);
  /* gauges */
  gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.3, 0.6, ["low", "moderate", "high"])); gg.comp.set(sm.Comp, wordOf(sm.Comp, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.rec.set(sm.Rec, wordOf(sm.Rec, 0.35, 0.65, ["few", "reduced", "many"])); gg.sig.set(sm.Sig, wordOf(sm.Sig, 0.35, 0.65, ["weak", "reduced", "strong"]));
}
run({ init, step });
