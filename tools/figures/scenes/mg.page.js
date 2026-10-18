/* Myasthenia gravis scene: thymus driven antibodies block and damage acetylcholine receptors, so the muscle signal fades. */
const NX = SC.NX, MY = SC.MY, WW = SC.W;
const LY = { cells: $("cells"), recs: $("recs"), parts: $("parts"), filt: $("filt"), imps: $("imps"), over: $("over"), panel: $("panel"), thymus: $("thymusG"), lid: $("lidPath"), arm: $("armLine"), weight: $("weightC"), diaph: $("diaphPath"), muscle: $("muscleRect"), eyeRing: $("eyeRing"), limbRing: $("limbRing"), breathRing: $("breathRing"), glowG: $("glowGood"), glowB: $("glowBad") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, cap: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.cap = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "mg-abd", d: "M0 6L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }

/* real organ art, anchored so particles meet anatomy; lid, weight and diaphragm hang off organ ports */
let eyeO = null, limbO = null, lungO = null;
let lidX0 = 768, lidX1 = 802, lidY = 138, wtX = 874, wtY = 269, diaX = 838, diaY = 414;
const FX = 278, FY = 262;
function initOrgans() {
  eyeO = organ($("eyeSlot"), "eye", 838, 142, 150, {});
  limbO = organ($("limbSlot"), "muscle", 810, 256, 130, {});
  lungO = organ($("lungSlot"), "lung", 838, 344, 96, {});
  const co = eyeO.ports.cornea, le = eyeO.ports.lens;
  lidX0 = Math.round(co[0]) - 7; lidX1 = Math.round(le[0]) + 11; lidY = Math.round(co[1]) - 4;
  const mo = limbO.ports.out; wtX = Math.round(mo[0]); wtY = Math.round(mo[1]);
  const b1 = lungO.ports.base, b2 = lungO.ports.baseR;
  diaX = Math.round((b1[0] + b2[0]) / 2); diaY = Math.round(Math.max(b1[1], b2[1])) + 24;
}

/* plasma cell making antibody */
const plasmaG = mk("g", {}, LY.cells); cell(plasmaG, { cls: "bcell", r: 21, nuc: 0.45, seed: 7, wob: 0.1 }); place(plasmaG, 215, 262, 0, 1);

/* breakdown enzymes along the cleft; the inhibitor caps them */
const ENZX = [380, 420, 460, 500, 540, 580], ENZY = 300;
const enzG = mk("g", {}, LY.cells);
ENZX.forEach((x) => mk("circle", { class: "mg-enz", cx: x, cy: ENZY, r: 3.4 }, enzG));

/* receptors along the muscle top, each with a bound antibody marker */
const RECX = [322, 357, 392, 427, 462, 497, 532, 567, 602, 637];
const recs = RECX.map((x) => { const g = mk("g", {}, LY.recs); mk("rect", { class: "mg-rec", x: -5, y: 0, width: 10, height: 18, rx: 3 }, g); mk("circle", { class: "mg-rec", cx: -5, cy: -2, r: 3.4 }, g); mk("circle", { class: "mg-rec", cx: 5, cy: -2, r: 3.4 }, g); const ab = abShape(g); ab.setAttribute("transform", "translate(0 -10)"); return { g, ab, x }; });

/* plasmapheresis filter: traps antibodies mid flight when removal is on */
const filtG = mk("g", { opacity: "0" }, LY.filt);
mk("rect", { class: "mg-filt", x: FX - 20, y: FY - 23, width: 40, height: 46, rx: 8 }, filtG);
mk("path", { class: "mg-mesh", d: "M" + (FX - 20) + " " + (FY - 11) + "H" + (FX + 20) + "M" + (FX - 20) + " " + FY + "H" + (FX + 20) + "M" + (FX - 20) + " " + (FY + 11) + "H" + (FX + 20) }, filtG);
const trapped = [[-8, -10], [8, -2], [-2, 10]].map(([dx, dy]) => { const g = abShape(filtG); g.setAttribute("transform", "translate(" + (FX + dx) + " " + (FY + dy) + ")"); g.setAttribute("opacity", "0"); return g; });

/* particles and nerve impulses */
const achs = pool(24, () => mk("circle", { class: "sc-p p-ach", r: 2.6 }, LY.parts));
const abds = pool(16, () => abShape(LY.parts));
const comps = pool(14, () => mk("circle", { class: "sc-p p-comp", r: 2.2 }, LY.parts));
const caps = pool(6, () => mk("circle", { class: "sc-p p-drug", r: 3.2 }, LY.parts));
const impDots = Array.from({ length: 5 }, () => { const e = mk("circle", { class: "mg-imp", r: 5 }, LY.imps); e.setAttribute("opacity", "0"); return { e, on: false, y: 0 }; });

function capText(d) {
  if (d === 1) return "Cholinesterase inhibitor keeps messenger around longer. Stronger signal.";
  if (d === 2) return "Immunosuppression lowers antibody making. Receptors recover.";
  if (d === 3) return "Thymectomy and plasmapheresis. Antibodies filtered away, receptors recover.";
  return "No treatment. Antibodies block receptors and muscles fade with use.";
}

/* labels and gauges */
let capEl = null, capDrug = -1;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The junction and muscle";
  [["ab", "Antibodies", "g-ab", "Antibodies against the receptor, made after the thymus linked immune response. They sit on receptors and call in complement."], ["comp", "Complement", "g-comp", "Complement attracted by bound antibody. It damages the folded muscle membrane so receptors are lost."], ["rec", "Receptors", "g-rec", "Working receptors left on the muscle. Fewer receptors means a smaller signal for the same nerve impulse."], ["sig", "Signal", "g-good", "Muscle signal from each nerve impulse. It fades with repeated use when receptors are few, giving fatigable weakness."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 190, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Thymus", 118, 112, 118, 86, "Thymus: a chest gland often abnormal in this disease. It helps drive the faulty attack on receptors.");
  pill(ox, "Antibodies", 310, 246, 292, 222, "Antibodies against the receptor travel to the junction, sit on receptors and call in complement.");
  pill(ox, "Nerve", NX, 120, NX, 92, "Motor nerve: a healthy cable carrying impulses to the muscle. The fault lies beyond it at the junction.");
  pill(ox, "Messenger", 430, 298, 385, 238, "Messenger released by the nerve. It crosses the gap and opens receptors to trigger the muscle.");
  pill(ox, "Receptors", 560, 312, 600, 252, "Receptors on the muscle that catch messenger. Blocked or lost receptors give a smaller signal.");
  pill(ox, "Complement", 638, 334, 700, 290, "Complement: blood proteins that punch into the membrane where antibody sits, destroying receptors.");
  pill(ox, "Muscle", 480, 365, 540, 428, "Muscle fibre: healthy in itself. It fails when the signal falls too low and fades with repeated use.");
  pill(ox, "Weak muscles", 800, 360, 740, 428, "Weak muscles: eyes first, then limbs, and in crisis the breathing muscles. Weakness grows with use.");
  capEl = mk("text", { class: "mg-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0);
}
const sm = { Ab: 0.5, Comp: 0.4, Rec: 0.5, Sig: 0.5, ach: 0, imm: 0, rem: 0, a: 0.65, lvl: 1 };
const acc = { ach: 0, abd: 0, comp: 0, imp: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 1.5);
  sm.Ab = lerp(sm.Ab, m.Ab, k); sm.Comp = lerp(sm.Comp, m.Comp, k); sm.Rec = lerp(sm.Rec, m.Rec, k); sm.Sig = lerp(sm.Sig, m.Sig, k2);
  sm.ach = lerp(sm.ach, m.ach, k2); sm.imm = lerp(sm.imm, m.imm, k2); sm.rem = lerp(sm.rem, m.rem, k2); sm.a = lerp(sm.a, m.a, k); sm.lvl = m.lvl;
  /* thymectomy ghosts the gland, immune calming slows the plasma factory */
  LY.thymus.setAttribute("opacity", (1 - 0.88 * sm.rem - 0.15 * sm.imm).toFixed(2));
  plasmaG.setAttribute("opacity", (1 - 0.45 * sm.rem - 0.3 * sm.imm).toFixed(2));
  /* receptors: working ones stand tall, damaged ones shrink and carry antibody */
  const working = Math.round(sm.Rec * recs.length);
  recs.forEach((r, i) => { const ok = i < working; r.g.setAttribute("transform", "translate(" + f1(r.x) + " " + MY + ") scale(1 " + (ok ? "1" : "0.45") + ")"); r.g.setAttribute("opacity", ok ? "1" : "0.5"); r.ab.setAttribute("opacity", ok ? "0" : sm.Ab.toFixed(2)); });
  /* inhibitor caps sit on the breakdown enzymes so messenger lingers */
  caps.forEach((p, i) => { p.e.setAttribute("transform", "translate(" + ENZX[i] + " " + ENZY + ")"); p.e.setAttribute("opacity", sm.ach.toFixed(2)); });
  /* filter appears and trapped antibodies shimmer inside it */
  LY.filt.setAttribute("opacity", sm.rem.toFixed(2));
  trapped.forEach((g, i) => { g.setAttribute("opacity", sm.rem.toFixed(2)); });
  /* fatigable twitch: repeats within a train fade as receptors fall */
  const train = (tm / 1000) % 5, fade = 1 - 0.5 * (1 - sm.Rec) * (train / 5);
  const phase = (tm / 900) % 1, pulse = Math.pow(Math.max(0, Math.sin(phase * 3.1416)), 2);
  const amp = sm.Sig * fade * pulse;
  LY.muscle.setAttribute("height", f1(88 - 7 * amp)); LY.muscle.setAttribute("y", f1(MY + 3.5 * amp));
  LY.glowG.setAttribute("opacity", (0.08 + 0.28 * sm.Sig).toFixed(2));
  LY.glowB.setAttribute("opacity", (0.3 * (1 - sm.Sig)).toFixed(2));
  LY.weight.setAttribute("cy", f1(294 - 20 * amp));
  LY.arm.setAttribute("d", "M" + wtX + " " + wtY + "L902 " + f1(294 - 20 * amp - 11));
  const edge = 140 + (1 - sm.Sig) * 12, belly = 128 + (1 - sm.Sig) * 20;
  LY.lid.setAttribute("d", "M" + lidX0 + " " + f1(edge) + "Q" + f1((lidX0 + lidX1) / 2) + " " + f1(belly) + " " + lidX1 + " " + f1(edge));
  const breath = Math.sin(tm / 1100) * (2 + 9 * sm.Sig);
  LY.diaph.setAttribute("d", "M" + (diaX - 41) + " " + diaY + "Q" + diaX + " " + f1(diaY + 10 + breath) + " " + (diaX + 41) + " " + diaY);
  LY.eyeRing.setAttribute("opacity", "0.9"); LY.limbRing.setAttribute("opacity", sm.lvl >= 1 ? "0.9" : "0.08"); LY.breathRing.setAttribute("opacity", sm.lvl >= 2 ? "0.9" : "0.08");
  /* nerve impulses run down the healthy nerve */
  acc.imp += dt * 1.6; while (acc.imp >= 1) { acc.imp--; const q = impDots.find((z) => !z.on); if (q) { q.on = true; q.y = 58; q.e.setAttribute("opacity", "1"); } }
  impDots.forEach((q) => { if (!q.on) return; q.y += 95 * dt; q.e.setAttribute("cx", f1(NX)); q.e.setAttribute("cy", f1(q.y)); if (q.y > 240) { q.on = false; q.e.setAttribute("opacity", "0"); } });
  /* messenger crosses the cleft; capped enzymes make it linger */
  acc.ach += dt * 8; while (acc.ach >= 1) { acc.ach--; const p = free(achs); if (p) emit(p, NX + rnd(-34, 34), 276, rnd(-16, 16), rnd(22, 34), 0); }
  achs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > MY - 4) p.vy = -Math.abs(p.vy) * 0.25; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / (1.1 + 1.3 * sm.ach)).toFixed(2)); if (p.t > 1.1 + 1.3 * sm.ach) kill(p); });
  /* antibodies drift from the plasma cell to receptors; the filter traps them when removal is on */
  acc.abd += dt * sm.Ab * 5; while (acc.abd >= 1) { acc.abd--; const p = free(abds); if (p) emit(p, 238, 255, 0, 0, Math.floor(rnd(0, RECX.length))); }
  abds.forEach((p) => {
    if (!p.on) return;
    if (p.cap) { const dx = FX - p.x, dy = FY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 130 * dt; p.y += (dy / d) * 130 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(0.4)"); p.e.setAttribute("opacity", clamp(d / 26).toFixed(2)); if (d < 7) kill(p); return; }
    if (sm.rem > 0.4 && Math.hypot(FX - p.x, FY - p.y) < 30 && Math.random() < 2.5 * dt) { p.cap = 1; return; }
    const tx = RECX[p.k], ty = MY - 12, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 42 * dt; p.y += (dy / d) * 42 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 8) kill(p);
  });
  /* complement gathers at damaged receptors */
  acc.comp += dt * sm.Comp * 6; while (acc.comp >= 1) { acc.comp--; const p = free(comps); const bad = recs[working + Math.floor(rnd(0, Math.max(1, recs.length - working)))]; if (p && bad) emit(p, bad.x + rnd(-8, 8), MY + rnd(2, 14), rnd(-5, 5), rnd(-4, 4), 0); }
  comps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* gauges and the plain language caption */
  gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.3, 0.6, ["low", "moderate", "high"])); gg.comp.set(sm.Comp, wordOf(sm.Comp, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.rec.set(sm.Rec, wordOf(sm.Rec, 0.35, 0.65, ["few", "reduced", "many"])); gg.sig.set(sm.Sig, wordOf(sm.Sig, 0.35, 0.65, ["weak", "reduced", "strong"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
