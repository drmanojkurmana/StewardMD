/* test/wardsynq-billing-view.test.mjs — the money reads the chart and never writes to it.
 *
 * These check the ADAPTER's own judgements: which entries on a problem list count as documentation,
 * what the coder is told when a code is refused, and - the one that matters most - that the grant a
 * billing role resolves to cannot write a clinical fact. The claims engine itself is tested in
 * test/wardsynq-billing.test.mjs and nothing here re-tests it.
 *
 * node --test test/wardsynq-billing-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicalView, conditionDetail, CLAIM_TYPE, PREAUTH_TYPE } from "../functions/_wardsynq/billing.js";
import { codeClaim, supportFor, detectUpcoding, SUPPORT, BillingError } from "../wardsynq/wardsynq-billing.js";
import { grantForRole } from "../functions/_wardsynq/actor.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";

const cond = (over) => ({ resourceType: "Condition", code: "E11.9", display: "Type 2 diabetes", clinicalStatus: "active", verificationStatus: "confirmed", ...(over || {}) });

test("A DIFFERENTIAL IS NOT A DIAGNOSIS, and a refuted one is the opposite of evidence", () => {
  /* "One of the things it might be" is exactly the entry a charge should never be built on, and a
   * condition that turned out to be false supporting a claim is backwards. Both are withheld from
   * the view the coder's support is computed against. */
  const view = clinicalView([
    cond(),
    cond({ code: "I10", verificationStatus: "differential" }),
    cond({ code: "N18.3", verificationStatus: "refuted" }),
    cond({ code: "J44.9", verificationStatus: "provisional" }),
  ]);
  assert.deepEqual(view.conditions.map((c) => c.code), ["E11.9", "J44.9"]);

  // A working diagnosis is what the treating team actually thinks, and it counts.
  assert.equal(supportFor("J44.9", view).support, SUPPORT.DOCUMENTED);
  // The differential does not, however confidently it is typed into the claim.
  assert.equal(supportFor("I10", view).support, SUPPORT.UNSUPPORTED);
  assert.equal(supportFor("N18.3", view).support, SUPPORT.UNSUPPORTED);
});

test("a withheld code is EXPLAINED, not silently absent from the answer", () => {
  /* A coder told only "unsupported" about a code that IS on the problem list would reasonably
   * conclude the record is broken and go looking for somebody to add it - which is the exact motion
   * this module exists to prevent. So the reason is said. */
  const conditions = [cond({ code: "I10", verificationStatus: "differential" })];
  const d = conditionDetail("I10", conditions);
  assert.equal(d.verificationStatus, "differential");
  assert.match(d.withheld, /not a diagnosis/);

  // A confirmed one carries its status and no withholding note.
  assert.equal(conditionDetail("E11.9", [cond()]).withheld, undefined);
  // A code nowhere on the list has no detail at all, which is different from being withheld.
  assert.equal(conditionDetail("Z00.0", [cond()]), null);
});

test("THIS RECORD CANNOT SUPPORT A SEVERITY, and says so rather than inventing one", () => {
  /* `Condition` has no severity field in this build, so `severityEvidence` is genuinely empty. That
   * is a gap in the chart and billing is not allowed to close it: every severity-tiered code is
   * flagged as unsupported, which is the true answer and the safe direction. */
  const view = clinicalView([cond()]);
  assert.deepEqual(view.severityEvidence, {});

  const claim = codeClaim({
    encounterId: "enc-1", patientId: "pat-1", record: view, codedBy: "cfa:coder",
    codes: [{ code: "E11.9", severity: "severe" }], now: "2026-09-08T10:00:00.000Z",
  });
  const found = detectUpcoding(claim, view);
  assert.equal(found.clean, false);
  assert.equal(found.findings[0].supported, null);
  assert.match(found.findings[0].reason, /no severity evidence/);

  // With no severity claimed there is nothing to flag, so an ordinary claim is not noise.
  const plain = codeClaim({ encounterId: "enc-1", patientId: "pat-1", record: view, codedBy: "cfa:coder", codes: ["E11.9"], now: "2026-09-08T10:00:00.000Z" });
  assert.equal(detectUpcoding(plain, view).clean, true);
});

test("NOTHING IN THIS BUILD INFERS SUPPORT, because nothing records an indication", () => {
  /* The module can accept "an observation or a medication is consistent with this code" via
   * `supportsCodes`, and no order, result or prescription in WardSynQ carries one. So the view
   * offers neither list, every code is either on the problem list or refused, and no mapping from a
   * potassium to an ICD code is invented anywhere. */
  const view = clinicalView([cond()]);
  assert.equal(view.observations, undefined);
  assert.equal(view.medications, undefined);

  assert.throws(
    () => codeClaim({ encounterId: "enc-1", patientId: "pat-1", record: view, codedBy: "cfa:coder", codes: ["I10"], now: "2026-09-08T10:00:00.000Z" }),
    (e) => e instanceof BillingError && e.code === "UNSUPPORTED_CODE" && /cannot create its own justification/.test(e.message));
});

test("THE GRANT IS THE GUARANTEE: billing cannot write the diagnosis that justifies its own charge", () => {
  const cashier = grantForRole("cashier");
  /* Not a promise in a module header. A role holding BILLING_CHARGE and no EMR capability may write
   * a Claim and a funding decision, and the record service refuses everything else - so the motion
   * this whole module exists to prevent is refused one layer below it. */
  assert.deepEqual(cashier.write, [CLAIM_TYPE, PREAUTH_TYPE]);
  assert.ok(!cashier.write.includes("Condition"));
  assert.ok(!cashier.write.includes("Observation"));
  assert.ok(!cashier.write.includes("ClinicalNote"));

  /* Read is the problem list plus, since charge capture (#942), the four "what was DONE" types.
   * Both of those earned their place: coding asks whether a diagnosis is documented, and charge
   * capture asks what actually happened. Neither needs the notes, and the coder still does not get
   * the vitals or the laboratory values - a coder handed the whole chart to answer two questions
   * has been given it for no reason. */
  assert.ok(cashier.read.includes("Condition"));
  assert.ok(cashier.read.includes("DiagnosticReport"), "billing what happened requires knowing what happened");
  assert.ok(!cashier.read.includes("ClinicalNote"));
  assert.ok(!cashier.read.includes("Observation"));
  // And reading that a dose was given never becomes the power to record one.
  assert.ok(!cashier.write.includes("MedicationAdministration"));

  // Pharmacy is deliberately never given BILLING_CHARGE, so it gains nothing from any of this.
  assert.ok(!grantForRole("pharmacy").write.includes(CLAIM_TYPE));

  // Both types are versioned and append-only, which is what makes a claim's coding history survive.
  assert.ok(RESOURCE_TYPES.includes(CLAIM_TYPE));
  assert.ok(RESOURCE_TYPES.includes(PREAUTH_TYPE));
});
