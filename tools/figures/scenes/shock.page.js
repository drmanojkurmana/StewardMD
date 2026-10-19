/* Shock scene: a recognisable heart and lungs, vessels, venous reservoir and tissue bed.
 * Each treatment visibly acts on the drawing: fluids drip into the reservoir, vasopressor
 * dots dock on arteriole walls and the vessels narrow, inotrope dots dock on the heart and
 * each squeeze strengthens, and treating the cause seals the bleed, clears the trigger or
 * breaks up the block. A caption inside the stage says what is happening. */
const L = { ves: $("vessels"), lung: $("lungSlot"), heart: $("heartSlot"), blood: $("blood"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const CX = 200, CY = 235, LX = 72, LY = 150;
const RECP = [[542, 168], [592, 152], [542, 215], [592, 215], [542, 262], [592, 273]];
const INOP = [[255, 195], [265, 230], [255, 265], [235, 295], [170, 165], [215, 160]];
const TRIGP = [[700, 160], [740, 200], [800, 170], [840, 230], [700, 260], [760, 300], [820, 300], [860, 180], [680, 320], [780, 140]];
const CLOTD = [[0, 0, 10, 0, -1], [-9, 6, 7, -0.8, 0.6], [8, 7, 8, 0.8, 0.6], [-2, -9, 6, -0.2, -1]];
let CIRCUIT = null, vpTracks = [], heartO = null, lungO = null, pulmMid = [142, 165];
let arls = [], tissue = null, resvFill = null, lungFluid = null;
let sac = null, effusion = null, infarct = null, sparks = [], recepDots = [], vpDock = [], inoDock = [], trigDots = [];
let woundG = null, sealG = null, clotG = null, clotDots = [];
let capEl = null, capDrug = -1, capLevel = -1;
const marks = {};
function capText(l, d) {
  if (l === 0) {
    if (d === 1) return "Fluids or blood refills the veins. More blood reaches the heart, so output rises.";
    if (d === 2) return "A vasopressor tightens vessels, but the tank is still empty. Output stays low.";
    if (d === 3) return "An inotrope adds squeeze, but there is too little blood to pump. Output stays low.";
    if (d === 4) return "The bleed is sealed, but the lost blood is not replaced. Output stays below normal.";
    if (d === 5) return "The bleed is sealed and fluids replace the loss. Output returns toward normal.";
    return "No treatment. Blood leaves through the bleed, so little returns and output stays low.";
  }
  if (l === 1) {
    if (d === 1) return "Fluids add filling that the weak pump cannot move on. Lung congestion worsens.";
    if (d === 2) return "A vasopressor tightens vessels against a weak pump. Output stays low.";
    if (d === 3) return "An inotrope strengthens each squeeze. More blood moves on, so output rises.";
    if (d === 4) return "The cause is treated and the pump recovers. Output rises and congestion eases.";
    if (d === 5) return "The cause is treated with inotrope support. Output rises and congestion eases.";
    return "No treatment. The weak pump cannot move blood on, and fluid backs up into the lungs.";
  }
  if (l === 2) {
    if (d === 1) return "Fluids add volume, but the vessels still hang open. Pressure stays low.";
    if (d === 2) return "A vasopressor docks on vessel walls and tightens them. Pressure rises.";
    if (d === 3) return "An inotrope adds squeeze, but open vessels are the problem. Pressure stays low.";
    if (d === 4) return "The trigger is removed and tone partly returns. Pressure rises partway.";
    if (d === 5) return "The trigger is gone and vessel support restores tone. Pressure returns toward normal.";
    return "No treatment. Vessels hang open and blood pools in the veins. Pressure stays low.";
  }
  if (d === 1) return "Fluids push against a fixed block. Output stays low and congestion worsens.";
  if (d === 2) return "A vasopressor tightens vessels around a fixed block. Output stays low.";
  if (d === 3) return "An inotrope pushes against a fixed block. Output stays low.";
  if (d === 4) return "The block is relieved, so blood gets through. Output rises and congestion eases.";
  if (d === 5) return "The block is relieved with support alongside. Output rises and congestion eases.";
  return "No treatment. A block holds blood back while fluid squeezes the heart. Output stays low.";
}
function initOrgans() {
  heartO = organ(L.heart, "heart", CX, CY, 140, {});
  lungO = organ(L.lung, "lung", LX, LY, 90, { flip: true });
  const aorta = heartO.ports.out, ivc = heartO.ports.ivc;
  const pulmH = heartO.ports.pulm, pulmL = lungO.ports.art;
  pulmMid = [Math.round((pulmH[0] + pulmL[0]) / 2), Math.round((pulmH[1] + pulmL[1]) / 2)];
  const by = (r) => (r[1] < 180 ? 150 : r[1] < 240 ? 215 : 280);
  CIRCUIT = track([aorta, [300, 192], [480, 215], [640, 215], [700, 215], [780, 238], [860, 262], [860, 330], [780, 372], [640, 392], [520, 392], [400, 396], [310, 372], [255, 342], ivc, [185, 248], aorta]);
  vpTracks = RECP.map((r) => track([aorta, [320, 196], [480, 215], [562, by(r)], r]));
  return { aorta, ivc, pulmH, pulmL };
}
function drawVessels(pt) {
  const A = pt.aorta, V = pt.ivc, H = pt.pulmH, Q = pt.pulmL;
  mk("path", { class: "v-ven", d: "M860 262C860 330 850 360 780 376C720 392 680 394 640 394M400 396C340 392 280 358 " + f1(V[0]) + " " + f1(V[1]), "stroke-width": 15 }, L.ves);
  mk("path", { class: "v-art", d: "M" + f1(A[0]) + " " + f1(A[1]) + "C250 160 350 200 480 215", "stroke-width": 15 }, L.ves);
  mk("path", { class: "v-ven", d: "M" + f1(H[0]) + " " + f1(H[1]) + "Q" + f1((H[0] + Q[0]) / 2) + " " + f1((H[1] + Q[1]) / 2 - 4) + " " + f1(Q[0]) + " " + f1(Q[1]), "stroke-width": 9 }, L.ves);
  [[480, 215, 560, 150, 660, 150], [480, 215, 560, 215, 660, 215], [480, 215, 560, 280, 660, 280]].forEach((a) => {
    arls.push(mk("path", { class: "v-art", d: "M" + a[0] + " " + a[1] + "C" + a[2] + " " + a[3] + " " + a[2] + " " + a[3] + " " + a[4] + " " + a[5], "stroke-width": 14 }, L.ves));
  });
  tissue = mk("rect", { class: "sc-organ hot", tabindex: "0", x: 660, y: 112, width: 220, height: 240, rx: 30, "data-info": "Tissues need oxygen from the blood. Low delivery turns the bed blue grey and harms cells." }, L.ves);
  for (let i = 0; i < 6; i++) mk("path", { class: "v-edge", d: "M670 " + (140 + i * 38) + "C720 " + (126 + i * 38) + " 800 " + (160 + i * 38) + " 872 " + (140 + i * 38) }, L.ves);
  const rv = mk("g", { class: "hot", tabindex: "0", "data-info": "Veins hold most of the blood and act as a store. Bleeding empties the store and fluids refill it." }, L.ves);
  mk("rect", { class: "sc-resv", x: 400, y: 364, width: 240, height: 52, rx: 22 }, rv);
  resvFill = mk("rect", { class: "sc-resvfill", x: 404, y: 404, width: 232, height: 8, rx: 14 }, rv);
  lungFluid = mk("rect", { class: "sc-fluid", x: 36, y: 204, width: 72, height: 0, rx: 18, opacity: 0 }, L.lung);
  RECP.forEach((r) => recepDots.push(mk("circle", { class: "sc-recep", cx: r[0], cy: r[1], r: 3.2, opacity: 0.85 }, L.ves)));
  RECP.forEach((r) => vpDock.push(mk("circle", { class: "sc-p p-vp", cx: r[0], cy: r[1] - 7, r: 4.2, opacity: 0 }, L.parts)));
  INOP.forEach((p) => inoDock.push(mk("circle", { class: "sc-p p-ino", cx: p[0], cy: p[1], r: 4.2, opacity: 0 }, L.parts)));
  TRIGP.forEach((p, i) => { const e = mk("circle", { class: "sc-p p-trig", cx: p[0], cy: p[1], r: 3.4, opacity: 0 }, L.parts); trigDots.push({ e, x: p[0], y: p[1], s: i * 1.3 }); });
}
function drawHeart() {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": "The heart: the pump. It fills from the veins and ejects into the arteries. A weak pump, too little filling or a block lowers output." }, L.heart);
  sac = mk("ellipse", { class: "sc-sac", cx: CX, cy: CY, rx: 82, ry: 94 }, g);
  effusion = mk("ellipse", { class: "sc-effusion", cx: CX, cy: CY, rx: 82, ry: 94, opacity: 0 }, g);
  infarct = mk("ellipse", { class: "sc-infarct", cx: 222, cy: 258, rx: 18, ry: 24, opacity: 0 }, L.heart);
  for (let i = 0; i < 7; i++) {
    const a = -2.6 + i * 0.7;
    sparks.push(mk("path", { class: "sc-spark", d: "M" + f1(Math.cos(a) * 92) + " " + f1(Math.sin(a) * 88) + "L" + f1(Math.cos(a) * 106) + " " + f1(Math.sin(a) * 100), opacity: 0, transform: "translate(" + CX + " " + CY + ")" }, L.heart));
  }
}
const NB = 44, rbc = [];
function initBlood() {
  for (let i = 0; i < NB; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, L.blood);
    mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g);
    mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    rbc.push({ g, u: i / NB, off: rnd(-3, 3) });
  }
}
function poolB(n, cls, x, y) {
  return Array.from({ length: n }, () => {
    const e = mk("path", { class: cls, d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z", opacity: 0 }, L.parts);
    return { e, on: false, x: x || 0, y: y || 0, vy: 0, t: 0 };
  });
}
const bleed = poolB(14, "p-bleed"), iv = poolB(12, "p-iv");
function poolDots(n, cls, r) {
  return Array.from({ length: n }, () => {
    const e = mk("circle", { class: cls, r: r, opacity: 0 }, L.parts);
    return { e, on: false, u: Math.random() };
  });
}
const vpd = poolDots(8, "sc-p p-vp", 3.6), ind = poolDots(8, "sc-p p-ino", 3.6);
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vy) { p.on = true; p.x = x; p.y = y; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function initMarks() {
  clotG = mk("g", { class: "hot", tabindex: "0", "data-info": "A block in the lung artery. Blood cannot get through to the body. Relieving it restores flow." }, L.marks);
  CLOTD.forEach(([x, y, r, dx, dy]) => { const e = mk("circle", { class: "sc-clot", cx: 0, cy: 0, r: r }, clotG); clotDots.push({ e, bx: x, by: y, dx, dy }); });
  woundG = mk("g", { class: "hot", tabindex: "0", "data-info": "Bleeding takes blood out of the circulation. Sealing the bleed keeps what is left inside." }, L.marks);
  mk("path", { class: "sc-wound", d: "M334 380l14 -10M338 390l14 -10M342 400l14 -10" }, woundG);
  sealG = mk("g", { opacity: 0 }, L.marks);
  mk("path", { class: "sc-seal", d: "M332 372l20 22M342 368l16 26M354 372l10 22" }, sealG);
}
function pills() {
  const o = L.over;
  pill(o, "Heart", CX, 210, CX, 84, "The heart: the pump. It fills from the veins and ejects into the arteries.");
  pill(o, "Lungs", LX, 140, LX, 262, "The lungs. A failing pump backs blood up into them and fluid leaks in.");
  pill(o, "Arterioles", 570, 215, 570, 106, "Arterioles set vessel tone. Tight walls raise pressure and open walls lower it. A vasopressor docks here.");
  pill(o, "Tissues", 770, 220, 770, 84, "Tissues need oxygen delivered by the blood.");
  pill(o, "Venous reservoir", 520, 400, 712, 428, "Veins store most of the blood. The volume here is the filling reserve for the heart.");
  marks.bl = pill(o, "Bleeding", 346, 388, 320, 346, "Bleeding takes blood out of the circulation.");
  marks.ob = pill(o, "Obstruction", pulmMid[0], pulmMid[1], 240, 120, "A block in the lung artery, or fluid squeezing the heart.");
  marks.fl = pill(o, "Fluids or blood", 470, 400, 450, 336, "Fluids or blood drips into the veins and refills the store, raising filling and output.");
  marks.vp = pill(o, "Vasopressor", 592, 273, 616, 348, "A vasopressor docks on arteriole walls and tightens them, raising pressure.");
  marks.in = pill(o, "Inotrope", 262, 210, 330, 120, "An inotrope docks on the heart and strengthens each squeeze, raising output.");
  marks.ca = pill(o, "Cause treated", 400, 215, 400, 150, "The cause treated: bleed sealed, trigger removed or block relieved, matched to the type.");
  capEl = mk("text", { class: "sh-cap", x: 30, y: 428 }, o);
  capEl.textContent = capText(0, 0);
}
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 230, 370, 510, 650, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P);
  t.textContent = "The circulation";
  [["co", "Output", "g-good", "Cardiac output: how much blood the heart pumps each minute."], ["pre", "Preload", "g-fl", "Preload: how full the heart is before it beats."], ["tone", "Vessel tone", "g-neu", "How tight the arterioles are."], ["bp", "Pressure", "g-clot", "Blood pressure is roughly output times vessel tone."], ["o2", "Oxygen delivery", "g-good", "Oxygen delivered to the tissues. Low delivery is what makes shock harmful."], ["cg", "Lung congestion", "g-bad", "Fluid backing up into the lungs."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { vol: 0.5, pump: 0.5, obs: 0, co: 0.5, pre: 0.5, tone: 0.5, bp: 0.5, cg: 0, o2: 0.5, fl: 0, vp: 0, ino: 0, cause: 0 };
const acc = { b: 0, iv: 0 };
let relief = 0, trig = 0, phase = 0;
function init() {
  const pt = initOrgans();
  drawVessels(pt);
  drawHeart();
  initBlood();
  initMarks();
  pills();
  initPanel();
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.6);
  ["vol", "pump", "obs", "co", "tone", "bp", "cg", "o2"].forEach((k) => { sm[k] = lerp(sm[k], m[k], k2); });
  sm.pre = lerp(sm.pre, m.preload, k2);
  ["fl", "vp", "ino", "cause"].forEach((k) => { sm[k] = lerp(sm[k], m[k], k1); });
  relief = lerp(relief, (m.cause && m.level === 3) ? 1 : 0, k1);
  trig = lerp(trig, (m.level === 2 && !m.cause) ? 1 : 0, k1);
  phase += dt * (1.1 + 1.4 * (1 - clamp(sm.co)));
  const beat = Math.max(0, Math.sin(phase * 6.2832)), kick = Math.pow(beat, 2), dia = clamp(sm.pre / 1.2);
  const sc = 0.92 + 0.1 * dia + (-0.05 - 0.05 * clamp(sm.pump)) * kick;
  heartO.g.setAttribute("transform", "translate(" + CX + " " + CY + ") scale(" + sc.toFixed(3) + ")");
  infarct.setAttribute("opacity", (m.level === 1 ? clamp((0.75 - sm.pump) / 0.5) * 0.85 : 0).toFixed(2));
  effusion.setAttribute("opacity", (sm.obs * 0.4).toFixed(2));
  sparks.forEach((s, i) => s.setAttribute("opacity", (sm.ino * (0.55 + 0.45 * Math.sin(tm / 180 + i))).toFixed(2)));
  inoDock.forEach((e) => e.setAttribute("opacity", sm.ino.toFixed(2)));
  const aw = 5 + 17 * (1 - clamp(sm.tone));
  arls.forEach((a) => a.setAttribute("stroke-width", aw.toFixed(1)));
  vpDock.forEach((e) => e.setAttribute("opacity", sm.vp.toFixed(2)));
  vpd.forEach((p, i) => {
    if (sm.vp > 0.03) { p.on = true; p.u = (p.u + dt * 0.4) % 1; const q = vpTracks[i % vpTracks.length].at(p.u); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", sm.vp.toFixed(2)); }
    else if (p.on) { p.on = false; p.e.setAttribute("opacity", "0"); }
  });
  ind.forEach((p) => {
    if (sm.ino > 0.03) { p.on = true; p.u = (p.u + dt * (0.06 + 0.25 * clamp(sm.co))) % 1; const q = CIRCUIT.at(p.u); place(p.e, q.x, q.y, 0, 1); p.e.setAttribute("opacity", sm.ino.toFixed(2)); }
    else if (p.on) { p.on = false; p.e.setAttribute("opacity", "0"); }
  });
  tissue.style.setProperty("--ox", clamp(sm.o2 * 1.3).toFixed(2));
  trigDots.forEach((t) => { place(t.e, t.x + Math.sin(tm / 500 + t.s) * 4, t.y + Math.cos(tm / 620 + t.s) * 4, 0, 1); t.e.setAttribute("opacity", (trig * 0.9).toFixed(2)); });
  const fh = clamp(sm.cg) * 80;
  lungFluid.setAttribute("y", f1(204 - fh));
  lungFluid.setAttribute("height", f1(fh));
  lungFluid.setAttribute("opacity", clamp(sm.cg * 1.6).toFixed(2));
  const lvl = clamp(sm.vol / 1.1) * 36;
  resvFill.setAttribute("y", f1(412 - lvl));
  resvFill.setAttribute("height", f1(lvl));
  const want = Math.round(clamp(sm.vol / 0.95) * NB), spd = 0.05 + 0.22 * clamp(sm.co) * (1 - 0.5 * sm.obs);
  rbc.forEach((r, i) => { r.u = (r.u + dt * spd) % 1; const p = CIRCUIT.at(r.u); place(r.g, p.x, p.y + r.off, p.a * 0.3 + Math.sin(tm / 400 + i) * 10, 1); r.g.style.opacity = i < want ? 1 : 0; });
  const cs = 0.3 + 0.7 * clamp(sm.obs);
  clotG.setAttribute("transform", "translate(" + f1(pulmMid[0]) + " " + f1(pulmMid[1]) + ") scale(" + cs.toFixed(2) + ")");
  clotG.style.opacity = sm.obs > 0.05 ? (1 - relief * 0.7).toFixed(2) : 0;
  clotDots.forEach((c) => { c.e.setAttribute("cx", f1(c.bx + c.dx * relief * 16)); c.e.setAttribute("cy", f1(c.by + c.dy * relief * 16)); });
  const bleeding = m.level === 0 && !m.cause ? 1 : 0;
  woundG.style.opacity = m.level === 0 ? (bleeding ? 1 : 0.18) : 0;
  sealG.setAttribute("opacity", (m.level === 0 && m.cause ? 0.9 : 0).toString());
  acc.b += dt * bleeding * 3.2;
  while (acc.b >= 1) { acc.b--; const p = free(bleed); if (p) emit(p, rnd(338, 356), 392, 30); }
  bleed.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.vy += 90 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 440) kill(p); });
  acc.iv += dt * sm.fl * 3;
  while (acc.iv >= 1) { acc.iv--; const p = free(iv); if (p) emit(p, rnd(500, 540), 300, 40); }
  iv.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.vy += 80 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 384) kill(p); });
  marks.fl.style.opacity = sm.fl.toFixed(2);
  marks.vp.style.opacity = sm.vp.toFixed(2);
  marks.in.style.opacity = sm.ino.toFixed(2);
  marks.ca.style.opacity = sm.cause.toFixed(2);
  marks.ob.style.opacity = clamp(sm.obs * 1.4).toFixed(2);
  marks.bl.style.opacity = m.level === 0 ? (m.cause ? 0.25 : 1).toString() : 0;
  gg.co.set(sm.co, wordOf(sm.co, 0.45, 0.85, ["low", "normal", "high"]));
  gg.pre.set(clamp(sm.pre / 1.2), wordOf(sm.pre, 0.5, 0.95, ["low", "normal", "high"]));
  gg.tone.set(clamp(sm.tone), wordOf(sm.tone, 0.35, 0.65, ["low", "normal", "high"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.45, 0.65, ["low", "borderline", "ok"]));
  gg.o2.set(sm.o2, wordOf(sm.o2, 0.4, 0.62, ["poor", "reduced", "ok"]));
  gg.cg.set(sm.cg, wordOf(sm.cg, 0.25, 0.6, ["none", "some", "heavy"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
