/* Intestinal protozoa scene: amoebic colitis, amoebic liver abscess and giardiasis on one stage.
 * Organs come from organs.lib.js; vessels and particles anchor to their ports. Drug dots hunt
 * their targets: tissue drug dots stick to wall parasites and shrink them, luminal dots clear
 * the bowel lumen, drainage shrinks the abscess. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const WW = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, hitT: 0, s: 1 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dotP = (parent, cls, r) => mk("circle", { class: "sc-p " + cls, r: r || 2.4 }, parent);
const types = [], marks = [], labels = [];
function addLabel(ty, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); labels.push({ g, ty }); return g; }
function addMark(ty, drugs, x, y, text, tx, tyy, tip, good) {
  const g = mk("g", {}, LY.over);
  if (good) { mk("path", { class: "mk-g", d: "M" + f1(x - 6) + " " + f1(y) + "l4 5l8 -10" }, g); } else { mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); }
  pill(g, text, x, y, tx, tyy, tip); marks.push({ g, ty, drugs }); return g;
}
/* hunters: drug dots that home onto parasites and sit on them while active */
function hunters(pool, targets, active, dt, speed) {
  pool.forEach((h, i) => {
    if (!active || !targets.length) { if (h.on) kill(h); return; }
    const T = targets[i % targets.length];
    if (!T) { if (h.on) kill(h); return; }
    if (!h.on) emit(h, T.x + rnd(-90, 90), T.y + rnd(-70, 70), 0, 0, 0);
    const dx = T.x - h.x, dy = T.y - h.y, d = Math.hypot(dx, dy) || 1, v = speed || 150;
    const step = Math.min(d, v * dt);
    h.x += dx / d * step; h.y += dy / d * step;
    place(h.e, h.x, h.y, 0, 1);
    if (d < 14) T.hitT = 1;
  });
}
/* parasites shrink and fade while a drug dot sits on them, and recover when it leaves */
function parasiteFace(P, Par, dt, base) {
  P.hitT = Math.max(0, (P.hitT || 0) - dt * 0.22);
  const want = (0.35 + 0.65 * Par) * (P.hitT > 0 ? 0.38 : 1);
  P.s = lerp(P.s === undefined ? 1 : P.s, want, Math.min(1, dt * 2));
  return P.s;
}
function parasiteAlpha(P, Par) { return ((0.2 + 0.8 * Par) * (P.hitT > 0 ? 0.4 : 1)).toFixed(2); }
function cystAt(parent, s) { const g = mk("g", {}, parent); mk("ellipse", { class: "am-cyst", rx: 10 * s, ry: 7 * s }, g); mk("circle", { class: "am-cystn", cx: -3 * s, cy: -1, r: 1.7 * s }, g); mk("circle", { class: "am-cystn", cx: 3 * s, cy: 1.5 * s, r: 1.7 * s }, g); return g; }
function beaker(parent, stoolCls) {
  mk("path", { class: "am-beaker", d: "M788 326h94l-10 74h-74z" }, parent);
  const st = mk("rect", { class: stoolCls, x: 796, y: 390, width: 78, height: 8, rx: 3 }, parent);
  return st;
}
function stoolLevel(rect, Gut) { const sh = 5 + Gut * 18; rect.setAttribute("y", f1(394 - sh)); rect.setAttribute("height", f1(sh)); }
function capText(ty, d) {
  if (ty === 0) {
    if (d === 1) return "Metronidazole kills parasites in the colon wall. Ulcers heal and bleeding slows.";
    if (d === 2) return "Luminal agent clears parasites left in the bowel. Fewer cysts pass on.";
    if (d === 3) return "Combined treatment kills wall parasites and clears the bowel. Best effect.";
    return "No treatment. Parasites invade the colon wall and ulcers bleed.";
  }
  if (ty === 1) {
    if (d === 1) return "Metronidazole kills parasites at the abscess rim. The abscess shrinks.";
    if (d === 2) return "Luminal agent only clears the bowel. The liver abscess stays.";
    if (d === 3) return "Combined treatment plus drainage if needed. The abscess shrinks most.";
    return "No treatment. Parasites reach the liver and an abscess grows.";
  }
  if (d === 1) return "Metronidazole kills Giardia on the surface. Villi recover.";
  if (d === 2) return "Luminal clearing removes leftover cysts. Stool firms up.";
  if (d === 3) return "Combined treatment clears Giardia and cysts. Best effect.";
  return "No treatment. Giardia coats the duodenum and fat passes unabsorbed.";
}

/* ================= AMOEBIC COLITIS ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  const colonO = organ(g, "colon", 300, 255, 230, {});
  const CP = colonO.ports, ux = CP.transverse[0], uy = CP.transverse[1];
  const ulcer = mk("ellipse", { class: "am-ulcer", cx: f1(ux), cy: f1(uy), rx: 30, ry: 42 }, g);
  const stoolRect = beaker(g, "am-stool");
  const cysts = Array.from({ length: 6 }, (_, i) => ({ e: cystAt(g, 1), x: 70 + i * 120, y: 172 + (i % 2) * 22, ph: i * 1.3, hitT: 0, s: 1 }));
  const homes = [218, 258, 300, 342, 382];
  const trophs = homes.map((hx, i) => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 13, nuc: 0.38, seed: 11 + i, wob: 0.22 }); return { e, hx, x: hx, y: 240, ph: i * 1.7, hitT: 0, s: 1 }; });
  const macs = [[490, 352], [590, 362], [680, 340]].map(([x, y], i) => { const e = mk("g", {}, g); cell(e, { cls: "mac", r: 16, nuc: 0.4, seed: 21 + i, wob: 0.13 }); place(e, x, y); return { e, x, y, ph: i * 2 }; });
  const blood = mkPool(18, () => dotP(g, "p-blood", 2.6));
  const stoolP = mkPool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, g));
  const metro = mkPool(10, () => dotP(g, "p-metro", 3.2));
  const lum = mkPool(8, () => dotP(g, "p-lum", 3));
  let accB = 0, accS = 0;
  const st = { ux, uy };
  types.push({ g, upd(dt, m) {
    const tissue = m.drug === 1 || m.drug === 3, luminal = m.drug === 2 || m.drug === 3;
    hunters(metro, trophs, tissue, dt, 160); hunters(lum, cysts, luminal, dt, 130);
    cysts.forEach((c) => { c.x += dt * 14 * (0.4 + m.Par); if (c.x > 790) c.x = 55; const s = parasiteFace(c, m.Par, dt);
      place(c.e, c.x, c.y + Math.sin(tm / 700 + c.ph) * 3, Math.sin(tm / 900 + c.ph) * 14, s); c.e.style.opacity = parasiteAlpha(c, m.Par); });
    trophs.forEach((tr, i) => { const dive = 0.5 + 0.5 * Math.sin(tm / 2400 + tr.ph);
      tr.x = tr.hx + Math.sin(tm / 1100 + tr.ph) * 14; tr.y = 232 + dive * (i === 2 ? 60 : 26); const s = parasiteFace(tr, m.Par, dt);
      place(tr.e, tr.x, tr.y, Math.sin(tm / 500 + tr.ph) * 18, s); tr.e.style.opacity = parasiteAlpha(tr, m.Par); });
    macs.forEach((mc) => place(mc.e, mc.x + Math.sin(tm / 1200 + mc.ph) * 4, mc.y + Math.cos(tm / 1400 + mc.ph) * 3, 0, 0.6 + 0.4 * m.Inj));
    ulcer.setAttribute("rx", f1(30 * (0.35 + 0.65 * m.Inj))); ulcer.setAttribute("ry", f1(42 * (0.35 + 0.65 * m.Inj)));
    ulcer.style.opacity = (0.25 + 0.75 * m.Inj).toFixed(2);
    accB += dt * m.Inj * 7; while (accB >= 1) { accB--; const p = freeP(blood); if (p) emit(p, st.ux + rnd(-16, 16), st.uy + rnd(0, 40), rnd(-8, 8), rnd(-16, -8), 0); }
    blood.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 232) kill(p); });
    accS += dt * m.Gut * 9; while (accS >= 1) { accS--; const p = freeP(stoolP); if (p) emit(p, rnd(70, 300), rnd(162, 206), rnd(50, 72), 0, 0); }
    stoolP.forEach((p) => { if (!p.on) return; if (p.x < 832) { p.x += p.vx * dt; p.y = clamp(p.y, 156, 214); } else { p.x = 833; p.y += 78 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.style.fill = "var(--c-bad)"; if (p.y > 386) kill(p); });
    stoolLevel(stoolRect, m.Gut);
    stoolRect.setAttribute("class", m.Gut > 0.45 ? "am-stool" : "am-stoolok");
  } });
  addLabel(0, "Cysts", 110, 185, 100, 78, "Mature cysts swallowed in food or water contaminated with feces. They survive the stomach and release trophozoites.");
  addLabel(0, "Colon", 300, 105, 300, 78, "Colon: trophozoites attach to the lining here, digest cells and invade. Invasion gives pain and frequent small bloody stools.");
  addLabel(0, "Ulcer", ux, uy, 500, 78, "Flask shaped ulcer: a narrow opening at the surface with a wide base below, made as trophozoites spread under the lining.");
  addLabel(0, "Bloody stool", 833, 350, 790, 78, "Bloody mucoid stool of amoebic dysentery: blood and mucus from the ulcerated colon, passed often in small amounts.");
  addMark(0, [1, 3], ux, uy + 62, "Tissue drug works", 250, 408, "Metronidazole, the tissue agent, kills trophozoites invading the colon wall.", true);
  addMark(0, [2, 3], 140, 190, "Bowel cleared", 560, 408, "A luminal agent clears parasites and cysts left in the bowel lumen, reducing relapse and spread.", true);
})();

/* ================= LIVER ABSCESS ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  const srcO = organ(g, "colon", 115, 335, 120, {});
  const liverO = organ(g, "liver", 620, 245, 380, {});
  const LP = liverO.ports, ax = LP.lobe[0], ay = LP.lobe[1];
  const vessel = mk("path", { class: "am-portal", d: "M175 330C300 330 400 360 563 386" }, g);
  vessel.setAttribute("d", "M175 330C300 330 400 360 " + f1(LP.porta[0]) + " " + f1(LP.porta[1]));
  const abscess = mk("circle", { class: "am-abscess", cx: f1(ax), cy: f1(ay), r: 68 }, g);
  const drain = mk("path", { class: "am-drain", d: "M" + f1(ax + 60) + " " + f1(ay) + "L880 " + f1(ay + 40) }, g);
  drain.style.display = "none";
  const gutCells = [[95, 320], [135, 360]].map(([x, y], i) => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 11, nuc: 0.38, seed: 31 + i, wob: 0.2 }); place(e, x, y); return { e, x, y, hitT: 0, s: 1 }; });
  const debris = Array.from({ length: 12 }, (_, i) => { const e = mk("circle", { class: "am-debris", r: 3 + (i % 3) }, g); return { e, a: i * 0.9, r: 14 + (i % 4) * 11, ph: i }; });
  const rim = Array.from({ length: 4 }, (_, i) => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 10, nuc: 0.38, seed: 41 + i, wob: 0.2 }); return { e, a: i * 1.57 + 0.4, x: 0, y: 0, hitT: 0, s: 1 }; });
  const portalTrack = track([[175, 330], [300, 332], [400, 352], [LP.porta[0], LP.porta[1]]]);
  const travellers = mkPool(6, () => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 8, nuc: 0.38, seed: 51, wob: 0.2 }); return e; });
  const drips = mkPool(8, () => dotP(g, "am-debris", 3));
  const metro = mkPool(10, () => dotP(g, "p-metro", 3.2));
  const lum = mkPool(6, () => dotP(g, "p-lum", 3));
  let accT = 0, accD = 0;
  const st = { ax, ay, r: 68, drainMix: 0 };
  types.push({ g, upd(dt, m) {
    const tissue = m.drug === 1 || m.drug === 3, luminal = m.drug === 2 || m.drug === 3;
    st.drainMix = lerp(st.drainMix, m.drug === 3 ? 1 : 0, Math.min(1, dt * 2));
    drain.style.display = st.drainMix > 0.4 ? "" : "none";
    hunters(metro, rim, tissue, dt, 160); hunters(lum, gutCells, luminal, dt, 130);
    gutCells.forEach((c, i) => { const s = parasiteFace(c, m.Par, dt);
      place(c.e, c.x + Math.sin(tm / 900 + i) * 3, c.y + Math.cos(tm / 1100 + i) * 3, 0, s); c.e.style.opacity = parasiteAlpha(c, m.Par); });
    const wantR = 68 * (0.4 + 0.6 * m.Par) * (1 - 0.42 * st.drainMix);
    st.r = lerp(st.r, wantR, Math.min(1, dt * 1.5));
    abscess.setAttribute("r", f1(st.r)); abscess.style.opacity = (0.45 + 0.55 * m.Par).toFixed(2);
    debris.forEach((d) => { const a = d.a + tm / 9000; d.e.setAttribute("cx", f1(st.ax + Math.cos(a) * d.r * st.r / 68)); d.e.setAttribute("cy", f1(st.ay + Math.sin(a) * d.r * 0.8 * st.r / 68)); d.e.style.opacity = (0.35 + 0.65 * m.Par).toFixed(2); });
    rim.forEach((r2) => { r2.x = st.ax + Math.cos(r2.a) * st.r; r2.y = st.ay + Math.sin(r2.a) * st.r; const s = parasiteFace(r2, m.Par, dt);
      place(r2.e, r2.x, r2.y, 0, s); r2.e.style.opacity = parasiteAlpha(r2, m.Par); });
    const srcClear = gutCells[0].hitT > 0 || gutCells[1].hitT > 0 ? 0.5 : 1;
    accT += dt * m.Par * 1.6 * (luminal ? 0.55 : 1) * srcClear; while (accT >= 1) { accT--; const p = freeP(travellers); if (p) emit(p, 0, 0, 0, 0, 0); }
    travellers.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; const q = portalTrack.at(clamp(p.u)); place(p.e, q.x, q.y, 0, 0.5 + 0.5 * m.Par); if (p.u >= 1) kill(p); });
    accD += dt * st.drainMix * 6; while (accD >= 1) { accD--; const p = freeP(drips); if (p) emit(p, st.ax + st.r * 0.8, st.ay + rnd(-8, 8), rnd(60, 90), rnd(8, 20), 0); }
    drips.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 905 || p.y > 430) kill(p); });
  } });
  const vmx = 370, vmy = 348;
  addLabel(1, "Colon", 115, 300, 110, 78, "The source is the colon: trophozoites that invaded the bowel wall can enter small portal veins even when bowel symptoms are mild.");
  addLabel(1, "Portal blood", vmx, vmy, 350, 78, "Portal blood carries trophozoites from the colon to the liver, where they lodge and destroy liver tissue.");
  addLabel(1, "Liver", 620, 108, 600, 78, "Liver: trophozoites lodge here and destroy tissue. Fever with tender liver pain is typical, with few bowel symptoms.");
  addLabel(1, "Abscess", ax, ay, 800, 78, "A usually single cavity, most often on the right. Its reddish brown necrotic centre holds few cells and trophozoites sit at the living rim.");
  addMark(1, [1, 3], ax + 68, ay, "Tissue drug works", 220, 408, "Metronidazole reaches the liver and kills trophozoites at the abscess rim. Most abscesses settle on drug treatment alone.", true);
  addMark(1, [2, 3], 115, 372, "Bowel cleared", 500, 408, "After tissue treatment, a luminal agent clears parasites left in the bowel so infection does not return or spread.", true);
  addMark(1, [3], ax, ay + 68, "Drain if needed", 740, 408, "Drainage is rarely needed: it is kept for selected large or complicated abscesses, alongside drug treatment.", true);
})();

/* ================= GIARDIASIS ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  const duoO = organ(g, "bowel", 430, 250, 320, {});
  const surfY = 300;
  const villusXs = [285, 312, 339, 366, 393, 420, 447, 474, 501, 528, 555];
  const villi = villusXs.map((x) => ({ e: mk("rect", { class: "am-villus", x: x - 17, y: surfY, width: 34, height: 88, rx: 15 }, g), x }));
  const attached = villi.slice(2, 9).map((v, i) => { const e = mk("g", {}, g); cell(e, { cls: "gia", r: 11, nuc: 0.35, seed: 61 + i, wob: 0.12 }); mk("ellipse", { class: "am-disc", cx: 0, cy: 10, rx: 8, ry: 3.4 }, e); return { e, v, x: v.x, y: surfY + 96, ph: i * 1.4, hitT: 0, s: 1 }; });
  const freeGia = Array.from({ length: 4 }, (_, i) => { const e = mk("g", {}, g); cell(e, { cls: "gia", r: 10, nuc: 0.35, seed: 71 + i, wob: 0.12 }); return { e, x: 120 + i * 160, y: 185, ph: i * 1.6, hitT: 0, s: 1 }; });
  const cysts2 = Array.from({ length: 5 }, (_, i) => ({ e: cystAt(g, 0.95), x: 80 + i * 140, y: 165 + (i % 2) * 18, ph: i, hitT: 0, s: 1 }));
  const stoolRect = beaker(g, "am-stoolg");
  const fat = mkPool(20, () => mk("circle", { class: "sc-p p-fatp", r: 3.4 }, g));
  const metro = mkPool(10, () => dotP(g, "p-metro", 3.2));
  const lum = mkPool(8, () => dotP(g, "p-lum", 3));
  let accF = 0;
  types.push({ g, upd(dt, m) {
    const tissue = m.drug === 1 || m.drug === 3, luminal = m.drug === 2 || m.drug === 3;
    hunters(metro, attached.concat(freeGia), tissue, dt, 160); hunters(lum, cysts2, luminal, dt, 130);
    villi.forEach((v) => { const target = clamp(46 + 42 * (1 - m.Inj * 1.6), 42, 92); const cur = parseFloat(v.e.getAttribute("height")); v.e.setAttribute("height", f1(lerp(cur, target, Math.min(1, dt * 1.2)))); });
    attached.forEach((a) => { const h = parseFloat(a.v.e.getAttribute("height")); a.x = a.v.x + Math.sin(tm / 800 + a.ph) * 2; a.y = surfY + h + 8; const s = parasiteFace(a, m.Par, dt);
      place(a.e, a.x, a.y, Math.sin(tm / 600 + a.ph) * 10, s); a.e.style.opacity = parasiteAlpha(a, m.Par); });
    freeGia.forEach((fg) => { fg.x += dt * 22 * (0.4 + m.Par); if (fg.x > 790) fg.x = 55; const s = parasiteFace(fg, m.Par, dt);
      place(fg.e, fg.x, 185 + Math.sin(tm / 500 + fg.ph) * 10, Math.sin(tm / 280 + fg.ph) * 34, s); fg.e.style.opacity = parasiteAlpha(fg, m.Par); });
    cysts2.forEach((c) => { c.x += dt * 12 * (0.4 + m.Par); if (c.x > 790) c.x = 55; const s = parasiteFace(c, m.Par, dt);
      place(c.e, c.x, c.y + Math.sin(tm / 700 + c.ph) * 2, 0, 0.9 * s); c.e.style.opacity = parasiteAlpha(c, m.Par); });
    accF += dt * m.Gut * 9; while (accF >= 1) { accF--; const p = freeP(fat); if (p) emit(p, rnd(70, 320), rnd(158, 200), rnd(48, 68), 0, 0); }
    fat.forEach((p) => { if (!p.on) return; if (p.x < 832) { p.x += p.vx * dt; p.y = clamp(p.y + Math.sin(tm / 400 + p.x) * 0.25, 154, 208); } else { p.x = 833; p.y += 76 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 386) kill(p); });
    stoolLevel(stoolRect, m.Gut);
    stoolRect.setAttribute("class", m.Gut > 0.45 ? "am-stoolg" : "am-stoolok");
  } });
  addLabel(2, "Cysts", 100, 180, 100, 78, "Giardia cysts swallowed in contaminated water or food. Each cyst releases trophozoites in the small bowel.");
  addLabel(2, "Duodenum", 430, 150, 290, 78, "Duodenum: the first part of the small bowel, where Giardia trophozoites attach and feed.");
  addLabel(2, "Giardia", 420, 330, 470, 78, "Giardia trophozoite: it swims with a falling leaf motion, then sticks to the lining with its sucking disc.");
  addLabel(2, "Villi", 550, 348, 640, 78, "Villi: small fingers that absorb food. Heavy coating blunts them, so fat is poorly absorbed.");
  addLabel(2, "Greasy stool", 833, 350, 830, 78, "Greasy bulky stool from fat malabsorption, rather than invasion or blood.");
  addMark(2, [1, 3], 430, 300, "Giardia killed", 300, 408, "Metronidazole kills Giardia trophozoites on the duodenal surface.", true);
  addMark(2, [2, 3], 140, 180, "Lumen cleared", 600, 408, "Clearing the lumen helps remove remaining parasites and cysts.", true);
})();

/* ---- caption, gauges and switching ---- */
let capEl = null, capTy = -1, capDrug = -1;
function initCaption() {
  capEl = mk("text", { class: "am-cap", x: 30, y: 428 }, LY.over);
  capEl.textContent = capText(0, 0);
}
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478, h = 70, xs = [150, 360, 570, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["par", "Parasites", "g-par", "How many active parasites are present: trophozoites in the bowel or liver in amoebiasis, and Giardia coating the duodenum in giardiasis."], ["inj", "Tissue injury", "g-inj", "Damage to tissue: deep invasion and ulceration in amoebic colitis and liver abscess, but only surface disturbance with little injury in giardiasis."], ["gut", "Gut upset", "g-gut", "Bowel upset: bloody dysentery in colitis, often little bowel upset in liver abscess, and greasy malabsorptive stool in giardiasis."], ["sev", "Severity", "g-sev", "Overall severity, combining parasite load, tissue injury and gut upset."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { Par: 0.8, Inj: 0.7, Gut: 0.8, Sev: 0.7 };
let curType = -1;
function init() { types.forEach((t) => { t.g.style.opacity = 0; }); initCaption(); initPanel(); }
function step(dt, m) {
  if (m.type !== curType) { curType = m.type; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.type)); }
  const k = Math.min(1, dt * 1.4);
  sm.Par = lerp(sm.Par, m.Par, k); sm.Inj = lerp(sm.Inj, m.Inj, k); sm.Gut = lerp(sm.Gut, m.Gut, k); sm.Sev = lerp(sm.Sev, m.Sev, k);
  const smM = { Par: sm.Par, Inj: sm.Inj, Gut: sm.Gut, Sev: sm.Sev, type: m.type, drug: m.drug };
  types.forEach((t, i) => { const want = i === m.type ? 1 : 0, cur = parseFloat(t.g.style.opacity || 0), nx = cur + (want - cur) * Math.min(1, dt * 5); t.g.style.opacity = nx.toFixed(3); t.g.style.display = nx < 0.01 && !want ? "none" : ""; });
  types[m.type].upd(dt, smM);
  labels.forEach((l) => { l.g.style.display = l.ty === m.type ? "" : "none"; });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.ty === m.type && mk2.drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  gg.par.set(sm.Par, wordOf(sm.Par, 0.3, 0.6, ["low", "moderate", "high"])); gg.inj.set(sm.Inj, wordOf(sm.Inj, 0.3, 0.6, ["little", "some", "marked"]));
  gg.gut.set(sm.Gut, wordOf(sm.Gut, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.sev.set(sm.Sev, wordOf(sm.Sev, 0.3, 0.6, ["mild", "moderate", "severe"]));
  if (m.drug !== capDrug || m.type !== capTy) { capDrug = m.drug; capTy = m.type; const t = capText(m.type, m.drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
