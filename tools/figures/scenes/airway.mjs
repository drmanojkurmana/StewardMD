/* Airway inflammation (type-2 versus non-type-2 asthma) as an animated, working scene. Original drawing.
 *   node tools/figures/scenes/airway.mjs [--print-model]
 * Layout and model here; cells, mediators, block marks and gauges move in airway.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Inflammation pattern", a: [0, 1, 2], names: ["type-2 dominant", "mixed", "non-type-2 (neutrophilic)"], ticks: ["type-2", "mixed", "non-type-2"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "inhaled corticosteroid (broad anti-inflammatory)" },
    { label: "anti-IgE antibody (omalizumab class)" },
    { label: "anti-IL-5 antibody (mepolizumab or benralizumab class)" },
    { label: "anti-IL-4 receptor alpha antibody (dupilumab class)" },
    { label: "anti-TSLP antibody (tezepelumab class)" },
    { label: "bronchodilator only (beta-2 agonist)" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "inhaled corticosteroid", "anti-IgE", "anti-IL-5", "anti-IL-4 receptor alpha", "anti-TSLP", "bronchodilator only"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const t2 = [1, 0.55, 0.1][level], nt = [0.1, 0.5, 1][level];
  const ics = drug === 1 ? 1 : 0, ige = drug === 2 ? 1 : 0, il5 = drug === 3 ? 1 : 0, il4r = drug === 4 ? 1 : 0, tslp = drug === 5 ? 1 : 0, bd = drug === 6 ? 1 : 0;
  const T2 = t2 * (tslp ? 0.3 : ics ? 0.45 : 1);                 // type-2 drive: alarmins, ILC2, Th2
  const eos = cl(0.06 + 0.9 * T2 * (il5 ? 0.1 : il4r ? 0.55 : ige ? 0.8 : 1));
  const mast = cl(0.05 + 0.9 * T2 * (ige ? 0.15 : il4r ? 0.45 : 1));
  const neu = cl(0.06 + 0.9 * nt * (ics ? 0.8 : tslp ? 0.85 : 1));
  const muc = cl(0.06 + 0.6 * T2 * (il4r ? 0.25 : 1) + 0.3 * nt * (ics ? 0.8 : 1));
  const raw = 0.06 + 0.36 * mast + 0.22 * eos + 0.18 * muc + 0.2 * neu;
  const bc = cl(bd ? raw * 0.35 : raw);
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(eos, 0.25, 0.55, ["low", "raised", "high"]), w(neu, 0.25, 0.55, ["low", "raised", "high"]), w(muc, 0.3, 0.55, ["thin", "thick", "plugging"]), w(bc, 0.3, 0.55, ["open", "narrowed", "tight"])];
  return { t2, nt, T2, eos, mast, neu, muc, bc, drug, words, readout: "eosinophils " + words[0] + " · neutrophils " + words[1] + " · mucus " + words[2] + " · airway " + words[3] };
}
const TESTS = [
  [0, 0, "eosinophils high · neutrophils low · mucus plugging · airway tight"],
  [0, 3, "eosinophils low · neutrophils low · mucus plugging · airway tight"],
  [2, 0, "eosinophils low · neutrophils high · mucus thick · airway narrowed"],
  [2, 3, "eosinophils low · neutrophils high · mucus thick · airway narrowed"],
  [0, 6, "eosinophils high · neutrophils low · mucus plugging · airway open"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="lumen" class="sc-air" x="14" y="44" width="${W - 28}" height="110" rx="18"/>
<text class="sc-zone" x="34" y="68">AIRWAY LUMEN</text>
<g id="arrows"></g>
<g id="vessel"></g><g id="muscle"></g>
<g id="mucus"></g><g id="epi"></g><g id="parts"></g><g id="immune"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "airway-inflammation", fig: "Fig 1", title: "Airway inflammation: type-2 and non-type-2", W, H, body,
  label: "An animated cross-section of an airway wall. Allergens or smoke and infection reach the epithelium, which releases alarmins or IL-17 signals. In the type-2 pathway, alarmins wake ILC2 and Th2 cells that make IL-4, IL-5 and IL-13; IL-5 brings in eosinophils, IL-4 drives B cells to make IgE that arms mast cells, and IL-13 makes goblet cells produce mucus. In the non-type-2 pathway, Th17 cells and IL-17 bring in neutrophils. Mast cell mediators and inflammation make the smooth muscle tighten, so the airway narrows. Treatment choices mark the step each drug blocks.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "airway.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.cl-epi{--cc:#d7a48a}.cl-gob{--cc:#7fb5c9}.cl-dc{--cc:#4fc3b0}.cl-th17{--cc:#e17e9b}.cl-eos2{--cc:var(--c-eos)}
body[data-theme="light"] .cl-epi{--cc:#c98a6c}body[data-theme="light"] .cl-gob{--cc:#5a9db6}body[data-theme="light"] .cl-th17{--cc:#cc5a7c}
.sc-air{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper))}
.sm-c{fill:var(--c-sm);stroke:color-mix(in srgb,var(--c-sm) 55%,#000);stroke-width:.8}.sm-n{fill:color-mix(in srgb,var(--c-sm) 40%,#1a1030);opacity:.7}
.ven{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.mucus{fill:color-mix(in srgb,#9fd0e0 70%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 80%,#000);stroke-width:.8}
.gran{fill:color-mix(in srgb,var(--c-mast) 60%,#fff);stroke:color-mix(in srgb,var(--c-mast) 70%,#000);stroke-width:.4}
.mg{fill:#9fd0e0;stroke:#5a9db6;stroke-width:.4}
.cilia{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-linecap:round}
.ar{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:3 4}.arh{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.dend{fill:none;stroke:var(--c-donor);stroke-width:1.4;stroke-linecap:round;stroke:#4fc3b0}
.ige-y{fill:none;stroke:var(--c-ab);stroke-width:1.5;stroke-linecap:round}
.p-alarm{--cc:#ff9a3d}.p-il5{--cc:var(--c-eos)}.p-il4{--cc:var(--c-cyt2)}.p-il13{--cc:var(--c-cyt)}.p-ige{--cc:var(--c-ab)}.p-hist{--cc:#ff5c8a}.p-il17{--cc:#7bd96a}.p-il8{--cc:#ffd23d}
.p-allergen{fill:#d9a24a;stroke:#8a5a14;stroke-width:.7}.p-smoke{fill:var(--anatomy-muted);opacity:.6}
.blk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}.blk-x{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}.blk-y{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round}
.bd-a{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.dr-g-fill.g-mucus{fill:#5a9db6}.dr-g-fill.g-mast{fill:var(--c-mast)}.dr-g-fill.g-air{fill:var(--c-good)}
`,
  sourcesLis: [
    "<strong>Type-2 pathway.</strong> Allergens and other triggers damage or stimulate the airway lining, which releases alarmins (TSLP, IL-33, IL-25). These wake ILC2 and Th2 cells, which make IL-4, IL-5 and IL-13. IL-5 recruits and sustains eosinophils. IL-4 drives B cells to make IgE, which sits on mast cells and releases histamine and leukotrienes when an allergen cross-links it. IL-13 makes goblet cells produce thick mucus and makes the smooth muscle twitchy. This is standard teaching in respiratory medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Non-type-2 pathway.</strong> Smoke, infection and pollution drive Th17 cells and IL-17 and IL-8 release, which bring in neutrophils. This pattern responds poorly to type-2 targeted antibodies and often to inhaled steroid too.",
    "<strong>Treatments shown.</strong> The mark on the diagram shows where each class acts: an inhaled steroid switches off many inflammatory genes across cells; anti-IgE blocks IgE on mast cells; anti-IL-5 removes IL-5 signalling to eosinophils; anti-IL-4 receptor alpha blocks IL-4 and IL-13 signalling; anti-TSLP blocks an upstream alarmin; a bronchodilator only relaxes the muscle. These are teaching toggles only.",
  ],
  simplified: "Many other cell types and mediators (basophils, Th1, IL-9, IL-17 in type-2 disease, epithelial remodelling, infection triggers in detail), steroid-resistance mechanisms, biomarker use (blood eosinophils, FeNO, IgE), who qualifies for each drug, side effects, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
