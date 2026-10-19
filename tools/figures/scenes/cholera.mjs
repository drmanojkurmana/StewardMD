/* Cholera as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cholera.mjs [--print-model]
 * Static layout here; vibrios, toxin, cAMP, CFTR secretion, stool flow and gauges move in cholera.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of fluid loss", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "oral rehydration solution (ORS)" },
    { label: "antibiotic" },
    { label: "intravenous fluids" },
  ],
  status: "Dehydration: {level} · {drug} ·",
  drugNames: ["no treatment", "ORS", "an antibiotic", "intravenous fluids"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], ors = drug === 1 ? 1 : 0, abx = drug === 2 ? 1 : 0, iv = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const V = cl(a * (abx ? 0.5 : 1));
  const Camp = cl(0.05 + 0.9 * V);
  const Sec = cl(0.05 + 0.9 * Camp);
  const Loss = cl(0.05 + 0.85 * Sec);
  const Abs = cl(0.5 + ors * 0.42);
  const D = cl(0.04 + 0.88 * Loss - ors * 0.38 - iv * 0.58 - abx * 0.12 * Loss);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Sec, 0.4, 0.7, ["low", "raised", "high"]), w(Loss, 0.4, 0.7, ["mild", "moderate", "heavy"]), w(D, 0.38, 0.65, ["none", "some", "severe"])];
  return { a, ors, iv, abx, V, Camp, Sec, Loss, Abs, D, words, readout: "secretion " + words[0] + " · stool loss " + words[1] + " · dehydration " + words[2] };
}
const TESTS = [
  [2, 0, "secretion high · stool loss heavy · dehydration severe"],
  [2, 1, "secretion high · stool loss heavy · dehydration some"],
  [2, 3, "secretion high · stool loss heavy · dehydration none"],
  [1, 2, "secretion low · stool loss mild · dehydration none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="cho-lumen" x="28" y="72" width="808" height="72" rx="12"/>
<path id="orsFlowA" class="cho-orsflow" d="M320 224 C330 250 390 252 448 248"/>
<path id="orsFlowB" class="cho-orsflow" d="M460 224 L469 243"/>
<path id="orsFlowC" class="cho-orsflow" d="M600 224 C590 250 540 252 492 248"/>
<g id="glowG"><ellipse id="dehyHalo" class="cho-halo" cx="470" cy="325" rx="86" ry="100" opacity="0"/></g>
<g id="bowelSlot"></g>
<g id="vesselSlot"></g>
<rect class="cho-pipe" x="800" y="144" width="36" height="170"/>
<path class="cho-beaker" d="M772 314h104l-11 78h-82z"/>
<rect id="stool" class="cho-stool" x="784" y="380" width="70" height="8" rx="3"/>
<g id="bagG" opacity="0">
<rect class="cho-bag" x="352" y="268" width="46" height="58" rx="8"/>
<rect class="cho-bagfl" x="357" y="290" width="36" height="31" rx="5"/>
<path class="cho-tube" d="M375 326 C375 348 400 350 427 342"/>
</g>
<g id="cells"></g><g id="parts"></g><g id="rbcs"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-ent{--cc:#e9c07a}.cl-vib{--cc:var(--c-bac)}
.cho-lumen{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-mid));stroke-width:1}
.cho-pipe{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper))}
.cho-beaker{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.cho-stool{fill:var(--c-fl);opacity:.75}
.cho-sglt{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.cho-cftr{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 55%,#000);stroke-width:.8}
.cho-villi{fill:none;stroke:color-mix(in srgb,#e9c07a 70%,#000);stroke-width:1.1;stroke-linecap:round}
.cho-orsflow{fill:none;stroke:var(--c-good);stroke-width:9;stroke-linecap:round;opacity:0}
.cho-bag{fill:color-mix(in srgb,var(--anatomy-paper) 80%,var(--c-fl));stroke:var(--anatomy-mid);stroke-width:1.2}
.cho-bagfl{fill:var(--c-fl);stroke:none}
.cho-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:2.5}
.cho-halo{fill:var(--c-bad);stroke:none}
.cho-gp{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 55%,#000);stroke-width:.7}
.cho-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-tox{--cc:#ff9a3d}.p-camp{--cc:#c084fc}.p-cl{--cc:#38d1ff}.p-na{--cc:#b27af0}.p-glu{--cc:#e8d36a}.p-ors{fill:var(--c-fl)}.p-abx{--cc:#c084fc}
.dr-g-fill.g-col{fill:var(--c-bac)}.dr-g-fill.g-camp{fill:#c084fc}.dr-g-fill.g-sec{fill:#38d1ff}.dr-g-fill.g-loss{fill:var(--c-fl)}.dr-g-fill.g-deh{fill:var(--c-bad)}
`;

buildScene({
  id: "cholera", fig: "Fig 1", title: "Cholera: toxin, secretion and dehydration", W, H, body, extraCss,
  label: "An animated cross-section of small bowel wall above a real small bowel and a blood vessel. Vibrio cholerae colonises the surface without invading it. Cholera toxin enters the wall, locks a stimulatory G protein on and cyclic AMP rises, opening CFTR salt gates so salt and water pour into the lumen as profuse rice-water stool. The slider sets mild, moderate or severe fluid loss. Oral rehydration solution uses the SGLT route to pull salt and water back into blood, an antibiotic kills the vibrios so the signal fades, and a drip refills the blood directly. Gauges show colonisation, cAMP, secretion, stool loss and dehydration.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, volumes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cholera.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With IV fluids",
  sourcesLis: [
    "<strong>How cholera causes diarrhoea.</strong> Vibrio cholerae is swallowed, survives to the small bowel and colonises the enterocyte surface without invading it. Cholera toxin enters the enterocyte and locks a stimulatory G protein in its active form, so adenylate cyclase stays on and cyclic AMP rises. Cyclic AMP opens CFTR chloride channels on the luminal membrane and reduces sodium chloride absorption. Chloride leaves into the lumen, sodium and water follow, and the result is profuse watery rice-water stool with rapid dehydration. This is standard teaching in medicine, physiology and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oral rehydration solution uses sodium glucose co-transport, which cyclic AMP does not switch off, to pull sodium and water back into the blood. An antibiotic can shorten the illness and reduce bacterial shedding in cholera, but it does not replace lost fluid. Intravenous fluids refill the circulation directly when dehydration is severe or drinking is not possible. These are teaching toggles only.",
  ],
  simplified: "Gastric acid defence, toxin subunit structure in detail, other chloride and sodium transporters, potassium and bicarbonate loss, dehydration examination signs and fluid calculations, ORS composition, resistant organisms, vaccination, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
