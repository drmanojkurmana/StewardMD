/* Cardiac tamponade as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/tampon.mjs [--print-model]
 * Static layout here; sac, fluid, heart, signs and gauges move in tampon.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Fluid in the sac: amount and speed", a: [0.25, 0.65, 1], names: ["small and slow", "moderate", "large and fast"], ticks: ["small, slow", "moderate", "large, fast"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "pericardiocentesis (needle drainage)" },
    { label: "intravenous fluids only (support)" },
    { label: "surgical drainage" },
  ],
  status: "Tamponade: {level} · {drug} ·",
  drugNames: ["no treatment", "pericardiocentesis", "fluids only", "surgical drainage"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const drain = drug === 1 ? 0.88 : drug === 3 ? 0.96 : 0, sup = drug === 2 ? 1 : 0;
  const F = cl(a * (1 - drain));
  const P = cl(0.05 + 0.95 * Math.pow(F, 1.3) * (sup ? 1.04 : 1));
  const Fill = cl(1.03 - 0.86 * P + 0.32 * sup * P);
  const SV = cl(0.08 + 0.84 * Fill - 0.18 * P);
  const BP = cl(0.18 + 0.72 * SV);
  const JVP = cl(0.18 + 0.75 * P + 0.12 * sup);
  const Muf = cl(0.08 + 0.85 * F);
  const Par = cl(0.05 + 0.85 * P * (1.25 - Fill));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Fill, 0.35, 0.65, ["poor", "reduced", "good"]), w(SV, 0.25, 0.55, ["low", "reduced", "good"]), w(BP, 0.35, 0.6, ["low", "borderline", "maintained"])];
  return { a, drain, sup, F, P, Fill, SV, BP, JVP, Muf, Par, words, readout: "filling " + words[0] + " · stroke volume " + words[1] + " · blood pressure " + words[2] };
}
const TESTS = [
  [2, 0, "filling poor · stroke volume low · blood pressure low"],
  [2, 1, "filling good · stroke volume good · blood pressure maintained"],
  [2, 2, "filling reduced · stroke volume reduced · blood pressure borderline"],
  [0, 0, "filling good · stroke volume good · blood pressure maintained"],
];

/* ---------------- static layout ---------------- */
const HX = 285, HY = 255;
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<path class="tp-div" d="M566 60V424"/>
<text class="sc-zone" x="34" y="68">HEART INSIDE THE PERICARDIAL SAC</text>
<text class="sc-zone" x="592" y="68">SIGNS AT THE BEDSIDE</text>
<g id="sac"></g><g id="fluid"></g><g id="ves"></g><g id="heart"></g><g id="parts"></g><g id="signs"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiac-tamponade", fig: "Fig 1", title: "Cardiac tamponade: fluid squeezing the heart", W, H, body,
  label: "An animated heart inside the pericardial sac. Fluid or blood collects in the sac faster than it can stretch, pressure rises, the chambers are squeezed and cannot fill, stroke volume and blood pressure fall, neck veins rise, heart sounds grow muffled and the pulse dips as the patient breathes in. Gauges show sac pressure, filling, stroke volume, blood pressure, venous pressure and heart sounds. Treatments shown are pericardiocentesis, intravenous fluids and surgical drainage.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, volumes or numbers are shown or implied.",
  scene: { W, H, HX, HY }, pageJs: readFileSync(join(HERE, "tampon.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With drainage",
  sourcesLis: [
    "<strong>How tamponade develops.</strong> The pericardium is a stiff sac around the heart. When fluid or blood collects in it quickly, the sac cannot stretch, so pressure inside the sac rises and is passed on to every chamber. The chambers cannot open fully in diastole, filling falls, and so do stroke volume and blood pressure. Blood backs up in the veins, so the jugular venous pressure rises. The fluid muffles the heart sounds. These three findings, low blood pressure, raised neck veins and muffled sounds, are the classic Beck triad. Because the chambers compete for the fixed space in the sac, breathing in, which draws more blood to the right side, leaves less room for the left side, so the pulse weakens on inspiration: pulsus paradoxus. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Pericardiocentesis drains the fluid with a needle and relieves the pressure. Surgical drainage removes the fluid and can repair the cause. Intravenous fluids can support filling for a short time but do not remove the fluid, so they do not fix the cause. These are teaching toggles only.",
  ],
  simplified: "The causes of the effusion, equalisation of diastolic pressures, electrical alternans, echocardiographic signs such as chamber collapse and a plethoric vena cava, tamponade in localised effusions, low-pressure tamponade, drainage technique and every dose and target are left out. Sizes, speeds and levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.tp-div{stroke:var(--anatomy-faint);stroke-width:1;fill:none}
.tp-peri{fill:color-mix(in srgb,var(--anatomy-paper) 82%,var(--c-fl));stroke:var(--anatomy-strong);stroke-width:2.6}
.tp-fluid{fill:var(--c-fl)}
.tp-myo{fill:color-mix(in srgb,var(--c-bad) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 68%,#000);stroke-width:1.4}
.tp-chr{fill:color-mix(in srgb,var(--c-cyt2) 42%,var(--anatomy-paper))}
.tp-chl{fill:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper))}
.tp-sept{stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.3;fill:none}
.tp-chlab{fill:var(--anatomy-strong);font:600 10px var(--anatomy-mono);pointer-events:none}
.tp-vein{fill:none;stroke:var(--c-cyt2);stroke-width:15;stroke-linecap:round}
.tp-vein2{fill:none;stroke:color-mix(in srgb,var(--c-cyt2) 55%,#fff);stroke-width:5;stroke-linecap:round;opacity:.7}
.tp-aorta{fill:none;stroke:var(--c-rbc);stroke-width:14;stroke-linecap:round}
.tp-aorta2{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,#fff);stroke-width:4.5;stroke-linecap:round;opacity:.7}
.tp-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.tp-jug{fill:color-mix(in srgb,var(--c-cyt2) 16%,var(--anatomy-paper));stroke:var(--c-cyt2);stroke-width:1.4}
.tp-jugf{fill:var(--c-cyt2)}
.tp-dial{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.4}
.tp-needle{stroke:var(--anatomy-strong);stroke-width:2.6;stroke-linecap:round;fill:none}
.tp-syr{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.tp-trace{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linejoin:round}
.tp-breath{fill:none;stroke:var(--c-cyt2);stroke-width:1.3;stroke-linejoin:round}
.tp-arc{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linecap:round}
.tp-hicon{fill:color-mix(in srgb,var(--c-bad) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:1.1}
.p-ven{--cc:var(--c-cyt2)}.p-art{--cc:var(--c-rbc)}.p-out{--cc:var(--c-fl)}
.dr-g-fill.g-pres{fill:var(--c-bad)}.dr-g-fill.g-snd{fill:var(--c-cyt)}
`,
});
