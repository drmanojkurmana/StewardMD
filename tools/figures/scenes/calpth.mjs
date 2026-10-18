/* Calcium and parathyroid hormone homeostasis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/calpth.mjs [--print-model]
 * Static layout here; thyroid, kidney and gut use organ() art, bone stays a stylised panel;
 * ions, hormones, osteoclasts, washes and gauges move in calpth.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: {
    label: "Calcium and parathyroid state",
    a: [0, 1, 2, 3, 4],
    names: [
      "hypoparathyroidism (parathyroid failure)",
      "vitamin D deficiency (secondary response)",
      "healthy homeostasis (calcium balanced)",
      "primary hyperparathyroidism (adenoma)",
      "severe hypercalcaemic crisis",
    ],
    ticks: ["hypoparathyroid", "vit D deficient", "balanced", "primary hyperPTH", "severe crisis"],
    start: 2,
  },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "calcium and active vitamin D (replace)" },
    { label: "intravenous fluids (expand and excrete)" },
    { label: "bisphosphonate (block bone resorption)" },
    { label: "calcimimetic (sensitize the calcium sensor)" },
    { label: "parathyroidectomy (remove overactive tissue)" },
  ],
  status: "State: {level} · {drug} ·",
  drugNames: [
    "no treatment",
    "calcium and active vitamin D",
    "intravenous fluids",
    "a bisphosphonate",
    "a calcimimetic",
    "parathyroidectomy",
  ],
};

function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const dCalVit = drug === 1 ? 1 : 0;
  const dFluids = drug === 2 ? 1 : 0;
  const dBisp   = drug === 3 ? 1 : 0;
  const dCmim   = drug === 4 ? 1 : 0;
  const dPtx    = drug === 5 ? 1 : 0;

  // Autonomous or physiological drive of the parathyroid glands
  let pthDrive = 0.5;
  if (level === 0) pthDrive = 0.08;
  else if (level === 1) pthDrive = 0.88;
  else if (level === 2) pthDrive = 0.5;
  else if (level === 3) pthDrive = 0.9;
  else if (level === 4) pthDrive = 1.0;

  // Replacement restores feedback in vitamin D deficiency
  if (dCalVit && level === 1) pthDrive = 0.48;
  // Calcimimetics sensitize the sensor wherever glands still function
  if (dCmim && level === 1) pthDrive = 0.6;
  else if (dCmim && level === 2) pthDrive = 0.28;
  else if (dCmim && (level === 3 || level === 4)) pthDrive = 0.45;
  // Surgery removes overactive tissue, and drops PTH wherever glands function
  if (dPtx && level === 1) pthDrive = 0.55;
  else if (dPtx && level === 2) pthDrive = 0.28;
  else if (dPtx && (level === 3 || level === 4)) pthDrive = 0.42;

  // Bone resorption driven by PTH, inhibited by bisphosphonate
  let boneResorp = cl(0.1 + 0.85 * pthDrive);
  if (dBisp) boneResorp = cl(boneResorp * 0.38);

  // Active Vitamin D (calcitriol made by renal 1-alpha-hydroxylase)
  let vitD = cl(0.08 + 0.85 * pthDrive);
  if (level === 1 && !dCalVit) vitD = 0.15; // primary defect is lack of precursor or calcitriol
  if (dCalVit) vitD = cl(vitD + 0.55);

  // Gut calcium absorption (dependent on active vitamin D)
  let gutAbs = cl(0.12 + 0.8 * vitD);

  // Serum calcium
  let ca = 0.5;
  if (level === 0) {
    ca = cl(0.18 + (dCalVit ? 0.35 : 0) - (dFluids ? 0.06 : 0) - (dBisp ? 0.06 : 0));
  } else if (level === 1) {
    ca = cl(0.38 + (dCalVit ? 0.14 : 0) - (dFluids ? 0.08 : 0) - (dBisp ? 0.12 : 0) - (dCmim ? 0.04 : 0) - (dPtx ? 0.05 : 0));
  } else if (level === 2) {
    ca = cl(0.5 + (dCalVit ? 0.25 : 0) - (dFluids ? 0.1 : 0) - (dBisp ? 0.12 : 0) - (dCmim ? 0.12 : 0) - (dPtx ? 0.12 : 0));
  } else if (level === 3) {
    const red = (dFluids ? 0.2 : 0) + (dBisp ? 0.28 : 0) + (dCmim ? 0.36 : 0) + (dPtx ? 0.38 : 0);
    ca = cl(0.86 - red + (dCalVit ? 0.12 : 0));
  } else if (level === 4) {
    const red = (dFluids ? 0.3 : 0) + (dBisp ? 0.32 : 0) + (dCmim ? 0.38 : 0) + (dPtx ? 0.42 : 0);
    ca = cl(0.98 - red + (dCalVit ? 0.05 : 0));
  }

  // Serum phosphate (PTH causes phosphaturia, gut absorbs PO4)
  let po4 = cl(0.5 - 0.42 * (pthDrive - 0.5) + 0.22 * (gutAbs - 0.5));
  if (level === 0) po4 = cl(0.82 - (dCalVit ? 0.14 : 0));

  // Word descriptors
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const caWord = w(ca, 0.35, 0.7, ["low", "normal", "high"]);
  const pthWord = w(pthDrive, 0.3, 0.7, ["low", "normal", "high"]);
  const clinicWord = ca < 0.35 ? "tetany and spasms" : ca > 0.7 ? "weakness and stones" : "stable tone";

  const words = [caWord, pthWord, clinicWord];
  return {
    pth: pthDrive,
    ca,
    po4,
    vitD,
    bone: boneResorp,
    gut: gutAbs,
    dCalVit,
    dFluids,
    dBisp,
    dCmim,
    dPtx,
    words,
    readout: "calcium " + words[0] + " · parathyroid hormone " + words[1] + " · clinical state " + words[2],
  };
}

const TESTS = [
  [0, 0, "calcium low · parathyroid hormone low · clinical state tetany and spasms"],
  [0, 1, "calcium normal · parathyroid hormone low · clinical state stable tone"],
  [3, 0, "calcium high · parathyroid hormone high · clinical state weakness and stones"],
  [4, 5, "calcium normal · parathyroid hormone normal · clinical state stable tone"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="vBone" class="cp-ves" d="M150 130 C300 92 550 92 730 128"/>
<path id="vKid" class="cp-ves" d="M138 186 C130 225 132 250 140 272"/>
<path id="vVitD" class="cp-ves" d="M225 360 C400 380 600 380 712 358"/>
<path id="vBCa" class="cp-ves" d="M730 165 C660 208 560 238 512 248"/>
<path id="vGCa" class="cp-ves" d="M712 322 C640 292 560 265 512 255"/>
<path id="vFb" class="cp-ves" d="M430 238 C330 212 230 188 188 172"/>
<path id="vCaM" class="cp-ves" d="M480 202 L480 142"/>
<path id="vCaK" class="cp-ves" d="M430 268 C340 290 250 305 212 318"/>
<ellipse id="bloodPool" class="cp-pool" cx="480" cy="250" rx="72" ry="48"/>
<g id="thySlot"></g>
<g id="kidSlot"></g>
<g id="gutSlot"></g>
<g id="glands">
  <circle id="pt-gland-a" class="pt-gland" cx="124" cy="142" r="4.5"/>
  <circle id="pt-gland-b" class="pt-gland" cx="128" cy="180" r="4.5"/>
  <circle id="pt-gland-c" class="pt-gland" cx="176" cy="142" r="4.5"/>
  <g id="pt-adenoma" transform="translate(174 180)">
    <circle class="pt-gland-adenoma" cx="0" cy="0" r="5"/>
    <circle id="pt-adenoma-glow" class="pt-adenoma-glow" cx="0" cy="0" r="12" opacity="0"/>
  </g>
  <g id="pt-scars" opacity="0">
    <path d="M120 138L128 146M128 138L120 146M124 176L132 184M132 176L124 184M172 138L180 146M180 138L172 146M170 176L178 184M178 176L170 184" class="pt-scar-mark"/>
  </g>
  <path id="pt-casr" class="pt-casr" d="M192 162 C201 167 204 177 196 184" opacity="0.4"/>
  <circle id="pt-casr-dot" class="pt-casr-dot" cx="199" cy="172" r="2.5"/>
  <ellipse id="ptx-cut" class="pt-ptx-ring" cx="174" cy="180" rx="15" ry="15" opacity="0"/>
</g>
<g id="bone-group">
  <path class="pt-bone" d="M720,95 H875 C885,95 890,100 890,110 V180 C890,190 885,195 875,195 H720 C710,195 705,190 705,180 V110 C705,100 710,95 720,95 Z"/>
  <path class="pt-trab" d="M735,115 Q760,140 780,115 T830,115 T870,135 M745,170 Q775,145 805,170 T860,170"/>
  <path id="bone-lacuna" class="pt-lacuna" d="M740 115Q726 145 740 175"/>
  <g id="osteoclast" transform="translate(742 145)">
    <path class="pt-ruffle" d="M-6 -18Q-10 -12 -6 -6Q-11 0 -6 6Q-10 12 -6 18"/>
    <path class="pt-oclast-body" d="M-6 -18C15 -18 25 -10 25 0C25 10 15 18 -6 18Z"/>
    <circle cx="6" cy="-8" r="3" class="cl-n"/>
    <circle cx="12" cy="0" r="3.2" class="cl-n"/>
    <circle cx="6" cy="8" r="3" class="cl-n"/>
  </g>
  <g id="bisp-coat" opacity="0">
    <path d="M738 122L742 125L738 128L734 125ZM732 138L736 141L732 144L728 141ZM731 152L735 155L731 158L727 155ZM738 166L742 169L738 172L734 169Z" class="pt-bisp-crystal"/>
  </g>
</g>
<polygon id="kidney-stone" class="pt-stone" points="192,348 198,344 202,350 197,356 191,354" opacity="0"/>
<g id="gut-pumps">
  <path d="M755 315H770M765 311L771 315L765 319M755 335H770M765 331L771 335L765 339M755 355H770M765 351L771 355L765 359" class="pt-gut-arr"/>
</g>
<g id="nmj">
  <path class="nm-axon" d="M425 115H465"/>
  <circle class="nm-bouton" cx="468" cy="115" r="7"/>
  <path id="nm-sparks" class="nm-sparks" d="M477 106L483 115L478 118L485 125" opacity="0"/>
  <g id="nm-muscle-wrap" transform="translate(488 92)">
    <rect class="nm-muscle" x="0" y="0" width="76" height="46" rx="8"/>
    <line class="nm-stria" x1="16" y1="2" x2="16" y2="44"/>
    <line class="nm-stria" x1="32" y1="2" x2="32" y2="44"/>
    <line class="nm-stria" x1="48" y1="2" x2="48" y2="44"/>
    <line class="nm-stria" x1="64" y1="2" x2="64" y2="44"/>
  </g>
  <text id="nm-badge" class="cp-badge cp-badge-ok" x="526" y="158" text-anchor="middle">stable muscle tone</text>
</g>
<ellipse id="glandWash" class="w-gland" cx="150" cy="160" rx="95" ry="85" opacity="0"/>
<rect id="boneWash" class="w-bone" x="705" y="95" width="185" height="100" rx="12" opacity="0"/>
<ellipse id="kidWash" class="w-kid" cx="150" cy="335" rx="85" ry="80" opacity="0"/>
<ellipse id="gutWash" class="w-gut" cx="800" cy="335" rx="95" ry="70" opacity="0"/>
<ellipse id="bloodWash" class="w-blood" cx="480" cy="250" rx="72" ry="48" opacity="0"/>
<g id="particles"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
:root {
  --c-pth: #f59e0b;
  --c-ca: #38bdf8;
  --c-po4: #c084fc;
  --c-vitd: #34d399;
  --c-bone: #fde68a;
}
body[data-theme="light"] {
  --c-pth: #d97706;
  --c-ca: #0284c7;
  --c-po4: #9333ea;
  --c-vitd: #059669;
  --c-bone: #d97706;
}

.cp-ves {
  fill: none;
  stroke: color-mix(in srgb, var(--c-rbc) 42%, var(--anatomy-paper));
  stroke-width: 12;
  stroke-linecap: round;
  opacity: 0.85;
}
.cp-pool {
  fill: color-mix(in srgb, var(--c-rbc) 16%, var(--anatomy-paper));
  stroke: color-mix(in srgb, var(--c-rbc) 50%, var(--anatomy-mid));
  stroke-width: 1.4;
}
.w-gut { fill: var(--c-vitd); stroke: none; }
.w-kid { fill: var(--c-fl); stroke: none; }
.w-bone { fill: var(--c-good); stroke: none; }
.w-gland { fill: var(--c-pth); stroke: none; }
.w-blood { fill: var(--c-ca); stroke: none; }
.cp-cap { fill: var(--anatomy-strong); font: 12px var(--anatomy-mono); }
.cp-badge { font: 600 12px var(--anatomy-mono); }
.cp-badge-bad { fill: var(--c-bad); }
.cp-badge-warn { fill: var(--c-neut); }
.cp-badge-ok { fill: var(--anatomy-strong); }

.pt-gland {
  fill: var(--c-pth);
  stroke: color-mix(in srgb, var(--c-pth) 60%, #000);
  stroke-width: 0.8;
}
.pt-gland-adenoma {
  fill: var(--c-pth);
  stroke: var(--c-bad);
  stroke-width: 1.5;
}
.pt-adenoma-glow {
  fill: none;
  stroke: var(--c-bad);
  stroke-width: 2;
  stroke-dasharray: 4 3;
}
.pt-scar-mark {
  stroke: var(--c-bad);
  stroke-width: 1.4;
  stroke-linecap: round;
}
.pt-casr {
  fill: none;
  stroke: var(--c-ca);
  stroke-width: 1.8;
  stroke-linecap: round;
}
.pt-casr-dot {
  fill: var(--c-ca);
}
.pt-ptx-ring {
  fill: none;
  stroke: var(--c-bad);
  stroke-width: 2;
  stroke-dasharray: 4 4;
}

.pt-bone {
  fill: color-mix(in srgb, #fef3c7 20%, var(--anatomy-paper));
  stroke: color-mix(in srgb, #f59e0b 50%, var(--anatomy-mid));
  stroke-width: 1.6;
}
.pt-trab {
  fill: none;
  stroke: color-mix(in srgb, #f59e0b 35%, var(--anatomy-mid));
  stroke-width: 1.2;
}
.pt-lacuna {
  fill: none;
  stroke: var(--c-bad);
  stroke-width: 2.2;
}
.pt-ruffle {
  fill: none;
  stroke: var(--c-bad);
  stroke-width: 1.5;
  stroke-linecap: round;
}
.pt-oclast-body {
  fill: color-mix(in srgb, var(--c-mac) 75%, var(--anatomy-paper));
  stroke: color-mix(in srgb, var(--c-mac) 80%, #000);
  stroke-width: 1;
}
.pt-bisp-crystal {
  fill: var(--c-good);
  stroke: color-mix(in srgb, var(--c-good) 50%, #000);
  stroke-width: 0.6;
}

.pt-stone {
  fill: #fde047;
  stroke: #ca8a04;
  stroke-width: 1.2;
}
.pt-gut-arr {
  fill: none;
  stroke: var(--c-ca);
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.nm-axon {
  fill: none;
  stroke: var(--c-fl);
  stroke-width: 2.2;
}
.nm-bouton {
  fill: var(--c-fl);
  stroke: color-mix(in srgb, var(--c-fl) 60%, #000);
  stroke-width: 1;
}
.nm-muscle {
  fill: color-mix(in srgb, var(--c-rbc) 35%, var(--anatomy-paper));
  stroke: color-mix(in srgb, var(--c-rbc) 65%, var(--anatomy-mid));
  stroke-width: 1.4;
}
.nm-stria {
  stroke: color-mix(in srgb, var(--c-rbc) 50%, var(--anatomy-paper));
  stroke-width: 1.2;
}
.nm-sparks {
  fill: none;
  stroke: var(--c-bad);
  stroke-width: 2;
  stroke-linecap: round;
}

.p-pth { fill: var(--c-pth); stroke: color-mix(in srgb, var(--c-pth) 50%, #000); stroke-width: 0.5; }
.p-ca { fill: var(--c-ca); stroke: color-mix(in srgb, var(--c-ca) 50%, #000); stroke-width: 0.5; }
.p-po4 { fill: var(--c-po4); stroke: color-mix(in srgb, var(--c-po4) 50%, #000); stroke-width: 0.5; }
.p-vitd { fill: var(--c-vitd); stroke: color-mix(in srgb, var(--c-vitd) 50%, #000); stroke-width: 0.5; }
.p-tx-cal { fill: #f8fafc; stroke: var(--c-ca); stroke-width: 1; }
.p-tx-fl { fill: var(--c-fl); }
.p-tx-bisp { fill: var(--c-good); stroke: color-mix(in srgb, var(--c-good) 50%, #000); stroke-width: 0.6; }
.p-tx-cmim { fill: var(--c-bad); stroke: color-mix(in srgb, var(--c-bad) 50%, #000); stroke-width: 0.6; }
`;

buildScene({
  id: "calcium-pth",
  fig: "Fig 1",
  title: "Calcium and parathyroid hormone homeostasis",
  W,
  H,
  body,
  extraCss,
  label: "An animated calcium and parathyroid hormone loop. The parathyroid glands release PTH when calcium drops. PTH tells bone eating cells to release calcium, tells the kidney to save calcium and switch on vitamin D, and vitamin D tells the gut to absorb calcium. Blood calcium feeds back on the gland sensor. Low calcium makes muscle twitch and cramp, high calcium makes it weak. A slider moves from parathyroid failure through balanced control to adenoma and crisis, and each treatment visibly acts on its target.",
  caption: "Schematic, not to scale. Hormone flow, ion speeds, and gauge levels are qualitative and illustrative; no doses, lab reference ranges, or numeric thresholds are shown or implied.",
  scene: { W, H },
  pageJs: readFileSync(join(HERE, "calpth.page.js"), "utf8"),
  modelOf,
  MD,
  tests: TESTS,
  organs: true,
  withoutLabel: "Without treatment",
  withLabel: "With parathyroidectomy",
  sourcesLis: [
    "<strong>Calcium and PTH physiology.</strong> Extracellular calcium is sensed by the calcium sensing receptor on parathyroid chief cells. When calcium falls, the gland releases parathyroid hormone (PTH). PTH stimulates osteoclasts to resorb bone, tells the kidney to reclaim calcium and waste phosphate while switching on active vitamin D, and active vitamin D drives gut calcium uptake. Calcium and vitamin D feed back to quiet the gland. This is standard teaching in endocrinology and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Low versus high calcium states.</strong> In hypoparathyroidism the failed glands make too little PTH, so calcium falls and phosphate rises, and nerves and muscle become excitable with cramps and spasms. In vitamin D deficiency the glands work overtime to compensate. In primary hyperparathyroidism, usually a small benign adenoma, autonomous PTH drives calcium high with stones, bone loss, weakness and fatigue. Flagged for review.",
    "<strong>Conceptual treatments shown.</strong> Calcium with active vitamin D to top up low calcium, saline fluids to help the kidney flush out high calcium, bisphosphonates to coat bone and quiet osteoclasts, calcimimetics to sensitize the gland sensor so less PTH is released, and parathyroidectomy to remove the overactive tissue. These are teaching toggles only, with no doses or drug regimens.",
  ],
  simplified: "Calcitonin, phosphate hormones, calcium binding in blood, familial and tertiary forms, hungry bone after surgery, heart trace changes, and all numeric doses and lab thresholds are omitted. Particle counts, speeds, and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
});
