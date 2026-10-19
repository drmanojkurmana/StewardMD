/* Obesity scene: stomach intake, fat cells, leptin and hunger signals, macrophages,
 * fatty acids to liver, muscle and vessel. Treatments act on the drawing: lifestyle
 * sends help to the stomach and thins the food stream, GLP-1 drug docks on brain
 * receptors and fades hunger, surgery bands the stomach pouch. */
const WW = SC.W;
const layers = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
let stomachO = null, brainO = null, liverO = null, muscleO = null, vesselO = null;
let capEl = null, capDrug = -1;
let trFood = null, trDrugSto = null, trDrugBrain = null, trLep = null, trHun = null, trLiv = null, trMus = null, trVes = null;
let foodEl = null, hungerEl = null, dietRing = null, bandG = null, brainHalo = null, liverFatEl = null, muscleShadeEl = null, vesselHalo = null;
const ADIP = { x: 390, y: 200 };
const adipOff = [[-55, -25], [0, -45], [55, -25], [-32, 30], [36, 30]];
const macPos = [[225, 272], [330, 268], [458, 268]];
let adips = [], macs = [], drops = [], dockDots = [], rbcDots = [];
function initOrgans() {
  stomachO = organ($("stomachSlot"), "stomach", 130, 190, 120, {});
  brainO = organ($("brainSlot"), "brain", 715, 140, 175, {});
  liverO = organ($("liverSlot"), "liver", 280, 345, 150, {});
  muscleO = organ($("muscleSlot"), "muscle", 505, 355, 140, {});
  vesselO = organ($("vesselSlot"), "vessel", 735, 352, 52, { h: 100 });
  const SP = stomachO.ports, BP = brainO.ports, LP = liverO.ports, MP = muscleO.ports, VP = vesselO.ports;
  const stoL = [stomachO.x - 60 + 4, 190], fundus = SP.fundus, caro = BP.carotid, frontal = BP.frontal;
  foodEl = $("foodPath");
  foodEl.setAttribute("d", "M28 190L" + f1(stoL[0]) + " 190");
  $("lepPath").setAttribute("d", "M445 150 C520 130 590 135 " + f1(caro[0]) + " " + f1(caro[1]));
  hungerEl = $("hungerPath");
  hungerEl.setAttribute("d", "M" + f1(frontal[0]) + " " + f1(frontal[1]) + " C520 82 300 82 150 122");
  $("ffaLiv").setAttribute("d", "M360 245L" + f1(LP.out[0]) + " " + f1(LP.out[1]));
  $("ffaMus").setAttribute("d", "M415 250L" + f1(MP.in[0]) + " " + f1(MP.in[1]));
  $("ffaVes").setAttribute("d", "M470 225L" + f1(VP.in[0]) + " " + f1(VP.in[1]));
  trFood = track([[28, 190], stoL]);
  trDrugSto = track([[28, 120], fundus]);
  trDrugBrain = track([[28, 120], [400, 100], [BP.parenchyma[0], 100]]);
  trLep = track([[445, 150], [520, 130], [590, 135], caro]);
  trHun = track([frontal, [520, 82], [300, 82], [150, 122]]);
  trLiv = track([[360, 245], LP.out]);
  trMus = track([[415, 250], MP.in]);
  trVes = track([[470, 225], VP.in]);
  /* liver fat overlay and droplets sit on the liver lobe */
  liverFatEl = mk("ellipse", { class: "ob-fatov", cx: f1(LP.lobe[0] + 52), cy: f1(LP.lobe[1] - 5), rx: 60, ry: 28 }, layers.cells);
  const dropOff = [[-40, -20], [-15, -25], [10, -20], [35, -15], [-30, 5], [-5, 0], [20, 5], [40, 10], [-15, 25], [15, 30]];
  drops = dropOff.map(function (o, i) { return { e: mk("circle", { class: "ob-drop", cx: f1(LP.lobe[0] + o[0]), cy: f1(LP.lobe[1] + o[1]), r: 5 + (i % 3) }, layers.cells) }; });
  /* muscle shade marks insulin resistance clearing with treatment */
  muscleShadeEl = mk("ellipse", { class: "ob-shade", cx: f1(muscleO.x), cy: f1(muscleO.y), rx: 70, ry: 33 }, layers.cells);
  /* vessel pressure halo plus red cells flowing through the lumen */
  vesselHalo = mk("ellipse", { class: "ob-press", cx: f1(vesselO.x), cy: f1(vesselO.y), rx: 30, ry: 58 }, layers.cells);
  for (let i = 0; i < 3; i++) rbcDots.push({ e: mk("circle", { class: "ob-rbc", r: 5 }, layers.cells), u: i / 3 });
  /* lifestyle ring around the stomach, surgery band across it, drug halo on the brain */
  dietRing = mk("ellipse", { class: "ob-ring", cx: f1(stomachO.x), cy: f1(stomachO.y), rx: 76, ry: 76 }, layers.cells);
  dietRing.setAttribute("opacity", "0");
  bandG = mk("g", {}, layers.cells);
  mk("rect", { class: "ob-band", x: f1(stomachO.x - 42), y: f1(stomachO.y - 42), width: 84, height: 13, rx: 6 }, bandG);
  mk("rect", { class: "ob-band", x: f1(stomachO.x - 30), y: f1(stomachO.y - 46), width: 8, height: 21, rx: 3 }, bandG);
  mk("rect", { class: "ob-band", x: f1(stomachO.x + 22), y: f1(stomachO.y - 46), width: 8, height: 21, rx: 3 }, bandG);
  bandG.setAttribute("opacity", "0");
  brainHalo = mk("ellipse", { class: "ob-bhalo", cx: f1(brainO.x), cy: f1(brainO.y), rx: 95, ry: 72 }, layers.cells);
  brainHalo.setAttribute("opacity", "0");
  /* GLP-1 blocker seats on the upper brain where hunger is driven */
  const dockY = brainO.y - 40;
  dockDots = [0, 1, 2, 3, 4].map(function (i) { const e = mk("circle", { class: "ob-dock", cx: f1(brainO.x - 30 + i * 15), cy: f1(dockY), r: 4.5 }, layers.cells); e.setAttribute("opacity", "0"); return { e: e }; });
}
function initCells() {
  adips = adipOff.map(function (o, i) { const g = cell(layers.cells, { cls: "adip", r: 30, nuc: 0.22, seed: i * 2 + 1, wob: 0.08 }); return { g: g, x: ADIP.x + o[0], y: ADIP.y + o[1] }; });
  macs = macPos.map(function (p, i) { const g = cell(layers.cells, { cls: "mac", r: 14, nuc: 0.45, seed: i * 3 + 7, wob: 0.14 }); return { g: g, x: p[0], y: p[1] }; });
}
function capText(d) {
  if (d === 1) return "Lifestyle change cuts food and raises activity. Fat cells shrink a little.";
  if (d === 2) return "GLP-1 based drug blocks hunger signals in the brain. Less food comes in.";
  if (d === 3) return "Surgery makes the stomach pouch small. Much less food enters and fat stores fall.";
  return "No treatment. Extra food fills fat cells and their signals disturb liver, muscle and vessels.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Whole body effects";
  [["fat", "Fat store", "g-fat", "Stored fat in adipose tissue. Fat cells enlarge first and can increase in number over time."], ["lepR", "Leptin resist.", "g-lepr", "Leptin from fat should curb appetite at the hypothalamus, but the brain responds less as fat rises, so the signal is resisted."], ["inf", "Inflam.", "g-cyt", "Enlarged fat cells attract macrophages. Their signals and adipokines keep adipose tissue inflamed."], ["ins", "Insulin act.", "g-ins", "How well muscle and other tissues respond to insulin. Free fatty acids and inflammation reduce this action."], ["liv", "Liver fat", "g-liv", "Fat delivered to the liver builds up there, giving fatty liver."], ["lip", "Lipids and BP", "g-lip", "Blood lipids and blood pressure tend to rise together as metabolic syndrome develops."]]
    .forEach(function (d, i) { gg[d[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, d[2], d[1], d[3]); });
  const ox = layers.over;
  pill(ox, "Food in", 78, 190, 110, 72, "Energy taken in as food and drink. A lasting surplus is stored as fat.");
  pill(ox, "Fat store", 390, 118, 390, 64, "Fat cells in adipose tissue. They enlarge as stored fat grows.");
  pill(ox, "Hunger signal", 600, 108, 545, 64, "Brain hunger signals drive eating. The drug option blocks them and surgery weakens them.");
  pill(ox, "Brain control", 792, 140, 845, 68, "Appetite control centres. They respond less to leptin as fat rises, so hunger continues.");
  pill(ox, "Inflamed fat", 225, 272, 150, 330, "Macrophages enter enlarged fat and release signals that disturb insulin action.");
  pill(ox, "Liver fat", 265, 284, 280, 256, "Extra fat arriving from adipose tissue builds up in the liver.");
  pill(ox, "Muscle and vessels", 610, 340, 615, 283, "Muscle responds less to insulin while blood lipids and pressure rise.");
  capEl = mk("text", { class: "ob-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, t: 0, u: 0, k: 0, tx: 0, ty: 0, vx: 0, vy: 0, tr: null }; }); }
const food = pool(16, function () { return mk("circle", { class: "sc-p p-food", r: 3 }, layers.parts); });
const hng = pool(12, function () { return mk("path", { class: "sc-p p-hun", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts); });
const lep = pool(16, function () { return mk("circle", { class: "sc-p p-lep", r: 2.6 }, layers.parts); });
const ffa = pool(24, function () { return mk("circle", { class: "sc-p p-ffa", r: 2.4 }, layers.parts); });
const cyt = pool(16, function () { return mk("circle", { class: "sc-p p-cyt", r: 2.3 }, layers.parts); });
const treat = pool(10, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-treat", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); return g; });
const free = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { F: 0.4, LepR: 0.2, Inf: 0.2, Ins: 0.7, Liv: 0.2, Lip: 0.2, BP: 0.3, Intake: 0.5, band: 0, dock: 0, diet: 0, hunOp: 0.55 };
const acc = { food: 0, hng: 0, lep: 0, ffa: 0, cyt: 0, treat: 0 };
function init() { initOrgans(); initCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.F = lerp(sm.F, m.F, k); sm.LepR = lerp(sm.LepR, m.LepR, k); sm.Inf = lerp(sm.Inf, m.Inf, k); sm.Ins = lerp(sm.Ins, m.Ins, k); sm.Liv = lerp(sm.Liv, m.Liv, k); sm.Lip = lerp(sm.Lip, m.Lip, k); sm.BP = lerp(sm.BP, m.BP, k); sm.Intake = lerp(sm.Intake, m.Intake, k);
  sm.band = lerp(sm.band, m.drug === 3 ? 1 : 0, Math.min(1, dt * 2));
  sm.dock = lerp(sm.dock, m.drug === 2 ? 1 : 0, Math.min(1, dt * 2));
  sm.diet = lerp(sm.diet, m.drug === 1 ? 1 : 0, Math.min(1, dt * 2));
  sm.hunOp = lerp(sm.hunOp, m.drug === 2 ? 0.12 : m.drug === 3 ? 0.2 : m.drug === 1 ? 0.35 : 0.55, Math.min(1, dt * 2));
  const as = 0.55 + 0.8 * sm.F;
  adips.forEach(function (a, i) { place(a.g, a.x + Math.sin(tm / 1600 + i) * 2, a.y + Math.cos(tm / 1800 + i) * 2, Math.sin(tm / 2400 + i) * 5, as); });
  macs.forEach(function (mm, i) { const s = 0.25 + 0.85 * sm.Inf; place(mm.g, mm.x + Math.sin(tm / 1300 + i * 2) * 3, mm.y + Math.cos(tm / 1500 + i) * 2, 0, s); mm.g.style.opacity = sm.Inf > 0.08 ? 1 : 0; });
  drops.forEach(function (d, i) { d.e.setAttribute("opacity", (i + 0.5) / drops.length < sm.Liv ? "1" : "0"); });
  if (liverFatEl) liverFatEl.setAttribute("opacity", (0.1 + 0.5 * sm.Liv).toFixed(2));
  if (muscleShadeEl) muscleShadeEl.setAttribute("opacity", (0.5 * (1 - sm.Ins)).toFixed(2));
  if (vesselHalo) vesselHalo.setAttribute("opacity", (0.08 + 0.3 * sm.BP).toFixed(2));
  if (bandG) bandG.setAttribute("opacity", sm.band.toFixed(2));
  if (dietRing) dietRing.setAttribute("opacity", (0.85 * sm.diet).toFixed(2));
  if (brainHalo) brainHalo.setAttribute("opacity", (0.3 * sm.dock).toFixed(2));
  dockDots.forEach(function (d) { d.e.setAttribute("opacity", sm.dock.toFixed(2)); });
  if (hungerEl) hungerEl.setAttribute("opacity", sm.hunOp.toFixed(2));
  rbcDots.forEach(function (r) { r.u += dt * (0.2 + 0.5 * sm.BP); if (r.u > 1) r.u -= 1; r.e.setAttribute("cx", f1(vesselO.x)); r.e.setAttribute("cy", f1(vesselO.y - 50 + r.u * 100)); r.e.setAttribute("opacity", "0.85"); });
  /* food enters the stomach; the pouch holds little after surgery */
  const foodRate = sm.Intake * 7 * (m.drug === 3 ? 0.3 : m.drug === 2 ? 0.55 : m.drug === 1 ? 0.7 : 1);
  acc.food += dt * foodRate; while (acc.food >= 1) { acc.food--; const p = free(food); if (p) emit(p, 28, 190); }
  food.forEach(function (p) { if (!p.on) return; p.x += 60 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " 190)"); if (p.x > stomachO.x - 60) kill(p); });
  /* hunger signals run from brain to stomach and fade under treatment */
  acc.hng += dt * (1 + 2 * (0.3 + sm.F)) * (m.drug === 2 ? 0.12 : m.drug === 3 ? 0.25 : m.drug === 1 ? 0.6 : 1);
  while (acc.hng >= 1) { acc.hng--; const p = free(hng); if (p) { emit(p, 0, 0); p.tr = trHun; p.u = 0; p.e.setAttribute("opacity", m.drug === 2 ? "0.2" : "1"); } }
  hng.forEach(function (p) { if (!p.on) return; p.u += dt * 88 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, tm / 6, 1); if (p.u >= 1) kill(p); });
  /* leptin runs from fat to the brain and is resisted there */
  acc.lep += dt * (0.3 + sm.F) * 6; while (acc.lep >= 1) { acc.lep--; const p = free(lep); if (p) { emit(p, 0, 0); p.tr = trLep; p.u = 0; } }
  lep.forEach(function (p) { if (!p.on) return; p.u += dt * (0.35 - 0.18 * sm.LepR) * 88 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", p.u > 0.92 && sm.LepR > 0.55 ? "0.25" : "1"); if (p.u >= 1) kill(p); });
  /* macrophages shed signals inside the fat */
  acc.cyt += dt * sm.Inf * 9; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt), mm = pick(macs); if (p && mm) { emit(p, mm.x + rnd(-8, 8), mm.y + rnd(-6, 6)); p.vx = rnd(-14, 14); p.vy = rnd(10, 24); } }
  cyt.forEach(function (p) { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 335) kill(p); });
  /* fatty acids leave the fat for liver, muscle and the vessel */
  const targets = [trLiv, trMus, trVes];
  acc.ffa += dt * (0.15 + m.FFA) * 8; while (acc.ffa >= 1) { acc.ffa--; const p = free(ffa); if (p) { emit(p, 0, 0); p.tr = targets[Math.floor(Math.random() * 3)]; p.u = 0; } }
  ffa.forEach(function (p) { if (!p.on) return; p.u += dt * 0.45 * 88 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); if (p.u >= 1) kill(p); });
  /* treatment help: lifestyle travels to the stomach, the drug travels to the brain and docks */
  acc.treat += dt * (m.drug === 1 ? 3 : m.drug === 2 ? 1.6 : 0);
  while (acc.treat >= 1) { acc.treat--; const p = free(treat); if (p) { emit(p, 28, 120); p.tr = m.drug === 1 ? trDrugSto : trDrugBrain; p.u = 0; } }
  treat.forEach(function (p) { if (!p.on) return; p.u += dt * 160 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(tm / 8) + ")"); if (p.u >= 1) kill(p); });
  gg.fat.set(sm.F, wordOf(sm.F, 0.35, 0.65, ["normal", "raised", "high"]));
  gg.lepR.set(sm.LepR, wordOf(sm.LepR, 0.3, 0.6, ["low", "some", "high"]));
  gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["low", "raised", "high"]));
  gg.ins.set(sm.Ins, wordOf(sm.Ins, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.liv.set(sm.Liv, wordOf(sm.Liv, 0.3, 0.6, ["little", "some", "much"]));
  gg.lip.set(clamp((sm.Lip + sm.BP) / 2), wordOf((sm.Lip + sm.BP) / 2, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
