/* Anaphylaxis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/anaph.mjs [--print-model]
 * Static layout here; mast cell, lung with bronchiole, larynx, heart, vessel and gauges move in anaph.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the reaction", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "adrenaline" },
    { label: "antihistamine and steroid" },
    { label: "fluids" },
  ],
  status: "Reaction: {level} · {drug} ·",
  drugNames: ["no treatment", "adrenaline", "an antihistamine and steroid", "fluids"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const adr = drug === 1 ? 1 : 0, ahs = drug === 2 ? 1 : 0, flu = drug === 3 ? 1 : 0;
  const M = cl(a * (ahs ? 0.6 : adr ? 0.55 : 1));
  const Air = cl(0.06 + 0.88 * M * (adr ? 0.22 : ahs ? 0.65 : 1));
  const Lar = cl(0.04 + 0.84 * a * (adr ? 0.28 : ahs ? 0.6 : 1));
  const Vaso = cl(0.04 + 0.88 * M * (adr ? 0.22 : 1));
  const Vol = cl(1 - 0.7 * Vaso + flu * 0.5 + adr * 0.15);
  const BP = cl(0.96 - 0.58 * Vaso - 0.38 * (1 - Vol) + adr * 0.18 + flu * 0.06);
  const Breath = cl(0.08 + 0.5 * Air + 0.45 * Lar);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(M, 0.32, 0.62, ["low", "raised", "high"]), w(Air, 0.3, 0.6, ["open", "narrowed", "very narrowed"]), w(BP, 0.35, 0.62, ["low", "borderline", "maintained"])];
  return { a, adr, ahs, flu, M, Air, Lar, Vaso, Vol, BP, Breath, words, readout: "mediators " + words[0] + " · airway " + words[1] + " · pressure " + words[2] };
}
const TESTS = [
  [2, 0, "mediators high · airway very narrowed · pressure low"],
  [2, 1, "mediators raised · airway open · pressure maintained"],
  [2, 2, "mediators raised · airway narrowed · pressure borderline"],
  [2, 3, "mediators high · airway very narrowed · pressure borderline"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="flush" class="sc-flush" x="14" y="44" width="${W - 28}" height="396" rx="18" opacity="0"/>
<text class="sc-zone" x="34" y="68">ALLERGEN AND MAST CELL</text>
<text class="sc-zone" x="392" y="68">BRONCHIOLE</text>
<text class="sc-zone" x="676" y="68">LARYNX AND VESSEL</text>
<g id="allerg"></g>
<g id="mastg"></g>
<g id="lungSlot"></g>
<g id="heartSlot"></g>
<path id="bronch" class="an-bronch" d="M374 229 L449 237 L449 253 L374 243 Z"/>
<g id="airwayg"></g>
<g id="larynxg"></g>
<rect id="lumenV" class="sc-lumen" x="706" y="330" width="226" height="72" rx="10"/>
<g id="vesselg"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-flush{fill:var(--c-bad)}
.p-allergen{--cc:#ff9a3d}.p-hist{--cc:#ff5e8a}.p-med2{--cc:#ffd24a}.p-gran{--cc:#ff5e8a}
.p-adr{--cc:#7cf2c8}.p-ah{--cc:#b7a1e6}
.ige-p{fill:none;stroke:var(--c-b);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ige-b{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.rc-dot{fill:var(--anatomy-paper);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:.8}
.an-bronch{fill:color-mix(in srgb,var(--c-endo) 30%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.an-cap{fill:var(--anatomy-strong);font-size:12px}
.aw-outer{fill:color-mix(in srgb,var(--c-endo) 22%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.aw-muscle{fill:none;stroke:var(--c-sm)}
.aw-epi{fill:none;stroke:var(--c-endo);stroke-width:3}
.aw-lumen{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper))}
.aw-mucus{fill:var(--c-fl);opacity:.55}
.aw-muc{fill:var(--c-fl)}
.lx-wall{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.lx-fold{fill:var(--c-mast);stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:.8}
.dr-g-fill.g-hist{fill:#ff5e8a}
.air-dot{fill:var(--c-fl)}
`;

buildScene({
  id: "anaphylaxis", fig: "Fig 1", title: "Anaphylaxis: allergen to shock", W, H, body, extraCss,
  label: "An animated mast cell, a lung with a bronchiole that narrows, a swelling larynx, and a heart pumping into a leaky blood vessel. Allergen cross-links IgE on the mast cell, which releases mediators such as histamine. Mediators narrow the bronchiole, swell the larynx, and dilate and leak the vessel so blood pressure falls toward shock. Each treatment is shown acting on the drawing: adrenaline docks on vessel and airway docking points, antihistamine sits on histamine docking points and traps mediator particles, and fluids refill the vessel. Gauges show mediators, airway narrowing, larynx swelling, vessel dilation, blood pressure and breathing difficulty. Treatment choices are adrenaline, antihistamine with steroid, and fluids.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W }, pageJs: readFileSync(join(HERE, "anaph.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With adrenaline",
  sourcesLis: [
    "<strong>How anaphylaxis develops.</strong> In a sensitised person, allergen cross-links IgE fixed to Fc receptors on mast cells and basophils. The cells degranulate within minutes, releasing histamine, tryptase, prostaglandins, leukotrienes and other mediators. Histamine and related mediators dilate blood vessels and make them leaky (falling blood pressure and shock, flushing, urticaria and angioedema), contract airway smooth muscle (bronchospasm and wheeze), drive mucus secretion, and swell the larynx (stridor and airway obstruction). This is standard teaching in immunology, allergy and emergency-medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Adrenaline is the rescue treatment: it constricts vessels, relaxes airway smooth muscle, reduces further mediator release and supports the heart. Antihistamines and steroids are slower adjuncts that blunt histamine effects and later inflammation, and fluids support the circulating volume when vessels have dilated and leaked. Airway support and removing the trigger matter in real care but are not modelled as toggles here. These are teaching toggles only.",
  ],
  simplified: "Basophils, tryptase and the other individual mediators, urticaria and skin signs in detail, gut and heart effects, biphasic reactions, airway devices, oxygen, and all doses, routes and timings are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
