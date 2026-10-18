/* Pituitary disorders as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pituit.mjs [--print-model]
 * Static layout here; hormones, adenoma, chiasm and gauges move in pituit.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Condition", a: [1, 1, 1], names: ["prolactinoma", "acromegaly", "hypopituitarism"], ticks: ["prolactinoma", "acromegaly", "hypopituitarism"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "dopamine agonist" },
    { label: "somatostatin analogue" },
    { label: "surgery" },
  ],
  status: "Pituitary: {level} · {drug} ·",
  drugNames: ["no treatment", "dopamine agonist", "somatostatin analogue", "surgery"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const TABLE = [
    { prl: 0.95, gh: 0.42, oth: 0.34, mass: 0.68, gland: 1 },
    { prl: 0.55, gh: 0.95, oth: 0.5, mass: 0.6, gland: 1 },
    { prl: 0.12, gh: 0.1, oth: 0.1, mass: 0.18, gland: 0.72 },
  ];
  const base = TABLE[level];
  let prl = base.prl, gh = base.gh, oth = base.oth, mass = base.mass;
  const gland = base.gland;
  const da = drug === 1 ? 1 : 0, sa = drug === 2 ? 1 : 0, sx = drug === 3 ? 1 : 0;
  if (da) { prl = cl(prl - (level === 0 ? 0.55 : 0.18)); mass = cl(mass - (level === 0 ? 0.3 : 0.04)); }
  if (sa) { gh = cl(gh - (level === 1 ? 0.5 : 0.12)); prl = cl(prl - 0.08); mass = cl(mass - 0.08); }
  if (sx && level !== 2) { prl = cl(0.45 + (prl - 0.45) * 0.25); gh = cl(0.45 + (gh - 0.45) * 0.25); oth = cl(oth + 0.25); mass = 0.14; }
  const gon = cl(oth - (level === 0 && !sx ? 0.18 : 0));
  const acth = oth, tsh = cl(oth + 0.05), fsh = gon, lh = gon;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(prl, 0.35, 0.65, ["low", "normal", "high"]),
    w(gh, 0.35, 0.65, ["low", "normal", "high"]),
    w(oth, 0.3, 0.6, ["low", "reduced", "normal"]),
    w(mass, 0.3, 0.55, ["none", "mild", "marked"]),
  ];
  return { a: S.level.a[level], da, sa, sx, prl, gh, acth, tsh, fsh, lh, oth, mass, gland, words, readout: "prolactin " + words[0] + " · growth hormone " + words[1] + " · other hormones " + words[2] + " · mass effect " + words[3] };
}
const TESTS = [
  [0, 0, "prolactin high · growth hormone normal · other hormones reduced · mass effect marked"],
  [0, 1, "prolactin normal · growth hormone normal · other hormones reduced · mass effect mild"],
  [1, 2, "prolactin normal · growth hormone normal · other hormones reduced · mass effect mild"],
  [2, 0, "prolactin low · growth hormone low · other hormones low · mass effect none"],
  [1, 3, "prolactin normal · growth hormone normal · other hormones normal · mass effect none"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">VISUAL PATHWAY</text>
<text class="sc-zone" x="700" y="68">VISUAL PATHWAY</text>
<circle class="pit-vf" cx="112" cy="118" r="36"/>
<path id="vfLs" class="pit-shade" d="M112 82 A36 36 0 0 0 112 154 Z" opacity="0"/>
<circle class="pit-vf" cx="848" cy="118" r="36"/>
<path id="vfRs" class="pit-shade" d="M848 82 A36 36 0 0 1 848 154 Z" opacity="0"/>
<path class="pit-field" d="M76 118 L148 118 M112 82 L112 154"/>
<path class="pit-field" d="M812 118 L884 118 M848 82 L848 154"/>
<text class="sc-lab" x="112" y="172" text-anchor="middle">left view</text>
<text class="sc-lab" x="848" y="172" text-anchor="middle">right view</text>
<g id="chiasm">
  <circle class="pit-eye" cx="408" cy="58" r="9"/>
  <circle class="pit-eye" cx="552" cy="58" r="9"/>
  <path class="pit-nerve" d="M408 58 L480 92 L552 58"/>
  <path class="pit-nerve" d="M408 58 L500 108 M552 58 L460 108"/>
</g>
<ellipse class="pit-hypo" cx="480" cy="138" rx="58" ry="24"/>
<rect class="pit-stalk" x="474" y="158" width="12" height="34" rx="5"/>
<g id="glandG">
  <ellipse class="pit-gland" cx="480" cy="228" rx="96" ry="62"/>
  <circle id="adenoma" class="pit-aden" cx="508" cy="240" r="30"/>
</g>
<path class="pit-base" d="M384 286 Q480 306 576 286"/>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.pit-vf{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.4}
.pit-shade{fill:var(--c-bad)}
.pit-field{stroke:var(--anatomy-mid);stroke-width:.8;opacity:.6}
.pit-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.pit-nerve{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.pit-hypo{fill:#9db8d9;stroke:#5f83ad;stroke-width:1.2}
.pit-stalk{fill:#9db8d9;stroke:#5f83ad;stroke-width:1}
.pit-gland{fill:#e9a2b3;stroke:#b45f78;stroke-width:1.4}
.pit-aden{fill:#e5484d;stroke:#a02030;stroke-width:1.2}
.pit-base{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.pit-node{stroke-width:1.2}
.hn0{fill:#f2b23a;stroke:#b57f16}.hn1{fill:#e07a5f;stroke:#a84e38}.hn2{fill:#7fc4e8;stroke:#3f87ad}
.hn3{fill:#b7a1e6;stroke:#7d63b8}.hn4{fill:#e9a2d0;stroke:#ad6396}.hn5{fill:#3ddc97;stroke:#1d9f6e}
.pit-abbr{fill:var(--anatomy-text);pointer-events:none;font-size:11px;font-weight:700}
.pit-tgt{fill:var(--anatomy-text);pointer-events:none;font-size:9.5px}
body[data-theme="light"] .hn0{fill:#d9961f}body[data-theme="light"] .hn2{fill:#3fa0d4}
.p-h0{--cc:#f2b23a}.p-h1{--cc:#e07a5f}.p-h2{--cc:#7fc4e8}.p-h3{--cc:#b7a1e6}.p-h4{--cc:#e9a2d0}.p-h5{--cc:#3ddc97}
.p-rel{--cc:#c084fc}.p-da{--cc:#38d1ff}.p-sa{--cc:#f2d27a}
.dr-g-fill.g-prl{fill:#3ddc97}.dr-g-fill.g-gh{fill:#f2b23a}.dr-g-fill.g-oth{fill:#7fc4e8}.dr-g-fill.g-mass{fill:#e5484d}
`;

buildScene({
  id: "pituitary-disorders", fig: "Fig 1", title: "Pituitary disorders: excess, mass effect and failure", W, H, body,
  label: "An animated pituitary gland under the hypothalamus and optic chiasm. Six anterior pituitary hormones are shown as nodes below the gland: growth hormone, ACTH, TSH, FSH, LH and prolactin. A prolactinoma raises prolactin, acromegaly raises growth hormone, and hypopituitarism lowers all hormones. A growing adenoma presses on the optic chiasm and shades the outer halves of both visual fields. Gauges show prolactin, growth hormone, other hormones and mass effect. Treatments are a dopamine agonist, a somatostatin analogue and surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pituit.page.js"), "utf8"), modelOf, MD, tests: TESTS, extraCss,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How the pituitary works.</strong> The anterior pituitary releases growth hormone, ACTH, TSH, FSH, LH and prolactin under hypothalamic control through the stalk. Prolactin is held back mainly by dopamine, so a prolactin secreting adenoma (prolactinoma) raises prolactin and can suppress FSH and LH. A growth hormone secreting adenoma causes acromegaly. A large adenoma can press on the optic chiasm above the gland and lose the outer (temporal) half of vision in both eyes. Loss of anterior pituitary function (hypopituitarism) lowers all of these hormones. This is standard teaching in endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A dopamine agonist lowers prolactin and shrinks a prolactinoma, a somatostatin analogue lowers growth hormone in acromegaly, and surgery removes an adenoma and relieves pressure on the chiasm. These are teaching toggles only.",
  ],
  simplified: "Releasing and inhibiting hormones in detail, posterior pituitary hormones, stalk effects, apoplexy, empty sella, hormone replacement, radiotherapy, pregnancy, drug causes of raised prolactin, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
