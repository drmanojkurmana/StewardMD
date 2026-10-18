/* Rabies neural spread as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/rabies.mjs [--print-model]
 * Static layout here; virus, antibodies and gauges move in rabies.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease stage", a: [0.3, 0.62, 1], names: ["bite", "prodrome", "encephalitis"], ticks: ["bite", "prodrome", "encephalitis"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "wound washing" },
    { label: "vaccine plus immunoglobulin" },
    { label: "treatment once symptomatic" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "wound washing", "vaccine plus immunoglobulin", "treatment once symptomatic"],
};
function modelOf(S, level, drug) {
  const LUT = {
    localBase: [0.9, 0.55, 0.35],
    nerveBase: [0.3, 0.85, 0.95],
    brainBase: [0.02, 0.35, 0.95],
    limbicBase: [0, 0.15, 0.9],
    salBase: [0, 0.1, 0.85],
    parBase: [0, 0.1, 0.7],
    washLocal: [0.6, 0.3, 0.15],
    washCentral: [0.5, 0.15, 0.02],
    pepLocal: [0.95, 0.7, 0.5],
    pepCentral: [0.9, 0.4, 0.08],
    pepAb: [0.85, 0.6, 0.35],
    natAb: [0.05, 0.15, 0.3],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const wash = drug === 1 ? 1 : 0, pep = drug === 2 ? 1 : 0, late = drug === 3 ? 1 : 0;
  const rl = wash ? LUT.washLocal[level] : pep ? LUT.pepLocal[level] : 0;
  const rc = wash ? LUT.washCentral[level] : pep ? LUT.pepCentral[level] : 0;
  const local = cl(LUT.localBase[level] * (1 - rl * 0.9));
  const nerve = cl(LUT.nerveBase[level] * (1 - rc * 0.9));
  const brain = cl(LUT.brainBase[level] * (1 - rc * 0.95));
  const limbic = cl(LUT.limbicBase[level] * (1 - rc * 0.9));
  const sal = cl(LUT.salBase[level] * (1 - rc * 0.9));
  const par = cl(LUT.parBase[level] * (1 - rc * 0.7));
  const dys = cl((0.15 * brain + 0.85 * limbic) * (late ? 0.8 : 1));
  const ab = cl(LUT.natAb[level] + (pep ? LUT.pepAb[level] : 0) + (late ? 0.35 : 0) + (wash ? 0.05 : 0));
  const front = cl(0.12 + nerve * 0.45 + brain * 0.45);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(nerve, 0.3, 0.7, ["early", "spreading", "extensive"]), w(brain, 0.2, 0.6, ["none", "starting", "severe"]), w(sal, 0.25, 0.6, ["none", "starting", "heavy"])];
  return { local, nerve, brain, limbic, sal, par, dys, ab, front, wash, pep, late, words, readout: "nerve spread " + words[0] + " · brain involvement " + words[1] + " · salivary spread " + words[2] };
}
const TESTS = [
  [0, 0, "nerve spread spreading · brain involvement none · salivary spread none"],
  [0, 1, "nerve spread early · brain involvement none · salivary spread none"],
  [1, 2, "nerve spread spreading · brain involvement starting · salivary spread none"],
  [2, 2, "nerve spread extensive · brain involvement severe · salivary spread heavy"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="axonP1" class="rb-axon" d="M170 317 L305 282"/>
<path id="axonP2" class="rb-axon" d="M415 282 L492 260"/>
<path id="tractP" class="rb-tract" d="M492 136 C548 128 578 150 612 218"/>
<path id="centP" class="rb-axon" d="M741 223 C785 235 812 258 845 292"/>
<g id="cordG"><rect class="rb-cord" x="466" y="128" width="52" height="238" rx="24"/>
<path class="rb-canal" d="M492 140 L492 354"/>
<path class="rb-stripe2" d="M472 178H512M472 238H512M472 298H512"/></g>
<g id="glandG">
<path class="rb-duct" d="M872 296 C892 290 905 282 916 272"/>
<circle class="rb-gland" cx="838" cy="300" r="28"/><circle class="rb-gland" cx="870" cy="290" r="23"/><circle class="rb-gland" cx="866" cy="320" r="21"/><circle class="rb-gland-n" cx="838" cy="300" r="8"/>
</g>
<g id="muscleSlot"></g>
<g id="gangSlot"></g>
<g id="brainSlot"></g>
<g id="biteG">
<path class="rb-wound" d="M112 262 L148 262 L140 274 L120 274 Z"/>
<circle class="rb-tooth" cx="121" cy="259" r="4"/><circle class="rb-tooth" cx="139" cy="259" r="4"/>
</g>
<g id="dyn"></g>
<rect class="rb-blood" x="55" y="396" width="850" height="30" rx="15"/>
<g id="rbcs"></g>
<path id="hydroDrop" class="p-fl" d="M896 246C902 256 905 261 905 266A9 9 0 0 1 887 266C887 261 890 256 896 246Z"/>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "rabies-neural-spread", fig: "Fig 1", title: "Rabies: bite to brain along nerves", W, H, body,
  label: "An animated route for rabies virus. A bite deposits virus in muscle. Virus enters peripheral nerves and travels backwards along axons to the spinal cord and brain, with no spread through the blood. Limbic and brainstem involvement causes agitation and hydrophobia, then flaccid paralysis and coma. Virus then travels outward to the salivary glands. Gauges show nerve spread, brain involvement, neuronal dysfunction, salivary spread, paralysis and antibodies. Treatment choices show wound washing and vaccine plus immunoglobulin before symptoms, and treatment started once symptomatic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rabies.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With vaccine plus immunoglobulin",
  sourcesLis: [
    "<strong>How rabies spreads.</strong> Rabies virus deposited by a bite in muscle is taken up at nerve endings and carried by retrograde axonal transport along sensory and autonomic nerves to the spinal cord and brain. There is usually no viraemia. In neurons the virus causes neuronal dysfunction rather than widespread neuronal destruction, with Negri bodies in infected cells. Limbic and brainstem involvement gives the encephalitic form with agitation and hydrophobia; a paralytic form gives flaccid paralysis. Centrifugal spread along nerves reaches the salivary glands. Antibodies appear late, and laboratory tests detect viral antigen or nucleic acid. Once encephalitis is established the course is almost always fatal, so suspected exposure should be assessed urgently. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Prompt wound washing and post exposure vaccine plus immunoglobulin before symptoms can prevent virus reaching the brain. Washing alone is only partly protective in this teaching model. Treatment started once symptomatic is shown with no reversal of established brain involvement.",
  ],
  simplified: "The long and variable incubation, differences between animal hosts, the exact molecular transport machinery, diagnostic test selection, supportive intensive care details and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-virus:#e5484d;--c-axon:#e9b84a;--c-brain:#e9a2b3;--c-limbic:#f08a4b;--c-gland:#5ec1a0;--c-cord:#7fc4e8}
.rb-axon{fill:none;stroke:var(--c-axon);stroke-width:11;stroke-linecap:round;opacity:.5}
.rb-tract{fill:none;stroke:var(--c-axon);stroke-width:11;stroke-linecap:round;opacity:.5}
.rb-cord{fill:var(--c-cord);stroke:color-mix(in srgb,var(--c-cord) 55%,#000);stroke-width:1}
.rb-canal{fill:none;stroke:color-mix(in srgb,var(--c-cord) 45%,#000);stroke-width:1.4;opacity:.7}
.rb-stripe2{fill:none;stroke:color-mix(in srgb,var(--c-cord) 45%,#000);stroke-width:2;stroke-linecap:round;opacity:.6}
.rb-wound{fill:#7a1030;stroke:#fff;stroke-width:.6}
.rb-tooth{fill:#fff;stroke:#9a744a;stroke-width:.8}
.rb-gland{fill:var(--c-gland);stroke:color-mix(in srgb,var(--c-gland) 55%,#000);stroke-width:1}
.rb-gland-n{fill:color-mix(in srgb,var(--c-gland) 40%,#10301a);opacity:.85}
.rb-duct{fill:none;stroke:color-mix(in srgb,var(--c-gland) 55%,#000);stroke-width:2;stroke-linecap:round;opacity:.7}
.rb-blood{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:.8}
.rb-wash{fill:var(--c-fl);stroke:var(--c-fl)}
.rb-shield{fill:color-mix(in srgb,var(--c-good) 22%,transparent);stroke:var(--c-good);stroke-width:2.5}
.rb-bglow{fill:var(--c-bad);stroke:none}
.rb-gglow{fill:var(--c-gland);stroke:none}
.rb-limbic{fill:var(--c-limbic);stroke:color-mix(in srgb,var(--c-limbic) 55%,#000);stroke-width:.8}
.rb-negri{fill:#7a1030;stroke:#fff;stroke-width:.5}
.rb-cap{fill:var(--anatomy-strong);font-size:12px}
.p-virus{--cc:var(--c-virus)}.p-ab{--cc:#3ddc97}
.dr-g-fill.g-virus{fill:var(--c-virus)}.dr-g-fill.g-brain{fill:var(--c-brain)}.dr-g-fill.g-limbic{fill:var(--c-limbic)}.dr-g-fill.g-gland{fill:var(--c-gland)}.dr-g-fill.g-cord{fill:var(--c-cord)}
`,
});
