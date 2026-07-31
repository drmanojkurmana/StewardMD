// test/connect/abdm/purpose-bound.test.mjs — Stage-6 Task-5: DPDP §14.2 / R15 purpose-binding + no-secondary-use.
// The consumed bundle is TAGGED by the engine consume tail with the consented purpose.code + the DPDP role split,
// and every downstream use is BOUND to that purpose (assertPurposeBound). A use whose purpose differs from the
// consented one (analytics / training / a different clinical purpose) is REFUSED (SecondaryUseBlocked). An
// untagged bundle fails CLOSED (never all-purpose). R7 is preserved: a live consumed bundle still cannot reach
// LLM egress without the BAA/DPA flag, and the two guards (purpose-bound + egress) compose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeNdhmBundle } from "../../../functions/_connect/engine.js";
import { assertPurposeBound, SecondaryUseBlocked, assertEgressAllowed, EgressBlocked } from "../../../functions/_connect/maik-context.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import * as F from "./fixtures/ndhm-synthetic.mjs";

const CARE = { purpose: { code: "CAREMGT", text: "Care Management" } };   // the consented purpose (object shape)

// ── assertPurposeBound: the no-secondary-use gate ──────────────────────────────────────────────────────────
test("a matching purpose is allowed (object OR string keys to the same value)", () => {
  const b = { meta: { consentPurpose: "CAREMGT" } };
  assert.doesNotThrow(() => assertPurposeBound(b, { code: "CAREMGT" }));
  assert.doesNotThrow(() => assertPurposeBound(b, "CAREMGT"));
});

test("a DIFFERENT purpose (secondary use: analytics/training/other clinical) is refused", () => {
  const b = { meta: { consentPurpose: "CAREMGT" } };
  for (const p of [{ code: "BTG" }, "analytics", "training", { code: "CAREMGT-X" }]) {
    assert.throws(() => assertPurposeBound(b, p), SecondaryUseBlocked, "secondary use must be blocked: " + JSON.stringify(p));
  }
});

test("an untagged bundle fails CLOSED (never treated as all-purpose)", () => {
  assert.throws(() => assertPurposeBound({ meta: {} }, { code: "CAREMGT" }), SecondaryUseBlocked);
  assert.throws(() => assertPurposeBound({ meta: { consentPurpose: null } }, "CAREMGT"), SecondaryUseBlocked);
  assert.throws(() => assertPurposeBound({}, "CAREMGT"), SecondaryUseBlocked);        // no meta
  assert.throws(() => assertPurposeBound(null, "CAREMGT"), SecondaryUseBlocked);      // no bundle
  // an absent REQUESTED purpose also fails closed (purposeKey(null) == null must not read as a match)
  assert.throws(() => assertPurposeBound({ meta: { consentPurpose: "CAREMGT" } }, null), SecondaryUseBlocked);
});

// ── engine consume tail: stamps the DPDP evidence, NO PHI in meta ──────────────────────────────────────────
test("the engine consume tail stamps meta.consentPurpose + meta.dpdpRole (no PHI in meta)", () => {
  const bundle = consumeNdhmBundle(makeCtx(), F.opConsultRecord, CARE);
  assert.equal(bundle.meta.consentPurpose, "CAREMGT");
  assert.deepEqual(bundle.meta.dpdpRole, { fiduciary: "hospital", processor: "stewardmd-connect" });
  // the stamp is the SAME purposeKey the request-time revalidate binds: a matching use passes, a different one is blocked
  assert.doesNotThrow(() => assertPurposeBound(bundle, { code: "CAREMGT" }));
  assert.throws(() => assertPurposeBound(bundle, { code: "training" }), SecondaryUseBlocked);
  // meta carries ONLY the purpose key + role strings; no ABHA / careContextReference / decrypted FHIR content
  const metaStr = JSON.stringify(bundle.meta);
  assert.equal(/@(sbx|abdm)|resourceType|careContextReference/.test(metaStr), false, "no PHI in meta");
});

test("an unconsented consume stamps consentPurpose:null so the bundle fails closed at use time", () => {
  const bundle = consumeNdhmBundle(makeCtx(), F.opConsultRecord, null);
  assert.equal(bundle.meta.consentPurpose, null);
  assert.throws(() => assertPurposeBound(bundle, { code: "CAREMGT" }), SecondaryUseBlocked);
});

// ── R7 preserved: the two guards compose; a live bundle still cannot reach LLM egress without the BAA flag ───
test("R7 preserved — a live consumed bundle cannot reach LLM egress without the BAA/DPA flag", () => {
  const bundle = consumeNdhmBundle(makeCtx({ tenant: { id: "t1", mode: "live" } }), F.opConsultRecord, CARE);
  // purpose-bound for the consented use...
  assert.doesNotThrow(() => assertPurposeBound(bundle, { code: "CAREMGT" }));
  // ...yet egress stays BLOCKED on a live tenant without the BAA/DPA flag (R7 unchanged; the guards compose)
  assert.throws(() => assertEgressAllowed(bundle, { mode: "live" }), EgressBlocked);
  assert.doesNotThrow(() => assertEgressAllowed(bundle, { mode: "live", egressBaaOk: true }));
});
