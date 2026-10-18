/* Ischaemic stroke as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/stroke.mjs [--print-model]
 * Static layout here; clot, flow, brain core and penumbra and gauges move in stroke.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Time since onset", a: [0.25, 0.6, 1], names: ["early", "later", "late"], ticks: ["early", "later", "late"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "thrombolysis (clot dissolving drug)" },
    { label: "thrombectomy (catheter clot removal)" },
    { label: "antiplatelet only" },
  ],
  status: "Time since onset: {level} \u00B7 {drug} \u00B7",
  drugNames: ["no treatment", "thrombolysis", "thrombectomy", "antiplatelet only"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const t = S.level.a[level];
  const lysisEff = drug === 1 ? 1 - 0.55 * t : 0;
  const thrombEff = drug === 2 ? 1 - 0.35 * t : 0;
  const antiFlag = drug === 3 ? 1 : 0;
  const Occ = 0.92 * (1 - 0.62 * lysisEff) * (1 - 0.88 * thrombEff) * (1 - 0.14 * antiFlag);
  const Flow = cl(1 - Occ * 1.02);
  const Core = cl(0.06 + 0.78 * t * Occ - 0.22 * lysisEff - 0.30 * thrombEff);
  const Pen = cl(0.72 * Occ * (1 - 0.45 * t) - 0.28 * lysisEff - 0.32 * thrombEff + 0.05);
  const Ex = cl(0.45 * Pen + 0.5 * Core);
  const Def = cl(0.85 * Core + 0.4 * Pen);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Occ, 0.35, 0.7, ["open", "narrowed", "blocked"]), w(Core, 0.18, 0.45, ["small", "growing", "large"]), w(Def, 0.3, 0.6, ["mild", "moderate", "severe"])];
  return { t, lysis: drug === 1 ? 1 : 0, thromb: drug === 2 ? 1 : 0, anti: antiFlag, lysisEff, thrombEff, Occ, Flow, Core, Pen, Ex, Def, words, readout: "artery " + words[0] + " \u00B7 core " + words[1] + " \u00B7 deficit " + words[2] };
}
const TESTS = [
  [0, 0, "artery blocked \u00B7 core growing \u00B7 deficit moderate"],
  [2, 0, "artery blocked \u00B7 core large \u00B7 deficit severe"],
  [0, 2, "artery open \u00B7 core small \u00B7 deficit mild"],
  [0, 1, "artery narrowed \u00B7 core small \u00B7 deficit mild"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ARTERY AND WHERE THE CLOT COMES FROM</text>
<text class="sc-zone" x="604" y="68">BRAIN TERRITORY AT RISK</text>
<text class="sc-lab" x="740" y="132" text-anchor="middle">middle cerebral territory</text>
<g id="art"></g><g id="brain"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "ischaemic-stroke", fig: "Fig 1", title: "Ischaemic stroke: clot, core and penumbra", W, H, body,
  label: "An animated cerebral artery blocked by a clot, and the brain territory it feeds. The clot may form on a local plaque or arrive as an embolus from the heart. Downstream, a dark ischaemic core dies while a surrounding penumbra is at risk but still salvageable. Glutamate driven excitotoxic injury spreads in the at risk tissue. The time slider moves from early to late, the core grows and the penumbra shrinks, and the deficit worsens by territory. Treatment choices are thrombolysis, thrombectomy and an antiplatelet drug. Gauges show flow, core, penumbra, glutamate, cell death and deficit.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, times, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "stroke.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How an ischaemic stroke develops.</strong> A clot blocks a cerebral artery, either forming in place on a ruptured atherosclerotic plaque (thrombotic) or travelling from elsewhere, often the heart, until it lodges (embolic). Tissue in the centre of the territory loses blood flow and dies quickly as the ischaemic core. Around it, the penumbra receives just enough collateral flow to survive for a while but not to work, so it is salvageable if flow returns and is lost if it does not. Starved neurones release glutamate, which overexcites neighbours, lets in calcium and drives further cell death (excitotoxicity). The clinical deficit depends on which territory and how much tissue is lost. This is standard teaching in medicine and neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Thrombolysis dissolves the clot with a drug and works best early. Thrombectomy removes the clot with a catheter passed into the artery. An antiplatelet drug reduces further platelet clumping but does not reopen a blocked artery on its own. These are teaching toggles only.",
  ],
  simplified: "Collateral variation, haemorrhagic transformation, oedema and herniation, posterior circulation and lacunar strokes, mimics, imaging selection, eligibility windows, contraindications, rehabilitation and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.st-lumen{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper))}
.st-wall{fill:color-mix(in srgb,var(--c-endo) 45%,var(--c-tis))}
.st-plaque{fill:color-mix(in srgb,#d9b97a 55%,var(--c-tis));stroke:color-mix(in srgb,#d9b97a 60%,#000);stroke-width:.8}
.st-brain{fill:color-mix(in srgb,var(--c-tis) 70%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.st-pen{fill:#8a5fc4;opacity:.35}
.st-core{fill:#2e2830;opacity:.9}
.st-heart{fill:color-mix(in srgb,var(--c-rbc) 65%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.st-path{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 5;opacity:.7}
.st-cath{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.st-basket{fill:none;stroke:var(--anatomy-strong);stroke-width:1.2}
.cl-neuron{--cc:#7fc4e8}
.p-glut{--cc:#e9b84a}
.p-lys{--cc:var(--c-good)}
`,
});
