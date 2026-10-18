/* Lymphatic filariasis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/filaria.mjs [--print-model]
 * Static layout here; mosquito, larvae, worms, lymph flow, microfilariae, eosinophils and gauges move in filaria.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of infection", a: [0, 1, 2], names: ["asymptomatic", "acute", "chronic"], ticks: ["asymptomatic", "acute", "chronic"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "diethylcarbamazine and albendazole" },
    { label: "hygiene and limb care" },
    { label: "surgery" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["none", "diethylcarbamazine and albendazole", "hygiene and limb care", "surgery"],
};
function modelOf(S, level, drug) {
  const baseWorm = [0.55, 0.7, 0.85];
  const baseMicro = [0.85, 0.55, 0.18];
  const baseInflam = [0.08, 0.9, 0.35];
  const baseBlock = [0.15, 0.45, 0.95];
  const baseSwell = [0.05, 0.35, 0.95];
  const baseEos = [0.25, 0.6, 0.8];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const dec = drug === 1 ? 1 : 0, hyg = drug === 2 ? 1 : 0, surg = drug === 3 ? 1 : 0;
  const Worm = cl(baseWorm[level] * (dec ? 0.55 : 1));
  const Micro = cl(baseMicro[level] * (dec ? 0.15 : 1));
  const Inflam = cl(baseInflam[level] - hyg * 0.42 - dec * 0.12);
  const Block = cl(baseBlock[level] - dec * 0.1);
  const Swell = cl(baseSwell[level] - hyg * 0.18 - surg * (level === 2 ? 0.42 : 0.18) - dec * 0.04);
  const Eos = cl(baseEos[level] - dec * 0.22);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Worm, 0.3, 0.65, ["few", "present", "many"]), w(Micro, 0.25, 0.6, ["low", "present", "high"]), w(Block, 0.3, 0.65, ["open", "partial", "blocked"]), w(Swell, 0.25, 0.6, ["none", "mild", "severe"])];
  return { Worm, Micro, Inflam, Block, Swell, Eos, dec, hyg, surg, lev: level, words, readout: "adult worms " + words[0] + " · microfilariae " + words[1] + " · lymph flow " + words[2] + " · swelling " + words[3] };
}
const TESTS = [
  [0, 0, "adult worms present · microfilariae high · lymph flow open · swelling none"],
  [1, 0, "adult worms many · microfilariae present · lymph flow partial · swelling mild"],
  [2, 0, "adult worms many · microfilariae low · lymph flow blocked · swelling severe"],
  [2, 1, "adult worms present · microfilariae low · lymph flow blocked · swelling severe"],
  [2, 3, "adult worms many · microfilariae low · lymph flow blocked · swelling mild"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="inflam" class="fi-inflam" x="180" y="130" width="520" height="100" rx="16" opacity="0"/>
<rect class="fi-skin" x="34" y="140" width="170" height="9" rx="4"/>
<path class="fi-divider" d="M712 60L712 424"/>
<g id="mosq"></g>
<rect id="lymph" class="fi-lymph" x="190" y="155" width="470" height="42" rx="21"/>
<g id="worms">
<path class="fi-worm" d="M250 176C290 162 320 190 360 176C400 162 430 190 470 176"/>
<path class="fi-worm" d="M260 184C300 170 340 196 380 182C420 170 450 192 500 180"/>
<path class="fi-worm fi-worm2" d="M280 168C320 180 360 164 410 176C450 186 480 168 520 178"/>
</g>
<g id="blockg">
<circle class="fi-block" cx="548" cy="168" r="10"/><circle class="fi-block" cx="562" cy="182" r="11"/><circle class="fi-block" cx="536" cy="184" r="8"/><circle class="fi-block" cx="576" cy="170" r="7"/>
</g>
<ellipse id="node" class="fi-node" cx="668" cy="176" rx="27" ry="34"/>
<rect class="fi-waist" x="742" y="94" width="188" height="16" rx="6"/>
<path id="leg" class="fi-leg" d="M758 110L812 110L806 292L828 292L828 310L756 310L756 292L764 292Z"/>
<ellipse id="calf" class="fi-swell" cx="786" cy="238" rx="24" ry="42"/>
<rect class="fi-inset" x="842" y="126" width="88" height="148" rx="12"/>
<ellipse id="hydro" class="fi-hydro" cx="886" cy="198" rx="24" ry="32"/>
<path class="fi-hydrostem" d="M886 126L886 162"/>
<text class="sc-zone" x="742" y="352">LIMB</text>
<rect id="lumen" class="sc-lumen" x="14" y="278" width="680" height="52"/>
<g id="rbcs"></g><g id="micros"></g><g id="eoss"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "lymphatic-filariasis", fig: "Fig 1", title: "Lymphatic filariasis: worms, blocked lymph and swelling", W, H, body,
  label: "An animated lymphatic filariasis scene. A Culex mosquito bite places larvae in the skin. Larvae reach the lymphatics and mature into adult worms. Adults live in the lymph vessel and lymph node, obstruct lymph flow, and release microfilariae that appear in the blood at night. Acute attacks bring inflammation. Chronic obstruction brings lymphoedema, elephantiasis and hydrocele. Eosinophils rise and can be marked in tropical pulmonary eosinophilia. Gauges show adult worms, microfilariae, inflammation, lymph block, swelling and eosinophils. Treatment choices are diethylcarbamazine with albendazole, hygiene and limb care, and surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "filaria.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.fi-skin{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.7}
.fi-divider{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:4 5;opacity:.6}
.fi-lymph{fill:color-mix(in srgb,var(--c-lymph) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 65%,#000);stroke-width:1.2}
.fi-worm{fill:none;stroke:#e8d36a;stroke-width:4;stroke-linecap:round}
.fi-worm2{stroke:#d9a92c}
body[data-theme="light"] .fi-worm{stroke:#b8961e}body[data-theme="light"] .fi-worm2{stroke:#a8841a}
.fi-block{fill:#8a6d3b;stroke:#5c451f;stroke-width:1}
.fi-node{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1.2}
.fi-waist{fill:var(--anatomy-mid)}
.fi-leg{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.fi-swell{fill:color-mix(in srgb,var(--c-endo) 62%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8;opacity:.85}
.fi-inset{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:.8;stroke-dasharray:4 3}
.fi-hydro{fill:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 60%,#000);stroke-width:1}
.fi-hydrostem{stroke:var(--anatomy-mid);stroke-width:2}
.fi-inflam{fill:var(--c-bad)}
.fi-mos{fill:color-mix(in srgb,#8a8f9c 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.fi-wing{fill:var(--anatomy-card);stroke:var(--anatomy-mid);opacity:.75}
.fi-legline{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;stroke-linecap:round}
.fi-prob{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-linecap:round}
.cl-mic{--cc:#c084fc}.p-larv{fill:#e8d36a;stroke:#8a6d1f;stroke-width:.5}
.p-lymph{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 50%,#000);stroke-width:.5}
.p-mic{fill:none;stroke:#c084fc;stroke-width:1.6;stroke-linecap:round}
.dr-g-fill.g-worm{fill:#d9b23a}.dr-g-fill.g-mic{fill:#c084fc}.dr-g-fill.g-swel{fill:var(--c-endo)}
`,
  sourcesLis: [
    "<strong>How lymphatic filariasis develops.</strong> Infective larvae enter through the bite of a mosquito such as Culex and travel to the lymphatics, where they mature into adult worms. Adults live in lymph vessels and nodes and release microfilariae that appear in the blood at night, ready to be taken up by another mosquito. Living and dying worms and the host response injure lymph vessels, dilate them and impair valves, so lymph drains poorly. Early infection is often asymptomatic despite microfilaraemia. Acute attacks bring painful lymph vessel and node inflammation, often with secondary bacterial entry through damaged skin. Longstanding obstruction brings lymphoedema and elephantiasis of a limb and fluid around the testis (hydrocele). In tropical pulmonary eosinophilia the microfilariae are cleared in the lungs, blood microfilariae are absent, and eosinophils and cough or wheeze dominate. This is standard teaching in medicine, parasitology and tropical-medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Diethylcarbamazine with albendazole clears microfilariae and affects adult worms, hygiene and careful limb care reduce acute attacks and help lymphoedema, and surgery can help selected hydrocele or severe swelling. Established lymphatic damage and swelling may persist despite clearing parasites. These are teaching toggles only.",
  ],
  simplified: "The other filarial species and vectors in detail, larval development stages inside the mosquito, Wolbachia and doxycycline, mapping and mass treatment programmes, diagnostic tests and timing of blood samples, grading of lymphoedema, surgical techniques, and all doses and targets are left out. Tropical pulmonary eosinophilia is shown only as a raised eosinophil signal. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
