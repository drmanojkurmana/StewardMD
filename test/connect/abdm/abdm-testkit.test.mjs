// test/connect/abdm/abdm-testkit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAbdmDb, makeR2 } from "../../../functions/_connect/abdm/abdm-testkit.js";

test("mock D1 UPDATE returns meta.changes for a CAS (only when the guard matches)", async () => {
  const db = makeAbdmDb({ connect_abdm_txn: [{ request_id: "r1", transaction_id: "t1", status: "REQUESTED" }] });
  const upd = "UPDATE connect_abdm_txn SET status=? WHERE transaction_id=? AND status<>?";
  const a = await db.prepare(upd).bind("ACKED", "t1", "ACKED").run();      // guard passes → changes 1
  assert.equal(a.meta.changes, 1);
  const b = await db.prepare(upd).bind("ACKED", "t1", "ACKED").run();      // now status IS ACKED → guard blocks
  assert.equal(b.meta.changes, 0);                                         // the exactly-once CAS property
});

test("mock D1 INSERT + first() lookup", async () => {
  const db = makeAbdmDb({});
  await db.prepare("INSERT INTO connect_abdm_consent_req (request_id,status) VALUES (?,?)").bind("r1", "INITIATED").run();
  const row = await db.prepare("SELECT * FROM connect_abdm_consent_req WHERE request_id=?").bind("r1").first();
  assert.equal(row.status, "INITIATED");
});

test("mock R2 put/get/delete/list with prefix + metadata", async () => {
  const r2 = makeR2();
  await r2.put("t1/cc1", "cipher", { customMetadata: { ts: "100" } });
  const o = await r2.get("t1/cc1");
  assert.equal(await o.text(), "cipher");
  assert.equal(o.customMetadata.ts, "100");
  const l = await r2.list({ prefix: "t1/" });
  assert.equal(l.objects.length, 1);
  await r2.delete("t1/cc1");
  assert.equal(await r2.get("t1/cc1"), null);
});

test("mock D1 supported WHERE shapes do NOT throw (=, and the CAS <> guard)", async () => {
  const db = makeAbdmDb({ connect_abdm_txn: [{ request_id: "r1", transaction_id: "t1", status: "REQUESTED" }] });
  await db.prepare("SELECT * FROM connect_abdm_txn WHERE request_id=?").bind("r1").first();
  await db.prepare("UPDATE connect_abdm_txn SET status=? WHERE transaction_id=? AND status<>?").bind("ACKED", "t1", "ACKED").run();
  assert.ok(true); // reached without throwing → `=` and `<>` are both accepted
});

test("mock D1 FAILS LOUD on an unsupported WHERE (SELECT ... expires_at < ?) — no silent drop-to-no-WHERE", async () => {
  const db = makeAbdmDb({ connect_abdm_txn: [{ request_id: "r1", expires_at: "z" }] });
  await assert.rejects(
    async () => db.prepare("SELECT * FROM connect_abdm_txn WHERE expires_at < ?").bind("2020").all(),
    /unsupported WHERE/);
});

test("mock D1 FAILS LOUD on an unsupported DELETE WHERE (would otherwise wipe the whole table)", async () => {
  const db = makeAbdmDb({ connect_abdm_txn: [{ request_id: "r1", expires_at: "z" }] });   // seed a row so the filter actually evaluates the predicate
  await assert.rejects(
    async () => db.prepare("DELETE FROM connect_abdm_txn WHERE expires_at < ?").bind("2020").run(),
    /unsupported WHERE/);
});
