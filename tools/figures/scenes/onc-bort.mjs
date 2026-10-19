/* Bortezomib mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-bort.mjs [--print-model]
 * Static layout here; myeloma cell, proteasome, organs and gauges move in onc-bort.page.js. Qualitative: no doses, no numbers. */
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
    { label: "bortezomib" },
    { label: "bortezomib with aciclovir cover" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "bortezomib", "bortezomib with aciclovir"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], on = drug > 0 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Kill = on ? cl(0.15 + 0.85 * a) : 0;
  const Pile = on ? cl(0.2 + 0.8 * a) : 0.04;
  const Neur = on ? cl(a * a * 1.25) : 0;
  const Plat = on ? cl(0.15 + 0.75 * a) : 0;
  const Zos = on ? cl(0.2 + 0.7 * a) * (prot ? 0.15 : 1) : 0;
  const Bow = on ? cl(0.3 + 0.5 * a) : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Kill, 0.3, 0.65, ["growing", "injured", "dying"]), w(Neur, 0.3, 0.6, ["calm", "tingling", "painful"]), w(Zos, 0.45, 0.7, ["quiet", "stirring", "breaking out"])];
  return { a, on, prot, Kill, Pile, Neur, Plat, Zos, Bow, words, readout: "tumour " + words[0] + " · nerves " + words[1] + " · shingles " + words[2] };
}
const TESTS = [
  [3, 0, "tumour growing · nerves calm · shingles quiet"],
  [3, 1, "tumour dying · nerves painful · shingles breaking out"],
  [3, 2, "tumour dying · nerves painful · shingles quiet"],
  [0, 1, "tumour injured · nerves calm · shingles quiet"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">MYELOMA CELL</text>
<text class="sc-zone" x="604" y="68">ORGANS AT RISK</text>
<g id="cellSlot"></g><g id="protG"></g><g id="pileG"></g>
<g id="nerveSlot"></g><g id="skinSlot"></g><g id="bowelSlot"></g><g id="marSlot"></g>
<g id="parts"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "bortezomib-mechanism-adverse-effects", fig: "Fig 1", title: "Bortezomib: proteasome block, myeloma death and nerve harm", W, H, body,
  label: "An animated myeloma cell and the organs at risk. Bortezomib docks on the beta-5 site of the 26S proteasome and blocks it, so misfolded proteins pile up, the unfolded protein response fires and NF-kB stays blocked, driving the cell to apoptosis. Small nerve fibres are injured so feet burn and pressure can fall, platelets fall, shingles reactivates unless aciclovir cover is given, and the bowel churns. Gauges show tumour kill, neuropathy, low platelets, shingles and bowel upset. Treatment choices include bortezomib alone and bortezomib with aciclovir cover.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-bort.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without bortezomib", withLabel: "With bortezomib plus aciclovir cover",
  sourcesLis: [
    "<strong>How bortezomib kills myeloma cells.</strong> Bortezomib reversibly blocks the beta-5 chymotrypsin-like site of the 26S proteasome, the machine that shreds worn out proteins. In myeloma plasma cells, which make huge amounts of antibody protein, misfolded proteins pile up, the unfolded protein response switches on, and IkB is not degraded so NF-kB stays blocked and the cell dies by apoptosis. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why nerves, platelets, skin and bowel suffer.</strong> Small sensory and autonomic nerve fibres are injured so feet tingle and burn and blood pressure can fall on standing; platelet counts fall in a cyclic pattern with bleeding risk; latent varicella zoster virus reactivates so shingles breaks out unless aciclovir cover is given; and the gut is disturbed so diarrhoea and constipation alternate. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Aciclovir cover to hold shingles back while bortezomib keeps killing the tumour. These are teaching toggles only.",
  ],
  simplified: "Carfilzomib and ixazomib, mantle cell lymphoma use, neutropenia and anaemia, heart failure and lung injury, tumour lysis, dose holds and schedule changes for neuropathy, platelet transfusion rules, blood pressure care, eye and liver effects, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-my{--cc:var(--c-lymph)}
.cl-myn{--cc:var(--c-th2)}
.bt-dead{fill:#1a1030}
.bt-core{fill:color-mix(in srgb,var(--c-plt) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.bt-cap{fill:color-mix(in srgb,var(--c-eos) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1}
.bt-beta{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.bt-dock{fill:var(--c-bad);stroke:#fff;stroke-width:.6}
.bt-pile{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 50%,#000);stroke-width:.5}
.bt-ikb{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:.8}
.bt-nfk{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.8}
.bt-bleb{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.9}
.bt-spark{fill:#ffd23f;stroke:#c22e1f;stroke-width:1}
.bt-axon{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 4}
.bt-ves{fill:#f5e6b8;stroke:#c22e1f;stroke-width:1}
.bt-rash{fill:var(--c-bad)}
.bt-spasm{fill:none;stroke:var(--c-bad);stroke-width:2}
.bt-bone{fill:color-mix(in srgb,#e8e0d0 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.bt-cav{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper))}
.bt-mcell{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.5}
.bt-capline{fill:var(--anatomy-strong);font-size:13px}
.p-bort{--cc:var(--c-bad)}
.p-mis{--cc:var(--c-cyt)}
.p-vir{--cc:var(--c-eos)}
.p-aci{--cc:var(--c-good)}
.p-churn{--cc:var(--c-eos)}
`,
});
