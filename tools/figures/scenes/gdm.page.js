/* Gestational diabetes scene: placental hormones, insulin resistance, beta cell compensation, glucose crossing and fetal insulin. */
const CY = SC.CY, WW = SC.W;
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), fetus: $("fetusG"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const horm = pool(22, () => mk("path", { class: "sc-p p-horm", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.parts));
const gluc = pool(38, () => mk("circle", { class: "sc-p p-gluc", r: 3 }, layers.parts));
const ins = pool(26, () => mk("circle", { class: "sc-p p-ins", r: 2.4 }, layers.parts));
const uptake = pool(18, () => mk("circle", { class: "sc-p p-gluc", r: 2.2 }, layers.parts));
const fins = pool(20, () => mk("circle", { class: "sc-p p-fins", r: 2.4 }, layers.parts));
const mpills = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Mother and baby";
  [["res", "Resistance", "g-horm", "Insulin resistance in maternal muscle, fat and liver, driven by placental hormones."], ["beta", "Beta cell effort", "g-ins", "How hard the pancreatic beta cell works to compensate by making more insulin."], ["glu", "Maternal glucose", "g-gluc", "Maternal blood glucose. It rises when resistance outruns beta cell compensation."], ["cross", "Glucose crossing", "g-plac", "Glucose crossing the placenta to the fetus. Maternal insulin does not cross in the same way."], ["fins", "Fetal insulin", "g-fins", "Insulin made by the fetus in response to extra glucose. After birth it can leave the newborn with low glucose for a time."], ["grow", "Baby growth", "g-bad", "Extra fetal growth and fat (macrosomia) driven by fetal insulin."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Placenta", 155, 129, 185, 84, "Placenta. As it grows through pregnancy it releases more hormones that raise insulin resistance.");
  pill(ox, "Placental hormones", 239, 195, 300, 128, "Human placental lactogen and progesterone from the placenta, with cortisol contributing. They make maternal tissues resist insulin.");
  pill(ox, "Muscle and fat", 405, 122, 405, 92, "Maternal muscle and fat. Placental hormones blunt insulin signalling here, so glucose uptake falls and blood glucose rises.");
  pill(ox, "Beta cell", 560, 136, 565, 92, "Pancreatic beta cell in the mother. It tries to compensate by making more insulin. Gestational diabetes follows when it cannot keep up.");
  pill(ox, "Fetus", 810, 130, 810, 88, "Fetus. Extra glucose crossing the placenta makes the fetus produce extra insulin, which drives extra growth.");
  pill(ox, "Maternal glucose", 280, CY, 250, 410, "Glucose in the maternal blood. Higher when insulin resistance outruns beta cell compensation.");
  pill(ox, "Glucose crossing", 640, CY, 640, 410, "Glucose crosses the placenta to the fetus by facilitated transport. It follows the maternal level.");
  pill(ox, "Fetal insulin", 818, 203, 835, 272, "Insulin made by the fetal pancreas. It drives extra growth before birth and can cause low glucose in the newborn after the maternal supply stops.");
  const tp = pill(ox, "Treatment", 50, CY, 90, 275, "Treatment in the vessel and tissues: diet and exercise, metformin or insulin, each lowering maternal glucose in the model."); tp.setAttribute("id", "treat-pill");
}
const sm = { R: 0.5, Beta: 0.5, G: 0.4, T: 0.4, F: 0.3, Gr: 0.3, tx: 0, exo: 0 };
const acc = { horm: 0, gluc: 0, ins: 0, up: 0, fins: 0, mp: 0 };
function init() { initPanel(); place(layers.fetus, 810, 185, 0, 0.95); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.R = lerp(sm.R, m.R, k2); sm.Beta = lerp(sm.Beta, m.Beta, k2); sm.G = lerp(sm.G, m.G, k1); sm.T = lerp(sm.T, m.T, k1); sm.F = lerp(sm.F, m.F, k2); sm.Gr = lerp(sm.Gr, m.Gr, k2); sm.tx = lerp(sm.tx, m.tx, k1); sm.exo = lerp(sm.exo, m.exo, k1);
  place(layers.fetus, 810 + Math.sin(tm / 1600) * 2, 185 + Math.cos(tm / 1900) * 2, Math.sin(tm / 2400) * 3, 0.82 + 0.38 * sm.Gr);
  const tp = $("treat-pill"); if (tp) tp.style.opacity = sm.tx.toFixed(2);
  acc.horm += dt * (2 + 9 * sm.R); while (acc.horm >= 1) { acc.horm--; const p = free(horm); if (p) emit(p, 232, rnd(165, 225), rnd(52, 72), rnd(-14, 4), 0); }
  horm.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 350 + p.x) * 0.25; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 20, 940)) + " " + f1(clamp(p.y, 60, 295)) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 452 || p.t > 4) kill(p); });
  acc.ins += dt * (3 + 11 * sm.Beta + 14 * sm.exo); while (acc.ins >= 1) { acc.ins--; const p = free(ins); if (p) emit(p, rnd(535, 590), rnd(195, 215), rnd(-8, 8), rnd(30, 48), 0); }
  ins.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 20, 940)) + " " + f1(clamp(p.y, 60, 425)) + ")"); if (p.y > CY + 28 || p.t > 4) kill(p); });
  acc.gluc += dt * (4 + 16 * sm.G); while (acc.gluc >= 1) { acc.gluc--; const p = free(gluc); if (p) emit(p, 22, CY + rnd(-24, 24), rnd(52, 78), 0, Math.random() < 0.35 ? 1 : 0); }
  gluc.forEach((p) => { if (!p.on) return; p.t += dt; if (p.k === 1 && p.x > 770) { p.x += p.vx * 0.25 * dt; p.y -= 52 * dt; } else { p.x += p.vx * (0.55 + 0.6 * sm.G) * dt; p.y += Math.sin(tm / 420 + p.t * 3) * 0.2; }
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 18, 942)) + " " + f1(clamp(p.y, 58, 425)) + ")"); if (p.x > 938 || p.y < 238 || p.t > 16) kill(p); });
  acc.up += dt * (1 + 7 * (1 - sm.R) * (m.drug === 1 ? 1.7 : 1)); while (acc.up >= 1) { acc.up--; const p = free(uptake); if (p) emit(p, rnd(355, 455), CY - 36, rnd(-4, 4), -rnd(34, 48), 0); }
  uptake.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 330, 480)) + " " + f1(clamp(p.y, 225, 330)) + ")"); if (p.y < 228 || p.t > 4) kill(p); });
  acc.fins += dt * (2 + 12 * sm.F); while (acc.fins >= 1) { acc.fins--; const p = free(fins); if (p) emit(p, 818, 203, rnd(-22, 22), rnd(-18, 22), 0); }
  fins.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 700, 930)) + " " + f1(clamp(p.y, 120, 300)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3) kill(p); });
  acc.mp += dt * (m.drug === 2 ? 3 : 0); while (acc.mp >= 1) { acc.mp--; const p = free(mpills); if (p) emit(p, rnd(365, 445), 78, 0, 34, 0); }
  mpills.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 340, 470)) + " " + f1(clamp(p.y, 60, 225)) + ") rotate(" + f1(p.t * 70) + ")"); if (p.y > 218 || p.t > 5) kill(p); });
  gg.res.set(sm.R, wordOf(sm.R, 0.38, 0.65, ["low", "raised", "high"])); gg.beta.set(sm.Beta, wordOf(sm.Beta, 0.45, 0.7, ["low", "raised", "high"])); gg.glu.set(sm.G, wordOf(sm.G, 0.38, 0.62, ["controlled", "raised", "high"]));
  gg.cross.set(sm.T, wordOf(sm.T, 0.38, 0.62, ["low", "raised", "high"])); gg.fins.set(sm.F, wordOf(sm.F, 0.38, 0.62, ["low", "raised", "high"])); gg.grow.set(sm.Gr, wordOf(sm.Gr, 0.38, 0.65, ["typical", "increased", "marked"]));
}
run({ init, step });
