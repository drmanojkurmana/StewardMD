/* Heart failure scene: beating heart that dilates and remodels, the neurohormonal loop with flowing signals, treatment block marks, and congestion in lungs, neck veins and legs. */
const L = { loop: $("loop"), heart: $("heart"), cong: $("cong"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const HC = [175, 270];                                   // heart centre
/* ---- the heart ---- */
const hg = mk("g", {}, L.heart);
const rv = mk("ellipse", { class: "hf-rv", cx: HC[0] - 78, cy: HC[1] + 6, rx: 28, ry: 56 }, hg);
const wall = mk("ellipse", { class: "hf-wall", cx: HC[0], cy: HC[1] + 12 }, hg);
const wsh = mk("ellipse", { class: "hf-shade", cx: HC[0] + 6, cy: HC[1] + 18 }, hg);
const ch = mk("ellipse", { class: "hf-ch", cx: HC[0], cy: HC[1] + 12 }, hg);
const ra = mk("ellipse", { class: "hf-at", cx: HC[0] - 62, cy: HC[1] - 74, rx: 24, ry: 20 }, hg);
const la = mk("ellipse", { class: "hf-at", cx: HC[0] + 34, cy: HC[1] - 92, rx: 26, ry: 20 }, hg);
const aorta = mk("path", { class: "hf-arrow", d: "M" + (HC[0] + 40) + " " + (HC[1] - 52) + "C" + (HC[0] + 70) + " " + (HC[1] - 120) + " " + (HC[0] + 120) + " " + (HC[1] - 120) + " " + (HC[0] + 126) + " " + (HC[1] - 70), "stroke-width": 7, stroke: "var(--c-rbc)", opacity: 0.55 }, hg);
const ejs = Array.from({ length: 6 }, () => mk("circle", { class: "p-hf", r: 2.6, opacity: 0 }, L.parts));
const aTrack = track([[HC[0] + 40, HC[1] - 52], [HC[0] + 62, HC[1] - 100], [HC[0] + 106, HC[1] - 116], [HC[0] + 126, HC[1] - 70]]);
/* ---- the loop: nodes and arrows ---- */
const NODES = {
  sym: { x: 440, y: 125, w: 150, t: "Sympathetic drive", tip: "Low output and low pressure switch on the sympathetic nervous system: faster, harder heartbeats and tighter vessels. Helpful at first, harmful when it stays on." },
  vc: { x: 665, y: 125, w: 170, t: "Vessels tighten", tip: "Vasoconstriction raises afterload: the failing ventricle now pumps against more resistance, so output falls further." },
  kid: { x: 440, y: 235, w: 150, t: "Kidney sees low flow", tip: "Less blood reaches the kidney, which reads this as dehydration and releases renin." },
  ang: { x: 665, y: 235, w: 170, t: "Renin, angiotensin II", tip: "Renin turns angiotensinogen into angiotensin I; ACE makes angiotensin II. It tightens vessels, triggers aldosterone and directly promotes remodelling." },
  ald: { x: 862, y: 235, w: 130, t: "Aldosterone", tip: "Aldosterone makes the kidney keep sodium and lose potassium. Water follows the sodium." },
  vol: { x: 862, y: 320, w: 150, t: "Salt and water kept", tip: "Retained salt and water raise the circulating volume. The heart is filled more (preload), and fluid leaks into lungs and tissues." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.loop);
  mk("rect", { class: "hf-node", x: n.x - n.w / 2, y: n.y - 18, width: n.w, height: 36, rx: 12 }, g);
  const t = mk("text", { class: "hf-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; nodeEls[k] = g; });
const ARROWS = {
  h2s: { pts: [[330, 125], [365, 125]], k: "sym" },
  h2k: { pts: [[330, 235], [365, 235]], k: "kid" },
  s2v: { pts: [[515, 125], [580, 125]], k: "sym" },
  k2a: { pts: [[515, 235], [580, 235]], k: "raas" },
  a2v: { pts: [[665, 217], [665, 145]], k: "raas" },
  a2l: { pts: [[750, 235], [797, 235]], k: "raas" },
  l2v: { pts: [[862, 253], [862, 302]], k: "ald" },
  after: { pts: [[665, 107], [665, 90], [250, 90], [250, 150]], k: "vc" },
  pre: { pts: [[787, 322], [560, 356], [330, 356], [262, 342]], k: "vol" },
};
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const a = ARROWS[id], d = a.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a.pts), e = mk("path", { class: "hf-arrow", d }, L.loop);
  const p1 = a.pts[a.pts.length - 2], p2 = a.pts[a.pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958, hd = mk("path", { class: "hf-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, L.loop);
  const dots = Array.from({ length: Math.max(3, Math.round(tr.len / 60)) }, (_, i) => { const c = mk("circle", { class: "hf-dot " + (a.k === "vol" ? "v" : a.k === "sym" ? "s" : ""), r: 2.4 }, L.parts); return { c, u: i / Math.max(3, Math.round(tr.len / 60)) }; });
  arrows[id] = { e, hd, tr, dots, k: a.k }; });
/* labels on the arrows that carry the loop back to the heart */
const ex = mk("g", {}, L.over);
pill(ex, "Afterload", 460, 90, 470, 90, "Afterload: the pressure the ventricle must beat to eject blood. Tight vessels raise it."); 
pill(ex, "Preload", 560, 356, 560, 380, "Preload: how full the ventricle is before it contracts. Retained fluid raises it. A little helps (Starling), too much overloads the failing heart.");
/* ---- treatment block marks: a red circle with a cross on the target arrow, and a short note ---- */
const MARKS = { acei: [773, 235, "ACE inhibitor or ARNI", 700, 280], bb: [548, 125, "Beta-blocker", 548, 166], mra: [862, 278, "MRA", 900, 281], sg: [836, 360, "SGLT2 inhibitor", 836, 380], diu: [900, 345, "Diuretic", 920, 366] };
const marks = {};
Object.keys(MARKS).forEach((id) => { const m = MARKS[id], g = mk("g", { opacity: 0 }, L.marks);
  mk("circle", { class: "hf-x", cx: m[0], cy: m[1], r: 8.5 }, g); mk("path", { class: "hf-xx", d: "M" + (m[0] - 4) + " " + (m[1] - 4) + "l8 8M" + (m[0] + 4) + " " + (m[1] - 4) + "l-8 8" }, g);
  const t = mk("text", { class: "hf-mk", x: m[3], y: m[4], "text-anchor": "middle" }, g); t.textContent = m[2]; marks[id] = g; });
/* ---- congestion: lungs, neck veins, legs ---- */
const LUNG = [400, 402], VEIN = [610, 402], LEG = [790, 402];
const cg = L.cong;
{ const clip = mk("clipPath", { id: "lungClip" }, cg); mk("path", { d: "M" + (LUNG[0] - 34) + " " + (LUNG[1] - 20) + "q-6 22 6 38 q16 6 22 -6 l0 -40 q-16 -8 -28 8z M" + (LUNG[0] + 34) + " " + (LUNG[1] - 20) + "q6 22 -6 38 q-16 6 -22 -6 l0 -40 q16 -8 28 8z" }, clip); }
const lungG = mk("g", { class: "hot", tabindex: "0", "data-info": "Pulmonary congestion: raised pressure behind the failing left ventricle pushes fluid into the lungs. That is breathlessness, orthopnoea and crackles." }, cg);
mk("path", { class: "hf-lung", d: "M" + (LUNG[0] - 34) + " " + (LUNG[1] - 20) + "q-6 22 6 38 q16 6 22 -6 l0 -40 q-16 -8 -28 8z M" + (LUNG[0] + 34) + " " + (LUNG[1] - 20) + "q6 22 -6 38 q-16 6 -22 -6 l0 -40 q16 -8 28 8z" }, lungG);
const lungFill = mk("rect", { class: "hf-fluid", x: LUNG[0] - 40, y: LUNG[1] + 20, width: 80, height: 0, "clip-path": "url(#lungClip)" }, lungG);
const lt = mk("text", { class: "dr-pt2", x: LUNG[0], y: LUNG[1] + 34, "text-anchor": "middle" }, cg); lt.textContent = "Lungs";
const veinG = mk("g", { class: "hot", tabindex: "0", "data-info": "Raised jugular venous pressure: the neck veins fill and bulge because blood cannot get through the right heart. A visible, bedside sign of congestion." }, cg);
const vein = mk("rect", { class: "hf-vein", x: VEIN[0] - 5, y: VEIN[1] - 22, width: 10, height: 44, rx: 5 }, veinG);
const veinFill = mk("rect", { class: "hf-fluid", x: VEIN[0] - 5, y: VEIN[1] + 22, width: 10, height: 0, rx: 5 }, veinG);
const vt = mk("text", { class: "dr-pt2", x: VEIN[0], y: VEIN[1] + 34, "text-anchor": "middle" }, cg); vt.textContent = "Neck veins";
const legG = mk("g", { class: "hot", tabindex: "0", "data-info": "Peripheral oedema: retained fluid collects in the legs, more with gravity, and pits when pressed." }, cg);
const leg = mk("ellipse", { class: "hf-leg", cx: LEG[0], cy: LEG[1] }, legG); const legF = mk("ellipse", { class: "hf-fluid", cx: LEG[0], cy: LEG[1] + 6 }, legG);
const lgt = mk("text", { class: "dr-pt2", x: LEG[0], y: LEG[1] + 34, "text-anchor": "middle" }, cg); lgt.textContent = "Legs";
const drops = Array.from({ length: 10 }, () => ({ e: mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z", opacity: 0 }, L.parts), on: false, x: 0, y: 0, k: 0, t: 0 }));
/* ---- labels on the heart and the gauge panel ---- */
pill(L.over, "Weak pumping", HC[0], HC[1] + 12, HC[0] + 10, HC[1] + 140, "The ventricle ejects too little with each beat (reduced ejection) or fills poorly (stiff). Output falls.");
pill(L.over, "Remodelling", HC[0] - 40, HC[1] - 28, HC[0] - 60, HC[1] - 128, "Remodelling: the ventricle dilates and the wall changes shape. Wider chambers need more wall tension, so pumping gets worse.");
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [60, 200, 340, 480, 620];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cong", "Congestion", "g-fl", "How much fluid has backed up into the lungs, neck veins and legs."], ["co", "Output", "g-good", "How much blood the heart delivers to the body each minute."], ["nh", "Hormones", "g-cyt", "Neurohormonal activation: sympathetic drive plus the renin, angiotensin and aldosterone system."], ["rem", "Remodelling", "g-neu", "How much the ventricle has dilated and changed shape."], ["sx", "Symptoms", "g-bad", "Breathlessness, swelling and tiredness together."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 110, y0 + 2, h, 18, cls, name, tip); }); }
/* ---- animation ---- */
const sm = { sym: 0.5, raas: 0.5, ald: 0.5, vc: 0.5, vol: 0.5, rem: 0.3, co: 0.5, sx: 0.5, diu: 0, acei: 0, bb: 0, mra: 0, sg: 0 }, acc = { drop: 0 }; let beat = 0;
const free = () => drops.find((d) => !d.on);
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.4);
  ["sym", "raas", "ald", "vc", "co", "sx"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); }); sm.vol = lerp(sm.vol, m.vol, k2); sm.rem = lerp(sm.rem, m.rem, k2);
  ["diu", "acei", "bb", "mra", "sg"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* heart: rate rises with sympathetic drive; ejection fraction follows output; chamber dilates and the wall changes with remodelling */
  beat += dt * (0.85 + 0.9 * sm.sym) * 1.1; const ph = beat % 1, c = Math.pow(Math.max(0, Math.sin(ph * 6.2832 * 0.5 + 0.2)), 1.2) * (ph < 0.5 ? 1 : 0);
  const ef = 0.1 + 0.3 * sm.co, rx0 = 46 * (1 + 0.45 * sm.rem), ry0 = 64 * (1 + 0.3 * sm.rem), t = 14 + 20 * Math.min(sm.rem, 0.5) - 14 * Math.max(0, sm.rem - 0.5);
  const rx = rx0 * (1 - ef * c), ry = ry0 * (1 - ef * c);
  ch.setAttribute("rx", f1(rx)); ch.setAttribute("ry", f1(ry)); wall.setAttribute("rx", f1(rx + t * (1 + 0.3 * c))); wall.setAttribute("ry", f1(ry + t * (1 + 0.3 * c))); wsh.setAttribute("rx", f1(rx + t)); wsh.setAttribute("ry", f1(ry + t));
  ra.setAttribute("cy", f1(HC[1] + 12 - ry - t * 0.5 - 6)); la.setAttribute("cy", f1(HC[1] + 12 - ry - t * 0.5 - 14)); rv.setAttribute("ry", f1(56 * (1 - 0.08 * c))); aorta.setAttribute("opacity", (0.25 + 0.5 * sm.co).toFixed(2));
  ejs.forEach((p, i) => { const u = ((beat * 1.3 + i / ejs.length) % 1), q = aTrack.at(u); p.setAttribute("cx", f1(q.x)); p.setAttribute("cy", f1(q.y)); p.setAttribute("opacity", (sm.co * 0.9).toFixed(2)); });
  /* signals along the loop: speed and density follow the activity of the arrow */
  const act = { sym: sm.sym, raas: sm.raas, ald: sm.ald, vc: sm.vc, vol: sm.vol };
  const mul = { s2v: 1 - 0.5 * sm.bb, a2v: 1, a2l: 1 - 0.55 * sm.acei, l2v: 1 - 0.55 * sm.mra, pre: 1 - 0.3 * sm.sg };
  Object.keys(arrows).forEach((id) => { const a = arrows[id], v = (a.k === "kid" ? sm.co * 0 + (1 - sm.co) : act[a.k]) * (mul[id] === undefined ? 1 : mul[id]), sp = 0.1 + 0.4 * v;
    a.e.style.opacity = (0.35 + 0.65 * clamp(v)).toFixed(2); a.hd.style.opacity = a.e.style.opacity;
    a.dots.forEach((d) => { d.u = (d.u + dt * sp) % 1; const q = a.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(v * 1.2).toFixed(2); }); });
  Object.keys(NODES).forEach((id) => { const v = { sym: sm.sym, vc: sm.vc, kid: 1 - sm.co, ang: sm.raas, ald: sm.ald, vol: sm.vol }[id]; nodeEls[id].style.filter = "drop-shadow(0 0 " + (v * 7).toFixed(1) + "px var(--c-cyt))"; });
  Object.keys(marks).forEach((id) => marks[id].setAttribute("opacity", sm[id].toFixed(2)));
  /* congestion */
  lungFill.setAttribute("height", f1(40 * sm.vol)); lungFill.setAttribute("y", f1(LUNG[1] + 20 - 40 * sm.vol));
  const vh = 44 * (0.25 + 0.75 * sm.vol); veinFill.setAttribute("height", f1(vh)); veinFill.setAttribute("y", f1(VEIN[1] + 22 - vh)); vein.setAttribute("width", f1(10 + 8 * sm.vol * (0.7 + 0.3 * Math.sin(beat * 6.28)))); vein.setAttribute("x", f1(VEIN[0] - (10 + 8 * sm.vol) / 2)); veinFill.setAttribute("width", f1(10 + 8 * sm.vol * 0.9)); veinFill.setAttribute("x", f1(VEIN[0] - (10 + 8 * sm.vol * 0.9) / 2));
  leg.setAttribute("rx", f1(14 + 22 * sm.vol)); leg.setAttribute("ry", f1(18 + 4 * sm.vol)); legF.setAttribute("rx", f1(8 + 20 * sm.vol)); legF.setAttribute("ry", f1(4 + 6 * sm.vol));
  acc.drop += dt * sm.vol * 3; while (acc.drop >= 1) { acc.drop--; const d = free(); if (d) { d.on = true; d.x = rnd(836, 888); d.y = 340; d.k = rnd(0.8, 1.2); d.t = 0; d.e.setAttribute("opacity", "1"); } }
  drops.forEach((d) => { if (!d.on) return; d.t += dt; d.y += 26 * dt * d.k; d.e.setAttribute("transform", "translate(" + f1(d.x) + " " + f1(d.y) + ")"); if (d.y > 372) { d.on = false; d.e.setAttribute("opacity", "0"); } });
  /* gauges */
  gg.cong.set(sm.vol, wordOf(sm.vol, 0.25, 0.5, ["minimal", "mild", "marked"])); gg.co.set(sm.co, wordOf(sm.co, 0.4, 0.62, ["low", "reduced", "adequate"])); gg.nh.set((sm.sym + sm.raas) / 2, wordOf((sm.sym + sm.raas) / 2, 0.3, 0.6, ["low", "raised", "high"]));
  gg.rem.set(sm.rem, wordOf(sm.rem, 0.3, 0.55, ["limited", "progressing", "advanced"])); gg.sx.set(sm.sx, wordOf(sm.sx, 0.3, 0.55, ["few", "some", "marked"]));
}
run({ init, step });
