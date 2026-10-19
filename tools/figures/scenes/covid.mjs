/* COVID-19 pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/covid.mjs [--print-model]
 * Static layout here; viruses, cells, cytokines and gauges move in covid.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of illness", a: [0.3, 0.65, 1], names: ["mild", "pneumonia", "critical"], ticks: ["mild", "pneumonia", "critical"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "supportive oxygen" },
    { label: "dexamethasone for hypoxic disease" },
    { label: "antiviral early" },
  ],
  status: "Illness: {level} · {drug} ·",
  drugNames: ["no treatment", "supportive oxygen", "dexamethasone for hypoxic disease", "antiviral early"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], oxy = drug === 1 ? 1 : 0, dex = drug === 2 ? 1 : 0, ant = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const antF = [0.25, 0.4, 0.55][level];
  const V = cl(a * (ant ? antF : 1));
  const I = cl(0.08 + 0.85 * V);
  const C = cl((0.1 + 0.85 * I * (0.3 + 0.7 * a)) * (dex ? 0.6 : 1) * (ant ? 0.8 : 1));
  const D = cl(0.03 + 0.45 * a + 0.45 * C);
  const T = cl(0.03 + 0.75 * C * a);
  const Ox = cl(0.97 - 0.75 * D - 0.2 * T + oxy * 0.22);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.35, 0.7, ["low", "present", "high"]), w(C, 0.3, 0.62, ["low", "raised", "storm"]), w(Ox, 0.3, 0.6, ["very low", "low", "near normal"])];
  return { a, oxy, dex, ant, V, I, C, D, T, Ox, words, readout: "virus " + words[0] + " · inflammation " + words[1] + " · oxygen " + words[2] };
}
const TESTS = [
  [0, 0, "virus low · inflammation low · oxygen near normal"],
  [1, 0, "virus present · inflammation raised · oxygen low"],
  [2, 0, "virus high · inflammation storm · oxygen very low"],
  [2, 2, "virus high · inflammation raised · oxygen low"],
  [0, 3, "virus low · inflammation low · oxygen near normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">FROM AIRWAY TO LUNG</text>
<path class="cov-arrow" d="M131 150L308 182"/>
<path class="cov-arrow" d="M131 270L308 272"/>
<circle class="cov-node" cx="95" cy="150" r="36"/>
<circle class="cov-node" cx="95" cy="270" r="36"/>
<g class="cov-icon">
  <circle cx="95" cy="150" r="13"/>
  <path d="M95 132v-8M95 168v8M77 150h-8M113 150h8M82 137l-6-6M108 137l6-6M82 163l-6 6M108 163l6 6"/>
  <path d="M78 270h34M84 258v24M95 254v32M106 258v24"/>
</g>
<rect class="cov-airway" x="368" y="62" width="26" height="66" rx="10"/>
<ellipse id="alvOuter" class="cov-alv-out" cx="470" cy="230" rx="158" ry="108"/>
<ellipse id="stormGlow" class="cov-storm" cx="470" cy="230" rx="150" ry="100" opacity="0"/>
<ellipse id="alvAir" class="cov-alv-air" cx="470" cy="230" rx="138" ry="90"/>
<ellipse id="hyal" class="cov-hyal" cx="470" cy="230" rx="129" ry="82"/>
<ellipse id="fluidEl" class="cov-fluid" cx="470" cy="282" rx="112" ry="34"/>
<rect id="capLumen" class="cov-cap" x="320" y="350" width="300" height="32" rx="16"/>
<rect class="cov-vessel" x="700" y="242" width="220" height="30" rx="15"/>
<path id="lungVessel" class="cov-caplink" d="M620 366L700 340"/>
<g id="lungSlot"></g>
<ellipse id="lungDamage" class="cov-damage" cx="805" cy="355" rx="52" ry="66" opacity="0"/>
<g id="epiG"></g>
<g id="endoG"></g>
<g id="aceG"></g>
<g id="cellsG"></g>
<g id="rbcsG"></g>
<g id="clotsG"></g>
<g id="blockG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-vir:#7fcf6a;--c-epi:#7fc4e8;--c-ace:#f2d27a;--c-dad:#e8d36a}
body[data-theme="light"]{--c-vir:#4fa63c;--c-epi:#3fa0d4;--c-ace:#b98f2e;--c-dad:#b9a52e}
.cl-epi{--cc:var(--c-epi)}.cl-vir{--cc:var(--c-vir)}
.cov-arrow{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;opacity:.7}
.cov-node{fill:color-mix(in srgb,var(--c-vir) 22%,var(--anatomy-paper));stroke:var(--c-vir);stroke-width:1.5}
.cov-icon{fill:var(--c-vir);stroke:color-mix(in srgb,var(--c-vir) 55%,#000);stroke-width:1.4;stroke-linecap:round}
.cov-airway{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.cov-alv-out{fill:color-mix(in srgb,var(--c-endo) 20%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.4}
.cov-alv-air{fill:color-mix(in srgb,var(--c-epi) 15%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-epi) 60%,#000);stroke-width:1.2}
.cov-storm{fill:color-mix(in srgb,var(--c-bad) 38%,transparent);stroke:none}
.cov-hyal{fill:none;stroke:var(--c-dad);stroke-width:6;stroke-dasharray:10 5;opacity:0}
.cov-fluid{fill:var(--c-fl);opacity:0}
.cov-cap{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.cov-caplink{fill:none;stroke:var(--c-rbc);stroke-width:10;stroke-linecap:round;opacity:.55}
.cov-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.cov-damage{fill:color-mix(in srgb,var(--c-bad) 55%,transparent);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.2}
.cov-ace{fill:none;stroke:var(--c-ace);stroke-width:1.3;stroke-linecap:round}
.cov-calm{fill:none;stroke:var(--c-cyt);stroke-width:2;stroke-dasharray:5 4;opacity:0}
.cov-dose{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}.cov-dose2{fill:var(--c-bad);opacity:.7}
.cov-capline{fill:var(--anatomy-strong);font-size:12px}
.p-vir{--cc:var(--c-vir)}.p-oxy{--cc:var(--c-fl)}.p-dex{--cc:var(--c-cyt)}
.dr-g-fill.g-vir{fill:var(--c-vir)}.dr-g-fill.g-inn{fill:var(--c-neut)}.dr-g-fill.g-dad{fill:var(--c-bad)}.dr-g-fill.g-oxy2{fill:var(--c-good)}
`;

buildScene({
  id: "covid-19-pathogenesis", fig: "Fig 1", title: "COVID-19: from ACE2 entry to hypoxia", W, H, body, extraCss,
  label: "An animated airway, alveolus and lung in COVID-19. SARS-CoV-2 spike binds ACE2 on airway and alveolar cells, the virus copies itself inside cells, defence cells raise the alarm, cytokines rise, fluid floods the air sac, tiny clots block small vessels, and the lung cannot pass oxygen to blood. Gauges show virus, innate response, cytokines, alveolar damage, clotting and oxygen. Treatment choices are supportive oxygen, dexamethasone for hypoxic disease and antiviral given early.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "covid.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antiviral early",
  sourcesLis: [
    "<strong>How COVID-19 develops.</strong> SARS-CoV-2 is a betacoronavirus first recognised in an outbreak of respiratory illness. Its spike protein binds ACE2 on airway and alveolar cells, then the virus copies itself in the respiratory tract. The innate response recruits macrophages and neutrophils and releases cytokines. In severe disease in older adults and others at risk, a strong cytokine response, diffuse alveolar damage with hyaline membranes and flooded alveoli, and endothelitis with microthrombi impair gas exchange and cause hypoxia, sometimes needing ventilation. Variants differ in transmission and severity. This is standard teaching on coronavirus infection in humans and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Supportive oxygen helps hypoxic disease without fixing the alveolar damage. Dexamethasone calms inflammation in hypoxic disease. An antiviral given early limits viral copying. These are teaching toggles only and show direction of effect, not how any patient should be treated.",
  ],
  simplified: "Variant specific behaviour, adaptive immunity and antibodies, thrombosis beyond microthrombi, bacterial superinfection, organ effects outside the lung, vaccination, and all doses, timing windows and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
