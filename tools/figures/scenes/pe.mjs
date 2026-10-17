/* Pulmonary embolism as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pe.mjs [--print-model]
 * Layout and model here; leg vein, lung artery, heart and gauges move in pe.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Clot burden in the lungs", a: [0.4, 0.7, 1], names: ["small", "moderate", "large"], ticks: ["small", "moderate", "large"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "anticoagulant only (stops the clot growing)" },
    { label: "clot-dissolving drug only (breaks up the clot)" },
    { label: "anticoagulant with oxygen and careful fluids (full treatment)" },
  ],
  status: "Clot burden: {level} · {drug} ·",
  drugNames: ["no treatment", "an anticoagulant only", "a clot-dissolving drug only", "an anticoagulant with support"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const ac = drug === 1 || drug === 3 ? 1 : 0, ly = drug === 2 ? 1 : 0, sup = drug === 3 ? 1 : 0;
  const Occ = cl(a * (ac ? 0.8 : 1) * (ly ? 0.25 : 1));      // share of lung blood flow blocked by embolus
  const Flow = cl(1 - Occ);                                  // flow reaching the lung capillaries
  const Ds = cl(Occ * 1.05);                                 // dead space: ventilated sacs with no blood behind the block
  const Hx = cl(0.06 + 0.88 * Ds * (sup ? 0.55 : 1));        // hypoxic load; supplemental oxygen eases it
  const O = cl(1 - Hx);                                      // oxygen in blood leaving the lungs
  const St = cl(0.03 + 0.85 * Occ * (ly ? 0.45 : 1) - 0.22 * sup * Occ);  // right heart strain against the block
  const BP = cl(0.96 - 0.45 * St - 0.1 * Ds + 0.1 * sup);    // systemic pressure follows pump output and support
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Flow, 0.35, 0.7, ["blocked", "reduced", "open"]), w(O, 0.35, 0.7, ["very low", "low", "normal"]), w(St, 0.4, 0.7, ["normal", "strained", "failing"])];
  return { a, ac, ly, sup, Occ, Flow, Ds, Hx, O, St, BP, words, readout: "lung flow " + words[0] + " · oxygen " + words[1] + " · right heart " + words[2] };
}
const TESTS = [
  [2, 0, "lung flow blocked · oxygen very low · right heart failing"],
  [1, 0, "lung flow blocked · oxygen very low · right heart strained"],
  [2, 2, "lung flow open · oxygen normal · right heart normal"],
  [2, 3, "lung flow blocked · oxygen low · right heart strained"],
];

/* ---------------- static layout ---------------- */
const EX = 470;                                              // embolus x on the lung vessel
const body = `
<rect class="sc-tissue" x="14" y="44" width="250" height="266" rx="16"/>
<rect class="sc-tissue" x="274" y="44" width="380" height="266" rx="16"/>
<rect class="sc-tissue" x="664" y="44" width="282" height="266" rx="16"/>
<rect class="sc-tissue" x="14" y="318" width="932" height="124" rx="16" opacity="0.7"/>
<text class="sc-zone" x="34" y="68">LEG VEIN: CLOT FORMS</text>
<text class="sc-zone" x="294" y="68">LUNG ARTERY: CLOT LODGES</text>
<text class="sc-zone" x="684" y="68">RIGHT HEART: STRAIN</text>
<text class="sc-zone sc-dim" x="32" y="338">BLOOD TO THE BODY</text>
<path id="travel" class="pe-dash" d="M150 96C210 78 250 88 292 140"/>
<rect id="lumen" class="sc-lumen" x="14" y="344" width="932" height="44"/>
<g id="leg"></g><g id="lung"></g><g id="heart"></g><g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pulmonary-embolism", fig: "Fig 1", title: "Pulmonary embolism: clot to strained heart", W, H, body,
  label: "An animated path from a leg vein clot to the lungs and heart. A clot forms in a deep leg vein, pieces break off and travel to the lung artery, where an embolus blocks flow to one region. Sacs beyond the block still get air but no blood, which is dead space, so blood oxygen falls and the right side of the heart strains against the blockage. Gauges show clot, lung flow, dead space, blood oxygen, right heart strain and blood pressure. Treatment choices are an anticoagulant, a clot-dissolving drug, and an anticoagulant with oxygen and careful fluids.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, times or numbers are shown or implied.",
  scene: { W, H, EX, travel: [[150, 96], [210, 78], [250, 88], [292, 140]] }, pageJs: readFileSync(join(HERE, "pe.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How pulmonary embolism develops.</strong> A deep vein thrombosis, usually in the calf or thigh, sheds pieces that travel with venous blood through the right side of the heart into the pulmonary arteries, where they lodge as emboli. The blocked region keeps being ventilated but is no longer perfused, which is alveolar dead space: it wastes ventilation and lowers the oxygen in blood leaving the lungs. The right ventricle must pump against the sudden blockage, so its pressure rises, the septum bows toward the left, output falls and blood pressure can drop. An anticoagulant stops the clot growing and new clot forming, a clot-dissolving drug breaks the embolus up, and oxygen with careful fluids supports the patient while the body clears the clot. This is standard teaching in medicine and respiratory texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An anticoagulant to stop growth and further clots, a clot-dissolving drug to break up a large blocking embolus, and oxygen with careful fluids to support oxygen levels and output. These are teaching toggles only.",
  ],
  simplified: "Risk factors and prevention, clot in the heart or already in the lungs, saddle and chronic emboli, pulmonary infarction, diagnosis by scan and blood tests, filters, surgery to remove clot, bleeding risk, fluid harm in a failing right ventricle, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pe-dash{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 5}
.pe-vein{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:2}
.pe-valve{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.pe-shield{fill:var(--anatomy-paper);stroke:var(--c-good);stroke-width:1.8}
.pe-tick{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.pe-air{fill:color-mix(in srgb,var(--c-lymph) 30%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.pe-sac{fill:color-mix(in srgb,var(--c-lymph) 22%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.6}
.pe-ds{fill:color-mix(in srgb,#9aa3ad 55%,var(--anatomy-paper));stroke:#9aa3ad;stroke-width:1.2}
.pe-cap{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1.6}
.pe-pale{fill:#8b93a0}
.pe-emb{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--c-plt));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.pe-fib{stroke:#f6f1e0;stroke-width:1.1;opacity:.85}
.pe-ra{fill:color-mix(in srgb,#5f8fd0 30%,var(--anatomy-paper));stroke:#5f8fd0;stroke-width:1.6}
.pe-rv{fill:color-mix(in srgb,#5f8fd0 42%,var(--anatomy-paper));stroke:#3f6fa8;stroke-width:1.8}
.pe-rvc{fill:color-mix(in srgb,#5f8fd0 64%,var(--anatomy-paper));stroke:#3f6fa8;stroke-width:1}
.pe-la{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1.6}
.pe-lv{fill:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1.8}
.pe-cav{fill:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper))}
.pe-sept{fill:color-mix(in srgb,var(--c-rbc) 45%,#5f8fd0);stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:.8}
.pe-pa{fill:none;stroke:#5f8fd0;stroke-width:10;stroke-linecap:round}
.pe-ao{fill:none;stroke:var(--c-rbc);stroke-width:10;stroke-linecap:round}
.pe-mask{fill:color-mix(in srgb,#5fd0f5 45%,var(--anatomy-paper));stroke:#2e9cc4;stroke-width:1.4}
.pe-ly{fill:none;stroke:#ffd24a;stroke-width:1.4;stroke-linecap:round}
.p-o2{--cc:#5fd0f5}.p-waste{--cc:#9aa3ad}.p-emb{--cc:#8f2a3a}
.dr-g-fill.g-ox{fill:#5fd0f5}
`,
});
