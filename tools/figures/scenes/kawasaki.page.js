/* Kawasaki scene: sick child, inflamed coronary wall, aneurysm, clot and the heart downstream. */
const CY = 210, AX0 = 380, AX1 = 922, ACX = 660;
const HX = 828, HY = 350, HW = 110;
const L = { art: $("art"), cells: $("cells"), parts: $("parts"), heartg: $("heartg"), over: $("over"), panel: $("panel") };
const sm = { F: 0.8, I: 0.8, A: 0.2, T: 0.2, Flow: 0.8, Strain: 0.1, ivig: 0, asp: 0, ac: 0 };
let wallT, wallB, wallTHi, wallBHi, lumen, clotMound, thrG, heartO = null, beam, isch, capEl = null, capKey = "";
let gg = {}, rbcs = [], swirl = [], wallCells = [], plts = [], fibs = [], docked = [];
const halfAt = (x) => 32 + sm.A * 40 * Math.exp(-Math.pow((x - ACX) / 115, 2));
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, ax: 0, ay: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cyt = pool(30, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.parts));
const ivp = pool(16, () => mk("circle", { class: "sc-p kw-pivig", r: 2.6 }, L.parts));
const aspP = pool(12, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const acP = pool(12, () => mk("circle", { class: "sc-p kw-pac", r: 2.6 }, L.parts));
const acc = { cyt: 0, ivp: 0, asp: 0, ac: 0 };
function capText(d, l) {
  if (d === 1) return "Aspirin coats platelets so they stick less. The clot stays smaller.";
  if (d === 2) return "Anticoagulation blocks the clotting mesh. Clot in the bulge stays smaller.";
  if (d === 3) return "IVIG calms inflammation. The wall heals and the bulge stays small.";
  if (l >= 2) return "No treatment. A large bulge remains. Clot can block blood to the heart.";
  if (l >= 1) return "No treatment. The weak wall bulges. Slow blood inside can form a clot.";
  return "No treatment. Fever and rash show. The artery wall is inflamed and weak.";
}

function init() {
  lumen = mk("path", { class: "kw-lum" }, L.art);
  wallTHi = mk("path", { class: "kw-infl" }, L.art);
  wallBHi = mk("path", { class: "kw-infl" }, L.art);
  const rg = mk("g", {}, L.art);
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(AX0, AX1), y: rnd(-0.75, 0.75), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  const sg = mk("g", {}, L.art);
  for (let i = 0; i < 5; i++) { const g = mk("g", { class: "cl cl-rbc" }, sg); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); swirl.push({ g, ph: i * 1.256, i }); }
  clotMound = mk("ellipse", { class: "kw-clotm", cx: ACX, cy: CY + 40, rx: 10, ry: 6, opacity: "0" }, L.art);
  thrG = mk("g", {}, L.art);
  for (let i = 0; i < 22; i++) plts.push({ g: cell(thrG, { cls: "plt", r: 5 + (i % 3) * 0.7, seed: i + 4, wob: 0.16, n: 7 }), u: rnd(-1, 1), v: rnd(0.05, 0.95), i });
  for (let i = 0; i < 10; i++) fibs.push({ e: mk("path", { class: "fibrin" }, thrG), u: rnd(-1, 1), v: rnd(0.1, 0.9), u2: rnd(-1, 1), v2: rnd(0.1, 0.9) });
  wallT = mk("path", { class: "kw-wall" }, L.art); wallB = mk("path", { class: "kw-wall" }, L.art);
  for (let i = 0; i < 14; i++) { const top = i % 2 === 0; wallCells.push({ g: cell(L.cells, { cls: i % 3 ? "neut" : "mac", r: 7, nuc: 0.4, seed: i + 8, wob: 0.12, n: 8 }), x: 420 + i * 38, top, i }); }
  for (let i = 0; i < 14; i++) docked.push({ e: mk("circle", { class: "sc-p kw-pivig", r: 3 }, L.parts) });
  /* heart: the shared organ downstream, fed by this artery */
  heartO = organ(L.heartg, "heart", HX, HY, HW, {});
  const ap = heartO.ports.aorta || heartO.ports.out;
  beam = mk("path", { class: "dr-beam", d: "M" + AX1 + " " + CY + "C940 260 900 300 " + f1(ap[0]) + " " + f1(ap[1]) }, L.heartg);
  isch = mk("ellipse", { class: "kw-isch", cx: HX, cy: HY + 42, rx: 36, ry: 24, opacity: "0" }, L.heartg);
  /* labels: the story runs left to right, sick child to artery to heart */
  const o = L.over;
  pill(o, "Fever", 292, 120, 292, 84, "Fever that lasts for days is the starting point. It reflects widespread inflammation, not just infection.");
  pill(o, "Red eyes", 137, 122, 80, 98, "Red eyes without discharge: inflammation of the conjunctiva on both sides.");
  pill(o, "Rash", 150, 225, 80, 192, "A widespread rash on the trunk. Hands and feet swell early and skin may peel later.");
  pill(o, "Inflamed wall", 520, 172, 465, 110, "Inflammation spreads through the coronary artery wall. It weakens the wall, especially the middle layer.");
  pill(o, "Aneurysm", ACX, 150, ACX, 90, "Aneurysm: the weakened wall bulges out. Small ones may heal; large ones can persist.");
  pill(o, "Clot", 700, 248, 800, 140, "Blood moves slowly and swirls inside a bulge. Clot can form there and block the artery.");
  pill(o, "Blood flow", 425, 210, 425, 288, "Red cells carry oxygen to the heart muscle. Flow is fast in a smooth artery and slow inside a bulge.");
  pill(o, "Heart", HX, 296, HX, 262, "Heart muscle fed by this coronary artery. If a clot blocks flow, this muscle is starved of oxygen.");
  capEl = mk("text", { class: "kw-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, 0);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["fv", "Fever", "g-bad", "Fever from body wide inflammation. Highest early, then settles."], ["inf", "Inflammation", "g-cyt", "Inflammation in the blood and in the coronary artery wall."], ["ane", "Aneurysm", "g-clot", "How much the weakened coronary wall has bulged out."], ["clot", "Clot risk", "g-clot", "Risk of clot forming, highest where blood swirls slowly inside an aneurysm."], ["fl", "Blood flow", "g-fl", "How freely blood moves through the coronary artery."], ["st", "Heart strain", "g-bad", "How much the heart muscle is at risk from poor flow or a blocking clot."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["F", "I", "A", "T", "Flow", "Strain", "ivig", "asp", "ac"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "A" ? k2 : k1); });
  /* child signs */
  const sign = clamp(sm.F * 0.55 + sm.I * 0.45);
  $("signs").style.opacity = (0.12 + 0.88 * sign).toFixed(2);
  $("feverHalo").setAttribute("opacity", (sm.F * 0.5).toFixed(2));
  const tf = $("thermoF"); if (tf) { const h = 70 * sm.F; tf.setAttribute("y", f1(170 - h)); tf.setAttribute("height", f1(h)); }
  /* artery walls and lumen outline */
  let wt = "", wb = "", bt = "", bb = "";
  for (let x = AX0; x <= AX1; x += 6) { const h = halfAt(x); wt += (x === AX0 ? "M" : "L") + x + " " + f1(CY - h); wb += (x === AX0 ? "M" : "L") + x + " " + f1(CY + h); bt += (x === AX0 ? "M" : "L") + x + " " + f1(CY - h - 8); bb += (x === AX0 ? "M" : "L") + x + " " + f1(CY + h + 8); }
  let wtD = wt; for (let x = AX1; x >= AX0; x -= 6) wtD += "L" + x + " " + f1(CY - halfAt(x) - 16);
  wallT.setAttribute("d", wtD + "Z");
  let wbD = wb; for (let x = AX1; x >= AX0; x -= 6) wbD += "L" + x + " " + f1(CY + halfAt(x) + 16);
  wallB.setAttribute("d", wbD + "Z");
  wallTHi.setAttribute("d", bt); wallBHi.setAttribute("d", bb);
  wallTHi.setAttribute("opacity", (sm.I * 0.7).toFixed(2)); wallBHi.setAttribute("opacity", (sm.I * 0.7).toFixed(2));
  let lumD = wt; for (let x = AX1; x >= AX0; x -= 6) lumD += "L" + x + " " + f1(CY + halfAt(x)); lumen.setAttribute("d", lumD + "Z");
  /* wall inflammatory cells calm down as IVIG docks onto them */
  wallCells.forEach((c) => { const h = halfAt(c.x); place(c.g, c.x, c.top ? CY - h - 8 : CY + h + 8, 0, Math.max(0.01, (0.4 + 0.6 * sm.I) * (1 - 0.35 * sm.ivig))); c.g.style.opacity = (0.15 + 0.85 * sm.I).toFixed(2); });
  docked.forEach((d, i) => { const c = wallCells[i % wallCells.length], h = halfAt(c.x);
    d.e.setAttribute("transform", "translate(" + f1(c.x + 7) + " " + f1((c.top ? CY - h - 8 : CY + h + 8) - 5) + ")");
    d.e.setAttribute("opacity", sm.ivig > 0.05 ? sm.ivig.toFixed(2) : "0"); });
  /* red cells: through flow plus slow swirl inside the bulge */
  const vf = 62 * clamp(sm.Flow + 0.15);
  rbcs.forEach((r) => { r.x += r.v * vf * dt * (Math.abs(r.x - ACX) < 90 ? 0.45 : 1); if (r.x > AX1 + 10) { r.x = AX0 - 10; r.y = rnd(-0.75, 0.75); } const h = halfAt(r.x); place(r.g, r.x, CY + r.y * Math.max(8, h - 11), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  swirl.forEach((s) => { const a = tm / 1400 + s.ph, sc = sm.A; place(s.g, ACX + Math.cos(a) * 52, CY + Math.sin(a) * 20, a * 57.3, Math.max(0.01, sc)); s.g.style.opacity = sc > 0.08 ? 1 : 0; });
  /* thrombus: a mound plus platelets and fibrin inside the aneurysm */
  const th = sm.T, tc = clamp(th * 1.5), coat = 1 - 0.3 * sm.asp - 0.45 * sm.ac;
  clotMound.setAttribute("cy", f1(CY + 18 + sm.A * 34));
  clotMound.setAttribute("rx", f1(8 + 58 * tc)); clotMound.setAttribute("ry", f1(4 + 16 * tc));
  clotMound.setAttribute("opacity", (tc * 0.9).toFixed(2));
  plts.forEach((p) => { const x = ACX + p.u * 72, y = CY + halfAt(x) - 8 - p.v * 26 * th; place(p.g, x, y, 0, Math.max(0.01, (0.3 + 0.7 * p.v) * th * coat)); p.g.style.opacity = th > 0.06 ? 1 : 0; });
  fibs.forEach((f) => { const x1 = ACX + f.u * 70, x2 = ACX + f.u2 * 70; f.e.setAttribute("d", "M" + f1(x1) + " " + f1(CY + halfAt(x1) - 6 - f.v * 24 * th) + "L" + f1(x2) + " " + f1(CY + halfAt(x2) - 6 - f.v2 * 24 * th)); f.e.setAttribute("opacity", (th * 0.85 * (1 - 0.35 * sm.asp) * (1 - 0.8 * sm.ac)).toFixed(2)); });
  /* cytokines from the inflamed wall, fading as IVIG docks */
  acc.cyt += dt * sm.I * 11 * (1 - 0.7 * sm.ivig); while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) { const x = rnd(420, 900); emit(p, x, CY - halfAt(x) - 4, rnd(-5, 5), rnd(18, 30), 0); } }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8 || p.y > CY + halfAt(p.x) + 10) kill(p); });
  /* IVIG antibodies flowing in to dock on the wall */
  acc.ivp += dt * sm.ivig * 7; while (acc.ivp >= 1) { acc.ivp--; const p = free(ivp); if (p) emit(p, AX0 + 4, CY + rnd(-18, 18), 78, 0, 0); }
  ivp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > AX1) kill(p); });
  /* aspirin capsules: flow in, then stick onto the clot */
  acc.asp += dt * sm.asp * 6; while (acc.asp >= 1) { acc.asp--; const p = free(aspP); if (p) emit(p, AX0 + 4, CY + rnd(-14, 14), 70, 0, 0); }
  aspP.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.t += dt; p.x += p.vx * dt;
      if (p.x > ACX - 95 && sm.T > 0.08) { p.st = 1; p.ax = ACX + rnd(-58, 58); p.ay = CY + halfAt(p.ax) - 10 - rnd(0, 22) * sm.T; }
      else { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.x > AX1) kill(p); } }
    if (p.st === 1) { if (sm.asp < 0.25) kill(p); else { p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.ax + Math.sin(tm / 300 + p.ay) * 1.5) + " " + f1(p.ay) + ") rotate(" + f1(p.t * 20) + ")"); p.e.setAttribute("opacity", sm.asp.toFixed(2)); } } });
  /* anticoagulant particles: linger where blood pools and dissolve the mesh */
  acc.ac += dt * sm.ac * 6; while (acc.ac >= 1) { acc.ac--; const p = free(acP); if (p) emit(p, AX0 + 4, CY + rnd(-14, 14), 66, 0, 0); }
  acP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt * (Math.abs(p.x - ACX) < 90 ? 0.3 : 1); p.y += Math.sin(tm / 350 + p.t * 4) * 12 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > AX1) kill(p); });
  /* heart muscle downstream, fed through the beam */
  beam.setAttribute("opacity", (0.25 + 0.75 * sm.Flow).toFixed(2));
  isch.setAttribute("opacity", (sm.Strain * 0.9).toFixed(2));
  const beat = (tm / 1000) % 1, cb = beat < 0.4 ? Math.sin(Math.PI * beat / 0.4) : 0, s = 1 + 0.025 * cb * (1 - 0.5 * sm.Strain);
  L.heartg.setAttribute("transform", "translate(" + f1(HX) + " " + f1(HY) + ") scale(" + s.toFixed(3) + ") translate(" + f1(-HX) + " " + f1(-HY) + ")");
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.fv.set(sm.F, wordOf(sm.F, 0.3, 0.65, ["settled", "present", "high"]));
  gg.inf.set(sm.I, wordOf(sm.I, 0.3, 0.65, ["low", "raised", "high"]));
  gg.ane.set(sm.A, wordOf(sm.A, 0.25, 0.6, ["none", "small", "large"]));
  gg.clot.set(sm.T, wordOf(sm.T, 0.25, 0.6, ["low", "raised", "high"]));
  gg.fl.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.65, ["poor", "slow", "free"]));
  gg.st.set(sm.Strain, wordOf(sm.Strain, 0.25, 0.55, ["low", "at risk", "high"]));
}
run({ init, step });
