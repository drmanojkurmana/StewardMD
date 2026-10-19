/* Methotrexate as an animated, working scene: a folate analogue plugs DHFR in the
 * tumour cell so THF runs out and DNA copying stops, while marrow, gut, liver, lung
 * and kidney show why each side effect happens, with leucovorin and fluids as rescue.
 *   node tools/figures/scenes/onc-mtx.mjs [--print-model]
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
    { label: "methotrexate" },
    { label: "methotrexate with leucovorin and fluids" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "methotrexate", "methotrexate with leucovorin and fluids"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, pro = drug === 2 ? 1 : 0;
  const K = on ? a * (0.55 + 0.45 * a) : 0;
  const Ms = on ? (0.15 + 0.75 * a) * (pro ? 0.3 : 1) : 0;
  const Gu = on ? (0.2 + 0.7 * a) * (pro ? 0.3 : 1) : 0;
  const Lv = on ? 0.6 * a * (pro ? 0.6 : 1) : 0;
  const Lu = on ? 0.55 * a * (pro ? 0.7 : 1) : 0;
  const Kd = on ? a * (pro ? 0.12 : 1) : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "shrinking", "dying"]), w(Ms, 0.3, 0.65, ["ok", "low", "very low"]), w(Gu, 0.3, 0.65, ["ok", "sore", "raw"])];
  return { a, on, pro, K, Ms, Gu, Lv, Lu, Kd, words, readout: "tumour " + words[0] + " · marrow " + words[1] + " · gut " + words[2] };
}
const TESTS = [
  [0, 1, "tumour growing · marrow low · gut sore"],
  [1, 1, "tumour shrinking · marrow low · gut sore"],
  [1, 2, "tumour shrinking · marrow ok · gut ok"],
  [2, 1, "tumour dying · marrow very low · gut raw"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="394" rx="18"/>
<rect class="oc-tox" x="474" y="44" width="472" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL RUNS OUT OF FOLATE</text>
<text class="sc-zone" x="494" y="68">WHERE THE HARM HAPPENS</text>
<path class="dr-beam" d="M470 52L470 430"/>
<text class="sc-lab" x="20" y="356">drug in</text>
<text class="sc-lab" x="24" y="410">rescue in</text>
<g id="tumSlot"></g><g id="orgSlot"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "methotrexate-mechanism-adverse-effects", fig: "Fig 1", title: "Methotrexate: tumour kill and side effects", W, H, body,
  label: "An animated figure. Methotrexate plugs the DHFR enzyme in a tumour cell, so THF runs out and the cell cannot make purines or thymidine to copy its DNA, and it dies. Fast dividing marrow and gut lining fail the same way, crystals block the kidney, and the liver and lung are harmed. Leucovorin gives ready THF past the block and fluids flush the kidney. Gauges show tumour kill and each harm as the course advances.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, schedules or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-mtx.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without methotrexate", withLabel: "With methotrexate, leucovorin and fluids",
  extraCss: `.oc-tox{fill:color-mix(in srgb,var(--c-bad) 7%,var(--anatomy-paper))}.cl-tum{--cc:var(--c-mast)}
.oc-dna{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}.oc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1}
.oc-enz{fill:color-mix(in srgb,var(--c-plt) 45%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.2}
.oc-pock{fill:color-mix(in srgb,#000 45%,var(--anatomy-paper))}
.oc-plug{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1}
.oc-block{fill:none;stroke:var(--c-bad);stroke-width:2.5}
.p-fol{--cc:#e8b93c}.p-thf{--cc:var(--c-fl)}.p-mtx{--cc:var(--c-good)}.p-bleb{--cc:var(--c-mast)}
.p-leu{fill:none;stroke:var(--c-good);stroke-width:1.6}
.p-crys{fill:#cfe3ef;stroke:#7fa3b8;stroke-width:.7}.p-flush{fill:var(--c-fl)}
.p-spk{--cc:var(--c-bad)}.p-crk{--cc:var(--c-cyt)}
.oc-sore{fill:color-mix(in srgb,var(--c-bad) 65%,#5a0d0d)}
.oc-haze{fill:color-mix(in srgb,var(--c-cyt) 45%,var(--anatomy-paper))}
.oc-liv{fill:color-mix(in srgb,var(--c-eos) 55%,var(--anatomy-paper))}.oc-fat{fill:var(--c-eos)}
.oc-bone{fill:#e6dcc8;stroke:#8a7f6a;stroke-width:1.2}.oc-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper))}
.oc-cap{fill:var(--anatomy-strong);font-size:13px}`,
  sourcesLis: [
    "<strong>How methotrexate works.</strong> Methotrexate is a folate analogue that binds dihydrofolate reductase (DHFR), so tetrahydrofolate falls and the cell cannot make purines or thymidylate to copy DNA. Tumour cells die, and fast-dividing normal tissues suffer the same way. Leucovorin (folinic acid) gives ready reduced folate past the block, and fluids with alkali urine flush kidney crystals. This is standard teaching in pharmacology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Side effects shown.</strong> Mucositis and myelosuppression from failed renewal of fast-dividing cells; hepatotoxicity over many courses; pneumonitis as an inflammatory lung reaction; and nephrotoxicity from drug crystals in acid urine, eased by hydration and alkalinisation. These are teaching toggles only.",
  ],
  simplified: "Other effects such as nausea, hair loss and teratogenicity, combination regimens, the timing of leucovorin rescue after high doses, monitoring blood tests, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
