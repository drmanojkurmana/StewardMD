/* Pharmacokinetics (ADME) as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/adme.mjs [--print-model]
 * Static layout here; drug particles, binding, clearance and the concentration curve move in adme.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Route and organ function", a: [0, 1, 2, 3], names: ["oral route", "intravenous route", "liver impairment", "kidney impairment"], ticks: ["oral", "intravenous", "liver impaired", "kidney impaired"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "enzyme inducer" },
    { label: "enzyme inhibitor" },
    { label: "renal impairment adjustment" },
  ],
  status: "Route and state: {level} · {drug} ·",
  drugNames: ["no treatment", "an enzyme inducer", "an enzyme inhibitor", "renal adjustment"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const iv = level === 1 ? 1 : 0, liverImp = level === 2 ? 1 : 0, kidneyImp = level === 3 ? 1 : 0;
  const inducer = drug === 1 ? 1 : 0, inhibitor = drug === 2 ? 1 : 0, renalAdj = drug === 3 ? 1 : 0;
  const bio = iv ? 1 : liverImp ? 0.84 : 0.58;
  const firstPass = iv ? 0 : liverImp ? 0.16 : 0.42;
  const metabBase = liverImp ? 0.22 : 0.62;
  const renalBase = kidneyImp ? 0.16 : 0.62;
  const metab = cl(metabBase * (inducer ? 1.65 : inhibitor ? 0.38 : 1));
  const renal = cl(renalBase);
  const bile = liverImp ? 0.18 : 0.32;
  const freeF = liverImp ? 0.46 : kidneyImp ? 0.38 : 0.28;
  const doseRate = renalAdj ? (kidneyImp ? 0.72 : 0.85) : 1;
  const clTot = cl(0.55 * metab + 0.35 * renal + 0.10 * bile);
  const ke = 0.55 + 2.6 * clTot;
  const hl = cl(1.05 - 0.85 * clTot);
  const peak = cl(bio * doseRate * (iv ? 1 : 0.8));
  const auc = cl((bio * doseRate) / (clTot + 0.25) * 0.55);
  const steady = cl(auc * (0.7 + 0.6 * hl));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(peak, 0.35, 0.65, ["low", "moderate", "high"]), w(auc, 0.32, 0.58, ["low", "usual", "high"]), w(hl, 0.38, 0.68, ["short", "usual", "long"]), w(steady, 0.35, 0.65, ["low", "usual", "high"])];
  return { iv, liverImp, kidneyImp, inducer, inhibitor, renalAdj, bio, firstPass, metab, renal, bile, freeF, doseRate, clTot, ke, hl, peak, auc, steady, words, readout: "peak " + words[0] + " · exposure " + words[1] + " · half-life " + words[2] + " · steady state " + words[3] };
}
const TESTS = [
  [0, 0, "peak moderate · exposure usual · half-life usual · steady state usual"],
  [1, 0, "peak high · exposure high · half-life usual · steady state high"],
  [2, 0, "peak high · exposure high · half-life long · steady state high"],
  [0, 1, "peak moderate · exposure low · half-life short · steady state low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="pk-node pk-gut" x="30" y="92" width="150" height="110" rx="14"/>
<rect class="pk-node pk-liver" x="230" y="92" width="170" height="110" rx="14"/>
<rect class="pk-node pk-plasma" x="450" y="92" width="200" height="110" rx="14"/>
<rect class="pk-node pk-tissue" x="700" y="92" width="230" height="110" rx="14"/>
<path class="pk-flow" d="M180 147H224"/><path class="pk-flow" d="M400 147H444"/>
<path class="pk-flow" d="M650 138H694"/><path class="pk-flow" d="M694 158H656"/>
<polygon class="pk-head" points="224,147 214,142 214,152"/><polygon class="pk-head" points="444,147 434,142 434,152"/>
<polygon class="pk-head" points="694,138 684,133 684,143"/><polygon class="pk-head" points="656,158 666,153 666,163"/>
<path class="pk-dash" d="M360 202V224H860V244"/>
<path class="pk-dash" d="M550 202V244"/>
<text class="sc-lab pk-cap" x="105" y="190" text-anchor="middle">lumen to blood</text>
<text class="sc-lab pk-cap" x="315" y="190" text-anchor="middle">enzymes act here</text>
<text class="sc-lab pk-cap" x="550" y="190" text-anchor="middle">bound and free</text>
<text class="sc-lab pk-cap" x="815" y="190" text-anchor="middle">drug enters and leaves</text>
<g id="gutdet"></g><g id="livdet"></g><g id="pladet"></g><g id="tisdet"></g>
<rect class="pk-graph" x="30" y="250" width="430" height="160" rx="12"/>
<g id="graph"></g>
<rect class="pk-node pk-kidney" x="500" y="250" width="190" height="160" rx="12"/>
<rect class="pk-node pk-bile" x="730" y="250" width="200" height="160" rx="12"/>
<g id="kidet"></g><g id="bildet"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-drug:#e8930c;--c-prot:#2f9f7c;--c-metab:#8a8f98;--c-urine:#d9a92c;--c-bile:#6aa84f;--c-gut:#7ab8ff;--c-liv:#e07856;--c-tis:#b7a1e6}
body[data-theme="light"]{--c-drug:#c77400;--c-prot:#237a5e;--c-metab:#6b7280;--c-urine:#a67c00;--c-bile:#4c7a34;--c-gut:#2f7ad8;--c-liv:#c2502e;--c-tis:#8f72d0}
.pk-node{stroke:var(--anatomy-mid);stroke-width:1.2}
.pk-gut{fill:color-mix(in srgb,var(--c-gut) 26%,var(--anatomy-paper))}
.pk-liver{fill:color-mix(in srgb,var(--c-liv) 30%,var(--anatomy-paper))}
.pk-plasma{fill:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper))}
.pk-tissue{fill:color-mix(in srgb,var(--c-tis) 26%,var(--anatomy-paper))}
.pk-kidney{fill:color-mix(in srgb,var(--c-endo) 28%,var(--anatomy-paper))}
.pk-bile{fill:color-mix(in srgb,var(--c-bile) 24%,var(--anatomy-paper))}
.pk-graph{fill:color-mix(in srgb,var(--anatomy-paper) 88%,var(--c-gut));stroke:var(--anatomy-mid);stroke-width:1.2}
.pk-flow{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.pk-head{fill:var(--anatomy-mid)}
.pk-dash{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 4;opacity:.65}
.pk-cap{opacity:.75}
.pk-wall{fill:none;stroke:color-mix(in srgb,var(--c-gut) 55%,var(--anatomy-mid));stroke-width:2}
.pk-lumen{fill:color-mix(in srgb,var(--c-gut) 16%,var(--anatomy-paper))}
.pk-hep{fill:color-mix(in srgb,var(--c-liv) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-liv) 55%,#000);stroke-width:.7}
.pk-enz{fill:var(--c-drug);stroke:color-mix(in srgb,var(--c-drug) 55%,#000);stroke-width:.5}
.pk-block{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.pk-prot{fill:color-mix(in srgb,var(--c-prot) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-prot) 60%,#000);stroke-width:.8}
.pk-tcell{fill:color-mix(in srgb,var(--c-tis) 40%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-tis) 55%,#000);stroke-width:.7}
.pk-axis{stroke:var(--anatomy-mid);stroke-width:1.2}
.pk-grid{stroke:var(--anatomy-mid);stroke-width:.6;opacity:.35}
.pk-curve1{fill:none;stroke:var(--c-drug);stroke-width:2.6;stroke-linejoin:round}
.pk-curve2{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 4;stroke-linejoin:round}
.pk-half{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:4 3}
.pk-hdot{fill:var(--c-bad)}
.pk-dose{stroke:var(--anatomy-mid);stroke-width:1.2}
.pk-tube{fill:none;stroke:color-mix(in srgb,var(--c-urine) 60%,var(--anatomy-mid));stroke-width:5;stroke-linecap:round}
.pk-duct{fill:none;stroke:color-mix(in srgb,var(--c-bile) 65%,var(--anatomy-mid));stroke-width:5;stroke-linecap:round}
.p-drug{fill:var(--c-drug);stroke:color-mix(in srgb,var(--c-drug) 55%,#000);stroke-width:.5}
.p-metab{fill:var(--c-metab);stroke:color-mix(in srgb,var(--c-metab) 55%,#000);stroke-width:.5}
.p-urine{fill:var(--c-urine);stroke:color-mix(in srgb,var(--c-urine) 55%,#000);stroke-width:.5}
.p-bilep{fill:var(--c-bile);stroke:color-mix(in srgb,var(--c-bile) 55%,#000);stroke-width:.5}
.dr-g-fill.g-drug{fill:var(--c-drug)}.dr-g-fill.g-prot{fill:var(--c-prot)}.dr-g-fill.g-liv{fill:var(--c-liv)}.dr-g-fill.g-kid{fill:var(--c-fl)}
`;

buildScene({
  id: "pharmacokinetics-adme", fig: "Fig 1", title: "Pharmacokinetics: absorption, distribution, metabolism and excretion", W, H, body, extraCss,
  label: "An animated pharmacokinetics scene. A dose crosses the gut wall, passes the liver in the portal blood where first-pass metabolism removes some drug, then reaches the plasma. In plasma, drug is either bound to protein or free; only free drug moves into tissues and back. The liver metabolises drug over time, the kidney excretes drug into urine, and some drug leaves in bile. A concentration over time curve shows a single dose decay, its half-life, and repeated dosing rising to a steady state. Route and organ function settings cover oral and intravenous dosing and liver or kidney impairment. Treatment settings cover an enzyme inducer, an enzyme inhibitor and a renal impairment adjustment. Gauges show absorption, free drug, liver metabolism, kidney excretion, half-life and overall exposure.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "adme.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "No treatment", withLabel: "With renal adjustment",
  sourcesLis: [
    "<strong>Absorption and first pass.</strong> After an oral dose, drug crosses the gut wall into portal blood and reaches the liver before the systemic circulation, so gut wall and liver enzymes can remove part of the dose before it acts (first-pass metabolism) and bioavailability is less than complete. An intravenous dose enters the systemic blood directly, bypasses absorption and first pass, and reaches a higher, faster peak. This is standard pharmacology teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Distribution, binding and half-life.</strong> In plasma, drug exists in a dynamic balance between protein-bound drug (a circulating store that does not leave the blood) and free drug (the form that crosses into tissues, acts, and is cleared). Distribution into tissues and back, together with total clearance by metabolism and excretion, sets the half-life: the time for the plasma concentration to fall by half. Reduced clearance prolongs half-life and raises exposure. Flagged for review.",
    "<strong>Metabolism, excretion, interactions and steady state.</strong> The liver metabolises drug (with a smaller biliary route into the gut), and the kidney excretes drug and metabolites in urine. Enzyme inducers speed liver metabolism and lower exposure; enzyme inhibitors slow it and raise exposure and half-life. With repeated dosing at a regular interval, drug accumulates until the amount cleared between doses balances the amount given, reaching a steady state; when kidney function is poor, adjusting the regimen (for example spacing doses) brings exposure back toward usual. These are teaching toggles only. Flagged for review.",
  ],
  simplified: "Transporters, enterohepatic recycling detail, tissue binding, volume of distribution as a measured quantity, active metabolites, renal tubular secretion and reabsorption detail, saturable kinetics, and all doses, intervals and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
