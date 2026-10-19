/* Tamponade scene: fluid in a stiff sac squeezes the heart; drains remove fluid, fluids support filling. */
const HX = SC.HX, HY = SC.HY;
const LAY = { sac: $("sac"), fluid: $("fluid"), sqz: $("sqz"), ves: $("ves"), heart: $("heartSlot"), parts: $("parts"), signs: $("signs"), over: $("over"), panel: $("panel") };
const DYN = {};
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const venDots = pool(12, () => mk("circle", { class: "sc-p p-ven", r: 3 }, LAY.parts));
const artDots = pool(10, () => mk("circle", { class: "sc-p p-art", r: 3 }, LAY.parts));
const outDots = pool(12, () => mk("circle", { class: "sc-p p-out", r: 3 }, LAY.parts));
const ivDots = pool(8, () => mk("circle", { class: "sc-p p-ivf", r: 2.6 }, LAY.parts));
let heartO = null, capA = null, capB = null, capDrug = -1;
let venTrack = null, artTrack = null, outTrack = null, ivTrack = null;
function initOrgans() {
  heartO = organ(LAY.heart, "heart", HX, HY, 190, {});
  const P = heartO.ports, inP = P.in, aoP = P.aorta || P.out, ivcP = P.ivc;
  const svcTop = [inP[0], inP[1] - 48], ivcEnd = [ivcP[0], ivcP[1] + 45];
  DYN.ivcEnd = ivcEnd;
  const svcD = "M" + f1(svcTop[0]) + " " + f1(svcTop[1]) + "L" + f1(inP[0]) + " " + f1(inP[1]);
  DYN.svc = mk("path", { class: "tp-vein", d: svcD }, LAY.ves);
  DYN.svcHi = mk("path", { class: "tp-vein2", d: svcD }, LAY.ves);
  DYN.ivc = mk("path", { class: "tp-vein", d: "M" + f1(ivcP[0]) + " " + f1(ivcP[1]) + "L" + f1(ivcEnd[0]) + " " + f1(ivcEnd[1]) }, LAY.ves);
  const aoD = "M" + f1(aoP[0]) + " " + f1(aoP[1]) + "C" + f1(aoP[0] - 30) + " " + f1(aoP[1] - 44) + " " + f1(aoP[0] - 70) + " " + f1(aoP[1] - 40) + " " + f1(aoP[0] - 95) + " " + f1(aoP[1] - 18);
  DYN.ao = mk("path", { class: "tp-aorta", d: aoD }, LAY.ves);
  DYN.aoHi = mk("path", { class: "tp-aorta2", d: aoD }, LAY.ves);
  venTrack = track([svcTop, inP]);
  artTrack = track([aoP, [aoP[0] - 30, aoP[1] - 44], [aoP[0] - 70, aoP[1] - 40], [aoP[0] - 95, aoP[1] - 18]]);
  outTrack = track([[216, 356], [261, 370], [306, 384]]);
  ivTrack = track([[54, 388], [110, 404], [ivcEnd[0] - 40, ivcEnd[1] + 8], ivcEnd]);
  DYN.sqz = [];
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * 6.2832 + 0.39;
    DYN.sqz.push(mk("path", { class: "tp-sqz", d: "M" + f1(HX + Math.cos(t) * 118) + " " + f1(HY + Math.sin(t) * 104) + "L" + f1(HX + Math.cos(t) * 138) + " " + f1(HY + Math.sin(t) * 122), opacity: "0" }, LAY.sqz));
  }
}
function initStatic() {
  DYN.peri = mk("ellipse", { class: "tp-peri", cx: HX, cy: HY, rx: 175, ry: 142 }, LAY.sac);
  DYN.flu = mk("ellipse", { class: "tp-fluid", cx: HX, cy: HY, rx: 120, ry: 92, opacity: "0.5" }, LAY.fluid);
  /* drain tube from the sac into a collecting bag (needle or surgical drain by setting) */
  const dg = mk("g", { id: "drainG", opacity: "0" }, LAY.parts); DYN.drainG = dg;
  DYN.tube = mk("path", { class: "tp-needle", d: "M216 356L306 384" }, dg);
  mk("rect", { class: "tp-bag", x: 300, y: 384, width: 54, height: 44, rx: 6 }, dg);
  DYN.bagfill = mk("rect", { class: "tp-bagfill", x: 304, y: 424, width: 46, height: 0, rx: 4 }, dg);
  /* intravenous fluids bag and giving set into the vein below the heart */
  const iv = mk("g", { id: "ivG", opacity: "0" }, LAY.parts); DYN.ivG = iv;
  mk("rect", { class: "tp-ivbag", x: 30, y: 320, width: 48, height: 64, rx: 8 }, iv);
  mk("rect", { class: "tp-ivfill", x: 34, y: 340, width: 40, height: 40, rx: 5 }, iv);
  const ie = DYN.ivcEnd;
  mk("path", { class: "tp-ivline", d: "M54 388L110 404L" + f1(ie[0] - 40) + " " + f1(ie[1] + 8) + "L" + f1(ie[0]) + " " + f1(ie[1]) }, iv);
  /* bedside signs: four boxes, graphics only (the pills above them are the labels) */
  const sg = LAY.signs;
  [[600, 108, 150, 132], [770, 108, 160, 132], [600, 284, 150, 96], [770, 284, 160, 96]].forEach(([x, y, w, h]) => mk("rect", { class: "tp-box", x, y, width: w, height: h, rx: 10 }, sg));
  mk("rect", { class: "tp-jug", x: 664, y: 126, width: 22, height: 102, rx: 9 }, sg);
  DYN.jugF = mk("rect", { class: "tp-jugf", x: 667, y: 200, width: 16, height: 25, rx: 7 }, sg);
  mk("circle", { class: "tp-dial", cx: 850, cy: 182, r: 40 }, sg);
  for (let i = 0; i <= 6; i++) { const an = (-115 + i * 38) * Math.PI / 180; mk("path", { class: "tp-tick", d: "M" + f1(850 + 33 * Math.cos(an)) + " " + f1(182 + 33 * Math.sin(an)) + "L" + f1(850 + 38 * Math.cos(an)) + " " + f1(182 + 38 * Math.sin(an)) }, sg); }
  DYN.needleBp = mk("path", { class: "tp-needle", d: "M850 182L850 150" }, sg);
  mk("circle", { class: "tp-dial", cx: 850, cy: 182, r: 4 }, sg);
  mk("circle", { class: "tp-src", cx: 652, cy: 334, r: 4 }, sg);
  DYN.arcs = [18, 30, 42].map((r) => mk("path", { class: "tp-arc", d: "M" + (668) + " " + (334 - r * 0.7) + "A" + r + " " + r + " 0 0 1 " + (668) + " " + (334 + r * 0.7) }, sg));
  DYN.breath = mk("path", { class: "tp-breath" }, sg);
  DYN.trace = mk("path", { class: "tp-trace" }, sg);
}
function capText(d) {
  if (d === 1) return ["Needle drainage removes fluid.", "The heart fills and pressure recovers."];
  if (d === 2) return ["Fluids only add volume for a short time.", "The fluid is still squeezing the heart."];
  if (d === 3) return ["Surgery drains the fluid fully.", "The heart fills and pressure recovers."];
  return ["No treatment.", "The squeezed heart cannot fill."];
}
function initPanel() {
  const ox = LAY.over;
  pill(ox, "Sac", 161, 155, 95, 100, "Pericardium: the stiff sac around the heart. It stretches slowly, but not when fluid collects fast.");
  pill(ox, "Heart", 360, 245, 475, 150, "Heart: every chamber is squeezed by the pressure in the sac, so none can open fully and filling falls.");
  pill(ox, "Fluid", 225, 345, 80, 232, "Fluid or blood in the pericardial sac. A small amount collecting slowly may be tolerated; the same amount collecting fast causes tamponade.");
  const dp = pill(ox, "Drain", 262, 373, 200, 418, "Draining the fluid out of the sac, by needle or by surgery. This relieves the pressure and lets the heart fill again."); dp.setAttribute("id", "drain-pill");
  pill(ox, "Neck veins", 675, 150, 675, 92, "Raised jugular venous pressure: blood cannot get into the squeezed right heart, so it backs up in the neck veins. Part of the Beck triad.");
  pill(ox, "Pressure", 872, 162, 850, 92, "Low blood pressure: poor filling means a small stroke volume, so pressure falls. Part of the Beck triad.");
  pill(ox, "Sounds", 648, 330, 675, 268, "Muffled heart sounds: the fluid around the heart deadens the sounds heard with a stethoscope. Part of the Beck triad.");
  pill(ox, "Breath dip", 850, 340, 850, 268, "Pulsus paradoxus: the pulse and blood pressure dip more than usual as the patient breathes in, because the chambers compete for space in the tight sac.");
  capA = mk("text", { class: "tp-cap", x: 600, y: 414 }, ox); capB = mk("text", { class: "tp-cap", x: 600, y: 430 }, ox);
  const t = capText(0); capA.textContent = t[0]; capB.textContent = t[1];
  const ivHot = mk("g", { class: "hot", tabindex: "0", "data-info": "Intravenous fluids: extra volume that supports filling for a short time. It does not remove the fluid, so it does not fix the cause." }, ox);
  mk("rect", { x: 30, y: 320, width: 48, height: 64, fill: "#ffffff", "fill-opacity": "0", stroke: "none" }, ivHot);
  const dgHot = mk("g", { class: "hot", tabindex: "0", "data-info": "Drain bag: fluid leaving the sac through the drain. The bag fills as the pressure is relieved." }, ox);
  mk("rect", { x: 300, y: 384, width: 54, height: 44, fill: "#ffffff", "fill-opacity": "0", stroke: "none" }, dgHot);
  const P = LAY.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW(), height: 142, rx: 14 }, P);
  const pt = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); pt.textContent = "The patient";
  [["pres", "Sac pressure", "g-pres", "Pressure inside the pericardial sac. It rises steeply when fluid collects faster than the stiff sac can stretch."], ["fill", "Filling", "g-good", "How well the ventricles fill in diastole. Pressure in the sac holds the chambers shut, so filling falls."], ["sv", "Stroke volume", "g-cyt", "Blood pushed out with each beat. Poor filling means a small stroke volume."], ["bp", "Blood pressure", "g-good", "Systemic blood pressure. It falls as stroke volume falls."], ["jvp", "Venous pressure", "g-fl", "Pressure in the neck veins. It rises as blood backs up behind the squeezed right heart."], ["snd", "Heart sounds", "g-snd", "How clearly the heart sounds come through the fluid. A high bar means clear sounds; low means muffled."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function WW() { return SC.W - 48; }
const sm = { F: 0.5, P: 0.5, Fill: 0.5, SV: 0.5, BP: 0.6, JVP: 0.5, Muf: 0.5, Par: 0.5, drain: 0, sup: 0, bag: 0 };
const acc = { ven: 0, art: 0, out: 0, iv: 0 };
function init() { initOrgans(); initStatic(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.F = lerp(sm.F, m.F, k2); sm.P = lerp(sm.P, m.P, k2); sm.Fill = lerp(sm.Fill, m.Fill, k1); sm.SV = lerp(sm.SV, m.SV, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.JVP = lerp(sm.JVP, m.JVP, k2); sm.Muf = lerp(sm.Muf, m.Muf, k2); sm.Par = lerp(sm.Par, m.Par, k2); sm.drain = lerp(sm.drain, m.drain, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  sm.bag = lerp(sm.bag, drug === 3 ? 0.9 : drug === 1 ? 0.55 : 0, k2);
  DYN.flu.setAttribute("rx", f1(104 + 56 * sm.F)); DYN.flu.setAttribute("ry", f1(80 + 46 * sm.F)); DYN.flu.setAttribute("opacity", (0.25 + 0.45 * sm.F).toFixed(2));
  DYN.peri.setAttribute("rx", f1(173 + 4 * sm.F)); DYN.peri.setAttribute("ry", f1(140 + 3 * sm.F));
  DYN.peri.setAttribute("stroke-width", f1(2.6 + 2.2 * sm.P));
  DYN.sqz.forEach((e) => e.setAttribute("opacity", (0.85 * sm.P).toFixed(2)));
  const beat = Math.sin(Math.min(3.14, ((tm / 850) % 1) * 3.14));
  const comp = 1 - 0.27 * sm.P, dias = 1 + (0.015 + 0.055 * sm.Fill) * beat;
  place(heartO.g, HX, HY, 0, comp * dias);
  DYN.svc.setAttribute("stroke-width", f1(13 + 7 * sm.sup)); DYN.svcHi.setAttribute("stroke-width", f1(4.5 + 2 * sm.sup));
  DYN.ao.setAttribute("stroke-width", f1(10 + 8 * sm.SV)); DYN.aoHi.setAttribute("stroke-width", f1(3 + 3 * sm.SV));
  DYN.drainG.setAttribute("opacity", sm.drain.toFixed(2)); $("drain-pill").style.opacity = sm.drain.toFixed(2);
  DYN.tube.setAttribute("class", drug === 3 ? "tp-tube" : "tp-needle");
  const bh = sm.bag * 36; DYN.bagfill.setAttribute("y", f1(424 - bh)); DYN.bagfill.setAttribute("height", f1(bh));
  DYN.ivG.setAttribute("opacity", sm.sup.toFixed(2));
  const jh = (0.12 + 0.88 * sm.JVP) * 96;
  DYN.jugF.setAttribute("y", f1(226 - jh)); DYN.jugF.setAttribute("height", f1(jh)); DYN.jugF.setAttribute("x", f1(675 - (8 + 3 * sm.JVP))); DYN.jugF.setAttribute("width", f1(16 + 6 * sm.JVP));
  const an = (-115 + 230 * sm.BP) * Math.PI / 180;
  DYN.needleBp.setAttribute("d", "M850 182L" + f1(850 + 30 * Math.cos(an)) + " " + f1(182 + 30 * Math.sin(an)));
  const sndA = (1 - sm.Muf) * (0.25 + 0.75 * beat);
  DYN.arcs.forEach((e) => e.setAttribute("opacity", sndA.toFixed(2)));
  let bd = "", td = "";
  for (let i = 0; i <= 48; i++) { const x = 782 + i * 2.9, insp = Math.max(0, Math.sin(i * 0.07 - tm / 900));
    bd += (i ? "L" : "M") + f1(x) + " " + f1(304 - 5 * Math.sin(i * 0.12 - tm / 900));
    const wv = Math.pow(Math.max(0, Math.sin(i * 0.55 - tm / 130)), 3), amp = (5 + 19 * sm.BP) * (1 - sm.Par * 0.62 * insp);
    td += (i ? "L" : "M") + f1(x) + " " + f1(360 - amp * wv); }
  DYN.breath.setAttribute("d", bd); DYN.trace.setAttribute("d", td);
  acc.ven += dt * (0.6 + 3.2 * sm.Fill + 1.6 * sm.sup); while (acc.ven >= 1) { acc.ven--; const p = free(venDots); if (p) emit(p, 0, 0, 0, 0, Math.random()); }
  venDots.forEach((p) => { if (!p.on) return; p.t += dt * (0.25 + 0.5 * sm.Fill); const q = venTrack.at(p.t % 1); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.t > 1.4) kill(p); });
  acc.art += dt * (0.5 + 4.5 * sm.SV); while (acc.art >= 1) { acc.art--; const p = free(artDots); if (p) emit(p, 0, 0, 0, 0, Math.random()); }
  artDots.forEach((p) => { if (!p.on) return; p.t += dt * (0.3 + 0.6 * sm.SV); const q = artTrack.at(p.t % 1); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.t > 1.4) kill(p); });
  acc.out += dt * sm.drain * 6; while (acc.out >= 1) { acc.out--; const p = free(outDots); if (p) emit(p, 0, 0, 0, 0, Math.random()); }
  outDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.8; const q = outTrack.at(p.t % 1); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.t > 1.2) kill(p); });
  acc.iv += dt * sm.sup * 5; while (acc.iv >= 1) { acc.iv--; const p = free(ivDots); if (p) emit(p, 0, 0, 0, 0, Math.random()); }
  ivDots.forEach((p) => { if (!p.on) return; p.t += dt * 0.7; const q = ivTrack.at(p.t % 1); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.t > 1.2) kill(p); });
  gg.pres.set(sm.P, wordOf(sm.P, 0.3, 0.62, ["low", "raised", "high"])); gg.fill.set(sm.Fill, wordOf(sm.Fill, 0.35, 0.65, ["poor", "reduced", "good"])); gg.sv.set(sm.SV, wordOf(sm.SV, 0.25, 0.55, ["low", "reduced", "good"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.6, ["low", "borderline", "ok"])); gg.jvp.set(sm.JVP, wordOf(sm.JVP, 0.35, 0.62, ["normal", "raised", "high"])); gg.snd.set(1 - sm.Muf, wordOf(sm.Muf, 0.35, 0.62, ["clear", "soft", "muffled"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capA.textContent !== t[0]) capA.textContent = t[0]; if (capB.textContent !== t[1]) capB.textContent = t[1]; }
}
run({ init, step });
