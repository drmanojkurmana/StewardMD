/* DVT scene: calf vein clot around a valve, travelling emboli and lung block. Each treatment acts on the drawing. */
const WW = SC.W;
const layers = { vein: $("veinSlot"), lung: $("lungSlot"), halo: $("halo"), clot: $("clot"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { Ce: 0.5, Prop: 0.4, Flow: 0.6, Swell: 0.4, Emb: 0.4, LungBlock: 0.3, LungFlow: 0.7, comp: 0, ac: 0, fl: 0 };
const gg = {};
let veinO = null, lungO = null, capEl = null, capDrug = -1;
let trPath = null, filterPos = [528, 100], lodge = [732, 254];
let clotCells = [], veinCells = [], lungCells = [], chevEls = [], arrowEls = [], fibrinEls = [];
let embG, lodgeTint, haloEl, stockG, shieldG, acWash, filterG, trapG, routeEl;
let embPool, sparkPool, dropPool;
const acc = { emb: 0, spark: 0, drop: 0 };
const VALVE_Y = 352, CLOT_X = 250;

function rbc(parent, rx, ry) { const g = mk("g", { class: "cl cl-rbc" }, parent); mk("ellipse", { class: "cl-b", rx, ry }, g); mk("ellipse", { class: "cl-s", rx: rx * 0.36, ry: ry * 0.32 }, g); return g; }
function capText(d) {
  if (d === 1) return "Squeezing the calf and walking speed the flow up. Swelling eases.";
  if (d === 2) return "Anticoagulant stops the clot growing. Fewer pieces break off.";
  if (d === 3) return "The filter catches travelling pieces and the clot dissolving treatment breaks the clot up. Lung flow stays open.";
  return "No treatment. The clot grows, pieces break off and lung flow falls.";
}

function initOrgans() {
  veinO = organ($("veinSlot"), "vessel", 250, 265, 120, {});
  lungO = organ($("lungSlot"), "lung", 745, 260, 210, {});
  const top = veinO.ports.in, art = lungO.ports.art;
  lodge = [art[0], art[1]];
  const pts = [top, [300, 95], [400, 86], [500, 90], [565, 105], [610, 140], [645, 190], art];
  trPath = track(pts);
  routeEl = $("route");
  routeEl.setAttribute("d", "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join(" L"));
  const q = trPath.at(0.52);
  filterPos = [q.x, q.y];
}

function initVein() {
  const L = layers.clot;
  mk("path", { class: "dvt-valve", d: "M222 344L244 352L222 360" }, L);
  mk("path", { class: "dvt-valve", d: "M278 344L256 352L278 360" }, L);
  const cg = layers.clot;
  for (let i = 0; i < 16; i++) {
    const c = cell(cg, { cls: "plt", r: 6 + (i % 3), x: CLOT_X + Math.sin(i * 1.7) * 10, y: VALVE_Y - 8 - i * 11, seed: i + 3, wob: 0.16, n: 7 });
    clotCells.push(c);
  }
  for (let i = 0; i < 5; i++) fibrinEls.push(mk("path", { class: "fibrin", d: "M228 " + (VALVE_Y - 20 - i * 22) + "L272 " + (VALVE_Y - 26 - i * 22) }, cg));
  haloEl = layers.halo;
  stockG = mk("g", { id: "m-comp", opacity: "0" }, layers.cells);
  mk("rect", { class: "dvt-stock", x: 110, y: 130, width: 280, height: 270, rx: 60 }, stockG);
  for (let i = 0; i < 3; i++) {
    const y = 185 + i * 80;
    arrowEls.push(mk("path", { class: "dvt-arrow", d: "M0 0" }, stockG));
    arrowEls.push(mk("path", { class: "dvt-arrow", d: "M0 0" }, stockG));
    arrowEls[i * 2].dataset.side = "l"; arrowEls[i * 2].dataset.y = y;
    arrowEls[i * 2 + 1].dataset.side = "r"; arrowEls[i * 2 + 1].dataset.y = y;
  }
  acWash = mk("rect", { class: "dvt-wash", x: 202, y: 150, width: 96, height: 220, rx: 20, opacity: "0" }, layers.cells);
  shieldG = mk("g", { id: "m-ac", opacity: "0" }, layers.cells);
  mk("circle", { class: "dvt-shield", cx: 0, cy: 0, r: 13 }, shieldG);
  mk("path", { class: "dvt-tick", d: "M-6 0l4 4l8 -9" }, shieldG);
  mk("path", { class: "dvt-tick", d: "M-44 -13L24 -13" }, shieldG);
  for (let i = 0; i < 2; i++) chevEls.push(mk("path", { class: "dvt-chev", d: "M0 0" }, layers.cells));
  for (let i = 0; i < 14; i++) { const g = rbc(layers.cells, 8, 4.8); veinCells.push({ g, x: rnd(234, 266), y: rnd(125, 410), v: rnd(0.8, 1.2), rot: rnd(-14, 14) }); }
}

function initLung() {
  const L = layers.lung;
  lodgeTint = mk("circle", { class: "dvt-block", cx: f1(lodge[0]), cy: f1(lodge[1]), r: 30, opacity: "0" }, L);
  embG = mk("g", {}, L);
  for (let i = 0; i < 7; i++) cell(embG, { cls: "plt", r: 5.5 + (i % 3), x: Math.cos(i * 1.2) * 14, y: Math.sin(i * 2) * 9, seed: i + 11, wob: 0.16, n: 7 });
  place(embG, lodge[0], lodge[1], 0, 1);
  filterG = mk("g", { id: "m-fl", opacity: "0" }, layers.cells);
  mk("path", { class: "dvt-filter", d: "M-16 -11L16 11M-16 11L16 -11" }, filterG);
  mk("circle", { class: "dvt-filter", cx: 0, cy: 0, r: 19 }, filterG);
  place(filterG, filterPos[0], filterPos[1], 0, 1);
  trapG = mk("g", { opacity: "0" }, layers.cells);
  for (let i = 0; i < 3; i++) cell(trapG, { cls: "plt", r: 5, x: (i - 1) * 9, y: (i % 2) * 7 - 3, seed: i + 31, wob: 0.16, n: 7 });
  place(trapG, filterPos[0], filterPos[1] + 2, 0, 1);
  for (let i = 0; i < 10; i++) { const g = rbc(layers.cells, 7, 4.2); lungCells.push({ g, x: lodge[0] - 150 + i * 14, y: lodge[1] + rnd(-4, 4), v: rnd(0.85, 1.15), rot: rnd(-12, 12) }); }
}

function initPools() {
  embPool = pool(6, () => mk("circle", { class: "sc-p p-emb2", r: 4.5 }, layers.parts));
  sparkPool = pool(12, () => mk("path", { class: "dvt-spark", d: "M-4 0L4 0M0 -4L0 4" }, layers.parts));
  dropPool = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
}

function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["clot", "Clot", "g-clot", "How far the clot extends along the calf vein from the valve."],
   ["flow", "Vein flow", "g-fl", "How much blood still gets past the clot in the calf vein. Compression and movement speed it up."],
   ["swell", "Swelling", "g-swell", "Calf swelling from raised pressure behind the blocked vein. Fluid leaves the vessels into the tissue."],
   ["prop", "Growth", "g-cyt", "Whether the clot is still growing toward the heart. An anticoagulant and clot dissolving treatment stop this."],
   ["emb", "Embolus risk", "g-bad", "Chance that a piece breaks off and travels toward the lung. A filter catches travelling pieces."],
   ["lung", "Lung flow", "g-good", "How much blood still flows through the lung vessel past a travelled embolus."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Calf vein", 204, 250, 118, 212, "Deep vein in the calf. Blood flows up toward the heart.");
  pill(o, "Valve", 250, 352, 128, 392, "One way flap. Flow is slowest behind it, so a clot often starts here.");
  pill(o, "Clot", 272, 322, 368, 352, "Platelets and fibrin stuck to the wall. The tail grows up toward the heart.");
  pill(o, "Swelling", 368, 295, 452, 392, "Pressure behind the block pushes fluid into the tissue. The calf widens.");
  pill(o, "Embolus", 410, 88, 440, 60, "A piece of clot that broke off. It travels with the blood to the lung.");
  const pf = pill(o, "Filter", filterPos[0], filterPos[1], 566, 60, "A catcher in the large vein. It traps travelling pieces before they reach the lung.");
  pf.setAttribute("id", "p-fl"); pf.style.opacity = 0;
  pill(o, "Lung", 745, 140, 775, 62, "Blood picks up oxygen here. A lodged piece blocks part of it.");
  pill(o, "Blocked flow", lodge[0], lodge[1], 700, 392, "Lodged clot. Blood cannot pass, so lung flow falls.");
  capEl = mk("text", { class: "dvt-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0);
}

function init() { initOrgans(); initVein(); initLung(); initPools(); initPanel(); }

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.5);
  ["Ce", "Flow", "Swell", "LungBlock", "LungFlow", "comp", "ac", "fl"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  ["Prop", "Emb"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  const shown = Math.round(sm.Ce * clotCells.length);
  const tipY = VALVE_Y - 8 - Math.max(0, shown - 1) * 11;
  clotCells.forEach((c, i) => {
    const on = i < shown;
    const shrink = 1 - 0.3 * sm.fl;
    place(c, CLOT_X + Math.sin(i * 1.7) * 10, VALVE_Y - 8 - i * 11, Math.sin(tm / 700 + i) * 8, on ? shrink : 0.05);
    c.style.opacity = on ? 1 : 0;
  });
  fibrinEls.forEach((f, i) => { f.setAttribute("opacity", (VALVE_Y - 23 - i * 22 > tipY - 6 ? 1 : 0).toFixed(0)); });
  const rx = 95 + 45 * sm.Swell, ry = 135 + 15 * sm.Swell;
  haloEl.setAttribute("rx", f1(rx)); haloEl.setAttribute("ry", f1(ry));
  haloEl.setAttribute("opacity", (0.1 + 0.14 * sm.Swell).toFixed(2));
  const st = stockG.querySelector("rect");
  st.setAttribute("x", f1(250 - rx - 12)); st.setAttribute("width", f1((rx + 12) * 2));
  stockG.setAttribute("opacity", sm.comp.toFixed(2));
  const sq = 6 + 5 * Math.sin(tm / 300);
  arrowEls.forEach((a) => {
    const y = +a.dataset.y, l = a.dataset.side === "l" ? 250 - rx - 12 : 250 + rx + 12;
    const d = a.dataset.side === "l" ? "M" + f1(l - 26 - sq) + " " + f1(y) + "L" + f1(l - 10) + " " + f1(y) + "M" + f1(l - 16) + " " + f1(y - 5) + "L" + f1(l - 10) + " " + f1(y) + "L" + f1(l - 16) + " " + f1(y + 5)
      : "M" + f1(l + 26 + sq) + " " + f1(y) + "L" + f1(l + 10) + " " + f1(y) + "M" + f1(l + 16) + " " + f1(y - 5) + "L" + f1(l + 10) + " " + f1(y) + "L" + f1(l + 16) + " " + f1(y + 5);
    a.setAttribute("d", d);
  });
  acWash.setAttribute("opacity", (0.85 * sm.ac).toFixed(2));
  shieldG.setAttribute("opacity", sm.ac.toFixed(2));
  place(shieldG, 292, tipY, 0, 1);
  const march = (tm / 420) % 16;
  chevEls.forEach((c, i) => {
    const y = tipY - 22 - i * 14 - march;
    c.setAttribute("d", "M238 " + f1(y) + "L250 " + f1(y - 9) + "L262 " + f1(y));
    c.setAttribute("opacity", (clamp(sm.Prop * 1.4) * (1 - sm.ac) * clamp((y - (tipY - 52)) / 14)).toFixed(2));
  });
  filterG.setAttribute("opacity", sm.fl.toFixed(2));
  trapG.setAttribute("opacity", (sm.fl * clamp(sm.Emb + 0.4)).toFixed(2));
  const vf = 20 + 70 * sm.Flow;
  veinCells.forEach((c, i) => {
    let sp = vf * c.v;
    if (c.x > 218 && c.x < 282 && c.y > tipY - 12 && c.y < VALVE_Y + 12) sp *= 0.35;
    c.y -= sp * dt;
    if (c.y < 122) { c.y = 410; c.x = rnd(234, 266); }
    place(c.g, c.x, c.y + Math.sin(tm / 500 + i) * 1.5, c.rot, 1);
  });
  lungCells.forEach((c) => {
    c.x += (16 + 60 * sm.LungFlow) * c.v * dt;
    if (c.x > lodge[0] - 18 && c.x < lodge[0] && sm.LungBlock > 0.25) c.x = lodge[0] - 18;
    if (c.x > lodge[0] + 60) { c.x = lodge[0] - 150; c.y = lodge[1] + rnd(-4, 4); }
    place(c.g, c.x, c.y, c.rot, 1);
  });
  const es = clamp((sm.LungBlock - 0.04) * 1.5);
  place(embG, lodge[0], lodge[1], Math.sin(tm / 700) * 5, 0.15 + 0.85 * es);
  embG.style.opacity = es > 0.08 ? 1 : 0;
  lodgeTint.setAttribute("opacity", (sm.LungBlock * 0.55).toFixed(2));
  acc.emb += dt * sm.Emb * 1.6;
  while (acc.emb >= 1) { acc.emb--; const p = free(embPool); if (p) { p.u = 0; emit(p, 0, 0, 0, 0, 0); } }
  embPool.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 0.25;
    const lim = sm.fl > 0.5 ? 0.52 : 1;
    const a = trPath.at(Math.min(p.u, lim));
    p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")");
    if (p.u >= lim) kill(p);
  });
  acc.spark += dt * sm.fl * 8;
  while (acc.spark >= 1) { acc.spark--; const p = free(sparkPool); if (p) emit(p, CLOT_X + rnd(-24, 24), tipY + rnd(0, 110), 0, 0, 0); }
  sparkPool.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 160) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  acc.drop += dt * sm.Swell * 5 * (1 - 0.6 * sm.comp);
  while (acc.drop >= 1) { acc.drop--; const p = free(dropPool); if (p) emit(p, rnd(250 - rx + 20, 250 + rx - 20), 265 + ry - 25, 0, 22, 0); }
  dropPool.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 265 + ry + 20) kill(p); });
  const pf = $("p-fl");
  if (pf) pf.style.opacity = sm.fl.toFixed(2);
  gg.clot.set(sm.Ce, wordOf(sm.Ce, 0.35, 0.7, ["short", "long", "extensive"]));
  gg.flow.set(sm.Flow, wordOf(sm.Flow, 0.35, 0.7, ["slow", "reduced", "brisk"]));
  gg.swell.set(sm.Swell, wordOf(sm.Swell, 0.3, 0.6, ["little", "moderate", "marked"]));
  gg.prop.set(sm.Prop, wordOf(sm.Prop, 0.3, 0.6, ["stopped", "slow", "active"]));
  gg.emb.set(sm.Emb, wordOf(sm.Emb, 0.3, 0.6, ["low", "raised", "high"]));
  gg.lung.set(sm.LungFlow, wordOf(sm.LungFlow, 0.35, 0.7, ["blocked", "reduced", "open"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
