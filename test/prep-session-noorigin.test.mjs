/* POST /api/prep/session from the iOS app: native networking (CapacitorHttp) sends no Origin header. Owner 2026-10-22:
 * every module showed "check your connection" because this route answered 403 origin-required. */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realGate = await import("../functions/_prep_bank_gate.js");
mock.module("../functions/_usage.js", {
  namedExports: { identify: async (req) => (/tok-a/.test(req.headers.get("Authorization") || "") ? { id: "fb:u-a" } : null) },
});
mock.module("../functions/_prep_bank_gate.js", {
  namedExports: { ...realGate, mintBankSession: async (user) => ({ sessionId: "s1", sessionKey: "k1", uid: user.id }) },
});
const session = await import("../functions/api/prep/session.js");

const post = (headers) => session.onRequestPost({
  env: {},
  request: new Request("https://stewardmd.in/api/prep/session", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" }),
});

test("no Origin + app device header + signed-in user: session minted", async () => {
  const r = await post({ Authorization: "Bearer tok-a", "X-SMD-Device": "dev1" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sessionId, "s1");
});
test("no Origin and no device header (curl): refused origin-required", async () => {
  const r = await post({ Authorization: "Bearer tok-a" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "origin-required");
});
test("no Origin + device header but no valid sign-in: 401", async () => {
  const r = await post({ "X-SMD-Device": "dev1" });
  assert.equal(r.status, 401);
});
test("foreign Origin is refused even with a device header and token", async () => {
  const r = await post({ Origin: "https://evil.example", Authorization: "Bearer tok-a", "X-SMD-Device": "dev1" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "foreign-origin");
});
