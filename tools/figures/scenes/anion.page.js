/* Anion gap scene: acid added, bicarbonate buffering and loss, chloride rise, blood ions, lungs and the ion balance bars. */
const CY = SC.CY, WW = SC.W;
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), bars: $("bars"), lungs: $("lungsG"), sourceG: $("sourceG"), lossG: $("lossG"), bufferG: $("bufferG"), dialG: $("dialG"), bicG: $("bicG") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.4 0L0 3.6L-3.4 0Z" }, layers.parts);
/* ---- flowing blood particles (fixed pools, shown in proportion) ---- */
function bloodArr(n, cls, r, diaShape) { return Array.from({ length: n }, () => ({ e: (diaShape ? dia(cls) : dot(cls, r))(), x: rnd(40, 930), o: rnd(-0.75, 0.75) })); }
const bNa = bloodArr(18, "p-na", 3.4, false), bCl = bloodArr(14, "p-cl", 3.2, false), bHco = bloodArr(16, "p-hco", 3.2, false), bUn = bloodArr(14, "p-unmeas", 3, true), bH = bloodArr(10, "p-h", 2.2, false);
/* ---- moving pools ---- */
const srcP = pool(16, dia("p-unmeas")), lossP = pool(12, dot("p-hco", 3)), clP = pool(12, dot("p-cl", 3)), bufH = pool(8, dot("p-h", 2.4)), co2B = pool(8, dot("p-co2", 2.6)), co2L = pool(10, dot("p-co2", 2.6)), dialP = pool(10, dia("p-unmeas")), bicP = pool(10, dot("p-hco", 3.2));
const srcPts = [[60, 152], [130, 152], [200, 158], [267, 152]];
const acc = { src: 0, loss: 0, cl: 0, buf: 0, co2b: 0, co2l: 0, dial: 0, bic: 0 };
const sm = { effSrc: 1, effLoss: 0.05, U: 0.9, HCO: 0.33, Cl: 0.21, A: 0.7, Br: 0.69, cause: 0, bic: 0, dial: 0 };
let breathPh = 0;
const barEls = {};
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 300, 470, 640, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ac", "Acidosis", "g-acid", "How acid the blood is. Added acid or lost bicarbonate both lower bicarbonate and make the blood more acid."], ["hc", "Bicarbonate", "g-hco", "Bicarbonate (HCO3): the main buffer. It is used up buffering added acid, and it is lost in diarrhoea or renal tubular acidosis."], ["gap", "Anion gap", "g-gap", "Measured cations minus measured anions (chloride plus bicarbonate). It widens when unmeasured anions from an added acid pile up."], ["cl", "Chloride", "g-clg", "Chloride rises when bicarbonate is lost, keeping the blood electrically neutral. That is why the gap stays normal in bicarbonate loss."], ["br", "Breathing", "g-br", "Respiratory compensation: deep, faster breathing blows off carbon dioxide, which partly offsets the acid."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Lactate", 60, 110, 60, 92, "Lactate from under-perfused tissue (shock, sepsis). Its hydrogen ions use up bicarbonate and the lactate anion widens the gap.");
  pill(ox, "Ketones", 130, 152, 130, 168, "Ketone acids from the liver in diabetic ketoacidosis or starvation. They consume bicarbonate and widen the gap.");
  pill(ox, "Uraemia", 200, 108, 200, 92, "Acids normally cleared by the kidney build up when the kidney fails (uraemia). The retained anions widen the gap.");
  pill(ox, "Toxins", 267, 152, 270, 168, "Toxins such as methanol and salicylate add acid and unmeasured anions, widening the gap.");
  pill(ox, "Bicarbonate buffer", 480, 98, 480, 82, "Bicarbonate buffers hydrogen ions: H+ plus HCO3 becomes carbon dioxide and water. Buffering uses bicarbonate up, so its level falls.");
  pill(ox, "Gut loss", 725, 110, 725, 92, "Diarrhoea loses bicarbonate-rich gut fluid. Bicarbonate falls and chloride rises, so the anion gap stays normal.");
  pill(ox, "Kidney tubule", 855, 104, 855, 92, "In renal tubular acidosis the tubule cannot reclaim or make bicarbonate, so bicarbonate is lost in urine and chloride rises.");
  pill(ox, "Chloride rises", 790, 176, 790, 185, "When bicarbonate is lost, chloride rises to keep blood electrically neutral. The measured anions change together, so the gap does not widen.");
  pill(ox, "Acid (H+)", 250, 266, 250, 208, "Hydrogen ions (acid) in the blood. They are buffered by bicarbonate, which is why bicarbonate falls as acid rises.");
  pill(ox, "Blood plasma", 480, 266, 480, 205, "Blood plasma, electrically neutral: sodium and other cations balance chloride, bicarbonate and unmeasured anions.");
  pill(ox, "Unmeasured anions", 700, 266, 700, 208, "Anions not measured in the usual panel (the acid anions, plus albumin and phosphate). When they pile up, the anion gap widens.");
  pill(ox, "Deep breathing", 85, 382, 95, 430, "Deep, faster breathing (Kussmaul breathing in severe acidosis) blows off carbon dioxide and partly compensates for the acid.");
  pill(ox, "Cations", 450, 380, 449, 430, "Measured cations, mainly sodium. This side of the balance changes little in metabolic acidosis.");
  pill(ox, "Anions", 518, 380, 519, 430, "Measured anions (chloride plus bicarbonate) plus the unmeasured anions on top. Together they match the cations.");
  pill(ox, "Anion gap", 552, 362, 605, 365, "The anion gap: cations minus the measured anions. It is the unmeasured anion slice, shown orange. Wide in added acid, normal when bicarbonate is lost.");
  pill(ox, "Dialysis", 720, 382, 720, 430, "Dialysis clears retained acids and toxins and restores bicarbonate. It acts on the unmeasured anions themselves.");
  pill(ox, "Bicarbonate", 820, 382, 820, 430, "Bicarbonate given as a buffer. It raises bicarbonate and softens the acidosis, but it does not remove the acid anions, so the gap can stay wide.");
  /* ion balance bars */
  const B = layers.bars, base = 420;
  barEls.cat = mk("rect", { class: "an-cat", x: 432, y: base - 78, width: 36, height: 78, rx: 4 }, B);
  barEls.clS = mk("rect", { class: "an-clseg", x: 500, y: base - 30, width: 36, height: 30, rx: 4 }, B);
  barEls.hcoS = mk("rect", { class: "an-hcoseg", x: 500, y: base - 55, width: 36, height: 25 }, B);
  barEls.unS = mk("rect", { class: "an-unseg", x: 500, y: base - 78, width: 36, height: 23, rx: 4 }, B);
  barEls.brk = mk("path", { class: "an-bracket", d: "" }, B);
  barEls.tCl = mk("text", { class: "sc-lab", x: 518, y: base - 12, "text-anchor": "middle" }, B); barEls.tCl.textContent = "Cl";
  barEls.tHco = mk("text", { class: "sc-lab", x: 518, y: base - 40, "text-anchor": "middle" }, B); barEls.tHco.textContent = "HCO3";
  barEls.tUn = mk("text", { class: "sc-lab", x: 518, y: base - 66, "text-anchor": "middle" }, B); barEls.tUn.textContent = "gap";
  mk("line", { x1: 424, y1: base, x2: 544, y2: base, stroke: "var(--anatomy-mid)", "stroke-width": 1 }, B);
}
function init() { initPanel(); place($("lobeL"), 62, 382, 0, 1); place($("lobeR"), 110, 382, 0, 1); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.effSrc = lerp(sm.effSrc, m.effSrc, k2); sm.effLoss = lerp(sm.effLoss, m.effLoss, k2); sm.U = lerp(sm.U, m.U, k2); sm.HCO = lerp(sm.HCO, m.HCO, k2); sm.Cl = lerp(sm.Cl, m.Cl, k2); sm.A = lerp(sm.A, m.A, k2); sm.Br = lerp(sm.Br, m.Br, k2);
  sm.cause = lerp(sm.cause, m.cause, k1); sm.bic = lerp(sm.bic, m.bic, k1); sm.dial = lerp(sm.dial, m.dial, k1);
  /* node groups fade with their mechanism */
  layers.sourceG.style.opacity = (0.3 + 0.7 * clamp(sm.effSrc)).toFixed(2);
  layers.lossG.style.opacity = (0.3 + 0.7 * clamp(sm.effLoss)).toFixed(2);
  layers.dialG.style.opacity = (0.3 + 0.7 * sm.dial).toFixed(2);
  layers.bicG.style.opacity = (0.3 + 0.7 * sm.bic).toFixed(2);
  const bp = 1 + 0.05 * sm.A * Math.sin(tm / 300);
  $("bufferC").setAttribute("transform", "translate(480 130) scale(" + bp.toFixed(3) + ") translate(-480 -130)");
  /* blood flow */
  const flow = 52;
  function runBlood(arr, want) { arr.forEach((p, i) => { p.x += flow * dt; if (p.x > 936) { p.x = 30; p.o = rnd(-0.75, 0.75); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.o * 28) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); }); }
  runBlood(bNa, 15); runBlood(bCl, Math.round(sm.Cl * 14)); runBlood(bHco, Math.round(sm.HCO * 16)); runBlood(bUn, Math.round(sm.U * 14)); runBlood(bH, Math.round(sm.A * 10));
  /* source acid to blood */
  acc.src += dt * sm.effSrc * 7; while (acc.src >= 1) { acc.src--; const p = free(srcP), s = pick(srcPts); if (p) emit(p, s[0], s[1], rnd(-4, 10), 52, 0); }
  srcP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y > CY - 40) kill(p); });
  /* bicarbonate lost from gut and kidney */
  acc.loss += dt * sm.effLoss * 6; while (acc.loss >= 1) { acc.loss--; const p = free(lossP); if (p) emit(p, Math.random() < 0.5 ? 725 : 855, 154, rnd(-8, 8), 34, 0); }
  lossP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); p.t += dt; if (p.t > 1.1) kill(p); });
  /* chloride into blood */
  acc.cl += dt * sm.effLoss * 5; while (acc.cl >= 1) { acc.cl--; const p = free(clP); if (p) emit(p, 790 + rnd(-10, 10), 178, 0, 46, 0); }
  clP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; at(p); if (p.y > CY - 40) kill(p); });
  /* buffering: H+ meets the buffer, CO2 leaves */
  acc.buf += dt * sm.A * 5; while (acc.buf >= 1) { acc.buf--; const p = free(bufH); if (p) emit(p, 408, 130 + rnd(-12, 12), 46, 0, 0); }
  bufH.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; at(p); if (p.x > 448) kill(p); });
  acc.co2b += dt * sm.A * sm.HCO * 6; while (acc.co2b >= 1) { acc.co2b--; const p = free(co2B); if (p) emit(p, 492 + rnd(-8, 8), 104, rnd(-4, 4), -30, 0); }
  co2B.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p); });
  /* lungs */
  breathPh += dt * (1 + 4.5 * sm.Br); const amp = 0.04 + 0.2 * sm.Br, sc = 1 + amp * Math.sin(breathPh);
  place($("lobeL"), 62, 382, 0, sc); place($("lobeR"), 110, 382, 0, sc);
  acc.co2l += dt * sm.Br * 6; while (acc.co2l >= 1) { acc.co2l--; const p = free(co2L); if (p) emit(p, 86 + rnd(-22, 22), 352, 0, -28, 0); }
  co2L.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; at(p); p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* dialysis clears unmeasured anions; bicarbonate given enters blood */
  acc.dial += dt * sm.dial * 6; while (acc.dial >= 1) { acc.dial--; const p = free(dialP); if (p) emit(p, 720 + rnd(-50, 50), CY + 30, 0, 42, 0); }
  dialP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; at(p); if (p.y > 350) kill(p); });
  acc.bic += dt * sm.bic * 5; while (acc.bic >= 1) { acc.bic--; const p = free(bicP); if (p) emit(p, 820, 348, 0, -46, 0); }
  bicP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; at(p); if (p.y < CY + 38) kill(p); });
  /* ion balance bars (total height fixed: blood stays neutral) */
  const base = 420, total = 78, unH = Math.round(sm.U * 42), hcoH = Math.round(sm.HCO * 32), clH = Math.max(10, total - unH - hcoH), adjTotal = clH + hcoH + unH;
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
}
run({ init, step });
