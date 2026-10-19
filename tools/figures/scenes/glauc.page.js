/* Glaucoma scene: ciliary body makes aqueous, flow through the pupil, trabecular
 * drainage at the angle, raised pressure and optic disc cupping. Close views read
 * cause over effect: the angle (top right), then the disc damage (bottom right). */
const L = { eye: $("eye"), flow: $("flow"), disc: $("disc"), angled: $("angled"), over: $("over"), panel: $("panel") };
const sm = { prod: 0.75, angle: 0.95, outflow: 0.85, iop: 0.27, cup: 0.11, vision: 0.9, laser: 0, reduce: 0, incOut: 0 };
const gg = {};
let irisT = null, irisB = null, cilT = null, cilB = null, cupC = null, cupM = null, beam = null, hole = null, holeX = 242;
let angIris = null, angGap = null, trabT = null, trabB = null, trabA = null, canalE = null, canalA = null;
let canalGlowE = null, canalGlowA = null, trabGlowA = null, halo = null, discHalo = null, vesA = null, vesB = null;
let capEl = null, capKey = "";
const acc = { aq: 0, by: 0 };

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, s: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

const trackTop = track([[305, 166], [276, 186], [261, 214], [255, 242], [236, 214], [223, 186], [221, 162], [210, 148]]);
const trackBot = track([[305, 318], [276, 298], [261, 270], [255, 242], [236, 270], [223, 298], [221, 322], [210, 336]]);
const aq = pool(34, () => mk("circle", { class: "sc-p p-aq", r: 2.6 }, L.flow));
const byp = pool(10, () => mk("circle", { class: "sc-p p-aq", r: 2.4 }, L.flow));
const SLOTS = [[288, 170], [300, 172], [312, 170], [324, 168], [288, 314], [300, 312], [312, 314], [324, 316]];
const blockers = pool(8, () => mk("rect", { class: "gl-block", x: -4.5, y: -2.2, width: 9, height: 4.4, rx: 2.2 }, L.flow));

function capText(d) {
  if (level === 0) {
    if (d === 1) return "Drops curb fluid making. Less fluid is made, pressure stays normal.";
    if (d === 2) return "Outflow drops hold the drain wide open. Pressure stays normal.";
    if (d === 3) return "Laser makes a hole in the iris. The open angle needs no help.";
    return "Angle open. Fluid drains freely and pressure stays normal.";
  }
  if (level === 1) {
    if (d === 1) return "Drops curb fluid making. Less fluid, so pressure eases.";
    if (d === 2) return "Outflow drops widen the drain. More fluid leaves the eye.";
    if (d === 3) return "Laser hole lets fluid past. The iris falls back and the drain opens.";
    return "No treatment. The drain is narrowing and pressure is climbing.";
  }
  if (d === 1) return "Drops curb fluid making, but the shut angle still blocks outflow.";
  if (d === 2) return "Outflow drops help the drain, but the shut angle limits them.";
  if (d === 3) return "Laser hole bypasses the block. The iris falls back, fluid drains.";
  return "No treatment. The angle is shut and pressure threatens sight.";
}

function init() {
  /* ---- main eye, facing left ---- */
  halo = mk("circle", { cx: 365, cy: 242, r: 150, fill: "none", stroke: "var(--c-bad)", "stroke-width": 2, opacity: 0 }, L.eye);
  mk("circle", { class: "gl-sclera", cx: 365, cy: 242, r: 140 }, L.eye);
  mk("circle", { class: "gl-vitreous", cx: 365, cy: 242, r: 132 }, L.eye);
  /* optic nerve trunk with fibre lines, and the disc at the back of the eye */
  mk("path", { class: "gl-nerve", d: "M492 222 L560 228 L560 256 L492 262 Z" }, L.eye);
  mk("path", { class: "gl-fibre", d: "M494 230 L558 234 M494 242 L558 242 M494 254 L558 250" }, L.eye);
  mk("ellipse", { class: "gl-disc", cx: 494, cy: 242, rx: 9, ry: 24 }, L.eye);
  cupM = mk("ellipse", { class: "gl-cup", cx: 494, cy: 242, rx: 3, ry: 8 }, L.eye);
  /* cornea bulging at the front, and the front chamber behind it */
  mk("path", { class: "gl-chamber", d: "M238 164 C200 190 188 242 200 292 C208 312 224 322 238 320 C226 270 226 214 238 164 Z" }, L.eye);
  mk("path", { class: "gl-cornea", d: "M238 164 C196 196 186 242 196 290 C204 312 222 322 238 320" }, L.eye);
  /* lens behind the pupil */
  mk("ellipse", { class: "gl-lens", cx: 284, cy: 242, rx: 27, ry: 60 }, L.eye);
  mk("ellipse", { cx: 276, cy: 224, rx: 8, ry: 22, fill: "#fff", opacity: 0.28 }, L.eye);
  /* ciliary body with folded secreting processes behind the iris root */
  cilT = cell(L.eye, { cls: "ciliary", r: 19, nuc: 0.34, seed: 3, wob: 0.16, x: 302, y: 148 });
  cilB = cell(L.eye, { cls: "ciliary", r: 19, nuc: 0.34, seed: 7, wob: 0.16, x: 302, y: 336 });
  mk("path", { class: "gl-fold", d: "M290 158 L296 170 M302 160 L302 174 M314 158 L308 170" }, L.eye);
  mk("path", { class: "gl-fold", d: "M290 326 L296 314 M302 324 L302 310 M314 326 L308 314" }, L.eye);
  /* trabecular meshwork and canal at the angle, top and bottom */
  trabT = mk("path", { class: "gl-trab", d: "M216 148 L238 164 M212 156 L234 170" }, L.eye);
  trabB = mk("path", { class: "gl-trab", d: "M216 336 L238 320 M212 328 L234 314" }, L.eye);
  canalGlowE = mk("path", { class: "gl-wide", d: "M204 138 C214 142 222 146 228 150 M204 346 C214 342 222 338 228 334", "stroke-width": 9, opacity: 0 }, L.eye);
  canalE = mk("path", { class: "gl-canal", d: "M204 138 C214 142 222 146 228 150 M204 346 C214 342 222 338 228 334" }, L.eye);
  /* iris leaves, redrawn each step as the angle changes */
  irisT = mk("path", { class: "gl-iris", d: "M240 160 L260 200" }, L.eye);
  irisB = mk("path", { class: "gl-iris", d: "M240 324 L260 284" }, L.eye);
  hole = mk("circle", { class: "gl-hole", cx: 246, cy: 178, r: 4.5, opacity: 0 }, L.eye);
  beam = mk("path", { class: "gl-laser", d: "M170 92 L246 178", opacity: 0 }, L.flow);

  /* ---- enlarged drainage angle: the cause, top right ---- */
  mk("path", { class: "gl-chamber", d: "M624 102 L892 102 L892 202 L660 202 C640 170 628 136 624 102 Z" }, L.angled);
  mk("path", { class: "gl-cornea", d: "M624 102 L892 102" }, L.angled);
  trabGlowA = mk("path", { class: "gl-wide", d: "M806 102 L884 102 M812 110 L878 110", "stroke-width": 7, opacity: 0 }, L.angled);
  trabA = mk("path", { class: "gl-trab", d: "M806 102 L884 102 M812 110 L878 110" }, L.angled);
  canalGlowA = mk("path", { class: "gl-wide", d: "M812 92 C840 88 868 88 886 92", "stroke-width": 9, opacity: 0 }, L.angled);
  canalA = mk("path", { class: "gl-canal", d: "M812 92 C840 88 868 88 886 92" }, L.angled);
  angGap = mk("path", { d: "M824 110 L846 130 L806 130 Z", fill: "var(--c-fl)", opacity: 0.35 }, L.angled);
  angIris = mk("path", { class: "gl-iris", d: "M648 182 L838 128" }, L.angled);

  /* ---- enlarged optic disc: the effect, bottom right ---- */
  discHalo = mk("circle", { cx: 765, cy: 340, r: 66, fill: "none", stroke: "var(--c-bad)", "stroke-width": 2, opacity: 0 }, L.disc);
  mk("circle", { class: "gl-disc", cx: 765, cy: 340, r: 58 }, L.disc);
  vesA = mk("path", { class: "gl-vessel", d: "M765 340 C740 318 724 308 706 302 M765 340 C790 318 806 308 824 302" }, L.disc);
  vesB = mk("path", { class: "gl-vessel ven", d: "M765 340 C742 364 728 374 710 382 M765 340 C788 364 802 374 820 382" }, L.disc);
  cupC = mk("circle", { class: "gl-cup", cx: 765, cy: 340, r: 14 }, L.disc);

  /* ---- label pills: eight short labels, pills kept clear of each other ---- */
  const o = L.over;
  pill(o, "Ciliary body", 302, 140, 430, 88, "Makes the clear fluid of the eye. Drops that curb fluid making act here.");
  pill(o, "Pupil", 254, 242, 90, 242, "Fluid made behind the iris flows through the pupil to the front chamber.");
  pill(o, "Iris", 250, 191, 90, 150, "The coloured sheet. Its root can block the drain. A swollen lens can push it shut.");
  pill(o, "Drain", 222, 160, 150, 88, "The meshwork and canal where fluid leaves the eye. Outflow drops widen this path.");
  pill(o, "Optic nerve", 530, 242, 510, 404, "Carries sight signals to the brain. High pressure injures it where it leaves the eye.");
  pill(o, "Angle", 852, 118, 905, 160, "Close view of the drain. When the iris meets the meshwork, fluid cannot leave.");
  pill(o, "Optic disc", 720, 330, 640, 300, "Close view where nerve fibres leave the eye. The pale centre is the cup.");
  pill(o, "Cup", 765, 340, 880, 300, "The pale cup grows as pressure kills nerve fibres.");
  capEl = mk("text", { class: "gl-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0);

  /* ---- gauges ---- */
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const pt = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); pt.textContent = "The eye";
  [["prod", "Production", "g-aq", "How fast the ciliary body makes aqueous humour."], ["angle", "Angle", "g-angle", "How open the drainage angle between iris and cornea is."], ["out", "Outflow", "g-fl", "How freely aqueous drains through the trabecular meshwork."], ["iop", "Pressure", "g-bad", "Pressure inside the eye. It rises when drainage cannot keep up with production."], ["cup", "Cupping", "g-cup", "Enlargement of the optic disc cup as nerve fibres are damaged."], ["vis", "Vision", "g-good", "Remaining vision. Glaucoma removes peripheral vision first, slowly and without pain in the open angle form."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 142, 486, 52, 18, cls, name, tip); });
}

function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.prod = lerp(sm.prod, m.prod, k); sm.angle = lerp(sm.angle, m.angle, k); sm.outflow = lerp(sm.outflow, m.outflow, k);
  sm.iop = lerp(sm.iop, m.iop, k); sm.cup = lerp(sm.cup, m.cup, k); sm.vision = lerp(sm.vision, m.vision, k);
  sm.laser = lerp(sm.laser, m.laser, k); sm.reduce = lerp(sm.reduce, m.reduce, k); sm.incOut = lerp(sm.incOut, m.incOut, k);

  /* iris bows forward and its root crowds the angle as the angle closes */
  const bow = (1 - sm.angle) * 20, rootX = 240 - (1 - sm.angle) * 16;
  irisT.setAttribute("d", "M" + f1(rootX) + " 160 Q" + f1((rootX + 260) / 2 - bow) + " 182 260 200");
  irisB.setAttribute("d", "M" + f1(rootX) + " 324 Q" + f1((rootX + 260) / 2 - bow) + " 302 260 284");
  holeX = rootX + 6 - bow * 0.4;
  hole.setAttribute("cx", f1(holeX)); hole.setAttribute("cy", "178"); hole.setAttribute("opacity", sm.laser.toFixed(2));
  beam.setAttribute("d", "M170 92 L" + f1(holeX) + " 178"); beam.setAttribute("opacity", (sm.laser * (0.55 + 0.35 * Math.sin(tm / 160))).toFixed(2));
  trabT.style.opacity = (0.35 + 0.65 * sm.outflow).toFixed(2); trabB.style.opacity = (0.35 + 0.65 * sm.outflow).toFixed(2);
  trabA.style.opacity = (0.35 + 0.65 * sm.outflow).toFixed(2);
  canalE.style.opacity = (0.45 + 0.55 * sm.outflow).toFixed(2); canalA.style.opacity = (0.45 + 0.55 * sm.outflow).toFixed(2);
  canalGlowE.style.opacity = (sm.incOut * 0.85).toFixed(2); canalGlowA.style.opacity = (sm.incOut * 0.85).toFixed(2);
  trabGlowA.style.opacity = (sm.incOut * 0.85).toFixed(2);

  /* ciliary body pulses as it makes aqueous; quieter when production is reduced */
  const pulse = 1 + 0.07 * sm.prod * Math.sin(tm / 320);
  place(cilT, 302, 148, 0, pulse); place(cilB, 302, 336, 0, pulse);
  cilT.style.opacity = (0.45 + 0.55 * sm.prod).toFixed(2); cilB.style.opacity = (0.45 + 0.55 * sm.prod).toFixed(2);

  /* pressure halos around the globe and the disc, optic cup growth, vessels fading */
  halo.setAttribute("r", f1(148 + sm.iop * 7)); halo.setAttribute("opacity", (sm.iop * 0.5).toFixed(2));
  discHalo.setAttribute("r", f1(64 + sm.iop * 6)); discHalo.setAttribute("opacity", (sm.iop * 0.45).toFixed(2));
  cupC.setAttribute("r", f1(10 + sm.cup * 36));
  cupM.setAttribute("rx", f1(2 + sm.cup * 5)); cupM.setAttribute("ry", f1(6 + sm.cup * 15));
  vesA.style.opacity = (1 - 0.5 * sm.cup).toFixed(2); vesB.style.opacity = (1 - 0.5 * sm.cup).toFixed(2);

  /* enlarged angle: iris root meets the meshwork as the angle closes */
  const ax = 838 + (1 - sm.angle) * 34, ay = 128 - (1 - sm.angle) * 20;
  angIris.setAttribute("d", "M648 182 Q740 166 " + f1(ax) + " " + f1(ay));
  angGap.setAttribute("opacity", (sm.angle * 0.4).toFixed(2));
  angGap.setAttribute("d", "M" + f1(ax - 14) + " 110 L" + f1(ax + 8) + " " + f1(ay + 22) + " L" + f1(ax - 26) + " " + f1(ay + 22) + " Z");

  /* blocker caps dock on the ciliary tips when production is curbed */
  blockers.forEach((b, i) => {
    const s = SLOTS[i], wob = 1 - b.s;
    b.s = lerp(b.s, sm.reduce, Math.min(1, dt * 2.5));
    place(b.e, s[0] + Math.sin(tm / 520 + i * 0.9) * 16 * wob, s[1] + Math.cos(tm / 640 + i * 1.3) * 10 * wob, Math.sin(tm / 700 + i) * 15, 1);
    b.e.setAttribute("opacity", b.s.toFixed(2));
  });

  /* aqueous particles: ciliary body, through the pupil, to the drainage angle */
  acc.aq += dt * (2 + sm.prod * 9);
  while (acc.aq >= 1) { acc.aq--; const p = free(aq); if (p) { emit(p, 0, 0, 0, 0, Math.random() < 0.5 ? 0 : 1); p.u = 0; } }
  aq.forEach((p) => {
    if (!p.on) return;
    p.u += dt * (0.10 + 0.16 * sm.prod) * (0.45 + 0.55 * (0.3 + sm.outflow));
    const tr = p.k ? trackBot : trackTop, pos = tr.at(Math.min(1, p.u));
    p.e.setAttribute("transform", "translate(" + f1(pos.x) + " " + f1(pos.y) + ")");
    const limit = 0.80 + 0.20 * sm.outflow;
    p.e.setAttribute("opacity", p.u > limit - 0.12 ? clamp((limit - p.u) / 0.12).toFixed(2) : "1");
    if (p.u >= limit) kill(p);
  });

  /* bypass stream through the laser hole to the drain */
  acc.by += dt * sm.laser * 12;
  while (acc.by >= 1) { acc.by--; const p = free(byp); if (p) { const sx = holeX + rnd(-2, 2), sy = 178 + rnd(-3, 3), dx = 216 - sx, dy = 156 - sy, dd = Math.hypot(dx, dy) || 1; emit(p, sx, sy, dx / dd * 95, dy / dd * 95, 0); } }
  byp.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.1).toFixed(2));
    if (p.t > 1.1 || Math.hypot(216 - p.x, 156 - p.y) < 7) kill(p);
  });

  gg.prod.set(sm.prod, wordOf(sm.prod, 0.45, 0.65, ["low", "normal", "normal"]));
  gg.angle.set(sm.angle, wordOf(sm.angle, 0.3, 0.65, ["closed", "narrow", "open"]));
  gg.out.set(sm.outflow, wordOf(sm.outflow, 0.3, 0.65, ["blocked", "reduced", "open"]));
  gg.iop.set(sm.iop, wordOf(sm.iop, 0.3, 0.55, ["normal", "raised", "high"]));
  gg.cup.set(sm.cup, wordOf(sm.cup, 0.25, 0.5, ["healthy", "cupping", "severe"]));
  gg.vis.set(sm.vision, wordOf(sm.vision, 0.45, 0.75, ["poor", "reduced", "good"]));

  /* caption follows drug and level */
  const key = drug + "x" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
