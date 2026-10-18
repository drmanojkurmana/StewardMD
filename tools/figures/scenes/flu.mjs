/* Influenza virus cycle in respiratory epithelium as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/flu.mjs [--print-model]
 * Static layout here; the virion journey, progeny release, cell death and gauges move in flu.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of illness", a: [0.2, 0.6, 1], names: ["early", "established", "complicated"], ticks: ["early", "established", "complicated"], start: 1 },
  drugLabel: "Treatment and prevention",
  settings: [
    { label: "no treatment" },
    { label: "neuraminidase inhibitor, given early" },
    { label: "vaccine induced immunity (prevention)" },
    { label: "supportive care only" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a neuraminidase inhibitor", "vaccine induced immunity", "supportive care"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const VL0 = [0.38, 0.86, 0.78][level];
  const D0 = [0.16, 0.56, 0.92][level];
  const F0 = [0.42, 0.76, 0.86][level];
  const P0 = [0.06, 0.28, 0.88][level];
  const naiEff = drug === 1 ? [0.78, 0.48, 0.22][level] : 0;
  const vacEff = drug === 2 ? [0.86, 0.62, 0.36][level] : 0;
  const sup = drug === 3 ? 1 : 0;
  const V = cl(VL0 * (1 - naiEff) * (1 - vacEff));
  const D = cl(D0 * (1 - naiEff * 0.72) * (1 - vacEff * 0.72));
  const F = cl(F0 * (1 - naiEff * 0.55) * (1 - vacEff * 0.6) * (sup ? 0.72 : 1));
  const P = cl(P0 * (1 - naiEff * 0.5) * (1 - vacEff * 0.55) * (sup ? 0.84 : 1));
  const I = cl([0.34, 0.48, 0.3][level] + vacEff * 0.55);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.2, 0.55, ["low", "moderate", "high"]), w(D, 0.22, 0.58, ["low", "raised", "high"]), w(F, 0.3, 0.6, ["mild", "raised", "high"]), w(P, 0.18, 0.5, ["low", "some", "high"])];
  return { V, D, F, P, I, naiEff, vacEff, blkHA: vacEff, blkNA: naiEff, nai: drug === 1 ? 1 : 0, vac: drug === 2 ? 1 : 0, sup, lvl: level, u0: S.level.a[level], words, readout: "virus " + words[0] + " · epithelial death " + words[1] + " · fever and systemic illness " + words[2] + " · pneumonia risk " + words[3] };
}
const TESTS = [
  [0, 0, "virus moderate · epithelial death low · fever and systemic illness raised · pneumonia risk low"],
  [1, 0, "virus high · epithelial death raised · fever and systemic illness high · pneumonia risk some"],
  [1, 1, "virus moderate · epithelial death raised · fever and systemic illness raised · pneumonia risk some"],
  [2, 0, "virus high · epithelial death high · fever and systemic illness high · pneumonia risk high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="dr-panel" x="14" y="40" width="606" height="402" rx="16"/>
<text class="sc-zone" x="32" y="64">RESPIRATORY EPITHELIUM AND AIRWAY</text>
<text class="sc-lab flu-step" id="stepname" x="32" y="120">Step 1: binding</text>
<g id="cells"></g>
<g id="parts"></g>
<g id="journey"></g>
<g id="over"></g>
<rect class="dr-panel" x="632" y="40" width="314" height="402" rx="16"/>
<text class="sc-zone" x="650" y="64">ANTIGENIC CHANGE AND OUTCOME</text>
<g id="change"></g>
<g id="over2"></g>
<g id="panel"></g>`;

buildScene({
  id: "influenza-virus-cycle", fig: "Fig 1", title: "Influenza: virus cycle, epithelial injury and pneumonia", W, H, body,
  label: "An animated respiratory epithelial cell layer and an antigenic change panel. Haemagglutinin on the influenza virion binds sialic acid on the cell surface, the virion is taken in by endocytosis, its segmented genome replicates in the nucleus, new virions assemble at the surface and neuraminidase clips them free. Infected epithelial cells die, fever and systemic illness follow, and pneumonia can complicate the illness, including secondary bacterial pneumonia. Antigenic drift changes haemagglutinin and neuraminidase a little each season; antigenic shift reassorts genome segments and can make a new subtype. A neuraminidase inhibitor helps most when given early, vaccine induced immunity prevents binding and infection, and supportive care eases illness without stopping the virus.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "flu.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.flu-step{font-size:11px}
.cl-epi{--cc:#e9a2b3}.cl-nuc{--cc:#8a7ac0}
body[data-theme="light"] .cl-nuc{--cc:#9a86d6}
.flu-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:.8}.flu-box.on{fill:color-mix(in srgb,var(--c-no) 35%,var(--anatomy-card));stroke:var(--c-no)}
.flu-bn{fill:var(--anatomy-text);pointer-events:none}
.flu-cell{fill:color-mix(in srgb,var(--c-endo) 34%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.flu-cell.hot-cell{fill:color-mix(in srgb,var(--c-endo) 52%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.4}
.flu-nuc{fill:#8a7ac0;stroke:#5a4a96;stroke-width:.8;opacity:.9}
.flu-cilia{stroke:var(--c-endo);stroke-width:1.4;stroke-linecap:round;fill:none}
.flu-sia{stroke:#3a86e8;stroke-width:1.6;stroke-linecap:round;fill:none}
.flu-env{fill:#c94f6d;stroke:#7a2b40;stroke-width:.8}
.flu-ha{stroke:#e5484d;stroke-width:1.7;stroke-linecap:round;fill:none}
.flu-na{stroke:#3a86e8;stroke-width:1.7;stroke-linecap:round;fill:none}
.flu-ha-mut{stroke:#f08a4b;stroke-width:1.9;stroke-linecap:round;fill:none}
.flu-seg{stroke:#f2d27a;stroke-width:1.2;stroke-linecap:round}
.flu-rna{fill:#f08a4b}
.flu-endo{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 3}
.flu-bac{fill:#7fcf6a;stroke:#3f7a32;stroke-width:.6}
.flu-debris{fill:#b08968;stroke:#6e4f36;stroke-width:.5}
.flu-ab{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.flu-x{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}.flu-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.flu-arr{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.flu-divider{stroke:var(--anatomy-faint);stroke-width:.8}
.g-virus{fill:var(--c-bad)}.g-death{fill:#b08968}.g-fever{fill:var(--c-eos)}.g-pneu{fill:#3a86e8}
`,
  sourcesLis: [
    "<strong>How influenza infects the airway.</strong> Haemagglutinin on the virion binds sialic acid on respiratory epithelial cells, the virion enters by endocytosis, acidification frees its segmented negative sense RNA genome, and replication and transcription happen in the nucleus, unusual for an RNA virus. New haemagglutinin and neuraminidase reach the cell surface, virions bud there, and neuraminidase clips sialic acid so progeny virions can leave and spread instead of sticking to the dying cell or to mucus. Infected epithelial cells die and are shed, cilia are lost, and the denuded airway is prone to secondary bacterial infection. Fever and systemic illness reflect inflammatory mediators, and complications occur primarily in the lung as primary viral pneumonia or secondary bacterial pneumonia, particularly in young children, older persons and people with chronic illness, where pulmonary findings and mortality are highest. Cleavage activation of haemagglutinin by host proteases is needed for infectivity. Immunity to haemagglutinin and neuraminidase protects, but antigenic drift (small changes) lets the virus partly escape it each season, and antigenic shift (reassortment of segments, for example in a co infected host) can produce a subtype with little population immunity and pandemic potential. This is standard teaching in medicine and infectious disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment and prevention ideas shown.</strong> Neuraminidase inhibitors block release and work best early, vaccine induced antibody to haemagglutinin blocks binding and prevents illness, and supportive care eases fever and breathing without a direct antiviral effect. These are teaching toggles only.",
  ],
  simplified: "Subtypes and strain naming in detail, polymerase complex proteins, NS1 immune evasion, host protease cleavage detail, extrapulmonary manifestations, bacterial species detail, diagnostics, resistance, and all doses, regimens and vaccine schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
