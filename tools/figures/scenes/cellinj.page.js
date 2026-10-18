/* Cell injury scene: a hypoxic cell, its pumps and mitochondria, swelling, membrane failure, enzyme leak and necrosis patterns. */
const CX = 315, CY = 275, CR = 102;
const L = { vessel: $("vessel"), cellg: $("cellg"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { ATP: 0.7, O2: 0.7, ROS: 0.3, Pump: 0.6, Swell: 0.3, Memb: 0.1, Leak: 0, Viab: 0.9, oxy: 0, antiox: 0 };
const acc = { oxy: 0, water: 0, ros: 0, enz: 0, scav: 0 };
const gg = {};
let mainCell = null, necOv = null, brk = null, nucRef = null;
const mitos = [], pumps = [], rbcs = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const oxyP = pool(22, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, L.parts));
const waterP = pool(20, () => mk("path", { class: "p-water", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const rosP = pool(22, () => mk("path", { class: "sc-p p-ros", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, L.parts));
const enzP = pool(18, () => mk("rect", { class: "sc-p p-enz", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const scavP = pool(10, () => mk("circle", { class: "sc-p", r: 2.4, style: "--cc:var(--c-good)" }, L.parts));
function init() {
  for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(40, 590), y: rnd(90, 112), v: rnd(0.8, 1.2), rot: rnd(-14, 14) }); }
  mainCell = cell(L.cellg, { cls: "cellx", r: CR, nuc: 0.34, seed: 4, wob: 0.07 });
  place(mainCell, CX, CY, 0, 1);
  nucRef = mainCell.querySelector(".cl-n");
  necOv = mk("ellipse", { class: "ci-nec", cx: CX, cy: CY, rx: CR * 0.96, ry: CR * 0.92 }, L.cellg);
  [[-38, -28], [42, -12], [-6, 42]].forEach(([dx, dy], i) => { const g = mk("g", {}, L.cellg); mk("ellipse", { class: "ci-mito-b", rx: 17, ry: 9 }, g); mk("path", { class: "ci-mito-f", d: "M-10 0q5 -5 10 0q5 5 10 0" }, g); mitos.push({ g, x: CX + dx, y: CY + dy, ph: i * 2.2 }); });
  for (let j = 0; j < 6; j++) { const ang = (j / 6) * 6.283 + 0.4, g = mk("g", {}, L.cellg); mk("rect", { class: "ci-pump", x: -5, y: -7, width: 10, height: 14, rx: 3 }, g); mk("circle", { class: "ci-pump-d", cx: 0, cy: -2, r: 2 }, g); pumps.push({ g, ang, x: CX + Math.cos(ang) * CR, y: CY + Math.sin(ang) * CR }); }
  brk = mk("path", { class: "ci-break", d: "M" + (CX + 88) + " " + (CY + 28) + "l10 8l-8 8l12 8l-9 9" }, L.cellg);
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cell";
  [["atp", "ATP", "g-good", "ATP from oxidative phosphorylation. It powers the ion pumps that keep the cell at its normal volume."], ["sw", "Swelling", "g-bad", "Water follows sodium into the cell when pumps fail, so the cell and its organelles swell."], ["mb", "Membrane", "g-bad", "Damage to the cell membrane. Beyond the point of no return it ruptures and injury is irreversible."], ["lk", "Leak", "g-leak", "Enzymes leaking out through a damaged membrane. In blood tests these show cell death in an organ."], ["ros", "Radicals", "g-ros", "Free radicals: reactive molecules that attack membrane lipids, proteins and DNA. Antioxidants scavenge them."], ["vb", "Viability", "g-good", "Whether the cell can still recover. High in reversible injury, lost once membranes rupture in necrosis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Oxygen supply", 110, 101, 110, 142, "Blood brings oxygen to the cell. Hypoxia means too little oxygen reaches it, from low blood flow, low blood oxygen or a blocked vessel.");
  pill(o, "Swelling", CX, CY - CR, 330, 142, "When pumps fail, sodium and water enter and the cell swells. Early swelling is reversible if oxygen returns.");
  pill(o, "Oxygen back", 500, 101, 500, 142, "Restoring oxygen early lets mitochondria make ATP again and can rescue a reversibly injured cell. It cannot revive necrotic tissue.");
  pill(o, "ATP", 357, 263, 520, 190, "ATP made by mitochondria. Without oxygen, oxidative phosphorylation stops and ATP falls within a short time.");
  pill(o, "Free radicals", 292, 288, 130, 250, "Free radicals build up during injury and attack membrane lipids (peroxidation), proteins and DNA, worsening membrane damage.");
  pill(o, "Antioxidant", 292, 288, 130, 300, "An antioxidant scavenges free radicals and limits membrane injury. It does not restore ATP while hypoxia continues.");
  pill(o, "Ion pumps", 240, 350, 130, 405, "Sodium-potassium and calcium pumps in the membrane. They need ATP; when ATP falls they fail and ions and water flood in.");
  pill(o, "Membrane", 408, 322, 530, 355, "The cell membrane. Calcium entry and free radicals damage it; once it ruptures, injury is irreversible and necrosis follows.");
  pill(o, "Enzyme leak", 420, 338, 530, 405, "Enzymes escape through the ruptured membrane into the tissue and blood, where they can be measured as markers of cell death.");
  $("nb0").style.transition = "opacity .4s"; $("nb1").style.transition = "opacity .4s"; $("nb2").style.transition = "opacity .4s"; $("nb3").style.transition = "opacity .4s";
  const ob = o.querySelectorAll(".dr-lab")[2]; if (ob) { ob.setAttribute("id", "pill-oxyback"); ob.style.opacity = "0"; }
  const ab = o.querySelectorAll(".dr-lab")[5]; if (ab) { ab.setAttribute("id", "pill-antiox"); ab.style.opacity = "0"; }
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.7);
  sm.ATP = lerp(sm.ATP, m.ATP, k2); sm.O2 = lerp(sm.O2, m.O2, k1); sm.ROS = lerp(sm.ROS, m.ROS, k2); sm.Pump = lerp(sm.Pump, m.Pump, k2); sm.Swell = lerp(sm.Swell, m.Swell, k2); sm.Memb = lerp(sm.Memb, m.Memb, k2); sm.Leak = lerp(sm.Leak, m.Leak, k2); sm.Viab = lerp(sm.Viab, m.Viab, k2); sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.antiox = lerp(sm.antiox, m.antiox, k1);
  const grow = 1 + sm.Swell * 0.22;
  place(mainCell, CX, CY, Math.sin(tm / 2400) * 1.5, grow);
  if (nucRef) nucRef.style.opacity = (1 - sm.Memb * 0.75).toFixed(2);
  necOv.setAttribute("opacity", (sm.Memb * 0.45).toFixed(2)); necOv.setAttribute("rx", f1(CR * 0.96 * grow)); necOv.setAttribute("ry", f1(CR * 0.92 * grow));
  brk.setAttribute("opacity", clamp((sm.Memb - 0.3) * 1.6).toFixed(2));
  mitos.forEach((mt, i) => { place(mt.g, mt.x + Math.sin(tm / 1600 + mt.ph) * 2, mt.y + Math.cos(tm / 1900 + mt.ph) * 2, Math.sin(tm / 2000 + mt.ph) * 8, 0.75 + 0.35 * sm.ATP); mt.g.style.opacity = (0.45 + 0.55 * sm.ATP).toFixed(2); });
  pumps.forEach((pu, j) => { const wob = sm.Pump > 0.35 ? Math.sin(tm / 180 + j * 1.4) * 3 : 0; place(pu.g, CX + Math.cos(pu.ang) * CR * grow, CY + Math.sin(pu.ang) * CR * grow, pu.ang * 57.3 + 90 + wob, 0.8 + 0.3 * sm.Pump); pu.g.style.opacity = (0.35 + 0.65 * sm.Pump).toFixed(2); });
  rbcs.forEach((r) => { r.x += r.v * 62 * clamp(0.25 + sm.O2) * dt; if (r.x > 600) { r.x = 28; r.y = rnd(90, 112); } place(r.g, r.x, r.y, r.rot, 1); });
  acc.oxy += dt * sm.O2 * 7; while (acc.oxy >= 1) { acc.oxy--; const p = freeP(oxyP); if (p) emit(p, rnd(70, 560), 120, rnd(-4, 4), rnd(20, 30), 0); }
  oxyP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 36, 600); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > CY - CR * grow - 4 || p.t > 3) killP(p); });
  acc.water += dt * (1 - sm.Pump) * 8; while (acc.water >= 1) { acc.water--; const p = freeP(waterP); if (p) emit(p, CX - CR * grow - 14, CY + rnd(-50, 50), rnd(18, 28), rnd(-4, 4), 0); }
  waterP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > CX - 8 || p.t > 3.4) killP(p); });
  acc.ros += dt * sm.ROS * 9; while (acc.ros >= 1) { acc.ros--; const p = freeP(rosP); if (p) { const an = rnd(0, 6.28), rr = rnd(8, 62); emit(p, CX + Math.cos(an) * rr, CY + Math.sin(an) * rr, rnd(-6, 6), rnd(-6, 6), 0); } }
  rosP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, CX - 78, CX + 78); p.y = clamp(p.y, CY - 78, CY + 78); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  acc.scav += dt * sm.antiox * 6; while (acc.scav >= 1) { acc.scav--; const p = freeP(scavP); if (p) { const an = rnd(0, 6.28), rr = rnd(10, 60); emit(p, CX + Math.cos(an) * rr, CY + Math.sin(an) * rr, rnd(-8, 8), rnd(-8, 8), 0); } }
  scavP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, CX - 80, CX + 80); p.y = clamp(p.y, CY - 80, CY + 80); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) killP(p); });
  acc.enz += dt * sm.Leak * 8; while (acc.enz >= 1) { acc.enz--; const p = freeP(enzP); if (p) emit(p, CX + 92, CY + rnd(24, 52), rnd(22, 36), rnd(8, 18), 0); }
  enzP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 7) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6 || p.x > 596 || p.y > 428) killP(p); });
  const necOn = clamp((sm.Memb - 0.35) * 1.8);
  ["nb0", "nb1", "nb2", "nb3"].forEach((id) => { $(id).setAttribute("opacity", (0.3 + 0.7 * necOn).toFixed(2)); });
  const ob = $("pill-oxyback"); if (ob) ob.style.opacity = sm.oxy.toFixed(2);
  const ab2 = $("pill-antiox"); if (ab2) ab2.style.opacity = sm.antiox.toFixed(2);
  gg.atp.set(sm.ATP, wordOf(sm.ATP, 0.35, 0.65, ["depleted", "low", "preserved"])); gg.sw.set(sm.Swell, wordOf(sm.Swell, 0.25, 0.55, ["normal", "swollen", "marked"])); gg.mb.set(sm.Memb, wordOf(sm.Memb, 0.25, 0.6, ["intact", "injured", "ruptured"])); gg.lk.set(sm.Leak, wordOf(sm.Leak, 0.25, 0.55, ["none", "some", "marked"])); gg.ros.set(sm.ROS, wordOf(sm.ROS, 0.3, 0.6, ["low", "raised", "high"])); gg.vb.set(sm.Viab, wordOf(sm.Viab, 0.35, 0.65, ["lost", "falling", "preserved"]));
}
run({ init, step });
