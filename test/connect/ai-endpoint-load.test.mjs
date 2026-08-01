// test/connect/ai-endpoint-load.test.mjs — regression guard for the ONE live-product touch (Track D).
// The AI endpoint is the single existing file Track D edits; a broken import in the Connect hook chain
// (functions/_connect/maik-bridge/hook.js -> bridge/engine/connectors/canonical/_usage/testkit) would
// break the shipping MaiK product at module load. This ESM-imports the real endpoint and asserts it
// still loads with `onRequest` exported. (The pre-existing maik-dosing-grounding test only regex-reads
// the file as text; this is the true module-load check the integration review flagged as missing.)
import { test } from "node:test";
import assert from "node:assert/strict";

test("the live AI endpoint ESM-loads with the Connect Track D hook import chain", async () => {
  const mod = await import("../../functions/api/ai/[[path]].js");
  assert.equal(typeof mod.onRequest, "function");
});

test("the Connect hook double-flag gate + adapter export cleanly", async () => {
  const hook = await import("../../functions/_connect/maik-bridge/hook.js");
  assert.equal(typeof hook.maikWiringOn, "function");
  assert.equal(typeof hook.applyConnectContext, "function");
  assert.equal(hook.maikWiringOn({}), false);                              // default OFF
  assert.equal(hook.maikWiringOn({ CONNECT_FLAG: "1" }), false);           // smd_connect alone is not enough
  assert.equal(hook.maikWiringOn({ CONNECT_FLAG: "1", CONNECT_MAIK_FLAG: "1" }), true);
});
