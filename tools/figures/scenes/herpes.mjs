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
    { label: "no treatment" },
    { label: "aciclovir" },
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
<g id="skin"></g>
<g id="axon"></g>
<g id="gang"><g id="gangSlot"></g></g>
<g id="derm"></g>
<g id="trig"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-epi{--cc:#e9a2b3}.cl-neuron{--cc:#b7a1e6}.cl-sat{--cc:#7fc4e8}
.hv-skin{fill:color-mix(in srgb,var(--c-endo) 22%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.hv-axon{fill:color-mix(in srgb,var(--c-mac) 28%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.2}
.hv-inf{fill:var(--c-bad);stroke:none}
.hv-myel{fill:color-mix(in srgb,var(--c-plt) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 60%,#000);stroke-width:1}
.hv-basal{fill:none;stroke:var(--c-endo);stroke-width:2;opacity:.7}
.hv-lat{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 50%,#000);stroke-width:.6}
.hv-ves{fill:color-mix(in srgb,var(--c-fl) 45%,#fff);stroke:var(--c-fl);stroke-width:1.1}
.hv-derm{fill:color-mix(in srgb,var(--c-endo) 14%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.hv-derm-on{fill:color-mix(in srgb,var(--c-bad) 22%,var(--anatomy-paper))}
.hv-trig{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.p-virus{--cc:#e5484d}.p-virus2{--cc:#ff9a3d}.p-acic{--cc:#3ddc97}
.hv-chain{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 3}
.hv-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.dna-bb{fill:none;stroke:var(--c-bad);stroke-width:2.5;stroke-linecap:round}
.dna-rg{fill:none;stroke:var(--c-bad);stroke-width:1.4;opacity:.8}
.dna-tip{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.dna.off .dna-bb{stroke:var(--anatomy-faint)}
.dna.off .dna-rg{stroke:var(--anatomy-faint)}
.dna.off .dna-tip{fill:var(--anatomy-faint);stroke:var(--anatomy-faint)}
`;

buildScene({
  id: "herpes-virus-latency", fig: "Fig 1", title: "Herpes simplex: latency and reactivation", W, H, body, extraCss,
  label: "An animated skin, nerve fibre and sensory ganglion, read left to right. In primary infection the virus copies its DNA in skin cells and travels up the fibre to the nerve cell body, where the genome rests. Triggers can wake it, and new virus travels back down the fibre to blister the skin. Gauges show viral replication, skin vesicles, latent genome and spread along the fibre. Aciclovir caps the growing viral DNA chain so copying stops, without clearing the resting genome.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "herpes.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With aciclovir",
  sourcesLis: [
    "<strong>Latency and reactivation.</strong> Herpes simplex virus first copies itself in skin or mucosal cells. New virus travels up the sensory fibre to the nerve cell body in the ganglion, where the viral genome persists in the nucleus as resting DNA with very little viral protein made. Triggers such as stress, fever, ultraviolet light and low immunity can wake the virus. New virus then travels back down the same fibre to the skin and copies itself in skin cells again, forming grouped blisters. Reactivation of varicella zoster virus follows the same ganglion idea and gives blisters in the dermatome supplied by that ganglion (shingles). This is standard teaching in virology and infection texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment idea shown.</strong> Aciclovir is a nucleoside analogue. After activation in infected cells it is built into growing viral DNA and caps the chain, so copying and new blister formation fall. It does not remove the resting genome from the nerve cell nucleus, so reactivation can still happen later. This is a teaching toggle only.",
  ],
  simplified: "The full latency gene programme, immune control in the ganglion, differences between herpes simplex types and varicella zoster in detail, antiviral resistance, and all doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
