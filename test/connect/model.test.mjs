import { test } from "node:test";
import assert from "node:assert/strict";
import { patient, observation, bundle, assertConsumable, SCCM_MAJOR } from "../../functions/_connect/canonical/model.js";
import { codeable, quantity } from "../../functions/_connect/canonical/coding.js";

test("patient requires a stable id", () => {
  assert.throws(() => patient({}), /id/);
  assert.equal(patient({ id: "p1" }).id, "p1");
});

test("observation carries category + coded code + value", () => {
  const o = observation({ id: "o1", category: "laboratory", code: codeable({ text: "Hb" }), value: quantity({ value: 9 }) });
  assert.equal(o.category, "laboratory");
});

test("bundle envelope pins sccmVersion and holds all resource arrays", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "fhir-r4" });
  assert.equal(b.sccmVersion, "1.0");
  assert.deepEqual(b.conditions, []);
  assert.equal(b.meta.sourceConnector, "fhir-r4");
});

test("assertConsumable rejects a mismatched major", () => {
  const b = bundle({ tenantId: "t1", patient: patient({ id: "p1" }), sourceConnector: "x" });
  assert.doesNotThrow(() => assertConsumable(b, SCCM_MAJOR));
  assert.throws(() => assertConsumable(b, SCCM_MAJOR + 1), /version/);
});
