/* Asthma pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/asthma.mjs [--print-model]
 * Static layout here; cells, mediators and gauges move in asthma.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Asthma severity", a: [0.22, 0.45, 0.68, 1], names: ["intermittent", "mild persistent", "moderate persistent", "acute severe"], ticks: ["intermittent", "mild", "moderate", "acute severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "reliever bronchodilator only" },
    { label: "inhaled corticosteroid only" },
    { label: "reliever plus inhaled corticosteroid" },
    { label: "anti-IgE biologic (add on)" },
  ],
  status: "Severity: {level} · {drug} ·",
  drugNames: ["no treatment", "reliever only", "inhaled steroid only", "reliever plus inhaled steroid", "anti-IgE biologic"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const relief = drug === 1 || drug === 3 ? 1 : 0, ics = drug === 2 || drug === 3 ? 1 : 0, bio = drug === 4 ? 1 : 0;
  const T2 = cl(a * (ics ? 0.42 : 1) * (bio ? 0.88 : 1));
  const Ig = cl(a * (bio ? 0.16 : ics ? 0.58 : 1));
  const mast = cl(0.04 + 0.88 * a * (bio ? 0.24 : 1) * (ics ? 0.6 : 1));
  const eos = cl(0.04 + 0.9 * a * (ics ? 0.36 : 1) * (bio ? 0.52 : 1));
  const muc = cl(0.04 + 0.82 * a * (ics ? 0.44 : 1) * (bio ? 0.68 : 1));
  const remod = cl(0.03 + 0.88 * a * a * (ics ? 0.58 : 1) * (bio ? 0.85 : 1));
  const rawB = cl(0.04 + 0.48 * mast + 0.26 * eos + 0.22 * muc);
  const bron = cl(rawB * (relief ? 0.28 : 1));
  const air = cl(1 - 0.68 * bron - 0.22 * muc - 0.18 * remod);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(eos, 0.28, 0.58, ["low", "raised", "high"]), w(bron, 0.3, 0.58, ["relaxed", "narrowed", "tight"]), w(muc, 0.3, 0.62, ["thin", "thick", "plugging"]), w(air, 0.32, 0.62, ["low", "reduced", "open"])];
  return { a, drug, relief, ics, bio, T2, Ig, mast, eos, muc, remod, bron, air, words, readout: "inflammation " + words[0] + " · bronchoconstriction " + words[1] + " · mucus " + words[2] + " · airflow " + words[3] };
}
const TESTS = [
  [0, 0, "inflammation low · bronchoconstriction relaxed · mucus thin · airflow open"],
  [3, 0, "inflammation high · bronchoconstriction tight · mucus plugging · airflow low"],
  [3, 1, "inflammation high · bronchoconstriction relaxed · mucus plugging · airflow reduced"],
  [3, 3, "inflammation raised · bronchoconstriction relaxed · mucus thick · airflow open"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="lumen" class="sc-air" x="14" y="44" width="${W - 28}" height="140" rx="18"/>
<text class="sc-zone" x="34" y="68">AIRWAY LUMEN</text>
<text class="sc-zone sc-dim" x="34" y="428">SUBMUCOSA AND MUSCLE</text>
<g id="arrows"></g>
<g id="mucus"></g><g id="epi"></g><g id="base"></g><g id="glands"></g><g id="vessel"></g><g id="muscle"></g>
<g id="parts"></g><g id="immune"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "asthma-pathogenesis", fig: "Fig 1", title: "Asthma: allergen to narrowed airway", W, H, body,
  label: "An animated airway wall in asthma. Inhaled allergen reaches the lining and is shown to dendritic cells. Helper T cells of the Th2 type help B cells make IgE, which arms mast cells. On re-exposure the allergen cross-links IgE, mast cells release histamine and other mediators, eosinophils are called in, goblet cells make thick mucus that can plug the lumen, and the airway smooth muscle tightens so the lumen narrows. With repeated inflammation the wall remodels: the basement membrane thickens, muscle and glands enlarge, and narrowing becomes harder to reverse. Gauges show eosinophilic inflammation, mast cell activation, mucus, bronchoconstriction, remodelling and airflow. Treatment choices include a reliever bronchodilator, an inhaled corticosteroid, both together, and an anti-IgE biologic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "asthma.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How asthma develops.</strong> In allergic asthma an inhaled allergen is taken up by dendritic cells in the airway lining and presented to helper T cells, which take a Th2 pattern. Th2 cytokines help B cells switch to making IgE (IL-4), call in and sustain eosinophils (IL-5), and drive goblet cell mucus and twitchy smooth muscle (IL-13). IgE sits on mast cells; when allergen cross-links it the mast cell degranulates, releasing histamine and other mediators that tighten smooth muscle, swell the wall and increase mucus. Eosinophil granule proteins injure the lining and keep inflammation going. Repeated inflammation remodels the wall, with a thicker basement membrane, more and larger smooth muscle and enlarged submucosal glands, so airflow limitation becomes less fully reversible. Airway hyperresponsiveness means the muscle tightens too easily and too much to triggers such as cold air, exercise, smoke and viral infection. This is standard teaching in respiratory medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A reliever bronchodilator relaxes smooth muscle and opens the airway quickly but does not treat the inflammation underneath. An inhaled corticosteroid switches off many inflammatory genes across lining, immune and mast cells, reducing eosinophils, mucus and hyperresponsiveness over time and slowing remodelling. Used together they give quick relief plus control of the cause. An anti-IgE biologic mops up IgE so mast cells are less well armed, which suits allergic disease. These are teaching toggles only.",
  ],
  simplified: "Non-allergic and neutrophilic asthma, aspirin-exacerbated disease, the late phase reaction in detail, neural control, small airway disease, infection and pollution triggers in detail, biomarker selection for biologics, inhaler technique, adherence, side effects, exacerbation management and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-epi{--cc:#d7a48a}.cl-gob{--cc:#7fb5c9}.cl-dc{--cc:#4fc3b0}
body[data-theme="light"] .cl-epi{--cc:#c98a6c}body[data-theme="light"] .cl-gob{--cc:#5a9db6}
.sc-air{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper))}
.sm-c{fill:var(--c-sm);stroke:color-mix(in srgb,var(--c-sm) 55%,#000);stroke-width:.8}.sm-n{fill:color-mix(in srgb,var(--c-sm) 40%,#1a1030);opacity:.7}
.ven{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.mucus{fill:color-mix(in srgb,#9fd0e0 70%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 80%,#000);stroke-width:.8}
.gran{fill:color-mix(in srgb,var(--c-mast) 60%,#fff);stroke:color-mix(in srgb,var(--c-mast) 70%,#000);stroke-width:.4}
.mg{fill:#9fd0e0;stroke:#5a9db6;stroke-width:.4}
.cilia{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-linecap:round}
.ar{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:3 4}.arh{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.dend{fill:none;stroke:#4fc3b0;stroke-width:1.4;stroke-linecap:round}
.ige-y{fill:none;stroke:var(--c-ab);stroke-width:1.5;stroke-linecap:round}
.basem{fill:color-mix(in srgb,#b8965a 65%,var(--anatomy-paper));stroke:color-mix(in srgb,#b8965a 70%,#000);stroke-width:.6}
.gland-b{fill:color-mix(in srgb,#7fb5c9 45%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 70%,#000);stroke-width:.7}
.coll{fill:color-mix(in srgb,#b8965a 55%,var(--anatomy-paper));opacity:.8}
.p-allergen{fill:#d9a24a;stroke:#8a5a14;stroke-width:.7}
.p-il5{--cc:var(--c-eos)}.p-il4{--cc:var(--c-cyt2)}.p-il13{--cc:var(--c-cyt)}.p-ige{--cc:var(--c-ab)}.p-hist{--cc:#ff5c8a}
.blk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}.blk-x{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}.blk-y{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round}
.bd-a{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dr-g-fill.g-mast{fill:var(--c-mast)}.dr-g-fill.g-mucus{fill:#5a9db6}.dr-g-fill.g-remod{fill:#b8965a}.dr-g-fill.g-air{fill:var(--c-good)}
`,
});
