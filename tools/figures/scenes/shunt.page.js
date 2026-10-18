/* Shunt scene: blood around the heart, lungs and body loop, shunt crossing at the active defect, ductus, chamber saturation colours and gauges. */
const L = { vessels: $("vessels"), heart: $("heart"), flow: $("flow"), shuntflow: $("shuntflow"), marks: $("marks"), over: $("over"), panel: $("panel") };
function mixc(s) { const a = [91, 141, 217], b = [229, 72, 77], t = clamp(s); return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")"; }
function head(parent, x, y, ang, col) { const p = mk("path", { d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + f1(x) + " " + f1(y) + ") rotate(" + f1(ang) + ")", fill: col || "var(--anatomy-mid)" }, parent); return p; }
/* ---- vessels (drawn under the heart so their in-heart segments are hidden) ---- */
const V = {};
function vessel(id, pts, col, w) { const d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), e = mk("path", { class: "sh-vessel", d, stroke: col, "stroke-width": w }, L.vessels); V[id] = e; return e; }
vessel("pa", [[550, 342], [575, 298], [575, 168], [478, 162], [398, 138]], "var(--c-cyt2)", 9);
vessel("pab", [[478, 162], [562, 138]], "var(--c-cyt2)", 8);
vessel("pvL", [[398, 142], [400, 175], [414, 202]], "var(--c-rbc)", 7);
vessel("pvR", [[562, 142], [545, 172], [460, 202]], "var(--c-rbc)", 7);
vessel("ao", [[410, 342], [395, 298], [392, 215], [410, 160], [478, 138], [600, 150], [652, 215], [652, 398], [630, 408]], "var(--c-rbc)", 9);
vessel("vein", [[430, 398], [300, 385], [300, 246], [492, 246]], "var(--c-cyt2)", 8);
const ductPath = mk("path", { class: "sh-duct", d: "M478 138L478 162" }, L.vessels);
head(L.vessels, 398, 138, -155, "var(--c-cyt2)"); head(L.vessels, 562, 138, -25, "var(--c-cyt2)");
head(L.vessels, 414, 202, 90, "var(--c-rbc)"); head(L.vessels, 630, 408, 160, "var(--c-rbc)"); head(L.vessels, 492, 246, 0, "var(--c-cyt2)");
/* stenosis mark at the right ventricular outlet (tetralogy) */
const sten = mk("g", { class: "hot", tabindex: "0", "data-info": "Narrowed pulmonary outlet in tetralogy of Fallot: blood leaving the right ventricle meets resistance, so it crosses the ventricular septal defect into the aorta instead." }, L.marks);
mk("path", { class: "sh-sten", d: "M566 282L584 290L566 298Z" }, sten); mk("path", { class: "sh-sten", d: "M584 282L566 290L584 298Z" }, sten);
/* close mark and note */
const closeG = mk("g", { opacity: "0" }, L.marks);
mk("circle", { class: "sh-x", r: 9 }, closeG); mk("path", { class: "sh-xx", d: "M-4 -4l8 8M4 -4l-8 8" }, closeG);
const closeNote = mk("text", { class: "sh-note", x: 480, y: 184, "text-anchor": "middle", opacity: "0" }, L.marks); closeNote.textContent = "defect closed";
/* ---- circuit particles ---- */
const SEGS = [
  { pts: [[430, 413], [300, 385], [300, 246], [492, 246], [550, 246]], kind: "deoxy", flow: "Qs" },
  { pts: [[550, 246], [550, 342]], kind: "deoxy", flow: "Qs" },
  { pts: [[550, 342], [575, 298], [575, 168], [478, 162], [398, 138]], kind: "pa", flow: "Qp" },
  { pts: [[398, 138], [400, 175], [414, 202], [410, 246]], kind: "oxy", flow: "Qp" },
  { pts: [[410, 246], [410, 342]], kind: "oxy", flow: "Qs" },
  { pts: [[410, 342], [395, 298], [392, 215], [410, 160], [478, 138], [600, 150], [652, 215], [652, 398], [620, 413], [540, 413]], kind: "art", flow: "Qs" },
  { pts: [[540, 413], [490, 413]], kind: "art", flow: "Qs" },
  { pts: [[490, 413], [430, 413]], kind: "deoxy", flow: "Qs" },
];
SEGS.forEach((s) => { s.tr = track(s.pts); });
const dots = Array.from({ length: 26 }, (_, i) => { const e = mk("circle", { class: "p-blood", r: 3.2 }, L.flow); const seg = i % SEGS.length; return { e, seg, d: (i * 37) % Math.max(20, SEGS[seg].tr.len), sp: rnd(0.85, 1.15) }; });
/* ---- shunt particles ---- */
const SHROUTES = { ASD: [[410, 246], [550, 246]], VSD: [[410, 342], [550, 342]], PDA: [[478, 138], [478, 162]] };
const shDots = Array.from({ length: 12 }, (_, i) => { const e = mk("circle", { class: "p-blood", r: 2.8, opacity: "0" }, L.shuntflow); return { e, u: i / 12, duct: i >= 8 }; });
/* ---- labels ---- */
const pillRefs = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [120, 320, 520, 720];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The child";
  [["qp", "Pulm. flow", "g-pulm", "How much blood flows through the lungs. Left to right shunts raise it; tetralogy and Eisenmenger physiology lower effective flow."], ["pap", "Pulm. pressure", "g-press", "Pressure in the pulmonary artery. It rises with large left to right shunts and is very high in Eisenmenger physiology."], ["sat", "Saturation", "g-good", "Oxygen saturation of blood reaching the body. It falls when oxygen poor blood shunts right to left, causing cyanosis."], ["qs", "Body flow", "g-fl", "How much blood reaches the body tissues. It can fall if a needed relief shunt is closed in Eisenmenger physiology."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = L.over;
  pillRefs.lungs = pill(ox, "Lungs", 390, 95, 170, 100, "Lungs: blood picks up oxygen here. Extra shunt flow overloads them; too little flow leaves blood poorly oxygenated.");
  pillRefs.pa = pill(ox, "Pulm. artery", 500, 162, 170, 160, "Pulmonary artery: carries blood from the right ventricle to the lungs. A patent ductus joins it to the aorta.");
  pillRefs.ao = pill(ox, "Aorta", 560, 142, 790, 160, "Aorta: carries blood from the left ventricle to the body. Its saturation sets the saturation gauge.");
  pillRefs.duct = pill(ox, "Ductus", 478, 150, 480, 58, "Ductus arteriosus: a fetal channel between the aorta and pulmonary artery. When it stays open after birth (patent ductus) blood shunts between them. Prostaglandin keeps it open.");
  pillRefs.asd = pill(ox, "ASD", 480, 246, 185, 232, "Atrial septal defect: a hole between the atria. Blood usually shunts left to right into the right heart and lungs.");
  pillRefs.vsd = pill(ox, "VSD", 480, 342, 185, 300, "Ventricular septal defect: a hole between the ventricles. In tetralogy and Eisenmenger physiology blood shunts right to left through it.");
  pillRefs.vein = pill(ox, "Veins", 300, 320, 170, 360, "Systemic veins: return oxygen poor blood from the body to the right atrium.");
  pillRefs.outlet = pill(ox, "Narrowed outlet", 575, 290, 790, 235, "Narrowed pulmonary outlet in tetralogy of Fallot: resistance here drives the right to left shunt and limits lung flow.");
  pillRefs.body = pill(ox, "Body", 630, 413, 790, 410, "Body tissues: use oxygen and return oxygen poor blood. Blue colour means cyanosis.");
}
const gg = {};
const sm = { Qp: 0.6, Qs: 0.7, PAP: 0.4, satArt: 0.9, satR: 0.3, satPA: 0.3, satL: 0.9, cyan: 0.1, shunt: 0.5, mag: 0.5, closed: 0, ductOpen: 0, obstruct: 0, rvLoad: 0.4 };
const chEls = {};
function init() {
  initPanel();
  ["LA", "RA", "LV", "RV"].forEach((c) => { chEls[c] = $("ch" + c); });
  chEls.body = $("bodyRect");
}
function satWord(s) { return s > 0.82 ? "oxygen rich" : s > 0.55 ? "mixed" : "oxygen poor"; }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  ["Qp", "Qs", "PAP", "satArt", "satR", "satPA", "satL", "cyan", "mag", "rvLoad"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.shunt = lerp(sm.shunt, m.shunt, k2); sm.closed = lerp(sm.closed, m.closed, k1); sm.ductOpen = lerp(sm.ductOpen, m.ductOpen, k1); sm.obstruct = lerp(sm.obstruct, m.obstruct, k1);
  /* chamber and body colours by saturation */
  chEls.LA.style.fill = mixc(sm.satL); chEls.LV.style.fill = mixc(sm.satArt); chEls.RA.style.fill = mixc(sm.satR); chEls.RV.style.fill = mixc(sm.satR);
  chEls.RV.style.strokeWidth = (1 + 3 * sm.rvLoad).toFixed(2);
  chEls.body.style.fill = mixc(clamp(0.15 + 0.75 * sm.satArt));
  $("satLA").textContent = satWord(sm.satL); $("satLV").textContent = satWord(sm.satArt); $("satRA").textContent = satWord(sm.satR); $("satRV").textContent = satWord(sm.satR);
  document.querySelectorAll(".sh-lung").forEach((e) => { e.style.opacity = (0.45 + 0.55 * sm.Qp).toFixed(2); });
  /* vessels */
  V.pa.style.stroke = mixc(sm.satPA); V.pab.style.stroke = mixc(sm.satPA);
  V.pa.setAttribute("stroke-width", f1(6 + 6 * sm.Qp)); V.pab.setAttribute("stroke-width", f1(5 + 5 * sm.Qp));
  V.ao.style.stroke = mixc(sm.satArt); V.ao.setAttribute("stroke-width", f1(6 + 5 * sm.Qs));
  V.pvL.style.stroke = mixc(sm.satL); V.pvR.style.stroke = mixc(sm.satL);
  ductPath.style.opacity = (0.12 + 0.88 * sm.ductOpen).toFixed(2); ductPath.setAttribute("stroke-width", f1(4 + 4 * sm.ductOpen));
  sten.style.opacity = sm.obstruct.toFixed(2);
  /* defect holes, close mark, pill visibility */
  const isASD = m.defect === "ASD", showHole = sm.closed < 0.5;
  $("defASD").style.opacity = isASD && showHole ? "1" : "0";
  $("defVSD").style.opacity = !isASD && m.level !== 2 && showHole ? "1" : "0";
  const cpos = m.level === 0 ? [480, 246] : m.level === 2 ? [478, 150] : [480, 342];
  closeG.setAttribute("transform", "translate(" + cpos[0] + " " + cpos[1] + ")"); closeG.setAttribute("opacity", sm.closed.toFixed(2));
  closeNote.setAttribute("opacity", sm.closed.toFixed(2));
  pillRefs.asd.style.opacity = m.level === 0 ? "1" : "0.18";
  pillRefs.vsd.style.opacity = m.level !== 0 && m.level !== 2 ? "1" : "0.18";
  pillRefs.duct.style.opacity = m.level === 2 || sm.ductOpen > 0.3 ? "1" : "0.35";
  pillRefs.outlet.style.opacity = m.level === 4 ? "1" : "0.18";
  /* main circuit particles */
  const colFor = (kind) => kind === "deoxy" ? mixc(0.08) : kind === "pa" ? mixc(sm.satPA) : kind === "oxy" ? mixc(sm.satL) : mixc(sm.satArt);
  dots.forEach((p) => { const s = SEGS[p.seg], fl = s.flow === "Qp" ? sm.Qp : sm.Qs; p.d += dt * (26 + 62 * fl) * p.sp; while (p.d > s.tr.len) { p.d -= s.tr.len; p.seg = (p.seg + 1) % SEGS.length; } const q = SEGS[p.seg].tr.at(p.d / SEGS[p.seg].tr.len); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.style.fill = colFor(SEGS[p.seg].kind); });
  /* shunt particles: direction follows the shunt sign; duct extras only when the duct is usefully open in tetralogy or PDA */
  const route = SHROUTES[m.defect], rtr = track(route), ductRoute = SHROUTES.PDA, dtr = track(ductRoute);
  const ductExtra = sm.ductOpen > 0.25 && (m.level === 4 || m.level === 2) && m.defect !== "PDA";
  shDots.forEach((p) => {
    const useDuct = p.duct && ductExtra, tr = useDuct ? dtr : rtr;
    const active = useDuct ? sm.ductOpen : (sm.closed < 0.5 ? sm.mag : 0);
    p.u = (p.u + dt * (0.12 + 0.5 * active) * (useDuct ? 1 : (sm.shunt < 0 ? -1 : 1)) + 1) % 1;
    const q = tr.at(useDuct ? p.u : (sm.shunt < 0 ? 1 - p.u : p.u));
    p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y));
    p.e.style.fill = useDuct ? mixc(sm.satArt) : (sm.shunt < 0 ? mixc(0.08) : mixc(0.92));
    p.e.setAttribute("opacity", clamp(active * 1.4).toFixed(2));
  });
  /* gauges */
  gg.qp.set(sm.Qp, wordOf(sm.Qp, 0.42, 0.68, ["low", "normal", "high"]));
  gg.pap.set(sm.PAP, wordOf(sm.PAP, 0.35, 0.7, ["normal", "raised", "very high"]));
  gg.sat.set(sm.satArt, wordOf(sm.satArt, 0.6, 0.85, ["low", "reduced", "normal"]));
  gg.qs.set(sm.Qs, wordOf(sm.Qs, 0.45, 0.7, ["low", "reduced", "adequate"]));
}
run({ init, step });
