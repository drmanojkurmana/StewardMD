/* Thalassaemia scene: globin genes, chain excess, ineffective marrow, microcytic blood, haemolysis, iron and bone. */
const WW = SC.W;
const layers = { prec: $("prec"), frag: $("frag"), mdon: $("mdonor"), ret: $("retics"), rbc: $("rbcs2"), don: $("donor"), parts: $("parts"), over: $("over"), panel: $("panel"), iron: $("ironDots") };
let bowelO = null, spleenO = null, liverO = null, trFe = null, trHep = null, capEl = null, capDrug = -1;
function initOrgans() {
  bowelO = organ($("gutSlot"), "bowel", 704, 226, 105, {});
  spleenO = organ($("spleenSlot"), "spleen", 728, 120, 86, {});
  liverO = organ($("liverSlot"), "liver", 865, 138, 120, {});
  const coils = bowelO.ports.coils, lobe = liverO.ports.lobe, porta = liverO.ports.porta;
  trFe = track([coils, [(coils[0] + lobe[0]) / 2, 210], lobe]);
  trHep = track([porta, [(porta[0] + coils[0]) / 2 - 35, Math.max(porta[1], coils[1]) + 26], coils]);
}
function capText(d) {
  if (d === 1) return "Transfusion adds healthy donor red cells. Anaemia eases but each unit adds iron.";
  if (d === 2) return "Chelation traps excess iron so the body can pass it out. Iron stores fall.";
  if (d === 3) return "Transplant gives donor marrow that makes balanced chains. Blood and iron recover.";
  return "No treatment. Extra chains damage young red cells. Anaemia is severe and iron builds up.";
}
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
for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-ery" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(660, 928), y: rnd(298, 336), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); }
/* ---- donor red cells arriving with transfusion: full sized and sturdy ---- */
const donorCells = [];
for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-ery" }, layers.don); mk("ellipse", { class: "cl-b", rx: 10.5, ry: 6.3 }, g); mk("ellipse", { class: "cl-s", rx: 4, ry: 2 }, g); donorCells.push({ g, x: rnd(652, 936), y: rnd(302, 332), v: rnd(0.85, 1.1), rot: rnd(-12, 12) }); }
/* ---- donor marrow cells settling in after transplant ---- */
const mdonor = [];
for (let i = 0; i < 8; i++) { const g = cell(layers.mdon, { cls: "ery", r: 7, nuc: 0.45, seed: i * 2.3 + 5, wob: 0.1 }); mdonor.push({ g, u: i / 8, sx: 436 + i * 14, tx: 388 + ((i * 37) % 184), ty: 122 + ((i * 53) % 78) }); }
/* ---- iron dots stored in the liver ---- */
const idots = [];
[[812, 142], [830, 138], [848, 142], [862, 150], [820, 156], [838, 158], [856, 160], [872, 142], [806, 152], [846, 132], [866, 132], [826, 166]].forEach(([x, y], i) => { const c = mk("circle", { class: "th-idot", cx: x, cy: y, r: 3.2 }, layers.iron); idots.push({ e: c, x, y, i }); });
const dotHide = new Array(12).fill(false);
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, dot: 0 }; }); }
const chains = pool(18, () => mk("circle", { class: "sc-p p-chain", r: 2.6 }, layers.parts));
const irons = pool(14, () => mk("circle", { class: "sc-p p-iron", r: 2.6 }, layers.parts));
const heps = pool(10, () => mk("circle", { class: "sc-p p-hep", r: 2.4 }, layers.parts));
const chels = pool(10, () => mk("circle", { class: "sc-p p-chel", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
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
  pill(ox, "Genes", 190, 95, 185, 150, "Alpha and beta globin genes. Losing output from either set unbalances the chains.");
  pill(ox, "Chain excess", 238, 188, 238, 240, "The leftover partner chains clump inside young red cells and damage them.");
  pill(ox, "Marrow", 478, 160, 560, 252, "Developing red cells in the marrow. Many die here before release.");
  pill(ox, "Spleen", 688, 120, 640, 140, "The spleen clears fragile red cells early, which worsens anaemia.");
  pill(ox, "Liver iron", 865, 170, 880, 212, "Spare iron is stored in the liver first and can later load the heart.");
  pill(ox, "Gut iron", 730, 226, 810, 250, "Low hepcidin lets more iron in from food, adding to transfusion iron.");
  pill(ox, "Blood cells", 800, 317, 800, 372, "Red cells reach blood small and pale, and break down early.");
  capEl = $("capLine");
}
const sm = { a: 0.5, Imb: 0.5, Ineff: 0.5, Ana: 0.5, Haem: 0.3, Micro: 0.5, Iron: 0.3, Bone: 0.3, Hep: 0.5, tx: 0, chel: 0, hsct: 0 };
const acc = { ch: 0, ir: 0, hp: 0, chl: 0 };
function init() { initOrgans(); initPanel(); }
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
  /* donor marrow settling in after transplant */
  const nMd = Math.round(sm.hsct * mdonor.length);
  mdonor.forEach((c, i) => { c.u += dt * 0.45; if (c.u > 1) c.u -= 1; const vis = i < nMd; c.g.style.opacity = vis ? (clamp(c.u / 0.12) * clamp((1 - c.u) / 0.12)).toFixed(2) : 0; place(c.g, lerp(c.sx, c.tx, c.u), lerp(74, c.ty, c.u) + Math.sin(c.u * 6 + i) * 3, 0, 0.9); });
  /* excess free chains drifting to the inclusion */
  acc.ch += dt * sm.Imb * 7; while (acc.ch >= 1) { acc.ch--; const p = free(chains); if (p) emit(p, rnd(122, 136), rnd(170, 206), rnd(28, 40), rnd(-6, 6), 0); }
  chains.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 232) kill(p); });
  /* vessel red cells: small and pale when microcytic */
  const scell = 1 - 0.38 * sm.Micro;
  rbcs.forEach((r) => { r.x += r.v * 52 * dt * (1 - 0.4 * sm.Haem); if (r.x > 936) { r.x = 660; r.y = rnd(298, 336); } place(r.g, r.x, r.y, r.rot, scell); r.g.style.opacity = (1 - 0.35 * sm.Haem * (Math.sin(tm / 400 + r.x) > 0.7 ? 1 : 0)).toFixed(2); });
  /* donor cells stream in along the vessel while transfusing */
  $("dripLine").setAttribute("opacity", sm.tx.toFixed(2));
  const nDon = Math.round(sm.tx * donorCells.length);
  donorCells.forEach((r, i) => { r.x += r.v * 60 * dt; if (r.x > 940) { r.x = 652; r.y = rnd(302, 332); } const vis = i < nDon; r.g.style.opacity = vis ? clamp((r.x - 652) / 46).toFixed(2) : 0; place(r.g, r.x, r.y, r.rot, 1.12); });
  $("spleenG").setAttribute("transform", "translate(728 120) scale(" + (1 + 0.28 * sm.Haem).toFixed(3) + ") translate(-728 -120)");
  /* iron: gut to liver along anatomy ports; chelation captures some in flight */
  acc.ir += dt * (0.4 + 0.9 * (1 - sm.Hep) + 0.7 * sm.tx) * 3.2; while (acc.ir >= 1) { acc.ir--; const p = free(irons); if (p) { const s = trFe.at(0); emit(p, s.x, s.y, 0, 0, (sm.chel > 0.5 && Math.random() < 0.55) ? 1 : 0); } }
  irons.forEach((p) => { if (!p.on) return; p.t += dt; const u = Math.min(1, p.t / 2.2), q = trFe.at(u);
    if (p.k === 1) { const v = clamp((u - 0.35) / 0.4); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y + v * v * 70) + ") scale(" + (1 - v * 0.5).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - v).toFixed(2)); if (u >= 0.75) kill(p); }
    else { p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (u >= 1) kill(p); } });
  /* hepcidin signal: liver to gut */
  acc.hp += dt * sm.Hep * 3.4; while (acc.hp >= 1) { acc.hp--; const p = free(heps); if (p) { const s = trHep.at(0); emit(p, s.x, s.y, 0, 0, 0); } }
  heps.forEach((p) => { if (!p.on) return; p.t += dt; const u = Math.min(1, p.t / 2.4), q = trHep.at(u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (u >= 1) kill(p); });
  /* chelators seek liver iron, sit on it, then carry it down and out */
  const nFe = Math.round(sm.Iron * idots.length);
  if (sm.chel < 0.4) { chels.forEach((p) => { if (p.on) { p.on = false; dotHide[p.dot] = false; p.e.setAttribute("opacity", "0"); } }); acc.chl = 0; }
  else if (nFe > 0) { acc.chl += dt * 5 * sm.chel; while (acc.chl >= 1) { acc.chl--; const p = free(chels); if (p) { p.on = true; p.st = 0; p.t = 0; p.dot = (Math.random() * nFe) | 0; p.x = 865 + rnd(-34, 34); p.y = 100; p.e.setAttribute("opacity", "1"); } } }
  chels.forEach((p) => { if (!p.on) return; const D = idots[p.dot];
    if (p.st === 0) { const dx = D.x - p.x, dy = D.y - p.y, d = Math.hypot(dx, dy) || 1, v = 120 * dt;
      if (d < 7) { p.st = 1; p.t = 0; } else { p.x += dx / d * Math.min(v, d); p.y += dy / d * Math.min(v, d); }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); }
    else if (p.st === 1) { p.t += dt; dotHide[p.dot] = true; p.e.setAttribute("transform", "translate(" + f1(D.x) + " " + f1(D.y) + ")"); if (p.t > 0.7) { p.st = 2; p.t = 0; p.x = D.x; p.y = D.y; } }
    else { p.t += dt; p.y += 54 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) { p.on = false; dotHide[p.dot] = false; p.e.setAttribute("opacity", "0"); } } });
  idots.forEach((d) => { d.e.style.opacity = dotHide[d.i] ? 0 : (d.i < nFe ? 1 : 0.08); });
  /* gauges */
  gg.imb.set(sm.Imb, wordOf(sm.Imb, 0.25, 0.6, ["balanced", "unequal", "very unequal"])); gg.ineff.set(sm.Ineff, wordOf(sm.Ineff, 0.3, 0.6, ["little", "some", "marked"])); gg.ana.set(sm.Ana, wordOf(sm.Ana, 0.25, 0.55, ["mild", "moderate", "severe"]));
  gg.haem.set(sm.Haem, wordOf(sm.Haem, 0.25, 0.55, ["little", "some", "marked"])); gg.iron.set(sm.Iron, wordOf(sm.Iron, 0.25, 0.55, ["low", "raised", "high"])); gg.bone.set(sm.Bone, wordOf(sm.Bone, 0.25, 0.55, ["normal", "expanded", "marked"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
