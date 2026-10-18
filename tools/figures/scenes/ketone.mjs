/* Fatty acid oxidation and ketone bodies as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ketone.mjs [--print-model]
 * Static layout here; particles, the carnitine shuttle and gauges move in ketone.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "State", a: [0, 1, 2, 3, 4], names: ["fed", "fasting", "starvation", "DKA", "enzyme defect"], ticks: ["fed", "fasting", "starvation", "DKA", "defect"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "glucose" },
    { label: "carnitine" },
  ],
  status: "State: {level} · {drug} ·",
  drugNames: ["no treatment", "glucose given", "carnitine given"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const glu = drug === 1 ? 1 : 0, carn = drug === 2 ? 1 : 0;
  const L0 = [0.10, 0.50, 0.85, 1.00, 0.70][t];
  const B0 = [0.08, 0.45, 0.80, 0.95, 0.12][t];
  const K0 = [0.05, 0.35, 0.75, 1.00, 0.08][t];
  const Br0 = [0.03, 0.25, 0.70, 0.65, 0.05][t];
  const A0 = [0.02, 0.10, 0.25, 0.90, 0.05][t];
  const G0 = [0.65, 0.45, 0.35, 0.95, 0.18][t];
  const O0 = [0.05, 0.35, 0.80, 0.90, 0.45][t];
  const gf = glu ? (t === 3 ? 0.80 : 0.35) : 1;
  const L = cl(L0 * gf);
  const B = cl(glu ? B0 * gf : carn ? (t === 4 ? 0.38 : Math.min(1, B0 * 1.12 + 0.05)) : B0);
  const K = cl(glu ? K0 * (t === 3 ? 0.80 : 0.30) : carn ? (t === 4 ? 0.30 : Math.min(1, K0 * 1.05)) : K0);
  const Br = cl(glu ? Br0 * 0.40 : carn ? (t === 4 ? 0.24 : Math.min(1, Br0 * 1.05)) : Br0);
  const Ac = cl(A0 * (K / Math.max(K0, 0.05)) * (glu ? 0.9 : 1));
  const G = cl(glu ? 0.55 : G0);
  const O = cl(O0 * (glu ? 0.40 : 1));
  const Sh = cl(glu ? 0.20 : carn ? (t === 4 ? 0.55 : 0.90) : [0.20, 0.85, 0.95, 0.95, 0.18][t]);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(L, 0.3, 0.65, ["low", "moderate", "high"]), w(B, 0.3, 0.65, ["low", "moderate", "high"]), w(K, 0.25, 0.6, ["low", "present", "high"]), w(Ac, 0.2, 0.5, ["low", "raised", "high"])];
  return { t, glu, carn, defect: t === 4 ? 1 : 0, L, B, K, Br, Ac, G, O, Sh, words, readout: "lipolysis " + words[0] + " · fat oxidation " + words[1] + " · ketones " + words[2] + " · acid " + words[3] };
}
const TESTS = [
  [0, 0, "lipolysis low · fat oxidation low · ketones low · acid low"],
  [2, 0, "lipolysis high · fat oxidation high · ketones high · acid raised"],
  [3, 0, "lipolysis high · fat oxidation high · ketones high · acid high"],
  [4, 0, "lipolysis high · fat oxidation low · ketones low · acid low"],
];

/* ---------------- static layout ---------------- */
const CY = 286;
const body = `
<rect class="sc-tissue" x="14" y="44" width="196" height="196" rx="16"/>
<rect class="sc-tissue" x="224" y="44" width="386" height="196" rx="16"/>
<rect class="sc-tissue" x="624" y="44" width="322" height="94" rx="16"/>
<rect class="sc-tissue" x="624" y="152" width="322" height="88" rx="16"/>
<rect class="sc-tissue" x="14" y="346" width="300" height="96" rx="16" opacity="0.7"/>
<rect class="sc-tissue" x="330" y="346" width="616" height="96" rx="16" opacity="0.7"/>
<text class="sc-zone" x="32" y="68">ADIPOSE</text>
<text class="sc-zone" x="242" y="68">LIVER</text>
<text class="sc-zone" x="642" y="68">BRAIN</text>
<text class="sc-zone" x="642" y="176">MUSCLE</text>
<text class="sc-zone" x="32" y="368">WHEN GIVEN</text>
<text class="sc-zone" x="348" y="368">WHERE ACETYL-COA GOES</text>
<text class="sc-lab sc-dim" x="240" y="90">cytosol</text>
<text class="sc-lab sc-dim" x="492" y="206">mitochondrion</text>
<ellipse class="kt-mito" cx="417" cy="150" rx="132" ry="60"/>
<path class="kt-mito-in" d="M317 150C340 118 380 132 417 122C454 132 494 118 517 150C494 182 454 168 417 178C380 168 340 182 317 150Z"/>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 28}" width="932" height="56"/>
<text class="sc-zone sc-dim" x="30" y="${CY + 4}">BLOOD</text>
<path class="kt-fate" d="M348 392H360"/>
<path class="kt-fate" d="M348 424H360"/>
<circle class="sc-p p-acet" cx="348" cy="392" r="4"/>
<circle class="sc-p p-ket" cx="348" cy="424" r="4"/>
<text class="sc-lab" x="366" y="396">to the energy cycle when oxaloacetate is plentiful</text>
<text class="sc-lab" x="366" y="428">to ketone bodies when oxaloacetate is low</text>
<rect id="fateTca" class="kt-bar-tca" x="700" y="384" width="10" height="10" rx="5"/>
<rect id="fateKet" class="kt-bar-ket" x="700" y="416" width="10" height="10" rx="5"/>
<g id="cells"></g><g id="tr"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-fat{--cc:#f3e1a0}.cl-brain{--cc:#b7a1e6}.cl-hep{--cc:#b8645a}
.kt-mito{fill:color-mix(in srgb,#b8645a 22%,var(--anatomy-paper));stroke:#b8645a;stroke-width:1.6}
.kt-mito-in{fill:none;stroke:#b8645a;stroke-width:1.1;opacity:.65}
.kt-fate{stroke:var(--anatomy-faint);stroke-width:1.2}
.kt-bar-tca{fill:var(--c-good)}.kt-bar-ket{fill:#ee6a4a}
.p-ffa{--cc:#e89a3c}.p-acet{--cc:#ffd24a}.p-ket{--cc:#ee6a4a}.p-carn{--cc:#2fc2a3}.p-gluc{--cc:#f2b23a}.p-acid{--cc:#e5484d}
.kt-gate{fill:#c25a5a}.kt-gate.open{fill:var(--c-good)}
.kt-musc{fill:color-mix(in srgb,#d77a7a 45%,var(--anatomy-paper));stroke:#c25a5a;stroke-width:1.3}
.kt-stri{stroke:#c25a5a;stroke-width:.8;opacity:.5}
.kt-icon-g{fill:color-mix(in srgb,#f2b23a 35%,var(--anatomy-paper));stroke:#d99a1f;stroke-width:1.3}
.kt-icon-c{fill:color-mix(in srgb,#2fc2a3 35%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.kt-block{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.dr-g-fill.g-lip{fill:#e89a3c}.dr-g-fill.g-ox{fill:#ffd24a}.dr-g-fill.g-ket{fill:#ee6a4a}.dr-g-fill.g-brain{fill:#b7a1e6}.dr-g-fill.g-acid{fill:var(--c-bad)}
`;

buildScene({
  id: "ketogenesis-fatty-acid-oxidation", fig: "Fig 1", title: "Fatty acid oxidation and ketone bodies", W, H, body, extraCss,
  label: "An animated pathway from fat store to ketone use. In adipose tissue, stored fat breaks down and fatty acids travel to the liver. A carnitine shuttle carries them into mitochondria, where beta-oxidation shortens them to acetyl-CoA. When oxaloacetate is low, acetyl-CoA is diverted in the liver to ketone bodies, which travel in blood to brain and muscle as fuel. A level slider moves from fed to fasting, starvation, diabetic ketoacidosis and an enzyme defect, and treatment choices are none, glucose and carnitine. Gauges show lipolysis, fat oxidation, ketones, brain ketone use and acid load.",
  caption: "Schematic, not to scale. Particle speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "ketone.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How fat becomes ketones.</strong> When insulin is low and energy is needed, hormone-sensitive lipase in adipose tissue breaks stored triglyceride into free fatty acids and glycerol. Fatty acids travel in blood (bound to albumin) to the liver, are activated to fatty acyl-CoA in the cytosol, and enter mitochondria through the carnitine shuttle (CPT1 on the outer membrane, a translocase, and CPT2 inside), a step held back in the fed state by malonyl-CoA. Inside, beta-oxidation repeatedly shortens the chain, releasing acetyl-CoA. When oxaloacetate is scarce because it is being used to make glucose, acetyl-CoA cannot all enter the energy cycle (citric acid cycle) and is instead joined in liver mitochondria through HMG-CoA to make the ketone bodies acetoacetate and beta-hydroxybutyrate. These leave the liver, travel in blood, and are used as fuel by brain, heart and muscle, which convert them back to acetyl-CoA. In prolonged fasting this spares glucose and muscle protein. This is standard teaching in biochemistry and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Defects and excess.</strong> In diabetic ketoacidosis, absent insulin drives uncontrolled lipolysis and ketone production, and the ketone acids cause metabolic acidosis. By contrast, defects in the carnitine shuttle or in beta-oxidation enzymes such as medium-chain acyl-CoA dehydrogenase (MCAD) block fat oxidation: during fasting, fatty acids are released but ketones stay inappropriately low, glucose falls, and energy fails, which is dangerous in infants and children. Glucose given by mouth or vein suppresses lipolysis and provides fuel that does not need fat oxidation; carnitine can help when the problem is carnitine shortage or transport. These are teaching toggles only.",
  ],
  simplified: "Glycerol and glucose metabolism in detail, ketone chemistry beyond the two main bodies, acetone, the full citric acid cycle, respiratory chain and ATP counts, hormonal control beyond insulin and the fed signal, renal ketone handling, and every drug dose and protocol are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
