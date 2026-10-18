/* Tamponade scene: fluid in a stiff sac squeezes the heart; filling, output and the bedside signs follow. */
const HX = SC.HX, HY = SC.HY;
const LAY = { sac: $("sac"), fluid: $("fluid"), ves: $("ves"), heart: $("heart"), parts: $("parts"), signs: $("signs"), over: $("over"), panel: $("panel") };
const DYN = {};
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const venDots = pool(12, () => mk("circle", { class: "sc-p p-ven", r: 3 }, LAY.parts));
const artDots = pool(10, () => mk("circle", { class: "sc-p p-art", r: 3 }, LAY.parts));
const outDots = pool(10, () => mk("circle", { class: "sc-p p-out", r: 3 }, LAY.parts));
const venTrack = track([[322, 106], [322, 182], [304, 224]]);
const artTrack = track([[258, 178], [252, 132], [272, 112], [304, 114]]);
const outTrack = track([[238, 325], [202, 360], [170, 396]]);
function init() {
  DYN.peri = mk("ellipse", { class: "tp-peri", cx: HX, cy: HY, rx: 175, ry: 142 }, LAY.sac);
  DYN.flu = mk("ellipse", { class: "tp-fluid", cx: HX, cy: HY, rx: 120, ry: 92, opacity: "0.5" }, LAY.fluid);
  mk("path", { class: "tp-vein", d: "M322 108V184M322 330V392" }, LAY.ves);
  mk("path", { class: "tp-aorta", d: "M258 182C252 138 268 114 302 112" }, LAY.ves);
  mk("path", { class: "tp-vein", d: "M242 188C214 168 192 166 168 152" }, LAY.ves);
  mk("path", { class: "tp-vein2", d: "M322 108V184M322 330V392" }, LAY.ves);
  mk("path", { class: "tp-aorta2", d: "M258 182C252 138 268 114 302 112" }, LAY.ves);
  const hg = mk("g", {}, LAY.heart); DYN.heartG = hg;
  mk("path", { class: "tp-myo", d: "M0 78C-70 35 -88 -10 -72 -48C-58 -82 -18 -88 0 -55C18 -88 58 -82 72 -48C88 -10 70 35 0 78Z" }, hg);
  mk("ellipse", { class: "tp-chr", cx: -34, cy: -26, rx: 26, ry: 20 }, hg);
  mk("ellipse", { class: "tp-chl", cx: 34, cy: -26, rx: 26, ry: 20 }, hg);
  mk("ellipse", { class: "tp-chr", cx: -32, cy: 34, rx: 28, ry: 24 }, hg);
  mk("ellipse", { class: "tp-chl", cx: 32, cy: 34, rx: 28, ry: 24 }, hg);
  mk("path", { class: "tp-sept", d: "M0 -52V70M-64 2H64" }, hg);
  [["RA", -34, -22], ["LA", 34, -22], ["RV", -32, 38], ["LV", 32, 38]].forEach(([t, x, y]) => { const e = mk("text", { class: "tp-chlab", x, y, "text-anchor": "middle" }, hg); e.textContent = t; });
  const dg = mk("g", { id: "drainG", opacity: "0" }, LAY.parts); DYN.drainG = dg;
  DYN.needle = mk("path", { class: "tp-needle", d: "M170 396L238 325" }, dg);
  mk("rect", { class: "tp-syr", x: 146, y: 388, width: 30, height: 13, rx: 3, transform: "rotate(-46 161 394)" }, dg);
  /* bedside signs: four boxes, graphics only (the pills above them are the labels) */
  const sg = LAY.signs;
  [[600, 108, 150, 132], [770, 108, 160, 132], [600, 284, 150, 96], [770, 284, 160, 96]].forEach(([x, y, w, h]) => mk("rect", { class: "tp-box", x, y, width: w, height: h, rx: 10 }, sg));
  mk("rect", { class: "tp-jug", x: 664, y: 126, width: 22, height: 102, rx: 9 }, sg);
  DYN.jugF = mk("rect", { class: "tp-jugf", x: 667, y: 200, width: 16, height: 25, rx: 7 }, sg);
  mk("circle", { class: "tp-dial", cx: 850, cy: 182, r: 40 }, sg);
  for (let i = 0; i <= 6; i++) { const an = (-115 + i * 38) * Math.PI / 180; mk("path", { class: "tp-sept", d: "M" + f1(850 + 33 * Math.cos(an)) + " " + f1(182 + 33 * Math.sin(an)) + "L" + f1(850 + 38 * Math.cos(an)) + " " + f1(182 + 38 * Math.sin(an)) }, sg); }
  DYN.needleBp = mk("path", { class: "tp-needle", d: "M850 182L850 150" }, sg);
  mk("circle", { class: "tp-dial", cx: 850, cy: 182, r: 4 }, sg);
  const hic = mk("g", { transform: "translate(642 334) scale(0.42)" }, sg);
  mk("path", { class: "tp-hicon", d: "M0 78C-70 35 -88 -10 -72 -48C-58 -82 -18 -88 0 -55C18 -88 58 -82 72 -48C88 -10 70 35 0 78Z" }, hic);
  DYN.arcs = [18, 30, 42].map((r) => mk("path", { class: "tp-arc", d: "M" + (668) + " " + (334 - r * 0.7) + "A" + r + " " + r + " 0 0 1 " + (668) + " " + (334 + r * 0.7) }, sg));
  DYN.breath = mk("path", { class: "tp-breath" }, sg);
  DYN.trace = mk("path", { class: "tp-trace" }, sg);
  /* labels */
  const ox = LAY.over;
  pill(ox, "Pericardial sac", 168, 152, 98, 100, "Pericardium: the stiff sac around the heart. It stretches slowly, but not when fluid collects fast.");
  pill(ox, "Squeezed chambers", 352, 245, 475, 145, "All four chambers are squeezed by the pressure in the sac. They cannot open fully, so they fill poorly. RA and LA are the atria, RV and LV the ventricles.");
  pill(ox, "Fluid in sac", 172, 332, 110, 410, "Fluid or blood in the pericardial sac. A small amount collecting slowly may be tolerated; the same amount collecting fast causes tamponade.");
  const dp = pill(ox, "Drainage", 238, 325, 285, 415, "Draining the fluid out of the sac, by needle (pericardiocentesis) or by surgery. This relieves the pressure and lets the heart fill again."); dp.setAttribute("id", "drain-pill");
  pill(ox, "Raised neck veins", 675, 130, 675, 92, "Raised jugular venous pressure: blood cannot get into the squeezed right heart, so it backs up in the neck veins. Part of the Beck triad.");
  pill(ox, "Low pressure", 850, 134, 850, 92, "Low blood pressure: poor filling means a small stroke volume, so pressure falls. Part of the Beck triad.");
  pill(ox, "Muffled sounds", 650, 320, 675, 268, "Muffled heart sounds: the fluid around the heart deadens the sounds heard with a stethoscope. Part of the Beck triad.");
  pill(ox, "Breathing dip", 850, 322, 850, 268, "Pulsus paradoxus: the pulse and blood pressure dip more than usual as the patient breathes in, because the chambers compete for space in the tight sac.");
  /* gauges */
  const P = LAY.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW(), height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pres", "Sac pressure", "g-pres", "Pressure inside the pericardial sac. It rises steeply when fluid collects faster than the stiff sac can stretch."], ["fill", "Filling", "g-good", "How well the ventricles fill in diastole. Pressure in the sac holds the chambers shut, so filling falls."], ["sv", "Stroke volume", "g-cyt", "Blood pushed out with each beat. Poor filling means a small stroke volume."], ["bp", "Blood pressure", "g-good", "Systemic blood pressure. It falls as stroke volume falls."], ["jvp", "Venous pressure", "g-fl", "Pressure in the neck veins. It rises as blood backs up behind the squeezed right heart."], ["snd", "Heart sounds", "g-snd", "How clearly the heart sounds come through the fluid. A high bar means clear sounds; low means muffled."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
function WW() { return SC.W - 48; }
const sm = { F: 0.5, P: 0.5, Fill: 0.5, SV: 0.5, BP: 0.6, JVP: 0.5, Muf: 0.5, Par: 0.5, drain: 0, sup: 0 };
const acc = { ven: 0, art: 0, out: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.F = lerp(sm.F, m.F, k2); sm.P = lerp(sm.P, m.P, k2); sm.Fill = lerp(sm.Fill, m.Fill, k1); sm.SV = lerp(sm.SV, m.SV, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.JVP = lerp(sm.JVP, m.JVP, k2); sm.Muf = lerp(sm.Muf, m.Muf, k2); sm.Par = lerp(sm.Par, m.Par, k2); sm.drain = lerp(sm.drain, m.drain, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  DYN.flu.setAttribute("rx", f1(104 + 56 * sm.F)); DYN.flu.setAttribute("ry", f1(80 + 46 * sm.F)); DYN.flu.setAttribute("opacity", (0.25 + 0.45 * sm.F).toFixed(2));
  DYN.peri.setAttribute("rx", f1(173 + 4 * sm.F)); DYN.peri.setAttribute("ry", f1(140 + 3 * sm.F));
  const beat = Math.sin(Math.min(3.14, ((tm / 850) % 1) * 3.14));
  const comp = 1 - 0.27 * sm.P, dias = 1 + (0.015 + 0.055 * sm.Fill) * beat;
  DYN.heartG.setAttribute("transform", "translate(" + HX + " " + HY + ") scale(" + (comp * dias).toFixed(3) + " " + (comp * (2 - dias) * 1.0 + comp * 0).toFixed(3) + ")");
  DYN.drainG.setAttribute("opacity", sm.drain.toFixed(2)); $("drain-pill").style.opacity = sm.drain.toFixed(2);
  DYN.needle.setAttribute("stroke-width", (drug === 3 ? 5 : 2.6).toFixed(1));
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
  gg.pres.set(sm.P, wordOf(sm.P, 0.3, 0.62, ["low", "raised", "high"])); gg.fill.set(sm.Fill, wordOf(sm.Fill, 0.35, 0.65, ["poor", "reduced", "good"])); gg.sv.set(sm.SV, wordOf(sm.SV, 0.25, 0.55, ["low", "reduced", "good"]));
  gg.bp.set(sm.BP, wordOf(sm.BP, 0.35, 0.6, ["low", "borderline", "ok"])); gg.jvp.set(sm.JVP, wordOf(sm.JVP, 0.35, 0.62, ["normal", "raised", "high"])); gg.snd.set(1 - sm.Muf, wordOf(sm.Muf, 0.35, 0.62, ["clear", "soft", "muffled"]));
}
run({ init, step });
