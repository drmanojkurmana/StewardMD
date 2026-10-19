/* Gestational diabetes scene: placental hormones dock on muscle receptors, pancreas beta cell
 * compensates, glucose crosses to the fetus. Diet boosts uptake, metformin pills knock hormone
 * blockers off the receptors, insulin pours in along the dashed path. */
const CY = SC.CY, WW = SC.W;
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), fetus: $("fetusG"), wash: $("wash"), halo: $("halo"), rec: $("recSlot"), exoPath: $("exoPath") };
const REC_N = 5;
let muscleO = null, pancO = null, recY = 143, belly = [377, 178], panOut = [572, 146];
let recXs = [], caps = [], veilEl = null, fatEls = [], capEl = null, capDrug = -1;
let trHorm = null, trExoV = null, trExoM = null;
const capKnock = [0, 0, 0, 0, 0];
function capText(d) {
  if (d === 1) return "Diet and exercise. Less glucose in, more taken up by muscle. Less reaches the baby.";
  if (d === 2) return "Metformin helps muscle respond to insulin. Glucose falls. Less reaches the baby.";
  if (d === 3) return "Insulin tops up what the body lacks. Glucose falls fast. Least reaches the baby.";
  return "No treatment. Hormones block insulin, glucose stays high and extra reaches the baby.";
}
function initOrgans() {
  muscleO = organ($("muscleSlot"), "muscle", 408, 180, 170, {});
  pancO = organ($("pancSlot"), "pancreas", 572, 150, 115, {});
  const mh = muscleO.h;
  recY = Math.round(muscleO.y - mh / 2 + 3);
  const x0 = muscleO.x - 48, x1 = muscleO.x + 48;
  for (let i = 0; i < REC_N; i++) recXs.push(Math.round(x0 + (x1 - x0) * i / (REC_N - 1)));
  if (muscleO.ports.belly) belly = [muscleO.ports.belly[0], muscleO.ports.belly[1]];
  if (pancO.ports.body) panOut = [pancO.ports.body[0], pancO.ports.body[1]];
  veilEl = mk("ellipse", { class: "gdm-veil", cx: f1(muscleO.x), cy: f1(muscleO.y), rx: f1(muscleO.w * 0.44), ry: f1(mh * 0.46) }, layers.rec);
  veilEl.setAttribute("opacity", "0.5");
  recXs.forEach((x) => { mk("circle", { class: "gdm-rec", cx: x, cy: recY, r: 4 }, layers.rec); });
  recXs.forEach((x) => { caps.push(mk("path", { class: "sc-p p-horm", d: "M0 -5L4 0L0 5L-4 0Z", transform: "translate(" + x + " " + recY + ")" }, layers.rec)); });
  fatEls = Array.from(layers.fetus.querySelectorAll(".gdm-fat"));
  const rm = [(recXs[0] + recXs[REC_N - 1]) / 2, recY];
  trHorm = track([[238, 192], [300, 180], [356, 160], rm]);
  trExoV = track([[480, 66], [480, 150], [476, 230], [468, 318]]);
  trExoM = track([[480, 66], [470, 140], [440, 170], belly]);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, st: 0, tr: null }; }); }
const horm = pool(24, () => mk("path", { class: "sc-p p-horm", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.parts));
const gluc = pool(70, () => mk("circle", { class: "sc-p p-gluc", r: 3 }, layers.parts));
const ins = pool(26, () => mk("circle", { class: "sc-p p-ins", r: 2.4 }, layers.parts));
const exo = pool(20, () => mk("circle", { class: "sc-p p-ins", r: 2.8 }, layers.parts));
const uptake = pool(20, () => mk("circle", { class: "sc-p p-gluc", r: 2.2 }, layers.parts));
const fins = pool(20, () => mk("circle", { class: "sc-p p-fins", r: 2.4 }, layers.parts));
const mpills = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "gdm-tab", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "gdm-tab2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.st = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Mother and baby";
  [["res", "Resistance", "g-horm", "Insulin resistance in maternal muscle, fat and liver, driven by placental hormones."], ["beta", "Beta cell effort", "g-ins", "How hard the pancreatic beta cell works to compensate by making more insulin."], ["glu", "Maternal glucose", "g-gluc", "Maternal blood glucose. It rises when resistance outruns beta cell compensation."], ["cross", "Glucose crossing", "g-plac", "Glucose crossing the placenta to the fetus. Maternal insulin does not cross in the same way."], ["fins", "Fetal insulin", "g-fins", "Insulin made by the fetus in response to extra glucose. After birth it can leave the newborn with low glucose for a time."], ["grow", "Baby growth", "g-bad", "Extra fetal growth and fat (macrosomia) driven by fetal insulin."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Placenta", 155, 136, 150, 84, "Placenta. It grows through pregnancy and releases hormones that raise insulin resistance.");
  pill(ox, "Hormones", 300, 180, 300, 128, "Placental hormones. They dock on muscle receptors and blunt insulin signalling, so glucose uptake falls.");
  pill(ox, "Muscle", muscleO.ports.in[0], muscleO.ports.in[1], 338, 102, "Maternal muscle. Orange haze and caps show resistance blocking glucose uptake.");
  pill(ox, "Pancreas", pancO.x, Math.round(pancO.y - pancO.h / 2), 576, 82, "Maternal pancreas. Its beta cells make extra insulin to compensate, but cannot keep up.");
  pill(ox, "Glucose", 250, CY, 250, 406, "Glucose in maternal blood. Richer yellow means higher glucose.");
  pill(ox, "Crossing", 640, CY, 700, 406, "Glucose crosses the placenta to the baby. Maternal insulin does not cross this way.");
  pill(ox, "Baby", 790, 145, 815, 88, "Baby. Extra glucose makes the baby release extra insulin, which drives extra growth.");
  capEl = mk("text", { class: "gdm-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0);
}
const sm = { R: 0.5, Beta: 0.5, G: 0.4, T: 0.4, F: 0.3, Gr: 0.3, tx: 0, exo: 0 };
const acc = { horm: 0, gluc: 0, ins: 0, exo: 0, up: 0, fins: 0, mp: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.R = lerp(sm.R, m.R, k2); sm.Beta = lerp(sm.Beta, m.Beta, k2); sm.G = lerp(sm.G, m.G, k1); sm.T = lerp(sm.T, m.T, k1); sm.F = lerp(sm.F, m.F, k2); sm.Gr = lerp(sm.Gr, m.Gr, k2); sm.tx = lerp(sm.tx, m.tx, k1); sm.exo = lerp(sm.exo, m.exo, k1);
  /* large-area treatment signals: sugary wash in the vessel, resistance haze on muscle, growth halo round the baby */
  layers.wash.setAttribute("opacity", (0.06 + 0.5 * sm.G).toFixed(2));
  veilEl.setAttribute("opacity", (0.6 * sm.R).toFixed(2));
  layers.halo.setAttribute("opacity", (0.6 * sm.Gr).toFixed(2));
  fatEls.forEach((e) => e.setAttribute("opacity", (0.5 * sm.Gr).toFixed(2)));
  layers.exoPath.setAttribute("opacity", drug === 3 ? "0.85" : "0.25");
  const fs = 0.75 + 0.5 * sm.Gr;
  place(layers.fetus, 810 + Math.sin(tm / 1600) * 2, 185 + Math.cos(tm / 1900) * 2, Math.sin(tm / 2400) * 3, fs);
  /* hormone blockers sit on the receptors while resistance is high; metformin knocks them off */
  for (let i = 0; i < REC_N; i++) {
    capKnock[i] = Math.max(0, capKnock[i] - dt);
    const base = sm.R > 0.25 + 0.15 * i ? 0.95 : 0.12;
    caps[i].setAttribute("opacity", (base * (capKnock[i] > 0 ? 0.15 : 1)).toFixed(2));
  }
  /* hormones fly from the placenta and dock on the muscle receptors */
  acc.horm += dt * (2 + 9 * sm.R);
  while (acc.horm >= 1) { acc.horm--; const p = free(horm); if (p) { emit(p, 0, 0, 0, 0, 0); p.tr = trHorm; } }
  horm.forEach((p) => { if (!p.on) return; p.u += dt * 100 / p.tr.len; if (p.u >= 1) { kill(p); return; } const q = p.tr.at(p.u); place(p.e, q.x, q.y, tm / 6, 1); });
  /* beta cell insulin falls from the pancreas into the vessel */
  acc.ins += dt * (3 + 11 * sm.Beta);
  while (acc.ins >= 1) { acc.ins--; const p = free(ins); if (p) emit(p, panOut[0] + rnd(-24, 24), panOut[1] + rnd(-6, 6), rnd(-8, 8), rnd(30, 48), 0); }
  ins.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 20, 940)) + " " + f1(clamp(p.y, 60, 425)) + ")"); if (p.y > CY + 28 || p.t > 4) kill(p); });
  /* injected insulin pours in along the dashed path, into the vessel and the muscle */
  if (m.drug === 3) { acc.exo += dt * 7; while (acc.exo >= 1) { acc.exo--; const p = free(exo); if (p) { emit(p, 0, 0, 0, 0, 0); p.tr = Math.random() < 0.6 ? trExoV : trExoM; } } } else acc.exo = 0;
  exo.forEach((p) => { if (!p.on) return; p.u += dt * 130 / p.tr.len; if (p.u >= 1) { kill(p); return; } const q = p.tr.at(p.u); place(p.e, q.x, q.y, 0, 1); });
  /* glucose flows left to right; some crosses to the baby */
  acc.gluc += dt * (4 + 16 * sm.G);
  while (acc.gluc >= 1) { acc.gluc--; const p = free(gluc); if (p) emit(p, 22, CY + rnd(-24, 24), rnd(52, 78), 0, Math.random() < 0.35 ? 1 : 0); }
  const gs = 0.75 + 0.85 * sm.G, life = 2.5 + 4 * sm.G;
  gluc.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.k === 1 && p.x > 740) { p.x += p.vx * 0.25 * dt; p.y -= 52 * dt; }
    else { p.x += p.vx * (0.55 + 0.6 * sm.G) * dt; p.y += Math.sin(tm / 420 + p.t * 3) * 0.2; }
    let op = p.t > life - 1 ? clamp(life - p.t) : 1;
    if (p.k === 1 && p.y < 230) op = Math.min(op, clamp((p.y - 172) / 58));
    place(p.e, clamp(p.x, 18, 942), clamp(p.y, 58, 425), tm / 6, gs);
    p.e.setAttribute("opacity", op.toFixed(2));
    if (p.x > 938 || p.y < 172 || p.t > life + 1) kill(p);
  });
  /* muscle takes glucose up; diet, metformin and insulin all raise the flow */
  acc.up += dt * (1 + 7 * (1 - sm.R) + (m.drug === 1 ? 4 : 0) + 8 * sm.exo);
  while (acc.up >= 1) { acc.up--; const p = free(uptake); if (p) emit(p, rnd(belly[0] - 45, belly[0] + 45), CY - 36, rnd(-4, 4), -rnd(34, 48), 0); }
  uptake.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, clamp(p.x, 330, 480), clamp(p.y, 150, 330), 0, m.drug === 1 ? 1.4 : 1); if (p.y < belly[1] + 6 || p.t > 4) kill(p); });
  /* fetal insulin clouds round the baby */
  acc.fins += dt * (2 + 12 * sm.F);
  while (acc.fins >= 1) { acc.fins--; const p = free(fins); if (p) emit(p, 818, 203, rnd(-22, 22), rnd(-18, 22), 0); }
  fins.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 700, 930)) + " " + f1(clamp(p.y, 120, 300)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.3).toFixed(2)); if (p.t > 1.3) kill(p); });
  /* metformin pills fall on the receptors, sit, and knock the blockers off */
  acc.mp += dt * (m.drug === 2 ? 3 : 0);
  while (acc.mp >= 1) { acc.mp--; const p = free(mpills); if (p) emit(p, rnd(recXs[0], recXs[REC_N - 1]), 76, 0, 34, 0); }
  mpills.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.st === 0) {
      p.y += p.vy * dt;
      if (p.y >= recY) { p.st = 1; p.t = 0; let bi = 0, bd = 1e9; recXs.forEach((x, i) => { const d = Math.abs(x - p.x); if (d < bd) { bd = d; bi = i; } }); p.x = recXs[bi]; capKnock[bi] = 2.2; }
      p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 340, 470)) + " " + f1(clamp(p.y, 60, 225)) + ") rotate(" + f1(p.t * 70) + ")");
      if (p.y > 218 || p.t > 5) kill(p);
    } else {
      const op = p.t < 1.6 ? 1 : clamp(1 - (p.t - 1.6) / 0.8);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(recY + 2) + ")");
      p.e.setAttribute("opacity", op.toFixed(2));
      if (p.t > 2.4) kill(p);
    }
  });
  gg.res.set(sm.R, wordOf(sm.R, 0.38, 0.65, ["low", "raised", "high"])); gg.beta.set(sm.Beta, wordOf(sm.Beta, 0.45, 0.7, ["low", "raised", "high"])); gg.glu.set(sm.G, wordOf(sm.G, 0.38, 0.62, ["controlled", "raised", "high"]));
  gg.cross.set(sm.T, wordOf(sm.T, 0.38, 0.62, ["low", "raised", "high"])); gg.fins.set(sm.F, wordOf(sm.F, 0.38, 0.62, ["low", "raised", "high"])); gg.grow.set(sm.Gr, wordOf(sm.Gr, 0.38, 0.65, ["typical", "increased", "marked"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
