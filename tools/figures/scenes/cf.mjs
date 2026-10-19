/* Cystic fibrosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cf.mjs [--print-model]
 * Static layout here; ions, mucus, cilia, bacteria and gauges move in cf.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of lung disease", a: [0.3, 0.62, 1], names: ["early", "established", "advanced"], ticks: ["early", "established", "advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "CFTR modulator" },
    { label: "airway clearance" },
    { label: "antibiotics" },
    { label: "modulator with clearance and antibiotics" },
  ],
  status: "Cystic fibrosis: {level} · {drug} ·",
  drugNames: ["no treatment", "a CFTR modulator", "airway clearance", "antibiotics", "combined treatment"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const mod = drug === 1 || drug === 4 ? 1 : 0, clr = drug === 2 || drug === 4 ? 1 : 0, abx = drug === 3 || drug === 4 ? 1 : 0;
  const cftr = cl(0.14 + (mod ? 0.56 : 0));
  const clSec = cftr;
  const naAbs = cl(0.92 - 0.52 * cftr);
  const asl = cl(0.06 + 0.82 * cftr - 0.18 * naAbs + 0.08);
  const muc = cl(0.12 + 0.78 * a - (mod ? 0.34 : 0) - (clr ? 0.34 : 0) - (abx ? 0.07 : 0));
  const cil = cl(0.12 + 0.62 * asl + 0.3 * (1 - muc) + (clr ? 0.08 : 0));
  const inf = cl((0.12 + 0.78 * a) * (abx ? 0.16 : 1) * (clr ? 0.62 : 1) * (mod ? 0.78 : 1));
  const dmg = cl(0.06 + 0.86 * a * a - (mod ? 0.04 : 0));
  const air = cl(1 - 0.52 * muc - 0.34 * dmg - 0.18 * inf);
  const sweat = cl(0.96 - 0.68 * cftr);
  const panc = cl(0.18 + 0.66 * a - (mod ? 0.12 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(clSec, 0.3, 0.55, ["low", "partly restored", "restored"]), w(muc, 0.32, 0.62, ["thin", "thick", "plugging"]), w(inf, 0.25, 0.55, ["low", "present", "high"]), w(air, 0.35, 0.62, ["low", "reduced", "open"])];
  return { a, mod, clr, abx, cftr, clSec, naAbs, asl, muc, cil, inf, dmg, air, sweat, panc, words, readout: "chloride secretion " + words[0] + " · mucus " + words[1] + " · Pseudomonas " + words[2] + " · airflow " + words[3] };
}
const TESTS = [
  [0, 0, "chloride secretion low · mucus thick · Pseudomonas present · airflow open"],
  [2, 0, "chloride secretion low · mucus plugging · Pseudomonas high · airflow low"],
  [2, 1, "chloride secretion restored · mucus thick · Pseudomonas high · airflow low"],
  [2, 4, "chloride secretion restored · mucus thin · Pseudomonas low · airflow reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="lumen" class="cf-lumen" x="34" y="74" width="892" height="60" rx="12"/>
<rect id="mucBand" class="cf-mucband" x="34" y="120" width="892" height="24" rx="6"/>
<rect id="asl" class="cf-asl" x="34" y="146" width="892" height="12"/>
<rect id="baseLine" class="cf-base" x="34" y="204" width="892" height="3" rx="1.5"/>
<g id="glowG"></g>
<g id="lungSlot"></g><g id="pancSlot"></g><g id="skinSlot"></g>
<g id="sysG"></g>
<g id="mucG"></g><g id="ciliaG"></g><g id="epiG"></g><g id="chanG"></g><g id="bacG"></g><g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "cystic-fibrosis", fig: "Fig 1", title: "Cystic fibrosis: faulty channel to thick mucus", W, H, body,
  label: "An animated airway lining in cystic fibrosis. A faulty CFTR chloride channel, most often from the F508del variant that misfolds the protein, lets little chloride and bicarbonate out of epithelial cells while sodium is taken up too fast. The airway surface liquid dries out, mucus thickens, cilia cannot clear it, Pseudomonas infection takes hold and the airway wall is damaged into bronchiectasis. Below, a real lung scars wide, a real pancreas keeps a plugged duct that starves the gut of enzymes, and skin leaves salt behind in sweat, all from the same channel defect. Gauges show CFTR function, surface liquid, mucus, cilia clearance, Pseudomonas and airway damage. Treatment choices include a CFTR modulator, airway clearance and antibiotics.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cf.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With combined treatment",
  sourcesLis: [
    "<strong>How cystic fibrosis develops.</strong> Variants in the CFTR gene fault an epithelial chloride and bicarbonate channel. Mutation classes range from no protein made, through misfolding and failed trafficking to the cell surface (F508del, the common class II variant), defective gating once the channel reaches the surface (class III), reduced conduction, reduced amount of protein, and reduced stability. In airway epithelium the faulty channel gives reduced chloride and bicarbonate secretion and, with sodium hyperabsorption through the epithelial sodium channel, salt and water transport goes the wrong way. The airway surface liquid that cilia beat in is dehydrated, secreted mucus is thick and sticky, mucociliary clearance fails, and infection, classically with Pseudomonas, and chronic inflammation damage the airway wall into bronchiectasis. The same exocrine channel defect blocks pancreatic ducts so enzymes fall and digestion suffers, and stops salt being reclaimed in sweat glands so sweat chloride is high, the basis of the sweat test. This is standard teaching in respiratory and general medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A CFTR modulator helps the faulty protein fold, reach the surface or open its gate, partly restoring chloride secretion and surface liquid. Airway clearance loosens and moves thick mucus out without fixing the channel. Antibiotics reduce Pseudomonas infection without fixing the channel or undoing bronchiectasis. Combined they act on channel, mucus and infection together, while established airway damage reverses little. These are teaching toggles only.",
  ],
  simplified: "The full mutation class table and variant specific modulator eligibility, newborn screening, liver and sinus disease, diabetes, fertility, nutrition and enzyme replacement in detail, other infecting organisms, exacerbation care, transplant, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-epi{--cc:#d7a48a}.cl-gob{--cc:#7fb5c9}.cl-misf{--cc:#c978c9}
body[data-theme="light"] .cl-epi{--cc:#c98a6c}body[data-theme="light"] .cl-gob{--cc:#5a9db6}
.cf-lumen{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper))}
.cf-asl{fill:color-mix(in srgb,var(--c-fl) 48%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 60%,#000);stroke-width:.6}
.cf-mucband{fill:color-mix(in srgb,#9fd0e0 80%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 80%,#000);stroke-width:.8}
.cf-base{fill:var(--anatomy-mid)}
.cf-mucus{fill:color-mix(in srgb,#9fd0e0 72%,var(--anatomy-paper));stroke:color-mix(in srgb,#5a9db6 80%,#000);stroke-width:.8}
.cl-pse{--cc:var(--c-bac)}
.p-cl{--cc:#38d1ff}.p-na{--cc:#ff9a3d}.p-water{--cc:var(--c-fl)}.p-mod{--cc:#ffd24a}.p-abx{--cc:#c084fc}.p-enz{--cc:#ffd24a}.p-salt{--cc:#ff9a3d}
.cftr-b{fill:color-mix(in srgb,var(--c-good) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-good) 60%,#000);stroke-width:.6}
.cftr-g{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.6}
.enac-p{fill:color-mix(in srgb,#ff9a3d 75%,var(--anatomy-paper));stroke:color-mix(in srgb,#ff9a3d 60%,#000);stroke-width:.6}
.cilia-l{fill:none;stroke:var(--anatomy-mid);stroke-width:1.3;stroke-linecap:round}
.cf-glow{fill:var(--c-bad);stroke:none}
.bron-dil{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.6}
.panc-d{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.cf-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.dr-g-fill.g-asl{fill:var(--c-fl)}.dr-g-fill.g-mucCF{fill:#5a9db6}.dr-g-fill.g-cil{fill:var(--c-good)}.dr-g-fill.g-dmgCF{fill:var(--c-bad)}
`,
});
