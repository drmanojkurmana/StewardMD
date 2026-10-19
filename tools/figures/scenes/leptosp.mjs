/* Leptospirosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/leptosp.mjs [--print-model]
 * Exposure in urine-contaminated water, entry through skin, leptospiraemia,
 * vasculitis, then Weil disease. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Phase of illness", a: [0.4, 0.7, 1], names: ["leptospiraemic", "immune", "Weil disease"], ticks: ["leptospiraemic", "immune", "Weil"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "prophylaxis" },
    { label: "antibiotic" },
    { label: "support and dialysis" },
    { label: "antibiotic with support and dialysis" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "prophylaxis", "antibiotic", "support and dialysis", "antibiotic with support and dialysis"],
};
function modelOf(S, level, drug) {
  const TABLE = [
    { spiro: 0.92, immune: 0.14, vessel: 0.30, fever: 0.62, liver: 0.10, kidney: 0.12, lung: 0.06 },
    { spiro: 0.55, immune: 0.76, vessel: 0.64, fever: 0.74, liver: 0.34, kidney: 0.38, lung: 0.20 },
    { spiro: 0.34, immune: 0.92, vessel: 0.95, fever: 0.52, liver: 0.92, kidney: 0.95, lung: 0.72 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const b = TABLE[level];
  const proph = drug === 1 ? 1 : 0, abx = (drug === 2 || drug === 4) ? 1 : 0, sup = (drug === 3 || drug === 4) ? 1 : 0;
  const entry = proph ? (level === 0 ? 0.30 : 0.78) : 1;
  const Spiro = cl(b.spiro * entry * (abx ? 0.14 : 1));
  const Immune = cl(b.immune * (0.55 + 0.45 * entry) + (proph && level === 0 ? 0.05 : 0));
  const Vessel = cl(b.vessel * (abx ? 0.58 : 1) * (proph && level === 0 ? 0.6 : 1));
  const Fever = cl(b.fever * (abx ? 0.55 : 1) * (0.5 + 0.5 * Math.max(Spiro, Immune * 0.8)));
  const Liver = cl(b.liver * (abx ? 0.62 : 1) * (sup ? 0.88 : 1));
  const Kidney = cl(b.kidney * (abx ? 0.68 : 1) * (sup ? 0.32 : 1));
  const Lung = cl(b.lung * (abx ? 0.60 : 1) * (sup ? 0.68 : 1));
  const Eye = cl(Vessel * 0.85 + Fever * 0.15);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Spiro, 0.22, 0.55, ["cleared", "present", "high"]), w(Kidney, 0.25, 0.55, ["working", "impaired", "failing"]), w(Lung, 0.22, 0.5, ["clear", "bleeding", "haemorrhage"])];
  return { Spiro, Immune, Vessel, Fever, Liver, Kidney, Lung, Eye, abx, sup, proph, words, readout: "spirochaetes " + words[0] + " · kidney " + words[1] + " · lung " + words[2] };
}
const TESTS = [
  [0, 0, "spirochaetes high · kidney working · lung clear"],
  [2, 0, "spirochaetes present · kidney failing · lung haemorrhage"],
  [2, 2, "spirochaetes cleared · kidney failing · lung bleeding"],
  [2, 4, "spirochaetes cleared · kidney working · lung bleeding"],
];

const extraCss = `
.lp-water{fill:var(--c-fl);opacity:.38;stroke:var(--anatomy-mid);stroke-width:1}
.lp-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 3}
.lp-spiral{fill:none;stroke:var(--c-bac);stroke-width:1.6;stroke-linecap:round}
.lp-abY{fill:none;stroke:var(--c-neut);stroke-width:1.6;stroke-linecap:round}
.lp-spot{fill:var(--c-bad)}
.lp-jau{fill:#e8c832}
.lp-kid{fill:#2a1a33}
.lp-redv{fill:none;stroke:var(--c-bad);stroke-width:1.3;stroke-linecap:round}
.lp-cap{font-size:13px;fill:var(--anatomy-strong)}
.lp-shield{fill:color-mix(in srgb,var(--c-good) 30%,transparent);stroke:var(--c-good);stroke-width:2;stroke-dasharray:7 5}
.lp-mach{fill:color-mix(in srgb,var(--anatomy-mid) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.lp-cham{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.lp-light{fill:var(--c-good)}
.lp-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:2.4;stroke-linecap:round}
.lp-drain{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round;stroke-dasharray:3 4}
.lp-dose{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.lp-dose2{fill:var(--c-bad)}
.dr-g-fill.g-spiro{fill:var(--c-bac)}
.dr-g-fill.g-immune{fill:var(--c-neut)}
.dr-g-fill.g-vessel{fill:var(--c-bad)}
.dr-g-fill.g-liver{fill:#e0a13e}
.dr-g-fill.g-kidney{fill:#9a6ab5}
.dr-g-fill.g-lung{fill:var(--c-lymph)}
`;

const CY = 262;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="lp-water" x="40" y="92" width="176" height="92" rx="14"/>
<path id="arrowIn" class="lp-arrow" d="M222 130 L272 130"/>
<path id="dropPath" class="lp-arrow" d="M330 184 L330 226"/>
<path id="connEye" class="lp-arrow" d="M110 296 L110 328"/>
<path id="connLiver" class="lp-arrow" d="M350 296 L350 310"/>
<path id="connKid" class="lp-arrow" d="M595 296 L595 321"/>
<path id="connLung" class="lp-arrow" d="M815 296 L815 306"/>
<g id="skinSlot"></g>
<g id="waterfx"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 34}" width="${W - 28}" height="68" rx="10"/>
<g id="rbcs"></g>
<g id="endo"></g>
<g id="eyeSlot"></g>
<g id="liverSlot"></g>
<g id="kidSlot"></g>
<g id="lungSlot"></g>
<g id="parts"></g>
<g id="fx"></g>
<g id="mach"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "leptospirosis", fig: "Fig 1", title: "Leptospirosis: contaminated water to Weil disease", W, H, body, extraCss,
  label: "An animated scene of leptospirosis. Water contaminated with animal urine holds spiral leptospires. They enter through skin, spread in the blood, injure vessel walls, and in severe disease cause jaundice, kidney failure and lung bleeding. The phase slider moves from leptospiraemic to immune to Weil disease. Treatment choices are prophylaxis, antibiotic, and support with dialysis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or patient advice are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "leptosp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antibiotic with support and dialysis",
  sourcesLis: [
    "<strong>How leptospirosis develops.</strong> Leptospira bacteria live in the kidneys of animals and leave in urine, contaminating water and soil. After an incubation period they enter through cuts in skin or through mucosa, reach the blood (leptospiraemia) and spread to tissues. The first phase brings fever, headache, muscle pain and conjunctival suffusion (red eyes without discharge). Antibodies then clear leptospires from blood, but they may persist in kidney tubules and appear in urine. In severe Weil disease, vasculitis and tissue injury cause jaundice from liver dysfunction, renal failure from tubular injury and interstitial nephritis, bleeding, and pulmonary haemorrhage, which drives mortality. Although many illnesses are mild, severe disease can be fatal. This is standard textbook teaching, flagged as AI-assisted for clinician review.",
    "<strong>Treatment ideas shown.</strong> Prophylaxis before exposure can reduce entry. Antibiotic (doxycycline or penicillin) kills leptospires. Supportive care with dialysis supports failing kidneys and clears wastes but does not itself kill the bacteria. These are teaching toggles only.",
  ],
  simplified: "Animal reservoirs in detail, serovar differences, laboratory diagnosis, meningitis, uveitis, myocarditis, exact immune mechanisms, and all doses and dialysis prescriptions are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
