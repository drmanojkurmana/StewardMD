/* TB scene: inhaled bacilli, alveolar macrophage, a granuloma with a caseous core, T cells and mediators, cavity, spread, gauges. */
const GX = 520, GY = 292;
const AIR = { x0: 44, x1: 322, y0: 100, y1: 186 }, NODE = { x0: 770, x1: 920, y0: 100, y1: 160 }, VES = { x0: 704, x1: 924, y0: 372, y1: 402 };
const L = { gran: $("gran"), bac: $("bac"), parts: $("parts"), over: $("over"), panel: $("panel"), caseum: $("caseum"), cavity: $("cavity"), link: $("link") };
const sm = { B: 0.4, G: 0.6, Cas: 0.4, Cav: 0, Sp: 0, ie: 0.6, abx: 0, sup: 0, prev: 0 };
/* ---- the alveolar wall and the alveolar macrophage ---- */
const wall = [];
function initWall() { for (let i = 0; i < 12; i++) { const g = mk("g", {}, L.gran); cell(g, { cls: "endo", r: 12, nuc: 0.3, seed: i + 3, wob: 0.05, n: 8 }); place(g, 50 + i * 24.5, 204, 0, 1); g.setAttribute("transform", g.getAttribute("transform") + " scale(1 0.62)"); wall.push(g); } }
const am = { g: null, x: 214, y: 168 };
function initAM() { am.g = mk("g", {}, L.gran); cell(am.g, { cls: "mac", r: 22, nuc: 0.4, seed: 4, wob: 0.12 }); place(am.g, am.x, am.y, 0, 1); }
/* ---- granuloma: epithelioid ring, giant cell, lymphocyte rim ---- */
const ring = [], inner = [], lymph = [];
let giant = null;
function initGran() {
  for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.2832, g = mk("g", {}, L.gran); cell(g, { cls: "epith", r: 15, nuc: 0.38, seed: i + 9, wob: 0.1 }); ring.push({ g, a, rr: 96 + (i % 2) * 6, s: 0 }); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.2832 + 0.3, g = mk("g", {}, L.gran); cell(g, { cls: "epith", r: 14, nuc: 0.38, seed: i + 30, wob: 0.1 }); inner.push({ g, a, rr: 62, s: 0 }); }
  for (let i = 0; i < 26; i++) { const g = mk("g", {}, L.gran); cell(g, { cls: "th1", r: 7, nuc: 0.55, seed: i + 50, wob: 0.06, n: 7 }); lymph.push({ g, a: rnd(0, 6.28), rr: rnd(128, 146), s: 0, ph: rnd(0, 6) }); }
  const gg = mk("g", {}, L.gran); cell(gg, { cls: "giant", r: 26, seed: 77, wob: 0.1 });
  for (let j = 0; j < 7; j++) { const t = (j / 7) * 6.28; mk("ellipse", { class: "cl-n", rx: 4.2, ry: 3, cx: Math.cos(t) * 14, cy: Math.sin(t) * 14, transform: "rotate(" + f1(t * 57.3) + " " + f1(Math.cos(t) * 14) + " " + f1(Math.sin(t) * 14) + ")" }, gg); }
  giant = { g: gg, a: -0.7, rr: 100, s: 0 };
}
/* ---- bacilli ---- */
const N_BAC = 46, bac = [];
function initBac() { for (let i = 0; i < N_BAC; i++) { const g = mk("g", {}, L.bac); mk("ellipse", { class: "bac-rod", rx: 5.2, ry: 2 }, g); bac.push({ g, x: rnd(AIR.x0, AIR.x1), y: rnd(AIR.y0, AIR.y1), tx: 0, ty: 0, z: 0, nz: -1, s: 0, rot: rnd(0, 180), t: rnd(0, 3) }); } }
function targetFor(b, z) {
  if (z === 0) return [rnd(AIR.x0, AIR.x1), rnd(AIR.y0, AIR.y1)];
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
const pills = pool(12, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, block marks, gauges ---- */
const gg = {};
let blockMark = null, ifnLab = null; const labs = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [150, 360, 570, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W_ - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The lung";
  [["bac", "Bacterial load", "g-bac", "How many tubercle bacilli are alive in the lung."], ["gran", "Granuloma", "g-good", "How well the granuloma walls the bacilli off. It breaks down when immunity fails."], ["cas", "Caseation", "g-bad", "Cheese-like dead tissue in the granuloma core. Large areas can liquefy and form a cavity."], ["spread", "Spread", "g-clot", "Spread beyond the first focus: to the lymph node, then through the blood as miliary disease."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Inhaled bacilli", 150, 130, 118, 112, "Tubercle bacilli arrive in the lung in tiny droplets breathed in from a person with active lung disease.");
  pill(o, "Alveolar macrophage", am.x, am.y - 22, 238, 62, "The first cell to meet the bacillus. It swallows it, but the bacillus stops the phagosome fusing with the lysosome, so it survives inside.");
  pill(o, "Granuloma", GX, GY - 104, GX, 78, "A ball of immune cells that walls the infection off. It is the hallmark lesion of tuberculosis.");
  pill(o, "Epithelioid macrophages", GX - 104, GY + 8, GX - 232, 300, "Activated macrophages that have lost their ability to engulf and now look like epithelial cells. They form the main layers of the granuloma.");
  labs.giant = pill(o, "Giant cell", GX + Math.cos(-0.7) * 108, GY + Math.sin(-0.7) * 93, GX + 190, 226, "Langhans giant cell: several macrophages fused, with nuclei in a horseshoe around the rim.");
  pill(o, "Th1 cells", GX - 128, GY - 52, GX - 196, 232, "T helper 1 lymphocytes. They release interferon gamma, which activates macrophages to kill bacilli, and they form the outer rim.");
  pill(o, "Caseous necrosis", GX, GY + 10, GX, 424, "The core dies and looks like soft white cheese. Bacilli can survive in it, and when it liquefies it can break into an airway as a cavity.");
  labs.cav = pill(o, "Cavity", GX, GY - 8, 430, 128, "A hollow made when the core liquefies and drains into an airway. It holds many bacilli and sheds them in the breath.");
  labs.node = pill(o, "Spread to node", NODE.x0 + 30, NODE.y1 - 6, 850, 198, "Bacilli drain through lymph to the regional lymph node. With the first focus this is the primary complex.");
  labs.mil = pill(o, "Miliary spread", 840, 388, 850, 330, "Bacilli enter the blood and seed many organs as tiny grey-white nodules like millet seeds.");
  labs.ifn = ifnLab = pill(o, "Interferon gamma and TNF", GX + 70, GY - 30, GX + 210, 296, "Messengers from T cells that activate macrophages. Without them, or with TNF blocked, the granuloma cannot hold.");
  blockMark = mk("g", { id: "blk", opacity: "0" }, o);
  mk("circle", { class: "blk", cx: GX + 112, cy: GY - 6, r: 9 }, blockMark); mk("path", { class: "blk", d: "M" + (GX + 106) + " " + (GY - 12) + "l12 12M" + (GX + 118) + " " + (GY - 12) + "l-12 12" }, blockMark);
}
const W_ = SC.W;
function init() { initWall(); initAM(); initGran(); initBac(); initPanel(); }
const acc = { ifn: 0, tnf: 0, pill: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.8), k2 = Math.min(1, dt * 0.45);
  sm.B = lerp(sm.B, m.B, k2); sm.G = lerp(sm.G, m.G, k2); sm.Cas = lerp(sm.Cas, m.Cas, k2); sm.Cav = lerp(sm.Cav, m.Cav, k2); sm.Sp = lerp(sm.Sp, m.Sp, k2); sm.ie = lerp(sm.ie, m.ie, k1); sm.abx = lerp(sm.abx, m.abx, k1); sm.sup = lerp(sm.sup, m.sup, k1); sm.prev = lerp(sm.prev, m.prev, k1);
  /* core and cavity */
  const rc = 14 + 36 * sm.Cas;
  L.caseum.setAttribute("rx", f1(rc * 1.1)); L.caseum.setAttribute("ry", f1(rc * 0.95)); L.caseum.setAttribute("opacity", (0.35 + 0.65 * sm.Cas).toFixed(2));
  const cv = clamp(sm.Cav * 1.2); L.cavity.setAttribute("rx", f1(Math.max(1, rc * 0.7 * cv))); L.cavity.setAttribute("ry", f1(Math.max(1, rc * 0.6 * cv))); L.cavity.setAttribute("cx", f1(GX + 6 * cv)); L.cavity.setAttribute("cy", f1(GY - 6 * cv));
  L.link.setAttribute("opacity", cv > 0.15 ? clamp((cv - 0.15) * 1.6).toFixed(2) : "0"); L.link.setAttribute("stroke-width", f1(4 + 9 * cv));
  /* alveolar macrophage jiggle */
  place(am.g, am.x + Math.sin(tm / 1300) * 3, am.y + Math.cos(tm / 1700) * 2, Math.sin(tm / 2200) * 5, 1);
  /* ring and rim: cells appear with granuloma integrity and immunity */
  const nr = Math.round(sm.G * ring.length), ni = Math.round(clamp(sm.G * 1.1 - 0.1) * inner.length), nl = Math.round(clamp(sm.ie * 1.15) * lymph.length);
  const put = (c, i, n, sy, tot) => { const on = ((i * 7) % tot) < n; c.s = lerp(c.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.2 : 2))); const a = c.a + Math.sin(tm / 2500 + i) * 0.03;
    place(c.g, GX + Math.cos(a) * c.rr * 1.08, GY + Math.sin(a) * c.rr * 0.93, a * 57.3 + 90 + Math.sin(tm / 900 + i) * 4, c.s); c.g.setAttribute("transform", c.g.getAttribute("transform") + " scale(1.25 " + sy + ")"); c.g.style.opacity = c.s > 0.05 ? 1 : 0; };
  ring.forEach((c, i) => put(c, i, nr, 0.72, 18)); inner.forEach((c, i) => put(c, i, ni, 0.74, 10));
  lymph.forEach((c, i) => { const on = i < nl; c.s = lerp(c.s, on ? 1 : 0, Math.min(1, dt * 1.4)); const a = c.a + tm / 20000 * (i % 2 ? 1 : -1); place(c.g, GX + Math.cos(a) * c.rr * 1.12, GY + Math.sin(a) * c.rr * 0.96 + Math.sin(tm / 700 + c.ph) * 1.5, 0, c.s); c.g.style.opacity = c.s > 0.05 ? 1 : 0; });
  giant.s = lerp(giant.s, sm.G > 0.45 ? 1 : 0, Math.min(1, dt * 1)); place(giant.g, GX + Math.cos(giant.a) * giant.rr * 1.08, GY + Math.sin(giant.a) * giant.rr * 0.93, 0, giant.s); giant.g.style.opacity = giant.s > 0.05 ? 1 : 0;
  /* bacilli: which zone each is in depends on the model */
  const n = Math.round(sm.B * N_BAC);
  let fAir = clamp(0.12 + 0.45 * sm.Cav), fCore = clamp(sm.Cas * 0.4), fNode = clamp(sm.Sp * 0.3), fVes = sm.Sp > 0.45 ? clamp((sm.Sp - 0.45) * 0.7) : 0;
  const tot = fAir + fCore + fNode + fVes; if (tot > 0.88) { const k = 0.88 / tot; fAir *= k; fCore *= k; fNode *= k; fVes *= k; }
  const cAir = Math.round(n * fAir), cCore = Math.round(n * fCore), cNode = Math.round(n * fNode), cVes = Math.round(n * fVes);
  const b1 = cAir, b2 = b1 + cCore, b3 = b2 + cNode, b4 = b3 + cVes;
  bac.forEach((b, i) => {
    const z = i < b1 ? 0 : i < b2 ? 1 : i < b3 ? 2 : i < b4 ? 3 : 4, on = i < n;
    if (z !== b.nz) { const first = b.nz === -1; b.nz = z; [b.tx, b.ty] = targetFor(b, z); if (first) { b.x = b.tx; b.y = b.ty; } }
    b.t -= dt; if (b.t < 0) { b.t = rnd(2, 4); if (z !== 3) [b.tx, b.ty] = targetFor(b, z); }
    if (z === 3) { b.tx = Math.min(VES.x1 - 6, b.x + 40); b.ty = clamp(b.y + rnd(-1, 1) * 4, VES.y0, VES.y1); if (b.x > VES.x1 - 10) { b.x = VES.x0 + 6; } }
    const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy) || 1, sp = z === 3 ? 60 : d > 100 ? 90 : 22, st = Math.min(d, sp * dt * (z === 4 ? 0.8 : 1.4)); b.x += (dx / d) * st; b.y += (dy / d) * st;
    b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.2 + sm.abx * 3)));
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 500 + i) * 20, b.s); b.g.style.opacity = b.s > 0.05 ? 1 : 0; });
  /* T cells signal the macrophages: interferon gamma and TNF; a TNF block (or CD4 loss) stops the signal */
  const sig = clamp(sm.ie * 1.1), block = sm.sup;
  acc.ifn += dt * sig * 9; while (acc.ifn >= 1) { acc.ifn--; const p = free(ifn), a = pick(lymph.filter((c) => c.s > 0.5)), b = pick(ring.filter((c) => c.s > 0.5)); if (p && a && b) { emit(p, GX + Math.cos(a.a) * a.rr * 1.12, GY + Math.sin(a.a) * a.rr * 0.96, 0, 0); p.from = a; p.to = b; } }
  acc.tnf += dt * sig * 6; while (acc.tnf >= 1) { acc.tnf--; const p = free(tnf), a = pick(lymph.filter((c) => c.s > 0.5)), b = pick(inner.filter((c) => c.s > 0.5)); if (p && a && b) { emit(p, GX + Math.cos(a.a) * a.rr * 1.12, GY + Math.sin(a.a) * a.rr * 0.96, 0, 0); p.from = a; p.to = b; } }
  [ifn, tnf].forEach((pl, k) => pl.forEach((p) => { if (!p.on) return; p.t += dt; const tx = GX + Math.cos(p.to.a) * p.to.rr * 1.08, ty = GY + Math.sin(p.to.a) * p.to.rr * 0.93, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (k === 1 && block > 0.5 && d < 70) { p.e.setAttribute("opacity", clamp(d / 70).toFixed(2)); } if (d < 12) kill(p); }));
  $("blk").setAttribute("opacity", block.toFixed(2));
  /* drug capsules enter from the blood vessel and head for the core */
  acc.pill += dt * (sm.abx + sm.prev * 0.6) * 2.2; while (acc.pill >= 1) { acc.pill--; const p = free(pills); if (p) emit(p, VES.x0 + 20, VES.y0 + 6, 0, 0); }
  pills.forEach((p) => { if (!p.on) return; p.t += dt; const tx = GX + 40, ty = GY + 10; p.x += (tx - p.x) * dt * 0.45 - 8 * dt; p.y += (ty - p.y) * dt * 0.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 5) / 1.5).toFixed(2)); if (p.t > 6.5) kill(p); });
  labs.giant.style.opacity = giant.s.toFixed(2); labs.cav.style.opacity = clamp((cv - 0.1) * 3).toFixed(2); labs.node.style.opacity = clamp((sm.Sp - 0.12) * 4).toFixed(2); labs.mil.style.opacity = clamp((sm.Sp - 0.4) * 5).toFixed(2); labs.ifn.style.opacity = clamp(sig * 3).toFixed(2);
  /* gauges */
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.5, ["few", "held", "high"])); gg.gran.set(sm.G, wordOf(sm.G, 0.35, 0.7, ["breaking down", "forming", "intact"])); gg.cas.set(sm.Cas, wordOf(sm.Cas, 0.3, 0.6, ["small", "moderate", "extensive"])); gg.spread.set(sm.Sp, wordOf(sm.Sp, 0.2, 0.5, ["none", "local", "miliary"]));
}
run({ init, step });
