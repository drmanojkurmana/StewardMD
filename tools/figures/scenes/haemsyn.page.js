/* Haem synthesis scene: substrates flow through enzyme steps across mitochondrion and cytosol to haem. */
const FY = SC.FY, WW = SC.W;
const layers = { parts: $("parts"), blocks: $("blocks"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const subP = pool(14, () => mk("circle", { class: "sc-p p-sub", r: 3 }, layers.parts));
const alaP = pool(26, () => mk("circle", { class: "sc-p p-ala", r: 3.1 }, layers.parts));
const pbgP = pool(26, () => mk("circle", { class: "sc-p p-pbg", r: 3.1 }, layers.parts));
const porP = pool(26, () => mk("rect", { class: "sc-p p-por", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1.2 }, layers.parts));
const haemP = pool(16, () => mk("circle", { class: "sc-p p-haem", r: 3.6 }, layers.parts));
const leadP = pool(16, () => mk("circle", { class: "hs-lead", r: 3.4 }, layers.parts));
const treatP = pool(14, () => mk("circle", { class: "sc-p p-treat", r: 3 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function moveSeg(pl, dt, x0, x1, jamX, jam) {
  pl.forEach((p) => { if (!p.on) return; p.t += dt; const near = jam && p.x > jamX - 34 && p.x < jamX + 6; p.x += p.vx * dt * (near ? 0.22 : 1); p.y = FY + p.k + Math.sin(tm / 360 + p.x * 0.05) * 2.2; p.x = clamp(p.x, 24, WW - 24); p.y = clamp(p.y, 56, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x >= x1 - 3 || p.t > 9) killP(p); });
}
const gg = {};
let chelPill = null, hgPill = null, avoidPill = null;
const blockMarks = {};
function blockMark(x, y) { const g = mk("g", { opacity: "0" }, layers.blocks); mk("path", { class: "hs-block", d: "M-13 -13L13 13M13 -13L-13 13" }, g); g.setAttribute("transform", "translate(" + x + " " + y + ")"); return g; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [90, 250, 410, 570, 730];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ala", "ALA", "g-ala", "Aminolaevulinic acid (ALA), the first product of the pathway. It builds up when a later step is blocked or when ALA synthase is driven up."], ["pbg", "PBG", "g-pbg", "Porphobilinogen (PBG), made from ALA in the cytosol. It builds up ahead of faulty PBG deaminase in acute intermittent porphyria."], ["por", "Porphyrins", "g-por", "Porphyrin intermediates between PBG and haem. They build up when ferrochelatase is blocked by lead."], ["haem", "Haem", "g-haemg", "Haem, the finished product. Ferrochelatase inserts iron into protoporphyrin to make it. Haem restrains ALA synthase by feedback."], ["sym", "Symptoms", "g-sym", "Abdominal pain and neuropathy (nerve pain and weakness) in attacks of acute intermittent porphyria, and ill health when haem falls."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Glycine + succinyl-CoA", 86, FY - 12, 118, 106, "Starting materials in the mitochondrion: glycine and succinyl-CoA from the citric acid cycle. ALA synthase joins them to make ALA.");
  pill(ox, "ALA synthase", 150, FY + 24, 150, 318, "ALA synthase: the first and rate limiting enzyme, in the mitochondrion. Haem feeds back to restrain it, so low haem or an attack drives it up.");
  pill(ox, "ALA", 255, FY, 262, 106, "Aminolaevulinic acid (ALA). It leaves the mitochondrion for the cytosol. It builds up in lead poisoning and in acute intermittent porphyria attacks.");
  pill(ox, "ALA dehydratase", 350, FY + 24, 350, 318, "ALA dehydratase: joins ALA molecules in the cytosol to make porphobilinogen. Lead inhibits this enzyme.");
  pill(ox, "Porphobilinogen", 440, FY, 442, 106, "Porphobilinogen (PBG): the building block for porphyrins. It builds up ahead of faulty PBG deaminase.");
  pill(ox, "PBG deaminase", 525, FY + 24, 528, 318, "PBG deaminase (hydroxymethylbilane synthase): links PBG units into a chain. A partial defect causes acute intermittent porphyria.");
  pill(ox, "Porphyrin steps", 630, FY - 10, 618, 106, "Porphyrin intermediates: the chain closes into a ring and is trimmed through several steps, first in the cytosol and then in the mitochondrion.");
  pill(ox, "Iron", 762, 148, 758, 106, "Iron: ferrochelatase inserts iron into protoporphyrin to finish haem.");
  pill(ox, "Ferrochelatase", 815, FY + 24, 812, 318, "Ferrochelatase: the last enzyme, in the mitochondrion. It inserts iron into protoporphyrin to make haem. Lead inhibits this enzyme.");
  pill(ox, "Haem", 882, FY, 884, 106, "Haem: the finished product for haemoglobin and many enzymes. It feeds back along the dashed line to restrain ALA synthase.");
  chelPill = pill(ox, "Chelation", 350, FY + 24, 140, 378, "Chelation: a treatment that binds and removes lead, so the two lead blocked enzymes can work again.");
  hgPill = pill(ox, "Haem + glucose", 150, FY + 24, 322, 378, "Haem and glucose: they restrain ALA synthase, so less ALA and PBG are made during an attack of acute intermittent porphyria.");
  avoidPill = pill(ox, "Avoid triggers", 525, FY + 24, 502, 378, "Avoiding triggers: steering clear of things that drive up ALA synthase, such as certain medicines, fasting and alcohol, reduces attacks.");
  blockMarks.dehyd = blockMark(350, FY); blockMarks.deam = blockMark(525, FY); blockMarks.ferro = blockMark(815, FY);
}
const sm = { D: 0.4, dehyd: 1, deam: 1, ferro: 1, ALA: 0.2, PBG: 0.2, Por: 0.2, Haem: 0.8, Sym: 0 };
const acc = { sub: 0, ala: 0, pbg: 0, por: 0, haem: 0, lead: 0, treat: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.D = lerp(sm.D, m.D, k2); sm.dehyd = lerp(sm.dehyd, m.dehyd, k1); sm.deam = lerp(sm.deam, m.deam, k1); sm.ferro = lerp(sm.ferro, m.ferro, k1);
  sm.ALA = lerp(sm.ALA, m.ALA, k2); sm.PBG = lerp(sm.PBG, m.PBG, k2); sm.Por = lerp(sm.Por, m.Por, k2); sm.Haem = lerp(sm.Haem, m.Haem, k2); sm.Sym = lerp(sm.Sym, m.Sym, k2);
  blockMarks.dehyd.setAttribute("opacity", clamp((0.72 - sm.dehyd) * 1.8).toFixed(2));
  blockMarks.deam.setAttribute("opacity", clamp((0.72 - sm.deam) * 1.8).toFixed(2));
  blockMarks.ferro.setAttribute("opacity", clamp((0.72 - sm.ferro) * 1.8).toFixed(2));
  chelPill.style.opacity = m.drug === 1 ? "1" : "0"; hgPill.style.opacity = m.drug === 2 ? "1" : "0"; avoidPill.style.opacity = m.drug === 3 ? "1" : "0";
  $("enz1").setAttribute("transform", "translate(150 " + FY + ") scale(" + (1 + 0.07 * sm.D * Math.sin(tm / 300)).toFixed(3) + ") translate(-150 -" + FY + ")");
  $("enz2").setAttribute("transform", "translate(350 " + FY + ") scale(" + (0.92 + 0.1 * sm.dehyd).toFixed(3) + ") translate(-350 -" + FY + ")");
  $("enz3").setAttribute("transform", "translate(525 " + FY + ") scale(" + (0.92 + 0.1 * sm.deam).toFixed(3) + ") translate(-525 -" + FY + ")");
  $("enz4").setAttribute("transform", "translate(815 " + FY + ") scale(" + (0.92 + 0.1 * sm.ferro).toFixed(3) + ") translate(-815 -" + FY + ")");
  $("symDot1").setAttribute("opacity", clamp(sm.Sym * 1.2).toFixed(2)); $("symDot2").setAttribute("opacity", clamp(sm.Sym * 1.2).toFixed(2));
  const fb = document.querySelector(".hs-feedback"); if (fb) fb.style.opacity = (0.14 + 0.55 * sm.Haem).toFixed(2);
  const pg = $("patientG"); pg.setAttribute("transform", "translate(787 384) scale(" + (1 + 0.012 * sm.Sym * Math.sin(tm / 420)).toFixed(3) + ") translate(-787 -384)");
  acc.sub += dt * sm.D * 7; while (acc.sub >= 1) { acc.sub--; const p = freeP(subP); if (p) emit(p, 82, FY, rnd(26, 36), 0, rnd(-9, 9)); }
  moveSeg(subP, dt, 82, 150, 150, false);
  acc.ala += dt * sm.D * 9; while (acc.ala >= 1) { acc.ala--; const p = freeP(alaP); if (p) emit(p, 158, FY, rnd(30, 42), 0, rnd(-10, 10)); }
  moveSeg(alaP, dt, 158, 350, 350, sm.dehyd < 0.6);
  acc.pbg += dt * sm.D * sm.dehyd * 9; while (acc.pbg >= 1) { acc.pbg--; const p = freeP(pbgP); if (p) emit(p, 358, FY, rnd(30, 42), 0, rnd(-10, 10)); }
  moveSeg(pbgP, dt, 358, 525, 525, sm.deam < 0.6);
  acc.por += dt * sm.D * sm.dehyd * sm.deam * 8; while (acc.por >= 1) { acc.por--; const p = freeP(porP); if (p) emit(p, 533, FY, rnd(30, 42), 0, rnd(-11, 11)); }
  moveSeg(porP, dt, 533, 815, 815, sm.ferro < 0.6);
  acc.haem += dt * sm.D * sm.dehyd * sm.deam * sm.ferro * 8 + dt * (m.drug === 2 ? 1.2 : 0); while (acc.haem >= 1) { acc.haem--; const p = freeP(haemP); if (p) emit(p, 823, FY, rnd(24, 34), 0, rnd(-8, 8)); }
  moveSeg(haemP, dt, 823, 884, 884, false);
  const leadOn = m.level === 1 ? (m.drug === 1 ? 0.25 : 1) : 0;
  acc.lead += dt * leadOn * 5; while (acc.lead >= 1) { acc.lead--; const p = freeP(leadP); if (p) emit(p, Math.random() < 0.5 ? 350 + rnd(-16, 16) : 815 + rnd(-16, 16), 96, rnd(-3, 3), rnd(16, 26), 0); }
  leadP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y = clamp(p.y, 52, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > FY - 22 || p.t > 4) killP(p); });
  acc.treat += dt * (m.drug ? 4 : 0); while (acc.treat >= 1) { acc.treat--; const p = freeP(treatP); if (p) emit(p, m.drug === 1 ? 350 : 150, 120, rnd(-4, 4), rnd(14, 22), 0); }
  treatP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.x = clamp(p.x + p.vx * dt, 24, WW - 24); p.y = clamp(p.y, 52, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > FY - 24 || p.t > 4) killP(p); });
  gg.ala.set(sm.ALA, wordOf(sm.ALA, 0.3, 0.6, ["low", "raised", "high"])); gg.pbg.set(sm.PBG, wordOf(sm.PBG, 0.3, 0.6, ["low", "raised", "high"]));
  gg.por.set(sm.Por, wordOf(sm.Por, 0.3, 0.6, ["low", "raised", "high"])); gg.haem.set(sm.Haem, wordOf(sm.Haem, 0.35, 0.65, ["low", "borderline", "normal"]));
  gg.sym.set(sm.Sym, wordOf(sm.Sym, 0.2, 0.5, ["none", "present", "severe"]));
}
run({ init, step });
