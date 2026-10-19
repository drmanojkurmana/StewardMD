/* Hypoglycaemia scene: insulin excess, liver output, blood glucose to the brain, rescue hormones, symptoms and treatment. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), vessel: $("vessel"), vglow: $("vesselGlow"), bglow: $("brainGlow"), lglow: $("liverGlow"), recept: $("receptor"), blockM: $("blockM") };
let pancO = null, muscO = null, liverO = null, brainO = null, heartO = null, capEl = null, capDrug = -1, dockEl = null, receptXY = [500, 205];
let trDeliver = null, trUptake = null, trIns = null, trHorm = null, trOral = null, trIv = null, trGluc = null;
function capText(d) {
  if (d === 1) return "Oral glucose tops up the blood from the gut. The brain recovers.";
  if (d === 2) return "Glucagon docks on the liver and tells it to release stored glucose. Blood glucose rises.";
  if (d === 3) return "IV glucose flows straight into the blood. The brain gets fuel again.";
  return "No treatment. Blood glucose stays low and the brain stays starved.";
}
/* organs are real anatomy art; vessels and tracks hang off their ports (see below) */
function initOrgans() {
  pancO = organ($("pancSlot"), "pancreas", 140, 170, 170, {});
  muscO = organ($("muscSlot"), "muscle", 325, 170, 160, {});
  liverO = organ($("liverSlot"), "liver", 545, 170, 215, {});
  brainO = organ($("brainSlot"), "brain", 800, 170, 190, {});
  heartO = organ($("heartSlot"), "heart", 150, 385, 105, {});
  const LP = liverO.ports, BP = brainO.ports, PP = pancO.ports, MP = muscO.ports;
  const car = BP.carotid;
  const vd = "M220 " + CY + " L" + f1(car[0] - 46) + " " + CY + " C" + f1(car[0] - 10) + " " + CY + " " + f1(car[0] - 6) + " " + f1(car[1] + 40) + " " + f1(car[0]) + " " + f1(car[1]);
  layers.vessel.setAttribute("d", vd);
  layers.vglow.setAttribute("d", vd);
  receptXY = LP.lobe;
  layers.recept.setAttribute("cx", f1(receptXY[0])); layers.recept.setAttribute("cy", f1(receptXY[1]));
  layers.blockM.setAttribute("transform", "translate(" + f1(LP.porta[0] - 585) + " " + f1(LP.porta[1] - 212) + ")");
  trDeliver = track([[220, CY], [400, CY], [545, CY], [car[0] - 46, CY], [car[0] - 10, CY], [car[0] - 6, car[1] + 40], car]);
  trUptake = track([[400, CY], [360, 260], [MP.belly[0], MP.belly[1]]]);
  trIns = track([PP.out, [(PP.out[0] + MP.in[0]) / 2, (PP.out[1] + MP.in[1]) / 2 - 14], MP.in]);
  trHorm = track([[350, 408], [372, 344], [LP.porta[0] - 30, LP.porta[1] + 60], LP.porta]);
  trOral = track([[520, 384], [520, 340], [520, CY]]);
  trIv = track([[660, 336], [660, 292]]);
  trGluc = track([[798, 382], [700, 300], LP.lobe]);
  dockEl = mk("path", { class: "sc-p p-horm3", d: "M0 -4.5L3.8 0L0 4.5L-3.8 0Z" }, layers.parts);
  dockEl.setAttribute("opacity", "0");
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, sp: 0, tr: null }; }); }
const free = (pl) => pl.find((p) => !p.on);
function launch(p, tr, sp) { p.on = true; p.tr = tr; p.u = 0; p.sp = sp; const q = tr.at(0); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(pl, dt) { pl.forEach((p) => { if (!p.on) return; p.u += dt * p.sp / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p); }); }
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.4L3 -1.7L3 1.7L0 3.4L-3 1.7L-3 -1.7Z" }, layers.parts);
const blood = Array.from({ length: 26 }, () => ({ e: dot("p-gluc", 3)(), x: rnd(220, 740) }));
const delP = pool(14, dot("p-gluc", 3.2));
const upP = pool(8, dot("p-gluc", 2.8));
const insP = pool(10, dia("p-ins"));
const hormP = pool(14, dot("p-horm", 2.6));
const oralP = pool(8, dot("p-gluc", 3.2));
const ivP = pool(10, dot("p-gluc", 3.4));
const glucP = pool(8, dia("p-horm3"));
const sm = { G: 0.4, B: 0.4, CR: 0.6, L: 0.3, Adr: 0.6, Neuro: 0.5, a: 0.65, oral: 0, iv: 0, gluc: 0 };
const acc = { del: 0, up: 0, ins: 0, horm: 0, oral: 0, iv: 0, gluc: 0 };
let sweat = [], stars = [], sparks = [];
function initMarks() {
  sweat = [[128, 330], [172, 330]].map(([x, y]) => mk("path", { class: "p-fl", d: "M0 -4C2.6 -.7 3.3 1 3.3 2.1A3.3 3.3 0 0 1 -3.3 2.1C-3.3 1 -2.6 -.7 0 -4Z", transform: "translate(" + x + " " + y + ")" }, layers.cells));
  const bp = brainO.ports.parenchyma;
  sparks = Array.from({ length: 6 }, (_, i) => mk("circle", { class: "hypo-spark", r: 3, cx: Math.round(bp[0] - 40 + (i % 3) * 40), cy: Math.round(bp[1] - 24 + Math.floor(i / 3) * 48) }, layers.cells));
  stars = Array.from({ length: 3 }, (_, i) => mk("path", { class: "hypo-spark", d: "M0 -5L1.4 -1.4L5 0L1.4 1.4L0 5L-1.4 1.4L-5 0L-1.4 -1.4Z", transform: "translate(" + (742 + i * 26) + " 252)" }, layers.cells));
}
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 280, 450, 620, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gl", "Glucose", "g-gl", "Blood glucose: falls when insulin is in excess, rises again with treatment."], ["brain", "Brain fuel", "g-good", "Glucose reaching the brain. The brain depends on a steady supply and has almost no store of its own."], ["horm", "Hormones", "g-horm", "Rescue hormones: glucagon, adrenaline, cortisol and growth hormone. They rise as glucose falls and push the liver to release glucose."], ["adr", "Warning signs", "g-bad", "Warning symptoms from adrenaline: sweating, shaking, racing heart, hunger and anxiety."], ["neuro", "Brain signs", "g-bad", "Brain symptoms from a starved brain: poor concentration, confusion, odd behaviour, drowsiness and, if severe, seizures or coma."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Pancreas", 140, 170, 140, 72, "Pancreas: too much insulin drives glucose into muscle and switches the liver off.");
  pill(ox, "Muscle", 325, 170, 325, 104, "Muscle: insulin pulls glucose in from the blood, which lowers blood glucose further.");
  pill(ox, "Liver", 545, 170, 545, 72, "Liver: the main glucose store between meals. Rescue hormones switch it on and insulin switches it off.");
  pill(ox, "Brain", 800, 170, 800, 72, "Brain: uses glucose all the time and stores almost none, so it suffers first when glucose falls.");
  pill(ox, "Blood glucose", 480, 290, 520, 330, "Blood glucose carried from the liver and food to the brain and muscle.");
  pill(ox, "Rescue hormones", 370, 345, 292, 376, "Rescue hormones: glucagon and adrenaline rise as glucose falls and push the liver to release glucose.");
  pill(ox, "Warning signs", 150, 385, 150, 352, "Warning signs from adrenaline: sweating, shaking, a racing heart and hunger.");
  const tp = pill(ox, "Treatment", 660, 360, 700, 352, "Treatment: glucose by mouth when awake and swallowing safely, IV glucose when not, or glucagon which tells the liver to release glucose.");
  tp.setAttribute("id", "tp-treat");
  capEl = mk("text", { class: "hypo-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
function init() { initOrgans(); initMarks(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.G = lerp(sm.G, m.G, k2); sm.B = lerp(sm.B, m.B, k2); sm.CR = lerp(sm.CR, m.CR, k2); sm.L = lerp(sm.L, m.L, k2); sm.Adr = lerp(sm.Adr, m.Adr, k2); sm.Neuro = lerp(sm.Neuro, m.Neuro, k2);
  sm.oral = lerp(sm.oral, m.oral, k1); sm.iv = lerp(sm.iv, m.iv, k1); sm.gluc = lerp(sm.gluc, m.gluc, k1); sm.a = m.a;
  /* vessel widens and brightens as glucose returns, most with IV straight into the blood */
  layers.vessel.setAttribute("stroke-width", f1(12 + 8 * sm.G + 5 * sm.iv));
  layers.vessel.setAttribute("opacity", (0.55 + 0.4 * sm.G).toFixed(2));
  layers.vglow.setAttribute("stroke-width", f1(17 + 8 * sm.G + 6 * sm.iv));
  layers.vglow.setAttribute("opacity", (0.08 + 0.3 * sm.G + 0.3 * sm.iv).toFixed(2));
  layers.bglow.setAttribute("opacity", (sm.Neuro * 0.5).toFixed(2));
  layers.lglow.setAttribute("opacity", ((0.1 * sm.L + 0.55 * sm.gluc) * (0.6 + 0.4 * Math.sin(tm / 300))).toFixed(2));
  layers.blockM.setAttribute("opacity", clamp(sm.a * (1 - 0.45 * sm.gluc)).toFixed(2));
  /* glucagon docks on its liver receptor and stays there while treatment is on */
  dockEl.setAttribute("transform", "translate(" + f1(receptXY[0]) + " " + f1(receptXY[1] + Math.sin(tm / 500) * 2) + ")");
  dockEl.setAttribute("opacity", sm.gluc.toFixed(2));
  /* ambient blood glucose drifting to the brain */
  const flow = 46 * (0.4 + 0.6 * sm.G), want = Math.round(sm.G * blood.length);
  blood.forEach((p, i) => { p.x += flow * dt; if (p.x > 742) p.x = 222; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + Math.sin(p.x / 60 + tm / 900) * 9) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); });
  /* directed streams, each anchored to organ ports */
  acc.del += dt * (0.8 + 7 * sm.G); while (acc.del >= 1) { acc.del--; const p = free(delP); if (p) launch(p, trDeliver, 110); }
  ride(delP, dt);
  acc.up += dt * (0.4 + 3.5 * sm.a); while (acc.up >= 1) { acc.up--; const p = free(upP); if (p) launch(p, trUptake, 70); }
  ride(upP, dt);
  acc.ins += dt * (0.4 + 3 * sm.a); while (acc.ins >= 1) { acc.ins--; const p = free(insP); if (p) launch(p, trIns, 60); }
  ride(insP, dt);
  acc.horm += dt * sm.CR * 6; while (acc.horm >= 1) { acc.horm--; const p = free(hormP); if (p) { p.e.setAttribute("class", "sc-p " + ["p-horm", "p-horm2", "p-horm3", "p-horm4"][Math.floor(rnd(0, 4))]); launch(p, trHorm, 80); } }
  ride(hormP, dt);
  acc.oral += dt * sm.oral * 5; while (acc.oral >= 1) { acc.oral--; const p = free(oralP); if (p) launch(p, trOral, 90); }
  ride(oralP, dt);
  acc.iv += dt * sm.iv * 7; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) launch(p, trIv, 130); }
  ride(ivP, dt);
  acc.gluc += dt * sm.gluc * 4; while (acc.gluc >= 1) { acc.gluc--; const p = free(glucP); if (p) launch(p, trGluc, 100); }
  ride(glucP, dt);
  /* organs live: brain shakes and dims when starved, heart races with warning signs */
  place(pancO.g, 140 + Math.sin(tm / 1700) * 1.5, 170, 0, 1 + 0.03 * Math.sin(tm / 400));
  place(muscO.g, 325, 170 + Math.sin(tm / 1900) * 1.5, 0, 1);
  place(liverO.g, 545, 170 + Math.sin(tm / 1900) * 2, 0, 1 + 0.02 * Math.sin(tm / 700));
  place(brainO.g, 800 + Math.sin(tm / 90) * 3 * sm.Neuro, 170, Math.sin(tm / 240) * 4 * sm.Neuro, 1);
  const beat = Math.max(0, Math.sin(tm / 160));
  place(heartO.g, 150, 385, 0, 1 + 0.22 * sm.Adr * beat);
  sweat.forEach((s) => s.setAttribute("opacity", sm.Adr.toFixed(2)));
  stars.forEach((s, i) => { s.setAttribute("opacity", sm.Neuro.toFixed(2)); s.setAttribute("transform", "translate(" + (742 + i * 26) + " 252) rotate(" + f1(tm / 8 + i * 40) + ")"); });
  sparks.forEach((s, i) => s.setAttribute("opacity", (sm.B * (0.35 + 0.65 * Math.abs(Math.sin(tm / 500 + i * 1.7)))).toFixed(2)));
  /* treatment icons light up only when used */
  $("tr-oral").style.opacity = (0.3 + 0.7 * sm.oral).toFixed(2); $("tr-iv").style.opacity = (0.3 + 0.7 * sm.iv).toFixed(2); $("tr-gluc").style.opacity = (0.3 + 0.7 * sm.gluc).toFixed(2);
  /* gauges */
  gg.gl.set(sm.G, wordOf(sm.G, 0.4, 0.7, ["low", "borderline", "restored"])); gg.brain.set(sm.B, wordOf(sm.B, 0.4, 0.7, ["starved", "short", "supplied"])); gg.horm.set(sm.CR, wordOf(sm.CR, 0.3, 0.6, ["quiet", "rising", "surging"]));
  gg.adr.set(sm.Adr, wordOf(sm.Adr, 0.3, 0.6, ["mild", "clear", "strong"])); gg.neuro.set(sm.Neuro, wordOf(sm.Neuro, 0.35, 0.65, ["none", "some", "marked"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
