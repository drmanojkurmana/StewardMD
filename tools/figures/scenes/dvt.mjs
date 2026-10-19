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
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<ellipse id="halo" class="dvt-halo" cx="250" cy="265" rx="120" ry="145"/>
<g id="veinSlot"></g>
<path id="route" class="dvt-route" d="M250 112 L732 254"/>
<g id="lungSlot"></g>
<g id="clot"></g><g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "deep-vein-thrombosis", fig: "Fig 1", title: "Deep vein thrombosis: calf clot to lung embolus", W, H, body,
  label: "An animated calf vein and lung. A clot starts around a vein valve and its tail grows up toward the heart. The blocked vein slows flow and swells the calf, and pieces can break off, travel to the lung and block lung flow. Gauges show clot, vein flow, swelling, growth, embolus risk and lung flow. Treatment choices are compression with mobilisation, an anticoagulant, and a filter with clot dissolving treatment.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, times or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "dvt.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With filter and clot dissolving treatment",
  sourcesLis: [
    "<strong>How deep vein thrombosis develops.</strong> The Virchow triad groups the influences that favour a venous clot: slow or stagnant blood flow (stasis, for example during immobility), injury to the vein wall lining (endothelial injury), and blood that clots more readily (hypercoagulability). A clot often starts in the pocket around a calf vein valve, where flow is slowest. Platelets and fibrin build it up and it propagates along the vein toward the heart. The blocked vein raises pressure behind the clot, so fluid leaves the vessels and the calf swells and aches. A piece that breaks off is an embolus: it travels with venous blood to the lung and can block lung flow as a pulmonary embolism. This is standard teaching in medicine, haematology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Compression and mobilisation squeeze the calf and speed venous flow, which eases swelling and stasis. An anticoagulant stops the clot growing and stops new clots forming while the body clears it. A filter placed in the large vein to the heart catches travelling pieces, and a clot dissolving treatment breaks clot up; both are reserved for selected situations. These are teaching toggles only.",
  ],
  simplified: "Risk factor detail, inherited and acquired clotting disorders, diagnosis by scan and blood tests, clot above the knee versus in the calf, post thrombotic syndrome, bleeding risk, filter placement detail, surgery, prevention in hospital, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.dvt-halo{fill:var(--c-fl);stroke:none}
.dvt-route{fill:none;stroke:var(--anatomy-mid);stroke-width:1.3;stroke-dasharray:5 5;opacity:.45}
.dvt-valve{fill:none;stroke:var(--anatomy-strong);stroke-width:1.8;stroke-linecap:round}
.dvt-stock{fill:color-mix(in srgb,var(--c-good) 20%,transparent);stroke:var(--c-good);stroke-width:1.6;stroke-dasharray:6 4}
.dvt-arrow{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-linecap:round}
.dvt-shield{fill:var(--anatomy-paper);stroke:var(--c-good);stroke-width:1.8}
.dvt-tick{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.dvt-wash{fill:color-mix(in srgb,var(--c-good) 22%,transparent);stroke:none}
.dvt-chev{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.dvt-filter{fill:none;stroke:var(--anatomy-strong);stroke-width:1.8;stroke-linecap:round}
.dvt-spark{fill:none;stroke:#ffd24a;stroke-width:1.4;stroke-linecap:round}
.dvt-block{fill:color-mix(in srgb,#9aa3ad 55%,var(--anatomy-paper));stroke:#9aa3ad;stroke-width:1.2}
.dvt-cap{fill:var(--anatomy-strong);font-size:12px}
.p-emb2{--cc:#8f2a3a}
.dr-g-fill.g-swell{fill:var(--c-endo)}
`,
});
