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
  level: { label: "State", a: [0, 1, 2, 3, 4], names: ["fed", "fasting", "starvation", "DKA", "defect"], ticks: ["fed", "fasting", "starvation", "DKA", "defect"], start: 1 },
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
  [2, 1, "lipolysis low · fat oxidation low · ketones low · acid low"],
  [4, 2, "lipolysis high · fat oxidation moderate · ketones present · acid low"],
];

/* ---------------- static layout ----------------
 * Left to right: fat store, liver with its furnace, brain and muscle.
 * Blood runs across the middle; treatments and the state caption sit below. */
const CY = 286;
const body = `
<rect class="sc-tissue" x="14" y="44" width="196" height="196" rx="16"/>
<rect class="sc-tissue" x="224" y="44" width="386" height="196" rx="16"/>
<rect class="sc-tissue" x="624" y="44" width="322" height="210" rx="16"/>
<rect class="sc-tissue" x="14" y="346" width="932" height="96" rx="16" opacity="0.7"/>
<ellipse id="fedGlow" class="kt-fed" cx="105" cy="155" rx="95" ry="85" opacity="0"/>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 28}" width="932" height="56"/>
<path id="vFFA" class="kt-ves" d="M205 190C250 196 292 190 330 178"/>
<path id="vBrain" class="kt-ves" d="M698 256L698 132"/>
<g id="liverSlot"></g>
<g id="brainSlot"></g>
<g id="muscSlot"></g>
<ellipse id="brainGlow" class="kt-glow-b" cx="735" cy="98" rx="70" ry="55" opacity="0"/>
<ellipse id="musGlow" class="kt-glow-m" cx="800" cy="200" rx="95" ry="45" opacity="0"/>
<ellipse id="mito" class="kt-mito" cx="430" cy="150" rx="85" ry="55"/>
<path class="kt-mito-in" d="M345 150C360 128 395 138 430 132C465 138 490 128 505 150C490 172 465 162 430 168C395 162 360 172 345 150Z"/>
<rect id="gateL" class="kt-gate" x="338" y="138" width="7" height="24" rx="2"/>
<rect id="gateR" class="kt-gate" x="347" y="138" width="7" height="24" rx="2"/>
<g id="brake" opacity="0"><circle class="sc-p p-brake" cx="330" cy="128" r="2.4"/><circle class="sc-p p-brake" cx="338" cy="122" r="2.4"/><circle class="sc-p p-brake" cx="346" cy="120" r="2.4"/><circle class="sc-p p-brake" cx="354" cy="122" r="2.4"/><circle class="sc-p p-brake" cx="362" cy="128" r="2.4"/></g>
<circle id="hmg" class="sc-p p-ket" cx="512" cy="150" r="6"/>
<g id="enz"><circle class="sc-p p-acet" cx="390" cy="140" r="3.4"/><circle class="sc-p p-acet" cx="420" cy="126" r="3.4"/><circle class="sc-p p-acet" cx="455" cy="128" r="3.4"/><circle class="sc-p p-acet" cx="480" cy="150" r="3.4"/><circle class="sc-p p-acet" cx="450" cy="170" r="3.4"/><circle class="sc-p p-acet" cx="405" cy="172" r="3.4"/></g>
<g id="block1" opacity="0"><path class="kt-block" d="M334 134L358 166M358 134L334 166"/></g>
<g id="block2" opacity="0"><path class="kt-block" d="M404 138L430 164M430 138L404 164"/></g>
<g id="kt-tr-g"><path class="kt-icon-g" d="M68 384h44v28a20 11 0 0 1-44 0Z"/><path class="kt-icon-g" d="M86 384v-7h8v7"/><circle class="sc-p p-gluc" cx="90" cy="400" r="5"/></g>
<g id="kt-tr-c"><rect class="kt-icon-c" x="188" y="390" width="52" height="16" rx="8"/><path class="kt-icon-c" d="M214 390v16"/><circle class="sc-p p-carn" cx="202" cy="398" r="3.4"/></g>
<g id="cells"></g><g id="tr"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-fat{--cc:#f3e1a0}
.kt-mito{fill:color-mix(in srgb,#b8645a 14%,transparent);stroke:#b8645a;stroke-width:1.6}
.kt-mito-in{fill:none;stroke:#b8645a;stroke-width:1.1;opacity:.65}
.kt-ves{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.8}
.kt-fed{fill:#f2b23a;stroke:none}
.kt-glow-b{fill:#b7a1e6;stroke:none}
.kt-glow-m{fill:#ee6a4a;stroke:none}
.kt-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-ffa{--cc:#e89a3c}.p-acet{--cc:#ffd24a}.p-ket{--cc:#ee6a4a}.p-carn{--cc:#2fc2a3}.p-gluc{--cc:#f2b23a}.p-acid{--cc:#e5484d}.p-brake{--cc:var(--c-mast)}
.kt-gate{fill:#c25a5a}.kt-gate.open{fill:var(--c-good)}
.kt-icon-g{fill:color-mix(in srgb,#f2b23a 35%,var(--anatomy-paper));stroke:#d99a1f;stroke-width:1.3}
.kt-icon-c{fill:color-mix(in srgb,#2fc2a3 35%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.kt-block{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.dr-g-fill.g-lip{fill:#e89a3c}.dr-g-fill.g-ox{fill:#ffd24a}.dr-g-fill.g-ket{fill:#ee6a4a}.dr-g-fill.g-brain{fill:#b7a1e6}.dr-g-fill.g-acid{fill:var(--c-bad)}
`;

buildScene({
  id: "ketogenesis-fatty-acid-oxidation", fig: "Fig 1", title: "Fatty acid oxidation and ketone bodies", W, H, body, extraCss,
  label: "An animated pathway from fat store to ketone use. In adipose tissue, stored fat breaks down and fatty acids travel to the liver. A carnitine shuttle carries them into mitochondria, where beta-oxidation shortens them to acetyl-CoA. When oxaloacetate is low, acetyl-CoA is diverted in the liver to ketone bodies, which travel in blood to brain and muscle as fuel. A level slider moves from fed to fasting, starvation, diabetic ketoacidosis and an enzyme defect, and treatment choices are none, glucose and carnitine. Gauges show lipolysis, fat oxidation, ketones, brain ketone use and acid load.",
  caption: "Schematic, not to scale. Particle speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "ketone.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With glucose",
  sourcesLis: [
    "<strong>How fat becomes ketones.</strong> When insulin is low and energy is needed, hormone-sensitive lipase in adipose tissue breaks stored triglyceride into free fatty acids and glycerol. Fatty acids travel in blood (bound to albumin) to the liver, are activated to fatty acyl-CoA in the cytosol, and enter mitochondria through the carnitine shuttle (CPT1 on the outer membrane, a translocase, and CPT2 inside), a step held back in the fed state by malonyl-CoA. Inside, beta-oxidation repeatedly shortens the chain, releasing acetyl-CoA. When oxaloacetate is scarce because it is being used to make glucose, acetyl-CoA cannot all enter the energy cycle (citric acid cycle) and is instead joined in liver mitochondria through HMG-CoA to make the ketone bodies acetoacetate and beta-hydroxybutyrate. These leave the liver, travel in blood, and are used as fuel by brain, heart and muscle, which convert them back to acetyl-CoA. In prolonged fasting this spares glucose and muscle protein. This is standard teaching in biochemistry and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Defects and excess.</strong> In diabetic ketoacidosis, absent insulin drives uncontrolled lipolysis and ketone production, and the ketone acids cause metabolic acidosis. By contrast, defects in the carnitine shuttle or in beta-oxidation enzymes such as medium-chain acyl-CoA dehydrogenase (MCAD) block fat oxidation: during fasting, fatty acids are released but ketones stay inappropriately low, glucose falls, and energy fails, which is dangerous in infants and children. Glucose given by mouth or vein suppresses lipolysis and provides fuel that does not need fat oxidation; carnitine can help when the problem is carnitine shortage or transport. These are teaching toggles only.",
  ],
  simplified: "Glycerol and glucose metabolism in detail, ketone chemistry beyond the two main bodies, acetone, the full citric acid cycle, respiratory chain and ATP counts, hormonal control beyond insulin and the fed signal, renal ketone handling, and every drug dose and protocol are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
