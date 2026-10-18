/* Measles as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/measles.mjs [--print-model]
 * Static layout here; virus, antibodies, rash and gauges move in measles.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of illness", a: [0, 1, 2], names: ["prodrome", "rash", "complicated"], ticks: ["prodrome", "rash", "complicated"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no specific treatment" },
    { label: "vitamin A and supportive care" },
    { label: "vaccine prevention (before illness)" },
    { label: "treat complications" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no specific treatment", "vitamin A and supportive care", "vaccine prevention", "treatment of complications"],
};
function modelOf(S, level, drug) {
  const VIR = [0.82, 0.62, 0.7];
  const RSH = [0.04, 0.92, 0.62];
  const CMP = [0.06, 0.24, 0.92];
  const IMM = [0.28, 0.78, 0.64];
  const AMN = [0.08, 0.42, 0.78];
  const KOP = [0.95, 0.3, 0.08];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const vit = drug === 1 ? 1 : 0, vac = drug === 2 ? 1 : 0, cmpT = drug === 3 ? 1 : 0;
  const block = vac ? 0.08 : 1;
  const V = cl(VIR[level] * block * (vit ? 0.9 : 1));
  const R = cl(RSH[level] * block);
  const C = cl(CMP[level] * block * (vit ? 0.55 : 1) * (cmpT ? 0.45 : 1));
  const I = cl(vac ? 0.95 : IMM[level] * (vit ? 1.05 : 1));
  const A = cl(AMN[level] * block * (vac ? 0.1 : 1));
  const K = cl(KOP[level] * block);
  const F = cl((0.35 + 0.6 * VIR[level]) * block);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.25, 0.6, ["blocked", "spreading", "high"]), w(R, 0.2, 0.55, ["absent", "appearing", "widespread"]), w(I, 0.35, 0.7, ["building", "rising", "protective"]), w(C, 0.25, 0.55, ["unlikely", "possible", "present"])];
  return { V, R, C, I, A, K, F, vit, vac, cmpT, level, words, readout: "viraemia " + words[0] + " · rash " + words[1] + " · immunity " + words[2] + " · complications " + words[3] };
}
const TESTS = [
  [0, 0, "viraemia high · rash absent · immunity building · complications unlikely"],
  [1, 0, "viraemia high · rash widespread · immunity protective · complications unlikely"],
  [2, 0, "viraemia high · rash widespread · immunity rising · complications present"],
  [2, 1, "viraemia high · rash widespread · immunity rising · complications possible"],
  [1, 2, "viraemia blocked · rash absent · immunity protective · complications unlikely"],
  [2, 2, "viraemia blocked · rash absent · immunity protective · complications unlikely"],
  [2, 3, "viraemia high · rash widespread · immunity rising · complications possible"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">RESPIRATORY MUCOSA</text>
<text class="sc-zone" x="282" y="68">LYMPHOID TISSUE</text>
<text class="sc-zone" x="540" y="68">SKIN</text>
<text class="sc-zone" x="762" y="68">COMPLICATIONS</text>
<g id="air"></g>
<g id="lymph"></g>
<g id="vessel"></g>
<path id="seedVessel" class="ms-seed" d="M572 340 C650 336 730 300 786 195" stroke-width="2"/>
<g id="bodyfig"></g>
<g id="washBack"></g>
<g id="lungSlot"></g>
<g id="brainSlot"></g>
<g id="washFront"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-epi{--cc:#e9a2b3}.cl-lymc{--cc:#7fc4e8}.cl-mem{--cc:#5ec1a0}.cl-plasma{--cc:#e8d36a}
.ms-air{fill:color-mix(in srgb,var(--c-endo) 20%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.ms-lymph{fill:color-mix(in srgb,var(--c-lymph) 16%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.2}
.ms-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-width:1}
.ms-body{fill:color-mix(in srgb,#e8b88a 55%,var(--anatomy-paper));stroke:color-mix(in srgb,#e8b88a 60%,#000);stroke-width:1.2}
.ms-lung{fill:color-mix(in srgb,var(--c-endo) 30%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.ms-brain{fill:color-mix(in srgb,var(--c-mac) 32%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.2}
.ms-patch{fill:var(--c-bad);opacity:.55}
.ms-eye{fill:#fff;stroke:var(--anatomy-mid);stroke-width:.8}
.ms-eye-red{fill:var(--c-bad)}
.ms-mouth{fill:color-mix(in srgb,var(--c-bad) 25%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.7}
.ms-koplik{fill:#fff;stroke:var(--anatomy-mid);stroke-width:.4}
.ms-rash{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.4}
.ms-drop{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 50%,#000);stroke-width:.5}
.ms-seed{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-linecap:round}
.ms-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round}
.ms-wash{fill:var(--c-bad);stroke:none}
.ms-focus{fill:var(--c-bad);stroke:none}
.ms-rashwash{fill:var(--c-bad);stroke:none}
.ms-shield{fill:color-mix(in srgb,var(--c-good) 30%,transparent);stroke:var(--c-good);stroke-width:1.4}
.ms-halo{fill:color-mix(in srgb,var(--c-good) 35%,transparent);stroke:var(--c-good);stroke-width:1.2;stroke-dasharray:6 4}
.ms-cap{fill:var(--anatomy-strong);font-size:12px}
.p-virus{--cc:#e5484d}.p-ab{--cc:#3ddc97}
.ms-ab-y{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-linecap:round}
.ms-vac{fill:color-mix(in srgb,var(--c-good) 20%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1}
.dr-g-fill.g-vir{fill:var(--c-bad)}.dr-g-fill.g-rash{fill:var(--c-endo)}.dr-g-fill.g-imm{fill:var(--c-good)}.dr-g-fill.g-amn{fill:var(--c-cyt)}.dr-g-fill.g-comp{fill:#ff9a3d}
`;

buildScene({
  id: "measles-complications", fig: "Fig 1", title: "Measles: prodrome, rash and complications", W, H, body, extraCss,
  label: "An animated airway, lymphoid tissue, bloodstream, skin and organs in measles. The virus enters in respiratory droplets, replicates in respiratory epithelium and lymphoid tissue, then spreads in the blood as viraemia. The prodrome brings fever with cough, coryza and conjunctivitis and Koplik spots on the mucosa, before a maculopapular rash spreads from head to toe. Cellular and antibody responses clear the virus but can erase earlier immune memory, called immune amnesia. Gauges show viraemia, rash, protective immunity, immune amnesia and complications such as pneumonia, encephalitis and the late brain disease SSPE.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "measles.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With vaccine prevention",
  sourcesLis: [
    "<strong>How measles develops.</strong> Measles virus spreads in respiratory droplets and secretions and first replicates in respiratory epithelium and nearby lymphoid tissue. Spread through the blood (viraemia) seeds skin, conjunctiva, respiratory mucosa and other organs during the infectious period. The first illness is a prodrome of fever with cough, coryza (runny nose) and conjunctivitis, with Koplik spots appearing on the buccal mucosa shortly before the rash. A maculopapular rash then appears and spreads downward from the head (cephalocaudal) as cellular immune responses and antibodies clear infected cells; the rash itself reflects that immune attack. Protective immunity after illness is usually lasting, yet measles can delete part of earlier antibody memory to other infections (immune amnesia), so bacterial superinfection becomes more likely for weeks to years. Complications stressed in standard teaching, particularly in young children and in persons with poor cellular immunity, include pneumonia (from the virus itself or secondary bacterial infection), acute encephalitis, and the rare late disease subacute sclerosing panencephalitis (SSPE). This is standard teaching in medicine and infectious disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Vitamin A and supportive care (fluids, fever care, monitoring) lower the risk of severe disease and complications but do not instantly clear the virus. Vaccination before exposure gives protective antigens without disease and prevents the illness and its complications. Treating complications means supporting breathing and treating secondary bacterial pneumonia or encephalitis care in hospital. These are teaching toggles only.",
  ],
  simplified: "Airway cell entry receptors, the full timing in days, otitis media, diarrhoea, keratitis, pregnancy and vitamin A deficiency detail, antiviral detail, isolation practice, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
