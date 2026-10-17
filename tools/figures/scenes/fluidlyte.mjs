/* Sodium and potassium disorders as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/fluidlyte.mjs [--print-model]
 * Static layout here; brain, blood, kidney, cell potassium, heart ECG and gauges move in fluidlyte.page.js.
 * Qualitative: no doses, no numbers. Water balance sets sodium concentration; potassium sets the heartbeat. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Which imbalance", a: [0.6, 0.6, 0.6, 0.9], names: ["low sodium", "high sodium", "low potassium", "high potassium"], ticks: ["low sodium", "high sodium", "low potassium", "high potassium"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "restrict water" },
    { label: "saline" },
    { label: "replace potassium" },
    { label: "shift potassium into cells and remove it" },
    { label: "matched treatment for the cause" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "restricted water", "saline", "potassium replacement", "potassium shift and removal", "the matched treatment"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  let Na = 0.5, Wat = 0.5, K = 0.5;
  if (level === 0) { Na = 0.18; Wat = 0.85; }
  if (level === 1) { Na = 0.88; Wat = 0.15; }
  if (level === 2) { K = 0.15; }
  if (level === 3) { K = 0.88; }
  const fix = drug === 5 ? level + 1 : drug; // matched treatment applies the right idea for the level
  if (fix === 1) { Wat = Wat * 0.35 + 0.02; if (Na < 0.5) Na = Na + (0.55 - Na) * 0.65; else Na = cl(Na + 0.04); }
  if (fix === 2) { Na = Na + (0.6 - Na) * 0.5; Wat = Wat * 0.6 + 0.04; }
  if (fix === 3) { K = K + (0.62 - K) * 0.75; }
  if (fix === 4) { K = K * 0.55 + 0.08; }
  if (drug === 5 && level === 1) { Wat = 0.55; Na = 0.5; }
  Na = cl(Na); Wat = cl(Wat); K = cl(K);
  const Bw = cl(0.5 + (Wat - 0.5) * 0.7 + (0.5 - Na) * 0.7);
  const Hr = cl(Math.abs(K - 0.5) * 1.7 + (K > 0.62 ? 0.25 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Na, 0.35, 0.65, ["low", "normal", "high"]), w(Bw, 0.35, 0.65, ["shrunken", "normal", "swollen"]), w(K, 0.35, 0.65, ["low", "normal", "high"]), w(Hr, 0.35, 0.65, ["steady", "unsteady", "danger"])];
  return { Na, Wat, K, Bw, Hr, words, readout: "sodium " + words[0] + " · brain " + words[1] + " · potassium " + words[2] + " · heart " + words[3] };
}
const TESTS = [
  [0, 0, "sodium low · brain swollen · potassium normal · heart steady"],
  [0, 5, "sodium normal · brain normal · potassium normal · heart steady"],
  [2, 3, "sodium normal · brain normal · potassium normal · heart steady"],
  [3, 4, "sodium normal · brain normal · potassium normal · heart steady"],
];

/* ---------------- static layout ---------------- */
const CY = 350;
const body = `
<rect class="sc-tissue" x="14" y="44" width="300" height="206" rx="16"/>
<rect class="sc-tissue" x="324" y="44" width="300" height="206" rx="16"/>
<rect class="sc-tissue" x="634" y="44" width="312" height="206" rx="16"/>
<rect class="sc-tissue" x="14" y="262" width="536" height="180" rx="16"/>
<rect class="sc-tissue" x="560" y="262" width="386" height="180" rx="16"/>
<text class="sc-zone" x="32" y="68">BRAIN</text><text class="sc-zone" x="342" y="68">BLOOD</text><text class="sc-zone" x="652" y="68">KIDNEY</text>
<text class="sc-zone" x="32" y="286">BODY CELL AND POTASSIUM</text><text class="sc-zone" x="578" y="286">HEART AND ECG</text>
<rect id="lumen" class="sc-lumen" x="340" y="128" width="268" height="72"/>
<g id="brain"></g><g id="parts"></g><g id="heart"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.p-salt{--cc:#d9c8f2}.p-k2{--cc:#b27af0}.p-iv{fill:var(--c-fl)}
.fly-brain{fill:var(--c-fl)}
.fly-heart{fill:color-mix(in srgb,#d77a7a 55%,var(--anatomy-paper));stroke:#c25a5a;stroke-width:1.4}
.fly-ecg{fill:none;stroke:#2f9f7c;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.fly-kidney{fill:color-mix(in srgb,#c25a5a 30%,var(--anatomy-paper));stroke:#c25a5a;stroke-width:1.4}
.fly-tube{fill:none;stroke:color-mix(in srgb,var(--c-fl) 28%,var(--anatomy-paper));stroke-width:20;stroke-linecap:round}
.fly-gate{fill:#8a6fd0}.fly-gate.open{fill:var(--c-good)}
.fly-stop{fill:none;stroke:var(--c-bad);stroke-width:1.8}
.fly-cap{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round}
.fly-rbc{fill:var(--c-rbc)}
.fly-axon{fill:none;stroke:color-mix(in srgb,var(--c-endo) 65%,var(--anatomy-paper));stroke-width:1.4;stroke-linecap:round}
.fly-icon{fill:color-mix(in srgb,var(--c-fl) 40%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.fly-ico2{fill:color-mix(in srgb,#b27af0 40%,var(--anatomy-paper));stroke:#b27af0;stroke-width:1.3}
.dr-g-fill.g-na{fill:#b79ae0}.dr-g-fill.g-br{fill:var(--c-fl)}.dr-g-fill.g-kr{fill:#b27af0}.dr-g-fill.g-hr{fill:var(--c-bad)}.dr-g-fill.g-wa{fill:#7ab8ff}
`;

buildScene({
  id: "fluid-electrolytes-na-k", fig: "Fig 1", title: "Sodium and potassium: fluids and the heartbeat", W, H, body, extraCss,
  label: "An animated map of sodium and potassium balance. The slider picks low sodium, high sodium, low potassium or high potassium. Too much water for the salt present dilutes blood sodium and swells brain cells; too little water concentrates sodium and shrinks them; the kidney passes water and holds or loses salt. Potassium lives mostly inside body cells; when blood potassium falls or climbs, the heartbeat shown on the ECG trace turns unsteady and then dangerous. Treatment choices are limiting water, saline, potassium replacement, and shifting potassium into cells while removing it, with gauges for sodium, brain water, potassium, heart rhythm and body water.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, volumes, rates or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "fluidlyte.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Water sets sodium concentration.</strong> Blood sodium concentration reflects water relative to salt, not total salt alone. Extra water without salt (for example from excess intake with poor kidney clearance, or excess vasopressin effect) dilutes sodium and water moves into brain cells, which can swell. Losing more water than salt (for example poor intake with ongoing losses, or diabetes insipidus) concentrates sodium and water leaves brain cells, which shrink. The kidney adjusts by passing more or less water and holding or losing salt. This is standard teaching in medicine and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Potassium sets the heartbeat.</strong> Most body potassium sits inside cells. A low blood level (for example from gut or kidney losses) flattens the ECG trace and adds a small extra wave; a high level (for example kidney failure, or potassium leaving cells in acidosis) first peaks the trace and then widens and slows it, which can stop the heart. Replacement corrects a low level, while shifting potassium into cells and removing it from the body corrects a high level. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
  ],
  simplified: "Osmotic demyelination from too fast correction, exact fluid choices and rates, vasopressin and aldosterone control loops, acid base links, calcium and magnesium effects, diuretics, dialysis, and all doses, volumes, rates and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
