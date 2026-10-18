/* Poliomyelitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/polio.mjs [--print-model]
 * Static layout here; virus, neurons, muscle, breathing and gauges move in polio.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of poliomyelitis", a: [0.3, 0.75, 1], names: ["infection", "paralytic", "post-polio"], ticks: ["infection", "paralytic", "post-polio"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no prevention or support" },
    { label: "supportive care" },
    { label: "vaccine prevention" },
    { label: "ventilation (breathing support)" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no prevention or support", "supportive care", "vaccine prevention", "ventilation"],
};
function modelOf(S, level, drug) {
  const STAGE = [
    { g: 0.85, v: 0.55, n: 0.05, p: 0.04, r: 0.05, at: 0.03 },
    { g: 0.55, v: 0.35, n: 0.85, p: 0.85, r: 0.60, at: 0.25 },
    { g: 0.08, v: 0.04, n: 0.90, p: 0.75, r: 0.45, at: 0.90 }
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const s = STAGE[level], vacc = drug === 2 ? 1 : 0, sup = drug === 1 ? 1 : 0, vent = drug === 3 ? 1 : 0;
  const G = cl(s.g * (vacc ? 0.2 : 1));
  const V = cl(s.v * (vacc ? 0.15 : 1));
  const N = cl(s.n * (vacc ? 0.1 : 1));
  const P = cl(s.p * (vacc ? 0.1 : 1) * (sup ? 0.85 : 1));
  const R = cl(s.r * (vacc ? 0.1 : 1) * (sup ? 0.75 : 1) * (vent ? 0.25 : 1));
  const At = cl(s.at * (vacc ? 0.15 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.25, 0.65, ["cleared", "present", "high"]), w(V, 0.2, 0.45, ["none", "low", "present"]), w(N, 0.3, 0.65, ["low", "some", "high"]), w(P, 0.25, 0.6, ["none", "some", "severe"]), w(R, 0.25, 0.5, ["ok", "strained", "failing"])];
  return { a: S.level.a[level], vacc, sup, vent, G, V, N, P, R, At, words, readout: "gut virus " + words[0] + " · viraemia " + words[1] + " · neuron loss " + words[2] + " · paralysis " + words[3] + " · breathing " + words[4] };
}
const TESTS = [
  [0, 0, "gut virus high · viraemia present · neuron loss low · paralysis none · breathing ok"],
  [1, 0, "gut virus present · viraemia low · neuron loss high · paralysis severe · breathing failing"],
  [1, 2, "gut virus cleared · viraemia none · neuron loss low · paralysis none · breathing ok"],
  [2, 0, "gut virus cleared · viraemia none · neuron loss high · paralysis severe · breathing strained"],
  [1, 3, "gut virus present · viraemia low · neuron loss high · paralysis severe · breathing ok"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="po-node po-gut" x="36" y="92" width="196" height="168" rx="16"/>
<rect class="po-node po-blood" x="268" y="132" width="188" height="96" rx="48"/>
<rect class="po-node po-cord" x="492" y="92" width="168" height="220" rx="24"/>
<rect class="po-node po-muscle" x="696" y="92" width="224" height="130" rx="16"/>
<rect class="po-node po-breath" x="696" y="256" width="224" height="142" rx="16"/>
<path class="po-axon" d="M640 190C680 175 700 160 730 155M640 250C680 245 700 220 730 205"/>
<path class="po-axon" d="M610 130C650 95 690 82 740 78" opacity="0"/>
<text class="sc-zone" x="48" y="112">GUT</text>
<text class="sc-zone" x="282" y="154">BLOOD</text>
<text class="sc-zone" x="506" y="112">SPINAL CORD</text>
<text class="sc-zone" x="710" y="112">MUSCLE</text>
<text class="sc-zone" x="710" y="276">BRAINSTEM AND BREATHING</text>
<rect class="po-lumen" x="50" y="126" width="168" height="52" rx="12"/>
<ellipse class="po-follicle" cx="150" cy="224" rx="52" ry="26"/>
<g id="gutparts"></g><g id="parts"></g><g id="neurons"></g><g id="muscle"></g><g id="lungs"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-mot{--cc:#e9b84a}.cl-vircell{--cc:var(--c-lymph)}
.po-node{stroke:var(--anatomy-mid);stroke-width:1.1}
.po-gut{fill:color-mix(in srgb,var(--c-bac) 18%,var(--anatomy-paper))}
.po-blood{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper))}
.po-cord{fill:color-mix(in srgb,var(--c-neut) 20%,var(--anatomy-paper))}
.po-muscle{fill:color-mix(in srgb,var(--c-rbc) 24%,var(--anatomy-paper))}
.po-breath{fill:color-mix(in srgb,var(--c-fl) 18%,var(--anatomy-paper))}
.po-lumen{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-mid));stroke-width:1}
.po-follicle{fill:color-mix(in srgb,var(--c-lymph) 35%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1}
.po-axon{fill:none;stroke:var(--c-neut);stroke-width:2.2;stroke-linecap:round;opacity:.75}
.po-fibre{fill:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.8}
.po-lung{fill:color-mix(in srgb,var(--c-fl) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:1}
.po-diaph{fill:none;stroke:var(--c-rbc);stroke-width:2.4;stroke-linecap:round}
.po-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.po-cap{fill:var(--anatomy-text);font-size:10.5px;pointer-events:none}
.p-virus{--cc:var(--c-bac)}.p-signal{--cc:var(--c-neut)}.p-air{--cc:var(--c-fl)}.p-ab{--cc:var(--c-ab)}
.dr-g-fill.g-vir{fill:var(--c-bac)}.dr-g-fill.g-via{fill:#ff9a3d}.dr-g-fill.g-neur{fill:var(--c-neut)}.dr-g-fill.g-par{fill:var(--c-bad)}.dr-g-fill.g-resp{fill:var(--c-fl)}
`;

buildScene({
  id: "poliomyelitis", fig: "Fig 1", title: "Poliomyelitis: gut virus to flaccid paralysis", W, H, body, extraCss,
  label: "An animated pathway for poliomyelitis. Poliovirus is swallowed by the faecal oral route, multiplies in gut lymphoid tissue, enters the blood as viraemia and invades anterior horn motor neurons in the spinal cord. Loss of those neurons causes asymmetric flaccid paralysis of muscle, and bulbar involvement can threaten swallowing and breathing. The level slider moves from infection to paralytic disease to post-polio change. Treatments are supportive care, vaccine prevention and ventilation. Gauges show gut virus, viraemia, neuron loss, paralysis and breathing trouble.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, numbers or patient specific advice are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "polio.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without prevention or support", withLabel: "With vaccine prevention",
  sourcesLis: [
    "<strong>How poliomyelitis develops.</strong> Poliovirus is an enterovirus spread mainly by the faecal oral route. It first multiplies in the throat and gut, including gut associated lymphoid tissue, then can enter the blood. In a minority the virus reaches the central nervous system and destroys anterior horn motor neurons in the spinal cord and motor nuclei in the brainstem. The clinical result is acute asymmetric flaccid paralysis with reduced tone and reflexes, often with intact sensation. Bulbar involvement can impair swallowing, the airway and breathing. This is standard teaching in medicine, neurology and infectious disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Prevention and treatment ideas shown.</strong> Oral polio vaccine is a live attenuated vaccine given by mouth that produces strong gut immunity. Inactivated polio vaccine is an injected killed vaccine that produces blood antibody and protects the nervous system, with less gut immunity. There is no specific antiviral cure for established poliomyelitis shown here. Supportive care protects the airway, nutrition and limbs, and ventilation supports breathing when respiratory muscles or bulbar control fail. These are teaching toggles only.",
    "<strong>Post-polio change.</strong> Months to years later, surviving motor units that had enlarged to supply orphaned muscle fibres can fail, with new weakness, fatigue and muscle wasting in previously affected limbs. Virus shedding and viraemia are no longer the main issue at that stage.",
  ],
  simplified: "Throat replication in detail, minor and major viraemia phases, retrograde axonal entry, meningitis and preparalytic features, poliovirus serotypes, vaccine schedules and eradication programme detail, orthoses and rehabilitation planning, differential diagnosis of acute flaccid paralysis, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
