/* Apoptosis pathways as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/apopt.mjs [--print-model]
 * Static layout here; signals, caspases and clearance move in apopt.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stimulus strength", a: [0.3, 0.65, 1], names: ["weak", "moderate", "strong"], ticks: ["weak", "moderate", "strong"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "BCL-2 blocker" },
    { label: "survival signal" },
  ],
  status: "Stimulus: {level} · {drug} ·",
  drugNames: ["no treatment", "a BCL-2 blocker", "a survival signal"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const inh = drug === 1 ? 1 : 0, surv = drug === 2 ? 1 : 0;
  const bcl = inh ? 0.12 : surv ? 0.95 : 0.55;
  const I = cl(0.06 + 0.92 * a * (1 - 0.72 * bcl));
  const E = cl((0.05 + 0.78 * a) * (surv ? 0.5 : 1));
  const cytc = cl(I * 0.95), casp9 = cytc, casp8 = E;
  const C3 = cl(0.02 + 0.5 * E + 0.5 * I);
  const A = cl(0.03 + 0.9 * C3);
  const Infl = cl(0.1 - 0.05 * A);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(I, 0.3, 0.6, ["low", "active", "high"]), w(E, 0.3, 0.6, ["low", "active", "high"]), w(C3, 0.3, 0.6, ["low", "active", "high"]), w(A, 0.3, 0.6, ["surviving", "dying", "fragmenting"])];
  return { a, bcl, inh, surv, I, E, cytc, casp9, casp8, C3, A, Infl, words, readout: "intrinsic " + words[0] + " · extrinsic " + words[1] + " · caspase 3 " + words[2] + " · cell " + words[3] };
}
const TESTS = [
  [0, 0, "intrinsic low · extrinsic low · caspase 3 low · cell surviving"],
  [1, 1, "intrinsic high · extrinsic active · caspase 3 high · cell dying"],
  [2, 0, "intrinsic high · extrinsic high · caspase 3 high · cell fragmenting"],
  [2, 2, "intrinsic active · extrinsic active · caspase 3 active · cell dying"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">EXTRACELLULAR SPACE</text>
<text class="sc-zone sc-dim" x="620" y="92">CELL INTERIOR</text>
<g id="stage"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "apoptosis-pathways", fig: "Fig 1", title: "Apoptosis: intrinsic and extrinsic pathways", W, H, body,
  label: "An animated cell undergoing apoptosis. At top left a Fas signal docks on its receptor and switches on caspase 8. At left, cell stress tips the BCL-2 family toward death. Freed BAX and BAK open the mitochondrion against its BCL-2 guards, cytochrome c spills out, the apoptosome wheel switches on caspase 9, and both pathways converge on executioner caspase 3, which shrinks the cell and pinches off remains that a scavenger cell clears quietly without inflammation. Gauges show the intrinsic signal, extrinsic signal, caspase 3, cell fate and inflammation. Treatment choices are no treatment, a BCL-2 blocker and a survival signal.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "apopt.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With survival signal",
  extraCss: `.ap-cell{fill:color-mix(in srgb,var(--c-lymph) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1.4}
.cl-ap-nuc{--cc:#968fd8}.ap-mito{fill:color-mix(in srgb,var(--c-eos) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-eos) 60%,#000);stroke-width:1.2}
.ap-fold{fill:none;stroke:color-mix(in srgb,var(--c-eos) 65%,#000);stroke-width:1.1}
.ap-fas{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;fill:none}
.ap-bcl{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.6}
.ap-pore{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.ap-wheel{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}.ap-spoke{stroke:var(--c-cyt2);stroke-width:1.2}
.ap-casp{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.8}
.ap-casp8{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.8}
.p-fasl{--cc:#e5484d}.p-stress{--cc:#f2d27a}.p-cytc{--cc:#38d1ff}.p-spark{--cc:#c084fc}.p-inh{--cc:#ff5d8f}.p-surv{--cc:var(--c-good)}
.ap-exec{fill:var(--c-cyt2);stroke:none}.ap-halo{fill:none;stroke:var(--c-good);stroke-width:3}
.ap-cap{fill:var(--anatomy-strong);font-size:13px}
.ap-body{fill:color-mix(in srgb,var(--c-lymph) 35%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.8}`,
  sourcesLis: [
    "<strong>How apoptosis starts.</strong> Apoptosis is programmed cell death. In the extrinsic pathway, a death ligand such as Fas ligand binds a death receptor such as Fas on the cell surface. The receptor recruits and activates initiator caspase 8. In the intrinsic or mitochondrial pathway, cell stress shifts the BCL-2 family balance so that BAX and BAK open the outer mitochondrial membrane, opposing anti-apoptotic BCL-2. Cytochrome c leaves the mitochondrion, joins the apoptosome and activates initiator caspase 9. This is standard teaching in pathology and cell biology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>How the cell ends, and treatment ideas shown.</strong> Both initiator caspases converge on executioner caspase 3, which dismantles the cell from inside. The cell shrinks, its nucleus condenses and it breaks into membrane-bound apoptotic bodies. Phagocytes clear those bodies quietly, without the inflammation seen when cells burst. A BCL-2 blocker sits on BCL-2 and frees BAX and BAK, so the intrinsic pathway runs harder. A survival signal strengthens BCL-2 protection and also brakes caspase 8 at the receptor, so both pathways quieten. These are teaching toggles only.",
  ],
  simplified: "Bid and crosstalk between pathways, other BCL-2 family members, inhibitor of apoptosis proteins, caspase-independent death, necroptosis and other death modes, engulfment signals in detail, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
