/* Fluorouracil as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-5fu.mjs [--print-model]
 * Static layout here; TS block, tumour kill and toxic organs move in onc-5fu.page.js. Qualitative: no doses, no numbers. */
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
    { label: "fluorouracil" },
    { label: "fluorouracil in DPD deficiency" },
    { label: "fluorouracil with leucovorin (stronger block)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "fluorouracil", "fluorouracil in DPD deficiency", "fluorouracil with leucovorin"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, dpd = drug === 2 ? 1 : 0, leuco = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.25 + 0.6 * a + (leuco ? 0.15 : 0) + (dpd ? 0.25 : 0)) : 0.04;
  const B = on ? cl(0.35 + 0.5 * a + (leuco ? 0.25 : 0) + (dpd ? 0.3 : 0)) : 0.05;
  const Gu = on ? cl(0.2 + 0.5 * a + (leuco ? 0.2 : 0) + (dpd ? 0.45 : 0)) : 0.04;
  const Mr = on ? cl(0.25 + 0.5 * a + (leuco ? 0.1 : 0) + (dpd ? 0.4 : 0)) : 0.05;
  const Sk = on ? cl(-0.1 + 0.55 * a + (leuco ? 0.05 : 0) + (dpd ? 0.35 : 0)) : 0;
  const Ht = on ? cl(0.3 + 0.1 * a + (dpd ? 0.45 : 0)) : 0.02;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(Gu, 0.3, 0.6, ["ok", "sore", "severe"]), w(Mr, 0.3, 0.65, ["ok", "low", "very low"])];
  return { a, on, dpd, leuco, K, B, Gu, Mr, Sk, Ht, words, readout: "tumour " + words[0] + " · gut " + words[1] + " · marrow " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · gut ok · marrow ok"],
  [0, 1, "tumour shrinking · gut sore · marrow low"],
  [0, 2, "tumour shrinking · gut severe · marrow very low"],
  [1, 3, "tumour dying · gut severe · marrow very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="fu-zone" x="34" y="68">TUMOUR CELL</text>
<text class="fu-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="fu"></g>
<g id="fol"></g>
<g id="tmp"></g>
<g id="frag"></g>
<g id="heartSlot"></g><g id="heartFx"></g>
<g id="mar"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="livSlot"></g><g id="livFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "fluorouracil-mechanism-adverse-effects", fig: "Fig 1", title: "Fluorouracil: tumour kill and side effects", W, H, body,
  label: "An animated tumour cell and toxicity organs. Fluorouracil is converted to FdUMP, which locks thymidylate synthase with folate and starves tumour DNA of thymidine, while faulty drug blocks built into RNA and DNA add to the kill. Leucovorin adds folate that tightens the lock. Gut lining, marrow, skin of the palms and soles, and coronary arteries show the side effects, and the liver shows DPD clearing the drug, with severe early toxicity when DPD is deficient. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-5fu.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With leucovorin",
  sourcesLis: [
    "<strong>How fluorouracil works.</strong> Fluorouracil enters cells and is converted to FdUMP, which locks thymidylate synthase together with reduced folate in a stuck ternary complex, starving DNA of thymidine; other metabolites are wrongly built into RNA and DNA and add to cell death. Rapidly dividing normal tissues are harmed for the same reason: gut lining (mucositis and diarrhoea), marrow (low blood counts), and skin of the palms and soles (hand-foot syndrome). Coronary vasospasm can starve heart muscle of blood, and DPD deficiency lets the drug flood the body with severe early toxicity. Leucovorin adds folate that stabilises the locked complex. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Combinations shown.</strong> Fluorouracil with leucovorin (a stronger TS block with stronger kill and stronger gut harm), and fluorouracil in DPD deficiency (failed clearance with severe early harm). These are teaching toggles only.",
  ],
  simplified: "Capecitabine and tegafur prodrugs, infusion schedules, eye and nail effects, cerebellar effects, spasm treatment, DPD testing and dose adjustment, uridine rescue, combination regimens, monitoring tests, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.fu-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.fu-cap{fill:var(--anatomy-strong);font-size:13px}
.fu-node{fill:var(--anatomy-strong);font-size:10.5px;text-anchor:middle;pointer-events:none}
.fu-node2{fill:var(--anatomy-strong);font-size:10.5px;text-anchor:middle}
.fu-jaw{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.9}
.fu-ts.locked .fu-jaw{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.fu-lock{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 55%,#000);stroke-width:.8}
.fu-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.fu-rung{fill:none;stroke:var(--c-cyt);stroke-width:1.2}
.fu-crack{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.fu-rna{fill:none;stroke:var(--c-bac);stroke-width:2;stroke-linecap:round}
.fu-rnablok{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.6}
.fu-rnabad{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.fu-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4}
.fu-x{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.fu-flash{fill:none;stroke:#ffd24a;stroke-width:2}
.fu-fu{--cc:var(--c-cyt2)}
.fu-fd{--cc:#ff9a3d}
.fu-fol{--cc:var(--c-bac)}
.fu-tmp{--cc:var(--c-good)}
.fu-deb{--cc:var(--c-graft)}
.fu-inc{--cc:#ff9a3d}
.fu-slough{--cc:var(--c-eos)}
.fu-peel{--cc:var(--c-endo)}
.fu-corfl{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 55%,#000);stroke-width:.5}
.fu-cor{fill:none;stroke:var(--c-bad);stroke-width:2}
.fu-spasm{fill:none;stroke:#ffd24a;stroke-width:2;stroke-linejoin:round}
.fu-bone{fill:color-mix(in srgb,#e6d7b8 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.fu-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,#3a0e14)}
.fu-mar{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.7}
.fu-gut{fill:var(--c-bad)}
.fu-sore{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.fu-skintint{fill:var(--c-bad)}
.fu-blis{fill:color-mix(in srgb,var(--c-bad) 55%,#fff);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.fu-dpd{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.5}
.fu-livfl{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.5}
`,
});
