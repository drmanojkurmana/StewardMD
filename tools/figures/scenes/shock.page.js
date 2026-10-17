/* Shock scene: heart, vessels, venous reservoir, tissues, lungs, blood cells and the gauges. */
const L = { ves: $("vessels"), parts: $("parts"), blood: $("blood"), heart: $("heartg"), marks: $("marks"), over: $("over"), panel: $("panel") };
const HX = 190, HY = 228;
/* ---- the loop that blood follows ---- */
const LOOP = track([[270, 222], [480, 215], [640, 215], [700, 215], [780, 238], [860, 262], [860, 330], [780, 372], [640, 398], [520, 400], [400, 400], [310, 380], [240, 322], [214, 272], [250, 236], [270, 222]]);
const ART = "M268 222C340 222 410 215 480 215";
const ARL = [[480, 215, 560, 150, 660, 150], [480, 215, 560, 215, 660, 215], [480, 215, 560, 280, 660, 280]];
let arls = [], artM = null, venM = null, tissue = null, resvFill = null, lungFill = null;
function drawVessels() {
  mk("path", { class: "v-ven", d: "M860 262C860 330 850 360 780 376C720 396 660 400 640 400M400 400C330 400 290 380 250 318C236 296 226 280 214 270", "stroke-width": 15 }, L.ves);
  mk("path", { class: "v-art", d: ART, "stroke-width": 15 }, L.ves);
  ARL.forEach((a) => { const p = mk("path", { class: "v-art", d: "M" + a[0] + " " + a[1] + "C" + a[2] + " " + a[3] + " " + a[2] + " " + a[3] + " " + a[4] + " " + a[5] }, L.ves); arls.push(p); });
  tissue = mk("rect", { class: "sc-organ hot", tabindex: "0", x: 660, y: 112, width: 220, height: 240, rx: 30, "data-info": "Tissues. They need oxygen delivered by the blood. When delivery falls the tissue turns blue-grey and lactate builds up." }, L.ves);
  for (let i = 0; i < 6; i++) mk("path", { class: "v-edge", d: "M670 " + (140 + i * 38) + "C720 " + (126 + i * 38) + " 800 " + (160 + i * 38) + " 872 " + (140 + i * 38) }, L.ves);
  const rv = mk("g", { class: "hot", tabindex: "0", "data-info": "Venous reservoir. Veins hold most of the blood and act as a store. In distributive shock they dilate and pool blood; in hypovolaemic shock the store runs low, so the heart has little to fill with." }, L.ves);
  mk("rect", { class: "sc-resv", x: 400, y: 372, width: 240, height: 56, rx: 22 }, rv); resvFill = mk("rect", { class: "sc-resvfill", x: 404, y: 400, width: 232, height: 24, rx: 18 }, rv);
  const lg = mk("g", { class: "hot", tabindex: "0", "data-info": "Lungs. When a weak pump cannot move blood on, pressure backs up and fluid leaks into the lungs (pulmonary congestion)." }, L.ves);
  mk("rect", { class: "sc-lung", x: 40, y: 100, width: 96, height: 130, rx: 40 }, lg); lungFill = mk("rect", { class: "sc-lungfill", x: 46, y: 224, width: 84, height: 0, rx: 34 }, lg);
}
/* ---- heart ---- */
let heart, chamber, infarct, sac, effusion, sparks = [];
const HEART = "M0 44C-64 -4 -52 -54 -22 -54C-8 -54 0 -44 0 -34C0 -44 8 -54 22 -54C52 -54 64 -4 0 44Z";
function drawHeart() {
  const g = mk("g", { class: "hot", tabindex: "0", "data-info": "The heart: the pump. It fills from the veins (preload) and ejects into the arteries (output). A weak or blocked heart, or too little to fill with, lowers output." }, L.heart);
  sac = mk("ellipse", { class: "sc-sac", cx: HX, cy: HY - 4, rx: 82, ry: 70 }, g); effusion = mk("ellipse", { class: "sc-effusion", cx: HX, cy: HY - 4, rx: 82, ry: 70, opacity: 0 }, g);
  heart = mk("g", {}, g);
  mk("path", { class: "sc-heart", d: HEART }, heart); chamber = mk("path", { class: "sc-chamber", d: HEART }, heart); infarct = mk("ellipse", { class: "sc-infarct", cx: 22, cy: 6, rx: 20, ry: 26, opacity: 0 }, heart);
  for (let i = 0; i < 7; i++) { const a = -2.6 + i * 0.7; sparks.push(mk("path", { class: "sc-spark", d: "M" + f1(Math.cos(a) * 78) + " " + f1(Math.sin(a) * 66 - 6) + "L" + f1(Math.cos(a) * 92) + " " + f1(Math.sin(a) * 78 - 6), opacity: 0, transform: "translate(" + HX + " " + HY + ")" }, L.heart)); }
}
/* ---- blood cells ---- */
const NB = 44, rbc = [];
function initBlood() { for (let i = 0; i < NB; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.blood); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbc.push({ g, u: i / NB, off: rnd(-3, 3) }); } }
/* ---- particles: bleeding and IV fluid ---- */
function pool(n, cls) { return Array.from({ length: n }, () => { const e = mk("path", { class: cls, d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z", opacity: 0 }, L.parts); return { e, on: false, x: 0, y: 0, vy: 0, t: 0 }; }); }
const bleed = pool(14, "p-bleed"), iv = pool(12, "p-iv");
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vy) { p.on = true; p.x = x; p.y = y; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- obstruction, wound, support marks ---- */
let clot, woundG, chevs = [];
const marks = {};
function initMarks() {
  clot = mk("g", { class: "hot", tabindex: "0", "data-info": "An obstruction to flow: an embolus in the pulmonary artery, fluid squeezing the heart (tamponade) or a collapsed lung under tension. The pump is fine and filling pressure is high, but blood cannot get through." }, L.marks);
  [[0, 0, 10], [-9, 6, 7], [8, 7, 8], [-2, -9, 6]].forEach(([x, y, r]) => mk("circle", { class: "sc-clot", cx: x, cy: y, r }, clot));
  woundG = mk("g", { class: "hot", tabindex: "0", "data-info": "Bleeding: blood is lost from the circulation. Less blood means less to fill the heart, so output and pressure fall." }, L.marks);
  mk("path", { class: "sc-wound", d: "M322 342l14 -10M326 352l14 -10M330 362l14 -10" }, woundG);
  ARL.forEach((a, i) => { [-1, 1].forEach((s) => chevs.push(mk("path", { class: "dr-bond", d: "M" + (590 + i * 4) + " " + (a[5] + s * 22) + "l8 " + (-s * 9) + "l8 " + (s * 9), opacity: 0 }, L.marks))); });
}
function pills() {
  const o = L.over;
  pill(o, "Heart (pump)", HX, HY - 54, HX + 6, 78, "The heart: the pump. It fills from the veins (preload) and ejects into the arteries (output).");
  pill(o, "Lungs", 88, 150, 88, 262, "Lungs. A failing pump backs blood up into them and fluid leaks out.");
  pill(o, "Arterioles", 600, 215, 600, 106, "Arterioles set vessel tone (resistance). Tight arterioles raise the pressure; relaxed ones lower it.");
  pill(o, "Tissues", 770, 130, 770, 98, "Tissues need oxygen delivered by the blood.");
  pill(o, "Venous reservoir", 620, 418, 712, 428, "Veins store most of the blood. The volume here is the filling reserve for the heart.");
  const ob = pill(o, "Obstruction", 322, 222, 322, 176, "An obstruction: embolus, tamponade or tension pneumothorax."); marks.ob = ob;
  const bl = pill(o, "Bleeding", 332, 352, 292, 388, "Bleeding takes blood out of the circulation."); marks.bl = bl;
  marks.fl = pill(o, "Fluids or blood", 520, 372, 520, 336, "Fluids or blood refill the venous reservoir and raise filling.");
  marks.vp = pill(o, "Vasopressor", 600, 255, 600, 322, "A vasopressor tightens the arterioles and raises pressure.");
  marks.in = pill(o, "Inotrope", HX + 84, HY - 40, HX + 128, 130, "An inotrope makes the heart pump harder.");
  marks.ca = pill(o, "Cause treated", 430, 215, 430, 168, "The cause is treated: the bleed stopped, the artery opened, the trigger removed or the obstruction relieved.");
}
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 230, 370, 510, 650, 790];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The circulation";
  [["co", "Output", "g-good", "Cardiac output: how much blood the heart pumps each minute."], ["pre", "Preload", "g-fl", "Preload: how full the heart is before it beats (filling pressure)."], ["tone", "Vessel tone", "g-neu", "Systemic vascular resistance: how tight the arterioles are."], ["bp", "Pressure", "g-clot", "Blood pressure is roughly output times vessel tone."], ["o2", "Oxygen delivery", "g-good", "Oxygen delivered to the tissues. Low delivery is what makes shock harmful."], ["cg", "Lung congestion", "g-bad", "Fluid backing up into the lungs."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { vol: 0.5, pump: 0.5, obs: 0, co: 0.5, pre: 0.5, tone: 0.5, bp: 0.5, cg: 0, o2: 0.5, fl: 0, vp: 0, ino: 0, cause: 0 };
const acc = { b: 0, iv: 0 };
let phase = 0;
function init() { drawVessels(); drawHeart(); initBlood(); initMarks(); pills(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.6);
  ["vol", "pump", "obs", "co", "tone", "bp", "cg", "o2"].forEach((k) => { sm[k] = lerp(sm[k], m[k], k2); });
  sm.pre = lerp(sm.pre, m.preload, k2); ["fl", "vp", "ino", "cause"].forEach((k) => { sm[k] = lerp(sm[k], m[k], k1); });
  /* heart: rate rises as output falls (a reflex), strength follows the pump, size at rest follows filling */
  phase += dt * (1.1 + 1.4 * (1 - clamp(sm.co)));
  const beat = Math.max(0, Math.sin(phase * 6.2832)), kick = Math.pow(beat, 2), dia = clamp(sm.pre / 1.2);
  const sc = 0.9 + 0.12 * dia + (-0.06 - 0.04 * clamp(sm.pump)) * kick;
  heart.setAttribute("transform", "translate(" + HX + " " + HY + ") scale(" + sc.toFixed(3) + ")");
  chamber.setAttribute("transform", "scale(" + (0.36 + 0.4 * dia - 0.14 * clamp(sm.pump) * kick).toFixed(3) + ")");
  infarct.setAttribute("opacity", (m.level === 1 ? clamp((0.75 - sm.pump) / 0.5) * 0.8 : 0).toFixed(2));
  effusion.setAttribute("opacity", (sm.obs * 0.35).toFixed(2));
  sac.setAttribute("transform", "translate(" + f1(HX * (1 - (1 - sm.obs * 0.05))) + " 0)");
  sparks.forEach((s, i) => s.setAttribute("opacity", (sm.ino * (0.4 + 0.6 * Math.sin(tm / 180 + i))).toFixed(2)));
  /* arterioles: width follows vessel tone */
  const aw = 5 + 17 * (1 - clamp(sm.tone));
  arls.forEach((a) => a.setAttribute("stroke-width", aw.toFixed(1)));
  chevs.forEach((c) => c.setAttribute("opacity", sm.vp.toFixed(2)));
  /* tissues and lungs */
  tissue.style.setProperty("--ox", clamp(sm.o2 * 1.3).toFixed(2));
  lungFill.setAttribute("y", f1(224 - clamp(sm.cg) * 110)); lungFill.setAttribute("height", f1(clamp(sm.cg) * 110));
  /* venous reservoir: level = blood volume */
  const lvl = clamp(sm.vol / 1.1) * 40;
  resvFill.setAttribute("y", f1(426 - lvl)); resvFill.setAttribute("height", f1(lvl));
  /* blood cells flow along the loop; the number follows volume, the speed follows output */
  const want = Math.round(clamp(sm.vol / 0.95) * NB), spd = 0.05 + 0.22 * clamp(sm.co) * (1 - 0.5 * sm.obs);
  rbc.forEach((r, i) => { r.u = (r.u + dt * spd) % 1; const p = LOOP.at(r.u); place(r.g, p.x, p.y + r.off, p.a * 0.3 + Math.sin(tm / 400 + i) * 10, 1); r.g.style.opacity = i < want ? 1 : 0; });
  /* obstruction clot grows with the block; bleeding drops fall while the bleed is open */
  const cs = 0.2 + 0.8 * sm.obs; clot.setAttribute("transform", "translate(322 222) scale(" + cs.toFixed(2) + ")"); clot.style.opacity = sm.obs > 0.05 ? 1 : 0;
  const bleeding = m.level === 0 && !m.cause ? 1 : 0; woundG.style.opacity = m.level === 0 ? (bleeding ? 1 : 0.25) : 0;
  acc.b += dt * bleeding * 3.2; while (acc.b >= 1) { acc.b--; const p = free(bleed); if (p) emit(p, rnd(326, 346), 346, 30); }
  bleed.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.vy += 90 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 430) kill(p); });
  acc.iv += dt * sm.fl * 3; while (acc.iv >= 1) { acc.iv--; const p = free(iv); if (p) emit(p, rnd(500, 540), 300, 40); }
  iv.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.vy += 80 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 392) kill(p); });
  /* pills fade in with the treatment and the problem */
  marks.fl.style.opacity = sm.fl.toFixed(2); marks.vp.style.opacity = sm.vp.toFixed(2); marks.in.style.opacity = sm.ino.toFixed(2); marks.ca.style.opacity = sm.cause.toFixed(2);
  marks.ob.style.opacity = clamp(sm.obs * 1.4).toFixed(2); marks.bl.style.opacity = (m.level === 0 ? 1 : 0).toString();
  /* gauges */
  gg.co.set(sm.co, wordOf(sm.co, 0.45, 0.85, ["low", "normal", "high"])); gg.pre.set(clamp(sm.pre / 1.2), wordOf(sm.pre, 0.5, 0.95, ["low", "normal", "high"])); gg.tone.set(clamp(sm.tone), wordOf(sm.tone, 0.35, 0.65, ["low", "normal", "high"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.45, 0.65, ["low", "borderline", "ok"])); gg.o2.set(sm.o2, wordOf(sm.o2, 0.4, 0.62, ["poor", "reduced", "ok"])); gg.cg.set(sm.cg, wordOf(sm.cg, 0.25, 0.6, ["none", "some", "heavy"]));
}
run({ init, step });
