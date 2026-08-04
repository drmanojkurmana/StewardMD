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
test("smd_sknx_rx (Phase 3 Rx) is registered and defaults to FALSE (R1-gated, must not ship on)", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_rx", { store, query: "" }), false);
});
test("smd_sknx_rx can be enabled per-device via ?sknxrx=1 (dev/testing only)", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_rx", { store, query: "?sknxrx=1" }), true);
});
test("smd_sknx_rx localStorage '1' enables it for a device", () => {
  const store = { smd_sknx_rx: "1" };
  assert.equal(FLAGS.bool("smd_sknx_rx", { store, query: "" }), true);
});
test("smd_sknx_realvision (experimental ONNX classifier) defaults to FALSE", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_realvision", { store, query: "" }), false);
});
test("smd_sknx_realvision enables via ?sknxrv=1", () => {
  const store = {};
  assert.equal(FLAGS.bool("smd_sknx_realvision", { store, query: "?sknxrv=1" }), true);
});
