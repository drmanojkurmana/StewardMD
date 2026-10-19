/* Systemic lupus scene: loss of tolerance, ANA, immune complexes, complement use, organ deposition and drug actions. */
const LY = { cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel"), heat: $("vesselHeat") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, c: null, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tx: 0, ty: 0, tr: null }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function abShape(parent) { const g = mk("g", {}, parent); mk("path", { class: "ab-p", d: "M0 7L0 0M0 0L-5 -6M0 0L5 -6" }, g); return g; }
function cplxShape(parent) { const g = mk("g", {}, parent); mk("circle", { class: "sc-p p-cplx", r: 3.4, cx: -2, cy: 0 }, g); mk("circle", { class: "sc-p p-comp", r: 2.4, cx: 3, cy: -2 }, g); mk("path", { class: "ab-p", d: "M1 5L1 0M1 0L-2 -4M1 0L4 -4" }, g); return g; }

/* ---- cells (positions set in step) ---- */
const dmgG = mk("g", {}, LY.cells); cell(dmgG, { cls: "endo", r: 20, nuc: 0.52, seed: 4, wob: 0.2 });
mk("circle", { class: "sc-p p-ag", r: 2.2, cx: -7, cy: -5 }, dmgG); mk("circle", { class: "sc-p p-ag", r: 1.8, cx: 6, cy: 4 }, dmgG);
const tG = mk("g", {}, LY.cells); cell(tG, { cls: "lymph", r: 22, nuc: 0.5, seed: 7, wob: 0.1 });
const bG = mk("g", {}, LY.cells); cell(bG, { cls: "bcell", r: 22, nuc: 0.45, seed: 11, wob: 0.1 });
const compDots = [];
const bloodCells = [];

/* ---- organs, filled in initOrgans from real anatomy art ---- */
let skinO = null, jointO = null, kidneyO = null;
let depTargets = [[160, 378], [470, 378], [770, 378]], kidneyP = [770, 400];
let glows = [], shields = [], shieldR = [], rash = [], effu = null;
let agT = null, helpT = null, abT = null, vesT = null;
const hcqSlots = [[150, 175], [164, 175], [178, 175], [192, 175], [206, 175], [312, 175], [334, 175], [356, 175]];
let sterSlots = [];
const immSlots = [];
[0, 60, 120, 180, 240, 300].forEach((a) => immSlots.push([405 + 27 * Math.cos(a * 0.01745), 175 + 27 * Math.sin(a * 0.01745)]));
[45, 135, 225, 315].forEach((a) => immSlots.push([250 + 27 * Math.cos(a * 0.01745), 175 + 27 * Math.sin(a * 0.01745)]));

/* ---- particles ---- */
const ags = pool(10, () => mk("path", { class: "sc-p p-ag", d: "M0 -3L3 0L0 3L-3 0Z" }, LY.parts));
const helps = pool(8, () => mk("circle", { class: "sc-p p-help", r: 2.6 }, LY.parts));
const abs = pool(14, () => abShape(LY.parts));
const cplxs = pool(18, () => cplxShape(LY.parts));
const comps = pool(14, () => mk("circle", { class: "sc-p p-comp", r: 2.6 }, LY.parts));
const deps = pool(16, () => mk("circle", { class: "sc-p p-cplx", r: 2.4 }, LY.parts));
const leaks = pool(8, () => mk("circle", { class: "sc-p p-leak", r: 2.2 }, LY.parts));
const drugP = pool(16, () => { const g = mk("g", {}, LY.parts); mk("circle", { class: "sc-p p-hcq", r: 4 }, g); return g; });
drugP.forEach((p) => { p.c = p.e.firstChild; });

function capText(d) {
  if (d === 1) return "Hydroxychloroquine calms the trigger. Fewer antibodies, calmer organs.";
  if (d === 2) return "Steroid cools the organs fast, while complexes linger in blood.";
  if (d === 3) return "Immunosuppressant damps B and T cells. Antibodies and damage fall.";
  return "No treatment. Antibody complexes deposit in skin, joints and kidneys.";
}

/* ---- labels and gauges ---- */
const gg = {};
let capEl = null, lastDrug = -1;
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 160, 378, 92, {});
  jointO = organ($("jointSlot"), "joint", 470, 378, 96, {});
  kidneyO = organ($("kidneySlot"), "kidney", 770, 378, 84, {});
  depTargets = [skinO.ports.dermis, jointO.ports.joint, kidneyO.ports.cortex];
  kidneyP = kidneyO.ports.pelvis;
  [skinO, jointO, kidneyO].forEach((o) => {
    const gl = mk("ellipse", { class: "sle-glow", cx: f1(o.x), cy: f1(o.y), rx: f1(o.w / 2 + 8), ry: f1(o.h / 2 + 8), opacity: "0" }, LY.cells);
    glows.push(gl);
    const r = Math.max(o.w, o.h) / 2 + 14;
    shieldR.push(r);
    const sh = mk("circle", { class: "sle-shield", cx: f1(o.x), cy: f1(o.y), r: f1(r), opacity: "1", "fill-opacity": "0", "stroke-opacity": "0" }, LY.cells);
    shields.push(sh);
  });
  for (let i = 0; i < 3; i++) [-90, 30, 150].forEach((a, j) => {
    const o = [skinO, jointO, kidneyO][i], r = shieldR[i];
    sterSlots.push([o.x + r * Math.cos(a * 0.01745), o.y + r * Math.sin(a * 0.01745)]);
  });
  const sd = skinO.ports.dermis;
  [[-14, -4], [0, -9], [14, -4], [6, 7]].forEach(([dx, dy]) => {
    rash.push(mk("circle", { class: "sle-rash", cx: f1(sd[0] + dx), cy: f1(sd[1] + dy), r: 3, opacity: "0" }, LY.cells));
  });
  const jj = jointO.ports.joint;
  effu = mk("ellipse", { class: "sle-fluid", cx: f1(jj[0]), cy: f1(jj[1] + 4), rx: 16, ry: 7, opacity: "0" }, LY.cells);
  agT = track([[116, 175], [228, 175]]);
  helpT = track([[274, 175], [381, 175]]);
  abT = track([[405, 199], [414, 227], [425, 253]]);
  vesT = track([[24, 280], [936, 280]]);
}
function initCells() {
  for (let i = 0; i < 7; i++) compDots.push(mk("circle", { class: "sc-p p-comp", r: 3.4, cx: 600 + (i % 4) * 18, cy: 158 + Math.floor(i / 4) * 18 }, LY.cells));
  for (let i = 0; i < 6; i++) { const g = mk("g", { class: "cl cl-rbc" }, LY.cells); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); bloodCells.push({ g, x: 640 + i * 45, y: 266 + (i % 2) * 26, rbc: true }); }
  for (let i = 0; i < 2; i++) { const g = mk("g", {}, LY.cells); cell(g, { cls: "lymph", r: 8, nuc: 0.5, seed: 30 + i, wob: 0.12 }); bloodCells.push({ g, x: 892 + i * 28, y: 279, rbc: false }); }
}
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ana", "Autoantibodies", "g-ana", "Anti-nuclear antibodies made by B cells after tolerance to nuclear bits is lost."], ["cplx", "Complexes", "g-cplx", "Antibody locked to nuclear bits. Complexes travel in blood and lodge in organs."], ["comp", "Complement left", "g-comp", "Complement remaining in blood. It falls when complexes use it up in a flare."], ["org", "Inflammation", "g-org", "Inflammation in skin, joints, kidney and blood from lodged complexes."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Self bits", 95, 153, 95, 122, "Nuclear bits from damaged cells. In lupus the immune system attacks them as foreign.");
  pill(ox, "T cell", 250, 153, 250, 122, "Helper T cell. It sees self bits and tells B cells to make antibodies.");
  pill(ox, "B cell", 405, 153, 405, 122, "B cell. Helped by T cells, it pours out anti-nuclear antibodies.");
  pill(ox, "ANA", 430, 225, 580, 122, "ANA. Anti-nuclear antibodies that hunt self bits in blood and tissues.");
  pill(ox, "Complexes", 250, 273, 250, 228, "Immune complexes in blood. They lodge in small vessels and start inflammation.");
  pill(ox, "Skin", 160, 328, 160, 321, "Skin. Lodged complexes inflame skin vessels and raise rashes.");
  pill(ox, "Joint", 470, 328, 470, 321, "Joint. Inflammation swells the joint lining and stiffens movement.");
  pill(ox, "Kidney", 770, 328, 770, 321, "Kidney. Complexes lodge in filters, spill protein and inflame the kidney.");
  capEl = mk("text", { class: "sle-cap", x: 34, y: 92 }, ox); capEl.textContent = capText(0);
}
const sm = { A: 0.5, Cx: 0.4, Comp: 0.5, Org: 0.4, hcq: 0, steroid: 0, immuno: 0 };
const acc = { ag: 0, help: 0, ab: 0, cplx: 0, comp: 0, dep: 0, leak: 0 };
function init() { initOrgans(); initCells(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k2 = Math.min(1, dt * 1.2);
  sm.A = lerp(sm.A, m.A, k); sm.Cx = lerp(sm.Cx, m.Cx, k); sm.Comp = lerp(sm.Comp, m.Comp, k); sm.Org = lerp(sm.Org, m.Org, k);
  sm.hcq = lerp(sm.hcq, m.hcq, k2); sm.steroid = lerp(sm.steroid, m.steroid, k2); sm.immuno = lerp(sm.immuno, m.immuno, k2);
  place(dmgG, 95 + Math.sin(tm / 1500) * 2, 175 + Math.cos(tm / 1700) * 2, 0, 1);
  const dim = 1 - 0.18 * sm.immuno, pulse = (1 - sm.immuno) * sm.A;
  place(tG, 250 + Math.sin(tm / 1300 + 2) * 3, 175, 0, dim + 0.06 * pulse * Math.sin(tm / 280 + 1));
  tG.style.opacity = (1 - 0.3 * sm.immuno).toFixed(2);
  place(bG, 405, 175 + Math.cos(tm / 1400) * 2, 0, dim + 0.06 * pulse * Math.sin(tm / 320 + 2));
  bG.style.opacity = (1 - 0.3 * sm.immuno).toFixed(2);
  compDots.forEach((c, i) => { c.setAttribute("opacity", clamp(sm.Comp * 1.4 - i * 0.06).toFixed(2)); });
  /* organ inflammation: glow wash, vessel heat, skin rash, joint fluid, blood counts */
  glows.forEach((g) => { g.setAttribute("opacity", (sm.Org * 0.32).toFixed(2)); });
  LY.heat.setAttribute("opacity", (sm.Org * 0.22).toFixed(2));
  rash.forEach((r) => { r.setAttribute("opacity", sm.Org.toFixed(2)); });
  effu.setAttribute("opacity", (sm.Org * 0.7).toFixed(2));
  shields.forEach((s) => { s.setAttribute("fill-opacity", (sm.steroid * 0.12).toFixed(2)); s.setAttribute("stroke-opacity", (sm.steroid * 0.9).toFixed(2)); s.setAttribute("stroke-dashoffset", f1(-tm / 40)); });
  bloodCells.forEach((b, i) => { const keep = clamp(1.15 - sm.Org * 0.75 - i * 0.04); place(b.g, b.x + Math.sin(tm / 500 + i) * 2, b.y, 0, Math.max(0.25, keep)); b.g.style.opacity = clamp(keep).toFixed(2); });
  /* self bits travel to the T cell; hydroxychloroquine traps them at its gate */
  acc.ag += dt * (0.4 + sm.A) * 2.2; while (acc.ag >= 1) { acc.ag--; const p = free(ags); if (p) { emit(p, 0, 0, 0, 0); p.tr = agT; p.u = 0; p.st = 0; } }
  ags.forEach((p) => {
    if (!p.on) return;
    if (p.st === 9) { p.t += dt; p.x += rnd(-6, 6) * dt; p.y += rnd(-6, 6) * dt; place(p.e, p.x, p.y, f1(tm / 5), 1); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); return; }
    p.u += dt * 45 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, f1(tm / 5), 1);
    if (sm.hcq > 0.4 && p.x > 138 && p.x < 208 && Math.random() < dt * 2.5 * sm.hcq) { p.st = 9; p.t = 0; return; }
    if (p.u >= 1) kill(p);
  });
  /* T cell help signal to the B cell, blocked when B and T cells are damped */
  acc.help += dt * sm.A * 3 * (1 - 0.75 * sm.immuno) * (1 - 0.35 * sm.hcq); while (acc.help >= 1) { acc.help--; const p = free(helps); if (p) { emit(p, 0, 0, 0, 0); p.tr = helpT; p.u = 0; } }
  helps.forEach((p) => { if (!p.on) return; p.u += dt * 60 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y + Math.sin(tm / 300 + q.x) * 2, 0, 1); if (p.u >= 1) kill(p); });
  /* ANA dives from the B cell into blood */
  acc.ab += dt * sm.A * 3.4; while (acc.ab >= 1) { acc.ab--; const p = free(abs); if (p) { emit(p, 0, 0, 0, 0); p.tr = abT; p.u = 0; } }
  abs.forEach((p) => { if (!p.on) return; p.u += dt * 55 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y, f1(tm / 6), 1); if (p.u >= 1) kill(p); });
  /* complexes ride the bloodstream left to right */
  acc.cplx += dt * sm.Cx * 3.2; while (acc.cplx >= 1) { acc.cplx--; const p = free(cplxs); if (p) { emit(p, 0, 0, 0, 0); p.tr = vesT; p.u = 0; } }
  cplxs.forEach((p) => { if (!p.on) return; p.u += dt * 55 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); place(p.e, q.x, q.y + Math.sin(tm / 400 + q.x) * 2, 0, 1); if (p.u >= 1) kill(p); });
  /* complement dives in and is used up on complexes */
  acc.comp += dt * sm.Cx * 4.2; while (acc.comp >= 1) { acc.comp--; const p = free(comps); if (p) emit(p, 600 + rnd(0, 55), 190, rnd(-6, 6), rnd(26, 38)); }
  comps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); if (p.y > 258 || p.t > 3) kill(p); });
  /* deposition: complexes leave blood for skin, joint and kidney */
  acc.dep += dt * sm.Cx * sm.Org * 5.2; while (acc.dep >= 1) { acc.dep--; const p = free(deps); if (p) { const T = pick(depTargets); emit(p, T[0] + rnd(-55, 55), 304, rnd(-4, 4), rnd(24, 36)); p.tx = T[0]; p.ty = T[1]; } }
  deps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (p.tx - p.x) * dt * 0.8; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); if (Math.hypot(p.tx - p.x, p.ty - p.y) < 7 || p.t > 4) kill(p); });
  /* protein leak from the inflamed kidney filter */
  acc.leak += dt * sm.Org * 2.4; while (acc.leak >= 1) { acc.leak--; const p = free(leaks); if (p) emit(p, kidneyP[0] + rnd(-6, 6), kidneyP[1], rnd(-3, 3), rnd(28, 42)); }
  leaks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - kidneyP[1]) / 60).toFixed(2)); if (p.y > 432 || p.t > 3) kill(p); });
  /* drug granules fly to their target and dock: gate, organ shields, cell rims */
  const slots = drug === 1 ? hcqSlots : drug === 2 ? sterSlots : drug === 3 ? immSlots : null;
  drugP.forEach((p, i) => {
    if (slots && i < slots.length) {
      if (!p.on) { p.on = true; p.x = slots[i][0] + rnd(-40, 40); p.y = 120 + rnd(-10, 10); p.e.setAttribute("opacity", "0"); }
      const s = slots[i], kk = Math.min(1, dt * 2.5);
      p.x = lerp(p.x, s[0] + Math.sin(tm / 520 + i * 2.1) * 2.5, kk);
      p.y = lerp(p.y, s[1] + Math.cos(tm / 640 + i * 1.7) * 2.5, kk);
      place(p.e, p.x, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(+p.e.getAttribute("opacity") + dt * 1.5).toFixed(2));
    } else if (p.on) {
      p.y -= 34 * dt; p.x += Math.sin(tm / 300 + i) * 0.3;
      place(p.e, p.x, p.y, 0, 1);
      const o = +p.e.getAttribute("opacity") - dt * 1.8;
      if (o <= 0) kill(p); else p.e.setAttribute("opacity", o.toFixed(2));
    }
  });
  if (drug !== lastDrug) {
    lastDrug = drug;
    if (drug > 0) { const cfg = drug === 1 ? ["sc-p p-hcq", 4] : drug === 2 ? ["sc-p p-ster", 3.4] : ["sc-p p-imm", 5]; drugP.forEach((p) => { p.c.setAttribute("class", cfg[0]); p.c.setAttribute("r", cfg[1]); }); }
    const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t;
  }
  gg.ana.set(sm.A, wordOf(sm.A, 0.35, 0.65, ["low", "moderate", "high"])); gg.cplx.set(sm.Cx, wordOf(sm.Cx, 0.35, 0.65, ["few", "some", "many"]));
  gg.comp.set(sm.Comp, sm.Comp > 0.6 ? "preserved" : sm.Comp > 0.35 ? "reduced" : "low"); gg.org.set(sm.Org, wordOf(sm.Org, 0.3, 0.6, ["mild", "moderate", "high"]));
}
run({ init, step });
