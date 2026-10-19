/* Diagnostic test measures as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/epidemi.mjs [--print-model]
 * Left: overlapping test-result distributions for people with and without the disease, split by a moving cut-off.
 * Right: the same people sorted into a 2 by 2 table, plus a population mix bar for prevalence.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * level = prevalence. drug = cut-off and testing strategy.
 * drug 0 standard cut-off, 1 lower cut-off, 2 raised cut-off, 3 standard cut-off plus a confirmatory test.
 * Sensitivity is read within the disease present group. Specificity is read within the disease absent group.
 * Predictive values mix the two groups, so prevalence moves them even when sensitivity and specificity stay fixed. */
const MD = {
  level: { label: "Prevalence (how common the disease is)", a: [0.12, 0.35, 0.65], names: ["uncommon", "common", "very common"], ticks: ["uncommon", "common", "very common"], start: 1 },
  drugLabel: "Cut-off and testing strategy",
  settings: [
    { label: "standard cut-off" },
    { label: "lower cut-off (catch more cases)" },
    { label: "raise cut-off (fewer false alarms)" },
    { label: "add a confirmatory test" },
  ],
  status: "Prevalence: {level} · {drug} ·",
  drugNames: ["standard cut-off", "a lower cut-off", "a raised cut-off", "a confirmatory test added"],
};
function modelOf(S, level, drug) {
  const prev = S.level.a[level];
  const pair = [[0.78, 0.78], [0.93, 0.52], [0.52, 0.93], [0.70, 0.97]][drug];
  const cutX = [285, 232, 338, 285][drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const sens = pair[0], spec = pair[1];
  const TP = cl(sens * prev), FN = cl((1 - sens) * prev), FP = cl((1 - spec) * (1 - prev)), TN = cl(spec * (1 - prev));
  const ppv = cl(TP / Math.max(0.001, TP + FP)), npv = cl(TN / Math.max(0.001, TN + FN));
  const confirm = drug === 3 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(sens, 0.6, 0.85, ["low", "moderate", "high"]), w(spec, 0.6, 0.85, ["low", "moderate", "high"]), w(ppv, 0.35, 0.72, ["low", "moderate", "high"]), w(npv, 0.65, 0.9, ["low", "moderate", "high"])];
  return { prev, sens, spec, ppv, npv, TP, FN, FP, TN, cutX, confirm, words, readout: "sensitivity " + words[0] + " · specificity " + words[1] + " · positive predictive value " + words[2] + " · negative predictive value " + words[3] };
}
const TESTS = [
  [1, 0, "sensitivity moderate · specificity moderate · positive predictive value moderate · negative predictive value moderate"],
  [1, 1, "sensitivity high · specificity low · positive predictive value moderate · negative predictive value high"],
  [1, 2, "sensitivity low · specificity high · positive predictive value high · negative predictive value moderate"],
  [0, 3, "sensitivity moderate · specificity high · positive predictive value high · negative predictive value high"],
];

/* ---------------- static layout ----------------
 * Left panel x14-554, right panel x566-946, both y44-440. Gauges panel below from y448.
 * Graph plot: axis x78-520 at y292, distributions centred at x215 (no disease) and x365 (disease).
 * Story top to bottom, left to right: curves, sliding cut-off gate, person rows, caption,
 * then the 2 by 2 table and the population mix bar. Eight label pills total:
 *   graph top row: No disease 150,96 (box 112-188), Cut-off 285,96 (box 256-314),
 *     Disease 410,96 (box 381-439); separated and clear of the titles at y68.
 *   Second check 445,336 (box 401-489, y328-345); clear of the axis captions at y314
 *     and the first strip label at y358. Its dot rides the confirmatory gate.
 *   table cells: True positive 706,140 (box 658-754), False negative 844,140 (box 793-895),
 *     False positive 706,266 (box 655-757), True negative 844,266 (box 796-892);
 *     each box sits inside its cell, clear of the column headers at y96 and the mini dots.
 * Caption line at y433 in the left panel; person rows sit at y374 and y408 so dots stay clear of it. */
const body = `
<rect class="ep-panel" x="14" y="44" width="540" height="396" rx="18"/>
<rect class="ep-panel" x="566" y="44" width="380" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TEST RESULT IN EACH GROUP</text>
<text class="sc-zone" x="586" y="68">THE 2 BY 2 TABLE</text>
<path class="ep-axis" d="M78 292H520"/>
<path class="ep-axis" d="M512 287L522 292L512 297"/>
<text class="sc-lab" x="78" y="314">low result</text>
<text class="sc-lab" x="299" y="314" text-anchor="middle">test result</text>
<text class="sc-lab" x="520" y="314" text-anchor="end">high result</text>
<text class="sc-lab" x="78" y="358">Disease present: each dot is one person</text>
<text class="sc-lab" x="78" y="392">Disease absent: each dot is one person</text>
<text class="sc-lab" x="706" y="96" text-anchor="middle">Test positive</text>
<text class="sc-lab" x="844" y="96" text-anchor="middle">Test negative</text>
<text class="ep-rowlab" font-size="11" x="622" y="175" text-anchor="middle" transform="rotate(-90 622 175)">Disease present</text>
<text class="ep-rowlab" font-size="11" x="622" y="301" text-anchor="middle" transform="rotate(-90 622 301)">Disease absent</text>
<rect id="cellTP" class="ep-cell ep-cell-tp" x="640" y="110" width="132" height="110" rx="10"/>
<rect id="cellFN" class="ep-cell ep-cell-fn" x="778" y="110" width="132" height="110" rx="10"/>
<rect id="cellFP" class="ep-cell ep-cell-fp" x="640" y="236" width="132" height="110" rx="10"/>
<rect id="cellTN" class="ep-cell ep-cell-tn" x="778" y="236" width="132" height="110" rx="10"/>
<text class="sc-lab" x="640" y="362">Population mix</text>
<rect class="ep-popbg" x="640" y="370" width="270" height="16" rx="8"/>
<rect id="popD" class="ep-popd" x="640" y="370" width="94" height="16" rx="8"/>
<rect class="ep-legd" x="640" y="394" width="10" height="10" rx="2"/>
<text class="sc-lab" x="656" y="403">disease present</text>
<rect class="ep-lega" x="790" y="394" width="10" height="10" rx="2"/>
<text class="sc-lab" x="806" y="403">no disease</text>
<g id="Lgraph"></g><g id="Lstrips"></g><g id="Ltable"></g><g id="Lparts"></g><g id="Lover"></g><g id="Lpanel"></g>`;

buildScene({
  id: "screening-test-2x2-table", fig: "Fig 1", title: "Screening tests: the 2 by 2 table and predictive values", W, H, body,
  label: "An animated pair of test-result distributions and a 2 by 2 table. People with the disease and people without it give overlapping test results. A cut-off splits each group into test positive and test negative, making true positives, false negatives, false positives and true negatives. Sensitivity is read inside the disease present group and specificity inside the disease absent group. Predictive values mix both groups, so changing prevalence moves them. Lowering the cut-off raises sensitivity and lowers specificity; raising it does the reverse; a confirmatory test removes many false positives. Gauges show sensitivity, specificity and both predictive values.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numeric results are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "epidemi.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Standard cut-off alone", withLabel: "With a confirmatory test",
  extraCss: `.ep-panel{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ep-axis{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-linecap:round}
.ep-rowlab{fill:var(--anatomy-text);pointer-events:none}
.ep-wash{fill:var(--anatomy-strong);stroke:none}
.ep-knob{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:2}
.ep-band{fill:var(--c-cyt);stroke:none}
.ep-lid{fill:var(--anatomy-paper);stroke:none}
.ep-cap{fill:var(--anatomy-strong);font-size:12px}
.ep-cell{stroke:var(--anatomy-faint);stroke-width:1}
.ep-cell-tp{fill:var(--c-good)}.ep-cell-fn{fill:var(--c-bad)}.ep-cell-fp{fill:var(--c-eos)}.ep-cell-tn{fill:var(--c-lymph)}
.ep-area-tp{fill:var(--c-good)}.ep-area-fn{fill:var(--c-bad)}.ep-area-fp{fill:var(--c-eos)}.ep-area-tn{fill:var(--c-lymph)}
.ep-curve-a{fill:none;stroke:var(--c-lymph);stroke-width:2.5;stroke-linecap:round}
.ep-curve-p{fill:none;stroke:var(--c-bad);stroke-width:2.5;stroke-linecap:round}
.ep-cut{stroke:var(--anatomy-strong);stroke-width:2;stroke-dasharray:6 4}
.ep-conf{stroke:var(--c-cyt);stroke-width:3;stroke-dasharray:3 3}
.ep-dot{stroke:color-mix(in srgb,var(--anatomy-paper) 35%,transparent);stroke-width:.6}
.ep-d-tp{fill:var(--c-good)}.ep-d-fn{fill:var(--c-bad)}.ep-d-fp{fill:var(--c-eos)}.ep-d-tn{fill:var(--c-lymph)}
.ep-mini{stroke:color-mix(in srgb,var(--anatomy-paper) 35%,transparent);stroke-width:.5}
.ep-m-tp{fill:var(--c-good)}.ep-m-fn{fill:var(--c-bad)}.ep-m-fp{fill:var(--c-eos)}.ep-m-tn{fill:var(--c-lymph)}
.ep-flow{fill:var(--anatomy-strong);stroke:var(--anatomy-paper);stroke-width:.6}
.ep-flow-pos{fill:var(--c-eos)}
.ep-flow-caught{fill:var(--c-cyt)}
.ep-popbg{fill:var(--anatomy-shade-2);stroke:var(--anatomy-faint);stroke-width:.8}
.ep-popd{fill:var(--c-bad)}
.ep-legd{fill:var(--c-bad)}.ep-lega{fill:var(--anatomy-shade-2);stroke:var(--anatomy-faint);stroke-width:.8}`,
  sourcesLis: [
    "<strong>How the table is built.</strong> Every tested person sits in one cell by two facts: whether the disease is truly present or absent, and whether the test reads positive or negative. True positives and false negatives fill the disease present row; false positives and true negatives fill the disease absent row. Sensitivity is the share of the disease present row that tests positive. Specificity is the share of the disease absent row that tests negative. This is standard teaching in clinical epidemiology and evidence based medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why prevalence and the cut-off matter.</strong> A positive predictive value asks, of everyone who tests positive, how many truly have the disease, so it mixes both rows and rises as the disease becomes more common, even for the same test. A negative predictive value behaves in the opposite direction. Test results in the two groups overlap, so moving the cut-off trades one error for another: a lower cut-off catches more disease and creates more false alarms, a raised cut-off does the reverse, and a second confirmatory test applied to positive results removes many false positives at a small cost to sensitivity. These are teaching toggles only.",
  ],
  simplified: "The two distributions are drawn as smooth overlapping bells with a single cut-off, real tests can be skewed, multi-level or combined in panels, and a confirmatory test is rarely fully independent of the first. Spectrum effects, verification bias, indeterminate results, costs and harms of testing, and all numeric thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any person should be tested or treated.",
});
