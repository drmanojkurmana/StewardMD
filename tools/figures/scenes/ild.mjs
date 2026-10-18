/* Interstitial lung disease and pulmonary fibrosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ild.mjs [--print-model]
 * Static layout here; injury, fibroblasts, collagen, gas transfer and gauges move in ild.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of lung disease", a: [0.25, 0.6, 1], names: ["early", "established", "end-stage"], ticks: ["early", "established", "end-stage"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antifibrotic" },
    { label: "immunosuppression for inflammatory type" },
    { label: "oxygen and transplant" },
  ],
  status: "Interstitial lung disease: {level} · {drug} ·",
  drugNames: ["no treatment", "antifibrotic", "immunosuppression for inflammatory type", "oxygen and transplant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const anti = drug === 1 ? 1 : 0, imm = drug === 2 ? 1 : 0, oxyT = drug === 3 ? 1 : 0;
  const inj = cl((0.1 + 0.8 * a) * (imm ? 0.42 : 1) * (anti ? 0.88 : 1));
  const fib = cl((0.08 + 0.88 * a) * (anti ? 0.52 : 1) * (imm ? 0.78 : 1));
  const col = cl((0.06 + 0.55 * a + 0.4 * a * a) * (anti ? 0.7 : 1) * (imm ? 0.9 : 1));
  const honey = cl((col - 0.32) * 1.5 * (anti ? 0.82 : 1));
  const diff = cl(1 - 0.72 * col - 0.18 * honey);
  const comp = cl(1 - 0.68 * col - 0.2 * honey);
  const vol = cl(1 - 0.62 * col - 0.22 * honey);
  const oxy = cl(0.28 + 0.62 * diff - 0.12 * (1 - comp) + (oxyT ? 0.42 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(col, 0.3, 0.62, ["little", "moderate", "extensive"]), w(diff, 0.35, 0.62, ["low", "reduced", "near normal"]), w(comp, 0.35, 0.62, ["low", "reduced", "near normal"]), w(oxy, 0.45, 0.68, ["low", "reduced", "near normal"])];
  return { a, anti, imm, oxyT, inj, fib, col, honey, diff, comp, vol, oxy, words, readout: "fibrosis " + words[0] + " · diffusion " + words[1] + " · compliance " + words[2] + " · oxygen " + words[3] };
}
const TESTS = [
  [0, 0, "fibrosis little · diffusion near normal · compliance near normal · oxygen near normal"],
  [2, 0, "fibrosis extensive · diffusion low · compliance low · oxygen low"],
  [2, 1, "fibrosis extensive · diffusion reduced · compliance reduced · oxygen reduced"],
  [2, 3, "fibrosis extensive · diffusion low · compliance low · oxygen reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ALVEOLAR UNIT</text>
<text class="sc-zone" x="640" y="68">WHOLE LUNG</text>
<g id="lungG"></g><g id="alvG"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "interstitial-lung-disease", fig: "Fig 1", title: "Interstitial lung disease: injury to pulmonary fibrosis", W, H, body,
  label: "An animated view of interstitial lung disease and pulmonary fibrosis. Repeated injury to alveolar epithelial cells, from causes that include idiopathic disease, connective tissue disease, asbestos and some drugs, wakes fibroblasts in the interstitium. Fibroblasts lay down collagen, the interstitium thickens, gas diffusion falls and the lung becomes stiff and smaller, a restrictive pattern. Late disease shows honeycombing. Signs include cough, breathlessness, fine crackles and finger clubbing. Gauges show injury, fibrosis, diffusion, compliance, lung volume and oxygen. Treatment choices include an antifibrotic, immunosuppression for an inflammatory type, and oxygen with transplant referral.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ild.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How interstitial lung disease develops.</strong> The interstitium is the thin support tissue between the alveolar epithelium and the capillary endothelium, where oxygen crosses into blood. Repeated alveolar epithelial injury and abnormal repair activate fibroblasts, which become matrix making cells and deposit collagen and other extracellular matrix. The interstitium thickens and stiffens, alveolar walls distort, and in advanced disease clustered cystic spaces called honeycombing replace normal lung. Causes and patterns include idiopathic pulmonary fibrosis, connective tissue disease, hypersensitivity and inhaled exposures such as asbestos, and some drugs; in many cases the cause is unknown. Thickened walls increase the distance for diffusion, and a stiff, low compliance lung gives a restrictive pattern with reduced lung volumes. Typical findings stressed in standard textbook teaching such as Harrison Interstitial Lung Disease include cough, progressive breathlessness, fine inspiratory crackles (rales), and finger clubbing in some patients, with impaired gas transfer on lung function. This account was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antifibrotic slows fibroblast driven scarring and decline but does not remove established collagen. Immunosuppression helps mainly where inflammation drives the pattern, for example some connective tissue disease related disease, and is not a treatment for established scar alone. Oxygen supports blood oxygen when it is low without reversing fibrosis. Transplant referral is the definitive option considered for suitable patients with end-stage disease. These are teaching toggles only.",
  ],
  simplified: "The many named patterns and causes, imaging and biopsy criteria, lung function numbers, infection and malignancy exclusion, pulmonary hypertension, acute exacerbations, rehabilitation and vaccination, transplant assessment, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-epi2{--cc:#e8c98a}.cl-fib2{--cc:#c978c9}.cl-infl{--cc:#e9b84a}
body[data-theme="light"] .cl-epi2{--cc:#c9a24a}body[data-theme="light"] .cl-fib2{--cc:#a84fa8}body[data-theme="light"] .cl-infl{--cc:#d99a1f}
.ild-inter{fill:color-mix(in srgb,var(--c-cyt) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.ild-air{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ild-cap{fill:none;stroke:var(--c-rbc);stroke-width:7;stroke-linecap:round;opacity:.75}
.ild-coll{fill:none;stroke:#d9a05a;stroke-width:1.6;stroke-linecap:round}
body[data-theme="light"] .ild-coll{stroke:#b57a2e}
.ild-lung{fill:color-mix(in srgb,var(--c-endo) 22%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:2}
.ild-trach{fill:none;stroke:var(--anatomy-mid);stroke-width:6;stroke-linecap:round}
.ild-honey{fill:color-mix(in srgb,var(--anatomy-paper) 70%,transparent);stroke:#d9a05a;stroke-width:1.6}
.ild-retic{fill:none;stroke:var(--anatomy-mid);stroke-width:.8;opacity:.5}
.ild-diaph{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.ild-finger{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:.8}
.ild-nail{fill:color-mix(in srgb,var(--anatomy-paper) 75%,var(--c-endo));stroke:var(--anatomy-mid);stroke-width:.6}
.p-inj{--cc:#ff9a3d}.p-oxy{--cc:#5fd0f5}.p-colp{--cc:#d9a05a}
.dr-g-fill.g-ildfib{fill:var(--c-cyt)}.dr-g-fill.g-ildinj{fill:#ff9a3d}.dr-g-fill.g-ilddif{fill:var(--c-fl)}.dr-g-fill.g-ildoxy{fill:#5fd0f5}
`,
});
