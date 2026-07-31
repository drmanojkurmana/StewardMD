// test/connect/maik-callsite-regression.test.mjs — DUAL-ADVERSARIAL: the live-product touch is inert
// when off (spec §4.6, default #1 "flag-off byte-identical"). If these fail, the shipping MaiK product
// changed behavior — that is a hard stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConnectContext } from "../../functions/_connect/maik-bridge/hook.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
// A pullLanes that MUST NOT be called when the flag is off / no binding.
let pulled = 0;
const spyPull = async () => { pulled++; return { egress: { findings: ["X"] }, deterministic: {}, notice: null }; };

test("flag OFF => pkg byte-identical AND the bridge is never called", async () => {
  pulled = 0;
  const pkg = { question: "q", patientCase: { age: 33, findings: ["fever"] }, grounding: [{ name: "d" }] };
  const before = clone(pkg);
  const r = await applyConnectContext({}, {}, pkg, { pullLanes: spyPull });                 // both flags off
  assert.deepEqual(r.pkg, before);
  assert.equal(pulled, 0);                                     // no KV/engine work when off
});

test("smd_connect ON but smd_connect_maik OFF => still inert", async () => {
  pulled = 0;
  const pkg = { question: "q", patientCase: { age: 33 } };
  const before = clone(pkg);
  await applyConnectContext({ CONNECT_FLAG: "1" }, {}, pkg, { pullLanes: spyPull });
  assert.deepEqual(pkg, before);
  assert.equal(pulled, 0);
});

test("flag ON but NO binding (pullLanes returns null) => pkg unchanged", async () => {
  const pkg = { question: "q", patientCase: { age: 33 }, grounding: [] };
  const before = clone(pkg);
  const r = await applyConnectContext({ CONNECT_FLAG: "1", CONNECT_MAIK_FLAG: "1" }, {}, pkg, { pullLanes: async () => null });
  assert.deepEqual(r.pkg, before);
  assert.equal(r.applied, false);
});

test("null pkg (educational/no-package path) is handled without throwing", async () => {
  const r = await applyConnectContext({ CONNECT_FLAG: "1", CONNECT_MAIK_FLAG: "1" }, {}, null, { pullLanes: spyPull });
  assert.equal(r.pkg, null);
  assert.equal(r.applied, false);
});
