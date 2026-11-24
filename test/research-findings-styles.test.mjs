/* The zero-token number reader must read the common journal styles (NEJM, Lancet, JAMA, BMJ) and never read the
 * English word "or" as an odds ratio. Synthetic sentences in each house style. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindings } from "../functions/api/research/_auto_studies.js";

const one = (s) => parseFindings(s).filter((f) => f.format === "estimate").map((f) => [f.measure, f.estimate, f.ciLower, f.ciUpper]);

test("reads estimate + 95% CI in common journal styles", () => {
  assert.deepEqual(one("The outcome occurred less often (hazard ratio, 0.74; 95% confidence interval [CI], 0.65 to 0.85; P<0.001)."), [["HR", 0.74, 0.65, 0.85]]);
  assert.deepEqual(one("Mortality was lower (HR 0.80, 95% CI 0.70-0.91, p=0.001)."), [["HR", 0.8, 0.7, 0.91]]);
  assert.deepEqual(one("Stroke was reduced (relative risk [RR] 0.78; 95% CI: 0.67, 0.91)."), [["RR", 0.78, 0.67, 0.91]]);
  assert.deepEqual(one("Response was higher (OR = 2.1, 95% CI 1.4 to 3.2)."), [["OR", 2.1, 1.4, 3.2]]);
  assert.deepEqual(one("adjusted HR 0.69 [95% CI 0.55–0.86]"), [["HR", 0.69, 0.55, 0.86]]);
  assert.deepEqual(one("Smoking was associated (adjusted odds ratio [aOR] 1.85, 95% CI 1.20 to 2.85, p = 0.005)."), [["OR", 1.85, 1.2, 2.85]]);
});

test("reads negative differences with hyphen or unicode minus, and keeps the sign", () => {
  assert.deepEqual(one("Mean difference in HbA1c was -0.52% (95% CI, -0.61 to -0.43)."), [["MD", -0.52, -0.61, -0.43]]);
  assert.deepEqual(one("SMD −0.35 (95% CI −0.52 to −0.18)"), [["SMD", -0.35, -0.52, -0.18]]);
});

test("never invents: English 'or', a missing CI, or a sign the quote does not show", () => {
  assert.deepEqual(one("Patients with diabetes or 12 other conditions (95% CI 1 to 3) were excluded."), []);
  assert.deepEqual(one("The OR was not reported."), []);
  assert.deepEqual(one("Mean difference was 0.52 (95% CI 0.61 to 0.43)."), []);
});
