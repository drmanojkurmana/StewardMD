/* Blinatumomab in B lineage acute lymphoblastic leukaemia as an animated, working scene
 * (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/blina.mjs [--print-model]
 * Static layout here; bridging, synapse, killing, cytokines and gauges move in blina.page.js.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Leukaemia burden", a: [0.15, 0.55, 1], names: ["minimal", "active", "high"], ticks: ["minimal", "active", "high"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "blinatumomab" },
    { label: "infusion paused: toxicity care" },
  ],
  status: "Burden: {level} · {drug} ·",
  drugNames: ["no treatment", "blinatumomab", "infusion paused: toxicity care"],
};
/* drug 2 is an explicit pause: the infusion is held for severe toxicity, so no new
 * CD19-CD3 bridging forms and no ongoing killing runs. B stays a qualitative,
 * persistent burden readout; prior B cell depletion persists while cytokines and
 * neurotoxicity ease but need not clear. */
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug === 1 ? 1 : 0, care = drug === 2 ? 1 : 0;
  const exposed = drug >= 1 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const syn = on ? cl(0.35 + 0.65 * a) : 0.02;
  const kill = on ? cl(0.25 + 0.75 * syn) : 0.03;
  const B = cl((0.15 + 0.8 * a) * (1 - 0.88 * kill * (1 - 0.3 * a)));
  const Nb = cl(0.92 - (exposed ? 0.72 : 0));
  const Ab = cl(0.9 - (exposed ? 0.62 : 0));
  const peakC = 0.1 + 0.55 * a + 0.25 * Math.sin(Math.PI * Math.min(1, 0.25 + 0.75 * a));
  const peakN = 0.12 + 0.5 * a;
  const C = cl(on ? peakC : care ? 0.5 * peakC : 0.03);
  const N = cl(on ? peakN : care ? 0.6 * peakN : 0.02);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.25, 0.6, ["cleared", "present", "high"]), w(Nb, 0.3, 0.65, ["gone", "low", "normal"]), w(Math.max(C, N), 0.3, 0.6, ["quiet", "warning", "severe"])];
  return { a, on, care, syn, kill, B, Nb, Ab, C, N, words, readout: "blasts " + words[0] + " · B cells " + words[1] + " · toxicity " + words[2] };
}
const TESTS = [
  [2, 0, "blasts high · B cells normal · toxicity quiet"],
  [1, 1, "blasts present · B cells gone · toxicity severe"],
  [0, 1, "blasts cleared · B cells gone · toxicity warning"],
  [1, 2, "blasts present · B cells gone · toxicity warning"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LEUKAEMIA AND T CELL</text>
<text class="sc-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="norm"></g>
<g id="stage"></g>
<g id="bridge"></g>
<g id="gran"></g>
<g id="debris"></g>
<g id="vessel"></g><g id="blood"></g><g id="glow"></g>
<g id="brainSlot"></g><g id="brainFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "blinatumomab-mechanism-adverse-effects", fig: "Fig 1", title: "Blinatumomab: bridging T cells to leukaemia and side effects", W, H, body,
  label: "An animated scene of blinatumomab in B lineage acute lymphoblastic leukaemia. A malignant B cell carries CD19 and a T cell carries CD3. Blinatumomab grips both, pulling the cells into an immune synapse, and the T cell releases perforin and granzymes that lyse the blast. Normal CD19 B cells are depleted too, so antibodies fall and infection risk rises. Activated T cells flood the blood with cytokines, giving systemic inflammation, and neurologic toxicity including ICANS can follow by a mechanism that is not fully understood. Gauges show blasts, B cells, killing, cytokines and neurotoxicity.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "blina.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "Infusion paused",
  sourcesLis: [
    "<strong>How blinatumomab works.</strong> Blinatumomab binds CD19 on B lineage cells and CD3 on T cells, pulling them together into an immune synapse; the T cell then releases cytolytic proteins and cytokines and lyses the CD19 positive cell. FDA BLINCYTO prescribing information (2024) (<a href=\"https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/125557Orig1s028Correctedlbl.pdf\">label</a>).",
    "<strong>Harms shown.</strong> The label carries boxed warnings for cytokine release syndrome and neurological toxicities including ICANS. Normal CD19 positive B cells are depleted alongside blasts, so antibodies fall and infection risk rises. Severe cytokine release or neurologic toxicity needs clinical treatment and the infusion may be paused; care is shown easing but not erasing toxicity. Neurologic toxicity is drawn as associated harm with no causal arrow, because its mechanism is not fully understood. This is a teaching summary only.",
  ],
  simplified: "B lineage subtypes, measurable residual disease testing, infusion pump logistics, premedication choices, treatment pauses and restarts, tumour lysis, cytopenias, transplant pathways, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.bl-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.bl-cap{fill:var(--anatomy-strong);font-size:13px}
.bl-cd19{fill:#e8d36a;stroke:color-mix(in srgb,#e8d36a 55%,#000);stroke-width:.8}
.bl-cd3{fill:#7fc4e8;stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:.8}
.bl-arm19{stroke:#c9a92c;stroke-width:2.2;stroke-linecap:round}
.bl-arm3{stroke:#3fa0d4;stroke-width:2.2;stroke-linecap:round}
.bl-core{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.9}
.bl-syn{fill:none;stroke:#ffd24a;stroke-width:2.4;stroke-dasharray:7 5;stroke-linecap:round}
.bl-hit{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.bl-ab{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
.bl-cyt{--cc:var(--c-cyt)}
.bl-gran{--cc:#ff8fa3}
.bl-deb{--cc:var(--c-bad)}
.bl-infl{fill:var(--c-bad);stroke:none}
.bl-ring{fill:none;stroke:var(--c-bad);stroke-width:2}
.bl-q{fill:var(--anatomy-strong);font-size:15px;font-weight:700}
.bl-unk{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:4 4}
.cl-blast{--cc:#e07a6a}.cl-tcell{--cc:#7fc4e8}.cl-nb{--cc:#e8d36a}
.p-bridge{--cc:#ffd24a}.p-gran{--cc:#ff8fa3}.p-cyt{--cc:var(--c-cyt)}.p-deb{--cc:var(--c-bad)}
.dr-g-fill.g-blast{fill:#e07a6a}.dr-g-fill.g-nb{fill:var(--c-b)}.dr-g-fill.g-kill{fill:var(--c-good)}.dr-g-fill.g-cyt{fill:var(--c-cyt)}.dr-g-fill.g-nt{fill:#ff8fa3}
`,
});
