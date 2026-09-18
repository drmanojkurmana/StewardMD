/* test/wardsynq-registry-newest.test.mjs - the recall registry reads the newest first (R6-5).
 *
 * The real route is driven: GET /api/queue/ward/registries.
 *
 * Two properties, and the second is the reason this read is NOT period-scoped:
 *  - the cohort reads walk back from the newest record, so a hospital past the read ceiling loses its
 *    OLDEST records, not the patients who joined the register most recently;
 *  - a patient whose last qualifying result is years old is still found, with that result. A window
 *    would turn "reviewed three years ago" into "never reviewed", which is the most overdue state
 *    there is and would put the wrong people at the top of a recall list.
 *
 * That past the ceiling listSince keeps the newest is pinned at the service level in
 * test/wardsynq-repository-window.test.mjs; it is not re-seeded with 50,000 records here.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-registry-newest.test.mjs
 */
import { as, seed, docs, H, T, DOCTOR, ORG_ID } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const REGISTRIES = [{ id: "diabetes", name: "Diabetes register", problemCodes: ["E11"], review: { everyMonths: 12, observationCode: "HbA1c", display: "HbA1c" } }];

function withRegistries() {
  seed({ enabled: true });
  const org = docs.get(`q_orgs/${ORG_ID}`);
  org.fields.wardsynq = { ...org.fields.wardsynq, registries: REGISTRIES };
}
const put = (rec, key) => H.RECORD.append(T, [{ version: 1, ...rec }], { idempotencyKey: key });
const at = (ms) => ({ meta: { recordedAt: iso(ms) }, writtenBy: { id: "seed", kind: "human", at: iso(ms) } });

test("a patient whose qualifying result is years old is still found, and the reads walk back from the newest", async () => {
  withRegistries();
  const old = Date.now() - 3 * 365 * DAY;
  await put({ resourceType: "Patient", id: "p-old", mrn: "MRN-1", name: "Old Cohort", dob: "1960-01-01", ...at(old) }, "s-pat");
  await put({ resourceType: "Condition", id: "c-old", patientId: "p-old", code: "E11", display: "Type 2 diabetes", clinicalStatus: "active", ...at(old) }, "s-cond");
  /* Recorded two years ago, so it is overdue against a 12-month interval - but it EXISTS, and a read
   * that dropped it would report this patient as never reviewed. */
  const lastReview = Date.now() - 2 * 365 * DAY;
  await put({ resourceType: "Observation", id: "o-old", patientId: "p-old", code: "HbA1c", display: "HbA1c", value: 62, effectiveAt: iso(lastReview), ...at(lastReview) }, "s-obs");
  // Newer records of somebody else: what an oldest-first read would have kept instead, past its ceiling.
  for (let i = 0; i < 20; i++) await put({ resourceType: "Condition", id: "c-new-" + i, patientId: "p-new-" + i, code: "I10", display: "Hypertension", clinicalStatus: "active", ...at(Date.now()) }, "s-new-" + i);

  const calls = [];
  const inner = H.RECORD.pageByType.bind(H.RECORD);
  H.RECORD.pageByType = async (tenantId, type, opts) => { calls.push({ type, newest: !!(opts && opts.newest) }); return inner(tenantId, type, opts); };
  const r = await as(DOCTOR, `/ward/registries?orgId=${ORG_ID}`);
  H.RECORD.pageByType = inner;

  assert.equal(r.__status, 200, r.__text);
  const reg = r.registries[0];
  assert.equal(reg.total, 1, "the hypertensives are not in this cohort");
  assert.equal(reg.neverReviewed, 0, "a result years old is a result, not a blank");
  assert.equal(reg.members[0].patientId, "p-old");
  assert.equal(reg.members[0].review.state, "overdue");
  assert.equal(reg.members[0].review.lastReview, iso(lastReview), "the old qualifying result is the one reported");
  assert.equal(r.truncated, false);

  for (const type of ["Condition", "Observation", "Patient"]) {
    const of = calls.filter((c) => c.type === type);
    assert.ok(of.length > 0, `${type} was read`);
    assert.ok(of.every((c) => c.newest), `${type} was read newest first, so the ceiling drops the oldest`);
  }
});

test("a resolved diagnosis still leaves the cohort, and a refuted one never joins it", async () => {
  withRegistries();
  const now = Date.now();
  await put({ resourceType: "Condition", id: "c-res", patientId: "p-res", code: "E11", display: "Type 2 diabetes", clinicalStatus: "resolved", ...at(now) }, "s-res");
  await put({ resourceType: "Condition", id: "c-ref", patientId: "p-ref", code: "E11", display: "Type 2 diabetes", clinicalStatus: "active", verificationStatus: "refuted", ...at(now) }, "s-ref");
  const r = await as(DOCTOR, `/ward/registries?orgId=${ORG_ID}`);
  assert.equal(r.__status, 200, r.__text);
  assert.equal(r.registries[0].total, 0);
});

test("no session is 401, and a role with no authority to read a chart is 403", async () => {
  withRegistries();
  assert.equal((await as(null, `/ward/registries?orgId=${ORG_ID}`)).__status, 401);
  assert.equal((await as("cashier@example.test", `/ward/registries?orgId=${ORG_ID}`)).__status, 403);
});
