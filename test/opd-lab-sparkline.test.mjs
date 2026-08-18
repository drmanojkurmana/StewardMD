// #156 — lab-trend sparklines (flag smd_lab_sparklines, default OFF). The PURE core (labSeries + sparkline)
// is extracted verbatim from opd-emr.js and run in node. The live multi-report fetch is on-device validated.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "opd-emr.js"), "utf8");
const grab = (re, n) => { const m = src.match(re); assert.ok(m, n + " found"); return (0, eval)("(" + m[0].replace(/^function \w+/, "function") + ")"); };
const labSeries = grab(/function labSeries\(reports, testName\) \{[\s\S]*?\n  \}/, "labSeries");
const sparkline = grab(/function sparkline\(nums, opts\) \{[\s\S]*?\n  \}/, "sparkline");

const REPORTS = [
  { reported: "2026-01-10", tests: [{ test: "Hemoglobin", result: "9.2", units: "g/dL" }, { test: "Culture", result: "No growth after 48h" }] },
  { reported: "2026-01-03", tests: [{ test: "Hemoglobin", result: "8.1" }] },
  { reported: "2026-01-17", tests: [{ test: "hemoglobin", result: "10.4" }] },   // case-insensitive
];

test("labSeries extracts a numeric series, oldest-first, case-insensitive; ignores narrative + other tests", () => {
  const s = labSeries(REPORTS, "Hemoglobin");
  assert.deepEqual(s.map(p => p.v), [8.1, 9.2, 10.4]);                 // sorted by reported date
  assert.ok(s[0].t < s[1].t && s[1].t < s[2].t, "timestamps ascending");
  assert.equal(labSeries(REPORTS, "Culture").length, 0, "narrative result yields no numeric points");
  assert.equal(labSeries(REPORTS, "Potassium").length, 0, "absent test -> empty");
});

test("sparkline: <2 finite points -> empty; otherwise a polyline with one coord per point", () => {
  assert.equal(sparkline([]), "");
  assert.equal(sparkline([5]), "");
  assert.equal(sparkline([NaN, "x", 3]), "", "needs 2+ finite numbers");
  const svg = sparkline([8.1, 9.2, 10.4]);
  assert.match(svg, /<polyline points="/);
  const pts = svg.match(/points="([^"]+)"/)[1].trim().split(/\s+/);
  assert.equal(pts.length, 3, "one point per value");
  assert.match(svg, /<svg[^>]*aria-hidden="true"/);
});
