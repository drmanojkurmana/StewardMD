import { test } from "node:test";
import assert from "node:assert";
import FLAGS from "../sknx-flags.js";

test("smd_sknx defaults to true when unset", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), true);
});
test("localStorage '0' overrides the default", () => {
  const store = { smd_sknx: "0" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "" }), false);
});
test("?sknx=1 query wins over localStorage '0'", () => {
  const store = { smd_sknx: "0" };
  assert.equal(FLAGS.bool("smd_sknx", { store, query: "?sknx=1" }), true);
});
