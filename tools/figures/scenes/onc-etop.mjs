/* Etoposide as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-etop.mjs [--print-model]
 * Static layout here; tumour kill, marrow, hair, gut, pressure and gauges move in onc-etop.page.js. Qualitative: no doses, no numbers. */
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
    { label: "etoposide" },
    { label: "etoposide as a slow infusion (protects pressure)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "etoposide", "etoposide as a slow infusion"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const lookup = { none: 0, etop: 1, slow: 2 };
  const key = drug === lookup.none ? "none" : drug === lookup.slow ? "slow" : "etop";
  const table = {
    none: { on: 0, slow: 0 },
    etop: { on: 1, slow: 0 },
    slow: { on: 1, slow: 1 },
  };
  const on = table[key].on, slow = table[key].slow;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.3 + 0.65 * a) : 0.04;
  const Mr = on ? cl(0.3 + 0.55 * a) : 0.05;
  const Ha = on ? cl(0.35 + 0.55 * a) : 0;
  const Na = on ? cl(0.3 + 0.5 * a) : 0.04;
  const Hy = on ? (slow ? 0.08 : cl(0.45 + 0.35 * a)) : 0.02;
  const Lk = on ? cl(a * a * 0.9) : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(Mr, 0.3, 0.65, ["ok", "low", "very low"]), w(Hy, 0.25, 0.6, ["ok", "dipping", "low"])];
  return { a, on, slow, K, Mr, Ha, Na, Hy, Lk, words, readout: "tumour " + words[0] + " · marrow " + words[1] + " · pressure " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · marrow ok · pressure ok"],
  [0, 1, "tumour shrinking · marrow low · pressure dipping"],
  [2, 1, "tumour dying · marrow very low · pressure low"],
  [2, 2, "tumour dying · marrow very low · pressure ok"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="et-zone" x="34" y="68">TUMOUR CELL</text>
<text class="et-zone" x="504" y="68">SIDE EFFECTS</text>
<text class="et-note" x="34" y="420">acts in S and G2, when DNA is copied</text>
<path class="et-line" d="M805 258L805 292"/>
<g id="tum"></g>
<g id="eto"></g>
<g id="frag"></g>
<g id="mar"></g>
<g id="blast"></g>
<g id="skinSlot"></g><g id="hairG"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="vesSlot"></g><g id="vesFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "etoposide-mechanism-adverse-effects", fig: "Fig 1", title: "Etoposide: tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and toxicity organs. Etoposide traps topoisomerase II on tumour DNA so the cut strands cannot rejoin, which leaves double strand breaks in S and G2 and kills the cell. Marrow, hair, gut, blood pressure and a rare second leukaemia show the side effects. A slow infusion protects pressure. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-etop.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With slow infusion",
  sourcesLis: [
    "<strong>How etoposide works.</strong> Etoposide is a topoisomerase II poison. It stabilises the cleavable complex that topoisomerase II forms with DNA, so the enzyme cannot religate the strands it has cut; the persisting double strand breaks kill cells passing through S and G2. Rapidly dividing normal tissues (marrow, hair matrix, gut lining) are harmed for the same reason the tumour is; rapid infusion can drop blood pressure, and a rare therapy related leukaemia with 11q23 MLL rearrangement follows the same topoisomerase II damage in marrow stem cells. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protection shown.</strong> Giving etoposide as a slow infusion lowers the infusion related fall in blood pressure; marrow, hair, gut and second leukaemia effects continue. This is a teaching toggle only.",
  ],
  simplified: "Other epipodophyllotoxins and their differences, hypersensitivity, extravasation, infertility, monitoring tests, dose adjustment, scheduling, combination regimens, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.et-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.et-cap{fill:var(--anatomy-strong);font-size:13px}
.et-note{fill:var(--anatomy-strong);font-size:11px;pointer-events:none}
.et-line{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4}
.et-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.et-rung{fill:none;stroke:var(--c-cyt);stroke-width:1.2}
.et-wedge{--cc:var(--c-bad)}
.et-topo .et-tb{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.8}
.et-topo .et-tl{fill:none;stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:2.4}
.et-topo.trapped .et-tb{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.et-topo.trapped .et-tl{stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.et-break{fill:none;stroke:#ffd24a;stroke-width:2.2;stroke-linecap:round}
.et-deb{--cc:var(--c-graft)}
.et-bone{fill:color-mix(in srgb,#e6d7b8 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.et-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,#3a0e14)}
.et-mar{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.7}
.et-blast{fill:#5b3a6e;stroke:color-mix(in srgb,#5b3a6e 55%,#000);stroke-width:.8}
.et-gut{fill:var(--c-bad)}
.et-quease{--cc:var(--c-eos)}
.et-hair{fill:#4a3a28;stroke:none}
.et-dil{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:6 4}
.et-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.et-flow{--cc:var(--c-rbc)}
.et-drip{--cc:var(--c-cyt2)}
.et-hist{--cc:#ff9a3d}
`,
});
