/* Fungal scene: skin to mucosa to lung, blood yeast to the brain, and a magnified
 * fungal cell where drug blockers sit on their targets. Left to right story. */
const LY = { skin: $("skinSlot"), gut: $("gutSlot"), lung: $("lungSlot"), brain: $("brainSlot"),
  sSkin: $("siteSkin"), sGut: $("siteGut"), sLung: $("siteLung"), sBrain: $("siteBrain"), sBlood: $("siteBlood"),
  cell: $("fungcell"), flow: $("flow"), parts: $("parts"), over: $("over"), panel: $("panel"),
  tube: $("bloodTube"), glow: $("brainGlow") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

const O = {}, base = {}, REG = [null, null, null];
let bloodTr = null, cream = null, wallRing = null, membRing = null, cellCore = null;
const ergXY = [], ergDots = [], dock = [];
const riders = [];
let capEl = null, capShown = "";

function boxOf(o, pad) { return { x1: o.x - o.w / 2 + pad, x2: o.x + o.w / 2 - pad, y1: o.y - o.h / 2 + pad, y2: o.y + o.h / 2 - pad }; }

function initOrgans() {
  O.skin = organ(LY.skin, "skin", 130, 215, 150, {});
  O.gut = organ(LY.gut, "bowel", 350, 214, 160, {});
  O.lung = organ(LY.lung, "lung", 575, 220, 170, {});
  O.brain = organ(LY.brain, "brain", 815, 200, 185, {});
  /* blood tube runs from the lung base to the brain carotid port */
  const A = O.lung.ports.base, B = O.brain.ports.carotid;
  const m1 = [A[0] + 70, A[1] + 22], m2 = [B[0] - 70, B[1] + 28];
  LY.tube.setAttribute("d", "M" + f1(A[0]) + " " + f1(A[1]) + " C" + f1(m1[0]) + " " + f1(m1[1]) + " " + f1(m2[0]) + " " + f1(m2[1]) + " " + f1(B[0]) + " " + f1(B[1]));
  bloodTr = track([A, m1, m2, B]);
  LY.glow.setAttribute("cx", f1(O.brain.x)); LY.glow.setAttribute("cy", f1(O.brain.y));
  /* ---- site fungi, anchored on the organ ports ---- */
  const S = O.skin.ports.surface;
  base.skin = [S[0], S[1] + 30];
  const gS = LY.sSkin;
  mk("ellipse", { class: "fn-ring", cx: 0, cy: 0, rx: 58, ry: 30, fill: "none" }, gS);
  mk("ellipse", { class: "fn-ring2", cx: 0, cy: 0, rx: 34, ry: 17, fill: "none" }, gS);
  mk("path", { class: "fn-hyph", d: "M-52 -8 C-30 -16 -10 -6 12 -12 C34 -18 48 -10 58 -14", fill: "none" }, gS);
  mk("path", { class: "fn-hyph", d: "M-46 10 C-24 4 -2 12 22 6 C40 2 50 6 58 2", fill: "none" }, gS);
  for (let i = 0; i < 8; i++) { const a = i * 0.785; mk("circle", { class: "sc-p p-spore", cx: f1(Math.cos(a) * 58), cy: f1(Math.sin(a) * 30), r: 2.6, fill: "var(--c-fung)" }, gS); }
  cream = mk("rect", { class: "fn-cream", x: f1(S[0] - 60), y: f1(S[1] - 8), width: 120, height: 13, rx: 6, fill: "color-mix(in srgb,#9fd8f0 55%,var(--anatomy-paper))" }, LY.flow);
  const C = O.gut.ports.coils;
  base.gut = [C[0], C[1] + 6];
  const gG = LY.sGut;
  [[-42, -52], [8, -58], [54, -50]].forEach(([x, y]) => mk("ellipse", { class: "fn-plaque", cx: x, cy: y, rx: 17, ry: 7, fill: "var(--anatomy-strong)" }, gG));
  [[-30, -8, 12], [0, 6, 9], [28, -6, 8]].forEach(([x, y, r], i) => { const g = mk("g", {}, gG); cell(g, { cls: "cand", r, nuc: 0.35, seed: i + 3, wob: 0.1 }); place(g, x, y, i * 30, 1); });
  const pg = mk("g", {}, gG);
  [[52, -22], [52, -2], [52, 18]].forEach(([x, y], i) => { const g = mk("g", {}, pg); cell(g, { cls: "cand", r: 9, nuc: 0.3, seed: i + 8, wob: 0.08 }); place(g, x, y, i * 18, 1); });
  mk("path", { class: "fn-hyph2", d: "M52 -22 C54 -8 50 6 52 18", fill: "none" }, pg);
  const K = O.lung.ports.carina || O.lung.ports.hilumL;
  base.lung = [K[0], K[1]];
  const gL = LY.sLung;
  mk("path", { class: "fn-hyph", d: "M0 0 C-14 18 -26 34 -44 44", fill: "none" }, gL);
  mk("path", { class: "fn-hyph", d: "M0 0 C10 20 18 38 20 58", fill: "none" }, gL);
  mk("path", { class: "fn-hyph", d: "M-24 26 C-34 28 -44 28 -52 34", fill: "none" }, gL);
  [[-30, 32], [-44, 44], [12, 34], [20, 58], [-52, 34]].forEach(([x, y]) => mk("circle", { class: "sc-p p-spore", cx: x, cy: y, r: 2.6, fill: "var(--c-fung)" }, gL));
  const ST = O.brain.ports.stem;
  base.brain = [ST[0] - 10, ST[1] - 30];
  const gB = LY.sBrain;
  [[-32, -12], [12, -22], [42, 2]].forEach(([x, y], i) => {
    const g = mk("g", {}, gB);
    mk("circle", { class: "fn-halo", r: 15, fill: "color-mix(in srgb,var(--c-wall) 18%,transparent)" }, g);
    const c = cell(g, { cls: "yeast", r: 8, nuc: 0.3, seed: i + 20, wob: 0.06 }); place(c, 0, 0, 0, 1);
    place(g, x, y, 0, 1);
  });
  for (let i = 0; i < 5; i++) { const g = mk("g", {}, LY.sBlood); cell(g, { cls: "yeast", r: 7, nuc: 0.3, seed: i + 14, wob: 0.08 }); riders.push({ g, u: i / 5 }); }
  /* magnified fungal cell: glucan wall outside, ergosterol membrane inside */
  wallRing = mk("circle", { class: "fn-wallring", cx: 120, cy: 386, r: 34, fill: "color-mix(in srgb,var(--c-fung) 22%,var(--anatomy-paper))" }, LY.cell);
  membRing = mk("circle", { class: "fn-membring", cx: 120, cy: 386, r: 25, fill: "none" }, LY.cell);
  cellCore = mk("g", {}, LY.cell); cell(cellCore, { cls: "yeast", r: 20, nuc: 0.42, seed: 6, wob: 0.07 }); place(cellCore, 120, 386, 0, 1);
  for (let i = 0; i < 10; i++) {
    const a = i * 0.628, x = 120 + Math.cos(a) * 25, y = 386 + Math.sin(a) * 25;
    ergXY.push([x, y]);
    ergDots.push(mk("path", { class: "fn-ergd", d: "M0 -4L3 0L0 4L-3 0Z", fill: "var(--c-erg)", transform: "translate(" + f1(x) + " " + f1(y) + ")" }, LY.cell));
  }
  [0, 2, 4, 5, 7, 9].forEach((k) => {
    const g = mk("g", {}, LY.parts);
    mk("path", { class: "sc-p p-treat", d: "M0 -4.2L3.6 0L0 4.2L-3.6 0Z", fill: "#38d1ff", transform: "translate(" + f1(ergXY[k][0]) + " " + f1(ergXY[k][1]) + ")" }, g);
    g.setAttribute("opacity", "0"); dock.push(g);
  });
  REG[0] = boxOf(O.skin, 14); REG[1] = boxOf(O.gut, 14);
  REG[2] = [boxOf(O.lung, 12), { x1: O.brain.x - 90, x2: O.brain.x + 90, y1: O.brain.y - 66, y2: O.brain.y + 66 }];
}

/* ---- particles ---- */
const spores = pool(36, () => mk("circle", { class: "sc-p p-spore", r: 2.6, fill: "var(--c-fung)" }, LY.parts));
const treats = pool(26, () => mk("path", { class: "sc-p p-treat", d: "M0 -3.4L3 0L0 3.4L-3 0Z", fill: "#38d1ff" }, LY.parts));

function capText(d, lvl) {
  if (d === 1) return "Topical azole coats the skin. Surface fungi shrink.";
  if (d === 2) return "Systemic azole blocks wall building. Fungi shrink.";
  if (d === 3) return "Wall and membrane drugs break the cell. Fungi burst.";
  if (lvl === 2) return "No treatment. Fungi reach lung, blood and brain.";
  return "No treatment. Fungi grow and spread deeper.";
}

function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14, fill: "var(--anatomy-card)" }, P);
  const pt = mk("text", { class: "dr-pt", x: 40, y: y0 - 8, fill: "var(--anatomy-strong)" }, P); pt.textContent = "The infection";
  const S = O.skin.ports.surface, C = O.gut.ports.coils, T = O.lung.ports.trachea, F = O.brain.ports.frontal;
  const mid = bloodTr.at(0.5);
  pill(LY.over, "Skin", S[0], S[1], 130, 88, "Skin surface: dermatophytes digest keratin here and spread as a scaly ring.");
  pill(LY.over, "Mucosa", C[0], C[1] - 52, 350, 88, "Moist mucosa: Candida yeast lives here and forms white plaques.");
  pill(LY.over, "Lung", T[0], T[1], 575, 66, "Lung: inhaled spores sprout hyphae that invade tissue when defences are weak.");
  pill(LY.over, "Brain", F[0], F[1], 815, 66, "Brain lining: shielded Crypto yeast can reach the meninges.");
  pill(LY.over, "Blood", mid.x, mid.y, 665, 352, "Blood: yeast in the bloodstream can seed distant sites.");
  pill(LY.over, "Fungal cell", 86, 386, 200, 404, "Magnified fungal cell: drugs hit the wall outside and the membrane sterol inside.");
  capEl = mk("text", { class: "fn-cap", x: 200, y: 372, fill: "var(--anatomy-strong)" }, LY.over); capEl.textContent = capText(0, 0);
}
const gg = {};
function initGauges() {
  const P = LY.panel, y0 = 478;
  [["burden", "Fungal burden", "g-fung", "How much fungus is present at the site."], ["inv", "Invasion", "g-bad", "How deep the fungus has gone: surface only, mucosa, or deep tissue, blood and brain lining."], ["dmg", "Tissue damage", "g-clot", "Scaling, soreness and ulceration at the surface, or tissue and vessel invasion deep down."], ["reach", "Treatment reach", "g-reach", "How well the chosen treatment reaches this depth and hits its target. Topical reaches skin only."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 180 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { F: 0.3, Inv: 0.1, Dmg: 0.2, Reach: 0 };
const acc = { sp: 0, tr: 0 };
function init() { initOrgans(); initPanel(); initGauges(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.F = lerp(sm.F, m.F, k); sm.Inv = lerp(sm.Inv, m.Inv, k); sm.Dmg = lerp(sm.Dmg, m.Dmg, k); sm.Reach = lerp(sm.Reach, m.Reach, k);
  const sys = m.drug >= 2 ? m.eff : 0;
  const act = m.eff;
  const siteS = (active) => 1 - 0.6 * (active ? act : sys * 0.7);
  const dim = (el, v) => { el.style.opacity = v.toFixed(2); };
  const aSkin = m.lvl === 0, aGut = m.lvl === 1, aDeep = m.lvl === 2;
  dim(LY.skin, aSkin ? 1 : 0.4); dim(LY.sSkin, aSkin ? 1 : 0.4);
  dim(LY.gut, aGut ? 1 : 0.4); dim(LY.sGut, aGut ? 1 : 0.4);
  dim(LY.lung, aDeep ? 1 : 0.4); dim(LY.sLung, aDeep ? 1 : 0.4);
  dim(LY.brain, aDeep ? 1 : 0.4); dim(LY.sBrain, aDeep ? 1 : 0.4);
  dim(LY.sBlood, aDeep ? 1 : 0.4); LY.tube.style.opacity = (aDeep ? 0.8 : 0.32).toFixed(2);
  place(LY.sSkin, base.skin[0], base.skin[1], 0, siteS(aSkin));
  place(LY.sGut, base.gut[0], base.gut[1], 0, siteS(aGut));
  place(LY.sLung, base.lung[0], base.lung[1], Math.sin(tm / 2400) * 2, siteS(aDeep));
  place(LY.sBrain, base.brain[0], base.brain[1] + Math.sin(tm / 700) * 1.5, 0, (0.6 + 0.4 * sm.Inv) * (1 - 0.55 * sys));
  LY.glow.setAttribute("opacity", (sm.Inv * 0.4).toFixed(2));
  cream.setAttribute("opacity", (m.drug === 1 ? 0.85 : 0).toFixed(2));
  /* magnified cell: blockers dock on the membrane sterol, wall breaks open */
  if (m.drug === 3) { wallRing.setAttribute("stroke-dasharray", "16 10"); wallRing.setAttribute("opacity", "0.5"); }
  else { wallRing.setAttribute("stroke-dasharray", "none"); wallRing.setAttribute("opacity", "1"); }
  if (m.drug === 3) { membRing.setAttribute("stroke-dasharray", "3 8"); membRing.setAttribute("opacity", "0.7"); }
  else { membRing.setAttribute("stroke-dasharray", "5 4"); membRing.setAttribute("opacity", m.drug === 2 ? "0.45" : "1"); }
  ergDots.forEach((e) => e.setAttribute("opacity", (1 - 0.75 * sm.Reach).toFixed(2)));
  place(cellCore, 120, 386, 0, Math.max(0.4, 1 - 0.45 * sm.Reach));
  dock.forEach((g) => g.setAttribute("opacity", m.drug >= 2 && sm.Reach > 0.05 ? "1" : "0"));
  /* blood riders drift toward the brain, and shrink as systemic drug kills them */
  riders.forEach((r, i) => {
    r.u = (r.u + dt * 0.05 * (0.4 + sm.Inv)) % 1;
    const q = bloodTr.at(r.u);
    place(r.g, q.x, q.y, tm / 600 + i, Math.max(0.15, (0.5 + 0.5 * sm.Inv) * (1 - 0.6 * sys)));
    r.g.style.opacity = sm.Inv.toFixed(2);
  });
  /* spores rise from the active site */
  const boxes = m.lvl === 2 ? REG[2] : [REG[m.lvl]];
  const r = boxes[Math.floor(Math.random() * boxes.length)];
  acc.sp += dt * sm.F * 14; while (acc.sp >= 1) { acc.sp--; const p = freeP(spores); if (p) emit(p, rnd(r.x1, r.x2), rnd(r.y1, r.y2), rnd(-7, 7), rnd(-5, 7), 0); }
  spores.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + Math.sin(tm / 500 + p.y) * 0.25; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4) kill(p); });
  /* treatment particles: cream rains on skin, systemic drug homes to the active site */
  acc.tr += dt * sm.Reach * 12; while (acc.tr >= 1) { acc.tr--;
    const p = freeP(treats); if (!p) continue;
    if (m.drug === 1) emit(p, rnd(REG[0].x1, REG[0].x2), REG[0].y1 - 6, rnd(-4, 4), rnd(18, 30), 0);
    else { const b = boxes[Math.floor(Math.random() * boxes.length)]; p.on = true; p.x = 120 + rnd(-30, 30); p.y = 386 + rnd(-30, 30); p.t = 0; p.bx = (b.x1 + b.x2) / 2; p.by = (b.y1 + b.y2) / 2; p.e.setAttribute("opacity", "1"); }
  }
  treats.forEach((p) => { if (!p.on) return; p.t += dt;
    if (m.drug === 1) { p.y += p.vy * dt; }
    else { const tx = p.bx === undefined ? 500 : p.bx, ty = p.by === undefined ? 200 : p.by; p.x += (tx - p.x) * dt * 0.8; p.y += (ty - p.y) * dt * 0.8; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3.5).toFixed(2)); if (p.t > 3.5) kill(p); });
  gg.burden.set(sm.F, wordOf(sm.F, 0.18, 0.5, ["low", "present", "heavy"])); gg.inv.set(sm.Inv, wordOf(sm.Inv, 0.18, 0.5, ["limited", "spreading", "deep"]));
  gg.dmg.set(sm.Dmg, wordOf(sm.Dmg, 0.2, 0.5, ["little", "some", "marked"])); gg.reach.set(sm.Reach, wordOf(sm.Reach, 0.25, 0.6, ["none", "partial", "good"]));
  const cap = capText(m.drug, m.lvl);
  if (cap !== capShown) { capShown = cap; capEl.textContent = cap; }
}
run({ init, step });
