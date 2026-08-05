/* test/icu-retention.test.mjs — DPDP I1: shared ICU data carries a 7-day `expiresAt` for the Firestore
 * TTL policy. Guards the retention helper (the value the patient/timeline/task writers stamp). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const win = {};
new Function("window", read("icu-collab.js"))(win);
const G = win.SMD_ICU_GROUPS;
ok("module exposes the retention seam", !!G && typeof G._retentionExpiry === "function");

ok("RETENTION_MS is exactly 7 days", G._RETENTION_MS === 7 * 24 * 3600 * 1000);

const before = Date.now();
const exp = G._retentionExpiry();
const after = Date.now();
ok("retentionExpiry() returns a Date", exp instanceof Date);
const ms = exp.getTime();
ok("expiresAt is ~7 days in the future (sliding window)", ms >= before + 7 * 24 * 3600 * 1000 && ms <= after + 7 * 24 * 3600 * 1000);
// A future timestamp is required for a Firestore TTL delete (a serverTimestamp = "now" would delete immediately).
ok("expiresAt is strictly in the future", ms > after);

console.log(`\nicu-retention: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
