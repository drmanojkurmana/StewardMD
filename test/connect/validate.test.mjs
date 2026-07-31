import { test } from "node:test";
import assert from "node:assert/strict";
import { patient, encounter, condition, bundle } from "../../functions/_connect/canonical/model.js";
import { codeable, reference } from "../../functions/_connect/canonical/coding.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";

test("valid bundle passes", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.equal(validateBundle(b).ok, true);
});

test("missing patient is an error", () => {
  const b = bundle({ tenantId: "t1", patient: null, sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /patient/);
});

test("dangling intra-bundle reference is nulled with a warning", () => {
  const c = condition({ id: "c1", code: codeable({ text: "dx" }), encounter: reference("Encounter", "missing") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), conditions: [c], sourceConnector: "x" });
  const r = validateBundle(b);
  assert.equal(r.ok, true);
  assert.equal(b.conditions[0].encounter, null);          // resolve-or-null
  assert.match(r.warnings.join(), /reference/i);
});

test("resolvable reference is preserved", () => {
  const e = encounter({ id: "e1", status: "finished", class: "IP" });
  const c = condition({ id: "c1", code: codeable({ text: "dx" }), encounter: reference("Encounter", "e1") });
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), encounters: [e], conditions: [c], sourceConnector: "x" });
  validateBundle(b);
  assert.deepEqual(b.conditions[0].encounter, { type: "Encounter", id: "e1" });
});
