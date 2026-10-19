/* Arsenic trioxide in acute promyelocytic leukaemia as an animated, working scene
 * (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-ato.mjs [--print-model]
 * Static layout here; fusion destruction, toxic organs and gauges move in onc-ato.page.js.
 * Qualitative: no doses, no numbers. */
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
    { label: "arsenic trioxide" },
    { label: "arsenic with heart protection" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "arsenic trioxide", "arsenic with heart protection"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.15 + 0.85 * a) : 0.03;
  const Dg = on ? cl(0.3 + 0.65 * a) : 0.04;
  const DS = on ? cl(0.15 + 0.75 * Math.sin(Math.PI * a)) : 0.03;
  const QT = on ? cl((prot ? 0.25 : 1) * (0.2 + 0.7 * a)) : 0.05;
  const Liv = on ? cl(0.15 + 0.6 * a) : 0.05;
  const Ner = on ? cl(0.05 + 0.85 * a * a) : 0.03;
  const Fat = on ? cl(0.2 + 0.5 * a) : 0.05;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "slowing", "dying"]), w(QT, 0.3, 0.6, ["steady", "long", "twisting"]), w(DS, 0.3, 0.65, ["none", "warning", "severe"])];
  return { a, on, prot, K, Dg, DS, QT, Liv, Ner, Fat, words, readout: "leukaemia " + words[0] + " · rhythm " + words[1] + " · syndrome " + words[2] };
}
const TESTS = [
  [0, 0, "leukaemia growing · rhythm steady · syndrome none"],
  [2, 1, "leukaemia dying · rhythm twisting · syndrome none"],
  [1, 1, "leukaemia dying · rhythm twisting · syndrome severe"],
  [1, 2, "leukaemia dying · rhythm steady · syndrome severe"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="aa-zone" x="34" y="68">LEUKAEMIA CELL</text>
<text class="aa-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="ars"></g><g id="sumo"></g><g id="ub"></g><g id="ros"></g><g id="deb"></g>
<g id="mat"></g>
<g id="heartSlot"></g><g id="heartFx"></g>
<g id="ecg"></g>
<g id="lungSlot"></g><g id="lungFx"></g>
<g id="livSlot"></g><g id="livFx"></g>
<g id="nerSlot"></g><g id="nerFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "arsenic-trioxide-mechanism-adverse-effects", fig: "Fig 1", title: "Arsenic trioxide: fusion destruction and side effects", W, H, body,
  label: "An animated leukaemia cell and toxicity organs. Arsenic trioxide binds the PML half of the PML-RARa fusion, tags it with SUMO and ubiquitin for destruction, and the leukaemia cells mature and die. The heart shows potassium channel block with QT lengthening and torsades on the ECG, guarded by keeping potassium and magnesium up. The lung shows differentiation syndrome, the liver strains, and nerves fail. Gauges show leukaemia kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-ato.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With heart protection",
  sourcesLis: [
    "<strong>How arsenic trioxide works.</strong> In acute promyelocytic leukaemia the PML-RARa fusion protein clamps maturation genes shut. Arsenic trioxide binds the PML part, raises oxidative stress, and tags the fusion with SUMO and then ubiquitin chains, so the cell shreds it. The freed genes let blasts mature and die by apoptosis. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Harms shown.</strong> Maturing cells can flood the lung with fluid (differentiation syndrome); arsenic blocks potassium channels in the heart, stretching the QT until the rhythm twists (torsades), which keeping potassium and magnesium up and avoiding other QT drugs guards against; the liver strains, nerves tingle and go numb, and fatigue builds. This is a teaching summary only.",
  ],
  simplified: "Combination therapy with ATRA, the bleeding tendency of acute promyelocytic leukaemia, white cell and ECG monitoring, electrolyte checks, liver checks, nerve checks, relapse care, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.aa-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.aa-cap{fill:var(--anatomy-strong);font-size:13px}
.aa-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.aa-rung{fill:none;stroke:var(--c-cyt);stroke-width:1.2}
.aa-glow{fill:none;stroke:#ffd24a;stroke-width:3;stroke-linecap:round}
.aa-clamp .aa-cb{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.aa-clamp.aa-pml .aa-cb{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:.8}
.aa-ars{--cc:#9fb0c0}
.aa-sumo{--cc:var(--c-cyt2)}
.aa-ub{--cc:var(--c-cyt)}
.aa-deb{--cc:var(--c-bad)}
.aa-ros{fill:none;stroke:#ff9a3d;stroke-width:1.4;stroke-linejoin:round}
.aa-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.aa-blockx{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.aa-bleb{fill:color-mix(in srgb,var(--c-lymph) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.9}
.aa-ecgbox{fill:color-mix(in srgb,var(--c-tis) 80%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.aa-trace{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
.aa-chan{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.aa-chanblk{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.aa-k{--cc:var(--c-good)}
.aa-mg{--cc:var(--c-cyt2)}
.aa-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.aa-tint{fill:var(--c-bad);stroke:none}
.aa-cyt{--cc:var(--c-cyt)}
.aa-leak{fill:var(--c-fl);stroke:none}
.aa-eff{fill:var(--c-fl);stroke:none}
.aa-enz{--cc:var(--c-eos)}
.aa-sig{--cc:var(--c-plt)}
.aa-stat{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
`,
});
