/* Measles scene: droplet entry, airway and lymphoid replication, viraemia seeding lung and brain, prodrome signs, rash and immune amnesia.
 * Vaccine antibodies park on airway cells and block entry; vitamin A and complication care send visible support to lung and brain. */
const LY = { air: $("air"), lymph: $("lymph"), vessel: $("vessel"), seed: $("seedVessel"), bodyfig: $("bodyfig"), washBack: $("washBack"), lungSlot: $("lungSlot"), brainSlot: $("brainSlot"), washFront: $("washFront"), parts: $("parts"), over: $("over"), panel: $("panel") };
let lungL = null, lungR = null, brainO = null, capEl = null, capDrug = -1;
let vesselTrack = null, seedTrack = null;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0, u: Math.random() }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* airway chamber with lining cells */
mk("rect", { class: "ms-air", x: 36, y: 110, width: 200, height: 180, rx: 14 }, LY.air);
const EPI = [[75, 155], [125, 155], [175, 155], [75, 205], [125, 205], [175, 205], [100, 255], [160, 255]];
EPI.forEach(([x, y], i) => { const g = cell(LY.air, { cls: "epi", r: 17, nuc: 0.32, seed: i + 3, wob: 0.08 }); place(g, x, y, 0, 1); });
/* vaccine antibodies parked on airway cells: the blocker sitting on its receptor */
const shieldAbs = EPI.map(([x, y]) => { const g = mk("g", {}, LY.air); mk("path", { class: "ms-ab-y", d: "M0 0L0 7M0 0L-4 -5M0 0L4 -5" }, g); place(g, x - 9, y - 11, 0, 1.4); g.setAttribute("opacity", "0"); return g; });
/* lymphoid chamber with lymphocytes, a plasma cell and memory cells */
mk("ellipse", { class: "ms-lymph", cx: 375, cy: 190, rx: 88, ry: 78 }, LY.lymph);
[[330, 155], [375, 140], [420, 155], [330, 205], [420, 205], [375, 225]].forEach(([x, y], i) => { const g = cell(LY.lymph, { cls: "lymc", r: 16, nuc: 0.35, seed: i + 11, wob: 0.1 }); place(g, x, y, 0, 1); });
const plasmaG = cell(LY.lymph, { cls: "plasma", r: 15, nuc: 0.3, seed: 21, wob: 0.1 }); place(plasmaG, 375, 182, 0, 1);
const memCells = [[335, 250], [375, 258], [415, 250]].map(([x, y], i) => { const g = cell(LY.lymph, { cls: "mem", r: 11, nuc: 0.35, seed: i + 31, wob: 0.12 }); place(g, x, y, 0, 1); return g; });

/* bloodstream */
mk("rect", { class: "ms-vessel", x: 36, y: 322, width: 544, height: 36, rx: 18 }, LY.vessel);

/* body figure with prodrome signs and a cephalocaudal rash */
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

/* infection washes and care halos behind the organs; focal patches in front */
const airWash = mk("rect", { class: "ms-wash", x: 36, y: 110, width: 200, height: 180, rx: 14, opacity: 0 }, LY.washBack);
const lymphWash = mk("ellipse", { class: "ms-wash", cx: 375, cy: 190, rx: 88, ry: 78, opacity: 0 }, LY.washBack);
const lungWash = mk("ellipse", { class: "ms-wash", cx: 850, cy: 162, rx: 62, ry: 48, opacity: 0 }, LY.washBack);
const lungHalo = mk("ellipse", { class: "ms-halo", cx: 850, cy: 162, rx: 72, ry: 58, opacity: 0 }, LY.washBack);
const brainHalo = mk("ellipse", { class: "ms-halo", cx: 850, cy: 286, rx: 58, ry: 46, opacity: 0 }, LY.washBack);
const shield = mk("rect", { class: "ms-shield", x: 36, y: 110, width: 200, height: 180, rx: 14, opacity: 0 }, LY.washBack);
const rashWash = mk("ellipse", { class: "ms-rashwash", cx: 632, cy: 235, rx: 58, ry: 100, opacity: 0 }, LY.washFront);
const lungPatch = mk("ellipse", { class: "ms-focus", cx: 850, cy: 168, rx: 34, ry: 40, opacity: 0 }, LY.washFront);
const brainGlow = mk("ellipse", { class: "ms-focus", cx: 850, cy: 286, rx: 42, ry: 32, opacity: 0 }, LY.washFront);

/* particles */
const drops = mkPool(10, () => mk("circle", { class: "ms-drop", r: 3.4 }, LY.parts));
const virusAir = mkPool(16, () => mk("circle", { class: "sc-p p-virus", r: 3 }, LY.parts));
const virusLymph = mkPool(14, () => mk("circle", { class: "sc-p p-virus", r: 3 }, LY.parts));
const virBlood = mkPool(16, () => mk("circle", { class: "sc-p p-virus", r: 3.2 }, LY.parts));
virBlood.forEach((p) => { p.on = true; });
const seeders = mkPool(10, () => mk("circle", { class: "sc-p p-virus", r: 3 }, LY.parts));
seeders.forEach((p, i) => { p.u = i / seeders.length; p.on = true; });
const antibodies = mkPool(14, () => { const g = mk("g", {}, LY.parts); mk("path", { class: "ms-ab-y", d: "M0 0L0 7M0 0L-4 -5M0 0L4 -5" }, g); return g; });
const supp = mkPool(14, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "sc-p p-ab", x: -6, y: -2.8, width: 12, height: 5.6, rx: 2.8 }, g); return g; });
let dropAcc = 0, suppAcc = 0;

function initOrgans() {
  lungL = organ(LY.lungSlot, "lung", 815, 160, 70, { flip: true });
  lungR = organ(LY.lungSlot, "lung", 885, 160, 70, {});
  brainO = organ(LY.brainSlot, "brain", 850, 286, 136, {});
  mk("path", { class: "ms-tube", d: "M850 116 L850 148", fill: "none" }, LY.lungSlot);
  vesselTrack = track([[44, 340], [572, 340]]);
  const hp = (lungL.ports.hilumL || lungL.ports.in || [786, 195]);
  LY.seed.setAttribute("d", "M572 340 C650 336 720 300 " + f1(hp[0]) + " " + f1(hp[1]));
  seedTrack = track([[572, 340], [650, 332], [720, 290], [hp[0], hp[1]]]);
}
function capText(d) {
  if (d === 1) return "Vitamin A and supportive care shield the lungs. The rash still comes but complications ease.";
  if (d === 2) return "Vaccine prevention blocks the virus at the airway. Almost no rash and no complications.";
  if (d === 3) return "Treating complications supports the lungs and brain while immunity clears the virus.";
  return "No treatment. Virus fills the blood, the rash spreads and the lungs and brain suffer.";
}
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The illness";
  [["vir", "Viraemia", "g-vir", "Virus in the blood. Viraemia seeds skin, eye, airway and other organs and makes the person infectious through respiratory secretions."], ["rash", "Rash", "g-rash", "Maculopapular rash spreading from head to toe as immune cells attack infected skin cells."], ["imm", "Immunity", "g-imm", "Protective antibodies and cellular responses that clear the virus and usually give lasting protection against measles itself."], ["amn", "Amnesia", "g-amn", "Immune amnesia: loss of some earlier antibody memory to other infections, raising the risk of other infections afterwards."], ["comp", "Complications", "g-comp", "Pneumonia, encephalitis and the rare late brain disease SSPE, particularly in young children and persons with weak cellular immunity."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 175, y0 + 2, 52, 18, cls, name, tip); });
  pill(LY.over, "Airway", 100, 150, 110, 92, "Airway lining: droplets land here and the virus copies itself. Parked vaccine antibodies block entry.");
  pill(LY.over, "Lymphoid", 375, 150, 375, 92, "Lymphoid tissue: the virus multiplies here, then rides immune cells into the blood.");
  pill(LY.over, "Prodrome", 630, 138, 540, 92, "Prodrome: fever with cough, runny nose, red eyes and tiny mouth spots before the rash.");
  pill(LY.over, "Rash", 652, 230, 722, 190, "Rash: red spots start on the face and spread down as immune cells attack infected skin.");
  pill(LY.over, "Lung", 800, 155, 740, 150, "Lung: measles can bring pneumonia, from the virus itself or added bacterial infection.");
  pill(LY.over, "Blood", 300, 340, 300, 385, "Blood: virus in the blood seeds the skin, eyes, lungs and brain.");
  pill(LY.over, "Antibodies", 405, 205, 478, 385, "Antibodies: plasma cells make them to clear the virus. Measles can also wipe out old memory cells.");
  pill(LY.over, "Brain", 850, 286, 850, 368, "Brain: swelling soon after measles. A rare late brain disease can follow years later.");
  capEl = mk("text", { class: "ms-cap", x: 30, y: 428 }, LY.over); capEl.textContent = capText(0);
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
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.V = lerp(sm.V, m.V, k); sm.R = lerp(sm.R, m.R, k); sm.C = lerp(sm.C, m.C, k); sm.I = lerp(sm.I, m.I, k); sm.A = lerp(sm.A, m.A, k); sm.K = lerp(sm.K, m.K, k); sm.F = lerp(sm.F, m.F, k); sm.vac = lerp(sm.vac, m.vac, k);
  sm.supp = lerp(sm.supp, (m.vit || m.cmpT) ? 1 : 0, k);
  const conjT = (m.level === 0 ? 0.95 : m.level === 1 ? 0.8 : 0.35) * (m.vac ? 0.08 : 1); sm.conj = lerp(sm.conj, conjT, k);
  shield.setAttribute("opacity", (sm.vac * 0.42).toFixed(2));
  airWash.setAttribute("opacity", (sm.V * 0.30).toFixed(2));
  lymphWash.setAttribute("opacity", (sm.V * 0.32).toFixed(2));
  lungWash.setAttribute("opacity", (sm.V * 0.30).toFixed(2));
  rashWash.setAttribute("opacity", (sm.R * 0.42).toFixed(2));
  lungPatch.setAttribute("opacity", (sm.C * 0.70).toFixed(2));
  brainGlow.setAttribute("opacity", (sm.C * 0.55).toFixed(2));
  lungHalo.setAttribute("opacity", (sm.supp * 0.38).toFixed(2));
  brainHalo.setAttribute("opacity", (sm.supp * 0.38).toFixed(2));
  LY.seed.setAttribute("opacity", (0.25 + 0.65 * sm.V).toFixed(2));
  LY.seed.setAttribute("stroke-width", f1(1.5 + 3.5 * sm.V));
  feverHalo.setAttribute("opacity", (sm.F * 0.35).toFixed(2));
  eyeRed.setAttribute("opacity", (0.2 + 0.75 * sm.conj).toFixed(2));
  koplik.forEach((c) => c.setAttribute("opacity", clamp(sm.K * 1.2).toFixed(2)));
  rashSpots.forEach((c, i) => { const on = i < sm.R * rashSpots.length; c.setAttribute("opacity", on ? "0.9" : "0"); });
  shieldAbs.forEach((g) => g.setAttribute("opacity", sm.vac.toFixed(2)));
  memCells.forEach((g, i) => { g.setAttribute("opacity", clamp(1 - sm.A * 0.9).toFixed(2)); place(g, [335, 375, 415][i], [250, 258, 250][i], 0, Math.max(0.25, 1 - sm.A * 0.6)); });
  /* droplets fall into the airway; parked vaccine antibodies neutralise them at the shield line */
  dropAcc += dt * (1 - sm.vac * 0.9) * 2.4; while (dropAcc >= 1) { dropAcc--; const p = freeP(drops); if (p) emit(p, rnd(55, 215), 62, rnd(-3, 3), rnd(22, 32), 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (!p.k && p.y >= 112 && sm.vac > 0.4) { p.k = 1; p.e.setAttribute("class", "sc-p p-ab"); p.vy = -12; p.vx = rnd(-16, 16); }
    if (p.k) { p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y < 58) kill(p); }
    else { p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 0.8).toFixed(2)); if (p.y > 118 || p.t > 2.4) kill(p); }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  wander(virusAir, dt, Math.round(sm.V * virusAir.length), 52, 220, 124, 276);
  wander(virusLymph, dt, Math.round(sm.V * virusLymph.length), 302, 448, 126, 254);
  virBlood.forEach((p, i) => {
    if (sm.V < 0.06) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dt * 0.12 * (0.4 + sm.V); if (p.u > 1) p.u -= 1;
    const pos = vesselTrack.at(p.u); place(p.e, pos.x, pos.y + Math.sin(tm / 300 + i) * 6, 0, 1); p.e.setAttribute("opacity", clamp(sm.V * 1.3).toFixed(2));
  });
  seeders.forEach((p) => {
    if (sm.V < 0.06) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dt * 0.10 * (0.35 + sm.V); if (p.u > 1) p.u -= 1;
    const q = seedTrack.at(p.u); place(p.e, q.x, q.y + Math.sin(tm / 320 + p.u * 9) * 5, 0, 1); p.e.setAttribute("opacity", clamp(sm.V * 1.4).toFixed(2));
  });
  wander(antibodies, dt, Math.round(sm.I * antibodies.length), 300, 700, 170, 330);
  /* support doses travel from the blood to the lungs and brain */
  suppAcc += dt * sm.supp * 3.4; while (suppAcc >= 1) { suppAcc--; const p = freeP(supp); if (p) { let tx = 850, ty = 168;
    if (drug === 3 && Math.random() < 0.5 && brainO) { const pa = brainO.ports.parenchyma || [850, 286]; tx = pa[0]; ty = pa[1]; }
    else if (drug === 1 && Math.random() < 0.5) { tx = 632; ty = 215; }
    p.tx = tx; p.ty = ty; emit(p, rnd(545, 575), rnd(330, 350), 0, 0, 0); } }
  supp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.tx - p.x) * dt * 0.8; p.y += (p.ty - p.y) * dt * 0.8; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.2)).toFixed(2)); if (p.t > 4.2) kill(p); });
  gg.vir.set(sm.V, wordOf(sm.V, 0.25, 0.6, ["blocked", "spreading", "high"])); gg.rash.set(sm.R, wordOf(sm.R, 0.2, 0.55, ["absent", "appearing", "widespread"]));
  gg.imm.set(sm.I, wordOf(sm.I, 0.35, 0.7, ["building", "rising", "protective"])); gg.amn.set(sm.A, wordOf(sm.A, 0.2, 0.55, ["preserved", "partly lost", "marked loss"]));
  gg.comp.set(sm.C, wordOf(sm.C, 0.25, 0.55, ["unlikely", "possible", "present"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
