/* TB scene: inhaled bacilli meet a real lung, granuloma wall, soft core, cavity, spread, gauges. */
const GX = 520, GY = 292;
const NODE = { x0: 770, x1: 920, y0: 100, y1: 160 }, VES = { x0: 704, x1: 924, y0: 372, y1: 402 };
const LUNG = { x0: 88, x1: 282, y0: 114, y1: 388 };
const L = { gran: $("gran"), bac: $("bac"), parts: $("parts"), over: $("over"), panel: $("panel"), caseum: $("caseum"), scar: $("scar"), cavity: $("cavity"), heal: $("heal"), link: $("link") };
const sm = { B: 0.4, G: 0.6, Cas: 0.4, Cav: 0, Sp: 0, ie: 0.6, abx: 0, sup: 0, prev: 0, heal: 0 };
/* ---- the real lung, and the alveolar macrophage inside it ---- */
let lungO = null;
const am = { g: null, x: 147, y: 332 };
const SPAWN = { x: 185, y: 128 };
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 185, 250, 250, {});
  LUNG.x0 = lungO.x - lungO.w / 2 + 28; LUNG.x1 = lungO.x + lungO.w / 2 - 28;
  LUNG.y0 = lungO.y - lungO.h / 2 + 30; LUNG.y1 = lungO.y + lungO.h / 2 - 28;
  SPAWN.x = lungO.x; SPAWN.y = lungO.y - lungO.h / 2 + 44;
  am.x = lungO.x - 38; am.y = lungO.y + 82;
  $("airway").setAttribute("d", "M" + f1(lungO.x + lungO.w / 2 - 14) + " " + f1(lungO.y + 12)
    + "C" + f1(lungO.x + lungO.w / 2 + 70) + " " + f1(lungO.y + 4) + " " + f1(GX - 110) + " " + f1(GY - 26) + " " + f1(GX - 138) + " " + f1(GY - 12));
  am.g = mk("g", {}, L.gran); cell(am.g, { cls: "mac", r: 22, nuc: 0.4, seed: 4, wob: 0.12 }); place(am.g, am.x, am.y, 0, 1);
}
/* ---- granuloma: epithelioid ring, giant cell, lymphocyte rim ---- */
const ring = [], inner = [], lymph = [];
let giant = null;
function initGran() {
  for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.2832, g = mk("g", {}, L.gran); cell(g, { cls: "epith", r: 15, nuc: 0.38, seed: i + 9, wob: 0.1 }); ring.push({ g, a, i, rr: 96 + (i % 2) * 6, s: 0, px: 0, py: 0 }); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.2832 + 0.3, g = mk("g", {}, L.gran); cell(g, { cls: "epith", r: 14, nuc: 0.38, seed: i + 30, wob: 0.1 }); inner.push({ g, a, i: i + 100, rr: 62, s: 0, px: 0, py: 0 }); }
  for (let i = 0; i < 26; i++) { const g = mk("g", {}, L.gran); cell(g, { cls: "th1", r: 7, nuc: 0.55, seed: i + 50, wob: 0.06, n: 7 }); lymph.push({ g, a: rnd(0, 6.28), rr: rnd(128, 146), s: 0, ph: rnd(0, 6) }); }
  const gg = mk("g", {}, L.gran); cell(gg, { cls: "giant", r: 26, seed: 77, wob: 0.1 });
  for (let j = 0; j < 7; j++) { const t = (j / 7) * 6.28; mk("ellipse", { class: "cl-n", rx: 4.2, ry: 3, cx: Math.cos(t) * 14, cy: Math.sin(t) * 14, transform: "rotate(" + f1(t * 57.3) + " " + f1(Math.cos(t) * 14) + " " + f1(Math.sin(t) * 14) + ")" }, gg); }
  giant = { g: gg, a: -0.7, rr: 100, s: 0 };
}
/* ---- bacilli ---- */
const N_BAC = 46, bac = [];
function initBac() { for (let i = 0; i < N_BAC; i++) { const g = mk("g", {}, L.bac); mk("ellipse", { class: "bac-rod", rx: 5.2, ry: 2 }, g); bac.push({ g, x: rnd(LUNG.x0, LUNG.x1), y: rnd(LUNG.y0, LUNG.y1), tx: 0, ty: 0, z: 0, nz: -1, s: 0, rot: rnd(0, 180), t: rnd(0, 3) }); } }
function targetFor(b, z) {
  if (z === 0) return [rnd(LUNG.x0, LUNG.x1), rnd(LUNG.y0, LUNG.y1)];
  if (z === 1) { const rc = 14 + 36 * sm.Cas, a = rnd(0, 6.28), r = rnd(0, rc * 0.85); return [GX + Math.cos(a) * r * 1.1, GY + Math.sin(a) * r * 0.95]; }
  if (z === 2) return [rnd(NODE.x0, NODE.x1), rnd(NODE.y0, NODE.y1)];
  if (z === 3) return [VES.x0 + 8, rnd(VES.y0, VES.y1)];
  const vis = ring.filter((c) => c.s > 0.3); const c = vis.length ? pick(vis) : { a: 0, rr: 96 }; const cx = GX + Math.cos(c.a) * c.rr * 1.05, cy = GY + Math.sin(c.a) * c.rr * 0.92;
  return [cx + rnd(-4, 4), cy + rnd(-4, 4)];
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, from: null, to: null }; }); }
const ifn = pool(26, () => mk("circle", { class: "sc-p p-ifn", r: 2.6 }, L.parts));
const tnf = pool(26, () => mk("rect", { class: "sc-p p-tnf", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, L.parts));
const pills = pool(14, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- TNF blocker dots that fly in and sit on macrophage receptors ---- */
const REC_A = [-0.55, 0.65, 2.7], REC_R = 64;
const recs = [], blks = [];
function recPos(j) { return [GX + Math.cos(REC_A[j]) * REC_R * 1.1, GY + Math.sin(REC_A[j]) * REC_R * 0.95]; }
function parkPos(j) { return [800 + j * 24, 108]; }
function initBlk() {
  for (let j = 0; j < 3; j++) {
    const q = recPos(j); mk("circle", { class: "tb-rec", cx: f1(q[0]), cy: f1(q[1]), r: 7 }, L.parts).setAttribute("opacity", "0.45");
    recs.push(q);
    const s = parkPos(j), e = mk("circle", { class: "tb-blk", cx: f1(s[0]), cy: f1(s[1]), r: 5 }, L.parts);
    e.setAttribute("opacity", "0"); blks.push({ e, x: s[0], y: s[1] });
  }
}
/* ---- caption, labels, gauges ---- */
const gg = {};
let capEl = null, capKey = "";
function capText(l, d) {
  if (d === 3) return l === 2 ? "Treatment kills germs. The hole closes and spread stops." : l === 1 ? "Treatment kills germs. The wall heals and spread stops." : "Treatment kills germs. The lump stays sealed.";
  if (d === 2) return l === 2 ? "Preventive treatment slows germs but cannot cure." : "Preventive treatment kills quiet germs. The seal holds.";
  if (d === 1) return l === 0 ? "Blocked immunity. The wall breaks and germs spread." : "Blocked immunity. Defence collapses and germs spread.";
  return l === 0 ? "No treatment. Strong immunity walls the germs in." : l === 1 ? "No treatment. Control is slipping and germs grow." : "No treatment. The core breaks open and germs spread.";
}
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [150, 360, 570, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W_ - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lung";
  [["bac", "Bacterial load", "g-bac", "How many tubercle bacilli are alive in the lung."], ["gran", "Granuloma", "g-good", "How well the granuloma walls the bacilli off. It breaks down when immunity fails."], ["cas", "Caseation", "g-bad", "Cheese-like dead tissue in the granuloma core. Large areas can soften and form a cavity."], ["spread", "Spread", "g-clot", "Spread beyond the first focus: first the lymph node, then the blood."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Lung", LUNG.x0 + 30, LUNG.y0 + 30, 80, 70, "The lung, where breathed in air arrives.");
  pill(o, "Inhaled bacilli", SPAWN.x, SPAWN.y + 12, 255, 70, "Tubercle bacilli breathed in from a person with active lung disease.");
  pill(o, "Granuloma", GX, GY - 104, GX, 66, "A ball of immune cells walling the germs in. Epithelioid cells, giant cells and a rim of T cells.");
  pill(o, "Macrophage", am.x, am.y - 24, 150, 404, "The first cell to meet the bacillus. It swallows it, yet the bacillus survives inside.");
  pill(o, "T cell signals", GX + 70, GY - 30, 720, 250, "Messengers from T cells that switch macrophages on. Blocking TNF breaks the wall.");
  pill(o, "Soft core", GX, GY + 10, GX, 420, "The core dies and looks like soft white cheese. Germs rest in it, and it can break open into a cavity.");
  pill(o, "Lymph node", NODE.x0 + 30, NODE.y1 - 10, 850, 215, "Germs drain to the nearby node. With the first lung focus this is the primary complex.");
  pill(o, "Blood spread", 810, 387, 845, 330, "Germs in the blood seed many organs with tiny spots like millet seeds.");
  capEl = mk("text", { class: "tb-cap", x: 30, y: 432 }, o); capEl.textContent = capText(1, 0);
}
const W_ = SC.W;
function init() { initOrgans(); initGran(); initBac(); initBlk(); initPanel(); }
const acc = { ifn: 0, tnf: 0, pill: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.8), k2 = Math.min(1, dt * 0.45);
  sm.B = lerp(sm.B, m.B, k2); sm.G = lerp(sm.G, m.G, k2); sm.Cas = lerp(sm.Cas, m.Cas, k2); sm.Cav = lerp(sm.Cav, m.Cav, k2); sm.Sp = lerp(sm.Sp, m.Sp, k2); sm.ie = lerp(sm.ie, m.ie, k1); sm.abx = lerp(sm.abx, m.abx, k1); sm.sup = lerp(sm.sup, m.sup, k1); sm.prev = lerp(sm.prev, m.prev, k1);
  sm.heal = lerp(sm.heal, clamp(m.abx + 0.35 * m.prev), k2);
  /* core, scar, cavity and healing ring */
  const rc = 14 + 36 * sm.Cas;
  L.caseum.setAttribute("rx", f1(rc * 1.1)); L.caseum.setAttribute("ry", f1(rc * 0.95)); L.caseum.setAttribute("opacity", (0.35 + 0.65 * sm.Cas).toFixed(2));
  L.scar.setAttribute("rx", f1(rc * 0.85)); L.scar.setAttribute("ry", f1(rc * 0.72)); L.scar.setAttribute("opacity", (sm.heal * 0.85).toFixed(2));
  L.heal.setAttribute("opacity", (sm.heal * 0.55).toFixed(2));
  const cv = clamp(sm.Cav * 1.2); L.cavity.setAttribute("rx", f1(Math.max(1, rc * 0.7 * cv))); L.cavity.setAttribute("ry", f1(Math.max(1, rc * 0.6 * cv))); L.cavity.setAttribute("cx", f1(GX + 6 * cv)); L.cavity.setAttribute("cy", f1(GY - 6 * cv));
  L.link.setAttribute("opacity", cv > 0.15 ? clamp((cv - 0.15) * 1.6).toFixed(2) : "0"); L.link.setAttribute("stroke-width", f1(4 + 9 * cv));
  /* alveolar macrophage jiggle */
  place(am.g, am.x + Math.sin(tm / 1300) * 3, am.y + Math.cos(tm / 1700) * 2, Math.sin(tm / 2200) * 5, 1);
  /* ring and rim: cells appear with granuloma integrity and immunity */
  const nr = Math.round(sm.G * ring.length), ni = Math.round(clamp(sm.G * 1.1 - 0.1) * inner.length), nl = Math.round(clamp(sm.ie * 1.15) * lymph.length);
  const put = (c, i, n, sy, tot) => { const on = ((i * 7) % tot) < n; c.s = lerp(c.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.2 : 2))); const a = c.a + Math.sin(tm / 2500 + i) * 0.03;
    c.px = GX + Math.cos(a) * c.rr * 1.08; c.py = GY + Math.sin(a) * c.rr * 0.93;
    place(c.g, c.px, c.py, a * 57.3 + 90 + Math.sin(tm / 900 + i) * 4, c.s); c.g.setAttribute("transform", c.g.getAttribute("transform") + " scale(1.25 " + sy + ")"); c.g.style.opacity = c.s > 0.05 ? 1 : 0; };
  ring.forEach((c, i) => put(c, c.i, nr, 0.72, 18)); inner.forEach((c) => put(c, c.i, ni, 0.74, 10));
  lymph.forEach((c, i) => { const on = i < nl; c.s = lerp(c.s, on ? 1 : 0, Math.min(1, dt * 1.4)); const a = c.a + tm / 20000 * (i % 2 ? 1 : -1); place(c.g, GX + Math.cos(a) * c.rr * 1.12, GY + Math.sin(a) * c.rr * 0.96 + Math.sin(tm / 700 + c.ph) * 1.5, 0, c.s); c.g.style.opacity = c.s > 0.05 ? 1 : 0; });
  giant.s = lerp(giant.s, sm.G > 0.45 ? 1 : 0, Math.min(1, dt * 1)); place(giant.g, GX + Math.cos(giant.a) * giant.rr * 1.08, GY + Math.sin(giant.a) * giant.rr * 0.93, 0, giant.s); giant.g.style.opacity = giant.s > 0.05 ? 1 : 0;
  /* bacilli: zones split by the model; drugs shrink the germs as they die */
  const shrink = 1 - 0.35 * sm.abx - 0.2 * sm.prev;
  const n = Math.round(sm.B * N_BAC);
  let fAir = clamp(0.12 + 0.45 * sm.Cav), fCore = clamp(sm.Cas * 0.4), fNode = clamp(sm.Sp * 0.3), fVes = sm.Sp > 0.45 ? clamp((sm.Sp - 0.45) * 0.7) : 0;
  const tot = fAir + fCore + fNode + fVes; if (tot > 0.88) { const kk = 0.88 / tot; fAir *= kk; fCore *= kk; fNode *= kk; fVes *= kk; }
  const cAir = Math.round(n * fAir), cCore = Math.round(n * fCore), cNode = Math.round(n * fNode), cVes = Math.round(n * fVes);
  const b1 = cAir, b2 = b1 + cCore, b3 = b2 + cNode, b4 = b3 + cVes;
  bac.forEach((b, i) => {
    const z = i < b1 ? 0 : i < b2 ? 1 : i < b3 ? 2 : i < b4 ? 3 : 4, on = i < n;
    if (z !== b.nz) { const first = b.nz === -1; b.nz = z; [b.tx, b.ty] = targetFor(b, z); if (first) { b.x = b.tx; b.y = b.ty; } }
    b.t -= dt; if (b.t < 0) { b.t = rnd(2, 4); if (z !== 3) [b.tx, b.ty] = targetFor(b, z); }
    if (z === 3) { b.tx = Math.min(VES.x1 - 6, b.x + 40); b.ty = clamp(b.y + rnd(-1, 1) * 4, VES.y0, VES.y1); if (b.x > VES.x1 - 10) { b.x = VES.x0 + 6; } }
    const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy) || 1, sp = z === 3 ? 60 : d > 100 ? 90 : 22, st = Math.min(d, sp * dt * (z === 4 ? 0.8 : 1.4)); b.x += (dx / d) * st; b.y += (dy / d) * st;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.2 + sm.abx * 3)));
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 500 + i) * 20, Math.max(0.001, b.s * shrink)); b.g.style.opacity = b.s > 0.05 ? 1 : 0; });
  /* T cells signal the macrophages; blocked TNF receptors starve the downstream signal */
  const sig = clamp(sm.ie * 1.1), blocked = sm.sup > 0.5;
  acc.ifn += dt * sig * 9; while (acc.ifn >= 1) { acc.ifn--; const p = free(ifn), a = pick(lymph.filter((c) => c.s > 0.5)), b = pick(ring.filter((c) => c.s > 0.5)); if (p && a && b) { emit(p, GX + Math.cos(a.a) * a.rr * 1.12, GY + Math.sin(a.a) * a.rr * 0.96, 0, 0); p.from = a; p.to = b; } }
  acc.tnf += dt * sig * 6; while (acc.tnf >= 1) { acc.tnf--; const p = free(tnf), a = pick(lymph.filter((c) => c.s > 0.5)), b = pick(inner.filter((c) => c.s > 0.5)); if (p && a && b) { emit(p, GX + Math.cos(a.a) * a.rr * 1.12, GY + Math.sin(a.a) * a.rr * 0.96, 0, 0); p.from = a; p.to = b; } }
  [ifn, tnf].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; const tx = GX + Math.cos(p.to.a) * p.to.rr * 1.08, ty = GY + Math.sin(p.to.a) * p.to.rr * 0.93, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (blocked && d < 70) p.e.setAttribute("opacity", clamp(d / 70).toFixed(2)); if (d < 12) kill(p); }));
  /* blocker dots dock onto their receptors when suppression is on */
  blks.forEach((blk, j) => {
    const goal = blocked ? recs[j] : parkPos(j);
    blk.x = lerp(blk.x, goal[0], Math.min(1, dt * 1.6)); blk.y = lerp(blk.y, goal[1], Math.min(1, dt * 1.6));
    blk.e.setAttribute("cx", f1(blk.x)); blk.e.setAttribute("cy", f1(blk.y)); blk.e.setAttribute("opacity", sm.sup.toFixed(2));
  });
  /* drug capsules enter from the blood vessel and head for the core */
  acc.pill += dt * (sm.abx * 3 + sm.prev * 1.6); while (acc.pill >= 1) { acc.pill--; const p = free(pills); if (p) emit(p, VES.x0 + 20, VES.y0 + 6, 0, 0); }
  pills.forEach((p) => { if (!p.on) return; p.t += dt; const tx = GX + 40, ty = GY + 10; p.x += (tx - p.x) * dt * 0.45 - 8 * dt; p.y += (ty - p.y) * dt * 0.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 5) / 1.5).toFixed(2)); if (p.t > 6.5) kill(p); });
  /* gauges and the plain language caption */
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.5, ["few", "held", "high"])); gg.gran.set(sm.G, wordOf(sm.G, 0.35, 0.7, ["breaking down", "forming", "intact"])); gg.cas.set(sm.Cas, wordOf(sm.Cas, 0.3, 0.6, ["small", "moderate", "extensive"])); gg.spread.set(sm.Sp, wordOf(sm.Sp, 0.2, 0.5, ["none", "local", "miliary"]));
  const key = level + ":" + drug; if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
