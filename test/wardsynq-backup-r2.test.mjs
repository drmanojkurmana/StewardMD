/* test/wardsynq-backup-r2.test.mjs - the scheduled backup to a Cloudflare R2 BINDING (env.WARDSYNQ_BACKUPS).
 *
 * The fake binding has the R2Bucket surface the adapter uses: put(key, value, { httpMetadata }), get(key) -> null | an
 * object with arrayBuffer() and httpMetadata, delete(key). https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 *
 * node --test --experimental-test-module-mocks test/wardsynq-backup-r2.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const S = await import("../functions/_wardsynq/backup-schedule.js");
const D = await import("../functions/_wardsynq/backup-destinations.js");
const O = await import("../functions/_wardsynq/object-store.js");
const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { CONNECTOR_TYPE } = await import("../functions/_wardsynq/connectors.js");
const { verifyPlan } = await import("../functions/_wardsynq/backup.js");
const { decryptBytes } = await import("../functions/_wardsynq/documents.js");

const T = "tenant-r2";
const KEY = Buffer.alloc(32, 9).toString("base64url");

/* An R2Bucket stand-in over a Map. Stores a copy of the bytes, like the real thing, and records every call. */
function fakeR2() {
  const objects = new Map(), calls = [];
  return {
    objects, calls,
    async put(key, value, opts) { calls.push(["put", key, opts]); objects.set(key, { bytes: new Uint8Array(value), httpMetadata: (opts && opts.httpMetadata) || {} }); return {}; },
    async get(key) {
      calls.push(["get", key]);
      const o = objects.get(key);
      return o ? { httpMetadata: o.httpMetadata, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) } : null;
    },
    async delete(key) { calls.push(["delete", key]); objects.delete(key); },
  };
}

async function hospital(provider) {
  const repo = new MemoryRepository();
  const at = "2026-09-01T00:00:00.000Z";
  await repo.append(T, [{ resourceType: "Patient", id: "pat-1", version: 1, name: "Rani Secretname", writtenBy: { id: "cfa:clerk", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:clerk", action: "record.write" } });
  await repo.append(T, [{ resourceType: "Observation", id: "obs-1", version: 1, patientId: "pat-1", value: 98, writtenBy: { id: "cfa:nurse", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:nurse", action: "record.write" } });
  await repo.append(T, [{ resourceType: "Observation", id: "obs-1", version: 2, patientId: "pat-1", value: 101, writtenBy: { id: "cfa:nurse", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:nurse", action: "record.write" } });
  if (provider) await repo.append(T, [{ resourceType: CONNECTOR_TYPE, id: "backup", version: 1, kind: "backup", provider, active: true, settings: {}, secretsEnc: {}, writtenBy: { id: "cfa:admin", kind: "human", at } }], {});
  return repo;
}

const runsOf = (repo) => repo.latestByType(T, "BackupRun", 1000);

test("r2Store round trips bytes and content type, a missing key is null, delete removes it", async () => {
  const bucket = fakeR2();
  const store = O.r2Store(bucket);
  await store.put("a/b.bin", new Uint8Array([1, 2, 3, 250]), "application/octet-stream");
  assert.deepEqual(bucket.calls[0][2], { httpMetadata: { contentType: "application/octet-stream" } });
  const got = await store.get("a/b.bin");
  assert.deepEqual([...got.bytes], [1, 2, 3, 250]);
  assert.equal(got.contentType, "application/octet-stream");
  assert.equal(await store.get("nope"), null);
  await store.delete("a/b.bin");
  assert.equal(await store.get("a/b.bin"), null);
});

test("r2Store turns a binding failure into an ObjectStoreError carrying the step", async () => {
  const store = O.r2Store({ put: async () => { throw new Error("R2 down"); }, get: async () => { throw new Error("R2 down"); }, delete: async () => { throw new Error("R2 down"); } });
  for (const [op, call] of [["put", () => store.put("k", new Uint8Array(1))], ["get", () => store.get("k")], ["delete", () => store.delete("k")]]) {
    await assert.rejects(call, (e) => e instanceof O.ObjectStoreError && e.op === op);
  }
});

test("backupBucketFromEnv only accepts something shaped like an R2 bucket", () => {
  assert.equal(O.backupBucketFromEnv({}), null);
  assert.equal(O.backupBucketFromEnv({ WARDSYNQ_BACKUPS: "bucket-name" }), null);
  assert.equal(O.backupBucketFromEnv({ WARDSYNQ_BACKUPS: { put() {} } }), null);
  assert.equal(O.backupBucketFromEnv({ WARDSYNQ_BACKUPS: fakeR2() }).kind, "r2");
});

test("platform destination: the R2 binding wins over DOC_S3_*, which is only a fallback", async () => {
  const bucket = fakeR2();
  const withBoth = await D.destinationFor({ provider: "platform", settings: {} }, {}, { env: { WARDSYNQ_BACKUPS: bucket, DOC_S3_ENDPOINT: "https://x", DOC_S3_BUCKET: "docs", DOC_S3_ACCESS_KEY_ID: "a", DOC_S3_SECRET_ACCESS_KEY: "b" } });
  assert.equal(withBoth.store.kind, "r2");
  const docOnly = await D.destinationFor({ provider: "platform", settings: {} }, {}, { env: { DOC_S3_ENDPOINT: "https://x", DOC_S3_BUCKET: "docs", DOC_S3_ACCESS_KEY_ID: "a", DOC_S3_SECRET_ACCESS_KEY: "b" } });
  assert.equal(docOnly.store.kind, "s3");
  const none = await D.destinationFor({ provider: "platform", settings: {} }, {}, { env: {} });
  assert.equal(none.error, "platform_not_configured");
  assert.equal(none.setup, "platform");
  assert.match(none.message, /WARDSYNQ_BACKUPS/);
});

test("a full backup to the R2 binding: encrypted, read back, recorded, dry-run restored, never in the clear", async () => {
  const repo = await hospital("platform");
  const bucket = fakeR2();
  let fetched = 0;
  const env = { FOLLOWCARE_PHI_KEY: KEY, WARDSYNQ_BACKUPS: bucket };
  const out = await S.backupHospital({ repository: repo, tenantId: T, env, nowIso: "2026-09-10T00:05:00.000Z", fetchImpl: async () => { fetched++; throw new Error("no network"); } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(fetched, 0, "the binding is used, not the S3 API");
  assert.equal(out.backup.kind, "full");
  assert.equal(out.backup.rows, 4, "patient, two observation versions, and the connector");
  assert.equal(out.restoreTest.outcome, "success", "the first run also does the weekly dry run: files, checksums, version chain, scratch restore");

  const [key, obj] = [...bucket.objects.entries()][0];
  assert.match(key, /^wardsynq-backups\/tenant-r2\/2026-09\/wsq-backup-full-\d+\.jsonl\.aesgcm$/);
  assert.equal(obj.httpMetadata.contentType, "application/octet-stream");
  assert.ok(!Buffer.from(obj.bytes).toString("latin1").includes("Secretname"), "nothing is stored in the clear");

  const [run] = await runsOf(repo);
  assert.equal(run.destination, "platform");
  assert.equal(run.location, `platform:${key}`);
  assert.equal(run.checksumVerified, true);
});

test("restore reads the backup back out of R2: decrypts with the hospital's key and verifies the version chain", async () => {
  const repo = await hospital("platform");
  const bucket = fakeR2();
  const env = { FOLLOWCARE_PHI_KEY: KEY, WARDSYNQ_BACKUPS: bucket };
  await S.backupHospital({ repository: repo, tenantId: T, env, nowIso: "2026-09-10T00:05:00.000Z" });

  const [run] = await runsOf(repo);
  const restored = await O.r2Store(bucket).get(run.objectKey);
  const text = new TextDecoder().decode(await decryptBytes(await S.backupKey(env, T), restored.bytes));
  const plan = verifyPlan(text);
  assert.equal(plan.ok, true, JSON.stringify(plan.problems));
  assert.equal(plan.rows.length, 4);
  const obs = plan.rows.filter((r) => r.resource_type === "Observation").map((r) => r.version).sort();
  assert.deepEqual(obs, [1, 2]);
  assert.ok(plan.rows.some((r) => r.resource_type === "Patient" && JSON.parse(r.body).name === "Rani Secretname"));

  // Another hospital's key cannot open it.
  await assert.rejects(decryptBytes(await S.backupKey(env, "tenant-other"), restored.bytes));

  // And the scheduled dry run itself restores from the same bucket.
  const dry = await S.restoreDryRun({ repository: repo, tenantId: T, store: O.r2Store(bucket), key: await S.backupKey(env, T), runs: await runsOf(repo) });
  assert.equal(dry.checks.scratchRestore, "restored");
  assert.equal(dry.checks.files, 1);
  assert.doesNotMatch(dry.note, /does not verify|could not be/);
});

test("a corrupted object in the bucket is caught by the dry run, and the next day's run chains an incremental from the first", async () => {
  const repo = await hospital("platform");
  const bucket = fakeR2();
  const env = { FOLLOWCARE_PHI_KEY: KEY, WARDSYNQ_BACKUPS: bucket };
  await S.backupHospital({ repository: repo, tenantId: T, env, nowIso: "2026-09-10T00:05:00.000Z" });
  const at = "2026-09-11T00:00:00.000Z";
  await repo.append(T, [{ resourceType: "Observation", id: "obs-1", version: 3, patientId: "pat-1", value: 104, writtenBy: { id: "cfa:nurse", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:nurse", action: "record.write" } });
  const next = await S.backupHospital({ repository: repo, tenantId: T, env, nowIso: "2026-09-11T00:05:00.000Z" });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(next.backup.kind, "incremental");
  assert.equal(next.backup.rows, 3, "since the first run: the new observation version, the first run's receipt and its restore test");
  assert.equal(bucket.objects.size, 2);

  const [first] = (await runsOf(repo)).sort((a, b) => a.at.localeCompare(b.at));
  const o = bucket.objects.get(first.objectKey);
  o.bytes[o.bytes.length - 1] ^= 1;
  const dry = await S.restoreDryRun({ repository: repo, tenantId: T, store: O.r2Store(bucket), key: await S.backupKey(env, T), runs: await runsOf(repo) });
  assert.equal(dry.outcome, "failed");
  assert.match(dry.note, /checksum/);
});

test("a bucket that rejects the write fails the backup without recording a receipt", async () => {
  const repo = await hospital("platform");
  const bucket = fakeR2();
  bucket.put = async () => { throw new Error("quota"); };
  const out = await S.backupHospital({ repository: repo, tenantId: T, env: { FOLLOWCARE_PHI_KEY: KEY, WARDSYNQ_BACKUPS: bucket }, nowIso: "2026-09-10T00:05:00.000Z" });
  assert.equal(out.ok, false);
  assert.equal(out.step, "store");
  assert.equal((await runsOf(repo)).length, 0);
});
