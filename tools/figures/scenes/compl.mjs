/* Complement system as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/compl.mjs [--print-model]
 * Static layout here; proteins, coating, chemotaxis, the membrane attack complex and gauges move in compl.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pathway activation", a: [0.25, 0.6, 1], names: ["quiet", "moderate", "strong"], ticks: ["quiet", "moderate", "strong"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "C5 blocker" },
    { label: "replacement of a missing component" },
  ],
  status: "Activation: {level} · {drug} ·",
  drugNames: ["no treatment", "a C5 blocker", "replacement of a missing component"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], block = drug === 1 ? 1 : 0, repl = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const eff = repl ? cl(0.35 + 0.65 * a) : a;
  const conv = cl(eff);
  const c3b = cl(conv);
  const c5a = cl(conv * (block ? 0.15 : 1));
  const mac = cl(c5a * (block ? 0.5 : 0.95));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(conv, 0.3, 0.65, ["low", "moderate", "high"]), w(c3b, 0.3, 0.65, ["low", "moderate", "high"]), w(c5a, 0.3, 0.65, ["low", "moderate", "high"]), w(mac, 0.3, 0.65, ["low", "moderate", "high"])];
  return { a, block, repl, eff, conv, c3b, c5a, mac, words, readout: "C3 convertase " + words[0] + " · C3b coating " + words[1] + " · C5a signal " + words[2] + " · MAC lysis " + words[3] };
}
const TESTS = [
  [2, 0, "C3 convertase high · C3b coating high · C5a signal high · MAC lysis high"],
  [2, 1, "C3 convertase high · C3b coating high · C5a signal low · MAC lysis low"],
  [0, 2, "C3 convertase moderate · C3b coating moderate · C5a signal moderate · MAC lysis moderate"],
  [0, 0, "C3 convertase low · C3b coating low · C5a signal low · MAC lysis low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">THREE ROUTES IN</text>
<text class="sc-zone" x="34" y="325">EFFECTS</text>
<g id="paths">
  <path class="cp-arr" d="M170 184C220 220 340 242 436 252"/>
  <path class="cp-arr" d="M480 184L480 216"/>
  <path class="cp-arr" d="M790 184C740 220 620 242 524 252"/>
  <path class="cp-arr" d="M444 280C380 312 282 332 230 342"/>
  <path class="cp-arr" d="M480 296L480 326"/>
  <path class="cp-arr" d="M516 280C582 312 678 332 730 342"/>
  <path class="cp-reg" d="M812 258C720 272 610 266 524 260"/>
  <path class="cp-arrh" d="M436 252l-12 -3l4 10Z"/>
  <path class="cp-arrh" d="M480 216l-5 11l10 0Z"/>
  <path class="cp-arrh" d="M524 252l12 -3l-4 10Z"/>
  <path class="cp-arrh" d="M230 342l-12 1l7 8Z"/>
  <path class="cp-arrh" d="M480 326l-5 11l10 0Z"/>
  <path class="cp-arrh" d="M730 342l12 1l-7 8Z"/>
</g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="cells"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-conv{--cc:#e8a33d}.cl-phag{--cc:var(--c-mac)}.cl-neut2{--cc:var(--c-neut)}.cl-reg{--cc:#7fc4e8}.cl-bact{--cc:var(--c-bac)}
.cp-arr{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.cp-arrh{fill:var(--anatomy-mid);stroke:none}
.cp-reg{fill:none;stroke:var(--c-lymph);stroke-width:1.4;stroke-dasharray:5 5;stroke-linecap:round}
.cp-ab{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.cp-dot{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.cp-c3bdot{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 50%,#000);stroke-width:.5}
.cp-pore{fill:none;stroke:#ff9a3d;stroke-width:2}
.cp-blk{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.8}
.cp-blkx{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.cp-plus{fill:var(--anatomy-card);stroke:var(--c-good);stroke-width:1.6}
.cp-plusx{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.p-act{--cc:#ffd24a}.p-c3b{--cc:var(--c-cyt2)}.p-c5a{--cc:#ff5e8a}.p-mac{--cc:#ff9a3d}.p-frag{--cc:var(--c-bac)}
.dr-g-fill.g-conv{fill:#e8a33d}.dr-g-fill.g-c3b{fill:var(--c-cyt2)}.dr-g-fill.g-c5a{fill:#ff5e8a}.dr-g-fill.g-mac{fill:#ff9a3d}
`;

buildScene({
  id: "complement-system", fig: "Fig 1", title: "Complement: three pathways to C3 and the membrane attack complex", W, H, body, extraCss,
  label: "An animated diagram of complement. The classical, lectin and alternative pathways converge on C3 convertase. C3b coats bacteria for phagocytosis, C3a and C5a act as anaphylatoxins and C5a attracts neutrophils, and C5b to C9 forms the membrane attack complex that lyses bacteria. Regulator proteins restrain the convertase. Gauges show C3 convertase, C3b coating, the C5a signal and membrane attack complex lysis. Treatment choices are none, a C5 blocker, and replacement of a missing component.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, laboratory values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "compl.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How complement works.</strong> Three routes switch the system on. The classical pathway starts when antibody on a surface, with C1, is recognised. The lectin pathway starts when mannose-binding lectin or ficolins bind microbial sugars. The alternative pathway ticks over continuously and is amplified on microbial surfaces that lack host regulators. All three build a C3 convertase (classical and lectin C4b2a; alternative C3bBb), which splits C3 into C3a and C3b. C3b coats microbes (opsonisation) so phagocytes can eat them, and more C3b forms a C5 convertase that splits C5 into C5a and C5b. C3a and C5a are anaphylatoxins, and C5a is a strong neutrophil attractant. C5b starts the membrane attack complex (C5b, C6, C7, C8 and many C9) that punches pores in bacterial membranes and lyses the cell. Host cells are protected by regulators such as C1 inhibitor, factor H, factor I, CD55 and CD59. This is standard teaching in immunology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A C5 blocker stops C5 cleavage, so C5a and the membrane attack complex fall while upstream C3b coating is preserved. Replacement of a missing component restores a step that was absent or low. They are teaching toggles only.",
  ],
  simplified: "Individual complement proteins beyond the headline steps, the properdin stabilising loop in detail, complement receptors, immune-complex handling by red cells, genetic deficiency patterns, infection risk with terminal pathway blockade, and every drug, dose and test are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
