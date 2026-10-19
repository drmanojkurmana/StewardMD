/* Alcohol withdrawal scene: rebounding synapse, surge vessel to the body, real heart, muscle and brain organs. */
const layers = { sending: $("sending"), receiving: $("receiving"), parts: $("parts"), fx: $("fx"), iv: $("ivG"), over: $("over"), panel: $("panel") };
let sendG = null, recvG = null;
let heartO = null, muscleO = null, brainO = null, capEl = null, capDrug = -1;
let carotid = [745, 408], paren = [776, 376], ivcPt = [683, 265], belly = [755, 292];
let trSurge = null, surgeEl = null, pulseEl = null;
let ivG = null, calmHalo = null, injHalo = null, dockG = null, shieldG = null;
const tickEls = [], drips = [];
function capText(d) {
  if (d === 1) return "Benzodiazepine boosts the GABA brake. Firing calms and the body settles.";
  if (d === 2) return "Thiamine protects the brain. It does not calm the firing.";
  if (d === 3) return "Fluids support circulation. They do not restore the brake.";
  return "No treatment. The brake is weak so the brain fires out of control.";
}
/* ---- synapse cells ---- */
function initCells() {
  sendG = cell(layers.sending, { cls: "pre", r: 34, nuc: 0.4, seed: 3, wob: 0.1 });
  recvG = cell(layers.receiving, { cls: "post", r: 42, nuc: 0.38, seed: 7, wob: 0.09 });
  place(sendG, 175, 275, 0, 1); place(recvG, 435, 275, 0, 1);
}
/* ---- real organs, vessel, drug rigs, halos and docks ---- */
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 700, 222, 76, {});
  muscleO = organ($("muscleSlot"), "muscle", 786, 294, 170, {});
  brainO = organ($("brainSlot"), "brain", 786, 384, 120, {});
  const HP = heartO.ports, BP = brainO.ports, MP = muscleO.ports;
  carotid = BP.carotid; paren = BP.parenchyma; ivcPt = HP.ivc || [683, 265]; belly = MP.belly || belly;
  surgeEl = $("surgeVessel");
  surgeEl.setAttribute("d", "M470 308 C555 318 630 358 " + f1(carotid[0]) + " " + f1(carotid[1]));
  trSurge = track([[470, 308], [555, 318], [630, 358], carotid]);
  pulseEl = $("pulse");
  pulseEl.setAttribute("stroke-dasharray", "10 6");
  calmHalo = mk("circle", { class: "aw-calm", cx: 435, cy: 275, r: 58, opacity: "0" }, layers.fx);
  injHalo = mk("circle", { class: "aw-inj", cx: f1(paren[0]), cy: f1(paren[1]), r: 55, opacity: "0" }, layers.fx);
  dockG = mk("g", { opacity: "0" }, layers.fx);
  [[374, 232], [374, 242], [374, 252], [402, 232], [402, 242], [402, 252], [388, 220], [388, 264]].forEach(function (q) {
    mk("rect", { class: "aw-dock", x: q[0] - 4, y: q[1] - 2, width: 8, height: 4, rx: 2 }, dockG);
  });
  shieldG = mk("g", { opacity: "0" }, layers.fx);
  mk("circle", { class: "aw-shield", cx: f1(paren[0]), cy: f1(paren[1]), r: 30 }, shieldG);
  for (let i = 0; i < 6; i++) { const t = (i / 6) * 6.2832;
    mk("circle", { class: "sc-p p-thia", cx: f1(paren[0] + Math.cos(t) * 30), cy: f1(paren[1] + Math.sin(t) * 30), r: 3 }, shieldG); }
  [[belly[0] - 56, 244], [belly[0], 240], [belly[0] + 56, 244]].forEach(function (q) {
    tickEls.push(mk("path", { class: "aw-tick", d: "M" + f1(q[0]) + " " + f1(q[1]) + "l0 12", opacity: "0" }, layers.fx));
  });
  ivG = mk("g", { opacity: "0" }, layers.iv);
  mk("rect", { class: "aw-bag", x: 766, y: 162, width: 36, height: 30, rx: 6 }, ivG);
  mk("rect", { class: "aw-fluid", x: 770, y: 174, width: 28, height: 14, rx: 3 }, ivG);
  mk("path", { class: "aw-line", d: "M784 192 C780 225 720 235 " + f1(ivcPt[0]) + " " + f1(ivcPt[1]) }, ivG);
  for (let i = 0; i < 3; i++) drips.push({ e: mk("circle", { class: "aw-fluid", r: 2.4 }, ivG), ph: i * 21 });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, tr: null }; }); }
const gabaP = pool(24, () => mk("circle", { class: "sc-p p-gaba", r: 2.6 }, layers.parts));
const gluP = pool(26, () => mk("path", { class: "sc-p p-glu", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const surgeP = pool(10, () => mk("path", { class: "sc-p p-glu", d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z" }, layers.parts));
const benzoP = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const thiaP = pool(10, () => mk("rect", { class: "sc-p p-thia", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges, labels and caption ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 230, 370, 510, 650, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The rebound";
  [["inh", "Inhibition", "g-inh", "GABA inhibition, the brake on firing. Chronic alcohol boosted it, so the brain weakened it. A benzodiazepine boosts it again."], ["exc", "Excitation", "g-exc", "Glutamate excitation through NMDA receptors. Chronic alcohol blocked these receptors, so the brain strengthened them."], ["hyp", "Excitability", "g-hyp", "How ready the brain is to fire out of control: high when excitation outruns inhibition. Seizures come from this surge."], ["aut", "Autonomic", "g-aut", "Autonomic hyperactivity: racing pulse, sweating and raised temperature as the rebound spreads beyond the brain."], ["conf", "Confusion", "g-conf", "Confusion and agitation. Most marked in delirium tremens, the severe late stage."], ["thi", "Thiamine", "g-thi", "Thiamine store. Chronic alcohol use depletes it. Replacing it protects the brain but does not calm excitability."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Sending cell", 175, 241, 105, 182, "The sending cell releases GABA and glutamate across the gap to the receiving cell.");
  pill(ox, "GABA brake", 388, 242, 300, 182, "GABA is the main brake signal. After adaptation its signal is weak. A benzodiazepine docks here and boosts it again.");
  pill(ox, "Glutamate surge", 370, 322, 150, 402, "Glutamate is the main excitatory signal. Strengthened NMDA receptors make it surge when alcohol stops.");
  pill(ox, "Receiving cell", 448, 318, 410, 402, "The receiving cell carries the GABA brake above and NMDA triggers below. It fires out of control during withdrawal.");
  pill(ox, "Racing heart", 700, 190, 880, 190, "A racing pulse from autonomic hyperactivity. Sweating and heat come with it in early withdrawal.");
  pill(ox, "Tremor", 810, 290, 884, 282, "Shaking muscle from excess firing. It stills as inhibition returns.");
  pill(ox, "Confused brain", 820, 390, 838, 418, "In delirium tremens the brain is agitated and confused. Thiamine protects it but does not calm firing.");
  capEl = mk("text", { class: "aw-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { G: 0.5, E: 0.4, Exc: 0.4, Aut: 0.4, Conf: 0.2, Thi: 0.4, tlv: 1, benzo: 0, thia: 0, fluids: 0 };
const acc = { gaba: 0, glu: 0, surge: 0, benzo: 0, thia: 0 };
function init() { initCells(); initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.G = lerp(sm.G, m.G, k); sm.E = lerp(sm.E, m.E, k); sm.Exc = lerp(sm.Exc, m.Exc, k); sm.Aut = lerp(sm.Aut, m.Aut, k); sm.Conf = lerp(sm.Conf, m.Conf, k); sm.Thi = lerp(sm.Thi, m.Thi, k); sm.tlv = lerp(sm.tlv, m.tl, k);
  sm.benzo = lerp(sm.benzo, m.benzo, k); sm.thia = lerp(sm.thia, m.thia, k); sm.fluids = lerp(sm.fluids, m.fluids, k);
  const calm = sm.benzo;
  const shake = sm.Exc * Math.sin(tm / 70);
  place(sendG, 175, 275 + Math.sin(tm / 900) * 2, 0, 1);
  place(recvG, 435 + shake * 4, 275 + Math.cos(tm / 80) * sm.Exc * 3, shake * 2, 1 + 0.08 * sm.Exc * Math.max(0, Math.sin(tm / 180)));
  calmHalo.setAttribute("opacity", (0.45 * calm).toFixed(2));
  $("gaba-rec").setAttribute("opacity", (0.3 + 0.7 * sm.G).toFixed(2)); $("nmda-rec").setAttribute("opacity", (0.3 + 0.7 * sm.E).toFixed(2));
  dockG.setAttribute("opacity", calm.toFixed(2));
  $("tl-prog").setAttribute("width", f1((sm.tlv / 2) * 820));
  [0, 1, 2].forEach((i) => { const el = $("tl" + i); el.style.fill = Math.round(sm.tlv) === i ? "var(--c-bad)" : ""; });
  /* body organs: heart beats, muscle shakes, brain reels */
  const beat = Math.max(0, Math.sin(tm / (340 - 180 * sm.Aut)));
  place(heartO.g, 700, 222, 0, 1 + 0.1 * sm.Aut * beat);
  place(muscleO.g, 786 + Math.sin(tm / 55) * sm.Exc * 5, 294, Math.sin(tm / 60) * sm.Exc * 6, 1);
  place(brainO.g, 786 + Math.sin(tm / 90) * sm.Conf * 4, 384, Math.sin(tm / 110) * sm.Conf * 6, 1);
  injHalo.setAttribute("opacity", (sm.Conf * (1 - 0.35 * sm.thia) * 0.5).toFixed(2));
  shieldG.setAttribute("opacity", sm.thia.toFixed(2));
  tickEls.forEach((el, i) => el.setAttribute("opacity", (sm.Exc * (0.45 + 0.18 * i) * (1 - 0.7 * calm)).toFixed(2)));
  /* surge vessel pulses with excitability, sparks fade on treatment */
  surgeEl.setAttribute("opacity", (0.25 + 0.6 * sm.Exc).toFixed(2));
  surgeEl.setAttribute("stroke-width", f1(9 + 8 * sm.Exc));
  pulseEl.setAttribute("opacity", (0.25 + 0.75 * sm.Aut).toFixed(2));
  pulseEl.setAttribute("stroke-dashoffset", String(-Math.round(tm * (0.01 + 0.05 * sm.Aut)) % 16));
  /* IV rig appears with fluids */
  ivG.setAttribute("opacity", sm.fluids.toFixed(2));
  drips.forEach(function (d) {
    const y = 196 + ((tm * 0.05 + d.ph) % 58);
    d.e.setAttribute("transform", "translate(" + f1(784 - (y - 196) * 1.5) + " " + f1(y) + ")");
  });
  /* particles */
  acc.gaba += dt * sm.G * (10 + 8 * calm); while (acc.gaba >= 1) { acc.gaba--; const p = free(gabaP); if (p) emit(p, 218, rnd(238, 258), rnd(52, 68), rnd(-4, 4)); }
  gabaP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 200, 392)) + " " + f1(clamp(p.y, 225, 270)) + ")"); if (p.x > 378) kill(p); });
  acc.glu += dt * sm.E * 13; while (acc.glu >= 1) { acc.glu--; const p = free(gluP); if (p) emit(p, 218, rnd(298, 318), rnd(52, 68), rnd(-4, 4)); }
  gluP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 200, 392)) + " " + f1(clamp(p.y, 288, 335)) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 378) kill(p); });
  acc.surge += dt * (0.5 + 9 * sm.Exc) * (1 - 0.65 * calm); while (acc.surge >= 1) { acc.surge--; const p = free(surgeP); if (p) { p.tr = trSurge; p.u = 0; emit(p, 0, 0, 0, 0); } }
  surgeP.forEach((p) => { if (!p.on) return; p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.u >= 1) kill(p); });
  acc.benzo += dt * sm.benzo * 6; while (acc.benzo >= 1) { acc.benzo--; const p = free(benzoP); if (p) emit(p, rnd(300, 368), 192, rnd(-5, 5), rnd(20, 30)); }
  benzoP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 280, 400)) + " " + f1(clamp(p.y, 185, 262)) + ") rotate(" + f1(p.t * 80) + ")"); if (p.y > 256) kill(p); });
  acc.thia += dt * sm.thia * 6; while (acc.thia >= 1) { acc.thia--; const p = free(thiaP); if (p) { const tx = paren[0], ty = paren[1], sx = rnd(640, 662), sy = rnd(398, 420), dd = Math.max(1, Math.hypot(tx - sx, ty - sy)); emit(p, sx, sy, (tx - sx) / dd * 60, (ty - sy) / dd * 60); } }
  thiaP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(paren[0] - p.x, paren[1] - p.y) < 12) kill(p); });
  gg.inh.set(sm.G, wordOf(sm.G, 0.35, 0.6, ["low", "reduced", "steady"])); gg.exc.set(sm.E, wordOf(sm.E, 0.5, 0.75, ["mild", "raised", "high"]));
  gg.hyp.set(sm.Exc, wordOf(sm.Exc, 0.3, 0.62, ["calm", "tense", "surging"])); gg.aut.set(sm.Aut, wordOf(sm.Aut, 0.4, 0.65, ["settled", "active", "racing"]));
  gg.conf.set(sm.Conf, wordOf(sm.Conf, 0.3, 0.62, ["clear", "uneasy", "confused"])); gg.thi.set(sm.Thi, wordOf(sm.Thi, 0.35, 0.65, ["low", "partly filled", "replaced"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
