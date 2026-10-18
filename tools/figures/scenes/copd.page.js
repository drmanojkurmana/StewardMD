/* COPD scene: smoke, bronchitis airway with mucus, emphysema alveoli, expiratory narrowing, trapped air and gauges. */
const L = { smoke: $("smokeG"), bron: $("bron"), alv: $("alv"), flow: $("flowG"), parts: $("parts"), over: $("over"), panel: $("panel"), bronLumen: $("bronLumen"), flowTube: $("flowTube") };
const Wd = SC.W;
/* ---- bronchitis airway: walls, epithelium, glands, muscle ---- */
let wallTop = null, wallBot = null;
const epiCells = [], mucBlobs = [], muscleCells = [];
function initBron() {
  wallTop = mk("rect", { class: "copd-wall", x: 34, y: 148, width: 416, height: 28, rx: 10 }, L.bron);
  wallBot = mk("rect", { class: "copd-wall", x: 34, y: 228, width: 416, height: 28, rx: 10 }, L.bron);
  for (let i = 0; i < 11; i++) { const gob = i % 4 === 2, g = mk("g", {}, L.bron); cell(g, { cls: gob ? "gob" : "epi", r: gob ? 13 : 11, nuc: gob ? 0 : 0.3, seed: i + 3, wob: 0.05, n: 8 }); epiCells.push({ g, x: 62 + i * 36, gob }); }
  for (let i = 0; i < 6; i++) mucBlobs.push({ e: mk("ellipse", { class: "copd-mucus", rx: 16, ry: 8 }, L.bron), x: 92 + i * 58, k: i % 3 });
  for (let i = 0; i < 8; i++) { const g = mk("g", {}, L.bron); mk("ellipse", { class: "copd-muscle", rx: 24, ry: 8 }, g); muscleCells.push({ g, x: 66 + i * 50, y: 268 }); }
  [[240, 258], [420, 258]].forEach(([gx, gy]) => { const g = mk("g", {}, L.bron); for (let j = 0; j < 5; j++) mk("circle", { class: "copd-mucus", r: 6, cx: f1(Math.cos(j * 1.26) * 10), cy: f1(Math.sin(j * 1.26) * 8) }, g); place(g, gx, gy, 0, 1); });
}
/* ---- emphysema alveoli ---- */
const sacs = [], septs = [], caps = [];
function initAlv() {
  const pos = [[565, 150], [640, 140], [720, 150], [800, 140], [875, 155], [600, 215], [685, 205], [770, 215], [855, 210], [565, 280], [650, 285], [740, 280], [830, 285], [885, 285]];
  pos.forEach(([x, y], i) => { const g = mk("g", {}, L.alv); const c = mk("circle", { class: "alv-sac", r: 26 }, g); sacs.push({ g, c, x, y, i }); });
  for (let i = 0; i < 10; i++) { const a = pos[i], b = pos[i + 1]; if (Math.abs(a[1] - b[1]) < 30) septs.push(mk("line", { class: "alv-sept", x1: a[0] + 18, y1: a[1], x2: b[0] - 18, y2: b[1] }, L.alv)); }
  pos.forEach(([x, y], i) => { if (i % 3 === 0) caps.push({ e: mk("circle", { class: "copd-cap", r: 4, cx: x + 20, cy: y - 18 }, L.alv), i }); });
}
/* ---- bottom flow tube and trapped sac ---- */
let trapSac = null, trapTxt = null;
function initFlow() {
  trapSac = mk("circle", { class: "trap-sac", cx: 835, cy: 411, r: 20 }, L.flow);
  [0, 1, 2, 3, 4].forEach((i) => mk("path", { class: "arh", d: "M" + (90 + i * 120) + " 411l10 0M104 406l6 5l-6 5" }, L.flow));
}
/* ---- particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const smokeP = pool(26, () => mk("circle", { class: "p-smoke", r: 5 }, L.parts));
const airP = pool(24, () => mk("circle", { class: "sc-p p-air", r: 3 }, L.parts));
const o2P = pool(20, () => mk("circle", { class: "sc-p p-o2", r: 3 }, L.parts));
const mucP = pool(16, () => mk("circle", { class: "sc-p p-muc", r: 3 }, L.parts));
const flareP = pool(12, () => mk("circle", { class: "copd-flare", r: 3 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {}, dpills = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: Wd - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lungs";
  [["muc", "Mucus", "g-muc2", "Mucus made by goblet cells and submucosal glands in chronic bronchitis. Too much mucus narrows the airway and can plug it."], ["dmg", "Wall damage", "g-dmg", "Alveolar wall destruction in emphysema. Sacs merge, recoil is lost and surface for gas exchange falls."], ["air", "Airflow", "g-air2", "How freely air moves, most limited on breathing out when airways narrow and lose tethering."], ["trap", "Trapped air", "g-trap", "Air left behind in enlarged, floppy sacs after breathing out because airways close early."], ["oxy", "Oxygen", "g-oxy", "Blood oxygen. It falls when airflow is limited and alveolar surface is lost. Oxygen treatment raises it without repairing the lung."], ["exac", "Flare up risk", "g-exac", "Risk of an exacerbation: a sudden worsening with more inflammation, mucus and narrowing, often set off by infection."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Smoke", 66, 96, 142, 94, "Cigarette smoke and other inhaled irritants. Long term exposure inflames airways and destroys alveolar walls.");
  pill(ox, "Goblet cells", 175, 178, 175, 138, "Goblet cells in the airway lining. In chronic bronchitis there are more of them and they make too much mucus.");
  pill(ox, "Mucus", 315, 202, 352, 142, "Excess mucus in the airway lumen. It narrows the airway, traps air beyond it and is coughed up as sputum.");
  pill(ox, "Airway wall", 390, 232, 392, 286, "The inflamed, thickened airway wall of chronic bronchitis, with enlarged mucus glands.");
  pill(ox, "Smooth muscle", 130, 252, 128, 292, "Airway smooth muscle. A bronchodilator relaxes it and widens the airway, without undoing wall damage.");
  pill(ox, "Exacerbation flare", 265, 205, 252, 330, "An exacerbation flare: infection or irritation suddenly increases inflammation, mucus and narrowing and airflow falls.");
  pill(ox, "Alveoli", 600, 155, 602, 100, "Air sacs where gas exchange happens. Their thin walls are wrapped in capillaries.");
  pill(ox, "Broken walls", 735, 195, 758, 88, "In emphysema the walls between sacs break down. Sacs merge, elastic recoil is lost and airways lose the tethering that holds them open.");
  pill(ox, "Enlarged sacs", 830, 255, 828, 340, "Enlarged, floppy air spaces left after wall destruction. They trap air and give less surface for oxygen to cross.");
  pill(ox, "Capillary", 575, 285, 578, 328, "Capillaries around the sacs carry blood for gas exchange. Lost sac walls mean lost capillary surface.");
  pill(ox, "Narrowed airway", 360, 410, 270, 388, "On breathing out, narrowed small airways close early. Airflow is limited and air is trapped beyond the narrowing.");
  pill(ox, "Air trapping", 835, 410, 835, 380, "Trapped air in enlarged sacs after breathing out. The chest stays overinflated and fresh air has less room to enter.");
  [[1, "Bronchodilator opens airway", "A bronchodilator relaxes airway smooth muscle and eases airflow quickly. It does not rebuild alveolar walls."], [2, "Steroid calms airway wall", "An inhaled steroid calms airway inflammation and mucus over time. It does not regrow destroyed alveolar walls."], [3, "Oxygen supports blood", "Oxygen raises blood oxygen while it is given. It does not open airways or repair air sacs."], [4, "No smoke: slows damage", "Smoking cessation removes the ongoing smoke injury and slows further damage. Destroyed walls do not regrow here."]]
    .forEach(([d, n, tip]) => { dpills[d] = pill(ox, n, 240, 200, 480, 64, tip); dpills[d].style.opacity = 0; });
}
const sv = { smoke: 0.5, infl: 0.5, muc: 0.5, dmg: 0.5, narrow: 0.5, air: 0.5, trap: 0.5, exac: 0.5, oxyB: 0.5, oxy: 0 };
const acc = { smoke: 0, air: 0, o2: 0, muc: 0, flare: 0 };
const dw = [1, 0, 0, 0, 0, 0];
function init() { initBron(); initAlv(); initFlow(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  for (const q of ["smoke", "infl", "muc", "dmg", "narrow", "air", "trap", "exac", "oxyB"]) sv[q] = lerp(sv[q], m[q], k2);
  sv.oxy = lerp(sv.oxy, m.oxy, k1);
  dw.forEach((_, d) => { dw[d] = lerp(dw[d], m.drug === d ? 1 : 0, k1); });
  /* bronchitis: wall thickens, lumen narrows, mucus grows */
  const wallH = 24 + 14 * sv.infl, lumenH = Math.max(22, 52 - 26 * sv.narrow - 8 * sv.muc);
  wallTop.setAttribute("height", f1(wallH)); wallTop.setAttribute("y", f1(202 - lumenH / 2 - wallH));
  wallBot.setAttribute("height", f1(wallH)); wallBot.setAttribute("y", f1(202 + lumenH / 2));
  L.bronLumen.setAttribute("y", f1(202 - lumenH / 2)); L.bronLumen.setAttribute("height", f1(lumenH));
  epiCells.forEach((e, i) => place(e.g, e.x, 202 - lumenH / 2 + 8, 0, e.gob ? 0.8 + 0.4 * sv.muc : 1));
  mucBlobs.forEach((p) => { const v = clamp(sv.muc * 1.4 - p.k * 0.28); p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 800 + p.k) * 3) + " " + f1(202 + (p.k - 1) * 7) + ") scale(" + (0.15 + 0.85 * v).toFixed(2) + ")"); p.e.setAttribute("opacity", v > 0.05 ? "1" : "0"); });
  muscleCells.forEach((c, i) => { const sx = 1 - 0.22 * sv.narrow; c.g.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(202 + lumenH / 2 + wallH + 12 + (i % 2) * 4) + ") scale(" + sx.toFixed(2) + " 1)"); });
  /* emphysema: sacs enlarge, septa fade */
  sacs.forEach((s) => { const sc = 1 + 0.42 * sv.dmg; place(s.g, s.x, s.y, 0, sc); s.c.setAttribute("opacity", (1 - 0.25 * sv.dmg).toFixed(2)); });
  septs.forEach((s, i) => s.setAttribute("opacity", clamp(1 - sv.dmg * 1.15 + (i % 3) * 0.08).toFixed(2)));
  caps.forEach((c) => c.e.setAttribute("opacity", clamp(1 - sv.dmg * 0.8).toFixed(2)));
  /* bottom tube and trapped sac */
  const tubeH = Math.max(16, 38 - 20 * sv.narrow);
  L.flowTube.setAttribute("y", f1(411 - tubeH / 2)); L.flowTube.setAttribute("height", f1(tubeH));
  if (trapSac) trapSac.setAttribute("r", f1(16 + 20 * sv.trap + 2 * Math.sin(tm / 900)));
  /* smoke */
  acc.smoke += dt * sv.smoke * 7; while (acc.smoke >= 1) { acc.smoke--; const p = freeP(smokeP); if (p) emitP(p, rnd(48, 84), rnd(86, 106), rnd(22, 38), rnd(-8, -2)); }
  smokeP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 500 + p.x) * 0.25; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.5).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.2).toFixed(2)); if (p.t > 3.2 || p.x > 470) killP(p); });
  /* mucus droplets from goblet cells */
  acc.muc += dt * sv.muc * 5; while (acc.muc >= 1) { acc.muc--; const p = freeP(mucP); if (p) emitP(p, rnd(80, 420), 202 - lumenH / 2 + 10, rnd(8, 18), rnd(2, 8)); }
  mucP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) killP(p); });
  /* air flow in bottom tube */
  acc.air += dt * (2 + 9 * sv.air); while (acc.air >= 1) { acc.air--; const p = freeP(airP); if (p) emitP(p, 44, 411 + rnd(-tubeH / 3, tubeH / 3), 70 + 90 * sv.air, 0); }
  airP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt * (p.x > 320 && p.x < 430 ? 1 - 0.5 * sv.narrow : 1); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 700) killP(p); });
  /* oxygen dots toward alveoli */
  acc.o2 += dt * sv.oxy * 8; while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2P); if (p) emitP(p, rnd(520, 580), rnd(300, 330), rnd(20, 40), rnd(-30, -18)); }
  o2P.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) killP(p); });
  /* exacerbation flare dots in bronchitis lumen */
  acc.flare += dt * sv.exac * 6; while (acc.flare >= 1) { acc.flare--; const p = freeP(flareP); if (p) emitP(p, rnd(60, 430), 202 + rnd(-10, 10), rnd(-6, 6), rnd(-6, 6)); }
  flareP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(sv.exac * (1 - p.t / 1.8)).toFixed(2)); if (p.t > 1.8) killP(p); });
  for (const d in dpills) dpills[d].style.opacity = dw[d].toFixed(2);
  gg.muc.set(sv.muc, wordOf(sv.muc, 0.3, 0.62, ["thin", "thick", "plugging"])); gg.dmg.set(sv.dmg, wordOf(sv.dmg, 0.28, 0.58, ["little", "some", "marked"])); gg.air.set(sv.air, wordOf(sv.air, 0.32, 0.62, ["low", "reduced", "open"]));
  gg.trap.set(sv.trap, wordOf(sv.trap, 0.3, 0.62, ["little", "some", "marked"])); gg.oxy.set(sv.oxyB, wordOf(sv.oxyB, 0.45, 0.7, ["low", "reduced", "near normal"])); gg.exac.set(sv.exac, wordOf(sv.exac, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
