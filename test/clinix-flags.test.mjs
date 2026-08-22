import { test } from "node:test";
import assert from "node:assert";

// Stub localStorage before requiring, matching test/thorex-flags.test.js. `location` is undefined
// in node, so the flags file's search() hits its catch and the query-param path is inert here.
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const { default: F } = await import("../clinix-flags.js");

test("the master flag is OFF by default - this is the public release gate", () => {
  assert.equal(F.bool("smd_clinix"), false);
});

test("the two authoring escape hatches are OFF by default and must never ship on", () => {
  assert.equal(F.bool("smd_clinix_draft"), false,
    "draft mode shows content that no clinician has approved");
  assert.equal(F.bool("smd_clinix_uncleared_media"), false,
    "uncleared media mode renders assets whose licence is unverified");
});

test("the tutor is OFF by default, so a lesson is deterministic content only", () => {
  assert.equal(F.bool("smd_clinix_tutor"), false);
});

test("haptics default ON, matching the other modules", () => {
  assert.equal(F.bool("smd_clinix_haptics"), true);
});

test("set flips a flag and it persists", () => {
  F.set("smd_clinix", true);
  assert.equal(F.bool("smd_clinix"), true);
  F.set("smd_clinix", false);
  assert.equal(F.bool("smd_clinix"), false);
});

test("every flag declares a description and a query alias, so it is discoverable", () => {
  for (const k of Object.keys(F.DEFS)) {
    const d = F.DEFS[k];
    assert.ok(d.desc && d.desc.length > 10, `${k} has no usable description`);
    assert.ok(d.query, `${k} has no ?query alias, so it cannot be toggled on a device`);
    assert.ok(k.indexOf("smd_clinix") === 0, `${k} is not namespaced to the module`);
  }
});

test("all() reports every flag", () => {
  const a = F.all();
  assert.deepEqual(Object.keys(a).sort(), Object.keys(F.DEFS).sort());
});

test("an unknown flag reads null rather than throwing", () => {
  assert.equal(F.get("smd_clinix_not_a_flag"), null);
  assert.equal(F.set("smd_clinix_not_a_flag", true), false);
});
