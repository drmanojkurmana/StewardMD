/* test/wardsynq-backup-schedule-routes.test.mjs - the scheduled backup through the router.
 *
 * Routes: POST /api/queue/ops/backup-all (machine only: the worker's hourly cron with the admin token),
 * POST /api/queue/ward/connector-save and GET /api/queue/ward/connectors for the "backup" connector kind,
 * GET /api/queue/ward/system-health for the Backup line.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-backup-schedule-routes.test.mjs
 */
import { as, seed, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, OTHER_ADMIN, writesNow, withFetch } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const ADMIN_TOKEN = "backup-cron-admin-token-for-tests-0001";
ENV.UPDATES_ADMIN_TOKEN = ADMIN_TOKEN;
const ENDPOINT = "https://93.184.216.34";
const SECRET = "hospital-secret-access-key-do-not-leak";
const S3 = { kind: "backup", provider: "s3", settings: { endpoint: ENDPOINT, bucket: "hosp-backups", keepDaily: "30", keepMonthly: "12" }, secrets: { accessKeyId: "AKIDHOSPITAL", secretAccessKey: SECRET } };
const cron = (headers) => as(null, "/ops/backup-all", "POST", {}, headers);

function bucket() {
  const objects = new Map(), calls = [];
  return {
    objects, calls,
    fetchImpl: async (url, init) => {
      const u = new URL(String(url));
      if (!u.hostname.startsWith("93.184.216.")) return new Response("{}", { status: 404 });
      calls.push({ method: (init && init.method) || "GET", url: String(url) });
      if (init.method === "PUT") { objects.set(u.pathname, new Uint8Array(init.body)); return new Response("", { status: 200 }); }
      if (init.method === "GET") { const b = objects.get(u.pathname); return b ? new Response(b, { status: 200 }) : new Response("", { status: 404 }); }
      if (init.method === "DELETE") { objects.delete(u.pathname); return new Response(null, { status: 204 }); }
      return new Response("", { status: 405 });
    },
  };
}

test("POST /api/queue/ops/backup-all: no session 401, a hospital admin 403, and nothing is written", async () => {
  seed();
  const before = writesNow();
  assert.equal((await cron()).__status, 401);
  assert.equal((await as(ADMIN, "/ops/backup-all", "POST", {})).__status, 403);
  assert.equal((await cron({ "X-Admin-Token": "wrong-token-of-similar-length-00000001" })).__status, 401);
  assert.equal(writesNow(), before);
});

test("POST /api/queue/ops/backup-all with the admin token: a hospital with no destination is reported not configured, and System health says so", async () => {
  seed();
  const r = await cron({ "X-Admin-Token": ADMIN_TOKEN });
  assert.equal(r.__status, 200, r.__text);
  const mine = r.results.find((x) => x.orgId === ORG_ID);
  assert.equal(mine.notConfigured, true);
  assert.equal(mine.ok, false);
  assert.equal(r.ok, true, "not configured is not a failed run");
  assert.equal(H.RECORD._rows.filter((x) => x.resourceType === "BackupRun").length, 0);

  const h = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`, "GET");
  const line = h.dependencies.find((x) => x.id === "backup");
  assert.equal(line.status, "down");
  assert.match(line.reason, /^Backups are not running: no backup destination is configured\./);
});

test("POST /api/queue/ward/connector-save kind backup: nurse 403, hr 403, another hospital's admin 403, nothing written; the admin saves it sealed", async () => {
  seed();
  const before = writesNow();
  assert.equal((await as(null, "/ward/connector-save", "POST", { orgId: ORG_ID, ...S3 })).__status, 401);
  assert.equal((await as(NURSE, "/ward/connector-save", "POST", { orgId: ORG_ID, ...S3 })).__status, 403);
  assert.equal((await as(HR, "/ward/connector-save", "POST", { orgId: ORG_ID, ...S3 })).__status, 403);
  assert.equal((await as(OTHER_ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...S3 })).__status, 403);
  assert.equal(writesNow(), before);

  const saved = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...S3 });
  assert.equal(saved.__status, 200, saved.__text);
  assert.ok(!saved.__text.includes(SECRET));
  const list = await as(ADMIN, `/ward/connectors?orgId=${ORG_ID}`, "GET");
  assert.ok(list.catalogue.some((k) => k.kind === "backup"), "the Integrations screen offers it");
  assert.deepEqual(list.connectors.find((c) => c.kind === "backup").secretsSet, ["accessKeyId", "secretAccessKey"]);
  assert.ok(!list.__text.includes(SECRET));
  // Other hospital sees none of it.
  const other = await as(OTHER_ADMIN, `/ward/connectors?orgId=${OTHER}`, "GET");
  assert.ok(!(other.connectors || []).some((c) => c.kind === "backup"));
});

test("once configured, the cron takes the backup, and System health shows its size and the restore dry run", async () => {
  seed();
  assert.equal((await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, ...S3 })).__status, 200);
  const b = bucket();
  const r = await withFetch(b.fetchImpl, () => cron({ "X-Admin-Token": ADMIN_TOKEN }));
  assert.equal(r.__status, 200, r.__text);
  const mine = r.results.find((x) => x.orgId === ORG_ID);
  assert.equal(mine.ok, true, JSON.stringify(mine));
  assert.equal(mine.backup.kind, "full");
  assert.equal(mine.restoreTest, "success");
  assert.ok(b.calls.some((c) => c.method === "PUT" && c.url.includes("/hosp-backups/wardsynq-backups/tenant-wsq/")));

  const h = await as(ADMIN, `/ward/system-health?orgId=${ORG_ID}`, "GET");
  const line = h.dependencies.find((x) => x.id === "backup");
  assert.match(line.reason, /Last successful backup .*, \d+ (bytes|KB|MB) \(full/);
  assert.match(line.reason, /Last restore test .*: success \(automatic dry run\)/);

  // The same hour again: the gate holds, nothing more is written to the bucket.
  const puts = b.calls.filter((c) => c.method === "PUT").length;
  const again = await withFetch(b.fetchImpl, () => cron({ "X-Admin-Token": ADMIN_TOKEN }));
  assert.equal(again.results.find((x) => x.orgId === ORG_ID).skipped, "gate");
  assert.equal(b.calls.filter((c) => c.method === "PUT").length, puts);
});
