/* Inflammatory bowel disease scene: bowel and colon map with pattern lesions, wall close up
 * with barrier breach, immune attack, ulcers, fissure, fistula and gauges. */
const LY = { washG: $("washG"), lesG: $("lesG"), wallFx: $("wallFx"), cellsG: $("cellsG"), parts: $("parts"), over: $("over"), panel: $("panel"), inflam: $("inflam"), coat: $("coat") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- real organ art, with pattern lesions anchored to the organ ports ---- */
let bowelO = null, colonO = null, washB = null, washC = null, ucBand = null;
const crohnSpots = [];
function initOrgans() {
  bowelO = organ($("gutSlot"), "bowel", 250, 116, 132, {});
  colonO = organ($("colonSlot"), "colon", 640, 116, 88, {});
  washB = mk("ellipse", { class: "ibd-wash", cx: f1(bowelO.x), cy: f1(bowelO.y), rx: f1(bowelO.w * 0.62), ry: f1(bowelO.h * 0.62), opacity: "0" }, LY.washG);
  washC = mk("ellipse", { class: "ibd-wash", cx: f1(colonO.x), cy: f1(colonO.y), rx: f1(colonO.w * 0.62), ry: f1(colonO.h * 0.62), opacity: "0" }, LY.washG);
  const coils = bowelO.ports.coils, CP = colonO.ports;
  [[coils[0] - 30, coils[1] - 20, 13], [coils[0] + 25, coils[1] - 5, 10], [coils[0] - 5, coils[1] + 30, 11]].forEach(([x, y, r]) => {
    crohnSpots.push(mk("circle", { class: "ibd-spotC", cx: f1(x), cy: f1(y), r: r, opacity: "0" }, LY.lesG));
  });
  const ce = CP.caecum;
  crohnSpots.push(mk("circle", { class: "ibd-spotC", cx: f1(ce[0]), cy: f1(ce[1]), r: 11, opacity: "0" }, LY.lesG));
  ucBand = mk("path", { class: "ibd-ucband", d: "M" + f1(CP.rectum[0]) + " " + f1(CP.rectum[1]) + "L" + f1(CP.sigmoid[0]) + " " + f1(CP.sigmoid[1]) + "L" + f1(CP.descending[0]) + " " + f1(CP.descending[1]), opacity: "0" }, LY.lesG);
}

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
const sterD = pool(14, () => mk("circle", { class: "sc-p p-sterp", r: 2.6 }, LY.parts));
const bioD = pool(16, () => mk("circle", { class: "sc-p p-biodp", r: 3.4 }, LY.parts));

/* ---- in stage caption, changed with the state ---- */
let capEl = null, capDrug = -1;
function capText(d, l) {
  if (d === 1) return "Aminosalicylate coats the surface. Shallow ulcers heal but deep damage lingers.";
  if (d === 2) return "Steroid switches the immune cells off. Inflammation fades fast but the wall heals slowly.";
  if (d === 3) return "Biologic traps the TNF signal. Recruitment falls and the wall heals.";
  return l === 2 ? "No treatment. Severe flare: inflammation spreads and the wall breaks down." : "No treatment. Immune attack continues and ulcers stay open.";
}

/* ---- labels and gauges: 7 static pills plus one treatment pill ---- */
let drugPill, drugPillText, drugPillDot, drugPillPath;
const DRUG_SLOT = { tx: 800, ty: 428 };
const DRUG_INFO = {
  1: ["Aminosalicylate", 560, 230, "An aminosalicylate coats the surface and calms it. It helps ulcerative colitis more than deep Crohn disease."],
  2: ["Steroid", 432, 262, "A corticosteroid switches immune cells off everywhere. It settles flares but heals the wall slowly."],
  3: ["Biologic", 500, 290, "A biologic traps TNF, a key alarm signal. Recruitment, ulcers and deep damage fall in both patterns."]
};
function setDrugPill(d) {
  const info = DRUG_INFO[d]; if (!info) return;
  if (drugPillText.textContent !== info[0]) drugPillText.textContent = info[0];
  drugPillDot.setAttribute("cx", f1(info[1])); drugPillDot.setAttribute("cy", f1(info[2]));
  drugPillPath.setAttribute("d", "M" + f1(info[1]) + " " + f1(info[2]) + "L" + DRUG_SLOT.tx + " " + (DRUG_SLOT.ty + 8));
  drugPill.setAttribute("data-info", info[3]);
}
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The bowel";
  [["inf", "Inflammation", "g-inf", "How strongly immune cells are active in the bowel wall. Cytokines such as tumour necrosis factor keep the response going."], ["ulc", "Ulceration", "g-ulc", "How much the surface is broken into ulcers. Shallow in ulcerative colitis, deeper and patchier in Crohn disease."], ["wall", "Wall damage", "g-wall", "How deep the inflammation reaches: mucosa only, deep into the wall, or through the full wall."], ["sym", "Symptoms", "g-sym", "Overall symptom burden from the inflamed bowel, such as pain, bleeding and loose stool."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 175 + i * 210, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Small bowel", 250, 70, 100, 116, "Small bowel, often the terminal ileum. In Crohn disease patchy inflamed spots appear here with healthy bowel between them.");
  pill(ox, "Colon", 640, 70, 848, 116, "Colon and rectum. Ulcerative colitis affects the colon only, spreading upward from the rectum without gaps.");
  pill(ox, "Leaky surface", 330, 232, 400, 162, "The surface barrier leaks, so microbes meet immune cells in the wall and keep them switched on.");
  pill(ox, "Immune attack", 432, 262, 540, 162, "Macrophages and T cells release TNF and recruit more cells. This friendly fire injures the bowel.");
  pill(ox, "Ulcers", 258, 228, 150, 428, "Ulcers are breaks in the surface. Shallow and joined in ulcerative colitis, patchy in Crohn disease.");
  pill(ox, "Fissure", 438, 300, 370, 428, "In Crohn disease deep narrow cracks cut through the wall and can open into a fistula.");
  pill(ox, "Fistula", 664, 340, 600, 428, "A fistula is a tunnel through the wall to skin or another organ, from deep Crohn inflammation.");
  drugPill = pill(ox, "Aminosalicylate", 560, 230, DRUG_SLOT.tx, DRUG_SLOT.ty, DRUG_INFO[1][3]);
  drugPillText = drugPill.querySelector("text"); drugPillDot = drugPill.querySelector("circle"); drugPillPath = drugPill.querySelector("path");
  drugPill.style.opacity = "0";
  capEl = mk("text", { class: "ibd-cap", x: 30, y: 30 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { I: 0.7, U: 0.6, D: 0.8, Sym: 0.7, Fist: 0.6, crohnP: 1, ucP: 0, flareP: 0, asa: 0, ster: 0, bio: 0 };
const acc = { tnf: 0, bact: 0, asa: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k2 = Math.min(1, dt * 1.1);
  sm.I = lerp(sm.I, m.I, k); sm.U = lerp(sm.U, m.U, k); sm.D = lerp(sm.D, m.D, k); sm.Sym = lerp(sm.Sym, m.Sym, k); sm.Fist = lerp(sm.Fist, m.Fist, k);
  sm.crohnP = lerp(sm.crohnP, m.crohnP, k); sm.ucP = lerp(sm.ucP, m.ucP, k); sm.flareP = lerp(sm.flareP, m.flareP, k);
  sm.asa = lerp(sm.asa, m.asa, k2); sm.ster = lerp(sm.ster, m.ster, k2); sm.bio = lerp(sm.bio, m.bio, k2);
  /* pattern lesions on the real organs: patchy Crohn spots, continuous UC band, flare wash */
  const lesOp = 0.35 + 0.65 * sm.I;
  crohnSpots.forEach((s) => s.setAttribute("opacity", (sm.crohnP * lesOp).toFixed(2)));
  ucBand.setAttribute("opacity", (sm.ucP * lesOp).toFixed(2));
  washB.setAttribute("opacity", (sm.flareP * (0.25 + 0.75 * sm.I)).toFixed(2));
  washC.setAttribute("opacity", (sm.flareP * (0.25 + 0.75 * sm.I)).toFixed(2));
  /* depth of inflammation through the wall, plus the golden aminosalicylate coat on the surface */
  const depthH = 34 + sm.D * 138;
  LY.inflam.setAttribute("height", f1(depthH)); LY.inflam.setAttribute("opacity", (0.16 + 0.34 * sm.I).toFixed(2));
  LY.coat.setAttribute("opacity", (0.85 * sm.asa).toFixed(2));
  /* ulcers, fissure and fistula */
  ulcerG.setAttribute("opacity", clamp(0.15 + 0.85 * sm.U).toFixed(2));
  fissG.setAttribute("opacity", clamp((sm.D - 0.45) * 1.7 * (0.3 + 0.7 * sm.crohnP + 0.5 * sm.flareP)).toFixed(2));
  fistG.setAttribute("opacity", sm.Fist.toFixed(2));
  /* epithelial row thins as ulceration rises */
  epiCells.forEach((c, i) => { place(c.g, c.x, c.y + Math.sin(tm / 900 + i) * 1.1, 0, 1 - 0.45 * sm.U); c.g.style.opacity = (1 - 0.55 * sm.U).toFixed(2); });
  /* immune cells swell with activity, and visibly shrink as steroid switches them off */
  const calm = 1 - 0.38 * sm.ster;
  macs.forEach((c, i) => { place(c.g, c.x + Math.sin(tm / 1400 + c.ph) * 3, c.y + Math.cos(tm / 1600 + c.ph) * 2, Math.sin(tm / 2400 + c.ph) * 6, (1 + 0.22 * sm.I * Math.sin(tm / 300 + i)) * calm); c.g.style.opacity = (1 - 0.45 * sm.ster).toFixed(2); });
  tcells.forEach((c) => { place(c.g, c.x + Math.sin(tm / 1200 + c.ph) * 3, c.y, 0, (1 + 0.18 * sm.I) * calm); c.g.style.opacity = (1 - 0.45 * sm.ster).toFixed(2); });
  neus.forEach((n, i) => { const on = sm.I * (1 - 0.55 * sm.ster) > 0.28 + i * 0.14; n.g.style.opacity = on ? (0.3 + 0.7 * sm.I).toFixed(2) : "0"; place(n.g, n.x + Math.sin(tm / 700 + n.ph) * 5, 268 + Math.sin(tm / 600 + n.ph) * 5 + (1 - sm.I) * 34, Math.sin(tm / 400 + i) * 14, (0.5 + 0.6 * sm.I) * calm); });
  lumenBugs.forEach((b, i) => { place(b.g, b.x + Math.sin(tm / 800 + b.ph) * 8, b.y, Math.sin(tm / 500 + b.ph) * 22, 1); b.g.style.opacity = (0.45 + 0.55 * sm.I).toFixed(2); });
  /* cytokines from macrophages spread through the wall; steroid switched cells make fewer */
  acc.tnf += dt * sm.I * 13 * (1 - 0.65 * sm.ster); while (acc.tnf >= 1) { acc.tnf--; const p = free(tnfs), s = pick(macs); if (p) emit(p, s.x + rnd(-10, 10), s.y + rnd(-8, 8), rnd(-16, 22), rnd(-8, 18), 0); }
  tnfs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.4) kill(p); });
  /* steroid dots land on immune cells and sit on them while the cells shrink */
  if (sm.ster > 0.5 && Math.random() < dt * 7) { const p = free(sterD); if (p) { const c = pick(macs.concat(tcells).concat(neus)); p.tg = c; emit(p, c.x + rnd(-30, 30), 192, rnd(-6, 6), rnd(25, 40), 0); } }
  sterD.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1);
      const c = p.tg;
      if (c && Math.hypot(p.x - c.x, p.y - c.y) < 15) { p.st = 1; p.t = 0; p.x = c.x + rnd(-8, 8); p.y = c.y + rnd(-6, 6); }
      else if (p.y > 345 || p.t > 4) kill(p); }
    else { place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 2.5).toFixed(2)); if (p.t > 2.5) kill(p); } });
  /* biologic dots hunt TNF dots, trap them on contact, then fade */
  if (sm.bio > 0.5 && Math.random() < dt * 8) { const p = free(bioD); if (p) emit(p, rnd(70, 880), rnd(228, 260), 0, 0, 0); }
  bioD.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.st === 0) { let best = null, bd = 150;
      tnfs.forEach((q) => { if (!q.on) return; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } });
      if (best) { const d = Math.max(1, bd); p.x += (best.x - p.x) / d * 95 * dt; p.y += (best.y - p.y) / d * 95 * dt;
        if (bd < 8) { kill(best); p.st = 1; p.t = 0; } }
      else { p.y += 12 * dt; p.x += Math.sin(tm / 500 + p.y) * 4 * dt; if (p.y > 345 || p.t > 4) kill(p); }
      place(p.e, p.x, p.y, 0, 1); }
    else { place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); } });
  /* microbes cross the broken barrier into the wall; the coating keeps more of them out */
  acc.bact += dt * sm.I * sm.U * 7 * (1 - 0.45 * sm.asa); while (acc.bact >= 1) { acc.bact--; const p = free(bacts); if (p) emit(p, rnd(70, 880), 214, rnd(-4, 4), rnd(18, 30), 0); }
  bacts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 7) + ")"); if (p.y > 310 || p.t > 3) kill(p); });
  /* aminosalicylate rains onto the surface and coats it */
  acc.asa += dt * sm.asa * 9; while (acc.asa >= 1) { acc.asa--; const p = free(asas); if (p) emit(p, rnd(60, 900), 202, 0, rnd(12, 20), 0); }
  asas.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.4) / 0.8).toFixed(2)); if (p.t > 2.2) kill(p); });
  /* one treatment pill follows the chosen drug, hidden without treatment */
  drugPill.style.opacity = clamp(sm.asa + sm.ster + sm.bio).toFixed(2);
  /* gauges */
  gg.inf.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["low", "moderate", "high"])); gg.ulc.set(sm.U, wordOf(sm.U, 0.35, 0.65, ["little", "some", "extensive"]));
  gg.wall.set(sm.D, wordOf(sm.D, 0.45, 0.75, ["mucosal", "deep", "transmural"])); gg.sym.set(sm.Sym, wordOf(sm.Sym, 0.32, 0.62, ["mild", "moderate", "severe"]));
  const capKey = drug * 10 + level; if (capKey !== capDrug) { capDrug = capKey; setDrugPill(drug); const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
