/* Acute lymphoblastic leukaemia scene, left to right: marrow clone crowds blood making,
 * brain and testis shelters hide blasts behind barriers, chest lump grows in T lineage disease.
 * Chemo capsules kill marrow blasts, CNS cover crosses into the shelters, and a targeted
 * blocker docks on the driver change so its growth signal fades while donor cells rebuild. */
const layers = { stage: $("stage"), over: $("over"), panel: $("panel"), health: $("healthLay"), crowd: $("crowdLay") };
let vesselO = null, brainO = null, testisO = null, capEl = null, capDrug = -1, capLevel = -1, treatDrug = -1, treatLevel = -1;
const FUS = [262, 168], CROWD = [410, 235], BRAIN = [825, 140], TESTIS = [825, 250], MASS = [825, 340];
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- fixed cells ---- */
const riskCells = [[110, 190], [110, 252]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "risk", r: 18, nuc: 0.42, seed: i * 3 + 1, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const progs = [[205, 300], [242, 328], [168, 328]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "prog2", r: 12, nuc: 0.4, seed: i * 2 + 5, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
function grid(n, x0, y0, dx, dy, cols) { return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * dx + ((i * 37) % 13) - 6, y: y0 + Math.floor(i / cols) * dy + ((i * 53) % 11) - 5, s: 0 })); }
const blasts = grid(28, 300, 120, 36, 52, 6).map((p, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "lyb", r: 14, nuc: 0.6, seed: i + 2, wob: 0.09 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const chrG = mk("g", {}, layers.stage);
mk("rect", { class: "all-chrA", x: 232, y: 148, width: 10, height: 42, rx: 5 }, chrG);
mk("rect", { class: "all-chrB", x: 254, y: 148, width: 10, height: 42, rx: 5 }, chrG);
mk("rect", { class: "all-fus", x: 276, y: 156, width: 10, height: 34, rx: 5 }, chrG);
mk("path", { d: "M268 168H272", stroke: "var(--anatomy-mid)", "stroke-width": 1.6 }, chrG);
const receptors = [[296, 158], [296, 176], [262, 148]].map(([x, y]) => {
  const e = mk("circle", { class: "all-rec", cx: x, cy: y, r: 5 }, layers.stage);
  const dot = mk("circle", { class: "sc-p p-tgt", cx: x, cy: y, r: 3, opacity: "0" }, layers.stage);
  return { e, dot, x, y };
});
const barB = mk("ellipse", { class: "all-barrier", cx: BRAIN[0], cy: BRAIN[1], rx: 80, ry: 48 }, layers.stage);
const barT = mk("ellipse", { class: "all-barrier", cx: TESTIS[0], cy: TESTIS[1], rx: 70, ry: 42 }, layers.stage);
const massG = mk("g", {}, layers.stage); cell(massG, { cls: "sm", r: 22, nuc: 0.3, seed: 7, wob: 0.12 });
const cnsBlasts = [[805, 136], [825, 144], [845, 136], [815, 132], [838, 146]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "lyb", r: 6, nuc: 0.6, seed: i + 40, wob: 0.08 }); place(g, x, y, 0, 1); return { g, x, y, s: 0 }; });
const testBlasts = [[808, 248], [825, 254], [842, 248], [818, 246]].map(([x, y], i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "lyb", r: 6, nuc: 0.6, seed: i + 60, wob: 0.08 }); place(g, x, y, 0, 1); return { g, x, y, s: 0 }; });
const vesselRbcs = Array.from({ length: 10 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, layers.stage); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { g, x: 602 + (i % 3) * 16, y: 130 + i * 23, v: 0.8 + (i % 4) * 0.15 }; });
const vesselPlts = Array.from({ length: 6 }, (_, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "plt", r: 5, seed: i + 90, wob: 0.15, n: 7 }); return { g, x: 606 + (i % 2) * 30, y: 134 + i * 36, v: 0.6 }; });
const vesselNeus = Array.from({ length: 4 }, (_, i) => { const g = mk("g", {}, layers.stage); cell(g, { cls: "neut", r: 9, nuc: 0.55, nucCls: "multi", seed: i + 70, wob: 0.12 }); return { g, x: 610 + (i % 2) * 24, y: 150 + i * 52, v: 0.5 }; });
/* particles */
const divs = mkPool(16, () => mk("circle", { class: "sc-p p-div", r: 2.2 }, layers.stage));
const chemos = mkPool(8, () => { const g = mk("g", {}, layers.stage); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const cnsDots = mkPool(10, () => mk("circle", { class: "sc-p p-cns", r: 2.6 }, layers.stage));
const tgts = mkPool(10, () => mk("circle", { class: "sc-p p-tgt", r: 2.6 }, layers.stage));
const sigs = mkPool(12, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, layers.stage));
const donors = mkPool(8, () => { const g = mk("g", {}, layers.stage); cell(g, { cls: "donor", r: 8, nuc: 0.42, seed: 5, wob: 0.1 }); return g; });
function initOrgans() {
  vesselO = organ($("vesselSlot"), "vessel", 625, 240, 90, { h: 230 });
  brainO = organ($("brainSlot"), "brain", 825, 140, 150, {});
  testisO = organ($("testisSlot"), "testis", 825, 250, 110, {});
}
function capText(d, l) {
  if (d === 1) return "Chemo kills marrow blasts. Blood counts recover but shelters can remain.";
  if (d === 2) return "CNS cover reaches brain and testis. Sheltered blasts clear.";
  if (d === 3) return "Targeted blocker sits on the driver. Blasts and lump shrink.";
  if (l === 0) return "No treatment in quiet disease. Few blasts and healthy blood.";
  if (l === 1) return "No treatment. Blasts growing and blood counts falling.";
  return "No treatment. Blasts fill the marrow and hide in shelters.";
}
/* one treatment pill whose words and anchor follow the chosen treatment */
let treatG = null, treatDot = null, treatLeader = null;
function treatWords(d) {
  if (d === 1) return ["Chemo kills marrow blasts", "Induction chemo kills dividing blasts in the marrow. Blood recovers but shelters can remain.", CROWD[0], CROWD[1]];
  if (d === 2) return ["CNS cover clears shelters", "CNS cover crosses into brain and testis and clears sheltered blasts.", BRAIN[0], BRAIN[1]];
  if (d === 3) return ["Blocker stops the driver", "Targeted blocker sits on the driver change. The growth signal fades. Transplant rebuilds the marrow.", FUS[0], FUS[1]];
  return ["", "", 0, 0];
}
function pillText(g, s) { const t = g.querySelector("text"); if (t && t.textContent !== s) t.textContent = s; }
function initLabels() {
  const o = layers.over;
  pill(o, "At risk cell", 110, 190, 110, 40, "A lymphoid maker cell at risk. An early change can prime it, but more hits are needed before leukaemia grows.");
  pill(o, "Driver change", FUS[0], FUS[1], 262, 40, "Driver change: a fusion gene or mutation that blocks maturation and drives growth. The targeted blocker docks here.");
  pill(o, "Blast crowd", 410, 200, 410, 40, "Blast crowd: one clone expands as blasts with large nuclei. They fill the marrow instead of maturing.");
  pill(o, "Blood", 625, 250, 620, 392, "Blood leaving the crowded marrow. Low red cells cause tiredness, low neutrophils allow infection, low platelets cause bleeding.");
  pill(o, "Brain shelter", BRAIN[0], BRAIN[1], 825, 40, "Brain shelter: blasts behind the blood brain barrier. Many drugs cross poorly, so seated blasts can survive.");
  pill(o, "Testis shelter", TESTIS[0], TESTIS[1], 890, 250, "Testis shelter: blasts behind the blood testis barrier. Another refuge where blasts can persist.");
  pill(o, "Chest lump", MASS[0], MASS[1], 825, 392, "Chest lump: a thymus mass seen mainly in T lineage disease. It can press on airway and large veins.");
  treatG = pill(o, "Chemo kills marrow blasts", CROWD[0], CROWD[1], 250, 392, "Treatment action.");
  treatDot = treatG.querySelector("circle"); treatLeader = treatG.querySelector("path");
  treatG.style.display = "none";
  capEl = mk("text", { class: "all-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, 2);
}
/* gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, xs = [90, 230, 370, 510, 650, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Marrow, shelters and blood";
  [["clone", "Lymphoblasts", "g-bad", "How much of the marrow is taken over by lymphoblasts. High means normal making is replaced."], ["sanc", "Sanctuary", "g-sanc", "Blasts sheltered in brain and testis. They can survive treatment and seed relapse."], ["med", "Chest lump", "g-med", "Thymus mass in mainly T lineage disease. Larger lumps can press on chest structures."], ["red", "Red cells", "g-rbc", "Red cells carry oxygen. When they fall the patient is pale, tired and breathless."], ["neut", "Neutrophils", "g-neu", "Neutrophils fight bacterial infection. When they fall, infection becomes likely."], ["plt", "Platelets", "g-clot", "Platelets help blood clot. When they fall, bruising and bleeding follow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { clone: 0.8, sanc: 0.6, med: 0.5, red: 0.3, neut: 0.2, plt: 0.2, blocked: 0, cns: 0 };
const acc = { div: 0, sig: 0, chemo: 0, cns: 0, tgt: 0, donor: 0 };
let donorSlot = 0;
function setFixed(pool, n, dt, bob) { pool.forEach((c, i) => { const want = i < n ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2.2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * bob, c.y + Math.cos(tm / 900 + i) * bob, Math.sin(tm / 800 + i) * 6, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; }); }
function init() { initOrgans(); initLabels(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.clone = lerp(sm.clone, m.clone, k); sm.sanc = lerp(sm.sanc, m.sanc, k); sm.med = lerp(sm.med, m.med, k);
  sm.red = lerp(sm.red, m.red, k); sm.neut = lerp(sm.neut, m.neut, k); sm.plt = lerp(sm.plt, m.plt, k);
  sm.blocked = lerp(sm.blocked, m.drug === 3 ? 1 : 0, Math.min(1, dt * 2));
  sm.cns = lerp(sm.cns, m.drug === 2 ? 1 : 0, Math.min(1, dt * 2));
  layers.health.setAttribute("opacity", (clamp(sm.red + sm.neut + sm.plt) / 3 * 0.35).toFixed(2));
  layers.crowd.setAttribute("opacity", (sm.clone * 0.38).toFixed(2));
  riskCells.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, 1 + 0.04 * Math.sin(tm / 300 + i)));
  progs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 700 + i) * 2, Math.sin(tm / 900 + i) * 8, Math.max(0.25, 1 - 0.7 * sm.clone)));
  chrG.setAttribute("opacity", (0.35 + 0.65 * sm.clone).toFixed(2));
  receptors.forEach((r) => { r.dot.setAttribute("opacity", sm.blocked.toFixed(2)); });
  barB.setAttribute("opacity", (0.9 - 0.55 * sm.cns).toFixed(2));
  barT.setAttribute("opacity", (0.9 - 0.55 * sm.cns).toFixed(2));
  setFixed(blasts, Math.round(sm.clone * 28), dt, 1.6);
  setFixed(cnsBlasts, Math.round(sm.sanc * 5), dt, 0.7);
  setFixed(testBlasts, Math.round(sm.sanc * 4), dt, 0.7);
  place(massG, MASS[0], MASS[1], Math.sin(tm / 900) * 4, Math.max(0.08, 0.15 + 0.85 * sm.med)); massG.style.opacity = sm.med > 0.03 ? 1 : 0;
  vesselRbcs.forEach((r, i) => { r.y += r.v * 24 * (0.3 + sm.red) * dt; if (r.y > 360) { r.y = 130; r.x = 602 + Math.floor(rnd(0, 3)) * 16; } place(r.g, r.x, r.y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = i < Math.round(sm.red * 10) ? 1 : 0; });
  vesselPlts.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 360) r.y = 134; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.plt * 6) ? 1 : 0; });
  vesselNeus.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 360) r.y = 140; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.neut * 4) ? 1 : 0; });
  acc.div += dt * sm.clone * 5; while (acc.div >= 1) { acc.div--; const p = freeP(divs); if (p) emit(p, rnd(310, 500), rnd(130, 330), rnd(-12, 12), rnd(-12, 12), 0); }
  divs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 24, 564); p.y = clamp(p.y, 66, 406); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.sig += dt * sm.clone * (1 - sm.blocked) * 7; while (acc.sig >= 1) { acc.sig--; const p = freeP(sigs); if (p) emit(p, FUS[0] + 16, FUS[1] + rnd(-14, 14), 0, 0, 0); }
  sigs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (CROWD[0] - p.x) * dt * 1.1; p.y += (CROWD[1] - p.y) * dt * 1.1; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.8) / 0.8).toFixed(2)); if (p.t > 2.6) kill(p); });
  acc.chemo += dt * (m.drug === 1 ? 2.2 : 0); while (acc.chemo >= 1) { acc.chemo--; const p = freeP(chemos); if (p) emit(p, rnd(180, 280), rnd(140, 260), 0, 0, 0); }
  chemos.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (CROWD[0] - p.x) * dt * 0.6 + 14 * dt; p.y += (CROWD[1] - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2)); if (p.t > 4.7) kill(p); });
  acc.cns += dt * (m.drug === 2 ? 4 : 0); while (acc.cns >= 1) { acc.cns--; const p = freeP(cnsDots); if (p) { const aim = Math.random() < 0.5 ? BRAIN : TESTIS; emit(p, 676, aim[1] + rnd(-30, 30), 0, 0, 0); p.tx = aim[0]; p.ty = aim[1]; } }
  cnsDots.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.4; p.y += (p.ty - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 12 || p.t > 3) kill(p); });
  acc.tgt += dt * (m.drug === 3 ? 4 : 0); while (acc.tgt >= 1) { acc.tgt--; const p = freeP(tgts); if (p) emit(p, rnd(340, 440), rnd(220, 320), 0, 0, 0); }
  tgts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (FUS[0] + 16 - p.x) * dt * 1.4; p.y += (FUS[1] - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(FUS[0] + 16 - p.x, FUS[1] - p.y) < 12 || p.t > 3) kill(p); });
  acc.donor += dt * (m.drug === 3 ? 2 : 0); while (acc.donor >= 1) { acc.donor--; const p = freeP(donors); if (p) { const s = riskCells[donorSlot % riskCells.length]; donorSlot++; emit(p, 30, rnd(150, 350), 0, 0, 0); p.tx = s.x; p.ty = s.y; } }
  donors.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 1.2; p.y += (p.ty - p.y) * dt * 1.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 10 || p.t > 4) kill(p); });
  if (drug !== treatDrug || level !== treatLevel) {
    treatDrug = drug; treatLevel = level;
    const tw = treatWords(drug);
    treatG.style.display = drug === 0 ? "none" : "";
    if (drug !== 0) {
      pillText(treatG, tw[0]); treatG.setAttribute("data-info", tw[1]);
      treatDot.setAttribute("cx", f1(tw[2])); treatDot.setAttribute("cy", f1(tw[3]));
      treatLeader.setAttribute("d", "M" + f1(tw[2]) + " " + f1(tw[3]) + "L250 400");
    }
  }
  gg.clone.set(sm.clone, wordOf(sm.clone, 0.25, 0.6, ["cleared", "present", "high"])); gg.sanc.set(sm.sanc, wordOf(sm.sanc, 0.22, 0.55, ["cleared", "present", "seated"]));
  gg.med.set(sm.med, wordOf(sm.med, 0.2, 0.5, ["none", "small", "large"])); gg.red.set(sm.red, wordOf(sm.red, 0.35, 0.65, ["low", "reduced", "normal"]));
  gg.neut.set(sm.neut, wordOf(sm.neut, 0.35, 0.65, ["low", "reduced", "normal"])); gg.plt.set(sm.plt, wordOf(sm.plt, 0.35, 0.65, ["low", "reduced", "normal"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
