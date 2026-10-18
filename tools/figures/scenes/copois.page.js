/* Carbon monoxide scene: inhaled CO, carboxyhaemoglobin, left shifted curve, tissue and brain effects, misleading pulse oximeter. */
const VY = SC.VY, WW = SC.W;
const layers = { rbcs: $("rbcs"), parts: $("parts"), curve: $("curve"), brain: $("brain"), mito: $("mito"), pox: $("pox"), over: $("over"), panel: $("panel") };
/* ---- brain blob ---- */
const brainG = cell(layers.brain, { cls: "mac", r: 44, seed: 7, wob: 0.16, n: 11 });
brainG.querySelector(".cl-b").setAttribute("class", "cl-b cop-brain");
place(brainG, 812, 152, 0, 1);
/* tissue mitochondrion */
const mitoG = mk("g", {}, layers.mito);
mk("ellipse", { class: "cop-mito", rx: 30, ry: 15 }, mitoG);
mk("path", { class: "cop-fold", d: "M-18 0Q-9 -8 0 0Q9 8 18 0" }, mitoG);
mk("path", { class: "cop-fold", d: "M-14 5Q-6 -2 2 5Q10 11 16 4" }, mitoG);
place(mitoG, 688, 398, -12, 1);
const pressArcs = [62, 75, 88].map((r) => { const a = mk("circle", { cx: 118, cy: 158, r: r }, layers.parts); a.setAttribute("fill", "none"); a.setAttribute("stroke", "var(--c-lymph)"); a.setAttribute("stroke-width", "1.2"); a.setAttribute("opacity", "0"); return a; });
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
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const coP = pool(26, () => mk("circle", { class: "sc-p p-co", r: 3 }, layers.parts));
const o2P = pool(22, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
const enP = pool(14, () => mk("circle", { class: "sc-p p-energy", r: 2.2 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
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
  pill(ox, "Carbon monoxide", 92, 122, 118, 92, "Carbon monoxide: a colourless gas breathed in from smoke and faulty heaters. It crosses the lung into the blood.");
  pill(ox, "Shifted curve", 520, 118, 480, 238, "The oxygen haemoglobin curve shifted left by carboxyhaemoglobin: oxygen is carried less and released less readily.");
  pill(ox, "Brain", 812, 112, 812, 84, "The brain is very sensitive to poor oxygen delivery: headache, dizziness and confusion, then collapse and coma.");
  pill(ox, "Haemoglobin", 210, 300, 200, 372, "Haemoglobin inside red cells normally carries oxygen on four sites. Carbon monoxide occupies those sites far more strongly than oxygen.");
  pill(ox, "Carboxyhaemoglobin", 470, 300, 432, 372, "Carboxyhaemoglobin: haemoglobin bound to carbon monoxide. It cannot carry oxygen and it shifts the curve left.");
  pill(ox, "Mitochondrion", 688, 382, 612, 344, "Mitochondrion: carbon monoxide inhibits cytochrome oxidase in the respiratory chain, so cell energy falls even if some oxygen arrives.");
  pill(ox, "Pulse oximeter", 864, 368, 864, 344, "Pulse oximeter on a finger: it reads carboxyhaemoglobin as if it were oxyhaemoglobin, so the reading looks normal while tissues are starved.");
  pill(ox, "Tissue cell", 620, 415, 540, 428, "Tissue cell short of usable oxygen and cell energy. Organs with high demand, brain and heart, suffer first.");
}
const sm = { COHb: 0.5, Shift: 0.4, Delivery: 0.5, Energy: 0.5, Brain: 0.4, Pox: 0.9, press: 0 };
const acc = { co: 0, o2: 0, en: 0 };
function init() { initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.COHb = lerp(sm.COHb, m.COHb, k); sm.Shift = lerp(sm.Shift, m.Shift, k); sm.Delivery = lerp(sm.Delivery, m.Delivery, k);
  sm.Energy = lerp(sm.Energy, m.Energy, k); sm.Brain = lerp(sm.Brain, m.Brain, k); sm.Pox = lerp(sm.Pox, m.Pox, k); sm.press = lerp(sm.press, m.press, k);
  /* red cells flow; CO dots grow, O2 dots shrink */
  const flow = clamp(0.35 + 0.65 * sm.Delivery);
  rbcs.forEach((r, i) => {
    r.x += r.v * 62 * flow * dt; if (r.x > WW + 14) { r.x = -14; r.y = rnd(-0.75, 0.75); }
    place(r.g, r.x, VY + r.y * 22, r.rot + Math.sin(tm / 500 + i) * 8, 1);
    r.co.setAttribute("opacity", sm.COHb.toFixed(2)); r.o2.setAttribute("opacity", clamp(1 - sm.COHb * 1.2).toFixed(2));
  });
  /* CO particles: airway to alveolus to vessel */
  acc.co += dt * (2 + sm.COHb * 9) * (m.drug === 2 ? 0.45 : 1);
  while (acc.co >= 1) { acc.co--; const p = free(coP); if (p) emit(p, 26, 96, 0, 0, 0); }
  coP.forEach((p) => {
    if (!p.on) return; p.t += dt;
    const tx = p.t < 1.2 ? 92 : p.t < 2.2 ? 118 : 260 + (p.k || 0), ty = p.t < 1.2 ? 122 : p.t < 2.2 ? 158 : VY;
    if (p.t >= 2.2 && !p.k) { p.k = rnd(180, 860); }
    p.x += ((p.t < 2.2 ? tx : p.k) - p.x) * dt * 1.6 + 18 * dt; p.y += (ty - p.y) * dt * 1.8;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 4.2 || p.x > WW - 20) kill(p);
  });
  /* O2 particles: more with treatment, crowded out by CO */
  const o2rate = (m.drug === 1 ? 11 : m.drug === 2 ? 15 : 5) * (1 - 0.55 * sm.COHb);
  acc.o2 += dt * o2rate;
  while (acc.o2 >= 1) { acc.o2--; const p = free(o2P); if (p) emit(p, 26, 108, 0, 0, 0); }
  o2P.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (!p.k) p.k = rnd(180, 860);
    const ty = p.t < 1.6 ? 150 : VY;
    p.x += (p.k - p.x) * dt * 0.9 + 22 * dt; p.y += (ty - p.y) * dt * 1.4;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.t > 4) kill(p);
  });
  /* curve, brain, mito, pox */
  shiftPath.setAttribute("d", curveD(sm.Shift));
  const bw = sm.Brain < 0.3 ? "alert" : sm.Brain < 0.5 ? "headache" : sm.Brain < 0.72 ? "confused" : "coma risk";
  const bwEl = $("brainWord"); if (bwEl && bwEl.textContent !== bw) bwEl.textContent = bw;
  place(brainG, 812, 152 + Math.sin(tm / 900) * 2, Math.sin(tm / 1400) * 3, 1 - 0.12 * sm.Brain);
  brainG.style.opacity = (1 - 0.25 * sm.Brain).toFixed(2);
  place(mitoG, 688, 398, -12 + Math.sin(tm / 700) * 3, 0.85 + 0.15 * sm.Energy);
  mitoG.style.opacity = (0.45 + 0.55 * sm.Energy).toFixed(2);
  acc.en += dt * sm.Energy * 7;
  while (acc.en >= 1) { acc.en--; const p = free(enP); if (p) emit(p, 688 + rnd(-16, 16), 398 + rnd(-7, 7), rnd(-8, 8), rnd(-22, -12), 0); }
  enP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2)); if (p.t > 1.1) kill(p); });
  poxS.textContent = "looks normal";
  pressArcs.forEach((a, i) => { a.setAttribute("r", f1(62 + i * 13 + Math.sin(tm / 400 + i) * 2)); a.setAttribute("opacity", (sm.press * 0.55).toFixed(2)); });
  gg.cohb.set(sm.COHb, wordOf(sm.COHb, 0.25, 0.55, ["low", "raised", "high"]));
  gg.shift.set(sm.Shift, wordOf(sm.Shift, 0.25, 0.55, ["none", "some", "marked"]));
  gg.del.set(sm.Delivery, wordOf(sm.Delivery, 0.35, 0.65, ["low", "reduced", "preserved"]));
  gg.energy.set(sm.Energy, wordOf(sm.Energy, 0.35, 0.65, ["low", "reduced", "preserved"]));
  gg.brain.set(1 - sm.Brain, wordOf(1 - sm.Brain, 0.35, 0.65, ["poor", "impaired", "alert"]));
  gg.pox.set(sm.Pox, "normal");
}
run({ init, step });
