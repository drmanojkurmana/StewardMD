/* Multiple sclerosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ms.mjs [--print-model]
 * Static layout here; immune cells, myelin, impulses and gauges move in ms.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease course", a: [0.22, 0.95, 0.48], names: ["remission", "relapse", "progression"], ticks: ["remission", "relapse", "progression"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "steroid for relapse" },
    { label: "disease-modifying therapy" },
    { label: "steroid with disease-modifying therapy" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "a steroid for relapse", "disease-modifying therapy", "a steroid with disease-modifying therapy"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const ster = drug === 1 || drug === 3 ? 1 : 0, dmt = drug === 2 || drug === 3 ? 1 : 0;
  const dmgBase = [0.26, 0.5, 0.9][level];
  const sEff = ster ? (level === 1 ? 0.65 : level === 0 ? 0.25 : 0.1) : 0;
  const dEff = dmt ? (level === 2 ? 0.3 : 0.48) : 0;
  const I = cl(a * (1 - sEff) * (1 - dEff));
  const L = cl(0.08 + 0.88 * I - (ster ? 0.12 : 0));
  const M = cl(dmgBase + 0.2 * I * (dmt ? 0.35 : 1) - (level === 0 ? 0.08 : 0));
  const C = cl(1 - 0.72 * M - 0.22 * I + (ster && level === 1 ? 0.1 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(I, 0.3, 0.6, ["low", "moderate", "high"]), w(L, 0.3, 0.6, ["tight", "leaky", "very leaky"]), w(M, 0.35, 0.65, ["little", "moderate", "extensive"]), w(C, 0.35, 0.65, ["blocked", "slowed", "preserved"])];
  return { a, ster, dmt, I, L, M, C, words, readout: "immune attack " + words[0] + " · barrier " + words[1] + " · myelin loss " + words[2] + " · conduction " + words[3] };
}
const TESTS = [
  [0, 0, "immune attack low · barrier tight · myelin loss little · conduction preserved"],
  [1, 0, "immune attack high · barrier very leaky · myelin loss extensive · conduction blocked"],
  [1, 1, "immune attack moderate · barrier tight · myelin loss moderate · conduction slowed"],
  [2, 0, "immune attack moderate · barrier leaky · myelin loss extensive · conduction blocked"],
];

/* ---------------- static layout ---------------- */
const AXY = 345;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BLOOD</text>
<text class="sc-zone" x="34" y="262">BRAIN (CNS)</text>
<rect id="bbbBand" class="ms-bbbband" x="14" y="206" width="${W - 28}" height="24" rx="12"/>
<g id="bbb"></g>
<path class="ms-proc" d="M380 292L360 330M388 294L438 330"/>
<ellipse id="plaque" class="ms-plaque" cx="488" cy="${AXY}" rx="110" ry="27" opacity="0"/>
<rect id="axonRect" class="ms-axon" x="104" y="${AXY - 4}" width="756" height="8" rx="4"/>
<circle class="ms-soma" cx="78" cy="${AXY}" r="26"/>
<path class="ms-dend" d="M62 ${AXY - 18}L38 ${AXY - 34}M58 ${AXY}L32 ${AXY}M62 ${AXY + 18}L40 ${AXY + 32}"/>
<g id="myelin"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="imps"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-oligo{--cc:#8fd0a8}.cl-micro{--cc:#c978c9}
.ms-bbbband{fill:color-mix(in srgb,var(--c-endo) 28%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ms-axon{fill:#f3e2b8;stroke:#b89a58;stroke-width:.9}
.ms-soma{fill:#e8a04c;stroke:color-mix(in srgb,#e8a04c 55%,#000);stroke-width:1}
.ms-dend{fill:none;stroke:#b89a58;stroke-width:2;stroke-linecap:round}
.ms-myelin{fill:#e9c04a;stroke:color-mix(in srgb,#e9c04a 55%,#000);stroke-width:1}
.ms-plaque{fill:var(--c-bad)}
.ms-proc{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;opacity:.6}
.ms-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.g-imm{fill:var(--c-lymph)}.g-mye{fill:#e9c04a}
`;

buildScene({
  id: "multiple-sclerosis", fig: "Fig 1", title: "Multiple sclerosis: myelin attack and conduction block", W, H, body, extraCss,
  label: "An animated blood-brain barrier and myelinated axon in multiple sclerosis. Autoreactive T cells and B cells in the blood cross the blood-brain barrier into the brain. With microglia they attack the myelin sheath made by oligodendrocytes. The stripped segment forms a plaque where the impulse slows or blocks. The course slider moves from remission to relapse to progression. Treatment choices are a steroid for relapse and disease-modifying therapy. Gauges show immune attack, barrier leak, myelin loss and conduction.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H, AXY }, pageJs: readFileSync(join(HERE, "ms.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How multiple sclerosis injures the brain.</strong> For reasons not fully understood, autoreactive T cells and B cells that recognise myelin antigens are activated outside the brain. They cross the blood-brain barrier, whose endothelial lining normally limits entry to the brain and spinal cord. Inside, T cells, B cells, antibodies, microglia and macrophages attack the myelin sheath made by oligodendrocytes. The stripped axon segment forms a plaque: saltatory conduction fails there, so the impulse slows or blocks and symptoms appear. This is standard teaching in neurology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Relapse, remission and progression.</strong> A relapse is a burst of new inflammation and demyelination. In remission inflammation settles and some thin remyelination can occur, so conduction partly recovers. Over time axons themselves are lost, repair fails and disability builds even between relapses: progression. The course slider compresses that long story into three stages.",
    "<strong>Treatment ideas shown.</strong> A steroid for relapse calms the acute inflammation and barrier leak quickly, so a relapse settles faster, but it does not repair myelin or prevent later damage. Disease-modifying therapy lowers the autoreactive attack and the rate of new plaques over time, so it protects conduction in the long run, but it does not reverse fixed myelin or axon loss. These are teaching toggles only and name no individual drug or dose.",
  ],
  simplified: "Genetic and environmental triggers, Epstein-Barr virus and vitamin D ideas, individual lesion sites and symptoms, optic nerve and spinal cord lesions, imaging and spinal fluid tests, individual disease-modifying drugs and their risks, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
