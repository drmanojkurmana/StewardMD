/* Heart failure scene: an organ heart that beats and dilates, a kidney organ that senses low flow
 * and passes urine, a lung organ that fills with fluid, and a drug capsule that docks where each treatment acts. */
const layers = { loop: $("loop"), cong: $("cong"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const HC = [175, 268], HW = 170, HSX = HW / 100;
const KC = [430, 238], KW = 100;
const LC = [402, 380], LW = 56;
let heartO = null, kidneyO = null, lungO = null, capEl = null, capDrug = -1;
function initOrgans() {
  heartO = organ($("heartSlot"), "heart", HC[0], HC[1], HW, {});
  kidneyO = organ($("kidneySlot"), "kidney", KC[0], KC[1], KW, {});
  lungO = organ($("lungSlot"), "lung", LC[0], LC[1], LW, {});
}
function capText(d) {
  if (d === 1) return "Water pill. The kidneys pass more urine, so swelling in lungs and legs falls.";
  if (d === 2) return "ACE inhibitor or ARNI. Vessels relax, so the heart pumps with less strain.";
  if (d === 3) return "Beta blocker. The heart beats slower and steadier with less adrenaline drive.";
  if (d === 4) return "Aldosterone blocker. Kidneys keep less salt and water, so swelling falls.";
  if (d === 5) return "SGLT2 inhibitor. Kidneys release extra sugar and water, easing the load.";
  if (d === 6) return "Four drugs together. The pump recovers, fluid clears and strain falls.";
  return "No treatment. The failing pump keeps fluid that swells lungs and legs.";
}
let aTrack = track([[121, 203], [155, 161], [199, 151], [233, 191]]);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const ejs = pool(6, () => mk("circle", { class: "sc-p p-hf", r: 2.6 }, layers.parts));
const drops = pool(10, () => mk("path", { class: "sc-p p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const urine = pool(12, () => mk("path", { class: "sc-p p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const salt = pool(10, () => mk("circle", { class: "sc-p hf-salt", r: 2.2 }, layers.parts));
const glu = pool(8, () => mk("rect", { class: "sc-p hf-glu", x: -2, y: -2, width: 4, height: 4, rx: 1 }, layers.parts));
/* ---- the loop: nodes and arrows ---- */
const NODES = {
  sym: { x: 440, y: 125, w: 150, t: "Sympathetic drive", tip: "Low output and low pressure switch on the sympathetic nervous system: faster, harder heartbeats and tighter vessels. Helpful at first, harmful when it stays on." },
  vc: { x: 665, y: 125, w: 170, t: "Vessels tighten", tip: "Vasoconstriction raises afterload: the failing ventricle now pumps against more resistance, so output falls further." },
  ang: { x: 665, y: 235, w: 170, t: "Renin, angiotensin II", tip: "Renin turns angiotensinogen into angiotensin I; ACE makes angiotensin II. It tightens vessels, triggers aldosterone and directly promotes remodelling." },
  ald: { x: 862, y: 235, w: 130, t: "Aldosterone", tip: "Aldosterone makes the kidney keep sodium and lose potassium. Water follows the sodium." },
  vol: { x: 862, y: 320, w: 150, t: "Salt and water kept", tip: "Retained salt and water raise the circulating volume. The heart is filled more (preload), and fluid leaks into lungs and tissues." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, layers.loop);
  mk("rect", { class: "hf-node", x: n.x - n.w / 2, y: n.y - 18, width: n.w, height: 36, rx: 12 }, g);
  const t = mk("text", { class: "hf-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; nodeEls[k] = g; });
const ARROWS = {
  h2s: { pts: [[330, 125], [365, 125]], k: "sym" },
  h2k: { pts: [[330, 235], [380, 230]], k: "low" },
  s2v: { pts: [[515, 125], [580, 125]], k: "sym" },
  k2a: { pts: [[486, 238], [580, 235]], k: "raas" },
  a2v: { pts: [[665, 217], [665, 145]], k: "raas" },
  a2l: { pts: [[750, 235], [797, 235]], k: "raas" },
  l2v: { pts: [[862, 253], [862, 302]], k: "ald" },
  after: { pts: [[665, 107], [665, 90], [240, 90], [240, 158]], k: "vc" },
  pre: { pts: [[787, 322], [560, 338], [330, 338], [262, 342]], k: "vol" },
};
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const a = ARROWS[id], d = a.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a.pts), e = mk("path", { class: "hf-arrow", d }, layers.loop);
  const p1 = a.pts[a.pts.length - 2], p2 = a.pts[a.pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958, hd = mk("path", { class: "hf-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, layers.loop);
  const dots = Array.from({ length: Math.max(3, Math.round(tr.len / 60)) }, (_, i) => { const c = mk("circle", { class: "hf-dot " + (a.k === "vol" ? "v" : a.k === "sym" ? "s" : ""), r: 2.4 }, layers.parts); return { c, u: i / Math.max(3, Math.round(tr.len / 60)) }; });
  arrows[id] = { e, hd, tr, dots, k: a.k }; });
/* ---- drug capsules: one docks where each treatment acts, and what flows past it thins ---- */
const CAPS = [
  { x: 141, y: 355, rot: 30, k: "bb" },
  { x: 547, y: 125, rot: 0, k: "bb" },
  { x: 665, y: 181, rot: 90, k: "acei" },
  { x: 773, y: 235, rot: 0, k: "acei" },
  { x: 862, y: 277, rot: 90, k: "mra" },
  { x: 415, y: 212, rot: -20, k: "diu" },
  { x: 448, y: 205, rot: 20, k: "sg" },
];
const caps = [];
function initCaps() {
  CAPS.forEach((cp) => {
    const g = mk("g", { opacity: "0", transform: "translate(" + cp.x + " " + cp.y + ") rotate(" + cp.rot + ")" }, layers.marks);
    mk("rect", { class: "hf-drug", x: -9, y: -4.5, width: 18, height: 9, rx: 4.5 }, g);
    mk("path", { class: "hf-drug2", d: "M0 -4.5L-4.5 -4.5A4.5 4.5 0 0 0 -4.5 4.5L0 4.5Z" }, g);
    caps.push(g);
  });
}
/* ---- congestion: lung fluid, neck veins, legs ---- */
const VEIN = [610, 402], LEG = [790, 402];
let vein = null, veinFill = null, leg = null, legF = null, lungF = null;
function initCong() {
  const cg = layers.cong;
  lungF = mk("ellipse", { class: "hf-fluid", cx: LC[0], cy: 408, rx: 10, ry: 5 }, cg);
  const veinG = mk("g", { class: "hot", tabindex: "0", "data-info": "Raised jugular venous pressure: the neck veins fill and bulge because blood cannot get through the right heart. A visible, bedside sign of congestion." }, cg);
  vein = mk("rect", { class: "hf-vein", x: VEIN[0] - 5, y: VEIN[1] - 22, width: 10, height: 44, rx: 5 }, veinG);
  veinFill = mk("rect", { class: "hf-fluid", x: VEIN[0] - 5, y: VEIN[1] + 22, width: 10, height: 0, rx: 5 }, veinG);
  const vt = mk("text", { class: "dr-pt2", x: VEIN[0], y: VEIN[1] + 34, "text-anchor": "middle" }, cg); vt.textContent = "Neck veins";
  const legG = mk("g", { class: "hot", tabindex: "0", "data-info": "Peripheral oedema: retained fluid collects in the legs, more with gravity, and pits when pressed." }, cg);
  leg = mk("ellipse", { class: "hf-leg", cx: LEG[0], cy: LEG[1] }, legG); legF = mk("ellipse", { class: "hf-fluid", cx: LEG[0], cy: LEG[1] + 6 }, legG);
  const lgt = mk("text", { class: "dr-pt2", x: LEG[0], y: LEG[1] + 34, "text-anchor": "middle" }, cg); lgt.textContent = "Legs";
}
/* ---- pills, caption and gauges ---- */
function initPills() {
  const ox = layers.over;
  pill(ox, "Weak pumping", HC[0], HC[1] + 17, 180, 402, "The ventricle ejects too little with each beat (reduced ejection) or fills poorly (stiff). Output falls.");
  pill(ox, "Remodelling", 130, 235, 115, 142, "Remodelling: the ventricle dilates and the wall changes shape. Wider chambers need more wall tension, so pumping gets worse.");
  pill(ox, "Afterload", 460, 90, 470, 90, "Afterload: the pressure the ventricle must beat to eject blood. Tight vessels raise it.");
  pill(ox, "Preload", 560, 338, 560, 380, "Preload: how full the ventricle is before it contracts. Retained fluid raises it. A little helps (Starling), too much overloads the failing heart.");
  pill(ox, "Kidney", 415, 295, 336, 330, "Kidney: low blood flow here triggers renin release. Renin starts a hormone chain that retains salt and water.");
  pill(ox, "Lungs", 427, 382, 492, 384, "Fluid behind the failing left ventricle backs into the lungs, causing breathlessness. A water pill drains it.");
  capEl = mk("text", { class: "hf-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0);
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [60, 200, 340, 480, 620];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cong", "Congestion", "g-fl", "How much fluid has backed up into the lungs, neck veins and legs."], ["co", "Output", "g-good", "How much blood the heart delivers to the body each minute."], ["nh", "Hormones", "g-cyt", "Neurohormonal activation: sympathetic drive plus the renin, angiotensin and aldosterone system."], ["rem", "Remodelling", "g-neu", "How much the ventricle has dilated and changed shape."], ["sx", "Symptoms", "g-bad", "Breathlessness, swelling and tiredness together."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 110, y0 + 2, h, 18, cls, name, tip); });
}
/* ---- animation ---- */
const sm = { sym: 0.5, raas: 0.5, ald: 0.5, vc: 0.5, vol: 0.5, rem: 0.3, co: 0.5, sx: 0.5, diu: 0, acei: 0, bb: 0, mra: 0, sg: 0 };
const acc = { drop: 0, ur: 0, salt: 0, glu: 0 };
let beat = 0;
function init() { initOrgans(); initCaps(); initCong(); initPills(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.4);
  ["sym", "raas", "ald", "vc", "co", "sx"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); }); sm.vol = lerp(sm.vol, m.vol, k2); sm.rem = lerp(sm.rem, m.rem, k2);
  ["diu", "acei", "bb", "mra", "sg"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* heart: rate follows sympathetic drive; the chamber dilates with remodelling and squeezes with each beat */
  beat += dt * (0.85 + 0.9 * sm.sym) * 1.1; const ph = beat % 1, c = Math.pow(Math.max(0, Math.sin(ph * 6.2832 * 0.5 + 0.2)), 1.2) * (ph < 0.5 ? 1 : 0);
  const ef = 0.1 + 0.3 * sm.co, dk = (1 + 0.22 * sm.rem) * (1 - ef * c);
  heartO.g.setAttribute("transform", "translate(" + HC[0] + " " + HC[1] + ") scale(" + dk.toFixed(3) + ")");
  const px = HC[0] - 32 * HSX * dk, py = HC[1] - 38 * HSX * dk;
  aTrack = track([[px, py], [px + 34, py - 42], [px + 78, py - 52], [px + 112, py - 12]]);
  ejs.forEach((p, i) => { const u = ((beat * 1.3 + i / ejs.length) % 1), q = aTrack.at(u); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (sm.co * 0.9).toFixed(2)); });
  /* signals along the loop: speed and density follow the arrow, and a docked capsule thins what flows past it */
  const act = { sym: sm.sym, raas: sm.raas, ald: sm.ald, vc: sm.vc, vol: sm.vol };
  const mul = { s2v: 1 - 0.5 * sm.bb, a2v: 1 - 0.6 * sm.acei, a2l: 1 - 0.55 * sm.acei, l2v: 1 - 0.55 * sm.mra, pre: 1 - 0.3 * sm.sg };
  Object.keys(arrows).forEach((id) => { const a = arrows[id], v = (a.k === "low" ? (1 - sm.co) : act[a.k]) * (mul[id] === undefined ? 1 : mul[id]), sp = 0.1 + 0.4 * v;
    a.e.style.opacity = (0.35 + 0.65 * clamp(v)).toFixed(2); a.hd.style.opacity = a.e.style.opacity;
    a.dots.forEach((d) => { d.u = (d.u + dt * sp) % 1; const q = a.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(v * 1.2).toFixed(2); }); });
  arrows.after.e.style.strokeWidth = f1(1 + 4 * sm.vc);
  /* node glow follows activity; the kidney glows when output is poor and the lung with fluid */
  Object.keys(NODES).forEach((id) => { const v = { sym: sm.sym, vc: sm.vc, ang: sm.raas, ald: sm.ald, vol: sm.vol }[id]; nodeEls[id].style.filter = "drop-shadow(0 0 " + (v * 7).toFixed(1) + "px var(--c-cyt))"; });
  kidneyO.g.style.filter = "drop-shadow(0 0 " + ((1 - sm.co) * 7).toFixed(1) + "px var(--c-cyt))";
  lungO.g.style.filter = "drop-shadow(0 0 " + (sm.vol * 6).toFixed(1) + "px var(--c-fl))";
  caps.forEach((g, i) => g.setAttribute("opacity", sm[CAPS[i].k].toFixed(2)));
  /* congestion */
  lungF.setAttribute("rx", f1(8 + 20 * sm.vol)); lungF.setAttribute("ry", f1(4 + 7 * sm.vol)); lungF.style.opacity = (0.1 + 0.65 * sm.vol).toFixed(2);
  const vh = 44 * (0.25 + 0.75 * sm.vol); veinFill.setAttribute("height", f1(vh)); veinFill.setAttribute("y", f1(VEIN[1] + 22 - vh)); vein.setAttribute("width", f1(10 + 8 * sm.vol * (0.7 + 0.3 * Math.sin(beat * 6.28)))); vein.setAttribute("x", f1(VEIN[0] - (10 + 8 * sm.vol) / 2)); veinFill.setAttribute("width", f1(10 + 8 * sm.vol * 0.9)); veinFill.setAttribute("x", f1(VEIN[0] - (10 + 8 * sm.vol * 0.9) / 2));
  leg.setAttribute("rx", f1(14 + 22 * sm.vol)); leg.setAttribute("ry", f1(18 + 4 * sm.vol)); legF.setAttribute("rx", f1(8 + 20 * sm.vol)); legF.setAttribute("ry", f1(4 + 6 * sm.vol));
  /* fluid weeps toward the legs; urine, salt and sugar leave through the kidney when a drug acts */
  acc.drop += dt * sm.vol * 3; while (acc.drop >= 1) { acc.drop--; const d = free(drops); if (d) { d.on = true; d.x = rnd(836, 888); d.y = 340; d.k = rnd(0.8, 1.2); d.t = 0; d.e.setAttribute("opacity", "1"); } }
  drops.forEach((d) => { if (!d.on) return; d.t += dt; d.y += 26 * dt * d.k; d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); if (d.y > 372) { d.on = false; d.e.setAttribute("opacity", "0"); } });
  acc.ur += dt * (sm.diu * 9 + sm.sg * 3.5 + sm.mra * 2); while (acc.ur >= 1) { acc.ur--; const d = free(urine); if (d) emit(d, 406 + rnd(-6, 6), 332, rnd(-4, 4), rnd(55, 75)); }
  urine.forEach((d) => { if (!d.on) return; d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); d.e.setAttribute("opacity", clamp(1 - (d.y - 360) / 28).toFixed(2)); if (d.y > 388) kill(d); });
  acc.salt += dt * (sm.diu * 7 + sm.mra * 3 + sm.sg * 2); while (acc.salt >= 1) { acc.salt--; const d = free(salt); if (d) { const sx0 = rnd(435, 465), sy0 = rnd(218, 252); emit(d, sx0, sy0, (406 - sx0) / 1.4, (328 - sy0) / 1.4); } }
  salt.forEach((d) => { if (!d.on) return; d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); if (d.t > 1.6) kill(d); });
  acc.glu += dt * sm.sg * 5; while (acc.glu >= 1) { acc.glu--; const d = free(glu); if (d) { const gx = rnd(420, 460), gy = rnd(205, 235); emit(d, gx, gy, (406 - gx) / 1.4, (328 - gy) / 1.4); } }
  glu.forEach((d) => { if (!d.on) return; d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ") rotate(" + f1(d.t * 90) + ")"); if (d.t > 1.6) kill(d); });
  /* gauges */
  gg.cong.set(sm.vol, wordOf(sm.vol, 0.25, 0.5, ["minimal", "mild", "marked"])); gg.co.set(sm.co, wordOf(sm.co, 0.4, 0.62, ["low", "reduced", "adequate"])); gg.nh.set((sm.sym + sm.raas) / 2, wordOf((sm.sym + sm.raas) / 2, 0.3, 0.6, ["low", "raised", "high"]));
  gg.rem.set(sm.rem, wordOf(sm.rem, 0.3, 0.75, ["limited", "progressing", "advanced"])); gg.sx.set(sm.sx, wordOf(sm.sx, 0.3, 0.55, ["few", "some", "marked"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
