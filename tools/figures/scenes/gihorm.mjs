/* Gastrointestinal hormones as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gihorm.mjs [--print-model]
 * Static layout here; hormones, acid, enzymes and gauges move in gihorm.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of a meal", a: [0, 1, 2], names: ["cephalic phase", "gastric phase", "intestinal phase"], ticks: ["cephalic", "gastric", "intestinal"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "proton pump inhibitor (PPI)" },
    { label: "somatostatin analogue" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "PPI given", "somatostatin analogue given"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ppi = drug === 1 ? 1 : 0, somaD = drug === 2 ? 1 : 0;
  const sf = somaD ? 0.30 : 1;
  const V = [0.90, 0.55, 0.25][level] * (somaD ? 0.6 : 1);
  const Hist = [0.30, 0.90, 0.30][level] * sf;
  const CCK = [0.05, 0.20, 0.95][level] * sf;
  const Sec = [0.05, 0.15, 0.90][level] * sf;
  const Incr = [0.05, 0.25, 0.95][level] * sf;
  const Soma = somaD ? 0.95 : [0.15, 0.35, 0.60][level];
  const Gas = cl([0.35, 1.00, 0.35][level] * sf * (ppi ? 1.30 : 1));
  const Acid = cl((0.50 * Gas + 0.45 * Hist + 0.30 * V) * [1, 1, 0.45][level] * (ppi ? 0.10 : 1) * (somaD ? 0.35 : 1));
  const Enz = cl(CCK * (somaD ? 0.35 : 1));
  const Bic = cl(Sec * (somaD ? 0.35 : 1));
  const GB = cl(CCK * (somaD ? 0.35 : 1));
  const Ins = cl(Incr * (somaD ? 0.30 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Acid, 0.25, 0.60, ["low", "moderate", "high"]), w(Gas, 0.30, 0.65, ["low", "moderate", "high"]), w(Enz, 0.25, 0.60, ["low", "some", "high"]), w(Ins, 0.25, 0.60, ["low", "some", "high"])];
  return { ph: level, ppi, somaD, V, Hist, CCK, Sec, Incr, Soma, Gas, Acid, Enz, Bic, GB, Ins, words, readout: "acid " + words[0] + " · gastrin " + words[1] + " · enzymes " + words[2] + " · insulin " + words[3] };
}
const TESTS = [
  [0, 0, "acid moderate · gastrin moderate · enzymes low · insulin low"],
  [1, 0, "acid high · gastrin high · enzymes low · insulin some"],
  [2, 0, "acid low · gastrin moderate · enzymes high · insulin high"],
  [1, 1, "acid low · gastrin high · enzymes low · insulin some"],
];

/* ---------------- static layout ---------------- */
const CY = 350;
const body = `
<rect class="sc-tissue" x="14" y="44" width="400" height="256" rx="16"/>
<rect class="sc-tissue" x="414" y="44" width="532" height="256" rx="16"/>
<g id="brainSlot"></g><g id="stomachSlot"></g><g id="intestSlot"></g><g id="pancSlot"></g>
<ellipse id="acidPool" class="gi-acidpool" cx="270" cy="195" rx="52" ry="38" opacity="0.5"/>
<ellipse id="bicPool" class="gi-bicpool" cx="528" cy="208" rx="38" ry="28" opacity="0.3"/>
<g id="cells"></g><g id="ducts"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 28}" width="932" height="56"/>
<text class="sc-zone sc-dim" x="30" y="${CY + 4}">BLOOD</text>
<g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-vagus{--cc:#7fc4e8}.cl-par{--cc:#e9a2b3}.cl-ecl{--cc:#f08a4b}.cl-gcell{--cc:#e8d36a}.cl-dcell{--cc:#c978c9}.cl-icell{--cc:#5ec1a0}.cl-scell{--cc:#38d1ff}.cl-kcell{--cc:#7fcf6a}.cl-lcell{--cc:#3ddc97}.cl-acinar{--cc:#f2b84a}.cl-ductc{--cc:#7ab8ff}.cl-beta{--cc:#e59a88}
.gi-acidpool{fill:#ffd24a;stroke:none}
.gi-bicpool{fill:#7ab8ff;stroke:none}
.gi-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:10;stroke-linecap:round;stroke-linejoin:round;opacity:.22}
.gi-duct{fill:none;stroke:var(--anatomy-mid);stroke-width:2.4;stroke-linecap:round;opacity:.7}
.gi-vagus{fill:none;stroke:var(--c-lymph);stroke-width:1.6;stroke-dasharray:5 4;opacity:.8}
.gi-gb{fill:color-mix(in srgb,#7fcf6a 55%,var(--anatomy-paper));stroke:#4fa63c;stroke-width:1.6}
.gi-gbneck{fill:none;stroke:#4fa63c;stroke-width:5;stroke-linecap:round}
.gi-block{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.p-gas{--cc:#e8d36a}.p-acid{--cc:#ffd24a}.p-hist{--cc:#f08a4b}.p-vag{--cc:#7fc4e8}.p-cck{--cc:#5ec1a0}.p-sec{--cc:#38d1ff}.p-bic{--cc:#7ab8ff}.p-enz{--cc:#e89a3c}.p-bile{--cc:#7fcf6a}.p-incr{--cc:#3ddc97}.p-ins{--cc:#e5484d}.p-soma{--cc:#c978c9}.p-food{--cc:#c98a5a}.p-ppi{--cc:#b678e8}.p-somad{--cc:#c978c9}
.dr-g-fill.g-gas{fill:#e8d36a}.dr-g-fill.g-acid{fill:#ffd24a}.dr-g-fill.g-enz{fill:#e89a3c}.dr-g-fill.g-bic{fill:var(--c-fl)}.dr-g-fill.g-ins{fill:var(--c-bad)}.dr-g-fill.g-soma{fill:#c978c9}
`;

buildScene({
  id: "gi-hormones-secretion", fig: "Fig 1", title: "Gastrointestinal hormones: stomach to duodenum", W, H, body, extraCss,
  label: "An animated fed-state sequence from stomach to duodenum. In the cephalic phase the brain sees food and the vagus primes stomach acid. In the gastric phase gastrin from G cells and histamine from ECL cells drive the parietal acid pump. In the intestinal phase CCK squeezes the gallbladder and drives pancreatic enzymes, secretin drives bicarbonate, and incretins release insulin from beta cells. A slider selects cephalic, gastric or intestinal phase and treatment choices are none, a proton pump inhibitor that plugs the acid pump, or a somatostatin analogue that brakes every gut signal. Gauges show gastrin, acid, enzymes, bicarbonate, insulin and somatostatin.",
  caption: "Schematic, not to scale. Particle speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "gihorm.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With somatostatin analogue",
  sourcesLis: [
    "<strong>Acid control.</strong> Sight, smell and thought of food start the cephalic phase: the brain sends vagal signals that prime parietal and G cells. Food stretching the stomach and peptides in it start the gastric phase: G cells release gastrin, which acts in blood and locally to drive parietal cells, helped by histamine from ECL cells and by vagal signals, all converging on the parietal acid pump. Somatostatin from D cells restrains gastrin, histamine and acid. This is standard teaching in physiology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Intestinal phase.</strong> Acid and fat entering the duodenum start the intestinal phase and slow the stomach. I cells release cholecystokinin (CCK), which squeezes the gallbladder and drives pancreatic enzyme secretion. S cells release secretin, which drives bicarbonate from pancreatic duct cells to neutralise acid chyme. K and L cells release incretin hormones that boost insulin release from pancreatic beta cells. A proton pump inhibitor plugs the parietal acid pump, so acid falls and gastrin rises by feedback. A somatostatin analogue brakes every gut signal: acid, enzymes, bicarbonate and insulin all fall. These are teaching toggles only.",
  ],
  simplified: "Chief cell pepsin, motility patterns in detail, enteric reflex wiring, bile chemistry, enzyme names, glucose transport and insulin action in tissues, other gut peptides such as motilin and ghrelin, and every drug dose and protocol are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
