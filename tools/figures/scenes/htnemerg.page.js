/* Hypertensive emergency scene: pressure surge, wall injury, fibrinoid necrosis and target organs. */
const CY = SC.CY, WW = SC.W;
const layers = { rbc: $("rbcs"), endo: $("endo"), fib: $("fib"), parts: $("parts"), rings: $("rings"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oedema: $("oedema") };
const halos = [$("haloBrain"), $("haloHeart"), $("haloKidney"), $("haloEye")];
let hh = 38;
const WALL_N = 24;
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 13, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 24 + (i + 0.5) * (520 / WALL_N) }); } }); }
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(20, 540), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
const fibs = [[170, 1], [270, -1], [370, 1], [470, -1]].map(([x, side]) => { const e = mk("ellipse", { class: "htn-fibp", rx: 22, ry: 7 }, layers.fib); return { e, x, side }; });
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, dx: 0, side: 1, ox: 0, oy: 0 }; }); }
const surge = pool(18, () => mk("path", { class: "p-surge", d: "M-6 -6L1 0L-6 6" }, layers.parts));
const leaks = pool(30, () => mk("path", { class: "p-leak2", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const sparks = pool(20, () => mk("circle", { class: "sc-p p-cyt", r: 2.3 }, layers.parts));
const vasoD = pool(14, () => mk("circle", { class: "sc-p p-vaso", r: 3.4 }, layers.parts));
const blockD = pool(12, () => mk("circle", { class: "sc-p p-block", r: 3.4 }, layers.parts));
const urineD = pool(12, () => mk("path", { class: "sc-p p-urine", d: "M0 -4C2.4 -.8 3 1 3 2.2A3 3 0 0 1 -3 2.2C-3 1 -2.4 -.8 0 -4Z" }, layers.parts));
const ringP = pool(8, () => mk("circle", { class: "htn-ring", r: 10 }, layers.rings));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let brainO = null, heartO = null, kidneyO = null, eyeO = null, capEl = null, capDrug = -1;
let trHeart = null;
const dmg = [];
function crackD(cx, cy, s) {
  const p = [[cx - s, cy - s * 0.7], [cx - s * 0.2, cy + s * 0.3], [cx - s * 0.7, cy + s * 1.2], [cx + s * 0.2, cy + s * 1.8]];
  return "M" + p.map((q) => f1(q[0]) + " " + f1(q[1])).join("L");
}
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 660, 150, 140, {});
  heartO = organ($("heartSlot"), "heart", 855, 150, 110, {});
  kidneyO = organ($("kidneySlot"), "kidney", 655, 325, 100, {});
  eyeO = organ($("eyeSlot"), "eye", 855, 325, 125, {});
  [brainO, heartO, kidneyO, eyeO].forEach((O) => {
    dmg.push({ e: mk("path", { class: "htn-dmg", d: crackD(O.x - O.w * 0.18, O.y - O.h * 0.12, 14) }, layers.over) });
    dmg.push({ e: mk("path", { class: "htn-dmg", d: crackD(O.x + O.w * 0.1, O.y + O.h * 0.06, 17) }, layers.over) });
  });
  const rp = eyeO.ports.retina;
  const disc = mk("circle", { class: "htn-disc", cx: f1(rp[0]), cy: f1(rp[1]), r: 5 }, layers.over);
  dmg.push({ e: disc, disc: true });
  [0, 1, 2].forEach((i) => dmg.push({ e: mk("path", { class: "htn-flame", d: "M" + f1(rp[0] - 18 + i * 10) + " " + f1(rp[1] - 13) + "L" + f1(rp[0] - 15 + i * 10) + " " + f1(rp[1] - 4) }, layers.over) }));
  const ap = heartO.ports.apex;
  trHeart = track([[548, CY], [612, 252], [ap[0] + 34, ap[1] - 44], ap]);
}
function capText(d) {
  if (d === 1) return "Beta blocker slows the heart. Pressure falls, organs suffer less.";
  if (d === 2) return "Water tablet makes more urine. Too weak once organs are damaged.";
  if (d === 3) return "Vessel relaxer drip opens the wall. Pressure falls, organs recover.";
  return "No treatment. High pressure injures the wall and harms organs.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pr", "Pressure", "g-bad", "How high the pressure in the arteriole is. Very high pressure drives every later step."], ["br", "Breakthrough", "g-break", "Flow breaking through after autoregulation is overwhelmed, forcing pressure into fragile small vessels."], ["wa", "Wall injury", "g-wall", "Endothelial injury: the lining is damaged, swells and lets plasma proteins into the wall."], ["fi", "Fibrinoid", "g-fib", "Fibrinoid necrosis: fibrin and plasma protein in a dying vessel wall. The wall weakens and may leak or close."], ["or", "Organ damage", "g-bad", "Damage across brain, heart, kidney and eye. Its presence is what makes this an emergency."], ["pe", "Perfusion", "g-good", "Flow actually reaching the tissues. Lowering is controlled and gradual so this is kept."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Pressure in", 30, CY, 92, 100, "Blood enters under very high pressure. A fast rise gives vessels no time to adapt.");
  pill(ox, "Wall injury", 272, 158, 272, 100, "Very high pressure injures the lining. The wall swells, leaks and sends clotting signals.");
  pill(ox, "Fibrin in wall", 470, 158, 452, 100, "Dying wall muscle with fibrin inside it. This fibrinoid necrosis marks malignant pressure.");
  pill(ox, "Brain", brainO.x, brainO.y, 660, 238, "Pressure breakthrough swells the brain. Confusion or fits can follow.");
  pill(ox, "Heart", heartO.x, heartO.y, 855, 238, "The heart strains against very high pressure. It can fail or cause chest pain.");
  pill(ox, "Kidney", kidneyO.x, kidneyO.y, 655, 414, "Small kidney arteries scar and close. Filtering falls toward sudden injury.");
  pill(ox, "Eye", eyeO.x, eyeO.y, 855, 414, "The optic disc swells with flame bleeds. This marks malignant pressure.");
  capEl = mk("text", { class: "htn-story", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { P: 0.7, B: 0.5, E: 0.4, F: 0.3, O: 0.4, Perf: 0.6, vaso: 0, bb: 0, diur: 0 };
const acc = { surge: 0, leak: 0, spark: 0, urine: 0, ring: 0 };
function init() { initOrgans(); initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.P = lerp(sm.P, m.P, k1); sm.B = lerp(sm.B, m.B, k2); sm.E = lerp(sm.E, m.E, k2); sm.F = lerp(sm.F, m.F, k2); sm.O = lerp(sm.O, m.O, k2); sm.Perf = lerp(sm.Perf, m.Perf, k2);
  sm.vaso = lerp(sm.vaso, m.vaso, k1); sm.bb = lerp(sm.bb, m.bb, k1); sm.diur = lerp(sm.diur, m.diur, k2);
  const narrow = 1 - 0.35 * clamp((sm.P - 0.2) * 1.2) * (1 - sm.B);
  hh = (38 * narrow + 7 * sm.B + 15 * sm.vaso) + 3.5 * sm.P * Math.sin(tm / 360);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oedema.setAttribute("opacity", (0.06 + 0.3 * sm.B).toFixed(2));
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.7, 0, 1));
  endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.7, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + (1 - 0.18 * sm.E).toFixed(3) + " 1)"); e.g.style.setProperty("--act", sm.E.toFixed(2)); }));
  fibs.forEach((f) => { const s = clamp((sm.F - 0.05) * 1.5); f.e.setAttribute("transform", "translate(" + f1(f.x) + " " + f1(f.side > 0 ? wallT + 3 : wallB - 3) + ") scale(" + (0.2 + 0.8 * s).toFixed(3) + ")"); f.e.setAttribute("opacity", s > 0.04 ? (0.35 + 0.65 * s).toFixed(2) : "0"); });
  const flow = clamp(0.3 + 0.9 * sm.P + 0.5 * sm.B);
  rbcs.forEach((r) => { r.x += r.v * 62 * flow * dt; if (r.x > 548) { r.x = 18; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * Math.max(8, hh - 13), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.surge += dt * (2 + 9 * sm.P); while (acc.surge >= 1) { acc.surge--; const p = free(surge); if (p) emit(p, 22, CY + rnd(-hh + 12, hh - 12), 70 + 90 * sm.P, 0, 0); }
  surge.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 6 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, 546)) + " " + f1(clamp(p.y, CY - hh + 8, CY + hh - 8)) + ")"); if (p.x > 544) kill(p); });
  acc.spark += dt * sm.E * 8; while (acc.spark >= 1) { acc.spark--; const p = free(sparks); if (p) emit(p, rnd(50, 530), Math.random() < 0.5 ? wallT + 4 : wallB - 4, rnd(-8, 8), rnd(-14, 14), 0); }
  sparks.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, 544); p.y = clamp(p.y + p.vy * dt, 56, 428); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.1) kill(p); });
  acc.leak += dt * sm.B * 9; while (acc.leak >= 1) { acc.leak--; const p = free(leaks); if (p) { const up = Math.random() < 0.5; emit(p, rnd(50, 530), up ? wallT - 2 : wallB + 2, rnd(-4, 4), up ? -rnd(13, 22) : rnd(13, 22), up ? 1 : -1); } }
  leaks.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 24, 544); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < wallT - 48 || p.y > wallB + 44 || p.t > 3) kill(p); });
  /* vessel relaxer drip: green dots drift in, dock on the wall muscle and hold while the wall opens */
  if (m.vaso) { acc.vaso = (acc.vaso || 0) + dt * (2 + 6 * sm.vaso); while (acc.vaso >= 1) { acc.vaso--; const p = free(vasoD); if (p) { emit(p, 24, CY + rnd(-hh + 14, hh - 14), 90 + 60 * sm.P, 0, 0); p.st = 1; p.dx = rnd(120, 500); p.side = Math.random() < 0.5 ? 1 : -1; } } } else acc.vaso = 0;
  vasoD.forEach((p) => {
    if (!p.on) return;
    if (!m.vaso) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.5).toFixed(2)); if (p.t > 0.5) kill(p); return; }
    if (p.st === 1) { p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 6 * dt;
      if (p.x >= p.dx) { p.st = 2; p.x = p.dx; }
      else p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, CY - hh + 8, CY + hh - 8)) + ")"); }
    if (p.st === 2) { const wy = p.side > 0 ? wallT + 2 : wallB - 2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(wy + Math.sin(tm / 500 + p.x) * 1.5) + ")"); }
  });
  /* beta blocker: purple dots travel to the heart and park on it while the pulse signal fades */
  if (m.bb) { acc.block = (acc.block || 0) + dt * 3; while (acc.block >= 1) { acc.block--; const p = free(blockD); if (p) { const ap = heartO.ports.apex; emit(p, 548, CY, 0, 0, 0); p.st = 1; p.u = 0; p.ox = rnd(-26, 26); p.oy = rnd(-22, 22); p.ax = ap[0]; p.ay = ap[1]; } } } else acc.block = 0;
  blockD.forEach((p) => {
    if (!p.on) return;
    if (!m.bb) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.5).toFixed(2)); if (p.t > 0.5) kill(p); return; }
    if (p.st === 1) { p.u += dt * 130 / trHeart.len; const q = trHeart.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) p.st = 2; }
    else p.e.setAttribute("transform", "translate(" + f1(p.ax + p.ox) + " " + f1(p.ay + p.oy + Math.sin(tm / 600 + p.ox * 7) * 2) + ")");
  });
  /* water tablet: the kidney passes urine drops; a trickle when pressure is very high */
  if (m.diur) { acc.urine += dt * (1 + 12 * sm.diur); while (acc.urine >= 1) { acc.urine--; const p = free(urineD); if (p) emit(p, kidneyO.x + rnd(-20, 20), kidneyO.y + kidneyO.h / 2 - 4, rnd(-4, 4), rnd(42, 62), 0); } } else acc.urine = 0;
  urineD.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - kidneyO.y - kidneyO.h / 2) / 60).toFixed(2)); if (p.y > kidneyO.y + kidneyO.h / 2 + 58) kill(p); });
  /* heart beats fast under pressure and slows with the beta blocker; pulse rings fade downstream */
  const fr = m.bb ? 0.8 : 1.7, amp = 0.03 + 0.035 * sm.P;
  const beat = Math.pow(Math.max(0, Math.sin(tm / 1000 * 6.2832 * fr)), 2);
  heartO.g.setAttribute("transform", "translate(" + f1(heartO.x) + " " + f1(heartO.y) + ") scale(" + (1 + amp * beat).toFixed(4) + ")");
  acc.ring += dt * (m.bb ? 0.8 : 1.6) * (0.4 + 0.6 * sm.P); while (acc.ring >= 1) { acc.ring--; const p = free(ringP); if (p) { emit(p, heartO.x, heartO.y, 0, 0, 0); p.t = 0; p.k = m.bb ? 0.35 : 0.8; } }
  ringP.forEach((p) => { if (!p.on) return; p.t += dt; const r = 8 + 34 * p.t; p.e.setAttribute("r", f1(r)); p.e.setAttribute("opacity", (p.k * clamp(1 - p.t / 1.4)).toFixed(2)); if (p.t > 1.4) kill(p); });
  /* organ damage: red halos behind the art, cracks and eye bleeds above it, all fading with treatment */
  halos.forEach((e) => { if (e) e.setAttribute("opacity", (0.34 * sm.O).toFixed(2)); });
  dmg.forEach((d) => {
    if (d.disc) { d.e.setAttribute("r", f1(4 + 5 * sm.O)); d.e.setAttribute("opacity", (0.4 + 0.6 * sm.O).toFixed(2)); }
    else d.e.setAttribute("opacity", clamp(sm.O * 1.3).toFixed(2));
  });
  gg.pr.set(sm.P, wordOf(sm.P, 0.35, 0.65, ["lower", "high", "very high"]));
  gg.br.set(sm.B, wordOf(sm.B, 0.25, 0.55, ["held", "straining", "breaking through"]));
  gg.wa.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["intact", "injured", "badly injured"]));
  gg.fi.set(sm.F, wordOf(sm.F, 0.2, 0.5, ["none", "some", "severe"]));
  gg.or.set(sm.O, wordOf(sm.O, 0.25, 0.55, ["settled", "threatened", "damaged"]));
  gg.pe.set(sm.Perf, wordOf(sm.Perf, 0.4, 0.65, ["poor", "reduced", "kept"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
