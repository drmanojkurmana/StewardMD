/* Cisplatin as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-cis.mjs [--print-model]
 * Static layout and model here; tumour DNA, toxic organs and gauges move in onc-cis.page.js.
 * Qualitative: no doses, no schedules, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.3, 0.65, 1], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "cisplatin" },
    { label: "cisplatin with hydration and magnesium" },
    { label: "cisplatin with hydration, magnesium and antiemetics" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "cisplatin", "cisplatin with hydration and magnesium", "cisplatin with hydration, magnesium and antiemetics"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, hyd = drug >= 2 ? 1 : 0, aem = drug >= 3 ? 1 : 0;
  const K = on ? cl(0.15 + 0.85 * a) : 0.02;
  const Kd = on ? cl(a * 0.9 * (hyd ? 0.35 : 1)) : 0.02;
  const Ot = on ? cl(0.1 + 0.8 * a) : 0.02;
  const Nr = on ? cl(0.08 + 0.7 * a) : 0.02;
  const Na = on ? cl((0.6 + 0.4 * a) * (aem ? 0.22 : 1)) : 0.03;
  const Mg = on ? cl(1 - a * (hyd ? 0.12 : 0.75)) : 0.95;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "slowing", "dying"]), w(Kd, 0.25, 0.6, ["coping", "strained", "failing"]), w(Na, 0.3, 0.6, ["settled", "queasy", "vomiting"])];
  return { a, on, hyd, aem, K, Kd, Ot, Nr, Na, Mg, words, readout: "tumour " + words[0] + " · kidneys " + words[1] + " · sickness " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · kidneys coping · sickness settled"],
  [2, 1, "tumour dying · kidneys failing · sickness vomiting"],
  [2, 2, "tumour dying · kidneys strained · sickness vomiting"],
  [2, 3, "tumour dying · kidneys strained · sickness settled"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="396" rx="18"/>
<rect class="sc-tissue" x="476" y="44" width="470" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="496" y="68">WHERE HARM HAPPENS</text>
<g id="tum"></g><g id="dna"></g>
<g id="kidSlot"></g><g id="earSlot"></g><g id="nerve"></g><g id="gutSlot"></g>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cisplatin-mechanism-adverse-effects", fig: "Fig 1", title: "Cisplatin: how it kills and why it harms", W, H, body,
  label: "An animated tumour cell and the organs cisplatin harms. Cisplatin enters the tumour cell, binds DNA with intrastrand cross-links, stalls replication and triggers apoptosis. The same courses injure kidney tubules through OCT2 uptake and radicals, cochlear hair cells, sensory nerves and the gut sickness pathway, and waste magnesium. Gauges show tumour kill, kidney injury, hearing loss, neuropathy, nausea and magnesium. Treatment choices add hydration with magnesium, then antiemetics.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-cis.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With protection",
  sourcesLis: [
    "<strong>How cisplatin kills tumour cells.</strong> Inside the cell cisplatin loses its chloride groups and binds DNA, linking two neighbouring bases on the same strand. The bend stalls replication and the cell dies by apoptosis. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Kidney tubule cells pull cisplatin in through the OCT2 transporter, where it makes radicals; hydration flushes the tubules and magnesium replaces what the kidney wastes. Hair cells of the inner ear, sensory nerves, and the gut serotonin plus brain substance P sickness pathway are injured in the same courses. Antiemetics that block 5-HT3 and NK1 calm vomiting. These are teaching toggles only.",
  ],
  simplified: "Other harms (marrow suppression, allergy, vein irritation), monitoring (hearing tests, kidney checks, magnesium checks), exact schedules, other platinum drugs, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:var(--c-cyt)}.cl-nuc{--cc:var(--c-mac)}
.oc-dna{fill:none;stroke:var(--anatomy-strong);stroke-width:2.2;stroke-linecap:round}
.oc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1}
.oc-x{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.oc-fork{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.oc-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.oc-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.oc-bleb{fill:color-mix(in srgb,var(--c-cyt) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.9}
.oc-dmg{fill:color-mix(in srgb,var(--c-bad) 45%,transparent);stroke:none}
.oc-oct{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.7}
.oc-axon{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1.1}
.oc-axonbad{fill:color-mix(in srgb,var(--c-bad) 60%,transparent);stroke:none}
.oc-myel{fill:color-mix(in srgb,var(--c-plt) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.oc-hair{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8}
.oc-hairbad{fill:color-mix(in srgb,var(--c-bad) 55%,var(--c-neut));stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.oc-cap{fill:var(--anatomy-strong);font-size:12px}
.p-cis{--cc:#9fb4c8}.p-rad{--cc:var(--c-bad)}.p-hyd{--cc:var(--c-fl)}.p-mg{--cc:var(--c-good)}.p-ser{--cc:var(--c-eos)}.p-trn{--cc:var(--c-cyt2)}
`,
});
