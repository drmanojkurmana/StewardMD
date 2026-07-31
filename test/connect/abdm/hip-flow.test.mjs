// test/connect/abdm/hip-flow.test.mjs — Stage-5 Task-9: the END-TO-END HIP-SERVE proof vs a mock HIU.
//
// StewardMD as a Health Information PROVIDER. The mock now plays a HIU that drives the WHOLE serve chain through
// the REAL handleIngress with real crypto + real D1:
//   linkCareContext -> (discovery) -> (hip-consent-notify + verify) -> (hip-hi-request) -> serveTransfer ->
//   (push to the HIU's dataPushUrl) -> mock-HIU decrypt (fidelius.openEntry, MIRRORED roles) -> normalizeNdhm.
// The discovery / consent-notify / hi-request webhooks are ALL RS256-signed with a key the mock publishes as the
// pinned JWKS, so the ingress body-verify runs its REAL verifyJws path (no verify stubs). The HIP push lands on
// the injected deps.fetch (the mock HIU's capture seam), and the mock decrypts each page with its OWN private key.
//
// COMPOSED invariants (must hold composed, not per-unit):
//   * happy path: the mock HIU decrypts EVERY page to the expected NDHM Bundle (Composition-first, unique
//     identifier, author/custodian tagged); a re-normalizeNdhm matches the SOURCE SCCM resource counts; ONE
//     entry per keyMaterial; hip.served audited; PHI recoverable ONLY after decrypt (never on the wire/at rest);
//   * cross-patient hip-hi-request -> refused (OverShareError path), nothing pushed, hip.denied audited;
//   * fuzzy discovery (demographics, no exact ABHA) -> no match, still audited;
//   * multi-record serve -> N pages, N DISTINCT keyMaterials, N DISTINCT ivs (re-derived via deriveKeyIv) —
//     the composed no-(key,iv)-reuse proof;
//   * flag OFF -> 404, no push, yet the Stage-4 HIU consume path still routes (zero regression);
//   * a tampered pushed ciphertext -> the mock HIU's openEntry fails closed (GCM auth).
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIngress } from "../../../functions/_connect/abdm/ingress.js";
import { ingestEvent } from "../../../functions/_connect/engine.js";
import { linkCareContext } from "../../../functions/_connect/abdm/hip.js";
import { getConsentReqByConsentId } from "../../../functions/_connect/abdm/consent.js";
import { followcareSource } from "../../../functions/_connect/abdm/hip-sources/followcare.js";
import { normalizeNdhm } from "../../../functions/_connect/connectors/abdm/normalize.js";
import { validateNdhmDoc } from "../../../functions/_connect/connectors/abdm/serialize.js";
import { hmacPseudonym, buildAuditEvent } from "../../../functions/_connect/audit.js";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";
import { makeMockKv } from "../../../functions/_connect/testkit.js";
import { listBuffered } from "../../../functions/_connect/abdm/state.js";
import { makeCtx } from "../../../functions/_connect/interfaces.js";
import { makeHipMockHiu } from "./mock-gateway.mjs";
import { episode, makeReader, PHI_MARKER } from "./fixtures/hip-flow-synthetic.mjs";

const TENANT = "t-hip";
const ABHA = "ramesh1985@sbx";            // RAW ABHA (patient A) — must never touch D1 / audit / the wire cleartext
const ABHA_B = "suresh1990@sbx";          // RAW ABHA (patient B) — the cross-patient adversary
const CONSENT_ID = "consent-hip-1";
const PUSH_URL = "https://hiu.example.org/abdm/push";
const SALT = Buffer.from("connect-hip-flow-test-hmac-salt-v1").toString("base64");
const NOW = () => new Date("2026-07-21T00:00:00.000Z");
const SEED_ISO = "2026-01-01T00:00:00.000Z";
const DATE_RANGE = { from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z" };
const EXPIRES_AT = "2026-12-31T23:59:59Z";
const PURPOSE = { code: "CAREMGT", text: "Care Management" };
const DX1 = "Community-acquired pneumonia";
const DX2 = "Acute pyelonephritis";
const SCOPE = (careContexts) => ({ careContexts, hiTypes: ["DischargeSummary"], purpose: PURPOSE, dateRange: DATE_RANGE, dataEraseAt: "2027-06-30T00:00:00Z", expiry: EXPIRES_AT });
const ENV = { CONNECT_FLAG: "1", CONNECT_HIP_FLAG: "1", CONNECT_HMAC_SALT: SALT, CONNECT_HIP_PUSH_HOSTS: "hiu.example.org", CONNECT_HIP_DISCO_LIMIT: "30", CONNECT_HIP_DISCO_WINDOW_SEC: "60" };

const identifyUser = async () => ({ id: "fb:u1", guest: false });
const makeSpyAudit = () => { const events = []; return { fn: async (e) => { events.push(e); }, events }; };
const sealStub = { seal: async (s) => "SEALED:" + s, open: async (s) => s.slice(7) };

// A FollowCare source that closes over the injected in-memory reader — the ingress serveDeps does NOT thread a
// `followcare` reader, so the mock source supplies its own (the REAL followcareSource projection otherwise).
function wrapSource(reader) {
  return {
    id: "followcare", hiTypes: followcareSource.hiTypes,
    listCareContexts: (e, d, a) => followcareSource.listCareContexts(e, { ...d, followcare: reader }, a),
    loadRecord: (e, d, a) => followcareSource.loadRecord(e, { ...d, followcare: reader }, a),
  };
}

// Seed the authoritative D1 the flow reloads: membership + tenant (for linkCareContext's server-derived actor)
// + the ONE consent_req row (consent_id + patient hash + persisted scope), seeded at INITIATED so the signed
// hip-consent-notify has a real monotonic effect (INITIATED -> GRANTED). Care-context rows come from
// linkCareContext at runtime (never seeded), so discovery + the serve guard bind against a genuine registration.
function seedDb(patientAbhaHash, { consentId = CONSENT_ID, careContexts = ["cc-A-1", "cc-A-2"], hiTypes = ["DischargeSummary"], status = "INITIATED" } = {}) {
  return makeAbdmDb({
    connect_membership: [{ user_id: "fb:u1", tenant_id: TENANT, role: "clinician" }],
    connect_tenant: [{ id: TENANT, mode: "live", granted_scopes: '["Condition","MedicationStatement","Observation","DocumentReference"]' }],
    connect_abdm_consent_req: [{
      request_id: consentId, consent_id: consentId, tenant_id: TENANT, actor: null,
      patient_abha_hash: patientAbhaHash, status, hi_types: JSON.stringify(hiTypes),
      care_contexts: JSON.stringify(careContexts), purpose: JSON.stringify(PURPOSE),
      date_range: JSON.stringify(DATE_RANGE), created_at: SEED_ISO, updated_at: SEED_ISO, expires_at: EXPIRES_AT,
    }],
  });
}

// One shared harness: ONE db/r2/kv/audit; the ingress deps ARE what the mock HIU delivers into. The mock's JWKS
// is injected as deps.jwks (body-verify uses it directly) and its capture-fetch as deps.fetch (the HIP push).
async function setup({ env = ENV, knobs = {}, episodes, consentSeed = {} } = {}) {
  const HASH = await hmacPseudonym(env, TENANT, ABHA);
  const db = seedDb(HASH, consentSeed);
  const r2 = makeR2(), kv = makeMockKv(), audit = makeSpyAudit();
  const reader = makeReader(episodes || [episode("cc-A-1", HASH, { dx: DX1, conditions: 2, meds: 2, observations: 2 }), episode("cc-A-2", HASH, { dx: DX2 })]);
  const ingressDeps = { db, r2, kv, secrets: sealStub, ingestEvent, audit: audit.fn, source: wrapSource(reader), now: NOW };
  const mock = await makeHipMockHiu({ env, deps: ingressDeps, handleIngress, tenantId: TENANT, now: NOW, dataPushUrl: PUSH_URL, knobs });
  ingressDeps.jwks = mock.jwks;        // the ingress body-verify resolves the CM JWKS directly (no fetch needed)
  ingressDeps.fetch = mock.hiuFetch;   // the HIP push (and any stray JWKS fetch) lands on the mock HIU's seam
  const linkDeps = { db, audit: audit.fn, identify: identifyUser };
  return { env, HASH, db, r2, kv, audit, ingressDeps, mock, reader, linkDeps };
}

const link = (h, env, abha, ref) => linkCareContext(env, h.linkDeps, { request: {}, tenantId: TENANT, abhaAddress: abha, ref, hiType: "DischargeSummary", display: "Discharge " + ref, now: NOW });

// Every collected audit event carries ONLY ALLOW-listed keys (buildAuditEvent drops the rest), and no listed
// secret (raw ABHA / decrypted PHI / raw careContextReference) ever appears anywhere in the trail.
function assertAuditPhiFree(audit, secrets) {
  for (const ev of audit.events) {
    assert.deepEqual(new Set(Object.keys(buildAuditEvent(ev))), new Set(Object.keys(ev)), "audit event carries ONLY ALLOW-listed keys: " + ev.action);
  }
  const blob = JSON.stringify(audit.events);
  for (const s of secrets) assert.equal(blob.includes(s), false, "secret must never be audited: " + s);
}

// ── 1. HAPPY PATH — link -> discover -> notify(verify) -> hi-request -> serve -> HIU decrypt -> re-normalize. ──
test("1. happy path: mock HIU decrypts every page to the NDHM Bundle; re-normalize matches source counts; one entry per keyMaterial; hip.served audited", async () => {
  const h = await setup();
  const refs = ["cc-A-1", "cc-A-2"];

  // (1) linkCareContext registers both care contexts (server-derived actor + membership -> idempotent D1 rows).
  for (const ref of refs) { const { id } = await link(h, h.env, ABHA, ref); assert.ok(id, "linkCareContext returns a row id for " + ref); }

  // (2) discovery -> the HIP returns EXACTLY the two linked care contexts (exact-match).
  const disc = await h.mock.fireDiscovery({ abhaAddress: ABHA, sourceId: "hiu-mock" });
  assert.equal(disc.status, 200);
  const discBody = JSON.parse(await disc.text());
  assert.equal(discBody.matched, true);
  assert.deepEqual(discBody.careContexts.map((c) => c.referenceNumber).sort(), refs);
  assert.ok(h.audit.events.some((e) => e.action === "hip.discovery" && e.scope.matched === true), "matched discovery audited");

  // (3) JWS-signed hip-consent-notify -> GRANTS the seeded consent row (monotonic INITIATED -> GRANTED).
  const cn = await h.mock.fireConsentNotify({ consentId: CONSENT_ID, status: "GRANTED", scope: SCOPE(refs) });
  assert.equal(cn.status, 202);
  assert.equal((await getConsentReqByConsentId(h.db, CONSENT_ID)).status, "GRANTED", "the signed notify advanced the row to GRANTED");

  // (4) hip-hi-request (OUR fresh HIU keyMaterial + dataPushUrl + txn + consentId) -> serveTransfer -> push.
  const hr = await h.mock.fireHiRequest({ consentId: CONSENT_ID, careContexts: refs, transactionId: "txn-hip-1" });
  assert.equal(hr.status, 202);
  assert.equal(h.mock.pushedPages.length, 2, "one page pushed per care-context");
  for (const { body } of h.mock.pushedPages) {
    assert.equal(body.entries.length, 1, "EXACTLY one entry per keyMaterial (nonce-safe wire shape)");
    assert.ok(body.keyMaterial && body.keyMaterial.dhPublicKey && body.keyMaterial.nonce, "carries the HIP public keyMaterial");
  }

  // (5) the mock HIU decrypts EVERY page to the expected NDHM Bundle (Composition-first, unique id, author/custodian).
  const plaintexts = await h.mock.decryptPages();
  assert.equal(plaintexts.length, 2, "both pages decrypt with the HIU's own key");
  const byRef = h.mock.pushedPages.map((p, i) => ({ ref: p.body.careContextReference, doc: JSON.parse(plaintexts[i]) }));
  const seenIds = new Set();
  for (const { doc } of byRef) {
    assert.equal(doc.resourceType, "Bundle");
    assert.equal(doc.type, "document");
    assert.ok(doc.identifier && doc.identifier.value, "globally-unique Bundle.identifier");
    assert.equal(seenIds.has(doc.identifier.value), false, "each page carries a FRESH unique identifier");
    seenIds.add(doc.identifier.value);
    const first = doc.entry[0].resource;
    assert.equal(first.resourceType, "Composition", "Composition-FIRST");
    assert.ok(first.author && first.author.length, "author (StewardMD device) tagged");
    assert.ok(first.custodian, "custodian (StewardMD tenant organization) tagged");
    assert.equal(validateNdhmDoc(doc).ok, true, "the served doc passes the structural NDHM gate");
  }

  // (6) re-normalizeNdhm each decrypted doc -> the SAME SCCM resource counts as the SOURCE projection.
  for (const { ref, doc } of byRef) {
    const src = (await followcareSource.loadRecord(h.env, { followcare: h.reader, now: NOW }, { tenantId: TENANT, careContextRef: ref })).record;
    const back = normalizeNdhm(makeCtx({ tenant: { id: TENANT, mode: "live" } }), doc);
    assert.equal(back.conditions.length, src.conditions.length, ref + ": conditions round-trip");
    assert.equal(back.medications.length, src.medications.length, ref + ": medications round-trip");
    assert.equal(back.observations.length, src.observations.length, ref + ": observations round-trip");
    assert.equal(back.documents.length, src.documents.length, ref + ": documents round-trip");
  }

  // hip.served audited (metadata only): consentId + transactionId + page count, never the ABHA.
  const served = h.audit.events.find((e) => e.action === "hip.served");
  assert.ok(served, "hip.served audited");
  assert.equal(served.consentId, CONSENT_ID);
  assert.equal(served.transactionId, "txn-hip-1");

  // PHI recoverable ONLY after decrypt: the marker + dx are in the plaintext but NEVER on the wire / at rest / audited.
  const pushBlob = JSON.stringify(h.mock.pushedPages.map((p) => p.body));
  assert.equal(pushBlob.includes(PHI_MARKER), false, "the pushed body is ciphertext — PHI never on the wire in cleartext");
  assert.equal(pushBlob.includes(DX1), false, "plaintext dx absent from the pushed body");
  assert.ok(plaintexts.some((pt) => pt.includes(PHI_MARKER) && pt.includes(DX1)), "PHI + dx recoverable ONLY after the HIU decrypt");
  assert.equal(JSON.stringify(h.db._tables).includes(PHI_MARKER), false, "decrypted PHI never persisted to D1");
  assert.equal(JSON.stringify(h.db._tables).includes(ABHA), false, "raw ABHA never persisted to D1 (HMAC only)");
  assertAuditPhiFree(h.audit, [ABHA, PHI_MARKER, "cc-A-1"]);
});

// ── 2. CROSS-PATIENT hip-hi-request -> refused (OverShareError path), nothing pushed, hip.denied audited. ──────
test("2. cross-patient hi-request -> the HIP guard refuses the WHOLE transfer (OverShareError), nothing pushed, hip.denied audited", async () => {
  const HASH_A = await hmacPseudonym(ENV, TENANT, ABHA);
  const HASH_B = await hmacPseudonym(ENV, TENANT, ABHA_B);
  const h = await setup({
    consentSeed: { careContexts: ["cc-A-1", "cc-B-1"] },
    episodes: [episode("cc-A-1", HASH_A, { dx: DX1 }), episode("cc-B-1", HASH_B, { dx: "Appendicitis", patientId: "fc-pat-B" })],
  });
  await link(h, h.env, ABHA, "cc-A-1");
  await link(h, h.env, ABHA_B, "cc-B-1");     // registered to patient B — the guard's D1 subject bind catches it
  await h.mock.fireConsentNotify({ consentId: CONSENT_ID, status: "GRANTED", scope: SCOPE(["cc-A-1", "cc-B-1"]) });

  const hr = await h.mock.fireHiRequest({ consentId: CONSENT_ID, careContexts: ["cc-A-1", "cc-B-1"], transactionId: "txn-x" });
  assert.equal(hr.status, 500, "the OverShareError propagates -> the ingress fails closed");
  assert.equal(h.mock.pushedPages.length, 0, "NOT even the in-scope A record is pushed once a cross-patient record is present");
  assert.ok(h.audit.events.some((e) => e.action === "hip.denied"), "hip.denied audited");
  assert.ok(!h.audit.events.some((e) => e.action === "hip.served"), "hip.served must NOT be audited on a refusal");
});

// ── 3. FUZZY discovery (demographics, no exact ABHA) -> no match, still audited (never fuzzy/demographic). ─────
test("3. fuzzy discovery (demographics only, no exact ABHA) -> matched:false constant shape, still audited", async () => {
  const h = await setup();
  await link(h, h.env, ABHA, "cc-A-1");         // a registered patient exists...
  const disc = await h.mock.fireDiscovery({ fuzzy: true, sourceId: "hiu-fuzzy" });   // ...but the probe carries only demographics
  assert.equal(disc.status, 200);
  assert.deepEqual(JSON.parse(await disc.text()), { ok: true, matched: false, careContexts: [] }, "no exact identifier => never match");
  const ev = h.audit.events.find((e) => e.action === "hip.discovery");
  assert.ok(ev && ev.scope.matched === false, "a demographic-only probe is STILL audited as a miss");
  assert.equal(h.mock.pushedPages.length, 0);
});

// ── 4. MULTI-RECORD serve -> N pages, N DISTINCT keyMaterials, N DISTINCT ivs (composed no-(key,iv)-reuse proof). ─
test("4. multi-record serve -> N pages, N DISTINCT keyMaterials + N DISTINCT ivs (re-derived via deriveKeyIv) — no (key,iv) reuse", async () => {
  const HASH = await hmacPseudonym(ENV, TENANT, ABHA);
  const refs = ["cc-A-1", "cc-A-2", "cc-A-3", "cc-A-4"];
  const h = await setup({
    consentSeed: { careContexts: refs },
    episodes: refs.map((r, i) => episode(r, HASH, { dx: "Dx-" + i })),
  });
  for (const ref of refs) await link(h, h.env, ABHA, ref);
  await h.mock.fireConsentNotify({ consentId: CONSENT_ID, status: "GRANTED", scope: SCOPE(refs) });

  const hr = await h.mock.fireHiRequest({ consentId: CONSENT_ID, careContexts: refs, transactionId: "txn-multi" });
  assert.equal(hr.status, 202);
  assert.equal(h.mock.pushedPages.length, refs.length, "N pages for N records");

  // N DISTINCT keyMaterials (a fresh HIP ephemeral per page) — the R1 fresh-material guarantee at the wire.
  const pubs = h.mock.pushedPages.map((p) => p.body.keyMaterial.dhPublicKey);
  const kmNonces = h.mock.pushedPages.map((p) => p.body.keyMaterial.nonce);
  assert.equal(new Set(pubs).size, refs.length, "N DISTINCT HIP ephemeral public keys");
  assert.equal(new Set(kmNonces).size, refs.length, "N DISTINCT HIP nonces");
  for (const { body } of h.mock.pushedPages) assert.equal(body.entries.length, 1, "one entry per keyMaterial");

  // N DISTINCT ivs, re-derived via fidelius.deriveKeyIv — the composed nonce-safety proof: NO (key,iv) is reused
  // (distinct keys from distinct ECDH secrets AND distinct ivs from distinct nonces).
  const ivs = await h.mock.deriveIvs();
  assert.equal(ivs.length, refs.length);
  assert.equal(new Set(ivs).size, refs.length, "no (key,iv) reuse: every page derives a DISTINCT iv");

  // and every page still round-trips (decrypts) to prove the distinct material actually seals real content.
  const plaintexts = await h.mock.decryptPages();
  assert.equal(plaintexts.length, refs.length);
  for (const pt of plaintexts) assert.equal(JSON.parse(pt).resourceType, "Bundle");
});

// ── 5. FLAG OFF -> ingress 404, no push, yet the Stage-4 HIU consume path STILL routes (zero regression). ──────
test("5. HIP flag OFF -> discovery/notify/hi-request 404, nothing pushed; the Stage-4 HIU data-push still buffers", async () => {
  const env = { ...ENV, CONNECT_HIP_FLAG: "0" };
  const h = await setup({ env });
  await link(h, env, ABHA, "cc-A-1");            // linkCareContext is not HIP-flag-gated (the api route gates)

  assert.equal((await h.mock.fireDiscovery({ abhaAddress: ABHA })).status, 404, "discovery 404s with the HIP flag off (no existence leak)");
  assert.equal((await h.mock.fireConsentNotify({ consentId: CONSENT_ID, status: "GRANTED", scope: SCOPE(["cc-A-1"]) })).status, 404);
  const hr = await h.mock.fireHiRequest({ consentId: CONSENT_ID, careContexts: ["cc-A-1"], transactionId: "txn-off" });
  assert.equal(hr.status, 404);
  assert.equal(h.mock.pushedPages.length, 0, "nothing served/pushed with the HIP flag off");
  assert.equal((await getConsentReqByConsentId(h.db, CONSENT_ID)).status, "INITIATED", "the flag-off notify had no effect");

  // A Stage-4 HIU data-push (NOT a HIP type) is unaffected by smd_connect_hip: seed a txn, fire it -> buffered.
  h.db._tables.connect_abdm_txn = [{ request_id: "req-hiu", transaction_id: "txn-hiu", tenant_id: TENANT, status: "REQUESTED", eph_privkey_sealed: "S:x", ack_claimed: 0, created_at: SEED_ISO, updated_at: SEED_ISO }];
  const dp = await h.mock.fireEvent({ type: "data-push", transactionId: "txn-hiu", entries: [{ careContextReference: "cc-x", content: "CIPHER", checksum: "sum1" }] });
  assert.equal(dp.status, 202, "the HIU consume path routes normally with the HIP flag off");
  assert.equal((await listBuffered(h.r2, "txn-hiu")).length, 1, "the encrypted HIU entry buffered (HIP flag irrelevant)");
});

// ── 6. TAMPERED pushed ciphertext -> the mock HIU's openEntry fails closed (GCM auth). ────────────────────────
test("6. a tampered pushed ciphertext -> the mock HIU decrypt fails closed (GCM auth), intact page still opens", async () => {
  const h = await setup({ episodes: [episode("cc-A-1", await hmacPseudonym(ENV, TENANT, ABHA), { dx: DX1 })], consentSeed: { careContexts: ["cc-A-1"] } });
  await link(h, h.env, ABHA, "cc-A-1");
  await h.mock.fireConsentNotify({ consentId: CONSENT_ID, status: "GRANTED", scope: SCOPE(["cc-A-1"]) });
  const hr = await h.mock.fireHiRequest({ consentId: CONSENT_ID, careContexts: ["cc-A-1"], transactionId: "txn-tamper" });
  assert.equal(hr.status, 202);
  assert.equal(h.mock.pushedPages.length, 1);

  const clean = await h.mock.decryptPages();
  assert.equal(clean.length, 1, "the intact page opens");
  assert.ok(clean[0].includes(DX1));
  await assert.rejects(() => h.mock.decryptPages({ tamper: true }), /decrypt\/auth failed|checksum/i, "a flipped ciphertext byte fails the GCM tag");
});
