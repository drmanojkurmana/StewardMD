/* Metabolic acidosis and the anion gap as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/anion.mjs [--print-model]
 * Static layout here; particles, breathing, ion bars and gauges move in anion.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of acidosis", a: [0, 1, 2], names: ["high anion gap", "normal anion gap", "mixed (both)"], ticks: ["high gap", "normal gap", "mixed"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "treat the cause" },
    { label: "bicarbonate (given)" },
    { label: "dialysis" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "cause treated", "bicarbonate given", "dialysis"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const src = [1, 0.08, 0.8][t], loss = [0.05, 1, 0.8][t];
  const cause = drug === 1 ? 1 : 0, bic = drug === 2 ? 1 : 0, dial = drug === 3 ? 1 : 0;
  const effSrc = src * (cause ? 0.18 : 1) * (dial ? 0.32 : 1);
  const effLoss = loss * (cause ? 0.25 : 1) * (dial ? 0.4 : 1);
  const U = cl(0.08 + 0.82 * effSrc);
  const HCO = cl(0.88 - 0.52 * effSrc - 0.52 * effLoss + (bic ? 0.42 : 0) + (dial ? 0.22 : 0));
  const Cl = cl(0.3 + 0.55 * effLoss - 0.12 * effSrc - (bic ? 0.05 : 0));
  const A = cl(0.08 + 0.6 * effSrc + 0.48 * effLoss - (bic ? 0.38 : 0) - (dial ? 0.15 : 0));
  const Br = cl(0.12 + 0.82 * A);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.3, 0.6, ["mild", "moderate", "severe"]), w(HCO, 0.35, 0.65, ["low", "reduced", "maintained"]), w(U, 0.3, 0.6, ["normal", "raised", "high"]), w(Cl, 0.4, 0.65, ["normal", "raised", "high"])];
  return { type: t, drug, src, loss, effSrc, effLoss, cause, bic, dial, U, HCO, Cl, A, Br, words, readout: "acidosis " + words[0] + " · bicarbonate " + words[1] + " · anion gap " + words[2] + " · chloride " + words[3] };
}
const TESTS = [
  [0, 0, "acidosis severe · bicarbonate low · anion gap high · chloride normal"],
  [1, 0, "acidosis severe · bicarbonate low · anion gap normal · chloride high"],
  [2, 0, "acidosis severe · bicarbonate low · anion gap high · chloride raised"],
  [0, 2, "acidosis moderate · bicarbonate maintained · anion gap high · chloride normal"],
];

/* ---------------- static layout ---------------- */
const CY = 266;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="srcMuscleSlot"></g>
<g id="srcLiverSlot"></g>
<g id="srcKidneySlot"></g>
<g id="lossBowelSlot"></g>
<g id="lossKidneySlot"></g>
<path id="vesSrcM" class="an-vessel" d=""/>
<path id="vesSrcL" class="an-vessel" d=""/>
<path id="vesSrcK" class="an-vessel" d=""/>
<path id="vesLossB" class="an-vessel2" d=""/>
<path id="vesLossK" class="an-vessel2" d=""/>
<g id="bufferG">
  <circle id="bufferHalo" class="an-halo" cx="480" cy="130" r="45"/>
  <circle id="bufferC" class="an-buffer" cx="480" cy="130" r="34"/>
  <text class="sc-lab" x="480" y="127" text-anchor="middle">HCO3</text>
  <text class="sc-lab" x="480" y="142" text-anchor="middle">buffer</text>
</g>
<rect id="lumen" class="sc-lumen" x="24" y="${CY - 38}" width="912" height="76"/>
<rect id="acidWash" class="an-wash" x="24" y="${CY - 38}" width="912" height="76" rx="8"/>
<g id="lungSlotL"></g>
<g id="lungSlotR"></g>
<g id="bars"></g>
<g id="treatG">
  <path id="dialTube" class="an-dtube" d="M720 306L720 350"/>
  <g id="dialG"><rect class="an-machine" x="680" y="352" width="80" height="62" rx="10"/><circle class="an-dial" cx="720" cy="378" r="16"/><path id="dialSpoke" class="an-spoke" d="M720 378L720 367"/><path class="an-stri" d="M694 402L746 402"/></g>
  <path id="bicTube" class="an-btube" d="M820 350L820 306"/>
  <g id="bicG"><rect class="an-bag" x="798" y="352" width="44" height="58" rx="10"/><path class="an-stri" d="M812 352L812 342L828 342L828 352"/><text class="sc-lab" x="820" y="385" text-anchor="middle">HCO3</text></g>
</g>
<g id="seals" opacity="0">
  <g class="an-seal"><circle cx="90" cy="132" r="11"/><path d="M84 126L96 138M96 126L84 138"/></g>
  <g class="an-seal"><circle cx="195" cy="128" r="11"/><path d="M189 122L201 134M201 122L189 134"/></g>
  <g class="an-seal"><circle cx="290" cy="130" r="10"/><path d="M284 124L296 136M296 124L284 136"/></g>
  <g class="an-seal"><circle cx="725" cy="130" r="12"/><path d="M717 122L733 138M733 122L717 138"/></g>
  <g class="an-seal"><circle cx="862" cy="130" r="10"/><path d="M856 124L868 136M868 124L856 136"/></g>
</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.an-buffer{fill:color-mix(in srgb,#2fc2a3 42%,var(--anatomy-paper));stroke:#1f9f83;stroke-width:1.5}
.an-halo{fill:none;stroke:var(--c-fl);stroke-width:2;opacity:0}
.an-vessel{fill:none;stroke:color-mix(in srgb,#ee6a4a 60%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.5}
.an-vessel2{fill:none;stroke:color-mix(in srgb,#57b96a 60%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.5}
.an-wash{fill:#e5484d;stroke:none;opacity:.1}
.an-dtube{fill:none;stroke:var(--c-fl);stroke-width:7;stroke-linecap:round;opacity:.15}
.an-btube{fill:none;stroke:#2fc2a3;stroke-width:5;stroke-linecap:round;opacity:.15}
.an-spoke{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round;opacity:.3}
.an-seal circle{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:2.5}
.an-seal path{fill:none;stroke:var(--c-bad);stroke-width:2.5;stroke-linecap:round}
.an-machine{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.3}
.an-dial{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.an-bag{fill:color-mix(in srgb,#2fc2a3 32%,var(--anatomy-paper));stroke:#1f9f83;stroke-width:1.3}
.an-stri{fill:none;stroke:color-mix(in srgb,var(--anatomy-strong) 45%,transparent);stroke-width:1}
.an-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.an-cat{fill:#5b8def}.an-clseg{fill:#57b96a}.an-hcoseg{fill:#2fc2a3}.an-unseg{fill:#ee6a4a}
.an-bracket{fill:none;stroke:#ee6a4a;stroke-width:2}
.p-na{--cc:#5b8def}.p-cl{--cc:#57b96a}.p-hco{--cc:#2fc2a3}.p-unmeas{--cc:#ee6a4a}.p-h{--cc:#e5484d}.p-co2{--cc:#9aa3ad}
.dr-g-fill.g-acid{fill:#e5484d}.dr-g-fill.g-hco{fill:#2fc2a3}.dr-g-fill.g-gap{fill:#ee6a4a}.dr-g-fill.g-clg{fill:#57b96a}.dr-g-fill.g-br{fill:var(--c-lymph)}
`;

buildScene({
  id: "metabolic-acidosis-anion-gap", fig: "Fig 1", title: "Metabolic acidosis and the anion gap", W, H, body, extraCss,
  label: "An animated diagram of metabolic acidosis. On the left, muscle, liver and a failing kidney add acid. In the centre, a bicarbonate buffer soaks acid up. On the right, bowel and kidney tubule lose bicarbonate while chloride rises, so the gap stays normal. Below, blood carries the ions, the lungs breathe deeply to blow off carbon dioxide, and bars show the ion balance. Treating the cause seals the sources, bicarbonate fluid flows in from a bag, and dialysis pulls acid anions into the machine. A slider sets the pattern and a caption explains each state.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "anion.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With dialysis",
  sourcesLis: [
    "<strong>What the gap means.</strong> Blood is electrically neutral: measured cations (mainly sodium) exceed the measured anions (chloride plus bicarbonate) by a small amount, the anion gap, which is mostly unmeasured anions such as albumin and phosphate. When an acid is added (lactate in shock, ketones in diabetic ketoacidosis, acids retained in kidney failure, or toxins such as methanol and salicylate), its hydrogen ions are buffered by bicarbonate, which falls, while its unmeasured anion remains, so the gap widens: a high anion gap acidosis. When bicarbonate is lost instead (diarrhoea, renal tubular acidosis, or other gut or kidney losses), chloride rises to keep neutrality, so the gap stays normal: a normal anion gap, or hyperchloraemic, acidosis. Mixed patterns occur when both happen. The lungs compensate with deep, faster breathing that blows off carbon dioxide. This is standard teaching in medicine, renal and critical-care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Treating the cause (restoring perfusion, insulin for ketoacidosis, stopping a toxin, treating diarrhoea), giving bicarbonate as a buffer in selected cases, and dialysis to clear retained acids and toxins and restore bicarbonate. They are teaching toggles that show which step each acts on, not advice for any patient.",
  ],
  simplified: "Albumin and phosphate as the usual gap, the delta ratio and other mixed-disorder calculations, urine anion and osmolal gaps, respiratory and renal compensation over days, specific toxin antidotes, and all doses, targets and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
