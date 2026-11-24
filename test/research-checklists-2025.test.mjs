/* Test suite for CONSORT 2025 and SPIRIT 2025 checklists.
 * No em or en dashes.
 * node --test test/research-checklists-2025.test.mjs
 */
import "./helpers/json-import-attr.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { checklistItems, resolveChecklistId } = await import("../functions/api/research/_checklists.js");

describe("2025 research checklists", () => {
  test("consort alias resolves to consort2025 with 30 items", () => {
    const id = resolveChecklistId("consort");
    assert.equal(id, "consort2025", "consort alias routes to consort2025");

    const cl = checklistItems("consort");
    assert.ok(cl, "checklist found");
    assert.equal(cl.id, "consort2025");
    assert.equal(cl.items.length, 30, "consort 2025 has exactly 30 items");
  });

  test("consort2010 still loads and resolves to 37 items", () => {
    const id = resolveChecklistId("consort2010");
    assert.equal(id, "consort2010", "consort2010 loads directly");

    const cl = checklistItems("consort2010");
    assert.ok(cl, "consort2010 checklist found");
    assert.equal(cl.id, "consort2010");
    assert.equal(cl.items.length, 37, "consort 2010 has 37 items");
  });

  test("spirit has 2025 coverage", () => {
    const id = resolveChecklistId("spirit");
    assert.equal(id, "spirit", "spirit resolves");

    const cl = checklistItems("spirit");
    assert.ok(cl, "spirit checklist found");
    assert.ok(cl.name.includes("2025"), "spirit name indicates 2025 coverage");
    assert.ok(cl.items.length > 30, "spirit has protocol checklist items");
  });
});
