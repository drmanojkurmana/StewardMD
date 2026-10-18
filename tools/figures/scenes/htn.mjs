/* Hypertension pathophysiology as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/htn.mjs [--print-model]
 * Pressure equals cardiac output times vessel resistance. Sympathetic drive, the renin-angiotensin system,
 * sodium and volume load, and chronic vessel remodelling raise that pressure; sustained pressure injures
 * heart, brain, kidney and eye. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity and duration", a: [0.3, 0.65, 1], names: ["mild, recent", "moderate", "severe, long standing"], ticks: ["mild, recent", "moderate", "severe, long standing"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "diuretic (kidney: sodium and water out)" },
    { label: "ACE inhibitor or ARB (renin-angiotensin blocked)" },
    { label: "calcium channel blocker (vessel muscle relaxed)" },
    { label: "beta-blocker (sympathetic drive to the heart blocked)" },
    { label: "combination therapy (several classes together)" },
  ],
  status: "Hypertension: {level} · {drug} ·",
  drugNames: ["no treatment", "a diuretic", "an ACE inhibitor or ARB", "a calcium channel blocker", "a beta-blocker", "combination therapy"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const diu = drug === 1 || drug === 5 ? 1 : 0, ace = drug === 2 || drug === 5 ? 1 : 0, ccb = drug === 3 || drug === 5 ? 1 : 0, bb = drug === 4 || drug === 5 ? 1 : 0;
  const sym = cl((0.15 + 0.85 * a) * (bb ? 0.35 : 1));
  const raas = cl((0.15 + 0.85 * a) * (ace ? 0.3 : 1) * (diu ? 1.1 : 1));
  const vol = cl((0.12 + 0.88 * a) * (diu ? 0.38 : 1) * (ace ? 0.85 : 1));
  const co = cl(0.28 + 0.38 * vol + 0.38 * sym);
  const vc = cl(0.15 + 0.42 * sym + 0.43 * raas);
  const vcEff = cl(vc * (ccb ? 0.35 : 1));
  const rem = cl((0.04 + 0.88 * a * a) * (ace ? 0.92 : 1));
  const tpr = cl(0.1 + 0.55 * vcEff + 0.3 * rem);
  const bp = cl(0.02 + 0.42 * co + 0.5 * tpr);
  const dmg = cl(0.7 * bp * (0.35 + 0.65 * a) + 0.18 * rem);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(bp, 0.35, 0.65, ["controlled", "raised", "high"]), w(co, 0.48, 0.75, ["normal", "raised", "high"]), w(tpr, 0.35, 0.68, ["normal", "raised", "high"]), w(dmg, 0.25, 0.55, ["none", "early", "marked"])];
  return { a, diu, ace, ccb, bb, sym, raas, vol, co, vc, vcEff, rem, tpr, bp, dmg, words, readout: "pressure " + words[0] + " · output " + words[1] + " · resistance " + words[2] + " · organ damage " + words[3] };
}
const TESTS = [
  [0, 0, "pressure raised · output raised · resistance raised · organ damage none"],
  [2, 0, "pressure high · output high · resistance high · organ damage marked"],
  [2, 5, "pressure raised · output raised · resistance raised · organ damage early"],
  [1, 5, "pressure raised · output normal · resistance normal · organ damage early"],
];

/* ---------------- static layout ---------------- */
const CY = 252;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">WHAT RAISES THE PRESSURE</text>
<text class="sc-zone sc-dim" x="250" y="192">THE RESISTANCE VESSEL</text>
<text class="sc-zone sc-dim" x="34" y="348">END ORGANS: WHERE SUSTAINED PRESSURE DOES DAMAGE</text>
<g id="drivers"></g><g id="vessel"></g><g id="heart"></g><g id="organs"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "hypertension-pathophysiology", fig: "Fig 1", title: "Hypertension: pressure, resistance and organ damage", W, H, body,
  label: "An animated map of raised blood pressure. Pressure equals cardiac output times vessel resistance. The heart pumps more when sympathetic drive and blood volume are high. Small arteries tighten under sympathetic and angiotensin signals and, over time, their walls thicken and stiffen. Sustained pressure then injures the heart, brain, kidney and eye. Gauges show pressure, cardiac output, vessel resistance, blood volume, wall change and organ damage. Treatment choices act at the kidney, the renin-angiotensin system, the vessel muscle or the sympathetic drive to the heart.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H, CY }, pageJs: readFileSync(join(HERE, "htn.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How blood pressure is set.</strong> Arterial pressure is the product of cardiac output and total peripheral resistance. Cardiac output rises with heart rate, contractility and blood volume. Resistance is set mainly in small arteries and arterioles, whose smooth muscle tightens under sympathetic drive and angiotensin II and relaxes when calcium entry into that muscle is blocked. The kidney links volume and resistance: it releases renin when perfusion falls, starting the renin-angiotensin-aldosterone system, and it holds or loses sodium and water. With time, raised pressure and hormonal signals thicken and stiffen the vessel wall (remodelling), which keeps resistance high. This is standard teaching in medicine, physiology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Organ damage and treatment ideas shown.</strong> Sustained pressure thickens the left ventricle and can lead to heart failure, injures brain vessels (stroke and cognitive decline), damages kidney glomeruli and vessels (chronic kidney disease, which itself raises pressure further), and injures retinal vessels. Diuretics help the kidney lose sodium and water. ACE inhibitors and ARBs block the renin-angiotensin system. Calcium channel blockers relax arteriole muscle. Beta-blockers reduce sympathetic drive to the heart. These are teaching toggles that show where each class acts, not how any person should be treated.",
  ],
  simplified: "Secondary causes of hypertension, blood pressure measurement and thresholds, white coat and masked hypertension, isolated systolic hypertension, drug choice by comorbidity, side effects, resistant hypertension workup, acute hypertensive emergencies, and all doses and targets are left out. Wall change reverses only slowly, so the figure keeps some resistance from remodelling even when a treatment is on. Counts and speeds are illustrative.",
  extraCss: `
.htn-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.htn-node-t{fill:var(--anatomy-strong);font:600 11px var(--anatomy-mono);pointer-events:none}
.htn-node-s{fill:var(--anatomy-text);font:10px var(--anatomy-mono);pointer-events:none;opacity:.8}
.htn-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.htn-head{fill:var(--anatomy-mid)}
.htn-dot{fill:var(--c-cyt)}.htn-dot.s{fill:var(--c-neut)}.htn-dot.v{fill:var(--c-fl)}
.htn-wall{fill:color-mix(in srgb,var(--c-sm) 52%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-sm) 65%,#000);stroke-width:1}
.htn-lum{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper))}
.htn-endo{fill:none;stroke:var(--c-endo);stroke-width:2}
.htn-eq{fill:var(--anatomy-strong);font:700 13px var(--anatomy-mono);pointer-events:none}
.htn-eqs{fill:var(--anatomy-text);font:10.5px var(--anatomy-mono);pointer-events:none}
.htn-heartw{fill:color-mix(in srgb,var(--c-bad) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 70%,#000);stroke-width:1.3}
.htn-heartc{fill:color-mix(in srgb,var(--c-rbc) 52%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 65%,#000);stroke-width:1}
.htn-aorta{fill:none;stroke:var(--c-rbc);stroke-linecap:round;opacity:.55}
.htn-org{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.htn-org-t{fill:var(--anatomy-strong);font:600 10.5px var(--anatomy-mono);pointer-events:none}
.htn-dmg{fill:var(--c-bad)}
.htn-brain{fill:color-mix(in srgb,var(--c-mac) 45%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.htn-kid{fill:color-mix(in srgb,#b8645a 55%,var(--anatomy-paper));stroke:#8f4438;stroke-width:1.2}
.htn-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.4}
.htn-ret{fill:none;stroke:var(--c-rbc);stroke-width:1.4;stroke-linecap:round}
.htn-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.htn-xx{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.htn-mk{fill:var(--c-bad);font:600 10px var(--anatomy-mono);pointer-events:none}
.p-ang{--cc:var(--c-cyt)}.p-symp{--cc:var(--c-neut)}.p-nad{fill:var(--c-fl)}
.dr-g-fill.g-vol{fill:var(--c-fl)}.dr-g-fill.g-rem{fill:var(--c-sm)}.dr-g-fill.g-dmg{fill:var(--c-bad)}
`,
});
