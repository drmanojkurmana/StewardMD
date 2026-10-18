/* Leprosy spectrum as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/leprosy.mjs [--print-model]
 * Static layout here; bacilli, immune cells and gauges move in leprosy.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Position on the leprosy spectrum", a: [0, 1, 2], names: ["tuberculoid", "borderline", "lepromatous"], ticks: ["tuberculoid", "borderline", "lepromatous"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "multidrug therapy" },
    { label: "steroid for reaction" },
    { label: "multidrug therapy and steroid" },
  ],
  status: "Spectrum: {level} · {drug} ·",
  drugNames: ["no treatment", "multidrug therapy", "a steroid for reaction", "multidrug therapy and a steroid"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const I0 = [0.9, 0.55, 0.15][level], B0 = [0.15, 0.5, 0.95][level], R0 = [0.3, 0.85, 0.55][level];
  const Nd0 = [0.75, 0.65, 0.55][level], Sk0 = [0.25, 0.55, 0.9][level];
  const mdt = drug === 1 || drug === 3 ? 1 : 0, steroid = drug === 2 || drug === 3 ? 1 : 0;
  const B = cl(B0 * (mdt ? 0.15 : 1));
  const I = cl(I0 * (steroid ? 0.75 : 1));
  const G = cl(I * (steroid ? 0.85 : 1));
  const R = cl(R0 * (steroid ? 0.3 : 1) * (mdt ? 0.9 : 1));
  const Nd = cl(Nd0 * (steroid ? 0.55 : 1) * (mdt ? 0.85 : 1));
  const Skn = cl(Sk0 * (mdt ? 0.7 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.25, 0.6, ["few", "some", "many"]), w(I, 0.3, 0.7, ["weak", "moderate", "strong"]), w(Nd, 0.3, 0.6, ["little", "some", "marked"]), w(R, 0.35, 0.65, ["low", "moderate", "high"])];
  return { B, I, G, R, Nd, Skn, mdt, steroid, words, readout: "bacilli " + words[0] + " · Th1 response " + words[1] + " · nerve damage " + words[2] + " · reaction " + words[3] };
}
const TESTS = [
  [0, 0, "bacilli few · Th1 response strong · nerve damage marked · reaction low"],
  [2, 0, "bacilli many · Th1 response weak · nerve damage some · reaction moderate"],
  [1, 1, "bacilli few · Th1 response moderate · nerve damage some · reaction high"],
  [1, 3, "bacilli few · Th1 response moderate · nerve damage some · reaction low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="sc-box" x="30" y="78" width="430" height="140" rx="14"/>
<rect class="sc-epi" x="30" y="78" width="430" height="18" rx="9"/>
<text class="sc-zone" x="42" y="92">SKIN</text>
<ellipse id="patch" class="sc-patch" cx="185" cy="155" rx="100" ry="40"/>
<g id="nodules"></g>
<rect class="sc-box" x="490" y="78" width="440" height="140" rx="14"/>
<text class="sc-zone" x="504" y="98">IMMUNE RESPONSE</text>
<g id="skinCells"></g>
<g id="immuneCells"></g>
<g id="parts"></g>
<rect id="flare" class="sc-flare" x="30" y="262" width="900" height="146" rx="60" opacity="0"/>
<rect class="sc-nerve" x="30" y="270" width="900" height="130" rx="60"/>
<text class="sc-zone" x="46" y="292">PERIPHERAL NERVE</text>
<path class="sc-axon" d="M48 335H828"/>
<g id="nerveCells"></g>
<g id="damage"></g>
<g id="hand"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-epi{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:.8}
.sc-patch{fill:color-mix(in srgb,#e9c46a 28%,var(--anatomy-paper));stroke:color-mix(in srgb,#e9c46a 70%,#000);stroke-width:1.2;stroke-dasharray:5 3}
.sc-nod{fill:color-mix(in srgb,#e9c46a 22%,var(--anatomy-paper));stroke:color-mix(in srgb,#e9c46a 60%,#000);stroke-width:1}
.sc-nerve{fill:color-mix(in srgb,var(--c-endo) 18%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.sc-flare{fill:var(--c-bad)}
.sc-axon{fill:none;stroke:var(--c-neut);stroke-width:5;stroke-linecap:round}
.sc-myel{fill:color-mix(in srgb,var(--c-lymph) 18%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1}
.sc-gap{fill:var(--c-tis)}
.cl-schw{--cc:var(--c-lymph)}.cl-foam{--cc:var(--c-plt)}
.p-ifng{--cc:var(--c-cyt)}.p-rxn{--cc:var(--c-bad)}.p-ster{--cc:var(--c-fl)}
.hand-palm{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.4}
.hand-fin{fill:none;stroke:var(--anatomy-strong);stroke-width:5;stroke-linecap:round}
`;

buildScene({
  id: "leprosy", fig: "Fig 1", title: "Leprosy: bacilli, immunity and nerve damage", W, H, body, extraCss,
  label: "An animated skin patch, immune response and peripheral nerve in leprosy. Mycobacterium leprae bacilli live in skin macrophages and in Schwann cells around a nerve fibre. At the tuberculoid end a strong Th1 response forms a tight granuloma and keeps bacilli few, but damages the nerve. At the lepromatous end the response is weak, foamy macrophages hold many bacilli and skin lesions spread. Borderline disease is unstable and prone to reaction. Gauges show bacilli, Th1 response, granuloma, nerve damage and reaction. Treatment choices include multidrug therapy and a steroid for reaction.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "leprosy.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>The organism and the spectrum.</strong> Leprosy (Hansen disease) is caused by Mycobacterium leprae, a slow growing bacillus that favours cooler skin and peripheral nerves and invades Schwann cells. Where a person sits on the spectrum is set by the cell mediated immune response. Tuberculoid disease: a strong Th1 response with interferon gamma, a well formed granuloma, very few bacilli, a single well defined skin patch with loss of feeling, and early nerve damage from the immune attack itself. Lepromatous disease: a weak cell mediated response, foamy macrophages packed with bacilli, many widespread skin lesions, and later widespread nerve involvement. Borderline disease sits between the two and is unstable. This is standard teaching in infectious disease and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Reactions and nerve damage.</strong> Reactions are sudden immune flares that can injure nerves quickly and cause deformity if untreated. A type 1 (reversal) reaction is a rising Th1 response, mostly in borderline disease, with inflamed patches and painful swollen nerves. Erythema nodosum leprosum is an immune complex flare in lepromatous disease with tender skin nodules and fever. Loss of feeling and weakness lead to unnoticed injury, claw hand and other deformity. This summary is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Multidrug therapy kills the bacilli and lowers the load in skin and nerve; it does not by itself calm a reaction. A steroid calms the reaction flare and protects the nerve during a reaction, but does not kill bacilli. They are teaching toggles only.",
  ],
  simplified: "The full Ridley and Jopling classification, borderline subtypes, pure neuritic disease, eye and nasal involvement, the details of each reaction, drug resistance, rehabilitation and prevention, and all drug doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
