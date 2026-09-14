/* PUSH-10: the account fan-out every existing StewardMD push uses is unchanged by the hospital directory.
 * sendNativeToAll still sends to exactly one account's devices when asked; POST /api/push/register-member
 * never rewrites the account a device was registered under by POST /api/push/register-native.
 *
 * node --test --experimental-test-module-mocks test/nativepush-fanout.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENV, KV, sent, seedHospital, pushAs, ORG, DOCTOR } from "./_wardsynq-alert-harness.mjs";

const { saveNativeToken, sendNativeToAll, tokenId } = await import("../functions/_nativepush.js");

test("PUSH-10: sendNativeToAll with a uid reaches that account's devices only, all platforms, and prunes nothing alive", async () => {
  seedHospital({});
  await saveNativeToken(ENV, { token: "ios-a", platform: "ios", uid: "fb:alice" });
  await saveNativeToken(ENV, { token: "and-a", platform: "android", uid: "fb:alice" });
  await saveNativeToken(ENV, { token: "ios-b", platform: "ios", uid: "fb:bob" });
  await saveNativeToken(ENV, { token: "ios-guest", platform: "ios", uid: null });
  sent.length = 0;
  const r = await sendNativeToAll(ENV, { title: "ICU", body: "Task overdue" }, { uid: "fb:alice" });
  assert.deepEqual(r, { sent: 2, total: 2 });
  assert.deepEqual(sent.map((s) => s.kind).sort(), ["apns", "fcm"]);
  assert.ok(sent.find((s) => s.kind === "apns").url.endsWith("/ios-a"));
  const all = await sendNativeToAll(ENV, { title: "Update", body: "x" });
  assert.equal(all.total, 4, "the broadcast still reaches every registered device");
});

test("PUSH-10: binding a device to a hospital identity leaves its account registration exactly as it was", async () => {
  seedHospital({ alerts: { push: { enabled: true } } });
  await saveNativeToken(ENV, { token: "x".repeat(64), platform: "ios", uid: "fb:doctor-account", device: { installId: "inst-1", label: "Ward phone" } });
  const before = await KV.current.get("push:native:" + (await tokenId("x".repeat(64))));
  const b = await pushAs(DOCTOR, "/register-member", "POST", { orgId: ORG, token: "x".repeat(64), platform: "android" });
  assert.equal(b.__status, 200, JSON.stringify(b));
  assert.equal(await KV.current.get("push:native:" + (await tokenId("x".repeat(64)))), before, "uid, platform and device identity untouched");
});
