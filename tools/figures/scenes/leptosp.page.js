/* Leptospirosis scene: contaminated water, skin entry, blood spirals, antibodies, vessel injury and organs. */
const CY = SC.CY, WW = SC.W;
const layers = { water: $("waterfx"), spir: $("spirals"), rbc: $("rbcs"), endo: $("endo"), parts: $("parts"), organs: $("organs"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const spiralD = "M-9 0 Q-6 -7 -3 0 Q0 7 3 0 Q6 -7 9 0";
const drops = pool(10, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const abs = pool(22, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "lp-abY", d: "M0 4 L0 -1 M0 -1 L-4 -5 M0 -1 L4 -5" }, g); return g; });
const abxP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const dial = pool(12, () => mk("circle", { class: "p-fl", r: 2.6 }, layers.parts));
const wspir = [];
const bspir = [];
const rbcs = [];
const organFx = {};
function initOrgans() {
  const O = layers.organs;
  const eye = mk("g", {}, O);
  mk("circle", { class: "lp-eye", cx: 130, cy: 398, r: 26 }, eye);
  mk("circle", { class: "lp-iris", cx: 130, cy: 398, r: 11 }, eye);
  mk("circle", { class: "lp-pupil", cx: 130, cy: 398, r: 4.5 }, eye);
  const rv = mk("g", { id: "eyeRed" }, eye);
  mk("path", { class: "lp-redv", d: "M108 388 L122 394 M152 388 L138 394 M110 410 L122 402 M150 410 L138 402" }, rv);
  organFx.eye = rv;
  const liv = mk("g", {}, O);
  mk("ellipse", { class: "lp-liver", cx: 350, cy: 398, rx: 54, ry: 30 }, liv);
  mk("ellipse", { cx: 338, cy: 390, rx: 30, ry: 14, fill: "#d98a76", opacity: ".55" }, liv);
  const tint = mk("ellipse", { id: "livTint", cx: 350, cy: 398, rx: 54, ry: 30, fill: "#e8c832", opacity: "0" }, liv);
  organFx.liver = tint;
  const kid = mk("g", {}, O);
  mk("ellipse", { class: "lp-kidney", cx: 575, cy: 398, rx: 30, ry: 42 }, kid);
  mk("ellipse", { cx: 588, cy: 398, rx: 10, ry: 22, fill: "#3b2f3d", opacity: ".35" }, kid);
  const kd = mk("ellipse", { id: "kidDark", cx: 575, cy: 398, rx: 30, ry: 42, fill: "#2a1a33", opacity: "0" }, kid);
  organFx.kidney = kd;
  const lug = mk("g", {}, O);
  mk("ellipse", { class: "lp-lung", cx: 790, cy: 398, rx: 52, ry: 32 }, lug);
  mk("path", { d: "M790 372 L790 398 M790 384 L772 392 M790 384 L808 392", stroke: "#3a6a8a", "stroke-width": 2, fill: "none", "stroke-linecap": "round" }, lug);
  const spots = mk("g", { id: "lungSpots" }, lug);
  [[762, 390], [782, 408], [802, 388], [818, 406], [792, 396]].forEach(([x, y]) => mk("circle", { class: "lp-spot", cx: x, cy: y, r: 4.5 }, spots));
  organFx.lung = spots;
}
function initActors() {
  for (let i = 0; i < 12; i++) { const e = mk("path", { class: "lp-spiral", d: spiralD }, layers.water); wspir.push({ e, x: rnd(56, 200), y: rnd(104, 172), a: rnd(0, 6.28), ph: rnd(0, 6) }); }
  for (let i = 0; i < 16; i++) { const e = mk("path", { class: "lp-spiral", d: spiralD }, layers.spir); bspir.push({ e, x: rnd(20, WW - 20), y: rnd(-18, 18), v: rnd(0.7, 1.3), ph: rnd(0, 6) }); }
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
  const wall = layers.endo;
  for (let i = 0; i < 22; i++) { const x = 24 + i * 42; mk("circle", { class: "lp-spot", id: "vt" + i, cx: x, cy: CY - 36, r: 2.2, opacity: "0" }, wall); mk("circle", { class: "lp-spot", id: "vb" + i, cx: x, cy: CY + 36, r: 2.2, opacity: "0" }, wall); }
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["spiro", "Spirochaetes", "g-spiro", "Leptospires in blood and tissues. High in the leptospiraemic phase, cleared as antibodies rise."], ["immune", "Antibodies", "g-immune", "Antibodies appear in the immune phase and clear leptospires from blood, although organisms may persist in kidney tubules."], ["vessel", "Vessel injury", "g-vessel", "Vasculitis: injured vessel walls cause bleeding, leak and tissue damage across organs."], ["liver", "Jaundice", "g-liver", "Liver dysfunction in Weil disease turns skin and eyes yellow. Anicteric illness has no jaundice."], ["kidney", "Kidney", "g-kidney", "Kidney injury from tubular damage and inflammation. Supportive care with dialysis can support failing kidneys."], ["lung", "Lung bleed", "g-lung", "Pulmonary haemorrhage in severe disease: bleeding into the lungs, a major cause of death."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Contaminated water", 128, 92, 128, 70, "Water or soil contaminated with urine from animals carrying Leptospira in their kidneys.");
  pill(ox, "Animal urine", 128, 184, 128, 208, "Animals shed leptospires in urine. Rain and flooding spread contaminated water widely.");
  pill(ox, "Skin or mucosa", 305, 84, 305, 70, "Entry through cuts or abrasions in skin, or through mucosa of the eyes, nose and mouth, often after wading or swimming.");
  pill(ox, "Antibodies", 820, 258, 820, 70, "In the immune phase antibodies clear leptospires from blood. Illness can worsen as immune injury affects vessels and organs.");
  pill(ox, "Fever", 360, 258, 360, 238, "Fever with headache, muscle pain and red eyes is typical of the early anicteric illness. Many cases stay mild.");
  pill(ox, "Bloodstream", 480, 258, 480, 238, "Leptospiraemia: leptospires spread in blood to liver, kidney, lung, muscle and other tissues.");
  pill(ox, "Vessel injury", 640, 258, 640, 238, "Vasculitis injures small vessel walls, causing bleeding, jaundice, kidney failure and lung haemorrhage in Weil disease.");
  const ab = pill(ox, "Antibiotic", 230, 258, 230, 238, "Doxycycline or penicillin kills leptospires. Prophylaxis before exposure can reduce entry and early spread."); ab.setAttribute("id", "abx-pill");
  pill(ox, "Eye redness", 130, 372, 130, 356, "Conjunctival suffusion: red eyes without discharge, a classic clue in the febrile phase.");
  pill(ox, "Jaundice", 350, 372, 350, 356, "Jaundice in Weil disease reflects liver dysfunction, often with kidney failure and bleeding.");
  pill(ox, "Kidney injury", 575, 372, 575, 356, "Renal failure from tubular injury and interstitial inflammation. Leptospires may be shed in urine at this stage.");
  pill(ox, "Lung bleeding", 790, 372, 790, 356, "Pulmonary haemorrhage: bleeding into lung tissue causing breathlessness and coughing blood in severe disease.");
}
const sm = { Spiro: 0.5, Immune: 0.2, Vessel: 0.3, Fever: 0.3, Liver: 0.1, Kidney: 0.1, Lung: 0.1, Eye: 0.2, abx: 0, sup: 0, proph: 0 };
const acc = { drop: 0, ab: 0, abx: 0, dial: 0 };
function init() { initOrgans(); initActors(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  ["Spiro", "Immune", "Vessel", "Fever", "Liver", "Kidney", "Lung", "Eye"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k2); });
  sm.abx = lerp(sm.abx, m.abx, k); sm.sup = lerp(sm.sup, m.sup, k); sm.proph = lerp(sm.proph, m.proph, k);
  const drugFx = Math.max(sm.abx, sm.proph);
  wspir.forEach((s, i) => { s.a += rnd(-1.2, 1.2) * dt; s.x += Math.cos(s.a) * 9 * dt; s.y += Math.sin(s.a) * 7 * dt; if (s.x < 52 || s.x > 204) s.a = Math.PI - s.a; if (s.y < 102 || s.y > 174) s.a = -s.a; s.x = clamp(s.x, 52, 204); s.y = clamp(s.y, 102, 174); const vis = clamp(1 - sm.proph * 0.75); s.e.setAttribute("transform", "translate(" + f1(s.x) + " " + f1(s.y) + ") rotate(" + f1(Math.sin(tm / 500 + s.ph) * 24) + ")"); s.e.setAttribute("opacity", vis.toFixed(2)); });
  acc.drop += dt * 3.2; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) emit(p, rnd(60, 196), 62, 0, 34, 0); }
  drops.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.x += Math.sin(tm / 300 + p.y) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 92) killP(p); });
  const wantB = Math.round(sm.Spiro * bspir.length);
  bspir.forEach((s, i) => { const on = i < wantB; s.x += s.v * (34 + 26 * sm.Spiro) * dt; if (s.x > WW + 14) { s.x = -14; s.y = rnd(-18, 18); } s.e.setAttribute("transform", "translate(" + f1(s.x) + " " + f1(CY + s.y + Math.sin(tm / 420 + s.ph) * 3) + ") rotate(" + f1(Math.sin(tm / 360 + s.ph) * 28) + ")"); s.e.setAttribute("opacity", on ? "1" : "0"); });
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.75, 0.75); } place(r.g, r.x, CY + r.y * 22, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  for (let i = 0; i < 22; i++) { const o = (sm.Vessel * (0.45 + 0.55 * Math.abs(Math.sin(tm / 700 + i)))).toFixed(2); const a = $("vt" + i), b = $("vb" + i); if (a) a.setAttribute("opacity", o); if (b) b.setAttribute("opacity", o); }
  acc.ab += dt * sm.Immune * 7; while (acc.ab >= 1) { acc.ab--; const p = freeP(abs); if (p) emit(p, rnd(30, WW - 30), CY + rnd(-20, 20), rnd(18, 42), rnd(-7, 7), 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 40) + ")"); if (p.x > WW + 8 || p.t > 9) killP(p); });
  acc.abx += dt * drugFx * 3.4; while (acc.abx >= 1) { acc.abx--; const p = freeP(abxP); if (p) emit(p, rnd(20, 90), CY + rnd(-14, 14), 56, 0, 0); }
  abxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 5) / 1.4).toFixed(2)); if (p.t > 6.4 || p.x > WW + 8) killP(p); });
  acc.dial += dt * sm.sup * 6; while (acc.dial >= 1) { acc.dial--; const p = freeP(dial); if (p) emit(p, 575 + rnd(-24, 24), 344, rnd(-5, 5), 16, 0); }
  dial.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 428) killP(p); });
  organFx.eye.setAttribute("opacity", clamp(sm.Eye * 1.4).toFixed(2));
  organFx.liver.setAttribute("opacity", (sm.Liver * 0.75).toFixed(2));
  organFx.kidney.setAttribute("opacity", (sm.Kidney * 0.62).toFixed(2));
  organFx.lung.setAttribute("opacity", clamp(sm.Lung * 1.3).toFixed(2));
  const abEl = $("abx-pill"); if (abEl) abEl.style.opacity = clamp(drugFx * 1.4).toFixed(2);
  gg.spiro.set(sm.Spiro, wordOf(sm.Spiro, 0.22, 0.55, ["cleared", "present", "high"]));
  gg.immune.set(sm.Immune, wordOf(sm.Immune, 0.3, 0.65, ["low", "rising", "high"]));
  gg.vessel.set(sm.Vessel, wordOf(sm.Vessel, 0.3, 0.65, ["mild", "injured", "severe"]));
  gg.liver.set(sm.Liver, wordOf(sm.Liver, 0.25, 0.6, ["none", "mild", "marked"]));
  gg.kidney.set(sm.Kidney, wordOf(sm.Kidney, 0.25, 0.55, ["working", "impaired", "failing"]));
  gg.lung.set(sm.Lung, wordOf(sm.Lung, 0.22, 0.5, ["clear", "bleeding", "severe"]));
}
run({ init, step });
