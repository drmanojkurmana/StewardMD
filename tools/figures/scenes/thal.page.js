/* Thalassaemia scene: globin genes, chain excess, ineffective marrow, microcytic blood, haemolysis, iron and bone. */
const WW = SC.W;
const layers = { prec: $("prec"), frag: $("frag"), ret: $("retics"), rbc: $("rbcs2"), parts: $("parts"), over: $("over"), panel: $("panel"), iron: $("ironDots") };
/* ---- marrow precursors ---- */
const precPts = [[392, 132], [442, 132], [492, 132], [542, 132], [582, 160], [392, 188], [442, 188], [492, 188], [542, 188], [417, 160], [517, 160], [567, 118]];
const precs = precPts.map(([x, y], i) => ({ g: cell(layers.prec, { cls: "prec", r: 15, nuc: 0.45, seed: i * 1.7 + 1, wob: 0.12 }), x, y, i }));
const frags = [];
for (let i = 0; i < 9; i++) { const p = mk("path", { class: "th-frag", d: "M-8 -4L-2 2L-7 7M2 -7L5 0L1 6" }, layers.frag); frags.push({ e: p, x: 380 + (i % 5) * 48, y: 122 + Math.floor(i / 5) * 62 + (i % 2) * 18 }); }
/* ---- reticulocytes leaving the marrow ---- */
const retics = [];
for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-ery" }, layers.ret); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); retics.push({ g, u: i / 6, i }); }
/* ---- red cells in the vessel ---- */
const rbcs = [];
for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-ery" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(660, 928), y: rnd(272, 310), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
/* ---- iron dots stored in the liver ---- */
const idots = [];
[[812, 142], [830, 138], [848, 142], [862, 150], [820, 156], [838, 158], [856, 160], [872, 142], [806, 152], [846, 132], [866, 132], [826, 166]].forEach(([x, y], i) => { const c = mk("circle", { class: "th-idot", cx: x, cy: y, r: 3.2 }, layers.iron); idots.push({ e: c, i }); });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const chains = pool(18, () => mk("circle", { class: "sc-p p-chain", r: 2.6 }, layers.parts));
const irons = pool(14, () => mk("circle", { class: "sc-p p-iron", r: 2.6 }, layers.parts));
const heps = pool(10, () => mk("circle", { class: "sc-p p-hep", r: 2.4 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["imb", "Imbalance", "g-imb", "How unequal the alpha and beta globin chains are. The excess partner chain damages red cell precursors."], ["ineff", "Marrow loss", "g-bad", "Ineffective erythropoiesis: red cell precursors die in the marrow before they can be released."], ["ana", "Anaemia", "g-bad", "Too few healthy red cells reach the blood, so haemoglobin falls."], ["haem", "Haemolysis", "g-bad", "Red cells that do escape are fragile and are broken down early, chiefly in the spleen."], ["iron", "Iron load", "g-iron", "Iron absorbed from the gut plus iron from transfused blood, stored in liver, heart and other organs."], ["bone", "Bone change", "g-bone", "The expanded marrow widens marrow spaces and thins the cortex, reshaping growing bones."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Globin genes", 200, 100, 255, 140, "Four alpha globin genes and two beta globin genes. Loss or reduced output of either set unbalances the chains of haemoglobin.");
  pill(ox, "Haemoglobin", 94, 222, 94, 240, "Adult haemoglobin is two alpha and two beta globin chains. It needs the two chains in equal amounts.");
  pill(ox, "Chain excess", 238, 214, 238, 240, "Unpaired excess chains precipitate inside developing red cells. The inclusion damages the cell membrane.");
  pill(ox, "Marrow precursors", 420, 150, 410, 255, "Developing red cells in the marrow. Excess chains kill many of them here, before release: ineffective erythropoiesis.");
  pill(ox, "Bone expansion", 600, 130, 555, 255, "Anaemia drives the marrow to expand. Marrow spaces widen and bone cortex thins, which reshapes growing bones.");
  pill(ox, "Spleen", 700, 126, 690, 95, "The spleen removes fragile thalassaemic red cells early, shortening their life: haemolysis.");
  pill(ox, "Liver iron", 840, 125, 845, 95, "Excess iron is stored first in the liver and can later load the heart and endocrine organs.");
  pill(ox, "Gut iron uptake", 700, 214, 690, 242, "Anaemia suppresses hepcidin, the liver hormone that limits iron absorption, so more iron enters from the gut.");
  pill(ox, "Microcytic cells", 800, 290, 850, 242, "Cells that reach the blood are small and pale (microcytic, hypochromic) because each carries less haemoglobin.");
  const cp = pill(ox, "Chelation", 860, 168, 850, 195, "Chelation binds excess iron so it can be removed. It does not repair the globin chain defect."); cp.setAttribute("id", "chel-pill");
  const tp = pill(ox, "Transfusion", 790, 320, 790, 348, "Transfused normal red cells restore haemoglobin and quiet the marrow, but each unit adds iron."); tp.setAttribute("id", "tx-pill");
  const hp = pill(ox, "Transplant", 500, 298, 490, 330, "Transplant replaces the marrow with donor marrow that makes balanced globin chains."); hp.setAttribute("id", "hsct-pill");
}
const sm = { a: 0.5, Imb: 0.5, Ineff: 0.5, Ana: 0.5, Haem: 0.3, Micro: 0.5, Iron: 0.3, Bone: 0.3, Hep: 0.5, tx: 0, chel: 0, hsct: 0 };
const acc = { ch: 0, ir: 0, hp: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.a = lerp(sm.a, m.a, k2); sm.Imb = lerp(sm.Imb, m.Imb, k2); sm.Ineff = lerp(sm.Ineff, m.Ineff, k2); sm.Ana = lerp(sm.Ana, m.Ana, k1); sm.Haem = lerp(sm.Haem, m.Haem, k2); sm.Micro = lerp(sm.Micro, m.Micro, k2); sm.Iron = lerp(sm.Iron, m.Iron, k2); sm.Bone = lerp(sm.Bone, m.Bone, k2); sm.Hep = lerp(sm.Hep, m.Hep, k2); sm.tx = lerp(sm.tx, m.tx, k1); sm.chel = lerp(sm.chel, m.chel, k1); sm.hsct = lerp(sm.hsct, m.hsct, k1);
  /* genes and chain bars */
  $("geneX").setAttribute("opacity", clamp((sm.a - 0.08) * 1.3).toFixed(2));
  $("genesA").style.opacity = (1 - 0.25 * sm.a).toFixed(2); $("genesB").style.opacity = (1 - 0.45 * sm.a).toFixed(2);
  $("barA").setAttribute("width", f1(140));
  $("barB").setAttribute("width", f1(Math.max(8, 140 * (1 - 0.78 * sm.Imb))));
  const incl = $("incl"); incl.setAttribute("transform", "translate(238 188) scale(" + (0.55 + 0.65 * sm.Imb).toFixed(3) + ") translate(-238 -188)"); incl.setAttribute("opacity", (0.35 + 0.65 * sm.Imb).toFixed(2));
  /* marrow expansion and precursors */
  const cav = $("marrowCav"); cav.setAttribute("x", f1(356 - 14 * sm.Bone)); cav.setAttribute("width", f1(244 + 28 * sm.Bone)); cav.setAttribute("y", f1(100 - 6 * sm.Bone)); cav.setAttribute("height", f1(120 + 12 * sm.Bone));
  precs.forEach((c) => { const dying = (c.i / precs.length) < sm.Ineff; const s = dying ? 0.55 + 0.08 * Math.sin(tm / 300 + c.i) : 1 + 0.04 * Math.sin(tm / 500 + c.i); place(c.g, c.x + Math.sin(tm / 900 + c.i) * 2, c.y + Math.cos(tm / 1100 + c.i) * 2, 0, s); c.g.style.opacity = dying ? 0.38 : 1; });
  frags.forEach((fr, i) => { place(fr.e, fr.x, fr.y, Math.sin(tm / 700 + i) * 14, 0.7 + 0.3 * sm.Ineff); fr.e.style.opacity = sm.Ineff.toFixed(2); });
  /* reticulocyte output */
  const nRet = Math.round((1 - sm.Ineff) * retics.length);
  retics.forEach((r, i) => { r.u += dt * 0.14 * (1.2 - sm.Ineff); if (r.u > 1) r.u -= 1; const vis = i < nRet; r.g.style.opacity = vis ? 1 : 0; place(r.g, 368 + r.u * 226, 283 + Math.sin(r.u * 9 + i) * 3, 0, vis ? 0.9 : 0.1); });
  /* excess free chains drifting to the inclusion */
  acc.ch += dt * sm.Imb * 7; while (acc.ch >= 1) { acc.ch--; const p = free(chains); if (p) emit(p, rnd(122, 136), rnd(170, 206), rnd(28, 40), rnd(-6, 6), 0); }
  chains.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 232) kill(p); });
  /* vessel red cells: small and pale when microcytic */
  const scell = 1 - 0.38 * sm.Micro;
  rbcs.forEach((r) => { r.x += r.v * 52 * dt * (1 - 0.4 * sm.Haem); if (r.x > 936) { r.x = 660; r.y = rnd(272, 310); } place(r.g, r.x, r.y, r.rot, scell); r.g.style.opacity = (1 - 0.35 * sm.Haem * (Math.sin(tm / 400 + r.x) > 0.7 ? 1 : 0)).toFixed(2); });
  $("spleenG").setAttribute("transform", "translate(700 150) scale(" + (1 + 0.28 * sm.Haem).toFixed(3) + ") translate(-700 -150)");
  /* iron: gut to liver, hepcidin liver to gut */
  acc.ir += dt * (0.4 + 0.9 * (1 - sm.Hep) + 0.7 * sm.tx) * 3.2; while (acc.ir >= 1) { acc.ir--; const p = free(irons); if (p) emit(p, 700, 214, 0, 0, 0); }
  irons.forEach((p) => { if (!p.on) return; p.t += dt; const u = Math.min(1, p.t / 2.2); p.x = lerp(700, 832, u); p.y = lerp(214, 150, u) - Math.sin(u * 3.14) * 18; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (u >= 1) kill(p); });
  acc.hp += dt * sm.Hep * 3.4; while (acc.hp >= 1) { acc.hp--; const p = free(heps); if (p) emit(p, 832, 168, 0, 0, 0); }
  heps.forEach((p) => { if (!p.on) return; p.t += dt; const u = Math.min(1, p.t / 2.4); p.x = lerp(832, 706, u); p.y = lerp(168, 208, u) + Math.sin(u * 3.14) * 10; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (u >= 1) kill(p); });
  idots.forEach((d) => { d.e.style.opacity = d.i < Math.round(sm.Iron * idots.length) ? 1 : 0.08; });
  /* treatment pills */
  $("chel-pill").style.opacity = sm.chel.toFixed(2); $("tx-pill").style.opacity = sm.tx.toFixed(2); $("hsct-pill").style.opacity = sm.hsct.toFixed(2);
  /* gauges */
  gg.imb.set(sm.Imb, wordOf(sm.Imb, 0.25, 0.6, ["balanced", "unequal", "very unequal"])); gg.ineff.set(sm.Ineff, wordOf(sm.Ineff, 0.3, 0.6, ["little", "some", "marked"])); gg.ana.set(sm.Ana, wordOf(sm.Ana, 0.25, 0.55, ["mild", "moderate", "severe"]));
  gg.haem.set(sm.Haem, wordOf(sm.Haem, 0.25, 0.55, ["little", "some", "marked"])); gg.iron.set(sm.Iron, wordOf(sm.Iron, 0.25, 0.55, ["low", "raised", "high"])); gg.bone.set(sm.Bone, wordOf(sm.Bone, 0.25, 0.55, ["normal", "expanded", "marked"]));
}
run({ init, step });
