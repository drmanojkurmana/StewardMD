/* test/usage-guest-identity.test.mjs — a guest is capped per DEVICE, not per shared IP.
 *
 * THE BUG THIS FIXES: guest identity was `ip:<hash>`, so everyone behind one public address shared a
 * SINGLE 15/day bucket. On a hospital NAT that is the whole building; on Indian mobile networks it is
 * worse still, because carrier-grade NAT puts thousands of subscribers behind one address — one heavy
 * guest could lock out every other guest on that carrier IP. The tightest cap in the system was keyed
 * on the most SHARED identifier.
 *
 * node --test test/usage-guest-identity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { identify } from "../functions/_usage.js";

const req = (headers) => ({ headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null } });
const ENV = {};

test("two devices behind the SAME IP get different guest buckets", async () => {
  const ip = "203.0.113.7";
  const a = await identify(req({ "X-SMD-Device": "device-A", "CF-Connecting-IP": ip }), ENV);
  const b = await identify(req({ "X-SMD-Device": "device-B", "CF-Connecting-IP": ip }), ENV);
  assert.equal(a.guest, true);
  assert.equal(b.guest, true);
  assert.notEqual(a.id, b.id, "one phone exhausting its cap must not lock out another on the same NAT");
});

test("the same device keeps ONE bucket even as its IP changes (wifi -> mobile)", async () => {
  const a = await identify(req({ "X-SMD-Device": "device-A", "CF-Connecting-IP": "203.0.113.7" }), ENV);
  const b = await identify(req({ "X-SMD-Device": "device-A", "CF-Connecting-IP": "198.51.100.9" }), ENV);
  assert.equal(a.id, b.id, "roaming between networks must not hand out a fresh allowance");
});

test("no device header falls back to the IP bucket, as before", async () => {
  const a = await identify(req({ "CF-Connecting-IP": "203.0.113.7" }), ENV);
  assert.equal(a.guest, true);
  assert.match(a.id, /^ip:/, "callers presenting nothing still get the IP bucket");
});

test("the device id is HASHED, never stored or keyed in the clear", async () => {
  const raw = "device-A";
  const a = await identify(req({ "X-SMD-Device": raw, "CF-Connecting-IP": "203.0.113.7" }), ENV);
  assert.match(a.id, /^dev:[0-9a-f]+$/, "opaque hash");
  assert.ok(!a.id.includes(raw), "the raw device id must never appear in the key");
});

test("device and IP buckets cannot collide", async () => {
  const d = await identify(req({ "X-SMD-Device": "x", "CF-Connecting-IP": "203.0.113.7" }), ENV);
  const i = await identify(req({ "CF-Connecting-IP": "203.0.113.7" }), ENV);
  assert.notEqual(d.id, i.id);
  assert.match(d.id, /^dev:/); assert.match(i.id, /^ip:/);
});

test("SAFETY: signed-in identity is untouched — this only affects credential-less callers", async () => {
  const cfa = await identify(req({ "Cf-Access-Authenticated-User-Email": "Doc@Example.com", "X-SMD-Device": "device-A" }), ENV);
  assert.equal(cfa.guest, false, "a verified Cf-Access user must not be downgraded to a device bucket");
  assert.match(cfa.id, /^cfa:/);
  assert.equal(cfa.email, "doc@example.com");
});

test("SAFETY: an unverifiable bearer token still falls through to a GUEST bucket", async () => {
  // A forged/expired token must never be treated as signed-in, and must not skip the guest cap.
  const a = await identify(req({ "Authorization": "Bearer not.a.real.token", "X-SMD-Device": "device-A" }), ENV);
  assert.equal(a.guest, true);
  assert.match(a.id, /^dev:/);
});
