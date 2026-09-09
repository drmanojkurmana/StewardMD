/* test/wardsynq-downtime-inbound.test.mjs — TASK 7.15: what the INBOUND doors do when something is
 * down, exercised through the real routes.
 *
 *   credential expiry      a time-bounded grant lapses; the refusal says lapsed, not withdrawn
 *   WardSynQ outage        the record is unreadable mid-message -> 503, NOTHING written, safe to re-send
 *   retry after outage     the re-send lands exactly once (content-digest idempotency, end to end)
 *   truthful state         no message is ever answered "filed" when it was not
 *   reconciliation         what was held during the incident is on a queue a person can still work
 *
 * The OUTBOUND side of downtime (external-system outage, queue, retry/backoff, dead-letter) is
 * 7.4's and is proven in test/wardsynq-fhir-outbound.test.mjs.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-downtime-inbound.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async () => ({ ok: true }),
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");

/** A repository that can be taken down, exactly as a real one goes down: reads and writes throw. */
class FlakyRepository extends MemoryRepository {
  constructor() { super(); this.down = false; this.failWritesOnly = false; }
  async latest(...a) { if (this.down && !this.failWritesOnly) throw new Error("record store unavailable"); return super.latest(...a); }
  async list(...a) { if (this.down && !this.failWritesOnly) throw new Error("record store unavailable"); return super.list(...a); }
  async latestByType(...a) { if (this.down && !this.failWritesOnly) throw new Error("record store unavailable"); return super.latestByType(...a); }
  async byPatient(...a) { if (this.down && !this.failWritesOnly) throw new Error("record store unavailable"); return super.byPatient(...a); }
  async append(...a) { if (this.down) throw new Error("record store unavailable"); return super.append(...a); }
}

let RECORD = new FlakyRepository();
const TENANT = { id: "tenant-a", name: "Hospital A", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-a" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({ first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null), all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-a";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ADMIN = "admin@example.test", DOCTOR = "doctor@example.test";
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seed() {
  docs.clear(); clock = 1;
  RECORD = new FlakyRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { fhir: { inbound: { enabled: true } }, hl7: { inbound: { enabled: true } } } }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [DOCTOR, "doctor"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
}
async function as(email, path, method, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers: { "Cf-Access-Authenticated-User-Email": email, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
async function push(body, id) {
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/fhir?orgId=${ORG}`, { method: "POST", headers: { "Cf-Access-Authenticated-User-Email": DOCTOR, "Content-Type": "application/fhir+json", "X-Source-System": "lab-a" }, body: JSON.stringify(body) }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const grant = (over) => as(ADMIN, `/ward/source-grant?orgId=${ORG}`, "POST", { actorId: idFor(DOCTOR), sourceSystem: "lab-a", ...(over || {}) });
async function localPatient(id, mrn) {
  await RECORD.append(TENANT.id, [{ resourceType: "Patient", id, version: 1, mrn, name: "Feed Testcase", dob: "1980-01-01", sex: "female",
    meta: { recordedAt: "2026-01-01T00:00:00.000Z", effectiveAt: "2026-01-01T00:00:00.000Z", source: { system: "wardsynq-native", sourceId: null } } }]);
}
const bundle = (mrn, obsId, over) => ({
  resourceType: "Bundle", type: "collection", id: (over && over.id) || "b-1",
  entry: [
    { resource: { resourceType: "Patient", id: "EXT-1", identifier: [{ system: "urn:test:mrn", type: { coding: [{ code: "MR" }] }, value: mrn }], name: [{ family: "Testcase", given: ["Feed"] }], birthDate: "1980-01-01", gender: "female" } },
    { resource: { resourceType: "Observation", id: obsId, status: "final", category: [{ coding: [{ code: "laboratory" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "2823-3" }] }, subject: { reference: "Patient/EXT-1" },
      effectiveDateTime: "2026-09-01T10:00:00Z", valueQuantity: { value: (over && over.value) || 4.1, unit: "mmol/L" } } },
  ],
});

/* ---- credential expiry ---------------------------------------------------------------------- */

test("CREDENTIAL EXPIRY: a time-bounded grant lapses on its own, and the refusal says LAPSED rather than withdrawn", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");

  const past = new Date(Date.now() - 60_000).toISOString();
  const g = await grant({ expiresAt: past });
  assert.equal(g.__status, 200, JSON.stringify(g));
  assert.equal(g.grant.expiresAt, past);
  assert.equal(g.grant.active, true, "it was never revoked - it simply ran out");

  const r = await push(bundle("MRN-1", "OBS-1"));
  assert.equal(r.__status, 403, JSON.stringify(r));
  assert.match(r.issue[0].diagnostics, /expired at/);
  assert.match(r.issue[0].diagnostics, /lapsed rather than been withdrawn/, "a lapsed credential is renewed; a withdrawn one is asked about - the sender must be able to tell");
  assert.equal(await RECORD.latest(TENANT.id, "Observation", "fhir-lab-a-obs-obs-1"), null);
});

test("CREDENTIAL EXPIRY: renewing it with a future expiry lets the very next message through; an unexpired grant is untouched", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await grant({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal((await push(bundle("MRN-1", "OBS-A"))).__status, 403);

  const renewed = await grant({ expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal(renewed.__status, 200, JSON.stringify(renewed));
  assert.equal((await push(bundle("MRN-1", "OBS-B", { id: "b-2" }))).__status, 200, "renewed: it lands");

  // A grant with NO expiry is open-ended - every grant issued before the field existed still works.
  const openEnded = await grant({});
  assert.equal(openEnded.grant.expiresAt, null);
  assert.equal((await push(bundle("MRN-1", "OBS-C", { id: "b-3" }))).__status, 200);
});

test("CREDENTIAL EXPIRY: a nonsense expiry is refused at the grant door rather than stored as an unenforceable one", async () => {
  seed();
  const bad = await grant({ expiresAt: "next Tuesday" });
  assert.equal(bad.__status, 422, JSON.stringify(bad));
  assert.equal(bad.error, "bad_expiry");
});

/* ---- WardSynQ's own outage ------------------------------------------------------------------- */

test("WARDSYNQ OUTAGE: the record going down mid-message is answered 503 - nothing written, and the answer SAYS nothing was written", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await grant({});

  RECORD.down = true;
  const r = await push(bundle("MRN-1", "OBS-D"));
  RECORD.down = false;

  assert.equal(r.__status, 503, JSON.stringify(r));
  assert.equal(r.issue[0].severity, "error");
  assert.match(r.issue[0].diagnostics, /NOTHING was written/);
  assert.match(r.issue[0].diagnostics, /may be sent again/, "a sender that is not told it can retry will either lose the message or double it");
  assert.equal(await RECORD.latest(TENANT.id, "Observation", "fhir-lab-a-obs-obs-d"), null, "and nothing was, in fact, written");
});

test("WARDSYNQ OUTAGE: an outage is never answered as success - the message is not silently dropped either", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await grant({});
  RECORD.down = true;
  const r = await push(bundle("MRN-1", "OBS-E"));
  RECORD.down = false;
  assert.notEqual(r.__status, 200, "an outage that answered 200 would be a message the sender believes is on a chart");
  assert.ok(r.__status >= 500, `a transient failure is a 5xx the sender retries, not a 4xx it gives up on (got ${r.__status})`);
});

/* ---- retry after the outage: duplicate prevention -------------------------------------------- */

test("RETRY AFTER OUTAGE: the same message re-sent once the record is back lands exactly ONCE, however many times it is retried", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await grant({});
  const msg = bundle("MRN-1", "OBS-R");

  RECORD.down = true;
  assert.equal((await push(msg)).__status, 503, "the first attempt fails during the outage");
  RECORD.down = false;

  const first = await push(msg);
  assert.equal(first.__status, 200, JSON.stringify(first));
  const versions = (await RECORD.history(TENANT.id, "Observation", "fhir-lab-a-obs-obs-r")).length;
  assert.equal(versions, 1, "the retry after the outage filed it once");

  // The sender, unsure whether the first one landed, sends it twice more.
  const again = await push(msg);
  assert.equal(again.__status, 200);
  assert.equal(again.meta.tag[0].code, "replayed", "and is TOLD it was a replay rather than being silently ignored");
  await push(msg);
  assert.equal((await RECORD.history(TENANT.id, "Observation", "fhir-lab-a-obs-obs-r")).length, versions, "still exactly one version");
});

test("RETRY AFTER OUTAGE: a write that fails part-way leaves nothing behind for the retry to collide with", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await grant({});
  const msg = bundle("MRN-1", "OBS-W");

  // Reads succeed, the WRITE fails: the hardest case, because the message got all the way to the door.
  RECORD.down = true; RECORD.failWritesOnly = true;
  const failed = await push(msg);
  RECORD.down = false; RECORD.failWritesOnly = false;
  assert.notEqual(failed.__status, 200, JSON.stringify(failed));
  assert.equal(await RECORD.latest(TENANT.id, "Observation", "fhir-lab-a-obs-obs-w"), null, "a failed write left no half-record");

  const retried = await push(msg);
  assert.equal(retried.__status, 200, JSON.stringify(retried));
  assert.equal((await RECORD.history(TENANT.id, "Observation", "fhir-lab-a-obs-obs-w")).length, 1, "the retry filed it, once, cleanly");
});

test("PARTIAL WRITE: a transient failure is never answered 200, and the answer names what landed, what did not, and what to re-send", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await grant({});

  /* One write succeeds and the next fails - the case that used to answer HTTP 200 with a "500"
   * buried in one bundle entry, and then lose the failed rows for good, because the idempotency key
   * had already landed with the first one and the retry was recognised as a replay. */
  let writes = 0;
  const realAppend = RECORD.append.bind(RECORD);
  RECORD.append = async (...a) => { writes += 1; if (writes === 2) throw new Error("record store unavailable"); return realAppend(...a); };

  const two = {
    resourceType: "Bundle", type: "collection", id: "b-partial",
    entry: [
      { resource: { resourceType: "Patient", id: "EXT-1", identifier: [{ system: "urn:test:mrn", type: { coding: [{ code: "MR" }] }, value: "MRN-1" }], name: [{ family: "Testcase", given: ["Feed"] }], birthDate: "1980-01-01", gender: "female" } },
      { resource: { resourceType: "Observation", id: "OBS-P1", status: "final", category: [{ coding: [{ code: "laboratory" }] }], code: { coding: [{ system: "http://loinc.org", code: "2823-3" }] }, subject: { reference: "Patient/EXT-1" }, effectiveDateTime: "2026-09-01T10:00:00Z", valueQuantity: { value: 4.1, unit: "mmol/L" } } },
      { resource: { resourceType: "Observation", id: "OBS-P2", status: "final", category: [{ coding: [{ code: "laboratory" }] }], code: { coding: [{ system: "http://loinc.org", code: "2160-0" }] }, subject: { reference: "Patient/EXT-1" }, effectiveDateTime: "2026-09-01T10:05:00Z", valueQuantity: { value: 90, unit: "umol/L" } } },
    ],
  };
  const r = await push(two);
  RECORD.append = realAppend;

  assert.notEqual(r.__status, 200, "a message that did not fully land is never answered 200");
  assert.equal(r.__status, 503, JSON.stringify(r));
  const said = JSON.stringify(r.issue);
  assert.match(said, /could not be written/);
  assert.match(said, /DID land|nothing from this message landed/, "the sender is told what is already on the chart");
  assert.match(said, /re-send ONLY the resources named as failed|may be sent again unchanged/, "and exactly what to do about it - re-sending the whole message would be a replay");
});

/* ---- reconciliation after the incident -------------------------------------------------------- */

test("RECONCILIATION: everything held during an incident is still on the queue afterwards, with what it was and why", async () => {
  seed();
  await localPatient("pat-1", "MRN-1");
  await localPatient("pat-2", "MRN-2");
  await grant({});

  // Two messages that must be held: a look-alike identity, and a feed row for the wrong person.
  const lookalike = {
    resourceType: "Bundle", type: "collection", id: "b-look",
    entry: [{ resource: { resourceType: "Patient", id: "EXT-LOOK", name: [{ family: "Testcase", given: ["Feed"] }], birthDate: "1980-01-01", gender: "female" } }],
  };
  const held = await push(lookalike);
  assert.equal(held.__status, 202, JSON.stringify(held));

  const q = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);
  assert.equal(q.__status, 200);
  assert.ok(q.open.length >= 1, JSON.stringify(q));
  const ex = q.open[0];
  assert.ok(ex.reason && ex.raisedAt && ex.source, "each held item names what it was, when, and from whom");
  assert.match(q.note, /Nothing here has been filed on a chart/, "the queue states its own guarantee");

  // The queue survives an outage of its own: it is a record, not an in-memory list.
  RECORD.down = true;
  const during = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);
  RECORD.down = false;
  assert.notEqual(during.__status, 200, "while the record is down the queue says so rather than answering an empty list");
  const after = await as(DOCTOR, `/ward/fhir-exceptions?orgId=${ORG}`);
  assert.equal(after.open.length, q.open.length, "and everything held is still there once it is back");
});
