/* Intestinal protozoa as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/amoeb.mjs [--print-model]
 * Static layout here; cysts, trophozoites, Giardia, ulcers, abscess and gauges move in amoeb.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease shown", a: [0, 1, 2], names: ["amoebic colitis", "liver abscess", "giardiasis"], ticks: ["colitis", "liver abscess", "giardiasis"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "metronidazole (tissue agent)" },
    { label: "luminal agent (clears the bowel lumen)" },
    { label: "combined treatment and drainage if needed" },
  ],
  status: "Disease: {level} · {drug} ·",
  drugNames: ["no treatment", "metronidazole", "a luminal agent", "combined treatment with drainage if needed"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const basePar = [0.9, 0.85, 0.9][t], baseInj = [0.85, 0.95, 0.3][t], baseGut = [0.9, 0.45, 0.9][t];
  const effPar = [[0, 0, 0], [0.85, 0.85, 0.8], [0.5, 0.15, 0.55], [0.92, 0.9, 0.85]][drug][t];
  const effInj = [[0, 0, 0], [0.75, 0.7, 0.7], [0.35, 0.1, 0.45], [0.8, 0.88, 0.75]][drug][t];
  const effGut = [[0, 0, 0], [0.7, 0.55, 0.75], [0.55, 0.4, 0.5], [0.82, 0.75, 0.8]][drug][t];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Par = cl(basePar * (1 - effPar)), Inj = cl(baseInj * (1 - effInj)), Gut = cl(baseGut * (1 - effGut));
  const Sev = cl(0.42 * Par + 0.38 * Inj + 0.2 * Gut);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Par, 0.3, 0.6, ["low", "moderate", "high"]), w(Inj, 0.3, 0.6, ["little", "some", "marked"]), w(Gut, 0.3, 0.6, ["mild", "moderate", "severe"]), w(Sev, 0.3, 0.6, ["mild", "moderate", "severe"])];
  return { type: t, drug, Par, Inj, Gut, Sev, words, readout: "parasites " + words[0] + " · tissue injury " + words[1] + " · gut upset " + words[2] + " · severity " + words[3] };
}
const TESTS = [
  [0, 0, "parasites high · tissue injury marked · gut upset severe · severity severe"],
  [0, 1, "parasites low · tissue injury little · gut upset mild · severity mild"],
  [1, 2, "parasites high · tissue injury marked · gut upset mild · severity severe"],
  [2, 1, "parasites low · tissue injury little · gut upset mild · severity mild"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-amb{--cc:#e8845a}.cl-gia{--cc:#3fb3a3}.cl-epi{--cc:#e9c07a}
.am-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.am-ulcer{fill:color-mix(in srgb,var(--c-bad) 62%,#5a1f1f);stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:1.2}
.am-abscess{fill:#7a3b2e;stroke:#4a2018;stroke-width:1.4}
.am-portal{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 65%,var(--anatomy-mid));stroke-width:12;stroke-linecap:round;opacity:.55}
.am-villus{fill:color-mix(in srgb,#e9c07a 62%,var(--anatomy-paper));stroke:color-mix(in srgb,#e9c07a 60%,#000);stroke-width:.8}
.am-cyst{fill:#cfe8a8;stroke:color-mix(in srgb,#7fae4c 60%,#000);stroke-width:1.4}
.am-cystn{fill:#5c7a34}
.am-disc{fill:#2a7a6e;stroke:#174f46;stroke-width:.7}
.am-fat{fill:#f2d27a;stroke:color-mix(in srgb,#d9a92c 55%,#000);stroke-width:.6}
.am-debris{fill:#d9a08a}
.am-beaker{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.am-stool{fill:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper))}
.am-stoolok{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper))}
.am-stoolg{fill:#f2d27a;opacity:.85}
.am-drain{fill:none;stroke:var(--anatomy-hi);stroke-width:3;stroke-linecap:round}
.p-blood{fill:var(--c-bad)}.p-fatp{fill:#f2d27a;stroke:color-mix(in srgb,#d9a92c 55%,#000);stroke-width:.5}
.p-metro{--cc:var(--c-good)}.p-lum{--cc:var(--c-fl)}
.mk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dr-g-fill.g-par{fill:var(--c-bac)}.dr-g-fill.g-inj{fill:var(--c-bad)}.dr-g-fill.g-gut{fill:var(--c-fl)}.dr-g-fill.g-sev{fill:var(--c-plt)}
`;

buildScene({
  id: "amoebiasis-giardiasis", fig: "Fig 1", title: "Intestinal protozoa: amoebiasis and giardiasis", W, H, body, extraCss,
  label: "An animated comparison of intestinal protozoa. In amoebic colitis, cysts of Entamoeba histolytica are swallowed, trophozoites invade the colon and make flask shaped ulcers with bloody dysentery. In liver abscess, trophozoites travel in portal blood to the liver and form an abscess of anchovy paste material. In giardiasis, Giardia attaches to the duodenum, blunts villi and causes malabsorption with greasy stool. The level slider switches the disease shown. Treatments are metronidazole, a luminal agent, and combined treatment with drainage only rarely. Gauges show parasites, tissue injury, gut upset and severity.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, volumes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "amoeb.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With combined treatment",
  sourcesLis: [
    "<strong>Entamoeba histolytica.</strong> Infection follows swallowing mature cysts in food or water contaminated with feces, or by fecal oral contact. Cysts excyst in the small bowel and trophozoites reach the colon. Many infections stay in the lumen without symptoms, and stool tests including antigen and nucleic acid tests (NAATs) help tell invasive species apart. When trophozoites attach to and digest the colonic lining they invade the epithelium, recruit inflammation and undermine the surface, making flask shaped ulcers. That gives abdominal pain and bloody, frequent small volume stool (amoebic dysentery), which can become severe with perforation in vulnerable persons. Trophozoites can also enter portal blood and reach the liver, where a usually single abscess forms. Its centre is acellular necrotic material likened to anchovy paste, with trophozoites at the rim rather than in the centre. This is standard teaching in medicine, microbiology and infectious disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Giardia.</strong> Giardia cysts are swallowed in contaminated water or food or by fecal oral spread, excyst in the small bowel, and trophozoites attach to the duodenal lining with a ventral sucking disc. They do not invade the epithelium. Coating of the surface, villus blunting and disturbed fat absorption give bloating, cramps and bulky, greasy, offensive stool (steatorrhoea) with malabsorption, although many infected persons have no symptoms. Stool antigen and NAATs are commonly used because cysts and trophozoites are shed unevenly. Other intestinal protozoa such as Cryptosporidium, whose oocysts resist chlorination and can cause severe watery diarrhoea in immunocompromised persons, are mentioned here only to place the group and are not drawn. This summary was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Metronidazole is shown as a tissue agent that kills invasive trophozoites in the colon wall and liver and also acts against Giardia. A luminal agent is shown clearing parasites and cysts that remain in the bowel lumen after tissue treatment, which matters in amoebiasis to stop relapse and spread. Drainage of a liver abscess is shown as rarely needed, reserved for selected large, left sided, complicated or poorly responding abscesses alongside drug treatment. These are teaching toggles only.",
  ],
  simplified: "Cyst and trophozoite nuclear detail, excystation steps, lectin attachment and protease mechanisms in molecular detail, fulminant colitis and perforation, brain and other rare spread, full differential diagnosis of dysentery and liver abscess, Cryptosporidium and other protozoa in full, drug choices in pregnancy and childhood, and all doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
