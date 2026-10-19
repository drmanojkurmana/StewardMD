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
  level: { label: "Illness intensity", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "typical antipsychotic" },
    { label: "atypical antipsychotic" },
  ],
  status: "Illness: {level} · {drug} ·",
  drugNames: ["no antipsychotic", "a typical antipsychotic", "an atypical antipsychotic"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const fM = drug === 1 ? 1 : drug === 2 ? 0.95 : 0;
  const fC = drug === 1 ? 1 : drug === 2 ? 0.9 : 0;
  const fN = drug === 1 ? 1 : drug === 2 ? 0.2 : 0;
  const fT = drug === 1 ? 1 : drug === 2 ? 0.55 : 0;
  const ML = cl(a * (1 - 0.8 * fM) + 0.08);
  const MC = cl(0.26 - 0.06 * fC + (drug === 2 ? 0.05 : 0));
  const NS = cl(0.95 - 0.85 * fN);
  const TI = cl(0.92 - 0.82 * fT);
  const Pos = cl(ML * 0.95);
  const Neg = cl(0.55 + 0.35 * a - 0.55 * MC);
  const EPS = cl(1 - NS);
  const PRL = cl(0.14 + 0.78 * fT);
  const B = Math.max(fM, fC, fN, fT);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Pos, 0.35, 0.65, ["controlled", "moderate", "marked"]), w(Neg, 0.4, 0.65, ["mild", "present", "marked"]), w(EPS, 0.25, 0.55, ["none", "some", "marked"]), w(PRL, 0.3, 0.6, ["normal", "raised", "high"])];
  return { a, Bm: fM, Bc: fC, Bn: fN, Bt: fT, B, ML, MC, NS, TI, Pos, Neg, EPS, PRL, words, readout: "positive symptoms " + words[0] + " · negative symptoms " + words[1] + " · movement effects " + words[2] + " · prolactin " + words[3] };
}
const TESTS = [
  [2, 0, "positive symptoms marked · negative symptoms marked · movement effects none · prolactin normal"],
  [0, 0, "positive symptoms moderate · negative symptoms present · movement effects none · prolactin normal"],
  [2, 2, "positive symptoms controlled · negative symptoms marked · movement effects none · prolactin raised"],
  [2, 1, "positive symptoms controlled · negative symptoms marked · movement effects marked · prolactin high"],
];

/* ---------------- static layout ---------------- */
/* A real brain anchors the left of the stage. Four dopamine roads run left to
   right from midbrain source cells to their targets, one D2 gate per road in
   the middle. Lanes, gates, nodes and pills are placed from the brain ports in
   schizo.page.js so vessels and particles meet real anatomy. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">FOUR DOPAMINE ROADS</text>
<text class="sc-lab sc-dim" x="34" y="86">too much, too little, and blockade on every road</text>
<defs><marker id="sz-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sz-head" d="M0 0L10 5L0 10z"/></marker></defs>
<g id="brainSlot"></g>
<g id="lanes"></g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sz-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.sz-head{fill:var(--anatomy-mid);stroke:none}
.sz-hot{fill:#e5484d;stroke:none}
.sz-eps{fill:none;stroke:#f08a4b;stroke-width:2}
.sz-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-vta{--cc:#e9b84a}.cl-nigra{--cc:#d98a4b}.cl-arc{--cc:#7fb069}.cl-limb{--cc:#e07856}.cl-pfc{--cc:#5fa8a0}.cl-stri{--cc:#7fc4e8}.cl-pit{--cc:#c9788a}
.p-da{--cc:#e9b84a}.p-prl{--cc:#e5488a}.p-drug{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.7}
.g-szblock{fill:#e9b84a}.g-szmeso{fill:#e07856}.g-szpos{fill:#e5484d}.g-szeps{fill:#f08a4b}.g-szprl{fill:#e5488a}
.sz-gate{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.sz-rec{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
body[data-theme="light"] .p-da{--cc:#b8860b}
body[data-theme="light"] .g-szblock{fill:#b8860b}
`;

buildScene({
  id: "schizophrenia-dopamine-pathways", fig: "Fig 1", title: "Schizophrenia: dopamine pathways and D2 blockade", W, H, body, extraCss,
  label: "An animated diagram of four dopamine roads in schizophrenia, anchored on a real brain. Dopamine cell groups deep in the brain feed four roads. The top voices road from the VTA to the limbic area floods with signal and drives delusions and hallucinations. The second flat road from the VTA to the front of the brain carries too little signal and brings flat mood and withdrawal. The movement road and the hormone road start near normal. One D2 gate sits on each road. Medicine caps every gate at once, so the flood calms but movement can stiffen and prolactin can flow. A typical medicine caps all four gates hard, an atypical medicine caps the top gates most and spares the movement and hormone gates relatively.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "schizo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without antipsychotic", withLabel: "With atypical antipsychotic",
  sourcesLis: [
    "<strong>The dopamine hypothesis in brief.</strong> Excess dopamine signalling in the mesolimbic pathway (ventral tegmental area to nucleus accumbens and related limbic areas) is linked to positive symptoms such as delusions and hallucinations. Too little dopamine signalling in the mesocortical pathway (ventral tegmental area to prefrontal cortex) is linked to negative symptoms (blunted affect, avolition, social withdrawal) and cognitive symptoms. The nigrostriatal pathway (substantia nigra to striatum) controls movement, and the tuberoinfundibular pathway (arcuate nucleus of the hypothalamus to the pituitary) normally restrains prolactin release. This is standard teaching in psychiatry and psychopharmacology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What D2 blockade does.</strong> Antipsychotics block dopamine D2 receptors. Blocking the mesolimbic pathway reduces positive symptoms, but D2 receptors cannot be blocked in one pathway alone. Nigrostriatal blockade causes extrapyramidal side effects (acute dystonia, parkinsonism, akathisia and, with time, tardive dyskinesia). Tuberoinfundibular blockade removes dopamine restraint on the pituitary, so prolactin rises. Cortical dopamine deficit is not corrected by D2 blockade, so negative and cognitive symptoms often persist. This is flagged for review.",
    "<strong>Typical compared with atypical.</strong> In this teaching simplification, a typical (first generation) antipsychotic blocks D2 receptors strongly across all pathways, so movement effects and prolactin rise are prominent. An atypical (second generation) antipsychotic is drawn as achieving similar mesolimbic blockade with relatively less nigrostriatal and tuberoinfundibular blockade, so movement effects and prolactin rise are smaller for the same treated state. Individual agents differ a lot, and some atypical agents raise prolactin clearly; the figure does not rank real medicines. These are teaching toggles only.",
  ],
  simplified: "Glutamate, serotonin, neurodevelopmental and genetic accounts of schizophrenia, positive symptom circuitry beyond the mesolimbic pathway, subtypes and time course of extrapyramidal effects, galactorrhoea and bone effects of raised prolactin, metabolic and other adverse effects, agent by agent differences within each class, clozapine and treatment resistance, psychological and social treatment, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
