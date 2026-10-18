/* Phaeochromocytoma as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pheo.mjs [--print-model]
 * Static layout here; tumour, mediators, vessel, heart and gauges move in pheo.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Tumour activity", a: [0.15, 0.65, 1], names: ["quiescent", "paroxysm", "crisis"], ticks: ["quiescent", "paroxysm", "crisis"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "alpha blocker first (alpha blockade)" },
    { label: "alpha blocker first, then beta blocker" },
    { label: "surgery: tumour removal after alpha blockade" },
    { label: "supportive care only (fluids and rest)" },
  ],
  status: "Tumour: {level} · {drug} ·",
  drugNames: ["no treatment", "alpha blockade", "alpha blockade then beta blockade", "tumour removal after alpha blockade", "supportive care only"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ab = drug === 1 || drug === 2 || drug === 3 ? 1 : 0;
  const bb = drug === 2 ? 1 : 0;
  const surg = drug === 3 ? 1 : 0;
  const sup = drug === 4 ? 1 : 0;
  const a = S.level.a[level];
  const rel = cl(a * (surg ? 0.07 : 1));
  const alpha = cl(rel * (ab ? 0.22 : 1));
  const betaH = cl(rel * (bb ? 0.22 : 1));
  const bp = cl(0.3 + 0.65 * alpha - (sup ? 0.04 : 0));
  const hr = cl(0.22 + 0.68 * betaH);
  const sweat = cl(0.1 + 0.8 * rel * (ab ? 0.6 : 1) * (bb ? 0.75 : 1));
  const head = cl(bp * (0.25 + 0.75 * rel));
  const met = cl(0.1 + 0.85 * rel);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(bp, 0.45, 0.68, ["normal", "raised", "very high"]), w(hr, 0.4, 0.65, ["calm", "racing", "pounding"]), w(rel, 0.3, 0.7, ["quiet", "surging", "flooding"])];
  return { a, ab, bb, surg, sup, rel, alpha, betaH, bp, hr, sweat, head, met, words, readout: "blood pressure " + words[0] + " · heart " + words[1] + " · catecholamines " + words[2] };
}
const TESTS = [
  [2, 0, "blood pressure very high · heart pounding · catecholamines flooding"],
  [2, 1, "blood pressure normal · heart pounding · catecholamines flooding"],
  [2, 2, "blood pressure normal · heart calm · catecholamines flooding"],
  [2, 3, "blood pressure normal · heart calm · catecholamines quiet"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ADRENAL AND KIDNEY</text>
<text class="sc-zone" x="330" y="68">BLOOD VESSEL</text>
<text class="sc-zone" x="676" y="68">HEART</text>
<ellipse class="phe-kidney" cx="150" cy="322" rx="82" ry="60"/>
<ellipse class="phe-kidneyin" cx="172" cy="322" rx="40" ry="32"/>
<path class="phe-adrenal" d="M74 244 Q150 176 226 244 Q192 262 150 252 Q108 262 74 244Z"/>
<g id="tumourG"></g>
<rect id="pheLumen" class="phe-lumen" x="310" y="188" width="300" height="48" rx="10"/>
<g id="wallTop"></g><g id="wallBot"></g><g id="rbcs"></g>
<g id="heartG"></g>
<circle class="phe-head" cx="430" cy="348" r="34"/>
<path class="phe-neck" d="M418 378 L442 378 L446 396 L414 396Z"/>
<g id="headRays" opacity="0">
<path class="phe-ray" d="M430 296 L430 282"/><path class="phe-ray" d="M398 306 L388 294"/><path class="phe-ray" d="M462 306 L472 294"/>
<path class="phe-ray" d="M388 330 L374 324"/><path class="phe-ray" d="M472 330 L486 324"/>
</g>
<rect class="phe-skin" x="660" y="322" width="272" height="32" rx="9"/>
<path class="phe-gland" d="M706 322 q6 10 -2 16 q-7 6 0 12"/><path class="phe-gland" d="M800 322 q6 10 -2 16 q-7 6 0 12"/><path class="phe-gland" d="M890 322 q6 10 -2 16 q-7 6 0 12"/>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "phaeochromocytoma", fig: "Fig 1", title: "Phaeochromocytoma: catecholamine surge to symptoms", W, H, body,
  label: "An animated adrenal tumour, blood vessel, heart, skin and head. Chromaffin tumour cells release adrenaline and noradrenaline in bursts. Alpha receptor action squeezes the vessel and raises blood pressure. Beta receptor action makes the heart pound and, with sweating and headache, completes the classic spells. Gauges show catecholamines, pressure, heart, sweating, headache and metanephrines. Treatment choices stress alpha blockade before beta blockade, tumour removal, and supportive care alone.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pheo.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How phaeochromocytoma causes spells.</strong> A phaeochromocytoma is a catecholamine secreting tumour of chromaffin cells in the adrenal medulla; related tumours outside the adrenal are paragangliomas, together called PPGLs. The tumour stores and episodically releases adrenaline and noradrenaline. Alpha receptor activation constricts blood vessels and raises blood pressure; beta receptor activation increases heart rate and force, giving palpitations, and contributes to tremor, sweating and a throbbing headache. Between spells the tumour may be quiescent, so blood pressure can be normal, sustained, or paroxysmal. This is standard teaching in endocrine and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Tests and associated conditions.</strong> The usual first biochemical test measures metanephrines, the breakdown products of catecholamines, in plasma or urine, because metanephrine production by the tumour is more continuous and the test is highly sensitive; imaging of the adrenal follows biochemical proof and is not the first step. Some PPGLs are inherited, so genetic testing and family screening matter: associations include MEN2, von Hippel Lindau disease and neurofibromatosis type 1, among other susceptibility genes and mutations.",
    "<strong>Treatment ideas shown.</strong> Alpha blockade comes first to relax vessels and allow volume repletion; a beta blocker is added only after alpha blockade, because beta blockade alone can leave alpha vasoconstriction unopposed and worsen hypertension. Definitive treatment is surgical removal of the tumour after preparation; supportive care with fluids alone does not stop catecholamine release. These are teaching toggles only.",
  ],
  simplified: "Paraganglioma sites outside the adrenal, detailed receptor subtypes, phenoxybenzamine versus selective alpha blockers and other named drugs, catecholamine synthesis and storage steps, assay interference, imaging modality choice, operative and anaesthetic detail, malignant disease, pregnancy, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-phetum:#e8843c;--c-pheheart:#d63a4a}
body[data-theme="light"]{--c-phetum:#c96a22;--c-pheheart:#c42a3d}
.cl-phetum{--cc:var(--c-phetum)}.cl-phewall{--cc:var(--c-sm)}
.phe-kidney{fill:#8a4b62;stroke:#5f3244;stroke-width:1.2;opacity:.9}
.phe-kidneyin{fill:#c98aa0;opacity:.65}
.phe-adrenal{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:1.1;opacity:.95}
.phe-lumen{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper))}
.phe-heart{fill:var(--c-pheheart);stroke:color-mix(in srgb,var(--c-pheheart) 55%,#000);stroke-width:1.2}
.phe-heart-h{fill:color-mix(in srgb,var(--c-pheheart) 40%,#fff);opacity:.55}
.phe-head{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:1.1;opacity:.95}
.phe-neck{fill:var(--c-donor);opacity:.8}
.phe-ray{stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.phe-skin{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1;opacity:.85}
.phe-gland{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.p-cat{--cc:#ff9a3d}.p-met{--cc:#2ec4b6}
.dr-g-fill.g-met{fill:#2ec4b6}.dr-g-fill.g-sweat{fill:var(--c-fl)}.dr-g-fill.g-head{fill:var(--c-bad)}
`,
});
