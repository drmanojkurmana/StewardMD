/* Hyperthyroidism and thyroid storm as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hyperthy.mjs [--print-model]
 * Static layout here; hormone flow, heart, eye and gauges move in hyperthy.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of hormone excess", a: [0.35, 0.65, 1], names: ["mild", "overt", "storm"], ticks: ["mild", "overt", "storm"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antithyroid drug" },
    { label: "beta blocker" },
    { label: "radioiodine or surgery" },
  ],
  status: "Hormone excess: {level} · {drug} ·",
  drugNames: ["no treatment", "antithyroid drug", "beta blocker", "radioiodine or surgery"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const anti = drug === 1 ? 1 : 0, beta = drug === 2 ? 1 : 0, defn = drug === 3 ? 1 : 0;
  const Hm = cl(a * (anti ? 0.38 : 1) * (defn ? 0.18 : 1));
  const Adr = cl(Hm * 1.05 * (beta ? 0.35 : 1));
  const HR = cl(0.08 + 0.88 * Adr);
  const AF = cl(Hm * Hm * 1.1 * (beta ? 0.55 : 1) * (defn ? 0.5 : 1));
  const Tr = cl(0.06 + 0.85 * Adr);
  const Wt = cl(0.05 + 0.8 * Hm);
  const Eye = cl(a * 0.72 * (defn ? 0.85 : 1));
  const Storm = cl(Hm * Hm * (level === 2 ? 1 : 0.35) * (anti ? 0.55 : 1) * (beta ? 0.7 : 1) * (defn ? 0.4 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Hm, 0.25, 0.55, ["near normal", "raised", "very high"]), w(HR, 0.3, 0.6, ["steady", "fast", "racing"]), w(Storm, 0.2, 0.45, ["settled", "strained", "storm"])];
  return { a, anti, beta, defn, Hm, Adr, HR, AF, Tr, Wt, Eye, Storm, words, readout: "hormone " + words[0] + " · heart " + words[1] + " · body " + words[2] };
}
const TESTS = [
  [2, 0, "hormone very high · heart racing · body storm"],
  [1, 0, "hormone very high · heart racing · body settled"],
  [1, 1, "hormone near normal · heart fast · body settled"],
  [1, 2, "hormone very high · heart steady · body settled"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<ellipse id="thyGlow" class="ht-tglow" cx="175" cy="250" rx="95" ry="80" opacity="0"/>
<ellipse id="stormGlow" class="ht-storm" cx="570" cy="230" rx="125" ry="105" opacity="0"/>
<g id="thyroidSlot"></g>
<path id="flowline" class="ht-flow" d="M208 250 L538 120"/>
<g id="heartSlot"></g>
<g id="eyeSlot"></g>
<g id="muscleSlot"></g>
<path id="ecg" class="ht-ecg" d=""/>
<g id="drugG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "hyperthyroid-thyroid-storm", fig: "Fig 1", title: "Hyperthyroidism: hormone excess to thyroid storm", W, H, body,
  label: "An animated thyroid, hormone stream and body. Antibodies drive the gland to release excess T4 and T3. Hormone raises metabolic rate and sensitivity to adrenaline, so the heart races and may fibrillate, muscle trembles and the eyes may bulge. The gland shrinks with definitive treatment. A slider sets severity, and treatment choices are an antithyroid drug, a beta blocker, and radioiodine or surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hyperthy.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With radioiodine or surgery",
  sourcesLis: [
    "<strong>How hyperthyroidism develops.</strong> In Graves disease, autoimmune antibodies stimulate the TSH receptor (TSH-R) on thyroid cells, so the gland grows and releases excess thyroxine (T4) and triiodothyronine (T3) despite a suppressed TSH. Other causes are a toxic nodule or toxic multinodular goitre making hormone on its own, and thyroiditis leaking stored hormone. The same Graves immune process can affect the orbit: extraocular muscle and orbital tissue swell, leading to proptosis, lid retraction and, when severe, sight threatening disease. Hormone excess raises metabolic rate and adrenergic sensitivity: tachycardia, atrial fibrillation (notably in the elderly), weight loss, tremor, heat intolerance and muscle weakness. Thyroid storm is the severe, decompensated end of thyrotoxicosis. Low hormone after treatment or disease can tip toward hypothyroidism, so levels are monitored. Inhibitors of hormone synthesis (antithyroid drugs), beta blockers for adrenergic signs, and definitive radioiodine or surgery are the standard treatment ideas. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antithyroid drug lowers new hormone synthesis, a beta blocker blunts adrenergic signs such as racing heart and tremor without lowering hormone much, and radioiodine or surgery definitively reduces the gland. These are teaching toggles only.",
  ],
  simplified: "Pituitary feedback detail beyond suppressed TSH, binding proteins and conversion detail, pregnancy and drug induced causes, detailed storm scoring and intensive care, eye disease grading and surgery detail, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `.ht-tglow{fill:#ff9a3d;stroke:none}.ht-storm{fill:var(--c-bad);stroke:none}
.ht-flow{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke-width:10;stroke-linecap:round;opacity:.5}
.ht-ecg{fill:none;stroke:#3ddc97;stroke-width:1.8;stroke-linejoin:round}
.ht-ab{fill:none;stroke:#e9b84a;stroke-width:1.6;stroke-linecap:round}
.ht-horm{--cc:#ff9a3d}
.ht-tab{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.2}
.ht-block{fill:#7fc4e8;stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:1}
.ht-io{fill:#b66a86;stroke:color-mix(in srgb,#b66a86 55%,#000);stroke-width:.8}
.ht-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.dr-g-fill.g-bad{fill:var(--c-bad)}.dr-g-fill.g-cyt{fill:var(--c-cyt)}.dr-g-fill.g-fl{fill:var(--c-fl)}`,
});
