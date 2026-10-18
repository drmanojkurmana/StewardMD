/* Complement scene: liver made C3 and C5 travel in blood to the germ; three routes build
 * C3 convertase; C3b coating is eaten, C5a calls a neutrophil out of blood, MAC pores burst the germ.
 * A C5 blocker docks on C5 convertase and silences everything downstream, sparing coating. */
const layers = { nodes: $("nodes"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel"), paths: $("paths") };
let liverO = null, vesselO = null, capEl = null, capDrug = -1;
const CLS = [265, 150], LEC = [480, 150], ALT = [695, 150], CONV = [480, 258], C5N = [480, 306];
const COAT = [190, 360], NACT = [600, 355], MACE = [760, 360];
let trkIn = [], trkSup = null, trkCoat = null, trkC5up = null, trkC5low = null, trkMac = null, neutPark = [865, 120];

function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 100, 170, 140, {});
  vesselO = organ($("vesselSlot"), "vessel", 865, 175, 80, { h: 180 });
  vesselO.g.classList.add("hot");
  vesselO.g.setAttribute("data-info", "Blood: C3 and C5 made by the liver travel in blood to the germ. Neutrophils leave blood to follow the C5a signal.");
  const LP = liverO.ports, VP = vesselO.ports;
  $("supTop").setAttribute("d", "M" + f1(LP.out[0]) + " " + f1(LP.out[1]) + " C320 108 600 104 " + f1(VP.in[0]) + " " + f1(VP.in[1]));
  $("supBot").setAttribute("d", "M" + f1(VP.out[0]) + " " + f1(VP.out[1]) + " C780 300 640 306 540 286");
  trkSup = track([LP.out, [270, 110], [560, 108], VP.in, VP.out, [700, 300], [560, 296], [505, 275]]);
  neutPark = VP.lumen.slice();
}
function initTracks() {
  trkIn = [track([CLS, [350, 200], [434, 252]]), track([LEC, [480, 232]]), track([ALT, [610, 210], [526, 252]])];
  trkCoat = track([[444, 282], [330, 320], [218, 352]]);
  trkC5up = track([[480, 283], [480, 299]]);
  trkC5low = track([[480, 313], [480, 352]]);
  trkMac = track([[516, 282], [630, 320], [732, 350]]);
}

function bacterium(parent, x, y, r, seed) { const g = mk("g", {}, parent); cell(g, { cls: "bact", r: r, nuc: 0.35, seed: seed, wob: 0.12 }); return { g: g, x: x, y: y }; }
let clas, lect, altb, convG, regN, c3bac, coatG, phag, c5neut, macbac, poreG, crackG, blkCap, replBadge, glow;
function initNodes() {
  clas = bacterium(layers.nodes, CLS[0], CLS[1], 24, 1);
  lect = bacterium(layers.nodes, LEC[0], LEC[1], 28, 3);
  altb = bacterium(layers.nodes, ALT[0], ALT[1], 28, 5);
  [[-70], [-30], [10], [50], [90]].forEach(function (a) { const t = a[0] * 0.01745, d = mk("g", { transform: "translate(" + f1(CLS[0] + Math.cos(t) * 26) + " " + f1(CLS[1] + Math.sin(t) * 26) + ") rotate(" + f1(a[0] + 90) + ")" }, layers.nodes); mk("path", { class: "cp-ab", d: "M0 0L0 -7M0 -7L-4 -11M0 -7L4 -11" }, d); });
  for (let j = 0; j < 7; j++) { const t = j / 7 * 6.28; mk("circle", { class: "cp-dot", cx: f1(LEC[0] + Math.cos(t) * 29), cy: f1(LEC[1] + Math.sin(t) * 29), r: 3 }, layers.nodes); mk("circle", { class: "cp-c3bdot", cx: f1(ALT[0] + Math.cos(t + 0.4) * 29), cy: f1(ALT[1] + Math.sin(t + 0.4) * 29), r: 3 }, layers.nodes); }
  convG = mk("g", {}, layers.nodes); cell(convG, { cls: "conv", r: 25, seed: 7, wob: 0.1, x: -13, y: 0 }); cell(convG, { cls: "conv", r: 25, seed: 9, wob: 0.1, x: 13, y: 0 });
  regN = mk("g", { class: "hot", "data-info": "Regulators: proteins such as factor H and CD59 brake complement on healthy host cells, so it hits germs and spares self." }, layers.nodes);
  cell(regN, { cls: "reg", r: 16, seed: 11, wob: 0.08 }); mk("path", { class: "cp-blkx", d: "M-6 0L6 0" }, regN);
  mk("circle", { class: "cp-c5n", cx: C5N[0], cy: C5N[1], r: 7 }, layers.nodes);
  glow = mk("ellipse", { class: "cp-glow", cx: 560, cy: 355, rx: 105, ry: 42, opacity: "0" }, layers.nodes);
  blkCap = mk("g", {}, layers.nodes); mk("circle", { class: "cp-blk", r: 12 }, blkCap); mk("path", { class: "cp-blkx", d: "M-6 -6L6 6M6 -6L-6 6" }, blkCap); blkCap.setAttribute("opacity", "0");
  c3bac = bacterium(layers.nodes, COAT[0], COAT[1], 24, 13);
  coatG = mk("g", {}, layers.nodes); for (let j = 0; j < 10; j++) { const t = j / 10 * 6.28; mk("circle", { class: "cp-c3bdot", cx: f1(COAT[0] + Math.cos(t) * 27), cy: f1(COAT[1] + Math.sin(t) * 27), r: 3.2 }, coatG); }
  phag = cell(layers.cells, { cls: "phag", r: 20, nuc: 0.4, seed: 15, wob: 0.12 });
  c5neut = cell(layers.cells, { cls: "neut2", r: 23, nuc: 0.55, nucCls: "multi", seed: 17, wob: 0.12 });
  macbac = bacterium(layers.nodes, MACE[0], MACE[1], 27, 21);
  poreG = mk("g", {}, layers.nodes); [[760, 334], [783, 348], [784, 374], [738, 376], [736, 346]].forEach(function (p) { mk("circle", { class: "cp-pore", cx: p[0], cy: p[1], r: 5 }, poreG); });
  crackG = mk("g", {}, layers.nodes); ["M748 348L756 358L752 368", "M764 344L768 356L776 362", "M742 362L750 368L748 378"].forEach(function (d) { mk("path", { class: "cp-crack", d: d }, crackG); });
  replBadge = mk("g", {}, layers.nodes); mk("circle", { class: "cp-plus", r: 12 }, replBadge); mk("path", { class: "cp-plusx", d: "M-6 0L6 0M0 -6L0 6" }, replBadge); place(replBadge, 150, 205, 0, 1); replBadge.setAttribute("opacity", "0");
}

function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const actP = pool(30, function () { return mk("circle", { class: "sc-p p-act", r: 2.6 }, layers.parts); });
const supP = pool(12, function () { return mk("circle", { class: "sc-p p-act", r: 2.6 }, layers.parts); });
const c3P = pool(20, function () { return mk("circle", { class: "sc-p p-c3b", r: 2.6 }, layers.parts); });
const c5uP = pool(8, function () { return mk("circle", { class: "sc-p p-c5a", r: 2.4 }, layers.parts); });
const c5P = pool(20, function () { return mk("circle", { class: "sc-p p-c5a", r: 2.6 }, layers.parts); });
const macP = pool(18, function () { return mk("circle", { class: "sc-p p-mac", r: 2.8 }, layers.parts); });
const fragP = pool(16, function () { return mk("circle", { class: "sc-p p-frag", r: 3 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, k) { p.on = true; p.t = 0; p.k = k; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(pl, trks, dt, speed) { pl.forEach(function (p) { if (!p.on) return; p.t += dt * speed; if (p.t >= 1) { kill(p); return; } const q = trks[p.k].at(p.t); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); }); }

function capText(d) {
  if (d === 2) return "C5 blocker sits on C5 convertase. Coating goes on, but the neutrophil call and bursting stop.";
  if (d === 1) return "Replacement restores the missing piece, so coating, signalling and bursting build again.";
  return "No treatment. Complement coats germs, calls neutrophils and bursts germs.";
}

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [170, 390, 610, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The outcome";
  [["conv", "C3 convertase", "g-conv", "The central enzyme. Classical and lectin pathways build it from C4b and C2a; the alternative pathway builds it from C3b and factor B. It splits C3."], ["c3b", "C3b coating", "g-c3b", "C3b stuck on a microbe is an eat me tag. Phagocyte receptors bind it and engulf the microbe. C3a, the other fragment, is an anaphylatoxin."], ["c5a", "C5a signal", "g-c5a", "C5a is an anaphylatoxin and a strong attractant: neutrophils leave blood and follow it to the microbe. A C5 blocker sitting on C5 convertase silences this step."], ["mac", "MAC lysis", "g-mac", "C5b with C6, C7, C8 and C9 forms the membrane attack complex, a pore that lyses susceptible bacteria. Host cells resist it with regulators such as CD59."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Liver", 70, 150, 70, 95, "Liver: most complement proteins such as C3 and C5 are made here and released into blood.");
  pill(ox, "Classical", CLS[0], 124, 265, 92, "Classical route: antibody stuck on a germ is gripped by C1, which starts the cascade toward C4b2a, a C3 convertase.");
  pill(ox, "Lectin", LEC[0], 122, 480, 92, "Lectin route: a sugar binding protein grips germ sugars and starts the same C4b2a convertase, with no antibody.");
  pill(ox, "Alternative", ALT[0], 122, 695, 92, "Alternative route: C3 breaks down slowly all the time, and germ surfaces amplify it into more C3 convertase.");
  pill(ox, "C3 convertase", 442, 258, 330, 258, "C3 convertase: the hub enzyme. It splits C3 again and again. Regulators brake it on healthy host cells, and a C5 blocker leaves it working.");
  pill(ox, "Coating", COAT[0], 388, 200, 412, "C3b coating (opsonisation): C3b on the germ lets a phagocyte grab and eat it. A C5 blocker leaves this step working.");
  pill(ox, "C5a signal", 480, 388, 480, 412, "C5a signal: C5a (with C3a) is an anaphylatoxin and pulls neutrophils out of blood. A C5 blocker silences this step.");
  pill(ox, "MAC pore", MACE[0], 388, 760, 412, "Membrane attack complex (C5b to C9): a pore in the germ wall that bursts the cell. With C5 blocked, no pore forms.");
  capEl = mk("text", { class: "cp-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0);
}
const sm = { conv: 0.4, c3b: 0.4, c5a: 0.4, mac: 0.3, block: 0, repl: 0 };
const acc = { act: 0, sup: 0, c3: 0, c5u: 0, c5: 0, mac: 0, frag: 0 };
function init() { initOrgans(); initTracks(); initNodes(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.conv = lerp(sm.conv, m.conv, k2); sm.c3b = lerp(sm.c3b, m.c3b, k2); sm.c5a = lerp(sm.c5a, m.c5a, k2); sm.mac = lerp(sm.mac, m.mac, k2); sm.block = lerp(sm.block, m.block, k1); sm.repl = lerp(sm.repl, m.repl, k1);
  place(clas.g, clas.x, clas.y + Math.sin(tm / 1300) * 2, Math.sin(tm / 2000) * 5, 1);
  place(lect.g, lect.x, lect.y + Math.cos(tm / 1400) * 2, Math.sin(tm / 2100 + 1) * 5, 1);
  place(altb.g, altb.x, altb.y + Math.sin(tm / 1200 + 2) * 2, Math.sin(tm / 1900 + 2) * 5, 1);
  place(convG, 480 + Math.sin(tm / 1500) * 2, 258 + Math.cos(tm / 1600) * 2, 0, 1 + 0.07 * sm.conv * Math.sin(tm / 280));
  place(regN, 770, 222 + Math.sin(tm / 1700) * 2, 0, 1);
  place(c3bac.g, c3bac.x, c3bac.y, Math.sin(tm / 1800) * 4, 1);
  const lys = sm.mac * Math.max(0, Math.sin(tm / 500));
  place(macbac.g, macbac.x, macbac.y, Math.sin(tm / 1600 + 1) * 4, 1 - 0.22 * lys);
  coatG.style.opacity = (0.15 + 0.85 * sm.c3b).toFixed(2);
  poreG.style.opacity = (0.1 + 0.9 * sm.mac).toFixed(2);
  poreG.setAttribute("transform", "translate(760 360) scale(" + (0.7 + 0.4 * sm.mac).toFixed(3) + ") translate(-760 -360)");
  crackG.style.opacity = sm.mac.toFixed(2);
  glow.setAttribute("opacity", (sm.c5a * 0.5).toFixed(2));
  $("c5path").setAttribute("opacity", (1 - 0.7 * sm.block).toFixed(2));
  place(phag, 85 + 53 * sm.c3b, 360 + Math.sin(tm / 900) * 2, 0, 1);
  place(c5neut, lerp(neutPark[0], NACT[0], sm.c5a), lerp(neutPark[1], NACT[1], sm.c5a) + Math.sin(tm / 800) * 2, Math.sin(tm / 500) * 6, 1);
  c5neut.style.opacity = (0.5 + 0.5 * sm.c5a).toFixed(2);
  blkCap.setAttribute("opacity", sm.block.toFixed(2));
  place(blkCap, 480, lerp(252, 306, sm.block), 0, 1);
  replBadge.setAttribute("opacity", sm.repl.toFixed(2));
  acc.act += dt * (0.5 + 8 * sm.conv); while (acc.act >= 1) { acc.act--; const p = freeP(actP); if (p) emit(p, Math.floor(Math.random() * 3)); }
  ride(actP, trkIn, dt, 0.32 + 0.25 * sm.conv);
  acc.sup += dt * (1 + 5 * sm.conv) * (1 + 0.8 * sm.repl); while (acc.sup >= 1) { acc.sup--; const p = freeP(supP); if (p) emit(p, 0); }
  ride(supP, [trkSup], dt, 0.3);
  acc.c3 += dt * sm.c3b * 7; while (acc.c3 >= 1) { acc.c3--; const p = freeP(c3P); if (p) emit(p, 0); }
  ride(c3P, [trkCoat], dt, 0.4);
  acc.c5u += dt * sm.conv * 4; while (acc.c5u >= 1) { acc.c5u--; const p = freeP(c5uP); if (p) emit(p, 0); }
  ride(c5uP, [trkC5up], dt, 0.45);
  acc.c5 += dt * sm.c5a * 7 * (1 - 0.92 * sm.block); while (acc.c5 >= 1) { acc.c5--; const p = freeP(c5P); if (p) emit(p, 0); }
  ride(c5P, [trkC5low], dt, 0.45);
  acc.mac += dt * sm.mac * 7; while (acc.mac >= 1) { acc.mac--; const p = freeP(macP); if (p) emit(p, 0); }
  ride(macP, [trkMac], dt, 0.4);
  acc.frag += dt * sm.mac * 3.5; while (acc.frag >= 1) { acc.frag--; const p = freeP(fragP); if (p) { emit(p, 0); p.x = 760 + rnd(-18, 18); p.y = 360 + rnd(-18, 18); p.vx = rnd(-26, 26); p.vy = rnd(-22, 22); p.t = 0; } }
  fragP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 692, 828); p.y = clamp(p.y + p.vy * dt, 310, 410); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  gg.conv.set(sm.conv, wordOf(sm.conv, 0.3, 0.65, ["low", "moderate", "high"])); gg.c3b.set(sm.c3b, wordOf(sm.c3b, 0.3, 0.65, ["low", "moderate", "high"])); gg.c5a.set(sm.c5a, wordOf(sm.c5a, 0.3, 0.65, ["low", "moderate", "high"])); gg.mac.set(sm.mac, wordOf(sm.mac, 0.3, 0.65, ["low", "moderate", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init: init, step: step });
