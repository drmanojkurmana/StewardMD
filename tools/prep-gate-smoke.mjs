#!/usr/bin/env node
/* Live smoke for the PrepNucleus bank gate, run by CI on a schedule and before every OTA publish.
 *
 * The iOS app calls the API through native networking, which sends NO Origin header. The session route must still
 * ANSWER such a request (401 login-required without a token). 403 origin-required means every module on every iPhone and
 * iPad shows "Questions need a connection" (outages 2026-10-15, 2026-10-17, 2026-10-22). Needs no credentials.
 *
 *   node tools/prep-gate-smoke.mjs [https://stewardmd.in]
 */
const BASE = process.argv[2] || "https://stewardmd.in";
const r = await fetch(BASE + "/api/prep/session", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-SMD-Device": "gate-smoke" },
  body: "{}",
});
const j = await r.json().catch(() => ({}));
console.log("POST /api/prep/session (no Origin, no token) ->", r.status, j.code || "");
if (r.status !== 401 || j.code !== "login-required") {
  console.error("FAIL: expected 401 login-required. A native app request without Origin is being refused, so no module can load.");
  process.exit(1);
}
console.log("OK: the session route answers native app requests");
