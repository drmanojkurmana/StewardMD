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
<text class="sc-zone" x="34" y="66">ACID ADDED</text>
<text class="sc-zone" x="345" y="66">BUFFER</text>
<text class="sc-zone" x="656" y="66">BICARBONATE LOST</text>
<g id="sourceG">
  <rect class="an-muscle" x="38" y="108" width="44" height="44" rx="12"/>
  <path class="an-stri" d="M48 114L48 146M60 114L60 146M72 114L72 146"/>
  <ellipse class="an-liver" cx="130" cy="130" rx="26" ry="20"/>
  <ellipse class="an-kidney" cx="200" cy="130" rx="22" ry="26"/>
  <path class="an-stri" d="M200 112C190 122 190 138 200 148"/>
  <rect class="an-bottle" x="252" y="106" width="30" height="46" rx="6"/>
  <rect class="an-bottle" x="260" y="98" width="14" height="10" rx="3"/>
</g>
<g id="bufferG">
  <circle id="bufferC" class="an-buffer" cx="480" cy="130" r="34"/>
  <text class="sc-lab" x="480" y="127" text-anchor="middle">HCO3</text>
  <text class="sc-lab" x="480" y="142" text-anchor="middle">buffer</text>
</g>
<g id="lossG">
  <ellipse class="an-gut" cx="725" cy="130" rx="32" ry="22"/>
  <path class="an-stri" d="M706 130C716 118 736 118 744 130C736 142 716 142 706 130"/>
  <ellipse class="an-kidney" cx="855" cy="130" rx="24" ry="28"/>
  <path class="an-stri" d="M855 110C844 122 844 140 855 150"/>
  <circle class="sc-p p-cl" cx="776" cy="160" r="6"/><circle class="sc-p p-cl" cx="792" cy="166" r="6"/><circle class="sc-p p-cl" cx="806" cy="158" r="6"/>
</g>
<rect id="lumen" class="sc-lumen" x="24" y="${CY - 38}" width="912" height="76"/>
<text class="sc-zone sc-dim" x="34" y="${CY + 4}">BLOOD</text>
<g id="lungsG">
  <g id="lobeL"><path class="an-lung" d="M0 -28C17 -28 26 -9 23 11C21 26 8 30 0 25C-8 30 -21 26 -23 11C-26 -9 -17 -28 0 -28Z"/><path class="an-stri" d="M0 -20L0 13M0 -4L-11 7M0 -4L11 7"/></g>
  <g id="lobeR"><path class="an-lung" d="M0 -28C17 -28 26 -9 23 11C21 26 8 30 0 25C-8 30 -21 26 -23 11C-26 -9 -17 -28 0 -28Z"/><path class="an-stri" d="M0 -20L0 13M0 -4L-11 7M0 -4L11 7"/></g>
</g>
<g id="bars"></g>
<g id="treatG">
  <g id="dialG"><rect class="an-machine" x="680" y="352" width="80" height="62" rx="10"/><circle class="an-dial" cx="720" cy="378" r="16"/><path class="an-stri" d="M694 402L746 402"/></g>
  <g id="bicG"><rect class="an-bag" x="798" y="352" width="44" height="58" rx="10"/><path class="an-stri" d="M812 352L812 342L828 342L828 352"/><text class="sc-lab" x="820" y="385" text-anchor="middle">HCO3</text></g>
</g>
<text class="sc-zone" x="34" y="338">LUNGS COMPENSATE</text>
<text class="sc-zone" x="400" y="338">ION BALANCE</text>
<text class="sc-zone" x="640" y="338">CLEARANCE</text>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.an-muscle{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1.2}
.an-liver{fill:color-mix(in srgb,#b8645a 70%,var(--anatomy-paper));stroke:#8f463c;stroke-width:1.2}
.an-kidney{fill:color-mix(in srgb,#c25a7a 65%,var(--anatomy-paper));stroke:#96405c;stroke-width:1.2}
.an-bottle{fill:color-mix(in srgb,#e8a33d 55%,var(--anatomy-paper));stroke:#b97a24;stroke-width:1.2}
.an-buffer{fill:color-mix(in srgb,#2fc2a3 42%,var(--anatomy-paper));stroke:#1f9f83;stroke-width:1.5}
.an-gut{fill:color-mix(in srgb,var(--c-eos) 55%,var(--anatomy-paper));stroke:var(--c-eos);stroke-width:1.2}
.an-lung{fill:color-mix(in srgb,var(--c-lymph) 38%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.an-machine{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.3}
.an-dial{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.an-bag{fill:color-mix(in srgb,#2fc2a3 32%,var(--anatomy-paper));stroke:#1f9f83;stroke-width:1.3}
.an-stri{fill:none;stroke:color-mix(in srgb,var(--anatomy-strong) 45%,transparent);stroke-width:1}
.an-cat{fill:#5b8def}.an-clseg{fill:#57b96a}.an-hcoseg{fill:#2fc2a3}.an-unseg{fill:#ee6a4a}
.an-bracket{fill:none;stroke:#ee6a4a;stroke-width:2}
.p-na{--cc:#5b8def}.p-cl{--cc:#57b96a}.p-hco{--cc:#2fc2a3}.p-unmeas{--cc:#ee6a4a}.p-h{--cc:#e5484d}.p-co2{--cc:#9aa3ad}.p-acid{--cc:#ff9a3d}
.dr-g-fill.g-acid{fill:#e5484d}.dr-g-fill.g-hco{fill:#2fc2a3}.dr-g-fill.g-gap{fill:#ee6a4a}.dr-g-fill.g-clg{fill:#57b96a}.dr-g-fill.g-br{fill:var(--c-lymph)}
`;

buildScene({
  id: "metabolic-acidosis-anion-gap", fig: "Fig 1", title: "Metabolic acidosis and the anion gap", W, H, body, extraCss,
  label: "An animated diagram of metabolic acidosis. On the left, added acid from lactate, ketones, uraemia and toxins brings unmeasured anions. In the centre, bicarbonate buffers hydrogen ions. On the right, bicarbonate is lost from the gut or kidney tubule and chloride rises to fill the gap, so the anion gap stays normal. Below, the lungs breathe deeply to blow off carbon dioxide, and an ion balance diagram shows measured cations against chloride, bicarbonate and unmeasured anions. Treatment choices are treating the cause, giving bicarbonate, and dialysis. Gauges show acidosis, bicarbonate, anion gap, chloride and breathing.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "anion.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>What the gap means.</strong> Blood is electrically neutral: measured cations (mainly sodium) exceed the measured anions (chloride plus bicarbonate) by a small amount, the anion gap, which is mostly unmeasured anions such as albumin and phosphate. When an acid is added (lactate in shock, ketones in diabetic ketoacidosis, acids retained in kidney failure, or toxins such as methanol and salicylate), its hydrogen ions are buffered by bicarbonate, which falls, while its unmeasured anion remains, so the gap widens: a high anion gap acidosis. When bicarbonate is lost instead (diarrhoea, renal tubular acidosis, or other gut or kidney losses), chloride rises to keep neutrality, so the gap stays normal: a normal anion gap, or hyperchloraemic, acidosis. Mixed patterns occur when both happen. The lungs compensate with deep, faster breathing that blows off carbon dioxide. This is standard teaching in medicine, renal and critical-care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Treating the cause (restoring perfusion, insulin for ketoacidosis, stopping a toxin, treating diarrhoea), giving bicarbonate as a buffer in selected cases, and dialysis to clear retained acids and toxins and restore bicarbonate. They are teaching toggles that show which step each acts on, not advice for any patient.",
  ],
  simplified: "Albumin and phosphate as the usual gap, the delta ratio and other mixed-disorder calculations, urine anion and osmolal gaps, respiratory and renal compensation over days, specific toxin antidotes, and all doses, targets and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
