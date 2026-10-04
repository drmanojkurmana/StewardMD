/* test/maik-empty-reply.test.mjs - an empty /explain reply must never reach the clinician as a raw
 * browser parse error.
 *
 * REPORTED 2026-10-04 (owner screenshot, Android, MaiK Cloud): "MaiK is unavailable right now ...
 * Reason: Failed to execute 'json' on 'Response': Unexpected end of JSON input" after 0.5s. On native,
 * /api/* goes through CapacitorHttp and native-bridge.js wraps a missing body as new Response(""), and
 * explainGrounded() called r.json() on it unguarded.
 *
 * Fix: read the text, retry once, then return { error: "server-empty" }, which maikErrorNotice words
 * for a clinician. explainGrounded is extracted and run against a stubbed fetch (the file needs a
 * browser to load in full).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REASONING = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../home.js", import.meta.url), "utf8");

function makeExplain(fetchImpl) {
  const i = REASONING.indexOf("explainGrounded: function (pkg, opts) {");
  assert.ok(i > -1, "explainGrounded must exist");
  const j = REASONING.indexOf("\n    },\n", i);
  const src = REASONING.slice(i, j + 6);
  const factory = new Function("fetch", "setTimeout", "window",
    "function aiBase(){return '/api/ai';} function aiOn(){return true;}" +
    "function aiHeaders(){return Promise.resolve({'Content-Type':'application/json'});}" +
    "function raceTimeout(p){return p;}" +
    "return {" + src + "};");
  return factory(fetchImpl, (f) => f(), {});
}
const resp = (body, status) => new Response(body, { status: status || 200, headers: { "Content-Type": "application/json" } });
const PKG = { grounding: { q: "organophosphate" } };

test("REGRESSION: an empty body retries once and then returns a named error, not a TypeError", async () => {
  let calls = 0;
  const A = makeExplain(() => { calls++; return Promise.resolve(resp("")); });
  const r = await A.explainGrounded(PKG);
  assert.equal(calls, 2, "exactly one retry");
  assert.equal(r.error, "server-empty");
  assert.doesNotMatch(JSON.stringify(r), /Unexpected end of JSON/);
});

test("an empty first reply followed by a good one returns the answer", async () => {
  let calls = 0;
  const A = makeExplain(() => { calls++; return Promise.resolve(calls === 1 ? resp("") : resp(JSON.stringify({ text: "Atropine ..." }))); });
  const r = await A.explainGrounded(PKG);
  assert.equal(calls, 2);
  assert.equal(r.text, "Atropine ...");
});

test("a normal JSON reply is unchanged (one call, sources attached)", async () => {
  let calls = 0;
  const A = makeExplain(() => { calls++; return Promise.resolve(resp(JSON.stringify({ text: "ok" }))); });
  const r = await A.explainGrounded(Object.assign({ sources: ["kb"] }, PKG));
  assert.equal(calls, 1);
  assert.equal(r.text, "ok");
  assert.deepEqual(r.sources, ["kb"]);
});

test("a server JSON error body is passed through, not retried", async () => {
  let calls = 0;
  const A = makeExplain(() => { calls++; return Promise.resolve(resp(JSON.stringify({ error: "unauthorised" }), 403)); });
  const r = await A.explainGrounded(PKG);
  assert.equal(calls, 1);
  assert.equal(r.error, "unauthorised");
});

function notice() {
  const i = HOME.indexOf("function maikErrorNotice(r)");
  const body = HOME.slice(i, HOME.indexOf("\n  }\n", i) + 4);
  const esc = 'function maikEscH(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}';
  return new Function(esc + "\n" + body + "\nreturn maikErrorNotice;")();
}

test("the notice names an empty reply in plain words, never the raw parse error", () => {
  const N = notice();
  for (const r of [{ error: "server-empty", status: 502 }, { error: "Failed to execute 'json' on 'Response': Unexpected end of JSON input" }]) {
    const h = N(r);
    assert.match(h, /empty reply/i);
    assert.match(h, /Try again/);
    assert.doesNotMatch(h, /Unexpected end of JSON|on 'Response'/);
    assert.doesNotMatch(h, /—/, "no em-dash in app-facing text");
  }
  assert.match(N({ error: "server-empty", status: 502 }), /HTTP 502/);
});
