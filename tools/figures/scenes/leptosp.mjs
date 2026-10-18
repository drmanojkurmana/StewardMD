/* Leptospirosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/leptosp.mjs [--print-model]
 * Exposure in urine-contaminated water, entry through skin or mucosa, leptospiraemia,
 * vasculitis, anicteric illness, then Weil disease. Qualitative: no doses, no numeric thresholds. */
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
    { label: "prophylaxis before exposure" },
    { label: "doxycycline or penicillin" },
    { label: "supportive care with dialysis" },
    { label: "antibiotics with supportive care and dialysis" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "prophylaxis before exposure", "doxycycline or penicillin", "supportive care with dialysis", "antibiotics with supportive care and dialysis"],
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
.lp-skin{fill:color-mix(in srgb,var(--c-eos) 32%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.lp-skinIn{fill:color-mix(in srgb,var(--c-eos) 55%,var(--anatomy-paper));opacity:.8}
.lp-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.lp-iris{fill:var(--c-lymph)}
.lp-pupil{fill:#17202a}
.lp-redv{fill:none;stroke:var(--c-bad);stroke-width:1.3;stroke-linecap:round}
.lp-liver{fill:#b85c4a;stroke:color-mix(in srgb,#b85c4a 55%,#000);stroke-width:1.1}
.lp-kidney{fill:#9a6ab5;stroke:color-mix(in srgb,#9a6ab5 55%,#000);stroke-width:1.1}
.lp-lung{fill:#7fb3d9;stroke:color-mix(in srgb,#7fb3d9 55%,#000);stroke-width:1.1;opacity:.92}
.lp-spot{fill:var(--c-bad)}
.lp-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 3}
.lp-spiral{fill:none;stroke:var(--c-bac);stroke-width:1.6;stroke-linecap:round}
.lp-abY{fill:none;stroke:var(--c-neut);stroke-width:1.6;stroke-linecap:round}
.dr-g-fill.g-spiro{fill:var(--c-bac)}
.dr-g-fill.g-immune{fill:var(--c-neut)}
.dr-g-fill.g-vessel{fill:var(--c-bad)}
.dr-g-fill.g-liver{fill:#e0a13e}
.dr-g-fill.g-kidney{fill:#9a6ab5}
.dr-g-fill.g-lung{fill:var(--c-lymph)}
`;

const CY = 292;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="368" y="68">EXPOSURE, BLOOD AND ORGANS</text>
<rect class="lp-water" x="40" y="92" width="176" height="92" rx="14"/>
<path class="lp-arrow" d="M224 138 L282 138"/>
<rect class="lp-skin" x="292" y="84" width="26" height="108" rx="10"/>
<rect class="lp-skinIn" x="298" y="84" width="6" height="108" rx="3"/>
<path class="lp-arrow" d="M326 138 L392 196 L392 252"/>
<g id="waterfx"></g>
<g id="spirals"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 34}" width="${W - 28}" height="68" rx="10"/>
<g id="rbcs"></g>
<g id="endo"></g>
<g id="parts"></g>
<g id="organs"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "leptospirosis", fig: "Fig 1", title: "Leptospirosis: contaminated water to Weil disease", W, H, body, extraCss,
  label: "An animated scene of leptospirosis. Water contaminated with animal urine holds spiral leptospires. They enter through skin or mucosa, spread in the blood, injure vessel walls, and in severe disease cause jaundice, kidney failure, bleeding and lung haemorrhage. The phase slider moves from leptospiraemic to immune to Weil disease. Treatment choices include prophylaxis, doxycycline or penicillin, and supportive care with dialysis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or patient advice are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "leptosp.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How leptospirosis develops.</strong> Leptospira bacteria live in the kidneys of animals and leave in urine, contaminating water and soil. After an incubation period they enter through cuts in skin or through mucosa, reach the blood (leptospiraemia) and spread to tissues. Outer membrane proteins help them attach and evade early immunity. The first phase brings fever, headache, muscle pain and conjunctival suffusion (red eyes without discharge). Antibodies then clear leptospires from blood, but they may persist in kidney tubules and appear in urine. In severe Weil disease, vasculitis and tissue injury cause jaundice from liver dysfunction, renal failure from tubular injury and interstitial nephritis, bleeding, and pulmonary haemorrhage, which drives mortality. Although many illnesses are anicteric and mild, severe disease can be fatal. This is standard textbook teaching, flagged as AI-assisted for clinician review.",
    "<strong>Treatment ideas shown.</strong> Prophylaxis before exposure can reduce entry. Doxycycline or penicillin kills leptospires. Supportive care with dialysis supports failing kidneys and other organs but does not itself kill the bacteria. These are teaching toggles only.",
  ],
  simplified: "Animal reservoirs in detail, serovar differences, laboratory diagnosis, meningitis, uveitis, myocarditis, exact immune mechanisms, and all doses and dialysis prescriptions are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
