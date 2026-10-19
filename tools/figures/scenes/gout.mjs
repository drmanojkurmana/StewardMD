/* Gout as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gout.mjs [--print-model]
 * Static layout here; particles, crystals, cells and gauges move in gout.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of gout", a: [0.6, 0.85, 1], names: ["hyperuricaemia", "acute attack", "chronic tophaceous"], ticks: ["hyperuricaemia", "acute attack", "chronic tophaceous"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "NSAID or colchicine for an attack" },
    { label: "uricosuric" },
    { label: "xanthine oxidase inhibitor" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "NSAID or colchicine", "uricosuric", "xanthine oxidase inhibitor"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const lvlU = [0.6, 0.85, 1][level], lvlC = [0.1, 0.7, 1][level], lvlI = [0.04, 0.95, 0.5][level], lvlT = [0, 0.12, 0.95][level];
  const atk = drug === 1 ? 1 : 0, uri = drug === 2 ? 1 : 0, xoi = drug === 3 ? 1 : 0;
  const U = cl(lvlU * (xoi ? 0.38 : 1) * (uri ? 0.55 : 1));
  const C = cl(lvlC * (xoi ? 0.55 : 1) * (uri ? 0.6 : 1));
  const I = cl(lvlI * (atk ? 0.22 : 1) * (xoi || uri ? 0.85 : 1));
  const T = cl(lvlT * (xoi ? 0.6 : 1) * (uri ? 0.7 : 1));
  const P = cl(0.04 + 0.92 * I);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(U, 0.35, 0.65, ["low", "raised", "high"]), w(C, 0.25, 0.6, ["few", "some", "many"]), w(I, 0.25, 0.6, ["calm", "active", "severe"])];
  return { atk, xoi, uri, U, C, I, T, P, words, readout: "urate " + words[0] + " · crystals " + words[1] + " · joint inflammation " + words[2] };
}
const TESTS = [
  [0, 0, "urate raised · crystals few · joint inflammation calm"],
  [1, 0, "urate high · crystals many · joint inflammation severe"],
  [1, 1, "urate high · crystals many · joint inflammation calm"],
  [2, 3, "urate raised · crystals some · joint inflammation active"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">PURINE BREAKDOWN TO URIC ACID</text>
<text class="sc-zone" x="34" y="282">JOINT</text>
<g id="flowg"></g>
<g id="kidneySlot"></g>
<rect class="gt-pool" x="335" y="128" width="250" height="74" rx="37"/>
<g id="nodes"></g>
<g id="jointg"></g>
<ellipse id="jointGlow" class="gt-glow" cx="585" cy="345" rx="335" ry="60" opacity="0"/>
<g id="crystals"></g>
<g id="tophi"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="marks"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "gout-urate", fig: "Fig 1", title: "Gout: urate crystals and joint inflammation", W, H, body,
  label: "An animated diagram of gout. Purines are broken down through xanthine oxidase to uric acid, which is carried in blood and cleared by the kidney. When urate stays high it forms needle crystals in a joint. Macrophages sense the crystals and release IL-1, calling in neutrophils and causing an acute attack. Long-standing deposits form tophi. A stage slider moves from hyperuricaemia to an acute attack to chronic tophaceous gout, and treatments act on inflammation, production or excretion.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "gout.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With xanthine oxidase inhibitor",
  sourcesLis: [
    "<strong>How gout develops.</strong> Purines from the diet and from cell turnover are broken down to uric acid, with xanthine oxidase catalysing the final steps. Humans lack uricase, so uric acid is the end product. Blood urate rises when production is increased (overproduction) or, more commonly, when the kidney excretes too little (underexcretion). Sustained hyperuricaemia lets monosodium urate form needle-like crystals in and around joints. Resident macrophages sense the crystals, activate the inflammasome and release IL-1, which recruits neutrophils and drives the hot, painful acute attack. Over years, crystal deposits with surrounding tissue form tophi in chronic tophaceous gout. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An NSAID or colchicine calms the inflammation of an attack without lowering urate. A xanthine oxidase inhibitor lowers urate by reducing production. A uricosuric lowers urate by increasing kidney excretion. These are teaching toggles only.",
  ],
  simplified: "Genetic and drug causes of underexcretion, gut excretion of urate, crystal coating proteins, resolution pathways, kidney stones and urate kidney injury, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.gt-pool{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 35%,var(--anatomy-mid));stroke-width:1}
.gt-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.gt-arrow-d{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 5;stroke-linecap:round}
.gt-head{fill:var(--anatomy-mid)}
.gt-ves{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;opacity:.85}
.gt-urine{fill:none;stroke:var(--c-fl);stroke-width:4;stroke-linecap:round}
.gt-flush{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-linecap:round}
.gt-level{fill:color-mix(in srgb,#e9c84a 55%,transparent);stroke:none}
.gt-glow{fill:var(--c-bad);stroke:none}
.gt-drug{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1}
.gt-shield{fill:color-mix(in srgb,var(--c-good) 35%,transparent);stroke:var(--c-good);stroke-width:2}
.gt-cap{fill:var(--anatomy-strong);font-size:12.5px}
.gt-bone{fill:color-mix(in srgb,#e8dcc0 42%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.gt-cav{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.gt-cry{stroke:#e9c84a;stroke-width:2.6;stroke-linecap:round}
.gt-cry2{stroke:#f4e3a0;stroke-width:1.4;stroke-linecap:round}
.gt-top{fill:color-mix(in srgb,#e9c84a 38%,var(--anatomy-paper));stroke:#b8962f;stroke-width:1}
.cl-pur{--cc:#8fd07a}.cl-xan{--cc:#e8b45a}
.p-ur{--cc:#e9c84a}.p-il1{--cc:var(--c-cyt)}.p-exc{--cc:var(--c-fl)}
.dr-g-fill.g-ur{fill:#e9c84a}.dr-g-fill.g-cry{fill:#d9a92c}.dr-g-fill.g-top{fill:#b8962f}
`,
});
