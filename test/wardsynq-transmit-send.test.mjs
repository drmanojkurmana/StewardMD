/* test/wardsynq-transmit-send.test.mjs — actually sending the prescription.
 *
 * node --test test/wardsynq-transmit-send.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIMEOUT_MS, endpointFor, outcomeOf, sendTransmission } from "../functions/_wardsynq/transmit-send.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/transmit-send.js", import.meta.url), "utf8");
const ENDPOINTS = { pharmacy: { url: "https://pharmacy.example/rx", headerName: "x-token", token: "s3cret" } };

test("'WE COULD NOT TELL' IS NOT 'IT FAILED', AND NOT 'IT ARRIVED'", () => {
  /* The case both confident answers get wrong: reporting failure invites a re-send that duplicates a
   * prescription; reporting success loses it silently. */
  const t = outcomeOf({ networkError: "timed out" });
  assert.equal(t.outcome, "indeterminate");
  assert.match(t.detail, /NOT known whether the prescription arrived/);

  /* A 5xx is the server saying it broke, which is not the message being rejected - it may have been
   * received and then failed to process. Still outstanding. */
  assert.equal(outcomeOf({ status: 503, body: "upstream down" }).outcome, "indeterminate");
  assert.equal(outcomeOf({ status: 500, body: "" }).outcome, "indeterminate");

  // A 4xx IS a refusal: the endpoint read it and said no.
  assert.equal(outcomeOf({ status: 400, body: "bad payload" }).outcome, "failed");
  assert.equal(outcomeOf({ status: 401, body: "" }).outcome, "failed");
  assert.match(outcomeOf({ status: 400, body: "bad payload" }).detail, /bad payload/);

  // Only 2xx is delivery.
  assert.equal(outcomeOf({ status: 200 }).outcome, "sent");
  assert.equal(outcomeOf({ status: 202 }).outcome, "sent");
  assert.equal(outcomeOf({ status: 302, body: "" }).outcome, "failed", "a redirect is not an acceptance");
});

test("THE ENDPOINT IS CONFIGURATION, NEVER A REQUEST FIELD", () => {
  /* If a caller could name the destination, anyone who could queue a prescription could post a
   * patient's medicines to a host of their choosing, and the audit would show a success. */
  assert.equal(endpointFor("pharmacy", ENDPOINTS).url, "https://pharmacy.example/rx");
  assert.equal(endpointFor("external-system", ENDPOINTS), null);
  assert.equal(endpointFor("pharmacy", null), null);
  // A bare string entry is allowed; a blank one is not an endpoint.
  assert.equal(endpointFor("x", { x: "https://a.example" }).url, "https://a.example");
  assert.equal(endpointFor("x", { x: "" }), null);
  assert.equal(endpointFor("x", { x: { url: "" } }), null);

  // No destination is ever read off the caller's context.
  assert.ok(!/ctx\.(destination|url|endpoint)\b/.test(SRC));
});

test("A MISSING ENDPOINT IS NOT A FAILURE, because a failed prescription is a work item", async () => {
  const r = await sendTransmission({ channel: "pharmacy", payload: {}, endpoints: {} });
  assert.equal(r.attempted, false);
  assert.equal(r.outcome, null, "nothing is recorded against the transmission");
  assert.equal(r.reason, "no_endpoint");
  assert.match(r.detail, /must not be recorded as failed/);
});

test("PRINT IS A REAL CHANNEL WITH NOTHING TO SEND, and that is not an error", async () => {
  /* Recording a failure here would put a permanent error against a transmission that worked exactly
   * as intended - a person handed the patient a piece of paper. */
  const r = await sendTransmission({ channel: "print", payload: {}, endpoints: ENDPOINTS });
  assert.equal(r.ok, true);
  assert.equal(r.attempted, false);
  assert.equal(r.outcome, null);
  assert.match(r.detail, /nothing failed/);
});

test("it sends through the HARDENED fetch and never a plain one", () => {
  /* makeSafeFetch re-validates every redirect hop and drops headers and body on a cross-origin hop,
   * which is what stops a compliant-looking endpoint 302-ing a prescription and its bearer token
   * somewhere else. */
  assert.ok(/makeSafeFetch/.test(SRC));
  assert.ok(!/[^e]\bfetch\(/.test(SRC.replace(/makeSafeFetch/g, "").replace(/ctx\.fetchImpl \|\| fetch/, "")),
    "no direct fetch( call outside the injected implementation");
});

test("a real send reports the outcome and NEVER echoes the destination", async () => {
  let seen = null;
  const fake = async (url, init) => { seen = { url, init }; return { status: 200, async text() { return "ok"; } }; };
  const r = await sendTransmission({ channel: "pharmacy", payload: { orderId: "rx-1" }, endpoints: ENDPOINTS, fetchImpl: fake });

  assert.equal(r.ok, true);
  assert.equal(r.outcome, "sent");
  assert.equal(r.status, 200);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["x-token"], "s3cret");
  assert.equal(JSON.parse(seen.init.body).orderId, "rx-1");

  /* The URL is a configured, secret-adjacent value: a response echoing it would put the destination
   * of every prescription into any log that captured a body. */
  assert.equal(r.url, undefined);
  assert.ok(!JSON.stringify(r).includes("pharmacy.example"));
  assert.ok(!JSON.stringify(r).includes("s3cret"));
});

test("IT NEVER RETRIES ON ITS OWN, and writes no state", () => {
  /* A retry that duplicates a prescription is worse than one that did not happen, and only the
   * receiving system knows whether it processed the first attempt. */
  // Comments stripped first: the header legitimately explains WHY there is no retry, and matching
  // that prose would be a test of the documentation rather than of the code.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bfor\s*\(/.test(code), "no loop: one attempt, then a human decides");
  assert.ok(!/\bwhile\s*\(/.test(code));
  assert.ok(!/\bsetInterval\b/.test(code));
  // One author for the outbox state machine: this file reports, the outcome route writes.
  assert.ok(!/svc\.put\(|RecordService/.test(SRC));
  assert.equal(TIMEOUT_MS, 10000);
});
