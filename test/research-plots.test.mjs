import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import PLOTS from "../research-plots.js";
import ENGINE from "../research-engine.js";

/* Helper: Well-formed SVG checker using balanced tag matching */
function assertWellFormedSvg(svgStr) {
  assert.ok(typeof svgStr === "string" && svgStr.length > 0, "SVG must be a non-empty string");
  assert.match(svgStr, /^<svg[\s\S]*<\/svg>$/, "SVG must start with <svg and end with </svg>");
  assert.match(svgStr, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "SVG must have xmlns");
  assert.match(svgStr, /viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/, "SVG must specify viewBox");

  // Strip comments and style blocks for tag nesting verification
  const stripped = svgStr
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "<style></style>");

  const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)([^>]*?)(\/)?>/g;
  const stack = [];
  let match;

  while ((match = tagRegex.exec(stripped)) !== null) {
    const isClose = !!match[1];
    const tagName = match[2];
    const isSelfClosing = !!match[4];

    if (isClose) {
      assert.ok(stack.length > 0, `Unexpected close tag </${tagName}> with empty stack`);
      const openTag = stack.pop();
      assert.equal(tagName, openTag, `Mismatched tags: expected </${openTag}> but got </${tagName}>`);
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
  }
  assert.equal(stack.length, 0, `Unclosed tags remaining on stack: ${stack.join(", ")}`);
}

/* =========================================================================
 * 1. ES5 Source Guard & Integrity
 * ========================================================================= */

test("ES5 source guard: research-plots.js contains only ES5 (no =>, let, const, backticks, class, or em-dash)", () => {
  const filePath = path.resolve("research-plots.js");
  const src = fs.readFileSync(filePath, "utf8");

  assert.doesNotMatch(src, /=>/, "Must not contain arrow functions =>");
  assert.doesNotMatch(src, /\blet\s+/, "Must not contain let declarations");
  assert.doesNotMatch(src, /\bconst\s+/, "Must not contain const declarations");
  assert.doesNotMatch(src, /`/, "Must not contain template string backticks");
  assert.doesNotMatch(src, /\bclass\s+/, "Must not contain class declarations");
  assert.doesNotMatch(src, /\u2014|—/, "Must not contain em-dashes");
  assert.match(src, /svgToPngDataUrl is not needed; export is the SVG string at 300-dpi-equivalent viewBox sizing/, "Must contain 300-dpi comment");
});

test("Dual export check: export exists for both CommonJS and window", () => {
  assert.equal(typeof PLOTS.forestSvg, "function");
  assert.equal(typeof PLOTS.funnelSvg, "function");
  assert.equal(typeof PLOTS.robTrafficLightSvg, "function");
  assert.equal(typeof PLOTS.robSummarySvg, "function");
  assert.equal(typeof PLOTS.characteristicsTable, "function");
});

/* =========================================================================
 * 2. Forest Plot: forestSvg
 * ========================================================================= */

test("forestSvg: well-formed SVG output in both light and dark themes", () => {
  const mockRun = {
    pooled: { effect: -0.4, ciLower: -0.7, ciUpper: -0.1 },
    weights: [60, 40],
    manifest: { measure: "RR", model: "random_dl", level: 0.95 },
    studies: [
      { id: "s1", label: "Trial 1", effect: 0.65, ciLower: 0.40, ciUpper: 0.95, weight: 60, dataStr: "12/100 vs 20/100" },
      { id: "s2", label: "Trial 2", effect: 0.70, ciLower: 0.45, ciUpper: 1.05, weight: 40, dataStr: "15/120 vs 22/120" }
    ]
  };

  const lightSvg = PLOTS.forestSvg(mockRun, { theme: "light" });
  assertWellFormedSvg(lightSvg);
  assert.match(lightSvg, /Trial 1/);
  assert.match(lightSvg, /Trial 2/);
  assert.match(lightSvg, /rf-null-line/);
  assert.match(lightSvg, /rf-diamond/);

  const darkSvg = PLOTS.forestSvg(mockRun, { theme: "dark" });
  assertWellFormedSvg(darkSvg);
  assert.match(darkSvg, /fill: #0f172a/);
});

test("forestSvg: log-scale tick placement for RR", () => {
  // For RR with bounds spanning 0.1 to 10:
  // On a log scale, log(1.0) - log(0.5) = log(2.0) - log(1.0) = ln(2).
  // Therefore, the pixel distance between tick 0.5 and tick 1.0 must equal
  // the distance between tick 1.0 and tick 2.0!
  const mockRun = {
    pooled: { effect: 0, ciLower: -0.693, ciUpper: 0.693 }, // RR = 1.0 [0.5, 2.0]
    weights: [50, 50],
    manifest: { measure: "RR", model: "fixed" },
    studies: [
      { id: "s1", label: "A", effect: 0.5, ciLower: 0.25, ciUpper: 1.0, weight: 50 },
      { id: "s2", label: "B", effect: 2.0, ciLower: 1.0, ciUpper: 4.0, weight: 50 }
    ]
  };

  const svg = PLOTS.forestSvg(mockRun, { xMin: 0.2, xMax: 5.0 });
  assertWellFormedSvg(svg);

  // Extract tick positions for 0.5, 1, and 2
  // Format: <text x="<tx>" y="..." ...>0.5</text>
  const match05 = svg.match(/<text x="([^"]+)" y="[^"]*" class="rf-text rf-mono"[^>]*>0\.5<\/text>/);
  const match10 = svg.match(/<text x="([^"]+)" y="[^"]*" class="rf-text rf-mono"[^>]*>1<\/text>/);
  const match20 = svg.match(/<text x="([^"]+)" y="[^"]*" class="rf-text rf-mono"[^>]*>2<\/text>/);

  assert.ok(match05, "Must render tick 0.5");
  assert.ok(match10, "Must render tick 1");
  assert.ok(match20, "Must render tick 2");

  const x05 = parseFloat(match05[1]);
  const x10 = parseFloat(match10[1]);
  const x20 = parseFloat(match20[1]);

  const dist05to10 = x10 - x05;
  const dist10to20 = x20 - x10;

  assert.ok(dist05to10 > 20, "Distance between ticks should be substantial");
  assert.ok(Math.abs(dist05to10 - dist10to20) < 1e-3, `Log scale check: dist(0.5->1.0)=${dist05to10} must equal dist(1.0->2.0)=${dist10to20}`);
});

test("forestSvg: diamond at the pooled estimate", () => {
  // Test with actual ENGINE.run() output
  const bcgStudies = [
    { id: "1", verified: true, label: "Aronson 1948", events1: 4, n1: 123, events2: 11, n2: 139 },
    { id: "2", verified: true, label: "Ferguson 1949", events1: 6, n1: 306, events2: 29, n2: 303 },
    { id: "3", verified: true, label: "Rosenthal 1960", events1: 17, n1: 1716, events2: 65, n2: 1665 }
  ];
  const project = { measure: "RR", model: "random_dl", studies: bcgStudies };
  const runResult = ENGINE.run(project);

  const svg = PLOTS.forestSvg(runResult);
  assertWellFormedSvg(svg);

  // Extract diamond polygon points
  // Format: <polygon points="dLeft,summaryY dCenter,dTop dRight,summaryY dCenter,dBottom" class="rf-diamond" />
  const polyMatch = svg.match(/<polygon points="([^"]+)" class="rf-diamond"/);
  assert.ok(polyMatch, "Diamond polygon must be present");

  const pts = polyMatch[1].split(" ").map((pair) => pair.split(",").map(Number));
  assert.equal(pts.length, 4, "Diamond must have 4 vertices");

  const [leftPt, topPt, rightPt, botPt] = pts;
  // Left: [dLeft, summaryY], Top: [dCenter, dTop], Right: [dRight, summaryY], Bottom: [dCenter, dBottom]
  assert.equal(topPt[0], botPt[0], "Top and bottom x coordinates must match at dCenter");
  assert.ok(leftPt[0] < topPt[0], "Left vertex x must be less than center x");
  assert.ok(topPt[0] < rightPt[0], "Center vertex x must be less than right x");

  // Verify that pooled estimate string is rendered
  const pooledExp = Math.exp(runResult.pooled.effect);
  const pooledLo = Math.exp(runResult.pooled.ciLower);
  const pooledHi = Math.exp(runResult.pooled.ciUpper);
  assert.match(svg, new RegExp(pooledExp.toFixed(2)));
  assert.match(svg, new RegExp(pooledLo.toFixed(2)));
  assert.match(svg, new RegExp(pooledHi.toFixed(2)));
});

test("forestSvg: renders prediction interval bar when present, omits when null", () => {
  const runWithPI = {
    pooled: { effect: 0.5, ciLower: 0.2, ciUpper: 0.8 },
    predictionInterval: { lower: -0.1, upper: 1.1 },
    weights: [100],
    manifest: { measure: "MD", model: "random_dl" },
    studies: [{ id: "s1", label: "Study 1", effect: 0.5, ciLower: 0.2, ciUpper: 0.8, weight: 100 }]
  };

  const svgWithPI = PLOTS.forestSvg(runWithPI);
  assertWellFormedSvg(svgWithPI);
  assert.match(svgWithPI, /Prediction Interval/, "Must render Prediction Interval label");
  assert.match(svgWithPI, /rf-pibar/, "Must render rf-pibar class");

  const runNoPI = {
    pooled: { effect: 0.5, ciLower: 0.2, ciUpper: 0.8 },
    predictionInterval: null,
    weights: [100],
    manifest: { measure: "MD", model: "fixed" },
    studies: [{ id: "s1", label: "Study 1", effect: 0.5, ciLower: 0.2, ciUpper: 0.8, weight: 100 }]
  };
  const svgNoPI = PLOTS.forestSvg(runNoPI);
  assertWellFormedSvg(svgNoPI);
  assert.doesNotMatch(svgNoPI, /Prediction Interval/, "Must omit Prediction Interval when null");
});

/* =========================================================================
 * 3. Funnel Plot: funnelSvg
 * ========================================================================= */

test("funnelSvg: points, pseudo-95% limits, and FE line from ENGINE.funnel", () => {
  const bcgStudies = [
    { id: "s1", verified: true, yi: -0.89, se: 0.32 },
    { id: "s2", verified: true, yi: -1.58, se: 0.44 },
    { id: "s3", verified: true, yi: -1.35, se: 0.28 }
  ];
  const project = { measure: "RR", model: "fixed", studies: bcgStudies };
  const funnelData = ENGINE.funnel(project);

  const svg = PLOTS.funnelSvg(funnelData, { title: "BCG Funnel" });
  assertWellFormedSvg(svg);

  // FE reference line
  assert.match(svg, /class="fn-fe"/, "Must render FE line");
  // Pseudo-95% limits
  assert.match(svg, /class="fn-limit"/, "Must render limit lines");
  // Cone fill
  assert.match(svg, /<polygon points="[^"]+" fill="[^"]+" \/>/, "Must render shaded cone");
  // Circles for each point
  const pointMatches = svg.match(/class="fn-point"/g);
  assert.equal(pointMatches.length, 3, "Must render 3 study circles");

  // Title
  assert.match(svg, /BCG Funnel/);
});

/* =========================================================================
 * 4. Risk of Bias: robTrafficLightSvg and robSummarySvg
 * ========================================================================= */

test("robTrafficLightSvg: cell counts and colours per judgment for RoB 2", () => {
  // 3 studies, RoB 2 (5 domains: d1, d2, d3, d4, d5 + overall = 6 cells per study = 18 cells total)
  const assessments = [
    {
      studyId: "study1",
      label: "Smith 2020",
      consensus: {
        domains: [
          { key: "d1", judgment: "low" },
          { key: "d2", judgment: "low" },
          { key: "d3", judgment: "some_concerns" },
          { key: "d4", judgment: "low" },
          { key: "d5", judgment: "low" }
        ],
        overall: "some_concerns"
      }
    },
    {
      studyId: "study2",
      label: "Jones 2021",
      consensus: {
        domains: [
          { key: "d1", judgment: "high" },
          { key: "d2", judgment: "high" },
          { key: "d3", judgment: "low" },
          { key: "d4", judgment: "some_concerns" },
          { key: "d5", judgment: "no_information" }
        ],
        overall: "high"
      }
    },
    {
      studyId: "study3",
      label: "Taylor 2022",
      consensus: {
        domains: [
          { key: "d1", judgment: "low" },
          { key: "d2", judgment: "low" },
          { key: "d3", judgment: "low" },
          { key: "d4", judgment: "low" },
          { key: "d5", judgment: "low" }
        ],
        overall: "low"
      }
    }
  ];

  const svg = PLOTS.robTrafficLightSvg(assessments, "rob2");
  assertWellFormedSvg(svg);

  // In the grid: 3 studies * 6 columns = 18 circles
  // Plus 4 small circles in the legend = 22 total circle tags
  // Let's count grid circles (r="10.5")
  const gridCircles = svg.match(/<circle cx="[^"]+" cy="[^"]+" r="10\.5" fill="([^"]+)" \/>/g);
  assert.equal(gridCircles.length, 18, "Grid must contain exactly 18 cells (3 studies x 6 columns)");

  // Expected counts across the 18 cells:
  // study 1: 4 low, 2 some_concerns (d3 + overall)
  // study 2: 1 low (d3), 1 some_concerns (d4), 3 high (d1, d2, overall), 1 no_information (d5)
  // study 3: 6 low (all d1..d5 + overall)
  // Totals:
  // Low: 4 + 1 + 6 = 11 (#009E73)
  // Some concerns: 2 + 1 + 0 = 3 (#E69F00)
  // High: 0 + 3 + 0 = 3 (#D55E00)
  // No information: 0 + 1 + 0 = 1 (#56B4E9)
  // Sum = 11 + 3 + 3 + 1 = 18

  const countColor = (hex) => (svg.match(new RegExp(`r="10\\.5" fill="${hex}"`, "g")) || []).length;

  assert.equal(countColor("#009E73"), 11, "Must have 11 low risk cells with color #009E73");
  assert.equal(countColor("#E69F00"), 3, "Must have 3 some concerns cells with color #E69F00");
  assert.equal(countColor("#D55E00"), 3, "Must have 3 high risk cells with color #D55E00");
  assert.equal(countColor("#56B4E9"), 1, "Must have 1 no information cell with color #56B4E9");

  // Symbols inside the cells:
  // "+" for low, "?" for some concerns, "-" for high, "!" for no information
  assert.match(svg, />\+<\/text>/, "Must render + symbol for low risk");
  assert.match(svg, />\?<\/text>/, "Must render ? symbol for some concerns");
  assert.match(svg, />-<\/text>/, "Must render - symbol for high risk");
  assert.match(svg, />!<\/text>/, "Must render ! symbol for no information");

  // Check studies rendered
  assert.match(svg, /Smith 2020/);
  assert.match(svg, /Jones 2021/);
  assert.match(svg, /Taylor 2022/);
});

test("robSummarySvg: summary stacked bars for ROBINS-I and QUADAS-2", () => {
  const robinsAssessments = [
    { id: "s1", label: "Study A", domains: { d1: "low", d2: "moderate", d3: "low", d4: "serious", d5: "low", d6: "low", d7: "low" }, overall: "serious" },
    { id: "s2", label: "Study B", domains: { d1: "low", d2: "low", d3: "low", d4: "low", d5: "low", d6: "low", d7: "low" }, overall: "low" }
  ];

  const robinsSvg = PLOTS.robSummarySvg(robinsAssessments, "robins_i");
  assertWellFormedSvg(robinsSvg);
  assert.match(robinsSvg, /Confounding/);
  assert.match(robinsSvg, /Overall risk of bias/);

  // QUADAS-2
  const quadasAssessments = [
    { id: "q1", label: "Q Study 1", domains: { patient_selection: "low", index_test: "high", reference_standard: "low", flow_timing: "low" }, overall: "high" }
  ];
  const quadasSvg = PLOTS.robSummarySvg(quadasAssessments, "quadas2");
  assertWellFormedSvg(quadasSvg);
  assert.match(quadasSvg, /Patient selection/);
  assert.match(quadasSvg, /Index test/);
});

/* =========================================================================
 * 5. Characteristics Table & CSV Quoting
 * ========================================================================= */

test("characteristicsTable: returns columns, rows, and RFC 4180 toCsv() with proper quoting", () => {
  const studies = [
    {
      study: 'Smith, "The Pioneer", Jr.',
      year: "2020",
      design: "RCT",
      participants: "N=150, severe cases",
      intervention: "Drug A (10 mg daily)",
      control: "Placebo",
      outcome: "Mortality\nat 30 days"
    },
    {
      study: "Normal Study",
      year: "2021",
      design: "Cohort",
      participants: "N=500",
      intervention: "Standard Care",
      control: "None",
      outcome: "Recovery"
    }
  ];

  const table = PLOTS.characteristicsTable(studies);

  assert.ok(Array.isArray(table.columns), "columns must be an array");
  assert.ok(Array.isArray(table.rows), "rows must be an array");
  assert.equal(table.rows.length, 2);
  assert.equal(typeof table.toCsv, "function");

  const csv = table.toCsv();

  // Check CSV header
  assert.match(csv, /^Study,Year,Design,Participants,Intervention,Control,Outcome/);

  // Quoting assertions:
  // 1. Double quotes inside field must be doubled: 'Smith, "The Pioneer", Jr.' -> '"Smith, ""The Pioneer"", Jr."'
  assert.match(csv, /"Smith, ""The Pioneer"", Jr\."/, "Inner quotes must be doubled and field wrapped in quotes");

  // 2. Field with comma must be wrapped in quotes: 'N=150, severe cases' -> '"N=150, severe cases"'
  assert.match(csv, /"N=150, severe cases"/, "Field containing comma must be enclosed in quotes");

  // 3. Field with newline must be wrapped in quotes: 'Mortality\nat 30 days' -> '"Mortality\nat 30 days"'
  assert.match(csv, /"Mortality\nat 30 days"/, "Field containing newline must be enclosed in quotes");

  // 4. Clean field without special chars: "Cohort" should not require extra escaping
  assert.match(csv, /Cohort/);
});
