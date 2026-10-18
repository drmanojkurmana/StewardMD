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
    { label: "hygiene and limb care" },
    { label: "surgery" },
    { label: "diethylcarbamazine and albendazole" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["none", "hygiene and limb care", "surgery", "diethylcarbamazine and albendazole"],
};
function modelOf(S, level, drug) {
  const baseWorm = [0.55, 0.7, 0.85];
  const baseMicro = [0.85, 0.55, 0.18];
  const baseInflam = [0.08, 0.9, 0.35];
  const baseBlock = [0.15, 0.45, 0.95];
  const baseSwell = [0.05, 0.35, 0.95];
  const baseEos = [0.25, 0.6, 0.8];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const hyg = drug === 1 ? 1 : 0, surg = drug === 2 ? 1 : 0, dec = drug === 3 ? 1 : 0;
  const Worm = cl(baseWorm[level] * (dec ? 0.5 : 1));
  const Micro = cl(baseMicro[level] * (dec ? 0.15 : 1));
  const Inflam = cl(baseInflam[level] - hyg * 0.45 - dec * 0.12);
  const Block = cl(baseBlock[level] - dec * 0.12);
  const Swell = cl(baseSwell[level] - hyg * 0.15 - surg * (level === 2 ? 0.42 : 0.15) - dec * 0.05);
  const Eos = cl(baseEos[level] - dec * 0.25);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Worm, 0.3, 0.65, ["few", "present", "many"]), w(Micro, 0.25, 0.6, ["low", "present", "high"]), w(Block, 0.3, 0.65, ["open", "partial", "blocked"]), w(Swell, 0.25, 0.6, ["none", "mild", "severe"])];
  return { Worm, Micro, Inflam, Block, Swell, Eos, dec, hyg, surg, lev: level, words, readout: "adult worms " + words[0] + " · microfilariae " + words[1] + " · lymph flow " + words[2] + " · swelling " + words[3] };
}
const TESTS = [
  [0, 0, "adult worms present · microfilariae high · lymph flow open · swelling none"],
  [1, 0, "adult worms many · microfilariae present · lymph flow partial · swelling mild"],
  [2, 0, "adult worms many · microfilariae low · lymph flow blocked · swelling severe"],
  [2, 3, "adult worms present · microfilariae low · lymph flow blocked · swelling severe"],
  [2, 2, "adult worms many · microfilariae low · lymph flow blocked · swelling mild"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="inflam" class="fi-inflam" x="188" y="116" width="452" height="120" rx="16" opacity="0"/>
<path class="fi-divider" d="M724 60L724 424"/>
<g id="mosq"></g>
<path id="lymphTube" class="fi-lymph" d="M178 192 L586 176"/>
<g id="worms">
<path class="fi-worm" d="M242 170C300 158 350 184 410 170C450 161 505 182 543 170"/>
<path class="fi-worm fi-worm2" d="M248 182C308 172 358 192 415 181C455 174 505 190 538 181"/>
<path class="fi-worm" d="M258 164C315 174 365 160 425 171C465 178 505 164 532 172"/>
<path class="fi-worm fi-worm2" d="M245 176C295 168 345 186 395 176C445 168 495 184 530 176"/>
<path class="fi-worm" d="M265 188C320 180 370 194 420 186C460 180 500 192 528 186"/>
<path class="fi-worm fi-worm2" d="M252 158C310 166 360 154 420 163C460 169 500 158 528 164"/>
</g>
<g id="blockg">
<circle class="fi-block" cx="556" cy="168" r="10"/><circle class="fi-block" cx="570" cy="182" r="11"/><circle class="fi-block" cx="544" cy="184" r="8"/><circle class="fi-block" cx="582" cy="170" r="7"/>
<circle class="fi-block" cx="563" cy="176" r="13"/>
</g>
<circle id="scar" class="fi-scar" cx="563" cy="177" r="17" opacity="0"/>
<path id="drainPath" class="fi-drainpath" d="M706 196C738 216 734 236 754 246" opacity="0"/>
<g id="skinSlot"></g>
<g id="nodeSlot"></g>
<g id="legSlot"></g>
<ellipse id="swell" class="fi-swell" cx="830" cy="262" rx="30" ry="26"/>
<ellipse id="hydro" class="fi-hydro" cx="884" cy="172" rx="14" ry="18"/>
<path class="fi-hydrostem" d="M884 114L884 160"/>
<rect id="lumen" class="sc-lumen" x="14" y="278" width="680" height="52"/>
<g id="rbcs"></g><g id="micros"></g><g id="eoss"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "lymphatic-filariasis", fig: "Fig 1", title: "Lymphatic filariasis: worms, blocked lymph and swelling", W, H, body,
  label: "An animated lymphatic filariasis scene. A mosquito bite places larvae in the skin. Larvae reach the lymph vessel and mature into adult worms. Adults live coiled in the vessel and the lymph node, block lymph flow, and release microfilariae that appear in the blood at night. Acute attacks bring inflammation. Chronic obstruction brings leg swelling and hydrocele. Treatment choices are hygiene and limb care, surgery, and diethylcarbamazine with albendazole.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "filaria.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With diethylcarbamazine and albendazole",
  extraCss: `
.fi-divider{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:4 5;opacity:.6}
.fi-lymph{fill:none;stroke:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke-width:46;stroke-linecap:round;opacity:.9}
.fi-worm{fill:none;stroke:#e8d36a;stroke-width:6;stroke-linecap:round}
.fi-worm2{stroke:#d9a92c}
body[data-theme="light"] .fi-worm{stroke:#b8961e}body[data-theme="light"] .fi-worm2{stroke:#a8841a}
#worms.fi-dead .fi-worm,#worms.fi-dead .fi-worm2{stroke:#8f8f7d}
.fi-block{fill:#8a6d3b;stroke:#5c451f;stroke-width:1}
.fi-scar{fill:none;stroke:color-mix(in srgb,var(--anatomy-mid) 70%,var(--anatomy-paper));stroke-width:2;stroke-dasharray:5 4}
.fi-drainpath{fill:none;stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:5;stroke-linecap:round;stroke-dasharray:7 7}
.fi-swell{fill:color-mix(in srgb,var(--c-endo) 62%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8;opacity:.85}
.fi-hydro{fill:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 60%,#000);stroke-width:1}
.fi-hydrostem{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.fi-drug{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}.fi-drug2{fill:var(--c-bad);opacity:.7}
.fi-inflam{fill:var(--c-bad)}
.fi-mos{fill:color-mix(in srgb,#8a8f9c 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.fi-wing{fill:var(--anatomy-card);stroke:var(--anatomy-mid);opacity:.75}
.fi-legline{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;stroke-linecap:round}
.fi-prob{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-linecap:round}
.fi-cap{fill:var(--anatomy-strong)}
.cl-mic{--cc:#c084fc}.p-larv{fill:#e8d36a;stroke:#8a6d1f;stroke-width:.5}
.p-lymph{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 50%,#000);stroke-width:.5}
.p-mic{fill:none;stroke:#c084fc;stroke-width:1.6;stroke-linecap:round}
.p-bound{fill:#8ef4d2;stroke:#0b6e4f;stroke-width:.8}
.p-drain{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 50%,#000);stroke-width:.5}
.p-care{fill:#ffd166;stroke:#8a6d1f;stroke-width:.5}
.dr-g-fill.g-worm{fill:#d9b23a}.dr-g-fill.g-mic{fill:#c084fc}.dr-g-fill.g-swel{fill:var(--c-endo)}
`,
  sourcesLis: [
    "<strong>How lymphatic filariasis develops.</strong> Infective larvae enter through the bite of a mosquito and travel to the lymphatics, where they mature into adult worms. Adults live in lymph vessels and nodes and release microfilariae that appear in the blood at night, ready to be taken up by another mosquito. Living and dying worms and the host response injure lymph vessels, dilate them and impair valves, so lymph drains poorly. Early infection is often asymptomatic despite microfilaraemia. Acute attacks bring painful lymph vessel and node inflammation, often with secondary bacterial entry through damaged skin. Longstanding obstruction brings lymphoedema and elephantiasis of a limb and fluid around the testis (hydrocele). This is standard teaching in medicine, parasitology and tropical-medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Diethylcarbamazine with albendazole kills worms and clears microfilariae, hygiene and careful limb care reduce acute attacks and help lymphoedema, and surgery can help selected hydrocele or severe swelling. Established lymphatic damage and swelling may persist despite clearing parasites. These are teaching toggles only.",
  ],
  simplified: "The other filarial species and vectors in detail, larval development stages inside the mosquito, Wolbachia and doxycycline, mapping and mass treatment programmes, diagnostic tests and timing of blood samples, grading of lymphoedema, surgical techniques, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
