/* Glaucoma scene: ciliary body, aqueous flow through the pupil, trabecular drainage,
 * iris angle, raised pressure and optic disc cupping, with an enlarged disc and angle view. */
const L = { eye: $("eye"), flow: $("flow"), disc: $("disc"), angled: $("angled"), over: $("over"), panel: $("panel") };
const sm = { prod: 0.75, angle: 0.95, outflow: 0.85, iop: 0.27, cup: 0.11, vision: 0.9, laser: 0, reduce: 0, incOut: 0 };
const gg = {};
let irisT = null, irisB = null, cilT = null, cilB = null, cupC = null, cupM = null, beam = null, hole = null, angIris = null, angGap = null, trabT = null, trabB = null, halo = null;
const acc = { aq: 0 };

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

const trackTop = track([[305, 166], [276, 186], [261, 214], [255, 242], [236, 214], [223, 186], [221, 162], [210, 148]]);
const trackBot = track([[305, 318], [276, 298], [261, 270], [255, 242], [236, 270], [223, 298], [221, 322], [210, 336]]);
const aq = pool(34, () => mk("circle", { class: "sc-p p-aq", r: 2.6 }, L.flow));

function init() {
  /* ---- main eye, facing left ---- */
  halo = mk("circle", { cx: 365, cy: 242, r: 150, fill: "none", stroke: "var(--c-bad)", "stroke-width": 2, opacity: 0 }, L.eye);
  mk("circle", { class: "gl-sclera", cx: 365, cy: 242, r: 140 }, L.eye);
  mk("circle", { class: "gl-vitreous", cx: 365, cy: 242, r: 132 }, L.eye);
  /* optic nerve trunk and disc at the back of the eye */
  mk("path", { class: "gl-nerve", d: "M492 222 L560 228 L560 256 L492 262 Z" }, L.eye);
  mk("ellipse", { class: "gl-disc", cx: 494, cy: 242, rx: 9, ry: 24 }, L.eye);
  cupM = mk("ellipse", { class: "gl-cup", cx: 494, cy: 242, rx: 3, ry: 8 }, L.eye);
  /* cornea bulging at the front, and the front chamber behind it */
  mk("path", { class: "gl-chamber", d: "M238 164 C200 190 188 242 200 292 C208 312 224 322 238 320 C226 270 226 214 238 164 Z" }, L.eye);
  mk("path", { class: "gl-cornea", d: "M238 164 C196 196 186 242 196 290 C204 312 222 322 238 320" }, L.eye);
  /* lens behind the pupil */
  mk("ellipse", { class: "gl-lens", cx: 284, cy: 242, rx: 27, ry: 60 }, L.eye);
  mk("ellipse", { cx: 276, cy: 224, rx: 8, ry: 22, fill: "#fff", opacity: 0.28 }, L.eye);
  /* ciliary body behind the iris root, top and bottom */
  cilT = cell(L.eye, { cls: "ciliary", r: 19, nuc: 0.34, seed: 3, wob: 0.16, x: 302, y: 148 });
  cilB = cell(L.eye, { cls: "ciliary", r: 19, nuc: 0.34, seed: 7, wob: 0.16, x: 302, y: 336 });
  /* trabecular meshwork and canal at the angle, top and bottom */
  trabT = mk("path", { class: "gl-trab", d: "M216 148 L238 164 M212 156 L234 170" }, L.eye);
  trabB = mk("path", { class: "gl-trab", d: "M216 336 L238 320 M212 328 L234 314" }, L.eye);
  mk("path", { class: "gl-canal", d: "M204 138 C214 142 222 146 228 150 M204 346 C214 342 222 338 228 334" }, L.eye);
  /* iris leaves, redrawn each step as the angle changes */
  irisT = mk("path", { class: "gl-iris", d: "M240 160 L260 200" }, L.eye);
  irisB = mk("path", { class: "gl-iris", d: "M240 324 L260 284" }, L.eye);
  hole = mk("circle", { class: "gl-hole", cx: 246, cy: 178, r: 4.5, opacity: 0 }, L.eye);
  beam = mk("path", { class: "gl-laser", d: "M170 92 L246 178", opacity: 0 }, L.flow);

  /* ---- enlarged optic disc ---- */
  mk("circle", { class: "gl-disc", cx: 765, cy: 150, r: 58 }, L.disc);
  mk("path", { class: "gl-vessel", d: "M765 150 C740 128 724 118 706 112 M765 150 C790 128 806 118 824 112" }, L.disc);
  mk("path", { class: "gl-vessel ven", d: "M765 150 C742 174 728 184 710 192 M765 150 C788 174 802 184 820 192" }, L.disc);
  cupC = mk("circle", { class: "gl-cup", cx: 765, cy: 150, r: 14 }, L.disc);

  /* ---- enlarged angle view ---- */
  mk("path", { class: "gl-chamber", d: "M624 292 L892 292 L892 392 L660 392 C640 360 628 326 624 292 Z" }, L.angled);
  mk("path", { class: "gl-cornea", d: "M624 292 L892 292" }, L.angled);
  mk("path", { class: "gl-trab", d: "M806 292 L884 292 M812 300 L878 300" }, L.angled);
  mk("path", { class: "gl-canal", d: "M812 282 C840 278 868 278 886 282" }, L.angled);
  angGap = mk("path", { d: "M838 300 L852 344 L820 344 Z", fill: "var(--c-fl)", opacity: 0.35 }, L.angled);
  angIris = mk("path", { class: "gl-iris", d: "M648 372 L838 318" }, L.angled);
  const at = mk("text", { class: "sc-lab", x: 632, y: 408 }, L.angled); at.textContent = "iris";
  const bt = mk("text", { class: "sc-lab", x: 800, y: 408 }, L.angled); bt.textContent = "drainage angle";

  /* ---- label pills: positions checked so pills do not overlap each other ---- */
  const o = L.over;
  pill(o, "Cornea", 202, 196, 90, 88, "The clear front window of the eye. Aqueous humour sits just behind it in the anterior chamber.");
  pill(o, "Ciliary body", 302, 140, 365, 88, "The ciliary body makes aqueous humour and releases it into the posterior chamber behind the iris.");
  pill(o, "Trabecular meshwork", 224, 156, 500, 88, "The sieve at the drainage angle. Aqueous passes through it into the canal of Schlemm and out of the eye.");
  pill(o, "Iris", 244, 182, 90, 150, "The coloured diaphragm. Its root can block the drainage angle, and in acute closure it bows forward.");
  pill(o, "Pupil", 254, 242, 90, 242, "The opening in the iris. Aqueous made behind the iris must flow through the pupil to reach the front chamber.");
  pill(o, "Lens", 284, 242, 90, 330, "The lens sits behind the pupil. A forward or swollen lens can push the iris forward and crowd the angle.");
  pill(o, "Vitreous", 380, 292, 350, 408, "The gel filling the back of the eye. It plays no part in aqueous drainage.");
  pill(o, "Optic nerve", 520, 242, 470, 408, "Retinal ganglion cell axons leave here at the optic disc. Raised pressure damages them and enlarges the cup.");
  pill(o, "Optic disc", 748, 118, 700, 88, "Enlarged view of the optic disc, where nerve fibres leave the eye. Its central pale cup grows as fibres are lost.");
  pill(o, "Cup", 765, 150, 855, 88, "The pale central cup of the disc. Cupping means the cup enlarges and the rim thins as nerve fibres die.");
  pill(o, "Iris root", 800, 330, 695, 282, "Enlarged drainage angle: the iris root approaching the trabecular meshwork. When they touch, aqueous cannot drain.");
  pill(o, "Canal of Schlemm", 850, 284, 860, 282, "The canal that collects aqueous after the trabecular meshwork and carries it to veins outside the eye.");
  const p1 = pill(o, "Less aqueous made", 302, 154, 150, 408, "Aqueous suppressant treatment: the ciliary body makes less fluid, so less pressure builds up.");
  p1.setAttribute("id", "tx-prod");
  const p2 = pill(o, "More outflow", 224, 156, 150, 408, "Outflow treatment: drainage through the trabecular meshwork or the uveoscleral route is increased.");
  p2.setAttribute("id", "tx-out");
  const p3 = pill(o, "Laser iridotomy", 246, 178, 150, 408, "Laser peripheral iridotomy makes a small hole in the peripheral iris, bypassing a blocked pupil so the iris falls back and the angle reopens.");
  p3.setAttribute("id", "tx-laser");

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
  const hx = rootX + 6 - bow * 0.4;
  hole.setAttribute("cx", f1(hx)); hole.setAttribute("cy", "178"); hole.setAttribute("opacity", sm.laser.toFixed(2));
  beam.setAttribute("d", "M170 92 L" + f1(hx) + " 178"); beam.setAttribute("opacity", (sm.laser * (0.55 + 0.35 * Math.sin(tm / 160))).toFixed(2));
  trabT.style.opacity = (0.35 + 0.65 * sm.outflow).toFixed(2); trabB.style.opacity = (0.35 + 0.65 * sm.outflow).toFixed(2);

  /* ciliary body pulses as it makes aqueous; quieter when production is reduced */
  const pulse = 1 + 0.07 * sm.prod * Math.sin(tm / 320);
  place(cilT, 302, 148, 0, pulse); place(cilB, 302, 336, 0, pulse);
  cilT.style.opacity = (0.45 + 0.55 * sm.prod).toFixed(2); cilB.style.opacity = (0.45 + 0.55 * sm.prod).toFixed(2);

  /* pressure halo around the globe and optic cup growth */
  halo.setAttribute("r", f1(148 + sm.iop * 7)); halo.setAttribute("opacity", (sm.iop * 0.5).toFixed(2));
  cupC.setAttribute("r", f1(10 + sm.cup * 36));
  cupM.setAttribute("rx", f1(2 + sm.cup * 5)); cupM.setAttribute("ry", f1(6 + sm.cup * 15));

  /* enlarged angle: iris root meets the meshwork as the angle closes */
  const ax = 838 + (1 - sm.angle) * 34, ay = 318 - (1 - sm.angle) * 20;
  angIris.setAttribute("d", "M648 372 Q740 356 " + f1(ax) + " " + f1(ay));
  angGap.setAttribute("opacity", (sm.angle * 0.4).toFixed(2));
  angGap.setAttribute("d", "M" + f1(ax - 14) + " 300 L" + f1(ax + 8) + " " + f1(ay + 22) + " L" + f1(ax - 26) + " " + f1(ay + 22) + " Z");

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

  /* treatment pills, only the active one shows */
  $("tx-prod").style.opacity = sm.reduce.toFixed(2);
  $("tx-out").style.opacity = sm.incOut.toFixed(2);
  $("tx-laser").style.opacity = sm.laser.toFixed(2);

  gg.prod.set(sm.prod, wordOf(sm.prod, 0.45, 0.65, ["low", "normal", "normal"]));
  gg.angle.set(sm.angle, wordOf(sm.angle, 0.3, 0.65, ["closed", "narrow", "open"]));
  gg.out.set(sm.outflow, wordOf(sm.outflow, 0.3, 0.65, ["blocked", "reduced", "open"]));
  gg.iop.set(sm.iop, wordOf(sm.iop, 0.3, 0.55, ["normal", "raised", "high"]));
  gg.cup.set(sm.cup, wordOf(sm.cup, 0.25, 0.5, ["healthy", "cupping", "severe"]));
  gg.vis.set(sm.vision, wordOf(sm.vision, 0.45, 0.75, ["poor", "reduced", "good"]));
}
run({ init, step });
