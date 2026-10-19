/* Primary hyperaldosteronism as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/conn.mjs [--print-model]
 * Static layout here; hormones, ions and gauges move in conn.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Aldosterone excess", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "spironolactone (mineralocorticoid antagonist)" },
    { label: "adrenalectomy (remove the adenoma)" },
    { label: "potassium replacement only" },
  ],
  status: "Aldosterone excess: {level} · {drug} ·",
  drugNames: ["no treatment", "spironolactone", "adrenalectomy", "potassium replacement only"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const spiro = drug === 1 ? 1 : 0, surg = drug === 2 ? 1 : 0, krepl = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const src = cl(a * (surg ? 0.07 : 1));
  const act = cl(src * (spiro ? 0.15 : 1));
  const Na = cl(0.12 + 0.82 * act);
  const Vol = cl(0.18 + 0.78 * Na);
  const BP = cl(0.16 + 0.8 * Vol);
  const Kloss = cl(0.08 + 0.86 * act);
  const K = cl(0.92 - 0.72 * Kloss + krepl * 0.55);
  const Hloss = cl(0.08 + 0.84 * act);
  const Alk = cl(0.1 + 0.82 * Hloss - krepl * 0.06);
  const Ren = cl(0.92 - 0.78 * Vol);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(BP, 0.42, 0.68, ["near normal", "raised", "high"]), w(K, 0.38, 0.62, ["low", "borderline", "normal"]), w(Alk, 0.35, 0.65, ["normal", "alkaline", "very alkaline"]), w(Ren, 0.35, 0.62, ["suppressed", "low", "recovered"])];
  return { a, spiro, surg, krepl, src, act, Na, Vol, BP, Kloss, K, Hloss, Alk, Ren, words, readout: "blood pressure " + words[0] + " · potassium " + words[1] + " · blood " + words[2] + " · renin " + words[3] };
}
const TESTS = [
  [2, 0, "blood pressure high · potassium low · blood very alkaline · renin suppressed"],
  [2, 1, "blood pressure raised · potassium normal · blood normal · renin recovered"],
  [2, 2, "blood pressure near normal · potassium normal · blood normal · renin recovered"],
  [2, 3, "blood pressure high · potassium normal · blood very alkaline · renin suppressed"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="kidneySlot"></g>
<g id="adrenalSlot"></g>
<path id="aldoVessel" class="conn-aldov" d="M207 205 C250 200 300 206 360 214"/>
<g id="tumourG"></g>
<rect class="conn-lumen" x="330" y="195" width="560" height="52" rx="12"/>
<rect id="ductGlow" class="conn-glowd" x="338" y="236" width="544" height="30" rx="10" pointer-events="none" opacity="0.4"/>
<g id="ductCells"></g>
<path id="fbPath" class="conn-fb" d="M905 327 C912 272 890 212 848 154" opacity="0.6"/>
<rect id="vesselLumen" class="conn-vessel" x="330" y="325" width="590" height="48" rx="12"/>
<g id="rbcs"></g>
<rect id="pressOverlay" class="conn-press" x="330" y="325" width="590" height="48" rx="12" pointer-events="none" opacity="0.4"/>
<g id="reninG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "primary-hyperaldosteronism", fig: "Fig 1", title: "Primary hyperaldosteronism: aldosterone excess to hypertension", W, H, body,
  label: "An animated adrenal adenoma, kidney collecting duct, blood vessel and renin feedback cell. The adenoma or hyperplastic adrenal secretes aldosterone without waiting for renin. Aldosterone acts on principal cells in the collecting duct to take sodium and water back into the blood and to push potassium and hydrogen ions out into the urine. Blood volume and pressure rise, potassium falls, the blood becomes alkaline and renin is suppressed. Gauges show aldosterone action, sodium reabsorption, blood pressure, serum potassium, alkalosis and renin. Treatment choices include spironolactone, adrenalectomy and potassium replacement only.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "conn.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With adrenalectomy",
  sourcesLis: [
    "<strong>How primary hyperaldosteronism works.</strong> An adrenal adenoma or bilateral adrenal hyperplasia secretes aldosterone autonomously, so release does not switch off when sodium and volume rise. Aldosterone binds mineralocorticoid receptors in principal cells of the collecting duct and increases epithelial sodium channels and sodium potassium pumping. Sodium and water are reabsorbed, expanding volume and raising blood pressure, while potassium and hydrogen ions are secreted into the urine. The typical pattern is hypertension with hypokalaemia and metabolic alkalosis and a suppressed renin. This is standard teaching in endocrine and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Spironolactone blocks the mineralocorticoid receptor, so aldosterone is still present but cannot act. Adrenalectomy removes a single adenoma at source. Potassium replacement alone can refill potassium while the aldosterone driven sodium retention, hypertension and alkalosis continue. These are teaching toggles only.",
  ],
  simplified: "Bilateral hyperplasia management, confirmatory testing and subtype imaging, spironolactone side effects and other receptor blockers, epithelial channel and pump molecular detail, cortisol co-secretion, associated genetic forms, target organ damage, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-conntum:#e5484d;--c-connduct:#7fc4e8;--c-connna:#3f8fe0;--c-connk:#b07fe8;--c-connh:#7de8c3}
body[data-theme="light"]{--c-conntum:#c42a3d;--c-connduct:#3fa0d4;--c-connna:#1f6fc0;--c-connk:#7c3aed;--c-connh:#0f9f76}
.cl-conntum{--cc:var(--c-conntum)}.cl-connren{--cc:var(--c-lymph)}.cl-connduct{--cc:var(--c-connduct)}
.conn-lumen{fill:color-mix(in srgb,var(--c-connduct) 18%,var(--anatomy-paper))}
.conn-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper))}
.conn-aldov{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:12;stroke-linecap:round;opacity:.55}
.conn-fb{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;stroke-dasharray:7 6}
.conn-glowd{fill:#ff9a3d}
.conn-press{fill:var(--c-bad)}
.conn-cap{fill:var(--anatomy-strong);font-size:12px}
.p-aldo{--cc:#ff9a3d}.p-na{--cc:var(--c-connna)}.p-k{--cc:var(--c-connk)}.p-h{--cc:var(--c-connh)}
.dr-g-fill.g-aldo{fill:#ff9a3d}.dr-g-fill.g-na{fill:var(--c-connna)}.dr-g-fill.g-k{fill:var(--c-connk)}.dr-g-fill.g-alk{fill:var(--c-connh)}
`,
});
