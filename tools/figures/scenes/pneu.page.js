/* Pneumonia scene: bacteria and neutrophil exudate in alveoli, lobar consolidation in a lung organ, pleural spread, blood oxygen. */
const WW = SC.W;
const layers = { alv: $("alv"), lobe: $("lobe"), pleu: $("pleu"), ves: $("ves"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const mix = (a, b, t) => "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
const DEOX = [92, 66, 150], OXY = [232, 62, 74];
const satColor = (s) => mix(DEOX, OXY, clamp(s));
const sm = { B: 0.5, E: 0.4, C: 0.4, P: 0.3, O: 0.5, R: 0.1, abx: 0, oxy: 0 };
const acc = { pill: 0, ox: 0, o2: 0, flip: 0 };
let gg = {}, sacs = [], patches = [], bodyCells = [], bac = [], lobeBac = [], neus = [];
let consOv, effRect, pleuLine, spreadOv, maskG, pills, maskO2, cross;
let capEl = null, capDrug = -1, vLobe = null, vEdge = null, lobeO = null, lungO = null, trunkT = [441, 179];
const ALV = [[95, 180, 36], [175, 150, 40], [250, 190, 36], [150, 240, 34]];
const LOBE = { cx: 480, cy: 185, w: 150 };
const LUNG = { cx: 755, cy: 190, w: 150 };
const PATCH_LOCAL = [[-18, -28, 21], [8, -32, 19], [12, -2, 23], [-8, 22, 20], [16, 30, 22], [-2, 44, 18]];

function rbc(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.36, ry: ry * 0.32 }, g); return g; }

function capText(d) {
  if (d === 1) return "Antibiotic kills the germs. The filled sacs can clear and air returns.";
  if (d === 2) return "Oxygen support lifts blood oxygen for now. The germs are still growing.";
  if (d === 3) return "Antibiotic kills the germs and oxygen lifts blood oxygen while the sacs clear.";
  return "No treatment. Germs keep growing and filled sacs cannot add oxygen.";
}

function initOrgans() {
  lobeO = organ($("lobeSlot"), "lung", LOBE.cx, LOBE.cy, LOBE.w, {});
  lungO = organ($("lungSlot"), "lung", LUNG.cx, LUNG.cy, LUNG.w, {});
  const q = lungO.ports.in;
  mk("path", { class: "pneu-bronch", d: "M548 192C590 190 630 194 " + f1(q[0]) + " " + f1(q[1]) }, layers.pleu);
  const b1 = lobeO.ports.base, b2 = lungO.ports.base;
  vLobe = mk("path", { class: "pneu-blood", d: "M" + f1(b1[0]) + " " + f1(b1[1]) + "L" + f1(b1[0]) + " 382" }, layers.ves);
  vEdge = mk("path", { class: "pneu-blood", d: "M" + f1(b2[0]) + " " + f1(b2[1]) + "L" + f1(b2[0]) + " 382" }, layers.ves);
}

function initAlv() {
  const L = layers.alv;
  mk("path", { class: "pneu-air", d: "M28 122L86 158L86 176L28 148Z" }, L);
  mk("path", { class: "pneu-bronch", d: "M86 167L132 162M132 162L168 152M132 162L148 224" }, L);
  ALV.forEach(([cx, cy, r]) => {
    const g = mk("g", {}, L);
    const ex = mk("circle", { class: "pneu-exud", cx: 0, cy: 0, r: r - 5, opacity: "0" }, g);
    const cn = mk("circle", { class: "pneu-cons", cx: 0, cy: 0, r: r - 5, opacity: "0" }, g);
    mk("circle", { class: "pneu-sac", cx: 0, cy: 0, r }, g);
    place(g, cx, cy, 0, 1);
    sacs.push({ g, ex, cn, cx, cy, r });
  });
  for (let i = 0; i < 24; i++) {
    const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.cells);
    mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 5.5, ry: 2.8 } : { class: "cl-b", r: 3.4 }, g);
    const a = ALV[i % ALV.length];
    bac.push({ g, x: a[0] + rnd(-18, 18), y: a[1] + rnd(-14, 14), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180), cx: a[0], cy: a[1] });
  }
  neus = Array.from({ length: 6 }, (_, i) => {
    const g = cell(layers.cells, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 30, wob: 0.14 });
    const a = ALV[i % ALV.length];
    return { g, x: 42, y: 150 + i * 18, tx: a[0] + rnd(-12, 12), ty: a[1] + rnd(-10, 10), i };
  });
}

function initLobe() {
  const sx = lobeO.w / 100, sy = lobeO.h / 130;
  const hx = lobeO.ports.in[0], hy = lobeO.ports.in[1];
  const px = (lx) => LOBE.cx + lx * sx, py = (ly) => LOBE.cy + ly * sy;
  trunkT = [hx + 48, hy - 12];
  consOv = mk("ellipse", { class: "pneu-cons", cx: LOBE.cx + 2, cy: LOBE.cy + 7, rx: 55, ry: 72, opacity: "0" }, layers.lobe);
  let d = "M350 188L" + f1(hx) + " " + f1(hy) + "L" + f1(trunkT[0]) + " " + f1(trunkT[1]);
  PATCH_LOCAL.forEach(([lx, ly]) => { d += "M" + f1(trunkT[0]) + " " + f1(trunkT[1]) + "L" + f1(px(lx)) + " " + f1(py(ly)); });
  mk("path", { class: "pneu-bronch", d }, layers.lobe);
  PATCH_LOCAL.forEach(([lx, ly, r]) => {
    const c = mk("circle", { class: "pneu-patch", cx: f1(px(lx)), cy: f1(py(ly)), r, opacity: "0" }, layers.lobe);
    patches.push({ c });
  });
  for (let i = 0; i < 8; i++) {
    const a = PATCH_LOCAL[i % PATCH_LOCAL.length];
    const g = mk("g", { class: "cl cl-bac" }, layers.cells);
    mk("circle", { class: "cl-b", r: 3.2 }, g);
    const cx = px(a[0]) + rnd(-10, 10), cy = py(a[1]) + rnd(-8, 8);
    lobeBac.push({ g, x: cx, y: cy, a: rnd(0, 6.28), s: 0, rot: rnd(0, 180), cx, cy });
  }
}

function initPleu() {
  const L = layers.pleu;
  spreadOv = mk("ellipse", { class: "pneu-cons", cx: 795, cy: 200, rx: 26, ry: 70, opacity: "0" }, L);
  pleuLine = mk("path", { class: "pneu-pleura", d: "M856 92C864 150 864 220 856 292", opacity: "0.35" }, L);
  mk("path", { class: "pneu-pleura", d: "M876 92C884 150 884 220 876 292", opacity: "0.7" }, L);
  effRect = mk("rect", { class: "pneu-eff", x: 857, y: 292, width: 18, height: 0, rx: 6 }, L);
  mk("rect", { class: "pneu-wall", x: 892, y: 86, width: 38, height: 212, rx: 10 }, L);
  [110, 145, 180, 215, 250].forEach((y) => mk("path", { class: "pneu-hatch", d: "M896 " + y + "L926 " + (y - 12) }, L));
}

function initBlood() {
  for (let i = 0; i < 24; i++) { const g = rbc(layers.cells, 8, 4.8); bodyCells.push({ g, x: rnd(20, 940), r: rnd(-0.8, 0.8), i }); }
  maskG = mk("g", { id: "m-oxy", opacity: "0" }, layers.parts);
  mk("rect", { class: "pneu-mask", x: 862, y: 374, width: 36, height: 24, rx: 10 }, maskG);
  mk("path", { class: "pneu-mask", d: "M862 380L848 374M862 392L848 398" }, maskG);
}

function initPools() {
  pills = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
  maskO2 = pool(10, () => mk("circle", { class: "sc-p p-o2", r: 2.6 }, layers.parts));
  cross = pool(12, () => mk("circle", { class: "sc-p p-o2", r: 2.4 }, layers.parts));
}

function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["inf", "Infection", "g-bac", "Bacteria multiplying in the air sacs. An antibiotic brings this down."],
   ["exu", "Exudate", "g-exud", "Neutrophils and fluid filling the air sacs. This is the pus-like filling that blocks gas exchange."],
   ["con", "Consolidation", "g-cons", "How solid the filled lung has become. A freshly filled lobe is red and firm like liver, called red hepatisation."],
   ["ox", "Blood oxygen", "g-ox", "Oxygen in blood leaving the lungs. Filled sacs cannot add oxygen, so it falls; oxygen support lifts it."],
   ["ple", "Pleura", "g-pleu", "Spread to the pleura at the lung surface, which can inflame it and collect pleural fluid."],
   ["res", "Resolution", "g-res", "Clearing of the filled sacs as infection is treated and debris is removed, so air returns."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Airway", 58, 142, 62, 88, "Small airway leading air into the air sacs. Infection often starts around these airways.");
  pill(o, "Bacteria", 196, 150, 238, 88, "Bacteria multiplying inside the air sacs. They trigger the neutrophil flood that fills the sac.");
  pill(o, "Neutrophil exudate", 150, 235, 150, 288, "Neutrophils and fluid that have flooded into the air sac. The sac is filled instead of airy, so it cannot pass oxygen to blood.");
  const pa = pill(o, "Antibiotic", 210, 180, 262, 288, "Antibiotic: kills the bacteria so exudate can clear and air can return in resolution."); pa.setAttribute("id", "p-abx"); pa.style.opacity = 0;
  pill(o, "Bronchopneumonia", 453, 143, 405, 88, "Bronchopneumonia: patchy filling around small airways, with working lung between the patches.");
  pill(o, "Lobar pneumonia", 520, 165, 548, 88, "Lobar pneumonia: the patches merge until a whole lobe is filled and solid.");
  pill(o, "Red hepatisation", 490, 240, 480, 288, "Red hepatisation: a freshly filled lobe is red and firm like liver, before it clears in resolution.");
  pill(o, "Pleura", 856, 150, 856, 88, "Pleura: the two thin layers wrapping the lung. Infection reaching the surface inflames them.");
  pill(o, "Pleural fluid", 866, 262, 782, 293, "Pleural fluid: fluid collecting between the pleural layers beside inflamed lung. It can squeeze the lung and worsen breathing.");
  pill(o, "Blood oxygen", 200, 386, 150, 430, "Blood leaving the lungs. Its oxygen follows how many sacs are still airy and working.");
  const po = pill(o, "Oxygen support", 880, 386, 812, 430, "Oxygen support: raises the oxygen in the air breathed in, lifting blood oxygen while the sacs clear."); po.setAttribute("id", "p-oxy"); po.style.opacity = 0;
  capEl = mk("text", { class: "pneu-cap", x: 30, y: 358 }, o); capEl.textContent = capText(0);
}

function init() { initOrgans(); initAlv(); initLobe(); initPleu(); initBlood(); initPools(); initPanel(); }

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.5);
  ["B", "abx", "oxy", "O", "P"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  ["E", "C", "R"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  const breath = 1 + (0.025 + 0.035 * (1 - sm.O)) * Math.sin(tm / (420 - 120 * (1 - sm.O)));
  vLobe.setAttribute("stroke-width", f1(7 + 7 * sm.oxy));
  vEdge.setAttribute("stroke-width", f1(7 + 7 * sm.oxy));
  vLobe.setAttribute("stroke", satColor(clamp(sm.O * 1.05)));
  vEdge.setAttribute("stroke", satColor(clamp(sm.O * 1.05)));
  sacs.forEach((s, i) => {
    place(s.g, s.cx + Math.sin(tm / 1500 + i) * 1.5, s.cy, 0, breath);
    s.ex.setAttribute("opacity", (sm.E * 0.85).toFixed(2));
    s.cn.setAttribute("opacity", (sm.C * 0.5).toFixed(2));
  });
  const wantB = Math.round(sm.B * bac.length);
  bac.forEach((b, i) => {
    const on = i < wantB;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt;
    if (Math.hypot(b.x - b.cx, b.y - b.cy) > 24) b.a += Math.PI * dt * 2;
    b.x = clamp(b.x, b.cx - 26, b.cx + 26); b.y = clamp(b.y, b.cy - 22, b.cy + 22);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, Math.max(0.05, b.s));
    b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  const wantL = Math.round(sm.B * lobeBac.length);
  lobeBac.forEach((b, i) => {
    const on = i < wantL;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.6 + sm.abx * 3)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 7 * dt; b.y += Math.sin(b.a) * 7 * dt;
    b.x = clamp(b.x, b.cx - 14, b.cx + 14); b.y = clamp(b.y, b.cy - 12, b.cy + 12);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, Math.max(0.05, b.s));
    b.g.style.opacity = b.s > 0.04 ? 1 : 0;
  });
  const wantN = Math.round(sm.E * neus.length);
  neus.forEach((n, i) => {
    const act = i < wantN;
    n.g.style.opacity = act ? 1 : 0;
    if (act) { n.x += (n.tx - n.x) * dt * 0.45; n.y += (n.ty - n.y) * dt * 0.45; }
    else { n.x += (42 - n.x) * dt * 0.6; n.y += ((150 + i * 18) - n.y) * dt * 0.6; }
    place(n.g, n.x + Math.sin(tm / 320 + i) * 1.6, n.y, Math.sin(tm / 400 + i) * 10, act ? 1 : 0.4);
  });
  patches.forEach((p) => p.c.setAttribute("opacity", (sm.E * 0.9).toFixed(2)));
  consOv.setAttribute("opacity", (clamp((sm.C - 0.42) * 1.7) * 0.78).toFixed(2));
  spreadOv.setAttribute("opacity", (sm.P * 0.55).toFixed(2));
  pleuLine.setAttribute("opacity", (0.3 + sm.P * 0.65).toFixed(2));
  const eh = sm.P * 64;
  effRect.setAttribute("y", f1(292 - eh)); effRect.setAttribute("height", f1(eh));
  bodyCells.forEach((c) => {
    c.x += 54 * clamp(0.3 + 0.7 * sm.O) * dt;
    if (c.x > 946) { c.x = 20; c.r = rnd(-0.8, 0.8); }
    place(c.g, c.x, 386 + c.r * 13, Math.sin(tm / 500 + c.x) * 8, 1);
    c.g.style.fill = satColor(clamp(sm.O * 1.05 + (c.i % 5 === 0 ? 0.12 : -0.08)));
  });
  acc.pill += dt * sm.abx * 2.2; while (acc.pill >= 1) { acc.pill--; const p = free(pills); if (p) { acc.flip = 1 - acc.flip; emit(p, rnd(30, 90), 170, 0, 0, acc.flip); } }
  pills.forEach((p) => {
    if (!p.on) return; p.t += dt;
    const tx = p.k ? trunkT[0] : 175, ty = p.k ? trunkT[1] : 168;
    p.x += (tx - p.x) * dt * 0.55 + 15 * dt; p.y += (ty - p.y) * dt * 0.65;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2));
    if (p.t > 5.5) kill(p);
  });
  $("m-oxy").setAttribute("opacity", sm.oxy.toFixed(2));
  acc.ox += dt * sm.oxy * 5; while (acc.ox >= 1) { acc.ox--; const p = free(maskO2); if (p) emit(p, 880 + rnd(-16, 16), 376, -12, -44, 0); }
  maskO2.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 332) kill(p); });
  acc.o2 += dt * (1 + 4.5 * sm.O); while (acc.o2 >= 1) { acc.o2--; const p = free(cross); if (p) emit(p, 175 + rnd(-60, 60), 196, 0, 34, 0); }
  cross.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 252) kill(p); });
  $("p-abx").style.opacity = sm.abx.toFixed(2); $("p-oxy").style.opacity = sm.oxy.toFixed(2);
  gg.inf.set(sm.B, wordOf(sm.B, 0.2, 0.5, ["low", "present", "high"]));
  gg.exu.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["little", "some", "filled"]));
  gg.con.set(sm.C, wordOf(sm.C, 0.35, 0.65, ["clearing", "patchy", "solid"]));
  gg.ox.set(sm.O, wordOf(sm.O, 0.5, 0.75, ["low", "reduced", "near normal"]));
  gg.ple.set(sm.P, wordOf(sm.P, 0.25, 0.55, ["none", "reached", "inflamed"]));
  gg.res.set(sm.R, wordOf(sm.R, 0.2, 0.55, ["none", "starting", "clearing"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
