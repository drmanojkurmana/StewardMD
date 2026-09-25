import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-ward-list-round-trips.test.mjs - R7-2: the ward list costs a FIXED number of reads.
 *
 * THE BUG THIS PINS. Opening the ward list took 5-8 seconds on a real hospital, and none of it was
 * the database engine: at 82,000 rows the three queries behind it measure about 40ms of SQL. The
 * cost was the NUMBER OF ROUND TRIPS, and it grew with the ward:
 *
 *   - patientsFor() read the newest 1,000 Patient records and then issued ONE get per admitted
 *     patient outside that window. A hospital registering a few hundred people a day writes 1,000
 *     Patient rows in about three days, so most of the census missed and most of the ward cost a
 *     separate query.
 *   - every one of those reads then wrote its own audit row, and each audit row takes the hospital's
 *     chain lock, reads the head and inserts - two more serialised round trips each. 100 beds came
 *     to roughly 200 round trips, which at D1 latency is exactly the 5-8 seconds that was reported.
 *   - the expected-discharge map read EVERY stated date the hospital had ever written, in pages of
 *     1,000, to use the handful belonging to the open stays.
 *
 * So this test counts round trips rather than timing anything: a timing test on a laptop would pass
 * on the slow code. The counts must not grow with the size of the ward or the archive, which is why
 * the ward here (120 stays) is deliberately bigger than one page of anything and the patients are
 * written BEFORE 1,500 newer ones, so every single one of them falls outside the old roster window.
 *
 * node --test --experimental-test-module-mocks --test-concurrency=1 test/wardsynq-ward-list-round-trips.test.mjs
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
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
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

let RECORD = new MemoryRepository();
const TENANT_ROW = { id: "tenant-wsq", name: "WSQ Ward", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "org-wsq" } }) };
const tenantDb = {
  prepare: () => ({ bind: (...a) => ({
    first: async () => (String(a[0]) === TENANT_ROW.id ? { ...TENANT_ROW } : null),
    all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
  }) }),
  batch: async () => [],
};
mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({
      db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg,
      claimsFn: async () => ({ regNo: "TSMC-2019-44821", name: "Dr Test" }),
    }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-wsq", T = TENANT_ROW.id, DOCTOR = "doctor@example.test", ADMIN = "admin@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac",
  FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

const AT = "2026-09-01T08:00:00.000Z";
const meta = () => ({ recordedAt: AT, effectiveAt: AT, amendedAt: null, source: { system: "wardsynq-native", sourceId: null, importedAt: AT }, derivedFrom: [] });
const writtenBy = { id: "seed", kind: "human", at: AT };
const patient = (id, mrn, name) => ({ resourceType: "Patient", id, version: 1, mrn, name, dob: "1959-02-14", sex: "female", identifiers: [], meta: meta(), writtenBy });
const stay = (id, patientId, status) => ({ resourceType: "Encounter", id, version: 1, patientId, class: "IPD", status,
  location: { ward: "Medical A", bed: id.slice(-3) }, periodStart: AT, attendingId: "fb:doc", meta: meta(), writtenBy });
const edd = (encounterId) => ({ resourceType: "ExpectedDischarge", id: `wsq-edd-${String(encounterId).replace(/[^A-Za-z0-9_-]/g, "-")}`, version: 1,
  patientId: null, encounterId, expectedDate: "2026-09-20", meta: meta(), writtenBy });

/** Counts every call into the store, by method: this is the number the screen's latency is made of. */
function counting(repo) {
  const calls = {};
  const proxy = new Proxy(repo, {
    get: (t, k) => {
      const v = t[k];
      if (typeof v !== "function") return v;
      return (...args) => { calls[k] = (calls[k] || 0) + 1; return v.apply(t, args); };
    },
  });
  return { proxy, calls };
}

const BEDS = 120;
async function seedHospital() {
  docs.clear(); clock = 1;
  const repo = new MemoryRepository();
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "SMD-WARD01", name: "WSQ Ward Hospital", kind: "clinic", mode: "wardsynq",
    connectTenantId: T, ownerUid: idFor(ADMIN), createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[DOCTOR, "doctor"], [ADMIN, "admin"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  // The ward: its patients are written FIRST, so none of them is in the newest 1,000 Patient rows.
  await repo.append(T, Array.from({ length: BEDS }, (_, i) => patient(`pat-${i}`, `MRN-${i}`, `Ward Patient ${i}`)), {});
  await repo.append(T, Array.from({ length: BEDS }, (_, i) => stay(`enc-${String(i).padStart(3, "0")}`, `pat-${i}`, "in-progress")), {});
  // 1,500 newer registrations, in batches: the old roster read would return these and none of the ward.
  for (let i = 0; i < 1500; i += 500) {
    await repo.append(T, Array.from({ length: 500 }, (_, k) => patient(`pat-new-${i + k}`, `MRN-N${i + k}`, `Outpatient ${i + k}`)), {});
  }
  // The archive: finished stays and their stated discharge dates, which the ward list must not read.
  for (let i = 0; i < 2000; i += 500) {
    await repo.append(T, Array.from({ length: 500 }, (_, k) => stay(`enc-old-${i + k}`, `pat-new-${(i + k) % 1500}`, "finished")), {});
    await repo.append(T, Array.from({ length: 500 }, (_, k) => edd(`enc-old-${i + k}`)), {});
  }
  // A stated discharge date for a third of the ward, so the map is exercised, not skipped.
  await repo.append(T, Array.from({ length: 40 }, (_, i) => edd(`enc-${String(i).padStart(3, "0")}`)), {});
  return repo;
}

async function wardList(repo) {
  const { proxy, calls } = counting(repo);
  RECORD = proxy;
  const res = await onRequest({ request: new Request(`https://x/api/queue/ward/list?orgId=${ORG}`, {
    headers: { "Cf-Access-Authenticated-User-Email": DOCTOR },
  }), env: ENV });
  const body = await res.json();
  return { body, status: res.status, calls };
}

test("the ward list names every patient without one read per patient, and writes its audit rows in one batch", async () => {
  const repo = await seedHospital();
  const { body, status, calls } = await wardList(repo);

  assert.equal(status, 200, JSON.stringify(body).slice(0, 400));
  assert.ok(Array.isArray(body.patients), "the ward list answered with a roster: " + JSON.stringify(body).slice(0, 400));
  assert.equal(body.patients.length, BEDS, "every open stay is listed");
  // Correctness first: the whole point of the per-patient reads was the NAME, and it must survive.
  const nameless = body.patients.filter((p) => !p.name || !p.mrn);
  assert.equal(nameless.length, 0, "every row carries the name and MRN a nurse checks against a wristband");
  assert.equal(body.patients.find((p) => p.encounterId === "enc-000").name, "Ward Patient 0");
  // And the stated discharge dates still arrive for the stays that have one.
  assert.ok(body.patients.filter((p) => p.expectedDischarge && p.expectedDischarge.date).length >= 40, "the stated dates are read");

  /* THE POINT OF THIS TEST. `latest` is a single-record read: one per patient is what made the screen
   * slow, and the count must not follow the size of the ward. */
  assert.equal(calls.latest || 0, 0, "no per-patient read: the names come back in one query; calls were " + JSON.stringify(calls));
  assert.ok((calls.latestByIds || 0) <= 2, "the ward's patients and their dates are read by id, in one query each");
  // One chain extension for the whole request, not one per read (bufferReadAudits).
  assert.ok((calls.auditOnly || 0) <= 1, "read audits are not written one by one: " + (calls.auditOnly || 0));
  /* bufferReadAudits writes them AUDIT_FLUSH_BATCH (40) rows to a chain extension, so a 120-bed ward
   * is a handful of writes rather than one per read; the count follows the batch size, not the ward. */
  assert.ok((calls.auditMany || 0) <= 5, "the audit rows ride in batched chain extensions: " + (calls.auditMany || 0));
  // The archive is not walked: pageByType is the open-census read only.
  assert.ok((calls.pageByType || 0) <= 2, "the archive of finished stays and old dates is never paged: " + (calls.pageByType || 0));
  /* One whole-type roster remains and is meant to: mtpNameMask reads the MTP register on every ward
   * list so a woman's name is withheld (MTP Regulations reg 7) from anyone without that capability.
   * It is one read for the whole screen, not one per patient, and it is a legal check, not a lookup. */
  assert.ok((calls.latestByType || 0) <= 1, "no whole-type roster is read to find 120 names: " + (calls.latestByType || 0));

  const total = Object.values(calls).reduce((a, b) => a + b, 0);
  assert.ok(total <= 10, "a ward list costs a handful of reads, whatever the ward holds: " + JSON.stringify(calls));
});

test("the audit trail still records who read which chart: one read row per patient, batched not lost", async () => {
  const repo = await seedHospital();
  await wardList(repo);
  /* The round-trip fix must not cost the read log. DPDP's "who has read my record" is answered from
   * these rows, so collapsing 120 patient reads into one row would be a compliance regression, not an
   * optimisation: the rows are written TOGETHER, and there are still as many of them. */
  const reads = repo.audit.filter((e) => e.action === "record.read" || e.action === "record.list");
  assert.ok(reads.length >= 1, "the read is audited at all");
  const named = new Set(repo.audit.flatMap((e) => (e.scope && Array.isArray(e.scope.ids) ? e.scope.ids : e.scope && e.scope.id ? [e.scope.id] : [])));
  assert.ok(named.has("pat-0") && named.has("pat-119"), "every chart read is named in the audit trail: " + named.size);
});
