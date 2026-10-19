/* Doxorubicin as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-doxo.mjs [--print-model]
 * Static layout here; tumour kill, radicals and gauges move in onc-doxo.page.js. Qualitative: no doses, no numbers. */
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
    { label: "doxorubicin" },
    { label: "doxorubicin with dexrazoxane (heart protection)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "doxorubicin", "doxorubicin with dexrazoxane"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, dxr = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.3 + 0.65 * a) : 0.04;
  const Ht = on ? cl(a * (dxr ? 0.22 : 1) * (0.55 + 0.45 * a)) : 0.02;
  const Mr = on ? cl(0.3 + 0.55 * a) : 0.05;
  const Gu = on ? cl(0.25 + 0.5 * a) : 0.04;
  const Ha = on ? cl(0.35 + 0.55 * a) : 0;
  const Sk = on ? cl(0.08 + 0.2 * a) : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(Ht, 0.25, 0.6, ["ok", "strained", "failing"]), w(Mr, 0.3, 0.65, ["ok", "low", "very low"])];
  return { a, on, dxr, K, Ht, Mr, Gu, Ha, Sk, words, readout: "tumour " + words[0] + " · heart " + words[1] + " · marrow " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · heart ok · marrow ok"],
  [0, 1, "tumour shrinking · heart ok · marrow low"],
  [2, 1, "tumour dying · heart failing · marrow very low"],
  [2, 2, "tumour dying · heart ok · marrow very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="dx-zone" x="34" y="68">TUMOUR CELL</text>
<text class="dx-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="dox"></g>
<g id="frag"></g>
<g id="heartSlot"></g><g id="heartFx"></g>
<g id="mar"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="kidSlot"></g><g id="urine"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "doxorubicin-mechanism-adverse-effects", fig: "Fig 1", title: "Doxorubicin: tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and toxicity organs. Doxorubicin wedges into tumour DNA and traps topoisomerase II, which kills the tumour cell. In the heart the drug makes free radicals with iron and poisons topoisomerase II beta, so damage builds toward heart failure with each course unless dexrazoxane protects it. Marrow, gut lining, hair, skin and urine show the other side effects. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-doxo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With dexrazoxane",
  sourcesLis: [
    "<strong>How doxorubicin works.</strong> Doxorubicin is an anthracycline. It wedges between DNA base pairs (intercalation) and traps topoisomerase II on the DNA, so dividing tumour cells cannot copy their genome and die. In heart muscle the drug also redox cycles with iron to make free radicals and poisons topoisomerase II beta in mitochondria, giving a cumulative dilated cardiomyopathy; rapidly dividing normal tissues (marrow, gut lining, hair) are harmed for the same reason the tumour is. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protection shown.</strong> Dexrazoxane chelates iron and blocks topoisomerase II beta, which lowers cardiac injury; marrow, gut, hair, skin and urine effects continue. This is a teaching toggle only.",
  ],
  simplified: "Other anthracyclines and their differences, infusion reactions, nausea and vomiting, infertility, second cancers, monitoring tests, dose adjustment, scheduling, combination regimens, extravasation care beyond stopping the infusion, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.dx-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.dx-cap{fill:var(--anatomy-strong);font-size:13px}
.dx-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.dx-rung{fill:none;stroke:var(--c-cyt);stroke-width:1.2}
.dx-wedge{--cc:var(--c-bad)}
.dx-topo .dx-tb{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.8}
.dx-topo .dx-tl{fill:none;stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:2.4}
.dx-topo.trapped .dx-tb{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.dx-topo.trapped .dx-tl{stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.dx-flash{fill:none;stroke:#ffd24a;stroke-width:2;stroke-linejoin:round}
.dx-rad{--cc:#ff9a3d}
.dx-dxr{--cc:var(--c-cyt2)}
.dx-deb{--cc:var(--c-graft)}
.dx-dil{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:6 4}
.dx-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.dx-bone{fill:color-mix(in srgb,#e6d7b8 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.dx-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,#3a0e14)}
.dx-mar{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.7}
.dx-gut{fill:var(--c-bad)}
.dx-slough{--cc:var(--c-eos)}
.dx-blotch{fill:var(--c-bad)}
.dx-necro{fill:#453a44}
.dx-hair{fill:#4a3a28;stroke:none}
.dx-urine{fill:var(--c-bad)}
`,
});
