/* test/unverified-purge.test.mjs — the 7-day unverified-account sweep.
 *
 * OWNER DECISION 2026-08-27: "who signs up just gets access to FREE, with auto account deletion
 * after 7 days". This is the destructive path in the codebase, so every rule that SPARES an account
 * gets a test: a StewardMD account can own ICU membership and saved clinical cases, and the sweep
 * runs unattended on a cron.
 *
 * node --test test/unverified-purge.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidePurge, purgeDays, warnDays, purgeEnabled, hardDeleteEnabled,
  PURGE_DAYS_DEFAULT, WARN_DAYS_DEFAULT,
} from "../functions/_lifecycle.js";

const DAY = 86400000;
const now = Date.parse("2026-08-27T10:00:00Z");
const ENV = {};
const rec = (ageDays, extra) => ({ firstSeen: now - ageDays * DAY, email: "d@x.in", ...(extra || {}) });

test("defaults: warn at day 5, remove at day 7", () => {
  assert.equal(PURGE_DAYS_DEFAULT, 7);
  assert.equal(WARN_DAYS_DEFAULT, 5);
  assert.equal(purgeDays(ENV), 7);
  assert.equal(warnDays(ENV), 5);
  assert.equal(purgeDays({ UNVERIFIED_PURGE_DAYS: "14" }), 14);
});

test("BOTH destructive switches are OFF unless explicitly turned on", () => {
  assert.equal(purgeEnabled(ENV), false, "an unattended cron must not delete accounts by default");
  assert.equal(purgeEnabled({ UNVERIFIED_PURGE_ON: "1" }), true);
  assert.equal(hardDeleteEnabled({ UNVERIFIED_PURGE_ON: "1" }), false, "on != hard delete");
  assert.equal(hardDeleteEnabled({ UNVERIFIED_PURGE_HARD_DELETE: "1" }), true);
  // A truthy-looking string must not arm it by accident.
  assert.equal(purgeEnabled({ UNVERIFIED_PURGE_ON: "no" }), false);
  assert.equal(purgeEnabled({ UNVERIFIED_PURGE_ON: "0" }), false);
});

test("the timeline: young -> warn -> purge", () => {
  assert.equal(decidePurge(ENV, rec(1), {}, now).action, "skip");
  assert.equal(decidePurge(ENV, rec(1), {}, now).reason, "too-young");
  assert.equal(decidePurge(ENV, rec(5), {}, now).action, "warn");
  assert.equal(decidePurge(ENV, rec(6), {}, now).action, "warn");
  // warned at day 5, now day 7 -> due
  const d = decidePurge(ENV, rec(7, { purgeWarnedAt: now - 2 * DAY }), {}, now);
  assert.equal(d.action, "purge");
  assert.equal(d.reason, "unverified");
});

test("NOBODY is removed who was never warned", () => {
  // The sweep might only start running today, or the warning email may have kept failing.
  const d = decidePurge(ENV, rec(90), {}, now);
  assert.equal(d.action, "warn", "an overdue account gets its warning first, and is removed later");
  assert.equal(d.reason, "overdue-but-unwarned");
});

test("a verified doctor is never touched, however old the record", () => {
  assert.equal(decidePurge(ENV, rec(400, { purgeWarnedAt: now - 300 * DAY }), { verified: true }, now).reason, "verified");
  // Belt and braces: the KV record's own stamp also spares them if the claim lookup came back thin.
  assert.equal(decidePurge(ENV, rec(400, { verifiedAt: now - 300 * DAY, purgeWarnedAt: 1 }), {}, now).reason, "verified-record");
});

test("someone awaiting YOUR manual review is never touched", () => {
  const claims = { provUntil: now + 2 * DAY };
  assert.equal(decidePurge(ENV, rec(9, { purgeWarnedAt: 1 }), claims, now).reason, "pending-review");
});

test("a PAYING account is never removed, verified or not", () => {
  // If this ever needs to happen it is a refund conversation, not a cron job.
  assert.equal(decidePurge(ENV, rec(60, { purgeWarnedAt: 1 }), { pro: true }, now).reason, "paying");
  assert.equal(decidePurge(ENV, rec(60, { purgeWarnedAt: 1 }), { pro: true, proExp: now + DAY }, now).reason, "paying");
  // ...but a lapsed subscription is not a shield.
  assert.equal(decidePurge(ENV, rec(60, { purgeWarnedAt: 1 }), { pro: true, proExp: now - DAY }, now).action, "purge");
});

test("the sweep is idempotent — a purged account is not purged twice", () => {
  assert.equal(decidePurge(ENV, rec(30, { purgeWarnedAt: 1, purgedAt: now - DAY }), {}, now).reason, "already-purged");
});

test("a record with no firstSeen is left alone rather than guessed at", () => {
  assert.equal(decidePurge(ENV, { email: "x@y.z" }, {}, now).reason, "no-first-seen");
  assert.equal(decidePurge(ENV, null, {}, now).reason, "no-first-seen");
});

test("decidePurge is pure — no network, no writes, safe to call in a loop", () => {
  const r = rec(9, { purgeWarnedAt: 1 });
  const snapshot = JSON.stringify(r);
  const a = decidePurge(ENV, r, {}, now);
  const b = decidePurge(ENV, r, {}, now);
  assert.deepEqual(a, b, "same inputs, same answer");
  assert.equal(JSON.stringify(r), snapshot, "the record must not be mutated");
  assert.equal(typeof a.then, "undefined");
});
