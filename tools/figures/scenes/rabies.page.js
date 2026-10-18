/* Rabies scene: virus along nerves to cord and brain, centrifugal spread to salivary glands, antibodies and gauges. */
const layers = { rbcs: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel") };
const mainTrk = track([[200, 330], [310, 306], [402, 262], [466, 248], [492, 200], [492, 150], [560, 138], [640, 168], [660, 200]]);
const centTrk = track([[662, 214], [740, 234], [802, 260], [840, 284]]);
const rbcs = [];
function initRbcs() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(60, 900), y: rnd(404, 418), v: rnd(0.8, 1.2) }); } }
function pool(n, build) { return Array.from({ length: n }, (_, i) => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: i }; }); }
const virus = pool(36, () => mk("circle", { class: "sc-p p-virus", r: 3 }, layers.parts));
const cent = pool(14, () => mk("circle", { class: "sc-p p-virus", r: 2.7 }, layers.parts));
const abs = pool(16, () => mk("circle", { class: "sc-p p-ab", r: 2.6 }, layers.parts));
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
  pill(ox, "Bite", 100, 256, 105, 225, "Animal bite deposits rabies virus in muscle and saliva contaminated tissue.");
  pill(ox, "Muscle", 172, 352, 255, 372, "Muscle at the bite site. Virus enters nearby nerve endings after a long incubation. Wound washing at this stage helps remove virus.");
  pill(ox, "Peripheral nerve", 332, 292, 330, 205, "Peripheral nerve. Virus travels by retrograde axonal transport along sensory and autonomic nerves. The blood stream is not the route.");
  pill(ox, "Spinal cord", 492, 132, 460, 90, "Spinal cord. Virus ascends through the cord toward the brainstem and brain. Prodrome pain or tingling can occur at the bite site.");
  pill(ox, "Brain", 662, 84, 670, 58, "Brain and brainstem. Infected neurons may contain Negri bodies. Dysfunction causes encephalitis with agitation, hydrophobia and autonomic disturbance, then paralysis and coma.");
  pill(ox, "Limbic system", 628, 138, 575, 260, "Limbic system inside the brain. Involvement drives agitation and hydrophobia in the encephalitic form.");
  pill(ox, "Hydrophobia", 742, 132, 820, 110, "Hydrophobia: painful spasm and fear provoked by trying to drink, a hallmark of encephalitic rabies.");
  pill(ox, "Salivary gland", 852, 266, 855, 195, "Salivary glands. Virus spreads outward along nerves to the glands and into saliva, completing the transmission cycle.");
  pill(ox, "No viraemia", 760, 404, 760, 372, "Blood vessel with red cells but no virus. Rabies usually spreads along nerves, not through the blood, so blood tests for virus are not the usual route to diagnosis.");
}
const sm = { local: 0.5, nerve: 0.5, brain: 0.2, limbic: 0.1, dys: 0.1, sal: 0.1, par: 0.1, ab: 0.1, front: 0.4, wash: 0, pep: 0 };
function init() { initRbcs(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.local = lerp(sm.local, m.local, k2); sm.nerve = lerp(sm.nerve, m.nerve, k2); sm.brain = lerp(sm.brain, m.brain, k2); sm.limbic = lerp(sm.limbic, m.limbic, k2); sm.dys = lerp(sm.dys, m.dys, k2); sm.sal = lerp(sm.sal, m.sal, k2); sm.par = lerp(sm.par, m.par, k2); sm.ab = lerp(sm.ab, m.ab, k2); sm.front = lerp(sm.front, m.front, k1); sm.wash = lerp(sm.wash, m.wash, k1); sm.pep = lerp(sm.pep, m.pep, k1);
  const limbicEl = $("limbic"); if (limbicEl) limbicEl.setAttribute("opacity", (0.25 + 0.75 * sm.limbic).toFixed(2));
  const brainG = $("brainG"); if (brainG) { const jx = sm.limbic > 0.4 ? Math.sin(tm / 90) * 2.2 * sm.limbic : 0; brainG.setAttribute("transform", "translate(" + f1(jx) + " 0)"); }
  const hydro = $("hydroDrop"); if (hydro) hydro.setAttribute("opacity", sm.limbic.toFixed(2));
  const muscleG = $("muscleG"); if (muscleG) muscleG.setAttribute("opacity", (1 - 0.35 * sm.par).toFixed(2));
  virus.forEach((p) => { const u = (p.k + tm / 14000) % 1; const pt = mainTrk.at(u); const vis = u < sm.front ? clamp(sm.local + sm.nerve) : 0; p.e.setAttribute("transform", "translate(" + f1(clamp(pt.x, 30, 930)) + " " + f1(clamp(pt.y, 60, 430)) + ")"); p.e.setAttribute("opacity", vis > 0.15 ? "1" : "0"); });
  cent.forEach((p) => { const u = (p.k + tm / 9000) % 1; const pt = centTrk.at(u); p.e.setAttribute("transform", "translate(" + f1(clamp(pt.x, 30, 930)) + " " + f1(clamp(pt.y, 60, 430)) + ")"); p.e.setAttribute("opacity", sm.sal > 0.18 ? "1" : "0"); });
  abs.forEach((p) => { const u = clamp(p.k * 0.85 + 0.05); const pt = mainTrk.at(u); const ox2 = Math.cos(tm / 500 + p.k * 20) * 14, oy2 = Math.sin(tm / 500 + p.k * 20) * 10; p.e.setAttribute("transform", "translate(" + f1(clamp(pt.x + ox2, 30, 930)) + " " + f1(clamp(pt.y + oy2, 60, 430)) + ")"); p.e.setAttribute("opacity", sm.ab > 0.2 ? "1" : "0"); });
  washD.forEach((p) => { const y = 236 + ((tm / 18 + p.k * 180) % 150); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", sm.wash > 0.2 ? "1" : "0"); });
  saliva.forEach((p) => { const y = 318 + ((tm / 22 + p.k * 90) % 62); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(clamp(y, 60, 430)) + ")"); p.e.setAttribute("opacity", sm.sal > 0.25 ? "1" : "0"); });
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 900) r.x = 62; place(r.g, r.x, r.y, 0, 1); });
  gg.nv.set(sm.nerve, wordOf(sm.nerve, 0.3, 0.7, ["early", "spreading", "extensive"])); gg.br.set(sm.brain, wordOf(sm.brain, 0.2, 0.6, ["none", "starting", "severe"])); gg.dy.set(sm.dys, wordOf(sm.dys, 0.25, 0.6, ["calm", "agitated", "severe"]));
  gg.sa.set(sm.sal, wordOf(sm.sal, 0.25, 0.6, ["none", "starting", "heavy"])); gg.pa.set(sm.par, wordOf(sm.par, 0.25, 0.6, ["none", "weakness", "flaccid"])); gg.ab.set(sm.ab, wordOf(sm.ab, 0.3, 0.65, ["low", "rising", "present"]));
}
run({ init, step });
