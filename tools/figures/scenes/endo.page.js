/* Endocarditis scene: infected valve inside a real heart, septic emboli to brain, kidney and skin. */
const layers = { flow: $("flow"), veg: $("veg"), parts: $("parts"), over: $("over"), panel: $("panel") };
let heartO = null, brainO = null, kidneyO = null, skinO = null;
let VX = 245, VY = 256, JX = 612, JY = 328, AX = 456, AY = 136;
let flowTrack = null, embTrack = null, organTracks = [];
let brainDot = [780, 128], kidneyDot = [769, 273], skinDot = [790, 400];
let brainAnchor = [780, 128], kidneyAnchor = [809, 278], skinAnchor = [790, 400];
let capEl = null, capDrug = -1;
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", 245, 250, 190, {});
  brainO = organ($("brainSlot"), "brain", 795, 140, 185, {});
  kidneyO = organ($("kidneySlot"), "kidney", 795, 285, 120, {});
  skinO = organ($("skinSlot"), "skin", 795, 396, 170, { h: 80 });
  VX = Math.round(heartO.x); VY = Math.round(heartO.y + 6);
  const HP = heartO.ports, ao = HP.aorta || HP.out, inp = HP.in || HP.out;
  const J = [JX, JY];
  const mx = (ao[0] + J[0]) / 2 + 60, my = Math.min(ao[1], J[1]) - 70;
  const q = (t) => { const u = 1 - t; return [u * u * ao[0] + 2 * u * t * mx + t * t * J[0], u * u * ao[1] + 2 * u * t * my + t * t * J[1]]; };
  const q1 = q(0.33), q2 = q(0.66), qm = q(0.5);
  AX = qm[0]; AY = qm[1];
  $("vesselIn").setAttribute("d", "M40 " + f1(inp[1]) + " L" + f1(inp[0]) + " " + f1(inp[1]));
  $("vesselOut").setAttribute("d", "M" + f1(ao[0]) + " " + f1(ao[1]) + " Q" + f1(mx) + " " + f1(my) + " " + f1(J[0]) + " " + f1(J[1]));
  flowTrack = track([[40, inp[1]], inp, [VX, VY], ao, q1, q2, J]);
  embTrack = track([[VX, VY], ao, q1, q2, J]);
  const bc = brainO.ports.carotid || brainO.ports.parenchyma;
  const kc = kidneyO.ports.hilum || kidneyO.ports.cortex;
  const sd = skinO.ports.dermis || [skinO.x, skinO.y];
  const bp = brainO.ports.parenchyma || bc, kp = kidneyO.ports.cortex || kc;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  organTracks = [track([J, mid(J, bc), bc]), track([J, mid(J, kc), kc]), track([J, mid(J, sd), sd])];
  const bd = (p) => "M" + f1(J[0]) + " " + f1(J[1]) + " L" + f1(p[0]) + " " + f1(p[1]);
  $("brBrain").setAttribute("d", bd(bc));
  $("brKidney").setAttribute("d", bd(kc));
  $("brSkin").setAttribute("d", bd(sd));
  brainDot = [bp[0], bp[1]]; kidneyDot = [kc[0], kc[1]]; skinDot = [sd[0], sd[1]];
  brainAnchor = [bp[0], bp[1]]; kidneyAnchor = [kp[0], kp[1]]; skinAnchor = [sd[0], sd[1]];
  $("valveSite").setAttribute("transform", "translate(" + VX + " " + VY + ")");
  $("brainSpot").setAttribute("transform", "translate(" + f1(bp[0]) + " " + f1(bp[1]) + ")");
  $("kidneySpot").setAttribute("transform", "translate(" + f1(kp[0]) + " " + f1(kp[1]) + ")");
  $("skinSpot").setAttribute("transform", "translate(" + f1(sd[0]) + " " + f1(sd[1]) + ")");
}
function capText(d) {
  if (d === 1) return "Antibiotic kills bacteria in the blood. The growth shrinks but the torn valve still leaks.";
  if (d === 2) return "Valve surgery removes the infected mass and stops the leak. Bacteria remain in the blood.";
  if (d === 3) return "Antibiotic plus valve surgery. Bacteria cleared, mass removed and the leak fixed.";
  return "No treatment. Bacteria coat the valve and clots travel to the brain, kidney and skin.";
}
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
let fibrinG = null;
function initVeg() {
  fibrinG = mk("g", {}, layers.veg);
  for (let j = 0; j < 7; j++) mk("path", { class: "fibrin", d: "M" + f1(-20 + j * 6.5) + " -14L" + f1(-15 + j * 6) + " 12" }, fibrinG);
  [[0, 0, 13], [-14, -6, 9], [13, -7, 10], [-8, 8, 8], [11, 7, 9], [0, -13, 8], [-20, 3, 7], [20, -1, 7]].forEach(([x, y, r], i) => {
    const g = cell(layers.veg, { cls: i % 3 === 0 ? "bac" : "plt", r, seed: i * 2 + 1, wob: 0.18, n: 8 });
    vegCells.push({ g, dx: x, dy: y });
  });
  fibrinG.setAttribute("transform", "translate(" + VX + " " + VY + ")");
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null }; }); }
const emboli = pool(16, () => { const g = mk("g", {}, layers.parts); mk("circle", { class: "sc-p p-emb", r: 4.2 }, g); mk("circle", { class: "cl-h", r: 1.3, cx: -1, cy: -1 }, g); return g; });
const icx = pool(22, () => mk("path", { class: "sc-p p-icx", d: "M0 -4L1.4 -1.4L4 0L1.4 1.4L0 4L-1.4 1.4L-4 0L-1.4 -1.4Z" }, layers.parts));
const reg = pool(18, () => mk("circle", { class: "p-reg", r: 3 }, layers.parts));
const caps = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges ---- */
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
  pill(ox, "Valve infection", VX, VY - 26, 170, 96, "Valve infection: bacteria stick to a damaged leaflet and grow into an infected mass that eats into the valve.");
  pill(ox, "Leaky valve", VX - 54, VY - 84, 72, 345, "Leaky valve: the torn leaflet no longer seals, so blood jets backward each beat. A severe leak causes heart failure.");
  pill(ox, "Bacteria in blood", AX, AY, 480, 70, "Bacteria in blood: bacteria circulating from a portal such as teeth, skin, a line or injecting. They seed the valve.");
  pill(ox, "Clots break off", JX, JY, 565, 212, "Clots break off: infected fragments leave the vegetation and travel in the aorta to the brain, kidney and skin.");
  pill(ox, "Brain", brainDot[0], brainDot[1], 838, 78, "Brain: a lodged fragment blocks a brain vessel and causes a stroke. Infected fragments can seed an abscess.");
  pill(ox, "Kidney", kidneyDot[0], kidneyDot[1], 795, 360, "Kidney: a lodged fragment causes an infarct with loin pain and blood in the urine. Immune complexes inflame the filters.");
  pill(ox, "Skin spots", skinDot[0], skinDot[1], 640, 408, "Skin spots: small bleeding spots and tender nodules on fingers, toes, palms and soles from emboli and vessel inflammation.");
  capEl = mk("text", { class: "en-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { B: 0.2, Vg: 0.4, D: 0.3, R: 0.3, E: 0.2, I: 0.6, HF: 0.3, abx: 0, surg: 0 };
const acc = { emb: 0, icx: 0, reg: 0, cap: 0 };
function init() { initOrgans(); initFlow(); initVeg(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.B = lerp(sm.B, m.B, k2); sm.Vg = lerp(sm.Vg, m.Vg, k2); sm.D = lerp(sm.D, m.D, k2); sm.R = lerp(sm.R, m.R, k1); sm.E = lerp(sm.E, m.E, k2); sm.I = lerp(sm.I, m.I, k2); sm.HF = lerp(sm.HF, m.HF, k2); sm.abx = lerp(sm.abx, m.abx, k1); sm.surg = lerp(sm.surg, m.surg, k1);
  /* flow: red cells always, bacteria in proportion to bacteraemia; antibiotic shrinks them */
  const speed = (0.028 + 0.02 * (1 - sm.HF * 0.5)) * (0.7 + 0.5 * sm.B + 0.3 * m.a);
  rbcs.forEach((r) => { r.u = (r.u + dt * speed * r.v) % 1; const p = flowTrack.at(r.u); place(r.g, p.x, p.y, r.rot + p.a, 1); });
  const wantB = Math.round(sm.B * bacs.length), bScale = 1 - 0.55 * sm.abx;
  bacs.forEach((b, i) => { b.u = (b.u + dt * speed * b.v) % 1; const p = flowTrack.at(b.u); const on = i < wantB;
    place(b.g, p.x + Math.sin(tm / 300 + i) * 5, p.y + Math.cos(tm / 340 + i) * 5, b.rot + p.a, on ? bScale : 0.001); b.g.style.opacity = on ? 1 : 0; });
  /* vegetation sways and scales; glow, damage marks and prosthesis follow the model */
  const vs = 0.25 + 0.95 * sm.Vg;
  vegCells.forEach((c, i) => place(c.g, VX + c.dx + Math.sin(tm / 420 + i * 1.7) * 1.6 * sm.Vg, VY + c.dy + Math.cos(tm / 500 + i) * 1.2, Math.sin(tm / 600 + i) * 8, vs));
  layers.veg.style.opacity = (1 - sm.surg * 0.95).toFixed(2);
  $("glow").setAttribute("opacity", clamp(sm.Vg * 0.45 + sm.B * 0.2).toFixed(2));
  $("dmgMark").setAttribute("opacity", clamp(sm.D * (1 - sm.surg)).toFixed(2));
  $("leaflets").style.opacity = (1 - sm.surg * 0.9).toFixed(2);
  const pr = $("prosth");
  pr.setAttribute("opacity", sm.surg.toFixed(2));
  pr.setAttribute("transform", "scale(" + (0.7 + 0.3 * sm.surg).toFixed(3) + ")");
  $("jetCone").setAttribute("opacity", clamp(sm.R * 0.85).toFixed(2));
  /* septic emboli shed from the vegetation and travel to the organs */
  acc.emb += dt * (0.4 + sm.E * 2.6); while (acc.emb >= 1) { acc.emb--; const p = free(emboli); if (p) { emit(p, VX, VY, 0, 0, Math.floor(Math.random() * 3)); p.tr = organTracks[p.k]; } }
  emboli.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.t < 0.8) { const p2 = embTrack.at(p.t / 0.8); p.x = p2.x; p.y = p2.y; }
    else { p.u = Math.min(1, (p.t - 0.8) / 1.4); const p2 = p.tr.at(p.u); p.x = p2.x; p.y = p2.y; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")");
    p.e.setAttribute("opacity", p.t > 2 ? clamp(1 - (p.t - 2)).toFixed(2) : "1"); if (p.t > 3) kill(p); });
  const bop = clamp(sm.E * 1.15), kop = clamp(Math.max(sm.E, sm.I * 0.85)), sop = clamp(Math.max(sm.E, sm.I));
  place($("brainSpot"), brainAnchor[0], brainAnchor[1], 0, 0.75 + 0.45 * sm.E);
  place($("kidneySpot"), kidneyAnchor[0], kidneyAnchor[1], 0, 0.75 + 0.45 * Math.max(sm.E, sm.I * 0.5));
  place($("skinSpot"), skinAnchor[0], skinAnchor[1], 0, 0.75 + 0.45 * Math.max(sm.E, sm.I * 0.5));
  $("brainSpot").setAttribute("opacity", bop.toFixed(2));
  $("kidneySpot").setAttribute("opacity", kop.toFixed(2));
  $("skinSpot").setAttribute("opacity", sop.toFixed(2));
  /* immune complexes drift from the aorta and settle toward kidney and skin */
  acc.icx += dt * sm.I * 5; while (acc.icx >= 1) { acc.icx--; const p = free(icx); if (p) { emit(p, JX, JY, 0, 0, Math.random() < 0.5 ? 1 : 2); p.tr = organTracks[p.k]; } }
  icx.forEach((p) => { if (!p.on) return; p.t += dt; p.u = Math.min(1, p.t / 2.2); const p2 = p.tr.at(p.u); p.x = p2.x; p.y = p2.y;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 9) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
  /* regurgitant jet: particles thrown backward into the atrium */
  acc.reg += dt * sm.R * 12; while (acc.reg >= 1) { acc.reg--; const p = free(reg); if (p) emit(p, VX + rnd(-6, 6), VY - 4, rnd(-20, -4), -rnd(45, 75), 0); }
  reg.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p); });
  /* antibiotic capsules enter the aorta, home to the vegetation, sit on it, then fade */
  acc.cap += dt * sm.abx * 2.4; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(430, 500), 322, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { p.x += ((VX - p.x) * 0.6 - 14) * dt; p.y += (VY - p.y) * 0.6 * dt;
      if (Math.hypot(VX - p.x, VY - p.y) < 14) { p.k = 1; p.t = 0; p.vx = rnd(-18, 18); p.vy = rnd(-14, 10); } }
    if (p.k === 1) { p.e.setAttribute("transform", "translate(" + f1(VX + p.vx) + " " + f1(VY + p.vy) + ") rotate(" + f1(p.t * 40) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); }
    else { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.t > 5) kill(p); } });
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.15, 0.45, ["cleared", "low", "high"])); gg.veg.set(sm.Vg, wordOf(sm.Vg, 0.25, 0.6, ["small", "present", "large"])); gg.reg.set(sm.R, wordOf(sm.R, 0.25, 0.6, ["mild", "moderate", "severe"]));
  gg.emb.set(sm.E, wordOf(sm.E, 0.2, 0.5, ["few", "some", "many"])); gg.imm.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["few", "some", "many"])); gg.hf.set(sm.HF, wordOf(sm.HF, 0.25, 0.55, ["none", "strain", "failure"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
