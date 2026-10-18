/* Ketogenesis scene: lipolysis, carnitine shuttle, beta-oxidation, ketone formation and ketone use. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), tr: $("tr"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const atP = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts);

/* ---- cells and structures ---- */
const fatCell = cell(layers.cells, { cls: "fat", r: 44, seed: 7, wob: 0.07, x: 105, y: 155 });
const vac = mk("circle", { cx: 105, cy: 155, r: 26, style: "fill:#fff3c0;stroke:#d9b44a;stroke-width:1" }, layers.cells);
const hepCell = cell(layers.cells, { cls: "hep", r: 20, nuc: 0.35, seed: 4, wob: 0.1, x: 255, y: 120 });
const brainCell = cell(layers.cells, { cls: "brain", r: 27, nuc: 0.38, seed: 11, wob: 0.12, x: 735, y: 95 });
mk("path", { d: "M712 78L690 62M728 72L724 52M748 76L764 58M716 112L696 126M752 112L770 124", style: "fill:none;stroke:#8f72d0;stroke-width:1.4;stroke-linecap:round" }, layers.cells);
const musRect = mk("rect", { class: "kt-musc", x: 664, y: 182, width: 244, height: 42, rx: 18 }, layers.cells);
for (let i = 0; i < 11; i++) mk("path", { class: "kt-stri", d: "M" + (684 + i * 20) + " 190L" + (684 + i * 20) + " 216" }, layers.cells);
const gateL = mk("rect", { class: "kt-gate", x: 284, y: 138, width: 7, height: 24, rx: 2 }, layers.cells);
const gateR = mk("rect", { class: "kt-gate", x: 293, y: 138, width: 7, height: 24, rx: 2 }, layers.cells);
const hmgDot = mk("circle", { class: "sc-p p-ket", cx: 532, cy: 138, r: 6 }, layers.cells);
const enzDots = [[370, 128], [417, 118], [464, 128], [464, 172], [417, 182], [370, 172]].map(([x, y]) => mk("circle", { class: "sc-p p-acet", cx: x, cy: y, r: 3.4 }, layers.cells));
/* treatment icons */
const gIcon = mk("g", { id: "kt-tr-g" }, layers.tr);
mk("path", { class: "kt-icon-g", d: "M68 382h44v30a18 10 0 0 1-44 0Z" }, gIcon);
mk("path", { class: "kt-icon-g", d: "M86 382v-6h8v6" }, gIcon);
mk("circle", { class: "sc-p p-gluc", cx: 90, cy: 398, r: 5 }, gIcon);
const cIcon = mk("g", { id: "kt-tr-c" }, layers.tr);
mk("rect", { class: "kt-icon-c", x: 188, y: 388, width: 52, height: 16, rx: 8 }, cIcon);
mk("path", { class: "kt-icon-c", d: "M214 388v16" }, cIcon);
mk("circle", { class: "sc-p p-carn", cx: 202, cy: 396, r: 3.4 }, cIcon);
/* defect block marks */
const block1 = mk("g", { opacity: "0" }, layers.marks);
mk("path", { class: "kt-block", d: "M284 138L302 162M302 138L284 162" }, block1);
const block2 = mk("g", { opacity: "0" }, layers.marks);
mk("path", { class: "kt-block", d: "M404 138L430 164M430 138L404 164" }, block2);

/* ---- pools ---- */
const ffaP = pool(14, () => mk("path", { class: "sc-p p-ffa", d: "M-5 0C-2 -3.4 2 3.4 5 0", style: "fill:none;stroke:#e89a3c;stroke-width:2" }, layers.parts));
const shutP = pool(12, dot("p-carn", 3.2));
const acetP = pool(12, dot("p-acet", 3));
const ketProdP = pool(12, dia("p-ket"));
const brainP = pool(10, dia("p-ket"));
const musP = pool(8, dia("p-ket"));
const gluTrP = pool(10, dot("p-gluc", 3));
const carnTrP = pool(8, dot("p-carn", 3));
const oxTrack = track([[337, 150], [377, 122], [417, 118], [457, 122], [497, 150], [457, 178], [417, 182], [377, 178], [337, 150]]);
const oxDots = Array.from({ length: 10 }, (_, i) => ({ e: dot("p-ffa", 2.8)(), u: i / 10 }));
const bloodKet = Array.from({ length: 22 }, () => ({ e: dia("p-ket")(), x: rnd(30, 930), r: rnd(-0.75, 0.75) }));
const bloodGlu = Array.from({ length: 20 }, () => ({ e: dot("p-gluc", 2.8)(), x: rnd(30, 930), r: rnd(-0.75, 0.75) }));
const bloodAcid = Array.from({ length: 14 }, () => ({ e: dot("p-acid", 2.4)(), x: rnd(30, 930), r: rnd(-0.75, 0.75) }));

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Whole body";
  [["lip", "Lipolysis", "g-lip", "Breakdown of stored fat in adipose tissue, releasing fatty acids. It is low after a meal and high when insulin is low."], ["ox", "Fat oxidation", "g-ox", "Beta-oxidation inside liver mitochondria: fatty acid chains are shortened step by step to acetyl-CoA. It needs the carnitine shuttle to get in."], ["ket", "Ketones", "g-ket", "Ketone bodies made by the liver when acetyl-CoA cannot all enter the energy cycle. They travel in blood to other tissues."], ["br", "Brain ketones", "g-brain", "Share of brain fuel coming from ketones. It rises in starvation so the brain needs less glucose and muscle protein is spared."], ["ac", "Acid load", "g-acid", "Ketone bodies are acids. In diabetic ketoacidosis they are made so fast that blood becomes acidic."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 140 + i * 170, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Fat store", 105, 155, 105, 92, "Fat store (triglyceride) inside a fat cell. When insulin falls, lipolysis breaks it down and fatty acids leave the cell.");
  pill(ox, "Carnitine shuttle", 292, 150, 360, 86, "Carnitine shuttle: fatty acyl-CoA cannot cross the mitochondrial membrane alone. CPT1 attaches carnitine, the chain crosses, and CPT2 restores it inside. A fed-state signal, malonyl-CoA, holds CPT1 back.");
  pill(ox, "Ketone making", 532, 138, 532, 86, "Ketone making: in liver mitochondria, acetyl-CoA units join through HMG-CoA to form acetoacetate and beta-hydroxybutyrate, which leave for the blood.");
  pill(ox, "Beta-oxidation", 417, 150, 415, 222, "Beta-oxidation: the fatty acid chain is shortened two carbons at a time, releasing acetyl-CoA each round. MCAD is one of the enzymes in this spiral.");
  pill(ox, "Ketones as fuel", 735, 95, 835, 70, "Brain using ketones: in starvation the brain converts ketones back to acetyl-CoA for energy, so it needs much less glucose.");
  pill(ox, "Muscle use", 786, 203, 845, 168, "Muscle and heart use fatty acids and ketones directly as fuel, sparing glucose for cells that must have it.");
  pill(ox, "Fatty acids", 180, CY, 180, 336, "Fatty acids in blood, carried bound to albumin from fat stores to the liver and muscle.");
  pill(ox, "Ketone bodies", 420, CY, 420, 336, "Ketone bodies in blood on their way from liver to brain, heart and muscle.");
  pill(ox, "Glucose", 90, 398, 90, 428, "Glucose given: provides fuel that does not need fat oxidation and, where insulin can act, switches off lipolysis and ketone making. In a fat-oxidation defect it can end a fasting crisis. On its own it does not correct diabetic ketoacidosis, which needs insulin and fluids.");
  pill(ox, "Carnitine", 214, 396, 215, 428, "Carnitine given: tops up the shuttle that carries fatty acids into mitochondria. It helps most when carnitine itself is short or its transport is faulty.");
}
const sm = { L: 0.4, B: 0.35, K: 0.25, Br: 0.2, Ac: 0.1, G: 0.4, O: 0.3, Sh: 0.6, glu: 0, carn: 0, defect: 0 };
const acc = { ffa: 0, shut: 0, acet: 0, ket: 0, brain: 0, mus: 0, glu: 0, carn: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.L = lerp(sm.L, m.L, k2); sm.B = lerp(sm.B, m.B, k2); sm.K = lerp(sm.K, m.K, k2); sm.Br = lerp(sm.Br, m.Br, k2); sm.Ac = lerp(sm.Ac, m.Ac, k2); sm.G = lerp(sm.G, m.G, k2); sm.O = lerp(sm.O, m.O, k2); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.glu = lerp(sm.glu, m.glu, k1); sm.carn = lerp(sm.carn, m.carn, k1); sm.defect = lerp(sm.defect, m.defect, k1);
  vac.setAttribute("r", f1(26 - 9 * sm.L * (1 - 0.4 * sm.defect)));
  place(fatCell, 105 + Math.sin(tm / 1700) * 1.5, 155, 0, 1);
  place(brainCell, 735, 95, 0, 1 + 0.10 * sm.Br * Math.sin(tm / 320));
  const openPx = sm.Sh * 5;
  gateL.setAttribute("x", f1(284 - openPx)); gateR.setAttribute("x", f1(293 + openPx));
  gateL.classList.toggle("open", sm.Sh > 0.5); gateR.classList.toggle("open", sm.Sh > 0.5);
  block1.setAttribute("opacity", (sm.defect * (1 - 0.55 * sm.carn)).toFixed(2));
  block2.setAttribute("opacity", sm.defect.toFixed(2));
  enzDots.forEach((d, i) => d.setAttribute("opacity", (0.25 + 0.75 * sm.B * (0.6 + 0.4 * Math.sin(tm / 300 + i * 1.1))).toFixed(2)));
  hmgDot.setAttribute("opacity", (0.25 + 0.75 * sm.K).toFixed(2));
  $("fateTca").setAttribute("width", f1(10 + 200 * sm.B * (1 - sm.O)));
  $("fateKet").setAttribute("width", f1(10 + 200 * sm.B * sm.O + 40 * sm.K * sm.O));
  $("kt-tr-g").style.opacity = (0.3 + 0.7 * sm.glu).toFixed(2);
  $("kt-tr-c").style.opacity = (0.3 + 0.7 * sm.carn).toFixed(2);
  /* fatty acids: fat cell to liver cytosol */
  acc.ffa += dt * sm.L * 5; while (acc.ffa >= 1) { acc.ffa--; const p = freeP(ffaP); if (p) emit(p, 152, 155 + rnd(-10, 10), 62, rnd(-4, 4), 0); }
  ffaP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.x > 272) killP(p); });
  /* carnitine shuttle into the mitochondrion */
  acc.shut += dt * sm.B * 4.5; while (acc.shut >= 1) { acc.shut--; const p = freeP(shutP); if (p) emit(p, 282, 150 + rnd(-8, 8), 52, 0, 0); }
  shutP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; atP(p); if (p.x > 356) killP(p); });
  /* beta-oxidation dots circulating the mitochondrion track */
  oxDots.forEach((d) => { d.u = (d.u + dt * 0.14 * sm.B) % 1; const a = oxTrack.at(d.u); d.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); d.e.setAttribute("opacity", sm.B > 0.06 ? "1" : "0.12"); });
  /* acetyl-CoA toward ketone making */
  acc.acet += dt * sm.B * 4; while (acc.acet >= 1) { acc.acet--; const p = freeP(acetP); if (p) emit(p, 462, 150 + rnd(-12, 12), 48, rnd(-5, 5), 0); }
  acetP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.x > 528) killP(p); });
  /* ketones leaving the liver for the blood */
  acc.ket += dt * sm.K * 4.5; while (acc.ket >= 1) { acc.ket--; const p = freeP(ketProdP); if (p) emit(p, 540 + rnd(-8, 8), 186, rnd(-4, 4), 52, 0); }
  ketProdP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.y > CY - 4) killP(p); });
  /* blood pools flowing left to right */
  const flow = 52;
  const wk = Math.round(sm.K * bloodKet.length), wg = Math.round(sm.G * bloodGlu.length), wa = Math.round(sm.Ac * bloodAcid.length);
  [[bloodKet, wk, 1], [bloodGlu, wg, 0.8], [bloodAcid, wa, 0.9]].forEach(([arr, want, sp]) => arr.forEach((p, i) => { const on = i < want; p.x += flow * sp * dt; if (p.x > 938) { p.x = 22; p.r = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * 18) + ")"); p.e.setAttribute("opacity", on ? "1" : "0"); }));
  /* brain and muscle taking up ketones from blood */
  acc.brain += dt * sm.Br * 3.4; while (acc.brain >= 1) { acc.brain--; const p = freeP(brainP); if (p) emit(p, 735 + rnd(-12, 12), CY - 30, 0, -58, 0); }
  brainP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; atP(p); if (p.y < 126) killP(p); });
  acc.mus += dt * (0.25 + 0.75 * sm.K) * sm.B * 2.2; while (acc.mus >= 1) { acc.mus--; const p = freeP(musP); if (p) emit(p, 820 + rnd(-16, 16), CY - 30, 0, -46, 0); }
  musP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; atP(p); if (p.y < 228) killP(p); });
  /* treatments */
  acc.glu += dt * sm.glu * 3.2; while (acc.glu >= 1) { acc.glu--; const p = freeP(gluTrP); if (p) emit(p, 90, 378, rnd(-4, 4), -52, 0); }
  gluTrP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.y < CY + 10) killP(p); });
  acc.carn += dt * sm.carn * 3; while (acc.carn >= 1) { acc.carn--; const p = freeP(carnTrP); if (p) { emit(p, 214, 380, 0, -46, 0); p.tx = 292; } }
  carnTrP.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y < CY + 8) { p.k = 1; p.y = CY; } } else if (p.k === 1) { p.x += 70 * dt; p.y -= 18 * dt; if (p.x >= p.tx) p.k = 2; } else { p.y -= 44 * dt; } atP(p); if (p.k === 2 && p.y < 168) killP(p); });
  gg.lip.set(sm.L, wordOf(sm.L, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.ox.set(sm.B, wordOf(sm.B, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.ket.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "present", "high"]));
  gg.br.set(sm.Br, wordOf(sm.Br, 0.25, 0.6, ["little", "some", "most"]));
  gg.ac.set(sm.Ac, wordOf(sm.Ac, 0.2, 0.5, ["low", "raised", "high"]));
}
run({ init, step });
