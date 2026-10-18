/* Biologics in type 2 airway and skin inflammation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/biologics.mjs [--print-model]
 * Static layout here; cells, mediators and gauges move in biologics.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease activity", a: [0.45, 1, 0.15], names: ["untreated", "severe", "controlled"], ticks: ["untreated", "severe asthma or atopic dermatitis", "controlled"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "anti-IgE (binds free IgE)" },
    { label: "anti-IL-5 (blocks IL-5)" },
    { label: "anti-IL-4 receptor (blocks IL-4 and IL-13 signals)" },
  ],
  status: "Disease: {level} · {drug} ·",
  drugNames: ["no treatment", "anti-IgE", "anti-IL-5", "anti-IL-4 receptor"],
};
function modelOf(S, level, drug) {
  const BANDS = { ig: [0.25, 0.55], eo: [0.25, 0.55], ma: [0.3, 0.7], fl: [0.35, 0.7] };
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const ige = drug === 1 ? a * 0.12 : drug === 3 ? a * 0.5 : a;
  const il5 = drug === 2 ? a * 0.15 : drug === 1 ? a * 0.5 : drug === 3 ? a * 0.6 : a;
  const il4 = drug === 3 ? a * 0.22 : a;
  const mast = cl(0.05 + 0.9 * (0.35 * a + 0.65 * ige));
  const eos = cl(0.05 + 0.92 * il5);
  const flare = cl(0.03 + 0.4 * mast + 0.35 * eos + (drug === 3 ? 0.06 : 0.2) * a);
  const ctrl = cl(1 - flare);
  const w = (v, t, ws) => (v < t[0] ? ws[0] : v < t[1] ? ws[1] : ws[2]);
  const igeW = drug === 1 && ige < 0.3 ? "blocked" : w(ige, BANDS.ig, ["low", "raised", "high"]);
  const words = [igeW, w(eos, BANDS.eo, ["low", "raised", "high"]), w(mast, BANDS.ma, ["quiet", "primed", "firing"]), w(flare, BANDS.fl, ["calm", "ongoing", "severe"])];
  return { a, drug, ige, il5, il4, mast, eos, flare, ctrl, words, readout: "free IgE " + words[0] + " · eosinophils " + words[1] + " · mast cells " + words[2] + " · flare " + words[3] };
}
const TESTS = [
  [0, 0, "free IgE raised · eosinophils raised · mast cells primed · flare ongoing"],
  [1, 0, "free IgE high · eosinophils high · mast cells firing · flare severe"],
  [1, 2, "free IgE high · eosinophils low · mast cells firing · flare ongoing"],
  [1, 3, "free IgE raised · eosinophils high · mast cells primed · flare ongoing"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="bl-box" x="24" y="80" width="300" height="192" rx="14"/>
<rect id="airLumen" class="bl-lumen" x="32" y="88" width="284" height="48" rx="10"/>
<rect id="airRed" class="bl-red" x="24" y="136" width="300" height="136" rx="14" opacity="0"/>
<text class="sc-zone" x="40" y="100">AIRWAY LUMEN</text>
<rect class="bl-box" x="636" y="80" width="300" height="192" rx="14"/>
<rect id="skinRed" class="bl-red" x="636" y="134" width="300" height="138" rx="14" opacity="0"/>
<rect id="skinEpi" class="bl-sepi" x="644" y="108" width="284" height="26" rx="8"/>
<text class="sc-zone" x="850" y="100">SKIN</text>
<g id="arrows"></g>
<g id="muc"></g><g id="epi"></g><g id="musc"></g><g id="skin"></g>
<g id="immune"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "biologics-type2-inflammation", fig: "Fig 1", title: "Biologics in type 2 airway and skin inflammation", W, H, body,
  label: "An animated scene of type 2 airway and skin inflammation and where biologics act. Allergen wakes Th2 cells through dendritic cells. Th2 cells release IL-4, IL-5 and IL-13. IL-4 makes B cells switch to IgE, which arms mast cells in the airway and the skin. IL-5 calls in eosinophils. IL-13 drives mucus, tight muscle and skin barrier loss. Anti-IgE mops up free IgE, anti-IL-5 removes IL-5, and anti-IL-4 receptor blocks IL-4 and IL-13 signals. Gauges show Th2 activity, free IgE, eosinophils, mast firing, flare and control.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "biologics.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How type 2 inflammation runs.</strong> Allergen picked up by dendritic cells wakes Th2 helper cells. Th2 cytokines split the work: IL-4 pushes B cells to switch to IgE and grows the Th2 response, IL-5 calls in eosinophils and keeps them alive, IL-13 drives mucus, twitchy airway muscle and skin barrier loss. IgE arms mast cells in airway and skin, and allergen cross linking fires them to release histamine and other mediators. This is standard teaching in allergy and dermatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What the biologics do.</strong> Anti-IgE binds free IgE so mast cells are less well armed. Anti-IL-5 removes IL-5 so eosinophils fall. Anti-IL-4 receptor blocks the shared alpha chain for IL-4 and IL-13, calming mucus, barrier loss and IgE switching. Injection reactions can occur with each, rare anaphylaxis is a watch out with anti-IgE, and eye irritation with anti-IL-4 receptor. These are teaching toggles only.",
  ],
  simplified: "Blood eosinophil cut offs and biomarker selection, dosing and intervals, non type 2 and neutrophilic disease, infections and parasites, vaccines, stopping rules, cost, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.bl-box{fill:color-mix(in srgb,var(--c-lymph) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.bl-lumen{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.bl-sepi{fill:color-mix(in srgb,#d9a48a 55%,var(--anatomy-paper));stroke:color-mix(in srgb,#b97a5a 70%,#000);stroke-width:.8}
.bl-red{fill:var(--c-bad)}
.bl-mus{fill:var(--c-sm);stroke:color-mix(in srgb,var(--c-sm) 55%,#000);stroke-width:.8}
.bl-mus-n{fill:color-mix(in srgb,var(--c-sm) 40%,#1a1030);opacity:.7}
.bl-col{fill:var(--anatomy-mid)}
.cl-epi{--cc:#d7a48a}.cl-dc{--cc:#4fc3b0}
body[data-theme="light"] .cl-epi{--cc:#c98a6c}
.ab-y{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
.blk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}.blk-x{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.rec-sh{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round}
.dend{fill:none;stroke:#4fc3b0;stroke-width:1.4;stroke-linecap:round}
.ige-y{fill:none;stroke:var(--c-ab);stroke-width:1.5;stroke-linecap:round}
.gran{fill:color-mix(in srgb,var(--c-mast) 60%,#fff);stroke:color-mix(in srgb,var(--c-mast) 70%,#000);stroke-width:.4}
.mucus{fill:color-mix(in srgb,#9fd0e0 70%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 80%,#000);stroke-width:.8}
.ar{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:3 4}.arh{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.p-il4{--cc:var(--c-cyt2)}.p-il5{--cc:var(--c-eos)}.p-il13{--cc:var(--c-cyt)}.p-ige{--cc:var(--c-ab)}.p-hist{--cc:#ff5c8a}
.p-alg{fill:#d9a24a;stroke:#8a5a14;stroke-width:.7}
.dr-g-fill.g-mast{fill:var(--c-mast)}
.sc-note{fill:var(--anatomy-mid);font-size:10.5px;text-anchor:middle}
`,
});
