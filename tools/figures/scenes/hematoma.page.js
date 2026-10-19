/* Hematoma scene: real brain organ, torn vessels, collections, shift and gauges. */
const L = { head: $("head"), bleed: $("bleed"), parts: $("parts"), over: $("over"), panel: $("panel") };
const CX = 480, CY = 245;
const sm = { C: 0.4, P: 0.3, Sh: 0.2, inj: 0.2, A: 0.8, surg: 0, obs: 0, icpM: 0, k0: 1, k1: 0, k2: 0 };
const acc = { blood: 0, drain: 0, out: 0 };
let extraPath, acutePath, chronicPath, membPath, brainMove, brainO, contEl, sahG, flapL, flapR, bagFillL, bagFillR;
let hernPath, glowEl, wedgeEl, capEl, capDrug = -1;
let gg = {}, typePills = {}, treatPills = {};
let veinTear = [395, 140], drainTrL = null, drainTrR = null, outTr = null;
const pulses = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tr: null, u: 0 }; }); }
const blood = pool(26, () => mk("circle", { class: "sc-p p-blood", r: 2.5 }, L.parts));
const drainP = pool(14, () => mk("circle", { class: "sc-p p-blood", r: 2.8 }, L.parts));
const outP = pool(10, () => mk("circle", { class: "sc-p p-out", r: 2.5 }, L.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.tr = null; p.u = 0; p.e.setAttribute("opacity", "1"); }
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
function capText(d) {
  if (d === 1) return "Observation. Close checks and repeat scans while a small clot is watched.";
  if (d === 2) return "Pressure measures ease pressure but the clot itself stays.";
  if (d === 3) return "Surgical evacuation removes the clot. Pressure falls and the brain moves back.";
  return "No treatment. Blood collects, pressure rises and the brain is pushed across.";
}
function init() {
  /* pressure glow behind everything in the head */
  glowEl = mk("ellipse", { class: "hm-glow", cx: CX, cy: CY, rx: 300, ry: 160, opacity: "0" }, L.head);
  /* skull and dura stay procedural; the brain is real organ art */
  mk("ellipse", { class: "hm-skull", cx: CX, cy: CY, rx: 330, ry: 175 }, L.head);
  mk("ellipse", { class: "hm-dura", cx: CX, cy: CY, rx: 308, ry: 156 }, L.head);
  brainMove = mk("g", {}, L.head);
  const slot = mk("g", { id: "brainSlot" }, brainMove);
  brainO = organ(slot, "brain", CX, CY, 380, {});
  const BP = brainO.ports;
  mk("path", { class: "hm-mid", d: "M" + CX + " 100L" + CX + " 390" }, brainMove);
  contEl = mk("ellipse", { class: "hm-cont", cx: f1(BP.frontal[0]), cy: f1(BP.frontal[1] + 34), rx: 26, ry: 13 }, brainMove);
  sahG = mk("g", {}, brainMove);
  const px = BP.parenchyma[0], py = BP.parenchyma[1], fx = BP.frontal[0], fy = BP.frontal[1];
  mk("path", { class: "hm-sah", d: "M" + f1(px - 70) + " " + f1(py - 72) + "Q" + f1(px - 48) + " " + f1(py - 84) + " " + f1(px - 28) + " " + f1(py - 72) + "Q" + f1(px - 6) + " " + f1(py - 60) + " " + f1(px + 16) + " " + f1(py - 72) }, sahG);
  mk("path", { class: "hm-sah", d: "M" + f1(fx - 32) + " " + f1(fy - 62) + "Q" + f1(fx - 12) + " " + f1(fy - 72) + " " + f1(fx + 10) + " " + f1(fy - 62) }, sahG);
  /* sinus, bridging veins anchored on the organ ports, fracture and artery */
  mk("ellipse", { class: "hm-sinus", cx: CX, cy: 88, rx: 30, ry: 9 }, L.head);
  mk("path", { class: "hm-vein", d: "M470 94Q440 130 " + f1(fx) + " " + f1(fy) }, L.head);
  mk("path", { class: "hm-vein", d: "M502 92Q492 128 " + f1(px) + " " + f1(py - 62) }, L.head);
  mk("path", { class: "hm-vein", d: "M560 96Q572 122 592 142" }, L.head);
  veinTear = [Math.round((470 + fx) / 2), 132];
  mk("path", { class: "hm-art", d: "M214 286Q206 238 218 196M218 226Q232 214 244 218M214 252Q228 246 240 250" }, L.head);
  mk("path", { class: "hm-frac", d: "M168 168L188 186L176 202L196 220" }, L.head);
  hernPath = mk("path", { class: "hm-arrow", d: "M492 282L528 282M520 274L530 282L520 290", opacity: "0" }, L.head);
  /* head up wedge for pressure measures, hidden until chosen */
  wedgeEl = mk("path", { class: "hm-wedge", d: "M600 432L860 432L860 386Z", opacity: "0" }, L.head);
  /* surgical flaps, tubes and drain bags, hidden until evacuation is chosen */
  flapL = mk("g", { opacity: "0" }, L.head);
  mk("path", { class: "hm-flap", d: "M150 170Q200 140 250 162Q215 182 168 196Z" }, flapL);
  mk("path", { class: "hm-drain", d: "M225 185Q170 175 120 160" }, flapL);
  mk("rect", { class: "hm-flap", x: 84, y: 134, width: 62, height: 48, rx: 9 }, flapL);
  bagFillL = mk("rect", { class: "hm-extra", x: 89, y: 173, width: 52, height: 4 }, flapL);
  flapR = mk("g", { opacity: "0" }, L.head);
  mk("path", { class: "hm-flap", d: "M630 122Q680 108 720 132Q680 140 640 134Z" }, flapR);
  mk("path", { class: "hm-drain", d: "M695 130Q760 134 822 168" }, flapR);
  mk("rect", { class: "hm-flap", x: 818, y: 150, width: 62, height: 48, rx: 9 }, flapR);
  bagFillR = mk("rect", { class: "hm-extra", x: 823, y: 189, width: 52, height: 4 }, flapR);
  /* collections sit between skull and brain */
  extraPath = mk("path", { class: "hm-extra", opacity: "0" }, L.bleed);
  acutePath = mk("path", { class: "hm-acute", opacity: "0" }, L.bleed);
  chronicPath = mk("path", { class: "hm-chronic", opacity: "0" }, L.bleed);
  membPath = mk("path", { class: "hm-memb", opacity: "0" }, L.bleed);
  /* drain and outflow tracks from real anatomy */
  drainTrL = track([[205, 245], [160, 205], [118, 168]]);
  drainTrR = track([[700, 170], [768, 146], [824, 172]]);
  outTr = track([BP.stem, [540, 404], [562, 426]]);
  /* repeat scan pulses for observation */
  for (let i = 0; i < 2; i++) pulses.push(mk("circle", { class: "hm-pulse", r: 12, opacity: "0" }, L.bleed));
  /* labels: six pills at most on screen at once, leaders to their parts */
  const O = L.over;
  pill(O, "Skull break", 182, 186, 100, 88, "A break in the skull bone. Under it runs an artery that can tear and bleed.");
  pill(O, "Torn artery", 216, 240, 100, 300, "A meningeal artery torn by the break. Fast arterial bleeding lifts the covering and forms a lens clot.");
  typePills.extra = pill(O, "Lens clot", 205, 245, 100, 358, "An extradural clot: lens shaped blood between skull and covering, after a blow to the side of the head.");
  pill(O, "Torn vein", 572, 120, 668, 62, "A bridging vein torn as the brain shakes. Slow venous blood spreads as a wide crescent.");
  typePills.sub = pill(O, "Crescent clot", 740, 195, 832, 108, "A subdural clot: crescent shaped blood under the covering. It can cross the skull join lines.");
  pill(O, "Brain", Math.round(px), Math.round(py), 600, 408, "The brain is squeezed. The middle line shifts across and alertness falls as pressure rises.");
  treatPills.obs = pill(O, "Watched closely", 640, 175, 800, 360, "Watching means repeated checks and scans. Only small clots without pressure effects are watched.");
  treatPills.icp = pill(O, "Pressure eased", 600, 380, 800, 300, "Nursing head up and calming the brain ease pressure as a bridge. The clot itself stays.");
  treatPills.surg = pill(O, "Drain out", 225, 185, 330, 70, "Surgical evacuation opens the skull and sucks the clot out through a drain. Pressure falls fast.");
  treatPills.surg.style.opacity = 0; treatPills.icp.style.opacity = 0; treatPills.obs.style.opacity = 0;
  capEl = mk("text", { class: "hm-cap", x: 30, y: 428 }, O); capEl.textContent = capText(0);
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["coll", "Collection", "g-coll", "Size of the blood collection inside the skull."], ["press", "Pressure", "g-press", "Pressure inside the skull. The skull is a rigid box, so added blood raises pressure."], ["shift", "Shift", "g-shift", "How far the middle line is pushed across by the collection."], ["inj", "Brain injury", "g-inj", "Bruising of the brain itself, separate from the collection."], ["alert", "Alertness", "g-alert", "Level of alertness. It falls as pressure rises and the brain is squeezed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 165, y0, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.C = lerp(sm.C, m.C, k2); sm.P = lerp(sm.P, m.P, k2); sm.Sh = lerp(sm.Sh, m.Sh, k2); sm.inj = lerp(sm.inj, m.inj, k2); sm.A = lerp(sm.A, m.A, k2);
  sm.surg = lerp(sm.surg, m.surg, k1); sm.obs = lerp(sm.obs, m.obs, k1); sm.icpM = lerp(sm.icpM, m.icpM, k1);
  const targets = [m.kind === 0 ? 1 : 0, m.kind === 1 ? 1 : 0, m.kind === 2 ? 1 : 0];
  sm.k0 = lerp(sm.k0, targets[0], k1); sm.k1 = lerp(sm.k1, targets[1], k1); sm.k2 = lerp(sm.k2, targets[2], k1);
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
  /* pressure glow and brain shift carry the at a glance change */
  glowEl.setAttribute("opacity", (sm.P * 0.4).toFixed(2));
  const dx = (sm.k0 * 1 - (sm.k1 + sm.k2) * 0.8) * sm.Sh * 22;
  brainMove.setAttribute("transform", "translate(" + f1(dx) + " 0)");
  contEl.setAttribute("opacity", clamp(sm.inj * 1.3).toFixed(2));
  sahG.setAttribute("opacity", clamp(sm.inj * 1.1).toFixed(2));
  hernPath.setAttribute("opacity", clamp((sm.Sh - 0.25) * 1.6).toFixed(2));
  hernPath.setAttribute("d", "M" + f1(CX + dx + 12) + " 282L" + f1(CX + dx + 48) + " 282M" + f1(CX + dx + 40) + " 274L" + f1(CX + dx + 50) + " 282L" + f1(CX + dx + 40) + " 290");
  /* surgery opens the flap and fills the drain bag; head up wedge for pressure measures */
  flapL.setAttribute("opacity", (sm.surg * sm.k0).toFixed(2));
  flapR.setAttribute("opacity", (sm.surg * (sm.k1 + sm.k2)).toFixed(2));
  wedgeEl.setAttribute("opacity", sm.icpM.toFixed(2));
  const fillH = 4 + 30 * sm.surg;
  bagFillL.setAttribute("y", f1(177 - fillH)); bagFillL.setAttribute("height", f1(fillH));
  bagFillR.setAttribute("y", f1(193 - fillH)); bagFillR.setAttribute("height", f1(fillH));
  typePills.extra.style.opacity = clamp(sm.k0 * 1.4).toFixed(2);
  typePills.sub.style.opacity = clamp((sm.k1 + sm.k2) * 1.4).toFixed(2);
  treatPills.surg.style.opacity = sm.surg.toFixed(2);
  treatPills.icp.style.opacity = sm.icpM.toFixed(2);
  treatPills.obs.style.opacity = sm.obs.toFixed(2);
  /* repeat scan pulses sweep the watched collection */
  const pcx = sm.k0 > 0.5 ? 205 : 640, pcy = sm.k0 > 0.5 ? 245 : 175;
  pulses.forEach((c, i) => { const ph = ((tm / 2400) + i * 0.5) % 1; c.setAttribute("cx", pcx); c.setAttribute("cy", pcy); c.setAttribute("r", f1(12 + 48 * ph)); c.setAttribute("opacity", (sm.obs * 0.55 * (1 - ph)).toFixed(2)); });
  /* blood particles leak from the torn vessel toward the collection */
  const leak = sm.C * (1 - 0.75 * sm.surg) * (sm.k0 + sm.k1 + sm.k2);
  acc.blood += dt * leak * 7;
  while (acc.blood >= 1) { acc.blood--; const p = free(blood); if (p) { if (sm.k0 > 0.5) emit(p, 216, rnd(205, 265), rnd(4, 14), rnd(-6, 6), 0); else emit(p, veinTear[0] + rnd(-20, 20), veinTear[1] + rnd(-10, 10), rnd(10, 22), rnd(4, 12), 1); } }
  blood.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k === 0 ? 205 : 640, ty = p.k === 0 ? 245 : 170; p.x += (tx - p.x) * dt * 0.9 + p.vx * dt; p.y += (ty - p.y) * dt * 0.9 + p.vy * dt; p.x = clamp(p.x, 30, 930); p.y = clamp(p.y, 56, 430); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1.1 - p.t / 2.8).toFixed(2)); if (p.t > 2.8) kill(p); });
  /* drain particles suck the clot out to the bag while evacuation runs */
  acc.drain += dt * sm.surg * 9;
  while (acc.drain >= 1) { acc.drain--; const p = free(drainP); if (p) { p.on = true; p.tr = sm.k0 > 0.5 ? drainTrL : drainTrR; p.u = 0; p.t = 0; p.e.setAttribute("opacity", "1"); } }
  drainP.forEach((p) => { if (!p.on) return; p.u += dt * 88 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (1 - p.u * 0.3).toFixed(2)); if (p.u >= 1) kill(p); });
  /* outflow particles leave the head while pressure measures run */
  acc.out += dt * sm.icpM * 7;
  while (acc.out >= 1) { acc.out--; const p = free(outP); if (p) { p.on = true; p.tr = outTr; p.u = 0; p.t = 0; p.e.setAttribute("opacity", "1"); } }
  outP.forEach((p) => { if (!p.on) return; p.u += dt * 70 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", (0.9 * (1 - p.u)).toFixed(2)); if (p.u >= 1) kill(p); });
  /* gauges */
  gg.coll.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["small", "moderate", "large"]));
  gg.press.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.shift.set(sm.Sh, wordOf(sm.Sh, 0.25, 0.55, ["none", "mild", "marked"]));
  gg.inj.set(sm.inj, wordOf(sm.inj, 0.3, 0.6, ["little", "some", "marked"]));
  gg.alert.set(sm.A, wordOf(sm.A, 0.35, 0.65, ["low", "reduced", "preserved"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
