import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFhir } from "../../functions/_connect/connectors/fhir-r4/normalize.js";
import { fhirR4Connector } from "../../functions/_connect/connectors/fhir-r4/connector.js";
import { makeCtx, runConformance } from "../../functions/_connect/interfaces.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";
import { SYNTHETIC } from "./fixtures/fhir-synthetic.mjs";

test("normalizeFhir maps synthetic FHIR → valid SCCM", () => {
  const b = normalizeFhir(makeCtx(), { patient: SYNTHETIC.patient, resources: SYNTHETIC.resources });
  assert.equal(validateBundle(b).ok, true);
  assert.equal(b.patient.id, "P1");
  assert.equal(b.conditions[0].code.text, "Type 2 diabetes");
  assert.equal(b.observations[0].value.value, 9.2);
  assert.equal(b.medications[0].medication.text, "Metformin 500mg");
});

test("proprietary codes get kind=local and preserve text", () => {
  const raw = { patient: SYNTHETIC.patient, resources: [{ resourceType: "Observation", id: "O2", category: [{ coding: [{ code: "laboratory" }] }], code: { text: "Local test", coding: [{ system: "urn:hospital:labs", code: "LX" }] }, valueQuantity: { value: 1 } }] };
  const b = normalizeFhir(makeCtx(), raw);
  assert.equal(b.observations[0].code.coding[0].kind, "local");
  assert.equal(b.observations[0].code.text, "Local test");
});

test("FHIR connector passes the conformance harness (injected fetch → synthetic)", async () => {
  const fetch = async (url) => {
    if (/\/Patient\//.test(url)) return new Response(JSON.stringify(SYNTHETIC.patient));
    return new Response(JSON.stringify({ resourceType: "Bundle", entry: SYNTHETIC.resources.map((r) => ({ resource: r })) }));
  };
  const res = await runConformance(fhirR4Connector, { fetch, fixtures: { patientRef: "P1" } });
  assert.equal(res.passed, true, JSON.stringify(res.checks.filter((c) => !c.ok)));
});
