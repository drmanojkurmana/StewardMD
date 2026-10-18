/* Hepatitis C in the hepatocyte as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hcv.mjs [--print-model]
 * Static layout here; the virion journey, cleavage, replication and gauges move in hcv.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of liver disease", a: [0.25, 0.65, 1], names: ["acute", "chronic", "cirrhotic"], ticks: ["acute", "chronic", "cirrhotic"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "NS3 protease inhibitor" },
    { label: "NS5B polymerase inhibitor" },
    { label: "NS5A inhibitor combination" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "an NS3 protease inhibitor", "an NS5B polymerase inhibitor", "an NS5A inhibitor combination"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const V0 = [0.45, 0.88, 0.78][level], I0 = [0.5, 0.62, 0.72][level], F0 = [0.03, 0.38, 0.96][level];
  const blk3 = drug === 1 ? 1 : 0, blkB = drug === 2 ? 1 : 0, blkA = drug === 3 ? 1 : 0;
  const proc = cl(1 - blk3 * 0.82 - blkA * 0.35);
  const repF = cl(1 - blkB * 0.88 - blk3 * 0.55 - blkA * 0.6);
  const R = cl(V0 * repF);
  const V = cl(V0 * (drug === 0 ? 1 : blkA ? 0.1 : blkB ? 0.24 : 0.32));
  const Inj = cl(I0 * (drug === 0 ? 1 : 0.3 + 0.7 * (V / Math.max(0.01, V0))));
  const Fib = cl(F0 * (drug !== 0 && level < 2 ? 0.92 : 1));
  const Risk = cl(Fib * [0.04, 0.25, 0.92][level]);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.2, 0.55, ["low", "moderate", "high"]), w(Inj, 0.25, 0.58, ["low", "raised", "high"]), w(Fib, 0.2, 0.65, ["none", "some", "severe"]), w(Risk, 0.2, 0.55, ["low", "raised", "high"])];
  return { V, R, proc, Inj, Fib, Risk, blk3, blkB, blkA, lvl: level, pos: [0.2, 0.55, 0.9][level], words, readout: "virus " + words[0] + " · liver injury " + words[1] + " · fibrosis " + words[2] + " · cancer risk " + words[3] };
}
const TESTS = [
  [0, 0, "virus moderate · liver injury raised · fibrosis none · cancer risk low"],
  [1, 0, "virus high · liver injury high · fibrosis some · cancer risk low"],
  [1, 3, "virus low · liver injury low · fibrosis some · cancer risk low"],
  [2, 0, "virus high · liver injury high · fibrosis severe · cancer risk high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="dr-panel" x="14" y="40" width="606" height="402" rx="16"/>
<text class="sc-zone" x="32" y="64">A HEPATOCYTE IN THE LIVER</text>
<text class="sc-lab hc-step" id="stepname" x="32" y="120">Step 1: entry</text>
<g id="fib"></g>
<g id="cellg"></g>
<g id="steps"></g>
<g id="over"></g>
<rect class="dr-panel" x="632" y="40" width="314" height="402" rx="16"/>
<text class="sc-zone" x="650" y="64">LIVER OVER TIME</text>
<g id="prog"></g>
<g id="panel"></g>`;

buildScene({
  id: "hepatitis-c-life-cycle", fig: "Fig 1", title: "Hepatitis C: life cycle, liver damage and treatment targets", W, H, body,
  label: "An animated hepatocyte and a liver progression diagram. Hepatitis C virus enters a hepatocyte and releases its RNA genome. The RNA is translated into one long polyprotein, which the NS3 protease cleaves into working proteins. The NS5B RNA polymerase, helped by NS5A, copies the RNA on liver cell membranes, and new virions assemble and leave. Years of chronic infection and inflammation lay down fibrosis, then cirrhosis, and raise the risk of liver cancer. Treatment choices block NS3, NS5B or NS5A in combination.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hcv.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.cl-hep{--cc:#d98a6a}.cl-hnuc{--cc:#8a7ac0}
body[data-theme="light"] .cl-hep{--cc:#c97a5e}
.hc-step{font-size:11px}
.hc-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:.8}.hc-box.on{fill:color-mix(in srgb,var(--c-no) 35%,var(--anatomy-card));stroke:var(--c-no)}
.hc-bn{fill:var(--anatomy-text);font:600 10.5px var(--anatomy-mono);pointer-events:none}
.hc-env{fill:#3a9a8c;stroke:#1e5a52;stroke-width:.8}.hc-core{fill:#f2d27a;stroke:#9a7a2a;stroke-width:.6}.hc-spk{stroke:#7ac0b8;stroke-width:1.2;stroke-linecap:round;fill:none}
.hc-rna{fill:none;stroke:#f08a4b;stroke-width:1.8;stroke-linecap:round}.hc-rna2{fill:none;stroke:#e85a7a;stroke-width:1.6;stroke-linecap:round}
.hc-seg{stroke:#5a3a1a;stroke-width:.6}.hc-pol{fill:#8a7ac0;stroke:#4a3a7a;stroke-width:.8}.hc-ns3{fill:#e08a3c;stroke:#8a5a1e;stroke-width:.8}.hc-ns5a{fill:#3a86e8;stroke:#1e4a7a;stroke-width:.6}
.hc-er{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.hc-fib{fill:none;stroke:#b08968;stroke-width:5;stroke-linecap:round}.hc-nod{fill:#a85d4a;stroke:#6e3527;stroke-width:.8}.hc-hcc{fill:#8e2f35;stroke:#4d1518;stroke-width:.9}.hc-hccn{fill:#4d1518}
.hc-x{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}.hc-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.hc-glow{fill:none;stroke:var(--c-bad);stroke-width:2}
.hc-stg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}.hc-stg.on{stroke:var(--c-no);stroke-width:2.4}
.hc-arr{stroke:var(--anatomy-mid);stroke-width:1.6;fill:none}
.hc-dot-h{fill:#d98a6a}.hc-dot-f{fill:#b08968}.hc-dot-c{fill:#a85d4a}.hc-dot-ca{fill:#8e2f35}
.g-virus{fill:var(--c-bad)}.g-rep{fill:#f08a4b}.g-inj{fill:var(--c-eos)}.g-fib{fill:#b08968}.g-risk{fill:#8e2f35}
`,
  sourcesLis: [
    "<strong>How hepatitis C infects a hepatocyte.</strong> Hepatitis C virus (HCV) is an enveloped, positive-sense RNA virus. It enters hepatocytes through a set of surface receptors, releases its single RNA genome into the cytoplasm (it does not need the nucleus or integrate into host DNA), and the host ribosome translates that RNA into one long polyprotein on the endoplasmic reticulum. Viral and host proteases cleave the polyprotein: the NS3 protease is a key viral cutter. The NS5B RNA-dependent RNA polymerase, organised with NS5A and other non-structural proteins in a membrane replication complex, copies the RNA. New genomes and structural proteins assemble at lipid droplets and the endoplasmic reticulum, and virions leave the cell. This is standard teaching in medicine, virology and hepatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>From infection to cirrhosis and cancer, and the treatment ideas shown.</strong> Many infections become chronic. Years of immune inflammation and hepatocyte injury and repair lay down scar tissue (fibrosis), which can progress to cirrhosis and raise the risk of liver failure and hepatocellular carcinoma (liver cancer). Direct-acting antivirals target viral proteins: NS3 protease inhibitors stop polyprotein cleavage, NS5B polymerase inhibitors stop RNA copying, and NS5A inhibitors disrupt the replication complex and assembly; modern treatment combines such agents. These are teaching toggles only, not a regimen.",
  ],
  simplified: "Entry-receptor detail, genotypes and resistance, lipid and lipoprotein handling, acute clearance rates, biopsy and elastography, transplant, cancer surveillance and treatment, extrahepatic effects, and all doses, regimens and cure-rate numbers are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
