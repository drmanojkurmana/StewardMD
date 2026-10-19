/* Olaparib as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-ola.mjs [--print-model]
 * Static layout here; trapped PARP, the copying fork, marrow, clot, gut, muscle and gauges move in onc-ola.page.js. Qualitative: no doses, no numbers. */
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
    { label: "olaparib" },
    { label: "olaparib with transfusion and nausea cover" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "olaparib", "olaparib with support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const lookup = { none: 0, ola: 1, sup: 2 };
  const key = drug === lookup.none ? "none" : drug === lookup.sup ? "sup" : "ola";
  const table = {
    none: { on: 0, sup: 0 },
    ola: { on: 1, sup: 0 },
    sup: { on: 1, sup: 1 },
  };
  const on = table[key].on, sup = table[key].sup;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.3 + 0.65 * a) : 0.04;
  const Mr = on ? cl(0.35 + 0.55 * a) : 0.05;
  const An = on ? (sup ? cl(0.2 + 0.3 * a) : Mr) : 0.05;
  const Na = on ? (sup ? 0.1 : cl(0.35 + 0.5 * a)) : 0.04;
  const Fa = on ? cl(0.25 + 0.5 * a - sup * 0.25) : 0.05;
  const Th = on ? cl(0.12 + 0.5 * a) : 0.03;
  const Md = on ? cl(a * a * 0.85) : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(An, 0.3, 0.65, ["ok", "low", "very low"]), w(Na, 0.3, 0.6, ["ok", "sick", "very sick"])];
  return { a, on, sup, K, Mr, An, Na, Fa, Th, Md, words, readout: "tumour " + words[0] + " · red cells " + words[1] + " · nausea " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · red cells ok · nausea ok"],
  [0, 1, "tumour shrinking · red cells low · nausea sick"],
  [2, 1, "tumour dying · red cells very low · nausea very sick"],
  [2, 2, "tumour dying · red cells low · nausea ok"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="ol-zone" x="34" y="68">TUMOUR CELL, BRCA MUTANT</text>
<text class="ol-zone" x="504" y="68">SIDE EFFECTS</text>
<text class="ol-note" x="34" y="420">no homologous recombination, so the doubled break cannot be fixed</text>
<g id="tum"></g>
<g id="ola"></g>
<g id="frag"></g>
<g id="mar"></g>
<g id="blast"></g>
<g id="vesSlot"></g><g id="vesFx"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="musSlot"></g><g id="musFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "olaparib-mechanism-adverse-effects", fig: "Fig 1", title: "Olaparib: tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and toxicity organs. Olaparib traps PARP on tumour DNA so single strand breaks persist; the copying fork turns them into double strand breaks that a BRCA mutant cell cannot fix, and the cell dies. Marrow, vein clot, gut and muscle show anaemia, thrombosis, nausea and fatigue, with rare MDS or AML late. Transfusion and nausea cover protect red cells and sickness. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-ola.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With support",
  sourcesLis: [
    "<strong>How olaparib works.</strong> Olaparib (Lynparza) is a PARP inhibitor. It traps PARP on DNA at single strand breaks so the breaks persist; when a replication fork meets the trapped protein the break becomes a double strand break. Cells without homologous recombination, such as BRCA mutant tumour cells, cannot repair double strand breaks, so the tumour cell dies (synthetic lethality). Normal dividing tissues are harmed for the same reason the tumour is: marrow precursors fail so counts fall, the gut lining is irritated so nausea follows, and rare therapy related MDS or AML and venous thrombosis are seen. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Support shown.</strong> Blood transfusion covers anaemia and antiemetics cover nausea while marrow suppression, fatigue, clot risk and rare MDS or AML continue. These are teaching toggles only.",
  ],
  simplified: "Other PARP inhibitors and their differences, homologous recombination deficiency testing beyond BRCA, resistance, pneumonitis, monitoring blood counts, dose holds and reductions, combination regimens, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ol-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.ol-cap{fill:var(--anatomy-strong);font-size:13px}
.ol-note{fill:var(--anatomy-strong);font-size:11px;pointer-events:none}
.ol-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.ol-rung{fill:none;stroke:var(--c-cyt);stroke-width:1.2}
.ol-wedge{--cc:var(--c-cyt)}
.ol-fork{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.8}
.ol-parp .ol-pb{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.8}
.ol-parp .ol-pl{fill:none;stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:2.4}
.ol-parp.trapped .ol-pb{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.ol-parp.trapped .ol-pl{stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.ol-break{fill:none;stroke:#ffd24a;stroke-width:2.2;stroke-linecap:round}
.ol-deb{--cc:var(--c-graft)}
.ol-bone{fill:color-mix(in srgb,#e6d7b8 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ol-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,#3a0e14)}
.ol-mar{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.7}
.ol-blast{fill:#5b3a6e;stroke:color-mix(in srgb,#5b3a6e 55%,#000);stroke-width:.8}
.ol-drip{--cc:var(--c-rbc)}
.ol-plt{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.7}
.ol-fib{fill:none;stroke:var(--c-rbc);stroke-width:1;opacity:.85}
.ol-flow{--cc:var(--c-rbc)}
.ol-gut{fill:var(--c-bad)}
.ol-quease{--cc:var(--c-eos)}
.ol-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.ol-veil{fill:#8a8f98;stroke:none}
.ol-spark{--cc:#ffd24a}
`,
});
