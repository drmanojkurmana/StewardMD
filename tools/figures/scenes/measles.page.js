/* Measles scene: droplet entry, respiratory and lymphoid replication, viraemia, prodrome signs, cephalocaudal rash, immune amnesia and complications. */
const LY = { air: $("air"), lymph: $("lymph"), vessel: $("vessel"), bodyfig: $("bodyfig"), organs: $("organs"), parts: $("parts"), over: $("over"), panel: $("panel") };
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: Math.random() }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* airway and lymphoid tissue */
mk("rect", { class: "ms-air", x: 36, y: 110, width: 200, height: 180, rx: 14 }, LY.air);
[[75, 155], [125, 155], [175, 155], [75, 205], [125, 205], [175, 205], [100, 255], [160, 255]].forEach(([x, y], i) => { const g = cell(LY.air, { cls: "epi", r: 17, nuc: 0.32, seed: i + 3, wob: 0.08 }); place(g, x, y, 0, 1); });
const vacBar = mk("rect", { class: "ms-vac", x: 48, y: 120, width: 176, height: 7, rx: 3.5, opacity: 0 }, LY.air);
mk("ellipse", { class: "ms-lymph", cx: 375, cy: 190, rx: 88, ry: 78 }, LY.lymph);
[[330, 155], [375, 140], [420, 155], [330, 205], [420, 205], [375, 225]].forEach(([x, y], i) => { const g = cell(LY.lymph, { cls: "lymc", r: 16, nuc: 0.35, seed: i + 11, wob: 0.1 }); place(g, x, y, 0, 1); });
const plasmaG = cell(LY.lymph, { cls: "plasma", r: 15, nuc: 0.3, seed: 21, wob: 0.1 }); place(plasmaG, 375, 182, 0, 1);
const memCells = [[335, 250], [375, 258], [415, 250]].map(([x, y], i) => { const g = cell(LY.lymph, { cls: "mem", r: 11, nuc: 0.35, seed: i + 31, wob: 0.12 }); place(g, x, y, 0, 1); return g; });

/* bloodstream */
mk("rect", { class: "ms-vessel", x: 36, y: 322, width: 544, height: 36, rx: 18 }, LY.vessel);
const vesselTrack = track([[44, 340], [572, 340]]);

/* body figure */
const feverHalo = mk("circle", { class: "ms-rash", cx: 632, cy: 138, r: 46, opacity: 0 }, LY.bodyfig);
mk("circle", { class: "ms-body", cx: 632, cy: 138, r: 36 }, LY.bodyfig);
mk("rect", { class: "ms-body", x: 592, y: 176, width: 80, height: 135, rx: 28 }, LY.bodyfig);
mk("rect", { class: "ms-body", x: 598, y: 311, width: 28, height: 58, rx: 12 }, LY.bodyfig);
mk("rect", { class: "ms-body", x: 638, y: 311, width: 28, height: 58, rx: 12 }, LY.bodyfig);
mk("path", { class: "ms-body", d: "M596 195L560 255M668 195L704 255", fill: "none", "stroke-width": 13, "stroke-linecap": "round" }, LY.bodyfig);
const eyeWhite = mk("ellipse", { class: "ms-eye", cx: 620, cy: 128, rx: 9, ry: 5 }, LY.bodyfig);
const eyeRed = mk("circle", { class: "ms-eye-red", cx: 620, cy: 128, r: 3.4, opacity: 0.25 }, LY.bodyfig);
mk("ellipse", { class: "ms-mouth", cx: 640, cy: 155, rx: 10, ry: 5 }, LY.bodyfig);
const koplik = [[636, 154], [641, 156], [645, 153]].map(([x, y]) => mk("circle", { class: "ms-koplik", cx: x, cy: y, r: 1.7 }, LY.bodyfig));
const rashSpots = [];
[[618, 118], [640, 112], [652, 132], [612, 148], [645, 158], [615, 195], [635, 205], [655, 198], [608, 225], [632, 235], [658, 228], [618, 258], [645, 265], [628, 288], [655, 295], [612, 330], [652, 335], [610, 355], [654, 358]].forEach(([x, y], i) => { const c = mk("circle", { class: "ms-rash", cx: x, cy: y, r: 3.6 - (i % 3) * 0.5, opacity: 0 }, LY.bodyfig); rashSpots.push(c); });

/* complication organs */
const lungG = mk("g", {}, LY.organs);
mk("path", { d: "M850 118L850 148", stroke: "var(--anatomy-mid)", "stroke-width": 5, "stroke-linecap": "round" }, lungG);
mk("ellipse", { class: "ms-lung", cx: 824, cy: 162, rx: 23, ry: 36 }, lungG);
mk("ellipse", { class: "ms-lung", cx: 876, cy: 162, rx: 23, ry: 36 }, lungG);
const lungPatch = mk("ellipse", { class: "ms-patch", cx: 824, cy: 170, rx: 13, ry: 20, opacity: 0 }, lungG);
const brainG = mk("g", {}, LY.organs);
mk("ellipse", { class: "ms-brain", cx: 850, cy: 282, rx: 44, ry: 33 }, brainG);
mk("path", { d: "M822 268C835 258 848 272 860 262M820 292C834 282 846 296 862 286M838 250C842 264 838 282 842 300", fill: "none", stroke: "var(--anatomy-mid)", "stroke-width": 1.1 }, brainG);
const brainGlow = mk("ellipse", { class: "ms-patch", cx: 850, cy: 282, rx: 30, ry: 20, opacity: 0 }, brainG);

/* particles */
const drops = mkPool(10, () => mk("circle", { class: "ms-drop", r: 3.4 }, LY.parts));
const virusAir = mkPool(16, () => mk("circle", { class: "sc-p p-virus", r: 3 }, LY.parts));
const virusLymph = mkPool(14, () => mk("circle", { class: "sc-p p-virus", r: 3 }, LY.parts));
const virBlood = mkPool(16, () => mk("circle", { class: "sc-p p-virus", r: 3.2 }, LY.parts));
virBlood.forEach((p) => { p.on = true; });
const antibodies = mkPool(12, () => { const g = mk("g", {}, LY.parts); mk("path", { class: "ms-ab-y", d: "M0 0L0 7M0 0L-4 -5M0 0L4 -5" }, g); return g; });
const supp = mkPool(10, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "sc-p p-ab", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
let dropAcc = 0, suppAcc = 0;

const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The illness";
  [["vir", "Viraemia", "g-vir", "Virus in the blood. Viraemia seeds skin, eye, airway and other organs and makes the person infectious through respiratory secretions."], ["rash", "Rash", "g-rash", "Maculopapular rash spreading from head to toe (cephalocaudal) as immune cells attack infected skin cells."], ["imm", "Immunity", "g-imm", "Protective antibodies and cellular responses that clear the virus and usually give lasting protection against measles itself."], ["amn", "Amnesia", "g-amn", "Immune amnesia: loss of some earlier antibody memory to other infections, raising the risk of other infections afterwards."], ["comp", "Complications", "g-comp", "Pneumonia, encephalitis and the rare late brain disease SSPE, particularly in young children and persons with weak cellular immunity."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 175, y0 + 2, 52, 18, cls, name, tip); });
  pill(LY.over, "Droplets", 70, 118, 78, 92, "Respiratory droplets and secretions carry measles virus to the nose, throat and airway of the next person.");
  pill(LY.over, "Lymphoid spread", 375, 132, 375, 92, "The virus replicates in respiratory epithelium and lymphoid tissue, then infected immune cells carry it through the body.");
  pill(LY.over, "Koplik spots", 640, 152, 545, 105, "Koplik spots: tiny white spots on the inner cheek mucosa that appear in the prodrome, shortly before the rash.");
  pill(LY.over, "Conjunctivitis", 620, 128, 722, 105, "Red, inflamed eyes with cough and coryza (runny nose) and fever make up the measles prodrome.");
  pill(LY.over, "Rash", 650, 224, 722, 190, "Maculopapular rash: flat and raised red spots that start on the face and spread downward over the body.");
  pill(LY.over, "Viraemia", 300, 340, 300, 385, "Viraemia: virus travelling in the blood seeds the skin, conjunctiva, respiratory tract and brain.");
  pill(LY.over, "Antibodies", 392, 182, 470, 385, "Antibodies and cellular immune responses clear infected cells. Vaccination makes protective antibodies before any illness.");
  pill(LY.over, "Immune amnesia", 375, 252, 578, 385, "Immune amnesia: measles can erase part of the antibody memory built against earlier infections.");
  pill(LY.over, "Pneumonia", 824, 162, 850, 208, "Pneumonia: lung infection by measles itself or by secondary bacterial infection. A leading cause of severe measles illness.");
  pill(LY.over, "Encephalitis", 850, 282, 850, 350, "Encephalitis: brain inflammation soon after measles. SSPE is a separate rare late brain disease that appears years later.");
}
const sm = { V: 0.7, R: 0, C: 0, I: 0.2, A: 0, K: 0.9, F: 0.8, vac: 0, supp: 0, conj: 0.8 };
function wander(pl, dt, want, x0, x1, y0, y1) {
  pl.forEach((p, i) => {
    if (i >= want) { if (p.on) kill(p); return; }
    if (!p.on) emit(p, rnd(x0, x1), rnd(y0, y1), rnd(-10, 10), rnd(-10, 10), 0);
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < x0 || p.x > x1) p.vx *= -1; if (p.y < y0 || p.y > y1) p.vy *= -1; p.x = clamp(p.x, x0, x1); p.y = clamp(p.y, y0, y1);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
}
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.V = lerp(sm.V, m.V, k); sm.R = lerp(sm.R, m.R, k); sm.C = lerp(sm.C, m.C, k); sm.I = lerp(sm.I, m.I, k); sm.A = lerp(sm.A, m.A, k); sm.K = lerp(sm.K, m.K, k); sm.F = lerp(sm.F, m.F, k); sm.vac = lerp(sm.vac, m.vac, k);
  sm.supp = lerp(sm.supp, (m.vit || m.cmpT) ? 1 : 0, k);
  const conjT = (m.level === 0 ? 0.95 : m.level === 1 ? 0.8 : 0.35) * (m.vac ? 0.08 : 1); sm.conj = lerp(sm.conj, conjT, k);
  vacBar.setAttribute("opacity", sm.vac.toFixed(2));
  feverHalo.setAttribute("opacity", (sm.F * 0.35).toFixed(2));
  eyeRed.setAttribute("opacity", (0.2 + 0.75 * sm.conj).toFixed(2));
  koplik.forEach((c) => c.setAttribute("opacity", clamp(sm.K * 1.2).toFixed(2)));
  rashSpots.forEach((c, i) => { const on = i < sm.R * rashSpots.length; c.setAttribute("opacity", on ? "0.9" : "0"); });
  memCells.forEach((g, i) => { g.setAttribute("opacity", clamp(1 - sm.A * 0.9).toFixed(2)); place(g, [335, 375, 415][i], [250, 258, 250][i], 0, Math.max(0.25, 1 - sm.A * 0.6)); });
  lungPatch.setAttribute("opacity", (sm.C * 0.65).toFixed(2));
  brainGlow.setAttribute("opacity", (sm.C * 0.45).toFixed(2));
  place(brainG, 0, 0, 0, 1); brainG.setAttribute("transform", "translate(" + f1(850 - 850 * (1 + sm.C * 0.05)) + " " + f1(282 - 282 * (1 + sm.C * 0.05)) + ") scale(" + (1 + sm.C * 0.05).toFixed(3) + ")");
  /* droplets enter the airway unless vaccine antibodies block them */
  dropAcc += dt * (1 - sm.vac * 0.85) * 2.2; while (dropAcc >= 1) { dropAcc--; const p = freeP(drops); if (p) emit(p, rnd(55, 215), 62, rnd(-3, 3), rnd(22, 32), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 0.8).toFixed(2)); if (p.y > 118 || p.t > 2.4) kill(p); });
  wander(virusAir, dt, Math.round(sm.V * virusAir.length), 52, 220, 124, 276);
  wander(virusLymph, dt, Math.round(sm.V * virusLymph.length), 302, 448, 126, 254);
  virBlood.forEach((p, i) => {
    if (sm.V < 0.06) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dt * 0.12 * (0.4 + sm.V); if (p.u > 1) p.u -= 1;
    const pos = vesselTrack.at(p.u); place(p.e, pos.x, pos.y + Math.sin(tm / 300 + i) * 6, 0, 1); p.e.setAttribute("opacity", clamp(sm.V * 1.3).toFixed(2));
  });
  wander(antibodies, dt, Math.round(sm.I * antibodies.length), 300, 700, 180, 335);
  suppAcc += dt * sm.supp * 2.6; while (suppAcc >= 1) { suppAcc--; const p = freeP(supp); if (p) emit(p, rnd(540, 580), 300, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  supp.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? 850 : 632, ty = p.k ? 200 : 210; p.x += (tx - p.x) * dt * 0.7; p.y += (ty - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.2) / 1).toFixed(2)); if (p.t > 4.2) kill(p); });
  gg.vir.set(sm.V, wordOf(sm.V, 0.25, 0.6, ["blocked", "spreading", "high"])); gg.rash.set(sm.R, wordOf(sm.R, 0.2, 0.55, ["absent", "appearing", "widespread"]));
  gg.imm.set(sm.I, wordOf(sm.I, 0.35, 0.7, ["building", "rising", "protective"])); gg.amn.set(sm.A, wordOf(sm.A, 0.2, 0.55, ["preserved", "partly lost", "marked loss"]));
  gg.comp.set(sm.C, wordOf(sm.C, 0.25, 0.55, ["unlikely", "possible", "present"]));
}
run({ init, step });
