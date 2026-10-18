/* CML scene: Philadelphia chromosome, always on kinase, clonal granulocyte expansion, phase change, blood, spleen and gauges. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel"), spleen: $("spleen"), kinase: $("kinase") };
const W = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* ---- fixed cells ---- */
const stems = [[365, 145], [365, 205]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cmlstem", r: 16, nuc: 0.42, seed: i * 3 + 1, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const progs = [[408, 182], [398, 232], [418, 272]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cmlprog", r: 11, nuc: 0.4, seed: i * 2 + 5, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
function grid(n, x0, y0, dx, dy, cols) { return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * dx + ((i * 37) % 11) - 5, y: y0 + Math.floor(i / cols) * dy + ((i * 53) % 9) - 4 })); }
const grans = grid(24, 452, 178, 36, 36, 6).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 40, wob: 0.12 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const blasts = grid(24, 452, 178, 36, 36, 6).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cmlblast", r: 13, nuc: 0.6, seed: i + 80, wob: 0.09 }); return { g, x: p.x + 5, y: p.y + 5, s: 0, i }; });
const vesselRbcs = Array.from({ length: 9 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, LY.stage); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { g, x: 712 + (i % 3) * 22, y: 96 + i * 20, v: 0.8 + (i % 4) * 0.15 }; });
const vesselPlts = Array.from({ length: 6 }, (_, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "plt", r: 5, seed: i + 120, wob: 0.15, n: 7 }); return { g, x: 716 + (i % 2) * 34, y: 104 + i * 30, v: 0.6 }; });
const spleenEl = mk("ellipse", { class: "cml-spleen", rx: 42, ry: 30 }, LY.spleen);
mk("ellipse", { cx: -12, cy: -10, rx: 14, ry: 8, fill: "#ffffff", opacity: "0.25" }, LY.spleen);

/* ---- particles (pool items expose their element as p.e) ---- */
const sigs = mkPool(20, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, LY.stage));
const tkis = mkPool(14, () => mk("circle", { class: "sc-p p-tki", r: 2.6 }, LY.stage));
const divs = mkPool(16, () => mk("circle", { class: "sc-p p-div", r: 2.1 }, LY.stage));

/* ---- labels and treatment marks ---- */
const marks = [];
function addMark(drugs, x, y, text, tip) { const g = mk("g", {}, LY.over); mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); pill(g, text, x, y, 480, 422, tip); marks.push({ g, drugs }); return g; }
function initLabels() {
  pill(LY.over, "9;22 swap", 160, 122, 228, 125, "A reciprocal swap between chromosomes 9 and 22. Part of chromosome 9 moves to chromosome 22 and part of 22 moves to 9.");
  pill(LY.over, "Philadelphia chr", 119, 216, 232, 216, "Philadelphia chromosome: the shortened derivative chromosome 22 left by the swap. It carries the fusion gene.");
  pill(LY.over, "BCR-ABL gene", 150, 288, 150, 314, "BCR-ABL fusion gene: BCR from chromosome 22 joined to ABL from chromosome 9. It codes for a kinase that is always on.");
  pill(LY.over, "Always on kinase", 171, 352, 256, 318, "The BCR-ABL tyrosine kinase stays switched on without normal controls. It drives growth and survival signals in the clonal stem cell.");
  pill(LY.over, "Stem cell", 381, 145, 438, 145, "The clonal haematopoietic stem cell in the marrow. The fusion arises here, so all its granulocyte offspring carry the change.");
  pill(LY.over, "Granulocytes", 560, 290, 540, 360, "Excess mature granulocytes, mainly neutrophils with some basophils and eosinophils. In chronic phase they still mature and work fairly well.");
  pill(LY.over, "Blasts", 470, 200, 385, 360, "Immature blast cells. Few in chronic phase, more in accelerated phase, and dominant in blast phase when maturation fails.");
  pill(LY.over, "Blood", 732, 294, 732, 322, "Blood leaving the marrow. Granulocytes are high early; in blast phase red cells and platelets fall, causing anaemia and bleeding.");
  pill(LY.over, "Spleen", 862, 222, 862, 268, "The spleen enlarges as it filters the excess cells and becomes a site of blood production outside the marrow. Splenomegaly can cause fullness and pain.");
  addMark([2], 150, 352, "Kinase blocked", "A tyrosine kinase inhibitor blocks the BCR-ABL kinase, switching off the growth signal. It works best in chronic phase.");
  addMark([1], 540, 240, "Chemo hits clone", "Chemotherapy kills dividing cells in the clone. It lowers counts less selectively and harms normal marrow for a time.");
  addMark([3], 365, 145, "Marrow replaced", "Stem cell transplant: after the clonal marrow is cleared, donor stem cells rebuild a new marrow without the fusion.");
}

/* ---- gauges ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Marrow, blood and spleen";
  [["kin", "Kinase", "g-cyt", "Activity of the BCR-ABL tyrosine kinase. High means the growth signal is on."], ["gran", "Granulocytes", "g-neu", "Excess mature granulocytes from the clone. High in chronic and accelerated phase."], ["blast", "Blasts", "g-bad", "Immature blasts. Low in chronic phase and high in blast phase."], ["norm", "Normal blood", "g-good", "Normal red cell and platelet production. It falls as blasts crowd out the marrow, causing anaemia and bleeding."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
}
const sm = { K: 0.85, G: 0.7, B: 0.1, N: 0.7, Sp: 0.5 };
const acc = { sig: 0, tki: 0, div: 0 };
function setPool(pool, n, dt, bob) { pool.forEach((c, i) => { const want = i < n ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2.2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * bob, c.y + Math.cos(tm / 900 + i) * bob, Math.sin(tm / 800 + i) * 6, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; }); }
function init() { initLabels(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 1.6);
  sm.K = lerp(sm.K, m.K, kk); sm.G = lerp(sm.G, m.G, kk); sm.B = lerp(sm.B, m.B, kk); sm.N = lerp(sm.N, m.N, kk); sm.Sp = lerp(sm.Sp, m.Sp, kk);
  const pulse = 1 + 0.1 * sm.K * Math.sin(tm / 280);
  LY.kinase.setAttribute("transform", "translate(150 352) scale(" + pulse.toFixed(3) + ") translate(-150 -352)");
  stems.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, 1 + 0.03 * Math.sin(tm / 300 + i)));
  progs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 700 + i) * 2, Math.sin(tm / 900 + i) * 8, 1 - 0.3 * sm.B));
  setPool(grans, Math.round(sm.G * 24), dt, 1.6);
  setPool(blasts, Math.round(sm.B * 24), dt, 1.4);
  LY.spleen.setAttribute("transform", "translate(862 180) scale(" + (0.65 + 0.65 * sm.Sp).toFixed(3) + ")");
  vesselRbcs.forEach((r, i) => { r.y += r.v * 24 * (0.3 + sm.N) * dt; if (r.y > 282) { r.y = 96; r.x = 712 + Math.floor(rnd(0, 3)) * 22; } place(r.g, r.x, r.y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = i < Math.round(sm.N * 9) ? 1 : 0; });
  vesselPlts.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 282) r.y = 100; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.N * 6) ? 1 : 0; });
  acc.sig += dt * sm.K * 7; while (acc.sig >= 1) { acc.sig--; const p = freeP(sigs); if (p) emit(p, 178, 352 + rnd(-8, 8), rnd(45, 70), rnd(-28, -12), 0); }
  sigs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x > 640) kill(p); });
  acc.div += dt * sm.G * 4; while (acc.div >= 1) { acc.div--; const p = freeP(divs); if (p) emit(p, rnd(460, 620), rnd(185, 300), rnd(-13, 13), rnd(-13, 13), 0); }
  divs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  acc.tki += dt * (m.drug === 2 ? 4 : 0); while (acc.tki >= 1) { acc.tki--; const p = freeP(tkis); if (p) emit(p, rnd(300, 420), rnd(300, 360), 0, 0, 0); }
  tkis.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (150 - p.x) * dt * 1.5; p.y += (352 - p.y) * dt * 1.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(150 - p.x, 352 - p.y) < 12 || p.t > 3) kill(p); });
  marks.forEach((mk2) => { const on = mk2.drugs.indexOf(m.drug) > -1; mk2.g.style.display = on ? "" : "none"; });
  gg.kin.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["low", "raised", "high"])); gg.gran.set(sm.G, wordOf(sm.G, 0.25, 0.55, ["low", "raised", "high"]));
  gg.blast.set(sm.B, wordOf(sm.B, 0.15, 0.4, ["low", "raised", "high"])); gg.norm.set(sm.N, wordOf(sm.N, 0.35, 0.65, ["low", "reduced", "normal"]));
}
run({ init, step });
