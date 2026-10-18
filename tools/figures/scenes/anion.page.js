/* Anion gap scene: acid sources, bicarbonate buffer and loss, blood ions, lungs and the ion balance bars. */
const CY = SC.CY, WW = SC.W;
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), bars: $("bars"), seals: $("seals"), wash: $("acidWash"), halo: $("bufferHalo"), spoke: $("dialSpoke"), vesM: $("vesSrcM"), vesL: $("vesSrcL"), vesK: $("vesSrcK"), vesB: $("vesLossB"), vesT: $("vesLossK"), dialG: $("dialG"), bicG: $("bicG"), dialTube: $("dialTube"), bicTube: $("bicTube") };
let muscleO = null, liverO = null, kidF = null, bowelO = null, kidT = null, slotL = null, slotR = null, capEl = null, capDrug = -1;
let trSrc = [], trBuf = null, trDial = null, trBic = null, lossPts = [];
function initOrgans() {
  muscleO = organ($("srcMuscleSlot"), "muscle", 90, 132, 86, {});
  liverO = organ($("srcLiverSlot"), "liver", 195, 128, 110, {});
  kidF = organ($("srcKidneySlot"), "kidney", 290, 130, 62, {});
  bowelO = organ($("lossBowelSlot"), "bowel", 725, 130, 150, {});
  kidT = organ($("lossKidneySlot"), "kidney", 862, 130, 62, { flip: true });
  slotL = $("lungSlotL"); slotR = $("lungSlotR");
  organ(slotL, "lung", 0, 0, 56, { h: 72 });
  organ(slotR, "lung", 0, 0, 56, { h: 72, flip: true });
  place(slotL, 58, 374, 0, 1); place(slotR, 114, 374, 0, 1);
  const P = (o, k) => (o.ports[k] || o.ports.out);
  const mP = P(muscleO, "out"), lP = P(liverO, "porta"), kP = P(kidF, "out");
  trSrc = [track([mP, [mP[0], 190], [90, CY - 40]]), track([lP, [lP[0], 190], [195, CY - 40]]), track([kP, [kP[0], 190], [290, CY - 40]])];
  layers.vesM.setAttribute("d", "M" + f1(mP[0]) + " " + f1(mP[1]) + " L90 " + f1(CY - 42));
  layers.vesL.setAttribute("d", "M" + f1(lP[0]) + " " + f1(lP[1]) + " L195 " + f1(CY - 42));
  layers.vesK.setAttribute("d", "M" + f1(kP[0]) + " " + f1(kP[1]) + " L290 " + f1(CY - 42));
  const bP = P(bowelO, "out"), tP = P(kidT, "out");
  lossPts = [bP, tP];
  layers.vesB.setAttribute("d", "M" + f1(bP[0]) + " " + f1(bP[1]) + " L" + f1(bP[0]) + " " + f1(CY - 42));
  layers.vesT.setAttribute("d", "M" + f1(tP[0]) + " " + f1(tP[1]) + " L" + f1(tP[0]) + " " + f1(CY - 42));
  trBuf = track([[418, CY - 16], [432, 200], [450, 148]]);
  trDial = track([[706, 292], [714, 322], [720, 346]]);
  trBic = track([[820, 346], [820, 326], [820, 306]]);
}
function capText(d) {
  if (d === 1) return "Cause treated. Less acid is made and less bicarbonate is lost.";
  if (d === 2) return "Bicarbonate given. It soaks up acid, but the acid anions remain.";
  if (d === 3) return "Dialysis. It clears acid anions and restores bicarbonate.";
  return "No treatment. Acid builds up, bicarbonate falls and breathing deepens.";
}
/* tracks above are built in initOrgans from the muscle, liver, kidney, bowel and lung ports */
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(p, tr) { p.on = true; p.tr = tr; p.u = 0; p.t = 0; const q = tr.at(0); p.x = q.x; p.y = q.y; p.e.setAttribute("opacity", "1"); }
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts);
/* ---- flowing blood particles (fixed pools, shown in proportion) ---- */
function bloodArr(n, cls, r, diaShape) { return Array.from({ length: n }, () => ({ e: (diaShape ? dia(cls) : dot(cls, r))(), x: rnd(40, 930), o: rnd(-0.75, 0.75) })); }
const bNa = bloodArr(18, "p-na", 3.4, false), bCl = bloodArr(14, "p-cl", 3.2, false), bHco = bloodArr(16, "p-hco", 3.2, false), bUn = bloodArr(14, "p-unmeas", 3, true), bH = bloodArr(10, "p-h", 2.2, false);
/* ---- moving pools ---- */
const srcP = pool(16, dia("p-unmeas")), lossP = pool(12, dot("p-hco", 3)), clP = pool(12, dot("p-cl", 3)), bufH = pool(8, dot("p-h", 2.4)), co2B = pool(8, dot("p-co2", 2.6)), co2L = pool(10, dot("p-co2", 2.6)), dialP = pool(10, dia("p-unmeas")), bicP = pool(10, dot("p-hco", 3.2));
const acc = { src: 0, loss: 0, cl: 0, buf: 0, co2b: 0, co2l: 0, dial: 0, bic: 0 };
const sm = { effSrc: 1, effLoss: 0.05, U: 0.9, HCO: 0.33, Cl: 0.21, A: 0.7, Br: 0.69, cause: 0, bic: 0, dial: 0 };
let breathPh = 0, dialAng = 0;
const barEls = {};
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 300, 470, 640, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ac", "Acidosis", "g-acid", "How acid the blood is. Added acid or lost bicarbonate both lower bicarbonate and make the blood more acid."], ["hc", "Bicarbonate", "g-hco", "Bicarbonate (HCO3): the main buffer. It is used up buffering added acid, and it is lost in diarrhoea or renal tubular acidosis."], ["gap", "Anion gap", "g-gap", "Measured cations minus measured anions (chloride plus bicarbonate). It widens when unmeasured anions from an added acid pile up."], ["cl", "Chloride", "g-clg", "Chloride rises when bicarbonate is lost, keeping the blood electrically neutral. That is why the gap stays normal in bicarbonate loss."], ["br", "Breathing", "g-br", "Respiratory compensation: deep, faster breathing blows off carbon dioxide, which partly offsets the acid."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Acid sources", 150, 100, 150, 74, "Acid from lactate, ketones, failing kidneys and toxins. Its anions widen the gap.");
  pill(ox, "Buffer used up", 480, 98, 480, 74, "Bicarbonate soaks up acid and turns it into carbon dioxide. Buffering uses bicarbonate up.");
  pill(ox, "Bicarbonate lost", 812, 104, 790, 74, "Lost in watery stool or in urine when the tubule fails. Chloride rises instead, so the gap stays normal.");
  pill(ox, "Acid in blood", 250, 266, 250, 322, "Hydrogen ions in blood. More acid means lower bicarbonate and deeper breathing.");
  pill(ox, "Gap anions", 700, 266, 690, 322, "Anions the usual panel does not measure. When they pile up, the anion gap widens.");
  pill(ox, "Deep breathing", 112, 360, 200, 352, "Fast deep breathing blows off carbon dioxide. It partly offsets the acid.");
  pill(ox, "Ion balance", 450, 395, 350, 382, "Cations match chloride plus bicarbonate plus the gap. The two sides always balance.");
  pill(ox, "Dialysis and buffer", 720, 378, 810, 336, "Dialysis clears acid anions and restores bicarbonate. The bag adds bicarbonate buffer directly.");
  /* ion balance bars */
  const B = layers.bars, base = 412;
  barEls.cat = mk("rect", { class: "an-cat", x: 432, y: base - 78, width: 36, height: 78, rx: 4 }, B);
  barEls.clS = mk("rect", { class: "an-clseg", x: 500, y: base - 30, width: 36, height: 30, rx: 4 }, B);
  barEls.hcoS = mk("rect", { class: "an-hcoseg", x: 500, y: base - 55, width: 36, height: 25 }, B);
  barEls.unS = mk("rect", { class: "an-unseg", x: 500, y: base - 78, width: 36, height: 23, rx: 4 }, B);
  barEls.brk = mk("path", { class: "an-bracket", d: "" }, B);
  barEls.tCl = mk("text", { class: "sc-lab", x: 518, y: base - 12, "text-anchor": "middle" }, B); barEls.tCl.textContent = "Cl";
  barEls.tHco = mk("text", { class: "sc-lab", x: 518, y: base - 40, "text-anchor": "middle" }, B); barEls.tHco.textContent = "HCO3";
  barEls.tUn = mk("text", { class: "sc-lab", x: 518, y: base - 66, "text-anchor": "middle" }, B); barEls.tUn.textContent = "gap";
  mk("line", { x1: 424, y1: base, x2: 544, y2: base, stroke: "var(--anatomy-mid)", "stroke-width": 1 }, B);
  capEl = mk("text", { class: "an-cap", x: 30, y: 432 }, ox); capEl.textContent = capText(0);
}
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.effSrc = lerp(sm.effSrc, m.effSrc, k2); sm.effLoss = lerp(sm.effLoss, m.effLoss, k2); sm.U = lerp(sm.U, m.U, k2); sm.HCO = lerp(sm.HCO, m.HCO, k2); sm.Cl = lerp(sm.Cl, m.Cl, k2); sm.A = lerp(sm.A, m.A, k2); sm.Br = lerp(sm.Br, m.Br, k2);
  sm.cause = lerp(sm.cause, m.cause, k1); sm.bic = lerp(sm.bic, m.bic, k1); sm.dial = lerp(sm.dial, m.dial, k1);
  /* vessels fade with their mechanism; seals mark treated causes */
  const sv = (0.12 + 0.6 * clamp(sm.effSrc)).toFixed(2), lv = (0.12 + 0.6 * clamp(sm.effLoss)).toFixed(2);
  layers.vesM.setAttribute("opacity", sv); layers.vesL.setAttribute("opacity", sv); layers.vesK.setAttribute("opacity", sv);
  layers.vesB.setAttribute("opacity", lv); layers.vesT.setAttribute("opacity", lv);
  layers.seals.setAttribute("opacity", clamp(sm.cause).toFixed(2));
  layers.wash.setAttribute("opacity", (0.03 + 0.3 * sm.A).toFixed(2));
  layers.halo.setAttribute("opacity", (sm.bic * 0.85).toFixed(2));
  layers.dialTube.setAttribute("opacity", (0.12 + 0.8 * sm.dial).toFixed(2));
  layers.bicTube.setAttribute("opacity", (0.12 + 0.8 * sm.bic).toFixed(2));
  layers.dialG.setAttribute("opacity", (0.3 + 0.7 * sm.dial).toFixed(2));
  layers.bicG.setAttribute("opacity", (0.3 + 0.7 * sm.bic).toFixed(2));
  dialAng += dt * (0.6 + 5 * sm.dial) * 57.3;
  layers.spoke.setAttribute("transform", "rotate(" + f1(dialAng % 360) + " 720 378)");
  layers.spoke.setAttribute("opacity", (0.25 + 0.65 * sm.dial).toFixed(2));
  const bp = 1 + 0.05 * sm.A * Math.sin(tm / 300) + 0.06 * sm.bic;
  $("bufferC").setAttribute("transform", "translate(480 130) scale(" + bp.toFixed(3) + ") translate(-480 -130)");
  /* blood flow */
  const flow = 52;
  function runBlood(arr, want) { arr.forEach((p, i) => { p.x += flow * dt; if (p.x > 936) { p.x = 30; p.o = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.o * 28) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); }); }
  runBlood(bNa, 15); runBlood(bCl, Math.round(sm.Cl * 14)); runBlood(bHco, Math.round(sm.HCO * 16)); runBlood(bUn, Math.round(sm.U * 14)); runBlood(bH, Math.round(sm.A * 10));
  /* source acid rides from organ ports down into blood */
  acc.src += dt * sm.effSrc * 7; while (acc.src >= 1) { acc.src--; const p = free(srcP); if (p) ride(p, trSrc[Math.floor(Math.random() * trSrc.length)]); }
  srcP.forEach((p) => { if (!p.on) return; p.u += dt * 95 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, tm / 6, 1); if (p.u >= 1) kill(p); });
  /* bicarbonate lost from bowel and kidney tubule */
  acc.loss += dt * sm.effLoss * 6; while (acc.loss >= 1) { acc.loss--; const p = free(lossP), s = pick(lossPts); if (p) emit(p, s[0] + rnd(-6, 6), s[1], rnd(-8, 8), 36, 0); }
  lossP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.t += dt; if (p.y > CY - 44 || p.t > 1.4) kill(p); });
  /* chloride into blood */
  acc.cl += dt * sm.effLoss * 5; while (acc.cl >= 1) { acc.cl--; const p = free(clP); if (p) emit(p, 806 + rnd(-12, 12), 172, 0, 48, 0); }
  clP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); if (p.y > CY - 44) kill(p); });
  /* buffering: blood acid rides up into the buffer, CO2 leaves */
  acc.buf += dt * sm.A * 5; while (acc.buf >= 1) { acc.buf--; const p = free(bufH); if (p) ride(p, trBuf); }
  bufH.forEach((p) => { if (!p.on) return; p.u += dt * 80 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) kill(p); });
  acc.co2b += dt * sm.A * sm.HCO * 6; while (acc.co2b >= 1) { acc.co2b--; const p = free(co2B); if (p) emit(p, 492 + rnd(-8, 8), 104, rnd(-4, 4), -30, 0); }
  co2B.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p); });
  /* lungs */
  breathPh += dt * (1 + 4.5 * sm.Br); const amp = 0.04 + 0.2 * sm.Br, sc = 1 + amp * Math.sin(breathPh);
  place(slotL, 58, 374, 0, sc); place(slotR, 114, 374, 0, sc);
  acc.co2l += dt * sm.Br * 6; while (acc.co2l >= 1) { acc.co2l--; const p = free(co2L); if (p) emit(p, 86 + rnd(-46, 44), 344, 0, -28, 0); }
  co2L.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* dialysis pulls unmeasured anions down into the machine; bicarbonate bag feeds blood */
  acc.dial += dt * sm.dial * 7; while (acc.dial >= 1) { acc.dial--; const p = free(dialP); if (p) ride(p, trDial); }
  dialP.forEach((p) => { if (!p.on) return; p.u += dt * 90 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, tm / 6, 1); if (p.u >= 1) kill(p); });
  acc.bic += dt * sm.bic * 6; while (acc.bic >= 1) { acc.bic--; const p = free(bicP); if (p) ride(p, trBic); }
  bicP.forEach((p) => { if (!p.on) return; p.u += dt * 80 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) kill(p); });
  /* ion balance bars (total height fixed: blood stays neutral) */
  const base = 412, total = 78, unH = Math.round(sm.U * 42), hcoH = Math.round(sm.HCO * 32), clH = Math.max(10, total - unH - hcoH), adjTotal = clH + hcoH + unH;
  barEls.clS.setAttribute("y", f1(base - clH)); barEls.clS.setAttribute("height", f1(clH));
  barEls.hcoS.setAttribute("y", f1(base - clH - hcoH)); barEls.hcoS.setAttribute("height", f1(hcoH));
  barEls.unS.setAttribute("y", f1(base - adjTotal)); barEls.unS.setAttribute("height", f1(unH));
  barEls.cat.setAttribute("y", f1(base - adjTotal)); barEls.cat.setAttribute("height", f1(adjTotal));
  const measY = base - clH - hcoH;
  barEls.brk.setAttribute("d", "M548 " + f1(measY) + "L557 " + f1(measY) + "L557 " + f1(base - adjTotal) + "L548 " + f1(base - adjTotal));
  barEls.tCl.setAttribute("y", f1(base - clH / 2 + 3)); barEls.tHco.setAttribute("y", f1(base - clH - hcoH / 2 + 3)); barEls.tUn.setAttribute("y", f1(base - adjTotal + unH / 2 + 3));
  barEls.tHco.setAttribute("opacity", hcoH > 11 ? "1" : "0"); barEls.tUn.setAttribute("opacity", unH > 11 ? "1" : "0");
  /* gauges */
  gg.ac.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.hc.set(sm.HCO, wordOf(sm.HCO, 0.35, 0.65, ["low", "reduced", "maintained"]));
  gg.gap.set(sm.U, wordOf(sm.U, 0.3, 0.6, ["normal", "raised", "high"])); gg.cl.set(sm.Cl, wordOf(sm.Cl, 0.4, 0.65, ["normal", "raised", "high"])); gg.br.set(sm.Br, wordOf(sm.Br, 0.35, 0.65, ["quiet", "deeper", "deep and fast"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
