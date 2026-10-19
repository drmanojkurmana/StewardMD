/* Scrub typhus and rickettsial scene: bite and eschar, germs invading small vessel walls,
 * plasma leak, rash, and lung brain kidney injury. Doxycycline shrinks germs and closes
 * the leak; supportive fluids steady circulation. Vessels meet organ art at its ports. */
const CY = SC.CY, WW = SC.W;
const layers = { rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema"), fever: $("fever"), rash: $("rash"), eschar: $("eschar"), glowL: $("glowL"), glowB: $("glowB"), glowK: $("glowK"), stubL: $("stubL"), stubB: $("stubB"), stubK: $("stubK") };
let hh = 30;
const WALL_N = 26;
const endo = { top: [], bot: [] };
function initEndo() { ["top", "bot"].forEach((row) => { for (let i = 0; i < WALL_N; i++) { const g = mk("g", {}, layers.endo); cell(g, { cls: "endo", r: 14, nuc: 0.3, seed: i + (row === "top" ? 0 : 40), wob: 0.06, n: 8 }); endo[row].push({ g, x: 14 + (i + 0.5) * ((WW - 28) / WALL_N) }); } }); }
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null }; }); }
const rick = pool(26, () => mk("circle", { class: "sc-p p-rick", r: 3.2 }, layers.parts));
const orgg = pool(14, () => mk("circle", { class: "sc-p p-rick", r: 3 }, layers.parts));
const inflam = pool(18, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const drops = pool(24, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const dox = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const vol = pool(12, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = clamp(x, 24, WW - 24); p.y = clamp(y, 56, 432); p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.u = 0; p.tr = null; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
let lungO = null, brainO = null, kidO = null, capEl = null, capDrug = -1;
const stubP = { L: null, B: null, K: null };
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 180, 369, 66, {});
  brainO = organ($("brainSlot"), "brain", 480, 369, 110, {});
  kidO = organ($("kidneySlot"), "kidney", 780, 369, 80, {});
  stubP.L = lungO.ports.trachea || lungO.ports.in;
  stubP.B = brainO.ports.out || brainO.ports.parenchyma;
  stubP.K = kidO.ports.in || kidO.ports.pelvis;
}
function capText(d) {
  if (d === 1) return "Doxycycline kills germs inside vessel walls. Leak closes and organs recover.";
  if (d === 2) return "Support steadies circulation but germs remain. Leak and fever ease only a little.";
  if (d === 3) return "Doxycycline plus support kills germs and steadies circulation. Best recovery.";
  return "No early antibiotic. Germs spread in vessel walls, fluid leaks out, organs suffer.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["org", "Organism", "g-bac", "Germs living inside vessel lining cells."], ["endo", "Vessel injury", "g-cyt", "Infected lining turns inflamed. This vessel injury drives the illness."], ["leak", "Leaky wall", "g-fl", "Injured walls leak plasma, and tissue swelling forms."], ["fever", "Fever and rash", "g-bad", "Fever with rash as skin vessels are injured."], ["organ", "Organs", "g-bad", "Lung, brain and kidney suffer as vessel injury widens."], ["circ", "Circulation", "g-good", "Blood reaching organs. Falls when plasma leaks, steadied by fluids."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bite and eschar", 105, 132, 150, 88, "A mite bite plants germs in the skin. The eschar is the dark sore left at the bite.");
  pill(ox, "Germs", 300, 168, 360, 88, "Orientia or Rickettsia germs spread from the bite into small vessel walls.");
  pill(ox, "Rash", 850, 168, 800, 88, "Rash appears as germs injure small vessels in the skin.");
  pill(ox, "Vessel wall", 470, 230, 470, 212, "Vessel wall lined by endothelium. Germs invade these lining cells and injure the wall.");
  pill(ox, "Leak", 700, 196, 672, 212, "Injured walls let plasma leak out. Lost fluid means less blood reaches organs.");
  pill(ox, "Lung", 180, 336, 118, 316, "Lung: infected vessels bring cough and fluid in the lung in severe illness.");
  pill(ox, "Brain", 480, 335, 566, 316, "Brain: infected vessels bring confusion and headache in severe illness.");
  pill(ox, "Kidney", 780, 334, 862, 316, "Kidney: poor circulation and injured vessels reduce kidney function.");
  capEl = mk("text", { class: "scr-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0);
}
const sm = { B: 0.4, E: 0.3, P: 0.2, F: 0.4, O: 0.2, BP: 0.7, Sh: 0.3, dox: 0, sup: 0 };
const acc = { rick: 0, orgg: 0, inf: 0, drop: 0, dox: 0, vol: 0 };
const stubKeys = ["L", "B", "K"];
function init() { initOrgans(); initEndo(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.B = lerp(sm.B, m.B, k2); sm.E = lerp(sm.E, m.E, k2); sm.P = lerp(sm.P, m.P, k2); sm.F = lerp(sm.F, m.F, k2); sm.O = lerp(sm.O, m.O, k2); sm.BP = lerp(sm.BP, m.BP, k2); sm.Sh = lerp(sm.Sh, m.Sh, k1); sm.dox = lerp(sm.dox, m.dox, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  hh = 26 + 16 * sm.P + 4 * sm.sup + 2 * Math.sin(tm / 900);
  const wallT = CY - hh - 4, wallB = CY + hh + 4;
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  layers.oed.setAttribute("height", f1(Math.max(0, wallT - 44))); layers.oed.setAttribute("opacity", (sm.P * 0.5).toFixed(2));
  layers.fever.setAttribute("opacity", (sm.F * 0.2).toFixed(2));
  layers.rash.setAttribute("opacity", clamp(0.15 + sm.F * 0.85).toFixed(2));
  const rs = 0.45 + 0.55 * sm.F;
  layers.rash.setAttribute("transform", "translate(" + f1(850 * (1 - rs)) + " " + f1(168 * (1 - rs)) + ") scale(" + rs.toFixed(3) + ")");
  layers.eschar.setAttribute("opacity", clamp(0.35 + sm.B * 0.65).toFixed(2));
  const go = (0.6 * sm.O).toFixed(2);
  layers.glowL.setAttribute("opacity", go); layers.glowB.setAttribute("opacity", go); layers.glowK.setAttribute("opacity", go);
  layers.stubL.setAttribute("d", "M" + f1(stubP.L[0]) + " " + f1(wallB + 2) + " L" + f1(stubP.L[0]) + " " + f1(stubP.L[1]));
  layers.stubB.setAttribute("d", "M" + f1(stubP.B[0]) + " " + f1(wallB + 2) + " L" + f1(stubP.B[0]) + " " + f1(stubP.B[1]));
  layers.stubK.setAttribute("d", "M" + f1(stubP.K[0]) + " " + f1(wallB + 2) + " L" + f1(stubP.K[0]) + " " + f1(stubP.K[1]));
  endo.top.forEach((e, i) => place(e.g, e.x, wallT + Math.sin(tm / 800 + i) * 0.8, 0, 1)); endo.bot.forEach((e, i) => place(e.g, e.x, wallB + Math.sin(tm / 800 + i + 2) * 0.8, 0, 1));
  [endo.top, endo.bot].forEach((row) => row.forEach((e) => { e.g.setAttribute("transform", e.g.getAttribute("transform") + " scale(" + (1 - 0.22 * sm.P).toFixed(3) + " 1)"); e.g.style.setProperty("--act", sm.E.toFixed(2)); }));
  rbcs.forEach((r) => { r.x += r.v * 62 * clamp(0.3 + 0.7 * (1 - sm.Sh)) * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * (hh - 12), r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  const gsc = 1 - 0.5 * sm.dox;
  acc.rick += dt * (0.5 + 9 * sm.B); while (acc.rick >= 1) { acc.rick--; const p = freeP(rick); if (p) emit(p, rnd(110, 260), rnd(130, 200), rnd(18, 34), rnd(10, 22), 0); }
  rick.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, clamp(p.x, 24, WW - 24), clamp(p.y, 56, 432), tm / 6, gsc); if (p.y > wallT - 10 || p.t > 7) kill(p); });
  acc.orgg += dt * sm.B * 6; while (acc.orgg >= 1) { acc.orgg--; const p = freeP(orgg); if (p) { const q = stubP[pick(stubKeys)]; emit(p, q[0] + rnd(-4, 4), wallB, 0, 0, 0); p.tr = track([[p.x, wallB], [q[0], q[1]]]); p.u = 0; } }
  orgg.forEach((p) => { if (!p.on || !p.tr) return; p.u += dt * 70 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, gsc); p.e.setAttribute("opacity", p.u > 0.8 ? clamp((1 - p.u) / 0.2).toFixed(2) : "1"); if (p.u >= 1) kill(p); });
  acc.inf += dt * sm.E * 8; while (acc.inf >= 1) { acc.inf--; const p = freeP(inflam); if (p) { const up = Math.random() < 0.5; emit(p, rnd(80, WW - 80), up ? wallT - 2 : wallB + 2, rnd(-8, 8), up ? -rnd(12, 24) : rnd(12, 24), 0); } }
  inflam.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, 432)) + ")"); if (p.t > 2.8) kill(p); });
  acc.drop += dt * sm.P * 8; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) { const up = Math.random() < 0.5; if (up) emit(p, rnd(60, WW - 60), wallT + 2, rnd(-4, 4), -rnd(14, 22), 0); else emit(p, rnd(60, WW - 60), wallB - 2, rnd(-4, 4), rnd(14, 22), 1); } }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, 432)) + ")"); if (p.k === 0) { p.e.setAttribute("opacity", clamp(1 - (wallT - p.y) / 60).toFixed(2)); if (p.y < wallT - 64) kill(p); } else { p.e.setAttribute("opacity", clamp(1 - (p.y - wallB) / 60).toFixed(2)); if (p.y > wallB + 64) kill(p); } });
  acc.dox += dt * sm.dox * 3.2; while (acc.dox >= 1) { acc.dox--; const p = freeP(dox); if (p) emit(p, 24, CY + rnd(-hh + 12, hh - 12), rnd(50, 70), 0, 0); }
  dox.forEach((p) => { if (!p.on) return; p.t += dt; if (p.st === 0) { p.x += p.vx * dt; p.y += (wallT + 4 - p.y) * dt * 2; if (p.y <= wallT + 6) { p.st = 1; p.t = 0; } p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(clamp(p.y, 56, 432)) + ") rotate(" + f1(p.t * 90) + ")"); if (p.x > WW - 24 || p.t > 6) kill(p); } else { p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); } });
  acc.vol += dt * sm.sup * 5.5; while (acc.vol >= 1) { acc.vol--; const p = freeP(vol); if (p) emit(p, 20, CY + rnd(-hh + 12, hh - 12), 86, 0, 0); }
  vol.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, WW - 24)) + " " + f1(p.y) + ")"); if (p.x > WW - 20) kill(p); });
  gg.org.set(sm.B, wordOf(sm.B, 0.2, 0.5, ["controlled", "present", "spreading"])); gg.endo.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["mild", "inflamed", "severe"])); gg.leak.set(sm.P, wordOf(sm.P, 0.3, 0.6, ["tight", "leaky", "very leaky"]));
  gg.fever.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["settling", "present", "high"])); gg.organ.set(sm.O, wordOf(sm.O, 0.3, 0.6, ["none yet", "some", "widespread"])); gg.circ.set(sm.BP, wordOf(sm.BP, 0.5, 0.75, ["failing", "weak", "steady"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
