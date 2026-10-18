/* Schizophrenia dopamine pathways as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/schizo.mjs [--print-model]
 * Static layout here; dopamine signals, D2 blockade and effects move in schizo.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Blockade level", a: [0, 0.55, 1], names: ["untreated", "treated", "over-blocked"], ticks: ["untreated", "treated", "over-blocked"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "typical antipsychotic" },
    { label: "atypical antipsychotic" },
  ],
  status: "State: {level} · {drug} ·",
  drugNames: ["no antipsychotic", "a typical antipsychotic", "an atypical antipsychotic"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const MULT = [[0, 0, 0, 0], [1, 1, 1, 1], [0.95, 0.9, 0.4, 0.55]];
  const mm = MULT[drug] || MULT[0];
  const Bm = cl(a * mm[0]), Bc = cl(a * mm[1]), Bn = cl(a * mm[2]), Bt = cl(a * mm[3]);
  const ML = cl(0.95 - 0.78 * Bm);
  const MC = cl(0.26 - 0.06 * Bc + (drug === 2 ? 0.05 : 0));
  const NS = cl(0.95 - 0.85 * Bn);
  const TI = cl(0.92 - 0.82 * Bt);
  const Pos = cl(0.92 - 0.75 * Bm);
  const Neg = cl(0.88 - 0.55 * MC);
  const EPS = cl(1 - NS - 0.0);
  const PRL = cl(0.14 + 0.78 * Bt);
  const B = Bm;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Pos, 0.35, 0.65, ["controlled", "moderate", "marked"]), w(Neg, 0.4, 0.65, ["mild", "present", "marked"]), w(EPS, 0.25, 0.55, ["none", "some", "marked"]), w(PRL, 0.3, 0.6, ["normal", "raised", "high"])];
  return { a, Bm, Bc, Bn, Bt, B, ML, MC, NS, TI, Pos, Neg, EPS, PRL, words, readout: "positive symptoms " + words[0] + " · negative symptoms " + words[1] + " · movement effects " + words[2] + " · prolactin " + words[3] };
}
const TESTS = [
  [0, 0, "positive symptoms marked · negative symptoms marked · movement effects none · prolactin normal"],
  [1, 1, "positive symptoms moderate · negative symptoms marked · movement effects some · prolactin raised"],
  [1, 2, "positive symptoms moderate · negative symptoms marked · movement effects none · prolactin raised"],
  [2, 1, "positive symptoms controlled · negative symptoms marked · movement effects marked · prolactin high"],
];

/* ---------------- static layout ---------------- */
/* Lanes y 135, 210, 285, 360. Sources x150 r26, targets x790 r34, D2 gates x470.
   Pathway pills centred x320 above each arrow; outcome pills centred x888 right of targets. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">FOUR DOPAMINE PATHWAYS IN SCHIZOPHRENIA</text>
<text class="sc-lab sc-dim" x="34" y="86">excess, deficit and D2 blockade differ by pathway</text>
<defs><marker id="sz-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sz-head" d="M0 0L10 5L0 10z"/></marker></defs>
<g id="links">
<path class="sz-arrow" d="M178 135L752 135" marker-end="url(#sz-arr)"/>
<path class="sz-arrow" d="M178 210L752 210" marker-end="url(#sz-arr)"/>
<path class="sz-arrow" d="M178 285L752 285" marker-end="url(#sz-arr)"/>
<path class="sz-arrow" d="M178 360L752 360" marker-end="url(#sz-arr)"/>
</g>
<g id="nodes"></g>
<g id="gates"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sz-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.sz-head{fill:var(--anatomy-mid);stroke:none}
.cl-vta{--cc:#e9b84a}.cl-nigra{--cc:#d98a4b}.cl-arc{--cc:#7fb069}.cl-limb{--cc:#e07856}.cl-pfc{--cc:#5fa8a0}.cl-stri{--cc:#7fc4e8}.cl-pit{--cc:#c9788a}
.p-da{--cc:#e9b84a}.p-prl{--cc:#e5488a}.p-drug{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.7}
.g-szblock{fill:#e9b84a}.g-szmeso{fill:#e07856}.g-szpos{fill:#e5484d}.g-szcort{fill:#5fa8a0}.g-szeps{fill:#f08a4b}.g-szprl{fill:#e5488a}
.sz-node-t{fill:var(--anatomy-strong);font-size:9.5px;font-weight:600;pointer-events:none}
.sz-gate{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.sz-rec{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
body[data-theme="light"] .p-da{--cc:#b8860b}
body[data-theme="light"] .g-szblock{fill:#b8860b}
`;

buildScene({
  id: "schizophrenia-dopamine-pathways", fig: "Fig 1", title: "Schizophrenia: dopamine pathways and D2 blockade", W, H, body, extraCss,
  label: "An animated diagram of four dopamine pathways in schizophrenia. The mesolimbic pathway from the ventral tegmental area to the limbic area carries excess dopamine signal and drives positive symptoms. The mesocortical pathway to the prefrontal cortex carries too little signal and underlies negative and cognitive symptoms. The nigrostriatal pathway to the striatum and the tuberoinfundibular pathway from the hypothalamus to the pituitary start near normal. Antipsychotics block D2 receptors in all pathways, so stronger blockade eases positive symptoms but can cause movement effects through the nigrostriatal pathway and raise prolactin through the tuberoinfundibular pathway. Typical agents block more broadly, atypical agents spare movement and prolactin pathways relatively. Gauges show blockade, mesolimbic excess, positive symptoms, cortical signal, movement effects and prolactin.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "schizo.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without antipsychotic", withLabel: "With antipsychotic",
  sourcesLis: [
    "<strong>The dopamine hypothesis in brief.</strong> Excess dopamine signalling in the mesolimbic pathway (ventral tegmental area to nucleus accumbens and related limbic areas) is linked to positive symptoms such as delusions and hallucinations. Too little dopamine signalling in the mesocortical pathway (ventral tegmental area to prefrontal cortex) is linked to negative symptoms (blunted affect, avolition, social withdrawal) and cognitive symptoms. The nigrostriatal pathway (substantia nigra to striatum) controls movement, and the tuberoinfundibular pathway (arcuate nucleus of the hypothalamus to the pituitary) normally restrains prolactin release. This is standard teaching in psychiatry and psychopharmacology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What D2 blockade does.</strong> Antipsychotics block dopamine D2 receptors. Blocking the mesolimbic pathway reduces positive symptoms, but D2 receptors cannot be blocked in one pathway alone. Nigrostriatal blockade causes extrapyramidal side effects (acute dystonia, parkinsonism, akathisia and, with time, tardive dyskinesia). Tuberoinfundibular blockade removes dopamine restraint on the pituitary, so prolactin rises. Cortical dopamine deficit is not corrected by D2 blockade, so negative and cognitive symptoms often persist. This is flagged for review.",
    "<strong>Typical compared with atypical.</strong> In this teaching simplification, a typical (first generation) antipsychotic blocks D2 receptors strongly across all pathways, so movement effects and prolactin rise are prominent at high blockade. An atypical (second generation) antipsychotic is drawn as achieving similar mesolimbic blockade with relatively less nigrostriatal and tuberoinfundibular blockade, so movement effects and prolactin rise are smaller for the same treated state. Individual agents differ a lot, and some atypical agents raise prolactin clearly; the figure does not rank real medicines. These are teaching toggles only.",
  ],
  simplified: "Glutamate, serotonin, neurodevelopmental and genetic accounts of schizophrenia, positive symptom circuitry beyond the mesolimbic pathway, subtypes and time course of extrapyramidal effects, galactorrhoea and bone effects of raised prolactin, metabolic and other adverse effects, agent by agent differences within each class, clozapine and treatment resistance, psychological and social treatment, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
