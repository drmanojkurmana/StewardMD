/* SIADH and diabetes insipidus as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/siadh.mjs [--print-model]
 * Static layout here; ADH, aquaporin channels, urine and the brain move in siadh.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Water balance state", a: [0, 1, 2, 3], names: ["normal", "SIADH", "central DI", "nephrogenic DI"], ticks: ["normal", "SIADH", "central DI", "nephrogenic DI"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "fluid restriction" },
    { label: "desmopressin" },
    { label: "thiazide (for nephrogenic DI)" },
  ],
  status: "State: {level} · {drug} ·",
  drugNames: ["no treatment", "fluid restriction", "desmopressin", "thiazide"],
};
function modelOf(S, level, drug) {
  const BASE = [
    { ADH: 0.5, AQP: 0.5, Re: 0.5, Uv: 0.38, Uc: 0.5, Na: 0.5, Wat: 0.5, Th: 0.3 },
    { ADH: 0.92, AQP: 0.9, Re: 0.9, Uv: 0.14, Uc: 0.9, Na: 0.16, Wat: 0.86, Th: 0.18 },
    { ADH: 0.07, AQP: 0.1, Re: 0.1, Uv: 0.92, Uc: 0.1, Na: 0.86, Wat: 0.16, Th: 0.92 },
    { ADH: 0.86, AQP: 0.12, Re: 0.12, Uv: 0.9, Uc: 0.13, Na: 0.83, Wat: 0.2, Th: 0.88 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const b = BASE[level];
  let ADH = b.ADH, AQP = b.AQP, Re = b.Re, Uv = b.Uv, Uc = b.Uc, Na = b.Na, Wat = b.Wat, Th = b.Th;
  if (drug === 1) {
    if (level === 1) { Wat = 0.52; Na = 0.48; Re = 0.68; Uv = 0.26; Uc = 0.72; Th = 0.3; }
    else if (level === 0) { Wat = 0.42; Na = 0.56; Uv = 0.3; Uc = 0.58; Th = 0.42; }
    else { Wat = cl(Wat * 0.55); Na = cl(Na + 0.1); Th = 0.96; Uv = cl(Uv + 0.03); }
  }
  if (drug === 2) {
    ADH = Math.max(ADH, 0.9);
    if (level !== 3) {
      AQP = 0.9; Re = 0.9; Uc = 0.88;
      if (level === 2) { Uv = 0.2; Wat = 0.52; Na = 0.5; Th = 0.32; }
      else if (level === 1) { Uv = 0.1; Wat = 0.92; Na = 0.12; Th = 0.15; }
      else { Uv = 0.16; Wat = 0.8; Na = 0.24; Th = 0.2; }
    }
  }
  if (drug === 3) {
    if (level === 3) { Uv = 0.52; Uc = 0.32; Re = 0.34; AQP = 0.3; Wat = 0.4; Na = 0.66; Th = 0.58; }
    else if (level === 1) { Na = cl(Na - 0.05); Wat = cl(Wat + 0.03); }
    else if (level === 2) { Uv = 0.8; Uc = 0.18; Wat = 0.24; Na = 0.78; Th = 0.8; }
    else { Uv = 0.48; Uc = 0.44; }
  }
  ADH = cl(ADH); AQP = cl(AQP); Re = cl(Re); Uv = cl(Uv); Uc = cl(Uc); Na = cl(Na); Wat = cl(Wat); Th = cl(Th);
  const Bw = cl(0.5 + (Wat - 0.5) * 0.75 + (0.5 - Na) * 0.6);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const urineWord = Uv < 0.28 ? "small concentrated" : Uv > 0.68 ? "large dilute" : "normal";
  const words = [w(AQP, 0.3, 0.65, ["low", "normal", "high"]), urineWord, w(Na, 0.35, 0.65, ["low", "normal", "high"]), w(Bw, 0.35, 0.65, ["shrunken", "normal", "swollen"])];
  return { ADH, AQP, Re, Uv, Uc, Na, Wat, Th, Bw, words, readout: "ADH effect " + words[0] + " · urine " + words[1] + " · sodium " + words[2] + " · brain " + words[3] };
}
const TESTS = [
  [0, 0, "ADH effect normal · urine normal · sodium normal · brain normal"],
  [1, 0, "ADH effect high · urine small concentrated · sodium low · brain swollen"],
  [2, 0, "ADH effect low · urine large dilute · sodium high · brain shrunken"],
  [2, 2, "ADH effect high · urine small concentrated · sodium normal · brain normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="290" height="170" rx="16"/>
<rect class="sc-tissue" x="314" y="44" width="292" height="170" rx="16"/>
<rect class="sc-tissue" x="616" y="44" width="330" height="170" rx="16"/>
<rect class="sc-tissue" x="14" y="224" width="460" height="218" rx="16"/>
<rect class="sc-tissue" x="484" y="224" width="462" height="218" rx="16"/>
<text class="sc-zone" x="32" y="68">POSTERIOR PITUITARY</text>
<text class="sc-zone" x="332" y="68">BLOOD</text>
<text class="sc-zone" x="634" y="68">COLLECTING DUCT</text>
<text class="sc-zone" x="32" y="248">BRAIN AND THIRST</text>
<text class="sc-zone" x="502" y="248">URINE OUTPUT</text>
<rect id="lumen" class="sc-lumen" x="330" y="126" width="260" height="58"/>
<ellipse class="si-pit" cx="142" cy="148" rx="54" ry="38"/>
<ellipse class="si-pit2" cx="126" cy="136" rx="24" ry="16"/>
<path class="si-stalk" d="M142 110L142 84"/>
<g id="ductcells"></g>
<path class="si-tube" d="M782 82L782 196L782 300"/>
<rect id="beaker" class="si-beaker" x="640" y="292" width="150" height="118" rx="8"/>
<rect id="urinefill" class="si-urine" x="646" y="380" width="138" height="24" rx="5"/>
<g id="brain"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.si-pit{fill:color-mix(in srgb,var(--c-mac) 52%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.6}
.si-pit2{fill:color-mix(in srgb,#fff 35%,transparent);stroke:none}
.si-stalk{fill:none;stroke:var(--c-mac);stroke-width:5;stroke-linecap:round}
.si-tube{fill:none;stroke:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke-width:34;stroke-linecap:round}
.si-beaker{fill:color-mix(in srgb,var(--anatomy-paper) 70%,transparent);stroke:var(--anatomy-mid);stroke-width:1.4}
.si-urine{fill:#e8c84a}
.si-aqp{fill:#8a6fd0}.si-aqp.open{fill:var(--c-good)}
.si-watercup{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.4}
.p-adh{--cc:#c084fc}.p-salt2{--cc:#d9c8f2}
.dr-g-fill.g-adh{fill:#c084fc}.dr-g-fill.g-re{fill:var(--c-fl)}.dr-g-fill.g-uv{fill:#e8c84a}.dr-g-fill.g-na2{fill:#b79ae0}.dr-g-fill.g-bw{fill:var(--c-lymph)}
`;

buildScene({
  id: "siadh-diabetes-insipidus", fig: "Fig 1", title: "Water balance: SIADH and diabetes insipidus", W, H, body, extraCss,
  label: "An animated map of water balance. Antidiuretic hormone from the posterior pituitary travels in blood to the collecting duct, where it inserts aquaporin-2 channels and lets water return to the body. In SIADH excess hormone holds water, dilutes blood sodium and makes small concentrated urine. In central diabetes insipidus hormone is missing, and in nephrogenic diabetes insipidus the duct does not respond, so large dilute urine is lost, sodium rises and thirst grows. Treatment choices are fluid restriction, desmopressin and a thiazide for nephrogenic disease, with gauges for ADH effect, water reabsorption, urine flow, sodium and brain water.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, volumes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "siadh.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How water balance is controlled.</strong> Antidiuretic hormone (ADH, also called vasopressin) is made in the hypothalamus and released from the posterior pituitary. It acts on V2 receptors in the collecting duct to insert aquaporin-2 water channels, so water is reabsorbed and urine becomes small and concentrated. Without that signal, or when the duct cannot respond, aquaporin-2 stays out of the membrane, water is lost as large volumes of dilute urine, blood sodium rises and thirst is driven. This is standard teaching in medicine and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The disorders and treatments shown.</strong> SIADH is excess ADH effect with water retention, dilutional hyponatraemia and concentrated urine: limiting fluid intake is the teaching toggle shown. Central diabetes insipidus is ADH deficiency and responds to desmopressin, a synthetic ADH analogue. Nephrogenic diabetes insipidus is duct resistance to ADH, so desmopressin does not correct it; a thiazide can paradoxically reduce urine volume by causing mild volume depletion and more proximal reabsorption. The figure shows direction of effect only.",
  ],
  simplified: "Osmoreceptor and baroreceptor control loops, causes of each disorder, copeptin and diagnostic testing, urine and plasma osmolality values, correction rates and osmotic demyelination, other treatments, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
