/* Bacterial toxins that hijack host cells, as an animated working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/toxins.mjs [--print-model]
 * Static layout here; toxin traffic, targets and gauges move in toxins.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Toxin shown", a: [0, 1, 2, 3, 4, 5, 6], names: ["diphtheria toxin", "pertussis toxin", "cholera toxin", "Shiga toxin", "C. difficile toxins", "tetanus toxin", "botulinum toxin"], ticks: ["diphtheria", "pertussis", "cholera", "Shiga", "C. difficile", "tetanus", "botulinum"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antitoxin and supportive care" },
    { label: "antibiotic with supportive care" },
    { label: "antitoxin plus antibiotic" },
  ],
  status: "Toxin: {level} · {drug} ·",
  drugNames: ["no treatment", "antitoxin and supportive care", "antibiotic with supportive care", "antitoxin plus antibiotic with supportive care"],
};
function modelOf(S, level, drug) {
  const tox = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const BASE = [
    [0.90, 0.90, 0.85, 0.80],
    [0.85, 0.85, 0.50, 0.65],
    [0.90, 0.90, 0.65, 0.90],
    [0.90, 0.90, 0.90, 0.90],
    [0.85, 0.85, 0.80, 0.75],
    [0.80, 0.85, 0.75, 0.85],
    [0.80, 0.85, 0.70, 0.85],
  ][tox];
  const EFF = [
    [0, 0, 0, 0, 0, 0, 0],
    [0.80, 0.10, 0.10, 0.15, 0.35, 0.80, 0.75],
    [0.45, 0.50, 0.40, 0.00, 0.70, 0.40, 0.25],
    [0.90, 0.55, 0.50, 0.20, 0.80, 0.90, 0.85],
  ][drug][tox];
  const Act = cl(BASE[0] * (1 - 0.85 * EFF)), Hit = cl(BASE[1] * (1 - 0.75 * EFF)), Dys = cl(BASE[2] * (1 - 0.65 * EFF)), Clin = cl(BASE[3] * (1 - 0.6 * EFF));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Act, 0.25, 0.6, ["low", "moderate", "high"]), w(Hit, 0.25, 0.6, ["low", "moderate", "high"]), w(Dys, 0.25, 0.55, ["little", "some", "marked"]), w(Clin, 0.25, 0.55, ["mild", "moderate", "severe"])];
  return { tox, drug, Act, Hit, Dys, Clin, words, readout: "toxin action " + words[0] + " · target hit " + words[1] + " · cell dysfunction " + words[2] + " · clinical effect " + words[3] };
}
const TESTS = [
  [0, 0, "toxin action high · target hit high · cell dysfunction marked · clinical effect severe"],
  [2, 0, "toxin action high · target hit high · cell dysfunction marked · clinical effect severe"],
  [0, 3, "toxin action low · target hit moderate · cell dysfunction some · clinical effect moderate"],
  [3, 2, "toxin action high · target hit high · cell dysfunction marked · clinical effect severe"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="orgL"></g>
<g id="orgR"></g>
<path id="vesL" class="tx-flow" d="M150 300 L414 250"/>
<path id="vesR" class="tx-flow" d="M546 250 L808 255"/>
<path id="ahL" class="tx-ah" d="M400 243 L414 250 L400 257 Z"/>
<path id="ahR" class="tx-ah" d="M532 243 L546 250 L532 257 Z"/>
<g id="hostSlot"></g>
<g id="bacSlot"></g>
<g id="glowSlot"></g>
<g id="trapSlot"></g>
<g id="nameSlot"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.tx-flow{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 40%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;stroke-linejoin:round;opacity:.5}
.tx-ah{fill:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke:none}
.tx-name{fill:var(--anatomy-strong);font-size:16px;font-weight:700;text-anchor:middle}
.tx-eff{fill:var(--anatomy-strong);font-size:14px;font-weight:700;text-anchor:middle}
.tx-cap{fill:var(--anatomy-strong);font-size:13px}
.tx-bac{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:1}
.tx-bac2{fill:color-mix(in srgb,var(--c-bac) 60%,#fff);stroke:none}
.tx-y{fill:none;stroke:var(--c-ab);stroke-width:2.6;stroke-linecap:round}
.tx-capA{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.8}
.tx-capB{fill:var(--c-bad);stroke:none}
.tx-memb{fill:color-mix(in srgb,var(--c-endo) 65%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.tx-ribo{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.8}
.tx-ribo2{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.8}
.tx-gp{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.8}
.tx-rho{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:.8}
.tx-actin{fill:none;stroke:var(--c-eos);stroke-width:2;stroke-linecap:round}
.tx-cutact{fill:none;stroke:var(--c-eos);stroke-width:2;stroke-linecap:round;stroke-dasharray:7 5}
.tx-ves{fill:var(--c-mast);stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:.8}
.tx-snare{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.tx-mrna{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.tx-camp{fill:var(--c-no);stroke:color-mix(in srgb,var(--c-no) 50%,#000);stroke-width:.5}
.tx-cut{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.tx-chain{fill:var(--c-fl);stroke:none}
.tx-ef2{fill:var(--c-bad);stroke:none}
.tx-lock{fill:none;stroke:var(--c-eos);stroke-width:2;stroke-linecap:round}
.tx-glowR{fill:var(--c-bad);stroke:none}
.tx-glowB{fill:var(--c-fl);stroke:none}
.tx-glowP{fill:var(--c-lymph);stroke:none}
.tx-glowO{fill:var(--c-eos);stroke:none}
.p-tox{--cc:#ff7a45}.p-sig{--cc:var(--c-cyt)}.p-wat{--cc:var(--c-fl)}.p-lym{--cc:#d7ecf7}.p-puf{--cc:var(--c-cyt2)}.p-toxT{--cc:var(--c-ab)}
`;

buildScene({
  id: "bacterial-toxin-mechanisms", fig: "Fig 1", title: "Bacterial toxins: hijacking host cells", W, H, body, extraCss,
  label: "An animated germ releasing toxin onto a target cell. Toxin drifts from the infected organ to one precise cell target, the damaged cell signals onward, and the downstream organ suffers: heart, blood, colon, kidney or muscle depending on the toxin. Antitoxin traps free toxin, antibiotic kills the germs, and both together work best.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "toxins.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antitoxin plus antibiotic",
  sourcesLis: [
    "<strong>Toxin mechanisms shown.</strong> Diphtheria toxin blocks EF-2 and stops protein synthesis, with heart injury. Pertussis toxin disables Gi, raising cAMP and filling blood with lymphocytes. Cholera toxin locks Gs on, so chloride and water pour from the gut. Shiga toxin cuts ribosomal RNA and injures kidney vessels. C. difficile toxins freeze Rho switches and collapse the colon lining. Tetanus and botulinum toxins cut SNARE proteins, locking muscle rigid or leaving it limp. This is standard teaching in microbiology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antitoxin grabs free toxin before it enters cells, and works best where a matching antitoxin exists. Antibiotic kills the germs making toxin, but does not touch toxin already released, and antibiotics do not help Shiga toxin disease and may worsen it. Supportive care protects the body meanwhile. Vaccines prevent diphtheria, pertussis, tetanus and cholera but cannot treat active disease, so they are not a treatment choice here. These are teaching toggles only.",
  ],
  simplified: "Toxin uptake routes in molecular detail, receptor names, subunit structures, dose and timing, complications beyond the headline effects, and which antibiotic suits which germ are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
