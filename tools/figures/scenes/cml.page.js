/* CML scene: Philadelphia chromosome, always on kinase, clonal granulocyte expansion, phase change, blood, spleen and gauges. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel"), slot: $("spleenSlot"), kinase: $("kinase"), link: $("spleenLink") };
const W = SC.W;
const KIN = { x: 150, y: 352 };
let spleenO = null, capEl = null, capDrug = -1, spillTrack = null;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

function initOrgans() {
  spleenO = organ(LY.slot, "spleen", 862, 185, 150, {});
  const hp = spleenO.ports.hilum;
  LY.link.setAttribute("d", "M776 192 C800 196 " + f1(hp[0] - 34) + " " + f1(hp[1] - 12) + " " + f1(hp[0]) + " " + f1(hp[1]));
  spillTrack = track([[604, 264], [696, 262], [758, 254], hp]);
}
function capText(d) {
  if (d === 1) return "Chemotherapy kills dividing clone cells. Healthy marrow falls too.";
  if (d === 2) return "Kinase blocker plugs BCR-ABL. The growth signal fades.";
  if (d === 3) return "Transplant replaces the clone with healthy donor marrow.";
  return "No treatment. The kinase stays on and the clone fills marrow and spleen.";
}

/* ---- fixed cells ---- */
const stems = [[365, 145], [365, 205]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cmlstem", r: 16, nuc: 0.42, seed: i * 3 + 1, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
const donors = [[365, 145], [365, 205], [430, 145]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "donor", r: 16, nuc: 0.42, seed: i * 5 + 2, wob: 0.1 }); place(g, x, y, 0, 0.001); g.setAttribute("opacity", "0"); return { g, x, y }; });
const progs = [[408, 182], [398, 232], [418, 272]].map(([x, y], i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cmlprog", r: 11, nuc: 0.4, seed: i * 2 + 5, wob: 0.1 }); place(g, x, y, 0, 1); return { g, x, y }; });
function grid(n, x0, y0, dx, dy, cols) { return Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * dx + ((i * 37) % 11) - 5, y: y0 + Math.floor(i / cols) * dy + ((i * 53) % 9) - 4 })); }
const grans = grid(24, 452, 178, 36, 36, 6).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "neut", r: 11, nuc: 0.55, nucCls: "multi", seed: i + 40, wob: 0.12 }); return { g, x: p.x, y: p.y, s: 0, i }; });
const blasts = grid(24, 452, 178, 36, 36, 6).map((p, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "cmlblast", r: 13, nuc: 0.6, seed: i + 80, wob: 0.09 }); return { g, x: p.x + 5, y: p.y + 5, s: 0, i }; });
const vesselRbcs = Array.from({ length: 9 }, (_, i) => { const g = mk("g", { class: "cl cl-rbc" }, LY.stage); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { g, x: 712 + (i % 3) * 22, y: 96 + i * 20, v: 0.8 + (i % 4) * 0.15 }; });
const vesselPlts = Array.from({ length: 6 }, (_, i) => { const g = mk("g", {}, LY.stage); cell(g, { cls: "plt", r: 5, seed: i + 120, wob: 0.15, n: 7 }); return { g, x: 716 + (i % 2) * 34, y: 104 + i * 30, v: 0.6 }; });

/* ---- treatment actors: docked blockers on the kinase, chemo hit flashes ---- */
const dock = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * 6.2832 + 0.3, e = mk("circle", { class: "sc-p p-tki", r: 3.4 }, LY.stage);
  e.setAttribute("transform", "translate(" + f1(KIN.x + Math.cos(a) * 28) + " " + f1(KIN.y + Math.sin(a) * 28) + ")"); e.setAttribute("opacity", "0"); return { e }; });
const hits = Array.from({ length: 6 }, () => { const g = mk("g", {}, LY.stage); mk("path", { class: "cml-hit", d: "M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5" }, g);
  g.setAttribute("opacity", "0"); return { g, x: 500, y: 240, t: 0 }; });

/* ---- particles (pool items expose their element as p.e) ---- */
const sigs = mkPool(20, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, LY.stage));
const tkis = mkPool(10, () => mk("circle", { class: "sc-p p-tki", r: 2.6 }, LY.stage));
const divs = mkPool(12, () => mk("circle", { class: "sc-p p-div", r: 2.1 }, LY.stage));
const chemos = mkPool(10, () => mk("circle", { class: "sc-p p-chemo", r: 2.6 }, LY.stage));
const spill = mkPool(10, () => mk("circle", { class: "sc-p p-wbc", r: 2.4 }, LY.stage));

/* ---- labels ---- */
function initLabels() {
  const ox = LY.over;
  pill(ox, "Chromosome swap", 121, 112, 190, 92, "A swap between chromosomes 9 and 22. Part of each chromosome moves to the other.");
  pill(ox, "Fusion gene", 138, 275, 150, 318, "The Philadelphia chromosome carries the BCR-ABL fusion gene. It codes for a kinase that never switches off.");
  pill(ox, "Kinase on", KIN.x, KIN.y, 255, 318, "The BCR-ABL kinase stays switched on and drives growth signals. A kinase blocker plugs it.");
  pill(ox, "Stem cell", 381, 145, 445, 118, "The clonal stem cell. All its offspring carry the fusion. Transplant replaces it with a donor cell.");
  pill(ox, "Granulocytes", 560, 290, 540, 360, "Too many mature granulocytes. Chemotherapy kills dividing cells such as these.");
  pill(ox, "Blasts", 500, 215, 385, 362, "Immature blasts. Few early on, then dominant in blast phase when normal marrow fails.");
  pill(ox, "Blood", 732, 200, 700, 322, "Blood leaving the marrow. Granulocytes run high early, then red cells and platelets fall.");
  pill(ox, "Spleen", 805, 185, 862, 300, "The spleen swells as it filters excess cells, then shrinks back with effective treatment.");
  capEl = mk("text", { class: "cml-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
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
const sm = { K: 0.85, G: 0.7, B: 0.1, N: 0.7, Sp: 0.5, tx: 0, tki: 0, che: 0 };
const acc = { sig: 0, tki: 0, div: 0, che: 0, spill: 0 };
function setPool(pool, n, dt, bob) { pool.forEach((c, i) => { const want = i < n ? 1 : 0; c.s = lerp(c.s, want, Math.min(1, dt * 2.2)); place(c.g, c.x + Math.sin(tm / 700 + i * 1.7) * bob, c.y + Math.cos(tm / 900 + i) * bob, Math.sin(tm / 800 + i) * 6, Math.max(0.05, c.s)); c.g.style.opacity = c.s > 0.04 ? 1 : 0; }); }
function pickCell() { const all = grans.concat(blasts); return all[Math.floor(Math.random() * all.length)]; }
function init() { initOrgans(); initLabels(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 1.6);
  sm.K = lerp(sm.K, m.K, kk); sm.G = lerp(sm.G, m.G, kk); sm.B = lerp(sm.B, m.B, kk); sm.N = lerp(sm.N, m.N, kk); sm.Sp = lerp(sm.Sp, m.Sp, kk);
  sm.tx = lerp(sm.tx, m.drug === 3 ? 1 : 0, kk); sm.tki = lerp(sm.tki, m.drug === 2 ? 1 : 0, kk); sm.che = lerp(sm.che, m.drug === 1 ? 1 : 0, kk);
  const pulse = 1 + 0.1 * sm.K * Math.sin(tm / 280);
  LY.kinase.setAttribute("transform", "translate(150 352) scale(" + pulse.toFixed(3) + ") translate(-150 -352)");
  dock.forEach((d, i) => { d.e.setAttribute("opacity", (sm.tki * (0.7 + 0.3 * Math.sin(tm / 300 + i * 2))).toFixed(2)); });
  stems.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2) * 2, 0, Math.max(0.15, 1 - 0.85 * sm.tx)));
  donors.forEach((s, i) => { const sc = Math.max(0.001, sm.tx); place(s.g, s.x, s.y + Math.sin(tm / 800 + i * 2 + 1) * 2, 0, sc); s.g.setAttribute("opacity", sm.tx > 0.05 ? "1" : "0"); });
  progs.forEach((s, i) => place(s.g, s.x, s.y + Math.sin(tm / 700 + i) * 2, Math.sin(tm / 900 + i) * 8, Math.max(0.1, (1 - 0.3 * sm.B) * (1 - 0.75 * sm.tx))));
  setPool(grans, Math.round(sm.G * 24), dt, 1.6);
  setPool(blasts, Math.round(sm.B * 24), dt, 1.4);
  spleenO.g.setAttribute("transform", "translate(862 185) scale(" + (0.65 + 0.65 * sm.Sp).toFixed(3) + ")");
  vesselRbcs.forEach((r, i) => { r.y += r.v * 24 * (0.3 + sm.N) * dt; if (r.y > 282) { r.y = 96; r.x = 712 + Math.floor(rnd(0, 3)) * 22; } place(r.g, r.x, r.y, Math.sin(tm / 500 + i) * 14, 1); r.g.style.opacity = i < Math.round(sm.N * 9) ? 1 : 0; });
  vesselPlts.forEach((r, i) => { r.y += r.v * 18 * dt; if (r.y > 282) r.y = 100; place(r.g, r.x, r.y, 0, 1); r.g.style.opacity = i < Math.round(sm.N * 6) ? 1 : 0; });
  acc.sig += dt * sm.K * 7; while (acc.sig >= 1) { acc.sig--; const p = freeP(sigs); if (p) emit(p, 178, 352 + rnd(-8, 8), rnd(45, 70), rnd(-28, -12), 0); }
  sigs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x > 640) kill(p); });
  acc.div += dt * sm.G * 4; while (acc.div >= 1) { acc.div--; const p = freeP(divs); if (p) emit(p, rnd(460, 620), rnd(185, 300), rnd(-13, 13), rnd(-13, 13), 0); }
  divs.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  acc.tki += dt * (m.drug === 2 ? 4 : 0); while (acc.tki >= 1) { acc.tki--; const p = freeP(tkis); if (p) emit(p, rnd(300, 420), rnd(300, 360), 0, 0, 0); }
  tkis.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (KIN.x - p.x) * dt * 1.5; p.y += (KIN.y - p.y) * dt * 1.5; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(KIN.x - p.x, KIN.y - p.y) < 12 || p.t > 3) kill(p); });
  acc.che += dt * sm.che * 8; while (acc.che >= 1) { acc.che--; const p = freeP(chemos); if (p) emit(p, rnd(340, 630), 100, rnd(-8, 8), rnd(50, 80), 0); }
  chemos.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 320) / 55).toFixed(2)); if (p.y > 375) kill(p); });
  hits.forEach((h, i) => { h.t -= dt;
    if (sm.che > 0.4 && h.t <= 0) { h.t = rnd(0.4, 0.9); const c = pickCell(); h.x = c.x + rnd(-6, 6); h.y = c.y + rnd(-6, 6); h.g.setAttribute("transform", "translate(" + f1(h.x) + " " + f1(h.y) + ")"); }
    h.g.setAttribute("opacity", sm.che > 0.4 ? (0.35 + 0.65 * Math.abs(Math.sin(tm / 180 + i * 1.3))).toFixed(2) : "0"); });
  if (spillTrack) { acc.spill += dt * (0.4 + 7 * sm.G); while (acc.spill >= 1) { acc.spill--; const p = freeP(spill); if (p) { p.on = true; p.u = 0; p.e.setAttribute("opacity", "1"); } }
    spill.forEach((p) => { if (!p.on) return; p.u += dt * 60 / spillTrack.len; const q = spillTrack.at(Math.min(1, p.u)); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); if (p.u >= 1) kill(p); }); }
  gg.kin.set(sm.K, wordOf(sm.K, 0.3, 0.6, ["low", "raised", "high"])); gg.gran.set(sm.G, wordOf(sm.G, 0.25, 0.55, ["low", "raised", "high"]));
  gg.blast.set(sm.B, wordOf(sm.B, 0.15, 0.4, ["low", "raised", "high"])); gg.norm.set(sm.N, wordOf(sm.N, 0.35, 0.65, ["low", "reduced", "normal"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
