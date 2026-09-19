/* test/wardsynq-tpa-adapter.test.mjs — the payer adapter boundary (master plan section 2.3). Pure.
 *
 * node --test test/wardsynq-tpa-adapter.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTER_STATES, NullAdapter, submitViaAdapter } from "../wardsynq/wardsynq-tpa-adapter.js";

const claim = { id: "claim-1", state: "submitted" };

test("no adapter configured: honestly queued, never claimed as sent", async () => {
  const r = await submitViaAdapter(claim, null);
  assert.equal(r.state, "not_configured");
  assert.equal(r.adapterId, "null");
  assert.equal(r.payerReference, null);
  assert.match(r.note, /No live payer connector/);
  assert.ok(r.attemptedAt);
});

test("the SAME default is used when NullAdapter() is passed explicitly", async () => {
  const r = await submitViaAdapter(claim, NullAdapter());
  assert.equal(r.state, "not_configured");
});

test("a real, configured adapter's own reported state is recorded verbatim", async () => {
  const fake = { id: "acme-tpa", name: "Acme TPA Gateway", submit: async () => ({ state: "acknowledged", payerReference: "ACME-REF-42" }) };
  const r = await submitViaAdapter(claim, fake);
  assert.equal(r.state, "acknowledged");
  assert.equal(r.adapterId, "acme-tpa");
  assert.equal(r.payerReference, "ACME-REF-42");
});

test("an adapter that returns an unrecognised state is recorded as failed, never upgraded to sent", async () => {
  const bad = { id: "bad", submit: async () => ({ state: "definitely-sent-trust-me" }) };
  const r = await submitViaAdapter(claim, bad);
  assert.equal(r.state, "failed");
});

test("an adapter that throws is recorded as failed, with the error named, never a swallowed exception", async () => {
  const broken = { id: "broken", submit: async () => { throw new Error("connection refused"); } };
  const r = await submitViaAdapter(claim, broken);
  assert.equal(r.state, "failed");
  assert.match(r.note, /connection refused/);
});

test("an adapter with no id/name still produces a usable record - never throws on a minimal adapter", async () => {
  const minimal = { submit: async () => ({ state: "queued" }) };
  const r = await submitViaAdapter(claim, minimal);
  assert.equal(r.state, "queued");
  assert.equal(r.adapterId, "unknown");
  assert.equal(r.adapterName, "Unnamed adapter");
});

test("ADAPTER_STATES is the closed, enumerated list this module actually recognises", () => {
  assert.deepEqual([...ADAPTER_STATES], ["not_configured", "queued", "sent", "acknowledged", "failed"]);
});
