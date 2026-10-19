/* Cell injury scene: a coronary branch feeds a heart muscle cell; clot, pumps, swelling, radicals, leak and necrosis patterns. */
const HX = 185, HY = 255, HW = 190;   /* heart organ: centre and width */
const CX = 480, CY = 290, CR = 88;    /* the watched cell: centre and radius */
const BRK = [CX + 82, CY + 29];       /* membrane rupture point */
const CLOTU = 0.55;                   /* clot position as a fraction along the vessel */
const L = { slot: $("heartSlot"), ves: $("ves"), cellg: $("cellg"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { ATP: 0.7, O2: 0.7, ROS: 0.3, Pump: 0.6, Swell: 0.3, Memb: 0.1, Leak: 0, Viab: 0.9, oxy: 0, antiox: 0, clot: 9 };
const acc = { oxy: 0, water: 0, ros: 0, enz: 0, scav: 0 };
const gg = {};
let heartO = null, vesTr = null, vesPath = null, clotEl = null, haloEl = null, mainCell = null, necOv = null, brk = null, nucRef = null, capEl = null, capKey = "";
const mitos = [], pumps = [], rbcs = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 2) return l >= 2 ? "Oxygen is back but this cell already died. Earlier oxygen could have saved it." : l >= 1 ? "Oxygen is back. Pumps restart and some swelling reverses." : "Oxygen is back. The pumps restart and the swelling goes down.";
  if (d === 1) return "Antioxidant soaks up free radicals. Membrane damage slows but the cell still lacks oxygen.";
  return l >= 2 ? "No treatment. The membrane has ruptured and the cell is dead." : l >= 1 ? "No treatment. Pumps fail, the cell swells and the membrane starts to fail." : "No treatment. Low oxygen stalls ATP and the cell swells.";
}
const oxyP = pool(26, () => mk("circle", { class: "sc-p p-oxy", r: 2.6 }, L.parts));
const waterP = pool(20, () => mk("path", { class: "p-water", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const rosP = pool(22, () => mk("path", { class: "sc-p p-ros", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, L.parts));
const enzP = pool(18, () => mk("rect", { class: "sc-p p-enz", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const scavP = pool(12, () => mk("circle", { class: "sc-p", r: 2.6, style: "--cc:var(--c-good)" }, L.parts));
function init() {
  /* ---- heart organ and the coronary branch that feeds the watched cell ---- */
  heartO = organ(L.slot, "heart", HX, HY, HW, {});
  const AP = heartO.ports.aorta || heartO.ports.in;
  vesTr = track([AP, [250, 148], [310, 200], [355, 245], [CX - CR + 4, CY]]);
  vesPath = mk("path", { class: "ci-ves", d: "M" + f1(AP[0]) + " " + f1(AP[1]) + " C250 148 280 170 310 200 C335 225 360 250 " + (CX - CR + 4) + " " + CY }, L.ves);
  vesPath.setAttribute("stroke-width", "12");
  const cq = vesTr.at(CLOTU);
  clotEl = mk("circle", { class: "ci-clot", cx: f1(cq.x), cy: f1(cq.y), r: 9 }, L.ves);
  for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.ves); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, u: rnd(0, 1), v: rnd(0.8, 1.2), lane: rnd(-5, 5), rot: rnd(-14, 14) }); }
  /* ---- the watched cell and its machinery ---- */
  haloEl = mk("ellipse", { class: "ci-halo", cx: CX, cy: CY, rx: 125, ry: 115, opacity: "0" }, L.cellg);
  mainCell = cell(L.cellg, { cls: "cellx", r: CR, nuc: 0.34, seed: 4, wob: 0.07 });
  place(mainCell, CX, CY, 0, 1);
  nucRef = mainCell.querySelector(".cl-n");
  necOv = mk("ellipse", { class: "ci-nec", cx: CX, cy: CY, rx: CR * 0.96, ry: CR * 0.92, opacity: "0" }, L.cellg);
  [[-30, -25], [35, -10], [-5, 35]].forEach(([dx, dy], i) => { const g = mk("g", {}, L.cellg); mk("ellipse", { class: "ci-mito-b", rx: 17, ry: 9 }, g); mk("path", { class: "ci-mito-f", d: "M-10 0q5 -5 10 0q5 5 10 0" }, g); mitos.push({ g, x: CX + dx, y: CY + dy, ph: i * 2.2 }); });
  for (let j = 0; j < 6; j++) { const ang = (j / 6) * 6.283 + 0.4, g = mk("g", {}, L.cellg); mk("rect", { class: "ci-pump", x: -5, y: -7, width: 10, height: 14, rx: 3 }, g); mk("circle", { class: "ci-pump-d", cx: 0, cy: -2, r: 2 }, g); pumps.push({ g, ang, x: CX + Math.cos(ang) * CR, y: CY + Math.sin(ang) * CR }); }
  brk = mk("path", { class: "ci-break", d: "M" + BRK[0] + " " + BRK[1] + "l10 8l-8 8l12 8l-9 9", opacity: "0" }, L.cellg);
  /* ---- gauges ---- */
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cell";
  [["atp", "ATP", "g-good", "ATP from oxidative phosphorylation. It powers the ion pumps that keep the cell at its normal volume."], ["sw", "Swelling", "g-bad", "Water follows sodium into the cell when pumps fail, so the cell and its organelles swell."], ["mb", "Membrane", "g-bad", "Damage to the cell membrane. Beyond the point of no return it ruptures and injury is irreversible."], ["lk", "Leak", "g-leak", "Enzymes leaking out through a damaged membrane. In blood tests these show cell death in an organ."], ["ros", "Radicals", "g-ros", "Free radicals: reactive molecules that attack membrane lipids, proteins and DNA. Antioxidants scavenge them."], ["vb", "Viability", "g-good", "Whether the cell can still recover. High in reversible injury, lost once membranes rupture in necrosis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  /* ---- labels: six always on, one per treatment ---- */
  const o = L.over;
  pill(o, "Artery", 300, 190, 300, 118, "A small branch of a coronary artery feeds this patch of heart muscle. A clot narrows it, so less blood gets through.");
  pill(o, "Heart", 150, 255, 110, 405, "Heart muscle. The watched cell is one heart muscle cell in the patch fed by the narrowed branch.");
  pill(o, "Oxygen", 370, 262, 400, 160, "Blood brings oxygen. Mitochondria need it to make ATP, the energy that runs the ion pumps.");
  pill(o, "Mitochondria", CX - 30, CY - 25, 530, 150, "Mitochondria make ATP using oxygen. Without oxygen they stall and ATP falls within a short time.");
  pill(o, "Ion pumps", 410, 343, 300, 410, "Pumps in the membrane use ATP to control salt and water. When ATP falls they fail and water floods in.");
  pill(o, "Membrane", BRK[0], BRK[1], 560, 410, "The cell membrane. Free radicals and calcium damage it. Once it ruptures, enzymes leak out and the cell is dead.");
  const ob = pill(o, "Oxygen back", 315, 205, 210, 90, "Oxygen rich blood returns through the reopened branch. Mitochondria restart and swelling can reverse, but dead cells cannot be revived.");
  ob.setAttribute("id", "pill-oxyback"); ob.style.opacity = "0";
  const ab = pill(o, "Antioxidant", CX - 20, CY + 10, 560, 120, "Antioxidant soaks up free radicals before they chew the membrane. It cannot replace oxygen or restore ATP.");
  ab.setAttribute("id", "pill-antiox"); ab.style.opacity = "0";
  capEl = mk("text", { class: "ci-cap", x: 30, y: 440 }, o); capEl.textContent = capText(0, 0);
  ["nb0", "nb1", "nb2", "nb3"].forEach((id) => { $(id).style.transition = "opacity .4s"; });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 0.7);
  sm.ATP = lerp(sm.ATP, m.ATP, k2); sm.O2 = lerp(sm.O2, m.O2, k1); sm.ROS = lerp(sm.ROS, m.ROS, k2); sm.Pump = lerp(sm.Pump, m.Pump, k2); sm.Swell = lerp(sm.Swell, m.Swell, k2); sm.Memb = lerp(sm.Memb, m.Memb, k2); sm.Leak = lerp(sm.Leak, m.Leak, k2); sm.Viab = lerp(sm.Viab, m.Viab, k2); sm.oxy = lerp(sm.oxy, m.oxy, k1); sm.antiox = lerp(sm.antiox, m.antiox, k1);
  sm.clot = lerp(sm.clot, (6 + 10 * m.a) * (1 - 0.78 * sm.oxy), k1);
  const grow = 1 + sm.Swell * 0.22;
  const flow = clamp(sm.O2 + 0.55 * sm.oxy);
  /* vessel widens and the clot shrinks when oxygen is restored */
  vesPath.setAttribute("stroke-width", f1(8 + 8 * flow));
  vesPath.setAttribute("opacity", (0.45 + 0.55 * clamp(flow + 0.2)).toFixed(2));
  clotEl.setAttribute("r", f1(Math.max(1.5, sm.clot)));
  clotEl.setAttribute("opacity", clamp(sm.clot / 7).toFixed(2));
  haloEl.setAttribute("opacity", (0.3 * sm.oxy).toFixed(2));
  /* red cells flow, queue behind the clot, or vanish downstream when blocked */
  rbcs.forEach((r) => {
    r.u += dt * 0.09 * (0.15 + 0.85 * flow) * r.v;
    if (flow < 0.5 && r.u > CLOTU - 0.04 && r.u < CLOTU + 0.3) r.u = CLOTU - 0.04 - Math.random() * 0.02;
    if (r.u >= 1) r.u -= 1;
    const q = vesTr.at(r.u);
    place(r.g, q.x, q.y + r.lane, r.rot, 1);
    r.g.style.opacity = (r.u > CLOTU + 0.06 && flow < 0.4) ? "0.12" : "1";
  });
  place(mainCell, CX, CY, Math.sin(tm / 2400) * 1.5, grow);
  if (nucRef) nucRef.style.opacity = (1 - sm.Memb * 0.75).toFixed(2);
  necOv.setAttribute("opacity", (sm.Memb * 0.45).toFixed(2)); necOv.setAttribute("rx", f1(CR * 0.96 * grow)); necOv.setAttribute("ry", f1(CR * 0.92 * grow));
  brk.setAttribute("opacity", clamp((sm.Memb - 0.3) * 1.6).toFixed(2));
  mitos.forEach((mt, i) => { place(mt.g, mt.x + Math.sin(tm / 1600 + mt.ph) * 2, mt.y + Math.cos(tm / 1900 + mt.ph) * 2, Math.sin(tm / 2000 + mt.ph) * 8, 0.75 + 0.35 * sm.ATP); mt.g.style.opacity = (0.45 + 0.55 * sm.ATP).toFixed(2); });
  pumps.forEach((pu, j) => { const wob = sm.Pump > 0.35 ? Math.sin(tm / 180 + j * 1.4) * 3 : 0; place(pu.g, CX + Math.cos(pu.ang) * CR * grow, CY + Math.sin(pu.ang) * CR * grow, pu.ang * 57.3 + 90 + wob, 0.8 + 0.3 * sm.Pump); pu.g.style.opacity = (0.35 + 0.65 * sm.Pump).toFixed(2); });
  /* oxygen arrives in the blood, drifts into the cell and is used up */
  acc.oxy += dt * (2 + 6 * sm.O2 + 9 * sm.oxy);
  while (acc.oxy >= 1) { acc.oxy--; const p = freeP(oxyP); if (p) { const q = vesTr.at(rnd(0.6, 0.95)); const dx = CX - q.x, dy = CY - q.y, dd = Math.max(1, Math.hypot(dx, dy)); emit(p, q.x + rnd(-8, 8), q.y + rnd(-8, 8), (dx / dd) * 34 + rnd(-8, 8), (dy / dd) * 34 + rnd(-8, 8), 0); } }
  oxyP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 2.2) / 0.8).toFixed(2)); if (Math.hypot(p.x - CX, p.y - CY) < 52 || p.t > 3) killP(p); });
  acc.water += dt * (1 - sm.Pump) * 8;
  while (acc.water >= 1) { acc.water--; const p = freeP(waterP); if (p) emit(p, CX - CR * grow - 14, CY + rnd(-50, 50), rnd(18, 28), rnd(-4, 4), 0); }
  waterP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > CX - 8 || p.t > 3.4) killP(p); });
  acc.ros += dt * sm.ROS * 9;
  while (acc.ros >= 1) { acc.ros--; const p = freeP(rosP); if (p) { const an = rnd(0, 6.28), rr = rnd(8, 62); emit(p, CX + Math.cos(an) * rr, CY + Math.sin(an) * rr, rnd(-6, 6), rnd(-6, 6), 0); } }
  rosP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, CX - 78, CX + 78); p.y = clamp(p.y, CY - 78, CY + 78); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* antioxidant arrives in the blood, hunts radicals and traps them */
  acc.scav += dt * sm.antiox * 7;
  while (acc.scav >= 1) { acc.scav--; const p = freeP(scavP); if (p) { const q = vesTr.at(rnd(0.8, 1)); const dx = CX - q.x, dy = CY - q.y, dd = Math.max(1, Math.hypot(dx, dy)); emit(p, q.x + rnd(-6, 6), q.y + rnd(-6, 6), (dx / dd) * 26 + rnd(-6, 6), (dy / dd) * 26 + rnd(-6, 6), 0); } }
  scavP.forEach((p) => {
    if (!p.on) return; p.t += dt;
    let best = null, bd = 34;
    rosP.forEach((r) => { if (!r.on) return; const dd = Math.hypot(r.x - p.x, r.y - p.y); if (dd < bd) { bd = dd; best = r; } });
    if (best) { const dd = Math.max(1, bd); p.vx = lerp(p.vx, ((best.x - p.x) / dd) * 44, 0.25); p.vy = lerp(p.vy, ((best.y - p.y) / dd) * 44, 0.25); if (bd < 9) { killP(best); killP(p); return; } }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, CX - 80, CX + 80); p.y = clamp(p.y, CY - 80, CY + 80);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 3) / 1).toFixed(2)); if (p.t > 4) killP(p);
  });
  acc.enz += dt * sm.Leak * 8;
  while (acc.enz >= 1) { acc.enz--; const p = freeP(enzP); if (p) emit(p, BRK[0] + rnd(-4, 4), BRK[1] + rnd(0, 8), rnd(22, 36), rnd(8, 18), 0); }
  enzP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 7) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6 || p.x > 624 || p.y > 432) killP(p); });
  const necOn = clamp((sm.Memb - 0.35) * 1.8);
  ["nb0", "nb1", "nb2", "nb3"].forEach((id) => { $(id).setAttribute("opacity", (0.3 + 0.7 * necOn).toFixed(2)); });
  const ob = $("pill-oxyback"); if (ob) ob.style.opacity = sm.oxy.toFixed(2);
  const ab2 = $("pill-antiox"); if (ab2) ab2.style.opacity = sm.antiox.toFixed(2);
  gg.atp.set(sm.ATP, wordOf(sm.ATP, 0.35, 0.65, ["depleted", "low", "preserved"])); gg.sw.set(sm.Swell, wordOf(sm.Swell, 0.25, 0.55, ["normal", "swollen", "marked"])); gg.mb.set(sm.Memb, wordOf(sm.Memb, 0.25, 0.6, ["intact", "injured", "ruptured"])); gg.lk.set(sm.Leak, wordOf(sm.Leak, 0.25, 0.55, ["none", "some", "marked"])); gg.ros.set(sm.ROS, wordOf(sm.ROS, 0.3, 0.6, ["low", "raised", "high"])); gg.vb.set(sm.Viab, wordOf(sm.Viab, 0.35, 0.65, ["lost", "falling", "preserved"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
