/* test/icu-retention.test.mjs — DPDP I1: shared ICU data carries an `expiresAt` for the Firestore TTL
 * policy, and the retention window is USER-CONFIGURABLE (localStorage smd_icu_retention_days): default
 * 7 days, hard-capped at 90. Guards the value the patient/timeline/task/presence writers stamp. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// localStorage mock — the module reads it as a global at call time (typeof localStorage !== "undefined").
let _store = {};
globalThis.localStorage = {
  getItem: (k) => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};

const win = {};
new Function("window", read("icu-collab.js"))(win);
const G = win.SMD_ICU_GROUPS;
const DAY = 24 * 3600 * 1000;

ok("module exposes the retention seams", !!G && typeof G._retentionExpiry === "function" && typeof G._retentionDays === "function");
ok("default window is 7 days", G._RETENTION_DEFAULT_DAYS === 7);
ok("hard cap is 90 days", G._RETENTION_MAX_DAYS === 90);
ok("RETENTION_MS stays the 7-day default", G._RETENTION_MS === 7 * DAY);

// default (unset) → 7
_store = {}; ok("unset → default 7", G._retentionDays() === 7);
// explicit valid values
_store = { smd_icu_retention_days: "30" }; ok("30 → 30", G._retentionDays() === 30);
_store = { smd_icu_retention_days: "60" }; ok("60 → 60", G._retentionDays() === 60);
_store = { smd_icu_retention_days: "90" }; ok("90 → 90", G._retentionDays() === 90);
// clamp: never more than 90
_store = { smd_icu_retention_days: "120" }; ok("120 → clamped to 90", G._retentionDays() === 90);
_store = { smd_icu_retention_days: "365" }; ok("365 → clamped to 90", G._retentionDays() === 90);
// garbage / non-positive → default 7
_store = { smd_icu_retention_days: "0" }; ok("0 → default 7", G._retentionDays() === 7);
_store = { smd_icu_retention_days: "-5" }; ok("-5 → default 7", G._retentionDays() === 7);
_store = { smd_icu_retention_days: "abc" }; ok("garbage → default 7", G._retentionDays() === 7);

// retentionExpiry() tracks the configured window and is strictly in the future.
_store = { smd_icu_retention_days: "30" };
const before = Date.now(), exp = G._retentionExpiry(), after = Date.now();
ok("retentionExpiry() returns a Date", exp instanceof Date);
const ms = exp.getTime();
ok("expiresAt ~= now + 30 days when window = 30", ms >= before + 30 * DAY && ms <= after + 30 * DAY);
ok("expiresAt strictly in the future", ms > after);   // a serverTimestamp (= now) would TTL-delete immediately

_store = {};
ok("default expiresAt ~= now + 7 days", G._retentionExpiry().getTime() >= Date.now() + 6.9 * DAY);

// The 90-day max must never exceed the firestore.rules retentionCapped() bound of 91 days.
_store = { smd_icu_retention_days: "90" };
ok("max window (90d) stays within the 91-day rules cap", G._retentionExpiry().getTime() <= Date.now() + 91 * DAY);

console.log(`\nicu-retention: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
