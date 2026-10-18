/* Rheumatoid arthritis scene: immune activation, cytokines, thickened synovium, pannus, erosion and gauges. */
const LY = { cells: $("cells"), parts: $("parts"), pannus: $("pannus"), notches: $("notches"), over: $("over"), panel: $("panel"), synL: $("synL"), synR: $("synR"), glow: $("jointGlow"), cartT: $("cartT"), cartB: $("cartB") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }

/* ---- cells ---- */
const apcG = mk("g", {}, LY.cells); cell(apcG, { cls: "mac", r: 26, nuc: 0.4, seed: 3, wob: 0.15 });
const tG = mk("g", {}, LY.cells); cell(tG, { cls: "lymph", r: 22, nuc: 0.5, seed: 7, wob: 0.1 });
const bG = mk("g", {}, LY.cells); cell(bG, { cls: "bcell", r: 22, nuc: 0.45, seed: 11, wob: 0.1 });
const synMacs = [[348, 165], [612, 335]].map(([x, y], i) => { const g = mk("g", {}, LY.cells); cell(g, { cls: "mac", r: 15, nuc: 0.4, seed: 20 + i, wob: 0.14 }); return { g, x, y }; });
const osteoG = mk("g", { class: "cl cl-mast" }, LY.cells); cell(osteoG, { cls: "mast", r: 16, nuc: 0.3, seed: 31, wob: 0.16 });
[[-6, -3], [5, 2], [-1, 6]].forEach(([x, y]) => mk("circle", { class: "cl-n", cx: x, cy: y, r: 3 }, osteoG));

/* ---- pannus and erosion notches ---- */
const panPts = [[385, 215], [575, 215], [385, 285], [575, 285]];
const pans = panPts.map(([x, y], i) => { const g = mk("g", {}, LY.pannus); mk("path", { class: "ra-pan", d: blobD(20, i * 2 + 1, 0.28, 8) }, g); return { g, x, y }; });
const notchPts = [[400, 206], [560, 206], [400, 294], [560, 294]];
const notches = notchPts.map(([x, y]) => ({ e: mk("circle", { class: "ra-notch", cx: x, cy: y, r: 9 }, LY.notches), x, y }));

/* ---- particles ---- */
const abs = pool(12, () => abShape(LY.parts));
const tnfs = pool(36, () => mk("circle", { class: "sc-p p-tnf", r: 2.5 }, LY.parts));
const il6s = pool(28, () => mk("rect", { class: "sc-p p-il6", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, LY.parts));
const enzs = pool(24, () => mk("circle", { class: "sc-p p-enz", r: 1.9 }, LY.parts));

/* ---- labels ---- */
let dmardPill, tnfPill, steroidPill;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The joint";
  [["imm", "Immune activity", "g-imm", "How strongly T cells, B cells and presenting cells are driving the autoimmune attack."], ["cyt", "Cytokines", "g-cyt", "TNF and IL-6 released by T cells, macrophages and synovial cells. They drive the inflammation."], ["pan", "Pannus", "g-pan", "Invasive synovial tissue that grows over cartilage and into bone. This is what destroys the joint."], ["dmg", "Joint damage", "g-bad", "Cartilage loss and bone erosion. Once lost, cartilage and bone do not grow back in this figure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Presenting cell", 95, 164, 95, 110, "A presenting cell shows self antigen to T cells. In rheumatoid arthritis, tolerance to self antigens such as citrullinated proteins is lost.");
  pill(ox, "T cell", 205, 142, 230, 110, "T cell: activated by the presenting cell. It helps B cells and releases cytokines that switch on macrophages and the synovium.");
  pill(ox, "B cell", 205, 260, 110, 330, "B cell: helped by T cells, it matures and makes autoantibodies.");
  pill(ox, "Autoantibodies", 262, 272, 235, 330, "Autoantibodies such as rheumatoid factor and anti-CCP. They mark the autoimmune process and help sustain it.");
  pill(ox, "TNF and IL-6", 612, 200, 760, 110, "TNF and IL-6: the main cytokines. TNF drives synovial inflammation and osteoclasts; IL-6 drives inflammation and the acute phase response.");
  pill(ox, "Synovium", 632, 250, 885, 110, "Synovium: the joint lining. Normally thin; here it thickens with immune cells and new vessels (synovitis) and becomes pannus.");
  pill(ox, "Pannus", 575, 218, 760, 330, "Pannus: the thickened, invasive synovium. It creeps over cartilage, releases enzymes and erodes the bone beneath.");
  pill(ox, "Cartilage", 545, 216, 885, 330, "Cartilage: the smooth cap on the bone end. Enzymes from pannus digest it; it thins and is lost.");
  pill(ox, "Bone erosion", 560, 292, 760, 385, "Bone erosion: osteoclasts, switched on by cytokines and pannus, eat into the bone at the joint margin.");
  pill(ox, "Osteoclast", 578, 296, 885, 385, "Osteoclast: a large multinucleated cell that resorbs bone. TNF helps create and activate it.");
  dmardPill = pill(ox, "DMARD", 185, 220, 130, 385, "A DMARD slows the T cell and B cell attack itself. It protects the joint, but takes time to work.");
  tnfPill = pill(ox, "TNF blocked", 540, 205, 800, 175, "A TNF blocker neutralises TNF. TNF-driven inflammation, pannus and erosion fall; some IL-6 activity remains.");
  steroidPill = pill(ox, "Steroid", 632, 260, 800, 175, "A steroid calms the lining and symptoms quickly, but pannus and erosion are much less well controlled.");
}
const sm = { A: 0.5, C: 0.4, Tnf: 0.4, Il6: 0.4, P: 0.3, E: 0.3, dmard: 0, tnfBlock: 0, steroid: 0 };
const acc = { ab: 0, tnf: 0, il6: 0, enz: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k2 = Math.min(1, dt * 1.2);
  sm.A = lerp(sm.A, m.A, k); sm.C = lerp(sm.C, m.C, k); sm.Tnf = lerp(sm.Tnf, m.Tnf, k); sm.Il6 = lerp(sm.Il6, m.Il6, k);
  sm.P = lerp(sm.P, m.P, k); sm.E = lerp(sm.E, m.E, k);
  sm.dmard = lerp(sm.dmard, m.dmard, k2); sm.tnfBlock = lerp(sm.tnfBlock, m.tnfBlock, k2); sm.steroid = lerp(sm.steroid, m.steroid, k2);
  const I = clamp(0.12 + 0.8 * sm.C + 0.1 * sm.A);
  /* immune cells bob and swell with activity */
  place(apcG, 95 + Math.sin(tm / 1500) * 3, 190 + Math.cos(tm / 1700) * 2, 0, 1 + 0.07 * sm.A * Math.sin(tm / 300));
  place(tG, 205 + Math.sin(tm / 1300 + 2) * 3, 160, 0, 1 + 0.09 * sm.A * Math.sin(tm / 280 + 1));
  place(bG, 205, 260 + Math.cos(tm / 1400) * 2, 0, 1 + 0.09 * sm.A * Math.sin(tm / 320 + 2));
  synMacs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 900 + i * 2) * 2, 0, 1 + 0.2 * sm.C));
  /* synovium thickens, joint glows, cartilage thins */
  const sw = 14 + 22 * I;
  LY.synL.setAttribute("width", f1(sw)); LY.synR.setAttribute("x", f1(645 - sw)); LY.synR.setAttribute("width", f1(sw));
  LY.glow.setAttribute("opacity", (0.26 * sm.C).toFixed(2));
  const cw = f1(Math.max(2.5, 10 - 6.5 * sm.E));
  LY.cartT.setAttribute("stroke-width", cw); LY.cartB.setAttribute("stroke-width", cw);
  /* pannus creeps, notches deepen, osteoclast works */
  pans.forEach((p) => { place(p.g, p.x, p.y, 0, 0.25 + 0.95 * sm.P); p.g.style.opacity = (0.2 + 0.8 * sm.P).toFixed(2); });
  notches.forEach((n) => { n.e.setAttribute("transform", "translate(" + f1(n.x) + " " + f1(n.y) + ") scale(" + f1(Math.max(0.05, sm.E)) + ") translate(" + f1(-n.x) + " " + f1(-n.y) + ")"); n.e.setAttribute("opacity", sm.E.toFixed(2)); });
  place(osteoG, 572, 292 + Math.sin(tm / 700) * 1.5, 0, 0.4 + 0.8 * sm.E); osteoG.style.opacity = (0.25 + 0.75 * sm.E).toFixed(2);
  /* autoantibodies: B cell to synovium */
  acc.ab += dt * sm.A * 3.2; while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) emit(p, 228, 258, 30, -4, 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 300 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 322 || p.t > 5) kill(p); });
  /* cytokines: TNF circles and IL-6 squares toward the joint */
  const src = [[205, 172], [348, 165], [612, 322]];
  acc.tnf += dt * sm.Tnf * 11; while (acc.tnf >= 1) { acc.tnf--; const p = free(tnfs), s = pick(src); if (p) emit(p, s[0], s[1], rnd(8, 26), rnd(-8, 14), 0); }
  acc.il6 += dt * sm.Il6 * 8; while (acc.il6 >= 1) { acc.il6--; const p = free(il6s), s = pick(src); if (p) emit(p, s[0], s[1], rnd(8, 24), rnd(-6, 14), 0); }
  [tnfs, il6s].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 480 - p.x, dy = 250 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (p.vx + (dx / d) * 22) * dt; p.y += (p.vy + (dy / d) * 22) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 30 || p.t > 7) kill(p); }));
  /* enzymes from pannus toward cartilage */
  acc.enz += dt * sm.P * sm.E * 9; while (acc.enz >= 1) { acc.enz--; const p = free(enzs), s = pick(panPts); if (p) emit(p, s[0], s[1], (480 - s[0]) * 0.14, (s[1] < 250 ? -6 : 6), 0); }
  enzs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6) kill(p); });
  /* treatment pills fade in for the chosen treatment */
  dmardPill.style.opacity = sm.dmard.toFixed(2); tnfPill.style.opacity = sm.tnfBlock.toFixed(2); steroidPill.style.opacity = sm.steroid.toFixed(2);
  /* gauges */
  gg.imm.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["low", "moderate", "high"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.pan.set(sm.P, wordOf(sm.P, 0.45, 0.7, ["small", "growing", "extensive"])); gg.dmg.set(sm.E, wordOf(sm.E, 0.3, 0.7, ["little", "moderate", "severe"]));
}
run({ init, step });
