/* Hepatitis B in the hepatocyte as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hbv.mjs [--print-model]
 * Static layout here; the virion journey, immune attack, marker curves and gauges move in hbv.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of infection", a: [0.15, 0.55, 0.9], names: ["acute, resolving", "chronic", "cirrhosis"], ticks: ["acute resolving", "chronic", "cirrhosis"], start: 1 },
  drugLabel: "Treatment and prevention",
  settings: [
    { label: "none" },
    { label: "nucleoside analogue" },
    { label: "vaccine" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["none", "a nucleoside analogue", "vaccine antibodies"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const VL0 = [0.3, 0.88, 0.62][level], SG0 = [0.32, 0.92, 0.86][level], EG0 = [0.45, 0.8, 0.45][level];
  const IN0 = [0.68, 0.42, 0.55][level], FB0 = [0.04, 0.34, 0.96][level], AH0 = [0.82, 0.06, 0.04][level];
  const na = drug === 1, vac = drug === 2;
  const vacEff = vac ? [0.85, 0.1, 0.04][level] : 0;
  const V = cl(VL0 * (na ? 0.14 : 1) * (1 - vacEff));
  const Sag = cl(SG0 * (na ? 0.88 : 1) * (1 - vacEff * 0.9));
  const Eag = cl(EG0 * (na ? 0.25 : 1) * (1 - vacEff * 0.7));
  const Inj = cl(IN0 * (na ? (level === 2 ? 0.6 : 0.45) : 1) * (1 - vacEff * 0.55));
  const Fib = cl(FB0 * (na && level < 2 ? 0.85 : 1));
  const Anti = cl(AH0 + (vac ? [0.13, 0.05, 0.02][level] : 0));
  const Ccc = cl(SG0 * (1 - vacEff * 0.9));
  const risk = cl(Fib * (level === 2 ? 0.92 : level === 1 ? 0.3 : 0.05));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.2, 0.55, ["low", "moderate", "high"]), w(Sag, 0.2, 0.6, ["cleared", "present", "high"]), w(Inj, 0.25, 0.58, ["low", "raised", "high"]), w(Fib, 0.2, 0.65, ["none", "some", "severe"])];
  return { V, Sag, Eag, Inj, Fib, Anti, Ccc, risk, vacEff, blkP: na ? 1 : 0, blkE: vacEff, na: na ? 1 : 0, vac: vac ? 1 : 0, lvl: level, pos: [0.72, 0.48, 0.9][level], u0: S.level.a[level], words, readout: "virus " + words[0] + " · HBsAg " + words[1] + " · liver injury " + words[2] + " · fibrosis " + words[3] };
}
const TESTS = [
  [0, 0, "virus moderate · HBsAg present · liver injury high · fibrosis none"],
  [1, 0, "virus high · HBsAg high · liver injury raised · fibrosis some"],
  [1, 1, "virus low · HBsAg high · liver injury low · fibrosis some"],
  [2, 0, "virus high · HBsAg high · liver injury raised · fibrosis severe"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="dr-panel" x="14" y="40" width="606" height="402" rx="16"/>
<text class="sc-zone" x="32" y="64">HEPATITIS B IN THE LIVER</text>
<g id="liverSlot"></g>
<g id="fib"></g>
<g id="cellg"></g>
<g id="parts"></g>
<g id="over"></g>
<rect class="dr-panel" x="632" y="40" width="314" height="402" rx="16"/>
<text class="sc-zone" x="650" y="64">MARKERS OVER TIME</text>
<g id="plot"></g>
<g id="panel"></g>`;

buildScene({
  id: "hepatitis-b", fig: "Fig 1", title: "Hepatitis B: life cycle, immune injury and outcome", W, H, body,
  label: "An animated liver and a marker plot over time. The virus enters a hepatocyte through the NTCP receptor, forms cccDNA in the nucleus, makes viral RNA and proteins, copies its genome with its polymerase, assembles and leaves. Immune T cells kill infected hepatocytes, which is what injures the liver. The plot shows HBsAg, anti-HBs and HBeAg over time in acute resolving, chronic and cirrhosis courses. A nucleoside analogue blocks the polymerase; vaccine antibodies block entry and mainly prevent infection.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hbv.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "No treatment", withLabel: "With nucleoside analogue",
  extraCss: `
.cl-ctl{--cc:var(--c-lymph)}
.hb-cap{fill:var(--anatomy-strong)}
.hb-nuc{fill:none;stroke:var(--anatomy-hi);stroke-width:1.8}
.hb-drug{fill:var(--c-no);stroke:var(--anatomy-paper);stroke-width:1}
.hb-env{fill:#c94f6d;stroke:#7a2b40;stroke-width:.8}.hb-core{fill:#f2d27a;stroke:#9a7a2a;stroke-width:.6}.hb-spk{stroke:#e8a0bf;stroke-width:1.2;stroke-linecap:round;fill:none}
.hb-rna{fill:none;stroke:#f08a4b;stroke-width:1.5;stroke-linecap:round}.hb-dna{fill:none;stroke:#3a86e8;stroke-width:2;stroke-linecap:round}
.hb-host{fill:none;stroke:var(--anatomy-hi);stroke-width:1.8;stroke-linecap:round}.hb-ccc{fill:none;stroke:#3a86e8;stroke-width:2.4}
.hb-ab{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}.hb-rec{fill:none;stroke:#3a86e8;stroke-width:1.8;stroke-linecap:round}.hb-ribo{fill:var(--anatomy-mid)}
.hb-fib{fill:none;stroke:#b08968;stroke-width:5;stroke-linecap:round}
.hb-svp{fill:#e08a3c;stroke:#8a5a1e;stroke-width:.5}.hb-prot{fill:#e8a0bf;stroke:#6e2b49;stroke-width:.5}.hb-mrna{fill:#f08a4b}
.hb-x{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}.hb-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.hb-glow{fill:none;stroke:var(--c-bad);stroke-width:2}
.pl-ax{stroke:var(--anatomy-mid);stroke-width:1;fill:none}
.pl-sag{fill:none;stroke:var(--c-bad);stroke-width:2.6;stroke-linejoin:round}.pl-anti{fill:none;stroke:var(--c-good);stroke-width:2.6;stroke-linejoin:round}.pl-eag{fill:none;stroke:#e08a3c;stroke-width:2.2;stroke-linejoin:round;stroke-dasharray:5 3}
.pl-sag.base,.pl-anti.base,.pl-eag.base{stroke-dasharray:4 4;stroke-width:1.4;opacity:.55}
.pl-mk{stroke:var(--anatomy-strong);stroke-width:1;stroke-dasharray:2 3}.pl-dot{fill:var(--anatomy-strong)}
.g-virus{fill:var(--c-bad)}.g-sag{fill:#e08a3c}.g-anti{fill:var(--c-good)}.g-inj{fill:var(--c-eos)}.g-fib{fill:#b08968}
`,
  sourcesLis: [
    "<strong>How hepatitis B infects and injures the liver.</strong> The virion binds the NTCP bile-acid transporter on a hepatocyte and enters. Its partly double-stranded DNA is completed and kept in the nucleus as cccDNA, a stable mini-chromosome that host enzymes transcribe into viral RNAs. One RNA (pregenomic RNA) is packaged with the viral polymerase, which reverse-transcribes it back to DNA; new virions and large numbers of empty HBsAg particles are then secreted. The virus itself does little direct damage: liver injury is mainly immune-mediated, as cytotoxic T cells kill infected hepatocytes. Strong, broad immunity clears HBsAg and brings anti-HBs (resolution); weak or tolerant immunity leaves chronic infection, and years of injury and repair lay down scar tissue (cirrhosis), which raises the risk of liver failure and hepatocellular carcinoma. This is standard teaching in medicine, hepatology and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Markers and treatment ideas shown.</strong> HBsAg marks current infection and persists in chronic disease; anti-HBs marks recovery and vaccine immunity; HBeAg marks active viral replication and infectivity, and its loss with anti-HBe is seroconversion. Nucleoside analogues block the viral polymerase and suppress replication and inflammation, but they rarely clear cccDNA or HBsAg, so stopping can relapse. Vaccine induces anti-HBs and prevents infection; it does not clear established chronic infection. These are teaching toggles only.",
  ],
  simplified: "Mother-to-child and other transmission routes, genotypes, HDV coinfection, occult infection, HBeAg-negative variants in detail, liver biopsy and elastography, transplant, hepatocellular carcinoma surveillance and treatment, resistance, and all doses, regimens and monitoring targets are left out. The marker curves are generic illustrations of each course and are not predictions for any person.",
});
