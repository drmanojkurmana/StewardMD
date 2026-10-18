/* Ketogenesis scene: fat store, liver furnace with carnitine gate, ketones to brain and muscle. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), tr: $("tr"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const atP = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts);

/* ---- organs and anchor points (derived from the real art, hepenc style) ---- */
let liverO = null, brainO = null, muscO = null;
let entry = { x: 330, y: 178 }, gatePt = { x: 345, y: 150 }, mitoC = { x: 430, y: 150 }, exitPt = { x: 490, y: 220 };
let oxTrack = null;
function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 417, 148, 210, {});
  brainO = organ($("brainSlot"), "brain", 735, 98, 110, {});
  muscO = organ($("muscSlot"), "muscle", 800, 200, 210, {});
  entry = { x: liverO.x - 87, y: liverO.y + 30 };
  gatePt = { x: liverO.x - 72, y: liverO.y + 2 };
  mitoC = { x: liverO.x + 13, y: liverO.y + 2 };
  exitPt = { x: liverO.x + 73, y: liverO.y + 72 };
  $("vFFA").setAttribute("d", "M205 190C250 196 292 190 " + f1(entry.x) + " " + f1(entry.y));
  const cp = brainO.ports.carotid || [698, 120];
  $("vBrain").setAttribute("d", "M" + f1(cp[0]) + " 256L" + f1(cp[0]) + " " + f1(cp[1] + 12));
  const mx = mitoC.x, my = mitoC.y;
  oxTrack = track([[mx - 55, my], [mx - 25, my - 22], [mx + 5, my - 26], [mx + 35, my - 22], [mx + 60, my], [mx + 35, my + 22], [mx + 5, my + 26], [mx - 25, my + 22], [mx - 55, my]]);
}

/* ---- fat store cell ---- */
const fatCell = cell(layers.cells, { cls: "fat", r: 44, seed: 7, wob: 0.07, x: 105, y: 155 });
const vac = mk("circle", { cx: 105, cy: 155, r: 26, style: "fill:#fff3c0;stroke:#d9b44a;stroke-width:1" }, layers.cells);

/* ---- in stage caption ---- */
let capEl = null, capKey = -1;
const LV = [
  "After a meal the body burns sugar and makes almost no ketones.",
  "Short fasting releases fat and the liver makes some ketones for fuel.",
  "Long fasting turns fat into much ketone fuel that feeds the brain.",
  "Without insulin, ketone acids flood the blood and it turns acidic.",
  "The shuttle is broken, so fat cannot enter the furnace and ketones stay low.",
];
function capText(lv, d) {
  if (d === 1) return "Glucose gives easy fuel. Fat release slows and ketone making falls." + (lv === 3 ? " It cannot fix DKA alone." : lv === 4 ? " The broken shuttle stays broken." : "") + " " + LV[lv];
  if (d === 2) return "Extra carnitine tops up the shuttle." + (lv === 4 ? " Fat burning partly restarts." : " The shuttle was already open, so little changes.") + " " + LV[lv];
  return "No treatment. " + LV[lv];
}

/* ---- pools ---- */
const ffaP = pool(14, () => mk("path", { class: "sc-p p-ffa", d: "M-5 0C-2 -3.4 2 3.4 5 0", style: "fill:none;stroke:#e89a3c;stroke-width:2" }, layers.parts));
const shutP = pool(12, dot("p-carn", 3.2));
const acetP = pool(12, dot("p-acet", 3));
const ketProdP = pool(12, dia("p-ket"));
const brainP = pool(10, dia("p-ket"));
const musP = pool(8, dia("p-ket"));
const gluTrP = pool(10, dot("p-gluc", 3));
const carnTrP = pool(8, dot("p-carn", 3));
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
  pill(ox, "Fat store", 105, 155, 105, 92, "Stored fat in adipose tissue. When fuel runs low, lipolysis releases fatty acids into blood.");
  pill(ox, "Liver", 450, 95, 545, 70, "The liver takes up fatty acids and burns them. In fasting it turns the leftovers into ketones.");
  pill(ox, "Shuttle", 345, 150, 360, 86, "Carnitine shuttle. It carries fatty chains into mitochondria. A fed signal brakes it shut.");
  pill(ox, "Ketones", 512, 150, 600, 120, "Ketone making. When sugar is scarce, acetyl fragments join into ketones that leave in blood.");
  pill(ox, "Brain", 745, 80, 845, 70, "The brain cannot burn fat, but it can burn ketones. Ketone use spares sugar and muscle.");
  pill(ox, "Muscle", 800, 185, 845, 168, "Muscle and heart burn fatty acids and ketones directly as fuel.");
  pill(ox, "Glucose", 90, 398, 90, 430, "Glucose gives fuel that needs no fat burning. It slows fat release and ketone making. It cannot fix DKA alone.");
  pill(ox, "Carnitine", 214, 398, 215, 430, "Carnitine tops up the shuttle. It helps most when the shuttle itself is faulty.");
  capEl = mk("text", { class: "kt-cap", x: 30, y: 366 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { L: 0.4, B: 0.35, K: 0.25, Br: 0.2, Ac: 0.1, G: 0.4, O: 0.3, Sh: 0.6, glu: 0, carn: 0, defect: 0 };
const acc = { ffa: 0, shut: 0, acet: 0, ket: 0, brain: 0, mus: 0, glu: 0, carn: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.L = lerp(sm.L, m.L, k2); sm.B = lerp(sm.B, m.B, k2); sm.K = lerp(sm.K, m.K, k2); sm.Br = lerp(sm.Br, m.Br, k2); sm.Ac = lerp(sm.Ac, m.Ac, k2); sm.G = lerp(sm.G, m.G, k2); sm.O = lerp(sm.O, m.O, k2); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.glu = lerp(sm.glu, m.glu, k1); sm.carn = lerp(sm.carn, m.carn, k1); sm.defect = lerp(sm.defect, m.defect, k1);
  vac.setAttribute("r", f1(26 - 9 * sm.L * (1 - 0.4 * sm.defect)));
  place(fatCell, 105 + Math.sin(tm / 1700) * 1.5, 155, 0, 1);
  $("fedGlow").setAttribute("opacity", (0.38 * sm.glu).toFixed(2));
  $("brake").setAttribute("opacity", sm.glu.toFixed(2));
  $("brainGlow").setAttribute("opacity", (0.4 * sm.Br).toFixed(2));
  $("musGlow").setAttribute("opacity", (0.3 * sm.K).toFixed(2));
  const openPx = sm.Sh * 5;
  $("gateL").setAttribute("x", f1(338 - openPx)); $("gateR").setAttribute("x", f1(347 + openPx));
  $("gateL").classList.toggle("open", sm.Sh > 0.5); $("gateR").classList.toggle("open", sm.Sh > 0.5);
  $("block1").setAttribute("opacity", (sm.defect * (1 - 0.55 * sm.carn)).toFixed(2));
  $("block2").setAttribute("opacity", sm.defect.toFixed(2));
  Array.from($("enz").childNodes).forEach((d, i) => d.setAttribute("opacity", (0.25 + 0.75 * sm.B * (0.6 + 0.4 * Math.sin(tm / 300 + i * 1.1))).toFixed(2)));
  $("hmg").setAttribute("opacity", (0.25 + 0.75 * sm.K).toFixed(2));
  $("kt-tr-g").style.opacity = (0.3 + 0.7 * sm.glu).toFixed(2);
  $("kt-tr-c").style.opacity = (0.3 + 0.7 * sm.carn).toFixed(2);
  /* fatty acids: fat cell along the vessel into the liver */
  acc.ffa += dt * sm.L * 5; while (acc.ffa >= 1) { acc.ffa--; const p = freeP(ffaP); if (p) emit(p, 152, 155 + rnd(-10, 10), 62, rnd(-4, 4), 0); }
  ffaP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + (entry.y - p.y) * Math.min(1, dt * 1.5); atP(p); if (p.x >= entry.x) killP(p); });
  /* carnitine shuttle: through the gate into the furnace */
  acc.shut += dt * sm.B * 4.5; while (acc.shut >= 1) { acc.shut--; const p = freeP(shutP); if (p) emit(p, entry.x, entry.y + rnd(-8, 8), 40, 0, 0); }
  shutP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += (gatePt.y - p.y) * Math.min(1, dt * 2); atP(p); if (p.x > mitoC.x - 55) killP(p); });
  /* beta-oxidation dots circulating the furnace track */
  oxDots.forEach((d) => { d.u = (d.u + dt * 0.14 * sm.B) % 1; const a = oxTrack.at(d.u); d.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); d.e.setAttribute("opacity", sm.B > 0.06 ? "1" : "0.12"); });
  /* acetyl fragments toward ketone making */
  acc.acet += dt * sm.B * 4; while (acc.acet >= 1) { acc.acet--; const p = freeP(acetP); if (p) emit(p, mitoC.x + 48, mitoC.y + rnd(-12, 12), 40, rnd(-5, 5), 0); }
  acetP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.x > mitoC.x + 78) killP(p); });
  /* ketones leaving the liver for the blood */
  acc.ket += dt * sm.K * 4.5; while (acc.ket >= 1) { acc.ket--; const p = freeP(ketProdP); if (p) emit(p, exitPt.x + rnd(-8, 8), exitPt.y, rnd(-4, 4), 52, 0); }
  ketProdP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.y > CY - 4) killP(p); });
  /* blood pools flowing left to right */
  const flow = 52;
  const wk = Math.round(sm.K * bloodKet.length), wg = Math.round(sm.G * bloodGlu.length), wa = Math.round(sm.Ac * bloodAcid.length);
  [[bloodKet, wk, 1], [bloodGlu, wg, 0.8], [bloodAcid, wa, 0.9]].forEach(([arr, want, sp]) => arr.forEach((p, i) => { const on = i < want; p.x += flow * sp * dt; if (p.x > 938) { p.x = 22; p.r = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * 18) + ")"); p.e.setAttribute("opacity", on ? "1" : "0"); }));
  /* brain and muscle taking up ketones from blood */
  acc.brain += dt * sm.Br * 3.4; while (acc.brain >= 1) { acc.brain--; const p = freeP(brainP); if (p) emit(p, brainO.x + rnd(-12, 12), CY - 30, 0, -58, 0); }
  brainP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; atP(p); if (p.y < brainO.y + 37) killP(p); });
  acc.mus += dt * (0.25 + 0.75 * sm.K) * sm.B * 2.2; while (acc.mus >= 1) { acc.mus--; const p = freeP(musP); if (p) emit(p, muscO.x + rnd(-16, 16), CY - 30, 0, -46, 0); }
  musP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; atP(p); if (p.y < muscO.y + 15) killP(p); });
  /* treatments: glucose rises into blood, carnitine travels to the gate */
  acc.glu += dt * sm.glu * 3.2; while (acc.glu >= 1) { acc.glu--; const p = freeP(gluTrP); if (p) emit(p, 90, 378, rnd(-4, 4), -52, 0); }
  gluTrP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; atP(p); if (p.y < CY + 10) killP(p); });
  acc.carn += dt * sm.carn * 3; while (acc.carn >= 1) { acc.carn--; const p = freeP(carnTrP); if (p) emit(p, 214, 380, 0, -46, 0); }
  carnTrP.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y < CY + 8) p.k = 1; } else { const dx = gatePt.x - p.x, dy = gatePt.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += dx / d * 95 * dt; p.y += dy / d * 95 * dt; if (d < 9) killP(p); } atP(p); });
  gg.lip.set(sm.L, wordOf(sm.L, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.ox.set(sm.B, wordOf(sm.B, 0.3, 0.65, ["low", "moderate", "high"]));
  gg.ket.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "present", "high"]));
  gg.br.set(sm.Br, wordOf(sm.Br, 0.25, 0.6, ["little", "some", "most"]));
  gg.ac.set(sm.Ac, wordOf(sm.Ac, 0.2, 0.5, ["low", "raised", "high"]));
  const key = level * 4 + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
