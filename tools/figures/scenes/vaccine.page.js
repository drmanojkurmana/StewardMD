/* Vaccination scene: skin dendritic cell, lymphatic signal to the lymph node,
 * germinal centre B cells, plasma antibody into a blood vessel, memory cells,
 * and later pathogen coated and shrunk by antibody. Organs come from organs.lib.js. */
const L = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, home: false, ti: -1 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.home = false; p.ti = -1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.home = false; p.ti = -1; p.e.setAttribute("opacity", "0"); }
function abShape(parent, cls) { const g = mk("g", {}, parent); mk("path", { class: cls || "ab-y", d: "M0 5L0 0M0 0L-3.5 -4M0 0L3.5 -4" }, g); return g; }

/* ---- organs and their ports ---- */
let skinO = null, nodeO = null, vesselO = null;
let dcPos = [150, 300], surfPos = [150, 250], tPos = [479, 307], germPos = [539, 249];
let lumenX = 812, vTop = 130, vBot = 370, glowCy = 250;
let trLymph = null, trNode = null;
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 150, 300, 190, {});
  nodeO = organ($("nodeSlot"), "lymphnode", 492, 238, 215, {});
  vesselO = organ($("vesselSlot"), "vessel", 812, 245, 110, {});
  const SP = skinO.ports, NP = nodeO.ports, VP = vesselO.ports;
  dcPos = SP.dermis || [150, 300]; surfPos = SP.surface || [150, 250];
  tPos = NP.parenchyma || NP.paracortex; germPos = NP.germ;
  if (dcPos[1] > 400) dcPos = [dcPos[0], 400];
  lumenX = clamp(VP.in[0], 700, 900); vTop = VP.in[1]; vBot = VP.out[1];
  if (!(vBot > vTop + 40)) { vTop = clamp(vTop, 110, 260); vBot = clamp(vTop + 220, vTop + 120, 400); }
  const mx = (dcPos[0] + NP.in[0]) / 2;
  $("lymphPath").setAttribute("d", "M" + f1(dcPos[0]) + " " + f1(dcPos[1])
    + " C" + f1(mx - 30) + " " + f1(dcPos[1] - 10) + " " + f1(mx + 30) + " " + f1(NP.in[1] + 40) + " " + f1(NP.in[0]) + " " + f1(NP.in[1]));
  trLymph = track([dcPos, [(dcPos[0] + NP.in[0]) / 2, (dcPos[1] + NP.in[1]) / 2], NP.in]);
  trNode = track([NP.in, NP.sinus, tPos]);
  const topP = clamp(vTop + 60, 120, 300), botP = clamp(vBot - 30, topP + 60, 400);
  glowCy = (topP + botP) / 2;
  const gl = $("infectGlow");
  gl.setAttribute("cx", f1(lumenX)); gl.setAttribute("cy", f1(glowCy));
  gl.setAttribute("rx", "100"); gl.setAttribute("ry", f1(clamp((botP - topP) / 2 + 28, 50, 110)));
  return { topP: topP, botP: botP };
}

/* ---- main cells, placed from the ports ---- */
let dcCell = null, presentG = null, thCell = null, follCirc = null, gcCirc = null;
const presentDots = [], bCells = [], plasma = [], memCells = [], paths = [], coats = [];
let topP0 = 190, botP0 = 330;
function initCells(geo) {
  topP0 = geo.topP; botP0 = geo.botP;
  dcCell = cell(L.stage, { cls: "dc", r: 26, nuc: 0.4, seed: 3, wob: 0.16 });
  presentG = mk("g", {}, L.stage);
  for (let j = 0; j < 8; j++) presentDots.push(mk("circle", { class: "present", cx: 0, cy: 0, r: 3 }, presentG));
  thCell = cell(L.stage, { cls: "th", r: 20, nuc: 0.45, seed: 7, wob: 0.12 });
  follCirc = mk("circle", { class: "foll", cx: f1(germPos[0]), cy: f1(germPos[1]), r: 56 }, L.stage);
  gcCirc = mk("circle", { class: "gc", cx: f1(germPos[0]), cy: f1(germPos[1]), r: 30 }, L.stage);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 6.283, x = germPos[0] + Math.cos(a) * 42, y = germPos[1] + Math.sin(a) * 42;
    const g = cell(L.stage, { cls: "bcell", r: 10, nuc: 0.5, seed: i + 5, wob: 0.12 });
    bCells.push({ g: g, x: x, y: y, i: i });
  }
  const pA = [clamp(lumenX - 95, 668, 860), clamp(vTop + 45, 110, 300)];
  const pB = [clamp(lumenX - 50, 668, 880), clamp(vTop + 25, 100, 280)];
  [pA, pB].forEach(([x, y], i) => {
    const g = cell(L.stage, { cls: "plasma", r: i ? 15 : 17, nuc: 0.38, seed: i + 21, wob: 0.1 });
    plasma.push({ g: g, x: x, y: y, i: i });
  });
  [[424, 374], [470, 380], [516, 380], [562, 374], [493, 362]].forEach(([x, y], i) => {
    const g = cell(L.stage, { cls: i % 2 ? "memt" : "memb", r: 13, nuc: 0.5, seed: i + 31, wob: 0.1 });
    memCells.push({ g: g, x: x, y: y, i: i });
  });
  const coatAt = [[-6, -3], [6, -3], [0, 4], [0, -5]];
  for (let i = 0; i < 12; i++) {
    const c = i % 4, r = Math.floor(i / 4);
    const bx = clamp(lumenX - 33 + c * 22, 676, 934), by = topP0 + (r / 2) * (botP0 - topP0);
    const g = mk("g", { class: "cl cl-bac" }, L.parts);
    mk("ellipse", { class: "cl-b", rx: 9, ry: 4.6 }, g);
    mk("circle", { class: "cl-h", r: 1.6, cx: -2.5, cy: -1.5 }, g);
    const marks = coatAt.map(([ox, oy]) => {
      const m = abShape(g, "ab-coat"); m.setAttribute("transform", "translate(" + ox + " " + oy + ") scale(0.8)"); m.setAttribute("opacity", "0"); return m;
    });
    paths.push({ g: g, bx: bx, by: by, x: bx, y: by, i: i, marks: marks }); coats.push(0);
  }
}

/* ---- particle pools ---- */
const ag = pool(20, () => mk("path", { class: "sc-p p-ag", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
const sig = pool(22, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, L.parts));
const sig2 = pool(22, () => mk("circle", { class: "sc-p p-cyt", r: 2.4 }, L.parts));
const abs = pool(26, () => abShape(L.parts));
const acc = { ag: 0, sig: 0, sig2: 0, ab: 0 };

/* ---- labels: eight at most, short; pathogen only on later exposure ---- */
let pathPill = null, capEl = null, capKey = "";
function capText(d, l) {
  if (l === 2 && d === 0) return "No vaccine. The pathogen multiplies while defence starts slowly.";
  if (d === 0) return l === 0 ? "No vaccine. Defence starts slowly from rare naive cells." : "No vaccine. Still no memory, so defence stays slow.";
  if (l === 2) return d === 1 ? "Memory answers fast. Antibody coats and shrinks the pathogen." : "Memory answers fast. Antibody coats and clears the pathogen.";
  if (l === 1) return "Booster strengthens memory. Antibody rises faster.";
  return d === 1 ? "Live vaccine trains defence. Memory cells form." : "Conjugate vaccine trains defence. Memory cells form.";
}
function initLabels() {
  const ox = L.over;
  const nodeTop = [nodeO.x, nodeO.y - nodeO.h / 2 + 8];
  pill(ox, "Skin", surfPos[0], surfPos[1], 80, 116, "The jab site. Vaccine antigen is deposited here and picked up by guard cells.");
  pill(ox, "Dendritic cell", dcPos[0], dcPos[1], 215, 96, "Guard cell. It picks up vaccine antigen and signals to the lymph node.");
  pill(ox, "T helper cell", tPos[0], tPos[1], 360, 96, "Helper cell. Once switched on it helps B cells form a germinal centre and memory.");
  pill(ox, "Lymph node", nodeTop[0], nodeTop[1], 520, 96, "Meeting place. Immune cells gather here, so rare matching cells can find each other.");
  pill(ox, "Antibody", lumenX - 10, glowCy - 50, 800, 96, "Antibody made by plasma cells. It coats the pathogen and marks it for clearance.");
  pill(ox, "Memory cells", 493, 372, 430, 392, "Memory cells. Left behind after vaccination, they answer faster and stronger next time.");
  pill(ox, "Germinal centre", germPos[0], germPos[1], 600, 392, "Training camp. B cells multiply here and refine antibody with T cell help.");
  pathPill = pill(ox, "Pathogen", lumenX + 20, glowCy + 30, 830, 392, "The real pathogen. Without memory it multiplies while defence starts slowly.");
  capEl = mk("text", { class: "va-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0, 0);
}

/* ---- gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The response";
  [["D", "Presentation", "g-dc", "Antigen taken up and presented by dendritic cells to helper T cells."], ["T", "T cell help", "g-th", "Activated helper T cells helping B cells and forming memory T cells."], ["G", "Germinal centre", "g-gc", "Germinal centre activity: B cells multiplying and refining antibody in the lymph node."], ["Ab", "Antibody", "g-ab", "Antibody secreted by plasma cells into the blood."], ["M", "Memory", "g-mem", "Long lived memory B and T cells left after vaccination, expanded by a booster."], ["Path", "Pathogen", "g-bad", "Real pathogen burden on later exposure. High without memory, controlled quickly when antibody returns fast."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { D: 0.2, T: 0.2, G: 0.2, Ab: 0.1, M: 0.1, Path: 0 };
function init() { const geo = initOrgans(); initCells(geo); initLabels(); initPanel(); }
function nearestPath(x, y) {
  let best = -1, bd = 1e9;
  paths.forEach((p, i) => { if (pathsOn <= i) return; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
  return best;
}
let pathsOn = 0;
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.D = lerp(sm.D, m.D, k); sm.T = lerp(sm.T, m.T, k); sm.G = lerp(sm.G, m.G, k); sm.Ab = lerp(sm.Ab, m.Ab, k); sm.M = lerp(sm.M, m.M, k2); sm.Path = lerp(sm.Path, m.Path, k);
  const vis = m.level === 2 ? sm.Path : 0;
  pathsOn = Math.round(vis * paths.length);
  place(dcCell, dcPos[0] + Math.sin(tm / 1500) * 3, dcPos[1] + Math.cos(tm / 1700) * 2.5, Math.sin(tm / 2400) * 5, 1);
  presentG.setAttribute("opacity", sm.D.toFixed(2));
  presentDots.forEach((d, j) => { const a = j / 8 * 6.283 + tm / 1800; d.setAttribute("cx", f1(dcPos[0] + Math.cos(a) * 28)); d.setAttribute("cy", f1(dcPos[1] + Math.sin(a) * 28)); });
  place(thCell, tPos[0] + Math.sin(tm / 1300) * 2, tPos[1] + Math.cos(tm / 1500) * 2, 0, 0.45 + 0.55 * sm.T);
  thCell.style.opacity = (0.35 + 0.65 * sm.T).toFixed(2);
  const gs = 0.55 + 0.6 * sm.G;
  gcCirc.setAttribute("transform", "translate(" + f1(germPos[0] * (1 - gs)) + " " + f1(germPos[1] * (1 - gs)) + ") scale(" + gs.toFixed(3) + ")");
  gcCirc.setAttribute("opacity", (0.3 + 0.7 * sm.G).toFixed(2));
  follCirc.setAttribute("opacity", (0.35 + 0.65 * Math.max(sm.G, 0.15)).toFixed(2));
  const bWant = Math.round(sm.G * bCells.length);
  bCells.forEach((b, i) => { const on = i < bWant; place(b.g, b.x + Math.sin(tm / 700 + i * 1.7) * 2.2, b.y + Math.cos(tm / 800 + i) * 2, 0, on ? 1 : 0.35); b.g.style.opacity = on ? "1" : "0.22"; });
  plasma.forEach((p, i) => { place(p.g, p.x, p.y + Math.sin(tm / 900 + i * 2) * 2, 0, 0.35 + 0.65 * sm.Ab); p.g.style.opacity = (0.3 + 0.7 * sm.Ab).toFixed(2); });
  const mWant = Math.round(sm.M * memCells.length);
  memCells.forEach((e2, i) => { const on = i < mWant; place(e2.g, e2.x, e2.y + Math.sin(tm / 1100 + i * 2.1) * 1.6, 0, on ? 1 : 0.3); e2.g.style.opacity = on ? "0.95" : "0.18"; });
  /* vaccine antigen to the dendritic cell, first dose and booster only */
  acc.ag += dt * (m.level < 2 && m.drug > 0 ? 2 + 5 * sm.D : 0);
  while (acc.ag >= 1) { acc.ag--; const p = freeP(ag); if (p) emit(p, clamp(surfPos[0] + rnd(-45, 45), 30, 300), clamp(surfPos[1] + rnd(-30, 30), 100, 400), 0, 0, 0); }
  ag.forEach((p) => { if (!p.on) return; const dx = dcPos[0] - p.x, dy = dcPos[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += dx / d * 44 * dt; p.y += dy / d * 44 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 30) kill(p); });
  /* signals: dendritic cell along the lymphatic vessel, then into the node to the T cell */
  acc.sig += dt * sm.D * sm.T * 9; while (acc.sig >= 1) { acc.sig--; const p = freeP(sig); if (p) { emit(p, dcPos[0], dcPos[1], 0, 0, 0); p.u = 0; p.st = 0; } }
  sig.forEach((p) => {
    if (!p.on) return;
    if (p.st === 0) { p.u += dt * 90 / trLymph.len; const q = trLymph.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { p.u = 0; p.st = 1; } }
    else { p.u += dt * 90 / trNode.len; const q = trNode.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) kill(p); }
  });
  /* help: T cell to the germinal centre */
  acc.sig2 += dt * sm.T * sm.G * 9; while (acc.sig2 >= 1) { acc.sig2--; const p = freeP(sig2); if (p) emit(p, tPos[0], tPos[1], 0, 0, 0); }
  sig2.forEach((p) => { if (!p.on) return; const dx = germPos[0] - p.x, dy = germPos[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += dx / d * 54 * dt; p.y += dy / d * 54 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 20) kill(p); });
  /* antibody from plasma cells; on later exposure it hunts the pathogen and coats it */
  const hunting = m.level === 2 && sm.Ab > 0.3;
  acc.ab += dt * sm.Ab * 9; while (acc.ab >= 1) { acc.ab--; const p = freeP(abs); if (p) { const src = plasma[Math.floor(Math.random() * plasma.length)]; emit(p, src.x + rnd(-8, 8), src.y + rnd(-6, 10), rnd(14, 34), rnd(-6, 16), 0); p.home = hunting; if (hunting) p.ti = nearestPath(p.x, p.y); } }
  abs.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.home && p.ti > -1 && p.ti < pathsOn) {
      const t = paths[p.ti], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.x += dx / d * 100 * dt; p.y += dy / d * 100 * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 350 + p.y) * 20) + ")");
      if (d < 14) { coats[p.ti] = Math.min(1, coats[p.ti] + 0.34); kill(p); return; }
      if (p.t > 6) { kill(p); return; }
    } else {
      p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 400 + p.x) * 0.15; p.x = clamp(p.x, 676, 934); p.y = clamp(p.y, 58, 428);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 350 + p.y) * 20) + ")");
      p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.6).toFixed(2)); if (p.t > 5.6 || p.x >= 934) kill(p); return;
    }
  });
  /* real pathogen on later exposure only; coated ones shrink and fade */
  const coatT = m.level === 2 ? clamp(sm.Ab * 1.25 - 0.1, 0, 1) : 0;
  let coatSum = 0;
  paths.forEach((p, i) => {
    if (i >= pathsOn || vis <= 0.04) { p.g.setAttribute("opacity", "0"); return; }
    coats[i] = lerp(coats[i], Math.max(coats[i] * (1 - dt * 0.05), coatT), Math.min(1, dt * 0.8));
    const c = coats[i]; coatSum += c;
    const calm = 1 - 0.6 * c;
    p.x = p.bx + Math.sin(tm / 800 + i * 1.9) * 4 * calm; p.y = p.by + Math.cos(tm / 950 + i) * 3 * calm;
    const sc = Math.max(0.15, (0.4 + 0.6 * vis) * (1 - 0.55 * c));
    p.g.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(Math.sin(tm / 600 + i) * 24 * calm) + ") scale(" + sc.toFixed(3) + ")");
    p.g.setAttribute("opacity", clamp(vis * (1 - 0.4 * c), 0.12, 1).toFixed(2));
    p.marks.forEach((mk2, j) => mk2.setAttribute("opacity", c * 4 > j ? "0.95" : "0"));
  });
  $("infectGlow").setAttribute("opacity", pathsOn ? clamp(vis * (1 - 0.6 * (coatSum / Math.max(1, pathsOn))), 0, 1).toFixed(2) : "0");
  pathPill.style.display = m.level === 2 ? "" : "none";
  gg.D.set(sm.D, wordOf(sm.D, 0.25, 0.55, ["quiet", "active", "strong"])); gg.T.set(sm.T, wordOf(sm.T, 0.25, 0.55, ["few", "active", "many"]));
  gg.G.set(sm.G, wordOf(sm.G, 0.25, 0.55, ["quiet", "active", "busy"])); gg.Ab.set(sm.Ab, wordOf(sm.Ab, 0.25, 0.55, ["low", "rising", "high"]));
  gg.M.set(sm.M, wordOf(sm.M, 0.25, 0.55, ["few", "forming", "many"])); gg.Path.set(sm.Path, wordOf(sm.Path, 0.25, 0.55, ["none", "present", "high"]));
  const ck = m.drug * 10 + m.level;
  if (ck !== capKey) { capKey = ck; const t = capText(m.drug, m.level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
