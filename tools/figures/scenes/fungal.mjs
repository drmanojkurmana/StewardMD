/* Fungal infections as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/fungal.mjs [--print-model]
 * Static layout here; fungi, treatment particles and gauges move in fungal.page.js. Qualitative: no doses, no numbers. */
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
    { label: "polyene or echinocandin (invasive)" },
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
<rect class="fn-col" x="28" y="54" width="284" height="276" rx="12"/>
<rect class="fn-col" x="326" y="54" width="308" height="276" rx="12"/>
<rect class="fn-col" x="648" y="54" width="284" height="276" rx="12"/>
<rect id="hl0" class="fn-hl" x="28" y="54" width="284" height="276" rx="12"/>
<rect id="hl1" class="fn-hl" x="326" y="54" width="308" height="276" rx="12"/>
<rect id="hl2" class="fn-hl" x="648" y="54" width="284" height="276" rx="12"/>
<text class="sc-zone" x="40" y="72">SUPERFICIAL</text>
<text class="sc-zone" x="338" y="72">MUCOSAL</text>
<text class="sc-zone" x="660" y="72">INVASIVE</text>
<g id="colA"></g><g id="colB"></g><g id="colC"></g>
<rect class="fn-strip" x="28" y="342" width="904" height="88" rx="12"/>
<text class="sc-zone" x="300" y="366">FUNGAL CELL TARGETS</text>
<g id="fungcell"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-fung:#9ed67a;--c-cand:#f2e6a0;--c-wall:#7fc4e8;--c-erg:#f08a4b}
body[data-theme="light"]{--c-fung:#3f9e4d;--c-cand:#b89a2a;--c-wall:#2f7ad8;--c-erg:#d95f1e}
.cl-yeast{--cc:var(--c-fung)}.cl-cand{--cc:var(--c-cand)}
.fn-col{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.fn-hl{fill:none;stroke:var(--anatomy-lit);stroke-width:2;pointer-events:none}
.fn-strip{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.fn-ker{fill:color-mix(in srgb,var(--c-cand) 34%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.fn-skin{fill:color-mix(in srgb,var(--c-endo) 30%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.fn-muc{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.fn-plaque{fill:var(--anatomy-strong);stroke:var(--anatomy-faint);stroke-width:.7}
.fn-ring{fill:none;stroke:var(--c-fung);stroke-width:3}
.fn-ring2{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 4}
.fn-hyph{fill:none;stroke:var(--c-fung);stroke-width:2.4;stroke-linecap:round}
.fn-hyph2{fill:none;stroke:var(--c-cand);stroke-width:2.2;stroke-linecap:round}
.fn-alv{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.fn-vessel{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1.2}
.fn-men{fill:none;stroke:var(--c-wall);stroke-width:3;stroke-linecap:round}
.fn-halo{fill:color-mix(in srgb,var(--c-wall) 18%,transparent);stroke:var(--c-wall);stroke-width:1.2}
.fn-wallring{fill:color-mix(in srgb,var(--c-fung) 22%,var(--anatomy-paper));stroke:var(--c-wall);stroke-width:6}
.fn-membring{fill:none;stroke:var(--c-erg);stroke-width:2.4;stroke-dasharray:5 4}
.fn-ergd{fill:var(--c-erg);stroke:color-mix(in srgb,var(--c-erg) 55%,#000);stroke-width:.5}
.p-spore{--cc:var(--c-fung)}.p-treat{--cc:#38d1ff}
.dr-g-fill.g-fung{fill:var(--c-fung)}.dr-g-fill.g-reach{fill:var(--c-good)}
`;

buildScene({
  id: "fungal-infections", fig: "Fig 1", title: "Fungal infections: surface to invasive", W, H, body, extraCss,
  label: "An animated scene of fungal infection at three depths. On skin, hair and nails, dermatophytes grow in keratin and cause scaly tinea lesions and nail infection. On moist mucosa, Candida yeast forms white plaques and pseudohyphae. In a host with weak immune defences, fungi invade deeply: Aspergillus hyphae in lung, Candida in blood, and encapsulated Cryptococcus reaching the meninges. A magnified fungal cell shows the glucan wall and the ergosterol membrane that antifungal classes target. Gauges show fungal burden, invasion, tissue damage and treatment reach.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or treatment schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "fungal.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Superficial infection.</strong> Dermatophyte fungi (species of Trichophyton, Microsporum and Epidermophyton) digest keratin in skin, hair and nails. They cause tinea: scaly, itchy, ring-like lesions that spread at the edge, scalp and hair-shaft infection, and onychomycosis, where the nail thickens and crumbles. Malassezia, a skin yeast, causes pityriasis versicolor. Superficial disease usually responds to topical therapy, but hair and nail infection needs oral therapy for months because the drug must grow out with the nail. This is standard teaching in dermatology and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Candida and invasive disease.</strong> Candida is a normal mucosal organism that causes candidiasis (white plaques, soreness) when local or immune defences slip, and can enter the blood in very ill or immunosuppressed patients. Aspergillus spores are inhaled and can invade lung tissue and blood vessels when neutrophil defences are weak. Cryptococcus is an encapsulated yeast that can reach the meninges and cause meningitis, mainly in advanced immune suppression.",
    "<strong>Cell targets and treatment ideas shown.</strong> The fungal wall is rich in glucan, and the membrane contains ergosterol instead of cholesterol. Azoles (topical, or systemic such as itraconazole) block ergosterol making; terbinafine acts on the same pathway. Polyenes bind ergosterol and punch holes in the membrane. Echinocandins block glucan making, so the wall weakens. Topical therapy only reaches the surface, so deep infection needs a systemic class. These are teaching toggles only.",
  ],
  simplified: "Fungal identification, species-level drug choice, resistance, immune reconstitution, combination therapy, prophylaxis, and all doses and durations (beyond noting that nail therapy takes months) are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
