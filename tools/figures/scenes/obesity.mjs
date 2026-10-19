/* Obesity and adipose pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/obesity.mjs [--print-model]
 * Static layout here; cells, signals and gauges move in obesity.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Weight level", a: [0.25, 0.6, 1], names: ["normal", "overweight", "obese"], ticks: ["normal", "overweight", "obese"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "lifestyle change" },
    { label: "GLP-1 based drug" },
    { label: "bariatric surgery" },
  ],
  status: "Weight: {level} · {drug} ·",
  drugNames: ["no treatment", "lifestyle change", "GLP-1 based drug", "bariatric surgery"],
};
function modelOf(S, level, drug) {
  const RED = [0, 0.16, 0.32, 0.5];
  const APP = [0, 0.12, 0.34, 0.2];
  const a = S.level.a[level], red = RED[drug], app = APP[drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Intake = cl(0.35 + 0.6 * a - app - red * 0.3);
  const F = cl(0.1 + 0.85 * a - red);
  const LepR = cl((F - 0.28) * 1.25);
  const Inf = cl(0.04 + 0.95 * Math.max(0, F - 0.18));
  const FFA = cl(0.06 + 0.55 * F + 0.4 * Inf);
  const IR = cl(0.05 + 0.6 * FFA + 0.35 * Inf);
  const Ins = cl(1 - IR);
  const Liv = cl(0.03 + 0.85 * FFA * (0.35 + 0.65 * F));
  const Lip = cl(0.05 + 0.7 * IR + 0.25 * F);
  const BP = cl(0.12 + 0.55 * IR + 0.3 * F);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(F, 0.35, 0.65, ["normal", "raised", "high"]), w(Ins, 0.35, 0.65, ["poor", "reduced", "good"]), w(Liv, 0.3, 0.6, ["little", "some", "much"])];
  return { a, drug, Intake, F, LepR, Inf, FFA, IR, Ins, Liv, Lip, BP, words, readout: "fat store " + words[0] + " · insulin action " + words[1] + " · liver fat " + words[2] };
}
const TESTS = [
  [2, 0, "fat store high · insulin action poor · liver fat much"],
  [2, 3, "fat store raised · insulin action reduced · liver fat little"],
  [0, 0, "fat store normal · insulin action good · liver fat little"],
];

/* Organ slots and flow paths. Path shapes are set from organ ports in initOrgans
 * (obesity.page.js) so vessels and particles meet real anatomy. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="foodPath" class="ob-flow" d="M28 190L74 190"/>
<path id="lepPath" class="ob-arrow" d="M445 150C520 130 590 135 655 175"/>
<path id="hungerPath" class="ob-hunger" d="M641 126C520 82 300 82 150 122"/>
<path id="ffaLiv" class="ob-arrow" d="M360 245L265 284"/>
<path id="ffaMus" class="ob-arrow" d="M415 250L438 355"/>
<path id="ffaVes" class="ob-arrow" d="M470 225L735 303"/>
<g id="stomachSlot"></g>
<g id="brainSlot"></g>
<g id="liverSlot"></g>
<g id="muscleSlot"></g>
<g id="vesselSlot"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "obesity-adipose-pathogenesis", fig: "Fig 1", title: "Obesity: fat tissue, signals and metabolic effects", W, H, body,
  label: "An animated fat tissue scene. Food enters the stomach and a lasting surplus is stored in fat cells, which enlarge. Fat cells release leptin toward the brain, but that signal is resisted, and hunger signals keep driving eating. Macrophages enter enlarged fat and release inflammatory signals. Free fatty acids reach the liver, muscle and blood vessels, reducing insulin action and raising liver fat, blood lipids and pressure. A slider sets the weight level, and treatment choices are lifestyle change, a GLP-1 based drug and bariatric surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "obesity.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With bariatric surgery",
  sourcesLis: [
    "<strong>How obesity develops.</strong> Health depends in part on energy balance: when energy intake stays above expenditure, the excess is stored in adipose tissue and fat cells enlarge. Adipose tissue is a hormonal organ. Its peptide signal leptin acts on receptors on hypothalamic and brainstem neurons to regulate appetite, but with rising fat the brain responds less, so leptin resistance lets intake continue. Enlarged fat tissue attracts macrophages, and their inflammatory signals plus changed adipokines and free fatty acids reduce insulin action in muscle and liver. Fat builds up in the liver, blood lipids become abnormal and blood pressure rises, a cluster called metabolic syndrome. Prevalence differs between populations and is rising in women, men and children as the available food and activity environment changes. This is standard teaching in medicine and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Lifestyle change lowers intake and raises activity. GLP-1 based drugs act on gut and brain signals to reduce appetite and intake. Bariatric surgery changes gut anatomy and signals so intake falls and weight is lost. These are teaching toggles only.",
  ],
  simplified: "Genetics, medicines and endocrine causes of weight gain, sleep and mood links, fertility and joint effects, childhood and population prevention detail, cancer links, and all doses, eligibility rules and drug choices within each class are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
  extraCss: `
body{--c-food:#ff9a3d;--c-adip:#f2c14e;--c-lep:#ffd24a;--c-treat:#5ec1a0}
body[data-theme="light"]{--c-food:#d96f1e;--c-adip:#c9971f;--c-lep:#b8860b;--c-treat:#2f8f6c}
.cl-adip{--cc:var(--c-adip)}
.p-food{--cc:var(--c-food)}.p-lep{--cc:var(--c-lep)}.p-ffa{--cc:var(--c-cyt2)}.p-hun{--cc:var(--c-mac)}
.p-treat{fill:var(--c-treat);stroke:color-mix(in srgb,var(--c-treat) 55%,#000);stroke-width:.6}
.ob-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.ob-flow{fill:none;stroke:var(--c-food);stroke-width:2.5;stroke-linecap:round}
.ob-hunger{fill:none;stroke:var(--c-mac);stroke-width:2;stroke-dasharray:5 4}
.ob-fatov{fill:var(--c-adip);stroke:none}
.ob-drop{fill:var(--c-adip);stroke:color-mix(in srgb,var(--c-adip) 55%,#000);stroke-width:.6}
.ob-shade{fill:var(--anatomy-mid);stroke:none}
.ob-press{fill:var(--c-rbc);stroke:none}
.ob-rbc{fill:var(--c-rbc);stroke:none}
.ob-dock{fill:var(--c-treat);stroke:color-mix(in srgb,var(--c-treat) 55%,#000);stroke-width:.8}
.ob-bhalo{fill:var(--c-treat);stroke:none}
.ob-ring{fill:none;stroke:var(--c-treat);stroke-width:2.5;stroke-dasharray:6 5}
.ob-band{fill:color-mix(in srgb,var(--c-bad) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.2}
.ob-cap{fill:var(--anatomy-strong)}
.dr-g-fill.g-fat{fill:var(--c-adip)}.dr-g-fill.g-lepr{fill:var(--c-lep)}.dr-g-fill.g-ins{fill:var(--c-good)}.dr-g-fill.g-liv{fill:var(--c-rbc)}.dr-g-fill.g-lip{fill:var(--c-cyt2)}
`,
});
