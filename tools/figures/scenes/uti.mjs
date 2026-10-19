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
    { label: "antibiotic with fluids and relief" },
  ],
  status: "Infection: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotic", "fluids", "relieve obstruction", "antibiotic with fluids and relief"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], abx = drug === 1 || drug === 4 ? 1 : 0, flu = drug === 2 || drug === 4 ? 1 : 0, rel = drug === 3 || drug === 4 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const obst = rel ? 0.05 : 0.55;
  const B = cl(a * (abx ? 0.12 : 1) * (rel ? 0.45 : 1));
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
/* Organ art is placed into the slots by uti.page.js; ureter paths, halos and
 * the stone are repositioned there from the organ ports so every vessel and
 * particle route meets real anatomy. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="bloodV" class="ut-vessel" d="M180 60 C360 48 640 48 890 62"/>
<ellipse id="kidLhalo" class="ut-halo" cx="250" cy="135" rx="80" ry="90" opacity="0"/>
<ellipse id="kidRhalo" class="ut-halo" cx="710" cy="135" rx="80" ry="90" opacity="0"/>
<ellipse id="bladderHalo" class="ut-halo" cx="480" cy="320" rx="100" ry="100" opacity="0"/>
<path id="ureterL" class="ut-ureter" d="M275 170 C275 215 430 195 430 250"/>
<path id="ureterR" class="ut-ureter" d="M685 170 C685 215 530 195 530 250"/>
<path id="ureterLIn" class="ut-ureterIn" d="M275 170 C275 215 430 195 430 250"/>
<path id="ureterRIn" class="ut-ureterIn" d="M685 170 C685 215 530 195 530 250"/>
<g id="stoneG"><circle id="stone" class="ut-stone" cx="0" cy="0" r="10"/><path class="ut-stoneL" d="M-6 -6 L6 6 M6 -6 L-6 6"/></g>
<g id="kidLSlot"></g><g id="kidRSlot"></g><g id="bladderSlot"></g>
<g id="flow"></g><g id="bac"></g><g id="wbc"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "urinary-tract-infection", fig: "Fig 1", title: "Urinary tract infection: ascent to the kidney", W, H, body,
  label: "An animated urinary tract, read top to bottom. Bacteria enter at the urethra and climb to the bladder, sticking to its wall so urine cannot wash them away. They may climb a ureter to the kidney, and severe infection can enter the blood and lower blood pressure. Urine flows from kidney to bladder to exit and flushes bacteria out, while a stone blocking a ureter slows the flow. Watch each treatment act: antibiotic capsules arrive and bacteria die off, fluids surge and wash bacteria down, relief of the blockage clears the stone and restores flow.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "uti.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antibiotic, fluids and relief",
  sourcesLis: [
    "<strong>How urinary infection develops.</strong> Bacteria from around the urethral opening climb the urethra to the bladder. Hair-like threads help them stick to the bladder wall so urine does not wash them away, and the inflamed bladder causes cystitis. Bacteria may then climb a ureter to the kidney, causing kidney infection, and severe infection can enter the bloodstream with falling blood pressure. This is standard teaching in medicine and microbiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Host defences and risk factors shown.</strong> A steady urine flow and regular bladder emptying flush bacteria out. A stone blocking urine flow helps bacteria persist and climb. Treatment ideas shown are an antibiotic that kills bacteria, fluids that support urine flow and circulation, and relief of the blockage that restores flow. These are teaching toggles only.",
  ],
  simplified: "Vesicoureteric reflux, pregnancy, diabetes, prostate enlargement detail, stones by type, organism species, bladder immune signalling, catheters, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ut-ureter{fill:none;stroke:color-mix(in srgb,var(--c-endo) 70%,#000);stroke-width:13;stroke-linecap:round}
.ut-ureterIn{fill:none;stroke:color-mix(in srgb,var(--c-fl) 22%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round}
.ut-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:5;stroke-linecap:round;opacity:.55}
.ut-halo{fill:var(--c-bad);stroke:none}
.ut-stone{fill:#d9c27a;stroke:#8a742f;stroke-width:1}
.ut-stoneL{fill:none;stroke:#8a742f;stroke-width:1}
.ut-fimb{fill:none;stroke:color-mix(in srgb,var(--c-bac) 60%,#000);stroke-width:.7;stroke-linecap:round}
.ut-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-kill{--cc:var(--c-ab)}
.g-flow{fill:var(--c-fl)}.g-kid{fill:var(--c-bad)}
`,
});
