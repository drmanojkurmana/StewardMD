/* Vestibular scene: canalith in the posterior canal, endolymph, inflamed nerve, vestibular nuclei, VOR impulses, nystagmus and gauges. */
const layers = { parts: $("parts"), over: $("over"), panel: $("panel"), infl: $("inflCell") };
const inflCell = cell(layers.infl, { cls: "neut", r: 13, nuc: 0.5, seed: 7, wob: 0.14 });
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, a: 0, u: 0 }; }); }
const cans = pool(12, () => mk("circle", { class: "vt-can", r: 4 }, layers.parts));
const endos = pool(14, () => mk("circle", { class: "vt-endo", r: 2.4 }, layers.parts));
const imps = pool(16, () => mk("circle", { class: "vt-imp", r: 3 }, layers.parts));
const vTrack = track([[202, 188], [300, 178], [415, 174], [465, 172], [560, 152], [650, 162], [740, 162]]);
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["can", "Canalith", "g-eos", "Loose otoconia crystals inside a semicircular canal. In BPPV they sit mainly in the posterior canal and move with head position."], ["inf", "Inflammation", "g-cyt", "Inflammation of the vestibular nerve, as in vestibular neuritis. One side sends less signal than the other."], ["hyd", "Hydrops", "g-fl", "Excess endolymph fluid distending the inner ear, as in Meniere disease. It brings ear fullness with episodic vertigo."], ["ver", "Vertigo", "g-bad", "The false sense that the room is spinning, caused by unequal vestibular signals from the two sides."], ["nys", "Nystagmus", "g-cyt", "Involuntary eye beating driven by the vestibulo-ocular reflex. The eyes drift one way and flick back."], ["bal", "Balance", "g-good", "Steadiness from balanced vestibular signals and central compensation over time."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Canals", 205, 108, 210, 80, "Semicircular canals: three fluid filled hoops that sense head rotation in different planes.");
  pill(ox, "Posterior canal", 118, 122, 100, 102, "Posterior canal: the canal most often holding loose canalith crystals in BPPV. Position changes move them and trigger brief vertigo.");
  pill(ox, "Otoliths", 172, 214, 105, 318, "Otolith organs: the utricle and saccule. Tiny otoconia crystals on them sense gravity. Loose crystals can enter a canal.");
  pill(ox, "Cochlea", 268, 252, 292, 288, "Cochlea: the hearing organ, sharing fluid spaces with the balance organs. In Meniere disease excess endolymph affects both.");
  pill(ox, "Vestibular nerve", 300, 184, 338, 102, "Vestibular nerve: carries balance signals from the canals and otolith organs to the brainstem. Inflammation here causes vestibular neuritis.");
  pill(ox, "Vestibular nuclei", 465, 146, 465, 92, "Vestibular nuclei: brainstem relay nuclei. They compare signals from both ears and drive eye and posture reflexes.");
  pill(ox, "Cerebellum", 530, 298, 600, 330, "Cerebellum: helps calibrate balance reflexes and central compensation. Central lesions here can also cause vertigo.");
  pill(ox, "Nystagmus", 746, 138, 745, 98, "Nystagmus: the eyes drift slowly then flick back. Peripheral nystagmus usually beats one way; vertical or changing nystagmus suggests a central cause.");
  pill(ox, "VOR reflex", 746, 204, 745, 262, "Vestibulo-ocular reflex (VOR): vestibular nuclei move the eyes opposite to head movement so gaze stays steady. Unequal signals drive nystagmus.");
}
const sm = { C: 0.9, I: 0.1, Hy: 0.1, V: 0.7, N: 0.7, Bln: 0.4, F: 0.1, sup: 0, epl: 0 };
const acc = { imp: 0 };
function init() { initPanel(); cans.forEach((p, i) => { p.a = i * 0.52; }); endos.forEach((p, i) => { p.a = i * 0.45; p.on = true; p.e.setAttribute("opacity", "1"); }); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.C = lerp(sm.C, m.C, k2); sm.I = lerp(sm.I, m.I, k2); sm.Hy = lerp(sm.Hy, m.Hy, k2); sm.V = lerp(sm.V, m.V, k1); sm.N = lerp(sm.N, m.N, k1); sm.Bln = lerp(sm.Bln, m.Bln, k2); sm.F = lerp(sm.F, m.F, k2); sm.sup = lerp(sm.sup, m.sup, k1); sm.epl = lerp(sm.epl, m.epl, k1);
  /* canalith crystals travelling in the posterior canal */
  const want = Math.round(sm.C * cans.length);
  cans.forEach((p, i) => { const on = i < want; if (!on) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.a += dt * (0.35 + sm.V * 0.9 + sm.epl * 0.7); const x = 145 + Math.cos(p.a) * 58, y = 175 + Math.sin(p.a) * 58; p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); });
  /* endolymph drift in the horizontal canal */
  endos.forEach((p) => { p.a += dt * (0.25 + sm.Hy * 0.7); const x = 175 + Math.cos(p.a) * 55, y = 235 + Math.sin(p.a) * 17; p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", (0.35 + 0.65 * clamp(0.3 + sm.Hy)).toFixed(2)); });
  /* hydrops distends the saccule and cochlea */
  const sac = 1 + 0.55 * sm.Hy; $("saccule").setAttribute("transform", "translate(" + f1(172 * (1 - sac)) + " " + f1(202 * (1 - sac)) + ") scale(" + sac.toFixed(3) + ")");
  const coc = 1 + 0.22 * sm.Hy; $("cochleaG").setAttribute("transform", "translate(" + f1(268 * (1 - coc)) + " " + f1(228 * (1 - coc)) + ") scale(" + coc.toFixed(3) + ")");
  /* inflamed nerve and a nearby immune cell in neuritis */
  $("nerve").setAttribute("stroke-width", f1(5 + 5 * sm.I));
  place(inflCell, 330, 218, Math.sin(tm / 500) * 8, 0.15 + 0.85 * sm.I); inflCell.style.opacity = sm.I > 0.08 ? 1 : 0;
  const ns = 1 + 0.12 * sm.V * Math.sin(tm / 280); $("nuclei").setAttribute("transform", "translate(" + f1(465 * (1 - ns)) + " " + f1(175 * (1 - ns)) + ") scale(" + ns.toFixed(3) + ")");
  /* VOR impulses from ear to nuclei to eyes */
  acc.imp += dt * (2 + 7 * m.drive); let spawned = 0;
  imps.forEach((p) => { if (!p.on && acc.imp >= 1 && spawned < 2) { acc.imp--; spawned++; p.on = true; p.u = 0; p.e.setAttribute("opacity", "1"); } if (!p.on) return; p.u += dt * (0.12 + 0.1 * sm.V); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); return; } const q = vTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* nystagmus: slow drift then fast flick back, in both eyes */
  const cyc = ((tm * (0.4 + sm.N * 1.4)) % 900) / 900, saw = cyc < 0.78 ? (cyc / 0.78 - 0.5) : (0.5 - (cyc - 0.78) / 0.22 * 1);
  const ix = saw * 20 * sm.N, iy = Math.sin(tm / 700) * 2 * sm.N;
  $("irisL").setAttribute("transform", "translate(" + f1(ix) + " " + f1(iy) + ")"); $("irisR").setAttribute("transform", "translate(" + f1(ix) + " " + f1(iy) + ")");
  $("headArc").setAttribute("opacity", (0.25 + 0.75 * sm.V).toFixed(2));
  gg.can.set(sm.C, wordOf(sm.C, 0.25, 0.6, ["none", "some", "many"])); gg.inf.set(sm.I, wordOf(sm.I, 0.25, 0.6, ["none", "some", "marked"])); gg.hyd.set(sm.Hy, wordOf(sm.Hy, 0.25, 0.6, ["normal", "raised", "high"]));
  gg.ver.set(sm.V, wordOf(sm.V, 0.3, 0.6, ["settled", "mild", "strong"])); gg.nys.set(sm.N, wordOf(sm.N, 0.25, 0.55, ["none", "present", "strong"])); gg.bal.set(sm.Bln, wordOf(sm.Bln, 0.4, 0.65, ["poor", "unsteady", "steady"]));
}
run({ init, step });
