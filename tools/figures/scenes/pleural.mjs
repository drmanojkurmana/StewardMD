/* Pleural effusion as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pleural.mjs [--print-model]
 * Static layout here; fluid, lung, droplets and gauges move in pleural.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Size of the effusion", a: [0.3, 0.65, 1], names: ["small", "moderate", "large"], ticks: ["small", "moderate", "large"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "treat the cause" },
    { label: "drainage (thoracentesis or drain)" },
    { label: "pleurodesis (seal the pleural space)" },
  ],
  status: "Effusion: {level} · {drug} ·",
  drugNames: ["no treatment", "treat the cause", "drainage", "pleurodesis"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const treat = drug === 1 ? 1 : 0, drain = drug === 2 ? 1 : 0, pleuro = drug === 3 ? 1 : 0;
  const Form = cl(a * (treat ? 0.28 : pleuro ? 0.35 : 1));
  const V = cl(a * (treat ? 0.38 : drain ? 0.15 : pleuro ? 0.1 : 1));
  const Cmp = cl(1.05 * V - 0.15);
  const Prot = cl(0.25 + 0.55 * a * (treat ? 0.35 : 1));
  const Leak = cl(0.2 + 0.65 * a * (treat ? 0.3 : 1));
  const Recur = cl(Form * (pleuro ? 0.12 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const ew = V < 0.12 ? "gone" : V < 0.35 ? "small" : V < 0.7 ? "moderate" : "large";
  const words = [ew, w(Cmp, 0.3, 0.65, ["expanded", "partly compressed", "compressed"]), w(Cmp, 0.3, 0.65, ["comfortable", "breathless", "very breathless"])];
  return { a, treat, drain, pleuro, Form, V, Cmp, Prot, Leak, Recur, words, readout: "effusion " + words[0] + " · lung " + words[1] + " · breathing " + words[2] };
}
const TESTS = [
  [2, 0, "effusion large · lung compressed · breathing very breathless"],
  [2, 1, "effusion moderate · lung expanded · breathing comfortable"],
  [2, 2, "effusion small · lung expanded · breathing comfortable"],
  [0, 3, "effusion gone · lung expanded · breathing comfortable"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CHEST SECTION</text>
<text class="sc-zone" x="545" y="68">PLEURAL MEMBRANE, CLOSE UP</text>
<rect class="pl-wall" x="80" y="100" width="440" height="325" rx="30"/>
<clipPath id="plclip"><rect x="95" y="115" width="410" height="300" rx="20"/></clipPath>
<g clip-path="url(#plclip)"><rect class="pl-cavity" x="95" y="115" width="410" height="300"/><path id="fluidPath" class="pl-fluid" d="M95 400Q300 390 505 400L505 415L95 415Z"/><g id="fparts"></g></g>
<rect class="pl-parietal" x="95" y="115" width="410" height="300" rx="20"/>
<path class="pl-diaph" d="M95 415Q300 385 505 415"/>
<g id="lungSlot"></g>
<g id="drainG" opacity="0"><path class="pl-needle" d="M548 296L438 400"/><path class="pl-needle2" d="M548 296L438 400"/></g>
<path id="sealPath" class="pl-seal" d="M110 130Q300 112 490 130Q508 270 490 400Q300 418 110 400Q92 270 110 130Z" opacity="0"/>
<g id="adhG" opacity="0"></g>
<rect class="pl-detail" x="545" y="100" width="370" height="315" rx="16"/>
<rect class="pl-cap" x="575" y="170" width="310" height="36" rx="18"/>
<g id="endo2"></g>
<path id="pushArrow" class="pl-arrowH" d="M760 216L760 252M752 242L760 254L768 242"/>
<path class="pl-arrowO" d="M650 254L650 218M642 228L650 216L658 228"/>
<path id="membPath" class="pl-memb" d="M575 270H690M706 270H800M816 270H885"/>
<g id="talcG" opacity="0"></g>
<g clip-path="url(#plclip2)"><rect class="pl-mini" x="575" y="270" width="310" height="145"/><path id="miniFluid" class="pl-fluid" d="M575 400Q730 392 885 400L885 415L575 415Z"/></g>
<clipPath id="plclip2"><rect x="575" y="270" width="310" height="145"/></clipPath>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "pleural-effusion", fig: "Fig 1", title: "Pleural effusion: fluid in the pleural space", W, H, body,
  label: "An animated chest section and a close up of the pleural membrane. Fluid forms in the pleural space between the visceral pleura on the lung and the parietal pleura on the chest wall, collects at the base, and compresses the lung. A close up shows Starling forces: hydrostatic pressure pushes fluid out of the capillary, oncotic pressure pulls it back, and inflamed or malignant capillaries leak protein rich fluid. Gauges show effusion size, formation, fluid protein, lung compression, breathlessness and reaccumulation. Treatment choices are treating the cause, drainage and pleurodesis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pleural.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With pleurodesis",
  sourcesLis: [
    "<strong>How a pleural effusion forms.</strong> The pleural space between the visceral and parietal pleura normally holds only a thin film of fluid. Fluid accumulates when formation beats absorption. A transudate follows raised hydrostatic pressure (for example in heart failure) or low serum oncotic pressure, and is low in protein. An exudate follows inflammation or malignancy: capillaries become leaky, so protein and cells escape. Comparing pleural fluid protein and LDH with serum values is the idea behind Light criteria for separating an exudate from a transudate, and a diagnostic pleural tap (thoracentesis) is how the fluid is sampled. This is standard teaching in medicine and respiratory texts (Harrison, Disorders of the Pleura) and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Effects and treatment ideas shown.</strong> A growing effusion compresses the lung, makes percussion dull over the fluid, and causes breathlessness. Treating the cause lowers formation, drainage by thoracentesis or a chest drain removes fluid and lets the lung re expand, and pleurodesis seals the pleural space so fluid cannot reaccumulate easily. These are teaching toggles only.",
  ],
  simplified: "Pleural anatomy in detail, lymphatic absorption, empyema, haemothorax, chylothorax, imaging signs, the full Light criteria values, fluid chemistry, contraindications, and all doses and procedural technique are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pl-wall{fill:color-mix(in srgb,var(--c-sm) 34%,var(--c-tis));stroke:color-mix(in srgb,var(--c-sm) 60%,#000);stroke-width:2}
.pl-cavity{fill:color-mix(in srgb,var(--c-fl) 7%,var(--anatomy-paper))}
.pl-parietal{fill:none;stroke:var(--c-lymph);stroke-width:3}
.pl-story{fill:var(--anatomy-strong);font-size:12px}
.p-adh{--cc:var(--c-neut)}
.p-talc{--cc:var(--anatomy-paper)}
.pl-fluid{fill:color-mix(in srgb,var(--c-fl) 62%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.4}
.pl-diaph{fill:none;stroke:var(--c-neut);stroke-width:4;stroke-linecap:round}
.pl-detail{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.pl-cap{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:2}
.pl-memb{fill:none;stroke:var(--c-lymph);stroke-width:3.4;stroke-linecap:round}
.pl-mini{fill:color-mix(in srgb,var(--c-fl) 6%,var(--anatomy-paper))}
.pl-arrowH{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pl-arrowO{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pl-needle{fill:none;stroke:var(--anatomy-strong);stroke-width:5;stroke-linecap:round}
.pl-needle2{fill:none;stroke:var(--anatomy-paper);stroke-width:1.6;stroke-linecap:round}
.pl-seal{fill:none;stroke:var(--c-neut);stroke-width:5;stroke-dasharray:7 5}
.p-prot{--cc:var(--c-eos)}
.dr-g-fill.g-prot{fill:var(--c-eos)}.dr-g-fill.g-comp{fill:var(--c-endo)}
`,
});
