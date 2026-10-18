/* Vestibular scene: loose crystals, an inflamed nerve and inner ear fluid drive unequal
 * balance signals. Each treatment acts on the drawing: Epley guides crystals out of the
 * posterior canal, suppressant dots sit on the relay nuclei while the signal fades, and
 * less salt shrinks inner ear fluid. A caption line states what is happening. */
var layers = { parts: $("parts"), over: $("over"), panel: $("panel"), cells: $("cells"), halo: $("hydroHalo"), guide: $("epleyPath"), nerve: $("nerve"), hot: $("nerveHot"), nuc: $("nuclei"), vor: $("vor"), spin: $("spinG") };
var POST = { x: 150, y: 182, r: 56 };
var brainO = null, BP = null, ncx = 520, ncy = 232, cerx = 560, cery = 240;
var trImp = null, trExit = null;
var capEl = null, capKey = "";
var blockers = [];
var imm = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, a: 0, u: 0, mode: 0 }; }); }
const cans = pool(12, () => mk("circle", { class: "vt-can", r: 4.5 }, layers.parts));
const endos = pool(14, () => mk("circle", { class: "vt-endo", r: 2.4 }, layers.parts));
const imps = pool(16, () => mk("circle", { class: "vt-imp", r: 3 }, layers.parts));
const gg = {};
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 508, 192, 178, {});
  BP = brainO.ports;
  const st = BP.stem || BP.parenchyma;
  ncx = Math.round(st[0] - 6); ncy = Math.round(st[1] - 24);
  const ce = BP.cereb || BP.parenchyma;
  cerx = Math.round(ce[0]); cery = Math.round(ce[1]);
  const nd = "M199 196 C280 186 350 184 " + ncx + " " + ncy;
  layers.nerve.setAttribute("d", nd);
  layers.hot.setAttribute("d", nd);
  layers.vor.setAttribute("d", "M" + ncx + " " + ncy + " C" + (ncx + 60) + " " + (ncy - 10) + " 620 178 656 184");
  trImp = track([[199, 196], [290, 187], [380, 188], [ncx, ncy], [600, 182], [656, 184], [700, 188]]);
  trExit = track([[150, 238], [132, 260], [140, 280], [165, 280], [188, 252], [188, 208]]);
}
function capText(l, d) {
  if (d === 3) return l === 0 ? "Epley manoeuvre guides the crystals out of the canal. Spinning settles." : "Epley manoeuvre moves crystals, not this cause. Little changes here.";
  if (d === 1) {
    if (l === 1) return "Suppressant calms spinning for a short course. Balance stays unsteady for now.";
    if (l === 2) return "Suppressant calms each spell but fluid stays. Fullness stays.";
    return "Suppressant damps the signal for a short course. Spinning eases but crystals stay.";
  }
  if (d === 2) return l === 2 ? "Less salt lowers inner ear fluid. Fullness eases and spells settle." : "Salt restriction suits extra fluid, not this cause. Little changes here.";
  if (l === 1) return "No treatment. The inflamed nerve misfires and the eyes flick back and forth.";
  if (l === 2) return "No treatment. Extra fluid swells the inner ear. Fullness and spinning stay.";
  return "No treatment. Loose crystals drift in the canal and the eyes flick back and forth.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["can", "Canalith", "g-eos", "Loose otoconia crystals inside a semicircular canal. In BPPV they sit mainly in the posterior canal and move with head position."], ["inf", "Inflammation", "g-cyt", "Inflammation of the vestibular nerve, as in vestibular neuritis. One side sends less signal than the other."], ["hyd", "Hydrops", "g-fl", "Excess endolymph fluid distending the inner ear, as in Meniere disease. It brings ear fullness with episodic vertigo."], ["ver", "Vertigo", "g-bad", "The false sense that the room is spinning, caused by unequal vestibular signals from the two sides."], ["nys", "Nystagmus", "g-cyt", "Involuntary eye beating driven by the vestibulo-ocular reflex. The eyes drift one way and flick back."], ["bal", "Balance", "g-good", "Steadiness from balanced vestibular signals and central compensation over time."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Canals", 208, 112, 208, 88, "Semicircular canals: three fluid filled hoops that sense head turns in different planes.");
  pill(ox, "Loose crystals", 96, 190, 86, 312, "Loose otoconia crystals. In BPPV they roll in the posterior canal when the head moves and trigger brief spinning.");
  pill(ox, "Cochlea", 268, 232, 310, 340, "Cochlea: the hearing organ, sharing fluid spaces with the balance organs. In Meniere disease excess fluid brings fullness and hearing symptoms.");
  pill(ox, "Balance nerve", 310, 188, 322, 108, "Vestibular nerve: carries balance signals from the canals and otolith organs to the brainstem. Swelling here causes vestibular neuritis.");
  pill(ox, "Brainstem", ncx, ncy, 470, 332, "Vestibular nuclei: the brainstem relay that compares both ears and drives the eyes. Suppressant dots sit here and calm the signal for a short course.");
  pill(ox, "Cerebellum", cerx, cery, 620, 332, "Cerebellum: tunes balance reflexes. A stroke here can also cause vertigo, with speech or limb signs.");
  pill(ox, "Eyes", 874, 192, 872, 300, "Unequal balance signals drive nystagmus through the vestibulo-ocular reflex. The eyes drift one way then flick back.");
  capEl = mk("text", { class: "vt-cap", x: 30, y: 426 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { C: 0.9, I: 0.1, Hy: 0.1, V: 0.7, N: 0.7, Bln: 0.4, F: 0.1, sup: 0, salt: 0, epl: 0 };
const acc = { imp: 0 };
function init() {
  initOrgans(); initPanel();
  blockers = Array.prototype.slice.call($("nuclei").querySelectorAll(".vt-drug"));
  const bases = [[290, 208], [332, 202], [368, 208]];
  for (let i = 0; i < 3; i++) imm.push({ g: cell(layers.cells, { cls: "neut", r: 11 - i * 2, nuc: 0.5, seed: 7 + i * 3, wob: 0.14 }), bx: bases[i][0], by: bases[i][1], ph: i * 2.1 });
  cans.forEach((p, i) => { p.a = i * 0.52; p.on = true; p.e.setAttribute("opacity", "1"); });
  endos.forEach((p, i) => { p.a = i * 0.45; p.on = true; p.e.setAttribute("opacity", "1"); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.C = lerp(sm.C, m.C, k2); sm.I = lerp(sm.I, m.I, k2); sm.Hy = lerp(sm.Hy, m.Hy, k2); sm.V = lerp(sm.V, m.V, k1); sm.N = lerp(sm.N, m.N, k1); sm.Bln = lerp(sm.Bln, m.Bln, k2); sm.F = lerp(sm.F, m.F, k2);
  sm.sup = lerp(sm.sup, m.sup, k1); sm.salt = lerp(sm.salt, m.salt, k1); sm.epl = lerp(sm.epl, m.epl, k1);
  /* inner ear fluid swells a halo around the whole apparatus */
  layers.halo.setAttribute("rx", f1(80 + 55 * sm.Hy));
  layers.halo.setAttribute("ry", f1(58 + 32 * sm.Hy));
  layers.halo.setAttribute("opacity", (0.06 + 0.42 * sm.Hy).toFixed(2));
  /* hydrops distends the saccule and cochlea */
  const sac = 1 + 0.4 * sm.Hy; $("saccule").setAttribute("transform", "translate(" + f1(176 * (1 - sac)) + " " + f1(207 * (1 - sac)) + ") scale(" + sac.toFixed(3) + ")");
  const coc = 1 + 0.15 * sm.Hy; $("cochleaG").setAttribute("transform", "translate(" + f1(268 * (1 - coc)) + " " + f1(232 * (1 - coc)) + ") scale(" + coc.toFixed(3) + ")");
  /* canalith crystals circle in the posterior canal, or file out along the Epley guide */
  const want = Math.round(sm.C * cans.length);
  let onN = 0, k;
  for (k = 0; k < cans.length; k++) if (cans[k].on) onN++;
  for (k = 0; k < cans.length; k++) {
    const p = cans[k];
    if (!p.on) {
      if (onN < want) { p.on = true; onN++; p.mode = sm.epl > 0.5 ? 1 : 0; p.a = rnd(0, 6.28); p.u = 0; p.e.setAttribute("opacity", "1"); }
      else continue;
    }
    if (sm.epl > 0.5 && p.mode !== 1) { p.mode = 1; p.u = 0; }
    if (sm.epl <= 0.5 && p.mode !== 0) p.mode = 0;
    if (p.mode === 1) {
      p.u += dt * 0.32;
      if (p.u >= 1) { p.on = false; onN--; p.e.setAttribute("opacity", "0"); continue; }
      const q = trExit.at(p.u);
      place(p.e, q.x, q.y, 0, 1);
    } else {
      p.a += dt * (0.35 + sm.V * 0.9);
      place(p.e, POST.x + Math.cos(p.a) * POST.r, POST.y + Math.sin(p.a) * POST.r, 0, 1);
    }
  }
  layers.guide.setAttribute("opacity", sm.epl.toFixed(2));
  /* endolymph drift in the horizontal canal */
  endos.forEach((p) => { p.a += dt * (0.25 + sm.Hy * 0.7); const x = 176 + Math.cos(p.a) * 55, y = 240 + Math.sin(p.a) * 17; p.e.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); p.e.setAttribute("opacity", (0.3 + 0.7 * clamp(0.25 + sm.Hy)).toFixed(2)); });
  /* inflamed nerve thickens and reddens, immune cells gather */
  const nw = f1(5 + 5 * sm.I);
  layers.nerve.setAttribute("stroke-width", nw);
  layers.hot.setAttribute("stroke-width", nw);
  layers.hot.setAttribute("opacity", clamp(sm.I * 1.1).toFixed(2));
  imm.forEach((c, i) => { place(c.g, c.bx + Math.sin(tm / 600 + c.ph) * 7, c.by + Math.cos(tm / 750 + c.ph) * 6, Math.sin(tm / 500 + c.ph) * 8, 0.15 + 0.85 * sm.I); c.g.style.opacity = sm.I > 0.08 ? 1 : 0; });
  /* relay nuclei pulse with the signal; suppressant dots sit on them and the signal fades */
  const ns = 1 + 0.1 * sm.V * Math.sin(tm / 280);
  layers.nuc.setAttribute("transform", "translate(" + f1(ncx) + " " + f1(ncy) + ") scale(" + ns.toFixed(3) + ")");
  blockers.forEach((b) => b.setAttribute("opacity", sm.sup.toFixed(2)));
  /* VOR impulses from ear to nuclei to eyes, thinned and dimmed by suppressant */
  const effD = Math.max(sm.C, sm.I, sm.Hy) * (1 - 0.5 * sm.sup);
  acc.imp += dt * (1.5 + 7 * effD); let spawned = 0;
  imps.forEach((p) => { if (!p.on && acc.imp >= 1 && spawned < 2) { acc.imp--; spawned++; p.on = true; p.u = 0; } if (!p.on) return; p.u += dt * (0.12 + 0.1 * sm.V); if (p.u >= 1) { p.on = false; p.e.setAttribute("opacity", "0"); return; } const q = trImp.at(p.u); place(p.e, q.x, q.y, 0, 1 - 0.3 * sm.sup); p.e.setAttribute("opacity", (1 - 0.6 * sm.sup).toFixed(2)); });
  /* room spinning arcs around the eyes, gone when vertigo settles */
  place(layers.spin, 764, 192, (tm / 45) % 360, 1);
  layers.spin.setAttribute("opacity", clamp((sm.V - 0.2) / 0.6 * 0.8).toFixed(2));
  /* nystagmus: slow drift then fast flick back, in both eyes */
  const cyc = ((tm * (0.4 + sm.N * 1.4)) % 900) / 900, saw = cyc < 0.78 ? (cyc / 0.78 - 0.5) : (0.5 - (cyc - 0.78) / 0.22 * 1);
  const ix = saw * 20 * sm.N, iy = Math.sin(tm / 700) * 2 * sm.N;
  $("irisL").setAttribute("transform", "translate(" + f1(ix) + " " + f1(iy) + ")"); $("irisR").setAttribute("transform", "translate(" + f1(ix) + " " + f1(iy) + ")");
  $("headArc").setAttribute("opacity", (0.25 + 0.75 * sm.V).toFixed(2));
  gg.can.set(sm.C, wordOf(sm.C, 0.25, 0.6, ["none", "some", "many"])); gg.inf.set(sm.I, wordOf(sm.I, 0.25, 0.6, ["none", "some", "marked"])); gg.hyd.set(sm.Hy, wordOf(sm.Hy, 0.25, 0.6, ["normal", "raised", "high"]));
  gg.ver.set(sm.V, wordOf(sm.V, 0.3, 0.6, ["settled", "mild", "strong"])); gg.nys.set(sm.N, wordOf(sm.N, 0.25, 0.55, ["none", "present", "strong"])); gg.bal.set(sm.Bln, wordOf(sm.Bln, 0.4, 0.65, ["poor", "unsteady", "steady"]));
  const key = level + "-" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
