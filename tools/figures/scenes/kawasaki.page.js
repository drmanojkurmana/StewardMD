/* Kawasaki scene: child signs, inflamed coronary wall, aneurysm, slow flow, clot and heart muscle. */
const CY = 210, AX0 = 380, AX1 = 922, ACX = 660;
const L = { art: $("art"), cells: $("cells"), parts: $("parts"), heartg: $("heartg"), over: $("over"), panel: $("panel") };
const sm = { F: 0.8, I: 0.8, A: 0.2, T: 0.2, Flow: 0.8, Strain: 0.1, ivig: 0, asp: 0, ac: 0 };
let wallT, wallB, lumen, thrG, heart = {}, gg = {}, rbcs = [], swirl = [], wallCells = [], plts = [], fibs = [];
const halfAt = (x) => 32 + sm.A * 40 * Math.exp(-Math.pow((x - ACX) / 115, 2));
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cyt = pool(36, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.parts));
const ivp = pool(16, () => mk("circle", { class: "sc-p kw-pivig", r: 2.6 }, L.parts));
const medp = pool(12, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const acc = { cyt: 0, ivp: 0, medp: 0 };

function init() {
  lumen = mk("path", { class: "kw-lum" }, L.art);
  const rg = mk("g", {}, L.art);
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(AX0, AX1), y: rnd(-0.75, 0.75), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  const sg = mk("g", {}, L.art);
  for (let i = 0; i < 5; i++) { const g = mk("g", { class: "cl cl-rbc" }, sg); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); mk("ellipse", { class: "cl-s", rx: 2.6, ry: 1.3 }, g); swirl.push({ g, ph: i * 1.256, i }); }
  thrG = mk("g", {}, L.art);
  for (let i = 0; i < 22; i++) plts.push({ g: cell(thrG, { cls: "plt", r: 5 + (i % 3) * 0.7, seed: i + 4, wob: 0.16, n: 7 }), u: rnd(-1, 1), v: rnd(0.05, 0.95), i });
  for (let i = 0; i < 10; i++) fibs.push({ e: mk("path", { class: "fibrin" }, thrG), u: rnd(-1, 1), v: rnd(0.1, 0.9), u2: rnd(-1, 1), v2: rnd(0.1, 0.9) });
  wallT = mk("path", { class: "kw-wall" }, L.art); wallB = mk("path", { class: "kw-wall" }, L.art);
  for (let i = 0; i < 14; i++) { const top = i % 2 === 0; wallCells.push({ g: cell(L.cells, { cls: i % 3 ? "neut" : "mac", r: 7, nuc: 0.4, seed: i + 8, wob: 0.12, n: 8 }), x: 420 + i * 38, top, i }); }
  /* heart: short axis ring downstream */
  heart.cav = mk("circle", { class: "kw-cav", cx: 835, cy: 362, r: 17 }, L.heartg);
  heart.myo = mk("circle", { class: "kw-myo", cx: 835, cy: 362, r: 26, "stroke-width": 18 }, L.heartg);
  heart.isch = mk("path", { class: "kw-isch", opacity: "0" }, L.heartg);
  mk("path", { class: "dr-beam", d: "M922 210C940 260 900 300 862 332" }, L.heartg);
  /* labels */
  const o = L.over;
  pill(o, "Fever", 292, 100, 292, 78, "Fever that lasts for days is the starting point. It reflects widespread inflammation, not just infection.");
  pill(o, "Red eyes", 137, 122, 80, 98, "Red eyes without discharge: inflammation of the conjunctiva on both sides.");
  pill(o, "Red lips", 160, 144, 248, 122, "Red, dry and cracked lips with a red tongue and mouth lining.");
  pill(o, "Neck node", 192, 168, 250, 158, "One large neck lymph node, usually on one side.");
  pill(o, "Rash", 140, 220, 72, 192, "A widespread rash on the trunk, often brighter around the nappy area.");
  pill(o, "Hands and feet", 218, 235, 262, 262, "Red and swollen hands and feet early on. Later the skin around the nails may peel.");
  pill(o, "Inflamed wall", 520, 176, 465, 110, "Inflammation spreads through the coronary artery wall. It weakens the wall, especially the middle layer.");
  pill(o, "Aneurysm", ACX, 168, ACX, 90, "Aneurysm: the weakened wall bulges out. Small ones may heal; large ones can persist.");
  pill(o, "Clot", 700, 255, 795, 138, "Blood moves slowly and swirls inside an aneurysm. Clot can form there and block the artery.");
  pill(o, "Blood flow", 425, 210, 425, 288, "Red cells carry oxygen to the heart muscle. Flow is fast in a smooth artery and slow inside a bulge.");
  pill(o, "Heart muscle", 835, 334, 835, 302, "Heart muscle fed by this coronary artery. If a clot blocks flow, this muscle is starved of oxygen.");
  const t1 = pill(o, "IVIG", 580, 266, 480, 345, "IVIG: pooled antibodies given into a vein. Given early, it calms the inflammation and makes aneurysms less likely."); t1.setAttribute("id", "p-ivig"); t1.style.opacity = 0;
  const t2 = pill(o, "Aspirin", 700, 255, 480, 345, "Aspirin makes platelets less sticky, so clot is less likely while the artery is inflamed or dilated."); t2.setAttribute("id", "p-asp"); t2.style.opacity = 0;
  const t3 = pill(o, "Anticoagulation", 700, 255, 480, 345, "Anticoagulation for a large aneurysm: it slows the clotting system so a large, slow moving pool of blood is less likely to clot."); t3.setAttribute("id", "p-ac"); t3.style.opacity = 0;
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
  let wt = "", wb = "";
  for (let x = AX0; x <= AX1; x += 6) { const h = halfAt(x); wt += (x === AX0 ? "M" : "L") + x + " " + f1(CY - h); wb += (x === AX0 ? "M" : "L") + x + " " + f1(CY + h); }
  let wtD = wt; for (let x = AX1; x >= AX0; x -= 6) wtD += "L" + x + " " + f1(CY - halfAt(x) - 16);
  wallT.setAttribute("d", wtD + "Z");
  let wbD = wb; for (let x = AX1; x >= AX0; x -= 6) wbD += "L" + x + " " + f1(CY + halfAt(x) + 16);
  wallB.setAttribute("d", wbD + "Z");
  wallT.style.opacity = (0.75 + 0.25 * sm.I).toFixed(2); wallB.style.opacity = (0.75 + 0.25 * sm.I).toFixed(2);
  let lumD = wt; for (let x = AX1; x >= AX0; x -= 6) lumD += "L" + x + " " + f1(CY + halfAt(x)); lumen.setAttribute("d", lumD + "Z");
  wallCells.forEach((c) => { const h = halfAt(c.x); place(c.g, c.x, c.top ? CY - h - 8 : CY + h + 8, 0, 0.4 + 0.6 * sm.I); c.g.style.opacity = (0.15 + 0.85 * sm.I).toFixed(2); });
  /* red cells: through flow plus slow swirl inside the bulge */
  const vf = 62 * clamp(sm.Flow + 0.15);
  rbcs.forEach((r) => { r.x += r.v * vf * dt * (Math.abs(r.x - ACX) < 90 ? 0.45 : 1); if (r.x > AX1 + 10) { r.x = AX0 - 10; r.y = rnd(-0.75, 0.75); } const h = halfAt(r.x); place(r.g, r.x, CY + r.y * Math.max(8, h - 11), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  swirl.forEach((s) => { const a = tm / 1400 + s.ph, sc = sm.A; place(s.g, ACX + Math.cos(a) * 52, CY + Math.sin(a) * 20, a * 57.3, Math.max(0.01, sc)); s.g.style.opacity = sc > 0.08 ? 1 : 0; });
  /* thrombus platelets and fibrin inside the aneurysm */
  const th = sm.T;
  plts.forEach((p) => { const x = ACX + p.u * 72, y = CY + halfAt(x) - 8 - p.v * 26 * th; place(p.g, x, y, 0, Math.max(0.01, th * (0.5 + 0.5 * p.v))); p.g.style.opacity = th > 0.06 ? 1 : 0; });
  fibs.forEach((f) => { const x1 = ACX + f.u * 70, x2 = ACX + f.u2 * 70; f.e.setAttribute("d", "M" + f1(x1) + " " + f1(CY + halfAt(x1) - 6 - f.v * 24 * th) + "L" + f1(x2) + " " + f1(CY + halfAt(x2) - 6 - f.v2 * 24 * th)); f.e.setAttribute("opacity", (th * 0.85).toFixed(2)); });
  /* cytokines from the inflamed wall */
  acc.cyt += dt * sm.I * 11; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyt); if (p) { const x = rnd(420, 900); emit(p, x, CY - halfAt(x) - 4, rnd(-5, 5), rnd(18, 30), 0); } }
  cyt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8 || p.y > CY + halfAt(p.x) + 10) kill(p); });
  /* treatment particles flowing in from the left */
  acc.ivp += dt * sm.ivig * 7; while (acc.ivp >= 1) { acc.ivp--; const p = free(ivp); if (p) emit(p, AX0 + 4, CY + rnd(-18, 18), 78, 0, 0); }
  ivp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > AX1) kill(p); });
  acc.medp += dt * (sm.asp + sm.ac) * 3.2; while (acc.medp >= 1) { acc.medp--; const p = free(medp); if (p) emit(p, AX0 + 4, CY + rnd(-14, 14), 70, 0, 0); }
  medp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.x > AX1) kill(p); });
  $("p-ivig").style.opacity = sm.ivig.toFixed(2); $("p-asp").style.opacity = sm.asp.toFixed(2); $("p-ac").style.opacity = sm.ac.toFixed(2);
  /* heart muscle downstream */
  const ph = ((tm / 1000) % 1), c = ph < 0.4 ? Math.sin(Math.PI * ph / 0.4) : 0;
  const cav = 17 * (1 - 0.18 * c * (1 - sm.Strain * 0.6));
  heart.cav.setAttribute("r", f1(cav)); heart.myo.setAttribute("r", f1(cav + 9)); heart.myo.setAttribute("stroke-width", f1(34 - cav));
  let sec = ""; const n = 20; for (let i = 0; i <= n; i++) { const a = (210 + 110 * i / n) * Math.PI / 180; sec += (i ? "L" : "M") + f1(835 + 35 * Math.cos(a)) + " " + f1(362 + 35 * Math.sin(a)); }
  for (let i = n; i >= 0; i--) { const a = (210 + 110 * i / n) * Math.PI / 180; sec += "L" + f1(835 + (cav + 2) * Math.cos(a)) + " " + f1(362 + (cav + 2) * Math.sin(a)); }
  heart.isch.setAttribute("d", sec + "Z"); heart.isch.setAttribute("opacity", (sm.Strain * 0.9).toFixed(2));
  gg.fv.set(sm.F, wordOf(sm.F, 0.3, 0.65, ["settled", "present", "high"]));
  gg.inf.set(sm.I, wordOf(sm.I, 0.3, 0.65, ["low", "raised", "high"]));
  gg.ane.set(sm.A, wordOf(sm.A, 0.25, 0.6, ["none", "small", "large"]));
  gg.clot.set(sm.T, wordOf(sm.T, 0.25, 0.6, ["low", "raised", "high"]));
  gg.fl.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.65, ["poor", "slow", "free"]));
  gg.st.set(sm.Strain, wordOf(sm.Strain, 0.25, 0.55, ["low", "at risk", "high"]));
}
run({ init, step });
