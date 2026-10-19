/* Fungal infections as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/fungal.mjs [--print-model]
 * Static layout here; organs, fungi, treatment particles and gauges move in fungal.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Depth of infection", a: [0.3, 0.65, 1], names: ["superficial", "mucosal Candida", "invasive"], ticks: ["superficial", "mucosal", "invasive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "topical azole" },
    { label: "systemic azole" },
    { label: "polyene or echinocandin" },
  ],
  status: "Infection: {level} · {drug} ·",
  drugNames: ["no treatment", "a topical azole", "a systemic azole", "a polyene or echinocandin"],
};
function modelOf(S, level, drug) {
  const effTable = [[0, 0.85, 0.7, 0.1], [0, 0.45, 0.85, 0.5], [0, 0.05, 0.6, 0.9]];
  const invBase = [0.1, 0.4, 1];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level], eff = effTable[level][drug];
  const F = cl(a * (1 - 0.88 * eff));
  const Inv = cl(invBase[level] * (1 - 0.75 * eff));
  const Dmg = cl(F * 0.5 + Inv * 0.7);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(F, 0.18, 0.5, ["low", "present", "heavy"]), w(Inv, 0.18, 0.5, ["limited", "spreading", "deep"]), w(Dmg, 0.2, 0.5, ["little", "some", "marked"])];
  return { a, eff, lvl: level, drug, F, Inv, Dmg, Reach: eff, words, readout: "fungal burden " + words[0] + " · invasion " + words[1] + " · tissue damage " + words[2] };
}
const TESTS = [
  [0, 1, "fungal burden low · invasion limited · tissue damage little"],
  [2, 0, "fungal burden heavy · invasion deep · tissue damage marked"],
  [2, 3, "fungal burden present · invasion spreading · tissue damage some"],
  [1, 2, "fungal burden low · invasion limited · tissue damage little"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="fn-strip" x="28" y="342" width="904" height="88" rx="12"/>
<path id="bloodTube" class="fn-tube" d="M531 304 C600 326 682 300 752 237" fill="none"/>
<ellipse id="brainGlow" class="fn-glow" cx="815" cy="200" rx="105" ry="85" fill="var(--c-cyt2)" opacity="0"/>
<g id="skinSlot"></g>
<g id="gutSlot"></g>
<g id="lungSlot"></g>
<g id="brainSlot"></g>
<g id="siteSkin"></g>
<g id="siteGut"></g>
<g id="siteLung"></g>
<g id="siteBrain"></g>
<g id="siteBlood"></g>
<g id="fungcell"></g>
<g id="flow"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-fung:#9ed67a;--c-cand:#f2e6a0;--c-wall:#7fc4e8;--c-erg:#f08a4b}
body[data-theme="light"]{--c-fung:#3f9e4d;--c-cand:#b89a2a;--c-wall:#2f7ad8;--c-erg:#d95f1e}
.cl-yeast{--cc:var(--c-fung)}.cl-cand{--cc:var(--c-cand)}
.fn-strip{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.fn-tube{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:15;stroke-linecap:round;opacity:.8}
.fn-glow{fill:var(--c-cyt2);stroke:none}
.fn-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.fn-cream{fill:color-mix(in srgb,#9fd8f0 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1;opacity:0}
.fn-ring{fill:none;stroke:var(--c-fung);stroke-width:3}
.fn-ring2{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 4}
.fn-hyph{fill:none;stroke:var(--c-fung);stroke-width:2.4;stroke-linecap:round}
.fn-hyph2{fill:none;stroke:var(--c-cand);stroke-width:2.2;stroke-linecap:round}
.fn-plaque{fill:var(--anatomy-strong);stroke:var(--anatomy-faint);stroke-width:.7}
.fn-halo{fill:color-mix(in srgb,var(--c-wall) 18%,transparent);stroke:var(--c-wall);stroke-width:1.2}
.fn-wallring{fill:color-mix(in srgb,var(--c-fung) 22%,var(--anatomy-paper));stroke:var(--c-wall);stroke-width:6}
.fn-membring{fill:none;stroke:var(--c-erg);stroke-width:2.4;stroke-dasharray:5 4}
.fn-ergd{fill:var(--c-erg);stroke:color-mix(in srgb,var(--c-erg) 55%,#000);stroke-width:.5}
.p-spore{--cc:var(--c-fung)}.p-treat{--cc:#38d1ff}
.dr-g-fill.g-fung{fill:var(--c-fung)}.dr-g-fill.g-reach{fill:var(--c-good)}
`;

buildScene({
  id: "fungal-infections", fig: "Fig 1", title: "Fungal infections: surface to invasive", W, H, body, extraCss,
  label: "An animated scene of fungal infection that travels from left to right. On skin, dermatophytes grow in keratin and cause a scaly ring. On moist mucosa, Candida yeast forms white plaques. Spores reach the lung and sprout invading hyphae, yeast rides the blood to the brain lining, and a magnified fungal cell shows the wall and membrane targets that drugs hit. The slider sets the depth, and each treatment visibly attacks the fungi where it can reach.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or treatment schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "fungal.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With polyene or echinocandin",
  sourcesLis: [
    "<strong>Superficial infection.</strong> Dermatophyte fungi (species of Trichophyton, Microsporum and Epidermophyton) digest keratin in skin, hair and nails. They cause tinea: scaly, itchy, ring-like lesions that spread at the edge, scalp and hair-shaft infection, and onychomycosis, where the nail thickens and crumbles. Malassezia, a skin yeast, causes pityriasis versicolor. Superficial disease usually responds to topical therapy, but hair and nail infection needs oral therapy for months because the drug must grow out with the nail. This is standard teaching in dermatology and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Candida and invasive disease.</strong> Candida is a normal mucosal organism that causes candidiasis (white plaques, soreness) when local or immune defences slip, and can enter the blood in very ill or immunosuppressed patients. Aspergillus spores are inhaled and can invade lung tissue and blood vessels when neutrophil defences are weak. Cryptococcus is an encapsulated yeast that can reach the meninges and cause meningitis, mainly in advanced immune suppression.",
    "<strong>Cell targets and treatment ideas shown.</strong> The fungal wall is rich in glucan, and the membrane contains ergosterol instead of cholesterol. Azoles (topical, or systemic such as itraconazole) block ergosterol making; terbinafine acts on the same pathway. Polyenes bind ergosterol and punch holes in the membrane. Echinocandins block glucan making, so the wall weakens. Topical therapy only reaches the surface, so deep infection needs a systemic class. These are teaching toggles only.",
  ],
  simplified: "Fungal identification, species-level drug choice, resistance, immune reconstitution, combination therapy, prophylaxis, and all doses and durations (beyond noting that nail therapy takes months) are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
