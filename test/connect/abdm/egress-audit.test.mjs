// test/connect/abdm/egress-audit.test.mjs — Stage-4 Task-8: HIU consume engine tail + egress predicate (R7) + audit ALLOW-list (R14).
// Composes the SAME post-normalize tail the pull engine (loadPatientContext) runs on the push side:
//   normalizeNdhm(ctx, decryptedDoc) -> validateBundle -> permission scope-FILTER -> buildMaikContext.
// R7: a live consented bundle NEVER silently opens Vertex/Gemini egress — egress requires a no-retention
//     provider BAA/DPA (tenant.egressBaaOk); a live bundle feeds only the deterministic MaiK context.
// R14: buildAuditEvent structurally KEEPS consentId/transactionId/careContextHash and still DROPS everything
//      else (raw careContextReference, raw ABHA, decrypted content).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaikContext, assertEgressAllowed, EgressBlocked } from "../../../functions/_connect/maik-context.js";
import { buildAuditEvent } from "../../../functions/_connect/audit.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { validateBundle } from "../../../functions/_connect/canonical/validate.js";
import { enforceScope } from "../../../functions/_connect/permission.js";
import { RESOURCE_KEYS } from "../../../functions/_connect/canonical/model.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import * as F from "./fixtures/ndhm-synthetic.mjs";

// The engine's permission scope-filter (engine.js §8, defense-in-depth). Mirrored verbatim so the push
// side reuses EXACTLY the pull tail's drop rule; engine.js is NOT edited or imported for this inline step.
const SCOPE_TO_KEY = { Encounter: "encounters", Condition: "conditions", MedicationStatement: "medications", AllergyIntolerance: "allergies", Observation: "observations", DiagnosticReport: "diagnosticReports", DocumentReference: "documents" };
function scopeFilter(bundle, scope) {
  for (const key of RESOURCE_KEYS) {
    const type = Object.keys(SCOPE_TO_KEY).find((t) => SCOPE_TO_KEY[t] === key);
    if (type && !scope.includes(type)) bundle[key] = [];
  }
  return bundle;
}

// ---- the tail: a (synthetic) decrypted NDHM document flows normalize -> validate -> scope-filter -> MaiK ----
test("decrypted synthetic bundle flows the engine tail -> correct SCCM counts, scope-filtered", () => {
  const bundle = normalizeNdhm(makeCtx(), F.opConsultRecord);   // synthetic; stands in for the Fidelius-decrypted doc

  // normalize -> full SCCM counts before filtering
  assert.equal(bundle.conditions.length, 1);
  assert.equal(bundle.medications.length, 1);
  assert.equal(bundle.allergies.length, 1);
  assert.equal(bundle.documents.length, 1);           // the Composition captured by-reference

  // validate (engine §7) — the ABDM normalizer output passes the SAME validator as the pull side
  assert.equal(validateBundle(bundle).ok, true);

  // permission scope-filter (engine §8): granted ∩ requested, then drop out-of-scope resource types
  const granted = ["Condition", "MedicationStatement", "AllergyIntolerance", "Observation", "DocumentReference"];
  const scope = enforceScope(granted, ["Condition", "DocumentReference"]);   // requested subset
  assert.deepEqual(scope, ["Condition", "DocumentReference"]);
  scopeFilter(bundle, scope);
  assert.equal(bundle.conditions.length, 1);          // in scope -> kept
  assert.equal(bundle.documents.length, 1);           // in scope -> kept
  assert.equal(bundle.medications.length, 0);         // out of scope -> dropped
  assert.equal(bundle.allergies.length, 0);           // out of scope -> dropped

  // MaiK context reflects the scope-filtered SCCM (deterministic, SCCM-only, no vendor/source ids)
  const ctx = buildMaikContext(bundle);
  assert.equal(ctx.problems.length, 1);
  assert.equal(ctx.problems[0].label, "Enteric fever");
  assert.equal(ctx.medications.length, 0);
  assert.equal(ctx.allergies.length, 0);
  assert.equal(JSON.stringify(ctx).includes("sourceConnector"), false);
});

// ---- R7: live bundle NEVER opens egress on mode alone; requires the no-retention BAA/DPA flag ----
test("assertEgressAllowed BLOCKS a live consented bundle without the BAA/DPA flag (R7)", () => {
  const bundle = normalizeNdhm(makeCtx(), F.opConsultRecord);
  assert.throws(() => assertEgressAllowed(bundle, { mode: "live" }), EgressBlocked);
  assert.throws(() => assertEgressAllowed(bundle, { mode: "live", egressBaaOk: false }), EgressBlocked);
  assert.throws(() => assertEgressAllowed(bundle, null), EgressBlocked);   // no tenant -> fail closed
});

test("assertEgressAllowed ALLOWS egress only with the no-retention-provider BAA/DPA flag (R7)", () => {
  const bundle = normalizeNdhm(makeCtx(), F.opConsultRecord);
  assert.doesNotThrow(() => assertEgressAllowed(bundle, { mode: "live", egressBaaOk: true }));
});

// ---- no-regression: the existing Phase-0 sandbox-safe behavior (maik-context.test.mjs) is preserved ----
test("no regression: sandbox egress stays allowed, non-BAA live stays blocked (Phase-0 intent)", () => {
  assert.doesNotThrow(() => assertEgressAllowed({}, { mode: "sandbox" }));
  assert.throws(() => assertEgressAllowed({}, { mode: "live" }), EgressBlocked);
});

// ---- R14: audit ALLOW-list keeps consentId/transactionId/careContextHash, drops everything else ----
test("buildAuditEvent RETAINS consentId/transactionId/careContextHash (R14)", () => {
  const e = buildAuditEvent({ consentId: "consent-1", transactionId: "txn-1", careContextHash: "cc-hmac-abc", action: "consent.granted", tenantId: "t1" });
  assert.equal(e.consentId, "consent-1");
  assert.equal(e.transactionId, "txn-1");
  assert.equal(e.careContextHash, "cc-hmac-abc");
  assert.equal(e.action, "consent.granted");   // new metadata-only event type carried in `action`
  assert.equal(e.tenantId, "t1");
});

test("buildAuditEvent DROPS raw careContextReference and raw ABHA (only the HMAC survives) (R14)", () => {
  const e = buildAuditEvent({ careContextReference: "hospital-A/opd/2026/ctx-77", abha: "ramesh1985@sbx", careContextHash: "cc-hmac-abc", action: "data.received" });
  assert.equal("careContextReference" in e, false);   // raw reference NEVER audited
  assert.equal("abha" in e, false);                    // raw ABHA NEVER audited
  assert.equal(e.careContextHash, "cc-hmac-abc");      // only the HMAC survives
  assert.equal(e.action, "data.received");
});

test("no regression: buildAuditEvent still drops arbitrary PHI-ish keys (content/patientName)", () => {
  const e = buildAuditEvent({ action: "data.failed", tenantId: "t1", patientName: "John Doe", content: "<decrypted>", outcome: "error" });
  assert.equal("patientName" in e, false);
  assert.equal("content" in e, false);
  assert.equal(e.outcome, "error");
});
