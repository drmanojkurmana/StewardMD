/* Osimertinib mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-osi.mjs [--print-model]
 * Static layout here; EGFR, C797, organs and gauges move in onc-osi.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.25, 0.5, 0.75, 1], names: ["early", "middle", "late", "cumulative"], ticks: ["early", "middle", "late", "cumulative"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "osimertinib" },
    { label: "osimertinib with heart and lung checks" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "osimertinib", "osimertinib with checks"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Kill = on ? cl(0.25 + 0.75 * a) : 0;
  const Rash = on ? cl(0.55 * (1 - 0.5 * a)) : 0;
  const Bowel = on ? cl(0.5 * (1 - 0.45 * a)) : 0;
  const Lung = on ? cl(a * a * 1.1 * (prot ? 0.35 : 1)) : 0;
  const Heart = on ? cl((0.1 + 0.6 * a) * (prot ? 0.5 : 1)) : 0;
  const Nail = on ? cl(0.1 + 0.5 * a) : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Kill, 0.35, 0.7, ["growing", "shrinking", "controlled"]), w(Rash, 0.25, 0.5, ["clear", "mild rash", "rash"]), w(Lung, 0.25, 0.6, ["clear", "strained", "inflamed"])];
  return { a, on, prot, Kill, Rash, Bowel, Lung, Heart, Nail, words, readout: "tumour " + words[0] + " · skin " + words[1] + " · lungs " + words[2] };
}
const TESTS = [
  [3, 0, "tumour growing · skin clear · lungs clear"],
  [3, 1, "tumour controlled · skin mild rash · lungs inflamed"],
  [3, 2, "tumour controlled · skin mild rash · lungs strained"],
  [0, 1, "tumour shrinking · skin mild rash · lungs clear"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="604" y="68">ORGANS AT RISK</text>
<g id="cellSlot"></g><g id="egfr"></g><g id="wtSlot"></g>
<g id="skinSlot"></g><g id="bowelSlot"></g><g id="lungSlot"></g><g id="heartSlot"></g><g id="nailSlot"></g>
<g id="parts"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "osimertinib-mechanism-adverse-effects", fig: "Fig 1", title: "Osimertinib: locking mutant EGFR, lung and heart harm", W, H, body,
  label: "An animated lung cancer cell and the organs at risk. Mutant EGFR fires growth signals until osimertinib bonds to cysteine 797 and locks it shut; ATP bounces off, signalling stops and the cell dies. A healthy cell with normal EGFR keeps working because the drug spares it. Skin rashes, the bowel loosens, rarely the lungs scar and the heart slows and weakens, and nail folds inflame. Gauges show tumour kill, rash, diarrhoea, lung injury and heart risk. Treatment choices include osimertinib alone and osimertinib with heart and lung checks.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-osi.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without osimertinib", withLabel: "With osimertinib plus checks",
  sourcesLis: [
    "<strong>How osimertinib stops the tumour.</strong> Osimertinib bonds irreversibly to cysteine 797 in the ATP pocket of mutant EGFR, blocking sensitising mutations and T790M while largely sparing healthy EGFR, so growth signalling stops and lung cancer cells die. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Skin and gut need EGFR, so blocking it causes rash and diarrhoea, milder than older drugs because healthy EGFR is spared; rarely the lungs scar, the QT interval lengthens and heart muscle weakens, and nail folds inflame. Heart and lung checks catch the rare harms early. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Regular heart and lung checks with early dose hold and steroids for lung injury. These are teaching toggles only.",
  ],
  simplified: "Brands and combination regimens, first and second generation EGFR drugs, C797S and other resistance changes, eye and mouth effects, stopping rules, pregnancy advice, drug interactions, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-tum{--cc:var(--c-sm)}
.cl-health{--cc:var(--c-endo)}
.osi-dead{fill:#1a1030}
.osi-arm{fill:none;stroke:var(--c-th2);stroke-width:3;stroke-linecap:round}
.osi-knob{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:.8}
.osi-tm{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:.8}
.osi-lobe{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:1}
.osi-lobe2{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:1}
.osi-pocket{fill:#2b1b3d}
.osi-wedge{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 50%,#000);stroke-width:1}
.osi-cys{fill:#ffd94a;stroke:#7a5c00;stroke-width:1}
.osi-bond{fill:none;stroke:#ffd94a;stroke-width:2}
.osi-flash{fill:#ffd94a;stroke:#c22e1f;stroke-width:1}
.osi-tag{fill:var(--anatomy-strong);font-size:10.5px;pointer-events:none}
.p-egf{--cc:var(--c-neut)}
.p-osisig{--cc:var(--c-cyt)}
.p-atp{--cc:#ffd94a}
.p-gut{--cc:var(--c-fl)}
.osi-rash{fill:var(--c-bad)}
.osi-haze{fill:#8f979e}
.osi-crack{fill:var(--c-cyt)}
.osi-hrtwash{fill:var(--c-bad)}
.osi-finger{fill:color-mix(in srgb,#d9a58c 78%,var(--anatomy-paper));stroke:color-mix(in srgb,#d9a58c 55%,#000);stroke-width:1}
.osi-nail{fill:color-mix(in srgb,#f2e4d8 80%,var(--anatomy-paper));stroke:color-mix(in srgb,#c9a88f 60%,#000);stroke-width:1}
.osi-fold{fill:var(--c-bad)}
.osi-capline{fill:var(--anatomy-strong);font-size:13px}
`,
});
