/* Haem synthesis scene: pathway flux across mitochondrion and cytosol, blocks, drug actions, gut and nerve pain. */
const FY = SC.FY, WW = SC.W;
const layers = { parts: $("parts"), blocks: $("blocks"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, t: 0, k: 0, st: 0, u: 0, tr: null }; }); }
const subP = pool(14, () => mk("circle", { class: "sc-p p-sub", r: 3 }, layers.parts));
const alaP = pool(26, () => mk("circle", { class: "sc-p p-ala", r: 3.1 }, layers.parts));
const pbgP = pool(26, () => mk("circle", { class: "sc-p p-pbg", r: 3.1 }, layers.parts));
const porP = pool(26, () => mk("rect", { class: "sc-p p-por", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1.2 }, layers.parts));
const haemP = pool(16, () => mk("circle", { class: "sc-p p-haem", r: 3.6 }, layers.parts));
const leadP = pool(16, () => mk("circle", { class: "hs-lead", r: 3.4 }, layers.parts));
const treatP = pool(16, () => mk("circle", { class: "sc-p p-treat", r: 3 }, layers.parts));
const excP = pool(12, () => mk("circle", { class: "hs-exc", r: 3 }, layers.parts));
const trigP = pool(12, () => mk("circle", { class: "hs-trig", r: 2.6 }, layers.parts));
const toxP = pool(18, () => mk("circle", { class: "sc-p p-ala", r: 3 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.u = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function moveSeg(pl, dt, x0, x1, jamX, jam) {
  pl.forEach((p) => { if (!p.on) return; p.t += dt; const near = jam && p.x > jamX - 34 && p.x < jamX + 6; p.x += p.vx * dt * (near ? 0.22 : 1); p.y = FY + p.k + Math.sin(tm / 360 + p.x * 0.05) * 2.2; p.x = clamp(p.x, 24, WW - 24); p.y = clamp(p.y, 56, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x >= x1 - 3 || p.t > 9) killP(p); });
}
/* ---- organs, tracks, marks ---- */
let bowelO = null, nerveO = null, toxGut = null, toxNerve = null;
let hazeA = null, hazeP = null, haloEl = null, shieldEl = null, glowGut = null, glowNerve = null;
const gg = {};
const blockMarks = {};
const leadcaps = [];
let capEl = null, capKey = "";
function blockMark(x, y) { const g = mk("g", { opacity: "0" }, layers.blocks); mk("path", { class: "hs-block", d: "M-13 -13L13 13M13 -13L-13 13" }, g); g.setAttribute("transform", "translate(" + x + " " + y + ")"); return g; }
function capText(l, d) {
  if (l === 0) return "No disease. The pathway runs steadily from start to haem.";
  if (l === 1 && d === 0) return "Lead poisoning. Lead blocks enzymes in the path. ALA builds up, haem falls.";
  if (l === 1 && d === 2) return "Chelation grabs lead and carries it away. The enzymes work again.";
  if (l === 1) return "This treatment does not act on lead. The picture stays the same.";
  if (l === 2 && d === 0) return "Porphyria attack. PBG deaminase is faulty. ALA and PBG pile up.";
  if (l === 2 && d === 1) return "Haem and glucose switch off the first enzyme. The pileup drains.";
  if (l === 2 && d === 3) return "Avoiding triggers calms the first enzyme. Smaller pileup, less pain.";
  return "Chelation does not fix this enzyme fault. The picture stays the same.";
}
function initOrgans() {
  hazeA = $("hazeAla"); hazeP = $("hazePbg"); haloEl = $("halo"); shieldEl = $("shield");
  glowGut = $("glowGut"); glowNerve = $("glowNerve");
  bowelO = organ($("bowelSlot"), "bowel", 668, 380, 96, {});
  nerveO = organ($("nerveSlot"), "ganglion", 836, 380, 72, {});
  bowelO.g.setAttribute("data-info", "Gut. In attacks, built up precursors bring severe belly pain.");
  bowelO.g.setAttribute("class", (bowelO.g.getAttribute("class") || "") + " hot");
  nerveO.g.setAttribute("data-info", "Nerve. In attacks, built up precursors damage nerves, causing pain and weakness.");
  nerveO.g.setAttribute("class", (nerveO.g.getAttribute("class") || "") + " hot");
  toxGut = track([[470, 224], [560, 300], [620, 352], bowelO.ports.coils]);
  toxNerve = track([[505, 224], [640, 292], [745, 342], nerveO.ports.soma]);
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 250, 410, 570, 730];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ala", "ALA", "g-ala", "Aminolaevulinic acid (ALA), the first product of the pathway. It builds up when a later step is blocked or when the first enzyme is driven up."], ["pbg", "PBG", "g-pbg", "Porphobilinogen (PBG), made from ALA in the cytosol. It builds up ahead of faulty PBG deaminase in acute intermittent porphyria."], ["por", "Porphyrins", "g-por", "Porphyrin intermediates between PBG and haem. They build up when ferrochelatase is blocked by lead."], ["haem", "Haem", "g-haemg", "Haem, the finished product. Ferrochelatase inserts iron into protoporphyrin to make it. Haem restrains the first enzyme by feedback."], ["sym", "Symptoms", "g-sym", "Belly pain and nerve pain with weakness in attacks of acute intermittent porphyria, and ill health when haem falls."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Start", 86, FY - 12, 118, 106, "Start materials in the mitochondrion. The first enzyme joins them to make ALA.");
  pill(ox, "ALA", 255, FY - 12, 262, 106, "ALA. It leaves the mitochondrion for the cytosol and builds up in both diseases.");
  pill(ox, "PBG", 440, FY - 12, 442, 106, "PBG. Units of PBG link into chains. They pile up before the faulty step in porphyria.");
  pill(ox, "Haem", 882, FY - 18, 884, 106, "Haem, the finished product. It feeds back to restrain the first enzyme.");
  pill(ox, "ALA dehydratase", 350, FY + 24, 350, 318, "ALA dehydratase. It joins ALA units to make PBG. Lead blocks this enzyme.");
  pill(ox, "Later steps", 600, FY + 24, 540, 318, "Later steps. PBG deaminase starts a chain that becomes porphyrins, then the last enzyme adds iron to finish haem. Lead blocks the last step.");
  pill(ox, "Belly pain", 656, 348, 700, 318, "Belly pain in attacks. Built up ALA and PBG irritate gut nerves.");
  pill(ox, "Nerve pain", 828, 350, 850, 318, "Nerve pain and weakness in attacks. Built up ALA and PBG harm nerves.");
  capEl = mk("text", { class: "hs-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 0);
  blockMarks.dehyd = blockMark(350, FY); blockMarks.deam = blockMark(525, FY); blockMarks.ferro = blockMark(815, FY);
  [[334, 174, "dehyd"], [366, 206, "dehyd"], [799, 174, "ferro"], [831, 206, "ferro"]].forEach(([x, y, w]) => {
    const e = mk("circle", { class: "hs-leadcap", cx: x, cy: y, r: 8, opacity: "0" }, layers.blocks);
    leadcaps.push({ e, w });
  });
}
const sm = { D: 0.4, dehyd: 1, deam: 1, ferro: 1, ALA: 0.2, PBG: 0.2, Por: 0.2, Haem: 0.8, Sym: 0, chel: 0, hg: 0, avd: 0 };
const acc = { sub: 0, ala: 0, pbg: 0, por: 0, haem: 0, lead: 0, treat: 0, exc: 0, trig: 0, tox: 0, side: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.D = lerp(sm.D, m.D, k2); sm.dehyd = lerp(sm.dehyd, m.dehyd, k1); sm.deam = lerp(sm.deam, m.deam, k1); sm.ferro = lerp(sm.ferro, m.ferro, k1);
  sm.ALA = lerp(sm.ALA, m.ALA, k2); sm.PBG = lerp(sm.PBG, m.PBG, k2); sm.Por = lerp(sm.Por, m.Por, k2); sm.Haem = lerp(sm.Haem, m.Haem, k2); sm.Sym = lerp(sm.Sym, m.Sym, k2);
  const chelT = m.drug === 2 && m.level === 1 ? 1 : 0, hgT = m.drug === 1 && m.level === 2 ? 1 : 0, avdT = m.drug === 3 && m.level === 2 ? 1 : 0;
  sm.chel = lerp(sm.chel, chelT, k1); sm.hg = lerp(sm.hg, hgT, k1); sm.avd = lerp(sm.avd, avdT, k1);
  blockMarks.dehyd.setAttribute("opacity", clamp((0.72 - sm.dehyd) * 1.8).toFixed(2));
  blockMarks.deam.setAttribute("opacity", clamp((0.72 - sm.deam) * 1.8).toFixed(2));
  blockMarks.ferro.setAttribute("opacity", clamp((0.72 - sm.ferro) * 1.8).toFixed(2));
  leadcaps.forEach((c) => { const v = m.level === 1 ? clamp((0.72 - (c.w === "dehyd" ? sm.dehyd : sm.ferro)) * 1.8) : 0; c.e.setAttribute("opacity", v.toFixed(2)); });
  haloEl.setAttribute("opacity", hgT ? "0.95" : "0");
  shieldEl.setAttribute("opacity", avdT ? "0.9" : "0");
  hazeA.setAttribute("opacity", clamp(0.6 * m.ALA).toFixed(2));
  hazeA.setAttribute("rx", f1(70 + 70 * m.ALA));
  hazeP.setAttribute("opacity", clamp(0.6 * m.PBG).toFixed(2));
  hazeP.setAttribute("rx", f1(70 + 75 * m.PBG));
  glowGut.setAttribute("opacity", clamp(0.5 * m.Sym).toFixed(2));
  glowNerve.setAttribute("opacity", clamp(0.5 * m.Sym).toFixed(2));
  const calm = 1 - 0.8 * sm.hg;
  $("enz1").setAttribute("transform", "translate(150 " + FY + ") scale(" + (1 + 0.07 * sm.D * calm * Math.sin(tm / 300)).toFixed(3) + ") translate(-150 -" + FY + ")");
  $("enz2").setAttribute("transform", "translate(350 " + FY + ") scale(" + (0.92 + 0.1 * sm.dehyd).toFixed(3) + ") translate(-350 -" + FY + ")");
  $("enz3").setAttribute("transform", "translate(525 " + FY + ") scale(" + (0.92 + 0.1 * sm.deam).toFixed(3) + ") translate(-525 -" + FY + ")");
  $("enz4").setAttribute("transform", "translate(815 " + FY + ") scale(" + (0.92 + 0.1 * sm.ferro).toFixed(3) + ") translate(-815 -" + FY + ")");
  const fb = document.querySelector(".hs-feedback"); if (fb) fb.style.opacity = (0.14 + 0.55 * sm.Haem).toFixed(2);
  acc.sub += dt * sm.D * 7; while (acc.sub >= 1) { acc.sub--; const p = freeP(subP); if (p) emit(p, 82, FY, rnd(26, 36), 0, rnd(-9, 9)); }
  moveSeg(subP, dt, 82, 150, 150, false);
  acc.ala += dt * sm.D * 9; while (acc.ala >= 1) { acc.ala--; const p = freeP(alaP); if (p) emit(p, 158, FY, rnd(30, 42), 0, rnd(-10, 10)); }
  moveSeg(alaP, dt, 158, 350, 350, sm.dehyd < 0.6);
  acc.pbg += dt * sm.D * sm.dehyd * 9; while (acc.pbg >= 1) { acc.pbg--; const p = freeP(pbgP); if (p) emit(p, 358, FY, rnd(30, 42), 0, rnd(-10, 10)); }
  moveSeg(pbgP, dt, 358, 525, 525, sm.deam < 0.6);
  acc.por += dt * sm.D * sm.dehyd * sm.deam * 8; while (acc.por >= 1) { acc.por--; const p = freeP(porP); if (p) emit(p, 533, FY, rnd(30, 42), 0, rnd(-11, 11)); }
  moveSeg(porP, dt, 533, 815, 815, sm.ferro < 0.6);
  acc.haem += dt * sm.D * sm.dehyd * sm.deam * sm.ferro * 8 + dt * sm.hg * 2.5; while (acc.haem >= 1) { acc.haem--; const p = freeP(haemP); if (p) emit(p, 823, FY, rnd(24, 34), 0, rnd(-8, 8)); }
  moveSeg(haemP, dt, 823, 884, 884, false);
  /* lead falls onto its two enzymes in lead poisoning; chelation thins it out */
  const leadRate = m.level === 1 ? (1 - 0.75 * sm.chel) * 5 : 0;
  acc.lead += dt * leadRate; while (acc.lead >= 1) { acc.lead--; const p = freeP(leadP); if (p) emit(p, Math.random() < 0.5 ? 350 + rnd(-16, 16) : 815 + rnd(-16, 16), 96, rnd(-3, 3), rnd(16, 26), 0); }
  leadP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y = clamp(p.y, 52, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > FY - 22 || p.t > 4) killP(p); });
  /* chelator dots fly to the blocked enzymes; lead leaves downward */
  acc.treat += dt * (sm.chel * 5 + sm.hg * 5); while (acc.treat >= 1) { acc.treat--; const p = freeP(treatP); if (p) {
    if (sm.hg > sm.chel) { p.e.setAttribute("class", "sc-p p-haem"); emit(p, 150 + rnd(-50, 50), 105, 0, 0, rnd(0, 6.28)); p.st = 0; p.tx = 150 + Math.cos(p.k) * 30; p.ty = FY + Math.sin(p.k) * 30; }
    else { p.e.setAttribute("class", "sc-p p-treat"); const left = acc.side % 2 === 0; acc.side++; emit(p, (left ? 350 : 815) + rnd(-30, 30), 100, 0, 0, 0); p.st = 0; p.tx = left ? 350 : 815; p.ty = FY; }
  } }
  treatP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy); if (d < 7) { if (sm.hg > sm.chel) { p.st = 1; } else { killP(p); acc.exc += 1; } }
      else { p.x += dx / d * 130 * dt; p.y += dy / d * 130 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); } }
    else { p.k += dt * 0.6; p.x = 150 + Math.cos(p.k) * 30; p.y = FY + Math.sin(p.k) * 30; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 2.5)).toFixed(2)); if (p.t > 3.5) killP(p); } });
  while (acc.exc >= 1) { acc.exc--; const p = freeP(excP); if (p) emit(p, (Math.random() < 0.5 ? 350 : 815) + rnd(-15, 15), 205, rnd(-4, 4), rnd(45, 65), 0); }
  excP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 380) / 52).toFixed(2)); if (p.y > 432) killP(p); });
  /* trigger sparks rain onto the first enzyme until triggers are avoided */
  acc.trig += dt * ((m.level === 2 && m.drug !== 3) ? (2 + 6 * sm.D) : 0); while (acc.trig >= 1) { acc.trig--; const p = freeP(trigP); if (p) emit(p, 100 + rnd(0, 100), 95, rnd(-4, 4), rnd(60, 90), 0); }
  trigP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > FY - 26 || p.t > 3) killP(p); });
  /* built up precursors reach the gut and the nerve */
  acc.tox += dt * sm.Sym * 7; while (acc.tox >= 1) { acc.tox--; const p = freeP(toxP); if (p) { const gut = acc.side % 2 === 0; acc.side++; p.e.setAttribute("class", gut ? "sc-p p-ala" : "sc-p p-pbg"); emit(p, 0, 0, 0, 0, 0); p.tr = gut ? toxGut : toxNerve; p.u = 0; const q = p.tr.at(0); p.x = q.x; p.y = q.y; } }
  toxP.forEach((p) => { if (!p.on) return; p.t += dt; p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1 || p.t > 6) killP(p); });
  gg.ala.set(sm.ALA, wordOf(sm.ALA, 0.3, 0.6, ["low", "raised", "high"])); gg.pbg.set(sm.PBG, wordOf(sm.PBG, 0.3, 0.6, ["low", "raised", "high"]));
  gg.por.set(sm.Por, wordOf(sm.Por, 0.3, 0.6, ["low", "raised", "high"])); gg.haem.set(sm.Haem, wordOf(sm.Haem, 0.35, 0.65, ["low", "borderline", "normal"]));
  gg.sym.set(sm.Sym, wordOf(sm.Sym, 0.2, 0.5, ["none", "present", "severe"]));
  const key = level * 10 + drug; if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
