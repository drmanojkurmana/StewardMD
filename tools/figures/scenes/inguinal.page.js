/* Inguinal scene: indirect sac along the canal, direct bulge through the posterior wall, cord flow and gauges. */
const layers = { sacI: $("sacI"), sacD: $("sacD"), dots: $("dots"), treat: $("treat"), over: $("over"), panel: $("panel") };
const indTrack = track([[150, 110], [250, 150], [380, 205], [520, 262], [632, 295], [690, 368]]);
const dirTrack = track([[440, 250], [535, 278], [625, 295]]);
const cordTrack = track([[250, 150], [380, 205], [520, 262], [632, 295], [700, 380]]);
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
/* treatment shapes */
let trussG, meshG, emergG;
function initTreat() {
  meshG = mk("g", { opacity: "0" }, layers.treat);
  mk("polygon", { class: "in-mesh", points: "400,215 560,275 545,330 385,270" }, meshG);
  for (let i = 0; i < 5; i++) mk("path", { class: "in-meshln", d: "M" + (405 + i * 32) + " 222L" + (390 + i * 32) + " 322" }, meshG);
  for (let i = 0; i < 4; i++) mk("path", { class: "in-meshln", d: "M392 " + (238 + i * 22) + "L552 " + (292 + i * 10) }, meshG);
  trussG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "in-truss", x: 642, y: 316, width: 58, height: 24, rx: 10, transform: "rotate(28 671 328)" }, trussG);
  emergG = mk("g", { opacity: "0" }, layers.treat);
  mk("circle", { class: "in-emerg", cx: 690, cy: 368, r: 50 }, emergG);
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
  const ox = layers.over;
  pill(ox, "Bowel", 150, 95, 70, 165, "Bowel inside the abdomen. A loop of bowel can enter a hernia sac.");
  pill(ox, "Deep ring", 250, 150, 130, 198, "Deep inguinal ring: the lateral opening of the canal. An indirect hernia enters here, lateral to the inferior epigastric vessels.");
  pill(ox, "Epigastric vessels", 341, 110, 445, 68, "Inferior epigastric vessels. They lie medial to the deep ring, so an indirect hernia starts lateral to them and a direct hernia medial to them.");
  pill(ox, "Anterior wall", 420, 180, 430, 118, "Anterior wall of the canal, in front of the cord and any sac travelling in the canal.");
  pill(ox, "Posterior wall", 345, 218, 240, 272, "Posterior wall of the canal, behind the cord. Weakness here lets a direct hernia push forward.");
  pill(ox, "Indirect sac", 380, 198, 680, 95, "Indirect hernia sac: enters the deep ring, follows the whole canal and may reach the scrotum.");
  pill(ox, "Spermatic cord", 505, 258, 495, 168, "Spermatic cord: the structures travelling in the canal to the testis. The canal and both hernia routes lie around it.");
  pill(ox, "Hesselbach triangle", 440, 255, 440, 365, "Hesselbach triangle: inferior epigastric vessels laterally, rectus abdominis medially, inguinal ligament below. A direct hernia bulges through its weak posterior wall.");
  pill(ox, "Direct bulge", 500, 275, 610, 388, "Direct hernia: pushes through the weak posterior wall inside Hesselbach triangle, medial to the vessels, and rarely reaches the scrotum.");
  pill(ox, "Inguinal ligament", 300, 340, 175, 382, "Inguinal ligament: the lower border of the canal region and the floor on which the canal rests.");
  pill(ox, "Superficial ring", 632, 295, 735, 250, "Superficial inguinal ring: the medial opening of the canal, where the cord and an indirect sac emerge.");
  pill(ox, "Testis", 705, 385, 815, 360, "Testis in the scrotum. An indirect sac can descend alongside the cord toward here.");
  const tp = pill(ox, "Truss pad", 671, 328, 815, 305, "Truss concept: an external pad that can hold a reducible hernia in. It does not cure the hernia and must not be used on a trapped or strangulated hernia."); tp.setAttribute("id", "truss-pill");
  const mp = pill(ox, "Mesh repair", 470, 262, 815, 200, "Elective repair: a planned operation that returns the sac and strengthens the weak posterior wall, shown here as a mesh patch."); mp.setAttribute("id", "mesh-pill");
  const ep = pill(ox, "Emergency surgery", 690, 368, 815, 125, "Emergency surgery: an urgent operation for strangulation, to free the trapped bowel and remove any part that has lost its blood supply."); ep.setAttribute("id", "emerg-pill");
}
const sm = { sac: 0.5, trapped: 0.1, isch: 0.1, swell: 0.2, obst: 0.1, repair: 0.1, truss: 0, elect: 0, emerg: 0 };
const acc = { flow: 0, cord: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.sac = lerp(sm.sac, m.sac, k2); sm.trapped = lerp(sm.trapped, m.trapped, k2); sm.isch = lerp(sm.isch, m.isch, k2); sm.swell = lerp(sm.swell, m.swell, k2); sm.obst = lerp(sm.obst, m.obst, k2); sm.repair = lerp(sm.repair, m.repair, k1); sm.truss = lerp(sm.truss, m.truss, k1); sm.elect = lerp(sm.elect, m.elect, k1); sm.emerg = lerp(sm.emerg, m.emerg, k1);
  /* indirect sac travels the canal; a reducible sac slides in and out */
  let u = 0.16 + 0.78 * sm.sac;
  if (sm.trapped < 0.3 && sm.sac > 0.3 && sm.truss < 0.4 && sm.repair < 0.4) u += Math.sin(tm / 900) * 0.11;
  u = clamp(u, 0.04, 0.98);
  const pos = indTrack.at(u), pulse = 1 + 0.07 * sm.isch * Math.sin(tm / 240);
  place(sacI.g, pos.x, pos.y, pos.a, (0.65 + 0.45 * sm.swell) * pulse);
  sacI.over.style.opacity = sm.isch.toFixed(2);
  /* direct bulge pushes a shorter, more medial route */
  const ud = clamp(0.12 + 0.72 * sm.sac, 0.04, 0.96), pd = dirTrack.at(ud);
  place(sacD.g, pd.x, pd.y, pd.a, 0.55 + 0.4 * sm.swell);
  sacD.g.style.opacity = sm.repair > 0.5 ? (1 - (sm.repair - 0.5)).toFixed(2) : "1";
  sacD.over.style.opacity = (sm.isch * 0.8).toFixed(2);
  /* bowel content dots follow the indirect route and stall when obstructed */
  acc.flow += dt * (1 - sm.obst * 0.85) * 2.2;
  while (acc.flow >= 1) { acc.flow--; const p = free(flowDots); if (p) emit(p, 0.03, 0); }
  flowDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.14 * (1 - sm.obst * 0.9) * (1 - sm.trapped * 0.4); if (p.u > u + 0.03) { if (sm.obst > 0.55) { p.u = u + 0.03; p.e.setAttribute("transform", "translate(" + f1(indTrack.at(p.u).x + Math.sin(tm / 180 + p.k) * 2) + " " + f1(indTrack.at(p.u).y) + ")"); return; } kill(p); return; } const q = indTrack.at(clamp(p.u, 0.02, 0.98)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u < 0.02) kill(p); });
  /* cord dots drift along the cord, staying inside the stage */
  acc.cord += dt * 2.6;
  while (acc.cord >= 1) { acc.cord--; const p = free(cordDots); if (p) emit(p, 0.02, 0); }
  cordDots.forEach((p) => { if (!p.on) return; p.u += dt * 0.1; if (p.u > 0.98) { kill(p); return; } const q = cordTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(clamp(q.x, 24, 936)) + " " + f1(clamp(q.y, 54, 430)) + ")"); });
  /* treatments fade in */
  if (trussG) trussG.setAttribute("opacity", sm.truss.toFixed(2));
  if (meshG) meshG.setAttribute("opacity", (Math.max(sm.elect, sm.emerg) * 0.95).toFixed(2));
  if (emergG) emergG.setAttribute("opacity", sm.emerg.toFixed(2));
  const tp = $("truss-pill"), mp = $("mesh-pill"), ep = $("emerg-pill");
  if (tp) tp.style.opacity = sm.truss.toFixed(2);
  if (mp) mp.style.opacity = Math.max(sm.elect, sm.emerg).toFixed(2);
  if (ep) ep.style.opacity = sm.emerg.toFixed(2);
  /* gauges: blood supply gauge shows loss of supply */
  gg.sac.set(sm.sac, wordOf(sm.sac, 0.2, 0.6, ["held in", "out", "stuck out"]));
  gg.trap.set(sm.trapped, wordOf(sm.trapped, 0.2, 0.6, ["free", "partly stuck", "trapped"]));
  gg.isch.set(sm.isch, wordOf(sm.isch, 0.2, 0.6, ["intact", "at risk", "cut off"]));
  gg.swell.set(sm.swell, wordOf(sm.swell, 0.25, 0.6, ["mild", "swollen", "very swollen"]));
  gg.obst.set(sm.obst, wordOf(sm.obst, 0.2, 0.6, ["flowing", "slowing", "blocked"]));
  gg.rep.set(sm.repair, wordOf(sm.repair, 0.3, 0.7, ["weak", "supported", "repaired"]));
}
run({ init, step });
