/* Urinary tract infection as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/uti.mjs [--print-model]
 * Static layout here; bacteria, urine flow and gauges move in uti.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How far the infection has reached", a: [0.35, 0.7, 1], names: ["cystitis", "pyelonephritis", "urosepsis"], ticks: ["cystitis", "pyelonephritis", "urosepsis"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotic" },
    { label: "fluids" },
    { label: "relieve obstruction" },
    { label: "antibiotic with fluids and relieve obstruction" },
  ],
  status: "Infection: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotic", "fluids", "relieve obstruction", "antibiotic with fluids and relieve obstruction"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], abx = drug === 1 || drug === 4 ? 1 : 0, flu = drug === 2 || drug === 4 ? 1 : 0, rel = drug === 3 || drug === 4 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const obst = rel ? 0.05 : 0.55;
  const B = cl(a * (abx ? 0.12 : 1) * (rel ? 0.55 : 1));
  const I = cl(0.08 + 0.88 * B);
  const K = cl(level === 0 ? 0.1 * B : 0.22 + 0.68 * B);
  const Sys = cl(level === 2 ? 0.18 + 0.72 * K : 0.04 + 0.18 * K);
  const Flow = cl(0.9 - 0.3 * obst - 0.15 * a + flu * 0.25 + rel * 0.15);
  const BP = cl(0.96 - 0.75 * Sys + flu * 0.18);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.5, ["controlled", "present", "spreading"]), w(I, 0.25, 0.55, ["calm", "inflamed", "very inflamed"]), w(K, 0.2, 0.5, ["spared", "involved", "heavily involved"]), w(BP, 0.45, 0.68, ["low", "borderline", "maintained"])];
  return { a, abx, flu, rel, obst, B, I, K, Sys, Flow, BP, words, readout: "bacteria " + words[0] + " · bladder " + words[1] + " · kidney " + words[2] + " · blood pressure " + words[3] };
}
const TESTS = [
  [0, 0, "bacteria present · bladder inflamed · kidney spared · blood pressure maintained"],
  [2, 0, "bacteria spreading · bladder very inflamed · kidney heavily involved · blood pressure low"],
  [2, 4, "bacteria controlled · bladder calm · kidney involved · blood pressure maintained"],
  [1, 1, "bacteria controlled · bladder calm · kidney involved · blood pressure maintained"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">URINARY TRACT</text>
<path class="ut-vessel" d="M180 60 C360 48 640 48 890 62"/>
<g id="kidneys">
  <path class="ut-kidney" d="M260 78 C225 78 205 105 210 132 C215 160 240 178 268 172 C292 167 302 148 296 132 C302 112 292 78 260 78Z"/>
  <path id="kidLglow" class="ut-glow" d="M260 78 C225 78 205 105 210 132 C215 160 240 178 268 172 C292 167 302 148 296 132 C302 112 292 78 260 78Z" opacity="0"/>
  <path class="ut-kidney" d="M700 78 C735 78 755 105 750 132 C745 160 720 178 692 172 C668 167 658 148 664 132 C658 112 668 78 700 78Z"/>
  <path id="kidRglow" class="ut-glow" d="M700 78 C735 78 755 105 750 132 C745 160 720 178 692 172 C668 167 658 148 664 132 C658 112 668 78 700 78Z" opacity="0"/>
</g>
<path class="ut-ureter" d="M292 158 C340 210 390 240 430 272"/>
<path class="ut-ureter" d="M668 158 C620 210 570 240 530 272"/>
<path class="ut-ureterIn" d="M292 158 C340 210 390 240 430 272"/>
<path class="ut-ureterIn" d="M668 158 C620 210 570 240 530 272"/>
<g id="stoneG"><circle id="stone" class="ut-stone" cx="612" cy="212" r="10"/><path class="ut-stoneL" d="M606 206 L618 218 M618 206 L606 218"/></g>
<g id="bladderG">
  <path id="bladderWall" class="ut-bladder" d="M480 248 C545 248 588 285 582 332 C576 378 535 402 480 402 C425 402 384 378 378 332 C372 285 415 248 480 248Z"/>
  <path id="bladderIn" class="ut-bladderIn" d="M480 262 C532 262 568 292 563 330 C558 366 525 388 480 388 C435 388 402 366 397 330 C392 292 428 262 480 262Z"/>
</g>
<path class="ut-urethra" d="M462 398 L460 438 M498 398 L500 438"/>
<path class="ut-cath" d="M452 438 C450 400 452 360 458 330"/>
<g id="flow"></g><g id="bac"></g><g id="wbc"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "urinary-tract-infection", fig: "Fig 1", title: "Urinary tract infection: ascent to the kidney", W, H, body,
  label: "An animated urinary tract. Bacteria enter the urethra, climb to the bladder and stick to its wall with fimbriae, causing cystitis. They may climb the ureters to the kidney, causing pyelonephritis, and in urosepsis affect blood pressure. Urine flow flushes bacteria out. Obstruction and a catheter help bacteria persist. Gauges show bacteria, bladder inflammation, kidney involvement, urine flow and blood pressure. Treatment choices include an antibiotic, fluids and relieving obstruction.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "uti.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How urinary infection develops.</strong> Bacteria from around the urethral opening climb the urethra to the bladder. Hair-like fimbriae help them stick to the bladder wall so urine does not wash them away, and the inflamed bladder causes cystitis. Bacteria may then climb a ureter to the kidney, causing pyelonephritis, and severe infection can enter the bloodstream as urosepsis with falling blood pressure. This is standard teaching in medicine and microbiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Host defences and risk factors shown.</strong> A steady urine flow and regular bladder emptying flush bacteria out. Blockage of urine flow (obstruction) and a urinary catheter help bacteria persist and climb. Treatment ideas shown are an antibiotic, fluids to support urine flow and circulation, and relieving obstruction. These are teaching toggles only.",
  ],
  simplified: "Vesicoureteric reflux, pregnancy, diabetes, prostate enlargement detail, stones by type, organism species, bladder immune signalling, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ut-kidney{fill:color-mix(in srgb,var(--c-rbc) 38%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.2}
.ut-glow{fill:var(--c-bad);stroke:none}
.ut-ureter{fill:none;stroke:color-mix(in srgb,var(--c-endo) 70%,#000);stroke-width:13;stroke-linecap:round}
.ut-ureterIn{fill:none;stroke:color-mix(in srgb,var(--c-fl) 22%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round}
.ut-bladder{fill:color-mix(in srgb,var(--c-endo) 42%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 65%,#000);stroke-width:2}
.ut-bladderIn{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:none}
.ut-urethra{fill:none;stroke:var(--c-endo);stroke-width:3;stroke-linecap:round}
.ut-cath{fill:none;stroke:var(--anatomy-mid);stroke-width:3.4;stroke-linecap:round;opacity:.85}
.ut-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:5;stroke-linecap:round;opacity:.55}
.ut-stone{fill:#d9c27a;stroke:#8a742f;stroke-width:1}
.ut-stoneL{stroke:#8a742f;stroke-width:1}
.ut-fimb{stroke:color-mix(in srgb,var(--c-bac) 60%,#000);stroke-width:.7;stroke-linecap:round}
.g-flow{fill:var(--c-fl)}.g-kid{fill:var(--c-bad)}
`,
});
