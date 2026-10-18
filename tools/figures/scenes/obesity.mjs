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

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="ob-arrow" d="M136 135L286 162"/>
<path class="ob-arrow" d="M286 232L138 272"/>
<path class="ob-arrow dash" d="M452 148C540 112 610 108 668 112"/>
<path class="ob-arrow dash" d="M340 292L308 338M430 296L498 338M470 282C560 300 640 322 692 348"/>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "obesity-adipose-pathogenesis", fig: "Fig 1", title: "Obesity: fat tissue, signals and metabolic effects", W, H, body,
  label: "An animated fat tissue scene. Food intake above activity stores fat in fat cells, which enlarge. Fat cells release leptin toward brain control centres, but that signal is resisted. Macrophages enter enlarged fat and release inflammatory signals. Free fatty acids and adipokines reach liver, muscle and blood vessels, reducing insulin action and raising liver fat, blood lipids and pressure. Gauges show fat store, leptin resistance, inflammation, insulin action, liver fat, and lipids with pressure. Treatments are lifestyle change, a GLP-1 based drug and bariatric surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "obesity.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How obesity develops.</strong> Health depends in part on energy balance: when energy intake stays above expenditure, the excess is stored in adipose tissue and fat cells enlarge. Adipose tissue is a hormonal organ. Its peptide signal leptin acts on receptors on hypothalamic and brainstem neurons to regulate appetite, but with rising fat the brain responds less, so leptin resistance lets intake continue. Enlarged fat tissue attracts macrophages, and their inflammatory signals plus changed adipokines and free fatty acids reduce insulin action in muscle and liver. Fat builds up in the liver, blood lipids become abnormal and blood pressure rises, a cluster called metabolic syndrome. Prevalence differs between populations and is rising in women, men and children as the available food and activity environment changes. This is standard teaching in medicine and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Lifestyle change lowers intake and raises activity. GLP-1 based drugs act on gut and brain signals to reduce appetite and intake. Bariatric surgery changes gut anatomy and signals so intake falls and weight is lost. These are teaching toggles only.",
  ],
  simplified: "Genetics, medicines and endocrine causes of weight gain, sleep and mood links, fertility and joint effects, childhood and population prevention detail, cancer links, and all doses, eligibility rules and drug choices within each class are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
  extraCss: `
body{--c-food:#ff9a3d;--c-act:#3ddc97;--c-adip:#f2c14e;--c-lep:#ffd24a;--c-brain:#b7a1e6;--c-liver:#d97a68;--c-mus:#e07a8a;--c-ffa:#38d1ff;--c-treat:#5ec1a0}
body[data-theme="light"]{--c-food:#d96f1e;--c-act:#0f8f62;--c-adip:#c9971f;--c-lep:#b8860b;--c-brain:#8f72d0;--c-liver:#b85a48;--c-mus:#c45060;--c-ffa:#0a7fd1;--c-treat:#2f8f6c}
.cl-food{--cc:var(--c-food)}.cl-act{--cc:var(--c-act)}.cl-adip{--cc:var(--c-adip)}.cl-brain{--cc:var(--c-brain)}.cl-liver{--cc:var(--c-liver)}.cl-mus{--cc:var(--c-mus)}
.p-food{--cc:var(--c-food)}.p-lep{--cc:var(--c-lep)}.p-ffa{--cc:var(--c-ffa)}.p-treat{fill:var(--c-treat);stroke:color-mix(in srgb,var(--c-treat) 55%,#000);stroke-width:.6}
.ob-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round;opacity:.5}
.ob-arrow.dash{stroke-dasharray:4 5}
.ob-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.4}
.ob-rbc{fill:var(--c-rbc);opacity:.75}
.dr-g-fill.g-fat{fill:var(--c-adip)}.dr-g-fill.g-lepr{fill:var(--c-lep)}.dr-g-fill.g-ins{fill:var(--c-good)}.dr-g-fill.g-liv{fill:var(--c-liver)}.dr-g-fill.g-lip{fill:var(--c-ffa)}
`,
});
