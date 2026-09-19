// CERTIFICATION HARDENING: every callback shape we GUESSED must fail safe when the guess is wrong.
//
// ABDM has not published the V3 request YAML, so all 15 handlers parse a body we reasoned our way to and
// marked `// INFERRED`. That is the single largest unknown left before certification, and its failure mode
// is documented in our own history: an unverified parser against a real peer fails SILENTLY - which is how
// defects D4, D6, D4b and D4c all happened.
//
// This suite cannot tell us the real shapes; only a captured callback does that. What it CAN do is prove
// that being wrong is survivable. For every kind, against bodies that violate our assumption in a
// different way, three properties must hold:
//
//   1. NEVER THROW past the handler.  The receiver returns 202 and ABDM stops retrying. A crash that
//      escapes would be a 5xx, and ABDM treats non-2xx as a delivery failure and retries - a retry storm
//      against a parser that will fail identically every time.
//   2. NEVER MIS-ATTRIBUTE.  A body we cannot understand must write NOTHING, rather than filing data
//      against a guessed patient. Returning the wrong patient's records is the worst outcome available.
//   3. NEVER SILENTLY SUCCEED.  The gap belongs in the audit trail, so a captured-callback exercise has
//      something to compare against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { HIP_HANDLERS } from "../../../functions/_connect/abdm/hip-handlers.js";
import { HIU_HANDLERS } from "../../../functions/_connect/abdm/hiu-handlers.js";

const NOW = "2026-08-19T00:00:00.000Z";
const HIP_ID = "IN2810006668";
const ENV = {
  CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HIU_FLAG: "1", ABDM_ENV: "sandbox",
  ABDM_HIP_ID: HIP_ID, ABDM_HIU_ID: HIP_ID, ABDM_TENANT_ID: "t1",
  CONNECT_HMAC_SALT: Buffer.from("connect-test-hmac-salt-key-1234").toString("base64"),
  CONNECT_MASTER_KEY: Buffer.from("connect-test-master-key-32-bytes").toString("base64"),
};
const ALL = { ...HIP_HANDLERS, ...HIU_HANDLERS };

// Bodies that each break our assumption in a DIFFERENT way. A parser can survive one and die on another,
// so the sweep is the cross product of every kind and every one of these.
const HOSTILE = {
  "empty object": {},
  "null body": null,
  "array instead of object": [1, 2, 3],
  "string instead of object": "not a body",
  "every field null": { patient: null, consent: null, hiRequest: null, link: null, requester: null, careContexts: null, notification: null },
  "fields are the WRONG TYPE": { patient: 42, consent: "x", hiRequest: [], careContexts: {}, link: true, notification: 0 },
  "nested one level too deep": { data: { patient: { id: "x@sbx" }, consent: { id: "c-1" } } },
  "nested one level too shallow": { id: "x@sbx", consentId: "c-1", careContextReference: "ref-1" },
  "plausible but empty collections": { patient: { referenceNumber: "", careContexts: [] }, consent: { id: "" }, careContexts: [] },
  "hostile strings in every slot": { patient: { id: "../../etc/passwd" }, consent: { id: "SELECT 1; DROP TABLE x" }, careContexts: [{ referenceNumber: " " }] },
  "enormous array": { careContexts: new Array(500).fill({ referenceNumber: "r" }) },
};

function deps() {
  const audits = [];
  const posted = [];
  return {
    audits, posted,
    db: makeAbdmDb({}), r2: makeR2(), kv: makeMockKv(),
    gateway: { post: async (key, body) => { posted.push({ key, body }); return { status: 202, body: {} }; } },
    now: () => new Date(NOW),
    audit: async (ev) => { audits.push(ev); },
    // Every injected seam present but INERT, so nothing here depends on an outbound side effect.
    source: { listCareContexts: async () => [], loadRecord: async () => { throw new Error("no record"); } },
    issueQueueToken: async () => ({ tokenNumber: 1, expirySec: 1800 }),
    resolvePatientMobile: async () => null,
    findTicketMobile: async () => null,
  };
}
const headers = { requestId: "req-1", timestamp: NOW, entityId: HIP_ID };

test("no inferred handler CRASHES on a body that violates our assumption", async () => {
  // Property 1. A crash here becomes a 5xx at ABDM, and ABDM retries a non-2xx - so a parser bug turns
  // into a retry storm against a body that will fail identically every time.
  const escaped = [];
  for (const [kind, handler] of Object.entries(ALL)) {
    for (const [label, body] of Object.entries(HOSTILE)) {
      const d = deps();
      try {
        await handler({ env: ENV, deps: d, body, headers, claims: {}, route: { kind } });
      } catch (e) {
        escaped.push(kind + " / " + label + ": " + (e && e.message));
      }
    }
  }
  // A handler MAY reject deliberately (callbacks.js catches it into deps.onError and still ACKs 202), but
  // it must be a named refusal, never a TypeError from reading a field off something that is not an object.
  const crashes = escaped.filter((s) => /is not a function|Cannot read|Cannot convert|undefined is not|not iterable|circular/i.test(s));
  assert.deepEqual(crashes, [], "these are crashes, not refusals:\n" + crashes.join("\n"));
});

test("a body we cannot understand writes NOTHING - no row in any table", async () => {
  // Property 2, and the one that actually matters clinically. Filing data against a guessed patient is how
  // one person's records reach another, and a linked care context can never be withdrawn.
  for (const [kind, handler] of Object.entries(ALL)) {
    for (const [label, body] of Object.entries(HOSTILE)) {
      const d = deps();
      const before = JSON.stringify(d.db._tables);
      try { await handler({ env: ENV, deps: d, body, headers, claims: {}, route: { kind } }); } catch { /* refusals are fine */ }
      assert.equal(JSON.stringify(d.db._tables), before,
        kind + " / " + label + " must not write a row from a body it could not parse");
    }
  }
});

test("and it never echoes back a care context it did not resolve", async () => {
  // A handler that answers the gateway on an unparseable body would be asserting a patient identity it
  // never established. Silence is the only honest answer.
  for (const [kind, handler] of Object.entries(ALL)) {
    for (const [label, body] of Object.entries(HOSTILE)) {
      const d = deps();
      try { await handler({ env: ENV, deps: d, body, headers, claims: {}, route: { kind } }); } catch { /* ignore */ }
      for (const p of d.posted) {
        assert.ok(!/"referenceNumber":"r"/.test(JSON.stringify(p.body || {})),
          kind + " / " + label + " echoed a care context back from an unparsed body");
      }
    }
  }
});

test("every unparseable body leaves a trace, so a captured callback has something to diff against", async () => {
  // Property 3. Silent success is the worst of the three: it looks like the parser worked.
  const silent = [];
  for (const [kind, handler] of Object.entries(ALL)) {
    const d = deps();
    let threw = false;
    try { await handler({ env: ENV, deps: d, body: {}, headers, claims: {}, route: { kind } }); }
    catch { threw = true; }
    // Either it refused loudly (callbacks.js audits that via onError) or it recorded something itself.
    if (!threw && d.audits.length === 0 && d.posted.length === 0) silent.push(kind);
  }
  assert.deepEqual(silent, [], "these handlers accept an empty body without a word: " + silent.join(", "));
});

test("the sweep actually covers all 15 kinds - a shrinking handler map must not shrink the suite", () => {
  // If a kind is added or renamed and this count is not updated, the coverage claim in the certification
  // report becomes false. Fail here rather than quietly testing less.
  // 9 HIP + 6 HIU = the 15 INFERRED shapes the readiness report counts. This assertion already earned its
  // place: it caught the sweep claiming 14 because `discover` had been missed.
  assert.equal(Object.keys(HIP_HANDLERS).length, 9, "HIP handler count changed");
  assert.equal(Object.keys(HIU_HANDLERS).length, 6, "HIU handler count changed");
  assert.equal(Object.keys(ALL).length, 15);
  assert.ok(Object.keys(HOSTILE).length >= 10, "keep the hostile-body set broad");
});
