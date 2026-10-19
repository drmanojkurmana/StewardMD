/* Inguinal scene: indirect sac along the canal, direct bulge through the weak wall, and repair that mends the wall. */
const layers = { bowel: $("bowelSlot"), glow: $("redGlow"), sacI: $("sacI"), sacD: $("sacD"), dots: $("dots"), treat: $("treat"), over: $("over"), panel: $("panel") };
let bowelO = null, capEl = null, capDrug = -1;
let indTrack = track([[189, 171], [250, 150], [380, 205], [520, 262], [632, 295], [690, 368]]);
const dirTrack = track([[440, 250], [535, 278], [625, 295]]);
const cordTrack = track([[250, 150], [380, 205], [520, 262], [632, 295], [700, 380]]);
function initOrgans() {
  bowelO = organ(layers.bowel, "bowel", 150, 108, 130, {});
  indTrack = track([bowelO.ports.out, [250, 150], [380, 205], [520, 262], [632, 295], [690, 368]]);
}
function capText(d) {
  if (d === 1) return "A truss pad holds a reducible hernia in. It does not mend the wall.";
  if (d === 2) return "Planned repair returns the bowel and a mesh mends the weak wall.";
  if (d === 3) return "Emergency surgery frees the trapped bowel and a mesh mends the wall.";
  return "No treatment. The sac stays out and the trapped bowel swells.";
}
/* hernia sacs: outer group placed each frame, inner cell gives a visible filled blob */
function makeSac(parent, cls, r) {
  const g = mk("g", {}, parent);
  const inner = cell(g, { cls: cls, r: r, nuc: 0.35, seed: 3, wob: 0.14 });
  const over = mk("path", { class: "in-sacisch", d: blobD(r * 0.92, 4, 0.12, 8) }, g);
  return { g: g, inner: inner, over: over };
}
const sacI = makeSac(layers.sacI, "sac", 26);
const sacD = makeSac(layers.sacD, "sac2", 20);
/* particle pools: p.e is the element */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const flowDots = pool(18, () => mk("circle", { class: "sc-p p-flow", r: 3 }, layers.dots));
const cordDots = pool(12, () => mk("circle", { class: "sc-p p-cordot", r: 2.4 }, layers.dots));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, u, k) { p.on = true; p.u = u; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* treatment shapes: truss pad with pressure waves, mesh with marching stitches, emergency ring */
let trussG, meshG, emergG, stitchEl, pressA, pressB, emergRing;
function initTreat() {
  meshG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "in-mesh", x: 380, y: 210, width: 190, height: 120, rx: 10 }, meshG);
  for (let i = 0; i < 6; i++) mk("path", { class: "in-meshln", d: "M" + (400 + i * 30) + " 215L" + (400 + i * 30) + " 325" }, meshG);
  for (let i = 0; i < 4; i++) mk("path", { class: "in-meshln", d: "M385 " + (235 + i * 25) + "L565 " + (235 + i * 25) }, meshG);
  stitchEl = mk("rect", { class: "in-stitch", x: 372, y: 202, width: 206, height: 136, rx: 12 }, meshG);
  trussG = mk("g", { opacity: "0" }, layers.treat);
  mk("polygon", { class: "in-band", points: "600,285 705,325 695,355 590,315" }, trussG);
  mk("rect", { class: "in-truss", x: 642, y: 316, width: 58, height: 24, rx: 10, transform: "rotate(28 671 328)" }, trussG);
  pressA = mk("path", { class: "in-press", d: "M628 302 Q652 318 676 334", opacity: "0" }, trussG);
  pressB = mk("path", { class: "in-press", d: "M640 292 Q664 308 688 324", opacity: "0" }, trussG);
  emergG = mk("g", { opacity: "0" }, layers.treat);
  emergRing = mk("circle", { class: "in-emerg", cx: 690, cy: 368, r: 50 }, emergG);
}
/* labels and gauges */
const gg = {};
function initPanel() {
  initTreat();
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The hernia";
  [["sac", "Sac out", "g-sac", "How far the hernia sac protrudes through the canal or the posterior wall."], ["trap", "Trapped", "g-bad", "Whether the sac is stuck outside and cannot be pushed back in."], ["isch", "Blood supply", "g-bad", "Blood supply to the trapped bowel. In strangulation it is cut off, shown as a high gauge here as loss of supply."], ["swell", "Swelling", "g-cyt", "Swelling and tenderness of the trapped sac as it congests."], ["obst", "Obstruction", "g-clot", "Whether bowel content can still pass through the trapped loop."], ["rep", "Wall repair", "g-rep", "Strength restored to the posterior wall. A truss does not repair the wall; a mesh repair does."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, cp = bowelO.ports.coils;
  pill(ox, "Bowel", cp[0], cp[1], 75, 172, "Bowel loop inside the abdomen. A loop can slip out into a hernia sac.");
  pill(ox, "Deep ring", 250, 150, 155, 207, "Deep ring: the outer opening of the canal. An indirect hernia enters here.");
  pill(ox, "Canal", 440, 205, 470, 60, "Inguinal canal: the slanted passage carrying the cord. An indirect sac travels its length.");
  pill(ox, "Vessels", 341, 155, 340, 56, "Lower belly vessels. An indirect sac starts outside them, a direct bulge inside them.");
  pill(ox, "Weak wall", 445, 265, 440, 370, "Weak back wall of the canal. A direct hernia pushes through here.");
  pill(ox, "Indirect sac", 520, 262, 700, 72, "Indirect sac: enters the deep ring, follows the canal and may reach the scrotum.");
  pill(ox, "Direct bulge", 495, 268, 615, 384, "Direct bulge: pushes through the weak wall and rarely reaches the scrotum.");
  const mp = pill(ox, "Mesh repair", 475, 270, 815, 242, "Repair: the sac is returned and a mesh patch mends the weak wall."); mp.setAttribute("id", "mesh-pill"); mp.style.opacity = 0;
  capEl = mk("text", { class: "in-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { sac: 0.5, trapped: 0.1, isch: 0.1, swell: 0.2, obst: 0.1, repair: 0.1, truss: 0, elect: 0, emerg: 0 };
const acc = { flow: 0, cord: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.sac = lerp(sm.sac, m.sac, k2); sm.trapped = lerp(sm.trapped, m.trapped, k2); sm.isch = lerp(sm.isch, m.isch, k2); sm.swell = lerp(sm.swell, m.swell, k2); sm.obst = lerp(sm.obst, m.obst, k2); sm.repair = lerp(sm.repair, m.repair, k1); sm.truss = lerp(sm.truss, m.truss, k1); sm.elect = lerp(sm.elect, m.elect, k1); sm.emerg = lerp(sm.emerg, m.emerg, k1);
  /* indirect sac travels the canal from the bowel; a reducible sac slides in and out */
  let u = 0.16 + 0.78 * sm.sac;
  if (sm.trapped < 0.3 && sm.sac > 0.3 && sm.truss < 0.4 && sm.repair < 0.4) u += Math.sin(tm / 900) * 0.11;
  u = clamp(u, 0.04, 0.98);
  const pos = indTrack.at(u), pulse = 1 + 0.07 * sm.isch * Math.sin(tm / 240);
  place(sacI.g, pos.x, pos.y, pos.a, (0.65 + 0.45 * sm.swell) * pulse);
  sacI.over.style.opacity = sm.isch.toFixed(2);
  /* strangulation glow sits on the trapped sac and drains as blood returns */
  layers.glow.setAttribute("cx", f1(pos.x)); layers.glow.setAttribute("cy", f1(pos.y));
  layers.glow.setAttribute("rx", f1(52 + 26 * sm.swell)); layers.glow.setAttribute("ry", f1(42 + 22 * sm.swell));
  layers.glow.style.opacity = (sm.isch * 0.55).toFixed(2);
  /* direct bulge pushes a shorter, more medial route and hides once the wall is mended */
  const ud = clamp(0.12 + 0.72 * sm.sac, 0.04, 0.96), pd = dirTrack.at(ud);
  place(sacD.g, pd.x, pd.y, pd.a, 0.55 + 0.4 * sm.swell);
  sacD.g.style.opacity = clamp(1 - (sm.repair - 0.5) * 2.2).toFixed(2);
  sacD.over.style.opacity = (sm.isch * 0.8).toFixed(2);
  /* bowel content dots leave the bowel and stall at the sac when obstructed, or pass nearby once repaired */
  acc.flow += dt * (1 - sm.obst * 0.85) * 2.2;
  while (acc.flow >= 1) { acc.flow--; const p = free(flowDots); if (p) emit(p, 0.03, 0); }
  const lim = sm.repair > 0.5 ? 0.34 : u + 0.03;
  flowDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.14 * (1 - sm.obst * 0.9) * (1 - sm.trapped * 0.4); if (p.u > lim) { if (sm.obst > 0.55 && sm.repair <= 0.5) { p.u = lim; p.e.setAttribute("transform", "translate(" + f1(indTrack.at(p.u).x + Math.sin(tm / 180 + p.k) * 2) + " " + f1(indTrack.at(p.u).y) + ")"); return; } kill(p); return; } const q = indTrack.at(clamp(p.u, 0.02, 0.98)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u < 0.02) kill(p); });
  /* cord dots drift along the cord, staying inside the stage */
  acc.cord += dt * 2.6;
  while (acc.cord >= 1) { acc.cord--; const p = free(cordDots); if (p) emit(p, 0.02, 0); }
  cordDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.1; if (p.u > 0.98) { kill(p); return; } const q = cordTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(clamp(q.x, 24, 936)) + " " + f1(clamp(q.y, 54, 430)) + ")"); });
  /* treatments fade in; stitches march round the mesh and the truss presses in waves */
  if (trussG) trussG.setAttribute("opacity", sm.truss.toFixed(2));
  if (meshG) meshG.setAttribute("opacity", (Math.max(sm.elect, sm.emerg) * 0.95).toFixed(2));
  if (emergG) emergG.setAttribute("opacity", sm.emerg.toFixed(2));
  if (stitchEl) stitchEl.setAttribute("stroke-dashoffset", String(Math.round(-(tm / 40) % 14)));
  if (pressA) pressA.style.opacity = (sm.truss * (0.45 + 0.35 * Math.sin(tm / 300))).toFixed(2);
  if (pressB) pressB.style.opacity = (sm.truss * (0.45 + 0.35 * Math.sin(tm / 300 + 2.1))).toFixed(2);
  if (emergRing) emergRing.setAttribute("r", f1(50 + 4 * Math.sin(tm / 400)));
  const meshPill = $("mesh-pill");
  if (meshPill) meshPill.style.opacity = Math.max(sm.elect, sm.emerg).toFixed(2);
  /* gauges: blood supply gauge shows loss of supply */
  gg.sac.set(sm.sac, wordOf(sm.sac, 0.2, 0.6, ["held in", "out", "stuck out"]));
  gg.trap.set(sm.trapped, wordOf(sm.trapped, 0.2, 0.6, ["free", "partly stuck", "trapped"]));
  gg.isch.set(sm.isch, wordOf(sm.isch, 0.2, 0.6, ["intact", "at risk", "cut off"]));
  gg.swell.set(sm.swell, wordOf(sm.swell, 0.25, 0.6, ["mild", "swollen", "very swollen"]));
  gg.obst.set(sm.obst, wordOf(sm.obst, 0.2, 0.6, ["flowing", "slowing", "blocked"]));
  gg.rep.set(sm.repair, wordOf(sm.repair, 0.3, 0.7, ["weak", "supported", "repaired"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
