/* COPD scene: smoke, bronchitis airway with mucus, emphysema lung with alveoli, expiratory narrowing, trapped air, treatment actions and gauges. */
const L = { smoke: $("smokeG"), bron: $("bron"), alv: $("alv"), flow: $("flowG"), parts: $("parts"), over: $("over"), panel: $("panel"), bronLumen: $("bronLumen"), flowTube: $("flowTube"), lungSlot: $("lungSlot") };
const Wd = SC.W;
/* ---- lung organ plus a caption that follows the treatment ---- */
let lungO = null, capEl = null, capDrug = -1;
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 715, 200, 230, {});
}
function capText(d) {
  if (d === 1) return "Bronchodilator relaxes airway muscle. The airway widens and airflow rises.";
  if (d === 2) return "Inhaled steroid calms the airway wall. Mucus thins and flare ups ease.";
  if (d === 3) return "Oxygen raises blood oxygen. Airways and air sacs stay damaged.";
  if (d === 4) return "No smoke. Injury stops and damage slows. Destroyed walls do not regrow.";
  return "No treatment. Smoke injures airways and air sacs. Airflow and oxygen stay low.";
}
/* ---- bronchitis airway: walls, inflammation tint, epithelium, glands, muscle, cigarette ---- */
let wallTop = null, wallBot = null, inflTop = null, inflBot = null, ember = null, emberGlow = null;
const epiCells = [], mucBlobs = [], muscleCells = [];
function initBron() {
  wallTop = mk("rect", { class: "copd-wall", x: 34, y: 148, width: 416, height: 28, rx: 10 }, L.bron);
  wallBot = mk("rect", { class: "copd-wall", x: 34, y: 228, width: 416, height: 28, rx: 10 }, L.bron);
  inflTop = mk("rect", { class: "copd-infl", x: 34, y: 148, width: 416, height: 28, rx: 10 }, L.bron);
  inflBot = mk("rect", { class: "copd-infl", x: 34, y: 228, width: 416, height: 28, rx: 10 }, L.bron);
  for (let i = 0; i < 11; i++) { const gob = i % 4 === 2, g = mk("g", {}, L.bron); cell(g, { cls: gob ? "gob" : "epi", r: gob ? 13 : 11, nuc: gob ? 0 : 0.3, seed: i + 3, wob: 0.05, n: 8 }); epiCells.push({ g, x: 62 + i * 36, gob }); }
  for (let i = 0; i < 6; i++) mucBlobs.push({ e: mk("ellipse", { class: "copd-mucus", rx: 16, ry: 8 }, L.bron), x: 92 + i * 58, k: i % 3 });
  for (let i = 0; i < 8; i++) { const g = mk("g", {}, L.bron); mk("ellipse", { class: "copd-muscle", rx: 24, ry: 8 }, g); muscleCells.push({ g, x: 66 + i * 50, y: 268 }); }
  [[240, 258], [420, 258]].forEach(([gx, gy]) => { const g = mk("g", {}, L.bron); for (let j = 0; j < 5; j++) mk("circle", { class: "copd-mucus", r: 6, cx: f1(Math.cos(j * 1.26) * 10), cy: f1(Math.sin(j * 1.26) * 8) }, g); place(g, gx, gy, 0, 1); });
  const cg = mk("g", {}, L.bron);
  mk("rect", { class: "copd-cig", x: 36, y: 89, width: 26, height: 7, rx: 3.5 }, cg);
  emberGlow = mk("circle", { class: "copd-emberglow", cx: 64, cy: 92.5, r: 6.5 }, cg);
  ember = mk("circle", { class: "copd-ember", cx: 64, cy: 92.5, r: 3.2 }, cg);
}
/* ---- emphysema alveoli inside the lung organ ---- */
const sacs = [], septs = [], caps = [];
function initAlv() {
  const pos = [[658, 135], [720, 125], [778, 135], [658, 202], [720, 200], [778, 202], [658, 272], [720, 275], [778, 272]];
  pos.forEach(([x, y], i) => { const g = mk("g", {}, L.alv); const c = mk("circle", { class: "alv-sac", r: 22 }, g); sacs.push({ g, c, x, y, i }); });
  [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8]].forEach(([a, b]) => { const A = pos[a], B = pos[b]; septs.push(mk("line", { class: "alv-sept", x1: A[0] + 18, y1: A[1], x2: B[0] - 18, y2: B[1] }, L.alv)); });
  pos.forEach(([x, y], i) => { if (i % 2 === 0) caps.push({ e: mk("circle", { class: "copd-cap", r: 4, cx: x + 15, cy: y - 13 }, L.alv), i }); });
}
/* ---- bottom flow tube and trapped sac ---- */
let trapSac = null;
function initFlow() {
  trapSac = mk("circle", { class: "trap-sac", cx: 835, cy: 411, r: 20 }, L.flow);
  [0, 1, 2, 3, 4].forEach((i) => mk("path", { class: "arh", d: "M" + (90 + i * 120) + " 411l10 0M104 406l6 5l-6 5" }, L.flow));
}
/* ---- particles ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, stuck: false }; }); }
const smokeP = pool(26, () => mk("circle", { class: "p-smoke", r: 5 }, L.parts));
const airP = pool(24, () => mk("circle", { class: "sc-p p-air", r: 3 }, L.parts));
const o2P = pool(20, () => mk("circle", { class: "sc-p p-o2", r: 3 }, L.parts));
const mucP = pool(16, () => mk("circle", { class: "sc-p p-muc", r: 3 }, L.parts));
const flareP = pool(12, () => mk("circle", { class: "copd-flare", r: 3 }, L.parts));
const bronP = pool(8, () => mk("path", { class: "sc-p p-bron", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
const sterP = pool(12, () => mk("circle", { class: "sc-p p-ster", r: 3 }, L.parts));
const cleanP = pool(16, () => mk("circle", { class: "sc-p p-clean", r: 2.6 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.stuck = false; p.e.setAttribute("opacity", "1"); }
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
  pill(ox, "Smoke", 64, 93, 142, 94, "Cigarette smoke and other inhaled irritants. Long term exposure inflames airways and destroys alveolar walls.");
  pill(ox, "Goblet cells", 134, 190, 175, 138, "Goblet cells in the airway lining. In chronic bronchitis there are more of them and they make too much mucus.");
  pill(ox, "Mucus", 315, 202, 352, 142, "Excess mucus in the airway lumen. It narrows the airway, traps air beyond it and is coughed up as sputum.");
  pill(ox, "Airway wall", 390, 244, 392, 286, "The inflamed, thickened airway wall of chronic bronchitis, with enlarged mucus glands.");
  pill(ox, "Smooth muscle", 130, 264, 128, 292, "Airway smooth muscle. A bronchodilator relaxes it and widens the airway, without undoing wall damage.");
  pill(ox, "Exacerbation flare", 265, 202, 252, 330, "An exacerbation flare: infection or irritation suddenly increases inflammation, mucus and narrowing and airflow falls.");
  pill(ox, "Lung", 625, 180, 560, 92, "The lung holds the air sacs. Smoke destroys sac walls and the lung loses elastic recoil.");
  pill(ox, "Alveoli", 720, 125, 665, 92, "Air sacs where gas exchange happens. Their thin walls are wrapped in capillaries.");
  pill(ox, "Broken walls", 749, 135, 790, 88, "In emphysema the walls between sacs break down. Sacs merge, elastic recoil is lost and airways lose the tethering that holds them open.");
  pill(ox, "Enlarged sacs", 778, 272, 860, 340, "Enlarged, floppy air spaces left after wall destruction. They trap air and give less surface for oxygen to cross.");
  pill(ox, "Capillary", 673, 259, 640, 328, "Capillaries around the sacs carry blood for gas exchange. Lost sac walls mean lost capillary surface.");
  pill(ox, "Narrowed airway", 360, 411, 270, 388, "On breathing out, narrowed small airways close early. Airflow is limited and air is trapped beyond the narrowing.");
  pill(ox, "Air trapping", 835, 411, 835, 380, "Trapped air in enlarged sacs after breathing out. The chest stays overinflated and fresh air has less room to enter.");
  [[1, "Bronchodilator opens airway", "A bronchodilator relaxes airway smooth muscle and eases airflow quickly. It does not rebuild alveolar walls."], [2, "Steroid calms airway wall", "An inhaled steroid calms airway inflammation and mucus over time. It does not regrow destroyed alveolar walls."], [3, "Oxygen supports blood", "Oxygen raises blood oxygen while it is given. It does not open airways or repair air sacs."], [4, "No smoke: injury stops", "Smoking cessation removes the ongoing smoke injury and slows further damage. Destroyed walls do not regrow here."]]
    .forEach(([d, n, tip]) => { dpills[d] = pill(ox, n, 240, 200, 480, 64, tip); dpills[d].style.opacity = 0; });
  capEl = mk("text", { class: "copd-note", x: 30, y: 438 }, ox); capEl.textContent = capText(0);
}
const sv = { smoke: 0.5, infl: 0.5, muc: 0.5, dmg: 0.5, narrow: 0.5, air: 0.5, trap: 0.5, exac: 0.5, oxyB: 0.5, oxy: 0 };
const acc = { smoke: 0, air: 0, o2: 0, muc: 0, flare: 0, ster: 0, clean: 0 };
const dw = [1, 0, 0, 0, 0, 0];
function init() { initOrgans(); initBron(); initAlv(); initFlow(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  for (const q of ["smoke", "infl", "muc", "dmg", "narrow", "air", "trap", "exac", "oxyB"]) sv[q] = lerp(sv[q], m[q], k2);
  sv.oxy = lerp(sv.oxy, m.oxy, k1);
  dw.forEach((_, d) => { dw[d] = lerp(dw[d], drug === d ? 1 : 0, k1); });
  /* bronchitis: wall thickens and reddens, lumen narrows, mucus grows */
  const wallH = 24 + 14 * sv.infl, lumenH = Math.max(22, 52 - 26 * sv.narrow - 8 * sv.muc);
  wallTop.setAttribute("height", f1(wallH)); wallTop.setAttribute("y", f1(202 - lumenH / 2 - wallH));
  wallBot.setAttribute("height", f1(wallH)); wallBot.setAttribute("y", f1(202 + lumenH / 2));
  inflTop.setAttribute("height", f1(wallH)); inflTop.setAttribute("y", f1(202 - lumenH / 2 - wallH));
  inflBot.setAttribute("height", f1(wallH)); inflBot.setAttribute("y", f1(202 + lumenH / 2));
  inflTop.setAttribute("opacity", (0.08 + 0.5 * sv.infl).toFixed(2)); inflBot.setAttribute("opacity", (0.08 + 0.5 * sv.infl).toFixed(2));
  L.bronLumen.setAttribute("y", f1(202 - lumenH / 2)); L.bronLumen.setAttribute("height", f1(lumenH));
  epiCells.forEach((e, i) => place(e.g, e.x, 202 - lumenH / 2 + 8, 0, e.gob ? 0.8 + 0.4 * sv.muc : 1));
  mucBlobs.forEach((p) => { const v = clamp(sv.muc * 1.4 - p.k * 0.28); p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 800 + p.k) * 3) + " " + f1(202 + (p.k - 1) * 7) + ") scale(" + (0.15 + 0.85 * v).toFixed(2) + ")"); p.e.setAttribute("opacity", v > 0.05 ? "1" : "0"); });
  muscleCells.forEach((c, i) => { const sx = 1 - 0.22 * sv.narrow; c.y = 202 + lumenH / 2 + wallH + 12 + (i % 2) * 4; c.g.setAttribute("transform", "translate(" + f1(c.x) + " " + f1(c.y) + ") scale(" + sx.toFixed(2) + " 1)"); });
  /* cigarette ember lit while smoke flows, greyed out after cessation */
  const smoking = sv.smoke > 0.05;
  ember.setAttribute("class", smoking ? "copd-ember" : "copd-ember copd-out");
  emberGlow.setAttribute("opacity", smoking ? (0.45 + 0.3 * Math.sin(tm / 300)).toFixed(2) : "0");
  /* emphysema: sacs enlarge inside the lung, septa break, capillaries fade or oxygenate */
  sacs.forEach((s) => { const sc = 1 + 0.42 * sv.dmg; place(s.g, s.x, s.y, 0, sc); s.c.setAttribute("opacity", (1 - 0.25 * sv.dmg).toFixed(2)); });
  septs.forEach((s, i) => s.setAttribute("opacity", clamp(1 - sv.dmg * 1.15 + (i % 3) * 0.08).toFixed(2)));
  caps.forEach((c) => { c.e.setAttribute("opacity", clamp(1 - sv.dmg * 0.8).toFixed(2)); const want = drug === 3 ? "copd-cap copd-ox" : "copd-cap"; if (c.e.getAttribute("class") !== want) c.e.setAttribute("class", want); });
  /* bottom tube and trapped sac */
  const tubeH = Math.max(14, 32 - 18 * sv.narrow);
  L.flowTube.setAttribute("y", f1(411 - tubeH / 2)); L.flowTube.setAttribute("height", f1(tubeH));
  if (trapSac) trapSac.setAttribute("r", f1(16 + 20 * sv.trap + 2 * Math.sin(tm / 900)));
  /* smoke haze near the cigarette */
  acc.smoke += dt * sv.smoke * 7; while (acc.smoke >= 1) { acc.smoke--; const p = freeP(smokeP); if (p) emitP(p, rnd(48, 84), rnd(86, 106), rnd(22, 38), rnd(-8, -2)); }
  smokeP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 500 + p.x) * 0.25; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.5).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.2).toFixed(2)); if (p.t > 3.2 || p.x > 470) killP(p); });
  /* mucus droplets from goblet cells */
  acc.muc += dt * sv.muc * 5; while (acc.muc >= 1) { acc.muc--; const p = freeP(mucP); if (p) emitP(p, rnd(80, 420), 202 - lumenH / 2 + 10, rnd(8, 18), rnd(2, 8)); }
  mucP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2).toFixed(2)); if (p.t > 2) killP(p); });
  /* air flow in bottom tube */
  acc.air += dt * (2 + 9 * sv.air); while (acc.air >= 1) { acc.air--; const p = freeP(airP); if (p) emitP(p, 44, 411 + rnd(-tubeH / 3, tubeH / 3), 70 + 90 * sv.air, 0); }
  airP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt * (p.x > 320 && p.x < 430 ? 1 - 0.5 * sv.narrow : 1); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 700) killP(p); });
  /* oxygen stream rising from the lung base into the sacs */
  acc.o2 += dt * (drug === 3 ? 9 : sv.oxy * 2); while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2P); if (p) emitP(p, lungO.ports.base[0] + rnd(-35, 35), lungO.ports.base[1] - rnd(0, 20), rnd(-12, 12), rnd(-34, -20)); }
  o2P.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) killP(p); });
  /* exacerbation flare dots in bronchitis lumen */
  acc.flare += dt * sv.exac * 6; while (acc.flare >= 1) { acc.flare--; const p = freeP(flareP); if (p) emitP(p, rnd(60, 430), 202 + rnd(-10, 10), rnd(-6, 6), rnd(-6, 6)); }
  flareP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(sv.exac * (1 - p.t / 1.8)).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* bronchodilator diamonds home onto smooth muscle and sit on it while selected */
  bronP.forEach((p, i) => {
    const mc = muscleCells[i];
    if (drug === 1) {
      if (!p.on) emitP(p, rnd(60, 420), rnd(110, 140), 0, 30);
      const dx = mc.x - p.x, dy = mc.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < 9) { p.x = mc.x + Math.sin(tm / 400 + i * 2) * 2; p.y = mc.y + Math.cos(tm / 400 + i * 2) * 2; }
      else { const sp = 110 * dt; p.x += dx / d * sp; p.y += dy / d * sp; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")");
      p.e.setAttribute("opacity", "1");
    } else if (p.on) { p.t += dt; p.y -= 24 * dt; p.x -= 10 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) killP(p); }
  });
  /* steroid dots rain onto the airway lining and coat it while selected */
  acc.ster += dt * (drug === 2 ? 8 : 0); while (acc.ster >= 1) { acc.ster--; const p = freeP(sterP); if (p) emitP(p, rnd(60, 430), rnd(112, 126), rnd(-6, 6), rnd(45, 70)); }
  sterP.forEach((p) => {
    if (!p.on) return;
    if (drug !== 2) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t).toFixed(2)); if (p.t > 1) killP(p); return; }
    if (p.stuck) { p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 600 + p.y) * 0.8) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 2.5) / 2).toFixed(2)); if (p.t > 4.5) killP(p); }
    else {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const landY = 202 - lumenH / 2;
      if (p.y >= landY - 5) { p.stuck = true; p.t = 0; p.y = landY - 5 + rnd(-2, 2); }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      p.e.setAttribute("opacity", "1"); if (p.t > 3) killP(p);
    }
  });
  /* clean air drifts through after smoking stops */
  acc.clean += dt * (drug === 4 ? 8 : 0); while (acc.clean >= 1) { acc.clean--; const p = freeP(cleanP); if (p) emitP(p, 40, rnd(120, 260), rnd(40, 60), rnd(-4, 4)); }
  cleanP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 460 || p.t > 9) killP(p); });
  for (const d in dpills) dpills[d].style.opacity = dw[d].toFixed(2);
  gg.muc.set(sv.muc, wordOf(sv.muc, 0.3, 0.62, ["thin", "thick", "plugging"])); gg.dmg.set(sv.dmg, wordOf(sv.dmg, 0.28, 0.58, ["little", "some", "marked"])); gg.air.set(sv.air, wordOf(sv.air, 0.32, 0.62, ["low", "reduced", "open"]));
  gg.trap.set(sv.trap, wordOf(sv.trap, 0.3, 0.62, ["little", "some", "marked"])); gg.oxy.set(sv.oxyB, wordOf(sv.oxyB, 0.45, 0.7, ["low", "reduced", "near normal"])); gg.exac.set(sv.exac, wordOf(sv.exac, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
