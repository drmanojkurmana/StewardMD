/* Glycolysis and the TCA cycle as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/glyco.mjs [--print-model]
 * Static layout here; substrates, oxygen, products and gauges move in glyco.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Oxygen supply and energy demand", a: [0, 0.35, 1], names: ["no oxygen, high demand", "low oxygen, active", "plenty oxygen, resting"], ticks: ["none", "low", "plenty"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "thiamine (PDH cofactor)" },
    { label: "restore oxygen" },
  ],
  status: "Oxygen and demand: {level} · {drug} ·",
  drugNames: ["no treatment", "thiamine given", "oxygen restored"],
};
function modelOf(S, level, drug) {
  const o2 = S.level.a[level];
  const demand = [1, 0.75, 0.5][level];
  const thiam = drug === 1 ? 1 : 0, reox = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const effO2 = reox ? 1 : o2;
  const cofactor = thiam ? 1 : 0.55;
  const G = cl(0.38 + 0.52 * demand + 0.12 * (1 - effO2));
  const PDH = cl(G * cofactor * (0.18 + 0.82 * effO2));
  const TCA = cl(PDH * (0.25 + 0.75 * effO2));
  const Lac = cl(G - 0.9 * PDH + 0.18 * (1 - effO2));
  const E = cl(0.28 * G + 0.95 * TCA);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const gw = w(G, 0.72, 0.9, ["steady", "brisk", "very fast"]);
  const pw = w(PDH, 0.2, 0.45, ["mostly to lactate", "partly into mitochondria", "mostly into mitochondria"]);
  const tw = w(TCA, 0.15, 0.4, ["quiet", "active", "strong"]);
  const lw = w(Lac, 0.35, 0.65, ["low", "raised", "high"]);
  const ew = w(E, 0.4, 0.65, ["low", "moderate", "high"]);
  return { o2, demand, thiam, reox, effO2, cofactor, G, PDH, TCA, Lac, E, words: [gw, pw, tw, lw, ew], readout: "glycolysis " + gw + " · pyruvate " + pw + " · TCA cycle " + tw + " · lactate " + lw + " · energy " + ew };
}
const TESTS = [
  [2, 0, "glycolysis steady · pyruvate partly into mitochondria · TCA cycle active · lactate low · energy moderate"],
  [2, 1, "glycolysis steady · pyruvate mostly into mitochondria · TCA cycle strong · lactate low · energy high"],
  [0, 0, "glycolysis very fast · pyruvate mostly to lactate · TCA cycle quiet · lactate high · energy low"],
  [0, 2, "glycolysis very fast · pyruvate mostly into mitochondria · TCA cycle strong · lactate raised · energy high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="548" height="396" rx="18"/>
<rect class="gly-mito" x="578" y="44" width="368" height="396" rx="56"/>
<rect class="gly-mito2" x="592" y="58" width="340" height="368" rx="46"/>
<text class="sc-zone" x="32" y="68">CYTOSOL</text>
<text class="sc-zone" x="610" y="84">MITOCHONDRION</text>
<text class="sc-lab" x="32" y="90">glucose breakdown</text>
<path class="gly-path" d="M60 175H500"/>
<path class="gly-path" d="M500 190V340L430 375H70"/>
<path class="gly-path" d="M515 175H640L730 215L762 236"/>
<ellipse class="gly-loop" cx="815" cy="275" rx="92" ry="72"/>
<g id="parts"></g><g id="nodes"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.gly-mito{fill:color-mix(in srgb,var(--c-endo) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.gly-mito2{fill:none;stroke:var(--anatomy-mid);stroke-width:1}
.gly-path{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 5}
.gly-loop{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-dasharray:7 5}
.gly-sub{fill:#f2b23a;stroke:#8a5a10;stroke-width:1}
.gly-enz{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1}
.gly-main{fill:var(--c-eos);stroke:var(--c-neut);stroke-width:2.2}
.gly-pyr{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:1}
.gly-lac{fill:var(--c-bad);stroke:#7a1d22;stroke-width:1}
.gly-ac{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.gly-dot{fill:var(--anatomy-mid)}
.gly-ring{fill:none;stroke:var(--c-neut);stroke-width:1.4;stroke-dasharray:3 3}
.p-glu{--cc:#f2b23a}.p-pyr{--cc:var(--c-cyt2)}.p-lac{--cc:var(--c-bad)}.p-atp{--cc:var(--c-good)}.p-nadh{--cc:var(--c-cyt)}.p-o2{--cc:var(--c-fl)}.p-thi{--cc:var(--c-eos)}
.p-co2{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1}
.dr-g-fill.g-gly{fill:#f2b23a}.dr-g-fill.g-pdh{fill:var(--c-cyt2)}.dr-g-fill.g-tca{fill:var(--c-cyt)}.dr-g-fill.g-lac{fill:var(--c-bad)}.dr-g-fill.g-atp{fill:var(--c-good)}
`;

buildScene({
  id: "glycolysis-tca-cycle", fig: "Fig 1", title: "Glycolysis and the TCA cycle: glucose to energy", W, H, body, extraCss,
  label: "An animated scene of glucose breakdown. In the cytosol, glucose flows through hexokinase, PFK-1 and pyruvate kinase to pyruvate, with a small net energy gain. With oxygen, pyruvate enters the mitochondrion through pyruvate dehydrogenase into the TCA cycle, making NADH, FADH2 and carbon dioxide. Without oxygen, pyruvate becomes lactate instead. The slider changes oxygen supply and energy demand. Treatments are thiamine as a pyruvate dehydrogenase cofactor and restoring oxygen. Gauges show glycolysis, pyruvate entry, the TCA cycle, lactate and energy.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "glyco.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Glycolysis in the cytosol.</strong> Glucose is trapped and split in a run of enzyme steps. Hexokinase is slowed by its own product, glucose-6-phosphate. PFK-1 is the main control point: it is sped up when the cell is short of energy (AMP and fructose-2,6-bisphosphate) and slowed by plenty of ATP and by citrate arriving from the mitochondrion. Pyruvate kinase, near the end of the chain, is sped up by an earlier intermediate and slowed when energy is plentiful. The chain gives a small net gain of ATP and makes pyruvate. This is standard teaching in biochemistry and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The aerobic route.</strong> When oxygen and mitochondria are working, pyruvate is carried into the mitochondrion and pyruvate dehydrogenase (PDH) turns it into acetyl-CoA, releasing carbon dioxide. PDH needs thiamine, in its thiamine pyrophosphate form, as one of its cofactors, so thiamine deficiency can hold this step back and push pyruvate toward lactate. Acetyl-CoA then enters the TCA cycle (also called the Krebs or tricarboxylic acid cycle), which releases carbon dioxide and loads carriers as NADH and FADH2. Those carriers feed the electron transport chain, where oxygen is the final acceptor and most ATP is made. Giving thiamine only helps when thiamine is lacking; this scene shows it as a teaching toggle for a cofactor-limited PDH step.",
    "<strong>The anaerobic route.</strong> Without enough oxygen, the electron transport chain stalls, NADH cannot be unloaded, and the TCA cycle slows. Pyruvate is instead turned into lactate by lactate dehydrogenase, which frees the carrier needed to keep glycolysis running. The cell gains only the small glycolytic ATP yield, works less efficiently, and lactate builds up. Restoring oxygen lets the mitochondrial route take over again. These are teaching toggles only.",
  ],
  simplified: "Most individual intermediates, the electron transport chain itself, the malate-aspartate and glycerol phosphate shuttles, fatty acid and amino acid entry into the cycle, glycogen breakdown, gluconeogenesis, tissue differences such as red cells having no mitochondria, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
