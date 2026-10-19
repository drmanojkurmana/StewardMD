/* Cystic fibrosis scene: faulty CFTR channel, dry surface, mucus, cilia, Pseudomonas, lung, pancreas and sweat. */
const L = { lumen: $("lumen"), band: $("mucBand"), asl: $("asl"), mucus: $("mucG"), cilia: $("ciliaG"), epi: $("epiG"), chan: $("chanG"), bac: $("bacG"), parts: $("parts"), glow: $("glowG"), lungS: $("lungSlot"), pancS: $("pancSlot"), skinS: $("skinSlot"), sys: $("sysG"), over: $("over"), panel: $("panel") };
const Wd = SC.W;
/* ---- real organ anatomy; overlays and particles anchor to their ports ---- */
let lungO = null, pancO = null, skinO = null;
let lungHilum = [172, 316], pancTail = [404, 302], pancHead = [550, 302], pancMid = [477, 302], skinSurf = [790, 266];
let bronRing = null, bronPlug = null, pancPlug = null, lungGlow = null, capEl = null, capDrug = -1;
function initOrgans() {
  lungO = organ(L.lungS, "lung", 180, 305, 105, {});
  pancO = organ(L.pancS, "pancreas", 485, 308, 185, {});
  skinO = organ(L.skinS, "skin", 790, 305, 105, {});
  lungHilum = lungO.ports.hilumL || lungO.ports.hilum;
  pancTail = pancO.ports.tail; pancHead = pancO.ports.head;
  pancMid = [(pancTail[0] + pancHead[0]) / 2, (pancTail[1] + pancHead[1]) / 2];
  skinSurf = skinO.ports.surface;
  lungGlow = mk("ellipse", { class: "cf-glow", cx: f1(lungO.x), cy: f1(lungO.y + 10), rx: 105, ry: 85 }, L.glow);
  bronRing = mk("circle", { class: "bron-dil", cx: f1(lungHilum[0]), cy: f1(lungHilum[1]), r: 20 }, L.sys);
  bronPlug = mk("ellipse", { class: "cf-mucus", rx: 11, ry: 7 }, L.sys);
  mk("path", { class: "panc-d", d: "M" + f1(pancTail[0]) + " " + f1(pancTail[1]) + "L" + f1(pancHead[0]) + " " + f1(pancHead[1]) }, L.sys);
  pancPlug = mk("ellipse", { class: "cf-mucus", rx: 13, ry: 8 }, L.sys);
  place(bronPlug, lungHilum[0], lungHilum[1], 0, 1);
  place(pancPlug, pancMid[0], pancMid[1], 0, 1);
}
function capText(d) {
  if (d === 1) return "Modulator. More channels reach the surface, so salt and water return to the airway.";
  if (d === 2) return "Airway clearance. Loosened mucus is coughed out, but the channel stays faulty.";
  if (d === 3) return "Antibiotics. Pseudomonas falls back, but thick mucus and the faulty channel stay.";
  if (d === 4) return "Combined treatment. Open channels, a wet surface, cleared mucus and few germs.";
  return "No treatment. The faulty channel dries the surface, mucus plugs the airway and germs thrive.";
}
/* ---- airway lining: cells, cilia, channels, trapped protein ---- */
const epiCells = [], ciliaEls = [], chanX = [], clumps = [], enacEls = [], mucBlobs = [];
function initAirway() {
  for (let i = 0; i < 14; i++) {
    const x = 70 + i * 60, gob = i % 5 === 2, g = mk("g", {}, L.epi);
    cell(g, { cls: gob ? "gob" : "epi", r: 15, nuc: gob ? 0 : 0.32, seed: i + 2, wob: 0.05, n: 8 });
    place(g, x, 188, 0, 1);
    epiCells.push({ g, x });
    ciliaEls.push({ e: mk("path", { class: "cilia-l", d: "M" + x + " 174L" + x + " 160" }, L.cilia), x, i });
    if (i % 3 === 0) {
      const cg = mk("g", {}, L.chan);
      mk("rect", { class: "cftr-b", x: -6, y: -7, width: 4, height: 12, rx: 2 }, cg);
      mk("rect", { class: "cftr-b", x: 2, y: -7, width: 4, height: 12, rx: 2 }, cg);
      mk("circle", { class: "cftr-g", r: 3 }, cg);
      place(cg, x, 172, 0, 1);
      chanX.push(x);
      const mg = mk("g", {}, L.chan);
      cell(mg, { cls: "misf", r: 5, seed: i + 7, wob: 0.22, n: 7 });
      place(mg, x + 10, 196, 0, 1);
      clumps.push({ g: mg, x: x + 10, y: 196 });
    }
    if (i % 3 === 1) { const eg = mk("rect", { class: "enac-p", x: -3, y: -6, width: 6, height: 12, rx: 2 }, L.chan); eg.setAttribute("transform", "translate(" + x + " 172)"); enacEls.push(eg); }
  }
  for (let i = 0; i < 8; i++) mucBlobs.push({ e: mk("ellipse", { class: "cf-mucus", rx: 16, ry: 7 }, L.mucus), x: 96 + i * 104, k: i % 3 });
}
/* ---- Pseudomonas in the mucus ---- */
const BAC_N = 26, bac = [];
function initBac() {
  for (let i = 0; i < BAC_N; i++) {
    const rod = i % 3 !== 1, g = mk("g", { class: "cl cl-pse" }, L.bac);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6.2, ry: 3.2 } : { class: "cl-b", r: 3.8 }, g);
    mk("circle", { class: "cl-h", r: 1.3, cx: -1.3, cy: -1.1 }, g);
    bac.push({ g, x: rnd(48, 912), y: rnd(120, 148), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180) });
  }
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
const clP = pool(20, () => mk("circle", { class: "sc-p p-cl", r: 2.6 }, L.parts));
const naP = pool(14, () => mk("circle", { class: "sc-p p-na", r: 2.6 }, L.parts));
const watP = pool(12, () => mk("circle", { class: "sc-p p-water", r: 2.2 }, L.parts));
const airP = pool(20, () => mk("circle", { class: "sc-p p-water", r: 2.8 }, L.parts));
const modP = pool(10, () => mk("circle", { class: "sc-p p-mod", r: 3.6 }, L.parts));
const abxP = pool(12, () => mk("circle", { class: "sc-p p-abx", r: 3 }, L.parts));
const outP = pool(12, () => mk("ellipse", { class: "cf-mucus", rx: 9, ry: 4.5 }, L.parts));
const enzP = pool(10, () => mk("circle", { class: "sc-p p-enz", r: 2.4 }, L.parts));
const saltP = pool(14, () => mk("circle", { class: "sc-p p-salt", r: 2.6 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 225, 360, 495, 630, 765];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: Wd - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The airway and glands";
  [["cftr", "CFTR function", "g-good", "How much chloride channel function the lining has. Misfolded protein is held back, so little channel reaches the surface."], ["asl", "Surface liquid", "g-asl", "The thin watery layer cilia beat in. It dries out when chloride secretion fails and sodium uptake runs too fast."], ["muc", "Mucus", "g-mucCF", "Mucus on the airway surface. Dry mucus is thick and sticky and can plug the airway."], ["cil", "Cilia clearance", "g-cil", "Cilia sweeping mucus up and out. They stall when the surface is dry and mucus is thick."], ["pse", "Pseudomonas", "g-bac", "Pseudomonas germs living in trapped mucus. Lasting infection drives inflammation and damage."], ["dmg", "Airway damage", "g-dmgCF", "Lasting widening and scarring of the airway wall. It reverses little once established."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Airflow", 100, 104, 100, 58, "Air moving through the airway. Plugs and swollen walls narrow it.");
  pill(ox, "Thick mucus", 330, 130, 310, 58, "Dry mucus sitting on the surface. Clearance coughs it out; a modulator wets it over time.");
  pill(ox, "Cilia", 520, 168, 490, 58, "Tiny hairs on lining cells. They beat in the surface liquid and sweep mucus up, but stall in dry mucus.");
  pill(ox, "CFTR channel", 610, 172, 700, 58, "The faulty salt channel. Little chloride leaves the cell, sodium uptake runs too fast, and the surface dries.");
  pill(ox, "Lung damage", lungHilum[0], lungHilum[1], 180, 398, "Long standing infection scars the airway wide. This damage reverses little.");
  pill(ox, "Pancreas", pancMid[0], pancMid[1], 485, 398, "Thick secretion plugs the pancreatic duct, so enzymes cannot reach the gut.");
  pill(ox, "Salty sweat", skinSurf[0], skinSurf[1], 790, 398, "Salt stays in sweat because the duct cannot reclaim it. Sweat tastes salty.");
  capEl = mk("text", { class: "cf-cap", x: 30, y: 424 }, ox); capEl.textContent = capText(0);
}
const sv = { cftr: 0.2, asl: 0.2, muc: 0.5, cil: 0.4, inf: 0.4, dmg: 0.4, air: 0.5, naAbs: 0.7, sweat: 0.8, panc: 0.5, mod: 0, clr: 0, abx: 0 };
const acc = { cl: 0, na: 0, wat: 0, air: 0, out: 0, enz: 0, salt: 0 };
let mucTop = 130, aslTop = 158;
function init() { initOrgans(); initAirway(); initBac(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  for (const q of ["cftr", "asl", "muc", "cil", "inf", "air", "naAbs", "mod", "clr", "abx"]) sv[q] = lerp(sv[q], m[q], k1);
  for (const q of ["dmg", "sweat", "panc"]) sv[q] = lerp(sv[q], m[q], k2);
  /* surface liquid depth and the mucus blanket sitting on it */
  const aslH = 5 + 15 * sv.asl;
  aslTop = 158 - aslH;
  L.asl.setAttribute("y", f1(aslTop)); L.asl.setAttribute("height", f1(aslH));
  const mucH = 2 + 34 * sv.muc;
  mucTop = aslTop - mucH;
  L.band.setAttribute("y", f1(mucTop)); L.band.setAttribute("height", f1(mucH + 1));
  L.band.setAttribute("opacity", (0.25 + 0.75 * sv.muc).toFixed(2));
  mucBlobs.forEach((p) => {
    p.x += dt * (4 + 46 * sv.clr); if (p.x > 912) p.x = 56;
    const v = clamp(sv.muc * 1.35 - p.k * 0.26);
    p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 900 + p.k) * 3) + " " + f1(mucTop + 3) + ") scale(" + (0.15 + 0.9 * v).toFixed(2) + ")");
    p.e.setAttribute("opacity", v > 0.05 ? "1" : "0");
  });
  /* lining cells, beating cilia, channels and trapped protein */
  epiCells.forEach((e, i) => place(e.g, e.x, 188 + Math.sin(tm / 1600 + i) * 0.7, 0, 1));
  ciliaEls.forEach((c) => { const len = 8 + 10 * sv.cil, sway = Math.sin(tm / (240 + 260 * (1 - sv.cil)) + c.i * 0.7) * (1.5 + 5 * sv.cil); c.e.setAttribute("d", "M" + c.x + " 174L" + f1(c.x + sway) + " " + f1(174 - len)); });
  L.chan.querySelectorAll(".cftr-b").forEach((e) => { e.setAttribute("opacity", (0.35 + 0.65 * sv.cftr).toFixed(2)); });
  L.chan.querySelectorAll(".cftr-g").forEach((e) => { e.setAttribute("opacity", (0.15 + 0.85 * sv.cftr).toFixed(2)); });
  enacEls.forEach((e) => { e.setAttribute("opacity", (0.25 + 0.75 * sv.naAbs).toFixed(2)); });
  clumps.forEach((c) => { const s = clamp(1.15 - sv.cftr * 1.25); c.g.setAttribute("opacity", s > 0.05 ? "1" : "0"); place(c.g, c.x, c.y, 0, Math.max(0.12, s)); });
  /* modulator dots park on the trapped protein; antibiotic dots swarm the germs */
  modP.forEach((p, i) => {
    const c = clumps[i % clumps.length];
    if (!p.on) emitP(p, c.x + rnd(-40, 40), c.y - rnd(10, 50), 0, 0);
    p.x = lerp(p.x, c.x, Math.min(1, dt * 3)); p.y = lerp(p.y, c.y, Math.min(1, dt * 3));
    p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 500 + i) * 1.5) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", sv.mod > 0.04 ? sv.mod.toFixed(2) : "0");
  });
  abxP.forEach((p, i) => {
    const b = bac[i % bac.length];
    if (!p.on) emitP(p, b.x, b.y, 0, 0);
    p.x = lerp(p.x, b.x + Math.cos(tm / 300 + i * 2.1) * 11, Math.min(1, dt * 4));
    p.y = lerp(p.y, b.y + Math.sin(tm / 360 + i * 1.7) * 7, Math.min(1, dt * 4));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", sv.abx > 0.04 ? sv.abx.toFixed(2) : "0");
  });
  /* Pseudomonas grows in trapped mucus */
  const want = Math.round(sv.inf * BAC_N), yLo = mucTop + 4, yHi = Math.max(yLo + 2, aslTop - 2);
  bac.forEach((b, i) => {
    const on = i < want;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.3 : 2 + 2 * sv.abx)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 6 * dt; b.y += Math.sin(b.a) * 4 * dt;
    if (b.x < 46 || b.x > 914) b.a = Math.PI - b.a;
    if (b.y < yLo || b.y > yHi) b.a = -b.a;
    b.x = clamp(b.x, 46, 914); b.y = clamp(b.y, yLo, yHi);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 14, Math.max(0.01, b.s)); b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  /* chloride out through CFTR, sodium in, water follows salt */
  acc.cl += dt * sv.cftr * 11; while (acc.cl >= 1) { acc.cl--; const p = freeP(clP); if (p) emitP(p, chanX[Math.floor(Math.random() * chanX.length)] + rnd(-3, 3), 168, rnd(-4, 4), rnd(-34, -24)); }
  clP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < aslTop + 2 || p.t > 2.4) killP(p); });
  acc.na += dt * sv.naAbs * 8; while (acc.na >= 1) { acc.na--; const p = freeP(naP); if (p) emitP(p, rnd(56, 908), aslTop + 3, rnd(-3, 3), rnd(24, 33)); }
  naP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 190 || p.t > 2.4) killP(p); });
  acc.wat += dt * sv.asl * 7; while (acc.wat >= 1) { acc.wat--; const p = freeP(watP); if (p) emitP(p, rnd(56, 908), 184, rnd(-3, 3), rnd(-28, -20)); }
  watP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.y < aslTop + 2 || p.t > 1.8) killP(p); });
  /* airflow through the lumen */
  acc.air += dt * (2 + 8 * sv.air); while (acc.air >= 1) { acc.air--; const p = freeP(airP); if (p) emitP(p, 38, rnd(86, 128), 50 + 90 * sv.air, 0); }
  airP.forEach((p) => { if (!p.on) return; p.x += (p.vx * dt); p.y += Math.sin(tm / 500 + p.y) * 4 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 922) killP(p); });
  /* clearance coughs mucus out to the right */
  acc.out += dt * sv.clr * (2 + 8 * sv.muc); while (acc.out >= 1) { acc.out--; const p = freeP(outP); if (p) { emitP(p, rnd(60, 500), mucTop + rnd(0, 5), rnd(120, 170), rnd(-6, 6)); } }
  outP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.x - 780) / 140).toFixed(2)); if (p.x > 920 || p.t > 4) killP(p); });
  /* organs: inflamed lung glow, dilated ring with a mucus plug, plugged pancreatic duct, salty skin */
  lungGlow.setAttribute("opacity", (sv.inf * 0.4).toFixed(2));
  bronRing.setAttribute("r", f1(12 + 12 * sv.dmg + Math.sin(tm / 1100) * 0.8));
  place(bronPlug, lungHilum[0], lungHilum[1], 0, Math.max(0.12, sv.muc));
  bronPlug.setAttribute("opacity", sv.muc > 0.06 ? "1" : "0");
  place(pancPlug, pancMid[0], pancMid[1], 0, Math.max(0.12, sv.muc));
  pancPlug.setAttribute("opacity", sv.muc > 0.06 ? "1" : "0");
  acc.enz += dt * (1 - sv.panc) * 6; while (acc.enz >= 1) { acc.enz--; const p = freeP(enzP); if (p) emitP(p, pancHead[0], pancHead[1], rnd(18, 30), rnd(-4, 6)); }
  enzP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.9).toFixed(2)); if (p.t > 1.9 || p.x > 640) killP(p); });
  acc.salt += dt * sv.sweat * 6; while (acc.salt >= 1) { acc.salt--; const p = freeP(saltP); if (p) emitP(p, skinSurf[0] + rnd(-30, 30), skinSurf[1], rnd(-3, 3), rnd(-26, -18)); }
  saltP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < skinSurf[1] - 44 || p.t > 1.8) killP(p); });
  gg.cftr.set(sv.cftr, wordOf(sv.cftr, 0.3, 0.55, ["low", "partly restored", "restored"])); gg.asl.set(sv.asl, wordOf(sv.asl, 0.3, 0.58, ["dry", "thin", "hydrated"])); gg.muc.set(sv.muc, wordOf(sv.muc, 0.32, 0.62, ["thin", "thick", "plugging"]));
  gg.cil.set(sv.cil, wordOf(sv.cil, 0.3, 0.58, ["stalled", "slow", "sweeping"])); gg.pse.set(sv.inf, wordOf(sv.inf, 0.25, 0.55, ["low", "present", "high"])); gg.dmg.set(sv.dmg, wordOf(sv.dmg, 0.3, 0.62, ["little", "some", "marked"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
