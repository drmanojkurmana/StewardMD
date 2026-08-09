// Round-trip regression: a checked-out timeline link must RESOLVE. The bug this guards against was a
// missing `await` on verifyTicketToken in getTimelineByToken — the unawaited Promise is truthy but its
// .ok is undefined, so every patient timeline link returned {error:"invalid"}. Uses an in-memory
// Firestore mock so the real mint/verify/encrypt path runs end to end.
//
// Needs `--experimental-test-module-mocks` (npm test supplies it). Without the flag mock.module is
// absent, so the test skips rather than fails — keeping `node --test` green for anyone who omits it.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

const canMock = typeof mock.module === "function";
let mod = null;
if (canMock) {
  const FB = new URL("../functions/_fbfirestore.js", import.meta.url).href;
  const store = new Map();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  mock.module(FB, { namedExports: {
    async fsGet(env, path) { return store.has(path) ? { id: path.split("/").pop(), name: path, fields: clone(store.get(path)) } : null; },
    wCreate(env, path, obj) { return { _op: "create", path, obj: clone(obj) }; },
    wUpdate(env, path, obj) { return { _op: "update", path, obj: clone(obj) }; },
    async fsCommit(env, writes) {
      for (const w of writes) {
        if (w._op === "create") { if (!store.has(w.path)) store.set(w.path, clone(w.obj)); }
        else if (w._op === "update") { store.set(w.path, Object.assign(store.get(w.path) || {}, clone(w.obj))); }
      }
    },
    async fsQuery() { return []; },
  }});
  mod = await import("../functions/_queue_timeline.js");
}

test("checkout timeline link resolves (verifyTicketToken awaited)", { skip: canMock ? false : "needs --experimental-test-module-mocks" }, async () => {
  const { appendTimeline, finalizeCheckout, getTimelineByToken } = mod;
  const env = {
    QUEUE_TOKEN_SECRET: "x".repeat(40),
    FOLLOWCARE_PHI_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
  };
  const session = { id: "sess1", doctorUid: "docA", hospitalId: "org1" };
  const ticket = { id: "tkt_" + Math.random().toString(36).slice(2), mrnLast4: "1234" };

  await appendTimeline(env, session, ticket, "vitals", "BP 120/80", "nurse1");
  const fin = await finalizeCheckout(env, session, ticket, "docA");
  assert.match(fin.url, /\/queue\?t=.+&v=t$/);
  const token = new URL(fin.url).searchParams.get("t");

  const res = await getTimelineByToken(env, token);
  assert.equal(res.ok, true, "link must resolve after checkout; got " + JSON.stringify(res));
  assert.equal(res.error, undefined);
  assert.ok(res.entries.some((e) => e.text === "BP 120/80"), "decrypted clinical entry present");
  assert.ok(res.linkExpiresAt > Date.now(), "7-day link live");

  // A tampered token must NOT resolve.
  const bad = await getTimelineByToken(env, token.slice(0, -3) + "aaa");
  assert.notEqual(bad.ok, true);
});
