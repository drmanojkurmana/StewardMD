/* Autoimmunity and loss of tolerance as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/autoimm.mjs [--print-model]
 * Static layout here; developing lymphocytes, escaping clones, antibodies and gauges move in autoimm.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Tolerance state", a: [0.08, 0.55, 1], names: ["tolerant", "breakdown", "established autoimmunity"], ticks: ["tolerant", "breakdown", "established"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "immunosuppression (dampens T and B cells)" },
    { label: "anti-B cell therapy (removes B cells)" },
    { label: "replace lost function" },
  ],
  status: "Tolerance: {level} · {drug} ·",
  drugNames: ["no treatment", "immunosuppression", "anti-B cell therapy", "replacement of lost function"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const imm = drug === 1 ? 1 : 0, antiB = drug === 2 ? 1 : 0, repl = drug === 3 ? 1 : 0;
  const E = cl(0.06 + 0.88 * a);
  const R = cl(0.92 - 0.72 * a);
  const T = cl(E * (1 - 0.55 * R) * (1 - 0.60 * imm) * (1 - 0.10 * antiB));
  const Ab = cl(E * (0.30 + 0.70 * a) * (1 - 0.50 * imm) * (1 - 0.85 * antiB));
  const D = cl(0.04 + 0.52 * T + 0.48 * Ab);
  const Fn = cl(1 - 0.88 * D + (repl ? 0.52 * D : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(E, 0.25, 0.60, ["low", "some", "high"]), w(Ab, 0.25, 0.55, ["low", "moderate", "high"]), w(D, 0.25, 0.55, ["intact", "injured", "damaged"]), w(Fn, 0.40, 0.70, ["failing", "reduced", "preserved"])];
  return { a, E, R, T, Ab, D, Fn, imm, antiB, repl, words, readout: "escape " + words[0] + " \u00b7 autoantibodies " + words[1] + " \u00b7 tissue " + words[2] + " \u00b7 function " + words[3] };
}
const TESTS = [
  [0, 0, "escape low \u00b7 autoantibodies low \u00b7 tissue intact \u00b7 function preserved"],
  [1, 0, "escape some \u00b7 autoantibodies moderate \u00b7 tissue injured \u00b7 function reduced"],
  [2, 0, "escape high \u00b7 autoantibodies high \u00b7 tissue damaged \u00b7 function failing"],
  [2, 2, "escape high \u00b7 autoantibodies low \u00b7 tissue injured \u00b7 function reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-panel" x="14" y="44" width="300" height="196" rx="18"/>
<rect class="sc-panel" x="330" y="44" width="300" height="196" rx="18"/>
<rect class="sc-panel" x="646" y="44" width="300" height="196" rx="18"/>
<rect class="sc-tissue" x="14" y="256" width="932" height="184" rx="18"/>
<text class="sc-zone" x="34" y="68">THYMUS</text>
<text class="sc-zone" x="350" y="68">BONE MARROW</text>
<text class="sc-zone" x="666" y="68">PERIPHERY</text>
<text class="sc-zone" x="34" y="280">TARGET TISSUE</text>
<text class="sc-lab" x="700" y="280">organ-specific or systemic</text>
<g id="Lbase"></g><g id="Lpart"></g><g id="Lover"></g><g id="Lpanel"></g>`;

const extraCss = `
.sc-panel{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.cl-treg{--cc:var(--c-ab)}
.cl-tis2{--cc:var(--c-graft)}
.p-ab{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.p-cytk{--cc:var(--c-cyt)}
.p-vir{--cc:#ff9a3d}
.p-self{--cc:#ffd24a}
.del-x{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.supp{fill:none;stroke:var(--c-ab);stroke-width:1.4;stroke-dasharray:3 3}
.blk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:2}
.blk-l{stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.blk-t{fill:var(--c-bad);pointer-events:none;font-size:11px;font-weight:700}
.vir-spike{stroke:#ff9a3d;stroke-width:1.3;stroke-linecap:round;fill:none}
.dmg-ring{fill:none;stroke:var(--c-bad);stroke-width:1.4}
`;

buildScene({
  id: "autoimmunity-loss-of-tolerance", fig: "Fig 1", title: "Autoimmunity: loss of tolerance", W, H, body, extraCss,
  label: "An animated thymus, bone marrow, periphery and target tissue. In the thymus and marrow, developing lymphocytes that bind self strongly are deleted. In the periphery, regulatory T cells suppress escapees and other cells become anergic. When tolerance breaks down, helped by HLA risk genes, infection mimicry and release of hidden antigens, autoreactive T cells and autoantibodies injure tissue. Gauges show escape, autoantibodies, tissue damage and organ function. Treatment choices are immunosuppression, anti-B cell therapy and replacing lost function.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "autoimm.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Central and peripheral tolerance.</strong> Autoimmunity follows failure of tolerance to self antigens. In central tolerance, developing T cells in the thymus and B cells in the bone marrow that bind self strongly are deleted by cell death, edited or left unresponsive. In peripheral tolerance, regulatory T cells suppress escapees, and cells met by self antigen without costimulation become anergic. These layers normally keep immune responses to self low while preserving responses to microbes.",
    "<strong>Why tolerance fails.</strong> Susceptibility is genetic and environmental in various combinations. Certain HLA genes and many non-HLA genes alter antigen presentation and lymphocyte signalling and enhance risk in susceptible individuals; epigenetic change and innate sensing can promote proinflammatory responses. Environmental triggers include infection, where microbial antigens mimic self (molecular mimicry), and tissue injury that releases hidden or sequestered self antigens and nucleic acids. Defective clearance of dying cells and nucleic acids, described in systemic disease, keeps self material available and sustains inflammation. Hormonal and other factors linked to sex are considered relevant because many systemic autoimmune diseases are more common in women. Organ-specific examples include Graves disease of the thyroid; systemic examples spread across skin, joints, kidney and vessels. This is standard teaching in immunology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Immunosuppression dampens autoreactive T and B cell activity broadly. Anti-B cell therapy removes B cells and lowers autoantibodies while T cell injury may persist. Replacing lost function, for example a missing hormone, restores what the damaged organ no longer provides without itself stopping the immune attack. These are teaching toggles only.",
  ],
  simplified: "Receptor editing detail, the full gene list, complement and Fc pathways, each disease pattern, and all drug choices, monitoring and doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
