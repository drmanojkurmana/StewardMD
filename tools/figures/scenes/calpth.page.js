/* Calcium and parathyroid hormone scene: gland sensing, PTH drive, bone resorption,
 * renal calcium saving with vitamin D switch on, gut uptake, muscle tone, and a
 * visible action for every treatment (gut top up, kidney flush, bone coat,
 * sensor blocker sitting on its receptor, adenoma removal). */
const layers = {
  parts: $("particles"),
  over: $("over"),
  panel: $("panel"),
  vBone: $("vBone"),
  vKid: $("vKid"),
  vVitD: $("vVitD"),
  vBCa: $("vBCa"),
  vGCa: $("vGCa"),
  vFb: $("vFb"),
  vCaM: $("vCaM"),
  vCaK: $("vCaK"),
};
let thyO = null, kidO = null, gutO = null, capEl = null, capDrug = -1;
let trPTHbone = null, trPTHkid = null, trVitD = null, trVitG = null, trBoneCa = null;
let trGutCa = null, trFb = null, trCaM = null, trCaK = null, trPoolBone = null, trPoolGland = null;
const CASR = [199, 172], BONF = [730, 150], POOL = [480, 250];

/* fixed landmarks (thyroid art is procedural, so its ports are fixed; bone is a fixed panel) */
const GTOP = [177, 102], GL = [113, 160], GFB = [188, 172];
const BONL = [718, 138], BONC = [730, 168];
const POOLR = [552, 252], POOLR2 = [552, 258], POOLL = [408, 244], POOLT = [480, 202], POOLB = [435, 275];

function nearest(ports, hint) {
  let best = null, bd = 1e9;
  for (const k in ports) {
    const p = ports[k];
    const d = Math.hypot(p[0] - hint[0], p[1] - hint[1]);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? [best[0], best[1]] : hint.slice();
}
function setVessel(el, pts) {
  el.setAttribute("d", "M" + f1(pts[0][0]) + " " + f1(pts[0][1]) + " C" + f1(pts[1][0]) + " " + f1(pts[1][1]) +
    " " + f1(pts[2][0]) + " " + f1(pts[2][1]) + " " + f1(pts[3][0]) + " " + f1(pts[3][1]));
}
function initOrgans() {
  thyO = organ($("thySlot"), "thyroid", 150, 160, 170, {});
  kidO = organ($("kidSlot"), "kidney", 150, 335, 150, {});
  gutO = organ($("gutSlot"), "intestine", 800, 335, 180, {});
  const KP = kidO.ports, GP = gutO.ports;
  const kTop = nearest(KP, [150, 262]), kIn = nearest(KP, [212, 318]), kR = nearest(KP, [228, 352]);
  const guL = nearest(GP, [712, 348]);
  const pBone = [GTOP, [320, 88], [560, 92], BONL];
  const pKid = [GL, [105, 200], [112, 235], kTop];
  const pVitD = [kR, [400, 382], [600, 382], guL];
  const pVitG = [kTop, [120, 220], [150, 185], GFB];
  const pBCa = [BONC, [650, 210], [560, 240], POOLR];
  const pGCa = [guL, [640, 295], [565, 265], POOLR2];
  const pFb = [POOLL, [320, 215], [240, 190], GFB];
  const pCaK = [POOLB, [340, 292], [255, 308], kIn];
  setVessel(layers.vBone, pBone);
  setVessel(layers.vKid, pKid);
  setVessel(layers.vVitD, pVitD);
  setVessel(layers.vBCa, pBCa);
  setVessel(layers.vGCa, pGCa);
  setVessel(layers.vFb, pFb);
  setVessel(layers.vCaK, pCaK);
  layers.vCaM.setAttribute("d", "M" + f1(POOLT[0]) + " " + f1(POOLT[1]) + " L480 142");
  trPTHbone = track(pBone); trPTHkid = track(pKid); trVitD = track(pVitD); trVitG = track(pVitG);
  trBoneCa = track(pBCa); trGutCa = track(pGCa); trFb = track(pFb);
  trCaM = track([POOLT, [480, 142]]); trCaK = track(pCaK);
  trPoolBone = track([POOLR, [560, 240], [650, 210], BONC]);
  trPoolGland = track([POOLL, [320, 215], [240, 190], GFB]);
}

/* caption per treatment, plain words */
function capText(d) {
  if (d === 1) return "Calcium with active vitamin D tops up gut uptake. Blood calcium climbs back.";
  if (d === 2) return "Saline flush helps the kidney wash extra calcium out in urine. Stones slow.";
  if (d === 3) return "Bisphosphonate coats bone and quiets the bone eating cells. Less calcium leaves bone.";
  if (d === 4) return "Calcimimetic sits on the gland sensor. The gland releases less PTH.";
  if (d === 5) return "Surgery removes the overactive gland tissue. PTH falls and calcium settles.";
  return "No treatment. Gland signals move calcium between bone, kidney and gut.";
}

/* ---- particle pools (every pool item carries its element as p.e) ---- */
function pool(n, build) {
  return Array.from({ length: n }, () => {
    const e = build();
    e.setAttribute("opacity", "0");
    return { e, on: false, u: 0, k: 0, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0 };
  });
}
const free = (pl) => pl.find((p) => !p.on);
function emit(p, k) {
  p.on = true;
  p.u = 0;
  p.k = k || 0;
  p.t = 0;
  p.life = 0;
  p.e.setAttribute("opacity", "1");
}
function kill(p) {
  p.on = false;
  p.e.setAttribute("opacity", "0");
}
const plPTH = pool(16, () => mk("polygon", { class: "p-pth", points: "0,-3.2 3.2,0 0,3.2 -3.2,0" }, layers.parts));
const plCa = pool(26, () => mk("circle", { class: "p-ca", r: 2.5 }, layers.parts));
const plPO4 = pool(12, () => mk("circle", { class: "p-po4", r: 2.2 }, layers.parts));
const plVitD = pool(12, () => mk("polygon", { class: "p-vitd", points: "-2.6,-2.6 2.6,-2.6 2.6,2.6 -2.6,2.6" }, layers.parts));
const plTxCal = pool(8, () => mk("rect", { class: "p-tx-cal", x: -4, y: -2, width: 8, height: 4, rx: 2 }, layers.parts));
const plTxFl = pool(10, () => mk("circle", { class: "p-tx-fl", r: 2.6 }, layers.parts));
const plTxBisp = pool(8, () => mk("polygon", { class: "p-tx-bisp", points: "0,-3.5 3.5,0 0,3.5 -3.5,0" }, layers.parts));
const plTxCmim = pool(8, () => mk("circle", { class: "p-tx-cmim", r: 2.4 }, layers.parts));

/* dynamic anatomy refs */
const ptGlands = ["pt-gland-a", "pt-gland-b", "pt-gland-c"].map((id) => $(id));
const ptAdenoma = $("pt-adenoma");
const ptAdenomaGlow = $("pt-adenoma-glow");
const ptScars = $("pt-scars");
const ptCasr = $("pt-casr");
const ptPtxRing = $("ptx-cut");
const boneLacuna = $("bone-lacuna");
const osteoclast = $("osteoclast");
const bispCoat = $("bisp-coat");
const kidneyStone = $("kidney-stone");
const gutPumps = $("gut-pumps");
const nmMuscle = $("nm-muscle-wrap");
const nmSparks = $("nm-sparks");
const nmBadge = $("nm-badge");
const glandWash = $("glandWash"), boneWash = $("boneWash"), kidWash = $("kidWash");
const gutWash = $("gutWash"), bloodWash = $("bloodWash");

const sm = { pth: 0.5, ca: 0.5, po4: 0.5, vitD: 0.5, bone: 0.5, gut: 0.5, dCalVit: 0, dFluids: 0, dBisp: 0, dCmim: 0, dPtx: 0 };
const acc = { pth: 0, ca: 0, po4: 0, vitd: 0, txCalVit: 0, txFluids: 0, txBisp: 0, txCmim: 0 };

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, w = 18;
  const xs = [100, 252, 404, 556, 708, 860];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Hormone, calcium and organs";
  const defs = [
    ["pth", "Parathyroid hormone", "g-eos", "PTH from the glands. Raises calcium by acting on bone, kidney and vitamin D."],
    ["ca", "Serum calcium", "g-fl", "Calcium in blood. Low brings cramps and spasms, high brings weakness and stones."],
    ["po4", "Serum phosphate", "g-cyt", "Phosphate in blood. PTH wastes it in urine while the gut absorbs more."],
    ["vitD", "Active vitamin D", "g-neu", "Switched on in the kidney under PTH control. Tells the gut to absorb calcium."],
    ["bone", "Bone resorption", "g-bad", "Bone eating cells dissolving mineral. Releases calcium into blood."],
    ["gut", "Gut absorption", "g-good", "Calcium taken up from food in the gut, driven by active vitamin D."],
  ];
  defs.forEach(([id, name, cls, tip], i) => {
    gg[id] = gauge(P, xs[i], y0 + 2, h, w, cls, name, tip);
  });
  const ox = layers.over;
  const Q = (t, x, y, tx, ty, info) => pill(ox, t, x, y, tx, ty, info);
  Q("Glands", 140, 150, 150, 66,
    "Parathyroid glands on the thyroid. They sense calcium and release PTH when it falls.");
  const pd = trPTHbone.at(0.3);
  Q("PTH", pd.x, pd.y, 430, 66,
    "Parathyroid hormone travelling to bone and kidney. Raises calcium, wastes phosphate.");
  Q("Muscle", 540, 115, 620, 66,
    "Muscle and nerve tone follows calcium. Low brings cramp, high brings weakness.");
  Q("Bone", 790, 140, 810, 66,
    "Bone mineral store. PTH wakes bone eating cells that release calcium into blood.");
  Q("Blood calcium", POOL[0], POOL[1], 480, 308,
    "Blood calcium pool. Bone, gut and kidney all add or remove calcium here.");
  const kL = nearest(kidO.ports, [80, 335]);
  Q("Kidney", kL[0], kL[1], 58, 292,
    "Kidney. Saves calcium, wastes phosphate, and switches on vitamin D under PTH.");
  const gL = nearest(gutO.ports, [712, 348]);
  Q("Gut", gL[0], gL[1], 862, 252,
    "Gut. Absorbs calcium from food when active vitamin D tells it to.");
  capEl = mk("text", { class: "cp-cap", x: 30, y: 428 }, ox);
  capEl.textContent = capText(0);
}

function init() {
  initOrgans();
  initPanel();
}

function move(pl, getTr, sp) {
  pl.forEach((p) => {
    if (!p.on) return;
    const T = getTr(p);
    p.u += (sp / T.len) * 0.05;
    if (p.u >= 1) {
      kill(p);
      return;
    }
    const q = T.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
  });
}

function step(dt, m) {
  const k = Math.min(1, dt * 2.0);
  ["pth", "ca", "po4", "vitD", "bone", "gut", "dCalVit", "dFluids", "dBisp", "dCmim", "dPtx"].forEach((n) => {
    sm[n] = lerp(sm[n], m[n], k);
  });

  /* glands: failure scars, adenoma growth, sensor glow, surgery ring */
  const isHypo = m.words[1] === "low" && m.words[0] === "low";
  const adenomaActivity = Math.max(0, (sm.pth - 0.55) / 0.45);
  ptScars.setAttribute("opacity", isHypo ? (1 - sm.pth * 1.5).toFixed(2) : "0");
  const quiet = 1 - 0.45 * Math.max(sm.dCmim, sm.dPtx);
  ptGlands.forEach((g) => g.setAttribute("opacity", (isHypo ? 0.3 : quiet).toFixed(2)));
  const adScale = (1 + adenomaActivity * 1.6 + (adenomaActivity > 0.1 ? 0.08 * Math.sin(tm / 250) : 0)) * (1 - 0.75 * sm.dPtx);
  ptAdenoma.setAttribute("transform", "translate(174 180) scale(" + Math.max(0.2, adScale).toFixed(3) + ")");
  ptAdenomaGlow.setAttribute("opacity", (adenomaActivity * (1 - sm.dPtx) * 0.85).toFixed(2));
  ptCasr.setAttribute("stroke-opacity", clamp(0.2 + 0.8 * sm.ca + 0.3 * sm.dCmim, 0, 1).toFixed(2));
  ptPtxRing.setAttribute("opacity", sm.dPtx.toFixed(2));
  glandWash.setAttribute("opacity", clamp(0.05 + 0.4 * sm.dCmim + 0.4 * sm.dPtx, 0, 0.85).toFixed(2));

  /* bone: osteoclast shrinks and stills as bisphosphonate coats the surface */
  const ocWobble = sm.bone * 0.12 * Math.sin(tm / 180);
  osteoclast.setAttribute("transform", "translate(" + (742 + ocWobble * 15).toFixed(1) + " 145) scale(" + (0.8 + 0.4 * sm.bone).toFixed(2) + ")");
  boneLacuna.setAttribute("stroke-width", (1.5 + 2.5 * sm.bone).toFixed(1));
  bispCoat.setAttribute("opacity", sm.dBisp.toFixed(2));
  boneWash.setAttribute("opacity", (0.05 + 0.5 * sm.dBisp).toFixed(2));

  /* kidney stone follows calcium; flush wash shows saline at work */
  const stoneOp = Math.max(0, (sm.ca - 0.68) * 3.2);
  kidneyStone.setAttribute("opacity", stoneOp.toFixed(2));
  kidWash.setAttribute("opacity", (0.05 + 0.45 * sm.dFluids).toFixed(2));

  /* gut pumps and washes: replacement visibly tops up uptake */
  gutPumps.setAttribute("opacity", (0.2 + 0.8 * sm.gut).toFixed(2));
  gutWash.setAttribute("opacity", (0.06 + 0.5 * sm.dCalVit).toFixed(2));
  bloodWash.setAttribute("opacity", (0.05 + 0.4 * sm.dCalVit).toFixed(2));

  /* muscle tone follows calcium */
  if (sm.ca < 0.35) {
    const tremor = Math.sin(tm / 40) * 2.2 * (0.35 - sm.ca) * 6;
    nmMuscle.setAttribute("transform", "translate(" + (488 + tremor).toFixed(1) + " 92)");
    nmSparks.setAttribute("opacity", (0.5 + 0.5 * Math.sin(tm / 70)).toFixed(2));
    if (nmBadge.textContent !== "cramp and spasm") {
      nmBadge.textContent = "cramp and spasm";
      nmBadge.setAttribute("class", "cp-badge cp-badge-bad");
    }
  } else if (sm.ca > 0.7) {
    nmMuscle.setAttribute("transform", "translate(488 92)");
    nmSparks.setAttribute("opacity", "0");
    if (nmBadge.textContent !== "weak and tired") {
      nmBadge.textContent = "weak and tired";
      nmBadge.setAttribute("class", "cp-badge cp-badge-warn");
    }
  } else {
    nmMuscle.setAttribute("transform", "translate(488 92)");
    nmSparks.setAttribute("opacity", "0");
    if (nmBadge.textContent !== "stable muscle tone") {
      nmBadge.textContent = "stable muscle tone";
      nmBadge.setAttribute("class", "cp-badge cp-badge-ok");
    }
  }

  /* hormone and ion emissions, all model driven */
  acc.pth += dt * sm.pth * 4.2;
  while (acc.pth >= 1) {
    acc.pth--;
    const p = free(plPTH);
    if (p) emit(p, Math.random() < 0.6 ? 0 : 1);
  }
  acc.vitd += dt * sm.vitD * 3.8;
  while (acc.vitd >= 1) {
    acc.vitd--;
    const p = free(plVitD);
    if (p) emit(p, Math.random() < 0.8 ? 0 : 1);
  }
  acc.ca += dt * (sm.bone * 2.5 + sm.gut * 2.8 + sm.ca * 2.0);
  while (acc.ca >= 1) {
    acc.ca--;
    const p = free(plCa);
    if (p) {
      const r = Math.random();
      const kk = r < 0.3 ? 0 : r < 0.6 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4;
      emit(p, kk);
    }
  }
  acc.po4 += dt * (sm.bone * 1.5 + sm.gut * 1.5);
  while (acc.po4 >= 1) {
    acc.po4--;
    const p = free(plPO4);
    if (p) emit(p, Math.random() < 0.5 ? 0 : 1);
  }

  /* treatment actions, each animated at its target */
  acc.txCalVit += dt * sm.dCalVit * 2.4;
  while (acc.txCalVit >= 1) {
    acc.txCalVit--;
    const p = free(plTxCal);
    if (p) emit(p);
  }
  acc.txFluids += dt * sm.dFluids * 3.0;
  while (acc.txFluids >= 1) {
    acc.txFluids--;
    const p = free(plTxFl);
    if (p) emit(p);
  }
  acc.txBisp += dt * sm.dBisp * 1.8;
  while (acc.txBisp >= 1) {
    acc.txBisp--;
    const p = free(plTxBisp);
    if (p) { emit(p); p.t = 0; }
  }
  acc.txCmim += dt * sm.dCmim * 2.0;
  while (acc.txCmim >= 1) {
    acc.txCmim--;
    const p = free(plTxCmim);
    if (p) { emit(p); p.t = 0; }
  }

  move(plPTH, (p) => (p.k === 0 ? trPTHbone : trPTHkid), 48);
  move(plVitD, (p) => (p.k === 0 ? trVitD : trVitG), 45);
  move(plCa, (p) => {
    if (p.k === 0) return trBoneCa;
    if (p.k === 1) return trGutCa;
    if (p.k === 2) return trFb;
    if (p.k === 3) return trCaM;
    return trCaK;
  }, 55);
  move(plPO4, (p) => (p.k === 0 ? trBoneCa : trGutCa), 48);
  move(plTxCal, () => trGutCa, 40);

  /* saline flush: carried to the kidney, then washed down and out */
  plTxFl.forEach((p) => {
    if (!p.on) return;
    if (p.u < 1) {
      p.u += (45 / trCaK.len) * 0.05;
      if (p.u >= 1) { p.u = 1; p.t = 0; const q = trCaK.at(1); p.x = q.x; p.y = q.y; }
      else { const q = trCaK.at(p.u); p.x = q.x; p.y = q.y; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    } else {
      p.t += dt;
      p.y += 170 * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2));
      if (p.t > 2.2) kill(p);
    }
  });

  /* bisphosphonate: travels to bone, sits on the surface, then fades */
  plTxBisp.forEach((p) => {
    if (!p.on) return;
    if (p.u < 1) {
      p.u += (38 / trPoolBone.len) * 0.05;
      if (p.u >= 1) { p.t = 5; p.x = BONF[0] + rnd(-14, 14); p.y = BONF[1] + rnd(-22, 22); }
      else { const q = trPoolBone.at(p.u); p.x = q.x; p.y = q.y; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    } else {
      p.t -= dt;
      p.e.setAttribute("opacity", clamp(p.t / 5).toFixed(2));
      if (p.t <= 0) kill(p);
    }
  });

  /* calcimimetic: travels to the gland, sits on the sensor, then fades */
  plTxCmim.forEach((p) => {
    if (!p.on) return;
    if (p.u < 1) {
      p.u += (40 / trPoolGland.len) * 0.05;
      if (p.u >= 1) { p.t = 5; p.x = CASR[0] + rnd(-4, 4); p.y = CASR[1] + rnd(-5, 5); }
      else { const q = trPoolGland.at(p.u); p.x = q.x; p.y = q.y; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    } else {
      p.t -= dt;
      p.e.setAttribute("opacity", clamp(p.t / 5).toFixed(2));
      if (p.t <= 0) kill(p);
    }
  });

  /* gauges */
  gg.pth.set(sm.pth, wordOf(sm.pth, 0.3, 0.7, ["low", "normal", "high"]));
  gg.ca.set(sm.ca, wordOf(sm.ca, 0.35, 0.7, ["low", "normal", "high"]));
  gg.po4.set(sm.po4, wordOf(sm.po4, 0.35, 0.65, ["low", "normal", "high"]));
  gg.vitD.set(sm.vitD, wordOf(sm.vitD, 0.3, 0.7, ["low", "normal", "high"]));
  gg.bone.set(sm.bone, wordOf(sm.bone, 0.35, 0.7, ["quiescent", "balanced", "high"]));
  gg.gut.set(sm.gut, wordOf(sm.gut, 0.35, 0.7, ["poor", "adequate", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}

run({ init, step });
