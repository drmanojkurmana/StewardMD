/* Bleomycin mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-bleo.mjs [--print-model]
 * Static layout here; tumour cell, DNA breaks, organs and gauges move in onc-bleo.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.25, 0.5, 0.75, 1], names: ["early", "middle", "late", "cumulative"], ticks: ["early", "middle", "late", "cumulative"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "bleomycin" },
    { label: "bleomycin with low oxygen and lung checks" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "bleomycin", "bleomycin with lung protection"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Kill = on ? cl(0.15 + 0.85 * a) : 0;
  const Fib = on ? cl(a * a * 1.15 * (prot ? 0.35 : 1)) : 0;
  const Skin = on ? cl(a * 0.9 * (prot ? 0.9 : 1)) : 0;
  const Mar = 0.02;
  const Fev = on ? cl(0.75 * (1 - a) + 0.08) : 0;
  const O2 = prot ? 0.25 : 0.85;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Kill, 0.3, 0.65, ["growing", "injured", "dying"]), w(Fib, 0.25, 0.55, ["clear", "irritated", "scarred"]), w(Skin, 0.3, 0.6, ["normal", "darkening", "darkened"])];
  return { a, on, prot, Kill, Fib, Skin, Mar, Fev, O2, words, readout: "tumour " + words[0] + " · lungs " + words[1] + " · skin " + words[2] };
}
const TESTS = [
  [3, 0, "tumour growing · lungs clear · skin normal"],
  [3, 1, "tumour dying · lungs scarred · skin darkened"],
  [3, 2, "tumour dying · lungs irritated · skin darkened"],
  [0, 1, "tumour injured · lungs clear · skin normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="604" y="68">ORGANS AT RISK</text>
<g id="cellSlot"></g><g id="dna"></g><g id="bursts"></g>
<g id="lungSlot"></g><g id="skinSlot"></g><g id="marrow"></g>
<g id="parts"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "bleomycin-mechanism-adverse-effects", fig: "Fig 1", title: "Bleomycin: DNA breaks, lung scarring and skin changes", W, H, body,
  label: "An animated tumour cell and the organs at risk. Bleomycin enters the tumour cell, binds iron, latches onto DNA and uses oxygen to make radicals that cut single and double strands, killing the cell as it tries to divide. The lung scars because it has little bleomycin hydrolase to disarm the drug, and high oxygen worsens the injury. The skin darkens for the same reason, while the marrow is spared. Gauges show tumour kill, lung scarring, skin change and marrow harm. Treatment choices include bleomycin alone and bleomycin with low oxygen and lung checks.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-bleo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without bleomycin", withLabel: "With bleomycin plus lung protection",
  sourcesLis: [
    "<strong>How bleomycin kills tumour cells.</strong> Bleomycin is a glycopeptide that binds iron and then DNA. With oxygen it forms radicals that cause single and double strand breaks, so cells arrest from G2 to M and die. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why lung and skin suffer but marrow is spared.</strong> Lung and skin have little bleomycin hydrolase, the enzyme that disarms the drug, so radicals injure them: the lung scars through TGF-beta driven fibrosis, worsened by high oxygen, and the skin darkens and rashes. Fever and rare anaphylactoid reactions occur, while myelosuppression is unusually mild. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Keeping oxygen low and checking the lungs often to catch injury early. These are teaching toggles only.",
  ],
  simplified: "Brands and combination regimens, Raynaud-like vascular effects, mucosal ulcers, testicular and lymphoma use, lung function testing, stopping rules, steroids for lung injury, premedication and desensitisation for reactions, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:var(--c-graft)}
.bl-dead{fill:#1a1030}
.bl-dna-s{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.bl-dna-r{fill:none;stroke:var(--c-cyt2);stroke-width:1.1;opacity:.75}
.bl-burst{fill:#ff8c42;stroke:#c22e1f;stroke-width:1}
.bl-bleb{fill:var(--c-graft);stroke:color-mix(in srgb,var(--c-graft) 55%,#000);stroke-width:.9}
.p-bleo{--cc:var(--c-plt)}
.p-fe{--cc:var(--c-eos)}
.p-o2{--cc:var(--c-fl)}
.bl-streak{fill:none;stroke:#b9a89a;stroke-width:2;stroke-linecap:round}
.bl-scar{fill:#b9a89a}
.bl-pig{fill:#6b4a2f}
.bl-pigwash{fill:#6b4a2f}
.bl-flush{fill:var(--c-bad)}
.bl-bone{fill:color-mix(in srgb,#e8e0d0 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.bl-cav{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper))}
.bl-mcell{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.5}
.bl-capline{fill:var(--anatomy-strong);font-size:13px}
`,
});
