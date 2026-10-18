/* Psoriasis scene: dendritic and Th17 axis, keratinocyte hyperproliferation, plaque scale, vessels and joint. */
const EPITOP = SC.EPITOP, WW = SC.W;
const layers = { vessels: $("vessels"), epi: $("epi"), gran: $("gran"), kcs: $("kcs"), scales: $("scales"), joint: $("joint"), immune: $("immune"), fx: $("fx"), parts: $("parts"), over: $("over"), panel: $("panel") };
const DC = { x: 175, y: 308 }, TH = { x: 350, y: 308 };
const sm = { D: 0.4, T17: 0.4, Cyt: 0.3, K: 0.3, Thick: 0.3, Scale: 0.3, Vessel: 0.3, Joint: 0.1, top: 0, pho: 0, bio: 0 };
const acc = { il23: 0, il17: 0, ab: 0, shed: 0 };
let dcCell, thCell, epiBot = 160, gg = {}, creamEl, raysEl, jointGlow, vessels = [], kcs = [], flakes = [], paras = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const il23 = pool(16, () => mk("circle", { class: "sc-p p-il23", r: 2.6 }, layers.parts));
const il17 = pool(22, () => mk("circle", { class: "sc-p p-il17", r: 2.5 }, layers.parts));
const tnf = pool(14, () => mk("rect", { class: "sc-p p-tnf", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, layers.parts));
const abs = pool(10, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "ps-ab", d: "M0 4L0 -1M0 -1L-3 -4M0 -1L3 -4" }, g); return g; });
const shed = pool(12, () => mk("ellipse", { class: "ps-scale", rx: 5, ry: 2 }, layers.parts));
function epiPath(bot) {
  let d = "M14 " + EPITOP + "L946 " + EPITOP + "L946 " + f1(bot);
  for (let x = 946; x >= 14; x -= 24) d += "L" + x + " " + f1(bot + 7 * Math.sin(x / 38));
  return d + "Z";
}
function init() {
  /* vessels: dermal papilla loops */
  [228, 296, 401, 560, 685].forEach((x) => {
    const bg = mk("path", { class: "ps-vesselbg" }, layers.vessels);
    const fg = mk("path", { class: "ps-vessel" }, layers.vessels);
    vessels.push({ x, bg, fg });
  });
  /* keratinocytes tiling the epidermis */
  for (let i = 0; i < 28; i++) {
    const g = cell(layers.kcs, { cls: "kc", r: 8, nuc: 0.32, seed: i + 2, wob: 0.1, n: 8 });
    kcs.push({ g, col: i % 14, row: Math.floor(i / 14), ph: i * 0.7 });
  }
  /* scale flakes and retained nuclei (parakeratosis) */
  for (let i = 0; i < 16; i++) {
    const e = mk("ellipse", { class: "ps-scale", cx: 58 + i * 56, cy: 104 - (i % 3) * 5, rx: 20, ry: 5 }, layers.scales);
    flakes.push({ e, x: 58 + i * 56, y: 104 - (i % 3) * 5, ph: i });
    if (i % 2 === 0) paras.push(mk("circle", { class: "ps-para", cx: 52 + i * 56, cy: 103 - (i % 3) * 5, r: 1.8 }, layers.scales));
  }
  /* immune cells */
  const dg = mk("g", {}, layers.immune);
  for (let j = 0; j < 7; j++) { const t = j / 7 * 6.28; mk("path", { class: "ps-ab", style: "stroke:var(--c-mac)", d: "M" + f1(Math.cos(t) * 24) + " " + f1(Math.sin(t) * 24) + "L" + f1(Math.cos(t) * 31) + " " + f1(Math.sin(t) * 31) }, dg); }
  dcCell = cell(dg, { cls: "dc", r: 23, nuc: 0.42, seed: 3, wob: 0.14 });
  place(dcCell, DC.x, DC.y, 0, 1); dg.setAttribute("transform", "translate(" + DC.x + " " + DC.y + ")");
  dcCell.setAttribute("transform", "translate(0 0)");
  const tg = mk("g", {}, layers.immune); thCell = cell(tg, { cls: "th17", r: 19, nuc: 0.48, seed: 7, wob: 0.1 });
  tg.setAttribute("transform", "translate(" + TH.x + " " + TH.y + ")"); thCell.setAttribute("transform", "translate(0 0)");
  /* joint inset */
  const J = layers.joint;
  mk("rect", { class: "ps-jointbox", x: 748, y: 258, width: 180, height: 132, rx: 12 }, J);
  jointGlow = mk("circle", { class: "ps-jointglow", cx: 838, cy: 324, r: 30, opacity: "0" }, J);
  mk("rect", { class: "ps-bone", x: 782, y: 306, width: 44, height: 36, rx: 10 }, J);
  mk("rect", { class: "ps-bone", x: 850, y: 306, width: 44, height: 36, rx: 10 }, J);
  mk("circle", { class: "ps-bone", cx: 838, cy: 324, r: 7 }, J);
  /* surface effects: scratch, denuded patch, cream, light rays */
  const F = layers.fx;
  mk("path", { class: "ps-scratch", d: "M52 116L188 108M66 122L176 114" }, F);
  mk("rect", { class: "ps-denuded", x: 492, y: 108, width: 72, height: 12, rx: 5 }, F);
  [[504, 114], [520, 112], [536, 115], [550, 113]].forEach(([x, y]) => mk("circle", { class: "ps-dot", cx: x, cy: y, r: 2.2 }, F));
  creamEl = mk("rect", { class: "ps-cream", x: 40, y: 98, width: 880, height: 9, rx: 4.5, opacity: "0" }, F);
  raysEl = mk("g", { opacity: "0" }, F);
  [180, 340, 500, 660, 820].forEach((x) => mk("path", { class: "ps-ray", d: "M" + x + " 52L" + (x - 12) + " 106" }, raysEl));
  /* labels */
  const o = layers.over;
  pill(o, "Koebner", 110, 112, 110, 82, "Koebner phenomenon: new psoriasis plaques appear along lines of injury or scratching in susceptible skin.");
  pill(o, "Auspitz sign", 528, 112, 500, 82, "Auspitz sign: lifting off scale exposes tiny bleeding points from dilated vessels in the dermal papillae just below.");
  pill(o, "Scale", 620, 102, 620, 82, "Silvery scale: keratinocytes reach the surface too fast and pile up. Retained nuclei in this layer are called parakeratosis.");
  pill(o, "Epidermis", 740, 138, 740, 82, "Thickened epidermis: keratinocytes divide too fast, rete ridges lengthen, and the granular layer thins or is lost.");
  pill(o, "Dendritic cell", DC.x, DC.y - 24, 170, 236, "Dendritic cell: an activated antigen presenting cell in skin. It releases IL-23, which sustains the Th17 pathway.");
  pill(o, "IL-23", 262, 300, 258, 236, "IL-23 from dendritic cells maintains and expands Th17 cells. Blocking IL-23 is one biologic strategy.");
  pill(o, "Th17 cell", TH.x, TH.y - 19, 348, 236, "Th17 cell: a helper T cell sustained by IL-23. It releases IL-17 and TNF that act on keratinocytes.");
  pill(o, "IL-17 and TNF", 428, 238, 468, 236, "IL-17 and TNF drive keratinocyte hyperproliferation and inflammation. Blocking TNF or IL-17 is a biologic strategy.");
  pill(o, "Joint", 838, 318, 840, 236, "Joint involvement: the same inflammation can cause psoriatic arthritis, with pain, stiffness and swelling. Skin only treatments may not help joints.");
  pill(o, "Blood vessel", 620, 330, 620, 374, "Dilated, twisted vessels in the dermal papillae. They make the plaque red and bleed as pinpoint spots when scale is removed.");
  const pt = pill(o, "Topical", 290, 110, 290, 82, "Topical steroid with a vitamin D agent, applied to the plaque: calms inflammation and slows keratinocyte growth."); pt.setAttribute("id", "p-top"); pt.style.opacity = 0;
  const pp = pill(o, "Phototherapy", 290, 110, 290, 82, "Phototherapy: controlled ultraviolet light to the skin dampens local immune activity and slows keratinocyte growth."); pp.setAttribute("id", "p-pho"); pp.style.opacity = 0;
  const pb = pill(o, "Biologic", 290, 110, 290, 82, "A biologic targeting TNF, IL-17 or IL-23 interrupts the cytokine axis through the body, so skin and joints can both improve."); pb.setAttribute("id", "p-bio"); pb.style.opacity = 0;
  /* gauges */
  const P = layers.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["imm", "Immune", "g-imm", "Dendritic cell and Th17 drive: how strongly the IL-23 and Th17 axis is switched on."], ["cyt", "Cytokines", "g-cyt", "IL-17 and TNF signal reaching keratinocytes."], ["epi", "Epidermis", "g-epi", "Epidermal thickness from keratinocyte hyperproliferation, with loss of the granular layer."], ["scl", "Scale", "g-scale", "Piled up surface scale with retained nuclei (parakeratosis). Heavier scale sheds more."], ["red", "Redness", "g-bad", "Redness from dilated dermal vessels and inflammation under the plaque."], ["jnt", "Joints", "g-bad", "Joint inflammation (psoriatic arthritis). It does not always follow skin severity."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, 486, 60, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.D = lerp(sm.D, m.D, k2); sm.T17 = lerp(sm.T17, m.T17, k2); sm.Cyt = lerp(sm.Cyt, m.Cyt, k2);
  sm.K = lerp(sm.K, m.K, k2); sm.Thick = lerp(sm.Thick, m.Thick, k1); sm.Scale = lerp(sm.Scale, m.Scale, k2);
  sm.Vessel = lerp(sm.Vessel, m.Vessel, k1); sm.Joint = lerp(sm.Joint, m.Joint, k2);
  sm.top = lerp(sm.top, m.top, k1); sm.pho = lerp(sm.pho, m.pho, k1); sm.bio = lerp(sm.bio, m.bio, k1);
  epiBot = EPITOP + 20 + 52 * sm.Thick;
  layers.epi.setAttribute("d", epiPath(epiBot));
  let gd = "M14 " + f1(epiBot - 10);
  for (let x = 14; x <= 946; x += 24) gd += "L" + x + " " + f1(epiBot - 10 + 5 * Math.sin(x / 38));
  layers.gran.setAttribute("d", gd); layers.gran.setAttribute("opacity", (0.85 * (1 - sm.Thick)).toFixed(2));
  kcs.forEach((c) => {
    const y = EPITOP + 12 + c.row * Math.max(10, (epiBot - EPITOP - 18) * 0.55) + Math.sin(tm / 500 + c.ph) * 1.2;
    place(c.g, 52 + c.col * 66, y, Math.sin(tm / 700 + c.ph) * 8, 0.75 + 0.45 * sm.K);
  });
  flakes.forEach((f) => { const s = 0.25 + 0.95 * sm.Scale; f.e.setAttribute("transform", "translate(" + f1(f.x) + " " + f1(f.y) + ") scale(" + s.toFixed(2) + ") translate(" + f1(-f.x) + " " + f1(-f.y) + ")"); f.e.style.opacity = clamp(0.15 + sm.Scale).toFixed(2); });
  paras.forEach((p) => p.style.opacity = clamp(sm.Scale * 1.2).toFixed(2));
  vessels.forEach((v) => {
    const d = "M" + v.x + " 392C" + (v.x - 8) + " 340 " + (v.x + 8) + " 300 " + v.x + " " + f1(epiBot + 16);
    v.bg.setAttribute("d", d); v.bg.setAttribute("stroke-width", (5 + 6 * sm.Vessel).toFixed(1));
    v.fg.setAttribute("d", d); v.fg.setAttribute("stroke-width", (2 + 6 * sm.Vessel).toFixed(1));
  });
  place(dcCell, 0, Math.sin(tm / 1600) * 2, Math.sin(tm / 2400) * 5, 1 + 0.08 * sm.D * Math.sin(tm / 300));
  place(thCell, 0, Math.cos(tm / 1700) * 2, Math.sin(tm / 2500) * 5, 1 + 0.08 * sm.T17 * Math.sin(tm / 320));
  /* IL-23: dendritic cell to Th17 cell */
  acc.il23 += dt * sm.D * 7; while (acc.il23 >= 1) { acc.il23--; const p = free(il23); if (p) emit(p, DC.x + 24, DC.y - 6, 42, rnd(-6, 6), 0); }
  il23.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 300 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 430)) + ")"); if (p.x > TH.x - 20 || p.t > 3.4) kill(p); });
  /* IL-17 and TNF: Th17 cell up to the epidermis */
  acc.il17 += dt * sm.Cyt * 13; while (acc.il17 >= 1) { acc.il17--; const useTnf = Math.random() < 0.35, p = free(useTnf ? tnf : il17); if (p) emit(p, TH.x + rnd(-12, 16), TH.y - 18, rnd(8, 26), -rnd(30, 46), 0); }
  [il17, tnf].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 430)) + ")"); if (p.y < epiBot + 8 || p.t > 4) kill(p); }));
  /* biologic antibodies drifting in the dermis */
  acc.ab += dt * sm.bio * 5; while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) emit(p, rnd(60, 160), rnd(250, 360), rnd(22, 34), rnd(-6, 6), 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 430)) + ") rotate(" + f1(p.t * 40) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 5).toFixed(2)); if (p.t > 5) kill(p); });
  /* shed scale drifting down inside the stage */
  acc.shed += dt * sm.Scale * 3; while (acc.shed >= 1) { acc.shed--; const p = free(shed); if (p) emit(p, rnd(70, 900), 100, rnd(-6, 6), rnd(10, 18), 0); }
  shed.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 430)) + ") rotate(" + f1(p.t * 50) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
  creamEl.setAttribute("opacity", (sm.top * 0.9).toFixed(2));
  raysEl.setAttribute("opacity", (sm.pho * (0.55 + 0.3 * Math.sin(tm / 400))).toFixed(2));
  jointGlow.setAttribute("opacity", (sm.Joint * 0.55).toFixed(2)); jointGlow.setAttribute("r", f1(22 + 16 * sm.Joint));
  $("p-top").style.opacity = sm.top.toFixed(2); $("p-pho").style.opacity = sm.pho.toFixed(2); $("p-bio").style.opacity = sm.bio.toFixed(2);
  gg.imm.set(clamp((sm.D + sm.T17) / 2), wordOf((sm.D + sm.T17) / 2, 0.25, 0.6, ["quiet", "active", "strong"]));
  gg.cyt.set(sm.Cyt, wordOf(sm.Cyt, 0.25, 0.6, ["low", "raised", "high"]));
  gg.epi.set(sm.Thick, wordOf(sm.Thick, 0.25, 0.6, ["normal", "thick", "very thick"]));
  gg.scl.set(sm.Scale, wordOf(sm.Scale, 0.25, 0.6, ["none", "some", "heavy"]));
  gg.red.set(sm.Vessel, wordOf(sm.Vessel, 0.25, 0.6, ["pale", "red", "very red"]));
  gg.jnt.set(sm.Joint, wordOf(sm.Joint, 0.2, 0.5, ["quiet", "aching", "inflamed"]));
}
run({ init, step });
