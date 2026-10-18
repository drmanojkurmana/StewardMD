/* Visual pathway scene: eye and brain anatomy, signals from the eyes to the visual cortex, a lesion block, two visual field circles and the gauges. */
const L = { parts: $("parts"), lesion: $("lesion"), over: $("over"), panel: $("panel"), fields: $("fields"), glow: $("glow") };
const NERVE_U = [165, 145], NERVE_L = [165, 255], CH = [255, 200], TRACT_U = [330, 150], TRACT_L = [330, 250], LGN_U = [405, 135], LGN_L = [405, 265], PAR = [478, 125], TEMP = [462, 292];
let TR = [];
const BLK = [
  { tr: [2, 3], u: 0.11, x: 165, y: 255 },
  { tr: [0, 3], u: 0.30, x: 255, y: 200 },
  { tr: [0, 3], u: 0.46, x: 330, y: 250 },
  { tr: [0, 3], u: 0.70, x: 462, y: 292 },
  { tr: [1, 2], u: 0.73, x: 478, y: 125 },
  { tr: [0, 3], u: 0.98, x: 600, y: 208 }
];
const sm = { loss: 0.5, reach: 0.5, intact: 0.5, comp: 0.08, func: 0.3, treat: 0, rehab: 0 };
let gg = {}, lesionG, healRing, compGlow, healU, healD, overlays = [], gazeDots = [], scans = [], capEl = null, capDrug = -1, healOff = 0, compC = [548, 190];
function wedge(cx, cy, r, a0, a1) {
  const rad = function (d) { return d * Math.PI / 180; };
  let d = "M" + f1(cx) + " " + f1(cy);
  for (let a = a0; a <= a1; a += 6) d += "L" + f1(cx + r * Math.cos(rad(a))) + " " + f1(cy + r * Math.sin(rad(a)));
  return d + "Z";
}
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, passed: false }; }); }
const sig = pool(34, () => mk("circle", { class: "sc-p p-signal", r: 3 }, L.parts));
sig.forEach((p, i) => { p.on = true; p.k = i % 4; p.u = Math.random(); p.e.setAttribute("opacity", "1"); });
function capText(d) {
  if (d === 1) return "Treating the cause reopens fibres. The dark area shrinks.";
  if (d === 2) return "Rehab trains new scanning. Sight stays dark but tasks get easier.";
  return "No treatment. The signal is blocked and part of sight stays dark.";
}
function initOrgans() {
  const eyeU = organ($("eyeSlotU"), "eye", 72, 125, 64, {});
  const eyeL = organ($("eyeSlotL"), "eye", 72, 275, 64, {});
  const brainO = organ($("brainSlot"), "brain", 560, 200, 120, {});
  const edgeU = [Math.round(brainO.x - brainO.w / 2 + 6), 168];
  const edgeL = [Math.round(brainO.x - brainO.w / 2 + 6), 232];
  const poleU = [Math.round(brainO.x + brainO.w / 2 - 20), 195];
  const poleL = [Math.round(brainO.x + brainO.w / 2 - 20), 222];
  const nU = eyeU.ports.out, nL = eyeL.ports.out;
  const P = [
    [nU, NERVE_U, CH, TRACT_L, LGN_L, TEMP, edgeL, poleL],
    [nU, NERVE_U, CH, TRACT_U, LGN_U, PAR, edgeU, poleU],
    [nL, NERVE_L, CH, TRACT_U, LGN_U, PAR, edgeU, poleU],
    [nL, NERVE_L, CH, TRACT_L, LGN_L, TEMP, edgeL, poleL]
  ];
  const dto = function (pts) { return "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"); };
  TR = P.map(track);
  P.forEach((pts, i) => $("fib" + i).setAttribute("d", dto(pts)));
  healU = $("fibHealU"); healD = $("fibHealD");
  healU.setAttribute("d", dto([CH, TRACT_U, LGN_U, PAR, edgeU, poleU]));
  healD.setAttribute("d", dto([CH, TRACT_L, LGN_L, TEMP, edgeL, poleL]));
  healU.setAttribute("opacity", "0"); healD.setAttribute("opacity", "0");
  if (brainO.ports.parenchyma) compC = brainO.ports.parenchyma;
  compGlow.setAttribute("cx", f1(compC[0])); compGlow.setAttribute("cy", f1(compC[1]));
}
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
    const sc = mk("ellipse", { class: "vp-scan", cx: cx, cy: cy, rx: 58, ry: 44, opacity: "0" }, g);
    scans.push({ e: sc, cx: cx, cy: cy });
    const cap = mk("text", { class: "sc-lab", x: cx, y: cy + 70, "text-anchor": "middle" }, g); cap.textContent = names[ei];
    const gz = mk("circle", { class: "vp-gaze", cx: cx, cy: cy, r: 5, opacity: "0" }, g);
    gazeDots.push(gz);
    overlays.push(ov);
  });
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["reach", "Cortex signal", "g-reach", "How much visual signal still reaches the visual cortex."], ["intact", "Field intact", "g-intact", "How much of the combined visual field is still seen."], ["comp", "Compensation", "g-comp", "Scanning and coping strategies. Rehabilitation raises this without restoring the field."], ["func", "Daily function", "g-good", "Reading, mobility and daily tasks, helped by both field and compensation."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 140 + i * 220, y0, 60, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Eyes", 72, 125, 78, 88, "Eyes: light is focused here and turned into signals. Each eye sends its fibres down its optic nerve.");
  pill(o, "Chiasm", 255, 200, 258, 88, "Optic chiasm: fibres from the nasal half of each retina cross. A lesion here loses the outer field of each eye.");
  pill(o, "Geniculate", 405, 135, 410, 88, "Geniculate body: the relay where tract fibres synapse before the radiations.");
  pill(o, "Cortex", 560, 155, 565, 88, "Visual cortex: the seeing part at the back of the brain. A lesion here may spare the sharp centre.");
  pill(o, "Optic nerve", 165, 255, 170, 385, "Optic nerve: all fibres from one eye. A lesion here blinds that one eye.");
  pill(o, "Optic tract", 330, 250, 335, 385, "Optic tract: fibres for the opposite half of sight from both eyes. A lesion here loses the same side in both eyes.");
  pill(o, "Radiations", 462, 292, 480, 385, "Optic radiations: the temporal loop carries upper field fibres and the parietal fibres carry lower field fibres.");
  pill(o, "Field defect", 788, 298, 788, 405, "Field circles: black is the part not seen. The pattern points to the lesion site.");
  lesionG = mk("g", { id: "lesion-mark" }, L.lesion);
  mk("circle", { class: "vp-lesion", cx: 0, cy: 0, r: 13 }, lesionG);
  mk("path", { class: "vp-lesion-x", d: "M-5 -5L5 5M5 -5L-5 5" }, lesionG);
  capEl = mk("text", { class: "vp-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0);
}
function init() {
  healRing = mk("ellipse", { class: "vp-heal", cx: 0, cy: 0, rx: 26, ry: 20, opacity: "0" }, L.glow);
  compGlow = mk("ellipse", { class: "vp-comp", cx: compC[0], cy: compC[1], rx: 72, ry: 56, opacity: "0" }, L.glow);
  initOrgans(); buildFields(); initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.loss = lerp(sm.loss, m.loss, k); sm.reach = lerp(sm.reach, m.reach, k); sm.intact = lerp(sm.intact, m.intact, k);
  sm.comp = lerp(sm.comp, m.comp, k); sm.func = lerp(sm.func, m.func, k); sm.treat = lerp(sm.treat, m.treat, k); sm.rehab = lerp(sm.rehab, m.rehab, k);
  healOff = (healOff - dt * 36) % 16;
  const blk = BLK[m.defectIdx] || BLK[0];
  if (lesionG) {
    const pulse = (1 + 0.12 * Math.sin(tm / 280)) * (1 - 0.5 * sm.treat);
    lesionG.setAttribute("transform", "translate(" + f1(blk.x) + " " + f1(blk.y) + ") scale(" + pulse.toFixed(3) + ")");
    lesionG.setAttribute("opacity", (1 - 0.45 * sm.treat).toFixed(2));
  }
  if (healRing) {
    healRing.setAttribute("cx", f1(blk.x)); healRing.setAttribute("cy", f1(blk.y));
    healRing.setAttribute("rx", f1(24 + 6 * Math.sin(tm / 300)));
    healRing.setAttribute("ry", f1(19 + 5 * Math.sin(tm / 300)));
    healRing.setAttribute("opacity", (sm.treat * 0.85).toFixed(2));
  }
  if (healU) {
    healU.setAttribute("opacity", (sm.treat * 0.9).toFixed(2));
    healD.setAttribute("opacity", (sm.treat * 0.9).toFixed(2));
    healU.setAttribute("stroke-dashoffset", f1(healOff));
    healD.setAttribute("stroke-dashoffset", f1(healOff));
  }
  if (compGlow) compGlow.setAttribute("opacity", (0.03 + sm.comp * 0.32).toFixed(2));
  const keys = ["full", "temp", "homo", "upper", "lower", "mac"];
  const want = keys[m.defectIdx] || "full";
  const op = (clamp(0.45 + sm.loss) * (1 - 0.55 * sm.treat)).toFixed(2);
  overlays.forEach((ov) => { keys.forEach((key) => { const el = ov[key]; if (el) el.setAttribute("opacity", key === want ? op : "0"); }); });
  scans.forEach((s, i) => {
    s.e.setAttribute("cx", f1(s.cx + Math.sin(tm / 550 + i * 2.2) * 34));
    s.e.setAttribute("cy", f1(s.cy + Math.cos(tm / 700 + i) * 8));
    s.e.setAttribute("opacity", (sm.rehab * 0.4).toFixed(2));
  });
  gazeDots.forEach((gz, i) => {
    const cx = 788, cy = i === 0 ? 148 : 298;
    gz.setAttribute("cx", f1(cx + Math.sin(tm / 650 + i * 1.7) * 30 * sm.comp));
    gz.setAttribute("cy", f1(cy + Math.cos(tm / 900 + i) * 10 * sm.comp));
    gz.setAttribute("opacity", (sm.comp * 0.95).toFixed(2));
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
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
