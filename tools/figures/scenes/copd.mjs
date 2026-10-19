/* COPD as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/copd.mjs [--print-model]
 * Static layout here; smoke, mucus, alveoli and gauges move in copd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease severity", a: [0.3, 0.6, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "bronchodilator" },
    { label: "inhaled steroid" },
    { label: "oxygen" },
    { label: "smoking cessation" },
  ],
  status: "COPD: {level} · {drug} ·",
  drugNames: ["no treatment", "bronchodilator", "inhaled steroid", "oxygen", "smoking cessation"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const bron = drug === 1 ? 1 : 0, ics = drug === 2 ? 1 : 0, oxy = drug === 3 ? 1 : 0, cess = drug === 4 ? 1 : 0;
  const smoke = cess ? 0 : cl(0.25 + 0.75 * a);
  const infl = cl((0.08 + 0.85 * a) * (ics ? 0.5 : 1) * (cess ? 0.6 : 1));
  const muc = cl(0.05 + 0.85 * a * (ics ? 0.55 : 1) * (cess ? 0.66 : 1));
  const dmg = cl(0.04 + 0.9 * a * a * (cess ? 0.9 : 1));
  const narrowRaw = cl(0.06 + 0.38 * muc + 0.3 * infl + 0.22 * dmg);
  const narrow = cl(narrowRaw * (bron ? 0.5 : 1) * (ics ? 0.92 : 1) * (cess ? 0.9 : 1));
  const air = cl(1 - 0.7 * narrow - 0.28 * dmg);
  const trap = cl(0.04 + 0.55 * (1 - air) + 0.38 * dmg);
  const exac = cl((0.05 + 0.6 * infl + 0.35 * muc) * (bron ? 0.75 : 1));
  const oxyB = cl(0.25 + 0.65 * air - 0.25 * trap + (oxy ? 0.5 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(muc, 0.3, 0.62, ["thin", "thick", "plugging"]), w(dmg, 0.28, 0.58, ["little", "some", "marked"]), w(air, 0.32, 0.62, ["low", "reduced", "open"]), w(oxyB, 0.45, 0.7, ["low", "reduced", "near normal"])];
  return { a, bron, ics, oxy, cess, smoke, infl, muc, dmg, narrow, air, trap, exac, oxyB, words, readout: "mucus " + words[0] + " · alveolar damage " + words[1] + " · airflow " + words[2] + " · oxygen " + words[3] };
}
const TESTS = [
  [0, 0, "mucus thick · alveolar damage little · airflow open · oxygen reduced"],
  [2, 0, "mucus plugging · alveolar damage marked · airflow low · oxygen low"],
  [2, 1, "mucus plugging · alveolar damage marked · airflow reduced · oxygen low"],
  [2, 4, "mucus thick · alveolar damage marked · airflow reduced · oxygen low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="310" rx="16"/>
<rect class="sc-tissue" x="490" y="44" width="456" height="310" rx="16"/>
<rect class="sc-tissue" x="14" y="362" width="932" height="80" rx="16" opacity="0.7"/>
<text class="sc-zone" x="34" y="68">CHRONIC BRONCHITIS</text>
<text class="sc-zone" x="712" y="68">EMPHYSEMA</text>
<text class="sc-zone sc-dim" x="34" y="384">AIRFLOW AND AIR TRAPPING</text>
<rect id="bronLumen" class="copd-lumen" x="34" y="176" width="416" height="52" rx="14"/>
<path id="bronchusLink" class="copd-link" d="M444 202 C500 202 520 209 582 209"/>
<rect id="flowTube" class="copd-lumen" x="34" y="392" width="660" height="38" rx="14"/>
<g id="lungSlot"></g><g id="smokeG"></g><g id="bron"></g><g id="alv"></g><g id="flowG"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "copd-emphysema-bronchitis", fig: "Fig 1", title: "COPD: bronchitis and emphysema to trapped air", W, H, body,
  label: "An animated view of chronic obstructive pulmonary disease. Smoke injures the airways and air sacs. In chronic bronchitis the airway wall thickens, goblet cells and glands make too much mucus, and mucus narrows the airway. In emphysema the walls between air sacs break down, sacs enlarge, elastic recoil is lost and air is trapped on breathing out. Narrowed airways and lost recoil limit airflow, lower blood oxygen and raise the risk of a flare up called an exacerbation. Gauges show mucus, alveolar damage, airflow, trapped air, oxygen and exacerbation risk. Treatment choices include a bronchodilator, an inhaled steroid, oxygen and smoking cessation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "copd.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With smoking cessation",
  sourcesLis: [
    "<strong>How COPD develops.</strong> Long term inhaled smoke and other irritants inflame the small airways and lung tissue. Chronic bronchitis is the pattern of a thickened, inflamed airway wall with more and larger goblet cells and submucosal glands making too much mucus, so the airway narrows and cough brings up sputum. Emphysema is the pattern of destroyed walls between air sacs (alveoli): sacs merge into larger, floppy spaces, elastic recoil and the tethering that holds small airways open are lost, and air is trapped when breathing out. Both patterns often occur together and both limit airflow, most clearly on breathing out. A flare up, called an exacerbation and often set off by infection, makes inflammation, mucus and narrowing suddenly worse. This is standard teaching in respiratory medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A bronchodilator relaxes airway smooth muscle and eases airflow without undoing wall damage. An inhaled steroid calms airway inflammation and mucus and lowers flare up risk in selected patterns, but does not rebuild alveolar walls. Oxygen supports blood oxygen when it is low but does not open airways or repair sacs. Stopping smoking removes the ongoing injury and slows further damage, though destroyed alveolar walls do not regrow in this schematic. These are teaching toggles only.",
  ],
  simplified: "Alpha-1 antitrypsin deficiency, occupational and biomass exposures in detail, pulmonary hypertension and right heart strain, infection organisms, vaccines, pulmonary rehabilitation, inhaler technique, exacerbation hospital care, surgery and transplant, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-epi{--cc:#d7a48a}.cl-gob{--cc:#7fb5c9}
body[data-theme="light"] .cl-epi{--cc:#c98a6c}body[data-theme="light"] .cl-gob{--cc:#5a9db6}
.copd-lumen{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.copd-wall{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 60%,#000);stroke-width:.8}
.copd-mucus{fill:color-mix(in srgb,#9fd0e0 72%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 80%,#000);stroke-width:.8}
.copd-muscle{fill:var(--c-sm);stroke:color-mix(in srgb,var(--c-sm) 55%,#000);stroke-width:.8}
.alv-sac{fill:color-mix(in srgb,var(--c-lymph) 20%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.8}
.alv-sept{stroke:var(--c-lymph);stroke-width:1.6;stroke-linecap:round}
.copd-cap{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:.8}
.p-smoke{fill:var(--anatomy-mid)}
.p-air{--cc:var(--c-fl)}.p-o2{--cc:#5fd0f5}.p-muc{--cc:#5a9db6}.p-bron{--cc:#2ec4b6}.p-ster{--cc:#e0a93e}.p-clean{--cc:#bfe3ec}
.copd-link{fill:none;stroke:color-mix(in srgb,var(--c-fl) 40%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;opacity:.9}
.copd-infl{fill:var(--c-bad);stroke:none}
.copd-cig{fill:#e8e2d5;stroke:#999;stroke-width:.8}
.copd-ember{fill:#f08a2e;stroke:none}
.copd-ember.copd-out{fill:#8a8a8a}
.copd-emberglow{fill:#f08a2e;stroke:none}
.copd-cap.copd-ox{fill:#5fd0f5;stroke:#5fd0f5}
.copd-note{fill:var(--anatomy-strong);font-size:12px}
.copd-flare{fill:var(--c-bad)}
.arh{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.trap-sac{fill:color-mix(in srgb,var(--c-lymph) 24%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:2}
.dr-g-fill.g-muc2{fill:#5a9db6}.dr-g-fill.g-dmg{fill:var(--c-bad)}.dr-g-fill.g-air2{fill:var(--c-good)}.dr-g-fill.g-trap{fill:var(--c-cyt)}.dr-g-fill.g-oxy{fill:#5fd0f5}.dr-g-fill.g-exac{fill:var(--c-eos)}
`,
});
