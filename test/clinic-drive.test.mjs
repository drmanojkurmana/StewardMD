// test/clinic-drive.test.mjs — Shared Clinic EMR Drive transport adapter (Phase 6 native). Verifies the
// pure name/query mapping AND that the adapter satisfies the sync engine's { list, get, put } contract:
// a fake in-memory Drive server (as a fetch mock) is driven by the REAL clinic-sync engine, and two
// devices converge through it — proving the multipart create / list-by-query / alt=media download shapes
// are consumed correctly. The live Drive round-trip is verified separately on a real device.
// node --test test/clinic-drive.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const D = require(join(HERE, "..", "clinic-drive.js"));
const S = require(join(HERE, "..", "clinic-store.js"));
const SYNC = require(join(HERE, "..", "clinic-sync.js"));
const C = require(join(HERE, "..", "clinic-crypto.js"));

test("name mapping: engine '/' <-> Drive '~', round-trips", () => {
  assert.equal(D._driveName("C1/devA.3.smddelta"), "C1~devA.3.smddelta");
  assert.equal(D._engineName("C1~devA.3.smddelta"), "C1/devA.3.smddelta");
  assert.equal(D._engineName(D._driveName("C1/devB.12.smddelta")), "C1/devB.12.smddelta");
});

test("listQuery scopes to this clinic's non-trashed delta files", () => {
  const q = D._listQuery("C1");
  assert.ok(q.includes("name contains 'C1~'"), "scoped to clinic prefix");
  assert.ok(q.includes("name contains '.smddelta'"), "scoped to delta files");
  assert.ok(q.includes("trashed = false"), "excludes trashed");
});

// ---- a fake in-memory Google Drive, exposed as a fetch mock ----
function fakeDrive() {
  const files = []; let seq = 0;
  function clause(q, op) { // pull `name <op> 'value'` occurrences out of a Drive query
    const out = []; const re = new RegExp("name " + op + " '([^']*)'", "g"); let m;
    while ((m = re.exec(q))) out.push(m[1]);
    return out;
  }
  function fetch(url, opts) {
    opts = opts || {};
    const u = new URL(url);
    // multipart create
    if (u.pathname === "/upload/drive/v3/files") {
      const body = String(opts.body);
      const meta = JSON.parse(body.split("\r\n\r\n")[1].split("\r\n")[0]);
      const content = body.split("application/octet-stream\r\n\r\n")[1].split("\r\n--")[0];
      const f = { id: "f" + (++seq), name: meta.name, content: content, trashed: false };
      files.push(f);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: f.id }) });
    }
    // download
    let m = u.pathname.match(/^\/drive\/v3\/files\/(.+)$/);
    if (m && u.searchParams.get("alt") === "media") {
      const f = files.find((x) => x.id === m[1]);
      return Promise.resolve({ ok: !!f, text: () => Promise.resolve(f ? f.content : "") });
    }
    // list / find by query
    if (u.pathname === "/drive/v3/files") {
      const q = u.searchParams.get("q") || "";
      const contains = clause(q, "contains"), eq = clause(q, "=");
      let hit = files.filter((f) => !f.trashed);
      contains.forEach((c) => { hit = hit.filter((f) => f.name.indexOf(c) >= 0); });
      eq.forEach((c) => { hit = hit.filter((f) => f.name === c); });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: hit.map((f) => ({ id: f.id, name: f.name })) }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
  }
  return { files, fetch };
}

test("adapter satisfies the transport contract: put -> list -> get through fake Drive", async () => {
  const drive = fakeDrive();
  const tx = D.create("C1", { fetch: drive.fetch, getToken: () => Promise.resolve("tok") });
  await tx.put("C1/devA.1.smddelta", "cipher-blob-1");
  const names = await tx.list();
  assert.deepEqual(names, ["C1/devA.1.smddelta"], "list returns engine-form names");
  assert.equal(await tx.get("C1/devA.1.smddelta"), "cipher-blob-1", "get downloads the blob");
  assert.equal(await tx.get("C1/devA.9.smddelta"), null, "missing file -> null");
});

test("list is clinic-scoped: another clinic's deltas are not returned", async () => {
  const drive = fakeDrive();
  const c1 = D.create("C1", { fetch: drive.fetch, getToken: () => Promise.resolve("t") });
  const c2 = D.create("C2", { fetch: drive.fetch, getToken: () => Promise.resolve("t") });
  await c1.put("C1/devA.1.smddelta", "a");
  await c2.put("C2/devB.1.smddelta", "b");
  assert.deepEqual(await c1.list(), ["C1/devA.1.smddelta"]);
  assert.deepEqual(await c2.list(), ["C2/devB.1.smddelta"]);
});

test("INTEGRATION: real sync engine + real crypto over the Drive adapter — two devices converge", async () => {
  const drive = fakeDrive();
  const secret = "clinic-XYZ", salt = C.newSalt();
  const cryptoA = C.create(secret, salt), cryptoB = C.create(secret, salt);
  const txA = D.create("C1", { fetch: drive.fetch, getToken: () => Promise.resolve("tokA") });
  const txB = D.create("C1", { fetch: drive.fetch, getToken: () => Promise.resolve("tokB") });
  let ta = 1000, tb = 5000;
  const A = S.create({ deviceId: "devA", clinicId: "C1", clock: () => (ta += 10) });
  const B = S.create({ deviceId: "devB", clinicId: "C1", clock: () => (tb += 10) });
  const sa = SYNC.create({ store: A, transport: txA, crypto: cryptoA, deviceId: "devA", clinicId: "C1", state: { batch: 0, cursor: {} } });
  const sb = SYNC.create({ store: B, transport: txB, crypto: cryptoB, deviceId: "devB", clinicId: "C1", state: { batch: 0, cursor: {} } });

  const p = A.put("patient", { name: "Asha Rao", allergy: "penicillin" });
  await sa.push();
  // what actually landed in "Drive" is opaque ciphertext
  assert.ok(drive.files.length === 1, "one delta file created");
  assert.ok(!drive.files[0].content.includes("Asha") && !drive.files[0].content.includes("penicillin"), "PHI encrypted at rest in Drive");
  assert.ok(drive.files[0].name.startsWith("C1~"), "stored under the clinic prefix");
  await sb.pull();
  assert.equal(B.get(p.id).data.name, "Asha Rao", "B pulled + decrypted A's patient");
  assert.equal(B.get(p.id).data.allergy, "penicillin");
});
