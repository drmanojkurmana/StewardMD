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

test("experimental draft -> review panel shows the DRAFT banner + do-not-transcribe", () => {
  const html = UI._buildReviewPanel(draftOf({ experimental: true }));
  assert.match(html, /EXPERIMENTAL DRAFT/);
  assert.match(html, /transcribe/i);
});

test("lifecycleState draft (not experimental) -> also banners", () => {
  const html = UI._buildReviewPanel(draftOf({ lifecycleState: "draft" }));
  assert.match(html, /EXPERIMENTAL DRAFT/);
});

test("active protocol -> NO draft banner", () => {
  const html = UI._buildReviewPanel(draftOf({ lifecycleState: "active" }));
  assert.doesNotMatch(html, /EXPERIMENTAL DRAFT/);
});
