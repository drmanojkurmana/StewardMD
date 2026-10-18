/* Apoptosis scene: Fas signal to caspase 8, stress to BAX and BAK, cytochrome c, apoptosome and caspase 9, caspase 3, shrinkage, remains and quiet clearance. */
const layers = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CX = 470, CY = 265, RX = 270, RY = 160, MX = 350, MY = 315, AX = 455, AY = 330, PHX = 835, PHY = 265;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, slot: -1, j: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.slot = -1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.slot = -1; p.e.setAttribute("opacity", "0"); }
const fasl = pool(12, () => mk("path", { class: "sc-p p-fasl", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));
const stress = pool(12, () => mk("circle", { class: "sc-p p-stress", r: 2.6 }, layers.parts));
const cytc = pool(22, () => mk("circle", { class: "sc-p p-cytc", r: 2.4 }, layers.parts));
const sparks = pool(16, () => mk("circle", { class: "sc-p p-spark", r: 2 }, layers.parts));
const bodies = pool(10, () => { const g = mk("g", {}, layers.parts); mk("ellipse", { class: "ap-body", rx: 9, ry: 6.5 }, g); mk("circle", { class: "ap-body", r: 2.2, cx: -1, cy: -1 }, g); return g; });
const inhp = pool(10, () => mk("path", { class: "sc-p p-inh", d: "M0 -4.6L3.2 0L0 4.6L-3.2 0Z" }, layers.parts));
const survp = pool(10, () => mk("circle", { class: "sc-p p-surv", r: 3 }, layers.parts));
/* BCL-2 block centres on the mitochondrion rim: the blocker docks here. Survival docks on the membrane arc. */
const INH_SLOTS = [0, 1, 2, 3, 4].map((i) => [MX - 36 + i * 18 + 5.5, MY - 36.5]);
const SURV_DOCK = [-62, -52, -42, -33, -25].map((deg) => { const a = deg * Math.PI / 180; return [CX + RX * Math.cos(a), CY + RY * Math.sin(a)]; });
let cellG, execGlow, calmHalo, nucG, mitoG, phagG, apoptoG, casp8G, casp3G, capEl, blockPill, survPill;
const bclBlocks = [], baxPores = [], fasRecs = [];
const gg = {};
function caspNode(parent, x, y, cls) { const g = mk("g", {}, parent); mk("rect", { class: cls, x: -9, y: -9, width: 18, height: 18, rx: 4, transform: "rotate(45)" }, g); mk("circle", { class: cls, r: 3.4 }, g); place(g, x, y, 0, 1); return g; }
function capText(d, l) {
  if (d === 1) return l >= 2 ? "BCL-2 blocker frees BAX and BAK. The cell breaks apart faster." : l >= 1 ? "BCL-2 blocker frees BAX and BAK. The mitochondrion spills and death speeds up." : "BCL-2 blocker frees BAX and BAK. Even weak stress starts to kill the cell.";
  if (d === 2) return l >= 2 ? "Survival signal shields the mitochondrion and brakes caspase 8. Death slows but the cell still dies." : l >= 1 ? "Survival signal shields the mitochondrion and brakes caspase 8. The cell holds on." : "Survival signal shields the mitochondrion and brakes caspase 8. The cell survives.";
  return l >= 2 ? "No treatment. Both pathways fire hard and the cell breaks apart." : l >= 1 ? "No treatment. Both pathways switch on and the cell starts to die." : "No treatment. Weak signals. The cell holds together.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 290, 450, 610, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cell";
  [["intr", "Intrinsic", "g-fl", "Intrinsic or mitochondrial signal: stress acting through BAX and BAK and cytochrome c to caspase 9. A BCL-2 blocker raises it; a survival signal lowers it."], ["extr", "Extrinsic", "g-bad", "Extrinsic signal: Fas signal at its receptor switching on caspase 8. A survival signal brakes it."], ["c3", "Caspase 3", "g-cyt", "Executioner caspase 3: where both pathways converge. It condenses the nucleus, shrinks the cell and pinches off remains."], ["fate", "Cell fate", "g-bac", "Whether the cell holds together, is dying, or has broken into remains."], ["infl", "Inflammation", "g-good", "Inflammation stays low in apoptosis: remains are cleared quietly, unlike when a cell bursts."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Fas signal", 355, 112, 255, 70, "Fas signal outside docks on its receptor in the membrane. The clustered receptor switches on caspase 8 inside.");
  pill(ox, "Stress", 225, 265, 110, 225, "Damage and lost survival signals tip the BCL-2 family toward death and begin the mitochondrial pathway.");
  pill(ox, "Mitochondrion", 300, 320, 285, 400, "The mitochondrion. Freed BAX and BAK open its rim against the BCL-2 guards, and cytochrome c spills out.");
  pill(ox, "Caspase 9", 455, 330, 480, 400, "The apoptosome wheel. Cytochrome c gathered here switches on caspase 9, the intrinsic initiator.");
  pill(ox, "Caspase 3", 505, 205, 590, 130, "The executioner. Both pathways converge here. It condenses the nucleus, shrinks the cell and pinches off remains.");
  pill(ox, "Cleaner cell", 835, 240, 840, 380, "A scavenger cell. It engulfs the pinched off remains and digests them quietly, without inflammation.");
  blockPill = pill(ox, "BCL-2 blocker", 350, 278, 175, 335, "A blocker sits on each BCL-2 guard and lifts the brake, so BAX and BAK open the mitochondrion.");
  blockPill.style.opacity = "0";
  survPill = pill(ox, "Survival signal", 625, 134, 760, 170, "Survival signal docks on the membrane. It strengthens the BCL-2 guards and brakes caspase 8.");
  survPill.style.opacity = "0";
  capEl = mk("text", { class: "ap-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1);
}
function init() {
  const st = layers.stage;
  cellG = mk("g", {}, st);
  mk("ellipse", { class: "ap-cell", cx: CX, cy: CY, rx: RX, ry: RY }, cellG);
  execGlow = mk("ellipse", { class: "ap-exec", cx: CX, cy: CY, rx: RX * 0.88, ry: RY * 0.85, opacity: "0" }, cellG);
  calmHalo = mk("ellipse", { class: "ap-halo", cx: CX, cy: CY, rx: RX + 9, ry: RY + 9, opacity: "0" }, cellG);
  nucG = mk("g", {}, st); cell(nucG, { cls: "ap-nuc", r: 56, nuc: 0.48, seed: 7, wob: 0.08 }); place(nucG, 590, 310, 0, 1);
  mitoG = mk("g", {}, st);
  mk("ellipse", { class: "ap-mito", cx: MX, cy: MY, rx: 58, ry: 34 }, mitoG);
  mk("path", { class: "ap-fold", d: "M312 302q14 10 28 0t28 0M312 326q14 -10 28 0t28 0" }, mitoG);
  for (let i = 0; i < 5; i++) { const b = mk("rect", { class: "ap-bcl", x: MX - 36 + i * 18, y: MY - 40, width: 11, height: 7, rx: 2 }, mitoG); bclBlocks.push(b); }
  for (let i = 0; i < 4; i++) { const a = -0.7 + i * 0.45, px = MX + Math.cos(a) * 56, py = MY + Math.sin(a) * 32; const p = mk("circle", { class: "ap-pore", cx: f1(px), cy: f1(py), r: 4.2 }, mitoG); baxPores.push(p); }
  [338, 355, 372].forEach((x) => { const dy = RY * Math.sqrt(1 - Math.pow((x - CX) / RX, 2)), y = CY - dy, g = mk("g", {}, st); mk("path", { class: "ap-fas", d: "M" + x + " " + f1(y) + "l0 -13M" + x + " " + f1(y - 13) + "l-5 -6M" + x + " " + f1(y - 13) + "l5 -6" }, g); fasRecs.push(g); });
  casp8G = caspNode(st, 395, 185, "ap-casp8");
  apoptoG = mk("g", {}, st);
  mk("circle", { class: "ap-wheel", cx: AX, cy: AY, r: 17 }, apoptoG);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283; mk("path", { class: "ap-spoke", d: "M" + AX + " " + AY + "L" + f1(AX + Math.cos(a) * 17) + " " + f1(AY + Math.sin(a) * 17) }, apoptoG); }
  mk("circle", { class: "ap-casp", cx: AX, cy: AY, r: 4.5 }, apoptoG);
  casp3G = caspNode(st, 505, 205, "ap-casp");
  phagG = mk("g", {}, st); cell(phagG, { cls: "mac", r: 48, nuc: 0.4, seed: 11, wob: 0.13 }); place(phagG, PHX, PHY, 0, 1);
  initPanel();
}
const sm = { I: 0.25, E: 0.3, C3: 0.3, A: 0.3, bcl: 0.55, inh: 0, surv: 0 };
const acc = { fasl: 0, stress: 0, cytc: 0, spark: 0, body: 0, inh: 0, surv: 0 };
let capKey = "";
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.I = lerp(sm.I, m.I, k); sm.E = lerp(sm.E, m.E, k); sm.C3 = lerp(sm.C3, m.C3, k); sm.A = lerp(sm.A, m.A, k); sm.bcl = lerp(sm.bcl, m.bcl, k);
  sm.inh = lerp(sm.inh, m.inh, k); sm.surv = lerp(sm.surv, m.surv, k);
  const shrink = 1 - 0.15 * sm.A;
  cellG.setAttribute("transform", "translate(" + CX + " " + CY + ") scale(" + shrink.toFixed(3) + ") translate(" + (-CX) + " " + (-CY) + ")");
  execGlow.setAttribute("opacity", (0.45 * sm.C3).toFixed(2));
  calmHalo.setAttribute("opacity", (0.55 * sm.surv).toFixed(2));
  place(nucG, 590, 310, 0, 1 - 0.32 * sm.A); nucG.style.opacity = (1 - 0.35 * sm.A).toFixed(2);
  bclBlocks.forEach((b) => b.setAttribute("opacity", (0.15 + 0.85 * sm.bcl).toFixed(2)));
  baxPores.forEach((p) => { p.setAttribute("opacity", (0.08 + 0.92 * sm.I).toFixed(2)); p.setAttribute("r", (1.5 + 3 * sm.I).toFixed(2)); });
  fasRecs.forEach((g) => g.setAttribute("opacity", (0.35 + 0.65 * sm.E).toFixed(2)));
  place(casp8G, 395, 185, Math.sin(tm / 300) * 8, 1 + 0.22 * sm.E * Math.sin(tm / 180));
  apoptoG.setAttribute("transform", "rotate(" + f1((tm / 24) % 360) + " " + AX + " " + AY + ")"); apoptoG.setAttribute("opacity", (0.3 + 0.7 * sm.I).toFixed(2));
  place(casp3G, 505, 205, Math.sin(tm / 260) * 10, 1 + 0.25 * sm.C3 * Math.sin(tm / 150));
  const phagX = PHX - 55 * sm.A;
  place(phagG, phagX + Math.sin(tm / 1400) * 3, PHY + Math.cos(tm / 1700) * 3, Math.sin(tm / 2200) * 5, 1 + 0.06 * sm.A);
  acc.fasl += dt * sm.E * 4.5 * (1 - 0.55 * sm.surv); while (acc.fasl >= 1) { acc.fasl--; const p = free(fasl); if (p) emit(p, 350 + rnd(-9, 9), 60, 0, 52, 0); }
  fasl.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 4 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 118) kill(p); });
  acc.stress += dt * (0.25 + sm.I) * 3.6; while (acc.stress >= 1) { acc.stress--; const p = free(stress); if (p) emit(p, 232, rnd(238, 282), 46, rnd(8, 22), 0); }
  stress.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 302) kill(p); });
  acc.cytc += dt * sm.I * 11; while (acc.cytc >= 1) { acc.cytc--; const p = free(cytc); if (p) emit(p, MX + rnd(18, 44), MY + rnd(-8, 14), rnd(24, 40), rnd(4, 16), 0); }
  cytc.forEach((p) => { if (!p.on) return; const dx = AX - p.x, dy = AY - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 44 * dt; p.y += (dy / d) * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 19) kill(p); });
  acc.spark += dt * sm.C3 * 8; while (acc.spark >= 1) { acc.spark--; const p = free(sparks); if (p) emit(p, 505, 205, rnd(-34, 34), rnd(-26, 30), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1 || p.x < 225 || p.x > 715 || p.y < 125 || p.y > 405) kill(p); });
  acc.body += dt * sm.A * 1.7; while (acc.body >= 1) { acc.body--; const p = free(bodies); if (p) emit(p, 712, rnd(232, 298), rnd(26, 40), rnd(-7, 7), 0); }
  bodies.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 350 + p.x) * 3 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); if (p.x > phagX - 44) kill(p); });
  /* blocker flies in from above and sits on a BCL-2 guard; it leaves when the drug stops */
  if (sm.inh < 0.4) inhp.forEach((p) => { if (p.on) kill(p); });
  else { acc.inh += dt * sm.inh * 3.2; while (acc.inh >= 1) { acc.inh--; const p = free(inhp); if (p) { const taken = inhp.filter((q) => q.on && q.st === 1).map((q) => q.slot); const s = INH_SLOTS.findIndex((_, i) => taken.indexOf(i) < 0); if (s < 0) continue; emit(p, 320 + rnd(-30, 40), 55, 0, 60, 0); p.slot = s; p.st = 0; p.j = rnd(0, 6.28); } } }
  inhp.forEach((p) => { if (!p.on || sm.inh < 0.4) return; if (p.st === 1) { place(p.e, INH_SLOTS[p.slot][0], INH_SLOTS[p.slot][1] + Math.sin(tm / 500 + p.j) * 1, 0, 1); return; }
    const s = INH_SLOTS[p.slot], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 70 * dt; p.y += (dy / d) * 70 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 6) { p.st = 1; p.x = s[0]; p.y = s[1]; } });
  /* survival signal rains onto the membrane arc, docks briefly, then is absorbed */
  acc.surv += dt * sm.surv * 3.2; while (acc.surv >= 1) { acc.surv--; const p = free(survp); if (p) { const s = Math.floor(Math.random() * SURV_DOCK.length); emit(p, 600 + rnd(0, 80), 55, 0, 60, 0); p.slot = s; p.j = rnd(0, 6.28); } }
  survp.forEach((p) => { if (!p.on) return; if (p.st === 1) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.4).toFixed(2)); if (p.t > 0.4) kill(p); return; }
    const s = SURV_DOCK[p.slot], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 80 * dt; p.y += (dy / d) * 80 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 7) { p.st = 1; p.t = 0; } });
  gg.intr.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "active", "high"])); gg.extr.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["low", "active", "high"]));
  gg.c3.set(sm.C3, wordOf(sm.C3, 0.3, 0.6, ["low", "active", "high"])); gg.fate.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["surviving", "dying", "fragmenting"])); gg.infl.set(m.Infl, wordOf(m.Infl, 0.3, 0.6, ["low", "active", "high"]));
  blockPill.style.opacity = sm.inh.toFixed(2); survPill.style.opacity = sm.surv.toFixed(2);
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
