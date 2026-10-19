/* L-asparaginase as an animated, working scene: the enzyme chops blood asparagine
 * so ALL blasts, which lack asparagine synthetase, cannot build proteins and die,
 * while allergy, pancreas, clotting, liver, sugar and fat harms build with each course.
 *   node tools/figures/scenes/onc-asp.mjs [--print-model]
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
    { label: "asparaginase" },
    { label: "asparaginase with allergy cover and clotting support" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "asparaginase", "asparaginase with allergy cover and support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, pro = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? a * (0.55 + 0.45 * a) : 0;
  const H = !on ? 0.02 : pro ? 0.08 : cl(0.5 + 0.3 * a);
  const P = on ? cl(0.1 + 0.75 * a) : 0.02;
  const C = on ? cl(a * (pro ? 0.35 : 1)) : 0.02;
  const L = on ? cl(0.65 * a) : 0;
  const G = on ? cl(0.2 + 0.65 * a) * (pro ? 0.3 : 1) : 0.03;
  const F = on ? cl(0.15 + 0.7 * a) : 0.03;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.25, 0.6, ["growing", "shrinking", "dying"]), w(H, 0.2, 0.45, ["calm", "uneasy", "reacting"]), w(C, 0.3, 0.65, ["steady", "clot prone", "clots and bleeds"])];
  return { a, on, pro, K, H, P, C, L, G, F, words, readout: "tumour " + words[0] + " · allergy " + words[1] + " · clotting " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · allergy calm · clotting steady"],
  [2, 1, "tumour dying · allergy reacting · clotting clots and bleeds"],
  [2, 2, "tumour dying · allergy calm · clotting clot prone"],
  [1, 1, "tumour shrinking · allergy reacting · clotting clot prone"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="452" height="394" rx="18"/>
<rect class="oc-tox" x="474" y="44" width="472" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">ALL BLAST RUNS OUT OF ASPARAGINE</text>
<text class="sc-zone" x="494" y="68">WHERE THE HARM HAPPENS</text>
<path class="dr-beam" d="M470 52L470 430"/>
<rect class="oc-blood" x="20" y="92" width="440" height="48" rx="22"/>
<rect class="oc-ves" x="660" y="336" width="276" height="56" rx="20"/>
<text class="sc-lab" x="22" y="106">drug in</text>
<text class="sc-lab" x="200" y="416">support in</text>
<g id="tumSlot"></g><g id="orgSlot"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "asparaginase-mechanism-adverse-effects", fig: "Fig 1", title: "L-asparaginase: tumour kill and side effects", W, H, body,
  label: "An animated figure. Asparaginase enzyme in blood chops up asparagine. ALL blasts lack asparagine synthetase, so they cannot make their own and die when blood asparagine falls, while healthy cells make their own and survive. Allergy, pancreas inflammation, clots and bleeds from low liver proteins, fatty liver, high sugar and fatty blood build with each course. Allergy cover, clotting support and insulin ease some harms. Gauges show tumour kill and each harm.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, schedules or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-asp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without asparaginase", withLabel: "With asparaginase, allergy cover and support",
  extraCss: `.oc-tox{fill:color-mix(in srgb,var(--c-bad) 7%,var(--anatomy-paper))}.cl-blast{--cc:var(--c-lymph)}
.oc-blood{fill:color-mix(in srgb,var(--c-rbc) 12%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.2}
.oc-ves{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.5}
.p-asn{--cc:#e8b93c}.p-enz{--cc:var(--c-good)}.p-frag{--cc:#aeb9c2}.p-prot{--cc:var(--c-lymph)}.p-bleb{--cc:var(--c-lymph)}
.p-hist{fill:none;stroke:var(--c-mast);stroke-width:1.4}
.p-spk{--cc:var(--c-bad)}.p-ins{--cc:var(--c-fl)}.p-at{--cc:#e8b93c}.p-fbg{--cc:#e8e2d4}
.p-ah{--cc:var(--c-cyt2)}.p-glu{--cc:var(--c-endo)}.p-fat{--cc:#f0e0a0}.p-leak{fill:var(--c-rbc)}
.oc-hive{fill:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1}
.oc-glow{fill:var(--c-bad)}.oc-fatov{fill:var(--c-eos)}.oc-fat{fill:var(--c-eos)}
.oc-syn{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 3}
.oc-synx{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4}
.oc-ribo{fill:var(--anatomy-mid);stroke:var(--anatomy-strong);stroke-width:.8}
.oc-block{fill:none;stroke:var(--c-bad);stroke-width:2}
.oc-cap{fill:var(--anatomy-strong);font-size:13px}`,
  sourcesLis: [
    "<strong>How asparaginase works.</strong> Asparaginase is a bacterial enzyme used in ALL therapy in children and adults. It breaks down asparagine in plasma to aspartate and ammonia, and leukaemia blasts, which lack asparagine synthetase, cannot make their own, so protein synthesis stalls and they die. Healthy cells make their own asparagine and survive. This is standard teaching in pharmacology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Side effects shown.</strong> Hypersensitivity to the foreign protein; pancreatitis with islet failure and high sugar; less liver protein output causing low antithrombin and fibrinogen, so thrombin runs free and fibrin clots form while wounds ooze; fatty liver; and high triglycerides. Allergy cover, clotting support and insulin ease some harms but not pancreas or liver injury. These are teaching toggles only.",
  ],
  simplified: "Erwinia switch after allergy, desensitisation, dose holds and stopping rules, clotting factor monitoring, ammonia toxicity, combination chemotherapy, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
