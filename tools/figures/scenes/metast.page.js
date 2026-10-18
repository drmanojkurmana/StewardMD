/* Metastasis scene: invasion, lymphatic and blood spread, arrest, extravasation and colonisation. */
const WW = SC.W;
const layers = { tracks: $("tracks"), organ: $("organ"), nodeg: $("nodeg"), vessel: $("vessel"), tum: $("tum"), colony: $("colony"), parts: $("parts"), treat: $("treat"), over: $("over"), panel: $("panel") };
const bloodTrack = track([[308, 332], [460, 332], [620, 332], [695, 332], [745, 285], [785, 235], [815, 200]]);
const lymphTrack = track([[205, 165], [290, 98], [375, 84], [450, 100], [505, 112]]);
/* ---- primary tumour and invading cells ---- */
const primOff = [[0, 0], [-22, -12], [20, -16], [-14, 16], [24, 10], [-34, 4], [36, -4], [-6, -28], [10, 26], [-28, 24], [30, -26], [4, -12], [-18, -22], [18, 20], [-38, -14], [42, 16]];
const prim = primOff.map(([dx, dy], i) => { const g = cell(layers.tum, { cls: "tum", r: 11 + (i % 3) * 2, nuc: 0.45, seed: i * 1.7 + 1, wob: 0.16 }); return { g, dx, dy, i }; });
const invOff = [[165, 0], [182, 0], [198, 0], [176, 0], [208, 0]];
const invaders = invOff.map(([x], i) => { const g = cell(layers.tum, { cls: "tum", r: 8, nuc: 0.45, seed: i * 2 + 9, wob: 0.18 }); return { g, x, i }; });
/* ---- node and colony cells ---- */
const nodeOff = [[0, 0], [-24, -10], [22, -12], [-12, 14], [18, 12], [-30, 8], [30, -2]];
const nodeCells = nodeOff.map(([dx, dy], i) => { const g = cell(layers.nodeg, { cls: "tum", r: 9 + (i % 2) * 2, nuc: 0.45, seed: i * 2.3 + 4, wob: 0.16 }); return { g, dx, dy, i }; });
const colOff = [[0, 0], [-26, -14], [24, -18], [-16, 16], [22, 14], [-36, 2], [38, -6], [-6, -26], [8, 26], [-28, 24], [34, 22], [0, -8]];
const colony = colOff.map(([dx, dy], i) => { const g = cell(layers.colony, { cls: "tum", r: 10 + (i % 3) * 2, nuc: 0.45, seed: i * 1.9 + 7, wob: 0.16 }); return { g, dx, dy, i }; });
/* ---- red cells in the vessel ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.vessel); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(300, 690), y: rnd(314, 350), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, x: 0, y: 0, vx: 0 }; }); }
const ctcs = pool(20, () => { const g = mk("g", {}, layers.parts); const c = cell(g, { cls: "tum", r: 6, nuc: 0.45, seed: Math.random() * 9, wob: 0.18 }); return g; });
const lymphCells = pool(12, () => { const g = mk("g", {}, layers.parts); const c = cell(g, { cls: "tum", r: 5.5, nuc: 0.45, seed: Math.random() * 9, wob: 0.18 }); return g; });
const drugs = pool(16, () => mk("path", { class: "p-drug", d: "M-4 0H4M0 -4V4" }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, u) { p.on = true; p.u = u; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [120, 280, 440, 600, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cancer";
  [["pri", "Primary", "g-tum", "The primary tumour at the site where the cancer started. Surgery and radiotherapy act here."], ["inv", "Invasion", "g-tum", "Tumour cells pushing through the basement membrane and into nearby tissue."], ["nod", "Nodes", "g-node", "Tumour in nearby lymph nodes, reached through lymphatic channels."], ["cir", "Circulating", "g-tum", "Circulating tumour cells travelling in the blood. Most die; a few survive."], ["dis", "Distant", "g-dist", "A new colony growing in a distant organ after extravasation."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Primary tumour", 150, 185, 150, 92, "Primary tumour: the original growth. Its cells can detach and invade nearby tissue.");
  pill(ox, "Basement membrane", 75, 235, 85, 275, "Basement membrane: a thin sheet under the surface layer. Crossing it is an early step of local invasion.");
  pill(ox, "Intravasation", 310, 305, 335, 272, "Intravasation: a tumour cell enters a blood vessel and becomes a circulating tumour cell.");
  pill(ox, "Circulating cells", 500, 332, 500, 272, "Circulating tumour cells travel in the blood (haematogenous spread). Most are lost; some survive and arrest in a distant capillary bed.");
  pill(ox, "Lymphatic spread", 330, 92, 330, 60, "Lymphatic spread: tumour cells travel in lymph channels to nearby lymph nodes, often before blood spread.");
  pill(ox, "Lymph node", 560, 95, 645, 72, "A nearby lymph node. Tumour cells arriving in lymph can settle and grow here (nodal spread).");
  pill(ox, "Distant organ", 825, 125, 825, 88, "A distant organ reached through the blood. Its tissue may or may not suit the tumour cell (seed and soil).");
  pill(ox, "Extravasation", 745, 278, 665, 262, "Extravasation: an arrested tumour cell leaves the small vessel and enters the organ tissue.");
  pill(ox, "New colony", 840, 195, 865, 295, "Colonisation: a surviving cell grows into a new tumour colony in the distant organ. Many settled cells never grow.");
  const sp = pill(ox, "Surgery", 110, 382, 110, 410, "Surgery removes the primary tumour, and often nearby nodes. It cannot remove distant colonies already established."); sp.setAttribute("id", "surg-pill");
  const yp = pill(ox, "Systemic therapy", 265, 382, 265, 410, "Systemic therapy travels in the blood, so it can reach circulating cells, nodes and distant colonies."); yp.setAttribute("id", "sys-pill");
  const rp = pill(ox, "Radiotherapy", 410, 378, 410, 410, "Radiotherapy is aimed at the primary site. It shrinks the local tumour but does not treat distant colonies."); rp.setAttribute("id", "rad-pill");
}
function initStatic() {
  /* lymph channel and node */
  mk("path", { class: "mt-lymph", d: "M205 165C290 95 380 82 452 102" }, layers.tracks);
  mk("path", { class: "mt-lymph-in", d: "M205 165C290 95 380 82 452 102" }, layers.tracks);
  mk("ellipse", { class: "mt-node", cx: 525, cy: 115, rx: 58, ry: 40 }, layers.tracks);
  /* distant organ and its capillary bed */
  mk("ellipse", { class: "mt-organ", cx: 825, cy: 185, rx: 88, ry: 68 }, layers.organ);
  mk("path", { class: "mt-cap", d: "M755 165C790 145 860 150 895 175M750 195C795 180 860 185 900 205M765 225C805 210 855 215 890 232" }, layers.organ);
  /* blood vessel */
  mk("rect", { class: "mt-vessel", x: 285, y: 302, width: 420, height: 60, rx: 30 }, layers.vessel);
  mk("path", { class: "mt-arrow", d: "M700 332C725 312 740 292 752 272" }, layers.tracks);
  /* basement membrane and surface layer */
  mk("line", { class: "mt-bm", x1: 40, y1: 235, x2: 260, y2: 235 }, layers.tracks);
  for (let i = 0; i < 7; i++) cell(layers.tracks, { cls: "norm", r: 11, nuc: 0.35, seed: i * 1.4 + 2, wob: 0.08, x: 55 + i * 32, y: 128 });
  /* treatment marks */
  mk("ellipse", { id: "cut", class: "mt-cut", cx: 150, cy: 185, rx: 62, ry: 52, opacity: "0" }, layers.treat);
  const beams = mk("g", { id: "beams", opacity: "0" }, layers.treat);
  mk("path", { class: "mt-beam", d: "M232 78L168 172M252 96L176 178M242 64L160 160" }, beams);
  mk("path", { d: "M100 374l20 14M120 374l-20 14", stroke: "var(--anatomy-strong)", "stroke-width": 2, "stroke-linecap": "round", fill: "none", id: "scalp" }, layers.treat);
  mk("circle", { cx: 265, cy: 382, r: 5, class: "p-drug", id: "drugdot" }, layers.treat);
  mk("path", { class: "mt-beam", d: "M396 368l14 14M424 368l-14 14M410 364v20", id: "radmark" }, layers.treat);
}
const sm = { P: 0.9, I: 0.5, L: 0, C: 0, D: 0, surg: 0, sys: 0, rad: 0 };
const acc = { ctc: 0, lymph: 0, drug: 0 };
function init() { initStatic(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.6);
  sm.P = lerp(sm.P, m.P, k); sm.I = lerp(sm.I, m.I, k); sm.L = lerp(sm.L, m.L, k); sm.C = lerp(sm.C, m.C, k); sm.D = lerp(sm.D, m.D, k); sm.surg = lerp(sm.surg, m.surg, k); sm.sys = lerp(sm.sys, m.sys, k); sm.rad = lerp(sm.rad, m.rad, k);
  prim.forEach((c) => place(c.g, 150 + c.dx, 185 + c.dy + Math.sin(tm / 700 + c.i) * 1.5, Math.sin(tm / 900 + c.i) * 8, Math.max(0.05, sm.P)));
  invaders.forEach((c) => { const y = lerp(214, 256, clamp(sm.I * 1.1 - c.i * 0.07)); place(c.g, c.x, y, Math.sin(tm / 500 + c.i) * 10, Math.max(0.05, sm.I)); c.g.style.opacity = sm.I > 0.08 ? 1 : 0; });
  nodeCells.forEach((c) => place(c.g, 525 + c.dx, 115 + c.dy, 0, Math.max(0.04, sm.L))); 
  colony.forEach((c) => place(c.g, 825 + c.dx, 190 + c.dy + Math.sin(tm / 800 + c.i) * 1.2, 0, Math.max(0.04, sm.D)));
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 695) r.x = 295; place(r.g, r.x, r.y, r.rot, 1); });
  /* circulating tumour cells along the blood route */
  acc.ctc += dt * sm.C * 3.2; while (acc.ctc >= 1) { acc.ctc--; const p = freeP(ctcs); if (p) emitP(p, 0); }
  ctcs.forEach((p) => { if (!p.on) return; p.u += dt * 0.11; if (p.u >= 1) { killP(p); return; } const pt = bloodTrack.at(p.u); place(p.e, pt.x, pt.y, pt.a, 1); });
  /* lymphatic cells to the node */
  acc.lymph += dt * sm.L * 2.6; while (acc.lymph >= 1) { acc.lymph--; const p = freeP(lymphCells); if (p) emitP(p, 0); }
  lymphCells.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; if (p.u >= 1) { killP(p); return; } const pt = lymphTrack.at(p.u); place(p.e, pt.x, pt.y, pt.a, 1); });
  /* systemic therapy particles in the vessel */
  acc.drug += dt * sm.sys * 7; while (acc.drug >= 1) { acc.drug--; const p = freeP(drugs); if (p) { p.on = true; p.x = 292; p.y = rnd(314, 350); p.e.setAttribute("opacity", "1"); } }
  drugs.forEach((p) => { if (!p.on) return; p.x += 85 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 4) + ")"); if (p.x > 698) killP(p); });
  /* treatment marks */
  $("cut").setAttribute("opacity", sm.surg.toFixed(2)); $("beams").setAttribute("opacity", sm.rad.toFixed(2));
  $("surg-pill").style.opacity = sm.surg.toFixed(2); $("sys-pill").style.opacity = sm.sys.toFixed(2); $("rad-pill").style.opacity = sm.rad.toFixed(2);
  $("scalp").style.opacity = sm.surg.toFixed(2); $("drugdot").style.opacity = sm.sys.toFixed(2); $("radmark").style.opacity = sm.rad.toFixed(2);
  gg.pri.set(sm.P, wordOf(sm.P, 0.2, 0.6, ["low", "reduced", "present"])); gg.inv.set(sm.I, wordOf(sm.I, 0.3, 0.65, ["none", "early", "active"]));
  gg.nod.set(sm.L, wordOf(sm.L, 0.2, 0.6, ["clear", "some", "involved"])); gg.cir.set(sm.C, wordOf(sm.C, 0.2, 0.6, ["none", "few", "many"])); gg.dis.set(sm.D, wordOf(sm.D, 0.15, 0.5, ["none", "seeded", "established"]));
}
run({ init, step });
