/* Carbon monoxide scene: inhaled CO, carboxyhaemoglobin, left shifted curve, tissue and brain effects, misleading pulse oximeter. */
const VY = SC.VY, WW = SC.W;
const layers = { rbcs: $("rbcs"), parts: $("parts"), curve: $("curve"), mito: $("mito"), blockers: $("blockers"), pox: $("pox"), over: $("over"), panel: $("panel") };
let lungO = null, brainO = null, capEl = null, capDrug = -1;
let trach = [128, 62], lungBase = [91, 234], brainBox = [730, 890, 95, 215];
let trDown = null;
const MCX = 688, MCY = 398;
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 130, 160, 150, {});
  brainO = organ($("brainSlot"), "brain", 810, 155, 175, {});
  const LP = lungO.ports, BP = brainO.ports;
  trach = LP.trachea;
  lungBase = LP.base;
  $("airway").setAttribute("d", "M28 62 L" + f1(trach[0]) + " " + f1(trach[1]));
  const mid = [(trach[0] + lungBase[0]) / 2, (trach[1] + lungBase[1]) / 2 + 30];
  trDown = track([[28, 62], trach, mid, lungBase]);
  brainBox = [Math.round(brainO.x - 80), Math.round(brainO.x + 80), Math.round(brainO.y - 60), Math.round(brainO.y + 60)];
  const gl = $("brainGlow");
  gl.setAttribute("cx", f1(brainO.x)); gl.setAttribute("cy", f1(brainO.y));
  const bw = $("brainWord");
  bw.setAttribute("x", f1(brainO.x)); bw.setAttribute("y", f1(brainO.y + 92));
}
function capText(d) {
  if (d === 1) return "High flow oxygen flushes carbon monoxide off haemoglobin. Delivery recovers.";
  if (d === 2) return "Hyperbaric oxygen clears carbon monoxide fastest. Delivery recovers most.";
  if (d === 3) return "Supportive care steadies airway and circulation but clears little carbon monoxide.";
  return "No treatment. Carbon monoxide stays on haemoglobin, so brain and tissues run short.";
}
/* tracks are built in initOrgans from the lung trachea and base ports (see above) */
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, st: 0, spd: 60 }; }); }
const coP = pool(26, () => mk("circle", { class: "sc-p p-co", r: 3 }, layers.parts));
const o2P = pool(24, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
const enP = pool(14, () => mk("circle", { class: "sc-p p-energy", r: 2.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.st = 0; p.k = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- tissue mitochondrion ---- */
const mitoG = mk("g", {}, layers.mito);
mk("ellipse", { class: "cop-mito", rx: 30, ry: 15 }, mitoG);
mk("path", { class: "cop-fold", d: "M-18 0Q-9 -8 0 0Q9 8 18 0" }, mitoG);
mk("path", { class: "cop-fold", d: "M-14 5Q-6 -2 2 5Q10 11 16 4" }, mitoG);
place(mitoG, MCX, MCY, -12, 1);
/* carbon monoxide blockers seated on the mitochondrion; oxygen knocks them off */
const blockers = [[-14, -4], [0, 6], [14, -4]].map(([dx, dy]) => ({ e: mk("circle", { class: "sc-p p-co", r: 3.4 }, layers.blockers), dx, dy, s: 1 }));
/* pulse oximeter device */
const poxG = mk("g", {}, layers.pox);
mk("rect", { class: "cop-poxbg", x: -42, y: -22, width: 84, height: 44, rx: 8 }, poxG);
const poxT = mk("text", { class: "cop-poxt", x: 0, y: -3, "text-anchor": "middle" }, poxG); poxT.textContent = "Pulse ox";
const poxS = mk("text", { class: "cop-poxs", x: 0, y: 12, "text-anchor": "middle" }, poxG); poxS.textContent = "looks normal";
place(poxG, 864, 392, 0, 1);
/* ---- red cells with CO and O2 dots ---- */
const rbcs = [];
function initRbc() {
  for (let i = 0; i < 18; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs);
    mk("ellipse", { class: "cl-b", rx: 10, ry: 6 }, g);
    mk("ellipse", { class: "cl-s", rx: 3.6, ry: 1.8 }, g);
    const co = mk("g", {}, g);
    mk("circle", { class: "p-co sc-p", r: 2.2, cx: -3, cy: -1 }, co);
    mk("circle", { class: "p-co sc-p", r: 2.2, cx: 3, cy: 1 }, co);
    const o2 = mk("g", {}, g);
    mk("circle", { class: "p-o2 sc-p", r: 1.8, cx: 0, cy: -2 }, o2);
    rbcs.push({ g, co, o2, x: rnd(0, WW), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) });
  }
}
/* ---- chamber pressure ticks (hyperbaric visual) ---- */
function initChamber() {
  const g = $("chamTicks");
  for (let x = 110; x <= 860; x += 94) {
    mk("path", { class: "cop-tick", d: "M" + f1(x) + " 56 L" + f1(x) + " 70" }, g);
    mk("path", { class: "cop-tick", d: "M" + f1(x) + " 416 L" + f1(x) + " 430" }, g);
  }
  for (let y = 120; y <= 370; y += 62) {
    mk("path", { class: "cop-tick", d: "M22 " + f1(y) + " L36 " + f1(y) }, g);
    mk("path", { class: "cop-tick", d: "M924 " + f1(y) + " L938 " + f1(y) }, g);
  }
}
/* ---- haze lingering in the brain when delivery is poor ---- */
const hazeDots = [];
function initHaze() {
  for (let i = 0; i < 10; i++) {
    const e = mk("circle", { class: "sc-p p-co", r: 2.4 }, layers.parts);
    hazeDots.push({ e, x: rnd(brainBox[0], brainBox[1]), y: rnd(brainBox[2], brainBox[3]), a: rnd(0, 6.28) });
  }
}
/* ---- curve paths ---- */
const normPath = mk("path", { class: "cop-norm" }, layers.curve);
const shiftPath = mk("path", { class: "cop-shift" }, layers.curve);
function curveD(shift) {
  let d = "";
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, px = 362 + u * 250, sat = 1 / (1 + Math.exp(-(u - 0.42 + shift * 0.22) * 9));
    const py = 202 - sat * 104;
    d += (i === 0 ? "M" : "L") + f1(px) + " " + f1(py);
  }
  return d;
}
normPath.setAttribute("d", curveD(0));
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cohb", "COHb", "g-cohb", "Carboxyhaemoglobin: haemoglobin occupied by carbon monoxide instead of oxygen. It rises with exposure and falls as oxygen clears it."],
    ["shift", "Curve shift", "g-shift", "Left shift of the oxygen haemoglobin curve: carried oxygen is held more tightly and released less readily to tissues."],
    ["del", "Delivery", "g-del", "Oxygen delivered and released to tissues. It falls even though the pulse oximeter can look normal."],
    ["energy", "Cell energy", "g-energy", "Mitochondrial energy production. Carbon monoxide inhibits cytochrome oxidase, so energy falls."],
    ["brain", "Brain", "g-brain", "Brain function, from headache and dizziness to confusion and coma. Delayed neurological sequelae can follow recovery."],
    ["pox", "Pulse ox", "g-pox", "Pulse oximeter reading. It cannot separate carboxyhaemoglobin from oxyhaemoglobin, so it often looks normal: a trap."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Lung", 190, 130, 250, 92, "Lung: carbon monoxide breathed in from smoke and faulty heaters crosses into the blood here.");
  pill(ox, "Curve", 500, 140, 490, 244, "Oxygen haemoglobin curve: carbon monoxide shifts it left, so carried oxygen is held tight and released poorly.");
  pill(ox, "Blood", 300, 294, 300, 362, "Blood: carbon monoxide locks onto haemoglobin in red cells. Less oxygen is carried and released.");
  pill(ox, "Brain", 838, 100, 838, 74, "Brain: very sensitive to low oxygen delivery. Headache and confusion can deepen toward coma.");
  pill(ox, "Tissue cell", 615, 412, 508, 398, "Tissue cell: short of usable oxygen. Brain and heart suffer first.");
  pill(ox, "Mitochondrion", 700, 392, 740, 344, "Mitochondrion: carbon monoxide blocks cytochrome oxidase, so energy output falls.");
  pill(ox, "Pulse oximeter", 830, 405, 800, 430, "Pulse oximeter trap: it reads carboxyhaemoglobin as normal oxygen, so the reading looks fine while tissues starve.");
  capEl = mk("text", { class: "cop-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { COHb: 0.5, Shift: 0.4, Delivery: 0.5, Energy: 0.5, Brain: 0.4, Pox: 0.9, mask: 0, cham: 0, sup: 0 };
const acc = { co: 0, o2: 0, en: 0 };
function init() { initOrgans(); initChamber(); initRbc(); initHaze(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.COHb = lerp(sm.COHb, m.COHb, k); sm.Shift = lerp(sm.Shift, m.Shift, k); sm.Delivery = lerp(sm.Delivery, m.Delivery, k);
  sm.Energy = lerp(sm.Energy, m.Energy, k); sm.Brain = lerp(sm.Brain, m.Brain, k); sm.Pox = lerp(sm.Pox, m.Pox, k);
  sm.mask = lerp(sm.mask, drug === 1 ? 1 : 0, k); sm.cham = lerp(sm.cham, drug === 2 ? 1 : 0, k); sm.sup = lerp(sm.sup, drug === 3 ? 1 : 0, k);
  /* treatment visuals: mask over the lung, chamber border, support arcs and badge */
  $("maskG").setAttribute("opacity", sm.mask.toFixed(2));
  $("chamber").setAttribute("opacity", (sm.cham * (0.72 + 0.28 * Math.sin(tm / 400))).toFixed(2));
  $("chamTicks").setAttribute("opacity", sm.cham.toFixed(2));
  $("supG").setAttribute("opacity", sm.sup.toFixed(2));
  $("supDot").setAttribute("r", f1(3.5 + 1.5 * Math.sin(tm / 300)));
  /* red cells flow; CO dots grow, O2 dots shrink */
  const flow = clamp(0.35 + 0.65 * sm.Delivery + (drug === 3 ? 0.1 : 0));
  rbcs.forEach((r, i) => {
    r.x += r.v * 62 * flow * dt; if (r.x > WW + 14) { r.x = -14; r.y = rnd(-0.75, 0.75); }
    place(r.g, r.x, VY + r.y * 22, r.rot + Math.sin(tm / 500 + i) * 8, 1);
    r.co.setAttribute("opacity", sm.COHb.toFixed(2)); r.o2.setAttribute("opacity", clamp(1 - sm.COHb * 1.2).toFixed(2));
  });
  /* CO particles: airway to lung to vessel, thinned by oxygen treatments */
  acc.co += dt * (2 + sm.COHb * 9) * (drug === 2 ? 0.45 : drug === 1 ? 0.7 : 1);
  while (acc.co >= 1) { acc.co--; const p = free(coP); if (p) { emit(p, 0, 0, 0, 0); p.spd = 60; } }
  coP.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.st === 0) {
      p.u += dt * p.spd / trDown.len; const q = trDown.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
      place(p.e, p.x, p.y, 0, 1);
      if (p.u >= 1) { p.st = 1; p.k = rnd(180, 860); }
    } else {
      p.x += ((p.k - p.x) * 0.9 + 26) * dt; p.y += (VY - p.y) * dt * 1.8;
      place(p.e, p.x, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - (p.t - 3.2) / 1.2).toFixed(2));
      if (p.t > 4.4 || p.x > WW - 20) kill(p);
    }
  });
  /* O2 particles: a flood with mask or chamber, crowded out by CO */
  const o2rate = (drug === 1 ? 13 : drug === 2 ? 16 : drug === 3 ? 6 : 5) * (1 - 0.55 * sm.COHb);
  acc.o2 += dt * o2rate;
  while (acc.o2 >= 1) { acc.o2--; const p = free(o2P); if (p) { emit(p, 0, 0, 0, 0); p.spd = 95; } }
  o2P.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.st === 0) {
      p.u += dt * p.spd / trDown.len; const q = trDown.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y;
      place(p.e, p.x, p.y, 0, 1);
      if (p.u >= 1) { p.st = 1; p.k = rnd(180, 860); }
    } else {
      p.x += ((p.k - p.x) * 0.9 + 30) * dt; p.y += (VY - p.y) * dt * 1.6;
      place(p.e, p.x, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2));
      if (p.t > 4.6 || p.x > WW - 20) kill(p);
    }
  });
  /* brain haze drifts and clears with treatment */
  hazeDots.forEach((h, i) => {
    h.a += rnd(-1, 1) * dt * 2;
    h.x += Math.cos(h.a) * 12 * dt; h.y += Math.sin(h.a) * 12 * dt;
    h.x = clamp(h.x, brainBox[0], brainBox[1]); h.y = clamp(h.y, brainBox[2], brainBox[3]);
    place(h.e, h.x, h.y, 0, 1);
    h.e.setAttribute("opacity", (sm.Brain * (0.55 + 0.45 * Math.sin(tm / 500 + i * 1.7))).toFixed(2));
  });
  /* curve, brain, mito, pox */
  shiftPath.setAttribute("d", curveD(sm.Shift));
  const bw = sm.Brain < 0.3 ? "alert" : sm.Brain < 0.5 ? "headache" : sm.Brain < 0.72 ? "confused" : "coma risk";
  const bwEl = $("brainWord"); if (bwEl && bwEl.textContent !== bw) bwEl.textContent = bw;
  $("brainGlow").setAttribute("opacity", (sm.Brain * 0.5).toFixed(2));
  brainO.g.style.opacity = (1 - 0.25 * sm.Brain).toFixed(2);
  place(mitoG, MCX, MCY, -12 + Math.sin(tm / 700) * 3, 0.85 + 0.15 * sm.Energy);
  mitoG.style.opacity = (0.45 + 0.55 * sm.Energy).toFixed(2);
  blockers.forEach((b, i) => {
    const target = sm.COHb > [0.15, 0.35, 0.55][i] ? 1 : 0;
    b.s = lerp(b.s, target, Math.min(1, dt * 1.2));
    place(b.e, MCX + b.dx + Math.sin(tm / 600 + i * 2) * 1.5 * b.s, MCY + b.dy + (1 - b.s) * 30, 0, 1);
    b.e.setAttribute("opacity", b.s.toFixed(2));
  });
  acc.en += dt * sm.Energy * 7;
  while (acc.en >= 1) { acc.en--; const p = free(enP); if (p) emit(p, MCX + rnd(-16, 16), MCY + rnd(-7, 7), rnd(-8, 8), rnd(-22, -12)); }
  enP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  poxS.textContent = "looks normal";
  gg.cohb.set(sm.COHb, wordOf(sm.COHb, 0.25, 0.55, ["low", "raised", "high"]));
  gg.shift.set(sm.Shift, wordOf(sm.Shift, 0.25, 0.55, ["none", "some", "marked"]));
  gg.del.set(sm.Delivery, wordOf(sm.Delivery, 0.35, 0.65, ["low", "reduced", "preserved"]));
  gg.energy.set(sm.Energy, wordOf(sm.Energy, 0.35, 0.65, ["low", "reduced", "preserved"]));
  gg.brain.set(1 - sm.Brain, wordOf(1 - sm.Brain, 0.35, 0.65, ["poor", "impaired", "alert"]));
  gg.pox.set(sm.Pox, "normal");
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
