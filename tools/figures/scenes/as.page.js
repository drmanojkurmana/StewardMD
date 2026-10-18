/* Aortic stenosis scene: a beating ventricle, calcified leaflets that open less, a jet through the valve, pressure arrows, the consequence chain, effort symptoms and the gauges. */
const L = { aorta: $("aorta"), heart: $("heart"), valve: $("valve"), parts: $("parts"), chain: $("chain"), icons: $("icons"), over: $("over"), panel: $("panel") };
const VC = [190, 305];                                   // ventricle centre
/* ---- aorta and ventricle ---- */
mk("path", { class: "as-aorta", id: "aortaPath", d: "M190 200L190 112Q190 82 220 82L338 82" }, L.aorta);
const hg = mk("g", {}, L.heart);
const wall = mk("ellipse", { class: "as-wall", cx: VC[0], cy: VC[1] }, hg);
const wsh = mk("ellipse", { class: "as-shade", cx: VC[0] + 5, cy: VC[1] + 6 }, hg);
const ch = mk("ellipse", { class: "as-ch", cx: VC[0], cy: VC[1] }, hg);
const aTrack = track([[190, 196], [190, 112], [198, 86], [250, 82], [336, 82]]);
/* ---- valve leaflets, calcium and prosthesis ring ---- */
const leafL = mk("path", { class: "as-leaf" }, L.valve), leafR = mk("path", { class: "as-leaf" }, L.valve);
const ring = mk("ellipse", { class: "as-ring", cx: 190, cy: 196, rx: 21, ry: 8, opacity: 0 }, L.valve);
const calcs = [];
for (let i = 0; i < 6; i++) calcs.push({ e: mk("circle", { class: "as-calc", r: 2.6 + (i % 3) }, L.valve), side: i < 3 ? -1 : 1, u: 0.3 + 0.24 * (i % 3), off: (i % 2 ? 3.4 : -3) });
/* ---- pressure arrows inside the ventricle ---- */
const parr = [166, 190, 214].map((x) => mk("path", { class: "as-pres" }, L.heart));
/* ---- jet particles through the valve ---- */
const jets = Array.from({ length: 14 }, (_, i) => ({ e: mk("circle", { class: "as-jet", r: 2.4, opacity: 0 }, L.parts), u: i / 14, off: rnd(-4, 4) }));
/* ---- consequence chain ---- */
const NODES = {
  a: { x: 600, y: 115, w: 180, t: "Pressure builds in LV", tip: "The ventricle must push much harder to eject through the narrowed valve. Pressure inside it rises, which is the gradient across the valve.", k: "grad" },
  b: { x: 830, y: 115, w: 180, t: "Wall thickens", tip: "Concentric hypertrophy: the wall thickens in parallel, with a normal or smaller cavity. Wall stress is kept down at first.", k: "hyp" },
  c: { x: 830, y: 210, w: 180, t: "Chamber stiffens", tip: "A thick wall is a stiff wall. The ventricle fills less easily, so filling pressures rise and are passed back to the lungs.", k: "hyp" },
  d: { x: 600, y: 210, w: 180, t: "Output cannot rise", tip: "The fixed narrow valve caps how much blood can leave. Output is held at rest, but cannot rise on effort: there is no output reserve.", k: "res" },
  e: { x: 830, y: 305, w: 180, t: "Late heart failure", tip: "Late, the thick ventricle fails: filling pressures climb, the lungs congest and output falls even at rest.", k: "hf" },
};
const nodeEls = {};
Object.keys(NODES).forEach((key) => { const n = NODES[key], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.chain);
  mk("rect", { class: "as-node", x: n.x - n.w / 2, y: n.y - 18, width: n.w, height: 36, rx: 12 }, g);
  const t = mk("text", { class: "as-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; nodeEls[key] = g; });
const ARROWS = {
  ab: { pts: [[692, 115], [738, 115]], k: "grad" }, bc: { pts: [[830, 135], [830, 190]], k: "hyp" },
  cd: { pts: [[738, 210], [692, 210]], k: "res" }, ce: { pts: [[830, 230], [830, 285]], k: "hf" },
  ds: { pts: [[600, 230], [600, 316]], k: "sx" },
};
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const a = ARROWS[id], d = a.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a.pts), e = mk("path", { class: "as-arrow", d }, L.chain);
  const p1 = a.pts[a.pts.length - 2], p2 = a.pts[a.pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958;
  mk("path", { class: "as-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, L.chain);
  const dots = Array.from({ length: 3 }, (_, i) => ({ c: mk("circle", { class: "as-jet", r: 2.3 }, L.parts), u: i / 3 }));
  arrows[id] = { tr, dots, k: a.k }; });
/* ---- effort symptoms ---- */
function iconGroup(x, tip) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.icons); return g; }
const angG = iconGroup(560, "Angina: the thick wall needs more oxygen, but supply cannot rise through the fixed valve (and coronary filling falls if pressure drops). Chest pain on effort follows.");
mk("path", { class: "as-icon", d: "M560 342C552 332 538 338 540 350C541 360 552 366 560 374C568 366 579 360 580 350C582 338 568 332 560 342Z" }, angG);
const synG = iconGroup(700, "Syncope: on effort the muscle vessels dilate, but output cannot rise to match, so blood pressure falls and the brain is briefly starved. The person faints.");
mk("circle", { class: "as-icon", cx: 700, cy: 352, r: 15 }, synG);
mk("path", { class: "as-icon", d: "M700 330v-7M716 338l5-5M684 338l-5-5" }, synG);
const brG = iconGroup(850, "Breathlessness: the stiff ventricle raises pressures behind it, in the left atrium and lungs. Fluid congests the lungs, worst lying flat or on effort.");
mk("path", { class: "as-lung", d: "M842 336q-14 4-15 20q0 14 12 15q6-16 3-35zM858 336q14 4 15 20q0 14-12 15q-6-16-3-35z" }, brG);
mk("path", { class: "as-lung", d: "M850 330v16" }, brG);
[[560, "Angina"], [700, "Syncope"], [850, "Breathlessness"]].forEach(([x, s]) => { const t = mk("text", { class: "as-cap", x, y: 392, "text-anchor": "middle" }, L.icons); t.textContent = s; });
/* ---- labels and gauges ---- */
pill(L.over, "Aorta", 285, 80, 340, 56, "Aorta: the single outlet from the left ventricle. All output must pass the aortic valve to reach it.");
pill(L.over, "Aortic valve", 190, 196, 92, 162, "Aortic valve: three thin leaflets (or two in a bicuspid valve) that should open fully in systole. Calcium stiffens and narrows them.");
pill(L.over, "Thick wall", 122, 300, 72, 258, "The ventricle wall thickens around a normal or smaller cavity (concentric hypertrophy) to bear the extra pressure.");
pill(L.over, "Pressure gradient", 190, 150, 272, 158, "Blood speeds up through the narrow opening. The faster the jet, the higher the pressure the ventricle must make upstream: the gradient across the valve.");
pill(L.over, "Left ventricle", 218, 332, 322, 382, "Left ventricle: the main pumping chamber. It ejects through the aortic valve into the aorta.");
const vasoPill = pill(L.over, "Vasodilator", 318, 84, 398, 124, "A vasodilator lowers peripheral resistance. With a fixed narrow valve, output cannot rise to fill the wider vessels, so blood pressure falls.");
vasoPill.setAttribute("id", "vaso-pill"); vasoPill.style.opacity = "0";
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [130, 270, 410, 550, 690, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["grad", "Gradient", "g-bad", "The pressure difference the ventricle must create across the narrowed valve. It rises steeply as the opening shrinks."], ["hyp", "Hypertrophy", "g-neu", "How much the ventricle wall has thickened around its cavity."], ["res", "Reserve", "g-good", "Output reserve: how much extra blood the heart can deliver on effort. The fixed valve caps it."], ["bp", "Pressure", "g-good", "Systemic blood pressure. Held for years, it falls late, or at once if a vasodilator widens vessels the fixed output cannot fill."], ["sx", "Symptoms", "g-bad", "Angina, syncope and breathlessness together. They mark the turn from compensated to dangerous disease."], ["hf", "Failure", "g-bad", "Late heart failure: congestion and low output as the pressure-loaded ventricle gives up."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); }); }
/* ---- animation ---- */
const sm = { sten: 0.6, grad: 0.5, hyp: 0.6, reserve: 0.5, bp: 0.7, sx: 0.4, hf: 0.2, repl: 0, vaso: 0 };
let beat = 0;
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.sten = lerp(sm.sten, m.sten, k1); sm.grad = lerp(sm.grad, m.grad, k1); sm.reserve = lerp(sm.reserve, m.reserve, k1); sm.bp = lerp(sm.bp, m.bp, k1); sm.sx = lerp(sm.sx, m.sx, k1); sm.repl = lerp(sm.repl, m.repl, k1); sm.vaso = lerp(sm.vaso, m.vaso, k1);
  sm.hyp = lerp(sm.hyp, m.hyp, k2); sm.hf = lerp(sm.hf, m.hf, k2);
  /* heartbeat: the cavity shrinks as it ejects; the wall is thicker and the cavity smaller with hypertrophy */
  beat += dt * (0.9 + 0.35 * sm.grad); const ph = beat % 1, c = Math.pow(Math.max(0, Math.sin(ph * 6.2832 * 0.5 + 0.2)), 1.2) * (ph < 0.5 ? 1 : 0);
  const ef = 0.1 + 0.26 * sm.reserve, rx0 = 56 - 10 * sm.hyp, ry0 = 74 - 10 * sm.hyp, tw = 12 + 20 * sm.hyp;
  const rx = rx0 * (1 - ef * c), ry = ry0 * (1 - ef * c);
  ch.setAttribute("rx", f1(rx)); ch.setAttribute("ry", f1(ry));
  wall.setAttribute("rx", f1(rx + tw * (1 + 0.25 * c))); wall.setAttribute("ry", f1(ry + tw * (1 + 0.25 * c)));
  wsh.setAttribute("rx", f1(rx + tw)); wsh.setAttribute("ry", f1(ry + tw));
  $("aortaPath").setAttribute("opacity", (0.3 + 0.35 * sm.bp).toFixed(2));
  /* valve: the gap between the leaflet tips follows the stenosis; calcium fades with a prosthesis */
  const gap = 5 + 24 * (1 - sm.sten), tipY = 196 - 7 * c - 3, lx = 190 - gap / 2, rxp = 190 + gap / 2;
  leafL.setAttribute("d", "M172 202L" + f1(lx) + " " + f1(tipY)); leafR.setAttribute("d", "M208 202L" + f1(rxp) + " " + f1(tipY));
  calcs.forEach((cn) => { const hx = cn.side < 0 ? 172 : 208, tx = cn.side < 0 ? lx : rxp, x = lerp(hx, tx, cn.u), y = lerp(202, tipY, cn.u) + cn.off;
    cn.e.setAttribute("cx", f1(x)); cn.e.setAttribute("cy", f1(y)); cn.e.setAttribute("opacity", clamp(sm.sten * (1 - sm.repl) * 1.4).toFixed(2)); });
  ring.setAttribute("opacity", sm.repl.toFixed(2));
  /* pressure arrows lengthen with the gradient */
  parr.forEach((p, i) => { const x = [166, 190, 214][i], len = (26 + 52 * sm.grad) * (0.85 + 0.15 * Math.sin(tm / 300 + i));
    p.setAttribute("d", "M" + x + " 348L" + x + " " + f1(348 - len) + "M" + (x - 4) + " " + f1(356 - len) + "L" + x + " " + f1(348 - len) + "L" + (x + 4) + " " + f1(356 - len)); p.setAttribute("opacity", (0.15 + 0.8 * sm.grad).toFixed(2)); });
  /* jet: faster and thinner when tight, weaker in volume when reserve is gone */
  jets.forEach((p) => { p.u = (p.u + dt * (0.3 + 0.75 * sm.grad)) % 1; const q = aTrack.at(p.u), lat = p.off * (1 - 0.65 * sm.sten);
    p.e.setAttribute("cx", f1(q.x + lat)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", clamp(0.15 + 0.8 * sm.reserve).toFixed(2)); });
  /* chain glow and flowing dots */
  const act = { grad: sm.grad, hyp: sm.hyp, res: 1 - sm.reserve, sx: sm.sx, hf: sm.hf };
  Object.keys(NODES).forEach((key) => { nodeEls[key].style.filter = "drop-shadow(0 0 " + (act[NODES[key].k] * 7).toFixed(1) + "px var(--c-cyt))"; });
  Object.keys(arrows).forEach((id) => { const a = arrows[id], v = act[a.k]; a.dots.forEach((d) => { d.u = (d.u + dt * (0.08 + 0.4 * v)) % 1; const q = a.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(v * 1.3).toFixed(2); }); });
  /* symptoms light up with their own drivers */
  angG.style.opacity = (0.25 + 0.75 * sm.sx).toFixed(2);
  synG.style.opacity = (0.25 + 0.75 * clamp(sm.sx * 0.55 + (1 - sm.bp) * 0.65)).toFixed(2);
  brG.style.opacity = (0.25 + 0.75 * clamp(sm.sx * 0.45 + sm.hf * 0.75)).toFixed(2);
  vasoPill.style.opacity = sm.vaso.toFixed(2);
  /* gauges */
  gg.grad.set(sm.grad, wordOf(sm.grad, 0.28, 0.58, ["small", "moderate", "large"])); gg.hyp.set(sm.hyp, wordOf(sm.hyp, 0.3, 0.6, ["thin", "thick", "very thick"]));
  gg.res.set(sm.reserve, wordOf(sm.reserve, 0.38, 0.66, ["low", "reduced", "good"])); gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.6, ["low", "borderline", "held"]));
  gg.sx.set(sm.sx, wordOf(sm.sx, 0.3, 0.6, ["few", "some", "marked"])); gg.hf.set(sm.hf, wordOf(sm.hf, 0.25, 0.55, ["none yet", "rising", "present"]));
}
run({ init, step });
