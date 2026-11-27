/* Draft text converted from LaTeX carries "Table 1" and numbered lists in Results/Abstract.
 * Those are labels, not results: the release gate must not call them bare numbers, while a real
 * untokenised result number still fails (live paper draft 2026-11-27). */
import { test } from "node:test";
import assert from "node:assert/strict";
const { gateManuscript } = await import("../functions/api/research/_manuscript.js");

function bare(text) {
  const out = gateManuscript([{ id: "results", heading: "Results", text }], [], {});
  const failures = (out && out.gateFailures) || [];
  return failures.filter((f) => f.type === "unresolved_token" && /Bare number/.test(f.message)).map((f) => f.token);
}

test("Table/Figure labels and list numbering are not bare numbers", () => {
  assert.deepEqual(bare("Study-level counts are in Table 1 and Figure 2."), []);
  assert.deepEqual(bare("Steps:\n1. Pooled the trials\n2. Checked heterogeneity"), []);
});

test("a real untokenised result number still fails", () => {
  assert.deepEqual(bare("The pooled risk ratio was 0.42 across trials."), ["0.42"]);
});

function unlinkedClaims(text, section = "abstract") {
  const out = gateManuscript([{ id: section, heading: section, text }], [], {});
  const failures = (out && out.gateFailures) || [];
  return failures.filter((f) => f.type === "unlinked_claim");
}

test("a research-question sentence is not an unlinked claim", () => {
  const text = "This systematic review and meta-analysis addresses whether BCG vaccination reduces tuberculosis in infants.";
  assert.deepEqual(unlinkedClaims(text), []);
});

test("a plain claim without a source still fails", () => {
  assert.equal(unlinkedClaims("BCG vaccination reduces tuberculosis in infants.").length, 1);
});
