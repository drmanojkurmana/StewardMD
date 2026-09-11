/* test/wardsynq-fhir-identity.test.mjs — TASK 7.11: the people and the place.
 *
 * The rule these tests exist to hold: this server states what it KNOWS about a clinician and
 * nothing else. It holds no practitioner directory - q_members carries a role and not a name - so a
 * Practitioner here carries the actor identifier always, and a name and a council registration
 * number ONLY where a verified registration exists. A name inferred from an email address would be
 * a fabricated clinical identity, and "not verified" and "could not check" are different answers.
 *
 * node --test test/wardsynq-fhir-identity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fhirPractitioner, fhirOrganization, practitionerRead, organizationRead, ACTOR_SYSTEM } from "../functions/_wardsynq/fhir-identity.js";
import { validateResource } from "../functions/_wardsynq/fhir-validate.js";
import { toFhir } from "../functions/_wardsynq/fhir.js";

const VERIFIED = { uid: "fb:dr-menon", regNo: "AP-12345", council: "Andhra Pradesh Medical Council", name: "Dr Anjali Menon", verifiedAt: "2026-01-04T00:00:00.000Z", source: "register" };

/* ---- 1: what is known, and only that ------------------------------------------------------------ */

test("1. a verified clinician carries their registration number, under their own council", () => {
  const p = fhirPractitioner("fb:dr-menon", VERIFIED);
  assert.equal(p.resourceType, "Practitioner");
  assert.equal(p.identifier[0].system, ACTOR_SYSTEM);
  assert.equal(p.identifier[0].value, "fb:dr-menon");
  const reg = p.identifier[1];
  assert.equal(reg.value, "AP-12345");
  assert.equal(reg.type.coding[0].code, "MD", "the v2-0203 code for a medical licence number");
  assert.match(reg.system, /andhra-pradesh-medical-council/, "the council is the namespace: a number is only unique within one");
  assert.equal(reg.assigner.display, "Andhra Pradesh Medical Council");
  assert.equal(p.name[0].text, "Dr Anjali Menon");
  assert.match(p.text.div, /verified/);
});

test("2. an unverified clinician gets NO name, and the resource says why", () => {
  const p = fhirPractitioner("cfa:someone", null);
  assert.deepEqual(p.identifier, [{ system: ACTOR_SYSTEM, value: "cfa:someone" }]);
  assert.equal(p.name, undefined, "a name is never inferred from an account");
  assert.match(p.text.div, /holds no verified medical registration/);
});

test("3. an account name is labelled as an account name, never as a verified identity", () => {
  const p = fhirPractitioner("cfa:doctor@example.test", null, { accountName: "doctor@example.test" });
  assert.equal(p.name[0].text, "doctor@example.test");
  assert.equal(p.name[0].use, "temp", "R4's own word for a name that is not the official one");
  assert.match(p.text.div, /name here is the one on this person's own account/);
  assert.match(p.text.div, /not a verified identity/);
});

test("4. 'could not check' is a different answer from 'none held'", () => {
  const unchecked = fhirPractitioner("cfa:x", null, { unchecked: true });
  assert.match(unchecked.text.div, /could not be checked/);
  assert.match(unchecked.text.div, /neither that one exists nor that one does not/);
  assert.equal(unchecked.name, undefined);
  const none = fhirPractitioner("cfa:x", null);
  assert.ok(!/could not be checked/.test(none.text.div), "and the two sentences are not the same");
});

test("5. both shapes are R4-conformant", () => {
  for (const p of [fhirPractitioner("fb:dr-menon", VERIFIED), fhirPractitioner("cfa:x", null), fhirPractitioner("cfa:x", null, { accountName: "A Name" })]) {
    const issues = validateResource(p).issues.filter((i) => i.severity === "error" || i.severity === "fatal");
    assert.deepEqual(issues, [], JSON.stringify(issues));
  }
});

test("5b. a US prescriber's identifier is an NPI under the standard system, not a council namespace", () => {
  const p = fhirPractitioner("fb:dr-menon", VERIFIED, { region: "US" });
  const reg = p.identifier[1];
  assert.equal(reg.system, "http://hl7.org/fhir/sid/us-npi", "the standard NPI system HL7 publishes, not urn:stewardmd:council:*");
  assert.equal(reg.type.coding[0].code, "NPI", "the v2-0203 code for a national provider identifier, not MD");
  assert.equal(reg.value, "AP-12345");
  assert.equal(reg.assigner, undefined, "there is no council to assign it: the system itself says who issues it");

  // An Indian hospital (the default region, and every hospital that predates region) is unchanged.
  const india = fhirPractitioner("fb:dr-menon", VERIFIED);
  assert.match(india.identifier[1].system, /urn:stewardmd:council:/);
  assert.equal(india.identifier[1].type.coding[0].code, "MD");
});

/* ---- 6: the hospital ----------------------------------------------------------------------------- */

test("6. the organisation is the hospital's own record, with a real code and an honest local one", () => {
  const o = fhirOrganization({ id: "org-a", code: "SMD-ABC123", name: "General Hospital", kind: "institution" });
  assert.equal(o.resourceType, "Organization");
  assert.equal(o.name, "General Hospital");
  assert.deepEqual(o.identifier, [{ system: "urn:stewardmd:org", value: "SMD-ABC123" }]);
  const codings = o.type[0].coding;
  assert.equal(codings[0].system, "http://terminology.hl7.org/CodeSystem/organization-type");
  assert.equal(codings[0].code, "prov", "a real code from FHIR's own value set");
  assert.equal(codings[1].system, "urn:stewardmd:org-kind", "and this system's own distinction, clearly marked as local");
  assert.equal(codings[1].code, "institution");
  assert.deepEqual(validateResource(o).issues.filter((i) => i.severity === "error"), []);
});

test("7. the organisation door answers about this hospital and no other", async () => {
  const getOrg = async (env, id) => (id === "org-a" ? { id: "org-a", code: "C", name: "A", kind: "clinic" } : { id, code: "X", name: "Somebody else", kind: "clinic" });
  const mine = await organizationRead(null, {}, { orgId: "org-a", id: "org-a", getOrg });
  assert.equal(mine.ok, true);
  assert.equal(mine.resource.name, "A");

  const theirs = await organizationRead(null, {}, { orgId: "org-a", id: "org-b", getOrg });
  assert.equal(theirs.ok, false);
  assert.equal(theirs.status, 404);
  assert.match(theirs.outcome.issue[0].diagnostics, /answers only about the hospital it belongs to/);
});

/* ---- 8: the read, and the register behind it ----------------------------------------------------- */

test("8. the read carries a verified registration when there is one", async () => {
  const r = await practitionerRead(null, {}, { id: "fb:dr-menon", signerDeps: { signer: VERIFIED } });
  assert.equal(r.ok, true);
  assert.equal(r.resource.id, "fb:dr-menon", "served under the id it was asked for");
  assert.equal(r.resource.identifier[1].value, "AP-12345");
});

test("9. an unreachable register does not fail the read, and does not assert anything either way", async () => {
  const boom = { get: async () => { throw new Error("kv down"); } };
  const r = await practitionerRead(null, {}, { id: "cfa:x", signerDeps: { kv: boom, getUserClaims: async () => { throw new Error("idp down"); } } });
  assert.equal(r.ok, true, "an identity read is not an outage: it asserts nothing about verification");
  assert.match(r.resource.text.div, /could not be checked/);
  assert.equal(r.resource.name, undefined);
});

/* ---- 10: what the exported resources now carry --------------------------------------------------- */

test("10. every clinician on an exported resource is a matchable identifier, not a bare string", () => {
  const note = toFhir({ resourceType: "ClinicalNote", id: "note-1", patientId: "pat-1", noteType: "progress",
    sections: { text: "seen" }, authorId: "cfa:doc", signedBy: "cfa:consultant", version: 1,
    meta: { recordedAt: "2026-09-09T00:00:00.000Z", effectiveAt: "2026-09-09T00:00:00.000Z", source: { system: "wardsynq-native", sourceId: null } } });
  assert.equal(note.author[0].identifier.system, ACTOR_SYSTEM);
  assert.equal(note.author[0].identifier.value, "cfa:doc");
  assert.equal(note.author[0].display, "cfa:doc", "the display a human reader had before is kept");
  assert.equal(note.authenticator.identifier.value, "cfa:consultant");
  // A logical reference carries no literal one: this server has no Practitioner resource to point at.
  assert.equal(note.author[0].reference, undefined);
  assert.deepEqual(validateResource(note).issues.filter((i) => i.severity === "error"), []);
});
