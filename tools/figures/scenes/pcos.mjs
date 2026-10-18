/* PCOS as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pcos.mjs [--print-model]
 * Static layout here; hormones, follicles and gauges move in pcos.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How marked the features are", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "lifestyle and weight loss" },
    { label: "metformin" },
    { label: "cyclic progestogen or ovulation induction" },
  ],
  status: "Features: {level} · {drug} ·",
  drugNames: ["no treatment", "lifestyle and weight loss", "metformin", "cyclic progestogen or ovulation induction"],
};
function modelOf(S, level, drug) {
  const fx = [
    { ir: 0, lh: 0, ov: 0 },
    { ir: 0.5, lh: 0.2, ov: 0.08 },
    { ir: 0.4, lh: 0.1, ov: 0.05 },
    { ir: 0, lh: 0, ov: 0.7 },
  ][drug];
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const IR = cl((0.15 + 0.75 * a) * (1 - fx.ir));
  const LH = cl((0.2 + 0.75 * a) * (1 - fx.lh));
  const A = cl(0.08 + 0.45 * LH + 0.45 * IR);
  const F = cl(0.1 + 0.8 * A);
  const O = cl(0.9 - 0.75 * F - 0.05 * a + fx.ov);
  const Sg = cl(0.08 + 0.85 * A);
  const M = cl(0.1 + 0.75 * IR + 0.2 * a * (drug === 1 ? 0.4 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.3, 0.55, ["mildly raised", "raised", "high"]), w(O, 0.3, 0.6, ["rare", "irregular", "regular"]), w(M, 0.3, 0.55, ["low", "raised", "high"])];
  return { a, drug, LH, IR, A, F, O, Sg, M, words, readout: "androgens " + words[0] + " · ovulation " + words[1] + " · metabolic risk " + words[2] };
}
const TESTS = [
  [1, 0, "androgens high · ovulation irregular · metabolic risk high"],
  [1, 1, "androgens raised · ovulation irregular · metabolic risk raised"],
  [1, 3, "androgens high · ovulation regular · metabolic risk high"],
  [2, 0, "androgens high · ovulation rare · metabolic risk high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">SIGNALS</text>
<text class="sc-zone sc-dim" x="400" y="68">OVARY</text>
<text class="sc-zone sc-dim" x="748" y="68">EFFECTS</text>
<g id="links"></g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-lh:#e9b84a;--c-ins:#38d1ff;--c-and:#ff7a45;--c-fol:#7fc4e8;--c-dom:#ffd24a;--c-pit:#b7a1e6;--c-adip:#f2d27a;--c-skin:#e9a2b3;--c-ut:#e59a88}
body[data-theme="light"]{--c-lh:#b8860b;--c-ins:#0a7fd1;--c-and:#d95d28;--c-fol:#3fa0d4;--c-dom:#c9a227;--c-pit:#8f72d0;--c-adip:#d9a92c;--c-skin:#d9788f;--c-ut:#d97a68}
.cl-pit{--cc:var(--c-pit)}.cl-adip{--cc:var(--c-adip)}.cl-fol{--cc:var(--c-fol)}.cl-dom{--cc:var(--c-dom)}
.p-lh{--cc:var(--c-lh)}.p-ins{--cc:var(--c-ins)}.p-and{--cc:var(--c-and)}
.dr-g-fill.g-lh{fill:var(--c-lh)}.dr-g-fill.g-ins{fill:var(--c-ins)}.dr-g-fill.g-and{fill:var(--c-and)}.dr-g-fill.g-sgn{fill:var(--c-and)}.dr-g-fill.g-met{fill:var(--c-bad)}
.pc-ovary{fill:color-mix(in srgb,var(--c-endo) 34%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.6}
.pc-link{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 5;opacity:.65}
.pc-block{fill:color-mix(in srgb,var(--c-adip) 30%,var(--anatomy-paper));stroke:var(--c-adip);stroke-width:1.4}
.pc-skin{fill:color-mix(in srgb,var(--c-skin) 42%,var(--anatomy-paper));stroke:var(--c-skin);stroke-width:1.4}
.pc-seb{fill:var(--c-dom);stroke:color-mix(in srgb,var(--c-dom) 55%,#000);stroke-width:.8}
.pc-hair{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round}
.pc-ut{fill:color-mix(in srgb,var(--c-ut) 38%,var(--anatomy-paper));stroke:var(--c-ut);stroke-width:1.5}
.pc-endo{fill:var(--c-ut);opacity:.75}
.pc-egg{fill:var(--c-dom);stroke:color-mix(in srgb,var(--c-dom) 55%,#000);stroke-width:.8}
.p-treat{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.7}
`;

buildScene({
  id: "polycystic-ovary-syndrome", fig: "Fig 1", title: "PCOS: hormones, ovary and effects", W, H, body, extraCss,
  label: "An animated ovary with signals and effects. The pituitary releases extra LH pulses. Insulin resistance raises insulin, which acts with LH on the ovary to make extra androgens. Androgens arrest follicles so many small cysts collect and ovulation becomes rare. Androgens also act on skin and hair, causing acne and extra hair growth. Gauges show LH, insulin resistance, androgens, ovulation, skin and hair signs and metabolic risk. Treatments are lifestyle and weight loss, metformin, and cyclic progestogen or ovulation induction.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pcos.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How PCOS develops.</strong> In polycystic ovary syndrome the pituitary releases LH in stronger pulses while FSH is relatively low. Insulin resistance raises circulating insulin, and insulin acts with LH on ovarian theca cells to increase androgen production. Androgen excess and the altered hormone pattern arrest follicle growth, so many small follicles collect in the ovary, ovulation is infrequent, and periods are irregular. Androgens acting on skin and hair follicles cause acne and hirsutism. Insulin resistance also raises longer term metabolic and diabetes risk. Not everyone has every feature, and the balance differs between people. This is standard teaching in endocrinology and gynaecology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Lifestyle change and weight loss where relevant, and metformin, mainly improve insulin resistance and downstream androgen excess. Cyclic progestogen protects the womb lining and brings on regular bleeds, while ovulation induction aims to restore ovulation when pregnancy is wanted. They are teaching toggles only and the figure does not choose between them.",
  ],
  simplified: "The inherited and genetic contribution, hyperandrogenism from the adrenal glands, FSH and anti-Mullerian hormone detail, diagnostic criteria, fertility and pregnancy care, endometrial cancer risk detail, mood and sleep apnoea links, and all doses and drug choices within each class are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
