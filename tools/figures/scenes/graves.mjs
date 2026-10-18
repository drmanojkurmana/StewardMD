/* Thyroid autoimmunity (Graves and Hashimoto) as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/graves.mjs [--print-model]
 * Static layout here; antibodies, TSH, hormone flow, gland change and gauges move in graves.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease and stage", a: [0, 1, 2], names: ["Graves disease", "Hashimoto thyroiditis, early", "Hashimoto thyroiditis, late"], ticks: ["Graves", "Hashimoto early", "Hashimoto late"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antithyroid medicine (blocks hormone making)" },
    { label: "radioiodine or surgery (removes the gland)" },
    { label: "levothyroxine replacement" },
  ],
  status: "Pattern: {level} \u00b7 {drug} \u00b7",
  drugNames: ["no treatment", "an antithyroid medicine", "radioiodine or surgery", "levothyroxine replacement"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const anti = drug === 1 ? 1 : 0, abl = drug === 2 ? 1 : 0, levo = drug === 3 ? 1 : 0;
  const stim = level === 0 && !abl ? 1 : 0;
  let Ab = level === 0 ? 0.9 : level === 1 ? 0.85 : 0.68;
  if (anti) Ab *= 0.85; if (abl) Ab *= 0.9;
  const D = abl ? 1 : level === 0 ? 0.16 : level === 1 ? 0.6 : 0.95;
  const capBase = level === 0 ? 1 : level === 1 ? 0.62 : 0.16;
  const cap = abl ? capBase * 0.07 : capBase;
  let gs = level === 0 ? 0.88 : level === 1 ? 0.74 : 0.28;
  if (abl) gs = 0.12; else if (anti && level === 0) gs *= 0.92; else if (levo) gs *= 0.92;
  const Eye = level === 0 ? (abl ? 0.68 : 0.8) : 0.05;
  let H = 0.5, P = 0.5;
  for (let i = 0; i < 80; i++) {
    const pT = cl(1.15 - 1.1 * H);
    let prod = stim ? 0.95 : cap * cl(0.25 + 0.85 * pT);
    if (anti) prod *= 0.55;
    const hT = cl(prod * (levo && !stim ? 0.25 : 1) + (levo ? 0.48 : 0));
    H += 0.4 * (hT - H); P += 0.4 * (pT - P);
  }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(H, 0.35, 0.65, ["low", "normal", "high"]), w(P, 0.35, 0.62, ["suppressed", "normal", "high"]), w(gs, 0.35, 0.65, ["small", "normal", "enlarged"]), Eye < 0.3 ? "absent" : "present"];
  return { Ab, D, cap, stim, anti, abl, levo, H, P, gs, Eye, words, readout: "hormone " + words[0] + " \u00b7 TSH " + words[1] + " \u00b7 gland " + words[2] + " \u00b7 eye signs " + words[3] };
}
const TESTS = [
  [0, 0, "hormone high \u00b7 TSH suppressed \u00b7 gland enlarged \u00b7 eye signs present"],
  [0, 1, "hormone normal \u00b7 TSH normal \u00b7 gland enlarged \u00b7 eye signs present"],
  [2, 0, "hormone low \u00b7 TSH high \u00b7 gland small \u00b7 eye signs absent"],
  [2, 3, "hormone normal \u00b7 TSH normal \u00b7 gland small \u00b7 eye signs absent"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="gr-track" d="M152 108C230 92 330 120 424 178"/>
<path class="gr-track" d="M152 308C240 306 340 282 424 252"/>
<path class="gr-track" d="M548 226C640 246 700 268 742 286"/>
<path class="gr-track gr-track-eye" d="M536 178C620 128 690 116 742 114"/>
<g id="trachea"><rect class="gr-trach" x="466" y="158" width="28" height="168" rx="12"/>
<path class="gr-ring" d="M466 190h28M466 222h28M466 254h28M466 286h28M466 318h28"/></g>
<g id="thy"><ellipse class="gr-lobe" cx="430" cy="235" rx="48" ry="62"/><ellipse class="gr-lobe" cx="530" cy="235" rx="48" ry="62"/><rect class="gr-isth" x="428" y="224" width="104" height="22" rx="10"/></g>
<g id="folls"></g>
<g id="lymphs"></g>
<g id="pit"></g>
<g id="plasma"></g>
<g id="eyeG">
<circle id="eyeHalo" class="gr-halo" cx="800" cy="115" r="52" opacity="0"/>
<ellipse class="gr-eye" cx="800" cy="115" rx="58" ry="34"/>
<g id="eyeball"><circle class="gr-ball" cx="800" cy="115" r="24"/><circle class="gr-iris" cx="800" cy="115" r="11"/><circle class="gr-pupil" cx="800" cy="115" r="5"/></g>
<path class="gr-eye-lid" d="M742 115Q800 76 858 115Q800 132 742 115Z"/>
</g>
<g id="heartG"><path class="gr-heart" d="M800 268c-8 -16 -34 -18 -42 -4c-9 15 2 32 42 56c40 -24 51 -41 42 -56c-8 -14 -34 -12 -42 4Z"/></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-thy:#e8a04c;--c-trach:#8fb8c9;--c-eye:#7fc4e8}
body[data-theme="light"]{--c-thy:#c97e22;--c-trach:#5f96ad;--c-eye:#3fa0d4}
.gr-track{fill:none;stroke:var(--anatomy-faint);stroke-width:1.6;stroke-dasharray:5 6}
.gr-track-eye{stroke-dasharray:2 6}
.gr-trach{fill:color-mix(in srgb,var(--c-trach) 28%,var(--anatomy-paper));stroke:var(--c-trach);stroke-width:1.1}
.gr-ring{stroke:var(--c-trach);stroke-width:1;opacity:.7}
.gr-lobe{fill:color-mix(in srgb,var(--c-thy) 58%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-thy) 70%,#000);stroke-width:1.3}
.gr-isth{fill:color-mix(in srgb,var(--c-thy) 52%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-thy) 65%,#000);stroke-width:1}
.gr-foll{fill:color-mix(in srgb,var(--c-thy) 30%,#fff);stroke:color-mix(in srgb,var(--c-thy) 60%,#000);stroke-width:.7}
.gr-fib{fill:none;stroke:var(--anatomy-mid);stroke-width:1;opacity:.6}
.gr-eye{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.3}
.gr-ball{fill:color-mix(in srgb,var(--c-eye) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.gr-iris{fill:var(--c-eye)}
.gr-pupil{fill:var(--anatomy-strong)}
.gr-eye-lid{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.gr-halo{fill:var(--c-bad)}
.gr-heart{fill:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 65%,#000);stroke-width:1.3}
.p-tshp{--cc:var(--c-cyt2)}.p-horm{--cc:#ff9a3d}
.p-ab-y{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
.dr-g-fill.g-ab{fill:var(--c-ab)}.dr-g-fill.g-thy{fill:var(--c-thy)}.dr-g-fill.g-dmg{fill:var(--c-bad)}.dr-g-fill.g-eye{fill:var(--c-eye)}
`;

buildScene({
  id: "thyroid-graves-hashimoto", fig: "Fig 1", title: "Thyroid autoimmunity: Graves and Hashimoto", W, H, body, extraCss,
  label: "An animated thyroid gland in the front of the neck, with the pituitary above it on the left, antibody making plasma cells, and on the right an eye and body tissues. In Graves disease a stimulating antibody switches the TSH receptor on, so the gland grows and makes too much hormone, TSH is suppressed, and the eye is inflamed. In Hashimoto thyroiditis a thyroid peroxidase antibody pattern with lymphocytic destruction slowly removes follicles, so hormone falls and TSH rises. A slider moves from Graves to early and late Hashimoto, and a treatment menu offers an antithyroid medicine, radioiodine or surgery, or levothyroxine replacement. Gauges show antibody, gland damage, hormone, TSH, gland size and eye signs.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "graves.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Graves disease.</strong> A stimulating antibody against the TSH receptor (often called TRAb or TSI) binds the receptor on thyroid follicular cells and switches it on without TSH. The gland grows diffusely (goitre), makes and releases too much thyroid hormone, and the high hormone suppresses pituitary TSH by negative feedback. A related autoimmune inflammation behind the eye expands orbital tissue and muscle, pushing the eye forward and causing Graves eye disease. This is standard teaching in endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Hashimoto thyroiditis.</strong> Antibodies against thyroid peroxidase (TPO) mark a lymphocytic attack on the gland. Lymphocytes infiltrate, follicles are destroyed and, over time, fibrous tissue replaces working gland. Early on the gland may be enlarged and hormone may still be held near normal while TSH rises to compensate. Late, with little follicle left, hormone is low and TSH is high (primary hypothyroidism). A short release of stored hormone early in destruction is left out here.",
    "<strong>Treatment ideas shown.</strong> An antithyroid medicine blocks new hormone making, which helps Graves but deepens a Hashimoto deficit. Radioiodine or surgery removes the overactive gland in Graves, after which hormone falls and replacement is usually needed, while eye disease may persist. Levothyroxine replaces missing hormone in Hashimoto and restores feedback, but adds to an already high hormone level in untreated Graves. These are teaching toggles only.",
  ],
  simplified: "Hashitoxicosis and other transient phases, blocking and neutral TSH receptor antibodies, TPO antibody titres and testing, ultrasound and biopsy, pregnancy and neonatal effects, thyroid storm and myxoedema, eye disease grading and its own treatment, drug choice and monitoring, radioiodine precautions, surgical risks, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
