/* Shock types (hypovolaemic, cardiogenic, distributive, obstructive) as an animated, working scene. Original drawing.
 *   node tools/figures/scenes/shock.mjs [--print-model]
 * Layout and model here; blood, heart, vessels and gauges move in shock.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Type of shock", a: [0, 1, 2, 3], names: ["hypovolaemic", "cardiogenic", "distributive", "obstructive"], ticks: ["hypovolaemic", "cardiogenic", "distributive", "obstructive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "fluids or blood" },
    { label: "vasopressor (tightens vessels)" },
    { label: "inotrope (strengthens the pump)" },
    { label: "treat the cause (stop the bleed, open the artery, remove the trigger, relieve the obstruction)" },
    { label: "treat the cause with the fitting support" },
  ],
  status: "Shock: {level} · {drug} ·",
  drugNames: ["no treatment", "fluids or blood", "vasopressor", "inotrope", "cause treated", "cause treated with support"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const base = [{ vol: 0.22, pump: 0.75, tone: 0.5, obs: 0 }, { vol: 0.75, pump: 0.25, tone: 0.5, obs: 0 }, { vol: 0.42, pump: 0.8, tone: 0.15, obs: 0 }, { vol: 0.75, pump: 0.75, tone: 0.5, obs: 0.8 }][level];
  const fl = drug === 1 || (drug === 5 && (level === 0 || level === 2 || level === 3)) ? 1 : 0;
  const vp = drug === 2 || (drug === 5 && level === 2) ? 1 : 0;
  const ino = drug === 3 || (drug === 5 && level === 1) ? 1 : 0;
  const cause = drug === 4 || drug === 5 ? 1 : 0;
  let vol = base.vol + (fl ? 0.35 : 0) + (cause && level === 0 ? 0.25 : 0);
  let pump = base.pump + (ino ? 0.35 : 0) + (cause && level === 1 ? 0.4 : 0);
  let obs = base.obs * (cause && level === 3 ? 0.12 : 1);
  vol = Math.min(vol, 1.1); pump = Math.min(pump, 0.95);
  const preload = vol + (level === 1 ? 0.5 * (0.75 - Math.min(pump, 0.75)) : 0) + 0.3 * obs;
  const volEff = level === 1 || level === 3 ? Math.min(vol, 0.7) : vol;
  const afterload = 1 - 0.5 * Math.max(0, (vp ? 0.85 : 0.5) - 0.6);
  const pumpEff = level === 1 && vp ? pump * (1 - 0.35) : pump * (afterload > 0 ? 1 : 1);
  const co = cl(pumpEff * Math.min(1, volEff / 0.65) * (1 - 0.8 * obs));
  let tone = level === 2 ? 0.15 + (cause ? 0.2 : 0) : 0.5 + 0.35 * cl((0.75 - co) / 0.5);
  if (vp) tone = cl(tone + 0.25);
  const bp = cl(co * (0.4 + 1.2 * tone));
  const cg = cl((preload - 0.75) * 3) * (pump < 0.5 ? 1 : 0.3);
  const o2 = cl(co * (1 - 0.35 * cg));
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(co, 0.45, 0.85, ["low", "normal", "high"]), w(preload, 0.5, 0.95, ["low", "normal", "high"]), w(tone, 0.35, 0.65, ["low", "normal", "high"]), w(bp, 0.45, 0.65, ["low", "borderline", "maintained"])];
  return { level, vol, pump, obs, co, preload, tone, bp, cg, o2, fl, vp, ino, cause, words, readout: "output " + words[0] + " · preload " + words[1] + " · vessel tone " + words[2] + " · pressure " + words[3] };
}
const TESTS = [
  [0, 0, "output low · preload low · vessel tone high · pressure low"],
  [1, 0, "output low · preload high · vessel tone high · pressure low"],
  [2, 0, "output normal · preload low · vessel tone low · pressure low"],
  [3, 0, "output low · preload high · vessel tone high · pressure low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CIRCULATION</text>
<g id="vessels"></g><g id="parts"></g><g id="blood"></g><g id="heartg"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "shock-types", fig: "Fig 1", title: "Shock: four types", W, H, body,
  label: "An animated circulation: a heart pumping blood through arteries to the tissues, with a venous reservoir returning blood to the heart. The level slider chooses hypovolaemic, cardiogenic, distributive or obstructive shock. Each type changes blood volume, the pump, vessel tone or an obstruction in a different way. Gauges show cardiac output, preload, vessel tone, blood pressure, oxygen delivery and lung congestion. Treatment choices include fluids, a vasopressor, an inotrope, and treating the cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "shock.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>What shock is.</strong> Shock is a circulation that cannot deliver enough oxygen to the tissues. Blood pressure is roughly output times vessel tone, so each type fails in a different place: too little blood (hypovolaemic), a failing pump (cardiogenic), vessels that have lost their tone (distributive, for example septic, anaphylactic or neurogenic), or a block to flow (obstructive, for example tamponade, pulmonary embolism or tension pneumothorax). The classic bedside pattern of output, filling pressure and vessel tone differs by type. This is standard teaching in medicine and critical-care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Fluids or blood fit a low volume, an inotrope fits a weak pump, a vasopressor fits lost vessel tone, and relieving the obstruction fits a block. Treating the cause matters most in every type. A wrong choice gives little benefit or harm (for example fluids in a failing pump worsen lung congestion). These are teaching toggles only.",
  ],
  simplified: "Mixed and evolving shock, compensatory stages, specific agents, monitoring, targets, doses and the many causes within each type are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.v-art{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke-linecap:round}
.v-ven{fill:none;stroke:color-mix(in srgb,var(--c-fl) 50%,var(--anatomy-paper));stroke-linecap:round}
.v-edge{fill:none;stroke:var(--anatomy-mid);stroke-width:1;opacity:.5}
.sc-organ{fill:color-mix(in srgb,var(--c-rbc) calc(var(--ox,.7) * 38%),#4b3f66);stroke:var(--anatomy-mid);stroke-width:1}
.sc-resv{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.sc-resvfill{fill:color-mix(in srgb,var(--c-fl) 70%,var(--anatomy-paper))}
.sc-heart{fill:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.2}
.sc-chamber{fill:color-mix(in srgb,var(--c-rbc) 80%,var(--anatomy-paper))}
.sc-infarct{fill:#2b1a1a;stroke:none}
.sc-sac{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 3}
.sc-effusion{fill:var(--c-fl)}
.sc-lung{fill:color-mix(in srgb,var(--c-lymph) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.1}
.sc-lungfill{fill:var(--c-fl)}
.sc-clot{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 50%,#000);stroke-width:.8}
.sc-wound{stroke:var(--c-bad);stroke-width:2.5;stroke-linecap:round}
.sc-spark{stroke:var(--c-no);stroke-width:2;stroke-linecap:round}
.p-bleed{fill:var(--c-rbc)}.p-iv{fill:var(--c-fl)}
`,
});
