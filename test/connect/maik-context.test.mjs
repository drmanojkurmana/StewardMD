// test/connect/maik-context.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaikContext, assertEgressAllowed, EgressBlocked } from "../../functions/_connect/maik-context.js";
import { bundle, patient, condition, imagingStudy } from "../../functions/_connect/canonical/model.js";
import { codeable } from "../../functions/_connect/canonical/coding.js";

const b = bundle({ tenantId: "t1", sourceConnector: "fhir-r4",
  patient: patient({ id: "P1", gender: "female" }),
  conditions: [condition({ id: "C1", code: codeable({ text: "Type 2 diabetes" }) })],
  provenance: [{ resource: "Condition", sourceConnector: "fhir-r4", sourceId: "Condition/MRN123" }] });

test("MaiK context is SCCM-only and carries no vendor/source ids", () => {
  const ctx = buildMaikContext(b);
  const s = JSON.stringify(ctx);
  assert.equal(s.includes("MRN123"), false);        // provenance.sourceId never crosses to MaiK
  assert.equal(s.includes("sourceConnector"), false);
  assert.equal(ctx.problems[0].label, "Type 2 diabetes");
});

test("egress is allowed for sandbox tenants, blocked otherwise (Phase 0)", () => {
  assert.doesNotThrow(() => assertEgressAllowed(b, { mode: "sandbox" }));
  assert.throws(() => assertEgressAllowed(b, { mode: "live" }), EgressBlocked);
});

test("imaging surfaces verbatim when present (metadata only, no fabrication)", () => {
  const bWithImaging = bundle({ tenantId: "t1", sourceConnector: "fhir-r4",
    patient: patient({ id: "P1", gender: "female" }),
    imagingStudies: [imagingStudy({ id: "im1", modality: "CT", bodySite: "chest", studyDate: "2026-07-01", description: "CT chest without contrast" })] });
  const ctx = buildMaikContext(bWithImaging);
  assert.deepEqual(ctx.imaging, [{ modality: "CT", bodySite: "chest", studyDate: "2026-07-01", description: "CT chest without contrast" }]);
  const s = JSON.stringify(ctx.imaging);
  assert.equal(s.includes("url"), false);              // no binary/url field ever surfaces
});

test("imaging bucket is empty when the bundle carries no imaging studies", () => {
  const ctx = buildMaikContext(b);                       // the module-level bundle has no imagingStudies
  assert.deepEqual(ctx.imaging, []);
});
