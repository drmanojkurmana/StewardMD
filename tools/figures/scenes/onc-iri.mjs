/* Irinotecan as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-iri.mjs [--print-model]
 * Static layout and model here; prodrug activation, the topoisomerase trap, gut, marrow and gauges move in onc-iri.page.js.
 * Qualitative: no doses, no schedules, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.25, 0.6, 1], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "irinotecan" },
    { label: "irinotecan with atropine" },
    { label: "irinotecan with atropine and loperamide" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "irinotecan", "irinotecan with atropine", "irinotecan with atropine and loperamide"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const on = drug > 0 ? 1 : 0, atr = drug >= 2 ? 1 : 0, lop = drug >= 3 ? 1 : 0;
  const K = on ? a * (0.55 + 0.45 * a) : 0;
  const T = on ? 0.85 : 0.03;
  const E = on ? (0.55 + 0.3 * a) * (atr ? 0.18 : 1) : 0.02;
  const Ld = on ? a * (lop ? 0.25 : 1) : 0;
  const N = on ? 0.12 + 0.7 * a : 0.02;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "shrinking", "dying"]), w(E, 0.25, 0.6, ["settled", "cramping", "griping"]), w(Ld, 0.25, 0.6, ["ok", "sore", "raw"]), w(N, 0.3, 0.6, ["steady", "falling", "very low"])];
  return { a, on, atr, lop, K, T, E, Ld, N, words, readout: "tumour " + words[0] + " · cramps " + words[1] + " · gut " + words[2] + " · neutrophils " + words[3] };
}
const TESTS = [
  [0, 0, "tumour growing · cramps settled · gut ok · neutrophils steady"],
  [2, 1, "tumour dying · cramps griping · gut raw · neutrophils very low"],
  [2, 2, "tumour dying · cramps settled · gut raw · neutrophils very low"],
  [2, 3, "tumour dying · cramps settled · gut sore · neutrophils very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="396" rx="18"/>
<rect class="sc-tissue" x="476" y="44" width="470" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="496" y="68">WHERE HARM HAPPENS</text>
<g id="tumSlot"></g><g id="dnaSlot"></g>
<g id="livSlot"></g><g id="bowSlot"></g><g id="marSlot"></g>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "irinotecan-mechanism-adverse-effects", fig: "Fig 1", title: "Irinotecan: how it kills and why it harms", W, H, body,
  label: "An animated tumour cell and the organs irinotecan harms. Carboxylesterase switches the prodrug irinotecan on to SN-38, which traps topoisomerase I on DNA so copying breaks the DNA and the cell dies. The same courses cause early cholinergic cramps, late diarrhoea when gut bacteria reactivate tagged SN-38, and neutropenia from marrow harm, worse when UGT1A1 is weak. Gauges show tumour kill, the topoisomerase trap, early cramps, late gut harm and neutrophils. Treatment choices add atropine, then loperamide.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-iri.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With gut rescue",
  sourcesLis: [
    "<strong>How irinotecan kills tumour cells.</strong> Irinotecan is a prodrug switched on by carboxylesterase to SN-38. SN-38 wedges into the topoisomerase I lock on DNA and stops it letting go, so a copying fork collides with the stuck complex, the DNA breaks and the cell dies. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Early diarrhoea with cramps comes from irinotecan blocking acetylcholinesterase, leaving excess acetylcholine to grip the gut; atropine blocks that signal. Later, the liver tags SN-38 with glucuronide through UGT1A1 for removal in bile, but gut bacteria cut the tag off, freeing SN-38 to burn the lining; loperamide slows the resulting diarrhoea. Dividing marrow cells die alongside the tumour, so neutrophils fall. People with weak UGT1A1 clear SN-38 slowly and suffer worse harm. These are teaching toggles only.",
  ],
  simplified: "Other harms (hair loss, sickness, liver test changes), the exact timing of each diarrhoea and of the neutrophil low point, dose changes for weak UGT1A1, combination regimens, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:var(--c-mast)}.cl-nuc{--cc:var(--c-mac)}
.oc-dna{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.oc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1}
.oc-topo{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:1}
.oc-wedge{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1}
.oc-fork{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.oc-brk{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.oc-bleb{fill:color-mix(in srgb,var(--c-mast) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:.9}
.oc-ce{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:1}
.oi-tag{fill:var(--anatomy-paper);font-size:10px}
.oc-bone{fill:color-mix(in srgb,var(--c-graft) 30%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.2}
.oc-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:1}
.oc-bact{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.8}
.oc-dmg{fill:color-mix(in srgb,var(--c-bad) 45%,transparent);stroke:none}
.oc-xc{fill:var(--anatomy-paper);stroke:var(--c-good);stroke-width:1.6}.oc-xp{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.oc-churn{fill:none;stroke:var(--c-graft);stroke-width:2;stroke-linecap:round}
.oc-cap{fill:var(--anatomy-strong);font-size:12px}
.p-iri{--cc:#ffd24a}.p-sn{--cc:var(--c-bad)}.p-gl{--cc:var(--c-good)}.p-ach{--cc:var(--c-neut)}.p-mot{--cc:var(--c-graft)}
.p-lop{fill:none;stroke:var(--c-good);stroke-width:1.6}
`,
});
