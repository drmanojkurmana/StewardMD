// test/connect/abdm/audit-phi-free.test.mjs — Stage-6 Task-7 (R14 §14.4).
//
// PHI-free-by-construction proof, EXTENDED to every Stage-4/5 audit event type. `buildAuditEvent`'s
// only defence is its structural ALLOW filter: it copies ONLY allow-listed keys and drops everything
// else (functions/_connect/audit.js). This suite pins that invariant PER EVENT TYPE so a future
// contributor cannot add a leaky field (a raw ABHA, a raw careContextReference, decrypted content, key
// material) to any event without turning a test red.
//
// For EVERY event type we feed the legitimate allow-listed fields PLUS a contaminant blob salted with a
// raw-ABHA sentinel, a raw-careContextReference sentinel and a plaintext/patientCase sentinel, then assert:
//   (a) output keys are a SUBSET of ALLOW (nothing outside the allow-list survives);
//   (b) every contaminant key is structurally DROPPED and no raw sentinel VALUE appears anywhere;
//   (c) the HMAC `careContextHash` survives while the raw `careContextReference` never does;
//   (d) scope / resourceCounts stay metadata-only (counts, ids, reasons) — the convention guard, since
//       buildAuditEvent keeps `scope`/`resourceCounts` as opaque blobs and does NOT sanitise inside them.
// Plus an ALLOW snapshot guard (adding a PHI-shaped key to ALLOW fails) and a non-tautology control
// proving the filter really drops an unknown key while keeping a legitimate one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditEvent, ALLOW } from "../../../functions/_connect/audit.js";

const TS = "2026-08-01T00:00:00.000Z";
const CC_HASH = "cc-" + "a".repeat(60); // stand-in for the HMAC hex — opaque, clearly NOT the raw ref

// ── Sentinels: raw PHI / secrets that must NEVER survive into a built event ──────────────────────────
const RAW_ABHA = "ramesh1985@sbx";                                             // raw ABHA address
const RAW_CCREF = "hospital-A/opd/2026/ctx-77";                                // raw careContextReference
const PLAINTEXT = '{"resourceType":"Bundle","subject":"Ramesh Kumar","dob":"1985-04-12"}'; // decrypted content
const KEYMAT = "MFkwEwYHKoZIzj0CAQ-EPHEMERAL-PRIVKEY";                         // key material
const SENTINELS = [RAW_ABHA, RAW_CCREF, PLAINTEXT, KEYMAT, "Ramesh Kumar", "1985-04-12", "+91-99999-00000"];

// Every contaminant a leaky event might try to smuggle in (none of these keys is in ALLOW).
const CONTAM = {
  abha: RAW_ABHA,
  abhaAddress: RAW_ABHA,
  careContextReference: RAW_CCREF,
  careContexts: [{ referenceNumber: RAW_CCREF, display: "OPD 12 Apr" }],
  decrypted: PLAINTEXT,
  plaintext: PLAINTEXT,
  patientCase: PLAINTEXT,
  bundle: PLAINTEXT,
  dhPublicKey: KEYMAT,
  eph_privkey: KEYMAT,
  keyMaterial: KEYMAT,
  patientName: "Ramesh Kumar",
  birthDate: "1985-04-12",
  phone: "+91-99999-00000",
};

// ── The Stage-4/5 event catalogue (R14 §14.4) ───────────────────────────────────────────────────────
// consent.requested|granted|denied|revoked|verified, data.requested|received|failed|erased,
// hip.discovery|linked|served|denied|failed. `legit` mirrors each real emitter's ALLOW-listed payload.
const EVENTS = [
  // ── consent lifecycle (HIU) ──
  { action: "consent.requested", legit: { tenantId: "t1", actor: "u1", patientRefHash: "abx-hash", resourceCounts: { hiTypes: 3 }, scope: { requestId: "req-1" }, outcome: "ok", ts: TS } },
  { action: "consent.granted",   legit: { tenantId: "t1", consentId: "consent-1", resourceCounts: { hiTypes: 3, careContexts: 2 }, scope: { requestId: "req-1" }, outcome: "ok", ts: TS } },
  { action: "consent.denied",    legit: { outcome: "denied", ts: TS, scope: { reason: "no-consentId" } } },
  { action: "consent.revoked",   legit: { tenantId: "t1", consentId: "consent-1", outcome: "ok", ts: TS, scope: { reason: "patient-revoked" } } },
  { action: "consent.verified",  legit: { outcome: "ok", ts: TS, resourceCounts: { hiTypes: 3, careContexts: 2 }, scope: { consentId: "consent-1" } } },
  // ── data lifecycle (HIU) ──
  { action: "data.requested",    legit: { tenantId: "t1", actor: "u1", consentId: "consent-1", resourceCounts: { hiTypes: 3, careContexts: 2 }, scope: { requestId: "req-1" }, outcome: "ok", ts: TS } },
  { action: "data.received",     legit: { tenantId: "t1", consentId: "consent-1", transactionId: "txn-1", careContextHash: CC_HASH, resourceCounts: { entries: 4, decrypted: 4 }, outcome: "ok", ts: TS } },
  { action: "data.failed",       legit: { tenantId: "t1", consentId: "consent-1", transactionId: "txn-1", resourceCounts: { entries: 4, failed: 1 }, scope: { error: "gcm-auth" }, outcome: "failed", ts: TS } },
  { action: "data.erased",       legit: { tenantId: "t1", consentId: "consent-1", transactionId: "txn-1", resourceCounts: { objects: 2 }, scope: { reason: "revoked" }, outcome: "ok", ts: TS } },
  // ── HIP lifecycle (Stage-5, gated) ──
  { action: "hip.discovery",     legit: { tenantId: "t1", outcome: "ok", ts: TS, scope: { sourceId: "src-1", matched: true }, resourceCounts: { careContexts: 2 } } },
  { action: "hip.linked",        legit: { tenantId: "t1", actor: "u1", careContextHash: CC_HASH, outcome: "ok", ts: TS, scope: { source: "followcare" } } },
  { action: "hip.served",        legit: { tenantId: "t1", consentId: "consent-1", transactionId: "txn-1", careContextHash: CC_HASH, resourceCounts: { pages: 2, warnings: 0 }, outcome: "ok", ts: TS } },
  { action: "hip.denied",        legit: { tenantId: "t1", consentId: "consent-1", outcome: "denied", ts: TS, scope: { reason: "hi-type-scope" } } },
  { action: "hip.failed",        legit: { tenantId: "t1", consentId: "consent-1", transactionId: "txn-1", resourceCounts: { pages: 2, pushed: 1 }, scope: { error: "push" }, outcome: "failed", ts: TS } },
];

// scope / resourceCounts are ALLOW-listed as OPAQUE blobs — buildAuditEvent does not recurse into them,
// so the only protection against PHI hiding there is the convention "keep these metadata-only". Enforce it:
// every value must be a scalar (never a nested object/array carrying a reference list), no key may be
// PHI-shaped, and no known raw sentinel may appear.
const METADATA_KEYS = /^(reason|error|requestId|sourceId|consentId|matched|source|hiTypes|careContexts|entries|decrypted|failed|objects|pages|warnings|pushed)$/;
function assertMetadataOnly(action, name, blob) {
  const dump = JSON.stringify(blob);
  for (const s of SENTINELS) assert.equal(dump.includes(s), false, `${action}: raw PHI sentinel leaked into ${name}`);
  for (const [k, v] of Object.entries(blob)) {
    assert.ok(METADATA_KEYS.test(k), `${action}: unexpected ${name} key "${k}" — keep ${name} metadata-only (counts/ids/reasons)`);
    assert.ok(v == null || typeof v !== "object", `${action}: ${name}.${k} must be a scalar metadata value, not a nested object/list`);
  }
}

for (const { action, legit } of EVENTS) {
  test(`buildAuditEvent(${action}) is PHI-free by construction (R14)`, () => {
    const out = buildAuditEvent({ action, ...legit, ...CONTAM });

    // (a) output keys are a SUBSET of ALLOW — nothing outside the allow-list survives
    for (const k of Object.keys(out)) assert.ok(ALLOW.includes(k), `${action}: leaked non-ALLOW key "${k}"`);
    assert.equal(out.action, action);

    // (b) every contaminant key is structurally dropped, and no raw sentinel VALUE survives anywhere
    for (const k of Object.keys(CONTAM)) assert.equal(k in out, false, `${action}: contaminant key "${k}" survived`);
    const dump = JSON.stringify(out);
    for (const s of SENTINELS) assert.equal(dump.includes(s), false, `${action}: raw sentinel "${s}" leaked into the event`);

    // (c) legit allow-listed metadata is preserved (the guard drops PHI, not the audit trail)
    for (const k of Object.keys(legit)) assert.deepEqual(out[k], legit[k], `${action}: dropped legit metadata "${k}"`);

    // (d) only the HMAC careContextHash survives; the raw careContextReference NEVER does
    assert.equal("careContextReference" in out, false, `${action}: raw careContextReference must never survive`);
    if ("careContextHash" in legit) assert.equal(out.careContextHash, CC_HASH, `${action}: the HMAC careContextHash must survive`);

    // (e) scope / resourceCounts stay metadata-only (convention + shape guard)
    if (out.scope) assertMetadataOnly(action, "scope", out.scope);
    if (out.resourceCounts) assertMetadataOnly(action, "resourceCounts", out.resourceCounts);
  });
}

test("ALLOW is EXACTLY the expected non-PHI metadata set (snapshot guard) (R14)", () => {
  const EXPECTED = [
    "id", "tenantId", "actor", "connectorId", "action", "resourceCounts", "scope",
    "patientRefHash", "latencyMs", "outcome", "ts", "consentId", "transactionId", "careContextHash",
  ];
  // Order-independent membership snapshot: adding OR removing a key fails this guard.
  assert.deepEqual([...ALLOW].sort(), [...EXPECTED].sort());
});

test("ALLOW admits NO PHI-shaped key — adding one would fail this guard (R14)", () => {
  const PHI_SHAPED = [
    "abha", "abhaAddress", "careContextReference", "careContexts", "decrypted", "plaintext",
    "patientCase", "bundle", "dhPublicKey", "eph_privkey", "keyMaterial", "patientName",
    "name", "birthDate", "dob", "phone", "address", "mrn",
  ];
  for (const k of PHI_SHAPED) assert.equal(ALLOW.includes(k), false, `ALLOW must never contain PHI-shaped key "${k}"`);
});

test("guard is real, not tautological: an unknown key is dropped while an ALLOW key is kept (R14)", () => {
  const out = buildAuditEvent({ action: "data.received", __smuggledPhi: RAW_ABHA, tenantId: "t1" });
  assert.equal("__smuggledPhi" in out, false);              // negative control: unknown key dropped
  assert.equal(out.tenantId, "t1");                          // positive control: filter is not dropping everything
  assert.equal(out.action, "data.received");
  assert.equal(JSON.stringify(out).includes(RAW_ABHA), false);
});
