/* Semaglutide and tirzepatide incretin actions as an animated, working scene.
 *   node tools/figures/scenes/incretin.mjs [--print-model]
 * Static layout and definitions here; dynamic motion and gauges in incretin.page.js.
 * Qualitative: no doses, no numbers, no brand names. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: {
    label: "Metabolic state",
    a: [0, 1, 2],
    names: ["healthy after a meal", "type 2 diabetes", "type 2 diabetes with obesity"],
    ticks: ["healthy after meal", "type 2 diabetes", "diabetes with obesity"],
    start: 1,
  },
  drugLabel: "Treatment",
  settings: [
    { label: "no medicine" },
    { label: "semaglutide (GLP-1 receptor agonist)" },
    { label: "tirzepatide (dual GIP and GLP-1 receptor agonist)" },
  ],
  status: "Metabolic state: {level} · {drug} ·",
  drugNames: ["no medicine", "semaglutide", "tirzepatide"],
};

function modelOf(S, level, drug) {
  const l = S.level.a[level];
  const d = drug;

  // Blood sugar
  let sugar = 0.22;
  if (l === 1) sugar = d === 0 ? 0.82 : (d === 1 ? 0.28 : 0.22);
  else if (l === 2) sugar = d === 0 ? 0.90 : (d === 1 ? 0.30 : 0.24);

  // Insulin secretion matched to need
  let insulin = 0.50;
  if (l === 1) insulin = d === 0 ? 0.30 : (d === 1 ? 0.68 : 0.74);
  else if (l === 2) insulin = d === 0 ? 0.34 : (d === 1 ? 0.70 : 0.76);

  // Glucagon
  let glucagon = 0.22;
  if (l === 1) glucagon = d === 0 ? 0.76 : (d === 1 ? 0.20 : 0.18);
  else if (l === 2) glucagon = d === 0 ? 0.86 : (d === 1 ? 0.22 : 0.19);

  // Gastric emptying rate
  let emptying = 0.50;
  if (l >= 1) {
    if (d === 0) emptying = l === 1 ? 0.55 : 0.58;
    else if (d === 1) emptying = 0.18;
    else emptying = 0.28;
  } else {
    if (d === 1) emptying = 0.22;
    else if (d === 2) emptying = 0.30;
  }

  // Appetite / hunger drive
  let appetite = 0.44;
  if (l === 1) appetite = d === 0 ? 0.72 : (d === 1 ? 0.30 : 0.14);
  else if (l === 2) appetite = d === 0 ? 0.94 : (d === 1 ? 0.32 : 0.15);

  // Weight trend
  let weight = 0.50;
  if (l === 1) weight = d === 0 ? 0.55 : (d === 1 ? 0.26 : 0.14);
  else if (l === 2) weight = d === 0 ? 0.86 : (d === 1 ? 0.28 : 0.15);

  let sugarWord = "normal";
  if (l === 0) {
    sugarWord = "normal";
  } else {
    sugarWord = sugar > 0.5 ? "high" : "controlled";
  }

  let appetiteWord = "normal";
  if (appetite < 0.20) appetiteWord = "suppressed";
  else if (appetite < 0.40) appetiteWord = "reduced";
  else if (appetite < 0.60) appetiteWord = "normal";
  else appetiteWord = "high";

  let weightWord = "stable";
  if (weight < 0.20) weightWord = "falling fast";
  else if (weight < 0.40) weightWord = "falling";
  else if (weight < 0.70) weightWord = "stable";
  else weightWord = "rising";

  const words = [sugarWord, appetiteWord, weightWord];
  const readout = "blood sugar " + sugarWord + " · appetite " + appetiteWord + " · weight trend " + weightWord;

  return {
    l, d, sugar, insulin, glucagon, emptying, appetite, weight, words, readout
  };
}

const TESTS = [
  [1, 0, "blood sugar high · appetite high · weight trend stable"],
  [1, 1, "blood sugar controlled · appetite reduced · weight trend falling"],
  [1, 2, "blood sugar controlled · appetite suppressed · weight trend falling fast"],
  [2, 0, "blood sugar high · appetite high · weight trend rising"],
];

/* ---------------- static layout ---------------- */
const body = `
<defs>
  <!-- Soft gradients -->
  <linearGradient id="grad-vessel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="var(--c-vessel)" stop-opacity="0.95"/>
    <stop offset="35%" stop-color="var(--c-lumen)" stop-opacity="0.98"/>
    <stop offset="70%" stop-color="var(--c-lumen)" stop-opacity="0.98"/>
    <stop offset="100%" stop-color="var(--c-vessel)" stop-opacity="0.95"/>
  </linearGradient>
  <radialGradient id="grad-depot" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="var(--c-glp1)" stop-opacity="0.85"/>
    <stop offset="60%" stop-color="var(--c-depot)" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="var(--c-depot)" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="grad-islet" cx="45%" cy="45%" r="55%">
    <stop offset="0%" stop-color="var(--c-beta)" stop-opacity="0.22"/>
    <stop offset="75%" stop-color="var(--anatomy-card)" stop-opacity="0.7"/>
    <stop offset="100%" stop-color="var(--c-beta)" stop-opacity="0.35"/>
  </radialGradient>
  <radialGradient id="grad-hypo" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="var(--c-brain)" stop-opacity="0.75"/>
    <stop offset="50%" stop-color="var(--c-brain)" stop-opacity="0.3"/>
    <stop offset="100%" stop-color="var(--c-brain)" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="grad-zoom" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="var(--anatomy-card)" stop-opacity="0.95"/>
    <stop offset="85%" stop-color="var(--anatomy-paper)" stop-opacity="0.9"/>
    <stop offset="100%" stop-color="var(--anatomy-mid)" stop-opacity="0.3"/>
  </radialGradient>
  <linearGradient id="grad-pen" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="var(--c-pen)"/>
    <stop offset="40%" stop-color="color-mix(in srgb, var(--c-pen) 70%, #fff)"/>
    <stop offset="100%" stop-color="var(--c-pen)"/>
  </linearGradient>
  <!-- Clip paths -->
  <clipPath id="clip-zoom">
    <circle cx="585" cy="135" r="61"/>
  </clipPath>
</defs>

<!-- Panoramic tissue canvas -->
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="bg-specks"></g>

<!-- 1. Pen and skin (top left) -->
<g id="skin-zone">
  <!-- Skin layers -->
  <rect class="sc-skin-stratum" x="24" y="142" width="180" height="5" rx="2"/>
  <rect class="sc-skin-dermis" x="24" y="147" width="180" height="15"/>
  <rect class="sc-skin-subq" x="24" y="162" width="180" height="36" rx="6"/>
  <!-- Subcutaneous fat cells -->
  <circle class="sc-subq-fat" cx="42" cy="178" r="8"/>
  <circle class="sc-subq-fat" cx="62" cy="184" r="7"/>
  <circle class="sc-subq-fat" cx="82" cy="176" r="9"/>
  <circle class="sc-subq-fat" cx="106" cy="182" r="8"/>
  <circle class="sc-subq-fat" cx="180" cy="180" r="9"/>
  <!-- Subcutaneous depot -->
  <ellipse id="sc-depot" class="sc-depot" cx="152" cy="174" rx="18" ry="9" fill="url(#grad-depot)"/>
  <!-- Capillary from depot to central vessel -->
  <path class="sc-capillary-bg" d="M165 176 C180 185, 192 205, 192 234"/>
  <path class="sc-capillary-lumen" d="M165 176 C180 185, 192 205, 192 234"/>
  <!-- Injection Pen tilted at 35 degrees -->
  <g id="pen-rig" transform="translate(136, 142) rotate(-35)">
    <line class="pen-needle" x1="0" y1="0" x2="0" y2="40"/>
    <path class="pen-hub" d="M-5 0 L5 0 L3 -12 L-3 -12 Z"/>
    <rect class="pen-barrel" x="-9" y="-82" width="18" height="70" rx="3" fill="url(#grad-pen)"/>
    <rect class="pen-window" x="-6" y="-68" width="12" height="34" rx="2"/>
    <rect id="pen-liquid" class="pen-liquid" x="-5" y="-66" width="10" height="30" rx="1"/>
    <rect class="pen-clip" x="9" y="-80" width="3" height="36" rx="1.5"/>
    <g id="pen-plunger">
      <rect class="pen-plunger-shaft" x="-4" y="-96" width="8" height="14" rx="1"/>
      <rect class="pen-plunger-btn" x="-8" y="-102" width="16" height="6" rx="3"/>
    </g>
  </g>
</g>

<!-- 2. Gut (bottom left) -->
<g id="gut-zone">
  <!-- Gut lumen background -->
  <rect class="gut-lumen-bg" x="24" y="340" width="236" height="70" rx="8"/>
  <!-- Epithelial brush border with villi -->
  <path class="gut-wall" d="M24 336 C35 328, 45 328, 55 336 C65 328, 75 328, 85 336 C95 328, 105 328, 115 336 C125 328, 135 328, 145 336 C155 328, 165 328, 175 336 C185 328, 195 328, 205 336 C215 328, 225 328, 235 336 C245 328, 255 328, 260 336"/>
  <!-- Enteroendocrine L cells (teal) and K cells (amber) -->
  <g class="gut-cell l-cell" transform="translate(85, 332)">
    <path class="cell-l-body" d="M-8 4 C-8 -12, 8 -12, 8 4 Z"/>
    <circle class="cell-nuc" cx="0" cy="-2" r="3"/>
  </g>
  <g class="gut-cell k-cell" transform="translate(145, 332)">
    <path class="cell-k-body" d="M-8 4 C-8 -12, 8 -12, 8 4 Z"/>
    <circle class="cell-nuc" cx="0" cy="-2" r="3"/>
  </g>
  <g class="gut-cell l-cell" transform="translate(205, 332)">
    <path class="cell-l-body" d="M-8 4 C-8 -12, 8 -12, 8 4 Z"/>
    <circle class="cell-nuc" cx="0" cy="-2" r="3"/>
  </g>
  <!-- DPP-4 Chomping Enzymes -->
  <g id="dpp4-1" class="dpp4-group" transform="translate(115, 305)">
    <path id="dpp4-1-top" class="dpp4-jaw" d="M0 0 L10 -8 A12 12 0 0 0 -12 -3 Z"/>
    <path id="dpp4-1-bot" class="dpp4-jaw" d="M0 0 L10 8 A12 12 0 0 1 -12 3 Z"/>
    <circle class="dpp4-eye" cx="-4" cy="-5" r="1.4"/>
  </g>
  <g id="dpp4-2" class="dpp4-group" transform="translate(225, 310)">
    <path id="dpp4-2-top" class="dpp4-jaw" d="M0 0 L10 -8 A12 12 0 0 0 -12 -3 Z"/>
    <path id="dpp4-2-bot" class="dpp4-jaw" d="M0 0 L10 8 A12 12 0 0 1 -12 3 Z"/>
    <circle class="dpp4-eye" cx="-4" cy="-5" r="1.4"/>
  </g>
  <!-- Albumin-Bound Drug Complex with Shield -->
  <g id="alb-complex" transform="translate(180, 298)">
    <path class="albumin-blob" d="M-14 0 C-14 -10, -4 -12, 4 -8 C12 -4, 16 4, 10 12 C4 18, -8 16, -14 6 Z"/>
    <text class="alb-label" x="-2" y="3" text-anchor="middle">ALB</text>
    <path class="fatty-tail" d="M12 2 C8 6, 2 8, -6 6"/>
    <circle id="alb-drug-head" class="alb-drug-head" cx="16" cy="0" r="4.5"/>
    <path class="drug-shield" d="M22 -6 L27 -4 L26 2 L22 6 L18 2 L17 -4 Z"/>
  </g>
  <!-- Capillary connecting gut to circulation -->
  <path class="sc-capillary-bg" d="M245 320 C245 285, 235 270, 235 266"/>
  <path class="sc-capillary-lumen" d="M245 320 C245 285, 235 270, 235 266"/>
</g>

<!-- 3. Pancreatic islet (top centre) -->
<g id="islet-zone" class="islet-group" transform="translate(405, 130)">
  <ellipse class="islet-bg" cx="0" cy="0" rx="66" ry="56" fill="url(#grad-islet)"/>
  <ellipse class="islet-border" cx="0" cy="0" rx="66" ry="56"/>
  <path class="islet-cap" d="M-40 -10 Q0 -5 40 -15 M-30 20 Q5 15 35 25 M0 -45 L0 45"/>
  <!-- Alpha cells (mantle) -->
  <circle class="cl-alpha" cx="-38" cy="-28" r="10.5"/>
  <circle class="cl-alpha" cx="36" cy="-26" r="10.5"/>
  <circle class="cl-alpha" cx="-45" cy="12" r="10"/>
  <circle class="cl-alpha" cx="42" cy="14" r="10"/>
  <circle class="cl-alpha" cx="0" cy="-38" r="9.5"/>
  <!-- Beta cells (core) -->
  <circle class="cl-beta" cx="-18" cy="-12" r="12"/>
  <circle class="cl-beta" cx="16" cy="-10" r="12"/>
  <circle class="cl-beta" cx="-24" cy="16" r="11.5"/>
  <circle class="cl-beta" cx="20" cy="18" r="12"/>
  <circle id="zoomed-beta" class="cl-beta is-zoomed" cx="0" cy="8" r="13"/>
  <!-- Efferent islet microvessel -->
  <path class="sc-capillary-bg" d="M0 56 L0 104"/>
  <path class="sc-capillary-lumen" d="M0 56 L0 104"/>
</g>

<!-- 4. Receptor zoom inset (circle beside islet) -->
<g id="zoom-zone">
  <!-- Thin zoom lines from beta cell to inset -->
  <path class="zoom-guide" d="M405 138 L524 105 M405 138 L524 165"/>
  <circle class="zoom-inset-bg" cx="585" cy="135" r="62" fill="url(#grad-zoom)"/>
  <g clip-path="url(#clip-zoom)">
    <rect class="cytoplasm-bg" x="520" y="135" width="130" height="65"/>
    <text class="cyto-label" x="585" y="184" text-anchor="middle">Beta cell cytoplasm</text>
    <text class="extra-label" x="610" y="103" text-anchor="middle">Extracellular</text>
    <rect class="bilayer-core" x="520" y="131" width="130" height="8"/>
    <path class="phospho-heads" d="M523 130 H647 M523 140 H647"/>
    <!-- GLP-1 Receptor (teal) -->
    <g id="rec-glp1" class="rec-group" transform="translate(558, 135)">
      <path class="rec-tm glp1-tm" d="M-8 -6 V8 M-4 -6 V8 M0 -6 V8 M4 -6 V8 M8 -6 V8"/>
      <path id="glp1-pocket" class="rec-pocket glp1-pocket" d="M-9 -6 C-9 -16, 9 -16, 9 -6"/>
      <path class="rec-tail glp1-tail" d="M-3 8 C-3 14, 5 14, 5 8"/>
    </g>
    <!-- GIP Receptor (amber) -->
    <g id="rec-gip" class="rec-group" transform="translate(612, 135)">
      <path class="rec-tm gip-tm" d="M-8 -6 V8 M-4 -6 V8 M0 -6 V8 M4 -6 V8 M8 -6 V8"/>
      <path id="gip-pocket" class="rec-pocket gip-pocket" d="M-9 -6 C-9 -16, 9 -16, 9 -6"/>
      <path class="rec-tail gip-tail" d="M-3 8 C-3 14, 5 14, 5 8"/>
    </g>
    <!-- Semaglutide single key -->
    <g id="sema-key" class="ligand-key" opacity="0">
      <circle class="lig-glp1-dot" cx="558" cy="123" r="5.5"/>
      <path class="lig-key-notch" d="M558 125 V129"/>
    </g>
    <!-- Tirzepatide dual key -->
    <g id="tirz-key" class="ligand-key" opacity="0">
      <path class="tirz-bridge" d="M558 116 Q585 110 612 116"/>
      <circle class="lig-glp1-dot" cx="558" cy="123" r="5.5"/>
      <circle class="lig-gip-dot" cx="612" cy="123" r="5.5"/>
    </g>
  </g>
  <circle class="zoom-inset-border" cx="585" cy="135" r="62"/>
</g>

<!-- 5. Brain / Hypothalamus (top right) -->
<g id="brain-zone" class="brain-group" transform="translate(730, 70)">
  <path class="brain-outline" d="M40 95 C20 90, 5 70, 8 45 C10 20, 35 5, 75 5 C115 5, 145 25, 150 55 C155 75, 145 95, 125 102 C115 106, 105 125, 95 130 C85 130, 85 110, 75 105 C60 105, 50 102, 40 95 Z"/>
  <path class="brain-sulci" d="M30 45 C50 35, 70 50, 90 35 M50 20 C75 12, 105 22, 125 35 M95 65 C115 60, 135 70, 140 85"/>
  <path class="brain-cerebellum" d="M125 102 C135 110, 130 128, 115 128 C105 128, 100 115, 105 108 Z"/>
  <path class="brain-stem" d="M85 110 V164"/>
  <circle id="hypo-core" class="hypo-core" cx="70" cy="65" r="9"/>
  <circle id="hypo-glow" class="hypo-glow" cx="70" cy="65" r="22" fill="url(#grad-hypo)"/>
  <circle id="app-ring-1" class="app-ring" cx="70" cy="65" r="15"/>
  <circle id="app-ring-2" class="app-ring" cx="70" cy="65" r="28"/>
  <circle id="app-ring-3" class="app-ring" cx="70" cy="65" r="42"/>
</g>

<!-- 6. Stomach and Pylorus (bottom right) -->
<g id="stomach-zone" class="stomach-group" transform="translate(700, 310)">
  <path class="stomach-bg" d="M15 15 C35 -15, 95 -10, 115 25 C125 45, 130 65, 135 65 C140 65, 142 62, 148 62 C160 62, 175 75, 175 95 C175 110, 155 118, 140 105 C130 95, 122 80, 112 80 C85 80, 45 105, 15 75 C-10 50, -5 25, 15 15 Z"/>
  <path class="stomach-wall" d="M15 15 C35 -15, 95 -10, 115 25 C125 45, 130 65, 135 65 C140 65, 142 62, 148 62 C160 62, 175 75, 175 95 C175 110, 155 118, 140 105 C130 95, 122 80, 112 80 C85 80, 45 105, 15 75 C-10 50, -5 25, 15 15 Z"/>
  <g class="pylorus-sphincter">
    <path id="pylorus-top" class="pylorus-muscle" d="M132 56 Q137 63 142 56"/>
    <path id="pylorus-bot" class="pylorus-muscle" d="M132 74 Q137 67 142 74"/>
  </g>
  <path class="sc-capillary-bg" d="M40 -44 V15"/>
  <path class="sc-capillary-lumen" d="M40 -44 V15"/>
</g>

<!-- Central Bloodstream (horizontal glossy vessel at y = 250) -->
<rect class="vessel-shadow" x="14" y="233" width="${W - 28}" height="34" rx="4"/>
<rect id="vessel-lumen" class="vessel-lumen" x="14" y="234" width="${W - 28}" height="32" fill="url(#grad-vessel)"/>
<line class="vessel-highlight" x1="14" y1="237" x2="${W - 14}" y2="237"/>
<line class="vessel-midlight" x1="14" y1="248" x2="${W - 14}" y2="248"/>

<!-- Dynamic particle pools -->
<g id="rbcs"></g>
<g id="glucose"></g>
<g id="drug-stream"></g>
<g id="gut-particles"></g>
<g id="incretin-particles"></g>
<g id="islet-granules"></g>
<g id="stomach-particles"></g>
<g id="zoom-particles"></g>

<!-- Key cards: one key vs two keys (lower middle dead space) -->
<g id="key-cards">
  <g id="key-card-sema" class="key-card hot" tabindex="0" data-info="Semaglutide is one key for one lock: the GLP-1 receptor, switching on glucose-dependent insulin release.">
    <rect class="key-card-bg" x="280" y="335" width="197" height="100" rx="10"/>
    <text class="key-title" x="292" y="356">Semaglutide: one key</text>
    <rect class="bilayer-core" x="318" y="383" width="121" height="4"/>
    <path class="phospho-heads" d="M318 383 H439 M318 387 H439"/>
    <g transform="translate(378.5, 385)">
      <path class="rec-tm glp1-tm" d="M-8 -6 V8 M-4 -6 V8 M0 -6 V8 M4 -6 V8 M8 -6 V8"/>
      <path class="rec-pocket glp1-pocket" d="M-9 -6 C-9 -16, 9 -16, 9 -6"/>
      <path class="rec-tail glp1-tail" d="M-3 8 C-3 14, 5 14, 5 8"/>
      <circle class="lig-glp1-dot" cx="0" cy="-12" r="5.5"/>
      <path class="lig-key-notch" d="M0 -10 V-6"/>
    </g>
    <text class="key-sub" x="378.5" y="420" text-anchor="middle">the GLP-1 receptor</text>
  </g>
  <g id="key-card-tirz" class="key-card hot" tabindex="0" data-info="Tirzepatide is two keys in one molecule: the GLP-1 and GIP receptors together, a stronger combined signal.">
    <rect class="key-card-bg" x="488" y="335" width="197" height="100" rx="10"/>
    <text class="key-title" x="500" y="356">Tirzepatide: two keys</text>
    <rect class="bilayer-core" x="526" y="383" width="121" height="4"/>
    <path class="phospho-heads" d="M526 383 H647 M526 387 H647"/>
    <g transform="translate(559.5, 385)">
      <path class="rec-tm glp1-tm" d="M-8 -6 V8 M-4 -6 V8 M0 -6 V8 M4 -6 V8 M8 -6 V8"/>
      <path class="rec-pocket glp1-pocket" d="M-9 -6 C-9 -16, 9 -16, 9 -6"/>
      <path class="rec-tail glp1-tail" d="M-3 8 C-3 14, 5 14, 5 8"/>
      <circle class="lig-glp1-dot" cx="0" cy="-12" r="5.5"/>
    </g>
    <g transform="translate(613.5, 385)">
      <path class="rec-tm gip-tm" d="M-8 -6 V8 M-4 -6 V8 M0 -6 V8 M4 -6 V8 M8 -6 V8"/>
      <path class="rec-pocket gip-pocket" d="M-9 -6 C-9 -16, 9 -16, 9 -6"/>
      <path class="rec-tail gip-tail" d="M-3 8 C-3 14, 5 14, 5 8"/>
      <circle class="lig-gip-dot" cx="0" cy="-12" r="5.5"/>
    </g>
    <path class="tirz-bridge" d="M559.5 367.5 Q586.5 361.5 613.5 367.5"/>
    <text class="key-sub" x="586.5" y="420" text-anchor="middle">the GLP-1 and GIP receptors</text>
  </g>
</g>

<!-- Overlays: label pills, gauges panel, and ad banner -->
<g id="over"></g>
<g id="panel"></g>
<g id="ad-banner" class="ad-banner" opacity="0" pointer-events="none">
  <rect class="ad-banner-bg" x="255" y="290" width="450" height="38" rx="19"/>
  <text id="ad-text" class="ad-banner-txt" x="480" y="314" text-anchor="middle">No medicine</text>
</g>
`;

/* ---------------- extra styles ---------------- */
const extraCss = `
body {
  --c-glp1: #2dd4bf;
  --c-gip: #f59e0b;
  --c-beta: #38bdf8;
  --c-alpha: #fb923c;
  --c-ins: #60a5fa;
  --c-gcg: #f97316;
  --c-camp: #facc15;
  --c-alb: #94a3b8;
  --c-dpp4: #f43f5e;
  --c-brain: #c084fc;
  --c-stomach: #f472b6;
  --c-chyme: #fdba74;
  --c-vessel: #881337;
  --c-lumen: #4c0519;
  --c-depot: #06b6d4;
  --c-skin: #d4a373;
  --c-pen: #334155;
  --c-pen-accent: #0284c7;
  --c-shield: #38bdf8;
}
body[data-theme="light"] {
  --c-glp1: #0d9488;
  --c-gip: #d97706;
  --c-beta: #0284c7;
  --c-alpha: #ea580c;
  --c-ins: #2563eb;
  --c-gcg: #c2410c;
  --c-camp: #ca8a04;
  --c-alb: #64748b;
  --c-dpp4: #be123c;
  --c-brain: #7e22ce;
  --c-stomach: #be185d;
  --c-chyme: #c2410c;
  --c-vessel: #9f1239;
  --c-lumen: #ffe4e6;
  --c-depot: #0891b2;
  --c-skin: #bc7c54;
  --c-pen: #64748b;
  --c-pen-accent: #0369a1;
  --c-shield: #0284c7;
}

.sc-skin-stratum { fill: color-mix(in srgb, var(--c-skin) 80%, #000); }
.sc-skin-dermis { fill: color-mix(in srgb, var(--c-skin) 65%, var(--anatomy-card)); }
.sc-skin-subq { fill: color-mix(in srgb, var(--c-skin) 40%, var(--anatomy-card)); }
.sc-subq-fat { fill: color-mix(in srgb, var(--c-skin) 55%, var(--anatomy-paper)); stroke: var(--c-skin); stroke-width: 0.6; opacity: 0.55; }
.sc-capillary-bg { fill: none; stroke: var(--c-vessel); stroke-width: 5; stroke-linecap: round; opacity: 0.75; }
.sc-capillary-lumen { fill: none; stroke: var(--c-lumen); stroke-width: 2.4; stroke-linecap: round; }

.pen-needle { stroke: #94a3b8; stroke-width: 1.2; stroke-linecap: round; }
.pen-hub { fill: #475569; stroke: #334155; stroke-width: 0.6; }
.pen-barrel { stroke: color-mix(in srgb, var(--c-pen) 50%, #000); stroke-width: 1; }
.pen-window { fill: var(--anatomy-paper); stroke: #475569; stroke-width: 0.6; }
.pen-liquid { fill: var(--c-glp1); opacity: 0.85; }
.pen-clip { fill: #94a3b8; }
.pen-plunger-shaft { fill: #64748b; }
.pen-plunger-btn { fill: var(--c-pen-accent); stroke: #0284c7; stroke-width: 0.8; }

.gut-lumen-bg { fill: color-mix(in srgb, var(--c-chyme) 15%, var(--anatomy-card)); stroke: var(--anatomy-faint); stroke-width: 0.8; }
.gut-wall { fill: none; stroke: var(--anatomy-mid); stroke-width: 1.4; stroke-linecap: round; }
.cell-l-body { fill: var(--c-glp1); stroke: color-mix(in srgb, var(--c-glp1) 50%, #000); stroke-width: 0.8; }
.cell-k-body { fill: var(--c-gip); stroke: color-mix(in srgb, var(--c-gip) 50%, #000); stroke-width: 0.8; }
.cell-nuc { fill: var(--anatomy-paper); opacity: 0.75; }

.dpp4-jaw { fill: var(--c-dpp4); stroke: color-mix(in srgb, var(--c-dpp4) 50%, #000); stroke-width: 0.8; transform-origin: 0px 0px; }
.dpp4-eye { fill: var(--anatomy-paper); }

.albumin-blob { fill: color-mix(in srgb, var(--c-alb) 40%, var(--anatomy-card)); stroke: var(--c-alb); stroke-width: 1; opacity: 0.9; }
.alb-label { font-size: 7.5px; font-weight: 700; fill: var(--anatomy-strong); pointer-events: none; }
.fatty-tail { fill: none; stroke: var(--c-glp1); stroke-width: 1.5; stroke-linecap: round; }
.alb-drug-head { fill: var(--c-glp1); stroke: color-mix(in srgb, var(--c-glp1) 50%, #000); stroke-width: 0.8; }
.drug-shield { fill: none; stroke: var(--c-shield); stroke-width: 1.4; stroke-linejoin: round; }

.islet-border { fill: none; stroke: var(--c-beta); stroke-width: 1.2; stroke-dasharray: 4 3; opacity: 0.8; }
.islet-cap { fill: none; stroke: var(--c-vessel); stroke-width: 1.2; opacity: 0.45; }
.cl-alpha { fill: var(--c-alpha); stroke: color-mix(in srgb, var(--c-alpha) 50%, #000); stroke-width: 0.9; }
.cl-beta { fill: var(--c-beta); stroke: color-mix(in srgb, var(--c-beta) 50%, #000); stroke-width: 0.9; }
.cl-beta.is-zoomed { stroke: var(--anatomy-lit); stroke-width: 1.6; }

.zoom-guide { fill: none; stroke: var(--anatomy-mid); stroke-width: 0.9; stroke-dasharray: 3 3; opacity: 0.65; }
.zoom-inset-border { fill: none; stroke: var(--anatomy-strong); stroke-width: 1.5; }
.cytoplasm-bg { fill: color-mix(in srgb, var(--c-beta) 15%, var(--anatomy-card)); }
.cyto-label { font-size: 6.5px; fill: var(--anatomy-strong); pointer-events: none; }
.extra-label { font-size: 6.5px; fill: var(--anatomy-strong); pointer-events: none; }
.bilayer-core { fill: color-mix(in srgb, var(--anatomy-mid) 40%, var(--anatomy-paper)); }
.phospho-heads { fill: none; stroke: var(--anatomy-mid); stroke-width: 2.2; stroke-linecap: round; stroke-dasharray: 1 3; }

.rec-tm { fill: none; stroke-width: 1.5; stroke-linecap: round; }
.glp1-tm { stroke: var(--c-glp1); }
.gip-tm { stroke: var(--c-gip); }
.rec-pocket { fill: none; stroke-width: 2.2; stroke-linecap: round; }
.glp1-pocket { stroke: var(--c-glp1); }
.gip-pocket { stroke: var(--c-gip); }
.rec-tail { fill: none; stroke-width: 1.5; stroke-linecap: round; }
.glp1-tail { stroke: var(--c-glp1); }
.gip-tail { stroke: var(--c-gip); }

.lig-glp1-dot { fill: var(--c-glp1); stroke: color-mix(in srgb, var(--c-glp1) 50%, #000); stroke-width: 0.8; }
.lig-gip-dot { fill: var(--c-gip); stroke: color-mix(in srgb, var(--c-gip) 50%, #000); stroke-width: 0.8; }
.lig-key-notch { fill: none; stroke: var(--c-glp1); stroke-width: 1.6; stroke-linecap: round; }
.tirz-bridge { fill: none; stroke: var(--anatomy-strong); stroke-width: 1.8; stroke-linecap: round; }

.brain-outline { fill: color-mix(in srgb, var(--c-brain) 25%, var(--anatomy-card)); stroke: var(--c-brain); stroke-width: 1.2; }
.brain-sulci { fill: none; stroke: var(--c-brain); stroke-width: 0.9; opacity: 0.45; }
.brain-cerebellum { fill: color-mix(in srgb, var(--c-brain) 35%, var(--anatomy-card)); stroke: var(--c-brain); stroke-width: 1; }
.brain-stem { fill: none; stroke: var(--c-vessel); stroke-width: 3.5; opacity: 0.6; }
.hypo-core { fill: var(--c-brain); stroke: var(--anatomy-paper); stroke-width: 1; }
.app-ring { fill: none; stroke-linecap: round; pointer-events: none; }

.stomach-bg { fill: color-mix(in srgb, var(--c-stomach) 25%, var(--anatomy-card)); }
.stomach-wall { fill: none; stroke: var(--c-stomach); stroke-width: 1.2; }
.pylorus-muscle { fill: none; stroke: color-mix(in srgb, var(--c-stomach) 60%, #000); stroke-width: 3.5; stroke-linecap: round; }

.vessel-shadow { fill: color-mix(in srgb, var(--c-vessel) 70%, #000); opacity: 0.45; }
.vessel-highlight { stroke: rgba(255, 255, 255, 0.45); stroke-width: 1.4; stroke-linecap: round; }
.vessel-midlight { stroke: rgba(255, 255, 255, 0.12); stroke-width: 1; }

.dr-g-fill.g-sugar { fill: var(--c-bad); }
.dr-g-fill.g-ins { fill: var(--c-ins); }
.dr-g-fill.g-gcg { fill: var(--c-gcg); }
.dr-g-fill.g-emp { fill: var(--c-stomach); }
.dr-g-fill.g-app { fill: var(--c-brain); }
.dr-g-fill.g-wt { fill: var(--c-good); }

/* Ad mode styles */
body.is-ad .dr-controls,
body.is-ad .dr-status,
body.is-ad .dr-info,
body.is-ad .bio-sources,
body.is-ad .dr-caption,
body.is-ad .iso-caption,
body.is-ad .iso-legend,
body.is-ad .dr-lab {
  display: none !important;
}
/* Key cards: one key vs two keys */
.key-card { opacity: 0.45; transition: opacity 0.45s ease; }
.key-card.is-active { opacity: 1; }
.key-card-bg {
  fill: var(--anatomy-card);
  stroke: var(--anatomy-mid);
  stroke-width: 1.2;
  filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.35));
}
.key-card.is-active .key-card-bg { stroke: var(--anatomy-lit); stroke-width: 1.6; }
.key-title { font-size: 11.5px; font-weight: 600; letter-spacing: 0.01em; fill: var(--anatomy-strong); }
.key-sub { font-size: 8.5px; fill: var(--anatomy-strong); }
.ad-banner-bg {
  fill: var(--anatomy-card);
  stroke: var(--anatomy-strong);
  stroke-width: 1.2;
  filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.45));
}
.ad-banner-txt {
  fill: var(--anatomy-strong);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
`;

buildScene({
  id: "incretin-semaglutide-tirzepatide",
  fig: "Fig 1",
  title: "Semaglutide and tirzepatide: GLP-1 and GIP receptor agonists",
  W, H, body, extraCss,
  label: "An animated multi-organ incretin pharmacology scene. A weekly subcutaneous injection pen releases long-acting incretin agonist into the bloodstream. In the gut, intestinal L and K cells release native GLP-1 and GIP after food, which are cleaved within minutes by DPP-4. Synthetic agonists carry a fatty acid diacid tail that binds albumin and resists DPP-4. In the pancreatic islet, glucose-dependent insulin secretion rises while glucagon is suppressed. A zoom inset displays single GLP-1 receptor docking by semaglutide versus dual GLP-1 and GIP receptor docking by tirzepatide, sparking cAMP and insulin vesicle exocytosis. In the brain, hypothalamic appetite signals calm into satiety. In the stomach, gastric emptying slows. Gauges monitor blood sugar, insulin, glucagon, gastric emptying, appetite and weight trend under semaglutide or tirzepatide.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numerical values are shown or implied.",
  scene: { W, H },
  pageJs: readFileSync(join(HERE, "incretin.page.js"), "utf8"),
  modelOf,
  MD,
  tests: TESTS,
  withoutLabel: "No medicine",
  withLabel: "With medicine",
  sourcesLis: [
    "<strong>How incretins and their agonists act.</strong> Gut enteroendocrine cells release incretins after meals: L cells make glucagon-like peptide-1 (GLP-1) and K cells make glucose-dependent insulinotropic polypeptide (GIP). In the pancreas, both stimulate beta-cell insulin secretion in a glucose-dependent manner (low intrinsic hypoglycaemia risk when used alone), and GLP-1 suppresses inappropriate glucagon secretion from alpha cells. In the stomach, GLP-1 slows gastric emptying, blunting postprandial glucose spikes. In the hypothalamus and brainstem, GLP-1 and GIP signal satiety and reduce hunger cravings. Endogenous GLP-1 and GIP are rapidly cleaved within minutes by dipeptidyl peptidase-4 (DPP-4). Semaglutide (a GLP-1 receptor agonist) and tirzepatide (a dual GIP and GLP-1 receptor agonist) are engineered with fatty diacid side chains that bind albumin and resist DPP-4, extending their half-lives to about one week.",
    "<strong>Dual incretin agonism.</strong> Tirzepatide engages both GIP and GLP-1 receptors. Synergy between GIP and GLP-1 receptor pathways produces potent glucose-dependent insulin release, prominent central appetite suppression and marked weight reduction, often with slightly less acute gastric slowing than selective GLP-1 agonism.",
    "<strong>What follows from the action (flagged for clinician review).</strong> Common adverse effects reflect the pharmacology: gastrointestinal symptoms including nausea, vomiting, diarrhoea or constipation (from slowed gastrointestinal transit and vagal signaling), reduced appetite, gallbladder events (such as cholelithiasis from rapid weight loss and gallbladder stasis), and rare pancreatitis. Hypoglycaemia risk is low with monotherapy because insulin secretion is glucose-dependent, but increases when combined with insulin or sulfonylureas. Caution is advised with personal or family history of medullary thyroid carcinoma or multiple endocrine neoplasia syndrome type 2 (MEN2), and in severe gastrointestinal disease.",
  ],
  simplified: "Peptide amino-acid sequences, detailed intracellular phosphorylation cascades, dose escalation schedules, specific trial percentages, oral co-formulation mechanisms, renal and cardiovascular trial endpoints in detail, and all numerical doses are omitted. Speeds and particle counts are illustrative.",
  disclaimer: "For education only; not medical advice about any person's treatment. AI-assisted, awaits clinician review.",
});
