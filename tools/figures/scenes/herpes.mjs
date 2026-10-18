/* Herpes simplex virus latency as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/herpes.mjs [--print-model]
 * Static layout here; virus particles, vesicles and gauges move in herpes.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of infection", a: [0, 1, 2], names: ["primary", "latent", "reactivation"], ticks: ["primary", "latent", "reactivation"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "aciclovir (nucleoside analogue)" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "aciclovir"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ac = drug === 1 ? 1 : 0;
  const repB = [0.85, 0.06, 0.8][level];
  const vesB = [0.7, 0.02, 0.9][level];
  const latB = [0.35, 0.95, 0.55][level];
  const sprB = [0.75, 0.05, 0.85][level];
  const Rep = cl(repB * (ac ? 0.15 : 1));
  const Ves = cl(vesB * (ac ? 0.2 : 1));
  const Lat = cl(latB);
  const Spr = cl(sprB * (ac ? 0.45 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Rep, 0.2, 0.55, ["quiet", "active", "high"]), w(Ves, 0.15, 0.5, ["none", "few", "many"]), w(Lat, 0.4, 0.75, ["seeding", "present", "established"]), w(Spr, 0.2, 0.55, ["still", "moving", "spreading"])];
  return { Rep, Ves, Lat, Spr, ac, level, words, readout: "replication " + words[0] + " · vesicles " + words[1] + " · latent genome " + words[2] + " · axonal spread " + words[3] };
}
const TESTS = [
  [0, 0, "replication high · vesicles many · latent genome seeding · axonal spread spreading"],
  [1, 0, "replication quiet · vesicles none · latent genome established · axonal spread still"],
  [2, 0, "replication high · vesicles many · latent genome present · axonal spread spreading"],
  [2, 1, "replication quiet · vesicles few · latent genome present · axonal spread moving"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="40" y="68">SKIN AND MUCOSA</text>
<text class="sc-zone" x="640" y="68">SENSORY GANGLION</text>
<text class="sc-zone sc-dim" x="400" y="208">AXON</text>
<g id="skin"></g>
<g id="axon"></g>
<g id="gang"></g>
<g id="derm"></g>
<g id="trig"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-epi{--cc:#e9a2b3}.cl-neuron{--cc:#b7a1e6}.cl-sat{--cc:#7fc4e8}
.hv-skin{fill:color-mix(in srgb,var(--c-endo) 22%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.hv-axon{fill:color-mix(in srgb,var(--c-mac) 28%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.2}
.hv-gang{fill:color-mix(in srgb,var(--c-mac) 16%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.2}
.hv-nuc{fill:color-mix(in srgb,var(--c-mac) 55%,#1a1030);stroke:var(--c-mac);stroke-width:1.2}
.hv-lat{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 50%,#000);stroke-width:.6}
.hv-ves{fill:color-mix(in srgb,var(--c-fl) 45%,#fff);stroke:var(--c-fl);stroke-width:1.1}
.hv-derm{fill:color-mix(in srgb,var(--c-endo) 14%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.hv-derm-on{fill:color-mix(in srgb,var(--c-bad) 22%,var(--anatomy-paper))}
.hv-trig{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.hv-trig-t{fill:var(--anatomy-text);font:10px var(--anatomy-mono);pointer-events:none}
.p-virus{--cc:#e5484d}.p-virus2{--cc:#ff9a3d}.p-acic{--cc:#3ddc97}
.hv-chain{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 3}
`;

buildScene({
  id: "herpes-virus-latency", fig: "Fig 1", title: "Herpes simplex: latency and reactivation", W, H, body, extraCss,
  label: "An animated skin, axon and sensory ganglion. In primary infection the virus replicates in the epithelium and travels back along the axon to the neuron nucleus, where it stays latent. Stress or immunosuppression can reactivate it, and it travels forward along the axon to the skin to form vesicles in the dermatome. Gauges show viral replication, skin vesicles, latent genome and axonal spread. The treatment choice shows aciclovir as a nucleoside analogue concept that blocks viral DNA replication without clearing latency.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "herpes.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Latency and reactivation.</strong> Herpes simplex virus first replicates in skin or mucosal epithelium. Capsids travel by retrograde axonal transport to sensory neuron cell bodies in the ganglion, where the viral genome persists in the neuron nucleus as latent DNA with very little viral protein made. Triggers such as stress, fever, ultraviolet light and immunosuppression can reactivate the virus. New capsids then travel by anterograde transport along the same axon to the skin and replicate in the epithelium, forming grouped vesicles. Reactivation of varicella zoster virus follows the same ganglion idea and gives vesicles in the dermatome supplied by that ganglion (shingles). This is standard teaching in virology and infection texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment idea shown.</strong> Aciclovir is a nucleoside analogue. After activation in infected cells it is built into growing viral DNA and stops the chain, so replication and new vesicle formation fall. It does not remove the latent genome from the neuron nucleus, so reactivation can still happen later. This is a teaching toggle only.",
  ],
  simplified: "The full latency gene programme, immune control in the ganglion, differences between herpes simplex types and varicella zoster in detail, antiviral resistance, and all doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
