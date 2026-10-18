/* Visual pathway scene: signals from retinas to occipital cortex, a lesion block, two visual field circles and the gauges. */
const L = { parts: $("parts"), lesion: $("lesion"), over: $("over"), panel: $("panel"), fields: $("fields") };
const TR = [
  track([[94, 125], [165, 145], [255, 200], [330, 250], [405, 265], [462, 292], [540, 265]]),
  track([[94, 125], [165, 145], [255, 200], [330, 150], [405, 135], [478, 125], [540, 135]]),
  track([[94, 275], [165, 255], [255, 200], [330, 150], [405, 135], [478, 125], [540, 135]]),
  track([[94, 275], [165, 255], [255, 200], [330, 250], [405, 265], [462, 292], [540, 265]])
];
const BLK = [
  { tr: [2, 3], u: 0.16, x: 165, y: 255 },
  { tr: [0, 3], u: 0.37, x: 255, y: 200 },
  { tr: [0, 3], u: 0.53, x: 330, y: 250 },
  { tr: [0, 3], u: 0.82, x: 462, y: 292 },
  { tr: [1, 2], u: 0.82, x: 478, y: 125 },
  { tr: [0, 3], u: 0.97, x: 540, y: 265 }
];
const sm = { loss: 0.5, reach: 0.5, intact: 0.5, comp: 0.08, func: 0.3, treat: 0 };
let gg = {}, lesionG, lesionCirc, overlays = [], gazeDots = [];
function wedge(cx, cy, r, a0, a1) {
  const rad = function (d) { return d * Math.PI / 180; };
  let d = "M" + f1(cx) + " " + f1(cy);
  for (let a = a0; a <= a1; a += 6) d += "L" + f1(cx + r * Math.cos(rad(a))) + " " + f1(cy + r * Math.sin(rad(a)));
  return d + "Z";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, passed: false }; }); }
const sig = pool(34, () => mk("circle", { class: "sc-p p-signal", r: 3 }, L.parts));
sig.forEach((p, i) => { p.on = true; p.k = i % 4; p.u = Math.random(); p.e.setAttribute("opacity", "1"); });
function buildFields() {
  const centres = [[788, 148], [788, 298]];
  const names = ["left eye", "right eye"];
  centres.forEach(([cx, cy], ei) => {
    const g = mk("g", {}, L.fields);
    mk("circle", { class: "vp-field-bg", cx: cx, cy: cy, r: 54 }, g);
    mk("path", { class: "vp-field-line", d: "M" + (cx - 54) + " " + cy + "H" + (cx + 54) + "M" + cx + " " + (cy - 54) + "V" + (cy + 54) }, g);
    const ov = {};
    ov.full = mk("circle", { class: "vp-loss", cx: cx, cy: cy, r: 54, opacity: "0" }, g);
    ov.temp = mk("path", { class: "vp-loss", d: ei === 0 ? wedge(cx, cy, 54, 90, 270) : wedge(cx, cy, 54, -90, 90), opacity: "0" }, g);
    ov.homo = mk("path", { class: "vp-loss", d: wedge(cx, cy, 54, -90, 90), opacity: "0" }, g);
    ov.upper = mk("path", { class: "vp-loss", d: wedge(cx, cy, 54, -90, 0), opacity: "0" }, g);
    ov.lower = mk("path", { class: "vp-loss", d: wedge(cx, cy, 54, 0, 90), opacity: "0" }, g);
    ov.mac = mk("g", { opacity: "0" }, g);
    mk("path", { class: "vp-loss", d: wedge(cx, cy, 54, -90, 90) }, ov.mac);
    mk("circle", { class: "vp-macular", cx: cx, cy: cy, r: 10 }, ov.mac);
    mk("circle", { cx: cx, cy: cy, r: 2.2, fill: "var(--anatomy-strong)" }, g);
    const cap = mk("text", { class: "sc-lab", x: cx, y: cy + 70, "text-anchor": "middle" }, g); cap.textContent = names[ei];
    const gz = mk("circle", { class: "vp-gaze", cx: cx, cy: cy, r: 4, opacity: "0" }, g);
    gazeDots.push(gz);
    overlays.push(ov);
  });
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["reach", "Cortex signal", "g-reach", "How much visual signal still reaches the occipital cortex."], ["intact", "Field intact", "g-intact", "How much of the combined visual field is still seen."], ["comp", "Compensation", "g-comp", "Scanning and coping strategies. Rehabilitation raises this without restoring the field."], ["func", "Daily function", "g-good", "Reading, mobility and daily tasks, helped by both field and compensation."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 140 + i * 220, y0, 60, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Retina", 72, 125, 78, 88, "Retina: light is turned into signals by photoreceptors. Ganglion cell fibres leave the eye in the optic nerve.");
  pill(o, "Chiasm", 255, 200, 258, 88, "Optic chiasm: fibres from the nasal half of each retina cross here. A lesion here loses the temporal field of each eye.");
  pill(o, "Geniculate", 405, 135, 410, 88, "Lateral geniculate body: the relay in the thalamus where optic tract fibres synapse before the radiations.");
  pill(o, "Parietal", 478, 125, 490, 88, "Parietal optic radiations: fibres for the lower visual field pass through the parietal lobe to the occipital cortex.");
  pill(o, "Occipital", 540, 135, 565, 88, "Occipital cortex: the visual cortex around the calcarine sulcus. A lesion here may spare the macular centre.");
  pill(o, "Optic nerve", 165, 255, 170, 385, "Optic nerve: all fibres from one eye. A lesion here blinds that one eye.");
  pill(o, "Optic tract", 330, 250, 335, 385, "Optic tract: fibres for the opposite half of the field from both eyes. A lesion here loses the same side in both eyes.");
  pill(o, "Temporal loop", 462, 292, 480, 385, "Temporal loop of the optic radiations: fibres for the upper visual field loop through the temporal lobe.");
  pill(o, "Field defect", 788, 298, 788, 405, "Visual field circles: black is the part not seen. The pattern, not just the amount, points to the lesion site.");
  lesionG = mk("g", { id: "lesion-mark" }, L.lesion);
  lesionCirc = mk("circle", { class: "vp-lesion", cx: 0, cy: 0, r: 13 }, lesionG);
  mk("path", { class: "vp-lesion-x", d: "M-5 -5L5 5M5 -5L-5 5" }, lesionG);
}
function init() { buildFields(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.loss = lerp(sm.loss, m.loss, k); sm.reach = lerp(sm.reach, m.reach, k); sm.intact = lerp(sm.intact, m.intact, k);
  sm.comp = lerp(sm.comp, m.comp, k); sm.func = lerp(sm.func, m.func, k); sm.treat = lerp(sm.treat, m.treat, k);
  const blk = BLK[m.defectIdx] || BLK[0];
  if (lesionG) {
    const pulse = 1 + 0.12 * Math.sin(tm / 280);
    lesionG.setAttribute("transform", "translate(" + f1(blk.x) + " " + f1(blk.y) + ") scale(" + pulse.toFixed(3) + ")");
    lesionG.setAttribute("opacity", (1 - 0.45 * sm.treat).toFixed(2));
  }
  const keys = ["full", "temp", "homo", "upper", "lower", "mac"];
  const want = keys[m.defectIdx] || "full";
  const op = clamp(0.45 + sm.loss).toFixed(2);
  overlays.forEach((ov) => { keys.forEach((key) => { const el = ov[key]; if (el) el.setAttribute("opacity", key === want ? op : "0"); }); });
  gazeDots.forEach((gz, i) => {
    const cx = 788, cy = i === 0 ? 148 : 298;
    gz.setAttribute("cx", f1(cx + Math.sin(tm / 650 + i * 1.7) * 30 * sm.comp));
    gz.setAttribute("cy", f1(cy + Math.cos(tm / 900 + i) * 10 * sm.comp));
    gz.setAttribute("opacity", (sm.comp * 0.9).toFixed(2));
  });
  sig.forEach((p) => {
    const prevU = p.u;
    p.u += dt * 0.13;
    if (blk.tr.indexOf(p.k) >= 0 && !p.passed && prevU < blk.u && p.u >= blk.u) {
      if (Math.random() < sm.treat * 0.55) { p.passed = true; }
      else { p.u = 0; p.k = Math.floor(Math.random() * 4); p.passed = false; }
    }
    if (p.u >= 1) { p.u = 0; p.k = Math.floor(Math.random() * 4); p.passed = false; }
    const tr = TR[p.k], pos = tr.at(p.u);
    p.x = pos.x; p.y = pos.y;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", "1");
  });
  gg.reach.set(sm.reach, wordOf(sm.reach, 0.55, 0.8, ["low", "partial", "good"]));
  gg.intact.set(sm.intact, wordOf(sm.intact, 0.55, 0.8, ["little", "part", "most"]));
  gg.comp.set(sm.comp, wordOf(sm.comp, 0.3, 0.65, ["low", "some", "good"]));
  gg.func.set(sm.func, wordOf(sm.func, 0.4, 0.68, ["poor", "limited", "good"]));
}
run({ init, step });
