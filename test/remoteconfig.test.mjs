/* test/remoteconfig.test.mjs — server-driven remote config: sanitize/bounds + force-upgrade decision +
 * KV round-trip. node --test test/remoteconfig.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRemoteConfig, getRemoteConfig, setRemoteConfig, needsUpgrade } from "../functions/_remoteconfig.js";

function fakeStore() { const m = new Map(); return { get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); return Promise.resolve(); } }; }

test("sanitize: types + bounds; bad payload can't brick the client", () => {
  const c = sanitizeRemoteConfig({
    minBuild: "42", maintenance: { on: 1, message: "x".repeat(500) },
    banners: [{ text: "hi", level: "nope" }, { text: "" }, { text: "warn me", level: "critical", dismissible: false }],
    flags: { a: true, b: 3, c: "on", d: { nested: 1 } },
  });
  assert.equal(c.minBuild, 42);
  assert.equal(c.maintenance.on, true);
  assert.equal(c.maintenance.message.length, 300);
  assert.equal(c.banners.length, 2);                 // empty-text one dropped
  assert.equal(c.banners[0].level, "info");          // invalid level normalized
  assert.equal(c.banners[1].dismissible, false);
  assert.deepEqual(c.flags, { a: true, b: 3, c: "on" }); // object flag dropped
});

test("needsUpgrade: gate only when native build < floor", () => {
  const cfg = sanitizeRemoteConfig({ minBuild: 20 });
  assert.equal(needsUpgrade(13, cfg), true);         // stale native build -> gate
  assert.equal(needsUpgrade(20, cfg), false);        // at floor -> ok
  assert.equal(needsUpgrade(25, cfg), false);
  assert.equal(needsUpgrade(null, cfg), false);      // web (no build) -> never gate
  assert.equal(needsUpgrade(5, sanitizeRemoteConfig({})), false); // no floor set -> never gate
});

test("KV round-trip: set then get returns the sanitized config", async () => {
  const s = fakeStore();
  await setRemoteConfig(s, { minBuild: 30, banners: [{ text: "Scheduled maintenance tonight" }] });
  const got = await getRemoteConfig(s);
  assert.equal(got.minBuild, 30);
  assert.equal(got.banners[0].text, "Scheduled maintenance tonight");
});

test("empty store -> safe defaults (no gate, no maintenance)", async () => {
  const got = await getRemoteConfig(fakeStore());
  assert.equal(got.minBuild, null);
  assert.equal(got.maintenance.on, false);
  assert.deepEqual(got.banners, []);
});
