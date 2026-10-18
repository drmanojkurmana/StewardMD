/* Acute inflammation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/inflam.mjs [--print-model]
 * Static layout here; cells, mediators and gauges move in inflam.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the response", a: [0.4, 1, 0.35, 0.8], names: ["early", "established", "resolving", "chronic"], ticks: ["early", "established", "resolving", "chronic"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "NSAID" },
    { label: "steroid" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "NSAID", "steroid"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const nsaid = drug === 1 ? 1 : 0, ster = drug === 2 ? 1 : 0;
  const trigB = [0.6, 0.9, 0.22, 0.82][level], medB = [0.55, 1, 0.28, 0.74][level], neuB = [0.35, 1, 0.22, 0.45][level];
  const macB = [0.3, 0.65, 1, 0.9][level], exB = [0.55, 1, 0.4, 0.78][level], chron = level === 3 ? 1 : 0, resol = level === 2 ? 1 : 0;
  const Hist = cl(medB * (ster ? 0.6 : 1));
  const Pg = cl(medB * (nsaid ? 0.18 : ster ? 0.3 : 1));
  const Ck = cl(medB * (ster ? 0.35 : 1));
  const Med = cl(0.35 * Hist + 0.3 * Pg + 0.35 * Ck);
  const Vas = cl(0.07 + 0.88 * (0.55 * Pg + 0.25 * Hist + 0.2 * Ck));
  const Perm = cl(0.05 + 0.9 * (0.32 * Hist + 0.42 * Pg + 0.26 * Ck));
  const Exu = cl(Perm * exB + 0.08 * medB * exB);
  const Neu = cl(neuB * (ster ? 0.28 : nsaid ? 0.9 : 1));
  const Mac = cl(macB * (ster ? 0.55 : 1));
  const Phag = cl((0.45 * Neu + 0.55 * Mac) * (ster ? 0.55 : 1) * (1 + 0.15 * resol));
  const Trig = cl(trigB * (ster ? 1.12 : 1) * (1 - 0.25 * Phag * resol));
  const Signs = cl(0.3 * Vas + 0.3 * Exu + 0.4 * Pg);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Med, 0.3, 0.6, ["low", "raised", "high"]), w(Exu, 0.3, 0.6, ["little", "moderate", "marked"]), w(Neu, 0.3, 0.6, ["few", "many", "very many"]), w(Phag, 0.3, 0.6, ["slow", "active", "brisk"])];
  return { a: S.level.a[level], nsaid, ster, chron, resol, Trig, Hist, Pg, Ck, Med, Vas, Perm, Exu, Neu, Mac, Phag, Signs, words, readout: "mediators " + words[0] + " · swelling " + words[1] + " · neutrophils " + words[2] + " · clearing " + words[3] };
}
const TESTS = [
  [1, 0, "mediators high · swelling marked · neutrophils very many · clearing brisk"],
  [1, 2, "mediators raised · swelling moderate · neutrophils few · clearing slow"],
  [2, 0, "mediators low · swelling little · neutrophils few · clearing brisk"],
  [3, 1, "mediators raised · swelling moderate · neutrophils many · clearing brisk"],
];

/* ---------------- static layout ---------------- */
const CY = 320;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="redness" class="sc-red" x="14" y="44" width="${W - 28}" height="396" rx="18" opacity="0"/>
<rect id="oedema" class="sc-oed" x="14" y="44" width="${W - 28}" height="230" rx="18" opacity="0"/>
<text class="sc-zone" x="34" y="68">INJURED OR INFECTED TISSUE</text>
<text class="sc-zone sc-dim" x="34" y="432">BLOOD VESSEL</text>
<g id="bacteria"></g>
<g id="lymph"></g>
<g id="phag"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 36}" width="${W - 28}" height="72"/>
<g id="rbcs"></g>
<g id="endo"></g>
<g id="parts"></g>
<g id="heat"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "acute-inflammation", fig: "Fig 1", title: "Acute inflammation: injury to clearing", W, H, body,
  label: "An animated injured tissue and blood vessel. A trigger such as injury or infection wakes mast cells and macrophages. They release histamine, prostaglandin and cytokines. The vessel widens and its wall leaks, so protein rich exudate forms oedema. Neutrophils marginate, leave the vessel and phagocytose the trigger. Gauges show mediators, widening, swelling, neutrophils, clearing and the cardinal signs.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "inflam.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `.sc-red{fill:var(--c-bad)}.p-hist{--cc:#f2a541}.p-pg{--cc:#38d1ff}.p-ck{--cc:var(--c-cyt)}.heat-p{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}.cl-deb{--cc:#c9b8a8}body[data-theme="light"] .cl-deb{--cc:#a08b76}`,
  sourcesLis: [
    "<strong>How acute inflammation develops.</strong> Injury or infection creates danger and microbial signals. Resident mast cells release histamine and macrophages release cytokines, while prostaglandin is made locally. Histamine, prostaglandin and cytokines widen the vessel (vasodilation) and open gaps in its wall (increased permeability). Protein rich fluid leaves as exudate and collects as oedema. Neutrophils slow and stick at the wall (margination), squeeze out (emigration), follow chemical signals and phagocytose microbes and debris. The cardinal signs are redness, heat, swelling, pain and loss of function. In resolution neutrophils die and macrophages clear them; if the trigger persists the response can become chronic with more macrophages and lymphocytes. This is standard textbook teaching in pathology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An NSAID blocks prostaglandin making, so widening, leak and pain signals fall while histamine, cytokines and phagocytosis are largely kept. A steroid broadly suppresses mediator making, neutrophil emigration and phagocytosis, so signs fall but clearing is slower and a trigger can persist. These are teaching toggles only.",
  ],
  simplified: "Complement, clotting and kinin pathways, selectins and integrins by name, fever and systemic responses, chronic granuloma and fibrosis detail, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
