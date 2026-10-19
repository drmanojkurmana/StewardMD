/* Sarcoidosis scene: trigger shown to CD4 T cells, signals gather a granuloma in real lung art,
 * hilar nodes, base scarring, skin eye and heart involvement, vitamin D to calcium, and drug
 * capsules that dock on the immune cells so the downstream signal fades. */
const WW = SC.W;
const layers = { ags: $("ags"), cells: $("cells"), gran: $("gran"), parts: $("parts"), over: $("over"), panel: $("panel"), fib: $("fibBands") };
const APC = { x: 130, y: 225 };
const SUN = [690, 420];
let lungO = null, capEl = null, capDrug = -1;
let granPos = [385, 270], nodeL = [380, 255], nodeR = [480, 255], baseL = [390, 360], baseR = [470, 360];
/* ---- real organ art, the way hepenc does it; everything else anchors to its ports ---- */
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 430, 255, 200, {});
  organ($("skinSlot"), "skin", 690, 135, 130, {});
  organ($("eyeSlot"), "eye", 690, 245, 140, {});
  organ($("heartSlot"), "heart", 690, 345, 75, {});
  const P = lungO.ports;
  granPos = [Math.round(P.apex[0] * 0.75 + P.hilumL[0] * 0.25), Math.round(P.apex[1] * 0.75 + P.hilumL[1] * 0.25)];
  nodeL = [P.hilumL[0] - 14, P.hilumL[1] + 6]; nodeR = [P.hilumR[0] + 14, P.hilumR[1]];
  baseL = P.base.slice(); baseR = P.baseR.slice();
  [baseL, baseR].forEach((b) => {
    [[-22, 4], [-10, 6], [2, 4]].forEach(([dy, wd]) => {
      mk("path", { class: "sg-fib", d: "M" + f1(b[0] - 48) + " " + f1(b[1] + dy - 8) + " Q" + f1(b[0] - 14) + " " + f1(b[1] + dy + 8) + " " + f1(b[0] + 16) + " " + f1(b[1] + dy), "stroke-width": wd }, layers.fib);
    });
  });
}
/* ---- antigen presenting macrophage and CD4 T cells ---- */
const apcG = mk("g", {}, layers.cells);
const apc = cell(apcG, { cls: "mac", r: 26, nuc: 0.42, seed: 3, wob: 0.13 });
place(apcG, APC.x, APC.y, 0, 1);
const tcells = [[60, 320], [130, 335], [200, 320]].map(([x, y], i) => { const g = mk("g", {}, layers.cells); cell(g, { cls: "lymph", r: 13, nuc: 0.5, seed: i + 7, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
/* ---- hilar lymph nodes: filled clusters at both lung roots ---- */
const nodeGroups = [];
function initNodes() {
  [nodeL, nodeR].forEach(([x, y], s) => {
    const g = mk("g", {}, layers.cells);
    [[-9, -5], [8, -6], [0, 8], [-10, 8], [10, 6]].forEach(([dx, dy], j) => { const c = cell(g, { cls: "lymph", r: 8, nuc: 0.45, seed: s * 9 + j, wob: 0.12 }); c.setAttribute("transform", "translate(" + dx + " " + dy + ")"); });
    place(g, x, y, 0, 1); nodeGroups.push({ g, x, y });
  });
}
/* ---- granuloma on the lung field: giant cell centre, epithelioid ring, lymphocyte cuff, pale core ---- */
const granG = mk("g", {}, layers.gran);
function initGran() {
  for (let j = 0; j < 10; j++) { const t = (j / 10) * 6.283; const c = cell(granG, { cls: "lymph", r: 6, nuc: 0.45, seed: j + 30, wob: 0.12 }); c.setAttribute("transform", "translate(" + f1(Math.cos(t) * 34) + " " + f1(Math.sin(t) * 34) + ")"); }
  for (let j = 0; j < 8; j++) { const t = (j / 8) * 6.283 + 0.4; const c = cell(granG, { cls: "mac", r: 9, nuc: 0.4, seed: j + 12, wob: 0.14 }); c.setAttribute("transform", "translate(" + f1(Math.cos(t) * 22) + " " + f1(Math.sin(t) * 22) + ")"); }
  cell(granG, { cls: "mac", r: 14, nuc: 0.55, nucCls: "multi", seed: 5, wob: 0.1 });
  mk("circle", { class: "sg-core", cx: 0, cy: 0, r: 5 }, granG);
  place(granG, granPos[0], granPos[1], 0, 1);
}
/* ---- lung infiltrate dots around the granuloma and mirrored to the other lung ---- */
const infG = mk("g", {}, layers.gran);
function initInf() {
  for (let i = 0; i < 8; i++) {
    const t = i * 0.785 + 0.3, rx = 40 + (i % 3) * 8, ry = 45 + (i % 2) * 10;
    const x = granPos[0] + Math.cos(t) * rx, y = granPos[1] + Math.sin(t) * ry, mx = lungO.x * 2 - x;
    mk("circle", { class: "sg-spot", cx: f1(x), cy: f1(y), r: 3.5 }, infG);
    mk("circle", { class: "sg-spot", cx: f1(mx), cy: f1(y), r: 3.5 }, infG);
  }
}
/* ---- fibroblasts along the base bands ---- */
const fibCells = [];
function initFib() {
  [[baseL[0] - 35, baseL[1] - 14], [baseL[0] - 5, baseL[1] + 2], [baseR[0] - 35, baseR[1] - 14], [baseR[0] - 5, baseR[1] + 2]].forEach(([x, y], i) => {
    const g = mk("g", {}, layers.cells); cell(g, { cls: "sm", r: 8, nuc: 0.4, seed: i + 40, wob: 0.12 }); place(g, x, y, 0, 1); fibCells.push({ g, x, y });
  });
}
/* ---- granuloma specks on skin, eye and heart; calcium sun ---- */
const speckGroups = [];
function initSpecks() {
  [[690, 135], [690, 245], [690, 345]].forEach(([x, y], s) => {
    const g = mk("g", {}, layers.cells);
    [[-22, -12], [6, 4], [24, -20]].forEach(([dx, dy]) => mk("circle", { class: "sg-spot", cx: x + dx, cy: y + dy, r: 4 }, g));
    g.setAttribute("opacity", "0.5"); speckGroups.push(g);
  });
}
const sunG = mk("g", {}, layers.cells);
const sunRays = [];
function initSun() {
  mk("circle", { class: "sg-sun", cx: SUN[0], cy: SUN[1], r: 12 }, sunG);
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * 6.283, x1 = SUN[0] + Math.cos(t) * 15, y1 = SUN[1] + Math.sin(t) * 15, x2 = SUN[0] + Math.cos(t) * 19, y2 = SUN[1] + Math.sin(t) * 19;
    sunRays.push(mk("path", { class: "sg-ray", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, sunG));
  }
}
/* ---- drug capsule docks: T cell rims for both drugs, plus APC and granuloma rim for drug 1 ---- */
const docksT = [], docksX = [];
function initDocks() {
  tcells.forEach((c, i) => { docksT.push({ a: 0, i, ox: -14, oy: -6 }); docksT.push({ a: 0, i, ox: 14, oy: -6 }); });
  docksX.push({ a: 1, ox: -30, oy: 0 }); docksX.push({ a: 1, ox: 30, oy: 0 });
  [0.3, 1.9, 3.4, 5.0].forEach((t) => docksX.push({ a: 2, ox: Math.cos(t) * 48, oy: Math.sin(t) * 48 }));
}
function dockPos(d) {
  if (d.a === 0) { const c = tcells[d.i], s = 0.7 + 0.5 * sm.T; return [c.x + d.ox * s, c.y + d.oy * s]; }
  if (d.a === 1) return [APC.x + d.ox, APC.y + d.oy];
  const s = 0.45 + 0.6 * sm.G; return [granPos[0] + d.ox * s, granPos[1] + d.oy * s];
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ags = pool(16, () => mk("path", { class: "sc-p p-ag", d: "M0 -4L3 0L0 4L-3 0Z" }, layers.ags));
const cyts = pool(30, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, layers.parts));
const vits = pool(14, () => mk("circle", { class: "sc-p p-vit", r: 3 }, layers.parts));
const meds = [];
for (let i = 0; i < 12; i++) {
  const g = mk("g", {}, layers.parts);
  mk("rect", { class: "p-cap", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g);
  const half = mk("rect", { class: "p-capB1", x: 0, y: -2.5, width: 5, height: 5, rx: 2 }, g);
  g.setAttribute("opacity", "0");
  meds.push({ g, half, on: false, x: 0, y: 0, t: 0, dock: null, st: 0 });
}
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, gauges and the plain language caption ---- */
const gg = {};
function capText(d) {
  if (d === 1) return "Corticosteroid calms the T cells. Granulomas shrink and calcium falls, but scar stays.";
  if (d === 2) return "Immunosuppressant quiets the T cells. Granulomas ease, but scar stays.";
  return "No treatment. Granulomas grow in the lung and spread to other organs.";
}
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [95, 255, 415, 575, 735];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gran", "Granuloma", "g-cyt", "Granuloma burden: tight balls of activated macrophages and T cells without central dead tissue."], ["nodes", "Hilar nodes", "g-eos", "Enlarged lymph nodes at both lung roots, a classic chest finding."], ["fib", "Scarring", "g-fib", "Lung scarring. Builds up late and is not reversed by calming inflammation."], ["org", "Other organs", "g-org", "How much skin, eye, heart and other organs are involved by granulomas."], ["ca", "Calcium", "g-bad", "Blood calcium. Active vitamin D from macrophages raises it; it falls again when they quieten."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Trigger", 130, 130, 130, 66, "Unknown trigger: the cause is not known. A presumed inhaled trigger starts the response.");
  pill(ox, "Macrophage", APC.x, APC.y, 60, 252, "Macrophage: shows the trigger to CD4 T cells and later forms the building block of the granuloma.");
  pill(ox, "CD4 T cell", 130, 335, 130, 392, "CD4 T cell: its signals gather macrophages and hold the granuloma together.");
  pill(ox, "Granuloma", granPos[0], granPos[1] - 40, 400, 70, "Non-caseating granuloma: a tight ball of macrophages and T cells with no dead centre. Treatment shrinks it.");
  pill(ox, "Hilar nodes", nodeR[0], nodeR[1], 545, 105, "Nodes at both lung roots swell with granulomas. Often found on a chest scan.");
  pill(ox, "Lung scarring", baseR[0], baseR[1], 590, 394, "Late scarring at the lung bases. It stiffens the lung and does not reverse with treatment.");
  pill(ox, "Skin, eye, heart", 760, 245, 855, 214, "Granulomas can reach skin, eye and heart. The red dots fade when treatment calms inflammation.");
  pill(ox, "Calcium", SUN[0], SUN[1], 835, 420, "Active vitamin D from macrophages raises blood calcium. It falls again when they quieten.");
  capEl = mk("text", { class: "sa-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0);
}
const sm = { a: 0.5, T: 0.3, G: 0.3, F: 0.2, Ca: 0.2, N: 0.3, O: 0.2, sup: 0 };
const acc = { ag: 0, cyt: 0, vit: 0, med: 0 };
const agState = ags.map((p, i) => ({ p, x: rnd(45, 215), y: rnd(95, 165), a: rnd(0, 6.28), s: 0, i }));
const docksAll = [];
function init() { initOrgans(); initNodes(); initGran(); initInf(); initFib(); initSpecks(); initSun(); initDocks(); docksT.forEach((d) => docksAll.push(d)); docksX.forEach((d) => docksAll.push(d)); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.a = lerp(sm.a, m.a, k2); sm.T = lerp(sm.T, m.T, k2); sm.G = lerp(sm.G, m.G, k2); sm.F = lerp(sm.F, m.F, k2); sm.Ca = lerp(sm.Ca, m.Ca, k2); sm.N = lerp(sm.N, m.N, k2); sm.O = lerp(sm.O, m.O, k2); sm.sup = lerp(sm.sup, m.sup, k1);
  /* trigger particles drift; some reach the macrophage */
  const want = Math.round(ags.length * (0.35 + 0.55 * sm.a));
  agState.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * 1.6));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 9 * dt; b.y += Math.sin(b.a) * 9 * dt;
    if (b.x < 42 || b.x > 218) b.a = Math.PI - b.a; if (b.y < 92 || b.y > 168) b.a = -b.a; b.x = clamp(b.x, 42, 218); b.y = clamp(b.y, 92, 168);
    b.p.on = b.s > 0.05; b.p.e.setAttribute("opacity", b.s > 0.05 ? "1" : "0"); b.p.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ") rotate(" + f1(tm / 6 + i * 20) + ") scale(" + b.s.toFixed(3) + ")"); });
  /* presenting cell and T cells respond to activity; drugs shrink the T cells */
  const sT = 0.7 + 0.5 * sm.T;
  place(apcG, APC.x + Math.sin(tm / 1500) * 3, APC.y + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 5, 1);
  tcells.forEach((c, i) => place(c.g, c.x + Math.sin(tm / 1300 + i * 2) * 3, c.y + Math.cos(tm / 1500 + i) * 2, Math.sin(tm / 2000 + i) * 8, sT));
  /* T cell signals home to the granuloma and fade when drugs dock */
  acc.cyt += dt * sm.T * 12; while (acc.cyt >= 1) { acc.cyt--; const p = free(cyts), c = pick(tcells); if (p) emit(p, c.x + rnd(-8, 8), c.y - 12, rnd(16, 26), rnd(-14, -4), 0); }
  const gs = 0.45 + 0.6 * sm.G;
  cyts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (granPos[0] - p.x) * dt * 0.35; p.y += p.vy * dt + (granPos[1] - p.y) * dt * 0.35; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(granPos[0] - p.x, granPos[1] - p.y) < 40 * gs + 8 || p.t > 6) kill(p); });
  /* granuloma, nodes, infiltrates and scarring follow the model */
  place(granG, granPos[0], granPos[1], Math.sin(tm / 3000) * 3, gs);
  nodeGroups.forEach((n) => place(n.g, n.x, n.y, 0, 0.45 + 0.75 * sm.N));
  infG.setAttribute("opacity", (0.15 + 0.85 * sm.G).toFixed(2));
  layers.fib.setAttribute("opacity", (0.08 + 0.92 * sm.F).toFixed(2));
  fibCells.forEach((c) => place(c.g, c.x, c.y, 0, 0.3 + 0.8 * sm.F));
  speckGroups.forEach((g) => g.setAttribute("opacity", sm.O.toFixed(2)));
  sunRays.forEach((r, i) => r.setAttribute("opacity", (0.2 + 0.8 * sm.Ca).toFixed(2)));
  /* active vitamin D leaves the granuloma for the calcium sun */
  acc.vit += dt * sm.G * 5; while (acc.vit >= 1) { acc.vit--; const p = free(vits); if (p) { const dx = SUN[0] - granPos[0], dy = SUN[1] - granPos[1], L = Math.hypot(dx, dy); emit(p, granPos[0] + dx / L * 40, granPos[1] + dy / L * 40, dx / L * 46, dy / L * 46, 0); } }
  vits.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(SUN[0] - p.x, SUN[1] - p.y) < 22 || p.t > 8) kill(p); else p.t += dt; });
  /* drug capsules fly in and sit on the immune cells while treatment is on */
  const wantDock = drug === 1 ? 10 : drug === 2 ? 5 : 0;
  if (drug === 0) meds.forEach((p) => { if (p.on && p.st !== 3) { p.st = 3; p.t = 0; p.dock = null; } });
  else {
    const elig = drug === 1 ? docksAll : docksT;
    meds.forEach((p) => { if (p.on && p.dock && elig.indexOf(p.dock) < 0) { p.st = 3; p.t = 0; p.dock = null; } });
    const keep = meds.filter((p) => p.on && p.st === 2);
    if (keep.length > wantDock) keep.slice(wantDock).forEach((p) => { p.st = 3; p.t = 0; p.dock = null; });
    acc.med += dt * 2.4;
    while (acc.med >= 1) {
      acc.med--;
      if (meds.filter((p) => p.on && p.st === 2).length + meds.filter((p) => p.on && p.st === 1).length >= wantDock) break;
      const taken = meds.filter((p) => p.on && p.dock).map((p) => p.dock);
      const open = elig.filter((d) => taken.indexOf(d) < 0);
      if (!open.length) break;
      const p = meds.find((q) => !q.on);
      if (!p) break;
      p.dock = pick(open); p.on = true; p.st = 1; p.t = 0;
      p.x = rnd(20, 70); p.y = rnd(280, 350);
      p.half.setAttribute("class", drug === 1 ? "p-capB1" : "p-capB2");
      p.g.setAttribute("opacity", "1");
    }
  }
  meds.forEach((p) => {
    if (!p.on) return;
    if (p.st === 1) {
      const q = dockPos(p.dock);
      p.x = lerp(p.x, q[0], Math.min(1, dt * 2.2)); p.y = lerp(p.y, q[1], Math.min(1, dt * 2.2)); p.t += dt;
      place(p.g, p.x, p.y, p.t * 60, 1);
      if (Math.hypot(q[0] - p.x, q[1] - p.y) < 4 || p.t > 6) { p.st = 2; p.t = 0; }
    } else if (p.st === 2) {
      const q = dockPos(p.dock);
      p.t += dt;
      place(p.g, q[0] + Math.sin(tm / 500 + q[1]) * 1.5, q[1] + Math.cos(tm / 600) * 1.5, Math.sin(p.t) * 8, 1);
    } else {
      p.t += dt; p.y += 30 * dt;
      p.g.setAttribute("opacity", clamp(1 - p.t / 1.2).toFixed(2));
      place(p.g, p.x, p.y, p.t * 60, 1);
      if (p.t > 1.3) { p.on = false; p.g.setAttribute("opacity", "0"); }
    }
  });
  /* gauges and caption */
  gg.gran.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["small", "active", "extensive"])); gg.nodes.set(sm.N, wordOf(sm.N, 0.3, 0.6, ["normal", "enlarged", "marked"]));
  gg.fib.set(sm.F, wordOf(sm.F, 0.25, 0.6, ["none", "some", "extensive"])); gg.org.set(sm.O, wordOf(sm.O, 0.3, 0.6, ["none", "some", "marked"])); gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.3, 0.6, ["normal", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
