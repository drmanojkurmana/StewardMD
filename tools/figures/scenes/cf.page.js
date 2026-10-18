/* Cystic fibrosis scene: CFTR and sodium channels, surface liquid, mucus, cilia, Pseudomonas, bronchiectasis, pancreas, sweat and gauges. */
const L = { lumen: $("lumen"), asl: $("asl"), mucus: $("mucusG"), cilia: $("ciliaG"), epi: $("epiG"), chan: $("chanG"), bac: $("bacG"), parts: $("parts"), gland: $("glandG"), bron: $("bronG"), panc: $("pancG"), sweat: $("sweatG"), over: $("over"), panel: $("panel") };
const Wd = SC.W;
/* ---- airway epithelium, cilia, channels ---- */
const epiCells = [], ciliaEls = [], cftrEls = [], enacEls = [], misfEls = [], mucBlobs = [];
function initAirway() {
  for (let i = 0; i < 24; i++) {
    const x = 52 + i * 37, gob = i % 5 === 2, g = mk("g", {}, L.epi);
    cell(g, { cls: gob ? "gob" : "epi", r: 15, nuc: gob ? 0 : 0.32, seed: i + 2, wob: 0.05, n: 8 });
    epiCells.push({ g, x });
    ciliaEls.push({ e: mk("path", { class: "cilia-l", d: "M" + x + " 168L" + x + " 152" }, L.cilia), x, i });
    if (i % 3 === 0) {
      const cg = mk("g", {}, L.chan), p = mk("path", { class: "cftr-p", d: "M-4 -5L0 0L4 -5M0 0L0 5" }, cg); place(cg, x, 166, 0, 1); cftrEls.push(cg);
      const mg = mk("g", {}, L.chan); cell(mg, { cls: "misf", r: 5, seed: i + 7, wob: 0.22, n: 7 }); place(mg, x + 7, 209, 0, 1); misfEls.push(mg);
    }
    if (i % 3 === 1) { const eg = mk("rect", { class: "enac-p", x: -3, y: -5, width: 6, height: 10, rx: 2 }, L.chan); eg.setAttribute("transform", "translate(" + x + " 166)"); enacEls.push(eg); }
  }
  for (let i = 0; i < 8; i++) mucBlobs.push({ e: mk("ellipse", { class: "cf-mucus", rx: 17, ry: 8 }, L.mucus), x: 96 + i * 104, k: i % 3 });
  [[265, 240], [745, 240]].forEach(([gx, gy]) => { const g = mk("g", {}, L.gland); for (let j = 0; j < 5; j++) mk("circle", { class: "gland-b", r: 6, cx: f1(Math.cos(j * 1.26) * 10), cy: f1(Math.sin(j * 1.26) * 7) }, g); place(g, gx, gy, 0, 1); });
}
/* ---- Pseudomonas in the mucus ---- */
const BAC_N = 30, bac = [];
function initBac() {
  for (let i = 0; i < BAC_N; i++) {
    const rod = i % 3 !== 1, g = mk("g", { class: "cl cl-pse" }, L.bac);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6.2, ry: 3.2 } : { class: "cl-b", r: 3.8 }, g);
    mk("circle", { class: "cl-h", r: 1.3, cx: -1.3, cy: -1.1 }, g);
    bac.push({ g, x: rnd(48, 912), y: rnd(136, 154), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180) });
  }
}
/* ---- lower panels: bronchiectasis, pancreas, sweat gland ---- */
let bronTube = null, bronDil = null;
function initSys() {
  bronTube = mk("rect", { class: "bron-tube", x: 56, y: 366, width: 168, height: 24, rx: 12 }, L.bron);
  bronDil = mk("circle", { class: "bron-dil", cx: 262, cy: 378, r: 18 }, L.bron);
  mk("ellipse", { class: "panc-b", cx: 462, cy: 368, rx: 62, ry: 21 }, L.panc);
  mk("ellipse", { class: "panc-b", cx: 512, cy: 360, rx: 26, ry: 15 }, L.panc);
  mk("path", { class: "panc-d", d: "M400 368L548 368" }, L.panc);
  [[724, 374], [744, 382], [764, 374], [744, 362]].forEach(([cx, cy]) => mk("circle", { class: "sweat-b", r: 10, cx, cy }, L.sweat));
  mk("path", { class: "sweat-d", d: "M760 356L760 338L776 338" }, L.sweat);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const clP = pool(24, () => mk("circle", { class: "sc-p p-cl", r: 2.6 }, L.parts));
const naP = pool(18, () => mk("circle", { class: "sc-p p-na", r: 2.6 }, L.parts));
const watP = pool(18, () => mk("circle", { class: "sc-p p-water", r: 2.2 }, L.parts));
const airP = pool(22, () => mk("circle", { class: "sc-p p-water", r: 2.8 }, L.parts));
const enzP = pool(12, () => mk("circle", { class: "sc-p p-enz", r: 2.6 }, L.parts));
const saltP = pool(14, () => mk("circle", { class: "sc-p p-salt", r: 2.6 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {}, dpills = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: Wd - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The airway and glands";
  [["cftr", "CFTR function", "g-good", "How much chloride channel function the epithelium has. F508del misfolding keeps most protein off the surface; gating variants fault channels that do arrive."], ["asl", "Surface liquid", "g-asl", "The airway surface liquid cilia beat in. It thins when chloride secretion falls and sodium uptake rises, so transport dries the surface."], ["muc", "Mucus", "g-mucCF", "Mucus on the airway surface. Dehydrated mucus is thick and sticky and can plug the airway."], ["cil", "Cilia clearance", "g-cil", "Mucociliary clearance: cilia sweeping mucus up and out. It fails when the surface liquid is dry and mucus is thick."], ["pse", "Pseudomonas", "g-bac", "Pseudomonas infection living in retained mucus. Chronic infection drives inflammation and airway damage."], ["dmg", "Airway damage", "g-dmgCF", "Bronchiectasis: permanently widened, damaged airways from chronic infection and inflammation. It reverses little."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Airflow", 72, 112, 110, 102, "Air moving through the airway lumen. Thick mucus, plugging and damaged walls reduce it.");
  pill(ox, "Mucus", 320, 148, 300, 102, "Thick mucus sitting on the surface liquid. Airway clearance helps move it out; a modulator makes it less dry over time.");
  pill(ox, "Cilia", 478, 158, 478, 102, "Cilia on epithelial cells. They beat in the surface liquid and sweep mucus upward, but stall in dry, thick mucus.");
  pill(ox, "Pseudomonas", 682, 144, 682, 102, "Pseudomonas bacteria in retained mucus. Antibiotics reduce them; they return easily while mucus stays trapped.");
  pill(ox, "Surface liquid", 858, 156, 858, 102, "Airway surface liquid: the thin watery layer cilia beat in. Chloride and bicarbonate secretion holds water here; sodium hyperabsorption pulls it away.");
  pill(ox, "CFTR channel", 64, 166, 150, 258, "CFTR: the epithelial chloride and bicarbonate channel in the cell surface. Faulty secretion dries the airway surface.");
  pill(ox, "F508del protein", 176, 208, 380, 258, "F508del: the common variant. The protein misfolds, is held back and broken down, so little channel reaches the surface. A modulator helps some of it arrive and open.");
  pill(ox, "Sodium channel", 89, 166, 610, 258, "The epithelial sodium channel. Without CFTR restraint sodium uptake is too fast, water follows it off the surface, and the liquid layer thins.");
  pill(ox, "Submucosal gland", 745, 240, 830, 258, "Submucosal glands: exocrine glands under the lining that add fluid and mucus. Their ducts can plug with thick secretion.");
  pill(ox, "Bronchiectasis", 262, 378, 177, 410, "Bronchiectasis: a permanently widened, scarred airway. Retained mucus and Pseudomonas infection keep damaging the wall.");
  pill(ox, "Pancreas", 462, 368, 480, 410, "Pancreas: the same channel defect plugs exocrine ducts, enzyme output falls, and fat digestion suffers.");
  pill(ox, "Sweat chloride", 760, 352, 783, 410, "Sweat gland: salt is normally reclaimed from sweat as it passes up the duct. With CFTR faulty, sweat chloride stays high.");
  [[1, "Modulator", 64, 166, "A CFTR modulator helps the misfolded protein reach the surface and open, partly restoring chloride secretion."], [2, "Airway clearance", 320, 148, "Airway clearance loosens and moves thick mucus and bacteria out. The channel itself stays faulty."], [3, "Antibiotics", 682, 144, "Antibiotics reduce Pseudomonas in the mucus. The channel and established wall damage stay."], [4, "Combined treatment", 478, 158, "Modulator with clearance and antibiotics: channel, mucus and infection are each acted on. Bronchiectasis reverses little."]]
    .forEach(([d, n, ax, ay, tip]) => { dpills[d] = pill(ox, n, ax, ay, 480, 62, tip); dpills[d].style.opacity = 0; });
}
const sv = { cftr: 0.2, asl: 0.2, muc: 0.5, cil: 0.4, inf: 0.4, dmg: 0.4, air: 0.5, naAbs: 0.7, sweat: 0.8, panc: 0.5 };
const acc = { cl: 0, na: 0, wat: 0, air: 0, enz: 0, salt: 0 };
const dw = [1, 0, 0, 0, 0];
function init() { initAirway(); initBac(); initSys(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  for (const q of ["cftr", "asl", "muc", "cil", "inf", "dmg", "air", "naAbs", "sweat", "panc"]) sv[q] = lerp(sv[q], m[q], k2);
  dw.forEach((_, d) => { dw[d] = lerp(dw[d], m.drug === d ? 1 : 0, k1); });
  /* surface liquid depth and mucus sitting on it */
  const aslH = 6 + 16 * sv.asl, aslTop = 168 - aslH;
  L.asl.setAttribute("y", f1(aslTop)); L.asl.setAttribute("height", f1(aslH));
  mucBlobs.forEach((p) => { const v = clamp(sv.muc * 1.35 - p.k * 0.26); p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 900 + p.k) * 3) + " " + f1(aslTop - 4) + ") scale(" + (0.15 + 0.9 * v).toFixed(2) + ")"); p.e.setAttribute("opacity", v > 0.05 ? "1" : "0"); });
  /* epithelium, cilia beat, channels and misfolded protein */
  epiCells.forEach((e, i) => place(e.g, e.x, 198 + Math.sin(tm / 1600 + i) * 0.7, 0, 1));
  ciliaEls.forEach((c) => { const len = 9 + 11 * sv.cil, sway = Math.sin(tm / (240 + 260 * (1 - sv.cil)) + c.i * 0.7) * (1.5 + 5 * sv.cil); c.e.setAttribute("d", "M" + c.x + " 168L" + f1(c.x + sway) + " " + f1(168 - len)); });
  cftrEls.forEach((e) => { e.style.opacity = (0.18 + 0.82 * sv.cftr).toFixed(2); });
  enacEls.forEach((e) => { e.style.opacity = (0.25 + 0.75 * sv.naAbs).toFixed(2); });
  misfEls.forEach((e, i) => { const s = clamp(1.15 - sv.cftr * 1.25); e.style.opacity = s > 0.05 ? "1" : "0"; place(e, 59 + i * 111, 209, 0, Math.max(0.12, s)); });
  /* Pseudomonas grows in retained mucus */
  const want = Math.round(sv.inf * BAC_N);
  bac.forEach((b, i) => {
    const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.3 : 2.4)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 6 * dt; b.y += Math.sin(b.a) * 4 * dt;
    if (b.x < 46 || b.x > 914) b.a = Math.PI - b.a; if (b.y < 134 || b.y > 156) b.a = -b.a;
    b.x = clamp(b.x, 46, 914); b.y = clamp(b.y, 134, 156);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 14, Math.max(0.01, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  /* chloride and bicarbonate out through CFTR, sodium in through the sodium channel, water follows salt */
  acc.cl += dt * sv.cftr * 11; while (acc.cl >= 1) { acc.cl--; const p = freeP(clP); if (p) emitP(p, rnd(56, 908), 188, rnd(-4, 4), rnd(-34, -24)); }
  clP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < aslTop + 3 || p.t > 2.4) killP(p); });
  acc.na += dt * sv.naAbs * 8; while (acc.na >= 1) { acc.na--; const p = freeP(naP); if (p) emitP(p, rnd(56, 908), aslTop + 4, rnd(-3, 3), rnd(24, 33)); }
  naP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 190 || p.t > 2.4) killP(p); });
  acc.wat += dt * sv.asl * 7; while (acc.wat >= 1) { acc.wat--; const p = freeP(watP); if (p) emitP(p, rnd(56, 908), 186, rnd(-3, 3), rnd(-28, -20)); }
  watP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.y < aslTop + 2 || p.t > 1.8) killP(p); });
  /* airflow through the lumen */
  acc.air += dt * (2 + 8 * sv.air); while (acc.air >= 1) { acc.air--; const p = freeP(airP); if (p) emitP(p, 38, rnd(92, 134), 65 + 85 * sv.air, 0); }
  airP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt * (p.y > 128 ? 1 - 0.35 * sv.muc : 1); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 922) killP(p); });
  /* lower panels */
  if (bronTube) { const bh = 22 + 20 * sv.dmg; bronTube.setAttribute("y", f1(378 - bh / 2)); bronTube.setAttribute("height", f1(bh)); }
  if (bronDil) bronDil.setAttribute("r", f1(15 + 13 * sv.dmg + Math.sin(tm / 1100) * 0.8));
  acc.enz += dt * (1 - sv.panc) * 6; while (acc.enz >= 1) { acc.enz--; const p = freeP(enzP); if (p) emitP(p, 548, 368, rnd(18, 30), rnd(-4, 6)); }
  enzP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.9).toFixed(2)); if (p.t > 1.9 || p.x > 612) killP(p); });
  acc.salt += dt * sv.sweat * 6; while (acc.salt >= 1) { acc.salt--; const p = freeP(saltP); if (p) emitP(p, 744, 366, rnd(-3, 3), rnd(-26, -18)); }
  saltP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(Math.max(660, Math.min(910, p.x))) + " " + f1(Math.max(334, p.y)) + ")"); if (p.y < 336 || p.t > 1.8) killP(p); });
  for (const d in dpills) dpills[d].style.opacity = dw[d].toFixed(2);
  gg.cftr.set(sv.cftr, wordOf(sv.cftr, 0.3, 0.55, ["low", "partly restored", "restored"])); gg.asl.set(sv.asl, wordOf(sv.asl, 0.3, 0.58, ["dry", "thin", "hydrated"])); gg.muc.set(sv.muc, wordOf(sv.muc, 0.32, 0.62, ["thin", "thick", "plugging"]));
  gg.cil.set(sv.cil, wordOf(sv.cil, 0.3, 0.58, ["stalled", "slow", "sweeping"])); gg.pse.set(sv.inf, wordOf(sv.inf, 0.25, 0.55, ["low", "present", "high"])); gg.dmg.set(sv.dmg, wordOf(sv.dmg, 0.3, 0.62, ["little", "some", "marked"]));
}
run({ init, step });
