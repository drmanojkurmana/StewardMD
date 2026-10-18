/* Fungal scene: dermatophytes on keratin, Candida on mucosa, invasive fungi deep, and the wall and membrane targets. */
const LY = { a: $("colA"), b: $("colB"), c: $("colC"), cell: $("fungcell"), parts: $("parts"), over: $("over"), panel: $("panel") };
const REG = [{ x1: 52, x2: 288, y1: 128, y2: 272 }, { x1: 350, x2: 610, y1: 128, y2: 272 }, { x1: 664, x2: 916, y1: 110, y2: 268 }];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- column A: keratin, hair, nail, scaly tinea ring ---- */
const hyphA = mk("g", {}, LY.a);
mk("rect", { class: "fn-ker", x: 44, y: 118, width: 252, height: 34, rx: 8 }, LY.a);
mk("rect", { class: "fn-skin", x: 44, y: 152, width: 252, height: 150, rx: 8 }, LY.a);
mk("rect", { class: "fn-ker", x: 72, y: 104, width: 9, height: 58, rx: 4 }, LY.a);
mk("rect", { class: "fn-ker", x: 214, y: 102, width: 74, height: 16, rx: 7 }, LY.a);
["M58 136C90 124 112 140 140 130C165 121 184 136 214 128C238 122 258 132 282 126", "M66 146C96 138 124 150 156 141C188 132 214 146 250 139"].forEach((d) => mk("path", { class: "fn-hyph", d }, hyphA));
mk("ellipse", { class: "fn-ring", cx: 168, cy: 232, rx: 78, ry: 44 }, LY.a);
mk("ellipse", { class: "fn-ring2", cx: 168, cy: 232, rx: 48, ry: 24 }, LY.a);
const sporeDots = Array.from({ length: 12 }, (_, i) => { const a = i * 0.524; return mk("circle", { class: "sc-p p-spore", cx: f1(168 + Math.cos(a) * 78), cy: f1(232 + Math.sin(a) * 44), r: 3 }, LY.a); });

/* ---- column B: mucosa, white plaques, yeast and pseudohyphae ---- */
mk("rect", { class: "fn-muc", x: 342, y: 118, width: 276, height: 184, rx: 10 }, LY.b);
mk("path", { class: "fn-hyph2", d: "M342 146C390 136 430 152 480 144C530 136 575 150 618 142", opacity: "0.7" }, LY.b);
const plaques = [[390, 126], [470, 122], [548, 128], [430, 134], [585, 122]].map(([x, y]) => mk("ellipse", { class: "fn-plaque", cx: x, cy: y, rx: 17, ry: 7 }, LY.b));
const yeastB = mk("g", {}, LY.b);
[[420, 192, 17], [444, 178, 12], [408, 216, 11]].forEach(([x, y, r], i) => { const g = mk("g", {}, yeastB); cell(g, { cls: "cand", r, nuc: 0.35, seed: i + 3, wob: 0.1 }); place(g, x, y, i * 30, 1); });
const pseudo = mk("g", {}, LY.b);
[[532, 168], [540, 190], [530, 212], [544, 234], [536, 254]].forEach(([x, y], i) => { const g = mk("g", {}, pseudo); cell(g, { cls: "cand", r: 10, nuc: 0.3, seed: i + 8, wob: 0.08 }); place(g, x, y, i * 18, 1); });
mk("path", { class: "fn-hyph2", d: "M532 168C538 196 534 224 540 254" }, pseudo);

/* ---- column C: lung alveoli, Aspergillus, blood yeast, meninges ---- */
[[700, 138, 20], [738, 124, 16], [692, 172, 15], [736, 162, 18]].forEach(([x, y, r]) => mk("circle", { class: "fn-alv", cx: x, cy: y, r }, LY.c));
const hyphC = mk("g", {}, LY.c);
["M806 186C812 158 824 138 842 122", "M818 152C834 142 850 140 866 144", "M824 136C836 124 852 118 868 118", "M810 170C826 164 842 164 856 170"].forEach((d) => mk("path", { class: "fn-hyph", d }, hyphC));
const yeastC = Array.from({ length: 5 }, (_, i) => { const g = mk("g", {}, LY.c); cell(g, { cls: "yeast", r: 7, seed: i + 14, wob: 0.08 }); place(g, 682 + i * 48, 218, i * 25, 1); return g; });
mk("rect", { class: "fn-vessel", x: 664, y: 206, width: 252, height: 26, rx: 13 }, LY.c);
mk("path", { class: "fn-men", d: "M664 262C740 248 840 248 916 262" }, LY.c);
mk("path", { class: "fn-men", d: "M664 282C740 268 840 268 916 282" }, LY.c);
const crypto = [[716, 266], [792, 258], [862, 266]].map(([x, y], i) => { const g = mk("g", {}, LY.c); mk("circle", { class: "fn-halo", r: 15 }, g); cell(g, { cls: "yeast", r: 8, nuc: 0.3, seed: i + 20, wob: 0.06 }); place(g, x, y, 0, 1); return g; });

/* ---- magnified fungal cell: glucan wall outside, ergosterol membrane inside ---- */
mk("circle", { class: "fn-wallring", cx: 150, cy: 386, r: 34 }, LY.cell);
mk("circle", { class: "fn-membring", cx: 150, cy: 386, r: 25 }, LY.cell);
const cellCore = mk("g", {}, LY.cell); cell(cellCore, { cls: "yeast", r: 20, nuc: 0.42, seed: 6, wob: 0.07 }); place(cellCore, 150, 386, 0, 1);
const ergDots = Array.from({ length: 10 }, (_, i) => { const a = i * 0.628; return mk("path", { class: "fn-ergd", d: "M0 -4L3 0L0 4L-3 0Z", transform: "translate(" + f1(150 + Math.cos(a) * 25) + " " + f1(386 + Math.sin(a) * 25) + ")" }, LY.cell); });

/* ---- particles ---- */
const spores = pool(36, () => mk("circle", { class: "sc-p p-spore", r: 2.6 }, LY.parts));
const treats = pool(26, () => mk("path", { class: "sc-p p-treat", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, LY.parts));

/* ---- labels and treatment marks ---- */
const marks = [];
function addMark(drugs, text, x, y, tx, ty, tip) { const g = pill(LY.over, text, x, y, tx, ty, tip); marks.push({ g, drugs }); return g; }
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The infection";
  pill(LY.over, "Dermatophyte", 130, 120, 150, 88, "Dermatophyte fungi grow in keratin (skin, hair and nails) and digest it. They do not invade living tissue in a healthy host.");
  pill(LY.over, "Scaly tinea", 168, 276, 168, 296, "Tinea: a scaly ring that spreads at the active edge and clears in the centre. On nails (onychomycosis) the plate thickens and crumbles, and treatment takes months.");
  pill(LY.over, "Candida yeast", 424, 172, 430, 88, "Candida yeast: a normal mucosal organism. It buds and, when conditions favour it, forms pseudohyphae that cling to the surface.");
  pill(LY.over, "Pseudohyphae", 540, 254, 545, 296, "Chains of elongated Candida cells (pseudohyphae) on the mucosa, under white plaques that can be scraped off (candidiasis).");
  pill(LY.over, "Aspergillus", 824, 128, 800, 88, "Aspergillus: inhaled spores grow as branching, septate hyphae that can invade lung tissue and vessel walls when neutrophil defences are weak.");
  pill(LY.over, "Yeast in blood", 706, 206, 710, 196, "Candida and other yeasts in the bloodstream can seed distant sites in very ill or immunosuppressed patients.");
  pill(LY.over, "Cryptococcus", 862, 272, 855, 306, "Cryptococcus: an encapsulated yeast (pale halo). It can reach the meninges and cause meningitis, mainly when cell-mediated immunity is very weak.");
  pill(LY.over, "Glucan wall", 126, 364, 70, 360, "The fungal wall is rich in glucan. Echinocandins block glucan making, so the wall weakens and the cell bursts.");
  pill(LY.over, "Ergosterol", 176, 386, 260, 410, "The fungal membrane holds ergosterol, not cholesterol. Azoles block ergosterol making and polyenes bind ergosterol directly.");
  addMark([1], "Topical azole", 185, 380, 500, 386, "A topical azole is applied to skin or mucosa. It reaches the surface well, so superficial tinea clears, but it cannot reach nail depth fully or deep tissue.");
  addMark([2], "Systemic azole", 185, 380, 500, 386, "A systemic azole (for example itraconazole) travels in blood and reaches mucosa, nail and tissue, where it blocks ergosterol making.");
  addMark([3], "Polyene", 178, 378, 520, 368, "A polyene binds ergosterol in the membrane and makes holes, so the cell leaks. Used for serious invasive infection.");
  addMark([3], "Echinocandin", 128, 402, 464, 408, "An echinocandin blocks glucan making in the wall. The weakened wall cannot hold the cell together.");
}
const gg = {};
function initGauges() {
  const P = LY.panel, y0 = 478;
  [["burden", "Fungal burden", "g-fung", "How much fungus is present at the site."], ["inv", "Invasion", "g-bad", "How deep the fungus has gone: surface only, mucosa, or deep tissue, blood and meninges."], ["dmg", "Tissue damage", "g-clot", "Scaling, soreness and ulceration at the surface, or tissue and vessel invasion deep down."], ["reach", "Treatment reach", "g-reach", "How well the chosen treatment reaches this depth and hits its target. Topical reaches surface only."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { F: 0.3, Inv: 0.1, Dmg: 0.2, Reach: 0 };
const acc = { sp: 0, tr: 0 };
const hls = [$("hl0"), $("hl1"), $("hl2")];
function init() { initPanel(); initGauges(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.F = lerp(sm.F, m.F, k); sm.Inv = lerp(sm.Inv, m.Inv, k); sm.Dmg = lerp(sm.Dmg, m.Dmg, k); sm.Reach = lerp(sm.Reach, m.Reach, k);
  hls.forEach((h, i) => h.setAttribute("opacity", (i === m.lvl ? 0.95 : 0).toFixed(2)));
  [LY.a, LY.b, LY.c].forEach((g, i) => { g.style.opacity = (i === m.lvl ? 1 : 0.38).toFixed(2); });
  const grow = (0.3 + 0.7 * sm.F).toFixed(2);
  hyphA.style.opacity = grow; hyphC.style.opacity = grow; pseudo.style.opacity = (0.35 + 0.65 * sm.F).toFixed(2);
  yeastB.style.opacity = (0.3 + 0.7 * sm.F).toFixed(2);
  sporeDots.forEach((s) => s.setAttribute("opacity", grow));
  plaques.forEach((p) => p.setAttribute("opacity", (m.lvl === 1 ? 0.35 + 0.65 * sm.F : 0.45).toFixed(2)));
  crypto.forEach((g, i) => place(g, [716, 792, 862][i], [266, 258, 266][i] + Math.sin(tm / 700 + i) * 2, 0, 0.6 + 0.4 * sm.Inv));
  yeastC.forEach((g, i) => place(g, 682 + i * 48 + Math.sin(tm / 600 + i) * 3, 218 + Math.cos(tm / 800 + i) * 1.5, i * 25, 0.5 + 0.5 * sm.Inv));
  ergDots.forEach((e) => e.style.opacity = (1 - 0.75 * sm.Reach).toFixed(2));
  const r = REG[m.lvl];
  acc.sp += dt * sm.F * 14; while (acc.sp >= 1) { acc.sp--; const p = freeP(spores); if (p) emit(p, rnd(r.x1, r.x2), rnd(r.y1, r.y2), rnd(-7, 7), rnd(-5, 7), 0); }
  spores.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.25; p.y += p.vy * dt; if (p.x < r.x1 - 8 || p.x > r.x2 + 8 || p.y < 58 || p.y > 326) p.x = clamp(p.x, r.x1, r.x2), p.y = clamp(p.y, r.y1, r.y2); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4) kill(p); });
  acc.tr += dt * sm.Reach * 12; while (acc.tr >= 1) { acc.tr--; const p = freeP(treats); if (p) emit(p, m.lvl === 0 ? rnd(r.x1, r.x2) : 150, m.lvl === 0 ? 62 : 386, rnd(-4, 4), m.lvl === 0 ? rnd(18, 30) : 0, 0); if (p && m.lvl !== 0) { p.x = 176; p.y = 386; } }
  treats.forEach((p) => { if (!p.on) return; p.t += dt; const tx = m.lvl === 0 ? p.x : (REG[m.lvl].x1 + REG[m.lvl].x2) / 2, ty = m.lvl === 0 ? REG[0].y1 + 30 : (REG[m.lvl].y1 + REG[m.lvl].y2) / 2; if (m.lvl === 0) { p.y += p.vy * dt; } else { p.x += (tx - p.x) * dt * 0.8; p.y += (ty - p.y) * dt * 0.8; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.5).toFixed(2)); if (p.t > 3.5) kill(p); });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  gg.burden.set(sm.F, wordOf(sm.F, 0.18, 0.5, ["low", "present", "heavy"])); gg.inv.set(sm.Inv, wordOf(sm.Inv, 0.18, 0.5, ["limited", "spreading", "deep"]));
  gg.dmg.set(sm.Dmg, wordOf(sm.Dmg, 0.2, 0.5, ["little", "some", "marked"])); gg.reach.set(sm.Reach, wordOf(sm.Reach, 0.25, 0.6, ["none", "partial", "good"]));
}
run({ init, step });
