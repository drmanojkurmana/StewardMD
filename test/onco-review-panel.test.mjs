/* R1 (blocking-fix regression): the dose REVIEW panel must render an unmistakable EXPERIMENTAL DRAFT
 * banner for a draft/experimental protocol - this is where the oncologist reads the mg numbers, and a
 * computed dose from a zero-VERIFY draft must never look like an approved, transcribable order.
 * An active protocol must NOT show the banner. Pure function; no DOM. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const UI = require(join(HERE, "..", "onco-protocols.js"));

const draftOf = (over) => ({
  protocolId: "breast-ac", template: Object.assign({ name: "AC", drugs: [{ id: "doxorubicin", name: "doxorubicin" }] }, over),
  calculatedDoses: [{ drugId: "doxorubicin", final: 100 }], overrides: []
});

// Owner decision 2026-09-28: no Beta / AI-drafted wording. The practical safety line still persists on
// the dose-review screen: decision support only, verify before prescribing (R1).
test("draft (experimental) -> review panel shows the verify note, no draft wording", () => {
  const html = UI._buildReviewPanel(draftOf({ experimental: true }));
  assert.doesNotMatch(html, /AI-drafted/i);
  assert.doesNotMatch(html, /Beta/i);
  assert.match(html, /Decision support only/);
  assert.match(html, /verify/i);
});

test("lifecycleState draft (not experimental) -> also shows the note", () => {
  const html = UI._buildReviewPanel(draftOf({ lifecycleState: "draft" }));
  assert.match(html, /Decision support only/);
  assert.match(html, /verify/i);
});

test("active protocol -> NO draft note", () => {
  const html = UI._buildReviewPanel(draftOf({ lifecycleState: "active" }));
  assert.doesNotMatch(html, /Decision support only/);
});
