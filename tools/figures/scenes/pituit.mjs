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
  level: { label: "Condition", a: [1, 1, 1], names: ["prolactinoma", "hypopituitarism", "acromegaly"], ticks: ["prolactinoma", "hypopituitarism", "acromegaly"], start: 0 },
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
    { prl: 0.12, gh: 0.1, oth: 0.1, mass: 0.18, gland: 0.72 },
    { prl: 0.55, gh: 0.95, oth: 0.5, mass: 0.6, gland: 1 },
  ];
  const base = TABLE[level];
  let prl = base.prl, gh = base.gh, oth = base.oth, mass = base.mass;
  const gland = base.gland;
  const da = drug === 1 ? 1 : 0, sa = drug === 2 ? 1 : 0, sx = drug === 3 ? 1 : 0;
  if (da) { prl = cl(prl - (level === 0 ? 0.55 : 0.18)); mass = cl(mass - (level === 0 ? 0.3 : 0.04)); }
  if (sa) { gh = cl(gh - (level === 2 ? 0.5 : 0.12)); prl = cl(prl - 0.08); mass = cl(mass - 0.08); }
  if (sx && level !== 1) { prl = cl(0.45 + (prl - 0.45) * 0.25); gh = cl(0.45 + (gh - 0.45) * 0.25); oth = cl(oth + 0.25); mass = 0.14; }
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
  [2, 2, "prolactin normal · growth hormone normal · other hormones reduced · mass effect mild"],
  [1, 0, "prolactin low · growth hormone low · other hormones low · mass effect none"],
  [2, 3, "prolactin normal · growth hormone normal · other hormones normal · mass effect none"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="vfL" class="hot" tabindex="0" data-info="Left sight: the shaded outer half fades when the tumour presses on the crossing nerves.">
  <circle class="pit-vf" cx="88" cy="112" r="34"/>
  <path id="vfLs" class="pit-shade" d="M88 78 A34 34 0 0 0 88 146 Z" opacity="0"/>
  <path class="pit-field" d="M54 112 L122 112 M88 78 L88 146"/>
</g>
<g id="vfR" class="hot" tabindex="0" data-info="Right sight: the shaded outer half fades when the tumour presses on the crossing nerves.">
  <circle class="pit-vf" cx="872" cy="112" r="34"/>
  <path id="vfRs" class="pit-shade" d="M872 78 A34 34 0 0 1 872 146 Z" opacity="0"/>
  <path class="pit-field" d="M838 112 L906 112 M872 78 L872 146"/>
</g>
<g id="brainSlot"></g>
<g id="chiasm">
  <circle class="pit-eye" cx="392" cy="64" r="8"/>
  <circle class="pit-eye" cx="568" cy="64" r="8"/>
  <path class="pit-nerve" d="M392 64 L505 196"/>
  <path class="pit-nerve" d="M568 64 L455 196"/>
</g>
<path id="stalk" class="pit-stalk" d="M480 168 L480 206"/>
<g id="pitG">
  <path class="pit-sella" d="M446 266 C460 278 500 278 514 266"/>
  <path class="pit-stalkstub" d="M475 206 L485 206 L484 226 L476 226 Z"/>
  <path class="pit-ant" d="M456 230 C466 222 494 222 504 230 C508 244 496 260 480 260 C464 260 452 244 456 230 Z"/>
  <path class="pit-antline" d="M462 234 C470 230 490 230 498 234"/>
  <path class="pit-post" d="M486 246 C494 246 500 252 498 258 C496 263 488 264 484 260 C480 256 481 249 486 246 Z"/>
</g>
<ellipse id="veilDA" class="pit-veil-da" cx="480" cy="242" rx="46" ry="40" opacity="0"/>
<ellipse id="veilSA" class="pit-veil-sa" cx="480" cy="242" rx="46" ry="40" opacity="0"/>
<circle id="adenoma" class="pit-aden" cx="486" cy="250" r="19"/>
<g id="docks"></g>
<g id="guides"></g>
<g id="adrG">
  <path class="pit-adr" d="M350 370 C352 352 366 342 380 342 C394 342 408 352 410 370 C400 364 390 362 380 362 C370 362 360 364 350 370 Z"/>
  <path class="pit-adrcor" d="M356 362 C366 357 394 357 404 362"/>
  <circle class="pit-adrmed" cx="372" cy="352" r="1.8"/><circle class="pit-adrmed" cx="380" cy="350" r="1.8"/><circle class="pit-adrmed" cx="388" cy="352" r="1.8"/>
</g>
<g id="thySlot"></g><g id="gonSlot"></g>
<ellipse id="haloGH" class="pit-halo-gh" cx="150" cy="362" rx="80" ry="44" opacity="0"/>
<ellipse id="haloPRL" class="pit-halo-prl" cx="820" cy="352" rx="80" ry="46" opacity="0"/>
<g id="boneG" class="hot" tabindex="0" data-info="Growth: growth hormone builds bone and tissue. Too much in adults thickens hands, feet and jaw.">
  <g id="boneS">
    <rect class="pit-bone" x="-34" y="-8" width="68" height="16" rx="8"/>
    <circle class="pit-bone" cx="-38" cy="0" r="11"/>
    <circle class="pit-bone" cx="38" cy="0" r="11"/>
    <path class="pit-plate" d="M-24 -8 L-24 8 M24 -8 L24 8"/>
  </g>
</g>
<g id="milkG" class="hot" tabindex="0" data-info="Milk flow: too much prolactin drives milk flow and holds back the gonads.">
  <path id="milkD" class="pit-milk" d="M0-13C5-4 9 2 9 8A9 9 0 1 1 -9 8C-9 2-5-4 0-13Z"/>
</g>
<text id="capTxt" class="pit-cap" x="30" y="430">No treatment.</text>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.pit-vf{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.4}
.pit-shade{fill:var(--c-bad)}
.pit-field{stroke:var(--anatomy-mid);stroke-width:.8;opacity:.6;fill:none}
.pit-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.pit-nerve{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.pit-stalk{fill:none;stroke:var(--c-cyt);stroke-width:4;stroke-linecap:round;opacity:.75}
.pit-ant{fill:#e9a2b3;stroke:#b45f78;stroke-width:1.2}
.pit-post{fill:#f4c6d2;stroke:#b45f78;stroke-width:1}
.pit-stalkstub{fill:#c9d6e8;stroke:#5f83ad;stroke-width:1}
.pit-sella{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.pit-antline{fill:none;stroke:#b45f78;stroke-width:1;opacity:.7}
.pit-adr{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1.2}
.pit-adrcor{fill:none;stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1;opacity:.8}
.pit-adrmed{fill:var(--c-plt);stroke:none}
.pit-aden{fill:#e5484d;stroke:#a02030;stroke-width:1.2}
.pit-veil-da{fill:#38d1ff;pointer-events:none}
.pit-veil-sa{fill:#f2d27a;pointer-events:none}
.pit-guide{fill:none;stroke:var(--anatomy-faint);stroke-width:1.6;stroke-dasharray:3 4;opacity:.7}
.pit-halo-gh{fill:#f2b23a;pointer-events:none}
.pit-halo-prl{fill:#3ddc97;pointer-events:none}
.pit-bone{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.pit-plate{stroke:var(--c-bad);stroke-width:1.4}
.pit-milk{fill:color-mix(in srgb,#fff 55%,var(--c-lymph));stroke:#3fa0d4;stroke-width:1.4}
.pit-cap{fill:var(--anatomy-strong);font-size:12.5px;font-weight:600}
.p-gh{--cc:#f2b23a}.p-acth{--cc:#e07a5f}.p-tsh{--cc:#7fc4e8}.p-fsh{--cc:#b7a1e6}.p-lh{--cc:#e9a2d0}.p-prl{--cc:#3ddc97}
.p-rel{--cc:#c084fc}.p-da{--cc:#38d1ff}.p-sa{--cc:#f2d27a}
.dr-g-fill.g-prl{fill:#3ddc97}.dr-g-fill.g-gh{fill:#f2b23a}.dr-g-fill.g-oth{fill:#7fc4e8}.dr-g-fill.g-mass{fill:#e5484d}
`;

buildScene({
  id: "pituitary-disorders", fig: "Fig 1", title: "Pituitary disorders: excess, mass effect and failure", W, H, body,
  label: "An animated pituitary gland under the brain and optic cross. The brain sends signals down the stalk to the pituitary, which releases growth hormone, ACTH, TSH, FSH, LH and prolactin to the body. A prolactinoma raises prolactin, acromegaly raises growth hormone, and hypopituitarism lowers all hormones. A growing adenoma presses on the optic cross above and shades the outer half of sight in both eyes. Gauges show prolactin, growth hormone, other hormones and mass effect. Treatments are a dopamine agonist, a somatostatin analogue and surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pituit.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true, extraCss,
  withoutLabel: "Without treatment", withLabel: "With surgery",
  sourcesLis: [
    "<strong>How the pituitary works.</strong> The anterior pituitary releases growth hormone, ACTH, TSH, FSH, LH and prolactin under control from the brain through the stalk. Prolactin is held back mainly by dopamine, so a prolactin secreting adenoma (prolactinoma) raises prolactin and can suppress FSH and LH. A growth hormone secreting adenoma causes acromegaly. A large adenoma can press on the optic cross above the gland and lose the outer half of vision in both eyes. Loss of anterior pituitary function (hypopituitarism) lowers all of these hormones. This is standard teaching in endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A dopamine agonist copies dopamine, sits on gland receptors, lowers prolactin and shrinks a prolactinoma, a somatostatin analogue sits on gland receptors and lowers growth hormone in acromegaly, and surgery removes an adenoma and relieves pressure on the cross. These are teaching toggles only.",
  ],
  simplified: "Releasing and inhibiting hormones in detail, posterior pituitary hormones, stalk effects, apoplexy, empty sella, hormone replacement, radiotherapy, pregnancy, drug causes of raised prolactin, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
