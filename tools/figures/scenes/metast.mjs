/* Tumour metastasis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/metast.mjs [--print-model]
 * Static layout here; tumour cells, spread routes and gauges move in metast.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Furthest spread", a: [0, 1, 2], names: ["local", "nodal", "distant"], ticks: ["local", "nodal", "distant"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "surgery" },
    { label: "systemic therapy" },
    { label: "radiotherapy" },
  ],
  status: "Spread: {level} · {drug} ·",
  drugNames: ["no treatment", "surgery", "systemic therapy", "radiotherapy"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const invB = [0.5, 0.75, 0.95][level], lymphB = [0.03, 0.85, 0.9][level], ctcB = [0.04, 0.35, 0.92][level], distB = [0.02, 0.06, 0.88][level];
  const mult = [
    { p: 1, i: 1, l: 1, c: 1, d: 1 },
    { p: 0.07, i: 0.1, l: 0.45, c: 0.45, d: 0.95 },
    { p: 0.45, i: 0.5, l: 0.3, c: 0.12, d: 0.3 },
    { p: 0.35, i: 0.35, l: 0.85, c: 0.55, d: 1 },
  ][drug];
  const P = cl(0.9 * mult.p), I = cl(invB * mult.i), L = cl(lymphB * mult.l), C = cl(ctcB * mult.c), D = cl(distB * mult.d);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.2, 0.6, ["low", "reduced", "present"]), w(L, 0.2, 0.6, ["clear", "some", "involved"]), w(D, 0.15, 0.5, ["none", "seeded", "established"])];
  return { P, I, L, C, D, surg: drug === 1 ? 1 : 0, sys: drug === 2 ? 1 : 0, rad: drug === 3 ? 1 : 0, words, readout: "primary " + words[0] + " · nodes " + words[1] + " · distant " + words[2] };
}
const TESTS = [
  [2, 0, "primary present · nodes involved · distant established"],
  [2, 1, "primary low · nodes some · distant established"],
  [2, 2, "primary reduced · nodes some · distant seeded"],
  [0, 0, "primary present · nodes clear · distant none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">PRIMARY SITE</text>
<text class="sc-zone sc-dim" x="34" y="330">STROMA AND VESSEL</text>
<g id="tracks"></g>
<g id="organ"></g>
<g id="nodeg"></g>
<g id="vessel"></g>
<g id="tum"></g>
<g id="colony"></g>
<g id="parts"></g>
<g id="treat"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "tumour-metastasis", fig: "Fig 1", title: "Tumour metastasis: local to distant spread", W, H, body,
  label: "An animated primary tumour. Tumour cells push through the basement membrane, enter a blood vessel or a lymphatic channel, travel as circulating tumour cells, arrest in a distant capillary bed, leave the vessel and grow as a new colony in a distant organ. Gauges show the primary tumour, invasion, lymph node spread, circulating cells and the distant colony. Treatment choices are surgery, systemic therapy and radiotherapy.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "metast.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `body{--c-tum:#e07856;--c-norm:#8fb8d8;--c-organ:#c98a9a;--c-node:#7fc4a8;--c-lymv:#5ec1a0;--c-bmv:#e9b84a}
body[data-theme="light"]{--c-tum:#c4502e;--c-norm:#3a86b8;--c-organ:#b05f74;--c-node:#2f8f68;--c-lymv:#1f8f6c;--c-bmv:#b8860b}
.cl-tum{--cc:var(--c-tum)}.cl-norm{--cc:var(--c-norm)}.cl-nodec{--cc:var(--c-node)}
.mt-bm{stroke:var(--c-bmv);stroke-width:2.4;stroke-dasharray:7 4;stroke-linecap:round}
.mt-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 65%,#000);stroke-width:1.4}
.mt-lymph{fill:none;stroke:var(--c-lymv);stroke-width:7;stroke-linecap:round;opacity:.55}
.mt-lymph-in{fill:none;stroke:color-mix(in srgb,var(--c-lymv) 35%,var(--anatomy-paper));stroke-width:2;stroke-linecap:round}
.mt-node{fill:color-mix(in srgb,var(--c-node) 22%,var(--anatomy-paper));stroke:var(--c-node);stroke-width:1.6}
.mt-organ{fill:color-mix(in srgb,var(--c-organ) 26%,var(--anatomy-paper));stroke:var(--c-organ);stroke-width:1.6}
.mt-cap{fill:none;stroke:var(--c-organ);stroke-width:1.4;opacity:.7}
.mt-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.3;stroke-dasharray:4 3;marker-end:none}
.p-ctc{--cc:var(--c-tum)}.p-lymphc{--cc:var(--c-tum)}.p-drug{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 50%,#000);stroke-width:.5}
.mt-beam{stroke:var(--c-bmv);stroke-width:2;stroke-linecap:round;opacity:.85}
.mt-cut{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-dasharray:5 4}
.dr-g-fill.g-tum{fill:var(--c-tum)}.dr-g-fill.g-node{fill:var(--c-node)}.dr-g-fill.g-dist{fill:var(--c-organ)}`,
  sourcesLis: [
    "<strong>How metastasis happens.</strong> A primary tumour grows and its cells change so they can detach, digest and push through the basement membrane and surrounding tissue (local invasion). Cells that enter a lymphatic channel travel to nearby lymph nodes (lymphatic spread). Cells that enter a blood vessel (intravasation) become circulating tumour cells; most die, but some survive, arrest in a small vessel of a distant organ, leave the vessel (extravasation) and, if the organ tissue suits them, grow into a new colony (colonisation). Which organs are colonised depends on blood flow patterns and on fit between tumour cell and organ tissue, often called seed and soil. This is standard teaching in pathology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Surgery removes the primary tumour and nearby nodes but does not remove distant colonies that are already established. Systemic therapy travels in the blood and can reach circulating cells, nodes and distant colonies. Radiotherapy is aimed at the primary site, so it shrinks the local tumour but does not treat distant colonies. These are teaching toggles only.",
  ],
  simplified: "Angiogenesis, immune evasion, dormancy, pre-metastatic niches, organ specific patterns for each cancer, staging scans, and all doses and regimens are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
