// test/connect/scaffold.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/api/connect/[[path]].js";
import { makeMockKv, makeMockDb, flagOn } from "../../functions/_connect/testkit.js";

const ctx = (path, env) => ({ request: new Request("https://x" + path), env, params: {} });

test("router 404s when smd_connect is OFF", async () => {
  const res = await onRequest(ctx("/api/connect/health", { CONNECT_FLAG: "0" }));
  assert.equal(res.status, 404);
});

test("router health responds when flag ON", async () => {
  const res = await onRequest(ctx("/api/connect/health", { CONNECT_FLAG: "1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test("flagOn reads smd_connect", () => {
  assert.equal(flagOn({ CONNECT_FLAG: "1" }), true);
  assert.equal(flagOn({ CONNECT_FLAG: "0" }), false);
  assert.equal(flagOn({}), false);              // default OFF
});

test("mock db + kv round-trip", async () => {
  const kv = makeMockKv();
  await kv.put("k", "v");
  assert.equal(await kv.get("k"), "v");
  const db = makeMockDb({ connect_tenant: [{ id: "t1", mode: "sandbox" }] });
  const row = await db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind("t1").first();
  assert.equal(row.mode, "sandbox");
});
