/* Calcium and parathyroid hormone homeostasis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/calpth.mjs [--print-model]
 * Static layout here; ions, hormones, osteoclasts, and gauges move in calpth.page.js. Qualitative: no doses, no numeric thresholds. */
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

  // Autonomous or physiological drive of the parathyroid gland
  let pthDrive = 0.5;
  if (level === 0) pthDrive = 0.08;
  else if (level === 1) pthDrive = 0.88;
  else if (level === 2) pthDrive = 0.5;
  else if (level === 3) pthDrive = 0.9;
  else if (level === 4) pthDrive = 1.0;

  // Interventions acting directly on the parathyroid gland
  if (dPtx && (level === 3 || level === 4)) pthDrive = 0.42;
  else if (dCmim && (level === 3 || level === 4)) pthDrive = 0.45;
  else if (dCalVit && level === 1) pthDrive = 0.48; // negative feedback restored

  // Bone resorption driven by PTH, inhibited by bisphosphonate
  let boneResorp = cl(0.1 + 0.85 * pthDrive);
  if (dBisp) boneResorp = cl(boneResorp * 0.38);

  // Active Vitamin D (calcitriol synthesized by renal 1-alpha-hydroxylase)
  let vitD = cl(0.08 + 0.85 * pthDrive);
  if (level === 1 && !dCalVit) vitD = 0.15; // primary defect is lack of precursor or calcitriol
  if (dCalVit) vitD = cl(vitD + 0.55);

  // Gut calcium absorption (dependent on active vitamin D)
  let gutAbs = cl(0.12 + 0.8 * vitD);

  // Serum ionized / total calcium
  let ca = 0.5;
  if (level === 0) {
    ca = cl(0.18 + (dCalVit ? 0.35 : 0) - (dFluids ? 0.06 : 0) - (dBisp ? 0.06 : 0));
  } else if (level === 1) {
    ca = cl(0.38 + (dCalVit ? 0.14 : 0) - (dFluids ? 0.08 : 0) - (dBisp ? 0.12 : 0));
  } else if (level === 2) {
    ca = cl(0.5 + (dCalVit ? 0.25 : 0) - (dFluids ? 0.1 : 0) - (dBisp ? 0.12 : 0));
  } else if (level === 3) {
    const red = (dFluids ? 0.15 : 0) + (dBisp ? 0.28 : 0) + (dCmim ? 0.36 : 0) + (dPtx ? 0.38 : 0);
    ca = cl(0.86 - red + (dCalVit ? 0.12 : 0));
  } else if (level === 4) {
    const red = (dFluids ? 0.2 : 0) + (dBisp ? 0.32 : 0) + (dCmim ? 0.38 : 0) + (dPtx ? 0.42 : 0);
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
  [2, 0, "calcium normal · parathyroid hormone normal · clinical state stable tone"],
  [3, 0, "calcium high · parathyroid hormone high · clinical state weakness and stones"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>

<!-- Vascular channels and flow tracks -->
<g id="tracks">
  <!-- Central vascular loop -->
  <path class="pt-vessel-path" d="M210,165 C260,195 380,240 480,245 C580,240 680,195 730,165"/>
  <path class="pt-vessel-path" d="M210,335 C260,310 380,260 480,255 C580,260 680,310 730,335"/>
  <path class="pt-vessel-path" d="M480,140 V255"/>

  <path class="pt-vessel-core" d="M210,165 C260,195 380,240 480,245 C580,240 680,195 730,165"/>
  <path class="pt-vessel-core" d="M210,335 C260,310 380,260 480,255 C580,260 680,310 730,335"/>
  <path class="pt-vessel-core" d="M480,140 V255"/>

  <!-- Endocrine and feedback pathways -->
  <path class="pt-vessel-bg" d="M165,140 C290,112 520,102 745,126"/>
  <path class="pt-vessel-bg" d="M155,175 C150,235 165,295 165,295"/>
  <path class="pt-vessel-bg" d="M215,345 C380,360 580,360 735,345"/>
  <path class="pt-feed-line" d="M430,240 C330,210 230,180 185,160"/>
</g>

<!-- Organs and structural units -->
<g id="organs">
  <!-- Top Left: Thyroid and Parathyroid glands -->
  <g id="thyroid-group">
    <path class="pt-thyroid" d="M115,105 C95,120 90,165 110,185 C125,200 135,185 140,165 C145,150 155,150 160,165 C165,185 175,200 190,185 C210,165 205,120 185,105 C170,120 165,140 150,140 C135,140 130,120 115,105 Z"/>
    <g id="pt-glands">
      <circle id="pt-gland-ul" class="pt-gland" cx="112" cy="125" r="5"/>
      <circle id="pt-gland-ll" class="pt-gland" cx="118" cy="170" r="5"/>
      <circle id="pt-gland-ur" class="pt-gland" cx="188" cy="125" r="5"/>
      <g id="pt-adenoma" transform="translate(182 170)">
        <circle class="pt-gland-adenoma" cx="0" cy="0" r="5"/>
        <circle id="pt-adenoma-glow" class="pt-adenoma-glow" cx="0" cy="0" r="12" opacity="0"/>
      </g>
    </g>
    <g id="pt-scars" opacity="0">
      <path d="M107 120L117 130M117 120L107 130M113 165L123 175M123 165L113 175M183 120L193 130M193 120L183 130M177 165L187 175M187 165L177 175" class="pt-scar-mark"/>
    </g>
    <!-- CaSR receptor site -->
    <path id="pt-casr" class="pt-casr" d="M196 160C205 165 208 175 200 182" opacity="0.4"/>
    <circle class="pt-casr-dot" cx="202" cy="170" r="2.5"/>
    <ellipse id="ptx-cut" class="pt-ptx-ring" cx="182" cy="170" rx="16" ry="16" opacity="0"/>
  </g>

  <!-- Top Right: Bone and Osteoclasts -->
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

  <!-- Bottom Left: Kidney and Nephron Unit -->
  <g id="kidney-group">
    <path class="pt-kidney" d="M125,285 C100,310 100,360 125,385 C150,405 185,395 205,370 C215,355 210,345 200,335 C210,325 215,315 205,300 C185,275 150,265 125,285 Z"/>
    <path class="pt-calyx" d="M190,320 Q160,335 190,350"/>
    <path class="pt-ureter" d="M195,340 Q215,355 225,395"/>
    <circle cx="180" cy="310" r="5" class="pt-cyp-node"/>
    <circle cx="155" cy="355" r="5" class="pt-dt-node"/>
    <polygon id="kidney-stone" class="pt-stone" points="194,340 200,336 204,342 199,348 193,346" opacity="0"/>
    <text id="stone-badge" class="pt-stone-text" x="198" y="360" text-anchor="middle" opacity="0">stone risk</text>
  </g>

  <!-- Bottom Right: Small Intestine -->
  <g id="gut-group">
    <path class="pt-gut" d="M720,290 C705,310 705,360 720,380 H875 C890,360 890,310 875,290 Z"/>
    <path class="pt-villi" d="M735,335 Q745,305 755,335 T775,335 T795,335 T815,335 T835,335 T855,335"/>
    <g id="gut-pumps">
      <path d="M755 315H770M765 311L771 315L765 319M755 335H770M765 331L771 335L765 339M755 355H770M765 351L771 355L765 359" class="pt-gut-arr"/>
    </g>
  </g>
</g>

<!-- Neuromuscular Junction -->
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
  <text id="nm-badge" class="nm-badge nm-badge-ok" x="526" y="156" text-anchor="middle">stable neuromuscular tone</text>
</g>

<!-- Dynamic particles container -->
<g id="particles"></g>

<!-- Labels and overlays -->
<g id="labels"></g>
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

.pt-thyroid {
  fill: color-mix(in srgb, var(--c-endo) 30%, var(--anatomy-paper));
  stroke: color-mix(in srgb, var(--c-endo) 70%, var(--anatomy-mid));
  stroke-width: 1.4;
}
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

.pt-kidney {
  fill: color-mix(in srgb, var(--c-rbc) 25%, var(--anatomy-paper));
  stroke: color-mix(in srgb, var(--c-rbc) 60%, var(--anatomy-mid));
  stroke-width: 1.5;
}
.pt-calyx {
  fill: none;
  stroke: color-mix(in srgb, var(--c-fl) 50%, var(--anatomy-mid));
  stroke-width: 1.5;
}
.pt-ureter {
  fill: none;
  stroke: color-mix(in srgb, var(--c-fl) 40%, var(--anatomy-mid));
  stroke-width: 3.5;
}
.pt-cyp-node {
  fill: var(--c-vitd);
  stroke: color-mix(in srgb, var(--c-vitd) 60%, #000);
  stroke-width: 0.8;
}
.pt-dt-node {
  fill: var(--c-ca);
  stroke: color-mix(in srgb, var(--c-ca) 60%, #000);
  stroke-width: 0.8;
}
.pt-stone {
  fill: #fde047;
  stroke: #ca8a04;
  stroke-width: 1.2;
}
.pt-stone-text {
  fill: var(--c-bad);
  font: 700 9.5px var(--anatomy-mono);
  paint-order: stroke;
  stroke: var(--anatomy-paper);
  stroke-width: 2px;
}

.pt-gut {
  fill: color-mix(in srgb, var(--c-graft) 22%, var(--anatomy-paper));
  stroke: color-mix(in srgb, var(--c-graft) 60%, var(--anatomy-mid));
  stroke-width: 1.5;
}
.pt-villi {
  fill: none;
  stroke: color-mix(in srgb, var(--c-graft) 70%, var(--anatomy-mid));
  stroke-width: 1.8;
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
.nm-badge {
  font: 600 10.5px var(--anatomy-mono);
}
.nm-badge-bad { fill: var(--c-bad); }
.nm-badge-warn { fill: var(--c-neut); }
.nm-badge-ok { fill: var(--anatomy-strong); }

.pt-vessel-bg {
  fill: none;
  stroke: var(--anatomy-mid);
  stroke-width: 1;
  stroke-dasharray: 3 5;
  opacity: 0.45;
}
.pt-vessel-path {
  fill: none;
  stroke: color-mix(in srgb, var(--c-rbc) 22%, var(--anatomy-paper));
  stroke-width: 14;
  stroke-linecap: round;
}
.pt-vessel-core {
  fill: none;
  stroke: color-mix(in srgb, var(--c-rbc) 45%, var(--anatomy-paper));
  stroke-width: 10;
  stroke-linecap: round;
}
.pt-feed-line {
  fill: none;
  stroke: var(--c-ca);
  stroke-width: 1.4;
  stroke-dasharray: 4 4;
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
  label: "An animated calcium and parathyroid hormone homeostasis loop showing the parathyroid glands, bone, kidneys, gut, and neuromuscular junction. Parathyroid glands release PTH when calcium drops; PTH stimulates osteoclasts to break down bone mineral, tells kidneys to save calcium and activate vitamin D, and active vitamin D drives gut calcium absorption. Circulating calcium feeds back negatively on parathyroid calcium-sensing receptors. A level slider shifts between hypoparathyroidism, vitamin D deficiency, healthy homeostasis, primary hyperparathyroidism, and severe hypercalcaemic crisis. Gauges show PTH, serum calcium, serum phosphate, active vitamin D, bone resorption, and gut absorption. Treatment options include calcium with calcitriol, intravenous fluids, bisphosphonates, calcimimetics, and parathyroidectomy.",
  caption: "Schematic, not to scale. Hormone flow, ion speeds, and gauge levels are qualitative and illustrative; no doses, lab reference ranges, or numeric thresholds are shown or implied.",
  scene: { W, H },
  pageJs: readFileSync(join(HERE, "calpth.page.js"), "utf8"),
  modelOf,
  MD,
  tests: TESTS,
  withoutLabel: "Without treatment",
  withLabel: "With treatment",
  sourcesLis: [
    "<strong>Calcium and PTH physiology.</strong> Extracellular calcium concentration is sensed by the G-protein-coupled calcium-sensing receptor (CaSR) on parathyroid chief cells. When calcium falls, CaSR inhibition is relieved, triggering secretion of parathyroid hormone (PTH). PTH acts directly on the bone (stimulating osteoclasts to resorb bone mineral, releasing calcium and phosphate) and the kidney (enhancing distal tubular calcium reabsorption and proximal tubular phosphate excretion, while stimulating 1-alpha-hydroxylase to convert 25-hydroxyvitamin D to active 1,25-dihydroxyvitamin D / calcitriol). Calcitriol in turn drives active intestinal absorption of dietary calcium and phosphate, and feeds back to suppress PTH synthesis. This is standard teaching in endocrinology and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Hypo- versus hyperparathyroidism and calcium states.</strong> In hypoparathyroidism (often post-surgical or autoimmune), lack of PTH causes hypocalcaemia, hyperphosphataemia, low calcitriol, and neuromuscular irritability (tetany, carpopedal spasm, Chvostek and Trousseau signs). In secondary hyperparathyroidism (vitamin D deficiency or chronic renal failure), hypocalcaemia elicits a compensatory surge in PTH, causing bone demineralization (rickets or osteomalacia). In primary hyperparathyroidism (usually a benign solitary adenoma), autonomous PTH drives hypercalcaemia, hypophosphataemia, hypercalciuria (nephrolithiasis / kidney stones), and bone resorption ('bones, stones, abdominal groans, and psychic moans'). Flagged for review.",
    "<strong>Conceptual treatments shown.</strong> Calcium and active vitamin D (calcitriol) to treat hypocalcaemia; volume expansion with intravenous saline to promote calciuresis in hypercalcaemia; bisphosphonates to inhibit osteoclasts and halt bone breakdown; calcimimetics (such as cinacalcet) to allosterically stimulate parathyroid CaSRs and turn down PTH; and surgical parathyroidectomy to excise the adenoma. These are teaching toggles only, with no doses or drug regimens.",
  ],
  simplified: "Calcitonin from thyroid C cells, fibroblast growth factor 23 (FGF23) and klotho phosphate regulation, calcium-albumin binding and ionized calcium formulas, tertiary hyperparathyroidism, familial hypocalciuric hypercalcaemia (FHH), hungry bone syndrome after parathyroidectomy, electrocardiographic changes (QT interval changes), and all numeric doses and lab thresholds are omitted. Particle counts, speeds, and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
});
