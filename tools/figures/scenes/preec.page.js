/* Pre-eclampsia scene: real uterus, kidney, liver and brain organs. The ischaemic placenta
 * releases harmful factors that tighten the maternal vessel; protein leaks through the kidney
 * filter and the brain can seize. Antihypertensive dots dock on the vessel wall and open it,
 * magnesium dots park on the brain and block seizures, delivery removes the placenta. */
const CY = SC.CY, WW = SC.W;
const L = { glow: $("placGlow"), uterusSlot: $("uterusSlot"), placenta: $("placenta"), vLum: $("vLum"), vWallT: $("vWallT"), vWallB: $("vWallB"), vessel: $("vessel"), haloK: $("haloKidney"), haloL: $("haloLiver"), haloB: $("haloBrain"), kidneySlot: $("kidneySlot"), liverSlot: $("liverSlot"), brainSlot: $("brainSlot"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const UCX = 140, UCY = 225;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, dx: 0, side: 1, ox: 0, oy: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.st = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
const angP = pool(30, () => mk("circle", { class: "sc-p p-ang", r: 2.5 }, L.parts));
const ahP = pool(14, () => mk("circle", { class: "sc-p p-ah", r: 3.2 }, L.parts));
const mgP = pool(12, () => mk("circle", { class: "sc-p p-mg", r: 3.2 }, L.parts));
const protP = pool(16, () => mk("circle", { class: "sc-p p-prot", r: 2.2 }, L.parts));
let uterusO = null, kidneyO = null, liverO = null, brainO = null, pelv = [365, 344], trMg = null, bolt = null, capEl = null, capKey = "";
const dmg = [];
const MG_OFF = [[-45, -20], [45, -25], [-30, 25], [30, 28], [0, -38], [0, 35], [-55, 5], [55, 8], [-15, -5], [15, 5], [-38, 8], [38, -8]];
let mgNext = 0;
function initOrgans() {
  uterusO = organ(L.uterusSlot, "uterus", UCX, UCY, 180, {});
  kidneyO = organ(L.kidneySlot, "kidney", 380, 345, 110, {});
  liverO = organ(L.liverSlot, "liver", 570, 352, 150, {});
  brainO = organ(L.brainSlot, "brain", 770, 352, 150, {});
  pelv = kidneyO.ports.pelvis.slice();
  trMg = track([[770, 196], [770, 298]]);
  const g = L.placenta;
  mk("ellipse", { class: "pre-plac", cx: UCX, cy: UCY - 3, rx: 26, ry: 30 }, g);
  mk("ellipse", { class: "pre-plac", cx: UCX - 9, cy: UCY - 12, rx: 9, ry: 6, opacity: 0.55 }, g);
  mk("ellipse", { class: "pre-plac", cx: UCX + 9, cy: UCY + 6, rx: 8, ry: 5.5, opacity: 0.55 }, g);
  [120, 140, 160].forEach((x) => mk("path", { class: "pre-spiral", d: "M" + x + " 258q-6 8 0 14q6 6 0 12" }, g));
  bolt = mk("path", { class: "pre-bolt", d: "M778 282L764 302L772 302L763 322L782 298L773 298Z", opacity: 0 }, L.marks);
  [["M530 330L545 342L538 356L556 366"], ["M600 320L590 334L598 348"], ["M350 310L362 322L355 336"]]
    .forEach(([d]) => dmg.push(mk("path", { class: "pre-dmg", d: d, opacity: 0 }, L.marks)));
}
const endoTop = [], endoBot = [];
function initVessel() {
  for (let i = 0; i < 14; i++) { const x = 282 + i * 48; endoTop.push({ g: cell(L.vessel, { cls: "endo", r: 8, seed: i + 2, wob: 0.1, n: 8 }), x }); endoBot.push({ g: cell(L.vessel, { cls: "endo", r: 8, seed: i + 30, wob: 0.1, n: 8 }), x }); }
}
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(260, 930), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); } }
function capText(lv, d) {
  if (d === 1) {
    if (lv === 2) return "Pressure drug relaxes vessels and lowers pressure, but seizures can still occur.";
    if (lv === 1) return "Pressure drug relaxes vessels. Pressure falls, but organs still suffer.";
    return "Pressure drug relaxes vessels. Pressure falls, but placenta factors remain.";
  }
  if (d === 2) {
    if (lv === 2) return "Magnesium sits on the brain and blocks seizures. Pressure stays high.";
    if (lv === 1) return "Magnesium guards the brain. Pressure stays high.";
    return "Magnesium guards the brain. No seizures threaten yet.";
  }
  if (d === 3) {
    if (lv === 2) return "Delivery removes the placenta. Seizures stop and organs recover.";
    if (lv === 1) return "Delivery removes the placenta. Vessels relax and organs recover.";
    return "Delivery removes the placenta. The factor source is gone and mother recovers.";
  }
  if (lv === 2) return "No treatment. Tight vessels, suffering organs, and seizures. This is eclampsia.";
  if (lv === 1) return "No treatment. Tight vessels raise pressure and organs begin to suffer.";
  return "No treatment. Placenta factors tighten vessels and raise pressure.";
}
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The mother";
  [["ang", "Factors", "g-cyt", "Harmful factors released by the starved placenta into the blood of the mother."], ["endo", "Endothelium", "g-endo", "How widely the vessel lining is injured by the factors in the blood."], ["bp", "Pressure", "g-bad", "Blood pressure. Tight vessels raise resistance and pressure."], ["prot", "Protein", "g-fl", "Protein leaking through the kidney filter into urine."], ["org", "Organs", "g-org", "How much the kidney, liver and brain suffer as vessel injury spreads."], ["seiz", "Seizures", "g-seiz", "Seizure risk in the brain. Seizures present means eclampsia."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Placenta", 128, 200, 105, 110, "Placenta inside the uterus. Shallow implantation starves it of blood, so it releases harmful factors.");
  pill(ox, "Harmful factors", 300, 222, 300, 110, "Harmful factors from the starved placenta. They travel in maternal blood and injure vessel linings.");
  pill(ox, "Vessel wall", 560, 192, 560, 110, "Wall of a maternal vessel. Injured lining tightens the vessel, so pressure rises.");
  pill(ox, "Kidney", 375, 300, 350, 150, "Kidney. The injured filter leaks protein into urine.");
  pill(ox, "Liver", 575, 298, 625, 150, "Liver. Vessel injury makes it swell and suffer in severe disease.");
  pill(ox, "Brain", 830, 355, 888, 330, "Brain. Vessel injury causes headache and visual upset. Seizures define eclampsia.");
  pill(ox, "Protein in urine", 365, 390, 240, 380, "Protein leaking through the injured kidney filter. With high pressure this defines the syndrome.");
  capEl = mk("text", { class: "pre-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { isch: 0.5, ang: 0.4, endo: 0.4, bp: 0.5, prot: 0.4, org: 0.3, seiz: 0.1, ah: 0, mg: 0, del: 0 };
const acc = { ang: 0, ah: 0, mg: 0, prot: 0 };
function init() { initOrgans(); initVessel(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["isch", "ang", "endo", "bp", "prot", "org", "seiz", "ah", "mg", "del"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* placenta and its glow fade as delivery removes the cause */
  L.placenta.setAttribute("opacity", (1 - 0.92 * sm.del).toFixed(2));
  L.glow.setAttribute("opacity", (0.15 + 0.5 * sm.isch * (1 - sm.del)).toFixed(2));
  /* vessel geometry: injured lining tightens it, drug and delivery reopen it */
  const hh = Math.max(11, 29 - 8 * sm.endo + 5 * sm.ah + 6 * sm.del), thick = 14 + 6 * sm.endo;
  const wallT = CY - hh - thick, wallB = CY + hh + thick;
  L.vLum.setAttribute("y", f1(CY - hh)); L.vLum.setAttribute("height", f1(hh * 2));
  L.vWallT.setAttribute("y", f1(wallT)); L.vWallT.setAttribute("height", f1(thick));
  L.vWallB.setAttribute("y", f1(wallB)); L.vWallB.setAttribute("height", f1(thick));
  endoTop.forEach((e) => { place(e.g, e.x, CY - hh, 0, 1 - 0.18 * sm.endo); e.g.style.setProperty("--act", sm.endo.toFixed(2)); });
  endoBot.forEach((e) => { place(e.g, e.x, CY + hh, 0, 1 - 0.18 * sm.endo); e.g.style.setProperty("--act", sm.endo.toFixed(2)); });
  const flow = 30 + 62 * sm.bp;
  rbcs.forEach((r) => { r.x += r.v * flow * dt; if (r.x > 938) { r.x = 252; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * Math.max(4, hh - 9), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* harmful factors: placenta to vessel, then along it */
  acc.ang += dt * sm.ang * 9; while (acc.ang >= 1) { acc.ang--; const p = free(angP); if (p) emit(p, UCX + 28, UCY + rnd(-12, 12), rnd(38, 55), rnd(-4, 10)); }
  angP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + (CY - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 935 || p.t > 9) kill(p); });
  /* antihypertensive: dots drift in, dock on the wall muscle and hold while the wall opens */
  if (m.ah) { acc.ah += dt * (2 + 6 * sm.ah); while (acc.ah >= 1) { acc.ah--; const p = free(ahP); if (p) { emit(p, 262, CY + rnd(-hh + 14, hh - 14), 90 + 60 * sm.bp, 0); p.st = 1; p.dx = rnd(340, 860); p.side = Math.random() < 0.5 ? 1 : -1; } } } else acc.ah = 0;
  ahP.forEach((p) => {
    if (!p.on) return;
    if (!m.ah) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.5).toFixed(2)); if (p.t > 0.5) kill(p); return; }
    if (p.st === 1) { p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 6 * dt;
      if (p.x >= p.dx) p.st = 2;
      else p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(p.y, CY - hh + 8, CY + hh - 8)) + ")"); }
    if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1((p.side > 0 ? wallT : wallB) + (p.side > 0 ? 2 : -2) + Math.sin(tm / 500 + p.x) * 1.5) + ")");
  });
  /* magnesium: dots travel down to the brain and park on it while seizures fade */
  if (m.mg) { acc.mg += dt * 3; while (acc.mg >= 1) { acc.mg--; const p = free(mgP); if (p) { emit(p, 770, 196, 0, 0); p.st = 1; p.u = 0; const o = MG_OFF[mgNext % MG_OFF.length]; mgNext++; p.ox = o[0]; p.oy = o[1]; } } } else acc.mg = 0;
  mgP.forEach((p) => {
    if (!p.on) return;
    if (!m.mg) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.5).toFixed(2)); if (p.t > 0.5) kill(p); return; }
    if (p.st === 1) { p.u += dt * 130 / trMg.len; const q = trMg.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) p.st = 2; }
    else p.e.setAttribute("transform", "translate(" + f1(brainO.x + p.ox) + " " + f1(brainO.y + p.oy + Math.sin(tm / 600 + p.ox * 7) * 2) + ")");
  });
  /* protein leak: dots escape through the kidney filter and drain downward */
  acc.prot += dt * (0.5 + 9 * sm.prot); while (acc.prot >= 1) { acc.prot--; const p = free(protP); if (p) emit(p, pelv[0] + rnd(-5, 5), pelv[1], rnd(-6, 6), rnd(34, 48)); }
  protP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 408) / 16).toFixed(2)); if (p.y > 426 || p.t > 1.6) kill(p); });
  /* organ injury: red halos behind the art and cracks above it, all fading with treatment */
  [L.haloK, L.haloL, L.haloB].forEach((e) => e.setAttribute("opacity", (0.34 * sm.org).toFixed(2)));
  dmg.forEach((e) => e.setAttribute("opacity", clamp(sm.org * 1.3).toFixed(2)));
  bolt.setAttribute("opacity", sm.seiz.toFixed(2));
  bolt.setAttribute("transform", "translate(" + f1(Math.sin(tm / 55) * 2.2 * sm.seiz) + " 0)");
  gg.ang.set(sm.ang, wordOf(sm.ang, 0.3, 0.6, ["low", "raised", "high"])); gg.endo.set(sm.endo, wordOf(sm.endo, 0.3, 0.6, ["healthy", "injured", "widespread"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.65, ["controlled", "raised", "high"])); gg.prot.set(sm.prot, wordOf(sm.prot, 0.3, 0.6, ["none", "present", "heavy"]));
  gg.org.set(sm.org, wordOf(sm.org, 0.3, 0.6, ["quiet", "stressed", "involved"])); gg.seiz.set(sm.seiz, wordOf(sm.seiz, 0.2, 0.5, ["unlikely", "possible", "likely"]));
  const key = level * 4 + drug; if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
