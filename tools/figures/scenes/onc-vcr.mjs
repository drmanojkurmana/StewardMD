/* Vincristine mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-vcr.mjs [--print-model]
 * Static layout here; tumour cell, toxicities and gauges move in onc-vcr.page.js. Qualitative: no doses, no numbers. */
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
    { label: "vincristine" },
    { label: "vincristine with bowel care and a safe IV line" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "vincristine", "vincristine with bowel care and safe IV"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], vcr = drug >= 1 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = vcr ? cl(0.22 + 0.7 * a) : 0;
  const N = vcr ? cl(0.12 + 0.8 * a) : 0.03;
  const B = !vcr ? 0.03 : prot ? cl(0.12 + 0.25 * a) : cl(0.2 + 0.72 * a);
  const T = !vcr ? 0.02 : prot ? 0.08 : cl(0.5 + 0.3 * a);
  const M = vcr ? 0.1 : 0.04;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.2, 0.6, ["growing", "held", "shrinking"]), w(N, 0.25, 0.6, ["healthy", "tingling", "damaged"]), w(B, 0.25, 0.6, ["moving", "slow", "blocked"])];
  return { a, vcr, prot, K, N, B, T, M, words, readout: "tumour " + words[0] + " · nerves " + words[1] + " · bowel " + words[2] };
}
const TESTS = [
  [2, 0, "tumour growing · nerves healthy · bowel moving"],
  [2, 1, "tumour shrinking · nerves damaged · bowel blocked"],
  [2, 2, "tumour shrinking · nerves damaged · bowel slow"],
  [0, 1, "tumour held · nerves tingling · bowel slow"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="460" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="vc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="vc-zone" x="504" y="68">HEALTHY CELLS: WHY SIDE EFFECTS HAPPEN</text>
<g id="tum"></g><g id="drugG"></g>
<g id="nerveG"></g>
<g id="bowelSlot"></g><g id="bowelG"></g>
<g id="veinG"></g><g id="spineG"></g><g id="marG"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "vincristine-mechanism-adverse-effects", fig: "Fig 1", title: "Vincristine: capped tubulin, tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and several healthy tissues. Vincristine caps tubulin so no spindle forms and the tumour cell arrests in metaphase and dies. The same cap breaks axon rails so feet go numb and ankles weaken, stalls the bowel toward ileus unless laxative bowel care keeps it moving, burns skin where it leaks from the vein, and is fatal in spinal fluid, while marrow keeps making blood cells. Gauges show tumour kill, neuropathy, constipation, tissue injury and marrow. Treatment choices are no treatment, vincristine, and vincristine with bowel care and a safe IV line.",
  caption: "Schematic, not to scale. Speeds and gauge levels are qualitative and illustrative; no doses, schedules or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-vcr.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: ["colon"],
  withoutLabel: "Without vincristine", withLabel: "With vincristine, bowel care and safe IV",
  sourcesLis: [
    "<strong>How vincristine works.</strong> Vincristine caps tubulin so microtubules cannot grow. With no spindle, chromosomes cannot line up or separate, so dividing tumour cells arrest in metaphase and die. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Nerves, gut and vein all rely on microtubules. Capped tubulin stalls axon transport so feet tingle and go numb with weak grip and a slow bowel; leaked drug burns skin it touches; drug in spinal fluid is fatal; and marrow is largely spared so counts stay steady. Laxative bowel care and a safe IV line are teaching toggles only.",
  ],
  simplified: "Doses, schedules, dose caps, the extravasation antidote, liver handling, drug interactions, bladder effects and all management decisions are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:#7fc4d8}
.vc-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em}
.vc-cap{fill:var(--anatomy-strong);font-size:11px}
.vc-capline{fill:var(--anatomy-strong);font-size:13px}
.vc-sp{fill:none;stroke:var(--anatomy-strong);stroke-width:1.2}
.vc-sp.gone{stroke:var(--c-bad);stroke-width:1;opacity:.65}
.vc-ch{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:.8}
.vc-pole{fill:var(--anatomy-strong)}
.vc-die{fill:var(--c-bad)}
.vc-bleb{fill:color-mix(in srgb,#7fc4d8 55%,var(--c-bad));stroke:var(--c-bad);stroke-width:.8}
.vc-tub{fill:#7fc4d8;stroke:color-mix(in srgb,#7fc4d8 55%,#000);stroke-width:.8}
.vc-capd{fill:#9a7ff2;stroke:color-mix(in srgb,#9a7ff2 55%,#000);stroke-width:.6}
.p-vcr{--cc:#9a7ff2}
.p-apop{--cc:#7fc4d8}
.p-cargo{--cc:#ffd24a}
.vc-axon{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4}
.vc-rail{fill:none;stroke:var(--c-bac);stroke-width:2;stroke-linecap:round}
.vc-soma{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:1}
.vc-nucl{fill:color-mix(in srgb,var(--c-mac) 45%,#1a1030)}
.vc-term{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.8}
.vc-deg{fill:var(--c-bad)}
.vc-pel{fill:#8a5a2b;stroke:#5c3a17;stroke-width:.8}
.vc-wave{fill:none;stroke:var(--c-good);stroke-width:2.5}
.vc-dist{fill:#a03a2a}
.p-lax{--cc:var(--c-good)}
.vc-vein{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.2}
.vc-drip{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4}
.vc-cham{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.vc-chamfl{fill:#9a7ff2}
.vc-necro{fill:#7d1a10}
.vc-blis{fill:#c0392b;stroke:#7d1a10;stroke-width:.8}
.vc-safe{fill:none;stroke:var(--c-good);stroke-width:2;stroke-dasharray:5 4}
.vc-canal{fill:var(--c-fl)}
.vc-vert{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.vc-syr{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.2}
.vc-syrfl{fill:#9a7ff2}
.vc-ln{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4}
.vc-ban{fill:none;stroke:var(--c-bad);stroke-width:3}
.vc-glow{fill:var(--c-bad)}
.vc-bone{fill:color-mix(in srgb,var(--anatomy-paper) 72%,var(--c-plt));stroke:var(--anatomy-mid);stroke-width:1.2}
.vc-cavity{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1}
.vc-prog{fill:var(--anatomy-paper);stroke:var(--c-rbc);stroke-width:1.2}
.p-neut{--cc:var(--c-neut)}
`,
});
