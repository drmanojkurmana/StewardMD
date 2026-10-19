/* Rheumatoid arthritis scene: lymph node immune attack, cytokine vessel, knee joint pannus and erosion. */
const LY = { cells: $("cells"), parts: $("parts"), pannus: $("pannus"), notches: $("notches"), over: $("over"), panel: $("panel"), glow: $("jointGlow"), synL: $("synL"), synR: $("synR"), cart: $("cartBar"), vessel: $("cytoVessel") };
let nodeO = null, jointO = null, J = [657, 262], vesMid = [380, 290];
let vesTr = null;
const blockers = [];
let apcBase = [120, 210], tBase = [140, 290], bBase = [191, 244];
let macBases = [], osteoBase = [755, 320], panPts = [], notchPts = [], cartEnd = [710, 262];
let capEl = null, capKey = "";
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, trap: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.trap = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent, cls) { const g = mk("g", {}, parent); mk("path", { class: cls, d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }
function capShape(parent) { const g = mk("g", {}, parent); mk("rect", { class: "rx-cap", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "rx-cap2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; }

function initOrgans() {
  nodeO = organ($("nodeSlot"), "lymphnode", 150, 235, 185, {});
  jointO = organ($("jointSlot"), "joint", 655, 240, 280, {});
  J = jointO.ports.joint;
  const S = nodeO.ports.hilum, E = [Math.round(jointO.x - 140), Math.round(jointO.y + 40)];
  LY.vessel.setAttribute("d", "M" + f1(S[0]) + " " + f1(S[1]) + " C" + f1(S[0] + 110) + " " + f1(S[1] - 4) + " " + f1(E[0] - 110) + " " + f1(E[1] - 16) + " " + f1(E[0]) + " " + f1(E[1]));
  vesTr = track([S, [S[0] + 110, S[1] - 4], [E[0] - 110, E[1] - 16], E]);
  const qm = vesTr.at(0.6); vesMid = [qm.x, qm.y];
  LY.glow.setAttribute("cx", f1(J[0])); LY.glow.setAttribute("cy", f1(J[1]));
  LY.synL.setAttribute("y", f1(J[1] - 82)); LY.synL.setAttribute("height", "150");
  LY.synR.setAttribute("y", f1(J[1] - 82)); LY.synR.setAttribute("height", "150");
  LY.cart.setAttribute("x", f1(J[0] - 55)); LY.cart.setAttribute("y", f1(J[1] - 4));
  cartEnd = [J[0] + 55, J[1]];
  panPts = [[J[0] - 72, J[1] - 10], [J[0] + 72, J[1] - 10], [J[0], J[1] - 18]];
  notchPts = [[J[0] - 100, J[1] + 45], [J[0] + 100, J[1] + 45]];
  apcBase = nodeO.ports.follicle; tBase = nodeO.ports.paracortex; bBase = nodeO.ports.germ;
  macBases = [[J[0] - 100, J[1] - 30], [J[0] + 100, J[1] - 42]];
  osteoBase = [J[0] + 100, J[1] + 58];
  [0.42, 0.56, 0.7].forEach((u, i) => {
    const q = vesTr.at(u), nx = -Math.sin(q.a / 57.2958), ny = Math.cos(q.a / 57.2958), s = i % 2 ? 13 : -13;
    const g = abShape(LY.parts, "ab-bl"); g.setAttribute("opacity", "0");
    blockers.push({ g, x: q.x + nx * s, y: q.y + ny * s });
  });
}

/* ---- cells, pannus, notches ---- */
let apcG = null, tG = null, bG = null, osteoG = null;
const macs = [];
const pans = [];
const notches = [];
function initCells() {
  apcG = mk("g", {}, LY.cells); cell(apcG, { cls: "mac", r: 24, nuc: 0.4, seed: 3, wob: 0.15 });
  tG = mk("g", {}, LY.cells); cell(tG, { cls: "lymph", r: 20, nuc: 0.5, seed: 7, wob: 0.1 });
  bG = mk("g", {}, LY.cells); cell(bG, { cls: "bcell", r: 20, nuc: 0.45, seed: 11, wob: 0.1 });
  macBases.forEach(([x, y], i) => { const g = mk("g", {}, LY.cells); cell(g, { cls: "mac", r: 13, nuc: 0.4, seed: 20 + i, wob: 0.14 }); macs.push({ g, x, y }); });
  osteoG = mk("g", {}, LY.cells); cell(osteoG, { cls: "mast", r: 16, nuc: 0.3, seed: 31, wob: 0.16 });
  [[-6, -3], [5, 2], [-1, 6]].forEach(([x, y]) => mk("circle", { class: "cl-n", cx: x, cy: y, r: 3 }, osteoG));
  panPts.forEach(([x, y], i) => { const g = mk("g", {}, LY.pannus); mk("path", { class: "ra-pan", d: blobD(20, i * 2 + 1, 0.28, 8) }, g); pans.push({ g, x, y }); });
  notchPts.forEach(([x, y]) => { notches.push({ e: mk("circle", { class: "ra-notch", cx: f1(x), cy: f1(y), r: 9 }, LY.notches), x, y }); });
}

/* ---- particles ---- */
const abs = pool(12, () => abShape(LY.parts, "ab-p"));
const tnfs = pool(36, () => mk("circle", { class: "sc-p p-tnf", r: 2.5 }, LY.parts));
const il6s = pool(28, () => mk("rect", { class: "sc-p p-il6", x: -2.2, y: -2.2, width: 4.4, height: 4.4, rx: 1 }, LY.parts));
const enzs = pool(20, () => mk("circle", { class: "sc-p p-enz", r: 1.9 }, LY.parts));
const dmCaps = pool(10, () => capShape(LY.parts));
const stCaps = pool(10, () => capShape(LY.parts));

function capText(l, d) {
  const lv = ["Early disease. ", "Established disease. ", "Advanced disease. "][l];
  if (d === 1) return lv + "DMARD calms the immune cells. Less swelling and slower joint damage.";
  if (d === 2) return lv + "Steroid cools swelling fast, but pannus keeps eating the joint.";
  if (d === 3) return lv + "TNF blocker traps TNF in the blood. Pannus shrinks and bone loss slows.";
  return lv + "No treatment. Immune attack swells the joint and pannus eats bone.";
}

/* ---- labels ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The joint";
  [["imm", "Immune activity", "g-imm", "How strongly the lymph node T cells, B cells and presenting cells drive the autoimmune attack."], ["cyt", "Cytokines", "g-cyt", "TNF and IL-6 travelling in blood to the joint. They drive the inflammation."], ["pan", "Pannus", "g-pan", "Invasive synovial tissue that grows over cartilage and into bone. This is what destroys the joint."], ["dmg", "Joint damage", "g-bad", "Cartilage loss and bone erosion. Once lost, cartilage and bone do not grow back in this figure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 200 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Immune cells", nodeO.x - 30, nodeO.y - 25, 110, 105, "Immune cells in a lymph node. They lose tolerance to self and switch on the attack.");
  pill(ox, "Autoantibodies", bBase[0], bBase[1], 280, 105, "Autoantibodies such as rheumatoid factor. They mark the attack and help sustain it.");
  pill(ox, "TNF and IL-6", vesMid[0], vesMid[1], 420, 105, "TNF and IL-6 travel in blood to the joint. TNF drives pannus growth and bone loss.");
  pill(ox, "Synovium", J[0] - 102, J[1] - 60, 560, 105, "Synovium, the joint lining. It thickens with immune cells and new vessels.");
  pill(ox, "Pannus", J[0] + 72, J[1] - 10, 795, 180, "Pannus, invasive lining tissue. It creeps over cartilage and releases enzymes.");
  pill(ox, "Cartilage", J[0] + 55, J[1], 830, 300, "Cartilage, the smooth cap on bone. Enzymes digest it until bone lies bare.");
  pill(ox, "Bone erosion", J[0] + 100, J[1] + 45, 770, 375, "Bone erosion. Osteoclasts switched on by cytokines eat into the bone.");
  capEl = mk("text", { class: "ra-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { A: 0.5, C: 0.4, Tnf: 0.4, Il6: 0.4, P: 0.3, E: 0.3, dmard: 0, steroid: 0, tnfBlock: 0 };
const acc = { ab: 0, tnf: 0, il6: 0, enz: 0, dm: 0, st: 0 };
function init() { initOrgans(); initCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.2), k2 = Math.min(1, dt * 1.6);
  sm.A = lerp(sm.A, m.A, k); sm.C = lerp(sm.C, m.C, k); sm.Tnf = lerp(sm.Tnf, m.Tnf, k); sm.Il6 = lerp(sm.Il6, m.Il6, k);
  sm.P = lerp(sm.P, m.P, k); sm.E = lerp(sm.E, m.E, k);
  sm.dmard = lerp(sm.dmard, m.dmard, k2); sm.steroid = lerp(sm.steroid, m.steroid, k2); sm.tnfBlock = lerp(sm.tnfBlock, m.tnfBlock, k2);
  const I = clamp(0.12 + 0.8 * sm.C + 0.1 * sm.A);
  /* lymph node cells bob and swell with immune activity */
  place(apcG, apcBase[0] + Math.sin(tm / 1500) * 3, apcBase[1] + Math.cos(tm / 1700) * 2, 0, 0.75 + 0.45 * sm.A);
  place(tG, tBase[0] + Math.sin(tm / 1300 + 2) * 3, tBase[1], 0, 0.75 + 0.45 * sm.A);
  place(bG, bBase[0], bBase[1] + Math.cos(tm / 1400) * 2, 0, 0.75 + 0.45 * sm.A);
  macs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 900 + i * 2) * 2, 0, 0.7 + 0.5 * sm.C));
  /* synovium thickens, joint glows, cartilage thins */
  const sw = 6 + 16 * I;
  LY.synL.setAttribute("x", f1(J[0] - 102 - sw / 2)); LY.synL.setAttribute("width", f1(sw)); LY.synL.setAttribute("opacity", (0.2 + 0.4 * sm.C).toFixed(2));
  LY.synR.setAttribute("x", f1(J[0] + 102 - sw / 2)); LY.synR.setAttribute("width", f1(sw)); LY.synR.setAttribute("opacity", (0.2 + 0.4 * sm.C).toFixed(2));
  LY.glow.setAttribute("opacity", (0.3 * sm.C).toFixed(2));
  const ch = 3 + 7 * (1 - sm.E);
  LY.cart.setAttribute("height", f1(ch)); LY.cart.setAttribute("y", f1(J[1] - ch / 2));
  /* pannus creeps, notches deepen, osteoclast works */
  pans.forEach((p) => { place(p.g, p.x, p.y, 0, 0.25 + 0.95 * sm.P); p.g.style.opacity = (0.2 + 0.8 * sm.P).toFixed(2); });
  notches.forEach((n) => { n.e.setAttribute("transform", "translate(" + f1(n.x) + " " + f1(n.y) + ") scale(" + f1(Math.max(0.05, sm.E)) + ") translate(" + f1(-n.x) + " " + f1(-n.y) + ")"); n.e.setAttribute("opacity", sm.E.toFixed(2)); });
  place(osteoG, osteoBase[0], osteoBase[1] + Math.sin(tm / 700) * 1.5, 0, 0.4 + 0.8 * sm.E); osteoG.style.opacity = (0.25 + 0.75 * sm.E).toFixed(2);
  /* TNF blocker Y shapes sit across the cytokine stream and trap TNF dots */
  blockers.forEach((b, i) => { place(b.g, b.x, b.y + Math.sin(tm / 800 + i) * 1.5, Math.sin(tm / 1000 + i * 2) * 8, 1); b.g.setAttribute("opacity", sm.tnfBlock.toFixed(2)); });
  /* autoantibodies: B cell toward the joint */
  acc.ab += dt * sm.A * 3.2; while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) emit(p, bBase[0] + rnd(-6, 6), bBase[1] + rnd(-6, 6), 26, -2, 0); }
  abs.forEach((p) => { if (!p.on) return; p.t += dt; const dx = J[0] - p.x, dy = J[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (p.vx + (dx / d) * 20) * dt; p.y += (p.vy + (dy / d) * 20) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 40 || p.t > 8) kill(p); });
  /* cytokines: TNF circles and IL-6 squares leave the node and home on the joint */
  const S = nodeO.ports.hilum;
  acc.tnf += dt * sm.Tnf * 11; while (acc.tnf >= 1) { acc.tnf--; const p = free(tnfs); if (p) emit(p, S[0] + rnd(-8, 8), S[1] + rnd(-8, 8), rnd(6, 20), rnd(-8, 8), 0); }
  acc.il6 += dt * sm.Il6 * 8; while (acc.il6 >= 1) { acc.il6--; const p = free(il6s); if (p) emit(p, S[0] + rnd(-8, 8), S[1] + rnd(-8, 8), rnd(6, 18), rnd(-8, 8), 0); }
  tnfs.forEach((p) => {
    if (!p.on) return;
    if (p.trap > 0) { p.trap -= dt; p.e.setAttribute("opacity", Math.max(0, p.trap * 1.4).toFixed(2)); if (p.trap <= 0) kill(p); return; }
    p.t += dt; const dx = J[0] - p.x, dy = J[1] - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (p.vx + (dx / d) * 22) * dt; p.y += (p.vy + (dy / d) * 22) * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (sm.tnfBlock > 0.4) { for (const b of blockers) { const ex = p.x - b.x, ey = p.y - b.y; if (ex * ex + ey * ey < 240) { p.trap = 0.7; break; } } }
    if (d < 34 || p.t > 8) kill(p);
  });
  il6s.forEach((p) => { if (!p.on) return; p.t += dt; const dx = J[0] - p.x, dy = J[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (p.vx + (dx / d) * 22) * dt; p.y += (p.vy + (dy / d) * 22) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 34 || p.t > 8) kill(p); });
  /* enzymes from pannus toward cartilage */
  acc.enz += dt * sm.P * sm.E * 9; while (acc.enz >= 1) { acc.enz--; const p = free(enzs), s = pick(panPts); if (p) emit(p, s[0], s[1], (cartEnd[0] - s[0]) * 0.12, (cartEnd[1] - s[1]) * 0.12, 0); }
  enzs.forEach((p) => { if (!p.on) return; p.t += dt; const dx = cartEnd[0] - p.x, dy = cartEnd[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (p.vx + (dx / d) * 14) * dt; p.y += (p.vy + (dy / d) * 14) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 12 || p.t > 4) kill(p); });
  /* drug capsules: DMARD into the node, steroid into the joint */
  acc.dm += dt * sm.dmard * 7; while (acc.dm >= 1) { acc.dm--; const p = free(dmCaps); if (p) emit(p, 70 + rnd(-8, 8), 100 + rnd(-6, 6), 20, 14, 0); }
  dmCaps.forEach((p) => { if (!p.on) return; p.t += dt; const dx = nodeO.x - p.x, dy = nodeO.y - p.y, d = Math.hypot(dx, dy) || 1; p.x += (p.vx + (dx / d) * 60) * dt; p.y += (p.vy + (dy / d) * 60) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (d < 26 || p.t > 6) kill(p); });
  acc.st += dt * sm.steroid * 7; while (acc.st >= 1) { acc.st--; const p = free(stCaps); if (p) emit(p, 480 + rnd(-8, 8), 95 + rnd(-6, 6), 8, 22, 0); }
  stCaps.forEach((p) => { if (!p.on) return; p.t += dt; const dx = J[0] - p.x, dy = J[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (p.vx + (dx / d) * 60) * dt; p.y += (p.vy + (dy / d) * 60) * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (d < 28 || p.t > 6) kill(p); });
  /* gauges and caption */
  gg.imm.set(sm.A, wordOf(sm.A, 0.3, 0.6, ["low", "moderate", "high"])); gg.cyt.set(sm.C, wordOf(sm.C, 0.3, 0.6, ["low", "moderate", "high"]));
  gg.pan.set(sm.P, wordOf(sm.P, 0.45, 0.7, ["small", "growing", "extensive"])); gg.dmg.set(sm.E, wordOf(sm.E, 0.3, 0.7, ["little", "moderate", "severe"]));
  const ck = level + ":" + drug; if (ck !== capKey) { capKey = ck; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
