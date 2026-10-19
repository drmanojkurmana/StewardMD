/* Hydroxyurea as an animated, working scene: the drug plugs ribonucleotide reductase
 * in the tumour cell so deoxynucleotides run out and S stage stalls, while marrow,
 * skin, mouth and pregnancy show why each side effect happens, with blood checks
 * and skin care as protection. Fetal haemoglobin rise in sickle cell disease is shown too.
 *   node tools/figures/scenes/onc-hu.mjs [--print-model]
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
    { label: "hydroxyurea" },
    { label: "hydroxyurea with blood checks and skin care" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "hydroxyurea", "hydroxyurea with blood checks and skin care"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, pro = drug === 2 ? 1 : 0;
  const K = on ? a * (0.55 + 0.45 * a) : 0;
  const Ms = on ? (0.15 + 0.75 * a) * (pro ? 0.35 : 1) : 0;
  const Ul = on ? (0.2 + 0.7 * a) * (pro ? 0.4 : 1) : 0;
  const Sk = on ? (0.25 + 0.65 * a) * (pro ? 0.5 : 1) : 0;
  const Ca = on ? a * a * (pro ? 0.5 : 1) : 0;
  const Pg = on ? 0.6 + 0.2 * a : 0;
  const Hb = on ? 0.3 + 0.7 * a : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "shrinking", "dying"]), w(Ms, 0.3, 0.65, ["ok", "low", "very low"]), w(Sk, 0.35, 0.65, ["ok", "rough", "damaged"])];
  return { a, on, pro, K, Ms, Ul, Sk, Ca, Pg, Hb, words, readout: "tumour " + words[0] + " · marrow " + words[1] + " · skin " + words[2] };
}
const TESTS = [
  [0, 1, "tumour growing · marrow low · skin rough"],
  [1, 1, "tumour shrinking · marrow low · skin rough"],
  [1, 2, "tumour shrinking · marrow ok · skin ok"],
  [2, 1, "tumour dying · marrow very low · skin damaged"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="394" rx="18"/>
<rect class="oc-tox" x="474" y="44" width="472" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL RUNS OUT OF BUILDING BLOCKS</text>
<text class="sc-zone" x="494" y="68">WHERE THE HARM HAPPENS</text>
<path class="dr-beam" d="M470 52L470 430"/>
<text class="sc-lab" x="20" y="356">drug in</text>
<g id="tumSlot"></g><g id="orgSlot"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "hydroxyurea-mechanism-adverse-effects", fig: "Fig 1", title: "Hydroxyurea: tumour kill and side effects", W, H, body,
  label: "An animated figure. Hydroxyurea plugs the ribonucleotide reductase enzyme in a tumour cell, so deoxynucleotides run out and the cell stalls in S stage and dies, while fetal haemoglobin rises in sickle cell disease. Marrow fails the same way with big fragile red cells, skin and mouth break into ulcers with nail and pigment change, later skin cancers can appear, and the unborn child is harmed. Blood checks and skin care guard the counts and the skin. Gauges show tumour kill and each harm as the course advances.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, schedules or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-hu.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without hydroxyurea", withLabel: "With hydroxyurea, blood checks and skin care",
  extraCss: `.oc-tox{fill:color-mix(in srgb,var(--c-bad) 7%,var(--anatomy-paper))}.cl-tum{--cc:var(--c-mast)}
.oc-dna{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}.oc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1}
.oc-enz{fill:color-mix(in srgb,var(--c-plt) 45%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.2}
.oc-pock{fill:color-mix(in srgb,#000 45%,var(--anatomy-paper))}
.oc-plug{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1}
.oc-block{fill:none;stroke:var(--c-bad);stroke-width:2.5}
.p-dntp{--cc:var(--c-fl)}.p-hu{--cc:var(--c-good)}.p-hbf{--cc:var(--c-eos)}.p-bleb{--cc:var(--c-mast)}
.p-spk{--cc:var(--c-bad)}.p-care{fill:var(--c-fl)}
.oc-ulc{fill:color-mix(in srgb,var(--c-bad) 65%,#5a0d0d)}
.oc-pig{fill:color-mix(in srgb,#6b4a2a 70%,var(--anatomy-paper))}
.oc-mel{fill:color-mix(in srgb,#2a2033 80%,var(--c-bad));stroke:color-mix(in srgb,#2a2033 60%,#000);stroke-width:1.2}
.oc-nail{fill:color-mix(in srgb,#e8d9c8 70%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.oc-band{fill:color-mix(in srgb,#4a3a52 75%,#000)}
.oc-lips{fill:color-mix(in srgb,#c98a7a 60%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.2}
.oc-mouth{fill:color-mix(in srgb,#40181c 80%,#000)}
.oc-sore{fill:color-mix(in srgb,var(--c-bad) 70%,#fff)}
.oc-warn{fill:none;stroke:var(--c-bad);stroke-width:2.5;stroke-dasharray:7 5}
.oc-shield{fill:none;stroke:var(--c-good);stroke-width:2.5}
.oc-sbadge{fill:color-mix(in srgb,var(--c-plt) 55%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.2}
.oc-bone{fill:#e6dcc8;stroke:#8a7f6a;stroke-width:1.2}.oc-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper))}
.oc-macro{fill:color-mix(in srgb,var(--c-rbc) 45%,#fff);stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.oc-sick{fill:none;stroke:var(--c-rbc);stroke-width:3}
.oc-cap{fill:var(--anatomy-strong);font-size:13px}`,
  sourcesLis: [
    "<strong>How hydroxyurea works.</strong> Hydroxyurea blocks ribonucleotide reductase, the enzyme that turns ribonucleotides into deoxyribonucleotides along one shared pathway, so the deoxynucleotide pool runs out and DNA copying stalls in S stage. The stalled cell dies, which is how the drug kills tumour cells, and the same damage to DNA building blocks harms fast dividing normal cells. In sickle cell disease the drug also switches haemoglobin genes back toward fetal haemoglobin, which steadies red cells. This is standard teaching in pharmacology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Side effects shown.</strong> Myelosuppression with macrocytosis because marrow precursors cannot finish dividing without deoxynucleotides; skin and mouth ulcers plus nail banding and pigment change because skin and mucosa renew fast; secondary skin cancers as late lesions from long term change; and teratogenic harm because the unborn child is building every tissue from dividing cells. Blood count checks with pauses guard the marrow, and skin care with sun cover guards the skin. These are teaching toggles only.",
  ],
  simplified: "Other effects such as nausea and hair thinning, use in sickle cell disease and other blood disorders, combination regimens, monitoring blood tests, contraception advice, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
