/* HIV life cycle and immune decline as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hiv.mjs [--print-model]
 * Static layout here; the virion's journey, the over-the-years plot and the gauges animate in hiv.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of infection", a: [0.1, 0.5, 0.88], names: ["acute infection", "chronic, no symptoms", "advanced (AIDS)"], ticks: ["acute", "chronic", "advanced"], start: 1 },
  drugLabel: "Antiretroviral treatment",
  settings: [
    { label: "no treatment" },
    { label: "entry inhibitor (maraviroc, enfuvirtide class)" },
    { label: "reverse transcriptase inhibitor (NRTI or NNRTI)" },
    { label: "integrase inhibitor" },
    { label: "protease inhibitor" },
    { label: "combination antiretroviral therapy" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "an entry inhibitor alone", "a reverse transcriptase inhibitor alone", "an integrase inhibitor alone", "a protease inhibitor alone", "combination therapy"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const VL0 = [0.9, 0.5, 0.85][level], CD0 = [0.8, 0.6, 0.15][level];
  const e = [0, 0.6, 0.6, 0.6, 0.6, 0.97][drug];
  const VL = cl(VL0 * (1 - e)), CD = cl(CD0 + e * (0.8 - CD0) * 0.8), risk = cl(1.2 - 1.6 * CD), inf = cl(VL * 0.95);
  const blk = { entry: drug === 1 ? 0.6 : drug === 5 ? 1 : 0, rt: drug === 2 ? 0.6 : drug === 5 ? 1 : 0, integ: drug === 3 ? 0.6 : drug === 5 ? 1 : 0, prot: drug === 4 ? 0.6 : drug === 5 ? 1 : 0 };
  const w = (v, a, b, c, ws) => (v < a ? ws[0] : v < b ? ws[1] : v < c ? ws[2] : ws[3]);
  const words = [w(VL, 0.1, 0.3, 0.6, ["undetectable", "low", "moderate", "high"]), CD < 0.3 ? "low" : CD < 0.62 ? "moderate" : "preserved", risk < 0.2 ? "low" : risk < 0.5 ? "some" : "high"];
  return { e, VL, CD, risk, inf, blk, u0: S.level.a[level], VL0, CD0, words, readout: "viral load " + words[0] + " · CD4 count " + words[1] + " · infection risk " + words[2] };
}
const TESTS = [
  [1, 0, "viral load moderate · CD4 count moderate · infection risk some"],
  [2, 0, "viral load high · CD4 count low · infection risk high"],
  [2, 5, "viral load undetectable · CD4 count preserved · infection risk low"],
  [1, 2, "viral load low · CD4 count preserved · infection risk low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="dr-panel" x="14" y="40" width="606" height="402" rx="16"/>
<text class="sc-zone" x="32" y="64">INSIDE A CD4 T CELL</text>
<text class="sc-lab hv-step" id="stepname" x="32" y="426">Step 1: binding</text>
<g id="steps"></g>
<g id="cellg"></g>
<g id="over"></g>
<rect class="dr-panel" x="632" y="40" width="314" height="402" rx="16"/>
<text class="sc-zone" x="650" y="64">OVER THE YEARS</text>
<g id="plot"></g>
<g id="panel"></g>`;

buildScene({
  id: "hiv-pathogenesis", fig: "Fig 1", title: "HIV: life cycle and immune decline", W, H, body,
  label: "An animated CD4 T cell and a plot over the years. A virion binds the CD4 receptor and a co-receptor, fuses, releases its RNA, reverse transcribes it to DNA, integrates the DNA into the host genome, makes new viral parts, assembles, buds out and matures. The plot shows CD4 count falling and viral load rising over the years, with opportunistic infections appearing as CD4 falls. Antiretroviral drugs block entry, reverse transcription, integration or maturation, and combination therapy suppresses the virus and lets CD4 recover.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hiv.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.cl-cd4{--cc:var(--c-lymph)}.cl-nuc{--cc:#7a63b8}.cl-prog{--cc:var(--c-bad)}
body[data-theme="light"] .cl-nuc{--cc:#9a86d6}
.hv-env{fill:#b5517a;stroke:#6e2b49;stroke-width:.8}.hv-spk{stroke:#e8a0bf;stroke-width:1.3;stroke-linecap:round;fill:none}.hv-cap{fill:#f1d9a0;stroke:#9a7a2a;stroke-width:.8}
.hv-rna{fill:none;stroke:#f08a4b;stroke-width:1.5;stroke-linecap:round}.hv-dna{fill:none;stroke:#3a86e8;stroke-width:2.3;stroke-linecap:round}.hv-host{fill:none;stroke:var(--anatomy-hi);stroke-width:2.2;stroke-linecap:round}
.hv-prov{fill:none;stroke:#3a86e8;stroke-width:3.4;stroke-linecap:round}.hv-mrna{fill:#f08a4b}.hv-prot{fill:#e8a0bf;stroke:#6e2b49;stroke-width:.5}.hv-ribo{fill:var(--anatomy-mid)}
.hv-imm .hv-env{fill:none;stroke-dasharray:3 2}.hv-x{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}.hv-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.hv-cd4{fill:none;stroke:#3a86e8;stroke-width:2;stroke-linecap:round}.hv-ccr{fill:none;stroke:#f08a4b;stroke-width:2;stroke-linecap:round}
.hv-glow{fill:none;stroke:var(--c-no);stroke-width:2}
.hv-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:.8}.hv-box.on{fill:color-mix(in srgb,var(--c-no) 35%,var(--anatomy-card));stroke:var(--c-no)}
.hv-bn{fill:var(--anatomy-text);font:600 10.5px var(--anatomy-mono);pointer-events:none}
.pl-ax{stroke:var(--anatomy-mid);stroke-width:1;fill:none}.pl-ph{stroke:var(--anatomy-faint);stroke-width:.8;stroke-dasharray:3 3}
.pl-cd{fill:none;stroke:var(--c-lymph);stroke-width:2.6;stroke-linejoin:round}.pl-vl{fill:none;stroke:var(--c-bad);stroke-width:2.6;stroke-linejoin:round}
.pl-cd.base,.pl-vl.base{stroke-dasharray:4 4;stroke-width:1.6}.pl-mk{stroke:var(--anatomy-strong);stroke-width:1;stroke-dasharray:2 3}.pl-dot{fill:var(--anatomy-strong)}
.g-vl{fill:var(--c-bad)}.g-cd4{fill:var(--c-lymph)}.g-risk{fill:var(--c-eos)}.g-inf{fill:var(--c-cyt)}
`,
  sourcesLis: [
    "<strong>How HIV infects and damages immunity.</strong> The virion's gp120 binds CD4 on a T helper cell and then a co-receptor (CCR5 or CXCR4); gp41 drives fusion. The capsid opens, reverse transcriptase copies the RNA to DNA, integrase inserts it into the host genome (the provirus), host machinery makes new viral RNA and proteins, and the virion assembles, buds and matures when protease cuts its precursor proteins. Over years the CD4 count falls, so opportunistic infections and some cancers appear as the count gets low (AIDS). This is standard teaching in medicine and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Entry inhibitors, reverse transcriptase inhibitors, integrase inhibitors and protease inhibitors each block one step; combination antiretroviral therapy blocks several and suppresses the virus while CD4 cells recover. A single drug alone is shown only as a teaching contrast, because resistance develops quickly on one drug.",
  ],
  simplified: "Latent reservoirs, resistance mutations, other co-receptor details, mucosal transmission, acute syndrome details, HIV-2, prevention, drug interactions and all doses, regimens and monitoring targets are left out. The over-the-years plot is a generic illustration of an untreated course and of the effect of starting treatment; it is not a prediction for any person.",
});
