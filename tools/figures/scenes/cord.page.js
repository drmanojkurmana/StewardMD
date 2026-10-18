/* Cord scene: brain links, tract signals, lesion shading, the body map and the gauges. */
const L = { parts: $("parts"), over: $("over"), panel: $("panel") };
const els = {
  hemi: $("lesionHemi"), ant: $("lesionAnt"), central: $("lesionCentral"), complete: $("lesionComplete"), syrinx: $("syrinx"),
  halo: $("inflamHalo"), comp: $("compressArrows"), decompArr: $("decompressArrows"),
  shR: $("shR"), shL: $("shL"), shPainR: $("shPainR"), shPainL: $("shPainL"), cape: $("cape"),
  squeeze: $("squeeze"), trainGlow: $("trainGlow"), detour: $("detour"),
  legL: $("legTrainL"), legR: $("legTrainR"), linkDown: $("linkDown"), linkUp: $("linkUp"),
};
const dorsalEls = Array.from(document.querySelectorAll(".cd-dorsal"));
const cstEls = Array.from(document.querySelectorAll(".cd-cst"));
const sttEls = Array.from(document.querySelectorAll(".cd-stt"));
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, tr: null, fate: 0 }; }); }
const dorsalSig = pool(16, () => mk("circle", { class: "sc-p p-dorsal", r: 2.6 }, L.parts));
const cstSig = pool(16, () => mk("circle", { class: "sc-p p-cst", r: 2.6 }, L.parts));
const sttSig = pool(16, () => mk("rect", { class: "sc-p p-stt", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const swPool = pool(12, () => mk("circle", { class: "sc-p p-sw", r: 3 }, L.parts));
const detPool = pool(10, () => mk("circle", { class: "sc-p p-det", r: 2.8 }, L.parts));
const upPool = pool(8, () => mk("circle", { class: "sc-p p-dorsal", r: 2.6 }, L.parts));
const downPool = pool(8, () => mk("circle", { class: "sc-p p-cst", r: 2.6 }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
let brainO = null, downTrack = null, upTrack = null, detTrackL = null, detTrackR = null;
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 448, 98, 80, {});
  const P = brainO.ports, stem = P.stem || [448, 128], par = P.parenchyma || [430, 86];
  const dp = [stem, [405, 152], [370, 182]], up = [[258, 148], [330, 124], par];
  downTrack = track(dp); upTrack = track(up);
  els.linkDown.setAttribute("d", "M" + f1(dp[0][0]) + " " + f1(dp[0][1]) + "L" + f1(dp[1][0]) + " " + f1(dp[1][1]) + "L" + f1(dp[2][0]) + " " + f1(dp[2][1]));
  els.linkUp.setAttribute("d", "M" + f1(up[0][0]) + " " + f1(up[0][1]) + "L" + f1(up[1][0]) + " " + f1(up[1][1]) + "L" + f1(up[2][0]) + " " + f1(up[2][1]));
  detTrackL = track([[170, 190], [130, 230], [130, 280], [175, 325]]);
  detTrackR = track([[360, 190], [400, 230], [400, 280], [355, 325]]);
}
function capText(d, t) {
  if (d === 3 && t === 3) return "Decompression frees the cord, but cut tracts cannot regrow.";
  if (d === 3) return "Decompression frees the cord. Blocked signals return.";
  if (d === 2) return "Rehabilitation retrains spared paths. Movement improves.";
  if (d === 1) return "Steroid concept calms swelling. More signals get through.";
  return "No treatment. The lesion blocks signals below this level.";
}
const gg = {};
let capePill, capEl, capDrug = -1, capType = -1;
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["motor", "Motor loss", "g-bad", "Loss of voluntary movement below the lesion. Corticospinal damage gives upper motor neuron signs below, with lower motor neuron signs only at the level."], ["prop", "Proprioception", "g-prop", "Loss of proprioception, vibration and fine touch. Dorsal column loss is on the same side as a cord lesion because these fibres cross in the medulla."], ["pain", "Pain and temp", "g-pain", "Loss of pain and temperature. Spinothalamic fibres cross in the cord near entry, so loss is often on the opposite side or in a cape at the level."], ["func", "Function", "g-good", "Overall function below the level: movement, feeling, transfers and daily tasks. Rehabilitation raises this even when tract loss stays."], ["inflam", "Inflammation", "g-inflam", "Secondary inflammation and swelling around the injured cord segments. Compression and inflammation can worsen tract injury."], ["spared", "Spared tracts", "g-good", "How much of the three main tracts still conducts across the lesion. Spared pathways are what rehabilitation retrains."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}
function init() {
  initOrgans();
  initPanel();
  const o = L.over;
  pill(o, "Brain", 412, 96, 448, 52, "Brain: movement signals begin here and run down the cord to muscles. Feeling signals run up to the brain.");
  pill(o, "Movement down", 362, 206, 452, 182, "Corticospinal tract: movement signals descend. Fibres mostly crossed at the pyramids, so weakness sits below the lesion.");
  pill(o, "Feeling up", 250, 172, 150, 140, "Dorsal columns: touch and position sense ascend on the same side. Lost below the lesion on that side.");
  pill(o, "Pain path", 176, 288, 118, 338, "Spinothalamic tract: pain and temperature cross in the cord, then ascend. Lost on the other side, or in a cape.");
  pill(o, "Lesion", 310, 265, 432, 332, "The shaded patch: injured tissue that blocks signals. Its place and extent decide which signals fail.");
  pill(o, "Body below level", 762, 318, 738, 420, "Limbs below the level. Red shading is weak. Hatched skin feels no pain or temperature.");
  capePill = pill(o, "Cape loss", 700, 176, 852, 100, "Cape: pain and temperature lost over shoulders and arms. Crossing fibres fail at the level.");
  capEl = mk("text", { class: "cd-cap", x: 30, y: 424 }, o); capEl.textContent = capText(0, 0);
  swPool.forEach((p) => { const a = rnd(0, 6.28), r = Math.sqrt(Math.random()); p.x = 265 + Math.cos(a) * r * 130; p.y = 238 + Math.sin(a) * r * 88; p.a = rnd(0, 6.28); p.on = true; });
  detPool.forEach((p, i) => { p.on = true; p.u = i / detPool.length; p.tr = i % 2 ? detTrackR : detTrackL; });
}
const sm = { Mtr: 0.75, Prop: 0.8, Pain: 0.7, Inflam: 0.35, Func: 0.3, Spared: 0.25, decomp: 0, steroid: 0, rehab: 0, rec: 0, squeeze: 0.5, train: 0, hemi: 1, ant: 0, central: 0, complete: 0 };
const acc = { d: 0, c: 0, s: 0, up: 0, down: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.Mtr = lerp(sm.Mtr, m.Mtr, k2); sm.Prop = lerp(sm.Prop, m.Prop, k2); sm.Pain = lerp(sm.Pain, m.Pain, k2);
  sm.Inflam = lerp(sm.Inflam, m.Inflam, k2); sm.Func = lerp(sm.Func, m.Func, k2); sm.Spared = lerp(sm.Spared, m.Spared, k2);
  sm.decomp = lerp(sm.decomp, m.decomp, k1); sm.steroid = lerp(sm.steroid, m.steroid, k1); sm.rehab = lerp(sm.rehab, m.rehab, k1);
  sm.rec = lerp(sm.rec, m.rec, k1); sm.squeeze = lerp(sm.squeeze, m.squeeze, k1); sm.train = lerp(sm.train, m.train, k1);
  sm.hemi = lerp(sm.hemi, m.type === 0 ? 1 : 0, k1); sm.ant = lerp(sm.ant, m.type === 1 ? 1 : 0, k1);
  sm.central = lerp(sm.central, m.type === 2 ? 1 : 0, k1); sm.complete = lerp(sm.complete, m.type === 3 ? 1 : 0, k1);
  const shrink = 1 - 0.55 * sm.rec;
  els.hemi.style.opacity = (sm.hemi * 0.9 * shrink).toFixed(2);
  els.ant.style.opacity = (sm.ant * 0.9 * shrink).toFixed(2);
  els.central.style.opacity = (sm.central * 0.95 * shrink).toFixed(2);
  els.complete.style.opacity = (sm.complete * 0.9 * shrink).toFixed(2);
  els.syrinx.style.opacity = (sm.central * 0.95 * shrink).toFixed(2);
  els.halo.style.opacity = (sm.Inflam * 0.85).toFixed(2);
  els.squeeze.style.opacity = sm.squeeze.toFixed(2);
  els.trainGlow.style.opacity = sm.train.toFixed(2);
  els.legL.setAttribute("opacity", clamp(sm.train * 1.4).toFixed(2));
  els.legR.setAttribute("opacity", clamp(sm.train * 1.4).toFixed(2));
  els.detour.setAttribute("opacity", clamp(sm.train * 3).toFixed(2));
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
  acc.d += dt * (1 - sm.Prop) * 8; while (acc.d >= 1) { acc.d--; const p = free(dorsalSig); if (p) emit(p, rnd(242, 288), rnd(150, 195), rnd(-3, 3), -rnd(8, 16)); }
  dorsalSig.forEach((p) => { if (!p.on || p.tr) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) kill(p); });
  acc.c += dt * (1 - sm.Mtr) * 8; while (acc.c >= 1) { acc.c--; const right = Math.random() < 0.5, p = free(cstSig); if (p) emit(p, right ? 362 : 168, rnd(185, 225), right ? rnd(10, 18) : -rnd(10, 18), rnd(12, 20)); }
  cstSig.forEach((p) => { if (!p.on || p.tr) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6 || p.x < 118 || p.x > 412 || p.y > 345) kill(p); });
  acc.s += dt * (1 - sm.Pain) * 8; while (acc.s >= 1) { acc.s--; const right = Math.random() < 0.5, p = free(sttSig); if (p) emit(p, right ? 250 : 280, rnd(255, 275), right ? rnd(14, 22) : -rnd(14, 22), rnd(4, 10)); }
  sttSig.forEach((p) => { if (!p.on || p.tr) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.7).toFixed(2)); if (p.t > 1.7 || p.x < 130 || p.x > 400) kill(p); });
  swPool.forEach((p, i) => { p.a += rnd(-1, 1) * dt; p.x += Math.cos(p.a) * 10 * dt; p.y += Math.sin(p.a) * 10 * dt;
    if (((p.x - 265) / 135) * ((p.x - 265) / 135) + ((p.y - 238) / 92) * ((p.y - 238) / 92) > 1) { const a = rnd(0, 6.28), r = Math.sqrt(Math.random()); p.x = 265 + Math.cos(a) * r * 125; p.y = 238 + Math.sin(a) * r * 83; }
    place(p.e, p.x, p.y, Math.sin(tm / 700 + i) * 20, 1 - 0.4 * sm.steroid); p.e.setAttribute("opacity", (0.12 + 0.8 * sm.Inflam).toFixed(2)); });
  const detOp = clamp(sm.train * 3);
  detPool.forEach((p) => { p.u = (p.u + dt * 0.22) % 1; const q = (p.tr || detTrackL).at(p.u); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", detOp.toFixed(2)); });
  const upBlock = m.type === 0 ? sm.Prop * 0.25 : sm.Prop, downBlock = sm.Mtr;
  acc.up += dt * (2 + 6 * (1 - upBlock)); while (acc.up >= 1) { acc.up--; const p = free(upPool); if (p) { emit(p, 0, 0, 0, 0); p.tr = upTrack; p.u = 0; p.fate = Math.random() < upBlock ? 1 : 0; } }
  upPool.forEach((p) => { if (!p.on || !p.tr) return; p.u += dt * 0.5; if ((p.fate === 1 && p.u >= 0.55) || p.u >= 1) { kill(p); return; } const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); });
  acc.down += dt * (2 + 6 * (1 - downBlock)); while (acc.down >= 1) { acc.down--; const p = free(downPool); if (p) { emit(p, 0, 0, 0, 0); p.tr = downTrack; p.u = 0; p.fate = Math.random() < downBlock ? 1 : 0; } }
  downPool.forEach((p) => { if (!p.on || !p.tr) return; p.u += dt * 0.5; if ((p.fate === 1 && p.u >= 0.7) || p.u >= 1) { kill(p); return; } const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); });
  gg.motor.set(sm.Mtr, wordOf(sm.Mtr, 0.35, 0.70, ["preserved", "weak", "lost"]));
  gg.prop.set(sm.Prop, wordOf(sm.Prop, 0.35, 0.70, ["preserved", "reduced", "lost"]));
  gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.35, 0.70, ["preserved", "reduced", "lost"]));
  gg.func.set(sm.Func, wordOf(sm.Func, 0.35, 0.70, ["poor", "reduced", "good"]));
  gg.inflam.set(sm.Inflam, wordOf(sm.Inflam, 0.25, 0.45, ["calm", "present", "marked"]));
  gg.spared.set(sm.Spared, wordOf(sm.Spared, 0.25, 0.55, ["few", "some", "many"]));
  if (drug !== capDrug || m.type !== capType) { capDrug = drug; capType = m.type; const t = capText(drug, m.type); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
