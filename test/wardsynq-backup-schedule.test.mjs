/* test/wardsynq-backup-schedule.test.mjs - the scheduled backup: when it runs, what it keeps, how it is verified,
 * and the S3-compatible destination's request shape (mocked fetch).
 *
 * Spec for the adapter's requests: S3 PutObject/GetObject/DeleteObject, path-style, Signature Version 4
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html,
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html). The signer itself is pinned to
 * AWS's published example in test/wardsynq-object-store.test.mjs.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-backup-schedule.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const S = await import("../functions/_wardsynq/backup-schedule.js");
const B = await import("../functions/_wardsynq/backup-destinations.js");
const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { sealSecret } = await import("../functions/_wardsynq/webhooks.js");
const { CONNECTOR_TYPE, KINDS } = await import("../functions/_wardsynq/connectors.js");
const { systemHealthReport } = await import("../functions/_wardsynq/system-health.js");

const T = "tenant-a";
const ENV = { FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url") };
const ENDPOINT = "https://93.184.216.34";
const sha = (b) => createHash("sha256").update(Buffer.from(b)).digest("hex");

/* A mocked S3 server: an in-memory bucket behind fetch, recording every request. */
function bucket(opts) {
  const o = opts || {};
  const objects = new Map(), calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (o.status) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: o.status });
    if (init.method === "PUT") { objects.set(u.pathname, new Uint8Array(init.body)); return new Response("", { status: 200 }); }
    if (init.method === "GET") {
      const b = objects.get(u.pathname);
      if (!b) return new Response("", { status: 404 });
      return new Response(o.corrupt ? b.map((x) => x ^ 1) : b, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    if (init.method === "DELETE") { objects.delete(u.pathname); return new Response(null, { status: 204 }); }
    return new Response("", { status: 405 });
  };
  return { objects, calls, fetchImpl };
}

async function hospital(provider, settings) {
  const repo = new MemoryRepository();
  const at = "2026-09-01T00:00:00.000Z";
  await repo.append(T, [{ resourceType: "Patient", id: "pat-1", version: 1, name: "Asha Secretname", writtenBy: { id: "cfa:clerk", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:clerk", action: "record.write" } });
  await repo.append(T, [{ resourceType: "Observation", id: "obs-1", version: 1, patientId: "pat-1", value: 120, writtenBy: { id: "cfa:nurse", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:nurse", action: "record.write" } });
  await repo.append(T, [{ resourceType: "Observation", id: "obs-1", version: 2, patientId: "pat-1", value: 126, writtenBy: { id: "cfa:nurse", kind: "human", at }, meta: { recordedAt: at } }], { audit: { ts: at, actor: "cfa:nurse", action: "record.write" } });
  if (provider) {
    const secretsEnc = provider === "s3" ? { accessKeyId: await sealSecret(ENV, "AKIDEXAMPLE"), secretAccessKey: await sealSecret(ENV, "secret-do-not-leak") } : {};
    await repo.append(T, [{ resourceType: CONNECTOR_TYPE, id: "backup", version: 1, kind: "backup", provider, active: true,
      settings: settings || (provider === "s3" ? { endpoint: ENDPOINT, bucket: "hosp-backups", region: "ap-south-1" } : {}), secretsEnc, writtenBy: { id: "cfa:admin", kind: "human", at } }], {});
  }
  return repo;
}

const run = (repo, b, nowIso, extra) => S.backupHospital({ repository: repo, tenantId: T, env: ENV, nowIso, fetchImpl: b && b.fetchImpl, ...(extra || {}) });
const runsOf = async (repo) => repo.latestByType(T, "BackupRun", 1000);
const testsOf = async (repo) => repo.latestByType(T, "RestoreTest", 1000);

/* ---- scheduling, pure ------------------------------------------------------------------------------ */

const r = (at, over) => ({ id: "b-" + at, at, scheduled: true, status: "ok", throughSeq: 10, baseId: "base", more: false, ...(over || {}) });

test("the plan: first run full, once a day, incremental from the last sequence, full each new month, continue an unfinished run", () => {
  assert.deepEqual(S.nextRunPlan([], "2026-09-10T00:05:00Z"), { due: true, kind: "full", sinceSeq: 0, baseId: null, reason: "first" });
  assert.equal(S.nextRunPlan([r("2026-09-10T00:05:00Z")], "2026-09-10T13:00:00Z").due, false);
  assert.deepEqual(S.nextRunPlan([r("2026-09-10T00:05:00Z", { throughSeq: 42 })], "2026-09-11T00:05:00Z"), { due: true, kind: "incremental", sinceSeq: 42, baseId: "base", reason: "daily" });
  assert.equal(S.nextRunPlan([r("2026-08-31T00:05:00Z")], "2026-09-01T00:05:00Z").kind, "full");
  const cont = S.nextRunPlan([r("2026-09-10T00:05:00Z", { more: true, throughSeq: 20000 })], "2026-09-10T01:05:00Z");
  assert.deepEqual([cont.due, cont.kind, cont.sinceSeq, cont.reason], [true, "incremental", 20000, "continuing"]);
  // A manual receipt (POST /ward/backup) and a pruned run are not part of any chain.
  assert.equal(S.nextRunPlan([{ at: "2026-09-10T00:00:00Z", throughSeq: 5 }, r("2026-09-10T00:05:00Z", { pruned: true })], "2026-09-10T02:00:00Z").reason, "first");
});

test("a restore dry run is due weekly, counting only automatic ones", () => {
  assert.equal(S.restoreTestDue([], "2026-09-10T00:00:00Z"), true);
  assert.equal(S.restoreTestDue([{ at: "2026-09-08T00:00:00Z", automated: true }], "2026-09-10T00:00:00Z"), false);
  assert.equal(S.restoreTestDue([{ at: "2026-09-02T00:00:00Z", automated: true }], "2026-09-10T00:00:00Z"), true);
  assert.equal(S.restoreTestDue([{ at: "2026-09-09T00:00:00Z", outcome: "success" }], "2026-09-10T00:00:00Z"), true, "a manual log entry does not stand in for the scheduled dry run");
});

function twoMonths() {
  const runs = [];
  for (let d = 1; d <= 31; d++) runs.push(r(`2026-08-${String(d).padStart(2, "0")}T00:05:00Z`, { baseId: "b-2026-08-01T00:05:00Z" }));
  for (let d = 1; d <= 10; d++) runs.push(r(`2026-09-${String(d).padStart(2, "0")}T00:05:00Z`, { baseId: "b-2026-09-01T00:05:00Z" }));
  return runs;
}
const kept = (plan) => new Set(plan.keep.map((x) => x.id));

test("retention: defaults keep every file a kept restore point needs, and pruning never orphans an incremental", () => {
  const runs = twoMonths();
  assert.equal(S.retentionPlan(runs, { keepDaily: 30, keepMonthly: 12 }).prune.length, 0, "Aug 12 onwards needs the whole August chain");

  const p = S.retentionPlan(runs, { keepDaily: 5, keepMonthly: 1 });
  assert.equal(p.prune.length, 31, "all of August goes");
  assert.equal(p.keep.length, 10);

  const m2 = S.retentionPlan(runs, { keepDaily: 5, keepMonthly: 2 });
  assert.ok(kept(m2).has("b-2026-08-01T00:05:00Z"), "August's full is August's monthly point");
  assert.equal(m2.prune.length, 30);

  for (const plan of [p, m2, S.retentionPlan(runs, { keepDaily: 1, keepMonthly: 0 })]) {
    const k = kept(plan);
    for (const x of plan.keep) for (const y of runs) {
      if (y.baseId === x.baseId && y.at <= x.at) assert.ok(k.has(y.id), `${x.id} needs ${y.id}`);
    }
  }
  // A chain still being written keeps everything it has.
  const partial = [...runs, r("2026-10-01T00:05:00Z", { baseId: "b-oct", more: true })];
  assert.ok(kept(S.retentionPlan(partial, { keepDaily: 1, keepMonthly: 0 })).has("b-2026-10-01T00:05:00Z"));
});

/* ---- the whole pass, against a mocked S3 bucket ------------------------------------------------------ */

test("a full backup: encrypted, signed PutObject, read back and checksum-verified, recorded, and dry-run restored", async () => {
  const repo = await hospital("s3");
  const b = bucket();
  const out = await run(repo, b, "2026-09-10T00:05:00.000Z");
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.backup.kind, "full");
  assert.equal(out.backup.rows, 4, "patient, two observation versions, and the connector");

  const put = b.calls.find((c) => c.method === "PUT");
  assert.match(put.url, /^https:\/\/93\.184\.216\.34\/hosp-backups\/wardsynq-backups\/tenant-a\/2026-09\/wsq-backup-full-\d+\.jsonl\.aesgcm$/);
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(put.headers["content-type"], "application/octet-stream");
  assert.equal(put.headers["x-amz-content-sha256"], sha(put.body), "the payload hash is the body's SHA-256");
  assert.ok(!Buffer.from(put.body).toString("latin1").includes("Secretname"), "nothing leaves the server in the clear");
  assert.ok(!JSON.stringify(b.calls.map((c) => c.headers)).includes("secret-do-not-leak"));

  const [rec] = await runsOf(repo);
  assert.equal(rec.scheduled, true);
  assert.equal(rec.checksumVerified, true);
  assert.equal(rec.sha256, sha(put.body));
  assert.equal(rec.bytes, put.body.length);
  assert.deepEqual(rec.counts, { Patient: 1, Observation: 2, [CONNECTOR_TYPE]: 1 });
  assert.ok(rec.auditHead && rec.auditHead.seq >= 3);
  assert.ok(repo.audit.some((e) => e.action === "backup.scheduled" && e.actor === S.SYSTEM), "the run is audited");

  const [t] = await testsOf(repo);
  assert.equal(t.outcome, "success", t.note);
  assert.equal(t.automated, true);
  assert.equal(t.checks.scratchRestore, "restored");
  assert.equal(t.checks.auditHead, "matches");
  assert.ok(repo.audit.some((e) => e.action === "backup.restore_dry_run"));
  assert.ok(!repo._rows.some((x) => x.tenantId !== T), "the scratch restore never touched the live store");

  // Later the same day: nothing due, nothing sent.
  const before = b.calls.length;
  const again = await run(repo, b, "2026-09-10T05:05:00.000Z");
  assert.equal(again.ok, true);
  assert.equal(again.backup, undefined);
  assert.equal(b.calls.length, before);

  // The next day: an incremental from where the full stopped, and the next dry run restores the whole chain.
  await repo.append(T, [{ resourceType: "Observation", id: "obs-1", version: 3, patientId: "pat-1", value: 130, writtenBy: { id: "cfa:nurse", kind: "human", at: "x" } }], {});
  const next = await run(repo, b, "2026-09-11T00:05:00.000Z");
  assert.equal(next.backup.kind, "incremental");
  const inc = (await runsOf(repo)).find((x) => x.kind === "incremental");
  assert.equal(inc.sinceSeq, rec.throughSeq);
  assert.equal(inc.baseId, rec.id);
  const dry = await S.restoreDryRun({ repository: repo, tenantId: T, store: (await B.destinationFor((await repo.latestByType(T, CONNECTOR_TYPE, 5))[0], { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "s" }, { fetchImpl: b.fetchImpl })).store, key: await S.backupKey(ENV, T), runs: await runsOf(repo) });
  assert.equal(dry.outcome, "success", dry.note);
  assert.equal(dry.checks.files, 2);
});

test("retention prunes through the destination and records it, one audited version per pruned file", async () => {
  const repo = await hospital("s3", { endpoint: ENDPOINT, bucket: "hosp-backups", keepDaily: "1", keepMonthly: "0" });
  const b = bucket();
  await run(repo, b, "2026-08-31T00:05:00.000Z");
  const out = await run(repo, b, "2026-09-01T00:05:00.000Z");
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.pruned, 1, "August's chain is no longer needed");
  assert.equal(b.calls.filter((c) => c.method === "DELETE" && c.url.includes("/2026-08/")).length, 1);
  assert.equal((await runsOf(repo)).filter((x) => x.pruned).length, 1);
  assert.ok(repo.audit.some((e) => e.action === "backup.pruned"));
});

test("VERIFICATION FAILURES: a refused upload, a corrupted read-back, a missing file, a rewritten audit chain, another hospital's key", async () => {
  // Refused: nothing recorded, and the step is named.
  let repo = await hospital("s3");
  let out = await run(repo, bucket({ status: 403 }), "2026-09-10T00:05:00.000Z");
  assert.deepEqual([out.ok, out.step, out.error], [false, "store", "store_failed"]);
  assert.equal((await runsOf(repo)).length, 0);

  // Corrupted on read-back: the file is removed and no run is recorded.
  repo = await hospital("s3");
  const bad = bucket({ corrupt: true });
  out = await run(repo, bad, "2026-09-10T00:05:00.000Z");
  assert.deepEqual([out.ok, out.step, out.error], [false, "verify", "checksum_mismatch"]);
  assert.equal(bad.objects.size, 0);
  assert.equal((await runsOf(repo)).length, 0);

  // A file gone from the destination: the weekly dry run fails, says which, and the pass is a failure.
  repo = await hospital("s3");
  const b = bucket();
  assert.equal((await run(repo, b, "2026-09-01T00:05:00.000Z")).ok, true);
  b.objects.clear();
  out = await run(repo, b, "2026-09-09T00:05:00.000Z");
  assert.deepEqual([out.ok, out.step, out.error], [false, "restore-test", "restore_test_failed"]);
  const failed = (await testsOf(repo)).find((x) => x.outcome === "failed");
  assert.match(failed.note, /is not in the destination/);

  // The audit chain rewritten since the backup: the dry run says so.
  repo = await hospital("s3");
  const b2 = bucket();
  await run(repo, b2, "2026-09-01T00:05:00.000Z");
  const rec = (await runsOf(repo))[0];
  const link = repo._chain.find((l) => l.chainSeq === rec.auditHead.seq);
  link.rowHash = "0".repeat(64);
  const dry = await S.restoreDryRun({ repository: repo, tenantId: T, store: { get: async (k) => { const v = b2.objects.get("/hosp-backups/" + k); return v ? { bytes: v } : null; } }, key: await S.backupKey(ENV, T), runs: await runsOf(repo) });
  assert.equal(dry.outcome, "failed");
  assert.match(dry.note, /no longer matches the live audit chain/);

  // Another hospital's key cannot open this hospital's backup.
  const other = await S.restoreDryRun({ repository: repo, tenantId: T, store: { get: async (k) => ({ bytes: b2.objects.get("/hosp-backups/" + k) }) }, key: await S.backupKey(ENV, "tenant-b"), runs: await runsOf(repo) });
  assert.match(other.note, /could not be decrypted/);
  assert.equal(other.outcome, "failed");
});

test("NOT RUNNING IS SAID PLAINLY: no destination, platform storage before S1, no encryption key", async () => {
  let out = await run(await hospital(null), null, "2026-09-10T00:05:00.000Z");
  assert.equal(out.notConfigured, true);
  assert.equal(out.setup, "hospital");
  assert.match(out.message, /^Backups are not running: no backup destination is configured\./);

  out = await run(await hospital("platform"), null, "2026-09-10T00:05:00.000Z");
  assert.equal(out.error, "platform_not_configured");
  assert.equal(out.setup, "platform");
  assert.match(out.message, /owner decision S1/);

  out = await S.backupHospital({ repository: await hospital("s3"), tenantId: T, env: { FOLLOWCARE_PHI_KEY: ENV.FOLLOWCARE_PHI_KEY }, nowIso: "2026-09-10T00:05:00.000Z", fetchImpl: bucket().fetchImpl });
  assert.equal(out.ok, true, "control: the same hospital with a key runs");
  const repo = await hospital("s3");
  out = await S.backupHospital({ repository: repo, tenantId: T, env: {}, nowIso: "2026-09-10T00:05:00.000Z", fetchImpl: bucket().fetchImpl });
  // Without the document key the sealed credentials do not open either; either way nothing is written.
  assert.equal(out.notConfigured, true);
  assert.equal((await runsOf(repo)).length, 0);
  assert.equal(await S.backupKey({}, T), null);
});

/* ---- the destination adapter's contract ----------------------------------------------------------- */

test("adapter: the backup kind is on the connector catalogue, validates bucket, keys and retention, and never offers SFTP", () => {
  assert.ok(KINDS.backup && KINDS.backup.singleton);
  assert.deepEqual(Object.keys(KINDS.backup.providers).sort(), ["platform", "s3"]);
  const v = KINDS.backup.providers.s3.validate;
  assert.match(v({ bucket: "Bad_Bucket" }, { accessKeyId: true, secretAccessKey: true }), /valid bucket name/);
  assert.match(v({ bucket: "good-bucket" }, { accessKeyId: true }), /secret access key/);
  assert.match(v({ bucket: "good-bucket", keepDaily: "0" }, { accessKeyId: true, secretAccessKey: true }), /Daily backups to keep/);
  assert.equal(v({ bucket: "good-bucket", keepDaily: "45", keepMonthly: "" }, { accessKeyId: true, secretAccessKey: true }), null);
  assert.deepEqual(B.retentionOf({}), { keepDaily: 30, keepMonthly: 12 });
});

test("adapter: the connection test writes, reads back and deletes one object, and reports a refusal without the body", async () => {
  const b = bucket();
  const ok = await KINDS.backup.providers.s3.test({ settings: { endpoint: ENDPOINT, bucket: "hosp-backups" }, secrets: { accessKeyId: "AK", secretAccessKey: "SK" }, fetchImpl: b.fetchImpl });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(b.calls.map((c) => c.method), ["PUT", "GET", "DELETE"]);
  assert.equal(b.calls[0].url, `${ENDPOINT}/hosp-backups/wardsynq-backups/_connection-test`);
  assert.match(b.calls[0].headers.authorization, /Credential=AK\/\d{8}\/auto\/s3\/aws4_request/);

  const no = await KINDS.backup.providers.s3.test({ settings: { endpoint: ENDPOINT, bucket: "hosp-backups" }, secrets: { accessKeyId: "AK", secretAccessKey: "SK" }, fetchImpl: bucket({ status: 403 }).fetchImpl });
  assert.deepEqual([no.ok, no.reason, no.httpStatus], [false, "auth-refused", 403]);
  assert.ok(!/AccessDenied/.test(no.detail));

  const calls = [];
  const priv = await KINDS.backup.providers.s3.test({ settings: { endpoint: "https://10.0.0.5", bucket: "hosp-backups" }, secrets: { accessKeyId: "AK", secretAccessKey: "SK" }, fetchImpl: async (u) => { calls.push(u); return new Response(""); } });
  assert.equal(priv.ok, false);
  assert.equal(calls.length, 0, "a private address is never contacted");
});

/* ---- System health --------------------------------------------------------------------------------- */

const healthDeps = (over) => ({
  tenantId: T, env: {}, maik: null, rpoMinutes: 1440, timeoutMs: 1000, now: () => Date.parse("2026-09-10T06:00:00.000Z"),
  repository: { latestByType: async () => [] },
  orgProbe: async () => ({}), documentProbe: async () => ({ state: "ok" }), lastTick: async () => null,
  ...(over || {}),
});
const backupLine = async (deps) => (await systemHealthReport(deps)).dependencies.find((x) => x.id === "backup");

test("System health: no destination, a failure, and a good run each read as what they are", async () => {
  let line = await backupLine(healthDeps({ backupDestination: async () => null, lastBackupRun: async () => null }));
  assert.equal(line.status, "down");
  assert.match(line.reason, /^Backups are not running: no backup destination is configured\./);
  assert.match(line.reason, /Admin Center, Integrations, Backup destination/);
  assert.equal(line.setup, "hospital");

  line = await backupLine(healthDeps({ backupDestination: async () => ({ provider: "platform" }), lastBackupRun: async () => ({ at: "2026-09-10T05:00:00Z", notConfigured: true, setup: "platform", message: "Backups are not running: ... owner decision S1 ..." }) }));
  assert.equal(line.status, "down");
  assert.equal(line.setup, "platform");
  assert.match(line.reason, /S1/);

  const good = { id: "b1", at: "2026-09-10T00:05:00.000Z", scheduled: true, status: "ok", kind: "full", rows: 4, bytes: 2048, more: false };
  const test1 = { at: "2026-09-10T00:05:00.000Z", outcome: "success", automated: true };
  const repository = { latestByType: async (_t, type) => (type === "BackupRun" ? [good] : [test1]) };
  line = await backupLine(healthDeps({ repository, backupDestination: async () => ({ provider: "s3" }), lastBackupRun: async () => ({ at: good.at, ok: true }) }));
  assert.equal(line.status, "up", line.reason);
  assert.match(line.reason, /Last successful backup 2026-09-10T00:05:00.000Z, 2 KB/);
  assert.match(line.reason, /Last restore test 2026-09-10T00:05:00.000Z: success \(automatic dry run\)/);

  line = await backupLine(healthDeps({ repository, backupDestination: async () => ({ provider: "s3" }),
    lastBackupRun: async () => ({ at: "2026-09-10T05:05:00Z", ok: false, lastFailure: { at: "2026-09-10T05:05:00Z", step: "store", error: "store_failed", message: "The backup destination refused the file (403)." }, alert: { at: "2026-09-10T05:05:00Z", error: "store_failed", sent: 1, total: 2 } }) }));
  assert.equal(line.status, "down");
  assert.match(line.reason, /The last scheduled backup failed at 2026-09-10T05:05:00Z: The backup destination refused the file \(403\)\. Administrators alerted: 1 of 2 phones\./);
});
