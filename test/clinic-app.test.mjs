// test/clinic-app.test.mjs — Shared Clinic EMR bootstrap (Phase 6/7): the layer that assembles the
// tested core into ONE live on-device instance with durable local persistence + a sync cadence.
// Proves: (1) data survives an app "restart" (re-create from the same storage); (2) the local snapshot
// is encrypted at rest and the clinic secret is never persisted; (3) two devices converge through the
// REAL Drive adapter while each persists locally. node --test test/clinic-app.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = require(join(HERE, "..", "clinic-app.js"));
const C = require(join(HERE, "..", "clinic-crypto.js"));

function mkStorage() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m }; }

function fakeDrive() {
  const files = []; let seq = 0;
  function pick(q, op) { const out = []; const re = new RegExp("name " + op + " '([^']*)'", "g"); let m; while ((m = re.exec(q))) out.push(m[1]); return out; }
  function fetch(url, opts) {
    opts = opts || {}; const u = new URL(url);
    if (u.pathname === "/upload/drive/v3/files") {
      const body = String(opts.body);
      const meta = JSON.parse(body.split("\r\n\r\n")[1].split("\r\n")[0]);
      const content = body.split("application/octet-stream\r\n\r\n")[1].split("\r\n--")[0];
      files.push({ id: "f" + (++seq), name: meta.name, content }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "f" + seq }) });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/(.+)$/);
    if (m && u.searchParams.get("alt") === "media") { const f = files.find((x) => x.id === m[1]); return Promise.resolve({ ok: !!f, text: () => Promise.resolve(f ? f.content : "") }); }
    if (u.pathname === "/drive/v3/files") {
      const q = u.searchParams.get("q") || ""; let hit = files.slice();
      pick(q, "contains").forEach((c) => { hit = hit.filter((f) => f.name.indexOf(c) >= 0); });
      pick(q, "=").forEach((c) => { hit = hit.filter((f) => f.name === c); });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: hit.map((f) => ({ id: f.id, name: f.name })) }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
  }
  return { files, fetch };
}

test("persistence + encryption at rest: data survives restart; PHI + secret never readable in storage", async () => {
  const storage = mkStorage(), salt = C.newSalt();
  const cfg = { clinicId: "C1", deviceId: "devA", userId: "u1", secret: "s3cret", salt, storage, bindEvents: false };
  const app = await APP.create(cfg);
  const pid = app.addPatient({ name: "Asha Rao", phone: "9998887777" });
  app.localStore.saveConsult(pid, {}, { cc: "fever 3 days" });
  await app.saveNow();

  const blob = storage.getItem("smd_clinic_C1");
  assert.ok(blob, "snapshot written");
  assert.ok(!blob.includes("Asha") && !blob.includes("9998887777") && !blob.includes("fever"), "PHI encrypted at rest");
  assert.ok(!JSON.stringify(storage._m).includes("s3cret"), "clinic secret is never persisted");

  // "restart": a fresh instance from the SAME storage + secret + salt rehydrates
  const app2 = await APP.create(cfg);
  assert.equal(app2.getPatient(pid).name, "Asha Rao", "patient survived restart");
  assert.equal(app2.localStore.getConsult(pid).cc, "fever 3 days", "assessment survived restart");
  await app.destroy(); await app2.destroy();
});

test("wrong secret cannot open a persisted clinic (starts empty, does not crash)", async () => {
  const storage = mkStorage(), salt = C.newSalt();
  const good = await APP.create({ clinicId: "C1", deviceId: "devA", secret: "right", salt, storage, bindEvents: false });
  good.addPatient({ name: "Priya" });
  await good.saveNow();
  const bad = await APP.create({ clinicId: "C1", deviceId: "devA", secret: "wrong", salt, storage, bindEvents: false });
  assert.equal(bad.listPatients().length, 0, "wrong key -> no readable records (undecryptable snapshot ignored)");
  await good.destroy(); await bad.destroy();
});

test("two devices converge through the REAL Drive adapter; Drive holds only ciphertext; both persist", async () => {
  const drive = fakeDrive(), salt = C.newSalt();
  const mk = (dev, uid, tok) => APP.create({ clinicId: "C1", deviceId: dev, userId: uid, secret: "k", salt, storage: mkStorage(), driveFetch: drive.fetch, getToken: () => Promise.resolve(tok), bindEvents: false });
  const A = await mk("devA", "u1", "tA"), B = await mk("devB", "u2", "tB");
  const pid = A.addPatient({ name: "Bob", allergy: "sulfa" });
  A.localStore.saveConsult(pid, {}, { cc: "cough" });
  await A.syncNow();   // push encrypted deltas to the clinic Drive
  await B.syncNow();   // pull them

  assert.equal(B.getPatient(pid).name, "Bob", "device B converged on device A's patient");
  assert.equal(B.localStore.getConsult(pid).cc, "cough", "and A's assessment");
  assert.ok(!drive.files.some((f) => f.content.includes("Bob") || f.content.includes("sulfa") || f.content.includes("cough")), "Drive holds only ciphertext");

  await B.saveNow();
  assert.ok(B._store.get(pid), "B has the record locally");
  await A.destroy(); await B.destroy();
});
