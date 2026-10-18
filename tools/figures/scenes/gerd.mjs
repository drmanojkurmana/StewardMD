/* GERD and Barrett oesophagus as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gerd.mjs [--print-model]
 * Static layout here; reflux, sphincter, mucosa and gauges move in gerd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the oesophagus", a: [0, 1, 2, 3], names: ["normal", "oesophagitis", "Barrett", "adenocarcinoma"], ticks: ["normal", "oesophagitis", "Barrett", "cancer"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "lifestyle measures" },
    { label: "acid suppression" },
    { label: "endoscopic or surgical treatment" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "lifestyle measures", "acid suppression", "endoscopic or surgical treatment"],
};
function modelOf(S, level, drug) {
  const refluxMul = [1, 0.68, 0.78, 0.28];
  const acidMul = [1, 0.85, 0.22, 0.35];
  const stageReflux = [0.14, 0.58, 0.8, 0.86];
  const stageInjury = [0.04, 0.78, 0.5, 0.72];
  const stageBarrett = [0, 0.04, 0.92, 0.96];
  const stageStricture = [0, 0.34, 0.62, 0.78];
  const stageCancer = [0, 0.02, 0.2, 0.95];
  const herniaByStage = [0.12, 0.42, 0.66, 0.7];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const R = cl(stageReflux[level] * refluxMul[drug]);
  const A = cl(R * acidMul[drug] * 1.35 + (level === 0 ? 0.02 : 0.08));
  const I = cl(stageInjury[level] * (drug === 2 ? 0.35 : drug === 3 ? 0.55 : drug === 1 ? 0.65 : 1));
  const B = cl(stageBarrett[level] * (drug === 3 ? 0.3 : 1));
  const ST = cl(stageStricture[level] * (drug === 3 ? 0.45 : 1));
  const CA = cl(stageCancer[level] * (drug === 3 && level < 3 ? 0.4 : drug === 3 ? 0.75 : 1));
  const D = cl([0, 0.04, 0.48, 0.88][level] * (drug === 3 ? 0.55 : 1));
  const H = cl(herniaByStage[level] * (drug === 3 ? 0.25 : drug === 1 ? 0.8 : 1));
  const weak = cl(0.18 + 0.62 * stageReflux[level] * refluxMul[drug] + 0.25 * H);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(R, 0.25, 0.6, ["low", "moderate", "high"]), w(I, 0.2, 0.55, ["none", "inflamed", "severe"]), w(B, 0.15, 0.6, ["absent", "present", "extensive"]), w(CA, 0.1, 0.5, ["absent", "at risk", "present"])];
  return { R, A, I, B, ST, CA, D, H, weak, words, readout: "reflux " + words[0] + " · injury " + words[1] + " · Barrett " + words[2] + " · cancer " + words[3] };
}
const TESTS = [
  [1, 0, "reflux moderate · injury severe · Barrett absent · cancer absent"],
  [2, 0, "reflux high · injury inflamed · Barrett extensive · cancer at risk"],
  [2, 2, "reflux high · injury none · Barrett extensive · cancer at risk"],
  [3, 3, "reflux low · injury inflamed · Barrett present · cancer present"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">OESOPHAGUS AND STOMACH</text>
<text class="sc-zone" x="610" y="68">MUCOSA CLOSE-UP</text>
<line class="gerd-div" x1="578" y1="60" x2="578" y2="424"/>
<rect class="gerd-zoom" x="600" y="82" width="322" height="330" rx="14"/>
<g id="hernia"></g>
<g id="stomachSlot"></g>
<g id="anatomy"></g>
<g id="mucosa"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "gerd-barrett-oesophagus", fig: "Fig 1", title: "GERD and Barrett oesophagus: reflux to cancer", W, H, body,
  label: "An animated oesophagus, lower sphincter and stomach beside a close-up of the mucosa. Acid and pepsin rise when the sphincter is weak or relaxes at the wrong time, especially with a hiatus hernia. Repeated injury causes oesophagitis and narrowing, then columnar Barrett mucosa, dysplasia and adenocarcinoma. Gauges show reflux, injury, Barrett change, stricture and cancer. Treatment choices include lifestyle measures, acid suppression and endoscopic or surgical treatment.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "gerd.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With endoscopic or surgical treatment",
  sourcesLis: [
    "<strong>How reflux injures the oesophagus.</strong> The lower oesophageal sphincter is normally closed between swallows. Weakness of the sphincter and transient relaxations at the wrong time let gastric acid and pepsin flow back into the oesophagus, and a hiatus hernia makes this worse by trapping refluxed fluid above the diaphragm and impairing clearance. Repeated mucosal injury causes oesophagitis, ulceration and peptic stricture. This is standard teaching in medicine texts on diseases of the oesophagus and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Barrett oesophagus and cancer.</strong> In some people the injured squamous lining is replaced by columnar metaplasia at the gastro-oesophageal junction: Barrett oesophagus. Barrett mucosa can develop low-grade and then high-grade dysplasia, and then oesophageal adenocarcinoma. Endoscopic surveillance and endoscopic or surgical treatment are teaching toggles in this figure only.",
    "<strong>Treatment ideas shown.</strong> Lifestyle measures that reduce reflux, acid suppression that makes the refluxed fluid less injurious and lets oesophagitis heal, and endoscopic or surgical treatment that can remove or ablate Barrett tissue and tighten the junction. These are teaching toggles only.",
  ],
  simplified: "Swallowing and peristalsis detail, bile reflux, eosinophilic and infectious oesophagitis, detailed endoscopic grading, surveillance intervals, staging and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.gerd-div{fill:none;stroke:var(--anatomy-mid);stroke-width:1;opacity:.45}
.gerd-zoom{fill:color-mix(in srgb,var(--anatomy-paper) 82%,var(--c-endo));stroke:var(--anatomy-mid);stroke-width:1}
.gerd-lumen{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper))}
.gerd-wall{fill:#c9857a;stroke:color-mix(in srgb,#c9857a 55%,#000);stroke-width:1}
body[data-theme="light"] .gerd-wall{fill:#d89a90}
.gerd-muc{fill:#e8b7ab;stroke:color-mix(in srgb,#e8b7ab 55%,#000);stroke-width:.7}
.gerd-acidpool{fill:#e8c832;opacity:.8}
.gerd-les{fill:#a8564a;stroke:color-mix(in srgb,#a8564a 55%,#000);stroke-width:1}
.gerd-diag{fill:#8a7f72;stroke:color-mix(in srgb,#8a7f72 55%,#000);stroke-width:1;opacity:.92}
.gerd-hernia{fill:#d98f7e;stroke:color-mix(in srgb,#d98f7e 55%,#000);stroke-width:1}
.gerd-infl{fill:var(--c-bad)}
.gerd-barr{fill:#e07a4f;stroke:color-mix(in srgb,#e07a4f 55%,#000);stroke-width:.7}
.gerd-strict{fill:#c9857a;stroke:color-mix(in srgb,#c9857a 55%,#000);stroke-width:.8}
.gerd-tum{fill:#7a4a5a;stroke:color-mix(in srgb,#7a4a5a 55%,#000);stroke-width:1}
.gerd-squam{fill:#e8c4b8;stroke:color-mix(in srgb,#e8c4b8 55%,#000);stroke-width:.6}
.gerd-colcell{fill:#e8875f;stroke:color-mix(in srgb,#e8875f 55%,#000);stroke-width:.6}
.gerd-gob{fill:var(--anatomy-paper);stroke:color-mix(in srgb,#e8875f 60%,#000);stroke-width:.6}
.gerd-bm{fill:none;stroke:#8a6a4a;stroke-width:2;stroke-linecap:round}
.gerd-nucleus{fill:#5a3040;opacity:.85}
.gerd-dys{fill:#b85a6a;stroke:color-mix(in srgb,#b85a6a 55%,#000);stroke-width:.7}
.p-acid{fill:#e8c832;stroke:#8a6d10;stroke-width:.6}
.p-pep{fill:#2fb3a6;stroke:#14665e;stroke-width:.6}
.p-weak{fill:#f3e7a8;stroke:#a8933a;stroke-width:.6}
.gerd-pump{fill:var(--anatomy-paper);stroke:#8a6d10;stroke-width:1.4}
.gerd-pumpin{fill:#8a6d10;stroke:none}
.gerd-block{fill:#7c5cd6;stroke:#3d2b7a;stroke-width:.8}
.gerd-wrap{fill:none;stroke:var(--c-good);stroke-width:8}
.gerd-cap{fill:var(--anatomy-strong);font-size:12px}
.dr-g-fill.g-reflux{fill:#e8c832}.dr-g-fill.g-injury{fill:var(--c-bad)}.dr-g-fill.g-barr{fill:#e07a4f}.dr-g-fill.g-strict{fill:#c9857a}.dr-g-fill.g-ca{fill:#7a4a5a}
`,
});
