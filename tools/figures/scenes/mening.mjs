/* Meningitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/mening.mjs [--print-model]
 * Static layout here; organisms, cells, CSF sample, pressure arrows and gauges move in mening.page.js.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Type of meningitis", a: [1, 0.45, 0.75], names: ["bacterial", "viral", "tuberculous"], ticks: ["bacterial", "viral", "tuberculous"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotic" },
    { label: "steroid" },
    { label: "antiviral" },
  ],
  status: "Meningitis type: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotic", "steroid", "antiviral"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const abx = drug === 1 ? 1 : 0, ster = drug === 2 ? 1 : 0, anti = drug === 3 ? 1 : 0;
  const orgBase = [0.95, 0.55, 0.8][level];
  const infBase = [0.95, 0.5, 0.82][level];
  const protBase = [0.95, 0.42, 1][level];
  const lowGluBase = [0.9, 0.08, 0.85][level];
  const turbBase = [0.95, 0.1, 0.55][level];
  const icpBase = [0.85, 0.35, 0.8][level];
  const stiffBase = [0.9, 0.4, 0.82][level];
  const neutFrac = [0.9, 0.15, 0.35][level];
  let kill = 1;
  if (abx) kill = level === 0 ? 0.14 : level === 2 ? 0.5 : 1;
  if (anti) kill = level === 1 ? 0.2 : 1;
  const Org = cl(orgBase * kill * (ster ? 1.06 : 1));
  const Inf = cl(infBase * (0.35 + 0.65 * (Org / Math.max(0.01, orgBase))) * (ster ? 0.52 : 1));
  const Prot = cl(protBase * (0.45 + 0.55 * Inf) * (ster ? 0.78 : 1));
  const LowGlu = cl(lowGluBase * (level === 1 ? (0.4 + 0.6 * (Org / Math.max(0.01, orgBase))) : (0.35 + 0.65 * (Org / Math.max(0.01, orgBase)))));
  const Turb = cl(turbBase * (0.3 + 0.7 * Inf));
  const Icp = cl(icpBase * (0.4 + 0.6 * Inf) * (ster ? 0.68 : 1));
  const Stiff = cl(stiffBase * (0.35 + 0.65 * Inf) * (ster ? 0.72 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(Turb, 0.25, 0.6, ["clear", "hazy", "cloudy"]),
    w(Prot, 0.3, 0.65, ["normal", "raised", "high"]),
    w(LowGlu, 0.25, 0.6, ["normal", "reduced", "low"]),
    w(Icp, 0.3, 0.62, ["normal", "raised", "high"]),
  ];
  return { abx, ster, anti, Org, Inf, Prot, LowGlu, Turb, Icp, Stiff, neutFrac, words, readout: "CSF " + words[0] + " · protein " + words[1] + " · glucose " + words[2] + " · pressure " + words[3] };
}
const TESTS = [
  [0, 0, "CSF cloudy · protein high · glucose low · pressure high"],
  [1, 0, "CSF clear · protein raised · glucose normal · pressure normal"],
  [2, 0, "CSF hazy · protein high · glucose low · pressure high"],
  [0, 1, "CSF hazy · protein raised · glucose reduced · pressure raised"],
  [1, 3, "CSF clear · protein normal · glucose normal · pressure normal"],
];

/* ---------------- static layout ----------------
 * Brain centre (420,250). Skull rx190 ry140: x 230-610, y 110-390.
 * Meningeal rings inside it; CSF ring between arachnoid and pia.
 * Left entry vessel y 228-262, x 30-232. Right insets x 685-932:
 * CSF sample y 58-226, neck sign y 240-420. Gauges panel y 448-590.
 * Pill centres are placed in empty margins (see mening.page.js):
 * top y 78, left x 105, bottom-left (150,350), bottom (420,420),
 * inset pills at (808,210) and (808,405) inside inset margins. */
const CX = 420, CY = 250;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="mening-inset" x="685" y="58" width="247" height="168" rx="14"/>
<rect class="mening-inset" x="685" y="240" width="247" height="180" rx="14"/>
<text class="sc-zone" x="34" y="68">ENTRY</text>
<text class="sc-zone" x="700" y="82">CSF SAMPLE</text>
<text class="sc-zone" x="700" y="264">NECK SIGN</text>
<g id="entry"></g>
<g id="skull"></g>
<g id="csftube"></g>
<g id="neck"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "meningitis", fig: "Fig 1", title: "Meningitis: infection and inflammation of the meninges", W, H, body,
  label: "An animated cross section of the brain and its meninges. Organisms reach the meninges from the blood and enter the cerebrospinal fluid in the subarachnoid space. The fluid becomes inflamed: white cells gather, protein leaks in, and in bacterial and tuberculous disease glucose falls and the fluid turns cloudy, while viral disease stays clearer with lymphocytes and normal glucose. Swelling and inflamed fluid raise the pressure inside the skull and irritate the meninges, which makes the neck stiff. A cerebrospinal fluid sample tube and a neck sign inset show the same picture. Gauges show organisms, inflammation, protein, glucose fall, pressure and stiffness. Treatment choices are an antibiotic, a steroid and an antiviral.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CX, CY, W, H }, pageJs: readFileSync(join(HERE, "mening.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With antiviral",
  sourcesLis: [
    "<strong>How meningitis develops.</strong> Organisms reach the meninges, usually through the blood, and multiply in the cerebrospinal fluid (CSF) of the subarachnoid space, which has little local defence. Inflammation follows: the blood to CSF barrier leaks protein, white cells enter, and bacteria and white cells use glucose so CSF glucose falls in bacterial and tuberculous disease. Bacterial CSF is typically cloudy with many neutrophils, high protein and low glucose; viral CSF is typically clear with lymphocytes, mildly raised protein and normal glucose; tuberculous CSF is in between and more chronic, with lymphocytes, high protein and low glucose. Inflamed meninges and raised intracranial pressure cause headache and neck stiffness from meningeal irritation. This is standard teaching in medicine, neurology and microbiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antibiotic kills susceptible bacteria, an antiviral acts on viral infection, and a steroid dampens inflammation and pressure without killing the organism. These are teaching toggles only and do not cover urgent assessment, organism specific choices, resistance, or adjunctive care.",
  ],
  simplified: "Routes through the sinuses and middle ear, newborn and post neurosurgical infection, fungal and parasitic causes, seizures and focal deficits, hydrocephalus and cranial nerve palsies in detail, lumbar puncture technique and opening pressure measurement, microbiology testing, and all drug choices, doses and timing are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.mening-inset{fill:color-mix(in srgb,var(--anatomy-paper) 72%,transparent);stroke:var(--anatomy-faint);stroke-width:.9}
.mening-skull{fill:none;stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round}
.mening-dura{fill:none;stroke:color-mix(in srgb,var(--c-endo) 65%,#000);stroke-width:2.4}
.mening-arach{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.2}
.mening-brain{fill:color-mix(in srgb,var(--c-endo) 24%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 50%,#000);stroke-width:1}
.mening-pus{fill:none;stroke:#e8d98a;stroke-linecap:round}
.mening-sulcus{fill:none;stroke:color-mix(in srgb,var(--c-endo) 48%,#000);stroke-width:1.1;stroke-linecap:round;opacity:.65}
.mening-vent{fill:color-mix(in srgb,var(--c-fl) 42%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:.8}
.mening-vess{fill:none;stroke:var(--c-rbc);stroke-width:2;stroke-linecap:round}
.mening-entry{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:.9}
.mening-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mening-tube{fill:color-mix(in srgb,var(--anatomy-paper) 55%,transparent);stroke:var(--anatomy-strong);stroke-width:1.4}
.mening-fluid{stroke:none}
.mening-head{fill:color-mix(in srgb,var(--c-endo) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 50%,#000);stroke-width:1.2}
.mening-block{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.p-org{--cc:var(--c-bac)}.p-med{--cc:var(--c-cyt)}.p-treat{--cc:#38d1ff}
.dr-g-fill.g-prot{fill:#e9b84a}.dr-g-fill.g-glu{fill:#f08a4b}.dr-g-fill.g-icp{fill:var(--c-bad)}.dr-g-fill.g-stiff{fill:var(--c-cyt)}
`,
});
