import { test } from "node:test";
import assert from "node:assert";
import VISION from "../sknx-vision.js";

test("available() is false when the native plugin is absent", () => {
  assert.equal(VISION.available({ Capacitor: { Plugins: {} } }), false);
});

test("available() is true when the SknxVision plugin is present", () => {
  assert.equal(VISION.available({ Capacitor: { Plugins: { SknxVision: {} } } }), true);
});

test("analyze rejects plugin_unavailable when absent", async () => {
  await assert.rejects(() => VISION.analyze({}, { Capacitor: { Plugins: {} } }), /plugin_unavailable/);
});
