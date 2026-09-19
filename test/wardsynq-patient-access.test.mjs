/* test/wardsynq-patient-access.test.mjs — letting a patient read their own record, safely.
 *
 * node --test test/wardsynq-patient-access.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRANT_TYPE, MAX_ATTEMPTS, CODE_DIGITS, CODE_TTL_MINUTES, SESSION_TTL_MINUTES,
  makeCode, hashSecret, sameSecret, accessEnabled, minutesOr, redeemable, sessionLive,
  AccessGrant, patientActor, accessActor,
} from "../functions/_wardsynq/patient-access.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";
import { TIER } from "../wardsynq/wardsynq-actors.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/patient-access.js", import.meta.url), "utf8");
const PORTAL = readFileSync(new URL("../functions/api/portal/[[path]].js", import.meta.url), "utf8");

test("IT IS OFF UNLESS A HOSPITAL TURNS IT ON, and absent config is off", () => {
  /* A clinical system does not acquire a new authentication surface because a dependency shipped. */
  assert.equal(accessEnabled(null), false);
  assert.equal(accessEnabled({}), false);
  assert.equal(accessEnabled({ enabled: "yes" }), false, "only a real true enables it");
  assert.equal(accessEnabled({ enabled: 1 }), false);
  assert.equal(accessEnabled({ enabled: true }), true);
});

test("THE PATIENT SESSION CAN WRITE NOTHING, and is not mistakable for a clinician", () => {
  const a = patientActor("pat-1");
  assert.equal(a.tier, TIER.READ);
  assert.deepEqual([...a.scope.write], [], "an empty write scope, whatever route it reaches");
  /* There is no patient kind in the ladder and inventing one would change the ceiling table every
   * other actor is clamped by. The id prefix is what makes the audit unambiguous. */
  assert.ok(a.id.startsWith("patient:"));
  // It can read the handout's types and not the notes.
  assert.ok(a.scope.read.includes("DiagnosticReport"));
  assert.ok(!a.scope.read.includes("ClinicalNote"));
  assert.ok(!a.scope.read.includes("Observation"), "not the raw vitals and laboratory values either");

  // The access machinery itself touches grants and nothing else.
  assert.deepEqual([...accessActor().scope.write], [GRANT_TYPE]);
  assert.deepEqual([...accessActor().scope.read], [GRANT_TYPE]);
});

test("THE CODE IS HASHED AT REST AND SALTED PER GRANT", async () => {
  const h1 = await hashSecret("12345678", "grant-a");
  const h2 = await hashSecret("12345678", "grant-b");
  assert.notEqual(h1, h2, "two patients issued the same digits do not share a hash");
  assert.equal(h1.length, 64);
  assert.equal(await hashSecret("12345678", "grant-a"), h1, "and it is deterministic");

  // The stored record carries digests and never the secrets.
  const g = AccessGrant({ id: "g1", patientId: "pat-1", issuedBy: "dr", issuedAt: "2026-09-08T09:00:00.000Z", codeHash: h1 });
  const asText = JSON.stringify(g);
  assert.ok(!asText.includes("12345678"), "a grant readable by staff must not be a way to become the patient");
  assert.ok(asText.includes(h1));
});

test("comparison is constant-time-shaped and never leaks a prefix", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("abc", "abcd"), false);
  assert.equal(sameSecret("", ""), false, "empty is never a match");
  assert.equal(sameSecret(null, null), false);
  assert.equal(sameSecret(undefined, ""), false);
  // No === on the digests anywhere in the file.
  assert.ok(!/tokenHash\s*===|codeHash\s*===/.test(SRC));
});

test("ATTEMPTS ARE CAPPED ON THE GRANT, not in a gateway the next deployment forgets", () => {
  const base = { issuedAt: "2026-09-08T09:00:00.000Z" };
  const now = "2026-09-08T09:10:00.000Z";
  assert.equal(redeemable({ ...base, failedAttempts: MAX_ATTEMPTS - 1 }, now).ok, true);
  const burnt = redeemable({ ...base, failedAttempts: MAX_ATTEMPTS }, now);
  assert.equal(burnt.ok, false);
  assert.equal(burnt.reason, "too_many_attempts");
  assert.equal(MAX_ATTEMPTS, 5);
  assert.equal(CODE_DIGITS, 8);
});

test("REVOKED BEATS EXPIRED BEATS ATTEMPTS, because they mean different things in an audit", () => {
  const old = { issuedAt: "2026-09-01T09:00:00.000Z", failedAttempts: 99, revokedAt: "2026-09-02T00:00:00.000Z" };
  assert.equal(redeemable(old, "2026-09-08T09:00:00.000Z").reason, "revoked",
    "a revoked grant never reports as merely expired");
  assert.equal(redeemable({ issuedAt: "2026-09-01T09:00:00.000Z", failedAttempts: 99 }, "2026-09-08T09:00:00.000Z").reason, "too_many_attempts");
  assert.equal(redeemable({ issuedAt: "2026-09-08T09:00:00.000Z", redeemedAt: "2026-09-08T09:01:00.000Z" }, "2026-09-08T09:02:00.000Z").reason, "already_redeemed");
});

test("AN UNREADABLE TIMESTAMP FAILS CLOSED, never as a fresh code", () => {
  /* The alternative - treating an uncheckable grant as fresh - is the direction that never expires. */
  assert.equal(redeemable({ issuedAt: "not a date" }, "2026-09-08T09:00:00.000Z").reason, "unusable");
  assert.equal(redeemable({ issuedAt: "2026-09-08T09:00:00.000Z" }, "nonsense").reason, "unusable");
  assert.equal(sessionLive({ redeemedAt: "" }, "2026-09-08T09:00:00.000Z").reason, "unusable");
});

test("a code and a session both EXPIRE, and a bad TTL falls back rather than to zero", () => {
  assert.equal(redeemable({ issuedAt: "2026-09-08T08:00:00.000Z" }, "2026-09-08T09:01:00.000Z").reason, "expired");
  assert.equal(redeemable({ issuedAt: "2026-09-08T08:30:00.000Z" }, "2026-09-08T09:00:00.000Z").ok, true);
  assert.equal(sessionLive({ redeemedAt: "2026-09-08T08:00:00.000Z" }, "2026-09-08T09:00:00.000Z").reason, "expired");
  assert.equal(sessionLive({ redeemedAt: "2026-09-08T08:50:00.000Z" }, "2026-09-08T09:00:00.000Z").ok, true);

  // Number("") is 0 and 0 is finite: a blank TTL is the default, never "expires instantly" nor "never".
  assert.equal(minutesOr("", 60), 60);
  assert.equal(minutesOr(0, 60), 60);
  assert.equal(minutesOr(-5, 60), 60);
  assert.equal(minutesOr("15", 60), 15);
  assert.equal(CODE_TTL_MINUTES, 60);
  assert.equal(SESSION_TTL_MINUTES, 30);
});

test("the code is DIGITS, because it is read aloud across a desk", () => {
  const c = makeCode(new Uint8Array([10, 21, 32, 43, 54, 65, 76, 87]));
  assert.equal(c, "01234567");
  assert.equal(c.length, CODE_DIGITS);
  assert.ok(/^[0-9]+$/.test(makeCode()));
});

test("THE PATIENT ID COMES FROM THE GRANT AND NEVER FROM THE REQUEST", () => {
  /* This is the entire containment: a scope is by type, not by person, so a session that took a
   * patient id from the caller would read any chart in the hospital. */
  assert.ok(/const patientId = str\(grant\.patientId\)/.test(SRC));
  // portalRead's context is grantId and token only.
  const portalFn = SRC.slice(SRC.indexOf("async function portalRead"), SRC.indexOf("async function revokeAccess"));
  assert.ok(!/ctx\.patientId/.test(portalFn), "portalRead never reads a patient id off the request");
});

test("THE PATIENT'S DOOR IS OUTSIDE THE CLINICAL BLOCK and can reach nothing else", () => {
  /* The one place a non-employee can read a chart must not sit inside the block whose every other
   * line assumes an employee, where a later edit widens it by accident. */
  /* Comments stripped: this file's header legitimately explains what it does NOT import, and
   * matching that prose would test the documentation rather than the code. */
  const code = PORTAL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/enrolPatient|revokeAccess/.test(code), "the clinician-only operations are not importable from here");
  assert.ok(!/resolveClinicalActor|actorDeps/.test(code), "no staff identity is resolved");
  assert.ok(/redeemCode, portalRead/.test(code), "exactly two operations");
  // POST only: a token in a query string ends up in every access log on the way.
  assert.ok(/request\.method !== "POST"/.test(code));
  // No patient id is accepted from the body.
  assert.ok(!/body\.patientId/.test(code));
});

test("a wrong code and a missing grant return the SAME answer", () => {
  /* Distinguishing them turns the redeem route into an oracle for which grant ids exist. */
  const redeemFn = SRC.slice(SRC.indexOf("async function redeemCode"), SRC.indexOf("async function portalRead"));
  assert.ok(/const deny = /.test(redeemFn));
  assert.ok((redeemFn.match(/return deny;/g) || []).length >= 2, "both paths return the same object");
});

test("THE PATIENT PAGE KEEPS NOTHING ON THE PHONE", () => {
  const page = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
  const code = page.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
  /* A shared or borrowed phone is the NORMAL case for this page, not the edge case. A token that
   * survives closing the tab is a chart the next person to pick it up can open. */
  assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(code));
  // A patient record page has no business in a search index.
  assert.ok(/noindex/.test(page));
  // No third-party anything: a page a patient opens to read their diagnoses is not a place for one.
  assert.ok(!/https?:\/\//.test(code), "every request is to this hospital's own API");
  assert.ok(/credentials: "omit"/.test(code));
  // It renders the withheld items rather than dropping them.
  assert.ok(/Not included here/.test(page));
  // And it escapes everything it prints from the record.
  assert.ok(/function esc\(/.test(code));
});

test("enrolment is in person and the grant is append-only", () => {
  // No self-registration exists anywhere: enrolment resolves a clinical actor.
  const enrolFn = SRC.slice(SRC.indexOf("async function enrolPatient"), SRC.indexOf("async function redeemCode"));
  assert.ok(/resolveClinicalActor/.test(enrolFn));
  assert.ok(/identification_required/.test(enrolFn), "how the person was identified is required");
  assert.ok(RESOURCE_TYPES.includes(GRANT_TYPE), "so a revocation cannot be deleted afterwards");
});
