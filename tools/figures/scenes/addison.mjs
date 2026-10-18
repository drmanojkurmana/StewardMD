/* Adrenal insufficiency and adrenal crisis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/addison.mjs [--print-model]
 * Static layout here; glands, hormones and gauges move in addison.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of the illness", a: [0.35, 0.7, 1], names: ["chronic", "stress", "crisis"], ticks: ["chronic", "stress", "crisis"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "hydrocortisone and fludrocortisone" },
    { label: "IV fluids and hydrocortisone" },
    { label: "stress dose hydrocortisone" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "hydrocortisone and fludrocortisone", "IV fluids and hydrocortisone", "stress dose hydrocortisone"],
};
function modelOf(S, level, drug) {
  const TAB = { hydro: [0, 0.38, 0.58, 0.48], flud: [0, 1, 0, 0], fluids: [0, 0, 1, 0] };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const hydro = TAB.hydro[drug], flud = TAB.flud[drug], fluids = TAB.fluids[drug];
  const Cort = cl(0.34 - 0.14 * a + hydro);
  const demand = 0.3 + 0.55 * a;
  const deficit = cl((demand - Cort) / demand);
  const AldoP = cl(0.3 - 0.12 * a + 0.55 * flud + 0.08 * fluids);
  const AldoS = cl(0.74 - 0.08 * a + 0.05 * flud);
  const BP = cl(0.95 - 0.45 * deficit - 0.35 * (1 - AldoP) + 0.3 * fluids + 0.1 * flud);
  const Na = cl(0.88 - 0.42 * (1 - AldoP) - 0.18 * deficit + 0.18 * fluids);
  const K = cl(0.18 + 0.62 * (1 - AldoP) + 0.12 * deficit - 0.05 * fluids);
  const Glu = cl(0.88 - 0.52 * deficit - 0.1 * (1 - Cort));
  const Vol = cl(0.92 - 0.38 * (1 - AldoP) - 0.22 * deficit + 0.28 * fluids);
  const acthP = cl(0.3 + 0.7 * deficit + 0.15 * a);
  const acthS = cl(0.2 - 0.06 * a);
  const pig = cl(acthP * 0.9);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Cort, 0.35, 0.6, ["low", "reduced", "ok"]), w(BP, 0.38, 0.65, ["low", "borderline", "maintained"]), w(K, 0.38, 0.6, ["normal", "raised", "high"]), w(Glu, 0.45, 0.65, ["low", "reduced", "normal"])];
  return { a, hydro, flud, fluids, Cort, demand, deficit, AldoP, AldoS, BP, Na, K, Glu, Vol, acthP, acthS, pig, words, readout: "cortisol " + words[0] + " · pressure " + words[1] + " · potassium " + words[2] + " · glucose " + words[3] };
}
const TESTS = [
  [0, 0, "cortisol low · pressure borderline · potassium high · glucose reduced"],
  [2, 0, "cortisol low · pressure low · potassium high · glucose low"],
  [2, 2, "cortisol ok · pressure maintained · potassium raised · glucose normal"],
  [0, 1, "cortisol ok · pressure maintained · potassium normal · glucose normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<path class="ad-div" d="M480 56V428"/>
<text class="sc-zone" x="34" y="68">PRIMARY: THE GLAND ITSELF FAILS</text>
<text class="sc-zone" x="505" y="68">SECONDARY: ACTH IS LACKING</text>
<g id="left"></g><g id="right"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "adrenal-insufficiency-crisis", fig: "Fig 1", title: "Adrenal insufficiency: from hormone loss to crisis", W, H, body,
  label: "An animated comparison of two ways the adrenal glands fail. On the left the gland itself is damaged by autoimmune adrenalitis, so cortisol and aldosterone are both lost, ACTH rises and the skin darkens. On the right ACTH from the pituitary is lacking, so cortisol is lost but aldosterone is largely kept and there is no pigmentation. As chronic illness moves through stress to crisis, blood pressure, sodium, potassium and glucose worsen. Gauges show cortisol, aldosterone, pressure, sodium, potassium and glucose. Treatment choices include hydrocortisone with fludrocortisone, IV fluids with hydrocortisone, and a stress dose concept.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "addison.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How adrenal insufficiency develops.</strong> In primary adrenal insufficiency the adrenal cortex itself fails, most often from autoimmune adrenalitis. Cortisol and aldosterone are both lost. Low cortisol removes feedback on the pituitary, so ACTH rises, and the shared precursor pathway also raises melanocyte stimulating activity, which darkens the skin (pigmentation). In secondary adrenal insufficiency the pituitary makes too little ACTH, so cortisol falls but aldosterone is largely preserved because aldosterone is controlled mainly by the renin angiotensin system and potassium, not ACTH. Loss of cortisol and, in primary disease, aldosterone gives low blood pressure, low sodium, high potassium and low glucose, and an intercurrent stress can tip the patient into an adrenal crisis. This is standard teaching in medicine and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Hydrocortisone replaces cortisol and fludrocortisone replaces aldosterone for ongoing replacement in primary disease. In a crisis, IV fluids restore circulating volume alongside hydrocortisone. A stress dose is the teaching concept of extra hydrocortisone cover when illness or stress raises the body need for cortisol. These are teaching toggles only.",
  ],
  simplified: "Tertiary (hypothalamic) disease, the full renin angiotensin detail, ACTH and cortisol blood tests and their cut-offs, other causes of gland failure such as infection, haemorrhage and infiltration, mineralocorticoid need in secondary disease, and all doses, timings and targets are left out. The two columns are a schematic contrast, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-pit:#9a86d8;--c-adr:#e0a458;--c-adr2:#c97e35;--c-kid:#b45a6b;--c-imm:#b7a1e6;--c-skin:#d9a06b}
body[data-theme="light"]{--c-pit:#7a5fc0;--c-adr:#c9852f;--c-adr2:#a86a22;--c-kid:#9c4256;--c-imm:#8f72d0;--c-skin:#c98a52}
.cl-pit{--cc:var(--c-pit)}.cl-imm{--cc:var(--c-imm)}.cl-kidc{--cc:var(--c-kid)}
.ad-div{stroke:var(--anatomy-faint);stroke-width:1;stroke-dasharray:5 5;fill:none}
.ad-adr{fill:var(--c-adr);stroke:color-mix(in srgb,var(--c-adr) 55%,#000);stroke-width:1}
.ad-adr-in{fill:color-mix(in srgb,var(--c-adr) 62%,#fff);stroke:var(--c-adr2);stroke-width:.8}
.ad-med{fill:#f2d492;stroke:var(--c-adr2);stroke-width:.7}
.ad-kidney{fill:var(--c-kid);stroke:color-mix(in srgb,var(--c-kid) 55%,#000);stroke-width:1}
.ad-notch{fill:var(--c-tis)}
.ad-vessel{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.ad-skin{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:.8}
.ad-pig{fill:#5e3a1e}
.ad-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.ad-crack{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.p-acth{--cc:var(--c-pit)}.p-cort{--cc:#f2c94c}.p-aldo{--cc:#3fae8a}
.dr-g-fill.g-aldo{fill:#3fae8a}.dr-g-fill.g-na{fill:#7ab8ff}.dr-g-fill.g-k{fill:var(--c-bad)}.dr-g-fill.g-glu{fill:#f2c94c}
`,
});
