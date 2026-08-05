// test/iap.test.mjs — store IAP verification (Phase 3): fail-closed, never a fake grant; grant math.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPurchase, daysFromExpiry, iapConfigured } from "../functions/_iap.js";

test("iapConfigured: false without creds, true once the owner sets them", () => {
  assert.equal(iapConfigured({}, "google"), false);
  assert.equal(iapConfigured({ GOOGLE_PLAY_SA_JSON: "{}", GOOGLE_PLAY_PACKAGE: "in.stewardmd.app" }, "google"), true);
  assert.equal(iapConfigured({}, "apple"), false);
  assert.equal(iapConfigured({ APPLE_ASC_KEY: "k", APPLE_ASC_KEY_ID: "i", APPLE_ASC_ISSUER: "s", APPLE_BUNDLE_ID: "b" }, "apple"), true);
});

test("verifyPurchase: unknown platform -> not configured, not valid", async () => {
  const r = await verifyPurchase({}, { platform: "web", purchaseToken: "x" });
  assert.equal(r.valid, false);
  assert.equal(r.configured, false);
  assert.equal(r.reason, "unknown-platform");
});

test("verifyPurchase: no creds -> configured:false (route 501s), never valid", async () => {
  const r = await verifyPurchase({}, { platform: "google", purchaseToken: "x" });
  assert.equal(r.configured, false);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "not-configured");
});

test("verifyPurchase: creds present but adapter not wired -> valid:false (no fake grant)", async () => {
  const r = await verifyPurchase({ GOOGLE_PLAY_SA_JSON: "{}", GOOGLE_PLAY_PACKAGE: "in.stewardmd.app" }, { platform: "google", purchaseToken: "x" });
  assert.equal(r.configured, true);
  assert.equal(r.valid, false);
  assert.equal(r.reason, "google-adapter-not-wired");
});

test("daysFromExpiry: ceils to the store expiry, clamps to >= 1", () => {
  const now = 1000;
  assert.equal(daysFromExpiry(now + 3 * 86400000, now), 3);
  assert.equal(daysFromExpiry(now + 100, now), 1);        // < 1 day -> 1
  assert.equal(daysFromExpiry(now - 86400000, now), 1);   // already past -> clamp 1
  assert.equal(daysFromExpiry("bad", now), 1);            // non-numeric -> 1
});
