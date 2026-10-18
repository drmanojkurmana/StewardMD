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
    washRed: [0.5, 0.15, 0],
    pepRed: [0.9, 0.45, 0],
    pepAb: [0.85, 0.6, 0.1],
    natAb: [0.05, 0.15, 0.3],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const red = drug === 1 ? LUT.washRed[level] : drug === 2 ? LUT.pepRed[level] : 0;
  const nerve = cl(LUT.nerveBase[level] * (1 - red * 0.9));
  const brain = cl(LUT.brainBase[level] * (1 - red * 0.95));
  const limbic = cl(LUT.limbicBase[level] * (1 - red * 0.9));
  const sal = cl(LUT.salBase[level] * (1 - red * 0.9));
  const par = cl(LUT.parBase[level] * (1 - red * 0.7));
  const local = cl(LUT.localBase[level] * (1 - red * 0.8));
  const dys = cl(0.15 * brain + 0.85 * limbic);
  const ab = cl(LUT.natAb[level] + (drug === 2 ? LUT.pepAb[level] : drug === 1 ? 0.05 : 0));
  const front = cl(0.12 + nerve * 0.45 + brain * 0.45);
  const wash = drug === 1 ? 1 : 0, pep = drug === 2 ? 1 : 0, late = drug === 3 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(nerve, 0.3, 0.7, ["early", "spreading", "extensive"]), w(brain, 0.2, 0.6, ["none", "starting", "severe"]), w(sal, 0.25, 0.6, ["none", "starting", "heavy"])];
  return { local, nerve, brain, limbic, sal, par, dys, ab, front, wash, pep, late, red, words, readout: "nerve spread " + words[0] + " · brain involvement " + words[1] + " · salivary spread " + words[2] };
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
<path class="rb-axon" d="M200 330C300 308 380 272 462 248"/>
<path class="rb-tract" d="M492 150C540 132 590 150 640 192"/>
<path class="rb-axon" d="M662 214C740 232 800 258 838 282"/>
<g id="muscleG">
<rect class="rb-skin" x="55" y="250" width="155" height="20" rx="8"/>
<rect class="rb-muscle" x="55" y="270" width="155" height="112" rx="16"/>
<path class="rb-stripe" d="M70 292H195M70 318H195M70 344H195M70 368H195"/>
<circle class="rb-tooth" cx="96" cy="256" r="5"/><circle class="rb-tooth" cx="116" cy="256" r="5"/>
</g>
<circle class="rb-ganglion" cx="402" cy="262" r="18"/><circle class="rb-ganglion-n" cx="402" cy="262" r="7"/>
<g id="cordG"><rect class="rb-cord" x="466" y="128" width="52" height="238" rx="24"/>
<path class="rb-stripe2" d="M472 178H512M472 238H512M472 298H512"/></g>
<g id="brainG">
<rect class="rb-stem" x="632" y="196" width="52" height="62" rx="18"/>
<ellipse class="rb-brain" cx="662" cy="142" rx="116" ry="72"/>
<ellipse id="limbic" class="rb-limbic" cx="628" cy="132" rx="50" ry="30"/>
<circle class="rb-negri" cx="606" cy="122" r="4"/><circle class="rb-negri" cx="646" cy="146" r="3.4"/><circle class="rb-negri" cx="690" cy="118" r="3.6"/><circle class="rb-negri" cx="716" cy="152" r="3"/><circle class="rb-negri" cx="660" cy="102" r="3"/>
</g>
<g id="glandG">
<circle class="rb-gland" cx="838" cy="292" r="30"/><circle class="rb-gland" cx="872" cy="282" r="24"/><circle class="rb-gland" cx="868" cy="314" r="22"/><circle class="rb-gland-n" cx="838" cy="292" r="8"/>
</g>
<rect class="rb-blood" x="55" y="396" width="850" height="30" rx="15"/>
<g id="rbcs"></g>
<path id="hydroDrop" class="p-fl" d="M806 138C812 148 815 153 815 158A9 9 0 0 1 797 158C797 153 800 148 806 138Z"/>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "rabies-neural-spread", fig: "Fig 1", title: "Rabies: bite to brain along nerves", W, H, body,
  label: "An animated route for rabies virus. A bite deposits virus in muscle. Virus enters peripheral nerves and travels backwards along axons to the spinal cord and brain, with no spread through the blood. Limbic and brainstem involvement causes agitation and hydrophobia, then flaccid paralysis and coma. Virus then travels outward to the salivary glands. Gauges show nerve spread, brain involvement, neuronal dysfunction, salivary spread, paralysis and antibodies. Treatment choices show wound washing and vaccine plus immunoglobulin before symptoms, and treatment started once symptomatic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rabies.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "Once symptomatic",
  sourcesLis: [
    "<strong>How rabies spreads.</strong> Rabies virus deposited by a bite in muscle is taken up at nerve endings and carried by retrograde axonal transport along sensory and autonomic nerves to the spinal cord and brain. There is usually no viraemia. In neurons the virus causes neuronal dysfunction rather than widespread neuronal destruction, with Negri bodies in infected cells. Limbic and brainstem involvement gives the encephalitic form with agitation and hydrophobia; a paralytic form gives flaccid paralysis. Centrifugal spread along nerves reaches the salivary glands. Antibodies appear late, and laboratory tests detect viral antigen or nucleic acid. Once encephalitis is established the course is almost always fatal, so suspected exposure should be assessed urgently. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Prompt wound washing and post exposure vaccine plus immunoglobulin before symptoms can prevent virus reaching the brain. Washing alone is only partly protective in this teaching model. Treatment started once symptomatic is shown with no reversal of established brain involvement.",
  ],
  simplified: "The long and variable incubation, differences between animal hosts, the exact molecular transport machinery, diagnostic test selection, supportive intensive care details and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-virus:#e5484d;--c-axon:#e9b84a;--c-brain:#e9a2b3;--c-limbic:#f08a4b;--c-gland:#5ec1a0;--c-muscle:#d9788f;--c-cord:#7fc4e8}
.rb-muscle{fill:var(--c-muscle);stroke:color-mix(in srgb,var(--c-muscle) 55%,#000);stroke-width:1}
.rb-skin{fill:#e8c39a;stroke:#9a744a;stroke-width:1}
.rb-stripe{fill:none;stroke:color-mix(in srgb,var(--c-muscle) 45%,#000);stroke-width:3;stroke-linecap:round;opacity:.55}
.rb-stripe2{fill:none;stroke:color-mix(in srgb,var(--c-cord) 45%,#000);stroke-width:2;stroke-linecap:round;opacity:.6}
.rb-tooth{fill:#fff;stroke:#9a744a;stroke-width:.8}
.rb-axon{fill:none;stroke:var(--c-axon);stroke-width:11;stroke-linecap:round;opacity:.5}
.rb-tract{fill:none;stroke:var(--c-axon);stroke-width:11;stroke-linecap:round;opacity:.5}
.rb-ganglion{fill:var(--c-axon);stroke:color-mix(in srgb,var(--c-axon) 55%,#000);stroke-width:1}
.rb-ganglion-n{fill:color-mix(in srgb,var(--c-axon) 40%,#1a1030);opacity:.85}
.rb-cord{fill:var(--c-cord);stroke:color-mix(in srgb,var(--c-cord) 55%,#000);stroke-width:1}
.rb-brain{fill:var(--c-brain);stroke:color-mix(in srgb,var(--c-brain) 55%,#000);stroke-width:1}
.rb-stem{fill:var(--c-brain);stroke:color-mix(in srgb,var(--c-brain) 55%,#000);stroke-width:1}
.rb-limbic{fill:var(--c-limbic);stroke:color-mix(in srgb,var(--c-limbic) 55%,#000);stroke-width:.8}
.rb-negri{fill:#7a1030;stroke:#fff;stroke-width:.5}
.rb-gland{fill:var(--c-gland);stroke:color-mix(in srgb,var(--c-gland) 55%,#000);stroke-width:1}
.rb-gland-n{fill:color-mix(in srgb,var(--c-gland) 40%,#10301a);opacity:.85}
.rb-blood{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:.8}
.p-virus{--cc:var(--c-virus)}.p-ab{--cc:#3ddc97}
.dr-g-fill.g-virus{fill:var(--c-virus)}.dr-g-fill.g-brain{fill:var(--c-brain)}.dr-g-fill.g-limbic{fill:var(--c-limbic)}.dr-g-fill.g-gland{fill:var(--c-gland)}.dr-g-fill.g-cord{fill:var(--c-cord)}
`,
});
