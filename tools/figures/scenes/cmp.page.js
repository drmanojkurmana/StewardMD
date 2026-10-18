/* Cardiomyopathies scene: a real heart organ with a cutaway overlay, cause icons, inflow and outflow blood, drug particles and gauges. */
const HX = 480, HY = 250, HW = 210;
const CX = 494, CY = 312;
const L = { causes: $("causes"), slot: $("heartSlot"), heart: $("heart"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { Dil: 0.92, Wall: 0.18, Stiff: 0.30, Dia: 0.45, Sys: 0.88, Out: 0.05, Fill: 0.55, Ej: 0.12, hf: 0, bb: 0, cause: 0, P0: 1, P1: 0, P2: 0 };
let heartO = null, cavEl, ringEl, bulgeEl, shadeEl, haloEl, vesIn, vesOut, wallL, wallR, capEl = null, capKey = -1, tpDrug = -1;
let trIn = null, trOut = null;
const amyDots = [], causeIcons = [], receptors = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const gg = {};
let tpG = null, tpT = null, tpR = null, tpOp = 0;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, ri: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const inflow = pool(16, () => mk("circle", { class: "sc-p p-in", r: 2.6 }, L.parts));
const outflow = pool(16, () => mk("circle", { class: "sc-p p-out", r: 2.6 }, L.parts));
const turb = pool(8, () => mk("circle", { class: "sc-p p-turb", r: 2.2 }, L.parts));
const blk = pool(8, () => mk("circle", { class: "sc-p p-blk", r: 2.8 }, L.parts));
const sup = pool(10, () => mk("circle", { class: "sc-p p-sup", r: 2.4 }, L.parts));
const clr = pool(10, () => mk("circle", { class: "sc-p p-clr", r: 2.2 }, L.parts));
const acc = { inn: 0, out: 0 };
function capText(d, l) {
  if (d === 1) return "Heart failure therapy unloads the heart. The squeeze strengthens and flow returns.";
  if (d === 2) return "Beta blocker slows and softens the squeeze. The exit opens and flow returns.";
  if (d === 3) return l === 1 ? "Treating the cause helps this inherited thickening little. The exit stays narrow." : "Treating the cause clears the trigger. The muscle recovers and fills better.";
  if (d === 4) return "Full bundle. The cause is treated and the heart is supported. Pumping and filling recover.";
  if (l === 1) return "No treatment. The thick wall blocks the exit and little blood leaves the heart.";
  if (l === 2) return "No treatment. Stiff deposits stop the heart filling, so little blood can leave.";
  return "No treatment. The stretched heart squeezes weakly and only a thin stream leaves.";
}
const TP_TXT = ["", "Heart support", "Outflow relief", "Cause treated", "Full bundle"];

function causeIcon(x, y, kind) {
  const g = mk("g", {}, L.causes);
  mk("circle", { class: "cmp-node", cx: x, cy: y, r: 22 }, g);
  const h = mk("g", {}, g);
  if (kind === 0) {
    mk("rect", { class: "cmp-ic", x: -9, y: -12, width: 18, height: 26, rx: 5 }, h);
    mk("rect", { class: "cmp-ic", x: -4, y: -22, width: 8, height: 12, rx: 2 }, h);
    mk("rect", { class: "cmp-ic2", x: -6, y: 2, width: 12, height: 9, rx: 3 }, h);
  } else if (kind === 1) {
    for (let i = 0; i < 8; i++) { const a = i * 0.785, c = Math.cos(a), s = Math.sin(a);
      mk("path", { class: "cmp-ic4", fill: "none", d: "M" + f1(c * 8) + " " + f1(s * 8) + "L" + f1(c * 13) + " " + f1(s * 13) }, h);
      mk("circle", { class: "cmp-icd", cx: f1(c * 14), cy: f1(s * 14), r: 1.5 }, h); }
    mk("circle", { class: "cmp-ic2", cx: 0, cy: 0, r: 8 }, h);
  } else if (kind === 2) {
    let d1 = "", d2 = "";
    for (let t = -16; t <= 16; t += 2) { d1 += (t === -16 ? "M" : "L") + f1(Math.sin(t / 5) * 8) + " " + t; d2 += (t === -16 ? "M" : "L") + f1(-Math.sin(t / 5) * 8) + " " + t; }
    mk("path", { class: "cmp-ic3", fill: "none", d: d1 }, h);
    mk("path", { class: "cmp-ic3", fill: "none", d: d2 }, h);
    for (let t = -10; t <= 10; t += 10) mk("path", { class: "cmp-ic4", fill: "none", d: "M" + f1(Math.sin(t / 5) * 8) + " " + t + "L" + f1(-Math.sin(t / 5) * 8) + " " + t }, h);
  } else {
    mk("path", { class: "cmp-ic4", fill: "none", d: "M-12 -8C-4 -12 4 -4 12 -8" }, h);
    mk("path", { class: "cmp-ic4", fill: "none", d: "M-12 0C-4 -4 4 4 12 0" }, h);
    mk("path", { class: "cmp-ic4", fill: "none", d: "M-12 8C-4 4 4 12 12 8" }, h);
    mk("circle", { class: "cmp-icd", cx: -6, cy: -4, r: 1.8 }, h);
    mk("circle", { class: "cmp-icd", cx: 5, cy: 4, r: 1.8 }, h);
  }
  causeIcons.push({ g: h, x, y });
}

function init() {
  causeIcon(95, 140, 0); causeIcon(95, 210, 1); causeIcon(95, 280, 2); causeIcon(95, 350, 3);
  heartO = organ(L.slot, "heart", HX, HY, HW, {});
  const outP = heartO.ports.out;
  trIn = track([[150, 330], [300, 335], [390, 325], [440, 318]]);
  trOut = track([[CX, CY - 60], [488, 190], [482, 140], outP, [outP[0] + 24, outP[1] - 25], [580, 75], [680, 75], [735, 75]]);
  const g = L.heart;
  shadeEl = mk("ellipse", { class: "cmp-shade", cx: CX, cy: CY, rx: 88, ry: 76, opacity: "0.2" }, g);
  vesIn = mk("path", { class: "cmp-vesIn", fill: "none", d: "M150 330L300 335L390 325L440 318" }, g);
  vesOut = mk("path", { class: "cmp-ves", fill: "none", d: "M" + CX + " " + (CY - 60) + "L488 190L482 140L" + f1(outP[0]) + " " + f1(outP[1]) }, g);
  cavEl = mk("ellipse", { class: "cmp-cav", cx: CX, cy: CY, rx: 60, ry: 66 }, g);
  ringEl = mk("ellipse", { class: "cmp-ring", cx: CX, cy: CY, rx: 70, ry: 76 }, g);
  bulgeEl = mk("ellipse", { class: "cmp-bulge", cx: 521, cy: 190, rx: 30, ry: 34 }, g);
  wallL = mk("path", { class: "cmp-wall", fill: "none", d: "M470 158L470 222" }, g);
  wallR = mk("path", { class: "cmp-wall", fill: "none", d: "M500 158L500 222" }, g);
  haloEl = mk("ellipse", { class: "cmp-halo", cx: HX, cy: HY, rx: 112, ry: 148, opacity: "0" }, g);
  for (let i = 0; i < 14; i++) { const a = i * 2.4, rr = 20 + (i % 3) * 18;
    const d = mk("circle", { class: "cmp-amy", cx: f1(CX + Math.cos(a) * rr * 1.15), cy: f1(CY + Math.sin(a) * rr * 0.85), r: 3, opacity: "0" }, g);
    amyDots.push(d); }
  for (let i = 0; i < 6; i++) mk("path", { class: "cmp-rec", fill: "none", d: "M0 0L6 0" }, g).setAttribute("id", "rec" + i);
  const e = trOut.at(1);
  mk("path", { class: "cmp-arrow", d: "M" + f1(e.x - 2) + " " + f1(e.y - 7) + "L" + f1(e.x + 9) + " " + f1(e.y) + "L" + f1(e.x - 2) + " " + f1(e.y + 7) + "Z" }, g);
  const o = L.over;
  pill(o, "Causes", 95, 140, 95, 84, "Causes that injure heart muscle: heavy alcohol use, viral myocarditis, inherited gene changes and amyloid deposits. Treating the cause shrinks these triggers.");
  pill(o, "Heart", 585, 180, 720, 150, "The heart. The shaded cutaway shows the left ventricle squeezing blood out to the body.");
  pill(o, "Thick wall", 556, 340, 640, 330, "Wall thickness. Thin and stretched in dilated disease, thick in hypertrophic disease.");
  pill(o, "Blocked outflow", 488, 190, 640, 180, "The outflow exit. A thick septum narrows it in hypertrophic disease so little blood leaves, especially on effort.");
  pill(o, "Stiff deposits", 530, 360, 470, 392, "Amyloid deposits stiffen the wall in restrictive disease so the heart cannot fill. They clear when the cause is treated.");
  pill(o, "Weak squeeze", 735, 75, 700, 110, "Blood leaving for the body. A weak squeeze sends a thin slow stream. Treatment makes it strong again.");
  pill(o, "Poor filling", 260, 330, 250, 382, "Blood arriving to fill the heart. A stiff or thick wall fills slowly and blood queues up behind it.");
  tpG = pill(o, "Full bundle", 520, 390, 700, 406, "Treatment at work. Drug dots dock on the heart while the caption below explains what changes.");
  tpG.setAttribute("id", "p-treat"); tpG.style.opacity = 0;
  tpT = tpG.querySelector("text"); tpR = tpG.querySelector("rect");
  capEl = mk("text", { class: "cmp-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The ventricle";
  [["dil", "Dilatation", "g-dil", "How stretched and enlarged the ventricle cavity is. High in dilated disease."], ["wall", "Wall", "g-wall", "Wall thickness. Thin in dilated disease, thick in hypertrophic disease."], ["stiff", "Stiffness", "g-stiff", "How stiff the wall is. Highest in restrictive disease from amyloid deposits."], ["fill", "Filling", "g-fill", "How well the ventricle fills with blood. Poor when the wall is thick or stiff."], ["ej", "Ejection", "g-ej", "How well the ventricle squeezes blood out. Poor in dilated disease."], ["out", "Outflow block", "g-out", "Blockage of the outflow exit by the thick septum. Seen in hypertrophic disease."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Dil", "Wall", "Stiff", "Dia", "Sys", "Out", "Fill", "Ej", "hf", "bb", "cause", "P0", "P1", "P2"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "Fill" || q === "Ej" ? k2 : k1); });
  const beatT = 1.05 + 0.45 * sm.bb, ph = ((tm / 1000) / beatT) % 1;
  const contract = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
  const flowOut = sm.Ej * (1 - sm.Out * 0.85);
  place(heartO.g, HX, HY - 1.5 * contract * sm.Ej, 0, 1 + 0.015 * contract * sm.Ej);
  const cavR = Math.max(16, (30 + sm.Dil * 52 - sm.Wall * 10 - sm.Stiff * 5) * (1 - 0.16 * sm.Ej * contract));
  cavEl.setAttribute("rx", f1(cavR)); cavEl.setAttribute("ry", f1(cavR * 1.12));
  const sw = 6 + sm.Wall * 24;
  ringEl.setAttribute("rx", f1(cavR + sw / 2 + 2)); ringEl.setAttribute("ry", f1(cavR * 1.12 + sw / 2 + 2));
  ringEl.setAttribute("stroke-width", f1(sw));
  const gap = lerp(46, 12, sm.Out);
  wallL.setAttribute("d", "M" + f1(485 - gap / 2) + " 158L" + f1(485 - gap / 2) + " 222");
  wallR.setAttribute("d", "M" + f1(485 + gap / 2) + " 158L" + f1(485 + gap / 2) + " 222");
  const brx = 8 + sm.Out * 24 + sm.Wall * 6;
  bulgeEl.setAttribute("rx", f1(brx)); bulgeEl.setAttribute("cx", f1(485 + gap / 2 + brx - 6));
  shadeEl.setAttribute("opacity", (0.05 + 0.22 * (1 - sm.Ej)).toFixed(2));
  haloEl.setAttribute("opacity", (sm.hf * 0.75).toFixed(2));
  vesIn.setAttribute("stroke-width", f1(8 + 10 * sm.Fill));
  vesOut.setAttribute("stroke-width", f1(5 + 13 * flowOut));
  const amyOp = sm.P2 * clamp((sm.Stiff - 0.4) * 2, 0, 1) * (1 - 0.8 * sm.cause);
  amyDots.forEach((d) => { d.setAttribute("opacity", amyOp.toFixed(2)); d.setAttribute("r", f1(3 * (1 - 0.55 * sm.cause))); });
  causeIcons.forEach((c) => { place(c.g, c.x, c.y, 0, 1 - 0.62 * sm.cause); c.g.style.opacity = (1 - 0.55 * sm.cause).toFixed(2); });
  for (let i = 0; i < 6; i++) {
    const rx = 485 - gap / 2 - 8, ry = 165 + i * 10;
    receptors[i][0] = rx; receptors[i][1] = ry;
    const r = $("rec" + i);
    r.setAttribute("d", "M" + f1(rx - 5) + " " + ry + "L" + f1(rx + 1) + " " + ry);
    r.setAttribute("opacity", (0.25 + 0.75 * sm.bb).toFixed(2));
  }
  acc.inn += dt * (1 + 7 * sm.Fill);
  while (acc.inn >= 1) { acc.inn--; const p = free(inflow); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  inflow.forEach((p) => { if (!p.on) return;
    p.u += dt * (0.14 + 0.5 * sm.Fill) * (p.u > 0.35 && sm.Fill < 0.35 ? 0.2 : 1);
    if (p.u >= 1) { kill(p); return; }
    const q = trIn.at(p.u); p.x = q.x; p.y = q.y;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  acc.out += dt * (1 + 8 * flowOut);
  while (acc.out >= 1) { acc.out--; const p = free(outflow); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  outflow.forEach((p) => { if (!p.on) return;
    p.u += dt * (0.16 + 0.55 * flowOut);
    if (p.u >= 1) { kill(p); return; }
    const q = trOut.at(p.u); p.x = q.x; p.y = q.y;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  turb.forEach((p, i) => { const a = tm / 420 + i * 0.785;
    p.x = 485 + Math.cos(a) * (gap / 2 + 8); p.y = 190 + Math.sin(a) * 26;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", (sm.Out * (0.35 + 0.65 * contract)).toFixed(2)); });
  if (sm.bb > 0.5 && Math.random() < dt * 6) { const p = free(blk); if (p) { p.ri = blk.indexOf(p) % 6; emit(p, 640, 250, 0, 0, 0); } }
  blk.forEach((p) => { if (!p.on) return;
    const r = receptors[p.ri];
    if (sm.bb < 0.4) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    if (p.st === 0) { p.x += (r[0] - p.x) * Math.min(1, dt * 3); p.y += (r[1] - p.y) * Math.min(1, dt * 3);
      if (Math.hypot(r[0] - p.x, r[1] - p.y) < 3) { p.st = 1; p.t = 0; } }
    else { p.x = r[0]; p.y = r[1]; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  if (sm.hf > 0.5 && Math.random() < dt * 7) { const p = free(sup); if (p) emit(p, rnd(380, 580), 430, rnd(-6, 6), -rnd(40, 60), 0); }
  sup.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 1).toFixed(2)); if (p.t > 2.6 || p.y < 120) kill(p); });
  if (sm.cause > 0.5 && Math.random() < dt * 7) { const d = amyDots.length ? amyDots[Math.floor(Math.random() * amyDots.length)] : null;
    const p = free(clr); if (p && d) emit(p, +d.getAttribute("cx") + rnd(-8, 8), +d.getAttribute("cy") + rnd(-8, 8), rnd(-8, 8), rnd(-14, -4), 0); }
  clr.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); });
  gg.dil.set(sm.Dil, wordOf(sm.Dil, 0.35, 0.65, ["small", "normal", "dilated"]));
  gg.wall.set(sm.Wall, wordOf(sm.Wall, 0.35, 0.65, ["thin", "normal", "thick"]));
  gg.stiff.set(sm.Stiff, wordOf(sm.Stiff, 0.3, 0.6, ["soft", "firm", "stiff"]));
  gg.fill.set(sm.Fill, wordOf(sm.Fill, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.ej.set(sm.Ej, wordOf(sm.Ej, 0.35, 0.65, ["poor", "reduced", "good"]));
  gg.out.set(sm.Out, wordOf(sm.Out, 0.25, 0.6, ["open", "narrowed", "blocked"]));
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  if (drug !== tpDrug) { tpDrug = drug; const t = TP_TXT[drug] || "";
    if (tpT.textContent !== t) { tpT.textContent = t; const lw = t.length * 6.2 + 14; tpR.setAttribute("x", f1(700 - lw / 2)); tpR.setAttribute("width", f1(lw)); } }
  tpOp = lerp(tpOp, drug > 0 ? 1 : 0, Math.min(1, dt * 3));
  tpG.style.opacity = tpOp.toFixed(2);
}
run({ init, step });
