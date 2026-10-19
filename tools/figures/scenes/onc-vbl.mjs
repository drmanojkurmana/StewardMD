/* Vinblastine mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-vbl.mjs [--print-model]
 * Static layout here; tumour cell, toxicities and gauges move in onc-vbl.page.js. Qualitative: no doses, no numbers. */
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
    { label: "vinblastine" },
    { label: "vinblastine with bowel regimen and vein care" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "vinblastine", "vinblastine with bowel regimen and vein care"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug >= 1 ? 1 : 0, care = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.25 + 0.68 * a) : 0;
  const M = on ? cl(0.35 + 0.6 * a) : 0.03;
  const C = !on ? 0.03 : care ? cl(0.1 + 0.25 * a) : cl(0.3 + 0.62 * a);
  const N = on ? cl(0.1 + 0.38 * a) : 0.02;
  const Sk = !on ? 0.01 : care ? 0.08 : cl(0.3 + 0.35 * a);
  const Wt = on ? cl(0.12 + 0.5 * a) : 0.02;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.2, 0.6, ["growing", "held", "shrinking"]), w(M, 0.3, 0.65, ["ok", "low", "very low"]), w(C, 0.3, 0.6, ["moving", "slow", "blocked"])];
  return { a, on, care, K, M, C, N, Sk, Wt, words, readout: "tumour " + words[0] + " · marrow " + words[1] + " · gut " + words[2] };
}
const TESTS = [
  [1, 0, "tumour growing · marrow ok · gut moving"],
  [0, 1, "tumour held · marrow low · gut slow"],
  [2, 1, "tumour shrinking · marrow very low · gut blocked"],
  [2, 2, "tumour shrinking · marrow very low · gut slow"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="504" y="68">HEALTHY CELLS: WHY SIDE EFFECTS HAPPEN</text>
<g id="tum"></g><g id="drugG"></g>
<g id="marG"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="nerveG"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="siadh"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "vinblastine-mechanism-adverse-effects", fig: "Fig 1", title: "Vinblastine: blocked microtubules, tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and five toxicity sites. Vinblastine caps tubulin so microtubules cannot grow, the spindle falls apart and the tumour cell arrests and dies. The same block empties the marrow, stills the bowel, mildly injures nerves, burns skin when the drip leaks, and holds water through extra ADH. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds and gauge levels are qualitative and illustrative; no doses, schedules or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-vbl.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without vinblastine", withLabel: "With bowel regimen and vein care",
  sourcesLis: [
    "<strong>How vinblastine works.</strong> Vinblastine is a vinca alkaloid. It binds tubulin, the building block of microtubules, and stops microtubules growing, so the mitotic spindle cannot form and dividing cells arrest in metaphase and die. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Marrow progenitors divide fast like tumour cells, so counts fall and this marrow harm is stronger than with vincristine; autonomic nerve harm stills the bowel and causes constipation; sensory nerves are injured only mildly, less than with vincristine; drug leaking out of the vein kills skin and needs warmth and spreading enzyme care; and extra ADH makes the kidney hold water and dilute the blood salt. Bowel regimen and careful vein watch lower the gut and skin harm but marrow, nerve and water harm continue. These are teaching toggles only.",
  ],
  simplified: "Dosing schedules, growth factor support, dose delays and reductions, liver handling, drug interactions, jaw pain, hair loss, nausea and vomiting, fertility effects, combination regimens, and all management decisions are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:#7fc4d8}
.pn-sp{fill:none;stroke:var(--anatomy-strong);stroke-width:1.2}
.pn-sp.cut{stroke:var(--c-bad);stroke-width:1}
.pn-ch{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:.8}
.pn-pole{fill:var(--anatomy-strong)}
.pn-die{fill:var(--c-bad)}
.pn-bleb{fill:color-mix(in srgb,#7fc4d8 55%,var(--c-bad));stroke:var(--c-bad);stroke-width:.8}
.p-vbl{--cc:#b78ae0}
.p-apop{--cc:#7fc4d8}
.p-tub{--cc:var(--c-bac)}
.p-cargo{--cc:#ffd24a}
.pn-axon{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4}
.pn-rail{fill:none;stroke:var(--c-bac);stroke-width:2;stroke-linecap:round}
.pn-soma{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:1}
.pn-nucl{fill:color-mix(in srgb,var(--c-mac) 45%,#1a1030)}
.pn-term{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.8}
.pn-deg{fill:var(--c-bad)}
.pn-bone{fill:color-mix(in srgb,#e6d7b8 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.pn-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,#3a0e14)}
.pn-prog{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.7}
.p-neut{--cc:var(--c-neut)}
.pn-stool{fill:#8a6a3f;stroke:color-mix(in srgb,#8a6a3f 55%,#000);stroke-width:.8}
.pn-vein{fill:none;stroke:var(--c-cyt2);stroke-width:2.4;stroke-linecap:round}
.pn-needle{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.p-leak{--cc:var(--c-bad)}
.pn-necro{fill:#453a44}
.pn-shield{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-dasharray:5 4}
.p-adh{--cc:var(--c-cyt2)}
.pn-water{fill:var(--c-cyt2)}
.pn-cap{fill:var(--anatomy-strong);font-size:13px}
`,
});
