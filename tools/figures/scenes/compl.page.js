/* Complement scene: three pathways into C3 convertase, C3b coating, C5a chemotaxis, MAC lysis and regulators. */
const layers = { nodes: $("nodes"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel"), paths: $("paths") };
const trkIn = [track([[170, 186], [250, 225], [436, 254]]), track([[480, 186], [480, 220]]), track([[790, 186], [710, 225], [524, 254]])];
const trkOut = [track([[440, 282], [330, 320], [232, 344]]), track([[480, 298], [480, 328]]), track([[520, 282], [630, 320], [728, 344]])];

function bacterium(parent, x, y, r, seed) { const g = mk("g", {}, parent); cell(g, { cls: "bact", r: r, nuc: 0.35, seed: seed, wob: 0.12 }); return { g: g, x: x, y: y }; }
const clas = bacterium(layers.nodes, 170, 150, 28, 1);
const lect = bacterium(layers.nodes, 480, 150, 28, 3);
const altb = bacterium(layers.nodes, 790, 150, 28, 5);
[[-70], [-30], [10], [50], [90]].forEach(function (a) { const t = a[0] * 0.01745, d = mk("g", { class: "", transform: "translate(" + f1(170 + Math.cos(t) * 30) + " " + f1(150 + Math.sin(t) * 30) + ") rotate(" + f1(a[0] + 90) + ")" }, layers.nodes); mk("path", { class: "cp-ab", d: "M0 0L0 -7M0 -7L-4 -11M0 -7L4 -11" }, d); });
for (let j = 0; j < 7; j++) { const t = j / 7 * 6.28; mk("circle", { class: "cp-dot", cx: f1(480 + Math.cos(t) * 29), cy: f1(150 + Math.sin(t) * 29), r: 3 }, layers.nodes); mk("circle", { class: "cp-c3bdot", cx: f1(790 + Math.cos(t + 0.4) * 29), cy: f1(150 + Math.sin(t + 0.4) * 29), r: 3 }, layers.nodes); }
const convG = mk("g", {}, layers.nodes); cell(convG, { cls: "conv", r: 25, seed: 7, wob: 0.1, x: -13, y: 0 }); cell(convG, { cls: "conv", r: 25, seed: 9, wob: 0.1, x: 13, y: 0 });
const regN = mk("g", {}, layers.nodes); cell(regN, { cls: "reg", r: 18, seed: 11, wob: 0.08 }); mk("path", { class: "cp-blkx", d: "M-7 0L7 0" }, regN);
const c3bac = bacterium(layers.nodes, 190, 360, 24, 13);
const coatG = mk("g", {}, layers.nodes); for (let j = 0; j < 10; j++) { const t = j / 10 * 6.28; mk("circle", { class: "cp-c3bdot", cx: f1(190 + Math.cos(t) * 27), cy: f1(360 + Math.sin(t) * 27), r: 3.2 }, coatG); }
const phag = cell(layers.cells, { cls: "phag", r: 20, nuc: 0.4, seed: 15, wob: 0.12 });
const c5neut = cell(layers.cells, { cls: "neut2", r: 23, nuc: 0.55, nucCls: "multi", seed: 17, wob: 0.12 });
const wander = cell(layers.cells, { cls: "neut2", r: 13, nuc: 0.55, nucCls: "multi", seed: 19, wob: 0.12 });
const macbac = bacterium(layers.nodes, 760, 360, 27, 21);
const poreG = mk("g", {}, layers.nodes); [[760, 334], [783, 348], [784, 374], [738, 376], [736, 346]].forEach(function (p) { mk("circle", { class: "cp-pore", cx: p[0], cy: p[1], r: 5 }, poreG); });
const blkBadge = mk("g", {}, layers.nodes); mk("circle", { class: "cp-blk", r: 13 }, blkBadge); mk("path", { class: "cp-blkx", d: "M-6 -6L6 6M6 -6L-6 6" }, blkBadge); place(blkBadge, 480, 312, 0, 1);
const replBadge = mk("g", {}, layers.nodes); mk("circle", { class: "cp-plus", r: 12 }, replBadge); mk("path", { class: "cp-plusx", d: "M-6 0L6 0M0 -6L0 6" }, replBadge); place(replBadge, 428, 224, 0, 1);

function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const actP = pool(36, function () { return mk("circle", { class: "sc-p p-act", r: 2.6 }, layers.parts); });
const c3P = pool(22, function () { return mk("circle", { class: "sc-p p-c3b", r: 2.6 }, layers.parts); });
const c5P = pool(22, function () { return mk("circle", { class: "sc-p p-c5a", r: 2.6 }, layers.parts); });
const macP = pool(20, function () { return mk("circle", { class: "sc-p p-mac", r: 2.8 }, layers.parts); });
const fragP = pool(16, function () { return mk("circle", { class: "sc-p p-frag", r: 3 }, layers.parts); });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, k) { p.on = true; p.t = 0; p.k = k; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function ride(pl, trks, dt, speed) { pl.forEach(function (p) { if (!p.on) return; p.t += dt * speed; if (p.t >= 1) { kill(p); return; } const q = trks[p.k].at(p.t); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); }); }

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [170, 390, 610, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The outcome";
  [["conv", "C3 convertase", "g-conv", "The central enzyme. Classical and lectin pathways build it from C4b and C2a; the alternative pathway builds it from C3b and factor B. It splits C3."], ["c3b", "C3b coating", "g-c3b", "C3b stuck on a microbe is an eat-me tag. Phagocyte receptors bind it and engulf the microbe. C3a, the other fragment, is an anaphylatoxin."], ["c5a", "C5a signal", "g-c5a", "C5a is an anaphylatoxin and a strong attractant: neutrophils follow it to the microbe. More C3b also builds the C5 convertase that makes C5a."], ["mac", "MAC lysis", "g-mac", "C5b with C6, C7, C8 and C9 forms the membrane attack complex, a pore that lyses susceptible bacteria. Host cells resist it with regulators such as CD59."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i], y0 + 2, h - 18, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Classical", 170, 120, 170, 92, "Classical pathway: antibody on a surface is recognised by C1, starting the cascade toward C4b2a, a C3 convertase.");
  pill(ox, "Lectin", 480, 120, 480, 92, "Lectin pathway: mannose-binding lectin or ficolins bind microbial sugars and start the same C4b2a convertase, without antibody.");
  pill(ox, "Alternative", 790, 120, 790, 92, "Alternative pathway: C3 ticks over all the time and lands on microbes. Factor B and properdin amplify it into more C3 convertase, unless host regulators stop it.");
  pill(ox, "C3 convertase", 442, 258, 330, 258, "C3 convertase: the centre of the system. It splits many C3 molecules into C3a and C3b, amplifying the response.");
  pill(ox, "Regulators", 830, 238, 830, 205, "Regulators such as C1 inhibitor, factor H, factor I, CD55 and CD59 restrain complement on host cells, so it attacks microbes and spares self.");
  pill(ox, "C3b coating", 190, 388, 200, 412, "C3b coating (opsonisation): C3b on the bacterium lets a phagocyte grab and eat it. A C5 blocker leaves this step working.");
  pill(ox, "C5a signal", 480, 388, 480, 412, "C5a signal: C5a (with C3a) is an anaphylatoxin and pulls neutrophils in by chemotaxis. A C5 blocker silences this step.");
  pill(ox, "MAC pore", 760, 388, 760, 412, "Membrane attack complex (C5b to C9): a pore in the bacterial membrane that lyses the cell. A C5 blocker prevents it.");
}
const sm = { conv: 0.4, c3b: 0.4, c5a: 0.4, mac: 0.3, block: 0, repl: 0 };
const acc = { act: 0, c3: 0, c5: 0, mac: 0, frag: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.conv = lerp(sm.conv, m.conv, k2); sm.c3b = lerp(sm.c3b, m.c3b, k2); sm.c5a = lerp(sm.c5a, m.c5a, k2); sm.mac = lerp(sm.mac, m.mac, k2); sm.block = lerp(sm.block, m.block, k1); sm.repl = lerp(sm.repl, m.repl, k1);
  place(clas.g, clas.x, clas.y + Math.sin(tm / 1300) * 2, Math.sin(tm / 2000) * 5, 1);
  place(lect.g, lect.x, lect.y + Math.cos(tm / 1400) * 2, Math.sin(tm / 2100 + 1) * 5, 1);
  place(altb.g, altb.x, altb.y + Math.sin(tm / 1200 + 2) * 2, Math.sin(tm / 1900 + 2) * 5, 1);
  place(convG, 480 + Math.sin(tm / 1500) * 2, 258 + Math.cos(tm / 1600) * 2, 0, 1 + 0.07 * sm.conv * Math.sin(tm / 280));
  place(regN, 830, 258 + Math.sin(tm / 1700) * 2, 0, 1);
  place(c3bac.g, c3bac.x, c3bac.y, Math.sin(tm / 1800) * 4, 1);
  place(macbac.g, macbac.x, macbac.y, Math.sin(tm / 1600 + 1) * 4, 1 - 0.25 * sm.mac * Math.max(0, Math.sin(tm / 500)));
  coatG.style.opacity = (0.15 + 0.85 * sm.c3b).toFixed(2);
  poreG.style.opacity = (0.1 + 0.9 * sm.mac).toFixed(2);
  poreG.setAttribute("transform", "translate(760 360) scale(" + (0.7 + 0.4 * sm.mac).toFixed(3) + ") translate(-760 -360)");
  place(phag, 252 - 20 * sm.c3b, 360 + Math.sin(tm / 900) * 2, 0, 1);
  place(c5neut, 480, 360 + Math.sin(tm / 800) * 2, Math.sin(tm / 500) * 6, 1);
  const wx = 388 + 58 * sm.c5a, wop = clamp(sm.c5a * 1.4 - 0.1);
  wander.style.opacity = wop.toFixed(2); place(wander, wx, 360 + Math.sin(tm / 600) * 3, 0, 1);
  blkBadge.style.opacity = sm.block.toFixed(2); replBadge.style.opacity = sm.repl.toFixed(2);
  acc.act += dt * sm.conv * 9; while (acc.act >= 1) { acc.act--; const p = freeP(actP); if (p) emit(p, Math.floor(Math.random() * 3)); }
  ride(actP, trkIn, dt, 0.32 + 0.25 * sm.conv);
  acc.c3 += dt * sm.c3b * 7; while (acc.c3 >= 1) { acc.c3--; const p = freeP(c3P); if (p) emit(p, 0); }
  ride(c3P, [trkOut[0]], dt, 0.4);
  acc.c5 += dt * sm.c5a * 7; while (acc.c5 >= 1) { acc.c5--; const p = freeP(c5P); if (p) emit(p, 0); }
  ride(c5P, [trkOut[1]], dt, 0.45);
  acc.mac += dt * sm.mac * 7; while (acc.mac >= 1) { acc.mac--; const p = freeP(macP); if (p) emit(p, 0); }
  ride(macP, [trkOut[2]], dt, 0.4);
  acc.frag += dt * sm.mac * 3.5; while (acc.frag >= 1) { acc.frag--; const p = freeP(fragP); if (p) { emit(p, 0); p.x = 760 + rnd(-18, 18); p.y = 360 + rnd(-18, 18); p.vx = rnd(-26, 26); p.vy = rnd(-22, 22); p.t = 0; } }
  fragP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 692, 828); p.y = clamp(p.y + p.vy * dt, 310, 410); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  gg.conv.set(sm.conv, wordOf(sm.conv, 0.3, 0.65, ["low", "moderate", "high"])); gg.c3b.set(sm.c3b, wordOf(sm.c3b, 0.3, 0.65, ["low", "moderate", "high"])); gg.c5a.set(sm.c5a, wordOf(sm.c5a, 0.3, 0.65, ["low", "moderate", "high"])); gg.mac.set(sm.mac, wordOf(sm.mac, 0.3, 0.65, ["low", "moderate", "high"]));
}
run({ init: init, step: step });
