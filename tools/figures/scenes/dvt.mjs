/* Deep vein thrombosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dvt.mjs [--print-model]
 * Layout and model here; calf vein, clot, swelling, emboli and lung move in dvt.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Clot extent in the calf vein", a: [0.3, 0.65, 1], names: ["short", "long", "extensive"], ticks: ["short", "long", "extensive"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "compression and mobilisation (squeeze and walking)" },
    { label: "anticoagulant (stops the clot growing)" },
    { label: "filter with clot dissolving treatment (catch and dissolve)" },
  ],
  status: "Clot extent: {level} · {drug} ·",
  drugNames: ["no treatment", "compression and mobilisation", "an anticoagulant", "a filter with clot dissolving treatment"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const comp = drug === 1 ? 1 : 0, ac = drug === 2 ? 1 : 0, fl = drug === 3 ? 1 : 0;
  const Ce = cl(a * (ac ? 0.78 : 1) * (fl ? 0.3 : 1) * (comp ? 0.92 : 1));
  const Prop = cl(a * (ac || fl ? 0.12 : 1) * (comp ? 0.6 : 1));
  const Flow = cl(1 - 0.72 * Ce + 0.28 * comp);
  const Swell = cl(Ce * 1.05 * (comp ? 0.42 : 1) * (ac ? 0.85 : 1) * (fl ? 0.55 : 1));
  const Emb = cl(Prop * 0.95);
  const LungBlock = cl(Emb * (fl ? 0.12 : 1));
  const LungFlow = cl(1 - 0.8 * LungBlock);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Ce, 0.35, 0.7, ["short", "long", "extensive"]), w(Swell, 0.3, 0.6, ["little", "moderate", "marked"]), w(LungFlow, 0.35, 0.7, ["blocked", "reduced", "open"])];
  return { a, comp, ac, fl, Ce, Prop, Flow, Swell, Emb, LungBlock, LungFlow, words, readout: "clot " + words[0] + " · swelling " + words[1] + " · lung flow " + words[2] };
}
const TESTS = [
  [2, 0, "clot extensive · swelling marked · lung flow blocked"],
  [1, 0, "clot long · swelling marked · lung flow reduced"],
  [2, 2, "clot extensive · swelling marked · lung flow open"],
  [2, 3, "clot short · swelling little · lung flow open"],
  [2, 1, "clot extensive · swelling moderate · lung flow reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="110" rx="16"/>
<rect class="sc-tissue" x="14" y="162" width="560" height="278" rx="16"/>
<rect class="sc-tissue" x="584" y="162" width="362" height="278" rx="16"/>
<text class="sc-zone" x="34" y="68">WHY A CLOT FORMS: VIRCHOW TRIAD</text>
<text class="sc-zone" x="34" y="186">CALF VEIN</text>
<text class="sc-zone" x="604" y="186">LUNG</text>
<g id="triad"></g>
<path class="dvt-tri" id="tri1" d="M180 132L210 268"/>
<path class="dvt-tri" id="tri2" d="M480 132L300 268"/>
<path class="dvt-tri" id="tri3" d="M780 132L390 268"/>
<rect id="lumen" class="sc-lumen" x="44" y="272" width="540" height="56" rx="28"/>
<rect id="lumen2" class="sc-lumen" x="584" y="272" width="362" height="56" rx="28"/>
<path class="dvt-branch" d="M750 272L750 248M860 272L860 248"/>
<g id="leg"></g><g id="lung"></g><g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "deep-vein-thrombosis", fig: "Fig 1", title: "Deep vein thrombosis: calf clot to lung embolus", W, H, body,
  label: "An animated calf vein and lung. Three influences from the Virchow triad, slow flow, vessel wall injury and blood that clots readily, let a clot start around a vein valve. The clot grows along the vein, blocks flow and swells the calf, and pieces can break off, travel to the lung and block lung flow. Gauges show clot, vein flow, swelling, growth, embolus risk and lung flow. Treatment choices are compression with mobilisation, an anticoagulant, and a filter with clot dissolving treatment.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, times or numbers are shown or implied.",
  scene: { W, H, travel: [[400, 300], [540, 300], [575, 300], [640, 300], [700, 300]] }, pageJs: readFileSync(join(HERE, "dvt.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How deep vein thrombosis develops.</strong> The Virchow triad groups the influences that favour a venous clot: slow or stagnant blood flow (stasis, for example during immobility), injury to the vein wall lining (endothelial injury), and blood that clots more readily (hypercoagulability). A clot often starts in the pocket around a calf vein valve, where flow is slowest. Platelets and fibrin build it up and it propagates along the vein toward the heart. The blocked vein raises pressure behind the clot, so fluid leaves the vessels and the calf swells and aches. A piece that breaks off is an embolus: it travels with venous blood to the lung and can block lung flow as a pulmonary embolism. This is standard teaching in medicine, haematology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Compression and mobilisation squeeze the calf and speed venous flow, which eases swelling and stasis. An anticoagulant stops the clot growing and stops new clots forming while the body clears it. A filter placed in the large vein to the heart catches travelling pieces, and a clot dissolving treatment breaks clot up; both are reserved for selected situations. These are teaching toggles only.",
  ],
  simplified: "Risk factor detail, inherited and acquired clotting disorders, diagnosis by scan and blood tests, clot above the knee versus in the calf, post thrombotic syndrome, bleeding risk, filter placement detail, surgery, prevention in hospital, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.dvt-tri{fill:none;stroke:var(--anatomy-mid);stroke-width:1.3;stroke-dasharray:4 4;opacity:.5}
.dvt-tribox{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.dvt-trit{fill:var(--anatomy-strong);font:700 11px var(--anatomy-mono);pointer-events:none}
.dvt-tris{fill:var(--anatomy-text);font:9.5px var(--anatomy-mono);pointer-events:none}
.dvt-valve{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.dvt-branch{fill:none;stroke:var(--c-fl);stroke-width:8;stroke-linecap:round;opacity:.55}
.dvt-sac{fill:color-mix(in srgb,var(--c-lymph) 22%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.6}
.dvt-ds{fill:color-mix(in srgb,#9aa3ad 55%,var(--anatomy-paper));stroke:#9aa3ad;stroke-width:1.2}
.dvt-calf{fill:none;stroke:var(--c-endo);stroke-width:2;stroke-linecap:round}
.dvt-stock{fill:color-mix(in srgb,var(--c-good) 18%,transparent);stroke:var(--c-good);stroke-width:1.4;stroke-dasharray:5 4}
.dvt-shield{fill:var(--anatomy-paper);stroke:var(--c-good);stroke-width:1.8}
.dvt-tick{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.dvt-filter{fill:none;stroke:var(--anatomy-strong);stroke-width:1.5;stroke-linecap:round}
.dvt-spark{fill:none;stroke:#ffd24a;stroke-width:1.4;stroke-linecap:round}
.p-emb2{--cc:#8f2a3a}
.dr-g-fill.g-swell{fill:var(--c-endo)}
`,
});
