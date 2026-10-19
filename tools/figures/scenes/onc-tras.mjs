/* Trastuzumab as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-tras.mjs [--print-model]
 * Static layout here; HER2 blockade, NK killing and gauges move in onc-tras.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.3, 0.65, 1], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "trastuzumab" },
    { label: "trastuzumab with heart checks and early pause" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "trastuzumab", "trastuzumab with heart checks"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, mon = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.3 + 0.65 * a) : 0.04;
  const Ht = on ? cl(a * (mon ? 0.25 : 1) * (0.5 + 0.45 * a)) : 0.02;
  const Inf = on ? cl(0.55 - 0.35 * a) : 0;
  const Di = on ? cl(0.22 + 0.35 * a) : 0.03;
  const Lu = on ? cl(0.04 + 0.14 * a) : 0.01;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(Ht, 0.25, 0.6, ["ok", "strained", "failing"]), w(Inf, 0.25, 0.5, ["calm", "flushed", "severe"])];
  return { a, on, mon, K, Ht, Inf, Di, Lu, words, readout: "tumour " + words[0] + " · heart " + words[1] + " · infusion " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · heart ok · infusion calm"],
  [0, 1, "tumour shrinking · heart ok · infusion flushed"],
  [2, 1, "tumour dying · heart failing · infusion calm"],
  [2, 2, "tumour dying · heart ok · infusion calm"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="tr-zone" x="34" y="68">TUMOUR CELL</text>
<text class="tr-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="her"></g>
<g id="sig"></g>
<g id="ab"></g>
<g id="nk"></g>
<g id="gran"></g>
<g id="frag"></g>
<g id="heartSlot"></g><g id="heartFx"></g>
<g id="lungSlot"></g><g id="lungFx"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "trastuzumab-mechanism-adverse-effects", fig: "Fig 1", title: "Trastuzumab: HER2 blockade and side effects", W, H, body,
  label: "An animated HER2 positive tumour cell and toxicity organs. Trastuzumab antibodies coat HER2 on the tumour, block its growth signal and recruit NK cells that kill the cell. In the heart the same blockade removes a survival signal so the pump weakens with each course unless heart checks pause the drug. Skin, bowel and lung show the other side effects. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-tras.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With heart checks",
  sourcesLis: [
    "<strong>How trastuzumab works.</strong> Trastuzumab is a monoclonal antibody against the extracellular domain of HER2. It blocks HER2 growth signalling in HER2 positive breast and gastric cancer and recruits natural killer cells that kill antibody coated cells (ADCC). Heart muscle relies on HER2 signalling to survive stress, so blockade can cause reversible pump failure, worse after anthracyclines; infusion reactions, diarrhoea and rare lung injury are the other harms shown. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protection shown.</strong> Regular heart checks with early pause of the drug when the pump strains, which keeps failure from building; tumour kill and other side effects continue. This is a teaching toggle only.",
  ],
  simplified: "Pertuzumab and other HER2 drugs, antibody drug conjugates, HER2 testing, infusion premedication, heart medicines, monitoring schedules, retreatment after recovery, pregnancy warnings, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.tr-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.tr-cap{fill:var(--anatomy-strong);font-size:13px}
.tr-knob{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.8}
.tr-stem{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.6}
.tr-tail{stroke:var(--c-cyt);stroke-width:2;stroke-linecap:round}
.tr-tip{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.6}
.tr-abd{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.7;stroke-linejoin:round}
.tr-sig{--cc:var(--c-cyt)}
.tr-gran{--cc:var(--c-lymph)}
.tr-deb{--cc:var(--c-graft)}
.tr-surv{--cc:var(--c-good)}
.tr-spark{--cc:#ff9a3d}
.tr-dil{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:6 4}
.tr-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.tr-haze{fill:var(--c-endo)}
.tr-hazep{--cc:var(--c-endo)}
.tr-gut{fill:var(--c-bad)}
.tr-slough{--cc:var(--c-eos)}
.tr-flush{fill:var(--c-bad)}
.tr-wheal{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:.6}
.tr-heat{--cc:var(--c-eos)}
.tr-flash{fill:none;stroke:#ffd24a;stroke-width:2;stroke-linejoin:round}
`,
});
