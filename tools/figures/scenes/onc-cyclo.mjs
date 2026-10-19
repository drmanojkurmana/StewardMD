/* Cyclophosphamide as an animated, working scene: liver CYP activation to mustard plus
 * acrolein, tumour DNA cross-links, and bladder, marrow, kidney water, gonad and late harms.
 *   node tools/figures/scenes/onc-cyclo.mjs [--print-model]
 * Original drawing built from the mechanism (Anima styling, Anatomy page shell). Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.25, 0.6, 1], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "cyclophosphamide" },
    { label: "cyclophosphamide with mesna and fluids" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "cyclophosphamide", "cyclophosphamide with mesna and fluids"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, pro = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? a * (0.55 + 0.45 * a) : 0;
  const Cy = on ? a * (pro ? 0.15 : 1) : 0;
  const Ms = on ? 0.15 + 0.75 * a : 0;
  const Wm = on ? 0.7 * a : 0;
  const F = on ? 0.2 + 0.7 * a : 0;
  const Sc = on ? 0.55 * a * a : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "shrinking", "dying"]), w(Cy, 0.2, 0.55, ["ok", "sore", "bleeding"]), w(Ms, 0.3, 0.65, ["ok", "low", "very low"])];
  return { a, on, pro, K, Cy, Ms, Wm, F, Sc, words, readout: "tumour " + words[0] + " · bladder " + words[1] + " · marrow " + words[2] };
}
const TESTS = [
  [0, 1, "tumour growing · bladder sore · marrow low"],
  [1, 1, "tumour shrinking · bladder bleeding · marrow low"],
  [1, 2, "tumour shrinking · bladder ok · marrow low"],
  [2, 1, "tumour dying · bladder bleeding · marrow very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="394" rx="18"/>
<rect class="oc-tox" x="474" y="44" width="472" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">LIVER SWITCHES IT ON, TUMOUR DIES</text>
<text class="sc-zone" x="494" y="68">WHERE THE HARM HAPPENS</text>
<path class="dr-beam" d="M470 52L470 430"/>
<text class="sc-lab" x="20" y="302">prodrug in</text>
<g id="liverSlot"></g><g id="tumSlot"></g><g id="orgSlot"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cyclophosphamide-mechanism-adverse-effects", fig: "Fig 1", title: "Cyclophosphamide: tumour kill and side effects", W, H, body,
  label: "An animated figure. In the liver, CYP enzymes split cyclophosphamide into active mustard and toxic acrolein. Mustard enters a tumour cell and cross-links its DNA so the cell dies. Acrolein travels in urine to the bladder and makes it bleed, unless mesna with fluids guards it. Mustard also lowers marrow blood counts, makes the kidney hold water in SIADH, harms the gonads, and late on can seed a second cancer. Gauges show tumour kill and each harm as the course advances.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, schedules or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-cyclo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without cyclophosphamide", withLabel: "With cyclophosphamide and bladder protection",
  extraCss: `.oc-tox{fill:color-mix(in srgb,var(--c-bad) 7%,var(--anatomy-paper))}.cl-tum{--cc:var(--c-mast)}.cl-blast{--cc:#7e5fc0}
.oc-dna{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}.oc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1}.oc-xl{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.p-must{--cc:var(--c-cyt)}.p-acro{--cc:#ff9a3d}.p-mesna{fill:none;stroke:var(--c-good);stroke-width:1.6}.p-prod{--cc:var(--c-plt)}.p-bleb{--cc:var(--c-mast)}.p-fol{--cc:var(--c-plt)}
.p-blood{fill:var(--c-bad)}.p-flush{fill:var(--c-fl)}
.oc-urine{fill:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper))}.oc-bloodpool{fill:color-mix(in srgb,var(--c-bad) 72%,#3d0a0a)}
.oc-bone{fill:#e6dcc8;stroke:#8a7f6a;stroke-width:1.2}.oc-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper))}
.oc-ov{fill:#8b93a0}.oc-kov{fill:var(--c-fl)}.oc-cap{fill:var(--anatomy-strong);font-size:13px}`,
  sourcesLis: [
    "<strong>How cyclophosphamide works.</strong> Cyclophosphamide is a prodrug switched on by liver CYP enzymes into phosphoramide mustard, which cross-links the two strands of DNA so cells cannot copy them, and acrolein, which is toxic. Tumour cells die, and fast-dividing normal tissues suffer too. This is standard teaching in pharmacology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Side effects shown.</strong> Acrolein passing in urine causes haemorrhagic cystitis, prevented by mesna (which binds acrolein) plus fluids; marrow suppression as blood counts fall; SIADH with the kidney holding water; infertility from gonad harm; and, late on, second cancers from mutated healthy DNA. These are teaching toggles only.",
  ],
  simplified: "Other toxicities such as nausea, hair loss, immune suppression and bladder effects beyond bleeding, combination regimens, the exact timing of count nadirs and recovery, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
