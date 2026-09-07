/* test/wardsynq-identity-merge.test.mjs — two records, one person. Pure half.
 *
 * node --test test/wardsynq-identity-merge.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES, PatientLink, linkIdFor, resolveIdentity } from "../functions/_wardsynq/identity-merge.js";

const link = (survivorId, mergedId, state = "merged") => PatientLink({
  id: linkIdFor(survivorId, mergedId), patientId: survivorId, mergedId, state,
  reason: "Same date of birth, same phone, confirmed with the patient.", mergedBy: "cfa:desk", mergedAt: "2026-09-07T09:00:00.000Z",
});

test("resolving an identity finds every id whose records belong to this person", () => {
  const links = [link("p1", "p2"), link("p1", "p3")];
  const survivor = resolveIdentity("p1", links);
  assert.deepEqual(survivor.absorbed.sort(), ["p2", "p3"]);
  assert.equal(survivor.mergedInto, null);
  assert.equal(survivor.isMerged, false);
  // A complete chart has to read all three, or half the picture stays invisible - which is the
  // actual harm of a duplicate, not the duplication itself.
  assert.deepEqual(survivor.allIds.sort(), ["p1", "p2", "p3"]);

  // And from the absorbed record's side, it knows where it went.
  const absorbed = resolveIdentity("p2", links);
  assert.equal(absorbed.mergedInto, "p1");
  assert.equal(absorbed.isMerged, true);
  assert.deepEqual(absorbed.allIds.sort(), ["p1", "p2"]);
});

test("an unmerged link stops counting immediately", () => {
  const links = [link("p1", "p2", "unmerged"), link("p1", "p3")];
  const r = resolveIdentity("p1", links);
  assert.deepEqual(r.absorbed, ["p3"], "the retracted merge is not resolved");
  assert.deepEqual(r.allIds.sort(), ["p1", "p3"]);
  assert.equal(resolveIdentity("p2", links).isMerged, false, "and p2 is its own person again");
  assert.deepEqual(STATES, ["merged", "unmerged"]);
});

test("a record with no links is simply itself", () => {
  const r = resolveIdentity("p9", []);
  assert.deepEqual(r.allIds, ["p9"]);
  assert.deepEqual(r.absorbed, []);
  assert.equal(r.mergedInto, null);
  assert.equal(r.isMerged, false);
  assert.deepEqual(resolveIdentity("p9", null).allIds, ["p9"]);
});

test("one link per ordered pair, and a record can never be merged into itself", () => {
  assert.equal(linkIdFor("p1", "p2"), "wsq-link-p1-p2");
  assert.equal(linkIdFor("P1", "p2"), linkIdFor("p1", "P2"), "case is not identity");
  // Direction matters: merging p2 into p1 is a different claim from merging p1 into p2.
  assert.notEqual(linkIdFor("p1", "p2"), linkIdFor("p2", "p1"));
  assert.equal(linkIdFor("p1", "p1"), null, "a record cannot absorb itself");
  assert.equal(linkIdFor("", "p2"), null);
  assert.equal(linkIdFor("p1", ""), null);
});

test("the link records the claim, and the retraction, without losing either", () => {
  const l = link("p1", "p2");
  assert.equal(l.state, "merged");
  assert.match(l.reason, /confirmed with the patient/);
  assert.equal(l.mergedBy, "cfa:desk");
  // Retracting keeps who made the original claim: a merge that erased its own author on being
  // undone would make the mistake untraceable.
  const undone = PatientLink({ ...l, state: "unmerged", unmergedBy: "cfa:other", unmergedAt: "2026-09-07T11:00:00.000Z", unmergeReason: "Different people, same name." });
  assert.equal(undone.mergedBy, "cfa:desk");
  assert.equal(undone.mergedAt, "2026-09-07T09:00:00.000Z");
  assert.equal(undone.unmergedBy, "cfa:other");
  assert.match(undone.unmergeReason, /Different people/);
  // `patientId` is the survivor, so a survivor's own byPatient read finds its links.
  assert.equal(l.patientId, l.survivorId);
});
