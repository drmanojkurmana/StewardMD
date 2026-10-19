/* Chronic kidney disease scene: failing filters, retained wastes, gland driven bone loss,
 * marrow without its signal. Every treatment visibly acts on the drawing. */
const layers = { parts: $("parts"), neph: $("neph"), over: $("over"), panel: $("panel") };
const E = {};
["artV", "veinV", "ureter", "gutBlood", "epoPath", "pthPath", "vessel", "bpWash", "dialWash", "bpStrain", "ringA", "ringB", "glands", "boneShaft", "trabs", "marrowWash", "gutWash", "mach", "jugFill", "machLight"].forEach((id) => { E[id] = $(id); });
const WW = SC.W;
let kidO = null, gutO = null, capEl = null, capDrug = -1;
const neph = [];
let pelvis = [115, 227];
const MARROW = [775, 329];
let trEpo = null, trPTH = null, trGut = null, trDial = null;
function nearest(ports, hint) {
  let best = null, bd = 1e9;
  for (const k in ports) { const p = ports[k]; const d = Math.hypot(p[0] - hint[0], p[1] - hint[1]); if (d < bd) { bd = d; best = p; } }
  return best ? [best[0], best[1]] : hint.slice();
}
function initOrgans() {
  kidO = organ($("kidSlot"), "kidney", 140, 245, 175, {});
  gutO = organ($("gutSlot"), "bowel", 430, 355, 140, {});
  const KP = kidO.ports;
  const artP = nearest(KP, [235, 158]), veinP = nearest(KP, [245, 178]);
  E.artV.setAttribute("d", "M290 156 C258 156 210 185 " + f1(artP[0]) + " " + f1(artP[1]));
  E.veinV.setAttribute("d", "M290 174 C258 178 212 205 " + f1(veinP[0]) + " " + f1(veinP[1]));
  pelvis = KP.pelvis ? [KP.pelvis[0], KP.pelvis[1]] : nearest(KP, [115, 227]);
  E.ureter.setAttribute("d", "M" + f1(pelvis[0]) + " " + f1(pelvis[1]) + " C125 285 132 350 140 425");
  const coils = gutO.ports.coils || [433, 358];
  E.gutBlood.setAttribute("d", "M" + f1(coils[0]) + " " + f1(coils[1] - 18) + " L" + f1(coils[0]) + " 178");
  trGut = track([[coils[0], coils[1] - 18], [coils[0], 178]]);
  const hil = nearest(KP, [120, 320]);
  const epoPts = [hil, [260, 292], [380, 262], [520, 257], [620, 258], [690, 285], [738, 322]];
  E.epoPath.setAttribute("d", "M" + epoPts.map((p) => f1(p[0]) + " " + f1(p[1])).join(" L"));
  trEpo = track(epoPts);
  E.pthPath.setAttribute("d", "M621 293 C650 300 685 312 712 326");
  trPTH = track([[621, 293], [665, 308], [712, 326]]);
  trDial = track([[884, 166], [880, 185], [886, 200]]);
  const left = kidO.x - kidO.w / 2, top = kidO.y - kidO.h / 2;
  [0.45, 0.60, 0.75].forEach((fx, ci) => [0.22, 0.38, 0.54, 0.70].forEach((fy, ri) => {
    const x = left + fx * kidO.w, y = top + fy * kidO.h;
    const g = mk("g", {}, layers.neph);
    cell(g, { cls: "neph", r: 7.5, nuc: 0.4, seed: ci * 4 + ri + 1, wob: 0.1 });
    const scar = mk("g", { opacity: "0" }, g);
    mk("path", { class: "ck-scarx", d: "M-6 -6L6 6M6 -6L-6 6" }, scar);
    neph.push({ g, scar, x, y });
  }));
}
function capText(d) {
  if (d === 1) return "Pressure control relaxes the vessels. The remaining filters last longer.";
  if (d === 2) return "Binder traps phosphate in the gut and vitamin D calms the glands. Bone holds firm.";
  if (d === 3) return "Erythropoietin drives the marrow. Red cells rise and tired blood recovers.";
  if (d === 4) return "Dialysis filters the blood for the kidney. Wastes and extra fluid drain away.";
  return "No treatment. Wastes build up, pressure climbs and bone thins.";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, sx: 0, sy: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0, st: 0, life: 0, lane: 0 }; }); }
const filt = pool(30, () => mk("circle", { class: "p-filt", r: 2 }, layers.parts));
const epoP = pool(12, () => mk("circle", { class: "sc-p p-epo", r: 3 }, layers.parts));
const pthP = pool(10, () => mk("path", { class: "sc-p p-pth", d: "M0 -3L3 0L0 3L-3 0Z" }, layers.parts));
const gutP = pool(10, () => mk("circle", { class: "sc-p p-phos", r: 2.8 }, layers.parts));
const bindP = pool(8, () => mk("path", { class: "sc-p p-bind", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const marP = pool(14, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 6, ry: 3.6 }, g); mk("ellipse", { class: "cl-s", rx: 2.2, ry: 1.1 }, g); return g; });
const dialP = pool(10, () => mk("circle", { class: "sc-p p-urea", r: 2.6 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.st = 0; p.life = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* blood lane particles: each rides the vessel from left to right on its own lane */
function lanePool(n, build, laneBase) { const pl = pool(n, build); pl.forEach((p, i) => { p.x = rnd(300, 900); p.lane = laneBase + (i % 3) * 4; p.vx = rnd(26, 44); }); return pl; }
const rbcB = lanePool(14, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); return g; }, -13);
const ureaP = lanePool(18, () => mk("circle", { class: "sc-p p-urea", r: 2.6 }, layers.parts), -7);
const potP = lanePool(10, () => mk("rect", { class: "sc-p p-pot", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts), -1);
const acidP = lanePool(10, () => mk("circle", { class: "sc-p p-acid", r: 2 }, layers.parts), 5);
const phosP = lanePool(12, () => mk("circle", { class: "sc-p p-phos", r: 2.8 }, layers.parts), 10);
function rideLane(pl, dt, frac, cy, spd) {
  const want = Math.round(clamp(frac) * pl.length);
  pl.forEach((p, i) => {
    if (i >= want) { if (p.e.getAttribute("opacity") !== "0") p.e.setAttribute("opacity", "0"); return; }
    p.e.setAttribute("opacity", "1"); p.x += p.vx * spd * dt; if (p.x > 904) p.x = 296;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(cy + p.lane) + ")");
  });
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, w = 18;
  const xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["gfr", "Filtration", "g-good", "How much blood the filters clear. Lost filters drag it down, while survivors work harder for a while."],
    ["urea", "Urea", "g-urea", "A waste the kidney clears. It builds up in blood as filters fail. Dialysis clears it."],
    ["phos", "Phosphate", "g-phos", "Cleared by the kidney and absorbed from food. Binder traps it in the gut. Dialysis clears it."],
    ["hb", "Haemoglobin", "g-bad", "Red cell pigment. Falls when the kidney makes less erythropoietin. Treatment replaces the missing signal."],
    ["bp", "Pressure", "g-fl", "Blood pressure. Salt and water build up raises it. Control eases the strain on vessels and filters."],
    ["pth", "Parathyroid", "g-pth", "Gland signal. Retained phosphate drives it up and it thins bone. Binder and vitamin D calm it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, w, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 60, 245, 120, 80, "Kidney. Its filters are lost one by one and do not grow back. Survivors swell and work harder.");
  pill(ox, "Blood", 350, 124, 330, 80, "Blood. Pressure runs high as salt and water build up. Control eases the strain on the vessels.");
  pill(ox, "Wastes", 560, 138, 540, 80, "Wastes kept in blood: urea, potassium, acid and phosphate. Dialysis clears them.");
  pill(ox, "Bone", 826, 322, 790, 80, "Bone. Too much gland signal draws mineral out, so bone thins and weakens.");
  pill(ox, "Urine", 140, 415, 140, 392, "Urine leaving through the tube. Less is filtered as the disease advances.");
  pill(ox, "Gut", 365, 375, 300, 392, "Gut. Phosphate from food enters blood here. Binder traps it so it leaves in stool.");
  pill(ox, "Parathyroid", 621, 290, 610, 392, "Parathyroid glands. Retained phosphate drives them to release more signal.");
  pill(ox, "Marrow", 775, 335, 720, 392, "Marrow. It needs the kidney signal to make red cells. Without it, anaemia follows.");
  capEl = mk("text", { class: "ck-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { s: 0.72, N: 0.41, Hf: 0.76, GFR: 0.48, U: 0.54, K: 0.52, Ac: 0.52, Ph: 0.54, PTH: 0.56, BP: 0.72, Hb: 0.5, bpRx: 0, binder: 0, epoRx: 0, dial: 0 };
const KEYS = Object.keys(sm);
const acc = { filt: 0, epo: 0, pth: 0, gut: 0, bind: 0, mar: 0, dial: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  /* vessel swells with pressure and calms with control */
  const vh = 34 + 30 * sm.BP, vtop = 145 - vh / 2;
  [E.vessel, E.bpWash, E.bpStrain].forEach((el) => { el.setAttribute("y", f1(vtop)); el.setAttribute("height", f1(vh)); });
  E.dialWash.setAttribute("y", f1(vtop)); E.dialWash.setAttribute("height", f1(vh));
  E.bpStrain.setAttribute("opacity", clamp((sm.BP - 0.45) * 2.2, 0, 0.75).toFixed(2));
  E.bpWash.setAttribute("opacity", (0.05 + 0.42 * sm.bpRx).toFixed(2));
  E.dialWash.setAttribute("opacity", (0.05 + 0.4 * sm.dial).toFixed(2));
  const vbottom = 145 + vh / 2;
  /* relax rings travel the vessel while pressure control acts */
  [[E.ringA, 0], [E.ringB, 295]].forEach(([el, off]) => {
    const x = 300 + ((tm / 1000 * 70 + off) % 590);
    el.setAttribute("cx", f1(x)); el.setAttribute("cy", "145");
    el.setAttribute("rx", "12"); el.setAttribute("ry", f1(vh / 2 - 2));
    el.setAttribute("opacity", (0.55 * sm.bpRx).toFixed(2));
  });
  /* nephrons: survivors enlarge and work harder, lost units fade and scar */
  const active = Math.round(sm.N * neph.length);
  neph.forEach((u, i) => { const on = i < active; const sc = on ? 1 + 0.35 * sm.Hf : 0.85; place(u.g, u.x, u.y, 0, sc); u.g.style.opacity = on ? "1" : "0.3"; u.scar.setAttribute("opacity", on ? "0" : "1"); });
  /* filtrate from surviving nephrons gathers at the pelvis and leaves down the ureter */
  acc.filt += dt * sm.GFR * 9; while (acc.filt >= 1) { acc.filt--; const p = free(filt), src = neph[Math.floor(Math.random() * Math.max(1, active))]; if (p && src) { emit(p, src.x, src.y, 0, 0); p.sx = src.x; p.sy = src.y; } }
  filt.forEach((p) => {
    if (!p.on) return;
    if (p.st === 0) { p.t += dt; const f = Math.min(1, p.t / 0.6); p.x = lerp(p.sx, pelvis[0], f); p.y = lerp(p.sy, pelvis[1], f); if (f >= 1) p.st = 1; }
    else { p.y += (30 + 40 * sm.GFR) * dt; p.x += (140 - p.x) * dt * 1.2; p.e.setAttribute("opacity", clamp(1 - (p.y - 390) / 30).toFixed(2)); if (p.y > 420) { kill(p); return; } }
    place(p.e, p.x, p.y, 0, 1);
  });
  /* retained solutes ride the blood; counts follow the model, speed follows pressure */
  const spd = 0.55 + 0.7 * clamp(sm.BP);
  rideLane(rbcB, dt, 0.3 + 0.65 * sm.Hb, 145, spd);
  rideLane(ureaP, dt, sm.U, 145, spd); rideLane(potP, dt, sm.K, 145, spd); rideLane(acidP, dt, sm.Ac, 145, spd); rideLane(phosP, dt, sm.Ph, 145, spd);
  /* erythropoietin from kidney to marrow; treatment turns a trickle into a stream */
  const epoRate = sm.epoRx > 0.5 ? 4.2 : 0.4 + 2 * sm.N;
  acc.epo += dt * epoRate; while (acc.epo >= 1) { acc.epo--; const p = free(epoP); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  epoP.forEach((p) => {
    if (!p.on) return; p.u += dt * 90 / trEpo.len; if (p.u >= 1) { kill(p); return; }
    const q = trEpo.at(p.u); place(p.e, q.x, q.y, 0, 1 + 0.5 * sm.epoRx);
  });
  /* gland signal travels to bone; glands swell as output rises */
  E.glands.setAttribute("transform", "translate(621 296) scale(" + (0.7 + 0.9 * sm.PTH).toFixed(3) + ") translate(-621 -296)");
  acc.pth += dt * sm.PTH * 4; while (acc.pth >= 1) { acc.pth--; const p = free(pthP); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  pthP.forEach((p) => {
    if (!p.on) return; p.u += dt * 70 / trPTH.len; if (p.u >= 1) { kill(p); return; }
    const q = trPTH.at(p.u); place(p.e, q.x, q.y, tm / 6, 1);
  });
  /* bone thins as gland signal stays high; binder wash guards it */
  E.boneShaft.setAttribute("height", f1(20 - 8 * sm.PTH)); E.boneShaft.setAttribute("y", f1(319 + 4 * sm.PTH));
  E.trabs.style.opacity = (0.85 - 0.5 * sm.PTH).toFixed(2);
  /* phosphate rises from gut to blood unless binder traps it in stool */
  const coilsY = trGut.at(0);
  acc.gut += dt * (0.6 + 3.2 * sm.Ph); while (acc.gut >= 1) { acc.gut--; const p = free(gutP); if (p) { emit(p, coilsY.x + rnd(-30, 30), coilsY.y + rnd(-8, 8), rnd(-6, 6), 0); p.u = 0;
    p.e.setAttribute("class", "sc-p p-phos");
    if (sm.binder > 0.5 && Math.random() < 0.7) { p.st = 1; p.e.setAttribute("class", "sc-p p-bound"); } } }
  gutP.forEach((p) => {
    if (!p.on) return;
    if (p.st === 1) { p.x += p.vx * dt; p.y += 26 * dt; p.e.setAttribute("opacity", clamp(1 - (p.y - 408) / 16).toFixed(2)); place(p.e, p.x, p.y, 0, 1); if (p.y > 424) kill(p); return; }
    p.u += dt * 55 / trGut.len; if (p.u >= 1) { kill(p); return; }
    const q = trGut.at(p.u); place(p.e, q.x, q.y, 0, 1);
  });
  /* binder diamonds fall into the gut and sit on the phosphate */
  acc.bind += dt * sm.binder * 2.5; while (acc.bind >= 1) { acc.bind--; const p = free(bindP); if (p) { emit(p, coilsY.x + rnd(-45, 45), 292, 0, 0); p.life = rnd(2.5, 4); } }
  bindP.forEach((p) => {
    if (!p.on) return;
    if (p.st === 0) { p.y += 40 * dt; if (p.y >= coilsY.y - 10) { p.st = 1; p.t = 0; } }
    else { p.t += dt; p.e.setAttribute("opacity", clamp(1 - (p.t - p.life + 1)).toFixed(2)); if (p.t > p.life) { kill(p); return; } }
    place(p.e, p.x, p.y, tm / 8, 1);
  });
  E.gutWash.setAttribute("opacity", (0.06 + 0.5 * sm.binder).toFixed(2));
  /* marrow turns signal into red cells that rise into the blood */
  acc.mar += dt * sm.Hb * 4; while (acc.mar >= 1) { acc.mar--; const p = free(marP); if (p) emit(p, MARROW[0] + rnd(-24, 24), MARROW[1], rnd(-6, 6), -rnd(55, 85)); }
  marP.forEach((p) => {
    if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.y <= vbottom + 4) { kill(p); return; }
    place(p.e, p.x, p.y, 0, 1);
  });
  E.marrowWash.setAttribute("opacity", (0.06 + 0.5 * sm.epoRx).toFixed(2));
  /* dialysis: machine wakes, wastes ride the tube and never return, the jug fills */
  E.mach.setAttribute("opacity", (0.15 + 0.85 * sm.dial).toFixed(2));
  E.machLight.setAttribute("opacity", sm.dial.toFixed(2));
  const jh = 1 + 11 * sm.dial;
  E.jugFill.setAttribute("height", f1(jh)); E.jugFill.setAttribute("y", f1(279 - jh));
  acc.dial += dt * sm.dial * 4.5; while (acc.dial >= 1) { acc.dial--; const p = free(dialP); if (p) { emit(p, 0, 0, 0, 0); p.u = 0; } }
  dialP.forEach((p) => {
    if (!p.on) return; p.u += dt * 80 / trDial.len; if (p.u >= 1) { kill(p); return; }
    const q = trDial.at(p.u); place(p.e, q.x, q.y, 0, 1);
  });
  /* gauges */
  gg.gfr.set(sm.GFR, wordOf(sm.GFR, 0.35, 0.75, ["very low", "reduced", "near normal"]));
  gg.urea.set(sm.U, wordOf(sm.U, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.phos.set(sm.Ph, wordOf(sm.Ph, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.hb.set(sm.Hb, wordOf(sm.Hb, 0.45, 0.75, ["low", "reduced", "normal"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.6, ["controlled", "raised", "high"]));
  gg.pth.set(sm.PTH, wordOf(sm.PTH, 0.3, 0.6, ["normal", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
