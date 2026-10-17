/* Calcium and parathyroid hormone homeostasis scene:
 * Parathyroid CaSR sensing, PTH endocrine drive, bone resorption, renal calcium conservation,
 * proximal tubule vitamin D activation, intestinal absorption, neuromuscular excitability,
 * and conceptual therapies. */
const L = {
  tracks: $("tracks"),
  organs: $("organs"),
  nmj: $("nmj"),
  parts: $("particles"),
  labels: $("labels"),
  over: $("over"),
  panel: $("panel"),
};

const sm = {
  pth: 0.5,
  ca: 0.5,
  po4: 0.5,
  vitD: 0.5,
  bone: 0.5,
  gut: 0.5,
  dCalVit: 0,
  dFluids: 0,
  dBisp: 0,
  dCmim: 0,
  dPtx: 0,
};

const acc = {
  pth: 0,
  ca: 0,
  po4: 0,
  vitd: 0,
  txCalVit: 0,
  txFluids: 0,
  txBisp: 0,
  txCmim: 0,
};

function pool(n, build) {
  return Array.from({ length: n }, () => {
    const e = build();
    e.setAttribute("opacity", "0");
    return { e, on: false, u: 0, k: 0, x: 0, y: 0 };
  });
}
const free = (pl) => pl.find((p) => !p.on);
function emit(p, k) {
  p.on = true;
  p.u = 0;
  p.k = k || 0;
  p.e.setAttribute("opacity", "1");
}
function kill(p) {
  p.on = false;
  p.e.setAttribute("opacity", "0");
}

/* Track coordinates matching anatomical layout */
const tracks = {
  pth_bone: track([[165, 140], [290, 112], [520, 102], [745, 126]]),
  pth_kid: track([[155, 175], [150, 235], [165, 295]]),
  kid_gut: track([[215, 345], [380, 360], [580, 360], [735, 345]]),
  kid_pth: track([[185, 295], [205, 235], [190, 185]]),
  bone_ca: track([[745, 155], [660, 205], [560, 235], [480, 250]]),
  gut_ca: track([[735, 330], [650, 300], [560, 265], [480, 255]]),
  ca_pth: track([[430, 240], [330, 210], [230, 180], [185, 160]]),
  ca_nm: track([[480, 225], [480, 175], [480, 140]]),
  ca_kid: track([[420, 260], [310, 290], [225, 315], [195, 335]]),
  gut_tx: track([[630, 370], [680, 360], [735, 345]]),
  kid_tx: track([[280, 270], [250, 290], [215, 310]]),
  bone_tx: track([[680, 115], [710, 125], [740, 135]]),
  pt_tx: track([[182, 220], [182, 195], [195, 175]]),
};

/* Particles */
const plPTH = pool(18, () => mk("polygon", { class: "p-pth", points: "0,-3.2 3.2,0 0,3.2 -3.2,0" }, L.parts));
const plCa = pool(28, () => mk("circle", { class: "p-ca", r: 2.5 }, L.parts));
const plPO4 = pool(14, () => mk("circle", { class: "p-po4", r: 2.2 }, L.parts));
const plVitD = pool(14, () => mk("polygon", { class: "p-vitd", points: "-2.6,-2.6 2.6,-2.6 2.6,2.6 -2.6,2.6" }, L.parts));
const plTxCal = pool(8, () => {
  const g = mk("g", {}, L.parts);
  mk("rect", { class: "p-tx-cal", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g);
  return g;
});
const plTxFl = pool(8, () => mk("circle", { class: "p-tx-fl", r: 2.6 }, L.parts));
const plTxBisp = pool(8, () => mk("polygon", { class: "p-tx-bisp", points: "0,-3.5 3.5,0 0,3.5 -3.5,0" }, L.parts));
const plTxCmim = pool(8, () => mk("circle", { class: "p-tx-cmim", r: 2.4 }, L.parts));

/* DOM elements */
const ptGlands = $("pt-glands");
const ptAdenoma = $("pt-adenoma");
const ptAdenomaGlow = $("pt-adenoma-glow");
const ptScars = $("pt-scars");
const ptCasr = $("pt-casr");
const ptPtxRing = $("ptx-cut");
const boneLacuna = $("bone-lacuna");
const osteoclast = $("osteoclast");
const bispCoat = $("bisp-coat");
const kidneyStone = $("kidney-stone");
const stoneBadge = $("stone-badge");
const gutPumps = $("gut-pumps");
const nmMuscle = $("nm-muscle-wrap");
const nmSparks = $("nm-sparks");
const nmBadge = $("nm-badge");

/* Treatment pills */
let calvitPill, fluidsPill, bispPill, cmimPill, ptxPill;

const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, w = 18;
  const xs = [100, 252, 404, 556, 708, 860];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "Endocrine and organ balance";

  const defs = [
    ["pth", "Parathyroid hormone", "g-eos", "PTH released by parathyroid chief cells. Drives bone resorption, renal calcium conservation, and activation of vitamin D."],
    ["ca", "Serum calcium", "g-fl", "Extracellular ionized calcium. Tightly maintained; low triggers tetany and cramps, high causes weakness, stones and confusion."],
    ["po4", "Serum phosphate", "g-cyt", "Extracellular phosphate. PTH promotes renal phosphate excretion; calcitriol increases intestinal phosphate absorption."],
    ["vitD", "Active vitamin D", "g-neu", "Calcitriol (1,25-dihydroxyvitamin D), synthesized in renal proximal tubules via 1-alpha-hydroxylase under PTH control. Drives gut calcium uptake."],
    ["bone", "Bone resorption", "g-bad", "Osteoclasts actively dissolving bone matrix. Liberates calcium and phosphate into blood; inhibited by bisphosphonates."],
    ["gut", "Gut absorption", "g-good", "Fraction of dietary calcium transported across intestinal enterocytes into blood, dependent on active vitamin D."],
  ];

  defs.forEach(([id, name, cls, tip], i) => {
    gg[id] = gauge(P, xs[i], y0 + 2, h, w, cls, name, tip);
  });
}

function initLabels() {
  const o = L.over;
  const P = (t, x, y, tx, ty, info) => pill(o, t, x, y, tx, ty, info);

  P("Parathyroid glands", 130, 140, 135, 68,
    "Four parathyroid glands on the posterior thyroid. Chief cells monitor extracellular ionized calcium via calcium-sensing receptors (CaSR) and release parathyroid hormone (PTH) when calcium drops.");

  P("PTH release", 280, 115, 280, 75,
    "Parathyroid hormone (PTH): acts rapidly on the kidney to reabsorb calcium and excrete phosphate, stimulates 1-alpha-hydroxylase to activate vitamin D, and drives osteoclast bone resorption.");

  P("Neuromuscular state", 480, 115, 480, 68,
    "Neuromuscular responsiveness: hypocalcaemia lowers the threshold of sodium channels, causing spontaneous firing, tetany, cramps, and paresthesias. Hypercalcaemia raises the threshold, causing weakness and fatigue.");

  P("Bone resorption", 760, 145, 810, 68,
    "Bone mineral reservoir: osteoblasts signal osteoclasts via RANKL to resorb mineralized bone, liberating calcium and phosphate into the circulation. PTH accelerates this resorption.");

  P("Negative feedback", 198, 168, 275, 145,
    "Negative feedback: calcium binding to parathyroid CaSRs activates G-protein signaling that suppresses PTH secretion. Calcitriol also binds nuclear VDRs to repress PTH synthesis.");

  P("Extracellular calcium", 480, 255, 480, 255,
    "Ionized extracellular calcium: essential for cardiac and neuromuscular action potentials, excitation-contraction coupling, and clotting. Maintained in a narrow physiological range.");

  P("Active vitamin D", 390, 350, 390, 380,
    "Active vitamin D (calcitriol, 1,25-dihydroxyvitamin D): steroid hormone that up-regulates intestinal calcium and phosphate absorption and suppresses parathyroid hormone transcription.");

  P("Kidneys", 150, 350, 150, 416,
    "Kidneys: under PTH drive, distal tubules reclaim filtered calcium while proximal tubules waste phosphate and hydroxylate 25-hydroxyvitamin D into active 1,25-dihydroxyvitamin D (calcitriol).");

  P("Small intestine", 800, 350, 800, 416,
    "Intestinal enterocytes: absorb dietary calcium and phosphate through active channels (TRPV6) and calbindin, heavily dependent on stimulation by active vitamin D.");

  /* Dynamic treatment pills */
  calvitPill = P("Calcium and calcitriol", 740, 340, 620, 380,
    "Oral calcium and active calcitriol: replenishes circulating calcium and bypasses impaired renal 1-alpha-hydroxylation to restore gut calcium absorption.");

  fluidsPill = P("Intravenous saline", 210, 310, 270, 280,
    "Intravenous isotonic saline: expands intravascular volume and induces renal calciuresis, promoting urinary calcium clearance in hypercalcaemia.");

  bispPill = P("Bisphosphonate", 745, 135, 680, 120,
    "Bisphosphonates: adhere avidly to bone hydroxyapatite crystals and inhibit osteoclast bone resorption, halting calcium release from the skeletal reservoir.");

  cmimPill = P("Calcimimetic", 195, 170, 182, 225,
    "Calcimimetics (such as cinacalcet): allosterically activate parathyroid calcium-sensing receptors, deceiving the gland into suppressing PTH secretion.");

  ptxPill = P("Parathyroidectomy", 182, 170, 182, 225,
    "Surgical parathyroidectomy: excision of an overactive parathyroid adenoma or hyperplastic glands, removing the source of autonomous PTH secretion.");

  [calvitPill, fluidsPill, bispPill, cmimPill, ptxPill].forEach((p) => {
    p.style.opacity = "0";
    p.style.pointerEvents = "none";
  });
}

function init() {
  initPanel();
  initLabels();
}

function move(pl, tr, sp, getTr) {
  pl.forEach((p) => {
    if (!p.on) return;
    const T = getTr ? getTr(p) : tr;
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

  /* Parathyroid gland display */
  const isHypo = m.words[1] === "low" && m.words[0] === "low";
  const adenomaActivity = Math.max(0, (sm.pth - 0.55) / 0.45);
  ptScars.setAttribute("opacity", isHypo ? (1 - sm.pth * 1.5).toFixed(2) : "0");
  ptGlands.setAttribute("opacity", isHypo ? "0.3" : "1");

  const adScale = 1 + adenomaActivity * 1.6 + (adenomaActivity > 0.1 ? 0.08 * Math.sin(tm / 250) : 0);
  ptAdenoma.setAttribute("transform", "translate(182 170) scale(" + adScale.toFixed(3) + ")");
  ptAdenomaGlow.setAttribute("opacity", (adenomaActivity * 0.85).toFixed(2));

  ptCasr.setAttribute("stroke-opacity", clamp(0.2 + 0.8 * sm.ca).toFixed(2));
  ptPtxRing.setAttribute("opacity", sm.dPtx.toFixed(2));

  /* Bone and osteoclast */
  const ocWobble = sm.bone * 0.12 * Math.sin(tm / 180);
  osteoclast.setAttribute("transform", "translate(" + (742 + ocWobble * 15).toFixed(1) + " 145) scale(" + (0.8 + 0.4 * sm.bone).toFixed(2) + ")");
  boneLacuna.setAttribute("stroke-width", (1.5 + 2.5 * sm.bone).toFixed(1));
  bispCoat.setAttribute("opacity", sm.dBisp.toFixed(2));

  /* Kidney and stones */
  const stoneOp = Math.max(0, (sm.ca - 0.68) * 3.2);
  kidneyStone.setAttribute("opacity", stoneOp.toFixed(2));
  stoneBadge.setAttribute("opacity", stoneOp.toFixed(2));

  /* Gut transport */
  gutPumps.setAttribute("opacity", (0.2 + 0.8 * sm.gut).toFixed(2));

  /* Neuromuscular excitability */
  if (sm.ca < 0.35) {
    const tremor = Math.sin(tm / 40) * 2.2 * (0.35 - sm.ca) * 6;
    nmMuscle.setAttribute("transform", "translate(" + (488 + tremor).toFixed(1) + " 92)");
    nmSparks.setAttribute("opacity", (0.5 + 0.5 * Math.sin(tm / 70)).toFixed(2));
    if (nmBadge.textContent !== "tetany and cramps") {
      nmBadge.textContent = "tetany and cramps";
      nmBadge.setAttribute("class", "nm-badge nm-badge-bad");
    }
  } else if (sm.ca > 0.7) {
    nmMuscle.setAttribute("transform", "translate(488 92)");
    nmSparks.setAttribute("opacity", "0");
    if (nmBadge.textContent !== "weakness and fatigue") {
      nmBadge.textContent = "weakness and fatigue";
      nmBadge.setAttribute("class", "nm-badge nm-badge-warn");
    }
  } else {
    nmMuscle.setAttribute("transform", "translate(488 92)");
    nmSparks.setAttribute("opacity", "0");
    if (nmBadge.textContent !== "stable neuromuscular tone") {
      nmBadge.textContent = "stable neuromuscular tone";
      nmBadge.setAttribute("class", "nm-badge nm-badge-ok");
    }
  }

  /* Treatment overlay pills */
  calvitPill.style.opacity = sm.dCalVit.toFixed(2);
  fluidsPill.style.opacity = sm.dFluids.toFixed(2);
  bispPill.style.opacity = sm.dBisp.toFixed(2);
  cmimPill.style.opacity = sm.dCmim.toFixed(2);
  ptxPill.style.opacity = sm.dPtx.toFixed(2);

  [calvitPill, fluidsPill, bispPill, cmimPill, ptxPill].forEach((p) => {
    p.style.pointerEvents = parseFloat(p.style.opacity) > 0.3 ? "auto" : "none";
  });

  /* Particle emissions */
  acc.pth += dt * sm.pth * 4.2;
  while (acc.pth >= 1) {
    acc.pth--;
    const p = free(plPTH);
    if (p) emit(p, Math.random() < 0.65 ? 0 : 1);
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
      const k = r < 0.3 ? 0 : r < 0.6 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4;
      emit(p, k);
    }
  }

  acc.po4 += dt * (sm.bone * 1.5 + sm.gut * 1.5);
  while (acc.po4 >= 1) {
    acc.po4--;
    const p = free(plPO4);
    if (p) emit(p, Math.random() < 0.5 ? 0 : 1);
  }

  /* Treatment particle emissions */
  acc.txCalVit += dt * sm.dCalVit * 2.0;
  while (acc.txCalVit >= 1) {
    acc.txCalVit--;
    const p = free(plTxCal);
    if (p) emit(p);
  }

  acc.txFluids += dt * sm.dFluids * 2.5;
  while (acc.txFluids >= 1) {
    acc.txFluids--;
    const p = free(plTxFl);
    if (p) emit(p);
  }

  acc.txBisp += dt * sm.dBisp * 1.8;
  while (acc.txBisp >= 1) {
    acc.txBisp--;
    const p = free(plTxBisp);
    if (p) emit(p);
  }

  acc.txCmim += dt * sm.dCmim * 2.0;
  while (acc.txCmim >= 1) {
    acc.txCmim--;
    const p = free(plTxCmim);
    if (p) emit(p);
  }

  /* Particle movements */
  move(plPTH, null, 48, (p) => (p.k === 0 ? tracks.pth_bone : tracks.pth_kid));
  move(plVitD, null, 45, (p) => (p.k === 0 ? tracks.kid_gut : tracks.kid_pth));
  move(plCa, null, 55, (p) => {
    if (p.k === 0) return tracks.bone_ca;
    if (p.k === 1) return tracks.gut_ca;
    if (p.k === 2) return tracks.ca_pth;
    if (p.k === 3) return tracks.ca_nm;
    return tracks.ca_kid;
  });
  move(plPO4, null, 48, (p) => (p.k === 0 ? tracks.bone_ca : tracks.gut_ca));

  move(plTxCal, tracks.gut_tx, 40);
  move(plTxFl, tracks.kid_tx, 45);
  move(plTxBisp, tracks.bone_tx, 38);
  move(plTxCmim, tracks.pt_tx, 40);

  /* Gauges */
  gg.pth.set(sm.pth, wordOf(sm.pth, 0.3, 0.7, ["low", "normal", "high"]));
  gg.ca.set(sm.ca, wordOf(sm.ca, 0.35, 0.7, ["low", "normal", "high"]));
  gg.po4.set(sm.po4, wordOf(sm.po4, 0.35, 0.65, ["low", "normal", "high"]));
  gg.vitD.set(sm.vitD, wordOf(sm.vitD, 0.3, 0.7, ["low", "normal", "high"]));
  gg.bone.set(sm.bone, wordOf(sm.bone, 0.35, 0.7, ["quiescent", "balanced", "high"]));
  gg.gut.set(sm.gut, wordOf(sm.gut, 0.35, 0.7, ["poor", "adequate", "high"]));
}

run({ init, step });
