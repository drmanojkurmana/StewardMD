/* Endocarditis scene: damaged valve, bacteraemia, vegetation, septic emboli, regurgitation, immune complexes and gauges. */
const layers = { flow: $("flow"), veg: $("veg"), parts: $("parts"), over: $("over"), panel: $("panel") };
const flowTrack = track([[118, 198], [200, 198], [252, 244], [260, 282], [268, 334], [360, 330], [470, 328], [612, 328]]);
const brainTrack = track([[612, 328], [662, 262], [700, 196], [746, 164]]);
const kidneyTrack = track([[612, 328], [664, 302], [700, 290], [730, 284]]);
const skinTrack = track([[612, 328], [658, 350], [690, 364], [716, 374]]);
const organTracks = [brainTrack, kidneyTrack, skinTrack];
/* ---- red cells and bacteria riding the flow ---- */
const rbcs = [], bacs = [];
function initFlow() {
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8.4, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.1, ry: 1.6 }, g); rbcs.push({ g, u: i / 18, v: rnd(0.85, 1.15), rot: rnd(-18, 18) }); }
  for (let i = 0; i < 26; i++) { const g = mk("g", { class: "cl cl-bac" }, layers.flow); const rod = i % 3 !== 0;
    if (rod) { mk("ellipse", { class: "cl-b", rx: 6, ry: 3.1 }, g); } else { mk("circle", { class: "cl-b", r: 3.6, cx: -3 }, g); mk("circle", { class: "cl-b", r: 3.6, cx: 3 }, g); mk("circle", { class: "cl-b", r: 3.6, cy: 3.4 }, g); }
    mk("circle", { class: "cl-h", r: 1.2, cx: -1.2, cy: -1 }, g); bacs.push({ g, u: Math.random(), v: rnd(0.85, 1.15), rot: rnd(0, 180) }); }
}
/* ---- vegetation: a friable cluster sitting on the leaflet ---- */
const vegCells = [];
function initVeg() {
  [[0, 0, 13], [-14, -6, 9], [13, -7, 10], [-8, 8, 8], [11, 7, 9], [0, -13, 8], [-20, 3, 7], [20, -1, 7]].forEach(([x, y, r], i) => {
    const g = cell(layers.veg, { cls: i % 3 === 0 ? "bac" : "plt", r, seed: i * 2 + 1, wob: 0.18, n: 8 });
    vegCells.push({ g, x: 262 + x, y: 258 + y });
  });
  for (let j = 0; j < 7; j++) mk("path", { class: "fibrin", d: "M" + f1(244 + j * 6) + " 246L" + f1(250 + j * 5) + " 268" }, layers.veg);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const emboli = pool(16, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-emb", r: 4.2 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1, cy: -1 }, g); return g; });
const icx = pool(22, () => mk("path", { class: "sc-p p-icx", d: "M0 -4L1.4 -1.4L4 0L1.4 1.4L0 4L-1.4 1.4L-4 0L-1.4 -1.4Z" }, layers.parts));
const reg = pool(18, () => mk("circle", { class: "p-reg", r: 2.6 }, layers.parts));
const pills = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Bacteraemia", "g-bac", "Bacteria circulating in the blood. They seed the valve and keep the infection going until an antibiotic clears them."],
    ["veg", "Vegetation", "g-clot", "The infected mass on the leaflet: bacteria buried in fibrin and platelets, which is why treatment is prolonged and why pieces can break off."],
    ["reg", "Regurgitation", "g-bad", "Backward leak through a destroyed valve. A severe leak overloads the ventricle and causes heart failure."],
    ["emb", "Emboli", "g-cyt", "Fragments of vegetation that break off and lodge in the brain, kidney, skin, spleen and elsewhere."],
    ["imm", "Immune complexes", "g-fl", "Antigen and antibody complexes from prolonged bacteraemia. They deposit in small vessels and glomeruli, causing vasculitic lesions and glomerulonephritis."],
    ["hf", "Heart failure", "g-eos", "The ventricle fails when a severe regurgitant leak overloads it. This is the main reason for urgent valve surgery."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Damaged valve", 226, 248, 170, 108, "Damaged valve leaflet: a previously abnormal or injured leaflet loses its smooth lining, so platelets and fibrin settle on it and bacteria can stick. A normal valve can still be attacked in acute disease.");
  pill(ox, "Vegetation", 262, 252, 170, 428, "Vegetation: the friable infected mass on the leaflet, made of bacteria buried in fibrin and platelets. It grows, sheds emboli and eats into the valve.");
  pill(ox, "Bacteraemia", 470, 322, 520, 108, "Bacteraemia: bacteria circulating in the blood, from a portal such as teeth, skin, a catheter line or injecting. They stick to the damaged valve and also form immune complexes over time.");
  pill(ox, "Septic emboli", 640, 300, 565, 185, "Septic emboli: infected fragments that break off the vegetation and travel downstream to lodge in the brain, kidney, skin and other organs, causing infarcts and abscesses.");
  pill(ox, "Immune complexes", 560, 330, 565, 255, "Immune complexes: antigen and antibody clumps formed during prolonged bacteraemia. They deposit in glomeruli and small skin vessels. They are a feature of the slow subacute course.");
  pill(ox, "Valve regurgitation", 268, 300, 520, 428, "Valve regurgitation: the perforated or torn leaflet no longer seals, so blood jets backward into the atrium each beat. A severe leak causes heart failure.");
  pill(ox, "Brain embolus", 800, 142, 795, 84, "Brain: an embolus here causes a stroke, and infected emboli can seed a brain abscess or a mycotic aneurysm.");
  pill(ox, "Kidney infarct", 800, 278, 795, 330, "Kidney: an embolus causes a wedge infarct and loin pain with blood in the urine. Immune complex deposition separately causes glomerulonephritis.");
  pill(ox, "Skin lesions", 800, 375, 795, 428, "Skin: small haemorrhagic spots and painful or painless nodules from septic emboli and immune complex vasculitis, classically on the fingers, toes, palms and soles.");
  const ab = pill(ox, "Antibiotic", 480, 322, 520, 150, "An antibiotic kills the bacteria in the blood and inside the vegetation. It cannot repair a leaflet that has already been destroyed.");
  ab.setAttribute("id", "ab-pill");
  const sx = pill(ox, "Valve surgery", 300, 262, 340, 428, "Valve surgery removes the infected vegetation and tissue and repairs or replaces the valve, restoring its seal. It does not by itself sterilise the blood.");
  sx.setAttribute("id", "sx-pill");
}
const sm = { B: 0.2, Vg: 0.4, D: 0.3, R: 0.3, E: 0.2, I: 0.6, HF: 0.3, abx: 0, surg: 0 };
const acc = { emb: 0, icx: 0, reg: 0, pill: 0 };
function init() { initFlow(); initVeg(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.B = lerp(sm.B, m.B, k2); sm.Vg = lerp(sm.Vg, m.Vg, k2); sm.D = lerp(sm.D, m.D, k2); sm.R = lerp(sm.R, m.R, k1); sm.E = lerp(sm.E, m.E, k2); sm.I = lerp(sm.I, m.I, k2); sm.HF = lerp(sm.HF, m.HF, k2); sm.abx = lerp(sm.abx, m.abx, k1); sm.surg = lerp(sm.surg, m.surg, k1);
  /* flow: red cells always, bacteria in proportion to bacteraemia */
  const speed = (0.028 + 0.02 * (1 - sm.HF * 0.5)) * (0.7 + 0.5 * sm.B + 0.3 * m.a);
  rbcs.forEach((r) => { r.u = (r.u + dt * speed * r.v) % 1; const p = flowTrack.at(r.u); place(r.g, p.x, p.y, r.rot + p.a, 1); });
  const wantB = Math.round(sm.B * bacs.length);
  bacs.forEach((b, i) => { b.u = (b.u + dt * speed * b.v) % 1; const p = flowTrack.at(b.u); const on = i < wantB; place(b.g, p.x + Math.sin(tm / 300 + i) * 5, p.y + Math.cos(tm / 340 + i) * 5, b.rot + p.a, on ? 1 : 0.001); b.g.style.opacity = on ? 1 : 0; });
  /* vegetation sways and scales; damage marks and prosthesis follow the model */
  const vs = 0.25 + 0.95 * sm.Vg;
  vegCells.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 420 + i * 1.7) * 1.6 * sm.Vg, c.y + Math.cos(tm / 500 + i) * 1.2, Math.sin(tm / 600 + i) * 8, vs));
  layers.veg.style.opacity = (1 - sm.surg * 0.85).toFixed(2);
  $("dmgMark").setAttribute("opacity", clamp(sm.D * (1 - sm.surg * 0.6)).toFixed(2));
  $("leaflets").style.opacity = (1 - sm.surg * 0.55).toFixed(2);
  $("prosth").setAttribute("opacity", sm.surg.toFixed(2));
  /* septic emboli shed from the vegetation and travel to the organs */
  acc.emb += dt * sm.E * 2.6; while (acc.emb >= 1) { acc.emb--; const p = free(emboli); if (p) emit(p, 268, 258, 0, 0, Math.floor(Math.random() * 3)); }
  emboli.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.t < 0.7) { const q = flowTrack.at(0.52 + p.t * 0.55); p.x = q.x; p.y = q.y; }
    else { p.u = Math.min(1, (p.t - 0.7) / 1.5); const q = organTracks[p.k].at(p.u); p.x = q.x; p.y = q.y; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")");
    p.e.setAttribute("opacity", p.u >= 1 ? clamp(1 - (p.t - 2.2)).toFixed(2) : "1"); if (p.t > 3) kill(p); });
  $("brainSpot").setAttribute("opacity", clamp(sm.E * 1.15).toFixed(2));
  $("kidSpot").setAttribute("opacity", clamp(Math.max(sm.E, sm.I * 0.85)).toFixed(2));
  $("skinSpot").setAttribute("opacity", clamp(Math.max(sm.E, sm.I)).toFixed(2));
  /* immune complexes drift in the aorta and settle toward kidney and skin */
  acc.icx += dt * sm.I * 5; while (acc.icx >= 1) { acc.icx--; const p = free(icx); if (p) emit(p, rnd(440, 600), rnd(316, 342), rnd(6, 16), rnd(-5, 5), Math.random() < 0.5 ? 1 : 2); }
  icx.forEach((p) => { if (!p.on) return; p.t += dt; p.u = Math.min(1, p.t / 2.4); const q = organTracks[p.k].at(p.u * 0.9); p.x = lerp(p.x, q.x, dt * 0.8); p.y = lerp(p.y, q.y, dt * 0.8);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
  /* regurgitant jet: particles thrown backward into the atrium */
  acc.reg += dt * sm.R * 11; while (acc.reg >= 1) { acc.reg--; const p = free(reg); if (p) emit(p, 260 + rnd(-9, 9), 282, rnd(-9, 9), -rnd(45, 70), 0); }
  reg.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  /* antibiotic capsules enter the aorta and hunt the vegetation */
  acc.pill += dt * sm.abx * 2.2; while (acc.pill >= 1) { acc.pill--; const p = free(pills); if (p) emit(p, rnd(430, 500), 328, 0, 0, 0); }
  pills.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (262 - p.x) * dt * 0.45 - 14 * dt; p.y += (258 - p.y) * dt * 0.55; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6) kill(p); });
  $("ab-pill").style.opacity = sm.abx.toFixed(2); $("sx-pill").style.opacity = sm.surg.toFixed(2);
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.15, 0.45, ["cleared", "low", "high"])); gg.veg.set(sm.Vg, wordOf(sm.Vg, 0.25, 0.6, ["small", "present", "large"])); gg.reg.set(sm.R, wordOf(sm.R, 0.25, 0.6, ["mild", "moderate", "severe"]));
  gg.emb.set(sm.E, wordOf(sm.E, 0.2, 0.5, ["few", "some", "many"])); gg.imm.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["few", "some", "many"])); gg.hf.set(sm.HF, wordOf(sm.HF, 0.25, 0.55, ["none", "strain", "failure"]));
}
run({ init, step });
