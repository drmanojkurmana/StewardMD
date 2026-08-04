import { test } from "node:test";
import assert from "node:assert";
import FLAGS from "../sknx-flags.js";

test("smd_sknx defaults to false when unset (mock-only, off by default)", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), false);
});
test("localStorage '1' enables it for a device", () => {
  const store = { smd_sknx: "1" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), true);
});
test("?sknx=1 query wins over localStorage '0'", () => {
  const store = { smd_sknx: "0" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "?sknx=1" }), true);
});
test("smd_sknx_haptics is registered and defaults to true when unset", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_haptics", { store, query: "" }), true);
});
