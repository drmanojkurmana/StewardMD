/* All-trans retinoic acid (ATRA) in acute promyelocytic leukaemia as an animated, working scene
 * (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-atra.mjs [--print-model]
 * Static layout here; maturation, syndrome and gauges move in onc-atra.page.js. Qualitative: no doses, no numbers. */
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
    { label: "ATRA (tretinoin)" },
    { label: "ATRA with dexamethasone (lung protection)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "ATRA", "ATRA with dexamethasone"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, dex = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const D = on ? cl(0.35 + 0.6 * a) : 0.05;
  const DS = on ? cl((dex ? 0.15 : 1) * (0.15 + 0.75 * Math.sin(Math.PI * a))) : 0.03;
  const Wc = on ? cl(0.3 + 0.55 * a) : 0.08;
  const ICP = on ? cl(0.2 + 0.5 * a) : 0.05;
  const Li = on ? cl(0.15 + 0.6 * a) : 0.05;
  const Sk = on ? cl(0.2 + 0.5 * a) : 0.03;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(D, 0.3, 0.7, ["blocked", "starting", "flowing"]), w(DS, 0.3, 0.65, ["none", "warning", "severe"]), w(Wc, 0.35, 0.65, ["normal", "high", "very high"])];
  return { a, on, dex, D, DS, Wc, ICP, Li, Sk, words, readout: "maturation " + words[0] + " · syndrome " + words[1] + " · white cells " + words[2] };
}
const TESTS = [
  [0, 0, "maturation blocked · syndrome none · white cells normal"],
  [0, 1, "maturation starting · syndrome severe · white cells high"],
  [2, 1, "maturation flowing · syndrome none · white cells very high"],
  [0, 2, "maturation starting · syndrome none · white cells high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="ax-zone" x="34" y="68">LEUKAEMIA CELL</text>
<text class="ax-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="atra"></g>
<g id="deb"></g>
<g id="mat"></g>
<g id="vessel"></g><g id="wbc"></g>
<g id="lungSlot"></g><g id="lungFx"></g>
<g id="brainSlot"></g><g id="brainFx"></g>
<g id="livSlot"></g><g id="livFx"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="uteSlot"></g><g id="uteFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "all-trans-retinoic-acid-mechanism-adverse-effects", fig: "Fig 1", title: "All-trans retinoic acid: differentiation and side effects", W, H, body,
  label: "An animated leukaemia cell and toxicity organs. In acute promyelocytic leukaemia the PML-RARa fusion protein clamps maturation genes shut. ATRA docks on it and marks it for destruction, so promyelocytes mature into neutrophils. The lung shows differentiation syndrome with capillary leak and effusion, eased by dexamethasone. The brain shows raised pressure, the liver shows rising blood fats, the skin dries and peels, and pregnancy must be avoided. Gauges show maturation and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-atra.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With dexamethasone",
  sourcesLis: [
    "<strong>How ATRA works.</strong> In acute promyelocytic leukaemia the PML-RARa fusion protein clamps maturation genes shut, freezing white cells as promyelocytes. All-trans retinoic acid (tretinoin) docks on the fusion protein and marks it for destruction, so the genes switch on and the blasts mature into neutrophils rather than being killed outright. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Harms shown.</strong> Maturing cells release cytokines that make capillaries leak, giving differentiation syndrome with fever, breathlessness and effusions, which dexamethasone prevents and treats; white cells flood the blood; pressure inside the skull can rise; blood triglycerides rise; skin and lips dry and peel; and the drug severely harms the unborn child. This is a teaching summary only.",
  ],
  simplified: "Combination therapy with arsenic trioxide, the bleeding tendency of acute promyelocytic leukaemia, headache management, lipid monitoring, contraception planning, maintenance therapy, relapse care, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ax-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.ax-cap{fill:var(--anatomy-strong);font-size:13px}
.ax-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.ax-rung{fill:none;stroke:var(--c-cyt);stroke-width:1.2}
.ax-glow{fill:none;stroke:#ffd24a;stroke-width:3;stroke-linecap:round}
.ax-clamp .ax-cb{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.ax-atra{--cc:var(--c-donor)}
.ax-deb{--cc:var(--c-bad)}
.ax-rod{fill:none;stroke:var(--c-mast);stroke-width:1.6;stroke-linecap:round}
.ax-gran{fill:var(--c-mast);stroke:none}
.ax-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ax-blockx{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.ax-wbc{--cc:var(--c-neut)}
.ax-cyt{--cc:var(--c-cyt)}
.ax-leak{fill:var(--c-fl);stroke:none}
.ax-eff{fill:var(--c-fl);stroke:none}
.ax-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.ax-dex{--cc:var(--c-cyt2)}
.ax-ring{fill:none;stroke:var(--c-cyt);stroke-width:2}
.ax-tint{fill:var(--c-bad);stroke:none}
.ax-fat{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.6}
.ax-flake{fill:var(--anatomy-hi);stroke:var(--anatomy-mid);stroke-width:.5}
.ax-crack{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-linecap:round}
.ax-warn{fill:none;stroke:var(--c-bad);stroke-width:3}
`,
});
