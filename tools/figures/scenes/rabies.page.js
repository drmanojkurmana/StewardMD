/* Rabies scene: bite virus in muscle, retrograde nerve travel through a ganglion to cord and brain, centrifugal spread to saliva glands, antibodies and gauges. */
const layers = { dyn: $("dyn"), rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel") };
let muscleO = null, gangO = null, brainO = null;
let mainTrk = null, centTrk = null;
let washEl = null, shieldEl = null, bglowEl = null, gglowEl = null, limbicEl = null;
let negri = [];
let brainCx = 668, brainCy = 161, brainBaseT = "";
let capEl = null, capDrug = -1;
const BITE = [130, 262], CORDMID = [492, 260], CORDTOP = [492, 136], GLAND = [852, 300];
function initOrgans() {
  const D = layers.dyn;
  muscleO = organ($("muscleSlot"), "muscle", 132, 320, 175, {});
  gangO = organ($("gangSlot"), "ganglion", 360, 282, 105, {});
  brainO = organ($("brainSlot"), "brain", 685, 175, 215, {});
  const MP = muscleO.ports, GP = gangO.ports, BP = brainO.ports;
  brainCx = BP.parenchyma[0]; brainCy = BP.parenchyma[1];
  brainBaseT = brainO.g.getAttribute("transform") || "";
  $("axonP1").setAttribute("d", "M" + f1(MP.fibre[0]) + " " + f1(MP.fibre[1]) + " L" + f1(GP.in[0]) + " " + f1(GP.in[1]));
  $("axonP2").setAttribute("d", "M" + f1(GP.out[0]) + " " + f1(GP.out[1]) + " L" + f1(CORDMID[0]) + " " + f1(CORDMID[1]));
  $("tractP").setAttribute("d", "M" + f1(CORDTOP[0]) + " " + f1(CORDTOP[1]) + " C" + f1(CORDTOP[0] + 56) + " " + f1(CORDTOP[1] - 8) + " " + f1(BP.carotid[0] - 34) + " " + f1(BP.carotid[1] - 68) + " " + f1(BP.carotid[0]) + " " + f1(BP.carotid[1]));
  $("centP").setAttribute("d", "M" + f1(BP.cereb[0]) + " " + f1(BP.cereb[1]) + " C800 235 812 258 " + f1(GLAND[0] - 7) + " " + f1(GLAND[1] - 8));
  mainTrk = track([BITE, MP.belly, MP.out, GP.in, GP.out, CORDMID, CORDTOP, BP.carotid, BP.parenchyma]);
  centTrk = track([BP.cereb, [800, 248], GLAND]);
  washEl = mk("rect", { class: "rb-wash", x: 58, y: 238, width: 156, height: 142, rx: 14, opacity: "0" }, D);
  shieldEl = mk("circle", { class: "rb-shield", cx: 135, cy: 305, r: 62, opacity: "0" }, D);
  bglowEl = mk("ellipse", { class: "rb-bglow", cx: f1(brainCx), cy: f1(brainCy), rx: 72, ry: 58, opacity: "0" }, D);
  limbicEl = mk("ellipse", { class: "rb-limbic", cx: f1(brainCx - 18), cy: f1(brainCy + 8), rx: 36, ry: 22, opacity: "0.2" }, D);
  gglowEl = mk("circle", { class: "rb-gglow", cx: GLAND[0], cy: GLAND[1], r: 44, opacity: "0" }, D);
  negri = [[-15, -10], [10, -14], [18, 8], [-8, 14]].map((o) => mk("circle", { class: "rb-negri", cx: f1(brainCx + o[0]), cy: f1(brainCy + o[1]), r: 3.4, opacity: "0" }, D));
}
function capText(d) {
  if (d === 1) return "Wound washing flushes virus from the bite. Less virus reaches the nerves.";
  if (d === 2) return "Vaccine plus immunoglobulin traps virus at the bite. The brain stays safer.";
  if (d === 3) return "Late care comforts but cannot clear virus once it reached the brain.";
  return "No treatment. Virus climbs nerves to the brain, then spreads out into saliva.";
}
/* tracks are built in initOrgans from the muscle, ganglion and brain ports (see above) */
const rbcs = [];
function initRbcs() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(60, 900), y: rnd(404, 418), v: rnd(0.8, 1.2) }); } }
function pool(n, build) { return Array.from({ length: n }, (_, i) => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: i }; }); }
const virus = pool(36, () => mk("circle", { class: "sc-p p-virus", r: 3 }, layers.parts));
const cent = pool(14, () => mk("circle", { class: "sc-p p-virus", r: 2.7 }, layers.parts));
const abs = pool(18, () => mk("circle", { class: "sc-p p-ab", r: 2.6 }, layers.parts));
const washD = pool(14, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const saliva = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
virus.forEach((p, i) => { p.k = i / virus.length; });
cent.forEach((p, i) => { p.k = i / cent.length; });
abs.forEach((p, i) => { p.k = i / abs.length; });
washD.forEach((p, i) => { p.k = i / washD.length; p.x = 70 + (i * 37) % 130; });
saliva.forEach((p, i) => { p.k = i / saliva.length; p.x = 822 + (i * 23) % 62; });
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["nv", "Nerve spread", "g-virus", "Virus travelling backwards along peripheral nerves toward the cord. There is no spread through the blood."], ["br", "Brain virus", "g-brain", "Virus reaching the spinal cord, brainstem and brain."], ["dy", "Dysfunction", "g-limbic", "Neuronal dysfunction with agitation and hydrophobia when limbic areas are involved, rather than widespread destruction."], ["sa", "Saliva spread", "g-gland", "Centrifugal spread along nerves to the salivary glands, making saliva infectious."], ["pa", "Paralysis", "g-cord", "Flaccid paralysis and coma as the illness advances."], ["ab", "Antibodies", "g-good", "Antibodies from vaccine plus immunoglobulin before symptoms, or late natural antibodies after infection is established."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bite", 130, 260, 100, 210, "Bite wound. Virus from saliva rests in muscle for a while. Washing here flushes virus away.");
  pill(ox, "Muscle", 60, 318, 72, 356, "Muscle at the bite. Virus enters nearby nerve endings. Washing and antibodies act here.");
  pill(ox, "Nerve", 238, 300, 255, 210, "Peripheral nerve. Virus travels backward along the axon toward the cord. Blood is not the route.");
  pill(ox, "Cord", 492, 150, 496, 80, "Spinal cord. Virus climbs toward the brain. Pain or tingling at the bite can mark this stage.");
  pill(ox, "Brain", 685, 95, 685, 62, "Brain and brainstem. Infected cells can hold Negri bodies. Trouble here causes agitation and fear of water, then weakness and coma.");
  pill(ox, "Saliva", 858, 277, 858, 205, "Salivary gland. Virus travels back out along nerves into saliva, ready to pass on.");
  pill(ox, "No virus in blood", 740, 411, 740, 372, "Blood vessel. Red cells drift but carry no virus. Rabies travels in nerves, not in blood.");
  capEl = mk("text", { class: "rb-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { local: 0.5, nerve: 0.5, brain: 0.2, limbic: 0.1, dys: 0.1, sal: 0.1, par: 0.1, ab: 0.1, front: 0.4, wash: 0, pep: 0, late: 0 };
function init() { initOrgans(); initRbcs(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  ["local", "nerve", "brain", "limbic", "dys", "sal", "par", "ab", "front", "wash", "pep", "late"].forEach((key) => { sm[key] = lerp(sm[key], m[key], key === "front" || key === "wash" || key === "pep" || key === "late" ? k1 : k2); });
  washEl.setAttribute("opacity", (sm.wash * 0.45).toFixed(2));
  shieldEl.setAttribute("opacity", (sm.pep * 0.9).toFixed(2));
  bglowEl.setAttribute("opacity", (sm.brain * 0.4).toFixed(2));
  limbicEl.setAttribute("opacity", (0.2 + 0.8 * sm.limbic).toFixed(2));
  gglowEl.setAttribute("opacity", (sm.sal * 0.35).toFixed(2));
  negri.forEach((e) => { e.setAttribute("opacity", sm.brain.toFixed(2)); });
  muscleO.g.style.opacity = (1 - 0.3 * sm.par).toFixed(2);
  const jx = sm.limbic > 0.4 ? Math.sin(tm / 90) * 2.2 * sm.limbic * (1 - 0.6 * sm.late) : 0;
  brainO.g.setAttribute("transform", brainBaseT + (jx ? " translate(" + f1(jx) + " 0)" : ""));
  const hydro = $("hydroDrop"); if (hydro) hydro.setAttribute("opacity", sm.limbic.toFixed(2));
  virus.forEach((p) => {
    const uf = (p.k + tm / 14000) % 1;
    const trapped = sm.pep > 0.25 && p.k < sm.pep * 0.45;
    const flushed = !trapped && sm.wash > 0.2 && p.k < sm.wash * 0.5 && uf < 0.22;
    if (trapped) {
      const pt = mainTrk.at(p.k * 0.6);
      place(p.e, pt.x, pt.y, tm / 6, 0.45);
      p.e.setAttribute("opacity", "0.6");
    } else if (flushed) {
      p.e.setAttribute("opacity", "0");
    } else {
      const pt = mainTrk.at(uf);
      place(p.e, pt.x, pt.y, tm / 6, 1);
      p.e.setAttribute("opacity", uf < sm.front ? "1" : "0");
    }
  });
  cent.forEach((p) => { const u = (p.k + tm / 9000) % 1; const pt = centTrk.at(u); p.e.setAttribute("transform", "translate(" + f1(clamp(pt.x, 30, 930)) + " " + f1(clamp(pt.y, 60, 430)) + ")"); p.e.setAttribute("opacity", sm.sal > 0.18 ? "1" : "0"); });
  abs.forEach((p, i) => {
    const frac = i / abs.length;
    let px, py;
    if (sm.pep > 0.3) {
      const q = mainTrk.at(Math.min(0.32, frac * 0.34));
      px = q.x + Math.cos(tm / 500 + i * 2.4) * 8; py = q.y + Math.sin(tm / 500 + i * 2.4) * 8;
    } else if (sm.late > 0.3 || sm.brain > 0.5) {
      px = brainCx + Math.cos(tm / 650 + i * 2.399) * 36; py = brainCy + Math.sin(tm / 650 + i * 2.399) * 27;
    } else {
      const q = mainTrk.at(0.04 + frac * 0.2);
      px = q.x + Math.cos(tm / 500 + i) * 10; py = q.y + Math.sin(tm / 500 + i) * 8;
    }
    place(p.e, px, py, 0, 1);
    p.e.setAttribute("opacity", frac < sm.ab + 0.06 ? "1" : "0");
  });
  washD.forEach((p) => { const y = 244 + ((tm / 18 + p.k * 170) % 130); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", sm.wash > 0.2 ? "1" : "0"); });
  saliva.forEach((p) => { const y = 322 + ((tm / 22 + p.k * 80) % 58); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(y, 60, 430)) + ")"); p.e.setAttribute("opacity", sm.sal > 0.25 ? "1" : "0"); });
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 900) r.x = 62; place(r.g, r.x, r.y, 0, 1); });
  gg.nv.set(sm.nerve, wordOf(sm.nerve, 0.3, 0.7, ["early", "spreading", "extensive"])); gg.br.set(sm.brain, wordOf(sm.brain, 0.2, 0.6, ["none", "starting", "severe"])); gg.dy.set(sm.dys, wordOf(sm.dys, 0.25, 0.6, ["calm", "agitated", "severe"]));
  gg.sa.set(sm.sal, wordOf(sm.sal, 0.25, 0.6, ["none", "starting", "heavy"])); gg.pa.set(sm.par, wordOf(sm.par, 0.25, 0.6, ["none", "weakness", "flaccid"])); gg.ab.set(sm.ab, wordOf(sm.ab, 0.3, 0.65, ["low", "rising", "present"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
