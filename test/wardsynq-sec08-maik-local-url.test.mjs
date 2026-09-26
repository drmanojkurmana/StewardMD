/* SEC-08 (audit A9): the hospital model server address (wardsynq.maik.localBaseUrl) had no check, so
 * a chart prompt went out over plain http, or to a metadata or loopback address, from a cloud server.
 * It must be https to a public name, on save and on every call, and a redirect is never followed.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-sec08-maik-local-url.test.mjs
 */
import "./helpers/trust-cf-access-header.mjs";
import * as H from "./helpers/opd-router-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { invoke, TASK, localUrlProblem } = await import("../functions/_wardsynq/maik-gateway.js");
const call = (base, fetchImpl) => invoke({ task: TASK.SUMMARISE, phi: true, context: { patientId: "p1" }, prompt: "Patient Ramesh Kumar, MRN 12345, K 6.8",
  config: { enabled: true, phiApproved: ["local-openai"], localBaseUrl: base, localModel: "llama" }, env: {}, fetchImpl });
const answer = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], model: "m" }), { status: 200, headers: { "Content-Type": "application/json" } });

test("no chart prompt leaves for a plain-http, loopback, metadata or internal address", async () => {
  for (const base of ["http://hospital-ai.example.in:8080/v1", "https://169.254.169.254/v1", "http://localhost:11434/v1", "https://ai.hospital.internal/v1"]) {
    const seen = [];
    const r = await call(base, async (url, init) => { seen.push(url); return answer(); });
    assert.equal(seen.length, 0, `${base} was fetched`);
    assert.notEqual(r.ok, true, base);
    assert.ok(localUrlProblem(base), base);
  }
});

test("a public https server works, and a redirect from it is not followed", async () => {
  const seen = [];
  const ok = await call("https://ai.hospital.example/v1", async (url) => { seen.push(url); return answer(); });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(seen[0], "https://ai.hospital.example/v1/chat/completions");
  const hops = [];
  const moved = await call("https://ai.hospital.example/v1", async (url) => { hops.push(url); return new Response("", { status: 307, headers: { Location: "https://elsewhere.example/steal" } }); });
  assert.notEqual(moved.ok, true);
  assert.deepEqual(hops, ["https://ai.hospital.example/v1/chat/completions"], "the redirect target was never contacted");
});

test("the address is refused when an admin saves it", async () => {
  H.seed();
  const bad = await H.api("/org/update", "POST", { orgId: "org-a", wardsynq: { maik: { enabled: true, phiApproved: ["local-openai"], localBaseUrl: "http://10.0.0.5:8080/v1", localModel: "m" } } }, H.OWNER_A);
  assert.equal(bad.__status, 422, JSON.stringify(bad));
  assert.equal(bad.error, "bad_maik_local_url");
  const good = await H.api("/org/update", "POST", { orgId: "org-a", wardsynq: { maik: { enabled: true, phiApproved: ["local-openai"], localBaseUrl: "https://ai.hospital.example/v1", localModel: "m" } } }, H.OWNER_A);
  assert.equal(good.__status, 200, JSON.stringify(good));
});
