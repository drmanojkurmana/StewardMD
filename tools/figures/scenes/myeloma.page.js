/* Myeloma scene: plasma cell clone, paraprotein, light chains, bone resorption, kidney casts, marrow failure and gauges. */
const WW = SC.W;
const layers = { clone: $("clone"), norm: $("norm"), osteo: $("osteo"), holes: $("holes"), kidneyFx: $("kidneyFx"), rbcs: $("rbcs"), bloodW: $("bloodW"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- clone plasma cells in the marrow ---- */
const cloneCells = [];
function initClone() { for (let i = 0; i < 28; i++) { const g = cell(layers.clone, { cls: "plasma", r: 16, nuc: 0.52, seed: i * 1.7 + 1, wob: 0.1 });
  mk("circle", { class: "cl-h", r: 3.2, cx: 5, cy: -4 }, g);
  cloneCells.push({ g, x: 72 + (i % 7) * 56 + ((Math.floor(i / 7) % 2) ? 14 : 0), y: 126 + Math.floor(i / 7) * 38, ph: i * 1.3 }); } }
/* ---- normal marrow cells that get crowded out ---- */
const normCells = [];
function initNorm() { for (let i = 0; i < 12; i++) { const red = i % 2 === 0; const g = cell(layers.norm, { cls: red ? "normr" : "normn", r: red ? 9 : 10, nuc: red ? 0 : 0.5, nucCls: red ? "" : "multi", seed: i * 2.1 + 3, wob: 0.12 });
  normCells.push({ g, x: 50 + i * 36, y: 272, ph: i }); } }
/* ---- osteoclasts and lytic holes in the bone ---- */
const osteos = [[560, 168], [642, 208], [566, 244]].map(([x, y], i) => { const g = cell(layers.osteo, { cls: "osteo", r: 15, nuc: 0.4, seed: i * 3 + 2, wob: 0.16 }); return { g, x, y, ph: i * 2 }; });
const holePos = [[600, 148], [592, 188], [606, 224], [600, 258], [596, 128]];
const holes = holePos.map(([x, y]) => mk("ellipse", { class: "mm-hole", cx: x, cy: y, rx: 13, ry: 10 }, layers.holes));
/* ---- kidney casts ---- */
const castPos = [[812, 168], [836, 176], [860, 168], [820, 208], [848, 214], [832, 150]];
const casts = castPos.map(([x, y]) => { const g = mk("g", {}, layers.kidneyFx); mk("rect", { class: "mm-cast", x: -9, y: -3.4, width: 18, height: 6.8, rx: 3.4 }, g); g.setAttribute("transform", "translate(" + x + " " + y + ")"); return g; });
/* ---- blood cells ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-24, 24), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
const neus = [];
function initNeu() { for (let i = 0; i < 5; i++) { const g = cell(layers.bloodW, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 20, wob: 0.14 }); neus.push({ g, x: rnd(0, WW), y: 362 + (i % 3) * 18, v: rnd(0.5, 0.8) }); } }
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const paras = pool(26, () => mk("path", { class: "p-para", d: "M0 2L0 -5M0 -1L-4 -6M0 -1L4 -6" }, layers.parts));
const lights = pool(14, () => mk("circle", { class: "sc-p p-light", r: 2.6 }, layers.parts));
const cals = pool(14, () => mk("circle", { class: "sc-p p-ca", r: 2.6 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["clone", "Clone", "g-clone", "How much of the marrow the malignant plasma cell clone takes up."], ["para", "Paraprotein", "g-para", "The single monoclonal antibody made by the clone. High levels track clone burden."], ["ca", "Calcium", "g-ca", "Calcium released from bone as resorption breaks bone down. High calcium is the C of CRAB."], ["kid", "Kidney", "g-bad", "Kidney injury from free light chains in the tubules. This is the R of CRAB."], ["red", "Red cells", "g-good", "Red cells fall when the clone crowds the marrow, causing anaemia. This is the A of CRAB."], ["def", "Defence", "g-good", "Normal antibody and white cell defence. When it falls, infection risk rises."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Plasma clone", 180, 172, 170, 96, "Malignant plasma cells: one clone expands in the marrow and crowds out normal blood cell production.");
  pill(ox, "Bone holes", 600, 188, 601, 92, "Osteolytic lesions: the clone stirs osteoclasts to resorb bone, leaving holes and weakening the bone. This is the B of CRAB.");
  pill(ox, "Light chains", 836, 182, 836, 92, "Free light chains made by the clone pass into kidney tubules, where they can form casts and injure the kidney.");
  pill(ox, "Paraprotein", 430, 380, 400, 324, "Paraprotein: the monoclonal antibody made by the clone, carried in the blood. It can thicken blood and suppress normal antibodies.");
  pill(ox, "Calcium", 620, 362, 620, 324, "Calcium released from resorbed bone into the blood. High calcium causes thirst, confusion and kidney strain.");
  pill(ox, "Anaemia", 220, 380, 200, 428, "Anaemia: too few red cells because the clone crowds the marrow. It causes tiredness and breathlessness.");
  pill(ox, "Infection risk", 740, 380, 760, 428, "Infection risk: normal antibodies and white cells fall as the clone takes over, so infections are more likely and more severe.");
}
const sm = { clone: 0.5, para: 0.5, Ca: 0.3, K: 0.3, red: 0.6, def: 0.6, bone: 0.3, boneAct: 0.3, pi: 0, bis: 0, sup: 0 };
const acc = { para: 0, light: 0, ca: 0, cap: 0 };
function init() { initClone(); initNorm(); initRbc(); initNeu(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.clone = lerp(sm.clone, m.clone, k2); sm.para = lerp(sm.para, m.para, k2); sm.Ca = lerp(sm.Ca, m.Ca, k2); sm.K = lerp(sm.K, m.K, k2);
  sm.red = lerp(sm.red, m.red, k1); sm.def = lerp(sm.def, m.def, k1); sm.bone = lerp(sm.bone, m.boneBurden, k2); sm.boneAct = lerp(sm.boneAct, m.boneAct, k2);
  sm.pi = lerp(sm.pi, m.pi, k1); sm.bis = lerp(sm.bis, m.bis, k1); sm.sup = lerp(sm.sup, m.sup, k1);
  /* clone grows, normal marrow shrinks */
  const wantC = Math.round(sm.clone * cloneCells.length);
  cloneCells.forEach((c, i) => { const s = i < wantC ? 1 : 0.001; place(c.g, c.x + Math.sin(tm / 1500 + c.ph) * 2, c.y + Math.cos(tm / 1800 + c.ph) * 1.6, Math.sin(tm / 2600 + c.ph) * 5, s * (1 + 0.04 * Math.sin(tm / 400 + i))); c.g.style.opacity = i < wantC ? 1 : 0; });
  const wantN = Math.round((1 - sm.clone * 0.82) * normCells.length);
  normCells.forEach((c, i) => { place(c.g, c.x, c.y, 0, i < wantN ? 1 : 0.001); c.g.style.opacity = i < wantN ? 1 : 0; });
  /* osteoclasts work on bone, holes open with burden */
  osteos.forEach((o, i) => { place(o.g, o.x, o.y, Math.sin(tm / 900 + o.ph) * 8, 0.4 + 0.6 * sm.boneAct); o.g.style.opacity = sm.boneAct > 0.08 ? 1 : 0; });
  holes.forEach((hl, i) => { const s = clamp((sm.bone - i * 0.09) * 1.7); hl.setAttribute("rx", f1(3 + 10 * s)); hl.setAttribute("ry", f1(2.4 + 7.6 * s)); hl.setAttribute("opacity", s > 0.04 ? "1" : "0"); });
  /* kidney casts build with injury */
  casts.forEach((g, i) => { const s = clamp((sm.K - i * 0.08) * 1.6); g.style.opacity = s > 0.05 ? 1 : 0; place(g, castPos[i][0], castPos[i][1], 0, Math.max(0.001, s)); });
  /* paraprotein drifts in the blood from left to right */
  acc.para += dt * sm.para * 7; while (acc.para >= 1) { acc.para--; const p = free(paras); if (p) emit(p, rnd(30, 120), rnd(356, 404), rnd(52, 78), rnd(-4, 4), 0); }
  paras.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(tm / 500 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW - 20) kill(p); });
  /* light chains travel down kidney tubules */
  acc.light += dt * sm.para * 5; while (acc.light >= 1) { acc.light--; const p = free(lights); if (p) emit(p, pick([812, 836, 860]) + rnd(-3, 3), 128, rnd(-2, 2), rnd(22, 34), 0); }
  lights.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 244) kill(p); });
  /* calcium leaves bone and enters the blood below */
  acc.ca += dt * sm.Ca * 5; while (acc.ca >= 1) { acc.ca--; const p = free(cals); if (p) emit(p, rnd(578, 624), rnd(258, 276), rnd(-5, 5), rnd(30, 46), 0); }
  cals.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.y > 400 ? clamp(1 - (p.y - 400) / 30).toFixed(2) : "1"); if (p.y > 428) kill(p); });
  /* proteasome inhibitor capsules drift to the clone */
  acc.cap += dt * sm.pi * 2.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(36, 90), rnd(348, 370), 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (190 - p.x) * dt * 0.45 + 14 * dt; p.y += (168 - p.y) * dt * 0.55; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* bisphosphonate and support show as a calmer bone and fuller blood */
  osteos.forEach((o) => { o.g.style.opacity = sm.bis > 0.4 && sm.boneAct < 0.3 ? (0.35 * sm.boneAct + 0.2).toFixed(2) : o.g.style.opacity; });
  /* blood flow */
  const flow = clamp(0.3 + 0.8 * sm.red);
  const wantR = Math.round(sm.red * rbcs.length);
  rbcs.forEach((r, i) => { r.x += r.v * 62 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-24, 24); } place(r.g, r.x, 380 + r.y, r.rot, 1); r.g.style.opacity = i < wantR ? 1 : 0; });
  const wantW = Math.round(sm.def * neus.length);
  neus.forEach((n, i) => { n.x += n.v * 46 * flow * dt; if (n.x > WW + 12) n.x = -12; place(n.g, n.x, n.y + Math.sin(tm / 600 + i) * 2, 0, 1); n.g.style.opacity = i < wantW ? 1 : 0; });
  /* gauges: kidney and infection gauges show injury and risk, so they rise as things worsen */
  gg.clone.set(sm.clone, wordOf(sm.clone, 0.3, 0.62, ["small", "growing", "large"])); gg.para.set(sm.para, wordOf(sm.para, 0.3, 0.62, ["low", "raised", "high"]));
  gg.ca.set(sm.Ca, wordOf(sm.Ca, 0.3, 0.6, ["normal", "raised", "high"])); gg.kid.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["clear", "stressed", "injured"]));
  gg.red.set(sm.red, wordOf(sm.red, 0.4, 0.68, ["low", "reduced", "ok"])); gg.def.set(sm.def, wordOf(sm.def, 0.4, 0.68, ["low", "reduced", "ok"]));
}
run({ init, step });
