/* Mitral regurgitation scene: a real heart and lung with a cutaway left heart, an incompetent mitral valve, systolic backflow into the atrium, forward flow to a widening aorta, draining lung fluid, and the gauges. Read left to right: lungs, atrium, valve, ventricle, aorta. */
const HX = 330, HY = 270, HW = 300, LX = 128, LY = 148, LW = 128;
const VX = 330, VY = 258, LAX = 330, LAY = 185, LVX = 330, LVY = 350;
const L = { lslot: $("lungSlot"), slot: $("heartSlot"), heart: $("heart"), valve: $("valve"), vessel: $("vessel"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { R: 0.6, F: 0.6, LApres: 0.5, Pulm: 0.4, Mur: 0.6, LAvol: 0.5, LVvol: 0.55, Dys: 0.25, BP: 0.7, vaso: 0, repair: 0, repl: 0 };
let heartO = null, lungO = null, beat = 0;
let wall = null, cav = null, la = null, wave = null, papL = null, papR = null, chordL = null, chordR = null;
let leafL = null, leafR = null, annLine = null, ring = null, prost = null, discA = null, discB = null;
let veinEl = null, aortaEl = null, congA = null, congB = null;
let trFwd = null, trBack = null, trRet = null, trVein = null;
let capEl = null, capKey = "", vasoPill = null, repairPill = null, replPill = null;
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, ri: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function flowPool(n, cls, r) { return Array.from({ length: n }, (_, i) => { const e = mk("circle", { class: cls, r, opacity: 0 }, L.parts); return { e, u: i / n, off: rnd(-5, 5) }; }); }
const jetsF = flowPool(14, "mre-jetF", 2.5), jetsB = flowPool(16, "mre-jetB", 2.4), jetsI = flowPool(10, "mre-jetI", 2.3), veinP = flowPool(8, "mre-jetI", 2.2);
const drugs = pool(8, () => mk("circle", { class: "sc-p mre-drug", r: 3 }, L.parts));
const drops = pool(6, () => mk("circle", { class: "mre-drop", r: 2.6 }, L.parts));
const recPos = [[640, 164], [672, 190], [704, 164], [736, 190], [768, 164], [800, 190]];
const used = [null, null, null, null, null, null];
const recs = [];
function capText(d, l) {
  if (d === 1) return "Vasodilator and diuretic. Vessels widen so more blood flows forward, and lung fluid drains. The valve still leaks.";
  if (d === 2) return "Valve repair. A ring cinches the opening and the flaps meet again, so the leak nearly stops.";
  if (d === 3) return "Valve replacement. A new valve stops the leak, and the swollen chambers shrink back.";
  if (l === 2) return "No treatment. Each beat leaks back, the chambers swell, and the lungs fill with fluid.";
  if (l === 1) return "No treatment. The leak swells both chambers and pressure backs up into the lungs.";
  return "No treatment. The leak is small and the heart still copes.";
}
function initOrgans() {
  lungO = organ(L.lslot, "lung", LX, LY, LW, {});
  heartO = organ(L.slot, "heart", HX, HY, HW, {});
  const li = lungO.ports.in || [LX - 50, LY], AP = heartO.ports.aorta;
  const midx = (li[0] + 232) / 2, midy = (li[1] + LAY) / 2 - 24;
  trVein = track([li, [midx, midy], [232, LAY]]);
  veinEl.setAttribute("d", "M" + f1(li[0]) + " " + f1(li[1]) + " C" + f1(midx - 30) + " " + f1(midy + 20) + " " + f1(midx + 30) + " " + f1(midy - 10) + " 232 " + LAY);
  trFwd = track([[LVX + 45, LVY - 55], [AP[0] - 40, AP[1] + 50], AP, [AP[0] + 90, AP[1] - 25], [620, 172], [760, 178], [880, 182]]);
  aortaEl.setAttribute("d", "M" + f1(AP[0]) + " " + f1(AP[1]) + " C" + f1(AP[0] + 60) + " " + f1(AP[1] - 30) + " 480 150 620 172 S760 184 880 182");
  congA.setAttribute("cx", f1(lungO.x)); congA.setAttribute("cy", f1(lungO.y + 12));
  congB.setAttribute("cx", f1(lungO.x + 8)); congB.setAttribute("cy", f1(lungO.y + 26));
  drops.forEach((p, i) => { p.x = lungO.x - 36 + i * 14; p.y = lungO.y + 42; });
}
function init() {
  const g = L.heart;
  la = mk("ellipse", { class: "mre-atrium", cx: LAX, cy: LAY }, g);
  wave = mk("path", { class: "mre-wave" }, g);
  wall = mk("ellipse", { class: "mre-wall", cx: LVX, cy: LVY }, g);
  cav = mk("ellipse", { class: "mre-chamber", cx: LVX, cy: LVY }, g);
  papL = mk("ellipse", { class: "mre-pap", rx: 13, ry: 17 }, g);
  papR = mk("ellipse", { class: "mre-pap", rx: 13, ry: 17 }, g);
  chordL = mk("path", { class: "mre-chord" }, g); chordR = mk("path", { class: "mre-chord" }, g);
  leafL = mk("path", { class: "mre-leaf" }, L.valve); leafR = mk("path", { class: "mre-leaf" }, L.valve);
  annLine = mk("path", { class: "mre-chord" }, L.valve);
  ring = mk("ellipse", { class: "mre-ring", cx: VX, cy: VY, ry: 9, opacity: 0 }, L.valve);
  prost = mk("g", { opacity: 0 }, L.valve);
  mk("ellipse", { class: "mre-prost", cx: VX, cy: VY, rx: 30, ry: 11 }, prost);
  discA = mk("path", { class: "mre-disc" }, prost); discB = mk("path", { class: "mre-disc" }, prost);
  const v = L.vessel;
  veinEl = mk("path", { class: "mre-vein", d: "M80 148L232 185" }, v);
  aortaEl = mk("path", { class: "mre-aorta", d: "M360 200C480 150 620 172 880 182" }, v);
  recPos.forEach(([x, y]) => recs.push(mk("circle", { class: "mre-rec", cx: x, cy: y, r: 3, opacity: "0.3" }, v)));
  congA = mk("ellipse", { class: "mre-cong", cx: LX, cy: LY + 12, rx: 52, ry: 34, opacity: "0" }, v);
  congB = mk("ellipse", { class: "mre-cong", cx: LX + 8, cy: LY + 26, rx: 36, ry: 22, opacity: "0" }, v);
  trBack = track([[VX, VY - 6], [VX - 8, VY - 38], [VX + 6, VY - 58]]);
  trRet = track([[LAX, LAY + 48], [VX, VY], [LVX, LVY - 58]]);
  initOrgans();
  initLabels(); initPanel();
}
function initLabels() {
  const o = L.over;
  pill(o, "Lungs", 100, 140, 100, 70, "Lungs: high pressure from the failing left heart backs up through the veins, and fluid gathers. It clears when the leak is fixed.");
  pill(o, "Left atrium", 250, 172, 250, 70, "Left atrium: it takes lung blood plus the leak jet each systole, so it swells and its pressure rises.");
  pill(o, "Leaky valve", VX, VY, 470, 70, "Mitral valve: two flaps that should seal in systole. A gap stays open, so blood jets back. Papillary muscles and cords hold the flaps.");
  pill(o, "Aorta", 700, 178, 700, 70, "Aorta: the forward road. A vasodilator widens it, so more of each beat flows forward and less leaks back.");
  pill(o, "Left ventricle", 248, 352, 132, 398, "Left ventricle: it swells with the blood returning from the atrium. Its total beat looks big, but the forward share falls.");
  vasoPill = pill(o, "Wide vessels", 720, 180, 848, 250, "Vasodilator and diuretic: drug dots sit on vessel walls and widen them, while lung fluid drains away. The valve itself is unchanged.");
  vasoPill.style.opacity = "0";
  repairPill = pill(o, "Repair ring", VX, VY, 540, 332, "Repair: a ring cinches the stretched opening so the patient's own flaps meet again.");
  repairPill.style.opacity = "0";
  replPill = pill(o, "New valve", VX, VY, 540, 332, "Replacement: a new valve takes the leaking valve's place, so the leak stops.");
  replPill.style.opacity = "0";
  capEl = mk("text", { class: "mre-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, 1);
}
function initPanel() {
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["back", "Backflow", "g-bad", "How much blood leaks back into the atrium each systole. It grows with the size of the regurgitant orifice."], ["fwd", "Forward flow", "g-good", "The share of each beat that reaches the aorta and the body. It falls as the leak grows."], ["lap", "LA pressure", "g-cyt", "Pressure in the left atrium, with a prominent systolic v wave from the arriving jet."], ["lvv", "LV volume", "g-eos", "How dilated the ventricle is under the returning extra volume."], ["lung", "Lungs", "g-fl", "Pulmonary venous congestion: pressure passed back to the lungs, with edema in severe disease."], ["mur", "Murmur", "g-clot", "The holosystolic murmur at the apex, filling systole from the first to the second heart sound."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, y0, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["R", "F", "LApres", "Mur", "BP"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["Pulm", "LAvol", "LVvol", "Dys"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  sm.vaso = lerp(sm.vaso, m.vaso, k1); sm.repair = lerp(sm.repair, m.eff > 0.1 && m.eff <= 0.25 ? 1 : 0, k1); sm.repl = lerp(sm.repl, m.eff <= 0.1 ? 1 : 0, k1);
  /* heartbeat: systole first, then filling */
  beat += dt * (0.8 + 0.4 * (1 - sm.F)); const ph = beat % 1;
  const sys = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
  const dia = ph > 0.44 && ph < 0.88 ? Math.sin(Math.PI * (ph - 0.44) / 0.44) : 0;
  /* chambers: atrium and ventricle swell with volume overload; ventricle squeezes in systole */
  const ef = 0.05 + 0.15 * (1 - 0.4 * sm.Dys);
  const laRx = 86 + 34 * sm.LAvol, laRy = (42 + 13 * sm.LAvol) * (1 + 0.05 * sys * sm.LApres);
  la.setAttribute("rx", f1(laRx)); la.setAttribute("ry", f1(laRy));
  const lvRx0 = 92 + 28 * sm.LVvol, lvRy0 = 60 + 12 * sm.LVvol;
  const lvRx = lvRx0 * (1 - ef * sys), lvRy = lvRy0 * (1 - ef * 0.8 * sys);
  cav.setAttribute("rx", f1(lvRx)); cav.setAttribute("ry", f1(lvRy));
  wall.setAttribute("rx", f1(lvRx + 10)); wall.setAttribute("ry", f1(lvRy + 10));
  wall.setAttribute("stroke-width", f1(8));
  /* lung congestion haze and the vein feeding the atrium */
  congA.setAttribute("opacity", (sm.Pulm * 0.8).toFixed(2)); congB.setAttribute("opacity", (sm.Pulm * 0.85).toFixed(2));
  congA.setAttribute("rx", f1(40 + 22 * sm.Pulm)); congB.setAttribute("rx", f1(28 + 14 * sm.Pulm));
  veinEl.setAttribute("stroke-width", f1(8 + 6 * sm.Pulm));
  veinEl.setAttribute("opacity", (0.4 + 0.5 * sm.Pulm).toFixed(2));
  /* aorta: the vasodilator visibly widens it; forward flow keeps it lit */
  aortaEl.style.strokeWidth = f1(20 + 10 * sm.vaso);
  aortaEl.setAttribute("opacity", (0.3 + 0.35 * sm.BP).toFixed(2));
  /* atrial pressure wave: a prominent v wave lands in systole */
  let wd = ""; for (let x = 252; x <= 408; x += 13) { const u = (x - LAX) / 34, bump = 18 * sm.LApres * sys * Math.exp(-u * u), y = 158 - bump - 2 * Math.sin(tm / 500 + x); wd += (x === 252 ? "M" : "L") + x + " " + f1(y); }
  wave.setAttribute("d", wd); wave.setAttribute("opacity", (0.25 + 0.75 * sm.LApres).toFixed(2));
  /* valve: leaflets meet in diastole, leave a gap in systole; annulus widens with dilatation */
  const ann = 58 + 18 * sm.LVvol * (1 - 0.35 * sm.repair) * (1 - 0.2 * sm.repl);
  const meet = lerp(17, 1.5 + 13 * sm.R, sys), tipY = lerp(VY + 30, VY - 2, sys);
  const tLx = VX - meet, tRx = VX + meet, prol = 7 * sys * (1 - sm.repair) * (1 - sm.repl);
  leafL.setAttribute("d", "M" + f1(VX - ann) + " " + VY + "Q" + f1(VX - ann * 0.55) + " " + f1(VY + 16) + " " + f1(tLx) + " " + f1(tipY - prol));
  leafR.setAttribute("d", "M" + f1(VX + ann) + " " + VY + "Q" + f1(VX + ann * 0.55) + " " + f1(VY + 16) + " " + f1(tRx) + " " + f1(tipY));
  leafL.style.opacity = (1 - sm.repl).toFixed(2); leafR.style.opacity = (1 - sm.repl).toFixed(2);
  annLine.setAttribute("d", "M" + f1(VX - ann) + " " + VY + "H" + f1(VX + ann)); annLine.setAttribute("opacity", (0.35 + 0.4 * sm.LVvol).toFixed(2));
  const ppx = 46 + 16 * sm.LVvol, ppy = VY + 92 + 6 * sm.LVvol;
  papL.setAttribute("cx", f1(VX - ppx)); papL.setAttribute("cy", f1(ppy)); papR.setAttribute("cx", f1(VX + ppx)); papR.setAttribute("cy", f1(ppy));
  chordL.setAttribute("d", "M" + f1(tLx) + " " + f1(tipY) + "L" + f1(VX - ppx) + " " + f1(ppy - 10)); chordR.setAttribute("d", "M" + f1(tRx) + " " + f1(tipY) + "L" + f1(VX + ppx) + " " + f1(ppy - 10));
  chordL.style.opacity = (1 - sm.repl).toFixed(2); chordR.style.opacity = (1 - sm.repl).toFixed(2);
  papL.style.opacity = (1 - sm.repl).toFixed(2); papR.style.opacity = (1 - sm.repl).toFixed(2);
  ring.setAttribute("rx", f1(ann)); ring.setAttribute("opacity", sm.repair.toFixed(2));
  prost.setAttribute("opacity", sm.repl.toFixed(2));
  const tilt = 5 + 9 * sys;
  discA.setAttribute("d", "M" + (VX - 24) + " " + VY + "L" + (VX - 1) + " " + f1(VY - tilt * 0.4)); discB.setAttribute("d", "M" + (VX + 24) + " " + VY + "L" + (VX + 1) + " " + f1(VY - tilt * 0.4));
  /* jets: forward to the aorta, backward into the atrium, the diastolic return, and lung inflow */
  jetsF.forEach((p) => { p.u = (p.u + dt * (0.35 + 0.4 * sm.F)) % 1; const q = trFwd.at(p.u); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (sys * clamp(0.1 + 0.9 * sm.F) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  jetsB.forEach((p) => { p.u = (p.u + dt * (0.4 + 0.55 * sm.R)) % 1; const q = trBack.at(p.u); p.e.setAttribute("cx", f1(q.x + p.off * (0.4 + p.u * 1.6))); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (sys * clamp(sm.R * 1.25) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  jetsI.forEach((p) => { p.u = (p.u + dt * 0.4) % 1; const q = trRet.at(p.u); p.e.setAttribute("cx", f1(q.x + p.off)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (dia * clamp(0.25 + 0.55 * sm.LVvol) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  veinP.forEach((p) => { p.u = (p.u + dt * 0.25) % 1; const q = trVein.at(p.u); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", ((0.3 + 0.4 * sm.Pulm) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  /* vasodilator dots fly in and sit on the aorta wall receptors, which light up */
  recs.forEach((r, i) => r.setAttribute("opacity", (0.3 + 0.7 * sm.vaso).toFixed(2)));
  if (sm.vaso > 0.5 && Math.random() < dt * 6) { const p = free(drugs); if (p) { const i = drugs.indexOf(p) % 6; emit(p, recPos[i][0] + rnd(-40, 40), 108, 0, 0, 0); p.ri = i; } }
  drugs.forEach((p) => { if (!p.on) return;
    const r = recPos[p.ri];
    if (used[p.ri] !== p && used[p.ri]) { kill(p); return; }
    if (sm.vaso < 0.4) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) { used[p.ri] = null; kill(p); } return; }
    if (p.st === 0) { p.x += (r[0] - p.x) * Math.min(1, dt * 3); p.y += (r[1] - p.y) * Math.min(1, dt * 3);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (Math.hypot(r[0] - p.x, r[1] - p.y) < 3) { p.st = 1; p.t = 0; used[p.ri] = p; } }
    else { p.x = r[0]; p.y = r[1]; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); } });
  /* diuretic: lung fluid drops drain away while treatment runs */
  drops.forEach((p) => { if (sm.vaso < 0.05) { p.e.setAttribute("opacity", "0"); return; }
    p.t += dt * (0.4 + 0.6 * sm.vaso); const f = (p.t * 60) % 80;
    p.e.setAttribute("cx", f1(p.x)); p.e.setAttribute("cy", f1(p.y + f));
    p.e.setAttribute("opacity", (sm.vaso * 0.9 * Math.sin(Math.PI * f / 80)).toFixed(2)); });
  /* treatment pills and caption follow the state */
  vasoPill.style.opacity = sm.vaso.toFixed(2); repairPill.style.opacity = sm.repair.toFixed(2); replPill.style.opacity = sm.repl.toFixed(2);
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  /* gauges */
  gg.back.set(sm.R, wordOf(sm.R, 0.4, 0.7, ["mild", "moderate", "severe"])); gg.fwd.set(sm.F, wordOf(sm.F, 0.45, 0.72, ["reduced", "borderline", "maintained"]));
  gg.lap.set(sm.LApres, wordOf(sm.LApres, 0.35, 0.62, ["normal", "raised", "high"])); gg.lvv.set(sm.LVvol, wordOf(sm.LVvol, 0.42, 0.65, ["normal", "dilated", "very dilated"]));
  gg.lung.set(sm.Pulm, wordOf(sm.Pulm, 0.32, 0.62, ["clear", "congested", "oedematous"])); gg.mur.set(sm.Mur, wordOf(sm.Mur, 0.35, 0.65, ["soft", "clear", "loud"]));
}
run({ init, step });
