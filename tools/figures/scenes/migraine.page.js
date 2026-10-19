/* Migraine scene: aura wave over the brain, trigeminal firing, CGRP trapped at the vessel wall, vessel widening, light sensitivity, nausea and gauges. */
const L = { brain: $("brainSlot"), eye: $("eyeSlot"), gang: $("gangSlot"), vessel: $("vesselSlot"), stom: $("stomSlot"), flow: $("flow"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { hypo: 0.3, csd: 0.3, trig: 0.5, cgrpSig: 0.4, vaso: 0.3, infl: 0.3, pain: 0.4, photo: 0.3, nausea: 0.3, nsaid: 0, cgrpRx: 0, trip: 0, prev: 0 };
const acc = { prod: 0, trig: 0, cgrp: 0, pain: 0, infl: 0, block: 0 };
let brainO = null, gangO = null, vesselO = null, eyeO = null, stomO = null, capEl = null, capDrug = -1;
let wave = null, waveBox = [80, 250, 130, 172], halo = null, glow = null, rays = null;
let recep = [], leaks = [], ends = [], trNerve = null, trPain = null, gg = {};
let stemPt = [150, 280], gangInPt = [360, 258], wallPt = [640, 245], parPt = [150, 200], lensPt = [350, 128];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null, ri: -1, kind: "", tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.st = 0; p.ri = -1; p.kind = ""; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const prod = pool(10, () => mk("circle", { class: "sc-p p-prod", r: 2.4 }, L.parts));
const trigP = pool(24, () => mk("circle", { class: "sc-p p-trig", r: 2.6 }, L.parts));
const cgrpP = pool(22, () => mk("circle", { class: "sc-p p-cgrp", r: 2.8 }, L.parts));
const painP = pool(16, () => mk("circle", { class: "sc-p p-pain", r: 2.4 }, L.parts));
const inflP = pool(14, () => mk("circle", { class: "sc-p p-pain", r: 2.2 }, L.parts));
const blockP = pool(12, () => mk("circle", { class: "sc-p p-block", r: 4.5 }, L.parts));
function capText(d) {
  if (d === 4) return "Triptan sits on its receptor. The vessel tightens and pain signals fade.";
  if (d === 2) return "CGRP blocker sits on the vessel wall. CGRP is trapped and the vessel stays narrow.";
  if (d === 1) return "NSAID calms inflammation. Leaks fade and headache eases.";
  if (d === 3) return "Preventive treatment calms the brain. The aura wave slows and attacks start less often.";
  return "No treatment. Nerve signals widen the vessel and headache builds.";
}
function initOrgans() {
  brainO = organ(L.brain, "brain", 165, 208, 175, {});
  eyeO = organ(L.eye, "eye", 405, 128, 115, {});
  gangO = organ(L.gang, "ganglion", 430, 258, 145, {});
  vesselO = organ(L.vessel, "vessel", 700, 245, 150, { h: 175 });
  stomO = organ(L.stom, "stomach", 845, 345, 125, {});
  stemPt = brainO.ports.stem; parPt = brainO.ports.parenchyma; lensPt = eyeO.ports.lens;
  gangInPt = gangO.ports.in; wallPt = vesselO.ports.wall;
  const go = gangO.ports.out;
  const midx = (go[0] + wallPt[0]) / 2;
  trNerve = track([go, [midx, go[1] - 10], [midx + 20, wallPt[1] - 30], wallPt]);
  trPain = track([wallPt, [560, 292], [gangO.x, gangO.y + 30], parPt]);
  waveBox = [brainO.x - brainO.w * 0.42, brainO.x + brainO.w * 0.42, brainO.y - brainO.h * 0.38, brainO.y - brainO.h * 0.38 + 42];
  const hw = vesselO.w / 2 - 2;
  recep = [];
  [-52, 0, 52].forEach((dy) => { recep.push({ x: vesselO.x - hw, y: vesselO.y + dy, by: null }); recep.push({ x: vesselO.x + hw, y: vesselO.y + dy, by: null }); });
  leaks = [-55, -18, 18, 55].map((dx) => ({ x: vesselO.x + dx, y: vesselO.y + vesselO.h / 2 + 16, by: null }));
  ends = [-45, 0, 45].map((dx) => [vesselO.x + dx, vesselO.y + vesselO.h / 2 - 4]);
}
function init() {
  initOrgans();
  const F = L.flow;
  halo = mk("rect", { class: "mg-halo", x: 620, y: 170, width: 160, height: 150, rx: 24, opacity: "0" }, L.vessel);
  L.vessel.insertBefore(halo, vesselO.g);
  mk("path", { class: "dr-beam", d: "M" + f1(stemPt[0]) + " " + f1(stemPt[1]) + "L" + f1(gangInPt[0]) + " " + f1(gangInPt[1]) }, F);
  mk("path", { class: "dr-beam", d: "M" + f1(gangO.ports.out[0]) + " " + f1(gangO.ports.out[1]) + " C" + f1((gangO.ports.out[0] + wallPt[0]) / 2) + " " + f1(gangO.ports.out[1] - 24) + " " + f1(wallPt[0] - 30) + " " + f1(wallPt[1] - 40) + " " + f1(wallPt[0]) + " " + f1(wallPt[1]) }, F);
  const clip = mk("clipPath", { id: "mgclip" }, F);
  mk("rect", { x: f1(waveBox[0]), y: f1(waveBox[2]), width: f1(waveBox[1] - waveBox[0]), height: f1(waveBox[3] - waveBox[2]), rx: 12 }, clip);
  const waveG = mk("g", { "clip-path": "url(#mgclip)" }, F);
  wave = mk("rect", { class: "mg-csd", x: f1(waveBox[0]), y: f1(waveBox[2]), width: 90, height: f1(waveBox[3] - waveBox[2]), opacity: "0" }, waveG);
  glow = mk("ellipse", { class: "mg-glow", cx: f1(parPt[0]), cy: f1(parPt[1]), rx: 72, ry: 56, opacity: "0" }, F);
  recep.forEach((r) => mk("circle", { class: "mg-rec", cx: f1(r.x), cy: f1(r.y), r: 4 }, F));
  leaks.forEach((s) => mk("circle", { class: "mg-leak", cx: f1(s.x), cy: f1(s.y), r: 3.4, opacity: "0.55" }, F));
  rays = mk("g", { opacity: "0" }, F);
  [[-46, -26], [-46, 26], [46, -26], [46, 26], [0, -36], [0, 36]].forEach(([dx, dy]) => mk("path", { class: "mg-ray", d: "M" + f1(lensPt[0] + dx * 0.6) + " " + f1(lensPt[1] + dy * 0.6) + "L" + f1(lensPt[0] + dx) + " " + f1(lensPt[1] + dy) }, rays));
  const o = L.over;
  pill(o, "Brain", Math.round(brainO.x - 60), Math.round(brainO.y - 40), 105, 70, "Brain. Migraine starts in the brain. In the prodrome it becomes excitable, and in headache its pain circuits are sensitised.");
  pill(o, "Aura wave", Math.round(brainO.x + 50), Math.round(waveBox[2] + 15), 250, 70, "Aura wave. A slow wave of activity then quiet crosses the cortex. It causes gradually spreading visual or sensory symptoms.");
  pill(o, "Light hurts", eyeO.x, eyeO.y, 430, 70, "Light hurts. In headache the sensitised brain overreacts to light and sound.");
  pill(o, "Trigeminal nerve", gangO.x, gangO.y, 430, 372, "Trigeminal nerve. When it fires, its endings release CGRP onto the meningeal vessel and pain signals travel back to the brain.");
  pill(o, "Meningeal vessel", vesselO.x, vesselO.y, 700, 180, "Meningeal vessel. CGRP widens it and nearby tissue becomes inflamed, so each pulse throbs.");
  pill(o, "CGRP", vesselO.x - 45, vesselO.y + 55, 600, 352, "CGRP. A protein released from nerve endings. It widens the vessel and passes pain on. Blockers trap it at the wall.");
  pill(o, "Nausea", stomO.x, stomO.y, 870, 300, "Nausea. Brainstem circuits switch on during the attack and the stomach churns.");
  capEl = mk("text", { class: "mg-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0);
  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["csd", "Aura wave", "g-csd", "Cortical spreading depression crossing the cortex in aura. Quiet in most of prodrome, fading as headache takes over."], ["trig", "Trigeminal", "g-clot", "Firing of the trigeminovascular system: trigeminal nucleus, ganglion and meningeal endings."], ["cgrp", "CGRP signal", "g-cgrp", "CGRP released from trigeminal endings acting at its receptor on vessel and nerve."], ["vaso", "Vessel width", "g-vaso", "Widening of the meningeal vessel. A triptan tightens it; CGRP widens it."], ["infl", "Inflammation", "g-bad", "Neurogenic inflammation: leak and sensitisation around the meningeal vessel. An NSAID reduces it."], ["pain", "Headache", "g-pain", "Headache pain relayed to the brain: throbbing pain with light sensitivity and nausea."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function wallParked() { let n = 0; recep.forEach((r) => { if (r.by && r.by.st === 1) n++; }); return n; }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["csd", "trig", "cgrpSig", "vaso", "infl", "pain", "photo", "nausea", "nsaid", "cgrpRx", "trip", "prev"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "csd" || q === "trig" ? k2 : k1); });
  sm.hypo = lerp(sm.hypo, m.hypo, k2);
  const kind = m.trip || m.cgrpRx ? "wall" : (m.nsaid ? "leak" : "");
  /* aura wave sweeps the brain, slower and smaller on preventive treatment */
  const period = 5200 * (1 + 0.9 * sm.prev);
  const sweep = ((tm / period) % 1.3);
  const bw = waveBox[1] - waveBox[0], ww = 60 + 60 * sm.csd;
  wave.setAttribute("x", f1(waveBox[0] - ww + sweep * (bw + ww)));
  wave.setAttribute("width", f1(ww));
  wave.setAttribute("opacity", (sm.csd * 0.55).toFixed(2));
  glow.setAttribute("opacity", (sm.pain * 0.28).toFixed(2));
  /* vessel widens with vasodilation, halo shows the swelling at a glance */
  const hw = vesselO.w * (0.72 + 0.62 * sm.vaso), hh = vesselO.h * (0.72 + 0.62 * sm.vaso);
  halo.setAttribute("x", f1(vesselO.x - hw / 2)); halo.setAttribute("width", f1(hw));
  halo.setAttribute("y", f1(vesselO.y - hh / 2)); halo.setAttribute("height", f1(hh));
  halo.setAttribute("opacity", (0.08 + 0.3 * sm.vaso).toFixed(2));
  place(vesselO.g, vesselO.x, vesselO.y, 0, 1 + 0.07 * sm.vaso);
  place(gangO.g, gangO.x, gangO.y, 0, 1 + 0.05 * sm.trig * Math.sin(tm / 260));
  place(stomO.g, stomO.x, stomO.y, Math.sin(tm / 500) * 6 * sm.nausea, 1);
  rays.setAttribute("opacity", sm.photo.toFixed(2));
  /* prodrome sparks: brainstem toward the ganglion */
  acc.prod += dt * sm.hypo * 5; while (acc.prod >= 1) { acc.prod--; const p = free(prod); if (p) { const dx = gangInPt[0] - stemPt[0], dy = gangInPt[1] - stemPt[1], d = Math.max(1, Math.hypot(dx, dy)), sp = rnd(30, 46); emit(p, stemPt[0] + rnd(-8, 8), stemPt[1] + rnd(-10, 10), dx / d * sp, dy / d * sp); } }
  prod.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(gangInPt[0] - p.x, gangInPt[1] - p.y) < 12 || p.t > 4) kill(p); });
  /* trigeminal firing: ganglion along the nerve to the vessel wall */
  acc.trig += dt * sm.trig * 13; while (acc.trig >= 1) { acc.trig--; const p = free(trigP); if (p) { emit(p, 0, 0, 0, 0); p.tr = trNerve; p.u = 0; p.st = 1; } }
  trigP.forEach((p) => { if (!p.on) return; p.t += dt; if (p.st === 1) { p.u += dt * 88 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) kill(p); } });
  /* CGRP: endings rise to the wall; blocked receptors trap it, open ones let it in */
  acc.cgrp += dt * (0.4 + sm.cgrpSig * 11); while (acc.cgrp >= 1) { acc.cgrp--; const p = free(cgrpP), ex = pick(ends); if (p) emit(p, ex[0] + rnd(-5, 5), ex[1], rnd(-5, 5), -rnd(22, 34), 0); }
  const trapP = (wallParked() / 6) * (m.cgrpRx ? 1 : (m.trip ? 0.85 : 0));
  const wallY = vesselO.y + vesselO.h / 2 - 14;
  cgrpP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 600, 800)) + " " + f1(clamp(p.y, 180, 340)) + ")"); p.e.setAttribute("opacity", "1");
      if (p.y <= wallY || p.t > 3) { if (Math.random() < trapP) { p.st = 1; p.t = 0; } else { p.st = 2; p.t = 0; } } }
    else if (p.st === 1) { p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); }
    else { p.e.setAttribute("opacity", clamp(1 - p.t / 0.4).toFixed(2)); if (p.t > 0.4) kill(p); } });
  /* neurogenic inflammation: leak dots drifting out below the vessel */
  acc.infl += dt * sm.infl * 7; while (acc.infl >= 1) { acc.infl--; const p = free(inflP); if (p) emit(p, rnd(vesselO.x - 70, vesselO.x + 70), vesselO.y + vesselO.h / 2 + 6, rnd(-7, 7), rnd(12, 22), 0); }
  inflP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 600, 810)) + " " + f1(clamp(p.y, 220, 380)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* pain relay: vessel back to the brain */
  acc.pain += dt * sm.pain * 9; while (acc.pain >= 1) { acc.pain--; const p = free(painP); if (p) { emit(p, 0, 0, 0, 0); p.tr = trPain; p.u = 0; p.st = 1; } }
  painP.forEach((p) => { if (!p.on) return; p.t += dt; if (p.st === 1) { p.u += dt * 70 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1); if (p.u >= 1) kill(p); } });
  /* drug blockers park on their receptors and sit there while treatment is on */
  const want = kind === "wall" ? 6 : (kind === "leak" ? 4 : 0);
  let have = 0; blockP.forEach((p) => { if (p.on && p.st !== 2 && p.kind === kind) have++; });
  blockP.forEach((p) => { if (p.on && p.st !== 2 && p.kind !== kind) { p.st = 2; p.t = 0; if (p.ri >= 0) { (p.kind === "wall" ? recep : leaks)[p.ri].by = null; p.ri = -1; } } });
  acc.block += dt * 3; while (acc.block >= 1) { acc.block--; if (kind && have < want) { const p = free(blockP); if (p) { const set = kind === "wall" ? recep : leaks; const freeIdx = set.map((s, i) => (s.by ? -1 : i)).filter((i) => i >= 0); if (freeIdx.length) { const i = pick(freeIdx); set[i].by = p; emit(p, vesselO.x + rnd(-130, 130), vesselO.y + rnd(-110, 110), 0, 0); p.kind = kind; p.ri = i; p.tx = set[i].x; p.ty = set[i].y; p.st = 0; have++; } } } }
  blockP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { const s = Math.min(1, dt * 4); p.x += (p.tx - p.x) * s; p.y += (p.ty - p.y) * s; place(p.e, p.x, p.y, 0, 1); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 6) { p.st = 1; p.t = 0; place(p.e, p.tx, p.ty, 0, 1); } }
    else if (p.st === 1) { place(p.e, p.tx + Math.sin(tm / 600 + p.tx) * 1.2, p.ty + Math.cos(tm / 700 + p.ty) * 1.2, 0, 1); }
    else { p.y += 30 * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) { kill(p); p.kind = ""; p.ri = -1; } } });
  gg.csd.set(sm.csd, wordOf(sm.csd, 0.25, 0.6, ["quiet", "spreading", "active"]));
  gg.trig.set(sm.trig, wordOf(sm.trig, 0.3, 0.75, ["quiet", "active", "firing"]));
  gg.cgrp.set(sm.cgrpSig, wordOf(sm.cgrpSig, 0.3, 0.6, ["low", "raised", "high"]));
  gg.vaso.set(sm.vaso, wordOf(sm.vaso, 0.3, 0.6, ["normal", "wide", "very wide"]));
  gg.infl.set(sm.infl, wordOf(sm.infl, 0.3, 0.6, ["none", "some", "marked"]));
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.28, 0.6, ["none", "mild", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
