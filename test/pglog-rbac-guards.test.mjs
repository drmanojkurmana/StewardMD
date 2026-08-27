/* test/pglog-rbac-guards.test.mjs — the RBAC guards that cannot be unit-tested on this runtime.
 *
 * `mock.module` is unavailable in this Node (test/opd-mrn-alloc.test.mjs and
 * test/followcare-voice-server.test.mjs already fail on it), and these guards live in route handlers
 * and in _opd_org_store.js, which imports Firestore directly rather than taking an injectable deps.
 * Asserting on the source is weaker than exercising it, but it pins the exact lines an audit found
 * missing, so a regression is caught rather than silently reintroduced. Each test names the defect
 * it guards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const PGLOG = read("../functions/api/pglog/[[path]].js");
const ORGSTORE = read("../functions/_opd_org_store.js");

/* An Academic Cell holds PGLOG_CONFIGURE but is deliberately denied VERIFY/ASSESS/ATTEST
 * ("monitoring implementation is not signing a trainee's clinical record"). pg_faculty and pg_hod
 * both carry all three, and setMembership is an upsert, so POSTing your own email with
 * role:"pg_hod" handed you the sign-off powers the separation exists to deny. */
test("enrol refuses to change the caller's own role", () => {
  assert.match(PGLOG, /cannot_assign_self/, "the self-assignment refusal must exist");
  const i = PGLOG.indexOf("cannot_assign_self");
  const j = PGLOG.indexOf("ORG.setMembership");
  assert.ok(i > -1 && j > -1 && i < j,
    "the refusal must come BEFORE setMembership, or the row is already overwritten");
  assert.match(PGLOG, /M\.sameActor\(identity, ctx\.actorUid\)/,
    "compare with sameActor, which normalises the fb: namespace");
});

/* Re-enrolling an already-scoped HoD to fix a typo silently promoted them to institution-wide
 * access: M.membership() fills an omitted scope with empty arrays, empty scope means whole-org, and
 * wUpdate's mask writes every key present. */
test("setMembership preserves an existing scope when the caller omits one", () => {
  assert.match(ORGSTORE, /const prev = \(await getMembership\(env, orgId, identity\)\) \|\| null;/,
    "it must read the existing membership first");
  assert.match(ORGSTORE, /scope: b\.scope !== undefined \? b\.scope : \(prev && prev\.scope\)/,
    "an omitted scope must fall back to the stored one, not to the model default");
  assert.match(ORGSTORE, /active: b\.active !== undefined/,
    "an omitted active flag must not silently re-enable a disabled member");
  assert.doesNotMatch(ORGSTORE, /scope: \(body \|\| \{\}\)\.scope,/,
    "the overwriting form must be gone");
});

/* /residents enforced the caller's recorded department scope; /dashboard/dept did not, so an HoD
 * scoped to one department could ask for another - or omit the parameter - and receive the whole
 * institution's roster. */
test("the department dashboard enforces the caller's recorded department scope", () => {
  const start = PGLOG.indexOf('id === "dept" && method === "GET"');
  assert.ok(start > -1, "the dept dashboard route must still exist");
  const body = PGLOG.slice(start, start + 2600);
  assert.match(body, /ctx\.member && ctx\.member\.scope && ctx\.member\.scope\.departments/,
    "it must read the membership scope");
  assert.match(body, /deptScope\.indexOf\(departmentId\) < 0\) return json\(\{ error: "forbidden" \}/,
    "asking for a department outside your scope must be refused");
});

/* Both fields are printed by the public verification page, and the certificate digest covers
 * residentId/programmeId/orgId but NOT the name - so a rename after signing left the QR reporting
 * "valid" beside a different person's name. */
test("a resident cannot self-edit the identity fields a certificate is checked against", () => {
  const m = PGLOG.match(/const structural = \[([\s\S]*?)\]/);
  assert.ok(m, "the structural field list must exist");
  for (const field of ["name", "smdId", "batch"]) {
    assert.ok(m[1].includes(`"${field}"`), `${field} must require PGLOG_CONFIGURE`);
  }
});

/* context() resolves an SMD-XXXXXX code to the internal id. Querying the raw parameter authorised
 * correctly and then returned an empty list, which the console renders as "None yet". */
test("listing routes query the RESOLVED org id, not the raw parameter", () => {
  assert.match(PGLOG, /listProgrammes\(env, ctx\.orgId\)/, "programmes must use ctx.orgId");
  assert.doesNotMatch(PGLOG, /listProgrammes\(env, q\("orgId"\)\)/, "the raw form must be gone");
  assert.match(PGLOG, /const ctx = await context\(request, env, q\("orgId"\)\);\s*\n\s*const orgId = ctx\.orgId;/,
    "residents must bind orgId from the resolved context");
});
