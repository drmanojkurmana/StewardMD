/* Imatinib mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-ima.mjs [--print-model]
 * Static layout here; BCR-ABL, T315I, organs and gauges move in onc-ima.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.25, 0.5, 0.75, 1], names: ["early", "middle", "late", "cumulative"], ticks: ["early", "middle", "late", "cumulative"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "imatinib" },
    { label: "imatinib with diuretics and organ checks" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "imatinib", "imatinib with protection"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Kill = on ? cl(0.25 + 0.75 * a) : 0;
  const Swell = on ? cl(a * a * 1.15 * (prot ? 0.4 : 1)) : 0;
  const Mar = on ? cl(0.6 * (1 - a) + 0.12) : 0.02;
  const Liv = on ? cl(0.15 + 0.55 * a * (prot ? 0.6 : 1)) : 0;
  const Cramp = on ? cl(0.55 * (1 - a * 0.55)) : 0;
  const Hrt = on ? 0.06 + 0.05 * a : 0.02;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Kill, 0.35, 0.7, ["growing", "shrinking", "controlled"]), w(Swell, 0.25, 0.6, ["none", "puffy", "swollen"]), w(Mar, 0.25, 0.5, ["normal", "low", "very low"])];
  return { a, on, prot, Kill, Swell, Mar, Liv, Cramp, Hrt, words, readout: "tumour " + words[0] + " · swelling " + words[1] + " · blood counts " + words[2] };
}
const TESTS = [
  [3, 0, "tumour growing · swelling none · blood counts normal"],
  [3, 1, "tumour controlled · swelling swollen · blood counts normal"],
  [3, 2, "tumour controlled · swelling puffy · blood counts normal"],
  [0, 1, "tumour shrinking · swelling none · blood counts very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LEUKAEMIA CELL</text>
<text class="sc-zone" x="604" y="68">ORGANS AT RISK</text>
<g id="cellSlot"></g><g id="kinase"></g><g id="mutSlot"></g>
<g id="eyeSlot"></g><g id="musSlot"></g><g id="livSlot"></g><g id="hrtSlot"></g><g id="marrow"></g>
<g id="parts"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "imatinib-mechanism-adverse-effects", fig: "Fig 1", title: "Imatinib: silencing BCR-ABL, swelling and liver strain", W, H, body,
  label: "An animated leukaemia cell and the organs at risk. BCR-ABL grabs ATP and fires growth signals until imatinib slots into its ATP pocket and locks it shut; ATP bounces off, signalling stops and the cell dies. A T315I gatekeeper mutant still fits ATP but not imatinib, so that clone keeps growing. PDGFR blockade loosens vessel walls and puffs the eyes, muscle cramps, marrow counts dip early, the liver strains and rarely the heart weakens. Gauges show tumour kill, swelling, low counts and liver strain. Treatment choices include imatinib alone and imatinib with diuretics and organ checks.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-ima.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without imatinib", withLabel: "With imatinib plus protection",
  sourcesLis: [
    "<strong>How imatinib stops the tumour.</strong> Imatinib occupies the ATP pocket of inactive BCR-ABL (and also KIT and PDGFR), so substrate phosphorylation and downstream signalling stop and CML and GIST cells die. The T315I gatekeeper change blocks drug binding while sparing ATP, so the clone resists. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> PDGFR blockade loosens vessel walls and causes fluid retention with periorbital oedema; marrow, gut and muscle effects give cytopenias, nausea and cramps; the liver strains under drug breakdown; rarely the heart weakens. Diuretics ease swelling and organ checks catch liver and heart injury early. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Diuretics for fluid retention plus regular organ checks for liver, heart and blood counts. These are teaching toggles only.",
  ],
  simplified: "Brands and combination regimens, GIST and KIT detail, later generation kinase inhibitors after T315I, rash and GI bleed, stopping rules, pregnancy advice, drug interactions, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-leuk{--cc:var(--c-lymph)}
.im-dead{fill:#1a1030}
.im-lobe{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:1}
.im-lobe2{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:1}
.im-pocket{fill:#2b1b3d}
.im-wedge{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 50%,#000);stroke-width:1}
.im-gate{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.im-flash{fill:#ffd94a;stroke:#c22e1f;stroke-width:1}
.p-ima{--cc:var(--c-eos)}
.p-atp{--cc:#ffd94a}
.p-sig{--cc:var(--c-cyt)}
.im-puff{fill:var(--c-fl)}
.im-bag{fill:var(--c-fl)}
.im-spasm{fill:var(--c-eos)}
.im-livwash{fill:#b8a832}
.im-hrtwash{fill:var(--c-bad)}
.im-bone{fill:color-mix(in srgb,#e8e0d0 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.im-cav{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper))}
.im-mcell{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.5}
.im-capline{fill:var(--anatomy-strong);font-size:13px}
`,
});
