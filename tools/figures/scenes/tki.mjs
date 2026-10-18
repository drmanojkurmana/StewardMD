/* BCR-ABL tyrosine kinase inhibitors as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/tki.mjs [--print-model]
 * Static layout here; kinase, drugs, substrates, clone and gauges move in tki.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Clone state", a: [0.92, 0.9, 0.95], names: ["untreated", "responding", "resistant mutation"], ticks: ["untreated", "responding", "resistant"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "imatinib" },
    { label: "dasatinib" },
  ],
  status: "Clone: {level} · {drug} ·",
  drugNames: ["no treatment", "imatinib", "dasatinib"],
};
function modelOf(S, level, drug) {
  const base = S.level.a[level];
  const burden = [0.78, 0.4, 0.92][level];
  const ae = [0.06, 0.42, 0.55][drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  let B;
  if (drug === 0) B = 0;
  else if (level === 2) B = drug === 1 ? 0.04 : 0.06;
  else if (drug === 1) B = level === 0 ? 0.6 : 0.88;
  else B = level === 0 ? 0.85 : 0.9;
  const K = base * (1 - B);
  const P = cl(K * 1.03);
  const G = cl(burden * (0.3 + 0.7 * P));
  const Mut = level === 2 ? 0.95 : 0.04;
  const A = ae;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.3, 0.6, ["low", "raised", "high"]), w(G, 0.35, 0.6, ["low", "raised", "high"]), w(A, 0.3, 0.7, ["few", "some", "many"])];
  return { base, B, K, P, G, Mut, A, lvl: level, dg: drug, words, readout: "signalling " + words[0] + " · growth " + words[1] + " · side effects " + words[2] };
}
const TESTS = [
  [0, 0, "signalling high · growth high · side effects few"],
  [0, 1, "signalling raised · growth raised · side effects some"],
  [0, 2, "signalling low · growth low · side effects some"],
  [2, 2, "signalling high · growth high · side effects some"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="548" height="394" rx="18"/>
<rect class="sc-tissue" x="574" y="44" width="372" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">LEUKAEMIC CELL: BCR-ABL</text>
<text class="sc-zone" x="594" y="68">MARROW: THE CLONE</text>
<g id="chr">
<g transform="translate(80 132)"><rect class="chr-f" x="-9" y="-16" width="7" height="32" rx="3.5"/><rect class="chr-f" x="2" y="-16" width="7" height="32" rx="3.5"/></g>
<g transform="translate(112 132)"><rect class="chr-f" x="-9" y="-16" width="7" height="32" rx="3.5"/><rect class="chr-f" x="2" y="-16" width="7" height="32" rx="3.5"/></g>
<g transform="translate(160 136)"><rect class="chr-ph" x="-9" y="-11" width="7" height="22" rx="3.5"/><rect class="chr-ph" x="2" y="-11" width="7" height="22" rx="3.5"/><circle class="chr-fu" cx="0" cy="-14" r="3.4"/></g>
</g>
<g id="cellbase"></g><g id="kin"></g><g id="nodes"></g><g id="marrow"></g><g id="se"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "tyrosine-kinase-inhibitors-bcr-abl", fig: "Fig 1", title: "Tyrosine kinase inhibitors: blocking BCR-ABL", W, H, body,
  label: "An animated leukaemic cell and marrow clone. A swap between chromosomes 9 and 22 (the Philadelphia chromosome) fuses BCR to ABL, leaving the ABL kinase stuck on. The kinase scoops ATP into its pocket and tags substrates with phosphate, which drives the clone to grow and survive. Imatinib locks the closed form of the pocket while dasatinib fits both forms, but a gatekeeper swap (T315I) rejects both drugs. Gauges show kinase activity, signalling, growth, blockade, the mutant share and side effects.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "tki.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
body{--c-kin:#8fb8f2;--c-subs:#9fe0b8;--c-norm:#cfd6de;--c-leuk:#e0855a;--c-mut:#e5484d;--c-atp:#ffd94a;--c-ps:#c084fc}
body[data-theme="light"]{--c-kin:#3a76c4;--c-subs:#2f9f6c;--c-norm:#9aa6b2;--c-leuk:#c46434;--c-mut:#c42a3d;--c-atp:#d9a92c;--c-ps:#7c3aed}
.cl-kin{--cc:var(--c-kin)}.cl-subs{--cc:var(--c-subs)}.cl-norm{--cc:var(--c-norm)}.cl-leuk{--cc:var(--c-leuk)}
.chr-f{fill:var(--anatomy-mid)}
.chr-ph{fill:var(--c-kin);stroke:color-mix(in srgb,var(--c-kin) 55%,#000);stroke-width:.8}
.chr-fu{fill:var(--c-bad,#e5484d);stroke:var(--anatomy-paper);stroke-width:1}
.pocket{fill:color-mix(in srgb,#1a1030 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.gate{fill:var(--c-good,#3ddc97);stroke:color-mix(in srgb,var(--c-good,#3ddc97) 50%,#000);stroke-width:.7}
.gate.mut{fill:var(--c-mut);stroke:color-mix(in srgb,var(--c-mut) 50%,#000)}
.loop-o{fill:none;stroke:var(--c-kin);stroke-width:2;stroke-linecap:round}
.loop-c{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.p-atp{--cc:var(--c-atp)}.p-ps{--cc:var(--c-ps)}.p-sig{--cc:var(--c-cyt)}
.node-halo{fill:none;stroke:var(--c-subs);stroke-width:1.6}
.sc-cap{fill:var(--anatomy-strong);font-size:11px;text-anchor:middle;pointer-events:none}
.drugI{fill:#f2f5f7;stroke:var(--anatomy-mid);stroke-width:1}
.drugI-b{fill:var(--c-bad,#e5484d)}
.drugD{fill:#24344d;stroke:var(--anatomy-mid);stroke-width:1}
.drugD-b{fill:var(--c-cyt2,#38d1ff)}
.mut-rim{fill:none;stroke:var(--c-mut);stroke-width:2.4}
.ecg-bg{fill:color-mix(in srgb,var(--c-rbc) 10%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.ecg{fill:none;stroke:var(--c-good,#3ddc97);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ecg-long{fill:none;stroke:var(--c-mut);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.drop{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:.8}
.rip{fill:none;stroke:var(--c-fl);stroke-width:1.2;stroke-linecap:round}
.clash{stroke:var(--c-mut);stroke-width:2;stroke-linecap:round}
`,
  sourcesLis: [
    "<strong>What the figure shows.</strong> The Philadelphia chromosome is a swap of material between chromosomes 9 and 22 that fuses the BCR gene to the ABL tyrosine kinase. The fusion protein is constitutively active: its ATP binding pocket keeps loading ATP and tagging substrates with phosphate, which drives proliferation and survival of the leukaemic clone. Imatinib occupies the pocket when the kinase rests in its inactive (closed) form; dasatinib fits both the active and inactive forms and so also works against some imatinib resistant mutants. A single gatekeeper swap (T315I) changes the pocket mouth so that both drugs are rejected while ATP still fits. Fluid retention and pleural effusion, low blood counts from marrow suppression, and QT prolongation are shown as treatment related effects. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> No drug, imatinib, or dasatinib, crossed with an untreated, responding, or gatekeeper mutant clone. These are teaching toggles only.",
  ],
  simplified: "Second and later generation drugs beyond dasatinib, combination regimens, transplant, blast crisis, monitoring of transcript levels, and all doses, targets and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
