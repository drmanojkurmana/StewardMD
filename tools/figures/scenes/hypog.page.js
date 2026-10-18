/* Hypoglycaemia scene: fasting and insulin excess, liver output, blood glucose, the brain, counter-regulation, symptoms and treatment. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const sm = { G: 0.4, B: 0.4, CR: 0.6, L: 0.3, Adr: 0.6, Neuro: 0.5, a: 0.65, oral: 0, iv: 0, gluc: 0 };
const acc = { liv: 0, ins: 0, horm: 0, oral: 0, iv: 0, gluc: 0 };

/* ---- organs ---- */
mk("circle", { class: "hypo-plate", cx: 70, cy: 152, r: 27 }, layers.cells);
mk("circle", { class: "hypo-plate", cx: 70, cy: 152, r: 17 }, layers.cells);
const beta = cell(layers.cells, { cls: "bcell", r: 30, nuc: 0.4, seed: 3, wob: 0.1, x: 195, y: 152 });
const ves = [[-10, -8], [8, -12], [12, 5], [-6, 10], [0, 0]].map(([x, y]) => mk("circle", { class: "sc-p p-ins", r: 2.6, cx: 195 + x, cy: 152 + y }, layers.cells));
const musc = mk("rect", { class: "hypo-musc", x: 42, y: 198, width: 224, height: 32, rx: 14 }, layers.cells);
for (let i = 0; i < 10; i++) mk("path", { class: "hypo-stri", d: "M" + (58 + i * 21) + " 204L" + (58 + i * 21) + " 224" }, layers.cells);
const liver = cell(layers.cells, { cls: "liver", r: 52, nuc: 0.28, seed: 9, wob: 0.1, x: 456, y: 145 });
const brain = cell(layers.cells, { cls: "brain", r: 58, nuc: 0, seed: 4, wob: 0.14, x: 782, y: 150 });
const squigs = [[-28, -18, -8, -26], [0, -28, 20, -18], [-30, 8, -6, 0], [4, 12, 26, 4], [-12, 26, 12, 30]].map(([a, b, c, d]) => mk("path", { class: "hypo-squig", d: "M" + a + " " + b + "Q" + (a + 8) + " " + (b - 8) + " " + c + " " + d, transform: "translate(782 150)" }, layers.cells));
const sparks = Array.from({ length: 8 }, (_, i) => { const s = mk("circle", { class: "hypo-spark", r: 3, cx: 748 + (i % 4) * 24, cy: 122 + Math.floor(i / 4) * 52 }, layers.cells); return s; });
const stopMark = mk("g", { opacity: "0" }, layers.marks);
mk("circle", { class: "hypo-stop", cx: 492, cy: 188, r: 8 }, stopMark); mk("path", { class: "hypo-stop", d: "M486 194L498 182" }, stopMark);
/* counter-regulatory sources */
const srcCells = [[62, "alpha"], [152, "adr"], [240, "adr"], [315, "pit"]].map(([x, cls], i) => cell(layers.cells, { cls, r: 13, nuc: 0.4, seed: i + 6, wob: 0.12, x, y: 418 }));
/* symptoms */
const heart = mk("path", { class: "hypo-heart", d: "M0 10C-16 -4 -10 -18 0 -8C10 -18 16 -4 0 10Z", transform: "translate(465 418)" }, layers.cells);
const sweat = [448, 482].map((x) => mk("path", { class: "p-fl", d: "M0 -4C2.6 -.7 3.3 1 3.3 2.1A3.3 3.3 0 0 1 -3.3 2.1C-3.3 1 -2.6 -.7 0 -4Z", transform: "translate(" + x + " 402)" }, layers.cells));
const head = cell(layers.cells, { cls: "brain", r: 14, nuc: 0, seed: 8, wob: 0.12, x: 585, y: 418 });
const stars = Array.from({ length: 3 }, (_, i) => { const s = mk("path", { class: "hypo-spark", d: "M0 -5L1.4 -1.4L5 0L1.4 1.4L0 5L-1.4 1.4L-5 0L-1.4 -1.4Z", transform: "translate(" + (562 + i * 24) + " 396)" }, layers.cells); return s; });
/* treatment icons */
const trOral = mk("g", { id: "tr-oral" }, layers.cells); mk("path", { class: "hypo-icon", d: "M714 410h28l-4 18h-20Z" }, trOral); mk("circle", { class: "sc-p p-gluc", cx: 728, cy: 418, r: 3.4 }, trOral);
const trIv = mk("g", { id: "tr-iv" }, layers.cells); mk("path", { class: "hypo-ico2", d: "M810 404h24v22a12 8 0 0 1-24 0Z" }, trIv); mk("path", { class: "p-fl", d: "M822 412c3.4 4.2 4.2 6.8 4.2 8.6a4.2 4.2 0 0 1-8.4 0c0-1.8.8-4.4 4.2-8.6Z" }, trIv);
const trGluc = mk("g", { id: "tr-gluc" }, layers.cells); mk("rect", { class: "hypo-icon", x: 886, y: 412, width: 44, height: 13, rx: 3 }, trGluc); mk("path", { class: "hypo-icon", d: "M930 416h14M930 421h14M884 418h-6M884 414v9" }, trGluc);
/* ---- pools ---- */
const blood = Array.from({ length: 28 }, () => ({ e: dot("p-gluc", 3)(), x: rnd(20, 940), r: rnd(-0.75, 0.75) }));
const livP = pool(12, dot("p-gluc", 3));
const insP = pool(10, () => mk("path", { class: "sc-p p-ins", d: "M0 -3.4L3 -1.7L3 1.7L0 3.4L-3 1.7L-3 -1.7Z" }, layers.parts));
const hormP = pool(20, () => mk("circle", { class: "sc-p p-horm", r: 2.6 }, layers.parts));
const oralP = pool(8, dot("p-gluc", 3.2)), ivP = pool(8, dot("p-gluc", 3.2));
const glucP = pool(8, () => mk("path", { class: "sc-p p-horm3", d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts));
const SRCX = [62, 152, 240, 315];
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 280, 450, 620, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gl", "Glucose", "g-gl", "Blood glucose: falls when no glucose comes in and insulin is in excess, rises again with treatment."], ["brain", "Brain fuel", "g-good", "Glucose reaching the brain. The brain depends on a steady supply and has almost no store of its own."], ["horm", "Hormones", "g-horm", "Counter-regulatory hormones: glucagon, adrenaline, cortisol and growth hormone. They rise as glucose falls and push the liver to release glucose."], ["adr", "Warning signs", "g-bad", "Adrenergic warning symptoms from adrenaline: sweating, shaking, racing heart, hunger and anxiety."], ["neuro", "Brain signs", "g-bad", "Neuroglycopenic symptoms from a starved brain: poor concentration, confusion, odd behaviour, drowsiness and, if severe, seizures or coma."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Fasting", 70, 152, 70, 96, "Fasting: no new glucose is coming in from food, so the body must live on liver glucose stores.");
  pill(ox, "Insulin excess", 195, 152, 195, 96, "Excess insulin, from treatment or rarely an insulin secreting tumour: it drives glucose into muscle and switches off liver glucose production.");
  pill(ox, "Muscle uptake", 230, 214, 150, 214, "Muscle: insulin pushes blood glucose into muscle, lowering the blood level further when insulin is in excess.");
  pill(ox, "Liver cell", 456, 145, 456, 96, "Liver cell: the main source of glucose between meals, from glycogen breakdown and making new glucose (gluconeogenesis). Counter-regulatory hormones switch it on; insulin switches it off.");
  pill(ox, "Stops liver output", 492, 188, 456, 214, "Insulin excess stops the liver releasing glucose, so the usual defence against fasting fails.");
  pill(ox, "Brain", 782, 150, 782, 96, "The brain: it uses glucose continuously, stores almost none, and cannot use fatty acids directly, so it suffers first when glucose falls.");
  pill(ox, "Needs glucose", 820, 168, 862, 200, "The brain needs a constant glucose supply from the blood, minute by minute.");
  pill(ox, "Blood glucose", 380, CY, 330, 332, "Glucose carried in the blood from the liver (and food) to the brain and other tissues.");
  pill(ox, "To brain", 782, CY, 782, 332, "Glucose leaving the blood for the brain. When this supply falls short, brain symptoms follow.");
  pill(ox, "Glucagon", 62, 406, 62, 386, "Glucagon from pancreatic alpha cells: the fast first defence. It tells the liver to break down glycogen and release glucose.");
  pill(ox, "Adrenaline", 152, 406, 152, 386, "Adrenaline from the adrenal medulla: raises liver glucose output and causes the warning symptoms, sweating, shaking and a racing heart.");
  pill(ox, "Cortisol", 240, 406, 240, 386, "Cortisol from the adrenal cortex: a slower defence that helps the liver make new glucose over hours.");
  pill(ox, "GH", 315, 406, 315, 386, "Growth hormone from the pituitary: a slower defence that reduces glucose use by tissues and helps the liver make glucose.");
  pill(ox, "Adrenergic", 465, 408, 465, 386, "Adrenergic warning symptoms: sweating, tremor, palpitations, hunger and anxiety. They warn that glucose is falling, but may be blunted by some medicines or repeated lows.");
  pill(ox, "Neuroglycopenic", 585, 404, 585, 386, "Neuroglycopenic symptoms: the starved brain works poorly, causing poor concentration, confusion, odd behaviour, drowsiness and, if severe, seizures or coma.");
  const po = pill(ox, "Oral glucose", 728, 410, 728, 386, "Oral glucose, for example glucose tablets or a sugary drink: only when the person is awake and can swallow safely."); po.setAttribute("id", "tp-oral");
  const pv = pill(ox, "IV glucose", 822, 408, 822, 386, "Intravenous glucose: glucose given into a vein when the person cannot swallow safely or is unconscious."); pv.setAttribute("id", "tp-iv");
  const pg = pill(ox, "Glucagon", 912, 412, 912, 386, "Glucagon given by injection: it tells the liver to release glucose from glycogen, so it may work less well after prolonged fasting when stores are low."); pg.setAttribute("id", "tp-gluc");
}
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.G = lerp(sm.G, m.G, k2); sm.B = lerp(sm.B, m.B, k2); sm.CR = lerp(sm.CR, m.CR, k2); sm.L = lerp(sm.L, m.L, k2); sm.Adr = lerp(sm.Adr, m.Adr, k2); sm.Neuro = lerp(sm.Neuro, m.Neuro, k2);
  sm.oral = lerp(sm.oral, m.oral, k1); sm.iv = lerp(sm.iv, m.iv, k1); sm.gluc = lerp(sm.gluc, m.gluc, k1); sm.a = m.a;
  /* blood glucose flowing to the brain */
  const flow = 42 * (0.4 + 0.6 * sm.G), want = Math.round(sm.G * blood.length);
  blood.forEach((p, i) => { p.x += flow * dt; if (p.x > 946) { p.x = 18; p.r = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * 18) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); });
  /* liver releases glucose down into the blood */
  acc.liv += dt * sm.L * 4; while (acc.liv >= 1) { acc.liv--; const p = free(livP); if (p) emit(p, 456 + rnd(-16, 16), 198, rnd(-4, 4), 42, 0); }
  livP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y > CY - 24) kill(p); });
  /* insulin from the beta cell toward the liver */
  acc.ins += dt * (0.4 + sm.a) * 2.4; while (acc.ins >= 1) { acc.ins--; const p = free(insP); if (p) emit(p, 224, 148 + rnd(-8, 8), 52, 2, 0); }
  insP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.x > 408) kill(p); });
  stopMark.setAttribute("opacity", clamp(sm.a * (1 - 0.5 * sm.gluc)).toFixed(2));
  ves.forEach((v) => v.setAttribute("opacity", (0.35 + 0.6 * sm.a).toFixed(2)));
  /* counter-regulatory hormones rise to the liver */
  acc.horm += dt * sm.CR * 7; while (acc.horm >= 1) { acc.horm--; const p = free(hormP); if (p) { const s = Math.floor(rnd(0, 4)); p.e.setAttribute("class", "sc-p " + ["p-horm", "p-horm2", "p-horm3", "p-horm4"][s]); emit(p, SRCX[s], 402, (456 - SRCX[s]) * 0.14, -52, s); } }
  hormP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y < 202) kill(p); });
  srcCells.forEach((c, i) => place(c, SRCX[i], 418 + Math.sin(tm / 600 + i * 2) * 1.5, 0, 1 + 0.1 * sm.CR * Math.sin(tm / 300 + i)));
  /* brain: activity sparks and a starved shake */
  place(brain, 782 + Math.sin(tm / 90) * 3 * sm.Neuro, 150, Math.sin(tm / 240) * 4 * sm.Neuro, 1);
  squigs.forEach((s) => s.setAttribute("transform", "translate(" + f1(782 + Math.sin(tm / 90) * 3 * sm.Neuro) + " 150)"));
  sparks.forEach((s, i) => s.setAttribute("opacity", (sm.B * (0.4 + 0.6 * Math.abs(Math.sin(tm / 500 + i * 1.7)))).toFixed(2)));
  /* symptoms: racing heart and sweat, confused head */
  heart.setAttribute("transform", "translate(465 418) scale(" + (1 + 0.28 * sm.Adr * Math.max(0, Math.sin(tm / 160))).toFixed(3) + ")");
  sweat.forEach((s) => s.setAttribute("opacity", sm.Adr.toFixed(2)));
  place(head, 585 + Math.sin(tm / 200) * 2.5 * sm.Neuro, 418, Math.sin(tm / 300) * 10 * sm.Neuro, 1);
  stars.forEach((s, i) => { s.setAttribute("opacity", sm.Neuro.toFixed(2)); s.setAttribute("transform", "translate(" + (562 + i * 24) + " 396) rotate(" + f1(tm / 8 + i * 40) + ")"); });
  /* treatments */
  $("tr-oral").style.opacity = (0.3 + 0.7 * sm.oral).toFixed(2); $("tr-iv").style.opacity = (0.3 + 0.7 * sm.iv).toFixed(2); $("tr-gluc").style.opacity = (0.3 + 0.7 * sm.gluc).toFixed(2);
  $("tp-oral").style.opacity = (0.35 + 0.65 * sm.oral).toFixed(2); $("tp-iv").style.opacity = (0.35 + 0.65 * sm.iv).toFixed(2); $("tp-gluc").style.opacity = (0.35 + 0.65 * sm.gluc).toFixed(2);
  acc.oral += dt * sm.oral * 4; while (acc.oral >= 1) { acc.oral--; const p = free(oralP); if (p) emit(p, 728 + rnd(-6, 6), 404, 0, -52, 0); }
  oralP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; at(p); if (p.y < CY + 22) kill(p); });
  acc.iv += dt * sm.iv * 5; while (acc.iv >= 1) { acc.iv--; const p = free(ivP); if (p) emit(p, 822 + rnd(-6, 6), 402, 0, -56, 0); }
  ivP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; at(p); if (p.y < CY + 22) kill(p); });
  acc.gluc += dt * sm.gluc * 3.4; while (acc.gluc >= 1) { acc.gluc--; const p = free(glucP); if (p) { emit(p, 900, 406, 0, 0, 0); p.tx = 470; p.ty = 180; } }
  glucP.forEach((p) => { if (!p.on) return; p.x += (p.tx - p.x) * dt * 1.1; p.y += (p.ty - p.y) * dt * 1.1; at(p); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 14) kill(p); });
  /* organ life */
  place(beta, 195 + Math.sin(tm / 1700) * 1.5, 152, 0, 1 + 0.04 * Math.sin(tm / 400));
  place(liver, 456, 145 + Math.sin(tm / 1900) * 2, 0, 1 + 0.02 * Math.sin(tm / 700));
  /* gauges */
  gg.gl.set(sm.G, wordOf(sm.G, 0.4, 0.7, ["low", "borderline", "restored"])); gg.brain.set(sm.B, wordOf(sm.B, 0.4, 0.7, ["starved", "short", "supplied"])); gg.horm.set(sm.CR, wordOf(sm.CR, 0.3, 0.6, ["quiet", "rising", "surging"]));
  gg.adr.set(sm.Adr, wordOf(sm.Adr, 0.3, 0.6, ["mild", "clear", "strong"])); gg.neuro.set(sm.Neuro, wordOf(sm.Neuro, 0.35, 0.65, ["none", "some", "marked"]));
}
run({ init, step });
