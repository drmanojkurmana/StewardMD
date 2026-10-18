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
  level: { label: "Toxin shown", a: [0, 1, 2, 3, 4, 5, 6], names: ["diphtheria toxin", "pertussis toxin", "cholera toxin", "Shiga toxin", "C. difficile toxins", "tetanus toxin", "botulinum toxin"], ticks: ["diphtheria", "pertussis", "cholera", "Shiga", "C. difficile", "tetanus", "botulinum"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antitoxin and supportive care" },
    { label: "antibiotic with supportive care" },
    { label: "vaccination (prevention)" },
  ],
  status: "Toxin: {level} · {drug} ·",
  drugNames: ["no treatment", "antitoxin and supportive care", "antibiotic with supportive care", "vaccination prevention"],
};
function modelOf(S, level, drug) {
  const tox = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const BASE = [[0.9, 0.9, 0.85, 0.8], [0.85, 0.85, 0.5, 0.65], [0.9, 0.9, 0.65, 0.9], [0.9, 0.9, 0.9, 0.9], [0.85, 0.85, 0.8, 0.75], [0.8, 0.85, 0.75, 0.85], [0.8, 0.85, 0.7, 0.85]][tox];
  const EFF = [[0, 0, 0, 0, 0, 0, 0], [0.75, 0.15, 0.1, 0.2, 0.3, 0.6, 0.65], [0.6, 0.55, 0.35, 0.05, 0.75, 0.4, 0.3], [0.95, 0.9, 0.6, 0.1, 0.1, 0.95, 0.1]][drug][tox];
  const Act = cl(BASE[0] * (1 - 0.85 * EFF)), Hit = cl(BASE[1] * (1 - 0.75 * EFF)), Dys = cl(BASE[2] * (1 - 0.65 * EFF)), Clin = cl(BASE[3] * (1 - 0.6 * EFF));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Act, 0.25, 0.6, ["low", "moderate", "high"]), w(Hit, 0.25, 0.6, ["low", "moderate", "high"]), w(Dys, 0.25, 0.55, ["little", "some", "marked"]), w(Clin, 0.25, 0.55, ["mild", "moderate", "severe"])];
  return { tox, drug, Act, Hit, Dys, Clin, words, readout: "toxin action " + words[0] + " · target hit " + words[1] + " · cell dysfunction " + words[2] + " · clinical effect " + words[3] };
}
const TESTS = [
  [0, 0, "toxin action high · target hit high · cell dysfunction marked · clinical effect severe"],
  [0, 1, "toxin action moderate · target hit moderate · cell dysfunction some · clinical effect moderate"],
  [4, 2, "toxin action moderate · target hit moderate · cell dysfunction some · clinical effect moderate"],
  [5, 3, "toxin action low · target hit low · cell dysfunction some · clinical effect moderate"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BACTERIUM</text>
<text class="sc-zone" x="300" y="68">HOST CELL</text>
<text class="sc-zone" x="700" y="68">EFFECT</text>
<g id="stage"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.tx-host{fill:color-mix(in srgb,var(--c-lymph) 16%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.tx-card{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.tx-bac{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:1}
.tx-bac2{fill:color-mix(in srgb,var(--c-bac) 55%,#fff)}
.tx-toxname{fill:var(--anatomy-strong);font-size:16px;font-weight:700;text-anchor:middle;pointer-events:none}
.tx-sub{fill:var(--anatomy-text);font-size:11.5px;text-anchor:middle;pointer-events:none}
.tx-src{fill:var(--anatomy-strong);font-size:11px;font-weight:600;text-anchor:middle;pointer-events:none}
.tx-effT{fill:var(--anatomy-strong);font-size:14px;font-weight:700;text-anchor:middle;pointer-events:none}
.tx-memb{fill:color-mix(in srgb,var(--c-endo) 65%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.tx-ribo{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.8}
.tx-ribo2{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.8}
.tx-gp{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.8}
.tx-rho{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:.8}
.tx-actin{fill:none;stroke:var(--c-eos);stroke-width:2;stroke-linecap:round}
.tx-ves{fill:var(--c-mast);stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:.8}
.tx-snare{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.tx-mrna{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.tx-camp{fill:var(--c-no);stroke:color-mix(in srgb,var(--c-no) 50%,#000);stroke-width:.5}
.tx-cut{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.p-tox{--cc:#ff7a45}.p-sig{--cc:var(--c-cyt)}
.tx-shield{fill:color-mix(in srgb,var(--c-good) 25%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1.6}
.tx-y{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
`;

buildScene({
  id: "bacterial-toxin-mechanisms", fig: "Fig 1", title: "Bacterial toxins: hijacking host cells", W, H, body, extraCss,
  label: "An animated bacterium releasing toxin into a host cell. Diphtheria toxin blocks protein synthesis through EF-2, pertussis and cholera toxins raise cAMP through Gi and Gs, Shiga toxin cleaves ribosomal RNA and injures endothelium, C. difficile toxins glucosylate Rho GTPases, and tetanus and botulinum toxins cleave SNARE proteins. Gauges show toxin action, target hit, cell dysfunction and clinical effect. Treatment choices are antitoxin, antibiotics and vaccination.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "toxins.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Toxin mechanisms shown.</strong> Diphtheria toxin ADP-ribosylates elongation factor 2, stopping protein synthesis, with pseudomembrane and myocarditis. Pertussis toxin ADP-ribosylates Gi, raising cAMP and driving lymphocytosis. Cholera toxin locks Gs on, raising cAMP and opening chloride channels so salt and water leave the gut. Shiga toxin cleaves 60S ribosomal RNA, injuring endothelium and causing haemolytic uraemic syndrome. C. difficile toxins glucosylate Rho GTPases, collapsing the cytoskeleton and causing colitis. Tetanus and botulinum toxins are proteases that cleave SNARE proteins and block vesicle release. This is standard teaching in microbiology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antitoxin neutralises toxin that has not yet entered cells, antibiotics reduce the bacteria making toxin, supportive care protects the airway, heart, gut and kidneys meanwhile, and vaccination prevents disease for toxins with effective toxoid or related vaccines. They are teaching toggles only.",
  ],
  simplified: "Toxin uptake routes in molecular detail, receptor names beyond the targets shown, subunit structures, dose and timing, toxin-specific complications beyond the headline effects, and which antibiotic or antitoxin suits which toxin are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
