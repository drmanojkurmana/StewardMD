/* Hematoma scene: skull, dura, brain, torn vessels, collections, shift and gauges. */
const L = { head: $("head"), bleed: $("bleed"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CX = 480, CY = 245;
const sm = { C: 0.4, P: 0.3, Sh: 0.2, inj: 0.2, A: 0.8, surg: 0, obs: 0, icpM: 0, k0: 1, k1: 0, k2: 0, atr: 0.12 };
const acc = { blood: 0 };
let extraPath, acutePath, chronicPath, membPath, brainG, midPath, contEl, sahG, flapL, flapR, hernPath, gg = {}, typePills = {}, treatPills = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const blood = pool(26, () => mk("circle", { class: "sc-p p-blood", r: 2.5 }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function crescent(th, squash) {
  let d = "";
  const rxO = 306, ryO = 154, a0 = -72, a1 = 58;
  for (let i = 0; i <= 18; i++) { const a = (a0 + (a1 - a0) * i / 18) * Math.PI / 180; d += (i ? "L" : "M") + f1(CX + rxO * Math.cos(a)) + " " + f1(CY + ryO * Math.sin(a)); }
  for (let i = 18; i >= 0; i--) { const a = (a0 + (a1 - a0) * i / 18) * Math.PI / 180; const taper = Math.sin((i / 18) * Math.PI); const th2 = th * (0.35 + 0.65 * taper) * (squash || 1); d += "L" + f1(CX + (rxO - th2) * Math.cos(a)) + " " + f1(CY + (ryO - th2) * Math.sin(a)); }
  return d + "Z";
}
function membD(th) {
  let d = "";
  const rxO = 306, ryO = 154, a0 = -72, a1 = 58;
  for (let i = 0; i <= 18; i++) { const a = (a0 + (a1 - a0) * i / 18) * Math.PI / 180; const taper = Math.sin((i / 18) * Math.PI); const th2 = th * (0.35 + 0.65 * taper); d += (i ? "L" : "M") + f1(CX + (rxO - th2) * Math.cos(a)) + " " + f1(CY + (ryO - th2) * Math.sin(a)); }
  return d;
}
function init() {
  /* skull, dura and brain */
  mk("ellipse", { class: "hm-skull", cx: CX, cy: CY, rx: 330, ry: 175 }, L.head);
  mk("ellipse", { class: "hm-dura", cx: CX, cy: CY, rx: 308, ry: 156 }, L.head);
  brainG = mk("g", {}, L.head);
  mk("ellipse", { class: "hm-brain", cx: CX, cy: CY, rx: 286, ry: 138 }, brainG);
  const gyri = [[380, 170, 430, 155, 480, 172], [520, 160, 570, 178, 610, 165], [350, 250, 400, 235, 445, 252], [520, 245, 575, 230, 625, 248], [400, 320, 455, 305, 505, 322], [545, 315, 600, 330, 640, 312]];
  gyri.forEach((q) => mk("path", { class: "hm-gyrus", d: "M" + q[0] + " " + q[1] + "Q" + q[2] + " " + q[3] + " " + q[4] + " " + q[5] }, brainG));
  mk("path", { class: "hm-vent", d: "M448 228Q462 218 472 230Q462 244 448 240Z" }, brainG);
  mk("path", { class: "hm-vent", d: "M512 228Q498 218 488 230Q498 244 512 240Z" }, brainG);
  sahG = mk("g", {}, brainG);
  mk("path", { class: "hm-sah", d: "M560 318Q585 306 610 320Q632 332 655 318" }, sahG);
  mk("path", { class: "hm-sah", d: "M330 300Q352 288 376 302" }, sahG);
  contEl = mk("ellipse", { class: "hm-cont", cx: 368, cy: 352, rx: 30, ry: 15 }, brainG);
  /* collections sit between skull and brain */
  extraPath = mk("path", { class: "hm-extra", opacity: "0" }, L.bleed);
  acutePath = mk("path", { class: "hm-acute", opacity: "0" }, L.bleed);
  chronicPath = mk("path", { class: "hm-chronic", opacity: "0" }, L.bleed);
  membPath = mk("path", { class: "hm-memb", opacity: "0" }, L.bleed);
  midPath = mk("path", { class: "hm-mid", d: "M" + CX + " 96V394" }, L.head);
  /* sinus, vessels and fracture */
  mk("ellipse", { class: "hm-sinus", cx: CX, cy: 88, rx: 30, ry: 9 }, L.head);
  mk("path", { class: "hm-vein", d: "M512 96Q528 118 548 138" }, L.head);
  mk("path", { class: "hm-vein", d: "M548 92Q568 112 592 128" }, L.head);
  mk("path", { class: "hm-vein", d: "M448 96Q432 118 414 140" }, L.head);
  mk("path", { class: "hm-art", d: "M214 286Q206 238 218 196M218 226Q232 214 244 218M214 252Q228 246 240 250" }, L.head);
  mk("path", { class: "hm-frac", d: "M168 168L188 186L176 202L196 220" }, L.head);
  hernPath = mk("path", { class: "hm-arrow", d: "M492 282L528 282M520 274L530 282L520 290", opacity: "0" }, L.head);
  /* surgical flaps, hidden until evacuation is chosen */
  flapL = mk("g", { opacity: "0" }, L.head);
  mk("path", { class: "hm-flap", d: "M172 176Q214 148 252 168Q220 184 188 196Z" }, flapL);
  mk("path", { class: "hm-drain", d: "M212 168Q232 138 258 128" }, flapL);
  flapR = mk("g", { opacity: "0" }, L.head);
  mk("path", { class: "hm-flap", d: "M612 108Q664 96 706 126Q660 132 624 128Z" }, flapR);
  mk("path", { class: "hm-drain", d: "M660 108Q676 82 700 72" }, flapR);
  /* labels: pills around the edge, leaders to their parts */
  const O = L.over;
  pill(O, "Skull fracture", 184, 182, 92, 92, "A fracture of the temporal bone. It can tear the artery that runs in a groove on the inner skull.");
  pill(O, "Meningeal artery", 216, 238, 92, 150, "The middle meningeal artery, running under the temporal bone. Arterial bleeding here strips the dura from the skull.");
  typePills.extra = pill(O, "Extradural lens", 228, 245, 92, 268, "Extradural haematoma: a lens or biconvex shape between skull and dura. It is limited where the dura is fixed to the skull.");
  pill(O, "Bridging vein", 532, 104, 660, 70, "Bridging veins cross from the brain surface to the dural sinuses. If torn, venous blood spreads between dura and brain.");
  typePills.sub = pill(O, "Subdural crescent", 642, 132, 830, 108, "Subdural haematoma: a crescent between dura and brain. It spreads widely and can cross suture lines.");
  pill(O, "Dura", 786, 228, 880, 210, "The dura is the tough outer membrane around the brain. Extradural blood sits outside it, subdural blood sits beneath it.");
  pill(O, "Contusion", 368, 352, 270, 408, "A contusion is a bruise of brain tissue after impact, often at the frontal and temporal poles. Underlying injury drives much of the harm in an acute subdural.");
  pill(O, "Herniation risk", 500, 282, 470, 408, "As pressure rises the midline shifts and brain can be forced past the tentorium or through the foramen magnum. This is herniation and it threatens the brainstem.");
  pill(O, "Brain", 480, 244, 600, 408, "Brain tissue inside the rigid skull. There is little room to spare, so a growing collection soon raises pressure.");
  pill(O, "Subarachnoid blood", 600, 322, 750, 408, "Traumatic subarachnoid blood: blood in the grooves on the brain surface after head injury, mixed with the fluid around the brain.");
  treatPills.surg = pill(O, "Surgical evacuation", 232, 160, 330, 70, "Surgical evacuation: opening the skull with a craniotomy or burr holes to remove the collection and stop the bleeding. It directly lowers pressure from the collection.");
  treatPills.icp = pill(O, "ICP measures", 690, 252, 850, 300, "Measures for raised intracranial pressure: nursing head up, sedation, treating fever and seizures, and osmotic treatment as a bridge while the cause is dealt with. The collection itself remains.");
  treatPills.obs = pill(O, "Observation", 620, 196, 850, 360, "Observation: close watching, repeated checks of alertness and pupils and repeat imaging for a selected small collection that is not causing pressure effects.");
  treatPills.surg.style.opacity = 0; treatPills.icp.style.opacity = 0; treatPills.obs.style.opacity = 0;
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["coll", "Collection", "g-coll", "Size of the blood collection inside the skull."], ["press", "Pressure", "g-press", "Intracranial pressure. The skull is a rigid box, so added blood raises pressure."], ["shift", "Shift", "g-shift", "How far the midline is pushed across by the collection."], ["inj", "Brain injury", "g-inj", "Underlying bruising and injury to the brain itself, separate from the collection."], ["alert", "Alertness", "g-alert", "Level of alertness. It falls as pressure rises and the brain is squeezed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 165, y0, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.C = lerp(sm.C, m.C, k2); sm.P = lerp(sm.P, m.P, k2); sm.Sh = lerp(sm.Sh, m.Sh, k2); sm.inj = lerp(sm.inj, m.inj, k2); sm.A = lerp(sm.A, m.A, k2);
  sm.surg = lerp(sm.surg, m.surg, k1); sm.obs = lerp(sm.obs, m.obs, k1); sm.icpM = lerp(sm.icpM, m.icpM, k1);
  const targets = [m.kind === 0 ? 1 : 0, m.kind === 1 ? 1 : 0, m.kind === 2 ? 1 : 0];
  sm.k0 = lerp(sm.k0, targets[0], k1); sm.k1 = lerp(sm.k1, targets[1], k1); sm.k2 = lerp(sm.k2, targets[2], k1);
  sm.atr = lerp(sm.atr, m.atrophy, k1);
  /* extradural lens on the left, thickness grows with the collection */
  const thE = 8 + 46 * sm.C;
  extraPath.setAttribute("d", "M176 188Q" + f1(182 + thE) + " 245 176 302Q" + f1(188 + thE * 0.45) + " 245 176 188Z");
  extraPath.setAttribute("opacity", (sm.k0 * clamp(sm.C * 1.6)).toFixed(2));
  /* subdural crescents on the top and right */
  const thA = 5 + 17 * sm.C, thC = 8 + 28 * sm.C;
  acutePath.setAttribute("d", crescent(thA, 1));
  acutePath.setAttribute("opacity", (sm.k1 * clamp(sm.C * 1.7)).toFixed(2));
  chronicPath.setAttribute("d", crescent(thC, 1));
  chronicPath.setAttribute("opacity", (sm.k2 * clamp(sm.C * 1.5)).toFixed(2));
  membPath.setAttribute("d", membD(thC));
  membPath.setAttribute("opacity", (sm.k2 * 0.8).toFixed(2));
  /* brain: smaller when atrophic, pushed away from the collection */
  const bScale = 1 - 0.1 * sm.atr;
  const dx = (sm.k0 * 1 - (sm.k1 + sm.k2) * 0.8) * sm.Sh * 22;
  brainG.setAttribute("transform", "translate(" + f1(dx) + " 0) scale(1 1)");
  brainG.style.opacity = 1;
  const brainEll = brainG.querySelector(".hm-brain");
  if (brainEll) { brainEll.setAttribute("rx", f1(286 * bScale)); brainEll.setAttribute("ry", f1(138 * (1 - 0.07 * sm.atr))); }
  midPath.setAttribute("d", "M" + f1(CX + dx) + " 96L" + f1(CX + dx * 0.4) + " 394");
  contEl.setAttribute("opacity", clamp(sm.inj * 1.3).toFixed(2));
  sahG.setAttribute("opacity", clamp(sm.inj * 1.1).toFixed(2));
  hernPath.setAttribute("opacity", clamp((sm.Sh - 0.25) * 1.6).toFixed(2));
  hernPath.setAttribute("d", "M" + f1(CX + dx + 12) + " 282L" + f1(CX + dx + 48) + " 282M" + f1(CX + dx + 40) + " 274L" + f1(CX + dx + 50) + " 282L" + f1(CX + dx + 40) + " 290");
  flapL.setAttribute("opacity", (sm.surg * sm.k0).toFixed(2));
  flapR.setAttribute("opacity", (sm.surg * (sm.k1 + sm.k2)).toFixed(2));
  typePills.extra.style.opacity = clamp(sm.k0 * 1.4).toFixed(2);
  typePills.sub.style.opacity = clamp((sm.k1 + sm.k2) * 1.4).toFixed(2);
  treatPills.surg.style.opacity = sm.surg.toFixed(2);
  treatPills.icp.style.opacity = sm.icpM.toFixed(2);
  treatPills.obs.style.opacity = sm.obs.toFixed(2);
  /* blood particles leak from the torn vessel toward the collection */
  const leak = sm.C * (1 - 0.75 * sm.surg) * (sm.k0 + sm.k1 + sm.k2);
  acc.blood += dt * leak * 7;
  while (acc.blood >= 1) { acc.blood--; const p = free(blood); if (p) { if (sm.k0 > 0.5) emit(p, 216, rnd(205, 265), rnd(4, 14), rnd(-6, 6), 0); else emit(p, rnd(520, 575), rnd(98, 122), rnd(18, 32), rnd(8, 18), 1); } }
  blood.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k === 0 ? 215 : 640, ty = p.k === 0 ? 245 : 150; p.x += (tx - p.x) * dt * 0.9 + p.vx * dt; p.y += (ty - p.y) * dt * 0.9 + p.vy * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 56, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1.1 - p.t / 2.8).toFixed(2)); if (p.t > 2.8) kill(p); });
  /* gauges */
  gg.coll.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["small", "moderate", "large"]));
  gg.press.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.shift.set(sm.Sh, wordOf(sm.Sh, 0.25, 0.55, ["none", "mild", "marked"]));
  gg.inj.set(sm.inj, wordOf(sm.inj, 0.3, 0.6, ["little", "some", "marked"]));
  gg.alert.set(sm.A, wordOf(sm.A, 0.35, 0.65, ["low", "reduced", "preserved"]));
}
run({ init, step });
