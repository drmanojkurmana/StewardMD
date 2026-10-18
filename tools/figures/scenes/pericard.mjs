/* Acute pericarditis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pericard.mjs [--print-model]
 * Static layout here; pericardial layers, fluid, ECG, symptoms and gauges move in pericard.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of pericardial disease", a: [0, 1, 2], names: ["acute", "effusion", "constrictive"], ticks: ["acute", "effusion", "constrictive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "anti-inflammatory treatment" },
    { label: "colchicine concept (dampens inflammation)" },
    { label: "drainage of the effusion" },
  ],
  status: "Pericarditis: {level} · {drug} ·",
  drugNames: ["no treatment", "anti-inflammatory treatment", "colchicine concept", "drainage"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const BASE = [
    { I: 0.92, F: 0.12, K: 0.06 },
    { I: 0.58, F: 0.92, K: 0.10 },
    { I: 0.28, F: 0.16, K: 0.94 },
  ];
  const b = BASE[level] || BASE[0];
  const anti = drug === 1 ? 1 : 0, colch = drug === 2 ? 1 : 0, drain = drug === 3 ? 1 : 0;
  let I = b.I, F = b.F;
  const K = b.K;
  if (anti) I = I * 0.42;
  if (colch) I = I * 0.48;
  if (drain) F = F * 0.10;
  I = cl(I); F = cl(F);
  const Pain = cl(0.06 + 0.82 * I * (1 - 0.35 * F) + 0.10 * K);
  const Rub = cl(I * (1 - F) * (1 - 0.55 * K));
  const Ecg = cl(0.05 + 0.90 * I * (level === 0 ? 1 : level === 1 ? 0.75 : 0.25));
  const Fill = cl(1.02 - 0.75 * K - 0.34 * F - 0.06 * I);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(I, 0.3, 0.62, ["settled", "active", "intense"]), w(Pain, 0.3, 0.62, ["mild", "present", "sharp"]), w(Fill, 0.35, 0.65, ["poor", "reduced", "good"])];
  return { I, F, K, Pain, Rub, Ecg, Fill, anti, colch, drain, words, readout: "inflammation " + words[0] + " · pain " + words[1] + " · filling " + words[2] };
}
const TESTS = [
  [0, 0, "inflammation intense · pain sharp · filling good"],
  [0, 1, "inflammation active · pain present · filling good"],
  [1, 3, "inflammation active · pain present · filling good"],
  [2, 0, "inflammation settled · pain present · filling poor"],
];

/* ---------------- static layout ---------------- */
const HX = 285, HY = 252;
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<path class="pc-div" d="M566 60V424"/>
<text class="sc-zone" x="34" y="68">HEART AND PERICARDIUM</text>
<text class="sc-zone" x="592" y="68">ECG AND SYMPTOMS</text>
<g id="sac"></g><g id="fluid"></g><g id="heart"></g><g id="fibrin"></g><g id="cells"></g><g id="parts"></g><g id="signs"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pericarditis", fig: "Fig 1", title: "Acute pericarditis: inflamed layers, effusion and constriction", W, H, body,
  label: "An animated heart inside the pericardium. In the acute stage the two pericardial layers are inflamed and rub together, causing pleuritic positional chest pain, a friction rub and diffuse ST elevation with PR depression on the ECG. Fluid can then collect as an effusion that separates the layers and can squeeze the heart. In the chronic constrictive stage a thick stiff shell encases the heart and restricts filling. Gauges show inflammation, pain, the friction rub, the ECG change, effusion, constriction and filling. Treatment choices are anti-inflammatory treatment, a colchicine concept and drainage.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H, HX, HY }, pageJs: readFileSync(join(HERE, "pericard.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How pericarditis develops.</strong> The pericardium has an inner visceral layer on the heart and an outer parietal layer. Infection, most often viral, or another cause inflames both layers. The inflamed surfaces roughen with fibrin and rub as the heart beats, giving pleuritic chest pain that is worse lying flat and on breathing in, and eased by sitting up and leaning forward, plus a scratchy friction rub. Inflammation across the heart surface gives widespread ST elevation and PR depression on the ECG rather than a change in one territory. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Effusion, tamponade and constriction.</strong> Inflammation can weep fluid into the pericardial space as an effusion, which separates the layers so pain and the rub may fade. A large or fast effusion can squeeze the heart and progress toward tamponade. Healing can instead leave a thick, fibrotic and sometimes calcified shell: constrictive pericarditis, where the stiff pericardium stops the heart filling freely. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Anti-inflammatory treatment calms the inflamed layers and eases pain. The colchicine concept is shown as a second way to dampen pericardial inflammation and lower the chance of recurrence. Drainage removes effusion fluid and relieves squeezing, but does not by itself calm acute inflammation or soften a constrictive shell. These are teaching toggles only.",
  ],
  simplified: "Specific causes and their tests, pericardial pain referral in detail, ECG evolution through stages, echocardiographic and imaging signs, tamponade physiology in full, recurrence patterns, drug choice, combinations and all doses are left out. Sizes, speeds and levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pc-div{stroke:var(--anatomy-faint);stroke-width:1;fill:none}
.pc-parietal{fill:color-mix(in srgb,var(--anatomy-paper) 80%,var(--c-endo));stroke:var(--anatomy-strong);stroke-width:2.6}
.pc-shell{fill:none;stroke:color-mix(in srgb,var(--anatomy-mid) 70%,#6b5a4a);stroke-linecap:round}
.pc-fluid{fill:var(--c-fl)}
.pc-myo{fill:color-mix(in srgb,var(--c-bad) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 68%,#000);stroke-width:1.4}
.pc-chr{fill:color-mix(in srgb,var(--c-cyt2) 42%,var(--anatomy-paper))}
.pc-chl{fill:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper))}
.pc-sept{stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.3;fill:none}
.pc-chlab{fill:var(--anatomy-strong);font:600 10px var(--anatomy-mono);pointer-events:none}
.pc-fib{fill:none;stroke:#e8c96a;stroke-width:1.6;stroke-linecap:round}
.pc-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.pc-grid{stroke:var(--anatomy-faint);stroke-width:.5;opacity:.35;fill:none}
.pc-trace{fill:none;stroke:var(--c-good);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}
.pc-baseline{stroke:var(--anatomy-faint);stroke-width:.8;stroke-dasharray:3 4;fill:none}
.pc-ray{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;fill:none}
.pc-torso{fill:color-mix(in srgb,var(--c-lymph) 22%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.6}
.pc-heartdot{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.pc-lean{fill:none;stroke:var(--anatomy-strong);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pc-arrow{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.pc-needle{stroke:var(--anatomy-strong);stroke-width:2.6;stroke-linecap:round;fill:none}
.pc-syr{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.p-med{--cc:var(--c-cyt)}.p-med2{--cc:#e8c96a}.p-out{--cc:var(--c-fl)}
.dr-g-fill.g-pain{fill:var(--c-bad)}.dr-g-fill.g-rub{fill:#e8c96a}.dr-g-fill.g-ecg{fill:var(--c-good)}.dr-g-fill.g-con{fill:#9a8a7a}
`,
});
