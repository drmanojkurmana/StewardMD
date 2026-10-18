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
    { label: "stress dose hydrocortisone" },
    { label: "hydrocortisone and fludrocortisone" },
    { label: "IV fluids and hydrocortisone" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "stress dose hydrocortisone", "hydrocortisone and fludrocortisone", "IV fluids and hydrocortisone"],
};
function modelOf(S, level, drug) {
  const TAB = { hydro: [0, 0.5, 0.62, 0.62], flud: [0, 0, 1, 0], fluids: [0, 0, 0, 1] };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const hydro = TAB.hydro[drug], flud = TAB.flud[drug], fluids = TAB.fluids[drug];
  const Cort = cl(0.34 - 0.14 * a + hydro);
  const demand = 0.3 + 0.55 * a;
  const deficit = cl((demand - Cort) / demand);
  const AldoP = cl(0.3 - 0.12 * a + 0.55 * flud + 0.08 * fluids);
  const BP = cl(0.95 - 0.45 * deficit - 0.35 * (1 - AldoP) + 0.3 * fluids + 0.1 * flud - 0.3 * a * (1 - fluids));
  const Na = cl(0.88 - 0.42 * (1 - AldoP) - 0.18 * deficit + 0.18 * fluids);
  const K = cl(0.18 + 0.62 * (1 - AldoP) + 0.12 * deficit - 0.05 * fluids);
  const Glu = cl(0.88 - 0.52 * deficit - 0.1 * (1 - Cort));
  const acthP = cl(0.3 + 0.7 * deficit + 0.15 * a);
  const pig = cl(acthP * 0.9);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Cort, 0.35, 0.6, ["low", "reduced", "ok"]), w(BP, 0.38, 0.65, ["low", "borderline", "maintained"]), w(K, 0.38, 0.6, ["normal", "raised", "high"]), w(Glu, 0.45, 0.65, ["low", "reduced", "normal"])];
  return { a, hydro, flud, fluids, Cort, demand, deficit, AldoP, BP, Na, K, Glu, acthP, pig, words, readout: "cortisol " + words[0] + " · pressure " + words[1] + " · potassium " + words[2] + " · glucose " + words[3] };
}
const TESTS = [
  [0, 0, "cortisol low · pressure borderline · potassium high · glucose reduced"],
  [2, 0, "cortisol low · pressure low · potassium high · glucose low"],
  [2, 3, "cortisol ok · pressure maintained · potassium raised · glucose normal"],
  [0, 2, "cortisol ok · pressure maintained · potassium normal · glucose normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<path id="acthV" class="ad-acth" d="M166 240 L260 268 L360 228 L445 172"/>
<path id="bloodV" class="ad-blood" d="M479 184 L580 196 L662 178 L735 159"/>
<path id="livV" class="ad-liv" d="M431 182 L375 155 L315 220 L280 295"/>
<g id="brainSlot"></g><g id="kidneySlot"></g><g id="vesselSlot"></g><g id="liverSlot"></g>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "adrenal-insufficiency-crisis", fig: "Fig 1", title: "Adrenal insufficiency: from hormone loss to crisis", W, H, body,
  label: "An animated story of primary adrenal failure, read left to right. The pituitary releases ACTH, which drives the adrenal cap on the kidney to make cortisol and aldosterone. When the gland fails, ACTH rises and the skin darkens. Cortisol loss lowers blood pressure and glucose, and aldosterone loss makes the kidney waste salt and water while keeping potassium, so pressure and sodium fall and potassium rises. A slider moves from chronic illness through stress to crisis. Treatments are stress dose hydrocortisone, hydrocortisone with fludrocortisone, and IV fluids with hydrocortisone.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "addison.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With IV fluids and hydrocortisone",
  sourcesLis: [
    "<strong>How primary adrenal failure develops.</strong> In primary adrenal insufficiency the adrenal cortex itself fails, most often from autoimmune adrenalitis. Cortisol and aldosterone are both lost. Low cortisol removes feedback on the pituitary, so ACTH rises, and the shared precursor pathway also stimulates skin pigment cells, which darkens the skin. Cortisol loss lowers vessel tone and glucose, and aldosterone loss makes the kidney waste salt and water while keeping potassium, so pressure and sodium fall and potassium rises. Stress or illness can tip this into an adrenal crisis. This is standard teaching in medicine and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Hydrocortisone replaces cortisol and fludrocortisone replaces aldosterone for ongoing replacement. In a crisis, IV fluids refill the circulation alongside hydrocortisone. A stress dose is the teaching concept of extra hydrocortisone cover when illness raises the body need for cortisol. These are teaching toggles only.",
  ],
  simplified: "Secondary pituitary failure, tertiary hypothalamic disease, the full renin angiotensin detail, ACTH and cortisol blood tests and their cut offs, other causes of gland failure such as infection and bleeding, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-pit:#9a86d8;--c-adr:#e0a458;--c-adr2:#c97e35;--c-imm:#b7a1e6;--c-skin:#d9a06b}
body[data-theme="light"]{--c-pit:#7a5fc0;--c-adr:#c9852f;--c-adr2:#a86a22;--c-imm:#8f72d0;--c-skin:#c98a52}
.cl-imm{--cc:var(--c-imm)}
.ad-acth{fill:none;stroke:var(--c-pit);stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:8 6;opacity:.55}
.ad-blood{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;stroke-linejoin:round;opacity:.8}
.ad-liv{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round;stroke-linejoin:round;opacity:.55}
.ad-adr{fill:var(--c-adr);stroke:color-mix(in srgb,var(--c-adr) 55%,#000);stroke-width:1}
.ad-adr-in{fill:color-mix(in srgb,var(--c-adr) 62%,#fff);stroke:var(--c-adr2);stroke-width:.8}
.ad-med{fill:#f2d492;stroke:var(--c-adr2);stroke-width:.7}
.ad-shade{fill:color-mix(in srgb,#3a2410 55%,transparent);stroke:none}
.ad-crack{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.ad-pitd{fill:var(--c-pit);stroke:color-mix(in srgb,var(--c-pit) 55%,#000);stroke-width:1}
.ad-rec{fill:var(--anatomy-paper);stroke:#3fae8a;stroke-width:1.6}
.ad-rec.ad-on{fill:#3fae8a}
.ad-shock{fill:none;stroke:var(--c-bad);stroke-width:2.5}
.ad-skin{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:1}
.ad-piglay{fill:#5e3a1e;stroke:none}
.ad-cap{fill:var(--anatomy-strong);font-size:12px}
.p-acth{--cc:var(--c-pit)}.p-cort{--cc:#f2c94c}.p-aldo{--cc:#3fae8a}.p-na{--cc:#7ab8ff}.p-k{--cc:var(--c-bad)}.p-glu{--cc:#f2c94c}
.dr-g-fill.g-aldo{fill:#3fae8a}.dr-g-fill.g-na{fill:#7ab8ff}.dr-g-fill.g-k{fill:var(--c-bad)}.dr-g-fill.g-glu{fill:#f2c94c}
`,
});
