/* Paclitaxel mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-pacli.mjs [--print-model]
 * Static layout here; tumour cell, toxicities and gauges move in onc-pacli.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.35, 0.65, 1], names: ["early cycles", "middle cycles", "later cycles"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "paclitaxel" },
    { label: "paclitaxel with premedication (steroid and antihistamine)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "paclitaxel", "paclitaxel with premedication"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], pac = drug >= 1 ? 1 : 0, prem = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = pac ? cl(0.22 + 0.7 * a) : 0;
  const N = pac ? cl(0.12 + 0.8 * a) : 0.03;
  const P = pac ? cl(0.5 + 0.3 * a) : 0.04;
  const H = !pac ? 0.02 : prem ? 0.08 : 0.62;
  const A = pac ? cl(0.15 + 0.78 * a) : 0.02;
  const Mu = pac ? cl(0.3 + 0.5 * a) : 0.03;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.2, 0.6, ["growing", "held", "shrinking"]), w(N, 0.25, 0.6, ["healthy", "tingling", "damaged"]), w(H, 0.2, 0.45, ["calm", "uneasy", "reacting"])];
  return { a, pac, prem, K, N, P, H, A, Mu, words, readout: "tumour " + words[0] + " · nerves " + words[1] + " · allergy " + words[2] };
}
const TESTS = [
  [2, 0, "tumour growing · nerves healthy · allergy calm"],
  [2, 1, "tumour shrinking · nerves damaged · allergy reacting"],
  [2, 2, "tumour shrinking · nerves damaged · allergy calm"],
  [0, 1, "tumour held · nerves tingling · allergy reacting"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="460" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="504" y="68">HEALTHY CELLS: WHY SIDE EFFECTS HAPPEN</text>
<path class="dr-beam" d="M496 158H934"/>
<path class="dr-beam" d="M496 224H934"/>
<path class="dr-beam" d="M496 290H934"/>
<path class="dr-beam" d="M496 356H934"/>
<g id="tum"></g><g id="drugG"></g>
<g id="nerveG"></g><g id="marG"></g><g id="algG"></g>
<g id="skinSlot"></g><g id="hairG"></g>
<g id="muscSlot"></g><g id="acheG"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "paclitaxel-mechanism-adverse-effects", fig: "Fig 1", title: "Paclitaxel: locked microtubules, tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and five healthy tissues. Paclitaxel sticks to tubulin and locks the spindle so the tumour cell arrests in mitosis and dies. The same lock stalls cargo in long nerve fibres, arrests marrow and hair root cells, aches muscle, and can set off a mast cell allergy alarm that premedication calms. Gauges show tumour kill, neuropathy, neutropenia, allergy, hair loss and muscle pain. Treatment choices are no treatment, paclitaxel, and paclitaxel with premedication.",
  caption: "Schematic, not to scale. Speeds and gauge levels are qualitative and illustrative; no doses, schedules or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-pacli.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: ["skin", "muscle"],
  withoutLabel: "Without paclitaxel", withLabel: "With paclitaxel and premedication",
  sourcesLis: [
    "<strong>How paclitaxel works.</strong> Paclitaxel binds beta tubulin and stabilises microtubules so they cannot shorten. The mitotic spindle cannot pull chromosomes apart, so dividing cells arrest in mitosis and die. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Long sensory nerves fail when axonal microtubule transport stalls, giving stocking and glove numbness; fast dividing marrow progenitors and hair root cells arrest, giving low neutrophils and hair loss; aching joints and muscles follow each dose; and the oily Cremophor vehicle can trigger mast cell histamine release with flushing, rash and wheeze, which steroid and antihistamine premedication largely prevents. These are teaching toggles only.",
  ],
  simplified: "Dosing schedules, albumin bound paclitaxel, growth factor support, dose delays and reductions, liver handling, drug interactions, rare effects on heart rhythm, liver and vision, and all management decisions are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:#7fc4d8}
.pn-sp{fill:none;stroke:var(--anatomy-strong);stroke-width:1.2}
.pn-sp.frozen{stroke:var(--c-bad);stroke-width:2.6}
.pn-ch{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:.8}
.pn-pole{fill:var(--anatomy-strong)}
.pn-die{fill:var(--c-bad)}
.pn-bleb{fill:color-mix(in srgb,#7fc4d8 55%,var(--c-bad));stroke:var(--c-bad);stroke-width:.8}
.p-pac{--cc:#ef6aa5}
.p-apop{--cc:#7fc4d8}
.p-cargo{--cc:#ffd24a}
.pn-axon{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4}
.pn-rail{fill:none;stroke:var(--c-bac);stroke-width:2;stroke-linecap:round}
.pn-soma{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:1}
.pn-nucl{fill:color-mix(in srgb,var(--c-mac) 45%,#1a1030)}
.pn-term{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.8}
.pn-deg{fill:var(--c-bad)}
.pn-bone{fill:color-mix(in srgb,var(--anatomy-paper) 72%,var(--c-plt));stroke:var(--anatomy-mid);stroke-width:1.2}
.pn-cavity{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1}
.pn-prog{fill:var(--anatomy-paper);stroke:var(--c-rbc);stroke-width:1.2}
.p-neut{--cc:var(--c-neut)}
.pn-gran{fill:color-mix(in srgb,var(--c-mast) 60%,#1a1030)}
.p-hist{--cc:var(--c-bad)}
.pn-flush{fill:var(--c-bad)}
.pn-prem{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-dasharray:5 4}
.p-prem{--cc:var(--c-good)}
.pn-fol{fill:color-mix(in srgb,var(--c-plt) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.8}
.pn-hair{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round}
.pn-ache{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.pn-cap{fill:var(--anatomy-strong);font-size:13px}
`,
});
