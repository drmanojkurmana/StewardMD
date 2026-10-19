/* Sickle scene: HbS tetramer, polymer fibres, sickled cells blocking a vessel, organ injury.
 * Each treatment visibly acts on the drawing: HbF shields cells, fluids widen the vessel,
 * transfusion adds donor cells that dilute the sickled cells and reopen flow. */
const CY = SC.CY, WW = SC.W;
const layers = { rbc: $("rbcs"), occ: $("occ"), haem: $("haem"), parts: $("parts"), over: $("over"), panel: $("panel"), stubs: $("stubs"), stuck: $("stuck") };
const lumenEl = $("lumen"), wallsEl = $("walls"), bagG = $("bagG");
const haloEls = [$("haloBrain"), $("haloSpleen"), $("haloJoint")];
/* ---- red cells flowing in the vessel (disc and sickle shapes in one group, plus an HbF shield dot) ---- */
const rbcs = [];
function initRbc() {
  for (let i = 0; i < 18; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.rbc);
    const disc = mk("ellipse", { class: "cl-b", rx: 10, ry: 6 }, g);
    const din = mk("ellipse", { class: "cl-s", rx: 3.6, ry: 1.8 }, g);
    const sick = mk("path", { class: "cl-b", d: "M-13 3Q0 -13 15 -3Q5 1 2 9Q-7 11 -13 3Z", opacity: "0" }, g);
    const hbf = mk("circle", { class: "sk-hbf", r: 2, cx: 5, cy: -2, opacity: "0" }, g);
    rbcs.push({ g, disc, din, sick, hbf, x: rnd(0, 690), y: rnd(-24, 24), v: rnd(0.8, 1.2), rot: rnd(-18, 18), th: rnd(0, 0.45) });
  }
}
/* ---- vaso-occlusion cluster: stacked sickled cells in the lumen ---- */
const occG = mk("g", {}, layers.occ);
[[-16, -14, -24], [4, -4, 12], [-8, 10, 38], [16, 12, -10]].forEach(function (p) {
  mk("path", { class: "sk-sickle", d: "M-15 3Q0 -15 17 -3Q6 1 3 10Q-8 13 -15 3Z", transform: "translate(" + p[0] + " " + p[1] + ") rotate(" + p[2] + ")" }, occG);
});
/* ---- HbF dots around the tetramer (hydroxycarbamide) ---- */
const hbfDots = [];
function initHbf() {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * 6.28, c = mk("circle", { class: "sk-hbf", r: 3.4, cx: f1(131 + Math.cos(a) * 52), cy: f1(146 + Math.sin(a) * 46), opacity: "0" }, layers.parts);
    hbfDots.push(c);
  }
}
/* ---- organs at risk as real anatomy, fed by small vessels off a manifold; sickles stick in the stubs ---- */
const stuck = [];
let brainO = null, spleenO = null, jointO = null;
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 829, 148, 130, {});
  spleenO = organ($("spleenSlot"), "spleen", 829, 258, 108, {});
  jointO = organ($("jointSlot"), "joint", 829, 356, 84, {});
  [[brainO, "Brain: blocked small vessels can injure the brain and cause stroke, sometimes silently."],
   [spleenO, "Spleen: sickled cells jam the spleen. It enlarges and traps blood in childhood, then scars and shrinks, raising infection risk."],
   [jointO, "Bones and joints: blocked vessels in bone cause the severe pain of a crisis and can damage joints."]].forEach(function (pair) {
    const O = pair[0];
    O.g.setAttribute("tabindex", "0");
    O.g.setAttribute("data-info", pair[1]);
    O.g.classList.add("hot");
    const x0 = O.x - O.w / 2 + 2;
    mk("path", { class: "sk-man", d: "M748 " + f1(O.y) + "H" + f1(x0) }, layers.stubs);
    stuck.push(mk("path", { class: "sk-sickle", d: "M-13 3Q0 -13 15 -3Q5 1 2 9Q-7 11 -13 3Z",
      transform: "translate(" + f1(748 + (x0 - 748) * 0.55) + " " + f1(O.y) + ") rotate(-8)" }, layers.stuck));
  });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const o2s = pool(12, () => mk("circle", { class: "sk-o2", r: 3 }, layers.parts));
const fluids = pool(16, () => mk("path", { class: "p-fluid", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const donors = pool(8, () => mk("circle", { class: "sk-drop", r: 3 }, layers.parts));
const frags = pool(16, () => mk("path", { class: "sk-frag", d: "M-5 -3Q0 3 6 -2" }, layers.haem));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- in-stage caption that follows the state ---- */
let capEl = null, capL = -1, capD = -1, hbfPill = null, donorPill = null;
function capText(l, d) {
  const L = l === 0 ? "Trait. Mostly normal haemoglobin, so little sickling."
    : l === 1 ? "Steady state. Some cells sickle and break apart early."
    : "Crisis. Sickled cells jam the vessel, causing pain.";
  const D = d === 1 ? " Hydroxycarbamide raises protective HbF."
    : d === 2 ? " Fluids open flow and pain relief eases pain."
    : d === 3 ? " Donor cells dilute sickled cells and reopen flow."
    : " No treatment, so the blockage grows.";
  return L + D;
}
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What the blood is doing";
  [["poly", "Polymer", "g-cyt", "Stiff HbS polymer inside the red cell. More polymer means more sickling."], ["sick", "Sickled cells", "g-bad", "Red cells bent into sickles by the polymer. They are stiff and sticky."], ["occ", "Vessel block", "g-clot", "Sickled cells jamming small vessels (vaso-occlusion). Flow beyond the jam falls."], ["haem", "Haemolysis", "g-eos", "Sickled cells break apart early. This causes anaemia and releases haemoglobin into the plasma."], ["pain", "Pain", "g-pain", "Pain of a vaso-occlusive crisis, mostly in bone. Hydration and analgesia ease it."], ["org", "Organ risk", "g-bad", "Risk of injury to brain, bone and spleen from blocked vessels and haemolysis."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Haemoglobin S", 131, 128, 131, 92, "Haemoglobin S (HbS): a point change in the beta globin chain swaps one building block. Two alpha and two beta chains make the tetramer; the changed spot is marked.");
  pill(ox, "Low oxygen", 229, 145, 229, 92, "Trigger: when HbS gives up its oxygen, for example in tissues working hard, it becomes sticky and can polymerise. Oxygenated HbS stays soluble.");
  pill(ox, "HbS polymer", 362, 145, 362, 92, "HbS polymer: deoxygenated HbS molecules stack into long stiff fibres inside the red cell.");
  pill(ox, "Sickled cell", 572, 148, 580, 92, "Sickled red cell: the polymer fibres bend and stiffen the cell into a crescent. Early sickling can reverse with oxygen; repeated sickling damages the cell for good.");
  pill(ox, "Blocked vessel", 560, 315, 560, 252, "Vaso-occlusion: stiff sickled cells jam in a small vessel and block flow. This causes pain and organ injury downstream.");
  pill(ox, "Haemolysis", 100, 404, 100, 380, "Haemolysis: damaged sickled cells burst or are removed early. Shorter red cell life causes anaemia; freed haemoglobin adds jaundice.");
  hbfPill = pill(ox, "Fetal haemoglobin", 131, 180, 140, 224, "Fetal haemoglobin (HbF): hydroxycarbamide raises HbF. HbF does not join the HbS polymer, so cells with more HbF sickle less.");
  hbfPill.setAttribute("id", "hbf-pill");
  donorPill = pill(ox, "Donor cells", 48, 262, 196, 204, "Donor red cells: transfusion adds red cells with normal haemoglobin and dilutes the sickled cells, so the jam clears.");
  donorPill.setAttribute("id", "donor-pill");
  capEl = mk("text", { class: "sk-cap", x: 480, y: 428, "text-anchor": "middle" }, ox); capEl.textContent = capText(1, 0);
}
const sm = { P: 0.3, Sick: 0.3, Occ: 0.2, Haem: 0.2, Pain: 0.2, Org: 0.2, HbF: 0.1, hyd: 0, lum: 0, don: 0 };
const acc = { o2: 0, fl: 0, fr: 0, dn: 0 };
function init() { initRbc(); initHbf(); initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.P = lerp(sm.P, m.P, k2); sm.Sick = lerp(sm.Sick, m.Sick, k2); sm.Occ = lerp(sm.Occ, m.Occ, k1); sm.Haem = lerp(sm.Haem, m.Haem, k2); sm.Pain = lerp(sm.Pain, m.Pain, k1); sm.Org = lerp(sm.Org, m.Org, k2); sm.HbF = lerp(sm.HbF, m.HbF, k2); sm.hyd = lerp(sm.hyd, m.hyd, k1);
  sm.lum = lerp(sm.lum, m.hyd, k2); sm.don = lerp(sm.don, m.txf, k1);
  /* tetramer mutation pulse and HbF ring */
  const mp = 1 + 0.25 * Math.sin(tm / 300);
  $("mutdot").setAttribute("transform", "translate(150 128) scale(" + mp.toFixed(2) + ") translate(-150 -128)");
  hbfDots.forEach((c) => c.setAttribute("opacity", (sm.HbF * 0.95).toFixed(2)));
  hbfPill.style.opacity = clamp((sm.HbF - 0.25) * 1.8).toFixed(2);
  /* polymer fibres and ghost cell stretch */
  $("fibres").setAttribute("opacity", sm.P.toFixed(2));
  $("polyGhost").setAttribute("transform", "translate(362 145) scale(" + (1 + 0.16 * sm.Sick).toFixed(3) + " 1) translate(-362 -145)");
  /* large cell: disc crossfades to sickle */
  $("bigdisc").setAttribute("opacity", (1 - sm.Sick).toFixed(2));
  $("bigdiscin").setAttribute("opacity", ((1 - sm.Sick) * 0.7).toFixed(2));
  const bs = $("bigsick");
  bs.setAttribute("opacity", sm.Sick.toFixed(2));
  bs.setAttribute("transform", "translate(572 148) rotate(" + f1(Math.sin(tm / 700) * 4) + ") scale(" + (0.7 + 0.3 * sm.Sick).toFixed(2) + ") translate(-572 -148)");
  /* fluids widen the vessel; transfusion bag and donor label appear */
  const top = 275 - 4 * sm.lum, bot = 355 + 8 * sm.lum;
  lumenEl.setAttribute("y", f1(top)); lumenEl.setAttribute("height", f1(bot - top));
  wallsEl.setAttribute("d", "M14 " + f1(top) + "H700M14 " + f1(bot) + "H700");
  bagG.setAttribute("opacity", sm.don.toFixed(2));
  bagG.style.display = sm.don > 0.03 ? "" : "none";
  donorPill.style.opacity = sm.don.toFixed(2);
  /* oxygen leaving the tetramer when polymer forms */
  acc.o2 += dt * sm.P * 5;
  while (acc.o2 >= 1) { acc.o2--; const p = freeP(o2s); if (p) emit(p, rnd(120, 170), rnd(120, 160), rnd(18, 34), rnd(-16, -6)); }
  o2s.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) killP(p); });
  /* red cells flow; the jam slows them, HbF shields alternate cells, donor cells stay round */
  const flow = clamp(1 - 0.78 * sm.Occ) * (1 + 0.35 * sm.hyd);
  const yRange = 24 + 6 * sm.lum, shield = sm.HbF > 0.3;
  rbcs.forEach((r, i) => {
    r.x += r.v * 62 * Math.max(0.08, flow) * dt;
    if (r.x > 706) { r.x = 8; r.y = rnd(-yRange, yRange); }
    const normal = sm.don > 0.5 && i < 10;
    let si = normal ? 0 : clamp(sm.Sick * 1.25 - r.th);
    if (shield && i % 2 === 0) si *= 0.25;
    r.disc.setAttribute("opacity", (1 - si).toFixed(2));
    r.din.setAttribute("opacity", ((1 - si) * 0.8).toFixed(2));
    r.sick.setAttribute("opacity", si.toFixed(2));
    r.hbf.setAttribute("opacity", shield && i % 2 === 0 ? 0.95 : 0);
    place(r.g, r.x, CY + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1);
  });
  /* occlusion cluster grows with block */
  place(occG, 562, CY, Math.sin(tm / 600) * 3, 0.15 + 0.85 * clamp(sm.Occ * 1.15));
  occG.style.opacity = sm.Occ > 0.06 ? 1 : 0;
  /* hydration fluid drops ride the flow */
  acc.fl += dt * sm.hyd * 7;
  while (acc.fl >= 1) { acc.fl--; const p = freeP(fluids); if (p) emit(p, 4, CY + rnd(-26, 26), 95, 0); }
  fluids.forEach((p) => { if (!p.on) return; p.x += p.vx * dt * Math.max(0.15, flow); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 704) killP(p); });
  /* donor drops enter from the transfusion tube and ride the flow */
  acc.dn += dt * sm.don * 6;
  while (acc.dn >= 1) { acc.dn--; const p = freeP(donors); if (p) emit(p, 48, 270 + rnd(-3, 3), rnd(80, 100), rnd(-4, 4)); }
  donors.forEach((p) => { if (!p.on) return; p.x += p.vx * dt * Math.max(0.15, flow); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 704) killP(p); });
  /* haemolysis fragments spill below the vessel */
  acc.fr += dt * sm.Haem * 6;
  while (acc.fr >= 1) { acc.fr--; const p = freeP(frags); if (p) emit(p, rnd(40, 130), bot + 8, rnd(-8, 8), rnd(14, 26)); }
  frags.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) killP(p); });
  /* organ damage halos fade as organs recover; stuck sickles clear from the stubs */
  haloEls.forEach((halo, i) => { halo.setAttribute("opacity", clamp(sm.Org * (0.55 + 0.15 * Math.sin(tm / 500 + i * 2))).toFixed(2)); });
  stuck.forEach((s, i) => { s.setAttribute("opacity", clamp(sm.Occ * (0.75 + 0.25 * Math.sin(tm / 600 + i * 2.1))).toFixed(2)); });
  /* gauges */
  gg.poly.set(sm.P, wordOf(sm.P, 0.25, 0.6, ["little", "some", "lots"]));
  gg.sick.set(sm.Sick, wordOf(sm.Sick, 0.25, 0.6, ["few", "some", "many"]));
  gg.occ.set(sm.Occ, wordOf(sm.Occ, 0.25, 0.6, ["open", "narrow", "blocked"]));
  gg.haem.set(sm.Haem, wordOf(sm.Haem, 0.25, 0.6, ["little", "some", "marked"]));
  gg.pain.set(sm.Pain, wordOf(sm.Pain, 0.25, 0.6, ["none", "some", "severe"]));
  gg.org.set(sm.Org, wordOf(sm.Org, 0.25, 0.6, ["low", "raised", "high"]));
  if (level !== capL || drug !== capD) { capL = level; capD = drug; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
