/* Cord scene: tract signals in the cross section, lesion shading, the body map and the gauges. */
const L = { parts: $("parts"), over: $("over"), panel: $("panel") };
const els = {
  hemi: $("lesionHemi"), ant: $("lesionAnt"), central: $("lesionCentral"), complete: $("lesionComplete"), syrinx: $("syrinx"),
  halo: $("inflamHalo"), comp: $("compressArrows"), decompArr: $("decompressArrows"),
  shR: $("shR"), shL: $("shL"), shPainR: $("shPainR"), shPainL: $("shPainL"), cape: $("cape"),
};
const dorsalEls = Array.from(document.querySelectorAll(".cd-dorsal"));
const cstEls = Array.from(document.querySelectorAll(".cd-cst"));
const sttEls = Array.from(document.querySelectorAll(".cd-stt"));
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const dorsalSig = pool(18, () => mk("circle", { class: "sc-p p-dorsal", r: 2.6 }, L.parts));
const cstSig = pool(18, () => mk("circle", { class: "sc-p p-cst", r: 2.6 }, L.parts));
const sttSig = pool(18, () => mk("rect", { class: "sc-p p-stt", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
let capePill, decPill, sterPill, rehabPill;
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["motor", "Motor loss", "g-bad", "Loss of voluntary movement below the lesion. Corticospinal damage gives upper motor neuron signs below, with lower motor neuron signs only at the level."], ["prop", "Proprioception", "g-prop", "Loss of proprioception, vibration and fine touch. Dorsal column loss is on the same side as a cord lesion because these fibres cross in the medulla."], ["pain", "Pain and temp", "g-pain", "Loss of pain and temperature. Spinothalamic fibres cross in the cord near entry, so loss is often on the opposite side or in a cape at the level."], ["func", "Function", "g-good", "Overall function below the level: movement, feeling, transfers and daily tasks. Rehabilitation raises this even when tract loss stays."], ["inflam", "Inflammation", "g-inflam", "Secondary inflammation and swelling around the injured cord segments. Compression and inflammation can worsen tract injury."], ["spared", "Spared tracts", "g-good", "How much of the three main tracts still conducts across the lesion. Spared pathways are what rehabilitation trains."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function init() {
  initPanel();
  const o = L.over;
  pill(o, "Dorsal columns", 250, 158, 128, 102, "Dorsal columns: proprioception, vibration and fine touch ascend on the same side and cross in the medulla. Loss is ipsilateral below a cord lesion.");
  pill(o, "Corticospinal tract", 362, 206, 398, 102, "Lateral corticospinal tract: motor commands descend after mostly crossing at the medullary pyramids. A cord lesion gives upper motor neuron weakness below the level.");
  pill(o, "Spinothalamic", 176, 288, 118, 398, "Spinothalamic tract: pain and temperature cross in the cord within a segment or two of the sensory nerve entry, then ascend on the opposite side.");
  pill(o, "Central canal", 265, 238, 265, 398, "Central canal and crossing fibres. A central syrinx or central cord injury interrupts crossing pain and temperature fibres first, giving a cape distribution.");
  pill(o, "Lesion", 305, 262, 408, 398, "The shaded lesion. Its pattern decides which tracts fail: hemisection, anterior cord, central cord or complete transection across all segments below the level.");
  pill(o, "Lesion level", 738, 148, 635, 100, "The lesion level, shown at cervical segments. Signs below the level follow the tracts interrupted. Vertebral bodies sit lower than the same numbered cord segments in the lower spine.");
  capePill = pill(o, "Cape loss", 700, 176, 842, 100, "Cape distribution: pain and temperature loss over the shoulders and upper arms from interrupted crossing fibres at the level, classic for syringomyelia, usually idiopathic.");
  capePill.setAttribute("id", "cape-pill");
  pill(o, "Pain and temp loss", 712, 330, 635, 398, "Body map, hatched: where pain and temperature are lost. In hemisection this is contralateral, in anterior and complete lesions it is below the level on both sides.");
  pill(o, "Motor loss", 766, 330, 842, 398, "Body map, shaded: where movement is lost. Hemisection weakens the same side, anterior and complete lesions weaken both sides below the level, central cord weakens arms more than legs.");
  decPill = pill(o, "Decompression", 900, 148, 738, 425, "Decompression: surgery to relieve extrinsic compression from vertebral, disc, tumour or abscess pressure on the cord.");
  decPill.setAttribute("id", "dec-pill");
  sterPill = pill(o, "Steroid concept", 900, 148, 738, 425, "Steroid concept: calming secondary inflammation and swelling after acute cord injury. Shown as a concept only, with no agent or dose.");
  sterPill.setAttribute("id", "ster-pill");
  rehabPill = pill(o, "Rehabilitation", 900, 148, 738, 425, "Rehabilitation: training spared pathways, strength and transfers, and bladder and bowel routines. Function can improve even when tract loss persists.");
  rehabPill.setAttribute("id", "rehab-pill");
}
const sm = { Mtr: 0.75, Prop: 0.8, Pain: 0.7, Inflam: 0.35, Func: 0.3, Spared: 0.25, decomp: 0, steroid: 0, rehab: 0, hemi: 1, ant: 0, central: 0, complete: 0 };
const acc = { d: 0, c: 0, s: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Mtr = lerp(sm.Mtr, m.Mtr, k2); sm.Prop = lerp(sm.Prop, m.Prop, k2); sm.Pain = lerp(sm.Pain, m.Pain, k2);
  sm.Inflam = lerp(sm.Inflam, m.Inflam, k2); sm.Func = lerp(sm.Func, m.Func, k2); sm.Spared = lerp(sm.Spared, m.Spared, k2);
  sm.decomp = lerp(sm.decomp, m.decomp, k1); sm.steroid = lerp(sm.steroid, m.steroid, k1); sm.rehab = lerp(sm.rehab, m.rehab, k1);
  sm.hemi = lerp(sm.hemi, m.type === 0 ? 1 : 0, k1); sm.ant = lerp(sm.ant, m.type === 1 ? 1 : 0, k1);
  sm.central = lerp(sm.central, m.type === 2 ? 1 : 0, k1); sm.complete = lerp(sm.complete, m.type === 3 ? 1 : 0, k1);
  els.hemi.style.opacity = (sm.hemi * 0.9).toFixed(2);
  els.ant.style.opacity = (sm.ant * 0.9).toFixed(2);
  els.central.style.opacity = (sm.central * 0.95).toFixed(2);
  els.complete.style.opacity = (sm.complete * 0.9).toFixed(2);
  els.syrinx.style.opacity = (sm.central * 0.95).toFixed(2);
  els.halo.style.opacity = (sm.Inflam * 0.85).toFixed(2);
  els.comp.setAttribute("opacity", ((m.type === 3 ? 0.35 : 0.85) * (1 - sm.decomp)).toFixed(2));
  els.decompArr.setAttribute("opacity", sm.decomp.toFixed(2));
  dorsalEls.forEach((e) => { e.style.opacity = (0.30 + 0.65 * (1 - sm.Prop)).toFixed(2); });
  cstEls.forEach((e) => { e.style.opacity = (0.30 + 0.62 * (1 - sm.Mtr)).toFixed(2); });
  sttEls.forEach((e) => { e.style.opacity = (0.30 + 0.62 * (1 - sm.Pain)).toFixed(2); });
  let shR = 0, shL = 0, painR = 0, painL = 0, cape = 0;
  if (m.type === 0) { shR = 0.52 * Math.max(sm.Mtr, sm.Prop); painL = 0.85 * sm.Pain; }
  else if (m.type === 1) { shR = 0.48 * sm.Mtr; shL = shR; painR = 0.85 * sm.Pain; painL = painR; }
  else if (m.type === 2) { shR = 0.30 * sm.Mtr; shL = shR; cape = 0.9 * sm.Pain; }
  else { shR = 0.52 * Math.max(sm.Mtr, sm.Prop); shL = shR; painR = 0.85 * sm.Pain; painL = painR; }
  els.shR.setAttribute("opacity", clamp(shR).toFixed(2)); els.shL.setAttribute("opacity", clamp(shL).toFixed(2));
  els.shPainR.setAttribute("opacity", clamp(painR).toFixed(2)); els.shPainL.setAttribute("opacity", clamp(painL).toFixed(2));
  els.cape.setAttribute("opacity", clamp(cape).toFixed(2));
  capePill.style.opacity = sm.central.toFixed(2);
  decPill.style.opacity = sm.decomp.toFixed(2);
  sterPill.style.opacity = sm.steroid.toFixed(2);
  rehabPill.style.opacity = sm.rehab.toFixed(2);
  acc.d += dt * (1 - sm.Prop) * 8; while (acc.d >= 1) { acc.d--; const p = free(dorsalSig); if (p) emit(p, rnd(242, 288), rnd(150, 195), rnd(-3, 3), -rnd(8, 16), 0); }
  dorsalSig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) kill(p); });
  acc.c += dt * (1 - sm.Mtr) * 8; while (acc.c >= 1) { acc.c--; const right = Math.random() < 0.5, p = free(cstSig); if (p) emit(p, right ? 362 : 168, rnd(185, 225), right ? rnd(10, 18) : -rnd(10, 18), rnd(12, 20), 0); }
  cstSig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6 || p.x < 118 || p.x > 412 || p.y > 345) kill(p); });
  acc.s += dt * (1 - sm.Pain) * 8; while (acc.s >= 1) { acc.s--; const right = Math.random() < 0.5, p = free(sttSig); if (p) emit(p, right ? 250 : 280, rnd(255, 275), right ? rnd(14, 22) : -rnd(14, 22), rnd(4, 10), 0); }
  sttSig.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.7).toFixed(2)); if (p.t > 1.7 || p.x < 130 || p.x > 400) kill(p); });
  gg.motor.set(sm.Mtr, wordOf(sm.Mtr, 0.35, 0.70, ["preserved", "weak", "lost"]));
  gg.prop.set(sm.Prop, wordOf(sm.Prop, 0.35, 0.70, ["preserved", "reduced", "lost"]));
  gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.35, 0.70, ["preserved", "reduced", "lost"]));
  gg.func.set(sm.Func, wordOf(sm.Func, 0.35, 0.70, ["poor", "reduced", "good"]));
  gg.inflam.set(sm.Inflam, wordOf(sm.Inflam, 0.25, 0.45, ["calm", "present", "marked"]));
  gg.spared.set(sm.Spared, wordOf(sm.Spared, 0.25, 0.55, ["few", "some", "many"]));
}
run({ init, step });
