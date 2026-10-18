/* Inflammatory bowel disease scene: disease map, broken barrier, immune activation, depth of inflammation, ulcers, fissure, fistula and gauges. */
const LY = { mapSeg: $("mapSeg"), wallFx: $("wallFx"), cellsG: $("cellsG"), parts: $("parts"), over: $("over"), panel: $("panel"), inflam: $("inflam") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- disease map segments: patchy, continuous and widespread ---- */
const crohnSegs = [[66, 56], [180, 42], [322, 52], [492, 38], [664, 48]].map(([x, wd]) => mk("rect", { class: "ibd-lesC", x: x, y: 90, width: wd, height: 26, rx: 9, opacity: "0" }, LY.mapSeg));
const ucSeg = mk("rect", { class: "ibd-lesU", x: 566, y: 90, width: 354, height: 26, rx: 9, opacity: "0" }, LY.mapSeg);
const flareSeg = mk("rect", { class: "ibd-lesF", x: 50, y: 90, width: 860, height: 26, rx: 9, opacity: "0" }, LY.mapSeg);

/* ---- wall features: ulcers, deep fissure and fistula ---- */
const ulcerG = mk("g", {}, LY.wallFx);
[[258, 0], [478, 1], [724, 0]].forEach(([x, flip]) => { mk("path", { class: "ibd-ulc", d: "M" + (x - 24) + " 221Q" + x + " " + (244 + flip * 4) + " " + (x + 24) + " 221L" + (x + 14) + " 221Q" + x + " 234 " + (x - 14) + " 221Z" }, ulcerG); });
const fissG = mk("g", {}, LY.wallFx);
mk("path", { class: "ibd-fiss", d: "M424 221L438 332L452 221Q438 232 424 221Z" }, fissG);
const fistG = mk("g", {}, LY.wallFx);
mk("path", { class: "ibd-fist", d: "M636 232C648 282 664 332 678 386" }, fistG);
mk("circle", { class: "ibd-abs", cx: 684, cy: 402, r: 13 }, fistG);

/* ---- cells: epithelial row, macrophages, T cells and neutrophils ---- */
const epiCells = [];
for (let i = 0; i < 15; i++) { const g = mk("g", {}, LY.cellsG); cell(g, { cls: "ent", r: 12, nuc: 0.35, seed: i * 1.4 + 1, wob: 0.07 }); epiCells.push({ g, x: 78 + i * 56, y: 236 }); }
const macs = [[210, 256], [432, 262], [706, 258]].map(([x, y], i) => { const g = mk("g", {}, LY.cellsG); cell(g, { cls: "mac", r: 17, nuc: 0.4, seed: 5 + i * 3, wob: 0.13 }); return { g, x, y, ph: i * 2.1 }; });
const tcells = [[308, 294], [566, 296]].map(([x, y], i) => { const g = mk("g", {}, LY.cellsG); cell(g, { cls: "lymph", r: 13, nuc: 0.5, seed: 14 + i * 4, wob: 0.1 }); return { g, x, y, ph: i * 1.7 }; });
const neus = Array.from({ length: 4 }, (_, i) => { const g = mk("g", {}, LY.cellsG); cell(g, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: 24 + i, wob: 0.14 }); return { g, x: 150 + i * 190, y: 300, ph: i * 1.3 }; });
const lumenBugs = Array.from({ length: 9 }, (_, i) => { const g = mk("g", { class: "cl cl-bac" }, LY.cellsG); mk("ellipse", { class: "cl-b", rx: 6.5, ry: 3.4 }, g); return { g, x: 90 + i * 92, y: 198 + (i % 3) * 7, ph: i * 1.1 }; });

/* ---- particle pools ---- */
const tnfs = pool(38, () => mk("circle", { class: "sc-p p-tnfp", r: 2.4 }, LY.parts));
const bacts = pool(20, () => mk("ellipse", { class: "sc-p p-bactp", rx: 4, ry: 2.2 }, LY.parts));
const asas = pool(18, () => mk("circle", { class: "sc-p p-asap", r: 2.6 }, LY.parts));

/* ---- labels and gauges ---- */
let asaPill, sterPill, bioPill;
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The bowel";
  [["inf", "Inflammation", "g-inf", "How strongly immune cells are active in the bowel wall. Cytokines such as tumour necrosis factor keep the response going."], ["ulc", "Ulceration", "g-ulc", "How much the surface is broken into ulcers. Shallow in ulcerative colitis, deeper and patchier in Crohn disease."], ["wall", "Wall damage", "g-wall", "How deep the inflammation reaches: mucosa only, deep into the wall, or through the full wall."], ["sym", "Symptoms", "g-sym", "Overall symptom burden from the inflamed bowel, such as pain, bleeding and loose stool."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 175 + i * 210, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Skip lesions", 150, 103, 140, 162, "Crohn disease leaves patches of inflamed bowel with healthy bowel between them. The healthy gaps are the skip areas.");
  pill(ox, "Broken barrier", 300, 228, 330, 162, "The epithelial barrier leaks, so gut microbes and their parts meet immune cells in the wall and keep them switched on.");
  pill(ox, "Immune cells", 432, 244, 510, 162, "Macrophages and T cells in the wall release cytokines and recruit more immune cells. This dysregulated response injures the bowel it should protect.");
  pill(ox, "From rectum up", 812, 103, 700, 162, "Ulcerative colitis starts in the rectum and spreads upward through the colon without gaps. It does not affect the small bowel in this figure.");
  pill(ox, "Surface ulcer", 258, 234, 150, 428, "An ulcer is a break in the surface lining. In ulcerative colitis the ulcers are shallow and run together over the inflamed area.");
  pill(ox, "Deep fissure", 438, 318, 370, 428, "In Crohn disease, deep narrow fissures cut into the wall. They are one route to a fistula or abscess.");
  pill(ox, "Fistula tract", 664, 348, 600, 428, "A fistula is an abnormal tunnel from the bowel through the wall to skin or another organ. It forms when transmural Crohn inflammation breaks through.");
  pill(ox, "Wall damage", 850, 344, 820, 428, "Damage deepens as inflammation reaches the muscle and serosa. It drives strictures, fistulae and the need for surgery in severe disease.");
  asaPill = pill(ox, "Aminosalicylate", 760, 268, 855, 162, "An aminosalicylate calms the mucosal surface. It helps most in ulcerative colitis and does little for deep transmural Crohn inflammation.");
  sterPill = pill(ox, "Steroid", 760, 268, 855, 162, "A corticosteroid broadly suppresses the immune cells and cytokines. It settles a flare quickly but heals the wall less fully.");
  bioPill = pill(ox, "Biologic", 760, 268, 855, 162, "A biologic blocks tumour necrosis factor, a key cytokine. Immune recruitment, ulceration and deep wall damage fall in both patterns.");
}
const sm = { I: 0.7, U: 0.6, D: 0.8, Sym: 0.7, Fist: 0.6, crohnP: 1, ucP: 0, flareP: 0, asa: 0, ster: 0, bio: 0 };
const acc = { tnf: 0, bact: 0, asa: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k2 = Math.min(1, dt * 1.1);
  sm.I = lerp(sm.I, m.I, k); sm.U = lerp(sm.U, m.U, k); sm.D = lerp(sm.D, m.D, k); sm.Sym = lerp(sm.Sym, m.Sym, k); sm.Fist = lerp(sm.Fist, m.Fist, k);
  sm.crohnP = lerp(sm.crohnP, m.crohnP, k); sm.ucP = lerp(sm.ucP, m.ucP, k); sm.flareP = lerp(sm.flareP, m.flareP, k);
  sm.asa = lerp(sm.asa, m.asa, k2); sm.ster = lerp(sm.ster, m.ster, k2); sm.bio = lerp(sm.bio, m.bio, k2);
  /* disease map */
  crohnSegs.forEach((r) => r.setAttribute("opacity", (sm.crohnP * (0.25 + 0.75 * sm.I)).toFixed(2)));
  ucSeg.setAttribute("opacity", (sm.ucP * (0.25 + 0.75 * sm.I)).toFixed(2));
  flareSeg.setAttribute("opacity", (sm.flareP * (0.2 + 0.8 * sm.I)).toFixed(2));
  /* depth of inflammation through the wall */
  const depthH = 34 + sm.D * 138;
  LY.inflam.setAttribute("height", f1(depthH)); LY.inflam.setAttribute("opacity", (0.16 + 0.34 * sm.I).toFixed(2));
  /* ulcers, fissure and fistula */
  ulcerG.setAttribute("opacity", clamp(0.15 + 0.85 * sm.U).toFixed(2));
  fissG.setAttribute("opacity", clamp((sm.D - 0.45) * 1.7 * (0.3 + 0.7 * sm.crohnP + 0.5 * sm.flareP)).toFixed(2));
  fistG.setAttribute("opacity", sm.Fist.toFixed(2));
  /* epithelial row thins as ulceration rises */
  epiCells.forEach((c, i) => { place(c.g, c.x, c.y + Math.sin(tm / 900 + i) * 1.1, 0, 1 - 0.45 * sm.U); c.g.style.opacity = (1 - 0.55 * sm.U).toFixed(2); });
  /* immune cells swell with activity */
  macs.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1400 + c.ph) * 3, c.y + Math.cos(tm / 1600 + c.ph) * 2, Math.sin(tm / 2400 + c.ph) * 6, 1 + 0.22 * sm.I * Math.sin(tm / 300 + i)));
  tcells.forEach((c) => place(c.g, c.x + Math.sin(tm / 1200 + c.ph) * 3, c.y, 0, 1 + 0.18 * sm.I));
  neus.forEach((n, i) => { const on = sm.I > 0.28 + i * 0.14; n.g.style.opacity = on ? (0.3 + 0.7 * sm.I).toFixed(2) : "0"; place(n.g, n.x + Math.sin(tm / 700 + n.ph) * 5, 268 + Math.sin(tm / 600 + n.ph) * 5 + (1 - sm.I) * 34, Math.sin(tm / 400 + i) * 14, 0.5 + 0.6 * sm.I); });
  lumenBugs.forEach((b, i) => { place(b.g, b.x + Math.sin(tm / 800 + b.ph) * 8, b.y, Math.sin(tm / 500 + b.ph) * 22, 1); b.g.style.opacity = (0.45 + 0.55 * sm.I).toFixed(2); });
  /* cytokines from macrophages spread through the wall */
  acc.tnf += dt * sm.I * 13; while (acc.tnf >= 1) { acc.tnf--; const p = free(tnfs), s = pick(macs); if (p) emit(p, s.x + rnd(-10, 10), s.y + rnd(-8, 8), rnd(-16, 22), rnd(-8, 18), 0); }
  tnfs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); });
  /* microbes cross the broken barrier into the wall */
  acc.bact += dt * sm.I * sm.U * 7; while (acc.bact >= 1) { acc.bact--; const p = free(bacts); if (p) emit(p, rnd(70, 880), 214, rnd(-4, 4), rnd(18, 30), 0); }
  bacts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 7) + ")"); if (p.y > 310 || p.t > 3) kill(p); });
  /* aminosalicylate coats the mucosal surface */
  acc.asa += dt * sm.asa * 9; while (acc.asa >= 1) { acc.asa--; const p = free(asas); if (p) emit(p, rnd(60, 900), 202, 0, rnd(12, 20), 0); }
  asas.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4) / 0.8).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* treatment pills, only the chosen one is visible */
  asaPill.style.opacity = sm.asa.toFixed(2); sterPill.style.opacity = sm.ster.toFixed(2); bioPill.style.opacity = sm.bio.toFixed(2);
  /* gauges */
  gg.inf.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "moderate", "high"])); gg.ulc.set(sm.U, wordOf(sm.U, 0.35, 0.65, ["little", "some", "extensive"]));
  gg.wall.set(sm.D, wordOf(sm.D, 0.45, 0.75, ["mucosal", "deep", "transmural"])); gg.sym.set(sm.Sym, wordOf(sm.Sym, 0.32, 0.62, ["mild", "moderate", "severe"]));
}
run({ init, step });
