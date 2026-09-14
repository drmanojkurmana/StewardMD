/* PUSH-09: a hospital staff member who signs in with a PIN can bind a phone to their hospital identity,
 * and every credential change or removal unbinds it, audited. Routes: POST /api/push/register-member,
 * POST /api/queue/member/reset, /api/queue/member/pin, /api/queue/member/disable, /api/queue/mfa/signout-all.
 *
 * node --test --experimental-test-module-mocks test/push-member-binding.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KV, docs, seedHospital, as, pushAs, staffToken, idFor, ORG, ADMIN, DOCTOR, NURSE } from "./_wardsynq-alert-harness.mjs";

const key = (identity) => "push:who:" + ORG + "~" + identity;
const bindStaff = async (identity, token) => pushAs(null, "/register-member", "POST", { orgId: ORG, token, platform: "android" }, { "X-Staff-Token": await staffToken(ORG, identity, Date.now() - 1000) });
const audits = (action) => [...docs.values()].filter((d) => d.fields && d.fields.action === action);

test("PUSH-09: a PIN session binds a device to orgId~identity; reset unbinds it, audited; the reset session cannot bind again", async () => {
  seedHospital({ alerts: { push: { enabled: true } } });
  const r = await bindStaff("nurse1", "r".repeat(64));
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.equal(r.identity, "nurse1");
  assert.ok(await KV.current.get(key("nurse1")), "bound under the hospital identity");
  assert.ok((await KV.current.get("push:native:" + (JSON.parse(await KV.current.get(key("nurse1"))).tokenIds[0]))), "the device record exists for the sender");
  assert.equal(audits("push:device_bound").length, 1);

  const reset = await as(ADMIN, "/member/reset", "POST", { orgId: ORG, identity: "nurse1" });
  assert.equal(reset.__status, 200, JSON.stringify(reset));
  assert.equal(await KV.current.get(key("nurse1")), null, "reset access stops the phone receiving alerts");
  assert.equal(audits("push:devices_unbound").length, 1);

  const stale = await pushAs(null, "/register-member", "POST", { orgId: ORG, token: "r".repeat(64), platform: "android" }, { "X-Staff-Token": await staffToken(ORG, "nurse1", Date.now() - 60000) });
  assert.equal(stale.__status, 401, "a session issued before the reset is dead here too");
});

test("PUSH-09: a new PIN, disabling the member, and signing out everywhere each unbind", async () => {
  seedHospital({ alerts: { push: { enabled: true } } });
  await bindStaff("nurse1", "s".repeat(64));
  const pin = await as(ADMIN, "/member/pin", "POST", { orgId: ORG, identity: "nurse1", pin: "482913" });
  assert.equal(pin.__status, 200, JSON.stringify(pin));
  assert.equal(await KV.current.get(key("nurse1")), null, "new PIN");

  await pushAs(NURSE, "/register-member", "POST", { orgId: ORG, token: "t".repeat(64), platform: "ios" });
  assert.ok(await KV.current.get(key(idFor(NURSE))));
  const dis = await as(ADMIN, "/member/disable", "POST", { orgId: ORG, identity: idFor(NURSE) });
  assert.equal(dis.__status, 200, JSON.stringify(dis));
  assert.equal(await KV.current.get(key(idFor(NURSE))), null, "disabled");

  // The PIN was just changed, so sign in again with a session issued after it.
  await new Promise((res) => setTimeout(res, 5));
  const tok = await staffToken(ORG, "nurse1");
  const b = await pushAs(null, "/register-member", "POST", { orgId: ORG, token: "u".repeat(64), platform: "ios" }, { "X-Staff-Token": tok });
  assert.equal(b.__status, 200, JSON.stringify(b));
  const so = await as(null, "/mfa/signout-all", "POST", {}, { "X-Staff-Token": tok });
  assert.equal(so.__status, 200, JSON.stringify(so));
  assert.equal(await KV.current.get(key("nurse1")), null, "signed out everywhere");
});

test("a StewardMD account is bound under its membership identity; another member's device is untouched by a reset", async () => {
  seedHospital({ alerts: { push: { enabled: true } } });
  await pushAs(DOCTOR, "/register-member", "POST", { orgId: ORG, token: "v".repeat(64), platform: "ios" });
  await bindStaff("nurse1", "w".repeat(64));
  await as(ADMIN, "/member/reset", "POST", { orgId: ORG, identity: "nurse1" });
  assert.ok(await KV.current.get(key(idFor(DOCTOR))));
  const restore = await as(ADMIN, "/member/restore", "POST", { orgId: ORG, identity: "nurse1" });
  assert.equal(restore.__status, 200);
});
