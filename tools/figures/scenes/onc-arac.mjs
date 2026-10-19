/* Cytarabine as an animated, working scene: ara-CTP jams tumour DNA polymerase in
 * S phase, while marrow, brain, eye, skin and mouth show the side effects.
 *   node tools/figures/scenes/onc-arac.mjs [--print-model]
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
    { label: "cytarabine" },
    { label: "cytarabine with eye drops and steroid cover" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "cytarabine", "cytarabine with eye drops and steroid cover"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, pro = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? a * (0.55 + 0.45 * a) : 0;
  const Ms = on ? 0.15 + 0.75 * a : 0;
  const Cb = on ? a * a : 0;
  const Sy = on ? (pro ? 0.12 : 1) * (0.3 + 0.6 * a) : 0;
  const Ey = on ? (pro ? 0.1 : 1) * (0.35 + 0.55 * a) : 0;
  const Mk = on ? 0.2 + 0.6 * a : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "shrinking", "dying"]), w(Ey, 0.25, 0.6, ["calm", "sore", "streaming"]), w(Ms, 0.3, 0.65, ["ok", "low", "very low"])];
  return { a, on, pro, K, Ms, Cb, Sy, Ey, Mk, words, readout: "tumour " + words[0] + " · eyes " + words[1] + " · marrow " + words[2] };
}
const TESTS = [
  [0, 1, "tumour growing · eyes sore · marrow low"],
  [1, 1, "tumour shrinking · eyes streaming · marrow low"],
  [1, 2, "tumour shrinking · eyes calm · marrow low"],
  [2, 1, "tumour dying · eyes streaming · marrow very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="394" rx="18"/>
<rect class="oc-tox" x="474" y="44" width="472" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL IN S PHASE</text>
<text class="sc-zone" x="494" y="68">WHERE THE HARM HAPPENS</text>
<path class="dr-beam" d="M470 52L470 430"/>
<g id="tumSlot"></g><g id="orgSlot"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cytarabine-mechanism-adverse-effects", fig: "Fig 1", title: "Cytarabine: tumour kill and side effects", W, H, body,
  label: "An animated figure. Cytarabine enters a tumour cell and is converted to ara-CTP, a fake block that competes with dCTP and jams DNA polymerase, so copying stalls in S phase and the cell dies. The same drug lowers marrow blood counts, makes movement unsteady through the cerebellum, causes fever with rash and aches, burns the eyes, and opens mouth sores and a hand and foot rash. Steroid eye drops and steroid cover guard the eyes and the syndrome. Gauges show tumour kill and each harm as the course advances.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, schedules or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-arac.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without cytarabine", withLabel: "With cytarabine and protective cover",
  extraCss: `.oc-tox{fill:color-mix(in srgb,var(--c-bad) 7%,var(--anatomy-paper))}.cl-tum{--cc:var(--c-mast)}.cl-blast{--cc:#7e5fc0}
.oc-dna{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}.oc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1}
.oc-pol{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:1}.oc-pol-in{fill:color-mix(in srgb,var(--c-th2) 45%,#fff)}
.oc-strand{fill:none;stroke:var(--c-good);stroke-width:3;stroke-linecap:round}.oc-jam{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.oc-kin{fill:none;stroke:var(--c-plt);stroke-width:1.4}
.p-ara{--cc:var(--c-plt)}.p-ctp{--cc:#ff9a3d}.p-dct{--cc:var(--c-good)}.p-sys{--cc:#ff9a3d}.p-bleb{--cc:var(--c-mast)}
.p-spark{fill:none;stroke:var(--c-bad);stroke-width:1.4}.p-tear{fill:var(--c-fl)}.p-sdrop{fill:var(--c-good)}
.oc-bone{fill:#e6dcc8;stroke:#8a7f6a;stroke-width:1.2}.oc-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper))}
.oc-cereb{fill:var(--c-bad)}.oc-eye-red{fill:var(--c-bad)}.oc-rash{fill:var(--c-bad)}
.oc-heat{fill:none;stroke:var(--c-eos);stroke-width:2;stroke-linecap:round}.oc-ache{fill:none;stroke:var(--anatomy-hi);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.oc-lip{fill:#d98a94;stroke:#7a3b44;stroke-width:1}.oc-lipred{fill:var(--c-bad)}.oc-sore{fill:var(--c-bad)}.oc-mouth{fill:#5a1f28}
.oc-drop{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}.oc-droptip{fill:var(--c-good)}
.oc-cap{fill:var(--anatomy-strong);font-size:13px}`,
  sourcesLis: [
    "<strong>How cytarabine works.</strong> Cytarabine is a pyrimidine analogue that enters cells and is converted stepwise to ara-CTP, which competes with the natural block dCTP and jams DNA polymerase, so DNA copying stalls in S phase and the cell dies. This is standard teaching in pharmacology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Side effects shown.</strong> Marrow suppression as blood counts fall; cerebellar toxicity with high exposure causing unsteady movement; cytarabine syndrome with fever, rash and muscle aches; chemical conjunctivitis eased by steroid eye drops; mucositis with mouth sores; and hand and foot rash. These are teaching toggles only.",
  ],
  simplified: "Other toxicities such as nausea, liver changes, lung injury and rare severe gut harm, combination regimens, infusion schedules, the exact timing of count nadirs and recovery, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
